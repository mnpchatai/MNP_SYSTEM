-- โมดูลแปรรูปยาง GR (โรงงาน ขั้น 2) ของ BOM โหมดทดสอบ (20261214010000_bom_gr_module.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง / สิทธิ์ของห้าตารางใหม่ รายการ action · นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY
-- · saveGrConfig (หัวหน้า GR / กลุ่มวางแผน · พนักงาน GR / RB ไม่ได้ · ขั้นที่มีผลลบไม่ได้ ตั้งไม่ใช้ได้) · setGrJobSteps (หัวหน้า / กลุ่มวางแผน · ขั้นที่มีผลเอาออกไม่ได้)
-- · addGrRecord / editGrRecord / voidGrRecord (พนักงานของตัวเอง วันนี้ / เมื่อวาน แก้ได้วันที่บันทึก · หัวหน้าของทุกคนทุกวัน · เหตุผลทุกครั้ง · งาน done = กลุ่มวางแผน)
-- · ยอดของงานคำนวณใหม่ทุกครั้ง (ดี = ขั้นสุดท้าย · เสีย = ทุกขั้น) · reportJob ของงานที่มีขั้นตอน = BOM_INVALID_JOB · พัก / ทำต่อยังได้
-- · requestRods / cancelRodRequest · sendGrToPk (เพดานยอดดี) / receiveGrAtPk (PK) / cancelGrHandover (ยกเลิก = หัวหน้า GR · ย้อนรับ = หัวหน้า PK)
-- ข้อควรระวัง: ถ้าอ่านตารางตรงในนาม authenticated จะเกิด 42501 และทำให้ทั้งไฟล์ล้ม ("No plan found") อ่านตารางด้วย reset role เท่านั้น
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง สิทธิ์ และรายการ action -------------------------------------------------------------------------------------------
select is((select count(*)::integer from pg_class c
           where c.oid in ('public.bom_gr_config'::regclass, 'public.bom_gr_job_plans'::regclass, 'public.bom_gr_records'::regclass,
                           'public.bom_rod_requests'::regclass, 'public.bom_gr_handovers'::regclass) and c.relrowsecurity), 5,
  'the five GR tables have RLS enabled');
select ok(not exists (
    select 1 from unnest(array['anon', 'authenticated']) r(role),
                  unnest(array['public.bom_gr_config', 'public.bom_gr_job_plans', 'public.bom_gr_records', 'public.bom_rod_requests', 'public.bom_gr_handovers']) t(name),
                  unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, t.name, p.priv)),
  'anon and authenticated have no direct table privilege on the GR tables');
select is((select count(*)::integer from pg_policy p
           where p.polrelid in ('public.bom_gr_config'::regclass, 'public.bom_gr_job_plans'::regclass, 'public.bom_gr_records'::regclass,
                                'public.bom_rod_requests'::regclass, 'public.bom_gr_handovers'::regclass)
             and p.polname like '%\_no\_direct\_access'), 5, 'every GR table has the deny-all policy');
select is((select count(*)::integer from pg_policy p
           where p.polrelid in ('public.bom_gr_config'::regclass, 'public.bom_gr_job_plans'::regclass, 'public.bom_gr_records'::regclass,
                                'public.bom_rod_requests'::regclass, 'public.bom_gr_handovers'::regclass)
             and p.polname = 'lab_only_no_access' and not p.polpermissive), 5, 'every GR table has the restrictive lab-only policy');
select ok(array['bom_gr_config', 'bom_gr_job_plans', 'bom_gr_records', 'bom_rod_requests', 'bom_gr_handovers'] <@ private.sandbox_unguarded_tables(),
  'the GR tables know test mode');
select ok(array['bom_rod_lots', 'bom_rod_moves', 'bom_jobs', 'itrp_requests'] <@ private.sandbox_unguarded_tables() or to_regclass('public.itrp_requests') is null,
  'the replaced list keeps the earlier names');
select ok(array['saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover'] <@ private.bom_client_actions()
          and array['saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover'] <@ private.bom_staff_actions()
          and array['receiveRodsOpening', 'setRodLocation', 'issueRods'] <@ private.bom_staff_actions(),
  'the ten GR actions are on both lists and the earlier actions stay');
select is((select count(*)::integer from pg_proc p
           where p.pronamespace = 'private'::regnamespace and p.prosecdef and p.proconfig @> array['search_path=""']
             and p.proname in ('bom_gr_config_now', 'bom_gr_is_head', 'bom_gr_job_guard', 'bom_gr_recompute', 'bom_gr_save_config', 'bom_gr_save_plan',
                               'bom_gr_save_record', 'bom_gr_save_request', 'bom_gr_save_handover', 'bom_gr_save')), 10,
  'the GR writers and helpers are security definer with an empty search_path');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_records(bigint)'::regprocedure, 'private.bom_delta(bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure, 'public.app_sandbox_purge_bom()'::regprocedure)),
  'the replaced readers and writers are still security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'bom\_gr\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call the GR writers or helpers directly');
select ok(not exists (select 1 from unnest(array['public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'public.app_sandbox_purge_bom()']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs keep their grants (signed-in users only)');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.bom_jobs'::regclass and t.tgname = 'bom_jobs_gr_guard' and not t.tgisinternal),
  'the job table has the GR quantity guard');
select ok(position('bom_gr_records' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0
      and position('bom_rod_requests' in pg_get_functiondef('public.app_sandbox_purge_bom()'::regprocedure)) > 0,
  'the test-data purge removes the GR rows');
select is(jsonb_array_length(private.bom_gr_default_config() -> 'steps') || '/' || jsonb_array_length(private.bom_gr_default_config() -> 'reasons')
          || '/' || (private.bom_gr_default_config() -> 'steps' -> 0 ->> 'code') || '/' || (private.bom_gr_default_config() -> 'steps' -> 10 ->> 'code'),
  '12/7/GR-01/GR-10', 'the default config has twelve steps (GR-01 first, sorting GR-10 among the side steps) and seven reasons');
select set_config('test.cfg', private.bom_gr_default_config()::text, true);

-- 2. บัญชีทดสอบและตัวช่วยของเทสต์ -------------------------------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8ed00000-0000-0000-0000-000000000001', 'grmodule-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ed00000-0000-0000-0000-000000000101', 'GRMODULE-ADMIN', 'Grmodule', 'Admin', 'grmodule-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ed00000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select is((select count(*)::integer from public.employees e join public.departments d on d.id = e.department_id join public.roles r on r.id = e.role_id
           where e.is_test and ((e.employee_no = 'SBX-GR-STAFF' and d.code = 'GR' and r.code = 'staff')
                                or (e.employee_no = 'SBX-GR-AMGR' and d.code = 'GR' and r.code = 'assistant_department_manager')
                                or (e.employee_no = 'SBX-PK-STAFF' and d.code = 'PK' and r.code = 'staff')
                                or (e.employee_no = 'SBX-PK-MGR' and d.code = 'PK' and r.code = 'department_manager')
                                or (e.employee_no = 'SBX-RB-STAFF' and d.code = 'RB') or (e.employee_no = 'SBX-PP-STAFF' and d.code = 'PP'))), 6,
  'the personas used below belong to the departments and roles the rules name');
select set_config('test.today', to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), true);
select set_config('test.d1', to_char((now() at time zone 'Asia/Bangkok')::date - 1, 'YYYY-MM-DD'), true);
select set_config('test.d2', to_char((now() at time zone 'Asia/Bangkok')::date - 2, 'YYYY-MM-DD'), true);
select set_config('test.d3', to_char((now() at time zone 'Asia/Bangkok')::date - 3, 'YYYY-MM-DD'), true);
select set_config('test.tomorrow', to_char((now() at time zone 'Asia/Bangkok')::date + 1, 'YYYY-MM-DD'), true);

create schema gr_t;
grant usage on schema gr_t to authenticated;
create function gr_t.ver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function gr_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, gr_t.ver(), p_action)
$$;
-- ส่งแถวคำขอเดียวในส่วนของ GR (p_base null = เวอร์ชันล่าสุด)
create function gr_t.gr(p_section text, p_row jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(jsonb_build_object(p_section, jsonb_build_object('upsert', jsonb_build_array(p_row))), coalesce(p_base, gr_t.ver()), p_action)
$$;
create function gr_t.uid(p_n integer) returns text language sql immutable as $$ select '00000000-0000-4000-8000-' || lpad(p_n::text, 12, '0') $$;
create function gr_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function gr_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function gr_t.rec(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'grRecords') r where r ->> 'id' = p_id
$$;
create function gr_t.req(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'rodRequests') r where r ->> 'id' = p_id
$$;
create function gr_t.ho(p_id text) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_bom_master() -> 'grHandovers') r where r ->> 'id' = p_id
$$;
-- ยอดของงาน GR: ดี/เสีย/สถานะ
create function gr_t.totals() returns text language sql stable as $$
  select (gr_t.job('JOB-1-GR') ->> 'qtyDone') || '/' || (gr_t.job('JOB-1-GR') ->> 'qtyReject') || '/' || (gr_t.job('JOB-1-GR') ->> 'status')
$$;
-- แถวเพิ่มผล: งาน JOB-1-GR ขั้น GR-09 วันนี้ ผู้ทำ = พนักงาน GR · ส่วนที่ต่างส่งทับด้วย ||
create function gr_t.add(p_n integer, p_extra jsonb) returns jsonb language sql volatile as $$
  select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(p_n), 'jobId', 'JOB-1-GR', 'stepCode', 'GR-09', 'workDate', current_setting('test.today'),
                                                 'workerId', current_setting('test.p_sbx_gr_staff'), 'hours', 8, 'people', 1, 'good', 1, 'reject', 0,
                                                 'reason', '', 'note', '') || p_extra, 'addGrRecord')
$$;
-- แถวแก้ผล: ค่าปัจจุบันของผล + ส่วนที่ต่าง (editReason ตั้งไว้แล้ว)
create function gr_t.edit(p_n integer, p_extra jsonb, p_base bigint default null) returns jsonb language sql volatile as $$
  select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(p_n), 'stepCode', r ->> 'stepCode', 'workDate', r ->> 'workDate', 'workerId', r ->> 'workerId',
                                                 'hours', r -> 'hours', 'people', r -> 'people', 'good', r -> 'good', 'reject', r -> 'reject',
                                                 'reason', coalesce(r ->> 'reason', ''), 'note', r ->> 'note', 'editReason', 'นับผิด') || p_extra, 'editGrRecord', p_base)
  from (select gr_t.rec(gr_t.uid(p_n)) as r) x
$$;
create function gr_t.plan(p_codes text[]) returns jsonb language sql volatile as $$
  select gr_t.gr('grPlans', jsonb_build_object('jobId', 'JOB-1-GR', 'steps', (select jsonb_agg(jsonb_build_object('code', c, 'qtyTarget', 10) order by o) from unnest(p_codes) with ordinality u(c, o))), 'setGrJobSteps')
$$;
-- ตั้งค่า: ค่าเริ่มต้น + ส่วนที่ต่าง
create function gr_t.config(p_extra jsonb, p_base bigint default null) returns jsonb language sql volatile as $$
  select gr_t.gr('grConfig', current_setting('test.cfg')::jsonb || jsonb_build_object('targets', jsonb_build_array(jsonb_build_object('itemCode', 'SE-A', 'stepCode', 'GR-09', 'perHour', 50))) || p_extra,
                 'saveGrConfig', p_base)
$$;
create function gr_t.steps_without(p_code text) returns jsonb language sql stable as $$
  select jsonb_agg(s) from jsonb_array_elements(current_setting('test.cfg')::jsonb -> 'steps') s where s ->> 'code' <> p_code
$$;
create function gr_t.steps_inactive(p_codes text[]) returns jsonb language sql stable as $$
  select jsonb_agg(case when s ->> 'code' = any (p_codes) then s || '{"active":false}'::jsonb else s end) from jsonb_array_elements(current_setting('test.cfg')::jsonb -> 'steps') s
$$;
create function gr_t.audit() returns text language sql stable as $$ select public.app_bom_audit(1) -> 0 ->> 'detail' $$;

-- 3. นอกโหมดทดสอบ: ทุก action ของ GR = BOM_TEST_MODE_ONLY (private.bom_real_open() ยังเป็น false) ------------------------------------------
select set_config('request.jwt.claims', '{"sub":"8ed00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$ select public.app_bom_save_master('{"grConfig":{"upsert":[{}]}}'::jsonb, 0, 'saveGrConfig') $$, 'BOM_TEST_MODE_ONLY',
  'an admin outside test mode cannot save the GR config');
select throws_ok($$ select public.app_bom_save_master('{"grRecords":{"upsert":[{}]}}'::jsonb, 0, 'addGrRecord') $$, 'BOM_TEST_MODE_ONLY',
  'nor record GR work');

-- 4. ข้อมูลตั้งต้น: ชิ้น RB / SE / FG · ใบ 26001 ปล่อยผลิตพร้อมงาน RB / GR (แผน 10) / PK ------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}],"explosion":[{"itemCode":"FG-A","kind":"FG","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","kind":"SE","level":1,"fgQty":10,"required":10,"parentCode":"FG-A"},{"itemCode":"RB-A","kind":"RB","level":2,"fgQty":10,"required":40,"parentCode":"SE-A"},{"itemCode":"RB-B","kind":"RB","level":1,"fgQty":10,"required":5,"parentCode":"FG-A"}],"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-A","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select gr_t.save('{"items":{"upsert":[
  {"code":"FG-A","kind":"FG","name":"สินค้า A","ownerDept":"PK","uom":"set"},
  {"code":"SE-A","kind":"SE","name":"ชิ้นยาง A","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-A","kind":"RB","name":"เส้นยาง A","ownerDept":"RB","uom":"pcs","rubber":{"compound":"CP-1","color":"BK01","lengthMm":1000}},
  {"code":"RB-B","kind":"RB","name":"เส้นยาง B","ownerDept":"RB","uom":"pcs","rubber":{"compound":"CP-1","color":"BK01","lengthMm":1000}}]}}'::jsonb, 'importFlat');
select gr_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || '{"id":"251214-26001"}'::jsonb))), 'createOrder');
select gr_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(gr_t.order_row('251214-26001') || '{"status":"released"}'::jsonb)),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-1-RB","orderId":"251214-26001"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-GR","orderId":"251214-26001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-1-PK","orderId":"251214-26001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))), 'releaseOrder');
select is(gr_t.order_row('251214-26001') ->> 'status', 'released', 'the order is released with its GR job');
select is(public.app_bom_master() -> 'grConfig', '[]'::jsonb, 'no GR config is stored yet (the client uses the defaults)');
select ok((public.app_bom_master() -> 'grWorkers') @> jsonb_build_array(jsonb_build_object('id', current_setting('test.p_sbx_gr_staff'), 'name', current_setting('test.n_sbx_gr_staff')),
                                                         jsonb_build_object('id', current_setting('test.p_sbx_gr_amgr'), 'name', current_setting('test.n_sbx_gr_amgr')))
      and not ((public.app_bom_master() -> 'grWorkers') @> jsonb_build_array(jsonb_build_object('id', current_setting('test.p_sbx_rb_staff')))),
  'the snapshot lists the GR workers of test mode only (personas are inactive by design)');
select is(public.app_bom_master_since(0) -> 'changes' -> 'grWorkers', '{"upsert":[],"delete":[]}'::jsonb, 'the delta never carries the worker list');

-- 5. saveGrConfig -------------------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.config('{}'::jsonb) $$, 'BOM_FORBIDDEN', 'GR staff cannot change the GR config');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select gr_t.config('{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor can RB staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.config(jsonb_build_object('steps', (current_setting('test.cfg')::jsonb -> 'steps') || '[{"code":"GR-01","name":"ซ้ำ","kind":"main","seq":13,"active":true}]'::jsonb)) $$,
  'BOM_INVALID_GR', 'a step code is used once');
select throws_ok($$ select gr_t.config('{"steps":[{"code":"GR-01","name":"รีด","kind":"other","seq":1,"active":true}]}'::jsonb) $$, 'BOM_INVALID_GR', 'a step is main or side');
select throws_ok($$ select gr_t.config('{"steps":[{"code":"X-01","name":"รีด","kind":"main","seq":1,"active":true}]}'::jsonb) $$, 'BOM_INVALID_GR', 'a step code starts with GR-');
select throws_ok($$ select gr_t.config('{"reasons":[]}'::jsonb) $$, 'BOM_INVALID_GR', 'at least one reject reason');
select throws_ok($$ select gr_t.config('{"targets":[{"itemCode":"SE-NOPE","stepCode":"GR-09","perHour":50}]}'::jsonb) $$, 'BOM_INVALID_GR', 'a target needs a known item');
select throws_ok($$ select gr_t.config('{"targets":[{"itemCode":"SE-A","stepCode":"GR-09","perHour":0}]}'::jsonb) $$, 'BOM_INVALID_GR', 'a target is above zero');
select throws_ok($$ select gr_t.config('{"targets":[{"itemCode":"SE-A","stepCode":"GR-99","perHour":5}]}'::jsonb) $$, 'BOM_INVALID_GR', 'a target names a step of the list');
select throws_ok($$ select gr_t.config('{"targets":[{"itemCode":"SE-A","stepCode":"GR-09","perHour":5},{"itemCode":"SE-A","stepCode":"GR-09","perHour":6}]}'::jsonb) $$,
  'BOM_INVALID_GR', 'one target per item and step');
select set_config('test.v_cfg0', gr_t.ver()::text, true);
select lives_ok($$ select gr_t.config('{}'::jsonb) $$, 'the GR head (assistant department manager) saves the config');
select is(jsonb_array_length(public.app_bom_master() -> 'grConfig') || '/' || (public.app_bom_master() -> 'grConfig' -> 0 ->> 'key') || '/'
          || (public.app_bom_master() -> 'grConfig' -> 0 -> 'targets' -> 0 ->> 'perHour') || '/' || (public.app_bom_master() -> 'grConfig' -> 0 ->> 'updatedBy'),
  '1/gr/50/' || current_setting('test.n_sbx_gr_amgr'), 'one config row of test mode with its target and who saved it');
select throws_ok($$ select gr_t.config('{}'::jsonb, current_setting('test.v_cfg0')::bigint) $$, 'BOM_STALE', 'a save from an older version is a conflict');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select gr_t.config('{}'::jsonb) $$, 'a planner saves the config too');

-- 6. setGrJobSteps ------------------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.plan(array['GR-04', 'GR-09']) $$, 'BOM_FORBIDDEN', 'GR staff cannot set the steps of a job');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.plan(array['GR-04', 'GR-99']) $$, 'BOM_INVALID_GR', 'a step must be in the config');
select throws_ok($$ select gr_t.plan(array['GR-04', 'GR-04']) $$, 'BOM_INVALID_GR', 'a step is used once per job');
select throws_ok($$ select gr_t.gr('grPlans', '{"jobId":"JOB-1-RB","steps":[{"code":"GR-04","qtyTarget":10}]}'::jsonb, 'setGrJobSteps') $$, 'BOM_INVALID_GR',
  'only a GR job gets GR steps');
select throws_ok($$ select gr_t.gr('grPlans', '{"jobId":"JOB-1-GR","steps":[{"code":"GR-04","qtyTarget":0}]}'::jsonb, 'setGrJobSteps') $$, 'BOM_INVALID_GR',
  'a step target is at least one');
select throws_ok($$ select gr_t.gr('grRecords', '{"jobId":"JOB-1-GR","steps":[{"code":"GR-04","qtyTarget":10}]}'::jsonb, 'setGrJobSteps') $$, 'BOM_INVALID_GR',
  'the steps go in the plan section only');
select throws_ok($$ select gr_t.add(1, '{}'::jsonb) $$, 'BOM_INVALID_GR', 'a job without steps takes no record');
select lives_ok($$ select gr_t.plan(array['GR-04', 'GR-09']) $$, 'the GR head sets the steps of the job');
select is((select jsonb_agg(s ->> 'code') from jsonb_array_elements((select p -> 'steps' from jsonb_array_elements(public.app_bom_master() -> 'grPlans') p where p ->> 'jobId' = 'JOB-1-GR')) s),
  '["GR-04", "GR-09"]'::jsonb, 'the plan keeps the order of the steps');
select is(gr_t.totals(), '0/0/queued', 'a plan alone does not start the job');

-- 7. addGrRecord: พนักงานของตัวเอง / หัวหน้าของทุกคน · ยอดของงาน ----------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select gr_t.add(1, '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'RB staff cannot record GR work');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select gr_t.add(1, '{}'::jsonb) $$, 'BOM_FORBIDDEN', 'nor can PK staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.add(1, jsonb_build_object('workerId', current_setting('test.p_sbx_gr_amgr'))) $$, 'BOM_FORBIDDEN', 'GR staff record only their own work');
select throws_ok($$ select gr_t.add(1, jsonb_build_object('workDate', current_setting('test.d3'))) $$, 'BOM_FORBIDDEN', 'GR staff record today or yesterday only');
select throws_ok($$ select gr_t.add(1, jsonb_build_object('workDate', current_setting('test.tomorrow'))) $$, 'BOM_FORBIDDEN', 'not tomorrow either');
select throws_ok($$ select gr_t.add(1, '{"stepCode":"GR-05"}'::jsonb) $$, 'BOM_INVALID_GR', 'the step must be in the plan of the job');
select throws_ok($$ select gr_t.add(1, '{"reject":1}'::jsonb) $$, 'BOM_INVALID_GR', 'a reject needs a reason');
select throws_ok($$ select gr_t.add(1, '{"reject":1,"reason":"ไม่มีในรายการ"}'::jsonb) $$, 'BOM_INVALID_GR', 'the reason comes from the list');
select throws_ok($$ select gr_t.add(1, '{"good":0}'::jsonb) $$, 'BOM_INVALID_GR', 'good or reject is above zero');
select throws_ok($$ select gr_t.add(1, '{"hours":25}'::jsonb) $$, 'BOM_INVALID_GR', 'at most 24 hours');
select throws_ok($$ select gr_t.add(1, '{"hours":1.234}'::jsonb) $$, 'BOM_INVALID_GR', 'hours have two decimals at most');
select throws_ok($$ select gr_t.add(1, '{"people":0}'::jsonb) $$, 'BOM_INVALID_GR', 'at least one person');
select throws_ok($$ select gr_t.add(1, '{"good":1.5}'::jsonb) $$, 'BOM_INVALID_GR', 'whole pieces only');
select throws_ok($$ select gr_t.add(1, '{"workDate":"2026-02-30"}'::jsonb) $$, 'BOM_INVALID_GR', 'a real date');
select throws_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', 'not-a-uuid'), 'addGrRecord') $$, 'BOM_INVALID_GR', 'the record id is a uuid');
select throws_ok($$ select gr_t.save('{"grRecords":{"upsert":[]}}'::jsonb, 'addGrRecord') $$, 'BOM_INVALID_GR', 'an empty request is refused');
select throws_ok($$ select gr_t.save(jsonb_build_object('grRecords', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object('id', gr_t.uid(1)), jsonb_build_object('id', gr_t.uid(2))))), 'addGrRecord') $$,
  'BOM_INVALID_GR', 'one record per call');
select set_config('test.bv', gr_t.ver()::text, true);
select lives_ok($$ select gr_t.add(1, '{"stepCode":"GR-04","good":6}'::jsonb) $$, 'GR staff record their own work of today on the first step');
select is(gr_t.rec(gr_t.uid(1)) ->> 'workerName' || '/' || (gr_t.rec(gr_t.uid(1)) ->> 'createdBy') || '/' || (gr_t.rec(gr_t.uid(1)) ->> 'status'),
  current_setting('test.n_sbx_gr_staff') || '/' || current_setting('test.n_sbx_gr_staff') || '/active', 'the record keeps the worker and who recorded it');
select is(gr_t.totals(), '0/0/in_progress', 'good of a step before the last does not count yet, but the job has started');
select is(gr_t.order_row('251214-26001') ->> 'status', 'in_progress', 'the order is in progress');
select is(gr_t.ver(), current_setting('test.bv')::bigint + 1, 'one BOM counter step');
select ok(gr_t.audit() like '%grRecords +1%' and gr_t.audit() like '%jobs +1%', 'the history counts the record and the job');
select throws_ok($$ select gr_t.add(1, '{"stepCode":"GR-04","good":6}'::jsonb) $$, 'BOM_INVALID_GR', 'a record id is used once (a second press counts nothing)');
select lives_ok($$ select gr_t.add(2, jsonb_build_object('stepCode', 'GR-04', 'workDate', current_setting('test.d1'))) $$, 'GR staff record yesterday''s work');
select lives_ok($$ select gr_t.add(3, '{"good":4,"reject":1,"reason":"ขนาดไม่ได้"}'::jsonb) $$, 'GR staff record the last step with a reject and its reason');
select is(gr_t.totals(), '4/1/in_progress', 'good of the last step and rejects of every step make the job totals');
select is((select r ->> 'kind' || '/' || (r ->> 'good') || '/' || (r ->> 'reject') from (select gr_t.job('JOB-1-GR') -> 'reports' -> -1 as r) x),
  'gr/4/1', 'the job history gets one GR item with what was added');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select set_config('test.v_r4', gr_t.ver()::text, true);
select lives_ok($$ select gr_t.add(4, jsonb_build_object('good', 2, 'workDate', current_setting('test.d2'))) $$, 'the GR head records for a worker two days back');
select is(gr_t.totals(), '6/1/in_progress', 'the totals add the head''s record');
select throws_ok($$ select gr_t.add(9, jsonb_build_object('workerId', current_setting('test.p_sbx_rb_staff'))) $$, 'BOM_INVALID_GR', 'the worker must be in GR');
select throws_ok($$ select gr_t.add(9, jsonb_build_object('workDate', current_setting('test.tomorrow'))) $$, 'BOM_INVALID_GR', 'not a future date');

-- 8. งานที่มีขั้นตอน: reportJob ใช้ไม่ได้ · พัก / ทำต่อยังได้ ---------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(gr_t.job('JOB-1-GR')
  || jsonb_build_object('qtyDone', 7, 'reports', (gr_t.job('JOB-1-GR') -> 'reports') || '[{"good":1,"reject":0,"note":"รายงานแบบเดิม"}]'::jsonb)))), 'reportJob') $$,
  'BOM_INVALID_JOB', 'the old report cannot type totals of a job that has GR steps');
select is(gr_t.totals(), '6/1/in_progress', 'the refused report changed nothing');
select lives_ok($$ select gr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(gr_t.job('JOB-1-GR')
  || jsonb_build_object('status', 'hold', 'reports', (gr_t.job('JOB-1-GR') -> 'reports') || '[{"good":0,"reject":0,"note":"รอเครื่องเจียร์"}]'::jsonb)))), 'setJobStatus') $$,
  'GR staff still put the job on hold with a reason');
select throws_ok($$ select gr_t.add(5, '{}'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'a job on hold takes no new record');
select lives_ok($$ select gr_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(gr_t.job('JOB-1-GR') || '{"status":"in_progress"}'::jsonb))), 'setJobStatus') $$,
  'and resume it');

-- 9. editGrRecord / voidGrRecord ---------------------------------------------------------------------------------------------------
select throws_ok($$ select gr_t.edit(1, '{"good":5,"editReason":""}'::jsonb) $$, 'BOM_INVALID_GR', 'an edit needs a reason');
select lives_ok($$ select gr_t.edit(1, '{"good":5}'::jsonb) $$, 'GR staff edit their own record on the day they recorded it');
select is(gr_t.rec(gr_t.uid(1)) ->> 'good' || '/' || jsonb_array_length(gr_t.rec(gr_t.uid(1)) -> 'edits') || '/' || (gr_t.rec(gr_t.uid(1)) -> 'edits' -> 0 ->> 'kind')
          || '/' || (gr_t.rec(gr_t.uid(1)) -> 'edits' -> 0 -> 'before' ->> 'good') || '/' || (gr_t.rec(gr_t.uid(1)) -> 'edits' -> 0 ->> 'reason'),
  '5/1/edit/6/นับผิด', 'the edit keeps the old values and the reason in the history');
select is(gr_t.totals(), '6/1/in_progress', 'an edit of a step before the last keeps the totals');
select throws_ok($$ select gr_t.edit(4, '{"good":3}'::jsonb) $$, 'BOM_FORBIDDEN', 'GR staff cannot keep a work date older than yesterday');
select throws_ok($$ select gr_t.edit(1, jsonb_build_object('workerId', current_setting('test.p_sbx_gr_amgr'))) $$, 'BOM_FORBIDDEN', 'nor move their record to another worker');
-- ผลที่บันทึกเมื่อวาน (ย้อนเวลาบันทึกตรงในตาราง) แก้ไม่ได้แล้วสำหรับพนักงาน
reset role;
update public.bom_gr_records set created_at = created_at - interval '2 days' where id = gr_t.uid(2)::uuid;
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select throws_ok($$ select gr_t.edit(2, '{"good":2}'::jsonb) $$, 'BOM_FORBIDDEN', 'GR staff cannot edit a record made on an earlier day');
select throws_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(2), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'BOM_FORBIDDEN', 'nor cancel it');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.edit(4, '{"good":3}'::jsonb, current_setting('test.v_r4')::bigint) $$, 'BOM_STALE', 'an edit from a version before the record changed is a conflict');
select lives_ok($$ select gr_t.edit(2, '{"good":2}'::jsonb) $$, 'the GR head edits a record of any day');
select lives_ok($$ select gr_t.add(5, jsonb_build_object('workerId', current_setting('test.p_sbx_gr_amgr'))) $$, 'the GR head records their own work');
select is(gr_t.totals(), '7/1/in_progress', 'the totals follow');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(5), 'reason', 'ไม่ใช่ของฉัน'), 'voidGrRecord') $$, 'BOM_FORBIDDEN',
  'GR staff cannot cancel another worker''s record');
select throws_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(3), 'reason', 'ab'), 'voidGrRecord') $$, 'BOM_INVALID_GR', 'a cancel needs a reason of three characters');
select lives_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(3), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'GR staff cancel their own record of today');
select is(gr_t.rec(gr_t.uid(3)) ->> 'status' || '/' || (gr_t.rec(gr_t.uid(3)) ->> 'voidReason') || '/' || (gr_t.rec(gr_t.uid(3)) -> 'edits' -> 0 ->> 'kind'),
  'void/บันทึกซ้ำ/void', 'the record is void with its reason and history');
select is(gr_t.totals(), '3/0/in_progress', 'a void record no longer counts');
select throws_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(3), 'reason', 'บันทึกซ้ำ'), 'voidGrRecord') $$, 'BOM_INVALID_TRANSITION', 'a void record is not cancelled twice');
select throws_ok($$ select gr_t.edit(3, '{"good":1}'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'nor edited');

-- 10. ขั้นตอน / ตั้งค่าเมื่อมีผลแล้ว -------------------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.plan(array['GR-09']) $$, 'BOM_INVALID_GR', 'a step with active records stays in the plan');
select throws_ok($$ select gr_t.config(jsonb_build_object('steps', gr_t.steps_without('GR-04'))) $$, 'BOM_INVALID_GR', 'a step in use cannot leave the config');
select lives_ok($$ select gr_t.config(jsonb_build_object('steps', gr_t.steps_inactive(array['GR-04', 'GR-03']))) $$, 'but it can be set as not in use');
select lives_ok($$ select gr_t.plan(array['GR-04', 'GR-09', 'GR-10']) $$, 'an inactive step already in the plan stays, and a new last step is added');
select is(gr_t.totals(), '0/0/in_progress', 'good now counts at the new last step');
select throws_ok($$ select gr_t.plan(array['GR-04', 'GR-09', 'GR-03']) $$, 'BOM_INVALID_GR', 'a step not in use cannot be added to a plan');
select lives_ok($$ select gr_t.plan(array['GR-04', 'GR-09']) $$, 'the head puts the plan back');
select is(gr_t.totals(), '3/0/in_progress', 'and the totals follow again');

-- 11. งานเสร็จ: เพิ่ม / แก้ได้เฉพาะกลุ่มวางแผน · ยกเลิกจนต่ำกว่าแผน = กลับเป็นกำลังทำ ---------------------------------------------------------------
select lives_ok($$ select gr_t.add(6, '{"good":7}'::jsonb) $$, 'the head records the rest');
select is(gr_t.totals(), '10/0/done', 'reaching the plan finishes the job');
select ok(gr_t.job('JOB-1-GR') ->> 'doneAt' is not null, 'with a done time');
select throws_ok($$ select gr_t.add(7, '{}'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'the GR head cannot add to a done job');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.add(7, '{}'::jsonb) $$, 'BOM_INVALID_TRANSITION', 'nor can GR staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select gr_t.gr('grRecords', jsonb_build_object('id', gr_t.uid(6), 'reason', 'นับผิดทั้งรายการ'), 'voidGrRecord') $$, 'a planner cancels a record of a done job');
select is(gr_t.totals(), '3/0/in_progress', 'below the plan again the job is back in progress');
select ok(gr_t.job('JOB-1-GR') ->> 'doneAt' is null, 'without a done time');

-- 12. requestRods / cancelRodRequest ---------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-A', 'qty', 20), 'requestRods') $$, 'BOM_FORBIDDEN',
  'PK staff cannot ask SR for rods');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-B', 'qty', 20), 'requestRods') $$, 'BOM_INVALID_GR',
  'a rod of the order that this job does not cut is refused');
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-Z', 'qty', 20), 'requestRods') $$, 'BOM_INVALID_GR',
  'an unknown rod is refused');
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-A', 'qty', 0), 'requestRods') $$, 'BOM_INVALID_GR',
  'at least one rod');
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-RB', 'itemCode', 'RB-A', 'qty', 5), 'requestRods') $$, 'BOM_INVALID_GR',
  'a request belongs to a GR job');
select lives_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-A', 'qty', 20, 'note', 'ด่วน'), 'requestRods') $$,
  'GR staff ask SR for the rods of the job');
select is(gr_t.req(gr_t.uid(101)) ->> 'status' || '/' || (gr_t.req(gr_t.uid(101)) ->> 'orderId') || '/' || (gr_t.req(gr_t.uid(101)) ->> 'createdBy'),
  'open/251214-26001/' || current_setting('test.n_sbx_gr_staff'), 'the request is open for the order and keeps who asked');
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-A', 'qty', 20), 'requestRods') $$, 'BOM_INVALID_GR',
  'a request id is used once');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'reason', 'ไม่ต้องการแล้ว'), 'cancelRodRequest') $$, 'BOM_FORBIDDEN',
  'RB staff cannot cancel a GR request');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'reason', ''), 'cancelRodRequest') $$, 'BOM_INVALID_GR', 'a cancel needs a reason');
select lives_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'reason', 'ไม่ต้องการแล้ว'), 'cancelRodRequest') $$, 'the requester cancels');
select is(gr_t.req(gr_t.uid(101)) ->> 'status' || '/' || (gr_t.req(gr_t.uid(101)) ->> 'cancelReason'), 'cancelled/ไม่ต้องการแล้ว', 'the request is cancelled with its reason');
select throws_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(101), 'reason', 'ไม่ต้องการแล้ว'), 'cancelRodRequest') $$, 'BOM_INVALID_TRANSITION', 'not twice');
select lives_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(102), 'jobId', 'JOB-1-GR', 'itemCode', 'RB-A', 'qty', 10), 'requestRods') $$, 'GR staff ask again');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select lives_ok($$ select gr_t.gr('rodRequests', jsonb_build_object('id', gr_t.uid(102), 'reason', 'ขอใหม่ภายหลัง'), 'cancelRodRequest') $$, 'the GR head cancels another member''s request');

-- 13. sendGrToPk / receiveGrAtPk / cancelGrHandover (ยอดดีของงานตอนนี้ 3) ------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'jobId', 'JOB-1-GR', 'qty', 2), 'sendGrToPk') $$, 'BOM_FORBIDDEN', 'GR staff cannot send to PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'jobId', 'JOB-1-GR', 'qty', 4), 'sendGrToPk') $$, 'BOM_GR_EXCEEDS', 'no more than the good pieces of the job');
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'jobId', 'JOB-1-GR', 'qty', 2, 'note', 'รอบเช้า'), 'sendGrToPk') $$, 'the GR head sends 2 to PK');
select is(gr_t.ho(gr_t.uid(201)) ->> 'status' || '/' || (gr_t.ho(gr_t.uid(201)) ->> 'itemCode') || '/' || (gr_t.ho(gr_t.uid(201)) ->> 'sentBy') || '/' || (gr_t.ho(gr_t.uid(201)) -> 'moves' -> 0 ->> 'kind'),
  'sent/SE-A/' || current_setting('test.n_sbx_gr_amgr') || '/send', 'the hand-over waits at PK with the item of the job and its history');
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(202), 'jobId', 'JOB-1-GR', 'qty', 2), 'sendGrToPk') $$, 'BOM_GR_EXCEEDS', 'what was sent counts against the good pieces');
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(202), 'jobId', 'JOB-1-GR', 'qty', 1), 'sendGrToPk') $$, 'the head sends the last piece');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201)), 'receiveGrAtPk') $$, 'BOM_FORBIDDEN', 'GR staff cannot receive for PK');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201)), 'receiveGrAtPk') $$, 'PK staff receive the whole hand-over');
select is(gr_t.ho(gr_t.uid(201)) ->> 'status' || '/' || (gr_t.ho(gr_t.uid(201)) ->> 'receivedBy'), 'received/' || current_setting('test.n_sbx_pk_staff'), 'it is received by the PK member');
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201)), 'receiveGrAtPk') $$, 'BOM_INVALID_TRANSITION', 'a second press receives nothing more');
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'reason', 'นับผิด'), 'cancelGrHandover') $$, 'BOM_FORBIDDEN', 'PK staff cannot reverse a receipt');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'reason', 'นับผิด'), 'cancelGrHandover') $$, 'BOM_FORBIDDEN', 'nor can the GR head');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_mgr')::uuid);
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(201), 'reason', 'นับผิด'), 'cancelGrHandover') $$, 'the PK department manager reverses the receipt');
select is(gr_t.ho(gr_t.uid(201)) ->> 'status' || '/' || coalesce(gr_t.ho(gr_t.uid(201)) ->> 'receivedBy', 'null') || '/' || (gr_t.ho(gr_t.uid(201)) -> 'moves' -> 2 ->> 'kind'),
  'sent/null/unreceive', 'the hand-over waits at PK again and the history keeps the reversal');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(202), 'reason', 'ส่งผิดใบ'), 'cancelGrHandover') $$, 'the GR head cancels an unreceived hand-over');
select is(gr_t.ho(gr_t.uid(202)) ->> 'status' || '/' || (gr_t.ho(gr_t.uid(202)) ->> 'cancelReason'), 'cancelled/ส่งผิดใบ', 'cancelled with its reason');
select lives_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(203), 'jobId', 'JOB-1-GR', 'qty', 1), 'sendGrToPk') $$, 'a cancelled hand-over frees its pieces');
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select throws_ok($$ select gr_t.gr('grHandovers', jsonb_build_object('id', gr_t.uid(202)), 'receiveGrAtPk') $$, 'BOM_INVALID_TRANSITION', 'a cancelled hand-over cannot be received');

-- 14. ชุดเรคอร์ด -----------------------------------------------------------------------------------------------------------------
select is((select array_agg(k order by k collate "C") from jsonb_object_keys(gr_t.rec(gr_t.uid(1))) k),
  array['createdAt', 'createdBy', 'createdById', 'edits', 'good', 'hours', 'id', 'itemCode', 'jobId', 'note', 'orderId', 'people', 'reason', 'reject', 'status',
        'stepCode', 'updatedAt', 'updatedBy', 'voidReason', 'workDate', 'workerId', 'workerName'],
  'a GR record has its twenty-two fields');
select is(public.app_bom_master_since(0) -> 'changes' -> 'grRecords', jsonb_build_object('upsert', public.app_bom_master() -> 'grRecords', 'delete', '[]'::jsonb),
  'the delta from version 0 equals the snapshot for the GR records');
select is(public.app_bom_master_since(0) -> 'changes' -> 'grHandovers' -> 'upsert', public.app_bom_master() -> 'grHandovers', 'and for the hand-overs');

-- 15. ล้างข้อมูลทดสอบลบแถวของ GR ---------------------------------------------------------------------------------------------------
select lives_ok($$ select public.app_sandbox_purge_bom() $$, 'the admin purges the BOM test data');
reset role;
select is((select count(*)::integer from public.bom_gr_records where is_test) + (select count(*)::integer from public.bom_gr_handovers where is_test)
          + (select count(*)::integer from public.bom_rod_requests where is_test) + (select count(*)::integer from public.bom_gr_job_plans where is_test)
          + (select count(*)::integer from public.bom_gr_config where is_test), 0, 'no GR test row is left');

select * from finish();
rollback;
