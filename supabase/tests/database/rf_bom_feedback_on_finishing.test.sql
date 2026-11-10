-- RubberFlow ป้อนผลผลิตกลับงาน BOM เมื่อชิ้นงานผ่านสถานีสุดท้ายเท่านั้น (20261116010000_rf_bom_feedback_on_finishing.sql)
-- รับมอบใบส่งมอบทุกสถานี (ผสม / ฉีด / อบ) ไม่เขียน BOM · ล็อตตกแต่งที่ QC ผ่านและนับเข้า WO ป้อนยอด good ของล็อตครั้งเดียว (ตอนบันทึกถ้าผ่านเลย หรือตอน QA ตัดสินเป็น pass ครั้งแรก)
-- ล็อต hold / fail ไม่ป้อนอะไร · ผลตรวจถัดไปของล็อตที่นับแล้วไม่ป้อนซ้ำ · ข้าม (บันทึก RubberFlow ยังสำเร็จ) เมื่อ WO ไม่ผูกงาน / งาน done / ใบ PI ไม่ใช่ released-in_progress / งานผูกกับ WO อื่น
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ (บทบาทที่บันทึกตกแต่ง / ตัดสิน QC ไม่ได้ ไม่มี session) และกำแพงโหมดทดสอบ / lab-only ของ app_rf_save ไม่เปลี่ยน
-- (authenticated อ่านตาราง rf_* / bom_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ของนิยามที่เปลี่ยน ------------------------------------------------------------
select ok(exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_apply_feedback' and p.pronargs = 3 and p.proargtypes[1] = 'public.rf_lots'::regtype::oid)
      and not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_apply_feedback' and p.proargtypes[1] <> 'public.rf_lots'::regtype::oid),
  'the feedback function takes the finishing lot and the transfer-based signature is gone');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_save_transfers' and p.pronargs = 7)
      and exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname = 'rf_save_transfers' and p.pronargs = 6),
  'the transfer writer lost its actor-name argument (it no longer writes to BOM)');
select ok(position('rf_apply_feedback' in pg_get_functiondef('private.rf_save_transfers(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) = 0
      and position('rf_apply_feedback' in pg_get_functiondef('private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure)) > 0
      and position('rf_apply_feedback' in pg_get_functiondef('private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)) > 0,
  'only the finishing lot save and the QA decision call the feedback');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure, 'private.rf_apply_feedback(text,public.rf_lots,public.rf_orders)'::regprocedure,
                           'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_save_qc(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_save_transfers(public.employees,boolean,boolean,jsonb,bigint,bigint)'::regprocedure)),
  'the replaced functions are security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'rf\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private RubberFlow helper (the new signatures included)');
select ok(not has_function_privilege('anon', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute')
      and has_function_privilege('authenticated', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute'),
  'app_rf_save keeps its grants (signed-in users only)');
select ok(position('private.lab_only_block()' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)) > 0
      and position('is_test' in pg_get_functiondef('private.rf_apply_feedback(text,public.rf_lots,public.rf_orders)'::regprocedure)) > 0,
  'app_rf_save keeps the lab-only guard and the feedback only reads test-mode rows');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8f200000-0000-0000-0000-000000000001', 'rfb-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f200000-0000-0000-0000-000000000101', 'RFB-ADMIN', 'Rfb', 'Admin', 'rfb-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f200000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select set_config('request.jwt.claims', '{"sub":"8f200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 3. ข้อมูลตั้งต้น: สูตร ใบ PI ที่ปล่อยผลิต งาน RB 1,000 ชิ้น ใบสั่งผลิต WO-X1 (ผูกงาน) และ WO-X2 (ไม่ผูก) ------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-1","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1},{"materialCode":"MAT-C","phr":10,"stage":2}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"WO-X1","customer":"ACME","customerPo":"PO-1","recipeId":"RC-1","recipeRevision":1,"color":"ดำ","targetQty":1000,"targetKg":17.5,"kgPerUnit":0.125,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":1000,"qtyRequired":1000,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","level":1,"fgQty":10,"required":20},{"itemCode":"RB-A","level":2,"fgQty":10,"required":40}]', true);
select set_config('test.fn', '{"id":"X","stage":"finishing","orderId":"WO-X1","uom":"m","shift":"E","grade":"A","sources":[],"params":{"perBox":50},"goodQty":0,"scrapQty":0,"scrapReason":"","qc":"pass"}', true);
select set_config('test.qc', '{"id":"X","lotId":"FN-X1","orderId":"WO-X1","stage":"finishing","tests":[{"key":"hardness","value":65,"pass":true},{"key":"tensile","value":12,"pass":true},{"key":"elongation","value":380,"pass":true},{"key":"sg","value":1.18,"pass":true},{"key":"t90","value":3.2,"pass":true}],"result":"pass","note":"","inspector":"x","at":1}', true);
select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-C","name":"สารตัวเร่ง"}'::jsonb))), 0, 'saveMaterial');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.rec')::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))), (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 0, 'importFlat');
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '251108-25001', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', (select jsonb_agg(o || '{"status":"released"}'::jsonb) from jsonb_array_elements(public.app_bom_master() -> 'orders') o)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-X1-RB","orderId":"251108-25001","dept":"RB","itemCode":"RB-A","kind":"RB"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-X1-GR","orderId":"251108-25001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-X1-PK","orderId":"251108-25001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"sourceJobId":"JOB-X1-RB"}'::jsonb, current_setting('test.wo')::jsonb || '{"id":"WO-X2","targetQty":50}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder');
select is((select j -> 'externalRef' ->> 'woId' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 'WO-X1', 'WO-X1 is linked to the RB job (WO-X2 is not linked to any job)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-X1'),
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = 'WO-X2')))), (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');

-- ล็อตและใบส่งมอบของทุกสถานี ใส่ตรง (ข้ามสายผสม-ฉีด-อบ) · WO ทั้งสองเดินอยู่แล้ว
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no in ('WO-X1', 'WO-X2');
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values
  (true, 'MX-X1', 'mixing', 'WO-X1', 'kg', 50, 'pass', 50),
  (true, 'EX-X1', 'extrusion', 'WO-X1', 'pcs', 300, 'pass', 300),
  (true, 'CU-X1', 'curing', 'WO-X1', 'pcs', 280, 'pass', 280),
  (true, 'CU-X2', 'curing', 'WO-X2', 'pcs', 40, 'pass', 40);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-X1', 'MX-X1', 'WO-X1', 'mixing', 'extrusion', 'kg', 50, 0, 'in_transit'),
  (true, 'TR-X2', 'EX-X1', 'WO-X1', 'extrusion', 'curing', 'pcs', 300, 0, 'in_transit'),
  (true, 'TR-X3', 'CU-X1', 'WO-X1', 'curing', 'finishing', 'pcs', 280, 0, 'in_transit'),
  (true, 'TR-X4', 'CU-X2', 'WO-X2', 'curing', 'finishing', 'pcs', 40, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;

-- 4. รับมอบใบส่งมอบทุกสถานีไม่เขียน BOM ---------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select set_config('test.bv0', (public.app_bom_master() ->> 'version')::text, true);
select is(public.app_rf_save(jsonb_build_object('transfers', jsonb_build_object('upsert', jsonb_build_array((select x || '{"status":"received","qtyReceived":50}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-X1')))), (public.app_rf_master() ->> 'version')::bigint, 'receiveTransfer') -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'SR receives the mixing transfer (kg of compound)');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0::numeric, 'receiving the mixing transfer feeds nothing back to the BOM job');
select is(public.app_rf_save(jsonb_build_object('transfers', jsonb_build_object('upsert', jsonb_build_array((select x || '{"status":"received","qtyReceived":300}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-X2')))), (public.app_rf_master() ->> 'version')::bigint, 'receiveTransfer') -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'SR receives the extrusion transfer');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0::numeric, 'receiving the extrusion transfer feeds nothing back either');
select is(public.app_rf_save(jsonb_build_object('transfers', jsonb_build_object('upsert', jsonb_build_array((select x || '{"status":"received","qtyReceived":280}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-X3')))), (public.app_rf_master() ->> 'version')::bigint, 'receiveTransfer') -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'SR receives the curing transfer (into finishing)');
select is(public.app_rf_save(jsonb_build_object('transfers', jsonb_build_object('upsert', jsonb_build_array((select x || '{"status":"received","qtyReceived":40}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-X4')))), (public.app_rf_master() ->> 'version')::bigint, 'receiveTransfer') -> 'changes' -> 'transfers' -> 'upsert' -> 0 ->> 'status', 'received', 'SR receives the transfer of the unlinked work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0::numeric, 'no receipt moved the BOM job total (no piece has passed finishing yet)');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0, 'and no report entry was appended');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv0')::bigint, 'and the BOM counter did not move for any receipt');
select is((select count(*) from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:receiveTransfer'), 0::bigint, 'and the BOM history has no row for a receipt');

-- 5. ล็อตตกแต่งที่ผ่านตอนบันทึก ป้อนยอด good ของล็อตครั้งเดียว ---------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.bv1', (public.app_bom_master() ->> 'version')::text, true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X0","orderId":"WO-X1","qc":"pass","goodQty":100,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":100}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing') $$, 'RF_FORBIDDEN', 'ST staff cannot record finishing');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X0","orderId":"WO-X1","qc":"pass","goodQty":100,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":100}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing') $$, 'RF_FORBIDDEN', 'SR staff cannot record finishing');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X0","orderId":"WO-X1","qc":"pass","goodQty":100,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":100}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing') $$, 'RF_FORBIDDEN', 'QA staff cannot record finishing');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0::numeric, 'a refused save feeds nothing');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv1')::bigint, 'and does not move the BOM counter');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-XA","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb, current_setting('test.fn')::jsonb || '{"id":"FN-XB","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":0},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing') $$, 'RF_INVALID_LOT', 'a save whose second lot is invalid is refused as a whole');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 0::numeric, 'and the feedback of its first lot is rolled back with it');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '0', 'and so is the produced quantity of the work order');
select set_config('test.vA', (public.app_rf_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X1","orderId":"WO-X1","qc":"pass","goodQty":100,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":100}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 ->> 'countedToOrder', 'true', 'a finishing lot that passes is counted to the work order at once');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '100', 'with its good quantity');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 100::numeric, 'and the BOM job receives the good quantity of the lot');
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 'in_progress', 'below the plan of 1000 the job stays in progress');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 1, 'one report entry was appended');
select is((select (j -> 'reports' -> 0) - 'at' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), jsonb_build_object('by', current_setting('test.n_sbx_rb_staff'), 'good', 100, 'reject', 0, 'note', 'ผ่านตกแต่ง FN-X1 จาก WO WO-X1'), 'the report is written by the server: the recorder as author, good in the unit of the work order, no rejects, a note naming the lot and the work order');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv1')::bigint + 1, 'the BOM counter went up by one for the feedback');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:recordFinishing' and a ->> 'detail' like 'jobs +1%' and a ->> 'user' = current_setting('test.n_sbx_rb_staff')), 'the BOM history records the feedback');
select is((select jsonb_agg(j ->> 'id') from jsonb_array_elements(public.app_bom_master_since(current_setting('test.bv1')::bigint) -> 'changes' -> 'jobs' -> 'upsert') j), '["JOB-X1-RB"]'::jsonb, 'a BOM client catches up on the feedback with the normal delta');
select set_config('test.resFx1', current_setting('test.res'), true);
select is(public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array((select x from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X1')))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing') ->> 'version', (public.app_rf_master() ->> 'version'), 'sending the same lot again is not an error and writes nothing');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 100::numeric, 'so the lot is not fed a second time');

-- 6. ล็อตตกแต่งที่ hold ไม่ป้อนจน QA ตัดสินเป็น pass (ป้อนครั้งเดียว) ----------------------------------------------------
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X2","orderId":"WO-X1","qc":"hold","goodQty":50,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":50}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X2'), 'hold', 'a finishing lot that is not passed waits for QA');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '100', 'it is not counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 100::numeric, 'and the BOM job is not fed');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X0","lotId":"FN-X2","stage":"finishing","result":"pass"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$, 'RF_FORBIDDEN', 'an RB member cannot decide a QC result');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 100::numeric, 'and a refused decision feeds nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.bv2', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X1","lotId":"FN-X2","stage":"finishing","result":"pass"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X2'), 'pass', 'QA passes the finishing lot');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '150', 'it is counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'and the BOM job receives the lot once (100 + 50)');
select is((select jsonb_array_length(j -> 'reports') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 2, 'a second report entry was appended');
select is((select (j -> 'reports' -> 1) - 'at' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), jsonb_build_object('by', current_setting('test.n_sbx_qa_staff'), 'good', 50, 'reject', 0, 'note', 'ผ่านตกแต่ง FN-X2 จาก WO WO-X1'), 'the report names QA as the author and the lot');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv2')::bigint + 1, 'the BOM counter went up by one for the QA decision');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:addQcRecord' and a ->> 'detail' like 'jobs +1%' and a ->> 'user' = current_setting('test.n_sbx_qa_staff')), 'the BOM history records the QA decision');
select set_config('test.bv3', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X2","lotId":"FN-X2","stage":"finishing","result":"hold"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord'))::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X3","lotId":"FN-X2","stage":"finishing","result":"pass"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X2'), 'pass', 'the lot is passed again after a hold');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'a later QC record of a lot that is already counted does not feed again');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '150', 'nor does it count the lot again');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv3')::bigint, 'and the BOM counter did not move');

-- 7. ล็อตตกแต่งที่ fail ไม่ป้อนอะไร ----------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X3","orderId":"WO-X1","qc":"fail","goodQty":10,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":10}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X3'), 'fail', 'a finishing lot saved as failed is a failed lot');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'and feeds nothing');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X4","lotId":"FN-X3","stage":"finishing","result":"fail"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord'))::text, true);
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'QA confirming the failure feeds nothing');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-X5","lotId":"FN-X3","stage":"finishing","result":"pass"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'addQcRecord') $$, 'RF_INVALID_TRANSITION', 'a failed lot cannot be passed afterwards');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'so a failed lot never reaches the BOM job');

-- 8. ข้าม: บันทึก RubberFlow ยังสำเร็จ แต่ไม่เขียน BOM ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv4', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X4","orderId":"WO-X2","qc":"pass","goodQty":40,"params":{"perBox":40},"sources":[{"type":"transfer","id":"TR-X4","lotId":"CU-X2","qty":40}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X4'), 'pass', 'a work order that is not linked to a job: the finishing lot is saved');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X2'), '40', 'and counted to its work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'but the BOM job (linked to another work order) is untouched');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv4')::bigint, 'and the BOM counter did not move');
reset role;
update public.bom_jobs set status = 'done', done_at = now() where is_test and job_no = 'JOB-X1-RB';
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv5', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X5","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X5'), 'pass', 'a job that is already done: the finishing lot is saved');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '170', 'and counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'but the finished job takes nothing more');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv5')::bigint, 'and the BOM counter did not move');
reset role;
update public.bom_jobs set status = 'in_progress', done_at = null where is_test and job_no = 'JOB-X1-RB';
update public.bom_orders set status = 'completed' where is_test and id = (select order_pk from public.bom_jobs where is_test and job_no = 'JOB-X1-RB');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv6', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X6","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X6'), 'pass', 'a completed PI: the finishing lot is saved');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '190', 'and counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'but the job of a completed PI takes nothing');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv6')::bigint, 'and the BOM counter did not move');
reset role;
update public.bom_orders set status = 'in_progress' where is_test and id = (select order_pk from public.bom_jobs where is_test and job_no = 'JOB-X1-RB');
update public.bom_jobs set external_ref = jsonb_build_object('system', 'rubberflow', 'woId', 'WO-OTHER', 'kg', 0) where is_test and job_no = 'JOB-X1-RB';
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv7', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X7","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'qc' from jsonb_array_elements(public.app_rf_master() -> 'lots') x where x ->> 'id' = 'FN-X7'), 'pass', 'a job linked to another work order: the finishing lot is saved');
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '210', 'and counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 150::numeric, 'but the job takes nothing');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv7')::bigint, 'and the BOM counter did not move');
reset role;
update public.bom_jobs set external_ref = jsonb_build_object('system', 'rubberflow', 'woId', 'WO-X1', 'kg', 0) where is_test and job_no = 'JOB-X1-RB';
update public.bom_orders set status = 'released' where is_test and id = (select order_pk from public.bom_jobs where is_test and job_no = 'JOB-X1-RB');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.bv8', (public.app_bom_master() ->> 'version')::text, true);
select set_config('test.res', (public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-X8","orderId":"WO-X1","qc":"pass","goodQty":20,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":20}]}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'recordFinishing'))::text, true);
select is((select x ->> 'producedQty' from jsonb_array_elements(public.app_rf_master() -> 'orders') x where x ->> 'id' = 'WO-X1'), '230', 'a released PI: the finishing lot is counted to the work order');
select is((select (j ->> 'qtyDone')::numeric from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-X1-RB'), 170::numeric, 'and the job takes the lot (150 + 20)');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '251108-25001'), 'in_progress', 'and the PI starts');
select is((public.app_bom_master() ->> 'version')::bigint, current_setting('test.bv8')::bigint + 1, 'with one BOM counter step');

-- 9. ประวัติและผลตอบกลับ ---------------------------------------------------------------------------------------
select is((select count(*) from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:receiveTransfer'), 0::bigint, 'no receipt wrote a BOM history row in the whole run');
select is((select count(*) from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:recordFinishing'), 2::bigint, 'one BOM history row per finishing save that fed the job (FN-X1 and FN-X8)');
select is((select count(*) from jsonb_array_elements(public.app_bom_audit()) a where a ->> 'action' = 'rubberflow:addQcRecord'), 1::bigint, 'and one for the QA decision that fed it (QC-X1)');
reset role;
select is((select (metadata ->> 'bom_jobs')::integer from public.audit_logs where action = 'RF_SAVE' and entity_type = 'rf_master' and entity_id = (current_setting('test.resFx1')::jsonb ->> 'version')), 1, 'the RubberFlow audit row of the first finishing save counts the BOM job it wrote');
select is((select max((metadata ->> 'bom_jobs')::integer) from public.audit_logs where action = 'RF_SAVE' and entity_type = 'rf_master' and metadata ->> 'client_action' = 'receiveTransfer'), 0, 'and the audit row of a receipt counts no BOM job');
select is((select qty_done from public.bom_jobs where is_test and job_no = 'JOB-X1-RB'), 170::numeric, 'the stored job total matches what the screen reads');
set local role authenticated;

-- 10. ปฏิเสธเมื่อไม่มี session ------------------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.fn')::jsonb || '{"id":"FN-XZ","orderId":"WO-X1","qc":"pass","goodQty":10,"params":{"perBox":50},"sources":[{"type":"transfer","id":"TR-X3","lotId":"CU-X1","qty":10}]}'::jsonb))), 0, 'recordFinishing') $$, 'AUTH_REQUIRED', 'saving a finishing lot requires a session');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.qc')::jsonb || '{"id":"QC-XZ","lotId":"FN-X1","stage":"finishing","result":"pass"}'::jsonb))), 0, 'addQcRecord') $$, 'AUTH_REQUIRED', 'saving a QC decision requires a session');

reset role;
select * from finish();
rollback;
