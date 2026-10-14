-- ทดสอบ 20261014040000_management_request_flow_completion.sql (ใบคำร้องถึงฝ่ายบริหาร):
--   1) "ไม่อนุมัติ" / "ขอข้อมูลเพิ่ม" ต้องมีเหตุผล (COMMENT_REQUIRED) ส่วน "อนุมัติ" ไม่บังคับ
--   2) มติ "รับทราบข้อมูล" ใช้ได้เฉพาะ MANAGEMENT
--   3) ขอข้อมูลเพิ่ม → ส่งกลับ: กลับไปขั้นเดิม ไม่เพิ่มขั้นใหม่ และแจ้งผู้อนุมัติขั้นนั้น
--   4) ขั้นที่ไม่มีผู้ถือบทบาท (ผจก.ทั่วไป) admin พิจารณาแทน ส่งกลับแล้ว admin ได้รับแจ้ง
--   5) ใบที่อนุมัติแล้วรับงานต่อไม่ได้ (จบที่มติ) ใบเก่าที่ in_progress ยังปิดงานได้ ประเภทอื่นรับงานได้ตามเดิม
begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

-- ผู้ยื่น (พนักงานสาธิต), หัวหน้างานสาธิต (ผู้อนุมัติขั้นแรกของใบ IT_ACCESS ใน seed), admin สาธิต
-- และ ผจก.โรงงาน ที่ได้สิทธิ์โมดูล MANAGEMENT — ไม่มีใครถือบทบาท ผจก.ทั่วไป
insert into auth.users (id, email, raw_user_meta_data) values
  ('74000000-0000-0000-0000-000000000001', 'mgflow-requester@mnp.local', '{}'::jsonb),
  ('74000000-0000-0000-0000-000000000002', 'mgflow-factory@mnp.local', '{}'::jsonb),
  ('74000000-0000-0000-0000-000000000003', 'mgflow-admin@mnp.local', '{}'::jsonb),
  ('74000000-0000-0000-0000-000000000004', 'mgflow-supervisor@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000003'
where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '74000000-0000-0000-0000-000000000004'
where id = '50000000-0000-0000-0000-000000000002';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('74000000-0000-0000-0000-000000000005', 'MGFLOW-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'mgflow-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '74000000-0000-0000-0000-000000000002');

insert into public.approval_module_permissions (employee_id, request_type_id)
select '74000000-0000-0000-0000-000000000005', t.id from public.request_types t where t.code = 'MANAGEMENT'
on conflict do nothing;

select is(
  (select count(*)::int from public.employees e
   where coalesce(e.acting_role_id, e.role_id) = '20000000-0000-0000-0000-000000000006' and e.is_active),
  0,
  'precondition: nobody holds the general manager role'
);

create function pg_temp.step_id(p_title text, p_order integer) returns uuid language sql as $$
  select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
  where r.title = p_title and s.step_order = p_order
$$;
grant execute on function pg_temp.step_id(text, integer) to authenticated;

-- 1. ผู้ยื่นสร้างใบคำร้องถึงฝ่ายบริหาร ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'MGFLOW_MAIN', 'รายละเอียดทดสอบ flow ใบคำร้องถึงฝ่ายบริหาร', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'requester creates a MANAGEMENT request'
);

-- 2. เหตุผลจำเป็นสำหรับไม่อนุมัติ/ขอข้อมูลเพิ่ม ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 1), 'rejected', null) $$,
  'COMMENT_REQUIRED',
  'rejecting without a reason is refused'
);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 1), 'more_info', '  ab  ') $$,
  'COMMENT_REQUIRED',
  'asking for more information needs at least 3 characters of reason'
);

-- 3. ขอข้อมูลเพิ่ม แล้วผู้ยื่นส่งกลับ: กลับขั้นเดิม ไม่เพิ่มขั้น ---------------------------
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 1), 'more_info', 'ขอใบเสนอราคาประกอบ') $$,
  'factory manager asks for more information with a reason'
);
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_resubmit_request((select id from public.requests where title = 'MGFLOW_MAIN'), 'แนบใบเสนอราคาแล้ว') $$,
  'requester sends the information back'
);
reset role;

select results_eq(
  $$ select status, current_step from public.requests where title = 'MGFLOW_MAIN' $$,
  $$ values ('pending_approval'::public.request_status, 1) $$,
  'request returns to the factory manager step'
);
select results_eq(
  $$ select s.step_order, s.status from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.title = 'MGFLOW_MAIN' order by s.step_order $$,
  $$ values (1, 'pending'::public.approval_status), (2, 'pending'::public.approval_status) $$,
  'resubmitting reuses the original step instead of adding one'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'MGFLOW_MAIN' and n.title = 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว'
     and n.recipient_id = '74000000-0000-0000-0000-000000000005'),
  1,
  'the factory manager is told the information came back'
);

-- 4. อนุมัติขั้นแรกไม่ต้องมีเหตุผล ขั้น ผจก.ทั่วไป ไม่มีผู้ถือ admin พิจารณาแทน -----------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 1), 'approved', null) $$,
  'approving needs no reason'
);
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 2), 'more_info', 'ขอรายละเอียดงบประมาณ') $$,
  'admin acts for the unstaffed general manager step'
);
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_resubmit_request((select id from public.requests where title = 'MGFLOW_MAIN'), 'งบประมาณ 15,000 บาท') $$,
  'requester answers the general manager step'
);
reset role;

select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'MGFLOW_MAIN' and n.title = 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว'
     and n.recipient_id = '50000000-0000-0000-0000-000000000001'),
  1,
  'admin is told when the reply is for a step nobody holds'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'MGFLOW_MAIN' and n.title = 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว'
     and n.recipient_id = '74000000-0000-0000-0000-000000000005'),
  1,
  'the factory manager is not told about the general manager step'
);

-- 5. อนุมัติครบแล้วรับงานต่อไม่ได้ ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('MGFLOW_MAIN', 2), 'approved', null) $$,
  'admin approves the general manager step'
);
select throws_ok(
  $$ select public.app_update_request_status((select id from public.requests where title = 'MGFLOW_MAIN'), 'in_progress') $$,
  'REQUEST_ENDS_AT_DECISION',
  'an approved management request cannot be taken into progress'
);
reset role;

-- ใบเก่าที่เคยถูกรับงานไปก่อนปิดขั้นนี้ ยังปิดงานได้
update public.requests set status = 'in_progress' where title = 'MGFLOW_MAIN';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_update_request_status((select id from public.requests where title = 'MGFLOW_MAIN'), 'completed') $$,
  'a legacy in-progress management request can still be completed'
);

-- 6. ประเภทอื่น: รับทราบข้อมูลไม่ได้ แต่รับงานคำร้องที่อนุมัติแล้วได้ตามเดิม -----------------
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(
       (select id from public.approval_steps where request_id = '60000000-0000-0000-0000-000000000002' and step_order = 1),
       'acknowledged', null) $$,
  'DECISION_NOT_ALLOWED',
  'acknowledged is refused outside the management module'
);
reset role;
select results_eq(
  $$ select status from public.requests where id = '60000000-0000-0000-0000-000000000002' $$,
  array['pending_approval'::public.request_status],
  'the refused decision leaves the other request untouched'
);

update public.requests set status = 'approved', current_step = 0 where id = '60000000-0000-0000-0000-000000000002';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"74000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_update_request_status('60000000-0000-0000-0000-000000000002', 'in_progress') $$,
  'other approved general requests can still be taken into progress'
);
reset role;

select * from finish();
rollback;
