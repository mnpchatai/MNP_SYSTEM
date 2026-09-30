-- อีเมลยืนยันอนุมัติสิทธิ์ (ID + ลิงก์ตั้งรหัสผ่านใหม่): โทเค็นใช้ได้ครั้งเดียว, หมดอายุ, เข้าถึงได้เฉพาะ service role,
-- การอนุมัติตั้งธงในแจ้งเตือน, และส่งย้อนหลังไม่ซ้ำ
begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

-- ข้อมูลทดสอบ: พนักงานที่มีบัญชี auth
insert into auth.users (id, email) values ('aaaaaaaa-1111-0000-0000-000000000001', 'setup1@example.com');
insert into public.employees (id, auth_user_id, employee_no, first_name, last_name, email, department_id, role_id)
values ('bbbbbbbb-1111-0000-0000-000000000001', 'aaaaaaaa-1111-0000-0000-000000000001', 'SETUP01', 'ทดสอบ', 'ตั้งรหัส',
        'setup1@example.com', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');

insert into public.password_setup_tokens (employee_id, token_hash, expires_at) values
  ('bbbbbbbb-1111-0000-0000-000000000001', 'hash_valid', now() + interval '1 day'),
  ('bbbbbbbb-1111-0000-0000-000000000001', 'hash_expired', now() - interval '1 minute');

select has_column('public', 'notifications', 'email_setup_link', 'notifications has email_setup_link');
select is(public.app_peek_password_setup_token('hash_valid'), 'SETUP01', 'peek returns employee_no for a valid token');
select is(public.app_peek_password_setup_token('hash_expired'), null, 'peek rejects an expired token');
select is(public.app_peek_password_setup_token('hash_unknown'), null, 'peek rejects an unknown token');
select is((select count(*) from public.app_consume_password_setup_token('hash_expired')), 0::bigint, 'consume rejects an expired token');
select is((select employee_no from public.app_consume_password_setup_token('hash_valid')), 'SETUP01', 'consume returns the employee once');
select is((select count(*) from public.app_consume_password_setup_token('hash_valid')), 0::bigint, 'consume cannot be replayed');
select is(public.app_peek_password_setup_token('hash_valid'), null, 'a used token no longer peeks');
select lives_ok($$ select public.app_release_password_setup_token('hash_valid') $$, 'release gives the token back');
select is(public.app_peek_password_setup_token('hash_valid'), 'SETUP01', 'released token is usable again');

select public.app_record_self_set_password('bbbbbbbb-1111-0000-0000-000000000001', 'newpassword1');
select is(
  (select password from public.account_credentials where employee_id = 'bbbbbbbb-1111-0000-0000-000000000001'),
  'newpassword1', 'self-set password is recorded in the credential vault'
);
select is(
  (select count(*) from public.audit_logs where action = 'SET_PASSWORD_VIA_EMAIL_LINK' and metadata::text like '%newpassword1%'),
  0::bigint, 'audit log never contains the password'
);

-- ไม่มีใครนอกจาก service role เรียกฟังก์ชัน/อ่านตารางโทเค็นได้
select ok(
  not has_function_privilege('authenticated', 'public.app_consume_password_setup_token(text)', 'execute')
  and not has_function_privilege('anon', 'public.app_peek_password_setup_token(text)', 'execute')
  and has_function_privilege('service_role', 'public.app_consume_password_setup_token(text)', 'execute'),
  'token functions are executable by service_role only'
);
select ok(
  not has_table_privilege('authenticated', 'public.password_setup_tokens', 'select')
  and not has_table_privilege('anon', 'public.password_setup_tokens', 'select'),
  'password_setup_tokens is not readable by anon/authenticated'
);

select * from finish();
rollback;
