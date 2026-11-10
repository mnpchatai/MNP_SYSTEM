-- ทดสอบ 20261115010000_ncr_loss_responder_estimates.sql (ผู้ใช้ตัดสิน 2026-11-10)
--   1) ผู้ตอบ NCR ใบนั้น (พนักงานแผนกที่รับผิดชอบ) ใส่และแก้ยอดประมาณการได้
--   2) ผู้ตอบส่งยอดยืนยัน ยืนยันยอดของตัวเอง หรือแก้รายการที่ยืนยันแล้ว → LOSS_ESTIMATE_ONLY
--      ยกเลิกรายการและติ๊ก "ประเมินครบแล้ว" → NOT_AUTHORIZED (ยังเป็นของผู้กรอกต้นทุน)
--   3) แผนกที่ไม่รับผิดชอบยังถูกปฏิเสธ · เมื่อ ผจก.โรงงานระบุผู้ตอบของแผนกแล้ว เฉพาะคนนั้นใส่ได้
--   4) ผู้กรอกต้นทุนยืนยันยอดที่ผู้ตอบใส่ได้ตามเดิม
begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79700000-0000-0000-0000-000000000001', 'ncrre-rb-staff@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000002', 'ncrre-rb-staff2@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000003', 'ncrre-pk-staff@mnp.local', '{}'::jsonb),
  ('79700000-0000-0000-0000-000000000004', 'ncrre-factory@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79700000-0000-0000-0000-000000000101', 'NCRRE-RB-S1', 'ทดสอบ', 'พนักงาน RB หนึ่ง', 'ncrre-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79700000-0000-0000-0000-000000000001'),
  ('79700000-0000-0000-0000-000000000102', 'NCRRE-RB-S2', 'ทดสอบ', 'พนักงาน RB สอง', 'ncrre-rb-staff2@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79700000-0000-0000-0000-000000000002'),
  ('79700000-0000-0000-0000-000000000103', 'NCRRE-PK-S', 'ทดสอบ', 'พนักงาน PK', 'ncrre-pk-staff@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '79700000-0000-0000-0000-000000000003'),
  ('79700000-0000-0000-0000-000000000104', 'NCRRE-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrre-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79700000-0000-0000-0000-000000000004');

set local role authenticated;

-- ใบ NCR ที่ RB เป็นแผนกที่รับผิดชอบ (ยังไม่ระบุผู้ตอบ) ---------------------------------------
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.ncr', public.app_ncr_issue('NCRRESP_A', 100, 10, 'ชิ้น', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.app_ncr_dispose(current_setting('test.ncr')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);
select set_config('test.estimate', '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":2,"unit":"ชิ้น","unit_cost":30,"incurred_on":"2026-10-01"}', true);
select set_config('test.confirmed', '{"loss_type":"scrap","entry_kind":"loss","cost_status":"confirmed","component":"quantity","quantity":2,"unit":"ชิ้น","unit_cost":30,"incurred_on":"2026-10-01","evidence_ref":"SC-RE-1"}', true);

-- 1) ผู้ตอบใส่และแก้ยอดประมาณการได้ --------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $$ select set_config('test.loss', public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb)::text, true) $$,
  'staff of the responsible department records an estimated loss'
);
select lives_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb || '{"quantity":3}'::jsonb, current_setting('test.loss')::uuid) $$,
  'the responder revises the estimate'
);

-- 2) ยืนยัน ยกเลิก และติ๊กประเมินครบ ยังเป็นของผู้กรอกต้นทุน -----------------------------------
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.confirmed')::jsonb) $$,
  'LOSS_ESTIMATE_ONLY',
  'the responder cannot record a confirmed loss'
);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.confirmed')::jsonb, current_setting('test.loss')::uuid) $$,
  'LOSS_ESTIMATE_ONLY',
  'the responder cannot confirm their own estimate'
);
select throws_ok(
  $$ select public.app_ncr_void_loss(current_setting('test.loss')::uuid, 'ลงผิด') $$,
  'NOT_AUTHORIZED',
  'the responder cannot void a loss line'
);
select throws_ok(
  $$ select public.app_ncr_review_costs(current_setting('test.ncr')::uuid, true, 'ครบแล้ว') $$,
  'NOT_AUTHORIZED',
  'the responder cannot mark the cost review complete'
);

-- 3) แผนกที่ไม่รับผิดชอบ -------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb) $$,
  'NOT_AUTHORIZED',
  'staff of a department that is not responsible cannot record a loss'
);

-- 4) ผู้กรอกต้นทุนยืนยันยอดที่ผู้ตอบใส่ แล้วผู้ตอบแก้รายการที่ยืนยันแล้วไม่ได้ -------------------------
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.confirmed')::jsonb, current_setting('test.loss')::uuid) $$,
  'the factory manager confirms the estimate the responder entered'
);
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb, current_setting('test.loss')::uuid) $$,
  'LOSS_ESTIMATE_ONLY',
  'the responder cannot revise a loss that is already confirmed'
);

-- 5) ระบุผู้ตอบของแผนกแล้ว เฉพาะคนนั้นใส่ได้ ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select public.app_ncr_assign_responder(current_setting('test.ncr')::uuid, (select id from public.departments where code = 'RB'), '79700000-0000-0000-0000-000000000102'::uuid);
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb) $$,
  'NOT_AUTHORIZED',
  'once a responder is named, other staff of the department cannot record a loss'
);
select set_config('request.jwt.claims', '{"sub":"79700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr')::uuid, current_setting('test.estimate')::jsonb) $$,
  'the named responder records an estimate'
);

-- 6) ข้อมูลที่บันทึก (อ่านตารางหลัง reset role) ---------------------------------------------------
reset role;
select results_eq(
  $$ select recorded_by::text, cost_status from public.ncr_losses
     where ncr_id = current_setting('test.ncr')::uuid and voided_at is null order by cost_status $$,
  $$ values ('79700000-0000-0000-0000-000000000101'::text, 'confirmed'::text), ('79700000-0000-0000-0000-000000000102'::text, 'estimated'::text) $$,
  'the responder''s line is confirmed by the factory manager and the named responder''s line stays an estimate'
);

select * from finish();
rollback;
