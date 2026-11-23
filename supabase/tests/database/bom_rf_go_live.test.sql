-- BOM / RubberFlow ใช้งานจริง (20261130010000_bom_rf_go_live.sql): พนักงานจริงใช้ RPC ของทั้งสองโมดูลได้ด้วยบัญชีของตัวเอง
-- ตรวจทั้งอนุญาตและปฏิเสธ: anon / ไม่มี session / ไม่มีแถวพนักงาน / พนักงาน inactive ถูกปฏิเสธ · PP จริงสร้างและปล่อยผลิตใบจริงได้ ·
-- RB จริงรายงานงาน RB ได้ GR จริงรายงานงาน RB ไม่ได้ · โหมดจริงไม่เห็นแถวทดสอบ โหมดทดสอบไม่เห็นแถวจริง · เลข PI / รหัสชิ้นงาน / รหัสวัตถุดิบเดียวกันมีได้ทั้งสองโหมด ·
-- audit แยกโหมด · ล้างข้อมูลทดสอบยังเป็นของ admin ในโหมดทดสอบเท่านั้นและไม่แตะแถวจริง
-- (authenticated อ่านตาราง bom_* / rf_* ตรงไม่ได้ จึงนับตารางด้วย reset role เสมอ)
begin;
-- กฎการใช้งานจริงของไฟล์นี้ทดสอบเมื่อเปิดใช้จริงแล้ว: เปิดสวิตช์ในธุรกรรมของเทสต์ (rollback ท้ายไฟล์) · สวิตช์ปิดทดสอบใน bom_rf_sandbox_lock.test.sql
create or replace function private.bom_real_open() returns boolean language sql stable set search_path = '' as $$ select true $$;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok(to_regprocedure('private.bom_test_mode()') is not null, 'the mode helper exists');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_test_mode()'::regprocedure, 'private.bom_actor()'::regprocedure, 'private.rf_actor()'::regprocedure,
                           'private.bom_reader()'::regprocedure, 'private.rf_reader()'::regprocedure, 'private.bom_can_edit(public.employees)'::regprocedure,
                           'private.bom_can_read(public.employees)'::regprocedure, 'private.rf_can_read(public.employees)'::regprocedure)),
  'the mode helper, both actors, both readers and the planner / read rules are security definer with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.oid in ('public.app_bom_master()'::regprocedure, 'public.app_bom_master_since(bigint)'::regprocedure,
                        'public.app_bom_audit(integer)'::regprocedure, 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)
                      and p.prosrc not like '%private.bom_reader()%'),
  'every public BOM RPC goes through the reader (read rule of real data)');
select ok(not exists (select 1 from pg_proc p where p.oid in ('public.app_rf_master()'::regprocedure, 'public.app_rf_master_since(bigint)'::regprocedure,
                        'public.app_rf_audit(integer)'::regprocedure, 'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)
                      and p.prosrc not like '%private.rf_reader()%'),
  'every public RubberFlow RPC goes through the reader');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and (p.proname like 'bom\_%' or p.proname like 'rf\_%')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private BOM or RubberFlow helper (the mode helper included)');
select ok(not exists (
    select 1 from unnest(array['public.app_bom_master()', 'public.app_bom_master_since(bigint)', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)',
                               'public.app_bom_audit(integer)', 'public.app_rf_master()', 'public.app_rf_master_since(bigint)',
                               'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'public.app_rf_audit(integer)',
                               'public.app_sandbox_purge_bom()', 'public.app_sandbox_purge_rf()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'only signed-in users can execute the BOM and RubberFlow RPCs');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace in ('private'::regnamespace, 'public'::regnamespace)
      and (p.proname ~ '^(bom|rf)_' or p.proname ~ '^app_(bom|rf)_')
      -- "(e.is_active or e.is_test)" เลือกบัญชีที่ใช้งานอยู่หรือบัญชีทดสอบ ไม่ใช่ตัวกรองโหมด (รายชื่อพนักงาน GR ของ 20261216010000 ตามด้วย e.is_test = โหมดของผู้เรียกเสมอ)
      and regexp_replace(p.prosrc, '\(\s*[a-z]\.is_active\s+or\s+[a-z]\.is_test\s*\)', '', 'g') ~ '\m[a-z]\.is_test\M(?!\s*=)'),
  'no BOM or RubberFlow function filters on a constant is_test any more (every filter compares with the caller''s mode)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_actor', 'rf_actor')
                      and p.prosrc not like '%if not private.bom_real_open() then%'),
  'the actors refuse callers outside test mode only while the real-use switch is closed (20261201010000)');

-- 2. บัญชีจริง (พนักงานที่ล็อกอินได้) และ persona ของโหมดทดสอบ --------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8ea00000-0000-0000-0000-000000000001', 'golive-admin@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000002', 'golive-pp@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000003', 'golive-rb@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000004', 'golive-gr@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000005', 'golive-inactive@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000006', 'golive-nobody@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000007', 'golive-hr-mgr@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000008', 'golive-it-mgr@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000009', 'golive-mt@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000010', 'golive-qa@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000011', 'golive-fm@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000012', 'golive-rb-amgr@test.local', '{}'),
  ('8ea00000-0000-0000-0000-000000000013', 'golive-qa-mgr@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id, is_active) values
  ('8ea00000-0000-0000-0000-000000000101', 'GOLIVE-ADMIN', 'GoLive', 'Admin', 'golive-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ea00000-0000-0000-0000-000000000001', true),
  ('8ea00000-0000-0000-0000-000000000102', 'GOLIVE-PP', 'GoLive', 'PP', 'golive-pp@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000002', true),
  ('8ea00000-0000-0000-0000-000000000103', 'GOLIVE-RB', 'GoLive', 'RB', 'golive-rb@test.local', 'RB',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000003', true),
  ('8ea00000-0000-0000-0000-000000000104', 'GOLIVE-GR', 'GoLive', 'GR', 'golive-gr@test.local', 'GR',
   (select id from public.departments where code = 'GR'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000004', true),
  ('8ea00000-0000-0000-0000-000000000105', 'GOLIVE-INACTIVE', 'GoLive', 'Inactive', 'golive-inactive@test.local', 'RB',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000005', false),
  ('8ea00000-0000-0000-0000-000000000107', 'GOLIVE-HR-MGR', 'GoLive', 'HRMgr', 'golive-hr-mgr@test.local', 'HR manager',
   (select id from public.departments where code = 'HR'), (select id from public.roles where code = 'department_manager'), '8ea00000-0000-0000-0000-000000000007', true),
  ('8ea00000-0000-0000-0000-000000000108', 'GOLIVE-IT-MGR', 'GoLive', 'ITMgr', 'golive-it-mgr@test.local', 'IT manager',
   (select id from public.departments where code = 'IT'), (select id from public.roles where code = 'department_manager'), '8ea00000-0000-0000-0000-000000000008', true),
  ('8ea00000-0000-0000-0000-000000000109', 'GOLIVE-MT', 'GoLive', 'MT', 'golive-mt@test.local', 'MT',
   (select id from public.departments where code = 'MT'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000009', true),
  ('8ea00000-0000-0000-0000-000000000110', 'GOLIVE-QA', 'GoLive', 'QA', 'golive-qa@test.local', 'QA',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8ea00000-0000-0000-0000-000000000010', true),
  ('8ea00000-0000-0000-0000-000000000111', 'GOLIVE-FM', 'GoLive', 'FM', 'golive-fm@test.local', 'Factory manager',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'factory_manager'), '8ea00000-0000-0000-0000-000000000011', true),
  ('8ea00000-0000-0000-0000-000000000112', 'GOLIVE-RB-AMGR', 'GoLive', 'RBAMgr', 'golive-rb-amgr@test.local', 'RB assistant manager',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'assistant_department_manager'), '8ea00000-0000-0000-0000-000000000012', true),
  ('8ea00000-0000-0000-0000-000000000113', 'GOLIVE-QA-MGR', 'GoLive', 'QAMgr', 'golive-qa-mgr@test.local', 'QA manager',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'department_manager'), '8ea00000-0000-0000-0000-000000000013', true);
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.employee_no like 'GOLIVE-%') = 12, 'every real account below has its department and role');

-- กลุ่มวางแผน (private.bom_can_edit ใช้ทั้ง BOM และ RubberFlow ทั้งสองโหมด): ผู้จัดการแผนกเฉพาะแผนกในสายผลิต
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-PP'), 'PP staff is a planner');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-FM'), 'a factory manager is a planner');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-ADMIN'), 'an admin is a planner');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-QA-MGR'), 'a QA department manager (production flow) is a planner');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-HR-MGR'), 'an HR department manager is no longer a planner');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-IT-MGR'), 'an IT department manager is no longer a planner');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-RB-AMGR'), 'an assistant department manager is not a planner (as before)');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-RB'), 'RB staff is not a planner');
select ok((select private.rf_is_rb_head(e) from public.employees e where e.employee_no = 'GOLIVE-RB-AMGR'), 'the RB head rule is unchanged (an RB assistant manager is an RB head)');
select is((select count(*)::integer from public.employees e
           where e.employee_no in ('SBX-PP-STAFF', 'SBX-RB-MGR', 'SBX-QA-MGR', 'SBX-PK-MGR', 'SBX-FT-FM', 'SBX-FT-AFM', 'SBX-MGT-GM') and private.bom_can_edit(e)), 7,
  'the personas the tests use as planners still qualify');
select ok((select private.bom_can_read(e) and not private.rf_can_read(e) from public.employees e where e.employee_no = 'GOLIVE-GR'), 'GR reads BOM but not RubberFlow');
select ok((select private.rf_can_read(e) and private.bom_can_read(e) and not private.bom_can_edit(e) from public.employees e where e.employee_no = 'GOLIVE-QA'),
  'QA reads RubberFlow and BOM (20261202010000: QA decides held rods of the SR store) but does not plan');
select ok((select not private.bom_can_read(e) and not private.rf_can_read(e) from public.employees e where e.employee_no in ('GOLIVE-MT')), 'MT staff reads neither');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select ok(current_setting('test.p_sbx_pp_staff', true) is not null, 'the PP persona of the sandbox exists');

-- แม่แบบเรคอร์ด (เหมือน bom_orders_jobs.test.sql / rubberflow_core.test.sql)
select set_config('test.ord', '{"id":"X","customer":"X","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"251130-00001","dept":"RB","itemCode":"GL-RB","name":"งานจริง","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["GL-FG"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"GL-FG","level":0,"fgQty":10,"required":10},{"itemCode":"GL-SE","level":1,"fgQty":10,"required":20},{"itemCode":"GL-RB","level":2,"fgQty":10,"required":40}]', true);
select set_config('test.mat', '{"code":"X","name":"x","category":"โพลิเมอร์","storage":"โกดัง A-1","uom":"kg","active":true}', true);

-- 3. ปฏิเสธ: anon / ไม่มี session / ไม่มีแถวพนักงาน / พนักงาน inactive ---------------------------------------------
set local role anon;
select throws_ok('select public.app_bom_master()', '42501', null, 'anon cannot call the BOM read');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, '42501', null, 'anon cannot call the BOM save');
select throws_ok('select public.app_rf_master()', '42501', null, 'anon cannot call the RubberFlow read');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, '42501', null, 'anon cannot call the RubberFlow save');

set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'AUTH_REQUIRED', 'reading BOM requires a session');
select throws_ok('select public.app_rf_master()', 'AUTH_REQUIRED', 'reading RubberFlow requires a session');

select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_FORBIDDEN', 'a login without an employee row cannot read BOM');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_FORBIDDEN', 'a login without an employee row cannot save BOM');
select throws_ok('select public.app_bom_audit()', 'BOM_FORBIDDEN', 'a login without an employee row cannot read the BOM audit');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'a login without an employee row cannot read RubberFlow');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_FORBIDDEN', 'a login without an employee row cannot save RubberFlow');

select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_FORBIDDEN', 'an inactive employee cannot read BOM');
select throws_ok('select public.app_bom_master_since(0)', 'BOM_FORBIDDEN', 'an inactive employee cannot read the BOM delta');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_FORBIDDEN', 'an inactive employee cannot save BOM');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'an inactive employee cannot read RubberFlow');
select throws_ok('select public.app_rf_audit()', 'RF_FORBIDDEN', 'an inactive employee cannot read the RubberFlow audit');
select throws_ok($$ select public.app_rf_save('{}'::jsonb, 0, 'saveMaterial') $$, 'RF_FORBIDDEN', 'an inactive employee cannot save RubberFlow');

-- 4. ข้อมูลโหมดทดสอบ (admin สวม persona PP): รหัส / เลข PI / รหัสวัตถุดิบเดียวกับที่โหมดจริงจะใช้ ----------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-FG","kind":"FG","name":"สินค้าทดสอบ","ownerDept":"PK","uom":"set"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'importFlat') $$, 'in test mode the PP persona adds a test item');
select lives_ok($$ select public.app_bom_save_master(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"GL-TEST","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251130-00001","customer":"GL-TEST"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$, 'in test mode the PP persona creates a test order');
select lives_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"GL-MAT","name":"วัตถุดิบทดสอบ"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial') $$,
  'in test mode the PP persona adds a test material');
select lives_ok('select public.app_sandbox_exit()', 'the admin leaves test mode');

-- 5. PP จริง: อ่านไม่เห็นแถวทดสอบ สร้าง / ระเบิด / ปล่อยผลิตใบจริงได้ ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select ok(not (public.app_bom_master() -> 'items' @> '[{"code":"GL-FG"}]'::jsonb), 'real mode does not see the test item');
select ok(not (public.app_bom_master() -> 'orders' @> '[{"id":"251130-00001"}]'::jsonb), 'real mode does not see the test order');
select ok(not (public.app_bom_master() -> 'customers' @> '[{"name":"GL-TEST"}]'::jsonb), 'real mode does not see the test customer');
select ok(not (public.app_rf_master() -> 'materials' @> '[{"code":"GL-MAT"}]'::jsonb), 'real RubberFlow does not see the test material');
select is(public.app_bom_audit(), '[]'::jsonb, 'the real BOM audit does not list test-mode saves');
select is(public.app_rf_audit(), '[]'::jsonb, 'the real RubberFlow audit does not list test-mode saves');

select lives_ok($$ select public.app_bom_save_master('{"items":{"upsert":[
  {"code":"GL-FG","kind":"FG","name":"สินค้าจริง","ownerDept":"PK","uom":"set"},
  {"code":"GL-SE","kind":"SE","name":"ชิ้นยางจริง","ownerDept":"GR","uom":"pcs"},
  {"code":"GL-RB","kind":"RB","name":"เส้นยางจริง","ownerDept":"RB","uom":"pcs"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'importFlat') $$,
  'a real PP planner adds real items (the same code as a test item is allowed)');
select is((select i ->> 'name' from jsonb_array_elements(public.app_bom_master() -> 'items') i where i ->> 'code' = 'GL-FG'), 'สินค้าจริง',
  'real mode reads its own item, not the test item with the same code');
select lives_ok($$ select public.app_bom_save_master(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"GL-REAL","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251130-00001","customer":"GL-REAL"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'a real PP planner creates a real draft order with the same PI number as the test order');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251130-00001'), true);
select is(current_setting('test.o')::jsonb ->> 'customer', 'GL-REAL', 'the real order is the one real mode reads');
select is(current_setting('test.o')::jsonb ->> 'createdBy', 'GoLive PP', 'the creator is the real employee');
select lives_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || jsonb_build_object('items', '[{"fgCode":"GL-FG","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'explodeOrder') $$, 'a real PP planner explodes the real order');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251130-00001'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"GL-JOB-RB","dept":"RB","itemCode":"GL-RB","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"GL-JOB-GR","dept":"GR","itemCode":"GL-SE","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"GL-JOB-PK","dept":"PK","itemCode":"GL-FG","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'a real PP planner releases the real order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'releasedBy', 'GoLive PP', 'the releaser is the real employee');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert'), 3, 'the release creates the three real jobs');

-- 6. พนักงานแผนกจริง: RB รายงานงาน RB ได้ · GR รายงานงาน RB ไม่ได้ แต่รายงานงาน GR ได้ · RB สร้างใบไม่ได้ ------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'GL-JOB-RB'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 3, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'ใครก็ได้', 'good', 3, 'reject', 0, 'note', 'กะเช้า')))))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '3', 'a real RB staff reports on a real RB job');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 0 ->> 'by', 'GoLive RB', 'the report author is the real employee');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251130-00002","customer":"GL-REAL"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_FORBIDDEN', 'a real RB staff cannot create an order');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-X","kind":"FG","name":"x","ownerDept":"PK","uom":"set"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'saveItem') $$, 'BOM_FORBIDDEN', 'a real RB staff cannot edit the item master');

select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'GL-JOB-RB'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('qtyDone', 5, 'reports',
    (current_setting('test.j')::jsonb -> 'reports') || '[{"at":2,"by":"x","good":2,"reject":0,"note":"แทนกัน"}]'::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'a real GR staff cannot report on an RB job');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'GL-JOB-GR'), true);
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 2, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 2, 'reject', 0, 'note', '')))))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '2',
  'a real GR staff reports on the GR job of the department');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"GL-MAT-2","name":"x"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial') $$,
  'RF_FORBIDDEN', 'a real GR staff cannot add a RubberFlow material');

-- 7. RubberFlow จริง: PP เพิ่มวัตถุดิบรหัสเดียวกับของทดสอบได้ · RB อ่านเห็นของจริง ---------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"GL-MAT","name":"วัตถุดิบจริง"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial') $$,
  'a real PP planner adds a real material with the same code as the test material');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select m ->> 'name' from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'GL-MAT'), 'วัตถุดิบจริง',
  'a real RB staff reads the real material, not the test one');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'releaseOrder' and a ->> 'user' = 'GoLive PP'),
  'the real BOM audit lists the real release by the real employee');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'saveMaterial' and a ->> 'user' = 'GoLive PP'),
  'the real RubberFlow audit lists the real save');

-- 7b. ใช้งานจริง: ใครอ่านข้อมูลจริงได้ และผู้จัดการแผนกนอกสายผลิตไม่ใช่กลุ่มวางแผน --------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_FORBIDDEN', 'a real HR department manager cannot read BOM');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'a real HR department manager cannot read RubberFlow');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-HR","kind":"FG","name":"x","ownerDept":"PK","uom":"set"}]}}'::jsonb, 0, 'importFlat') $$,
  'BOM_FORBIDDEN', 'a real HR department manager cannot plan (edit the item master)');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"GL-HR","name":"x"}'::jsonb))), 0, 'saveMaterial') $$, 'RF_FORBIDDEN', 'a real HR department manager cannot write RubberFlow');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_FORBIDDEN', 'a real IT department manager cannot read BOM');
select throws_ok('select public.app_bom_audit()', 'BOM_FORBIDDEN', 'a real IT department manager cannot read the BOM audit');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'a real IT department manager cannot read RubberFlow');
select throws_ok('select public.app_rf_audit()', 'RF_FORBIDDEN', 'a real IT department manager cannot read the RubberFlow audit');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_FORBIDDEN', 'a real MT staff cannot read BOM');
select throws_ok('select public.app_bom_master_since(0)', 'BOM_FORBIDDEN', 'a real MT staff cannot read the BOM delta');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'a real MT staff cannot read RubberFlow');
select throws_ok('select public.app_rf_master_since(0)', 'RF_FORBIDDEN', 'a real MT staff cannot read the RubberFlow delta');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select ok(public.app_bom_master() -> 'orders' @> '[{"id":"251130-00001"}]'::jsonb, 'a real RB staff reads BOM');
select ok(public.app_rf_master() -> 'materials' @> '[{"code":"GL-MAT"}]'::jsonb, 'a real RB staff reads RubberFlow');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select ok(public.app_bom_master() -> 'jobs' @> '[{"id":"GL-JOB-GR"}]'::jsonb, 'a real GR staff reads BOM');
select throws_ok('select public.app_rf_master()', 'RF_FORBIDDEN', 'a real GR staff cannot read RubberFlow');
select throws_ok('select public.app_rf_audit()', 'RF_FORBIDDEN', 'a real GR staff cannot read the RubberFlow audit');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select ok(public.app_rf_master() -> 'materials' @> '[{"code":"GL-MAT"}]'::jsonb, 'a real QA staff reads RubberFlow');
select ok(public.app_bom_master() -> 'orders' @> '[{"id":"251130-00001"}]'::jsonb, 'a real QA staff reads BOM (20261202010000)');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-QA","kind":"FG","name":"x","ownerDept":"PK","uom":"set"}]}}'::jsonb, 0, 'importFlat') $$,
  'BOM_FORBIDDEN', 'a real QA staff still cannot plan');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select lives_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-FM","kind":"FG","name":"สินค้าของผู้จัดการโรงงาน","ownerDept":"PK","uom":"set"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'importFlat') $$, 'a real factory manager plans (edits the item master)');
select lives_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"GL-FM-MAT","name":"วัตถุดิบของผู้จัดการโรงงาน"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial') $$,
  'a real factory manager plans in RubberFlow too');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select ok(public.app_bom_master() -> 'items' @> '[{"code":"GL-FM"}]'::jsonb, 'a real QA department manager (planner group) reads BOM');

-- 8. โหมดทดสอบไม่เห็นแถวจริง และ audit ทดสอบไม่มีรายการจริง ------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok(public.app_bom_master() -> 'orders' @> '[{"id":"251130-00001","customer":"GL-REAL"}]'::jsonb, 'an admin outside test mode reads the real order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(public.app_bom_master() -> 'orders' @> '[{"id":"251130-00001","customer":"GL-TEST"}]'::jsonb, 'test mode reads its own order with the same PI number');
select ok(not (public.app_bom_master() -> 'orders' @> '[{"customer":"GL-REAL"}]'::jsonb), 'test mode does not see the real order');
select ok(not (public.app_bom_master() -> 'jobs' @> '[{"id":"GL-JOB-RB"}]'::jsonb), 'test mode does not see the real jobs');
select is((select i ->> 'name' from jsonb_array_elements(public.app_bom_master() -> 'items') i where i ->> 'code' = 'GL-FG'), 'สินค้าทดสอบ',
  'test mode reads its own item, not the real item with the same code');
select is((select m ->> 'name' from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'GL-MAT'), 'วัตถุดิบทดสอบ',
  'test mode reads its own material, not the real one');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'user' like 'GoLive%'), 'the test-mode BOM audit does not list real saves');
select ok(not exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'user' like 'GoLive%'), 'the test-mode RubberFlow audit does not list real saves');
-- โหมดทดสอบคงเดิม: ทุก persona อ่านข้อมูลทดสอบได้ (กฎอ่านใช้เฉพาะข้อมูลจริง) แต่กลุ่มวางแผนใช้กฎใหม่เหมือนกัน
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select lives_ok('select public.app_bom_master()', 'in test mode a QA persona still reads the BOM test data');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select lives_ok('select public.app_rf_master()', 'in test mode a GR persona still reads the RubberFlow test data');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"GL-GR","kind":"FG","name":"x","ownerDept":"PK","uom":"set"}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'importFlat') $$, 'BOM_FORBIDDEN', 'in test mode a GR persona still cannot plan');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);

reset role;
select is((select count(*) from public.bom_orders where pi_no = '251130-00001'), 2::bigint, 'the same PI number exists once per mode');
select is((select count(*) from public.bom_items where code = 'GL-FG'), 2::bigint, 'the same item code exists once per mode');
select is((select count(*) from public.rf_materials where code = 'GL-MAT'), 2::bigint, 'the same material code exists once per mode');
select ok((select bool_and(not is_test) from public.bom_jobs where job_no like 'GL-JOB-%'), 'the real jobs are stored as real rows');
select ok(exists (select 1 from public.bom_master_state where not is_test and version > 0), 'the first real save created the real BOM counter row');
select ok(exists (select 1 from public.rf_master_state where not is_test and version > 0), 'the first real save created the real RubberFlow counter row');
select ok(exists (select 1 from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'is_test' = 'false'
                  and actor_id = '8ea00000-0000-0000-0000-000000000102' and metadata ->> 'client_action' = 'releaseOrder'),
  'a real save is audited as real with the real employee as the actor');
select ok(not exists (select 1 from public.audit_logs where action in ('BOM_MASTER_SAVE', 'RF_SAVE') and metadata ->> 'is_test' = 'true'
                      and actor_id <> '8ea00000-0000-0000-0000-000000000101'),
  'every test-mode save is still audited with the real admin behind the persona');
set local role authenticated;

-- 9. ล้างข้อมูลทดสอบ: admin ในโหมดทดสอบเท่านั้น และไม่แตะแถวจริง --------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'NOT_AUTHORIZED', 'a real planner cannot purge BOM');
select throws_ok('select public.app_sandbox_purge_rf()', 'NOT_AUTHORIZED', 'a real planner cannot purge RubberFlow');
select set_config('request.jwt.claims', '{"sub":"8ea00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok('select public.app_sandbox_exit()', 'the admin leaves test mode again');
select throws_ok('select public.app_sandbox_purge_bom()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge BOM');
select throws_ok('select public.app_sandbox_purge_rf()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge RubberFlow');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok('select public.app_sandbox_purge_bom()', 'the admin in test mode purges the BOM test data');
select lives_ok('select public.app_sandbox_purge_rf()', 'the admin in test mode purges the RubberFlow test data');

reset role;
select is((select count(*) from public.bom_orders where pi_no = '251130-00001' and not is_test), 1::bigint, 'the purge kept the real order');
select is((select count(*) from public.bom_orders where pi_no = '251130-00001' and is_test), 0::bigint, 'the purge removed the test order with the same number');
select is((select count(*) from public.bom_jobs where job_no like 'GL-JOB-%' and not is_test), 3::bigint, 'the purge kept the real jobs');
select is((select count(*) from public.bom_items where code in ('GL-FG', 'GL-SE', 'GL-RB') and not is_test), 3::bigint, 'the purge kept the real items');
select is((select count(*) from public.rf_materials where code = 'GL-MAT' and not is_test), 1::bigint, 'the purge kept the real material');
select is((select count(*) from public.rf_materials where code = 'GL-MAT' and is_test), 0::bigint, 'the purge removed the test material');
set local role authenticated;

select * from finish();
rollback;
