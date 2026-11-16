-- สต็อกของซื้อ (ชิ้นส่วน PURCHASED ของ BOM) + ST เบิกจ่ายของซื้อรายใบ PI + บรรทัดของซื้อในใบสั่งซื้อ (20261111010000_bom_part_stock.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง/สิทธิ์ตารางใหม่, นับสต็อก (ST / WH / กลุ่มวางแผน / สมาชิก RB / QA), สต็อกขั้นต่ำเฉพาะกลุ่มวางแผนและ ST,รหัสที่ไม่ใช่ของซื้อ, ชนรายระเบียนก่อนสิทธิ์,
-- งานของซื้อรายงานผ่านทางอื่นไม่ได้, issueOrderParts (สิทธิ์ สต็อกไม่พอ = ไม่จ่ายเลย ชนรายระเบียน จ่ายสำเร็จ จ่ายซ้ำ · 20261123020000: เลือกบางงาน เบิกบางส่วนแล้วเบิกส่วนที่เหลือ
-- เบิกเกินแผนไม่เกินสต็อก ยอดไม่เป็นบวก/สถานะผิด/ทศนิยมเกิน 4 ตำแหน่ง สองใบในคำสั่งเดียว ใบที่เบิกบางส่วนยกเลิกและเปิดกลับเป็นร่างไม่ได้
-- กลุ่มวางแผนแทรกงานที่ไม่ใช่ของซื้อไม่ได้), ใบสั่งซื้อที่มีบรรทัดของซื้อ (สร้าง/แก้สต็อกขั้นต่ำ/รับเข้า/ปฏิเสธ),
-- snapshot / delta 13 ชุด และล้างข้อมูลทดสอบ · authenticated อ่านตาราง bom_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role (สิทธิ์เจ้าของตาราง) เท่านั้น
-- สิทธิ์ใบสั่งซื้อ (20261119010000_rf_purchase_by_st.sql): สร้าง / รับบรรทัด ทำได้เฉพาะ ST และ admin · กลุ่มวางแผน RB QA ได้ RF_FORBIDDEN
-- สต็อกขั้นต่ำของของซื้อ (20261120010000_st_sets_safety_stock.sql): เปลี่ยนได้โดยกลุ่มวางแผน (admin นับรวม) และแผนก ST ทั้งทาง countPartStock และทางใบสั่งซื้อ
-- WH / QA / SR / RB / ผู้ช่วยผู้จัดการแผนกนอกกลุ่มวางแผน เปลี่ยนไม่ได้ (BOM_FORBIDDEN ที่ countPartStock · สร้างใบสั่งซื้อไม่ได้เลย RF_FORBIDDEN)
-- 20261122010000_bom_fg_guards.sql: ทางใบสั่งซื้อ ST ที่ไม่ใช่กลุ่มวางแผนเปลี่ยนสต็อกขั้นต่ำของของซื้อได้เฉพาะเมื่อบรรทัดส่ง storedSafetyKg (ไม่ส่ง = RF_FORBIDDEN) · กลุ่มวางแผนไม่ต้องส่ง
-- 20261124010000_bom_followup_guards.sql: งานของซื้อที่เบิกแล้ว (บางส่วนหรือครบ) แก้ช่องโครงสร้างไม่ได้ทุก action (BOM_INVALID_JOB) · แถวที่เท่าเดิมและการเบิกส่วนที่เหลือยังผ่าน (7.6.8)
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
-- persona ผู้ดูแลระบบ (is_test) ไว้ตรวจว่า admin ยังสร้าง/รับใบสั่งซื้อได้ (ไม่มี persona บทบาท admin ในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
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
-- งานที่ client ส่งเมื่อเบิกบางส่วน / ส่วนที่เหลือ / เกินแผน (20261123020000): ยอดเบิกสะสมใหม่ และสถานะที่ตรงกับยอดนั้น (ส่ง p_status เพื่อทดสอบสถานะผิด)
create function ps_t.part(p_no text, p_total numeric, p_status text default null) returns jsonb language sql stable as $$
  select ps_t.job(p_no) || jsonb_build_object('qtyDone', p_total, 'status',
    coalesce(p_status, case when p_total >= (ps_t.job(p_no) ->> 'qtyPlanned')::numeric then 'done' else 'in_progress' end))
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
select set_config('test.po', '{"id":"PO-20261111-01","status":"ordered","sourcePi":"251111-25001","sourceRequisition":null,"note":"สั่งเคมีกับของซื้อ","lines":[{"materialCode":"MAT-A","needKg":100,"availableKg":20,"shortageKg":80,"safetyKg":60,"qtyKg":140},{"materialCode":"P-1","source":"bom","uom":"ignored","needKg":30,"availableKg":-10,"shortageKg":40,"safetyKg":20,"storedSafetyKg":15,"qtyKg":55},{"materialCode":"p-2","source":"bom","needKg":12.5,"availableKg":27.5,"shortageKg":0,"safetyKg":0,"qtyKg":5}]}', true);

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
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 14::bigint, 'the snapshot has fourteen lists');
select is(public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"},
  {"code":"P-2","kind":"PURCHASED","name":"เม็ดสี","ownerDept":"ST","uom":"kg"},
  {"code":"P-3","kind":"PURCHASED","name":"เทปกาว","ownerDept":"ST","uom":"roll"},
  {"code":"P-4","kind":"PURCHASED","name":"สายรัด","ownerDept":"ST","uom":"pcs"},
  {"code":"P-5","kind":"PURCHASED","name":"น็อต","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 0, 'importFlat') ->> 'version', '1',
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

-- 5.4 สต็อกขั้นต่ำ: กลุ่มวางแผนและแผนก ST เปลี่ยนได้ · WH / QA / SR / RB / ผู้ช่วยผู้จัดการแผนกนอกกลุ่มวางแผน เปลี่ยนไม่ได้ · ชนรายระเบียนก่อนสิทธิ์
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'WH staff can count but cannot change the safety stock');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-3","qty":1,"safetyQty":2}]'::jsonb) $$, 'BOM_FORBIDDEN', 'a count with a safety change is refused as a whole for WH staff');
select ok(ps_t.stock('P-3') is null, 'and the refused row left no stock row behind');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'QA staff cannot change the safety stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'SR staff cannot change the safety stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'an assistant department manager outside the planning group cannot change the safety stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) $$, 'BOM_FORBIDDEN', 'RB staff cannot change the safety stock of a part');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":50}]'::jsonb, current_setting('test.v_old')::bigint) $$, 'BOM_STALE',
  'the stale check comes before the permission check (an RB member holding an old copy gets BOM_STALE)');
select throws_ok($$ select ps_t.count_stock('[{"itemCode":"P-1","qty":50}]'::jsonb) $$, 'BOM_FORBIDDEN', 'with a current copy the same RB member is simply not allowed');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(ps_t.count_stock('[{"itemCode":"P-1","safetyQty":15}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'safetyQty', '15', 'ST staff sets the safety stock of a part that has a stock row');
select is(ps_t.qty('P-1'), 120::numeric, 'and the balance is untouched');
select is(ps_t.move_count('P-1'), 2, 'a safety change alone writes no move');
select is(ps_t.count_stock('[{"itemCode":"P-4","qty":3,"safetyQty":9}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'safetyQty', '9', 'ST staff counts a part and sets its safety stock in one row (a part with no stock row yet)');
select is(ps_t.qty('P-4'), 3::numeric, 'and the count of that row was applied too');
select is(ps_t.move_count('P-4'), 1, 'with one count move');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(ps_t.count_stock('[{"itemCode":"P-4","safetyQty":10}]'::jsonb) -> 'changes' -> 'stock' -> 'upsert' -> 0 ->> 'safetyQty', '10', 'the planner changes the safety stock too (9 -> 10)');
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
-- 7.1 ปฏิเสธ: แผนกอื่น · แถวที่ไม่เบิกอะไร · สถานะไม่ตรงกับยอดสะสมใหม่ · action ปน (เลือกบางงาน / บางส่วน / เกินแผน ทำได้แล้ว ดู 7.6 · 20261123020000)
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_FORBIDDEN', 'RB staff cannot issue parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2'))) $$, 'BOM_FORBIDDEN', 'WH staff can count but cannot issue parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.job('JOB-ST-P1'))) $$, 'BOM_INVALID_JOB', 'a row that issues nothing (qtyDone as stored) is refused');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-PK-A'))) $$, 'BOM_FORBIDDEN', 'a job of another department in the set is refused for ST staff');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.job('JOB-ST-P2') || '{"status":"in_progress","qtyDone":12.5}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'a row that reaches its plan must be sent as done');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2') || '{"qtyDone":10}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'a row below its plan cannot be sent as done (10 of 12.5)');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.job('JOB-ST-P2') || '{"status":"queued","qtyDone":5}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'a partial row must be in_progress, not queued');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1') || '{"qtyPlanned":31}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'the plan of a part job cannot change with the issue');
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

-- 7.3 จ่ายสำเร็จแบบ Pilot รุ่นก่อน (ทุกงานที่เปิดอยู่ qtyDone = qtyPlanned, done): หักสต็อก เขียนประวัติ ตั้งงานเป็น done ใบเป็น in_progress
select set_config('test.vi', ps_t.ver()::text, true);
select set_config('test.res', ps_t.issue(jsonb_build_array(ps_t.done('JOB-ST-P1'), ps_t.done('JOB-ST-P2')))::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.vi')::bigint + 1)::text, 'ST issues every part of the order in full (the older page''s rows still work) and the counter moves once');
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
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.job('JOB-ST-P1') || '{"qtyDone":35}'::jsonb)) $$, 'BOM_INVALID_JOB', 'a done part job takes no further issue (not even with stock left)');
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

-- 7.6 เลือกบางงาน · เบิกบางส่วนแล้วเบิกส่วนที่เหลือ · เบิกเกินแผนได้ไม่เกินสต็อก · สต็อกไม่พอ = ไม่เขียนอะไร · สองใบในคำสั่งเดียวไม่ได้ (20261123020000)
-- ใช้ชิ้นใหม่ P-6 (ฝาปิด) / P-7 (กาว) และใบที่สาม / สี่ เท่านั้น ยอดของ P-1 ... P-5 ที่ส่วนถัดไปตรวจจึงไม่เปลี่ยน
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(ps_t.save('{"items":{"upsert":[
  {"code":"P-6","kind":"PURCHASED","name":"ฝาปิด","ownerDept":"ST","uom":"pcs"},
  {"code":"P-7","kind":"PURCHASED","name":"กาว","ownerDept":"ST","uom":"kg"}]}}'::jsonb, 'importFlat') is not null, 'the planner adds two more parts');
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251111-25003"}'::jsonb))), 'createOrder') is not null, 'a third order is created');
select set_config('test.o3', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25003'), true);
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o3')::jsonb || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":2,"colorSet":"A","note":""}]'::jsonb,
    'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":2,"required":2},{"itemCode":"P-6","level":1,"fgQty":2,"required":10},{"itemCode":"P-7","level":1,"fgQty":2,"required":4}]'::jsonb)))), 'explodeOrder') is not null,
  'and exploded');
select set_config('test.o3', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25003'), true);
select ok(ps_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o3')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB3-ST-P6","orderId":"251111-25003","itemCode":"P-6","name":"ฝาปิด","uom":"pcs","qtyPlanned":10,"qtyRequired":10}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB3-ST-P7","orderId":"251111-25003","itemCode":"P-7","name":"กาว","uom":"kg","qtyPlanned":4,"qtyRequired":4}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB3-PK-A","orderId":"251111-25003","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":2,"qtyRequired":2}'::jsonb))),
  'releaseOrder') is not null, 'and released with two part jobs (10 caps, 4 kg of glue)');
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251111-25004"}'::jsonb))), 'createOrder') is not null, 'a fourth order is created');
select set_config('test.o4', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25004'), true);
select ok(ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o4')::jsonb || jsonb_build_object('items', '[{"fgCode":"FG-A","qty":1,"colorSet":"A","note":""}]'::jsonb,
    'explosion', '[{"itemCode":"FG-A","level":0,"fgQty":1,"required":1},{"itemCode":"P-6","level":1,"fgQty":1,"required":5}]'::jsonb)))), 'explodeOrder') is not null,
  'and exploded');
select set_config('test.o4', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25004'), true);
select ok(ps_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.o4')::jsonb || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB4-ST-P6","orderId":"251111-25004","itemCode":"P-6","name":"ฝาปิด","uom":"pcs","qtyPlanned":5,"qtyRequired":5}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB4-PK-A","orderId":"251111-25004","dept":"PK","itemCode":"FG-A","name":"สินค้า A","kind":"FG","uom":"set","qtyPlanned":1,"qtyRequired":1}'::jsonb))),
  'releaseOrder') is not null, 'and released with one part job (5 caps)');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(ps_t.count_stock('[{"itemCode":"P-6","qty":12},{"itemCode":"P-7","qty":3}]'::jsonb) is not null, 'ST counts the new parts (12 caps, 3 kg of glue)');

-- 7.6.1 สิทธิ์: WH / PK / QA เบิกบางส่วนก็ไม่ได้
select set_config('test.vq', ps_t.ver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 4))) $$, 'BOM_FORBIDDEN', 'WH staff cannot issue part of a line');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 4))) $$, 'BOM_FORBIDDEN', 'PK staff cannot issue parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 4))) $$, 'BOM_FORBIDDEN', 'QA staff cannot issue parts');
select is(ps_t.ver(), current_setting('test.vq')::bigint, 'the refused callers wrote nothing');

-- 7.6.2 ST เลือกเฉพาะบรรทัดฝาปิดและเบิก 4 จาก 10: บรรทัดยังเปิด บรรทัดที่ไม่ได้ส่งไม่ถูกแตะ หักสต็อกเท่าที่เบิก
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.res', ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 4)))::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.vq')::bigint + 1)::text, 'ST issues 4 of the 10 caps and leaves the glue line out (one row, not the whole order)');
select is(ps_t.job('JOB3-ST-P6') ->> 'status', 'in_progress', 'the partly issued line stays open');
select is((ps_t.job('JOB3-ST-P6') ->> 'qtyDone')::numeric, 4::numeric, 'with the issued total');
select ok(not (ps_t.job('JOB3-ST-P6') ? 'doneAt'), 'and no done time');
select is(ps_t.job('JOB3-ST-P7') ->> 'status', 'queued', 'the line that was not sent is untouched');
select is(ps_t.qty('P-6'), 8::numeric, 'the stock dropped by what was issued (12 - 4)');
select ok(ps_t.has_move('P-6', 'issue', -4, 8, '251111-25003', current_setting('test.n_sbx_st_staff')), 'the issue move carries the issued quantity and the balance');
select is(ps_t.order_status('251111-25003'), 'in_progress', 'a partial issue starts the released order');
-- รายการล่าสุดของประวัติ = การบันทึกนี้ (รายการเก่าของ 7.5 ก็เป็น jobs +1, stock +1 จึงต้องดูรายการล่าสุดเท่านั้น)
select is(jsonb_build_array(public.app_bom_audit(1) -> 0 ->> 'action', public.app_bom_audit(1) -> 0 ->> 'user', public.app_bom_audit(1) -> 0 ->> 'detail'),
  jsonb_build_array('issueOrderParts', current_setting('test.n_sbx_st_staff'), 'jobs +1, stock +1'), 'the history entry of this save counts one job and one stock row');

-- 7.6.3 ปฏิเสธ: ยอดเท่าเดิม / ลดลง · สถานะไม่ตรงกับยอด · เกินสต็อก (ทั้งคำสั่งไม่เขียน) · สองใบในคำสั่งเดียว
select set_config('test.vq', ps_t.ver()::text, true);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 4))) $$, 'BOM_INVALID_JOB', 'sending the stored total again issues nothing and is refused');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 3))) $$, 'BOM_INVALID_JOB', 'a lower total (a negative issue) is refused');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 10, 'in_progress'))) $$, 'BOM_INVALID_JOB', 'a total that reaches the plan must be sent as done');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 6, 'done'))) $$, 'BOM_INVALID_JOB', 'a total below the plan cannot be sent as done');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 13), ps_t.part('JOB3-ST-P7', 2))) $$, 'BOM_INSUFFICIENT_STOCK',
  'issuing 9 more caps with 8 in stock refuses the whole save');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 5), ps_t.part('JOB4-ST-P6', 1))) $$, 'BOM_INVALID_JOB', 'rows of two orders in one save are refused');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 5.12345))) $$, 'BOM_INVALID_JOB', 'a total with more than 4 decimal places is refused');
select is(ps_t.ver(), current_setting('test.vq')::bigint, 'nothing was written by the refused calls');
select is(ps_t.qty('P-7'), 3::numeric, 'the glue of the refused save was not issued');
select is((ps_t.job('JOB3-ST-P6') ->> 'qtyDone')::numeric, 4::numeric, 'and the caps line still holds 4');

-- 7.6.4 ส่วนที่เหลือ + เกินแผน 2 (เท่าที่มีในสต็อก) พร้อมกาวบางส่วนในคำสั่งเดียว · บรรทัดที่เสร็จแล้วเบิกเพิ่มไม่ได้
select set_config('test.res', ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 12), ps_t.part('JOB3-ST-P7', 3)))::text, true);
select is(ps_t.job('JOB3-ST-P6') ->> 'status', 'done', 'the rest of the caps plus 2 over the plan (8 more, all that is in stock) finish the line');
select is((ps_t.job('JOB3-ST-P6') ->> 'qtyDone')::numeric, 12::numeric, 'the job keeps the issued total above its plan (12 of 10)');
select ok(ps_t.job('JOB3-ST-P6') ? 'doneAt', 'and gets its done time');
select is(ps_t.qty('P-6'), 0::numeric, 'the caps are used up (8 - 8)');
select ok(ps_t.has_move('P-6', 'issue', -8, 0, '251111-25003', current_setting('test.n_sbx_st_staff')), 'the second move of the line carries only the new 8');
select is(ps_t.move_count('P-6'), 3, 'the caps history: one count and two issues');
select is(ps_t.job('JOB3-ST-P7') ->> 'status', 'in_progress', 'the glue line is issued in part (3 of 4) in the same save');
select is(ps_t.qty('P-7'), 0::numeric, 'with all the glue in stock');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P6', 13))) $$, 'BOM_INVALID_JOB', 'a finished line takes no further issue');

-- 7.6.5 กลุ่มวางแผนเบิกส่วนที่เหลือของกาว (1 จาก 4) หลังรับของเพิ่ม
select ok(ps_t.count_stock('[{"itemCode":"P-7","qty":1.5}]'::jsonb) is not null, 'ST receives more glue (counts 1.5 kg)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(ps_t.issue(jsonb_build_array(ps_t.part('JOB3-ST-P7', 4))) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'the planner issues the remaining 1 kg of glue');
select is(ps_t.qty('P-7'), 0.5::numeric, 'and the stock keeps what was not issued (1.5 - 1)');
select ok(ps_t.has_move('P-7', 'issue', -1, 0.5, '251111-25003', current_setting('test.n_sbx_pp_staff')), 'the remainder move names the planner');

-- 7.6.6 ใบที่มีบรรทัดของซื้อเบิกบางส่วนแล้วยกเลิกไม่ได้ (ต้องยกเลิกการเบิกจ่ายก่อน: bom_part_returns.test.sql)
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(ps_t.count_stock('[{"itemCode":"P-6","qty":2}]'::jsonb) is not null, 'ST counts 2 caps for the fourth order');
select ok(ps_t.issue(jsonb_build_array(ps_t.part('JOB4-ST-P6', 2))) is not null, 'ST issues 2 of its 5 caps');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.o4', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251111-25004'), true);
select throws_ok($$ select ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o4')::jsonb || '{"status":"cancelled","cancelReason":"ทดสอบ"}'::jsonb))), 'cancelOrder') $$, 'BOM_INVALID_TRANSITION',
  'an order with a partly issued part line cannot be cancelled');
select throws_ok($$ select ps_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o4')::jsonb || '{"status":"draft","explosion":null,"explodedAt":null}'::jsonb))), 'updateOrderItem') $$, 'BOM_INVALID_TRANSITION',
  'nor reopened as a draft (the partly issued line counts as a started job)');
select is(ps_t.order_status('251111-25004'), 'in_progress', 'and stays in progress');
select is((ps_t.job('JOB4-ST-P6') ->> 'qtyDone')::numeric, 2::numeric, 'with its part line still holding the 2 caps');

-- 7.6.7 กลุ่มวางแผนส่งงานที่ไม่ใช่ของซื้อมากับ issueOrderParts: bom_save_jobs เขียนงาน PK ให้กลุ่มวางแผนได้ แต่ bom_issue_parts ปฏิเสธ ทั้งคำสั่งจึงไม่เขียนอะไร
select set_config('test.vq', ps_t.ver()::text, true);
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.part('JOB4-ST-P6', 3), ps_t.job('JOB4-PK-A') || '{"status":"in_progress","qtyDone":1}'::jsonb)) $$,
  'BOM_INVALID_JOB', 'a planner cannot slip a packing job into a part issue');
select is(ps_t.ver(), current_setting('test.vq')::bigint, 'nothing was written');
select ok(ps_t.job('JOB4-PK-A') ->> 'status' = 'queued' and (ps_t.job('JOB4-PK-A') ->> 'qtyDone')::numeric = 0, 'the packing job is untouched');
select is((ps_t.job('JOB4-ST-P6') ->> 'qtyDone')::numeric, 2::numeric, 'and so is the part line of the same save');

-- 7.6.8 งานของซื้อที่เบิกแล้ว (บางส่วนหรือครบ) แก้ช่องโครงสร้างไม่ได้ ทุก action ทุกผู้เรียก (20261124010000)
-- พนักงานแผนกยังได้ BOM_FORBIDDEN ก่อน · การแก้ช่องผลงานด้วย action อื่นยังได้ BOM_INVALID_TRANSITION · แถวที่เท่าเดิมและการเบิกส่วนที่เหลือยังผ่าน
select set_config('test.vq', ps_t.ver()::text, true);
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB4-ST-P6') || '{"qtyPlanned":2}'::jsonb))), 'reportJob') $$, 'BOM_INVALID_JOB',
  'a planner cannot lower the plan of a partly issued line to what was issued (it would stay open and could never be issued)');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB4-ST-P6') || '{"dueAt":1764300000000}'::jsonb))), 'releaseOrder') $$, 'BOM_INVALID_JOB',
  'nor move its due date with another action');
select throws_ok($$ select ps_t.issue(jsonb_build_array(ps_t.job('JOB4-ST-P6') || '{"name":"ฝาปิดใหม่"}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'nor rename it inside an issue that issues nothing');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB3-ST-P6') || '{"qtyRequired":12}'::jsonb))), 'reportJob') $$, 'BOM_INVALID_JOB',
  'a finished part line (issued over its plan) takes no structural change either');
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB4-ST-P6') || '{"status":"done","qtyDone":5}'::jsonb))), 'reportJob') $$, 'BOM_INVALID_TRANSITION',
  'a work change with another action keeps its earlier code');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  ps_t.job('JOB4-ST-P6') || '{"qtyPlanned":2}'::jsonb))), 'reportJob') $$, 'BOM_FORBIDDEN',
  'ST staff still get the permission error first');
select is(ps_t.ver(), current_setting('test.vq')::bigint, 'nothing was written by the refused calls');
select is((ps_t.job('JOB4-ST-P6') ->> 'qtyPlanned')::numeric || '/' || (ps_t.job('JOB4-ST-P6') ->> 'status'), '5/in_progress',
  'the partly issued line keeps its plan of 5 and stays open');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(ps_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ps_t.job('JOB4-ST-P6')))), 'reportJob') is not null,
  'a row sent as stored is not a change and passes');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(ps_t.count_stock('[{"itemCode":"P-6","qty":3}]'::jsonb) is not null, 'ST counts 3 more caps');
select is(ps_t.issue(jsonb_build_array(ps_t.part('JOB4-ST-P6', 5))) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done',
  'the issue writer still finishes the line (2 + 3 of 5)');
select is(ps_t.qty('P-6'), 0::numeric, 'and takes the 3 caps from stock');

-- 8. ใบสั่งซื้อที่มีบรรทัดของซื้อ ------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"safetyKg":60}'::jsonb))), 0, 'saveMaterial') ->> 'version', '1', 'the planner adds a chemical to order together with the parts');
-- 8.1 ปฏิเสธ (ST ผู้สร้างใบ: รูปข้อมูลผิดของบรรทัดของซื้อ)
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
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
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb) $$, 'RF_FORBIDDEN', 'PP staff (the planning group) cannot create a purchase order with parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb) $$, 'RF_FORBIDDEN', 'a department manager outside ST cannot create a purchase order with parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb) $$, 'RF_FORBIDDEN', 'an RB member cannot create a purchase order with parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select ps_t.po_save(current_setting('test.po')::jsonb) $$, 'RF_FORBIDDEN', 'QA staff cannot create a purchase order with parts');
select is(ps_t.rver(), 1::bigint, 'the RubberFlow counter did not move for the refused calls');

-- 8.2 สร้างสำเร็จ (ST: ใบนี้เปลี่ยนสต็อกขั้นต่ำของ P-1): เคมี + ของซื้อ 2 บรรทัด · สต็อกขั้นต่ำของ P-1 ถูก upsert ที่ BOM · เวอร์ชัน BOM เพิ่มหนึ่งครั้ง
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.vb', ps_t.ver()::text, true);
select set_config('test.res', ps_t.po_save(current_setting('test.po')::jsonb)::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', '2', 'ST staff creates an order that mixes a chemical and two parts, and changes the safety stock of one part (RubberFlow counter + 1)');
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
-- สต็อกขั้นต่ำของของซื้อเปลี่ยนได้โดยกลุ่มวางแผน (admin นับรวม) และแผนก ST (รวมชิ้นที่ยังไม่มีแถวสต็อก) · คนอื่นสร้างใบไม่ได้เลย (RF_FORBIDDEN) จึงเปลี่ยนสต็อกขั้นต่ำทางใบไม่ได้
-- ST เปลี่ยนสองชิ้นในใบเดียว: P-1 (มีแถวสต็อกแล้ว 20 -> 99) และ P-5 (ยังไม่มีแถว: สร้างแถวพร้อมสต็อกขั้นต่ำ 4 ยอด 0) · เวอร์ชัน BOM เพิ่มหนึ่งครั้ง
select set_config('test.vb', ps_t.ver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
-- client รุ่นก่อน (ไม่ส่ง storedSafetyKg): ST เปลี่ยนสต็อกขั้นต่ำของของซื้อไม่ได้ ทั้งชิ้นที่มีแถวสต็อกและชิ้นที่ยังไม่มี (20261122010000) · ทั้งใบไม่เขียนอะไร
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-06', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":99,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'ST staff without the stored value (an older page) cannot change the safety stock of a part with a stock row');
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-06', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-5","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":4,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'nor create a stock row with a safety stock for a part without one');
select is(ps_t.stock('P-1') ->> 'safetyQty', '20', 'the refused order left the safety stock as it was');
select ok(ps_t.stock('P-5') is null, 'and made no stock row');
select is(ps_t.ver(), current_setting('test.vb')::bigint, 'and wrote nothing to the BOM');
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-06', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":99,"storedSafetyKg":20,"qtyKg":2},{"materialCode":"P-5","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":4,"storedSafetyKg":0,"qtyKg":2}]'::jsonb)) is not null,
  'ST staff sending the stored values changes the safety stock of two parts through an order (one with a stock row, one without)');
select is(ps_t.stock('P-1') ->> 'safetyQty', '99', 'the safety stock of the part with a stock row was changed (20 -> 99)');
select is(ps_t.qty('P-1'), 81::numeric, 'and its balance was not touched');
select is(ps_t.stock('P-5') ->> 'safetyQty', '4', 'a part without a stock row got one with that safety stock');
select is(ps_t.qty('P-5'), 0::numeric, 'and a balance of zero');
select is(ps_t.ver(), current_setting('test.vb')::bigint + 1, 'the BOM counter moved once for both stock changes');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:createPurchaseOrder' and a ->> 'detail' = 'stock +2'),
  'the BOM history records both stock rows');
-- ค่าเท่าที่เก็บ: ไม่แตะแถว BOM
select set_config('test.vb', ps_t.ver()::text, true);
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-03', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":99,"qtyKg":2}]'::jsonb)) is not null, 'ST staff can order a part when its safety stock is left as stored');
select is(ps_t.ver(), current_setting('test.vb')::bigint, 'and that order changes no BOM row');
-- หน้าต่างที่เปิดค้างไว้ (storedSafetyKg = ค่าที่หน้าต่างแสดงตอนเปิด): ผู้สั่งไม่ได้แก้ช่อง (safetyKg = storedSafetyKg = 20) แต่ที่เก็บเป็น 99 แล้ว
-- = ไม่เขียนทับค่าที่ผู้อื่นตั้ง บรรทัดของใบเก็บค่าที่ใช้อยู่จริง และไม่เก็บช่อง storedSafetyKg · ช่องนี้ผิดรูป = RF_INVALID_PURCHASE
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-07', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":20,"storedSafetyKg":"20","qtyKg":2}]'::jsonb)) $$, 'RF_INVALID_PURCHASE',
  'a malformed stored safety stock is refused');
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-07', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":20,"storedSafetyKg":20,"qtyKg":2}]'::jsonb)) is not null,
  'ST staff orders from a dialog that still shows an older safety stock without having edited it');
select is(ps_t.stock('P-1') ->> 'safetyQty', '99', 'the safety stock someone else set in the meantime is kept');
select is(ps_t.ver(), current_setting('test.vb')::bigint, 'and no BOM row changed');
select is(ps_t.po('PO-20261111-07') -> 'lines' -> 0, '{"materialCode":"P-1","source":"bom","uom":"box","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":99,"qtyKg":2,"receivedKg":null,"lotNo":null,"expiry":null,"receivedAt":null,"receivedBy":null}'::jsonb,
  'the order line keeps the safety stock in force and not the stored-value field');
-- คนอื่นสร้างใบไม่ได้เลย แม้ใบนั้นเปลี่ยนสต็อกขั้นต่ำ (ไม่เขียนอะไรทั้ง BOM และ RubberFlow) · RB เป็นคนสุดท้ายเพราะ 8.3 ต่อจากสมาชิก RB
select set_config('test.vr', ps_t.rver()::text, true);
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-05', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":5,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'WH staff cannot change the safety stock of a part through an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-05', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":5,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'SR staff cannot change the safety stock of a part through an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-05', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":5,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'an assistant department manager outside the planning group cannot change the safety stock of a part through an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-05', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":99,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'an RB member cannot create an order even when the safety stock is left as stored');
select throws_ok($$ select ps_t.po_save(jsonb_build_object('id', 'PO-20261111-05', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-1","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":5,"qtyKg":2}]'::jsonb)) $$, 'RF_FORBIDDEN',
  'nor change the safety stock of a part through an order');
select is(ps_t.ver(), current_setting('test.vb')::bigint, 'the refused orders wrote nothing to the BOM');
select is(ps_t.rver(), current_setting('test.vr')::bigint, 'nor to RubberFlow');
select is(jsonb_array_length(public.app_rf_master() -> 'purchaseOrders'), 4, 'and no order was added by them');

-- 8.3 รับบรรทัดของซื้อ (ST หรือ admin): บวกยอด เขียนประวัติ ไม่มีล็อต/วันหมดอายุ
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'receivePurchaseLine') $$, 'RF_FORBIDDEN', 'an RB member cannot receive a part line');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'receivePurchaseLine') $$, 'RF_FORBIDDEN', 'PP staff (the planning group) cannot receive a part line');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-01', 1, 50), 'receivePurchaseLine') $$, 'RF_FORBIDDEN', 'a department manager outside ST cannot receive a part line');
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

-- 8.4 ใบที่มีแต่ของซื้อ: รับครบ = received (ST สร้าง admin รับได้)
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-02', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-2","source":"bom","needKg":5,"availableKg":0,"shortageKg":5,"safetyKg":0,"qtyKg":8}]'::jsonb)) is not null, 'ST staff creates an order of parts only');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select set_config('test.res', ps_t.po_save(ps_t.receipt('PO-20261111-02', 0, 7.5), 'receivePurchaseLine')::text, true);
select is(ps_t.po('PO-20261111-02') ->> 'status', 'received', 'the order becomes received once its only line is received (admin can receive too)');
select is(ps_t.po('PO-20261111-02') -> 'lines' -> 0 ->> 'receivedKg', '7.5', 'the received quantity can differ from the ordered quantity');
select is(ps_t.qty('P-2'), 35::numeric, 'and the balance follows (27.5 + 7.5)');
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-02', 0, 3), 'receivePurchaseLine') $$, 'RF_INVALID_TRANSITION', 'a received order cannot be received again or corrected');
-- รับบรรทัดของซื้อที่ชิ้นไม่ได้เป็น PURCHASED แล้ว (ถูกเปลี่ยนชนิดหลังสั่ง) = RF_INVALID_PURCHASE ไม่แตะสต็อก
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-04', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-3","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":2,"qtyKg":5}]'::jsonb)) is not null, 'admin orders a part that will change kind afterwards');
-- กลุ่มวางแผน (admin นับรวม) เปลี่ยนสต็อกขั้นต่ำของของซื้อทางใบได้โดยไม่ต้องส่ง storedSafetyKg (20261122010000 จำกัดเฉพาะ ST)
select set_config('test.vb', ps_t.ver()::text, true);
select ok(ps_t.po_save(jsonb_build_object('id', 'PO-20261111-08', 'status', 'ordered', 'sourcePi', null, 'sourceRequisition', null, 'note', '',
  'lines', '[{"materialCode":"P-5","source":"bom","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":6,"qtyKg":2}]'::jsonb)) is not null,
  'admin (the planning group) changes the safety stock of a part without sending the stored value');
select is(ps_t.stock('P-5') ->> 'safetyQty', '6', 'and the value is saved (4 -> 6)');
select is(ps_t.ver(), current_setting('test.vb')::bigint + 1, 'the BOM counter moved once for it');
reset role;
select set_config('request.jwt.claims', '', true);
update public.bom_items set kind = 'SE' where is_test and code = 'P-3';
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select ps_t.po_save(ps_t.receipt('PO-20261111-04', 0, 5), 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'a part line cannot be received once the item is no longer a purchased part');
select is(ps_t.qty('P-3'), 0::numeric, 'and the stock did not move');
reset role;
select set_config('request.jwt.claims', '', true);
update public.bom_items set kind = 'PURCHASED' where is_test and code = 'P-3';
select set_config('request.jwt.claims', '{"sub":"8e100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(ps_t.po_save(ps_t.receipt('PO-20261111-04', 0, 5), 'receivePurchaseLine') is not null, 'with the kind restored the same receipt works');

-- 9. snapshot / delta ----------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 14::bigint, 'the snapshot still has fourteen lists');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 14::bigint, 'the delta names fourteen lists');
select is(public.app_bom_master_since(0) -> 'changes' -> 'stock', jsonb_build_object('upsert', public.app_bom_master() -> 'stock', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the stock snapshot, with no deletes');
select is(public.app_bom_master_since(0) -> 'changes' -> 'stockMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'stockMoves', 'delete', '[]'::jsonb),
  'and the move snapshot');
select is((select jsonb_agg(s ->> 'itemCode') from jsonb_array_elements(public.app_bom_master() -> 'stock') s), '["P-1","P-2","P-3","P-4","P-5","P-6","P-7"]'::jsonb, 'stock rows are listed by code');
select is(jsonb_array_length(public.app_bom_master_since(ps_t.ver()) -> 'changes' -> 'stock' -> 'upsert'), 0, 'a client at the current version gets an empty stock delta');
select is(ps_t.move_count('P-1'), 5, 'the part history holds both counts, both issues and the receipt');
select ok((select bool_and((m ->> 'balance')::numeric >= 0) from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m), 'no move leaves a negative balance');

-- 10. แยกโหมด และล้างข้อมูลทดสอบ ------------------------------------------------------------------
reset role;
select ok((select count(*) from public.bom_stock where is_test) = 7 and (select count(*) from public.bom_stock_moves where is_test) >= 9, 'the test stock and its moves exist before the purge');
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
