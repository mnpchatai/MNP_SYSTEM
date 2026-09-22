-- ทดสอบการจัดโมดูล "ใบคำร้องถึงฝ่ายบริหาร" ให้ตรงกับฟอร์ม PP01-FM08:
--   1) สคีมา/ข้อมูลอ้างอิง (enum, คอลัมน์ใหม่, flag, แผนก, ลายเซ็นชื่อฟังก์ชัน)
--   2) สายอนุมัติคงที่ ผู้จัดการโรงงาน -> ผู้จัดการทั่วไป ผ่าน app_create_request
--   3) มติ "รับทราบ" เป็น terminal state ที่ไม่ไปต่อขั้นถัดไป ผ่าน app_approval_decision
--   4) เส้นทางอนุมัติผ่านครบสองขั้นจบที่ approved
begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

-- 1. สคีมา/ข้อมูลอ้างอิง -------------------------------------------------
select ok(
  'acknowledged' = any(enum_range(null::public.approval_status)::text[]),
  'approval_status enum has acknowledged'
);
select ok(
  'acknowledged' = any(enum_range(null::public.request_status)::text[]),
  'request_status enum has acknowledged'
);
select ok(
  (select uses_factory_general_chain from public.request_types where code = 'MANAGEMENT'),
  'MANAGEMENT uses the fixed factory/general approval chain'
);
select ok(
  not (select uses_factory_general_chain from public.request_types where code = 'MT_REPAIR'),
  'MT_REPAIR keeps its own dedicated RPC, not the generic fixed-chain flag'
);
select results_eq(
  $$ select count(*)::bigint from public.departments
     where code in ('PP','MS','PC','BD','SE','AC','EX','SP','SA') and is_active $$,
  array[9::bigint],
  'all 9 PP01-FM08 department codes exist and are active'
);
select results_eq(
  $$ select name_th from public.departments where code = 'FT' $$,
  array['ธุรการ'],
  'FT department renamed to ธุรการ per PP01-FM08'
);
select has_column('public', 'requests', 'cc_department_ids', 'requests has cc_department_ids column');
select col_type_is('public', 'requests', 'cc_department_ids', 'uuid[]', 'cc_department_ids is uuid[]');
select has_function(
  'public', 'app_create_request', array['uuid','text','text','text','jsonb','uuid[]'],
  'app_create_request accepts cc_department_ids'
);

-- 2. เตรียมผู้ใช้ทดสอบ: ผู้ยื่นคำร้อง (พนักงานสาธิตเดิม) + ผจก.โรงงาน/ผจก.ทั่วไป
--    ที่ข้อมูลสาธิตเดิมไม่มีทั้งคู่ จึงต้องสร้างเองในทรานแซกชันนี้ --------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('71000000-0000-0000-0000-000000000001', 'pp01fm08-requester@mnp.local', '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000002', 'pp01fm08-factory@mnp.local', '{}'::jsonb),
  ('71000000-0000-0000-0000-000000000003', 'pp01fm08-general@mnp.local', '{}'::jsonb);

update public.employees
set auth_user_id = '71000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('71000000-0000-0000-0000-000000000004', 'PP01FM08-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'pp01fm08-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000002'),
  ('71000000-0000-0000-0000-000000000005', 'PP01FM08-GM', 'ทดสอบ', 'ผู้จัดการทั่วไป', 'pp01fm08-general@mnp.local', 'ผู้จัดการทั่วไป',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '71000000-0000-0000-0000-000000000003');

insert into public.approval_module_permissions (employee_id, request_type_id) values
  ('71000000-0000-0000-0000-000000000004', (select id from public.request_types where code = 'MANAGEMENT')),
  ('71000000-0000-0000-0000-000000000005', (select id from public.request_types where code = 'MANAGEMENT'));

set local role authenticated;

-- 3. ผู้ยื่นคำร้องสร้างใบคำร้อง #1 พร้อมสำเนาถึงแผนก (ทดสอบเส้นทาง "รับทราบ") ----
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'PP01FM08_TEST_ACK',
       'รายละเอียดทดสอบสายอนุมัติ PP01-FM08',
       'normal',
       '{}'::jsonb,
       array(select id from public.departments where code in ('QA','MT'))
     ) $$,
  'requester can create a MANAGEMENT request with valid cc departments'
);

select results_eq(
  $$ select status, current_step from public.requests where title = 'PP01FM08_TEST_ACK' $$,
  $$ values ('pending_approval'::public.request_status, 1) $$,
  'new MANAGEMENT request starts pending_approval at step 1'
);

select results_eq(
  $$ select s.step_order, s.step_name from public.approval_steps s
     join public.requests r on r.id = s.request_id
     where r.title = 'PP01FM08_TEST_ACK'
     order by s.step_order $$,
  $$ values (1, 'ผู้จัดการโรงงาน'::text), (2, 'ผู้จัดการทั่วไป'::text) $$,
  'fixed chain creates factory manager then general manager steps in order'
);

select results_eq(
  $$ select d.code from public.departments d
     join public.requests r on d.id = any(r.cc_department_ids)
     where r.title = 'PP01FM08_TEST_ACK'
     order by d.code $$,
  array['MT','QA'],
  'cc_department_ids stores the selected departments'
);

select throws_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'PP01FM08_TEST_INVALID_CC',
       'ต้องถูกปฏิเสธเพราะแผนกไม่ถูกต้อง',
       'normal',
       '{}'::jsonb,
       array['00000000-0000-0000-0000-000000000000'::uuid]
     ) $$,
  'P0001',
  null,
  'invalid cc department id is rejected'
);

-- 4. ผจก.โรงงาน กด "รับทราบข้อมูล" — ต้องปิดคำร้องทันทีโดยไม่ไปขั้นถัดไป --------
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s
        join public.requests r on r.id = s.request_id
        where r.title = 'PP01FM08_TEST_ACK' and s.step_order = 1),
       'acknowledged',
       'รับทราบข้อมูลตามฟอร์ม PP01-FM08'
     ) $$,
  'factory manager can record มติ รับทราบ on step 1'
);

select results_eq(
  $$ select status, current_step from public.requests where title = 'PP01FM08_TEST_ACK' $$,
  $$ values ('acknowledged'::public.request_status, 1) $$,
  'request closes as acknowledged without advancing current_step'
);

select results_eq(
  $$ select s.status from public.approval_steps s
     join public.requests r on r.id = s.request_id
     where r.title = 'PP01FM08_TEST_ACK' and s.step_order = 2 $$,
  array['pending'::public.approval_status],
  'step 2 (general manager) stays pending — acknowledged does not cascade'
);

-- 5. เส้นทางอนุมัติครบสองขั้นของอีกใบหนึ่ง จบที่ approved -----------------------
select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'PP01FM08_TEST_FULL',
       'รายละเอียดทดสอบเส้นทางอนุมัติครบสองขั้น',
       'normal',
       '{}'::jsonb,
       '{}'::uuid[]
     ) $$,
  'requester can create a second MANAGEMENT request without cc departments'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s
        join public.requests r on r.id = s.request_id
        where r.title = 'PP01FM08_TEST_FULL' and s.step_order = 1),
       'approved',
       null
     ) $$,
  'factory manager approves step 1 of the second request'
);

select results_eq(
  $$ select status, current_step from public.requests where title = 'PP01FM08_TEST_FULL' $$,
  $$ values ('pending_approval'::public.request_status, 2) $$,
  'request advances to step 2 (general manager) after factory approval'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"71000000-0000-0000-0000-000000000003","role":"authenticated"}',
  true
);

select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s
        join public.requests r on r.id = s.request_id
        where r.title = 'PP01FM08_TEST_FULL' and s.step_order = 2),
       'approved',
       null
     ) $$,
  'general manager approves step 2 of the second request'
);

select results_eq(
  $$ select status, current_step from public.requests where title = 'PP01FM08_TEST_FULL' $$,
  $$ values ('approved'::public.request_status, 0) $$,
  'request is fully approved once both fixed-chain steps are done'
);

select * from finish();
rollback;
