-- รับของตามใบสั่งซื้อหลายครั้ง · ปิดยอดที่เหลือ · ย้อนรับเข้าคลัง / ย้อนส่งมอบสินค้าสำเร็จรูป (20261128020000_bom_po_partial_fg_reverse.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกกติกา:
--   ใบสั่งซื้อ: รับเคมีซ้ำบรรทัดเดิม (ล็อตใหม่ต่อครั้ง ยอดล็อต = ส่วนต่าง) · รับของซื้อซ้ำ (บวกสต็อกเฉพาะครั้งนี้ ประวัติหนึ่งแถวต่อครั้ง) · ยอดสะสมลด = แก้ไม่ได้
--     · บรรทัดครบรับอีกไม่ได้ · รายการรับ / closedRemainder ของ client ถูกเมิน · ปิดยอดที่เหลือ ST / admin เหตุผล 3-300 · บรรทัดครบปิดไม่ได้ · ปิดแล้วรับไม่ได้
--     · ยกเลิกใบที่มีบรรทัดปิดแล้วไม่ได้ · ใบใหม่ที่มีคำขอปิด = RF_INVALID_PURCHASE · บรรทัดรุ่นเก่า (รับครั้งเดียว ไม่มี receipts) ถือว่าครบ
--   สินค้าสำเร็จรูป: ย้อนได้เฉพาะ admin / ผู้จัดการแผนก WH · รูปคำขอ · แถวของใบอื่น / ไม่ใช่รับหรือส่งมอบ · ย้อนซ้ำ · ส่งมอบไปแล้วมากกว่าที่จะเหลือ
--     · ใบอื่นหยิบสต็อกไปแล้ว · ใบที่ปิดแล้วเปิดกลับ และปิดเองอีกครั้งเมื่อรับใหม่ครบ · ย้อนส่งมอบแล้วยกเลิกใบได้ · ใบที่ยกเลิกย้อนไม่ได้ · snapshot reversesId · audit
-- (authenticated อ่านตาราง bom_* / rf_* ตรงไม่ได้ จึงอ่านตารางและเรียก private.* ด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok(not exists (
    select 1 from unnest(array[
      'private.rf_po_line_received(jsonb)', 'private.rf_po_line_done(jsonb)', 'private.rf_po_parse_lines(jsonb)',
      'private.rf_save_purchase_orders(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)', 'private.rf_client_actions()',
      'private.bom_fg_total(uuid,text,text)', 'private.bom_fg_return_stock(uuid,uuid)', 'private.bom_fg_reverse(public.employees,jsonb)',
      'private.bom_records(bigint)', 'private.bom_client_actions()']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')),
  'clients cannot call the replaced or new private helpers');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_save_purchase_orders(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_fg_return_stock(uuid,uuid)'::regprocedure, 'private.bom_fg_reverse(public.employees,jsonb)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the writers are security definer with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_po_line_received(jsonb)'::regprocedure, 'private.rf_po_line_done(jsonb)'::regprocedure,
                           'private.rf_po_parse_lines(jsonb)'::regprocedure, 'private.bom_fg_total(uuid,text,text)'::regprocedure)),
  'the sql helpers keep an empty search_path');
select ok(not exists (select 1 from unnest(array['public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the two save RPCs keep their grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok('closePurchaseLine' = any (private.rf_client_actions()) and 'returnRequisition' = any (private.rf_client_actions()) and 'receivePurchaseLine' = any (private.rf_client_actions()),
  'closePurchaseLine is on the RubberFlow action whitelist and the earlier actions stay');
select ok('reverseFg' = any (private.bom_client_actions()) and not ('reverseFg' = any (private.bom_staff_actions()))
          and array['receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder'] <@ private.bom_staff_actions(),
  'reverseFg is a client action but not a staff action (staff are refused at the coarse gate)');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bom_fg_moves' and column_name = 'reverses_id'), 1::bigint,
  'the move table has the reverses_id column');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_fg_moves'::regclass and c.contype = 'f'
                  and pg_get_constraintdef(c.oid) like '%(reverses_id, is_test) REFERENCES %bom_fg_moves(id, is_test)%'),
  'a reversal references the move it reverses with a foreign key paired with is_test');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_fg_moves_reverses_idx' and indexdef like '%UNIQUE%' and indexdef like '%reverses_id IS NOT NULL%'),
  'a move can be reversed once (partial unique index)');
-- กติกาบรรทัดใบสั่งซื้อ (ตัวช่วยเดียวกับที่ตัวเขียนใช้)
select is(private.rf_po_line_received('{"qtyKg":10,"receivedKg":9,"receipts":[{"kg":4},{"kg":5}]}'::jsonb), 9::numeric, 'received sums the receipts');
select is(private.rf_po_line_received('{"qtyKg":10,"receivedKg":6}'::jsonb), 6::numeric, 'a legacy line reads its single receipt');
select is(private.rf_po_line_received('{"qtyKg":10,"receivedKg":null}'::jsonb), 0::numeric, 'an open line has received nothing');
select ok(private.rf_po_line_done('{"qtyKg":10,"receivedKg":6}'::jsonb), 'a legacy line received once is done (closed), even short');
select ok(not private.rf_po_line_done('{"qtyKg":10,"receivedKg":6,"receipts":[{"kg":6}]}'::jsonb), 'a new-style line received short is still open');
select ok(private.rf_po_line_done('{"qtyKg":10,"receivedKg":10,"receipts":[{"kg":6},{"kg":4}]}'::jsonb), 'a line received in full is done');
select ok(private.rf_po_line_done('{"qtyKg":10,"receivedKg":12,"receipts":[{"kg":12}]}'::jsonb), 'an over-receipt is done');
select ok(private.rf_po_line_done('{"qtyKg":10,"receivedKg":null,"closedRemainder":{"kg":10,"reason":"ไม่ส่งแล้ว"}}'::jsonb), 'a closed line is done');
select ok(not private.rf_po_line_done('{"qtyKg":10,"receivedKg":null}'::jsonb), 'an untouched line is open');

-- ข้อจำกัดของตาราง (ใส่ตรงด้วยสิทธิ์เจ้าของตาราง: ข้อมูลจริง ไม่ใช่โหมดทดสอบ)
insert into public.bom_orders (pi_no, customer, country, order_type, ordered_at, wh_due) values ('REAL-B2-PI', 'ลูกค้าจริง', 'TH', 'SA', 1762300000000, 1762400000000);
insert into public.bom_fg_moves (id, order_pk, fg_code, kind, qty)
  select '0b200000-0000-0000-0000-000000000001', o.id, 'REAL-ITEM', 'receive', 5 from public.bom_orders o where not o.is_test and o.pi_no = 'REAL-B2-PI';
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note) select o.id, 'REAL-ITEM', 'unreceive', 5, 'ย้อนทดสอบ' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  '23514', null, 'a reversal must name the move it reverses');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note, reverses_id) select o.id, 'REAL-ITEM', 'unreceive', 5, 'ab', '0b200000-0000-0000-0000-000000000001' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  '23514', null, 'a reversal needs a reason of at least three characters');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, reverses_id) select o.id, 'REAL-ITEM', 'receive', 5, '0b200000-0000-0000-0000-000000000001' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  '23514', null, 'a receipt cannot carry reverses_id');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note, reverses_id) select o.id, 'REAL-ITEM', 'unreceive', 5, 'ย้อนทดสอบ', '00000000-0000-0000-0000-000000000000' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  '23503', null, 'a reversal must point at an existing move');
select lives_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note, reverses_id) select o.id, 'REAL-ITEM', 'unreceive', 5, 'ย้อนทดสอบ', '0b200000-0000-0000-0000-000000000001' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  'a well formed reversal is accepted by the table');
select throws_ok($$ insert into public.bom_fg_moves (order_pk, fg_code, kind, qty, note, reverses_id) select o.id, 'REAL-ITEM', 'unreceive', 5, 'ย้อนซ้ำ', '0b200000-0000-0000-0000-000000000001' from public.bom_orders o where o.pi_no = 'REAL-B2-PI' $$,
  '23505', null, 'the same move cannot be reversed twice (unique index)');

-- 2. บัญชีทดสอบ ตัวช่วย และค่าที่ใช้ซ้ำ ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8e920000-0000-0000-0000-000000000001', 'bomb2-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e920000-0000-0000-0000-000000000101', 'BOMB2-ADMIN', 'Bomb2', 'Admin', 'bomb2-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e920000-0000-0000-0000-000000000001');
-- persona (is_test) เพิ่ม: ผู้จัดการแผนก WH และผู้ดูแลระบบ (ไม่มีในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-WH-MGR-T', 'ทดสอบ', 'ผจก. WH', 'sbx-wh-mgr-t@sandbox.local', 'ผจก. แผนก WH (ทดสอบ)',
   (select id from public.departments where code = 'WH'), (select id from public.roles where code = 'department_manager'), false, true),
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select ok((select count(*) from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH' and r.code <> 'department_manager')
                                or (e.employee_no = 'SBX-WH-MGR-T' and d.code = 'WH' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-PK-MGR' and d.code = 'PK' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ST-STAFF' and d.code = 'ST') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK'))) = 6,
  'the personas used below belong to the departments and roles the rules name');
select set_config('test.exp', ((extract(epoch from now()) * 1000)::bigint + 31536000000)::text, true);

create schema b2_t;
grant usage on schema b2_t to authenticated;
create function b2_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function b2_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function b2_t.rf(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, coalesce(p_base, b2_t.rver()), p_action)
$$;
create function b2_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, b2_t.bver(), p_action)
$$;
create function b2_t.po(p_no text) returns jsonb language sql stable as $$
  select p from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_no
$$;
-- สำเนาใบที่บรรทัด p_idx ถูกทับด้วย p_line (ช่องของบรรทัด) · ส่งด้วย p_action พร้อมล็อต p_lots
create function b2_t.po_line(p_no text, p_idx integer, p_line jsonb) returns jsonb language sql stable as $$
  select p || jsonb_build_object('lines', jsonb_set(p -> 'lines', array[p_idx::text], (p -> 'lines' -> p_idx) || p_line)) from jsonb_array_elements(public.app_rf_master() -> 'purchaseOrders') p where p ->> 'id' = p_no
$$;
create function b2_t.po_send(p_po jsonb, p_action text, p_lots jsonb default '[]'::jsonb) returns jsonb language sql volatile as $$
  select b2_t.rf(jsonb_build_object('purchaseOrders', jsonb_build_object('upsert', jsonb_build_array(p_po)))
                 || case when jsonb_array_length(p_lots) > 0 then jsonb_build_object('materialLots', jsonb_build_object('upsert', p_lots)) else '{}'::jsonb end, p_action)
$$;
create function b2_t.lot(p_lot text, p_code text, p_kg numeric) returns jsonb language sql stable as $$
  select jsonb_build_object('lotNo', p_lot, 'materialCode', p_code, 'qtyKg', p_kg, 'initialKg', p_kg, 'expiry', current_setting('test.exp')::bigint,
                            'supplier', '', 'location', '', 'status', 'available', 'coa', false)
$$;
-- รับเคมีบรรทัด p_idx ให้ยอดสะสมเป็น p_total พร้อมล็อตใหม่ p_lot ขนาด p_lot_kg
create function b2_t.recv_chem(p_no text, p_idx integer, p_total numeric, p_lot text, p_lot_kg numeric) returns jsonb language sql volatile as $$
  select b2_t.po_send(b2_t.po_line(p_no, p_idx, jsonb_build_object('receivedKg', p_total, 'lotNo', p_lot, 'expiry', current_setting('test.exp')::bigint)),
                      'receivePurchaseLine', jsonb_build_array(b2_t.lot(p_lot, (b2_t.po(p_no) -> 'lines' -> p_idx ->> 'materialCode'), p_lot_kg)))
$$;
create function b2_t.recv_part(p_no text, p_idx integer, p_total numeric) returns jsonb language sql volatile as $$
  select b2_t.po_send(b2_t.po_line(p_no, p_idx, jsonb_build_object('receivedKg', p_total)), 'receivePurchaseLine')
$$;
create function b2_t.close_line(p_no text, p_idx integer, p_reason text, p_action text default 'closePurchaseLine') returns jsonb language sql volatile as $$
  select b2_t.po_send(b2_t.po_line(p_no, p_idx, jsonb_build_object('closedRemainder', jsonb_build_object('reason', p_reason))), p_action)
$$;
create function b2_t.part_qty(p_code text) returns numeric language sql stable as $$
  select (s ->> 'qty')::numeric from jsonb_array_elements(public.app_bom_master() -> 'stock') s where s ->> 'itemCode' = p_code
$$;
create function b2_t.part_moves(p_code text) returns integer language sql stable as $$
  select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'stockMoves') m where m ->> 'itemCode' = p_code and m ->> 'kind' = 'receive'
$$;
-- BOM: แถวใบ / งาน / ประวัติสินค้าสำเร็จรูป
create function b2_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function b2_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function b2_t.report(p_no text, p_good numeric, p_status text) returns jsonb language sql volatile as $$
  select b2_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    b2_t.job(p_no) || jsonb_build_object('status', p_status, 'qtyDone', (b2_t.job(p_no) ->> 'qtyDone')::numeric + p_good,
      'reports', (b2_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', '')))))), 'reportJob')
$$;
create function b2_t.fg(p_row jsonb, p_action text) returns jsonb language sql volatile as $$
  select b2_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
create function b2_t.receive(p_order text, p_qty numeric) returns jsonb language sql volatile as $$
  select b2_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'receive', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', p_qty))), 'receiveFg')
$$;
create function b2_t.deliver(p_order text, p_qty numeric) returns jsonb language sql volatile as $$
  select b2_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'deliver', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', p_qty))), 'deliverFg')
$$;
create function b2_t.reverse(p_order text, p_move text, p_note text default 'บันทึกผิดจำนวน', p_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select b2_t.fg(jsonb_build_object('orderId', p_order, 'kind', 'reverse', 'moveId', p_move, 'note', p_note) || p_extra, 'reverseFg')
$$;
-- id ของแถวประวัติลำดับที่ p_nth (เริ่ม 1) ของใบ p_order ชนิด p_kind ยอด p_qty
create function b2_t.move_id(p_order text, p_kind text, p_qty numeric) returns text language sql stable as $$
  select m ->> 'id' from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m
  where m ->> 'orderId' = p_order and m ->> 'kind' = p_kind and (m ->> 'qty')::numeric = p_qty limit 1
$$;
create function b2_t.audit() returns text language sql stable as $$ select public.app_bom_audit(1) -> 0 ->> 'detail' $$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"PK","itemCode":"FG-A","name":"แพ็กสินค้า","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":[],"reports":[]}', true);

-- 3. ข้อมูลตั้งต้น -----------------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e920000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(b2_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"MAT-A","name":"ยาง EPDM","category":"เคมี","storage":"A-1","uom":"kg","active":true}'::jsonb))), 'saveMaterial') is not null, 'the planner adds a chemical');
select ok(b2_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 'importFlat') is not null, 'the planner seeds a finished good and a purchased part');

-- 4. ใบสั่งซื้อ: รับหลายครั้ง ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(b2_t.po_send('{"id":"PO-20261128-01","status":"ordered","sourcePi":null,"sourceRequisition":null,"note":"",
  "lines":[{"materialCode":"MAT-A","needKg":100,"availableKg":0,"shortageKg":100,"safetyKg":0,"qtyKg":100},
           {"materialCode":"P-1","source":"bom","needKg":50,"availableKg":0,"shortageKg":50,"safetyKg":0,"qtyKg":50}]}'::jsonb, 'createPurchaseOrder') is not null,
  'ST orders 100 kg of the chemical and 50 boxes');
select throws_ok($$ select b2_t.po_send('{"id":"PO-20261128-09","status":"ordered","sourcePi":null,"sourceRequisition":null,"note":"",
  "lines":[{"materialCode":"MAT-A","needKg":1,"availableKg":0,"shortageKg":1,"safetyKg":0,"qtyKg":1,"closedRemainder":{"reason":"ปิดตั้งแต่สร้าง"}}]}'::jsonb, 'createPurchaseOrder') $$,
  'RF_INVALID_PURCHASE', 'a new order cannot carry a close request');
select ok(not (b2_t.po('PO-20261128-01') -> 'lines' -> 0 ? 'closedRemainder'), 'a created line has no closedRemainder key (the shape of a new line is unchanged)');
-- 4.1 เคมี: รับ 60 แล้ว 40 (ล็อตใหม่ต่อครั้ง ยอดล็อต = ส่วนต่าง)
select throws_ok($$ select b2_t.recv_chem('PO-20261128-01', 0, 60, 'B2-A1', 50) $$, 'RF_INVALID_PURCHASE', 'the lot must hold exactly the quantity received this time');
select set_config('test.res', b2_t.recv_chem('PO-20261128-01', 0, 60, 'B2-A1', 60)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'ordered', 'a short first receipt keeps the order open');
select is(b2_t.po('PO-20261128-01') -> 'lines' -> 0 ->> 'receivedKg', '60', 'the line holds the cumulative quantity');
select is(jsonb_array_length(b2_t.po('PO-20261128-01') -> 'lines' -> 0 -> 'receipts'), 1, 'and one receipt');
select is((b2_t.po('PO-20261128-01') -> 'lines' -> 0 -> 'receipts' -> 0) - 'at' - 'expiry',
  jsonb_build_object('kg', 60, 'lotNo', 'B2-A1', 'by', current_setting('test.n_sbx_st_staff')), 'the receipt names its quantity, lot and receiver');
select throws_ok($$ select b2_t.recv_chem('PO-20261128-01', 0, 50, 'B2-A9', 50) $$, 'RF_INVALID_TRANSITION', 'a lower cumulative quantity (a correction) is refused');
select throws_ok($$ select b2_t.recv_chem('PO-20261128-01', 0, 100, 'B2-A2', 100) $$, 'RF_INVALID_PURCHASE', 'the second lot cannot hold the cumulative quantity');
select set_config('test.res', b2_t.recv_chem('PO-20261128-01', 0, 100, 'B2-A2', 40)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'materialLots' -> 'upsert' -> 0 ->> 'qtyKg', '40', 'the second receipt creates a lot of 40 kg');
select is(b2_t.po('PO-20261128-01') -> 'lines' -> 0 ->> 'receivedKg', '100', 'the line holds 100 kg in total');
select is(b2_t.po('PO-20261128-01') -> 'lines' -> 0 ->> 'lotNo', 'B2-A2', 'the line shows the latest lot');
select is((select jsonb_agg(r ->> 'lotNo') from jsonb_array_elements(b2_t.po('PO-20261128-01') -> 'lines' -> 0 -> 'receipts') r), '["B2-A1","B2-A2"]'::jsonb, 'both receipts are kept in order');
select throws_ok($$ select b2_t.recv_chem('PO-20261128-01', 0, 110, 'B2-A3', 10) $$, 'RF_INVALID_TRANSITION', 'a line received in full cannot be received again');
select is(b2_t.po('PO-20261128-01') ->> 'status', 'ordered', 'the order is still open for the part line');
-- 4.2 ของซื้อ: รับ 20 แล้ว 10 (สต็อกบวกเฉพาะครั้งนี้ ประวัติหนึ่งแถวต่อครั้ง)
select set_config('test.res', b2_t.recv_part('PO-20261128-01', 1, 20)::text, true);
select is(b2_t.part_qty('P-1'), 20::numeric, 'the first part receipt adds 20');
select set_config('test.res', b2_t.recv_part('PO-20261128-01', 1, 30)::text, true);
select is(b2_t.part_qty('P-1'), 30::numeric, 'the second adds only the 10 received this time');
select is(b2_t.part_moves('P-1'), 2, 'one receive move per receipt');
select is((select jsonb_agg((r ->> 'kg')::numeric) from jsonb_array_elements(b2_t.po('PO-20261128-01') -> 'lines' -> 1 -> 'receipts') r), '[20, 10]'::jsonb, 'the part line keeps both receipts');
select is(b2_t.po('PO-20261128-01') ->> 'status', 'ordered', '20 boxes are still on order');
-- 4.3 client ปลอมรายการรับ / ยอดที่ปิดไม่ได้ (เซิร์ฟเวอร์สร้างเอง): ส่งมาแค่รายการรับ = ไม่เปลี่ยนอะไร
select set_config('test.vr', b2_t.rver()::text, true);
select is(b2_t.po_send(b2_t.po_line('PO-20261128-01', 1, '{"receipts":[{"kg":999,"at":1,"by":"x"}]}'::jsonb), 'receivePurchaseLine') ->> 'version', current_setting('test.vr'),
  'a forged receipt list alone writes nothing');
select is(jsonb_array_length(b2_t.po('PO-20261128-01') -> 'lines' -> 1 -> 'receipts'), 2, 'the stored receipts are untouched');

-- 5. ปิดยอดที่เหลือ ---------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, 'ผู้ขายส่งไม่ครบ') $$, 'RF_FORBIDDEN', 'the planning group cannot close a remainder');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, 'ผู้ขายส่งไม่ครบ') $$, 'RF_FORBIDDEN', 'WH staff cannot close a remainder');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, 'ผู้ขายส่งไม่ครบ') $$, 'RF_FORBIDDEN', 'an RB member cannot close a remainder');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, 'ab') $$, 'RF_INVALID_PURCHASE', 'a reason shorter than three characters is refused');
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, '   ') $$, 'RF_INVALID_PURCHASE', 'a blank reason is refused');
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, repeat('ก', 301)) $$, 'RF_INVALID_PURCHASE', 'a reason above 300 characters is refused');
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 1, 'ผู้ขายส่งไม่ครบ', 'receivePurchaseLine') $$, 'RF_INVALID_PURCHASE', 'closing needs the close action');
select throws_ok($$ select b2_t.close_line('PO-20261128-01', 0, 'ปิดบรรทัดที่ครบแล้ว') $$, 'RF_INVALID_TRANSITION', 'a line received in full cannot be closed');
select throws_ok($$ select b2_t.po_send(b2_t.po_line('PO-20261128-01', 1, '{"closedRemainder":{"reason":"ผู้ขายส่งไม่ครบ"}}'::jsonb), 'closePurchaseLine',
  jsonb_build_array(b2_t.lot('B2-X1', 'MAT-A', 1))) $$, 'RF_INVALID_PURCHASE', 'closing cannot carry a stock lot');
select throws_ok($$ select b2_t.po_send(b2_t.po_line('PO-20261128-01', 1, '{"receivedKg":35,"closedRemainder":{"reason":"รับแล้วปิด"}}'::jsonb), 'closePurchaseLine') $$,
  'RF_INVALID_PURCHASE', 'a receipt and a close cannot come in one save');
select set_config('test.res', b2_t.close_line('PO-20261128-01', 1, '  ผู้ขายส่งไม่ครบ ไม่รับส่วนที่เหลือ  ')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 ->> 'status', 'received', 'closing the last open line completes the order');
select is((b2_t.po('PO-20261128-01') -> 'lines' -> 1 -> 'closedRemainder') - 'at',
  jsonb_build_object('kg', 20, 'reason', 'ผู้ขายส่งไม่ครบ ไม่รับส่วนที่เหลือ', 'by', current_setting('test.n_sbx_st_staff')), 'the line records the 20 boxes not received, the trimmed reason and who closed it');
select is(b2_t.part_qty('P-1'), 30::numeric, 'closing does not touch the stock');
select is(b2_t.part_moves('P-1'), 2, 'and writes no stock move');
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'closePurchaseLine' and a ->> 'user' = current_setting('test.n_sbx_st_staff')),
  'the history records the close');
-- 5.1 ใบที่มีบรรทัดปิดแล้วยกเลิกไม่ได้ · ปิดแล้วรับไม่ได้ · client ลบการปิดไม่ได้ · admin ปิดได้
select ok(b2_t.po_send('{"id":"PO-20261128-02","status":"ordered","sourcePi":null,"sourceRequisition":null,"note":"",
  "lines":[{"materialCode":"MAT-A","needKg":5,"availableKg":0,"shortageKg":5,"safetyKg":0,"qtyKg":5},
           {"materialCode":"P-1","source":"bom","needKg":5,"availableKg":0,"shortageKg":5,"safetyKg":0,"qtyKg":5}]}'::jsonb, 'createPurchaseOrder') is not null, 'ST orders again');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(b2_t.close_line('PO-20261128-02', 1, 'ไม่ต้องใช้แล้ว') -> 'changes' -> 'purchaseOrders' -> 'upsert' -> 0 -> 'lines' -> 1 -> 'closedRemainder' ->> 'kg', '5',
  'admin closes a line that received nothing (the whole 5 boxes are dropped)');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select b2_t.recv_part('PO-20261128-02', 1, 5) $$, 'RF_INVALID_TRANSITION', 'a closed line cannot be received');
select throws_ok($$ select b2_t.po_send(b2_t.po('PO-20261128-02') || '{"status":"cancelled"}'::jsonb, 'cancelPurchaseOrder') $$, 'RF_INVALID_TRANSITION',
  'an order with a closed line cannot be cancelled');
select set_config('test.vr', b2_t.rver()::text, true);
select is(b2_t.po_send(b2_t.po_line('PO-20261128-02', 1, '{"closedRemainder":null}'::jsonb), 'closePurchaseLine') ->> 'version', current_setting('test.vr'),
  'a client cannot remove a close (the stored close is kept, nothing is written)');
select is(b2_t.po('PO-20261128-02') -> 'lines' -> 1 -> 'closedRemainder' ->> 'reason', 'ไม่ต้องใช้แล้ว', 'the close is still stored');
-- 5.2 บรรทัดรุ่นเก่า (รับครั้งเดียวก่อนไฟล์นี้: มี receivedKg ไม่มี receipts) ถือว่าครบ รับซ้ำไม่ได้
reset role;
select set_config('request.jwt.claims', '', true);
update public.rf_purchase_orders set lines = jsonb_set(lines, '{0}', (lines -> 0) || '{"receivedKg":2,"lotNo":"OLD-1","expiry":1900000000000}'::jsonb)
  where is_test and po_no = 'PO-20261128-02';
select set_config('request.jwt.claims', '{"sub":"8e920000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select b2_t.recv_chem('PO-20261128-02', 0, 5, 'B2-OLD', 3) $$, 'RF_INVALID_TRANSITION', 'a legacy line received once (short) counts as closed and cannot be received again');
select throws_ok($$ select b2_t.close_line('PO-20261128-02', 0, 'ปิดบรรทัดเก่า') $$, 'RF_INVALID_TRANSITION', 'nor closed again');

-- 6. สินค้าสำเร็จรูป: ข้อมูลตั้งต้น ---------------------------------------------------------------------------
--   26001 FG-A 10 · PK ทำ 12 (ส่วนเกิน 2) · 26002 FG-A 2 ใช้สต็อกทั้งหมด (หยิบส่วนเกินของ 26001) · 26003 FG-A 10 (เส้นทางหลัก) · 26004 FG-A 5 (ยกเลิก)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(b2_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', (select jsonb_agg(current_setting('test.ord')::jsonb || jsonb_build_object('id', t.no,
      'items', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', t.qty, 'colorSet', 'A', 'note', '')),
      'explosion', jsonb_build_array(jsonb_build_object('itemCode', 'FG-A', 'level', 0, 'fgQty', t.qty, 'required', t.qty))) order by t.no)
    from (values ('251128-26001', 10), ('251128-26002', 2), ('251128-26003', 10), ('251128-26004', 5)) t(no, qty)))), 'createOrder') is not null,
  'the planner creates four orders');
select ok(b2_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(b2_t.order_row('251128-26001') || '{"status":"released"}'::jsonb,
                                                          b2_t.order_row('251128-26003') || '{"status":"released"}'::jsonb,
                                                          b2_t.order_row('251128-26004') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-26001","orderId":"251128-26001","qtyPlanned":12,"qtyRequired":12}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-26003","orderId":"251128-26003"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-26004","orderId":"251128-26004","qtyPlanned":5,"qtyRequired":5}'::jsonb))), 'releaseOrder') is not null,
  'the planner releases three orders with their packing jobs');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select ok(b2_t.report('JOB-26001', 12, 'done') is not null, 'PK packs 12 for order 26001');
select ok(b2_t.report('JOB-26003', 10, 'done') is not null, 'PK packs 10 for order 26003');
select ok(b2_t.report('JOB-26004', 3, 'in_progress') is not null, 'PK packs 3 of 5 for order 26004');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(b2_t.receive('251128-26001', 10) -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'WH receives 10 and order 26001 closes');
select ok(b2_t.receive('251128-26001', 2) is not null, 'WH receives the surplus 2 as stock');
select ok(b2_t.receive('251128-26003', 4) is not null, 'WH receives 4 for order 26003');
select ok(b2_t.receive('251128-26003', 6) is not null, 'then 6');
select is(b2_t.order_row('251128-26003') ->> 'status', 'completed', 'order 26003 closed on the full receipt');
select ok(b2_t.deliver('251128-26003', 5) is not null, 'WH delivers 5 of order 26003');
select ok(b2_t.receive('251128-26004', 3) is not null, 'WH receives 3 of order 26004');
select ok(b2_t.deliver('251128-26004', 3) is not null, 'and delivers them');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(b2_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(b2_t.order_row('251128-26002') || '{"status":"released","stockCounts":{"FG-A":2}}'::jsonb))),
  'releaseOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'order 26002 is released entirely from the surplus of 26001');
select set_config('test.r1a', b2_t.move_id('251128-26001', 'receive', 10), true);
select set_config('test.r1b', b2_t.move_id('251128-26001', 'receive', 2), true);
select set_config('test.r3a', b2_t.move_id('251128-26003', 'receive', 4), true);
select set_config('test.r3b', b2_t.move_id('251128-26003', 'receive', 6), true);
select set_config('test.d3', b2_t.move_id('251128-26003', 'deliver', 5), true);
select set_config('test.d4', b2_t.move_id('251128-26004', 'deliver', 3), true);
select set_config('test.r4', b2_t.move_id('251128-26004', 'receive', 3), true);

-- 7. ย้อน: สิทธิ์และรูปคำขอ --------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.r3a')), 'BOM_FORBIDDEN', 'WH staff cannot reverse a receipt');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.d3')), 'BOM_FORBIDDEN', 'nor a delivery');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.r3a')), 'BOM_FORBIDDEN', 'the planning group cannot reverse');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.r3a')), 'BOM_FORBIDDEN', 'a department manager of another department cannot reverse');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select set_config('test.vb', b2_t.bver()::text, true);
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L, 'ab') $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'a reason shorter than three characters is refused');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L, '    ') $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'a blank reason is refused');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L, repeat('ก', 301)) $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'a reason above 300 characters is refused');
select throws_ok($$ select b2_t.reverse('251128-26003', 'not-a-uuid') $$, 'BOM_INVALID_FG', 'the move id must be a uuid');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L, 'บันทึกผิดจำนวน', '{"kind":"receive"}') $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'the request kind must be reverse');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L, 'บันทึกผิดจำนวน', '{"lines":[{"fgCode":"FG-A","qty":1}]}') $$, current_setting('test.r3a')), 'BOM_INVALID_FG',
  'a reversal carries no lines (the whole move is reversed)');
select throws_ok($$ select b2_t.save('{"fgMoves":{"upsert":[]}}'::jsonb, 'reverseFg') $$, 'BOM_INVALID_FG', 'an empty request is refused');
select throws_ok(format($$ select b2_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('orderId', '251128-26003', 'kind', 'reverse', 'moveId', %L, 'note', 'บันทึกผิดจำนวน'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(b2_t.job('JOB-26003')))), 'reverseFg') $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'the reverse action carries the request only');
select throws_ok(format($$ select b2_t.reverse('251128-26001', %L) $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'a move of another order is refused');
select throws_ok($$ select b2_t.reverse('251128-26003', '00000000-0000-0000-0000-000000000000') $$, 'BOM_INVALID_FG', 'an unknown move is refused');
select throws_ok(format($$ select b2_t.reverse('251128-26002', %L) $$, b2_t.move_id('251128-26002', 'transfer', 2)), 'BOM_INVALID_FG', 'a stock transfer cannot be reversed');
select throws_ok(format($$ select b2_t.reverse('251128-26999', %L) $$, current_setting('test.r3a')), 'BOM_INVALID_FG', 'an unknown order is refused');
select is(b2_t.bver(), current_setting('test.vb')::bigint, 'none of the refused calls wrote anything');

-- 8. ย้อน: ยอด ----------------------------------------------------------------------------------------------
-- ใบอื่นหยิบส่วนเกินของ 26001 ไปแล้ว (out 2): ย้อนรับเข้าใดๆ ที่ทำให้เหลือไม่พอจำนวนสั่ง = BOM_FG_EXCEEDS
select throws_ok(format($$ select b2_t.reverse('251128-26001', %L) $$, current_setting('test.r1b')), 'BOM_FG_EXCEEDS', 'a receipt whose surplus another order already took cannot be reversed');
select throws_ok(format($$ select b2_t.reverse('251128-26001', %L) $$, current_setting('test.r1a')), 'BOM_FG_EXCEEDS', 'nor the main receipt of that order');
-- 26003: รับ 4 + 6 ส่งมอบ 5 · ย้อนรับ 6 จะเหลือ 4 น้อยกว่าที่ส่งมอบแล้ว 5 = BOM_FG_EXCEEDS
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.r3b')), 'BOM_FG_EXCEEDS', 'a receipt cannot be reversed below what was delivered (reverse the delivery first)');
-- ย้อนรับ 4: เหลือ 6 >= ส่งมอบ 5 · ใบที่ปิดแล้วมีของไม่ครบ = เปิดกลับ
select set_config('test.res', b2_t.reverse('251128-26003', current_setting('test.r3a'), '  พิมพ์ผิด ต้องเป็น 40  ')::text, true);
select is((current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert' -> 0) - 'id' - 'at',
  jsonb_build_object('orderId', '251128-26003', 'fgCode', 'FG-A', 'kind', 'unreceive', 'qty', 4, 'note', 'พิมพ์ผิด ต้องเป็น 40', 'by', current_setting('test.n_sbx_wh_mgr_t'),
                     'reversesId', current_setting('test.r3a')),
  'the WH manager reverses the receipt of 4: the reversal row names the original, the trimmed reason and the manager');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'the closed order reopens because it no longer has every product');
select ok(not (current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ? 'completedAt'), 'and its completion time is cleared');
select is(b2_t.audit(), 'fgMoves +1, orders +1', 'audited with the reversal and the reopened order');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, current_setting('test.r3a')), 'BOM_INVALID_TRANSITION', 'a move cannot be reversed twice');
select throws_ok(format($$ select b2_t.reverse('251128-26003', %L) $$, b2_t.move_id('251128-26003', 'unreceive', 4)), 'BOM_INVALID_FG', 'a reversal cannot itself be reversed');
-- admin ย้อนการส่งมอบ 5 แล้วย้อนรับ 6 ได้ (ส่งมอบสุทธิ 0)
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(b2_t.reverse('251128-26003', current_setting('test.d3'), 'ส่งผิดใบ') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'undeliver', 'admin reverses the delivery');
select is(b2_t.audit(), 'fgMoves +1', 'a delivery reversal does not touch the order');
select is(b2_t.reverse('251128-26003', current_setting('test.r3b'), 'รับซ้ำ') -> 'changes' -> 'fgMoves' -> 'upsert' -> 0 ->> 'kind', 'unreceive', 'then the receipt of 6 can be reversed too');
-- รับใหม่ครบ: ใบปิดเองอีกครั้งตามกติกาเดิม (PK ทำ 10 รับสุทธิ 0)
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select b2_t.receive('251128-26003', 11) $$, 'BOM_FG_EXCEEDS', 'the receipt ceiling uses the net received quantity (10 left, not 0)');
select is(b2_t.receive('251128-26003', 10) -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed', 'receiving the correct 10 closes the order again');
select is((select jsonb_agg(m ->> 'kind') from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'orderId' = '251128-26003'),
  '["receive","receive","deliver","unreceive","undeliver","unreceive","receive"]'::jsonb, 'the history keeps every original and reversal row');
select ok((select bool_and((m ? 'reversesId') = (m ->> 'kind' in ('unreceive', 'undeliver'))) from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m),
  'only reversal rows carry reversesId in the snapshot');
select is(public.app_bom_master_since(0) -> 'changes' -> 'fgMoves', jsonb_build_object('upsert', public.app_bom_master() -> 'fgMoves', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the move snapshot');
-- ส่งมอบสุทธิเป็นเพดาน: ส่งได้อีก 10 (ไม่ใช่ 5)
select ok(b2_t.deliver('251128-26003', 10) is not null, 'the delivery ceiling uses the net delivered quantity');

-- 9. ย้อนส่งมอบแล้วยกเลิกใบได้ · ใบที่ยกเลิกย้อนไม่ได้ -------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select b2_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  b2_t.order_row('251128-26004') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb))), 'cancelOrder') $$, 'BOM_INVALID_TRANSITION', 'an order with a net delivery cannot be cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select ok(b2_t.reverse('251128-26004', current_setting('test.d4'), 'ส่งผิด ลูกค้ายกเลิก') is not null, 'the WH manager reverses the delivery');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(b2_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  b2_t.order_row('251128-26004') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb))), 'cancelOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled',
  'once the delivery is reversed the order can be cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select throws_ok(format($$ select b2_t.reverse('251128-26004', %L) $$, current_setting('test.r4')), 'BOM_INVALID_TRANSITION', 'a cancelled order cannot be reversed');

-- 10. แยกโหมด ---------------------------------------------------------------------------------------------
reset role;
select ok((select bool_and(changed_version > 0) from public.bom_fg_moves where is_test), 'every test move is stamped with the version that wrote it');
select is((select count(*) from public.bom_fg_moves where not is_test), 2::bigint, 'the real rows are untouched');

select * from finish();
rollback;
