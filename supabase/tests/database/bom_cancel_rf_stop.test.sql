-- ยกเลิกใบที่ WO เริ่มผลิตแล้ว · รับเคมีคืนเข้าล็อตเดิม · งานที่ผูก WO รับยอดจาก RubberFlow เท่านั้น · ข้ามเวลาบ่มพร้อมเหตุผล · พักงานพร้อมเหตุผล
-- (20261128010000_bom_cancel_rf_stop.sql) ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกกติกา:
--   ยกเลิกใบ: เหตุผล 3-200 (ทั้งใบร่างและใบที่ปล่อยแล้ว) · กลุ่มวางแผนเท่านั้น · งานที่มียอดไม่กัน · งานคงอยู่และแก้ต่อไม่ได้ · WO in_progress / on_hold ถูกหยุด completed คงเดิม
--     · ป้อนกลับของ WO ที่ยกเลิกไม่เขียนอะไรและไม่ล้ม · สินค้าที่ใบรับเข้าแล้วเป็นสต็อก (ใบร่างอื่นหยิบใช้ได้) · ใบที่ยกเลิกรับเข้า / ส่งมอบเองไม่ได้ · คืนของซื้อของใบที่ยกเลิกได้
--   รับเคมีคืน: ST / admin เท่านั้น · WO ต้องยกเลิกแล้ว · ทุกบรรทัดที่จ่ายต้องมียอดคืน 0..ที่จ่าย · คืนไม่ครบต้องมีเหตุผล · ไม่เกินยอดรับเข้าของล็อต
--     · ชน · ครั้งเดียวต่อใบ · ส่งได้เฉพาะชุดใบเบิก / ล็อตวัตถุดิบ · audit
--   งานที่ผูก WO: รายงาน / แก้ยอด = BOM_INVALID_JOB ทุกผู้เรียก · พักพร้อมเหตุผล ทำต่อ ปิดงานพร้อมเหตุผลได้
--   พักงาน: ต้องมีรายการเหตุผล (setJobStatus) 3-200 · ไม่เปลี่ยนยอด · แผนกอื่นพักไม่ได้ · เครื่องหมาย kind = hold
--   ข้ามเวลาบ่ม: หัว RB / QA เท่านั้น เหตุผล 3-300 เก็บที่ params.skipRest · ล็อตที่บ่มครบแล้วไม่เขียนอะไร
-- (authenticated อ่านตาราง bom_* / rf_* ตรงไม่ได้ จึงอ่านตารางและเรียก private.* ด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok(not exists (
    select 1 from unnest(array[
      'private.bom_cancel_rf_orders(uuid)', 'private.bom_fg_free(uuid,text)', 'private.bom_fg_stock(text)',
      'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)',
      'private.bom_return_parts(public.employees,text,boolean,jsonb,bigint,bigint)',
      'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)',
      'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)',
      'private.rf_client_actions()', 'private.rf_return_requisitions(public.employees,text,jsonb,bigint,bigint)']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')),
  'clients cannot call the replaced or new private helpers');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_cancel_rf_orders(uuid)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_return_parts(public.employees,text,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_return_requisitions(public.employees,text,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the writers are security definer with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_fg_free(uuid,text)'::regprocedure, 'private.bom_fg_stock(text)'::regprocedure)),
  'the FG stock helpers keep their empty search_path');
select ok(has_function_privilege('authenticated', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the RubberFlow save RPC keeps its grants (signed-in users only)');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'app_rf_save'), 1::bigint, 'there is still one overload of app_rf_save');
select ok(position('BOM_RF_ORDER_STARTED' in pg_get_functiondef('private.bom_cancel_rf_orders(uuid)'::regprocedure)) = 0,
  'the cancel helper no longer refuses a started work order');
select ok('returnRequisition' = any (private.rf_client_actions()) and 'endRest' = any (private.rf_client_actions()),
  'returnRequisition is on the RubberFlow action whitelist next to endRest');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');

-- 2. บัญชีทดสอบ ตัวช่วย และค่าที่ใช้ซ้ำ ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8e910000-0000-0000-0000-000000000001', 'bomcrs-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e910000-0000-0000-0000-000000000101', 'BOMCRS-ADMIN', 'Bomcrs', 'Admin', 'bomcrs-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e910000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select set_config('test.now_ms', (extract(epoch from now()) * 1000)::bigint::text, true);

create schema cs_t;
grant usage on schema cs_t to authenticated;
create function cs_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function cs_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function cs_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, cs_t.bver(), p_action)
$$;
create function cs_t.rf(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, coalesce(p_base, cs_t.rver()), p_action)
$$;
create function cs_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function cs_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function cs_t.wo(p_no text) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = p_no
$$;
create function cs_t.req(p_no text) returns jsonb language sql stable as $$
  select q from jsonb_array_elements(public.app_rf_master() -> 'requisitions') q where q ->> 'id' = p_no
$$;
create function cs_t.mlot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_rf_master() -> 'materialLots') l where l ->> 'lotNo' = p_no
$$;
create function cs_t.lot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_rf_master() -> 'lots') l where l ->> 'id' = p_no
$$;
create function cs_t.wo_status(p_no text, p_status text) returns jsonb language sql volatile as $$
  select cs_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(cs_t.wo(p_no) || jsonb_build_object('status', p_status)))), 'setOrderStatus')
$$;
create function cs_t.cancel(p_no text, p_reason text) returns jsonb language sql volatile as $$
  select cs_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
    cs_t.order_row(p_no) || jsonb_build_object('status', 'cancelled', 'cancelReason', p_reason)))), 'cancelOrder')
$$;
-- รายงานยอดดี (เพิ่มรายการรายงานหนึ่งรายการ) · p_extra แก้ช่องอื่นของแถวเดียวกัน
create function cs_t.report(p_no text, p_good numeric, p_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select cs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    cs_t.job(p_no) || jsonb_build_object('status', 'in_progress', 'qtyDone', (cs_t.job(p_no) ->> 'qtyDone')::numeric + p_good,
      'reports', (cs_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', ''))) || p_extra))), 'reportJob')
$$;
-- สถานะ + รายการยอด 0 ที่มีเหตุผล (พักงาน / ปิดงาน) · p_extra แก้ช่องอื่นของแถวเดียวกัน
create function cs_t.zero(p_no text, p_status text, p_note text, p_action text default 'setJobStatus', p_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select cs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    cs_t.job(p_no) || jsonb_build_object('status', p_status,
      'reports', (cs_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', p_note))) || p_extra))), p_action)
$$;
create function cs_t.set_status(p_no text, p_status text) returns jsonb language sql volatile as $$
  select cs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(cs_t.job(p_no) || jsonb_build_object('status', p_status)))), 'setJobStatus')
$$;
-- รับเคมีคืน: p_kgs = ยอดคืนตามลำดับบรรทัด (ตำแหน่งที่ไม่มี = ไม่ส่งช่อง returnedKg) · p_note = returnNote (null = ไม่ส่ง)
create function cs_t.give_back(p_req text, p_kgs jsonb, p_note text default null, p_base bigint default null) returns jsonb language sql volatile as $$
  select cs_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array(
    cs_t.req(p_req) || jsonb_build_object('lines', (
      select jsonb_agg(case when p_kgs -> (t.ord - 1)::integer is null then t.e else t.e || jsonb_build_object('returnedKg', p_kgs -> (t.ord - 1)::integer) end order by t.ord)
      from jsonb_array_elements(cs_t.req(p_req) -> 'lines') with ordinality as t(e, ord)))
    || case when p_note is null then '{}'::jsonb else jsonb_build_object('returnNote', p_note) end))), 'returnRequisition', p_base)
$$;
-- ข้ามเวลาบ่ม: readyAt = ตอนนี้ และเหตุผลที่ params.skipRest.reason (null = ไม่ส่งเหตุผล)
create function cs_t.skip(p_lot text, p_reason text) returns jsonb language sql volatile as $$
  select cs_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(
    cs_t.lot(p_lot) || jsonb_build_object('readyAt', current_setting('test.now_ms')::bigint,
      'params', (cs_t.lot(p_lot) -> 'params') || case when p_reason is null then '{}'::jsonb else jsonb_build_object('skipRest', jsonb_build_object('reason', p_reason)) end)))), 'endRest')
$$;
create function cs_t.leftover(p_order text, p_lines jsonb, p_reason text default 'ใช้ไม่ได้แล้ว') returns jsonb language sql volatile as $$
  select cs_t.save(jsonb_build_object('partReturns', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('orderId', p_order, 'mode', 'leftover', 'reason', p_reason, 'lines', p_lines)))), 'returnOrderParts')
$$;
create function cs_t.stock_qty(p_code text) returns numeric language sql stable as $$
  select (s ->> 'qty')::numeric from jsonb_array_elements(public.app_bom_master() -> 'stock') s where s ->> 'itemCode' = p_code
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"ST":1763000000000,"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"PK","itemCode":"FG-A","name":"งานทดสอบ","kind":"FG","uom":"set","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"RB-A","level":1,"fgQty":10,"required":100},{"itemCode":"P-1","level":1,"fgQty":10,"required":30}]', true);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-1","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"251128-25001","recipeId":"RC-1","recipeRevision":1,"color":"ดำ","targetQty":100,"targetKg":17.5,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);

-- 3. ข้อมูลตั้งต้น -----------------------------------------------------------------------------------------
--   RubberFlow: วัตถุดิบ MAT-A / MAT-B · สูตร RC-1 (60 kg ต่อ batch: MAT-A 40 + MAT-B 20) · ล็อต RM-A-1 100 kg / RM-B-1 200 kg
--   BOM: 25001 FG-A 10 (งาน RB / PK / ของซื้อ P-1 30) · 25002 FG-A 5 (งาน RB-A / RB-B / PK) · 25003 FG-A 2 (ร่าง ใช้สต็อก) · 25004 FG-A 1 (ร่าง)
--   WO-C1 ผูก JOB-1-RB · WO-C2 ผูก JOB-2-RA · WO-C3 ผูก JOB-2-RB
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e910000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cs_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb))), 'saveMaterial') is not null,
  'the planner adds two materials');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(cs_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.rec')::jsonb))), 'createRecipe') is not null, 'RB drafts the recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select ok(cs_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))), 'approveRecipe') is not null,
  'the RB head approves it');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.ml', jsonb_build_object('lotNo', 'X', 'materialCode', 'MAT-A', 'qtyKg', 100, 'expiry', current_setting('test.now_ms')::bigint + 864000000,
  'supplier', 'บจก. โพลีเคม', 'location', 'A-1', 'status', 'available', 'coa', true)::text, true);
select ok(cs_t.rf(jsonb_build_object('materialLots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ml')::jsonb || '{"lotNo":"RM-A-1"}'::jsonb, current_setting('test.ml')::jsonb || '{"lotNo":"RM-B-1","materialCode":"MAT-B","qtyKg":200}'::jsonb))), 'receiveMaterial') is not null,
  'ST receives one lot of each material');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cs_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-B","kind":"RB","name":"เส้นยาง B","ownerDept":"RB","uom":"pcs"},
  {"code":"P-1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"}]}}'::jsonb, 'importFlat') is not null, 'the planner seeds the items');
select ok(cs_t.save(jsonb_build_object(
  'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', (select jsonb_agg(current_setting('test.ord')::jsonb || jsonb_build_object('id', t.no,
      'items', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', t.qty, 'colorSet', 'A', 'note', '')), 'explosion', current_setting('test.expl')::jsonb) order by t.no)
    from (values ('251128-25001', 10), ('251128-25002', 5), ('251128-25003', 2), ('251128-25004', 1)) t(no, qty)))), 'createOrder') is not null,
  'the planner creates four draft orders');
select ok(cs_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(cs_t.order_row('251128-25001') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251128-25001","dept":"RB","itemCode":"RB-A","name":"เส้นยาง A","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251128-25001"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-P1","orderId":"251128-25001","dept":"ST","itemCode":"P-1","name":"กล่อง","kind":"PURCHASED","uom":"box","qtyPlanned":30,"qtyRequired":30}'::jsonb))),
  'releaseOrder') is not null, 'order 25001 is released with an RB, a PK and a purchased-part job');
select ok(cs_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(cs_t.order_row('251128-25002') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-2-RA","orderId":"251128-25002","dept":"RB","itemCode":"RB-A","name":"เส้นยาง A","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2-RB","orderId":"251128-25002","dept":"RB","itemCode":"RB-B","name":"เส้นยาง B","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-2-PK","orderId":"251128-25002","qtyPlanned":5,"qtyRequired":5}'::jsonb))),
  'releaseOrder') is not null, 'order 25002 is released with two RB jobs and a PK job');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(cs_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-C1","sourceJobId":"JOB-1-RB"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-C2","sourceJobId":"JOB-2-RA","customerPo":"251128-25002"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-C3","sourceJobId":"JOB-2-RB","customerPo":"251128-25002"}'::jsonb))), 'createOrder') is not null,
  'RB opens three work orders linked to the RB jobs');
select is(cs_t.job('JOB-1-RB') -> 'externalRef' ->> 'woId', 'WO-C1', 'JOB-1-RB is linked to WO-C1');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(cs_t.wo_status('WO-C1', 'released') is not null, 'the planner releases WO-C1');
select ok(cs_t.wo_status('WO-C2', 'released') is not null, 'and WO-C2');
select ok(cs_t.wo_status('WO-C3', 'released') is not null, 'and WO-C3');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(cs_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array('{"id":"REQ-C1","orderId":"WO-C1","batches":1,"note":""}'::jsonb))), 'createRequisition')
            -> 'changes' -> 'requisitions' -> 'upsert' -> 0 ->> 'status', 'issued', 'RB issues the chemicals of WO-C1 (one batch, drawn from stock at once)');
select is(jsonb_build_array(cs_t.req('REQ-C1') -> 'lines' -> 0 ->> 'lotNo', cs_t.req('REQ-C1') -> 'lines' -> 0 ->> 'actualKg', cs_t.req('REQ-C1') -> 'lines' -> 1 ->> 'lotNo', cs_t.req('REQ-C1') -> 'lines' -> 1 ->> 'actualKg'),
  '["RM-A-1","40","RM-B-1","20"]'::jsonb, 'the requisition took 40 kg of MAT-A and 20 kg of MAT-B');
select is(jsonb_build_array(cs_t.mlot('RM-A-1') ->> 'qtyKg', cs_t.mlot('RM-B-1') ->> 'qtyKg'), '["60","180"]'::jsonb, 'the lots were drawn down');
select ok(cs_t.wo_status('WO-C1', 'in_progress') is not null, 'RB starts WO-C1');
select ok(cs_t.wo_status('WO-C2', 'in_progress') is not null, 'and WO-C2');
select ok(cs_t.wo_status('WO-C3', 'in_progress') is not null, 'and WO-C3');
select ok(cs_t.wo_status('WO-C2', 'on_hold') is not null, 'WO-C2 is put on hold');
select ok(cs_t.wo_status('WO-C3', 'completed') is not null, 'WO-C3 is completed');
select is((select jsonb_agg(cs_t.wo(w) ->> 'status' order by w) from unnest(array['WO-C1', 'WO-C2', 'WO-C3']) w), '["in_progress","on_hold","completed"]'::jsonb,
  'one work order runs, one is on hold, one is done');

-- 4. งานที่ผูก WO รับยอดจาก RubberFlow เท่านั้น · พักงานต้องมีเหตุผล ------------------------------------------------
select throws_ok($$ select cs_t.report('JOB-1-RB', 10) $$, 'BOM_INVALID_JOB', 'RB staff cannot report output on a job linked to a work order');
select throws_ok($$ select cs_t.set_status('JOB-1-RB', 'hold') $$, 'BOM_INVALID_JOB', 'a job cannot be put on hold without a reason');
select throws_ok($$ select cs_t.zero('JOB-1-RB', 'hold', 'ab') $$, 'BOM_INVALID_JOB', 'the hold reason needs at least three characters');
select throws_ok($$ select cs_t.zero('JOB-1-RB', 'hold', repeat('ก', 201)) $$, 'BOM_INVALID_JOB', 'and at most 200');
select throws_ok($$ select cs_t.zero('JOB-1-RB', 'hold', 'รอแม่พิมพ์', 'reportJob') $$, 'BOM_INVALID_JOB', 'a hold reason counts only under setJobStatus');
select set_config('test.res', cs_t.zero('JOB-1-RB', 'hold', '  รอแม่พิมพ์  ')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'hold', 'RB staff put the linked job on hold with a reason');
select is((current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> -1) - 'at',
  jsonb_build_object('by', current_setting('test.n_sbx_rb_staff'), 'good', 0, 'reject', 0, 'note', 'รอแม่พิมพ์', 'kind', 'hold'),
  'the reason is a trimmed zero entry stamped by the server and marked as a hold');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'reports' -> -1 ->> 'at')::bigint >= current_setting('test.now_ms')::bigint,
  'with the server time');
select is(cs_t.set_status('JOB-1-RB', 'in_progress') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'resuming needs no reason');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select cs_t.report('JOB-1-RB', 10) $$, 'BOM_INVALID_JOB', 'the planner cannot report on a linked job either');
select throws_ok($$ select cs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(cs_t.job('JOB-1-RB') || '{"qtyDone":5}'::jsonb))), 'setJobStatus') $$,
  'BOM_INVALID_JOB', 'nor change its quantity without a report');
select is(cs_t.zero('JOB-2-RB', 'done', 'WO ปิดแล้ว ไม่ผลิตเพิ่ม') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done',
  'the planner can still close a linked job with a reason');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select cs_t.zero('JOB-1-PK', 'hold', 'รอกล่อง', 'setJobStatus', '{"qtyDone":1}'::jsonb) $$, 'BOM_INVALID_JOB', 'a hold does not change the output');
select throws_ok($$ select cs_t.zero('JOB-1-PK', 'in_progress', 'ไม่มีเหตุผลอะไร') $$, 'BOM_INVALID_JOB', 'a zero entry that neither holds nor closes the job is refused');
select is(cs_t.zero('JOB-1-PK', 'hold', 'รอกล่อง') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'hold', 'PK staff put their own job on hold with a reason');
select is(cs_t.report('JOB-1-PK', 3) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '3', 'and report 3 sets after resuming (the job is not linked)');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select cs_t.zero('JOB-1-PK', 'hold', 'ขอพักงาน') $$, 'BOM_FORBIDDEN', 'another department cannot put the PK job on hold');

-- 5. ของซื้อและสินค้าสำเร็จรูปของใบ 25001 ก่อนยกเลิก ----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(cs_t.save(jsonb_build_object('stock', jsonb_build_object('upsert', '[{"itemCode":"P-1","qty":50}]'::jsonb)), 'countPartStock') is not null, 'ST counts 50 boxes');
select is(cs_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(cs_t.job('JOB-1-P1') || '{"status":"done","qtyDone":30}'::jsonb))), 'issueOrderParts')
            -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'ST issues the 30 boxes of order 25001');
select is(cs_t.stock_qty('P-1'), 20::numeric, '20 boxes are left in stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select ok(cs_t.save('{"fgMoves":{"upsert":[{"orderId":"251128-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":3}]}]}}'::jsonb, 'receiveFg') is not null,
  'WH receives the 3 sets PK made');

-- 6. ยกเลิกใบ 25001: เหตุผล · สิทธิ์ · WO ที่กำลังผลิตถูกหยุด · งานคงอยู่ ---------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.bv', cs_t.bver()::text, true);
select set_config('test.rv', cs_t.rver()::text, true);
select throws_ok($$ select cs_t.cancel('251128-25001', '') $$, 'BOM_INVALID_ORDER', 'a cancel without a reason is refused');
select throws_ok($$ select cs_t.cancel('251128-25001', '  ab  ') $$, 'BOM_INVALID_ORDER', 'the reason needs at least three characters after trimming');
select throws_ok($$ select cs_t.cancel('251128-25001', repeat('ก', 201)) $$, 'BOM_INVALID_ORDER', 'and at most 200');
select is(cs_t.bver(), current_setting('test.bv')::bigint, 'the refused cancels moved no BOM version');
select is(cs_t.rver(), current_setting('test.rv')::bigint, 'nor the RubberFlow version');
select is(cs_t.wo('WO-C1') ->> 'status', 'in_progress', 'and the running work order is untouched');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select cs_t.cancel('251128-25001', 'ลูกค้ายกเลิก') $$, 'BOM_FORBIDDEN', 'RB staff cannot cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb) $$, 'RF_INVALID_TRANSITION', 'chemicals cannot be taken back while the work order is still open');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', cs_t.cancel('251128-25001', '  ลูกค้ายกเลิกคำสั่งซื้อ  ')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled',
  'with a reason the planner cancels an order whose work order is in progress, with output and issued parts');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'cancelReason', 'ลูกค้ายกเลิกคำสั่งซื้อ', 'the trimmed reason is stored');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'cancelled', '["WO-C1"]'::jsonb, 'the reply names the stopped work order');
select is(cs_t.wo('WO-C1') ->> 'status', 'cancelled', 'the work order that was in progress is stopped (cancelled)');
select ok(cs_t.wo('WO-C1') ? 'cancelledAt', 'with its cancel time');
select is(cs_t.wo('WO-C1') ->> 'producedQty', '0', 'its produced quantity is kept as it was');
select is(cs_t.rver(), current_setting('test.rv')::bigint + 1, 'the RubberFlow counter moved once');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251128-25001'), 3, 'the jobs of the cancelled order are kept');
select is(coalesce(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'delete'), 0), 0, 'no job is deleted');
select is(cs_t.job('JOB-1-PK') ->> 'qtyDone', '3', 'the PK job keeps its output');
select is(cs_t.job('JOB-1-RB') -> 'externalRef' ->> 'woId', 'WO-C1', 'the RB job keeps its link');
select is(cs_t.req('REQ-C1') ->> 'status', 'issued', 'the requisition is still issued (ST takes the chemicals back)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select cs_t.report('JOB-1-PK', 1) $$, 'BOM_INVALID_TRANSITION', 'a job of a cancelled order cannot be reported');
select throws_ok($$ select cs_t.zero('JOB-1-PK', 'hold', 'รอกล่อง') $$, 'BOM_INVALID_TRANSITION', 'nor put on hold');
reset role;
select is(private.rf_apply_feedback('ผู้บันทึก', json_populate_record(null::public.rf_lots, '{"lot_no":"FN-C-1","stage":"finishing","good_qty":10,"uom":"pcs"}'::json),
          (select o from public.rf_orders o where o.is_test and o.wo_no = 'WO-C1')), '{"jobs":0,"orders":0}'::jsonb,
  'feedback of a work order of a cancelled order writes nothing and does not fail');
select is((select cancel_reason from public.bom_orders where is_test and pi_no = '251128-25001'), 'ลูกค้ายกเลิกคำสั่งซื้อ', 'the reason is kept on the order row');
set local role authenticated;

-- 7. สินค้าสำเร็จรูปของใบที่ยกเลิก = สต็อก (สั่ง = 0) · ใบที่ยกเลิกรับเข้า / ส่งมอบเองไม่ได้ -----------------------------------
reset role;
select is(private.bom_fg_free((select id from public.bom_orders where is_test and pi_no = '251128-25001'), 'FG-A'), 3::numeric,
  'the 3 sets the cancelled order received become free stock (its ordered quantity counts as 0)');
select is(private.bom_fg_stock('FG-A'), 3::numeric, 'and count in the FG stock of that code');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select cs_t.save('{"fgMoves":{"upsert":[{"orderId":"251128-25001","kind":"receive","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 'receiveFg') $$,
  'BOM_INVALID_TRANSITION', 'WH cannot receive into a cancelled order');
select throws_ok($$ select cs_t.save('{"fgMoves":{"upsert":[{"orderId":"251128-25001","kind":"deliver","lines":[{"fgCode":"FG-A","qty":1}]}]}}'::jsonb, 'deliverFg') $$,
  'BOM_INVALID_TRANSITION', 'nor deliver from it');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', cs_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  cs_t.order_row('251128-25003') || '{"status":"released","stockCounts":{"FG-A":2}}'::jsonb))), 'releaseOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'completed',
  'a draft that takes 2 sets from FG stock completes at release');
select is((select jsonb_agg(jsonb_build_array(m ->> 'kind', m ->> 'fromOrderId', (m ->> 'qty')::numeric))
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'fgMoves' -> 'upsert') m),
  '[["transfer","251128-25001",2]]'::jsonb, 'the 2 sets come from the cancelled order');
reset role;
select is(private.bom_fg_free((select id from public.bom_orders where is_test and pi_no = '251128-25001'), 'FG-A'), 1::numeric, 'the cancelled order has 1 set left in stock');
set local role authenticated;

-- 8. คืนของซื้อของใบที่ยกเลิก ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select cs_t.save(jsonb_build_object('partReturns', jsonb_build_object('upsert', jsonb_build_array(
  '{"orderId":"251128-25001","mode":"undo","reason":"ยกเลิกใบ"}'::jsonb))), 'undoOrderParts') $$, 'BOM_INVALID_TRANSITION', 'undoing the issue stays for open orders');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select cs_t.leftover('251128-25001', '[{"itemCode":"P-1","qty":25}]'::jsonb) $$, 'BOM_FORBIDDEN', 'RB staff cannot return parts');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(cs_t.leftover('251128-25001', '[{"itemCode":"P-1","qty":25}]'::jsonb) is not null, 'ST returns 25 of the 30 boxes issued to the cancelled order');
select is(cs_t.stock_qty('P-1'), 45::numeric, 'the boxes are back in stock (20 + 25)');
select throws_ok($$ select cs_t.leftover('251128-25001', '[{"itemCode":"P-1","qty":6}]'::jsonb) $$, 'BOM_INVALID_RETURN', 'no more than what is still out (30 - 25 = 5)');
select ok(cs_t.leftover('251128-25001', '[{"itemCode":"P-1","qty":5}]'::jsonb) is not null, 'the last 5 come back too');

-- 9. รับเคมีคืนเข้าล็อตเดิม (WO-C1 ถูกหยุดแล้ว) --------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb) $$, 'RF_FORBIDDEN', 'RB staff cannot take chemicals back into stock');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb) $$, 'RF_FORBIDDEN', 'nor QA (the requisition set is not theirs)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb) $$, 'RF_FORBIDDEN', 'nor the planning group (ST or admin only)');
select throws_ok($$ select cs_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(cs_t.wo('WO-C2') || '{"note":"x"}'::jsonb))), 'returnRequisition') $$,
  'RF_INVALID_REQUISITION', 'returnRequisition carries only requisitions and material lots');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.rv', cs_t.rver()::text, true);
select is(cs_t.give_back('REQ-C1', '[]'::jsonb) ->> 'version', current_setting('test.rv'), 'a copy without returned kilograms writes nothing');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'every issued line needs its returned kilograms (0 allowed)');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40.5, 20]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'no more than was issued on a line');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40.00001, 20]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'not even a fraction more than was issued');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[-1, 20]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'no negative kilograms');
select throws_ok($$ select cs_t.give_back('REQ-C1', '["40", 20]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'a number, not text');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 15]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'a short return needs a reason');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 15]'::jsonb, ' ab ') $$, 'RF_INVALID_REQUISITION', 'of at least three characters');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 15]'::jsonb, repeat('ก', 301)) $$, 'RF_INVALID_REQUISITION', 'and at most 300');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb, null, 0) $$, 'RF_STALE', 'a copy older than the requisition is stale');
-- ล็อตที่ยอดคงเหลือเท่ายอดรับเข้าแล้วรับคืนไม่ได้ (แก้ตารางตรงเพื่อจำลอง แล้วคืนค่าเดิม)
reset role;
update public.rf_material_lots set qty_kg = 100 where is_test and lot_no = 'RM-A-1';
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select cs_t.give_back('REQ-C1', '[40, 20]'::jsonb) $$, 'RF_INVALID_REQUISITION', 'a return cannot lift a lot above what it received');
reset role;
update public.rf_material_lots set qty_kg = 60 where is_test and lot_no = 'RM-A-1';
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select set_config('test.rv', cs_t.rver()::text, true);
select set_config('test.res', cs_t.give_back('REQ-C1', '[40, 15]'::jsonb, '  หกระหว่างขนย้าย 5 กก.  ')::text, true);
select is(jsonb_build_array(cs_t.mlot('RM-A-1') ->> 'qtyKg', cs_t.mlot('RM-B-1') ->> 'qtyKg'), '["100","195"]'::jsonb,
  'ST returns all 40 kg of MAT-A and 15 of the 20 kg of MAT-B into the original lots');
select is((select jsonb_agg(jsonb_build_array((e ->> 'returnedKg')::numeric, e ->> 'returnedBy', e ->> 'returnNote') order by t.ord)
           from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'requisitions' -> 'upsert' -> 0 -> 'lines') with ordinality as t(e, ord)),
  jsonb_build_array(jsonb_build_array(40, current_setting('test.n_sbx_st_staff'), 'หกระหว่างขนย้าย 5 กก.'), jsonb_build_array(15, current_setting('test.n_sbx_st_staff'), 'หกระหว่างขนย้าย 5 กก.')),
  'every line records what came back, who took it and the trimmed reason');
select ok((current_setting('test.res')::jsonb -> 'changes' -> 'requisitions' -> 'upsert' -> 0 -> 'lines' -> 0 ->> 'returnedAt')::bigint >= current_setting('test.now_ms')::bigint,
  'with the server time');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'requisitions' -> 'upsert' -> 0 ->> 'status', 'issued', 'the requisition keeps its status');
select is(cs_t.rver(), current_setting('test.rv')::bigint + 1, 'the RubberFlow counter moved once');
select throws_ok($$ select cs_t.give_back('REQ-C1', '[39, 15]'::jsonb, 'รับคืนซ้ำ') $$, 'RF_INVALID_TRANSITION', 'a requisition is taken back only once');
select is(cs_t.give_back('REQ-C1', '[40, 15]'::jsonb, 'หกระหว่างขนย้าย 5 กก.') ->> 'version', cs_t.rver()::text, 'resending the stored figures writes nothing');
reset role;
select is((select count(*) from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'returnRequisition'), 1::bigint,
  'the return has one RubberFlow audit row');
set local role authenticated;

-- 10. ยกเลิกใบ 25002: WO ที่พักอยู่ถูกหยุด WO ที่ปิดแล้วคงเดิม · ยกเลิกใบร่างต้องมีเหตุผลเช่นกัน ----------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.res', cs_t.cancel('251128-25002', 'ลูกค้าเลื่อนไม่มีกำหนด')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'an order whose work orders are on hold and completed is cancelled');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'cancelled', '["WO-C2"]'::jsonb, 'only the work order on hold is stopped');
select is(jsonb_build_array(cs_t.wo('WO-C2') ->> 'status', cs_t.wo('WO-C3') ->> 'status'), '["cancelled","completed"]'::jsonb, 'the completed work order stays completed');
select throws_ok($$ select cs_t.cancel('251128-25004', '') $$, 'BOM_INVALID_ORDER', 'a draft cannot be cancelled without a reason either');
select is(cs_t.cancel('251128-25004', 'เปิดใบซ้ำ') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'a draft is cancelled with a reason');

-- 11. ข้ามเวลาบ่ม: หัว RB / QA พร้อมเหตุผล เก็บที่ล็อต ---------------------------------------------------------------
reset role;
insert into public.rf_lots (is_test, lot_no, stage, order_no, recipe_code, uom, good_qty, qc, ready_at, params) values
  (true, 'MX-C-1', 'mixing', 'WO-C3', 'RC-1', 'kg', 50, 'pass', now() + interval '4 hours', '{"batches":1}'::jsonb),
  (true, 'MX-C-2', 'mixing', 'WO-C3', 'RC-1', 'kg', 50, 'pass', now() + interval '4 hours', '{"batches":1}'::jsonb),
  (true, 'MX-C-3', 'mixing', 'WO-C3', 'RC-1', 'kg', 50, 'pass', now() - interval '1 hour', '{"batches":1}'::jsonb);
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select cs_t.skip('MX-C-1', 'เร่งงานลูกค้า') $$, 'RF_FORBIDDEN', 'RB staff can no longer skip the rest time');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select cs_t.skip('MX-C-1', 'เร่งงานลูกค้า') $$, 'RF_FORBIDDEN', 'nor the planning group unless RB head or QA');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select cs_t.skip('MX-C-1', 'เร่งงานลูกค้า') $$, 'RF_FORBIDDEN', 'nor ST (the lot set is not theirs)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select cs_t.skip('MX-C-1', null) $$, 'RF_INVALID_LOT', 'the RB head needs a reason');
select throws_ok($$ select cs_t.skip('MX-C-1', ' ab ') $$, 'RF_INVALID_LOT', 'of at least three characters');
select throws_ok($$ select cs_t.skip('MX-C-1', repeat('ก', 301)) $$, 'RF_INVALID_LOT', 'and at most 300');
select set_config('test.res', cs_t.skip('MX-C-1', '  ทดสอบความหนืดผ่านแล้ว  ')::text, true);
select is((cs_t.lot('MX-C-1') -> 'params' -> 'skipRest') - 'at', jsonb_build_object('by', current_setting('test.n_sbx_rb_mgr'), 'reason', 'ทดสอบความหนืดผ่านแล้ว'),
  'the RB head skips the rest time: the lot keeps the trimmed reason and who skipped it');
select is((cs_t.lot('MX-C-1') -> 'params' -> 'skipRest' ->> 'at')::bigint, (cs_t.lot('MX-C-1') ->> 'readyAt')::bigint, 'the skip time is the new ready time (server time)');
select ok((cs_t.lot('MX-C-1') ->> 'readyAt')::bigint <= current_setting('test.now_ms')::bigint + 1000, 'the lot is ready now');
select is(cs_t.lot('MX-C-1') -> 'params' ->> 'batches', '1', 'the other parameters of the lot are kept');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select ok(cs_t.skip('MX-C-2', 'QA ตรวจแล้วผ่าน') is not null, 'a QA member can skip the rest time with a reason');
select is(cs_t.lot('MX-C-2') -> 'params' -> 'skipRest' ->> 'by', current_setting('test.n_sbx_qa_staff'), 'and is recorded as the one who skipped it');
select set_config('test.rv', cs_t.rver()::text, true);
select is(cs_t.skip('MX-C-3', 'บ่มครบแล้ว') ->> 'version', current_setting('test.rv'), 'a lot that is already ready is not written');
select ok(not (cs_t.lot('MX-C-3') -> 'params' ? 'skipRest'), 'and gets no skip record');

select * from finish();
rollback;
