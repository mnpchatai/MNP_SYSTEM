-- ต้นทุนการผลิต เฟส 1 (20270109010000_cost_rb_formula_prices.sql)
--   สูตรแบบน้ำหนัก 4 ส่วน (ขั้นเตรียมวัตถุดิบ + ขั้น 1-3) · บรรทัดน้ำหนัก 0 · สูตร PHR เดิมยังใช้ได้ · ใบเบิกได้บรรทัดครบทุกส่วน
--   ราคาเคมีต่อ kg (เพิ่มอย่างเดียว มีวันที่เริ่มใช้) และข้อมูลต้นทุน: ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกบทบาท / แผนก
--     ต้นทุน + ราคา: GM / ผจก.โรงงาน / admin / แผนก PP · ราคาอย่างเดียว (อ่าน + แก้): แผนก ST · แก้ราคา: ST + admin · คนอื่นไม่ได้อะไรเลย
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.rf_material_prices'::regclass), 'the price table has RLS enabled');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
                      where has_table_privilege(r.role, 'public.rf_material_prices', p.priv)),
  'anon and authenticated have no direct privilege on the price table');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_material_prices'::regclass and p.polname = 'rf_material_prices_no_direct_access'),
  'the price table has the deny-all policy');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_material_prices'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'and the restrictive lab-only policy');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.rf_material_prices'::regclass and g.tgname = 'rf_material_prices_sandbox_scope' and not g.tgisinternal),
  'the price table separates test data from real data by trigger');
select ok('rf_material_prices' = any (private.sandbox_unguarded_tables()) and 'rf_chem_docs' = any (private.sandbox_unguarded_tables())
      and 'client_error_logs' = any (private.sandbox_unguarded_tables()) and 'itar_requests' = any (private.sandbox_unguarded_tables()),
  'the new table is sandbox aware and the patched list keeps the earlier tables');
select ok(position('rf_material_prices' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_chem_docs' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0,
  'the RubberFlow purge deletes the test prices too');
select ok(not exists (
    select 1 from unnest(array['private.rf_cost_viewer(public.employees)', 'private.rf_price_writer(public.employees)', 'private.rf_price_reader(public.employees)',
                               'private.rf_price_rows()', 'private.rf_items_by_weight(jsonb)', 'private.rf_parse_items(jsonb,jsonb)',
                               'private.rf_save_recipes(uuid,boolean,jsonb,bigint,bigint)', 'private.sandbox_unguarded_tables()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'clients cannot call the private helpers');
-- app_rf_price_save มีหกอาร์กิวเมนต์ (+ p_supplier) ตั้งแต่ 20270111010000_cost_dept_items.sql · การเรียกด้วยสี่ / ห้าอาร์กิวเมนต์ในไฟล์นี้ยังใช้ได้
select is((select count(*)::integer from pg_proc p
           where p.oid in ('private.rf_cost_viewer(public.employees)'::regprocedure, 'private.rf_price_writer(public.employees)'::regprocedure,
                           'private.rf_price_reader(public.employees)'::regprocedure, 'private.rf_price_rows()'::regprocedure,
                           'private.rf_parse_items(jsonb,jsonb)'::regprocedure, 'private.rf_save_recipes(uuid,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_rf_prices()'::regprocedure, 'public.app_rf_price_save(text,text,numeric,date,text,text)'::regprocedure,
                           'public.app_rf_cost_data()'::regprocedure, 'public.app_sandbox_purge_rf()'::regprocedure)
             and p.prosecdef and p.proconfig @> array['search_path=""']), 10,
  'the helpers and the RPCs are security definer with an empty search_path');
select ok(not exists (
    select 1 from unnest(array['public.app_rf_prices()', 'public.app_rf_price_save(text,text,numeric,date,text,text)', 'public.app_rf_cost_data()', 'public.app_sandbox_purge_rf()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the public RPCs are for authenticated only');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบและตัวช่วย ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8ec00000-0000-0000-0000-000000000001', 'cost-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ec00000-0000-0000-0000-000000000101', 'COST-ADMIN', 'Cost', 'Admin', 'cost-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ec00000-0000-0000-0000-000000000001');
-- persona เพิ่ม: admin · ผู้จัดการแผนก ST · ผู้ช่วย ผจก.โรงงานที่สังกัดแผนก PP (แผนก PP เห็นทุกอย่างไม่ว่าบทบาทใด)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.no, 'ทดสอบ', v.last_name, lower(v.no) || '@sandbox.local', v.last_name || ' (ทดสอบ)', d.id, r.id, false, true
from (values ('SBX-ADMIN-C', 'ผู้ดูแลระบบ', 'MGT', 'admin'), ('SBX-ST-MGR-C', 'ผจก. ST', 'ST', 'department_manager'),
             ('SBX-PP-AFM-C', 'ผู้ช่วย ผจก.โรงงาน PP', 'PP', 'assistant_factory_manager'),
             ('SBX-FT-AFM-C', 'ผู้ช่วย ผจก.โรงงาน', 'FT', 'assistant_factory_manager')) v(no, last_name, dept, role)
join public.departments d on d.code = v.dept
join public.roles r on r.code = v.role;
select is((select count(*)::integer from public.employees where employee_no in ('SBX-ADMIN-C', 'SBX-ST-MGR-C', 'SBX-PP-AFM-C', 'SBX-FT-AFM-C')), 4, 'the four extra test personas exist');
select is((select count(*)::integer from public.employees where is_test and employee_no in
            ('SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-RB-MGR', 'SBX-ST-STAFF', 'SBX-QA-STAFF', 'SBX-WH-STAFF', 'SBX-FT-FM', 'SBX-MGT-GM')), 8,
  'the seeded personas this test needs exist');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select set_config('test.now_ms', (extract(epoch from now()) * 1000)::bigint::text, true);
select set_config('test.today', to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), true);
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็น และการล้างข้อมูลทดสอบต้องไม่ลบ
insert into public.rf_materials (code, name) values ('REAL-MAT', 'วัตถุดิบจริง');
insert into public.rf_material_prices (material_code, unit_price, effective_from) values ('REAL-MAT', 10, date '2026-01-01');
-- ของซื้อของข้อมูลจริง: โหมดทดสอบตั้งราคาให้ไม่ได้
insert into public.bom_items (code, kind, name, owner_dept, uom) values ('P-REAL', 'PURCHASED', 'ของซื้อจริง', 'ST', 'pcs');
select is((select count(*)::integer from public.rf_material_prices where not is_test), 1, 'a row written outside test mode is a real row');

create schema cost_t;
grant usage on schema cost_t to authenticated;
create function cost_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function cost_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, cost_t.rver(), p_action)
$$;
create function cost_t.recipe(p_row jsonb, p_action text default 'createRecipe') returns jsonb language sql volatile as $$
  select cost_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
create function cost_t.rec(p_id text, p_rev integer default 1) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = p_id and (r ->> 'revision')::integer = p_rev
$$;
create function cost_t.req(p_no text) returns jsonb language sql stable as $$
  select q from jsonb_array_elements(public.app_rf_master() -> 'requisitions') q where q ->> 'id' = p_no
$$;
create function cost_t.wo(p_no text) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = p_no
$$;

select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
-- สูตรแบบน้ำหนัก: เตรียมวัตถุดิบ 13 kg · ขั้น 1 500 g + บรรทัดไม่ใส่ (0) · ขั้น 3 40 g = 13.54 kg ต่อโม่ · batchKg ที่ส่งมา (99) ต้องถูกแทนด้วยผลรวม
select set_config('test.wrec', '{"id":"W-1","revision":1,"productCode":"P-W","uom":"m","batchKg":99,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"status":"draft","items":[{"materialCode":"M-PREP","stage":0,"kg":13,"unit":"kg"},{"materialCode":"M-S1","stage":1,"kg":0.5,"unit":"g"},{"materialCode":"M-ZERO","stage":1,"kg":0,"unit":"g"},{"materialCode":"M-S3","stage":3,"kg":0.04,"unit":"g"}]}', true);
select set_config('test.prec', '{"id":"P-1","revision":1,"productCode":"P-P","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"status":"draft","items":[{"materialCode":"M-PREP","phr":100,"stage":1},{"materialCode":"M-S1","phr":50,"stage":2}]}', true);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"PO-1","recipeId":"W-1","recipeRevision":1,"color":"ดำ","targetQty":100,"targetKg":13.54,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);

-- 3. สูตรแบบน้ำหนัก ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8ec00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cost_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"M-PREP","name":"ยางสาธิต A"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"M-S1","name":"เคมีสาธิต 01"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"M-ZERO","name":"เคมีสาธิต 02"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"M-S3","name":"เคมีสาธิต 03"}'::jsonb))), 'saveMaterial') is not null,
  'the planner adds the materials');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb) $$, 'RB drafts a recipe entered by weight in four parts');
select is((cost_t.rec('W-1') ->> 'batchKg')::numeric, 13.54::numeric, 'the batch weight is the sum of the line weights, not the value the client sent');
select is(cost_t.rec('W-1') -> 'items',
  '[{"materialCode":"M-PREP","phr":13,"stage":0,"kg":13,"unit":"kg"},{"materialCode":"M-S1","phr":0.5,"stage":1,"kg":0.5,"unit":"g"},{"materialCode":"M-ZERO","phr":0,"stage":1,"kg":0,"unit":"g"},{"materialCode":"M-S3","phr":0.04,"stage":3,"kg":0.04,"unit":"g"}]'::jsonb,
  'lines keep part 0-3, the weight in kg, the entered unit and phr = kg; a line with no amount is kept at zero');
select lives_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb) $$, 'sending the same draft again is a no-op (the stored batch weight does not make it look changed)');

select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":13,"unit":"kg"},{"materialCode":"M-S1","phr":5,"stage":1}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a recipe cannot mix weight lines with PHR lines');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":4,"kg":13,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'there is no part 4');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":1.5,"kg":13,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'the part must be a whole number');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":-1,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a negative weight is refused');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":1.00001,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a weight finer than 0.1 g is refused');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":13,"unit":"kg"},{"materialCode":"M-S1","stage":1,"kg":0.0005,"unit":"g"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a non-zero weight under 1 g is refused (the requisition would silently skip it)');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":10001,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a line above 10,000 kg is refused');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":13,"unit":"lb"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'the unit is kg or g only');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":0,"unit":"kg"},{"materialCode":"M-S1","stage":1,"kg":0,"unit":"g"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a recipe whose lines are all zero is refused');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-PREP","stage":0,"kg":"13","unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'the weight must be a JSON number');
select throws_ok($$ select cost_t.recipe(current_setting('test.wrec')::jsonb || '{"id":"W-BAD","items":[{"materialCode":"M-NONE","stage":0,"kg":13,"unit":"kg"}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'the material must exist');

-- สูตร PHR เดิม: ยังบันทึกได้ และกฎเดิมไม่เปลี่ยน
select lives_ok($$ select cost_t.recipe(current_setting('test.prec')::jsonb) $$, 'a PHR recipe with two stages still saves');
select is((cost_t.rec('P-1') ->> 'batchKg')::numeric, 60::numeric, 'a PHR recipe keeps the batch weight that was entered');
select is(cost_t.rec('P-1') -> 'items', '[{"materialCode":"M-PREP","phr":100,"stage":1},{"materialCode":"M-S1","phr":50,"stage":2}]'::jsonb,
  'and its lines keep the old shape');
select throws_ok($$ select cost_t.recipe(current_setting('test.prec')::jsonb || '{"id":"P-BAD","items":[{"materialCode":"M-PREP","phr":100,"stage":0}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a PHR line still has stage 1 or 2 only');
select throws_ok($$ select cost_t.recipe(current_setting('test.prec')::jsonb || '{"id":"P-BAD","items":[{"materialCode":"M-PREP","phr":100,"stage":3}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'no stage 3 on a PHR line');
select throws_ok($$ select cost_t.recipe(current_setting('test.prec')::jsonb || '{"id":"P-BAD","items":[{"materialCode":"M-PREP","phr":0,"stage":1}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a PHR line still needs phr above zero');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select lives_ok($$ select cost_t.recipe(cost_t.rec('W-1') || '{"status":"approved"}'::jsonb, 'approveRecipe') $$, 'the RB head approves the weight recipe');
select throws_ok($$ select cost_t.recipe(cost_t.rec('W-1') || jsonb_build_object('items', jsonb_set(cost_t.rec('W-1') -> 'items', '{0,kg}', '14'::jsonb)), 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'an approved weight recipe cannot be edited in place');

-- 4. ใบเบิกของสูตรแบบน้ำหนัก: บรรทัดครบทุกส่วน ไม่มีบรรทัดของน้ำหนัก 0 --------------------------------------------
reset role;
insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry, rb_kg) values
  (true, 'L-PREP', 'M-PREP', 0, 100, current_setting('test.now_ms')::bigint + 864000000, 100),
  (true, 'L-S1', 'M-S1', 0, 10, current_setting('test.now_ms')::bigint + 864000000, 10),
  (true, 'L-S3', 'M-S3', 0, 10, current_setting('test.now_ms')::bigint + 864000000, 10);
update public.rf_master_state set version = version + 1 where is_test;
-- ของซื้อของ BOM ในโหมดทดสอบ (ใส่ตรงขณะสวม persona เหมือนล็อตข้างบน): P-BOX เป็นของซื้อ ตั้งราคาได้ · FG-X ไม่ใช่ของซื้อ
insert into public.bom_items (is_test, code, kind, name, owner_dept, uom) values
  (true, 'P-BOX', 'PURCHASED', 'กล่องสาธิต', 'ST', 'box'), (true, 'FG-X', 'FG', 'สินค้าสาธิต', 'PK', 'pcs');
select is((select count(*)::integer from public.bom_items where is_test and code in ('P-BOX', 'FG-X')), 2, 'the two test BOM items exist');
select is((select count(*)::integer from public.bom_items where not is_test and code = 'P-REAL'), 1, 'and the real purchased part is a real row');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select cost_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.wo')::jsonb || '{"id":"WO-C1"}'::jsonb))), 'createOrder') $$,
  'the planner opens a work order for the weight recipe');
select lives_ok($$ select cost_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(cost_t.wo('WO-C1') || '{"status":"released"}'::jsonb))), 'setOrderStatus') $$,
  'and releases it');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select cost_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array('{"id":"REQ-C1","orderId":"WO-C1","batches":1,"note":""}'::jsonb))), 'createRequisition') $$,
  'RB raises the mixing requisition (M-ZERO has no stock at all and is not needed)');
select is((select jsonb_agg(jsonb_build_array(e ->> 'materialCode', (e ->> 'stage')::integer, (e ->> 'targetKg')::numeric, (e ->> 'actualKg')::numeric) order by t.ord)
           from jsonb_array_elements(cost_t.req('REQ-C1') -> 'lines') with ordinality as t(e, ord)),
  '[["M-PREP", 0, 13, 13], ["M-S1", 1, 0.5, 0.5], ["M-S3", 3, 0.04, 0.04]]'::jsonb,
  'the requisition has one line per weighed chemical in part order, each exactly the recipe weight, and no line for the zero-weight chemical');
select is((cost_t.req('REQ-C1') ->> 'totalKg')::numeric, 13.54::numeric, 'the requisition total is the batch weight');
select lives_ok($$ select cost_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', 'MX-C1', 'stage', 'mixing', 'orderId', 'WO-C1', 'recipeId', 'W-1', 'uom', 'kg', 'machine', 'KN-01 Kneader 75L', 'shift', 'D',
    'sources', '[{"type":"requisition","id":"REQ-C1"}]'::jsonb,
    'params', '{"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":116,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":141,"mixMin":2}],"batches":1}'::jsonb,
    'goodQty', 13, 'scrapQty', 0.5, 'scrapReason', 'เศษติดโรเตอร์', 'qc', 'pass', 'holdReasons', '[]'::jsonb)))), 'recordMixing') $$,
  'RB records the mixing lot with the two mixing stages as before');

-- 5. ราคาเคมี: ใครอ่าน ใครแก้ ---------------------------------------------------------------------------
-- 5.1 ไม่เห็นอะไรเลย: RB (พนักงาน / หัวหน้า) QA WH ผู้ช่วย ผจก.โรงงาน (แผนก FT)
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_prices() $$, 'RF_FORBIDDEN', 'RB staff cannot read prices');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'RB staff cannot write a price');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'RB staff cannot read cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select public.app_rf_prices() $$, 'RF_FORBIDDEN', 'the RB department manager cannot read prices');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'nor write one');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'nor read cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_prices() $$, 'RF_FORBIDDEN', 'QA cannot read prices');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'QA cannot write a price');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'QA cannot read cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select public.app_rf_prices() $$, 'RF_FORBIDDEN', 'WH cannot read prices');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'WH cannot write a price');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'WH cannot read cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm_c')::uuid);
select throws_ok($$ select public.app_rf_prices() $$, 'RF_FORBIDDEN', 'the assistant factory manager cannot read prices');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'nor write one');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'nor read cost data');

-- 5.2 แผนก ST: อ่านและแก้ราคา แต่ไม่เห็นต้นทุน
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(public.app_rf_prices(), '{"canWrite": true, "prices": []}'::jsonb, 'ST staff read the (empty) test price list and may write; the real price row is not listed');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'ST staff cannot read cost data');
select lives_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, date '2026-01-01', 'ราคาเปิด') $$, 'ST staff enter a price');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-NONE', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'the material must exist');
select throws_ok($$ select public.app_rf_price_save('chem', 'REAL-MAT', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a real material is not a test material');
select throws_ok($$ select public.app_rf_price_save('other', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'the kind is chem or part only');
select throws_ok($$ select public.app_rf_price_save(null, 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'the kind is required');
select throws_ok($$ select public.app_rf_price_save('part', 'M-PREP', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a chemical code is not a purchased part');
select throws_ok($$ select public.app_rf_price_save('chem', 'P-BOX', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a purchased part code is not a chemical');
select throws_ok($$ select public.app_rf_price_save('part', 'FG-X', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'only purchased parts take a price, not other BOM items');
select throws_ok($$ select public.app_rf_price_save('part', 'P-REAL', 50, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a real purchased part is not a test part');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 0, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'the price must be above zero');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', -5, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a negative price is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', null, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a missing price is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 'NaN'::numeric, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'NaN is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 10000001, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'a price above the ceiling is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 1.00001, current_setting('test.today')::date) $$, 'RF_INVALID_PRICE', 'more than four decimals is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, null) $$, 'RF_INVALID_PRICE', 'the effective date is required');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date + 400) $$, 'RF_INVALID_PRICE', 'an effective date more than a year ahead is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, date '1999-12-31') $$, 'RF_INVALID_PRICE', 'an effective date before 2000 is refused');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 50, current_setting('test.today')::date, repeat('x', 301)) $$, 'RF_INVALID_PRICE', 'a note over 300 characters is refused');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_mgr_c')::uuid);
select lives_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 55, current_setting('test.today')::date) $$, 'the ST department manager enters a newer price');
select lives_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 56, current_setting('test.today')::date, 'แก้ราคา') $$, 'a correction on the same date is a new row');
select lives_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 56, current_setting('test.today')::date, 'แก้ราคา') $$, 'pressing save twice with the same values adds nothing');
select lives_ok($$ select public.app_rf_price_save('chem', 'M-S1', 120.5, current_setting('test.today')::date + 30) $$, 'a price may start in the future');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_FORBIDDEN', 'the ST department manager cannot read cost data');
select is((select jsonb_agg(jsonb_build_array(p ->> 'materialCode', (p ->> 'unitPrice')::numeric, p ->> 'effectiveFrom', p ->> 'note') order by t.ord)
           from jsonb_array_elements(public.app_rf_prices() -> 'prices') with ordinality as t(p, ord)),
  jsonb_build_array(
    jsonb_build_array('M-PREP', 56, current_setting('test.today'), 'แก้ราคา'),
    jsonb_build_array('M-PREP', 55, current_setting('test.today'), ''),
    jsonb_build_array('M-PREP', 50, '2026-01-01', 'ราคาเปิด'),
    jsonb_build_array('M-S1', 120.5, to_char(current_setting('test.today')::date + 30, 'YYYY-MM-DD'), '')),
  'the list keeps every row: newest effective date first, and on the same date the latest entry first');
select ok((public.app_rf_prices() -> 'prices' -> 0 ->> 'createdBy') like 'ทดสอบ%' and (public.app_rf_prices() -> 'prices' -> 0 ->> 'createdAt')::bigint > 0,
  'each row says who entered it and when');

-- 5.3 แผนก PP / GM / ผจก.โรงงาน: เห็นราคาและต้นทุน แต่แก้ราคาไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_prices() -> 'canWrite', 'false'::jsonb, 'PP staff read prices without the right to write');
select is(jsonb_array_length(public.app_rf_prices() -> 'prices'), 4, 'PP staff see every price row');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'PP staff cannot write a price');
select lives_ok($$ select public.app_rf_cost_data() $$, 'PP staff read cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_afm_c')::uuid);
select lives_ok($$ select public.app_rf_cost_data() $$, 'an assistant factory manager who belongs to PP reads cost data (PP sees everything)');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'but cannot write a price');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select is(public.app_rf_prices() -> 'canWrite', 'false'::jsonb, 'the general manager reads prices without the right to write');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'the general manager cannot write a price');
select lives_ok($$ select public.app_rf_cost_data() $$, 'the general manager reads cost data');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is(public.app_rf_prices() -> 'canWrite', 'false'::jsonb, 'the factory manager reads prices without the right to write');
select throws_ok($$ select public.app_rf_price_save('chem', 'M-PREP', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'the factory manager cannot write a price');
select lives_ok($$ select public.app_rf_cost_data() $$, 'the factory manager reads cost data');

-- 5.4 admin: ทุกอย่าง
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_c')::uuid);
select is(public.app_rf_prices() -> 'canWrite', 'true'::jsonb, 'the admin may write prices');
select lives_ok($$ select public.app_rf_price_save('chem', 'M-S3', 900, date '2026-06-01') $$, 'the admin enters a price');
select lives_ok($$ select public.app_rf_price_save('part', 'P-BOX', 12.5, date '2026-06-01', 'ต่อกล่อง') $$, 'and the price of a purchased part (per its own unit)');
select is((select jsonb_agg(jsonb_build_array(p ->> 'kind', p ->> 'materialCode', (p ->> 'unitPrice')::numeric) order by t.ord)
           from jsonb_array_elements(public.app_rf_prices() -> 'prices') with ordinality as t(p, ord) where p ->> 'materialCode' in ('P-BOX', 'M-S3')),
  '[["chem", "M-S3", 900], ["part", "P-BOX", 12.5]]'::jsonb, 'each row says whether it prices a chemical or a purchased part');
select set_config('test.cost', public.app_rf_cost_data()::text, true);
select is(jsonb_array_length(current_setting('test.cost')::jsonb -> 'prices'), 6, 'cost data carries every test price row');
select is((select jsonb_agg(m ->> 'code' order by m ->> 'code') from jsonb_array_elements(current_setting('test.cost')::jsonb -> 'materials') m),
  '["M-PREP", "M-S1", "M-S3", "M-ZERO"]'::jsonb, 'the test materials only');
select is((select jsonb_build_array(r ->> 'status', (r ->> 'batchKg')::numeric, jsonb_array_length(r -> 'items'))
           from jsonb_array_elements(current_setting('test.cost')::jsonb -> 'recipes') r where r ->> 'id' = 'W-1'),
  '["approved", 13.54, 4]'::jsonb, 'the weight recipe with its batch weight and all four lines');
select is(jsonb_array_length(current_setting('test.cost')::jsonb -> 'recipes'), 2, 'both recipes are listed');
select is((select jsonb_build_array(l ->> 'orderId', l ->> 'recipeId', (l ->> 'recipeRevision')::integer, (l ->> 'batches')::numeric, l -> 'requisitions' -> 0 ->> 'id',
                                    jsonb_array_length(l -> 'requisitions' -> 0 -> 'lines'))
           from jsonb_array_elements(current_setting('test.cost')::jsonb -> 'lots') l where l ->> 'lotNo' = 'MX-C1'),
  '["WO-C1", "W-1", 1, 1, "REQ-C1", 3]'::jsonb, 'the mixing lot comes with the requisition it was mixed from');
select is((select jsonb_agg(jsonb_build_array(e ->> 'materialCode', (e ->> 'stage')::integer, (e ->> 'actualKg')::numeric) order by t.ord)
           from jsonb_array_elements(current_setting('test.cost')::jsonb -> 'lots' -> 0 -> 'requisitions' -> 0 -> 'lines') with ordinality as t(e, ord)),
  '[["M-PREP", 0, 13], ["M-S1", 1, 0.5], ["M-S3", 3, 0.04]]'::jsonb, 'and the weighed amount of every line');
select ok((current_setting('test.cost')::jsonb -> 'lots' -> 0 -> 'requisitions' -> 0 -> 'lines' -> 0 -> 'weighedAt') is not null
      and not ((current_setting('test.cost')::jsonb -> 'lots' -> 0 -> 'requisitions' -> 0 -> 'lines' -> 0) ? 'lotNo'),
  'lines carry the weighing time and only the fields the cost view needs');

-- 6. นอกโหมดทดสอบ: ปิด (private.bom_real_open() = false) -------------------------------------------------------
select lives_ok('select public.app_sandbox_exit()', 'the admin leaves test mode');
select throws_ok($$ select public.app_rf_prices() $$, 'RF_TEST_MODE_ONLY', 'outside test mode the price list is closed');
select throws_ok($$ select public.app_rf_price_save('chem', 'REAL-MAT', 50, current_setting('test.today')::date) $$, 'RF_TEST_MODE_ONLY', 'so is the price entry');
select throws_ok($$ select public.app_rf_cost_data() $$, 'RF_TEST_MODE_ONLY', 'and the cost data');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_prices() $$, 'AUTH_REQUIRED', 'no session, no prices');
select throws_ok($$ select public.app_rf_cost_data() $$, 'AUTH_REQUIRED', 'no session, no cost data');

-- 7. ตารางเพิ่มอย่างเดียว และการล้างข้อมูลทดสอบ ---------------------------------------------------------------
reset role;
select is((select count(*)::integer from public.rf_material_prices where is_test), 6, 'six test price rows were written (the repeated save added none)');
select is((select count(*)::integer from public.rf_material_prices where is_test and created_by is null), 0, 'every test row records who entered it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8ec00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.rf_material_prices $$, '42501', null, 'authenticated cannot read the price table directly');
select throws_ok($$ insert into public.rf_material_prices (material_code, unit_price, effective_from) values ('M-PREP', 1, date '2026-01-01') $$, '42501', null,
  'nor insert into it');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok('select public.app_sandbox_purge_rf()', 'the admin in test mode purges the RubberFlow test data');
reset role;
select is((select count(*)::integer from public.rf_material_prices where is_test), 0, 'the purge removed the test prices');
select is((select count(*)::integer from public.rf_material_prices where not is_test), 1, 'and kept the real price row');
select is((select count(*)::integer from public.rf_material_prices where kind not in ('chem', 'part')), 0, 'every row is a chemical or a purchased part price');

select * from finish();
rollback;
