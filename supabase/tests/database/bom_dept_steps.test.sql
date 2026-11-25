-- ขั้นตอนรายแผนกของ PT / BG / PK แบบเดียวกับ GR และการส่งงาน PT / BG → PK · PK → WH (โรงงาน ขั้น 7 · 20261224010000_bom_dept_steps.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง (คอลัมน์ใหม่ รายการ action ฟังก์ชันใหม่) · นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY
-- · saveGrConfig ต่อแผนก (หัวหน้าแผนกนั้น · รหัสขั้นขึ้นต้นด้วยแผนก) · setGrJobSteps (หัวหน้าแผนกของงาน) · ผลรายวัน (พนักงานของแผนกงานเท่านั้น วันนี้ / แก้วันที่บันทึก · หัวหน้าทุกวันพร้อมเหตุผล)
-- · sendToPk (หัวหน้าแผนกของงาน เพดานยอดดี) / receiveAtPk (PK) / cancelHandover (ยกเลิก = หัวหน้าผู้ส่ง · ย้อนรับ = หัวหน้า PK)
-- · sendPkToWh (หัวหน้า PK เพดานยอดดีของงาน PK) / cancelPkToWh (ไม่ต่ำกว่าที่ WH รับแล้ว) · receiveFg ไม่เกินที่ PK ส่งให้ WH
-- หัวหน้าที่ไม่ใช่กลุ่มวางแผน = ผู้ช่วยผู้จัดการแผนก (บัญชีทดสอบที่เพิ่มในไฟล์นี้) · ผู้จัดการแผนกในสายผลิตอยู่ในกลุ่มวางแผนอยู่แล้ว
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") อ่านตารางด้วย reset role เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และรายการ action -------------------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_gr_config' and column_name = 'dept')
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_gr_handovers' and column_name = 'from_dept')
          and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'bom_gr_handovers' and column_name = 'to_dept'),
  'the config has a department and a hand-over has its route');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_gr_config'::regclass and c.conname = 'bom_gr_config_is_test_dept_key')
          and not exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_gr_config'::regclass and c.conname = 'bom_gr_config_is_test_key'),
  'one config row per mode and department');
select ok(exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_gr_handovers'::regclass and c.conname = 'bom_gr_handovers_route_check')
          and exists (select 1 from pg_constraint c where c.conrelid = 'public.bom_gr_handovers'::regclass and c.conname = 'bom_gr_handovers_wh_status_check'),
  'the hand-over table only takes GR / PT / BG to PK and PK to WH, and a send to WH is never received on the row');
select ok(array['sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh'] <@ private.bom_client_actions()
          and array['sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh'] <@ private.bom_staff_actions()
          and array['sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover', 'addGrRecord', 'receiveFg', 'reportJob'] <@ private.bom_staff_actions(),
  'the five new actions are on both lists and the earlier ones stay');
select is(private.bom_gr_section('sendToPk') || '/' || private.bom_gr_section('receiveAtPk') || '/' || private.bom_gr_section('cancelHandover') || '/'
          || private.bom_gr_section('sendPkToWh') || '/' || private.bom_gr_section('cancelPkToWh'),
  'grHandovers/grHandovers/grHandovers/grHandovers/grHandovers', 'every hand-over action writes the hand-over section');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_dept_config_now(text)'::regprocedure, 'private.bom_gr_config_now()'::regprocedure,
                           'private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_gr_save_plan(public.employees,text,boolean,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_gr_save_record(public.employees,text,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_gr_save_handover(public.employees,text,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_records(bigint)'::regprocedure, 'private.bom_fg_move(public.employees,text,jsonb)'::regprocedure)),
  'the replaced writers and the config reader are security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname in ('bom_dept_default_config', 'bom_dept_config_now', 'bom_fg_pk_sent', 'bom_gr_save_handover', 'bom_fg_move')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the new helpers or the writers directly');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select is((select string_agg(s ->> 'code' || ':' || (s ->> 'name'), ',' order by (s ->> 'seq')::integer) from jsonb_array_elements(private.bom_dept_default_config('PK') -> 'steps') s),
  'PK-01:ประกอบ,PK-02:ใส่กระเป๋า,PK-03:บรรจุกล่อง', 'PK starts with three main steps');
select is((private.bom_dept_default_config('PT') -> 'steps' -> 0 ->> 'name') || '/' || (private.bom_dept_default_config('BG') -> 'steps' -> 0 ->> 'name')
          || '/' || jsonb_array_length(private.bom_dept_default_config('PT') -> 'steps') || '/' || jsonb_array_length(private.bom_dept_default_config('BG') -> 'steps'),
  'ขึ้นรูป/เย็บ/1/1', 'PT starts with one step ขึ้นรูป and BG with one step เย็บ');
select is(private.bom_dept_default_config('GR'), private.bom_gr_default_config(), 'GR keeps its own defaults');
select ok(private.bom_dept_default_config('RB') is null, 'a department without steps has no defaults');

-- 2. บัญชีทดสอบและตัวช่วยของเทสต์ -------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8ef00000-0000-0000-0000-000000000001', 'deptsteps-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ef00000-0000-0000-0000-000000000101', 'DEPTSTEPS-ADMIN', 'Deptsteps', 'Admin', 'deptsteps-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ef00000-0000-0000-0000-000000000001');
-- หัวหน้าแผนกที่ไม่ใช่กลุ่มวางแผน (ผู้ช่วยผู้จัดการแผนก) ของ PT / BG / PK: บัญชีทดสอบ (is_test · inactive ตามข้อบังคับของ persona)
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-PT-AMGR-T', 'ทดสอบ', 'หัวหน้า PT', 'sbx-pt-amgr-t@sandbox.local', 'ผช. ผจก. แผนก PT (ทดสอบ)',
   (select id from public.departments where code = 'PT'), (select id from public.roles where code = 'assistant_department_manager'), false, true),
  ('SBX-BG-AMGR-T', 'ทดสอบ', 'หัวหน้า BG', 'sbx-bg-amgr-t@sandbox.local', 'ผช. ผจก. แผนก BG (ทดสอบ)',
   (select id from public.departments where code = 'BG'), (select id from public.roles where code = 'assistant_department_manager'), false, true),
  ('SBX-PK-AMGR-T', 'ทดสอบ', 'หัวหน้า PK', 'sbx-pk-amgr-t@sandbox.local', 'ผช. ผจก. แผนก PK (ทดสอบ)',
   (select id from public.departments where code = 'PK'), (select id from public.roles where code = 'assistant_department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-PT-STAFF' and d.code = 'PT') or (e.employee_no = 'SBX-BG-STAFF' and d.code = 'BG')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK' and r.code = 'staff') or (e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR' and r.code = 'staff')
                                or (e.employee_no = 'SBX-GR-AMGR' and d.code = 'GR' and r.code = 'assistant_department_manager')
                                or (e.employee_no = 'SBX-WH-STAFF' and d.code = 'WH') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP')
                                or (e.employee_no in ('SBX-PT-AMGR-T', 'SBX-BG-AMGR-T', 'SBX-PK-AMGR-T') and r.code = 'assistant_department_manager'))), 10,
  'the personas used below belong to the departments and roles the rules name');
select ok(not private.bom_can_edit((select e from public.employees e where e.employee_no = 'SBX-PT-AMGR-T'))
          and private.bom_gr_is_head((select e from public.employees e where e.employee_no = 'SBX-PT-AMGR-T'), 'PT')
          and not private.bom_can_edit((select e from public.employees e where e.employee_no = 'SBX-PK-AMGR-T'))
          and private.bom_gr_is_head((select e from public.employees e where e.employee_no = 'SBX-PK-AMGR-T'), 'PK'),
  'the assistant department managers are department heads and not planners');
select set_config('test.today', to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), true);
select set_config('test.d2', to_char((now() at time zone 'Asia/Bangkok')::date - 2, 'YYYY-MM-DD'), true);

create schema ds_t;
grant usage on schema ds_t to authenticated;
create function ds_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function ds_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, ds_t.ver(), p_action)
$$;
-- แถวคำขอเดียวในส่วนของขั้นตอน / การส่งงาน
create function ds_t.gr(p_section text, p_row jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(jsonb_build_object(p_section, jsonb_build_object('upsert', jsonb_build_array(p_row))), ds_t.ver(), p_action)
$$;
create function ds_t.uid(p_n integer) returns text language sql immutable as $$ select '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0') $$;
create function ds_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function ds_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function ds_t.rec(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'grRecords') r where r ->> 'id' = p_id
$$;
create function ds_t.ho(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'grHandovers') r where r ->> 'id' = p_id
$$;
create function ds_t.totals(p_no text) returns text language sql stable as $$
  select (ds_t.job(p_no) ->> 'qtyDone') || '/' || (ds_t.job(p_no) ->> 'qtyReject') || '/' || (ds_t.job(p_no) ->> 'status')
$$;
-- เพิ่มผล: งาน p_job ขั้น p_step วันนี้ ผู้ทำ = บัญชีทดสอบ p_worker (ชื่อ setting เช่น 'sbx_pt_staff') · ส่วนที่ต่างส่งทับด้วย ||
create function ds_t.add(p_n integer, p_job text, p_step text, p_worker text, p_extra jsonb) returns jsonb language sql volatile as $$
  select ds_t.gr('grRecords', jsonb_build_object('id', ds_t.uid(p_n), 'jobId', p_job, 'stepCode', p_step, 'workDate', current_setting('test.today'),
                                                 'workerId', current_setting('test.p_' || p_worker), 'hours', 8, 'people', 1, 'good', 1, 'reject', 0,
                                                 'reason', '', 'note', '') || p_extra, 'addGrRecord')
$$;
-- แก้ผล: ค่าปัจจุบันของผล + ส่วนที่ต่าง (editReason ตั้งไว้แล้ว)
create function ds_t.edit(p_n integer, p_extra jsonb) returns jsonb language sql volatile as $$
  select ds_t.gr('grRecords', jsonb_build_object('id', ds_t.uid(p_n), 'stepCode', r ->> 'stepCode', 'workDate', r ->> 'workDate', 'workerId', r ->> 'workerId',
                                                 'hours', r -> 'hours', 'people', r -> 'people', 'good', r -> 'good', 'reject', r -> 'reject',
                                                 'reason', coalesce(r ->> 'reason', ''), 'note', r ->> 'note', 'editReason', 'นับผิด') || p_extra, 'editGrRecord')
  from (select ds_t.rec(ds_t.uid(p_n)) as r) x
$$;
create function ds_t.plan(p_job text, p_codes text[]) returns jsonb language sql volatile as $$
  select ds_t.gr('grPlans', jsonb_build_object('jobId', p_job, 'steps', (select jsonb_agg(jsonb_build_object('code', c, 'qtyTarget', 10) order by o) from unnest(p_codes) with ordinality u(c, o))), 'setGrJobSteps')
$$;
-- ตั้งค่าของแผนก: ค่าเริ่มต้นของแผนก + ส่วนที่ต่าง
create function ds_t.config(p_dept text, p_extra jsonb) returns jsonb language sql volatile as $$
  select ds_t.gr('grConfig', jsonb_build_object('dept', p_dept, 'steps', d -> 'steps', 'reasons', d -> 'reasons', 'targets', '[]'::jsonb) || p_extra, 'saveGrConfig')
  from (select current_setting('test.cfg_' || lower(p_dept))::jsonb as d) x
$$;
-- ส่งงาน: action ส่ง (sendToPk / sendGrToPk / sendPkToWh) แถว id p_n ของงาน p_job จำนวน p_qty
create function ds_t.send(p_action text, p_n integer, p_job text, p_qty numeric) returns jsonb language sql volatile as $$
  select ds_t.gr('grHandovers', jsonb_build_object('id', ds_t.uid(p_n), 'jobId', p_job, 'qty', p_qty, 'note', ''), p_action)
$$;
create function ds_t.act(p_action text, p_n integer, p_reason text default null) returns jsonb language sql volatile as $$
  select ds_t.gr('grHandovers', jsonb_build_object('id', ds_t.uid(p_n)) || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end, p_action)
$$;
-- WH รับสินค้าสำเร็จรูปเข้าคลัง (receiveFg) ของใบ 251225-27001
create function ds_t.receive_fg(p_qty numeric) returns jsonb language sql volatile as $$
  select ds_t.save(jsonb_build_object('fgMoves', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'orderId', '251225-27001', 'kind', 'receive', 'lines', jsonb_build_array(jsonb_build_object('fgCode', 'FG-A', 'qty', p_qty)))))), 'receiveFg')
$$;
create function ds_t.fg_own() returns numeric language sql stable as $$
  select coalesce(sum(case when m ->> 'kind' = 'receive' then (m ->> 'qty')::numeric when m ->> 'kind' = 'unreceive' then -(m ->> 'qty')::numeric else 0 end), 0)
  from jsonb_array_elements(public.app_bom_master() -> 'fgMoves') m where m ->> 'orderId' = '251225-27001' and m ->> 'fgCode' = 'FG-A'
$$;
select set_config('test.cfg_pt', private.bom_dept_default_config('PT')::text, true);
select set_config('test.cfg_bg', private.bom_dept_default_config('BG')::text, true);
select set_config('test.cfg_pk', private.bom_dept_default_config('PK')::text, true);

-- 3. นอกโหมดทดสอบ: action ใหม่ = BOM_TEST_MODE_ONLY (private.bom_real_open() ยังเป็น false) ------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ef00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.app_bom_save_master('{"grHandovers":{"upsert":[{}]}}'::jsonb, 0, 'sendToPk') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot send to PK');
select throws_ok($$ select public.app_bom_save_master('{"grHandovers":{"upsert":[{}]}}'::jsonb, 0, 'sendPkToWh') $$, 'BOM_TEST_MODE_ONLY',
  'nor send to WH');
select throws_ok($$ select public.app_bom_save_master('{"grHandovers":{"upsert":[{}]}}'::jsonb, 0, 'cancelPkToWh') $$, 'BOM_TEST_MODE_ONLY',
  'nor cancel a send to WH');

-- 4. ข้อมูลตั้งต้น: ใบ 251225-27001 ปล่อยผลิต (สั่ง FG-A 10) พร้อมงาน GR / PT / BG / PK (แผน 10) --------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}],"explosion":[{"itemCode":"FG-A","kind":"FG","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","kind":"SE","level":1,"fgQty":10,"required":10,"parentCode":"FG-A"},{"itemCode":"PT-A","kind":"PT","level":1,"fgQty":10,"required":10,"parentCode":"FG-A"},{"itemCode":"BG-A","kind":"BG","level":1,"fgQty":10,"required":10,"parentCode":"FG-A"}],"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"GR","itemCode":"SE-A","name":"งานทดสอบ","kind":"SE","uom":"pcs","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select ds_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"PT-A","kind":"PT","name":"แกนพลาสติก A","ownerDept":"PT","uom":"pcs"},
  {"code":"BG-A","kind":"BG","name":"กระเป๋า A","ownerDept":"BG","uom":"pcs"}]}}'::jsonb, 'importFlat');
select ds_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251225-27001"}'::jsonb))), 'createOrder');
select ds_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(ds_t.order_row('251225-27001') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-7-GR","orderId":"251225-27001"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-7-PT","orderId":"251225-27001","dept":"PT","itemCode":"PT-A","kind":"PT"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-7-BG","orderId":"251225-27001","dept":"BG","itemCode":"BG-A","kind":"BG"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-7-PK","orderId":"251225-27001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))), 'releaseOrder');
select is(ds_t.order_row('251225-27001') ->> 'status', 'released', 'the order is released with its GR, PT, BG and PK jobs');
select ok((public.app_bom_master() -> 'grWorkers') @> jsonb_build_array(jsonb_build_object('id', current_setting('test.p_sbx_pt_staff'), 'dept', 'PT'),
                                                         jsonb_build_object('id', current_setting('test.p_sbx_bg_staff'), 'dept', 'BG'),
                                                         jsonb_build_object('id', current_setting('test.p_sbx_pk_staff'), 'dept', 'PK'),
                                                         jsonb_build_object('id', current_setting('test.p_sbx_gr_staff'), 'dept', 'GR'))
      and (public.app_bom_master() -> 'grWorkers' -> 0 ->> 'dept') = 'GR'
      and not ((public.app_bom_master() -> 'grWorkers') @> jsonb_build_array(jsonb_build_object('id', current_setting('test.p_sbx_wh_staff')))),
  'the worker list names the GR, PT, BG and PK workers with their department, GR first, and nobody of WH');

-- 5. saveGrConfig ต่อแผนก ------------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_staff')::uuid);
select throws_ok($$ select ds_t.config('PT', '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'PT staff cannot change the PT config');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.config('PT', '{"steps":[{"code":"GR-01","name":"รีด","kind":"main","seq":1,"active":true}]}'::jsonb) $$, 'BOM_INVALID_GR',
  'a PT step code starts with PT-');
select throws_ok($$ select ds_t.config('PT', '{"dept":"XX"}'::jsonb) $$, 'BOM_INVALID_GR', 'an unknown department is refused');
select throws_ok($$ select ds_t.gr('grConfig', jsonb_build_object('steps', private.bom_gr_default_config() -> 'steps', 'reasons', private.bom_gr_default_config() -> 'reasons'), 'saveGrConfig') $$,
  'BOM_FORBIDDEN', 'the PT head cannot change the GR config (no department = GR)');
select lives_ok($$ select ds_t.config('PT', jsonb_build_object('steps', (current_setting('test.cfg_pt')::jsonb -> 'steps')
                                            || '[{"code":"PT-02","name":"ตัดแต่ง","kind":"side","seq":2,"active":true}]'::jsonb)) $$,
  'the PT head saves the PT config with a side step');
select is((select c ->> 'key' || '/' || (c ->> 'dept') || '/' || jsonb_array_length(c -> 'steps') from jsonb_array_elements(public.app_bom_master() -> 'grConfig') c where c ->> 'dept' = 'PT'),
  'pt/PT/2', 'the PT config row is stored with its department');
select ok(not exists (select 1 from jsonb_array_elements(public.app_bom_master() -> 'grConfig') c where c ->> 'dept' = 'GR'),
  'the GR config is still the default (no row)');

-- 6. setGrJobSteps ตามแผนกของงาน ----------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_staff')::uuid);
select throws_ok($$ select ds_t.plan('JOB-7-PT', array['PT-01']) $$, 'BOM_FORBIDDEN', 'PT staff cannot set the steps of a PT job');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.plan('JOB-7-GR', array['GR-09']) $$, 'BOM_FORBIDDEN', 'the PT head cannot set the steps of a GR job');
select throws_ok($$ select ds_t.plan('JOB-7-PT', array['GR-04']) $$, 'BOM_INVALID_GR', 'a PT job takes steps of the PT config only');
select lives_ok($$ select ds_t.plan('JOB-7-PT', array['PT-01']) $$, 'the PT head sets the steps of the PT job');
select public.app_sandbox_enter(current_setting('test.p_sbx_bg_amgr_t')::uuid);
select lives_ok($$ select ds_t.plan('JOB-7-BG', array['BG-02']) $$, 'the BG head sets the default step (no stored BG config)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_amgr_t')::uuid);
select lives_ok($$ select ds_t.plan('JOB-7-PK', array['PK-01', 'PK-02', 'PK-03']) $$, 'the PK head sets the three PK steps');
select is(ds_t.totals('JOB-7-PK'), '0/0/queued', 'a plan alone does not start the PK job');

-- 7. ผลรายวันของ PT: พนักงานของแผนกงานเท่านั้น · วันนี้ · แก้ได้วันที่บันทึก · หัวหน้าทุกวันพร้อมเหตุผล -------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_bg_staff')::uuid);
select throws_ok($$ select ds_t.add(1, 'JOB-7-PT', 'PT-01', 'sbx_bg_staff', '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'BG staff cannot record on a PT job');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select ds_t.add(1, 'JOB-7-PT', 'PT-01', 'sbx_gr_staff', '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor can GR staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_staff')::uuid);
select lives_ok($$ select ds_t.add(1, 'JOB-7-PT', 'PT-01', 'sbx_pt_staff', '{"good":6}'::jsonb) $$, 'PT staff record their own work of today');
select is(ds_t.totals('JOB-7-PT'), '6/0/in_progress', 'the PT job totals come from the last step');
select is(ds_t.rec(ds_t.uid(1)) ->> 'workerName', current_setting('test.n_sbx_pt_staff'), 'the record keeps the PT worker');
select throws_ok($$ select ds_t.add(2, 'JOB-7-PT', 'PT-01', 'sbx_pt_staff', '{"reject":1,"reason":"กาวไม่ติด"}'::jsonb) $$, 'BOM_INVALID_GR',
  'a reject reason comes from the PT list, not the GR list');
select lives_ok($$ select ds_t.add(2, 'JOB-7-PT', 'PT-01', 'sbx_pt_staff', '{"good":1,"reject":1,"reason":"ขึ้นรูปไม่เต็ม"}'::jsonb) $$, 'PT staff record a reject with a PT reason');
select is(ds_t.totals('JOB-7-PT'), '7/1/in_progress', 'good and rejects add up');
select lives_ok($$ select ds_t.edit(1, '{"good":5}'::jsonb) $$, 'PT staff edit their own record on the day they recorded it');
select is(ds_t.totals('JOB-7-PT'), '6/1/in_progress', 'the totals follow the edit');
select throws_ok($$ select ds_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(ds_t.job('JOB-7-PT')
  || jsonb_build_object('qtyDone', 9, 'reports', (ds_t.job('JOB-7-PT') -> 'reports') || '[{"good":3,"reject":0,"note":"รายงานแบบเดิม"}]'::jsonb)))), 'reportJob') $$,
  'BOM_INVALID_JOB', 'the old report cannot type totals of a PT job that has steps');
-- ผลที่บันทึกเมื่อสองวันก่อน (ย้อนเวลาบันทึกตรงในตาราง) แก้ / ยกเลิกไม่ได้แล้วสำหรับพนักงาน
reset role;
update public.bom_gr_records set created_at = created_at - interval '2 days' where id = ds_t.uid(2)::uuid;
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select throws_ok($$ select ds_t.edit(2, '{"good":2}'::jsonb) $$, 'BOM_FORBIDDEN', 'PT staff cannot edit a record made on an earlier day');
select throws_ok($$ select ds_t.gr('grRecords', jsonb_build_object('id', ds_t.uid(2), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'BOM_FORBIDDEN', 'nor cancel it');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.edit(2, '{"good":2,"editReason":""}'::jsonb) $$, 'BOM_INVALID_GR', 'the head''s edit needs a reason too');
select lives_ok($$ select ds_t.edit(2, '{"good":2}'::jsonb) $$, 'the PT head edits a record of any day with a reason');
select is(ds_t.rec(ds_t.uid(2)) -> 'edits' -> 0 ->> 'reason', 'นับผิด', 'the history keeps the reason');
select throws_ok($$ select ds_t.add(3, 'JOB-7-PT', 'PT-01', 'sbx_bg_staff', '{}'::jsonb) $$, 'BOM_INVALID_GR', 'the worker must be in PT');
select lives_ok($$ select ds_t.add(3, 'JOB-7-PT', 'PT-01', 'sbx_pt_staff', jsonb_build_object('workDate', current_setting('test.d2'))) $$,
  'the PT head records for a PT worker two days back');
select is(ds_t.totals('JOB-7-PT'), '8/1/in_progress', 'five + two + one good pieces');

-- 8. ส่งงาน PT / BG → PK (ยอดดีของงาน PT ตอนนี้ 8) ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_staff')::uuid);
select throws_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-PT', 3) $$, 'BOM_FORBIDDEN', 'PT staff cannot send to PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-PT', 9) $$, 'BOM_GR_EXCEEDS', 'no more than the good pieces of the PT job');
select throws_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-PT', 1.5) $$, 'BOM_INVALID_GR', 'whole pieces only to PK');
select throws_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-BG', 1) $$, 'BOM_FORBIDDEN', 'the PT head cannot send a BG job');
select throws_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-PK', 1) $$, 'BOM_INVALID_GR', 'a PK job is not sent to PK');
select throws_ok($$ select ds_t.send('sendGrToPk', 301, 'JOB-7-PT', 1) $$, 'BOM_FORBIDDEN', 'the GR action stays for the GR head');
select lives_ok($$ select ds_t.send('sendToPk', 301, 'JOB-7-PT', 3) $$, 'the PT head sends 3 to PK');
select is(ds_t.ho(ds_t.uid(301)) ->> 'fromDept' || '/' || (ds_t.ho(ds_t.uid(301)) ->> 'toDept') || '/' || (ds_t.ho(ds_t.uid(301)) ->> 'status') || '/' || (ds_t.ho(ds_t.uid(301)) ->> 'itemCode'),
  'PT/PK/sent/PT-A', 'the send waits at PK with its route and the item of the job');
select lives_ok($$ select ds_t.send('sendToPk', 302, 'JOB-7-PT', 5) $$, 'and the other 5');
select throws_ok($$ select ds_t.send('sendToPk', 303, 'JOB-7-PT', 1) $$, 'BOM_GR_EXCEEDS', 'what was sent counts against the good pieces');
select throws_ok($$ select ds_t.gr('grRecords', jsonb_build_object('id', ds_t.uid(3), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'BOM_GR_EXCEEDS',
  'a cancel that leaves the PT good below what was sent is refused');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select ds_t.send('sendGrToPk', 303, 'JOB-7-PT', 1) $$, 'BOM_INVALID_GR', 'sendGrToPk takes GR jobs only, even for a planner');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select ds_t.act('receiveAtPk', 301) $$, 'BOM_FORBIDDEN', 'GR staff cannot receive for PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select ds_t.act('receiveAtPk', 301) $$, 'PK staff receive the whole PT send');
select is(ds_t.ho(ds_t.uid(301)) ->> 'status' || '/' || (ds_t.ho(ds_t.uid(301)) ->> 'receivedBy'), 'received/' || current_setting('test.n_sbx_pk_staff'), 'received by the PK member');
select throws_ok($$ select ds_t.act('cancelHandover', 302, 'ส่งผิด') $$, 'BOM_FORBIDDEN', 'PK staff cannot cancel a PT send');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.act('cancelHandover', 301, 'นับผิด') $$, 'BOM_FORBIDDEN', 'the PT head cannot reverse a PK receipt');
select lives_ok($$ select ds_t.act('cancelHandover', 302, 'ส่งผิด') $$, 'the PT head cancels the unreceived send');
select is(ds_t.ho(ds_t.uid(302)) ->> 'status' || '/' || (ds_t.ho(ds_t.uid(302)) ->> 'cancelReason'), 'cancelled/ส่งผิด', 'cancelled with its reason');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_amgr_t')::uuid);
select lives_ok($$ select ds_t.act('cancelHandover', 301, 'นับผิด') $$, 'the PK head (not a planner) reverses the receipt');
select is(ds_t.ho(ds_t.uid(301)) ->> 'status', 'sent', 'the send waits at PK again');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select ds_t.act('receiveAtPk', 302) $$, 'BOM_INVALID_TRANSITION', 'a cancelled send cannot be received');
select lives_ok($$ select ds_t.act('receiveGrAtPk', 301) $$, 'the GR receive action takes any send to PK');
-- BG → PK
select public.app_sandbox_enter(current_setting('test.p_sbx_bg_staff')::uuid);
select lives_ok($$ select ds_t.add(10, 'JOB-7-BG', 'BG-02', 'sbx_bg_staff', '{"good":8}'::jsonb) $$, 'BG staff record their own sewing');
select is(ds_t.totals('JOB-7-BG'), '8/0/in_progress', 'the BG job totals follow');
select throws_ok($$ select ds_t.send('sendToPk', 310, 'JOB-7-BG', 2) $$, 'BOM_FORBIDDEN', 'BG staff cannot send to PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_bg_amgr_t')::uuid);
select lives_ok($$ select ds_t.send('sendToPk', 310, 'JOB-7-BG', 2) $$, 'the BG head sends 2 to PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select ds_t.act('receiveAtPk', 310) $$, 'PK staff receive the BG send');
select is(ds_t.ho(ds_t.uid(310)) ->> 'fromDept' || '/' || (ds_t.ho(ds_t.uid(310)) ->> 'status'), 'BG/received', 'the BG send is received');
-- GR ผ่าน action ใหม่: กติกาเดิม (เพดานยอดดี)
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select ds_t.send('sendToPk', 311, 'JOB-7-GR', 1) $$, 'BOM_GR_EXCEEDS', 'the GR head may use sendToPk too, capped by the GR good pieces');

-- 9. PK สามขั้น และส่งให้ WH ----------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select ds_t.add(20, 'JOB-7-PK', 'PK-01', 'sbx_pk_staff', '{"good":5}'::jsonb) $$, 'PK staff record the assembly');
select lives_ok($$ select ds_t.add(21, 'JOB-7-PK', 'PK-02', 'sbx_pk_staff', '{"good":5}'::jsonb) $$, 'the bagging');
select lives_ok($$ select ds_t.add(22, 'JOB-7-PK', 'PK-03', 'sbx_pk_staff', '{"good":4}'::jsonb) $$, 'and the boxing');
select is(ds_t.totals('JOB-7-PK'), '4/0/in_progress', 'the PK job good is the last step (boxing)');
select throws_ok($$ select ds_t.send('sendPkToWh', 320, 'JOB-7-PK', 2) $$, 'BOM_FORBIDDEN', 'PK staff cannot send to WH');
select public.app_sandbox_enter(current_setting('test.p_sbx_pt_amgr_t')::uuid);
select throws_ok($$ select ds_t.send('sendPkToWh', 320, 'JOB-7-PK', 2) $$, 'BOM_FORBIDDEN', 'nor can the PT head');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_amgr_t')::uuid);
select throws_ok($$ select ds_t.send('sendPkToWh', 320, 'JOB-7-PK', 5) $$, 'BOM_GR_EXCEEDS', 'no more than the good pieces of the PK job');
select throws_ok($$ select ds_t.send('sendPkToWh', 320, 'JOB-7-PT', 1) $$, 'BOM_INVALID_GR', 'only a PK finished-goods job goes to WH');
select lives_ok($$ select ds_t.send('sendPkToWh', 320, 'JOB-7-PK', 3) $$, 'the PK head sends 3 to WH');
select is(ds_t.ho(ds_t.uid(320)) ->> 'fromDept' || '/' || (ds_t.ho(ds_t.uid(320)) ->> 'toDept') || '/' || (ds_t.ho(ds_t.uid(320)) ->> 'status'), 'PK/WH/sent',
  'the send to WH is recorded with its route');
select throws_ok($$ select ds_t.gr('grRecords', jsonb_build_object('id', ds_t.uid(22), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'BOM_GR_EXCEEDS',
  'a cancel that leaves the PK good below what was sent to WH is refused');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select ds_t.act('receiveAtPk', 320) $$, 'BOM_INVALID_GR', 'a send to WH is not received at PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select ds_t.act('cancelHandover', 320, 'ผิด') $$, 'BOM_INVALID_GR', 'nor cancelled by the PK hand-over action');

-- 10. WH รับไม่เกินที่ PK ส่ง (PK ทำแล้ว 4 ส่ง 3) · ยกเลิกการส่งได้เฉพาะส่วนที่ WH ยังไม่รับ ---------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ds_t.receive_fg(4) $$, 'BOM_FG_EXCEEDS', 'WH cannot receive what PK made but did not send');
select lives_ok($$ select ds_t.receive_fg(2) $$, 'WH receives part of what PK sent');
select throws_ok($$ select ds_t.receive_fg(2) $$, 'BOM_FG_EXCEEDS', 'and no more than the rest of the send');
select lives_ok($$ select ds_t.receive_fg(1) $$, 'WH receives the rest');
select is(ds_t.fg_own(), 3::numeric, 'WH has received what PK sent');
select is(ds_t.order_row('251225-27001') ->> 'status', 'in_progress', 'the order stays open (10 ordered)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select ds_t.act('cancelPkToWh', 320, 'ส่งผิด') $$, 'BOM_FORBIDDEN', 'PK staff cannot cancel a send to WH');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_amgr_t')::uuid);
select throws_ok($$ select ds_t.act('cancelPkToWh', 320, 'ส่งผิด') $$, 'BOM_FG_EXCEEDS', 'a send WH has already received cannot be cancelled');
select throws_ok($$ select ds_t.act('cancelPkToWh', 320, 'ab') $$, 'BOM_INVALID_GR', 'a cancel needs a reason of three characters');
select lives_ok($$ select ds_t.send('sendPkToWh', 321, 'JOB-7-PK', 1) $$, 'the PK head sends the last boxed piece');
select throws_ok($$ select ds_t.send('sendPkToWh', 322, 'JOB-7-PK', 0.5) $$, 'BOM_GR_EXCEEDS', 'nothing is left to send');
select lives_ok($$ select ds_t.act('cancelPkToWh', 321, 'ยังไม่ส่งจริง') $$, 'the part WH has not received can be cancelled');
select is(ds_t.ho(ds_t.uid(321)) ->> 'status' || '/' || (ds_t.ho(ds_t.uid(321)) ->> 'cancelReason') || '/' || (ds_t.ho(ds_t.uid(321)) -> 'moves' -> 1 ->> 'kind'),
  'cancelled/ยังไม่ส่งจริง/cancel', 'cancelled with its reason and history');
select throws_ok($$ select ds_t.act('cancelPkToWh', 321, 'ยังไม่ส่งจริง') $$, 'BOM_INVALID_TRANSITION', 'not twice');
select lives_ok($$ select ds_t.send('sendPkToWh', 323, 'JOB-7-PK', 0.5) $$, 'a send to WH may carry a fraction');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select ds_t.receive_fg(1) $$, 'BOM_FG_EXCEEDS', 'WH receives the fraction only');
select lives_ok($$ select ds_t.receive_fg(0.5) $$, 'WH receives the half piece');

-- 11. ชุดเรคอร์ด -----------------------------------------------------------------------------------------------------------------
select ok(ds_t.ho(ds_t.uid(301)) ?& array['id', 'jobId', 'orderId', 'itemCode', 'qty', 'status', 'note', 'fromDept', 'toDept', 'sentBy', 'sentAt', 'receivedBy', 'receivedAt',
                                          'cancelledBy', 'cancelledAt', 'cancelReason', 'moves'],
  'a hand-over carries its route next to the earlier fields');
select is(public.app_bom_master_since(0) -> 'changes' -> 'grHandovers' -> 'upsert', public.app_bom_master() -> 'grHandovers', 'the delta from version 0 equals the snapshot for the hand-overs');
select is(public.app_bom_master_since(0) -> 'changes' -> 'grConfig' -> 'upsert', public.app_bom_master() -> 'grConfig', 'and for the configs');

-- 12. ล้างข้อมูลทดสอบลบแถวของทุกแผนก ---------------------------------------------------------------------------------------------
select lives_ok($$ select public.app_sandbox_purge_bom() $$, 'the admin purges the BOM test data');
reset role;
select is((select count(*)::integer from public.bom_gr_records where is_test) + (select count(*)::integer from public.bom_gr_handovers where is_test)
          + (select count(*)::integer from public.bom_gr_job_plans where is_test) + (select count(*)::integer from public.bom_gr_config where is_test), 0,
  'no step or hand-over test row is left');

select * from finish();
rollback;
