-- Admin เพิ่ม/ลบบัญชี: เฉพาะผู้มีสิทธิ์ accounts.manage, ลบตัวเองไม่ได้, ไม่มีประวัติ → ลบถาวร,
-- มีประวัติ → ปิดใช้งาน ซ่อน และตัดบัญชีล็อกอิน โดยประวัติเดิมยังอยู่ครบ
begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (id, email) values
  ('acac0000-0000-0000-0000-000000000001', 'acadmin@example.com'),
  ('acac0000-0000-0000-0000-000000000002', 'acstaff@example.com'),
  ('acac0000-0000-0000-0000-000000000003', 'acnohist@example.com'),
  ('acac0000-0000-0000-0000-000000000004', 'achist@example.com'),
  ('acac0000-0000-0000-0000-000000000005', 'acnew@example.com');

insert into public.employees (id, auth_user_id, employee_no, first_name, last_name, email, department_id, role_id) values
  ('acbc0000-0000-0000-0000-000000000001', 'acac0000-0000-0000-0000-000000000001', 'ACADMIN', 'ผู้ดูแล', 'ทดสอบ',
   'acadmin@example.com', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004'),
  ('acbc0000-0000-0000-0000-000000000002', 'acac0000-0000-0000-0000-000000000002', 'ACSTAFF', 'พนักงาน', 'ทดสอบ',
   'acstaff@example.com', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('acbc0000-0000-0000-0000-000000000003', 'acac0000-0000-0000-0000-000000000003', 'ACNOHIST', 'ไม่มี', 'ประวัติ',
   'acnohist@example.com', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('acbc0000-0000-0000-0000-000000000004', 'acac0000-0000-0000-0000-000000000004', 'ACHIST', 'มี', 'ประวัติ',
   'achist@example.com', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

-- ของที่เป็นของบัญชีเอง (ไม่ถือเป็นประวัติ) และประวัติจริงหนึ่งรายการของ ACHIST
insert into public.account_credentials (employee_id, username, password) values
  ('acbc0000-0000-0000-0000-000000000003', 'ACNOHIST', 'password-nohist'),
  ('acbc0000-0000-0000-0000-000000000004', 'ACHIST', 'password-hist');
insert into public.notifications (recipient_id, title, body) values
  ('acbc0000-0000-0000-0000-000000000003', 'ทดสอบ', 'ทดสอบ');
insert into public.audit_logs (actor_id, action, entity_type, entity_id) values
  ('acbc0000-0000-0000-0000-000000000004', 'TEST_HISTORY', 'requests', 'x');

set local role authenticated;

-- ---------- ลบบัญชี ----------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000003') $$,
  'AUTH_REQUIRED', 'deleting an account requires a signed-in user'
);

select set_config('request.jwt.claims', '{"sub":"acac0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000003') $$,
  'NOT_AUTHORIZED', 'a staff member cannot delete accounts'
);
select throws_ok(
  $$ select public.app_admin_create_account_request('ACX001', 'password1', 'ก', 'ข', 'acx@example.com', '0812345678', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'NOT_AUTHORIZED', 'a staff member cannot create accounts'
);

select set_config('request.jwt.claims', '{"sub":"acac0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select * from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000001') $$,
  'CANNOT_DELETE_SELF', 'an admin cannot delete their own account'
);

select results_eq(
  $$ select mode, auth_user_id from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000003') $$,
  $$ values ('deleted'::text, 'acac0000-0000-0000-0000-000000000003'::uuid) $$,
  'an account without history is deleted permanently and returns its auth user'
);
select results_eq(
  $$ select mode, auth_user_id from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000004') $$,
  $$ values ('archived'::text, 'acac0000-0000-0000-0000-000000000004'::uuid) $$,
  'an account with history is archived instead of deleted'
);
select throws_ok(
  $$ select * from public.app_admin_delete_employee('acbc0000-0000-0000-0000-000000000004') $$,
  'EMPLOYEE_NOT_FOUND', 'an archived account cannot be deleted again'
);
select is(
  (select count(*) from public.app_list_credentials() where employee_id in
    ('acbc0000-0000-0000-0000-000000000003', 'acbc0000-0000-0000-0000-000000000004')),
  0::bigint, 'deleted and archived accounts are hidden from the credential list'
);
select ok(
  (select count(*) from public.app_list_credentials() where employee_id = 'acbc0000-0000-0000-0000-000000000002') = 1,
  'active accounts are still listed'
);
select throws_ok(
  $$ select public.app_admin_update_employee('acbc0000-0000-0000-0000-000000000004', 'ACHIST', 'มี', 'ประวัติ',
       'achist@example.com', null, null, null, null, true) $$,
  'EMPLOYEE_NOT_FOUND', 'an archived account cannot be edited or reactivated'
);

-- ---------- เพิ่มบัญชี ----------
select throws_ok(
  $$ select public.app_admin_create_account_request('ACX001', 'password1', 'ก', 'ข', 'acx@example.com', '0812', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'INVALID_PHONE', 'a phone number with fewer than 9 digits is rejected'
);
select throws_ok(
  $$ select public.app_admin_create_account_request('ACX001', 'short', 'ก', 'ข', 'acx@example.com', '0812345678', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'INVALID_PASSWORD', 'a password shorter than 8 characters is rejected'
);
select throws_ok(
  $$ select public.app_admin_create_account_request('ACSTAFF', 'password1', 'ก', 'ข', 'acx@example.com', '0812345678', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'EMPLOYEE_NO_TAKEN', 'an employee number already in use is rejected'
);
select throws_ok(
  $$ select public.app_admin_create_account_request('ACX001', 'password1', 'ก', 'ข', 'ACSTAFF@example.com', '0812345678', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'EMAIL_TAKEN', 'an email already in use is rejected (case-insensitive)'
);

create temp table created_request as
  select public.app_admin_create_account_request('acnew01', 'password1', ' ใหม่ ', 'บัญชี', 'ACNEW@example.com', '081-234-5678',
    'วิศวกร', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') as id;
grant select on created_request to authenticated;

select throws_ok(
  $$ select public.app_admin_create_account_request('ACNEW01', 'password1', 'ก', 'ข', 'other@example.com', '0812345678', null,
       '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001') $$,
  'REQUEST_ALREADY_PENDING', 'a second request for the same pending employee number is rejected'
);

-- pilot-auth สร้างบัญชี Auth แล้วอนุมัติด้วยฟังก์ชันเดิม
select lives_ok(
  $$ select public.app_apply_account_request((select id from created_request), 'acac0000-0000-0000-0000-000000000005', null) $$,
  'the admin-created request is approved through app_apply_account_request'
);

reset role;

select results_eq(
  $$ select employee_no, first_name, email, phone, is_active from public.employees where auth_user_id = 'acac0000-0000-0000-0000-000000000005' $$,
  $$ values ('ACNEW01'::text, 'ใหม่'::text, 'acnew@example.com'::text, '081-234-5678'::text, true) $$,
  'the new employee is created with normalized values'
);
select is(
  (select status::text from public.account_requests where id = (select id from created_request)),
  'approved', 'the admin-created request ends up approved'
);
select is(
  (select count(*) from public.audit_logs where action = 'ADMIN_CREATE_ACCOUNT_REQUEST'
     and actor_id = 'acbc0000-0000-0000-0000-000000000001' and metadata::text not like '%password1%'),
  1::bigint, 'creating an account is audited without the password'
);

select is(
  (select count(*) from public.employees where id = 'acbc0000-0000-0000-0000-000000000003'),
  0::bigint, 'the account without history is gone'
);
select is(
  (select count(*) from public.account_credentials where employee_id = 'acbc0000-0000-0000-0000-000000000003')
  + (select count(*) from public.notifications where recipient_id = 'acbc0000-0000-0000-0000-000000000003'),
  0::bigint, 'its own credentials and notifications are removed with it'
);
select results_eq(
  $$ select is_active, deleted_at is not null, deleted_by, auth_user_id from public.employees
     where id = 'acbc0000-0000-0000-0000-000000000004' $$,
  $$ values (false, true, 'acbc0000-0000-0000-0000-000000000001'::uuid, null::uuid) $$,
  'the archived account is inactive, marked deleted and unlinked from its login'
);
select ok(
  exists (select 1 from public.audit_logs where action = 'TEST_HISTORY' and actor_id = 'acbc0000-0000-0000-0000-000000000004')
  and not exists (select 1 from public.account_credentials where employee_id = 'acbc0000-0000-0000-0000-000000000004'),
  'archiving keeps history but removes the stored password'
);
select is(
  (select string_agg(action, ',' order by action) from public.audit_logs
     where action in ('ARCHIVE_EMPLOYEE', 'DELETE_EMPLOYEE') and entity_type = 'employees' and entity_id in
       ('acbc0000-0000-0000-0000-000000000003', 'acbc0000-0000-0000-0000-000000000004')),
  'ARCHIVE_EMPLOYEE,DELETE_EMPLOYEE', 'both delete outcomes are audited'
);

select ok(
  not has_function_privilege('anon', 'public.app_admin_delete_employee(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.app_admin_create_account_request(text, text, text, text, text, text, text, uuid, uuid)', 'execute'),
  'anon cannot execute the account create/delete functions'
);

select * from finish();
rollback;
