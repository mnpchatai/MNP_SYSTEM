-- ใบสั่งผลิตจากฝ่ายขาย (SA) ส่งให้ฝ่ายวางแผน (PP) · ฝ่ายขายแก้ / ยกเลิกใบเองแล้วแจ้งฝ่ายวางแผน · ผู้เขียนใบสั่งผลิตและลูกค้า (โรงงาน ขั้น 8 · 20261226010000_bom_sales_orders.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง (คอลัมน์ ตารางการแจ้ง ฟังก์ชันใหม่ รายการ action) · นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY
-- · ฝ่ายขายเปิด / แก้ / ส่ง / ยกเลิกร่างของใบฝ่ายขาย · แตะใบของฝ่ายวางแผน ปล่อยผลิต คำนวณ ตั้งกำหนดเสร็จรายแผนก ยอดจากสต็อก ไม่ได้
-- · หลังปล่อยผลิต (รอบ 2): ยังไม่เริ่มงาน = ยกเลิกทันที / เปิดกลับเป็นร่าง · เริ่มงานแล้ว = แก้ใบตรง (แจ้งฝ่ายวางแผน รับทราบ) / ยกเลิกกลางทาง (ไม่รับงานใหม่
--   ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH หรือหยุด) · ฝ่ายขายและผู้จัดการแผนกในสายผลิตเลือกแทนไม่ได้
-- · ผู้จัดการแผนกในสายผลิต (SBX-PK-MGR) เขียนใบสั่งผลิต / ลูกค้าไม่ได้แล้ว แต่สิทธิ์อื่นของกลุ่มวางแผน (ข้อมูลหลัก) คงเดิม · พนักงานแผนกอื่นไม่ได้
-- ข้อควรระวัง: เรียก private.* ก่อนสลับเป็น authenticated เท่านั้น (สิทธิ์ execute ถูกถอนจาก authenticated · CI ขั้น 7) และอ่านตารางตรงด้วย reset role เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และรายการ action -------------------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_orders' and column_name = 'source' and column_default like '%PP%')
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_orders' and column_name = 'sent_at')
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_orders' and column_name = 'sent_by'),
  'an order has its source (default PP) and when / who sent it to planning');
select ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'bom_orders'
           and column_name in ('sales_cancel_at', 'sales_cancel_by', 'sales_cancel_reason', 'sales_cancel_choice')) = 4
          and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_orders'::regclass and c.conname = 'bom_orders_sales_cancel_check'),
  'an order records a mid-way cancel by sales and the choice of planning');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_order_requests' and column_name = 'decision')
          and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_order_requests' and column_name = 'decision_note'),
  'a notice records the decision of planning (ack / continue / stop)');
select ok(not exists (select 1 from public.bom_orders where source <> 'PP' or sent_at is not null or sales_cancel_at is not null),
  'every order made before the migration is a planning order, not sent and not cancelled by sales');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.bom_order_requests'::regclass)
          and not has_table_privilege('anon', 'public.bom_order_requests', 'select') and not has_table_privilege('authenticated', 'public.bom_order_requests', 'select')
          and not has_table_privilege('authenticated', 'public.bom_order_requests', 'insert') and not has_table_privilege('authenticated', 'public.bom_order_requests', 'update'),
  'the request table has RLS on and no direct grant to anon or authenticated');
select ok('bom_order_requests' = any (private.sandbox_unguarded_tables())
          and position('bom_order_requests' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
          and exists (select 1 from pg_trigger g where g.tgrelid = 'public.bom_order_requests'::regclass and g.tgname = 'bom_order_requests_sandbox_scope')
          and exists (select 1 from pg_trigger g where g.tgrelid = 'public.bom_order_requests'::regclass and g.tgname = 'bom_order_requests_stamp_version')
          and exists (select 1 from pg_policy p where p.polrelid = 'public.bom_order_requests'::regclass and p.polname = 'lab_only_no_access'),
  'the request table knows the test mode, is stamped, purged with the test data and guarded for lab-only accounts');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_order_requests_one_open_idx' and indexdef like '%cancel%'),
  'one open cancel notice per order is also enforced by an index (change notices may stack)');
select ok(array['updateOrderHeader', 'sendOrderToPlanning', 'decideOrderRequest'] <@ private.bom_client_actions()
          and not (array['requestOrderCancel'] <@ private.bom_client_actions()) and not (array['requestOrderChange'] <@ private.bom_client_actions())
          and array['createOrder', 'saveCustomer', 'sendOrderToPlanning', 'cancelOrder', 'updateOrderItem', 'updateOrderHeader'] <@ private.bom_sales_actions()
          and not (array['releaseOrder'] <@ private.bom_sales_actions()) and not (array['explodeOrder'] <@ private.bom_sales_actions())
          and not (array['decideOrderRequest'] <@ private.bom_sales_actions()) and not (array['setStockCount'] <@ private.bom_sales_actions())
          and not (array['createOrder'] <@ private.bom_staff_actions()) and not (array['decideOrderRequest'] <@ private.bom_staff_actions()),
  'the new actions are on the client list and the request actions are gone · sales may edit and cancel orders but not release, explode, decide or count');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_can_sell(public.employees)'::regprocedure, 'private.bom_can_plan_orders(public.employees)'::regprocedure,
                           'private.bom_can_order(public.employees)'::regprocedure, 'private.bom_order_locked(uuid)'::regprocedure,
                           'private.bom_save_order_request(public.employees,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the new and replaced functions are security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('bom_can_sell', 'bom_can_plan_orders', 'bom_can_order', 'bom_sales_actions', 'bom_sa_items_ok', 'bom_save_order_request', 'bom_save_orders',
                        'bom_order_locked', 'bom_sa_change_summary', 'bom_fg_free')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the new helpers or the writers directly');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.bom_sa_change_summary(public.bom_orders,text,text,text,bigint,text,jsonb)'::regprocedure),
  'the change summary has an empty search_path');
-- สรุปการแก้ใบ (เหตุผลของการแจ้ง kind change): หัวใบ แล้วสินค้าตามลำดับใหม่ แล้วสินค้าที่ลบ · วันที่ไทย DD/MM/YYYY · ตรงกับ salesChangeSummary ของ client ทุกตัวอักษร
select is(private.bom_sa_change_summary(
            jsonb_populate_record(null::public.bom_orders, '{"customer":"ลูกค้าเดิม","country":"TH","order_type":"SA","wh_due":1769212800000,"note":"",
              "items":[{"fgCode":"FG-S1","qty":5,"colorSet":"","note":""},{"fgCode":"FG-S2-Y","qty":2.5,"colorSet":"Y","note":""}]}'::jsonb),
            'ลูกค้าใหม่', 'TH', 'SA', 1769385600000, 'ด่วน',
            '[{"fgCode":"FG-S1","qty":3,"colorSet":"","note":"แพ็กใหม่"},{"fgCode":"FG-S3","qty":4,"colorSet":"","note":""}]'::jsonb),
  'ลูกค้า ลูกค้าเดิม → ลูกค้าใหม่ · กำหนดส่งคลัง 24/01/2026 → 26/01/2026 · แก้หมายเหตุ · FG-S1 5 → 3 · เพิ่ม FG-S3 × 4 · ลบ FG-S2-Y × 2.5',
  'the change summary lists the header, then changed and added products, then removed ones');
select is(private.bom_sa_change_summary(
            jsonb_populate_record(null::public.bom_orders, '{"customer":"ก","country":"TH","order_type":"SA","wh_due":1769212800000,"note":"",
              "items":[{"fgCode":"FG-S1","qty":5,"colorSet":"","note":""}]}'::jsonb),
            'ก', 'TH', 'SA', 1769212800000, '', '[{"fgCode":"FG-S1","qty":5,"colorSet":"","note":"ห่อแยก"}]'::jsonb),
  'FG-S1 แก้หมายเหตุ', 'a note on a product line is named without old and new text');
select is(char_length(private.bom_sa_change_summary(
            jsonb_populate_record(null::public.bom_orders, '{"customer":"ก","country":"TH","order_type":"SA","wh_due":1769212800000,"note":"","items":[]}'::jsonb),
            repeat('ข', 400), 'TH', 'SA', 1769212800000, '', '[]'::jsonb)), 300, 'a long summary is cut to 300 characters');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(private.bom_sa_items_ok('[]'::jsonb, '[{"fgCode":"FG-S2-Y","colorSet":"Y"},{"fgCode":"FG-S1","colorSet":""}]'::jsonb)
          and not private.bom_sa_items_ok('[]'::jsonb, '[{"fgCode":"FG-S1","colorSet":"Y"}]'::jsonb)
          and private.bom_sa_items_ok('[{"fgCode":"FG-S1","colorSet":"B"}]'::jsonb, '[{"fgCode":"FG-S1","colorSet":"B"}]'::jsonb)
          and not private.bom_sa_items_ok('[{"fgCode":"FG-S1","colorSet":"B"}]'::jsonb, '[{"fgCode":"FG-S1","colorSet":""}]'::jsonb),
  'a sales line keeps the colour set it had, and a new line takes the colour set of its code');

-- 2. บัญชีทดสอบและตัวช่วยของเทสต์ -------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8fa00000-0000-0000-0000-000000000001', 'salesorders-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8fa00000-0000-0000-0000-000000000101', 'SALESORDERS-ADMIN', 'Salesorders', 'Admin', 'salesorders-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8fa00000-0000-0000-0000-000000000001');
-- หัวหน้าฝ่ายขาย (ผู้จัดการแผนก SA): บัญชีทดสอบ (is_test · inactive ตามข้อบังคับของ persona)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-SA-MGR-T', 'ทดสอบ', 'หัวหน้าฝ่ายขาย', 'sbx-sa-mgr-t@sandbox.local', 'ผจก. ฝ่ายขาย (ทดสอบ)',
   (select id from public.departments where code = 'SA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-SA-STAFF' and d.code = 'SA' and r.code = 'staff')
                                or (e.employee_no = 'SBX-SA-MGR-T' and d.code = 'SA' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no = 'SBX-PK-MGR' and d.code = 'PK' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK' and r.code = 'staff')
                                or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR' and r.code = 'staff')
                                or (e.employee_no = 'SBX-FT-AFM' and r.code = 'assistant_factory_manager'))), 7,
  'the personas used below belong to the departments and roles the rules name');
-- ผู้เขียนใบสั่งผลิต: ฝ่ายขาย (ทุกบทบาท) และกลุ่มวางแผนของใบ (PP ผู้ช่วยผู้จัดการโรงงานขึ้นไป) · ผู้จัดการแผนก PK ยังเป็นกลุ่มวางแผนของ BOM แต่ไม่ใช่ผู้เขียนใบ
select ok(private.bom_can_sell((select e from public.employees e where e.employee_no = 'SBX-SA-STAFF'))
          and private.bom_can_order((select e from public.employees e where e.employee_no = 'SBX-SA-STAFF'))
          and not private.bom_can_plan_orders((select e from public.employees e where e.employee_no = 'SBX-SA-STAFF'))
          and not private.bom_can_edit((select e from public.employees e where e.employee_no = 'SBX-SA-STAFF'))
          and private.bom_can_sell((select e from public.employees e where e.employee_no = 'SBX-SA-MGR-T'))
          and not private.bom_can_plan_orders((select e from public.employees e where e.employee_no = 'SBX-SA-MGR-T')),
  'sales staff and the sales head can sell but are not planners');
select ok(private.bom_can_plan_orders((select e from public.employees e where e.employee_no = 'SBX-PP-STAFF'))
          and private.bom_can_plan_orders((select e from public.employees e where e.employee_no = 'SBX-FT-AFM'))
          and not private.bom_can_sell((select e from public.employees e where e.employee_no = 'SBX-PP-STAFF')),
  'planning staff and an assistant factory manager plan orders');
select ok(private.bom_can_edit((select e from public.employees e where e.employee_no = 'SBX-PK-MGR'))
          and not private.bom_can_order((select e from public.employees e where e.employee_no = 'SBX-PK-MGR'))
          and not private.bom_can_order((select e from public.employees e where e.employee_no = 'SBX-GR-STAFF')),
  'the PK department manager stays in the BOM planner group but no longer writes orders or customers · GR staff never did');

create schema so_t;
grant usage on schema so_t to authenticated;
create function so_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function so_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, so_t.ver(), p_action)
$$;
create function so_t.orders(p_rows jsonb, p_action text) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', p_rows)), p_action)
$$;
create function so_t.uid(p_n integer) returns text language sql immutable as $$ select '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0') $$;
create function so_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
-- แก้ใบ: แถวปัจจุบัน + ส่วนที่ต่าง
create function so_t.edit(p_no text, p_extra jsonb, p_action text) returns jsonb language sql volatile as $$
  select so_t.orders(jsonb_build_array(so_t.order_row(p_no) || p_extra), p_action)
$$;
-- ใบใหม่ของฝ่ายขาย: หัวใบ + สินค้า (ไม่มีกำหนดเสร็จรายแผนก ผลระเบิด ยอดจากสต็อก) · ส่วนที่ต่างส่งทับด้วย ||
create function so_t.sa_order(p_no text, p_extra jsonb) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p_no, 'customer', 'ลูกค้าฝ่ายขาย', 'country', 'TH', 'orderType', 'SA', 'orderedAt', 1766620800000, 'whDue', 1769212800000,
                            'due', '{}'::jsonb, 'dueDefaults', '[]'::jsonb, 'revision', 0, 'status', 'draft',
                            'items', '[{"fgCode":"FG-S1","qty":5,"colorSet":"","note":""}]'::jsonb, 'explosion', null, 'explodedAt', null,
                            'stockCounts', '{}'::jsonb, 'note', '') || p_extra
$$;
-- ตัดสินการแจ้ง (แถวเดียวในส่วน orderRequests) · ส่วนอื่นที่มาพร้อมกัน (หยุด = แถวยกเลิกใบ) ส่งใน p_more
create function so_t.req(p_row jsonb, p_action text, p_more jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object('orderRequests', jsonb_build_object('upsert', jsonb_build_array(p_row))) || p_more, p_action)
$$;
create function so_t.request(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r where r ->> 'id' = p_id
$$;
-- การแจ้งล่าสุดของใบ ชนิดหนึ่ง (เซิร์ฟเวอร์เขียนเอง จึงหาจากใบ) · null = ไม่มี
create function so_t.notice(p_no text, p_kind text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r
  where r ->> 'orderId' = p_no and r ->> 'kind' = p_kind order by (r ->> 'requestedAt')::bigint desc, r ->> 'id' desc limit 1
$$;
create function so_t.decide(p_no text, p_kind text, p_decision text, p_more jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select so_t.req(jsonb_build_object('id', so_t.notice(p_no, p_kind) ->> 'id', 'decision', p_decision), 'decideOrderRequest', p_more)
$$;
-- รายงานงานแรกของงาน (พนักงานแผนกของงาน): งานเริ่ม ใบเป็น in_progress
create function so_t.start(p_job text) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
    (select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_job)
    || jsonb_build_object('status', 'in_progress', 'qtyDone', 1, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'ใครก็ได้', 'good', 1, 'reject', 0, 'note', 'เริ่ม')))))), 'reportJob')
$$;
-- ปล่อยผลิต (ฝ่ายวางแผน): ผลระเบิดหนึ่งบรรทัดของ FG-S1 + งาน PK หนึ่งงาน
create function so_t.release(p_no text, p_job text) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row(p_no) || jsonb_build_object('status', 'released',
      'explosion', jsonb_build_array(jsonb_build_object('itemCode', 'FG-S1', 'kind', 'FG', 'level', 0, 'fgQty', 5, 'required', 5))))),
    'jobs', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
      'id', p_job, 'orderId', p_no, 'dept', 'PK', 'itemCode', 'FG-S1', 'name', 'สินค้า S1', 'kind', 'FG', 'uom', 'set', 'qtyPlanned', 5, 'qtyRequired', 5,
      'stockCounted', null, 'qtyDone', 0, 'qtyReject', 0, 'dueAt', 1769212800000, 'status', 'queued', 'externalRef', null, 'fgCodes', jsonb_build_array('FG-S1'),
      'reports', '[]'::jsonb)))), 'releaseOrder')
$$;

-- 3. นอกโหมดทดสอบ: action ใหม่ = BOM_TEST_MODE_ONLY (private.bom_real_open() ยังเป็น false) ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8fa00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.app_bom_save_master('{"orders":{"upsert":[{}]}}'::jsonb, 0, 'sendOrderToPlanning') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot send an order to planning');
select throws_ok($$ select public.app_bom_save_master('{"orders":{"upsert":[{}]}}'::jsonb, 0, 'cancelOrder') $$, 'BOM_TEST_MODE_ONLY',
  'nor cancel one');
select throws_ok($$ select public.app_bom_save_master('{"orderRequests":{"upsert":[{}]}}'::jsonb, 0, 'decideOrderRequest') $$, 'BOM_TEST_MODE_ONLY',
  'nor decide a notice of sales');

-- 4. ข้อมูลตั้งต้น (ฝ่ายวางแผน): สินค้า FG-S1 / FG-S2-Y และใบของฝ่ายวางแผน 251225-28001 ที่ปล่อยผลิตแล้ว ---------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select so_t.save('{"items":{"upsert":[
  {"code":"FG-S1","kind":"FG","name":"สินค้า S1","ownerDept":"PK","uom":"set"},
  {"code":"FG-S2-Y","kind":"FG","name":"สินค้า S2 ชุดสี Y","ownerDept":"PK","uom":"set"}]}}'::jsonb, 'importFlat');
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28001', '{"customer":"ลูกค้าวางแผน","due":{"PK":1768000000000}}'::jsonb)), 'createOrder') $$,
  'planning opens its own order with a department due');
select is(so_t.order_row('251225-28001') ->> 'source', 'PP', 'an order opened by planning has source PP');
select ok(not (so_t.order_row('251225-28001') ? 'sentAt'), 'and is never sent');
select lives_ok($$ select so_t.release('251225-28001', 'JOB-8-PP1') $$, 'planning releases its order');

-- 5. ฝ่ายขายเปิด / แก้ / ส่งใบของฝ่ายขาย --------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"due":{"PK":1768000000000}}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'sales cannot set a department due');
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"dueDefaults":["PK"]}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'nor default dues');
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"explosion":[{"itemCode":"FG-S1","kind":"FG"}]}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'nor bring an explosion');
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"stockCounts":{"FG-S1":1}}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'nor take finished goods from stock');
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"items":[{"fgCode":"FG-S1","qty":5,"colorSet":"Y","note":""}]}'::jsonb)), 'createOrder') $$,
  'BOM_FORBIDDEN', 'nor pick a colour set other than the one in the product code');
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28101', '{"items":[{"fgCode":"FG-S1","qty":5,"colorSet":"","note":""},{"fgCode":"FG-S2-Y","qty":2,"colorSet":"Y","note":"สีเหลือง"}]}'::jsonb)), 'createOrder') $$,
  'sales opens an order with two products');
select is(so_t.order_row('251225-28101') ->> 'source' || '/' || (so_t.order_row('251225-28101') ->> 'status') || '/' || (so_t.order_row('251225-28101') ->> 'createdBy'),
  'SA/draft/' || current_setting('test.n_sbx_sa_staff'), 'the order is a sales draft with who opened it');
select ok(not (so_t.order_row('251225-28101') ? 'sentAt'), 'it is not sent yet');
select lives_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้าใหม่ฝ่ายขาย","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$,
  'sales adds a customer');
select lives_ok($$ select so_t.edit('251225-28101', '{"customer":"ลูกค้าใหม่ฝ่ายขาย","whDue":1769299200000,"note":"ด่วน"}'::jsonb, 'updateOrderHeader') $$,
  'sales edits the header of its draft');
select lives_ok($$ select so_t.edit('251225-28101', '{"items":[{"fgCode":"FG-S1","qty":6,"colorSet":"","note":""},{"fgCode":"FG-S2-Y","qty":2,"colorSet":"Y","note":"สีเหลือง"}]}'::jsonb, 'updateOrderItem') $$,
  'and the quantity of a product');
select throws_ok($$ select so_t.edit('251225-28101', '{"orderedAt":1766534400000}'::jsonb, 'updateOrderHeader') $$, 'BOM_FORBIDDEN', 'sales cannot change the order date');
select throws_ok($$ select so_t.edit('251225-28101', '{"due":{"PK":1768000000000}}'::jsonb, 'updateOrderHeader') $$, 'BOM_FORBIDDEN', 'nor set a department due');
select throws_ok($$ select so_t.edit('251225-28101', '{"explosion":[{"itemCode":"FG-S1","kind":"FG"}]}'::jsonb, 'explodeOrder') $$, 'BOM_FORBIDDEN',
  'nor explode (explodeOrder is not a sales action)');
select throws_ok($$ select so_t.edit('251225-28101', '{"explosion":[{"itemCode":"FG-S1","kind":"FG"}]}'::jsonb, 'updateOrderItem') $$, 'BOM_FORBIDDEN',
  'nor write an explosion under a sales action');
select throws_ok($$ select so_t.edit('251225-28101', '{"stockCounts":{"FG-S1":1}}'::jsonb, 'updateOrderItem') $$, 'BOM_FORBIDDEN', 'nor take finished goods from stock');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"released"}'::jsonb, 'releaseOrder') $$, 'BOM_FORBIDDEN', 'nor release (coarse gate)');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"released","explosion":[{"itemCode":"FG-S1","kind":"FG"}]}'::jsonb, 'updateOrderItem') $$, 'BOM_FORBIDDEN',
  'nor release under a sales action');
select throws_ok($$ select so_t.edit('251225-28001', '{"note":"แก้โดยฝ่ายขาย"}'::jsonb, 'updateOrderHeader') $$, 'BOM_FORBIDDEN', 'sales cannot touch an order of planning');
select throws_ok($$ select so_t.edit('251225-28001', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN',
  'nor cancel one');
select throws_ok($$ select so_t.edit('251225-28001', '{"sentAt":1766620800000}'::jsonb, 'sendOrderToPlanning') $$, 'BOM_FORBIDDEN',
  'nor send one');

-- ฝ่ายวางแผนปล่อยใบของฝ่ายขายที่ยังไม่ส่งไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.release('251225-28101', 'JOB-8-SA1') $$, 'BOM_INVALID_TRANSITION', 'planning cannot release a sales order that was not sent');
select throws_ok($$ select so_t.edit('251225-28001', '{"sentAt":1766620800000}'::jsonb, 'sendOrderToPlanning') $$, 'BOM_INVALID_TRANSITION',
  'a planning order is never sent');

select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28101', '{"sentAt":1}'::jsonb, 'sendOrderToPlanning') $$, 'sales sends its order to planning');
select ok((so_t.order_row('251225-28101') ->> 'sentAt')::bigint > 1 and so_t.order_row('251225-28101') ->> 'sentBy' = current_setting('test.n_sbx_sa_staff'),
  'the server stamps when and who sent it');
select set_config('test.sent', so_t.order_row('251225-28101') ->> 'sentAt', true);
select lives_ok($$ select so_t.edit('251225-28101', '{"sentAt":5,"note":"ด่วนมาก"}'::jsonb, 'updateOrderHeader') $$, 'sales still edits the sent draft');
select is(so_t.order_row('251225-28101') ->> 'sentAt', current_setting('test.sent'), 'the send time is set once');
select throws_ok($$ select so_t.edit('251225-28101', '{"sentAt":"x"}'::jsonb, 'sendOrderToPlanning') $$, 'BOM_INVALID_ORDER', 'a send time must be a number');
-- ใบว่าง: ส่งไม่ได้ · ยกเลิกร่างเองได้พร้อมเหตุผล
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28102', '{"items":[]}'::jsonb)), 'createOrder') $$, 'sales opens an empty draft');
select throws_ok($$ select so_t.edit('251225-28102', '{"sentAt":1}'::jsonb, 'sendOrderToPlanning') $$, 'BOM_INVALID_TRANSITION', 'an order without products cannot be sent');
select throws_ok($$ select so_t.edit('251225-28102', '{"status":"cancelled","cancelReason":"ab"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_ORDER',
  'a cancel needs a reason of three characters');
select lives_ok($$ select so_t.edit('251225-28102', '{"status":"cancelled","cancelReason":"เปิดซ้ำ"}'::jsonb, 'cancelOrder') $$, 'sales cancels its own draft');
select is(so_t.order_row('251225-28102') ->> 'status' || '/' || (so_t.order_row('251225-28102') ->> 'cancelReason'), 'cancelled/เปิดซ้ำ', 'the draft is cancelled with the reason');
-- เปิดพร้อมส่งได้
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28103', '{"sentAt":1}'::jsonb)), 'createOrder') $$, 'sales opens and sends in one call');
select ok(so_t.order_row('251225-28103') ? 'sentAt', 'the order opened with a send is sent');
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28104', '{"items":[],"sentAt":1}'::jsonb)), 'createOrder') $$, 'BOM_INVALID_TRANSITION',
  'but not without products');

-- 6. พนักงานแผนกอื่นและผู้จัดการแผนกในสายผลิต: ใบสั่งผลิต / ลูกค้าไม่ได้ · สิทธิ์อื่นคงเดิม -------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28201', '{}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN', 'GR staff cannot open an order');
select throws_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้า GR","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$, 'BOM_FORBIDDEN',
  'nor add a customer');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN',
  'nor cancel a sales order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28202', '{"due":{"PK":1768000000000}}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'the PK department manager can no longer open an order');
select throws_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้า PK","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$, 'BOM_FORBIDDEN',
  'nor add a customer');
select throws_ok($$ select so_t.edit('251225-28001', '{"note":"แก้โดยหัวหน้า PK"}'::jsonb, 'updateOrderHeader') $$, 'BOM_FORBIDDEN', 'nor edit an order');
select throws_ok($$ select so_t.edit('251225-28001', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN', 'nor cancel one');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN', 'nor a sales order');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(2), 'decision', 'ack'), 'decideOrderRequest') $$, 'BOM_FORBIDDEN',
  'nor decide a notice of sales');
select lives_ok($$ select so_t.save('{"items":{"upsert":[{"code":"FG-S3","kind":"FG","name":"สินค้า S3 โดยหัวหน้า PK","ownerDept":"PK","uom":"set"}]}}'::jsonb, 'saveItem') $$,
  'but keeps writing master data like the rest of the BOM planner group');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28203', '{"customer":"ลูกค้าผู้จัดการ"}'::jsonb)), 'createOrder') $$,
  'an assistant factory manager opens an order');
select is(so_t.order_row('251225-28203') ->> 'source', 'PP', 'with source PP');
select lives_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้าผู้จัดการ","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$,
  'and adds a customer');

-- 7. ยังไม่เริ่มงาน: ฝ่ายขายยกเลิกทันที (ร่างที่ส่งแล้ว / ปล่อยผลิตแล้ว) + แจ้งฝ่ายวางแผน "ฝ่ายขายยกเลิกใบ" · ฝ่ายวางแผนรับทราบ ----------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28101', 'JOB-8-SA1') $$, 'planning releases the sent sales order');
select throws_ok($$ select so_t.save('{"orderRequests":{"upsert":[{}]}}'::jsonb, 'requestOrderCancel') $$, 'BOM_INVALID_ACTION',
  'the request actions of the first round are gone');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28101', '{"salesCancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_TRANSITION',
  'no job started yet: sales cancels outright, not mid-way');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"cancelled","cancelReason":"ab"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_ORDER',
  'a cancel needs a reason of three characters');
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"released","note":"แก้ไม่ได้"}'::jsonb, 'updateOrderHeader') $$, 'BOM_INVALID_TRANSITION',
  'a released order with no job started is not edited in place (sales pulls it back to draft instead)');
select lives_ok($$ select so_t.edit('251225-28101', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิกคำสั่งซื้อ"}'::jsonb, 'cancelOrder') $$,
  'sales cancels its released order while no job started');
select is(so_t.order_row('251225-28101') ->> 'status' || '/' || (so_t.order_row('251225-28101') ->> 'cancelReason'), 'cancelled/ลูกค้ายกเลิกคำสั่งซื้อ',
  'the order is cancelled at once with the reason');
select ok(not (so_t.order_row('251225-28101') ? 'salesCancelAt'), 'an outright cancel is not a mid-way cancel');
select is(so_t.notice('251225-28101', 'cancel') ->> 'status' || '/' || (so_t.notice('251225-28101', 'cancel') ->> 'reason') || '/'
          || (so_t.notice('251225-28101', 'cancel') ->> 'requestedBy'),
  'open/ลูกค้ายกเลิกคำสั่งซื้อ/' || current_setting('test.n_sbx_sa_staff'), 'planning gets a notice "sales cancelled the order" with who and why');
select ok(so_t.notice('251225-28101', 'cancel') -> 'decision' = 'null'::jsonb and so_t.notice('251225-28101', 'cancel') -> 'decidedBy' = 'null'::jsonb,
  'not acknowledged yet');
select throws_ok($$ select so_t.decide('251225-28101', 'cancel', 'ack') $$, 'BOM_FORBIDDEN', 'sales cannot acknowledge its own notice');
-- ร่างที่ส่งแล้วยกเลิก = แจ้ง · ร่างที่ยังไม่เคยส่ง (251225-28102 ข้างบน) ไม่แจ้ง
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28105', '{"sentAt":1}'::jsonb)), 'createOrder') $$, 'sales opens and sends another order');
select lives_ok($$ select so_t.edit('251225-28105', '{"status":"cancelled","cancelReason":"ลูกค้าเปลี่ยนใจ"}'::jsonb, 'cancelOrder') $$, 'and cancels the sent draft');
select is(so_t.notice('251225-28105', 'cancel') ->> 'reason', 'ลูกค้าเปลี่ยนใจ', 'a sent draft that is cancelled is notified');
select ok(so_t.notice('251225-28102', 'cancel') is null, 'a draft never sent is cancelled without a notice');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.decide('251225-28101', 'cancel', 'continue') $$, 'BOM_INVALID_REQUEST', 'an outright cancel has no choice to make');
select throws_ok($$ select so_t.decide('251225-28101', 'cancel', 'stop') $$, 'BOM_INVALID_REQUEST', 'neither stop');
select throws_ok($$ select so_t.decide('251225-28101', 'cancel', 'maybe') $$, 'BOM_INVALID_REQUEST', 'an unknown decision is refused');
select throws_ok($$ select so_t.save('{"orderRequests":{"upsert":[]}}'::jsonb, 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST', 'an empty decision is refused');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(9), 'decision', 'ack'), 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST', 'an unknown notice is refused');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.notice('251225-28101', 'cancel') ->> 'id', 'decision', 'ack'), 'cancelOrder') $$, 'BOM_INVALID_REQUEST',
  'the notice section only goes with decideOrderRequest');
select lives_ok($$ select so_t.decide('251225-28101', 'cancel', 'ack') $$, 'planning acknowledges the notice');
select is(so_t.notice('251225-28101', 'cancel') ->> 'status' || '/' || (so_t.notice('251225-28101', 'cancel') ->> 'decision') || '/'
          || (so_t.notice('251225-28101', 'cancel') ->> 'decidedBy'),
  'done/ack/' || current_setting('test.n_sbx_pp_staff'), 'the notice is done with who acknowledged it');
select throws_ok($$ select so_t.decide('251225-28101', 'cancel', 'ack') $$, 'BOM_INVALID_TRANSITION', 'a notice is acknowledged once');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_master_since(so_t.ver() - 1) -> 'changes' -> 'orderRequests' -> 'upsert') r
                  where r ->> 'id' = so_t.notice('251225-28101', 'cancel') ->> 'id'),
  'the delta carries the acknowledged notice');

-- 8. เปิดใบกลับเป็นร่าง (ยังไม่มีงานเริ่ม) · งานเริ่มแล้ว: ฝ่ายขายแก้ใบตรง (สถานะเท่าเดิม งานไม่เปลี่ยน) + แจ้ง "ฝ่ายขายแก้ใบ" -------------------------------
select lives_ok($$ select so_t.release('251225-28103', 'JOB-8-SA3') $$, 'planning releases the order that was sent on opening');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
-- ตัวลบงานตรง ๆ (jobs.delete) รับเฉพาะกลุ่มวางแผน: payload ของฝ่ายขายที่ยังพาการลบงานของใบที่เปิดกลับไปด้วยถูกปฏิเสธทั้งคำสั่ง (store ของหน้าไม่ส่งส่วนนี้ · ฐานข้อมูลลบงานของใบเอง)
select throws_ok($$ select so_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28103') || '{"status":"draft","revision":1,"explosion":null,"items":[{"fgCode":"FG-S1","qty":7,"colorSet":"","note":""}]}'::jsonb)),
  'jobs', jsonb_build_object('delete', jsonb_build_array(jsonb_build_object('id', 'JOB-8-SA3')))), 'updateOrderItem') $$, 'BOM_FORBIDDEN',
  'a sales payload that also deletes the jobs of the reopened order is refused');
select is(so_t.order_row('251225-28103') ->> 'status', 'released', 'the refused call changed nothing');
select lives_ok($$ select so_t.edit('251225-28103', '{"status":"draft","revision":1,"explosion":null,"items":[{"fgCode":"FG-S1","qty":7,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales edits the released order while no job started (the order goes back to draft)');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'revision') || '/' || (so_t.order_row('251225-28103') -> 'items' -> 0 ->> 'qty'),
  'draft/1/7', 'the order is a draft again at revision 1 with the new quantity');
select ok(so_t.order_row('251225-28103') ? 'sentAt' and not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251225-28103'),
  'it stays sent to planning and its jobs are gone');
select ok(so_t.notice('251225-28103', 'change') is null, 'pulling an order back to draft is not a notice (planning releases it again anyway)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28103', 'JOB-8-SA3B') $$, 'planning releases it again');
-- แก้หัวใบของใบที่ปล่อยแล้ว (รูปที่หน้าส่งจริง: แถวใบแถวเดียว สถานะร่าง revision + 1 ผลระเบิดเดิม · ไม่มี jobs.delete) · วันส่งมอบคลังเลื่อนออกได้
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28103', '{"status":"draft","revision":2,"explodedAt":null,"whDue":1769385600000,"note":"ลูกค้าขอเลื่อนส่ง"}'::jsonb, 'updateOrderHeader') $$,
  'sales edits the header of the released order (the order goes back to draft)');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'revision') || '/' || (so_t.order_row('251225-28103') ->> 'whDue')
          || '/' || (so_t.order_row('251225-28103') ->> 'note'),
  'draft/2/1769385600000/ลูกค้าขอเลื่อนส่ง', 'a draft again at revision 2 with the new warehouse date and note');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251225-28103')
          and exists (select 1 from jsonb_array_elements(public.app_bom_master_since(so_t.ver() - 1) -> 'changes' -> 'jobs' -> 'delete') d where d ->> 'id' = 'JOB-8-SA3B'),
  'the server dropped its job and the delta carries the tombstone the page applies');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28103', 'JOB-8-SA3C') $$, 'planning releases it once more');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select so_t.start('JOB-8-SA3C') $$, 'PK starts the job');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28103', '{"status":"draft","revision":3,"explosion":null,"items":[{"fgCode":"FG-S1","qty":8,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'once a job started sales cannot pull the order back');
select throws_ok($$ select so_t.edit('251225-28103', '{"explosion":null,"items":[{"fgCode":"FG-S1","qty":9,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'an edit in place keeps the explosion (no new calculation)');
select throws_ok($$ select so_t.edit('251225-28103', '{"status":"completed","items":[{"fgCode":"FG-S1","qty":9,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'BOM_FORBIDDEN', 'nor changes the status');
select lives_ok($$ select so_t.edit('251225-28103', '{"whDue":1769472000000,"items":[{"fgCode":"FG-S1","qty":9,"colorSet":"","note":""},{"fgCode":"FG-S2-Y","qty":2,"colorSet":"Y","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales edits the started order directly: more of one product, a new product and a later warehouse date');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'revision') || '/' || (so_t.order_row('251225-28103') -> 'items' -> 0 ->> 'qty')
          || '/' || jsonb_array_length(so_t.order_row('251225-28103') -> 'items') || '/' || (so_t.order_row('251225-28103') ->> 'whDue'),
  'in_progress/2/9/2/1769472000000', 'the order changes in place: status and revision stay');
select ok((select (j ->> 'qtyPlanned')::numeric = 5 and j ->> 'status' = 'in_progress' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-8-SA3C')
          and (select count(*) from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251225-28103') = 1,
  'the department jobs are not changed (planning adjusts them itself)');
select is(so_t.notice('251225-28103', 'change') ->> 'reason', 'กำหนดส่งคลัง 26/01/2026 → 27/01/2026 · FG-S1 7 → 9 · เพิ่ม FG-S2-Y × 2',
  'planning gets a notice "sales edited the order" with the old and new values');
select is(so_t.notice('251225-28103', 'change') ->> 'status' || '/' || (so_t.notice('251225-28103', 'change') ->> 'requestedBy'),
  'open/' || current_setting('test.n_sbx_sa_staff'), 'the notice is open with who edited');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28103', '{"note":"ฝ่ายวางแผนแก้เอง"}'::jsonb, 'updateOrderHeader') $$, 'BOM_INVALID_TRANSITION',
  'planning still cannot edit a started order (it adjusts the jobs instead)');
select throws_ok($$ select so_t.decide('251225-28103', 'change', 'continue') $$, 'BOM_INVALID_REQUEST', 'an edit notice is only acknowledged');
select lives_ok($$ select so_t.decide('251225-28103', 'change', 'ack') $$, 'planning acknowledges the edit');
select is(so_t.notice('251225-28103', 'change') ->> 'status' || '/' || (so_t.notice('251225-28103', 'change') ->> 'decision'), 'done/ack', 'the edit notice is done');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28103', '{"note":"ลูกค้าขอแพ็กใหม่"}'::jsonb, 'updateOrderHeader') $$, 'sales edits the note of the started order');
select is(so_t.notice('251225-28103', 'change') ->> 'reason' || '/' || (so_t.notice('251225-28103', 'change') ->> 'status'), 'แก้หมายเหตุ/open',
  'every edit is its own notice');

-- 8b. เริ่มงานแล้ว: ฝ่ายขายยกเลิกกลางทาง → ไม่รับงานใหม่ · ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH --------------------------------------------------
select throws_ok($$ select so_t.edit('251225-28103', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_TRANSITION',
  'sales cannot cancel a started order outright');
select throws_ok($$ select so_t.edit('251225-28103', '{"salesCancelReason":"ab"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_ORDER',
  'a mid-way cancel needs a reason of three characters');
select throws_ok($$ select so_t.edit('251225-28103', '{"salesCancelReason":"ลูกค้ายกเลิก","note":"พร้อมแก้"}'::jsonb, 'cancelOrder') $$, 'BOM_INVALID_TRANSITION',
  'a mid-way cancel changes nothing else');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28103', '{"salesCancelReason":"ฝ่ายวางแผนยกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN',
  'planning does not cancel mid-way for sales (it cancels outright)');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28103', '{"salesCancelReason":"ลูกค้ายกเลิกคำสั่งซื้อกลางทาง","salesCancelAt":1,"salesCancelChoice":"continue"}'::jsonb, 'cancelOrder') $$,
  'sales cancels the started order mid-way');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'salesCancelReason') || '/' || (so_t.order_row('251225-28103') ->> 'salesCancelBy'),
  'in_progress/ลูกค้ายกเลิกคำสั่งซื้อกลางทาง/' || current_setting('test.n_sbx_sa_staff'), 'the order keeps its status and records who cancelled and why');
select ok((so_t.order_row('251225-28103') ->> 'salesCancelAt')::bigint > 1 and so_t.order_row('251225-28103') -> 'salesCancelChoice' = 'null'::jsonb,
  'the server stamps the time and waits for planning (the client choice is ignored)');
select is(so_t.notice('251225-28103', 'cancel') ->> 'status' || '/' || (so_t.notice('251225-28103', 'cancel') ->> 'reason'), 'open/ลูกค้ายกเลิกคำสั่งซื้อกลางทาง',
  'planning gets the notice "sales cancelled the order mid-way"');
select throws_ok($$ select so_t.edit('251225-28103', '{"note":"แก้หลังยกเลิก"}'::jsonb, 'updateOrderHeader') $$, 'BOM_INVALID_TRANSITION',
  'sales cannot edit an order it cancelled');
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'continue') $$, 'BOM_FORBIDDEN', 'sales cannot choose for planning');
-- ใบหยุดรับงานใหม่: SR จ่ายยางเส้นยาว · GR ขอเบิกยางเส้นยาว · คลังสินค้าส่งมอบ
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select throws_ok($$ select so_t.save(jsonb_build_object('rodMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'id', so_t.uid(30), 'kind', 'issue', 'lotId', so_t.uid(31), 'ownerOrderId', null, 'forOrderId', '251225-28103', 'itemCode', 'RB-S1', 'qty', -1)))), 'issueRods') $$,
  'BOM_INVALID_TRANSITION', 'SR cannot issue long rods to the order while planning decides');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select so_t.save(jsonb_build_object('rodRequests', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'id', so_t.uid(32), 'jobId', 'JOB-8-SA3C', 'itemCode', 'RB-S1', 'qty', 1, 'note', '')))), 'requestRods') $$,
  'BOM_INVALID_TRANSITION', 'GR cannot ask for long rods for the order');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select so_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'orderId', '251225-28103', 'kind', 'deliver', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-S1', 'qty', 1)), 'note', '')))), 'deliverFg') $$,
  'BOM_INVALID_TRANSITION', 'the warehouse cannot deliver to the customer who cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'continue') $$, 'BOM_FORBIDDEN', 'a production head cannot choose either');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'ack') $$, 'BOM_INVALID_REQUEST', 'a mid-way cancel needs a choice, not only an acknowledgement');
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'stop') $$, 'BOM_INVALID_TRANSITION', 'stop needs the cancellation of the order in the same call');
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'stop',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28103') || '{"status":"cancelled","cancelReason":"เหตุผลอื่น"}'::jsonb)))) $$,
  'BOM_INVALID_TRANSITION', 'with the reason sales gave');
select is(so_t.order_row('251225-28103') ->> 'status', 'in_progress', 'the refused stop cancelled nothing');
select lives_ok($$ select so_t.decide('251225-28103', 'cancel', 'continue') $$, 'planning chooses to produce to the end and send to WH');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'salesCancelChoice'), 'in_progress/continue',
  'the order runs on with the choice recorded');
select is(so_t.notice('251225-28103', 'cancel') ->> 'status' || '/' || (so_t.notice('251225-28103', 'cancel') ->> 'decision') || '/'
          || (so_t.notice('251225-28103', 'cancel') ->> 'decidedBy'),
  'done/continue/' || current_setting('test.n_sbx_pp_staff'), 'the notice records the choice and who made it');
select throws_ok($$ select so_t.decide('251225-28103', 'cancel', 'stop') $$, 'BOM_INVALID_TRANSITION', 'the choice is made once');
-- ผลิตต่อ: รับงานใหม่ได้อีก (คำขอเบิกถึงกติกาของ GR: งาน PK ไม่ใช่งาน GR) แต่ยังส่งมอบให้ลูกค้าไม่ได้ (ของเป็นสต็อกสินค้าสำเร็จรูป)
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select so_t.save(jsonb_build_object('rodRequests', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'id', so_t.uid(33), 'jobId', 'JOB-8-SA3C', 'itemCode', 'RB-S1', 'qty', 1, 'note', '')))), 'requestRods') $$,
  'BOM_INVALID_GR', 'after the choice the order takes work again (the request now reaches the GR rules)');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select so_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
  'orderId', '251225-28103', 'kind', 'deliver', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-S1', 'qty', 1)), 'note', '')))), 'deliverFg') $$,
  'BOM_INVALID_TRANSITION', 'but the warehouse still cannot deliver to that customer');

-- 8c. ยกเลิกกลางทาง → ฝ่ายวางแผนเลือกหยุด (ยกเลิกใบตามทางเดิมด้วยเหตุผลของฝ่ายขาย) · ฝ่ายวางแผนยกเลิกใบที่รอตัดสินตรง ๆ = หยุดเช่นกัน ------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28106', '{"sentAt":1}'::jsonb), so_t.sa_order('251225-28107', '{"sentAt":1}'::jsonb)), 'createOrder') $$,
  'sales opens and sends two more orders');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28106', 'JOB-8-SA6') $$, 'planning releases the first');
select lives_ok($$ select so_t.release('251225-28107', 'JOB-8-SA7') $$, 'and the second');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select so_t.start('JOB-8-SA6') $$, 'PK starts the first');
select lives_ok($$ select so_t.start('JOB-8-SA7') $$, 'and the second');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28106', '{"salesCancelReason":"ลูกค้าเลิกสั่ง"}'::jsonb, 'cancelOrder') $$, 'sales cancels the first mid-way');
select lives_ok($$ select so_t.edit('251225-28107', '{"items":[{"fgCode":"FG-S1","qty":4,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales lowers the second in place');
select lives_ok($$ select so_t.edit('251225-28107', '{"salesCancelReason":"ลูกค้าปิดกิจการ"}'::jsonb, 'cancelOrder') $$, 'then cancels it mid-way');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.decide('251225-28106', 'cancel', 'stop',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28106') || '{"status":"cancelled","cancelReason":"ลูกค้าเลิกสั่ง"}'::jsonb)))) $$,
  'planning chooses to stop: the order is cancelled with the reason of sales');
select is(so_t.order_row('251225-28106') ->> 'status' || '/' || (so_t.order_row('251225-28106') ->> 'cancelReason') || '/' || (so_t.order_row('251225-28106') ->> 'salesCancelChoice'),
  'cancelled/ลูกค้าเลิกสั่ง/stop', 'cancelled, with the stop choice recorded');
select is(so_t.notice('251225-28106', 'cancel') ->> 'status' || '/' || (so_t.notice('251225-28106', 'cancel') ->> 'decision'), 'done/stop', 'the notice records the stop');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-8-SA6'),
  'the jobs of the cancelled order stay with their reports (heads close what is left)');
select lives_ok($$ select so_t.edit('251225-28107', '{"status":"cancelled","cancelReason":"ฝ่ายวางแผนหยุดเอง"}'::jsonb, 'cancelOrder') $$,
  'planning cancels the second directly instead of through the card');
select is(so_t.order_row('251225-28107') ->> 'status' || '/' || (so_t.order_row('251225-28107') ->> 'salesCancelChoice'), 'cancelled/stop', 'that is a stop as well');
select is(so_t.notice('251225-28107', 'cancel') ->> 'decision' || '/' || (so_t.notice('251225-28107', 'change') ->> 'decision') || '/'
          || (so_t.notice('251225-28107', 'change') ->> 'decidedBy'),
  'stop/ack/' || current_setting('test.n_sbx_pp_staff'), 'its open notices close themselves: the cancel as stop, the edit as acknowledged');
select is(so_t.notice('251225-28107', 'change') ->> 'reason', 'FG-S1 5 → 4', 'the lowered quantity was notified');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28107', '{"note":"แก้หลังยกเลิก"}'::jsonb, 'updateOrderHeader') $$, 'BOM_INVALID_TRANSITION',
  'a cancelled order is not edited');

-- 9. ชุดเรคอร์ด ----------------------------------------------------------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 23::bigint, 'the snapshot has twenty-three lists (orderRequests since 20261226010000)');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 23::bigint, 'and so has the delta');
-- แจ้ง: 28101 ยกเลิก · 28105 ยกเลิก · 28103 แก้ 2 + ยกเลิก · 28106 ยกเลิก · 28107 แก้ + ยกเลิก (คำสั่งที่ถูกปฏิเสธไม่เขียนอะไร)
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orderRequests')), 8, 'the eight notices written above are listed');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r where r ->> 'status' = 'open'), 2,
  'two are still open (the cancelled draft 28105 and the second edit of 28103)');

-- 10. ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ (addJobsForChanges · private.bom_add_change_jobs) -------------------------------------------------
-- คู่ (แผนก, ชิ้นงาน) ใหม่ = งานใหม่ · คู่เดิม = เพิ่มยอดแผนอย่างเดียว · WO ที่ยังวางแผนอยู่เพิ่มยอดตาม · งาน RB ใหม่ได้ WO ของตัวเอง (WO หนึ่งใบต่องาน)
-- ฟังก์ชัน private เรียกได้เฉพาะบทบาทเจ้าของ (บทบาท authenticated เรียกไม่ได้)
reset role;
select ok(array['addJobsForChanges'] <@ private.bom_client_actions() and not (array['addJobsForChanges'] <@ private.bom_sales_actions())
          and not (array['addJobsForChanges'] <@ private.bom_staff_actions()),
  'opening extra jobs is a planning action: not on the sales or staff lists');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p
           where p.oid = 'private.bom_add_change_jobs(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure)
          and not has_function_privilege('authenticated', 'private.bom_add_change_jobs(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)', 'execute')
          and not has_function_privilege('anon', 'private.bom_add_change_jobs(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)', 'execute'),
  'the extra-jobs writer is security definer with an empty search_path and clients cannot call it');
set local role authenticated;
-- ข้อมูลตั้งต้น: วัตถุดิบ สูตร RCS-1 (อนุมัติ) คอมปาวด์ DMS1 เส้นยาง RB-S8 / RB-S9 ชิ้นยาง SE-S9 สินค้า FG-S9
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"MAT-SO-A","name":"ยาง EPDM","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb,
  '{"code":"MAT-SO-B","name":"เขม่าดำ","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'saveMaterial');
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"RCS-1","revision":1,"productCode":"P-S1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-SO-A","phr":100,"stage":1},{"materialCode":"MAT-SO-B","phr":50,"stage":1}],"status":"draft"}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RCS-1')))),
  (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select so_t.save($json$
{"compounds": {"upsert": [{"code": "DMS1", "name": "EPDM ขาย", "recipeId": "RCS-1", "recipeName": "สูตร S1"}]},
 "items": {"upsert": [
   {"code": "FG-S9", "kind": "FG", "name": "สินค้า S9", "ownerDept": "PK", "uom": "set"},
   {"code": "SE-S9", "kind": "SE", "name": "ชิ้นยาง S9", "ownerDept": "GR", "uom": "pcs"},
   {"code": "DMS1", "kind": "CP", "name": "EPDM ขาย", "ownerDept": "RB", "uom": "kg"},
   {"code": "RB-S6", "kind": "RB", "name": "เส้นยาง S6", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMS1", "kgPerRoll": 2}},
   {"code": "RB-S7", "kind": "RB", "name": "เส้นยาง S7", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMS1", "kgPerRoll": 2}},
   {"code": "RB-S8", "kind": "RB", "name": "เส้นยาง S8", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMS1", "kgPerRoll": 2}},
   {"code": "RB-S9", "kind": "RB", "name": "เส้นยาง S9", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DMS1", "kgPerRoll": 2}}]}}
$json$::jsonb, 'importFlat');
-- ตัวช่วย: งานตามเลข · แถวงานสำหรับปล่อยผลิต / งานใหม่ · คำสั่งเปิดงานเพิ่ม (แถวใบปัจจุบัน + ผลระเบิดใหม่ + งาน)
create function so_t.job(p_id text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_id
$$;
create function so_t.new_job(p_id text, p_order text, p_dept text, p_code text, p_kind text, p_qty numeric) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', p_id, 'orderId', p_order, 'dept', p_dept, 'itemCode', p_code, 'name', 'งาน ' || p_code, 'kind', p_kind, 'uom', 'pcs',
    'qtyPlanned', p_qty, 'qtyRequired', p_qty, 'stockCounted', null, 'qtyDone', 0, 'qtyReject', 0, 'dueAt', 1769212800000, 'status', 'queued',
    'externalRef', null, 'fgCodes', jsonb_build_array('FG-S9'), 'reports', '[]'::jsonb)
$$;
create function so_t.add(p_order text, p_jobs jsonb, p_order_extra jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row(p_order) || jsonb_build_object('explosion',
      jsonb_build_array(jsonb_build_object('itemCode', 'FG-S9', 'fgCode', 'FG-S9', 'kind', 'FG', 'level', 0, 'fgQty', 7, 'required', 7))) || p_order_extra)),
    'jobs', jsonb_build_object('upsert', p_jobs)), 'addJobsForChanges')
$$;
-- ใบของฝ่ายวางแผน 251225-28301: ปล่อยผลิตพร้อมงาน PK (FG-S9 × 5) งาน RB (RB-S9 × 10 · ได้ WO อัตโนมัติ) และงาน RB อีกสองงาน (RB-S6 / RB-S7) แล้ว PK เริ่มงาน
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28301', '{"items":[{"fgCode":"FG-S9","qty":5,"colorSet":"","note":""}]}'::jsonb)), 'createOrder') $$,
  'planning opens an order of FG-S9');
select lives_ok($$ select so_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28301') || jsonb_build_object('status', 'released',
      'explosion', jsonb_build_array(jsonb_build_object('itemCode', 'FG-S9', 'fgCode', 'FG-S9', 'kind', 'FG', 'level', 0, 'fgQty', 5, 'required', 5))))),
    'jobs', jsonb_build_object('upsert', jsonb_build_array(
      so_t.new_job('JOB-8-X1', '251225-28301', 'PK', 'FG-S9', 'FG', 5), so_t.new_job('JOB-8-X2', '251225-28301', 'RB', 'RB-S9', 'RB', 10),
      so_t.new_job('JOB-8-X6', '251225-28301', 'RB', 'RB-S6', 'RB', 3), so_t.new_job('JOB-8-X7', '251225-28301', 'RB', 'RB-S7', 'RB', 3)))), 'releaseOrder') $$,
  'and releases it');
select ok(so_t.job('JOB-8-X2') -> 'externalRef' ->> 'woId' is not null, 'the RB job got its work order at release');
select set_config('test.wo_x2', so_t.job('JOB-8-X2') -> 'externalRef' ->> 'woId', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select so_t.start('JOB-8-X1') $$, 'PK starts the job: the order is in progress');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
-- งาน RB ของใบที่ไม่มี WO (เหมือน RubberFlow ยกเลิก WO แล้วถอดการผูก): X6 ฝ่ายวางแผนปิดแล้ว · X7 ยังรอคิว · เปิดงานเพิ่มต้องไม่เปิด WO ให้สองงานนี้
reset role;
update public.rf_orders set status = 'cancelled' where is_test and source_job_no in ('JOB-8-X6', 'JOB-8-X7');
update public.bom_jobs set external_ref = null where is_test and job_no in ('JOB-8-X6', 'JOB-8-X7');
set local role authenticated;
select lives_ok($$ select so_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(so_t.job('JOB-8-X6') || jsonb_build_object('status', 'done',
    'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', 'ไม่ทำส่วนนี้แล้ว')))))), 'setJobStatus') $$,
  'planning closes the RB job that lost its work order');
select set_config('test.ver_before', so_t.ver()::text, true);
-- ปฏิเสธ: ผู้ที่ไม่ใช่กลุ่มวางแผนของใบสั่งผลิต
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7}'::jsonb)) $$, 'BOM_FORBIDDEN',
  'sales cannot open extra jobs (coarse gate)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7}'::jsonb)) $$, 'BOM_FORBIDDEN',
  'nor a production head (a BOM planner but not an order planner)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
-- ปฏิเสธ: รูปของคำสั่ง ใบ และงาน
select throws_ok($$ select so_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28301')))), 'addJobsForChanges') $$,
  'BOM_INVALID_PAYLOAD', 'an order row without jobs is refused');
select throws_ok($$ select so_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28301'))),
    'jobs', jsonb_build_object('upsert', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7}'::jsonb)),
    'customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ลูกค้าแถม","country":"TH","orderType":"SA","note":""}'::jsonb))), 'addJobsForChanges') $$,
  'BOM_INVALID_PAYLOAD', 'only the order row and jobs travel with the action');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7}'::jsonb), '{"note":"แก้หมายเหตุ"}'::jsonb) $$,
  'BOM_INVALID_ORDER', 'the order changes only its explosion');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":4}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'a decrease of an existing job is refused');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1'))) $$, 'BOM_INVALID_JOB', 'so is an unchanged plan');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7,"name":"ชื่อใหม่"}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'another field of an existing job is refused');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7,"dueAt":1769299200000}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'including its due date');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":7,"status":"queued"}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'and its status');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.new_job('JOB-8-X9', '251225-28301', 'GR', 'SE-S9', 'SE', 4) || '{"qtyDone":1}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'a new job with a done quantity is refused');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.new_job('JOB-8-X9', '251225-28301', 'GR', 'SE-S9', 'SE', 4) || '{"status":"in_progress"}'::jsonb)) $$, 'BOM_INVALID_JOB',
  'so is a new job that is not queued');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.new_job('JOB-8-X9', '251225-28301', 'PK', 'FG-S9', 'FG', 2))) $$, 'BOM_INVALID_JOB',
  'a second job for a department and item the order already has is refused (raise the existing one)');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.new_job('JOB-8-X9', '251225-28001', 'GR', 'SE-S9', 'SE', 4))) $$, 'BOM_INVALID_JOB',
  'a job of another order is refused');
select is(so_t.ver()::text, current_setting('test.ver_before'), 'none of the refused calls wrote anything');
-- อนุญาต: เพิ่มยอด PK 5 → 7 (งานที่เริ่มแล้ว) · RB 10 → 14 (WO ยังวางแผนอยู่ เพิ่มยอดตาม) · งานใหม่ GR SE-S9 × 4 และ RB RB-S8 × 6 (ได้ WO ของตัวเอง)
select lives_ok($$ select so_t.add('251225-28301', jsonb_build_array(
    so_t.job('JOB-8-X1') || '{"qtyPlanned":7}'::jsonb, so_t.job('JOB-8-X2') || '{"qtyPlanned":14}'::jsonb,
    so_t.new_job('JOB-8-X3', '251225-28301', 'GR', 'SE-S9', 'SE', 4), so_t.new_job('JOB-8-X4', '251225-28301', 'RB', 'RB-S8', 'RB', 6))) $$,
  'planning opens the extra jobs of an order in progress');
select is(so_t.job('JOB-8-X1') ->> 'qtyPlanned' || '/' || (so_t.job('JOB-8-X1') ->> 'qtyDone') || '/' || (so_t.job('JOB-8-X1') ->> 'status'), '7/1/in_progress',
  'the started PK job keeps its work and plans 7');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251225-28301'), 6,
  'four released jobs and two new ones: no second row for a pair');
select is(so_t.job('JOB-8-X3') ->> 'status' || '/' || (so_t.job('JOB-8-X3') ->> 'qtyPlanned') || '/' || coalesce(so_t.job('JOB-8-X3') -> 'externalRef' ->> 'woId', '-'), 'queued/4/-',
  'the new GR job is queued with its plan');
select ok(so_t.job('JOB-8-X4') -> 'externalRef' ->> 'woId' is not null and so_t.job('JOB-8-X4') -> 'externalRef' ->> 'woId' <> current_setting('test.wo_x2'),
  'the new RB job gets its own work order');
select is(so_t.order_row('251225-28301') ->> 'status' || '/' || (so_t.order_row('251225-28301') -> 'explosion' -> 0 ->> 'required'), 'in_progress/7',
  'the order keeps its status and holds the new explosion');
reset role;
select is((select count(*)::integer from public.rf_orders o where o.is_test and o.source_job_no = 'JOB-8-X2'), 1, 'the raised RB job keeps its one work order');
select is((select o.status || '/' || trim_scale(o.target_qty)::text from public.rf_orders o where o.is_test and o.wo_no = current_setting('test.wo_x2')), 'planned/14',
  'and that planned work order now targets 14');
select is((select (j.external_ref ->> 'kg')::numeric = o.target_kg from public.bom_jobs j join public.rf_orders o on o.is_test and o.wo_no = j.external_ref ->> 'woId'
           where j.is_test and j.job_no = 'JOB-8-X2'), true, 'the job carries the new kilograms of its work order');
select is((select count(*)::integer from public.rf_orders o where o.is_test and o.source_job_no = 'JOB-8-X4' and o.status = 'planned'), 1, 'one planned work order for the new RB job');
select is((select count(*)::integer from public.rf_orders o where o.is_test and o.source_job_no in ('JOB-8-X6', 'JOB-8-X7') and o.status <> 'cancelled'), 0,
  'no work order for the other RB jobs of the order without one (the closed X6 and the queued X7): only the jobs this call created');
select ok((select bool_and(j.external_ref is null) from public.bom_jobs j where j.is_test and j.job_no in ('JOB-8-X6', 'JOB-8-X7')), 'and they stay unlinked');
select ok(exists (select 1 from public.audit_logs a where a.action = 'RF_SAVE' and a.metadata ->> 'client_action' = 'bom:addJobsForChanges' and (a.metadata ->> 'is_test')::boolean),
  'RubberFlow records the work orders opened and raised by the extra jobs');
select ok(exists (select 1 from public.audit_logs a where a.action = 'BOM_MASTER_SAVE' and a.metadata ->> 'client_action' = 'addJobsForChanges'
                  and (a.metadata -> 'counts' -> 'jobs' ->> 'upsert')::integer = 4 and (a.metadata ->> 'is_test')::boolean),
  'the save is audited with its four job rows');
set local role authenticated;
-- งานที่ปิดแล้ว: ฝ่ายวางแผนปิดงาน GR พร้อมเหตุผล แล้วเพิ่มยอดไม่ได้ · WO ที่เลยวางแผนแล้วเพิ่มยอดไม่ได้
select lives_ok($$ select so_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(so_t.job('JOB-8-X3') || jsonb_build_object('status', 'done',
    'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', 'ปิดงานส่วนนี้')))))), 'setJobStatus') $$,
  'planning closes the GR job with a reason');
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X3') || '{"qtyPlanned":6}'::jsonb)) $$, 'BOM_INVALID_TRANSITION',
  'a closed job is not raised (open a new order for the extra part)');
reset role;
update public.rf_orders set status = 'released' where is_test and wo_no = current_setting('test.wo_x2');
set local role authenticated;
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X2') || '{"qtyPlanned":16}'::jsonb)) $$, 'BOM_INVALID_TRANSITION',
  'nor a job whose work order left planning');
-- ใบที่ไม่อยู่ในสถานะผลิต / ฝ่ายขายยกเลิกไว้
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28302', '{"items":[{"fgCode":"FG-S9","qty":5,"colorSet":"","note":""}]}'::jsonb)), 'createOrder') $$,
  'planning opens a draft');
select throws_ok($$ select so_t.add('251225-28302', jsonb_build_array(so_t.new_job('JOB-8-X5', '251225-28302', 'PK', 'FG-S9', 'FG', 5))) $$, 'BOM_INVALID_TRANSITION',
  'a draft gets jobs only by release');
select throws_ok($$ select so_t.add('251225-28106', jsonb_build_array(so_t.new_job('JOB-8-X6', '251225-28106', 'GR', 'SE-S9', 'SE', 1))) $$, 'BOM_INVALID_TRANSITION',
  'a cancelled order gets no extra jobs');
select throws_ok($$ select so_t.add('251225-28103', jsonb_build_array(so_t.new_job('JOB-8-X7', '251225-28103', 'GR', 'SE-S9', 'SE', 1))) $$, 'BOM_INVALID_TRANSITION',
  'nor an order sales cancelled mid-way (even when planning chose to produce to the end)');
reset role;
update public.bom_orders set status = 'completed' where is_test and pi_no = '251225-28301';
set local role authenticated;
select throws_ok($$ select so_t.add('251225-28301', jsonb_build_array(so_t.job('JOB-8-X1') || '{"qtyPlanned":9}'::jsonb)) $$, 'BOM_INVALID_TRANSITION',
  'nor a completed order');

reset role;
select is((select count(*)::integer from public.bom_order_requests where not is_test), 0, 'test requests never land in the real data');
select ok((select bool_and(o.source = 'SA') from public.bom_orders o where o.is_test and o.pi_no in ('251225-28101', '251225-28102', '251225-28103'))
          and (select bool_and(o.source = 'PP' and o.sent_at is null) from public.bom_orders o where o.is_test and o.pi_no in ('251225-28001', '251225-28203')),
  'the stored sources match who opened each order');

select * from finish();
rollback;
