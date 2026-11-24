-- โรงงาน ขั้น 4: คลังสินค้าสำเร็จรูป (WH) รับกล่องจาก RB ส่งมอบให้ลูกค้า และย้อนรายการ (20261207010000_wh_rb_boxes.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง (คอลัมน์ / check / ฟังก์ชัน / สิทธิ์) · ปลายทางของล็อตตกแต่ง (sr / customer / กัก · WO ที่ผูกงานและไม่ผูก)
-- · receiveBoxes (แผนก WH ทุกบทบาท / admin · กลุ่มวางแผน RB QA SR ไม่ได้ · ทั้งล็อต · นับยอดเข้างาน RB ครั้งเดียว · ส่งซ้ำไม่เขียน)
-- · shipBoxes (แผนก WH / admin · กลุ่มวางแผนไม่ได้แล้ว) · reverseBoxShip / reverseBoxReceipt (ผู้จัดการแผนก WH / admin · เหตุผล · ถอนยอด · กล่องส่งมอบแล้ว / กัก / ใบปิด)
-- · QA กัก / ปล่อยหลัง WH รับ (ผ่านซ้ำย้ายเฉพาะกล่องที่กัก) · QA fail ถอนยอดที่นับเข้างาน RB (ใบปิดแล้ว = บันทึก fail ได้ ไม่ถอนยอด) · กล่องเดิมได้วันที่รับ
-- · ผู้ใช้จริงนอกโหมดทดสอบ (RF_TEST_MODE_ONLY) · ชุดเรคอร์ด
-- (authenticated อ่านตาราง rf_* / bom_* ตรงไม่ได้ จึงอ่านตารางและแก้ข้อมูลตั้งต้นด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------------------------------
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ', ' order by a.attname)
           from pg_attribute a where a.attrelid = 'public.rf_lots'::regclass and a.attname in ('destination', 'wh_credit_job_no', 'wh_credit_qty') and not a.attisdropped),
  'destination:text:false, wh_credit_job_no:text:false, wh_credit_qty:numeric:false', 'a finishing lot has an optional destination and an optional WH credit');
select is((select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text, ', ' order by a.attname)
           from pg_attribute a where a.attrelid = 'public.rf_fg_boxes'::regclass and a.attname in ('customer', 'customer_po', 'received_at', 'received_by', 'moves') and not a.attisdropped),
  'customer:text:true, customer_po:text:true, moves:jsonb:true, received_at:timestamp with time zone:false, received_by:uuid:false',
  'a box carries its customer, its PO, its receipt and its history');
select ok(pg_get_constraintdef((select c.oid from pg_constraint c where c.conrelid = 'public.rf_fg_boxes'::regclass and c.conname = 'rf_fg_boxes_status_check')) like '%pending_wh%',
  'a box may wait for the WH receipt');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.rf_fg_boxes'::regclass and c.conname = 'rf_fg_boxes_receipt_check')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.rf_lots'::regclass and c.conname = 'rf_lots_destination_check')
      and exists (select 1 from pg_constraint c where c.conrelid = 'public.rf_lots'::regclass and c.conname = 'rf_lots_wh_credit_check'),
  'the receipt, destination and credit checks exist');
select ok(to_regprocedure('private.rf_save_boxes(uuid,boolean,jsonb,bigint,bigint)') is null, 'the old box writer signature is gone');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_save_boxes(public.employees,text,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_box_credit(text,public.rf_lots)'::regprocedure, 'private.rf_box_uncredit(text,public.rf_lots,text,text)'::regprocedure,
                           'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_records(bigint)'::regprocedure, 'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the new and replaced writers are security definer with an empty search_path');
select ok(not exists (
    select 1 from unnest(array['private.rf_save_boxes(public.employees,text,text,jsonb,bigint,bigint)', 'private.rf_box_credit(text,public.rf_lots)',
                               'private.rf_box_uncredit(text,public.rf_lots,text,text)', 'private.rf_client_actions()', 'private.rf_records(bigint)']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')),
  'clients cannot call the private helpers');
select ok(not has_function_privilege('anon', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute')
      and has_function_privilege('authenticated', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the RubberFlow save keeps its grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(array['receiveBoxes', 'reverseBoxReceipt', 'reverseBoxShip', 'shipBoxes', 'recordFinishing', 'closePurchaseLine'] <@ private.rf_client_actions(),
  'the three box actions are on the RubberFlow whitelist and the earlier actions stay');
-- กล่องก่อนไฟล์นี้ที่อยู่ในคลัง / ส่งมอบแล้วได้วันที่รับเข้า (= วันที่สร้าง) จาก migration จึงไม่มีกล่องที่อยู่ในคลังโดยไม่มีวันที่รับ
select is((select count(*)::integer from public.rf_fg_boxes where status in ('in_stock', 'shipped') and received_at is null), 0,
  'boxes in stock or shipped before this change carry a receipt time (backfilled from created_at)');

-- 2. บัญชีทดสอบ บัญชีจริง และตัวช่วย ----------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8ef00000-0000-0000-0000-000000000001', 'whbox-admin@test.local', '{}'),
  ('8ef00000-0000-0000-0000-000000000002', 'whbox-wh@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ef00000-0000-0000-0000-000000000101', 'WHBOX-ADMIN', 'Whbox', 'Admin', 'whbox-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ef00000-0000-0000-0000-000000000001'),
  ('8ef00000-0000-0000-0000-000000000102', 'WHBOX-WH', 'Whbox', 'WH', 'whbox-wh@test.local', 'Warehouse',
   (select id from public.departments where code = 'WH'), (select id from public.roles where code = 'staff'), '8ef00000-0000-0000-0000-000000000002');
-- persona (is_test) เพิ่ม: ผู้จัดการแผนก WH และผู้ดูแลระบบ (ไม่มีในชุดตั้งต้น)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-WH-MGR-T', 'ทดสอบ', 'ผจก. WH', 'sbx-wh-mgr-t@sandbox.local', 'ผจก. แผนก WH (ทดสอบ)',
   (select id from public.departments where code = 'WH'), (select id from public.roles where code = 'department_manager'), false, true),
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH' and r.code = 'staff')
                                or (e.employee_no = 'SBX-WH-MGR-T' and d.code = 'WH' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-ADMIN-T' and r.code = 'admin')
                                or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP') or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB' and r.code = 'staff')
                                or (e.employee_no = 'SBX-RB-MGR' and d.code = 'RB' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-QA-STAFF' and d.code = 'QA') or (e.employee_no = 'SBX-SR-STAFF' and d.code = 'SR'))), 8,
  'the personas used below belong to the departments and roles the rules name');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF')
      and (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-WH-MGR-T')
      and (select not private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-WH-STAFF'),
  'PP staff and the WH department manager are planners, WH staff are not');

create schema wb_t;
grant usage on schema wb_t to authenticated;
create function wb_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, (public.app_rf_master() ->> 'version')::bigint, p_action)
$$;
create function wb_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function wb_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function wb_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, wb_t.bver(), p_action)
$$;
create function wb_t.box(p_id text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') x where x ->> 'id' = p_id
$$;
create function wb_t.lot(p_id text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = p_id
$$;
create function wb_t.job(p_id text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_id
$$;
create function wb_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
-- สถานะของทุกกล่องของล็อต เรียงตามเลขกล่อง เช่น 'pending_wh,pending_wh'
create function wb_t.states(p_lot text) returns text language sql stable as $$
  select string_agg(x ->> 'status', ',' order by x ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') x where x ->> 'lotId' = p_lot
$$;
-- แถวคำขอของกล่อง: เรคอร์ดปัจจุบัน + status ใหม่ (+ รายการย้อน {kind, note} ต่อท้าย moves เมื่อ p_kind ไม่ว่าง)
create function wb_t.row_of(p_box jsonb, p_to text, p_kind text, p_note text) returns jsonb language sql stable as $$
  select p_box || jsonb_build_object('status', p_to)
    || case when p_kind is null then '{}'::jsonb
            else jsonb_build_object('moves', coalesce(p_box -> 'moves', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('kind', p_kind, 'note', p_note))) end
$$;
-- ทุกกล่องของล็อตที่อยู่ในสถานะ p_from (ไม่เกิน p_limit กล่อง)
create function wb_t.lot_rows(p_lot text, p_from text, p_to text, p_kind text, p_note text, p_limit integer) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(wb_t.row_of(t.x, p_to, p_kind, p_note) order by t.x ->> 'id'), '[]'::jsonb)
  from (select x from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') x
        where x ->> 'lotId' = p_lot and x ->> 'status' = p_from order by x ->> 'id' limit p_limit) t
$$;
create function wb_t.boxes(p_rows jsonb, p_action text) returns jsonb language sql volatile as $$
  select wb_t.rf(jsonb_build_object('fgBoxes', jsonb_build_object('upsert', p_rows)), p_action)
$$;
create function wb_t.receive(p_lot text) returns jsonb language sql volatile as $$
  select wb_t.boxes(wb_t.lot_rows(p_lot, 'pending_wh', 'in_stock', null, null, 1000), 'receiveBoxes')
$$;
create function wb_t.unreceive(p_lot text, p_note text) returns jsonb language sql volatile as $$
  select wb_t.boxes(wb_t.lot_rows(p_lot, 'in_stock', 'pending_wh', 'unreceive', p_note, 1000), 'reverseBoxReceipt')
$$;
create function wb_t.ship(p_box text) returns jsonb language sql volatile as $$
  select wb_t.boxes(jsonb_build_array(wb_t.row_of(wb_t.box(p_box), 'shipped', null, null)), 'shipBoxes')
$$;
create function wb_t.unship(p_box text, p_kind text, p_note text) returns jsonb language sql volatile as $$
  select wb_t.boxes(jsonb_build_array(wb_t.row_of(wb_t.box(p_box), 'in_stock', p_kind, p_note)), 'reverseBoxShip')
$$;
create function wb_t.finish(p_extra jsonb) returns jsonb language sql volatile as $$
  select wb_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
    '{"id":"X","stage":"finishing","orderId":"X","uom":"pcs","shift":"E","grade":"A","sources":[],"params":{},"goodQty":0,"scrapQty":0,"scrapReason":"","qc":"pass"}'::jsonb
    || p_extra))), 'recordFinishing')
$$;
create function wb_t.bom_audit(p_action text) returns integer language sql stable as $$
  select count(*)::integer from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = p_action
$$;

-- 3. ข้อมูลตั้งต้น: สูตรอนุมัติ · ใบ PI ปล่อยผลิตที่มีงาน RB 100 เส้น · WO-L ผูกงาน · WO-U ขายเป็นสินค้า · ใบส่งมอบถึงสถานีตกแต่ง -----------------
select set_config('request.jwt.claims', '{"sub":"8ef00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select wb_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"สารตัวเร่ง"}'::jsonb))), 'saveMaterial');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select wb_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"RC-W","revision":1,"productCode":"P-W","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1},{"materialCode":"MAT-C","phr":10,"stage":2}],"status":"draft"}'::jsonb))),
  'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select wb_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert',
  (select jsonb_agg(r || '{"status":"approved"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-W'))), 'approveRecipe');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select wb_t.save('{"items":{"upsert":[
  {"code":"FG-W","kind":"FG","name":"สินค้า W","ownerDept":"PK","uom":"set"},
  {"code":"SE-W","kind":"SE","name":"ชิ้นยาง W","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-W","kind":"RB","name":"เส้นยาง W","ownerDept":"RB","uom":"pcs"}]}}'::jsonb, 'importFlat');
select wb_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"251205-27001","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[{"fgCode":"FG-W","qty":10,"colorSet":"A","note":""}],"explosion":[{"itemCode":"FG-W","kind":"FG","level":0,"fgQty":10,"required":10},{"itemCode":"SE-W","kind":"SE","level":1,"fgQty":10,"required":20},{"itemCode":"RB-W","kind":"RB","level":2,"fgQty":10,"required":100}],"explodedAt":null,"stockCounts":{},"note":""}'::jsonb))),
  'createOrder');
select set_config('test.job', '{"id":"X","orderId":"251205-27001","dept":"RB","itemCode":"RB-W","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-W"],"reports":[]}', true);
select wb_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(wb_t.order_row('251205-27001') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-W-RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-W-GR","dept":"GR","itemCode":"SE-W","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-W-PK","dept":"PK","itemCode":"FG-W","kind":"FG","uom":"set"}'::jsonb))), 'releaseOrder');
select is(wb_t.order_row('251205-27001') ->> 'status', 'released', 'the order is released');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"PI-27001","recipeId":"RC-W","recipeRevision":1,"color":"ดำ","targetQty":1000,"targetKg":17.5,"kgPerUnit":0.125,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select wb_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-L","sourceJobId":"JOB-W-RB"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-U","customer":"BETA Co.","customerPo":"PO-U9"}'::jsonb))), 'createOrder');
select is(wb_t.job('JOB-W-RB') -> 'externalRef' ->> 'woId', 'WO-L', 'WO-L is linked to the RB job (WO-U is a work order for sale)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select wb_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert',
  (select jsonb_agg(w || '{"status":"released"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' in ('WO-L', 'WO-U')))), 'setOrderStatus');
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no in ('WO-L', 'WO-U');
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values
  (true, 'CU-L1', 'curing', 'WO-L', 'pcs', 300, 'pass', 300),
  (true, 'CU-U1', 'curing', 'WO-U', 'pcs', 100, 'pass', 100);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-L1', 'CU-L1', 'WO-L', 'curing', 'finishing', 'pcs', 300, 0, 'in_transit'),
  (true, 'TR-U1', 'CU-U1', 'WO-U', 'curing', 'finishing', 'pcs', 100, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select wb_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert',
  (select jsonb_agg(x || jsonb_build_object('status', 'received', 'qtyReceived', (x ->> 'qtySent')::numeric))
   from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' in ('TR-L1', 'TR-U1')))), 'receiveTransfer');

-- 4. ปลายทางของล็อตตกแต่ง: ปฏิเสธ ----------------------------------------------------------------------------------------------------
select throws_ok($$ select wb_t.finish('{"id":"FN-BAD1","orderId":"WO-L","goodQty":10,"destination":"customer","sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":10}]}'::jsonb) $$,
  'RF_INVALID_LOT', 'a linked lot sent to the customer needs pieces per box');
select throws_ok($$ select wb_t.finish('{"id":"FN-BAD2","orderId":"WO-U","goodQty":10,"destination":"sr","params":{"perBox":10},"sources":[{"type":"transfer","id":"TR-U1","lotId":"CU-U1","qty":10}]}'::jsonb) $$,
  'RF_INVALID_LOT', 'a work order for sale cannot send its lot to the SR store');
select throws_ok($$ select wb_t.finish('{"id":"FN-BAD3","orderId":"WO-L","goodQty":10,"qc":"hold","destination":"sr","sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":10}]}'::jsonb) $$,
  'RF_INVALID_LOT', 'a lot on hold has no destination');
select throws_ok($$ select wb_t.finish('{"id":"FN-BAD4","orderId":"WO-L","goodQty":10,"destination":"gift","params":{"perBox":10},"sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":10}]}'::jsonb) $$,
  'RF_INVALID_LOT', 'an unknown destination is refused');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' like 'FN-BAD%'), 0, 'the refused saves wrote no lot');

-- 5. ปลายทางของล็อตตกแต่ง: บันทึก ---------------------------------------------------------------------------------------------------
select set_config('test.bv', wb_t.bver()::text, true);
select set_config('test.res', wb_t.finish('{"id":"FN-C1","orderId":"WO-L","goodQty":60,"destination":"customer","params":{"perBox":25},"sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":60}]}'::jsonb)::text, true);
select is(wb_t.lot('FN-C1') ->> 'destination', 'customer', 'a linked lot sent to the customer keeps its destination');
select is(wb_t.lot('FN-C1') ->> 'boxes', '3', '60 pieces at 25 per box make three boxes');
select is(wb_t.states('FN-C1'), 'pending_wh,pending_wh,pending_wh', 'the boxes wait for the WH receipt');
select is(jsonb_build_object('qty', (wb_t.box('BOX-C1-003') ->> 'qty')::numeric, 'customer', wb_t.box('BOX-C1-003') ->> 'customer',
                             'customerPo', wb_t.box('BOX-C1-003') ->> 'customerPo', 'moves', wb_t.box('BOX-C1-003') -> 'moves', 'orderId', wb_t.box('BOX-C1-003') ->> 'orderId'),
  jsonb_build_object('qty', 10, 'customer', 'ACME', 'customerPo', 'PI-27001', 'moves', '[]'::jsonb, 'orderId', 'WO-L'),
  'the last box holds the rest and carries the customer and the PI of the work order, with an empty history');
select ok(wb_t.box('BOX-C1-001') -> 'receivedAt' is null and wb_t.box('BOX-C1-001') -> 'shippedAt' is null, 'a waiting box has no receipt and no shipment');
select ok(wb_t.lot('FN-C1') -> 'whCredit' = 'null'::jsonb, 'nothing is credited yet');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = 'FN-C1'), 0, 'a lot for the customer makes no rod lot');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric, 0::numeric, 'the RB job is not counted at finishing');
select is(wb_t.bver(), current_setting('test.bv')::bigint, 'and the BOM counter does not move');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-L'), '60', 'the work order counts its progress');

select lives_ok($$ select wb_t.finish('{"id":"FN-S1","orderId":"WO-L","goodQty":20,"sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":20}]}'::jsonb) $$,
  'a linked lot without a destination is recorded (Pilot before this change)');
select is(wb_t.lot('FN-S1') ->> 'destination' || '/' || (wb_t.lot('FN-S1') ->> 'boxes'), 'sr/0', 'it goes to the SR store without boxes as before');
select is((select l ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = 'FN-S1'), 'pending', 'and becomes a pending rod lot');
select lives_ok($$ select wb_t.finish('{"id":"FN-S2","orderId":"WO-L","goodQty":10,"destination":"sr","sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":10}]}'::jsonb) $$,
  'a linked lot sent to the SR store on purpose is recorded');
select is(wb_t.lot('FN-S2') ->> 'destination' || '/' || (select l ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = 'FN-S2'),
  'sr/pending', 'the SR path is unchanged');
select lives_ok($$ select wb_t.finish('{"id":"FN-LH","orderId":"WO-L","goodQty":10,"qc":"hold","sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":10}]}'::jsonb) $$,
  'a linked lot on hold is recorded');
select ok(wb_t.lot('FN-LH') -> 'destination' = 'null'::jsonb and wb_t.lot('FN-LH') ->> 'boxes' = '0', 'without destination and without boxes');
select lives_ok($$ select wb_t.finish('{"id":"FN-C2","orderId":"WO-L","goodQty":50,"destination":"customer","params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-L1","lotId":"CU-L1","qty":50}]}'::jsonb) $$,
  'a second linked lot goes to the customer');

select lives_ok($$ select wb_t.finish('{"id":"FN-U1","orderId":"WO-U","goodQty":40,"params":{"perBox":20},"sources":[{"type":"transfer","id":"TR-U1","lotId":"CU-U1","qty":40}]}'::jsonb) $$,
  'a lot of a work order for sale is recorded without a destination');
select is(wb_t.lot('FN-U1') ->> 'destination' || '/' || wb_t.states('FN-U1'), 'customer/pending_wh,pending_wh',
  'it goes to the customer through WH: its boxes wait for the WH receipt (no longer ready at once)');
select is(wb_t.box('BOX-U1-001') ->> 'customer' || '/' || (wb_t.box('BOX-U1-001') ->> 'customerPo'), 'BETA Co./PO-U9', 'the box carries the customer of the work order');
select lives_ok($$ select wb_t.finish('{"id":"FN-U2","orderId":"WO-U","goodQty":20,"qc":"hold","params":{"perBox":20},"sources":[{"type":"transfer","id":"TR-U1","lotId":"CU-U1","qty":20}]}'::jsonb) $$,
  'a lot for sale on hold is recorded');
select ok(wb_t.lot('FN-U2') -> 'destination' = 'null'::jsonb and wb_t.states('FN-U2') = 'hold', 'its box is on hold and the lot has no destination yet');
-- ปล่อยล็อตที่กัก = หัวหน้า QA เท่านั้น (20261221010000_qa_head_decisions.sql · qa_head_decisions.test.sql)
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W1","lotId":"FN-U2","orderId":"WO-U","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord');
select is(wb_t.lot('FN-U2') ->> 'destination' || '/' || wb_t.states('FN-U2'), 'customer/pending_wh', 'QA releases it: the lot goes to the customer and the box waits for WH');

-- 6. receiveBoxes: ปฏิเสธ ----------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select wb_t.receive('FN-C1') $$, 'RF_FORBIDDEN', 'a planner cannot receive boxes into WH (view only)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select wb_t.receive('FN-C1') $$, 'RF_FORBIDDEN', 'nor can RB staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select wb_t.receive('FN-C1') $$, 'RF_FORBIDDEN', 'nor the RB department manager');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select wb_t.receive('FN-C1') $$, 'RF_FORBIDDEN', 'nor QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select wb_t.receive('FN-C1') $$, 'RF_FORBIDDEN', 'nor SR staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select wb_t.boxes(wb_t.lot_rows('FN-C1', 'pending_wh', 'in_stock', null, null, 2), 'receiveBoxes') $$, 'RF_INVALID_BOX',
  'WH receives a whole lot at once (two of three boxes is refused)');
select throws_ok($$ select wb_t.rf(jsonb_build_object('fgBoxes', jsonb_build_object('upsert', wb_t.lot_rows('FN-C1', 'pending_wh', 'in_stock', null, null, 1000)),
  'lots', jsonb_build_object('upsert', jsonb_build_array(wb_t.lot('FN-C1')))), 'receiveBoxes') $$, 'RF_INVALID_BOX', 'a box action sends the box list only');
select throws_ok($$ select wb_t.ship('BOX-C1-001') $$, 'RF_INVALID_TRANSITION', 'a box waiting for the receipt cannot be shipped');
select throws_ok($$ select wb_t.boxes(jsonb_build_array(wb_t.row_of(wb_t.box('BOX-U2-001'), 'shipped', null, null) || '{"id":"BOX-NOPE-001"}'::jsonb), 'shipBoxes') $$,
  'RF_INVALID_BOX', 'an unknown box is refused');
select is(wb_t.states('FN-C1'), 'pending_wh,pending_wh,pending_wh', 'the refused calls changed nothing');

-- 7. receiveBoxes: WH รับเข้า และนับยอดเข้างาน RB -----------------------------------------------------------------------------------------
select set_config('test.bv', wb_t.bver()::text, true);
select set_config('test.res', wb_t.receive('FN-C1')::text, true);
select is(wb_t.states('FN-C1'), 'in_stock,in_stock,in_stock', 'WH staff receive the whole lot');
select is(wb_t.box('BOX-C1-002') ->> 'receivedBy', current_setting('test.n_sbx_wh_staff'), 'the receiver is the WH persona');
select ok(wb_t.box('BOX-C1-002') ->> 'receivedAt' is not null, 'with the receipt time of the server');
select is((select jsonb_agg(jsonb_build_object('kind', m ->> 'kind', 'by', m ->> 'by', 'note', m ->> 'note')) from jsonb_array_elements(wb_t.box('BOX-C1-002') -> 'moves') m),
  jsonb_build_array(jsonb_build_object('kind', 'receive', 'by', current_setting('test.n_sbx_wh_staff'), 'note', '')), 'the box history has the receipt');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric, 60::numeric, 'the RB job of the order is credited with the 60 pieces');
select is(wb_t.job('JOB-W-RB') ->> 'status', 'in_progress', 'below the plan the job is in progress');
select is(wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'note', 'คลังสินค้าสำเร็จรูป (WH) รับเข้า ล็อต FN-C1 ส่งมอบให้ลูกค้า', 'with a report entry of the receipt');
select is((wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'good')::numeric, 60::numeric, 'the report counts the good pieces');
select is(wb_t.order_row('251205-27001') ->> 'status', 'in_progress', 'the released order starts');
select is(wb_t.lot('FN-C1') -> 'whCredit', '{"jobNo":"JOB-W-RB","qty":60}'::jsonb, 'the lot remembers what it credited');
select is(wb_t.bver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');
select is(wb_t.bom_audit('rubberflow:receiveBoxes'), 1, 'the BOM history records the receipt');
select set_config('test.v', wb_t.rver()::text, true);
select is(wb_t.boxes((select jsonb_agg(x || '{"status":"in_stock"}'::jsonb) from jsonb_array_elements(public.app_rf_master() -> 'fgBoxes') x where x ->> 'lotId' = 'FN-C1'), 'receiveBoxes') ->> 'version',
  current_setting('test.v'), 'receiving the same lot again writes nothing');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric, 60::numeric, 'and credits nothing twice');

select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select set_config('test.bv', wb_t.bver()::text, true);
select lives_ok($$ select wb_t.receive('FN-U1') $$, 'the WH department manager receives a lot of a work order for sale');
select is(wb_t.states('FN-U1'), 'in_stock,in_stock', 'its boxes are in stock');
select ok(wb_t.lot('FN-U1') -> 'whCredit' = 'null'::jsonb and wb_t.bver() = current_setting('test.bv')::bigint, 'a lot for sale credits no BOM job');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select wb_t.receive('FN-U2') $$, 'an admin receives the lot QA released');
select is(wb_t.states('FN-U2'), 'in_stock', 'its box is in stock');

-- 8. shipBoxes: เฉพาะ WH / admin ---------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select wb_t.ship('BOX-C1-001') $$, 'RF_FORBIDDEN', 'a planner cannot ship boxes any more');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select wb_t.ship('BOX-C1-001') $$, 'RF_FORBIDDEN', 'nor can RB staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select set_config('test.res', wb_t.ship('BOX-C1-001')::text, true);
select is(wb_t.box('BOX-C1-001') ->> 'status' || '/' || (wb_t.box('BOX-C1-001') ->> 'shippedBy'), 'shipped/' || current_setting('test.n_sbx_wh_staff'), 'WH staff ship a box');
select is(wb_t.box('BOX-C1-001') -> 'moves' -> -1 ->> 'kind', 'ship', 'the shipment is in the box history');
select set_config('test.v', wb_t.rver()::text, true);
select is(wb_t.ship('BOX-C1-001') ->> 'version', current_setting('test.v'), 'shipping a shipped box again writes nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select lives_ok($$ select wb_t.ship('BOX-U1-001') $$, 'the WH department manager ships a box');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select wb_t.ship('BOX-U2-001') $$, 'an admin ships a box');

-- 9. reverseBoxShip: ผู้จัดการแผนก WH / admin พร้อมเหตุผล ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select wb_t.unship('BOX-C1-001', 'unship', 'ส่งผิดลูกค้า') $$, 'RF_FORBIDDEN', 'WH staff cannot reverse a shipment');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select wb_t.unship('BOX-C1-001', 'unship', 'ส่งผิดลูกค้า') $$, 'RF_FORBIDDEN', 'nor can a planner');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select throws_ok($$ select wb_t.unship('BOX-C1-001', 'unship', 'ab') $$, 'RF_INVALID_BOX', 'a reversal needs a reason of three characters');
select throws_ok($$ select wb_t.unship('BOX-C1-001', null, null) $$, 'RF_INVALID_BOX', 'a reversal without a history entry is refused');
select throws_ok($$ select wb_t.unship('BOX-C1-001', 'unreceive', 'ส่งผิดลูกค้า') $$, 'RF_INVALID_BOX', 'the history entry must be the reversal of a shipment');
select set_config('test.v', wb_t.rver()::text, true);
select is(wb_t.boxes(jsonb_build_array(wb_t.row_of(wb_t.box('BOX-C1-002'), 'pending_wh', 'unreceive', 'รับผิด')), 'reverseBoxShip') ->> 'version', current_setting('test.v'),
  'a reversal of a shipment ignores a box sent back to the waiting state (another action''s target) and writes nothing');
select is(wb_t.box('BOX-C1-002') ->> 'status', 'in_stock', 'the box stays in stock');
select set_config('test.res', wb_t.unship('BOX-C1-001', 'unship', '  ส่งผิดลูกค้า  ')::text, true);
select is(wb_t.box('BOX-C1-001') ->> 'status', 'in_stock', 'the WH department manager reverses the shipment: the box is in stock again');
select ok(wb_t.box('BOX-C1-001') -> 'shippedAt' is null and wb_t.box('BOX-C1-001') -> 'shippedBy' is null, 'without shipment fields');
select is(jsonb_build_object('kind', wb_t.box('BOX-C1-001') -> 'moves' -> -1 ->> 'kind', 'note', wb_t.box('BOX-C1-001') -> 'moves' -> -1 ->> 'note',
                             'by', wb_t.box('BOX-C1-001') -> 'moves' -> -1 ->> 'by', 'count', jsonb_array_length(wb_t.box('BOX-C1-001') -> 'moves')),
  jsonb_build_object('kind', 'unship', 'note', 'ส่งผิดลูกค้า', 'by', current_setting('test.n_sbx_wh_mgr_t'), 'count', 3),
  'the history keeps the receipt, the shipment and the reversal with its trimmed reason');
select is(wb_t.box('BOX-C1-001') ->> 'receivedBy', current_setting('test.n_sbx_wh_staff'), 'the receipt is kept');
select set_config('test.v', wb_t.rver()::text, true);
select is(wb_t.unship('BOX-C1-001', 'unship', 'ส่งผิดลูกค้า') ->> 'version', current_setting('test.v'), 'reversing again writes nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select wb_t.unship('BOX-U1-001', 'unship', 'ลูกค้าคืนของ') $$, 'an admin reverses a shipment');

-- 10. reverseBoxReceipt: ผู้จัดการแผนก WH / admin · ทั้งล็อต · ถอนยอด -------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select wb_t.ship('BOX-C1-003');
select throws_ok($$ select wb_t.unreceive('FN-C1', 'รับผิดล็อต') $$, 'RF_FORBIDDEN', 'WH staff cannot reverse a receipt');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select wb_t.unreceive('FN-C1', 'รับผิดล็อต') $$, 'RF_FORBIDDEN', 'nor can a planner');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select throws_ok($$ select wb_t.unreceive('FN-C1', 'รับผิดล็อต') $$, 'RF_INVALID_TRANSITION', 'a lot with a shipped box cannot be reversed');
select wb_t.unship('BOX-C1-003', 'unship', 'ยังไม่ได้ส่งจริง');
select throws_ok($$ select wb_t.boxes(wb_t.lot_rows('FN-C1', 'in_stock', 'pending_wh', 'unreceive', 'รับผิดล็อต', 2), 'reverseBoxReceipt') $$, 'RF_INVALID_BOX',
  'a receipt is reversed for the whole lot (two of three boxes is refused)');
select throws_ok($$ select wb_t.unreceive('FN-C1', 'ab') $$, 'RF_INVALID_BOX', 'a receipt reversal needs a reason of three characters');
select throws_ok($$ select wb_t.boxes(wb_t.lot_rows('FN-C1', 'in_stock', 'pending_wh', null, null, 1000), 'reverseBoxReceipt') $$, 'RF_INVALID_BOX',
  'and a history entry');
-- ใบที่ปิดแล้ว (ทุกงานผลิตเสร็จ) ถอนยอดของงาน RB ไม่ได้ · ตั้งตรงชั่วคราวแล้วคืนค่า
reset role;
update public.bom_orders set status = 'completed' where is_test and pi_no = '251205-27001';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select throws_ok($$ select wb_t.unreceive('FN-C1', 'รับผิดล็อต') $$, 'RF_INVALID_TRANSITION', 'a receipt credited to a closed order cannot be reversed');
reset role;
update public.bom_orders set status = 'in_progress' where is_test and pi_no = '251205-27001';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select is(wb_t.states('FN-C1') || '/' || (wb_t.job('JOB-W-RB') ->> 'qtyDone'), 'in_stock,in_stock,in_stock/60', 'the refused reversals changed nothing');
select set_config('test.bv', wb_t.bver()::text, true);
select lives_ok($$ select wb_t.unreceive('FN-C1', 'รับผิดล็อต นับไม่ครบ') $$, 'the WH department manager reverses the receipt of the lot');
select is(wb_t.states('FN-C1'), 'pending_wh,pending_wh,pending_wh', 'the boxes wait for the receipt again');
select ok(wb_t.box('BOX-C1-002') -> 'receivedAt' is null and wb_t.box('BOX-C1-002') -> 'receivedBy' is null, 'without receipt fields');
select is(wb_t.box('BOX-C1-002') -> 'moves' -> -1 ->> 'kind' || '/' || (wb_t.box('BOX-C1-002') -> 'moves' -> -1 ->> 'note'), 'unreceive/รับผิดล็อต นับไม่ครบ',
  'the history keeps the reversal and its reason');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric, 0::numeric, 'the credit is taken back from the RB job');
select is((wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'good')::numeric || '/' || (wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'note'),
  '0/ย้อนรับเข้าคลังสินค้าสำเร็จรูป (WH) ล็อต FN-C1 ถอน 60 · รับผิดล็อต นับไม่ครบ', 'with a report entry of zero that names the lot, the quantity and the reason');
select ok(wb_t.lot('FN-C1') -> 'whCredit' = 'null'::jsonb, 'the lot forgets its credit');
select is(wb_t.bver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');

-- รับใหม่ได้ และนับยอดอีกครั้ง · ล็อตที่สองทำให้งานครบแผน แล้วย้อนกลับเป็นกำลังทำ
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select lives_ok($$ select wb_t.receive('FN-C1') $$, 'WH receives the lot again');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric || '/' || (wb_t.lot('FN-C1') -> 'whCredit' ->> 'qty'), '60/60', 'and the job is credited again');
select lives_ok($$ select wb_t.receive('FN-C2') $$, 'WH receives the second lot for the customer');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric || '/' || (wb_t.job('JOB-W-RB') ->> 'status'), '110/done', '60 + 50 reach the plan of 100: the job is done');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select lives_ok($$ select wb_t.unreceive('FN-C2', 'รับซ้ำ') $$, 'an admin reverses the receipt of the second lot');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric || '/' || (wb_t.job('JOB-W-RB') ->> 'status'), '60/in_progress', 'the job is back below the plan and in progress');
select ok(wb_t.job('JOB-W-RB') -> 'doneAt' is null or wb_t.job('JOB-W-RB') -> 'doneAt' = 'null'::jsonb, 'without a done time');

-- ล็อตขาย: admin ย้อนรับเข้าได้เมื่อไม่มีกล่องที่ส่งมอบแล้ว ไม่แตะ BOM
select set_config('test.bv', wb_t.bver()::text, true);
select lives_ok($$ select wb_t.unreceive('FN-U1', 'รับผิดล็อต') $$, 'an admin reverses the receipt of a lot for sale');
select is(wb_t.states('FN-U1') || '/' || wb_t.bver()::text, 'pending_wh,pending_wh/' || current_setting('test.bv'), 'its boxes wait again and the BOM is not touched');

-- 11. QA กัก / ปล่อยหลัง WH รับ ------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W2","lotId":"FN-C1","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":80,"pass":true}],"result":"hold","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord');
select is(wb_t.states('FN-C1'), 'hold,hold,hold', 'QA puts a received lot on hold: its boxes are held');
select ok(wb_t.box('BOX-C1-001') ->> 'receivedAt' is not null, 'the receipt is kept');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_mgr_t')::uuid);
select throws_ok($$ select wb_t.boxes(wb_t.lot_rows('FN-C1', 'hold', 'pending_wh', 'unreceive', 'รับผิดล็อต', 1000), 'reverseBoxReceipt') $$, 'RF_INVALID_TRANSITION',
  'a held box cannot be reversed to waiting');
select throws_ok($$ select wb_t.boxes(jsonb_build_array(wb_t.row_of(wb_t.box('BOX-C1-001'), 'shipped', null, null)), 'shipBoxes') $$, 'RF_INVALID_TRANSITION',
  'nor shipped');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W3X","lotId":"FN-C1","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord') $$,
  'RF_QA_HEAD_ONLY', 'QA staff cannot release the held lot (QA head only since 20261221010000)');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W3","lotId":"FN-C1","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord');
select is(wb_t.states('FN-C1') || '/' || (wb_t.job('JOB-W-RB') ->> 'qtyDone'), 'in_stock,in_stock,in_stock/60',
  'QA releases it: the received boxes are back in stock and the credit is unchanged');
select is(wb_t.states('FN-U1'), 'pending_wh,pending_wh', 'a lot that WH has not received stays waiting');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);

-- QA ผ่านซ้ำย้ายเฉพาะกล่องที่กัก: กล่องในคลังที่ไม่มีวันที่รับ (เหมือนกล่องก่อนไฟล์นี้) ไม่ถูกส่งกลับไปรอ WH
reset role;
update public.rf_fg_boxes set received_at = null, received_by = null where is_test and box_no = 'BOX-C1-001';
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W4","lotId":"FN-C1","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord');
select is(wb_t.states('FN-C1'), 'in_stock,in_stock,in_stock', 'a second pass leaves boxes in stock where they are, even one without a receipt time');
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W5","lotId":"FN-U1","orderId":"WO-U","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}'::jsonb))), 'addQcRecord');
select is(wb_t.states('FN-U1'), 'pending_wh,pending_wh', 'and boxes waiting for WH keep waiting');

-- QA ตัดสินไม่ผ่าน (fail) ล็อตที่นับยอดเข้างาน RB แล้ว: ถอนยอดในธุรกรรมเดียวกัน (รายงานบอกว่า QA ตัดสิน ไม่ใช่ย้อนรับเข้า)
select set_config('test.fail', '{"id":"QC-W6","lotId":"FN-C1","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":80,"pass":false}],"result":"fail","note":"แข็งเกิน","inspector":"x","at":1}', true);
select set_config('test.bv', wb_t.bver()::text, true);
select set_config('test.ba', wb_t.bom_audit('rubberflow:addQcRecord')::text, true);
select lives_ok($$ select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fail')::jsonb))), 'addQcRecord') $$,
  'QA fails a lot that WH received and credited');
select is(wb_t.lot('FN-C1') ->> 'qc' || '/' || wb_t.states('FN-C1'), 'fail/hold,hold,hold', 'the lot fails and its boxes are held');
select ok(wb_t.lot('FN-C1') -> 'whCredit' = 'null'::jsonb, 'the lot forgets its credit');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric || '/' || (wb_t.job('JOB-W-RB') ->> 'status'), '0/in_progress', 'the credit is taken back from the RB job');
select is((wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'good')::numeric || '/' || (wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'note') || '/' || (wb_t.job('JOB-W-RB') -> 'reports' -> -1 ->> 'by'),
  '0/QA ตัดสินไม่ผ่าน ล็อต FN-C1 ถอนยอด 60 (QC-W6)/' || current_setting('test.n_sbx_qa_staff'),
  'with a report entry of zero that names the QA decision, the lot, the quantity, the QC record and the inspector');
select is((select count(*)::integer from jsonb_array_elements(wb_t.job('JOB-W-RB') -> 'reports') r where r ->> 'note' like '%ย้อนรับเข้า%QC-W6%'), 0,
  'the fail is not written as a receipt reversal');
select is(wb_t.bver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');
select is(wb_t.bom_audit('rubberflow:addQcRecord'), current_setting('test.ba')::integer + 1, 'the BOM history records the fail');
select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fail')::jsonb || '{"id":"QC-W7"}'::jsonb))), 'addQcRecord');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone')::numeric, 0::numeric, 'a second fail takes nothing back twice');
select is((select count(*)::integer from jsonb_array_elements(wb_t.job('JOB-W-RB') -> 'reports') r where r ->> 'note' like '%QA ตัดสินไม่ผ่าน%'), 1, 'and adds no second report');

-- QA ต้องบันทึกไม่ผ่านได้เสมอ: ใบที่ปิดแล้ว (completed) = บันทึก fail ได้ ไม่ถอนยอดและคงยอดที่นับไว้ (ย้อนรับเข้าของ WH ยังถูกปฏิเสธตามข้อ 10)
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select lives_ok($$ select wb_t.receive('FN-C2') $$, 'WH receives the second lot again');
select is((wb_t.job('JOB-W-RB') ->> 'qtyDone') || '/' || (wb_t.lot('FN-C2') -> 'whCredit' ->> 'qty'), '50/50', 'and the RB job is credited with it');
reset role;
update public.bom_orders set status = 'completed' where is_test and pi_no = '251205-27001';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.bv', wb_t.bver()::text, true);
select set_config('test.nr', jsonb_array_length(wb_t.job('JOB-W-RB') -> 'reports')::text, true);
select lives_ok($$ select wb_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"QC-W8","lotId":"FN-C2","orderId":"WO-L","stage":"finishing","tests":[{"key":"hardness","value":80,"pass":false}],"result":"fail","note":"แข็งเกิน","inspector":"x","at":1}'::jsonb))), 'addQcRecord') $$,
  'QA records a fail on a lot credited to a closed order');
select is(wb_t.lot('FN-C2') ->> 'qc' || '/' || wb_t.states('FN-C2') || '/' || (wb_t.job('JOB-W-RB') ->> 'qtyDone') || '/' || (wb_t.lot('FN-C2') -> 'whCredit' ->> 'qty'),
  'fail/hold/50/50', 'the fail is recorded and the boxes are held, the job and the lot keep the credit');
select is(wb_t.bver() || '/' || jsonb_array_length(wb_t.job('JOB-W-RB') -> 'reports'), current_setting('test.bv') || '/' || current_setting('test.nr'),
  'the closed order is not touched (no BOM counter step, no report)');
reset role;
update public.bom_orders set status = 'in_progress' where is_test and pi_no = '251205-27001';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;

-- 12. นอกโหมดทดสอบ: ผู้ใช้จริงถูกปฏิเสธ (สวิตช์ใช้งานจริงปิดอยู่) --------------------------------------------------------------------------------
select set_config('test.real_rows', wb_t.lot_rows('FN-U1', 'pending_wh', 'in_stock', null, null, 1000)::text, true);
select set_config('request.jwt.claims', '{"sub":"8ef00000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('fgBoxes', jsonb_build_object('upsert', current_setting('test.real_rows')::jsonb)), 0, 'receiveBoxes') $$,
  'RF_TEST_MODE_ONLY', 'a real WH employee outside test mode is refused');
select set_config('request.jwt.claims', '{"sub":"8ef00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_exit();
select throws_ok($$ select public.app_rf_save(jsonb_build_object('fgBoxes', jsonb_build_object('upsert', current_setting('test.real_rows')::jsonb)), 0, 'reverseBoxShip') $$,
  'RF_TEST_MODE_ONLY', 'so is a real admin who has left test mode');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select is(wb_t.states('FN-U1'), 'pending_wh,pending_wh', 'the refused real calls changed nothing');

-- 13. ชุดเรคอร์ด -----------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(wb_t.box('BOX-U2-001')) k),
  array['createdAt', 'customer', 'customerPo', 'grade', 'id', 'lotId', 'moves', 'orderId', 'productCode', 'qty', 'receivedAt', 'receivedBy', 'recipeId',
        'shippedAt', 'shippedBy', 'status', 'uom'],
  'a received box that was shipped has the seventeen fields');
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(wb_t.box('BOX-U1-001')) k),
  array['createdAt', 'customer', 'customerPo', 'grade', 'id', 'lotId', 'moves', 'orderId', 'productCode', 'qty', 'recipeId', 'status', 'uom'],
  'a waiting box has no receipt or shipment fields');
select ok(wb_t.lot('FN-C1') ? 'destination' and wb_t.lot('FN-C1') ? 'whCredit' and not (wb_t.lot('CU-L1') ? 'destination') and not (wb_t.lot('CU-L1') ? 'whCredit'),
  'finishing lots carry destination and whCredit; other stages do not');
select is(public.app_rf_master_since(0) -> 'changes' -> 'fgBoxes', jsonb_build_object('upsert', public.app_rf_master() -> 'fgBoxes', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the snapshot for the boxes');
select is(public.app_rf_master_since(0) -> 'changes' -> 'lots', jsonb_build_object('upsert', public.app_rf_master() -> 'lots', 'delete', '[]'::jsonb),
  'and for the lots');
reset role;
select ok((select bool_and(changed_version > 0) from public.rf_fg_boxes where is_test), 'every test box is stamped with the version that wrote it');

select * from finish();
rollback;
