-- ทดสอบ "บทบาทที่ทำหน้าที่" (employees.acting_role_id) ของบัญชี admin:
--   1) สคีมาและข้อบังคับ (มีค่าได้เฉพาะ admin, ห้ามชี้ไปที่ admin, ล้างเองเมื่อออกจาก admin)
--   2) สิทธิ์ตั้งค่า: เฉพาะผู้มี accounts.manage ตั้งให้บัญชี admin ผ่าน RPC แก้คอลัมน์ตรงไม่ได้
--   3) สายอนุมัติ ผจก.โรงงาน -> ผจก.ทั่วไป นับ admin ที่เลือกทำหน้าที่ ผจก.ทั่วไป เป็นผู้ถือบทบาท
--   4) แจ้งเตือนขั้นอนุมัติถึง admin ที่เลือกบทบาทนั้น และไม่ถึง admin ที่ไม่ได้เลือก
--   5) admin ที่เลือกบทบาทอื่นไม่ได้รับแจ้งเตือนเฉพาะผู้ดูแลระบบ (คำร้องแก้ไข ID/รหัสผ่าน)
begin;

create extension if not exists pgtap with schema extensions;
select plan(23);

-- 1. สคีมา -------------------------------------------------------------------
select has_column('public', 'employees', 'acting_role_id', 'employees has acting_role_id');
select has_function('public', 'app_admin_set_acting_role', array['uuid','uuid'], 'app_admin_set_acting_role exists');
select hasnt_function('public', 'app_set_my_acting_role', array['uuid'], 'the self-service app_set_my_acting_role is gone');

-- 2. เตรียมผู้ใช้: ผู้ยื่นคำร้อง (พนักงานสาธิต), ผจก.โรงงาน, admin ที่จะทำหน้าที่ ผจก.ทั่วไป,
--    และ admin สาธิตเดิมที่ไม่ได้เลือกบทบาท ข้อมูลสาธิตไม่มี ผจก.ทั่วไป ตัวจริงเลย ---------
insert into auth.users (id, email, raw_user_meta_data) values
  ('72000000-0000-0000-0000-000000000001', 'acting-requester@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000002', 'acting-factory@mnp.local', '{}'::jsonb),
  ('72000000-0000-0000-0000-000000000003', 'acting-gm-admin@mnp.local', '{}'::jsonb);

update public.employees
set auth_user_id = '72000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('72000000-0000-0000-0000-000000000004', 'ACTING-FM', 'ทดสอบ', 'ผู้จัดการโรงงาน', 'acting-factory@mnp.local', 'ผู้จัดการโรงงาน',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000002'),
  ('72000000-0000-0000-0000-000000000005', 'ACTING-GM', 'ทดสอบ', 'ผู้จัดการทั่วไป', 'acting-gm-admin@mnp.local', 'ผู้จัดการทั่วไป',
   '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000003');

insert into public.approval_module_permissions (employee_id, request_type_id)
select e.id, t.id
from (values ('72000000-0000-0000-0000-000000000004'::uuid), ('72000000-0000-0000-0000-000000000005'::uuid)) e(id)
cross join public.request_types t
where t.code in ('MANAGEMENT', 'MT_REPAIR');

-- ข้อบังคับ: บัญชีที่ไม่ใช่ admin ถือค่านี้ไม่ได้ (trigger ล้างทิ้ง)
update public.employees
set acting_role_id = '20000000-0000-0000-0000-000000000006'
where id = '50000000-0000-0000-0000-000000000003';
select is(
  (select acting_role_id from public.employees where id = '50000000-0000-0000-0000-000000000003'),
  null::uuid,
  'a non-admin employee cannot hold an acting role'
);

-- ไม่มี foreign key (ดูเหตุผลใน migration) จึงต้องปฏิเสธ role ที่ไม่มีอยู่จริงด้วย trigger
update public.employees
set acting_role_id = '00000000-0000-0000-0000-00000000dead'
where id = '72000000-0000-0000-0000-000000000005';
select is(
  (select acting_role_id from public.employees where id = '72000000-0000-0000-0000-000000000005'),
  null::uuid,
  'an acting role that does not exist is cleared'
);

set local role authenticated;

-- 3. สิทธิ์ตั้งค่า ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_admin_set_acting_role('72000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006') $$,
  'NOT_AUTHORIZED',
  'an account without accounts.manage cannot set an acting role'
);
select throws_ok(
  $$ update public.employees set acting_role_id = '20000000-0000-0000-0000-000000000006'
     where id = '72000000-0000-0000-0000-000000000005' $$,
  '42501',
  null,
  'acting_role_id cannot be written directly through the Data API'
);

-- ก่อนเลือกบทบาท: ไม่มีใครถือ ผจก.ทั่วไป แต่สายอนุมัติยังต้องมีครบสองขั้น
-- (ไม่ข้ามขั้นแบบเงียบๆ อีกต่อไป ดู 20261003030000_never_skip_factory_general_approval_steps.sql)
select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'ACTING_BEFORE', 'ก่อนเลือกบทบาท ผจก.ทั่วไป', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'requester creates a management request before any acting role is set'
);
reset role;
select results_eq(
  $$ select s.step_name from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.title = 'ACTING_BEFORE' order by s.step_order $$,
  array['ผู้จัดการโรงงาน', 'ผู้จัดการทั่วไป'],
  'without a general manager the chain still keeps the general manager step'
);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_admin_set_acting_role('72000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000004') $$,
  'INVALID_ROLE',
  'an admin cannot pick the admin role itself as the acting role'
);
select throws_ok(
  $$ select public.app_admin_set_acting_role('72000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-00000000dead') $$,
  'INVALID_ROLE',
  'an unknown role is rejected'
);
select throws_ok(
  $$ select public.app_admin_set_acting_role('50000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000006') $$,
  'TARGET_NOT_ADMIN',
  'an acting role can only be set on an admin account'
);
select lives_ok(
  $$ select public.app_admin_set_acting_role('72000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000006') $$,
  'an admin sets an admin account to act as general manager from the admin page'
);
select is(
  (select acting_role_id from public.employees where id = '72000000-0000-0000-0000-000000000005'),
  '20000000-0000-0000-0000-000000000006'::uuid,
  'the acting role is stored on the target admin row'
);

-- 4. สายอนุมัติ + แจ้งเตือน ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_create_request(
       (select id from public.request_types where code = 'MANAGEMENT'),
       'ACTING_AFTER', 'หลังเลือกบทบาท ผจก.ทั่วไป', 'normal', '{}'::jsonb, '{}'::uuid[]) $$,
  'requester creates a management request after the acting role is set'
);
select lives_ok(
  $$ select public.app_create_repair_request(
       (select m.department_id from public.machines m join public.departments d on d.id = m.department_id
        where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
       (select m.id from public.machines m join public.departments d on d.id = m.department_id
        where m.is_active and d.is_active and d.is_repair_site order by m.code limit 1),
       'repair', 'ACTING_REPAIR ทดสอบสายอนุมัติใบแจ้งซ่อม') $$,
  'requester creates a repair request after the acting role is set'
);
reset role;
select results_eq(
  $$ select s.step_name from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.title = 'ACTING_AFTER' order by s.step_order $$,
  array['ผู้จัดการโรงงาน', 'ผู้จัดการทั่วไป'],
  'an admin acting as general manager restores the general manager step (management)'
);
select results_eq(
  $$ select s.step_name from public.approval_steps s join public.requests r on r.id = s.request_id
     where r.description like 'ACTING_REPAIR%' order by s.step_order $$,
  array['ผู้จัดการโรงงาน', 'ผู้จัดการทั่วไป'],
  'an admin acting as general manager restores the general manager step (repair)'
);
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_approval_decision(
       (select s.id from public.approval_steps s join public.requests r on r.id = s.request_id
        where r.title = 'ACTING_AFTER' and s.step_order = 1),
       'approved', null) $$,
  'factory manager approves step 1'
);
reset role;
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'ACTING_AFTER' and n.title = 'มีคำร้องรออนุมัติ'
     and n.recipient_id = '72000000-0000-0000-0000-000000000005'),
  1,
  'the admin acting as general manager is notified of the general manager step'
);
select is(
  (select count(*)::int from public.notifications n join public.requests r on r.id = n.request_id
   where r.title = 'ACTING_AFTER' and n.recipient_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'an admin without an acting role is not notified of role-based steps'
);

-- 5. แจ้งเตือนเฉพาะผู้ดูแลระบบ ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"72000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_request_credential_change('', 'acting-role-pass-1', 'ทดสอบแจ้งเตือนผู้ดูแลระบบ');
reset role;
select results_eq(
  $$ select n.recipient_id from public.notifications n
     where n.title = 'มีคำร้องขอแก้ไข ID/รหัสผ่าน'
       and n.recipient_id in ('50000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000005')
     order by n.recipient_id $$,
  array['50000000-0000-0000-0000-000000000001'::uuid],
  'account notifications reach full admins but not an admin acting as another role'
);

-- 6. ออกจาก role admin แล้วค่าต้องหายไปเอง --------------------------------------
update public.employees
set role_id = '20000000-0000-0000-0000-000000000006'
where id = '72000000-0000-0000-0000-000000000005';
select is(
  (select acting_role_id from public.employees where id = '72000000-0000-0000-0000-000000000005'),
  null::uuid,
  'changing the account away from admin clears the acting role'
);

select * from finish();
rollback;
