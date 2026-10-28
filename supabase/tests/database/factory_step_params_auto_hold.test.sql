-- ฝ่ายโรงงาน: พารามิเตอร์ของขั้นใน Routing และการกักกันใบงานอัตโนมัติ (20261029010000_factory_step_params_auto_hold.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ ปฏิเสธนอกโหมดทดสอบ/ผิดแผนก การตรวจชุดพารามิเตอร์ ด่านปิดขั้นต้องบันทึกค่า การตรวจค่าที่ส่ง
-- ค่าในสเปกปิดขั้นตามปกติ ค่าหลุดสเปกปิดขั้นแล้วกักกันใบงาน ใบงานที่ถูกกักกันทำขั้นถัดไปไม่ได้ QA ออก NCR และปลดกักกัน
-- ประวัติ และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select relrowsecurity from pg_class where relname = 'factory_routing_step_params')
      and (select relrowsecurity from pg_class where relname = 'factory_job_step_readings'), 'both new tables have RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv),
                  unnest(array['public.factory_routing_step_params', 'public.factory_job_step_readings']) t(tbl)
    where has_table_privilege(r.role, t.tbl, p.priv)),
  'anon and authenticated have no direct privilege on the new tables');
select ok(exists (select 1 from pg_trigger g where g.tgname = 'factory_routing_step_params_sandbox_scope' and not g.tgisinternal)
      and exists (select 1 from pg_trigger g where g.tgname = 'factory_job_step_readings_sandbox_scope' and not g.tgisinternal),
  'the new tables enforce sandbox scope by trigger');
select ok('factory_routing_step_params' = any (private.sandbox_unguarded_tables()) and 'factory_job_step_readings' = any (private.sandbox_unguarded_tables())
          and 'factory_job_inspections' = any (private.sandbox_unguarded_tables()) and 'qc_inspection_history' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the new ones');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'factory_job_history_action_check')) like '%hold_ncr%'
      and pg_get_constraintdef((select oid from pg_constraint where conname = 'factory_job_history_action_check')) like '%schedule%',
  'the job history accepts the hold actions and keeps schedule');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0,
  'every public function, including the new and redefined ones, keeps the lab-only guard');
select ok(not exists (
    select 1 from unnest(array['factory_routing_step_params', 'factory_job_step_readings']) t(tbl)
    where not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
                      where c.relname = t.tbl and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'both new tables have the restrictive lab_only_no_access policy');
select ok(not has_function_privilege('anon', 'public.app_factory_set_step_params(uuid,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_complete_job_step_with_readings(uuid,integer,integer,text,jsonb,numeric)', 'execute')
      and not has_function_privilege('anon', 'public.app_factory_decide_job_hold(uuid,integer,text,text,numeric,text)', 'execute'),
  'anon cannot call the new APIs');
select ok(has_function_privilege('authenticated', 'public.app_factory_set_step_params(uuid,jsonb)', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_complete_job_step_with_readings(uuid,integer,integer,text,jsonb,numeric)', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_decide_job_hold(uuid,integer,text,text,numeric,text)', 'execute'),
  'signed-in users can call the new APIs (they check mode and department themselves)');
select ok(not has_function_privilege('authenticated', 'private.factory_run_job_step(uuid,integer,integer,text,numeric,boolean,boolean)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_run_job_step(uuid,integer,integer,text,numeric,boolean)', 'execute'),
  'clients cannot call either step runner');
select ok(has_function_privilege('authenticated', 'public.app_factory_complete_job_step(uuid,integer,integer,text,numeric)', 'execute')
      and has_function_privilege('authenticated', 'public.app_factory_record_qc(uuid,integer,integer,text,numeric,numeric,text,text,text,numeric)', 'execute'),
  'the existing step and QC APIs keep their signatures and grants');

-- 2. บัญชีทดสอบ -----------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('84000000-0000-0000-0000-000000000001', 'hold-admin@test.local', '{}'),
  ('84000000-0000-0000-0000-000000000002', 'hold-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('84000000-0000-0000-0000-000000000101', 'HOLD-ADMIN', 'Hold', 'Admin', 'hold-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '84000000-0000-0000-0000-000000000001'),
  ('84000000-0000-0000-0000-000000000102', 'HOLD-STAFF', 'Hold', 'Staff', 'hold-staff@test.local',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '84000000-0000-0000-0000-000000000002');
select set_config('test.p_' || substr(employee_no, 5, 2), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-SR-STAFF', 'SBX-QA-STAFF');
select set_config('test.due', ((now() at time zone 'Asia/Bangkok')::date + 30)::text, true);

create function pg_temp.item(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.stock(text) returns numeric language sql stable as $$
  select (x ->> 'stock')::numeric from jsonb_array_elements(public.app_factory_master_data() -> 'items') x where x ->> 'code' = $1 $$;
create function pg_temp.bom(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'boms') x where x ->> 'code' = $1 and x ->> 'revision' = 'A' $$;
create function pg_temp.routing(text) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'routings') x where x ->> 'code' = $1 $$;
create function pg_temp.rstep(text, integer) returns text language sql stable as $$
  select x ->> 'id' from jsonb_array_elements(public.app_factory_master_data() -> 'steps') x
  where x ->> 'routing_id' = pg_temp.routing($1) and (x ->> 'sequence')::integer = $2 $$;
create function pg_temp.job(text) returns jsonb language sql stable as $$
  select x from jsonb_array_elements(public.app_factory_master_data() -> 'jobs') x where x ->> 'id' = $1 $$;
create function pg_temp.jver(text) returns integer language sql stable as $$ select (pg_temp.job($1) ->> 'version')::integer $$;
create function pg_temp.readings(text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x ->> 'code'), '[]'::jsonb)
  from jsonb_array_elements(public.app_factory_master_data() -> 'job_readings') x where x ->> 'job_id' = $1 $$;
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;
create function pg_temp.run(text, integer, integer) returns integer language plpgsql as $$
declare v_n integer;
begin
  for v_n in $2..$3 loop
    perform public.app_factory_complete_job_step($1::uuid, pg_temp.jver($1), v_n * 10, '', null);
  end loop;
  return $3 - $2 + 1;
end $$;

set local role authenticated;

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$select public.app_factory_set_step_params('84000000-0000-0000-0000-00000000c001', '[]')$$, 'AUTH_REQUIRED', 'setting parameters needs a session');
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_set_step_params('84000000-0000-0000-0000-00000000c001', '[]')$$, 'FACTORY_TEST_MODE_ONLY', 'a real planning account cannot set parameters');
select throws_ok($$select public.app_factory_decide_job_hold('84000000-0000-0000-0000-00000000c001', 1, 'release', 'ปลดกักกันทดสอบ')$$, 'FACTORY_TEST_MODE_ONLY', 'a real account cannot decide a hold');
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_complete_job_step_with_readings('84000000-0000-0000-0000-00000000c001', 1, 10, '', '{}')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot record readings');

-- 4. เตรียมข้อมูล: ชุดทดลอง ใบสั่งผลิตที่ออกใบสั่งงานแล้ว ----------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('WIP-TRY-RBL-001')$$, 'the BOMs are approved');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-001')::uuid, 12, current_setting('test.due')::date, '', '')) ->> 'id', true);
select public.app_factory_submit_production_order(current_setting('test.wo')::uuid, 1);
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select public.app_factory_receive_production_order(current_setting('test.wo')::uuid, 2);
select public.app_factory_plan_production_order(current_setting('test.wo')::uuid, 3, pg_temp.bom('FG-TRY-001')::uuid, pg_temp.routing('FG-TRY-001')::uuid, 'พอ');
select public.app_factory_release_production_order(current_setting('test.wo')::uuid, 4);
select set_config('test.rbl', pg_temp.item('WIP-TRY-RBL-001'), true);
select set_config('test.s10', pg_temp.rstep('WIP-TRY-RBL-001', 10), true);
select set_config('test.s150', pg_temp.rstep('WIP-TRY-RBL-001', 150), true);
select ok(current_setting('test.s10') <> '' and current_setting('test.s150') <> '', 'the RB first step and the QC step of the long strip routing exist');

-- 5. กำหนดพารามิเตอร์ (ฝ่ายวางแผน) และการตรวจชุดพารามิเตอร์ -------------------------------------------
select set_config('test.params', '[{"code":"dump_temp","label":"อุณหภูมิปล่อยยาง","unit":"°C","min":135,"max":145},{"code":"THICK","label":"ความหนา","unit":"mm","min":2.38,"max":2.62}]', true);
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), current_setting('test.params')),
  'PRODUCTION_PLANNING_ONLY', 'the production line cannot define parameters');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok($$select public.app_factory_set_step_params('84000000-0000-0000-0000-00000000c001', '[]')$$, 'ROUTING_STEP_NOT_FOUND', 'an unknown step is rejected');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s150'), current_setting('test.params')),
  'STEP_PARAMS_QC_STEP', 'a QC step keeps its inspection form instead of parameters');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '{"code":"A"}'), 'INVALID_STEP_PARAMS', 'the parameters must be an array');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"A","label":"ก","min":1},{"code":"a","label":"ข","max":2}]'),
  'INVALID_STEP_PARAMS', 'codes must be unique ignoring case');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"A","label":"ก"}]'), 'INVALID_STEP_PARAMS', 'a parameter needs a minimum or a maximum');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"A","label":"ก","min":5,"max":4}]'), 'INVALID_STEP_PARAMS', 'the minimum cannot exceed the maximum');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"A","label":"ก","min":"5"}]'), 'INVALID_STEP_PARAMS', 'limits must be numbers');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"1A","label":"ก","min":1}]'), 'INVALID_STEP_PARAMS', 'a code must start with a letter');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'), '[{"code":"A","label":"","min":1}]'), 'INVALID_STEP_PARAMS', 'a label is required');
select throws_ok(format($$select public.app_factory_set_step_params(%L::uuid, %L::jsonb)$$, current_setting('test.s10'),
    (select jsonb_agg(jsonb_build_object('code', 'P' || n, 'label', 'ค่า ' || n, 'min', 0)) from generate_series(1, 21) n)::text),
  'INVALID_STEP_PARAMS', 'a step takes at most 20 parameters');
select is((public.app_factory_set_step_params(current_setting('test.s10')::uuid, current_setting('test.params')::jsonb) ->> 'count')::integer, 2, 'planning defines two parameters');
select is((select string_agg(p ->> 'code', ',' order by p ->> 'code') from jsonb_array_elements(
            (select x -> 'params' from jsonb_array_elements(public.app_factory_master_data() -> 'steps') x where x ->> 'id' = current_setting('test.s10'))) p),
  'DUMP_TEMP,THICK', 'the routing step shows the parameters with upper-case codes');
select is((select x ->> 'work_center_code' from jsonb_array_elements(public.app_factory_master_data() -> 'steps') x where x ->> 'id' = current_setting('test.s150')),
  'QC', 'the routing steps expose the work center code');
reset role;
select is((select count(*) from public.audit_logs where action = 'FACTORY_STEP_PARAMS_SET' and entity_id = current_setting('test.s10'))::integer, 1, 'defining parameters is audited');
set local role authenticated;

-- 6. ออกใบงานแล้ว ด่านปิดขั้นต้องบันทึกค่า -------------------------------------------------------------
select set_config('test.j1', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, 'SR', '')) ->> 'id', true);
select set_config('test.j2', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 10, 'SR', '')) ->> 'id', true);
select is(jsonb_array_length(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 0 -> 'params'), 2, 'the job step lists the parameters to record');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 1 -> 'params', '[]'::jsonb, 'a step without parameters lists none');
select is((pg_temp.job(current_setting('test.j1')) ->> 'on_hold')::boolean, false, 'a new job is not on hold');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select set_config('test.v1', pg_temp.jver(current_setting('test.j1'))::text, true);
select set_config('test.nr', pg_temp.stock('RM-TRY-NR-001')::text, true);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 10, '', null)$$, current_setting('test.j1'), current_setting('test.v1')),
  'JOB_STEP_READINGS_REQUIRED', 'a step with parameters cannot be closed by the plain step API');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '{"DUMP_TEMP":140}'),
  'INVALID_JOB_READINGS', 'every parameter must be recorded');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '{"DUMP_TEMP":140,"THICK":2.5,"EXTRA":1}'),
  'INVALID_JOB_READINGS', 'an unknown parameter is rejected');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '{"DUMP_TEMP":"140","THICK":2.5}'),
  'INVALID_JOB_READINGS', 'a reading must be a number');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '[140, 2.5]'),
  'INVALID_JOB_READINGS', 'the readings must be an object');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '{"DUMP_TEMP":2000000000,"THICK":2.5}'),
  'INVALID_JOB_READINGS', 'a huge reading is rejected');
select public.app_sandbox_enter(current_setting('test.p_SR')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 10, '', %L)$$, current_setting('test.j1'), current_setting('test.v1'), '{"DUMP_TEMP":140,"THICK":2.5}'),
  'JOB_STEP_DEPARTMENT_ONLY', 'another department cannot record the RB readings');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select is(pg_temp.jver(current_setting('test.j1')), current_setting('test.v1')::integer, 'refused attempts leave the job version alone');
select is(pg_temp.stock('RM-TRY-NR-001'), current_setting('test.nr')::numeric, 'and issue no material (the whole transaction is undone)');
select is(pg_temp.readings(current_setting('test.j1')), '[]'::jsonb, 'and record no reading');

-- 7. ค่าในสเปก: ปิดขั้นตามปกติ ------------------------------------------------------------------
select is(public.app_factory_complete_job_step_with_readings(current_setting('test.j1')::uuid, current_setting('test.v1')::integer, 10, 'ผสมตามสูตร',
            '{"DUMP_TEMP":140.5,"THICK":2.51}') ->> 'held', 'false', 'readings within spec close the step without a hold');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'in_progress', 'the job starts');
select ok(pg_temp.stock('RM-TRY-NR-001') < current_setting('test.nr')::numeric, 'and the first step issues the materials as before');
select is((select string_agg((x ->> 'code') || '=' || trim_scale((x ->> 'value')::numeric) || ':' || (x ->> 'in_spec'), ',') from jsonb_array_elements(pg_temp.readings(current_setting('test.j1'))) x),
  'DUMP_TEMP=140.5:true,THICK=2.51:true', 'both readings are stored as in spec');
select is((pg_temp.readings(current_setting('test.j1')) -> 0 ->> 'min')::numeric, 135::numeric, 'the reading keeps the spec at the time it was recorded');
select throws_ok(format($$select public.app_factory_complete_job_step_with_readings(%L::uuid, %s, 20, '', '{}')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_STEP_NO_PARAMS', 'the readings API refuses a step without parameters');
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 20, '', null)$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'a step without parameters still closes with the plain step API');

-- 8. ค่าหลุดสเปก: ปิดขั้นแล้วกักกันใบงาน --------------------------------------------------------------
select set_config('test.v2', pg_temp.jver(current_setting('test.j2'))::text, true);
select is(public.app_factory_complete_job_step_with_readings(current_setting('test.j2')::uuid, current_setting('test.v2')::integer, 10, '',
            '{"DUMP_TEMP":151,"THICK":2.5}') ->> 'held', 'true', 'an out-of-spec reading puts the job on hold');
select is(pg_temp.job(current_setting('test.j2')) -> 'steps' -> 0 ->> 'status', 'done', 'the step itself is done');
select is((pg_temp.job(current_setting('test.j2')) ->> 'on_hold')::boolean, true, 'the job is on hold');
select ok(pg_temp.job(current_setting('test.j2')) ->> 'hold_reason' like '%อุณหภูมิปล่อยยาง 151 °C (สเปก 135–145)%', 'the hold reason names the reading and its spec');
select is((pg_temp.job(current_setting('test.j2')) ->> 'version')::integer, current_setting('test.v2')::integer + 2, 'the version moves for the step and the hold');
select is((select string_agg(x ->> 'code' || ':' || (x ->> 'in_spec'), ',') from jsonb_array_elements(pg_temp.readings(current_setting('test.j2'))) x),
  'DUMP_TEMP:false,THICK:true', 'the readings record which value was out of spec');
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 20, '', null)$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'JOB_ON_HOLD', 'a held job cannot run its next step');

-- 9. QA ตัดสิน ------------------------------------------------------------------------------
select set_config('test.v2', pg_temp.jver(current_setting('test.j2'))::text, true);
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'ตรวจซ้ำแล้วใช้ได้')$$, current_setting('test.j2'), current_setting('test.v2')),
  'JOB_HOLD_QA_ONLY', 'the production line cannot release its own hold');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'maybe', 'ตรวจซ้ำแล้วใช้ได้')$$, current_setting('test.j2'), current_setting('test.v2')),
  'INVALID_JOB_HOLD_DECISION', 'an unknown decision is rejected');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'สั้น')$$, current_setting('test.j2'), current_setting('test.v2')),
  'JOB_HOLD_NOTE_REQUIRED', 'a short reason is rejected');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'ตรวจซ้ำแล้วใช้ได้', 1, null)$$, current_setting('test.j2'), current_setting('test.v2')),
  'INVALID_JOB_HOLD_DECISION', 'a release carries no defect quantity');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'ncr', 'ยางร้อนเกินทั้งแบตช์', 0, 'DIM')$$, current_setting('test.j2'), current_setting('test.v2')),
  'JOB_HOLD_DEFECT_INVALID', 'an NCR needs a positive defect quantity');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'ncr', 'ยางร้อนเกินทั้งแบตช์', 11, 'DIM')$$, current_setting('test.j2'), current_setting('test.v2')),
  'JOB_HOLD_DEFECT_INVALID', 'the defect quantity cannot exceed the job quantity');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'ncr', 'ยางร้อนเกินทั้งแบตช์', 5, 'ZZZZ')$$, current_setting('test.j2'), current_setting('test.v2')),
  'JOB_HOLD_DEFECT_INVALID', 'an unknown defect type is rejected');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, 1, 'release', 'ตรวจซ้ำแล้วใช้ได้')$$, current_setting('test.j2')),
  'JOB_VERSION_CONFLICT', 'a stale version is refused');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'ตรวจซ้ำแล้วใช้ได้')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_NOT_HELD', 'a job that is not on hold cannot be released');
select set_config('test.ncr', public.app_factory_decide_job_hold(current_setting('test.j2')::uuid, current_setting('test.v2')::integer, 'ncr',
  'ยางร้อนเกินทั้งแบตช์ ส่งตรวจ MDR ซ้ำ', 10, 'DIM') ->> 'ncr_no', true);
select ok(current_setting('test.ncr') like 'TEST-%', 'QA issues a test NCR for the held job');
select is((pg_temp.job(current_setting('test.j2')) ->> 'on_hold')::boolean, true, 'the job stays on hold after the NCR');
select is(pg_temp.job(current_setting('test.j2')) ->> 'hold_ncr_no', current_setting('test.ncr'), 'the job links the NCR');
reset role;
select is((select lot_no from public.ncr_reports where ncr_no = current_setting('test.ncr')),
  (select code from public.factory_jobs where id = current_setting('test.j2')::uuid), 'the NCR names the job as its lot');
set local role authenticated;
select lives_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'MDR ซ้ำผ่าน ปล่อยใช้งานได้')$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'QA releases the hold');
select is((pg_temp.job(current_setting('test.j2')) ->> 'on_hold')::boolean, false, 'the job is no longer on hold');
select throws_ok(format($$select public.app_factory_decide_job_hold(%L::uuid, %s, 'release', 'MDR ซ้ำผ่าน ปล่อยใช้งานได้')$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'JOB_NOT_HELD', 'a released job cannot be released again');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select lives_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 20, '', null)$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'the released job runs its next step');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x
           where x ->> 'job_id' = current_setting('test.j2')), 'create,step,hold,hold_ncr,release,step', 'the job history shows the hold and the QA decisions');
reset role;
select is((select count(*) from public.audit_logs where action in ('FACTORY_JOB_HOLD', 'FACTORY_JOB_HOLD_NCR', 'FACTORY_JOB_RELEASE')
           and entity_id = current_setting('test.j2'))::integer, 3, 'the hold and both decisions are audited');
set local role authenticated;

-- 10. ล้างข้อมูลทดสอบรวมสองตารางใหม่ ---------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"84000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((public.app_sandbox_factory_test_data() -> 'counts' ->> 'details')::integer > 0, 'the test data summary counts the details');
select ok((public.app_sandbox_purge_ncr() ->> 'deleted')::integer >= 1, 'the NCR purge removes the test NCR');
select is(pg_temp.job(current_setting('test.j2')) ->> 'hold_ncr_id', null, 'the job keeps no dangling NCR link');
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'the factory purge removes the test data');
select is(public.app_factory_master_data() -> 'job_readings', '[]'::jsonb, 'no reading remains');
reset role;
select is((select count(*) from public.factory_job_step_readings)::integer + (select count(*) from public.factory_routing_step_params)::integer, 0, 'both new tables are empty');

select * from finish();
rollback;
