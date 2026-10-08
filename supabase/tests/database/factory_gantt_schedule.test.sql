-- ฝ่ายโรงงาน: ตารางเวลาการผลิต (Gantt) ระดับใบงาน + ปฏิทินกะ/กำลังการผลิตของศูนย์งาน (20261008010000_factory_gantt_schedule.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ การปฏิเสธนอกโหมดทดสอบ สิทธิ์ตามบทบาท (PP / ผจก.ทั่วไป / ผจก.โรงงาน / ผู้ช่วย ผจก.โรงงาน อนุญาต · แผนกอื่นอ่านอย่างเดียว)
-- การตรวจวันที่ทุกช่อง การล็อก schedule_version แยกจาก version ของใบงาน ใบที่ยกเลิก/จบแล้ว ความสัมพันธ์ลำดับตาม BOM
-- ปฏิทินกะ (ค่าที่ไม่ถูกต้อง ล็อก ปรับวันซ้ำ) ประวัติ audit การแยกโหมดทดสอบ และการล้างข้อมูล
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'factory_jobs'
           and column_name in ('planned_start', 'planned_end', 'schedule_version', 'scheduled_by', 'scheduled_at')) = 5, 'jobs carry the planned dates and the schedule lock');
select ok((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'factory_work_centers'
           and column_name in ('shift_start', 'shift_end', 'break_minutes', 'working_days', 'units', 'efficiency_percent', 'calendar_version')) = 7, 'work centers carry the shift calendar');
select ok(not exists (
    select 1 from unnest(array['factory_jobs', 'factory_work_centers']) t(name),
                  unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated still have no direct privilege on the tables that hold the schedule');
select ok(not has_function_privilege('anon', 'public.app_factory_schedule_job(uuid,integer,date,date,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_save_work_center_calendar(text,integer,time without time zone,time without time zone,integer,integer[],integer,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_schedule_data()', 'execute'), 'anon cannot call the schedule API');
select ok(has_function_privilege('authenticated', 'public.app_factory_schedule_job(uuid,integer,date,date,text)', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_schedule_data()', 'execute'), 'signed-in users can call the API (it checks mode and role itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_schedule_actor()', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_can_schedule(public.employees)', 'execute'), 'clients cannot call the schedule helpers');
select throws_ok($$insert into public.factory_work_centers (code, name, shift_start, shift_end) values ('GT1', 'x', time '17:00', time '08:00')$$, '23514', null, 'a shift must end after it starts');
select throws_ok($$insert into public.factory_work_centers (code, name, break_minutes) values ('GT2', 'x', 540)$$, '23514', null, 'a break cannot swallow the whole shift');
select throws_ok($$insert into public.factory_work_centers (code, name, working_days) values ('GT3', 'x', array[]::smallint[])$$, '23514', null, 'a work center needs at least one working day');
select throws_ok($$insert into public.factory_work_centers (code, name, working_days) values ('GT4', 'x', array[0, 8]::smallint[])$$, '23514', null, 'working days are 1 to 7');
select throws_ok($$insert into public.factory_work_centers (code, name, efficiency_percent) values ('GT5', 'x', 100.01)$$, '23514', null, 'efficiency cannot exceed 100 percent');
select throws_ok($$insert into public.factory_work_centers (code, name, units) values ('GT6', 'x', 0)$$, '23514', null, 'a work center needs at least one machine');
select is((select count(*) from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and e.employee_no = 'SBX-FT-AFM' and d.code = 'FT' and r.code = 'assistant_factory_manager'
             and not e.is_active and e.auth_user_id is null)::integer, 1, 'the assistant factory manager persona exists and cannot log in');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ ------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('82000000-0000-0000-0000-000000000001', 'gantt-admin@test.local', '{}'),
  ('82000000-0000-0000-0000-000000000002', 'gantt-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('82000000-0000-0000-0000-000000000101', 'GANTT-ADMIN', 'Gantt', 'Admin', 'gantt-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '82000000-0000-0000-0000-000000000001'),
  ('82000000-0000-0000-0000-000000000102', 'GANTT-STAFF', 'Gantt', 'Staff', 'gantt-staff@test.local',
   (select id from public.departments where code = 'RB'), (select id from public.roles where code = 'staff'), '82000000-0000-0000-0000-000000000002');
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ): ใบงานจริงหนึ่งใบกับศูนย์งานจริงหนึ่งแห่ง ใช้ตรวจว่าโหมดทดสอบมองไม่เห็นและแตะไม่ได้
insert into public.factory_items (id, code, name, item_type, category_code, brand, unit_code, procurement)
values ('82000000-0000-0000-0000-00000000f001', 'REAL-GT-FG', 'สินค้าจริง', 'FG', 'mat', 'MNP', 'PCS', 'make');
insert into public.factory_boms (id, item_id, revision, output_qty, status, effective_date, decided_at)
values ('82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-00000000f001', 'A', 1, 'approved', date '2026-10-01', now());
insert into public.factory_routings (id, item_id, revision, status) values ('82000000-0000-0000-0000-00000000d001', '82000000-0000-0000-0000-00000000f001', 'A', 'draft');
insert into public.factory_warehouses (id, code, name) values ('82000000-0000-0000-0000-00000000e001', 'RM', 'คลังจริง');
insert into public.factory_work_centers (id, code, name) values ('82000000-0000-0000-0000-00000000c0c1', 'REAL-WC', 'ศูนย์งานจริง');
insert into public.factory_production_orders (id, code, item_id, bom_id, routing_id, planned_qty, status, due_date)
values ('82000000-0000-0000-0000-00000000a001', 'REAL-MO-GT', '82000000-0000-0000-0000-00000000f001', '82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-00000000d001', 5, 'released', current_date + 5);
insert into public.factory_jobs (id, code, production_order_id, item_id, bom_id, routing_id, warehouse_id, qty)
values ('82000000-0000-0000-0000-00000000c001', 'REAL-GT-001', '82000000-0000-0000-0000-00000000a001', '82000000-0000-0000-0000-00000000f001',
        '82000000-0000-0000-0000-00000000b001', '82000000-0000-0000-0000-00000000d001', '82000000-0000-0000-0000-00000000e001', 5);
select set_config('test.p_' || replace(substr(employee_no, 5), '-', '_'), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-QA-STAFF', 'SBX-FT-FM', 'SBX-FT-AFM', 'SBX-MGT-GM', 'SBX-RB-MGR', 'SBX-PK-STAFF');
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;
create function pg_temp.mjob(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.sjob(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_schedule_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.center(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_schedule_data() -> 'work_centers') x where x ->> 'code' = $1 $$;
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_schedule_data()$$, 'AUTH_REQUIRED', 'reading the schedule needs a session');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_schedule_data()$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot read the schedule (real mode is not open)');
select throws_ok($$select public.app_factory_schedule_job('82000000-0000-0000-0000-00000000c001', 1, current_date, current_date + 1, '')$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot schedule a job');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 1, 100)$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot change a calendar');
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_schedule_job('82000000-0000-0000-0000-00000000c001', 1, current_date, current_date + 1, '')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot schedule a job');

-- 4. เตรียมใบสั่งผลิตที่ออกใบสั่งงานแล้ว + ใบงานยางเส้นยาว/ชิ้นงานยาง (ชิ้นงานยางใช้ยางเส้นยาว) -----------------
select public.app_sandbox_enter(current_setting('test.p_SA_STAFF')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('WIP-TRY-RBL-001'), pg_temp.approve('WIP-TRY-RBP-001')$$, 'the BOMs of the finished good, the long rubber and the rubber part are approved');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-001')::uuid, 12, current_setting('test.due')::date, 'บริษัท ลูกค้า จำกัด', '')) ->> 'id', true);
select lives_ok(format($$select public.app_factory_submit_production_order(%L::uuid, 1)$$, current_setting('test.wo')), 'sales sends the order');
select public.app_sandbox_enter(current_setting('test.p_PP_STAFF')::uuid);
select lives_ok(format($$select public.app_factory_receive_production_order(%L::uuid, 2)$$, current_setting('test.wo')), 'planning receives it');
select lives_ok(format($$select public.app_factory_plan_production_order(%L::uuid, 3, %L::uuid, %L::uuid, 'พอ')$$, current_setting('test.wo'), pg_temp.bom('FG-TRY-001'), pg_temp.routing('FG-TRY-001')), 'planning plans it');
select lives_ok(format($$select public.app_factory_release_production_order(%L::uuid, 4)$$, current_setting('test.wo')), 'planning issues the work order');
select set_config('test.j_rbl', (public.app_factory_create_job(current_setting('test.wo')::uuid, pg_temp.item('WIP-TRY-RBL-001')::uuid, 100, 'SR', '')) ->> 'id', true);
select set_config('test.j_rbp', (public.app_factory_create_job(current_setting('test.wo')::uuid, pg_temp.item('WIP-TRY-RBP-001')::uuid, 12, 'WIP', '')) ->> 'id', true);
select set_config('test.j_cancel', (public.app_factory_create_job(current_setting('test.wo')::uuid, pg_temp.item('WIP-TRY-RBL-001')::uuid, 5, 'SR', '')) ->> 'id', true);
select set_config('test.today', ((now() at time zone 'Asia/Bangkok')::date)::text, true);

-- 5. อ่านข้อมูล: ใบงานยังไม่มีตาราง ออเดอร์ลูกค้าเป็นกรอบของใบงาน ------------------------------------
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, true, 'planning can edit the schedule');
select is(jsonb_array_length(public.app_factory_schedule_data() -> 'orders'), 1, 'one customer order has jobs');
select is((public.app_factory_schedule_data() -> 'orders' -> 0 ->> 'customer'), 'บริษัท ลูกค้า จำกัด', 'the order carries the customer');
select is(jsonb_array_length(public.app_factory_schedule_data() -> 'jobs'), 3, 'all three jobs are listed');
select is(pg_temp.sjob(current_setting('test.j_rbl')) -> 'planned_start', 'null'::jsonb, 'a new job has no planned start');
select is((pg_temp.sjob(current_setting('test.j_rbl')) ->> 'schedule_version')::integer, 1, 'and the first schedule version');
select is((pg_temp.sjob(current_setting('test.j_rbl')) ->> 'bom_output_qty')::numeric, 100::numeric, 'the BOM batch size comes with the job (load = batches x run time)');
select ok(pg_temp.sjob(current_setting('test.j_rbp')) -> 'needs' @> to_jsonb(current_setting('test.j_rbl')), 'the rubber part job needs the long rubber job (its BOM uses it)');
select is(pg_temp.sjob(current_setting('test.j_rbl')) -> 'needs', '[]'::jsonb, 'the long rubber job needs no other job');
select ok(jsonb_array_length(pg_temp.sjob(current_setting('test.j_rbl')) -> 'steps') > 0, 'the job comes with its steps and work centers');
select ok(jsonb_array_length(public.app_factory_schedule_data() -> 'work_centers') > 0, 'the work centers come with their calendars');
select is(pg_temp.center('RB') ->> 'shift_start', '08:00', 'the default shift starts at 08:00');
select is(pg_temp.center('RB') -> 'working_days', '[1, 2, 3, 4, 5]'::jsonb, 'and the default working days are Monday to Friday');

-- 6. กำหนดตารางเวลา: ตรวจค่าทุกช่อง ---------------------------------------------------------
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, null, current_date + 3, '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'a start date is required');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, null, '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'an end date is required');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date + 3, current_date, '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'the end cannot be before the start');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 366, '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'a window longer than 365 days is rejected');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, date '2019-12-31', date '2020-01-02', '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'dates before 2020 are rejected');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, date '2100-12-30', date '2101-01-02', '')$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_DATES', 'dates after 2100 are rejected');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, repeat('n', 1001))$$, current_setting('test.j_rbl')), 'INVALID_SCHEDULE_NOTE', 'a long note is rejected');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, null, current_date, current_date + 1, '')$$, current_setting('test.j_rbl')), 'SCHEDULE_STALE', 'a schedule version is required');
select throws_ok($$select public.app_factory_schedule_job('82000000-0000-0000-0000-00000000dead', 1, current_date, current_date + 1, '')$$, 'SCHEDULE_TARGET_UNKNOWN', 'an unknown job is rejected');
select throws_ok($$select public.app_factory_schedule_job('82000000-0000-0000-0000-00000000c001', 1, current_date, current_date + 1, '')$$, 'SCHEDULE_TARGET_UNKNOWN', 'test mode cannot schedule a real job');

-- 7. สิทธิ์ตามบทบาท: ผู้มีสิทธิ์แก้ได้ แผนกอื่นอ่านอย่างเดียว ------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_RB_STAFF')::uuid);
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, false, 'a production line employee can read but not edit');
select ok(jsonb_array_length(public.app_factory_schedule_data() -> 'jobs') = 3, 'and sees the same jobs');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, '')$$, current_setting('test.j_rbl')), 'SCHEDULE_NOT_ALLOWED', 'a production line employee cannot schedule a job');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 1, 100)$$, 'SCHEDULE_NOT_ALLOWED', 'nor change a calendar');
select public.app_sandbox_enter(current_setting('test.p_SA_STAFF')::uuid);
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, '')$$, current_setting('test.j_rbl')), 'SCHEDULE_NOT_ALLOWED', 'sales cannot schedule a job');
select public.app_sandbox_enter(current_setting('test.p_RB_MGR')::uuid);
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, '')$$, current_setting('test.j_rbl')), 'SCHEDULE_NOT_ALLOWED', 'a department manager outside planning cannot schedule a job');
select public.app_sandbox_enter(current_setting('test.p_QA_STAFF')::uuid);
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, false, 'QA reads the schedule read-only');

-- 8. PP กำหนดตาราง · ใบงานยางเส้นยาวก่อน ยางชิ้นงานตามหลัง ------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_PP_STAFF')::uuid);
select is(public.app_factory_schedule_job(current_setting('test.j_rbl')::uuid, 1, current_setting('test.today')::date + 1, current_setting('test.today')::date + 3, ' เริ่มสัปดาห์หน้า ') ->> 'schedule_version', '2', 'planning schedules the long rubber job and the lock advances');
select is(pg_temp.sjob(current_setting('test.j_rbl')) ->> 'planned_start', (current_setting('test.today')::date + 1)::text, 'the start date is stored');
select is(pg_temp.sjob(current_setting('test.j_rbl')) ->> 'planned_end', (current_setting('test.today')::date + 3)::text, 'and the end date');
select is((pg_temp.mjob(current_setting('test.j_rbl')) ->> 'version')::integer, 1, 'scheduling does not change the job version (steps keep their own lock)');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, '')$$, current_setting('test.j_rbl')), 'SCHEDULE_STALE', 'an old schedule version is rejected (someone else moved the bar)');
select is(public.app_factory_schedule_job(current_setting('test.j_rbp')::uuid, 1, current_setting('test.today')::date + 4, current_setting('test.today')::date + 4, '') ->> 'schedule_version', '2', 'a one day job (start = end) is allowed');
select public.app_sandbox_enter(current_setting('test.p_FT_FM')::uuid);
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, true, 'the factory manager can edit');
select is(public.app_factory_schedule_job(current_setting('test.j_rbp')::uuid, 2, current_setting('test.today')::date + 5, current_setting('test.today')::date + 6, 'เลื่อน') ->> 'schedule_version', '3', 'the factory manager can move a bar');
select public.app_sandbox_enter(current_setting('test.p_FT_AFM')::uuid);
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, true, 'the assistant factory manager can edit');
select is(public.app_factory_schedule_job(current_setting('test.j_rbp')::uuid, 3, current_setting('test.today')::date + 5, current_setting('test.today')::date + 7, 'ขยาย') ->> 'schedule_version', '4', 'the assistant factory manager can move a bar');
select public.app_sandbox_enter(current_setting('test.p_MGT_GM')::uuid);
select is((public.app_factory_schedule_data() ->> 'can_edit')::boolean, true, 'the general manager can edit');
select is(public.app_factory_schedule_job(current_setting('test.j_rbp')::uuid, 4, current_setting('test.today')::date + 5, current_setting('test.today')::date + 8, 'ขยายอีก') ->> 'schedule_version', '5', 'the general manager can move a bar');

-- 9. การทำขั้นตอนไม่ชนกับการย้ายแถบ · ใบที่ยกเลิก/ไม่มีอยู่ ---------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_RB_STAFF')::uuid);
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j_rbl'), (pg_temp.mjob(current_setting('test.j_rbl')) ->> 'version')),
  'the production line finishes a step after the bar was scheduled (no version conflict)');
select public.app_sandbox_enter(current_setting('test.p_PP_STAFF')::uuid);
select is(public.app_factory_schedule_job(current_setting('test.j_rbl')::uuid, 2, current_setting('test.today')::date + 1, current_setting('test.today')::date + 4, 'งานเริ่มแล้วขยายเวลา') ->> 'schedule_version', '3', 'a job already in progress can be rescheduled');
select lives_ok(format($$select public.app_factory_cancel_job(%L::uuid, 1, 'ยกเลิกทดสอบ')$$, current_setting('test.j_cancel')), 'planning cancels the spare job');
select throws_ok(format($$select public.app_factory_schedule_job(%L::uuid, 1, current_date, current_date + 1, '')$$, current_setting('test.j_cancel')), 'SCHEDULE_JOB_FINISHED', 'a cancelled job cannot be scheduled');
select is(pg_temp.sjob(current_setting('test.j_cancel')), null, 'and a cancelled job is not on the chart');
select is(jsonb_array_length(public.app_factory_schedule_data() -> 'jobs'), 2, 'two jobs remain on the chart');

-- 10. ปฏิทินกะของศูนย์งาน --------------------------------------------------------------------
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, null, '17:00', 60, array[1], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'a shift start is required');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '17:00', '08:00', 60, array[1], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'a shift cannot end before it starts');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 540, array[1], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'a break as long as the shift is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', -1, array[1], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'a negative break is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[]::integer[], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'at least one working day is needed');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[0, 1], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'day 0 is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1, 8], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'day 8 is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1, null], 1, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'a null day is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 0, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'zero machines is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 101, 100)$$, 'INVALID_WORK_CENTER_CALENDAR', 'more than 100 machines is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 1, 0)$$, 'INVALID_WORK_CENTER_CALENDAR', 'zero efficiency is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 1, 100.5)$$, 'INVALID_WORK_CENTER_CALENDAR', 'efficiency over 100 is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 1, '08:00', '17:00', 60, array[1], 1, 'NaN')$$, 'INVALID_WORK_CENTER_CALENDAR', 'NaN efficiency is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('NOPE', 1, '08:00', '17:00', 60, array[1], 1, 100)$$, 'CALENDAR_CENTER_UNKNOWN', 'an unknown work center is rejected');
select throws_ok($$select public.app_factory_save_work_center_calendar('REAL-WC', 1, '08:00', '17:00', 60, array[1], 1, 100)$$, 'CALENDAR_CENTER_UNKNOWN', 'test mode cannot change a real work center');
select throws_ok($$select public.app_factory_save_work_center_calendar('RB', 9, '08:00', '17:00', 60, array[1], 1, 100)$$, 'CALENDAR_STALE', 'a wrong calendar version is rejected');
select is(public.app_factory_save_work_center_calendar(' rb ', 1, '07:30', '19:30', 90, array[6, 1, 1, 2, 3], 2, 85.5) ->> 'calendar_version', '2', 'planning saves the RB calendar (code is trimmed and upper-cased)');
select is(pg_temp.center('RB') -> 'working_days', '[1, 2, 3, 6]'::jsonb, 'working days are de-duplicated and sorted');
select is(pg_temp.center('RB') ->> 'shift_start', '07:30', 'the shift start is stored');
select is((pg_temp.center('RB') ->> 'units')::integer, 2, 'the machines are stored');
select is((pg_temp.center('RB') ->> 'efficiency_percent')::numeric, 85.5, 'and the efficiency');
select is(pg_temp.center('RB') ->> 'updated_by_name', 'ทดสอบ พนักงานวางแผน', 'the calendar names who changed it');
select is(pg_temp.center('GR') ->> 'shift_end', '17:00', 'other work centers keep their calendars');
select public.app_sandbox_enter(current_setting('test.p_FT_AFM')::uuid);
select is(public.app_factory_save_work_center_calendar('RB', 2, '08:00', '17:00', 60, array[1, 2, 3, 4, 5, 6, 7], 1, 100) ->> 'calendar_version', '3', 'the assistant factory manager can also change a calendar');
select public.app_sandbox_exit();
reset role;

-- 11. ประวัติ audit และการแยกโหมดทดสอบ ---------------------------------------------------------
select is((select count(*) from public.factory_job_history where action = 'schedule' and snapshot ->> 'code' = (select code from public.factory_jobs where id = current_setting('test.j_rbp')::uuid))::integer, 4,
  'every schedule change of the rubber part job is in its history');
select is((select snapshot ->> 'planned_end' from public.factory_job_history where action = 'schedule' and job_id = current_setting('test.j_rbp')::uuid order by id desc limit 1),
  (current_setting('test.today')::date + 8)::text, 'the history snapshot keeps the planned dates');
select is((select note from public.factory_job_history where action = 'schedule' and job_id = current_setting('test.j_rbl')::uuid order by id limit 1), 'เริ่มสัปดาห์หน้า', 'the note is trimmed and kept');
select is((select count(*) from public.audit_logs where action = 'FACTORY_JOB_SCHEDULE')::integer, (select count(*) from public.factory_job_history where action = 'schedule')::integer, 'every schedule change has an audit entry');
select is((select actor_id from public.audit_logs where action = 'FACTORY_JOB_SCHEDULE' order by id limit 1), '82000000-0000-0000-0000-000000000101'::uuid, 'the audit log names the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_JOB_SCHEDULE' order by id desc limit 1), 'SBX-PP-STAFF', 'and the persona who moved the bar');
select is((select count(*) from public.audit_logs where action = 'FACTORY_WORK_CENTER_CALENDAR')::integer, 2, 'both calendar changes are audited');
select is((select metadata -> 'before' ->> 'shift_start' from public.audit_logs where action = 'FACTORY_WORK_CENTER_CALENDAR' order by id limit 1), '08:00:00', 'the audit entry keeps the previous shift');
select is((select metadata -> 'after' ->> 'shift_start' from public.audit_logs where action = 'FACTORY_WORK_CENTER_CALENDAR' order by id limit 1), '07:30:00', 'and the new shift');
select is((select count(*) from public.factory_job_history where not is_test)::integer, 0, 'no real job history is written');
select is((select schedule_version from public.factory_jobs where id = '82000000-0000-0000-0000-00000000c001'), 1, 'the real job keeps its schedule version');
select is((select planned_start from public.factory_jobs where id = '82000000-0000-0000-0000-00000000c001'), null, 'and has no planned dates');
select is((select calendar_version from public.factory_work_centers where id = '82000000-0000-0000-0000-00000000c0c1'), 1, 'the real work center keeps its calendar version');
select set_config('request.jwt.claims', '', true);
select throws_ok($$update public.factory_jobs set planned_start = date '2026-10-01', planned_end = date '2026-09-01' where id = '82000000-0000-0000-0000-00000000c001'$$, '23514', null, 'the table itself rejects an end date before the start');
select throws_ok($$update public.factory_jobs set planned_start = date '2026-10-01' where id = '82000000-0000-0000-0000-00000000c001'$$, '23514', null, 'and a start date without an end date');

-- 12. ล้างข้อมูลทดสอบ -------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"82000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_SA_STAFF')::uuid);
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'purge removes the test data including the scheduled jobs');
select is(public.app_factory_schedule_data() -> 'jobs', '[]'::jsonb, 'no jobs remain on the chart');
select is(public.app_factory_schedule_data() -> 'orders', '[]'::jsonb, 'no orders remain on the chart');
select is(public.app_factory_schedule_data() -> 'work_centers', '[]'::jsonb, 'no test work centers remain');
select public.app_sandbox_exit();
reset role;
select is((select count(*) from public.factory_jobs where not is_test)::integer, 1, 'purge never touches the real job');
select is((select count(*) from public.factory_work_centers where not is_test)::integer, 1, 'nor the real work center');

select * from finish();
rollback;
