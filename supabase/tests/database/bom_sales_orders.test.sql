-- ใบสั่งผลิตจากฝ่ายขาย (SA) ส่งให้ฝ่ายวางแผน (PP) · คำขอยกเลิก / แก้ใบ · ผู้เขียนใบสั่งผลิตและลูกค้า (โรงงาน ขั้น 8 · 20261225010000_bom_sales_orders.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง (คอลัมน์ ตารางคำขอ ฟังก์ชันใหม่ รายการ action) · นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY
-- · ฝ่ายขายเปิด / แก้ / ส่ง / ยกเลิกร่างของใบฝ่ายขาย · แตะใบของฝ่ายวางแผน ปล่อยผลิต คำนวณ ตั้งกำหนดเสร็จรายแผนก ยอดจากสต็อก ไม่ได้
-- · หลังปล่อยผลิต: ยกเลิกเองไม่ได้ → คำขอ (ซ้ำไม่ได้) · ฝ่ายวางแผนยืนยัน / ไม่ยกเลิก / แก้แล้ว · เปิดใบกลับเมื่อยังไม่มีงานเริ่ม
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
select ok(not exists (select 1 from public.bom_orders where source <> 'PP' or sent_at is not null), 'every order made before the migration is a planning order and not sent');
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
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_order_requests_one_open_idx'),
  'one open request per order and kind is also enforced by an index');
select ok(array['updateOrderHeader', 'sendOrderToPlanning', 'requestOrderCancel', 'requestOrderChange', 'decideOrderRequest'] <@ private.bom_client_actions()
          and array['createOrder', 'saveCustomer', 'sendOrderToPlanning', 'requestOrderCancel', 'requestOrderChange', 'cancelOrder'] <@ private.bom_sales_actions()
          and not (array['releaseOrder'] <@ private.bom_sales_actions()) and not (array['explodeOrder'] <@ private.bom_sales_actions())
          and not (array['decideOrderRequest'] <@ private.bom_sales_actions()) and not (array['setStockCount'] <@ private.bom_sales_actions())
          and not (array['createOrder'] <@ private.bom_staff_actions()),
  'the new actions are on the client list · sales may call order and request actions but not release, explode, decide or count');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_can_sell(public.employees)'::regprocedure, 'private.bom_can_plan_orders(public.employees)'::regprocedure,
                           'private.bom_can_order(public.employees)'::regprocedure,
                           'private.bom_save_order_request(public.employees,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the new and replaced functions are security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('bom_can_sell', 'bom_can_plan_orders', 'bom_can_order', 'bom_sales_actions', 'bom_sa_items_ok', 'bom_save_order_request', 'bom_save_orders')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the new helpers or the writers directly');
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
-- คำขอ (แถวเดียวในส่วน orderRequests) · ส่วนอื่นที่มาพร้อมกัน (ยืนยันยกเลิก = แถวยกเลิกใบ) ส่งใน p_more
create function so_t.req(p_row jsonb, p_action text, p_more jsonb default '{}'::jsonb) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object('orderRequests', jsonb_build_object('upsert', jsonb_build_array(p_row))) || p_more, p_action)
$$;
create function so_t.request(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'orderRequests') r where r ->> 'id' = p_id
$$;
-- ปล่อยผลิต (ฝ่ายวางแผน): ผลระเบิดหนึ่งบรรทัดของ FG-S1 + งาน PK หนึ่งงาน
create function so_t.release(p_no text, p_job text) returns jsonb language sql volatile as $$
  select so_t.save(jsonb_build_object(
    'orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row(p_no) || jsonb_build_object('status', 'released',
      'explosion', jsonb_build_array(jsonb_build_object('itemCode', 'FG-S1', 'kind', 'FG', 'level', 0, 'fgQty', 5, 'required', 5)))))),
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
select throws_ok($$ select public.app_bom_save_master('{"orderRequests":{"upsert":[{}]}}'::jsonb, 0, 'requestOrderCancel') $$, 'BOM_TEST_MODE_ONLY',
  'nor ask to cancel one');
select throws_ok($$ select public.app_bom_save_master('{"orderRequests":{"upsert":[{}]}}'::jsonb, 0, 'decideOrderRequest') $$, 'BOM_TEST_MODE_ONLY',
  'nor decide a request');

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
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(1), 'orderId', '251225-28001', 'reason', 'ลูกค้ายกเลิก'), 'requestOrderCancel') $$, 'BOM_FORBIDDEN',
  'nor ask to cancel an order');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select throws_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28202', '{"due":{"PK":1768000000000}}'::jsonb)), 'createOrder') $$, 'BOM_FORBIDDEN',
  'the PK department manager can no longer open an order');
select throws_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้า PK","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$, 'BOM_FORBIDDEN',
  'nor add a customer');
select throws_ok($$ select so_t.edit('251225-28001', '{"note":"แก้โดยหัวหน้า PK"}'::jsonb, 'updateOrderHeader') $$, 'BOM_FORBIDDEN', 'nor edit an order');
select throws_ok($$ select so_t.edit('251225-28001', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN', 'nor cancel one');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(2), 'decision', 'decline', 'note', 'ไม่ได้'), 'decideOrderRequest') $$, 'BOM_FORBIDDEN',
  'nor decide a sales request');
select lives_ok($$ select so_t.save('{"items":{"upsert":[{"code":"FG-S3","kind":"FG","name":"สินค้า S3 โดยหัวหน้า PK","ownerDept":"PK","uom":"set"}]}}'::jsonb, 'saveItem') $$,
  'but keeps writing master data like the rest of the BOM planner group');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select lives_ok($$ select so_t.orders(jsonb_build_array(so_t.sa_order('251225-28203', '{"customer":"ลูกค้าผู้จัดการ"}'::jsonb)), 'createOrder') $$,
  'an assistant factory manager opens an order');
select is(so_t.order_row('251225-28203') ->> 'source', 'PP', 'with source PP');
select lives_ok($$ select so_t.save('{"customers":{"upsert":[{"name":"ลูกค้าผู้จัดการ","country":"TH","orderType":"SA","note":""}]}}'::jsonb, 'saveCustomer') $$,
  'and adds a customer');

-- 7. ปล่อยผลิตแล้ว: ฝ่ายขายยกเลิกเองไม่ได้ → คำขอ · ฝ่ายวางแผนตัดสิน -------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28101', 'JOB-8-SA1') $$, 'planning releases the sent sales order');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28101', '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb, 'cancelOrder') $$, 'BOM_FORBIDDEN',
  'sales cannot cancel a released order itself');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28101', 'reason', 'ab'), 'requestOrderCancel') $$, 'BOM_INVALID_REQUEST',
  'a request needs a reason of three characters');
select throws_ok($$ select so_t.req(jsonb_build_object('id', 'not-a-uuid', 'orderId', '251225-28101', 'reason', 'ลูกค้ายกเลิก'), 'requestOrderCancel') $$, 'BOM_INVALID_REQUEST',
  'a request id is a uuid');
select throws_ok($$ select so_t.save('{"orderRequests":{"upsert":[]}}'::jsonb, 'requestOrderCancel') $$, 'BOM_INVALID_REQUEST', 'an empty request is refused');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28101', 'reason', 'ลูกค้ายกเลิก'), 'requestOrderCancel',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28101'))))) $$, 'BOM_INVALID_REQUEST',
  'a request cannot carry order rows');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28101', 'reason', 'ลูกค้ายกเลิก'), 'cancelOrder') $$, 'BOM_INVALID_REQUEST',
  'the request section only goes with a request action');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28001', 'reason', 'ลูกค้ายกเลิก'), 'requestOrderCancel') $$, 'BOM_FORBIDDEN',
  'sales cannot ask about an order of planning');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28103', 'reason', 'ลูกค้ายกเลิก'), 'requestOrderCancel') $$, 'BOM_INVALID_TRANSITION',
  'a draft is cancelled directly, not by request');
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28101', 'reason', 'ลูกค้ายกเลิกคำสั่งซื้อ'), 'requestOrderCancel') $$,
  'sales asks planning to cancel the released order');
select is(so_t.request(so_t.uid(10)) ->> 'kind' || '/' || (so_t.request(so_t.uid(10)) ->> 'status') || '/' || (so_t.request(so_t.uid(10)) ->> 'orderId') || '/'
          || (so_t.request(so_t.uid(10)) ->> 'requestedBy'),
  'cancel/open/251225-28101/' || current_setting('test.n_sbx_sa_staff'), 'the request is open with who asked');
select ok(so_t.request(so_t.uid(10)) -> 'decidedBy' = 'null'::jsonb and (so_t.request(so_t.uid(10)) ->> 'requestedAt')::bigint > 0, 'not decided yet');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(11), 'orderId', '251225-28101', 'reason', 'ขอยกเลิกอีกครั้ง'), 'requestOrderCancel') $$, 'BOM_REQUEST_OPEN',
  'a second open cancel request on the same order is refused');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'orderId', '251225-28101', 'reason', 'ขอแก้จำนวน'), 'requestOrderChange') $$, 'BOM_INVALID_REQUEST',
  'a request id cannot be reused');
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(12), 'orderId', '251225-28101', 'reason', 'ขอเพิ่ม FG-S1 เป็น 8 ชุด'), 'requestOrderChange') $$,
  'a change request is a different kind and may be open at the same time');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'confirm', 'note', ''), 'decideOrderRequest') $$, 'BOM_FORBIDDEN',
  'sales cannot decide its own request');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_mgr_t')::uuid);
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(13), 'orderId', '251225-28101', 'reason', 'หัวหน้าขอยกเลิก'), 'requestOrderCancel') $$, 'BOM_REQUEST_OPEN',
  'the sales head sees the same open request (every sales order belongs to sales)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(14), 'orderId', '251225-28101', 'reason', 'ฝ่ายวางแผนขอเอง'), 'requestOrderCancel') $$, 'BOM_FORBIDDEN',
  'planning does not ask, it acts');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(12), 'decision', 'decline', 'note', ''), 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST',
  'declining needs a note');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(12), 'decision', 'confirm', 'note', ''), 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST',
  'a change request is not confirmed as a cancel');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'done', 'note', ''), 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST',
  'a cancel request is not marked done without cancelling');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'maybe', 'note', ''), 'decideOrderRequest') $$, 'BOM_INVALID_REQUEST',
  'an unknown decision is refused');
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(12), 'decision', 'decline', 'note', 'งาน PK เริ่มแล้ว เปิดใบใหม่แทน'), 'decideOrderRequest') $$,
  'planning declines the change request with a note');
select is(so_t.request(so_t.uid(12)) ->> 'status' || '/' || (so_t.request(so_t.uid(12)) ->> 'decidedBy') || '/' || (so_t.request(so_t.uid(12)) ->> 'decisionNote'),
  'declined/' || current_setting('test.n_sbx_pp_staff') || '/งาน PK เริ่มแล้ว เปิดใบใหม่แทน', 'the request records who declined and why');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(12), 'decision', 'decline', 'note', 'ซ้ำ'), 'decideOrderRequest') $$, 'BOM_INVALID_TRANSITION',
  'a decided request cannot be decided again');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'confirm', 'note', ''), 'decideOrderRequest') $$, 'BOM_INVALID_TRANSITION',
  'confirming a cancel needs the order cancelled in the same call');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'confirm', 'note', ''), 'decideOrderRequest',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28101') || '{"status":"cancelled","cancelReason":"เหตุผลอื่น"}'::jsonb)))) $$,
  'BOM_INVALID_TRANSITION', 'with the reason of the request');
select is(so_t.order_row('251225-28101') ->> 'status', 'released', 'the refused confirm cancelled nothing');
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'confirm', 'note', ''), 'decideOrderRequest',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28101') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิกคำสั่งซื้อ"}'::jsonb,
                                                                               so_t.order_row('251225-28001'))))) $$,
  'BOM_INVALID_REQUEST', 'a decision carries at most one order row');
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(10), 'decision', 'confirm', 'note', ''), 'decideOrderRequest',
  jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(so_t.order_row('251225-28101') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิกคำสั่งซื้อ"}'::jsonb)))) $$,
  'planning confirms the cancel request with the cancellation of the order');
select is(so_t.order_row('251225-28101') ->> 'status' || '/' || (so_t.order_row('251225-28101') ->> 'cancelReason'), 'cancelled/ลูกค้ายกเลิกคำสั่งซื้อ',
  'the order is cancelled with the reason sales gave');
select is(so_t.request(so_t.uid(10)) ->> 'status' || '/' || (so_t.request(so_t.uid(10)) ->> 'decidedBy'), 'done/' || current_setting('test.n_sbx_pp_staff'),
  'and the request is done with who confirmed it');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(15), 'orderId', '251225-28101', 'reason', 'ขอแก้หลังยกเลิก'), 'requestOrderChange') $$, 'BOM_INVALID_TRANSITION',
  'nothing is asked about a cancelled order');

-- 8. เปิดใบกลับเป็นร่าง (ยังไม่มีงานเริ่ม) · งานเริ่มแล้วเปิดกลับไม่ได้ → คำขอแก้ใบ -------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28103', 'JOB-8-SA3') $$, 'planning releases the order that was sent on opening');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select lives_ok($$ select so_t.edit('251225-28103', '{"status":"draft","revision":1,"explosion":null,"items":[{"fgCode":"FG-S1","qty":7,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'sales edits the released order while no job started (the order goes back to draft)');
select is(so_t.order_row('251225-28103') ->> 'status' || '/' || (so_t.order_row('251225-28103') ->> 'revision') || '/' || (so_t.order_row('251225-28103') -> 'items' -> 0 ->> 'qty'),
  'draft/1/7', 'the order is a draft again at revision 1 with the new quantity');
select ok(so_t.order_row('251225-28103') ? 'sentAt' and not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '251225-28103'),
  'it stays sent to planning and its jobs are gone');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.release('251225-28103', 'JOB-8-SA3B') $$, 'planning releases it again');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select so_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-8-SA3B')
  || jsonb_build_object('status', 'in_progress', 'qtyDone', 1, 'reports', jsonb_build_array(jsonb_build_object('at', 1, 'by', 'ใครก็ได้', 'good', 1, 'reject', 0, 'note', 'เริ่ม')))))), 'reportJob') $$,
  'PK starts the job');
select public.app_sandbox_enter(current_setting('test.p_sbx_sa_staff')::uuid);
select throws_ok($$ select so_t.edit('251225-28103', '{"status":"draft","revision":2,"explosion":null,"items":[{"fgCode":"FG-S1","qty":8,"colorSet":"","note":""}]}'::jsonb, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'once a job started sales cannot pull the order back');
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(20), 'orderId', '251225-28103', 'reason', 'ขอเพิ่ม FG-S1 เป็น 8 ชุด'), 'requestOrderChange') $$,
  'sales asks for the change instead');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select so_t.req(jsonb_build_object('id', so_t.uid(20), 'decision', 'done', 'note', 'เปิดใบ 251225-28104 เพิ่ม 1 ชุด'), 'decideOrderRequest') $$,
  'planning marks the change request done');
select is(so_t.request(so_t.uid(20)) ->> 'status' || '/' || (so_t.request(so_t.uid(20)) ->> 'decisionNote'), 'done/เปิดใบ 251225-28104 เพิ่ม 1 ชุด', 'with its note');

-- 9. ชุดเรคอร์ด ----------------------------------------------------------------------------------------------------------------------
select is((select count(*) from jsonb_object_keys(public.app_bom_master() - 'version' - 'epoch')), 23::bigint, 'the snapshot has twenty-three lists (orderRequests since 20261225010000)');
select is((select count(*) from jsonb_object_keys(public.app_bom_master_since(0) -> 'changes')), 23::bigint, 'and so has the delta');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orderRequests')), 3, 'the three requests accepted above are listed (refused calls wrote nothing)');
select ok(exists (select 1 from jsonb_array_elements(public.app_bom_master_since(so_t.ver() - 1) -> 'changes' -> 'orderRequests' -> 'upsert') r where r ->> 'id' = so_t.uid(20)),
  'the delta carries the request decided last');

reset role;
select is((select count(*)::integer from public.bom_order_requests where not is_test), 0, 'test requests never land in the real data');
select ok((select bool_and(o.source = 'SA') from public.bom_orders o where o.is_test and o.pi_no in ('251225-28101', '251225-28102', '251225-28103'))
          and (select bool_and(o.source = 'PP' and o.sent_at is null) from public.bom_orders o where o.is_test and o.pi_no in ('251225-28001', '251225-28203')),
  'the stored sources match who opened each order');

select * from finish();
rollback;
