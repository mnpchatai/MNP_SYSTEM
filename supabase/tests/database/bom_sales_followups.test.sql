-- งานตามหลังของใบสั่งผลิตจากฝ่ายขาย (โรงงาน ขั้น 9 · 20261227010000_bom_sales_followups.sql) ตรวจทั้งฝั่งอนุญาตและปฏิเสธ:
-- 1) ระหว่างฝ่ายขายยกเลิกกลางทางรอตัดสิน: รายงานผล / ล็อตตกแต่ง RB / WH รับเข้า ยังทำได้ · ส่งมอบ / SR จ่ายยางเส้นยาว / ST เบิกของซื้อ ไม่ได้
-- 2) ฝ่ายวางแผนเลือกหยุดแล้ว RB ยังบันทึกล็อตตกแต่งของ WO ที่การหยุดยกเลิกได้ ยางเส้นยาวเข้าสต็อกกลาง SR · WO ที่ยกเลิกทางอื่นไม่ได้ · ไปลูกค้าไม่ได้
-- 3) เปิดงานเพิ่มใช้สต็อกสินค้าสำเร็จรูป / ยางเส้นยาวกับส่วนที่เพิ่ม (ไม่เกินส่วนที่เพิ่ม ไม่เกินสต็อก ลดไม่ได้)
-- 4) planned_items: ตั้งตอนปล่อยผลิต / เปิดงานเพิ่ม · ล้างตอนเปิดกลับเป็นร่าง · ไม่มีอะไรเพิ่ม = เปิดงานเพิ่มไม่ได้ · ความต้องการของงานเดิมเพิ่มตาม
-- 5) started / locked ต่อใบจากเซิร์ฟเวอร์ (ฝ่ายขายเห็นว่าใบเริ่มแล้วเมื่อ WO ใน RubberFlow เดิน)
-- 6) ใบปิดแล้วการแจ้งแก้ใบที่ยังเปิดปิดเอง (การแจ้งยกเลิกกลางทางที่รอตัดสินยังเปิดให้เลือก)
-- ข้อควรระวัง: เรียก private.* ก่อนสลับเป็น authenticated เท่านั้น และอ่าน / แก้ตารางตรงด้วย reset role เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และ backfill --------------------------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_orders' and column_name = 'planned_items' and data_type = 'jsonb')
          and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_orders'::regclass and c.conname = 'bom_orders_planned_items_check'),
  'an order keeps the item quantities its jobs were opened for (a jsonb object or null)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_wo_sales_stopped(public.rf_orders)'::regprocedure,
                           'private.rf_add_produced(text,numeric,boolean,bigint,bigint)'::regprocedure,
                           'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_add_change_jobs(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the new and replaced functions are security definer with an empty search_path');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.bom_items_qty(jsonb)'::regprocedure),
  'the item total helper has an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('rf_wo_sales_stopped', 'bom_items_qty', 'bom_add_change_jobs', 'rf_add_produced', 'rf_save_lots', 'bom_save_orders', 'bom_records')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the new helpers or the replaced writers directly');
select ok(has_function_privilege('authenticated', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute'), 'the save RPC keeps its grant');
select is(private.bom_items_qty('[{"fgCode":"FG-A","qty":2},{"fgCode":"FG-B","qty":1.5}]'::jsonb), '{"FG-A":2,"FG-B":1.5}'::jsonb, 'item totals per product code');
select is(private.bom_items_qty('[]'::jsonb), '{}'::jsonb, 'no items give an empty object');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(not exists (select 1 from public.bom_orders o where o.status in ('released', 'in_progress', 'completed') and o.planned_items is null),
  'every released, running or closed order has its planned items (backfill)');
select ok(not exists (select 1 from public.bom_order_requests q join public.bom_orders o on o.id = q.order_pk
                      where q.status = 'open' and q.kind = 'change' and o.status = 'completed'),
  'no edit notice stays open on a closed order (backfill)');

-- 2. บัญชีทดสอบและตัวช่วยของเทสต์ -------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8fb10000-0000-0000-0000-000000000001', 'salesfollowups-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8fb10000-0000-0000-0000-000000000101', 'SALESFOLLOWUPS-ADMIN', 'Salesfollowups', 'Admin', 'salesfollowups-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8fb10000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id
           where e.is_test and e.employee_no in ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-PK-STAFF', 'SBX-RB-STAFF', 'SBX-RB-MGR', 'SBX-SR-STAFF',
                                                 'SBX-WH-STAFF', 'SBX-ST-STAFF', 'SBX-QA-MGR')
             and d.code = split_part(e.employee_no, '-', 2)), 9,
  'the personas used below belong to the departments the rules name');

create schema sf_t;
grant usage on schema sf_t to authenticated;
create function sf_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function sf_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, sf_t.ver(), p_action)
$$;
create function sf_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, (public.app_rf_master() ->> 'version')::bigint, p_action)
$$;
create function sf_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function sf_t.job(p_id text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_id
$$;
create function sf_t.edit(p_no text, p_extra jsonb, p_action text) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(sf_t.order_row(p_no) || p_extra))), p_action)
$$;
-- ใบใหม่ของสินค้า FG-F1 (ไม่มีกำหนดเสร็จรายแผนก ผลระเบิด ยอดจากสต็อก) · ส่วนที่ต่างส่งทับด้วย ||
create function sf_t.new_order(p_no text, p_qty numeric, p_extra jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p_no, 'customer', 'ลูกค้าตามหลัง', 'country', 'TH', 'orderType', 'SA', 'orderedAt', 1766620800000, 'whDue', 1769212800000,
                            'due', '{}'::jsonb, 'dueDefaults', '[]'::jsonb, 'revision', 0, 'status', 'draft',
                            'items', jsonb_build_array(jsonb_build_object('fgCode', 'FG-F1', 'qty', p_qty, 'colorSet', '', 'note', '')),
                            'explosion', null, 'explodedAt', null, 'stockCounts', '{}'::jsonb, 'note', '') || p_extra
$$;
create function sf_t.new_job(p_id text, p_order text, p_dept text, p_code text, p_kind text, p_uom text, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'orderId', p_order, 'dept', p_dept, 'itemCode', p_code, 'name', 'งาน ' || p_code, 'kind', p_kind, 'uom', p_uom,
    'qtyPlanned', p_qty, 'qtyRequired', p_qty, 'stockCounted', null, 'qtyDone', 0, 'qtyReject', 0, 'dueAt', 1769212800000, 'status', 'queued',
    'externalRef', null, 'fgCodes', jsonb_build_array('FG-F1'), 'reports', '[]'::jsonb)
$$;
-- ผลระเบิด: บรรทัด FG-F1 level 0 + บรรทัดเส้นยาง (kind RB)
create function sf_t.expl(p_fg numeric, p_rb jsonb) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('itemCode', 'FG-F1', 'fgCode', 'FG-F1', 'kind', 'FG', 'level', 0, 'fgQty', p_fg, 'required', p_fg)) || p_rb
$$;
create function sf_t.rb_line(p_code text, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('itemCode', p_code, 'fgCode', 'FG-F1', 'kind', 'RB', 'level', 1, 'fgQty', 1, 'required', p_qty)
$$;
create function sf_t.release(p_no text, p_expl jsonb, p_jobs jsonb) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(sf_t.order_row(p_no) || jsonb_build_object('status', 'released', 'explosion', p_expl))),
    'jobs', jsonb_build_object('upsert', p_jobs)), 'releaseOrder')
$$;
-- รายงานผลหนึ่งชิ้น (พนักงานแผนกของงาน) · ฝ่ายวางแผนปิดงานพร้อมเหตุผล
create function sf_t.report(p_job text) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    sf_t.job(p_job) || jsonb_build_object('status', 'in_progress', 'qtyDone', (sf_t.job(p_job) ->> 'qtyDone')::numeric + 1,
      'reports', (sf_t.job(p_job) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'ใครก็ได้', 'good', 1, 'reject', 0, 'note', 'รายงานผล')))))), 'reportJob')
$$;
create function sf_t.close_job(p_job text) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    sf_t.job(p_job) || jsonb_build_object('status', 'done',
      'reports', (sf_t.job(p_job) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', 'ปิดงานส่วนที่เหลือ')))))), 'setJobStatus')
$$;
create function sf_t.notice(p_no text, p_kind text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r
  where r ->> 'orderId' = p_no and r ->> 'kind' = p_kind order by (r ->> 'requestedAt')::bigint desc, r ->> 'id' desc limit 1
$$;
create function sf_t.notices(p_no text, p_kind text, p_status text) returns integer language sql stable as $$
  select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r
  where r ->> 'orderId' = p_no and r ->> 'kind' = p_kind and r ->> 'status' = p_status
$$;
create function sf_t.decide(p_no text, p_kind text, p_decision text, p_more jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('orderRequests', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('id', sf_t.notice(p_no, p_kind) ->> 'id', 'decision', p_decision)))) || p_more, 'decideOrderRequest')
$$;
-- เปิดงานเพิ่ม: แถวใบปัจจุบัน + ผลระเบิดใหม่ + ยอดที่ใช้จากสต็อก · งาน (ว่าง = ไม่ส่งส่วน jobs)
create function sf_t.add(p_no text, p_expl jsonb, p_jobs jsonb, p_counts jsonb) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
             sf_t.order_row(p_no) || jsonb_build_object('explosion', p_expl, 'stockCounts', p_counts))))
           || case when jsonb_array_length(p_jobs) > 0 then jsonb_build_object('jobs', jsonb_build_object('upsert', p_jobs)) else '{}'::jsonb end,
         'addJobsForChanges')
$$;
-- คลังยางเส้นยาว SR: ล็อตตามเลข · ยอดของรหัสในถังของใบ (เลข PI | null = สต็อกกลาง) จากชุด rodMoves ที่ client อ่าน · SR รับเข้าผ่าน (สูตรไม่มีสเปก)
create function sf_t.rod_lot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_bom_master() -> 'rodLots') l where l ->> 'lotNo' = p_no
$$;
create function sf_t.rods(p_owner text, p_code text) returns numeric language sql stable as $$
  select coalesce(sum((m ->> 'qty')::numeric), 0) from jsonb_array_elements(public.app_bom_master() -> 'rodMoves') m
  where m ->> 'itemCode' = p_code and (m ->> 'ownerOrderId') is not distinct from p_owner
$$;
create function sf_t.receive_rods(p_no text, p_qty numeric) returns jsonb language sql volatile as $$
  select sf_t.save(jsonb_build_object('rodLots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', sf_t.rod_lot(p_no) ->> 'id', 'qtyReceived', p_qty, 'location', 'A-01',
    'qc', jsonb_build_object('values', '{}'::jsonb, 'result', 'pass', 'note', 'ดูด้วยตาแล้วผ่าน'))))), 'receiveRods')
$$;
-- RubberFlow: ล็อตตกแต่งจากใบส่งมอบที่รับแล้ว (good = ที่ใช้จากใบส่งมอบ) · ผลตรวจ QA ผ่านทุกค่า
create function sf_t.finish(p_id text, p_wo text, p_tr text, p_cu text, p_qty numeric, p_extra jsonb) returns jsonb language sql volatile as $$
  select sf_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', p_id, 'stage', 'finishing', 'orderId', p_wo, 'uom', 'pcs', 'shift', 'E', 'grade', 'A',
    'sources', jsonb_build_array(jsonb_build_object('type', 'transfer', 'id', p_tr, 'lotId', p_cu, 'qty', p_qty)),
    'params', '{}'::jsonb, 'goodQty', p_qty, 'scrapQty', 0, 'scrapReason', '', 'qc', 'pass') || p_extra))), 'recordFinishing')
$$;
create function sf_t.qc_pass(p_id text, p_lot text) returns jsonb language sql volatile as $$
  select sf_t.rf(jsonb_build_object('qcRecords', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', p_id, 'lotId', p_lot, 'orderId', 'X', 'stage', 'finishing',
    'tests', '[{"key":"hardness","value":65,"pass":true},{"key":"tensile","value":12,"pass":true},{"key":"elongation","value":380,"pass":true},{"key":"sg","value":1.18,"pass":true},{"key":"t90","value":3.2,"pass":true}]'::jsonb,
    'result', 'pass', 'note', '', 'inspector', 'x', 'at', 1)))), 'addQcRecord')
$$;

-- 3. ข้อมูลตั้งต้น: วัตถุดิบ สูตร RCF-1 (อนุมัติ) คอมปาวด์ DMF1 สินค้า FG-F1 ชิ้นยาง SE-F1 เส้นยาง RB-F1 / RB-F2 ------------------------------
select set_config('request.jwt.claims', '{"sub":"8fb10000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sf_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"MAT-SF-A","name":"ยาง EPDM","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb,
  '{"code":"MAT-SF-B","name":"เขม่าดำ","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb))), 'saveMaterial');
select sf_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"RCF-1","revision":1,"productCode":"P-F1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-SF-A","phr":100,"stage":1},{"materialCode":"MAT-SF-B","phr":50,"stage":1}],"status":"draft"}'::jsonb))),
  'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select sf_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RCF-1')))), 'approveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select sf_t.save($json$
{"compounds": {"upsert": [{"code": "DMF1", "name": "EPDM ตามหลัง", "recipeId": "RCF-1", "recipeName": "สูตร F1"}]},
 "items": {"upsert": [
   {"code": "FG-F1", "kind": "FG", "name": "สินค้า F1", "ownerDept": "PK", "uom": "set"},
   {"code": "SE-F1", "kind": "SE", "name": "ชิ้นยาง F1", "ownerDept": "GR", "uom": "pcs"},
   {"code": "DMF1", "kind": "CP", "name": "EPDM ตามหลัง", "ownerDept": "RB", "uom": "kg"},
   {"code": "RB-F1", "kind": "RB", "name": "เส้นยาง F1", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMF1", "kgPerRoll": 2}},
   {"code": "RB-F2", "kind": "RB", "name": "เส้นยาง F2", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMF1", "kgPerRoll": 2}}]}}
$json$::jsonb, 'importFlat');

-- 4. ใบสั่งผลิต: A (29001) B (29002) D (29004) ของฝ่ายขาย · S (29003) ของฝ่ายวางแผน = ต้นทางสต็อกสินค้าสำเร็จรูป ---------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select sf_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sf_t.new_order('251227-29001', 2, '{"sentAt":1}'::jsonb), sf_t.new_order('251227-29002', 4, '{"sentAt":1}'::jsonb),
  sf_t.new_order('251227-29004', 1, '{"sentAt":1}'::jsonb)))), 'createOrder') $$,
  'sales opens and sends three orders');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sf_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(sf_t.new_order('251227-29003', 1, '{}'::jsonb)))), 'createOrder') $$,
  'planning opens its own order');
select lives_ok($$ select sf_t.release('251227-29001', sf_t.expl(2, jsonb_build_array(sf_t.rb_line('RB-F1', 20), sf_t.rb_line('RB-F2', 5))), jsonb_build_array(
  sf_t.new_job('JOB-9-A1', '251227-29001', 'PK', 'FG-F1', 'FG', 'set', 2), sf_t.new_job('JOB-9-A2', '251227-29001', 'RB', 'RB-F1', 'RB', 'pcs', 20),
  sf_t.new_job('JOB-9-A3', '251227-29001', 'RB', 'RB-F2', 'RB', 'pcs', 5))) $$,
  'planning releases order A with a PK job and two RB jobs');
select ok(sf_t.job('JOB-9-A2') -> 'externalRef' ->> 'woId' is not null and sf_t.job('JOB-9-A3') -> 'externalRef' ->> 'woId' is not null,
  'both RB jobs got their work orders at release');
select set_config('test.wo_a2', sf_t.job('JOB-9-A2') -> 'externalRef' ->> 'woId', true);
select set_config('test.wo_a3', sf_t.job('JOB-9-A3') -> 'externalRef' ->> 'woId', true);
select lives_ok($$ select sf_t.release('251227-29002', sf_t.expl(4, jsonb_build_array(sf_t.rb_line('RB-F1', 8))),
  jsonb_build_array(sf_t.new_job('JOB-9-B1', '251227-29002', 'PK', 'FG-F1', 'FG', 'set', 4))) $$, 'planning releases order B');
select lives_ok($$ select sf_t.release('251227-29003', sf_t.expl(1, '[]'::jsonb), jsonb_build_array(sf_t.new_job('JOB-9-S1', '251227-29003', 'PK', 'FG-F1', 'FG', 'set', 1))) $$,
  'and order S');
select lives_ok($$ select sf_t.release('251227-29004', sf_t.expl(1, '[]'::jsonb), jsonb_build_array(sf_t.new_job('JOB-9-D1', '251227-29004', 'PK', 'FG-F1', 'FG', 'set', 1))) $$,
  'and order D');
-- ข้อ 4: ปล่อยผลิตตั้ง planned_items
select is(sf_t.order_row('251227-29002') -> 'plannedItems', '{"FG-F1":4}'::jsonb, 'release records the item quantities the jobs were opened for');

-- 5. ข้อ 5: started / locked จากเซิร์ฟเวอร์ · ข้อ 4: เปิดกลับเป็นร่างล้าง planned_items ----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select is((sf_t.order_row('251227-29001') ->> 'started') || '/' || (sf_t.order_row('251227-29001') ->> 'locked'), 'false/false',
  'sales reads that order A has not started: its work orders are only planned');
select lives_ok($$ select sf_t.edit('251227-29004', '{"status":"draft","revision":1,"explosion":null,"items":[{"fgCode":"FG-F1","qty":2,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales pulls order D back to draft while nothing started');
select ok(sf_t.order_row('251227-29004') ->> 'status' = 'draft' and not (sf_t.order_row('251227-29004') ? 'plannedItems'),
  'a draft again has no planned items (its jobs are gone)');
select is((sf_t.order_row('251227-29004') ->> 'started') || '/' || (sf_t.order_row('251227-29004') ->> 'locked'), 'false/false', 'a draft is neither started nor locked');
-- RubberFlow เดิน WO ของงาน RB-F1 (ใส่ตรง ข้ามสายผสม-ฉีด) · ล็อตอบและใบส่งมอบไปตกแต่งของ WO ทั้งสอง
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no = current_setting('test.wo_a2');
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values
  (true, 'CU-F1', 'curing', current_setting('test.wo_a2'), 'pcs', 30, 'pass', 30),
  (true, 'CU-F3', 'curing', current_setting('test.wo_a3'), 'pcs', 10, 'pass', 10);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-F1', 'CU-F1', current_setting('test.wo_a2'), 'curing', 'finishing', 'pcs', 30, 0, 'in_transit'),
  (true, 'TR-F3', 'CU-F3', current_setting('test.wo_a3'), 'curing', 'finishing', 'pcs', 10, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select sf_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert',
  (select jsonb_agg(x || jsonb_build_object('status', 'received', 'qtyReceived', (x ->> 'qtySent')::numeric))
   from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' in ('TR-F1', 'TR-F3')))), 'receiveTransfer');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' in ('TR-F1', 'TR-F3') and x ->> 'status' = 'received'), 2,
  'both transfers reached finishing');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select is((sf_t.order_row('251227-29001') ->> 'started') || '/' || (sf_t.order_row('251227-29001') ->> 'locked') || '/' || (sf_t.order_row('251227-29001') ->> 'status'),
  'true/true/released', 'once RubberFlow runs its work order sales reads that order A started, before any job report');
select is((sf_t.order_row('251227-29002') ->> 'started') || '/' || (sf_t.order_row('251227-29002') ->> 'locked'), 'false/false', 'order B has not started yet');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select sf_t.report('JOB-9-B1') $$, 'PK reports on order B');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select is((sf_t.order_row('251227-29002') ->> 'started') || '/' || (sf_t.order_row('251227-29002') ->> 'locked') || '/' || (sf_t.order_row('251227-29002') ->> 'status'),
  'true/true/in_progress', 'now order B is started and locked');
select lives_ok($$ select sf_t.edit('251227-29002', '{"items":[{"fgCode":"FG-F1","qty":7,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales raises FG-F1 of the started order B from 4 to 7');
select is(sf_t.order_row('251227-29002') -> 'plannedItems', '{"FG-F1":4}'::jsonb, 'an edit in place keeps the planned items (no job is opened yet)');

-- 6. ข้อ 1: ฝ่ายขายยกเลิกใบ A กลางทาง ระหว่างรอฝ่ายวางแผนตัดสิน ---------------------------------------------------------------------------
select lives_ok($$ select sf_t.edit('251227-29001', '{"salesCancelReason":"ลูกค้ายกเลิกกลางทาง"}'::jsonb, 'cancelOrder') $$, 'sales cancels the started order A mid-way');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select sf_t.report('JOB-9-A1') $$, 'while planning decides PK still reports its job');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select sf_t.finish('FN-F0', current_setting('test.wo_a2'), 'TR-F1', 'CU-F1', 4, '{}'::jsonb) $$,
  'and RB still records a finishing lot of the running work order');
select is(sf_t.rod_lot('FN-F0') ->> 'status', 'pending', 'its rods wait for SR');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select sf_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'orderId', '251227-29001', 'kind', 'deliver', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-F1', 'qty', 1)), 'note', '')))), 'deliverFg') $$,
  'BOM_INVALID_TRANSITION', 'the warehouse cannot deliver to the customer who cancelled');
select throws_ok($$ select sf_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'orderId', '251227-29001', 'kind', 'receive', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-F1', 'qty', 1)), 'note', '')))), 'receiveFg') $$,
  'BOM_FG_EXCEEDS', 'a warehouse receipt is not stopped by the pending cancel: it reaches the receipt rules (PK sent nothing yet)');
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select sf_t.save(jsonb_build_object('rodMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'id', '00000000-0000-4000-8000-000000000901', 'kind', 'issue', 'lotId', '00000000-0000-4000-8000-000000000902', 'ownerOrderId', null,
  'forOrderId', '251227-29001', 'itemCode', 'RB-F1', 'qty', -1)))), 'issueRods') $$,
  'BOM_INVALID_TRANSITION', 'SR cannot issue long rods to the order');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select sf_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(sf_t.job('JOB-9-A1')))), 'issueOrderParts') $$,
  'BOM_INVALID_TRANSITION', 'ST cannot issue purchased parts to the order');

-- 7. ฝ่ายวางแผนเลือกหยุด · WO ของงาน RB-F2 ถูกยกเลิกไปก่อนแล้วทางอื่น (ตั้งตรง: ยกเลิกเมื่อหนึ่งชั่วโมงก่อน) -------------------------------------
reset role;
update public.rf_orders set status = 'cancelled', cancelled_at = now() - interval '1 hour' where is_test and wo_no = current_setting('test.wo_a3');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sf_t.decide('251227-29001', 'cancel', 'stop', jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  sf_t.order_row('251227-29001') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิกกลางทาง"}'::jsonb)))) $$,
  'planning chooses to stop order A');
select is(sf_t.order_row('251227-29001') ->> 'status' || '/' || (sf_t.order_row('251227-29001') ->> 'salesCancelChoice')
          || '/' || (sf_t.order_row('251227-29001') ->> 'started') || '/' || (sf_t.order_row('251227-29001') ->> 'locked'),
  'cancelled/stop/false/false', 'order A is cancelled with the stop choice (a cancelled order is neither started nor locked)');
reset role;
select is((select o.status from public.rf_orders o where o.is_test and o.wo_no = current_setting('test.wo_a2')), 'cancelled', 'the stop cancelled the running work order');
set local role authenticated;

-- 8. ข้อ 2: หลังเลือกหยุด RB ยังบันทึกล็อตตกแต่งของ WO ที่การหยุดยกเลิก · ยางเส้นยาวเข้าสต็อกกลาง SR ----------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select sf_t.finish('FN-F1', current_setting('test.wo_a2'), 'TR-F1', 'CU-F1', 6, '{}'::jsonb) $$,
  'after the stop RB still records a finishing lot of the work order the stop cancelled');
select set_config('test.rfv', public.app_rf_master() ->> 'version', true);
select is(sf_t.rod_lot('FN-F1') ->> 'status' || '/' || (sf_t.rod_lot('FN-F1') ->> 'orderId') || '/' || (sf_t.rod_lot('FN-F1') ->> 'jobNo') || '/' || (sf_t.rod_lot('FN-F1') ->> 'qtySent'),
  'pending/251227-29001/JOB-9-A2/6', 'its rods wait for SR, traced to the cancelled order and its RB job');
select throws_ok($$ select sf_t.finish('FN-F2', current_setting('test.wo_a2'), 'TR-F1', 'CU-F1', 3, '{"destination":"customer","params":{"perBox":10}}'::jsonb) $$,
  'RF_INVALID_LOT', 'those rods go to SR only, never to a customer');
select throws_ok($$ select sf_t.finish('FN-F3', current_setting('test.wo_a3'), 'TR-F3', 'CU-F3', 2, '{}'::jsonb) $$,
  'RF_INVALID_TRANSITION', 'a work order cancelled another way (before the stop) still takes no lot');
select lives_ok($$ select sf_t.finish('FN-F4', current_setting('test.wo_a2'), 'TR-F1', 'CU-F1', 2, '{"qc":"hold"}'::jsonb) $$,
  'a finishing lot on hold is recorded as well');
select ok(sf_t.rod_lot('FN-F4') is null, 'and waits for QA before it becomes rods');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select lives_ok($$ select sf_t.qc_pass('QC-F4', 'FN-F4') $$, 'the QA head passes the held lot');
select is(sf_t.rod_lot('FN-F4') ->> 'status' || '/' || (sf_t.rod_lot('FN-F4') ->> 'qtySent'), 'pending/2', 'the passed lot becomes rods waiting for SR');
reset role;
select is((select o.status || '/' || trim_scale(o.produced_qty)::text from public.rf_orders o where o.is_test and o.wo_no = current_setting('test.wo_a2')), 'cancelled/12',
  'the work order counts what was produced (4 + 6 + 2) and stays cancelled');
select ok(exists (select 1 from public.audit_logs a where a.action = 'RF_SAVE' and a.entity_type = 'rf_master' and a.entity_id = current_setting('test.rfv')
                  and a.metadata ->> 'client_action' = 'recordFinishing' and (a.metadata ->> 'bom_rod_lots')::integer = 1 and (a.metadata ->> 'is_test')::boolean),
  'RubberFlow audits the finishing lot and the rod lot it made');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select lives_ok($$ select sf_t.receive_rods('FN-F0', 4) $$, 'SR receives the rods recorded while planning decided');
select lives_ok($$ select sf_t.receive_rods('FN-F1', 6) $$, 'and the rods recorded after the stop');
select lives_ok($$ select sf_t.receive_rods('FN-F4', 2) $$, 'and the rods QA released');
select is(sf_t.rods(null, 'RB-F1'), 12::numeric, 'all twelve rods are central SR stock');
select is(sf_t.rods('251227-29001', 'RB-F1'), 0::numeric, 'none sits in the bucket of the cancelled order');
select is((sf_t.job('JOB-9-A2') ->> 'qtyDone')::numeric, 0::numeric, 'and the RB job of the cancelled order is not counted');

-- 9. ข้อ 3 + 4: เปิดงานเพิ่มของใบ B ใช้สต็อกกับส่วนที่ฝ่ายขายเพิ่ม (4 → 7) ------------------------------------------------------------------
-- สต็อกสินค้าสำเร็จรูป: ใบ S รับเข้า 3 ชุด (ใส่ตรง) สั่ง 1 = ส่วนเกิน 2 ชุด
reset role;
insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note)
select true, o.id, 'FG-F1', 'receive', 3, '' from public.bom_orders o where o.is_test and o.pi_no = '251227-29003';
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.ver_b', sf_t.ver()::text, true);
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb), '{"FG-F1":4}'::jsonb) $$,
  'BOM_INVALID_ORDER', 'taking more finished goods from stock than sales added (3) is refused');
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb), '{"FG-F1":3}'::jsonb) $$,
  'BOM_FG_EXCEEDS', 'taking more than the free finished-goods stock (2) is refused');
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb), '{"RB-F1":13}'::jsonb) $$,
  'BOM_ROD_EXCEEDS', 'taking more long rods than the central SR stock (12) is refused');
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb), '{"SE-NOPE":1}'::jsonb) $$,
  'BOM_INVALID_ORDER', 'a stock key that is neither a product of the order nor an RB line is refused');
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))), '[]'::jsonb, '{}'::jsonb) $$,
  'BOM_INVALID_PAYLOAD', 'no job and no stock is nothing to do');
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5,"qtyRequired":3}'::jsonb), '{}'::jsonb) $$,
  'BOM_INVALID_JOB', 'the requirement of an existing job never goes down');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb), '{"FG-F1":2}'::jsonb) $$,
  'BOM_FORBIDDEN', 'sales cannot open the extra work');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(sf_t.ver()::text, current_setting('test.ver_b'), 'none of the refused calls wrote anything');
select lives_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":5}'::jsonb, sf_t.new_job('JOB-9-B3', '251227-29002', 'GR', 'SE-F1', 'SE', 'pcs', 3)),
  '{"FG-F1":2,"RB-F1":3}'::jsonb) $$,
  'planning opens the extra work: two sets from finished-goods stock, three rods from the SR store, the rest as jobs');
select is(sf_t.order_row('251227-29002') -> 'stockCounts', '{"FG-F1":2,"RB-F1":3}'::jsonb, 'the order records what it takes from stock');
select is(sf_t.order_row('251227-29002') -> 'plannedItems', '{"FG-F1":7}'::jsonb, 'and that jobs are now open for seven');
select is((sf_t.job('JOB-9-B1') ->> 'qtyPlanned') || '/' || (sf_t.job('JOB-9-B1') ->> 'qtyRequired'), '5/5',
  'the raised PK job plans 5 and its requirement rises by the same step (sent unchanged)');
select is((sf_t.job('JOB-9-B3') ->> 'status') || '/' || (sf_t.job('JOB-9-B3') ->> 'qtyPlanned'), 'queued/3', 'the new GR job is queued');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m
                  where m ->> 'orderId' = '251227-29002' and m ->> 'kind' = 'transfer' and m ->> 'fromOrderId' = '251227-29003' and (m ->> 'qty')::numeric = 2),
  'two sets move from the surplus of order S to order B');
select is(sf_t.rods('251227-29002', 'RB-F1') || '/' || sf_t.rods(null, 'RB-F1'), '3/9', 'three rods move from the central SR stock to the bucket of order B');
reset role;
select ok(exists (select 1 from public.audit_logs a where a.action = 'BOM_MASTER_SAVE' and a.metadata ->> 'client_action' = 'addJobsForChanges'
                  and (a.metadata -> 'counts' -> 'fgMoves' ->> 'upsert')::integer = 1 and (a.metadata -> 'counts' -> 'rodMoves' ->> 'upsert')::integer = 2
                  and (a.metadata ->> 'is_test')::boolean),
  'the save is audited with the stock rows it wrote');
set local role authenticated;
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(7, jsonb_build_array(sf_t.rb_line('RB-F1', 14))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":6}'::jsonb), '{"FG-F1":2,"RB-F1":3}'::jsonb) $$,
  'BOM_INVALID_TRANSITION', 'sales added nothing more: no second round');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select sf_t.edit('251227-29002', '{"items":[{"fgCode":"FG-F1","qty":8,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales raises FG-F1 of order B again, from 7 to 8');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select sf_t.add('251227-29002', sf_t.expl(8, jsonb_build_array(sf_t.rb_line('RB-F1', 16))), '[]'::jsonb, '{"FG-F1":1,"RB-F1":4}'::jsonb) $$,
  'BOM_INVALID_ORDER', 'stock already taken never goes back down');
select lives_ok($$ select sf_t.add('251227-29002', sf_t.expl(8, jsonb_build_array(sf_t.rb_line('RB-F1', 16))), '[]'::jsonb, '{"FG-F1":2,"RB-F1":4}'::jsonb) $$,
  'planning answers the added set from stock only (one more rod from SR) without a job');
select is((sf_t.order_row('251227-29002') -> 'plannedItems') || jsonb_build_object('rods', sf_t.rods('251227-29002', 'RB-F1'),
          'jobs', (select count(*) from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251227-29002')),
  '{"FG-F1":8,"rods":4,"jobs":2}'::jsonb, 'jobs now count for eight, four rods sit with the order and no job was added');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select sf_t.edit('251227-29002', '{"items":[{"fgCode":"FG-F1","qty":9,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales raises FG-F1 of order B once more, to 9');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sf_t.add('251227-29002', sf_t.expl(9, jsonb_build_array(sf_t.rb_line('RB-F1', 18))),
  jsonb_build_array(sf_t.job('JOB-9-B1') || '{"qtyPlanned":6,"qtyRequired":9}'::jsonb), '{"FG-F1":2,"RB-F1":4}'::jsonb) $$,
  'planning raises the PK job and sends the requirement of the new explosion');
select is((sf_t.job('JOB-9-B1') ->> 'qtyPlanned') || '/' || (sf_t.job('JOB-9-B1') ->> 'qtyRequired'), '6/9', 'a requirement above the old one is stored as sent');

-- 10. ข้อ 6: ใบปิดแล้ว การแจ้งแก้ใบที่ยังเปิดปิดเอง · การแจ้งยกเลิกกลางทางที่รอตัดสินยังเปิด ------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select sf_t.edit('251227-29002', '{"salesCancelReason":"ลูกค้ายกเลิกส่วนที่เหลือ"}'::jsonb, 'cancelOrder') $$, 'sales cancels order B mid-way');
select is(sf_t.notices('251227-29002', 'change', 'open'), 3, 'the three edit notices of order B are still open');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sf_t.close_job('JOB-9-B1') $$, 'planning closes the PK job with a reason');
select lives_ok($$ select sf_t.close_job('JOB-9-B3') $$, 'and the GR job');
select is(sf_t.notices('251227-29002', 'change', 'open'), 3, 'closing jobs of an open order closes no notice');
-- ของครบ 9 ชุด: ได้จากสต็อก 2 + รับเข้า 7 (ใส่ตรง)
reset role;
insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note)
select true, o.id, 'FG-F1', 'receive', 7, '' from public.bom_orders o where o.is_test and o.pi_no = '251227-29002';
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select lives_ok($$ select sf_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('orderId', '251227-29002', 'kind', 'close')))), 'closeOrder') $$,
  'the warehouse closes order B: every job is done and it holds all nine sets');
select is(sf_t.order_row('251227-29002') ->> 'status', 'completed', 'order B is completed');
select is(sf_t.notices('251227-29002', 'change', 'open') || '/' || sf_t.notices('251227-29002', 'change', 'done'), '0/3', 'closing the order closes its three edit notices');
select is(sf_t.notice('251227-29002', 'change') ->> 'decision' || '/' || (sf_t.notice('251227-29002', 'change') ->> 'decidedBy'),
  'ack/' || current_setting('test.n_sbx_wh_staff'), 'as acknowledged, by who closed the order');
select is(sf_t.notice('251227-29002', 'cancel') ->> 'status', 'open', 'the mid-way cancel waiting for a choice stays open');
select is((sf_t.order_row('251227-29002') ->> 'started') || '/' || (sf_t.order_row('251227-29002') ->> 'locked'), 'false/false',
  'a closed order is neither started nor locked for the client');
reset role;
select ok(exists (select 1 from public.audit_logs a where a.action = 'BOM_MASTER_SAVE' and a.metadata ->> 'client_action' = 'closeOrder'
                  and (a.metadata -> 'counts' -> 'orderRequests' ->> 'upsert')::integer = 3 and (a.metadata ->> 'is_test')::boolean),
  'the close is audited with the three notices it closed');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select sf_t.decide('251227-29002', 'cancel', 'continue') $$, 'planning still chooses to produce to the end for the closed order');
select is(sf_t.order_row('251227-29002') ->> 'salesCancelChoice' || '/' || (sf_t.notice('251227-29002', 'cancel') ->> 'decision'), 'continue/continue',
  'the choice is recorded on the order and on its notice');

reset role;
select is((select count(*)::integer from public.bom_orders where not is_test and pi_no like '251227-29%'), 0, 'test orders never land in the real data');

select * from finish();
rollback;
