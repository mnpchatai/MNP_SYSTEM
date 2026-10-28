-- ทดสอบ private.can_edit_ncr_losses กับบัญชี admin ที่ตั้ง "บทบาทหลักในการทำงาน" (employees.acting_role_id)
-- นิยามจาก 20261101010000_ncr_loss_editors_admin_acting_role.sql (รายชื่อบทบาทเดิมทดสอบใน ncr_loss_editors_same_in_all_modes.test.sql)
--   1) admin ตามบทบาทหลัก: ผจก.ทั่วไป / ผจก.โรงงาน / ผช.ผจก.โรงงาน / ผจก.หรือผช.ผจก. ที่สังกัด QA กรอกได้
--      ปฏิเสธ: ผจก. ที่ไม่ได้สังกัด QA, staff, admin ที่ไม่ได้ตั้งบทบาทหลัก
--   2) ผ่าน RPC จริง (record / review / void) และบันทึกผู้ทำรายการเป็นบัญชี admin นั้น
--   3) โหมดทดสอบใช้สิทธิ์ของบัญชีทดสอบ (persona) ไม่ใช่บทบาทหลักของ admin
--   4) เปลี่ยนบัญชีออกจาก admin แล้วบทบาทหลักหายไปพร้อมสิทธิ์ (trigger employees_normalize_acting_role)
--   5) แถวพนักงานที่ไม่มีในตารางได้ false ไม่ใช่ null (RPC ใช้ "if not ... then raise" ซึ่ง null จะไม่ raise)
begin;

create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79600000-0000-0000-0000-000000000001', 'ncrar-rb-staff@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000002', 'ncrar-gm@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000003', 'ncrar-afm@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000004', 'ncrar-fm@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000005', 'ncrar-qa-m@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000006', 'ncrar-qa-a@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000007', 'ncrar-rb-m@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000008', 'ncrar-staff@mnp.local', '{}'::jsonb),
  ('79600000-0000-0000-0000-000000000009', 'ncrar-plain@mnp.local', '{}'::jsonb);

-- บัญชี admin ทุกบัญชี ต่างกันที่แผนกและบทบาทหลัก (trigger เก็บ acting_role_id ไว้เพราะ role เป็น admin)
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, acting_role_id, auth_user_id) values
  ('79600000-0000-0000-0000-000000000101', 'NCRAR-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrar-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), null, '79600000-0000-0000-0000-000000000001'),
  ('79600000-0000-0000-0000-000000000102', 'NCRAR-GM', 'ทดสอบ', 'admin ผจก.ทั่วไป', 'ncrar-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'general_manager'), '79600000-0000-0000-0000-000000000002'),
  ('79600000-0000-0000-0000-000000000103', 'NCRAR-AFM', 'ทดสอบ', 'admin ผช.ผจก.โรงงาน', 'ncrar-afm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'assistant_factory_manager'), '79600000-0000-0000-0000-000000000003'),
  ('79600000-0000-0000-0000-000000000104', 'NCRAR-FM', 'ทดสอบ', 'admin ผจก.โรงงาน', 'ncrar-fm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'factory_manager'), '79600000-0000-0000-0000-000000000004'),
  ('79600000-0000-0000-0000-000000000105', 'NCRAR-QA-M', 'ทดสอบ', 'admin ผจก. QA', 'ncrar-qa-m@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'department_manager'), '79600000-0000-0000-0000-000000000005'),
  ('79600000-0000-0000-0000-000000000106', 'NCRAR-QA-A', 'ทดสอบ', 'admin ผช.ผจก. QA', 'ncrar-qa-a@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'assistant_department_manager'), '79600000-0000-0000-0000-000000000006'),
  ('79600000-0000-0000-0000-000000000107', 'NCRAR-RB-M', 'ทดสอบ', 'admin ผจก. RB', 'ncrar-rb-m@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'department_manager'), '79600000-0000-0000-0000-000000000007'),
  ('79600000-0000-0000-0000-000000000108', 'NCRAR-STAFF', 'ทดสอบ', 'admin พนักงาน QA', 'ncrar-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'admin'),
   (select id from public.roles where code = 'staff'), '79600000-0000-0000-0000-000000000008'),
  ('79600000-0000-0000-0000-000000000109', 'NCRAR-PLAIN', 'ทดสอบ', 'admin ไม่ตั้งบทบาท', 'ncrar-plain@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), null, '79600000-0000-0000-0000-000000000009');
select set_config('test.sbx_qa', (select id::text from public.employees where employee_no = 'SBX-QA-STAFF'), true);

-- ใบจริง 1 ใบ (ไม่ต้องพิจารณาก่อน: ลงยอดได้ทุกสถานะยกเว้นยกเลิก) -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_real', public.app_ncr_issue('NCRAR_REAL', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
reset role;

-- 1) ตารางสิทธิ์ของ helper --------------------------------------------------------------------------------
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-GM'),
  true, 'an admin working as general manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-AFM'),
  true, 'an admin working as assistant factory manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-FM'),
  true, 'an admin working as factory manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-QA-M'),
  true, 'an admin in QA working as department manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-QA-A'),
  true, 'an admin in QA working as assistant department manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-RB-M'),
  false, 'an admin outside QA working as department manager cannot edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-STAFF'),
  false, 'an admin working as staff cannot edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-PLAIN'),
  false, 'an admin without a working role still cannot edit losses');

-- 2) ผ่าน RPC จริง ---------------------------------------------------------------------------------------------
set local role authenticated;
select set_config('test.entry', '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":3,"unit":"ชิ้น","unit_cost":25,"incurred_on":"2026-10-01"}', true);
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_real'), current_setting('test.entry')),
  'an admin working as general manager records a loss on a real NCR'
);
select lives_ok(
  format('select public.app_ncr_review_costs(%L::uuid, false, %L)', current_setting('test.ncr_real'), 'รอใบเสร็จ'),
  'an admin working as general manager saves the cost review on a real NCR'
);
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_real'), current_setting('test.entry')),
  'NOT_AUTHORIZED',
  'an admin without a working role cannot record a loss'
);
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_real'), current_setting('test.entry')),
  'NOT_AUTHORIZED',
  'an admin outside QA working as department manager cannot record a loss'
);
reset role;
select set_config('test.loss_real', (select id::text from public.ncr_losses where ncr_id = current_setting('test.ncr_real')::uuid limit 1), true);
select is(
  (select recorded_by from public.ncr_losses where id = current_setting('test.loss_real')::uuid),
  '79600000-0000-0000-0000-000000000102'::uuid,
  'the loss line is recorded under the admin account that entered it'
);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  format('select public.app_ncr_void_loss(%L::uuid, %L)', current_setting('test.loss_real'), 'ลงยอดซ้ำ'),
  'an admin working as assistant factory manager voids a loss line on a real NCR'
);

-- 3) โหมดทดสอบ: สิทธิ์มาจากบัญชีทดสอบ (พนักงาน QA กรอกไม่ได้) ไม่ใช่บทบาทหลักของ admin ------------------------------
select set_config('request.jwt.claims', '{"sub":"79600000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select set_config('test.ncr_test', public.app_ncr_issue('NCRAR_TEST', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ผิวมีรอยเกินเกณฑ์ที่กำหนดในสเปค')->>'id', true);
select throws_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_test'), current_setting('test.entry')),
  'NOT_AUTHORIZED',
  'test mode: an admin working as general manager acts with the QA staff persona and cannot record a loss'
);
select public.app_sandbox_exit();
reset role;

-- 4) เปลี่ยนออกจาก admin: trigger ล้างบทบาทหลัก และสิทธิ์กรอกต้นทุนหายไปด้วย ------------------------------------------
update public.employees set role_id = (select id from public.roles where code = 'staff') where employee_no = 'NCRAR-AFM';
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid, e) from public.employees e where e.employee_no = 'NCRAR-AFM'),
  false, 'an account moved from admin to staff loses the working role and cannot edit losses');

-- 5) ไม่พบพนักงาน = false (fail-closed) -----------------------------------------------------------------------
select is(
  private.can_edit_ncr_losses(current_setting('test.ncr_real')::uuid,
    jsonb_populate_record(null::public.employees, jsonb_build_object(
      'id', '79600000-0000-0000-0000-0000000009ff',
      'department_id', (select id from public.departments where code = 'QA'),
      'role_id', (select id from public.roles where code = 'general_manager')))),
  false, 'an employee row that is not in the table is refused with false, never null');

select * from finish();
rollback;
