-- สต็อกของซื้อ (ชิ้นส่วน PURCHASED ของ BOM) + ST เบิกจ่ายของซื้อรายใบ PI + บรรทัดของซื้อในใบสั่งซื้อ (20261111010000_bom_part_stock.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง/สิทธิ์ตารางใหม่, นับสต็อก (ST / WH / กลุ่มวางแผน / สมาชิก RB / QA), สต็อกขั้นต่ำเฉพาะกลุ่มวางแผน, รหัสที่ไม่ใช่ของซื้อ, ชนรายระเบียนก่อนสิทธิ์,
-- งานของซื้อรายงานผ่านทางอื่นไม่ได้, issueOrderParts (สิทธิ์ ชุดงานไม่ครบ สต็อกไม่พอ = ไม่จ่ายเลย ชนรายระเบียน จ่ายสำเร็จ จ่ายซ้ำ), ใบสั่งซื้อที่มีบรรทัดของซื้อ (สร้าง/แก้สต็อกขั้นต่ำ/รับเข้า/ปฏิเสธ),
-- snapshot / delta 13 ชุด และล้างข้อมูลทดสอบ · authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role (สิทธิ์เจ้าของตาราง) เท่านั้น
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") ตรวจฝั่ง client ผ่าน RPC และตรวจ deny ด้วย throws_ok เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ของตารางใหม่ ------------------------------------------------------------
create temp table ps_tables(name text) on commit drop;
insert into ps_tables values ('bom_stock'), ('bom_stock_moves');

select is((select count(*) from ps_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  2::bigint, 'the stock tables have RLS enabled');
select ok(not exists (
    select 1 from ps_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on the stock tables');
select ok(not exists (
    select 1 from ps_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass and p.polname = t.name || '_no_direct_access')),
  'the stock tables have the deny-all policy');
select ok(not exists (
    select 1 from ps_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'the stock tables have the restrictive lab_only_no_access policy');
select ok(not exists (
    select 1 from ps_tables t
    where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)
       or not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass and g.tgname = t.name || '_stamp_version' and not g.tgisinternal)),
  'the stock tables enforce sandbox scope and stamp changed_version by trigger');
select ok(not exists (select 1 from ps_tables t where not (t.name = any (private.sandbox_unguarded_tables()))),
  'the stock tables are registered as sandbox aware');
select ok('bom_jobs' = any (private.sandbox_unguarded_tables()) and 'rf_purchase_orders' = any (private.sandbox_unguarded_tables())
          and 'ncr_reports' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier BOM, RubberFlow and NCR tables');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname in ('bom_stock_changed_idx', 'bom_stock_moves_changed_idx')
           and indexdef like '%(is_test, changed_version)%'),
  2::bigint, 'the stock tables are indexed by (is_test, changed_version)');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_stock'::regclass and c.contype = 'u'
                  and pg_get_constraintdef(c.oid) = 'UNIQUE (item_code, is_test)'),
  'a part has one stock row per mode');
select ok(array['countPartStock', 'issueOrderParts', 'setStockCounts', 'reportJob'] <@ private.bom_client_actions()
          and array['countPartStock', 'issueOrderParts', 'setStockCounts', 'reportJob'] <@ private.bom_staff_actions(),
  'both new actions are on the client and staff whitelists next to the earlier ones');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_sandbox_purge_bom()',
                                                  'public.app_rf_save(jsonb,bigint,text,jsonb,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs keep their grants (signed-in users only)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_save_stock(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_issue_parts(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_lock_bom_state()'::regprocedure,
                           'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'private.rf_save_purchase_orders(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure,
                           'public.app_sandbox_purge_bom()'::regprocedure)),
  'the new writers and the replaced functions are security definer with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'bom_save_jobs' and p.pronargs = 7),
  'the old seven-argument job writer is gone (the new one takes the action name)');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and (p.proname like 'bom\_%' or p.proname like 'rf\_%')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private BOM or RubberFlow helper (the stock writers included)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('bom_stock_moves' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0,
  'the BOM purge deletes the stock tables and still sets the JWT claims aside');

-- ข้อจำกัดของตาราง (ใส่ตรงด้วยสิทธิ์เจ้าของตาราง ต้องถูกปฏิเสธ)
select throws_ok($$ insert into public.bom_stock (is_test, item_code, qty) values (true, 'CK-1', -1) $$, '23514', null, 'a negative balance is refused by the table');
select throws_ok($$ insert into public.bom_stock (is_test, item_code, qty) values (true, 'CK-1', 1000000001) $$, '23514', null, 'a balance above 1e9 is refused by the table');
select throws_ok($$ insert into public.bom_stock (is_test, item_code, safety_qty) values (true, 'CK-1', -1) $$, '23514', null, 'a negative safety quantity is refused by the table');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance) values (true, 'CK-1', 'count', 0, 0) $$, '23514', null, 'a move of zero is refused by the table');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance) values (true, 'CK-1', 'bogus', 1, 1) $$, '23514', null, 'an unknown move kind is refused by the table');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance) values (true, 'CK-1', 'issue', -5, -1) $$, '23514', null, 'a negative balance after a move is refused by the table');
select throws_ok($$ insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref) values (true, 'CK-1', 'issue', -1, 0, '') $$, '23514', null, 'an empty reference is refused (null means none)');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8e100000-0000-0000-0000-000000000001', 'bomps-admin@test.local', '{}'),
  ('8e100000-0000-0000-0000-000000000002', 'bomps-staff@test.local', '{}'),
  ('8e100000-0000-0000-0000-000000000003', 'mnplab001-bomps@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e100000-0000-0000-0000-000000000101', 'BOMPS-ADMIN', 'Bomps', 'Admin', 'bomps-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e100000-0000-0000-0000-000000000001'),
  ('8e100000-0000-0000-0000-000000000102', 'BOMPS-STAFF-REAL', 'Bomps', 'Staff', 'bomps-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8e100000-0000-0000-0000-000000000002'),
  ('8e100000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-bomps@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8e100000-0000-0000-0000-000000000003');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id
           where e.is_test and ((e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST') or (e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA') or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR'))) = 6,
  'the personas used below belong to the departments the rules name');

-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็นและ purge ไม่แตะ
insert into public.bom_items (code, kind, name, owner_dept, uom) values ('REAL-PART', 'PURCHASED', 'ชิ้นส่วนจริง', 'ST', 'pcs');
insert into public.bom_stock (item_code, qty) values ('REAL-PART', 7);
insert into public.bom_stock_moves (item_code, kind, qty, balance) values ('REAL-PART', 'count', 7, 7);
select is((select count(*) from public.bom_stock where not is_test), 1::bigint, 'the real stock row was inserted as a real (non-test) row');

-- ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น
create schema ps_t;
grant usage on schema ps_t to authenticated;
create function ps_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function ps_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function ps_t.save(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, coalesce(p_base, ps_t.ver()), p_action)
$$;
create function ps_t.count_stock(p_rows jsonb, p_base bigint default null, p_action text default 'countPartStock') returns jsonb language sql volatile as $$
  select ps_t.save(jsonb_build_object('stock', jsonb_build_object('upsert', p_rows)), p_action, p_base)
$$;
create function ps_t.stock(p_code text) returns jsonb language sql stable as $$
  select s from jsonb_array_elements(public.app_bom_master() -> 'stock') s where s ->> 'itemCode' = p_code
$$;
create function ps_t.qty(p_code text) returns numeric language sql stable as $$ select (ps_t.stock(p_code) ->> 'qty')::numeric $$;
create function ps_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function ps_t.order_status(p_no text) returns text language sql stable as $$
  select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
-- งานที่ client ส่งเมื่อ ST กดเบิกจ่าย: สำเนาจาก snapshot ที่เป็น done และ qtyDone = qtyPlanned
create function ps_t.done(p_no text) returns jsonb language sql stable as $$
  select ps_t.job(p_no) || jsonb_build_object('status', 'done', 'qtyDone', (ps_t.job(p_no) ->> 'qtyPlanned')::numeric)
$$;
create function ps_t.issue(p_jobs jsonb, p_base bigint default null) returns jsonb language sql volatile as $$
  select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', p_jobs)), 'issueOrderParts', p_base)
$$;
create function ps_t.move_count(p_code text) returns integer language sql stable as $$
  select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m where m ->> 'itemCode' = p_code
$$;
create function ps_t.has_move(p_code text, p_kind text, p_qty numeric, p_balance numeric, p_ref text, p_by text) returns boolean language sql stable as $$
  select exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m
                 where m ->> 'itemCode' = p_code and m ->> 'kind' = p_kind and (m ->> 'qty')::numeric = p_qty and (m ->> 'balance')::numeric = p_balance
                   and (m ->> 'ref') is not distinct from p_ref and m ->> 'by' = p_by)
$$;
create function ps_t.po_save(p_po jsonb, p_action text default 'createPurchaseOrder', p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(p_po))), coalesce(p_base, ps_t.rver()), p_action)
$$;
create function ps_t.po(p_no text) returns jsonb language sql stable as $$
  select p from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_no
$$;
-- สำเนาใบที่ทำเครื่องหมายว่าบรรทัด p_idx รับเข้าแล้ว (p_line ทับช่องของบรรทัด)
create function ps_t.receipt(p_no text, p_idx integer, p_kg numeric, p_line jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select p || jsonb_build_object('lines', jsonb_set(p -> 'lines', array[p_idx::text], (p -> 'lines' -> p_idx) || jsonb_build_object('receivedKg', p_kg) || p_line))
  from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_no
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"ST":1763000000000,"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"ST","itemCode":"P-1","name":"กล่อง","kind":"PURCHASED","uom":"box","qtyPlanned":30,"qtyRequired":30,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"P-1","level":1,"fgQty":10,"required":30},{"itemCode":"P-2","level":1,"fgQty":10,"required":12.5}]', true);
select set_config('test.mat', '{"code":"MAT-A","name":"ยาง EPDM","category":"เคมี","storage":"โกดัง A-1","uom":"kg","active":true}', true);
select set_config('test.po', '{"id":"PO-20261111-01","status":"ordered","sourcePi":"251111-25001","sourceRequisition":null,"note":"สั่งเคมีกับของซื้อ","lines":[{"materialCode":"MAT-A","needKg":100,"availableKg":20,"shortageKg":80,"safetyKg":60,"qtyKg":140},{"materialCode":"P-1","source":"bom","uom":"ignored","needKg":30,"availableKg":-10,"shortageKg":40,"safetyKg":20,"qtyKg":55},{"materialCode":"p-2","source":"bom","needKg":12.5,"availableKg":27.5,"shortageKg":0,"safetyKg":0,"qtyKg":5}]}', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"stock":{"upsert":[]}}'::jsonb, 0, 'countPartStock') $$, 'AUTH_REQUIRED', 'counting requires a session');
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"stock":{"upsert":[{"itemCode":"P-1","qty":1}]}}'::jsonb, 0, 'countPartStock') $$, 'BOM_TEST_MODE_ONLY',
  'a real PP staff account cannot count stock (real mode is not open)');
select throws_ok('select count(*) from public.bom_stock', '42501', null, 'clients cannot read the stock table directly');
select throws_ok('select count(*) from public.bom_stock_moves', '42501', null, 'clients cannot read the move table directly');
select throws_ok($$ insert into public.bom_stock (item_code, qty) values ('P-1', 1) $$, '42501', null, 'clients cannot write the stock table directly');
select throws_ok($$ insert into public.bom_stock_moves (item_code, kind, qty, balance) values ('P-1', 'count', 1, 1) $$, '42501', null, 'clients cannot write the move table directly');
select throws_ok($$ update public.bom_stock set qty = 99 $$, '42501', null, 'clients cannot update the stock table directly');
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"stock":{"upsert":[]}}'::jsonb, 0, 'countPartStock') $$, 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot count stock');
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_bom_save_master('{"stock":{"upsert":[{"itemCode":"P-1","qty":1}]}}'::jsonb, 0, 'countPartStock') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot count stock');

-- 4. ข้อมูลตั้งต้น (PP staff): ชิ้นงาน ใบสั่งผลิตที่ปล่อยแล้วพร้อมงานของซื้อ ---------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_master() -> 'stock', '[]'::jsonb, 'the stock list starts empty and never shows the real row');
select is(public.app_bom_master() -> 'stockMoves', '[]'::jsonb, 'the move list starts empty and never shows the real move');
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 13::bigint, 'the snapshot has thirteen lists');
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"},
  {"code":"P-2","kind":"PURCHASED","name":"เม็ดสี","ownerDept":"ST","uom":"kg"},
  {"code":"P-3","kind":"PURCHASED","name":"เทปกาว","ownerDept":"ST","uom":"roll"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1',
  'the planner seeds the item master');
select set_config('test.res', ps_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251111-25001"}'::jsonb))), 'createOrder')::text, true);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25001'), true);
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))), 'explodeOrder') is not null,
  'the planner adds the product and the explosion to the draft');
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25001'), true);
select set_config('test.res', ps_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-ST-P1","orderId":"251111-25001","itemCode":"P-1"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-ST-P2","orderId":"251111-25001","itemCode":"P-2","name":"เม็ดสี","uom":"kg","qtyPlanned":12.5,"qtyRequired":12.5}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-PK-A","orderId":"251111-25001","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10}'::jsonb))),
  'releaseOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the planner releases the order with two purchased-part jobs');
select is((select jsonb_agg(j ->> 'id' order by j ->> 'id') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'dept' = 'ST'), '["JOB-ST-P1","JOB-ST-P2"]'::jsonb,
  'the part jobs belong to the ST department');
select set_config('test.v0', ps_t.ver()::text, true);

-- 5. นับสต็อกของซื้อ (countPartStock) ------------------------------------------------------------
-- 5.1 ปฏิเสธ: สมาชิก RB / QA นับไม่ได้ · รูปข้อมูลผิด · รหัสที่ไม่ใช่ของซื้อ
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":100}]'::jsonb) $$, 'BOM_FORBIDDEN', 'RB staff cannot count part stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":100}]'::jsonb) $$, 'BOM_FORBIDDEN', 'QA staff cannot count part stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"SE-A","qty":5}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a made item (not a purchased part) cannot be counted here');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"NOPE","qty":5}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'an unknown item cannot be counted');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"REAL-PART","qty":5}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a real-mode item is invisible to the test mode');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":-1}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a negative count is refused');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":1000000001}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a count above 1e9 is refused');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":"5"}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a count must be a number');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":5},{"itemCode":"p-1","qty":6}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'the same item twice in one save is refused');
select throws_ok($$ select ps_t.count_stock('[{"qty":5}]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a row without an item code is refused');
select throws_ok($$ select ps_t.count_stock('["P-1"]'::jsonb) $$, 'BOM_INVALID_STOCK', 'a row must be an object');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":5}]'::jsonb, null, 'setStockCounts') $$, 'BOM_INVALID_PAYLOAD', 'the stock list can only be sent with countPartStock');
select throws_ok($$ select ps_t.save('{"stock":{"delete":[]}}'::jsonb, 'countPartStock') $$, 'BOM_INVALID_PAYLOAD', 'stock rows cannot be deleted');
select throws_ok($$ select ps_t.save(jsonb_build_object('stock', jsonb_build_object('upsert', '[{"itemCode":"P-1","qty":5}]'::jsonb),
  'customers', jsonb_build_object('upsert', '[{"name":"ZED"}]'::jsonb)), 'countPartStock') $$, 'BOM_INVALID_PAYLOAD', 'a count cannot carry another list');
select is(ps_t.ver(), current_setting('test.v0')::bigint, 'nothing was written by the refused calls');

-- 5.2 ST นับ: ยอดตั้งต้นของสองรายการ เซิร์ฟเวอร์ตั้งผู้นับ/เวลา/ประวัติ
select set_config('test.res', ps_t.count_stock('[{"itemCode":"P-1","qty":100,"countedBy":"ใครก็ได้","countedAt":1},{"itemCode":"P-2","qty":40}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v0')::bigint + 1)::text, 'ST counts two parts in one save and the counter moves once');
select is((select jsonb_agg(s ->> 'itemCode') from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'stock' -> 'upsert') s), '["P-1","P-2"]'::jsonb, 'the reply lists both stock rows by code');
select is(ps_t.stock('P-1') ->> 'qty', '100', 'the balance is the counted quantity');
select is(ps_t.stock('P-1') ->> 'safetyQty', '0', 'a new stock row starts with safety stock 0');
select is(ps_t.stock('P-1') ->> 'countedBy', current_setting('test.n_sbx_st_staff'), 'the counter is the persona (the client value is ignored)');
select ok((ps_t.stock('P-1') ->> 'countedAt')::numeric > 1000, 'the count time is set by the server');
select ok(ps_t.has_move('P-1', 'count', 100, 100, null, current_setting('test.n_sbx_st_staff')) and ps_t.move_count('P-1') = 1,
  'the count wrote one move with the change and the balance after it');

-- 5.3 ไม่ทำอะไรเมื่อค่าเท่าที่เก็บ · WH นับซ้ำได้ (ประวัติรายการที่สอง)
select is(jsonb_array_length(ps_t.count_stock('[{"itemCode":"P-1","qty":100,"safetyQty":0}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert'), 0, 'counting the same value again changes no row (the counter still moves like any BOM save)');
select is(ps_t.move_count('P-1'), 1, 'and writes no move');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.v_old', ps_t.ver()::text, true);
select is(ps_t.count_stock('[{"itemCode":"P-1","qty":120}]'::jsonb) ->> 'version', (current_setting('test.v_old')::bigint + 1)::text, 'WH staff recounts the part');
select ok(ps_t.has_move('P-1', 'count', 20, 120, null, current_setting('test.n_sbx_wh_staff')),
  'the second count wrote the difference (+20) and the new balance');

-- 5.4 สต็อกขั้นต่ำเฉพาะกลุ่มวางแผน · ชนรายระเบียนก่อนสิทธิ์
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'ST staff cannot change the safety stock');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-3","qty":1,"safetyQty":2}]'::jsonb) $$, 'BOM_FORBIDDEN', 'a count with a safety change is refused as a whole for ST staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":50}]'::jsonb, current_setting('test.v_old')::bigint) $$, 'BOM_STALE',
  'the stale check comes before the permission check (an RB member holding an old copy gets BOM_STALE)');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":50}]'::jsonb) $$, 'BOM_FORBIDDEN', 'with a current copy the same RB member is simply not allowed');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'safetyQty', '15', 'the planner sets the safety stock');
select is(ps_t.move_count('P-1'), 2, 'a safety change alone writes no move');
select is(ps_t.count_stock('[{"itemCode":"P-3","qty":8,"safetyQty":2}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'qty', '8', 'the planner counts and sets the safety stock of a part in one row');
select ok(ps_t.count_stock('[{"itemCode":"P-3","qty":0}]'::jsonb) is not null, 'a part can be counted down to zero');
select is(ps_t.qty('P-3'), 0::numeric, 'and the balance is zero afterwards');

-- 6. งานของซื้อรายงานผ่านทางอื่นไม่ได้ ------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB-ST-P1') || '{"status":"in_progress","qtyDone":5,"reports":[{"good":5,"reject":0,"note":""}]}'::jsonb))), 'reportJob') $$,
  'BOM_INVALID_TRANSITION', 'ST staff cannot report on a purchased-part job');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB-ST-P1') || '{"status":"hold"}'::jsonb))), 'setJobStatus') $$, 'BOM_INVALID_TRANSITION', 'nor change its status');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ps_t.done('JOB-ST-P1')))), 'reportJob') $$,
  'BOM_INVALID_TRANSITION', 'nor mark it done');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ps_t.done('JOB-ST-P1')))), 'releaseOrder') $$,
  'BOM_INVALID_TRANSITION', 'a planner cannot finish it with another action either');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB-ST-P1') || '{"qtyReject":2}'::jsonb))), 'reportJob') $$, 'BOM_INVALID_TRANSITION', 'nor record rejected quantity');
select is(ps_t.job('JOB-ST-P1') ->> 'status', 'queued', 'the job is still queued after the refused calls');

-- 7. เบิกจ่ายของซื้อ (issueOrderParts) -----------------------------------------------------------
-- 7.1 ปฏิเสธ: แผนกอื่น · ชุดงานไม่ครบ · สถานะ/ยอดไม่ตรง · action ปน
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_FORBIDDEN', 'RB staff cannot issue parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_FORBIDDEN', 'WH staff can count but cannot issue parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'))) $$, 'BOM_INVALID_JOB', 'a partial set of the order''s part jobs is refused');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-PK-A'))) $$, 'BOM_FORBIDDEN', 'a job of another department in the set is refused for ST staff');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.job('JOB-ST-P2') || '{"status":"in_progress","qtyDone":5}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'every row must be done');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2') || '{"qtyDone":10}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'every row must be done in full (qtyDone = qtyPlanned)');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'), ps_t.done('JOB-ST-P2'))) $$,
  'BOM_INVALID_JOB', 'the same job twice is refused');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))),
  'stock', jsonb_build_object('upsert', '[{"itemCode":"P-1","qty":999}]'::jsonb)), 'issueOrderParts') $$, 'BOM_INVALID_PAYLOAD', 'an issue cannot carry the stock list');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o')::jsonb))), 'issueOrderParts') $$, 'BOM_INVALID_PAYLOAD', 'nor an order');
select is(ps_t.qty('P-1'), 120::numeric, 'nothing was issued by the refused calls');

-- 7.2 สต็อกไม่พอ = ไม่จ่ายอะไรเลย (P-2 เหลือ 10 ต้องการ 12.5) · สต็อกเปลี่ยนหลังเวอร์ชันฐานของ client = ชน
select ok(ps_t.count_stock('[{"itemCode":"P-2","qty":10}]'::jsonb) is not null, 'ST counts the pigment down to 10');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_INSUFFICIENT_STOCK',
  'a shortage on one line refuses the whole issue');
select is(ps_t.qty('P-1'), 120::numeric, 'the line with enough stock was not issued either');
select is(ps_t.job('JOB-ST-P1') ->> 'status', 'queued', 'and its job is still queued');
select is(ps_t.order_status('251111-25001'), 'released', 'the order is still released');
select set_config('test.v_b', ps_t.ver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select ok(ps_t.count_stock('[{"itemCode":"P-2","qty":5}]'::jsonb) is not null, 'WH staff recounts the pigment to 5 after ST read it');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2')), current_setting('test.v_b')::bigint) $$, 'BOM_STALE',
  'a shortage seen from an old copy of the stock is a stale error (the client reloads and retries)');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_INSUFFICIENT_STOCK', 'with a current copy it is a real shortage');
select ok(ps_t.count_stock('[{"itemCode":"P-2","qty":40}]'::jsonb) is not null, 'ST receives the missing pigment (counts 40)');

-- 7.3 จ่ายสำเร็จ: หักสต็อก เขียนประวัติ ตั้งงานเป็น done ใบเป็น in_progress
select set_config('test.vi', ps_t.ver()::text, true);
select set_config('test.res', ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2')))::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.vi')::bigint + 1)::text, 'ST issues the parts of the order and the counter moves once');
select is(ps_t.job('JOB-ST-P1') ->> 'status', 'done', 'the first part job is done');
select is(ps_t.job('JOB-ST-P1') ->> 'qtyDone', '30', 'and issued in full');
select ok(ps_t.job('JOB-ST-P2') ? 'doneAt', 'the server set the done time of the second job');
select is(ps_t.qty('P-1'), 90::numeric, 'the stock of the first part dropped by its need');
select is(ps_t.qty('P-2'), 27.5::numeric, 'and the stock of the second part (a fraction) too');
select ok(ps_t.has_move('P-1', 'issue', -30, 90, '251111-25001', current_setting('test.n_sbx_st_staff')),
  'the issue move carries the negative quantity, the balance and the PI number');
select is(ps_t.order_status('251111-25001'), 'in_progress', 'the released order turned in_progress by the existing started-job rule');
select ok(exists (select 1 from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'stock' -> 'upsert') s where s ->> 'itemCode' = 'P-2' and (s ->> 'qty')::numeric = 27.5)
          and exists (select 1 from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'stockMoves' -> 'upsert') m where m ->> 'kind' = 'issue' and m ->> 'itemCode' = 'P-2'),
  'the reply carries the changed stock rows and the new moves');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'issueOrderParts' and a ->> 'user' = current_setting('test.n_sbx_st_staff')
                  and a ->> 'detail' like '%jobs +2%' and a ->> 'detail' like '%stock +2%'), 'the history records the issue with the jobs and the stock rows');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'countPartStock' and a ->> 'detail' like '%stock +%'), 'and the counts');

-- 7.4 จ่ายซ้ำ / จ่ายใบที่ไม่อยู่ในสถานะผลิต
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.job('JOB-ST-P1'), ps_t.job('JOB-ST-P2'))) $$, 'BOM_INVALID_JOB', 'an order that was already issued cannot be issued again');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB-ST-P1') || '{"status":"in_progress","qtyDone":5}'::jsonb))), 'reportJob') $$, 'BOM_INVALID_TRANSITION', 'a done part job cannot be reopened through the report path');
select is(ps_t.qty('P-1'), 90::numeric, 'nothing moved after the refused repeats');

-- 7.5 กลุ่มวางแผนเบิกจ่ายได้ (ใบที่สอง)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251111-25002"}'::jsonb))), 'createOrder')::text, true);
select set_config('test.o2', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25002'), true);
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o2')::jsonb || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":3,"colorSet":"A","note":""}]'::jsonb, 'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":3,"required":3},{"itemCode":"P-1","level":1,"fgQty":3,"required":9}]'::jsonb)))), 'explodeOrder') is not null,
  'a second order is exploded');
select set_config('test.o2', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25002'), true);
select ok(ps_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o2')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB2-ST-P1","orderId":"251111-25002","itemCode":"P-1","qtyPlanned":9,"qtyRequired":9}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB2-PK-A","orderId":"251111-25002","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":3,"qtyRequired":3}'::jsonb))),
  'releaseOrder') is not null, 'the second order is released with one part job');
select is(ps_t.issue(jsonb_build_array(ps_t.done('JOB2-ST-P1'))) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'a planner issues the parts of the second order');
select is(ps_t.qty('P-1'), 81::numeric, 'and the stock follows (90 - 9)');
select ok(ps_t.has_move('P-1', 'issue', -9, 81, '251111-25002', current_setting('test.n_sbx_pp_staff')), 'the move names the second PI');

-- 8. ใบสั่งซื้อที่มีบรรทัดของซื้อ ------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"safetyKg":60}'::jsonb))), 0, 'saveMaterial') ->> 'version', '1', 'the planner adds a chemical to order together with the parts');
-- 8.1 ปฏิเสธ
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"SE-A","source":"bom","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE',
  'a made item cannot be ordered as a part');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"NOPE","source":"bom","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'an unknown part is refused');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"REAL-PART","source":"bom","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE',
  'a real-mode part is invisible to the test mode');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"MAT-A","source":"bom","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'a chemical code is not a part');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"P-1","source":"xyz","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'an unknown line source is refused');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"P-1","source":"bom","qtyKg":5,"lotNo":"L-1"}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'a part line cannot carry a lot number');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"P-1","source":"bom","qtyKg":5,"receivedKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'a new order cannot carry receipt data on a part line');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"P-1","source":"bom","qtyKg":5},{"materialCode":"p-1","qtyKg":5}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'the same code twice is refused across sources');
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb || '{"lines":[{"materialCode":"P-1","source":"bom","qtyKg":0}]}'::jsonb) $$, 'RF_INVALID_PURCHASE', 'a zero part quantity is refused');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb) $$, 'RF_FORBIDDEN', 'ST staff cannot create a purchase order with parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(ps_t.rver(), 1::bigint, 'the RubberFlow counter did not move for the refused calls');

-- 8.2 สร้างสำเร็จ: เคมี + ของซื้อ 2 บรรทัด · สต็อกขั้นต่ำของ P-1 ถูก upsert ที่ BOM · เวอร์ชัน BOM เพิ่มหนึ่งครั้ง
select set_config('test.vb', ps_t.ver()::text, true);
select set_config('test.res', ps_t.po_save(current_setting('test.po')::jsonb)::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', '2', 'a planner creates an order that mixes a chemical and two parts (RubberFlow counter + 1)');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 0, '{"materialCode":"MAT-A","source":"rf","uom":null,"needKg":100,"availableKg":20,"shortageKg":80,"safetyKg":60,"qtyKg":140,"receivedKg":null,"lotNo":null,"expiry":null,"receivedAt":null,"receivedBy":null}'::jsonb,
  'the chemical line is stored with source rf and no unit');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 1, '{"materialCode":"P-1","source":"bom","uom":"box","needKg":30,"availableKg":-10,"shortageKg":40,"safetyKg":20,"qtyKg":55,"receivedKg":null,"lotNo":null,"expiry":null,"receivedAt":null,"receivedBy":null}'::jsonb,
  'the part line takes its unit from the item master (the client value is ignored)');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 2 ->> 'materialCode', 'P-2', 'the part code is stored as the item master spells it (p-2 became P-2)');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 2 ->> 'uom', 'kg', 'with its own unit');
select is(ps_t.stock('P-1') ->> 'safetyQty', '20', 'the safety stock of the part set in the order dialog was saved to the part stock (15 -> 20)');
select is(ps_t.qty('P-1'), 81::numeric, 'and the balance of that part was not touched');
select is(ps_t.ver(), current_setting('test.vb')::bigint + 1, 'the BOM counter moved once for the stock change');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:createPurchaseOrder' and a ->> 'detail' = 'stock +1'),
  'the BOM history records the stock change made by the order');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'createPurchaseOrder' and a ->> 'detail' like '%purchaseOrders +1%'),
  'and the RubberFlow history records the order');
select set_config('test.vb', ps_t.ver()::text, true);
select set_config('test.vr', ps_t.rver()::text, true);
select is(ps_t.po_save(ps_t.po('PO-20261111-01')) ->> 'version', current_setting('test.vr'), 'saving the order exactly as stored writes nothing in RubberFlow');
select is(ps_t.ver(), current_setting('test.vb')::bigint, 'and nothing in BOM');
select throws_ok($$ select ps_t.po_save(ps_t.po('PO-20261111-01') || jsonb_build_object('lines',
  jsonb_set(ps_t.po('PO-20261111-01') -> 'lines', '{1,source}', '"rf"'::jsonb))) $$, 'RF_INVALID_TRANSITION', 'a line cannot change its source afterwards');

-- 8.3 รับบรรทัดของซื้อ (ST หรือกลุ่มวางแผน): บวกยอด เขียนประวัติ ไม่มีล็อต/วันหมดอายุ
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'receivePurchaseLine') $$, 'RF_FORBIDDEN', 'an RB member cannot receive a part line');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'receivePurchaseLine') $$, 'RF_FORBIDDEN', 'QA staff cannot receive a part line');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50, '{"lotNo":"L-1","expiry":1900000000000}'), 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'a part receipt with a lot number and expiry is refused');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50, '{"expiry":1900000000000}'), 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'nor with an expiry alone');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 0), 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'a part receipt of zero is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(ps_t.receipt('PO-20261111-01', 1, 50))),
  'materialLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('lotNo', 'PS-LOT-1', 'materialCode', 'MAT-A', 'qtyKg', 5, 'initialKg', 5, 'expiry', 1900000000000,
    'supplier', 'PO-20261111-01', 'location', '', 'status', 'available', 'coa', false)))), ps_t.rver(), 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE',
  'a part receipt cannot carry a stock lot of the chemicals');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'createPurchaseOrder') $$, 'RF_INVALID_PURCHASE', 'a receipt needs the receipt action');
select is(ps_t.qty('P-1'), 81::numeric, 'nothing was added by the refused receipts');
select set_config('test.vb', ps_t.ver()::text, true);
select set_config('test.res', ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50, '{"receivedAt":1,"receivedBy":"ใครก็ได้"}'), 'receivePurchaseLine')::text, true);
select is(ps_t.qty('P-1'), 131::numeric, 'ST receives 50 of the part and the balance rises (81 + 50)');
select is(ps_t.po('PO-20261111-01') ->> 'status', 'ordered', 'the order stays ordered while other lines are open');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 1 ->> 'receivedBy', current_setting('test.n_sbx_st_staff'), 'the receiver is the persona (the client value is ignored)');
select ok((ps_t.po('PO-20261111-01') -> 'lines' -> 1 ->> 'receivedAt')::numeric > 1000, 'the receipt time is set by the server');
select is(ps_t.po('PO-20261111-01') -> 'lines' -> 1 -> 'lotNo', 'null'::jsonb, 'a part line has no lot');
select ok(ps_t.has_move('P-1', 'receive', 50, 131, 'PO-20261111-01', current_setting('test.n_sbx_st_staff')), 'the receive move carries the order number');
select is(ps_t.ver(), current_setting('test.vb')::bigint + 1, 'the BOM counter moved once for the receipt');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:receivePurchaseLine' and a ->> 'detail' = 'stock +1'),
  'the BOM history records the receipt');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 2, 5), 'receivePurchaseLine', 0) $$, 'RF_STALE', 'receiving another line from a copy older than the last receipt is stale (before the permission check)');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 10), 'receivePurchaseLine') $$, 'RF_INVALID_TRANSITION', 'a received part line cannot be received or corrected again');
select is(ps_t.qty('P-1'), 131::numeric, 'and the balance did not move');

-- 8.4 ใบที่มีแต่ของซื้อ: รับครบ = received (ผู้วางแผนรับได้)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-02', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-2","source":"bom","needKg":5,"availableKg":0,"shortageKg":5,"safetyKg":0,"qtyKg":8}]'::jsonb)) is not null, 'a planner creates an order of parts only');
select set_config('test.res', ps_t.po_save(ps_t.receipt('PO-20261111-02', 0, 7.5), 'receivePurchaseLine')::text, true);
select is(ps_t.po('PO-20261111-02') ->> 'status', 'received', 'the order becomes received once its only line is received (a planner can receive too)');
select is(ps_t.po('PO-20261111-02') -> 'lines' -> 0 ->> 'receivedKg', '7.5', 'the received quantity can differ from the ordered quantity');
select is(ps_t.qty('P-2'), 35::numeric, 'and the balance follows (27.5 + 7.5)');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-02', 0, 3), 'receivePurchaseLine') $$, 'RF_INVALID_TRANSITION', 'a received order cannot be received again or corrected');

-- 9. snapshot / delta ----------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 13::bigint, 'the snapshot still has thirteen lists');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 13::bigint, 'the delta names thirteen lists');
select is(public.app_bom_master_since(0) -> 'changes' -> 'stock', jsonb_build_object('upsert', public.app_bom_master() -> 'stock', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the stock snapshot, with no deletes');
select is(public.app_bom_master_since(0) -> 'changes' -> 'stockMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'stockMoves', 'delete', '[]'::jsonb),
  'and the move snapshot');
select is((select jsonb_agg(s ->> 'itemCode') from jsonb_array_elements(public.app_bom_master() -> 'stock') s), '["P-1","P-2","P-3"]'::jsonb, 'stock rows are listed by code');
select is(jsonb_array_length(public.app_bom_master_since(ps_t.ver()) -> 'changes' -> 'stock' -> 'upsert'), 0, 'a client at the current version gets an empty stock delta');
select is(ps_t.move_count('P-1'), 5, 'the part history holds both counts, both issues and the receipt');
select ok((select bool_and((m ->> 'balance')::numeric >= 0) from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m), 'no move leaves a negative balance');

-- 10. แยกโหมด และล้างข้อมูลทดสอบ ------------------------------------------------------------------
reset role;
select ok((select count(*) from public.bom_stock where is_test) = 3 and (select count(*) from public.bom_stock_moves where is_test) >= 9, 'the test stock and its moves exist before the purge');
select ok((select bool_and(changed_version > 0) from public.bom_stock where is_test) and (select bool_and(changed_version > 0) from public.bom_stock_moves where is_test),
  'every test row is stamped with the version that changed it');
select ok((select max(changed_version) from public.bom_stock_moves where is_test) <= (select version from public.bom_master_state where is_test), 'no move is newer than the counter');
select is((select count(*) from public.bom_stock where not is_test), 1::bigint, 'the real stock row is untouched');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.purge', public.app_sandbox_purge_bom()::text, true);
select ok((current_setting('test.purge')::jsonb ->> 'deleted')::integer > 12, 'the purge reports the rows it deleted (stock included)');
select is(public.app_bom_master() -> 'stock', '[]'::jsonb, 'the stock list is empty again');
select is(public.app_bom_master() -> 'stockMoves', '[]'::jsonb, 'and the move list');
reset role;
select is((select count(*) from public.bom_stock where is_test) + (select count(*) from public.bom_stock_moves where is_test), 0::bigint, 'no test stock or move is left');
select is((select count(*) from public.bom_stock where not is_test), 1::bigint, 'the real stock row survives the purge');
select is((select count(*) from public.bom_stock_moves where not is_test), 1::bigint, 'and the real move');

select * from finish();
rollback;
