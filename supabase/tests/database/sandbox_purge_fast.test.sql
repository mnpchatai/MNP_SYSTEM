-- ล้างข้อมูลทดสอบ BOM / RubberFlow ให้ทันเวลา (20261109010000_sandbox_purge_fast.sql)
-- ใส่ข้อมูลทดสอบระดับหลักหมื่นแถวตรง ๆ ด้วยสิทธิ์เจ้าของตาราง แล้วเรียก app_sandbox_purge_bom / app_sandbox_purge_rf ในฐาน admin ที่อยู่ในโหมดทดสอบ
-- ภายใต้ statement_timeout 8 วินาทีของ authenticated: ต้องไม่เกินเวลา ตารางทดสอบว่างหมด ข้อมูลจริงไม่ถูกแตะ claims ถูกคืน epoch เปลี่ยน และมี audit
-- ฝั่งปฏิเสธ: คนที่ไม่ใช่ admin ยังได้ NOT_AUTHORIZED เหมือนเดิม และ admin นอกโหมดทดสอบยังได้ SANDBOX_NOT_ACTIVE
-- (authenticated อ่านตาราง bom_* / rf_* ตรงไม่ได้ จึงนับตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ตัวนับแถวต่อตาราง (ใช้หลัง reset role เท่านั้น)
create function pg_temp.cnt(p_table text, p_test boolean) returns bigint
language plpgsql as $fn$
declare
  v_n bigint;
begin
  execute format('select count(*) from public.%I where is_test = $1', p_table) into v_n using p_test;
  return v_n;
end;
$fn$;
create temp table purge_bom_tables(name text) on commit drop;
insert into purge_bom_tables values ('bom_jobs'), ('bom_orders'), ('bom_customers'), ('bom_bom_lines'), ('bom_boms'), ('bom_routings'), ('bom_color_sets'),
  ('bom_packages'), ('bom_colors'), ('bom_processes'), ('bom_compounds'), ('bom_items'), ('bom_deleted_keys');
create temp table purge_rf_tables(name text) on commit drop;
insert into purge_rf_tables values ('rf_purchase_orders'), ('rf_ncrs'), ('rf_qc_records'), ('rf_fg_boxes'), ('rf_transfers'), ('rf_requisitions'), ('rf_lots'), ('rf_material_lots'),
  ('rf_molds'), ('rf_orders'), ('rf_recipes'), ('rf_materials'), ('rf_deleted_keys');

-- 1. ดัชนีฝั่งตารางลูกของ foreign key และนิยามฟังก์ชัน -----------------------------------------
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname in (
    'bom_jobs_item_idx', 'rf_orders_recipe_idx', 'rf_requisitions_order_idx', 'rf_requisitions_recipe_idx',
    'rf_lots_mold_idx', 'rf_transfers_order_idx', 'rf_transfers_lot_idx', 'rf_fg_boxes_order_idx', 'rf_qc_records_order_idx')),
  9::bigint, 'the nine foreign key indexes exist');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_jobs_item_idx' and indexdef like '%(item_code, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_orders_recipe_idx' and indexdef like '%(recipe_code, recipe_revision, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_requisitions_order_idx' and indexdef like '%(order_no, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_requisitions_recipe_idx' and indexdef like '%(recipe_code, recipe_revision, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_lots_mold_idx' and indexdef like '%(mold_id, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_transfers_order_idx' and indexdef like '%(order_no, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_transfers_lot_idx' and indexdef like '%(lot_no, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_fg_boxes_order_idx' and indexdef like '%(order_no, is_test)%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_qc_records_order_idx' and indexdef like '%(order_no, is_test)%'),
  'each index covers the referencing columns of its foreign key together with is_test');
select ok(not exists (select 1 from unnest(array['public.app_sandbox_purge_bom()', 'public.app_sandbox_purge_rf()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the purge RPCs keep their grants (signed-in users only)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.app_sandbox_purge_bom()'::regprocedure, 'public.app_sandbox_purge_rf()'::regprocedure)),
  'the purge RPCs are still security definer with an empty search_path');
select ok(position('request.jwt.claim.sub' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('request.jwt.claim.sub' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0,
  'both purges set the claims aside while deleting');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8f400000-0000-0000-0000-000000000001', 'purgefast-admin@test.local', '{}'),
  ('8f400000-0000-0000-0000-000000000002', 'purgefast-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f400000-0000-0000-0000-000000000101', 'PFAST-ADMIN', 'Purge', 'Admin', 'purgefast-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f400000-0000-0000-0000-000000000001'),
  ('8f400000-0000-0000-0000-000000000102', 'PFAST-STAFF', 'Purge', 'Staff', 'purgefast-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8f400000-0000-0000-0000-000000000002');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. ข้อมูลตั้งต้น: ใส่ตรงด้วยสิทธิ์เจ้าของตาราง (ยังไม่มี claims จึง auth.uid() เป็น null และ is_test คงตามที่ใส่) ----------------
-- 3.1 ข้อมูลจริง (is_test = false) ที่ต้องไม่ถูกแตะ
insert into public.bom_master_state (is_test, version) values (false, 99);
insert into public.bom_items (code, kind, name, owner_dept, uom) values
  ('REAL-ITEM', 'FG', 'ชิ้นงานจริง', 'PK', 'pcs'), ('REAL-CHILD', 'PURCHASED', 'ชิ้นส่วนจริง', 'PK', 'pcs');
insert into public.bom_boms (bom_id, item_code, revision, status, owner_dept) values ('REAL-BOM', 'REAL-ITEM', 1, 'approved', 'PK');
insert into public.bom_bom_lines (bom_pk, line_no, child_code, qty, uom, consumer_dept, producer_dept)
select b.id, 0, 'REAL-CHILD', 1, 'pcs', 'PK', 'PK' from public.bom_boms b where not b.is_test and b.bom_id = 'REAL-BOM';
insert into public.bom_compounds (code, name) values ('REALCP', 'คอมปาวด์จริง');
insert into public.bom_customers (name) values ('ลูกค้าจริง');
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_jobs (job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required)
select 'REAL-JOB', o.id, 'PK', 'REAL-ITEM', 'งานจริง', 'FG', 'pcs', 1, 1 from public.bom_orders o where not o.is_test and o.pi_no = 'REAL-PI';
insert into public.rf_master_state (is_test, version) values (false, 99);
insert into public.rf_materials (code, name) values ('REAL-MAT', 'วัตถุดิบจริง');
insert into public.rf_recipes (recipe_code, revision, product_code, uom, batch_kg, stages, yield_per_kg, items, status)
values ('REAL-RC', 1, 'RP', 'm', 10,
  '[{"stage":1,"mixerTemp":80,"dumpTemp":100,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":110,"mixMin":2}]'::jsonb, 1,
  '[{"materialCode":"REAL-MAT","phr":1,"stage":1}]'::jsonb, 'approved');
insert into public.rf_orders (wo_no, customer, recipe_code, recipe_revision, product_code, uom, target_qty, start_date, due_date)
values ('REAL-WO', 'ลูกค้าจริง', 'REAL-RC', 1, 'RP', 'm', 5, 1762300000000, 1762400000000);
insert into public.rf_molds (mold_no, name, clean_every) values ('REAL-DIE', 'หัวดายจริง', 1000);
insert into public.rf_purchase_orders (po_no, lines) values ('PO-20260101-01', '[{"materialCode":"REAL-MAT","qtyKg":1}]'::jsonb);

-- 3.2 BOM ทดสอบจำนวนมากเท่าขนาดข้อมูลจริง: 7,000 item · 4,000 BOM × 5 บรรทัด · งาน 500 · และตารางที่เหลืออย่างน้อยหนึ่งแถว
insert into public.bom_items (is_test, code, kind, name, owner_dept, uom)
select true, 'T-' || g, 'FG', 'ชิ้นทดสอบ ' || g, 'PK', 'pcs' from generate_series(1, 7000) g;
insert into public.bom_boms (is_test, bom_id, item_code, revision, status, owner_dept)
select true, 'TB-' || g, 'T-' || g, 1, 'approved', 'PK' from generate_series(1, 4000) g;
insert into public.bom_bom_lines (is_test, bom_pk, line_no, child_code, qty, uom, consumer_dept, producer_dept)
select true, b.id, k - 1, 'T-' || (((substr(b.bom_id, 4)::integer + k) % 7000) + 1), 1, 'pcs', 'PK', 'PK'
from public.bom_boms b cross join generate_series(1, 5) k where b.is_test and b.bom_id like 'TB-%';
insert into public.bom_compounds (is_test, code, name) select true, 'TC' || g, 'คอมปาวด์ทดสอบ ' || g from generate_series(1, 10) g;
insert into public.bom_colors (is_test, code, name) values (true, 'OR01', 'ส้ม 1'), (true, 'OR02', 'ส้ม 2');
insert into public.bom_color_sets (is_test, base, code, slots) values (true, 'T-1', 'A', '[{"key":"T-1","color":"OR01"}]'::jsonb);
insert into public.bom_packages (is_test, base, code, lines) values (true, 'T-1', 'P1', '[{"childCode":"T-2","qty":1}]'::jsonb);
insert into public.bom_processes (is_test, code, name, dept) values (true, 'TP1', 'ขั้นตอนทดสอบ', 'PK');
insert into public.bom_routings (is_test, routing_id, item_code, revision, status, steps) values (true, 'TR-1', 'T-1', 1, 'approved', '[]'::jsonb);
insert into public.bom_customers (is_test, name) values (true, 'ลูกค้าทดสอบ');
insert into public.bom_orders (is_test, pi_no, customer, country, order_type, ordered_at, wh_due) values (true, 'T-PI', 'ลูกค้าทดสอบ', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_jobs (is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required)
select true, 'TJ-' || g, o.id, 'PK', 'T-' || g, 'งานทดสอบ', 'FG', 'pcs', 1, 1
from public.bom_orders o cross join generate_series(1, 500) g where o.is_test and o.pi_no = 'T-PI';
insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'jobs', '', 'T-DEL');

-- 3.3 RubberFlow ทดสอบ: ทุกตารางมีแถว และตารางที่มี foreign key ไปใบสั่งผลิต / ล็อต / แม่พิมพ์ มีหลายร้อยแถว
insert into public.rf_materials (is_test, code, name) values (true, 'TM-1', 'วัตถุดิบทดสอบ');
insert into public.rf_recipes (is_test, recipe_code, revision, product_code, uom, batch_kg, stages, yield_per_kg, items, status)
values (true, 'TRC', 1, 'TP', 'm', 10,
  '[{"stage":1,"mixerTemp":80,"dumpTemp":100,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":110,"mixMin":2}]'::jsonb, 1,
  '[{"materialCode":"TM-1","phr":1,"stage":1}]'::jsonb, 'approved');
insert into public.rf_orders (is_test, wo_no, customer, recipe_code, recipe_revision, uom, target_qty, start_date, due_date)
select true, 'TWO-' || g, 'ลูกค้าทดสอบ', 'TRC', 1, 'kg', 5, 1762300000000, 1762400000000 from generate_series(1, 300) g;
insert into public.rf_molds (is_test, mold_no, name, clean_every) select true, 'TD-' || g, 'แม่พิมพ์ทดสอบ ' || g, 1000 from generate_series(1, 50) g;
insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry) values (true, 'TML-1', 'TM-1', 10, 10, 1900000000000);
insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines)
select true, 'TRQ-' || g, 'TWO-' || g, 'TRC', 1, 1, 10, '[{"materialCode":"TM-1","stage":1}]'::jsonb from generate_series(1, 300) g;
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, mold_id)
select true, 'TL-' || g, 'mixing', 'TWO-' || g, 'kg', 10, 'TD-' || ((g % 50) + 1) from generate_series(1, 300) g;
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent)
select true, 'TTR-' || g, 'TL-' || g, 'TWO-' || g, 'mixing', 'extrusion', 'kg', 1 from generate_series(1, 300) g;
insert into public.rf_fg_boxes (is_test, box_no, lot_no, order_no, recipe_code, qty, uom)
select true, 'TBX-' || g, 'TL-' || g, 'TWO-' || g, 'TRC', 1, 'kg' from generate_series(1, 300) g;
insert into public.rf_qc_records (is_test, qc_no, lot_no, order_no, stage, tests, result)
select true, 'TQC-' || g, 'TL-' || g, 'TWO-' || g, 'mixing', '[{"key":"hardness","value":50,"pass":true}]'::jsonb, 'pass' from generate_series(1, 300) g;
insert into public.rf_ncrs (is_test, ncr_no, title, lot_no) values (true, 'TN-1', 'NCR ทดสอบ', 'TL-1');
insert into public.rf_purchase_orders (is_test, po_no, lines)
select true, 'PO-20260102-' || lpad(g::text, 3, '0'), '[{"materialCode":"TM-1","qtyKg":1}]'::jsonb from generate_series(1, 20) g;
insert into public.rf_deleted_keys (is_test, list, key) values (true, 'orders', 'T-DEL');

select ok(pg_temp.cnt('bom_bom_lines', true) = 20000 and pg_temp.cnt('bom_items', true) = 7000 and pg_temp.cnt('bom_boms', true) = 4000,
  'the large BOM fixture is in place (7,000 items, 4,000 BOMs, 20,000 lines)');
select ok((select min(pg_temp.cnt(t.name, true)) from purge_bom_tables t) > 0 and (select min(pg_temp.cnt(t.name, true)) from purge_rf_tables t) > 0,
  'every BOM and RubberFlow table holds test rows before the purge');

-- ค่าก่อนล้าง
select set_config('test.pre_bom', (select sum(pg_temp.cnt(t.name, true))::text from purge_bom_tables t), true);
select set_config('test.pre_rf', (select sum(pg_temp.cnt(t.name, true))::text from purge_rf_tables t), true);
select set_config('test.real_bom', (select sum(pg_temp.cnt(t.name, false))::text from purge_bom_tables t), true);
select set_config('test.real_rf', (select sum(pg_temp.cnt(t.name, false))::text from purge_rf_tables t), true);
select set_config('test.epoch_bom', (select epoch::text from public.bom_master_state where is_test), true);
select set_config('test.epoch_rf', (select epoch::text from public.rf_master_state where is_test), true);
select set_config('test.audit_bom', (select count(*)::text from public.audit_logs where action = 'BOM_SANDBOX_PURGE'), true);
select set_config('test.audit_rf', (select count(*)::text from public.audit_logs where action = 'RF_SANDBOX_PURGE'), true);
select ok(current_setting('test.real_bom')::bigint >= 8 and current_setting('test.real_rf')::bigint >= 5,
  'the real fixture rows are in place');

-- 4. ปฏิเสธ: ไม่มี session / ไม่ใช่ admin / admin นอกโหมดทดสอบ -------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'AUTH_REQUIRED', 'the BOM purge requires a session');
select throws_ok('select public.app_sandbox_purge_rf()', 'AUTH_REQUIRED', 'the RubberFlow purge requires a session');

select set_config('request.jwt.claims', '{"sub":"8f400000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'NOT_AUTHORIZED', 'a non-admin cannot purge BOM');
select throws_ok('select public.app_sandbox_purge_rf()', 'NOT_AUTHORIZED', 'a non-admin cannot purge RubberFlow');

select set_config('request.jwt.claims', '{"sub":"8f400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge BOM');
select throws_ok('select public.app_sandbox_purge_rf()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge RubberFlow');
reset role;
select is(sum(pg_temp.cnt(t.name, true)), current_setting('test.pre_bom')::numeric, 'the refused BOM purges deleted nothing') from purge_bom_tables t;
select is(sum(pg_temp.cnt(t.name, true)), current_setting('test.pre_rf')::numeric, 'the refused RubberFlow purges deleted nothing') from purge_rf_tables t;

-- 5. ล้างข้อมูลจำนวนมากภายใต้ statement_timeout 8 วินาที ในฐาน admin ที่อยู่ในโหมดทดสอบ ----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f400000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.claims_before', current_setting('request.jwt.claims'), true);
select set_config('test.uid_before', auth.uid()::text, true);
select is(current_setting('test.uid_before'), '8f400000-0000-0000-0000-000000000001', 'the admin is the signed-in user before the purge');
set local statement_timeout = '8s';
select lives_ok($$ select set_config('test.purge_bom', public.app_sandbox_purge_bom()::text, true) $$, 'the BOM purge finishes within 8 seconds');
select is(auth.uid()::text, current_setting('test.uid_before'), 'auth.uid() is the admin again after the BOM purge');
select lives_ok($$ select set_config('test.purge_rf', public.app_sandbox_purge_rf()::text, true) $$, 'the RubberFlow purge finishes within 8 seconds');
select is(auth.uid()::text, current_setting('test.uid_before'), 'auth.uid() is the admin again after the RubberFlow purge');
select is(current_setting('request.jwt.claims'), current_setting('test.claims_before'), 'the JWT claims are restored exactly');
set local statement_timeout = default;
select is((current_setting('test.purge_bom')::jsonb ->> 'deleted')::bigint, current_setting('test.pre_bom')::bigint, 'the BOM purge reports every test row it deleted');
select is((current_setting('test.purge_rf')::jsonb ->> 'deleted')::bigint, current_setting('test.pre_rf')::bigint, 'the RubberFlow purge reports every test row it deleted');
-- ล้างซ้ำได้ ไม่มีอะไรเหลือให้ลบ และยังเป็นแอดมินในโหมดทดสอบอยู่
select is(public.app_sandbox_purge_bom() ->> 'deleted', '0', 'purging BOM again deletes nothing');
select is(public.app_sandbox_purge_rf() ->> 'deleted', '0', 'purging RubberFlow again deletes nothing');
select is(auth.uid()::text, current_setting('test.uid_before'), 'auth.uid() is still the admin after the repeated purges');

-- 6. หลังล้าง: ตารางทดสอบว่าง ข้อมูลจริงอยู่ครบ epoch เปลี่ยน มี audit ----------------------------------
reset role;
select is(sum(pg_temp.cnt(t.name, true)), 0::numeric, 'no test row is left in any BOM table') from purge_bom_tables t;
select is(sum(pg_temp.cnt(t.name, true)), 0::numeric, 'no test row is left in any RubberFlow table') from purge_rf_tables t;
select is(sum(pg_temp.cnt(t.name, false)), current_setting('test.real_bom')::numeric, 'the real BOM rows survive the purge') from purge_bom_tables t;
select is(sum(pg_temp.cnt(t.name, false)), current_setting('test.real_rf')::numeric, 'the real RubberFlow rows survive the purge') from purge_rf_tables t;
select is((select version from public.bom_master_state where not is_test), 99::bigint, 'the real BOM counter is untouched');
select is((select version from public.rf_master_state where not is_test), 99::bigint, 'the real RubberFlow counter is untouched');
select ok((select count(*) from public.bom_master_state where is_test) = 1 and (select count(*) from public.rf_master_state where is_test) = 1,
  'each test counter row is kept (the version keeps counting)');
select isnt((select epoch::text from public.bom_master_state where is_test), current_setting('test.epoch_bom'), 'the BOM epoch changed');
select isnt((select epoch::text from public.rf_master_state where is_test), current_setting('test.epoch_rf'), 'the RubberFlow epoch changed');
select is((select count(*) from public.audit_logs where action = 'BOM_SANDBOX_PURGE'), current_setting('test.audit_bom')::bigint + 2, 'the BOM purges wrote one audit row each (two calls)');
select is((select count(*) from public.audit_logs where action = 'RF_SANDBOX_PURGE'), current_setting('test.audit_rf')::bigint + 2, 'the RubberFlow purges wrote one audit row each (two calls)');
select ok(exists (select 1 from public.audit_logs a
                  where a.action = 'BOM_SANDBOX_PURGE' and a.actor_id = '8f400000-0000-0000-0000-000000000101'::uuid
                    and (a.metadata ->> 'deleted')::bigint = current_setting('test.pre_bom')::bigint and a.metadata ->> 'is_test' = 'true'),
  'the BOM audit row names the real admin and the deleted count');
select ok(exists (select 1 from public.audit_logs a
                  where a.action = 'RF_SANDBOX_PURGE' and a.actor_id = '8f400000-0000-0000-0000-000000000101'::uuid
                    and (a.metadata ->> 'deleted')::bigint = current_setting('test.pre_rf')::bigint and a.metadata ->> 'is_test' = 'true'),
  'the RubberFlow audit row names the real admin and the deleted count');

select * from finish();
rollback;
