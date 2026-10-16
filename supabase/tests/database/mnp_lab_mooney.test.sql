-- ทดสอบโมดูล MNP LAB (20261016020000_mnp_lab_mooney.sql)
--   1) โครงสร้าง: RLS, ไม่มีสิทธิ์ตรงบนตาราง, สิทธิ์เรียก RPC ของแต่ละบทบาท
--   2) นำเข้าจากชีต (service_role เท่านั้น): ตรวจข้อมูล, ซ้ำได้ผลเหมือนเดิม, กระจกสะท้อนชีต, ด่านกันลบเกินครึ่ง, audit
--   3) สิทธิ์อ่าน: admin เข้าได้ ส่วนพนักงานทั่วไป/admin ที่ถูกปิดบัญชี/ผู้ไม่ล็อกอิน/สิทธิ์ที่ถูกถอนเข้าไม่ได้
begin;

create extension if not exists pgtap with schema extensions;
select plan(61);

-- 1. โครงสร้าง ------------------------------------------------------------------
select has_table('public', 'lab_mooney_results', 'lab_mooney_results exists');
select ok(
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'lab_mooney_results'),
  'RLS is enabled on lab_mooney_results'
);
select ok(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'lab_mooney_results' and grantee in ('anon', 'authenticated')
  ),
  'anon and authenticated have no direct grant on lab_mooney_results'
);
select ok(
  not has_function_privilege('authenticated', 'private.can_access_lab()', 'execute'),
  'the access rule itself is not callable by the Data API roles'
);
select ok(
  not (has_function_privilege('anon', 'public.app_lab_access()', 'execute')
    or has_function_privilege('anon', 'public.app_lab_mooney_overview()', 'execute')
    or has_function_privilege('anon', 'public.app_lab_mooney_results(text)', 'execute')),
  'anon cannot execute the MNP LAB read RPCs'
);
select ok(
  has_function_privilege('authenticated', 'public.app_lab_access()', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_mooney_overview()', 'execute')
    and has_function_privilege('authenticated', 'public.app_lab_mooney_results(text)', 'execute'),
  'authenticated can execute the MNP LAB read RPCs (they check the caller themselves)'
);
select ok(
  not (has_function_privilege('anon', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute')
    or has_function_privilege('authenticated', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute')),
  'the sheet import is not executable by anon or authenticated'
);
select ok(
  has_function_privilege('service_role', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute'),
  'the sheet import is executable by service_role'
);

-- 2. เตรียมผู้ใช้: admin, พนักงานทั่วไป, admin ที่ถูกปิดบัญชี ---------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('81000000-0000-0000-0000-000000000001', 'lab-admin@mnp.local', '{}'::jsonb),
  ('81000000-0000-0000-0000-000000000002', 'lab-staff@mnp.local', '{}'::jsonb),
  ('81000000-0000-0000-0000-000000000003', 'lab-former-admin@mnp.local', '{}'::jsonb);

update public.employees set auth_user_id = '81000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '81000000-0000-0000-0000-000000000002'
where id = '50000000-0000-0000-0000-000000000003';

insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('81000000-0000-0000-0000-000000000004', 'LAB-OLD-ADMIN', 'ทดสอบ', 'อดีตผู้ดูแล', 'lab-former-admin@mnp.local', 'System Administrator',
   '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', '81000000-0000-0000-0000-000000000003', false);

-- ข้อมูลชุดแรก: แถวจริงจากชีต Mooney_Test_Report (แท็บ A1802 มี AVG/SD ส่วนแท็บ "E00030S T" ไม่มี) ---------
select set_config('lab.rows_small', $json$[
  {"source_sheet":"A1802","sample_id":"111","material":"A1802","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":50.79,"mv":31.39,"avg_mh":50.33,"sd_mh":0.45,"avg_mv":31.52,"sd_mv":0.21},
  {"source_sheet":"A1802","sample_id":"112","material":"A1802","test_date":"2026-09-21","test_time":"8:36:01","temperature_c":100,"test_minutes":4,"mh":49.95,"mv":31.78,"avg_mh":50.33,"sd_mh":0.45,"avg_mv":31.52,"sd_mv":0.21},
  {"source_sheet":"A1802","sample_id":"113","material":"A1802","test_date":"2026-09-21","test_time":"8:42:31","temperature_c":100,"test_minutes":4,"mh":50.24,"mv":31.68,"avg_mh":50.33,"sd_mh":0.45,"avg_mv":31.52,"sd_mv":0.21},
  {"source_sheet":"E00030S T","sample_id":"111","material":"E00030S T","test_date":"2026-09-23","test_time":"11:52:07","temperature_c":145,"test_minutes":5,"mh":32.14,"mv":30.97,"avg_mh":null,"sd_mh":null,"avg_mv":null,"sd_mv":null}
]$json$, false);

-- ชุดใหญ่สำหรับทดสอบด่านกันลบเกินครึ่ง: 20 แถวใน 2 วัสดุ และชุดย่อย 5 แถว
select set_config('lab.rows_20',
  (select jsonb_agg(jsonb_build_object(
      'source_sheet', 'BULK', 'sample_id', n::text, 'material', 'BULK-' || (n % 2),
      'test_date', '2026-10-01', 'test_time', '9:' || lpad(n::text, 2, '0') || ':00',
      'temperature_c', 100, 'test_minutes', 4, 'mh', 60 + n, 'mv', 40 + n,
      'avg_mh', null, 'sd_mh', null, 'avg_mv', null, 'sd_mv', null))::text
   from generate_series(1, 20) n), false);
select set_config('lab.rows_5',
  (select jsonb_agg(jsonb_build_object(
      'source_sheet', 'BULK', 'sample_id', n::text, 'material', 'BULK-' || (n % 2),
      'test_date', '2026-10-01', 'test_time', '9:' || lpad(n::text, 2, '0') || ':00',
      'temperature_c', 100, 'test_minutes', 4, 'mh', 60 + n, 'mv', 40 + n,
      'avg_mh', null, 'sd_mh', null, 'avg_mv', null, 'sd_mv', null))::text
   from generate_series(1, 5) n), false);

-- 3. นำเข้า: ผู้ที่ไม่ใช่ service_role เรียกไม่ได้ ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_lab_mooney_import(current_setting('lab.rows_small')::jsonb) $$,
  '42501', null,
  'even an admin session cannot call the import directly (service_role only)'
);
reset role;

-- 4. นำเข้าโดย service_role --------------------------------------------------------
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select throws_ok(
  $$ select public.app_lab_mooney_import('{"not":"an array"}'::jsonb) $$,
  'LAB_INVALID_PAYLOAD', 'a payload that is not an array is rejected'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[]'::jsonb) $$,
  'LAB_INVALID_PAYLOAD', 'an empty sheet is rejected instead of wiping the table'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[{"source_sheet":"X","sample_id":"1","material":"X","test_date":"21/09/2026","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":1,"mv":1}]'::jsonb) $$,
  'LAB_INVALID_ROW', 'a date that is not YYYY-MM-DD is rejected'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[{"source_sheet":"X","sample_id":"1","material":"X","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":-1,"mv":1}]'::jsonb) $$,
  'LAB_INVALID_ROW', 'a negative MH is rejected'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[{"source_sheet":"X","sample_id":"1","material":"","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":1,"mv":1}]'::jsonb) $$,
  'LAB_INVALID_ROW', 'a blank material is rejected'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[{"source_sheet":"X","sample_id":"1","material":"X","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":"abc","mv":1}]'::jsonb) $$,
  'LAB_INVALID_ROW', 'a non-numeric MH is rejected'
);
select throws_ok(
  $$ select public.app_lab_mooney_import('[
       {"source_sheet":"X","sample_id":"1","material":"X","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":1,"mv":1},
       {"source_sheet":"X","sample_id":"1","material":"X","test_date":"2026-09-21","test_time":"8:29:13","temperature_c":100,"test_minutes":4,"mh":2,"mv":2}
     ]'::jsonb) $$,
  'LAB_INVALID_ROW', 'the same sheet/ID/date/time twice in one payload is rejected'
);
select is((select count(*)::integer from public.lab_mooney_results), 0, 'rejected payloads leave the table empty');

select is(
  public.app_lab_mooney_import(current_setting('lab.rows_small')::jsonb),
  '{"rows":4,"inserted":4,"updated":0,"deleted":0}'::jsonb,
  'the first import inserts every row'
);
select is(
  public.app_lab_mooney_import(current_setting('lab.rows_small')::jsonb),
  '{"rows":4,"inserted":0,"updated":4,"deleted":0}'::jsonb,
  'importing the same sheet again changes nothing (idempotent)'
);
select is((select count(*)::integer from public.lab_mooney_results), 4, 'the table still has 4 rows after a repeat import');

-- แก้ค่าในชีตแล้วซิงก์ใหม่: ค่าในตารางตามชีต
select lives_ok(
  $$ select public.app_lab_mooney_import((select jsonb_set(current_setting('lab.rows_small')::jsonb, '{0,mh}', '51.5'::jsonb))) $$,
  'an edited cell is imported'
);
select is(
  (select mh from public.lab_mooney_results where sample_id = '111' and material = 'A1802'),
  51.50::numeric, 'the edited MH replaced the old value'
);
select is(
  (select avg_mh from public.lab_mooney_results where material = 'E00030S T'),
  null::numeric, 'a tab without AVG/SD keeps them null'
);

-- ชีตที่ถูกลบแถวออก: กระจกสะท้อนชีตจึงลบแถวนั้นตาม (ตารางเล็ก ไม่ติดด่านกันลบเกินครึ่ง)
select is(
  public.app_lab_mooney_import((select jsonb_path_query_array(current_setting('lab.rows_small')::jsonb, '$[0 to 2]'))),
  '{"rows":3,"inserted":0,"updated":3,"deleted":1}'::jsonb,
  'a row removed from the sheet is removed from the table'
);
select is(
  (select count(*)::integer from public.lab_mooney_results where material = 'E00030S T'),
  0, 'the removed row is gone'
);

-- ด่านกันลบเกินครึ่ง
select is(
  (public.app_lab_mooney_import(current_setting('lab.rows_20')::jsonb) ->> 'inserted')::integer,
  20, 'a bulk import of 20 rows succeeds'
);
-- นำเข้าเป็นกระจกสะท้อนชีต: ชีตชุดนี้ไม่มี A1802 แถวเดิม 3 แถว (น้อยกว่า 10 จึงไม่ติดด่าน) ถูกลบตาม
select is((select count(*)::integer from public.lab_mooney_results), 20, 'the table mirrors the new sheet (20 rows)');
select throws_ok(
  $$ select public.app_lab_mooney_import(current_setting('lab.rows_5')::jsonb) $$,
  'LAB_IMPORT_TOO_DESTRUCTIVE', 'an import that would delete more than half of the data is refused'
);
select is((select count(*)::integer from public.lab_mooney_results), 20, 'the refused import changed nothing');
select is(
  public.app_lab_mooney_import(current_setting('lab.rows_5')::jsonb, true),
  '{"rows":5,"inserted":0,"updated":5,"deleted":15}'::jsonb,
  'the same import goes through when explicitly forced'
);
select is((select count(*)::integer from public.lab_mooney_results), 5, 'the forced import mirrored the sheet');

reset role;

select is(
  (select count(*)::integer from public.audit_logs where entity_type = 'lab_mooney_results' and action = 'IMPORT'),
  6, 'every successful import wrote an audit row'
);

-- กลับไปมีข้อมูลชุดเล็กจริงสำหรับตอนทดสอบการอ่าน
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select public.app_lab_mooney_import(current_setting('lab.rows_small')::jsonb, true);
reset role;

-- 5. อ่านข้อมูล: อนุญาต ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

select is(public.app_lab_access(), true, 'an active admin has access to MNP LAB');
select is(
  (select jsonb_array_length(public.app_lab_mooney_overview() -> 'materials')),
  2, 'the overview lists the 2 materials'
);
select is(
  (select m ->> 'result_count' from jsonb_array_elements(public.app_lab_mooney_overview() -> 'materials') m where m ->> 'material' = 'A1802'),
  '3', 'the overview counts the rows of a material'
);
select is(
  (select m ->> 'last_tested' from jsonb_array_elements(public.app_lab_mooney_overview() -> 'materials') m where m ->> 'material' = 'E00030S T'),
  '2026-09-23', 'the overview shows the last test date of a material'
);
select isnt(public.app_lab_mooney_overview() ->> 'synced_at', null, 'the overview shows when the sheet was last synced');
select is(
  (select jsonb_array_length(public.app_lab_mooney_results('A1802'))),
  3, 'the results of a material list every row'
);
select is(
  public.app_lab_mooney_results('A1802') -> 0 ->> 'sample_id',
  '113', 'results are newest first'
);
select is(
  public.app_lab_mooney_results(' A1802 ') -> 0 ->> 'sample_id',
  '113', 'the material name is trimmed'
);
select is(
  (public.app_lab_mooney_results('A1802') -> 0 ->> 'avg_mh')::numeric,
  50.33::numeric, 'the sheet AVG is returned as stored'
);
select is(public.app_lab_mooney_results('NO-SUCH-MATERIAL'), '[]'::jsonb, 'an unknown material returns an empty list');
select throws_ok(
  $$ select public.app_lab_mooney_results('   ') $$,
  'LAB_INVALID_MATERIAL', 'a blank material name is rejected'
);
select throws_ok(
  $$ select count(*) from public.lab_mooney_results $$,
  '42501', null,
  'even an admin cannot read the table directly through the Data API'
);
reset role;

-- 6. อ่านข้อมูล: ปฏิเสธ -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'a regular employee has no access');
select throws_ok(
  $$ select public.app_lab_mooney_overview() $$,
  'NOT_AUTHORIZED', 'a regular employee cannot read the overview'
);
select throws_ok(
  $$ select public.app_lab_mooney_results('A1802') $$,
  'NOT_AUTHORIZED', 'a regular employee cannot read the results'
);
select throws_ok(
  $$ select count(*) from public.lab_mooney_results $$,
  '42501', null,
  'a regular employee cannot read the table directly'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'an admin whose account is deactivated has no access');
select throws_ok(
  $$ select public.app_lab_mooney_results('A1802') $$,
  'NOT_AUTHORIZED', 'a deactivated admin cannot read the results'
);
reset role;

-- ผู้ล็อกอินที่ไม่มีข้อมูลพนักงาน (auth user ไม่ผูกกับ employees)
insert into auth.users (id, email, raw_user_meta_data)
values ('81000000-0000-0000-0000-000000000009', 'lab-unlinked@mnp.local', '{}'::jsonb);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'a signed-in user with no employee record has no access');
select throws_ok(
  $$ select public.app_lab_mooney_overview() $$,
  'NOT_AUTHORIZED', 'a signed-in user with no employee record cannot read the overview'
);
reset role;

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.app_lab_access() $$, '42501', null, 'anon cannot check access');
select throws_ok($$ select public.app_lab_mooney_overview() $$, '42501', null, 'anon cannot read the overview');
select throws_ok($$ select public.app_lab_mooney_results('A1802') $$, '42501', null, 'anon cannot read the results');
select throws_ok($$ select count(*) from public.lab_mooney_results $$, '42501', null, 'anon cannot read the table');
reset role;

-- ผู้ล็อกอินที่ไม่มี sub (JWT ผิดรูป) ต้องไม่ผ่านด้วย
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_lab_access() $$, 'AUTH_REQUIRED', 'a session without a user id is asked to sign in');
select throws_ok($$ select public.app_lab_mooney_overview() $$, 'AUTH_REQUIRED', 'the overview requires a signed-in user');
reset role;

-- 7. สิทธิ์ตามบทบาทปัจจุบัน: ถอนบทบาท admin แล้วเข้าไม่ได้ทันที -------------------------
update public.employees set role_id = '20000000-0000-0000-0000-000000000001'
where id = '50000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_access(), false, 'an admin demoted to staff loses access immediately');
select throws_ok(
  $$ select public.app_lab_mooney_results('A1802') $$,
  'NOT_AUTHORIZED', 'a demoted admin can no longer read the results'
);
reset role;

-- 8. ด่านโหมดทดสอบ: ตารางนี้ผูกด่านเขียนของโหมดทดสอบแล้ว -------------------------------
select ok(
  exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'public.lab_mooney_results'::regclass and t.tgname = 'sandbox_guard' and not t.tgisinternal
  ),
  'lab_mooney_results is covered by the sandbox write guard'
);

select * from finish();
rollback;
