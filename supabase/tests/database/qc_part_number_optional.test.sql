-- ใบตรวจ QC QA01-PM11 (20261028010000_qc_part_number_optional.sql): Part Number ไม่บังคับ
-- แม่แบบ/ใบที่ไม่มีเลข Part บันทึกได้ แม่แบบไม่มีเลข Part มีหลายแบบได้ เลข Part ที่มีค่ายังซ้ำไม่ได้ ยาวเกิน 60 ยังถูกปฏิเสธ
-- ใบที่ไม่มีเลข Part ส่งและออก NCR ได้ (NCR product_code เป็น null) และสิทธิ์ของ RPC ยังเหมือนเดิม
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- 1. โครงสร้าง ---------------------------------------------------------------------------
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'qc_inspection_templates'
                  and indexname = 'qc_inspection_templates_part_number_uidx'
                  and indexdef like 'CREATE UNIQUE INDEX%(is_test, part_number)%' and indexdef like '%part_number <> %'),
  'the template part number key is a partial unique index over non-empty numbers');
select ok(not exists (select 1 from pg_constraint c
                      where c.conrelid = 'public.qc_inspection_templates'::regclass and c.contype = 'u'
                        and pg_get_constraintdef(c.oid) = 'UNIQUE (is_test, part_number)'),
  'the old unique (is_test, part_number) constraint is gone');
select ok(not exists (
    select 1 from unnest(array[
      'public.app_qc_templates()', 'public.app_qc_save_template(jsonb)', 'public.app_qc_save_report(jsonb)',
      'public.app_qc_issue_ncr(uuid,integer,text,numeric,numeric,text,text)']) f(sig)
    where has_function_privilege('anon', f.sig, 'execute') or not has_function_privilege('authenticated', f.sig, 'execute')),
  'the replaced RPCs stay closed to anon and open to signed-in users');
select is((select count(*)::integer from private.lab_only_unguarded_functions()), 0,
  'every callable public function still has the lab-only guard');

-- 2. บัญชีทดสอบ ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('8f100000-0000-0000-0000-000000000001', 'qc-pn-admin@test.local', '{}');
insert into public.employees (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, auth_user_id) values
  ('8f100000-0000-0000-0000-000000000101', 'QCPN-ADMIN', 'Qc', 'Admin', 'qc-pn-admin@test.local', 'System Administrator',
   (select id from public.departments where code = 'MGT'), (select id from public.roles where code = 'admin'), '8f100000-0000-0000-0000-000000000001');
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- ระดับตาราง (ผู้ดูแลระบบฐานข้อมูล): ว่างซ้ำได้ ค่าที่มีซ้ำไม่ได้
insert into public.qc_inspection_templates (part_number, part_name) values ('', 'ตารางตรง ก'), ('', 'ตารางตรง ข'), ('REAL-DUP-01', 'ตัวแรก');
select is((select count(*) from public.qc_inspection_templates where part_number = '' and not is_test), 2::bigint,
  'two templates without a part number coexist at the table level');
select throws_ok($$ insert into public.qc_inspection_templates (part_number, part_name) values ('REAL-DUP-01', 'ตัวที่สอง') $$,
  '23505', null, 'a non-empty part number is still unique at the table level');
select throws_ok($$ insert into public.qc_inspection_templates (part_number, part_name) values (repeat('x', 61), 'ยาวเกิน') $$,
  '23514', null, 'a part number over sixty characters is rejected at the table level');
select throws_ok($$ insert into public.qc_inspection_reports (report_no, part_number, part_name) values ('PN-LONG', repeat('x', 61), 'ยาวเกิน') $$,
  '23514', null, 'a report part number over sixty characters is rejected at the table level');

select set_config('test.tpl_items', $json$[
  {"item_no":"A","name":"ขนาด กว้าง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":12,"spec_std":13,"spec_max":14},
  {"item_no":"B","name":"ขนาด สูง","instrument":"เวอร์เนียร์ (mm.)","unit":"mm","spec_min":8.5,"spec_std":9,"spec_max":9.5}
]$json$, true);
-- ชิ้นงานเดี่ยวไม่มีเลข Part: ผลเป็น ng (A เกินสเปค)
select set_config('test.nopn_report', $json$
{"part_name":"ชิ้นงานเดี่ยวไม่มีเลข","customer":"ลูกค้าทดสอบ","order_no":"PO-PN-1","compound_lots":["PNLOT-01"],"items":[
  {"item_no":"A","name":"ขนาด กว้าง","spec_min":12,"spec_max":14,"points":[15,16,15.5]},
  {"item_no":"B","name":"ขนาด สูง","spec_min":8.5,"spec_max":9.5,"points":[9,9.1]}]}
$json$, true);

-- 3. แม่แบบ ---------------------------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"8f100000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select public.app_sandbox_enter(current_setting('test.p_sbx_qa_staff')::uuid);

select set_config('test.t1', public.app_qc_save_template(jsonb_build_object(
  'part_name', 'ชิ้นงานเดี่ยว ข', 'items', current_setting('test.tpl_items')::jsonb))::text, true);
select is(current_setting('test.t1')::jsonb ->> 'part_number', '', 'a template saves without a part number (key omitted)');
select is(current_setting('test.t1')::jsonb ->> 'version', '1', 'the template without a part number starts at version 1');
select set_config('test.t2', public.app_qc_save_template(jsonb_build_object(
  'part_number', '   ', 'part_name', 'ชิ้นงานเดี่ยว ก', 'items', current_setting('test.tpl_items')::jsonb))::text, true);
select is(current_setting('test.t2')::jsonb ->> 'part_number', '', 'a blank part number is stored as empty');
select ok(current_setting('test.t1')::jsonb ->> 'id' <> current_setting('test.t2')::jsonb ->> 'id',
  'two templates without a part number coexist');
select set_config('test.t3', public.app_qc_save_template(jsonb_build_object(
  'part_number', 'N-1', 'part_name', 'ชิ้นงานมีเลข', 'items', current_setting('test.tpl_items')::jsonb))::text, true);
select is(jsonb_array_length(public.app_qc_templates()), 3, 'all three templates are listed');
select is((select string_agg(x ->> 'part_name', ' | ' order by o) from jsonb_array_elements(public.app_qc_templates()) with ordinality t(x, o)),
  'ชิ้นงานมีเลข | ชิ้นงานเดี่ยว ก | ชิ้นงานเดี่ยว ข',
  'numbered templates come first, then the ones without a number by name');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'N-1', 'part_name', 'ซ้ำ', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_PART_NUMBER_TAKEN', 'a non-empty part number is still unique within the mode');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('id', current_setting('test.t1')::jsonb ->> 'id', 'version', 1,
  'part_number', 'N-1', 'part_name', 'ชิ้นงานเดี่ยว ข', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_PART_NUMBER_TAKEN', 'giving a template a number that is taken is rejected on edit');
select is((public.app_qc_save_template(jsonb_build_object('id', current_setting('test.t1')::jsonb ->> 'id', 'version', 1,
  'part_name', 'ชิ้นงานเดี่ยว ข (แก้ไข)', 'items', current_setting('test.tpl_items')::jsonb)) ->> 'version')::integer, 2,
  'a template without a part number can be edited and stays without one');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', repeat('x', 61), 'part_name', 'x', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'a template part number over sixty characters is rejected');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'part_name', '', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'the part name is still required');
select throws_ok($$ select public.app_qc_save_template(jsonb_build_object('part_number', 'E-1', 'items', current_setting('test.tpl_items')::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'a template without a part name is rejected');

-- 4. ใบตรวจที่ไม่มีเลข Part ------------------------------------------------------------------
select set_config('test.j', public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{template_id}',
  to_jsonb(current_setting('test.t1')::jsonb ->> 'id')))::text, true);
select set_config('test.r1', current_setting('test.j')::jsonb ->> 'id', true);
select is(current_setting('test.j')::jsonb ->> 'part_number', '', 'a report saves without a part number');
select is(current_setting('test.j')::jsonb ->> 'part_name', 'ชิ้นงานเดี่ยวไม่มีเลข', 'the part name is kept');
select is(current_setting('test.j')::jsonb ->> 'result', 'ng', 'the result is still computed from the spec');
select is(public.app_qc_report(current_setting('test.r1')::uuid) ->> 'part_number', '', 'the report reads back without a part number');
select is(jsonb_array_length(public.app_qc_reports('{}') -> 'reports'), 1, 'the report is listed');
select is(public.app_qc_reports('{}') -> 'reports' -> 0 ->> 'part_number', '', 'the list shows an empty part number');
select is(jsonb_array_length(public.app_qc_reports('{"part_number":"N-"}') -> 'reports'), 0, 'a part number filter does not match a report without one');
select is((public.app_qc_save_report(jsonb_set(jsonb_set(current_setting('test.nopn_report')::jsonb, '{id}', to_jsonb(current_setting('test.r1'))),
  '{version}', '1'::jsonb)) ->> 'version')::integer, 2, 'a draft without a part number can be edited');
select is(public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{part_number}', 'null'::jsonb)) ->> 'part_number', '',
  'a null part number is stored as empty');
select is(public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{part_number}', to_jsonb(repeat('x', 60)))) ->> 'part_number', repeat('x', 60),
  'a sixty character part number is accepted');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{part_number}', to_jsonb(repeat('x', 61)))) $$,
  'QC_INVALID_PAYLOAD', 'a report part number over sixty characters is rejected');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{part_name}', '""'::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'a report still needs a part name');
select throws_ok($$ select public.app_qc_save_report(jsonb_set(current_setting('test.nopn_report')::jsonb, '{part_number}', '5'::jsonb)) $$,
  'QC_INVALID_PAYLOAD', 'a part number that is not text is rejected');

-- 5. ส่งใบและออก NCR -------------------------------------------------------------------------
select throws_ok($$ select public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 2, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ') $$,
  'QC_NOT_SUBMITTED', 'a draft without a part number cannot issue an NCR yet');
select set_config('test.j', public.app_qc_submit_report(current_setting('test.r1')::uuid, 2)::text, true);
select is(current_setting('test.j')::jsonb ->> 'status', 'pending_qa_manager', 'a report without a part number can be submitted');
select set_config('test.j', public.app_qc_issue_ncr(current_setting('test.r1')::uuid, 3, 'DIM', 100, 5, 'ชิ้น', 'ขนาดไม่ได้สเปคตามใบตรวจ')::text, true);
select ok(current_setting('test.j')::jsonb ->> 'ncr_id' is not null, 'an NCR is issued from a report without a part number');
select matches(current_setting('test.j')::jsonb ->> 'ncr_no', '^TEST-QA\d{3}/\d{2}$', 'the NCR number is a test-mode NCR number');

-- 6. ผล NCR ที่ฐานข้อมูล -----------------------------------------------------------------------
reset role;
select is((select count(*) from public.ncr_reports where is_test and ncr_no = current_setting('test.j')::jsonb ->> 'ncr_no'
           and product_code is null and product_name = 'ชิ้นงานเดี่ยวไม่มีเลข' and po_no = 'PO-PN-1' and lot_no = 'PNLOT-01'),
  1::bigint, 'the NCR has no product code and still carries the part name, PO and lot');
select is((select count(*) from public.qc_inspection_templates where is_test and part_number = ''), 2::bigint,
  'the two test templates without a part number are stored with an empty number');

select * from finish();
rollback;
