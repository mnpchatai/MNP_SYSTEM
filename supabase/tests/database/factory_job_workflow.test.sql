-- ฝ่ายโรงงาน: ใบงานผลิต ขั้น 4–8 ทุกสาย (20261007050000_factory_job_workflow.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบ/ผิดแผนก การตรวจค่าทุกช่อง เงื่อนไขใบสั่งงาน/BOM/Routing/คลัง การคัดลอกขั้นตอน
-- ลำดับขั้นและกดซ้ำ version การตัดวัตถุดิบตอนขั้นแรก (FIFO ข้ามล็อต ยอดไม่พอแล้วย้อนทั้งธุรกรรม) การรับผลผลิตตอนขั้นสุดท้าย (ล็อต จำนวนผลิตจริง)
-- ความคืบหน้าของใบสั่งผลิต (in_progress → completed) ยกเลิก ประวัติ audit การแยกโหมดทดสอบ และการล้างข้อมูล
-- ทดสอบสายผลิตจริงตั้งแต่ RB→SR→QC (ยางเส้นยาว) GR PT BG PK→WH ของ FG-TRY-001 ในใบสั่งผลิต 12 ชุด
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select count(*) from pg_class c where c.relname in ('factory_jobs', 'factory_job_steps', 'factory_job_history') and c.relrowsecurity) = 3, 'every job table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['factory_jobs', 'factory_job_steps', 'factory_job_history']) t(name),
                  unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct privilege on the job tables');
select ok((select count(*) from pg_trigger g where g.tgname in ('factory_jobs_sandbox_scope', 'factory_job_steps_sandbox_scope', 'factory_job_history_sandbox_scope') and not g.tgisinternal) = 3,
  'every job table enforces sandbox scope by trigger');
select ok('factory_jobs' = any (private.sandbox_unguarded_tables()) and 'factory_job_steps' = any (private.sandbox_unguarded_tables())
          and 'factory_job_history' = any (private.sandbox_unguarded_tables()) and 'factory_material_orders' = any (private.sandbox_unguarded_tables())
          and 'factory_items' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the job tables');
select ok(not has_function_privilege('anon', 'public.app_factory_create_job(uuid,uuid,numeric,text,text)', 'execute'), 'anon cannot create jobs');
select ok(not has_function_privilege('anon', 'public.app_factory_cancel_job(uuid,integer,text)', 'execute'), 'anon cannot cancel jobs');
select ok(not has_function_privilege('anon', 'public.app_factory_complete_job_step(uuid,integer,integer,text,numeric)', 'execute'), 'anon cannot complete steps');
select ok(has_function_privilege('authenticated', 'public.app_factory_complete_job_step(uuid,integer,integer,text,numeric)', 'execute'), 'signed-in users can call the API (it checks mode and department itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_job_lock(uuid,integer)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_job_log(uuid,text,integer,text,public.employees)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_job_snapshot(uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_issue_stock(uuid,numeric,text,uuid,uuid)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_center_department(text)', 'execute'),
  'clients cannot call the job helper functions');
select is(private.factory_center_department('rb'), 'RB', 'a work center maps to the department with the same code');
select is(private.factory_center_department('QC'), 'QA', 'the QC work center is the QA department');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
select is((select count(*) from public.employees e join public.departments d on d.id = e.department_id
           where e.is_test and e.employee_no in ('SBX-SR-STAFF', 'SBX-GR-STAFF', 'SBX-PT-STAFF', 'SBX-BG-STAFF', 'SBX-WH-STAFF') and d.code = substr(e.employee_no, 5, 2))::integer,
  5, 'the SR, GR, PT, BG and WH personas exist in their own departments');
select ok(not exists (select 1 from public.employees where employee_no like 'SBX-%-STAFF' and (is_active or auth_user_id is not null or not is_test)), 'no persona can log in');

insert into auth.users (id, email, raw_user_meta_data) values
  ('81000000-0000-0000-0000-000000000001', 'job-admin@test.local', '{}'),
  ('81000000-0000-0000-0000-000000000002', 'job-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('81000000-0000-0000-0000-000000000101', 'JOB-ADMIN', 'Job', 'Admin', 'job-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '81000000-0000-0000-0000-000000000001'),
  ('81000000-0000-0000-0000-000000000102', 'JOB-STAFF', 'Job', 'Staff', 'job-staff@test.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '81000000-0000-0000-0000-000000000002');
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ): ใบงานจริงหนึ่งใบ ใช้ตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('81000000-0000-0000-0000-00000000f001', 'REAL-JB-FG', 'สินค้าจริง', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_boms (id, item_id, revision, output_qty, status, effective_date, decided_at)
values ('81000000-0000-0000-0000-00000000b001', '81000000-0000-0000-0000-00000000f001', 'A', 1, 'approved', date '2026-10-01', now());
insert into public.factory_routings (id, item_id, revision, status) values ('81000000-0000-0000-0000-00000000d001', '81000000-0000-0000-0000-00000000f001', 'A', 'draft');
insert into public.factory_warehouses (id, code, name) values ('81000000-0000-0000-0000-00000000e001', 'RM', 'คลังจริง');
insert into public.factory_production_orders (id, code, item_id, bom_id, routing_id, planned_qty, status, due_date)
values ('81000000-0000-0000-0000-00000000a001', 'REAL-MO-JB', '81000000-0000-0000-0000-00000000f001', '81000000-0000-0000-0000-00000000b001', '81000000-0000-0000-0000-00000000d001', 5, 'released', current_date + 5);
insert into public.factory_jobs (id, code, production_order_id, item_id, bom_id, routing_id, warehouse_id, qty)
values ('81000000-0000-0000-0000-00000000c001', 'REAL-JB-001', '81000000-0000-0000-0000-00000000a001', '81000000-0000-0000-0000-00000000f001',
        '81000000-0000-0000-0000-00000000b001', '81000000-0000-0000-0000-00000000d001', '81000000-0000-0000-0000-00000000e001', 5);
insert into public.factory_job_steps (job_id, sequence, name, work_center_code) values ('81000000-0000-0000-0000-00000000c001', 10, 'ขั้นจริง', 'RB');
select set_config('test.p_' || substr(employee_no, 5, 2), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-SR-STAFF', 'SBX-QA-STAFF', 'SBX-GR-STAFF', 'SBX-PT-STAFF', 'SBX-BG-STAFF', 'SBX-PK-STAFF', 'SBX-WH-STAFF');
select set_config('test.yy', to_char(now() at time zone 'Asia/Bangkok', 'YY'), true);
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.stock(text) returns numeric language sql stable as $$
  select (x ->> 'stock')::numeric from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;
create function pg_temp.job(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.po(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'id' = $1 $$;
-- อนุมัติ BOM Rev. A ของ Item (ส่งแล้วให้ admin อนุมัติ) — ใช้ตอนเตรียมข้อมูล
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;
-- ทำขั้นตอนที่ n..m ของใบงาน (เรียงตามลำดับ เวอร์ชันเริ่มที่ n) — ใช้กับ persona ปัจจุบัน
create function pg_temp.run(text, integer, integer) returns integer language plpgsql as $$
declare v_n integer;
begin
  for v_n in $2..$3 loop
    perform public.app_factory_complete_job_step($1::uuid, (pg_temp.job($1) ->> 'version')::integer, v_n * 10, '', null);
  end loop;
  return $3 - $2 + 1;
end $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_complete_job_step('81000000-0000-0000-0000-00000000c001', 1, 10, '', null)$$, 'AUTH_REQUIRED', 'completing a step needs a session');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_complete_job_step('81000000-0000-0000-0000-00000000c001', 1, 10, '', null)$$, 'FACTORY_TEST_MODE_ONLY', 'a real RB account cannot complete a step (real mode is not open)');
select throws_ok($$select public.app_factory_create_job('81000000-0000-0000-0000-00000000a001', '81000000-0000-0000-0000-00000000f001', 1, 'RM', '')$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot create a job');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_cancel_job('81000000-0000-0000-0000-00000000c001', 1, 'x')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot cancel a job');

-- 4. เตรียมใบสั่งผลิต 12 ชุดที่ออกใบสั่งงานแล้ว + อนุมัติ BOM ของทุกชิ้นงาน -------------------------
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('WIP-TRY-RBL-001'), pg_temp.approve('WIP-TRY-RBP-001'), pg_temp.approve('WIP-TRY-PTP-001'), pg_temp.approve('WIP-TRY-BAG-001')$$,
  'the BOMs of the finished good and its four semi-finished items are approved');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-001')::uuid, 12, current_setting('test.due')::date, '', '')) ->> 'id', true);
select set_config('test.wo_draft', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-002')::uuid, 12, current_setting('test.due')::date, '', '')) ->> 'id', true);
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 1)$$, current_setting('test.wo')), 'sales sends the order');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select lives_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 2)$$, current_setting('test.wo')), 'planning receives it');
select lives_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 3, %L::uuid, %L::uuid, 'พอ')$$, current_setting('test.wo'), pg_temp.bom('FG-TRY-001'), pg_temp.routing('FG-TRY-001')), 'planning plans it');
select lives_ok(format($$select public.app_factory_release_production_order(%L::uuid, 4)$$, current_setting('test.wo')), 'planning issues the work order');

-- 5. ออกใบงาน: ตรวจค่าทุกช่อง ----------------------------------------------------------------
select set_config('test.rbl', pg_temp.item('WIP-TRY-RBL-001'), true);
select set_config('test.rbp', pg_temp.item('WIP-TRY-RBP-001'), true);
select set_config('test.ptp', pg_temp.item('WIP-TRY-PTP-001'), true);
select set_config('test.bag', pg_temp.item('WIP-TRY-BAG-001'), true);
select set_config('test.fg', pg_temp.item('FG-TRY-001'), true);
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 0, 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'INVALID_JOB_QTY', 'a zero quantity is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 'NaN', 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'INVALID_JOB_QTY', 'a NaN quantity is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 1000000001, 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'INVALID_JOB_QTY', 'a huge quantity is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, null, 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'INVALID_JOB_QTY', 'a quantity is required');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', repeat('n', 1001))$$, current_setting('test.wo'), current_setting('test.rbl')), 'INVALID_JOB_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo_draft'), current_setting('test.rbl')), 'JOB_WORK_ORDER_NOT_RELEASED', 'a production order without a work order has no jobs');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, '81000000-0000-0000-0000-00000000dead', current_setting('test.rbl')), 'JOB_WORK_ORDER_UNKNOWN', 'an unknown production order is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, '81000000-0000-0000-0000-00000000a001', current_setting('test.rbl')), 'JOB_WORK_ORDER_UNKNOWN', 'test mode cannot create a job for a real production order');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), '81000000-0000-0000-0000-00000000dead'), 'JOB_ITEM_UNKNOWN', 'an unknown item is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), '81000000-0000-0000-0000-00000000f001'), 'JOB_ITEM_UNKNOWN', 'test mode cannot use a real item');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), pg_temp.item('RM-TRY-NR-001')), 'JOB_ITEM_INVALID', 'a raw material cannot be produced');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), pg_temp.item('WIP-TRY-RBP-002')), 'JOB_BOM_INVALID', 'an item whose BOM is still a draft cannot be produced');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'NOPE', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'JOB_WAREHOUSE_UNKNOWN', 'an unknown warehouse is rejected');
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, null, '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'JOB_WAREHOUSE_UNKNOWN', 'a warehouse is required');
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'PRODUCTION_PLANNING_ONLY', 'sales cannot create jobs');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 10, 'SR', '')$$, current_setting('test.wo'), current_setting('test.rbl')), 'PRODUCTION_PLANNING_ONLY', 'the production line cannot create its own jobs');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);

-- 6. สายยาง RB → SR → QC: ใบงานยางเส้นยาว 100 กก. ---------------------------------------------
select set_config('test.j1', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, ' sr ', ' ยางล็อตแรก ')) ->> 'id', true);
select is(pg_temp.job(current_setting('test.j1')) ->> 'code', 'TEST-JB-' || current_setting('test.yy') || '-001', 'the first job number uses the test series');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'open', 'a new job is open');
select is(pg_temp.job(current_setting('test.j1')) ->> 'warehouse_code', 'SR', 'the output warehouse is trimmed and upper-cased');
select is(pg_temp.job(current_setting('test.j1')) ->> 'note', 'ยางล็อตแรก', 'the note is trimmed');
select is(jsonb_array_length(pg_temp.job(current_setting('test.j1')) -> 'steps'), 15, 'the 15 routing steps are copied');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 0 ->> 'name', 'RB-01 ชั่งเคมี', 'the first step is weighing the chemicals');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 13 ->> 'department_code', 'SR', 'step 14 belongs to SR');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 14 ->> 'department_code', 'QA', 'the QC step belongs to the QA department');
select is((pg_temp.job(current_setting('test.j1')) -> 'steps' -> 3 ->> 'run_minutes')::numeric, 240::numeric, 'the four-hour rest is copied');
select is(pg_temp.stock('RM-TRY-NR-001'), 1500::numeric, 'creating a job does not touch the stock');

select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, '', null)$$, current_setting('test.j1')), 'JOB_STEP_DEPARTMENT_ONLY', 'planning cannot run a production step');
select public.app_sandbox_enter(current_setting('test.p_GR')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, '', null)$$, current_setting('test.j1')), 'JOB_STEP_DEPARTMENT_ONLY', 'GR cannot run an RB step');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 20, '', null)$$, current_setting('test.j1')), 'JOB_STEP_OUT_OF_ORDER', 'steps must be done in order');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 999, '', null)$$, current_setting('test.j1')), 'JOB_STEP_NOT_FOUND', 'an unknown step is rejected');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 7, 10, '', null)$$, current_setting('test.j1')), 'JOB_VERSION_CONFLICT', 'a stale version is refused');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, repeat('n', 1001), null)$$, current_setting('test.j1')), 'INVALID_JOB_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, '', 5)$$, current_setting('test.j1')), 'INVALID_JOB_OUTPUT_QTY', 'an output quantity is only allowed on the last step');
select throws_ok($$select public.app_factory_complete_job_step('81000000-0000-0000-0000-00000000c001', 1, 10, '', null)$$, 'JOB_NOT_FOUND', 'test mode cannot touch a real job');
select is(pg_temp.stock('RM-TRY-NR-001'), 1500::numeric, 'refused attempts consume nothing');

-- FIFO: เพิ่มล็อตยางที่เก่ากว่า (ใส่แบบงานระบบ) แล้วตรวจว่าตัดล็อตเก่าก่อน
reset role;
insert into public.factory_lots (id, is_test, item_id, lot_number, received_date)
values ('81000000-0000-0000-0000-0000000010a1', true, current_setting('test.rbl')::uuid, 'LOT-OLD-STRIP', current_date - 10);
insert into public.factory_lots (id, is_test, item_id, lot_number, received_date)
select '81000000-0000-0000-0000-0000000010a2', true, i.id, 'LOT-OLD-NR', current_date - 10 from public.factory_items i where i.is_test and i.code = 'RM-TRY-NR-001';
insert into public.factory_inventory_movements (is_test, item_id, warehouse_id, lot_id, quantity, kind, reference)
select true, i.id, w.id, '81000000-0000-0000-0000-0000000010a2', 10, 'receipt', 'ล็อตเก่า'
from public.factory_items i join public.factory_warehouses w on w.is_test and w.code = 'RM' where i.is_test and i.code = 'RM-TRY-NR-001';
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(pg_temp.stock('RM-TRY-NR-001'), 1510::numeric, 'the old lot adds ten kilograms of rubber');

select is(pg_temp.run(current_setting('test.j1'), 1, 13), 13, 'RB completes steps RB-01 to RB-13');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'in_progress', 'the job is in progress after the first step');
select is(pg_temp.stock('RM-TRY-NR-001'), 1446.76::numeric, 'the first step issued 63.24 kg of rubber (62 × 100 ÷ 100 × 1.02)');
select is(pg_temp.stock('RM-TRY-CB-001'), 392::numeric, 'carbon black 28 kg was issued');
select is(pg_temp.stock('RM-TRY-ZNO-001'), 86::numeric, 'zinc oxide 4 kg was issued');
select is(pg_temp.stock('RM-TRY-ACC-001'), 6.5::numeric, 'the accelerator 1.5 kg was issued');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 260::numeric, 'no output before the last step');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'in_progress', 'the production order is in progress after the first step of any job');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, '', null)$$, current_setting('test.j1')), 'JOB_VERSION_CONFLICT', 'redoing a step with the old version is refused');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 14, 10, '', null)$$, current_setting('test.j1')), 'JOB_STEP_ALREADY_DONE', 'a finished step cannot be done again');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 14, 140, '', null)$$, current_setting('test.j1')), 'JOB_STEP_DEPARTMENT_ONLY', 'RB cannot do the SR step');
select public.app_sandbox_enter(current_setting('test.p_SR')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 14, 150, '', null)$$, current_setting('test.j1')), 'JOB_STEP_OUT_OF_ORDER', 'the QC step waits for SR');
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 14, 140, 'รับเข้าคลัง SR แล้ว', null)$$, current_setting('test.j1')), 'SR receives the long strip');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 260::numeric, 'still no output before QC finishes');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 15, 150, '', 0)$$, current_setting('test.j1')), 'INVALID_JOB_OUTPUT_QTY', 'a zero output is rejected');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 15, 150, '', 'NaN')$$, current_setting('test.j1')), 'INVALID_JOB_OUTPUT_QTY', 'a NaN output is rejected');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 15, 150, '', 1000000001)$$, current_setting('test.j1')), 'INVALID_JOB_OUTPUT_QTY', 'a huge output is rejected');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'in_progress', 'failed attempts leave the job unfinished');
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 15, 150, 'ขนาดผ่าน 95 กก.', 95)$$, current_setting('test.j1')), 'QC checks the size and the yield is 95 kg');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'completed', 'the job is completed');
select is((pg_temp.job(current_setting('test.j1')) ->> 'output_qty')::numeric, 95::numeric, 'the actual yield is recorded');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 355::numeric, 'the long strip is received into the stock (260 + 95)');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'inventory') x
           where x ->> 'code' = 'WIP-TRY-RBL-001' and x ->> 'warehouse' = 'คลังยางเส้นยาว (SR)' and x ->> 'lot_number' = 'LOT-TEST-JB-' || current_setting('test.yy') || '-001')::integer, 1,
  'the output is in the SR warehouse under a lot named after the job');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 14 ->> 'note', 'ขนาดผ่าน 95 กก.', 'the QC note is kept on the step');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 16, 150, '', null)$$, current_setting('test.j1')), 'JOB_NOT_ACTIVE', 'a completed job has no more steps');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 16, 'ผิด')$$, current_setting('test.j1')), 'JOB_NOT_CANCELLABLE', 'a completed job cannot be cancelled');

-- 7. FIFO ล็อต: ตรวจจากรายการตัดยางของใบงานแรก ---------------------------------------------------
reset role;
select is((select string_agg(l.lot_number || ':' || (-m.quantity)::text, ',' order by l.lot_number)
           from public.factory_inventory_movements m join public.factory_lots l on l.id = m.lot_id
           join public.factory_items i on i.id = m.item_id
           where m.is_test and m.kind = 'production_issue' and i.code = 'RM-TRY-NR-001'),
  'LOT-OLD-NR:10.0000,LOT-TRY-002:53.2400', 'the oldest lot is emptied first (10 kg) and only the rest is taken from the next lot');
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 8. สาย GR / PT / BG: ชิ้นงานยางแปรรูป ชิ้นงานพลาสติก กระเป๋า (ใช้ของจากสายอื่นตามยอดคงคลัง) -------------------
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select set_config('test.j2', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbp')::uuid, 12, 'WIP', '')) ->> 'id', true);
select set_config('test.j3', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.ptp')::uuid, 12, 'WIP', '')) ->> 'id', true);
select set_config('test.j4', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.bag')::uuid, 12, 'WIP', '')) ->> 'id', true);
select is(jsonb_array_length(pg_temp.job(current_setting('test.j2')) -> 'steps'), 4, 'the rubber part job has the four GR steps');
select is(jsonb_array_length(pg_temp.job(current_setting('test.j3')) -> 'steps'), 2, 'the plastic part job has the two PT steps');
select is(jsonb_array_length(pg_temp.job(current_setting('test.j4')) -> 'steps'), 2, 'the bag job has the two BG steps');
select public.app_sandbox_enter(current_setting('test.p_GR')::uuid);
select is(pg_temp.run(current_setting('test.j2'), 1, 4), 4, 'GR cuts, glues, grinds and sorts');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 354.382::numeric, 'GR issued 0.618 kg of the long strip made by RB (5 × 12 ÷ 100 × 1.03)');
select is(pg_temp.stock('RM-TRY-GLUE-001'), 59.97::numeric, 'GR issued 0.03 kg of glue');
select is(pg_temp.stock('WIP-TRY-RBP-001'), 12::numeric, 'the processed rubber parts are received');
select public.app_sandbox_enter(current_setting('test.p_PT')::uuid);
select is(pg_temp.run(current_setting('test.j3'), 1, 2), 2, 'PT forms the plastic caps');
select is(pg_temp.stock('RM-TRY-PP-001'), 649.694::numeric, 'PT issued 0.306 kg of resin');
select is(pg_temp.stock('WIP-TRY-PTP-001'), 12::numeric, 'the plastic parts are received');
select public.app_sandbox_enter(current_setting('test.p_BG')::uuid);
select is(pg_temp.run(current_setting('test.j4'), 1, 2), 2, 'BG sews the bags');
select is(pg_temp.stock('RM-TRY-FAB-001'), 212.584::numeric, 'BG issued 7.416 sheets of canvas');
select is(pg_temp.stock('WIP-TRY-BAG-001'), 12::numeric, 'twelve bags are received');

-- 9. PK ประกอบ: ยอดชิ้นงานไม่พอ (กระเป๋า 12.12 ที่ต้องใช้ มี 12) ต้องไม่ตัดอะไรเลย แล้วเติมกระเป๋าอีกใบงาน -----------
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select set_config('test.j5', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.fg')::uuid, 12, 'fg', '')) ->> 'id', true);
select is(pg_temp.job(current_setting('test.j5')) ->> 'code', 'TEST-JB-' || current_setting('test.yy') || '-005', 'job numbers count up in the test series');
select is(jsonb_array_length(pg_temp.job(current_setting('test.j5')) -> 'steps'), 6, 'the finished good job has PK-01..05 and WH-01');
select public.app_sandbox_enter(current_setting('test.p_PK')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 1, 10, '', null)$$, current_setting('test.j5')), 'JOB_INSUFFICIENT_STOCK', 'assembly cannot start when the bags are short');
select is(pg_temp.stock('WIP-TRY-RBP-001'), 12::numeric, 'nothing was issued: the rubber parts are still there');
select is(pg_temp.stock('WIP-TRY-PTP-001'), 12::numeric, 'nothing was issued: the plastic parts are still there');
select is(pg_temp.job(current_setting('test.j5')) ->> 'status', 'open', 'the job is still open');
select is(pg_temp.job(current_setting('test.j5')) -> 'steps' -> 0 ->> 'status', 'pending', 'and the first step is still pending');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select set_config('test.j6', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.bag')::uuid, 1, 'WIP', '')) ->> 'id', true);
select set_config('test.jc', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.bag')::uuid, 3, 'WIP', '')) ->> 'id', true);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 9, 'ผิด')$$, current_setting('test.jc')), 'JOB_VERSION_CONFLICT', 'cancelling a stale version is refused');
select lives_ok(format($$select public.app_factory_cancel_job(%L::uuid, 1, 'ออกใบงานผิดจำนวน')$$, current_setting('test.jc')), 'an untouched job can be cancelled with a reason');
select is(pg_temp.job(current_setting('test.jc')) ->> 'status', 'cancelled', 'the job is cancelled');
select is(pg_temp.job(current_setting('test.jc')) ->> 'cancel_note', 'ออกใบงานผิดจำนวน', 'the reason is kept');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 2, 'อีกครั้ง')$$, current_setting('test.jc')), 'JOB_NOT_CANCELLABLE', 'a cancelled job cannot be cancelled again');
select public.app_sandbox_enter(current_setting('test.p_BG')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 2, 10, '', null)$$, current_setting('test.jc')), 'JOB_NOT_ACTIVE', 'a cancelled job has no steps to run');
select is(pg_temp.stock('RM-TRY-FAB-001'), 212.584::numeric, 'a cancelled job consumed nothing');
select is(pg_temp.run(current_setting('test.j6'), 1, 2), 2, 'a second bag job adds one more bag');
select is(pg_temp.stock('WIP-TRY-BAG-001'), 13::numeric, 'thirteen bags are in stock');

select public.app_sandbox_enter(current_setting('test.p_PK')::uuid);
select is(pg_temp.run(current_setting('test.j5'), 1, 5), 5, 'PK receives the parts, assembles, bags and boxes them, then hands over to WH');
select is(pg_temp.stock('WIP-TRY-RBP-001'), 0::numeric, 'the rubber parts were issued');
select is(pg_temp.stock('WIP-TRY-PTP-001'), 0::numeric, 'the plastic parts were issued');
select is(pg_temp.stock('WIP-TRY-BAG-001'), 0.88::numeric, 'the bags were issued (12 × 1.01 = 12.12)');
select is(pg_temp.stock('PKG-TRY-BOX-001'), 399::numeric, 'one box was issued');
select is(pg_temp.stock('FG-TRY-001'), 0::numeric, 'no finished goods before WH receives them');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'in_progress', 'the production order is not done yet');
select public.app_sandbox_enter(current_setting('test.p_WH')::uuid);
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, 6, 60, 'รับเข้าคลังสินค้าสำเร็จรูป', null)$$, current_setting('test.j5')), 'WH receives the finished goods');
select is(pg_temp.stock('FG-TRY-001'), 12::numeric, 'twelve finished sets are in stock');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'inventory') x
           where x ->> 'code' = 'FG-TRY-001' and x ->> 'warehouse' = 'คลังสินค้าสำเร็จรูป')::integer, 1, 'they are in the finished goods warehouse');
select is(pg_temp.po(current_setting('test.wo')) ->> 'status', 'completed', 'the production order is completed');
select is((pg_temp.po(current_setting('test.wo')) ->> 'completed_qty')::numeric, 12::numeric, 'with twelve sets produced');

-- 10. ยกเลิกใบงาน -----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 1, 'WIP', '')$$, current_setting('test.wo'), current_setting('test.rbp')), 'JOB_WORK_ORDER_NOT_RELEASED', 'a completed production order accepts no new jobs');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 3, '   ')$$, current_setting('test.j6')), 'JOB_CANCEL_NOTE_REQUIRED', 'a reason is required to cancel');
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 3, 'x')$$, current_setting('test.j6')), 'JOB_NOT_CANCELLABLE', 'a job that has run cannot be cancelled');
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select throws_ok(format($$select public.app_factory_cancel_job(%L::uuid, 1, 'x')$$, current_setting('test.j1')), 'PRODUCTION_PLANNING_ONLY', 'sales cannot cancel a job');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);

-- 11. ข้อมูลที่หน้าเว็บอ่านและประวัติ -------------------------------------------------------------
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x where x ->> 'job_id' = current_setting('test.j4')),
  'create,step,complete', 'the bag job history shows create, step and complete');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x where x ->> 'job_id' = current_setting('test.j1') and x ->> 'action' = 'step')::integer, 14, 'the first job has fourteen step entries');
select is((select count(*) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x where x ->> 'job_id' = current_setting('test.j1') and x ->> 'action' = 'complete')::integer, 1, 'and one complete entry');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'production_history') x where x ->> 'order_id' = current_setting('test.wo')),
  'create,submit,receive,plan,release,start,finish', 'the production order history shows start and finish');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x where x ->> 'job_id' = current_setting('test.jc')), 'create,cancel', 'the cancelled job history shows create and cancel');
select is(jsonb_array_length(public.app_factory_master_data() -> 'jobs'), 7, 'seven jobs are listed (one cancelled)');

-- 12. ใบสั่งผลิตที่ยังไม่ออกใบสั่งงานออกใบงานไม่ได้ (MO-TRY-001 ของชุดทดลองสถานะ planned) ------------------
select throws_ok(format($$select public.app_factory_create_job(%L::uuid, %L::uuid, 5, 'SR', '')$$,
  (select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'production') x where x ->> 'code' = 'MO-TRY-001'), current_setting('test.rbl')),
  'JOB_WORK_ORDER_NOT_RELEASED', 'a planned production order cannot have jobs');
select public.app_sandbox_exit();
reset role;

-- 13. การแยกโหมดทดสอบ ประวัติ และ audit --------------------------------------------------
select is((select count(*) from public.factory_jobs where not is_test)::integer, 1, 'only the real job is not test data');
select is((select status from public.factory_jobs where id = '81000000-0000-0000-0000-00000000c001'), 'open', 'the real job was never touched');
select is((select status from public.factory_job_steps where job_id = '81000000-0000-0000-0000-00000000c001'), 'pending', 'nor was its step');
select is((select count(*) from public.factory_job_history where not is_test)::integer, 0, 'no real job history is written');
select is((select count(*) from public.factory_inventory_movements where not is_test)::integer, 0, 'jobs never write a real stock movement');
select is((select count(*) from public.factory_inventory_movements where is_test and kind = 'production_output')::integer, 6, 'six completed jobs produced six outputs');
select ok((select count(*) from public.factory_inventory_movements where is_test and kind = 'production_issue') > 0, 'material issues were written');
select is((select count(*) from public.audit_logs where action like 'FACTORY_JOB_%')::integer, (select count(*) from public.factory_job_history)::integer, 'every job history entry has an audit entry');
select is((select actor_id from public.audit_logs where action = 'FACTORY_JOB_COMPLETE' order by id limit 1), '81000000-0000-0000-0000-000000000101'::uuid, 'the audit log names the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_JOB_COMPLETE' and metadata ->> 'code' = 'TEST-JB-' || current_setting('test.yy') || '-005'), 'SBX-WH-STAFF', 'the audit log names the persona who finished the assembly');
select is((select snapshot ->> 'status' from public.factory_job_history where action = 'complete' and snapshot ->> 'code' = 'TEST-JB-' || current_setting('test.yy') || '-001'), 'completed', 'the snapshot keeps the status');
select is(jsonb_array_length((select snapshot -> 'steps' from public.factory_job_history where action = 'complete' and snapshot ->> 'code' = 'TEST-JB-' || current_setting('test.yy') || '-001')), 15, 'and the steps');
select is((select last_number from public.document_counters where department_code = 'FACTORY-JB-TEST' and year_key = current_setting('test.yy')), 7, 'the test job counter advanced seven times');
select is((select count(*) from public.document_counters where department_code = 'FACTORY-JB')::integer, 0, 'no real counter is created');
select set_config('request.jwt.claims', '', true);
select throws_ok($$insert into public.factory_job_steps (is_test, job_id, sequence, name, work_center_code) values (true, '81000000-0000-0000-0000-00000000c001', 20, 'x', 'RB')$$,
  '23503', null, 'a test step cannot reference a real job (paired foreign key)');

-- 14. ล้างข้อมูลทดสอบ -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"81000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'purge removes the test data including the jobs');
select is(public.app_factory_master_data() -> 'jobs', '[]'::jsonb, 'no jobs remain');
select is(public.app_factory_master_data() -> 'job_history', '[]'::jsonb, 'no job history remains');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_jobs where not is_test)::integer, 1, 'purge never touches the real job');
select is((select count(*) from public.document_counters where department_code = 'FACTORY-JB-TEST')::integer, 0, 'the counter was reset by the purge');

select * from finish();
rollback;
