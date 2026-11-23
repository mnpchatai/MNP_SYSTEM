-- ทดสอบรายงานทดสอบ MDR ของ MNP LAB (20261215010000_lab_mdr_tests.sql)
--   สิทธิ์: anon เรียกไม่ได้ ตารางอ่าน/เขียนตรงไม่ได้ ผู้มีสิทธิ์ LAB อัปโหลดและอ่านได้ staff/ไม่มี subject/admin ที่ปิดใช้งานถูกปฏิเสธ
--   ข้อมูล: แยกสูตร/ชุดจากชื่อที่ฐานข้อมูล ซ้ำไม่เขียนทับ ข้อมูลผิดรูปแบบถูกปฏิเสธทั้งชุด กราฟส่งเฉพาะวันที่เลือก
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ---------------------------------------------------------
select ok((select relrowsecurity from pg_class where oid = 'public.lab_mdr_tests'::regclass), 'MDR table has RLS');
select ok(not has_table_privilege('authenticated', 'public.lab_mdr_tests', 'select'), 'users cannot read the table directly');
select ok(not has_table_privilege('authenticated', 'public.lab_mdr_tests', 'insert'), 'users cannot write the table directly');
select ok(not has_table_privilege('anon', 'public.lab_mdr_tests', 'select'), 'anon cannot read the table');
select ok(not has_function_privilege('anon', 'public.app_lab_mdr_upload(jsonb)', 'execute'), 'anon cannot upload');
select ok(not has_function_privilege('anon', 'public.app_lab_mdr_feed(text,text,date)', 'execute'), 'anon cannot read');
select ok(has_function_privilege('authenticated', 'public.app_lab_mdr_upload(jsonb)', 'execute'), 'signed-in users reach the upload RPC (it checks LAB access)');
select ok(has_function_privilege('authenticated', 'public.app_lab_mdr_feed(text,text,date)', 'execute'), 'signed-in users reach the feed RPC (it checks LAB access)');
select ok(exists (select 1 from pg_policy where polrelid = 'public.lab_mdr_tests'::regclass and polname = 'lab_only_no_access'),
  'table carries the lab-only guard policy');

insert into auth.users(id, email, raw_user_meta_data) values
('83000000-0000-0000-0000-000000000001', 'lab-mdr-admin@mnp.local', '{}'),
('83000000-0000-0000-0000-000000000002', 'lab-mdr-staff@mnp.local', '{}');
update public.employees set auth_user_id = '83000000-0000-0000-0000-000000000001' where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '83000000-0000-0000-0000-000000000002' where id = '50000000-0000-0000-0000-000000000003';

-- กราฟสั้น 60 วินาที: ต่ำสุด 2.0 ที่วินาที 5 แล้วขึ้นถึง 8.0 (ts2 = วินาทีแรกที่ ≥ 4.0)
create temporary table mdr_fixture as
with curve as (
  select jsonb_agg(case when s < 5 then 3 - s * 0.2 when s < 35 then 2 + (s - 5) * 0.2 else 8 end order by s) as c
  from generate_series(0, 59) s
)
select jsonb_build_array(
  jsonb_build_object('name', 'A2004F1', 'machine_id', '111', 'test_date', '2026-11-02', 'test_time', '15:49',
    'temperature_c', 155, 'set_minutes', 1, 'ml', 2, 'mh', 8, 'ts1_s', 10, 'ts2_s', 15, 't50_s', 20, 't90_s', 32,
    'vc1', 12.47, 'vc2', 12.74, 'result', 'OK', 'curve', c, 'header', '{"Name":"A2004F1","ID":"111"}'::jsonb),
  jsonb_build_object('name', 'A2004F1', 'machine_id', '112', 'test_date', '2026-11-02', 'test_time', '16:21',
    'temperature_c', 155, 'set_minutes', 1, 'ml', 2, 'mh', 8, 'ts1_s', 10, 'ts2_s', 15, 't50_s', 20, 't90_s', 32,
    'vc1', null, 'vc2', null, 'result', 'OK', 'curve', c, 'header', '{}'::jsonb),
  jsonb_build_object('name', 'A2004F1', 'machine_id', '121', 'test_date', '2026-11-03', 'test_time', '08:25',
    'temperature_c', 155, 'set_minutes', 1, 'ml', 2, 'mh', 8, 'ts1_s', 10, 'ts2_s', 15, 't50_s', 20, 't90_s', 32,
    'vc1', null, 'vc2', null, 'result', 'OK', 'curve', c, 'header', '{}'::jsonb),
  jsonb_build_object('name', 'A2004F2', 'machine_id', '111', 'test_date', '2026-11-03', 'test_time', '15:12',
    'temperature_c', 155, 'set_minutes', 30, 'ml', 8444, 'mh', 34131, 'ts1_s', null, 'ts2_s', null, 't50_s', 61, 't90_s', 261,
    'vc1', 4.85, 'vc2', 4.88, 'result', 'OK', 'curve', null, 'header', '{}'::jsonb)
) as tests, (select c from curve) as curve
from curve;
grant select on mdr_fixture to authenticated;

-- 2. ผู้มีสิทธิ์ LAB อัปโหลด ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_mdr_feed('F1')->'formulas', '[]'::jsonb, 'empty before any upload (no error)');
select is((public.app_lab_mdr_upload(tests)->>'inserted')::integer, 4, 'LAB user uploads four tests') from mdr_fixture;
select is(public.app_lab_mdr_upload(tests), '{"received":4,"inserted":0,"duplicates":4}'::jsonb,
  'the same files again are counted as duplicates and nothing is rewritten') from mdr_fixture;
reset role;

select is((select formula || '/' || part from public.lab_mdr_tests where test_name = 'A2004F2'), 'A2004/F2', 'formula and part come from the name');
select is((select uploaded_by from public.lab_mdr_tests where machine_id = '111' and part = 'F1'),
  '50000000-0000-0000-0000-000000000001'::uuid, 'uploader is recorded');
select is((select count(*) from public.audit_logs where entity_type = 'lab_mdr_tests' and action = 'IMPORT'), 1::bigint,
  'one audit row for the upload that inserted, none for the all-duplicate upload');

-- 3. ข้อมูลผิดรูปแบบถูกปฏิเสธทั้งชุด ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_upload('[]')$$, 'LAB_MDR_INVALID_PAYLOAD', 'empty upload refused');
select throws_ok($$select public.app_lab_mdr_upload((select jsonb_agg(tests->0) from mdr_fixture, generate_series(1, 26)))$$,
  'LAB_MDR_INVALID_PAYLOAD', 'more than 25 tests per call refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(tests->0, '{name}', '"B0005"'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'name without F1/F2 refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"900"'), '{curve}', 'null'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'cure test without a curve refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"901"'), '{ml}', '2.5'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'ML that is not the curve minimum refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"902"'), '{t90_s}', '60'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 't90 beyond the end of the curve refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"903"'), '{ts1_s}', '20'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'ts1 after ts2 refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"904"'), '{ml}', '"2"'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'numbers sent as text refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"905"'), '{curve}',
  (select jsonb_agg(3) from generate_series(1, 7202))))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'curve longer than 7,201 points refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(jsonb_set(tests->0, '{machine_id}', '"906"'), '{test_date}', '"2026-13-40"'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'impossible date refused');
select throws_ok($$select public.app_lab_mdr_upload(jsonb_build_array(jsonb_set(tests->3, '{machine_id}', '"907"'), jsonb_set(tests->0, '{name}', '"A2004F3"'))) from mdr_fixture$$,
  'LAB_MDR_INVALID_TEST', 'one bad test rejects the whole call');
reset role;
select is((select count(*) from public.lab_mdr_tests), 4::bigint, 'refused uploads wrote nothing (the valid F2 in the mixed call rolled back)');

-- 4. อ่านผล ------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_mdr_feed('F1')->'formulas'->0->>'formula', 'A2004', 'formula list per part');
select is((public.app_lab_mdr_feed('F1')->'formulas'->0->>'tests')::integer, 3, 'F1 counts only cure tests');
select is((public.app_lab_mdr_feed('F1')->'formulas'->0->>'days')::integer, 2, 'test days counted');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1')->'tests'), 0, 'overview sends no results');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1', 'A2004')->'tests'), 3, 'formula page gets every test of the formula');
select is(public.app_lab_mdr_feed('F1', 'A2004')->>'curve_date', '2026-11-03', 'curves default to the latest test date');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1', 'A2004')->'curves'), 1, 'only that day''s curves are sent');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1', 'A2004', '2026-11-02')->'curves'), 2, 'a chosen day returns its curves');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1', 'A2004', '2026-11-02')->'curves'->0->'curve'), 60, 'curve keeps every second');
select is(public.app_lab_mdr_feed('F1', 'A2004', '2020-01-01')->>'curve_date', '2026-11-03', 'a day without tests falls back to the latest');
select is(public.app_lab_mdr_feed('F2', 'A2004')->'tests'->0->>'t90_s', '261', 'swelling results read from their own part');
select is(jsonb_array_length(public.app_lab_mdr_feed('F2', 'A2004')->'curves'), 0, 'swelling tests have no curves');
select is(jsonb_array_length(public.app_lab_mdr_feed('F1', 'missing')->'tests'), 0, 'unknown formula is empty');
select throws_ok($$select public.app_lab_mdr_feed('F3')$$, 'LAB_MDR_INVALID_PART', 'unknown part refused');
select throws_ok($$select public.app_lab_mdr_feed('F1', repeat('x', 41))$$, 'LAB_MDR_INVALID_FORMULA', 'over-long formula refused');

-- 5. ผู้ไม่มีสิทธิ์ ---------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_feed('F1')$$, 'NOT_AUTHORIZED', 'staff without LAB access cannot read');
select throws_ok($$select public.app_lab_mdr_upload(tests) from mdr_fixture$$, 'NOT_AUTHORIZED', 'staff without LAB access cannot upload');
select throws_ok($$select * from public.lab_mdr_tests$$, '42501', null, 'staff cannot select the table');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_feed('F1')$$, 'AUTH_REQUIRED', 'missing subject denied');
select throws_ok($$select public.app_lab_mdr_upload(tests) from mdr_fixture$$, 'AUTH_REQUIRED', 'missing subject cannot upload');
reset role;
update public.employees set is_active = false where id = '50000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_upload(tests) from mdr_fixture$$, 'NOT_AUTHORIZED', 'inactive admin immediately loses upload');
reset role;

select * from finish();
rollback;
