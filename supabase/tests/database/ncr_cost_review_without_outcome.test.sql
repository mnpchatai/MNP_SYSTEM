-- ทดสอบ 20261015080000_ncr_cost_review_without_outcome.sql
--   1) สิทธิ์ app_ncr_review_costs: ผจก.โรงงานยืนยันประเมินครบได้ พนักงาน QA/พนักงานแผนก/ผู้ช่วย ผจก.แผนกที่ไม่รับผิดชอบไม่ได้
--      anon เรียกไม่ได้ เขียนตาราง ncr_outcomes ตรงไม่ได้ ข้ามโหมดทดสอบไม่ได้ ใบที่ยกเลิกล็อก
--   2) กฎประเมินครบ: รายการรอยืนยันค้างไม่ได้ ไม่มีค่าเสียหายต้องมีเหตุผล ยกเลิกเครื่องหมายได้ ลงยอดใหม่ยกเลิกเครื่องหมาย
--   3) ไม่ต้องมีผลดำเนินการ: สร้างแถวร่างจำนวน 0 ใบที่มีผลดำเนินการเดิมคงจำนวน/หลักฐานเดิม และบันทึกประวัติ cost_review
begin;

create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79400000-0000-0000-0000-000000000001', 'ncrcr-rb-staff@mnp.local', '{}'::jsonb),
  ('79400000-0000-0000-0000-000000000002', 'ncrcr-factory@mnp.local', '{}'::jsonb),
  ('79400000-0000-0000-0000-000000000003', 'ncrcr-qa@mnp.local', '{}'::jsonb),
  ('79400000-0000-0000-0000-000000000004', 'ncrcr-pk-assistant@mnp.local', '{}'::jsonb),
  ('79400000-0000-0000-0000-000000000005', 'ncrcr-admin@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79400000-0000-0000-0000-000000000101', 'NCRCR-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrcr-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79400000-0000-0000-0000-000000000001'),
  ('79400000-0000-0000-0000-000000000102', 'NCRCR-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrcr-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79400000-0000-0000-0000-000000000002'),
  ('79400000-0000-0000-0000-000000000103', 'NCRCR-QA', 'ทดสอบ', 'พนักงาน QA', 'ncrcr-qa@mnp.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '79400000-0000-0000-0000-000000000003'),
  ('79400000-0000-0000-0000-000000000104', 'NCRCR-PK-A', 'ทดสอบ', 'ผู้ช่วย ผจก. PK', 'ncrcr-pk-assistant@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'assistant_department_manager'), '79400000-0000-0000-0000-000000000004'),
  ('79400000-0000-0000-0000-000000000105', 'NCRCR-ADMIN', 'ทดสอบ', 'ผู้ดูแล', 'ncrcr-admin@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '79400000-0000-0000-0000-000000000005');

-- โครงสร้างและ grants -------------------------------------------------------------------
select ok(
  not exists (select 1 from pg_constraint where conrelid = 'public.ncr_outcomes'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%cost_reviewed%'),
  'the cost review no longer requires a confirmed outcome'
);
select ok(
  exists (select 1 from pg_constraint where conrelid = 'public.ncr_outcomes'::regclass and contype = 'c'
    and pg_get_constraintdef(oid) like '%verified_by IS NOT NULL%'),
  'the confirmed-outcome evidence check is kept'
);
select ok(not has_function_privilege('anon', 'public.app_ncr_review_costs(uuid,boolean,text)', 'execute'), 'anon cannot call the review RPC');
select ok(has_function_privilege('authenticated', 'public.app_ncr_review_costs(uuid,boolean,text)', 'execute'), 'signed-in users can call the review RPC');
select ok(not has_table_privilege('authenticated', 'public.ncr_outcomes', 'update'), 'signed-in users cannot update ncr_outcomes directly');
select set_config('test.sbx_qa', (select id::text from public.employees where employee_no = 'SBX-QA-STAFF'), true);

set local role authenticated;

-- ใบ A (ลงยอด), ใบ C (มีผลดำเนินการเดิม), ใบ Z (ไม่มีค่าเสียหาย), ใบ X (จะยกเลิก) ----------------------
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_a', public.app_ncr_issue('NCRREVIEW_A', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_c', public.app_ncr_issue('NCRREVIEW_C', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'ความยาวเกินสเปค 100±1mm วัดได้ 103mm')->>'id', true);
select set_config('test.ncr_z', public.app_ncr_issue('NCRREVIEW_Z', 100, 2, 'ชิ้น', 'in_process', 'DIM', 'ผิวมีรอยเล็กน้อยแต่ยังอยู่ในเกณฑ์ยอมรับ')->>'id', true);
select set_config('test.ncr_x', public.app_ncr_issue('NCRREVIEW_X', 50, 5, 'ชิ้น', 'in_process', 'DIM', 'ความหนาต่ำกว่าสเปค 5±0.2mm วัดได้ 4.5mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['scrap'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_c')::uuid, array['repair'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_z')::uuid, array['accept'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_x')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);
select set_config('test.loss_a', public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
  '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":8,"unit":"ชิ้น","unit_cost":25,"incurred_on":"2026-10-01"}'::jsonb)::text, true);

-- 1) สิทธิ์ -------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, 'ยอมรับใช้ทั้งหมด') $$,
  'NOT_AUTHORIZED',
  'staff of the responsible department cannot mark the cost review'
);
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, 'ยอมรับใช้ทั้งหมด') $$,
  'NOT_AUTHORIZED',
  'an assistant manager of an unrelated department cannot mark the cost review'
);
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sbx_qa')::uuid);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, 'ยอมรับใช้ทั้งหมด') $$,
  'SANDBOX_SCOPE_MISMATCH',
  'a sandbox identity cannot mark the cost review of a real report'
);
select public.app_sandbox_exit();
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, 'ยอมรับใช้ทั้งหมด') $$,
  'NOT_AUTHORIZED',
  'QA staff cannot mark the cost review of a real report (same rule as test mode)'
);

-- 2) กฎประเมินครบ -------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_a')::uuid, true, null) $$,
  'COST_REVIEW_PENDING',
  'an estimate still pending blocks the complete review'
);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, '   ') $$,
  'ZERO_COST_REASON_REQUIRED',
  'a report without any cost needs a reason before the review is complete'
);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, repeat('ก', 1001)) $$,
  'INVALID_NOTE',
  'a note longer than 1,000 characters is rejected'
);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, null, 'ยอมรับใช้ทั้งหมด') $$,
  'INVALID_NOTE',
  'the review flag must be given'
);
select lives_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, true, 'ยอมรับใช้ทั้งหมด ไม่มีค่าใช้จ่าย') $$,
  'the factory manager marks a report without costs as reviewed with a reason'
);
select results_eq(
  $$ select result_status, cost_reviewed, qty_scrapped, evidence_ref, note, updated_by
     from public.ncr_outcomes where ncr_id = current_setting('test.ncr_z')::uuid $$,
  $$ values ('draft'::text, true, 0::numeric, null::text, 'ยอมรับใช้ทั้งหมด ไม่มีค่าใช้จ่าย'::text, '79400000-0000-0000-0000-000000000102'::uuid) $$,
  'the review needs no outcome: a draft row with zero quantities and the reason is kept'
);

select set_config('request.jwt.claims', '{"sub":"79400000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
  '{"loss_type":"scrap","entry_kind":"loss","cost_status":"confirmed","component":"quantity","quantity":8,"unit":"ชิ้น","unit_cost":25,"incurred_on":"2026-10-01","evidence_ref":"SC-001"}'::jsonb,
  current_setting('test.loss_a')::uuid);
select lives_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_a')::uuid, true, null) $$,
  'the factory manager marks the review once every cost is confirmed'
);
select is(
  (select cost_reviewed from public.ncr_outcomes where ncr_id = current_setting('test.ncr_a')::uuid),
  true,
  'the cost review is stored'
);
select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
  '{"loss_type":"logistics","entry_kind":"loss","cost_status":"estimated","component":"amount","quantity":1,"unit":"รายการ","unit_cost":300,"incurred_on":"2026-10-02"}'::jsonb);
select is(
  (select cost_reviewed from public.ncr_outcomes where ncr_id = current_setting('test.ncr_a')::uuid),
  false,
  'a new cost entry still invalidates the review'
);
select lives_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_z')::uuid, false, 'รอใบลดหนี้จากลูกค้า') $$,
  'the review mark can be removed'
);
select is(
  (select cost_reviewed from public.ncr_outcomes where ncr_id = current_setting('test.ncr_z')::uuid),
  false,
  'removing the mark is stored'
);

-- 3) ใบที่มีผลดำเนินการเดิม และประวัติ --------------------------------------------------------
select public.app_ncr_save_outcome(current_setting('test.ncr_c')::uuid,
  '{"result_status":"confirmed","result_date":"2026-10-12","qty_sorted":100,"qty_repaired":9,"qty_scrapped":1,"qty_returned":0,"qty_accepted":0,"downtime_hours":1.5,"cost_reviewed":false,"evidence_ref":"QA-REP-09","note":"ซ่อมได้ 9 ทิ้ง 1"}'::jsonb);
select lives_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_c')::uuid, true, 'ซ่อมด้วยแรงงานเดิม ไม่มีค่าใช้จ่ายเพิ่ม') $$,
  'a report with an earlier outcome is reviewed through the new RPC'
);
select results_eq(
  $$ select result_status, qty_repaired, qty_scrapped, downtime_hours, evidence_ref, cost_reviewed
     from public.ncr_outcomes where ncr_id = current_setting('test.ncr_c')::uuid $$,
  $$ values ('confirmed'::text, 9::numeric, 1::numeric, 1.5::numeric, 'QA-REP-09'::text, true) $$,
  'earlier outcome quantities and evidence are kept'
);
select is(
  (select count(*)::int from public.ncr_status_history
   where ncr_id in (current_setting('test.ncr_a')::uuid, current_setting('test.ncr_c')::uuid, current_setting('test.ncr_z')::uuid)
     and action = 'cost_review'),
  4,
  'every review change is recorded in the status history'
);

-- ใบที่ยกเลิกยังล็อก ------------------------------------------------------------------------
reset role;
update public.ncr_reports set status = 'cancelled', cancelled_at = now(), cancelled_by = '79400000-0000-0000-0000-000000000102'
  where id = current_setting('test.ncr_x')::uuid;
set local role authenticated;
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr_x')::uuid, true, 'ยกเลิกใบแล้ว') $$,
  'NCR_LOCKED',
  'a cancelled NCR cannot be reviewed'
);

select * from finish();
rollback;
