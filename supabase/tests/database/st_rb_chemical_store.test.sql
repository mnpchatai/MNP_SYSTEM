-- คลังเคมี ST (กลาง) กับคลังเคมีของ RB (20261220010000_st_rb_chemical_store.sql) ตรวจทั้งฝั่งอนุญาตและปฏิเสธของทุกคำสั่งใหม่:
--   ขอเบิก / ยกเลิก (กลุ่มวางแผน | RB) · จ่าย FEFO ข้ามล็อตกักกัน / หมดอายุ จ่ายบางส่วน ปิดยอดที่เหลือ (ST | admin) · นับคลัง RB (กลุ่มวางแผนเท่านั้น)
--   คืน (กลุ่มวางแผน | RB) · รับคืนทั้งใบ / ปฏิเสธพร้อมเหตุผล (ST | admin) · ใบเบิกผสมตัดคลัง RB · ใบเบิกเดิม (คลัง ST) ยังตัดคลัง ST · คืนใบเบิกตามคลังของใบ
-- (authenticated อ่านตาราง rf_* ตรงไม่ได้ จึงอ่านตารางด้วย reset role เสมอ)
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------------------------
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rf_material_lots' and column_name = 'rb_kg' and is_nullable = 'NO' and column_default = '0'),
  'material lots carry the RB store balance (not null, default 0)');
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'rf_requisitions' and column_name = 'source_store' and is_nullable = 'NO' and column_default like '''ST''%'),
  'requisitions carry the store they draw from (default ST for the rows before this change)');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.rf_chem_docs'::regclass), 'the chemical store document table has RLS enabled');
select ok(not exists (select 1 from unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
                      where has_table_privilege(r.role, 'public.rf_chem_docs', p.priv)),
  'anon and authenticated have no direct privilege on the chemical store documents');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_chem_docs'::regclass and p.polname = 'rf_chem_docs_no_direct_access'),
  'the document table has the deny-all policy');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.rf_chem_docs'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive),
  'and the restrictive lab-only policy');
select ok(exists (select 1 from pg_trigger g where g.tgrelid = 'public.rf_chem_docs'::regclass and g.tgname = 'rf_chem_docs_sandbox_scope' and not g.tgisinternal)
      and exists (select 1 from pg_trigger g where g.tgrelid = 'public.rf_chem_docs'::regclass and g.tgname = 'rf_chem_docs_stamp_version' and not g.tgisinternal),
  'the document table separates test data from real data and stamps changed_version by trigger');
select ok('rf_chem_docs' = any (private.sandbox_unguarded_tables()) and 'rf_purchase_orders' = any (private.sandbox_unguarded_tables())
      and 'itrp_history_entries' = any (private.sandbox_unguarded_tables()) and 'client_error_logs' = any (private.sandbox_unguarded_tables()),
  'the new table is sandbox aware and the redefined list keeps the earlier tables');
select ok(position('rf_chem_docs' in pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure)) > 0, 'the RubberFlow purge deletes the test documents too');
select ok(not exists (
    select 1 from unnest(array['private.rf_save_chem_docs(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)', 'private.rf_lot_in_transit(text)']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or has_function_privilege('authenticated', f.sig, 'execute')),
  'clients cannot call the new private helpers');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p
           where p.oid in ('private.rf_save_chem_docs(public.employees,text,boolean,boolean,boolean,text,jsonb,bigint,bigint)'::regprocedure,
                           'private.rf_lot_in_transit(text)'::regprocedure, 'public.app_rf_save(jsonb,bigint,text,jsonb,text)'::regprocedure)),
  'the writer, the helper and the RPC are security definer with an empty search_path');
select ok(not has_function_privilege('anon', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute')
      and has_function_privilege('authenticated', 'public.app_rf_save(jsonb,bigint,text,jsonb,text)', 'execute'),
  'the RubberFlow save RPC keeps its grants');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0, 'every callable public function keeps the lab-only guard');
select ok(array['requestChemicals', 'cancelChemicalRequest', 'issueChemicals', 'closeChemicalRequest', 'countRbStock', 'returnChemicals',
                'receiveChemicalReturn', 'rejectChemicalReturn', 'createRequisition', 'returnRequisition'] <@ private.rf_client_actions(),
  'the action whitelist knows the eight chemical store actions');

-- 2. บัญชีทดสอบ ตัวช่วย และค่าที่ใช้ซ้ำ ---------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values ('8e920000-0000-0000-0000-000000000001', 'strb-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8e920000-0000-0000-0000-000000000101', 'STRB-ADMIN', 'Strb', 'Admin', 'strb-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8e920000-0000-0000-0000-000000000001');
-- persona ผู้ดูแลระบบ (is_test) ไว้ตรวจว่า admin ปิดยอดใบขอเบิกได้
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test) values
  ('SBX-ADMIN-T', 'ทดสอบ', 'ผู้ดูแลระบบ', 'sbx-admin-t@sandbox.local', 'ผู้ดูแลระบบ (ทดสอบ)',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.n_' || lower(replace(employee_no, '-', '_')), first_name || ' ' || last_name, true)) from public.employees where is_test;
select set_config('test.now_ms', (extract(epoch from now()) * 1000)::bigint::text, true);
-- ข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรง: โหมดทดสอบต้องมองไม่เห็น
insert into public.rf_materials (code, name) values ('REAL-MAT', 'วัตถุดิบจริง');
insert into public.rf_chem_docs (doc_no, kind, status, lines) values ('CR-20260101-01', 'request', 'open', '[{"materialCode":"REAL-MAT","qtyKg":1,"issuedKg":0,"issues":[]}]'::jsonb);

create schema st_t;
grant usage on schema st_t to authenticated;
create function st_t.rver() returns bigint language sql stable as $$ select (public.app_rf_master() ->> 'version')::bigint $$;
create function st_t.rf(p_changes jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select public.app_rf_save(p_changes, coalesce(p_base, st_t.rver()), p_action)
$$;
create function st_t.chem(p_row jsonb, p_action text, p_base bigint default null) returns jsonb language sql volatile as $$
  select st_t.rf(jsonb_build_object('chemDocs', jsonb_build_object('upsert', jsonb_build_array(p_row))), p_action, p_base)
$$;
create function st_t.doc(p_no text) returns jsonb language sql stable as $$
  select d from jsonb_array_elements(public.app_rf_master() -> 'chemDocs') d where d ->> 'id' = p_no
$$;
create function st_t.mlot(p_no text) returns jsonb language sql stable as $$
  select l from jsonb_array_elements(public.app_rf_master() -> 'materialLots') l where l ->> 'lotNo' = p_no
$$;
create function st_t.req(p_no text) returns jsonb language sql stable as $$
  select q from jsonb_array_elements(public.app_rf_master() -> 'requisitions') q where q ->> 'id' = p_no
$$;
create function st_t.wo(p_no text) returns jsonb language sql stable as $$
  select w from jsonb_array_elements(public.app_rf_master() -> 'orders') w where w ->> 'id' = p_no
$$;
-- ยอด ST / RB ของล็อตเป็นข้อความ "qty/rb"
create function st_t.kg(p_no text) returns text language sql stable as $$
  select (st_t.mlot(p_no) ->> 'qtyKg') || '/' || (st_t.mlot(p_no) ->> 'rbKg')
$$;
-- จ่ายครั้งนี้ p_kgs ตามลำดับบรรทัด: issuedKg สะสมใหม่ = ที่เก็บ + ครั้งนี้
create function st_t.issue(p_no text, p_kgs jsonb, p_base bigint default null) returns jsonb language sql volatile as $$
  select st_t.chem(st_t.doc(p_no) || jsonb_build_object('lines', (
    select jsonb_agg(t.e || jsonb_build_object('issuedKg', (t.e ->> 'issuedKg')::numeric + coalesce((p_kgs ->> (t.ord - 1)::integer)::numeric, 0)) order by t.ord)
    from jsonb_array_elements(st_t.doc(p_no) -> 'lines') with ordinality as t(e, ord))), 'issueChemicals', p_base)
$$;
create function st_t.set_status(p_no text, p_status text, p_action text, p_reason text default null) returns jsonb language sql volatile as $$
  select st_t.chem(st_t.doc(p_no) || jsonb_build_object('status', p_status)
    || case when p_reason is null then '{}'::jsonb else jsonb_build_object('reason', p_reason) end, p_action)
$$;
create function st_t.give_back(p_req text, p_kgs jsonb, p_note text default null) returns jsonb language sql volatile as $$
  select st_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array(
    st_t.req(p_req) || jsonb_build_object('lines', (
      select jsonb_agg(t.e || jsonb_build_object('returnedKg', p_kgs -> (t.ord - 1)::integer) order by t.ord)
      from jsonb_array_elements(st_t.req(p_req) -> 'lines') with ordinality as t(e, ord)))
    || case when p_note is null then '{}'::jsonb else jsonb_build_object('returnNote', p_note) end))), 'returnRequisition')
$$;

select set_config('test.mat', '{"code":"X","name":"x","category":"วัตถุดิบ","storage":"A-1","uom":"kg","active":true}', true);
select set_config('test.rec', '{"id":"RC-1","revision":1,"productCode":"P-1","uom":"m","batchKg":60,"stages":[{"stage":1,"mixerTemp":80,"dumpTemp":115,"mixMin":3},{"stage":2,"mixerTemp":90,"dumpTemp":140,"mixMin":2}],"dumpTol":6,"restHours":4,"yieldPerKg":6.1,"items":[{"materialCode":"MAT-A","phr":100,"stage":1},{"materialCode":"MAT-B","phr":50,"stage":1}],"status":"draft"}', true);
select set_config('test.wo', '{"id":"X","customer":"ACME","customerPo":"PO-1","recipeId":"RC-1","recipeRevision":1,"color":"ดำ","targetQty":100,"targetKg":60,"producedQty":0,"startDate":1762387200000,"dueDate":1765065600000,"priority":"normal","note":"","status":"planned"}', true);
select set_config('test.ml', jsonb_build_object('lotNo', 'X', 'materialCode', 'MAT-A', 'qtyKg', 100, 'expiry', current_setting('test.now_ms')::bigint + 864000000,
  'supplier', 'บจก. โพลีเคม', 'location', 'A-1', 'status', 'available', 'coa', true)::text, true);
select set_config('test.cr', '{"id":"X","kind":"request","status":"open","lines":[],"note":""}', true);

-- 3. ข้อมูลตั้งต้น -----------------------------------------------------------------------------------------
--   MAT-A: RM-A-X 50 kg หมดอายุแล้ว (ใส่ตรง) · RM-A-H 50 kg หมดอายุก่อนสุด (+5 วัน กักกัน) · RM-A-1 100 kg (+10 วัน) · RM-A-2 300 kg (+200 วัน) · MAT-B: RM-B-1 200 kg
--   สูตร RC-1 (60 kg ต่อ batch: MAT-A 40 + MAT-B 20) · WO-1 ต้องใช้ 60 kg (1 batch) · WO-2 ต้องใช้ 120 kg (2 batch)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8e920000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('materials', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.mat')::jsonb || '{"code":"MAT-A","name":"ยาง EPDM"}'::jsonb, current_setting('test.mat')::jsonb || '{"code":"MAT-B","name":"เขม่าดำ"}'::jsonb,
  current_setting('test.mat')::jsonb || '{"code":"MAT-OFF","name":"เลิกใช้","active":false}'::jsonb))), 'saveMaterial') is not null, 'the planner adds the materials');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.rec')::jsonb))), 'createRecipe') is not null, 'RB drafts the recipe');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select ok(st_t.rf(jsonb_build_object('recipes', jsonb_build_object('upsert', jsonb_build_array(
  (select r || '{"status":"approved"}'::jsonb from jsonb_array_elements(public.app_rf_master() -> 'recipes') r where r ->> 'id' = 'RC-1')))), 'approveRecipe') is not null,
  'the RB head approves it');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('materialLots', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.ml')::jsonb || jsonb_build_object('lotNo', 'RM-A-H', 'qtyKg', 50, 'expiry', current_setting('test.now_ms')::bigint + 432000000),
  current_setting('test.ml')::jsonb || '{"lotNo":"RM-A-1"}'::jsonb,
  current_setting('test.ml')::jsonb || jsonb_build_object('lotNo', 'RM-A-2', 'qtyKg', 300, 'expiry', current_setting('test.now_ms')::bigint + 17280000000),
  current_setting('test.ml')::jsonb || jsonb_build_object('lotNo', 'RM-B-1', 'materialCode', 'MAT-B', 'qtyKg', 200, 'expiry', current_setting('test.now_ms')::bigint + 8640000000)))),
  'receiveMaterial') is not null, 'ST receives four lots');
select is(st_t.kg('RM-A-1'), '100/0', 'a received lot sits in the ST store only');
select ok(st_t.rf(jsonb_build_object('materialLots', jsonb_build_object('upsert', jsonb_build_array(st_t.mlot('RM-A-H') || '{"status":"hold"}'::jsonb))), 'setMaterialLotStatus') is not null,
  'ST puts the earliest lot on hold');
reset role;
insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry) values (true, 'RM-A-X', 'MAT-A', 50, 50, current_setting('test.now_ms')::bigint - 86400000);
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(
  current_setting('test.wo')::jsonb || '{"id":"WO-1"}'::jsonb, current_setting('test.wo')::jsonb || '{"id":"WO-2","targetKg":120}'::jsonb))), 'createOrder') is not null,
  'RB opens two work orders');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(st_t.wo('WO-1') || '{"status":"released"}'::jsonb, st_t.wo('WO-2') || '{"status":"released"}'::jsonb))), 'setOrderStatus') is not null,
  'the planner releases both');
select is(public.app_rf_master() -> 'chemDocs', '[]'::jsonb, 'the real chemical document is never listed in test mode');

-- 4. ขอเบิก (requestChemicals): กลุ่มวางแผน หรือ RB ----------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_FORBIDDEN', 'ST staff cannot raise a chemical request');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_FORBIDDEN', 'nor QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_wh_staff')::uuid);
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_FORBIDDEN', 'nor WH staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":0}]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'a zero quantity is refused');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"NOPE","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'an unknown material is refused');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-OFF","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'a retired material is refused');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5},{"materialCode":"MAT-A","qtyKg":2}]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'a material twice in one request is refused');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'a request needs at least one line');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CT-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'a request number must start with CR-');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'saveMaterial') $$,
  'RF_INVALID_CHEM', 'chemical documents travel only with the chemical store actions');
select throws_ok($$ select st_t.rf(jsonb_build_object('chemDocs', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb)),
                                                   'materials', jsonb_build_object('upsert', jsonb_build_array(current_setting('test.mat')::jsonb || '{"code":"MAT-Z","name":"z"}'::jsonb))), 'requestChemicals') $$,
  'RF_INVALID_CHEM', 'and a chemical store action carries no other list than the documents and lot copies');
select set_config('test.res', st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","note":" เติมคลัง RB ","createdBy":"ใครก็ได้","lines":[{"materialCode":"MAT-A","qtyKg":120,"issuedKg":99,"issues":[{"lotNo":"RM-A-2","kg":99}]},{"materialCode":"MAT-B","qtyKg":30}]}'::jsonb, 'requestChemicals')::text, true);
select is(current_setting('test.res')::jsonb -> 'changes' -> 'chemDocs' -> 'upsert' -> 0 ->> 'status', 'open', 'RB staff raises a request: it opens');
select is(st_t.doc('CR-20261124-01') -> 'lines',
  '[{"materialCode":"MAT-A","qtyKg":120,"issuedKg":0,"issues":[]},{"materialCode":"MAT-B","qtyKg":30,"issuedKg":0,"issues":[]}]'::jsonb,
  'the server builds the lines (what the client claimed was issued is ignored)');
select is(jsonb_build_array(st_t.doc('CR-20261124-01') ->> 'kind', st_t.doc('CR-20261124-01') ->> 'note', st_t.doc('CR-20261124-01') ->> 'createdBy'),
  jsonb_build_array('request', 'เติมคลัง RB', current_setting('test.n_sbx_rb_staff')), 'the kind, the trimmed note and the requester come from the server');
select is(st_t.kg('RM-A-1'), '100/0', 'a request moves nothing yet');
select throws_ok($$ select st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-01","createdAt":5,"lines":[{"materialCode":"MAT-A","qtyKg":5}]}'::jsonb, 'requestChemicals', 0) $$,
  'RF_STALE', 'a request number someone else just used is stale, not a silent overwrite');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-02","lines":[{"materialCode":"MAT-B","qtyKg":5}]}'::jsonb, 'requestChemicals') is not null,
  'the planning group raises a request too');

-- 5. ยกเลิกใบขอเบิก (cancelChemicalRequest): กลุ่มวางแผน หรือ RB · ใบที่ยังไม่จ่ายเลยเท่านั้น -------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.set_status('CR-20261124-02', 'cancelled', 'cancelChemicalRequest') $$, 'RF_FORBIDDEN', 'ST staff cannot cancel an RB request');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.set_status('CR-20261124-02', 'closed', 'cancelChemicalRequest') $$, 'RF_INVALID_CHEM', 'cancelling sets the cancelled status, nothing else');
select is(st_t.set_status('CR-20261124-02', 'cancelled', 'cancelChemicalRequest') -> 'changes' -> 'chemDocs' -> 'upsert' -> 0 ->> 'status', 'cancelled', 'RB staff cancels an untouched request');
select is(st_t.doc('CR-20261124-02') ->> 'doneBy', current_setting('test.n_sbx_rb_staff'), 'the canceller is recorded');
select set_config('test.rv', st_t.rver()::text, true);
select is(st_t.set_status('CR-20261124-02', 'cancelled', 'cancelChemicalRequest') ->> 'version', current_setting('test.rv'), 'cancelling again writes nothing');

-- 6. จ่าย (issueChemicals): ST หรือ admin · FEFO จากคลัง ST ข้ามล็อตกักกันและหมดอายุ · จ่ายบางส่วนได้ ---------------------------------
select throws_ok($$ select st_t.issue('CR-20261124-01', '[10, 0]'::jsonb) $$, 'RF_FORBIDDEN', 'RB staff cannot issue chemicals to themselves');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select st_t.issue('CR-20261124-01', '[10, 0]'::jsonb) $$, 'RF_FORBIDDEN', 'nor the planning group (ST or admin only)');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select st_t.issue('CR-20261124-01', '[10, 0]'::jsonb) $$, 'RF_FORBIDDEN', 'nor QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.issue('CR-20261124-01', '[121, 0]'::jsonb) $$, 'RF_INVALID_CHEM', 'no more than the request still needs');
select throws_ok($$ select st_t.issue('CR-20261124-01', '[-1, 0]'::jsonb) $$, 'RF_INVALID_CHEM', 'no negative kilograms');
select throws_ok($$ select st_t.issue('CR-20261124-02', '[1]'::jsonb) $$, 'RF_INVALID_TRANSITION', 'a cancelled request cannot be issued');
select set_config('test.base', st_t.rver()::text, true);
select set_config('test.res', st_t.issue('CR-20261124-01', '[110, 0]'::jsonb)::text, true);
select is(st_t.doc('CR-20261124-01') ->> 'status', 'partial', 'ST issues 110 of the 120 kg of MAT-A: the request is partly issued');
select is((select jsonb_agg(jsonb_build_array(i ->> 'lotNo', (i ->> 'kg')::numeric) order by t.ord) from jsonb_array_elements(st_t.doc('CR-20261124-01') -> 'lines' -> 0 -> 'issues') with ordinality as t(i, ord)),
  '[["RM-A-1", 100], ["RM-A-2", 10]]'::jsonb, 'FEFO skips the expired lot and the lot on hold, then empties the next lot first');
select is(st_t.doc('CR-20261124-01') -> 'lines' -> 0 -> 'issues' -> 0 ->> 'by', current_setting('test.n_sbx_st_staff'), 'each issue records who issued it');
select is(jsonb_build_array(st_t.kg('RM-A-1'), st_t.kg('RM-A-2'), st_t.kg('RM-A-H'), st_t.kg('RM-A-X')), '["0/100", "290/10", "50/0", "50/0"]'::jsonb,
  'the kilograms move from the ST store to the RB store at once (held and expired lots untouched)');
select is((st_t.doc('CR-20261124-01') -> 'lines' -> 0 ->> 'issuedKg') || '/' || (st_t.doc('CR-20261124-01') -> 'lines' -> 1 ->> 'issuedKg'), '110/0', 'the issued totals per line');
select throws_ok($$ select st_t.issue('CR-20261124-01', '[0, 5]'::jsonb, current_setting('test.base')::bigint) $$, 'RF_STALE', 'a copy older than the last issue is stale');
select set_config('test.rv', st_t.rver()::text, true);
select is(st_t.issue('CR-20261124-01', '[0, 0]'::jsonb) ->> 'version', current_setting('test.rv'), 'a copy with nothing more to issue writes nothing');
select ok(st_t.issue('CR-20261124-01', '[0, 30]'::jsonb) is not null, 'ST issues all of MAT-B in a second round');
select is(jsonb_build_array(st_t.doc('CR-20261124-01') ->> 'status', st_t.kg('RM-B-1')), '["partial", "170/30"]'::jsonb, 'still partial while MAT-A is short by 10 kg');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.set_status('CR-20261124-01', 'cancelled', 'cancelChemicalRequest') $$, 'RF_INVALID_TRANSITION', 'a request that was partly issued cannot be cancelled');
select ok(st_t.chem(current_setting('test.cr')::jsonb || '{"id":"CR-20261124-03","lines":[{"materialCode":"MAT-A","qtyKg":500}]}'::jsonb, 'requestChemicals') is not null, 'RB asks for 500 kg of MAT-A');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.issue('CR-20261124-03', '[500]'::jsonb) $$, 'RF_INSUFFICIENT_STOCK', 'the ST store has only 290 usable kilograms of MAT-A');

-- 7. ปิดยอดที่เหลือ (closeChemicalRequest): ST หรือ admin พร้อมเหตุผล 3-300 -------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.set_status('CR-20261124-01', 'closed', 'closeChemicalRequest', 'ของหมด') $$, 'RF_FORBIDDEN', 'RB staff cannot close a request');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.set_status('CR-20261124-01', 'closed', 'closeChemicalRequest', ' ab ') $$, 'RF_INVALID_CHEM', 'closing needs a reason of at least three characters');
select throws_ok($$ select st_t.set_status('CR-20261124-01', 'closed', 'closeChemicalRequest', repeat('ก', 301)) $$, 'RF_INVALID_CHEM', 'and at most 300');
select ok(st_t.set_status('CR-20261124-01', 'closed', 'closeChemicalRequest', 'ผู้ขายส่งไม่ครบ') is not null, 'ST closes the remainder with a reason');
select is(jsonb_build_array(st_t.doc('CR-20261124-01') ->> 'status', st_t.doc('CR-20261124-01') ->> 'reason', st_t.doc('CR-20261124-01') ->> 'doneBy'),
  jsonb_build_array('closed', 'ผู้ขายส่งไม่ครบ', current_setting('test.n_sbx_st_staff')), 'the request is closed with the reason and the closer');
select throws_ok($$ select st_t.issue('CR-20261124-01', '[10, 0]'::jsonb) $$, 'RF_INVALID_TRANSITION', 'a closed request cannot be issued');
select public.app_sandbox_enter(current_setting('test.p_sbx_admin_t')::uuid);
select is(st_t.set_status('CR-20261124-03', 'closed', 'closeChemicalRequest', 'สั่งซื้อแล้ว รอของ') -> 'changes' -> 'chemDocs' -> 'upsert' -> 0 ->> 'status', 'closed',
  'admin closes an untouched request too');

-- 8. ใบเบิกผสมตัดคลัง RB รายล็อต (createRequisition) -------------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select set_config('test.res', st_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array('{"id":"REQ-1","orderId":"WO-1","batches":1,"note":""}'::jsonb))), 'createRequisition')::text, true);
select is(st_t.req('REQ-1') ->> 'store', 'RB', 'a new mixing requisition draws from the RB store');
select is((select jsonb_agg(jsonb_build_array(e ->> 'lotNo', (e ->> 'actualKg')::numeric) order by t.ord) from jsonb_array_elements(st_t.req('REQ-1') -> 'lines') with ordinality as t(e, ord)),
  '[["RM-A-1", 40], ["RM-B-1", 20]]'::jsonb, 'FEFO over the RB balances of the lots');
select is(jsonb_build_array(st_t.kg('RM-A-1'), st_t.kg('RM-B-1')), '["0/60", "170/10"]'::jsonb, 'the RB balances fall, the ST balances stay');
select throws_ok($$ select st_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array('{"id":"REQ-2","orderId":"WO-2","batches":2,"note":""}'::jsonb))), 'createRequisition') $$,
  'RF_INSUFFICIENT_STOCK', 'two batches need more MAT-B than the RB store holds (the ST stock does not count)');

-- 9. นับคลัง RB (countRbStock): กลุ่มวางแผนเท่านั้น (รวมผู้จัดการแผนก RB) ------------------------------------------------------
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","reason":"นับประจำเดือน","lines":[{"lotNo":"RM-A-1","countedKg":58}]}'::jsonb, 'countRbStock') $$,
  'RF_FORBIDDEN', 'RB staff cannot adjust the RB store');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","reason":"นับประจำเดือน","lines":[{"lotNo":"RM-A-1","countedKg":58}]}'::jsonb, 'countRbStock') $$,
  'RF_FORBIDDEN', 'nor ST staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_mgr')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","lines":[{"lotNo":"RM-A-1","countedKg":58}]}'::jsonb, 'countRbStock') $$,
  'RF_INVALID_CHEM', 'a count needs a reason');
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","reason":"นับประจำเดือน","lines":[{"lotNo":"RM-A-1","countedKg":101}]}'::jsonb, 'countRbStock') $$,
  'RF_INVALID_CHEM', 'a count cannot exceed what the lot can hold outside the ST store (100 received - 0 in ST)');
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","reason":"นับประจำเดือน","lines":[{"lotNo":"RM-A-1","countedKg":58},{"lotNo":"RM-A-1","countedKg":57}]}'::jsonb, 'countRbStock') $$,
  'RF_INVALID_CHEM', 'a lot twice in one count is refused');
select ok(st_t.chem('{"id":"CC-20261124-01","kind":"count","status":"done","reason":"นับประจำเดือน","lines":[{"lotNo":"RM-A-1","countedKg":58},{"lotNo":"RM-B-1","countedKg":10}]}'::jsonb, 'countRbStock') is not null,
  'the RB manager (planning group) counts the RB store');
select is(st_t.doc('CC-20261124-01') -> 'lines', '[{"lotNo":"RM-A-1","materialCode":"MAT-A","beforeKg":60,"countedKg":58},{"lotNo":"RM-B-1","materialCode":"MAT-B","beforeKg":10,"countedKg":10}]'::jsonb,
  'each line keeps the balance before and the counted balance');
select is(jsonb_build_array(st_t.doc('CC-20261124-01') ->> 'status', st_t.doc('CC-20261124-01') ->> 'doneBy', st_t.kg('RM-A-1')), jsonb_build_array('done', current_setting('test.n_sbx_rb_mgr'), '0/58'),
  'the count is done at once and sets the RB balance');

-- 10. คืนเคมีให้ ST (returnChemicals): กลุ่มวางแผน หรือ RB · หักคลัง RB ทันที -------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CT-20261124-01","kind":"return","status":"pending","lines":[{"lotNo":"RM-A-2","kg":6}]}'::jsonb, 'returnChemicals') $$, 'RF_FORBIDDEN', 'ST staff cannot raise an RB return');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CT-20261124-01","kind":"return","status":"pending","lines":[{"lotNo":"RM-A-2","kg":6}]}'::jsonb, 'returnChemicals') $$, 'RF_FORBIDDEN', 'nor QA staff');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CT-20261124-01","kind":"return","status":"pending","lines":[{"lotNo":"RM-A-2","kg":11}]}'::jsonb, 'returnChemicals') $$, 'RF_INVALID_CHEM', 'no more than the RB balance of the lot');
select throws_ok($$ select st_t.chem('{"id":"CT-20261124-01","kind":"return","status":"pending","lines":[{"lotNo":"RM-NOPE","kg":1}]}'::jsonb, 'returnChemicals') $$, 'RF_INVALID_CHEM', 'an unknown lot is refused');
select ok(st_t.chem('{"id":"CT-20261124-01","kind":"return","status":"pending","note":"เหลือจากงาน","lines":[{"lotNo":"RM-A-2","kg":6,"receivedKg":6}]}'::jsonb, 'returnChemicals') is not null, 'RB staff returns 6 kg of RM-A-2');
select is(st_t.doc('CT-20261124-01') -> 'lines', '[{"lotNo":"RM-A-2","materialCode":"MAT-A","kg":6,"receivedKg":null}]'::jsonb, 'the line takes its material from the lot and waits for ST');
select is(jsonb_build_array(st_t.doc('CT-20261124-01') ->> 'status', st_t.kg('RM-A-2')), '["pending", "290/4"]'::jsonb, 'the return leaves the RB store at once and is pending');
select ok(st_t.chem('{"id":"CT-20261124-02","kind":"return","status":"pending","lines":[{"lotNo":"RM-B-1","kg":5}]}'::jsonb, 'returnChemicals') is not null, 'and 5 kg of RM-B-1');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select throws_ok($$ select st_t.chem('{"id":"CC-20261124-02","kind":"count","status":"done","reason":"นับซ้ำ","lines":[{"lotNo":"RM-A-2","countedKg":5}]}'::jsonb, 'countRbStock') $$,
  'RF_INVALID_CHEM', 'a count leaves room for what is on the way back to ST (300 - 290 in ST - 6 in transit = 4)');

-- 11. รับคืน (receiveChemicalReturn) ทั้งใบ / ปฏิเสธ (rejectChemicalReturn) พร้อมเหตุผล: ST หรือ admin ---------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.set_status('CT-20261124-01', 'received', 'receiveChemicalReturn') $$, 'RF_FORBIDDEN', 'RB staff cannot receive their own return');
select throws_ok($$ select st_t.set_status('CT-20261124-02', 'rejected', 'rejectChemicalReturn', 'ไม่รับ') $$, 'RF_FORBIDDEN', 'nor reject it');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.set_status('CT-20261124-01', 'rejected', 'receiveChemicalReturn') $$, 'RF_INVALID_CHEM', 'receiving sets the received status, nothing else');
select ok(st_t.set_status('CT-20261124-01', 'received', 'receiveChemicalReturn') is not null, 'ST receives the whole return');
select is(jsonb_build_array(st_t.doc('CT-20261124-01') ->> 'status', st_t.doc('CT-20261124-01') -> 'lines' -> 0 ->> 'receivedKg', st_t.kg('RM-A-2')), '["received", "6", "296/4"]'::jsonb,
  'exactly what was sent goes into the ST store');
select set_config('test.rv', st_t.rver()::text, true);
select is(st_t.set_status('CT-20261124-01', 'received', 'receiveChemicalReturn') ->> 'version', current_setting('test.rv'), 'receiving again writes nothing');
select throws_ok($$ select st_t.set_status('CT-20261124-01', 'rejected', 'rejectChemicalReturn', 'ไม่รับแล้ว') $$, 'RF_INVALID_TRANSITION', 'a received return cannot be rejected');
select throws_ok($$ select st_t.set_status('CT-20261124-02', 'rejected', 'rejectChemicalReturn') $$, 'RF_INVALID_CHEM', 'rejecting needs a reason');
select ok(st_t.set_status('CT-20261124-02', 'rejected', 'rejectChemicalReturn', 'ล็อตเปื้อน ใช้ต่อที่ RB') is not null, 'ST rejects the other return with a reason');
select is(jsonb_build_array(st_t.doc('CT-20261124-02') ->> 'status', st_t.doc('CT-20261124-02') ->> 'reason', st_t.kg('RM-B-1')), '["rejected", "ล็อตเปื้อน ใช้ต่อที่ RB", "170/10"]'::jsonb,
  'a rejected return puts the kilograms back into the RB store');

-- 12. ใบเบิกเดิม (คลัง ST) ยังตัดคลัง ST · คืนใบเบิกของ WO ที่ยกเลิกตามคลังของใบ ------------------------------------------------------
reset role;
insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines, status)
values (true, 'REQ-L1', 'WO-1', 'RC-1', 1, 1, 60, '[{"materialCode":"MAT-B","stage":1,"lotNo":"RM-B-1","targetKg":5,"actualKg":null,"weighedAt":null}]'::jsonb, 'weighing');
update public.rf_master_state set version = version + 1 where is_test;
set local role authenticated;
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(st_t.req('REQ-L1') ->> 'store', 'ST', 'a requisition from before the split belongs to the ST store');
select ok(st_t.rf(jsonb_build_object('requisitions', jsonb_build_object('upsert', jsonb_build_array(
  st_t.req('REQ-L1') || jsonb_build_object('lines', jsonb_build_array((st_t.req('REQ-L1') -> 'lines' -> 0) || '{"actualKg":5}'::jsonb))))), 'issueRequisition') is not null,
  'RB issues the old requisition');
select is(st_t.kg('RM-B-1'), '165/10', 'the old requisition still draws from the ST store');
select public.app_sandbox_enter(current_setting('test.p_sbx_pp_staff')::uuid);
select ok(st_t.rf(jsonb_build_object('orders', jsonb_build_object('upsert', jsonb_build_array(st_t.wo('WO-1') || '{"status":"cancelled"}'::jsonb))), 'setOrderStatus') is not null, 'the planner cancels WO-1');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select throws_ok($$ select st_t.give_back('REQ-1', '[40, 20]'::jsonb) $$, 'RF_FORBIDDEN', 'ST cannot take back a requisition of the RB store');
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select throws_ok($$ select st_t.give_back('REQ-L1', '[5]'::jsonb) $$, 'RF_FORBIDDEN', 'RB cannot take back a requisition of the ST store');
select ok(st_t.give_back('REQ-1', '[40, 20]'::jsonb) is not null, 'RB puts the unmixed chemicals of its own requisition back');
select is(jsonb_build_array(st_t.kg('RM-A-1'), st_t.kg('RM-B-1')), '["0/98", "165/30"]'::jsonb, 'into the RB store of the original lots');
select public.app_sandbox_enter(current_setting('test.p_sbx_st_staff')::uuid);
select ok(st_t.give_back('REQ-L1', '[5]'::jsonb) is not null, 'ST takes back the old requisition');
select is(st_t.kg('RM-B-1'), '170/30', 'into the ST store as before');

-- 13. ชุดข้อมูลและ audit -------------------------------------------------------------------------------------
select ok(public.app_rf_master_since(0) -> 'changes' ? 'chemDocs', 'the delta names the chemical documents list');
select is((select count(*)::integer from jsonb_array_elements(public.app_rf_master() -> 'chemDocs')), 6, 'the snapshot lists the six test documents');
reset role;
select is((select count(*) from public.audit_logs where action = 'RF_SAVE' and metadata ->> 'client_action' = 'issueChemicals'), 2::bigint, 'each issue round has one RubberFlow audit row');
select is((select count(*) from public.rf_chem_docs where not is_test), 1::bigint, 'the real document is untouched');
select ok(not exists (
    select 1 from public.rf_material_lots l
    where l.is_test and l.qty_kg + l.rb_kg + coalesce((select sum((e ->> 'kg')::numeric) from public.rf_chem_docs d, jsonb_array_elements(d.lines) e
                                                       where d.is_test and d.kind = 'return' and d.status = 'pending' and e ->> 'lotNo' = l.lot_no), 0) > l.initial_kg + 0.000001),
  'no lot holds more than it received across both stores and the returns on the way');

select * from finish();
rollback;
