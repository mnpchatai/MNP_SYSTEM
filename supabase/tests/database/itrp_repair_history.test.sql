-- ทดสอบประวัติการซ่อมเครื่องคอมพิวเตอร์ IT01-FM02 (20261218010000_itrp_repair_history.sql) — ส่วนเสริมของโมดูลใบแจ้งซ่อม
--   1) โครงสร้าง: 5 ตารางใหม่ RLS/ไม่มี grant/trigger/ลงทะเบียนโหมดทดสอบ, RPC ใหม่ anon เรียกไม่ได้, app_itrp_complete เหลือฟังก์ชันเดียว (10 พารามิเตอร์) และเรียกแบบเดิมได้
--   2) ส่งงาน: ไม่ส่ง p_devices (หน้าเว็บรุ่นเก่า) ยังผ่าน, ส่งหลายเครื่อง (ตัดช่องว่าง/ตัวพิมพ์ใหญ่/ข้ามแถวว่าง), ตรวจทุกช่อง, สิทธิ์, ขอแก้ไขแล้วส่งใหม่ใช้รอบล่าสุด
--   3) ทะเบียนเครื่อง: เพิ่ม/แก้/ไม่เปลี่ยนค่า, log โดย trigger, สิทธิ์อ่าน/เขียน, ค้นหา, รหัสที่มีแต่ในประวัติ, รหัสแก้ไม่ได้ ลบไม่ได้
--   4) ประวัติรายเครื่อง: รวม 3 แหล่ง (ใบในระบบรอบล่าสุด, import, manual) เรียงตามวันที่, ใบที่ยกเลิก/ยังไม่ส่งงานไม่ขึ้น, ตกไปใช้ asset_code เมื่อไม่มีแถวเครื่อง
--   5) ลงประวัติย้อนหลัง: เพิ่ม/แก้ (เก็บฉบับเดิมลง revisions)/ยกเลิก (เหตุผลบังคับ), กติกาข้อมูล, ISO (ลบ/แก้ย้อนหลังไม่ได้)
--   6) โหมดทดสอบ: แยกทะเบียน/ประวัติจริงกับทดสอบ, persona แก้ของจริงไม่ได้, ล้างข้อมูลทดสอบไม่แตะของจริง
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITH-*) ในแผนกทดสอบ ZHA ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(315);

-- ตัวช่วย (ชั่วคราว): claims ของผู้ใช้ทดสอบเลขที่ n · ใบที่อนุมัติครบและเริ่มทำแล้ว (ผู้แจ้งคนที่ p_req) · ส่งงานแบบกรอกขั้นต่ำพร้อมเครื่อง
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1d900000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.ready(p_asset text, p_req integer default 1) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims', pg_temp.sub(p_req), true);
  select c.id into v_id from public.app_itrp_create(p_asset, 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'อาการจากใบ', false) c;
  perform set_config('request.jwt.claims', pg_temp.sub(2), true);
  perform public.app_itrp_approve(v_id);
  perform set_config('request.jwt.claims', pg_temp.sub(4), true);
  perform public.app_itrp_approve(v_id);
  perform set_config('request.jwt.claims', pg_temp.sub(3), true);
  perform public.app_itrp_start(v_id);
  return v_id;
end $$;
create function pg_temp.done(p_id uuid, p_devices jsonb) returns uuid language sql as $$
  select public.app_itrp_complete(p_id, 'สายไฟหลวม', 'usage', null, 'internal', null, 'เสียบสายใหม่', null, '[]'::jsonb, p_devices) $$;
create function pg_temp.det(p_id uuid) returns jsonb language sql as $$ select public.app_itrp_get_detail(p_id) $$;
create function pg_temp.hist(p_code text) returns jsonb language sql as $$ select public.app_itrp_device_history(p_code)->'rows' $$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Asia/Bangkok')::date $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and c.relkind = 'r' and c.relrowsecurity), 5, 'RLS is enabled on the five repair history tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no direct grant on the history tables');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and has_table_privilege(r.rolname, c.oid, p.priv)), 'no role has any table privilege on the history tables (checked per privilege)');
select ok(not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname in ('itrp_device_log_id_seq', 'itrp_history_entries_id_seq', 'itrp_history_entry_revisions_id_seq') and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequences of the history tables are closed');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('itrp_device_log_id_seq', 'itrp_history_entries_id_seq', 'itrp_history_entry_revisions_id_seq') and c.relkind = 'S'), 3, 'the three identity sequences exist');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and p.polname like '%\_no\_direct\_access'), 5, 'every history table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and p.polname = 'lab_only_no_access' and not p.polpermissive), 5, 'every history table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions') and t.tgname like '%\_sandbox\_scope' and not t.tgisinternal), 5, 'every history table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itrp_device_log', 'itrp_report_devices', 'itrp_history_entry_revisions') and (t.tgname like '%\_append\_only' or t.tgname like '%\_no\_truncate') and not t.tgisinternal), 6, 'device log, report devices and revisions are append-only (update/delete + truncate triggers)');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itrp_devices', 'itrp_history_entries') and t.tgname like '%\_no\_truncate' and not t.tgisinternal), 2, 'the device registry and the history entries cannot be truncated');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions']) t), 'the five new tables are registered in private.sandbox_unguarded_tables()');
select ok(array['itrp_requests', 'itrp_repair_parts', 'itwo_work_orders', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itrp, itwo, BOM GR and central)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itrp_complete'), 1, 'there is exactly one app_itrp_complete (no ambiguous overload)');
select ok(to_regprocedure('public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb)') is null, 'the old 9-argument signature is gone');
select ok(to_regprocedure('public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb, jsonb)') is not null, 'the new signature has p_devices as the last argument');
select is((select p.pronargdefaults::int from pg_proc p where p.oid = 'public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb, jsonb)'::regprocedure), 2, 'p_parts and p_devices both have defaults');
select ok(has_function_privilege('authenticated', 'public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb, jsonb)', 'execute') and not has_function_privilege('anon', 'public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb, jsonb)', 'execute'), 'app_itrp_complete keeps its ACL (authenticated yes, anon no)');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_list_devices', 'app_itrp_save_device', 'app_itrp_device_history', 'app_itrp_history_add', 'app_itrp_history_update', 'app_itrp_history_void', 'app_itrp_history_get')), 'the seven new RPCs are SECURITY DEFINER with an empty search_path, callable by authenticated and not by anon');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_list_devices', 'app_itrp_save_device', 'app_itrp_device_history', 'app_itrp_history_add', 'app_itrp_history_update', 'app_itrp_history_void', 'app_itrp_history_get')), 7, 'the seven new RPCs exist');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_history_rows', 'itrp_norm_code', 'itrp_code_error', 'itrp_device_values', 'itrp_devices_guard', 'itrp_devices_log', 'itrp_history_entries_guard') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the new private helpers are not callable by anon or authenticated');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_list_devices', 'app_itrp_save_device', 'app_itrp_device_history', 'app_itrp_history_add', 'app_itrp_history_update', 'app_itrp_history_void', 'app_itrp_history_get') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'the new messages say "ใบแจ้งซ่อม", never "ใบสั่งงาน"');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itrp%'), 'every itrp RPC (old and new) has the lab-only guard');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itrp%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.itwo_'), 'no itrp function writes to any itwo table');
select ok(not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('itrp_devices', 'itrp_history_entries') and c.column_name ~* '(pass|licen[sc]e|secret|key|serial)'), 'the registry has no column for passwords, license keys or secrets');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
insert into public.departments (code, name_th, name_en) values ('ZHA', 'แผนกทดสอบ H (มีผู้จัดการ)', 'ZH A');
insert into auth.users (id, email, raw_user_meta_data)
select ('1d900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itrp-h' || n || '@test.local', '{}'::jsonb
from generate_series(1, 8) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itrp-h.test', d.id, r.id, ('1d900000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'ITH-REQ', 'ZHA', 'staff'),
  (2, 'ITH-MGR', 'ZHA', 'department_manager'),
  (3, 'ITH-ADM', 'MGT', 'staff'),
  (4, 'ITH-APPR', 'MGT', 'general_manager'),
  (5, 'ITH-ITS', 'IT', 'staff'),
  (6, 'ITH-REQ2', 'ZHA', 'staff'),
  (7, 'ITH-SBXADMIN', 'MGT', 'admin'),
  (8, 'ITH-OTHER', 'MGT', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- สิทธิ์ทีม IT อยู่ที่ itwo_staff (itrp อ่านอย่างเดียว): ADM = ผู้ดูแลงาน · APPR = ผู้อนุมัติขั้น IT · ITS = พนักงานแผนก IT ที่ไม่ได้อยู่ใน itwo_staff (ไม่มีสิทธิ์ IT)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITH-ADM', true, false), ('ITH-APPR', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-H-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZHA', 'sbx-h-staff@sandbox.local', (select id from public.departments where code = 'ZHA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-H-MGR', 'ทดสอบ', 'ผจก. ZHA', 'sbx-h-mgr@sandbox.local', (select id from public.departments where code = 'ZHA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'ITH-%';
select is((select count(*)::int from public.itrp_devices) + (select count(*)::int from public.itrp_history_entries) + (select count(*)::int from public.itrp_report_devices), 0, 'the history tables are empty before the tests (clean database)');

-- 3. ส่งงาน: เรียกแบบเดิม (ไม่ส่ง p_devices) ต้องยังใช้ได้ ---------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r1', pg_temp.ready('th-com05')::text, true);
select is(pg_temp.det(current_setting('t.r1')::uuid)->>'status', 'in_progress', 'a request is approved and started for the delivery tests');
select lives_ok($$ select public.app_itrp_complete(current_setting('t.r1')::uuid, 'สายไฟหลวม', 'usage', null, 'internal', null, 'เสียบสายใหม่', null, '[]'::jsonb) $$, 'the old 9-argument positional call (no devices) still works');
select is(pg_temp.det(current_setting('t.r1')::uuid)->>'status', 'it_closed', 'the legacy call delivered the request');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r1')::uuid)->'repair_report'->'devices'), 0, 'a delivery without devices has an empty devices list in get_detail');
select is(jsonb_typeof(pg_temp.det(current_setting('t.r1')::uuid)->'repair_report'->'parts'), 'array', 'the existing keys of repair_report are untouched');
select set_config('t.r2', pg_temp.ready('th-com06')::text, true);
select lives_ok($$ select public.app_itrp_complete(p_request_id => current_setting('t.r2')::uuid, p_cause => 'ตก', p_cause_kind => 'usage', p_cause_kind_note => null, p_repair_method => 'internal', p_repair_vendor => null, p_repair_action => 'ซ่อม', p_pr_po_no => null, p_parts => '[]'::jsonb) $$, 'a named-argument call the way an old web client sends it (p_parts, no p_devices) works');
select set_config('t.r2b', pg_temp.ready('th-com06b')::text, true);
select lives_ok($$ select public.app_itrp_complete(p_request_id => current_setting('t.r2b')::uuid, p_cause => 'ตก', p_cause_kind => 'usage', p_cause_kind_note => null, p_repair_method => 'internal', p_repair_vendor => null, p_repair_action => 'ซ่อม', p_pr_po_no => null) $$, 'a named-argument call without p_parts and p_devices works');
select set_config('t.r2c', pg_temp.ready('th-com06c')::text, true);
select lives_ok($$ select public.app_itrp_complete(current_setting('t.r2c')::uuid, 'ตก', 'usage', null, 'internal', null, 'ซ่อม', null, null, null) $$, 'null parts and null devices are treated as empty');

-- 3b. ส่งงานพร้อมเครื่อง ---------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r3', pg_temp.ready('th-com05')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.r3')::uuid, $j$[
  {"device_code": "  th-com05 ", "symptom_note": " จอดับ ", "action_note": "เปลี่ยนสายจอ", "remark": "ควรเปลี่ยนจอใหม่"},
  {"device_code": "", "symptom_note": null},
  {"device_code": "th-prt22"},
  {"device_code": "th-mnt27", "remark": "ใช้งานได้ปกติ"}]$j$::jsonb) $$, 'a delivery with several devices works');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r3')::uuid)->'repair_report'->'devices'), 3, 'the empty row was skipped (three devices stored)');
select is((pg_temp.det(current_setting('t.r3')::uuid)->'repair_report'->'devices'->0)::jsonb, '{"seq": 1, "remark": "ควรเปลี่ยนจอใหม่", "device_code": "TH-COM05", "action_note": "เปลี่ยนสายจอ", "symptom_note": "จอดับ"}'::jsonb, 'the first device is stored trimmed and upper-cased');
select is(pg_temp.det(current_setting('t.r3')::uuid)->'repair_report'->'devices'->1->>'device_code', 'TH-PRT22', 'the second device follows (blank rows do not take a sequence number)');
select is(pg_temp.det(current_setting('t.r3')::uuid)->'repair_report'->'devices'->1->'symptom_note', 'null'::jsonb, 'a device without its own symptom note stores null (the history uses the symptom of the request)');
select is(pg_temp.det(current_setting('t.r3')::uuid)->'repair_report'->'devices'->2->>'seq', '3', 'the sequence runs 1, 2, 3');
select is(pg_temp.det(current_setting('t.r3')::uuid)->'repair_reports'->0->'devices'->2->>'remark', 'ใช้งานได้ปกติ', 'the report history (repair_reports[]) carries the devices of each report too');

-- 3c. ตรวจข้อมูลของเครื่อง (ผิดแล้วใบต้องไม่เปลี่ยนสถานะ) ----------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r4', pg_temp.ready('th-err')::text, true);
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '{"a": 1}'::jsonb) $$, '23514', 'รายการเครื่อง/อุปกรณ์ที่ซ่อมต้องเป็นรายการ', 'devices must be a list');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, (select jsonb_agg(jsonb_build_object('device_code', 'TH-D' || g)) from generate_series(1, 11) g)) $$, '23514', 'เครื่อง/อุปกรณ์ที่ซ่อมต้องไม่เกิน 10 รายการ', 'at most 10 devices');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '["x"]'::jsonb) $$, '23514', 'แถวที่ 1 ของรายการเครื่อง/อุปกรณ์ไม่ถูกต้อง', 'a device row must be an object');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '[{"remark": "x"}]'::jsonb) $$, '23514', 'แถวที่ 1: กรุณาระบุรหัสเครื่อง', 'a row with notes but without a code is refused');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '[{"device_code": "TH-OK"}, {"symptom_note": "x"}]'::jsonb) $$, '23514', 'แถวที่ 2: กรุณาระบุรหัสเครื่อง', 'the error names the row that is wrong');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', repeat('A', 51)))) $$, '23514', 'แถวที่ 1: รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร', 'a code is limited to 50 characters');
select lives_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', repeat('a', 50)))) $$, 'a code of exactly 50 characters is accepted');
select set_config('t.r4', pg_temp.ready('th-err')::text, true);
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '[{"device_code": "A\tB"}]'::jsonb) $$, '23514', 'แถวที่ 1: รหัสเครื่องมีอักขระที่ใช้ไม่ได้', 'a control character inside a code is refused');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, '[{"device_code": "th-a"}, {"device_code": " TH-A "}]'::jsonb) $$, '23514', 'แถวที่ 2: รหัสเครื่อง TH-A ซ้ำกับแถวก่อนหน้า (ใส่รหัสเดียวกันสองครั้งในการส่งงานเดียวกันไม่ได้)', 'the same code twice in one delivery is refused (case and spaces ignored)');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', 'TH-A', 'symptom_note', repeat('ก', 2001)))) $$, '23514', 'แถวที่ 1: อาการของเครื่องต้องไม่เกิน 2,000 ตัวอักษร', 'the device symptom is limited to 2000 characters');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', 'TH-A', 'action_note', repeat('ก', 2001)))) $$, '23514', 'แถวที่ 1: การแก้ไขของเครื่องต้องไม่เกิน 2,000 ตัวอักษร', 'the device action is limited to 2000 characters');
select throws_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', 'TH-A', 'remark', repeat('ก', 501)))) $$, '23514', 'แถวที่ 1: ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร', 'the remark is limited to 500 characters');
select lives_ok($$ select pg_temp.done(current_setting('t.r4')::uuid, jsonb_build_array(jsonb_build_object('device_code', 'TH-A', 'remark', repeat('ก', 500)))) $$, 'a remark of exactly 500 characters is accepted');
select is(pg_temp.det(current_setting('t.r4')::uuid)->>'status', 'it_closed', 'the request was delivered only by the valid call');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r4')::uuid)->'repair_reports'), 1, 'refused calls left no report behind (one report)');
select set_config('t.r5', pg_temp.ready('th-ten')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.r5')::uuid, (select jsonb_agg(jsonb_build_object('device_code', 'th-d' || g)) from generate_series(1, 10) g)) $$, 'ten devices are accepted');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r5')::uuid)->'repair_report'->'devices'), 10, 'all ten devices are stored');
select set_config('t.r6', pg_temp.ready('th-blank')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.r6')::uuid, '[{"device_code": " "}, {}]'::jsonb) $$, 'rows that are blank in every field are skipped without error');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r6')::uuid)->'repair_report'->'devices'), 0, 'nothing was stored for blank rows');

-- 3d. สิทธิ์การส่งงานพร้อมเครื่อง ----------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r7', pg_temp.ready('th-perm')::text, true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.done(current_setting('t.r7')::uuid, '[{"device_code": "TH-X"}]'::jsonb) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'the requester cannot deliver with devices');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select pg_temp.done(current_setting('t.r7')::uuid, '[{"device_code": "TH-X"}]'::jsonb) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'the IT approver (not an IT admin) cannot deliver');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select pg_temp.done(current_setting('t.r7')::uuid, '[{"device_code": "TH-X"}]'::jsonb) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'an employee of the IT department without IT rights cannot deliver');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select public.app_itrp_complete(current_setting('t.r7')::uuid, 'x', 'usage', null, 'internal', null, 'x', null, '[]'::jsonb, '[{"device_code": "TH-X"}]'::jsonb) $$, '42501', 'permission denied for function app_itrp_complete', 'anon cannot call app_itrp_complete');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_report_devices d join public.itrp_repair_reports r on r.id = d.report_id where r.request_id = current_setting('t.r7')::uuid), 0, 'no device row was written by a refused call');

-- 3e. ขอแก้ไขแล้วส่งงานใหม่: ประวัติใช้รอบล่าสุด ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r9', pg_temp.ready('th-nb01')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.r9')::uuid, '[{"device_code": "th-nb01", "remark": "รอบแรก"}]'::jsonb) $$, 'first delivery with one device');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(jsonb_array_length(pg_temp.hist('th-nb01')), 1, 'the delivered request is already in the history of the device (before the requester confirms)');
select is(pg_temp.hist('th-nb01')->0->>'request_status', 'it_closed', 'the history row says the request is waiting for confirmation');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_request_rework(current_setting('t.r9')::uuid, 'ยังไม่หาย', pg_temp.today() + 3) $$, 'the requester asks for a rework');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.hist('th-nb01')->0->>'remark', 'รอบแรก', 'while the rework is open the history still shows the last delivery');
select is(pg_temp.hist('th-nb01')->0->>'request_status', 'in_progress', 'and the request status is in_progress');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select pg_temp.done(current_setting('t.r9')::uuid, '[{"device_code": "th-nb01", "remark": "รอบสอง", "action_note": "เปลี่ยนเมนบอร์ด"}, {"device_code": "th-nb02"}]'::jsonb) $$, 'second delivery with different devices');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(jsonb_array_length(pg_temp.hist('th-nb01')), 1, 'the history of the device shows one row for the request (not one per delivery)');
select is(pg_temp.hist('th-nb01')->0->>'remark', 'รอบสอง', 'the row comes from the latest delivery');
select is(pg_temp.hist('th-nb01')->0->>'action', 'เปลี่ยนเมนบอร์ด', 'the device action of the latest delivery is used');
select is(jsonb_array_length(pg_temp.hist('th-nb02')), 1, 'the second device of the latest delivery has the request in its history too');
select is(pg_temp.det(current_setting('t.r9')::uuid)->'repair_reports'->0->'devices'->0->>'remark', 'รอบแรก', 'the first delivery keeps its own device rows (append-only)');
select is(jsonb_array_length(pg_temp.det(current_setting('t.r9')::uuid)->'repair_reports'), 2, 'two repair reports exist for the request');
select is(pg_temp.det(current_setting('t.r9')::uuid)->'repair_report'->'devices'->0->>'remark', 'รอบสอง', 'repair_report (the latest) carries the latest devices');
-- ใบที่ส่งงานในรอบแรกด้วยเครื่อง A แล้วรอบสองไม่มีเครื่อง A: เครื่อง A ไม่มีใบนี้ในประวัติอีก
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_request_rework(current_setting('t.r9')::uuid, 'ยังเสียอีก', pg_temp.today() + 3) $$, 'a second rework is requested');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select pg_temp.done(current_setting('t.r9')::uuid, '[{"device_code": "th-nb02"}]'::jsonb) $$, 'third delivery lists only the second device');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(jsonb_array_length(pg_temp.hist('th-nb01')), 0, 'a device that is not in the latest delivery no longer shows the request');
select is(jsonb_array_length(pg_temp.hist('th-nb02')), 1, 'the device of the latest delivery does');

-- 4. ทะเบียนเครื่อง ----------------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itrp_save_device('  th-hx1 ', 'computer', 'สมชาย ใจดี', 'บัญชี', 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'created', 'true', 'the IT admin adds a device (code trimmed and upper-cased)');
select is((public.app_itrp_device_history('th-hx1')->'device')::jsonb - 'id', '{"code": "TH-HX1", "kind": "computer", "note": "ซื้อใหม่", "status": "active", "division": "บัญชี", "asset_no": "AS-001", "cpu_name": "Intel Core i5", "cpu_model": "12400", "user_name": "สมชาย ใจดี", "started_on": "2023-02-01"}'::jsonb, 'the history header comes from the registry');
select is(public.app_itrp_save_device('TH-HX1', 'computer', 'สมชาย ใจดี', 'บัญชี', 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'changed', 'false', 'saving the same values changes nothing');
select is(public.app_itrp_save_device('TH-HX1', 'computer', 'สมศรี ใจดี', 'บัญชี', 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'changed', 'true', 'changing the user is a change');
select is(public.app_itrp_save_device('TH-HX1', 'computer', 'สมศรี ใจดี', null, 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'changed', 'true', 'a null value clears the field');
select is(public.app_itrp_save_device('TH-HX1', 'computer', 'สมศรี ใจดี', 'บัญชี', 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'created', 'false', 'saving an existing code updates it (created = false)');
select throws_ok($$ select public.app_itrp_save_device('   ') $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'a code is required');
select throws_ok($$ select public.app_itrp_save_device(repeat('x', 51)) $$, '23514', 'รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร', 'a code is limited to 50 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'phone') $$, '23514', 'ชนิดอุปกรณ์ไม่ถูกต้อง', 'an unknown kind is refused');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, null, null, null, null, null, 'gone') $$, '23514', 'สถานะเครื่องต้องเป็น ใช้งาน หรือ ยกเลิกการใช้งาน', 'an unknown status is refused');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', repeat('ก', 201)) $$, '23514', 'ชื่อผู้ใช้เครื่องต้องไม่เกิน 200 ตัวอักษร', 'the user name is limited to 200 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, repeat('ก', 201)) $$, '23514', 'ชื่อแผนก/ส่วนงานต้องไม่เกิน 200 ตัวอักษร', 'the division is limited to 200 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, null, repeat('ก', 201)) $$, '23514', 'ข้อมูล Processor ต้องไม่เกิน 200 ตัวอักษร', 'the processor name is limited to 200 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, null, null, null, null, repeat('9', 101)) $$, '23514', 'เลขทะเบียนทรัพย์สินต้องไม่เกิน 100 ตัวอักษร', 'the asset number is limited to 100 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, null, null, null, null, null, 'active', repeat('ก', 1001)) $$, '23514', 'หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร', 'the note is limited to 1000 characters');
select throws_ok($$ select public.app_itrp_save_device('TH-BAD', 'computer', null, null, null, null, '1900-01-01') $$, '23514', 'วันที่เริ่มใช้ไม่ถูกต้อง', 'a start date before 1990 is refused');
select is((select count(*)::int from public.app_itrp_list_devices('th-bad')), 0, 'refused saves created nothing');
-- สิทธิ์: เฉพาะ it_admin เขียนได้
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select public.app_itrp_save_device('TH-NEW') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้', 'the IT approver cannot add or edit devices');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select public.app_itrp_save_device('TH-NEW') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้', 'an employee of the IT department without IT rights cannot add devices');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_save_device('TH-NEW') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้', 'a requester cannot add devices');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_save_device('TH-NEW') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้', 'a department manager cannot add devices');
-- สิทธิ์อ่าน: it_admin + ผู้อนุมัติ IT เท่านั้น
select throws_ok($$ select * from public.app_itrp_list_devices() $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูทะเบียนเครื่องได้', 'a department manager cannot list the registry');
select throws_ok($$ select public.app_itrp_device_history('TH-HX1') $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้', 'a department manager cannot read the history');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_device_history('TH-HX1') $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้', 'a requester cannot read the history');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select public.app_itrp_device_history('TH-HX1') $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้', 'an employee of the IT department without IT rights cannot read the history');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select * from public.app_itrp_list_devices() $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูทะเบียนเครื่องได้', 'an ordinary employee cannot list the registry');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ select * from public.app_itrp_list_devices() $$, '42501', 'permission denied for function app_itrp_list_devices', 'anon cannot list devices');
select throws_ok($$ select public.app_itrp_save_device('TH-NEW') $$, '42501', 'permission denied for function app_itrp_save_device', 'anon cannot save a device');
select throws_ok($$ select public.app_itrp_device_history('TH-HX1') $$, '42501', 'permission denied for function app_itrp_device_history', 'anon cannot read a history');
select throws_ok($$ select public.app_itrp_history_add('TH-HX1', null, current_date, 'x', null, null, null, null) $$, '42501', 'permission denied for function app_itrp_history_add', 'anon cannot add a history entry');
select throws_ok($$ select public.app_itrp_history_update(1, 'TH-HX1', null, current_date, 'x', null, null, null, null) $$, '42501', 'permission denied for function app_itrp_history_update', 'anon cannot update a history entry');
select throws_ok($$ select public.app_itrp_history_void(1, 'x') $$, '42501', 'permission denied for function app_itrp_history_void', 'anon cannot void a history entry');
select throws_ok($$ select public.app_itrp_history_get(1) $$, '42501', 'permission denied for function app_itrp_history_get', 'anon cannot read a history entry');
select throws_ok($$ select * from public.itrp_devices $$, '42501', 'permission denied for table itrp_devices', 'anon cannot read the registry table');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select * from public.itrp_devices $$, '42501', 'permission denied for table itrp_devices', 'a signed-in IT admin cannot read the registry table directly');
select throws_ok($$ insert into public.itrp_devices (code, created_by, updated_by) select 'TH-DIRECT', id, id from public.employees limit 1 $$, '42501', 'permission denied for table itrp_devices', 'a signed-in user cannot write the registry directly');
select throws_ok($$ select * from public.itrp_history_entries $$, '42501', 'permission denied for table itrp_history_entries', 'a signed-in user cannot read the history entries directly');
select throws_ok($$ insert into public.itrp_history_entries (source, device_code, created_by) select 'manual', 'TH-DIRECT', id from public.employees limit 1 $$, '42501', 'permission denied for table itrp_history_entries', 'a signed-in user cannot write history entries directly');
select throws_ok($$ select * from public.itrp_report_devices $$, '42501', 'permission denied for table itrp_report_devices', 'a signed-in user cannot read the report devices directly');
select throws_ok($$ select * from public.itrp_history_entry_revisions $$, '42501', 'permission denied for table itrp_history_entry_revisions', 'a signed-in user cannot read the revisions directly');
select throws_ok($$ select * from public.itrp_device_log $$, '42501', 'permission denied for table itrp_device_log', 'a signed-in user cannot read the device log directly');

-- 4b. log ของทะเบียนเครื่อง (เขียนโดย trigger) + ISO ----------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_device_log where device_code = 'TH-HX1'), 4, 'four register changes of TH-HX1 are logged (created + three real changes; the no-op is not)');
select is((select string_agg(action, ',' order by id) from public.itrp_device_log where device_code = 'TH-HX1'), 'created,updated,updated,updated', 'the log runs created, then three updates');
select ok((select old_values is null and new_values->>'user_name' = 'สมชาย ใจดี' from public.itrp_device_log where device_code = 'TH-HX1' order by id limit 1), 'the creation log has no old values and the first user');
select ok((select old_values->>'user_name' = 'สมชาย ใจดี' and new_values->>'user_name' = 'สมศรี ใจดี' from public.itrp_device_log where device_code = 'TH-HX1' order by id offset 1 limit 1), 'an update log keeps the old and the new value');
select is((select count(distinct l.actor_id)::int from public.itrp_device_log l where l.device_code = 'TH-HX1' and l.actor_id = current_setting('test.e_ith_adm')::uuid), 1, 'the log names the IT admin who made the changes');
select ok((select created_by = current_setting('test.e_ith_adm')::uuid and updated_by = current_setting('test.e_ith_adm')::uuid and updated_at >= created_at from public.itrp_devices where code = 'TH-HX1'), 'the registry row records who created and who last changed it');
select throws_ok($$ update public.itrp_devices set code = 'TH-RENAMED' where code = 'TH-HX1' $$, '42501', 'รหัสเครื่องและผู้บันทึกแก้ไขไม่ได้ (ถ้ารหัสผิด ให้เพิ่มรหัสใหม่แล้วยกเลิกการใช้งานรหัสเดิม)', 'a device code cannot be renamed');
select throws_ok($$ delete from public.itrp_devices where code = 'TH-HX1' $$, '42501', 'ทะเบียนเครื่องลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกการใช้งานแทน (บันทึกสำหรับ ISO)', 'a device cannot be deleted');
select throws_ok($$ truncate public.itrp_devices cascade $$, '42501', 'ทะเบียนเครื่องล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the registry cannot be truncated');
select throws_ok($$ update public.itrp_device_log set device_code = 'X' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the device log cannot be changed');
select throws_ok($$ delete from public.itrp_device_log $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'the device log cannot be deleted');
select throws_ok($$ truncate public.itrp_device_log $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the device log cannot be truncated');
select throws_ok($$ update public.itrp_report_devices set remark = 'แก้ย้อนหลัง' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a report device row cannot be updated');
select throws_ok($$ delete from public.itrp_report_devices $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a report device row cannot be deleted');
select throws_ok($$ truncate public.itrp_report_devices $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'report devices cannot be truncated');
select throws_ok($$ insert into public.itrp_report_devices (report_id, seq, device_code) select id, 1, 'th-lower' from public.itrp_repair_reports limit 1 $$, '23514', null, 'the table refuses a code that is not upper-case');
select throws_ok($$ insert into public.itrp_report_devices (report_id, seq, device_code) select id, 11, 'TH-ELEVEN' from public.itrp_repair_reports limit 1 $$, '23514', null, 'the table refuses an 11th sequence number');
select throws_ok($$ insert into public.itrp_report_devices (report_id, seq, device_code) select report_id, 9, device_code from public.itrp_report_devices limit 1 $$, '23505', null, 'the table refuses the same code twice in one report');
select throws_ok($$ insert into public.itrp_devices (code, kind, created_by, updated_by) select 'TH-KIND', 'phone', id, id from public.employees limit 1 $$, '23514', null, 'the table refuses an unknown kind');
select throws_ok($$ insert into public.itrp_devices (code, created_by, updated_by) select 'th-lower', id, id from public.employees limit 1 $$, '23514', null, 'the table refuses a code that is not upper-case');

-- 4c. รายการเครื่อง (ค้นหา · รหัสที่มีแต่ในประวัติ) ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itrp_save_device('TH-HX1', 'computer', 'สมศรี ใจดี', 'บัญชี', 'Intel Core i5', '12400', '2023-02-01', 'AS-001', 'active', 'ซื้อใหม่')->>'changed', 'false', 'saving the stored values again changes nothing');
select is(public.app_itrp_save_device('TH-OLD1', 'printer', 'ฝ่ายผลิต', 'ผลิต', null, null, '2015-01-01', 'AS-OLD', 'retired', null)->>'created', 'true', 'a second device (retired printer) is added');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is((select count(*)::int from public.app_itrp_list_devices('th-hx1')), 1, 'the IT approver can search the registry by code (any letter case)');
select is((select code from public.app_itrp_list_devices('TH-OLD1')), 'TH-OLD1', 'search finds a device by code');
select is((select code from public.app_itrp_list_devices('as-001')), 'TH-HX1', 'search finds a device by asset number');
select is((select code from public.app_itrp_list_devices('สมศรี')), 'TH-HX1', 'search finds a device by user name (Thai text)');
select is((select code from public.app_itrp_list_devices('ผลิต') where code like 'TH-%'), 'TH-OLD1', 'search finds a device by division');
select is((select code from public.app_itrp_list_devices('12400')), 'TH-HX1', 'search looks at the processor model');
select is((select count(*)::int from public.app_itrp_list_devices('%')), 0, 'a percent sign is a plain character in the search (no wildcard)');
select ok((select in_registry and device_id is not null and kind = 'computer' and status = 'active' from public.app_itrp_list_devices('th-hx1')), 'a registered device is flagged in_registry with its fields');
select ok((select not in_registry and device_id is null and kind is null and history_count = 1 from public.app_itrp_list_devices('th-nb02')), 'a code that exists only in the history is listed with in_registry = false');
select is((select count(*)::int from public.app_itrp_list_devices('th-old1', false)), 0, 'retired devices can be hidden');
select is((select count(*)::int from public.app_itrp_list_devices('th-old1', true)), 1, 'retired devices are listed by default');
select is((select count(*)::int from public.app_itrp_list_devices('th-nb02', false)), 1, 'hiding retired devices keeps the codes that are only in the history');
select is((select history_count from public.app_itrp_list_devices('th-hx1')), 0, 'a device without any repair has a history_count of 0');
select ok((select last_repair_on is null from public.app_itrp_list_devices('th-hx1')), 'and no last repair date');
select is((select count(*)::int from public.app_itrp_list_devices(null) where code like 'TH-%'), (select count(*)::int from public.app_itrp_list_devices() where code like 'TH-%'), 'a null search lists everything (same as no argument)');
select is((select string_agg(code, ',' order by ord) from (select code, row_number() over () as ord from public.app_itrp_list_devices('th-') where code in ('TH-COM05', 'TH-HX1', 'TH-NB02', 'TH-OLD1')) x), 'TH-COM05,TH-HX1,TH-NB02,TH-OLD1', 'the list is ordered by code');

-- 5. ประวัติรายเครื่อง: รวม 3 แหล่ง -----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.h1', pg_temp.ready('th-hx1')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.h1')::uuid, '[{"device_code": "th-hx1", "symptom_note": "จอฟ้า", "action_note": "ลง Windows ใหม่", "remark": "สำรองข้อมูลทุกสัปดาห์"}]'::jsonb) $$, 'request 1 is delivered with a per-device symptom, action and remark');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.h2', pg_temp.ready('TH-HX1', 6)::text, true);
select lives_ok($$ select public.app_itrp_complete(current_setting('t.h2')::uuid, 'ฝุ่นเยอะ', 'usage', null, 'internal', null, 'ทำความสะอาด', null) $$, 'request 2 is delivered by the old call (no devices)');
select set_config('t.h3', pg_temp.ready('th-hx1')::text, true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.h4', (select id::text from public.app_itrp_create('th-hx1', 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'เปิดไม่ติด', false)), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.h4')::uuid, 'ยกเลิกทดสอบ') $$, 'request 4 is cancelled by the requester');
select set_config('t.h5', pg_temp.ready('th-hx1')::text, true);
select lives_ok($$ select pg_temp.done(current_setting('t.h5')::uuid, '[{"device_code": "th-other"}]'::jsonb) $$, 'request 5 names a different device in the delivery although the requester wrote TH-HX1');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select set_config('t.m1', public.app_itrp_history_add('th-hx1', 'IT01-24/010', '2024-05-10', 'เมาส์ไม่ทำงาน', 'เปลี่ยนเมาส์', '2024-05-11', 'ซื้อเมาส์สำรอง', 'สมชาย')::text, true) $$, 'the IT admin adds a manual (back-dated) entry');
reset role;
select set_config('request.jwt.claims', '', true);
-- ข้อมูลนำเข้าจาก Excel: สคริปต์นำเข้าเขียนตรงด้วยสิทธิ์ผู้ดูแลฐานข้อมูล (ไม่ผ่าน RPC) ใช้ source = import
insert into public.itrp_history_entries (source, doc_no, device_code, reported_on, symptom, action, finished_on, remark, reporter_name, created_by)
values ('import', 'IT01-16/0001', 'TH-HX1', '2016-03-01', 'เปิดไม่ติด', 'เปลี่ยน Power Supply', '2016-03-02', null, 'สมหญิง', current_setting('test.e_ith_adm')::uuid),
       ('import', 'IT01-26/004', 'TH-HX1', '2026-01-05', 'ช้า', 'ล้างเครื่อง', '2026-01-06', 'ติดตามผล', 'สมชาย', current_setting('test.e_ith_adm')::uuid),
       ('import', null, 'TH-OLD1', '2015-02-02', 'กระดาษติด', null, null, null, null, current_setting('test.e_ith_adm')::uuid);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(jsonb_array_length(pg_temp.hist('TH-HX1')), 5, 'the history of TH-HX1 holds 2 imports + 1 manual + 2 requests (one delivered with device rows, one by the old call) = 5 rows (cancelled, in-progress and other-device requests are not there)');
select is((select string_agg(r->>'source', ',' order by ord) from jsonb_array_elements(pg_temp.hist('TH-HX1')) with ordinality t(r, ord)), 'import,manual,import,request,request', 'rows are ordered by date: 2016 import, 2024 manual, 2026 import, then the two requests of today');
select is((select string_agg(r->>'doc_no', ',' order by ord) from jsonb_array_elements(pg_temp.hist('TH-HX1')) with ordinality t(r, ord) where r->>'source' = 'request'), (select string_agg(x, ',' order by x) from unnest(array[pg_temp.det(current_setting('t.h1')::uuid)->>'doc_no', pg_temp.det(current_setting('t.h2')::uuid)->>'doc_no']) x), 'requests of the same day are ordered by document number');
select is((pg_temp.hist('th-hx1')->0) - 'updated_at', ('{"source": "import", "action": "เปลี่ยน Power Supply", "doc_no": "IT01-16/0001", "remark": null, "symptom": "เปิดไม่ติด", "entry_id": ' || (pg_temp.hist('th-hx1')->0->>'entry_id') || ', "request_id": null, "finished_on": "2016-03-02", "reported_on": "2016-03-01", "reporter_name": "สมหญิง", "request_status": null, "revision_count": 0}')::jsonb, 'an imported row carries the seven FM02 columns, its source and its id (and no request)');
select is((select r->>'symptom' || '|' || (r->>'action') || '|' || (r->>'remark') || '|' || (r->>'reporter_name') || '|' || (r->>'request_status') || '|' || (r->>'reported_on') || '|' || (r->>'finished_on') from jsonb_array_elements(pg_temp.hist('th-hx1')) r where r->>'request_id' = current_setting('t.h1')), 'จอฟ้า|ลง Windows ใหม่|สำรองข้อมูลทุกสัปดาห์|ทดสอบ ITH-REQ|it_closed|' || pg_temp.today() || '|' || pg_temp.today(), 'a request row uses the per-device notes, the requester name, today (Thai date) as the report and finish dates');
select is((select r->>'symptom' || '|' || (r->>'action') || '|' || coalesce(r->>'remark', 'null') || '|' || (r->>'reporter_name') from jsonb_array_elements(pg_temp.hist('th-hx1')) r where r->>'request_id' = current_setting('t.h2')), 'อาการจากใบ|ทำความสะอาด|null|ทดสอบ ITH-REQ2', 'a delivery without device rows falls back to the asset code, the symptom of the request and the action of the report');
select ok((select r->>'entry_id' is null from jsonb_array_elements(pg_temp.hist('th-hx1')) r where r->>'request_id' = current_setting('t.h1')), 'a request row has no entry id');
select is(jsonb_array_length(pg_temp.hist('th-other')), 1, 'the device that the delivery named has the request in its history');
select is(pg_temp.hist('th-other')->0->>'request_id', current_setting('t.h5'), 'it is request 5');
select is(jsonb_array_length(pg_temp.hist('TH-NONE')), 0, 'a code without any history gives an empty list');
select is(public.app_itrp_device_history('th-none')->>'code', 'TH-NONE', 'the code is returned upper-cased');
select is(public.app_itrp_device_history('th-none')->'device', 'null'::jsonb, 'the header is null for a code that is not in the registry');
select is(pg_temp.hist('th-old1')->0->>'source', 'import', 'another device has its own imported history');
select is(jsonb_array_length(pg_temp.hist('th-old1')), 1, 'histories of different devices do not mix');
select throws_ok($$ select public.app_itrp_device_history('  ') $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'a code is required for a history');
select throws_ok($$ select public.app_itrp_device_history(repeat('Z', 51)) $$, '23514', 'รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร', 'a code is limited to 50 characters for a history');
select ok((select last_repair_on = pg_temp.today() and history_count = 5 and in_registry from public.app_itrp_list_devices('th-hx1')), 'the device list counts all three sources and shows the latest repair date');

-- 6. ลงประวัติย้อนหลัง: เพิ่ม ----------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_history_add(null, null, '2024-01-01', 'x', null, null, null, null) $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'a device code is required');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, null, 'x', null, null, null, null) $$, '23514', 'กรุณาระบุวันที่แจ้งซ่อม', 'the report date is required');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, pg_temp.today() + 1, 'x', null, null, null, null) $$, '23514', 'วันที่แจ้งซ่อมไม่ถูกต้อง (ต้องไม่เป็นวันในอนาคต)', 'a future report date is refused');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '1980-01-01', 'x', null, null, null, null) $$, '23514', 'วันที่แจ้งซ่อมไม่ถูกต้อง (ต้องไม่เป็นวันในอนาคต)', 'a date before 1990 is refused');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, '2024-01-09', null, null) $$, '23514', 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต', 'the finish date cannot be before the report date');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, pg_temp.today() + 1, null, null) $$, '23514', 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต', 'the finish date cannot be in the future');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', '  ', ' ', null, null, null) $$, '23514', 'กรุณาระบุอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง', 'a symptom or an action is required');
select throws_ok($$ select public.app_itrp_history_add('TH-A', repeat('9', 51), '2024-01-10', 'x', null, null, null, null) $$, '23514', 'เลขที่ใบแจ้งซ่อมต้องไม่เกิน 50 ตัวอักษร', 'the document number is limited to 50 characters');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', repeat('ก', 2001), null, null, null, null) $$, '23514', 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร', 'the symptom is limited to 2000 characters');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', repeat('ก', 2001), null, null, null) $$, '23514', 'การแก้ไขต้องไม่เกิน 2,000 ตัวอักษร', 'the action is limited to 2000 characters');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, null, repeat('ก', 501), null) $$, '23514', 'ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร', 'the remark is limited to 500 characters');
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, null, null, repeat('ก', 201)) $$, '23514', 'ชื่อผู้แจ้งต้องไม่เกิน 200 ตัวอักษร', 'the reporter name is limited to 200 characters');
select throws_ok($$ select public.app_itrp_history_add('th-hx1', 'IT01-24/010', '2024-06-01', 'ซ้ำ', null, null, null, null) $$, '23514', 'มีประวัติของเครื่อง TH-HX1 เลขที่ใบ IT01-24/010 อยู่แล้ว', 'the same device and document number cannot be entered twice');
select lives_ok($$ select public.app_itrp_history_add('th-prt22', 'IT01-24/010', '2024-05-10', 'ปริ้นไม่ออก', null, null, null, null) $$, 'the same document number for another device is fine (one paper form can cover several devices)');
select lives_ok($$ select set_config('t.m2', public.app_itrp_history_add('th-hx1', ' - ', '2024-07-01', null, 'ล้างเครื่อง', null, null, null)::text, true) $$, 'a dash (or blank) document number means no number');
select lives_ok($$ select public.app_itrp_history_add('th-hx1', '-', '2024-07-02', null, 'ล้างเครื่องอีกครั้ง', null, null, null) $$, 'two entries without a document number are not duplicates');
select is(public.app_itrp_history_get(current_setting('t.m2')::bigint)->'entry'->'doc_no', 'null'::jsonb, 'the dash was stored as null');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'source', 'manual', 'an entry added in the web has source manual');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'created_by_employee_no', 'ITH-ADM', 'it records who entered it');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'device_code', 'TH-HX1', 'the code was upper-cased');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, null, null, null) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ลงประวัติการซ่อมย้อนหลังได้', 'the IT approver cannot add history entries');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_history_add('TH-A', null, '2024-01-10', 'x', null, null, null, null) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ลงประวัติการซ่อมย้อนหลังได้', 'a requester cannot add history entries');

-- 7. แก้ไข (เก็บรอยแก้) / ยกเลิก ---------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', 'IT01-24/010', '2024-05-10', 'เมาส์ไม่ทำงาน', 'เปลี่ยนเมาส์', '2024-05-11', 'ซื้อเมาส์สำรอง', 'สมชาย') $$, '23514', 'ไม่มีการเปลี่ยนแปลงจากรายการเดิม', 'an update without any change is refused (no empty revision)');
select is(public.app_itrp_history_update(current_setting('t.m1')::bigint, 'th-hx1', 'IT01-24/010', '2024-05-10', 'เมาส์ไม่ทำงาน (คลิกซ้ายเสีย)', 'เปลี่ยนเมาส์', '2024-05-12', 'ซื้อเมาส์สำรอง', 'สมชาย')->>'revision_count', '1', 'the first update makes one revision');
select is(public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', 'IT01-24/010', '2024-05-10', 'เมาส์ไม่ทำงาน (คลิกซ้ายเสีย)', 'เปลี่ยนเมาส์', '2024-05-12', null, 'สมชาย ใจดี')->>'revision_count', '2', 'the second update makes a second revision');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'symptom', 'เมาส์ไม่ทำงาน (คลิกซ้ายเสีย)', 'the entry holds the latest content');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'updated_by_full_name', 'ทดสอบ ITH-ADM', 'and who changed it last');
select is(jsonb_array_length(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'), 2, 'two revisions are listed');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->0->'snapshot'->>'symptom', 'เมาส์ไม่ทำงาน', 'revision 1 holds the original text (before the first change)');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->0->'snapshot'->>'finished_on', '2024-05-11', 'revision 1 holds the original finish date');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->1->'snapshot'->>'remark', 'ซื้อเมาส์สำรอง', 'revision 2 holds the text before the second change');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->1->>'changed_by_employee_no', 'ITH-ADM', 'every revision names who changed it');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->0->>'change_kind', 'update', 'the kind of a content change is update');
select ok((public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->0->>'created_at')::timestamptz <= (public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->1->>'created_at')::timestamptz, 'revisions carry the time of the change');
select is((select (r->>'revision_count')::int from jsonb_array_elements(pg_temp.hist('th-hx1')) r where (r->>'entry_id')::bigint = current_setting('t.m1')::bigint), 2, 'the history row shows how many times it was changed');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', 'IT01-24/010', null, 'x', null, null, null, null) $$, '23514', 'กรุณาระบุวันที่แจ้งซ่อม', 'an update needs a report date');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', 'IT01-24/010', '2024-05-10', null, null, null, null, null) $$, '23514', 'กรุณาระบุอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง', 'an update needs a symptom or an action');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', 'IT01-24/010', '2024-05-10', 'x', null, '2024-05-01', null, null) $$, '23514', 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต', 'an update keeps the date rules');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m2')::bigint, 'TH-HX1', 'IT01-24/010', '2024-07-01', 'x', null, null, null, null) $$, '23514', 'มีประวัติของเครื่อง TH-HX1 เลขที่ใบ IT01-24/010 อยู่แล้ว', 'an update cannot create a duplicate of another entry');
select throws_ok($$ select public.app_itrp_history_update(-5, 'TH-HX1', null, '2024-05-10', 'x', null, null, null, null) $$, '23514', 'ไม่พบรายการประวัติการซ่อมนี้', 'an unknown entry is not found');
select is(public.app_itrp_history_update(current_setting('t.m2')::bigint, 'TH-HX1', 'IT01-24/011', '2024-07-01', null, 'ล้างเครื่อง', null, null, null)->>'revision_count', '1', 'the document number can be corrected');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', null, '2024-05-10', 'x', null, null, null, null) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่แก้ประวัติการซ่อมได้', 'the IT approver cannot update an entry');
select throws_ok($$ select public.app_itrp_history_void(current_setting('t.m1')::bigint, 'x') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ยกเลิกรายการประวัติการซ่อมได้', 'the IT approver cannot void an entry');
select is(jsonb_array_length(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'), 2, 'the IT approver can read an entry with its revisions');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_history_get(current_setting('t.m1')::bigint) $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้', 'a requester cannot read an entry');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_history_void(current_setting('t.m1')::bigint, '   ') $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิกรายการ', 'a void needs a reason');
select throws_ok($$ select public.app_itrp_history_void(current_setting('t.m1')::bigint, repeat('ก', 501)) $$, '23514', 'เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'the void reason is limited to 500 characters');
select throws_ok($$ select public.app_itrp_history_void(-5, 'x') $$, '23514', 'ไม่พบรายการประวัติการซ่อมนี้', 'an unknown entry cannot be voided');
select is(jsonb_array_length(pg_temp.hist('th-hx1')), 7, 'before the void the history of TH-HX1 has 7 rows (5 + 2 manual entries without a document number)');
select is(public.app_itrp_history_void(current_setting('t.m1')::bigint, 'ลงซ้ำกับใบกระดาษ')->>'id', current_setting('t.m1'), 'the IT admin voids an entry with a reason');
select is(jsonb_array_length(pg_temp.hist('th-hx1')), 6, 'a voided entry no longer shows in the history of the device');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'void_reason', 'ลงซ้ำกับใบกระดาษ', 'but it can still be opened with the reason');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'entry'->>'voided_by_full_name', 'ทดสอบ ITH-ADM', 'and who voided it');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->2->>'change_kind', 'void', 'the void is a revision of its own kind');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->2->>'reason', 'ลงซ้ำกับใบกระดาษ', 'carrying the reason');
select is(public.app_itrp_history_get(current_setting('t.m1')::bigint)->'revisions'->2->'snapshot'->>'symptom', 'เมาส์ไม่ทำงาน (คลิกซ้ายเสีย)', 'and the content as it was when voided');
select throws_ok($$ select public.app_itrp_history_void(current_setting('t.m1')::bigint, 'อีกครั้ง') $$, '23514', 'รายการนี้ถูกยกเลิกไปแล้ว', 'a voided entry cannot be voided twice');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', null, '2024-05-10', 'แก้หลังยกเลิก', null, null, null, null) $$, '23514', 'รายการนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้', 'a voided entry cannot be updated');
select lives_ok($$ select public.app_itrp_history_add('th-hx1', 'IT01-24/010', '2024-05-10', 'ลงใหม่ถูกต้อง', null, null, null, null) $$, 'after a void the same device and document number can be entered again');
select is(jsonb_array_length(pg_temp.hist('th-hx1')), 7, 'the corrected entry is in the history');
select is(public.app_itrp_device_history('th-hx1')->'rows'->0->>'doc_no', 'IT01-16/0001', 'rows still run oldest first');

-- 7b. ISO: เขียนตรงด้วยสิทธิ์ผู้ดูแลฐานข้อมูลก็แก้/ลบรอยแก้ไม่ได้ ------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ delete from public.itrp_history_entries where id = current_setting('t.m1')::bigint $$, '42501', 'ประวัติการซ่อมลบไม่ได้ ให้ยกเลิกรายการพร้อมเหตุผลแทน (บันทึกสำหรับ ISO)', 'an entry cannot be deleted');
select throws_ok($$ truncate public.itrp_history_entries cascade $$, '42501', 'ประวัติการซ่อมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the entries cannot be truncated');
select throws_ok($$ update public.itrp_history_entries set symptom = 'แก้หลังยกเลิก' where id = current_setting('t.m1')::bigint $$, '42501', 'รายการที่ยกเลิกแล้วแก้ไขไม่ได้', 'a voided entry cannot be changed even directly');
select throws_ok($$ update public.itrp_history_entries set source = 'manual' where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '42501', 'แหล่งที่มา ผู้ลง และเวลาที่ลงของประวัติการซ่อมแก้ไขไม่ได้', 'the source cannot be changed');
select throws_ok($$ update public.itrp_history_entries set created_by = current_setting('test.e_ith_req')::uuid where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '42501', 'แหล่งที่มา ผู้ลง และเวลาที่ลงของประวัติการซ่อมแก้ไขไม่ได้', 'the person who entered it cannot be changed');
select throws_ok($$ update public.itrp_history_entries set created_at = now() - interval '1 day' where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '42501', 'แหล่งที่มา ผู้ลง และเวลาที่ลงของประวัติการซ่อมแก้ไขไม่ได้', 'the time it was entered cannot be changed');
select throws_ok($$ update public.itrp_history_entries set symptom = 'แก้เงียบ ๆ' where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '23514', 'ต้องระบุผู้แก้ไข', 'a direct content change must name who changed it');
select throws_ok($$ update public.itrp_history_entries set updated_by = current_setting('test.e_ith_req')::uuid, updated_at = now() where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '42501', 'แก้เฉพาะผู้แก้ไข/เวลาแก้ไม่ได้', 'only changing the editor or the edit time (no content) is refused');
select throws_ok($$ update public.itrp_history_entries set symptom = 'ใหม่', voided_at = now(), voided_by = current_setting('test.e_ith_adm')::uuid, void_reason = 'x' where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '23514', 'ยกเลิกรายการต้องไม่แก้เนื้อหาพร้อมกัน', 'a void cannot change the content in the same step');
select throws_ok($$ update public.itrp_history_entries set voided_at = now(), voided_by = current_setting('test.e_ith_adm')::uuid where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, '23514', null, 'a void without a reason is refused by the table');
select lives_ok($$ update public.itrp_history_entries set remark = 'แก้ตรงโดยระบุผู้แก้', updated_by = current_setting('test.e_ith_adm')::uuid where id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') $$, 'a direct change that names the editor works and still leaves a revision');
select is((select count(*)::int from public.itrp_history_entry_revisions where entry_id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004')), 1, 'the direct change wrote a revision too (the guard is a trigger, not only the RPC)');
select is((select snapshot->>'remark' from public.itrp_history_entry_revisions where entry_id = (select id from public.itrp_history_entries where doc_no = 'IT01-26/004') order by revision_no desc limit 1), 'ติดตามผล', 'and it holds the text before that change');
select throws_ok($$ update public.itrp_history_entry_revisions set reason = 'แก้รอยแก้' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a revision cannot be changed');
select throws_ok($$ delete from public.itrp_history_entry_revisions $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a revision cannot be deleted');
select throws_ok($$ truncate public.itrp_history_entry_revisions $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'revisions cannot be truncated');
select throws_ok($$ insert into public.itrp_history_entries (source, device_code, created_by, reported_on) values ('paper', 'TH-A', current_setting('test.e_ith_adm')::uuid, '2024-01-01') $$, '23514', null, 'the table refuses an unknown source');
select throws_ok($$ insert into public.itrp_history_entries (source, device_code, created_by, reported_on) values ('manual', 'th-a', current_setting('test.e_ith_adm')::uuid, '2024-01-01') $$, '23514', null, 'the table refuses a code that is not upper-case');
select throws_ok($$ insert into public.itrp_history_entries (source, device_code, created_by, reported_on) values ('manual', 'TH-A', current_setting('test.e_ith_adm')::uuid, '1980-01-01') $$, '23514', null, 'the table refuses a date before 1990');
select throws_ok($$ insert into public.itrp_history_entries (source, device_code, created_by, voided_by) values ('manual', 'TH-A', current_setting('test.e_ith_adm')::uuid, current_setting('test.e_ith_adm')::uuid) $$, '23514', null, 'the table refuses a half-filled void (by without time and reason)');
select is((select count(*)::int from public.itrp_history_entries where source = 'import'), 3, 'the three imported rows are still there');

-- 8. โหมดทดสอบ: แยกทะเบียน/ประวัติ และล้างข้อมูลทดสอบ -------------------------
select is((select count(*)::int from public.itrp_devices where not is_test), 2, 'two real devices before the test mode (TH-HX1, TH-OLD1)');
select count(set_config('t.real_hx1_log', (select count(*)::text from public.itrp_device_log where not is_test), true));
select count(set_config('t.real_entries', (select count(*)::text from public.itrp_history_entries where not is_test), true));
select count(set_config('t.real_revs', (select count(*)::text from public.itrp_history_entry_revisions where not is_test), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_h_staff')::uuid) $$, 'the admin enters the test mode as a staff persona');
select set_config('t.s1', (select id::text from public.app_itrp_create('th-hx1', 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'อาการทดสอบ', false)), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_h_mgr')::uuid) $$, 'switching to the manager persona');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.s1')::uuid) $$, 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switching to the IT approver persona');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.s1')::uuid) $$, 'the persona IT approver approves');
select is(jsonb_array_length(pg_temp.hist('th-hx1')), 0, 'the IT approver persona (test mode) sees no history of a real device (separate worlds)');
select is(public.app_itrp_device_history('th-hx1')->'device', 'null'::jsonb, 'and no registry header of the real device');
select is((select count(*)::int from public.app_itrp_list_devices()), 0, 'the test registry is empty at the start of the test mode');
select throws_ok($$ select public.app_itrp_save_device('TH-HX1', 'computer', 'ทดสอบ') $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้', 'the IT approver persona cannot write the registry');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'switching to the IT department requester persona (no IT rights)');
select throws_ok($$ select public.app_itrp_device_history('TH-HX1') $$, '42501', 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้', 'the IT department requester persona (no IT rights) cannot read the history');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select lives_ok($$ select public.app_itrp_start(current_setting('t.s1')::uuid) $$, 'the IT admin persona starts the test request');
select lives_ok($$ select pg_temp.done(current_setting('t.s1')::uuid, '[{"device_code": "th-hx1", "remark": "ทดสอบ"}, {"device_code": "th-sbx2"}]'::jsonb) $$, 'the IT admin persona delivers with devices');
select is(public.app_itrp_save_device('TH-HX1', 'laptop', 'ผู้ใช้ทดสอบ')->>'created', 'true', 'the same code can be added to the test registry (a separate row from the real one)');
select is(public.app_itrp_device_history('th-hx1')->'device'->>'user_name', 'ผู้ใช้ทดสอบ', 'the test header is the test device');
select lives_ok($$ select set_config('t.sm1', public.app_itrp_history_add('th-hx1', 'IT01-99/001', '2024-01-01', 'ทดสอบ', null, null, null, null)::text, true) $$, 'a test history entry is added');
select is((select string_agg(r->>'source', ',' order by ord) from jsonb_array_elements(pg_temp.hist('th-hx1')) with ordinality t(r, ord)), 'manual,request', 'the test history holds only test rows (test request + test entry)');
select is(public.app_itrp_history_update(current_setting('t.sm1')::bigint, 'TH-HX1', 'IT01-99/001', '2024-01-01', 'ทดสอบแก้', null, null, null, null)->>'revision_count', '1', 'a test entry can be updated (one test revision)');
select is((select count(*)::int from public.app_itrp_list_devices('th-')), 2, 'the test list shows TH-HX1 (registry) and TH-SBX2 (history only), none of the real devices');
select throws_ok($$ select public.app_itrp_history_get(current_setting('t.m1')::bigint) $$, '23514', 'ไม่พบรายการประวัติการซ่อมนี้', 'a test-mode persona cannot open an entry of the real world');
select throws_ok($$ select public.app_itrp_history_update(current_setting('t.m1')::bigint, 'TH-HX1', null, '2024-05-10', 'x', null, null, null, null) $$, '23514', 'ไม่พบรายการประวัติการซ่อมนี้', 'a test-mode persona cannot update a real entry');
select throws_ok($$ select public.app_itrp_history_void(current_setting('t.m1')::bigint, 'x') $$, '23514', 'ไม่พบรายการประวัติการซ่อมนี้', 'a test-mode persona cannot void a real entry');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(jsonb_array_length(pg_temp.hist('th-hx1')), 7, 'back in the real world the history of TH-HX1 is unchanged (7 rows, no test row)');
select is(public.app_itrp_device_history('th-hx1')->'device'->>'user_name', 'สมศรี ใจดี', 'the real registry row was not touched by the test mode');
select is((select count(*)::int from public.app_itrp_list_devices('th-sbx2')), 0, 'a code that only exists in the test history is not listed in the real world');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_devices where not is_test), 2, 'still two real devices');
select is((select count(*)::int from public.itrp_devices where is_test), 1, 'one test device was created in the test mode');
select is((select count(*)::int from public.itrp_history_entries where not is_test), current_setting('t.real_entries')::int, 'the real entries are unchanged by the test mode');
select is((select count(*)::int from public.itrp_report_devices where is_test), 2, 'two test report devices exist');
select ok((select bool_and(d.is_test = r.is_test) from public.itrp_report_devices d join public.itrp_repair_reports r on r.id = d.report_id), 'report devices never mix test and real reports');
select ok((select bool_and(l.is_test = d.is_test) from public.itrp_device_log l join public.itrp_devices d on d.id = l.device_id), 'device log rows follow the mode of their device');
select ok((select bool_and(r.is_test = e.is_test) from public.itrp_history_entry_revisions r join public.itrp_history_entries e on e.id = r.entry_id), 'revisions follow the mode of their entry');
select count(set_config('t.test_rows', ((select count(*) from public.itrp_requests where is_test) + (select count(*) from public.itrp_events where is_test) + (select count(*) from public.itrp_repair_reports where is_test) + (select count(*) from public.itrp_repair_parts where is_test) + (select count(*) from public.itrp_report_devices where is_test) + (select count(*) from public.itrp_doc_counters where is_test) + (select count(*) from public.itrp_devices where is_test) + (select count(*) from public.itrp_device_log where is_test) + (select count(*) from public.itrp_history_entries where is_test) + (select count(*) from public.itrp_history_entry_revisions where is_test) + (select count(*) from public.itrp_admin_log where is_test) + (select count(*) from public.itrp_reworks where is_test) + (select count(*) from public.itrp_comments where is_test) + (select count(*) from public.itrp_attachments where is_test))::text, true));
select ok(current_setting('t.test_rows')::int >= 12, 'the test mode left a good number of test rows to purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_h_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itrp()->>'deleted')::int, current_setting('t.test_rows')::int, 'the purge deletes every test row of all tables (including the five history tables)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_devices where is_test) + (select count(*)::int from public.itrp_device_log where is_test) + (select count(*)::int from public.itrp_report_devices where is_test) + (select count(*)::int from public.itrp_history_entries where is_test) + (select count(*)::int from public.itrp_history_entry_revisions where is_test), 0, 'no test row is left in the five history tables');
select is((select count(*)::int from public.itrp_devices where not is_test), 2, 'the real devices survived the purge');
select is((select count(*)::int from public.itrp_history_entries where not is_test), current_setting('t.real_entries')::int, 'the real entries survived the purge');
select ok((select count(*) from public.itrp_history_entry_revisions where not is_test) = current_setting('t.real_revs')::int and (select count(*) from public.itrp_history_entry_revisions where not is_test) > 0, 'the real revisions survived the purge');
select ok((select count(*) from public.itrp_device_log where not is_test) = current_setting('t.real_hx1_log')::int and (select count(*) from public.itrp_device_log where not is_test) > 0, 'the real device log survived the purge');
select ok((select count(*) from public.itrp_report_devices where not is_test) > 0, 'the real report devices survived the purge');
select throws_ok($$ delete from public.itrp_devices where not is_test $$, '42501', 'ทะเบียนเครื่องลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกการใช้งานแทน (บันทึกสำหรับ ISO)', 'real devices still cannot be deleted after a purge');
select throws_ok($$ delete from public.itrp_history_entries where not is_test $$, '42501', 'ประวัติการซ่อมลบไม่ได้ ให้ยกเลิกรายการพร้อมเหตุผลแทน (บันทึกสำหรับ ISO)', 'real entries still cannot be deleted after a purge');
select throws_ok($$ delete from public.itrp_history_entry_revisions where not is_test $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real revisions still cannot be deleted after a purge');
select throws_ok($$ delete from public.itrp_report_devices where not is_test $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real report devices still cannot be deleted after a purge');
select is(current_setting('itrp.purge', true), 'off', 'the purge flag is switched off again');

select * from finish();
rollback;
