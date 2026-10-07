-- ฝ่ายโรงงาน: ใบสั่งผลิต ขั้น 1–2 (ฝ่ายขายออก/ส่ง → ฝ่ายวางแผนรับ/สำรวจ/วางแผน/ออกใบสั่งงาน)
-- (20261007030000_factory_production_order_workflow.sql) ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบและผิดแผนก
-- การตรวจค่าทุกช่อง ลำดับสถานะและการกดซ้ำ version เลขที่เอกสารแยกชุดทดสอบ การตรวจ BOM/Routing ตอนวางแผนและออกใบสั่งงาน
-- การส่งกลับ ประวัติ audit การแยกโหมดทดสอบ และการล้างข้อมูล
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select is((select c.relrowsecurity from pg_class c where c.oid = 'public.factory_production_order_history'::regclass), true,
  'the order history has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.factory_production_order_history', p.priv)),
  'anon and authenticated have no direct privilege on the order history');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.factory_production_order_history'::regclass
                  and g.tgname = 'factory_production_order_history_sandbox_scope' and not g.tgisinternal),
  'the order history enforces sandbox scope by trigger');
select ok('factory_production_order_history' = any (private.sandbox_unguarded_tables()) and 'factory_bom_history' = any (private.sandbox_unguarded_tables())
          and 'factory_production_orders' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the order history');

select ok(not has_function_privilege('anon', 'public.app_factory_save_production_order(uuid,integer,uuid,numeric,date,text,text)', 'execute'), 'anon cannot save orders');
select ok(not has_function_privilege('anon', 'public.app_factory_submit_production_order(uuid,integer)', 'execute'), 'anon cannot submit orders');
select ok(not has_function_privilege('anon', 'public.app_factory_withdraw_production_order(uuid,integer)', 'execute'), 'anon cannot withdraw orders');
select ok(not has_function_privilege('anon', 'public.app_factory_receive_production_order(uuid,integer)', 'execute'), 'anon cannot receive orders');
select ok(not has_function_privilege('anon', 'public.app_factory_return_production_order(uuid,integer,text)', 'execute'), 'anon cannot return orders');
select ok(not has_function_privilege('anon', 'public.app_factory_plan_production_order(uuid,integer,uuid,uuid,text)', 'execute'), 'anon cannot plan orders');
select ok(not has_function_privilege('anon', 'public.app_factory_release_production_order(uuid,integer)', 'execute'), 'anon cannot release orders');
select ok(has_function_privilege('authenticated', 'public.app_factory_release_production_order(uuid,integer)', 'execute'),
  'signed-in users can call the workflow API (it checks mode and department itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_order_actor(text)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_order_lock(uuid,integer)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_order_log(uuid,text,text,public.employees)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_order_snapshot(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.next_factory_doc_number(text)', 'execute'),
  'clients cannot call the order helper functions');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
select is((select count(*) from public.employees where is_test and employee_no in ('SBX-SA-STAFF', 'SBX-PP-STAFF'))::integer, 2, 'the sales and planning personas exist');
select is((select d.code from public.employees e join public.departments d on d.id = e.department_id where e.employee_no = 'SBX-SA-STAFF'), 'SA', 'the sales persona is in department SA');
select is((select d.code from public.employees e join public.departments d on d.id = e.department_id where e.employee_no = 'SBX-PP-STAFF'), 'PP', 'the planning persona is in department PP');
select ok(not exists (select 1 from public.employees where employee_no in ('SBX-SA-STAFF', 'SBX-PP-STAFF') and (is_active or auth_user_id is not null)),
  'the new personas cannot log in');

insert into auth.users (id, email, raw_user_meta_data) values
  ('79000000-0000-0000-0000-000000000001', 'po-admin@test.local', '{}'),
  ('79000000-0000-0000-0000-000000000002', 'po-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('79000000-0000-0000-0000-000000000101', 'PO-ADMIN', 'Po', 'Admin', 'po-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '79000000-0000-0000-0000-000000000001'),
  ('79000000-0000-0000-0000-000000000102', 'PO-STAFF', 'Po', 'Staff', 'po-staff@test.local',
   (select id from public.departments where code = 'SA'), (select id from public.roles where code = 'staff'), '79000000-0000-0000-0000-000000000002');
-- ใบสั่งผลิตจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ: ใช้ตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('79000000-0000-0000-0000-00000000f001', 'REAL-PO-FG', 'สินค้าจริงสำหรับตรวจการแยกโหมด', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_production_orders (id, code, item_id, planned_qty, status, due_date)
values ('79000000-0000-0000-0000-00000000a001', 'REAL-MO-001', '79000000-0000-0000-0000-00000000f001', 5, 'draft', current_date + 5);
select set_config('test.sa', (select id::text from public.employees where employee_no = 'SBX-SA-STAFF'), true);
select set_config('test.pp', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);
select set_config('test.rb', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);
select set_config('test.yy', to_char(now() at time zone 'Asia/Bangkok', 'YY'), true);
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);

create function pg_temp.po(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'id' = $1 $$;
create function pg_temp.ver(text) returns integer language sql stable as $$ select (pg_temp.po($1) ->> 'version')::integer $$;
create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text, text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = $2 $$;
create function pg_temp.bomver(text) returns integer language sql stable as $$
  select (x ->> 'version')::integer from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'id' = $1 $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_production_order(null, null, null, 1, current_date, '', '')$$, 'AUTH_REQUIRED', 'saving needs a session');

select set_config('request.jwt.claims', '{"sub":"79000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_production_order(null, null, null, 1, current_date, '', '')$$, 'FACTORY_TEST_MODE_ONLY',
  'a real sales account cannot issue production orders (real mode is not open)');
select throws_ok($$select public.app_factory_receive_production_order('79000000-0000-0000-0000-00000000a001', 1)$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot receive an order');

select set_config('request.jwt.claims', '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_submit_production_order('79000000-0000-0000-0000-00000000a001', 1)$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot submit orders');
select throws_ok($$select public.app_factory_release_production_order('79000000-0000-0000-0000-00000000a001', 1)$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot release orders');

-- 4. โหมดทดสอบ: เตรียมข้อมูล (Item/BOM/Routing ชุดทดลอง) และอนุมัติ BOM ของ FG-TRY-001 ----------------
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs and routings');
select set_config('test.fg1', pg_temp.item('FG-TRY-001'), true);
select set_config('test.fg2', pg_temp.item('FG-TRY-002'), true);
select set_config('test.wip', pg_temp.item('WIP-TRY-RBP-001'), true);
select set_config('test.box', pg_temp.item('PKG-TRY-BOX-001'), true);
select set_config('test.bom1', pg_temp.bom('FG-TRY-001', 'A'), true);
select set_config('test.bom2', pg_temp.bom('FG-TRY-002', 'A'), true);
select set_config('test.rt1', pg_temp.routing('FG-TRY-001'), true);
select set_config('test.rt2', pg_temp.routing('FG-TRY-002'), true);
select lives_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, current_setting('test.bom1')), 'the sales persona can submit a BOM draft');
select lives_ok(format($$select public.app_factory_decide_bom(%L::uuid, 2, 'approve', 'ผ่าน')$$, current_setting('test.bom1')), 'the admin approves the BOM of FG-TRY-001');

-- 5. ฝ่ายขาย: ตรวจค่าทุกช่อง สร้าง แก้ ส่ง ถอนกลับ --------------------------------------
select throws_ok($$select public.app_factory_save_production_order(null, null, null, 0, current_date, '', '')$$, 'INVALID_PRODUCTION_QTY', 'quantity must be above zero');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 0, %L::date, '', '')$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_QTY', 'a zero quantity is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 'NaN', %L::date, '', '')$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_QTY', 'NaN quantity is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 1000000001, %L::date, '', '')$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_QTY', 'a huge quantity is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 0.00001, %L::date, '', '')$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_QTY', 'a quantity that rounds to zero is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, (now() at time zone 'Asia/Bangkok')::date - 1, '', '')$$, current_setting('test.fg1')), 'INVALID_PRODUCTION_DUE_DATE', 'a due date in the past is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, null, '', '')$$, current_setting('test.fg1')), 'INVALID_PRODUCTION_DUE_DATE', 'a due date is required');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, (now() at time zone 'Asia/Bangkok')::date + 3651, '', '')$$, current_setting('test.fg1')), 'INVALID_PRODUCTION_DUE_DATE', 'a due date beyond ten years is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, %L::date, repeat('c', 201), '')$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_CUSTOMER', 'a long customer is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, %L::date, '', repeat('n', 1001))$$, current_setting('test.fg1'), current_setting('test.due')), 'INVALID_PRODUCTION_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, %L::date, '', '')$$, current_setting('test.wip'), current_setting('test.due')), 'PRODUCTION_ITEM_INVALID', 'only finished goods can be ordered');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, %L::date, '', '')$$, '79000000-0000-0000-0000-00000000f001', current_setting('test.due')), 'PRODUCTION_PRODUCT_NOT_FOUND', 'test mode cannot order a real item');
select throws_ok(format($$select public.app_factory_save_production_order(null, null, %L::uuid, 10, %L::date, '', '')$$, '79000000-0000-0000-0000-00000000dead', current_setting('test.due')), 'PRODUCTION_PRODUCT_NOT_FOUND', 'an unknown item is rejected');

select set_config('test.o1', (public.app_factory_save_production_order(null, null, current_setting('test.fg1')::uuid, 1200.5, current_setting('test.due')::date, '  ลูกค้าทดสอบ  ', ' รีบ ')) ->> 'id', true);
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'draft', 'a new order is a draft');
select is(pg_temp.po(current_setting('test.o1')) ->> 'code', 'TEST-MO-' || current_setting('test.yy') || '-001', 'the first order number uses the test series');
select is(pg_temp.po(current_setting('test.o1')) ->> 'customer', 'ลูกค้าทดสอบ', 'the customer is trimmed');
select is(pg_temp.po(current_setting('test.o1')) ->> 'note', 'รีบ', 'the note is trimmed');
select is((pg_temp.po(current_setting('test.o1')) ->> 'planned_qty')::numeric, 1200.5000::numeric, 'the quantity is stored with four decimals');
select is(pg_temp.po(current_setting('test.o1')) ->> 'bom_id', null, 'a draft has no BOM yet');
select is(pg_temp.po(current_setting('test.o1')) ->> 'version', '1', 'a new order starts at version 1');
select is(pg_temp.po(current_setting('test.o1')) ->> 'created_by_name', 'ทดสอบ พนักงานขาย', 'the creator is the sales persona');

select throws_ok(format($$select public.app_factory_save_production_order(%L::uuid, 7, %L::uuid, 10, %L::date, '', '')$$, current_setting('test.o1'), current_setting('test.fg1'), current_setting('test.due')),
  'PRODUCTION_ORDER_VERSION_CONFLICT', 'a stale version cannot overwrite');
select lives_ok(format($$select public.app_factory_save_production_order(%L::uuid, 1, %L::uuid, 1500, %L::date, 'ลูกค้า ก', '')$$, current_setting('test.o1'), current_setting('test.fg1'), current_setting('test.due')),
  'a draft can be edited');
select is(pg_temp.po(current_setting('test.o1')) ->> 'version', '2', 'each edit increments the version');
select throws_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 2)$$, current_setting('test.o1')), 'PRODUCTION_PLANNING_ONLY', 'sales cannot receive their own order');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 2, %L::uuid, %L::uuid, 'x')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'PRODUCTION_PLANNING_ONLY', 'sales cannot plan');
select throws_ok(format($$select public.app_factory_withdraw_production_order(%L::uuid, 2)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_SUBMITTED', 'a draft cannot be withdrawn');
select throws_ok($$select public.app_factory_submit_production_order('79000000-0000-0000-0000-00000000a001', 1)$$, 'PRODUCTION_ORDER_NOT_FOUND', 'test mode cannot submit a real order');
select throws_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 1)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_VERSION_CONFLICT', 'submitting a stale version is refused');

select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 2)$$, current_setting('test.o1')), 'a draft can be sent to planning');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'submitted', 'the order is now waiting for planning');
select throws_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 3)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_DRAFT', 'a submitted order cannot be submitted twice');
select throws_ok(format($$select public.app_factory_save_production_order(%L::uuid, 3, %L::uuid, 10, %L::date, '', '')$$, current_setting('test.o1'), current_setting('test.fg1'), current_setting('test.due')),
  'PRODUCTION_ORDER_NOT_EDITABLE', 'a submitted order cannot be edited');
select lives_ok(format($$select public.app_factory_withdraw_production_order(%L::uuid, 3)$$, current_setting('test.o1')), 'sales can withdraw before planning receives it');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'draft', 'a withdrawn order is a draft again');
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 4)$$, current_setting('test.o1')), 'the order is sent again');

-- 6. ฝ่ายวางแผน: รับ สำรวจ เลือก BOM/Routing ออกใบสั่งงาน --------------------------------
select public.app_sandbox_enter(current_setting('test.pp')::uuid);
select is(jsonb_array_length(public.app_factory_master_data() -> 'production'), 6, 'the planner sees the five trial orders and the new one');
select throws_ok(format($$select public.app_factory_save_production_order(%L::uuid, 5, %L::uuid, 10, %L::date, '', '')$$, current_setting('test.o1'), current_setting('test.fg1'), current_setting('test.due')), 'PRODUCTION_SALES_ONLY', 'planning cannot edit an order');
select throws_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 5)$$, current_setting('test.o1')), 'PRODUCTION_SALES_ONLY', 'planning cannot submit an order');
select throws_ok(format($$select public.app_factory_withdraw_production_order(%L::uuid, 5)$$, current_setting('test.o1')), 'PRODUCTION_SALES_ONLY', 'planning cannot withdraw an order');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 5, %L::uuid, %L::uuid, 'x')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'PRODUCTION_ORDER_NOT_PLANNING', 'an order must be received before it is planned');
select throws_ok(format($$select public.app_factory_release_production_order(%L::uuid, 5)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_PLANNED', 'an unplanned order cannot be released');
select throws_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 4)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_VERSION_CONFLICT', 'receiving a stale version is refused');
select lives_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 5)$$, current_setting('test.o1')), 'planning receives the order');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'planning', 'the order is being planned');
select is(pg_temp.po(current_setting('test.o1')) ->> 'received_by_name', 'ทดสอบ พนักงานวางแผน', 'the receiver is the planning persona');
select throws_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 6)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_SUBMITTED', 'an order cannot be received twice');

select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, %L::uuid, '   ')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'PRODUCTION_SURVEY_REQUIRED', 'the inventory survey must be recorded');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, %L::uuid, repeat('s', 1001))$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'INVALID_PRODUCTION_NOTE', 'a long survey note is rejected');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, %L::uuid, 'ยางพอ')$$, current_setting('test.o1'), current_setting('test.bom2'), current_setting('test.rt1')), 'PRODUCTION_BOM_INVALID', 'a BOM that is still a draft cannot be used');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, null, %L::uuid, 'ยางพอ')$$, current_setting('test.o1'), current_setting('test.rt1')), 'PRODUCTION_BOM_INVALID', 'a BOM is required');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, %L::uuid, 'ยางพอ')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt2')), 'PRODUCTION_ROUTING_INVALID', 'the routing must belong to the ordered product');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, null, 'ยางพอ')$$, current_setting('test.o1'), current_setting('test.bom1')), 'PRODUCTION_ROUTING_INVALID', 'a routing is required');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'planning', 'failed planning attempts change nothing');
select lives_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 6, %L::uuid, %L::uuid, 'ยางเส้นยาวพอ ตัวเร่งต่ำกว่าขั้นต่ำ ต้องสั่งเพิ่ม')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'planning links the approved BOM and the routing');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'planned', 'the order is planned');
select is(pg_temp.po(current_setting('test.o1')) ->> 'bom_id', current_setting('test.bom1'), 'the BOM is linked');
select is(pg_temp.po(current_setting('test.o1')) ->> 'bom_revision', 'A', 'the BOM revision is shown');
select is(pg_temp.po(current_setting('test.o1')) ->> 'survey_note', 'ยางเส้นยาวพอ ตัวเร่งต่ำกว่าขั้นต่ำ ต้องสั่งเพิ่ม', 'the survey result is kept');
select is(pg_temp.po(current_setting('test.o1')) ->> 'work_order_no', null, 'no work order exists before release');

-- BOM ถูกเลิกใช้หลังวางแผน: ออก Revision B ของ FG-TRY-001 แล้วอนุมัติ (Rev. A เป็น obsolete) ต้องออกใบสั่งงานไม่ได้
select set_config('test.bomb', (public.app_factory_save_bom_draft(null, null, current_setting('test.fg1')::uuid, 12, current_date,
  'Rev. B ทดสอบ', jsonb_build_array(jsonb_build_object('component_id', current_setting('test.box')::uuid, 'quantity', 1, 'scrap_percent', 0)))) ->> 'id', true);
select lives_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, current_setting('test.bomb')), 'Rev. B is submitted');
select lives_ok(format($$select public.app_factory_decide_bom(%L::uuid, 2, 'approve', 'ใช้ Rev. B')$$, current_setting('test.bomb')), 'Rev. B is approved and Rev. A becomes obsolete');
select throws_ok(format($$select public.app_factory_release_production_order(%L::uuid, 7)$$, current_setting('test.o1')), 'PRODUCTION_BOM_INVALID', 'a work order cannot be issued from an obsolete BOM');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 7, %L::uuid, %L::uuid, 'ยางพอ')$$, current_setting('test.o1'), current_setting('test.bom1'), current_setting('test.rt1')), 'PRODUCTION_BOM_INVALID', 'the obsolete BOM cannot be chosen again');
select lives_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 7, %L::uuid, %L::uuid, 'วางแผนใหม่ด้วย Rev. B')$$, current_setting('test.o1'), current_setting('test.bomb'), current_setting('test.rt1')), 'a planned order can be re-planned with the new revision');
select is(pg_temp.po(current_setting('test.o1')) ->> 'bom_revision', 'B', 'the new revision is linked');

select lives_ok(format($$select public.app_factory_release_production_order(%L::uuid, 8)$$, current_setting('test.o1')), 'the work order is issued to production');
select is(pg_temp.po(current_setting('test.o1')) ->> 'status', 'released', 'the order is released');
select is(pg_temp.po(current_setting('test.o1')) ->> 'work_order_no', 'TEST-WO-' || current_setting('test.yy') || '-001', 'the work order number uses the test series');
select is(pg_temp.po(current_setting('test.o1')) ->> 'released_by_name', 'ทดสอบ พนักงานวางแผน', 'the releaser is the planning persona');
select throws_ok(format($$select public.app_factory_release_production_order(%L::uuid, 9)$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_PLANNED', 'a released order cannot be released again');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 9, %L::uuid, %L::uuid, 'x')$$, current_setting('test.o1'), current_setting('test.bomb'), current_setting('test.rt1')), 'PRODUCTION_ORDER_NOT_PLANNING', 'a released order cannot be planned again');
select throws_ok(format($$select public.app_factory_return_production_order(%L::uuid, 9, 'ส่งกลับ')$$, current_setting('test.o1')), 'PRODUCTION_ORDER_NOT_RECEIVABLE', 'a released order cannot be returned');

-- ใบตัวอย่างของชุดทดลอง (planned เดิม ผูก BOM ฉบับร่าง) ออกใบสั่งงานไม่ได้จนกว่า BOM จะอนุมัติ
select set_config('test.seeded', (select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'code' = 'MO-TRY-002'), true);
select throws_ok(format($$select public.app_factory_release_production_order(%L::uuid, 1)$$, current_setting('test.seeded')), 'PRODUCTION_BOM_INVALID', 'a seeded order linked to a draft BOM cannot be released');

-- 7. ส่งกลับให้ฝ่ายขาย ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select set_config('test.o2', (public.app_factory_save_production_order(null, null, current_setting('test.fg2')::uuid, 300, current_setting('test.due')::date, '', '')) ->> 'id', true);
select is(pg_temp.po(current_setting('test.o2')) ->> 'code', 'TEST-MO-' || current_setting('test.yy') || '-002', 'order numbers count up in the test series');
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 1)$$, current_setting('test.o2')), 'the second order is sent');
select public.app_sandbox_enter(current_setting('test.pp')::uuid);
select throws_ok(format($$select public.app_factory_return_production_order(%L::uuid, 2, '   ')$$, current_setting('test.o2')), 'PRODUCTION_RETURN_NOTE_REQUIRED', 'a reason is required to return an order');
select lives_ok(format($$select public.app_factory_return_production_order(%L::uuid, 2, 'จำนวนไม่ตรงกับใบสั่งขาย')$$, current_setting('test.o2')), 'planning returns an order that is waiting');
select is(pg_temp.po(current_setting('test.o2')) ->> 'status', 'draft', 'a returned order is a draft');
select is(pg_temp.po(current_setting('test.o2')) ->> 'return_note', 'จำนวนไม่ตรงกับใบสั่งขาย', 'the reason is shown to sales');
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 3)$$, current_setting('test.o2')), 'sales fixes and sends again');
select is(pg_temp.po(current_setting('test.o2')) ->> 'return_note', '', 'the reason is cleared when sent again');
select public.app_sandbox_enter(current_setting('test.pp')::uuid);
select lives_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 4)$$, current_setting('test.o2')), 'planning receives it');
select throws_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 5, %L::uuid, %L::uuid, 'ยางพอ')$$, current_setting('test.o2'), current_setting('test.bomb'), current_setting('test.rt2')), 'PRODUCTION_BOM_INVALID', 'a BOM of another product cannot be linked');
select lives_ok(format($$select public.app_factory_return_production_order(%L::uuid, 5, 'ขอเลื่อนกำหนดส่ง')$$, current_setting('test.o2')), 'planning can return an order while it is being planned');
select is(pg_temp.po(current_setting('test.o2')) ->> 'status', 'draft', 'the order is a draft again');
select is(pg_temp.po(current_setting('test.o2')) ->> 'received_at', null, 'the receipt is cleared when returned');

-- 8. ประวัติและข้อมูลที่หน้าเว็บอ่าน -------------------------------------------------------
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint)
           from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x
           where x ->> 'order_id' = current_setting('test.o1')),
  'create,update,submit,withdraw,submit,receive,plan,plan,release', 'every step of the first order is in its history');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint)
           from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x
           where x ->> 'order_id' = current_setting('test.o2')),
  'create,submit,return,submit,receive,return', 'the returns are in the second order history');
select is((select x ->> 'note' from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x
           where x ->> 'order_id' = current_setting('test.o2') and x ->> 'action' = 'return' order by (x ->> 'id')::bigint limit 1),
  'จำนวนไม่ตรงกับใบสั่งขาย', 'the return reason is in the history');
select is(pg_temp.po(current_setting('test.o1')) ->> 'item_code', 'FG-TRY-001', 'the order list carries the item code');
select is(pg_temp.po(current_setting('test.o1')) ->> 'created_by_name', 'ทดสอบ พนักงานขาย', 'the order list carries who created it');
select is(jsonb_array_length(public.app_factory_master_data() -> 'production'), 7, 'five trial orders and two new ones');
select public.app_sandbox_exit();
reset role;

-- 9. การแยกโหมดทดสอบ ประวัติ และ audit --------------------------------------------------
select is((select count(*) from public.factory_production_orders where not is_test)::integer, 1, 'only the real order is not test data');
select is((select status || '/' || version from public.factory_production_orders where id = '79000000-0000-0000-0000-00000000a001'), 'draft/1', 'the real order was never touched');
select is((select count(*) from public.factory_production_order_history where not is_test)::integer, 0, 'no real order history is written');
select is((select count(*) from public.factory_production_orders where is_test and created_by is not null)::integer, 2, 'new orders record their creator');
select is((select snapshot ->> 'bom_revision' from public.factory_production_order_history where action = 'release'), 'B', 'the release snapshot keeps the BOM revision');
select is((select snapshot ->> 'work_order_no' from public.factory_production_order_history where action = 'release'), 'TEST-WO-' || current_setting('test.yy') || '-001', 'the release snapshot keeps the work order number');
select is((select count(*) from public.audit_logs where action like 'FACTORY_PRODUCTION_%')::integer,
  (select count(*) from public.factory_production_order_history)::integer, 'every history entry has an audit entry');
select is((select actor_id from public.audit_logs where action = 'FACTORY_PRODUCTION_RELEASE'), '79000000-0000-0000-0000-000000000101'::uuid,
  'the audit log names the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_PRODUCTION_RELEASE'), 'SBX-PP-STAFF', 'the audit log names the persona');
select is((select last_number from public.document_counters where department_code = 'FACTORY-MO-TEST' and year_key = current_setting('test.yy')), 2, 'the test order counter advanced twice');
select is((select last_number from public.document_counters where department_code = 'FACTORY-WO-TEST' and year_key = current_setting('test.yy')), 1, 'the test work order counter advanced once');
select is((select count(*) from public.document_counters where department_code in ('FACTORY-MO', 'FACTORY-WO'))::integer, 0, 'no real counter is created');
select set_config('request.jwt.claims', '', true);
select throws_ok($$insert into public.factory_production_order_history (is_test, order_id, action, version, status_after, snapshot)
                   values (true, '79000000-0000-0000-0000-00000000a001', 'create', 1, 'draft', '{}')$$,
  '23503', null, 'a test history row cannot reference a real order (paired foreign key)');

-- 10. ล้างข้อมูลทดสอบ: ประวัติและตัวนับเลขหายไป เลขเริ่มนับใหม่ ข้อมูลจริงอยู่ครบ -----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"79000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'purge removes the test items, orders and history');
select is(public.app_factory_master_data() -> 'production', '[]'::jsonb, 'no test orders remain');
select is(public.app_factory_master_data() -> 'production_history', '[]'::jsonb, 'no test order history remains');
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set can be loaded again');
select set_config('test.fg1', pg_temp.item('FG-TRY-001'), true);
select set_config('test.o3', (public.app_factory_save_production_order(null, null, current_setting('test.fg1')::uuid, 10, current_setting('test.due')::date, '', '')) ->> 'id', true);
select is(pg_temp.po(current_setting('test.o3')) ->> 'code', 'TEST-MO-' || current_setting('test.yy') || '-001', 'numbering starts again after a purge');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_production_orders where not is_test)::integer, 1, 'purge never touches the real order');
select is((select count(*) from public.document_counters where department_code = 'FACTORY-WO-TEST')::integer, 0, 'the work order counter was reset by the purge');

select * from finish();
rollback;
