-- ทดสอบบัญชี master (20261113010000_master_account.sql)
--   1) ธง is_master: มีได้บัญชีเดียว ต้องเป็น admin ที่ใช้งานอยู่ ลบแถวไม่ได้ ผู้ล็อกอินตั้ง/ถอนธงไม่ได้
--   2) ผู้ดูแลระบบคนอื่นแก้ ตั้งบทบาท ลบ เปลี่ยน/ดูรหัสผ่านของ master ไม่ได้ แต่ยังจัดการบัญชีอื่นได้ตามเดิม
--   3) บันทึกกิจกรรม: เฉพาะ master อ่าน audit_logs ได้ และค่าที่เกี่ยวกับรหัสผ่านถูกซ่อน
--   4) บันทึกข้อผิดพลาด: ทุกคนส่งได้ (ตัดโทเค็น จำกัดจำนวน ข้ามรายการซ้ำ) เฉพาะ master อ่านได้
begin;

create extension if not exists pgtap with schema extensions;
select plan(42);

-- 0. เตรียมผู้ใช้: master, admin อีกคน, พนักงานทั่วไป ---------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a5ee0000-0000-0000-0000-000000000001', 'master-test@mnp.local', '{}'::jsonb),
  ('a5ee0000-0000-0000-0000-000000000002', 'other-admin-test@mnp.local', '{}'::jsonb),
  ('a5ee0000-0000-0000-0000-000000000003', 'staff-test@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('a5ee0000-0000-0000-0000-000000000011', 'MASTER-T', 'ทดสอบ', 'มาสเตอร์', 'master-test@mnp.local', 'Developer',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'a5ee0000-0000-0000-0000-000000000001'),
  ('a5ee0000-0000-0000-0000-000000000012', 'ADMIN-T', 'ทดสอบ', 'แอดมิน', 'other-admin-test@mnp.local', 'Admin',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'a5ee0000-0000-0000-0000-000000000002'),
  ('a5ee0000-0000-0000-0000-000000000013', 'STAFF-T', 'ทดสอบ', 'พนักงาน', 'staff-test@mnp.local', 'Staff',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'a5ee0000-0000-0000-0000-000000000003');

insert into public.account_credentials (employee_id, username, password) values
  ('a5ee0000-0000-0000-0000-000000000011', 'MASTER-T', 'master-secret-pw'),
  ('a5ee0000-0000-0000-0000-000000000013', 'STAFF-T', 'staff-secret-pw');

insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata) values
  ('a5ee0000-0000-0000-0000-000000000012', 'UPDATE', 'account_credentials', 'a5ee0000-0000-0000-0000-000000000013',
   jsonb_build_object(
     'old', jsonb_build_object('username', 'OLD-NAME', 'password', 'leaked-old-pw', 'updated_at', '2026-01-01'),
     'new', jsonb_build_object('username', 'STAFF-T', 'password', 'leaked-new-pw', 'updated_at', '2026-01-02')));

-- 1. ธง is_master --------------------------------------------------------------
select has_column('public', 'employees', 'is_master', 'employees has is_master');

-- migration (ไม่มีผู้ล็อกอิน) ตั้งธงได้
select lives_ok(
  $$ update public.employees set is_master = true where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'a migration (no signed-in user) can mark the master account'
);
select throws_ok(
  $$ update public.employees set is_master = true where id = 'a5ee0000-0000-0000-0000-000000000012' $$,
  '23505', null,
  'only one account can be the master'
);
select throws_ok(
  $$ update public.employees set is_master = true where id = 'a5ee0000-0000-0000-0000-000000000013' $$,
  'MASTER_MUST_BE_ACTIVE_ADMIN',
  'the master account must be an admin'
);
select throws_ok(
  $$ update public.employees set is_active = false where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'MASTER_MUST_BE_ACTIVE_ADMIN',
  'the master account cannot be deactivated'
);
select throws_ok(
  $$ delete from public.employees where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'MASTER_PROTECTED',
  'the master row cannot be deleted, even without a signed-in user'
);

-- แม้โค้ดฝั่งฐานข้อมูลจะเขียนแถวเอง ผู้ล็อกอินที่เป็น admin อื่นก็แก้แถว master ไม่ได้ (trigger)
select set_config('request.jwt.claims', '{"sub":"a5ee0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ update public.employees set job_title = 'changed' where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'MASTER_PROTECTED',
  'a write made on behalf of another admin cannot change the master row'
);
select set_config('request.jwt.claims', '{"sub":"a5ee0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ update public.employees set is_master = false where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'MASTER_PROTECTED',
  'a signed-in user, even the master, cannot clear the master flag'
);
select lives_ok(
  $$ update public.employees set job_title = 'Developer and tester' where id = 'a5ee0000-0000-0000-0000-000000000011' $$,
  'a write made on behalf of the master can change the master row'
);
select set_config('request.jwt.claims', '', true);

set local role authenticated;

-- 2. admin คนอื่น -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a5ee0000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_am_i_master(), false, 'another admin is not the master');
select throws_ok(
  $$ select public.app_admin_update_employee('a5ee0000-0000-0000-0000-000000000011', 'MASTER-T', 'แก้', 'ชื่อ', 'master-test@mnp.local') $$,
  'MASTER_PROTECTED',
  'another admin cannot edit the master account'
);
select throws_ok(
  $$ select public.app_admin_set_acting_role('a5ee0000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000006') $$,
  'MASTER_PROTECTED',
  'another admin cannot change the acting role of the master'
);
select throws_ok(
  $$ select * from public.app_admin_delete_employee('a5ee0000-0000-0000-0000-000000000011') $$,
  'MASTER_PROTECTED',
  'another admin cannot delete or archive the master account'
);
select throws_ok(
  $$ select public.app_admin_target_auth_user('a5ee0000-0000-0000-0000-000000000011') $$,
  'MASTER_PROTECTED',
  'another admin cannot change the master password at Supabase Auth (pilot-auth asks this RPC first)'
);
select throws_ok(
  $$ select public.app_admin_record_password('a5ee0000-0000-0000-0000-000000000011', 'new-password-1') $$,
  'MASTER_PROTECTED',
  'another admin cannot record a password for the master'
);
select throws_ok(
  $$ select public.app_reveal_credential('a5ee0000-0000-0000-0000-000000000011') $$,
  'MASTER_PROTECTED',
  'another admin cannot reveal the master password'
);
select is(
  public.app_admin_target_auth_user('a5ee0000-0000-0000-0000-000000000013'),
  'a5ee0000-0000-0000-0000-000000000003'::uuid,
  'another admin still manages the passwords of other accounts'
);
select is(
  public.app_reveal_credential('a5ee0000-0000-0000-0000-000000000013'),
  'staff-secret-pw',
  'another admin still reveals the passwords of other accounts'
);
select lives_ok(
  $$ select public.app_admin_update_employee('a5ee0000-0000-0000-0000-000000000013', 'STAFF-T', 'ทดสอบ', 'พนักงาน', 'staff-test@mnp.local', null, 'Staff 2') $$,
  'another admin still edits other accounts'
);
select is((select count(*)::integer from public.audit_logs), 0, 'another admin cannot read the audit trail');
select throws_ok($$ select * from public.app_master_activity_log() $$, 'NOT_AUTHORIZED', 'another admin cannot open the activity log');
select throws_ok($$ select public.app_master_activity_facets() $$, 'NOT_AUTHORIZED', 'another admin cannot read the activity log filters');
select throws_ok($$ select * from public.app_master_client_errors() $$, 'NOT_AUTHORIZED', 'another admin cannot read the error log');
select throws_ok($$ select * from public.app_master_client_error_summary() $$, 'NOT_AUTHORIZED', 'another admin cannot read the error summary');
select throws_ok(
  $$ select * from public.client_error_logs $$,
  '42501', null,
  'the error log table cannot be read directly'
);
select lives_ok(
  $$ select public.app_log_client_error('rpc', 'save failed token=abc123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'NCR_X', 'ncr', null, '20261113master', 'test-agent') $$,
  'any signed-in user can report an error'
);
select lives_ok(
  $$ select public.app_log_client_error('rpc', 'save failed token=abc123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl', 'NCR_X', 'ncr') $$,
  'reporting the same error again right away is accepted silently'
);

-- 3. พนักงานทั่วไป -----------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a5ee0000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_am_i_master(), false, 'a staff member is not the master');
select throws_ok($$ select * from public.app_master_activity_log() $$, 'NOT_AUTHORIZED', 'a staff member cannot open the activity log');
select lives_ok(
  $$ select public.app_log_client_error('js', 'error number ' || g, null, 'dashboard') from generate_series(1, 35) as g $$,
  'a staff member can report many errors without a failure'
);

-- 4. master ------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"a5ee0000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_am_i_master(), true, 'the master is recognised');
select ok((select count(*) from public.audit_logs) > 0, 'the master reads the audit trail');
select is(
  (select changes -> 'username' ->> 'new' from public.app_master_activity_log(p_entity_type => 'account_credentials') where action = 'UPDATE' limit 1),
  'STAFF-T',
  'the activity log shows the new value of a changed field'
);
select is(
  (select changes -> 'password' ->> 'new' from public.app_master_activity_log(p_entity_type => 'account_credentials') where action = 'UPDATE' limit 1),
  '[ซ่อน]',
  'the activity log hides password values'
);
select ok(
  not exists (select 1 from public.app_master_activity_log(p_limit => 200) l where l.changes::text like '%leaked-%'),
  'no password value from the audit trail reaches the activity log'
);
select ok(
  not ((select changes from public.app_master_activity_log(p_entity_type => 'account_credentials') where action = 'UPDATE' limit 1) ? 'updated_at'),
  'the activity log leaves out updated_at'
);
select is(
  (select l.actor_no from public.app_master_activity_log(p_entity_type => 'account_credentials') l where l.action = 'UPDATE' limit 1),
  'ADMIN-T',
  'the activity log names who acted'
);
select ok(
  (select public.app_master_activity_facets() -> 'entity_types') @> '[{"entity_type":"account_credentials"}]'::jsonb,
  'the filters list the entity types in the audit trail'
);
select is(
  (select count(*)::integer from public.app_master_client_errors(p_employee_id => 'a5ee0000-0000-0000-0000-000000000012')),
  1,
  'a repeated error within a minute is stored once'
);
select is(
  (select message from public.app_master_client_errors(p_employee_id => 'a5ee0000-0000-0000-0000-000000000012') limit 1),
  'save failed token=[ซ่อน] [token]',
  'tokens and secrets are removed from a reported error'
);
select is(
  (select count(*)::integer from public.app_master_client_errors(p_employee_id => 'a5ee0000-0000-0000-0000-000000000013', p_limit => 200)),
  30,
  'one person stores at most 30 errors in ten minutes'
);
select lives_ok(
  $$ select public.app_admin_target_auth_user('a5ee0000-0000-0000-0000-000000000011') $$,
  'the master can still manage its own password'
);

select * from finish();
rollback;
