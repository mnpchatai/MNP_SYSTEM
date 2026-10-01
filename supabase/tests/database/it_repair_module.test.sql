-- ทดสอบการเปิดใช้โมดูล "ใบแจ้งซ่อม IT" (IT_REPAIR) ด้วย flow คำร้องทั่วไป
-- (20261001050000_enable_it_repair_module.sql):
--   1) ข้อมูลอ้างอิงของประเภทคำร้อง
--   2) สร้างผ่าน app_create_request -> หัวหน้าแผนกผู้แจ้ง -> ผู้จัดการแผนก IT
--   3) สิทธิ์อนุมัติ: ห้ามผู้จัดการแผนกอื่น ห้ามผู้จัดการแผนก IT ที่ไม่มีสิทธิ์โมดูล
--   4) อนุมัติครบสองขั้นจบที่ approved
begin;

create extension if not exists pgtap with schema extensions;
select plan(19);

-- 1. ข้อมูลอ้างอิง ---------------------------------------------------------
select results_eq(
  $$ select is_active, uses_repair_workflow, uses_factory_general_chain, requires_manager_approval, prefix
     from public.request_types where code = 'IT_REPAIR' $$,
  $$ values (true, false, false, true, 'IT'::text) $$,
  'IT_REPAIR is active and uses the general approval flow'
);
select is(
  (select d.code from public.request_types t join public.departments d on d.id = t.owning_department_id where t.code = 'IT_REPAIR'),
  'IT',
  'IT_REPAIR is owned by the IT department'
);
select is(
  (select r.code from public.request_types t join public.roles r on r.id = t.final_approver_role_id where t.code = 'IT_REPAIR'),
  'department_manager',
  'IT_REPAIR final approver is the department manager role'
);
select is(
  (select form_schema from public.request_types where code = 'IT_REPAIR'),
  '{"fields":["asset_code","location","impact"]}'::jsonb,
  'IT_REPAIR form fields match the module file'
);

-- 2. ผู้ใช้ทดสอบ: ผู้แจ้ง (พนักงานสาธิต) + หัวหน้าของผู้แจ้ง (ผู้จัดการแผนกสาธิต)
--    + ผู้จัดการแผนก IT ที่มีสิทธิ์โมดูล + ผู้จัดการแผนก IT อีกคนที่ไม่มีสิทธิ์โมดูล -----
insert into auth.users (id, email, raw_user_meta_data) values
  ('72000000-0000-0000-0000-000000000001', 'itrepair-requester@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000002', 'itrepair-manager@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000003', 'itrepair-it-manager@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000004', 'itrepair-it-manager-no-module@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '72000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';
update public.employees set auth_user_id = '72000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000002';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('72000000-0000-0000-0000-000000000013', 'ITREPAIR-ITM', 'ทดสอบ', 'ผจก.IT', 'itrepair-it-manager@mnp.local', 'ผู้จัดการแผนก IT',
   (select id from public.departments where code = 'IT'), (select id from public.roles where code = 'department_manager'),
   '72000000-0000-0000-0000-000000000003'),
  ('72000000-0000-0000-0000-000000000014', 'ITREPAIR-ITM2', 'ทดสอบ', 'ผจก.IT ไม่มีสิทธิ์โมดูล', 'itrepair-it-manager-no-module@mnp.local', 'ผู้จัดการแผนก IT',
   (select id from public.departments where code = 'IT'), (select id from public.roles where code = 'department_manager'),
   '72000000-0000-0000-0000-000000000004');

-- ผู้จัดการแผนกสาธิต (คนละแผนกกับ IT) ได้สิทธิ์โมดูลด้วย เพื่อพิสูจน์ว่าถูกกันด้วยแผนก ไม่ใช่สิทธิ์โมดูล
insert into public.approval_module_permissions (employee_id, request_type_id) values
  ('72000000-0000-0000-0000-000000000013', (select id from public.request_types where code = 'IT_REPAIR')),
  ('50000000-0000-0000-0000-000000000002', (select id from public.request_types where code = 'IT_REPAIR'))
on conflict do nothing;

set local role authenticated;

-- 3. สร้างใบแจ้งซ่อม IT -------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'IT_REPAIR'),
       'ITREPAIR_TEST_ANON', 'ต้องถูกปฏิเสธเพราะไม่ได้เข้าสู่ระบบ', 'normal', '{}'::jsonb, '{}'::uuid[]
     ) $$,
  'AUTH_REQUIRED',
  'creating an IT repair request requires a signed-in user'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select matches(
  public.app_peek_request_number((select id from public.request_types where code = 'IT_REPAIR')),
  '^IT-[0-9]{4}-[0-9]{6}$',
  'peeked IT repair number uses the IT-YYYY-NNNNNN format'
);

select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'IT_REPAIR'),
       'ITREPAIR_TEST_FULL',
       'คอมพิวเตอร์เปิดไม่ติด',
       'high',
       '{"asset_code":"NB-0123","location":"ฝ่ายบัญชี","impact":"ใช้งานไม่ได้ 1 คน"}'::jsonb,
       '{}'::uuid[]
     ) $$,
  'requester can create an IT repair request'
);

select results_eq(
  $$ select status, current_step, priority::text, details->>'asset_code'
     from public.requests where title = 'ITREPAIR_TEST_FULL' $$,
  $$ values ('pending_approval'::public.request_status, 1, 'high'::text, 'NB-0123'::text) $$,
  'new IT repair request starts pending_approval at step 1 with its details'
);

select results_eq(
  $$ select s.step_order, s.step_name, s.approver_employee_id, d.code
     from public.approval_steps s
     join public.requests r on r.id = s.request_id
     left join public.departments d on d.id = s.approver_department_id
     where r.title = 'ITREPAIR_TEST_FULL'
     order by s.step_order $$,
  $$ values
       (1, 'หัวหน้าแผนก'::text, '50000000-0000-0000-0000-000000000002'::uuid, null::text),
       (2, 'ผู้อนุมัติหน่วยงานรับผิดชอบ'::text, null::uuid, 'IT'::text) $$,
  'IT repair goes to the requester''s manager, then the IT department manager'
);

-- 4. ขั้น 1: หัวหน้าแผนกผู้แจ้งอนุมัติ ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 1),
       'approved', null) $$,
  'NOT_AUTHORIZED',
  'the IT manager cannot approve the requester''s manager step'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 1),
       'approved', null) $$,
  'the requester''s manager approves step 1'
);
select results_eq(
  $$ select status, current_step from public.requests where title = 'ITREPAIR_TEST_FULL' $$,
  $$ values ('pending_approval'::public.request_status, 2) $$,
  'request advances to the IT department manager step'
);

-- 5. ขั้น 2: ต้องเป็นผู้จัดการแผนก IT ที่มีสิทธิ์โมดูลเท่านั้น -------------------
select throws_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 2),
       'approved', null) $$,
  'NOT_AUTHORIZED',
  'a department manager of another department cannot approve the IT step'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 2),
       'approved', null) $$,
  'NOT_AUTHORIZED',
  'an IT department manager without the IT_REPAIR module permission cannot approve'
);
-- ผู้จัดการแผนกเจ้าของประเภทเอกสารยังเห็นใบได้ (20260921040000_owning_department_manager_access)
-- แต่การกดอนุมัติต้องมีสิทธิ์โมดูลด้วยตามที่ทดสอบข้างบน
select is(
  (select count(*)::int from public.requests where title = 'ITREPAIR_TEST_FULL'),
  1,
  'an IT department manager without the module permission can still view the request as owning department manager'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.requests where title = 'ITREPAIR_TEST_FULL'),
  1,
  'the IT department manager with the module permission can see the request'
);
select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 2),
       'approved', 'รับเรื่องแล้ว') $$,
  'the IT department manager approves step 2'
);
select results_eq(
  $$ select status from public.requests where title = 'ITREPAIR_TEST_FULL' $$,
  array['approved'::public.request_status],
  'IT repair request ends approved after both steps'
);
select throws_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ITREPAIR_TEST_FULL' and s.step_order = 2),
       'approved', null) $$,
  'STEP_NOT_PENDING',
  'an already decided IT step cannot be approved again'
);

select * from finish();
rollback;
