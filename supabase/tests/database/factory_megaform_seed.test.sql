-- ฝ่ายโรงงาน: ชุดข้อมูลทดสอบ "MEGAFORM 260702-26031" จากใบคำนวณวัตถุดิบ (20261008020000_factory_megaform_seed.sql)
-- ครอบคลุม: สิทธิ์และการปฏิเสธนอกโหมดทดสอบ จำนวนข้อมูลที่เติม (Item / BOM ที่อนุมัติแล้ว / Routing / ใบสั่งผลิต / ใบงานทุกแผนก / ยอดยกมา)
-- วันที่ตามแผนตรงกับกำหนดเสร็จแต่ละแผนกของไฟล์ ลำดับ RB → GR → PK ไม่ชนตาม BOM ไม่เกินกำหนดส่ง ใช้ร่วมกับ workflow ตารางเวลาเดิมได้
-- เติมซ้ำไม่ได้ การแยกโหมดทดสอบ ประวัติ/audit การใช้ร่วมกับชุดทดลอง และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. สิทธิ์ -------------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.app_sandbox_seed_factory_megaform()', 'execute'), 'anon cannot seed the MEGAFORM set');
select ok(has_function_privilege('authenticated', 'public.app_sandbox_seed_factory_megaform()', 'execute'),
  'signed-in users can call the seed API (it checks admin and test mode itself)');
select is((select count(*) from public.factory_units where code in ('BOX', 'ROLL', 'METER', 'YARD'))::integer, 4, 'the units used by the sheet exist');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'megaform-admin@test.local', '{}'),
  ('83000000-0000-0000-0000-000000000002', 'megaform-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('83000000-0000-0000-0000-000000000101', 'MEGAFORM-ADMIN', 'Mega', 'Admin', 'megaform-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '83000000-0000-0000-0000-000000000001'),
  ('83000000-0000-0000-0000-000000000102', 'MEGAFORM-STAFF', 'Mega', 'Staff', 'megaform-staff@test.local',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'staff'), '83000000-0000-0000-0000-000000000002');
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('83000000-0000-0000-0000-00000000f001', 'REAL-MEGA-01', 'Item จริงสำหรับตรวจการแยกโหมด', 'RM', 'rubber', 'MNP', 'KG', 'buy');
select set_config('test.p_pp', (select id::text from public.employees where employee_no = 'SBX-PP-STAFF'), true);
select set_config('test.p_rb', (select id::text from public.employees where employee_no = 'SBX-RB-STAFF'), true);

create function pg_temp.sdata() returns jsonb language sql stable as $$ select public.app_factory_schedule_data() $$;
create function pg_temp.bomqty(p_parent text, p_component text) returns numeric language sql stable as $$
  select (l ->> 'quantity')::numeric
  from jsonb_array_elements(public.app_factory_master_data() -> 'bom_lines') l
  join jsonb_array_elements(public.app_factory_master_data() -> 'boms') b on b ->> 'id' = l ->> 'bom_id'
  where b ->> 'code' = p_parent and l ->> 'code' = p_component $$;
-- แผนกของใบงาน = ศูนย์งานของขั้นแรก
create function pg_temp.first_center(p_job jsonb) returns text language sql immutable as $$ select p_job -> 'steps' -> 0 ->> 'work_center_code' $$;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_megaform()', 'AUTH_REQUIRED', 'seeding needs a session');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_megaform()', 'NOT_AUTHORIZED', 'a real staff account cannot seed the MEGAFORM set');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_seed_factory_megaform()', 'SANDBOX_NOT_ACTIVE', 'seeding needs test mode even for an admin');

-- 4. โหมดทดสอบ: เติมชุด MEGAFORM ---------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_pp')::uuid);
select is(public.app_factory_master_data() -> 'items', '[]'::jsonb, 'test mode starts empty');
select set_config('test.seed', public.app_sandbox_seed_factory_megaform()::text, true);
select is(current_setting('test.seed')::jsonb ->> 'seeded', 'true', 'the MEGAFORM set is added');
select is(current_setting('test.seed')::jsonb ->> 'items', '355', 'the result reports 355 items');
select is(current_setting('test.seed')::jsonb ->> 'boms', '229', 'the result reports 229 BOMs');
select is(current_setting('test.seed')::jsonb ->> 'steps', '1896', 'the result reports the routing steps');
select is(current_setting('test.seed')::jsonb ->> 'orders', '14', 'the result reports 14 production orders');
select is(current_setting('test.seed')::jsonb ->> 'jobs', '173', 'the result reports 173 jobs');
select is(public.app_sandbox_seed_factory_megaform() ->> 'seeded', 'false', 'seeding again changes nothing');
select is(public.app_sandbox_seed_factory_megaform() ->> 'orders', '14', 'the repeat reports the existing production orders');

select set_config('test.data', public.app_factory_master_data()::text, true);
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'items'), 355, 'the register holds 355 items');
select is((select string_agg(t || '=' || n, ',' order by t) from (
             select x ->> 'item_type' as t, count(*) as n from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x group by 1) s),
  'FG=14,PKG=42,RM=77,WIP=222', 'fourteen finished goods, 222 work-in-process items, 77 materials and 42 packaging items');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'lot_tracking' = 'true')::integer, 0,
  'no item is lot tracked, so the opening balances need no lots');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x
           where x ->> 'item_type' in ('WIP', 'FG') and x ->> 'procurement' = 'buy')::integer, 7,
  'seven work-in-process items have no recipe in the sheet, so they are bought and get no job');
select is((select x ->> 'unit_code' from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'code' = 'MEGA-ST-01'), 'SET', 'a finished good is counted in sets');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'boms'), 229, 'one BOM per manufactured item');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'boms') x where x ->> 'status' = 'approved' and x ->> 'revision' = 'A')::integer, 229,
  'every BOM is an approved revision A, so jobs can be issued');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'bom_lines'), 438, 'the BOMs hold 438 lines');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'routings'), 229, 'one routing per manufactured item');
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'steps'), 1896, 'the routings hold 1896 steps');

-- ตัวอย่าง BOM หลายชั้นจากไฟล์: MEGA-ST-01 (ชุดละ 3 ลูกตอปิโด) ใช้ SE → RB → สูตรยาง
select is(pg_temp.bomqty('MEGA-ST-01', 'SE-ST01-100-18-65-OR01'), 300.0000::numeric, 'MEGA-ST-01 needs 3 torpedo bodies per set, so 300 per 100-set batch');
select is(pg_temp.bomqty('SE-ST01-100-18-65-OR01', 'RB-B0006-02-202-18-70-OR01'), 32.2581::numeric, 'one rubber strip yields 31 bodies, so 1/31 of a strip per body (32.2581 per 1000)');
select is(pg_temp.bomqty('RB-B0006-02-202-18-70-OR01', 'CPD-B0006-02-OR01'), 153.0000::numeric, 'a 1530 g strip needs 153 kg of rubber recipe per 100 strips');
select is(pg_temp.bomqty('PT-00320', 'D21-016'), 20.0000::numeric, 'a 20 g part needs 20 kg of resin per 1000 parts');

-- ใบสั่งผลิต: เดิน workflow จนออกใบสั่งงาน กำหนดส่ง = วันส่งมอบเข้าคลัง WH
select is(jsonb_array_length(current_setting('test.data')::jsonb -> 'production'), 14, 'one production order per finished good');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production') x
           where x ->> 'status' = 'released' and x ->> 'work_order_no' is not null and x ->> 'due_date' = '2026-10-16'
             and x ->> 'customer' = 'MEGAFORM (เมก้าฟอร์ม)')::integer, 14, 'every order is released with a work order number, due 2026-10-16, for MEGAFORM');
select is((select sum((x ->> 'planned_qty')::numeric) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production') x), 4711::numeric,
  'the order quantities add up to the quantities in the sheet');
select is((select (x ->> 'planned_qty')::numeric from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production') x where x ->> 'item_code' = 'MEGA-SL-01B'), 2040::numeric,
  'MEGA-SL-01B is ordered 2040 sets');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production_history') x where x ->> 'action' = 'release')::integer, 14, 'each order has the release step in its history');
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'production_history') x)::integer, 70, 'create, submit, receive, plan and release are recorded per order');

-- ใบงาน: ทุกแผนก มีวันที่ตามแผน
select set_config('test.sched', pg_temp.sdata()::text, true);
select is(jsonb_array_length(current_setting('test.sched')::jsonb -> 'orders'), 14, 'the Gantt shows 14 production orders');
select is(jsonb_array_length(current_setting('test.sched')::jsonb -> 'jobs'), 173, 'the Gantt shows 173 jobs');
select is((select string_agg(c || '=' || n, ',' order by c) from (
             select pg_temp.first_center(x) as c, count(*) as n from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x group by 1) s),
  'BG=5,GR=95,PK=14,PT=17,RB=42', 'jobs exist for RB, GR, PT, BG and PK (SR, QC and WH steps ride on the RB and PK jobs)');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x
           where x ->> 'status' = 'open' and x ->> 'planned_start' is not null and x ->> 'planned_end' is not null and (x ->> 'schedule_version')::integer = 2)::integer, 173,
  'every job is open and scheduled once');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x
           where (x ->> 'qty')::numeric <= 0)::integer, 0, 'every job has a positive quantity');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') j
           join jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') i on i ->> 'id' = j ->> 'item_id'
           where i ->> 'procurement' = 'buy')::integer, 0, 'no job is issued for an item the sheet gives no recipe for');
select is((select sum((x ->> 'qty')::numeric) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x
           where x ->> 'item_code' = 'MEGA-ST-01' ), 560::numeric, 'the finished good job carries the ordered quantity');
select is((select jsonb_array_length(x -> 'steps') from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x where x ->> 'item_code' = 'MEGA-ST-01'), 6,
  'a finished good job runs PK-01..PK-05 then WH-01');
select is((select jsonb_array_length(x -> 'steps') from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x where x ->> 'item_code' = 'RB-B0006-02-202-18-70-OR01' limit 1), 15,
  'a rubber strip job runs RB-01..RB-13, SR-01 and QC-01');

-- วันที่ตามแผนตรงกับ "กำหนดเสร็จแต่ละแผนก" ของไฟล์ (ใบงานแรกของแต่ละแผนกจบตามกำหนด ไม่มีใบใดเกิน)
select is((select string_agg(c || '=' || e, ',' order by c) from (
             select pg_temp.first_center(x) as c, max(x ->> 'planned_end') as e from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x group by 1) s),
  'BG=2026-10-05,GR=2026-10-05,PK=2026-10-15,PT=2026-10-03,RB=2026-09-25', 'each department ends on its deadline from the sheet');
select ok((select min(x ->> 'planned_start') from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x) >= '2026-07-14', 'nothing starts before the order date');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x
           where pg_temp.first_center(x) = 'GR' and x ->> 'planned_start' < '2026-09-25')::integer, 0, 'GR starts after the RB deadline');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') x
           where pg_temp.first_center(x) = 'PK' and x ->> 'planned_start' < '2026-10-05')::integer, 0, 'PK starts after the GR, PT and BG deadlines');
-- ไม่ชนลำดับตาม BOM: ทุกใบเริ่มไม่ก่อนใบที่ผลิตชิ้นงานที่ต้องใช้จบ · ไม่มีใบที่จบหลังกำหนดส่งของใบสั่งผลิต
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') j,
                  jsonb_array_elements_text(j -> 'needs') n(id)
           join jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') k on k ->> 'id' = n.id
           where j ->> 'planned_start' < k ->> 'planned_end')::integer, 0, 'no job starts before the jobs it depends on end');
select ok((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') j,
                  jsonb_array_elements_text(j -> 'needs') n(id)) > 100, 'the dependencies between jobs come from the BOMs');
select is((select count(*) from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'jobs') j
           join jsonb_array_elements(current_setting('test.sched')::jsonb -> 'orders') o on o ->> 'id' = j ->> 'production_order_id'
           where j ->> 'planned_end' > o ->> 'due_date')::integer, 0, 'no job ends after the delivery date');
select is((select string_agg(c || '=' || u, ',' order by c) from (
             select x ->> 'code' as c, x ->> 'units' as u from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'work_centers') x) s),
  'BG=2,GR=10,PK=4,PT=2,QC=1,RB=5,SR=1,WH=1', 'the machines per work center fit the plan');
select is((select (x ->> 'calendar_version')::integer from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'work_centers') x where x ->> 'code' = 'GR'), 2,
  'a changed calendar bumps its version');
select is((select (x ->> 'calendar_version')::integer from jsonb_array_elements(current_setting('test.sched')::jsonb -> 'work_centers') x where x ->> 'code' = 'WH'), 1,
  'a center whose calendar did not change keeps its version');

-- ยอดยกมา
select is((select count(*) from jsonb_array_elements(current_setting('test.data')::jsonb -> 'inventory') x where (x ->> 'quantity')::numeric > 0)::integer, 86,
  'the opening balances come from the stock column of the sheet');
select is((select (x ->> 'stock')::numeric from jsonb_array_elements(current_setting('test.data')::jsonb -> 'items') x where x ->> 'code' = 'PT-00320'), 168::numeric,
  'the stock of PT-00320 matches the sheet');
select is((select string_agg(distinct x ->> 'warehouse', ',' order by x ->> 'warehouse') from jsonb_array_elements(current_setting('test.data')::jsonb -> 'inventory') x
           where (x ->> 'quantity')::numeric > 0),
  'คลังยางเส้นยาว (SR),คลังระหว่างผลิต', 'strips go to SR and parts to work-in-process (the sheet counts no stock of materials)');

-- ใช้งานต่อกับ workflow ตารางเวลาเดิมได้: PP ย้ายแถบของใบที่เติมไว้ ใบเก่าถูกล็อกด้วย schedule_version
select set_config('test.job', (select x ->> 'id' from jsonb_array_elements(pg_temp.sdata() -> 'jobs') x where x ->> 'item_code' = 'MEGA-ST-01'), true);
select lives_ok(format($$select public.app_factory_schedule_job(%L::uuid, 2, date '2026-10-06', date '2026-10-14', 'ย้ายแถบ')$$, current_setting('test.job')),
  'the planner can move a seeded job');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 2, date '2026-10-06', date '2026-10-14', '')$$, current_setting('test.job')),
  'SCHEDULE_STALE', 'a second move with the old schedule version is refused');
select is((select x ->> 'planned_start' from jsonb_array_elements(pg_temp.sdata() -> 'jobs') x where x ->> 'id' = current_setting('test.job')), '2026-10-06', 'the moved bar is saved');

select public.app_sandbox_exit();
select throws_ok('select public.app_sandbox_seed_factory_megaform()', 'SANDBOX_NOT_ACTIVE', 'leaving test mode closes the seed again');
reset role;

-- 5. การแยกโหมด ประวัติ และ audit ---------------------------------------------------
select is((select count(*) from public.factory_items where is_test)::integer, 355, 'all MEGAFORM items are flagged as test data');
select is((select count(*) from public.factory_items where not is_test)::integer, 1, 'the real item is untouched');
select is((select count(*) from public.factory_jobs where not is_test)::integer, 0, 'the seed never writes real jobs');
select is((select count(*) from public.factory_production_orders where not is_test)::integer, 0, 'the seed never writes real production orders');
select is((select count(*) from public.factory_inventory_movements where not is_test)::integer, 0, 'the seed never writes real movements');
select is((select count(*) from public.factory_work_centers where not is_test)::integer, 0, 'the seed never touches real work centers');
select is((select count(*) from public.factory_bom_history where is_test and action = 'create')::integer, 229, 'every BOM has a create entry');
select is((select count(*) from public.factory_bom_history where is_test and action = 'submit')::integer, 229, 'every BOM has a submit entry');
select is((select count(*) from public.factory_bom_history where is_test and action = 'approve')::integer, 229, 'every BOM has an approve entry');
select is((select count(distinct changed_by) from public.factory_bom_history where is_test and action = 'approve'), 1::bigint, 'one approver for every BOM');
select is((select changed_by from public.factory_bom_history where is_test and action = 'approve' limit 1), '83000000-0000-0000-0000-000000000101'::uuid,
  'the real admin behind the persona approved the BOMs, not the persona');
select is((select count(*) from public.factory_job_history where is_test and action = 'create')::integer, 173, 'every job has a create entry');
select is((select count(*) from public.factory_job_history where is_test and action = 'schedule')::integer, 174, 'every job has a schedule entry (plus the planner move)');
select is((select count(*) from public.factory_job_steps where is_test)::integer, 1138, 'the jobs carry their routing steps');
select is((select count(*) from public.factory_job_steps where is_test and status <> 'pending')::integer, 0, 'no step is done yet');
select is((select created_by from public.factory_items where code = 'MEGA-ST-01' and is_test), current_setting('test.p_pp')::uuid, 'the persona is recorded as the creator');
select is((select actor_id from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_MEGAFORM'), '83000000-0000-0000-0000-000000000101'::uuid,
  'the audit log names the real admin behind the persona');
select is((select metadata ->> 'jobs' from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_MEGAFORM'), '173', 'the audit log records the number of jobs');
select is((select count(*) from public.audit_logs where action = 'SANDBOX_SEED_FACTORY_MEGAFORM')::integer, 1, 'the refused and repeated calls are not audited as seeds');
select is((select count(*) from public.audit_logs where action = 'FACTORY_JOB_CREATE')::integer, 173, 'job creation is audited like the normal workflow');

-- 6. ใช้ร่วมกับชุดทดลอง ล้างแล้วเติมใหม่ได้ ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_pp')::uuid);
select is(public.app_sandbox_purge_factory() ->> 'deleted', '355', 'purge removes the MEGAFORM items');
reset role;
select is((select count(*) from public.factory_jobs where is_test)::integer, 0, 'the purge removes the jobs');
select is((select count(*) from public.factory_job_steps where is_test)::integer, 0, 'the purge removes the job steps');
select is((select count(*) from public.factory_job_history where is_test)::integer, 0, 'the purge removes the job history');
select is((select count(*) from public.factory_production_orders where is_test)::integer, 0, 'the purge removes the production orders');
select is((select count(*) from public.factory_boms where is_test)::integer, 0, 'the purge removes the BOMs');
select is((select count(*) from public.factory_inventory_movements where is_test)::integer, 0, 'the purge removes the opening balances');
select is((select count(*) from public.factory_items where not is_test)::integer, 1, 'the real item survives the purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the five-item trial loads first');
select is(public.app_sandbox_seed_factory_megaform() ->> 'seeded', 'true', 'the MEGAFORM set loads next to the trial set');
select is(jsonb_array_length(public.app_factory_master_data() -> 'items'), 382, 'twenty-seven trial items plus 355 MEGAFORM items');
select is(jsonb_array_length(public.app_factory_master_data() -> 'warehouses'), 4, 'shared warehouse codes are reused, not duplicated');
select is(jsonb_array_length(public.app_factory_master_data() -> 'production'), 19, 'five trial orders plus fourteen MEGAFORM orders');
select is(public.app_sandbox_seed_factory_megaform() ->> 'seeded', 'false', 'the repeat is refused next to the trial set too');
reset role;
select is((select count(*) from public.factory_work_centers where is_test)::integer, 8, 'the eight department work centers are shared, not duplicated');
select is((select count(*) from public.factory_items where not is_test)::integer, 1, 'the real item is still untouched');

select * from finish();
rollback;
