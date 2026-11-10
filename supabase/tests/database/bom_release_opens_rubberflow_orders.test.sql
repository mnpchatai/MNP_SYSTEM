-- ปล่อยผลิตใบ PI ใน BOM = เปิด WO ใน RubberFlow ให้เอง (20261108020000_bom_release_opens_rubberflow_orders.sql)
-- ตรวจทั้งฝั่งอนุญาตและปฏิเสธ: โครงสร้าง/สิทธิ์ของฟังก์ชัน, ล็อก advisory ของสอง RPC, เลข WO ต่อกัน (เฉพาะวันนี้), ช่องของ WO, กก. จากบรรทัด BOM (kg และ g) / kgPerRoll / weight_g / หน่วย kg,
-- priority และวันครบกำหนด, ผูกงานแบบ auto (งานยัง queued ใบยัง released), เหตุผลที่ข้ามทุกข้อ, ตัวนับ RF เพิ่มครั้งเดียว + app_rf_master_since + audit RF + audit BOM,
-- หัว RB ปล่อย WO ต่อ, พนักงาน RB รายงานงานที่ผูกอัตโนมัติ (BOM ไม่มองว่าผูกใหม่), ป้อนผลผลิตกลับเข้างาน, ผูกด้วยมือยังได้สำหรับงานที่ถูกข้าม,
-- ยกเลิกใบ (WO planned/released ทั้งที่เปิดเองและด้วยมือถูกยกเลิก) และ BOM_RF_ORDER_STARTED (in_progress / on_hold / completed, ไม่เขียนอะไรเลย), เปิดใบกลับเป็นร่างแล้วปล่อยใหม่
-- (authenticated อ่านตารางตรงไม่ได้ จึงอ่าน audit_logs ด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
select ok(not exists (
    select 1 from unnest(array['private.bom_lock_rf()', 'private.bom_rb_job_kg(public.bom_jobs,public.bom_items)', 'private.bom_open_rf_orders(public.employees,text,uuid)',
                               'private.bom_cancel_rf_orders(uuid)', 'private.bom_started_jobs(uuid)',
                               'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)',
                               'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')),
  'clients cannot call the new or replaced private helpers');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.bom_lock_rf()'::regprocedure, 'private.bom_rb_job_kg(public.bom_jobs,public.bom_items)'::regprocedure,
                           'private.bom_open_rf_orders(public.employees,text,uuid)'::regprocedure, 'private.bom_cancel_rf_orders(uuid)'::regprocedure,
                           'private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the new and replaced writers are security definer with an empty search_path');
select ok(has_function_privilege('authenticated', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the save RPC keeps its grants (signed-in users only)');
select is((select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'app_bom_save_master'), 1::bigint, 'there is still one overload of the save RPC');
select is((select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname = 'bom_save_orders'), 1::bigint, 'the old order writer signature was replaced, not duplicated');
select is(pg_get_function_result('private.bom_save_orders(public.employees,text,boolean,jsonb,jsonb,bigint,bigint)'::regprocedure), 'jsonb',
  'the order writer now returns the released ids and the cancelled work orders');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)) > 0
      and position('pg_advisory_xact_lock' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)) > 0
      and position('mnp_bom_rf_master' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure))
        > 0 and position('mnp_bom_rf_master' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)) > 0,
  'both RPCs take the same transaction advisory lock (the BOM-then-RF and RF-then-BOM paths cannot deadlock)');
select ok(position('pg_advisory_xact_lock' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure))
        > position('lab_only_block' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure))
      and position('pg_advisory_xact_lock' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure))
        > position('lab_only_block' in pg_get_functiondef('public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure))
      and position('pg_advisory_xact_lock' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure))
        < position('bom_actor' in pg_get_functiondef('public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the advisory lock comes right after the lab-only guard and before anything else');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(position('BOM_RF_ORDER_STARTED' in pg_get_functiondef('private.bom_cancel_rf_orders(uuid)'::regprocedure)) > 0,
  'the cancel helper raises the new error code');

-- 2. บัญชีทดสอบและค่าที่ใช้ซ้ำ -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8f200000-0000-0000-0000-000000000001', 'rfauto-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f200000-0000-0000-0000-000000000101', 'RFA-ADMIN', 'Rf', 'Auto', 'rfauto-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f200000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
-- วันที่ของเลข WO และเที่ยงคืนของวันนี้ตามเวลา Asia/Bangkok (now() คงที่ตลอดธุรกรรมของเทสต์)
select set_config('test.stamp', to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD'), true);
select set_config('test.wp', 'WO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD') || '-', true);
select set_config('test.today', private.bom_ms((date_trunc('day', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok')::text, true);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-1","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"WO-X","customer":"ACME","customerPo":"PO-1","recipeId":"RC-1","recipeRevision":1,"color":"ดำ","targetQty":100,"producedQty":0,"startDate":1762387200000,"dueDate":4102444800000,"priority":"normal","note":"","status":"planned"}', true);
select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":4102444800000,"due":{"RB":4102444800000,"PK":4102444800000},"dueDefaults":["RB"],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"X","dept":"RB","itemCode":"RB-K","name":"งานทดสอบ","kind":"RB","uom":"pcs","qtyPlanned":100,"qtyRequired":100,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":4102444800000,"status":"queued","externalRef":null,"fgCodes":["FG-A"],"reports":[]}', true);
select set_config('test.expl', '[{"itemCode":"FG-A","level":0,"fgQty":10,"required":10},{"itemCode":"SE-A","level":1,"fgQty":10,"required":20},{"itemCode":"RB-K","level":2,"fgQty":10,"required":40}]', true);
select set_config('request.jwt.claims', '{"sub":"8f200000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 3. ข้อมูลตั้งต้น: วัตถุดิบ สูตร (RC-1 อนุมัติแล้ว RC-2 ยังเป็นร่าง) คอมปาวด์ เส้นยาง BOM ----------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_rf_save(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb))),
  0, 'saveMaterial');
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.rec')::jsonb, current_setting('test.rec')::jsonb || '{"id":"RC-2","productCode":"P-2"}'::jsonb))),
  (public.app_rf_master() ->> 'version')::bigint, 'createRecipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))),
  (public.app_rf_master() ->> 'version')::bigint, 'approveRecipe');
select is((select jsonb_agg(r ->> 'status' order by r ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'recipes') r), '["approved","draft"]'::jsonb,
  'RC-1 is approved by the RB head and RC-2 stays a draft');

select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(jsonb_array_length(public.app_bom_save_master($json$
{
 "compounds": {"upsert": [
   {"code": "DM01", "name": "EPDM ดำ", "recipeId": "RC-1", "recipeName": "สูตร 1"},
   {"code": "DM02", "name": "ไม่ผูกสูตร"},
   {"code": "DM03", "name": "ผูกสูตรร่าง", "recipeId": "RC-2", "recipeName": "สูตร 2"}]},
 "items": {"upsert": [
  {"code": "FG-A", "kind": "FG", "name": "สินค้า A", "ownerDept": "PK", "uom": "set"},
  {"code": "SE-A", "kind": "SE", "name": "ชิ้นยาง A", "ownerDept": "GR", "uom": "pcs"},
  {"code": "DM01", "kind": "CP", "name": "EPDM ดำ", "ownerDept": "RB", "uom": "kg"},
  {"code": "RB-K", "kind": "RB", "name": "เส้นยาง kgPerRoll", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM01", "color": "OR01", "kgPerRoll": 2}},
  {"code": "RB-W", "kind": "RB", "name": "เส้นยาง น้ำหนักชิ้น", "ownerDept": "RB", "uom": "pcs", "weightG": 50, "rubber": {"compound": "DM01"}},
  {"code": "RB-B", "kind": "RB", "name": "เส้นยาง บรรทัด BOM kg", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM01"}},
  {"code": "RB-G", "kind": "RB", "name": "เส้นยาง บรรทัด BOM g", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM01"}},
  {"code": "RB-KG", "kind": "RB", "name": "เส้นยาง หน่วย kg", "ownerDept": "RB", "uom": "kg", "rubber": {"compound": "DM01"}},
  {"code": "RB-N", "kind": "RB", "name": "เส้นยาง ไม่มีสูตร", "ownerDept": "RB", "uom": "pcs"},
  {"code": "RB-U", "kind": "RB", "name": "เส้นยาง คอมปาวด์ไม่ผูก", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM02"}},
  {"code": "RB-M", "kind": "RB", "name": "เส้นยาง ไม่มีคอมปาวด์ในรายการ", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM09"}},
  {"code": "RB-D", "kind": "RB", "name": "เส้นยาง สูตรร่าง", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM03"}},
  {"code": "RB-Z", "kind": "RB", "name": "เส้นยาง คำนวณ กก. ไม่ได้", "ownerDept": "RB", "uom": "pcs", "rubber": {"compound": "DM01"}}]},
 "boms": {"upsert": [
  {"id": "BOM-T-1", "itemCode": "RB-B", "revision": 1, "status": "approved", "ownerDept": "RB",
   "lines": [{"childCode": "DM01", "qty": 0.1, "uom": "kg", "consumerDept": "RB", "producerDept": "RB", "scrapPct": 10, "flags": [], "note": ""}], "changeLog": []},
  {"id": "BOM-T-2", "itemCode": "RB-G", "revision": 1, "status": "approved", "ownerDept": "RB",
   "lines": [{"childCode": "DM01", "qty": 50, "uom": "g", "consumerDept": "RB", "producerDept": "RB", "scrapPct": 0, "flags": [], "note": ""}], "changeLog": []}]}
}
$json$::jsonb, 0, 'importFlat') -> 'changes' -> 'items' -> 'upsert'), 13, 'the planner seeds the compounds, the rubber items and two approved rod BOMs');

-- เลข WO ที่มีอยู่ก่อนปล่อย: -07 ของวันนี้ (ต่อจากนี้เป็น -08) และเลขวันอื่นที่ใหญ่กว่า (ต้องไม่นับ)
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || jsonb_build_object('id', current_setting('test.wp') || '07'),
  current_setting('test.wo')::jsonb || '{"id":"WO-20200101-99"}'::jsonb))), (public.app_rf_master() ->> 'version')::bigint, 'createOrder');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'orders')), 2, 'two manual work orders exist before the first release');

-- ใบ PI ทั้งหกใบ (ร่าง)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26001', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26002', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26003', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26004', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26005', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb),
  current_setting('test.ord')::jsonb || jsonb_build_object('id', '261108-26006', 'items', '[{"fgCode":"FG-A","qty":10,"colorSet":"A","note":""}]'::jsonb, 'explosion', current_setting('test.expl')::jsonb)))),
  (public.app_bom_master() ->> 'version')::bigint, 'createOrder');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'status' = 'draft'), 6, 'six draft orders are ready');

-- 4. ปล่อยผลิต PI 1: เปิดห้าใบ ข้ามห้างาน -------------------------------------------------------
select set_config('test.rf0', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26001'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-A-01","orderId":"261108-26001","itemCode":"RB-K"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-02","orderId":"261108-26001","itemCode":"RB-W","dueAt":1764201600000,"qtyPlanned":7,"qtyRequired":7}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-03","orderId":"261108-26001","itemCode":"RB-B"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-04","orderId":"261108-26001","itemCode":"RB-G"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-05","orderId":"261108-26001","itemCode":"RB-KG","uom":"kg"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-06","orderId":"261108-26001","itemCode":"RB-N"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-07","orderId":"261108-26001","itemCode":"RB-U"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-08","orderId":"261108-26001","itemCode":"RB-M"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-09","orderId":"261108-26001","itemCode":"RB-D"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-10","orderId":"261108-26001","itemCode":"RB-Z"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-GR","orderId":"261108-26001","dept":"GR","itemCode":"SE-A","kind":"SE"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-A-PK","orderId":"261108-26001","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released', 'the order is released and stays released');
select is((select count(*)::integer from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert')), 12, 'twelve jobs were created by the release');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'opened', jsonb_build_array(
  jsonb_build_object('jobId', 'JOB-A-01', 'woId', current_setting('test.wp') || '08', 'kg', 210),
  jsonb_build_object('jobId', 'JOB-A-02', 'woId', current_setting('test.wp') || '09', 'kg', 0.37),
  jsonb_build_object('jobId', 'JOB-A-03', 'woId', current_setting('test.wp') || '10', 'kg', 11),
  jsonb_build_object('jobId', 'JOB-A-04', 'woId', current_setting('test.wp') || '11', 'kg', 5),
  jsonb_build_object('jobId', 'JOB-A-05', 'woId', current_setting('test.wp') || '12', 'kg', 105)),
  'five work orders were opened in job order with consecutive numbers after the highest number of today and the kilograms of each formula (kgPerRoll, piece weight, BOM kg line, BOM g line, kg item)');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'skipped', jsonb_build_array(
  jsonb_build_object('jobId', 'JOB-A-06', 'itemCode', 'RB-N', 'reason', 'ไม่มีรหัสสูตรยาง'),
  jsonb_build_object('jobId', 'JOB-A-07', 'itemCode', 'RB-U', 'reason', 'ยังไม่ผูกสูตร RubberFlow'),
  jsonb_build_object('jobId', 'JOB-A-08', 'itemCode', 'RB-M', 'reason', 'ยังไม่ผูกสูตร RubberFlow'),
  jsonb_build_object('jobId', 'JOB-A-09', 'itemCode', 'RB-D', 'reason', 'สูตร RC-2 ยังไม่อนุมัติ'),
  jsonb_build_object('jobId', 'JOB-A-10', 'itemCode', 'RB-Z', 'reason', 'คำนวณกิโลกรัมไม่ได้')),
  'five jobs were skipped, each with its reason (no compound, compound without recipe, unknown compound, recipe not approved, no kilograms)');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'cancelled', '[]'::jsonb, 'nothing was cancelled by a release');
select is(current_setting('test.res')::jsonb -> 'changes', public.app_bom_master_since((current_setting('test.res')::jsonb ->> 'version')::bigint - 1) -> 'changes',
  'the reply to the release carries the same job changes as the delta RPC (the links included)');
select is((select jsonb_agg(j ->> 'status') from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert') j
           where j ->> 'dept' = 'RB' and j -> 'externalRef' <> 'null'::jsonb), '["queued","queued","queued","queued","queued"]'::jsonb,
  'the linked jobs stay queued');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26001'), 'released',
  'and the order stays released (the first finishing lot that passes starts it)');
select is((select (j -> 'externalRef') - 'linkedAt' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-A-01'),
  jsonb_build_object('system', 'rubberflow', 'woId', current_setting('test.wp') || '08', 'kg', 210, 'by', current_setting('test.n_sbx_pp_staff'), 'auto', true),
  'the link names the system, the work order, the kilograms, the releaser and marks the link as automatic');
select ok((select j -> 'externalRef' ? 'linkedAt' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-A-01'), 'the link time is set');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'dept' <> 'RB' and j -> 'externalRef' <> 'null'::jsonb), 0,
  'jobs of other departments are never linked');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' in ('JOB-A-06', 'JOB-A-07', 'JOB-A-08', 'JOB-A-09', 'JOB-A-10')
           and j -> 'externalRef' = 'null'::jsonb), 5, 'the skipped jobs are left without a link');

-- ช่องของ WO ที่เปิด
select is((select w - 'createdAt' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '08'),
  jsonb_build_object('id', current_setting('test.wp') || '08', 'customer', 'ACME', 'customerPo', '261108-26001', 'recipeId', 'RC-1', 'recipeRevision', 1,
                     'productCode', 'P-1', 'uom', 'pcs', 'color', 'OR01', 'targetQty', 100, 'producedQty', 0,
                     'startDate', current_setting('test.today')::bigint, 'dueDate', 4102444800000, 'priority', 'normal',
                     'note', 'จาก BOM งาน JOB-A-01 · PI 261108-26001 · RB-K 100 pcs ≈ 210 kg · เปิดอัตโนมัติตอนปล่อยใบ',
                     'status', 'planned', 'createdBy', current_setting('test.n_sbx_pp_staff'), 'targetKg', 210, 'kgPerUnit', 2.1, 'sourceJobId', 'JOB-A-01'),
  'the work order carries the PI customer and number, the approved recipe, the job unit, the item color, the quantities, the kilograms per unit, the planned status and the releaser as creator');
select is((select w ->> 'color' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '10'), 'ดำ',
  'an item without a color gets the default color');
select is((select jsonb_build_array(w -> 'targetQty', w -> 'targetKg', w -> 'kgPerUnit') from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '09'),
  '[7, 0.37, 0.0528571428571]'::jsonb, 'the kilograms per unit are rounded to 12 significant digits (0.37 / 7)');
-- ฟังก์ชันใน private เรียกตรงได้เฉพาะเจ้าของ (authenticated ถูกถอนสิทธิ์) จึงเรียกด้วย reset role แล้วกลับเป็น authenticated
reset role;
select is(private.bom_kg_per_unit(2.72, 7000), 0.000388571428571, 'a tiny part keeps 12 significant digits (2.72 / 7000)');
select is(private.bom_kg_per_unit(221.76, 48), 4.62, 'an exact quotient is not padded');
select is(round(2.72 / private.bom_kg_per_unit(2.72, 7000), 3), 7000.000, 'the received kilograms convert back to the planned pieces');
set local role authenticated;
select is((select w ->> 'uom' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '12'), 'kg',
  'the work order uses the unit of the job');
select is((select jsonb_build_array(w ->> 'priority', (w ->> 'dueDate')::bigint, (w ->> 'startDate')::bigint)
           from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '09'),
  jsonb_build_array('urgent', current_setting('test.today')::bigint, current_setting('test.today')::bigint),
  'a job already past its due date is urgent and its work order is due today, not in the past');

-- ตัวนับ RF เพิ่มครั้งเดียว · delta · audit
select is((public.app_rf_master() ->> 'version')::bigint, current_setting('test.rf0')::bigint + 1, 'the RubberFlow counter moved once for the five work orders');
select is((select jsonb_agg(w ->> 'id' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master_since(current_setting('test.rf0')::bigint) -> 'changes' -> 'orders' -> 'upsert') w),
  jsonb_build_array(current_setting('test.wp') || '08', current_setting('test.wp') || '09', current_setting('test.wp') || '10', current_setting('test.wp') || '11', current_setting('test.wp') || '12'),
  'a RubberFlow client catching up from the earlier version sees exactly the new work orders');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'bom:releaseOrder' and a ->> 'detail' = 'orders +5'
                  and a ->> 'user' = current_setting('test.n_sbx_pp_staff')),
  'the RubberFlow audit page says the five work orders came from the BOM release, by the releaser');
reset role;
select is((select count(*) from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), 1::bigint, 'one RubberFlow audit row for the release');
select is((select entity_id from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), (current_setting('test.rf0')::bigint + 1)::text,
  'the audit row names the new RubberFlow version');
select is((select metadata -> 'counts' from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), '{"orders":{"upsert":5}}'::jsonb,
  'and counts the five work orders');
select is((select (metadata ->> 'base_version')::bigint from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), current_setting('test.rf0')::bigint,
  'and the version it started from');
select is((select metadata -> 'entries' from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), '[]'::jsonb, 'the row carries no client text');
select ok((select metadata ->> 'persona_name' = current_setting('test.n_sbx_pp_staff') and (metadata ->> 'is_test')::boolean
           from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), 'the row names the persona and the test mode');
select is((select actor_id from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:releaseOrder'), '8f200000-0000-0000-0000-000000000101'::uuid,
  'the actor of the row is the real admin behind the persona');
select is((select metadata -> 'rubberflow' from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' = 'releaseOrder'
           and entity_id = current_setting('test.res')::jsonb ->> 'version'), '{"opened":5,"skipped":5,"cancelled":0}'::jsonb,
  'the BOM audit row of the release records how many work orders were opened and skipped');
set local role authenticated;

-- 5. หัว RB ปล่อย WO ที่เปิดเอง · พนักงาน RB รายงานงานที่ผูกอัตโนมัติ · ผูกซ้ำไม่ได้ ------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '08')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') $$, 'RF_FORBIDDEN', 'RB staff still cannot release the automatic work order (the RB head does)');
select throws_ok($$ select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || jsonb_build_object('id', current_setting('test.wp') || '30', 'sourceJobId', 'JOB-A-02')))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder') $$, 'RF_INVALID_SOURCE_JOB', 'a job that already has an automatic work order cannot get a second one by hand');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '08')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'releasedBy', current_setting('test.n_sbx_rb_mgr'),
  'the RB head releases the automatic work order as usual');
-- ระเบียนที่ผ่านตัวเลข JS (double) แล้วส่งกลับ: kgPerUnit 12 เลขนัยสำคัญกลับมาเท่าเดิม ฐานข้อมูลจึงไม่มองว่าเนื้อหาเปลี่ยน
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || jsonb_build_object('status', 'released', 'kgPerUnit', (w ->> 'kgPerUnit')::double precision, 'targetKg', (w ->> 'targetKg')::double precision)
   from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '09')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'released',
  'a work order whose numbers went through a JavaScript double (0.0528571428571) comes back unchanged and can be released');
select is((select j ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-A-01'), 'queued', 'releasing the work order does not touch the BOM job');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(
  (select j || jsonb_build_object('status', 'in_progress', 'qtyDone', 10,
                                  'reports', (j -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 10, 'reject', 0, 'note', '')))
   from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-A-01')))),
  (public.app_bom_master() ->> 'version')::bigint, 'reportJob')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '10',
  'RB staff report on an automatically linked job (the extra auto field is not seen as a new link)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'externalRef' ->> 'auto', 'true', 'and the link keeps its automatic mark');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 -> 'externalRef' ->> 'woId', current_setting('test.wp') || '08', 'and its work order');

-- ป้อนผลผลิตกลับ: ล็อตตกแต่งที่ผ่าน QC ของ WO ที่เปิดเอง (เรียกตัวป้อนกลับตรง ๆ ด้วยแถวล็อตเท่าที่ตัวป้อนอ่าน)
reset role;
select is(private.rf_apply_feedback('ผู้บันทึก', json_populate_record(null::public.rf_lots, '{"lot_no":"FN-AUTO-1","stage":"finishing","good_qty":40,"uom":"pcs"}'::json),
          (select o from public.rf_orders o where o.is_test and o.wo_no = current_setting('test.wp') || '10')), '{"jobs":1,"orders":0}'::jsonb,
  'a passed finishing lot of an automatic work order is fed back into its job (the PI was already started by the report)');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is((select jsonb_build_array(j ->> 'qtyDone', j ->> 'status', j -> 'externalRef' ->> 'woId') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-A-03'),
  jsonb_build_array('40', 'in_progress', current_setting('test.wp') || '10'), 'the job received the quantity and started, and keeps its link');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26001'), 'in_progress',
  'the order started with the first reported work (it was released before)');

-- 6. ยกเลิกใบ: WO planned / released ทั้งที่เปิดเองและด้วยมือถูกยกเลิก ----------------------------------
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26002'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-B-01","orderId":"261108-26002","itemCode":"RB-K"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-B-02","orderId":"261108-26002","itemCode":"RB-W"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-B-03","orderId":"261108-26002","itemCode":"RB-N"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-B-PK","orderId":"261108-26002","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select is((select jsonb_agg(j ->> 'id' order by j ->> 'id') from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '261108-26002' and j -> 'externalRef' <> 'null'::jsonb),
  '["JOB-B-01","JOB-B-02"]'::jsonb, 'the second release opened two more work orders (numbers 13 and 14)');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || jsonb_build_object('id', current_setting('test.wp') || '15', 'sourceJobId', 'JOB-B-03', 'targetKg', 10)))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'sourceJobId', 'JOB-B-03',
  'a job the release skipped can still get its work order by hand (the old manual way)');
select is((select j -> 'externalRef' ? 'auto' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-B-03'), false, 'the manual link has no automatic mark');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '14')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select is((select jsonb_agg(w ->> 'status' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w
           where w ->> 'id' in (current_setting('test.wp') || '13', current_setting('test.wp') || '14', current_setting('test.wp') || '15')),
  '["planned","released","planned"]'::jsonb, 'before the cancel: one automatic planned, one automatic released, one manual planned');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rf1', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26002')))),
  (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'the order is cancelled although it has linked work orders that have not started');
select is(current_setting('test.res')::jsonb -> 'rubberflow', jsonb_build_object('opened', '[]'::jsonb, 'skipped', '[]'::jsonb,
  'cancelled', jsonb_build_array(current_setting('test.wp') || '13', current_setting('test.wp') || '14', current_setting('test.wp') || '15')),
  'the reply lists the cancelled work orders (manual one included) in job order');
select is((select jsonb_agg(w ->> 'status' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w
           where w ->> 'id' in (current_setting('test.wp') || '13', current_setting('test.wp') || '14', current_setting('test.wp') || '15')),
  '["cancelled","cancelled","cancelled"]'::jsonb, 'all three work orders are cancelled in RubberFlow');
select ok((select w ? 'cancelledAt' from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '13'), 'with their cancel time');
select is((public.app_rf_master() ->> 'version')::bigint, current_setting('test.rf1')::bigint + 1, 'the RubberFlow counter moved once for the three cancellations');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '261108-26002'), 0, 'the jobs of the cancelled order are deleted as before');
select is(jsonb_array_length(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'delete'), 4, 'and the delta tells a client about the four deleted jobs');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'bom:cancelOrder' and a ->> 'detail' = 'orders +3'),
  'the RubberFlow audit page says the cancellations came from the BOM');
reset role;
select is((select metadata -> 'rubberflow' from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' = 'cancelOrder'
           and entity_id = current_setting('test.res')::jsonb ->> 'version'), '{"opened":0,"skipped":0,"cancelled":3}'::jsonb, 'and the BOM audit row counts them');
set local role authenticated;

-- 7. ยกเลิก/เปิดใบกลับไม่ได้เมื่อ WO เริ่มผลิตแล้ว (BOM_RF_ORDER_STARTED) · ไม่เขียนอะไรเลย --------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26003'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-C-01","orderId":"261108-26003","itemCode":"RB-K"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-C-02","orderId":"261108-26003","itemCode":"RB-W"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-C-PK","orderId":"261108-26003","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '17')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '17')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select is((select jsonb_agg(w ->> 'status' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w
           where w ->> 'id' in (current_setting('test.wp') || '16', current_setting('test.wp') || '17')), '["planned","in_progress"]'::jsonb,
  'the first work order of PI 3 is planned and the second is in progress');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rf2', public.app_rf_master() ->> 'version', true);
select set_config('test.bv2', public.app_bom_master() ->> 'version', true);
select set_config('test.o', (select o::text from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26003'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), current_setting('test.bv2')::bigint, 'cancelOrder') $$,
  'BOM_RF_ORDER_STARTED', 'an order whose work order is in progress cannot be cancelled');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"draft","explosion":null,"explodedAt":null,"items":[{"fgCode":"FG-A","qty":9,"colorSet":"A","note":""}]}'::jsonb))),
  current_setting('test.bv2')::bigint, 'updateOrderItem') $$,
  'BOM_INVALID_TRANSITION', 'nor reopened as a draft (a work order beyond released counts as a started job)');
select is((select jsonb_agg(w ->> 'status' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w
           where w ->> 'id' in (current_setting('test.wp') || '16', current_setting('test.wp') || '17')), '["planned","in_progress"]'::jsonb,
  'the refused calls cancelled nothing, not even the planned work order that came first');
select is(public.app_rf_master() ->> 'version', current_setting('test.rf2'), 'the RubberFlow counter did not move');
select is(public.app_bom_master() ->> 'version', current_setting('test.bv2'), 'the BOM counter did not move');
select is((select o ->> 'status' from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26003'), 'released', 'the order is untouched');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'orderId' = '261108-26003'), 3, 'and so are its jobs');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"on_hold"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '17')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_RF_ORDER_STARTED', 'a work order on hold also blocks the cancel');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"in_progress"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '17')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"completed"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '17')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_RF_ORDER_STARTED', 'and so does a completed work order');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.o')::jsonb || '{"status":"cancelled"}'::jsonb))), (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder') $$,
  'BOM_FORBIDDEN', 'cancelling stays a planner right (RB staff are refused before any work order is looked at)');

-- 8. เปิดใบกลับเป็นร่างแล้วปล่อยใหม่: WO ที่ยังไม่เริ่มถูกยกเลิก ปล่อยใหม่ได้เลขต่อจากเลขสูงสุด -------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26004'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-D-01","orderId":"261108-26004","itemCode":"RB-K"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-D-02","orderId":"261108-26004","itemCode":"RB-W"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-D-PK","orderId":"261108-26004","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select is((select jsonb_agg(w ->> 'id' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'sourceJobId' in ('JOB-D-01', 'JOB-D-02')),
  jsonb_build_array(current_setting('test.wp') || '18', current_setting('test.wp') || '19'), 'PI 4 got work orders 18 and 19');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select w || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = current_setting('test.wp') || '19')))),
  (public.app_rf_master() ->> 'version')::bigint, 'setOrderStatus');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rf3', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"status":"draft","explosion":null,"explodedAt":null}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26004')))),
  (public.app_bom_master() ->> 'version')::bigint, 'updateOrderItem')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'draft', 'a released order whose work orders have not started goes back to draft');
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'cancelled', jsonb_build_array(current_setting('test.wp') || '18', current_setting('test.wp') || '19'),
  'its planned and released work orders were cancelled');
select is((public.app_rf_master() ->> 'version')::bigint, current_setting('test.rf3')::bigint + 1, 'with one RubberFlow version');
select is((select jsonb_agg(w ->> 'status' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'sourceJobId' in ('JOB-D-01', 'JOB-D-02')),
  '["cancelled","cancelled"]'::jsonb, 'RubberFlow shows both as cancelled');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(exists (select 1 from jsonb_array_elements(public.app_rf_audit()) a where a ->> 'action' = 'bom:reopenOrder' and a ->> 'detail' = 'orders +2'),
  'the RubberFlow audit page has its own line for the work orders cancelled by reopening a PI');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || jsonb_build_object('status', 'released', 'explosion', current_setting('test.expl')::jsonb) from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26004'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-D2-01","orderId":"261108-26004","itemCode":"RB-K"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-D2-02","orderId":"261108-26004","itemCode":"RB-W"}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-D2-PK","orderId":"261108-26004","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder');
select is((select jsonb_agg(w ->> 'id' order by w ->> 'id') from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'sourceJobId' in ('JOB-D2-01', 'JOB-D2-02')),
  jsonb_build_array(current_setting('test.wp') || '20', current_setting('test.wp') || '21'),
  'releasing again opens new work orders with the next numbers (the cancelled numbers are not reused)');

-- 9. ข้าม: ไม่มียอดให้ผลิต · ไม่มีอะไรเปิด = ไม่เพิ่ม version ของ RF · ไม่มีงาน RB = ไม่มีช่อง rubberflow ---------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rf4', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26005'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-E-01","orderId":"261108-26005","itemCode":"RB-K","qtyPlanned":0,"qtyRequired":0}'::jsonb,
    current_setting('test.job')::jsonb || '{"id":"JOB-E-PK","orderId":"261108-26005","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'rubberflow', jsonb_build_object('opened', '[]'::jsonb, 'cancelled', '[]'::jsonb,
  'skipped', jsonb_build_array(jsonb_build_object('jobId', 'JOB-E-01', 'itemCode', 'RB-K', 'reason', 'ไม่มียอดให้ผลิต'))),
  'a job with nothing left to make is skipped with its reason and the release still succeeds');
select is(public.app_rf_master() ->> 'version', current_setting('test.rf4'), 'a release that opened nothing does not move the RubberFlow counter');
reset role;
select is((select count(*) from public.audit_logs where action = 'RF_SAVE' and coalesce((metadata ->> 'version')::bigint, 0) > current_setting('test.rf4')::bigint), 0::bigint, 'and writes no RubberFlow audit row');
select is((select metadata -> 'rubberflow' from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata ->> 'client_action' = 'releaseOrder'
           and entity_id = current_setting('test.res')::jsonb ->> 'version'), '{"opened":0,"skipped":1,"cancelled":0}'::jsonb, 'the BOM audit row still records the skip');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_rf_save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || jsonb_build_object('id', current_setting('test.wp') || '22', 'sourceJobId', 'JOB-E-01', 'targetKg', 10)))),
  (public.app_rf_master() ->> 'version')::bigint, 'createOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'sourceJobId', 'JOB-E-01',
  'the manual create-with-source-job path still works for a skipped job');
select is((select j -> 'externalRef' ->> 'woId' from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = 'JOB-E-01'), current_setting('test.wp') || '22',
  'and links it');

-- ใบ PI 5: งานที่ผูกชี้ไป WO ที่ไม่มีในตาราง (ข้อมูลค้าง) ยกเลิกใบได้ ไม่มี WO ให้ยกเลิก = ข้ามเงียบ ๆ (ไม่มีช่อง rubberflow ในคำตอบ)
reset role;
update public.bom_jobs set external_ref = jsonb_build_object('system', 'rubberflow', 'woId', 'WO-GONE', 'kg', 0) where is_test and job_no = 'JOB-E-01';
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rf6', public.app_rf_master() ->> 'version', true);
select set_config('test.res', public.app_bom_save_master(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  (select o || '{"status":"cancelled"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26005')))),
  (public.app_bom_master() ->> 'version')::bigint, 'cancelOrder')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'a link to a work order that cannot be found does not block the cancel');
select ok(not (current_setting('test.res')::jsonb ? 'rubberflow'), 'and nothing happened in RubberFlow, so the reply has no rubberflow field');
select is(public.app_rf_master() ->> 'version', current_setting('test.rf6'), 'and the RubberFlow counter did not move');

select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.rf5', public.app_rf_master() ->> 'version', true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26006'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-F-01","orderId":"261108-26006","itemCode":"RB-K"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder') $$, 'BOM_FORBIDDEN', 'RB staff cannot release a PI (so they cannot open work orders through it)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_rf_master() ->> 'version', current_setting('test.rf5'), 'the refused release moved nothing in RubberFlow');
select set_config('test.res', public.app_bom_save_master(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(
    (select o || '{"status":"released"}'::jsonb from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = '261108-26006'))),
  'jobs', jsonb_build_object('upsert', jsonb_build_array(
    current_setting('test.job')::jsonb || '{"id":"JOB-F-PK","orderId":"261108-26006","dept":"PK","itemCode":"FG-A","kind":"FG","uom":"set"}'::jsonb))),
  (public.app_bom_master() ->> 'version')::bigint, 'releaseOrder')::text, true);
select ok(not (current_setting('test.res')::jsonb ? 'rubberflow'), 'a release without RB jobs has no rubberflow field in the reply');
select is(current_setting('test.res')::jsonb - 'changes', jsonb_build_object('version', (current_setting('test.res')::jsonb ->> 'version')::bigint, 'epoch', current_setting('test.res')::jsonb ->> 'epoch'),
  'and the reply is the usual delta');
select is(public.app_rf_master() ->> 'version', current_setting('test.rf5'), 'RubberFlow is untouched by it');

select * from finish();
rollback;
