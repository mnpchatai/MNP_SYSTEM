-- ต้นทุนการผลิต เฟส 3 (20270111010000_cost_dept_items.sql)
--   หมวดของของซื้อ (อ่าน: ผู้เห็นต้นทุน + แผนก ST · แก้: แผนก ST + admin) · จำนวนคน people ของเป้าต่อชั่วโมง (saveGrConfig ของ GR / PT / BG / PK)
--   สูตร PHR เปลี่ยนเป็นแบบน้ำหนักใน revision ใหม่ได้ (ฐานข้อมูลไม่ห้ามอยู่แล้ว ไฟล์ migration ไม่แตะ ตรวจไว้กันถอยหลัง)
--   ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกบทบาท / แผนก · ข้อมูลทดสอบสมมติทั้งหมด
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.rf_part_categories'::regclass), 'the category table has RLS enabled');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
                      where has_table_privilege(r.role, 'public.rf_part_categories', p.priv)),
  'anon and authenticated have no direct privilege on the category table');
select is((select count(*)::integer from pg_policy p where p.polrelid = 'public.rf_part_categories'::regclass and p.polname = 'rf_part_categories_no_direct_access'), 1,
  'the category table has the deny-all policy');
select is((select count(*)::integer from pg_policy p where p.polrelid = 'public.rf_part_categories'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive), 1,
  'and the restrictive lab-only policy');
select is((select count(*)::integer from pg_trigger g where not g.tgisinternal and g.tgrelid = 'public.rf_part_categories'::regclass
            and g.tgname = 'rf_part_categories_sandbox_scope'), 1,
  'the category table separates test data from real data by trigger');
select is(cardinality(private.sandbox_unguarded_tables()), 110, 'sandbox_unguarded_tables has 110 names (109 earlier + rf_part_categories)');
select ok(array['rf_part_categories', 'rf_labour_rates', 'rf_station_standards', 'rf_material_prices', 'rf_chem_docs', 'itrp_request_devices', 'bom_gr_config']
          <@ private.sandbox_unguarded_tables(),
  'the new table is sandbox aware and the patched list keeps the tables of the earlier phases');
select ok(position('rf_part_categories' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_labour_rates' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_station_standards' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_material_prices' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_chem_docs' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0,
  'the RubberFlow purge deletes the test categories and still deletes the earlier tables');
select ok(not exists (
    select 1 from unnest(array['private.rf_part_category_out(public.employees)', 'private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)',
                               'private.sandbox_unguarded_tables()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'clients cannot call the private helpers');
select is((select count(*)::integer from pg_proc p
           where p.oid in ('private.rf_part_category_out(public.employees)'::regprocedure, 'public.app_rf_part_categories()'::regprocedure,
                           'public.app_rf_part_category_save(text,text)'::regprocedure, 'public.app_sandbox_purge_rf()'::regprocedure,
                           'private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure)
             and p.prosecdef and p.proconfig @> array['search_path=""']), 5,
  'the helper, the RPCs and the patched functions are security definer with an empty search_path');
select ok(not exists (
    select 1 from unnest(array['public.app_rf_part_categories()', 'public.app_rf_part_category_save(text,text)', 'public.app_sandbox_purge_rf()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the public RPCs are for authenticated only');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('v_people' in pg_get_functiondef('private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('bom_gr_is_head' in pg_get_functiondef('private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('BOM_STALE' in pg_get_functiondef('private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0,
  'bom_gr_save_config was patched in place: people is read and the head check and the version check are kept');

-- 2. บัญชีทดสอบและตัวช่วย ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8f300000-0000-0000-0000-000000000001', 'catitems-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f300000-0000-0000-0000-000000000101', 'CATITEMS-ADMIN', 'Catitems', 'Admin', 'catitems-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f300000-0000-0000-0000-000000000001');
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.no, 'ทดสอบ', v.last_name, lower(v.no) || '@sandbox.local', v.last_name || ' (ทดสอบ)', d.id, r.id, false, true
from (values ('SBX-ADMIN-K', 'ผู้ดูแลระบบ', 'MGT', 'admin'),
             ('SBX-PP-AFM-K', 'ผู้ช่วย ผจก.โรงงาน PP', 'PP', 'assistant_factory_manager'),
             ('SBX-FT-AFM-K', 'ผู้ช่วย ผจก.โรงงาน', 'FT', 'assistant_factory_manager')) v(no, last_name, dept, role)
join public.departments d on d.code = v.dept
join public.roles r on r.code = v.role;
select is((select count(*)::integer from public.employees where employee_no in ('SBX-ADMIN-K', 'SBX-PP-AFM-K', 'SBX-FT-AFM-K')), 3,
  'the three extra test personas exist');
select is((select count(*)::integer from public.employees where is_test and employee_no in
            ('SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-RB-MGR', 'SBX-ST-STAFF', 'SBX-QA-STAFF', 'SBX-WH-STAFF', 'SBX-FT-FM', 'SBX-MGT-GM', 'SBX-GR-AMGR', 'SBX-GR-STAFF')), 10,
  'the seeded personas this test needs exist');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select set_config('test.cfg_pt', private.bom_dept_default_config('PT')::text, true);
select set_config('test.cfg_gr', private.bom_dept_default_config('GR')::text, true);
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็น ตั้งหมวดไม่ได้ และการล้างข้อมูลทดสอบต้องไม่ลบ
insert into public.bom_items (code, kind, name, owner_dept, uom) values ('DEMO-REAL-1', 'PURCHASED', 'ของซื้อสมมติ (จริง)', 'ST', 'pcs');
insert into public.rf_part_categories (item_code, category) values ('DEMO-REAL-1', 'หมวดสมมติ');
select is((select count(*)::integer from public.rf_part_categories where not is_test), 1, 'a row written outside test mode is a real row');

create schema cat_t;
grant usage on schema cat_t to authenticated;
create function cat_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function cat_t.bom(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, cat_t.bver(), p_action)
$$;
-- ตั้งค่าของแผนก (ค่าเริ่มต้นของแผนก) พร้อมเป้า p_targets ผ่านทางบันทึกจริงของหน้า "ตั้งค่าขั้นตอนและเป้า"
create function cat_t.config(p_dept text, p_targets jsonb) returns jsonb language sql volatile as $$
  select cat_t.bom(jsonb_build_object('grConfig', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('dept', p_dept, 'steps', d -> 'steps', 'reasons', d -> 'reasons', 'targets', p_targets)))), 'saveGrConfig')
  from (select current_setting('test.cfg_' || lower(p_dept))::jsonb as d) x
$$;
create function cat_t.targets(p_dept text) returns jsonb language sql stable as $$
  select c -> 'targets' from jsonb_array_elements(public.app_bom_master() -> 'grConfig') c where c ->> 'dept' = p_dept
$$;
create function cat_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function cat_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, cat_t.rver(), p_action)
$$;
create function cat_t.recipe(p_row jsonb, p_action text default 'createRecipe') returns jsonb language sql volatile as $$
  select cat_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
create function cat_t.rec(p_id text, p_rev integer default 1) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = p_id and (r ->> 'revision')::integer = p_rev
$$;
grant execute on all functions in schema cat_t to authenticated;

select set_config('test.item', '{"code":"X","kind":"PURCHASED","name":"x","ownerDept":"ST","uom":"pcs","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY"}', true);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.prec', '{"id":"DEMO-R1","revision":1,"productCode":"DEMO-P1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":130,"mixMin":2}],"dumpTol":5,"restHours":4,"yieldPerKg":5,"status":"draft","items":[{"materialCode":"DEMO-M1","phr":100,"stage":1},{"materialCode":"DEMO-M2","phr":10,"stage":2}]}', true);

-- 3. ข้อมูลตั้งต้นของโหมดทดสอบ: ของซื้อสามรายการ ชิ้น PT สองรายการ ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select cat_t.bom(jsonb_build_object('items', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.item')::jsonb || '{"code":"DEMO-BOX-1","name":"กล่องสมมติ"}'::jsonb,
    current_setting('test.item')::jsonb || '{"code":"DEMO-BAG-1","name":"ถุงสมมติ"}'::jsonb,
    current_setting('test.item')::jsonb || '{"code":"DEMO-CAP-1","name":"ฝาสมมติ"}'::jsonb,
    current_setting('test.item')::jsonb || '{"code":"DEMO-PT-1","kind":"PT","name":"ชิ้นพลาสติกสมมติ 1","ownerDept":"PT"}'::jsonb,
    current_setting('test.item')::jsonb || '{"code":"DEMO-PT-2","kind":"PT","name":"ชิ้นพลาสติกสมมติ 2","ownerDept":"PT"}'::jsonb))), 'saveItem') $$,
  'the planner adds three purchased items and two PT items');

-- 4. หมวดของของซื้อ: ใครอ่าน / ใครแก้ ---------------------------------------------------------------------------
-- 4.1 ไม่เห็นเลย: RB (พนักงานและผู้จัดการแผนก) ผู้ช่วยผู้จัดการแผนก GR QA WH ผู้ช่วย ผจก.โรงงานที่ไม่อยู่ PP
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'RB staff cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'the RB department manager (an ordinary department head) cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'the GR assistant department manager cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'QA cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'WH cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm_k')::uuid);
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_FORBIDDEN', 'the assistant factory manager outside PP cannot read the part categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'nor set one');

-- 4.2 ผู้เห็นต้นทุน: อ่านได้ แก้ไม่ได้ (แผนก PP ทุกบทบาท ผจก.ทั่วไป ผจก.โรงงาน)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_part_categories(), '{"canWrite": false, "categories": []}'::jsonb,
  'PP staff read the (empty) category list without the right to write; the real row is not listed');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'PP staff cannot set a category');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_afm_k')::uuid);
select is(public.app_rf_part_categories() -> 'canWrite', 'false'::jsonb, 'an assistant factory manager in PP reads the categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'but cannot set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select is(public.app_rf_part_categories() -> 'canWrite', 'false'::jsonb, 'the general manager reads the categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'but cannot set one');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is(public.app_rf_part_categories() -> 'canWrite', 'false'::jsonb, 'the factory manager reads the categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'RF_FORBIDDEN', 'but cannot set one');

-- 4.3 แผนก ST: อ่านและแก้ · ตรวจข้อมูล · แถวล่าสุดชนะ · กดซ้ำไม่เพิ่มแถว
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(public.app_rf_part_categories(), '{"canWrite": true, "categories": []}'::jsonb, 'ST staff read the (empty) category list with the right to write');
select is(public.app_rf_part_category_save('DEMO-BOX-1', 'บรรจุภัณฑ์'),
  '{"canWrite": true, "categories": [{"itemCode": "DEMO-BOX-1", "category": "บรรจุภัณฑ์"}]}'::jsonb,
  'ST staff set the category of a purchased item and get the list back');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-PT-1', 'พลาสติก') $$, 'RF_INVALID_CATEGORY', 'an item that is not purchased gets no part category');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-NONE', 'กล่อง') $$, 'RF_INVALID_CATEGORY', 'the item must exist');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-REAL-1', 'กล่อง') $$, 'RF_INVALID_CATEGORY', 'an item that exists only in real data is not a test item');
select throws_ok($$ select public.app_rf_part_category_save('', 'กล่อง') $$, 'RF_INVALID_CATEGORY', 'the item code is required');
select throws_ok($$ select public.app_rf_part_category_save(null, 'กล่อง') $$, 'RF_INVALID_CATEGORY', 'a missing item code is refused');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BAG-1', repeat('ก', 41)) $$, 'RF_INVALID_CATEGORY', 'a category over 40 characters is refused');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BAG-1', 'ถุง' || chr(9) || 'ผ้า') $$, 'RF_INVALID_CATEGORY', 'a tab inside the category is refused');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BAG-1', 'ถุง' || chr(10) || 'ผ้า') $$, 'RF_INVALID_CATEGORY', 'a line break inside the category is refused');
select lives_ok($$ select public.app_rf_part_category_save('DEMO-BAG-1', repeat('ก', 40)) $$, 'a category of exactly 40 characters is accepted');
select is(public.app_rf_part_category_save('DEMO-BAG-1', '  ผ้า  ') -> 'categories',
  '[{"itemCode": "DEMO-BAG-1", "category": "ผ้า"}, {"itemCode": "DEMO-BOX-1", "category": "บรรจุภัณฑ์"}]'::jsonb,
  'the category is trimmed, the latest row of a code wins, and the list is sorted by code');
select is(public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') -> 'categories' -> 1, '{"itemCode": "DEMO-BOX-1", "category": "กล่อง"}'::jsonb,
  'a new category for the same code replaces the old one in the list');
select lives_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'pressing save twice with the same category adds nothing');

-- 4.4 admin: อ่านและแก้ · ล้างหมวดด้วยค่าว่าง
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_k')::uuid);
select is(public.app_rf_part_categories() -> 'canWrite', 'true'::jsonb, 'the admin may set categories');
select is(public.app_rf_part_category_save('DEMO-BOX-1', '') -> 'categories', '[{"itemCode": "DEMO-BAG-1", "category": "ผ้า"}]'::jsonb,
  'an empty category clears the category of the code');
select lives_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', null) $$, 'clearing again (null = empty) adds nothing');
select lives_ok($$ select public.app_rf_part_category_save('DEMO-CAP-1', '   ') $$, 'clearing a code that never had a category adds nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_part_categories(), '{"canWrite": false, "categories": [{"itemCode": "DEMO-BAG-1", "category": "ผ้า"}]}'::jsonb,
  'a cost viewer reads the current categories');
reset role;
select is((select count(*)::integer from public.rf_part_categories where is_test), 5,
  'five test rows were written (the repeated save and the empty clears added none)');
select is((select count(*)::integer from public.rf_part_categories where is_test and created_by is null), 0, 'every test row records who entered it');
select is((select category from public.rf_part_categories where not is_test), 'หมวดสมมติ', 'the real row is untouched');
set local role authenticated;

-- 5. จำนวนคนของเป้าต่อชั่วโมง (saveGrConfig) --------------------------------------------------------------
select lives_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12},{"itemCode":"DEMO-PT-2","stepCode":"PT-01","perHour":7.5,"people":50}]'::jsonb) $$,
  'the planner saves PT targets, one without a head count and one with 50 people');
select is(cat_t.targets('PT'),
  '[{"itemCode": "DEMO-PT-1", "stepCode": "PT-01", "perHour": 12, "people": 1}, {"itemCode": "DEMO-PT-2", "stepCode": "PT-01", "perHour": 7.5, "people": 50}]'::jsonb,
  'a target without people is stored with one person and 50 is kept');
select lives_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":1},{"itemCode":"DEMO-PT-2","stepCode":"PT-01","perHour":8,"people":null}]'::jsonb) $$,
  'one person and a null head count are accepted');
select is(cat_t.targets('PT') -> 1 -> 'people', '1'::jsonb, 'a null head count is stored as one person');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":0}]'::jsonb) $$, 'BOM_INVALID_GR', 'zero people is refused');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":51}]'::jsonb) $$, 'BOM_INVALID_GR', 'more than 50 people is refused');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":1.5}]'::jsonb) $$, 'BOM_INVALID_GR', 'a fraction of a person is refused');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":"2"}]'::jsonb) $$, 'BOM_INVALID_GR', 'a head count sent as text is refused');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","perHour":12,"people":-1}]'::jsonb) $$, 'BOM_INVALID_GR', 'a negative head count is refused');
select is(cat_t.targets('PT') -> 1, '{"itemCode": "DEMO-PT-2", "stepCode": "PT-01", "perHour": 8, "people": 1}'::jsonb, 'a refused save leaves the stored targets as they were');
select throws_ok($$ select cat_t.config('PT', '[{"itemCode":"DEMO-PT-1","stepCode":"PT-01","people":2}]'::jsonb) $$, 'BOM_INVALID_GR', 'the pieces per hour are still required');
-- หัวหน้าแผนก GR ตั้งเป้าของ GR พร้อมจำนวนคน · พนักงาน GR ตั้งไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select cat_t.config('GR', '[{"itemCode":"DEMO-PT-1","stepCode":"GR-01","perHour":20,"people":3}]'::jsonb) $$, 'BOM_FORBIDDEN', 'GR staff cannot set GR targets');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select lives_ok($$ select cat_t.config('GR', '[{"itemCode":"DEMO-PT-1","stepCode":"GR-01","perHour":20,"people":3}]'::jsonb) $$, 'the GR head sets a GR target with three people');
select is(cat_t.targets('GR'), '[{"itemCode": "DEMO-PT-1", "stepCode": "GR-01", "perHour": 20, "people": 3}]'::jsonb, 'and it is stored with its head count');

-- 6. สูตร PHR -> แบบน้ำหนักใน revision ใหม่ (ฐานข้อมูลยอมรับ · หนึ่ง revision ยังเป็นแบบเดียว) ---------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cat_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"DEMO-M1","name":"ยางสมมติ"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"DEMO-M2","name":"เคมีสมมติ"}'::jsonb))), 'saveMaterial') is not null,
  'the planner adds two materials');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select cat_t.recipe(current_setting('test.prec')::jsonb) $$, 'RB drafts a PHR recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select lives_ok($$ select cat_t.recipe(cat_t.rec('DEMO-R1') || '{"status":"approved"}'::jsonb, 'approveRecipe') $$, 'the RB head approves it');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select cat_t.recipe(cat_t.rec('DEMO-R1') || '{"revision":2,"status":"draft","items":[{"materialCode":"DEMO-M1","stage":0,"kg":10,"unit":"kg"},{"materialCode":"DEMO-M2","phr":10,"stage":2}]}'::jsonb) $$,
  'RF_INVALID_RECIPE', 'a new revision still cannot mix weight lines with PHR lines');
select lives_ok($$ select cat_t.recipe(cat_t.rec('DEMO-R1') || '{"revision":2,"status":"draft","items":[{"materialCode":"DEMO-M1","stage":0,"kg":10,"unit":"kg"},{"materialCode":"DEMO-M2","stage":1,"kg":0.5,"unit":"g"}]}'::jsonb) $$,
  'a new draft revision of a PHR recipe may be entered by weight');
select is(jsonb_build_array((cat_t.rec('DEMO-R1', 2) ->> 'batchKg')::numeric, cat_t.rec('DEMO-R1', 2) -> 'items' -> 0 -> 'kg', cat_t.rec('DEMO-R1', 1) -> 'items' -> 0 -> 'kg'),
  '[10.5, 10, null]'::jsonb, 'revision 2 is a weight recipe (batch = sum of the weights) and revision 1 stays PHR');

-- 7. นอกโหมดทดสอบ / ไม่มี session ---------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_k')::uuid);
select lives_ok('select public.app_sandbox_exit()', 'the admin leaves test mode');
select throws_ok($$ select public.app_rf_part_categories() $$, 'RF_TEST_MODE_ONLY', 'outside test mode the part categories are closed');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-REAL-1', 'กล่อง') $$, 'RF_TEST_MODE_ONLY', 'and so is setting one');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_part_categories() $$, 'AUTH_REQUIRED', 'no session, no categories');
select throws_ok($$ select public.app_rf_part_category_save('DEMO-BOX-1', 'กล่อง') $$, 'AUTH_REQUIRED', 'no session, no category entry');

-- 8. ตารางปิดจากการเข้าถึงตรง และการล้างข้อมูลทดสอบ ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8f300000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.rf_part_categories $$, '42501', null, 'authenticated cannot read the category table directly');
select throws_ok($$ insert into public.rf_part_categories (item_code, category) values ('DEMO-BOX-1', 'x') $$, '42501', null, 'nor insert a category');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok('select public.app_sandbox_purge_rf()', 'the admin in test mode purges the RubberFlow test data');
reset role;
select is((select count(*)::integer from public.rf_part_categories where is_test), 0, 'the purge removed the test categories');
select is((select count(*)::integer from public.rf_part_categories where not is_test), 1, 'and kept the real row');

select * from finish();
rollback;
