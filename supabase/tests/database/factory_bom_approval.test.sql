-- ฝ่ายโรงงาน: สร้างโครงสร้างสินค้า (BOM) ฉบับร่าง → ส่งขออนุมัติ → admin อนุมัติ/ไม่อนุมัติ
-- (20261007010000_factory_bom_draft_approval.sql) ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบ
-- การตรวจค่าทุกช่อง กฎวงจร/ซ้ำ/อ้างตัวเอง สถานะที่ห้ามแก้ การอนุมัติ/ไม่อนุมัติ/ถอนกลับ การแทนที่ Revision เดิม
-- การแยกโหมดทดสอบ ประวัติ audit และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select is((select c.relrowsecurity from pg_class c where c.oid = 'public.factory_bom_history'::regclass), true,
  'BOM history has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.factory_bom_history', p.priv)),
  'anon and authenticated have no direct privilege on the BOM history');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.factory_bom_history'::regclass
                  and g.tgname = 'factory_bom_history_sandbox_scope' and not g.tgisinternal),
  'BOM history enforces sandbox scope by trigger');
select ok('factory_bom_history' = any (private.sandbox_unguarded_tables()) and 'factory_boms' = any (private.sandbox_unguarded_tables())
          and 'factory_items' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the BOM history');
select ok(exists (select 1 from pg_indexes where indexname = 'factory_boms_one_open_revision')
      and exists (select 1 from pg_indexes where indexname = 'factory_boms_one_approved_revision'),
  'one open and one approved revision per item are enforced by unique indexes');

select ok(not has_function_privilege('anon', 'public.app_factory_save_bom_draft(uuid,integer,uuid,numeric,date,text,jsonb)', 'execute'), 'anon cannot save BOM drafts');
select ok(not has_function_privilege('anon', 'public.app_factory_submit_bom(uuid,integer)', 'execute'), 'anon cannot submit BOMs');
select ok(not has_function_privilege('anon', 'public.app_factory_withdraw_bom(uuid,integer)', 'execute'), 'anon cannot withdraw BOMs');
select ok(not has_function_privilege('anon', 'public.app_factory_decide_bom(uuid,integer,text,text)', 'execute'), 'anon cannot decide BOMs');
select ok(has_function_privilege('authenticated', 'public.app_factory_decide_bom(uuid,integer,text,text)', 'execute'),
  'signed-in users can call the decision API (it checks mode and admin itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_bom_check_graph(boolean,uuid,uuid,uuid[])', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_bom_revalidate(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_bom_snapshot(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_assert_bom_parent(uuid)', 'execute'),
  'clients cannot call the BOM helper functions');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('77000000-0000-0000-0000-000000000001', 'bom-admin@test.local', '{}'),
  ('77000000-0000-0000-0000-000000000002', 'bom-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('77000000-0000-0000-0000-000000000101', 'BOM-ADMIN', 'Bom', 'Admin', 'bom-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '77000000-0000-0000-0000-000000000001'),
  ('77000000-0000-0000-0000-000000000102', 'BOM-STAFF', 'Bom', 'Staff', 'bom-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '77000000-0000-0000-0000-000000000002');
-- แถวข้อมูลจริง (ไม่ใช่โหมดทดสอบ): Item กับ BOM ของมัน ใช้ตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('77000000-0000-0000-0000-00000000f001', 'REAL-FG-01', 'สินค้าจริงสำหรับตรวจการแยกโหมด', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_boms (id, item_id, revision, output_qty, status, effective_date)
values ('77000000-0000-0000-0000-00000000b001', '77000000-0000-0000-0000-00000000f001', 'A', 1, 'draft', date '2026-10-01');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);

create temp table t_ids(k text primary key, v uuid);
grant all on t_ids to authenticated;
create function pg_temp.i(text) returns uuid language sql stable as $$ select v from t_ids where k = $1 $$;
-- บรรทัด BOM หนึ่งบรรทัด: ส่วนประกอบตามรหัส Item ปริมาณ และ % เผื่อสูญเสีย
create function pg_temp.bl(text, numeric, numeric default 0) returns jsonb language sql stable as $$
  select jsonb_build_object('component_id', pg_temp.i($1), 'quantity', $2, 'scrap_percent', $3) $$;
-- ฟิลด์ของ BOM (รหัส Item, Revision) จากข้อมูลที่หน้าเว็บได้รับ
create function pg_temp.bomf(text, text, text) returns text language sql stable as $$
  select x ->> $3 from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x
  where x ->> 'code' = $1 and x ->> 'revision' = $2 $$;
create function pg_temp.remember() returns void language sql as $$
  insert into t_ids select x ->> 'code', (x ->> 'id')::uuid from jsonb_array_elements(public.app_factory_master_data() -> 'items') x
  on conflict (k) do update set v = excluded.v $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_bom_draft(null, null, '77000000-0000-0000-0000-00000000f001', 1, date '2026-10-07', '', '[]')$$,
  'AUTH_REQUIRED', 'saving a BOM draft requires a session');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_bom_draft(null, null, '77000000-0000-0000-0000-00000000f001', 1, date '2026-10-07', '', '[]')$$,
  'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot create a BOM draft');
select throws_ok($$select public.app_factory_submit_bom('77000000-0000-0000-0000-00000000b001', 1)$$,
  'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot submit a BOM');
select throws_ok($$select public.app_factory_withdraw_bom('77000000-0000-0000-0000-00000000b001', 1)$$,
  'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot withdraw a BOM');
select throws_ok($$select public.app_factory_decide_bom('77000000-0000-0000-0000-00000000b001', 1, 'approve', '')$$,
  'FACTORY_TEST_MODE_ONLY', 'a real staff account cannot approve a BOM');

select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_save_bom_draft(null, null, '77000000-0000-0000-0000-00000000f001', 1, date '2026-10-07', '', '[]')$$,
  'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot create a BOM draft (real mode is not open)');
select throws_ok($$select public.app_factory_decide_bom('77000000-0000-0000-0000-00000000b001', 1, 'approve', '')$$,
  'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot approve a BOM');
select throws_ok($$select count(*) from public.factory_bom_history$$, '42501', null, 'clients cannot read the BOM history directly');
select throws_ok($$update public.factory_boms set status = 'approved' where revision = 'A'$$, '42501', null, 'clients cannot approve a BOM by updating the table');
select throws_ok($$insert into public.factory_bom_history (bom_id, action, version, status_after, snapshot)
                    values ('77000000-0000-0000-0000-00000000b001', 'approve', 1, 'approved', '{}')$$, '42501', null, 'clients cannot forge BOM history');

-- 4. โหมดทดสอบ: เตรียม Item ----------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select is(public.app_sandbox_seed_factory() ->> 'seeded', 'true', 'demo data is loaded');
select public.app_factory_save_item(null, null, 'T-FG-SET', 'ชุดทดสอบ', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'make', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-FG-BUY', 'สินค้าซื้อมา', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'buy', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-WIP-OFF', 'งานระหว่างผลิตหยุดใช้', '', 'WIP', 'foam', 'SAFSOF', 'SHEET', 'make', 'inactive', true, 0, '');
select public.app_factory_save_item(null, null, 'T-CYC-A', 'วงจร A', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'make', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-CYC-B', 'วงจร B', '', 'WIP', 'foam', 'SAFSOF', 'SHEET', 'make', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-CYC-C', 'วงจร C', '', 'WIP', 'foam', 'SAFSOF', 'SHEET', 'both', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-X', 'สินค้า X', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'make', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-Y', 'งานระหว่างผลิต Y', '', 'WIP', 'foam', 'SAFSOF', 'SHEET', 'make', 'active', true, 0, '');
select public.app_factory_save_item(null, null, 'T-Z', 'ส่วนประกอบ Z', '', 'RM', 'chemical', 'SAFSOF', 'KG', 'buy', 'active', true, 0, '');
select pg_temp.remember();
select is((select count(*) from t_ids), 25::bigint, 'sixteen demo items and nine test items are known');
select is((public.app_factory_master_data() -> 'bom_history'), '[]'::jsonb, 'seeded BOMs have no history yet');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'status'), 'draft', 'the seeded BOM is a draft');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'version'), '1', 'the seeded BOM starts at version 1');

-- 5. สร้างฉบับร่าง ------------------------------------------------------------------
select set_config('test.set_a', public.app_factory_save_bom_draft(null, null, pg_temp.i('T-FG-SET'), 12, date '2026-10-07', '  ชุดบล็อกโฟม  ',
  jsonb_build_array(pg_temp.bl('WIP-FOAM-001', 12, 2), pg_temp.bl('PKG-BOX-001', 1))) ->> 'id', true);
select is(pg_temp.bomf('T-FG-SET', 'A', 'status'), 'draft', 'a new BOM starts as a draft');
select is(pg_temp.bomf('T-FG-SET', 'A', 'version'), '1', 'drafts start at version 1');
select is(pg_temp.bomf('T-FG-SET', 'A', 'note'), 'ชุดบล็อกโฟม', 'the note is trimmed');
select is(pg_temp.bomf('T-FG-SET', 'A', 'created_by_name'), 'ทดสอบ พนักงาน RB', 'the persona is recorded as the author');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'bom_lines') x where x ->> 'bom_id' = current_setting('test.set_a')),
  2::bigint, 'both lines are stored');
select is((select (x ->> 'scrap_percent')::numeric from jsonb_array_elements(public.app_factory_master_data() -> 'bom_lines') x
           where x ->> 'bom_id' = current_setting('test.set_a') and x ->> 'code' = 'WIP-FOAM-001'), 2::numeric, 'the scrap percentage is stored');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-FG-SET'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_OPEN_REVISION_EXISTS', 'an item cannot have two open revisions');
select is(jsonb_array_length(public.app_factory_master_data() -> 'bom_history'), 1, 'creating a draft writes one history entry');
select is(public.app_factory_master_data() -> 'bom_history' -> 0 ->> 'action', 'create', 'the entry is a create');

-- 6. ตรวจค่าที่รับเข้ามา --------------------------------------------------------------
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('RM-NR-001'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_INVALID', 'a raw material cannot own a BOM');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('PKG-BOX-001'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_INVALID', 'packaging cannot own a BOM');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-FG-BUY'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_INVALID', 'a bought-in item cannot own a BOM');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-WIP-OFF'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_INVALID', 'an inactive item cannot own a BOM');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, '77000000-0000-0000-0000-00000000dead', 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_NOT_FOUND', 'unknown items are rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, '77000000-0000-0000-0000-00000000f001', 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_NOT_FOUND', 'test mode cannot build a BOM on a real item');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, null, 1, date '2026-10-07', '', '[]')$$,
  'BOM_PARENT_NOT_FOUND', 'an item is required');

select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), null, date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'an output quantity is required');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 0, date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'a zero output quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), -5, date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'a negative output quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 0.00001, date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'a quantity that rounds to zero is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 'NaN', date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'NaN output is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 'Infinity', date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'infinite output is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1000000001, date '2026-10-07', '', '[]')$$, 'INVALID_BOM_OUTPUT_QTY', 'a huge output quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, null, '', '[]')$$, 'INVALID_BOM_EFFECTIVE_DATE', 'an effective date is required');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '1999-12-31', '', '[]')$$, 'INVALID_BOM_EFFECTIVE_DATE', 'a date before 2000 is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, 'infinity', '', '[]')$$, 'INVALID_BOM_EFFECTIVE_DATE', 'an infinite date is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', repeat('n', 1001), '[]')$$, 'INVALID_BOM_NOTE', 'a long note is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', null)$$, 'INVALID_BOM_LINES', 'lines are required (an empty array is fine)');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', '{"a":1}')$$, 'INVALID_BOM_LINES', 'lines must be an array');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  (select jsonb_agg(pg_temp.bl('T-Z', 1)) from generate_series(1, 101)))$$, 'INVALID_BOM_LINES', 'more than 100 lines are rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', '[1]')$$, 'INVALID_BOM_LINE', 'a line must be an object');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', '[{"component_id":"nope","quantity":1}]')$$, 'INVALID_BOM_LINE', 'a malformed component id is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', '[{"quantity":1}]')$$, 'INVALID_BOM_LINE', 'a missing component id is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(jsonb_build_object('component_id', pg_temp.i('T-Z'))))$$,
  'INVALID_BOM_LINE_QUANTITY', 'a missing quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 0)))$$, 'INVALID_BOM_LINE_QUANTITY', 'a zero line quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', -1)))$$, 'INVALID_BOM_LINE_QUANTITY', 'a negative line quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 0.00004)))$$, 'INVALID_BOM_LINE_QUANTITY', 'a line quantity that rounds to zero is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', pg_temp.i('T-Z'), 'quantity', 'abc')))$$, 'INVALID_BOM_LINE_QUANTITY', 'a non-numeric line quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', pg_temp.i('T-Z'), 'quantity', 'NaN')))$$, 'INVALID_BOM_LINE_QUANTITY', 'NaN line quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 1000000001)))$$, 'INVALID_BOM_LINE_QUANTITY', 'a huge line quantity is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 1, -1)))$$, 'INVALID_BOM_LINE_SCRAP', 'negative scrap is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 1, 100)))$$, 'INVALID_BOM_LINE_SCRAP', '100% scrap is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', pg_temp.i('T-Z'), 'quantity', 1, 'scrap_percent', 'x')))$$, 'INVALID_BOM_LINE_SCRAP', 'non-numeric scrap is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', pg_temp.i('T-Z'), 'quantity', 1, 'scrap_percent', 'NaN')))$$, 'INVALID_BOM_LINE_SCRAP', 'NaN scrap is rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-X', 1)))$$, 'BOM_SELF_REFERENCE', 'an item cannot be its own component');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 1), pg_temp.bl('T-Z', 2)))$$, 'BOM_DUPLICATE_COMPONENT', 'a component can appear once per BOM');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', '77000000-0000-0000-0000-00000000dead', 'quantity', 1)))$$, 'BOM_COMPONENT_NOT_FOUND', 'unknown components are rejected');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '',
  jsonb_build_array(jsonb_build_object('component_id', '77000000-0000-0000-0000-00000000f001', 'quantity', 1)))$$, 'BOM_COMPONENT_NOT_FOUND', 'a real item cannot be a test component');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('RM-EVA-OLD', 1)))$$, 'BOM_COMPONENT_INACTIVE', 'an inactive component is rejected');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = 'T-X'), 0::bigint,
  'rejected saves leave nothing behind');

-- 7. ห้ามสูตรวนซ้ำ -------------------------------------------------------------------
select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-CYC-A'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-CYC-B', 1)));
select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-CYC-B'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-CYC-C', 1)));
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-CYC-C'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-CYC-A', 1)))$$,
  'BOM_CIRCULAR', 'A -> B -> C -> A is a loop');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-CYC-C'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-CYC-B', 1)))$$,
  'BOM_CIRCULAR', 'B -> C -> B is a loop');
select lives_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-CYC-C'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Z', 1), pg_temp.bl('RM-NR-001', 1)))$$,
  'a chain that ends in raw materials is fine');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 1, pg_temp.i('T-CYC-C'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-CYC-A', 1)))$$,
    pg_temp.bomf('T-CYC-C', 'A', 'id')), 'BOM_CIRCULAR', 'editing a saved draft cannot close a loop either');

-- 8. แก้ไขฉบับร่าง -------------------------------------------------------------------
select lives_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 1, pg_temp.i('T-FG-SET'), 24, date '2026-10-08', 'แก้แล้ว',
    jsonb_build_array(pg_temp.bl('WIP-FOAM-001', 24, 2), pg_temp.bl('PKG-BOX-001', 2), pg_temp.bl('RM-EVA-001', 0.5, 1.5)))$$, current_setting('test.set_a')),
  'the current version of a draft can be edited');
select is(pg_temp.bomf('T-FG-SET', 'A', 'version'), '2', 'each edit increments the version');
select is(pg_temp.bomf('T-FG-SET', 'A', 'output_qty')::numeric, 24::numeric, 'the output quantity was updated');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'bom_lines') x where x ->> 'bom_id' = current_setting('test.set_a')),
  3::bigint, 'the lines were replaced as a set');
select is((select (x ->> 'line_no')::int from jsonb_array_elements(public.app_factory_master_data() -> 'bom_lines') x
           where x ->> 'bom_id' = current_setting('test.set_a') and x ->> 'code' = 'RM-EVA-001'), 3, 'lines are numbered in the order given');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 1, pg_temp.i('T-FG-SET'), 1, date '2026-10-08', '', '[]')$$, current_setting('test.set_a')),
  'BOM_VERSION_CONFLICT', 'a stale version cannot overwrite a newer edit');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 2, pg_temp.i('T-X'), 1, date '2026-10-08', '', '[]')$$, current_setting('test.set_a')),
  'BOM_LOCKED_FIELDS', 'the parent item is locked after creation');
select throws_ok($$select public.app_factory_save_bom_draft('77000000-0000-0000-0000-00000000dead', 1, pg_temp.i('T-X'), 1, date '2026-10-08', '', '[]')$$,
  'BOM_NOT_FOUND', 'unknown BOM ids are rejected');
select throws_ok($$select public.app_factory_save_bom_draft('77000000-0000-0000-0000-00000000b001', 1, pg_temp.i('T-X'), 1, date '2026-10-08', '', '[]')$$,
  'BOM_NOT_FOUND', 'test mode cannot edit a real BOM');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, null, pg_temp.i('T-FG-SET'), 1, date '2026-10-08', '', '[]')$$, current_setting('test.set_a')),
  'BOM_VERSION_CONFLICT', 'the version is required when editing');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 2, pg_temp.i('T-FG-SET'), 24, date '2026-10-08', '', jsonb_build_array(pg_temp.bl('T-FG-SET', 1)))$$, current_setting('test.set_a')),
  'BOM_SELF_REFERENCE', 'editing cannot introduce a self reference');

-- 9. ส่งขออนุมัติและถอนกลับ -----------------------------------------------------------------
select throws_ok($$select public.app_factory_submit_bom('77000000-0000-0000-0000-00000000dead', 1)$$, 'BOM_NOT_FOUND', 'unknown BOMs cannot be submitted');
select throws_ok($$select public.app_factory_submit_bom('77000000-0000-0000-0000-00000000b001', 1)$$, 'BOM_NOT_FOUND', 'test mode cannot submit a real BOM');
select throws_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, current_setting('test.set_a')), 'BOM_VERSION_CONFLICT', 'a stale version cannot be submitted');
select throws_ok(format($$select public.app_factory_submit_bom(%L::uuid, null)$$, current_setting('test.set_a')), 'BOM_VERSION_CONFLICT', 'the version is required to submit');
select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-X'), 1, date '2026-10-07', '', '[]');
select throws_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, pg_temp.bomf('T-X', 'A', 'id')), 'BOM_NO_LINES', 'a BOM with no lines cannot be submitted');

select is(public.app_factory_submit_bom(current_setting('test.set_a')::uuid, 2) ->> 'status', 'pending_approval', 'a draft can be submitted');
select is(pg_temp.bomf('T-FG-SET', 'A', 'version'), '3', 'submitting increments the version');
select is(pg_temp.bomf('T-FG-SET', 'A', 'submitted_by_name'), 'ทดสอบ พนักงาน RB', 'the persona is recorded as the submitter');
select ok(pg_temp.bomf('T-FG-SET', 'A', 'submitted_at') is not null, 'the submission time is recorded');
select throws_ok(format($$select public.app_factory_submit_bom(%L::uuid, 3)$$, current_setting('test.set_a')), 'BOM_NOT_DRAFT', 'a pending BOM cannot be submitted again');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 3, pg_temp.i('T-FG-SET'), 24, date '2026-10-08', '', '[]')$$, current_setting('test.set_a')),
  'BOM_NOT_EDITABLE', 'a pending BOM cannot be edited');
select throws_ok($$select public.app_factory_save_bom_draft(null, null, pg_temp.i('T-FG-SET'), 1, date '2026-10-07', '', '[]')$$,
  'BOM_OPEN_REVISION_EXISTS', 'a pending revision still counts as open');
select throws_ok(format($$select public.app_factory_withdraw_bom(%L::uuid, 2)$$, current_setting('test.set_a')), 'BOM_VERSION_CONFLICT', 'a stale version cannot be withdrawn');
select throws_ok(format($$select public.app_factory_withdraw_bom(%L::uuid, 1)$$, pg_temp.bomf('T-X', 'A', 'id')), 'BOM_NOT_PENDING', 'only pending BOMs can be withdrawn');
select throws_ok($$select public.app_factory_withdraw_bom('77000000-0000-0000-0000-00000000dead', 1)$$, 'BOM_NOT_FOUND', 'unknown BOMs cannot be withdrawn');
select is(public.app_factory_withdraw_bom(current_setting('test.set_a')::uuid, 3) ->> 'status', 'draft', 'a pending BOM can be withdrawn for editing');
select is(pg_temp.bomf('T-FG-SET', 'A', 'version'), '4', 'withdrawing increments the version');
select ok(pg_temp.bomf('T-FG-SET', 'A', 'submitted_at') is null, 'withdrawing clears the submission');
select is(public.app_factory_submit_bom(current_setting('test.set_a')::uuid, 4) ->> 'status', 'pending_approval', 'it can be submitted again');

-- 10. ตัดสิน: ไม่อนุมัติ → แก้ → อนุมัติ ---------------------------------------------------------
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, 'reject', '   ')$$, current_setting('test.set_a')), 'BOM_REJECT_NOTE_REQUIRED', 'a rejection needs a reason');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, 'maybe', 'x')$$, current_setting('test.set_a')), 'INVALID_BOM_DECISION', 'only approve or reject are accepted');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, null, 'x')$$, current_setting('test.set_a')), 'INVALID_BOM_DECISION', 'a decision is required');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, 'approve', repeat('n', 1001))$$, current_setting('test.set_a')), 'INVALID_BOM_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 4, 'approve', '')$$, current_setting('test.set_a')), 'BOM_VERSION_CONFLICT', 'approval is bound to the version the approver saw');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, null, 'approve', '')$$, current_setting('test.set_a')), 'BOM_VERSION_CONFLICT', 'the version is required to decide');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 1, 'approve', '')$$, pg_temp.bomf('T-X', 'A', 'id')), 'BOM_NOT_PENDING', 'a draft cannot be approved');
select throws_ok($$select public.app_factory_decide_bom('77000000-0000-0000-0000-00000000dead', 1, 'approve', '')$$, 'BOM_NOT_FOUND', 'unknown BOMs cannot be decided');
select throws_ok($$select public.app_factory_decide_bom('77000000-0000-0000-0000-00000000b001', 1, 'approve', '')$$, 'BOM_NOT_FOUND', 'test mode cannot approve a real BOM');

select is(public.app_factory_decide_bom(current_setting('test.set_a')::uuid, 5, 'reject', 'จำนวนกล่องไม่ตรงกับแบบ') ->> 'status', 'draft', 'a rejected BOM returns to draft');
select is(pg_temp.bomf('T-FG-SET', 'A', 'decision_note'), 'จำนวนกล่องไม่ตรงกับแบบ', 'the rejection reason is kept');
select is(pg_temp.bomf('T-FG-SET', 'A', 'decided_by_name'), 'Bom Admin', 'the real admin, not the persona, is recorded as the decider');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 6, 'approve', '')$$, current_setting('test.set_a')), 'BOM_NOT_PENDING', 'a returned BOM cannot be approved without resubmitting');
select lives_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 6, pg_temp.i('T-FG-SET'), 24, date '2026-10-08', 'แก้จำนวนกล่อง',
    jsonb_build_array(pg_temp.bl('WIP-FOAM-001', 24, 2), pg_temp.bl('PKG-BOX-001', 1)))$$, current_setting('test.set_a')),
  'a rejected draft can be corrected');
select is(public.app_factory_submit_bom(current_setting('test.set_a')::uuid, 7) ->> 'status', 'pending_approval', 'and submitted again');
select is(pg_temp.bomf('T-FG-SET', 'A', 'decision_note'), '', 'resubmitting clears the previous reason');

select is(public.app_factory_decide_bom(current_setting('test.set_a')::uuid, 8, 'approve', 'ตรวจแล้ว') ->> 'status', 'approved', 'the admin can approve');
select is(pg_temp.bomf('T-FG-SET', 'A', 'decision_note'), 'ตรวจแล้ว', 'the approval note is kept');
select ok(pg_temp.bomf('T-FG-SET', 'A', 'decided_at') is not null, 'the decision time is recorded');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 9, 'approve', '')$$, current_setting('test.set_a')), 'BOM_NOT_PENDING', 'an approval cannot be replayed');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 9, 'reject', 'x')$$, current_setting('test.set_a')), 'BOM_NOT_PENDING', 'an approved BOM cannot be rejected');
select throws_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 9, pg_temp.i('T-FG-SET'), 1, date '2026-10-08', '', '[]')$$, current_setting('test.set_a')),
  'BOM_NOT_EDITABLE', 'an approved BOM cannot be edited');
select throws_ok(format($$select public.app_factory_withdraw_bom(%L::uuid, 9)$$, current_setting('test.set_a')), 'BOM_NOT_PENDING', 'an approved BOM cannot be withdrawn');

-- 11. Revision ใหม่แทนที่ฉบับที่อนุมัติแล้ว (ใช้ BOM ตัวอย่างที่ seed ไว้) ---------------------------
select is(public.app_factory_submit_bom(pg_temp.bomf('FG-MAT-001', 'A', 'id')::uuid, 1) ->> 'status', 'pending_approval', 'the seeded draft can be submitted');
select is(public.app_factory_decide_bom(pg_temp.bomf('FG-MAT-001', 'A', 'id')::uuid, 2, 'approve', '') ->> 'status', 'approved', 'and approved');
select is(public.app_factory_save_bom_draft(null, null, pg_temp.i('FG-MAT-001'), 1, date '2026-11-01', 'ปรับสูตร', jsonb_build_array(pg_temp.bl('WIP-CMP-001', 1.1, 3))) ->> 'revision', 'B',
  'a new draft of an approved item becomes the next revision');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'status'), 'approved', 'the approved revision stays in force while Rev. B is a draft');
select is(public.app_factory_submit_bom(pg_temp.bomf('FG-MAT-001', 'B', 'id')::uuid, 1) ->> 'status', 'pending_approval', 'Rev. B can be submitted');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'status'), 'approved', 'and Rev. A is still approved while Rev. B waits');
select is(public.app_factory_decide_bom(pg_temp.bomf('FG-MAT-001', 'B', 'id')::uuid, 2, 'approve', '') ->> 'status', 'approved', 'Rev. B can be approved');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'status'), 'obsolete', 'approving Rev. B retires Rev. A in the same step');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = 'FG-MAT-001' and x ->> 'status' = 'approved'),
  1::bigint, 'exactly one revision is approved');
select is(public.app_factory_save_bom_draft(null, null, pg_temp.i('FG-MAT-001'), 1, date '2026-12-01', '', jsonb_build_array(pg_temp.bl('WIP-CMP-001', 1))) ->> 'revision', 'C',
  'revisions keep counting up and are never reused');

-- 12. ตรวจซ้ำตอนอนุมัติ: Item ถูกหยุดใช้งาน หรือมีวงจรเกิดหลังส่ง ------------------------------------------
select lives_ok(format($$select public.app_factory_save_bom_draft(%L::uuid, 1, pg_temp.i('T-X'), 1, date '2026-10-07', '', jsonb_build_array(pg_temp.bl('T-Y', 1), pg_temp.bl('T-Z', 2)))$$,
    pg_temp.bomf('T-X', 'A', 'id')), 'T-X gets its lines');
select is(public.app_factory_submit_bom(pg_temp.bomf('T-X', 'A', 'id')::uuid, 2) ->> 'status', 'pending_approval', 'T-X is submitted');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'T-Z', 'ส่วนประกอบ Z', '', 'RM', 'chemical', 'SAFSOF', 'KG', 'buy', 'inactive', true, 0, '')$$, pg_temp.i('T-Z')),
  'a component is retired after the BOM was submitted');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 3, 'approve', '')$$, pg_temp.bomf('T-X', 'A', 'id')), 'BOM_COMPONENT_INACTIVE',
  'approval re-checks that every component is still active');
select is(public.app_factory_decide_bom(pg_temp.bomf('T-X', 'A', 'id')::uuid, 3, 'reject', 'Z หยุดใช้งาน') ->> 'status', 'draft', 'rejecting does not need a valid structure');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'T-Z', 'ส่วนประกอบ Z', '', 'RM', 'chemical', 'SAFSOF', 'KG', 'buy', 'active', true, 0, '')$$, pg_temp.i('T-Z')), 'Z is active again');
select is(public.app_factory_submit_bom(pg_temp.bomf('T-X', 'A', 'id')::uuid, 4) ->> 'status', 'pending_approval', 'T-X is submitted again');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 1, 'T-X', 'สินค้า X', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'buy', 'active', true, 0, '')$$, pg_temp.i('T-X')),
  'the parent is switched to bought-in after submission');
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, 'approve', '')$$, pg_temp.bomf('T-X', 'A', 'id')), 'BOM_PARENT_INVALID',
  'approval re-checks the parent item');
select lives_ok(format($$select public.app_factory_save_item(%L::uuid, 2, 'T-X', 'สินค้า X', '', 'FG', 'toy', 'SAFSOF', 'PCS', 'make', 'active', true, 0, '')$$, pg_temp.i('T-X')), 'the parent is back to make');

-- 13. ฝั่งผู้ดูแลระบบตัวจริง -----------------------------------------------------------------
select set_config('test.tx_bom', pg_temp.bomf('T-X', 'A', 'id'), true);
select set_config('test.tx_version', pg_temp.bomf('T-X', 'A', 'version'), true);
select public.app_sandbox_exit();
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 5, 'approve', '')$$, current_setting('test.tx_bom')), 'FACTORY_TEST_MODE_ONLY', 'leaving test mode closes the decision API');
reset role;

-- ไม่มี session = งานระบบ: trigger ไม่ตั้งโหมดให้ จึงจัดสถานการณ์ที่ API สร้างไม่ได้ได้ตรงๆ
select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.factory_boms set status = 'pending_approval', submitted_at = null where id = (select id from public.factory_boms where is_test and revision = 'C' limit 1)$$,
  '23514', null, 'the database refuses a pending BOM with no submission time');
select throws_ok($$update public.factory_boms set status = 'approved' where id = (select id from public.factory_boms where is_test and revision = 'C' limit 1)$$,
  '23514', null, 'the database refuses an approved BOM with no decision time');
select throws_ok($$insert into public.factory_boms (item_id, is_test, revision, output_qty, status, effective_date, decided_at)
                   values ((select id from public.factory_items where is_test and code = 'FG-MAT-001'), true, 'Z', 1, 'approved', date '2026-10-07', now())$$,
  '23505', null, 'the database refuses two approved revisions of one item');
select throws_ok($$insert into public.factory_boms (item_id, is_test, revision, output_qty, status, effective_date)
                   values ((select id from public.factory_items where is_test and code = 'FG-MAT-001'), true, 'Y', 1, 'draft', date '2026-10-07')$$,
  '23505', null, 'the database refuses two open revisions of one item');
select throws_ok($$insert into public.factory_boms (item_id, is_test, revision, output_qty, status, effective_date)
                   values ((select id from public.factory_items where is_test and code = 'T-Y'), true, 'A', 1, 'rejected', date '2026-10-07')$$,
  '23514', null, 'the database refuses unknown BOM statuses');
select throws_ok($$insert into public.factory_boms (item_id, is_test, revision, output_qty, status, effective_date)
                   values ('77000000-0000-0000-0000-00000000f001', true, 'Q', 1, 'obsolete', date '2026-10-07')$$,
  '23503', null, 'a test BOM cannot reference a real item (paired foreign key)');
select throws_ok($$insert into public.factory_bom_history (bom_id, is_test, action, version, status_after, snapshot)
                   values ('77000000-0000-0000-0000-00000000b001', true, 'create', 1, 'draft', '{}')$$,
  '23503', null, 'test history cannot reference a real BOM (paired foreign key)');

-- pending BOM ที่ผู้อนุมัติเป็นคนส่งเอง: ฐานข้อมูลกันไว้แม้ API ปกติไม่ทำให้เกิด (ผู้ส่งเป็น persona เสมอ)
update public.factory_boms set submitted_by = '77000000-0000-0000-0000-000000000101'
where id = (select id from public.factory_boms where is_test and revision = 'A' and item_id = (select id from public.factory_items where is_test and code = 'T-X'));
select is((select status from public.factory_boms where id = (select id from public.factory_boms where is_test and revision = 'A'
           and item_id = (select id from public.factory_items where is_test and code = 'T-X'))), 'pending_approval', 'T-X is waiting with the admin as its submitter');

-- วงจรที่เกิดหลังส่ง: สูตรของ T-Y (ตั้งตรงแบบงานระบบ) อ้าง T-X กลับ
insert into public.factory_boms (id, item_id, is_test, revision, output_qty, status, effective_date)
values ('77000000-0000-0000-0000-00000000b0c1', (select id from public.factory_items where is_test and code = 'T-Y'), true, 'A', 1, 'draft', date '2026-10-07');
insert into public.factory_bom_lines (bom_id, is_test, line_no, component_id, quantity)
values ('77000000-0000-0000-0000-00000000b0c1', true, 1, (select id from public.factory_items where is_test and code = 'T-X'), 1);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, %s, 'approve', '')$$, current_setting('test.tx_bom'), current_setting('test.tx_version')),
  'BOM_SELF_APPROVAL', 'the submitter cannot approve their own BOM');
select public.app_sandbox_exit();
reset role;
select set_config('request.jwt.claims', '', true);
update public.factory_boms set submitted_by = (select id from public.employees where employee_no = 'SBX-RB-STAFF') where id = current_setting('test.tx_bom')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, %s, 'approve', '')$$, current_setting('test.tx_bom'), current_setting('test.tx_version')),
  'BOM_CIRCULAR', 'approval re-checks for a loop that appeared after submission');
select throws_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, '77000000-0000-0000-0000-00000000b0c1'), 'BOM_CIRCULAR',
  'a draft that closes a loop cannot be submitted either');
select is(public.app_factory_decide_bom(current_setting('test.tx_bom')::uuid, current_setting('test.tx_version')::integer, 'reject', 'พบวงจรกับ T-Y') ->> 'status', 'draft',
  'a looping BOM can still be sent back');

-- 14. ประวัติ และข้อมูลที่หน้าเว็บอ่าน ---------------------------------------------------------------
select set_config('test.hist', (public.app_factory_master_data() -> 'bom_history')::text, true);
select ok(jsonb_array_length(current_setting('test.hist')::jsonb) >= 15, 'every step is in the history');
select is((select count(*) from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'T-FG-SET' and x ->> 'revision' = 'A'), 9::bigint,
  'T-FG-SET Rev. A has create, update, submit, withdraw, submit, reject, update, submit and approve entries');
select is((select x ->> 'action' from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'T-FG-SET' order by (x ->> 'id')::bigint desc limit 1),
  'approve', 'the latest T-FG-SET entry is the approval');
select is((select x ->> 'changed_by_name' from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'T-FG-SET' and x ->> 'action' = 'approve'),
  'Bom Admin', 'the history names the real admin as approver');
select is((select x ->> 'changed_by_name' from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'T-FG-SET' and x ->> 'action' = 'create'),
  'ทดสอบ พนักงาน RB', 'the history names the persona as author');
select is((select x ->> 'note' from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'T-FG-SET' and x ->> 'action' = 'reject'),
  'จำนวนกล่องไม่ตรงกับแบบ', 'the rejection reason is in the history');
select is((select x ->> 'note' from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ->> 'code' = 'FG-MAT-001' and x ->> 'action' = 'obsolete'),
  'แทนที่ด้วย Rev. B', 'the retired revision records what replaced it');
select ok(not exists (select 1 from jsonb_array_elements(current_setting('test.hist')::jsonb) x where x ? 'snapshot'), 'the read API leaves out the heavy snapshots');
select is(pg_temp.bomf('FG-MAT-001', 'A', 'status'), 'obsolete', 'the retired revision stays readable');

select public.app_sandbox_exit();
reset role;

-- 15. ฐานข้อมูล: snapshot audit และการแยกโหมด ----------------------------------------------------------
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.factory_bom_history where not is_test), 0::bigint, 'no real history was written');
select is((select count(*) from public.factory_boms where not is_test), 1::bigint, 'the real BOM is untouched');
select is((select status from public.factory_boms where id = '77000000-0000-0000-0000-00000000b001'), 'draft', 'and still a draft');
select is((select version from public.factory_boms where id = '77000000-0000-0000-0000-00000000b001'), 1, 'at its original version');
select is((select snapshot -> 'lines' -> 0 ->> 'component_code' from public.factory_bom_history h
           join public.factory_boms b on b.id = h.bom_id join public.factory_items i on i.id = b.item_id
           where i.code = 'FG-MAT-001' and h.action = 'create' limit 1), 'WIP-CMP-001', 'history keeps a snapshot of the lines');
select is((select snapshot ->> 'unit_code' from public.factory_bom_history h
           join public.factory_boms b on b.id = h.bom_id join public.factory_items i on i.id = b.item_id
           where i.code = 'T-FG-SET' and h.action = 'create' limit 1), 'PCS', 'the snapshot records the parent unit');
select is((select count(*) from public.audit_logs where action = 'FACTORY_BOM_CREATE' and (metadata ->> 'item_code') in ('T-FG-SET', 'FG-MAT-001', 'T-X', 'T-CYC-A')),
  5::bigint, 'every created draft is audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_UPDATE'), 'edits are audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_SUBMIT'), 'submissions are audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_WITHDRAW'), 'withdrawals are audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_APPROVE'), 'approvals are audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_REJECT'), 'rejections are audited');
select ok(exists (select 1 from public.audit_logs where action = 'FACTORY_BOM_OBSOLETE'), 'retired revisions are audited');
select is((select count(distinct actor_id) from public.audit_logs where action like 'FACTORY_BOM_%'), 1::bigint, 'every BOM audit entry names one actor');
select is((select actor_id from public.audit_logs where action = 'FACTORY_BOM_APPROVE' limit 1), '77000000-0000-0000-0000-000000000101'::uuid,
  'the audit log names the real admin, not the persona');
select is((select decided_by from public.factory_boms b join public.factory_items i on i.id = b.item_id where i.code = 'T-FG-SET' and b.revision = 'A'),
  '77000000-0000-0000-0000-000000000101'::uuid, 'the approval is stored against the real admin');

-- 16. ผู้ดูแลระบบที่ถูกลดสิทธิ์ตัดสินไม่ได้ ----------------------------------------------------------------
update public.employees set role_id = (select id from public.roles where code = 'staff') where id = '77000000-0000-0000-0000-000000000101';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(format($$select public.app_factory_decide_bom(%L::uuid, 1, 'approve', '')$$, current_setting('test.tx_bom')), 'FACTORY_TEST_MODE_ONLY',
  'a demoted admin can no longer decide');
reset role;
update public.employees set role_id = (select id from public.roles where code = 'admin') where id = '77000000-0000-0000-0000-000000000101';

-- 17. ล้างข้อมูลทดสอบ: ประวัติ BOM ถูกล้างด้วย ไม่ชน foreign key ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"77000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::int >= 25, 'purge removes the test items together with their BOMs and history');
select is(public.app_factory_master_data() -> 'boms', '[]'::jsonb, 'no test BOMs remain');
select is(public.app_factory_master_data() -> 'bom_history', '[]'::jsonb, 'no test history remains');
select public.app_sandbox_exit();
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*) from public.factory_bom_history where is_test), 0::bigint, 'purge cleared every test history row');
select is((select count(*) from public.factory_boms where not is_test), 1::bigint, 'purge never touches the real BOM');

select * from finish();
rollback;
