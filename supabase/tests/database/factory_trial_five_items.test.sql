-- ฝ่ายโรงงาน: ชุดข้อมูลทดลอง "สินค้า 5 Item ตาม workflow การผลิต"
-- (20261007020000_factory_trial_five_items.sql) ครอบคลุม: สิทธิ์และการปฏิเสธนอกโหมดทดสอบ จำนวนและโครงสร้างข้อมูลที่เติม
-- ลำดับขั้น Routing ตามแผนก ยอดยกมา/ต่ำกว่าขั้นต่ำ BOM ที่เติมต้องผ่านขั้นส่งขออนุมัติ→อนุมัติของระบบเดิม เติมซ้ำไม่ได้
-- ใช้ร่วมกับชุดตัวอย่างเดิมได้ การล้างข้อมูลทดสอบ การแยกโหมด และ audit
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. สิทธิ์ -------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.app_sandbox_seed_factory_trial()', 'execute'), 'anon cannot seed the trial set');
select ok(has_function_privilege('authenticated', 'public.app_sandbox_seed_factory_trial()', 'execute'),
  'signed-in users can call the seed API (it checks admin and test mode itself)');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('78000000-0000-0000-0000-000000000001', 'trial-admin@test.local', '{}'),
  ('78000000-0000-0000-0000-000000000002', 'trial-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('78000000-0000-0000-0000-000000000101', 'TRIAL-ADMIN', 'Trial', 'Admin', 'trial-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '78000000-0000-0000-0000-000000000001'),
  ('78000000-0000-0000-0000-000000000102', 'TRIAL-STAFF', 'Trial', 'Staff', 'trial-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '78000000-0000-0000-0000-000000000002');
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('78000000-0000-0000-0000-00000000f001', 'REAL-TRY-01', 'Item จริงสำหรับตรวจการแยกโหมด', 'RM', 'rubber', 'MNP', 'KG', 'buy');
select set_config('test.persona', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_trial()', 'AUTH_REQUIRED', 'seeding needs a session');

select set_config('request.jwt.claims', '{"sub":"78000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_trial()', 'NOT_AUTHORIZED', 'a real staff account cannot seed the trial set');

select set_config('request.jwt.claims', '{"sub":"78000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_trial()', 'SANDBOX_NOT_ACTIVE', 'seeding needs test mode even for an admin');

-- 4. โหมดทดสอบ: เติมชุดทดลอง ---------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select is(public.app_factory_master_data() -> 'items', '[]'::jsonb, 'test mode starts empty');
select set_config('test.seed', public.app_sandbox_seed_factory_trial()::text, true);
select is(current_setting('test.seed')::jsonb ->> 'seeded', 'true', 'the trial set is added');
select is(current_setting('test.seed')::jsonb ->> 'items', '27', 'the result reports 27 items');
select is(current_setting('test.seed')::jsonb ->> 'boms', '17', 'the result reports 17 BOMs');
select is(current_setting('test.seed')::jsonb ->> 'steps', '77', 'the result reports 77 routing steps');
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'false', 'seeding again changes nothing');
select is(public.app_sandbox_seed_factory_trial() ->> 'items', '27', 'the repeat reports the existing trial items');

select set_config('test.data', public.app_factory_master_data()::text, true);
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'items'), 27, 'twenty-seven test items are visible');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'FG')::integer, 5, 'five finished goods');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'WIP')::integer, 12,
  'twelve work-in-process items (long strip, bag, 5 rubber parts, 5 plastic parts)');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'RM')::integer, 9, 'nine raw materials');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'PKG')::integer, 1, 'one packaging item');
select is((select string_agg(x ->> 'code', ',' order by x ->> 'code') from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'FG'),
  'FG-TRY-001,FG-TRY-002,FG-TRY-003,FG-TRY-004,FG-TRY-005', 'finished goods are numbered 001 to 005');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'boms'), 17, 'one BOM per manufactured item');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'boms') x where x ->> 'status' = 'draft' and x ->> 'revision' = 'A')::integer, 17,
  'every BOM is a draft revision A');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'bom_lines'), 42, 'forty-two BOM lines');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'routings'), 17, 'one routing per manufactured item');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'steps'), 77, 'seventy-seven routing steps');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'production'), 5, 'one production order per finished good');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production') x where x ->> 'status' = 'planned')::integer, 5,
  'production orders start as planned (waiting for the planning department)');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'warehouses'), 4, 'four warehouses (raw, long-strip, work-in-process, finished goods)');

-- ลำดับขั้นตามสายงาน: ยางเส้นยาว RB-01..RB-13 → SR → QC · FG PK-01..05 → WH
select set_config('test.rbl_routing', (select x ->> 'id' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'routings') x where x ->> 'code' = 'WIP-TRY-RBL-001'), true);
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x where x ->> 'routing_id' = current_setting('test.rbl_routing'))::integer, 15,
  'the long strip routing has RB-01..RB-13, SR and QC');
select is((select x ->> 'name' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.rbl_routing') and (x ->> 'sequence')::integer = 10), 'RB-01 ชั่งเคมี', 'the rubber line starts with weighing chemicals');
select is((select x ->> 'name' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.rbl_routing') and (x ->> 'sequence')::integer = 130), 'RB-13 ตัดยางเส้นยาว', 'RB ends by cutting the long strip');
select is((select x ->> 'work_center' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.rbl_routing') and (x ->> 'sequence')::integer = 140), 'แผนก SR คลังยางเส้นยาว', 'SR receives the long strip');
select is((select x ->> 'work_center' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.rbl_routing') and (x ->> 'sequence')::integer = 150), 'แผนก QC ตรวจสอบขนาด', 'QC checks the size while SR receives');
select is((select (x ->> 'run_minutes')::numeric from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.rbl_routing') and (x ->> 'sequence')::integer = 40), 240::numeric, 'the first rubber rest takes four hours');
select set_config('test.fg_routing', (select x ->> 'id' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'routings') x where x ->> 'code' = 'FG-TRY-003'), true);
select is((select string_agg(left(x ->> 'name', 5), ',' order by (x ->> 'sequence')::integer) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.fg_routing')), 'PK-01,PK-02,PK-03,PK-04,PK-05,WH-01', 'a finished good is assembled and packed by PK, then received by WH');
select is((select x ->> 'work_center' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.fg_routing') and (x ->> 'sequence')::integer = 60), 'แผนก WH คลังสินค้าสำเร็จรูป', 'the last step is the finished-goods warehouse');
select set_config('test.gr_routing', (select x ->> 'id' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'routings') x where x ->> 'code' = 'WIP-TRY-RBP-003'), true);
select is((select string_agg(left(x ->> 'name', 5), ',' order by (x ->> 'sequence')::integer) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'steps') x
           where x ->> 'routing_id' = current_setting('test.gr_routing')), 'GR-01,GR-02,GR-03,GR-04', 'GR cuts, glues, grinds and sorts');

-- ยอดยกมา: ยางเส้นยาวอยู่คลัง SR, ตัวเร่งต่ำกว่าขั้นต่ำ (ใช้ลองขั้นสำรวจคงคลัง), FG/WIP รายตัวยังไม่มียอด
select is((select (x ->> 'stock')::numeric from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'code' = 'WIP-TRY-RBL-001'),
  260::numeric, 'the long strip has opening stock');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'inventory') x
           where x ->> 'code' = 'WIP-TRY-RBL-001' and x ->> 'warehouse' = 'คลังยางเส้นยาว (SR)')::integer, 1, 'the long strip is held in the SR warehouse');
select is((select string_agg(x ->> 'code', ',') from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x
           where (x ->> 'status') = 'active' and (x ->> 'stock')::numeric < (x ->> 'min_stock')::numeric), 'RM-TRY-ACC-001',
  'only the accelerator is below its minimum, so the planner survey has something to find');
select is((select sum((x ->> 'stock')::numeric) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'item_type' = 'FG'), 0::numeric,
  'no finished goods are in stock before production');

-- BOM ที่เติมต้องผ่านขั้นส่งขออนุมัติ → อนุมัติของระบบเดิม (ตรวจ Item ที่ใช้งานอยู่ และไม่มีสูตรวนซ้ำข้ามหลายชั้น)
select set_config('test.fg_bom', (select x ->> 'id' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'boms') x where x ->> 'code' = 'FG-TRY-001'), true);
select lives_ok(format($$select public.app_factory_submit_bom(%L::uuid, 1)$$, current_setting('test.fg_bom')), 'a seeded BOM can be submitted for approval');
select lives_ok(format($$select public.app_factory_decide_bom(%L::uuid, 2, 'approve', 'ผ่านการทดลอง')$$, current_setting('test.fg_bom')), 'the admin can approve a seeded BOM');
select is((select x ->> 'status' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'id' = current_setting('test.fg_bom')),
  'approved', 'the approved BOM is shown as approved');

select public.app_sandbox_exit();
select throws_ok('select public.app_sandbox_seed_factory_trial()', 'SANDBOX_NOT_ACTIVE', 'leaving test mode closes the seed again');
reset role;

-- 5. การแยกโหมดและ audit -----------------------------------------------------------
select is((select count(*) from public.factory_items where is_test)::integer, 27, 'all trial items are flagged as test data');
select is((select count(*) from public.factory_items where not is_test)::integer, 1, 'the real item is untouched');
select is((select count(*) from public.factory_inventory_movements where not is_test)::integer, 0, 'the trial set never writes real movements');
select is((select count(*) from public.factory_production_orders where not is_test)::integer, 0, 'the trial set never writes real production orders');
select is((select count(*) from public.factory_bom_history where is_test and action = 'create')::integer, 17, 'every seeded BOM has a create entry in its history');
select is((select count(*) from public.factory_boms where not is_test)::integer, 0, 'no real BOMs are created');
select is((select created_by from public.factory_items where code = 'FG-TRY-001' and is_test), current_setting('test.persona')::uuid,
  'the persona is recorded as the creator');
select is((select actor_id from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_TRIAL'),
  '78000000-0000-0000-0000-000000000101'::uuid, 'the audit log names the real admin behind the persona');
select is((select metadata ->> 'items' from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_TRIAL'), '27', 'the audit log records the number of items');
select is((select count(*) from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_TRIAL')::integer, 1, 'the refused and repeated calls are not audited as seeds');

-- 6. ใช้ร่วมกับชุดตัวอย่างเดิม และล้างแล้วเติมใหม่ได้ ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"78000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.persona')::uuid);
select is(public.app_sandbox_purge_factory() ->> 'deleted', '27', 'purge removes the trial items too');
select is(public.app_factory_master_data() -> 'items', '[]'::jsonb, 'the register is empty after the purge');
select is(public.app_sandbox_seed_factory() ->> 'items', '16', 'the earlier demo set loads first');
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set loads next to the demo set');
select is(jsonb_array_length(public.app_factory_master_data() -> 'items'), 43, 'sixteen demo items plus twenty-seven trial items');
select is(jsonb_array_length(public.app_factory_master_data() -> 'warehouses'), 4, 'shared warehouse codes are reused, not duplicated');
reset role;
select is((select count(*) from public.factory_work_centers where is_test)::integer, 12, 'the shared QC work center is reused (5 demo + 7 department centers)');
select is((select count(*) from public.factory_work_centers where is_test and code = 'QC')::integer, 1, 'QC exists once');
select is((select count(*) from public.factory_items where not is_test)::integer, 1, 'the real item is still untouched');

select * from finish();
rollback;
