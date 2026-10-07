-- ฝ่ายโรงงาน: ขั้น 3 งานสั่งวัตถุดิบ แผนก ST (20261007040000_factory_material_order_workflow.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบและผิดแผนก การตรวจค่าทุกช่อง เงื่อนไขใบสั่งงาน ลำดับสถานะและกดซ้ำ
-- version เลขที่เอกสารแยกชุดทดสอบ การรับของเพิ่มยอดคงคลังจริง (ล็อต/ไม่ล็อต รับซ้ำไม่เพิ่มสอง ครั้ง) การยกเลิก ประวัติ audit การแยกโหมด และการล้างข้อมูล
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select count(*) from pg_class c where c.relname in ('factory_material_orders', 'factory_material_order_lines', 'factory_material_order_history') and c.relrowsecurity) = 3,
  'every material order table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['factory_material_orders', 'factory_material_order_lines', 'factory_material_order_history']) t(name),
                  unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct privilege on the material order tables');
select ok((select count(*) from pg_trigger g where g.tgname in ('factory_material_orders_sandbox_scope', 'factory_material_order_lines_sandbox_scope', 'factory_material_order_history_sandbox_scope') and not g.tgisinternal) = 3,
  'every material order table enforces sandbox scope by trigger');
select ok('factory_material_orders' = any (private.sandbox_unguarded_tables()) and 'factory_material_order_lines' = any (private.sandbox_unguarded_tables())
          and 'factory_material_order_history' = any (private.sandbox_unguarded_tables()) and 'factory_production_order_history' = any (private.sandbox_unguarded_tables())
          and 'factory_items' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the material order tables');
select ok(not has_function_privilege('anon', 'public.app_factory_save_material_order(uuid,integer,uuid,text,date,text,jsonb)', 'execute'), 'anon cannot save material orders');
select ok(not has_function_privilege('anon', 'public.app_factory_place_material_order(uuid,integer)', 'execute'), 'anon cannot place material orders');
select ok(not has_function_privilege('anon', 'public.app_factory_cancel_material_order(uuid,integer,text)', 'execute'), 'anon cannot cancel material orders');
select ok(not has_function_privilege('anon', 'public.app_factory_receive_material_order(uuid,integer)', 'execute'), 'anon cannot receive material orders');
select ok(has_function_privilege('authenticated', 'public.app_factory_receive_material_order(uuid,integer)', 'execute'), 'signed-in users can call the API (it checks mode and department itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_material_lock(uuid,integer)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_material_log(uuid,text,text,public.employees)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_material_snapshot(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_assert_released_order(uuid)', 'execute'),
  'clients cannot call the material helper functions');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
select is((select d.code from public.employees e join public.departments d on d.id = e.department_id where e.employee_no = 'SBX-ST-STAFF'), 'ST', 'the stores persona is in department ST');
select ok(not exists (select 1 from public.employees where employee_no = 'SBX-ST-STAFF' and (is_active or auth_user_id is not null or not is_test)), 'the stores persona cannot log in');

insert into auth.users (id, email, raw_user_meta_data) values
  ('80000000-0000-0000-0000-000000000001', 'mr-admin@test.local', '{}'),
  ('80000000-0000-0000-0000-000000000002', 'mr-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('80000000-0000-0000-0000-000000000101', 'MR-ADMIN', 'Mr', 'Admin', 'mr-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '80000000-0000-0000-0000-000000000001'),
  ('80000000-0000-0000-0000-000000000102', 'MR-STAFF', 'Mr', 'Staff', 'mr-staff@test.local',
   (select id from public.departments where code = 'ST'), (select id from public.roles where code = 'staff'), '80000000-0000-0000-0000-000000000002');
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ): ใบสั่งผลิต + ใบสั่งวัตถุดิบ ใช้ตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('80000000-0000-0000-0000-00000000f001', 'REAL-MR-RM', 'วัตถุดิบจริง', 'RM', 'rubber', 'MNP', 'KG', 'buy'),
       ('80000000-0000-0000-0000-00000000f002', 'REAL-MR-FG', 'สินค้าจริง', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_production_orders (id, code, item_id, planned_qty, status, due_date)
values ('80000000-0000-0000-0000-00000000a001', 'REAL-MO-MR', '80000000-0000-0000-0000-00000000f002', 5, 'draft', current_date + 5);
insert into public.factory_material_orders (id, code, production_order_id, expected_date)
values ('80000000-0000-0000-0000-00000000c001', 'REAL-MR-001', '80000000-0000-0000-0000-00000000a001', current_date + 5);
select set_config('test.sa', (select id::text from public.employees where employee_no = 'SBX-SA-STAFF'), true);
select set_config('test.pp', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);
select set_config('test.st', (select id::text from public.employees where employee_no = 'SBX-ST-STAFF'), true);
select set_config('test.yy', to_char(now() at time zone 'Asia/Bangkok', 'YY'), true);
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);
select set_config('test.past', ((now() at time zone 'Asia/Bangkok')::date - 1)::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.stock(text) returns numeric language sql stable as $$
  select (x ->> 'stock')::numeric from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.mo(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'material_orders') x where x ->> 'id' = $1 $$;
create function pg_temp.ver(text) returns integer language sql stable as $$ select (pg_temp.mo($1) ->> 'version')::integer $$;
create function pg_temp.line(text, numeric) returns jsonb language sql stable as $$
  select jsonb_build_object('item_id', pg_temp.item($1), 'quantity', $2) $$;
create function pg_temp.po(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'id' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_receive_material_order('80000000-0000-0000-0000-00000000c001', 1)$$, 'AUTH_REQUIRED', 'receiving needs a session');
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_receive_material_order('80000000-0000-0000-0000-00000000c001', 1)$$, 'FACTORY_TEST_MODE_ONLY', 'a real stores account cannot receive (real mode is not open)');
select throws_ok($$select public.app_factory_save_material_order(null, null, null, '', current_date, '', '[]')$$, 'FACTORY_TEST_MODE_ONLY', 'a real stores account cannot order materials');
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_place_material_order('80000000-0000-0000-0000-00000000c001', 1)$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot place orders');
select throws_ok($$select public.app_factory_cancel_material_order('80000000-0000-0000-0000-00000000c001', 1, 'x')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot cancel orders');

-- 4. เตรียมใบสั่งผลิตที่ออกใบสั่งงานแล้ว (ขั้น 1–2) ------------------------------------------
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs and routings');
select set_config('test.fg1', pg_temp.item('FG-TRY-001'), true);
select set_config('test.bom1', pg_temp.bom('FG-TRY-001'), true);
select set_config('test.rt1', pg_temp.routing('FG-TRY-001'), true);
select lives_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, current_setting('test.bom1')), 'BOM of FG-TRY-001 is submitted');
select lives_ok(format($$select public.app_factory_decide_bom(%L::uuid, 2, 'approve', 'ผ่าน')$$, current_setting('test.bom1')), 'and approved by the admin');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, current_setting('test.fg1')::uuid, 1200, current_setting('test.due')::date, 'ลูกค้า', '')) ->> 'id', true);
select set_config('test.wo_draft', (public.app_factory_save_production_order(null, null, current_setting('test.fg1')::uuid, 50, current_setting('test.due')::date, '', '')) ->> 'id', true);
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 1)$$, current_setting('test.wo')), 'sales sends the order');
select public.app_sandbox_enter(current_setting('test.pp')::uuid);
select lives_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 2)$$, current_setting('test.wo')), 'planning receives it');
select lives_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 3, %L::uuid, %L::uuid, 'ตัวเร่งไม่พอ ต้องสั่งเพิ่ม')$$, current_setting('test.wo'), current_setting('test.bom1'), current_setting('test.rt1')), 'planning plans it');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(pg_temp.line('RM-TRY-ACC-001', 50)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_STORES_ONLY', 'planning cannot order materials');
select lives_ok(format($$select public.app_factory_release_production_order(%L::uuid, 4)$$, current_setting('test.wo')), 'planning issues the work order');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'released', 'the production order is released');
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(pg_temp.line('RM-TRY-ACC-001', 50)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_STORES_ONLY', 'sales cannot order materials');
select throws_ok(format($$select public.app_factory_place_material_order('80000000-0000-0000-0000-00000000c001', 1)$$), 'MATERIAL_STORES_ONLY', 'sales cannot place orders');

-- 5. แผนก ST: ตรวจค่าทุกช่อง -------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.st')::uuid);
select set_config('test.lines', jsonb_build_array(pg_temp.line('RM-TRY-ACC-001', 50))::text, true);
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', %L::jsonb)$$, current_setting('test.wo_draft'), current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_WORK_ORDER_NOT_RELEASED', 'a draft production order cannot have materials ordered');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', %L::jsonb)$$, '80000000-0000-0000-0000-00000000dead', current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_WORK_ORDER_UNKNOWN', 'an unknown production order is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', %L::jsonb)$$, '80000000-0000-0000-0000-00000000a001', current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_WORK_ORDER_UNKNOWN', 'test mode cannot order for a real production order');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', %L::jsonb)$$, current_setting('test.wo'), current_setting('test.past'), current_setting('test.lines')), 'INVALID_MATERIAL_ORDER_DATE', 'an expected date in the past is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', null, '', %L::jsonb)$$, current_setting('test.wo'), current_setting('test.lines')), 'INVALID_MATERIAL_ORDER_DATE', 'an expected date is required');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, repeat('s', 201), %L::date, '', %L::jsonb)$$, current_setting('test.wo'), current_setting('test.due'), current_setting('test.lines')), 'INVALID_MATERIAL_ORDER_SUPPLIER', 'a long supplier is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, repeat('n', 1001), %L::jsonb)$$, current_setting('test.wo'), current_setting('test.due'), current_setting('test.lines')), 'INVALID_MATERIAL_ORDER_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', 'null'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'lines must be an array');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', '{}'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'an object is not an array of lines');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', '[]'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_ORDER_NO_LINES', 'at least one line is required');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', (select jsonb_agg(pg_temp.line('RM-TRY-ACC-001', 1)) from generate_series(1, 101)))$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'more than 100 lines are rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', '[1]'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'a line must be an object');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', '[{"item_id":"nope","quantity":1}]'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'a bad item id is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', '[{"quantity":1}]'::jsonb)$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_LINES', 'an item id is required');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-ACC-001'), 'quantity', 0)))$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_QTY', 'a zero quantity is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-ACC-001'), 'quantity', 'abc')))$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_QTY', 'a text quantity is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-ACC-001'), 'quantity', 'NaN')))$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_QTY', 'a NaN quantity is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('RM-TRY-ACC-001'), 'quantity', 1000000001)))$$, current_setting('test.wo'), current_setting('test.due')), 'INVALID_MATERIAL_ORDER_QTY', 'a huge quantity is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(pg_temp.line('RM-TRY-ACC-001', 1), pg_temp.line('RM-TRY-ACC-001', 2)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_ORDER_LINE_DUPLICATE', 'the same item twice is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', '80000000-0000-0000-0000-00000000dead', 'quantity', 1)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_ORDER_LINE_UNKNOWN', 'an unknown item is rejected');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', '80000000-0000-0000-0000-00000000f001', 'quantity', 1)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_ORDER_LINE_UNKNOWN', 'test mode cannot order a real item');
select throws_ok(format($$select public.app_factory_save_material_order(null, null, %L::uuid, '', %L::date, '', jsonb_build_array(pg_temp.line('WIP-TRY-RBL-001', 1)))$$, current_setting('test.wo'), current_setting('test.due')), 'MATERIAL_ORDER_LINE_INVALID', 'an item made in-house cannot be ordered');

-- 6. สร้าง แก้ สั่ง รับของ ---------------------------------------------------------------
select set_config('test.m1', (public.app_factory_save_material_order(null, null, current_setting('test.wo')::uuid, '  ผู้ขาย ก  ', current_setting('test.due')::date, ' เร่งด่วน ',
  jsonb_build_array(pg_temp.line('RM-TRY-NR-001', 500.5), pg_temp.line('PKG-TRY-BOX-001', 10)))) ->> 'id', true);
select is(pg_temp.mo(current_setting('test.m1')) ->> 'status', 'draft', 'a new material order is a draft');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'code', 'TEST-MR-' || current_setting('test.yy') || '-001', 'the first number uses the test series');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'supplier', 'ผู้ขาย ก', 'the supplier is trimmed');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'note', 'เร่งด่วน', 'the note is trimmed');
select is(jsonb_array_length(pg_temp.mo(current_setting('test.m1')) -> 'lines'), 2, 'two lines are stored');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'production_code', pg_temp.po(current_setting('test.wo')) ->> 'code', 'the order points at the production order');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'created_by_name', 'ทดสอบ พนักงาน ST', 'the creator is the stores persona');
select is(pg_temp.mo(current_setting('test.m1')) -> 'lines' -> 0 ->> 'code', 'RM-TRY-NR-001', 'lines keep their order');
select is((pg_temp.mo(current_setting('test.m1')) -> 'lines' -> 0 ->> 'quantity')::numeric, 500.5::numeric, 'a quantity keeps its decimals');

select throws_ok(format($$select public.app_factory_save_material_order(%L::uuid, 9, %L::uuid, '', %L::date, '', %L::jsonb)$$, current_setting('test.m1'), current_setting('test.wo'), current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_ORDER_VERSION_CONFLICT', 'a stale version cannot overwrite');
select throws_ok(format($$select public.app_factory_save_material_order(%L::uuid, 1, %L::uuid, '', %L::date, '', %L::jsonb)$$, '80000000-0000-0000-0000-00000000c001', current_setting('test.wo'), current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_ORDER_NOT_FOUND', 'test mode cannot edit a real material order');
select lives_ok(format($$select public.app_factory_save_material_order(%L::uuid, 1, %L::uuid, 'ผู้ขาย ข', %L::date, '', jsonb_build_array(pg_temp.line('RM-TRY-NR-001', 600), pg_temp.line('PKG-TRY-BOX-001', 10), pg_temp.line('RM-TRY-ACC-001', 50)))$$, current_setting('test.m1'), current_setting('test.wo'), current_setting('test.due')), 'a draft can be edited and its lines replaced');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'version', '2', 'each edit increments the version');
select is(jsonb_array_length(pg_temp.mo(current_setting('test.m1')) -> 'lines'), 3, 'the lines were replaced');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'supplier', 'ผู้ขาย ข', 'the header was updated');
select throws_ok(format($$select public.app_factory_receive_material_order(%L::uuid, 2)$$, current_setting('test.m1')), 'MATERIAL_ORDER_NOT_ORDERED', 'a draft cannot be received');
select throws_ok(format($$select public.app_factory_place_material_order(%L::uuid, 1)$$, current_setting('test.m1')), 'MATERIAL_ORDER_VERSION_CONFLICT', 'placing a stale version is refused');

select is(pg_temp.stock('RM-TRY-NR-001'), 1500::numeric, 'the opening rubber stock is 1,500');
select lives_ok(format($$select public.app_factory_place_material_order(%L::uuid, 2)$$, current_setting('test.m1')), 'the order is placed with the supplier');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'status', 'ordered', 'the order is now ordered');
select is(pg_temp.stock('RM-TRY-NR-001'), 1500::numeric, 'ordering alone does not change stock');
select throws_ok(format($$select public.app_factory_place_material_order(%L::uuid, 3)$$, current_setting('test.m1')), 'MATERIAL_ORDER_NOT_DRAFT', 'an ordered order cannot be placed twice');
select throws_ok(format($$select public.app_factory_save_material_order(%L::uuid, 3, %L::uuid, '', %L::date, '', %L::jsonb)$$, current_setting('test.m1'), current_setting('test.wo'), current_setting('test.due'), current_setting('test.lines')), 'MATERIAL_ORDER_NOT_EDITABLE', 'an ordered order cannot be edited');

select lives_ok(format($$select public.app_factory_receive_material_order(%L::uuid, 3)$$, current_setting('test.m1')), 'the goods are received');
select is(pg_temp.mo(current_setting('test.m1')) ->> 'status', 'received', 'the order is received');
select is(pg_temp.stock('RM-TRY-NR-001'), 2100::numeric, 'received rubber is added to the stock');
select is(pg_temp.stock('PKG-TRY-BOX-001'), 410::numeric, 'received boxes are added to the stock');
select is(pg_temp.stock('RM-TRY-ACC-001'), 58::numeric, 'the accelerator is now above its minimum stock');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'inventory') x
           where x ->> 'code' = 'RM-TRY-NR-001' and x ->> 'lot_number' = 'TEST-MR-' || current_setting('test.yy') || '-001-1')::integer, 1, 'a lot-tracked item gets a lot named after the order and line');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'inventory') x
           where x ->> 'code' = 'PKG-TRY-BOX-001' and x ->> 'lot_number' is not null)::integer, 0, 'an item without lot tracking gets no lot');
select throws_ok(format($$select public.app_factory_receive_material_order(%L::uuid, 4)$$, current_setting('test.m1')), 'MATERIAL_ORDER_NOT_ORDERED', 'received goods cannot be received twice');
select is(pg_temp.stock('RM-TRY-NR-001'), 2100::numeric, 'a refused second receipt does not add stock again');
select throws_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 4, 'ผิด')$$, current_setting('test.m1')), 'MATERIAL_ORDER_NOT_CANCELLABLE', 'a received order cannot be cancelled');

-- 7. ยกเลิก และ Item ที่เปลี่ยนไปหลังบันทึกฉบับร่าง -------------------------------------------
select set_config('test.m2', (public.app_factory_save_material_order(null, null, current_setting('test.wo')::uuid, '', current_setting('test.due')::date, '', jsonb_build_array(pg_temp.line('RM-TRY-CB-001', 40)))) ->> 'id', true);
select is(pg_temp.mo(current_setting('test.m2')) ->> 'code', 'TEST-MR-' || current_setting('test.yy') || '-002', 'numbers count up in the test series');
select lives_ok(format($$select public.app_factory_place_material_order(%L::uuid, 1)$$, current_setting('test.m2')), 'the second order is placed');
select throws_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 2, '   ')$$, current_setting('test.m2')), 'MATERIAL_CANCEL_NOTE_REQUIRED', 'a reason is required to cancel');
select throws_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 2, repeat('n', 1001))$$, current_setting('test.m2')), 'INVALID_MATERIAL_ORDER_NOTE', 'a long reason is rejected');
select lives_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 2, 'ผู้ขายยกเลิกการผลิต')$$, current_setting('test.m2')), 'an ordered order can be cancelled with a reason');
select is(pg_temp.mo(current_setting('test.m2')) ->> 'status', 'cancelled', 'the order is cancelled');
select is(pg_temp.mo(current_setting('test.m2')) ->> 'cancel_note', 'ผู้ขายยกเลิกการผลิต', 'the reason is kept');
select is(pg_temp.stock('RM-TRY-CB-001'), 420::numeric, 'a cancelled order never changes stock');
select throws_ok(format($$select public.app_factory_receive_material_order(%L::uuid, 3)$$, current_setting('test.m2')), 'MATERIAL_ORDER_NOT_ORDERED', 'a cancelled order cannot be received');
select throws_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 3, 'อีกครั้ง')$$, current_setting('test.m2')), 'MATERIAL_ORDER_NOT_CANCELLABLE', 'a cancelled order cannot be cancelled again');
select set_config('test.m3', (public.app_factory_save_material_order(null, null, current_setting('test.wo')::uuid, '', current_setting('test.due')::date, '', jsonb_build_array(pg_temp.line('RM-TRY-CB-001', 5)))) ->> 'id', true);
select lives_ok(format($$select public.app_factory_cancel_material_order(%L::uuid, 1, 'ไม่ต้องใช้แล้ว')$$, current_setting('test.m3')), 'a draft can be cancelled too');

select set_config('test.temp_item', (public.app_factory_save_item(null, null, 'TEST-MR-TEMP', 'วัตถุดิบชั่วคราว', '', 'RM', 'chemical', 'MNP', 'KG', 'buy', 'active', false, 0, '')) ->> 'id', true);
select set_config('test.m4', (public.app_factory_save_material_order(null, null, current_setting('test.wo')::uuid, '', current_setting('test.due')::date, '',
  jsonb_build_array(jsonb_build_object('item_id', current_setting('test.temp_item')::uuid, 'quantity', 3)))) ->> 'id', true);
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'TEST-MR-TEMP', 'วัตถุดิบชั่วคราว', '', 'RM', 'chemical', 'MNP', 'KG', 'buy', 'inactive', false, 0, '')$$, current_setting('test.temp_item')), 'the item is retired after the draft was saved');
select throws_ok(format($$select public.app_factory_save_material_order(%L::uuid, 1, %L::uuid, '', %L::date, '', jsonb_build_array(jsonb_build_object('item_id', %L::uuid, 'quantity', 3)))$$, current_setting('test.m4'), current_setting('test.wo'), current_setting('test.due'), current_setting('test.temp_item')), 'MATERIAL_ORDER_LINE_INVALID', 'a retired item cannot be saved on a draft');
select throws_ok(format($$select public.app_factory_place_material_order(%L::uuid, 1)$$, current_setting('test.m4')), 'MATERIAL_ORDER_LINE_INVALID', 'a draft with a retired item cannot be placed');

-- 8. ข้อมูลที่หน้าเว็บอ่าน ----------------------------------------------------------------
select is(jsonb_array_length(public.app_factory_master_data() -> 'material_orders'), 4, 'four test material orders are listed');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'material_history') x
           where x ->> 'order_id' = current_setting('test.m1')), 'create,update,place,receive', 'every step of the first order is in its history');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'material_history') x
           where x ->> 'order_id' = current_setting('test.m2')), 'create,place,cancel', 'the cancelled order history shows the cancel');
select is((select x ->> 'note' from jsonb_array_elements(public.app_factory_master_data() -> 'material_history') x
           where x ->> 'order_id' = current_setting('test.m2') and x ->> 'action' = 'cancel'), 'ผู้ขายยกเลิกการผลิต', 'the cancel reason is in the history');
select public.app_sandbox_exit();
select throws_ok(format($$select public.app_factory_receive_material_order(%L::uuid, 4)$$, current_setting('test.m1')), 'FACTORY_TEST_MODE_ONLY', 'leaving test mode closes the module again');
reset role;

-- 9. การแยกโหมดทดสอบ ประวัติ และ audit --------------------------------------------------
select is((select count(*) from public.factory_material_orders where not is_test)::integer, 1, 'only the real material order is not test data');
select is((select status || '/' || version from public.factory_material_orders where id = '80000000-0000-0000-0000-00000000c001'), 'draft/1', 'the real material order was never touched');
select is((select count(*) from public.factory_material_order_history where not is_test)::integer, 0, 'no real history is written');
select is((select count(*) from public.factory_material_order_lines where not is_test)::integer, 0, 'no real lines are written');
select is((select count(*) from public.factory_inventory_movements where not is_test)::integer, 0, 'receiving never writes a real stock movement');
select is((select count(*) from public.factory_inventory_movements where is_test and kind = 'receipt' and production_order_id = current_setting('test.wo')::uuid)::integer, 3, 'the three received lines are receipts linked to the production order');
select is((select count(*) from public.factory_inventory_movements where is_test and kind = 'receipt' and reference = 'รับตามใบสั่งวัตถุดิบ TEST-MR-' || current_setting('test.yy') || '-001')::integer, 3, 'receipts name the material order');
select is((select count(*) from public.factory_lots where is_test and lot_number like 'TEST-MR-%')::integer, 2, 'two lot-tracked lines created two lots');
select is((select count(*) from public.factory_warehouses where is_test and code = 'RM')::integer, 1, 'the RM warehouse exists once');
select is((select count(*) from public.audit_logs where action like 'FACTORY_MATERIAL_%')::integer, (select count(*) from public.factory_material_order_history)::integer, 'every history entry has an audit entry');
select is((select actor_id from public.audit_logs where action = 'FACTORY_MATERIAL_RECEIVE'), '80000000-0000-0000-0000-000000000101'::uuid, 'the audit log names the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_MATERIAL_RECEIVE'), 'SBX-ST-STAFF', 'the audit log names the persona');
select is((select snapshot ->> 'status' from public.factory_material_order_history where action = 'receive'), 'received', 'the receive snapshot keeps the status');
select is(jsonb_array_length((select snapshot -> 'lines' from public.factory_material_order_history where action = 'receive')), 3, 'the receive snapshot keeps the lines');
select is((select last_number from public.document_counters where department_code = 'FACTORY-MR-TEST' and year_key = current_setting('test.yy')), 4, 'the test counter advanced four times');
select is((select count(*) from public.document_counters where department_code = 'FACTORY-MR')::integer, 0, 'no real counter is created');
select set_config('request.jwt.claims', '', true);
select throws_ok($$insert into public.factory_material_order_lines (is_test, order_id, line_no, item_id, quantity)
                   values (true, '80000000-0000-0000-0000-00000000c001', 1, '80000000-0000-0000-0000-00000000f001', 1)$$,
  '23503', null, 'a test line cannot reference a real order (paired foreign key)');

-- 10. ล้างข้อมูลทดสอบ -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"80000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.sa')::uuid);
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'purge removes the test data including the material orders');
select is(public.app_factory_master_data() -> 'material_orders', '[]'::jsonb, 'no material orders remain');
select is(public.app_factory_master_data() -> 'material_history', '[]'::jsonb, 'no material history remains');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_material_orders where not is_test)::integer, 1, 'purge never touches the real material order');
select is((select count(*) from public.document_counters where department_code = 'FACTORY-MR-TEST')::integer, 0, 'the counter was reset by the purge');

select * from finish();
rollback;
