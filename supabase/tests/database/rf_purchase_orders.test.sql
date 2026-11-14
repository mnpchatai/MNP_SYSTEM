-- จัดซื้อเคมีของ RubberFlow (20261110010000_rf_purchase_orders.sql): ใบสั่งซื้อ + สต็อกสำรอง (safetyKg) + อายุเก็บ (shelfLifeDays) ของวัตถุดิบ
-- กติกาสิทธิ์ (20261119010000_rf_purchase_by_st.sql): สร้างใบ / รับบรรทัด / ยกเลิก ทำได้เฉพาะ ST และ admin · กลุ่มวางแผน (PP, ผู้จัดการแผนก) สมาชิก RB QA WH SR ได้ RF_FORBIDDEN
-- สต็อกขั้นต่ำของเคมี (20261120010000_st_sets_safety_stock.sql): ST เปลี่ยน safetyKg ได้เฉพาะเป็นส่วนหนึ่งของคำสั่ง createPurchaseOrder (ชุด materials) ไม่ใช่ทาง saveMaterial · RB ยังตั้งทาง saveMaterial ได้
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธต่อบทบาท (ST / admin / กลุ่มวางแผน / สมาชิก RB / QA / WH / SR / ผู้ช่วยผู้จัดการแผนกอื่น) นอกโหมดทดสอบ lab-only โครงสร้าง/สิทธิ์ตาราง
-- สร้างใบ (รวมแก้ safetyKg พ่วง) รูปข้อมูลผิด เลขใบซ้ำ ชนรายระเบียนก่อนสิทธิ์ รับเข้าทีละบรรทัดที่สร้างล็อตในคำสั่งเดียวกัน (ล็อตไม่ตรง/ขาด/เกิน = ย้อนทั้งคำสั่ง)
-- รับซ้ำ สถานะ ordered -> received ยกเลิก snapshot/delta 12 ชุด audit และล้างข้อมูลทดสอบ
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงนับตารางด้วย reset role เสมอ) ส่วนที่ไม่เปลี่ยนจากรอบก่อนตรวจใน rubberflow_core.test.sql / rubberflow_shopfloor.test.sql
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.rf_purchase_orders'::regclass), 'the purchase order table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.rf_purchase_orders', p.priv)),
  'anon and authenticated have no direct table privilege on the purchase order table');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_purchase_orders'::regclass and p.polname = 'rf_purchase_orders_no_direct_access'),
  'the purchase order table has the deny-all policy');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_purchase_orders'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'the purchase order table has the restrictive lab_only_no_access policy');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.rf_purchase_orders'::regclass and g.tgname = 'rf_purchase_orders_sandbox_scope' and not g.tgisinternal)
      and exists (select 1 from pg_trigger g where g.tgrelid = 'public.rf_purchase_orders'::regclass and g.tgname = 'rf_purchase_orders_stamp_version' and not g.tgisinternal),
  'the purchase order table separates test data from real data and stamps changed_version by trigger');
select ok('rf_purchase_orders' = any (private.sandbox_unguarded_tables()), 'the purchase order table is registered as sandbox aware');
select ok('rf_ncrs' = any (private.sandbox_unguarded_tables()) and 'rf_materials' = any (private.sandbox_unguarded_tables())
          and 'bom_jobs' = any (private.sandbox_unguarded_tables()) and 'ncr_reports' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier RubberFlow, BOM and NCR tables');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'rf_purchase_orders_changed_idx' and indexdef like '%(is_test, changed_version)%'),
  'the purchase order table is indexed by (is_test, changed_version)');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'rf_materials' and column_name in ('safety_kg', 'shelf_life_days')),
  2::bigint, 'materials have the safety stock and shelf life columns');
select ok(array['createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'saveMaterial', 'receiveMaterial', 'createRequisition', 'weighLine', 'issueRequisition'] <@ private.rf_client_actions(),
  'the action whitelist knows the three purchase order actions and the whole-requisition issue, and keeps the earlier ones');
select ok(not exists (select 1 from unnest(array['public.app_rf_master()', 'public.app_rf_master_since(bigint)', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)',
                                                  'public.app_rf_audit(integer)', 'public.app_sandbox_purge_rf()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the RubberFlow RPCs keep their grants (signed-in users only)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_sandbox_purge_rf()'::regprocedure,
                           'private.rf_save_purchase_orders(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_check_po_receipt(uuid,jsonb,bigint)'::regprocedure,
                           'private.rf_save_requisitions(uuid,text,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_save_materials(uuid,text,jsonb,bigint,bigint)'::regprocedure)),
  'the replaced RPCs and the new writers are security definer with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_save_materials' and p.pronargs = 4),
  'the old four-argument material writer is gone');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_save_requisitions' and p.pronargs = 6),
  'the old six-argument requisition writer is gone (the new one takes the action name)');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'rf\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private RubberFlow helper (the purchase order writers included)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('rf_purchase_orders' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('request.jwt.claims' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_purchase_orders' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure))
          < position('rf_materials' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)),
  'the purge deletes purchase orders before materials and still sets the JWT claims aside');

-- ข้อจำกัดของตาราง (ใส่ตรงด้วยสิทธิ์เจ้าของตาราง ต้องถูกปฏิเสธ)
select throws_ok($$ insert into public.rf_materials (is_test, code, name, safety_kg) values (true, 'CK-1', 'x', -1) $$, '23514', null, 'a negative safety stock is refused by the table');
select throws_ok($$ insert into public.rf_materials (is_test, code, name, safety_kg) values (true, 'CK-1', 'x', 1000000001) $$, '23514', null, 'a safety stock above 1e9 is refused by the table');
select throws_ok($$ insert into public.rf_materials (is_test, code, name, shelf_life_days) values (true, 'CK-1', 'x', 0) $$, '23514', null, 'a shelf life of 0 days is refused by the table');
select throws_ok($$ insert into public.rf_materials (is_test, code, name, shelf_life_days) values (true, 'CK-1', 'x', 3651) $$, '23514', null, 'a shelf life above 3650 days is refused by the table');
select throws_ok($$ insert into public.rf_purchase_orders (is_test, po_no, lines) values (true, 'PO-1', '[{"materialCode":"A"}]'::jsonb) $$, '23514', null, 'a malformed order number is refused by the table');
select throws_ok($$ insert into public.rf_purchase_orders (is_test, po_no, lines, status) values (true, 'PO-20260101-01', '[{"materialCode":"A"}]'::jsonb, 'done') $$, '23514', null, 'an unknown status is refused by the table');
select throws_ok($$ insert into public.rf_purchase_orders (is_test, po_no, lines) values (true, 'PO-20260101-01', '[]'::jsonb) $$, '23514', null, 'an order without lines is refused by the table');
select throws_ok($$ insert into public.rf_purchase_orders (is_test, po_no, lines, source_pi) values (true, 'PO-20260101-01', '[{"materialCode":"A"}]'::jsonb, '') $$, '23514', null, 'an empty source PI is refused (null means none)');

-- 2. บัญชีทดสอบและแถวจริงที่ต้องไม่ถูกแตะ ---------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8f500000-0000-0000-0000-000000000001', 'rf3-admin@test.local', '{}'),
  ('8f500000-0000-0000-0000-000000000002', 'rf3-staff@test.local', '{}'),
  ('8f500000-0000-0000-0000-000000000003', 'mnplab001-rf3@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f500000-0000-0000-0000-000000000101', 'RF3-ADMIN', 'Rf', 'Admin', 'rf3-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f500000-0000-0000-0000-000000000001'),
  ('8f500000-0000-0000-0000-000000000102', 'RF3-STAFF-REAL', 'Rf', 'Staff', 'rf3-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8f500000-0000-0000-0000-000000000002'),
  ('8f500000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-rf3@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8f500000-0000-0000-0000-000000000003');
-- persona ผู้ดูแลระบบ (is_test): ไม่มี persona บทบาท admin ในชุดตั้งต้น แต่ persona คือพนักงานทดสอบคนไหนก็ได้ จึงเพิ่มไว้ตรวจว่า admin ยังสร้าง/รับ/ยกเลิกใบสั่งซื้อได้ (ไว้ตรวจปัญหา)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็นและ purge ไม่แตะ
insert into public.rf_materials (code, name) values ('REAL-MAT', 'วัตถุดิบจริง');
insert into public.rf_purchase_orders (po_no, lines) values ('PO-20260101-01', '[{"materialCode":"REAL-MAT","qtyKg":1}]'::jsonb);
select is((select count(*) from public.rf_purchase_orders where not is_test), 1::bigint, 'the real purchase order was inserted as a real (non-test) row');

-- ตัวช่วยของเทสต์ (schema แยก ลบพร้อม rollback): รันในฐานะผู้เรียก (authenticated) ผ่าน RPC สาธารณะเท่านั้น
create schema rf3_t;
grant usage on schema rf3_t to authenticated;
-- เวอร์ชันปัจจุบัน
create function rf3_t.ver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
-- ใบสั่งซื้อจาก snapshot (สำเนาที่ client ได้จากเซิร์ฟเวอร์) ทับด้วย patch
create function rf3_t.po_with(p_po text, p_patch jsonb) returns jsonb language sql stable as $$
  select p || p_patch from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_po
$$;
-- ใบใหม่จากแม่แบบ test.po
create function rf3_t.new_po(p_id text, p_patch jsonb default '{}'::jsonb) returns jsonb language sql stable as $$
  select current_setting('test.po')::jsonb || jsonb_build_object('id', p_id) || p_patch
$$;
create function rf3_t.create_po(p_po jsonb, p_base bigint default null, p_action text default 'createPurchaseOrder') returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(p_po))), coalesce(p_base, rf3_t.ver()), p_action)
$$;
-- สำเนาใบที่ทำเครื่องหมายว่าบรรทัด p_idx รับเข้าแล้ว (p_line / p_head ทับช่องของบรรทัด / ของใบ)
create function rf3_t.receipt_po(p_po text, p_idx integer, p_kg numeric, p_lot text, p_exp bigint, p_line jsonb default '{}'::jsonb, p_head jsonb default '{}'::jsonb)
returns jsonb language sql stable as $$
  select p || p_head || jsonb_build_object('lines', jsonb_set(p -> 'lines', array[p_idx::text],
    (p -> 'lines' -> p_idx) || jsonb_build_object('receivedKg', p_kg, 'lotNo', p_lot, 'expiry', p_exp) || p_line))
  from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_po
$$;
create function rf3_t.lot(p_lot text, p_code text, p_kg numeric, p_exp bigint, p_patch jsonb default '{}'::jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_object('lotNo', p_lot, 'materialCode', p_code, 'qtyKg', p_kg, 'initialKg', p_kg, 'expiry', p_exp,
                            'supplier', '', 'location', '', 'status', 'available', 'coa', false) || p_patch
$$;
create function rf3_t.recv(p_po jsonb, p_lots jsonb, p_base bigint default null, p_action text default 'receivePurchaseLine') returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(p_po)),
                                                'materialLots', jsonb_build_object('upsert', p_lots)), coalesce(p_base, rf3_t.ver()), p_action)
$$;
create function rf3_t.cancel_po(p_po text, p_base bigint default null, p_action text default 'cancelPurchaseOrder') returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.po_with(p_po, '{"status":"cancelled"}'::jsonb)))),
                            coalesce(p_base, rf3_t.ver()), p_action)
$$;
-- ใบใหม่พร้อมชุด materials ที่แก้ safetyKg ของวัตถุดิบ p_code เป็น p_safety (สำเนาแถวจาก snapshot) ส่งด้วยคำสั่ง p_action
create function rf3_t.create_po_safety(p_po jsonb, p_code text, p_safety numeric, p_action text default 'createPurchaseOrder') returns jsonb language sql volatile as $$
  select public.app_rf_save(jsonb_build_object(
    'materials', jsonb_build_object('upsert', jsonb_build_array((select m || jsonb_build_object('safetyKg', p_safety) from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = p_code))),
    'purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(p_po))), rf3_t.ver(), p_action)
$$;

select set_config('test.now_ms', (extract(epoch from now()) * 1000)::bigint::text, true);
select set_config('test.exp', ((extract(epoch from now()) * 1000)::bigint + 31536000000)::text, true);
select set_config('test.mat', '{"code":"X","name":"x","category":"เคมี","storage":"โกดัง A-1","uom":"kg","active":true}', true);
select set_config('test.po', '{"id":"PO-20261110-01","status":"ordered","sourcePi":"251110-25001","sourceRequisition":null,"note":"สั่งเคมีล็อตใหม่","lines":[{"materialCode":"MAT-A","needKg":100,"availableKg":20,"shortageKg":80,"safetyKg":60,"qtyKg":140},{"materialCode":"MAT-B","needKg":10,"availableKg":-5,"shortageKg":15,"safetyKg":20,"qtyKg":35}]}', true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save('{"purchaseOrders":{"upsert":[]}}'::jsonb, 0, 'createPurchaseOrder') $$, 'AUTH_REQUIRED', 'saving requires a session');
select set_config('request.jwt.claims', '{"sub":"8f500000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save('{"purchaseOrders":{"upsert":[]}}'::jsonb, 0, 'createPurchaseOrder') $$, 'RF_TEST_MODE_ONLY', 'a real PP staff account cannot save a purchase order (real mode is not open)');
select throws_ok('select count(*) from public.rf_purchase_orders', '42501', null, 'clients cannot read the purchase order table directly');
select throws_ok($$ insert into public.rf_purchase_orders (po_no, lines) values ('PO-20261110-99', '[{"materialCode":"X"}]'::jsonb) $$, '42501', null, 'clients cannot write the purchase order table directly');
select throws_ok($$ update public.rf_purchase_orders set status = 'received' $$, '42501', null, 'clients cannot update the purchase order table directly');
select set_config('request.jwt.claims', '{"sub":"8f500000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save('{"purchaseOrders":{"upsert":[]}}'::jsonb, 0, 'createPurchaseOrder') $$, 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot save a purchase order');
select set_config('request.jwt.claims', '{"sub":"8f500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save('{"purchaseOrders":{"upsert":[]}}'::jsonb, 0, 'createPurchaseOrder') $$, 'RF_TEST_MODE_ONLY', 'an admin outside test mode cannot save a purchase order');

-- 4. วัตถุดิบ: สต็อกสำรอง (safetyKg) และอายุเก็บ (shelfLifeDays) ------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_master() ->> 'version', '0', 'the test counter starts at 0');
select is(public.app_rf_master() -> 'purchaseOrders', '[]'::jsonb, 'the purchase order list starts empty and never shows the real order');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM","safetyKg":50,"shelfLifeDays":365}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"สารเลิกใช้","active":false}'::jsonb))), 0, 'saveMaterial') ->> 'version', '1',
  'a planner adds materials, one with safety stock and shelf life');
select is((select m - 'createdAt' from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A'),
  '{"code":"MAT-A","name":"ยาง EPDM","category":"เคมี","storage":"โกดัง A-1","uom":"kg","active":true,"safetyKg":50,"shelfLifeDays":365}'::jsonb,
  'a material carries its safety stock and shelf life');
select is((select m - 'createdAt' from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-B'),
  '{"code":"MAT-B","name":"เขม่าดำ","category":"เคมี","storage":"โกดัง A-1","uom":"kg","active":true,"safetyKg":0,"shelfLifeDays":180}'::jsonb,
  'a material saved without them starts at safety stock 0 and shelf life 180 days');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb))), 1, 'saveMaterial') ->> 'version', '1',
  'a material sent without the new fields (an older client) writes nothing');
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55"}'::jsonb))), 1, 'saveMaterial') ->> 'version', '2',
  'an older client can still edit a material');
select is((select (m ->> 'safetyKg') || '/' || (m ->> 'shelfLifeDays') from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A'), '50/365',
  'and the edit leaves the safety stock and shelf life alone');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","safetyKg":-1}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a negative safety stock is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","safetyKg":1000000001}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a safety stock above 1e9 is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","safetyKg":"10"}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a safety stock must be a number');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","shelfLifeDays":0}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a shelf life of 0 days is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","shelfLifeDays":3651}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a shelf life above 3650 days is refused');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","shelfLifeDays":12.5}'::jsonb))), 2, 'saveMaterial') $$, 'RF_INVALID_MATERIAL', 'a shelf life must be whole days');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ","safetyKg":20,"shelfLifeDays":90}'::jsonb))), 2, 'saveMaterial')
  -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'shelfLifeDays', '90', 'an RB member sets the safety stock and shelf life');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ","safetyKg":99}'::jsonb))), 3, 'saveMaterial') $$, 'RF_FORBIDDEN', 'ST staff cannot set the safety stock with saveMaterial');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ ใหม่"}'::jsonb))), 3, 'saveMaterial') $$, 'RF_FORBIDDEN', 'nor edit any other field of a material');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-NEW","name":"ใหม่"}'::jsonb))), 3, 'saveMaterial') $$, 'RF_FORBIDDEN', 'nor add a material');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ","safetyKg":99}'::jsonb))), 3, 'receiveMaterial') $$, 'RF_FORBIDDEN',
  'a materials list carried by another action is refused for ST staff too');
select is(public.app_rf_master() ->> 'version', '3', 'nothing was written by the refused calls');

-- 5. สร้างใบสั่งซื้อ -------------------------------------------------------------------------
-- 5.1 ปฏิเสธต่อบทบาท (มีแต่ ST และ admin ที่สร้างได้: กลุ่มวางแผน / ผู้จัดการแผนก / RB / QA / WH / SR / ผู้ช่วยผู้จัดการแผนกอื่น สร้างไม่ได้)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'PP staff (the planning group) cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'a department manager outside ST (planning group by role) cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'an RB member cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'an RB department manager cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'QA staff cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'WH staff cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'SR staff cannot create a purchase order');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01')) $$, 'RF_FORBIDDEN', 'an assistant manager of another department cannot create a purchase order');
select is(public.app_rf_master() ->> 'version', '3', 'nothing was written by the refused calls');

-- 5.2 รูปข้อมูลผิด (ST ผู้สร้างใบ; ชุด requisitions ผ่านประตูหยาบของ app_rf_save ได้เฉพาะกลุ่มวางแผน / RB จึงตรวจด้วย PP ส่วนที่ตรวจก่อนสิทธิ์รายใบ)
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03'), null, 'saveMaterial') $$, 'RF_INVALID_PURCHASE', 'purchase orders can only be sent with a purchase order action');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03'), null, 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'a new order cannot come with the receipt action');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_PURCHASE', 'a new order cannot come with the cancel action');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03'))),
  'requisitions', jsonb_build_object('upsert', jsonb_build_array('{}'::jsonb))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_FORBIDDEN',
  'ST staff cannot send a requisitions list at all (the coarse gate refuses it first)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03'))),
  'requisitions', jsonb_build_object('upsert', jsonb_build_array('{}'::jsonb))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_INVALID_PURCHASE',
  'creating an order cannot carry other lists (requisitions)');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03'))),
  'materialLots', jsonb_build_object('upsert', jsonb_build_array(rf3_t.lot('LOT-X', 'MAT-A', 10, current_setting('test.exp')::bigint)))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_INVALID_PURCHASE',
  'creating an order cannot carry stock lots');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-1')) $$, 'RF_INVALID_PURCHASE', 'an order number must look like PO-yyyymmdd-nn');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('po-20261110-03')) $$, 'RF_INVALID_PURCHASE', 'the order number prefix is upper case');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"status":"received"}')) $$, 'RF_INVALID_PURCHASE', 'a new order cannot start as received');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"status":"cancelled"}')) $$, 'RF_INVALID_PURCHASE', 'a new order cannot start as cancelled');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"status":"bogus"}')) $$, 'RF_INVALID_PURCHASE', 'an unknown status is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', jsonb_build_object('note', repeat('ก', 301)))) $$, 'RF_INVALID_PURCHASE', 'a note over 300 characters is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', jsonb_build_object('sourcePi', repeat('1', 61)))) $$, 'RF_INVALID_PURCHASE', 'a source PI over 60 characters is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[]}')) $$, 'RF_INVALID_PURCHASE', 'an order needs at least one line');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":{}}')) $$, 'RF_INVALID_PURCHASE', 'lines must be an array');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03') - 'lines') $$, 'RF_INVALID_PURCHASE', 'lines are required');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', jsonb_build_object('lines',
  (select jsonb_agg(jsonb_build_object('materialCode', 'M' || g, 'qtyKg', 1)) from generate_series(1, 101) g)))) $$, 'RF_INVALID_PURCHASE', 'more than 100 lines are refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":5},{"materialCode":"mat-a","qtyKg":5}]}')) $$, 'RF_INVALID_PURCHASE',
  'the same material twice (ignoring case) is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":0}]}')) $$, 'RF_INVALID_PURCHASE', 'a zero quantity is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":-3}]}')) $$, 'RF_INVALID_PURCHASE', 'a negative quantity is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A"}]}')) $$, 'RF_INVALID_PURCHASE', 'a line without a quantity is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":"5"}]}')) $$, 'RF_INVALID_PURCHASE', 'a quantity must be a number');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":5,"needKg":-1}]}')) $$, 'RF_INVALID_PURCHASE', 'a negative need is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"NOPE","qtyKg":5}]}')) $$, 'RF_INVALID_PURCHASE', 'an unknown material is refused');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-C","qtyKg":5}]}')) $$, 'RF_INVALID_PURCHASE', 'a retired material cannot be ordered');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', jsonb_build_object('lines', jsonb_build_array(
  jsonb_build_object('materialCode', 'MAT-A', 'qtyKg', 5, 'receivedKg', 5, 'lotNo', 'L-1', 'expiry', current_setting('test.exp')::bigint))))) $$, 'RF_INVALID_PURCHASE',
  'a new order cannot carry receipt data');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","qtyKg":5,"receivedKg":5}]}')) $$, 'RF_INVALID_PURCHASE', 'receipt data must be complete or absent');
-- วัตถุดิบที่พ่วงมากับใบสั่งซื้อแก้ได้เฉพาะ safetyKg (ชุด materials ผ่านประตูหยาบได้สำหรับ ST เฉพาะกับคำสั่ง createPurchaseOrder แล้วตัวเขียนวัตถุดิบตรวจช่อง)
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object(
  'materials', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"เปลี่ยนชื่อ","safetyKg":50,"shelfLifeDays":365}'::jsonb)),
  'purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03')))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_INVALID_MATERIAL',
  'an order cannot rename a material');
select throws_ok($$ select public.app_rf_save(jsonb_build_object(
  'materials', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM 55","safetyKg":50,"shelfLifeDays":30}'::jsonb)),
  'purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03')))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_INVALID_MATERIAL',
  'an order cannot change the shelf life');
select throws_ok($$ select public.app_rf_save(jsonb_build_object(
  'materials', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.mat')::jsonb || '{"code":"MAT-NEW","name":"ใหม่"}'::jsonb)),
  'purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(rf3_t.new_po('PO-20261110-03')))), rf3_t.ver(), 'createPurchaseOrder') $$, 'RF_INVALID_MATERIAL',
  'an order cannot create a material');
select is(public.app_rf_master() ->> 'version', '3', 'nothing was written by the refused calls');

-- 5.3 สร้างสำเร็จ: admin (พ่วงแก้ safetyKg) และ ST (จากส่วนที่ขาดของใบเบิก · พ่วงแก้ safetyKg ในหัวข้อ 7)
-- คนที่สร้างใบไม่ได้เปลี่ยนสต็อกขั้นต่ำของเคมีทางใบก็ไม่ได้: ชุด materials ที่พ่วงมาย้อนพร้อมใบที่ถูกปฏิเสธ (ไม่เขียนอะไรเลย)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN',
  'a planner cannot create an order even with a safety stock change (and nothing of it is written)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN',
  'an RB member cannot create an order even with a safety stock change (and nothing of it is written)');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN', 'QA staff cannot change a material safety stock together with an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN', 'WH staff cannot change a material safety stock together with an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN', 'SR staff cannot change a material safety stock together with an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60) $$, 'RF_FORBIDDEN',
  'an assistant manager of another department cannot change a material safety stock together with an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60, 'receivePurchaseLine') $$, 'RF_FORBIDDEN',
  'ST staff cannot carry a materials list with the receipt action');
select throws_ok($$ select rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-01'), 'MAT-A', 60, 'cancelPurchaseOrder') $$, 'RF_FORBIDDEN',
  'nor with the cancel action');
select is(public.app_rf_master() ->> 'version', '3', 'the refused calls wrote nothing');
select is((select (m ->> 'safetyKg')::numeric from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A'), 50::numeric, 'and the safety stock of the chemical is still 50');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select set_config('test.res', public.app_rf_save(jsonb_build_object(
  'materials', jsonb_build_object('upsert', jsonb_build_array((select m || '{"safetyKg":60}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-A'))),
  'purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.po')::jsonb || '{"createdBy":"ใครก็ได้","cancelledAt":5}'::jsonb))),
  3, 'createPurchaseOrder', '[{"action":"สั่งซื้อ","detail":"PO-20261110-01"}]'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', '4', 'admin creates an order and updates the safety stock in one save');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'ordered', 'the new order is ordered');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'createdBy', current_setting('test.n_sbx_admin_t'), 'the creator is the persona (the client value is ignored)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'cancelledAt', 'null'::jsonb, 'a cancel time sent by the client is ignored');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'createdAt')::numeric > 0, 'the creation time is set by the server');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0,
  '{"materialCode":"MAT-A","source":"rf","uom":null,"needKg":100,"availableKg":20,"shortageKg":80,"safetyKg":60,"qtyKg":140,"receivedKg":null,"lotNo":null,"expiry":null,"receivedAt":null,"receivedBy":null}'::jsonb,
  'a line is stored in the canonical shape with empty receipt fields');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 ->> 'availableKg', '-5', 'an availability below zero is kept');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'sourcePi', '251110-25001', 'the source PI is kept');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'safetyKg', '60', 'the safety stock edited with the order is saved');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(rf3_t.create_po(rf3_t.new_po('PO-20261110-02', '{"sourcePi":null,"sourceRequisition":"REQ-1"}')) -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'sourceRequisition', 'REQ-1',
  'ST staff creates an order from a requisition shortage');
select is(public.app_rf_master() -> 'purchaseOrders' -> 1 -> 'sourcePi', 'null'::jsonb, 'an order without a PI has a null source PI');
select is((select jsonb_agg(p ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p), '["PO-20261110-01","PO-20261110-02"]'::jsonb, 'orders are listed by number');

-- 5.4 เลขใบซ้ำ / สำเนาเดิม
select set_config('test.v_dup', rf3_t.ver()::text, true);
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01', '{"createdAt":1}')) $$, 'RF_CONFLICT', 'an order number that already exists is a conflict');
select throws_ok($$ select rf3_t.create_po(rf3_t.new_po('PO-20261110-01', '{"createdAt":1}'), 0) $$, 'RF_STALE', 'the same from an old base is stale (the order changed since)');
select is(rf3_t.create_po(rf3_t.po_with('PO-20261110-01', '{}'::jsonb)) ->> 'version', current_setting('test.v_dup'), 'saving an order exactly as stored writes nothing');
select is(rf3_t.create_po(rf3_t.po_with('PO-20261110-01', '{"createdBy":"คนอื่น"}'::jsonb)) ->> 'version', current_setting('test.v_dup'), 'a client value for a server-set field changes nothing');
select is(public.app_rf_master() ->> 'version', current_setting('test.v_dup'), 'the counter did not move');

-- 6. รับเข้า (ST หรือ admin) พร้อมสร้างล็อตในคำสั่งเดียวกัน ------------------------------------------
-- 6.1 ปฏิเสธ (กลุ่มวางแผน / ผู้จัดการแผนก / RB / QA / WH รับบรรทัดไม่ได้)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'PP staff (the planning group) cannot receive an order line');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'a department manager outside ST cannot receive an order line');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'QA staff cannot receive an order line');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'WH staff cannot receive an order line');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'an RB member cannot receive an order line');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select is(jsonb_array_length(public.app_rf_master() -> 'purchaseOrders'), 2, 'ST staff reads the orders');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint)), null, 'receiveMaterial') $$, 'RF_INVALID_PURCHASE',
  'an order cannot be sent with the plain stock receipt action');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint)), null, 'createPurchaseOrder') $$, 'RF_INVALID_PURCHASE',
  'a receipt with the create action is refused (and that action cannot carry stock lots)');
-- ล็อตขาด / ไม่ตรง / เกิน = ย้อนทั้งคำสั่ง
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint), '[]'::jsonb) $$, 'RF_INVALID_PURCHASE',
  'a receipt without its stock lot is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 130, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a lot with a different quantity is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint + 1000))) $$, 'RF_INVALID_PURCHASE', 'a lot with a different expiry is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-B', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a lot of another material is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('OTHER-1', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a lot with another lot number is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint), rf3_t.lot('EXTRA-1', 'MAT-A', 5, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE',
  'an extra stock lot in the same save is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint, '{"status":"hold"}'))) $$, 'RF_INVALID_TRANSITION', 'a lot cannot be received on hold');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.now_ms')::bigint - 1000),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.now_ms')::bigint - 1000))) $$, 'RF_INVALID_PURCHASE', 'an expiry in the past is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 0, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 1, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a received quantity of zero is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 1000000001, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 1, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a received quantity above 1e9 is refused');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'bad lot', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('bad lot', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE', 'a lot number with a space is refused');
select throws_ok($$ select rf3_t.recv((select jsonb_set(r, '{lines,1}', (r -> 'lines' -> 1) || jsonb_build_object('receivedKg', 35, 'lotNo', 'PO1-B', 'expiry', current_setting('test.exp')::bigint))
    from (select rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint) r) s),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint), rf3_t.lot('PO1-B', 'MAT-B', 35, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_PURCHASE',
  'two lines cannot be received in one save');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint, '{"qtyKg":999}'),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a receipt cannot change the ordered quantity');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint, '{}', '{"note":"แก้หมายเหตุ"}'),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a receipt cannot change the note');
select is(public.app_rf_master() ->> 'version', current_setting('test.v_dup'), 'nothing was written by the refused receipts (the lot rolled back with them)');
select is(jsonb_array_length(public.app_rf_master() -> 'materialLots'), 0, 'no stock lot exists yet');

-- 6.2 ST รับบรรทัดแรกตามจริง: ใบเปลี่ยนเป็นรับแล้วหนึ่งบรรทัด ล็อตใหม่เกิดในคำสั่งเดียวกัน เซิร์ฟเวอร์ตั้งเวลา/ผู้รับ (ค่าที่ client ส่งมาเมิน)
select set_config('test.res', rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A', current_setting('test.exp')::bigint, '{"receivedAt":1,"receivedBy":"ใครก็ได้"}'),
  jsonb_build_array(rf3_t.lot('PO1-A', 'MAT-A', 140, current_setting('test.exp')::bigint, '{"supplier":"PO-20261110-01"}')))::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.v_dup')::bigint + 1)::text, 'ST receives the first line and the counter moves once');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'ordered', 'the order stays ordered while a line is still open');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'receivedKg', '140', 'the line records the received quantity');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'lotNo', 'PO1-A', 'and the lot number');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'receivedBy', current_setting('test.n_sbx_st_staff'), 'the receiver is the persona (the client value is ignored)');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'receivedAt')::numeric > 1000, 'the receipt time is set by the server');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 -> 'receivedKg', 'null'::jsonb, 'the other line is still open');
select is((current_setting('test.res')::jsonb -> 'changes' -> 'materialLots' -> 'upsert' -> 0) - 'expiry' - 'receivedAt',
  '{"lotNo":"PO1-A","materialCode":"MAT-A","qtyKg":140,"initialKg":140,"supplier":"PO-20261110-01","location":"โกดัง A-1","status":"available","coa":false}'::jsonb
    || jsonb_build_object('receivedBy', current_setting('test.n_sbx_st_staff')),
  'the receipt created an available stock lot in the same save (location defaults to the material storage)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materialLots' -> 'upsert' -> 0 ->> 'expiry',
  current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'expiry', 'the lot and the line carry the same expiry');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materialLots' -> 'upsert' -> 0 ->> 'receivedAt',
  current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'receivedAt', 'and the same receipt time');
select is(jsonb_array_length(public.app_rf_master() -> 'materialLots'), 1, 'the stock lot is in the snapshot');

-- 6.3 รับซ้ำ / แก้บรรทัดที่รับแล้ว = RF_INVALID_TRANSITION
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 140, 'PO1-A2', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A2', 'MAT-A', 140, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a line that is already received cannot be received again with another lot');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 0, 100, 'PO1-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-A2', 'MAT-A', 100, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a received quantity cannot be corrected afterwards');
select is(jsonb_array_length(public.app_rf_master() -> 'materialLots'), 1, 'the refused receipts left no extra lot');

-- 6.4 admin รับบรรทัดที่เหลือ (รับตามจริงได้ 33 จากที่สั่ง 35) ใบครบทุกบรรทัด = received
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select set_config('test.res', rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 1, 33, 'PO1-B', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-B', 'MAT-B', 33, current_setting('test.exp')::bigint, '{"supplier":"PO-20261110-01"}')))::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'received', 'the order becomes received once every line is received');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 ->> 'receivedKg', '33', 'the received quantity can differ from the ordered quantity');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 ->> 'qtyKg', '35', 'and the ordered quantity is kept');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 ->> 'receivedBy', current_setting('test.n_sbx_admin_t'), 'admin can receive too (and the stock lot is written for admin as well)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materialLots' -> 'upsert' -> 0 ->> 'qtyKg', '33', 'the lot holds the received quantity');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-01', 1, 33, 'PO1-B2', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO1-B2', 'MAT-B', 33, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a received order cannot be received again');

-- 6.5 ชนรายระเบียนก่อนสิทธิ์: ใบ PO-02 ถูกคนอื่นรับบรรทัดแรกหลังเวอร์ชันฐานของ client
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.v2', rf3_t.ver()::text, true);
select is(rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 0, 140, 'PO2-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-A', 'MAT-A', 140, current_setting('test.exp')::bigint))) -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'ordered',
  'ST staff receives the first line of the second order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 0, 140, 'PO2-A2', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-A2', 'MAT-A', 140, current_setting('test.exp')::bigint)), current_setting('test.v2')::bigint) $$, 'RF_STALE',
  'ST staff holding an old copy gets a stale error instead of a second receipt');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 1, 35, 'PO2-B', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-B', 'MAT-B', 35, current_setting('test.exp')::bigint)), current_setting('test.v2')::bigint) $$, 'RF_STALE',
  'the stale check comes before the permission check (an RB member with an old copy gets RF_STALE)');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 1, 35, 'PO2-B', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-B', 'MAT-B', 35, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'with a current copy the same RB member is simply not allowed');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 1, 35, 'PO2-B', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-B', 'MAT-B', 35, current_setting('test.exp')::bigint)), current_setting('test.v2')::bigint) $$, 'RF_STALE',
  'the stale check also comes before the permission check for a planner with an old copy');
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-02', 1, 35, 'PO2-B', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO2-B', 'MAT-B', 35, current_setting('test.exp')::bigint))) $$, 'RF_FORBIDDEN', 'with a current copy the planner is simply not allowed to receive');

-- 7. ยกเลิก (ST หรือ admin เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้า) ------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(rf3_t.create_po(rf3_t.new_po('PO-20261110-03', '{"lines":[{"materialCode":"MAT-A","needKg":5,"availableKg":0,"shortageKg":5,"safetyKg":60,"qtyKg":5}]}')) is not null, 'ST staff creates a third order');
-- ST เปลี่ยน safetyKg ของเคมีเป็นส่วนหนึ่งของการสร้างใบ (MAT-B 20 -> 25): ช่องอื่นของวัตถุดิบไม่เปลี่ยน เวอร์ชัน RubberFlow เพิ่มหนึ่งครั้ง
select set_config('test.vs', rf3_t.ver()::text, true);
select set_config('test.res', rf3_t.create_po_safety(rf3_t.new_po('PO-20261110-04'), 'MAT-B', 25)::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.vs')::bigint + 1)::text, 'ST staff creates a fourth order and changes the safety stock of a chemical in one save');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materials' -> 'upsert' -> 0 ->> 'safetyKg', '25', 'the safety stock edited with the order is saved');
select is((select m - 'createdAt' from jsonb_array_elements(public.app_rf_master() -> 'materials') m where m ->> 'code' = 'MAT-B'),
  '{"code":"MAT-B","name":"เขม่าดำ","category":"เคมี","storage":"โกดัง A-1","uom":"kg","active":true,"safetyKg":25,"shelfLifeDays":90}'::jsonb,
  'and nothing else of the material changed');
select is((select count(*) from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = 'PO-20261110-04'), 1::bigint, 'the order was created');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-03') $$, 'RF_FORBIDDEN', 'an RB member cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-03') $$, 'RF_FORBIDDEN', 'PP staff (the planning group) cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-03') $$, 'RF_FORBIDDEN', 'a department manager outside ST cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-03') $$, 'RF_FORBIDDEN', 'QA staff cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-03') $$, 'RF_FORBIDDEN', 'an assistant manager of another department cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-02') $$, 'RF_INVALID_TRANSITION', 'an order with a received line cannot be cancelled');
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-01') $$, 'RF_INVALID_TRANSITION', 'a received order cannot be cancelled');
select throws_ok($$ select rf3_t.cancel_po('PO-20261110-04', null, 'createPurchaseOrder') $$, 'RF_INVALID_PURCHASE', 'cancelling needs the cancel action');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-04', '{"status":"cancelled","note":"แก้พร้อมยกเลิก"}'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION',
  'a cancel cannot edit anything else');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-04', '{"note":"แก้หมายเหตุ"}'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION', 'nothing but receipt and cancel edits an order (note)');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-04', jsonb_build_object('lines',
  jsonb_set((select p -> 'lines' from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = 'PO-20261110-04'), '{0,qtyKg}', '999'))), null, 'cancelPurchaseOrder') $$,
  'RF_INVALID_TRANSITION', 'nothing but receipt and cancel edits an order (quantity)');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-01', '{"status":"ordered"}'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION', 'a received order cannot go back to ordered');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(rf3_t.cancel_po('PO-20261110-04') -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'admin cancels the fourth order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.vc', rf3_t.ver()::text, true);
select set_config('test.res', rf3_t.cancel_po('PO-20261110-03')::text, true);
select is(current_setting('test.res')::jsonb ->> 'version', (current_setting('test.vc')::bigint + 1)::text, 'ST staff cancels an order that has no received line');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'the order is cancelled');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'cancelledAt')::numeric > 1000, 'the cancel time is set by the server');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert'), 1, 'the reply lists only the cancelled order');
select is(rf3_t.cancel_po('PO-20261110-03') ->> 'version', (current_setting('test.vc')::bigint + 1)::text, 'cancelling a cancelled order again writes nothing');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-03', '{"status":"ordered"}'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION', 'a cancelled order cannot be reopened');
select throws_ok($$ select rf3_t.create_po(rf3_t.po_with('PO-20261110-03', '{"note":"แก้ทีหลัง"}'), null, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION', 'a cancelled order cannot be edited');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select rf3_t.recv(rf3_t.receipt_po('PO-20261110-03', 0, 5, 'PO3-A', current_setting('test.exp')::bigint),
  jsonb_build_array(rf3_t.lot('PO3-A', 'MAT-A', 5, current_setting('test.exp')::bigint))) $$, 'RF_INVALID_TRANSITION', 'a cancelled order cannot be received');
select is(public.app_rf_master() ->> 'version', (current_setting('test.vc')::bigint + 1)::text, 'nothing was written by the refused calls');

-- 8. snapshot / delta / audit -------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_rf_master() - 'version' - 'epoch')), 12::bigint, 'the snapshot has twelve lists');
select is((select jsonb_agg(p ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p),
  '["PO-20261110-01","PO-20261110-02","PO-20261110-03","PO-20261110-04"]'::jsonb, 'the orders are listed by number');
select is(public.app_rf_master_since(0) -> 'changes', (select jsonb_object_agg(l, jsonb_build_object('upsert', public.app_rf_master() -> l, 'delete', '[]'::jsonb))
  from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'the delta from version 0 equals the snapshot for all twelve lists');
select is((select count(*) from jsonb_object_keys(public.app_rf_master_since(0) -> 'changes')), 12::bigint, 'the delta names twelve lists');
select is(jsonb_array_length(public.app_rf_master_since(current_setting('test.vc')::bigint) -> 'changes' -> 'purchaseOrders' -> 'upsert'), 1, 'the delta after the cancel holds only that order');
select is(public.app_rf_master_since(current_setting('test.vc')::bigint) -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'id', 'PO-20261110-03', 'and it is the cancelled one');
select is(public.app_rf_master_since(current_setting('test.vc')::bigint) -> 'changes' -> 'purchaseOrders' -> 'delete', '[]'::jsonb, 'orders are never deleted');
select is(jsonb_array_length(public.app_rf_master_since(current_setting('test.vc')::bigint + 1) -> 'changes' -> 'purchaseOrders' -> 'upsert'), 0, 'a client at the current version gets an empty order delta');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'createPurchaseOrder' and a ->> 'user' = current_setting('test.n_sbx_admin_t')
                  and a -> 'entries' -> 0 ->> 'detail' = 'PO-20261110-01'), 'the history records the order with the persona and the client entry');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'receivePurchaseLine' and a ->> 'user' = current_setting('test.n_sbx_st_staff')
                  and a ->> 'detail' like '%purchaseOrders +1%' and a ->> 'detail' like '%materialLots +1%'), 'the history records the receipt by ST with both lists');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'cancelPurchaseOrder' and a ->> 'user' = current_setting('test.n_sbx_st_staff'))
      and exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'cancelPurchaseOrder' and a ->> 'user' = current_setting('test.n_sbx_admin_t')), 'and the cancels by ST and by admin');

-- 9. แยกโหมด และล้างข้อมูลทดสอบ ----------------------------------------------------------------------
reset role;
select is((select count(*) from public.rf_purchase_orders where is_test), 4::bigint, 'four test orders exist before the purge');
select ok((select bool_and(changed_version > 0) from public.rf_purchase_orders where is_test), 'every test order is stamped with the version that changed it');
select is((select max(changed_version) from public.rf_purchase_orders where is_test) <= (select version from public.rf_master_state where is_test), true, 'no order is newer than the counter');
select is((select count(*) from public.rf_purchase_orders where not is_test), 1::bigint, 'the real order is untouched');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f500000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('test.pre_version', public.app_rf_master() ->> 'version', true);
select set_config('test.purge', public.app_sandbox_purge_rf()::text, true);
select ok((current_setting('test.purge')::jsonb ->> 'deleted')::integer > 8, 'the purge reports the rows it deleted (orders included)');
select is(public.app_rf_master() - 'epoch', (select jsonb_build_object('version', current_setting('test.pre_version')::bigint) || jsonb_object_agg(l, '[]'::jsonb)
  from unnest(array['materials','recipes','orders','molds','materialLots','requisitions','lots','transfers','fgBoxes','qcRecords','ncrs','purchaseOrders']) l),
  'all twelve lists are empty again and the counter keeps its value');
reset role;
select is((select count(*) from public.rf_purchase_orders where is_test), 0::bigint, 'no test order is left');
select is((select count(*) from public.rf_purchase_orders where not is_test), 1::bigint, 'the real order survives the purge');

select * from finish();
rollback;
