-- ทดสอบเส้นทาง "อนุมัติที่เลือก" ในหน้ารออนุมัติของ Pilot Web (PR #285):
-- app.js เรียก public.app_approval_decision(step_id, 'approved', '') ทีละขั้นตามลำดับ ไม่มีฟังก์ชัน bulk แยก
-- ทดสอบนี้จำลองลูปของ RPC นั้น (ทุกครั้งที่เรียกเป็น transaction ของตัวเองผ่าน PostgREST ที่นี่ใช้ savepoint
-- ของ pgTAP แทน) ไม่ได้ตรวจโค้ดฝั่ง app.js และยืนยันว่าร่องรอยตรวจสอบของลูปเหมือนการกดอนุมัติทีละใบ:
--   1) ทุกขั้นที่อนุมัติบันทึก acted_by/acted_at และแถว audit_logs ของ approval_steps และ requests โดยผู้กด
--   2) ขั้นสุดท้ายเขียน request_status_history หนึ่งแถวต่อใบ (pending_approval -> approved) และแจ้งผู้ยื่น
--      ขั้นกลางไม่เปลี่ยนสถานะจึงไม่มีแถวประวัติ (เหมือนทางเดี่ยว) แต่แจ้งผู้อนุมัติขั้นถัดไปทุกใบ
--   3) รายการที่ล้มกลางชุดไม่ทำให้ใบอื่นถอย และใบที่ล้มไม่มีร่องรอยการอนุมัติ
--   4) ห้าม: ผู้ไม่มีสิทธิ์โมดูล, ขั้นที่ไม่ใช่ขั้นปัจจุบัน, กดซ้ำ (รายการเก่าในหน้าจอ), ผู้ไม่ได้เข้าสู่ระบบ
--   5) หมายเหตุว่างใช้ได้กับ "อนุมัติ" เท่านั้น ส่วน "ไม่อนุมัติ" ยังต้องมีเหตุผล
--   6) ฟังก์ชันเป็น security definer, search_path คงที่ และ execute ได้เฉพาะ authenticated
begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

-- ผู้ยื่น (พนักงานสาธิต), หัวหน้าของผู้ยื่น (ผู้จัดการแผนกสาธิต, ขั้น 1 ผูกตัวบุคคล)
-- ผู้จัดการแผนก IT ที่มีสิทธิ์โมดูล IT_REPAIR และอีกคนที่ไม่มี (ขั้น 2 ผูกบทบาท + แผนก)
insert into auth.users (id, email, raw_user_meta_data) values
  ('7b000000-0000-0000-0000-000000000001', 'bulk-requester@mnp.local', '{}'::jsonb),
  ('7b000000-0000-0000-0000-000000000002', 'bulk-manager@mnp.local', '{}'::jsonb),
  ('7b000000-0000-0000-0000-000000000003', 'bulk-it-manager@mnp.local', '{}'::jsonb),
  ('7b000000-0000-0000-0000-000000000004', 'bulk-it-manager-no-module@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '7b000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '7b000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000002';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('7b000000-0000-0000-0000-000000000013', 'BULK-ITM', 'ทดสอบ', 'ผจก.IT', 'bulk-it-manager@mnp.local', 'ผู้จัดการแผนก IT',
   (select id from public.departments where code = 'IT'), (select id from public.roles where code = 'department_manager'),
   '7b000000-0000-0000-0000-000000000003'),
  ('7b000000-0000-0000-0000-000000000014', 'BULK-ITM2', 'ทดสอบ', 'ผจก.IT ไม่มีสิทธิ์โมดูล', 'bulk-it-manager-no-module@mnp.local', 'ผู้จัดการแผนก IT',
   (select id from public.departments where code = 'IT'), (select id from public.roles where code = 'department_manager'),
   '7b000000-0000-0000-0000-000000000004');

insert into public.approval_module_permissions (employee_id, request_type_id) values
  ('7b000000-0000-0000-0000-000000000013', (select id from public.request_types where code = 'IT_REPAIR'))
on conflict do nothing;

-- ตัวช่วยหา id อ่านในสิทธิ์ของผู้รันทดสอบ (ไม่ติด RLS) ให้คำปฏิเสธมาจากการตรวจใน RPC ไม่ใช่เพราะมองไม่เห็นแถว
create function pg_temp.step_id(p_title text, p_order integer) returns uuid
language sql security definer set search_path = '' as $$
  select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
  where r.title = p_title and s.step_order = p_order
$$;
grant execute on function pg_temp.step_id(text, integer) to authenticated;

-- 1. ผู้ยื่นสร้างใบแจ้งซ่อม IT ห้าใบ ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_create_request(
  (select id from public.request_types where code = 'IT_REPAIR'), t.title, 'อนุมัติหลายรายการ', 'normal',
  '{"asset_code":"NB-0001","location":"ฝ่ายบัญชี","impact":"ใช้งานไม่ได้ 1 คน"}'::jsonb, '{}'::uuid[])
from (values ('BULK_A'), ('BULK_B'), ('BULK_C'), ('BULK_NOPERM'), ('BULK_EARLY')) t(title);
reset role;

create temp table bulk_it_manager_notifications_before as
select count(*)::int as n from public.notifications
where recipient_id = '7b000000-0000-0000-0000-000000000013'
  and request_id in (select id from public.requests where title like 'BULK\_%');

-- 2. หัวหน้าแผนกอนุมัติขั้น 1 ทีละใบ (ลูปเดียวกับ app.js หมายเหตุว่าง) -----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_A', 1), 'approved', '') $$,
  'AUTH_REQUIRED',
  'a caller without a session cannot approve'
);

select set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_A', 1), 'approved', '') $$, 'bulk: manager approves step 1 of BULK_A');
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_B', 1), 'approved', '') $$, 'bulk: manager approves step 1 of BULK_B');
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_C', 1), 'approved', '') $$, 'bulk: manager approves step 1 of BULK_C');
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_NOPERM', 1), 'approved', '') $$, 'bulk: manager approves step 1 of BULK_NOPERM');
reset role;

select results_eq(
  $$ select title, status, current_step from public.requests
     where title in ('BULK_A', 'BULK_B', 'BULK_C', 'BULK_NOPERM', 'BULK_EARLY') order by title $$,
  $$ values ('BULK_A'::text, 'pending_approval'::public.request_status, 2),
            ('BULK_B', 'pending_approval', 2),
            ('BULK_C', 'pending_approval', 2),
            ('BULK_EARLY', 'pending_approval', 1),
            ('BULK_NOPERM', 'pending_approval', 2) $$,
  'every approved request moves to step 2; the request left out of the batch stays at step 1'
);
select is(
  (select count(*)::int from public.approval_steps s join public.requests r on r.id = s.request_id
   where r.title in ('BULK_A', 'BULK_B', 'BULK_C', 'BULK_NOPERM') and s.step_order = 1
     and s.status = 'approved' and s.acted_by = '50000000-0000-0000-0000-000000000002'
     and s.acted_at is not null and s.comment is null),
  4,
  'each step 1 records who approved and when, and an empty comment is stored as null'
);
select is(
  (select count(*)::int from public.audit_logs a
   where a.entity_type = 'approval_steps' and a.action = 'UPDATE'
     and a.actor_id = '50000000-0000-0000-0000-000000000002'
     and a.metadata->'old'->>'status' = 'pending' and a.metadata->'new'->>'status' = 'approved'
     and (a.metadata->'new'->>'request_id')::uuid in (select id from public.requests where title like 'BULK\_%')),
  4,
  'each step 1 approval writes one approval_steps audit row attributed to the approver'
);
select is(
  (select count(*)::int from public.audit_logs a
   where a.entity_type = 'requests' and a.action = 'UPDATE'
     and a.actor_id = '50000000-0000-0000-0000-000000000002'
     and a.metadata->'old'->>'current_step' = '1' and a.metadata->'new'->>'current_step' = '2'
     and a.entity_id in (select id::text from public.requests where title like 'BULK\_%')),
  4,
  'each step 1 approval writes one requests audit row for the move to step 2'
);
select is(
  (select count(*)::int from public.request_status_history h join public.requests r on r.id = h.request_id
   where r.title like 'BULK\_%' and h.from_status is not null),
  0,
  'an intermediate approval does not change the status, so no status history row (same as a single approval)'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '7b000000-0000-0000-0000-000000000013'
     and request_id in (select id from public.requests where title like 'BULK\_%'))
  - (select n from bulk_it_manager_notifications_before),
  4,
  'the next approver is notified once for every request the batch moved to step 2'
);

-- 3. ผู้จัดการแผนก IT ไม่มีสิทธิ์โมดูล -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_NOPERM', 2), 'approved', '') $$,
  'NOT_AUTHORIZED',
  'bulk: an IT manager without the IT_REPAIR module permission cannot approve'
);

-- 4. ผู้จัดการแผนก IT ที่มีสิทธิ์ อนุมัติขั้น 2 เป็นชุด มีรายการที่ล้มอยู่กลางชุด ------------------
select set_config('request.jwt.claims', '{"sub":"7b000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_A', 2), 'approved', '') $$, 'bulk: IT manager approves BULK_A');
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_EARLY', 2), 'approved', '') $$,
  'STEP_NOT_CURRENT',
  'bulk: a pending step that is not the request''s current step is refused'
);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_B', 1), 'approved', '') $$,
  'STEP_NOT_PENDING',
  'bulk: a step already decided (stale list) is refused'
);
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_B', 2), 'approved', '') $$, 'bulk: IT manager approves BULK_B after a failure');
select lives_ok($$ select public.app_approval_decision(pg_temp.step_id('BULK_C', 2), 'approved', '') $$, 'bulk: IT manager approves BULK_C');
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_A', 2), 'approved', '') $$,
  'STEP_NOT_PENDING',
  'bulk: approving the same step twice (double click or retry) is refused'
);
select throws_ok(
  $$ select public.app_approval_decision(pg_temp.step_id('BULK_NOPERM', 2), 'rejected', '') $$,
  'COMMENT_REQUIRED',
  'an empty comment is accepted only for approval; a rejection still needs a reason'
);
reset role;

select results_eq(
  $$ select title, status, current_step, approved_at is not null from public.requests
     where title in ('BULK_A', 'BULK_B', 'BULK_C', 'BULK_NOPERM', 'BULK_EARLY') order by title $$,
  $$ values ('BULK_A'::text, 'approved'::public.request_status, 0, true),
            ('BULK_B', 'approved', 0, true),
            ('BULK_C', 'approved', 0, true),
            ('BULK_EARLY', 'pending_approval', 1, false),
            ('BULK_NOPERM', 'pending_approval', 2, false) $$,
  'failures in the middle of the batch do not undo or block the other approvals'
);
select results_eq(
  $$ select r.title, h.from_status, h.to_status, h.changed_by, h.note
     from public.request_status_history h join public.requests r on r.id = h.request_id
     where r.title like 'BULK\_%' and h.from_status is not null order by r.title $$,
  $$ values ('BULK_A'::text, 'pending_approval'::public.request_status, 'approved'::public.request_status, '7b000000-0000-0000-0000-000000000013'::uuid, null::text),
            ('BULK_B', 'pending_approval', 'approved', '7b000000-0000-0000-0000-000000000013', null),
            ('BULK_C', 'pending_approval', 'approved', '7b000000-0000-0000-0000-000000000013', null) $$,
  'each final approval writes exactly one status history row attributed to the approver; refused requests write none'
);
select is(
  (select count(*)::int from public.approval_steps s join public.requests r on r.id = s.request_id
   where r.title in ('BULK_A', 'BULK_B', 'BULK_C') and s.step_order = 2
     and s.status = 'approved' and s.acted_by = '7b000000-0000-0000-0000-000000000013' and s.acted_at is not null),
  3,
  'each final step records who approved and when'
);
select is(
  (select count(*)::int from public.approval_steps s join public.requests r on r.id = s.request_id
   where r.title in ('BULK_EARLY', 'BULK_NOPERM') and s.step_order = 2
     and (s.status <> 'pending' or s.acted_by is not null or s.comment is not null)),
  0,
  'refused steps keep no decision, approver or comment'
);
select is(
  (select count(*)::int from public.audit_logs a
   where a.entity_type = 'approval_steps' and a.action = 'UPDATE'
     and a.actor_id = '7b000000-0000-0000-0000-000000000013'
     and a.metadata->'new'->>'status' = 'approved'),
  3,
  'each final approval writes one approval_steps audit row, refused calls write none'
);
select is(
  (select count(*)::int from public.audit_logs a
   where a.entity_type = 'requests' and a.action = 'UPDATE'
     and a.actor_id = '7b000000-0000-0000-0000-000000000013'
     and a.metadata->'old'->>'status' = 'pending_approval' and a.metadata->'new'->>'status' = 'approved'),
  3,
  'each final approval writes one requests audit row for the status change'
);
select is(
  (select count(*)::int from public.audit_logs a
   where a.actor_id = '7b000000-0000-0000-0000-000000000014'
     or (a.entity_type = 'approval_steps' and a.action = 'UPDATE'
         and a.entity_id in (pg_temp.step_id('BULK_EARLY', 2)::text, pg_temp.step_id('BULK_NOPERM', 2)::text))),
  0,
  'refused calls leave no audit rows'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '50000000-0000-0000-0000-000000000003'
     and request_id in (select id from public.requests where title in ('BULK_A', 'BULK_B', 'BULK_C'))
     and body like '% เปลี่ยนเป็น %'),
  3,
  'the requester is notified once for every approved request (the email queue reads these rows)'
);

-- 5. สัญญาของฟังก์ชัน ---------------------------------------------------------------------
select ok(
  (select p.prosecdef and p.proconfig @> array['search_path=""']
   from pg_proc p where p.oid = 'public.app_approval_decision(uuid, text, text)'::regprocedure),
  'app_approval_decision is security definer with a fixed empty search_path'
);
select ok(
  has_function_privilege('authenticated', 'public.app_approval_decision(uuid, text, text)', 'execute'),
  'authenticated can execute app_approval_decision'
);
select ok(
  not has_function_privilege('anon', 'public.app_approval_decision(uuid, text, text)', 'execute'),
  'anon cannot execute app_approval_decision'
);

select * from finish();
rollback;
