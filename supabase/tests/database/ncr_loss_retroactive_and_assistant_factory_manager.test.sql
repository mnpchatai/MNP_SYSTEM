-- ทดสอบ 20261015060000_ncr_loss_retroactive_and_assistant_factory_manager.sql
--   1) ผู้ช่วย ผจก.โรงงานลงยอดใบจริงได้ ผู้ช่วย ผจก.แผนกที่ไม่รับผิดชอบ/พนักงานทั่วไปยังลงไม่ได้
--   2) ใบที่ปิดแล้วลงยอด/แก้/ยกเลิกรายการ/บันทึกผลดำเนินการย้อนหลังได้ สถานะไม่เปลี่ยนและมีประวัติ
--   3) ใบที่ยกเลิกยังล็อก และ API รุ่นเก่ายังล็อกใบที่ปิดแล้วเหมือนเดิม
begin;

create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email, raw_user_meta_data) values
  ('79300000-0000-0000-0000-000000000001', 'ncrr-rb-staff@mnp.local', '{}'::jsonb),
  ('79300000-0000-0000-0000-000000000002', 'ncrr-factory@mnp.local', '{}'::jsonb),
  ('79300000-0000-0000-0000-000000000003', 'ncrr-afm@mnp.local', '{}'::jsonb),
  ('79300000-0000-0000-0000-000000000004', 'ncrr-pk-assistant@mnp.local', '{}'::jsonb),
  ('79300000-0000-0000-0000-000000000005', 'ncrr-rb-manager@mnp.local', '{}'::jsonb);

insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79300000-0000-0000-0000-000000000101', 'NCRR-RB-S', 'ทดสอบ', 'พนักงาน RB', 'ncrr-rb-staff@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '79300000-0000-0000-0000-000000000001'),
  ('79300000-0000-0000-0000-000000000102', 'NCRR-FM', 'ทดสอบ', 'ผจก.โรงงาน', 'ncrr-factory@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '79300000-0000-0000-0000-000000000002'),
  ('79300000-0000-0000-0000-000000000103', 'NCRR-AFM', 'ทดสอบ', 'ผู้ช่วย ผจก.โรงงาน', 'ncrr-afm@mnp.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'assistant_factory_manager'), '79300000-0000-0000-0000-000000000003'),
  ('79300000-0000-0000-0000-000000000104', 'NCRR-PK-A', 'ทดสอบ', 'ผู้ช่วย ผจก. PK', 'ncrr-pk-assistant@mnp.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'assistant_department_manager'), '79300000-0000-0000-0000-000000000004'),
  ('79300000-0000-0000-0000-000000000105', 'NCRR-RB-M', 'ทดสอบ', 'ผจก. RB', 'ncrr-rb-manager@mnp.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'department_manager'), '79300000-0000-0000-0000-000000000005');

set local role authenticated;

-- ใบ A (จะปิด) และใบ B (จะยกเลิก) -------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.ncr_a', public.app_ncr_issue('NCRRETRO_A', 100, 10, 'ท่อน', 'in_process', 'DIM', 'รูในใหญ่เกินสเปค 10±0.5mm วัดได้ 11.2mm')->>'id', true);
select set_config('test.ncr_b', public.app_ncr_issue('NCRRETRO_B', 50, 5, 'ท่อน', 'in_process', 'DIM', 'ความยาวเกินสเปค 100±1mm วัดได้ 103mm')->>'id', true);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select public.app_ncr_dispose(current_setting('test.ncr_a')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);
select public.app_ncr_dispose(current_setting('test.ncr_b')::uuid, array['sort'], array[(select id from public.departments where code = 'RB')]);

-- 1) สิทธิ์ผู้ช่วย ผจก.โรงงานในใบจริง -----------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.loss_open', public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
  '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":2,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01"}'::jsonb)::text, true);
select is(
  (select recorded_by from public.ncr_losses where id = current_setting('test.loss_open')::uuid),
  '79300000-0000-0000-0000-000000000103'::uuid,
  'the assistant factory manager records a loss on a real NCR'
);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
       '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":1,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01"}'::jsonb) $$,
  'NOT_AUTHORIZED',
  'an assistant manager of an unrelated department still cannot record a loss'
);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
       '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":1,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01"}'::jsonb) $$,
  'NOT_AUTHORIZED',
  'staff of the responsible department still cannot record a loss'
);

-- ปิดใบ A และยกเลิกใบ B (ตั้งสถานะตรง ๆ ขั้นตอนเต็มทดสอบไว้ใน ncr_phase1.test.sql) -------------
reset role;
update public.ncr_reports set status = 'closed', closed_at = now() where id = current_setting('test.ncr_a')::uuid;
update public.ncr_reports set status = 'cancelled', cancelled_at = now(), cancelled_by = '79300000-0000-0000-0000-000000000102'
  where id = current_setting('test.ncr_b')::uuid;
set local role authenticated;

-- 2) ลงยอดย้อนหลังในใบที่ปิดแล้ว ----------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $$ select set_config('test.loss_closed', public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
       '{"loss_type":"claim","entry_kind":"loss","cost_status":"confirmed","component":"amount","quantity":1,"unit":"รายการ","unit_cost":1500,"incurred_on":"2026-10-10","evidence_ref":"CN-001"}'::jsonb)::text, true) $$,
  'the assistant factory manager records a confirmed loss after the NCR is closed'
);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
       '{"loss_type":"scrap","entry_kind":"loss","cost_status":"confirmed","component":"quantity","quantity":2,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01","evidence_ref":"SC-002"}'::jsonb,
       current_setting('test.loss_open')::uuid) $$,
  'the responsible department manager confirms an earlier estimate after the NCR is closed'
);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $$ select public.app_ncr_void_loss(current_setting('test.loss_closed')::uuid, 'ลงยอดซ้ำกับใบลดหนี้') $$,
  'the factory manager voids a loss after the NCR is closed'
);
select lives_ok(
  $$ select public.app_ncr_save_outcome(current_setting('test.ncr_a')::uuid,
       '{"result_status":"confirmed","result_date":"2026-10-12","qty_sorted":100,"qty_repaired":0,"qty_scrapped":2,"qty_returned":0,"qty_accepted":98,"downtime_hours":0,"cost_reviewed":true,"evidence_ref":"QA-REP-01"}'::jsonb) $$,
  'the factory manager confirms the outcome and marks the cost review complete after the NCR is closed'
);
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr_a')::uuid,
       '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":1,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01"}'::jsonb) $$,
  'NOT_AUTHORIZED',
  'an unrelated assistant manager cannot record a loss on a closed NCR either'
);

select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select results_eq(
  $$ select status, (select cost_reviewed from public.ncr_outcomes where ncr_id = current_setting('test.ncr_a')::uuid)
     from public.ncr_reports where id = current_setting('test.ncr_a')::uuid $$,
  $$ values ('closed'::text, true) $$,
  'the NCR stays closed and the cost review is complete'
);
select results_eq(
  $$ select cost_status, voided_at is not null from public.ncr_losses
     where ncr_id = current_setting('test.ncr_a')::uuid order by voided_at is not null $$,
  $$ values ('confirmed'::text, false), ('confirmed'::text, true) $$,
  'the confirmed estimate is kept and the duplicate claim is voided'
);
select is(
  (select count(*)::int from public.ncr_status_history
   where ncr_id = current_setting('test.ncr_a')::uuid and from_status = 'closed' and to_status = 'closed'
     and action in ('loss_record', 'outcome_record')),
  3,
  'retroactive loss and outcome entries are recorded in the status history without reopening the NCR'
);

-- 3) ใบที่ยกเลิกยังล็อก, API รุ่นเก่ายังล็อกใบที่ปิดแล้ว ----------------------------------------
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_record_loss(current_setting('test.ncr_b')::uuid,
       '{"loss_type":"scrap","entry_kind":"loss","cost_status":"estimated","component":"quantity","quantity":1,"unit":"ท่อน","unit_cost":18,"incurred_on":"2026-10-01"}'::jsonb) $$,
  'NCR_LOCKED',
  'losses still cannot be recorded on a cancelled NCR'
);
select throws_ok(
  $$ select public.app_ncr_save_outcome(current_setting('test.ncr_b')::uuid,
       '{"result_status":"draft","result_date":"2026-10-12","qty_sorted":0,"qty_repaired":0,"qty_scrapped":0,"qty_returned":0,"qty_accepted":0,"downtime_hours":0}'::jsonb) $$,
  'NCR_LOCKED',
  'outcomes still cannot be saved on a cancelled NCR'
);
reset role;
insert into public.ncr_losses (ncr_id, loss_type, entry_kind, cost_status, component, quantity, unit, unit_cost, incurred_on, recorded_by)
values (current_setting('test.ncr_b')::uuid, 'scrap', 'loss', 'estimated', 'quantity', 1, 'ท่อน', 18, '2026-10-01', '79300000-0000-0000-0000-000000000102');
select set_config('test.loss_cancelled', (select id::text from public.ncr_losses where ncr_id = current_setting('test.ncr_b')::uuid), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79300000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok(
  $$ select public.app_ncr_void_loss(current_setting('test.loss_cancelled')::uuid, 'ไม่ควรยกเลิกได้') $$,
  'NCR_LOCKED',
  'losses on a cancelled NCR still cannot be voided'
);
select throws_ok(
  $$ select public.app_ncr_add_loss(current_setting('test.ncr_a')::uuid, 'scrap', 1, 'ท่อน', 18) $$,
  'NCR_LOCKED',
  'the legacy add-loss API still rejects closed NCRs'
);
select throws_ok(
  $$ select public.app_ncr_add_losses(current_setting('test.ncr_a')::uuid, '[{"loss_type":"scrap","quantity":1,"unit":"ท่อน","unit_cost":18}]'::jsonb) $$,
  'NCR_LOCKED',
  'the legacy batch API still rejects closed NCRs'
);

select * from finish();
rollback;
