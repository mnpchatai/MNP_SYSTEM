-- ทดสอบ 20261017050000_ncr_number_start_qa052.sql
--   1) ตัวนับ NCR จริงปี 2026 = 51 ใบจริงใบแรกจึงได้ QA052/26 ใบถัดไป QA053/26
--   2) ใบทดสอบใช้ตัวนับแยก (TEST-QA…) ไม่ขยับตัวนับจริง
-- ข้อ "ใบแรกได้ QA052/26" ตรวจเฉพาะตอนรันในปี 2026 ตามเวลา Asia/Bangkok (ตัวนับรีเซ็ตทุกปี ปีอื่นเริ่มที่ QA001) ปีอื่นข้อนี้ผ่านโดยปริยาย
begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  51,
  'the real NCR counter for 2026 is 51, so the next real number is QA052/26'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79600000-0000-0000-0000-000000000001', 'ncrno-rb-staff@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000002', 'ncrno-admin@mnp.local', '{}'::jsonb);
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79600000-0000-0000-0000-000000000101', 'NCRNO-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrno-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79600000-0000-0000-0000-000000000001'),
  ('79600000-0000-0000-0000-000000000102', 'NCRNO-ADMIN', 'ทดสอบ', 'ผู้ดูแล', 'ncrno-admin@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '79600000-0000-0000-0000-000000000002');
select set_config('test.sbx_qa', (select id::text from public.employees where employee_no = 'SBX-QA-STAFF'), true);
select set_config('test.is_2026', (to_char(now() at time zone 'Asia/Bangkok', 'YY') = '26')::text, true);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.first_no', public.app_ncr_issue('NCRNO_1', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ใบแรกของระบบจริงต้องต่อจากกระดาษ')->>'ncr_no', true);
select set_config('test.second_no', public.app_ncr_issue('NCRNO_2', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ใบที่สองต้องเรียงต่อจากใบแรก')->>'ncr_no', true);

select ok(
  current_setting('test.first_no') ~ '^QA[0-9]{3}/[0-9]{2}$',
  'a real NCR number keeps the QAxxx/yy format'
);
select ok(
  current_setting('test.is_2026')::boolean is not true or current_setting('test.first_no') = 'QA052/26',
  'in 2026 the first real NCR is QA052/26'
);
select ok(
  current_setting('test.is_2026')::boolean is not true or current_setting('test.second_no') = 'QA053/26',
  'in 2026 the second real NCR is QA053/26'
);

-- ใบทดสอบ: ตัวนับแยก ไม่ขยับตัวนับจริง -------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select set_config('test.test_no', public.app_ncr_issue('NCRNO_T', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ใบทดสอบต้องไม่ขยับตัวนับจริง')->>'ncr_no', true);
select public.app_sandbox_exit();
reset role;

select matches(
  current_setting('test.test_no'),
  '^TEST-QA[0-9]{3}/[0-9]{2}$',
  'a test-mode NCR uses the TEST- series'
);
select is(
  (select last_number from public.document_counters where department_code = 'NCR' and year_key = '26'),
  case when current_setting('test.is_2026')::boolean then 53 else 51 end,
  'the real counter moved only for the two real NCRs (a test-mode NCR does not move it)'
);
select ok(
  (select last_number from public.document_counters where department_code = 'NCR-TEST' and year_key = to_char(now() at time zone 'Asia/Bangkok', 'YY')) >= 1,
  'test-mode NCRs count in their own NCR-TEST counter'
);
select ok(
  (select count(*) from public.document_counters where department_code = 'NCR' and year_key = '26') = 1,
  'there is exactly one real counter row for 2026'
);

select * from finish();
rollback;
