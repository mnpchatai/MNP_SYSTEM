-- ทดสอบขั้นลงนาม ผจก.ทั่วไป ของ NCR กับบัญชี admin ที่ตั้ง "บทบาทหลักในการทำงาน" (employees.acting_role_id)
-- นิยามจาก 20261102010000_ncr_gm_signoff_admin_acting_role.sql (ลำดับลงนามเต็มทดสอบใน ncr_phase1.test.sql)
--   1) private.employee_working_role_code: ค่าที่คืน และไม่เปิดให้ client เรียกตรง
--   2) ผู้รับแจ้งเตือน/งานค้างของขั้น ผจก.ทั่วไป (private.ncr_audience) นับบทบาทหลัก กิ่งอื่นยังใช้ role จริง
--   3) ขั้น ผจก.ทั่วไป: admin ตามบทบาทหลักขอข้อมูล/ลงนามได้ ผจก.ทั่วไปตัวจริงยังลงนามได้
--      ปฏิเสธ: admin ที่ไม่ได้ตั้งบทบาทหลัก, admin ที่ตั้งบทบาทอื่น, ผจก.โรงงานตัวจริง
--   4) ขั้น ผจก.แผนก QA และ ผจก.โรงงาน ไม่เปลี่ยน (ยังดู role จริง) และแจ้งเตือนขั้น ผจก.ทั่วไป ถึง admin ตามบทบาทหลัก
--   5) โหมดทดสอบใช้สิทธิ์ของบัญชีทดสอบ (persona) ไม่ใช่บทบาทหลักของ admin
--   6) เปลี่ยนบัญชีออกจาก admin แล้วบทบาทหลักหายไป
begin;

create extension if not exists pgtap with schema extensions;
select plan(27);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79700000-0000-0000-0000-000000000001', 'ncrgm-reporter@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000002', 'ncrgm-real-gm@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000003', 'ncrgm-admin-gm@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000004', 'ncrgm-admin-plain@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000005', 'ncrgm-admin-fm@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000006', 'ncrgm-real-fm@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000007', 'ncrgm-admin-qa@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, acting_role_id, auth_user_id) values
  ('79700000-0000-0000-0000-000000000101', 'NCRGM-REP', 'ทดสอบ', 'ผู้รายงาน RB', 'ncrgm-reporter@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), null, '79700000-0000-0000-0000-000000000001'),
  ('79700000-0000-0000-0000-000000000102', 'NCRGM-REAL-GM', 'ทดสอบ', 'ผจก.ทั่วไปตัวจริง', 'ncrgm-real-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'general_manager'), null, '79700000-0000-0000-0000-000000000002'),
  ('79700000-0000-0000-0000-000000000103', 'NCRGM-ADMIN-GM', 'ทดสอบ', 'admin ผจก.ทั่วไป', 'ncrgm-admin-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'general_manager'), '79700000-0000-0000-0000-000000000003'),
  ('79700000-0000-0000-0000-000000000104', 'NCRGM-ADMIN', 'ทดสอบ', 'admin ไม่ตั้งบทบาท', 'ncrgm-admin-plain@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), null, '79700000-0000-0000-0000-000000000004'),
  ('79700000-0000-0000-0000-000000000105', 'NCRGM-ADMIN-FM', 'ทดสอบ', 'admin ผจก.โรงงาน', 'ncrgm-admin-fm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'factory_manager'), '79700000-0000-0000-0000-000000000005'),
  ('79700000-0000-0000-0000-000000000106', 'NCRGM-REAL-FM', 'ทดสอบ', 'ผจก.โรงงานตัวจริง', 'ncrgm-real-fm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), null, '79700000-0000-0000-0000-000000000006'),
  ('79700000-0000-0000-0000-000000000107', 'NCRGM-ADMIN-QA', 'ทดสอบ', 'admin ผจก. QA', 'ncrgm-admin-qa@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'department_manager'), '79700000-0000-0000-0000-000000000007');
select set_config('test.sbx_qa', (select id::text from public.employees where employee_no = 'SBX-QA-STAFF'), true);

-- ใบจริง 5 ใบ: A ขอข้อมูล, B admin ลงนาม, C ผจก.ทั่วไปตัวจริงลงนาม (อยู่ขั้น ผจก.ทั่วไป), D ขั้น ผจก.โรงงาน, E ขั้น ผจก.แผนก QA
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_a', public.app_ncr_issue('NCRGM_A', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_b', public.app_ncr_issue('NCRGM_B', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_c', public.app_ncr_issue('NCRGM_C', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_d', public.app_ncr_issue('NCRGM_D', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_e', public.app_ncr_issue('NCRGM_E', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
reset role;

-- ตั้งสถานะตรง ๆ (ขั้นตอนเต็มทดสอบไว้ใน ncr_phase1.test.sql) ล้าง jwt ก่อนเพื่อให้ trigger โหมดทดสอบถือเป็นงานระบบ
select set_config('request.jwt.claims', '', true);
update public.ncr_reports
set status = 'awaiting_signoff',
    signoff_qa_by = '79700000-0000-0000-0000-000000000107', signoff_qa_at = now(),
    signoff_factory_by = '79700000-0000-0000-0000-000000000106', signoff_factory_at = now()
where id in (current_setting('test.ncr_a')::uuid, current_setting('test.ncr_b')::uuid, current_setting('test.ncr_c')::uuid);
update public.ncr_reports
set status = 'awaiting_signoff', signoff_qa_by = '79700000-0000-0000-0000-000000000107', signoff_qa_at = now()
where id = current_setting('test.ncr_d')::uuid;
update public.ncr_reports set status = 'awaiting_signoff' where id = current_setting('test.ncr_e')::uuid;

-- 1) ตัวช่วยบทบาทที่ทำงาน ------------------------------------------------------------------------------
select ok(
  not has_function_privilege('authenticated', 'private.employee_working_role_code(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.employee_working_role_code(uuid)', 'execute'),
  'clients cannot call the working-role helper directly'
);
select is(private.employee_working_role_code('79700000-0000-0000-0000-000000000103'), 'general_manager',
  'an admin working as general manager has the general manager working role');
select is(private.employee_working_role_code('79700000-0000-0000-0000-000000000104'), 'admin',
  'an admin without a working role keeps the admin role');
select is(private.employee_working_role_code('79700000-0000-0000-0000-000000000102'), 'general_manager',
  'a real general manager has the general manager working role');
select is(private.employee_working_role_code('79700000-0000-0000-0000-0000000009ff'), null::text,
  'an unknown employee has no working role');

-- 2) ผู้รับแจ้งเตือนและงานค้าง ---------------------------------------------------------------------------
select ok(
  exists (select 1 from private.ncr_audience(current_setting('test.ncr_c')::uuid, 'general_manager') a where a.employee_id = '79700000-0000-0000-0000-000000000103')
    and exists (select 1 from private.ncr_audience(current_setting('test.ncr_c')::uuid, 'general_manager') a where a.employee_id = '79700000-0000-0000-0000-000000000102'),
  'the general manager audience includes the admin working as general manager and the real general manager'
);
select ok(
  not exists (select 1 from private.ncr_audience(current_setting('test.ncr_c')::uuid, 'general_manager') a
              where a.employee_id in ('79700000-0000-0000-0000-000000000104', '79700000-0000-0000-0000-000000000105')),
  'the general manager audience excludes an admin without a working role and an admin working as factory manager'
);
select ok(
  not exists (select 1 from private.ncr_audience(current_setting('test.ncr_c')::uuid, 'factory') a where a.employee_id = '79700000-0000-0000-0000-000000000105')
    and exists (select 1 from private.ncr_audience(current_setting('test.ncr_c')::uuid, 'factory') a where a.employee_id = '79700000-0000-0000-0000-000000000106'),
  'the factory audience still uses real roles (an admin working as factory manager is not included)'
);
select ok(
  exists (select 1 from private.pending_work_items(now()) w
          where w.holder_id = '79700000-0000-0000-0000-000000000103' and w.item_type = 'ncr' and w.item_id = current_setting('test.ncr_c')::uuid),
  'an NCR waiting for the general manager is pending work for the admin working as general manager'
);

-- 3) ขั้น ผจก.ทั่วไป ---------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_a')), 'NOT_AUTHORIZED',
  'an admin without a working role cannot sign the general manager step');
select throws_ok(format('select public.app_ncr_request_info(%L::uuid, %L)', current_setting('test.ncr_a'), 'ขอใบรับรองผลตรวจซ้ำ'), 'NOT_AUTHORIZED',
  'an admin without a working role cannot request info at the general manager step');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_a')), 'NOT_AUTHORIZED',
  'an admin working as factory manager cannot sign the general manager step');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_a')), 'NOT_AUTHORIZED',
  'a real factory manager cannot sign the general manager step');

select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(format('select public.app_ncr_request_info(%L::uuid, %L)', current_setting('test.ncr_a'), 'ขอใบรับรองผลตรวจซ้ำ'),
  'an admin working as general manager requests more info at the general manager step');
select is(public.app_ncr_signoff(current_setting('test.ncr_b')::uuid), 'gm',
  'an admin working as general manager signs the general manager step');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_ncr_signoff(current_setting('test.ncr_c')::uuid), 'gm',
  'a real general manager still signs the general manager step');
reset role;

select is((select step || ':' || requested_by::text from public.ncr_info_requests where ncr_id = current_setting('test.ncr_a')::uuid),
  'gm:79700000-0000-0000-0000-000000000103', 'the info request is recorded at the gm step under the admin account');
select is((select status from public.ncr_reports where id = current_setting('test.ncr_a')::uuid), 'awaiting_info',
  'the NCR waits for the requested info');
select is((select status || ':' || signoff_gm_by::text from public.ncr_reports where id = current_setting('test.ncr_b')::uuid),
  'closed:79700000-0000-0000-0000-000000000103', 'the NCR is closed and the signature is recorded under the admin account');

-- 4) ขั้นอื่นไม่เปลี่ยน และแจ้งเตือนขั้น ผจก.ทั่วไป ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_d')), 'NOT_AUTHORIZED',
  'the factory manager step still needs the real role (an admin working as factory manager is refused)');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is(public.app_ncr_signoff(current_setting('test.ncr_d')::uuid), 'factory', 'a real factory manager signs the factory step');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_e')), 'NOT_AUTHORIZED',
  'the QA step still needs the real role (an admin in QA working as department manager is refused)');
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_e')), 'NOT_AUTHORIZED',
  'an admin working as general manager cannot sign an earlier step');
reset role;

select ok(
  exists (select 1 from public.notifications where recipient_id = '79700000-0000-0000-0000-000000000103'
          and title = 'NCR รอลงนามปิด (ผจก.ทั่วไป)' and action_url = '/ncr/' || current_setting('test.ncr_d')),
  'the admin working as general manager is notified when the NCR reaches the general manager step'
);
select ok(
  not exists (select 1 from public.notifications where recipient_id = '79700000-0000-0000-0000-000000000104'
              and action_url = '/ncr/' || current_setting('test.ncr_d')),
  'an admin without a working role is not notified'
);

-- 5) โหมดทดสอบ: สิทธิ์มาจากบัญชีทดสอบ (พนักงาน QA) ไม่ใช่บทบาทหลักของ admin ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select set_config('test.ncr_test', public.app_ncr_issue('NCRGM_TEST', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ผิวมีรอยเกินเกณฑ์ที่กำหนดในสเปค')->>'id', true);
reset role;
select set_config('request.jwt.claims', '', true);
update public.ncr_reports
set status = 'awaiting_signoff',
    signoff_qa_by = '79700000-0000-0000-0000-000000000107', signoff_qa_at = now(),
    signoff_factory_by = '79700000-0000-0000-0000-000000000106', signoff_factory_at = now()
where id = current_setting('test.ncr_test')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(format('select public.app_ncr_signoff(%L::uuid)', current_setting('test.ncr_test')), 'NOT_AUTHORIZED',
  'test mode: an admin working as general manager acts as the QA staff persona and cannot sign the general manager step');
select public.app_sandbox_exit();
reset role;

-- 6) เปลี่ยนออกจาก admin: trigger ล้างบทบาทหลัก -------------------------------------------------------------
update public.employees set role_id = (select id from public.roles where code = 'staff') where employee_no = 'NCRGM-ADMIN-GM';
select is(private.employee_working_role_code('79700000-0000-0000-0000-000000000103'), 'staff',
  'an account moved from admin to staff loses the general manager working role');

select * from finish();
rollback;
