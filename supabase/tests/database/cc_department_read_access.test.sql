-- ทดสอบสิทธิ์อ่านของแผนกที่ถูกติ๊ก "สำเนาถึงแผนก" (private.can_access_request ผ่าน RLS ของ requests)
--   - อ่านไม่ได้ระหว่างรออนุมัติ
--   - อ่านได้เมื่ออนุมัติครบ และยังอ่านได้หลังเดินสถานะต่อเป็น in_progress / completed
--     (บั๊กเดิม: อ่านได้เฉพาะ approved ลิงก์ในอีเมล "ได้รับสำเนาคำร้อง" จึงเปิดไม่ได้)
--   - แผนกที่ไม่ได้ถูกสำเนาอ่านไม่ได้ และใบที่ถูกยกเลิกไม่เปิดให้แผนกที่ถูกสำเนา
begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

-- ผู้ยื่น (พนักงานสาธิต) + ผจก.โรงงาน/ผจก.ทั่วไป + พนักงานแผนก QA (ถูกสำเนา) + พนักงานแผนก MT (ไม่ถูกสำเนา)
insert into auth.users (id, email, raw_user_meta_data) values
  ('72000000-0000-0000-0000-000000000001', 'cc-requester@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000002', 'cc-factory@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000003', 'cc-general@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000004', 'cc-qa@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000005', 'cc-mt@mnp.local', '{}'::jsonb);

update public.employees
set auth_user_id = '72000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('72000000-0000-0000-0000-000000000014', 'CC-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'cc-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000002'),
  ('72000000-0000-0000-0000-000000000015', 'CC-GM', 'ทดสอบ', 'ผู้จัดการทั่วไป', 'cc-general@mnp.local', 'ผู้จัดการทั่วไป',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000003'),
  ('72000000-0000-0000-0000-000000000016', 'CC-QA', 'ทดสอบ', 'แผนกที่ถูกสำเนา', 'cc-qa@mnp.local', 'พนักงาน',
   (select id from public.departments where code = 'QA'), '20000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000004'),
  ('72000000-0000-0000-0000-000000000017', 'CC-MT', 'ทดสอบ', 'แผนกที่ไม่ถูกสำเนา', 'cc-mt@mnp.local', 'พนักงาน',
   (select id from public.departments where code = 'MT'), '20000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000005');

insert into public.approval_module_permissions (employee_id, request_type_id) values
  ('72000000-0000-0000-0000-000000000014', (select id from public.request_types where code = 'MANAGEMENT')),
  ('72000000-0000-0000-0000-000000000015', (select id from public.request_types where code = 'MANAGEMENT'));


set local role authenticated;

-- ผู้ยื่นสร้างใบคำร้องถึงฝ่ายบริหาร สำเนาถึงแผนก QA
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'CC_READ_TEST',
       'ทดสอบสิทธิ์อ่านของแผนกที่ถูกสำเนา',
       'normal',
       '{}'::jsonb,
       array(select id from public.departments where code = 'QA')
     ) $$,
  'requester creates a MANAGEMENT request copied to QA'
);

-- ระหว่างรออนุมัติ: แผนกที่ถูกสำเนายังอ่านไม่ได้
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' $$,
  'copied department cannot read the request while it is pending approval'
);

-- อนุมัติครบสองขั้น
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_approval_decision(
  (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
   where r.title = 'CC_READ_TEST' and s.step_order = 1),
  'approved', null);
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.app_approval_decision(
  (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
   where r.title = 'CC_READ_TEST' and s.step_order = 2),
  'approved', null);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' and status = 'approved' $$,
  'copied department can read the request once it is fully approved'
);
select isnt_empty(
  $$ select 1 from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.title = 'CC_READ_TEST' $$,
  'copied department can read the approval steps of the approved request'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' $$,
  'a department that was not copied cannot read the approved request'
);

-- เดินสถานะต่อเป็น in_progress แล้ว completed (จำลองการปรับสถานะหลังอนุมัติ)
reset role;
update public.requests set status = 'in_progress' where title = 'CC_READ_TEST';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' and status = 'in_progress' $$,
  'copied department can still read the request after it moves to in_progress'
);

reset role;
update public.requests set status = 'completed' where title = 'CC_READ_TEST';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' and status = 'completed' $$,
  'copied department can still read the request after it is completed'
);
select isnt_empty(
  $$ select 1 from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.title = 'CC_READ_TEST' $$,
  'copied department can still read the approval steps after completion'
);

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' $$,
  'a department that was not copied still cannot read the completed request'
);

-- ใบที่ถูกยกเลิกไม่เปิดให้แผนกที่ถูกสำเนา
reset role;
update public.requests set status = 'cancelled' where title = 'CC_READ_TEST';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.requests where title = 'CC_READ_TEST' $$,
  'copied department cannot read a cancelled request'
);

select * from finish();
rollback;
