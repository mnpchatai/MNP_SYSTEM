-- ทดสอบโหมดทดสอบของ admin (20261005030000_admin_sandbox_mode.sql)
--   1) โครงสร้าง: RLS, grants, บัญชีทดสอบล็อกอินไม่ได้ และ "ทุกตารางต้องมีด่านโหมดทดสอบหรืออยู่ในรายการที่รู้จัก"
--   2) ใครเข้าโหมดทดสอบได้ (admin เท่านั้น) ทั้งกรณีอนุญาตและปฏิเสธ
--   3) ใช้ NCR ครบทุกขั้นตามบทบาทของ persona: เลขที่ TEST- แยก ไม่มีแจ้งเตือน ไม่ปรากฏในตัวเตือนงานค้าง
--   4) แยกข้อมูล: ผู้ใช้จริงมองไม่เห็น/แก้ใบทดสอบไม่ได้ และ persona มองไม่เห็น/แก้ใบจริงไม่ได้
--   5) ด่าน fail-closed: โมดูลอื่นเขียนข้อมูลไม่ได้ขณะอยู่ในโหมดทดสอบ, แนบไฟล์ในใบทดสอบไม่ได้
--   6) ล้างข้อมูลทดสอบ และสิทธิ์โหมดทดสอบหายไปเมื่อบัญชีไม่ใช่ admin แล้ว
begin;

create extension if not exists pgtap with schema extensions;
select plan(75);

-- 1. โครงสร้าง ------------------------------------------------------------------
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'sandbox_sessions'),
  'RLS is enabled on sandbox_sessions'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'sandbox_sessions' and grantee in ('anon', 'authenticated')
  ),
  'anon and authenticated have no direct grant on sandbox_sessions'
);
select ok(
  not (has_function_privilege('anon', 'public.app_sandbox_status()', 'execute')
    or has_function_privilege('anon', 'public.app_sandbox_enter(uuid)', 'execute')
    or has_function_privilege('anon', 'public.app_sandbox_exit()', 'execute')
    or has_function_privilege('anon', 'public.app_sandbox_purge_ncr()', 'execute')),
  'anon cannot execute any app_sandbox_* function'
);
select ok(
  not has_function_privilege('authenticated', 'private.sandbox_persona()', 'execute')
    and not has_function_privilege('authenticated', 'private.sandbox_guard_table(regclass)', 'execute'),
  'authenticated cannot call the sandbox helpers directly'
);
select is(
  (select count(*)::int from public.employees where is_test and not is_active and auth_user_id is null),
  18,
  'eighteen test personas exist (nine for NCR, sales and planning for production orders, stores for materials, five production line departments, the assistant factory manager for the schedule) and none can log in (inactive, no auth user)'
);
select is(
  (select count(*)::int from public.employees where is_test and (is_active or auth_user_id is not null)),
  0,
  'no test persona is active or linked to an auth user'
);
select throws_ok(
  $$ update public.employees set is_active = true where employee_no = 'SBX-RB-STAFF' $$,
  '23514',
  null,
  'a test persona cannot be activated'
);
select is(
  (select array_agg(c.relname order by c.relname)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
     and c.relname <> all (private.sandbox_unguarded_tables())
     and not exists (select 1 from pg_trigger t where t.tgrelid = c.oid and t.tgname = 'sandbox_guard' and not t.tgisinternal)),
  null,
  'every public table either has the sandbox_guard trigger or is listed in private.sandbox_unguarded_tables() — add the guard (private.sandbox_guard_table) or list the new table when you add a module'
);
select ok(
  (select bool_and(exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                           where n.nspname = 'public' and c.relname = t))
   from unnest(private.sandbox_unguarded_tables()) as t),
  'every table named in private.sandbox_unguarded_tables() exists (no typo)'
);

-- id ของ persona เก็บไว้ตอนเป็น postgres: RLS ซ่อนแถว inactive จาก client โดยตั้งใจ (admin เห็นผ่าน app_sandbox_status)
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 2. ผู้ใช้ทดสอบ (ของจริง ไม่ใช่ persona) ------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('76000000-0000-0000-0000-000000000001', 'sbx-admin@mnp.local', '{}'::jsonb),
  ('76000000-0000-0000-0000-000000000002', 'sbx-rb-staff@mnp.local', '{}'::jsonb),
  ('76000000-0000-0000-0000-000000000003', 'sbx-factory@mnp.local', '{}'::jsonb),
  ('76000000-0000-0000-0000-000000000004', 'sbx-qa-manager@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('76000000-0000-0000-0000-000000000101', 'SBXT-ADMIN', 'จริง', 'แอดมิน', 'sbx-admin@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '76000000-0000-0000-0000-000000000001'),
  ('76000000-0000-0000-0000-000000000102', 'SBXT-RB', 'จริง', 'พนักงาน RB', 'sbx-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '76000000-0000-0000-0000-000000000002'),
  ('76000000-0000-0000-0000-000000000103', 'SBXT-FM', 'จริง', 'ผจก.โรงงาน', 'sbx-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '76000000-0000-0000-0000-000000000003'),
  ('76000000-0000-0000-0000-000000000104', 'SBXT-QAM', 'จริง', 'ผจก. QA', 'sbx-qa-manager@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '76000000-0000-0000-0000-000000000004');

select ok(
  not exists (select 1 from public.employees where auth_user_id = '76000000-0000-0000-0000-000000000001' and is_test),
  'a real employee row is never flagged as a test persona'
);
select throws_ok(
  $$ update public.employees set auth_user_id = '76000000-0000-0000-0000-000000000002', is_test = true
     where employee_no = 'SBX-RB-STAFF' $$,
  '23514',
  null,
  'a persona cannot be linked to a real login'
);

set local role authenticated;

-- 3. สิทธิ์เข้าโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_sandbox_status() $$, 'AUTH_REQUIRED', 'anonymous callers are rejected');

select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_sandbox_status() $$, 'NOT_AUTHORIZED', 'a staff member cannot read the sandbox status');
select throws_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid) $$,
  'NOT_AUTHORIZED',
  'a staff member cannot enter the sandbox'
);
select throws_ok($$ select public.app_sandbox_exit() $$, 'NOT_AUTHORIZED', 'a staff member cannot call exit');
select throws_ok($$ select public.app_sandbox_purge_ncr() $$, 'NOT_AUTHORIZED', 'a staff member cannot purge test data');
select throws_ok($$ select count(*) from public.sandbox_sessions $$, '42501', null, 'sandbox_sessions is not readable through the API');

select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'NOT_AUTHORIZED',
  'a factory manager cannot enter the sandbox'
);

select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.app_sandbox_status()->>'active')::boolean),
  false,
  'an admin starts outside the sandbox'
);
select is(
  (select jsonb_array_length(public.app_sandbox_status()->'personas')),
  18,
  'the admin can see the eighteen personas'
);
select throws_ok(
  $$ select public.app_sandbox_enter('76000000-0000-0000-0000-000000000102') $$,
  'PERSONA_NOT_FOUND',
  'a real employee cannot be used as a persona'
);
select throws_ok(
  $$ select public.app_sandbox_enter(gen_random_uuid()) $$,
  'PERSONA_NOT_FOUND',
  'an unknown persona is rejected'
);
select is(
  (select count(*)::int from public.app_list_credentials() where employee_no like 'SBX-%'),
  0,
  'personas are hidden from the admin account list'
);
select ok(
  (select count(*) from public.app_list_credentials() where employee_no = 'SBXT-ADMIN') = 1,
  'real accounts are still listed'
);

-- 4. ใช้ NCR ในโหมดทดสอบครบทุกขั้น -------------------------------------------------
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid) $$,
  'the admin enters the sandbox as the RB staff persona'
);
select is(
  (select public.app_sandbox_status()->'persona'->>'employee_no'),
  'SBX-RB-STAFF',
  'the status reports the active persona'
);
select lives_ok(
  $$ select set_config('test.sbx_ncr_1', public.app_ncr_issue('SBXTEST_1', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ทดสอบโหมดทดสอบ: รูในใหญ่เกินสเปค')->>'id', true) $$,
  'the persona issues an NCR'
);
select lives_ok(
  $$ select set_config('test.sbx_ncr_2', public.app_ncr_issue('SBXTEST_2', 50, 5, 'ชิ้น', 'final_fg', 'SURF', 'ทดสอบโหมดทดสอบ: ผิวเป็นตามด')->>'id', true) $$,
  'the persona issues a second NCR'
);

select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'switch to the factory manager persona'
);
select lives_ok(
  $$ select public.app_ncr_dispose(current_setting('test.sbx_ncr_1')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'the factory manager persona makes the factory decision'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid) $$,
  'switch to the RB manager persona'
);
select lives_ok(
  $$ select public.app_ncr_respond(current_setting('test.sbx_ncr_1')::uuid,
       array['machine'], 'อุณหภูมิอบไม่คงที่', 'คัดแยกและซ่อม', 'ติดตั้งตัวควบคุม ผู้รับผิดชอบ: ช่าง RB') $$,
  'the responsible manager persona responds'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid) $$,
  'switch to the QA staff persona'
);
select lives_ok(
  $$ select public.app_ncr_followup(current_setting('test.sbx_ncr_1')::uuid, 'close', 'ตรวจซ้ำผ่าน') $$,
  'the QA persona closes the issue'
);
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid) $$,
  'switch to the QA manager persona'
);
select is(public.app_ncr_signoff(current_setting('test.sbx_ncr_1')::uuid), 'qa', 'the QA manager persona signs first');
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'switch back to the factory manager persona'
);
select is(public.app_ncr_signoff(current_setting('test.sbx_ncr_1')::uuid), 'factory', 'the factory manager persona signs second');
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid) $$,
  'switch to the general manager persona'
);
select is(public.app_ncr_signoff(current_setting('test.sbx_ncr_1')::uuid), 'gm', 'the general manager persona signs last');
select is(
  (select count(*)::int from public.ncr_reports where is_test and status = 'closed'),
  1,
  'inside the sandbox the persona sees the closed test NCR'
);

reset role;
select matches(
  (select ncr_no from public.ncr_reports where id = current_setting('test.sbx_ncr_1')::uuid),
  '^TEST-QA001/[0-9]{2}$',
  'test NCR numbers start at TEST-QA001 and use their own counter'
);
select is(
  (select is_test from public.ncr_reports where id = current_setting('test.sbx_ncr_1')::uuid),
  true,
  'the report is flagged as a test report by the database'
);
select is(
  (select reporter_id from public.ncr_reports where id = current_setting('test.sbx_ncr_1')::uuid),
  current_setting('test.p_sbx_rb_staff')::uuid,
  'the persona, not the admin, is recorded as the reporter'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  40,
  'the real NCR counter did not move'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR-TEST' and year_key = to_char(now() at time zone 'Asia/Bangkok', 'YY')),
  2,
  'the test counter counted the two test reports'
);
select is(
  (select count(*)::int from public.notifications where action_url in ('/ncr/' || current_setting('test.sbx_ncr_1'), '/ncr/' || current_setting('test.sbx_ncr_2'))),
  0,
  'no notification (and so no email) was created for any test NCR step'
);

-- 5. แยกข้อมูลจากของจริง ------------------------------------------------------------
-- ใบจริงที่ออกโดยพนักงานจริง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select set_config('test.real_ncr', public.app_ncr_issue('SBXREAL_1', 200, 20, 'ชิ้น', 'in_process', 'DIM', 'ใบจริงที่ต้องไม่ปนกับใบทดสอบ')->>'id', true) $$,
  'a real employee issues a real NCR'
);
reset role;
select matches(
  (select ncr_no from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  '^QA041/[0-9]{2}$',
  'the real NCR continues the real series'
);
select is(
  (select is_test from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  false,
  'a real NCR is not flagged as a test report'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  41,
  'only the real counter moved for the real NCR'
);
select is(
  (select count(*)::int from public.notifications
   where recipient_id = '76000000-0000-0000-0000-000000000103' and action_url = '/ncr/' || current_setting('test.real_ncr')),
  1,
  'real people are still notified of real NCRs'
);
select is(
  (select count(*)::int from private.pending_work_items(now()) where item_type = 'ncr' and item_id = current_setting('test.real_ncr')::uuid),
  1,
  'a real open NCR appears in the pending-work reminders'
);
select is(
  (select count(*)::int from private.pending_work_items(now())
   where item_type = 'ncr' and item_id in (current_setting('test.sbx_ncr_1')::uuid, current_setting('test.sbx_ncr_2')::uuid)),
  0,
  'test NCRs never appear in the pending-work reminders'
);

-- ผู้ใช้จริงมองไม่เห็นและแก้ใบทดสอบไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ncr_reports where is_test),
  0,
  'a real QA manager cannot see test NCRs'
);
select throws_ok(
  $$ select public.app_ncr_cancel(current_setting('test.sbx_ncr_2')::uuid, 'ผู้ใช้จริงยกเลิกใบทดสอบไม่ได้') $$,
  'SANDBOX_SCOPE_MISMATCH',
  'a real user cannot change a test NCR even with its id'
);
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(
  (select count(*)::int from public.ncr_reports where is_test),
  0,
  'a real factory manager cannot see test NCRs'
);
select is(
  (select count(*)::int from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  1,
  'a real factory manager still sees the real NCR'
);

-- admin ที่อยู่นอกโหมดทดสอบ (หลัง exit) ก็ไม่เห็นใบทดสอบ
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin exits the sandbox');
select is(
  (select count(*)::int from public.ncr_reports where is_test),
  0,
  'the admin cannot see test NCRs outside the sandbox'
);
select is(
  (select count(*)::int from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  1,
  'the admin sees real NCRs outside the sandbox'
);
select throws_ok(
  $$ select public.app_sandbox_purge_ncr() $$,
  'SANDBOX_NOT_ACTIVE',
  'purge only works from inside the sandbox'
);

-- persona มองไม่เห็นและแก้ใบจริงไม่ได้
select lives_ok(
  $$ select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid) $$,
  'the admin re-enters as the factory manager persona'
);
select is(
  (select count(*)::int from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  0,
  'a persona cannot see a real NCR'
);
select throws_ok(
  $$ select public.app_ncr_dispose(current_setting('test.real_ncr')::uuid, array['sort'],
       array[(select id from public.departments where code = 'RB')]) $$,
  'SANDBOX_SCOPE_MISMATCH',
  'a persona cannot decide on a real NCR even with its id'
);

-- 6. ด่าน fail-closed ---------------------------------------------------------------
select throws_ok(
  $$ select public.app_admin_set_acting_role('76000000-0000-0000-0000-000000000102', null) $$,
  'SANDBOX_MODULE_UNSUPPORTED',
  'inside the sandbox another module cannot write real data'
);
select ok(
  not private.can_upload_ncr_attachment(current_setting('test.sbx_ncr_2')::uuid),
  'attachments cannot be uploaded to a test NCR'
);
reset role;
select throws_ok(
  $$ insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
     values (current_setting('test.sbx_ncr_2')::uuid, 'report', current_setting('test.p_sbx_rb_staff')::uuid,
             current_setting('test.sbx_ncr_2') || '/x.png', 'x.png', 'image/png', 10) $$,
  'P0001',
  'SANDBOX_ATTACHMENT_UNSUPPORTED',
  'the database refuses attachment rows on a test NCR'
);

-- 7. ล้างข้อมูลทดสอบ ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(
  (select (public.app_sandbox_purge_ncr()->>'deleted')::int),
  2,
  'purge deletes both test NCRs'
);
reset role;
select is(
  (select count(*)::int from public.ncr_reports where is_test)
    + (select count(*)::int from public.ncr_status_history where ncr_id in (current_setting('test.sbx_ncr_1')::uuid, current_setting('test.sbx_ncr_2')::uuid))
    + (select count(*)::int from public.ncr_responsibilities where ncr_id = current_setting('test.sbx_ncr_1')::uuid),
  0,
  'purge removes the test NCRs and their history and responsibilities'
);
select is(
  (select count(*)::int from public.ncr_reports where id = current_setting('test.real_ncr')::uuid),
  1,
  'purge leaves real NCRs untouched'
);
select is(
  (select count(*)::int from public.document_counters where department_code = 'NCR-TEST'),
  0,
  'purge resets the test counter'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  41,
  'purge never touches the real counter'
);

-- 8. สิทธิ์โหมดทดสอบหายไปเมื่อบัญชีไม่ใช่ admin แล้ว -------------------------------------
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(
  (private.sandbox_persona()).id is not null,
  'the admin is still in the sandbox before being demoted'
);
-- ลดสิทธิ์โดยงานหลังบ้าน (ไม่มี JWT ของผู้ใช้) เหมือนที่ service role ทำ
select set_config('request.jwt.claims', '', true);
update public.employees
set role_id = (select id from public.roles where code = 'staff')
where id = '76000000-0000-0000-0000-000000000101';
select set_config('request.jwt.claims', '{"sub":"76000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(
  (private.sandbox_persona()).id is null,
  'a demoted account is no longer treated as being in the sandbox'
);

select * from finish();
rollback;
