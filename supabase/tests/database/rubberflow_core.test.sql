-- RubberFlow รอบที่ 1 (20261107010000_rubberflow_core.sql): วัตถุดิบ สูตร PHR ใบสั่งผลิต WO audit ล้างข้อมูลทดสอบ และการเชื่อมกับงาน RB ของ BOM
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง/สิทธิ์ตาราง, นอกโหมดทดสอบ, สมาชิก RB / หัว RB / กลุ่มวางแผน / ST / QA / ผู้ช่วยผู้จัดการแผนกอื่น,
-- revision ของสูตร (แก้ approved ไม่ได้, ร่างใหม่ revision + 1, อนุมัติแล้วตัวเดิม superseded), สถานะ WO, ชนรายระเบียนก่อนสิทธิ์,
-- ผูกงาน BOM + ป้อนผลผลิตกลับในธุรกรรมเดียว (ตัวนับ BOM เดิน), คอมปาวด์ BOM ผูกกับสูตร, delta/audit/epoch/purge
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงนับตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
create temp table rf_tables(name text) on commit drop;
insert into rf_tables values ('rf_master_state'), ('rf_materials'), ('rf_recipes'), ('rf_orders'), ('rf_deleted_keys');

select is((select count(*) from rf_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  5::bigint, 'every RubberFlow table has RLS enabled');
select ok(not exists (
    select 1 from rf_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on any RubberFlow table');
select ok(not exists (
    select 1 from rf_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass and p.polname = t.name || '_no_direct_access')),
  'every RubberFlow table has the deny-all policy');
select ok(not exists (
    select 1 from rf_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'every RubberFlow table has the restrictive lab_only_no_access policy');
select ok(not exists (
    select 1 from rf_tables t
    where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)),
  'every RubberFlow table separates test data from real data by trigger');
select ok(not exists (
    select 1 from rf_tables t
    where t.name <> 'rf_master_state'
      and not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_stamp_version' and not g.tgisinternal)),
  'the data tables stamp changed_version by trigger');
select ok(not exists (select 1 from rf_tables t where not (t.name = any (private.sandbox_unguarded_tables()))),
  'the RubberFlow tables are registered as sandbox aware');
select ok('bom_jobs' = any (private.sandbox_unguarded_tables()) and 'qc_inspection_reports' = any (private.sandbox_unguarded_tables())
          and 'ncr_reports' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the BOM, QC and NCR tables');
select is((select count(*) from pg_indexes where schemaname = 'public'
           and indexname in ('rf_materials_changed_idx', 'rf_recipes_changed_idx', 'rf_orders_changed_idx', 'rf_deleted_keys_changed_idx')),
  4::bigint, 'the data tables are indexed by (is_test, changed_version)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_recipes_one_approved_idx' and indexdef like '%WHERE%approved%')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_recipes_one_draft_idx' and indexdef like '%WHERE%draft%'),
  'a recipe code has at most one approved and one draft revision (partial unique indexes)');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_orders_source_job_idx' and indexdef like '%source_job_no%'),
  'a BOM job has at most one live work order (partial unique index)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.rf_orders'::regclass and c.contype = 'f'
           and pg_get_constraintdef(c.oid) like '%, is_test) REFERENCES %rf_recipes%'),
  1::bigint, 'a work order references its recipe revision with a foreign key paired with is_test');
select ok(not exists (select 1 from pg_constraint c where c.conrelid = 'public.rf_orders'::regclass and c.contype = 'f'
                      and pg_get_constraintdef(c.oid) like '%bom_%'),
  'a work order has no foreign key into BOM (the BOM purge can always delete jobs)');
select ok(not exists (select 1 from unnest(array['public.app_rf_master()', 'public.app_rf_master_since(bigint)', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)',
                                                  'public.app_rf_audit(integer)', 'public.app_sandbox_purge_rf()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'only signed-in users can execute the RubberFlow RPCs');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.app_rf_master()'::regprocedure, 'public.app_rf_master_since(bigint)'::regprocedure,
                           'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_rf_audit(integer)'::regprocedure,
                           'public.app_sandbox_purge_rf()'::regprocedure)),
  'the RPCs are security definer with an empty search_path');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'rf\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private RubberFlow helper');
select ok(not (has_function_privilege('anon', 'private.bom_save_compounds(uuid,jsonb,bigint,bigint)', 'execute')
               or has_function_privilege('authenticated', 'private.bom_save_compounds(uuid,jsonb,bigint,bigint)', 'execute')),
  'the redefined compound writer is still closed to clients');
select ok(position('rf_recipes' in pg_get_functiondef('private.bom_save_compounds(uuid,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('BOM_STALE' in pg_get_functiondef('private.bom_save_compounds(uuid,jsonb,bigint,bigint)'::regprocedure)) > 0,
  'the compound writer keeps its stale check and now checks the recipe link');
select ok(exists (select 1 from public.rf_master_state where is_test and version = 0), 'the test counter row starts at version 0');
select ok((select epoch from public.rf_master_state where is_test) is not null, 'the counter row carries a required epoch');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8f000000-0000-0000-0000-000000000001', 'rf-admin@test.local', '{}'),
  ('8f000000-0000-0000-0000-000000000002', 'rf-staff@test.local', '{}'),
  ('8f000000-0000-0000-0000-000000000003', 'mnplab001-rf@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f000000-0000-0000-0000-000000000101', 'RF-ADMIN', 'Rf', 'Admin', 'rf-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f000000-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-000000000102', 'RF-STAFF-REAL', 'Rf', 'Staff', 'rf-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8f000000-0000-0000-0000-000000000002'),
  ('8f000000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-rf@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8f000000-0000-0000-0000-000000000003');
-- persona ทดสอบเพิ่ม: ผู้ช่วยผู้จัดการแผนก RB (หัว RB ที่ไม่อยู่กลุ่มวางแผน) ไม่มีใน migration จึงใส่เองในเทสต์
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('8f000000-0000-0000-0000-000000000104', 'SBX-RB-AMGR-T', 'ทดสอบ', 'ผู้ช่วย ผจก. RB', 'sbx-rb-amgr-t@sandbox.local', 'ผู้ช่วย ผจก. RB (ทดสอบ)',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'assistant_department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;

-- ตัวตัดสินสิทธิ์ล้วน ๆ: สมาชิก RB และหัว RB
select ok((select private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-RB-STAFF'), 'RB staff is an RB member');
select ok((select private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-RB-MGR'), 'the RB manager is an RB member');
select ok((select private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-RB-AMGR-T'), 'the RB assistant manager is an RB member');
select ok(not (select private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'PP staff is not an RB member');
select ok(not (select private.rf_is_rb(e) from public.employees e where e.employee_no = 'SBX-ST-STAFF'), 'ST staff is not an RB member');
select ok(not (select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-RB-STAFF'), 'RB staff is not an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-RB-MGR'), 'the RB manager is an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-RB-AMGR-T'), 'the RB assistant manager is an RB head');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-RB-AMGR-T'), 'the RB assistant manager is an RB head but not in the planner group');
select ok(not (select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'PP staff is not an RB head');
select ok(not (select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-GR-AMGR'), 'an assistant manager of another department is not an RB head');
select ok(not (select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-QA-MGR'), 'a department manager of another department is not an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-FT-AFM'), 'the assistant factory manager is an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-FT-FM'), 'the factory manager is an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'SBX-MGT-GM'), 'the general manager is an RB head');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'RF-ADMIN'), 'an admin is an RB head');
select ok((select private.rf_is_qa(e) from public.employees e where e.employee_no = 'SBX-QA-STAFF'), 'QA staff is a QA member');
select ok((select private.rf_is_qa(e) from public.employees e where e.employee_no = 'SBX-QA-MGR'), 'the QA manager is a QA member');
select ok(not (select private.rf_is_qa(e) from public.employees e where e.employee_no = 'SBX-RB-STAFF'), 'RB staff is not a QA member');
select ok(not (select private.rf_is_qa(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'PP staff is not a QA member');

-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ เพื่อตรวจว่าโหมดทดสอบมองไม่เห็น และ purge ไม่แตะ
insert into public.rf_master_state (is_test, version) values (false, 99);
insert into public.rf_materials (code, name) values ('REAL-MAT', 'วัตถุดิบจริง');
insert into public.rf_recipes (recipe_code, revision, product_code, uom, batch_kg, stages, yield_per_kg, items, status)
values ('REAL-RC', 1, 'RP', 'm', 10,
  '[{"stage":1,"mixerTemp":80,"dumpTemp":100,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":110,"mixMin":2}]'::jsonb, 1,
  '[{"materialCode":"REAL-MAT","phr":1,"stage":1}]'::jsonb, 'approved');
insert into public.rf_orders (wo_no, customer, recipe_code, recipe_revision, product_code, uom, target_qty, start_date, due_date)
values ('REAL-WO', 'ลูกค้าจริง', 'REAL-RC', 1, 'RP', 'm', 5, 1762300000000, 1762400000000);
select is((select count(*) from public.rf_orders where not is_test), 1::bigint, 'the real work order was inserted as a real (non-test) row');

-- แม่แบบเรคอร์ดที่ใช้ซ้ำ (ทับด้วย || ที่ id / ช่องที่ต้องการ)
select set_config('test.mat', '{"code":"X","name":"x","category":"โพลิเมอร์","storage":"โกดัง A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"X","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":10,"stage":2}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"WO-X","customer":"ACME","customerPo":"PO-1","recipeId":"RC-1","recipeRevision":2,"color":"ดำ","targetQty":100,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
-- แม่แบบของ BOM (เหมือน bom_orders_jobs.test.sql)
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","level":1,"fgQty":10,"required":20},{"itemCode":"RB-A","level":2,"fgQty":10,"required":40}]', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_rf_master()', 'AUTH_REQUIRED', 'reading requires a session');
select throws_ok('select public.app_rf_master_since(0)', 'AUTH_REQUIRED', 'the delta requires a session');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'AUTH_REQUIRED', 'saving requires a session');
select throws_ok('select public.app_rf_audit()', 'AUTH_REQUIRED', 'reading the audit requires a session');
select throws_ok('select public.app_sandbox_purge_rf()', 'AUTH_REQUIRED', 'the purge requires a session');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_rf_master()', 'RF_TEST_MODE_ONLY', 'a real PP staff account cannot read (real mode is not open)');
select throws_ok('select public.app_rf_master_since(0)', 'RF_TEST_MODE_ONLY', 'a real PP staff account cannot read the delta');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_TEST_MODE_ONLY', 'a real PP staff account cannot save');
select throws_ok('select public.app_rf_audit()', 'RF_TEST_MODE_ONLY', 'a real PP staff account cannot read the audit');
select throws_ok('select public.app_sandbox_purge_rf()', 'NOT_AUTHORIZED', 'a non-admin cannot purge');
select throws_ok('select count(*) from public.rf_orders', '42501', null, 'clients cannot read the work order table directly');
select throws_ok('select count(*) from public.rf_recipes', '42501', null, 'clients cannot read the recipe table directly');
select throws_ok('select count(*) from public.rf_materials', '42501', null, 'clients cannot read the material table directly');
select throws_ok($$ insert into public.rf_materials (code, name) values ('X', 'x') $$, '42501', null, 'clients cannot write the material table directly');
select throws_ok($$ update public.rf_orders set status = 'completed' $$, '42501', null, 'clients cannot write the work order table directly');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.app_rf_master()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot use the module');
select throws_ok('select public.app_rf_master_since(0)', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot read the delta');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot save');
select throws_ok('select public.app_rf_audit()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot read the audit');
select throws_ok('select public.app_sandbox_purge_rf()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot purge');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_rf_master()', 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot read');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot save');
select throws_ok('select public.app_sandbox_purge_rf()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge');

-- 4. วัตถุดิบ ------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_master() - 'epoch', (select jsonb_build_object('version', 0) || jsonb_object_agg(l, '[]'::jsonb) from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'a planner reads an empty RubberFlow (twelve lists) and never sees the real rows (the epoch is a separate field)');
select is(public.app_rf_master_since(0) - 'epoch', (select jsonb_build_object('version', 0, 'changes', jsonb_object_agg(l, '{"upsert":[],"delete":[]}'::jsonb)) from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'the delta of an empty RubberFlow lists all twelve lists with empty upsert and delete');
select ok((public.app_rf_master() ->> 'epoch') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'the snapshot carries the epoch');
select is(public.app_rf_master_since(0) ->> 'epoch', public.app_rf_master() ->> 'epoch', 'the delta carries the same epoch');
select set_config('test.epoch0', public.app_rf_master() ->> 'epoch', true);

select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ","category":"สารตัวเติม"}'::jsonb))), 0, 'saveMaterial') ->> 'version', '1',
  'a planner adds materials');
select is(jsonb_array_length(public.app_rf_master() -> 'materials'), 2, 'both materials are in the snapshot');
select is((public.app_rf_master() -> 'materials' -> 0) - 'createdAt', '{"code":"MAT-A","name":"ยาง EPDM","category":"โพลิเมอร์","storage":"โกดัง A-1","uom":"kg","active":true,"safetyKg":0,"shelfLifeDays":180}'::jsonb,
  'a material is returned with its master fields (safety stock 0 and shelf life 180 days by default)');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_master() ->> 'version', '1', 'RB staff reads');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"น้ำมัน"}'::jsonb))), 1, 'saveMaterial', '[{"action":"เพิ่มวัตถุดิบ","detail":"MAT-C"}]'::jsonb, current_setting('test.epoch0'))
  ->> 'version', '2', 'an RB member adds a material and the reply carries the delta');

select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(public.app_rf_master() ->> 'version', '2', 'ST staff reads');
select is(public.app_rf_audit(1) -> 0 ->> 'action', 'saveMaterial', 'ST staff reads the history');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z","name":"ห้าม"}'::jsonb))), 2, 'saveMaterial') $$,
  'RF_FORBIDDEN', 'ST staff cannot add a material');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb))), 2, 'createOrder') $$, 'RF_FORBIDDEN', 'ST staff cannot create a work order');
select lives_ok($$ select public.app_rf_save('{}'::jsonb, 2, 'saveMaterial') $$, 'an empty change is a harmless no-op for anyone who can read');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z","name":"ห้าม"}'::jsonb))), 2, 'saveMaterial') $$,
  'RF_FORBIDDEN', 'QA staff cannot add a material');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z","name":"ห้าม"}'::jsonb))), 2, 'saveMaterial') $$,
  'RF_FORBIDDEN', 'an assistant manager of another department cannot add a material');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 2, 'reportJob') $$, 'RF_INVALID_ACTION', 'an unknown action is refused');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 2, null) $$, 'RF_INVALID_ACTION', 'a missing action is refused');
select throws_ok($$ select public.app_rf_save('{"materials":{"delete":[{"code":"MAT-A"}]}}'::jsonb, 2, 'saveMaterial') $$,
  'RF_INVALID_PAYLOAD', 'materials cannot be deleted');
select throws_ok($$ select public.app_rf_save('{"bogus":{"upsert":[]}}'::jsonb, 2, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'an unknown list is refused');
select throws_ok($$ select public.app_rf_save('{"materials":{"upsert":{}}}'::jsonb, 2, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'a list must be an array');
select throws_ok($$ select public.app_rf_save('[]'::jsonb, 2, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'the changes must be an object');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 3, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'a base version above the counter is refused');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, -1, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'a negative base version is refused');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, null, 'saveMaterial') $$, 'RF_INVALID_PAYLOAD', 'a missing base version is refused');
select throws_ok($$ select public.app_rf_master_since(3) $$, 'RF_INVALID_PAYLOAD', 'a delta from a version above the counter is refused');
select throws_ok($$ select public.app_rf_master_since(-1) $$, 'RF_INVALID_PAYLOAD', 'a negative delta version is refused');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 2, 'saveMaterial', '{"action":"x"}'::jsonb) $$, 'RF_INVALID_PAYLOAD', 'the audit argument must be an array');
select throws_ok($$ select public.app_rf_save('{"materials":{"upsert":[]}}'::jsonb, 2, 'saveMaterial', (select jsonb_agg(jsonb_build_object('action', 'x', 'detail', 'y')) from generate_series(1, 21))) $$,
  'RF_INVALID_PAYLOAD', 'more than 20 audit entries are refused');
select throws_ok($$ select public.app_rf_save('{"materials":{"upsert":[]}}'::jsonb, 2, 'saveMaterial', '[{"detail":"y"}]'::jsonb) $$, 'RF_INVALID_PAYLOAD', 'an audit entry needs an action');
select throws_ok($$ select public.app_rf_save('{"materials":{"upsert":[]}}'::jsonb, 2, 'saveMaterial', jsonb_build_array(jsonb_build_object('action', repeat('ก', 81), 'detail', ''))) $$,
  'RF_INVALID_PAYLOAD', 'an audit action longer than 80 characters is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"bad code!","name":"x"}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a code with spaces or symbols is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z","name":"  "}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a blank name is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z","active":"yes"}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'active must be a boolean');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-Z"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"mat-z"}'::jsonb))), 2, 'saveMaterial') $$,
  'RF_INVALID_MATERIAL', 'the same code twice in one call (ignoring case) is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"mat-a","name":"ซ้ำ"}'::jsonb))), 2, 'saveMaterial') $$, 'RF_CONFLICT', 'a code that differs from an existing one only by case is a conflict');
select is(public.app_rf_master() ->> 'version', '2', 'nothing was written by the refused calls');

-- เขียนซ้ำค่าเดิม = ไม่ทำอะไร (version ไม่ขยับ audit ไม่เพิ่ม) · แก้ชื่อ · เลิกใช้
select set_config('test.noop_audit', jsonb_array_length(public.app_rf_audit())::text, true);
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  (select m from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A')))), 2, 'saveMaterial') ->> 'version', '2',
  'saving a material exactly as stored writes nothing and keeps the version');
select is(jsonb_array_length(public.app_rf_audit())::text, current_setting('test.noop_audit'), 'a no-op save writes no audit entry');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  (select m from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A'),
  (select m from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-B')))), 0, 'saveMaterial') ->> 'version', '2',
  'a no-op save from an old base still returns the delta and keeps the version');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  (select m || '{"name":"ยาง EPDM 55"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A')))), 2, 'saveMaterial')
  -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'name', 'ยาง EPDM 55', 'an RB member edits a material');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  (select m || '{"active":false}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-C')))), 3, 'saveMaterial')
  -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'active', 'false', 'a material is retired with active = false, not deleted');
select is(jsonb_array_length(public.app_rf_master() -> 'materials'), 3, 'the retired material is still listed');

-- ชนรายระเบียน: planner ถือฐานเก่า (version 2) ขณะที่ MAT-A ถูกแก้เป็น version 3 แล้ว
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"แก้จากฐานเก่า"}'::jsonb))), 2, 'saveMaterial') $$,
  'RF_STALE', 'a material changed by someone else after the base version is stale');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-D","name":"ไม่ชนกัน"}'::jsonb))), 2, 'saveMaterial') ->> 'version', '5',
  'a different material saved from the same old base does not collide (version 4 was the retirement, this is 5)');

-- 5. สูตร PHR ----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.res', public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-1","createdBy":"ใครก็ได้","createdAt":1,"approvedBy":"ใครก็ได้","approvedAt":1}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'createRecipe')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'draft', 'an RB member creates a draft recipe');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'createdBy', current_setting('test.n_sbx_rb_staff'),
  'the creator is the persona, not what the client sent');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'createdAt', '1', 'the creation time is the server time');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ? 'approvedBy'), 'a draft carries no approver from the client');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 -> 'items', '[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":10,"stage":2}]'::jsonb,
  'the items are stored in the order sent, each with its mixing stage');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 -> 'stages',
  '[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}]'::jsonb,
  'the recipe stores both mixing stages (mixer temp, dump temp, minutes)');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ?| array['name', 'productName', 'dumpTemp', 'mixSec']),
  'a recipe has no name, product name, single dump temp or seconds field');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-2","productCode":"P-2"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe')
  -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'id', 'RC-2', 'a planner creates a draft recipe too');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_TRANSITION', 'a new recipe cannot start approved');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"NOPE","phr":1}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'an unknown material is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"MAT-C","phr":1}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a retired material cannot be added to a new recipe');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"MAT-A","phr":1},{"materialCode":"MAT-A","phr":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'the same material twice in a recipe is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"MAT-A","phr":0}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a zero phr is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a recipe needs at least one item');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","uom":"zz"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'an unknown unit is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC N"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a recipe code with a space is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","batchKg":0}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a zero batch weight is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (current_setting('test.rec')::jsonb - 'stages') || '{"id":"RC-N"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a recipe without stages is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a recipe with one stage only is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":1,"mixerTemp":90,"dumpTemp":140,"mixMin":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'two entries for stage 1 (and none for stage 2) are refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":0},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a zero mixing time is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":1001,"mixMin":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a dump temp above 1000 is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a stage without a mixing time is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"MAT-A","phr":1,"stage":3}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a material line in stage 3 is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","items":[{"materialCode":"MAT-A","phr":1,"stage":1.5}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a fractional stage on a material line is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-N","revision":2}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_REVISION_ORDER', 'a brand new recipe must start at revision 1');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"rc-1","revision":1}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe') $$,
  'RF_CONFLICT', 'a recipe code that differs from an existing one only by case is a conflict');

-- แก้ร่างในที่เดิม (RB staff แล้ว planner) · ยังเป็น revision 1
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"batchKg":70}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))),
  (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'batchKg', '70', 'an RB member edits a draft in place');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"batchKg":60}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))),
  (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'batchKg', '60', 'a planner edits a draft in place too');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1'), 1, 'editing a draft did not add a revision');

-- อนุมัติ: หัว RB เท่านั้น
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.r1', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_FORBIDDEN', 'RB staff cannot approve a recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_FORBIDDEN', 'the planner group cannot approve a recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_FORBIDDEN', 'an assistant manager of another department cannot approve a recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_t')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved","batchKg":99}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_INVALID_TRANSITION', 'a recipe cannot be edited and approved in the same call');
select set_config('test.res', public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved","approvedBy":"ใครก็ได้"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'approved', 'the RB assistant manager (an RB head, not in the planner group) approves');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'approvedBy', current_setting('test.n_sbx_rb_amgr_t'), 'the approver is the persona');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ? 'approvedAt', 'the approval time is set by the server');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-2')))),
  (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'approved', 'the RB manager approves too');

-- revision ที่อนุมัติแล้วแก้ไม่ได้ ต้องออกร่างใหม่
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.r1', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '1'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"batchKg":99}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'an approved revision cannot be edited');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":110,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":150,"mixMin":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'changing a stage value of an approved revision is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"items":[{"materialCode":"MAT-A","phr":100,"stage":2},{"materialCode":"MAT-B","phr":10,"stage":2}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'moving a material line to another stage of an approved revision is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"draft"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_INVALID_TRANSITION', 'an approved revision cannot go back to draft');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"superseded"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_INVALID_TRANSITION', 'a client cannot supersede an approved revision on its own');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-1","revision":5}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_REVISION_ORDER', 'a revision cannot skip ahead');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-1","revision":2,"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_INVALID_TRANSITION', 'a new revision cannot start approved');
select set_config('test.res', public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"revision":2,"batchKg":65,"status":"draft"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'revision', '2', 'editing an approved recipe opens a new draft revision (revision + 1)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'draft', 'the new revision is a draft');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'createdBy', current_setting('test.n_sbx_rb_staff'), 'the new revision records its creator');
select is((select r ->> 'status' from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '1'), 'approved',
  'the approved revision stays approved until the new one is approved');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-1","revision":3}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_INVALID_TRANSITION', 'only one open draft per recipe: edit the existing draft instead');

-- วัตถุดิบที่เลิกใช้แล้ว: ใส่ในร่างใหม่ได้เฉพาะที่มีอยู่ใน revision ก่อนหน้า
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.mb', (select m::text from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-B'), true);
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mb')::jsonb || '{"active":false}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial')
  -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'active', 'false', 'a material used by a recipe can be retired');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.r2', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '2'), true);
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r2')::jsonb || '{"productCode":"P-1B"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe')
  -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'productCode', 'P-1B', 'the draft keeps a retired material that the previous revision already used');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r2')::jsonb || '{"items":[{"materialCode":"MAT-A","phr":100},{"materialCode":"MAT-C","phr":5}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_INVALID_RECIPE', 'a retired material that the previous revision did not use cannot be added');

-- อนุมัติ revision 2 ของ RC-1 พร้อมสำเนา superseded ของ revision 1 ที่ client ส่งมาด้วย · RC-2 ออก revision 2 แล้วอนุมัติโดยไม่ส่งสำเนาเก่า
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select set_config('test.r1', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '1'), true);
select set_config('test.r2', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '2'), true);
select set_config('test.b1', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"superseded"}'::jsonb, current_setting('test.r2')::jsonb || '{"status":"approved"}'::jsonb))),
  current_setting('test.b1')::bigint, 'approveRecipe')::text, true);
select is((select jsonb_agg(r ->> 'status' order by (r ->> 'revision')::integer) from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert') r
           where r ->> 'id' = 'RC-1'), '["superseded","approved"]'::jsonb,
  'approving revision 2 supersedes revision 1 in the same call and the reply carries both');
select ok((select r ? 'supersededAt' from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '1'),
  'the superseded revision records the server time');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and r ->> 'status' = 'approved'), 1, 'exactly one revision of the recipe is approved');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"revision":2,"status":"draft"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-2')))),
  (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'revision', '2', 'RC-2 gets a draft revision 2');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select set_config('test.res', public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-2' and (r ->> 'revision') = '2')))),
  (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe')::text, true);
select is((select jsonb_agg(r ->> 'status' order by (r ->> 'revision')::integer) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-2'),
  '["superseded","approved"]'::jsonb, 'the server supersedes the previous approved revision even when the client does not send it');
select ok((select count(*) from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert') r where r ->> 'id' = 'RC-2') = 2,
  'the reply to that approval carries the superseded revision as well (the delta covers server-made changes)');

-- superseded เป็นสถานะสุดท้าย
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.r1', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1' and (r ->> 'revision') = '1'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"batchKg":10}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'a superseded revision cannot be edited');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r1')::jsonb || '{"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'even an RB head cannot bring a superseded revision back');

-- ชนก่อนสิทธิ์: RB staff ถือสำเนาร่างเก่าแล้วกดอนุมัติ (ไม่มีสิทธิ์) ต้องได้ RF_STALE ไม่ใช่ RF_FORBIDDEN
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (current_setting('test.rec')::jsonb - 'productCode') || '{"id":"RC-3","items":[{"materialCode":"MAT-A","phr":100},{"materialCode":"MAT-D","phr":5}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe');
select set_config('test.r3', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-3'), true);
select is(current_setting('test.r3')::jsonb ->> 'productCode', '', 'the product code is optional (empty when not given, no longer the recipe code)');
select is(current_setting('test.r3')::jsonb -> 'items', '[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-D","phr":5,"stage":1}]'::jsonb,
  'a material line without a stage is stored in stage 1');
select set_config('test.b3', public.app_rf_master() ->> 'version', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r3')::jsonb || '{"productCode":"PP-1"}'::jsonb))), current_setting('test.b3')::bigint, 'saveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r3')::jsonb || '{"status":"approved"}'::jsonb))), current_setting('test.b3')::bigint, 'approveRecipe') $$,
  'RF_STALE', 'a stale copy is stale before it is forbidden');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r3')::jsonb || '{"batchKg":99}'::jsonb))), current_setting('test.b3')::bigint, 'saveRecipe') $$,
  'RF_STALE', 'a stale edit of a draft is stale');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-3","revision":2,"items":[{"materialCode":"MAT-A","phr":100},{"materialCode":"MAT-D","phr":5}]}'::jsonb))), current_setting('test.b3')::bigint, 'saveRecipe') $$,
  'RF_INVALID_TRANSITION', 'a new revision on top of an open draft is refused');
select set_config('test.r3', (select r::text from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-3'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.r3')::jsonb || '{"status":"approved"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe') $$,
  'RF_FORBIDDEN', 'from the current base the same approval is a plain refusal');

-- 6. ใบสั่งผลิต WO (แบบไม่ผูก BOM) ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_FORBIDDEN', 'ST staff cannot create a work order');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_FORBIDDEN', 'QA staff cannot create a work order');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","recipeId":"RC-3","recipeRevision":1}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_RECIPE', 'a draft recipe cannot be used for a work order');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","recipeRevision":1}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_RECIPE', 'a superseded revision cannot be used for a work order');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","recipeId":"NOPE"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_RECIPE', 'an unknown recipe is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","status":"released"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_TRANSITION', 'a new work order must start as planned');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","producedQty":5}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'a new work order starts with nothing produced');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","targetQty":0}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'a zero target is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","dueDate":1762300000000}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'a due date before the start date is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01","priority":"asap"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'an unknown priority is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO 01"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'a work order number with a space is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01"}'::jsonb, current_setting('test.wo')::jsonb || '{"id":"WO-20261107-01"}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$, 'RF_INVALID_ORDER', 'the same work order twice in one call is refused');

select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (current_setting('test.wo')::jsonb - 'recipeRevision') || jsonb_build_object('id', 'WO-20261107-01', 'productCode', 'ZZ-9', 'productName', 'ชื่ออื่น', 'uom', 'kg', 'createdBy', 'ใครก็ได้', 'createdAt', 1)))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'planned', 'an RB member creates a planned work order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'recipeRevision', '2', 'without a revision the work order takes the approved one');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'productCode', 'P-1B', 'the product code is copied from the recipe, not from the client');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'productName'), 'a work order has no product name');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'uom', 'm', 'a manual work order takes the unit of the recipe');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'createdBy', current_setting('test.n_sbx_rb_staff'), 'the creator is the persona');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'createdAt', '1', 'the creation time is the server time');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'producedQty', '0', 'nothing is produced yet');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'sourceJobId'), 'a manual work order has no BOM job');

-- สถานะ: ปล่อยผลิต = กลุ่มวางแผนหรือหัว RB เท่านั้น
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"released"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_FORBIDDEN', 'RB staff cannot release a work order');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"completed"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a planned work order cannot be completed');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a planned work order cannot jump to in_progress');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"note":"แก้โน้ต"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_ORDER', 'the content of a work order cannot change after it is created');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"targetQty":999}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_ORDER', 'the target cannot change after the work order is created');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"producedQty":10}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') ->> 'version',
  public.app_rf_master() ->> 'version', 'a produced quantity sent by the client is ignored (the server counts it from finishing lots): nothing is written');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"released"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the planner releases the work order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'releasedBy', current_setting('test.n_sbx_pp_staff'), 'the releaser is the persona');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'releasedAt', 'the release time is set by the server');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"completed"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a released work order cannot be completed directly');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'an RB member starts the work order');
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a work order in progress cannot be cancelled');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"on_hold"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'on_hold', 'an RB member puts the work order on hold');
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"completed","producedQty":10}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a work order on hold cannot be completed');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'a work order on hold resumes');
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"completed","producedQty":60}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'an RB member completes the work order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'producedQty', '0', 'the produced quantity sent by the client is ignored (the server owns it)');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'completedAt', 'the completion time is set by the server');
select set_config('test.w1', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-01'), true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$,
  'RF_INVALID_TRANSITION', 'a completed work order is final');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w1')::jsonb || '{"producedQty":65}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') ->> 'version',
  public.app_rf_master() ->> 'version', 'a produced quantity sent for a completed work order is ignored too: nothing is written');

-- ปิด WO ที่ไม่ผูก BOM โดยไม่มียอดผลิตได้ · ยกเลิกใบ planned · ผู้ช่วย ผจก. RB (หัว RB ที่ไม่ใช่กลุ่มวางแผน) ปล่อยผลิตได้
select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-02"}'::jsonb, current_setting('test.wo')::jsonb || '{"id":"WO-20261107-03","priority":"urgent"}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder')::text, true);
select is((select count(*)::integer from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert') w), 2, 'two work orders are created in one call');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"cancelled"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-03')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'an RB member cancels a planned work order');
select ok((select w ? 'cancelledAt' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-03'), 'the cancellation time is set');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-03')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$, 'RF_FORBIDDEN', 'RB staff cannot release a cancelled work order either (permission first)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_t')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-03')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$, 'RF_INVALID_TRANSITION', 'a cancelled work order is final even for an RB head');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-02')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'releasedBy', current_setting('test.n_sbx_rb_amgr_t'),
  'the RB assistant manager releases a work order');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-02')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'and starts it');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-02')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'a work order that is not linked to a BOM job may be closed without a produced quantity');

-- ชนรายระเบียน: เลข WO ซ้ำ / ใบที่ถูกแก้หลังฐาน (ก่อนสิทธิ์)
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.b4', public.app_rf_master() ->> 'version', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-04","customer":"คนแรก"}'::jsonb, current_setting('test.wo')::jsonb || '{"id":"WO-20261107-05"}'::jsonb))),
  current_setting('test.b4')::bigint, 'createOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-04","customer":"คนที่สอง"}'::jsonb))), current_setting('test.b4')::bigint, 'createOrder') $$,
  'RF_STALE', 'a work order number that someone else just created is stale, not a silent overwrite');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-06","customer":"คนที่สอง"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'id', 'WO-20261107-06', 'after catching up the next number is accepted');
select set_config('test.w5', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-05'), true);
select set_config('test.b5', public.app_rf_master() ->> 'version', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w5')::jsonb || '{"status":"cancelled"}'::jsonb))), current_setting('test.b5')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w5')::jsonb || '{"status":"released"}'::jsonb))), current_setting('test.b5')::bigint, 'setOrderStatus') $$,
  'RF_STALE', 'a stale copy that asks for a release it may not make is stale before it is forbidden');
select set_config('test.noop_audit2', jsonb_array_length(public.app_rf_audit())::text, true);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-05')))), current_setting('test.b5')::bigint, 'setOrderStatus') ->> 'version',
  public.app_rf_master() ->> 'version', 'a copy equal to the latest row is not an error and writes nothing, even on an old base');
select is(jsonb_array_length(public.app_rf_audit())::text, current_setting('test.noop_audit2'), 'and it adds no audit entry');

-- 7. ข้อมูล BOM ตั้งต้นสำหรับเชื่อมงาน RB ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1', 'the planner seeds the BOM item master');
-- PI 4 ใบ: 25001 (ผูก WO แล้วป้อนผลกลับ) 25002 (รายงานบางส่วนก่อน) 25003 (ปิดใบก่อน WO) 25004 (ปิดใบก่อนผูก)
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251107-25001', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251107-25002', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251107-25003', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251107-25004', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', (select jsonb_agg(o || '{"status":"released"}'::jsonb) from jsonb_array_elements(public.app_bom_master() -> 'orders') o)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-L1-RB","orderId":"251107-25001","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L1-GR","orderId":"251107-25001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L1-PK","orderId":"251107-25001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L2-RB","orderId":"251107-25002","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L2-PK","orderId":"251107-25002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L3-RB","orderId":"251107-25003","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L3-PK","orderId":"251107-25003","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L4-RB","orderId":"251107-25004","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L4-PK","orderId":"251107-25004","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs')), 9, 'nine jobs were created by the release');
-- PI 25004: ปิดงาน PK แล้วปิดใบ (ผูก WO ภายหลังไม่ได้)
select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || jsonb_build_object('status', 'done', 'qtyDone', 100, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 100, 'reject', 0, 'note', '')))
   from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L4-PK')))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob');
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"status":"completed"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251107-25004')))),
  (public.app_bom_master() ->> 'version')::bigint, 'completeOrder');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251107-25004'), 'completed', 'PI 25004 is completed');

-- 8. ผูกงาน BOM กับ WO ---------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB-L1-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_FORBIDDEN', 'ST staff cannot create a work order from a BOM job');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB-NOPE"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_SOURCE_JOB', 'an unknown BOM job is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB-L1-GR"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_SOURCE_JOB', 'only a job of the RB department can be linked');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB-L4-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_SOURCE_JOB', 'a job of a completed PI cannot be linked');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB 1"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_ORDER', 'a malformed job number is refused');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j -> 'externalRef' <> 'null'::jsonb), 0, 'the refused calls linked nothing');

select set_config('test.bv0', public.app_bom_master() ->> 'version', true);
select set_config('test.rv0', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-11","sourceJobId":"JOB-L1-RB","targetQty":100,"targetKg":12.5,"kgPerUnit":0.125,"uom":"kg"}'::jsonb))),
  current_setting('test.rv0')::bigint, 'createOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'sourceJobId', 'JOB-L1-RB', 'the work order records its BOM job');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'uom', 'pcs', 'the work order takes the unit of the job, not the recipe or the client');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'targetKg', '12.5', 'the target kilograms are kept');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'kgPerUnit', '0.125', 'the kilograms per unit are kept');
select is((select j -> 'externalRef' ->> 'woId' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 'WO-20261107-11',
  'the BOM job now points to the work order (written by the server in the same call)');
select is((select j -> 'externalRef' ->> 'system' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 'rubberflow', 'the link names the system');
select is((select (j -> 'externalRef' ->> 'kg')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 12.5, 'the link carries the kilograms');
select is((select j -> 'externalRef' ->> 'by' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), current_setting('test.n_sbx_rb_staff'),
  'the link records the persona');
select ok((select j -> 'externalRef' ? 'linkedAt' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 'the link time is set');
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 'in_progress', 'a queued job starts when it is linked');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251107-25001'), 'in_progress', 'the PI moves from released to in_progress');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv0')::bigint + 1, 'the BOM counter went up by one for the whole link');
select is((public.app_rf_master() ->> 'version')::bigint, current_setting('test.rv0')::bigint + 1, 'and the RubberFlow counter by one');
select is((select jsonb_agg(j ->> 'id') from jsonb_array_elements(public.app_bom_master_since(current_setting('test.bv0')::bigint) -> 'changes' -> 'jobs' -> 'upsert') j), '["JOB-L1-RB"]'::jsonb,
  'a BOM client catches up on the linked job with the normal delta');
select is((select jsonb_agg(o ->> 'id') from jsonb_array_elements(public.app_bom_master_since(current_setting('test.bv0')::bigint) -> 'changes' -> 'orders' -> 'upsert') o), '["251107-25001"]'::jsonb,
  'and on the PI whose status moved');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-19","sourceJobId":"JOB-L1-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_SOURCE_JOB', 'a job that is already linked cannot be linked again');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-19'), 0, 'the refused link left no work order behind');

-- BOM ยังบันทึกงานที่ผูกแล้วได้ตามปกติ (client ส่ง externalRef กลับมาเหมือนเดิม) และประวัติ BOM มีแถวของการผูก
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || '{"status":"hold"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB')))),
  (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus') -> 'changes' -> 'jobs' -> 'upsert') j), 'hold',
  'a linked job can still be held through the BOM RPC (the unchanged link is not a change)');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:createOrder' and a ->> 'detail' = 'jobs +1, orders +1'
                  and a ->> 'user' = current_setting('test.n_sbx_rb_staff')),
  'the BOM history records that RubberFlow linked a job and moved a PI');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'createOrder' and a ->> 'detail' = 'orders +1'),
  'the RubberFlow history records the work order');

-- ผูก WO ครั้งที่สอง (ฝ่ายวางแผนผูกให้) และของใบ 25003 · WO ที่ผูกงานต้องมียอดผลิตก่อนปิด
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-12","sourceJobId":"JOB-L2-RB","targetKg":10}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-13","sourceJobId":"JOB-L3-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'sourceJobId', 'JOB-L3-RB', 'a planner links two jobs in one call (the reply lists the orders newest number first)');
select is((select j -> 'externalRef' ->> 'kg' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L3-RB'), '0', 'a link without target kilograms records 0');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j -> 'externalRef' <> 'null'::jsonb), 3, 'three jobs are linked');

-- 9. ป้อนผลผลิตกลับเมื่อ WO ปิด ----------------------------------------------------------------
-- WO-11: ปล่อยผลิต (ฝ่ายวางแผน) → เริ่ม (RB) → ปิดโดยไม่มียอดผลิตไม่ได้ → ปิดด้วย 40 ของแผน 100
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-11')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the linked work order is released');
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-12'),
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-13')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-11'),
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-12'),
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-13')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select set_config('test.bv1', public.app_bom_master() ->> 'version', true);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-11')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'a work order linked to a BOM job closes without a produced quantity (the feedback moved to the transfer receipt)');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 0::numeric,
  'closing a linked work order writes nothing to the BOM job');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB'), 0, 'and appends no report');
select is(public.app_bom_master() ->> 'version', current_setting('test.bv1'), 'and the BOM counter did not move');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:setOrderStatus'), 'the BOM history has no feedback row');
select is((select w ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-11'), '0',
  'the produced quantity stays with the server (nothing was counted)');

-- WO-12: งานถูกรายงาน 30 ผ่าน BOM ก่อน → ปิด WO แล้วยอดงานยังเป็น 30
select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || jsonb_build_object('status', 'in_progress', 'qtyDone', 30, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 30, 'reject', 0, 'note', 'กะเช้า')))
   from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L2-RB')))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob');
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed","producedQty":70}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-12')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L2-RB'), 30::numeric,
  'the job total is what was reported through BOM (closing the work order adds nothing)');
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L2-RB'), 'in_progress', 'and the job stays in progress');

-- WO-13: ใบ PI ปิดไปก่อน → WO ยังปิดได้ แต่ไม่เขียนอะไรเข้างาน
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || jsonb_build_object('status', 'done', 'qtyDone', 100, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 100, 'reject', 0, 'note', '')))
   from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L3-PK')))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob');
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"status":"completed"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251107-25003')))),
  (public.app_bom_master() ->> 'version')::bigint, 'completeOrder');
select set_config('test.bv2', public.app_bom_master() ->> 'version', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed","producedQty":50}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-13')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'a work order whose PI is already completed still closes');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L3-RB'), 0::numeric, 'but the job of the closed PI is left alone');
select is(public.app_bom_master() ->> 'version', current_setting('test.bv2'), 'and the BOM counter did not move');

-- ปล่อยผลิตแล้วไม่มีผลต่อ BOM · WO ที่ผูกงานยกเลิกไม่แตะงาน (ไม่มีงานเหลือให้ทดสอบ จึงตรวจด้วยใบที่ยกเลิกแทน)
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j -> 'externalRef' <> 'null'::jsonb), 3, 'the links stay after the work orders are closed');

-- 9b. ยกเลิก WO ที่ผูกงาน = ล้างการผูกของงาน ผูกใหม่ได้ · ป้อนกลับเมื่องานมียอดอยู่แล้วตอนผูก · QA เพิ่ม producedQty ผ่าน addQcRecord -------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251107-25005', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251107-25005'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-L5-RB","orderId":"251107-25005","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-L5-PK","orderId":"251107-25005","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-31","sourceJobId":"JOB-L5-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder');
select is((select j -> 'externalRef' ->> 'woId' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 'WO-20261107-31',
  'another RB job is linked to its first work order');
-- งานถูกรายงาน 30 ผ่าน BOM ทั้งที่ผูกอยู่
select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || jsonb_build_object('qtyDone', 30, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 30, 'reject', 0, 'note', 'กะเช้า')))
   from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB')))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 30::numeric, 'the linked job has 30 reported');

select set_config('test.bv5', public.app_bom_master() ->> 'version', true);
select set_config('test.res', public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"cancelled"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-31')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'an RB member cancels the linked work order');
select is((select j -> 'externalRef' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 'null'::jsonb,
  'cancelling a linked work order clears the link on the BOM job in the same call');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 30::numeric, 'the job keeps its reported quantity');
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 'in_progress', 'and its status');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 2, 'a system note was appended to the reports');
select is((select (j -> 'reports' -> 1) - 'at' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'),
  jsonb_build_object('by', current_setting('test.n_sbx_rb_staff'), 'good', 0, 'reject', 0, 'note', 'WO WO-20261107-31 ถูกยกเลิก'),
  'the note names the cancelled work order and is stamped by the server');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv5')::bigint + 1, 'the BOM counter went up by one for the unlink');
select is((select jsonb_agg(j ->> 'id') from jsonb_array_elements(public.app_bom_master_since(current_setting('test.bv5')::bigint) -> 'changes' -> 'jobs' -> 'upsert') j), '["JOB-L5-RB"]'::jsonb,
  'a BOM client catches up on the unlink with the normal delta');
select is((select j ->> 'externalRef' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L1-RB') is null, false, 'the other links are untouched');

-- ข้อมูลค้างที่ external_ref ยังชี้ไป WO: ชี้ WO ที่ยังไม่ยกเลิก = ผูกซ้ำไม่ได้ · ชี้ WO ที่ยกเลิกแล้ว = ผูกใหม่ได้
reset role;
update public.bom_jobs set external_ref = jsonb_build_object('system', 'rubberflow', 'woId', 'WO-20261107-11', 'kg', 0) where is_test and job_no = 'JOB-L5-RB';
set local role authenticated;
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-32","sourceJobId":"JOB-L5-RB"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$,
  'RF_INVALID_SOURCE_JOB', 'a job whose link points to a work order that is not cancelled cannot be linked again');
reset role;
update public.bom_jobs set external_ref = jsonb_build_object('system', 'rubberflow', 'woId', 'WO-20261107-31', 'kg', 0) where is_test and job_no = 'JOB-L5-RB';
set local role authenticated;
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-32","sourceJobId":"JOB-L5-RB","targetKg":8}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'sourceJobId', 'JOB-L5-RB', 'a job whose old link points to a cancelled work order links to a new one');
select is((select j -> 'externalRef' ->> 'woId' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 'WO-20261107-32', 'the job points to the new work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 30::numeric, 'with the reported quantity kept');

-- WO-32 ผูกตอนงานมียอด 30 แล้ว: ปิดด้วย 50 → ยอดงาน 80 (ยังไม่ถึงแผน 100) รายงานใหม่ good = 50
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-32')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-32')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed","producedQty":50}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-32')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 30::numeric,
  'closing the second work order does not change the job total either');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-L5-RB'), 2,
  'and appends no report (the two entries are the earlier shift report and the unlink note)');

-- QA เขียน WO ไม่ได้เลย (ยอดผลิตนับฝั่งเซิร์ฟเวอร์ตอน QA บันทึกผลตรวจ ดู rubberflow_shopfloor.test.sql)
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-33"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-33')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-33')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.w32', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-32'), true);
select set_config('test.w33', (select w::text from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-33'), true);
select set_config('test.bv6', public.app_bom_master() ->> 'version', true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w33')::jsonb || '{"producedQty":20,"note":"แก้"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$,
  'RF_FORBIDDEN', 'QA cannot change anything but the produced quantity');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w33')::jsonb || '{"producedQty":20,"status":"on_hold"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$,
  'RF_FORBIDDEN', 'QA cannot change the status');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-20261107-34"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$,
  'RF_FORBIDDEN', 'QA cannot create a work order');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-QA","name":"ห้าม"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$,
  'RF_FORBIDDEN', 'QA cannot add a material even through addQcRecord');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb || '{"id":"RC-QA"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$,
  'RF_FORBIDDEN', 'QA cannot add a recipe even through addQcRecord');
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.w33')::jsonb || '{"producedQty":20}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') ->> 'version',
  public.app_rf_master() ->> 'version', 'a produced quantity sent by QA is ignored: nothing is written');
select is((select w ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-20261107-33'), '0', 'the work order keeps its server-side produced quantity');
select is(public.app_bom_master() ->> 'version', current_setting('test.bv6'), 'and the BOM job is not fed');

-- 10. คอมปาวด์ BOM ผูกกับสูตร ---------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM01","name":"EPDM","recipeId":"NOPE-RC","recipeName":"x"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') $$, 'BOM_INVALID_COMPOUND', 'a compound cannot point to a recipe that does not exist');
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM01","name":"EPDM","recipeId":"RC-1","recipeName":"สูตร"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'recipeId', 'RC-1', 'a compound links to an existing recipe code');
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM02","name":"EPDM 2","recipeId":"RC-3","recipeName":"ร่าง"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'recipeId', 'RC-3',
  'the database accepts any status for the link (the dialog only offers approved recipes)');
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM03","name":"ไม่ผูก"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'recipeId', null, 'a compound without a recipe is fine');
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM01","name":"EPDM ชื่อใหม่","recipeId":"RC-1","recipeName":"สูตร"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'saveItem') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'name', 'EPDM ชื่อใหม่', 'a compound keeps its link when other fields change');
select throws_ok($$ select public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM01","name":"EPDM","recipeId":"rc-1","recipeName":"สูตร"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') $$, 'BOM_INVALID_COMPOUND', 'the recipe code is matched exactly (rc-1 is not RC-1)');
reset role;
-- ข้อมูลเก่าที่ผูกกับสูตรที่ไม่มีอยู่แล้ว (ใส่ตรงแบบงานระบบ): บันทึกซ้ำค่าเดิมได้ แต่เปลี่ยนไปเป็นรหัสอื่นที่ไม่มีไม่ได้
insert into public.bom_compounds (is_test, code, name, recipe_id, recipe_name) values (true, 'DM-OLD', 'ผูกไว้ก่อน', 'GONE-RC', 'สูตรที่หายไป');
set local role authenticated;
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM-OLD","name":"ชื่อใหม่","recipeId":"GONE-RC","recipeName":"สูตรที่หายไป"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'name', 'ชื่อใหม่',
  'an unchanged link to a recipe that is gone does not block saving the compound');
select throws_ok($$ select public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM-OLD","name":"ชื่อใหม่","recipeId":"GONE-TOO","recipeName":"x"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') $$, 'BOM_INVALID_COMPOUND', 'but changing the link to another missing recipe is refused');
select is(public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM-OLD","name":"ชื่อใหม่","recipeId":"RC-2","recipeName":"x"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'linkCompound') -> 'changes' -> 'compounds' -> 'upsert' -> 0 ->> 'recipeId', 'RC-2', 'and changing it to an existing recipe is fine');
select throws_ok($$ select public.app_bom_save_master('{"compounds":{"upsert":[{"code":"DM01","name":"EPDM","recipeId":"RC-1"}]}}'::jsonb, 0, 'linkCompound') $$,
  'BOM_STALE', 'the compound writer still checks for collisions before anything else');

-- 11. delta / audit ---------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_master_since(0) -> 'changes', (select jsonb_object_agg(l, jsonb_build_object('upsert', public.app_rf_master() -> l, 'delete', '[]'::jsonb)) from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'the delta from version 0 equals the snapshot (same shapes, same order)');
select is(public.app_rf_master_since((public.app_rf_master() ->> 'version')::bigint) -> 'changes',
  (select jsonb_object_agg(l, '{"upsert":[],"delete":[]}'::jsonb) from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l), 'a client at the current version gets an empty delta');
select is((select jsonb_agg(m ->> 'code') from jsonb_array_elements(public.app_rf_master() -> 'materials') m), '["MAT-A","MAT-B","MAT-C","MAT-D"]'::jsonb, 'materials are listed by code');
select is((select jsonb_agg((r ->> 'id') || '/' || (r ->> 'revision')) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r),
  '["RC-1/1","RC-1/2","RC-2/1","RC-2/2","RC-3/1"]'::jsonb, 'recipes carry every revision, ordered by code then revision');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' like 'REAL%'), 0, 'the real work order is never listed');
select set_config('test.vb', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_rf_save(jsonb_build_object(
  'materials', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.mat')::jsonb || '{"code":"MAT-E","name":"วัตถุดิบใหม่"}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.wo')::jsonb || '{"id":"WO-20261107-21"}'::jsonb))),
  current_setting('test.vb')::bigint, 'createOrder', '[{"action":"สร้าง WO","detail":"WO-20261107-21"}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes', public.app_rf_master_since(current_setting('test.vb')::bigint) -> 'changes', 'the reply to a save equals the delta RPC from the same base');
select is((public.app_rf_audit(1) -> 0) - 'at', jsonb_build_object('user', current_setting('test.n_sbx_rb_staff'), 'action', 'createOrder', 'detail', 'materials +1, orders +1',
                     'entries', '[{"action":"สร้าง WO","detail":"WO-20261107-21"}]'::jsonb),
  'the history line is what the server recorded (action and counts); the client text is kept apart as entries');
select is(jsonb_array_length(public.app_rf_audit(0)), 1, 'a limit below 1 is clamped to 1');
select ok(jsonb_array_length(public.app_rf_audit()) > 10, 'the default limit returns the history');
reset role;
select is((select jsonb_array_length(metadata -> 'entries') from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'createOrder'
           order by id desc limit 1), 1, 'one audit_logs row per save holds the client entries');
select ok(not exists (select 1 from public.audit_logs where action = 'RF_SAVE' and actor_id <> '8f000000-0000-0000-0000-000000000101'),
  'the actor of every RubberFlow audit row is the real admin behind the persona');
select ok((select count(*) from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'persona_name' is null) = 0, 'every audit row names the persona');
select ok(not exists (select 1 from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' like 'rubberflow:%' and actor_id <> '8f000000-0000-0000-0000-000000000101'),
  'the BOM audit rows written for RubberFlow also name the real admin');
select is((select count(*) from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' like 'rubberflow:%'), 5::bigint,
  'five BOM audit rows: four link calls (WO-11; WO-12 and WO-13 together; WO-31; WO-32) and one unlink (WO-31 cancelled); closing work orders feeds nothing back any more');

-- 12. ตารางเป็นแบบแยกโหมด: นับด้วยบทบาทของเทสต์ ------------------------------------------------
select is((select count(*) from public.rf_orders where not is_test), 1::bigint, 'the real work order is untouched');
select is((select count(*) from public.rf_recipes where not is_test), 1::bigint, 'the real recipe is untouched');
select is((select count(*) from public.rf_materials where not is_test), 1::bigint, 'the real material is untouched');
select ok((select bool_and(changed_version > 0) from public.rf_orders where is_test) and (select bool_and(changed_version > 0) from public.rf_recipes where is_test)
          and (select bool_and(changed_version > 0) from public.rf_materials where is_test), 'every test row is stamped with the version that changed it');
select is((select count(*) from public.rf_deleted_keys), 0::bigint, 'the tombstone table stays empty in this round');
select ok(not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rf_orders' and column_name = 'fed_back_at'),
  'the retired feedback marker column is gone (feedback happens per transfer receipt now)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_apply_feedback' and p.pronargs = 2),
  'and the old order-based feedback function is gone');
select is((select max(changed_version) from public.rf_orders where is_test), (select version from public.rf_master_state where is_test), 'the newest row carries the counter version');
set local role authenticated;

-- 13. epoch / purge ---------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok(format($f$ select public.app_rf_save('{}'::jsonb, 1, 'saveMaterial', '[]'::jsonb, %L) $f$, '00000000-0000-0000-0000-000000000000'), 'RF_RESET',
  'a save that holds another epoch is refused, even when it changes nothing');
select throws_ok($$ select public.app_rf_save('{"materials":{"upsert":[{"code":"STALE-EPOCH","name":"x"}]}}'::jsonb, 1, 'saveMaterial', '[]'::jsonb, 'not-a-uuid') $$, 'RF_RESET',
  'a malformed epoch is refused the same way and nothing is written');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'STALE-EPOCH'), 0, 'the refused save wrote nothing');
select is(public.app_rf_save('{}'::jsonb, 1, 'saveMaterial', '[]'::jsonb, current_setting('test.epoch0')) ->> 'epoch', current_setting('test.epoch0'), 'a save with the current epoch is accepted and its reply carries the epoch');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_rf()', 'NOT_AUTHORIZED', 'a non-admin still cannot purge');
select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the sandbox');
select throws_ok('select public.app_sandbox_purge_rf()', 'SANDBOX_NOT_ACTIVE', 'the purge works only inside the test mode');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.pre_version', public.app_rf_master() ->> 'version', true);
select set_config('test.pre_epoch', public.app_rf_master() ->> 'epoch', true);
select set_config('test.pre_bom_version', public.app_bom_master() ->> 'version', true);
select ok(current_setting('test.pre_version')::bigint > 20, 'the counter is well above zero before the purge');
select set_config('test.purge', public.app_sandbox_purge_rf()::text, true);
select ok((current_setting('test.purge')::jsonb ->> 'deleted')::integer > 15, 'the purge reports the deleted rows');
select is(public.app_rf_master() - 'epoch', (select jsonb_build_object('version', current_setting('test.pre_version')::bigint) || jsonb_object_agg(l, '[]'::jsonb) from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'the test data is empty again and the counter keeps its value (it never goes back)');
select isnt(public.app_rf_master() ->> 'epoch', current_setting('test.pre_epoch'), 'the purge changed the epoch');
select is(public.app_rf_master_since(current_setting('test.pre_version')::bigint) ->> 'epoch', public.app_rf_master() ->> 'epoch',
  'a client that is only behind by version sees the new epoch in the delta (and reloads)');
select throws_ok(format('select public.app_rf_master_since(%s)', current_setting('test.pre_version')::bigint + 1), 'RF_INVALID_PAYLOAD', 'a version above the counter is still refused');
select throws_ok(format($f$ select public.app_rf_save('{"materials":{"upsert":[{"code":"BEFORE-PURGE","name":"x"}]}}'::jsonb, %s, 'saveMaterial', '[]'::jsonb, %L) $f$,
  current_setting('test.pre_version')::bigint, current_setting('test.pre_epoch')), 'RF_RESET', 'a save that still holds the epoch from before the purge is refused');
select is(public.app_rf_audit(1) -> 0 ->> 'action', 'ล้างข้อมูล RubberFlow ทดสอบ', 'the purge is the newest history entry (earlier history is kept)');
select is(public.app_rf_audit(1) -> 0 ->> 'detail', 'ลบ ' || (current_setting('test.purge')::jsonb ->> 'deleted') || ' แถว', 'the purge entry is written by the server');
select ok(jsonb_array_length(public.app_rf_audit()) > 10, 'the history before the purge is kept');
select is(public.app_bom_master() ->> 'version', current_setting('test.pre_bom_version'), 'the purge did not touch BOM (its counter is unchanged)');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j -> 'externalRef' <> 'null'::jsonb), 4,
  'BOM jobs keep their links to the purged work orders (only RubberFlow data is purged)');
reset role;
select is((select count(*) from public.rf_materials where is_test) + (select count(*) from public.rf_recipes where is_test) + (select count(*) from public.rf_orders where is_test)
          + (select count(*) from public.rf_deleted_keys where is_test) + (select count(*) from public.rf_molds where is_test) + (select count(*) from public.rf_material_lots where is_test)
          + (select count(*) from public.rf_requisitions where is_test) + (select count(*) from public.rf_lots where is_test) + (select count(*) from public.rf_transfers where is_test)
          + (select count(*) from public.rf_fg_boxes where is_test) + (select count(*) from public.rf_qc_records where is_test) + (select count(*) from public.rf_ncrs where is_test),
  0::bigint, 'no test row is left in any RubberFlow table');
select is((select version from public.rf_master_state where is_test), current_setting('test.pre_version')::bigint, 'the test counter row keeps its version');
select isnt((select epoch::text from public.rf_master_state where is_test), current_setting('test.pre_epoch'), 'the test counter row has a new epoch');
select isnt((select epoch from public.rf_master_state where not is_test), (select epoch from public.rf_master_state where is_test), 'the real counter row has its own epoch');
select is((select version from public.rf_master_state where not is_test), 99::bigint, 'the real counter row is untouched');
select is((select count(*) from public.rf_materials where not is_test) + (select count(*) from public.rf_recipes where not is_test) + (select count(*) from public.rf_orders where not is_test),
  3::bigint, 'the real material, recipe and work order are untouched');
select is((select count(*) from public.audit_logs where action = 'RF_SANDBOX_PURGE' and actor_id = '8f000000-0000-0000-0000-000000000101'), 1::bigint,
  'the purge is audited with the real admin as the actor');
set local role authenticated;
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"AFTER","name":"หลังล้าง"}'::jsonb))), current_setting('test.pre_version')::bigint, 'saveMaterial', '[]'::jsonb,
  public.app_rf_master() ->> 'epoch') ->> 'version', (current_setting('test.pre_version')::bigint + 1)::text,
  'saving works again after the purge, with the new epoch, and the counter goes on from where it was');
select is(public.app_rf_master_since(current_setting('test.pre_version')::bigint) -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'code', 'AFTER',
  'a row created after the purge is newer than any version a client could have held before it');

select * from finish();
rollback;
