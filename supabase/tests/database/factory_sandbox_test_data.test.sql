-- ฝ่ายโรงงาน: หน้า "ข้อมูลทดสอบ" (20261014030000_factory_sandbox_test_data_summary.sql)
-- ครอบคลุม: สิทธิ์และการปฏิเสธ (ไม่มี session / พนักงานจริง / admin นอกโหมดทดสอบ) สถานะชุดข้อมูลตัวอย่าง
-- จำนวนที่นับเฉพาะข้อมูลทดสอบ (ข้อมูลจริงไม่ถูกนับ) จำนวนก่อนยืนยันตรงกับที่ล้างจริงและที่บันทึกใน audit และข้อมูลจริงไม่ถูกลบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. สิทธิ์ -------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.app_sandbox_factory_test_data()', 'execute'), 'anon cannot read the test data summary');
select ok(has_function_privilege('authenticated', 'public.app_sandbox_factory_test_data()', 'execute'),
  'signed-in users can call the summary API (it checks admin and test mode itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_test_data_counts()', 'execute'),
  'the shared counting helper is not callable directly');
select ok(not has_function_privilege('anon', 'public.app_sandbox_purge_factory()', 'execute'), 'anon still cannot purge');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกนับหรือลบ ----------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('84000000-0000-0000-0000-000000000001', 'testdata-admin@test.local', '{}'),
  ('84000000-0000-0000-0000-000000000002', 'testdata-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('84000000-0000-0000-0000-000000000101', 'TESTDATA-ADMIN', 'Data', 'Admin', 'testdata-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '84000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000102', 'TESTDATA-STAFF', 'Data', 'Staff', 'testdata-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '84000000-0000-0000-0000-000000000002');
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('84000000-0000-0000-0000-00000000f001', 'REAL-TESTDATA-01', 'Item จริงสำหรับตรวจการแยกโหมด', 'RM', 'rubber', 'MNP', 'KG', 'buy');
select set_config('test.p_pp', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);

-- 3. ปฏิเสธ -------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_factory_test_data()', 'AUTH_REQUIRED', 'the summary needs a session');
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_factory_test_data()', 'NOT_AUTHORIZED', 'a real staff account cannot read the summary');
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_factory_test_data()', 'SANDBOX_NOT_ACTIVE', 'the summary needs test mode even for an admin');

-- 4. โหมดทดสอบว่าง -----------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_pp')::uuid);
select set_config('test.empty', public.app_sandbox_factory_test_data()::text, true);
select is(current_setting('test.empty')::jsonb ->> 'total', '0', 'test mode starts with nothing to purge (the real item is not counted)');
select is(current_setting('test.empty')::jsonb #>> '{counts,items}', '0', 'no test items yet');
select is(current_setting('test.empty')::jsonb #>> '{sets,sample_available}', 'true', 'the 16-item sample set can be added to an empty register');
select is(current_setting('test.empty')::jsonb #>> '{sets,trial_loaded}', 'false', 'the trial set is not loaded yet');
select is(current_setting('test.empty')::jsonb #>> '{sets,megaform_loaded}', 'false', 'the MEGAFORM set is not loaded yet');
select is((select count(*) from jsonb_object_keys(current_setting('test.empty')::jsonb -> 'counts'))::integer, 12, 'the summary reports twelve groups');

-- 5. หลังเติมชุดทดลอง ----------------------------------------------------------------
select set_config('test.seed', public.app_sandbox_seed_factory_trial()::text, true);
select set_config('test.after', public.app_sandbox_factory_test_data()::text, true);
select is(current_setting('test.after')::jsonb #>> '{counts,items}', current_setting('test.seed')::jsonb ->> 'items',
  'the item count matches what the trial seed reported');
select is(current_setting('test.after')::jsonb #>> '{counts,boms}', current_setting('test.seed')::jsonb ->> 'boms',
  'the BOM count matches what the trial seed reported');
select is((current_setting('test.after')::jsonb #>> '{counts,items}')::integer,
  jsonb_array_length(public.app_factory_master_data() -> 'items'), 'the item count matches the register the persona sees');
select ok((current_setting('test.after')::jsonb #>> '{counts,details}')::integer > 0, 'lines, steps and history are counted as details');
select is((current_setting('test.after')::jsonb ->> 'total')::bigint,
  (select sum(value::bigint) from jsonb_each_text(current_setting('test.after')::jsonb -> 'counts'))::bigint, 'the total is the sum of the groups');
select is(current_setting('test.after')::jsonb #>> '{sets,trial_loaded}', 'true', 'the trial set shows as loaded');
select is(current_setting('test.after')::jsonb #>> '{sets,sample_available}', 'false', 'the sample set needs an empty register');
select is(current_setting('test.after')::jsonb #>> '{sets,megaform_loaded}', 'false', 'the MEGAFORM set is still not loaded');

-- 6. ล้าง: จำนวนที่เห็นก่อนยืนยัน = จำนวนที่ล้างจริง = ที่บันทึกใน audit ---------------------------
select set_config('test.purge', public.app_sandbox_purge_factory()::text, true);
select is(current_setting('test.purge')::jsonb -> 'counts', current_setting('test.after')::jsonb -> 'counts',
  'the purge removes exactly what the summary listed');
select is(current_setting('test.purge')::jsonb ->> 'deleted', current_setting('test.after')::jsonb #>> '{counts,items}',
  'the purge still reports the deleted item count for existing callers');
select is(public.app_sandbox_factory_test_data() ->> 'total', '0', 'nothing is left after the purge');
select is(public.app_sandbox_factory_test_data() #>> '{sets,sample_available}', 'true', 'the sample set can be added again');

reset role;
select is((select metadata -> 'counts' from public.audit_logs
           where action = 'SANDBOX_PURGE_FACTORY' and actor_id = '84000000-0000-0000-0000-000000000101'
           order by created_at desc limit 1),
  current_setting('test.after')::jsonb -> 'counts', 'the audit log records the per-group counts under the real admin');
select is((select count(*) from public.factory_items where id = '84000000-0000-0000-0000-00000000f001')::integer, 1, 'the real item is untouched');

select * from finish();
rollback;
