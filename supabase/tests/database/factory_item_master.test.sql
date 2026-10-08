-- ฝ่ายโรงงาน Item master (20261006050000_factory_item_master.sql): โครงสร้าง สิทธิ์ การแยกโหมดทดสอบ
-- เพิ่ม/แก้ไข Item ข้อมูลตัวอย่าง และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
create temp table factory_tables(name text) on commit drop;
insert into factory_tables values
  ('factory_units'), ('factory_categories'), ('factory_items'), ('factory_item_unit_conversions'),
  ('factory_work_centers'), ('factory_warehouses'), ('factory_boms'), ('factory_bom_lines'), ('factory_routings'),
  ('factory_routing_steps'), ('factory_lots'), ('factory_production_orders'), ('factory_inventory_movements'),
  ('factory_item_history');

select is((select count(*) from factory_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  14::bigint, 'every factory table has RLS enabled');
select ok(not exists (
    select 1 from factory_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on any factory table');
select ok(not exists (
    select 1 from factory_tables t
    where t.name not in ('factory_units', 'factory_categories')
      and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass
                      and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)),
  'every factory data table enforces sandbox scope by trigger');
select ok(not exists (
    select 1 from factory_tables t
    where t.name not in ('factory_units', 'factory_categories')
      and not (t.name = any (private.sandbox_unguarded_tables()))),
  'every factory data table is registered as sandbox aware');
select ok(exists (select 1 from pg_trigger where tgrelid = 'public.factory_units'::regclass and tgname = 'sandbox_guard')
      and exists (select 1 from pg_trigger where tgrelid = 'public.factory_categories'::regclass and tgname = 'sandbox_guard'),
  'shared reference tables stay fail-closed in test mode');
select ok('ncr_info_requests' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the existing NCR tables');

select ok(not has_function_privilege('anon', 'public.app_factory_master_data()', 'execute'), 'anon cannot read factory data');
select ok(not has_function_privilege('anon', 'public.app_factory_save_item(uuid,integer,text,text,text,text,text,text,text,text,text,boolean,numeric,text)', 'execute'), 'anon cannot save items');
select ok(not has_function_privilege('anon', 'public.app_sandbox_seed_factory()', 'execute'), 'anon cannot seed');
select ok(not has_function_privilege('anon', 'public.app_sandbox_purge_factory()', 'execute'), 'anon cannot purge');
select ok(has_function_privilege('authenticated', 'public.app_factory_master_data()', 'execute'), 'signed-in users can call the read API (it checks the mode itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_actor()', 'execute'), 'clients cannot call the actor helper');
select ok(not has_function_privilege('authenticated', 'private.factory_sandbox_scope()', 'execute'), 'clients cannot call the scope trigger function');
select is((select count(*) from public.factory_units where code in ('KG', 'PCS', 'SET', 'SHEET')), 4::bigint, 'four base units are seeded');
select is((select count(*) from public.factory_categories), 9::bigint, 'nine categories are seeded');

-- 2. บัญชีทดสอบ -------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('75000000-0000-0000-0000-000000000001', 'factory-admin@test.local', '{}'),
  ('75000000-0000-0000-0000-000000000002', 'factory-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('75000000-0000-0000-0000-000000000101', 'FACTORY-ADMIN', 'Factory', 'Admin', 'factory-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '75000000-0000-0000-0000-000000000001'),
  ('75000000-0000-0000-0000-000000000102', 'FACTORY-STAFF', 'Factory', 'Staff', 'factory-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '75000000-0000-0000-0000-000000000002');
-- แถวข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ เพื่อตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('75000000-0000-0000-0000-00000000f001', 'REAL-ITEM-01', 'Item จริงสำหรับตรวจการแยกโหมด', 'RM', 'rubber', 'MNP', 'KG', 'buy');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);
select set_config('test.persona_qa', (select id::text from public.employees where employee_no = 'SBX-QA-MGR'), true);

select set_config('test.args', $$'TEST-NEW-01','ยางทดสอบ','Test rubber','RM','rubber','MNP','KG','buy','active',true,10,'ข้อกำหนดทดสอบ'$$, true);

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_factory_master_data()', 'AUTH_REQUIRED', 'reading requires a session');

select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_factory_master_data()', 'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot read factory data');
select throws_ok(format('select public.app_factory_save_item(null, null, %s)', current_setting('test.args')), 'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot create items');
select throws_ok('select public.app_sandbox_seed_factory()', 'NOT_AUTHORIZED', 'a real staff account cannot seed demo data');
select throws_ok('select public.app_sandbox_purge_factory()', 'NOT_AUTHORIZED', 'a real staff account cannot purge');
select throws_ok('select count(*) from public.factory_items', '42501', null, 'clients cannot read the item table directly');

select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_factory_master_data()', 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot read factory data (real mode is not open)');
select throws_ok(format('select public.app_factory_save_item(null, null, %s)', current_setting('test.args')), 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot create items');
select throws_ok('select public.app_sandbox_seed_factory()', 'SANDBOX_NOT_ACTIVE', 'seeding needs test mode');
select throws_ok('select public.app_sandbox_purge_factory()', 'SANDBOX_NOT_ACTIVE', 'purging needs test mode');

-- 4. โหมดทดสอบ: ข้อมูลตัวอย่าง --------------------------------------------------
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select is((public.app_factory_master_data() -> 'items'), '[]'::jsonb, 'test mode starts empty and never shows the real item');
select is(public.app_sandbox_seed_factory() ->> 'items', '16', 'seed adds the sixteen demo items');
select is(public.app_sandbox_seed_factory() ->> 'seeded', 'false', 'seeding again changes nothing');
select set_config('test.data', public.app_factory_master_data()::text, true);
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'items'), 16, 'sixteen test items are visible');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'boms'), 3, 'three BOMs');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'bom_lines'), 9, 'nine BOM lines');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'routings'), 3, 'three routings');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'steps'), 11, 'eleven routing steps');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'production'), 2, 'two production orders');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'warehouses'), 3, 'three warehouses');
select is((select (x ->> 'stock')::numeric from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'code' = 'RM-NR-001'),
  1200::numeric, 'stock is the sum of movements');
select is((select x ->> 'status' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'code' = 'RM-EVA-OLD'),
  'inactive', 'the legacy grade is seeded as inactive');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('test.data')::jsonb -> 'inventory') x where x ->> 'code' = 'RM-EVA-OLD'),
  'inventory lists active items only');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'inventory') x where x ->> 'lot_number' is null and x ->> 'code' like 'PKG-%'),
  3::bigint, 'packaging without lot tracking has stock without a lot');
select is(public.app_factory_master_data() -> 'history', '[]'::jsonb, 'seed rows are not item edits, so history starts empty');

-- 5. เพิ่ม/แก้ไข Item -------------------------------------------------------------
select set_config('test.new', (public.app_factory_save_item(null, null, 'test-new-01', ' ยางทดสอบ ', 'Test rubber', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 10, 'ข้อกำหนดทดสอบ')) ->> 'id', true);
select is((select x ->> 'code' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'id' = current_setting('test.new')),
  'TEST-NEW-01', 'code is stored upper-case');
select is((select x ->> 'name' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'id' = current_setting('test.new')),
  'ยางทดสอบ', 'name is trimmed');
select is((select x ->> 'version' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'id' = current_setting('test.new')),
  '1', 'new items start at version 1');
select throws_ok(format('select public.app_factory_save_item(null, null, %s)', current_setting('test.args')), 'ITEM_CODE_TAKEN', 'duplicate codes are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'rm-nr-001', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'ITEM_CODE_TAKEN', 'duplicate check ignores case');
select throws_ok($$select public.app_factory_save_item(null, null, 'A', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_CODE', 'codes need at least two characters');
select throws_ok($$select public.app_factory_save_item(null, null, 'BAD CODE', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_CODE', 'codes allow letters, digits, - and _ only');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', '   ', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_NAME_TH', 'a Thai name is required');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'XX', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_TYPE', 'unknown types are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'nope', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_CATEGORY', 'unknown categories are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'ACME', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_BRAND', 'unknown brands are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'LB', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_UNIT', 'unknown units are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'gift', 'active', true, 0, '')$$, 'INVALID_ITEM_PROCUREMENT', 'unknown procurement is rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'deleted', true, 0, '')$$, 'INVALID_ITEM_STATUS', 'only active/inactive are allowed');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', null, 0, '')$$, 'INVALID_ITEM_LOT_TRACKING', 'lot tracking must be chosen');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, -1, '')$$, 'INVALID_ITEM_MIN_STOCK', 'negative minimum stock is rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 'NaN', '')$$, 'INVALID_ITEM_MIN_STOCK', 'NaN minimum stock is rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 'Infinity', '')$$, 'INVALID_ITEM_MIN_STOCK', 'infinite minimum stock is rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', repeat('e', 161), 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, 'INVALID_ITEM_NAME_EN', 'long English names are rejected');
select throws_ok($$select public.app_factory_save_item(null, null, 'OK-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, repeat('s', 3001))$$, 'INVALID_ITEM_SPECIFICATION', 'long specifications are rejected');

select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'TEST-NEW-01', 'ยางทดสอบ แก้ไข', 'Test rubber', 'RM', 'chemical', 'SAFSOF', 'KG', 'make', 'inactive', true, 25, 'แก้ไขแล้ว')$$, current_setting('test.new')),
  'the current version can be edited');
select is((select x ->> 'version' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'id' = current_setting('test.new')),
  '2', 'each edit increments the version');
select is((select x ->> 'status' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'id' = current_setting('test.new')),
  'inactive', 'items are retired with a status, not deleted');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'TEST-NEW-01', 'ทับ', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, current_setting('test.new')),
  'ITEM_VERSION_CONFLICT', 'a stale version cannot overwrite a newer edit');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'TEST-NEW-01', 'x', '', 'RM', 'rubber', 'MNP', 'PCS', 'buy', 'active', true, 0, '')$$, current_setting('test.new')),
  'ITEM_LOCKED_FIELDS', 'the base unit is locked after creation');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'TEST-NEW-01', 'x', '', 'WIP', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, current_setting('test.new')),
  'ITEM_LOCKED_FIELDS', 'the item type is locked after creation');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'TEST-NEW-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', false, 0, '')$$, current_setting('test.new')),
  'ITEM_LOCKED_FIELDS', 'lot tracking is locked after creation');
select throws_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'RM-NR-001', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$, current_setting('test.new')),
  'ITEM_CODE_TAKEN', 'renaming to an existing code is rejected');
select throws_ok($$select public.app_factory_save_item('75000000-0000-0000-0000-00000000dead', 1, 'GHOST-01', 'x', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$,
  'ITEM_NOT_FOUND', 'unknown ids are rejected');
select throws_ok($$select public.app_factory_save_item('75000000-0000-0000-0000-00000000f001', 1, 'REAL-ITEM-01', 'hijack', '', 'RM', 'rubber', 'MNP', 'KG', 'buy', 'active', true, 0, '')$$,
  'ITEM_NOT_FOUND', 'test mode cannot edit a real item');
select throws_ok($$update public.factory_items set name = 'direct' where code = 'RM-NR-001'$$, '42501', null, 'clients cannot update items directly');
select throws_ok($$insert into public.factory_item_history (item_id, action, version, after_data) values ('75000000-0000-0000-0000-00000000f001', 'create', 1, '{}')$$, '42501', null, 'clients cannot forge history');

select set_config('test.history', (public.app_factory_master_data() -> 'history')::text, true);
select is(jsonb_array_length(current_setting('test.history')::jsonb), 2, 'create and update are both in the history');
select is((current_setting('test.history')::jsonb -> 0 ->> 'action'), 'update', 'latest history entry first');
select is((current_setting('test.history')::jsonb -> 0 -> 'before_data' ->> 'name'), 'ยางทดสอบ', 'history keeps the value before the edit');
select is((current_setting('test.history')::jsonb -> 0 -> 'after_data' ->> 'name'), 'ยางทดสอบ แก้ไข', 'history keeps the value after the edit');
select is((current_setting('test.history')::jsonb -> 0 ->> 'changed_by_name'), 'ทดสอบ พนักงาน RB', 'history names the persona who edited');

-- 6. อีก persona ก็เห็นข้อมูลทดสอบชุดเดียวกัน ออกจากโหมดแล้วมองไม่เห็น --------------------
select public.app_sandbox_enter(current_setting('test.persona_qa')::uuid);
select is(jsonb_array_length(public.app_factory_master_data() -> 'items'), 17, 'another persona sees the same test register');
select public.app_sandbox_exit();
select throws_ok('select public.app_factory_master_data()', 'FACTORY_TEST_MODE_ONLY', 'leaving test mode closes the module again');

reset role;
select is((select count(*) from public.factory_items where is_test), 17::bigint, 'all items written through the API are flagged as test data');
select is((select count(*) from public.factory_inventory_movements where not is_test), 0::bigint, 'seed never writes real movements');
select is((select updated_by from public.factory_items where id = current_setting('test.new')::uuid),
  current_setting('test.persona')::uuid, 'the editor is recorded as the persona');
select is((select count(*) from public.audit_logs where action in ('FACTORY_ITEM_CREATE', 'FACTORY_ITEM_UPDATE') and entity_id = current_setting('test.new')),
  2::bigint, 'every item save is audited');
select is((select actor_id from public.audit_logs where action = 'FACTORY_ITEM_CREATE' and entity_id = current_setting('test.new')),
  '75000000-0000-0000-0000-000000000101'::uuid, 'the audit log names the real admin behind the persona');
-- ไม่มี session = งานระบบ: trigger ไม่ตั้งโหมดให้ จึงทดสอบ foreign key แบบคู่ได้ตรงๆ
select set_config('request.jwt.claims', '', true);
select throws_ok($$insert into public.factory_boms (item_id, is_test, revision, output_qty, effective_date)
                   values ('75000000-0000-0000-0000-00000000f001', true, 'Z', 1, current_date)$$,
  '23503', null, 'a test BOM cannot reference a real item (paired foreign key)');

-- 7. ล้างข้อมูลทดสอบ -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"75000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select is(public.app_sandbox_purge_factory() ->> 'deleted', '17', 'purge removes every test item');
select is(public.app_factory_master_data() -> 'items', '[]'::jsonb, 'test register is empty after purge');
select is(public.app_sandbox_seed_factory() ->> 'seeded', 'true', 'demo data can be loaded again after a purge');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_items where not is_test), 1::bigint, 'purge never touches real items');
select ok(exists (select 1 from public.audit_logs where action = 'SANDBOX_PURGE_FACTORY'), 'purge is audited');
select ok(exists (select 1 from public.audit_logs where action = 'SANDBOX_SEED_FACTORY'), 'seed is audited');

select * from finish();
rollback;
