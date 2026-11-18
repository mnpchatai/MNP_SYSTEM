-- กลุ่มแก้ 2 หลังทดสอบซ้ำ (20261129010000_bom_group2_rules.sql) ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกกติกา:
--   N1  ฝ่ายวางแผนปิดงานที่ผูก WO: planned / released ยกเลิก · in_progress / on_hold หยุด (ล็อตคงอยู่) · completed คงเดิม · RF version +1 และ audit bom:closeJob
--       ปิดไม่สำเร็จไม่แตะ WO · งานที่ไม่ผูก WO ไม่แตะ RubberFlow · ป้อนกลับจาก RubberFlow ของงานที่ยังเปิดยังทำงาน
--   N2  สเปกมิติการฉีดอยู่ที่สูตร (rf_recipes.extrusion_spec): รูปผิดถูกปฏิเสธ · ร่างแก้ได้ · อนุมัติแล้วแก้ไม่ได้ · ล็อตฉีดกักเฉพาะค่าที่สูตรของ WO กำหนด
--   U9  แก้บรรทัด / หมายเหตุของ BOM ในฉบับเดิม: คนเดียวกัน วันเดียวกัน ฉบับล่าสุด ไม่มีใบที่ไม่ใช่ร่างใช้ และต่อท้ายประวัติ · ขาดข้อใด = BOM_REVISION_IMMUTABLE
--   #376 ยอดดี / เสียเปลี่ยนต้องมีรายการรายงานที่ผลรวมตรงกันทุกผู้เรียกรวมฝ่ายวางแผนและ admin · คืนงานที่ยังไม่มียอดเป็นรอคิวแล้วลดแผนยังทำได้
-- (authenticated อ่านตาราง bom_* / rf_* ตรงไม่ได้ จึงอ่านตารางและเรียก private.* ด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok(not exists (
    select 1 from unnest(array[
      'private.rf_parse_extrusion_spec(jsonb)', 'private.rf_save_recipes(uuid,boolean,jsonb,bigint,bigint)', 'private.rf_records(bigint)',
      'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)', 'private.bom_cancel_rf_job(text,text)',
      'private.bom_cancel_rf_orders(uuid)', 'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)',
      'private.bom_save_boms(uuid,text,jsonb,bigint,bigint)']) f(sig)
    where has_function_privilege('anon', f.sig::regprocedure, 'execute') or has_function_privilege('authenticated', f.sig::regprocedure, 'execute')),
  'clients cannot call the new or replaced private helpers');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_save_recipes(uuid,boolean,jsonb,bigint,bigint)'::regprocedure, 'private.rf_records(bigint)'::regprocedure,
                           'private.rf_save_lots(public.employees,text,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.bom_cancel_rf_job(text,text)'::regprocedure, 'private.bom_cancel_rf_orders(uuid)'::regprocedure,
                           'private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure,
                           'private.bom_save_boms(uuid,text,jsonb,bigint,bigint)'::regprocedure,
                           'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the writers are security definer with an empty search_path');
select ok((select p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'private.rf_parse_extrusion_spec(jsonb)'::regprocedure),
  'the spec parser has an empty search_path');
select ok(has_function_privilege('authenticated', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute')
      and not has_function_privilege('anon', 'public.app_bom_save_master(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the BOM save RPC keeps its grants (signed-in users only)');
select is((select count(*) from pg_proc where pronamespace = 'private'::regnamespace and proname = 'bom_save_jobs'), 1::bigint, 'there is one job writer');
select is(pg_get_function_result('private.bom_save_jobs(public.employees,text,boolean,text,jsonb,uuid[],bigint,bigint)'::regprocedure), 'jsonb',
  'the job writer returns the started orders and the cancelled work orders');
select is((select data_type from information_schema.columns where table_schema = 'public' and table_name = 'rf_recipes' and column_name = 'extrusion_spec'), 'jsonb',
  'recipes have a nullable extrusion spec column');
select ok(exists (select 1 from pg_constraint where conname = 'rf_recipes_extrusion_spec_check' and conrelid = 'public.rf_recipes'::regclass),
  'the extrusion spec must be an object when present');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select is(private.rf_parse_extrusion_spec('{"thickness":{"target":2.50,"tol":0.120}}'::jsonb), '{"thickness":{"target":2.5,"tol":0.12}}'::jsonb,
  'the parser keeps the stored shape with trailing zeros trimmed');
select is(private.rf_parse_extrusion_spec('{}'::jsonb), null::jsonb, 'an empty spec is no spec');
select is(private.rf_parse_extrusion_spec('null'::jsonb), null::jsonb, 'a JSON null is no spec');

-- 2. บัญชีทดสอบ ตัวช่วย และค่าที่ใช้ซ้ำ ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8e930000-0000-0000-0000-000000000001', 'bomg2-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e930000-0000-0000-0000-000000000101', 'BOMG2-ADMIN', 'Bomgtwo', 'Admin', 'bomg2-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e930000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;

create schema g2_t;
grant usage on schema g2_t to authenticated;
create function g2_t.bver() returns bigint language sql stable as $$ select (public.app_bom_master() ->> 'version')::bigint $$;
create function g2_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function g2_t.save(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_bom_save_master(p_changes, g2_t.bver(), p_action)
$$;
create function g2_t.rf(p_changes jsonb, p_action text) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, g2_t.rver(), p_action)
$$;
create function g2_t.job(p_no text) returns jsonb language sql stable as $$
  select j from jsonb_array_elements(public.app_bom_master() -> 'jobs') j where j ->> 'id' = p_no
$$;
create function g2_t.order_row(p_no text) returns jsonb language sql stable as $$
  select o from jsonb_array_elements(public.app_bom_master() -> 'orders') o where o ->> 'id' = p_no
$$;
create function g2_t.bom(p_id text) returns jsonb language sql stable as $$
  select b from jsonb_array_elements(public.app_bom_master() -> 'boms') b where b ->> 'id' = p_id
$$;
create function g2_t.wo(p_no text) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = p_no
$$;
create function g2_t.lot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_rf_master() -> 'lots') l where l ->> 'id' = p_no
$$;
create function g2_t.recipe(p_id text, p_rev integer) returns jsonb language sql stable as $$
  select r from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = p_id and (r ->> 'revision')::integer = p_rev
$$;
create function g2_t.recipe_save(p_row jsonb, p_action text) returns jsonb language sql volatile as $$
  select g2_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action)
$$;
-- งาน: แก้ช่องของแถวล่าสุด (p_patch) ด้วย action ที่ระบุ
create function g2_t.set_job(p_no text, p_patch jsonb, p_action text default 'setJobStatus') returns jsonb language sql volatile as $$
  select g2_t.save(jsonb_build_object('jobs', jsonb_build_object('upsert', jsonb_build_array(g2_t.job(p_no) || p_patch))), p_action)
$$;
-- รายงานผล: ยอดดีเพิ่ม p_done พร้อมรายการรายงานที่ยอดดี p_good (ปกติเท่ากัน)
create function g2_t.report(p_no text, p_done numeric, p_good numeric) returns jsonb language sql volatile as $$
  select g2_t.set_job(p_no, jsonb_build_object('status', 'in_progress', 'qtyDone', (g2_t.job(p_no) ->> 'qtyDone')::numeric + p_done,
    'reports', (g2_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', p_good, 'reject', 0, 'note', ''))), 'reportJob')
$$;
-- สถานะ + รายการยอด 0 ที่มีเหตุผล (ปิดงาน / พักงาน)
create function g2_t.zero(p_no text, p_status text, p_note text) returns jsonb language sql volatile as $$
  select g2_t.set_job(p_no, jsonb_build_object('status', p_status,
    'reports', (g2_t.job(p_no) -> 'reports') || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'good', 0, 'reject', 0, 'note', p_note))))
$$;
-- แก้ BOM ฉบับที่มีอยู่: บรรทัดใหม่ หมายเหตุใหม่ (null = เดิม) และต่อท้ายประวัติหนึ่งรายการ (p_log = false ไม่ต่อ)
create function g2_t.edit_bom(p_id text, p_lines jsonb, p_note text default null, p_log boolean default true) returns jsonb language sql volatile as $$
  select g2_t.save(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    g2_t.bom(p_id) || jsonb_build_object('lines', p_lines)
      || case when p_note is null then '{}'::jsonb else jsonb_build_object('note', p_note) end
      || case when p_log then jsonb_build_object('changeLog', (g2_t.bom(p_id) -> 'changeLog')
                                || jsonb_build_array(jsonb_build_object('at', 1, 'by', 'x', 'text', 'แก้ในฉบับเดิม'))) else '{}'::jsonb end))), 'saveBom')
$$;
-- ล็อตฉีด 10 kg จากใบส่งมอบ p_tr (ล็อตผสม p_mx) ของ WO p_wo ด้วยค่ามิติ p_params
create function g2_t.ex(p_id text, p_wo text, p_tr text, p_mx text, p_params jsonb) returns jsonb language sql volatile as $$
  select g2_t.rf(jsonb_build_object('lots', jsonb_build_object('upsert', jsonb_build_array(jsonb_build_object(
    'id', p_id, 'stage', 'extrusion', 'orderId', p_wo, 'uom', 'm', 'machine', 'EX-11 Extruder Ø90', 'shift', 'D', 'dieId', 'DIE-G2',
    'sources', jsonb_build_array(jsonb_build_object('type', 'transfer', 'id', p_tr, 'lotId', p_mx, 'qty', 10)),
    'params', p_params || '{"reworkKg":0}'::jsonb, 'goodQty', 60, 'scrapQty', 1, 'scrapReason', '', 'qc', 'pass')))), 'recordExtrusion')
$$;

select set_config('test.ord', '{"id":"X","customer":"ACME","country":"TH","orderType":"SA","orderedAt":1762387200000,"whDue":1765065600000,"due":{"RB":1763000000000,"PK":1764000000000},"dueDefaults":[],"revision":0,"status":"draft","items":[],"explosion":null,"explodedAt":null,"stockCounts":{},"note":""}', true);
select set_config('test.job', '{"id":"X","orderId":"251129-29001","dept":"RB","itemCode":"RB-GA","name":"เส้นยาง G","kind":"RB","uom":"pcs","qtyPlanned":10,"qtyRequired":10,"stockCounted":null,"qtyDone":0,"qtyReject":0,"dueAt":1764201600000,"status":"queued","externalRef":null,"fgCodes":["FG-G"],"reports":[]}', true);
select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"X","revision":1,"productCode":"","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":2}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"251129-29001","recipeId":"RC-N","recipeRevision":1,"color":"ดำ","targetQty":100,"targetKg":17.5,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select set_config('request.jwt.claims', '{"sub":"8e930000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;

-- 3. N2 สเปกการฉีดของสูตร --------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(g2_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"กำมะถัน"}'::jsonb))), 'saveMaterial') is not null,
  'the planner adds two materials');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"depth":{"target":2,"tol":0.1}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'an unknown dimension is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"thickness":{"target":0,"tol":0.1}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a target of zero is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"thickness":{"target":2.5,"tol":-0.1}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a negative tolerance is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"thickness":{"target":2.5}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a target without a tolerance is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"thickness":{"target":"2.5","tol":0.1}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a number written as text is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"thickness":{"target":2.5,"tol":0.1,"max":3}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'an extra field inside a dimension is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":[2.5]}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a spec that is not an object is refused');
select throws_ok($$ select g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-X","extrusionSpec":{"width":{"target":1000001,"tol":1}}}'::jsonb, 'createRecipe') $$,
  'RF_INVALID_RECIPE', 'a target above 1,000,000 is refused');
select set_config('test.res', g2_t.recipe_save(current_setting('test.rec')::jsonb
  || '{"id":"RC-S","extrusionSpec":{"thickness":{"target":2.50,"tol":0.12},"width":{"target":18,"tol":0.3}}}'::jsonb, 'createRecipe')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'recipes' -> 'upsert' -> 0 -> 'extrusionSpec',
  '{"thickness":{"target":2.5,"tol":0.12},"width":{"target":18,"tol":0.3}}'::jsonb, 'RB drafts a recipe with a thickness and a width spec (no weight per metre)');
select ok(not (g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-N"}'::jsonb, 'createRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ? 'extrusionSpec'),
  'a recipe without a spec has no extrusionSpec field');
select ok(not (g2_t.recipe_save(current_setting('test.rec')::jsonb || '{"id":"RC-E","extrusionSpec":{}}'::jsonb, 'createRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ? 'extrusionSpec'),
  'an empty spec is stored as no spec');
select is(g2_t.recipe_save(g2_t.recipe('RC-S', 1) || '{"extrusionSpec":{"thickness":{"target":2.5,"tol":0.12},"width":{"target":18,"tol":0.25}}}'::jsonb, 'saveRecipe')
            -> 'changes' -> 'recipes' -> 'upsert' -> 0 -> 'extrusionSpec' -> 'width', '{"target":18,"tol":0.25}'::jsonb, 'RB edits the spec of the draft');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select g2_t.recipe_save(g2_t.recipe('RC-S', 1) || '{"status":"approved","extrusionSpec":{"thickness":{"target":2.5,"tol":0.2}}}'::jsonb, 'approveRecipe') $$,
  'RF_INVALID_TRANSITION', 'the spec cannot be changed in the approving call');
select is(g2_t.recipe_save(g2_t.recipe('RC-S', 1) || '{"status":"approved"}'::jsonb, 'approveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'approved',
  'the RB head approves the recipe with its spec');
select is(g2_t.recipe_save(g2_t.recipe('RC-N', 1) || '{"status":"approved"}'::jsonb, 'approveRecipe') -> 'changes' -> 'recipes' -> 'upsert' -> 0 ->> 'status', 'approved',
  'and the recipe without a spec');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select g2_t.recipe_save(g2_t.recipe('RC-S', 1) || '{"extrusionSpec":{"thickness":{"target":2.5,"tol":0.2},"width":{"target":18,"tol":0.25}}}'::jsonb, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'the spec of an approved revision cannot be changed');
select throws_ok($$ select g2_t.recipe_save(g2_t.recipe('RC-S', 1) - 'extrusionSpec', 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'nor removed');
select throws_ok($$ select g2_t.recipe_save(g2_t.recipe('RC-N', 1) || '{"extrusionSpec":{"thickness":{"target":3.2,"tol":0.1}}}'::jsonb, 'saveRecipe') $$,
  'RF_REVISION_IMMUTABLE', 'nor added to an approved revision that had none');
select set_config('test.rv', g2_t.rver()::text, true);
select is(g2_t.recipe_save(g2_t.recipe('RC-S', 1), 'saveRecipe') ->> 'version', current_setting('test.rv'), 'an unchanged copy of the approved revision writes nothing');
select is(g2_t.recipe_save(g2_t.recipe('RC-S', 1) || '{"revision":2,"status":"draft","extrusionSpec":{"thickness":{"target":2.7,"tol":0.05}}}'::jsonb, 'createRecipe')
            -> 'changes' -> 'recipes' -> 'upsert' -> 0 -> 'extrusionSpec', '{"thickness":{"target":2.7,"tol":0.05}}'::jsonb,
  'a new draft revision carries its own spec (the approved revision keeps its spec)');

-- 4. BOM สำหรับ U9 ------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(g2_t.save('{"items":{"upsert":[
  {"code":"FG-G","kind":"FG","name":"สินค้า G","ownerDept":"PK","uom":"set"},
  {"code":"FG-U1","kind":"FG","name":"สินค้า U1","ownerDept":"PK","uom":"set"},
  {"code":"FG-U2","kind":"FG","name":"สินค้า U2","ownerDept":"PK","uom":"set"},
  {"code":"SE-G","kind":"SE","name":"ชิ้นยาง G","ownerDept":"GR","uom":"pcs"},
  {"code":"RB-GA","kind":"RB","name":"เส้นยาง GA","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-GB","kind":"RB","name":"เส้นยาง GB","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-GC","kind":"RB","name":"เส้นยาง GC","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-GD","kind":"RB","name":"เส้นยาง GD","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-GE","kind":"RB","name":"เส้นยาง GE","ownerDept":"RB","uom":"pcs"},
  {"code":"RB-GF","kind":"RB","name":"เส้นยาง GF","ownerDept":"RB","uom":"pcs"},
  {"code":"P-G1","kind":"PURCHASED","name":"กล่อง","ownerDept":"ST","uom":"box"},
  {"code":"P-G2","kind":"PURCHASED","name":"ถุง","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 'importFlat') is not null, 'the planner seeds the items');
select ok(g2_t.save('{"boms":{"upsert":[
  {"id":"BOM-G1-1","itemCode":"FG-U1","revision":1,"status":"approved","lines":[{"childCode":"P-G1","qty":1},{"childCode":"P-G2","qty":2}],"note":"","changeLog":[{"at":1,"by":"x","text":"สร้างใหม่ 2 บรรทัด"}]},
  {"id":"BOM-G2-1","itemCode":"FG-U2","revision":1,"status":"approved","lines":[{"childCode":"P-G1","qty":1}],"note":"","changeLog":[{"at":1,"by":"x","text":"สร้างใหม่ 1 บรรทัด"}]}]}}'::jsonb, 'saveBom') is not null,
  'the planner saves two BOMs today');

-- 5. U9 แก้ในฉบับเดิม ------------------------------------------------------------------------------------------
select set_config('test.res', g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G1","qty":3},{"childCode":"P-G2","qty":2}]'::jsonb)::text, true);
select is(jsonb_build_array(g2_t.bom('BOM-G1-1') ->> 'revision', g2_t.bom('BOM-G1-1') ->> 'status', g2_t.bom('BOM-G1-1') -> 'lines' -> 0 ->> 'qty'), '["1","approved","3"]'::jsonb,
  'the same planner edits the lines of the latest revision on the same day: the revision is edited in place');
select is((select count(*)::integer from jsonb_array_elements(public.app_bom_master() -> 'boms') b where b ->> 'itemCode' = 'FG-U1'), 1, 'no new revision was created');
select is(jsonb_array_length(g2_t.bom('BOM-G1-1') -> 'changeLog'), 2, 'the change log grew by one entry');
select is(g2_t.bom('BOM-G1-1') -> 'changeLog' -> 1 ->> 'by', current_setting('test.n_sbx_pp_staff'), 'signed by the persona');
select ok(exists (select 1 from jsonb_array_elements(current_setting('test.res')::jsonb -> 'changes' -> 'boms' -> 'upsert') b where b ->> 'id' = 'BOM-G1-1'),
  'the delta of the save carries the edited revision');
select ok(g2_t.edit_bom('BOM-G1-1', g2_t.bom('BOM-G1-1') -> 'lines', 'แก้หมายเหตุ') is not null, 'the note can be edited in place too');
select is(jsonb_build_array(g2_t.bom('BOM-G1-1') ->> 'note', g2_t.bom('BOM-G1-1') ->> 'revision'), '["แก้หมายเหตุ","1"]'::jsonb, 'the revision keeps its number with the new note');
select ok(g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G2","qty":2},{"childCode":"P-G1","qty":3}]'::jsonb) is not null, 'a new line order is saved in place');
select is(g2_t.bom('BOM-G1-1') -> 'lines' -> 0 ->> 'childCode', 'P-G2', 'and kept in the order sent');
reset role;
select is((select count(*)::integer from public.bom_bom_lines l join public.bom_boms b on b.id = l.bom_pk where b.is_test and b.bom_id = 'BOM-G1-1'), 2,
  'the stored lines were replaced, not added to');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G1","qty":4}]'::jsonb, null, false) $$,
  'BOM_REVISION_IMMUTABLE', 'an edit in place needs a new change log entry');
select throws_ok($$ select g2_t.save(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(g2_t.bom('BOM-G1-1') || '{"revision":2}'::jsonb))), 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'the revision number of an existing record still cannot change');
-- ผู้วางแผนคนอื่น (หัวหน้าแผนก RB อยู่ในกลุ่มวางแผน) แก้ฉบับของคนอื่นในที่เดิมไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select set_config('test.bv', g2_t.bver()::text, true);
select throws_ok($$ select g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G1","qty":5}]'::jsonb) $$,
  'BOM_REVISION_IMMUTABLE', 'another planner cannot edit a revision approved by someone else in place');
select is(g2_t.bver(), current_setting('test.bv')::bigint, 'and nothing was written');
-- อนุมัติเมื่อวาน (ตามเวลา Asia/Bangkok) = แก้ในที่เดิมไม่ได้
reset role;
update public.bom_boms set approved_at = now() - interval '1 day' where is_test and bom_id = 'BOM-G1-1';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G1","qty":5}]'::jsonb) $$,
  'BOM_REVISION_IMMUTABLE', 'a revision approved on an earlier day cannot be edited in place');
reset role;
update public.bom_boms set approved_at = now() where is_test and bom_id = 'BOM-G1-1';
update public.bom_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
-- revision ใหม่ยังบันทึกได้ (max + 1) แล้วฉบับเดิมที่ถูกแทนที่แก้ไม่ได้ ฉบับใหม่แก้ในที่เดิมได้
select is(g2_t.save(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
  g2_t.bom('BOM-G1-1') || '{"status":"superseded"}'::jsonb,
  '{"id":"BOM-G1-2","itemCode":"FG-U1","revision":2,"status":"approved","lines":[{"childCode":"P-G1","qty":6}],"note":"","changeLog":[{"at":1,"by":"x","text":"ฉบับใหม่"}]}'::jsonb))), 'saveBom')
            -> 'changes' -> 'boms' -> 'upsert' -> 1 ->> 'revision', '2', 'a new revision can still be saved the same day');
select throws_ok($$ select g2_t.edit_bom('BOM-G1-1', '[{"childCode":"P-G1","qty":7}]'::jsonb) $$,
  'BOM_REVISION_IMMUTABLE', 'a superseded revision cannot be edited in place');
select ok(g2_t.edit_bom('BOM-G1-2', '[{"childCode":"P-G1","qty":7}]'::jsonb) is not null, 'the new latest revision can be edited in place');
select is(g2_t.bom('BOM-G1-2') -> 'lines' -> 0 ->> 'qty', '7', 'with the new quantity');
-- ใบร่างที่อ้างฉบับนี้ไม่ล็อก · ใบที่ยกเลิกแล้ว (ไม่ใช่ร่าง) ล็อก
select ok(g2_t.save(jsonb_build_object('customers', jsonb_build_object('upsert', jsonb_build_array('{"name":"ACME","country":"TH","orderType":"SA","note":""}'::jsonb)),
  'orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || jsonb_build_object('id', '251129-29002',
    'items', '[{"fgCode":"FG-U1","qty":5,"colorSet":"A","note":""}]'::jsonb,
    'explosion', '[{"itemCode":"FG-U1","level":0,"bomId":"BOM-G1-2","revision":2,"fgQty":5,"required":5},{"itemCode":"P-G1","level":1,"bomId":null,"revision":null,"fgQty":5,"required":35}]'::jsonb)))), 'createOrder') is not null,
  'a draft order uses the new revision');
select ok(g2_t.edit_bom('BOM-G1-2', '[{"childCode":"P-G1","qty":8}]'::jsonb) is not null, 'a draft order does not lock the revision');
select is(g2_t.bom('BOM-G1-2') -> 'lines' -> 0 ->> 'qty', '8', 'the edit is stored');
select is(g2_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  g2_t.order_row('251129-29002') || '{"status":"cancelled","cancelReason":"ลูกค้ายกเลิก"}'::jsonb))), 'cancelOrder') -> 'changes' -> 'orders' -> 'upsert' -> 0 ->> 'status', 'cancelled',
  'the draft is cancelled');
select throws_ok($$ select g2_t.edit_bom('BOM-G1-2', '[{"childCode":"P-G1","qty":9}]'::jsonb) $$,
  'BOM_REVISION_IMMUTABLE', 'a cancelled order that used the revision locks it');

-- 6. ใบ 29001 ปล่อยผลิต (ใช้ BOM-G2-1) งาน RB ผูก WO หกใบ งาน PK / GR ไม่ผูก --------------------------------------------
select ok(g2_t.save(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.ord')::jsonb || jsonb_build_object('id', '251129-29001',
    'items', '[{"fgCode":"FG-U2","qty":10,"colorSet":"A","note":""}]'::jsonb,
    'explosion', '[{"itemCode":"FG-U2","level":0,"bomId":"BOM-G2-1","revision":1,"fgQty":10,"required":10}]'::jsonb)))), 'createOrder') is not null,
  'the planner creates order 29001 from BOM-G2-1');
select ok(g2_t.save(jsonb_build_object(
  'orders', jsonb_build_object('upsert', jsonb_build_array(g2_t.order_row('251129-29001') || '{"status":"released"}'::jsonb)),
  -- งานหนึ่งงานต่อแผนกต่อชิ้นต่อใบ (unique (order_pk, dept, item_code)) จึงให้งาน RB แต่ละงานเป็นเส้นยางคนละรหัส
  'jobs', jsonb_build_object('upsert', (select jsonb_agg(current_setting('test.job')::jsonb || jsonb_build_object('id', 'JOB-G-' || x, 'itemCode', 'RB-G' || x) order by x) from unnest(array['A', 'B', 'C', 'D', 'E', 'F']) x)
    || jsonb_build_array(current_setting('test.job')::jsonb || '{"id":"JOB-G-PK","dept":"PK","itemCode":"FG-U2","name":"บรรจุ","kind":"FG","uom":"set","fgCodes":["FG-U2"]}'::jsonb,
                         current_setting('test.job')::jsonb || '{"id":"JOB-G-GR","dept":"GR","itemCode":"SE-G","name":"ชิ้นยาง","kind":"SE"}'::jsonb))),
  'releaseOrder') is not null, 'order 29001 is released with six RB jobs, a PK job and a GR job');
select throws_ok($$ select g2_t.edit_bom('BOM-G2-1', '[{"childCode":"P-G1","qty":2}]'::jsonb) $$,
  'BOM_REVISION_IMMUTABLE', 'a released order that used the revision locks it');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(g2_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', (select jsonb_agg(current_setting('test.wo')::jsonb || jsonb_build_object('id', 'WO-G' || x, 'sourceJobId', 'JOB-G-' || x) order by x)
    from unnest(array['A', 'B', 'C', 'D', 'E', 'F']) x))), 'createOrder') is not null, 'RB opens six work orders linked to the RB jobs');
select is((select jsonb_agg(g2_t.job('JOB-G-' || x) -> 'externalRef' ->> 'woId' order by x) from unnest(array['A', 'F']) x), '["WO-GA","WO-GF"]'::jsonb, 'each RB job is linked');
reset role;
update public.rf_orders set status = 'released' where is_test and wo_no = 'WO-GB';
update public.rf_orders set status = 'in_progress' where is_test and wo_no in ('WO-GC', 'WO-GF');
update public.rf_orders set status = 'on_hold' where is_test and wo_no = 'WO-GD';
update public.rf_orders set status = 'completed', completed_at = now() where is_test and wo_no = 'WO-GE';
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values (true, 'MX-GC-1', 'mixing', 'WO-GC', 'kg', 50, 'pass', 0);
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is((select jsonb_agg(g2_t.wo('WO-G' || x) ->> 'status' order by x) from unnest(array['A', 'B', 'C', 'D', 'E', 'F']) x),
  '["planned","released","in_progress","on_hold","completed","in_progress"]'::jsonb, 'the work orders are in every state');

-- 7. #376 ยอดเปลี่ยนต้องมีรายงานทุกผู้เรียก ------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pk_staff')::uuid);
select is(g2_t.report('JOB-G-PK', 2, 2) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '2', 'PK reports 2 sets with a report entry');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.bv', g2_t.bver()::text, true);
select throws_ok($$ select g2_t.set_job('JOB-G-PK', '{"qtyDone":7}'::jsonb) $$, 'BOM_INVALID_JOB', 'the planner cannot raise the output without a report entry');
select throws_ok($$ select g2_t.set_job('JOB-G-PK', '{"qtyDone":7}'::jsonb, 'reportJob') $$, 'BOM_INVALID_JOB', 'not under reportJob either');
select throws_ok($$ select g2_t.set_job('JOB-G-PK', '{"qtyDone":1}'::jsonb, 'reportJob') $$, 'BOM_INVALID_JOB', 'nor lower it');
select throws_ok($$ select g2_t.set_job('JOB-G-PK', '{"qtyReject":1}'::jsonb, 'reportJob') $$, 'BOM_INVALID_JOB', 'nor record rejects without a report entry');
select throws_ok($$ select g2_t.report('JOB-G-PK', 1, 2) $$, 'BOM_INVALID_JOB', 'nor add an entry whose sum differs from the change');
select is(g2_t.bver(), current_setting('test.bv')::bigint, 'the refused saves wrote nothing');
select is(g2_t.report('JOB-G-PK', 1, 1) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyDone', '3', 'the planner reports with a matching entry');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select throws_ok($$ select g2_t.set_job('JOB-G-PK', '{"qtyDone":4}'::jsonb, 'reportJob') $$, 'BOM_INVALID_JOB', 'an admin cannot change the output without a report entry');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_staff')::uuid);
select is(g2_t.set_job('JOB-G-GR', '{"status":"in_progress"}'::jsonb) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'in_progress', 'GR starts its job (no output)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(g2_t.set_job('JOB-G-GR', '{"status":"queued"}'::jsonb) -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'queued',
  'the planner puts the started job without output back in the queue');
select is(g2_t.set_job('JOB-G-GR', '{"qtyPlanned":8}'::jsonb, 'reportJob') -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'qtyPlanned', '8', 'and then lowers its plan (#376 kept)');
select set_config('test.rv', g2_t.rver()::text, true);
select set_config('test.res', g2_t.zero('JOB-G-GR', 'done', 'ใช้ชิ้นค้างไลน์แทน')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'the planner closes the unlinked job with a reason');
select ok(not (current_setting('test.res')::jsonb ? 'rubberflow'), 'a job without a work order touches nothing in RubberFlow');
select is(g2_t.rver(), current_setting('test.rv')::bigint, 'and the RubberFlow counter does not move');

-- 8. N1 ปิดงานที่ผูก WO ------------------------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select g2_t.zero('JOB-G-A', 'done', 'ไม่ผลิตต่อ') $$, 'BOM_INVALID_JOB', 'RB staff cannot close a job (closing is for the planners)');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rv', g2_t.rver()::text, true);
select throws_ok($$ select g2_t.zero('JOB-G-A', 'done', 'ab') $$, 'BOM_INVALID_JOB', 'a close needs a reason of at least three characters');
select is(jsonb_build_array(g2_t.wo('WO-GA') ->> 'status', g2_t.rver()), jsonb_build_array('planned', current_setting('test.rv')::bigint),
  'a refused close leaves the work order and the RubberFlow counter alone');
select set_config('test.res', g2_t.zero('JOB-G-A', 'done', 'ใช้เส้นยางค้างไลน์แทน')::text, true);
select is(current_setting('test.res')::jsonb -> 'rubberflow' -> 'cancelled', '["WO-GA"]'::jsonb, 'closing the job of a planned work order names it as cancelled');
select is(g2_t.wo('WO-GA') ->> 'status', 'cancelled', 'the planned work order is cancelled');
select ok(g2_t.wo('WO-GA') ? 'cancelledAt', 'with its cancel time');
select is(g2_t.rver(), current_setting('test.rv')::bigint + 1, 'the RubberFlow counter moved once');
select is(jsonb_build_array(g2_t.job('JOB-G-A') ->> 'status', g2_t.job('JOB-G-A') -> 'externalRef' ->> 'woId'), '["done","WO-GA"]'::jsonb, 'the job is done and keeps its link');
select is(g2_t.zero('JOB-G-B', 'done', 'ใช้เส้นยางค้างไลน์แทน') -> 'rubberflow' -> 'cancelled', '["WO-GB"]'::jsonb, 'a released work order is cancelled too');
select is(g2_t.zero('JOB-G-C', 'done', 'หยุดผลิต ลูกค้าลดยอด') -> 'rubberflow' -> 'cancelled', '["WO-GC"]'::jsonb, 'a work order in progress is stopped');
select is(jsonb_build_array(g2_t.wo('WO-GC') ->> 'status', g2_t.wo('WO-GC') ->> 'producedQty', g2_t.lot('MX-GC-1') ->> 'orderId'), '["cancelled","0","WO-GC"]'::jsonb,
  'the stopped work order keeps its output and its lots');
select is(g2_t.zero('JOB-G-D', 'done', 'หยุดผลิต ลูกค้าลดยอด') -> 'rubberflow' -> 'cancelled', '["WO-GD"]'::jsonb, 'a work order on hold is stopped');
select set_config('test.rv', g2_t.rver()::text, true);
select set_config('test.res', g2_t.zero('JOB-G-E', 'done', 'WO ปิดแล้ว ไม่ผลิตเพิ่ม')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'jobs' -> 'upsert' -> 0 ->> 'status', 'done', 'the job of a completed work order closes');
select ok(not (current_setting('test.res')::jsonb ? 'rubberflow'), 'and nothing is cancelled');
select is(jsonb_build_array(g2_t.wo('WO-GE') ->> 'status', g2_t.rver()), jsonb_build_array('completed', current_setting('test.rv')::bigint),
  'the completed work order stays completed and the RubberFlow counter does not move');
reset role;
select is((select count(*)::integer from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:closeJob'), 4,
  'each close that stopped a work order wrote one RubberFlow audit row');
select is((select jsonb_agg((metadata -> 'counts' -> 'orders' ->> 'upsert')::integer) from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'bom:closeJob'),
  '[1,1,1,1]'::jsonb, 'each row counts one work order');
-- ป้อนกลับจาก RubberFlow ของงานที่ยังเปิดยังทำงาน · งานที่ปิดแล้วไม่รับ
select is(private.rf_apply_feedback('ผู้บันทึก', json_populate_record(null::public.rf_lots, '{"lot_no":"FN-GF-1","stage":"finishing","good_qty":3,"uom":"pcs"}'::json),
          (select o from public.rf_orders o where o.is_test and o.wo_no = 'WO-GF')) ->> 'jobs', '1', 'RubberFlow still feeds output back into an open linked job');
select is(private.rf_apply_feedback('ผู้บันทึก', json_populate_record(null::public.rf_lots, '{"lot_no":"FN-GC-1","stage":"finishing","good_qty":3,"uom":"pcs"}'::json),
          (select o from public.rf_orders o where o.is_test and o.wo_no = 'WO-GC')) ->> 'jobs', '0', 'but not into a closed one');
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(g2_t.job('JOB-G-F') ->> 'qtyDone', '3', 'the open job received the 3 pieces');

-- 9. N2 ล็อตฉีดใช้สเปกของสูตรที่ WO ผูก ----------------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(g2_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-GS","recipeId":"RC-S","customerPo":"S-1"}'::jsonb,
  current_setting('test.wo')::jsonb || '{"id":"WO-GN","recipeId":"RC-N","customerPo":"N-1"}'::jsonb))), 'createOrder') is not null,
  'RB opens a work order for the recipe with a spec and one for the recipe without');
select is(g2_t.wo('WO-GS') ->> 'recipeRevision', '1', 'the work order uses the approved revision 1');
reset role;
update public.rf_orders set status = 'in_progress' where is_test and wo_no in ('WO-GS', 'WO-GN');
insert into public.rf_molds (is_test, mold_no, name, kind, unit, clean_every) values (true, 'DIE-G2', 'หัวดายทดสอบ', 'die', 'm', 100000);
insert into public.rf_lots (is_test, lot_no, stage, order_no, uom, good_qty, qc, transferred_qty) values
  (true, 'MX-GS-1', 'mixing', 'WO-GS', 'kg', 50, 'pass', 50),
  (true, 'MX-GN-1', 'mixing', 'WO-GN', 'kg', 50, 'pass', 50);
insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, status) values
  (true, 'TR-GS-1', 'MX-GS-1', 'WO-GS', 'mixing', 'extrusion', 'kg', 50, 0, 'in_transit'),
  (true, 'TR-GN-1', 'MX-GN-1', 'WO-GN', 'mixing', 'extrusion', 'kg', 50, 0, 'in_transit');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_sr_staff')::uuid);
select ok(g2_t.rf(jsonb_build_object('transfers', jsonb_build_object('upsert', jsonb_build_array(
  (select x || '{"status":"received","qtyReceived":50}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-GS-1'),
  (select x || '{"status":"received","qtyReceived":50}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'transfers') x where x ->> 'id' = 'TR-GN-1')))), 'receiveTransfer') is not null,
  'SR receives both mixing transfers at extrusion');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(g2_t.ex('EX-GS-1', 'WO-GS', 'TR-GS-1', 'MX-GS-1', '{"thickness":2.55,"width":18.1,"weightPerM":999}'::jsonb) -> 'changes' -> 'lots' -> 'upsert' -> 0 ->> 'qc', 'pass',
  'in spec for the dimensions the recipe defines: pass (the weight per metre has no spec, so 999 g/m does not hold the lot)');
select set_config('test.res', g2_t.ex('EX-GS-2', 'WO-GS', 'TR-GS-1', 'MX-GS-1', '{"thickness":2.7,"width":18,"weightPerM":160}'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 ->> 'qc', 'hold',
  'a thickness out of the approved revision spec holds the lot (the draft revision 2 with 2.7 does not apply to this work order)');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 -> 'holdReasons', '["ความหนา 2.7 mm นอกสเปก"]'::jsonb, 'the reason names only that measurement');
select is(g2_t.ex('EX-GS-3', 'WO-GS', 'TR-GS-1', 'MX-GS-1', '{"thickness":2.5,"width":18.3,"weightPerM":160}'::jsonb) -> 'changes' -> 'lots' -> 'upsert' -> 0 -> 'holdReasons',
  '["ความกว้าง 18.3 mm นอกสเปก"]'::jsonb, 'a width out of spec holds the lot');
select set_config('test.res', g2_t.ex('EX-GN-1', 'WO-GN', 'TR-GN-1', 'MX-GN-1', '{"thickness":3.2,"width":3.2,"weightPerM":9}'::jsonb)::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 ->> 'qc', 'pass', 'a recipe without a spec never holds a lot for its dimensions');
select is(current_setting('test.res')::jsonb -> 'changes' -> 'lots' -> 'upsert' -> 0 -> 'params' ->> 'thickness', '3.2', 'the measured values are still recorded');
select throws_ok($$ select g2_t.ex('EX-GN-2', 'WO-GN', 'TR-GN-1', 'MX-GN-1', '{"width":3.2,"weightPerM":9}'::jsonb) $$, 'RF_INVALID_LOT',
  'every measurement is still required, with or without a spec');

select * from finish();
rollback;
