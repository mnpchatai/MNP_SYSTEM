-- ใบสั่งผลิต (PI) งานรายแผนก นับคงคลัง ลูกค้า audit และล้างข้อมูลทดสอบของโมดูล BOM (20261106010000_bom_orders_jobs.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: กลุ่มวางแผน / พนักงาน ST และ WH / พนักงานแผนกของงาน / แผนกอื่น, การเปลี่ยนสถานะใบ, เปิดใบกลับมาแก้ (มี/ไม่มีงานที่เริ่มแล้ว),
-- รายงานผลต่อท้ายเท่านั้น, สิทธิ์รายช่องของงาน, ชนรายระเบียน (เลข PI ซ้ำ), delta ของ orders/jobs/หลุมฝังศพ, audit และ purge
-- (authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงนับตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ของตารางใหม่ ------------------------------------------------------------
create temp table bom_new_tables(name text) on commit drop;
insert into bom_new_tables values ('bom_customers'), ('bom_orders'), ('bom_jobs');

select is((select count(*) from bom_new_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  3::bigint, 'the new BOM tables have RLS enabled');
select ok(not exists (
    select 1 from bom_new_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on the new tables');
select ok(not exists (
    select 1 from bom_new_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass and p.polname = t.name || '_no_direct_access')),
  'the new tables have the deny-all policy');
select ok(not exists (
    select 1 from bom_new_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'the new tables have the restrictive lab_only_no_access policy');
select ok(not exists (
    select 1 from bom_new_tables t
    where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)
       or not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_stamp_version' and not g.tgisinternal)),
  'the new tables enforce sandbox scope and stamp changed_version by trigger');
select ok(not exists (select 1 from bom_new_tables t where not (t.name = any (private.sandbox_unguarded_tables()))),
  'the new tables are registered as sandbox aware');
select ok('bom_deleted_keys' = any (private.sandbox_unguarded_tables()) and 'qc_inspection_reports' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the master tables and the other modules');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bom_customers_changed_idx', 'bom_orders_changed_idx', 'bom_jobs_changed_idx')),
  3::bigint, 'the new tables are indexed by (is_test, changed_version)');
select is((select count(*) from pg_constraint c where c.conrelid = 'public.bom_jobs'::regclass and c.contype = 'f'
           and pg_get_constraintdef(c.oid) like '%, is_test) REFERENCES %bom_%'),
  2::bigint, 'jobs reference their order and item with foreign keys paired with is_test');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_customers_name_idx' and indexdef like '%lower(name)%'),
  'a customer name is unique ignoring case');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_bom_audit(integer)', 'public.app_sandbox_purge_bom()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'only signed-in users can execute the new and changed RPCs');
select ok(to_regprocedure('public.app_bom_save_master(jsonb,bigint,text)') is null and to_regprocedure('public.app_bom_save_master(jsonb,bigint,text,jsonb)') is null,
  'the older save signatures are replaced (no ambiguous overload); 3- and 4-argument calls use the defaults for the audit and the epoch');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_master_state' and column_name = 'epoch' and is_nullable = 'NO'),
  'the counter row carries a required epoch');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_bom_audit(integer)'::regprocedure,
                           'public.app_sandbox_purge_bom()'::regprocedure)),
  'the RPCs are security definer with an empty search_path');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'bom\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private BOM helper');
select lives_ok($$ insert into public.bom_deleted_keys (list, base, code) values ('jobs', '', 'JOB-STRUCT-TEST') $$, 'a job tombstone is accepted');
select throws_ok($$ insert into public.bom_deleted_keys (list, base, code) values ('widgets', '', 'X') $$, '23514', null, 'other tombstone lists are rejected');
select is((select count(*) from pg_constraint where conrelid = 'public.bom_orders'::regclass and contype = 'u'
           and pg_get_constraintdef(oid) in ('UNIQUE (id, is_test)', 'UNIQUE (pi_no, is_test)')),
  2::bigint, 'a PI number is unique per mode');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e000000-0000-0000-0000-000000000001', 'bomo-admin@test.local', '{}'),
  ('8e000000-0000-0000-0000-000000000002', 'bomo-staff@test.local', '{}'),
  ('8e000000-0000-0000-0000-000000000003', 'mnplab001-bomo@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e000000-0000-0000-0000-000000000101', 'BOMO-ADMIN', 'Bomo', 'Admin', 'bomo-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e000000-0000-0000-0000-000000000001'),
  ('8e000000-0000-0000-0000-000000000102', 'BOMO-STAFF-REAL', 'Bomo', 'Staff', 'bomo-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8e000000-0000-0000-0000-000000000002'),
  ('8e000000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-bomo@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8e000000-0000-0000-0000-000000000003');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id
           where e.is_test and ((e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST') or (e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH')
                                or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR') or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-GR-AMGR' and d.code = 'GR') or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA'))) = 8,
  'the personas used below belong to the departments the rules name');

-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ เพื่อตรวจว่าโหมดทดสอบมองไม่เห็น และ purge ไม่แตะ
insert into public.bom_items (code, kind, name, owner_dept, uom) values ('REAL-ITEM', 'FG', 'ชิ้นงานจริง', 'PK', 'pcs');
insert into public.bom_master_state (is_test, version) values (false, 99);
insert into public.bom_customers (name) values ('ลูกค้าจริง');
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_jobs (job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required)
select 'REAL-JOB', o.id, 'PK', 'REAL-ITEM', 'งานจริง', 'FG', 'pcs', 1, 1 from public.bom_orders o where o.pi_no = 'REAL-PI';
select is((select count(*) from public.bom_orders where not is_test), 1::bigint, 'the real order was inserted as a real (non-test) row');

-- แม่แบบเรคอร์ดที่ใช้ซ้ำ: ใบ draft ว่าง และงาน queued (แต่ละครั้งทับด้วย || ที่ id / แผนก / ชิ้น)
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","level":1,"fgQty":10,"required":20},{"itemCode":"RB-A","level":2,"fgQty":10,"required":40}]', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_bom_audit()', 'AUTH_REQUIRED', 'reading the audit requires a session');
select throws_ok('select public.app_sandbox_purge_bom()', 'AUTH_REQUIRED', 'the purge requires a session');

select set_config('request.jwt.claims', '{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_bom_audit()', 'BOM_TEST_MODE_ONLY', 'a real PP staff account cannot read the audit');
select throws_ok('select public.app_sandbox_purge_bom()', 'NOT_AUTHORIZED', 'a non-admin cannot purge');
select throws_ok('select count(*) from public.bom_orders', '42501', null, 'clients cannot read the order table directly');
select throws_ok('select count(*) from public.bom_jobs', '42501', null, 'clients cannot read the job table directly');
select throws_ok('select count(*) from public.bom_customers', '42501', null, 'clients cannot read the customer table directly');
select throws_ok($$ update public.bom_jobs set status = 'done' $$, '42501', null, 'clients cannot write the job table directly');

select set_config('request.jwt.claims', '{"sub":"8e000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.app_bom_audit()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot read the audit');
select throws_ok('select public.app_sandbox_purge_bom()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot purge');

select set_config('request.jwt.claims', '{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_bom_audit()', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read the audit');
select throws_ok('select public.app_sandbox_purge_bom()', 'SANDBOX_NOT_ACTIVE', 'an admin outside test mode cannot purge');

-- 4. ข้อมูลหลักตั้งต้น (PP staff) ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"FG-B","kind":"FG","name":"สินค้า B","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1',
  'the planner seeds the item master');
select is(public.app_bom_master() -> 'orders', '[]'::jsonb, 'there are no orders yet and the real order is not visible');
select is(public.app_bom_master() -> 'jobs', '[]'::jsonb, 'there are no jobs yet and the real job is not visible');
select is(public.app_bom_master() -> 'customers', '[]'::jsonb, 'there are no customers yet and the real customer is not visible');
select is(jsonb_array_length(public.app_bom_master_since(0) -> 'changes' -> 'items' -> 'upsert'), 5, 'the delta still carries the master lists');
select ok(public.app_bom_master_since(0) -> 'changes' ?& array['customers', 'orders', 'jobs'], 'the delta carries the three new lists');
select lives_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'the 3-argument call still works (default audit) and is a no-op for an empty change');
select ok((public.app_bom_master() ->> 'epoch') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'the snapshot carries the epoch');
select is(public.app_bom_master_since(0) ->> 'epoch', public.app_bom_master() ->> 'epoch', 'the delta carries the same epoch');
select set_config('test.epoch0', public.app_bom_master() ->> 'epoch', true);
select is(public.app_bom_save_master('{}'::jsonb, 1, 'saveItem', '[]'::jsonb, current_setting('test.epoch0')) ->> 'epoch', current_setting('test.epoch0'),
  'a save with the current epoch is accepted and its reply carries the epoch');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 1, 'saveItem', '[]'::jsonb, '00000000-0000-0000-0000-000000000000') $$, 'BOM_RESET',
  'a save that holds another epoch is refused, even when it changes nothing');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"STALE-EPOCH"}]}}'::jsonb, 1, 'saveCustomer', '[]'::jsonb, 'not-a-uuid') $$, 'BOM_RESET',
  'a malformed epoch is refused the same way and nothing is written');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'customers') c where c ->> 'name' = 'STALE-EPOCH'), 0, 'the refused save wrote nothing');

-- 5. ลูกค้า -------------------------------------------------------------------------------
select is(public.app_bom_save_master(
  '{"customers":{"upsert":[{"name":"ACME","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 1, 'saveCustomer')
  -> 'changes' -> 'customers' -> 'upsert' -> 0 ->> 'name', 'ACME', 'a planner adds a customer');
select is(public.app_bom_save_master(
  '{"customers":{"upsert":[{"name":"  acme  ","country":"TH2","orderType":"EX","note":"x"}]}}'::jsonb, 2, 'saveCustomer')
  -> 'changes' -> 'customers' -> 'upsert' -> 0 ->> 'country', 'TH2', 'a name that differs only by case and spaces updates the same customer');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"A","orderType":"ZZ"}]}}'::jsonb, 3, 'saveCustomer') $$,
  'BOM_INVALID_CUSTOMER', 'a bad order type is rejected');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"  "}]}}'::jsonb, 3, 'saveCustomer') $$,
  'BOM_INVALID_CUSTOMER', 'a blank customer name is rejected');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"delete":[]}}'::jsonb, 3, 'saveCustomer') $$,
  'BOM_INVALID_PAYLOAD', 'customers cannot be deleted');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"ZED"}]}}'::jsonb, 3, 'saveCustomer') $$,
  'BOM_FORBIDDEN', 'RB staff cannot add a customer');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"ZED"}]}}'::jsonb, 3, 'reportJob') $$,
  'BOM_FORBIDDEN', 'a staff action cannot smuggle a customer in');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"Z-1","kind":"FG","name":"z","ownerDept":"PK","uom":"set"}]}}'::jsonb, 3, 'reportJob') $$,
  'BOM_FORBIDDEN', 'a staff action cannot smuggle a master record in');

-- 6. ใบสั่งผลิต: สร้าง ตรวจรูป สิทธิ์ ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_FORBIDDEN', 'RB staff cannot create an order');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'a counting action does not let a non-counter department create an order');

select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'ST staff cannot create an order either (counting only)');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","status":"released"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_TRANSITION', 'a new order must start as a draft');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","orderType":"XX"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_ORDER', 'an unknown order type is rejected');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","whDue":1762300000000}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_ORDER', 'a delivery date before the order date is rejected');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","items":[{"fgCode":"NOPE","qty":1}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_ITEM_NOT_FOUND', 'an unknown product is rejected');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","items":[{"fgCode":"SE-A","qty":1}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_ITEM', 'only finished goods can be ordered');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","items":[{"fgCode":"FG-A","qty":0}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_ORDER', 'a zero quantity is rejected');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25001","items":[{"fgCode":"FG-A","qty":1},{"fgCode":"fg-a","qty":2}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder') $$,
  'BOM_INVALID_ORDER', 'the same product twice in one order is rejected');
select throws_ok($$ select public.app_bom_save_master('{"orders":{"delete":[]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_INVALID_PAYLOAD', 'orders cannot be deleted');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-NOORDER","orderId":"NOPE"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_JOB', 'a job needs an existing order');

select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || jsonb_build_object('id', '251106-25001', 'createdBy', 'ใครก็ได้', 'createdAt', 1)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'draft', 'a planner creates a draft order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'createdBy', current_setting('test.n_sbx_pp_staff'),
  'the creator is the persona, not what the client sent');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'createdAt', '1', 'the creation time is the server time');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'revision', '0', 'a new order starts at revision 0');
select is(jsonb_array_length(public.app_bom_master() -> 'customers'), 1, 'saving the order with an existing customer name does not add a second customer');
select is(public.app_bom_master() -> 'customers' -> 0 ->> 'country', 'TH', 'the customer sent with the order (same name) updated the existing record');
select is(public.app_bom_save_master('{"customers":{"upsert":[{"name":"  Spaced   Name ","country":"TH","orderType":"SA","note":""}]}}'::jsonb,
  (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer') -> 'changes' -> 'customers' -> 'upsert' -> 0 ->> 'name', 'Spaced Name',
  'inner whitespace of a customer name is collapsed (the client key uses the same rule)');


-- ใบ draft: แก้สินค้า/ระเบิดได้ (planner) แล้วนับคงคลัง (planner / ST / WH)
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || jsonb_build_object('items', '[{"fgCode":"fg-a","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'explodeOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb,
  'the planner edits the items of a draft (the code is made canonical)');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'explodedAt', 'null'::jsonb, 'the explosion time is set by the server');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'explosion'), 3, 'the explosion is stored');

select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":5}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"SE-A":5}'::jsonb, 'ST staff counts the stock of a draft order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'stockCountedBy', current_setting('test.n_sbx_st_staff'),
  'the counter is the persona');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"note":"แก้โดย ST"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'ST staff cannot change anything but the counts');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":6},"note":"x"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'counts plus another field are refused');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_FORBIDDEN', 'ST staff cannot cancel an order');

select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":5,"RB-A":9}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"SE-A":5,"RB-A":9}'::jsonb, 'WH staff counts the stock too');

select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":1}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'GR staff cannot count the stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":1}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_FORBIDDEN', 'QA staff cannot count the stock');

-- ปล่อยผลิต: ต้องมีสินค้า ระเบิดแล้ว และมีงาน ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'releasing an order without any job is refused (the whole call rolls back)');
select is(public.app_bom_master() -> 'orders' -> 0 ->> 'status', 'draft', 'the refused release left the order a draft');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'a draft cannot jump to in_progress');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"completed"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'completeOrder') $$,
  'BOM_INVALID_TRANSITION', 'a draft cannot be completed');

select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251106-25001","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-GR","orderId":"251106-25001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251106-25001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder', '[{"action":"ปล่อยผลิต","detail":"251106-25001 สร้างงาน 3 รายการ"}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the planner releases the order');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'releasedBy', current_setting('test.n_sbx_pp_staff'), 'the releaser is the persona');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'releasedAt', 'the release time is set');
select is((select jsonb_agg(j ->> 'dept') from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert') j), '["GR","PK","RB"]'::jsonb,
  'the jobs come back in orderId, dept order');
select is(current_setting('test.res')::jsonb -> 'changes', public.app_bom_master_since((current_setting('test.res')::jsonb ->> 'version')::bigint - 1) -> 'changes',
  'the reply to a save equals the delta RPC from the same base');

-- ใบที่ปล่อยแล้ว: ล็อกเนื้อหา ----------------------------------------------------------------
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"items":[{"fgCode":"FG-A","qty":99,"colorSet":"A","note":""}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'items of a released order cannot change without reopening it');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":1}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts') $$,
  'BOM_INVALID_TRANSITION', 'the stock is counted on drafts only');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'in_progress without a started job is refused');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-1-LATE","orderId":"251106-25001","dept":"RB","itemCode":"RB-A"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'a job can only be created by the release call');

-- 7. งานรายแผนก: สิทธิ์รายช่อง ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"qtyPlanned":1}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot change the planned quantity');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"dueAt":1765000000000}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot change the due date');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"itemCode":"RB-A"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot change the item of a job');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"dept":"RB"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot move a job to another department');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"externalRef":{"system":"rubberflow","woId":"WO-9","kg":1}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'linkJobToRubberFlow') $$,
  'BOM_FORBIDDEN', 'only RB or the planners can link a RubberFlow work order');
select throws_ok($$ select public.app_bom_save_master('{"jobs":{"delete":["JOB-1-GR"]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot delete a job');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.job')::jsonb || '{"id":"JOB-1-NEW","orderId":"251106-25001","dept":"GR","itemCode":"SE-A"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot create a job');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"qtyDone":4}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_INVALID_JOB', 'a quantity cannot grow without a report entry');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"note":"x"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001')))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'department staff cannot edit the order');

-- รายงานผล (GR staff): by / at ตั้งโดยเซิร์ฟเวอร์ ใบเปลี่ยนเป็น in_progress เอง
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 3, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'ใครก็ได้', 'good', 3, 'reject', 0, 'note', 'กะเช้า')))))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob', '[{"action":"รายงานผลผลิต","detail":"JOB-1-GR ดี 3"}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'GR staff reports on a GR job');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 0 ->> 'by', current_setting('test.n_sbx_gr_staff'),
  'the report author is the persona, not what the client sent');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 0 ->> 'at', '1', 'the report time is the server time');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 0 ->> 'note', 'กะเช้า', 'the report note is kept');
select is((select o ->> 'status' from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert') o), 'in_progress',
  'the server moved the order to in_progress (the reply carries the order)');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), 'in_progress',
  'the order stays in_progress');

-- ต่อท้ายเท่านั้น
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_set(current_setting('test.j')::jsonb, '{reports,0,good}', '4'::jsonb) || '{"qtyDone":4}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'an existing report entry cannot be edited');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  jsonb_set(current_setting('test.j')::jsonb, '{reports,0,by}', '"คนอื่น"'::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'the author of an existing report entry cannot be rewritten');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"reports":[],"qtyDone":0}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'a report entry cannot be removed');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('qtyDone', 1, 'reports', (current_setting('test.j')::jsonb -> 'reports'))))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_INVALID_JOB', 'a quantity cannot go down');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('qtyDone', 9, 'reports',
    (current_setting('test.j')::jsonb -> 'reports') || '[{"at":1,"by":"x","good":2,"reject":0,"note":""}]'::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_INVALID_JOB', 'the added quantity must equal the sum of the new report entries');

-- ผู้ช่วยผู้จัดการแผนก GR (ทุกบทบาทของแผนกรายงานได้) เพิ่มรายงานชุดที่สอง + พักงาน
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'hold', 'qtyDone', 5, 'qtyReject', 1, 'reports',
    (current_setting('test.j')::jsonb -> 'reports') || '[{"at":2,"by":"x","good":2,"reject":1,"note":"บ่าย"}]'::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '5', 'an assistant department manager of GR reports on a GR job (any role of the department)');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports'), 2, 'the second report is appended');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 0 ->> 'by', current_setting('test.n_sbx_gr_staff'), 'the first entry keeps its author');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> 1 ->> 'by', current_setting('test.n_sbx_gr_amgr'), 'the second entry has its own author');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'hold', 'the status can be put on hold');

-- แผนกอื่นรายงานงานของ GR ไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus') $$,
  'BOM_FORBIDDEN', 'QA staff cannot change the status of a GR job');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus') $$,
  'BOM_FORBIDDEN', 'RB staff cannot change the status of a GR job');

-- RB staff ผูก WO ได้ (งาน RB เท่านั้น) แล้วแก้ซ้ำไม่ได้
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-RB'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"in_progress","externalRef":{"system":"rubberflow","woId":"WO-1","kg":12.5,"linkedAt":1,"by":"ใครก็ได้"}}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'linkJobToRubberFlow')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'externalRef' ->> 'woId', 'WO-1', 'RB staff link a RubberFlow work order to an RB job');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'externalRef' ->> 'by', current_setting('test.n_sbx_rb_staff'),
  'the link author is the persona');
select isnt(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'externalRef' ->> 'linkedAt', '1', 'the link time is the server time');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-RB'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"externalRef":{"system":"rubberflow","woId":"WO-2","kg":1}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'linkJobToRubberFlow') $$,
  'BOM_FORBIDDEN', 'an already linked work order cannot be replaced by department staff');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"externalRef":null}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'linkJobToRubberFlow') $$,
  'BOM_FORBIDDEN', 'department staff cannot unlink a work order');

-- กลุ่มวางแผน: แก้ได้ทุกช่อง แต่รายงานต่อท้ายเท่านั้นเช่นกัน
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select set_config('test.b0', (public.app_bom_master() ->> 'version'), true);
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"dueAt":1765000000000,"name":"ชื่อใหม่","qtyPlanned":80}'::jsonb))), current_setting('test.b0')::bigint, 'reportJob')
  -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyPlanned', '80', 'a planner changes the due date, name and planned quantity of a job');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"reports":[]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'even a planner cannot erase report history');

-- ชนรายระเบียน: GR staff ถือฐานเก่า ขณะที่ planner แก้งานเดียวกัน
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"in_progress"}'::jsonb))), current_setting('test.b0')::bigint, 'setJobStatus') $$,
  'BOM_STALE', 'a job changed by someone else after the base version is stale');
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"in_progress"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus')
  -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'from the current base the same change succeeds');

-- ปิดงาน PK แล้วปิดใบ ----------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"completed"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'completeOrder') $$,
  'BOM_INVALID_TRANSITION', 'an order cannot be completed while a PK job is not done');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-PK'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'done', 'qtyDone', 100, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 100, 'reject', 0, 'note', ''))))))
  , (public.app_bom_master() ->> 'version')::bigint, 'reportJob')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'PK staff finish the PK job');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ? 'doneAt', 'the finish time is set by the server');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-PK'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"queued"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus') $$,
  'BOM_INVALID_TRANSITION', 'a finished job cannot be changed by department staff');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_INVALID_TRANSITION', 'an order with a linked work order cannot be cancelled');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"draft","items":[{"fgCode":"FG-A","qty":1,"colorSet":"A","note":""}]}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'an order with started jobs cannot be reopened for editing');
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"completed"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'completeOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'the planner completes the order once PK is done');
select ok(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'completedAt', 'the completion time is set');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25001'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"note":"แก้หลังปิด"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'completeOrder') $$,
  'BOM_INVALID_TRANSITION', 'a completed order cannot change');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_INVALID_TRANSITION', 'a completed order cannot be cancelled');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'a completed order cannot go back');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-1-GR'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"dueAt":1765100000000}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_INVALID_TRANSITION', 'jobs of a completed order cannot change');

-- 8. เปิดใบกลับมาแก้ (ไม่มีงานเริ่ม) / ยกเลิก ----------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251106-25002', 'items', '[{"fgCode":"FG-A","qty":5,"colorSet":"A","note":""}]'::jsonb,
                                                           'explosion', current_setting('test.expl')::jsonb, 'stockCounts', '{"SE-A":7}'::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25002'), true);
select is(current_setting('test.o')::jsonb -> 'stockCounts', '{"SE-A":7}'::jsonb, 'the counts sent with the draft are kept');
select is((select jsonb_agg(o ->> 'id') from jsonb_array_elements(public.app_bom_master() -> 'orders') o), '["251106-25001","251106-25002"]'::jsonb,
  'orders of the same date are listed by number');
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-2-RB","orderId":"251106-25002","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2-PK","orderId":"251106-25002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25002'), true);
select set_config('test.b1', (public.app_bom_master() ->> 'version'), true);
select is(current_setting('test.o')::jsonb ->> 'status', 'released', 'the second order is released with two jobs');
select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || jsonb_build_object(
    'status', 'draft', 'revision', 77, 'explosion', null, 'explodedAt', null, 'items', '[{"fgCode":"FG-A","qty":8,"colorSet":"A","note":""}]'::jsonb))),
  'jobs', jsonb_build_object('delete', jsonb_build_array('JOB-2-RB', '{"id":"JOB-2-PK"}'::jsonb))),
  current_setting('test.b1')::bigint, 'updateOrderItem')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'draft', 'a released order without started jobs goes back to draft');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'revision', '1', 'the revision is the old one + 1 (the client value is ignored)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"SE-A":7}'::jsonb, 'the stock counts are kept');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'explosion', 'null'::jsonb, 'the explosion was cleared with the edit');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'items', '[{"fgCode":"FG-A","qty":8,"colorSet":"A","note":""}]'::jsonb, 'the new items are stored');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'releasedAt'), 'the release stamp is cleared');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'delete', '[{"id":"JOB-2-PK","code":"JOB-2-PK"},{"id":"JOB-2-RB","code":"JOB-2-RB"}]'::jsonb,
  'the jobs of the order are deleted (tombstones in the delta, also those the client listed)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert', '[]'::jsonb, 'no job upsert is left');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251106-25002'), 0, 'the snapshot has no job of the reopened order');
select is(public.app_bom_master_since(current_setting('test.b1')::bigint) -> 'changes' -> 'jobs' -> 'delete',
  '[{"id":"JOB-2-PK","code":"JOB-2-PK"},{"id":"JOB-2-RB","code":"JOB-2-RB"}]'::jsonb, 'a client that is behind learns about the deleted jobs from the delta');

-- ปล่อยใหม่ (id งานใหม่) แล้วยกเลิกจากสถานะ released: ลบงาน ไม่มีงานเริ่ม
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25002'), true);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || jsonb_build_object(
    'status', 'released', 'explosion', current_setting('test.expl')::jsonb))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-2B-RB","orderId":"251106-25002","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2B-PK","orderId":"251106-25002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select is((select o ->> 'revision' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25002'), '1',
  'releasing again keeps the new revision');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25002'), true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'an order with no started job can be cancelled');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'cancelReason', 'ลูกค้ายกเลิก', 'the reason is kept');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'delete'), 2, 'its jobs were deleted');

-- เปิดใบกลับมาแก้ไม่ได้ถ้ามีงานเริ่มแล้ว (แค่สถานะไม่ใช่ queued ก็นับ)
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251106-25003', 'items', '[{"fgCode":"FG-B","qty":5,"colorSet":"A","note":""}]'::jsonb,
                                                           'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25003'), true);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-3-RB","orderId":"251106-25003","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-3-PK","orderId":"251106-25003","dept":"PK","itemCode":"FG-B","kind":"FG","uom":"set","fgCodes":["FG-B"]}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-3-PK'), true);
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"hold"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setJobStatus')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'a job put on hold also starts the order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25003'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"draft"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'a job that is not queued counts as started and blocks reopening');
select throws_ok($$ select public.app_bom_save_master('{"jobs":{"delete":["JOB-3-PK"]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_INVALID_TRANSITION', 'a started job cannot be deleted directly');
select is(public.app_bom_save_master('{"jobs":{"delete":["JOB-3-RB"]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder')
  -> 'changes' -> 'jobs' -> 'delete', '[{"id":"JOB-3-RB","code":"JOB-3-RB"}]'::jsonb, 'a queued job can be deleted directly by a planner');
select throws_ok($$ select public.app_bom_save_master('{"jobs":{"delete":["JOB-3-RB"]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_NOT_FOUND', 'deleting a job that is already gone from the current base is not found');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('delete', jsonb_build_array(1))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_INVALID_JOB', 'a job key must be text');

-- 9. เลข PI ซ้ำ / ชนรายระเบียน ------------------------------------------------------------------
select set_config('test.b2', (public.app_bom_master() ->> 'version'), true);
select is(public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25009"}'::jsonb))), current_setting('test.b2')::bigint, 'createOrder')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'id', '251106-25009', 'the first planner takes PI 251106-25009');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25009","customer":"อีกคน"}'::jsonb))), current_setting('test.b2')::bigint, 'createOrder') $$,
  'BOM_STALE', 'a second planner creating the same PI number from the same base is stale (retry gets the next number)');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25009x"}'::jsonb, current_setting('test.ord')::jsonb || '{"id":"251106-25009X"}'::jsonb))),
  current_setting('test.b2')::bigint, 'createOrder') $$,
  'BOM_INVALID_ORDER', 'the PI number is case-insensitive inside one call');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'customer' = 'อีกคน'), 0, 'the stale call wrote nothing');
select is(public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || '{"id":"251106-25010","orderedAt":1762473600000}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'createOrder')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'id', '251106-25010', 'from the current base the next number is accepted (a department manager is a planner)');
select is(public.app_bom_master() -> 'orders' -> 0 ->> 'id', '251106-25010', 'the latest order date is listed first');

-- 9b. สำเนาเก่าของ client ต้องได้ BOM_STALE (ชนก่อนสิทธิ์) ไม่ใช่ BOM_FORBIDDEN ---------------------------------------
-- (c) ST นับคงคลังใบ draft จากสำเนาเก่า ขณะที่ฝ่ายวางแผนแก้รายการสินค้าไปแล้ว
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251106-25011', 'customer', ' Spaced    Name', 'items', '[{"fgCode":"FG-A","qty":5,"colorSet":"A","note":""}]'::jsonb,
                                                           'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25011'), true);
select is(current_setting('test.o')::jsonb ->> 'customer', 'Spaced Name', 'the customer name stored on the order is collapsed like the customer table (the client key uses the same rule)');
select set_config('test.bc', (public.app_bom_master() ->> 'version'), true);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"items":[{"fgCode":"FG-A","qty":6,"colorSet":"A","note":""}]}'::jsonb))), current_setting('test.bc')::bigint, 'updateOrderItem');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":3}}'::jsonb))), current_setting('test.bc')::bigint, 'setStockCounts') $$,
  'BOM_STALE', 'ST counting a draft from a copy whose items a planner changed since is stale, not forbidden');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25011'), true);
select is(public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"stockCounts":{"SE-A":3}}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'setStockCounts')
  -> 'changes' -> 'orders' -> 'upsert' -> 0 -> 'stockCounts', '{"SE-A":3}'::jsonb, 'after catching up the same count is accepted');

-- (a) พนักงานสองคนของแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน: คนที่สองได้ BOM_STALE
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25011'), true);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-4-GR","orderId":"251106-25011","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-4-PK","orderId":"251106-25011","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-4-GR'), true);
select set_config('test.b4', (public.app_bom_master() ->> 'version'), true);
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 2, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 2, 'reject', 0, 'note', 'คนแรก')))))), current_setting('test.b4')::bigint, 'reportJob')
  -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '2', 'the first GR report from the base is accepted');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 3, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 3, 'reject', 0, 'note', 'อีกเครื่องของคนเดิม')))))), current_setting('test.b4')::bigint, 'reportJob') $$,
  'BOM_STALE', 'the same staff member reporting again from a stale copy (another tab) is stale');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 3, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 3, 'reject', 0, 'note', 'คนที่สอง')))))), current_setting('test.b4')::bigint, 'reportJob') $$,
  'BOM_STALE', 'a second report on the same job from the same base is stale, not forbidden');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"status":"hold"}'::jsonb))), current_setting('test.b4')::bigint, 'setJobStatus') $$,
  'BOM_STALE', 'a stale copy that reports nothing is stale too');
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-4-GR'), true);
select is(public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('qtyDone', 5, 'reports', (current_setting('test.j')::jsonb -> 'reports')
    || '[{"at":1,"by":"x","good":3,"reject":0,"note":"คนที่สอง"}]'::jsonb)))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob')
  -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '5', 'after catching up the second report is accepted');

-- ฝ่ายวางแผนแก้งาน (วันครบกำหนด/จำนวนแผน) ขณะที่พนักงานแผนกรายงานจากสำเนาเก่า
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-4-GR'), true);
select set_config('test.b4b', (public.app_bom_master() ->> 'version'), true);
select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || '{"dueAt":1765100000000,"qtyPlanned":90}'::jsonb))), current_setting('test.b4b')::bigint, 'reportJob');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('qtyDone', 6, 'reports', (current_setting('test.j')::jsonb -> 'reports')
    || '[{"at":1,"by":"x","good":1,"reject":0,"note":""}]'::jsonb)))), current_setting('test.b4b')::bigint, 'reportJob') $$,
  'BOM_STALE', 'a report on a copy whose due date and quantity a planner changed since is stale, not forbidden');

-- (b) พนักงานรายงานงานที่ถูกลบไปแล้วเพราะฝ่ายวางแผนเปิดใบกลับมาแก้หลังฐานของเขา
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251106-25012', 'items', '[{"fgCode":"FG-A","qty":5,"colorSet":"A","note":""}]'::jsonb,
                                                           'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25012'), true);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-5-GR","orderId":"251106-25012","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-5-PK","orderId":"251106-25012","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251106-25012'), true);
select set_config('test.j', (select j::text from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-5-GR'), true);
select set_config('test.b5', (public.app_bom_master() ->> 'version'), true);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"draft"}'::jsonb))), current_setting('test.b5')::bigint, 'updateOrderItem');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251106-25012'), 0, 'the planner reopened the order and its jobs are gone');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 2, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 2, 'reject', 0, 'note', '')))))), current_setting('test.b5')::bigint, 'reportJob') $$,
  'BOM_STALE', 'a report on a job that a reopen deleted after the base is stale, not forbidden');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.j')::jsonb || jsonb_build_object('status', 'in_progress', 'qtyDone', 2, 'reports',
    jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 2, 'reject', 0, 'note', '')))))), (public.app_bom_master() ->> 'version')::bigint, 'reportJob') $$,
  'BOM_FORBIDDEN', 'from the current base the same missing job is a plain refusal (staff cannot create jobs)');

-- 10. audit ----------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  (select jsonb_agg(jsonb_build_object('action', 'x', 'detail', 'y')) from generate_series(1, 21))) $$, 'BOM_INVALID_PAYLOAD', 'more than 20 audit entries are rejected');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  '[{"detail":"y"}]'::jsonb) $$, 'BOM_INVALID_PAYLOAD', 'an audit entry needs an action');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  jsonb_build_array(jsonb_build_object('action', repeat('ก', 81), 'detail', ''))) $$, 'BOM_INVALID_PAYLOAD', 'an audit action longer than 80 characters is rejected');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  jsonb_build_array(jsonb_build_object('action', 'x', 'detail', repeat('ก', 301)))) $$, 'BOM_INVALID_PAYLOAD', 'an audit detail longer than 300 characters is rejected');
select throws_ok($$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  '{"action":"x"}'::jsonb) $$, 'BOM_INVALID_PAYLOAD', 'the audit argument must be an array');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'customers') c where c ->> 'name' = 'B'), 0, 'a rejected audit argument writes nothing');
select public.app_bom_save_master('{"customers":{"upsert":[{"name":"B","country":"JP","orderType":"EX"}]}}'::jsonb, (public.app_bom_master() ->> 'version')::bigint, 'saveCustomer',
  '[{"action":"บันทึกลูกค้า","detail":"B"},{"action":"บันทึกลูกค้า","detail":"B JP"}]'::jsonb);
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select is(public.app_bom_audit(1), jsonb_build_array(
  jsonb_build_object('at', public.app_bom_audit(1) -> 0 -> 'at', 'user', current_setting('test.n_sbx_pp_staff'), 'action', 'saveCustomer', 'detail', 'customers +1',
                     'entries', '[{"action":"บันทึกลูกค้า","detail":"B"},{"action":"บันทึกลูกค้า","detail":"B JP"}]'::jsonb)),
  'any persona reads the audit: the action and the counts are what the server recorded, the client text is kept apart as entries');
select is(jsonb_array_length(public.app_bom_audit(0)), 1, 'a limit below 1 is clamped to 1');
select ok(jsonb_array_length(public.app_bom_audit()) > 10, 'the default limit returns the history');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a
                  where a ->> 'action' = 'releaseOrder' and a ->> 'detail' = 'jobs +3, orders +1'
                    and a -> 'entries' = '[{"action":"ปล่อยผลิต","detail":"251106-25001 สร้างงาน 3 รายการ"}]'::jsonb),
  'a release shows the server-recorded counts as the line and the client text only as an entry');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'importFlat' and a ->> 'detail' = 'items +5' and a -> 'entries' = '[]'::jsonb),
  'a save without client entries shows its action name and counts');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'setJobStatus' and a ->> 'detail' like 'jobs +1%'),
  'job saves are listed with their counts');
reset role;
select is((select jsonb_array_length(metadata -> 'entries') from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' = 'saveCustomer'
           order by id desc limit 1), 2, 'one audit_logs row per save holds all the client entries');
select ok(not exists (select 1 from public.audit_logs where action = 'BOM_MASTER_SAVE' and actor_id <> '8e000000-0000-0000-0000-000000000101'),
  'the actor of every audit row is the real admin behind the persona');
select ok((select count(*) from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'persona_name' is null) = 0, 'every audit row names the persona');
set local role authenticated;

-- 11. ตารางเป็นแบบแยกโหมด: นับด้วยบทบาทของเทสต์ --------------------------------------------------
reset role;
select is((select count(*) from public.bom_orders where is_test), 7::bigint, 'seven test orders exist (25001, 25002, 25003, 25009, 25010, 25011, 25012)');
select is((select count(*) from public.bom_orders where not is_test), 1::bigint, 'the real order is untouched');
select is((select count(*) from public.bom_jobs where not is_test), 1::bigint, 'the real job is untouched');
select is((select count(*) from public.bom_deleted_keys where is_test and list = 'jobs'), 7::bigint, 'seven job tombstones: JOB-2-RB/PK (reopen), JOB-2B-RB/PK (cancel), JOB-3-RB (direct delete), JOB-5-GR/PK (reopen)');
select ok((select bool_and(changed_version > 0) from public.bom_orders where is_test) and (select bool_and(changed_version > 0) from public.bom_jobs where is_test),
  'every test order and job is stamped with the version that changed it');
set local role authenticated;

-- 12. purge ----------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8e000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_bom()', 'NOT_AUTHORIZED', 'a non-admin still cannot purge');
select set_config('request.jwt.claims', '{"sub":"8e000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the sandbox');
select throws_ok('select public.app_sandbox_purge_bom()', 'SANDBOX_NOT_ACTIVE', 'the purge works only inside the test mode');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.pre_version', (public.app_bom_master() ->> 'version'), true);
select set_config('test.pre_epoch', (public.app_bom_master() ->> 'epoch'), true);
select ok(current_setting('test.pre_version')::bigint > 10, 'the counter is well above zero before the purge');
select set_config('test.purge', public.app_sandbox_purge_bom()::text, true);
select ok((current_setting('test.purge')::jsonb ->> 'deleted')::integer > 15, 'the purge reports the deleted rows');
select is(public.app_bom_master() - 'epoch',
  jsonb_build_object('version', current_setting('test.pre_version')::bigint, 'items', '[]'::jsonb, 'compounds', '[]'::jsonb, 'colors', '[]'::jsonb, 'colorSets', '[]'::jsonb,
                     'packages', '[]'::jsonb, 'boms', '[]'::jsonb, 'processes', '[]'::jsonb, 'routings', '[]'::jsonb, 'customers', '[]'::jsonb, 'orders', '[]'::jsonb, 'jobs', '[]'::jsonb),
  'the test master is empty again and the counter keeps its value (it never goes back)');
select isnt(public.app_bom_master() ->> 'epoch', current_setting('test.pre_epoch'), 'the purge changed the epoch');
select is(public.app_bom_master_since(current_setting('test.pre_version')::bigint) ->> 'epoch', public.app_bom_master() ->> 'epoch',
  'a client that is only behind by version sees the new epoch in the delta (and reloads)');
select throws_ok(format('select public.app_bom_master_since(%s)', current_setting('test.pre_version')::bigint + 1), 'BOM_INVALID_PAYLOAD',
  'a version above the counter is still refused');
select throws_ok(format($f$ select public.app_bom_save_master('{"customers":{"upsert":[{"name":"ก่อนล้าง"}]}}'::jsonb, %s, 'saveCustomer', '[]'::jsonb, %L) $f$,
  current_setting('test.pre_version')::bigint, current_setting('test.pre_epoch')), 'BOM_RESET', 'a save that still holds the epoch from before the purge is refused');
select is(public.app_bom_audit(1) -> 0 ->> 'action', 'ล้างข้อมูล BOM ทดสอบ', 'the purge is the newest history entry (earlier history is kept)');
select is(public.app_bom_audit(1) -> 0 ->> 'detail', 'ลบ ' || (current_setting('test.purge')::jsonb ->> 'deleted') || ' แถว', 'the purge entry is written by the server');
select ok(jsonb_array_length(public.app_bom_audit()) > 10, 'the history before the purge is kept');
reset role;
select is((select count(*) from public.bom_items where is_test), 0::bigint, 'no test item is left');
select is((select count(*) from public.bom_orders where is_test) + (select count(*) from public.bom_jobs where is_test)
          + (select count(*) from public.bom_customers where is_test) + (select count(*) from public.bom_deleted_keys where is_test)
          + (select count(*) from public.bom_boms where is_test), 0::bigint, 'no test order, job, customer, tombstone or BOM is left');
select is((select version from public.bom_master_state where is_test), current_setting('test.pre_version')::bigint, 'the test counter row keeps its version');
select isnt((select epoch::text from public.bom_master_state where is_test), current_setting('test.pre_epoch'), 'the test counter row has a new epoch');
select isnt((select epoch from public.bom_master_state where not is_test), (select epoch from public.bom_master_state where is_test), 'the real counter row has its own epoch');
select is((select version from public.bom_master_state where not is_test), 99::bigint, 'the real counter row is untouched');
select is((select count(*) from public.bom_items where not is_test), 1::bigint, 'the real item is untouched');
select is((select count(*) from public.bom_orders where not is_test) + (select count(*) from public.bom_jobs where not is_test)
          + (select count(*) from public.bom_customers where not is_test), 3::bigint, 'the real order, job and customer are untouched');
select is((select count(*) from public.audit_logs where action = 'BOM_SANDBOX_PURGE' and actor_id = '8e000000-0000-0000-0000-000000000101'), 1::bigint,
  'the purge is audited with the real admin as the actor');
set local role authenticated;
select is(public.app_bom_save_master('{"customers":{"upsert":[{"name":"หลังล้าง"}]}}'::jsonb, current_setting('test.pre_version')::bigint, 'saveCustomer', '[]'::jsonb,
  public.app_bom_master() ->> 'epoch') ->> 'version', (current_setting('test.pre_version')::bigint + 1)::text,
  'saving works again after the purge, with the new epoch, and the counter goes on from where it was');
select is(public.app_bom_master_since(current_setting('test.pre_version')::bigint) -> 'changes' -> 'customers' -> 'upsert' -> 0 ->> 'name', 'หลังล้าง',
  'a row created after the purge is newer than any version a client could have held before it');

select * from finish();
rollback;
