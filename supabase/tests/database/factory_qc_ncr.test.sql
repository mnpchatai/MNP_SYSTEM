-- ฝ่ายโรงงาน: ผลตรวจ QC ของขั้น QC ในใบงาน และเชื่อม NCR (20261007070000_factory_qc_ncr.sql)
-- ครอบคลุม: โครงสร้างและสิทธิ์ ปฏิเสธนอกโหมดทดสอบ/ผิดแผนก ด่านปิดขั้น QC ต้องผ่านบันทึกผลตรวจ การตรวจค่าทุกช่อง
-- ตรวจไม่ผ่านออก NCR จริงในระบบ NCR (ข้อมูลทดสอบ เลขที่ TEST-QA…) ขั้นยังรอตรวจซ้ำ ตรวจซ้ำผ่านปิดขั้นและรับผลผลิต
-- ประวัติ/audit ยกเลิกใบงานหลังตรวจไม่ผ่าน ล้างข้อมูล NCR แยกจากล้างข้อมูลฝ่ายโรงงาน และการแยกโหมดทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok((select relrowsecurity from pg_class where relname = 'factory_job_inspections'), 'the inspection table has RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.factory_job_inspections', p.priv)),
  'anon and authenticated have no direct privilege on the inspections');
select ok(exists (select 1 from pg_trigger g where g.tgname = 'factory_job_inspections_sandbox_scope' and not g.tgisinternal), 'the table enforces sandbox scope by trigger');
select ok('factory_job_inspections' = any (private.sandbox_unguarded_tables()) and 'factory_jobs' = any (private.sandbox_unguarded_tables())
          and 'factory_material_orders' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the earlier tables and adds the inspections');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'factory_job_history_action_check')) like '%qc_fail%', 'the job history accepts qc_fail');
select ok(not has_function_privilege('anon', 'public.app_factory_record_qc(uuid,integer,integer,text,numeric,numeric,text,text,text,numeric)', 'execute'), 'anon cannot record QC results');
select ok(has_function_privilege('authenticated', 'public.app_factory_record_qc(uuid,integer,integer,text,numeric,numeric,text,text,text,numeric)', 'execute'),
  'signed-in users can call the API (it checks mode and department itself)');
select ok(not has_function_privilege('authenticated', 'private.factory_run_job_step(uuid,integer,integer,text,numeric,boolean)', 'execute')
      and not has_function_privilege('authenticated', 'private.factory_ncr_unit(text)', 'execute'),
  'clients cannot call the step runner or the unit helper');
select ok(has_function_privilege('authenticated', 'public.app_factory_complete_job_step(uuid,integer,integer,text,numeric)', 'execute'), 'the public step API keeps its signature and grant');
select is(private.factory_ncr_unit('KG'), 'กก.', 'kilograms map to the NCR unit');
select is(private.factory_ncr_unit('set'), 'ชุด', 'sets map to the NCR unit');
select is(private.factory_ncr_unit('PCS'), 'ชิ้น', 'pieces map to the NCR unit');
select is(private.factory_ncr_unit('SHEET'), 'ชิ้น', 'sheets (not an NCR unit) become pieces');
select is(private.factory_ncr_unit('XYZ'), 'รายการ', 'an unknown unit becomes "item"');
select is(private.factory_ncr_unit(null), 'รายการ', 'a missing unit becomes "item"');

-- 2. ข้อมูลจริงที่ต้องไม่ถูกแตะ + บัญชีทดสอบ -----------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('83000000-0000-0000-0000-000000000001', 'qc-admin@test.local', '{}'),
  ('83000000-0000-0000-0000-000000000002', 'qc-staff@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, department_id, role_id, auth_user_id) values
  ('83000000-0000-0000-0000-000000000101', 'QC-ADMIN', 'Qc', 'Admin', 'qc-admin@test.local',
   (select id from public.departments where code = 'FT'), (select id from public.roles where code = 'admin'), '83000000-0000-0000-0000-000000000001'),
  ('83000000-0000-0000-0000-000000000102', 'QC-STAFF', 'Qc', 'Staff', 'qc-staff@test.local',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '83000000-0000-0000-0000-000000000002');
select set_config('test.p_' || substr(employee_no, 5, 2), id::text, true) from public.employees where employee_no in
  ('SBX-SA-STAFF', 'SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-SR-STAFF', 'SBX-QA-STAFF');
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
create function pg_temp.jver(text) returns integer language sql stable as $$ select (pg_temp.job($1) ->> 'version')::integer $$;
create function pg_temp.insp(text) returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(x order by x ->> 'inspected_at', x ->> 'id'), '[]'::jsonb)
  from jsonb_array_elements(public.app_factory_master_data() -> 'job_inspections') x where x ->> 'job_id' = $1 $$;
create function pg_temp.approve(text) returns text language plpgsql as $$
declare v_id text := pg_temp.bom($1);
begin
  perform public.app_factory_submit_bom(v_id::uuid, 1);
  perform public.app_factory_decide_bom(v_id::uuid, 2, 'approve', 'ทดสอบ');
  return v_id;
end $$;
-- ทำขั้นตอนที่ n..m ของใบงาน (ลำดับ n*10) ด้วย persona ปัจจุบัน (ใช้กับขั้นที่ไม่ใช่ QC)
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
select throws_ok($$select public.app_factory_record_qc('83000000-0000-0000-0000-00000000c001', 1, 150, 'pass', 1, 0, '', null, '')$$, 'AUTH_REQUIRED', 'recording a result needs a session');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_record_qc('83000000-0000-0000-0000-00000000c001', 1, 150, 'pass', 1, 0, '', null, '')$$, 'FACTORY_TEST_MODE_ONLY', 'a real QA account cannot record a result (real mode is not open)');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$select public.app_factory_record_qc('83000000-0000-0000-0000-00000000c001', 1, 150, 'pass', 1, 0, '', null, '')$$, 'FACTORY_TEST_MODE_ONLY', 'admin outside test mode cannot record a result');

-- 4. เตรียมใบงานยางเส้นยาว: RB 13 ขั้น + SR รับเข้าแล้ว เหลือขั้น QC ----------------------------
select public.app_sandbox_enter(current_setting('test.p_SA')::uuid);
select is(public.app_sandbox_seed_factory_trial() ->> 'seeded', 'true', 'the trial set provides items, BOMs, routings and opening stock');
select lives_ok($$select pg_temp.approve('FG-TRY-001'), pg_temp.approve('WIP-TRY-RBL-001')$$, 'the BOMs of the finished good and the long rubber strip are approved');
select set_config('test.wo', (public.app_factory_save_production_order(null, null, pg_temp.item('FG-TRY-001')::uuid, 12, current_setting('test.due')::date, '', '')) ->> 'id', true);
select public.app_factory_submit_production_order(current_setting('test.wo')::uuid, 1);
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select public.app_factory_receive_production_order(current_setting('test.wo')::uuid, 2);
select public.app_factory_plan_production_order(current_setting('test.wo')::uuid, 3, pg_temp.bom('FG-TRY-001')::uuid, pg_temp.routing('FG-TRY-001')::uuid, 'พอ');
select public.app_factory_release_production_order(current_setting('test.wo')::uuid, 4);
select set_config('test.rbl', pg_temp.item('WIP-TRY-RBL-001'), true);
select set_config('test.j1', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 100, 'SR', '')) ->> 'id', true);
select set_config('test.j2', (public.app_factory_create_job(current_setting('test.wo')::uuid, current_setting('test.rbl')::uuid, 10, 'SR', '')) ->> 'id', true);
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select is(pg_temp.run(current_setting('test.j1'), 1, 13), 13, 'RB completes the 13 rubber steps');
select public.app_sandbox_enter(current_setting('test.p_SR')::uuid);
select is(pg_temp.run(current_setting('test.j1'), 14, 14), 1, 'SR receives the long strip');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 260::numeric, 'there is no output before QC');

-- 5. ด่านปิดขั้น QC และสิทธิ์/ลำดับ ------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select throws_ok(format($$select public.app_factory_complete_job_step(%L::uuid, %s, 150, '', null)$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_QC_INSPECTION_REQUIRED', 'the QC step cannot be closed by the plain step API, even by QA');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 140, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_STEP_ALREADY_DONE', 'a finished step cannot be inspected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 999, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_STEP_NOT_FOUND', 'an unknown step is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, 1, 150, 'pass', 100, 0, '', null, '')$$, current_setting('test.j2')),
  'JOB_STEP_OUT_OF_ORDER', 'the QC step waits for the earlier steps');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, 1, 10, 'pass', 10, 0, '', null, '')$$, current_setting('test.j2')),
  'JOB_STEP_NOT_QC', 'only a QC step takes an inspection');
select throws_ok($$select public.app_factory_record_qc('83000000-0000-0000-0000-00000000c001', 1, 150, 'pass', 1, 0, '', null, '')$$, 'JOB_NOT_FOUND', 'test mode cannot inspect a job that does not exist');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, 1, 150, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1')),
  'JOB_VERSION_CONFLICT', 'a stale version is refused');
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_STEP_DEPARTMENT_ONLY', 'the production line cannot record the QC result');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', 'DIM', 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_STEP_DEPARTMENT_ONLY', 'planning cannot record a failing result (and no NCR is created)');

-- 6. ตรวจค่าทุกช่อง (ไม่เขียนอะไรเมื่อผิด) --------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select set_config('test.v1', pg_temp.jver(current_setting('test.j1'))::text, true);
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'maybe', 100, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_RESULT', 'an unknown result is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, null, 100, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_RESULT', 'a result is required');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', null, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'the checked quantity is required');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 0, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a zero checked quantity is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 'NaN', 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a NaN checked quantity is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 1000000001, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a huge checked quantity is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 'NaN', '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a NaN defect quantity is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 5, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a passing result cannot carry defects');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, null, '', 'DIM', 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a failing result needs the defect quantity');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 0, '', 'DIM', 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'a zero defect quantity is not a failure');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 101, '', 'DIM', 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_QTY', 'defects cannot exceed the checked quantity');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 0, repeat('n', 1001), null, '')$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_QC_NOTE', 'a long measurement note is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', null, 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), current_setting('test.v1')), 'JOB_QC_DEFECT_TYPE_INVALID', 'a defect type is required');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', 'ZZZZ', 'ขนาดเกินเกณฑ์ทดสอบ')$$, current_setting('test.j1'), current_setting('test.v1')), 'JOB_QC_DEFECT_TYPE_INVALID', 'an unknown defect type is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', 'DIM', 'สั้น')$$, current_setting('test.j1'), current_setting('test.v1')), 'JOB_QC_DESCRIPTION_REQUIRED', 'a short description is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', 'DIM', repeat('ก', 4001))$$, current_setting('test.j1'), current_setting('test.v1')), 'JOB_QC_DESCRIPTION_REQUIRED', 'a very long description is rejected');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 5, '', 'DIM', 'ขนาดเกินเกณฑ์ทดสอบ', 50)$$, current_setting('test.j1'), current_setting('test.v1')), 'INVALID_JOB_OUTPUT_QTY', 'a failing result takes no output quantity');
select is(pg_temp.jver(current_setting('test.j1')), current_setting('test.v1')::integer, 'refused attempts leave the job version alone');
select is(pg_temp.insp(current_setting('test.j1')), '[]'::jsonb, 'and record no inspection');
reset role;
select is((select count(*) from public.ncr_reports)::integer, 0, 'and create no NCR');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 7. ตรวจไม่ผ่าน → ออก NCR ------------------------------------------------------------------------
select set_config('test.ncr1', public.app_factory_record_qc(current_setting('test.j1')::uuid, current_setting('test.v1')::integer, 150, 'fail', 100, 8,
  'วัดได้ 24.1 มม. เกินเกณฑ์', 'DIM', ' ขนาดเกินเกณฑ์ 8 เส้นจาก 100 ') ->> 'ncr_id', true);
select ok(current_setting('test.ncr1')::uuid is not null, 'a failing result returns the NCR it created');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'in_progress', 'the job stays in progress');
select is(pg_temp.jver(current_setting('test.j1')), current_setting('test.v1')::integer + 1, 'and its version moves on');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 14 ->> 'status', 'pending', 'the QC step is still waiting for a re-inspection');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 260::numeric, 'nothing is received into stock');
select is(jsonb_array_length(pg_temp.insp(current_setting('test.j1'))), 1, 'one inspection is recorded');
select is(pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'result', 'fail', 'as a failure');
select is((pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'qty_defect')::numeric, 8::numeric, 'with 8 defects');
select is(pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'description', 'ขนาดเกินเกณฑ์ 8 เส้นจาก 100', 'the description is trimmed');
select is(pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'defect_type_name', 'ขนาดไม่ได้สเปค', 'the defect type name is shown');
select is(pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'ncr_no', 'TEST-QA' || '001/' || current_setting('test.yy') , 'the NCR number is in the test series');
select is(pg_temp.insp(current_setting('test.j1')) -> 0 ->> 'inspected_by_name', 'ทดสอบ พนักงาน QA', 'the inspector is the QA persona');
select ok(exists (select 1 from jsonb_array_elements(public.app_factory_master_data() -> 'ncr_defect_types') x where x ->> 'code' = 'DIM'), 'the defect types of NCR are offered to the form');
reset role;
select is((select count(*) from public.ncr_reports)::integer, 1, 'one NCR exists');
select ok((select is_test from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'it is test data');
select is((select source from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'in_process', 'found in process');
select is((select status::text from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'awaiting_disposition', 'waiting for the factory manager like any new NCR');
select is((select lot_no from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'TEST-JB-' || current_setting('test.yy') || '-001', 'the lot is the job number');
select is((select product_code from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'WIP-TRY-RBL-001', 'the product code is the item');
select is((select qty_total from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 100::numeric, 'the checked quantity is the NCR total');
select is((select qty_defect from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 8::numeric, 'and the defects are the defect quantity');
select is((select unit from public.ncr_reports where id = current_setting('test.ncr1')::uuid), 'กก.', 'kilograms are mapped to the NCR unit');
select is((select reporter_id from public.ncr_reports where id = current_setting('test.ncr1')::uuid), current_setting('test.p_QA')::uuid, 'the QA persona is the reporter');
select ok((select description from public.ncr_reports where id = current_setting('test.ncr1')::uuid) like 'ตรวจ QC ใบงาน TEST-JB-%ขั้น QC-01%ไม่ผ่าน: ขนาดเกินเกณฑ์ 8 เส้นจาก 100', 'the NCR description names the job and the step');
select is((select count(*) from public.ncr_reports where not is_test)::integer, 0, 'no real NCR is created');
select is((select count(*) from public.factory_job_inspections where not is_test)::integer, 0, 'no real inspection is written');
select is((select count(*) from public.factory_job_history where action = 'qc_fail' and not is_test)::integer, 0, 'no real history is written');
select is((select count(*) from public.audit_logs where action = 'FACTORY_JOB_QC_FAIL')::integer, 1, 'the failure is audited');
select is((select actor_id from public.audit_logs where action = 'FACTORY_JOB_QC_FAIL'), '83000000-0000-0000-0000-000000000101'::uuid, 'naming the real admin behind the persona');
select is((select metadata ->> 'persona_employee_no' from public.audit_logs where action = 'FACTORY_JOB_QC_FAIL'), 'SBX-QA-STAFF', 'and the persona who inspected');
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 8. ตรวจซ้ำ: ไม่ผ่านอีกครั้ง ได้ NCR ใบใหม่ แล้วตรวจซ้ำผ่านปิดขั้นและรับผลผลิต ----------------------------
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1'), current_setting('test.v1')),
  'JOB_VERSION_CONFLICT', 'the old version cannot be used again after a failure');
select lives_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 100, 3, '', 'SURF', 'ผิวไม่สมบูรณ์ตรวจซ้ำรอบสอง')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'a second failing inspection is accepted');
select is(jsonb_array_length(pg_temp.insp(current_setting('test.j1'))), 2, 'two inspections are recorded');
select is((select count(distinct x ->> 'ncr_no') from jsonb_array_elements(pg_temp.insp(current_setting('test.j1'))) x)::integer, 2, 'each failure has its own NCR');
select lives_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 97, 0, 'ตรวจซ้ำหลังแก้ ผ่านทั้งหมด', null, '', 95)$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'the re-inspection passes and gives a 95 kg yield');
select is(pg_temp.job(current_setting('test.j1')) ->> 'status', 'completed', 'the job is completed');
select is((pg_temp.job(current_setting('test.j1')) ->> 'output_qty')::numeric, 95::numeric, 'with the real yield');
select is(pg_temp.stock('WIP-TRY-RBL-001'), 355::numeric, 'the long strip is received into stock (260 + 95)');
select is(pg_temp.job(current_setting('test.j1')) -> 'steps' -> 14 ->> 'note', 'ตรวจซ้ำหลังแก้ ผ่านทั้งหมด', 'the measurement note is kept on the step');
select is(jsonb_array_length(pg_temp.insp(current_setting('test.j1'))), 3, 'three inspections are on record');
select is((select string_agg(x ->> 'result', ',' order by x ->> 'inspected_at', x ->> 'id') from jsonb_array_elements(pg_temp.insp(current_setting('test.j1'))) x), 'fail,fail,pass', 'two failures and then the pass');
select is((select string_agg(x ->> 'action', ',' order by (x ->> 'id')::bigint) from jsonb_array_elements(public.app_factory_master_data() -> 'job_history') x
           where x ->> 'job_id' = current_setting('test.j1')), 'create,' || repeat('step,', 14) || 'qc_fail,qc_fail,complete', 'the job history shows both failures before the completion');
select throws_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'pass', 100, 0, '', null, '')$$, current_setting('test.j1'), pg_temp.jver(current_setting('test.j1'))),
  'JOB_NOT_ACTIVE', 'a completed job takes no more inspections');

-- 9. ยกเลิกใบงานหลังตรวจไม่ผ่าน คืนวัตถุดิบตามกติกาเดิม แต่ผลตรวจและ NCR คงอยู่ -----------------------------
select public.app_sandbox_enter(current_setting('test.p_RB')::uuid);
select is(pg_temp.run(current_setting('test.j2'), 1, 13), 13, 'RB runs the second job');
select public.app_sandbox_enter(current_setting('test.p_SR')::uuid);
select is(pg_temp.run(current_setting('test.j2'), 14, 14), 1, 'SR receives it');
select public.app_sandbox_enter(current_setting('test.p_QA')::uuid);
select lives_ok(format($$select public.app_factory_record_qc(%L::uuid, %s, 150, 'fail', 10, 10, '', 'COLOR', 'สีเพี้ยนทั้งล็อตทดสอบ')$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))),
  'the whole second lot fails');
select public.app_sandbox_enter(current_setting('test.p_PP')::uuid);
select set_config('test.stock_before_cancel', pg_temp.stock('RM-TRY-NR-001')::text, true);
select lives_ok(format($$select public.app_factory_cancel_job(%L::uuid, %s, 'ล็อตไม่ผ่าน ยกเลิก')$$, current_setting('test.j2'), pg_temp.jver(current_setting('test.j2'))), 'planning cancels the failed job');
select ok(pg_temp.stock('RM-TRY-NR-001') > current_setting('test.stock_before_cancel')::numeric, 'and the issued materials are returned');
select is(jsonb_array_length(pg_temp.insp(current_setting('test.j2'))), 1, 'the failing inspection stays on record');

-- 10. ล้างข้อมูล NCR ทดสอบแยกจากล้างข้อมูลฝ่ายโรงงาน ------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"83000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select ok((public.app_sandbox_purge_ncr() ->> 'deleted')::integer >= 3, 'the NCR purge removes the three test NCRs');
select is(jsonb_array_length(pg_temp.insp(current_setting('test.j2'))), 1, 'the inspection survives the NCR purge');
select ok(pg_temp.insp(current_setting('test.j2')) -> 0 ->> 'ncr_id' is null and pg_temp.insp(current_setting('test.j2')) -> 0 ->> 'ncr_no' is not null,
  'with the link cleared but the NCR number kept');
select ok((public.app_sandbox_purge_factory() ->> 'deleted')::integer > 0, 'the factory purge removes the test data including the inspections');
select is(public.app_factory_master_data() -> 'job_inspections', '[]'::jsonb, 'no inspection remains');
reset role;
select is((select count(*) from public.factory_job_inspections)::integer, 0, 'the table is empty');

select * from finish();
rollback;
