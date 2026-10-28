-- ใบตรวจ QC QA01-PM11 (20261027010000_qc_inspection_reports.sql): โครงสร้างและสิทธิ์ ปฏิเสธนอกโหมดทดสอบ/ผิดบทบาท
-- แม่แบบ ใบตรวจ (คำนวณ min/max/avg/judge/result) ส่ง/อนุมัติ 3 ขั้น/ห้ามอนุมัติใบตัวเอง/ไม่อนุมัติ/เปิดกลับ/ยกเลิก
-- ออก NCR จากใบ ng เชื่อม Lot กับผล Mooney และการล้างข้อมูลทดสอบ
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้างและสิทธิ์ ------------------------------------------------------------
create temp table qc_tables(name text) on commit drop;
insert into qc_tables values
  ('qc_inspection_templates'), ('qc_inspection_template_items'), ('qc_inspection_reports'),
  ('qc_inspection_items'), ('qc_inspection_approvals'), ('qc_inspection_history');

select is((select count(*) from qc_tables t join pg_class c on c.oid = ('public.' || t.name)::regclass where c.relrowsecurity),
  6::bigint, 'every QC table has RLS enabled');
select ok(not exists (
    select 1 from qc_tables t, unnest(array['anon', 'authenticated']) r(role), unnest(array['select', 'insert', 'update', 'delete']) p(priv)
    where has_table_privilege(r.role, 'public.' || t.name, p.priv)),
  'anon and authenticated have no direct table privilege on any QC table');
select ok(not exists (
    select 1 from qc_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = t.name || '_no_direct_access')),
  'every QC table has the deny-all policy');
select ok(not exists (
    select 1 from qc_tables t
    where not exists (select 1 from pg_policy p where p.polrelid = ('public.' || t.name)::regclass
                      and p.polname = 'lab_only_no_access' and not p.polpermissive)),
  'every QC table has the restrictive lab_only_no_access policy');
select ok(not exists (
    select 1 from qc_tables t
    where not exists (select 1 from pg_trigger g where g.tgrelid = ('public.' || t.name)::regclass
                      and g.tgname = t.name || '_sandbox_scope' and not g.tgisinternal)),
  'every QC table enforces sandbox scope by trigger');
select ok(not exists (select 1 from qc_tables t where not (t.name = any (private.sandbox_unguarded_tables()))),
  'every QC table is registered as sandbox aware');
select ok('factory_attachments' = any (private.sandbox_unguarded_tables()) and 'ncr_outcomes' = any (private.sandbox_unguarded_tables())
          and 'factory_job_inspections' = any (private.sandbox_unguarded_tables()),
  'the redefined sandbox list keeps the existing tables');
select is((select count(*) from pg_constraint c join qc_tables t on c.conrelid = ('public.' || t.name)::regclass
           where c.contype = 'u' and pg_get_constraintdef(c.oid) = 'UNIQUE (id, is_test)'),
  6::bigint, 'every QC table has unique (id, is_test) for the paired foreign keys');
select is((select count(*) from pg_constraint c join qc_tables t on c.conrelid = ('public.' || t.name)::regclass
           where c.contype = 'f' and pg_get_constraintdef(c.oid) like '%, is_test) REFERENCES %qc_inspection_%'),
  5::bigint, 'the five child foreign keys are paired with is_test');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0,
  'every callable public function (including the QC RPCs) has the lab-only guard');
select has_column('public', 'lab_mooney_results', 'lot_number', 'the Mooney results have a lot_number column');

select ok(not exists (
    select 1 from unnest(array[
      'public.app_qc_access()', 'public.app_qc_templates()', 'public.app_qc_save_template(jsonb)',
      'public.app_qc_reports(jsonb)', 'public.app_qc_report(uuid)', 'public.app_qc_save_report(jsonb)',
      'public.app_qc_submit_report(uuid,integer)', 'public.app_qc_decide_report(uuid,integer,text,text)',
      'public.app_qc_reopen_report(uuid,integer)', 'public.app_qc_cancel_report(uuid,integer,text)',
      'public.app_qc_issue_ncr(uuid,integer,text,numeric,numeric,text,text)', 'public.app_qc_lots(text)',
      'public.app_sandbox_purge_qc()']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute')),
  'anon cannot execute any QC RPC');
select ok(not exists (
    select 1 from unnest(array[
      'public.app_qc_access()', 'public.app_qc_templates()', 'public.app_qc_save_template(jsonb)',
      'public.app_qc_reports(jsonb)', 'public.app_qc_report(uuid)', 'public.app_qc_save_report(jsonb)',
      'public.app_qc_submit_report(uuid,integer)', 'public.app_qc_decide_report(uuid,integer,text,text)',
      'public.app_qc_reopen_report(uuid,integer)', 'public.app_qc_cancel_report(uuid,integer,text)',
      'public.app_qc_issue_ncr(uuid,integer,text,numeric,numeric,text,text)', 'public.app_qc_lots(text)',
      'public.app_sandbox_purge_qc()']) f(sig)
    where not has_function_privilege('authenticated', f.sig, 'execute')),
  'signed-in users can call every QC RPC (each checks the mode and role itself)');
select ok(not exists (
    select 1 from pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and (p.proname like 'qc\_%' or p.proname = 'next_qc_doc_number')
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  'clients cannot call any private QC helper');
select ok(not (has_function_privilege('anon', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute')
            or has_function_privilege('authenticated', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute'))
          and has_function_privilege('service_role', 'public.app_lab_mooney_import(jsonb, boolean)', 'execute'),
  'the Mooney import is still service_role only after the lot_number change');

-- ตัดสินจากสเปก (ฟังก์ชันตัดสินล้วน ๆ)
select is(private.qc_judge('{1,2}'::numeric[], 0, 3), 'O', 'all points inside the spec are O');
select is(private.qc_judge('{1,5}'::numeric[], 0, 3), 'N', 'a point above MAX is N');
select is(private.qc_judge('{-1,2}'::numeric[], 0, 3), 'N', 'a point below MIN is N');
select is(private.qc_judge('{0,3}'::numeric[], 0, 3), 'O', 'points on the limits are O');
select is(private.qc_judge('{5}'::numeric[], null, null), 'NA', 'no MIN and no MAX is not judged');
select is(private.qc_judge('{5}'::numeric[], null, 3), 'N', 'only MAX: above is N');
select is(private.qc_judge('{5}'::numeric[], 3, null), 'O', 'only MIN: above is O');

-- 2. บัญชีทดสอบและข้อมูลจริงที่ต้องไม่ถูกแตะ -------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8f000000-0000-0000-0000-000000000001', 'qc-admin@test.local', '{}'),
  ('8f000000-0000-0000-0000-000000000002', 'qc-staff@test.local', '{}'),
  ('8f000000-0000-0000-0000-000000000003', 'mnplab001-qc@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f000000-0000-0000-0000-000000000101', 'QC-ADMIN', 'Qc', 'Admin', 'qc-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f000000-0000-0000-0000-000000000001'),
  ('8f000000-0000-0000-0000-000000000102', 'QC-STAFF-REAL', 'Qc', 'Staff', 'qc-staff@test.local', 'QA',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8f000000-0000-0000-0000-000000000002'),
  ('8f000000-0000-0000-0000-000000000103', 'MNPLAB001', 'แล็บ', 'หนึ่ง', 'mnplab001-qc@test.local', 'LAB',
   (select id from public.departments where code = 'QA'), (select id from public.roles where code = 'staff'), '8f000000-0000-0000-0000-000000000003');
-- แม่แบบข้อมูลจริง (ไม่ใช่โหมดทดสอบ) ใส่ตรงแบบงานระบบ เพื่อตรวจว่าโหมดทดสอบมองไม่เห็นและล้างไม่โดน
insert into public.qc_inspection_templates (id, part_number, part_name)
values ('8f000000-0000-0000-0000-00000000f001', 'REAL-PART-01', 'ชิ้นงานจริงสำหรับตรวจการแยกโหมด');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

select set_config('test.tpl_items', $json$[
  {"item_no":"A","name":"ขนาด กว้าง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":12,"spec_std":13,"spec_max":14,"points_required":5},
  {"item_no":"B","name":"ขนาด สูง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":8.5,"spec_std":9,"spec_max":9.5},
  {"item_no":"C","name":"ความแข็ง Shore A","instrument":"Durometer","unit":"Shore A","spec_min":65,"spec_std":70,"spec_max":75},
  {"item_no":"D","name":"ความแข็ง Shore O","instrument":"Durometer","unit":"Shore O"}
]$json$, true);
-- ตัวอย่างจริงจากใบ QA01-PM11: A, B, C ไม่ผ่านสเปก D ไม่มีสเปก
select set_config('test.base', $json$
{"part_number":"L-SAMPLE","part_name":"ชิ้นงานตัวอย่าง","customer":"ลูกค้าทดสอบ","order_no":"PO-001","code":"C-01",
 "compound_lots":["E00030S-261027-4-01","E00030S-261027-4-02"],"sample_label":"2M","remark":"ตรวจรอบแรก",
 "items":[
  {"item_no":"A","name":"ขนาด กว้าง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":12,"spec_std":13,"spec_max":14,"points":[9.13,8.95,9.27,9.21,9.15],"note":"เล็กกว่าสเปค (เฉลี่ย) = -2.86mm."},
  {"item_no":"B","name":"ขนาด สูง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":8.5,"spec_std":9,"spec_max":9.5,"points":[13.93,13.23,14.23,13.08,14.30]},
  {"item_no":"C","name":"ความแข็ง Shore A","instrument":"Durometer","unit":"Shore A","spec_min":65,"spec_std":70,"spec_max":75,"points":[64,65,64,62,64]},
  {"item_no":"D","name":"ความแข็ง Shore O","instrument":"Durometer","unit":"Shore O","points":[21,22,23,22,21]}]}
$json$, true);
-- ใบที่ผ่านทุกรายการ (ผลรวม ok)
select set_config('test.ok_report', $json$
{"part_number":"L-OK","part_name":"ชิ้นงานผ่าน","items":[
  {"item_no":"A","name":"ขนาด กว้าง","spec_min":12,"spec_max":14,"points":[12.5,13,13.5]}]}
$json$, true);

-- 3. ปฏิเสธนอกโหมดทดสอบ ------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select throws_ok('select public.app_qc_templates()', 'AUTH_REQUIRED', 'reading requires a session');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_qc_templates()', 'QC_TEST_MODE_ONLY', 'a real QA staff account cannot read templates (real mode is not open)');
select throws_ok('select public.app_qc_access()', 'QC_TEST_MODE_ONLY', 'a real QA staff account cannot read the access flags');
select throws_ok($$ select public.app_qc_save_report(current_setting('test.base')::jsonb) $$, 'QC_TEST_MODE_ONLY', 'a real QA staff account cannot create a report');
select throws_ok('select public.app_qc_lots()', 'QC_TEST_MODE_ONLY', 'a real QA staff account cannot list the lots');
select throws_ok('select public.app_sandbox_purge_qc()', 'NOT_AUTHORIZED', 'a real staff account cannot purge');
select throws_ok('select count(*) from public.qc_inspection_reports', '42501', null, 'clients cannot read the report table directly');
select throws_ok('select count(*) from public.qc_inspection_templates', '42501', null, 'clients cannot read the template table directly');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok('select public.app_qc_templates()', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot use the QC module');

select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok('select public.app_qc_templates()', 'QC_TEST_MODE_ONLY', 'an admin outside test mode cannot read templates');
select throws_ok($$ select public.app_qc_save_report(current_setting('test.base')::jsonb) $$, 'QC_TEST_MODE_ONLY', 'an admin outside test mode cannot create a report');
select throws_ok('select public.app_sandbox_purge_qc()', 'SANDBOX_NOT_ACTIVE', 'purging needs test mode');

-- 4. persona ที่ไม่ใช่ QA / ผู้บริหาร ------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_rb_staff')::uuid);
select is(public.app_qc_access(), '{"read":false,"edit":false,"steps":[]}'::jsonb, 'a rubber-department staff persona has no QC rights');
select throws_ok('select public.app_qc_templates()', 'NOT_AUTHORIZED', 'a non-QA persona cannot read templates');
select throws_ok('select public.app_qc_reports()', 'NOT_AUTHORIZED', 'a non-QA persona cannot list reports');
select throws_ok('select public.app_qc_lots()', 'NOT_AUTHORIZED', 'a non-QA persona cannot list the lots');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'X-1', 'part_name', 'x', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'NOT_AUTHORIZED', 'a non-QA persona cannot save a template');
select throws_ok($$ select public.app_qc_save_report(current_setting('test.base')::jsonb) $$, 'NOT_AUTHORIZED', 'a non-QA persona cannot create a report');

-- 5. แม่แบบ (QA staff) ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select is(public.app_qc_access(), '{"read":true,"edit":true,"steps":[]}'::jsonb, 'a QA staff persona reads and edits but signs no step');
select is(public.app_qc_templates(), '[]'::jsonb, 'test mode starts with no template and never shows the real one');

select set_config('test.t', public.app_qc_save_template(jsonb_build_object(
  'part_number', ' L-SAMPLE ', 'part_name', 'ชิ้นงานตัวอย่าง', 'customer', 'ลูกค้าทดสอบ', 'drawing_note', 'จุดวัด 5 จุด',
  'items', current_setting('test.tpl_items')::jsonb))::text, true);
select is(current_setting('test.t')::jsonb ->> 'part_number', 'L-SAMPLE', 'the part number is trimmed');
select is(current_setting('test.t')::jsonb ->> 'version', '1', 'a new template starts at version 1');
select is(current_setting('test.t')::jsonb ->> 'status', 'active', 'a new template is active');
select is(jsonb_array_length(current_setting('test.t')::jsonb -> 'items'), 4, 'the template keeps its four items');
select is((select x ->> 'spec_min' from jsonb_array_elements(current_setting('test.t')::jsonb -> 'items') x where x ->> 'item_no' = 'D'), null,
  'an item without a spec stays empty');
select is((select x ->> 'points_required' from jsonb_array_elements(current_setting('test.t')::jsonb -> 'items') x where x ->> 'item_no' = 'B'), '5',
  'points_required defaults to five');
select set_config('test.tpl', current_setting('test.t')::jsonb ->> 'id', true);

select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'L-SAMPLE', 'part_name', 'ซ้ำ', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_PART_NUMBER_TAKEN', 'a part number is unique within the mode');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('id', current_setting('test.tpl'), 'version', 9, 'part_number', 'L-SAMPLE', 'part_name', 'x', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_VERSION_CONFLICT', 'a stale template version cannot overwrite');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('id', current_setting('test.tpl'), 'part_number', 'L-SAMPLE', 'part_name', 'x', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_VERSION_CONFLICT', 'editing a template needs its version');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('id', gen_random_uuid(), 'version', 1, 'part_number', 'NOPE', 'part_name', 'x', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_NOT_FOUND', 'an unknown template id is rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'a template needs at least one item');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[{"item_no":"A","name":"a","spec_min":5,"spec_max":1}]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'MIN above MAX is rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[{"item_no":"A","name":"a"},{"item_no":"A","name":"b"}]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'duplicate item numbers are rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[{"item_no":"a1","name":"a"}]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'item numbers are one or two capital letters');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[{"item_no":"A","name":"a","points_required":6}]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'more than five points is rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'items', '[{"item_no":"A","name":"a","spec_min":"1"}]'::jsonb)) $$,
  'QC_INVALID_ITEM', 'a spec given as text is rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', 'x', 'status', 'deleted', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'only active/inactive statuses are allowed');
select throws_ok($$ select public.app_qc_save_template('[]'::jsonb) $$, 'QC_INVALID_PAYLOAD', 'the payload must be an object');

select is((public.app_qc_save_template(jsonb_build_object('id', current_setting('test.tpl'), 'version', 1, 'part_number', 'L-SAMPLE', 'part_name', 'ชิ้นงานตัวอย่าง (แก้ไข)',
  'items', current_setting('test.tpl_items')::jsonb)) ->> 'version')::integer, 2, 'editing a template with its current version bumps it');
select is(jsonb_array_length(public.app_qc_templates()), 1, 'the test template is listed');

-- 6. ใบตรวจ: คำนวณ min/max/avg/judge/result ------------------------------------------------
select set_config('test.j', public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{template_id}', to_jsonb(current_setting('test.tpl'))))::text, true);
select set_config('test.r1', current_setting('test.j')::jsonb ->> 'id', true);
select set_config('test.rno', current_setting('test.j')::jsonb ->> 'report_no', true);
select matches(current_setting('test.j')::jsonb ->> 'report_no', '^TEST-QC-\d{2}-\d{3}$', 'the report number is a test-mode number');
select is(current_setting('test.j')::jsonb ->> 'status', 'draft', 'a new report is a draft');
select is(current_setting('test.j')::jsonb ->> 'version', '1', 'a new report starts at version 1');
select is(current_setting('test.j')::jsonb ->> 'result', 'ng', 'a report with failing items is ng');
select is(current_setting('test.j')::jsonb ->> 'inspected_by', current_setting('test.p_sbx_qa_staff'), 'the creator is the inspector');
select is(current_setting('test.j')::jsonb -> 'compound_lots', '["E00030S-261027-4-01","E00030S-261027-4-02"]'::jsonb, 'the compound lots are stored in order');
select is(current_setting('test.j')::jsonb ->> 'template_id', current_setting('test.tpl'), 'the template is linked');
select is((select (x ->> 'point_min')::numeric from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 8.95::numeric, 'A min');
select is((select (x ->> 'point_max')::numeric from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 9.27::numeric, 'A max');
select is((select (x ->> 'point_avg')::numeric from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 9.142::numeric, 'A average');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 'N', 'A is below the spec');
select is((select (x ->> 'point_avg')::numeric from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'B'), 13.754::numeric, 'B average');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'B'), 'N', 'B is above the spec');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'C'), 'N', 'C fails although one point is inside the spec');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'D'), 'NA', 'D has no spec and is not judged');
select is((select x ->> 'note' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 'เล็กกว่าสเปค (เฉลี่ย) = -2.86mm.', 'the item note is kept');
select is(jsonb_array_length(current_setting('test.j')::jsonb -> 'history'), 1, 'creating writes one history row');

-- ตรวจค่าที่ client ส่งมา
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","spec_min":12,"spec_max":14,"points":[13],"judge_override":"AC","note":"ยอมรับพิเศษ"}]'::jsonb)) $$,
  'QC_INVALID_JUDGE', 'AC cannot be set on an item that passes');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","spec_min":12,"spec_max":14,"points":[20],"judge_override":"AC"}]'::jsonb)) $$,
  'QC_ACCEPT_NOTE_REQUIRED', 'AC on a failing item needs a note');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","spec_min":12,"spec_max":14,"points":[20],"judge_override":"AC","note":"abc"}]'::jsonb)) $$,
  'QC_ACCEPT_NOTE_REQUIRED', 'the AC note needs at least five characters');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","spec_min":12,"spec_max":14,"points":[20],"judge_override":"O","note":"ยอมรับพิเศษ"}]'::jsonb)) $$,
  'QC_INVALID_JUDGE', 'only AC is accepted as an override');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"D","name":"d","points":[20],"judge_override":"AC","note":"ยอมรับพิเศษ"}]'::jsonb)) $$,
  'QC_INVALID_JUDGE', 'AC cannot be set on an item without a spec');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{compound_lots}',
  '["L1","L2","L3","L4","L5","L6","L7","L8","L9","L10","L11"]'::jsonb)) $$, 'QC_INVALID_LOT', 'more than ten lots is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{compound_lots}', '["L1",""]'::jsonb)) $$,
  'QC_INVALID_LOT', 'an empty lot is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{compound_lots}', to_jsonb(array[repeat('x', 61)]))) $$,
  'QC_INVALID_LOT', 'a lot longer than sixty characters is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{compound_lots}', '["L1","L1"]'::jsonb)) $$,
  'QC_INVALID_LOT', 'a repeated lot is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{compound_lots}', '"L1"'::jsonb)) $$,
  'QC_INVALID_LOT', 'lots must be an array');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","points":[1,2,3,4,5,6]}]'::jsonb)) $$, 'QC_INVALID_ITEM', 'more than five points is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","points":[]}]'::jsonb)) $$, 'QC_INVALID_ITEM', 'an item needs at least one point');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","points":["1"]}]'::jsonb)) $$, 'QC_INVALID_ITEM', 'a point given as text is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{items}',
  '[{"item_no":"A","name":"a","points":[1]},{"item_no":"A","name":"b","points":[2]}]'::jsonb)) $$, 'QC_INVALID_ITEM', 'duplicate item numbers are rejected');
select throws_ok($$ select public.app_qc_save_report(current_setting('test.base')::jsonb - 'items') $$, 'QC_INVALID_PAYLOAD', 'the items array is required');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{part_number}', to_jsonb(repeat('x', 61)))) $$, 'QC_INVALID_PAYLOAD', 'a part number longer than 60 characters is rejected (empty is allowed since 20261028010000)');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{template_id}', to_jsonb(gen_random_uuid()::text))) $$,
  'QC_TEMPLATE_NOT_FOUND', 'an unknown template is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.base')::jsonb, '{inspected_at}', '"not a date"'::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'an unreadable date is rejected');

-- แก้ฉบับร่าง
select throws_ok($$ select public.app_qc_save_report(jsonb_set(jsonb_set(current_setting('test.base')::jsonb, '{id}', to_jsonb(current_setting('test.r1'))), '{version}', '7'::jsonb)) $$,
  'QC_VERSION_CONFLICT', 'a stale report version cannot overwrite');
select set_config('test.j', public.app_qc_save_report(jsonb_set(jsonb_set(jsonb_set(current_setting('test.base')::jsonb,
  '{id}', to_jsonb(current_setting('test.r1'))), '{version}', '1'::jsonb), '{remark}', '"ตรวจรอบแรก (แก้ไข)"'::jsonb))::text, true);
select is(current_setting('test.j')::jsonb ->> 'version', '2', 'editing a draft bumps the version');
select is(current_setting('test.j')::jsonb ->> 'remark', 'ตรวจรอบแรก (แก้ไข)', 'the edit is saved');
select is(current_setting('test.j')::jsonb ->> 'report_no', current_setting('test.rno'), 'the report number is stable across edits');
select is(jsonb_array_length(current_setting('test.j')::jsonb -> 'items'), 4, 'the items are replaced as a whole, not duplicated');

-- รายการและตัวกรอง
select is(jsonb_array_length(public.app_qc_reports() -> 'reports'), 1, 'the draft is listed');
select is(jsonb_array_length(public.app_qc_reports('{"lot":"E00030S-261027-4-02"}') -> 'reports'), 1, 'the list filters by a lot of the report');
select is(jsonb_array_length(public.app_qc_reports('{"lot":"NO-SUCH-LOT"}') -> 'reports'), 0, 'an unknown lot finds nothing');
select is(jsonb_array_length(public.app_qc_reports('{"part_number":"l-samp"}') -> 'reports'), 1, 'the part number filter ignores case and matches a fragment');
select is(jsonb_array_length(public.app_qc_reports('{"result":"ng","status":"draft"}') -> 'reports'), 1, 'the result and status filters combine');
select is(jsonb_array_length(public.app_qc_reports('{"status":"approved"}') -> 'reports'), 0, 'the status filter excludes other statuses');
select throws_ok($$ select public.app_qc_reports('{"status":"bogus"}') $$, 'QC_INVALID_PAYLOAD', 'an unknown status filter is rejected');
select throws_ok($$ select public.app_qc_report(gen_random_uuid()) $$, 'QC_NOT_FOUND', 'an unknown report is rejected');

-- 7. ส่งใบ -------------------------------------------------------------------------
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 2, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'QC_NOT_SUBMITTED', 'a draft cannot issue an NCR before it is submitted');
select throws_ok($$ select public.app_qc_submit_report(current_setting('test.r1')::uuid, 1) $$, 'QC_VERSION_CONFLICT', 'submit needs the current version');
select set_config('test.j', public.app_qc_submit_report(current_setting('test.r1')::uuid, 2)::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'pending_qa_manager', 'submitting moves the report to the QA manager');
select is(current_setting('test.j')::jsonb ->> 'current_step', '1', 'the waiting step is one');
select is(current_setting('test.j')::jsonb ->> 'version', '3', 'submitting bumps the version');
select is(jsonb_array_length(current_setting('test.j')::jsonb -> 'approvals'), 3, 'three signature slots are created');
select is((select count(*) from jsonb_array_elements(current_setting('test.j')::jsonb -> 'approvals') x where x ->> 'status' = 'pending'), 3::bigint, 'all slots are pending');
select is(current_setting('test.j')::jsonb ->> 'inspected_by', current_setting('test.p_sbx_qa_staff'), 'the inspector is the submitter');
select ok(current_setting('test.j')::jsonb ->> 'submitted_at' is not null and current_setting('test.j')::jsonb ->> 'inspected_at' is not null, 'submit time and inspection time are set');
select throws_ok($$ select public.app_qc_submit_report(current_setting('test.r1')::uuid, 3) $$, 'QC_NOT_DRAFT', 'a report cannot be submitted twice');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(jsonb_set(current_setting('test.base')::jsonb, '{id}', to_jsonb(current_setting('test.r1'))), '{version}', '3'::jsonb)) $$,
  'QC_NOT_DRAFT', 'a submitted report cannot be edited');
select throws_ok($$ select public.app_qc_cancel_report(current_setting('test.r1')::uuid, 3, 'ยกเลิกทดสอบ') $$, 'QC_NOT_CANCELLABLE', 'a pending report cannot be cancelled');
select throws_ok($$ select public.app_qc_reopen_report(current_setting('test.r1')::uuid, 3) $$, 'QC_NOT_REJECTED', 'only a rejected report can be reopened');
select throws_ok($$ select public.app_qc_submit_report(gen_random_uuid(), 1) $$, 'QC_NOT_FOUND', 'submitting an unknown report is rejected');

-- 8. อนุมัติ 3 ขั้น ------------------------------------------------------------------
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 3, 'maybe') $$, 'QC_INVALID_DECISION', 'an unknown decision is rejected');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 3, 'approve') $$, 'NOT_AUTHORIZED', 'QA staff cannot sign the QA manager step');

select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select is(public.app_qc_access(), '{"read":true,"edit":false,"steps":["general_manager"]}'::jsonb, 'the general manager reads and signs only the last step');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 3, 'approve') $$, 'NOT_AUTHORIZED', 'the general manager cannot sign before the step is theirs');
select throws_ok($$ select public.app_qc_save_report(current_setting('test.base')::jsonb) $$, 'NOT_AUTHORIZED', 'the general manager cannot create reports');

select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select is(public.app_qc_access(), '{"read":true,"edit":true,"steps":["qa_manager"]}'::jsonb, 'the QA manager signs the first step');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 2, 'approve') $$, 'QC_VERSION_CONFLICT', 'a stale version cannot sign');
select set_config('test.j', public.app_qc_decide_report(current_setting('test.r1')::uuid, 3, 'approve', 'ผ่านขั้น QA')::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'pending_factory_manager', 'the QA manager approval moves the report to the factory manager');
select is(current_setting('test.j')::jsonb ->> 'current_step', '2', 'the waiting step is two');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 4, 'approve') $$, 'NOT_AUTHORIZED', 'the QA manager cannot sign the factory manager step');

select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select is(public.app_qc_access(), '{"read":true,"edit":false,"steps":["factory_manager"]}'::jsonb, 'the factory manager signs the second step');
select set_config('test.j', public.app_qc_decide_report(current_setting('test.r1')::uuid, 4, 'approve')::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'pending_general_manager', 'the factory manager approval moves the report to the general manager');

select public.app_sandbox_enter(current_setting('test.p_sbx_mgt_gm')::uuid);
select set_config('test.j', public.app_qc_decide_report(current_setting('test.r1')::uuid, 5, 'approve', 'อนุมัติ')::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'approved', 'the general manager approval completes the report');
select is(current_setting('test.j')::jsonb ->> 'version', '6', 'each step bumped the version');
select ok(current_setting('test.j')::jsonb ->> 'completed_at' is not null, 'the completion time is set');
select is((select count(*) from jsonb_array_elements(current_setting('test.j')::jsonb -> 'approvals') x where x ->> 'status' = 'approved' and x ->> 'acted_by' is not null), 3::bigint,
  'all three slots are signed');
select is((select x ->> 'comment' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'approvals') x where x ->> 'step_code' = 'general_manager'), 'อนุมัติ', 'the sign-off comment is kept');
select is(jsonb_array_length(current_setting('test.j')::jsonb -> 'history'), 6, 'history has create, update, submit and three approvals');
select is((select count(*) from jsonb_array_elements(current_setting('test.j')::jsonb -> 'history') x where x ->> 'action' in ('submit', 'approve')), 4::bigint,
  'the submit and the three approvals are recorded');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r1')::uuid, 6, 'approve') $$, 'QC_STEP_NOT_CURRENT', 'a finished report cannot be signed again');

-- 9. ออก NCR จากใบ ng ---------------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 6, 'DIM', 100, 5, 'ชิ้น', 'สั้น') $$, 'INVALID_NCR_DESCRIPTION', 'the NCR description needs ten characters');
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 6, 'NOPE', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'INVALID_DEFECT_TYPE', 'the NCR defect type is validated by the NCR system');
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 6, 'DIM', 100, 500, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'INVALID_QUANTITY', 'the NCR quantities are validated by the NCR system');
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 5, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'QC_VERSION_CONFLICT', 'issuing an NCR needs the current version');
select set_config('test.j', public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 6, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ')::text, true);
select ok(current_setting('test.j')::jsonb ->> 'ncr_id' is not null, 'the report keeps the NCR id');
select matches(current_setting('test.j')::jsonb ->> 'ncr_no', '^TEST-QA\d{3}/\d{2}$', 'the NCR number is a test-mode NCR number');
select is(current_setting('test.j')::jsonb ->> 'version', '7', 'issuing the NCR bumps the version');
select is((select x ->> 'action' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'history') x order by (x ->> 'id')::bigint desc limit 1), 'ncr', 'the NCR is recorded in the history');
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 7, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'QC_NCR_EXISTS', 'a report issues only one NCR');

-- 10. ห้ามอนุมัติใบตัวเอง / ใบ ok ออก NCR ไม่ได้ ---------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select set_config('test.j', public.app_qc_save_report(current_setting('test.ok_report')::jsonb)::text, true);
select set_config('test.r2', current_setting('test.j')::jsonb ->> 'id', true);
select is(current_setting('test.j')::jsonb ->> 'result', 'ok', 'a report whose items all pass is ok');
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r2')::uuid, 1, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'QC_NOT_NG', 'only an ng report can issue an NCR');
select set_config('test.j', public.app_qc_submit_report(current_setting('test.r2')::uuid, 1)::text, true);
select is(current_setting('test.j')::jsonb ->> 'inspected_by', current_setting('test.p_sbx_qa_mgr'), 'the QA manager is the inspector of this report');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r2')::uuid, 2, 'approve') $$, 'QC_SELF_APPROVAL', 'the inspector cannot approve their own report');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r2')::uuid, 2, 'reject', 'ไม่ผ่านทดสอบ') $$, 'QC_SELF_APPROVAL', 'the inspector cannot reject their own report either');

-- 11. ไม่อนุมัติ → เปิดกลับ → ยกเลิก --------------------------------------------------------
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.j', public.app_qc_save_report(current_setting('test.ok_report')::jsonb)::text, true);
select set_config('test.r3', current_setting('test.j')::jsonb ->> 'id', true);
select public.app_qc_submit_report(current_setting('test.r3')::uuid, 1);
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_mgr')::uuid);
select public.app_qc_decide_report(current_setting('test.r3')::uuid, 2, 'approve');
select public.app_sandbox_enter(current_setting('test.p_sbx_ft_fm')::uuid);
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r3')::uuid, 3, 'reject') $$, 'QC_REJECT_COMMENT_REQUIRED', 'rejecting needs a reason');
select throws_ok($$ select public.app_qc_decide_report(current_setting('test.r3')::uuid, 3, 'reject', 'abc') $$, 'QC_REJECT_COMMENT_REQUIRED', 'the reason needs five characters');
select set_config('test.j', public.app_qc_decide_report(current_setting('test.r3')::uuid, 3, 'reject', 'ขนาดไม่ตรงแบบ')::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'rejected', 'the factory manager can reject');
select is(current_setting('test.j')::jsonb ->> 'version', '4', 'rejecting bumps the version');
select ok(current_setting('test.j')::jsonb ->> 'completed_at' is not null, 'a rejected report has a completion time');
select is((select x ->> 'status' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'approvals') x where x ->> 'step_code' = 'factory_manager'), 'rejected', 'the rejecting slot is marked rejected');
select is((select x ->> 'status' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'approvals') x where x ->> 'step_code' = 'general_manager'), 'pending', 'the later slot stays pending');

select throws_ok($$ select public.app_qc_reopen_report(current_setting('test.r3')::uuid, 4) $$, 'NOT_AUTHORIZED', 'the factory manager cannot reopen a report');
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);
select set_config('test.j', public.app_qc_reopen_report(current_setting('test.r3')::uuid, 4)::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'draft', 'reopening returns the report to a draft');
select is(current_setting('test.j')::jsonb -> 'approvals', '[]'::jsonb, 'reopening clears the signature slots');
select is(current_setting('test.j')::jsonb ->> 'current_step', '0', 'reopening resets the step');
select ok(current_setting('test.j')::jsonb ->> 'completed_at' is null and current_setting('test.j')::jsonb ->> 'submitted_at' is null, 'reopening clears the dates');
select throws_ok($$ select public.app_qc_reopen_report(current_setting('test.r3')::uuid, 5) $$, 'QC_NOT_REJECTED', 'a draft cannot be reopened');
select throws_ok($$ select public.app_qc_cancel_report(current_setting('test.r3')::uuid, 5, '') $$, 'QC_CANCEL_NOTE_REQUIRED', 'cancelling needs a reason');
select set_config('test.j', public.app_qc_cancel_report(current_setting('test.r3')::uuid, 5, 'ยกเลิกใบทดสอบ')::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'cancelled', 'a draft can be cancelled');
select throws_ok($$ select public.app_qc_cancel_report(current_setting('test.r3')::uuid, 6, 'ยกเลิกซ้ำทดสอบ') $$, 'QC_NOT_CANCELLABLE', 'a cancelled report cannot be cancelled again');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(jsonb_set(current_setting('test.ok_report')::jsonb, '{id}', to_jsonb(current_setting('test.r3'))), '{version}', '6'::jsonb)) $$,
  'QC_NOT_DRAFT', 'a cancelled report cannot be edited');

-- 12. ยอมรับ (AC) ------------------------------------------------------------------------
select set_config('test.j', public.app_qc_save_report(jsonb_set(current_setting('test.ok_report')::jsonb, '{items}',
  '[{"item_no":"A","name":"ขนาด กว้าง","spec_min":12,"spec_max":14,"points":[12.5,13]},
    {"item_no":"B","name":"ขนาด สูง","spec_min":8,"spec_max":9,"points":[9.5],"judge_override":"AC","note":"ยอมรับพิเศษ ลูกค้าอนุมัติ"}]'::jsonb))::text, true);
select is(current_setting('test.j')::jsonb ->> 'result', 'accept', 'an accepted item without any N makes the report accept');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'B'), 'AC', 'the accepted item is AC');
select is((select x ->> 'judge' from jsonb_array_elements(current_setting('test.j')::jsonb -> 'items') x where x ->> 'item_no' = 'A'), 'O', 'the passing item stays O');
select throws_ok($$ select public.app_qc_issue_ncr((current_setting('test.j')::jsonb ->> 'id')::uuid, 1, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$, 'QC_NOT_NG', 'an accepted report cannot issue an NCR');

-- 13. Lot ยางผสมกับผล Mooney ----------------------------------------------------------------
reset role;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select is((public.app_lab_mooney_import($json$[
  {"source_sheet":"E00030S T","sample_id":"1","material":"E00030S","test_date":"2026-10-27","test_time":"8:10:00","temperature_c":145,"test_minutes":5,"mh":51,"mv":30,"avg_mh":52,"sd_mh":1,"avg_mv":31,"sd_mv":1,"lot_number":"E00030S-261027-4-01"},
  {"source_sheet":"E00030S T","sample_id":"2","material":"E00030S","test_date":"2026-10-27","test_time":"8:20:00","temperature_c":145,"test_minutes":5,"mh":53,"mv":32,"avg_mh":54,"sd_mh":1,"avg_mv":33,"sd_mv":1,"lot_number":" E00030S-261027-4-01 "},
  {"source_sheet":"E00030S T","sample_id":"3","material":"E00030S","test_date":"2026-10-27","test_time":"8:30:00","temperature_c":145,"test_minutes":5,"mh":40,"mv":20,"lot_number":"   "},
  {"source_sheet":"E00030S T","sample_id":"4","material":"E00030S","test_date":"2026-10-27","test_time":"8:40:00","temperature_c":145,"test_minutes":5,"mh":41,"mv":21}
]$json$::jsonb) ->> 'inserted')::integer, 4, 'the import accepts rows with and without a lot');
select throws_ok($$ select public.app_lab_mooney_import(jsonb_build_array(jsonb_build_object('source_sheet', 'X', 'sample_id', '9', 'material', 'X',
  'test_date', '2026-10-27', 'test_time', '9:00:00', 'temperature_c', 100, 'test_minutes', 4, 'mh', 1, 'mv', 1, 'lot_number', repeat('x', 61)))) $$,
  'LAB_INVALID_ROW', 'a lot longer than sixty characters is rejected by the import');
reset role;
select is((select count(*) from public.lab_mooney_results where lot_number = 'E00030S-261027-4-01'), 2::bigint, 'the lot (trimmed) is stored on both rows');
select is((select count(*) from public.lab_mooney_results where lot_number is null and source_sheet = 'E00030S T'), 2::bigint, 'a blank or missing lot is stored as null');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(jsonb_array_length(public.app_qc_lots('E00030S-261027')), 1, 'the lot list groups the Mooney rows by lot');
select is(public.app_qc_lots('e00030s-261027') -> 0 ->> 'tests', '2', 'the lot has two tests');
select is(public.app_qc_lots('E00030S-261027') -> 0 ->> 'material', 'E00030S', 'the lot shows its material');
select is((public.app_qc_lots('E00030S-261027') -> 0 ->> 'avg_mh')::numeric, 53::numeric, 'the lot average MH is the mean of the sheet averages');
select is((public.app_qc_lots('E00030S-261027') -> 0 ->> 'avg_mv')::numeric, 32::numeric, 'the lot average MV is the mean of the sheet averages');
select is(public.app_qc_lots('E00030S-261027') -> 0 ->> 'latest_test_date', '2026-10-27', 'the lot shows its latest test date');
select is(public.app_qc_lots('NO-SUCH-LOT'), '[]'::jsonb, 'an unknown lot search finds nothing');
select throws_ok($$ select public.app_qc_lots(repeat('x', 61)) $$, 'QC_INVALID_PAYLOAD', 'a search longer than sixty characters is rejected');

select set_config('test.j', public.app_qc_report(current_setting('test.r1')::uuid)::text, true);
select is(jsonb_array_length(current_setting('test.j')::jsonb -> 'lab'), 2, 'the report lists the Mooney summary of each lot');
select is(current_setting('test.j')::jsonb -> 'lab' -> 0 ->> 'found', 'true', 'the first lot is found in the Mooney results');
select is(current_setting('test.j')::jsonb -> 'lab' -> 0 ->> 'tests', '2', 'the first lot has two tests');
select is((current_setting('test.j')::jsonb -> 'lab' -> 0 ->> 'avg_mh')::numeric, 53::numeric, 'the first lot average MH');
select is(current_setting('test.j')::jsonb -> 'lab' -> 1 ->> 'found', 'false', 'the second lot has no Mooney result yet');
select is(current_setting('test.j')::jsonb -> 'lab' -> 1 ->> 'tests', '0', 'the second lot has zero tests');

-- 14. ล้างข้อมูลทดสอบ -------------------------------------------------------------------------
reset role;
select ok((select count(*) from public.qc_inspection_reports where is_test) = 4, 'the four test reports exist before the purge');
select ok(not exists (select 1 from public.qc_inspection_reports where not is_test)
      and not exists (select 1 from public.qc_inspection_items where not is_test)
      and not exists (select 1 from public.qc_inspection_history where not is_test)
      and not exists (select 1 from public.qc_inspection_templates where not is_test and part_number <> 'REAL-PART-01')
      and exists (select 1 from public.qc_inspection_templates where is_test and part_number = 'L-SAMPLE'),
  'everything written through the RPCs is flagged as test data');
select ok(exists (select 1 from public.document_counters where department_code = 'QC-TEST')
      and not exists (select 1 from public.document_counters where department_code = 'QC'),
  'only the test counter moved, never the real one');
select ok(exists (select 1 from public.audit_logs where action = 'QC_REPORT_SUBMIT' and actor_id = '8f000000-0000-0000-0000-000000000101')
      and (select count(*) from public.audit_logs where action = 'QC_REPORT_APPROVE') >= 4
      and exists (select 1 from public.audit_logs where action = 'QC_TEMPLATE_SAVE')
      and exists (select 1 from public.audit_logs where action = 'QC_REPORT_NCR')
      and exists (select 1 from public.audit_logs where action = 'QC_REPORT_REJECT'),
  'actions are audited with the real admin behind the persona as the actor');
select ok((select count(*) from public.ncr_reports where is_test and product_code = 'L-SAMPLE' and source = 'final_fg'
           and lot_no like '%E00030S-261027-4-01%' and lot_no like '%E00030S-261027-4-02%' and po_no = 'PO-001') = 1,
  'the NCR is a test NCR carrying the part, source, PO and both lots');
select ok((select ncr_id from public.qc_inspection_reports where id = current_setting('test.r1')::uuid)
          = (select id from public.ncr_reports where ncr_no = (select ncr_no from public.qc_inspection_reports where id = current_setting('test.r1')::uuid)),
  'the report points at the NCR it issued');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok('select public.app_sandbox_purge_qc()', 'NOT_AUTHORIZED', 'a non-admin cannot purge');
select set_config('request.jwt.claims', '{"sub":"8f000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.app_sandbox_purge_qc() ->> 'deleted_reports')::integer, 4, 'the admin purges the four test reports');
reset role;
select is((select count(*) from public.qc_inspection_reports where is_test)
        + (select count(*) from public.qc_inspection_items where is_test)
        + (select count(*) from public.qc_inspection_approvals where is_test)
        + (select count(*) from public.qc_inspection_history where is_test)
        + (select count(*) from public.qc_inspection_templates where is_test)
        + (select count(*) from public.qc_inspection_template_items where is_test),
  0::bigint, 'no test row is left in any QC table');
select is((select count(*) from public.document_counters where department_code = 'QC-TEST'), 0::bigint, 'the test counter is reset');
select is((select count(*) from public.qc_inspection_templates where part_number = 'REAL-PART-01' and not is_test), 1::bigint, 'the real template is untouched');
select ok((select count(*) from public.ncr_reports where is_test) >= 1, 'the test NCR is left to the NCR purge');
select is((select count(*) from public.audit_logs where action = 'SANDBOX_PURGE_QC'), 1::bigint, 'the purge is audited');

select * from finish();
rollback;
