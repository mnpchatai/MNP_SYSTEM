-- ทดสอบ private.can_edit_ncr_losses — นิยามล่าสุดจาก 20261017030000_ncr_loss_editors_qa_managers.sql
-- (20261017010000_ncr_loss_editors_same_in_all_modes.sql ทำให้ใบจริงใช้กฎเดียวกับใบทดสอบ ส่วน 20261017030000 เปลี่ยนรายชื่อ)
--   1) private.can_edit_ncr_losses ไม่เปิดให้ client เรียกตรง
--   2) ผู้กรอกต้นทุน: ผจก.ทั่วไป, ผจก.โรงงาน, ผช.ผจก.โรงงาน, ผจก./ผช.ผจก.แผนก QA (ไม่ขึ้นกับแผนกที่รับผิดชอบ)
--      ปฏิเสธ: ผจก./ผช.ผจก.แผนกอื่น (รวมแผนกที่รับผิดชอบใบนั้น), พนักงานแผนก QA, ผู้รายงาน
--   3) ผ่าน RPC จริงทุกตัว (record / review / void / batch / API รุ่นเก่า) และพนักงาน QA ยังอ่านใบกับรายการที่บันทึกแล้วได้
--   4) ข้ามโหมดถูกปฏิเสธ (SANDBOX_SCOPE_MISMATCH) ใบทดสอบใช้กฎเดียวกับใบจริงผ่าน RPC จริง
begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

-- 1) grants -------------------------------------------------------------------------------
select ok(
  not has_function_privilege('anon', 'private.can_edit_ncr_losses(uuid, public.employees)', 'execute'),
  'anon cannot call the loss editor helper'
);
select ok(
  not has_function_privilege('authenticated', 'private.can_edit_ncr_losses(uuid, public.employees)', 'execute'),
  'signed-in users cannot call the loss editor helper directly'
);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79500000-0000-0000-0000-000000000001', 'ncrle-rb-staff@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000002', 'ncrle-factory@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000003', 'ncrle-afm@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000004', 'ncrle-gm@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000005', 'ncrle-rb-manager@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000006', 'ncrle-rb-assistant@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000007', 'ncrle-pk-manager@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000008', 'ncrle-qa-staff@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000009', 'ncrle-qa-manager@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000010', 'ncrle-admin@mnp.local', '{}'::jsonb),
  ('79500000-0000-0000-0000-000000000011', 'ncrle-qa-assistant@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79500000-0000-0000-0000-000000000101', 'NCRLE-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrle-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79500000-0000-0000-0000-000000000001'),
  ('79500000-0000-0000-0000-000000000102', 'NCRLE-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrle-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79500000-0000-0000-0000-000000000002'),
  ('79500000-0000-0000-0000-000000000103', 'NCRLE-AFM', 'ทดสอบ', 'ผู้ช่วย ผจก.โรงงาน', 'ncrle-afm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'assistant_factory_manager'), '79500000-0000-0000-0000-000000000003'),
  ('79500000-0000-0000-0000-000000000104', 'NCRLE-GM', 'ทดสอบ', 'ผจก.ทั่วไป', 'ncrle-gm@mnp.local',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'general_manager'), '79500000-0000-0000-0000-000000000004'),
  ('79500000-0000-0000-0000-000000000105', 'NCRLE-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncrle-rb-manager@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '79500000-0000-0000-0000-000000000005'),
  ('79500000-0000-0000-0000-000000000106', 'NCRLE-RB-A', 'ทดสอบ', 'ผู้ช่วย ผจก. RB', 'ncrle-rb-assistant@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'assistant_department_manager'), '79500000-0000-0000-0000-000000000006'),
  ('79500000-0000-0000-0000-000000000107', 'NCRLE-PK-M', 'ทดสอบ', 'ผจก. PK', 'ncrle-pk-manager@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'department_manager'), '79500000-0000-0000-0000-000000000007'),
  ('79500000-0000-0000-0000-000000000108', 'NCRLE-QA-S', 'ทดสอบ', 'พนักงาน QA', 'ncrle-qa-staff@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '79500000-0000-0000-0000-000000000008'),
  ('79500000-0000-0000-0000-000000000109', 'NCRLE-QA-M', 'ทดสอบ', 'ผจก. QA', 'ncrle-qa-manager@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '79500000-0000-0000-0000-000000000009'),
  ('79500000-0000-0000-0000-000000000110', 'NCRLE-ADMIN', 'ทดสอบ', 'ผู้ดูแล', 'ncrle-admin@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '79500000-0000-0000-0000-000000000010'),
  ('79500000-0000-0000-0000-000000000111', 'NCRLE-QA-A', 'ทดสอบ', 'ผู้ช่วย ผจก. QA', 'ncrle-qa-assistant@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'assistant_department_manager'), '79500000-0000-0000-0000-000000000011');
select set_config('test.sbx_qa', (select id::text from public.employees where employee_no = 'SBX-QA-STAFF'), true);
select set_config('test.sbx_qamgr', (select id::text from public.employees where employee_no = 'SBX-QA-MGR'), true);
select set_config('test.sbx_rbmgr', (select id::text from public.employees where employee_no = 'SBX-RB-MGR'), true);
select set_config('test.sbx_gm', (select id::text from public.employees where employee_no = 'SBX-MGT-GM'), true);

-- ใบจริง 2 ใบ: ใบ RB ให้แผนก RB รับผิดชอบ ใบ QA ให้แผนก QA รับผิดชอบ ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_rb', public.app_ncr_issue('NCRLE_RB', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_qa', public.app_ncr_issue('NCRLE_QA', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ความยาวเกินสเปค 100±1mm วัดได้ 103mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_ncr_dispose(current_setting('test.ncr_rb')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_qa')::uuid, array['sort'], array[(select id from public.departments where code = 'QA')]);

-- ใบทดสอบ 1 ใบ (ออกในโหมดทดสอบของ admin) ไม่ระบุแผนกที่รับผิดชอบ -----------------------------------
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select set_config('test.ncr_test', public.app_ncr_issue('NCRLE_TEST', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ผิวมีรอยเกินเกณฑ์ที่กำหนดในสเปค')->>'id', true);
select public.app_sandbox_exit();
reset role;

-- 2) ตารางสิทธิ์ของ helper (ใบ RB: แผนก RB รับผิดชอบ) ------------------------------------------------
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-FM'),
  true, 'the factory manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-AFM'),
  true, 'the assistant factory manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-GM'),
  true, 'the general manager can edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-QA-M'),
  true, 'the QA department manager can edit losses even when QA is not responsible');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-QA-A'),
  true, 'the QA assistant department manager can edit losses even when QA is not responsible');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-RB-M'),
  false, 'the manager of the responsible department can no longer edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-RB-A'),
  false, 'the assistant manager of the responsible department can no longer edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-PK-M'),
  false, 'a manager of another department cannot edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-RB-S'),
  false, 'the reporter (staff of the responsible department) cannot edit losses');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_rb')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-QA-S'),
  false, 'QA staff who are not managers cannot edit losses');
-- ใบ QA: แผนก QA รับผิดชอบ — กฎเหมือนกัน (ไม่ขึ้นกับแผนกที่รับผิดชอบ)
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_qa')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-QA-M'),
  true, 'the QA manager can edit losses when QA is the responsible department');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_qa')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-QA-S'),
  false, 'QA staff still cannot edit losses when QA is the responsible department');
select is((select private.can_edit_ncr_losses(current_setting('test.ncr_qa')::uuid, e) from public.employees e where e.employee_no = 'NCRLE-RB-M'),
  false, 'a non-QA department manager cannot edit losses on a report QA is responsible for');

-- 3) ผ่าน RPC จริง และ RLS ยังอ่านได้ ----------------------------------------------------------------
set local role authenticated;
select set_config('test.entry', '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":3,"unit":"ชิ้น","unit_cost":25,"incurred_on":"2026-10-01"}', true);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.entry')),
  'NOT_AUTHORIZED',
  'QA staff cannot record a loss through the RPC'
);
select throws_ok(
  format('select public.app_ncr_review_costs(%L::uuid, true, %L)', current_setting('test.ncr_rb'), 'ไม่มีค่าเสียหาย'),
  'NOT_AUTHORIZED',
  'QA staff cannot mark the cost review through the RPC'
);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.entry')),
  'NOT_AUTHORIZED',
  'the manager of the responsible department cannot record a loss through the RPC'
);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok(
  format('select public.app_ncr_record_loss(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.entry')),
  'the QA manager records a loss through the RPC'
);
select lives_ok(
  format('select public.app_ncr_review_costs(%L::uuid, true, %L)', current_setting('test.ncr_qa'), 'ไม่มีค่าเสียหาย'),
  'the QA manager marks the cost review through the RPC'
);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(
  (select count(*) from public.ncr_reports where id = current_setting('test.ncr_rb')::uuid),
  1::bigint,
  'QA staff can still read the real NCR'
);
select is(
  (select count(*) from public.ncr_losses where ncr_id = current_setting('test.ncr_rb')::uuid),
  1::bigint,
  'QA staff can still read the loss lines recorded by others'
);

-- 3b) void / batch / API รุ่นเก่า: กฎเดียวกัน (RPC เหล่านี้ไม่ตรวจโหมดเอง ใช้ trigger ncr_losses_sandbox_scope กันข้ามโหมด) -----------
reset role;
select set_config('test.loss_real', (select id::text from public.ncr_losses where ncr_id = current_setting('test.ncr_rb')::uuid limit 1), true);
select set_config('test.batch', '[{"loss_type":"scrap","quantity":1,"unit":"ชิ้น","unit_cost":10,"note":"ทิ้ง"}]', true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_void_loss(%L::uuid, %L)', current_setting('test.loss_real'), 'ไม่ควรยกเลิกได้'),
  'NOT_AUTHORIZED',
  'QA staff cannot void a loss line on a real NCR'
);
select throws_ok(
  format('select public.app_ncr_add_losses(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.batch')),
  'NOT_AUTHORIZED',
  'QA staff cannot add a batch of losses to a real NCR'
);
select throws_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_rb'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'NOT_AUTHORIZED',
  'QA staff cannot use the older single-entry API on a real NCR'
);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_add_losses(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.batch')),
  'NOT_AUTHORIZED',
  'the manager of the responsible department cannot add a batch of losses'
);

-- ข้ามโหมด: ผจก.ทั่วไปจริงกับใบทดสอบ, ผจก.ทั่วไปในโหมดทดสอบกับใบจริง (ชั้นป้องกันคือ trigger บน ncr_losses) -------------------
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_test'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'SANDBOX_SCOPE_MISMATCH',
  'a real general manager cannot add a loss to a test NCR'
);
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_gm')::uuid);
select throws_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_rb'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'SANDBOX_SCOPE_MISMATCH',
  'a test-mode general manager cannot add a loss to a real NCR'
);
select throws_ok(
  format('select public.app_ncr_add_losses(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.batch')),
  'SANDBOX_SCOPE_MISMATCH',
  'a test-mode general manager cannot add a batch of losses to a real NCR'
);
select throws_ok(
  format('select public.app_ncr_void_loss(%L::uuid, %L)', current_setting('test.loss_real'), 'ข้ามโหมดไม่ได้'),
  'SANDBOX_SCOPE_MISMATCH',
  'a test-mode general manager cannot void a loss line of a real NCR'
);

-- 4) ใบทดสอบใช้กฎเดียวกับใบจริง (ผ่าน RPC จริง ไม่ใช่แค่ helper) ---------------------------------------------------------------
select lives_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_test'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'test mode: the general manager adds a loss to a test NCR'
);
select public.app_sandbox_enter(current_setting('test.sbx_qamgr')::uuid);
select lives_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_test'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'test mode: the QA manager adds a loss to a test NCR (same as a real NCR)'
);
select public.app_sandbox_enter(current_setting('test.sbx_rbmgr')::uuid);
select throws_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_test'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'NOT_AUTHORIZED',
  'test mode: a non-QA department manager cannot add a loss to a test NCR (same as a real NCR)'
);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select throws_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_test'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'NOT_AUTHORIZED',
  'test mode: QA staff cannot add a loss to a test NCR (same as a real NCR)'
);
select throws_ok(
  format('select public.app_ncr_add_losses(%L::uuid, %L::jsonb)', current_setting('test.ncr_test'), current_setting('test.batch')),
  'NOT_AUTHORIZED',
  'test mode: QA staff cannot add a batch of losses to a test NCR (same as a real NCR)'
);
select public.app_sandbox_exit();

-- ผจก.ทั่วไปจริงทำได้ครบทุกทางเข้าในใบจริง -----------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79500000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok(
  format('select public.app_ncr_add_losses(%L::uuid, %L::jsonb)', current_setting('test.ncr_rb'), current_setting('test.batch')),
  'the general manager adds a batch of losses to a real NCR'
);
select lives_ok(
  format('select public.app_ncr_add_loss(%L::uuid, %L, 1, %L, 10, %L)', current_setting('test.ncr_rb'), 'scrap', 'ชิ้น', 'ทิ้ง'),
  'the general manager uses the older single-entry API on a real NCR'
);
select lives_ok(
  format('select public.app_ncr_void_loss(%L::uuid, %L)', current_setting('test.loss_real'), 'ลงยอดซ้ำ'),
  'the general manager voids a loss line of a real NCR'
);
reset role;

select * from finish();
rollback;
