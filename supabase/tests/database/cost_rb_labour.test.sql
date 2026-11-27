-- ต้นทุนการผลิต เฟส 2 (20270110010000_cost_rb_labour.sql)
--   อัตราค่าแรงต่อแผนก (อ่าน + แก้: ผู้เห็นต้นทุน) · เวลามาตรฐานของ RB ต่อรหัสสินค้า 7 ขั้น (อ่าน: ผู้เห็นต้นทุน + แผนก RB · แก้: ผู้เห็นต้นทุน + หัวหน้าแผนก RB)
--   ต้นทุนต่อหน่วยของชิ้นงาน BOM (unitCost): ส่งและแก้ได้เฉพาะผู้เห็นต้นทุน · ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกบทบาท / แผนก
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select is((select count(*)::integer from pg_class c where c.oid in ('public.rf_labour_rates'::regclass, 'public.rf_station_standards'::regclass) and c.relrowsecurity), 2,
  'both new tables have RLS enabled');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv),
                             unnest(array['public.rf_labour_rates', 'public.rf_station_standards']) t(name)
                      where has_table_privilege(r.role, t.name, p.priv)),
  'anon and authenticated have no direct privilege on the new tables');
select is((select count(*)::integer from pg_policy p where (p.polrelid = 'public.rf_labour_rates'::regclass and p.polname = 'rf_labour_rates_no_direct_access')
                                                        or (p.polrelid = 'public.rf_station_standards'::regclass and p.polname = 'rf_station_standards_no_direct_access')), 2,
  'both tables have the deny-all policy');
select is((select count(*)::integer from pg_policy p where p.polrelid in ('public.rf_labour_rates'::regclass, 'public.rf_station_standards'::regclass)
                                                       and p.polname = 'lab_only_no_access' and not p.polpermissive), 2,
  'and the restrictive lab-only policy');
select is((select count(*)::integer from pg_trigger g where not g.tgisinternal
            and ((g.tgrelid = 'public.rf_labour_rates'::regclass and g.tgname = 'rf_labour_rates_sandbox_scope')
              or (g.tgrelid = 'public.rf_station_standards'::regclass and g.tgname = 'rf_station_standards_sandbox_scope'))), 2,
  'both tables separate test data from real data by trigger');
select ok(array['rf_labour_rates', 'rf_station_standards', 'rf_material_prices', 'rf_chem_docs', 'client_error_logs', 'itar_requests'] <@ private.sandbox_unguarded_tables(),
  'the new tables are sandbox aware and the patched list keeps the earlier tables');
select ok(position('rf_labour_rates' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_station_standards' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_material_prices' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0
      and position('rf_chem_docs' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0,
  'the RubberFlow purge deletes the test labour data and still deletes the earlier tables');
select ok(not exists (
    select 1 from unnest(array['private.rf_labour_depts()', 'private.rf_standard_steps()', 'private.rf_standard_reader(public.employees)',
                               'private.rf_standard_writer(public.employees)', 'private.rf_parse_standard_steps(jsonb)', 'private.rf_labour_out(public.employees)',
                               'private.bom_records(bigint)', 'private.bom_save_items(uuid,jsonb,bigint,bigint)', 'private.sandbox_unguarded_tables()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'clients cannot call the private helpers');
select is((select count(*)::integer from pg_proc p
           where p.oid in ('private.rf_standard_reader(public.employees)'::regprocedure, 'private.rf_standard_writer(public.employees)'::regprocedure,
                           'private.rf_labour_out(public.employees)'::regprocedure, 'private.bom_records(bigint)'::regprocedure,
                           'private.bom_save_items(uuid,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_rf_labour()'::regprocedure, 'public.app_rf_labour_rate_save(text,numeric,date,text)'::regprocedure,
                           'public.app_rf_station_standard_save(text,date,jsonb,text)'::regprocedure, 'public.app_sandbox_purge_rf()'::regprocedure)
             and p.prosecdef and p.proconfig @> array['search_path=""']), 9,
  'the helpers, the patched BOM functions and the RPCs are security definer with an empty search_path');
select ok(not exists (
    select 1 from unnest(array['public.app_rf_labour()', 'public.app_rf_labour_rate_save(text,numeric,date,text)',
                               'public.app_rf_station_standard_save(text,date,jsonb,text)', 'public.app_sandbox_purge_rf()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the public RPCs are for authenticated only');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('rf_cost_viewer' in pg_get_functiondef('private.bom_records(bigint)'::regprocedure)) > 0
      and position('plannedItems' in pg_get_functiondef('private.bom_records(bigint)'::regprocedure)) > 0,
  'bom_records was patched in place: the cost check is added and the latest definition is kept');
select is((length(pg_get_functiondef('private.bom_save_items(uuid,jsonb,bigint,bigint)'::regprocedure))
           - length(replace(pg_get_functiondef('private.bom_save_items(uuid,jsonb,bigint,bigint)'::regprocedure), 'rf_cost_viewer', ''))) / length('rf_cost_viewer'), 2,
  'bom_save_items checks the cost viewer on insert and on update');

-- 2. บัญชีทดสอบและตัวช่วย ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8ed00000-0000-0000-0000-000000000001', 'labour-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8ed00000-0000-0000-0000-000000000101', 'LAB-ADMIN', 'Labour', 'Admin', 'labour-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8ed00000-0000-0000-0000-000000000001');
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.no, 'ทดสอบ', v.last_name, lower(v.no) || '@sandbox.local', v.last_name || ' (ทดสอบ)', d.id, r.id, false, true
from (values ('SBX-ADMIN-L', 'ผู้ดูแลระบบ', 'MGT', 'admin'), ('SBX-RB-AMGR-L', 'ผู้ช่วย ผจก. RB', 'RB', 'assistant_department_manager'),
             ('SBX-PP-AFM-L', 'ผู้ช่วย ผจก.โรงงาน PP', 'PP', 'assistant_factory_manager'),
             ('SBX-FT-AFM-L', 'ผู้ช่วย ผจก.โรงงาน', 'FT', 'assistant_factory_manager'),
             ('SBX-GR-MGR-L', 'ผจก. GR', 'GR', 'department_manager')) v(no, last_name, dept, role)
join public.departments d on d.code = v.dept
join public.roles r on r.code = v.role;
select is((select count(*)::integer from public.employees where employee_no in ('SBX-ADMIN-L', 'SBX-RB-AMGR-L', 'SBX-PP-AFM-L', 'SBX-FT-AFM-L', 'SBX-GR-MGR-L')), 5,
  'the five extra test personas exist');
select is((select count(*)::integer from public.employees where is_test and employee_no in
            ('SBX-PP-STAFF', 'SBX-RB-STAFF', 'SBX-RB-MGR', 'SBX-ST-STAFF', 'SBX-QA-STAFF', 'SBX-WH-STAFF', 'SBX-FT-FM', 'SBX-MGT-GM')), 8,
  'the seeded personas this test needs exist');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select set_config('test.today', to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'), true);
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็น และการล้างข้อมูลทดสอบต้องไม่ลบ
insert into public.rf_labour_rates (department_code, rate_per_hour, effective_from) values ('RB', 77, date '2026-01-01');
insert into public.rf_station_standards (product_code, effective_from, steps) values ('P-REAL', date '2026-01-01',
  '[{"step":"prep","minutes":1,"workers":1},{"step":"mix1","minutes":1,"workers":1},{"step":"mix2","minutes":1,"workers":1},{"step":"mix3","minutes":1,"workers":1},{"step":"extrusion","minutes":1,"workers":1},{"step":"curing","minutes":1,"workers":1},{"step":"finishing","minutes":1,"workers":1}]');
select is((select count(*)::integer from public.rf_labour_rates where not is_test) + (select count(*)::integer from public.rf_station_standards where not is_test), 2,
  'rows written outside test mode are real rows');

create schema lab_t;
grant usage on schema lab_t to authenticated;
create function lab_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function lab_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, lab_t.rver(), p_action)
$$;
create function lab_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function lab_t.item(p_code text) returns jsonb language sql stable as $$
  select i from jsonb_array_elements(public.app_bom_master() -> 'items') i where i ->> 'code' = p_code
$$;
-- steps ครบ 7 ขั้น: นาทีของแต่ละขั้นตามลำดับ prep mix1 mix2 mix3 extrusion curing finishing คนละ p_workers คน
create function lab_t.steps(p_minutes numeric[], p_workers numeric default 2) returns jsonb language sql immutable as $$
  select jsonb_agg(jsonb_build_object('step', s.step, 'minutes', p_minutes[s.ord], 'workers', p_workers) order by s.ord)
  from unnest(array['prep', 'mix1', 'mix2', 'mix3', 'extrusion', 'curing', 'finishing']) with ordinality as s(step, ord)
$$;
grant execute on all functions in schema lab_t to authenticated;

select set_config('test.steps', lab_t.steps(array[10, 6, 4, 0, 30, 45, 20])::text, true);
select set_config('test.rec', '{"id":"L-1","revision":1,"productCode":"P-L","uom":"m","batchKg":99,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"status":"draft","items":[{"materialCode":"M-L1","stage":0,"kg":10,"unit":"kg"}]}', true);

-- 3. สูตรที่มีรหัสสินค้า (เวลามาตรฐานผูกกับรหัสสินค้าของสูตร) ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8ed00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(lab_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  '{"code":"M-L1","name":"ยางสาธิต L","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}'::jsonb))), 'saveMaterial') is not null,
  'the planner adds a material');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select lives_ok($$ select lab_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.rec')::jsonb))), 'createRecipe') $$,
  'RB drafts a recipe with product code P-L');

-- 4. ใครอ่านอะไร / ใครแก้อะไร -----------------------------------------------------------------------
-- 4.1 ไม่เห็นอะไรเลย: ST QA WH ผู้ช่วย ผจก.โรงงาน (แผนก FT) ผู้จัดการแผนก GR
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select public.app_rf_labour() $$, 'RF_FORBIDDEN', 'ST staff cannot read labour data (they see raw-material prices only)');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'ST staff cannot write a labour rate');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'ST staff cannot write a time standard');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_rf_labour() $$, 'RF_FORBIDDEN', 'QA cannot read labour data');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'QA cannot write a labour rate');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'QA cannot write a time standard');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select public.app_rf_labour() $$, 'RF_FORBIDDEN', 'WH cannot read labour data');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'WH cannot write a labour rate');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'WH cannot write a time standard');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm_l')::uuid);
select throws_ok($$ select public.app_rf_labour() $$, 'RF_FORBIDDEN', 'the assistant factory manager (not in PP) cannot read labour data');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'nor write a labour rate');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'nor write a time standard (the RubberFlow head right does not carry over)');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_mgr_l')::uuid);
select throws_ok($$ select public.app_rf_labour() $$, 'RF_FORBIDDEN', 'the manager of another production department cannot read labour data');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'nor write a time standard');

-- 4.2 แผนก RB: พนักงานอ่านเวลาได้ แก้ไม่ได้ · หัวหน้าแก้เวลาได้ · ไม่มีใครใน RB เห็นหรือแก้อัตราค่าแรง
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_labour(), '{"canSeeRates": false, "canWriteRates": false, "canWriteStandards": false, "rates": [], "standards": []}'::jsonb,
  'RB staff read the (empty) time standards without any right to write; the real rows are not listed');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_FORBIDDEN',
  'RB staff cannot write a time standard');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'RB staff cannot write a labour rate');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'the RB department manager cannot write a labour rate');
select lives_ok($$ select public.app_rf_station_standard_save('P-L', date '2026-01-01', current_setting('test.steps')::jsonb, 'ค่าเปิด') $$,
  'the RB department manager enters the time standard of a product');
select is(public.app_rf_labour() -> 'canWriteStandards', 'true'::jsonb, 'and is told so');
-- ข้อมูลไม่ถูกต้อง
select throws_ok($$ select public.app_rf_station_standard_save('P-NONE', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'the product code must be the product code of a recipe');
select throws_ok($$ select public.app_rf_station_standard_save('P-REAL', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'a product that exists only in real data is not a test product');
select throws_ok($$ select public.app_rf_station_standard_save('', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'the product code is required');
select throws_ok($$ select public.app_rf_station_standard_save(null, current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'a missing product code is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', null, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD', 'the effective date is required');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date + 400, current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'an effective date more than a year ahead is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', date '1999-12-31', current_setting('test.steps')::jsonb) $$, 'RF_INVALID_STANDARD',
  'an effective date before 2000 is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb, repeat('x', 301)) $$, 'RF_INVALID_STANDARD',
  'a note over 300 characters is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, null) $$, 'RF_INVALID_STANDARD', 'the steps are required');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, '{}'::jsonb) $$, 'RF_INVALID_STANDARD', 'the steps must be an array');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb - 6) $$, 'RF_INVALID_STANDARD',
  'all seven steps are required');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{6,step}', '"prep"')) $$, 'RF_INVALID_STANDARD', 'a step cannot be given twice in place of another');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{6,step}', '"packing"')) $$, 'RF_INVALID_STANDARD', 'an unknown step is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,minutes}', '-1')) $$, 'RF_INVALID_STANDARD', 'negative minutes are refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,minutes}', '100001')) $$, 'RF_INVALID_STANDARD', 'minutes above the ceiling are refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,minutes}', '1.234')) $$, 'RF_INVALID_STANDARD', 'minutes finer than two decimals are refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,minutes}', '"10"')) $$, 'RF_INVALID_STANDARD', 'minutes must be a JSON number');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,workers}', '-1')) $$, 'RF_INVALID_STANDARD', 'a negative head count is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,workers}', '1001')) $$, 'RF_INVALID_STANDARD', 'a head count above the ceiling is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date,
    jsonb_set(current_setting('test.steps')::jsonb, '{0,workers}', 'null')) $$, 'RF_INVALID_STANDARD', 'a missing head count is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, lab_t.steps(array[0, 0, 0, 0, 0, 0, 0])) $$, 'RF_INVALID_STANDARD',
  'a standard with no time at all is refused');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, '[1,2,3,4,5,6,7]'::jsonb) $$, 'RF_INVALID_STANDARD',
  'every step must be an object');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_amgr_l')::uuid);
select lives_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, lab_t.steps(array[12, 6, 4, 0, 30, 45, 20], 3)) $$,
  'the RB assistant department manager enters a newer standard');
select lives_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, lab_t.steps(array[12, 6, 4, 0, 30, 45, 20], 3)) $$,
  'pressing save twice with the same values adds nothing');
select lives_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, lab_t.steps(array[12.5, 6, 4, 0, 30, 45, 20], 3), 'แก้เวลาเตรียม') $$,
  'a correction on the same date is a new row');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_FORBIDDEN', 'the RB assistant department manager cannot write a labour rate');
select is((select jsonb_agg(jsonb_build_array(s ->> 'productCode', s ->> 'effectiveFrom', (s -> 'steps' -> 0 ->> 'minutes')::numeric, (s -> 'steps' -> 0 ->> 'workers')::numeric, s ->> 'note') order by t.ord)
           from jsonb_array_elements(public.app_rf_labour() -> 'standards') with ordinality as t(s, ord)),
  jsonb_build_array(
    jsonb_build_array('P-L', current_setting('test.today'), 12.5, 3, 'แก้เวลาเตรียม'),
    jsonb_build_array('P-L', current_setting('test.today'), 12, 3, ''),
    jsonb_build_array('P-L', '2026-01-01', 10, 2, 'ค่าเปิด')),
  'the list keeps every row: newest effective date first, and on the same date the latest entry first');
select is((select jsonb_agg(e ->> 'step' order by t.ord) from jsonb_array_elements(public.app_rf_labour() -> 'standards' -> 0 -> 'steps') with ordinality as t(e, ord)),
  '["prep", "mix1", "mix2", "mix3", "extrusion", "curing", "finishing"]'::jsonb, 'the steps are stored in work order');
select ok((public.app_rf_labour() -> 'standards' -> 0 ->> 'createdBy') like 'ทดสอบ%' and (public.app_rf_labour() -> 'standards' -> 0 ->> 'createdAt')::bigint > 0,
  'each row says who entered it and when');

-- 4.3 ผู้เห็นต้นทุน: แผนก PP / GM / ผจก.โรงงาน / admin อ่านและแก้ได้ทั้งอัตราค่าแรงและเวลามาตรฐาน
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_labour() - 'standards', '{"canSeeRates": true, "canWriteRates": true, "canWriteStandards": true, "rates": []}'::jsonb,
  'PP staff read the (empty) rate list with the right to write; the real rate is not listed');
select is(jsonb_array_length(public.app_rf_labour() -> 'standards'), 3, 'and every time standard row');
select lives_ok($$ select public.app_rf_labour_rate_save('RB', 55.5, date '2026-01-01', 'อัตราเปิด') $$, 'PP staff enter the RB labour rate');
select throws_ok($$ select public.app_rf_labour_rate_save('ST', 60, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'the department must be a production department');
select throws_ok($$ select public.app_rf_labour_rate_save(null, 60, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'the department is required');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 0, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'the rate must be above zero');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', -5, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'a negative rate is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', null, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'a missing rate is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 'NaN'::numeric, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'NaN is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 100001, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'a rate above the ceiling is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60.123, current_setting('test.today')::date) $$, 'RF_INVALID_LABOUR', 'more than two decimals is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, null) $$, 'RF_INVALID_LABOUR', 'the effective date is required');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date + 400) $$, 'RF_INVALID_LABOUR', 'an effective date more than a year ahead is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, date '1999-12-31') $$, 'RF_INVALID_LABOUR', 'an effective date before 2000 is refused');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date, repeat('x', 301)) $$, 'RF_INVALID_LABOUR', 'a note over 300 characters is refused');
select lives_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date + 30, lab_t.steps(array[9, 6, 4, 0, 30, 45, 20])) $$,
  'PP staff enter a time standard that starts in the future');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_afm_l')::uuid);
select lives_ok($$ select public.app_rf_labour_rate_save('GR', 48, current_setting('test.today')::date) $$, 'an assistant factory manager who belongs to PP enters a rate (PP sees everything)');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select lives_ok($$ select public.app_rf_labour_rate_save('RB', 58, current_setting('test.today')::date) $$, 'the general manager enters a newer RB rate');
select lives_ok($$ select public.app_rf_labour_rate_save('RB', 58, current_setting('test.today')::date) $$, 'pressing save twice with the same values adds nothing');
select lives_ok($$ select public.app_rf_station_standard_save('P-L', date '2026-06-01', current_setting('test.steps')::jsonb) $$, 'and a time standard');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select lives_ok($$ select public.app_rf_labour_rate_save('RB', 59, current_setting('test.today')::date, 'ปรับ') $$, 'the factory manager corrects the rate on the same date (a new row)');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_l')::uuid);
select lives_ok($$ select public.app_rf_labour_rate_save('PK', 45, current_setting('test.today')::date + 10) $$, 'the admin enters a rate that starts in the future');
select is((select jsonb_agg(jsonb_build_array(r ->> 'departmentCode', (r ->> 'ratePerHour')::numeric, r ->> 'effectiveFrom', r ->> 'note') order by t.ord)
           from jsonb_array_elements(public.app_rf_labour() -> 'rates') with ordinality as t(r, ord)),
  jsonb_build_array(
    jsonb_build_array('GR', 48, current_setting('test.today'), ''),
    jsonb_build_array('PK', 45, to_char(current_setting('test.today')::date + 10, 'YYYY-MM-DD'), ''),
    jsonb_build_array('RB', 59, current_setting('test.today'), 'ปรับ'),
    jsonb_build_array('RB', 58, current_setting('test.today'), ''),
    jsonb_build_array('RB', 55.5, '2026-01-01', 'อัตราเปิด')),
  'the rate list keeps every row by department: newest effective date first, and on the same date the latest entry first');
select is(jsonb_array_length(public.app_rf_labour() -> 'standards'), 5, 'the admin sees every time standard row');
-- แผนก RB ยังไม่เห็นอัตราค่าแรงแม้มีข้อมูลแล้ว
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select is(public.app_rf_labour() -> 'rates', '[]'::jsonb, 'the RB department manager still gets no labour rate once rates exist');
select is(public.app_rf_labour() -> 'canSeeRates', 'false'::jsonb, 'and is told the rates are hidden');
select is(jsonb_array_length(public.app_rf_labour() -> 'standards'), 5, 'but sees every time standard row');

-- 5. ต้นทุนต่อหน่วยของชิ้นงาน BOM: เฉพาะผู้เห็นต้นทุน ---------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok($$ select public.app_bom_save_master(jsonb_build_object('items', jsonb_build_object('upsert', jsonb_build_array(
    '{"code":"P-L-BOX","kind":"PURCHASED","name":"กล่องสาธิต","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY","unitCost":5.5}'::jsonb))),
    lab_t.bver(), 'saveItem') $$, 'PP staff save a BOM item with a unit cost');
select is((lab_t.item('P-L-BOX') ->> 'unitCost')::numeric, 5.5::numeric, 'PP staff read the unit cost back');
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select is((lab_t.item('P-L-BOX') ->> 'unitCost')::numeric, 5.5::numeric, 'the general manager reads the unit cost');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is((lab_t.item('P-L-BOX') ->> 'unitCost')::numeric, 5.5::numeric, 'the factory manager reads the unit cost');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_l')::uuid);
select is((lab_t.item('P-L-BOX') ->> 'unitCost')::numeric, 5.5::numeric, 'the admin reads the unit cost');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(lab_t.item('P-L-BOX') ->> 'name' = 'กล่องสาธิต' and not (lab_t.item('P-L-BOX') ? 'unitCost'), 'RB staff read the item without its unit cost');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select ok(lab_t.item('P-L-BOX') is not null and not (lab_t.item('P-L-BOX') ? 'unitCost'), 'so does the RB department manager');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(lab_t.item('P-L-BOX') is not null and not (lab_t.item('P-L-BOX') ? 'unitCost'), 'and ST staff (their prices live in the price table)');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm_l')::uuid);
select ok(lab_t.item('P-L-BOX') is not null and not (lab_t.item('P-L-BOX') ? 'unitCost'), 'and the assistant factory manager');
-- เขียนโดยผู้ที่ไม่เห็นต้นทุน: ค่าที่เก็บไว้คงอยู่ ไม่ว่าจะส่งค่าใหม่ ส่ง null หรือไม่ส่งเลย · ชิ้นใหม่ไม่มีต้นทุน (เรียกตัวบันทึกตรงในฐานะ persona นั้น)
reset role;
select lives_ok(format($$ select private.bom_save_items(%L::uuid, '[{"code":"P-L-BOX","kind":"PURCHASED","name":"กล่องสาธิต 2","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY","unitCost":99}]'::jsonb, 1000000, 1000000) $$,
  current_setting('test.p_sbx_rb_mgr')), 'a save by someone who cannot see costs goes through');
select is((select array[i.name, i.unit_cost::text] from public.bom_items i where i.is_test and i.code = 'P-L-BOX'), array['กล่องสาธิต 2', '5.5'],
  'it changes the item but keeps the stored unit cost (the value sent is ignored)');
select lives_ok(format($$ select private.bom_save_items(%L::uuid, '[{"code":"P-L-BOX","kind":"PURCHASED","name":"กล่องสาธิต 3","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY"}]'::jsonb, 1000000, 1000000) $$,
  current_setting('test.p_sbx_rb_mgr')), 'a save without the unit cost (what their client sends) goes through');
select is((select array[i.name, i.unit_cost::text] from public.bom_items i where i.is_test and i.code = 'P-L-BOX'), array['กล่องสาธิต 3', '5.5'],
  'and does not wipe the stored unit cost');
select lives_ok(format($$ select private.bom_save_items(%L::uuid, '[{"code":"P-L-NEW","kind":"PURCHASED","name":"ของใหม่","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY","unitCost":7}]'::jsonb, 1000000, 1000000) $$,
  current_setting('test.p_sbx_rb_mgr')), 'a new item from someone who cannot see costs is created');
select ok((select i.unit_cost is null from public.bom_items i where i.is_test and i.code = 'P-L-NEW'), 'without a unit cost');
select lives_ok(format($$ select private.bom_save_items(%L::uuid, '[{"code":"P-L-BOX","kind":"PURCHASED","name":"กล่องสาธิต 3","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY","unitCost":6.25}]'::jsonb, 1000000, 1000000) $$,
  current_setting('test.p_sbx_pp_staff')), 'a cost viewer changes the unit cost');
select is((select i.unit_cost from public.bom_items i where i.is_test and i.code = 'P-L-BOX'), 6.25::numeric, 'and it is stored');
select lives_ok(format($$ select private.bom_save_items(%L::uuid, '[{"code":"P-L-BOX","kind":"PURCHASED","name":"กล่องสาธิต 3","ownerDept":"ST","uom":"box","weightG":0,"rubber":null,"legacyCodes":[],"active":true,"group":"TOY","unitCost":null}]'::jsonb, 1000000, 1000000) $$,
  current_setting('test.p_sbx_pp_staff')), 'a cost viewer clears the unit cost');
select ok((select i.unit_cost is null from public.bom_items i where i.is_test and i.code = 'P-L-BOX'), 'and it is cleared (whole-record save, as before)');
set local role authenticated;

-- 6. นอกโหมดทดสอบ: ปิด (private.bom_real_open() = false) -------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_l')::uuid);
select lives_ok('select public.app_sandbox_exit()', 'the admin leaves test mode');
select throws_ok($$ select public.app_rf_labour() $$, 'RF_TEST_MODE_ONLY', 'outside test mode the labour data is closed');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'RF_TEST_MODE_ONLY', 'so is the rate entry');
select throws_ok($$ select public.app_rf_station_standard_save('P-REAL', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'RF_TEST_MODE_ONLY',
  'and the time standard entry');
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok($$ select public.app_rf_labour() $$, 'AUTH_REQUIRED', 'no session, no labour data');
select throws_ok($$ select public.app_rf_labour_rate_save('RB', 60, current_setting('test.today')::date) $$, 'AUTH_REQUIRED', 'no session, no rate entry');
select throws_ok($$ select public.app_rf_station_standard_save('P-L', current_setting('test.today')::date, current_setting('test.steps')::jsonb) $$, 'AUTH_REQUIRED',
  'no session, no time standard entry');

-- 7. ตารางเพิ่มอย่างเดียว และการล้างข้อมูลทดสอบ ---------------------------------------------------------------
reset role;
select is((select count(*)::integer from public.rf_labour_rates where is_test), 5, 'five test rate rows were written (the repeated save added none)');
select is((select count(*)::integer from public.rf_station_standards where is_test), 5, 'five test time standard rows were written (the repeated save added none)');
select is((select count(*)::integer from public.rf_labour_rates where is_test and created_by is null)
        + (select count(*)::integer from public.rf_station_standards where is_test and created_by is null), 0, 'every test row records who entered it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8ed00000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.rf_labour_rates $$, '42501', null, 'authenticated cannot read the rate table directly');
select throws_ok($$ select count(*) from public.rf_station_standards $$, '42501', null, 'nor the time standard table');
select throws_ok($$ insert into public.rf_labour_rates (department_code, rate_per_hour, effective_from) values ('RB', 1, date '2026-01-01') $$, '42501', null,
  'nor insert a rate');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select lives_ok('select public.app_sandbox_purge_rf()', 'the admin in test mode purges the RubberFlow test data');
reset role;
select is((select count(*)::integer from public.rf_labour_rates where is_test) + (select count(*)::integer from public.rf_station_standards where is_test), 0,
  'the purge removed the test rates and time standards');
select is((select count(*)::integer from public.rf_labour_rates where not is_test) + (select count(*)::integer from public.rf_station_standards where not is_test), 2,
  'and kept the real rows');

select * from finish();
rollback;
