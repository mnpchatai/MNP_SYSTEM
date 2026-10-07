-- ฝ่ายโรงงาน: ยกเลิกใบงานที่เริ่มแล้วพร้อมคืนวัตถุดิบ และยกเลิกใบสั่งผลิต (20261007060000_factory_cancel_and_return.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบ/ผิดแผนก การตรวจค่า การคืนวัตถุดิบเข้าคลัง/ล็อตเดิมครบทุกรายการ
-- ยกเลิกซ้ำและ version เก่า ใบงานที่เสร็จแล้วยกเลิกไม่ได้ เงื่อนไขยกเลิกใบสั่งผลิต (ใบงาน/ใบสั่งวัตถุดิบ) ประวัติ audit
-- ใบสั่งผลิตที่ยกเลิกแล้วไม่รับใบงาน/ใบสั่งวัตถุดิบใหม่ การแยกโหมดทดสอบ และการล้างข้อมูล
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'factory_inventory_movements_kind_check')) like '%production_return%',
  'the movement kinds include production_return');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'factory_production_order_history_action_check')) like '%cancel%',
  'the production order history accepts cancel');
select ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'factory_production_orders'
           and column_name in ('cancel_note', 'cancelled_by', 'cancelled_at')) = 3, 'the production order keeps who cancelled it, when and why');
select ok(not has_function_privilege('anon', 'public.app_factory_cancel_production_order(uuid,integer,text)', 'execute'), 'anon cannot cancel production orders');
select ok(has_function_privilege('authenticated', 'public.app_factory_cancel_production_order(uuid,integer,text)', 'execute'),
  'signed-in users can call the API (it checks mode and department itself)');
select ok(not has_function_privilege('anon', 'public.app_factory_cancel_job(uuid,integer,text)', 'execute'), 'anon still cannot cancel jobs');
select ok(not has_function_privilege('authenticated', 'private.factory_return_job_stock(public.factory_jobs,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_job_issue_reference(text)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_job_return_reference(text)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_issue_stock(uuid,numeric,text,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_assert_released_order(uuid)', 'execute'),
  'clients cannot call the stock helper functions');
select is(private.factory_job_issue_reference('TEST-JB-26-001'), 'ตัดวัตถุดิบตามใบงาน TEST-JB-26-001', 'the issue reference is built from the job code');
select is(private.factory_job_return_reference('TEST-JB-26-001'), 'คืนวัตถุดิบจากการยกเลิกใบงาน TEST-JB-26-001', 'the return reference is built from the job code');

-- 2. ข้อมูลจริงที่ต้องไม่ถูกแตะ + บัญชีทดสอบ -----------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'cancel-admin@test.local', '{}'),
  ('82000000-0000-0000-0000-000000000002', 'cancel-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('82000000-0000-0000-0000-000000000101', 'CAN-ADMIN', 'Cancel', 'Admin', 'cancel-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '82000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000102', 'CAN-STAFF', 'Cancel', 'Staff', 'cancel-staff@test.local',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '82000000-0000-0000-0000-000000000002');
-- ใบสั่งผลิตจริงที่ออกใบสั่งงานแล้ว (ไม่ใช่โหมดทดสอบ): โหมดทดสอบต้องมองไม่เห็นและยกเลิกไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('82000000-0000-0000-0000-00000000f001', 'REAL-CAN-FG', 'สินค้าจริง', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_boms (id, item_id, revision, output_qty, status, effective_date, decided_at)
values ('82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-00000000f001', 'A', 1, 'approved', date '2026-10-01', now());
insert into public.factory_routings (id, item_id, revision, status) values ('82000000-0000-0000-0000-00000000d001', '82000000-0000-0000-0000-00000000f001', 'A', 'draft');
insert into public.factory_production_orders (id, code, item_id, bom_id, routing_id, planned_qty, status, due_date)
values ('82000000-0000-0000-0000-00000000a001', 'REAL-MO-CAN', '82000000-0000-0000-0000-00000000f001', '82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-00000000d001', 5, 'released', current_date + 5);
select set_config('test.p_' || substr(employee_no, 5, 2), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-ST-STAFF', 'SBX-RB-STAFF', 'SBX-SR-STAFF', 'SBX-QA-STAFF');
select set_config('test.yy', to_char(now() at time zone 'Asia/Bangkok', 'YY'), true);
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.stock(text) returns numeric language sql stable as $$
  select (x ->> 'stock')::numeric from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;
create function pg_temp.job(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.po(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'id' = $1 $$;
create function pg_temp.mo(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'material_orders') x where x ->> 'id' = $1 $$;
create function pg_temp.jver(text) returns integer language sql stable as $$ select (pg_temp.job($1) ->> 'version')::integer $$;
create function pg_temp.pver(text) returns integer language sql stable as $$ select (pg_temp.po($1) ->> 'version')::integer $$;
create function pg_temp.mver(text) returns integer language sql stable as $$ select (pg_temp.mo($1) ->> 'version')::integer $$;
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;
-- ทำขั้นตอนที่ n..m ของใบงาน (ลำดับ n*10) ด้วย persona ปัจจุบัน
create function pg_temp.run(text, integer, integer) returns integer language plpgsql as $$
declare v_n integer;
begin
  for v_n in $2..$3 loop
    perform public.app_factory_complete_job_step($1::uuid, pg_temp.jver($1), v_n * 10, '', null);
  end loop;
  return $3 - $2 + 1;
end $$;
-- ออกใบสั่งผลิตสินค้าหนึ่งรายการจนออกใบสั่งงาน (ฝ่ายขายออก/ส่ง → ฝ่ายวางแผนรับ/วางแผน/ออก) คืน id
create function pg_temp.release_order(text, integer) returns text language plpgsql as $$
declare v_id text;
begin
  perform public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
  v_id := (public.app_factory_save_production_order(null, null, pg_temp.item($1)::uuid, $2, current_setting('test.due')::date, '', '')) ->> 'id';
  perform public.app_factory_submit_production_order(v_id::uuid, 1);
  perform public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
  perform public.app_factory_receive_production_order(v_id::uuid, 2);
  perform public.app_factory_plan_production_order(v_id::uuid, 3, pg_temp.bom($1)::uuid, pg_temp.routing($1)::uuid, 'พอ');
  perform public.app_factory_release_production_order(v_id::uuid, 4);
  return v_id;
end $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_cancel_production_order('82000000-0000-0000-0000-00000000a001', 1, 'x')$$, 'AUTH_REQUIRED', 'cancelling a production order needs a session');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_cancel_production_order('82000000-0000-0000-0000-00000000a001', 1, 'x')$$, 'FACTORY_TEST_MODE_ONLY', 'a real planning account cannot cancel a production order (real mode is not open)');
select throws_ok($$select public.app_factory_cancel_job('82000000-0000-0000-0000-00000000c001', 1, 'x')$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot cancel a job');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_cancel_production_order('82000000-0000-0000-0000-00000000a001', 1, 'x')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot cancel a production order');

-- 4. เตรียมข้อมูล: ใบสั่งผลิต FG-TRY-001 ออกใบสั่งงานแล้ว + ล็อตยางเก่า (ตรวจว่าคืนเข้าล็อตเดิม) ------------
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('FG-TRY-002'), pg_temp.approve('WIP-TRY-RBL-001')$$,
  'the BOMs of two finished goods and the long rubber strip are approved');
select set_config('test.wo', pg_temp.release_order('FG-TRY-001', 12), true);
select set_config('test.wo2', pg_temp.release_order('FG-TRY-002', 6), true);
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'released', 'the first production order has its work order');
select set_config('test.rbl', pg_temp.item('WIP-TRY-RBL-001'), true);

reset role;
insert into public.factory_lots (id, is_test, item_id, lot_number, received_date)
select '82000000-0000-0000-0000-0000000010a2', true, i.id, 'LOT-OLD-NR', current_date - 10 from public.factory_items i where i.is_test and i.code = 'RM-TRY-NR-001';
insert into public.factory_inventory_movements (is_test, item_id, warehouse_id, lot_id, quantity, kind, reference)
select true, i.id, w.id, '82000000-0000-0000-0000-0000000010a2', 10, 'receipt', 'ล็อตเก่า'
from public.factory_items i join public.factory_warehouses w on w.is_test and w.code = 'RM' where i.is_test and i.code = 'RM-TRY-NR-001';
-- ยอดคงเหลือรวมทุก Item แยกตามคลัง/ล็อต ก่อนมีการตัดใดๆ (เทียบหลังคืน)
select set_config('test.ledger0', (select coalesce(string_agg(m.item_id::text || '|' || m.warehouse_id::text || '|' || coalesce(m.lot_id::text, '-') || '|' || s::text, ',' order by m.item_id, m.warehouse_id, m.lot_id), '')
  from (select item_id, warehouse_id, lot_id, sum(quantity) s from public.factory_inventory_movements where is_test group by 1, 2, 3 having sum(quantity) <> 0) m(item_id, warehouse_id, lot_id, s)), true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.stock('RM-TRY-NR-001'), 1510::numeric, 'the rubber stock is 1,510 kg including the old lot');

-- 5. ยกเลิกใบงานที่ยังไม่เริ่ม (พฤติกรรมเดิมคงอยู่ ไม่มีอะไรให้คืน) ------------------------------
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select set_config('test.jopen', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 20, 'SR', '')) ->> 'id', true);
select is(public.app_factory_cancel_job(current_setting('test.jopen')::uuid, 1, 'ออกใบงานซ้ำ') ->> 'returned_lines', '0', 'cancelling an untouched job returns no material lines');
select is(pg_temp.job(current_setting('test.jopen')) ->> 'status', 'cancelled', 'and the job is cancelled');
select is(pg_temp.job(current_setting('test.jopen')) -> 'returned', '[]'::jsonb, 'nothing is listed as returned');
select is(pg_temp.stock('RM-TRY-NR-001'), 1510::numeric, 'the stock is untouched');

-- 6. ยกเลิกใบงานที่เริ่มแล้ว: ตัดไปแล้ว → คืนครบ --------------------------------------------
select set_config('test.j1', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, 'SR', '')) ->> 'id', true);
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select is(pg_temp.run(current_setting('test.j1'), 1, 13), 13, 'RB completes steps 1 to 13');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'in_progress', 'the job is in progress');
select is(pg_temp.stock('RM-TRY-NR-001'), 1446.76::numeric, 'the rubber was issued (63.24 kg)');
select is(pg_temp.stock('RM-TRY-CB-001'), 392::numeric, 'the carbon black was issued (28 kg)');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'in_progress', 'the production order is in progress');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ผิด')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'PRODUCTION_PLANNING_ONLY', 'the production line cannot cancel a job');
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ผิด')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'PRODUCTION_PLANNING_ONLY', 'sales cannot cancel a job either');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, '   ')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_CANCEL_NOTE_REQUIRED', 'a reason is required');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, repeat('n', 1001))$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'INVALID_JOB_NOTE', 'a long reason is rejected');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 1, 'เก่า')$$, current_setting('test.j1')), 'JOB_VERSION_CONFLICT', 'a stale version is refused');
select throws_ok($$select public.app_factory_cancel_job('82000000-0000-0000-0000-00000000c001', 1, 'x')$$, 'JOB_NOT_FOUND', 'test mode cannot cancel a job that does not exist');
select is(pg_temp.stock('RM-TRY-NR-001'), 1446.76::numeric, 'refused attempts return nothing');
reset role;
select set_config('test.issued_lines', (select count(*)::text from public.factory_inventory_movements
                                         where is_test and kind = 'production_issue' and reference = 'ตัดวัตถุดิบตามใบงาน TEST-JB-' || current_setting('test.yy') || '-002'), true);
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok(current_setting('test.issued_lines')::integer > 1, 'the first step issued several material lines');
select is(public.app_factory_cancel_job(current_setting('test.j1')::uuid, pg_temp.jver(current_setting('test.j1')), ' ตัดผิดจำนวน ') ->> 'returned_lines',
  current_setting('test.issued_lines'), 'cancelling a started job returns every issued line');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'cancelled', 'the job is cancelled');
select is(pg_temp.job(current_setting('test.j1')) ->> 'cancel_note', 'ตัดผิดจำนวน', 'the reason is trimmed and kept');
select is(pg_temp.stock('RM-TRY-NR-001'), 1510::numeric, 'the rubber is back');
select is(pg_temp.stock('RM-TRY-CB-001'), 420::numeric, 'the carbon black is back');
select is(pg_temp.stock('RM-TRY-ZNO-001'), 90::numeric, 'the zinc oxide is back');
select is(pg_temp.stock('RM-TRY-ACC-001'), 8::numeric, 'the accelerator is back');
select is(jsonb_array_length(pg_temp.job(current_setting('test.j1')) -> 'returned'), 5,
  'the job lists what it returned, one entry per item (the rubber came from two lots)');
select ok(current_setting('test.issued_lines')::integer = 6, 'which is six movement lines in all');
select is((select (x ->> 'quantity')::numeric from jsonb_array_elements(pg_temp.job(current_setting('test.j1')) -> 'returned') x where x ->> 'code' = 'RM-TRY-NR-001'),
  63.24::numeric, 'the rubber is listed as 63.24 kg');
select is((select count(*) from jsonb_array_elements(pg_temp.job(current_setting('test.j1')) -> 'steps') s where s ->> 'status' = 'done')::integer, 13,
  'the finished steps stay on record');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'in_progress', 'the production order stays in progress');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ซ้ำ')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_NOT_CANCELLABLE', 'a cancelled job cannot be cancelled (or returned) again');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ซ้ำ')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1')) - 1),
  'JOB_VERSION_CONFLICT', 'replaying the old version is refused');
select is(pg_temp.stock('RM-TRY-NR-001'), 1510::numeric, 'so the stock is returned only once');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 140, '', null)$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_NOT_ACTIVE', 'a cancelled job has no steps to run');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);

-- ตรวจบัญชีคลัง: รายการคืนตรงกับรายการตัดทีละบรรทัด และยอดต่อ (คลัง, ล็อต) กลับเท่าก่อนตัด
reset role;
select is((select count(*) from public.factory_inventory_movements where is_test and kind = 'production_return')::integer, current_setting('test.issued_lines')::integer,
  'one return movement per issue movement');
select ok(not exists (
    select 1 from public.factory_inventory_movements i
    where i.is_test and i.kind = 'production_issue' and i.reference = 'ตัดวัตถุดิบตามใบงาน TEST-JB-' || current_setting('test.yy') || '-002'
      and not exists (select 1 from public.factory_inventory_movements r
                      where r.is_test and r.kind = 'production_return' and r.item_id = i.item_id and r.warehouse_id = i.warehouse_id
                        and r.lot_id is not distinct from i.lot_id and r.quantity = -i.quantity
                        and r.reference = 'คืนวัตถุดิบจากการยกเลิกใบงาน TEST-JB-' || current_setting('test.yy') || '-002')),
  'every issue has a matching return in the same warehouse and lot');
select is((select coalesce(string_agg(m.item_id::text || '|' || m.warehouse_id::text || '|' || coalesce(m.lot_id::text, '-') || '|' || s::text, ',' order by m.item_id, m.warehouse_id, m.lot_id), '')
  from (select item_id, warehouse_id, lot_id, sum(quantity) s from public.factory_inventory_movements where is_test group by 1, 2, 3 having sum(quantity) <> 0) m(item_id, warehouse_id, lot_id, s)),
  current_setting('test.ledger0'), 'every warehouse and lot balance is exactly what it was before the job started');
select is((select count(*) from public.factory_inventory_movements where not is_test)::integer, 0, 'no real stock movement is written');
select is((select count(*) from public.factory_inventory_movements where is_test and kind = 'production_issue'
           and reference = 'ตัดวัตถุดิบตามใบงาน TEST-JB-' || current_setting('test.yy') || '-002')::integer, current_setting('test.issued_lines')::integer,
  'the original issue movements are left as they were');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 7. ใบงานที่ผลิตเสร็จแล้วยกเลิกไม่ได้ ---------------------------------------------------------
select set_config('test.j2', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 10, 'SR', '')) ->> 'id', true);
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select is(pg_temp.run(current_setting('test.j2'), 1, 13), 13, 'RB completes the strip job');
select public.app_sandbox_enter(current_setting('test.p_SR')::uuid);
select is(pg_temp.run(current_setting('test.j2'), 14, 14), 1, 'SR receives it');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select lives_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 10, 0, '', null, '', null)$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))), 'QC inspects it');
select is(pg_temp.job(current_setting('test.j2')) ->> 'status', 'completed', 'the job is completed and its output is in stock');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 270::numeric, 'ten kilograms of strip were received');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ผิด')$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'JOB_NOT_CANCELLABLE', 'a completed job cannot be cancelled');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 270::numeric, 'and its output stays in stock');

-- 8. ยกเลิกใบสั่งผลิต: ตรวจเงื่อนไข -------------------------------------------------------------
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, '   ')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_CANCEL_NOTE_REQUIRED', 'a reason is required to cancel a production order');
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, repeat('n', 1001))$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'INVALID_PRODUCTION_NOTE', 'a long reason is rejected');
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, 1, 'เก่า')$$, current_setting('test.wo2')),
  'PRODUCTION_ORDER_VERSION_CONFLICT', 'a stale version is refused');
select throws_ok($$select public.app_factory_cancel_production_order('82000000-0000-0000-0000-00000000a001', 1, 'x')$$,
  'PRODUCTION_ORDER_NOT_FOUND', 'test mode cannot cancel a real production order');
select throws_ok($$select public.app_factory_cancel_production_order('82000000-0000-0000-0000-00000000dead', 1, 'x')$$,
  'PRODUCTION_ORDER_NOT_FOUND', 'an unknown production order is not found');
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'ลูกค้ายกเลิก')$$, current_setting('test.wo'), pg_temp.pver(current_setting('test.wo'))),
  'PRODUCTION_ORDER_HAS_JOBS', 'an order with a completed job cannot be cancelled');
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'x')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_PLANNING_ONLY', 'sales cannot cancel a production order');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'x')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_PLANNING_ONLY', 'stores cannot cancel a production order');

-- ใบสั่งวัตถุดิบที่ยังไม่รับ/ไม่ยกเลิกกันการยกเลิก
select set_config('test.mr', (public.app_factory_save_material_order(null, null, current_setting('test.wo2')::uuid, 'ผู้ขาย', current_setting('test.due')::date, '',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-NR-001'), 'quantity', 5)))) ->> 'id', true);
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'ลูกค้ายกเลิก')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_ORDER_HAS_MATERIAL_ORDERS', 'a draft material order blocks the cancellation');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select lives_ok(format($$select public.app_factory_place_material_order(%L::uuid, %s)$$, current_setting('test.mr'), pg_temp.mver(current_setting('test.mr'))), 'stores places the order');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'ลูกค้ายกเลิก')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_ORDER_HAS_MATERIAL_ORDERS', 'an ordered (not yet received) material order blocks it too');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select lives_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, %s, 'ยกเลิกตามใบสั่งผลิต')$$, current_setting('test.mr'), pg_temp.mver(current_setting('test.mr'))), 'stores cancels the order');
-- ใบสั่งวัตถุดิบที่รับของแล้วไม่กัน (ของอยู่ในคลังแล้ว)
select set_config('test.mr2', (public.app_factory_save_material_order(null, null, current_setting('test.wo2')::uuid, 'ผู้ขาย', current_setting('test.due')::date, '',
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-NR-001'), 'quantity', 5)))) ->> 'id', true);
select lives_ok(format($$select public.app_factory_place_material_order(%L::uuid, %s)$$, current_setting('test.mr2'), pg_temp.mver(current_setting('test.mr2'))), 'a second order is placed');
select set_config('test.nr_before', pg_temp.stock('RM-TRY-NR-001')::text, true);
select lives_ok(format($$select public.app_factory_receive_material_order(%L::uuid, %s)$$, current_setting('test.mr2'), pg_temp.mver(current_setting('test.mr2'))), 'and received');
select is(pg_temp.stock('RM-TRY-NR-001'), current_setting('test.nr_before')::numeric + 5, 'the received rubber is in stock');

-- 9. ยกเลิกใบสั่งผลิตสำเร็จ -----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select is(public.app_factory_cancel_production_order(current_setting('test.wo2')::uuid, pg_temp.pver(current_setting('test.wo2')), ' ลูกค้าเลื่อนคำสั่งซื้อ ') ->> 'status', 'cancelled',
  'planning cancels a released production order whose material orders are received or cancelled');
select is(pg_temp.po(current_setting('test.wo2')) ->> 'cancel_note', 'ลูกค้าเลื่อนคำสั่งซื้อ', 'the reason is trimmed and kept');
select ok(pg_temp.po(current_setting('test.wo2')) ->> 'cancelled_at' is not null and pg_temp.po(current_setting('test.wo2')) ->> 'cancelled_by_name' = 'ทดสอบ พนักงานวางแผน',
  'the order shows when and who cancelled it');
select is(pg_temp.po(current_setting('test.wo2')) ->> 'work_order_no', 'TEST-WO-' || current_setting('test.yy') || '-002', 'the work order number stays on the cancelled order');
select is(pg_temp.stock('RM-TRY-NR-001'), current_setting('test.nr_before')::numeric + 5, 'the received stock stays');
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'อีกครั้ง')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2'))),
  'PRODUCTION_ORDER_NOT_CANCELLABLE', 'a cancelled production order cannot be cancelled again');
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, %s, 'อีกครั้ง')$$, current_setting('test.wo2'), pg_temp.pver(current_setting('test.wo2')) - 1),
  'PRODUCTION_ORDER_VERSION_CONFLICT', 'replaying the old version is refused');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 1, 'SR', '')$$, current_setting('test.wo2'), current_setting('test.rbl')),
  'JOB_WORK_ORDER_NOT_RELEASED', 'a cancelled production order accepts no new jobs');
select public.app_sandbox_enter(current_setting('test.p_ST')::uuid);
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, 'ผู้ขาย', %L::date, '', %L::jsonb)$$, current_setting('test.wo2'), current_setting('test.due'),
  jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-NR-001'), 'quantity', 1))::text),
  'MATERIAL_WORK_ORDER_NOT_RELEASED', 'nor any new material order');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
-- ฉบับร่างของฝ่ายขายยังไม่ถึงฝ่ายวางแผน: ฝ่ายวางแผนยกเลิกไม่ได้ (ฝ่ายขายแก้/ถอนกลับเองได้)
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select set_config('test.wo3', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-003')::uuid, 3, current_setting('test.due')::date, '', '')) ->> 'id', true);
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_production_order(%L::uuid, 1, 'x')$$, current_setting('test.wo3')), 'PRODUCTION_ORDER_NOT_CANCELLABLE', 'a draft cannot be cancelled by planning');

-- 10. ประวัติและ audit ---------------------------------------------------------------------------
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x
           where x ->> 'order_id' = current_setting('test.wo2')), 'create,submit,receive,plan,release,cancel', 'the production order history ends with cancel');
select is((select x ->> 'status_after' from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x
           where x ->> 'order_id' = current_setting('test.wo2') and x ->> 'action' = 'cancel'), 'cancelled', 'the cancel entry records the new status');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x
           where x ->> 'job_id' = current_setting('test.j1')), 'create,' || repeat('step,', 13) || 'cancel',
  'the started job history shows its steps and then the cancel');
select is((select x ->> 'note' from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x
           where x ->> 'job_id' = current_setting('test.j1') and x ->> 'action' = 'cancel'), 'ตัดผิดจำนวน', 'the job cancel entry keeps the reason');
reset role;
select is((select count(*) from public.audit_logs where action = 'FACTORY_PRODUCTION_CANCEL')::integer, 1, 'the production order cancellation is audited');
select is((select actor_id from public.audit_logs where action = 'FACTORY_PRODUCTION_CANCEL'), '82000000-0000-0000-0000-000000000101'::uuid, 'naming the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_PRODUCTION_CANCEL'), 'SBX-PP-STAFF', 'and the persona who cancelled');
select is((select count(*) from public.audit_logs where action = 'FACTORY_JOB_CANCEL')::integer, 2, 'both job cancellations are audited');
select is((select snapshot ->> 'cancel_note' from public.factory_production_order_history where action = 'cancel'), 'ลูกค้าเลื่อนคำสั่งซื้อ', 'the history snapshot keeps the cancel reason');
select is((select count(*) from public.factory_production_order_history where not is_test)::integer, 0, 'no real order history is written');

-- 11. แยกโหมดทดสอบและล้างข้อมูล -------------------------------------------------------------------
select is((select status from public.factory_production_orders where id = '82000000-0000-0000-0000-00000000a001'), 'released', 'the real production order is untouched');
select ok((select cancelled_at is null and cancel_note = '' from public.factory_production_orders where id = '82000000-0000-0000-0000-00000000a001'), 'with no cancel data');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'purge removes the test data including the returns');
select is(public.app_factory_master_data() -> 'jobs', '[]'::jsonb, 'no job remains');
reset role;
select is((select count(*) from public.factory_inventory_movements where is_test)::integer, 0, 'no test movement remains');
select is((select count(*) from public.factory_production_orders where not is_test)::integer, 1, 'purge never touches the real production order');

select * from finish();
rollback;
