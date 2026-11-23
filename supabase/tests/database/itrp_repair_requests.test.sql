-- ทดสอบโมดูลใบแจ้งซ่อมคอมพิวเตอร์ (20261212010000_itrp_repair_requests.sql) — ส่วนแกนของโมดูล
--   1) โครงสร้าง: RLS ทุกตาราง, ไม่มีสิทธิ์เขียน/อ่านตรง, RPC เป็น SECURITY DEFINER + search_path ว่าง + anon เรียกไม่ได้, ด่าน lab-only, ไม่มี itrp_staff
--   2) แจ้งซ่อม: ตรวจทุกช่อง, เลขที่ IT01-YY/NNN, เส้นทางอนุมัติทุกกรณี (ผจก./ผู้ช่วย, แผนกไม่มีผจก., แผนก IT, ผู้อนุมัติขั้น IT แจ้งเอง, งานด่วน)
--   3) อนุมัติ/ไม่อนุมัติ/ยกเลิก/เริ่ม · ถามผู้แจ้ง-ตอบ · ส่งงาน (บันทึกการซ่อม + อะไหล่ ตรวจทุกช่อง) · ขอแก้ไข -> ส่งงานรอบสอง · ยืนยันรับ
--   4) ISO: events/reports/parts/reworks/comments/admin_log แก้-ลบ-ล้างไม่ได้ ใบลบไม่ได้ และเปลี่ยนสถานะได้เฉพาะตามตาราง · CHECK ของตาราง
--   5) การมองเห็นของแต่ละบทบาท, anon/เขียนตรงไม่ได้, เลขเอกสาร (ไม่ซ้ำ, ปีไทย, ตั้งเลขถัดไป), รายชื่อทีม IT อ่านอย่างเดียว, itwo ไม่ถูกกระทบ
--   6) โหมดทดสอบ: แยกข้อมูล/เลขที่ TEST-, ผู้อนุมัติแผนกมาจาก persona, ล้างข้อมูลทดสอบโดยไม่แตะของจริง
-- ไฟล์แนบ/Storage อยู่ที่ itrp_files.test.sql · แจ้งเตือนอยู่ที่ itrp_notify.test.sql
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITRP-*) ในแผนกทดสอบ ZR* ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(435);

-- ตัวช่วย (ชั่วคราว): claims ของผู้ใช้ทดสอบเลขที่ n · สร้างใบ · ส่งงานแบบกรอกขั้นต่ำ · สรุป events/สถานะ
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1d800000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.new_req(p_urgent boolean default false) returns text language sql as $$
  select (select id::text from public.app_itrp_create(null, 'PC-01', 'repair', null, 'computer', null, 'เปิดเครื่องไม่ติด', p_urgent)) $$;
create function pg_temp.done(p_id uuid) returns uuid language sql as $$
  select public.app_itrp_complete(p_id, 'สายไฟหลวม', 'usage', null, 'internal', null, 'เสียบสายใหม่', null, '[]'::jsonb) $$;
create function pg_temp.acts(p_id uuid) returns text language sql as $$
  select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itrp_get_detail(p_id)->'events') e $$;
create function pg_temp.st(p_id uuid) returns text language sql as $$ select public.app_itrp_get_detail(p_id)->>'status' $$;
create function pg_temp.yy() returns text language sql as $$ select to_char(now() at time zone 'Asia/Bangkok', 'YY') $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'r' and c.relrowsecurity), 14, 'RLS is enabled on all fourteen itrp tables (nine of the repair request + five of the repair history)');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'r'), 14, 'the module has exactly the fourteen documented tables (no itrp_staff, no access table)');
select ok(to_regclass('public.itrp_staff') is null and to_regclass('public.itrp_access_changes') is null, 'there is no itrp_staff and no access-rights table (the IT rights come from itwo_staff)');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name like 'itrp\_%' and g.grantee in ('anon', 'authenticated', 'PUBLIC')), 'anon, authenticated and PUBLIC have no direct grant on any itrp table');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'r' and has_table_privilege('service_role', c.oid, p.priv)), 'service_role has no privilege at all on any itrp table (the secret key cannot write the ISO records directly)');
select ok(exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'S') and not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequences of the itrp tables are closed to service_role, anon and authenticated');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p(priv) where c.relnamespace = 'public'::regnamespace and c.relname like 'itrp\_%' and c.relkind = 'r' and (has_table_privilege('anon', c.oid, p.priv) or has_table_privilege('authenticated', c.oid, p.priv))), 'anon and authenticated hold no table privilege either (checked per privilege)');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itrp\_%' and p.polname like '%\_no\_direct\_access'), 14, 'every itrp table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itrp\_%' and p.polname = 'lab_only_no_access' and not p.polpermissive), 14, 'every itrp table has the restrictive lab-only policy');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itrp_requests', 'itrp_events', 'itrp_doc_counters', 'itrp_admin_log', 'itrp_reworks', 'itrp_comments', 'itrp_attachments', 'itrp_repair_reports', 'itrp_repair_parts', 'itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions']) t), 'the fourteen test-mode aware tables are registered in private.sandbox_unguarded_tables()');
select ok(array['itwo_work_orders', 'itwo_events', 'itwo_access_changes', 'itwo_doc_counters', 'itwo_admin_log', 'itwo_reworks', 'itwo_attachments', 'itwo_comments', 'ncr_reports', 'audit_logs', 'sandbox_sessions'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itwo and central)');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itrp\_%' and t.tgname like '%\_sandbox\_scope' and not t.tgisinternal), 14, 'every itrp table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itrp\_%' and (t.tgname like '%\_append\_only' or t.tgname like '%\_no\_truncate') and not t.tgisinternal), 23, 'the ten append-only tables carry append-only + no-truncate triggers and the request, device and history-entry tables the no-truncate trigger');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itrp\_%' or p.proname = 'app_sandbox_purge_itrp')), 29, 'the module exposes 28 app_itrp RPCs (21 of the repair request + 7 of the repair history) and the sandbox purge');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_set_staff', 'app_itrp_save_access_changes')), 'there is no RPC to edit the IT staff or the access-rights section');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itrp\_%' or p.proname = 'app_sandbox_purge_itrp')), 'every public itrp function is SECURITY DEFINER with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_%' and p.prokind = 'f'), 'every private itrp function has an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itrp\_%' or p.proname = 'app_sandbox_purge_itrp') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'anon cannot execute any itrp RPC and authenticated can');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_%' and p.proname not like 'itrp\_storage\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itrp helpers are not callable by anon or authenticated (except the Storage policy helpers, checked in itrp_files.test.sql)');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itrp%'), 'every itrp RPC has the lab-only guard');
select ok(position('Asia/Bangkok' in pg_get_functiondef('private.itrp_next_doc_no(boolean, timestamptz)'::regprocedure)) > 0, 'the document year is computed in Asia/Bangkok time');
select ok(position('itwo_staff' in pg_get_functiondef('private.itrp_is_it_admin(uuid)'::regprocedure)) > 0 and position('itwo_staff' in pg_get_functiondef('private.itrp_is_it_approver(uuid)'::regprocedure)) > 0 and position('itwo_staff' in pg_get_functiondef('private.itrp_is_staff(uuid)'::regprocedure)) > 0, 'the IT rights are read from itwo_staff (read-only)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itrp%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.itwo_'), 'no itrp function writes to any itwo table');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itrp\_%') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'user-facing messages say "ใบแจ้งซ่อม", never "ใบสั่งงาน"');
select is((select count(*)::int from storage.buckets where id in ('itrp-files', 'itrp-test-files') and not public and file_size_limit = 20971520), 2, 'both itrp buckets exist, are private and limited to 20 MB');
select is((select count(*)::int from public.employees where is_test and employee_no in ('SBX-IT-STAFF', 'SBX-IT-ADMIN', 'SBX-IT-APPROVER')), 3, 'the IT test personas of the work order module are reused (no new persona rows)');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
select count(set_config('t.itwo_staff_before', (select count(*)::text from public.itwo_staff), true));
select count(set_config('t.itwo_orders_before', (select count(*)::text from public.itwo_work_orders), true));
select count(set_config('t.itwo_log_before', ((select count(*) from public.itwo_events) + (select count(*) from public.itwo_admin_log))::text, true));
insert into public.departments (code, name_th, name_en) values
  ('ZRA', 'แผนกทดสอบ A (มีผู้จัดการ)', 'ZR A'), ('ZRB', 'แผนกทดสอบ B (ไม่มีผู้จัดการ)', 'ZR B'),
  ('ZRC', 'แผนกทดสอบ C (มีแต่ผู้ช่วย)', 'ZR C'), ('ZRD', 'แผนกทดสอบ D (ผู้จัดการถูกปิด)', 'ZR D'),
  ('ZRF', 'แผนกทดสอบ F (ผู้จัดการเป็นผู้อนุมัติ IT)', 'ZR F');
insert into auth.users (id, email, raw_user_meta_data)
select ('1d800000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itrp-u' || n || '@test.local', '{}'::jsonb
from generate_series(1, 17) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itrp.test', d.id, r.id,
       case when v.n is null then null else ('1d800000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid end, v.active
from (values
  (1, 'ITRP-REQ1', 'ZRA', 'staff', true),
  (2, 'ITRP-REQ2', 'ZRA', 'staff', true),
  (3, 'ITRP-MGRA', 'ZRA', 'department_manager', true),
  (4, 'ITRP-REQC', 'ZRC', 'staff', true),
  (5, 'ITRP-AMGRC', 'ZRC', 'assistant_department_manager', true),
  (6, 'ITRP-REQB', 'ZRB', 'staff', true),
  (7, 'ITRP-REQIT', 'IT', 'staff', true),
  (8, 'ITRP-ADM', 'MGT', 'staff', true),
  (9, 'ITRP-APPR', 'MGT', 'general_manager', true),
  (10, 'ITRP-OADM', 'MGT', 'admin', true),
  (11, 'ITRP-MGRX', 'RB', 'department_manager', true),
  (12, 'ITRP-REQD', 'ZRD', 'staff', true),
  (14, 'ITRP-AP2', 'ZRF', 'department_manager', true),
  (15, 'ITRP-REQF', 'ZRF', 'staff', true),
  (16, 'ITRP-SBXADMIN', 'MGT', 'admin', true),
  (17, 'MNPLAB001', 'ZRA', 'staff', true),
  (null, 'ITRP-MGRD-OFF', 'ZRD', 'department_manager', false)
) as v(n, no, dep, role, active)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- สิทธิ์ทีม IT อยู่ที่ itwo_staff (itrp อ่านอย่างเดียว): ADM = ผู้ดูแลงาน · APPR = ผู้อนุมัติขั้น IT (หัวหน้า IT แบบ v4 ไม่ใช่ผู้ดูแลงาน) · AP2 = ผจก.ZRF ที่เป็นผู้อนุมัติขั้น IT ด้วย
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITRP-ADM', true, false), ('ITRP-APPR', false, true), ('ITRP-AP2', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZR-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZRA', 'sbx-zr-staff@sandbox.local', (select id from public.departments where code = 'ZRA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZR-MGR', 'ทดสอบ', 'ผจก. ZRA', 'sbx-zr-mgr@sandbox.local', (select id from public.departments where code = 'ZRA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select is((select count(*)::int from public.itrp_requests), 0, 'there are no repair requests before the tests (clean database)');

-- 3. แจ้งซ่อม: เส้นทางอนุมัติแต่ละกรณี -----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.o1', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.o2', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.o3', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select set_config('t.o4', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.o5', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select set_config('t.o6', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select set_config('t.o7', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(12), true);
select set_config('t.o8', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(15), true);
select set_config('t.o9', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.o10', pg_temp.new_req(true), true);
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.st(current_setting('t.o1')::uuid), 'pending_dept', 'a staff member of a department with a manager waits for the department step');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created', 'a normal request records only "created"');
select is(pg_temp.st(current_setting('t.o2')::uuid), 'pending_it_mgr', 'a department manager filing skips the department step');
select is(pg_temp.acts(current_setting('t.o2')::uuid), 'created,dept_approved', 'the department step is signed automatically in the requester name');
select is(public.app_itrp_get_detail(current_setting('t.o2')::uuid)->'events'->1->>'actor_employee_no', 'ITRP-MGRA', 'the automatic department approval is signed by the requester');
select is(pg_temp.st(current_setting('t.o3')::uuid), 'pending_it_mgr', 'an assistant department manager filing skips the department step too');
select is(pg_temp.st(current_setting('t.o4')::uuid), 'pending_dept', 'a department that has only an assistant still waits for that assistant');
select is(pg_temp.st(current_setting('t.o5')::uuid), 'pending_it_mgr', 'a department without any manager goes straight to the IT approver');
select is(pg_temp.acts(current_setting('t.o5')::uuid), 'created', 'no department approval is recorded yet for a department without manager');
select ok((public.app_itrp_get_detail(current_setting('t.o5')::uuid)->'events'->0->>'reason') like '%ไม่มีผู้จัดการ%', 'the created event says why the department step is skipped');
select is(pg_temp.st(current_setting('t.o6')::uuid), 'pending_it_mgr', 'an IT department requester waits for the IT approver only');
select is(pg_temp.st(current_setting('t.o7')::uuid), 'approved', 'an IT approver filing is approved immediately');
select is(pg_temp.acts(current_setting('t.o7')::uuid), 'created,dept_approved,it_mgr_approved', 'the IT approver signs both steps at filing');
select is(pg_temp.st(current_setting('t.o8')::uuid), 'pending_it_mgr', 'an inactive manager does not count: the department is treated as having no manager');
select is(pg_temp.st(current_setting('t.o9')::uuid), 'pending_dept', 'a department whose manager is also an IT approver waits for the department step');
select is(public.app_itrp_get_detail(current_setting('t.o9')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/009', 'document numbers run IT01-YY/NNN in order');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/001', 'the first document of the year is IT01-YY/001');
select is(public.app_itrp_get_detail(current_setting('t.o10')::uuid)->>'is_urgent', 'true', 'the urgent flag is stored');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select last_seq::int from public.itrp_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 10, 'the counter advanced once per filed request');
select is((select count(*)::int from public.itrp_events where action = 'created'), 10, 'every request has exactly one created event');

-- 3b. ตรวจข้อมูลที่กรอก (ไม่กินเลขที่เอกสาร) ----------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.app_itrp_create(repeat('9', 51), 'PC', 'repair', null, 'computer', null, 'x', false) $$, '23514', 'รหัสเครื่องคอมพิวเตอร์ต้องไม่เกิน 50 ตัวอักษร', 'the asset code is limited to 50 characters');
select throws_ok($$ select * from public.app_itrp_create(null, null, 'repair', null, 'computer', null, 'x', false) $$, '23514', 'กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์', 'the device name is required');
select throws_ok($$ select * from public.app_itrp_create(null, '   ', 'repair', null, 'computer', null, 'x', false) $$, '23514', 'กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์', 'a blank device name is refused');
select throws_ok($$ select * from public.app_itrp_create(null, repeat('ก', 201), 'repair', null, 'computer', null, 'x', false) $$, '23514', 'ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ต้องไม่เกิน 200 ตัวอักษร', 'the device name is limited to 200 characters');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', null, null, 'computer', null, 'x', false) $$, '23514', 'กรุณาเลือกประเภทคำขอ', 'the request kind is required');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'bogus', null, 'computer', null, 'x', false) $$, '23514', 'กรุณาเลือกประเภทคำขอ', 'an unknown request kind is refused');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'other', null, 'computer', null, 'x', false) $$, '23514', 'กรุณาระบุประเภทคำขอ (เมื่อเลือก "อื่นๆ")', 'the "other" request kind needs a note');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'other', repeat('ก', 201), 'computer', null, 'x', false) $$, '23514', 'ประเภทคำขอ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร', 'the request kind note is limited to 200 characters');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, null, null, 'x', false) $$, '23514', 'กรุณาเลือกประเภทงานซ่อม', 'the repair target is required');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'bogus', null, 'x', false) $$, '23514', 'กรุณาเลือกประเภทงานซ่อม', 'an unknown repair target is refused');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'other', null, 'x', false) $$, '23514', 'กรุณาระบุประเภทงานซ่อม (เมื่อเลือก "อื่นๆ")', 'the "other" repair target needs a note');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'other', repeat('ก', 201), 'x', false) $$, '23514', 'ประเภทงานซ่อม (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร', 'the repair target note is limited to 200 characters');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'computer', null, null, false) $$, '23514', 'กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น', 'the symptom is required');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'computer', null, '   ', false) $$, '23514', 'กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น', 'a blank symptom is refused');
select throws_ok($$ select * from public.app_itrp_create(null, 'PC', 'repair', null, 'computer', null, repeat('ก', 2001), false) $$, '23514', 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร', 'the symptom is limited to 2000 characters');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select last_seq::int from public.itrp_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 10, 'refused requests did not consume document numbers');

-- 3c. ฟิลด์ทั้งหมดถูกเก็บ (อื่นๆ + ระบุ) และข้อความระบุที่ไม่ใช่ "อื่นๆ" ถูกล้าง ----
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.o11', (select id::text from public.app_itrp_create('  AST-0042  ', '  เครื่องพิมพ์ HP  ', 'other', ' ย้ายเครื่อง ', 'other', ' เครื่องสแกน ', ' เปิดไม่ติด ไฟกะพริบ ', false)), true);
select set_config('t.o11b', (select id::text from public.app_itrp_create(null, 'PC-77', 'inspect', 'ข้อความที่ต้องถูกล้าง', 'device', 'ข้อความที่ต้องถูกล้าง', 'ช้า', false)), true);
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'asset_code', 'AST-0042', 'the asset code is stored trimmed');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'device_name', 'เครื่องพิมพ์ HP', 'the device name is stored trimmed');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'request_kind', 'other', 'the request kind is stored');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'request_kind_note', 'ย้ายเครื่อง', 'the request kind note is stored when "other"');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'repair_target', 'other', 'the repair target is stored');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'repair_target_note', 'เครื่องสแกน', 'the repair target note is stored when "other"');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'symptom', 'เปิดไม่ติด ไฟกะพริบ', 'the symptom is stored trimmed');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->'requester'->>'employee_no', 'ITRP-REQ2', 'the requester is filled in by the system');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->'department'->>'code', 'ZRA', 'the department is filled in by the system');
select ok((public.app_itrp_get_detail(current_setting('t.o11')::uuid)->>'created_at')::timestamptz > now() - interval '1 minute', 'the filing time is filled in by the system');
select is(public.app_itrp_get_detail(current_setting('t.o11b')::uuid)->>'asset_code', null, 'the asset code is optional');
select is(public.app_itrp_get_detail(current_setting('t.o11b')::uuid)->>'request_kind_note', null, 'a note given with a kind other than "other" is cleared');
select is(public.app_itrp_get_detail(current_setting('t.o11b')::uuid)->>'repair_target_note', null, 'a note given with a target other than "other" is cleared');
select ok(not (public.app_itrp_get_detail(current_setting('t.o11')::uuid) ? 'needed_date') and not (public.app_itrp_get_detail(current_setting('t.o11')::uuid) ? 'order_ref') and not (public.app_itrp_get_detail(current_setting('t.o11')::uuid) ? 'access_changes'), 'the detail has no needed date, order reference or access-rights section');

-- 3d. รายการรออนุมัติ (ก่อนมีใครอนุมัติ) --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is((select count(*)::int from public.app_itrp_list_pending_approvals()), 4, 'the department manager sees only the pending requests of the own department (o1, o10, o11, o11b; not the own request)');
select is((select pending_step from public.app_itrp_list_pending_approvals() limit 1), 'dept', 'the department manager is asked for the department step');
select is((select doc_no from public.app_itrp_list_pending_approvals() limit 1), 'IT01-' || pg_temp.yy() || '/010', 'the urgent request is listed first');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select is((select count(*)::int from public.app_itrp_list_pending_approvals()), 5, 'the IT approver sees the requests that wait only for the IT step (o2, o3, o5, o6, o8)');
select is(public.app_itrp_pending_count(), 5, 'the pending badge count matches the list');
select is((select count(*)::int from public.app_itrp_list_pending_approvals() where pending_step = 'it_mgr'), 5, 'all of them are IT steps');
select set_config('request.jwt.claims', pg_temp.sub(14), true);
select is(public.app_itrp_pending_count(), 6, 'an approver who is also the manager of a department sees the own department request as well');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(public.app_itrp_pending_count(), 0, 'a plain staff member has nothing to approve');
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select is(public.app_itrp_pending_count(), 0, 'a system admin without IT rights has nothing to approve');
select set_config('request.jwt.claims', pg_temp.sub(11), true);
select is(public.app_itrp_pending_count(), 0, 'a manager of another department has nothing to approve');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(public.app_itrp_pending_count(), 0, 'the IT admin who is not an approver has nothing to approve either');

-- 4. อนุมัติ / ไม่อนุมัติ -----------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '42501', 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบแจ้งซ่อมที่ตัวเองเป็นผู้แจ้งได้', 'a requester cannot approve the own request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'a colleague of the same department cannot approve');
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'a system admin without IT rights cannot approve (no automatic IT rights)');
select set_config('request.jwt.claims', pg_temp.sub(11), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'a manager of another department cannot approve');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'the IT admin who is not an IT approver cannot approve');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '23514', 'ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'the IT approver must wait for the department manager when the department has one');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_reject(current_setting('t.o1')::uuid, '  ') $$, '23514', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'a rejection needs a reason');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, 'the department manager approves the department step');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.st(current_setting('t.o1')::uuid), 'pending_it_mgr', 'after the department step the request waits for the IT step');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'approvals'->'dept'->>'by', 'ทดสอบ ITRP-MGRA', 'the approval summary names the department manager');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้ผู้จัดการแผนกพิจารณาไปแล้ว', 'the department step cannot be decided twice');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, 'the IT approver approves the IT step');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.st(current_setting('t.o1')::uuid), 'approved', 'both steps done: approved');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created,dept_approved,it_mgr_approved', 'both approvals are recorded in order');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'approvals'->'it_mgr'->>'by', 'ทดสอบ ITRP-APPR', 'the IT approval ("acknowledged by management" on the print) is signed by the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้อนุมัติครบแล้ว', 'an approved request cannot be approved again');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o4')::uuid) $$, 'an assistant department manager can approve the department step');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(public.app_itrp_get_detail(current_setting('t.o4')::uuid)->'events'->1->>'actor_employee_no', 'ITRP-AMGRC', 'the assistant approval is signed by the assistant');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o5')::uuid) $$, 'a department without manager: one click by the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.st(current_setting('t.o5')::uuid), 'approved', 'the request of a department without manager is approved by one click');
select is(pg_temp.acts(current_setting('t.o5')::uuid), 'created,dept_approved,it_mgr_approved', 'one click records both steps');
select ok((public.app_itrp_get_detail(current_setting('t.o5')::uuid)->'approvals'->'dept'->>'reason') like '%ไม่มีผู้จัดการ%', 'the department approval notes that the department has no manager');
select is(public.app_itrp_get_detail(current_setting('t.o5')::uuid)->'approvals'->'dept'->>'by', 'ทดสอบ ITRP-APPR', 'both steps are signed by the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o6')::uuid) $$, 'an IT department request: one click by the IT approver');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o8')::uuid) $$, 'a department whose only manager is inactive: one click by the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select ok((public.app_itrp_get_detail(current_setting('t.o6')::uuid)->'approvals'->'dept'->>'reason') like '%แผนก IT%', 'the IT department approval says why it counts for both steps');
select is(pg_temp.st(current_setting('t.o8')::uuid), 'approved', 'the request of a department with only an inactive manager is approved');
select set_config('request.jwt.claims', pg_temp.sub(14), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o9')::uuid) $$, 'an IT approver who manages the requester department approves with one click');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.acts(current_setting('t.o9')::uuid), 'created,dept_approved,it_mgr_approved', 'one click counts both steps for the manager-approver');
select ok((public.app_itrp_get_detail(current_setting('t.o9')::uuid)->'approvals'->'dept'->>'reason') like '%ผู้อนุมัติเป็นผู้จัดการ%', 'the approval notes that the approver manages the department');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o2')::uuid) $$, 'the IT step of a request signed by the department manager at filing');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o3')::uuid) $$, 'the IT step of a request signed by the assistant at filing');

-- 4b. ไม่อนุมัติ ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select public.app_itrp_reject(current_setting('t.o11')::uuid, 'อาการไม่ชัดเจน') $$, 'the department manager rejects with a reason');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.st(current_setting('t.o11')::uuid), 'rejected', 'a rejection ends the request at once');
select is(pg_temp.acts(current_setting('t.o11')::uuid), 'created,dept_rejected', 'the rejection is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->'events'->1->>'reason', 'อาการไม่ชัดเจน', 'the rejection reason is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o11')::uuid)->'allowed_actions', '[]'::jsonb, 'a rejected request offers no action (it cannot be reopened or cancelled)');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o11')::uuid, 'x') $$, '23514', 'ใบแจ้งซ่อมนี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be cancelled');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o11')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be approved afterwards');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.o12', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_reject(current_setting('t.o12')::uuid, 'ไม่จำเป็นต้องซ่อม') $$, 'the IT approver rejects at the IT step');
select is(pg_temp.acts(current_setting('t.o12')::uuid), 'created,it_mgr_rejected', 'the IT rejection is recorded');
select is(pg_temp.st(current_setting('t.o12')::uuid), 'rejected', 'the IT rejection ends the request');

-- 5. ยกเลิก (ผู้แจ้ง / IT) -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.o13', pg_temp.new_req(), true);
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, '  ') $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิก', 'a cancellation needs a reason');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, repeat('ก', 501)) $$, '23514', 'เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'the cancellation reason is limited to 500 characters');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, 'x') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบแจ้งซ่อมได้', 'a colleague cannot cancel (the request is not theirs)');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, 'x') $$, '42501', 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ', 'the IT admin cannot cancel on behalf of the requester unless the request waits for an answer');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, 'x') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบแจ้งซ่อมได้', 'an IT approver who is not the requester cannot cancel');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, 'แจ้งผิดเครื่อง') $$, 'the requester cancels with a reason');
select is(pg_temp.st(current_setting('t.o13')::uuid), 'cancelled', 'the request is cancelled');
select is(pg_temp.acts(current_setting('t.o13')::uuid), 'created,cancelled', 'the cancellation is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o13')::uuid)->'events'->1->>'reason', 'แจ้งผิดเครื่อง', 'the cancellation reason is recorded');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o13')::uuid, 'อีกครั้ง') $$, '23514', 'ใบแจ้งซ่อมนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be cancelled again');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o13')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be approved');

-- 6. เริ่มดำเนินการ + งานด่วน ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบแจ้งซ่อมได้', 'a requester cannot start the work');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบแจ้งซ่อมได้', 'the IT approver who is not an IT admin cannot start the work (v4 rule)');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select lives_ok($$ select public.app_itrp_start(current_setting('t.o1')::uuid) $$, 'the IT admin starts an approved request');
select is(pg_temp.st(current_setting('t.o1')::uuid), 'in_progress', 'the request is in progress');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created,dept_approved,it_mgr_approved,started', 'the start is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'started'->>'by', 'ทดสอบ ITRP-ADM', 'the start time and person are exposed for the print');
select throws_ok($$ select public.app_itrp_start(current_setting('t.o1')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้เริ่มดำเนินการไปแล้ว', 'a request cannot be started twice');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.o14', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_start(current_setting('t.o14')::uuid) $$, '23514', 'ใบแจ้งซ่อมปกติต้องอนุมัติครบทั้งสองขั้นก่อนจึงจะเริ่มทำได้ (เฉพาะงานด่วนเริ่มก่อนอนุมัติครบได้)', 'a normal request cannot start before both approvals');
select lives_ok($$ select public.app_itrp_start(current_setting('t.o10')::uuid) $$, 'an urgent request can be started before the approvals');
select is(pg_temp.st(current_setting('t.o10')::uuid), 'in_progress', 'the urgent request is in progress');
select throws_ok($$ select pg_temp.done(current_setting('t.o10')::uuid) $$, '23514', 'ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน', 'an urgent request cannot be delivered before both approvals');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select ok(public.app_itrp_get_detail(current_setting('t.o10')::uuid)->'allowed_actions' @> '["approve","reject"]'::jsonb, 'the department manager can still approve an urgent request that is already in progress');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o10')::uuid) $$, 'the department manager approves after the work started');
select is(pg_temp.st(current_setting('t.o10')::uuid), 'in_progress', 'approving does not pull an in-progress request back');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select pg_temp.done(current_setting('t.o10')::uuid) $$, '23514', 'ส่งงานไม่ได้ ต้องรอผู้อนุมัติขั้น IT อนุมัติก่อน', 'an urgent request cannot be delivered before the IT approval either');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o10')::uuid) $$, 'the IT approver approves the urgent request afterwards');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.acts(current_setting('t.o10')::uuid), 'created,started,dept_approved,it_mgr_approved', 'the urgent request keeps the real order of events');

-- 7. ส่งงาน: ตรวจส่วน "สำหรับแผนก IT" ทุกช่อง ------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select pg_temp.done(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'a requester cannot deliver the work');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select pg_temp.done(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'the IT approver who is not an IT admin cannot deliver the work');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select pg_temp.done(current_setting('t.o14')::uuid) $$, '23514', 'ใบแจ้งซ่อมต้องอยู่ในสถานะกำลังดำเนินการ (กดเริ่มทำก่อน) จึงจะส่งงานได้', 'only an in-progress request can be delivered');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, null, 'usage', null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาระบุสาเหตุ', 'the cause is required');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, '   ', 'usage', null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาระบุสาเหตุ', 'a blank cause is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, repeat('ก', 2001), 'usage', null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'สาเหตุต้องไม่เกิน 2,000 ตัวอักษร', 'the cause is limited to 2000 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', null, null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาเลือกสรุปสาเหตุเกิดจาก', 'the cause kind is required');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'bogus', null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาเลือกสรุปสาเหตุเกิดจาก', 'an unknown cause kind is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'other', null, 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาระบุสรุปสาเหตุ (เมื่อเลือก "อื่นๆ")', 'the "other" cause kind needs a note');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'other', repeat('ก', 201), 'internal', null, 'ซ่อม', null, '[]') $$, '23514', 'สรุปสาเหตุ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร', 'the cause kind note is limited to 200 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, null, null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาเลือกการตรวจซ่อม', 'the repair method is required');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'bogus', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาเลือกการตรวจซ่อม', 'an unknown repair method is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'sent_out', null, 'ซ่อม', null, '[]') $$, '23514', 'กรุณาระบุสถานที่ที่ส่งซ่อม', 'sending out for repair needs the place');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'external_onsite', repeat('ก', 201), 'ซ่อม', null, '[]') $$, '23514', 'ชื่อผู้ซ่อม/สถานที่ส่งซ่อมต้องไม่เกิน 200 ตัวอักษร', 'the vendor is limited to 200 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, null, null, '[]') $$, '23514', 'กรุณาระบุการซ่อม-แก้ไขที่เกิดขึ้น', 'the repair action is required');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, repeat('ก', 2001), null, '[]') $$, '23514', 'การซ่อม-แก้ไขที่เกิดขึ้นต้องไม่เกิน 2,000 ตัวอักษร', 'the repair action is limited to 2000 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', repeat('9', 101), '[]') $$, '23514', 'เลขที่ PR./PO. ต้องไม่เกิน 100 ตัวอักษร', 'the PR/PO number is limited to 100 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '{"a":1}') $$, '23514', 'รายการอะไหล่/วัสดุที่ใช้ต้องเป็นรายการ', 'the parts must be a list');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, (select jsonb_agg(jsonb_build_object('item_name', 'x' || n, 'quantity', 1)) from generate_series(1, 11) n)) $$, '23514', 'รายการอะไหล่/วัสดุที่ใช้ต้องไม่เกิน 10 แถว', 'at most 10 parts rows');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '["x"]') $$, '23514', 'แถวที่ 1 ของรายการอะไหล่/วัสดุไม่ถูกต้อง', 'a parts row must be an object');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"quantity": 1}]') $$, '23514', 'แถวที่ 1: กรุณาระบุรายการอะไหล่/วัสดุ', 'a parts row needs the item name');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, jsonb_build_array(jsonb_build_object('item_name', repeat('ก', 201), 'quantity', 1))) $$, '23514', 'แถวที่ 1: ชื่อรายการต้องไม่เกิน 200 ตัวอักษร', 'the item name is limited to 200 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย"}]') $$, '23514', 'แถวที่ 1: กรุณาระบุจำนวน', 'a parts row needs the quantity');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": 0}]') $$, '23514', 'แถวที่ 1: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'the quantity must be greater than 0');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": -1}]') $$, '23514', 'แถวที่ 1: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a negative quantity is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": 1.234}]') $$, '23514', 'แถวที่ 1: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a quantity with 3 decimals is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": "abc"}]') $$, '23514', 'แถวที่ 1: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a non-numeric quantity is refused with the Thai message (no cast error)');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": 1, "price": -5}]') $$, '23514', 'แถวที่ 1: ราคาต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a negative price is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "สาย", "quantity": 1, "price": 1.005}]') $$, '23514', 'แถวที่ 1: ราคาต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a price with 3 decimals is refused');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, jsonb_build_array(jsonb_build_object('item_name', 'สาย', 'quantity', 1, 'note', repeat('ก', 201)))) $$, '23514', 'แถวที่ 1: หมายเหตุต้องไม่เกิน 200 ตัวอักษร', 'the parts note is limited to 200 characters');
select throws_ok($$ select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null, '[{"item_name": "ดี", "quantity": 1}, {"item_name": "สาย", "quantity": "1e3"}]') $$, '23514', 'แถวที่ 2: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'the row number in the message is the position the caller sent');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_repair_reports) + (select count(*)::int from public.itrp_repair_parts) + (select count(*)::int from public.itrp_events where action = 'completed'), 0, 'refused deliveries left no report, parts or completed event behind');
select is((select status from public.itrp_requests where id = current_setting('t.o1')::uuid), 'in_progress', 'and the request is still in progress');

-- 7b. ส่งงานสำเร็จ: บันทึกการซ่อม + อะไหล่ -------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.r1', (select public.app_itrp_complete(current_setting('t.o1')::uuid, '  สายไฟหลวม  ', 'other', ' แมลงกัดสาย ', 'sent_out', ' ร้านซ่อม ABC ', ' ส่งซ่อมที่ร้านและเปลี่ยนสาย ', ' PR-26/001 ',
  '[{"item_name": " สายไฟ ", "quantity": 2, "price": 150.5, "note": " ยาว 2 ม. "}, {"item_name": "", "quantity": "", "price": null, "note": ""}, {"item_name": "น็อต", "quantity": "10.25", "price": null}]'::jsonb))::text, true);
select is(pg_temp.st(current_setting('t.o1')::uuid), 'it_closed', 'delivering moves the request to it_closed');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created,dept_approved,it_mgr_approved,started,completed', 'the delivery is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'id', current_setting('t.r1'), 'the RPC returns the id of the repair report');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'cause', 'สายไฟหลวม', 'the cause is stored trimmed');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'cause_kind', 'other', 'the cause kind is stored');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'cause_kind_note', 'แมลงกัดสาย', 'the cause kind note is stored');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'repair_method', 'sent_out', 'the repair method is stored');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'repair_vendor', 'ร้านซ่อม ABC', 'the place the repair was sent to is stored');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'repair_action', 'ส่งซ่อมที่ร้านและเปลี่ยนสาย', 'the repair action is stored');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'pr_po_no', 'PR-26/001', 'the PR/PO number is stored');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'), 2, 'the blank parts row is skipped');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->0->>'item_name', 'สายไฟ', 'the first part is stored trimmed');
select is((public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->0->>'quantity')::numeric, 2.00, 'the quantity is stored');
select is((public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->0->>'price')::numeric, 150.50, 'the price is stored with 2 decimals');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->0->>'note', 'ยาว 2 ม.', 'the parts note is stored');
select is((public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->1->>'line_no')::int, 2, 'parts lines are numbered in the order sent after skipping blank rows');
select is((public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->1->>'quantity')::numeric, 10.25, 'a quantity sent as text with 2 decimals is accepted');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->'parts'->1->>'price', null, 'the price is optional');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'completed_by_employee_no', 'ITRP-ADM', 'the technician is the person who pressed deliver');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'completed'->>'by', 'ทดสอบ ITRP-ADM', 'the delivery signature names the IT admin');
select ok((public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'completed'->>'at')::timestamptz >= (public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'started'->>'at')::timestamptz, 'the finish time is not before the start time (total time is computed from these two)');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'rework_open', 'false'::jsonb, 'no rework is open yet');
select throws_ok($$ select pg_temp.done(current_setting('t.o1')::uuid) $$, '23514', 'IT ส่งงานใบนี้ไปแล้ว', 'a delivered request cannot be delivered twice');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
-- ซ่อมภายใน / ผู้ซ่อมภายนอก: vendor ถูกล้างเมื่อซ่อมภายใน และเป็นทางเลือกเมื่อเรียกผู้ซ่อมภายนอก
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select set_config('t.o16', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select lives_ok($$ select public.app_itrp_start(current_setting('t.o16')::uuid) $$, 'the IT admin starts a second request (filed by the IT approver, approved at filing)');
select lives_ok($$ select public.app_itrp_complete(current_setting('t.o16')::uuid, 'ก', 'part_expired', null, 'internal', 'ต้องถูกล้าง', 'เปลี่ยนแบตเตอรี่', null) $$, 'a delivery without parts (the default) and an internal repair works');
select is(public.app_itrp_get_detail(current_setting('t.o16')::uuid)->'repair_report'->>'repair_vendor', null, 'an internal repair clears the vendor');
select is(public.app_itrp_get_detail(current_setting('t.o16')::uuid)->'repair_report'->>'cause_kind_note', null, 'a cause kind note given with a kind other than "other" is cleared');
select is(public.app_itrp_get_detail(current_setting('t.o16')::uuid)->'repair_report'->'parts', '[]'::jsonb, 'no parts means an empty list');

-- 8. ขอแก้ไข -> ส่งงานรอบสอง · ยืนยันรับงาน ----------------------------------
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, 'x', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้', 'a colleague cannot ask for a rework');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, '  ', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, '23514', 'กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข', 'a rework needs details');
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, repeat('ก', 2001), ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, '23514', 'รายละเอียดที่ต้องการให้แก้ไขต้องไม่เกิน 2,000 ตัวอักษร', 'the rework details are limited to 2000 characters');
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, 'ยังเสียอยู่', null) $$, '23514', 'กรุณาระบุวันที่ต้องการให้แก้ไขเสร็จ', 'a rework needs the due date');
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, 'ยังเสียอยู่', ((now() at time zone 'Asia/Bangkok')::date - 1)) $$, '23514', 'วันที่ต้องการให้แก้ไขเสร็จต้องไม่ใช่วันที่ผ่านมาแล้ว', 'the rework due date cannot be in the past (Thai date)');
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o14')::uuid, 'ยังเสียอยู่', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, '23514', 'ขอแก้ไขงานได้เมื่อ IT ส่งงานแล้วเท่านั้น', 'a rework can be asked only after the delivery');
select ok(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'allowed_actions' @> '["receive","request_rework"]'::jsonb, 'after the delivery the requester can receive or ask for a rework');
select ok(not (public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'allowed_actions' ? 'cancel'), 'and cannot cancel (receiving is the final step once IT delivered)');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o1')::uuid, 'ไม่เอาแล้ว') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'a delivered request cannot be cancelled by the requester');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o1')::uuid, 'x') $$, '42501', 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ', 'IT cannot cancel a delivered request either');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, 'ยังเปิดไม่ติด', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the requester asks for a rework');
select is(pg_temp.st(current_setting('t.o1')::uuid), 'in_progress', 'the rework goes back to IT at once without new approvals');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created,dept_approved,it_mgr_approved,started,completed,rework_requested', 'the rework request is recorded');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'rework_round', '1', 'the rework round is counted');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'latest_due_date', to_char((now() at time zone 'Asia/Bangkok')::date + 2, 'YYYY-MM-DD'), 'the latest due date is the rework due date');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'rework_open', 'true'::jsonb, 'a rework is open (the "sent back for repair" box of the print)');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o1')::uuid, 'x') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'a request in a rework round cannot be cancelled either');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is((select count(*)::int from public.app_itrp_list_it() where id = current_setting('t.o1')::uuid and rework_round = 1 and status = 'in_progress'), 1, 'the IT list shows the request back in progress with the rework round');
select set_config('t.r2', (select public.app_itrp_complete(current_setting('t.o1')::uuid, 'ขั้วต่อเสีย', 'usage', null, 'external_onsite', null, 'เรียกช่างมาเปลี่ยนขั้วต่อ', null, '[{"item_name": "ขั้วต่อ", "quantity": 1, "price": 99}]'::jsonb))::text, true);
select is(pg_temp.st(current_setting('t.o1')::uuid), 'it_closed', 'IT delivers again after the rework');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'rework_open', 'false'::jsonb, 'the rework is no longer open after the second delivery');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_reports'), 2, 'the second delivery created a new report and the old one is kept as history');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'id', current_setting('t.r2'), 'the latest report is the one shown and printed');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_reports'->0->>'id', current_setting('t.r1'), 'the first report is first in the history');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_reports'->0->>'cause', 'สายไฟหลวม', 'the first report keeps its own content');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_reports'->0->'parts'), 2, 'and its own parts');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'repair_vendor', null, 'the second report has its own repair method data (external repairer without a name)');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'completed'->>'at', public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'repair_report'->>'completed_at', 'the "finished" time is the latest completed event');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_receive(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้', 'a colleague cannot receive the work');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_receive(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้', 'even the department manager cannot receive the work (the requester only)');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_receive(current_setting('t.o14')::uuid) $$, '23514', 'ยังยืนยันรับงานไม่ได้ เพราะ IT ยังไม่ส่งงาน', 'the work cannot be received before IT delivered it');
select lives_ok($$ select public.app_itrp_receive(current_setting('t.o1')::uuid) $$, 'the requester confirms receiving the work');
select is(pg_temp.st(current_setting('t.o1')::uuid), 'received', 'the request is finished');
select is(pg_temp.acts(current_setting('t.o1')::uuid), 'created,dept_approved,it_mgr_approved,started,completed,rework_requested,completed,received', 'the full history is kept in order');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'received'->>'by', 'ทดสอบ ITRP-REQ1', 'the receipt signature on the print is the requester');
select throws_ok($$ select public.app_itrp_receive(current_setting('t.o1')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้ยืนยันรับงานไปแล้ว', 'the work cannot be received twice');
select throws_ok($$ select public.app_itrp_request_rework(current_setting('t.o1')::uuid, 'อีก', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, '23514', 'ใบแจ้งซ่อมนี้จบงานแล้ว (ได้รับงานแล้ว) ขอแก้ไขไม่ได้', 'a finished request cannot get a rework');
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'a finished request offers no action');

-- 9. ถามผู้แจ้ง / ตอบ ------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, '  ') $$, '23514', 'กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง', 'a question needs text');
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, repeat('ก', 2001)) $$, '23514', 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร', 'a question is limited to 2000 characters');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, 'ถามตัวเอง') $$, '42501', 'ผู้แจ้งถามกลับใบแจ้งซ่อมของตัวเองไม่ได้', 'the requester cannot ask the own request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, 'ถาม') $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'a colleague who cannot see the request cannot ask');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, 'ถาม') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบแจ้งซ่อมนี้ในขั้นตอนนี้', 'the IT approver cannot ask while the department step is still pending');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select ok(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'allowed_actions' @> '["approve","reject","request_info"]'::jsonb, 'the department manager can approve, reject or ask');
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, 'เครื่องเสียตอนไหน') $$, 'the department manager asks the requester');
select is(pg_temp.st(current_setting('t.o14')::uuid), 'need_info', 'the request waits for the requester');
select is(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->>'info_return_status', 'pending_dept', 'it remembers the status to go back to');
select is(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'info_pending'->>'stage', 'dept', 'the pending question is a department-step question');
select throws_ok($$ select public.app_itrp_request_info(current_setting('t.o14')::uuid, 'อีกข้อ') $$, '23514', 'ใบแจ้งซ่อมนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ', 'a second question waits for the answer');
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o14')::uuid) $$, '23514', 'ใบแจ้งซ่อมนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'nobody can approve while the question waits');
select throws_ok($$ select public.app_itrp_reject(current_setting('t.o14')::uuid, 'ไม่ผ่าน') $$, '23514', 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน', 'nobody can reject while the question waits (v1.02)');
select ok(not (public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'allowed_actions' ?| array['approve', 'reject', 'request_info']), 'the approve/reject/ask buttons are hidden while the question waits');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_provide_info(current_setting('t.o14')::uuid, 'ตอบ') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้', 'only the requester can answer');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select ok(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'allowed_actions' @> '["provide_info","cancel"]'::jsonb, 'the requester can answer or cancel while the question waits');
select throws_ok($$ select public.app_itrp_provide_info(current_setting('t.o14')::uuid, '  ') $$, '23514', 'กรุณาพิมพ์คำตอบ', 'an answer needs text');
select lives_ok($$ select public.app_itrp_provide_info(current_setting('t.o14')::uuid, 'เมื่อเช้า เปิดไม่ติด') $$, 'the requester answers');
select is(pg_temp.st(current_setting('t.o14')::uuid), 'pending_dept', 'the request goes back to the step it was in');
select is(pg_temp.acts(current_setting('t.o14')::uuid), 'created,info_requested,info_provided', 'the question and the answer are recorded');
select is(jsonb_array_length(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'comments'), 2, 'the question and the answer are both shown');
select is(public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'comments'->1->>'reply_to', public.app_itrp_get_detail(current_setting('t.o14')::uuid)->'comments'->0->>'id', 'the answer points to the question');
select throws_ok($$ select public.app_itrp_provide_info(current_setting('t.o14')::uuid, 'อีก') $$, '23514', 'ใบแจ้งซ่อมนี้ไม่มีคำถามที่รอตอบ', 'no second answer');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.o14')::uuid) $$, 'the department manager approves after the answer');
-- ทีม IT ถามหลังอนุมัติ (ใบ o7 อนุมัติครบตอนแจ้ง) แล้ว IT ยกเลิกแทนผู้แจ้งที่ไม่ตอบ
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select ok(public.app_itrp_get_detail(current_setting('t.o7')::uuid)->'allowed_actions' @> '["start","request_info"]'::jsonb, 'the IT admin can start or ask an approved request');
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.o7')::uuid, 'ขอรหัสเครื่องด้วย') $$, 'the IT admin asks after the approvals');
select is(public.app_itrp_get_detail(current_setting('t.o7')::uuid)->'info_pending'->>'stage', 'it', 'it is an IT-team question');
select is(public.app_itrp_get_detail(current_setting('t.o7')::uuid)->>'info_return_status', 'approved', 'it goes back to approved');
select ok(public.app_itrp_get_detail(current_setting('t.o7')::uuid)->'allowed_actions' @> '["cancel"]'::jsonb, 'the IT admin may cancel on behalf of the requester while the question waits');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o7')::uuid, '  ') $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิก', 'cancelling on behalf needs a reason');
select throws_ok($$ select public.app_itrp_cancel(current_setting('t.o7')::uuid, repeat('ก', 500)) $$, '23514', 'เหตุผลต้องไม่เกิน ' || (500 - char_length('IT ยกเลิกแทนผู้แจ้ง: ')) || ' ตัวอักษร', 'the on-behalf reason leaves room for the prefix');
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.o7')::uuid, 'ผู้แจ้งไม่ตอบ') $$, 'the IT admin cancels on behalf of the requester');
select is(pg_temp.st(current_setting('t.o7')::uuid), 'cancelled', 'the request is cancelled');
select ok((public.app_itrp_get_detail(current_setting('t.o7')::uuid)->'events'->4->>'reason') like 'IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้งไม่ตอบ', 'the history says IT cancelled on behalf of the requester');
select is(public.app_itrp_get_detail(current_setting('t.o7')::uuid)->'events'->4->>'actor_employee_no', 'ITRP-ADM', 'signed by the IT admin');
-- ผู้แจ้งตอบแล้วกลับ approved: ใช้ใบ o5 (อนุมัติครบ) กับ IT ถาม แล้วผู้แจ้ง (REQB) ตอบ
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.o5')::uuid, 'ขอรูปอาการ') $$, 'IT asks about another approved request');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_provide_info(current_setting('t.o5')::uuid, 'ส่งรูปแล้ว') $$, 'the requester answers the IT question');
select is(pg_temp.st(current_setting('t.o5')::uuid), 'approved', 'the request is back to approved');

-- 10. การมองเห็นของแต่ละบทบาท + การเข้าถึงตรง -------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague of the same department cannot see someone else''s request');
select set_config('request.jwt.claims', pg_temp.sub(11), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a manager of another department cannot see the request');
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a system admin without IT rights cannot see the request');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/001', 'the manager of the requester department sees the request');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/001', 'the IT approver sees every request');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(public.app_itrp_get_detail(current_setting('t.o1')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/001', 'the IT admin sees every request');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.app_itrp_list_it() $$, '42501', 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'a requester cannot open the IT list');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select * from public.app_itrp_list_it() $$, '42501', 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'a department manager cannot open the IT list');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is((select count(*)::int from public.app_itrp_list_it()), 16, 'the IT admin list holds every real request');
select is((select doc_no from public.app_itrp_list_it() limit 1), 'IT01-' || pg_temp.yy() || '/010', 'the urgent request is on top of the IT list');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select is((select count(*)::int from public.app_itrp_list_it()), 16, 'the IT approver (head of IT) sees the same IT list');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select ok(public.app_itrp_my_role()->>'is_it_admin' = 'true' and public.app_itrp_my_role()->>'is_it_approver' = 'false', 'my_role: the IT admin is an admin but not an approver');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select ok(public.app_itrp_my_role()->>'is_it_admin' = 'false' and public.app_itrp_my_role()->>'is_it_approver' = 'true', 'my_role: the IT approver is an approver but not an admin');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select ok(public.app_itrp_my_role()->>'is_dept_approver' = 'true' and public.app_itrp_my_role()->'department'->>'code' = 'ZRA', 'my_role: a department manager is a department approver of the own department');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select ok(public.app_itrp_my_role()->>'is_it_department' = 'true' and public.app_itrp_my_role()->>'is_it_admin' = 'false', 'my_role: a member of the IT department gets no IT rights automatically');
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select is(public.app_itrp_my_role()->>'is_it_admin', 'false', 'my_role: a system admin does not get IT rights automatically');
-- lab-only / anon / เขียนตรง
select set_config('request.jwt.claims', pg_temp.sub(17), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot open the module');
select throws_ok($$ select public.app_itrp_create(null, 'PC', 'repair', null, 'computer', null, 'x', false) $$, '42501', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot file a request');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.itrp_requests $$, '42501', 'permission denied for table itrp_requests', 'a signed-in user cannot read the table directly');
select throws_ok($$ insert into public.itrp_events (request_id, actor_id, action) values (current_setting('t.o1')::uuid, (select id from public.employees where employee_no = 'ITRP-REQ1'), 'received') $$, '42501', 'permission denied for table itrp_events', 'a signed-in user cannot write an event directly');
select throws_ok($$ update public.itrp_requests set status = 'received' $$, '42501', 'permission denied for table itrp_requests', 'a signed-in user cannot change a status directly');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) values (current_setting('t.o1')::uuid, 1, 'x', 'usage', 'internal', 'x', (select id from public.employees where employee_no = 'ITRP-REQ1')) $$, '42501', 'permission denied for table itrp_repair_reports', 'a signed-in user cannot write a repair report directly');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.app_itrp_list_mine() $$, '42501', 'permission denied for function app_itrp_list_mine', 'anon cannot call an itrp RPC');
select throws_ok($$ select * from public.itrp_requests $$, '42501', 'permission denied for table itrp_requests', 'anon cannot read the table');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.app_itrp_list_mine() $$, '42501', 'กรุณาเข้าสู่ระบบ', 'a request without a session is refused');
reset role;
select set_config('request.jwt.claims', '', true);

-- 11. ISO: ประวัติแก้/ลบ/ล้างไม่ได้ · ตารางของใบ · CHECK -----------------------
select throws_ok($$ update public.itrp_events set reason = 'x' where id = (select min(id) from public.itrp_events) $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'history cannot be updated');
select throws_ok($$ delete from public.itrp_events where id = (select min(id) from public.itrp_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'history cannot be deleted');
select throws_ok($$ truncate public.itrp_events cascade $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'history cannot be truncated');
select throws_ok($$ update public.itrp_repair_reports set cause = 'แก้ย้อนหลัง' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a repair report cannot be updated');
select throws_ok($$ delete from public.itrp_repair_reports $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a repair report cannot be deleted');
select throws_ok($$ truncate public.itrp_repair_reports cascade $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'repair reports cannot be truncated');
select throws_ok($$ update public.itrp_repair_parts set quantity = 99 $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a parts row cannot be updated');
select throws_ok($$ delete from public.itrp_repair_parts $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a parts row cannot be deleted');
select throws_ok($$ truncate public.itrp_repair_parts $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'parts cannot be truncated');
select throws_ok($$ update public.itrp_reworks set details = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a rework round cannot be updated');
select throws_ok($$ delete from public.itrp_reworks $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a rework round cannot be deleted');
select throws_ok($$ update public.itrp_comments set body = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a question/answer cannot be updated');
select throws_ok($$ delete from public.itrp_comments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a question/answer cannot be deleted');
select throws_ok($$ delete from public.itrp_requests where id = current_setting('t.o1')::uuid $$, '42501', 'ใบแจ้งซ่อมลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)', 'a request cannot be deleted');
select throws_ok($$ truncate public.itrp_requests cascade $$, '42501', 'ใบแจ้งซ่อมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'requests cannot be truncated');
select throws_ok($$ update public.itrp_requests set symptom = 'แก้ย้อนหลัง' where id = current_setting('t.o1')::uuid $$, '42501', 'ใบแจ้งซ่อมแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)', 'the content of a request cannot be changed');
select throws_ok($$ update public.itrp_requests set device_name = 'อื่น' where id = current_setting('t.o1')::uuid $$, '42501', 'ใบแจ้งซ่อมแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)', 'the device name of a request cannot be changed');
select throws_ok($$ update public.itrp_requests set status = 'in_progress' where id = current_setting('t.o1')::uuid $$, '23514', 'เปลี่ยนสถานะใบแจ้งซ่อมจาก received เป็น in_progress ไม่ได้', 'a finished request cannot be reopened');
select throws_ok($$ update public.itrp_requests set status = 'pending_dept' where id = current_setting('t.o13')::uuid $$, '23514', 'เปลี่ยนสถานะใบแจ้งซ่อมจาก cancelled เป็น pending_dept ไม่ได้', 'a cancelled request cannot be reopened');
select throws_ok($$ update public.itrp_requests set status = 'approved' where id = current_setting('t.o12')::uuid $$, '23514', 'เปลี่ยนสถานะใบแจ้งซ่อมจาก rejected เป็น approved ไม่ได้', 'a rejected request cannot be reopened');
select throws_ok($$ update public.itrp_requests set status = 'received' where id = current_setting('t.o14')::uuid $$, '23514', 'เปลี่ยนสถานะใบแจ้งซ่อมจาก pending_it_mgr เป็น received ไม่ได้', 'a status cannot skip the delivery step');
select throws_ok($$ update public.itrp_requests set status = 'need_info' where id = current_setting('t.o14')::uuid $$, '23514', 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (pending_it_mgr) ไว้เป็นสถานะที่จะกลับไป', 'waiting for an answer needs the status to return to');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select r.id, (select min(id) from public.itrp_events where action = 'started'), 'x', 'usage', 'internal', 'x', r.requester_id from public.itrp_requests r where r.id = current_setting('t.o1')::uuid $$, '23514', 'บันทึกการซ่อมต้องผูกกับเหตุการณ์ส่งงานของใบเดียวกันและผู้ส่งงานคนเดียวกัน', 'a repair report must point at a completed event of the same request');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select e.request_id, e.id, 'x', 'usage', 'internal', 'x', e.actor_id from public.itrp_events e where e.action = 'started' limit 1 $$, '23514', 'บันทึกการซ่อมต้องผูกกับเหตุการณ์ส่งงานของใบเดียวกันและผู้ส่งงานคนเดียวกัน', 'a repair report cannot hang on an event that is not a delivery');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select e.request_id, e.id, 'x', 'usage', 'internal', 'x', (select id from public.employees where employee_no = 'ITRP-REQ1') from public.itrp_events e where e.action = 'completed' limit 1 $$, '23514', 'บันทึกการซ่อมต้องผูกกับเหตุการณ์ส่งงานของใบเดียวกันและผู้ส่งงานคนเดียวกัน', 'a repair report must be written by the person who delivered');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select e.request_id, e.id, 'x', 'usage', 'internal', 'x', e.actor_id from public.itrp_events e where e.action = 'completed' limit 1 $$, '23505', null, 'one delivery has only one report (unique)');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select e.request_id, e.id, 'x', 'usage', 'sent_out', 'x', e.actor_id from public.itrp_events e where e.action = 'completed' limit 1 $$, '23514', null, 'the table itself refuses "sent out" without a place');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_vendor, repair_action, created_by) select e.request_id, e.id, 'x', 'usage', 'internal', 'ร้าน', 'x', e.actor_id from public.itrp_events e where e.action = 'completed' limit 1 $$, '23514', null, 'the table itself refuses an outside repairer on an internal repair');
select throws_ok($$ insert into public.itrp_repair_reports (request_id, completed_event_id, cause, cause_kind, repair_method, repair_action, created_by) select e.request_id, e.id, 'x', 'other', 'internal', 'x', e.actor_id from public.itrp_events e where e.action = 'completed' limit 1 $$, '23514', null, 'the table itself refuses cause kind "other" without a note');
select throws_ok($$ insert into public.itrp_requests (doc_no, doc_year, doc_seq, requester_id, department_id, device_name, request_kind, repair_target, symptom) select 'X-1', 2026, 900, requester_id, department_id, 'PC', 'other', 'computer', 'x' from public.itrp_requests limit 1 $$, '23514', null, 'the table itself refuses request kind "other" without a note');
select throws_ok($$ insert into public.itrp_requests (doc_no, doc_year, doc_seq, requester_id, department_id, device_name, request_kind, request_kind_note, repair_target, symptom) select 'X-2', 2026, 901, requester_id, department_id, 'PC', 'repair', 'x', 'computer', 'x' from public.itrp_requests limit 1 $$, '23514', null, 'the table itself refuses a kind note on a kind other than "other"');
select throws_ok($$ insert into public.itrp_requests (doc_no, doc_year, doc_seq, requester_id, department_id, device_name, request_kind, repair_target, repair_target_note, symptom) select 'X-3', 2026, 902, requester_id, department_id, 'PC', 'repair', 'computer', 'x', 'x' from public.itrp_requests limit 1 $$, '23514', null, 'the table itself refuses a target note on a target other than "other"');
select throws_ok($$ insert into public.itrp_requests (doc_no, doc_year, doc_seq, requester_id, department_id, device_name, request_kind, repair_target, symptom) select 'X-4', 2026, 903, requester_id, department_id, 'PC', 'access', 'computer', 'x' from public.itrp_requests limit 1 $$, '23514', null, 'the old request type "access" does not exist in this module');
select throws_ok($$ insert into public.itrp_repair_parts (report_id, line_no, item_name, quantity) select id, 3, 'x', 0 from public.itrp_repair_reports limit 1 $$, '23514', null, 'the table itself refuses a quantity of 0');
select throws_ok($$ insert into public.itrp_repair_parts (report_id, line_no, item_name, quantity) select id, 11, 'x', 1 from public.itrp_repair_reports limit 1 $$, '23514', null, 'the table itself refuses a 11th parts row');
select throws_ok($$ insert into public.itrp_repair_parts (report_id, line_no, item_name, quantity, price) select id, 3, 'x', 1, -1 from public.itrp_repair_reports limit 1 $$, '23514', null, 'the table itself refuses a negative price');

-- 12. เลขเอกสาร: ไม่ซ้ำ ปีตามเวลาไทย ตั้งเลขถัดไปเดินหน้าอย่างเดียว --------------
select is((select count(distinct doc_no)::int from public.itrp_requests), (select count(*)::int from public.itrp_requests), 'every document number is unique');
select is((select year_ce from private.itrp_next_doc_no(false, '2031-01-01 00:30:00+07'::timestamptz)), 2031, 'just after midnight Thai time on 1 January the year is the new one');
select is((select doc_no from private.itrp_next_doc_no(false, '2030-12-31 20:00:00+00'::timestamptz)), 'IT01-31/002', '20:00 UTC on 31 December is already the next year in Thailand and keeps counting that year');
select is((select doc_no from private.itrp_next_doc_no(true, '2031-06-01 00:00:00+07'::timestamptz)), 'TEST-IT01-31/001', 'a test number starts with TEST- and has its own counter');
select is(private.itrp_format_doc_no(false, 2026, 1234), 'IT01-26/1234', 'a number above 999 is shown in full');
select is(private.itrp_format_doc_no(false, 2026, 5), 'IT01-26/005', 'the sequence is padded to 3 digits');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_get_doc_counter() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้', 'a requester cannot read the counter');
select throws_ok($$ select public.app_itrp_set_next_doc_seq(50) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'a requester cannot set the next number');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_set_next_doc_seq(50) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'the IT approver who is not an IT admin cannot set the next number');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(public.app_itrp_get_doc_counter()->>'next_doc_no', 'IT01-' || pg_temp.yy() || '/017', 'the counter shows the next number');
select throws_ok($$ select public.app_itrp_set_next_doc_seq(0) $$, '23514', 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999', 'the next number must be between 1 and 9999');
select throws_ok($$ select public.app_itrp_set_next_doc_seq(10000) $$, '23514', 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999', 'the next number is limited to 9999');
select throws_ok($$ select public.app_itrp_set_next_doc_seq(10) $$, '23514', 'ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง 16, เลขถัดไปต้องไม่น้อยกว่า 17)', 'the number cannot go back or collide with a used one');
select throws_ok($$ select public.app_itrp_set_next_doc_seq(50, extract(year from now() at time zone 'Asia/Bangkok')::int + 2) $$, '23514', 'ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า', 'only this year or next year can be set');
select is(public.app_itrp_set_next_doc_seq(17)->>'next_doc_no', 'IT01-' || pg_temp.yy() || '/017', 'setting the number that is already next changes nothing');
select is(public.app_itrp_set_next_doc_seq(50)->>'next_doc_no', 'IT01-' || pg_temp.yy() || '/050', 'the next number can move forward (to continue after the paper register)');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.o17', pg_temp.new_req(), true);
select is(public.app_itrp_get_detail(current_setting('t.o17')::uuid)->>'doc_no', 'IT01-' || pg_temp.yy() || '/050', 'the next filing gets the number that was set');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_admin_log where action = 'doc_seq_set' and not is_test), 1, 'the number change is written to the admin log');
select throws_ok($$ update public.itrp_admin_log set detail = '{}' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be changed');
select throws_ok($$ delete from public.itrp_admin_log $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be deleted');

-- 13. รายชื่อทีม IT (อ่านอย่างเดียว) + itwo ไม่ถูกกระทบ ------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.app_itrp_list_staff() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'a requester cannot list the IT team');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select ok((select bool_or(employee_no = 'ITRP-ADM' and is_it_admin and not is_it_approver) and bool_or(employee_no = 'ITRP-APPR' and is_it_approver and not is_it_admin) from public.app_itrp_list_staff()), 'the IT admin sees the IT team as stored in itwo_staff (read-only)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::text from public.itwo_staff), (current_setting('t.itwo_staff_before')::int + 3)::text, 'itwo_staff holds only the three rows this test added (the module never wrote to it)');
select is((select count(*)::int from public.itwo_work_orders), current_setting('t.itwo_orders_before')::int, 'no itwo work order was created or touched');
select is((select count(*)::int from public.itwo_doc_counters where doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int and not is_test), 0, 'the itwo document counter did not move (itrp numbers come from itrp_doc_counters)');
select is((select count(*)::int from public.itwo_events) + (select count(*)::int from public.itwo_admin_log), current_setting('t.itwo_log_before')::int, 'no itwo history row was written');

-- 14. โหมดทดสอบ ----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(16), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zr_staff')::uuid) $$, 'the admin enters the test mode as a department staff persona');
select is(public.app_itrp_my_role()->>'is_test', 'true', 'the module recognizes the test mode');
select set_config('t.t1', pg_temp.new_req(), true);
select is(public.app_itrp_get_detail(current_setting('t.t1')::uuid)->>'doc_no', 'TEST-IT01-' || pg_temp.yy() || '/001', 'a test request gets a TEST- number from its own counter');
select is(public.app_itrp_get_detail(current_setting('t.t1')::uuid)->>'is_test', 'true', 'the request is flagged as a test request');
select is(pg_temp.st(current_setting('t.t1')::uuid), 'pending_dept', 'the test department manager persona is the approver of the department');
select is((select count(*)::int from public.app_itrp_list_mine()), 1, 'the persona sees only test requests');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zr_mgr')::uuid) $$, 'switching to the manager persona');
select is(public.app_itrp_pending_count(), 1, 'the persona manager has the test request pending');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.t1')::uuid) $$, 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switching to the IT approver persona');
select is((select count(*)::int from public.app_itrp_list_pending_approvals()), 1, 'the IT approver persona sees the test request only (not the real ones)');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.t1')::uuid) $$, 'the IT approver persona approves');
select is(pg_temp.st(current_setting('t.t1')::uuid), 'approved', 'approved in the test world');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select is((select count(*)::int from public.app_itrp_list_it()), 1, 'the IT list in test mode holds test requests only');
select lives_ok($$ select public.app_itrp_start(current_setting('t.t1')::uuid) $$, 'IT admin persona starts');
select lives_ok($$ select pg_temp.done(current_setting('t.t1')::uuid) $$, 'IT admin persona delivers with a repair report');
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a persona cannot see a real request');
select throws_ok($$ select public.app_itrp_approve(current_setting('t.o17')::uuid) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'a persona cannot decide a real request');
select is(public.app_itrp_set_next_doc_seq(10)->>'next_doc_no', 'TEST-IT01-' || pg_temp.yy() || '/010', 'the next number can be set for the test counter');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zr_staff')::uuid) $$, 'back to the requester persona');
select lives_ok($$ select public.app_itrp_receive(current_setting('t.t1')::uuid) $$, 'the requester persona confirms receipt');
select is(pg_temp.st(current_setting('t.t1')::uuid), 'received', 'the test request is finished');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'the IT department requester persona');
select set_config('t.t2', pg_temp.new_req(), true);
select is(public.app_itrp_get_detail(current_setting('t.t2')::uuid)->>'doc_no', 'TEST-IT01-' || pg_temp.yy() || '/010', 'the test number continues from the value that was set');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'IT approver persona again');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.t2')::uuid) $$, 'one click for the IT department test request');
select is(pg_temp.acts(current_setting('t.t2')::uuid), 'created,dept_approved,it_mgr_approved', 'one click recorded both steps in the test world');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_itrp_get_detail(current_setting('t.t1')::uuid) $$, '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a real user cannot see a test request');
select is((select count(*)::int from public.app_itrp_list_mine()), 3, 'real lists never include test requests (o1, o10, o14)');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.t1')::uuid) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'a real manager cannot decide a test request');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is((select count(*)::int from public.app_itrp_list_it()), 17, 'the real IT list never includes test requests');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_requests where not is_test), 17, 'the real requests are unchanged by the test mode');
select is((select last_seq::int from public.itrp_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 50, 'the real counter did not move');
select is((select last_seq::int from public.itrp_doc_counters where is_test = true and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 10, 'the test counter is separate');
select ok((select count(*) from public.itrp_events where is_test) >= 9 and not exists (select 1 from public.itrp_events e join public.itrp_requests r on r.id = e.request_id where e.is_test <> r.is_test), 'test events are flagged as test and never mix with real requests');
select is((select count(*)::int from public.itrp_repair_reports where is_test), 1, 'the test repair report is flagged as test');
select is((select count(*)::int from public.itrp_repair_parts where is_test), 0, 'the test delivery had no parts');
select is((select count(*)::int from public.itrp_admin_log where is_test and action = 'doc_seq_set'), 1, 'the test counter change is logged as a test row');

-- 14b. ล้างข้อมูลทดสอบ ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_sandbox_purge_itrp() $$, null, 'NOT_AUTHORIZED', 'a normal user cannot purge');
select set_config('request.jwt.claims', pg_temp.sub(16), true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select throws_ok($$ select public.app_sandbox_purge_itrp() $$, null, 'SANDBOX_NOT_ACTIVE', 'the purge only works from inside the test mode');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zr_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itrp()->>'deleted')::int, 15, 'the purge deletes every test row (2 requests, 9 events, 1 repair report, 1 log row, 2 counters)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_requests where is_test) + (select count(*)::int from public.itrp_events where is_test) + (select count(*)::int from public.itrp_reworks where is_test) + (select count(*)::int from public.itrp_comments where is_test) + (select count(*)::int from public.itrp_attachments where is_test) + (select count(*)::int from public.itrp_repair_reports where is_test) + (select count(*)::int from public.itrp_repair_parts where is_test) + (select count(*)::int from public.itrp_admin_log where is_test) + (select count(*)::int from public.itrp_doc_counters where is_test), 0, 'no test row is left in any itrp table');
select is((select count(*)::int from public.itrp_requests where not is_test), 17, 'the real requests survived the purge');
select is((select count(*)::int from public.itrp_repair_reports where not is_test), 3, 'the real repair reports survived the purge (o1 twice, o16 once)');
select is((select count(*)::int from public.itrp_admin_log where not is_test), 1, 'the real admin log survived the purge');
select is((select count(*)::int from public.audit_logs where action = 'ITRP_SANDBOX_PURGE'), 1, 'the purge is written to the audit log');
select is(current_setting('itrp.purge', true), 'off', 'the purge flag is switched off again');
select throws_ok($$ delete from public.itrp_events where id = (select min(id) from public.itrp_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real history still cannot be deleted after a purge');
select throws_ok($$ delete from public.itrp_repair_reports where not is_test $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real repair reports still cannot be deleted after a purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(16), true);
select set_config('t.t3', pg_temp.new_req(), true);
select is(public.app_itrp_get_detail(current_setting('t.t3')::uuid)->>'doc_no', 'TEST-IT01-' || pg_temp.yy() || '/001', 'after the purge the test numbering starts again at 001');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode at the end');
reset role;
select set_config('request.jwt.claims', '', true);

select * from finish();
rollback;
