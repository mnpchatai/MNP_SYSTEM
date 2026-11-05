-- ข้อมูลหลักของโมดูล BOM (20261105010000_bom_master_data.sql): โครงสร้างและสิทธิ์ ปฏิเสธนอกโหมดทดสอบ/ผิดบทบาท
-- อ่านได้ทุก persona, เขียนได้เฉพาะแผนก PP / ผู้จัดการแผนกขึ้นไป / admin, ชนรายระเบียน (BOM_STALE เฉพาะระเบียนที่แตะ),
-- delta ของการบันทึกและ app_bom_master_since (รวม revision ที่ถูก supersede และหลุมฝังศพของที่ลบ),
-- กฎ BOM (ชนิดลูก, สูตรยางของเส้นยาง, ลูกต้องมี, วงจร, revision แก้ไม่ได้, approved ตัวเดียวต่อชิ้น), ชุดสี/แพ็กเกจ/routing และ audit
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
create temp table bom_tables(name text) on commit drop;
insert into bom_tables values
  ('bom_master_state'), ('bom_items'), ('bom_compounds'), ('bom_colors'), ('bom_color_sets'),
  ('bom_packages'), ('bom_boms'), ('bom_bom_lines'), ('bom_processes'), ('bom_routings'), ('bom_deleted_keys');

select is((select count(*) from bom_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  11::bigint, 'every BOM table has RLS enabled');
select ok(not exists (
    select 1 from bom_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on any BOM table');
select ok(not exists (
    select 1 from bom_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = t.name || '_no_direct_access')),
  'every BOM table has the deny-all policy');
select ok(not exists (
    select 1 from bom_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'every BOM table has the restrictive lab_only_no_access policy');
select ok(not exists (
    select 1 from bom_tables t
    where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass
                      and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)),
  'every BOM table enforces sandbox scope by trigger');
select ok(not exists (select 1 from bom_tables t where not (t.name = any (private.sandbox_unguarded_tables()))),
  'every BOM table is registered as sandbox aware');
select ok('ncr_outcomes' = any (private.sandbox_unguarded_tables()) and 'qc_inspection_reports' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the existing tables');
select is((select count(*) from pg_constraint c join bom_tables t on c.conrelid = ('public.' || t.name)::regclass
           where c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (id, is_test)'),
  9::bigint, 'every BOM data table has unique (id, is_test) for the paired foreign keys');
select is((select count(*) from pg_trigger g where g.tgrelid in (select ('public.' || name)::regclass from bom_tables)
           and g.tgname = replace(g.tgrelid::regclass::text, 'public.', '') || '_stamp_version' and not g.tgisinternal),
  9::bigint, 'the eight master tables and the tombstone table stamp changed_version by trigger');
select ok(not exists (select 1 from pg_trigger g where g.tgname in ('bom_bom_lines_stamp_version', 'bom_master_state_stamp_version')),
  'the counter and the immutable lines are not stamped');
select is((select count(*) from information_schema.columns where table_schema = 'public' and column_name = 'changed_version'
           and table_name in (select name from bom_tables)),
  9::bigint, 'every table the delta reads has changed_version');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname like 'bom\_%\_changed\_idx'),
  9::bigint, 'each of them is indexed by (is_test, changed_version)');
select is((select count(*) from pg_constraint c join bom_tables t on c.conrelid = ('public.' || t.name)::regclass
           where c.contype = 'f' and pg_get_constraintdef(c.oid) like '%, is_test) REFERENCES %bom_%'),
  4::bigint, 'the item, line and routing foreign keys are paired with is_test');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0,
  'every callable public function (including the BOM RPCs) has the lab-only guard');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_boms_one_approved_idx')
      and exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'bom_routings_one_approved_idx'),
  'at most one approved BOM and one approved routing per item is enforced by a partial unique index');
select ok(not exists (select 1 from unnest(array['public.app_bom_master()', 'public.app_bom_master_since(bigint)', 'public.app_bom_save_master(jsonb,bigint,text)']) f(sig)
                      where has_function_privilege('anon', f.sig, 'execute')),
  'anon cannot execute any BOM RPC');
select ok(not exists (select 1 from unnest(array['public.app_bom_master()', 'public.app_bom_master_since(bigint)', 'public.app_bom_save_master(jsonb,bigint,text)']) f(sig)
                      where not has_function_privilege('authenticated', f.sig, 'execute')),
  'signed-in users can call all three BOM RPCs (each checks the mode and role itself)');
select ok((select p.prosecdef and p.proconfig @> array['search_path=""'] from pg_proc p where p.oid = 'public.app_bom_master_since(bigint)'::regprocedure),
  'the delta RPC is security definer with an empty search_path');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname like 'bom\_%'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private BOM helper');
select ok(not exists (select 1 from public.departments d where d.code in ('PL', 'QC')),
  'the client department codes PL and QC are aliases only, not real departments');
select ok((select count(*) from public.departments where code in ('ST', 'RB', 'SR', 'QA', 'GR', 'PT', 'BG', 'PK', 'WH', 'SA', 'PP')) = 11,
  'the eleven production departments exist');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8d000000-0000-0000-0000-000000000001', 'bom-admin@test.local', '{}'),
  ('8d000000-0000-0000-0000-000000000002', 'bom-staff@test.local', '{}'),
  ('8d000000-0000-0000-0000-000000000003', 'mnplab001-bom@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8d000000-0000-0000-0000-000000000101', 'BOM-ADMIN', 'Bom', 'Admin', 'bom-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8d000000-0000-0000-0000-000000000001'),
  ('8d000000-0000-0000-0000-000000000102', 'BOM-STAFF-REAL', 'Bom', 'Staff', 'bom-staff@test.local', 'PP',
   (select id from public.departments where code = 'PP'), (select id from public.roles where code = 'staff'), '8d000000-0000-0000-0000-000000000002'),
  ('8d000000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-bom@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8d000000-0000-0000-0000-000000000003');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select set_config('test.pp_name', first_name || ' ' || last_name, true) from public.employees where employee_no = 'SBX-PP-STAFF';
select set_config('test.mgr_name', first_name || ' ' || last_name, true) from public.employees where employee_no = 'SBX-RB-MGR';
select set_config('test.afm_name', first_name || ' ' || last_name, true) from public.employees where employee_no = 'SBX-FT-AFM';

-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ เพื่อตรวจว่าโหมดทดสอบมองไม่เห็น
insert into public.bom_items (code, kind, name, owner_dept, uom) values ('REAL-ITEM', 'FG', 'ชิ้นงานจริง', 'PK', 'pcs');
insert into public.bom_master_state (is_test, version) values (false, 99);

-- 3. ใครแก้ข้อมูลหลักได้ (ตัวตัดสินล้วน ๆ) ------------------------------------------------------
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-PP-STAFF'), 'PP staff can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-RB-MGR'), 'a department manager can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-QA-MGR'), 'a department manager of another department can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-FT-AFM'), 'the assistant factory manager can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-FT-FM'), 'the factory manager can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-MGT-GM'), 'the general manager can edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'BOM-ADMIN'), 'an admin can edit');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-RB-STAFF'), 'RB staff cannot edit');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-QA-STAFF'), 'QA staff cannot edit');
select ok(not (select private.bom_can_edit(e) from public.employees e where e.employee_no = 'SBX-GR-AMGR'), 'an assistant department manager cannot edit');
select ok((select private.bom_can_edit(e) from public.employees e where e.employee_no = 'BOM-STAFF-REAL'), 'a real staff row in the PP department can edit');

-- 4. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'AUTH_REQUIRED', 'reading requires a session');
select throws_ok('select public.app_bom_master_since(0)', 'AUTH_REQUIRED', 'the delta requires a session');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'AUTH_REQUIRED', 'saving requires a session');

select set_config('request.jwt.claims', '{"sub":"8d000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_TEST_MODE_ONLY', 'a real PP staff account cannot read (real mode is not open)');
select throws_ok('select public.app_bom_master_since(0)', 'BOM_TEST_MODE_ONLY', 'a real PP staff account cannot read the delta');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_TEST_MODE_ONLY', 'a real PP staff account cannot save');
select throws_ok('select count(*) from public.bom_items', '42501', null, 'clients cannot read the item table directly');
select throws_ok('select count(*) from public.bom_boms', '42501', null, 'clients cannot read the BOM table directly');
select throws_ok($$ insert into public.bom_items (code, kind, name, owner_dept, uom) values ('X', 'FG', 'x', 'PK', 'pcs') $$, '42501', null, 'clients cannot write the item table directly');

select set_config('request.jwt.claims', '{"sub":"8d000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot use the BOM module');
select throws_ok('select public.app_bom_master_since(0)', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot read the delta');

select set_config('request.jwt.claims', '{"sub":"8d000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_bom_master()', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read');
select throws_ok('select public.app_bom_master_since(0)', 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot read the delta');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_TEST_MODE_ONLY', 'an admin outside test mode cannot save');

-- 5. อ่านได้ทุก persona แต่เขียนไม่ได้ถ้าไม่ใช่ PP / ผู้จัดการขึ้นไป ------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_bom_master(),
  '{"version":0,"items":[],"compounds":[],"colors":[],"colorSets":[],"packages":[],"boms":[],"processes":[],"routings":[]}'::jsonb,
  'a rubber-department staff persona reads an empty master and never sees the real row');
select is(public.app_bom_master_since(0), '{"version":0,"changes":{"items":{"upsert":[],"delete":[]},"compounds":{"upsert":[],"delete":[]},"colors":{"upsert":[],"delete":[]},"colorSets":{"upsert":[],"delete":[]},"packages":{"upsert":[],"delete":[]},"boms":{"upsert":[],"delete":[]},"processes":{"upsert":[],"delete":[]},"routings":{"upsert":[],"delete":[]}}}'::jsonb,
  'a rubber-department staff persona reads the delta of an empty master: all eight lists, empty upsert and delete');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[]}}'::jsonb, 0, 'saveItem') $$, 'BOM_FORBIDDEN',
  'a rubber-department staff persona cannot save');
select public.app_sandbox_enter(current_setting('test.p_sbx_gr_amgr')::uuid);
select is(public.app_bom_master() ->> 'version', '0', 'an assistant department manager reads');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_FORBIDDEN', 'an assistant department manager cannot save');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') $$, 'BOM_FORBIDDEN', 'QA staff cannot save');

-- 6. PP staff บันทึกครั้งแรก (นำเข้า) -------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.s1', $json$
{
 "compounds": {"upsert": [{"code": "DM01", "name": "EPDM ส้ม", "recipeId": "RC-EPDM-DS01", "recipeName": "EPDM ซีล"}]},
 "colors": {"upsert": [{"code": "OR01", "name": "ส้ม 01"}]},
 "processes": {"upsert": [{"code": "X-01", "name": "ขั้นทดสอบ", "dept": "PL"}]},
 "items": {"upsert": [
  {"code": "FG-T1", "kind": "FG", "name": "สินค้าทดสอบ", "ownerDept": "PK", "uom": "set", "weightG": 120, "rubber": null, "legacyCodes": ["FG T1"], "active": true, "group": "TOY"},
  {"code": "SE-T1-OR01-100-18-65", "kind": "SE", "name": "ชิ้นยาง", "ownerDept": "GR", "uom": "pcs", "weightG": 0, "rubber": {"product": "T1", "color": "OR01", "lengthMm": 100, "holeMm": 18, "odMm": 65}, "legacyCodes": [], "active": true, "group": "TOY"},
  {"code": "RB-DM01-A-OR01-100-18-65", "kind": "RB", "name": "เส้นยาง", "ownerDept": "RB", "uom": "pcs", "weightG": 0, "rubber": {"compound": "DM01", "type": "A", "color": "OR01", "pcsPerRoll": 10, "sePerGr": 1, "cutLengthCm": null}, "legacyCodes": [], "active": true, "group": "TOY"},
  {"code": "DM01", "kind": "CP", "name": "EPDM ส้ม", "ownerDept": "RB", "uom": "kg", "weightG": 0, "rubber": null, "legacyCodes": [], "active": true, "group": "TOY"},
  {"code": "P-BOX-1", "kind": "PURCHASED", "name": "กล่อง", "ownerDept": "ST", "uom": "box", "weightG": 0, "rubber": null, "legacyCodes": [], "active": true, "group": "TOY", "unitCost": 5.5},
  {"code": "x-pl", "kind": "SUBPART", "name": "ชิ้นทำเอง", "ownerDept": "PL", "uom": "pcs"}
 ]},
 "boms": {"upsert": [
  {"id": "BOM-69-0001", "itemCode": "FG-T1", "revision": 1, "status": "approved", "ownerDept": "PK",
   "lines": [
     {"childCode": "SE-T1-OR01-100-18-65", "qty": 2, "uom": "pcs", "consumerDept": "PK", "producerDept": "GR", "scrapPct": 0, "flags": [], "note": ""},
     {"step": 2, "childCode": "P-BOX-1", "qty": 1, "uom": "box", "consumerDept": "PK", "producerDept": "ST", "scrapPct": 2.5, "flags": ["P"], "note": "กล่องนอก"}],
   "createdBy": "ใครก็ได้", "createdAt": 1, "approvedBy": "ใครก็ได้", "approvedAt": 1, "note": "",
   "changeLog": [{"at": 1762300000000, "by": "ใครก็ได้", "text": "สร้างใหม่ 2 บรรทัด"}]},
  {"id": "BOM-69-0002", "itemCode": "SE-T1-OR01-100-18-65", "revision": 1, "status": "approved", "ownerDept": "GR",
   "lines": [{"childCode": "RB-DM01-A-OR01-100-18-65", "qty": 0.5, "uom": "pcs", "consumerDept": "GR", "producerDept": "RB", "scrapPct": 0, "flags": [], "note": ""}],
   "changeLog": []},
  {"id": "BOM-69-0003", "itemCode": "RB-DM01-A-OR01-100-18-65", "revision": 1, "status": "approved", "ownerDept": "RB",
   "lines": [{"childCode": "DM01", "qty": 0.1, "uom": "kg", "consumerDept": "RB", "producerDept": "RB", "scrapPct": 0, "flags": [], "note": ""}],
   "changeLog": []}
 ]}
}
$json$, true);

select throws_ok($$ select public.app_bom_save_master(current_setting('test.s1')::jsonb, 5, 'importFlat') $$, 'BOM_INVALID_PAYLOAD',
  'a base version above the current one is rejected');
select throws_ok($$ select public.app_bom_save_master(current_setting('test.s1')::jsonb, -1, 'importFlat') $$, 'BOM_INVALID_PAYLOAD',
  'a negative base version is rejected');
select throws_ok($$ select public.app_bom_save_master('{}'::jsonb, 5, 'importFlat') $$, 'BOM_INVALID_PAYLOAD',
  'an empty save validates the base version too');
select throws_ok('select public.app_bom_master_since(1)', 'BOM_INVALID_PAYLOAD', 'the delta refuses a version above the current one');
select throws_ok('select public.app_bom_master_since(-1)', 'BOM_INVALID_PAYLOAD', 'the delta refuses a negative version');
select throws_ok('select public.app_bom_master_since(null)', 'BOM_INVALID_PAYLOAD', 'the delta refuses a missing version');
select throws_ok($$ select public.app_bom_save_master(current_setting('test.s1')::jsonb, 0, 'dropEverything') $$, 'BOM_INVALID_ACTION',
  'an action name outside the client list is rejected');
select throws_ok($$ select public.app_bom_save_master(current_setting('test.s1')::jsonb, 0, null) $$, 'BOM_INVALID_ACTION', 'a missing action name is rejected');
select throws_ok($$ select public.app_bom_save_master(current_setting('test.s1')::jsonb, null, 'importFlat') $$, 'BOM_INVALID_PAYLOAD', 'a missing base version is rejected');
select throws_ok($$ select public.app_bom_save_master('[]'::jsonb, 0, 'importFlat') $$, 'BOM_INVALID_PAYLOAD', 'the changes must be an object');
select throws_ok($$ select public.app_bom_save_master('{"orders":{"upsert":[]}}'::jsonb, 0, 'importFlat') $$, 'BOM_INVALID_PAYLOAD', 'an unknown section is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"delete":[]}}'::jsonb, 0, 'importFlat') $$, 'BOM_INVALID_PAYLOAD', 'items cannot be deleted');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":{}}}'::jsonb, 0, 'importFlat') $$, 'BOM_INVALID_PAYLOAD', 'a section must hold arrays');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('items', jsonb_build_object('upsert', (select jsonb_agg('{}'::jsonb) from generate_series(1, 5001)))), 0, 'importFlat') $$,
  'BOM_TOO_MANY', 'more than 5,000 records in a section is rejected');

select set_config('test.delta', public.app_bom_save_master(current_setting('test.s1')::jsonb, 0, 'importFlat')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.delta')::jsonb ->> 'version', '1', 'the first save moves the version to 1');
select is(current_setting('test.snap')::jsonb ->> 'version', '1', 'the snapshot reports the version too');
select is((select jsonb_object_agg(l, current_setting('test.delta')::jsonb -> 'changes' -> l -> 'upsert') from unnest(array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings']) l),
  (select jsonb_object_agg(l, current_setting('test.snap')::jsonb -> l) from unnest(array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings']) l),
  'the delta of the first save holds every record, in the same shape and order as the snapshot');
select ok(not exists (select 1 from jsonb_each(current_setting('test.delta')::jsonb -> 'changes') c where jsonb_array_length(c.value -> 'delete') > 0),
  'nothing was deleted');
select is(public.app_bom_master_since(0) -> 'changes' -> 'items' -> 'upsert', current_setting('test.snap')::jsonb -> 'items', 'the delta from version 0 equals the snapshot');
select is(public.app_bom_master_since(1) -> 'changes' -> 'items' -> 'upsert', '[]'::jsonb, 'the delta from the current version is empty');
select ok(not (public.app_bom_master_since(0)::text like '%REAL-ITEM%'), 'the delta never holds real (non-test) rows');
select is((select jsonb_agg(i -> 'code') from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i),
  '["DM01","FG-T1","P-BOX-1","RB-DM01-A-OR01-100-18-65","SE-T1-OR01-100-18-65","X-PL"]'::jsonb,
  'items are returned in ascending code order and codes are made canonical');
select is((select i ->> 'ownerDept' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'X-PL'), 'PP',
  'the client department PL is stored and returned as PP');
select is((select i -> 'legacyCodes' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'FG-T1'),
  '["FG T1"]'::jsonb, 'legacy codes are kept');
select is((select (i ->> 'unitCost')::numeric from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'P-BOX-1'), 5.5::numeric,
  'the unit cost is returned');
select ok((select (i ->> 'unitCost') is null and (i ->> 'image') is null from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'FG-T1'),
  'optional fields that are empty are omitted like the client shape');
select is((select i -> 'rubber' ->> 'lengthMm' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'SE-T1-OR01-100-18-65'), '100',
  'the rubber spec is kept');
select ok((select (i -> 'rubber' ->> 'cutLengthCm') is null and (i -> 'rubber') <> 'null'::jsonb from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'RB-DM01-A-OR01-100-18-65'),
  'null rubber fields are dropped');
select is((select jsonb_agg(b ->> 'id') from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b),
  '["BOM-69-0001","BOM-69-0002","BOM-69-0003"]'::jsonb, 'BOMs keep the client ids, in ascending order');
select is((select b -> 'lines' -> 0 ->> 'childCode' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  'SE-T1-OR01-100-18-65', 'lines keep the stored order');
select is((select b -> 'lines' -> 1 from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  '{"step":2,"childCode":"P-BOX-1","qty":1,"uom":"box","consumerDept":"PK","producerDept":"ST","scrapPct":2.5,"flags":["P"],"note":"กล่องนอก"}'::jsonb,
  'a line keeps its step, scrap and flags');
select ok((select (b -> 'lines' -> 0 ->> 'step') is null from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  'a line without a step has no step key');
select is((select b ->> 'createdBy' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  current_setting('test.pp_name'), 'the creator is the persona, not the name the client sent');
select is((select b ->> 'approvedBy' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  current_setting('test.pp_name'), 'the approver is the persona');
select is((select b -> 'changeLog' -> 0 ->> 'by' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  current_setting('test.pp_name'), 'a new change log entry is signed by the persona');
select is((select b -> 'changeLog' -> 0 ->> 'text' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  'สร้างใหม่ 2 บรรทัด', 'the change log text is kept');
select ok((select (b ->> 'createdAt')::bigint > 1000000000000 and (b ->> 'supersededAt') is null from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  'timestamps are set by the server in milliseconds');
select is(current_setting('test.snap')::jsonb -> 'compounds' -> 0 ->> 'recipeId', 'RC-EPDM-DS01', 'the compound keeps its RubberFlow link');
select is(current_setting('test.snap')::jsonb -> 'colors' -> 0, jsonb_build_object('code', 'OR01', 'master', 'OR', 'shade', '01', 'name', 'ส้ม 01',
  'createdAt', current_setting('test.snap')::jsonb -> 'colors' -> 0 -> 'createdAt'), 'a color has code, master, shade and name');
select is(current_setting('test.snap')::jsonb -> 'processes', '[{"code":"X-01","name":"ขั้นทดสอบ","dept":"PP"}]'::jsonb, 'a process keeps its department (PL stored as PP)');
select is(current_setting('test.snap')::jsonb -> 'routings', '[]'::jsonb, 'no routing yet');

-- ไม่มีการเปลี่ยนแปลง = ไม่เพิ่ม version (คืน delta ตั้งแต่ base)
select is(public.app_bom_save_master('{}'::jsonb, 1, 'saveItem') ->> 'version', '1', 'saving nothing does not move the version');
select is(public.app_bom_save_master('{"items":{"upsert":[]}}'::jsonb, 1, 'saveItem') ->> 'version', '1', 'saving empty sections does not move the version');
select is(public.app_bom_save_master('{}'::jsonb, 0, 'saveItem') -> 'changes' -> 'items' -> 'upsert', current_setting('test.snap')::jsonb -> 'items',
  'an empty save from an older base still returns what changed since (nothing blocks it)');

-- 7. กติกา BOM ที่ฐานข้อมูลบังคับ (ทุกข้อไม่เขียนอะไรเลย) --------------------------------------
select set_config('test.old1', (select b::text from jsonb_array_elements(public.app_bom_master() -> 'boms') b where b ->> 'id' = 'BOM-69-0001'), true);

select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X1","itemCode":"RB-DM01-A-OR01-100-18-65","revision":2,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_CHILD_KIND', 'a rubber line may only have a compound child');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"DM02","kind":"CP","name":"อีกสูตร","ownerDept":"RB","uom":"kg"}]},"boms":{"upsert":[{"id":"BOM-X2","itemCode":"RB-DM01-A-OR01-100-18-65","revision":2,"status":"approved","lines":[{"childCode":"DM02","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_RB_COMPOUND_MISMATCH', 'the compound line must equal the rubber compound of the item');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"DM02","kind":"CP","name":"อีกสูตร","ownerDept":"RB","uom":"kg"}]},"boms":{"upsert":[{"id":"BOM-X3","itemCode":"RB-DM01-A-OR01-100-18-65","revision":2,"status":"approved","lines":[{"childCode":"DM01","qty":1},{"childCode":"DM02","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_RB_ONE_COMPOUND', 'a rubber item may have only one compound line');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X4","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"DM01","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_CHILD_KIND', 'a compound can only sit under a rubber item');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X5","itemCode":"P-BOX-1","revision":1,"status":"approved","lines":[{"childCode":"DM01","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_PARENT_KIND', 'a purchased item cannot have a BOM');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X6","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"NOPE-1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_CHILD_NOT_FOUND', 'a missing child is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X7","itemCode":"NOPE-2","revision":1,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_ITEM_NOT_FOUND', 'a BOM for a missing item is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X8","itemCode":"SE-T1-OR01-100-18-65","revision":2,"status":"approved","lines":[{"childCode":"FG-T1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_CYCLE', 'a cycle through existing BOMs is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-X9","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"FG-T1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_CYCLE', 'an item cannot be its own child');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y1","itemCode":"FG-T1","revision":5,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_REVISION_ORDER', 'a new revision must follow the highest one');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y2","itemCode":"FG-T1","revision":2,"status":"superseded","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_BOM', 'a new revision cannot be saved as superseded');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y3","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":0}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_LINE', 'a zero quantity is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y4","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1},{"childCode":"p-box-1","qty":2}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_LINE', 'the same child twice in one BOM is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y5","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1,"step":21}]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_LINE', 'a step above 20 is rejected');
select throws_ok($$ select public.app_bom_save_master('{"boms":{"upsert":[{"id":"BOM-Y6","itemCode":"FG-T1","revision":2,"status":"approved","lines":[]}]}}'::jsonb, 1, 'saveBom') $$,
  'BOM_INVALID_LINE', 'a BOM needs at least one line');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.old1')::jsonb, '{lines,0,qty}', '5')))), 1, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'the lines of an existing revision cannot change');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.old1')::jsonb, '{note}', '"แก้หมายเหตุ"')))), 1, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'the note of an existing revision cannot change');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.old1')::jsonb, '{revision}', '2')))), 1, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'the revision number of an existing record cannot change');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"FG-T1","kind":"SE","name":"x","ownerDept":"PK","uom":"set"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_ITEM_KIND_LOCKED', 'the kind of an item that has a BOM cannot change');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"DM01","kind":"FG","name":"x","ownerDept":"RB","uom":"kg"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_CHILD_KIND', 'an item cannot change kind to something its parent does not accept');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"RB-DM01-A-OR01-100-18-65","kind":"RB","name":"x","ownerDept":"RB","uom":"pcs","rubber":{"compound":"DM09"}}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_RB_COMPOUND_MISMATCH', 'changing the compound of a rubber item that has a BOM must match its compound line');

-- ตรวจค่าที่ client ส่งมา
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"XX","name":"x","ownerDept":"PK","uom":"pcs"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'an unknown kind is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"PK","uom":"liters"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'an unknown unit is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"","ownerDept":"PK","uom":"pcs"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'an empty name is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"ZZ","uom":"pcs"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_DEPT', 'a department that does not exist is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"PK","uom":"pcs","weightG":-1}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'a negative weight is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"PK","uom":"pcs"},{"code":"e-1","kind":"FG","name":"y","ownerDept":"PK","uom":"pcs"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'the same code twice in one call is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"PK","uom":"pcs","rubber":{"compound":"DM01"}}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_RUBBER', 'only rubber and SE items carry a rubber spec');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"RB","name":"x","ownerDept":"RB","uom":"pcs","rubber":{"secret":"x"}}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_RUBBER', 'an unknown rubber key is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"RB","name":"x","ownerDept":"RB","uom":"pcs","rubber":{"lengthMm":"100"}}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_RUBBER', 'a rubber number given as text is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"E-1","kind":"FG","name":"x","ownerDept":"PK","uom":"pcs","image":"data:image/gif;base64,AAAA"}]}}'::jsonb, 1, 'setItemImage') $$,
  'BOM_INVALID_IMAGE', 'only PNG, JPEG and WebP data URLs are accepted as pictures');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('items', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_build_object('code', 'E-1', 'kind', 'FG', 'name', 'x', 'ownerDept', 'PK', 'uom', 'pcs',
                       'image', 'data:image/png;base64,' || repeat('A', 80000))))), 1, 'setItemImage') $$,
  'BOM_INVALID_IMAGE', 'a picture over 80,000 characters is rejected');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[{"code":"DM-A-VERY-LONG-COMPOUND-CODE","kind":"CP","name":"x","ownerDept":"RB","uom":"kg"}]}}'::jsonb, 1, 'saveItem') $$,
  'BOM_INVALID_ITEM', 'a compound item code over 20 characters is rejected');
select throws_ok($$ select public.app_bom_save_master('{"compounds":{"upsert":[{"code":"","name":"x"}]}}'::jsonb, 1, 'linkCompound') $$,
  'BOM_INVALID_COMPOUND', 'a compound needs a code');
select throws_ok($$ select public.app_bom_save_master('{"colors":{"upsert":[{"code":"ORANGE","name":"x"}]}}'::jsonb, 1, 'saveColor') $$,
  'BOM_INVALID_COLOR', 'a color code must be two letters and two digits');
select throws_ok($$ select public.app_bom_save_master('{"processes":{"upsert":[{"code":"X-02","name":"x","dept":"ZZ"}]}}'::jsonb, 1, 'saveProcess') $$,
  'BOM_INVALID_DEPT', 'a process department must exist');
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"upsert":[{"base":"FG-T1","code":"YY","slots":[{"key":"SE-T1-*-1","color":"OR01"}]}]}}'::jsonb, 1, 'saveColorSet') $$,
  'BOM_INVALID_COLOR_SET', 'a color set code is one letter');
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"upsert":[{"base":"FG-T1","code":"Y","slots":[{"key":"NOT-A-KEY","color":"OR01"}]}]}}'::jsonb, 1, 'saveColorSet') $$,
  'BOM_INVALID_COLOR_SET', 'a color slot key must be a color-less SE or RB code');
select throws_ok($$ select public.app_bom_save_master('{"packages":{"upsert":[{"base":"FG-T1","code":"P","lines":[{"childCode":"FG-T1","qty":1}]}]}}'::jsonb, 1, 'savePackage') $$,
  'BOM_INVALID_PACKAGE', 'packaging lines must be purchased items');
select throws_ok($$ select public.app_bom_save_master('{"packages":{"upsert":[{"base":"FG-T1","code":"P","lines":[{"childCode":"P-BOX-1","qty":0}]}]}}'::jsonb, 1, 'savePackage') $$,
  'BOM_INVALID_PACKAGE', 'a packaging quantity must be positive');
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 1, 'removeColorSet') $$,
  'BOM_NOT_FOUND', 'deleting a color set that does not exist is rejected');
select throws_ok($$ select public.app_bom_save_master('{"packages":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 1, 'removePackage') $$,
  'BOM_NOT_FOUND', 'deleting a package that does not exist is rejected');
select throws_ok($$ select public.app_bom_save_master('{"routings":{"upsert":[{"id":"RT-X","itemCode":"P-BOX-1","revision":1,"status":"approved","steps":[]}]}}'::jsonb, 1, 'saveRouting') $$,
  'BOM_INVALID_ROUTING', 'a purchased item has no routing');
select throws_ok($$ select public.app_bom_save_master('{"routings":{"upsert":[{"id":"RT-X","itemCode":"FG-T1","revision":1,"status":"approved","steps":[{"processCode":"X-01","minutesPerPc":-1}]}]}}'::jsonb, 1, 'saveRouting') $$,
  'BOM_INVALID_ROUTING', 'negative minutes are rejected');
select throws_ok($$ select public.app_bom_save_master('{"routings":{"upsert":[{"id":"RT-X","itemCode":"FG-T1","revision":1,"status":"approved","steps":[{"processCode":"X-01","minutesPerPc":1},{"processCode":"X-01","minutesPerPc":2}]}]}}'::jsonb, 1, 'saveRouting') $$,
  'BOM_INVALID_ROUTING', 'the same process twice in one routing is rejected');

-- ทุกข้อด้านบนไม่เขียนอะไรเลย
select is(public.app_bom_master() ->> 'version', '1', 'rejected saves leave the version alone');
select is(jsonb_array_length(public.app_bom_master() -> 'items'), 6, 'rejected saves leave the items alone (DM02 and E-1 were never written)');
select is(jsonb_array_length(public.app_bom_master() -> 'boms'), 3, 'rejected saves leave the BOMs alone');
select is(public.app_bom_master() -> 'boms' -> 0 ->> 'status', 'approved', 'a rejected revision did not supersede the existing one');

-- 8. revision ใหม่: ตัวเดิม superseded (ส่งเรคอร์ดเก่ามาด้วย) -----------------------------------
select set_config('test.s2', jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
  '{"id":"BOM-69-0004","itemCode":"FG-T1","revision":2,"status":"approved","lines":[{"childCode":"SE-T1-OR01-100-18-65","qty":3},{"childCode":"P-BOX-1","qty":1,"step":2}],"note":"แก้ปริมาณ","changeLog":[{"at":1762300001000,"by":"ใครก็ได้","text":"SE 2→3"}]}'::jsonb,
  jsonb_set(current_setting('test.old1')::jsonb, '{status}', '"superseded"'))))::text, true);
select set_config('test.delta', public.app_bom_save_master(current_setting('test.s2')::jsonb, 1, 'saveBom')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '2', 'the second save moves the version to 2');
select is(current_setting('test.delta')::jsonb ->> 'version', '2', 'the reply of a save carries the new version');
select is((select string_agg((b ->> 'id') || ':' || (b ->> 'status'), ',' order by b ->> 'id') from jsonb_array_elements(current_setting('test.delta')::jsonb -> 'changes' -> 'boms' -> 'upsert') b),
  'BOM-69-0001:superseded,BOM-69-0004:approved', 'the delta holds the new revision and the one it superseded, and nothing else');
select is(current_setting('test.delta')::jsonb -> 'changes' -> 'items' -> 'upsert', '[]'::jsonb, 'records nobody changed since the base are not in the delta');
select is((select b ->> 'status' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'), 'superseded',
  'the previous revision is superseded');
select ok((select (b ->> 'supersededAt')::bigint > 1000000000000 from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  'the server stamps supersededAt');
select is((select b ->> 'revision' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'), '2', 'the new revision is 2');
select is((select count(*) from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'itemCode' = 'FG-T1' and b ->> 'status' = 'approved'),
  1::bigint, 'exactly one revision of the item is approved');
select is((select b -> 'changeLog' -> 0 ->> 'by' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'),
  current_setting('test.pp_name'), 'the new change log entry is signed by the persona');
select is((select b -> 'changeLog' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0001'),
  current_setting('test.old1')::jsonb -> 'changeLog', 'the change log of the superseded revision is unchanged');

-- สอง revision approved พร้อมกันไม่ได้
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.old1')::jsonb))), 2, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'a superseded revision cannot be approved again');
reset role;
select throws_ok($$ insert into public.bom_boms (is_test, bom_id, item_code, revision, status, owner_dept) values (true, 'BOM-RAW', 'FG-T1', 9, 'approved', 'PK') $$,
  '23505', null, 'the database itself refuses a second approved revision of the same item');
select throws_ok($$ insert into public.bom_bom_lines (is_test, bom_pk, line_no, child_code, qty, uom, consumer_dept, producer_dept)
    select true, b.id, 9, 'DM01', 0, 'kg', 'RB', 'RB' from public.bom_boms b where b.bom_id = 'BOM-69-0001' $$,
  '23514', null, 'the table itself refuses a zero quantity');
set local role authenticated;

-- 9. ผู้จัดการแผนกบันทึกได้ และตัวที่ approved ถูก superseded โดยเซิร์ฟเวอร์ ------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select set_config('test.delta', public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-69-0005","itemCode":"SE-T1-OR01-100-18-65","revision":2,"status":"approved","lines":[{"childCode":"RB-DM01-A-OR01-100-18-65","qty":0.4}],"changeLog":[{"at":1762300002000,"by":"x","text":"0.5→0.4"}]}]}}'::jsonb,
  2, 'saveBom')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '3', 'a department manager can save');
select is((select b ->> 'status' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0002'), 'superseded',
  'the server supersedes the previous approved revision when the client does not send it');
select is((select string_agg((b ->> 'id') || ':' || (b ->> 'status'), ',' order by b ->> 'id') from jsonb_array_elements(current_setting('test.delta')::jsonb -> 'changes' -> 'boms' -> 'upsert') b),
  'BOM-69-0002:superseded,BOM-69-0005:approved', 'the delta also carries the revision the server superseded by itself');
select is((select b ->> 'createdBy' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0005'),
  current_setting('test.mgr_name'), 'the manager persona is recorded as the creator');
select is((select b -> 'lines' -> 0 ->> 'qty' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0005'), '0.4',
  'fractional quantities round trip');

-- ผู้ช่วยผู้จัดการโรงงาน: ขั้นตอน ชุดสี แพ็กเกจ
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select set_config('test.delta', public.app_bom_save_master($json$
{
 "routings": {"upsert": [{"id": "RT-69-0001", "itemCode": "FG-T1", "revision": 1, "status": "approved",
   "steps": [{"processCode": "X-01", "minutesPerPc": 1.5, "note": "", "inputs": ["p-box-1"]}], "createdBy": "x", "createdAt": 1}]},
 "colorSets": {"upsert": [{"base": "fg-t1", "code": "y", "name": "ชุด Y", "note": "ทดสอบ", "slots": [{"key": "se-t1-*-100-18-65", "color": "or01"}, {"key": "SE-T1-*-100-18-65", "color": ""}]}]},
 "packages": {"upsert": [{"base": "FG-T1", "code": "p", "name": "แพ็กเกจ P", "lines": [{"childCode": "P-BOX-1", "qty": 2}]}]}
}
$json$::jsonb, 3, 'savePackage')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '4', 'the assistant factory manager can save');
select is(current_setting('test.snap')::jsonb -> 'routings' -> 0 -> 'steps',
  '[{"processCode":"X-01","minutesPerPc":1.5,"note":"","inputs":["P-BOX-1"]}]'::jsonb, 'routing steps are stored with canonical input codes');
select is(current_setting('test.snap')::jsonb -> 'colorSets' -> 0 ->> 'code', 'Y', 'the color set code is upper case');
select is(current_setting('test.snap')::jsonb -> 'colorSets' -> 0 ->> 'base', 'FG-T1', 'the color set base is canonical');
select is(current_setting('test.snap')::jsonb -> 'colorSets' -> 0 -> 'slots', '[{"key":"SE-T1-*-100-18-65","color":"OR01"},{"key":"SE-T1-*-100-18-65","color":""}]'::jsonb,
  'color slots keep their order and may repeat a key');
select is(current_setting('test.snap')::jsonb -> 'packages' -> 0 -> 'lines', '[{"childCode":"P-BOX-1","qty":2}]'::jsonb, 'package lines are stored');
select is(current_setting('test.snap')::jsonb -> 'packages' -> 0 ->> 'createdBy', current_setting('test.afm_name'),
  'the package records who created it');

-- factory manager: routing ใหม่ เรคอร์ดเก่าแก้ไม่ได้
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select set_config('test.rt1', (select r::text from jsonb_array_elements(public.app_bom_master() -> 'routings') r limit 1), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('routings', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.rt1')::jsonb, '{steps,0,minutesPerPc}', '9')))), 4, 'saveRouting') $$,
  'BOM_REVISION_IMMUTABLE', 'the steps of an existing routing revision cannot change');
select throws_ok($$ select public.app_bom_save_master('{"routings":{"upsert":[{"id":"RT-69-0002","itemCode":"FG-T1","revision":3,"status":"approved","steps":[]}]}}'::jsonb, 4, 'saveRouting') $$,
  'BOM_REVISION_ORDER', 'a new routing revision must follow the highest one');
select set_config('test.delta', public.app_bom_save_master(
  '{"routings":{"upsert":[{"id":"RT-69-0002","itemCode":"FG-T1","revision":2,"status":"approved","steps":[{"processCode":"X-01","minutesPerPc":2,"inputs":[]}]}]}}'::jsonb,
  4, 'saveRouting')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '5', 'the factory manager can save');
select is((select r ->> 'status' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'routings') r where r ->> 'id' = 'RT-69-0001'), 'superseded',
  'the previous routing revision is superseded by the server');
select ok((select (r ->> 'supersededAt') is not null from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'routings') r where r ->> 'id' = 'RT-69-0001'),
  'the superseded routing has supersededAt');

-- general manager: ลบชุดสีและแพ็กเกจ
select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select set_config('test.delta', public.app_bom_save_master(
  '{"colorSets":{"delete":[{"base":"FG-T1","code":"Y"}]},"packages":{"delete":[{"base":"fg-t1","code":"p"}]}}'::jsonb,
  5, 'removePackage')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '6', 'the general manager can save and delete');
select is(current_setting('test.delta')::jsonb -> 'changes' -> 'colorSets', '{"upsert":[],"delete":[{"base":"FG-T1","code":"Y"}]}'::jsonb, 'the reply lists the deleted colour set as a tombstone');
select is(current_setting('test.delta')::jsonb -> 'changes' -> 'packages', '{"upsert":[],"delete":[{"base":"FG-T1","code":"P"}]}'::jsonb, 'the reply lists the deleted package as a tombstone');
select is(public.app_bom_master_since(5) -> 'changes' -> 'colorSets' -> 'delete', '[{"base":"FG-T1","code":"Y"}]'::jsonb, 'the delta RPC lists the same tombstone');
select is(public.app_bom_master_since(6) -> 'changes' -> 'colorSets' -> 'delete', '[]'::jsonb, 'a client that is already at version 6 gets no tombstone');
select is(public.app_bom_master_since(5) -> 'changes' -> 'items' -> 'delete', '[]'::jsonb, 'lists that cannot be deleted always have an empty delete list');
select is(current_setting('test.snap')::jsonb -> 'colorSets', '[]'::jsonb, 'the color set is deleted');
select is(current_setting('test.snap')::jsonb -> 'packages', '[]'::jsonb, 'the package is deleted');

-- แก้ item เดิม (ไม่เปลี่ยนชนิด) พร้อมรูป และย้ายแผนกเจ้าของ + changeLog ต่อท้ายของ BOM -------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.rec4', (select b::text from jsonb_array_elements(public.app_bom_master() -> 'boms') b where b ->> 'id' = 'BOM-69-0004'), true);
select set_config('test.delta', public.app_bom_save_master(jsonb_build_object(
  'items', jsonb_build_object('upsert', jsonb_build_array(
    '{"code":"FG-T1","kind":"FG","name":"สินค้าทดสอบ (แก้ไข)","ownerDept":"PK","uom":"set","weightG":130,"image":"data:image/png;base64,iVBORw0KGgo=","unitCost":null}'::jsonb)),
  'boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(jsonb_set(current_setting('test.rec4')::jsonb, '{ownerDept}', '"PT"'), '{changeLog}',
      (current_setting('test.rec4')::jsonb -> 'changeLog') || '[{"at":1762300003000,"by":"ลองปลอม","text":"ย้ายแผนกเจ้าของ PK → PT"}]'::jsonb)))),
  6, 'saveItem')::text, true);
select set_config('test.snap', public.app_bom_master()::text, true);
select is(current_setting('test.snap')::jsonb ->> 'version', '7', 'an existing item and an annotation of an existing BOM can be saved together');
select is((select i ->> 'name' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'FG-T1'), 'สินค้าทดสอบ (แก้ไข)', 'the item is updated in place');
select is((select i ->> 'image' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'FG-T1'), 'data:image/png;base64,iVBORw0KGgo=', 'a valid picture is stored');
select is((select i -> 'legacyCodes' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'items') i where i ->> 'code' = 'FG-T1'), '[]'::jsonb,
  'records are whole records: a field that is not sent is reset');
select is((select b ->> 'ownerDept' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'), 'PT', 'the owner department of a revision can move');
select is((select jsonb_array_length(b -> 'changeLog') from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'), 2, 'the change log grew by one entry');
select is((select b -> 'changeLog' -> 1 ->> 'by' from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'),
  current_setting('test.pp_name'), 'the appended entry is signed by the persona, not the name sent');
select ok((select b -> 'lines' = (current_setting('test.rec4')::jsonb -> 'lines') from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'),
  'the lines did not change');
select set_config('test.rec4b', (select b::text from jsonb_array_elements(current_setting('test.snap')::jsonb -> 'boms') b where b ->> 'id' = 'BOM-69-0004'), true);
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.rec4b')::jsonb, '{changeLog}', '[]'::jsonb)))), 7, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'the change log of an existing revision cannot be shortened');
select throws_ok($$ select public.app_bom_save_master(jsonb_build_object('boms', jsonb_build_object('upsert', jsonb_build_array(
    jsonb_set(current_setting('test.rec4b')::jsonb, '{changeLog,0,text}', '"แก้ประวัติย้อนหลัง"')))), 7, 'saveBom') $$,
  'BOM_REVISION_IMMUTABLE', 'an old change log entry cannot be rewritten');

-- อ่านแล้วเห็นเหมือนกันทุก persona
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(jsonb_array_length(public.app_bom_master() -> 'items'), 6, 'a non-planner persona reads the saved items');
select is(jsonb_array_length(public.app_bom_master() -> 'boms'), 5, 'a non-planner persona reads the saved BOMs');
select is(public.app_bom_master() ->> 'version', '7', 'a non-planner persona reads the current version');
select is(public.app_bom_master() -> 'items' -> 1 ->> 'name', 'สินค้าทดสอบ (แก้ไข)', 'a non-planner persona reads the latest data');
select throws_ok($$ select public.app_bom_save_master('{"items":{"upsert":[]}}'::jsonb, 7, 'saveItem') $$, 'BOM_FORBIDDEN', 'the same persona still cannot save');

-- 10. audit, การแยกข้อมูลทดสอบ ----------------------------------------------------------------
reset role;
select is((select count(*) from public.audit_logs where action = 'BOM_MASTER_SAVE'), 7::bigint, 'every successful save writes one audit row and nothing else does');
select ok(not exists (select 1 from public.audit_logs where action = 'BOM_MASTER_SAVE' and actor_id <> '8d000000-0000-0000-0000-000000000101'),
  'the real admin behind the persona is the audit actor');
select is((select metadata ->> 'client_action' from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id = '1'), 'importFlat', 'the client action name is audited');
select is((select metadata -> 'counts' -> 'items' ->> 'upsert' from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id = '1'), '6', 'the audit row holds counts per section');
select is((select metadata -> 'counts' -> 'boms' ->> 'upsert' from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id = '1'), '3', 'the audit row holds the BOM count');
select ok(not exists (select 1 from public.audit_logs where action = 'BOM_MASTER_SAVE' and metadata::text like '%FG-T1%'),
  'the audit row never holds the payload');
select is((select count(*) from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id::integer between 1 and 7), 7::bigint, 'the audit entity id is the new version');
select ok(not exists (select 1 from public.bom_items where code <> 'REAL-ITEM' and not is_test)
      and not exists (select 1 from public.bom_boms where not is_test)
      and not exists (select 1 from public.bom_bom_lines where not is_test)
      and not exists (select 1 from public.bom_master_state where is_test and version <> 7),
  'everything written through the RPCs is flagged as test data');
select is((select version from public.bom_master_state where not is_test), 99::bigint, 'the real version counter is untouched');
select is((select count(*) from public.bom_items where code = 'REAL-ITEM' and not is_test), 1::bigint, 'the real item is untouched');
select is((select count(*) from public.bom_bom_lines l join public.bom_boms b on b.id = l.bom_pk where b.bom_id = 'BOM-69-0004'), 2::bigint,
  'the lines of a revision are stored in their own table');
select is((select string_agg(l.child_code || ':' || l.line_no, ',' order by l.line_no) from public.bom_bom_lines l join public.bom_boms b on b.id = l.bom_pk where b.bom_id = 'BOM-69-0004'),
  'SE-T1-OR01-100-18-65:0,P-BOX-1:1', 'line order is stored');
select ok(exists (select 1 from public.bom_boms b where b.bom_id = 'BOM-69-0004' and b.approved_by = current_setting('test.p_sbx_pp_staff')::uuid
                  and b.created_by = current_setting('test.p_sbx_pp_staff')::uuid),
  'creator and approver are stored as employee ids');

-- 11. หลายคนบันทึกพร้อมกัน: ชนรายระเบียน (ตอนนี้ version 7) -----------------------------------------------
-- "A" = PP staff, "B" = ผู้ช่วยผู้จัดการโรงงาน เริ่มจาก base เดียวกันโดยยังไม่เห็นการบันทึกของกัน
savepoint stamp;
insert into public.bom_compounds (is_test, code, name, changed_version) values (true, 'ZZ99', 'x', 999);
select is((select changed_version from public.bom_compounds where code = 'ZZ99'), 8::bigint,
  'the trigger stamps version + 1 whatever value a writer sent for changed_version');
rollback to savepoint stamp;
set local role authenticated;

-- ระเบียนที่ไม่เกี่ยวกัน: ทั้งคู่บันทึกได้
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select set_config('test.a1', public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"A-ITEM","kind":"PURCHASED","name":"ของ A","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 7, 'saveItem')::text, true);
select is(current_setting('test.a1')::jsonb ->> 'version', '8', 'A saves from version 7');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select set_config('test.b1', public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"B-ITEM","kind":"PURCHASED","name":"ของ B","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 7, 'saveItem')::text, true);
select is(current_setting('test.b1')::jsonb ->> 'version', '9',
  'B saves from the same old version 7: A changed a different record, so nothing blocks B');
select is((select jsonb_agg(i ->> 'code' order by i ->> 'code') from jsonb_array_elements(current_setting('test.b1')::jsonb -> 'changes' -> 'items' -> 'upsert') i),
  '["A-ITEM","B-ITEM"]'::jsonb, 'the reply to B carries A''s record as well as B''s, so B catches up in one round trip');

-- ระเบียนเดียวกัน: คนที่สองถูกปฏิเสธ แต่งานของตัวเองที่ไม่ชนยังบันทึกได้
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"A-ITEM","kind":"PURCHASED","name":"ของ A (แก้)","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 9, 'saveItem') ->> 'version', '10',
  'A edits A-ITEM from version 9');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"A-ITEM","kind":"PURCHASED","name":"ของ A (B แก้)","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 9, 'saveItem') $$, 'BOM_STALE',
  'B editing the record A changed after B''s base is stale');
select is((select i ->> 'name' from jsonb_array_elements(public.app_bom_master() -> 'items') i where i ->> 'code' = 'A-ITEM'), 'ของ A (แก้)',
  'the rejected save wrote nothing');
select is(public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"B-ITEM","kind":"PURCHASED","name":"ของ B (แก้)","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 9, 'saveItem') ->> 'version', '11',
  'B editing its own record from version 9 still saves although the global version moved on');

-- สร้างกุญแจที่อีกฝ่ายเพิ่งสร้างหลัง base
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"C-ITEM","kind":"PURCHASED","name":"ของ C","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 11, 'saveItem') ->> 'version', '12', 'A creates C-ITEM');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select public.app_bom_save_master(
  '{"items":{"upsert":[{"code":"C-ITEM","kind":"PURCHASED","name":"C ของ B","ownerDept":"ST","uom":"pcs"}]}}'::jsonb, 11, 'saveItem') $$, 'BOM_STALE',
  'creating a code that exists with a newer version than the base is stale');
select throws_ok($$ select public.app_bom_save_master(
  '{"compounds":{"upsert":[{"code":"DM01","name":"EPDM เปลี่ยนชื่อ"}]}}'::jsonb, 0, 'linkCompound') $$, 'BOM_STALE',
  'a record changed since an old base is stale (here a compound)');

-- revision ใหม่ของชิ้นเดียวกันพร้อมกัน: คนที่สองถูกปฏิเสธ ชิ้นอื่นไม่ถูกขวาง (ตอนนี้ version 12)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-A-3","itemCode":"FG-T1","revision":3,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 12, 'saveBom') ->> 'version', '13',
  'A saves revision 3 of FG-T1');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-B-3","itemCode":"FG-T1","revision":3,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":2}]}]}}'::jsonb, 12, 'saveBom') $$, 'BOM_STALE',
  'B saving a revision of the same item from the old base is rejected (the item changed under B)');
select throws_ok($$ select public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-B-3","itemCode":"FG-T1","revision":5,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":2}]}]}}'::jsonb, 13, 'saveBom') $$, 'BOM_REVISION_ORDER',
  'from the current base a skipped revision number is still a revision order error');
select set_config('test.b2', public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-B-S3","itemCode":"SE-T1-OR01-100-18-65","revision":3,"status":"approved","lines":[{"childCode":"RB-DM01-A-OR01-100-18-65","qty":0.3}]}]}}'::jsonb, 12, 'saveBom')::text, true);
select is(current_setting('test.b2')::jsonb ->> 'version', '14', 'B saves a new revision of a different item from the old base');
select is((select string_agg((b ->> 'id') || ':' || (b ->> 'status'), ',' order by b ->> 'id') from jsonb_array_elements(current_setting('test.b2')::jsonb -> 'changes' -> 'boms' -> 'upsert') b),
  'BOM-69-0004:superseded,BOM-69-0005:superseded,BOM-A-3:approved,BOM-B-S3:approved',
  'the delta holds both users'' new revisions and the revisions the server superseded for them');
select is(current_setting('test.b2')::jsonb -> 'changes', public.app_bom_master_since(12) -> 'changes', 'the reply to a save equals the delta RPC from the same base');
select is(public.app_bom_master_since(14) -> 'changes' -> 'boms' -> 'upsert', '[]'::jsonb, 'the delta from the current version is empty');
-- authenticated อ่านตารางตรงไม่ได้ (RLS deny-all) จึงนับด้วยบทบาทของเทสต์ แล้วกลับเป็น authenticated (claims ของ session ยังอยู่)
reset role;
select is((select count(*) from public.bom_boms where item_code = 'FG-T1' and status = 'approved' and is_test), 1::bigint, 'still exactly one approved revision per item');
set local role authenticated;

-- ลบ: ระเบียนที่คนอื่นแก้ หรือที่คนอื่นลบไปแล้ว (ตอนนี้ version 14)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"colorSets":{"upsert":[{"base":"FG-T1","code":"Z","slots":[{"key":"SE-T1-*-100-18-65","color":"OR01"}]}]}}'::jsonb, 14, 'saveColorSet') ->> 'version', '15', 'A creates colour set Z');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 14, 'removeColorSet') $$, 'BOM_STALE',
  'deleting a record that changed after the base is stale');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master('{"colorSets":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 15, 'removeColorSet') ->> 'version', '16', 'A deletes colour set Z');
select is(public.app_bom_master_since(15) -> 'changes' -> 'colorSets', '{"upsert":[],"delete":[{"base":"FG-T1","code":"Z"}]}'::jsonb,
  'the deletion is a tombstone in the delta');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select throws_ok($$ select public.app_bom_save_master(
  '{"colorSets":{"upsert":[{"base":"FG-T1","code":"Z","slots":[{"key":"SE-T1-*-100-18-65","color":"OR02"}]}]}}'::jsonb, 15, 'saveColorSet') $$, 'BOM_STALE',
  'editing a record that someone deleted after the base is stale');
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 15, 'removeColorSet') $$, 'BOM_STALE',
  'deleting a record that someone already deleted after the base is stale, not missing');
select throws_ok($$ select public.app_bom_save_master('{"colorSets":{"delete":[{"base":"FG-T1","code":"Z"}]}}'::jsonb, 16, 'removeColorSet') $$, 'BOM_NOT_FOUND',
  'from the current base the same deletion is a plain not found');
select is(public.app_bom_save_master(
  '{"colorSets":{"upsert":[{"base":"FG-T1","code":"Z","slots":[{"key":"SE-T1-*-100-18-65","color":"OR02"}]}]}}'::jsonb, 16, 'saveColorSet') ->> 'version', '17',
  'from the current base the colour set can be created again');
select is(public.app_bom_master_since(15) -> 'changes' -> 'colorSets' -> 'delete', '[]'::jsonb, 'creating the key again removes its tombstone');
select is(jsonb_array_length(public.app_bom_master_since(15) -> 'changes' -> 'colorSets' -> 'upsert'), 1, 'the recreated colour set is an upsert in the delta');

-- ลบแล้วสร้างใหม่ในคำสั่งเดียวกัน และแพ็กเกจ
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"packages":{"upsert":[{"base":"FG-T1","code":"Q","lines":[{"childCode":"P-BOX-1","qty":1}]}]}}'::jsonb, 17, 'savePackage') ->> 'version', '18', 'A creates package Q');
select is(public.app_bom_save_master('{"packages":{"delete":[{"base":"FG-T1","code":"Q"}]}}'::jsonb, 18, 'removePackage') -> 'changes' -> 'packages' -> 'delete',
  '[{"base":"FG-T1","code":"Q"}]'::jsonb, 'a deleted package is a tombstone in the reply');
select is(public.app_bom_save_master(
  '{"packages":{"delete":[],"upsert":[{"base":"FG-T1","code":"Q","lines":[{"childCode":"P-BOX-1","qty":3}]}]}}'::jsonb, 19, 'savePackage') ->> 'version', '20',
  'a package can be created again from the current base');

-- รหัส BOM / routing ที่ client ออกเอง: สองคนเริ่มจาก base เดียวกันได้ส่วนนับเท่ากัน (0007) แต่ต่อรหัสสุ่มท้ายรหัส จึงเป็นคนละรหัส และบันทึกชิ้นที่ไม่เกี่ยวกันได้ทั้งคู่ (ตอนนี้ version 20)
-- ไม่ใช่การเปลี่ยนฝั่งฐานข้อมูล: เป็นสัญญาที่ client พึ่งอยู่ (รหัสซ้ำกับที่มีอยู่ = BOM_STALE ทำให้งานของคนที่สองถูกย้อนทั้งชุด)
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select is(public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-69-0007-k3x9ab","itemCode":"FG-T1","revision":4,"status":"approved","lines":[{"childCode":"P-BOX-1","qty":1}]}]},
    "routings":{"upsert":[{"id":"RT-69-0003-k3x9ab","itemCode":"FG-T1","revision":3,"status":"approved","steps":[{"processCode":"X-01","minutesPerPc":2,"inputs":[]}]}]}}'::jsonb, 20, 'saveBom') ->> 'version', '21',
  'A saves a new revision of one product with ids BOM-69-0007-k3x9ab and RT-69-0003-k3x9ab');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_afm')::uuid);
select is(public.app_bom_save_master(
  '{"boms":{"upsert":[{"id":"BOM-69-0007-p1q2zz","itemCode":"SE-T1-OR01-100-18-65","revision":4,"status":"approved","lines":[{"childCode":"RB-DM01-A-OR01-100-18-65","qty":0.3}]}]},
    "routings":{"upsert":[{"id":"RT-69-0003-p1q2zz","itemCode":"SE-T1-OR01-100-18-65","revision":1,"status":"approved","steps":[{"processCode":"X-01","minutesPerPc":3,"inputs":[]}]}]}}'::jsonb, 20, 'saveBom') ->> 'version', '22',
  'B saves a revision of another product from the same old base with the same counter part but another suffix: not stale');
reset role; -- อ่านตารางตรงด้วยบทบาทของเทสต์ (authenticated ถูก RLS deny-all)
select is((select count(*) from public.bom_boms where is_test and bom_id in ('BOM-69-0007-k3x9ab', 'BOM-69-0007-p1q2zz')), 2::bigint, 'both new BOM ids exist');
select is((select count(*) from public.bom_routings where is_test and routing_id in ('RT-69-0003-k3x9ab', 'RT-69-0003-p1q2zz')), 2::bigint, 'both new routing ids exist');
select is((select count(*) from public.bom_boms where is_test and item_code in ('FG-T1', 'SE-T1-OR01-100-18-65') and status = 'approved'), 2::bigint, 'one approved revision per product, neither reverted');

-- audit และข้อมูลจริง
reset role;
select is((select metadata ->> 'base_version' from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id = '8'), '7', 'the audit row records the base version');
select is((select metadata ->> 'base_version' from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id = '9'), '7', 'the audit row of the concurrent save records its own old base');
select is((select count(*) from public.audit_logs where action = 'BOM_MASTER_SAVE' and entity_id::integer between 8 and 20), 13::bigint, 'only successful saves are audited');
select is((select count(*) from public.bom_deleted_keys where not is_test), 0::bigint, 'no tombstone for real rows');
select ok(not exists (select 1 from public.bom_deleted_keys where is_test and (list, base, code) in (('colorSets', 'FG-T1', 'Z'), ('packages', 'FG-T1', 'Q'))),
  'a key that was created again has no tombstone');

select * from finish();
rollback;
