-- ทดสอบกราฟแรงบิด MDR หลายวัน (20261217010000_lab_mdr_curves.sql)
--   สิทธิ์: anon เรียกไม่ได้ ผู้มีสิทธิ์ LAB อ่านได้ staff/ไม่มี subject/admin ที่ปิดใช้งานถูกปฏิเสธ
--   ข้อมูล: วันเดียว = ทุกวินาที หลายวัน = ทุก 5 วินาที ไม่เกิน 1,000 กราฟ (ตัดทั้งวันจากวันเก่า) ค่าผิดรูปแบบถูกปฏิเสธ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. สิทธิ์ของฟังก์ชัน ------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.app_lab_mdr_curves(text,text,date,date)', 'execute'), 'anon cannot read curves');
select ok(has_function_privilege('authenticated', 'public.app_lab_mdr_curves(text,text,date,date)', 'execute'),
  'signed-in users reach the curves RPC (it checks LAB access)');
select ok((select prosecdef from pg_proc where oid = 'public.app_lab_mdr_curves(text,text,date,date)'::regprocedure), 'curves RPC is security definer');
select ok((select proconfig @> array['search_path=""'] from pg_proc where oid = 'public.app_lab_mdr_curves(text,text,date,date)'::regprocedure),
  'curves RPC pins an empty search_path');
select is((select provolatile::text from pg_proc where oid = 'public.app_lab_mdr_curves(text,text,date,date)'::regprocedure), 's', 'curves RPC is read-only (stable)');

insert into auth.users(id, email, raw_user_meta_data) values
('84000000-0000-0000-0000-000000000001', 'lab-curves-admin@mnp.local', '{}'),
('84000000-0000-0000-0000-000000000002', 'lab-curves-staff@mnp.local', '{}');
update public.employees set auth_user_id = '84000000-0000-0000-0000-000000000001' where id = '50000000-0000-0000-0000-000000000001';
update public.employees set auth_user_id = '84000000-0000-0000-0000-000000000002' where id = '50000000-0000-0000-0000-000000000003';

-- ข้อมูลตรงลงตาราง (ไม่ผ่านการอัปโหลด): A2004 สามครั้งในสองวัน กราฟ 60 วินาที ค่าตามวินาที (ดูการสุ่มตัวอย่างได้ตรง) + F2 หนึ่งครั้งไม่มีกราฟ
-- BIG = 70 วัน วันละ 15 ครั้ง (1,050 กราฟ เกินเพดาน 1,000) กราฟสั้น 10 จุด
insert into public.lab_mdr_tests (test_name, formula, part, machine_id, test_date, test_time, temperature_c, set_minutes, ml, mh, curve)
select 'A2004F1', 'A2004', 'F1', v.machine_id, v.test_date::date, v.test_time::time, 155, 1, 0, 59,
       (select array_agg(s::real order by s) from generate_series(0, 59) s)
from (values ('111', '2026-11-02', '15:49'), ('112', '2026-11-02', '16:21'), ('121', '2026-11-03', '08:25')) as v(machine_id, test_date, test_time);
insert into public.lab_mdr_tests (test_name, formula, part, machine_id, test_date, test_time, temperature_c, set_minutes, ml, mh, curve)
values ('A2004F2', 'A2004', 'F2', '111', '2026-11-03', '15:12', 155, 30, 8444, 34131, null);
insert into public.lab_mdr_tests (test_name, formula, part, machine_id, test_date, test_time, temperature_c, set_minutes, ml, mh, curve)
select 'BIGF1', 'BIG', 'F1', 'M' || n, date '2026-01-01' + d, time '08:00' + n * interval '1 minute', 155, 1, 1, 2,
       array[1, 1, 1, 1, 1, 2, 2, 2, 2, 2]::real[]
from generate_series(0, 69) d, generate_series(1, 15) n;

-- 2. ผู้มีสิทธิ์ LAB อ่าน ------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-02', '2026-11-02')->>'step', '1', 'one day keeps every second');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-02', '2026-11-02')->'curves'), 2, 'one day returns only that day''s curves');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-02', '2026-11-02')->'curves'->0->'curve'), 60, 'one-day curve is not downsampled');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->>'step', '5', 'several days are sampled every 5 seconds');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->'curves'), 3, 'every curve of the range');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->'curves'->0->'curve', '[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]'::jsonb,
  'downsampling keeps second 0, 5, 10, … (point k = second 5k)');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->'curves'->0->>'test_date', '2026-11-02', 'curves ordered oldest day first');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->'curves'->2->>'test_date', '2026-11-03', 'each curve carries its day');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->>'from', '2026-11-02', 'from = first day actually sent');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')->>'truncated', 'false', 'a small range is complete');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'A2004', '2020-01-01', '2020-01-31')->'curves'), 0, 'a range without tests is empty (no error)');
select is(public.app_lab_mdr_curves('F1', 'A2004', '2020-01-01', '2020-01-31')->>'from', null, 'empty range has no first day');
select is(jsonb_array_length(public.app_lab_mdr_curves('F2', 'A2004', '2026-11-01', '2026-11-03')->'curves'), 0, 'swelling tests have no curves');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'missing', '2026-11-01', '2026-11-03')->'curves'), 0, 'unknown formula is empty');

-- เพดาน 1,000 กราฟ: 70 วัน × 15 = 1,050 → 66 วันล่าสุด (990 กราฟ) ไม่ตัดกลางวัน
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'BIG', '2026-01-01', '2026-03-31')->'curves'), 990, 'never more than 1,000 curves, whole days only');
select is(public.app_lab_mdr_curves('F1', 'BIG', '2026-01-01', '2026-03-31')->>'truncated', 'true', 'a cut range says so');
select is(public.app_lab_mdr_curves('F1', 'BIG', '2026-01-01', '2026-03-31')->>'from', '2026-01-05', 'the oldest days are the ones left out');
select is(public.app_lab_mdr_curves('F1', 'BIG', '2026-01-01', '2026-03-31')->>'to', '2026-03-11', 'the newest day is kept');
select is(jsonb_array_length(public.app_lab_mdr_curves('F1', 'BIG', '2026-01-01', '2026-03-31')->'curves'->0->'curve'), 2, 'many days are downsampled too');

-- ค่าผิดรูปแบบ
select throws_ok($$select public.app_lab_mdr_curves('F3', 'A2004', '2026-11-01', '2026-11-03')$$, 'LAB_MDR_INVALID_PART', 'unknown part refused');
select throws_ok($$select public.app_lab_mdr_curves('F1', null, '2026-11-01', '2026-11-03')$$, 'LAB_MDR_INVALID_FORMULA', 'formula is required');
select throws_ok($$select public.app_lab_mdr_curves('F1', repeat('x', 41), '2026-11-01', '2026-11-03')$$, 'LAB_MDR_INVALID_FORMULA', 'over-long formula refused');
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', '2026-11-03', '2026-11-01')$$, 'LAB_MDR_INVALID_RANGE', 'from after to refused');
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', null, '2026-11-01')$$, 'LAB_MDR_INVALID_RANGE', 'missing from refused');
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', '2000-01-01', '2026-11-01')$$, 'LAB_MDR_INVALID_RANGE', 'a span over ten years refused');

-- 3. ผู้ไม่มีสิทธิ์ -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')$$, 'NOT_AUTHORIZED', 'staff without LAB access cannot read curves');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')$$, 'AUTH_REQUIRED', 'missing subject denied');
reset role;
update public.employees set is_active = false where id = '50000000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_lab_mdr_curves('F1', 'A2004', '2026-11-01', '2026-11-03')$$, 'NOT_AUTHORIZED', 'inactive admin immediately loses access');
reset role;

select * from finish();
rollback;
