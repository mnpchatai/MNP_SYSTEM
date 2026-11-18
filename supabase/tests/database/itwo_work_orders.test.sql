-- ทดสอบโมดูลใบสั่งงาน IT (20261202010000_itwo_work_orders.sql)
--   1) โครงสร้าง: RLS ทุกตาราง, ไม่มีสิทธิ์เขียน/อ่านตรง, RPC เป็น SECURITY DEFINER + search_path ว่าง + anon เรียกไม่ได้, ด่าน lab-only, โหมดทดสอบ
--   2) การแจ้งงานและเส้นทางอนุมัติ: ผจก./ผู้ช่วยแผนก, แผนกไม่มีผู้จัดการ -> ผู้อนุมัติขั้น IT กดครั้งเดียว, แผนก IT, ผู้อนุมัติขั้น IT แจ้งเอง
--   3) อนุมัติ/ไม่อนุมัติ/ยกเลิก/เริ่ม/ปิดงาน/ยืนยันรับ, งานด่วน, ส่วนสิทธิ์ในระบบ, การมองเห็น, admin คนอื่นไม่มีสิทธิ์ IT
--   4) ISO: events/admin_log แก้-ลบ-ล้างไม่ได้, ใบลบไม่ได้และเปลี่ยนสถานะได้เฉพาะตามตาราง
--   5) เลขเอกสาร: ไม่ซ้ำ, ปีตามเวลาไทย, ตั้งเลขถัดไปเดินหน้าอย่างเดียว · จัดการ itwo_staff
--   6) โหมดทดสอบ: แยกข้อมูล/เลขที่ TEST-, ผู้อนุมัติแผนกมาจาก persona, ล้างข้อมูลทดสอบโดยไม่แตะของจริง
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITWO-*) ในแผนกทดสอบ ZT* ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration
begin;

create extension if not exists pgtap with schema extensions;
select plan(312);

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itwo\_%' and c.relkind = 'r' and c.relrowsecurity), 6, 'RLS is enabled on all six itwo tables');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itwo\_%' and c.relkind = 'r'), 6, 'the module has exactly the six documented tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name like 'itwo\_%' and g.grantee in ('anon', 'authenticated', 'PUBLIC')), 'anon, authenticated and PUBLIC have no direct grant on any itwo table');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itwo\_%' and p.polname like '%\_no\_direct\_access'), 6, 'every itwo table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itwo\_%' and p.polname = 'lab_only_no_access' and not p.polpermissive), 6, 'every itwo table has the restrictive lab-only policy');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itwo_work_orders', 'itwo_events', 'itwo_access_changes', 'itwo_doc_counters', 'itwo_admin_log']) t), 'the five test-mode aware tables are registered in private.sandbox_unguarded_tables()');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.itwo_staff'::regclass and t.tgname = 'sandbox_guard' and not t.tgisinternal) and not ('itwo_staff' = any (private.sandbox_unguarded_tables())), 'itwo_staff is blocked while an admin is in test mode (sandbox_guard)');
select is((select count(*)::int from pg_trigger t where t.tgrelid in ('public.itwo_work_orders'::regclass, 'public.itwo_events'::regclass, 'public.itwo_access_changes'::regclass, 'public.itwo_doc_counters'::regclass, 'public.itwo_admin_log'::regclass) and t.tgname like '%\_sandbox\_scope'), 5, 'every test-mode aware table has the sandbox scope trigger');
select ok((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itwo\_%' or p.proname = 'app_sandbox_purge_itwo')) = 19, 'the module exposes 18 app_itwo RPCs and the sandbox purge');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itwo\_%' or p.proname = 'app_sandbox_purge_itwo')), 'every public itwo function is SECURITY DEFINER with an empty search_path');
select ok((select bool_and(prosecdef and proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'private'::regnamespace and proname like 'itwo\_%' and prokind = 'f' and prorettype <> 'trigger'::regtype and proname not in ('itwo_purge_allowed', 'itwo_is_dept_role', 'itwo_format_doc_no', 'itwo_clean', 'itwo_status_message')), 'every private itwo helper that reads data is SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itwo\_%' or p.proname = 'app_sandbox_purge_itwo') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'anon cannot execute any itwo RPC and authenticated can');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itwo\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itwo helpers are not callable by anon or authenticated');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itwo%'), 'every itwo RPC has the lab-only guard');
select ok(position('Asia/Bangkok' in pg_get_functiondef('private.itwo_next_doc_no(boolean, timestamptz)'::regprocedure)) > 0, 'the document year is computed in Asia/Bangkok time');
select is((select count(*)::int from public.employees where is_test and employee_no in ('SBX-IT-STAFF', 'SBX-IT-ADMIN', 'SBX-IT-APPROVER') and not is_active and auth_user_id is null), 3, 'the three IT test personas exist and cannot log in');
select is((select count(*)::int from public.itwo_staff s join public.employees e on e.id = s.employee_id where e.employee_no in ('SBX-IT-ADMIN', 'SBX-IT-APPROVER') and s.is_it_admin and (s.is_it_approver = (e.employee_no = 'SBX-IT-APPROVER'))), 2, 'the IT test personas have the matching IT rights (admin, admin + approver)');
select is((select d.code from public.employees e join public.departments d on d.id = e.department_id where e.employee_no = 'SBX-IT-STAFF'), 'IT', 'SBX-IT-STAFF is in the IT department');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) — แผนกใหม่ 6 แผนก ----------
insert into public.departments (code, name_th, name_en) values
  ('ZTA', 'แผนกทดสอบ A (มีผู้จัดการ)', 'ZT A'), ('ZTB', 'แผนกทดสอบ B (ไม่มีผู้จัดการ)', 'ZT B'),
  ('ZTC', 'แผนกทดสอบ C (มีแต่ผู้ช่วย)', 'ZT C'), ('ZTD', 'แผนกทดสอบ D (ผู้จัดการถูกปิด)', 'ZT D'),
  ('ZTF', 'แผนกทดสอบ F (ผู้จัดการเป็นผู้อนุมัติ IT)', 'ZT F'), ('ZTG', 'แผนกทดสอบ G (ตั้งผู้จัดการทีหลัง)', 'ZT G');
insert into auth.users (id, email, raw_user_meta_data) values
  ('1d700000-0000-0000-0000-000000000001', 'itwo-u1@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000002', 'itwo-u2@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000003', 'itwo-u3@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000004', 'itwo-u4@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000005', 'itwo-u5@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000006', 'itwo-u6@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000007', 'itwo-u7@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000008', 'itwo-u8@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000009', 'itwo-u9@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000010', 'itwo-u10@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000011', 'itwo-u11@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000012', 'itwo-u12@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000013', 'itwo-u13@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000014', 'itwo-u14@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000015', 'itwo-u15@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000016', 'itwo-u16@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000017', 'itwo-u17@test.local', '{}'::jsonb),
  ('1d700000-0000-0000-0000-000000000018', 'itwo-u18@test.local', '{}'::jsonb);
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itwo.test', d.id, r.id, v.uid::uuid, v.active
from (values
  ('ITWO-REQ1', 'ZTA', 'staff', '1d700000-0000-0000-0000-000000000001', true),
  ('ITWO-REQ2', 'ZTA', 'staff', '1d700000-0000-0000-0000-000000000002', true),
  ('ITWO-MGRA', 'ZTA', 'department_manager', '1d700000-0000-0000-0000-000000000003', true),
  ('ITWO-REQC', 'ZTC', 'staff', '1d700000-0000-0000-0000-000000000004', true),
  ('ITWO-AMGRC', 'ZTC', 'assistant_department_manager', '1d700000-0000-0000-0000-000000000005', true),
  ('ITWO-REQB', 'ZTB', 'staff', '1d700000-0000-0000-0000-000000000006', true),
  ('ITWO-REQIT', 'IT', 'staff', '1d700000-0000-0000-0000-000000000007', true),
  ('ITWO-ADM', 'MGT', 'staff', '1d700000-0000-0000-0000-000000000008', true),
  ('ITWO-APPR', 'MGT', 'general_manager', '1d700000-0000-0000-0000-000000000009', true),
  ('ITWO-OADM', 'MGT', 'admin', '1d700000-0000-0000-0000-000000000010', true),
  ('ITWO-MGRX', 'RB', 'department_manager', '1d700000-0000-0000-0000-000000000011', true),
  ('ITWO-REQD', 'ZTD', 'staff', '1d700000-0000-0000-0000-000000000012', true),
  ('ITWO-AP2', 'ZTF', 'department_manager', '1d700000-0000-0000-0000-000000000013', true),
  ('ITWO-REQF', 'ZTF', 'staff', '1d700000-0000-0000-0000-000000000014', true),
  ('ITWO-REQG', 'ZTG', 'staff', '1d700000-0000-0000-0000-000000000015', true),
  ('ITWO-SBXADMIN', 'MGT', 'admin', '1d700000-0000-0000-0000-000000000017', true),
  ('MNPLAB001', 'ZTA', 'staff', '1d700000-0000-0000-0000-000000000018', true),
  ('ITWO-MGRD-OFF', 'ZTD', 'department_manager', null, false)
) as v(no, dep, role, uid, active)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITWO-ADM', true, false), ('ITWO-APPR', true, true), ('ITWO-AP2', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZT-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZTA', 'sbx-zt-staff@sandbox.local', (select id from public.departments where code = 'ZTA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZT-MGR', 'ทดสอบ', 'ผจก. ZTA', 'sbx-zt-mgr@sandbox.local', (select id from public.departments where code = 'ZTA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select is((select count(*)::int from public.itwo_work_orders), 0, 'there are no work orders before the tests (clean database)');

-- 3. แจ้งงาน: เส้นทางอนุมัติแต่ละกรณี -----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('t.o2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('t.o3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select set_config('t.o4', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('t.o5', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select set_config('t.o6', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select set_config('t.o7', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select set_config('t.o8', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000014","role":"authenticated"}', true);
select set_config('t.o9', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'pending_dept', 'a staff member of a department with a manager waits for the department step');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e), 'created', 'a normal request records only "created"');
select is((public.app_itwo_get_detail(current_setting('t.o2')::uuid)->>'status'), 'pending_it_mgr', 'a department manager filing skips the department step');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'events') e), 'created,dept_approved', 'the department step is signed automatically in the requester name');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'events'->1->>'actor_employee_no', 'ITWO-MGRA', 'the automatic department approval is signed by the requester');
select is((public.app_itwo_get_detail(current_setting('t.o3')::uuid)->>'status'), 'pending_it_mgr', 'an assistant department manager filing skips the department step too');
select is((public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status'), 'pending_dept', 'a department that has only an assistant still waits for that assistant');
select is((public.app_itwo_get_detail(current_setting('t.o5')::uuid)->>'status'), 'pending_it_mgr', 'a department without any manager goes straight to the IT approver');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'events') e), 'created', 'no department approval is recorded yet for a department without manager');
select ok((public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'events'->0->>'reason') like '%ไม่มีผู้จัดการ%', 'the created event says why the department step is skipped');
select is((public.app_itwo_get_detail(current_setting('t.o6')::uuid)->>'status'), 'pending_it_mgr', 'an IT department requester waits for the IT approver only');
select is((public.app_itwo_get_detail(current_setting('t.o7')::uuid)->>'status'), 'approved', 'an IT approver filing is approved immediately');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o7')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved', 'the IT approver signs both steps at filing');
select is((public.app_itwo_get_detail(current_setting('t.o8')::uuid)->>'status'), 'pending_it_mgr', 'an inactive manager does not count: the department is treated as having no manager');
select is((public.app_itwo_get_detail(current_setting('t.o9')::uuid)->>'status'), 'pending_dept', 'a department whose manager is also an IT approver waits for the department step');
select is((public.app_itwo_get_detail(current_setting('t.o9')::uuid)->>'doc_no'), 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/009', 'document numbers run IT06-YY/NNN in order');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'doc_no'), 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/001', 'the first document of the year is IT06-YY/001');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select last_seq::int from public.itwo_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 9, 'the counter advanced once per filed request');

-- 3b. ตรวจข้อมูลที่กรอก (ไม่กินเลขที่เอกสาร) ----------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_create(null, null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาเลือกประเภทคำขอ', 'a request type is required');
select throws_ok($$ select * from public.app_itwo_create('bogus', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาเลือกประเภทคำขอ', 'an unknown request type is refused');
select throws_ok($$ select * from public.app_itwo_create('design', null, null, null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาเลือกเอกสารแนบ (มี / ไม่มี / อื่นๆ)', 'the attachment choice is required');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, '   ', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณากรอกรายละเอียดงาน', 'details are required');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, repeat('ก', 2001), ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'รายละเอียดงานต้องไม่เกิน 2,000 ตัวอักษร', 'details are limited to 2000 characters');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'other', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาระบุรายละเอียดเอกสารแนบ (เมื่อเลือก "อื่นๆ")', 'the "other" attachment needs a note');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, 'x', null, false) $$, '23514', 'กรุณาระบุวันที่ต้องการงาน', 'the needed date is required');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date - 1), false) $$, '23514', 'วันที่ต้องการงานต้องไม่ใช่วันที่ผ่านมาแล้ว', 'the needed date cannot be in the past (Thai date)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select last_seq::int from public.itwo_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 9, 'refused requests did not consume document numbers');

-- 3c. รายการรออนุมัติ (ก่อนมีใครอนุมัติ) --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_pending_approvals()), 1, 'the department manager sees only the pending request of the own department (not the own request)');
select is((select pending_step from public.app_itwo_list_pending_approvals() limit 1), 'dept', 'the department manager is asked for the department step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_pending_approvals()), 5, 'the IT approver sees the requests that wait only for the IT step (o2, o3, o5, o6, o8)');
select is(public.app_itwo_pending_count(), 5, 'the pending badge count matches the list');
select is((select count(*)::int from public.app_itwo_list_pending_approvals() where pending_step = 'it_mgr'), 5, 'all of them are IT steps');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select is(public.app_itwo_pending_count(), 6, 'an approver who is also the manager of a department sees the own department request as well');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is(public.app_itwo_pending_count(), 0, 'a plain staff member has nothing to approve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select is(public.app_itwo_pending_count(), 0, 'a system admin without IT rights has nothing to approve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select is(public.app_itwo_pending_count(), 0, 'a manager of another department has nothing to approve');

-- 4. อนุมัติ / ไม่อนุมัติ -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '42501', 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบสั่งงานที่ตัวเองเป็นผู้แจ้งได้', 'a requester cannot approve the own request');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'a colleague of the same department cannot approve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'a system admin without IT rights cannot approve (no automatic IT rights)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'a manager of another department cannot approve');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '23514', 'ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'the IT approver must wait for the department manager when the department has one');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o1')::uuid, '  ') $$, '23514', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'a rejection needs a reason');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the department manager approves the department step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'pending_it_mgr', 'after the department step the request waits for the IT step');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e), 'created,dept_approved', 'the department approval is recorded');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'approvals'->'dept'->>'by', 'ทดสอบ ITWO-MGRA', 'the approval summary names the department manager');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้ผู้จัดการแผนกพิจารณาไปแล้ว', 'the department step cannot be decided twice');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the IT approver approves the IT step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'approved', 'both steps done: approved');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved', 'both approvals are recorded in order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้อนุมัติครบแล้ว', 'an approved request cannot be approved again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o4')::uuid) $$, 'an assistant department manager can approve the department step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'events') e), 'created,dept_approved', 'the assistant approval is recorded');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'events'->1->>'actor_employee_no', 'ITWO-AMGRC', 'signed by the assistant');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o5')::uuid) $$, 'a department without manager: one click by the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o5')::uuid)->>'status'), 'approved', 'the request of a department without manager is approved by one click');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved', 'one click records both steps');
select ok((public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'approvals'->'dept'->>'reason') like '%ไม่มีผู้จัดการ%', 'the department approval notes that the department has no manager');
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'approvals'->'dept'->>'by', 'ทดสอบ ITWO-APPR', 'both steps are signed by the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o6')::uuid) $$, 'an IT department request: one click by the IT approver');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o8')::uuid) $$, 'a department whose only manager is inactive: one click by the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o6')::uuid)->>'status'), 'approved', 'the IT department request is approved');
select ok((public.app_itwo_get_detail(current_setting('t.o6')::uuid)->'approvals'->'dept'->>'reason') like '%แผนก IT%', 'the IT department approval says why it counts for both steps');
select is((public.app_itwo_get_detail(current_setting('t.o8')::uuid)->>'status'), 'approved', 'the request of a department with only an inactive manager is approved');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o9')::uuid) $$, 'an IT approver who manages the requester department approves with one click');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o9')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved', 'one click counts both steps');
select ok((public.app_itwo_get_detail(current_setting('t.o9')::uuid)->'approvals'->'dept'->>'reason') like '%ผู้อนุมัติเป็นผู้จัดการ%', 'the approval notes that the approver manages the department');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o2')::uuid) $$, 'the IT step of a request signed by the department manager at filing');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o3')::uuid) $$, 'the IT step of a request signed by the assistant at filing');

-- 4b. แผนกที่เพิ่งตั้งผู้จัดการระหว่างรอ --------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000015","role":"authenticated"}', true);
select set_config('t.o10', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o10')::uuid)->>'status'), 'pending_it_mgr', 'a department without manager waits for the IT approver');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select 'ITWO-MGRG', 'ทดสอบ', 'ITWO-MGRG', 'itwo-mgrg@itwo.test', d.id, r.id, '1d700000-0000-0000-0000-000000000016'::uuid, true
from public.departments d, public.roles r where d.code = 'ZTG' and r.code = 'department_manager';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o10')::uuid) $$, '23514', 'ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'once a manager exists the IT approver must wait for the department step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000016","role":"authenticated"}', true);
select is(public.app_itwo_pending_count(), 1, 'the new manager sees the request');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o10')::uuid) $$, 'the newly appointed manager approves the department step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o10')::uuid) $$, 'then the IT approver approves the IT step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o10')::uuid)->>'status'), 'approved', 'the request is approved after both steps');

-- 4c. ไม่อนุมัติ --------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o11', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_reject(current_setting('t.o11')::uuid, 'ข้อมูลไม่ครบ') $$, 'the department manager rejects with a reason');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o11')::uuid)->>'status'), 'rejected', 'a rejection ends the request');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o11')::uuid)->'events') e), 'created,dept_rejected', 'the rejection is recorded');
select is(public.app_itwo_get_detail(current_setting('t.o11')::uuid)->'events'->1->>'reason', 'ข้อมูลไม่ครบ', 'the reason is kept in the history');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o11')::uuid) $$, '23514', 'ใบสั่งงานนี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be approved');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o11')::uuid, 'x') $$, '23514', 'ใบสั่งงานนี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be cancelled');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('t.o12', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_reject(current_setting('t.o12')::uuid, 'งบไม่พอ') $$, 'the IT approver rejects with a reason');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o12')::uuid)->'events') e), 'created,dept_approved,it_mgr_rejected', 'the IT step rejection is recorded after the automatic department approval');
select is((public.app_itwo_get_detail(current_setting('t.o12')::uuid)->>'status'), 'rejected', 'rejected by the IT step');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set status = 'pending_dept' where id = current_setting('t.o11')::uuid $$, '23514', null, 'a rejected request cannot be reopened (state transition guard)');
select throws_ok($$ update public.itwo_work_orders set status = 'in_progress' where id = current_setting('t.o11')::uuid $$, '23514', null, 'a rejected request cannot jump to in progress');

-- 5. ยกเลิก -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('t.o13', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o13')::uuid, 'x') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้', 'only the requester can cancel');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o13')::uuid, '') $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิก', 'a cancellation needs a reason');
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.o13')::uuid, 'ไม่ต้องการแล้ว') $$, 'the requester cancels with a reason');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o13')::uuid)->>'status'), 'cancelled', 'the request is cancelled');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o13')::uuid)->'events') e), 'created,cancelled', 'the cancellation is recorded');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o13')::uuid) $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be approved');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o13')::uuid, 'อีกครั้ง') $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be cancelled again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_start(current_setting('t.o13')::uuid) $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be started');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set status = 'approved' where id = current_setting('t.o13')::uuid $$, '23514', null, 'a cancelled request cannot be reopened');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.o7')::uuid, 'เปลี่ยนแผน') $$, 'an approved request can still be cancelled before IT closes it');

-- 5b. เริ่มงาน (ไม่ใช่งานด่วน ต้องอนุมัติครบ) ---------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o14', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_start(current_setting('t.o14')::uuid) $$, '23514', 'ใบสั่งงานปกติต้องอนุมัติครบทั้งสองขั้นก่อนจึงจะเริ่มทำได้ (เฉพาะงานด่วนเริ่มก่อนอนุมัติครบได้)', 'a normal request cannot be started before both approvals');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'an IT approver without the admin right cannot start work');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'a requester cannot start work');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'a system admin without IT rights cannot start work');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions'), '["start", "edit_access"]'::jsonb, 'IT admin sees start and edit_access on an approved request');
select lives_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, 'IT starts an approved request');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'in_progress', 'the request is in progress');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้เริ่มดำเนินการไปแล้ว', 'a request cannot be started twice');
select throws_ok($$ select public.app_itwo_receive(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยืนยันการรับงานได้', 'only the requester can confirm receipt');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_receive(current_setting('t.o1')::uuid) $$, '23514', 'ยังยืนยันรับงานไม่ได้ เพราะ IT ยังไม่ปิดงาน', 'receipt cannot be confirmed before IT closes the work');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ปิดงานได้', 'a requester cannot close work');

-- 5c. ส่วน "สำหรับแผนก IT" (สิทธิ์ในระบบ) -------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[{"system":"i_prime","action":"add","new_username":" it01 ","note":"ผู้ใช้ใหม่"},{"system":"email","action":"cancel","old_username":"old@x.com"}]'::jsonb) $$, 'IT saves two access rows');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'access_changes'), 2, 'two rows are stored');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'access_changes'->0->>'new_username', 'it01', 'values are trimmed and kept in line order');
select lives_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[{"system":"express","action":"change","new_username":"a","old_username":"b"}]'::jsonb) $$, 'saving again replaces the whole set');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'access_changes'), 1, 'only the new row remains');
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[{"system":"bogus","action":"add"}]'::jsonb) $$, '23514', 'รายการที่ 1: กรุณาเลือกระบบให้ถูกต้อง (I-Prime, Express, E-Mail, อื่นๆ)', 'an unknown system is refused');
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[{"system":"email","action":"zap"}]'::jsonb) $$, '23514', 'รายการที่ 1: กรุณาเลือกการดำเนินการให้ถูกต้อง (เพิ่ม, เปลี่ยน, ยกเลิก)', 'an unknown action is refused');
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '{"a":1}'::jsonb) $$, '23514', 'ข้อมูลสิทธิ์ในระบบไม่ถูกต้อง (ต้องเป็นรายการ)', 'the changes must be a list');
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, (select jsonb_agg(jsonb_build_object('system', 'email', 'action', 'add')) from generate_series(1, 21))) $$, '23514', 'บันทึกสิทธิ์ในระบบได้ไม่เกิน 20 รายการต่อใบ', 'at most 20 rows per request');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'access_changes'), 1, 'a refused save leaves the previous rows untouched');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[]'::jsonb) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกส่วนสำหรับแผนก IT ได้', 'only IT admin can edit the IT section');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o14')::uuid, '[]'::jsonb) $$, '23514', 'ต้องอนุมัติครบก่อนจึงจะบันทึกส่วนสำหรับแผนก IT ได้ (เฉพาะงานด่วนบันทึกได้ก่อน)', 'a normal request that is not approved yet cannot get an IT section');

-- 5d. ปิดงานและยืนยันรับ ------------------------------------------------
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT closes the work');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'it_closed', 'the request waits for the requester to confirm');
select throws_ok($$ select public.app_itwo_save_access_changes(current_setting('t.o1')::uuid, '[]'::jsonb) $$, '23514', 'ใบสั่งงานนี้ IT ปิดงานแล้ว แก้ไขส่วนสำหรับแผนก IT ไม่ได้', 'the IT section is locked after closing');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions'), '["receive"]'::jsonb, 'the requester sees only the receive action');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'x') $$, '23514', 'IT ปิดงานแล้ว ไม่สามารถยกเลิกได้', 'a closed request cannot be cancelled');
select lives_ok($$ select public.app_itwo_receive(current_setting('t.o1')::uuid) $$, 'the requester confirms receipt');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'received', 'the request is finished');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved,started,completed,received', 'the full history is recorded in order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'x') $$, '23514', 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ไม่สามารถยกเลิกได้', 'a finished request cannot be cancelled');
select throws_ok($$ select public.app_itwo_receive(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้ยืนยันรับงานไปแล้ว', 'receipt cannot be confirmed twice');

-- 5e. งานด่วน -----------------------------------------------------------
select set_config('t.o15', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.o15')::uuid) $$, 'IT starts an urgent request before the approvals');
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->>'status'), 'in_progress', 'urgent: in progress while still waiting for approval');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o15')::uuid)->'events') e), 'created,started', 'the start is recorded');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o15')::uuid) $$, '23514', 'ปิดงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน', 'an urgent request cannot be closed before the approvals');
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->'allowed_actions'), '["edit_access"]'::jsonb, 'IT can already edit the IT section of an urgent request but not close it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->'allowed_actions'), '["approve", "reject"]'::jsonb, 'the department manager can still approve after the work started');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o15')::uuid) $$, 'the department manager approves after the start');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->>'status'), 'in_progress', 'an approval does not pull an in-progress request back');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o15')::uuid) $$, '23514', 'ปิดงานไม่ได้ ต้องรอผู้อนุมัติขั้น IT อนุมัติก่อน', 'still waiting for the IT step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o15')::uuid) $$, 'the IT approver approves after the start');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->>'status'), 'in_progress', 'still in progress after both approvals');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o15')::uuid) $$, 'closing works once both approvals exist');
select is((public.app_itwo_get_detail(current_setting('t.o15')::uuid)->>'status'), 'it_closed', 'closed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o16', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.o16')::uuid) $$, 'second urgent request started');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_reject(current_setting('t.o16')::uuid, 'ไม่จำเป็น') $$, 'a manager can still reject an urgent request that is in progress');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o16')::uuid)->>'status'), 'rejected', 'a rejection ends an urgent request that was in progress');

-- 6. การมองเห็นและปุ่มที่ทำได้ ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o17', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o17')::uuid)->>'doc_no') like 'IT06-%', true, 'IT admin can open any request');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o17')::uuid)->>'status', 'pending_dept', 'the department manager can open a request of the department');
select is((public.app_itwo_get_detail(current_setting('t.o17')::uuid)->'allowed_actions'), '["approve", "reject"]'::jsonb, 'the department manager gets approve and reject');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((public.app_itwo_get_detail(current_setting('t.o17')::uuid)->'allowed_actions'), '["cancel"]'::jsonb, 'the requester can only cancel a request that waits for approval');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o17')::uuid)->'events'), 1, 'the requester sees the history with names');
select is(public.app_itwo_get_detail(current_setting('t.o17')::uuid)->'events'->0->>'actor_full_name', 'ทดสอบ ITWO-REQ1', 'the history carries the actor name');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o17')::uuid)->>'status', 'pending_dept', 'IT staff can open any request');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.o17')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague cannot open the request of another person');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.o17')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a manager of another department cannot open the request');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.o17')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a system admin without IT rights cannot open the request');
select throws_ok($$ select public.app_itwo_get_detail(gen_random_uuid()) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'an unknown id gives the same answer (no existence leak)');
select throws_ok($$ select count(*) from public.app_itwo_list_it() $$, '42501', 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'a system admin without IT rights has no IT work list');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.app_itwo_list_it() $$, '42501', 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'a requester has no IT work list');
select is((select count(*)::int from public.app_itwo_list_mine()), 6, 'the requester list holds the own requests only');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_it()), 17, 'IT sees every request');
select is((select (array_agg(is_urgent))[1] from public.app_itwo_list_it()), true, 'urgent requests are listed first');

-- 7. ISO: ประวัติแก้ไม่ได้ ใบลบไม่ได้ เขียนตรงไม่ได้ --------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_events set reason = 'x' where id = (select min(id) from public.itwo_events) $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'an event cannot be updated');
select throws_ok($$ delete from public.itwo_events where id = (select min(id) from public.itwo_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'an event cannot be deleted');
select throws_ok($$ truncate public.itwo_events $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the events table cannot be truncated');
select set_config('itwo.purge', 'on', true);
select throws_ok($$ delete from public.itwo_events where id = (select min(id) from public.itwo_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'even with the purge flag a real (non-test) event cannot be deleted');
select throws_ok($$ delete from public.itwo_work_orders where id = current_setting('t.o1')::uuid $$, '42501', 'ใบสั่งงานลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)', 'even with the purge flag a real work order cannot be deleted');
select set_config('itwo.purge', 'off', true);
select throws_ok($$ delete from public.itwo_work_orders where id = current_setting('t.o1')::uuid $$, '42501', 'ใบสั่งงานลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)', 'a work order cannot be deleted');
select throws_ok($$ truncate public.itwo_work_orders cascade $$, '42501', null, 'the work orders table cannot be truncated');
select throws_ok($$ update public.itwo_work_orders set details = 'แก้' where id = current_setting('t.o1')::uuid $$, '42501', 'ใบสั่งงานแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)', 'the content of a work order cannot be edited');
select throws_ok($$ update public.itwo_work_orders set doc_no = 'IT06-00/999' where id = current_setting('t.o1')::uuid $$, '42501', null, 'the document number cannot be changed');
select throws_ok($$ update public.itwo_work_orders set status = 'pending_dept' where id = current_setting('t.o1')::uuid $$, '23514', null, 'a finished request cannot go back');
select throws_ok($$ insert into public.itwo_events (work_order_id, actor_id, action, is_test) select current_setting('t.o1')::uuid, id, 'received', true from public.employees where employee_no = 'ITWO-REQ1' $$, '23503', null, 'an event cannot point to a work order with a different test flag');
select throws_ok($$ insert into public.itwo_work_orders (doc_no, doc_year, doc_seq, requester_id, department_id, request_type, attachment_flag, details, needed_date) select 'DUP', doc_year, doc_seq, requester_id, department_id, request_type, attachment_flag, details, needed_date from public.itwo_work_orders where id = current_setting('t.o1')::uuid $$, '23505', null, 'the (year, sequence) pair is unique');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.itwo_work_orders $$, '42501', null, 'authenticated cannot read work orders directly');
select throws_ok($$ insert into public.itwo_events (work_order_id, actor_id, action) select current_setting('t.o1')::uuid, id, 'received' from public.employees where employee_no = 'ITWO-REQ1' $$, '42501', null, 'authenticated cannot write events directly');
select throws_ok($$ update public.itwo_work_orders set status = 'received' $$, '42501', null, 'authenticated cannot update work orders directly');
select throws_ok($$ delete from public.itwo_events $$, '42501', null, 'authenticated cannot delete events');
select throws_ok($$ select * from public.itwo_staff $$, '42501', null, 'authenticated cannot read the IT staff table');
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select public.app_itwo_my_role() $$, '42501', null, 'anon cannot call the RPCs');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000018","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_my_role() $$, '42501', 'LAB_ONLY_ACCOUNT', 'a lab-only account is blocked from the module');
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '42501', 'LAB_ONLY_ACCOUNT', 'a lab-only account cannot file a request');

-- 8. เลขที่เอกสาร -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((public.app_itwo_get_doc_counter()->>'last_seq')::int, 17, 'the counter shows the numbers issued so far');
select is(public.app_itwo_get_doc_counter()->>'next_doc_no', 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/018', 'the next document number is shown');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_doc_counter() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้', 'only IT admin can see the counter');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(500) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'only IT admin can set the next number');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_set_next_doc_seq(500) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'a system admin without IT rights cannot set the next number');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_set_next_doc_seq(17) $$, '23514', null, 'the next number cannot go backwards (onto a used number)');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(1) $$, '23514', null, 'the next number cannot restart from 1');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(0) $$, '23514', 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999', 'zero is refused');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(10000) $$, '23514', 'เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999', 'a number above 9999 is refused');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(5, 2020) $$, '23514', 'ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า', 'a past year is refused');
select is((select count(*)::int from public.app_itwo_list_staff() where employee_no = 'ITWO-ADM'), 1, 'the IT admin can list the IT team');
select is(public.app_itwo_set_next_doc_seq(18)->>'next_doc_no', 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/018', 'setting the number that is already next is accepted');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_admin_log where action = 'doc_seq_set'), 0, 'refused attempts and a no-op change left no log');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.app_itwo_set_next_doc_seq(101)->>'next_doc_no', 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/101', 'IT sets the next number to continue from the paper register');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_admin_log where action = 'doc_seq_set' and not is_test), 1, 'moving the number forward is logged');
select is((select detail->>'new_next' from public.itwo_admin_log where action = 'doc_seq_set'), '101', 'the log holds the new number');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o18', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o18')::uuid)->>'doc_no', 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/101', 'the next request gets the number that was set');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('t.o19', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบใบสั่งงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o19')::uuid)->>'doc_no', 'IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/102', 'numbers continue without gaps');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(100) $$, '23514', null, 'going back after issuing is refused');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(102) $$, '23514', null, 'a number already used is refused');
select is(public.app_itwo_set_next_doc_seq(5, extract(year from now() at time zone 'Asia/Bangkok')::int + 1)->>'next_doc_no', 'IT06-' || to_char((now() at time zone 'Asia/Bangkok') + interval '1 year', 'YY') || '/005', 'next year can be prepared in advance');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select doc_no from private.itwo_next_doc_no(false, '2090-12-31 16:00:00+00'::timestamptz)), 'IT06-90/001', '23:00 Bangkok on 31 Dec is still the old year');
select is((select doc_no from private.itwo_next_doc_no(false, '2090-12-31 18:00:00+00'::timestamptz)), 'IT06-91/001', '01:00 Bangkok on 1 Jan is the new year even though it is still 31 Dec in UTC');
select is((select doc_no from private.itwo_next_doc_no(false, '2090-12-31 18:30:00+00'::timestamptz)), 'IT06-91/002', 'the sequence continues inside the new year');
select is((select doc_no from private.itwo_next_doc_no(true, '2090-12-31 18:30:00+00'::timestamptz)), 'TEST-IT06-91/001', 'the test counter is separate and prefixed with TEST-');
select is(private.itwo_format_doc_no(false, 2026, 1000), 'IT06-26/1000', 'numbers above 999 are shown in full');
select is(private.itwo_format_doc_no(false, 2026, 7), 'IT06-26/007', 'numbers are padded to three digits');

-- 9. จัดการสิทธิ์ทีม IT (itwo_staff) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', true, false) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้', 'an approver without the admin right cannot manage the team');
select throws_ok($$ select * from public.app_itwo_list_staff() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'an approver without the admin right cannot list the team');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', true, false) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้', 'a system admin without IT rights cannot manage the team');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_set_staff('NOPE-999', true, false) $$, '23514', 'ไม่พบรหัสพนักงานนี้', 'an unknown employee is refused');
select throws_ok($$ select public.app_itwo_set_staff('ITWO-MGRD-OFF', true, false) $$, '23514', 'พนักงานคนนี้ถูกปิดการใช้งาน ตั้งสิทธิ์ทีม IT ไม่ได้', 'an inactive employee cannot get IT rights');
select lives_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', false, false) $$, 'removing someone who has no rights does nothing');
select lives_ok($$ select public.app_itwo_set_staff('  itwo-req2 ', true, false) $$, 'the employee number is matched without case or spaces');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_it()), 19, 'the new IT admin sees the IT work list');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', false, true) $$, 'rights can be changed');
select lives_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', false, false) $$, 'rights can be removed');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select count(*) from public.app_itwo_list_it() $$, '42501', 'เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'a removed member loses access');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select string_agg(action, ',' order by id) from public.itwo_admin_log where action like 'staff\_%'), 'staff_added,staff_changed,staff_removed', 'each change is logged');
select is((select detail->>'employee_no' from public.itwo_admin_log where action = 'staff_added'), 'ITWO-REQ2', 'the log names the employee');
select is((select a.employee_no from public.itwo_admin_log l join public.employees a on a.id = l.actor_id where l.action = 'staff_added'), 'ITWO-ADM', 'the log names who made the change');
select throws_ok($$ update public.itwo_admin_log set action = 'doc_seq_set' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be updated');
select throws_ok($$ delete from public.itwo_admin_log $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be deleted');
select throws_ok($$ truncate public.itwo_admin_log $$, '42501', null, 'the admin log cannot be truncated');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_set_staff('ITWO-APPR', false, true) $$, 'an admin right can be taken from another admin while one remains');
select throws_ok($$ select public.app_itwo_set_staff('ITWO-ADM', false, false) $$, '23514', 'ต้องเหลือผู้ดูแลงาน IT ที่ใช้งานอยู่อย่างน้อย 1 คน', 'the last IT admin cannot be removed');
select lives_ok($$ select public.app_itwo_set_staff('ITWO-APPR', true, true) $$, 'the admin right is given back');
select lives_ok($$ select public.app_itwo_set_staff('ITWO-APPR', true, false) $$, 'an approver right can be taken away while another approver exists');
select throws_ok($$ select public.app_itwo_set_staff('ITWO-AP2', false, false) $$, '23514', 'ต้องเหลือผู้อนุมัติขั้น IT ที่ใช้งานอยู่อย่างน้อย 1 คน', 'the last IT approver cannot be removed');
select lives_ok($$ select public.app_itwo_set_staff('ITWO-APPR', true, true) $$, 'the approver right is given back');
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = false where employee_no in ('ITWO-APPR', 'ITWO-AP2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_create('design', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT', 'filing is refused when no IT approver is active (a request would be stuck)');
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = true where employee_no in ('ITWO-APPR', 'ITWO-AP2');
update public.employees set is_active = false where employee_no = 'ITWO-REQ2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_my_role() $$, '42501', 'ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT', 'an inactive employee cannot use the module');
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = true where employee_no = 'ITWO-REQ2';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select is(public.app_itwo_my_role()->>'is_it_approver', 'true', 'my_role reports the IT approver right');
select is(public.app_itwo_my_role()->>'is_it_admin', 'true', 'my_role reports the IT admin right');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_my_role()->>'is_dept_approver', 'true', 'my_role reports a department manager');
select is(public.app_itwo_my_role()->'department'->>'code', 'ZTA', 'my_role reports the department');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select is(public.app_itwo_my_role()->>'is_it_department', 'true', 'my_role reports an IT department member');
select is(public.app_itwo_my_role()->>'is_it_admin', 'false', 'a member of the IT department does not get IT rights automatically');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000010","role":"authenticated"}', true);
select is(public.app_itwo_my_role()->>'is_it_admin', 'false', 'a system admin does not get IT rights automatically');

-- 10. โหมดทดสอบ ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000017","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zt_staff')::uuid) $$, 'the admin enters the test mode as a department staff persona');
select is(public.app_itwo_my_role()->>'is_test', 'true', 'the module recognizes the test mode');
select set_config('t.t1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบในโหมดทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'doc_no', 'TEST-IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/001', 'a test request gets a TEST- number from its own counter');
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'is_test', 'true', 'the request is flagged as a test request');
select is((public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'status'), 'pending_dept', 'the test department manager persona is the approver of the department');
select is((select count(*)::int from public.app_itwo_list_mine()), 1, 'the persona sees only test requests');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zt_mgr')::uuid) $$, 'switching to the manager persona');
select is(public.app_itwo_pending_count(), 1, 'the persona manager has the test request pending');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switching to the IT approver persona');
select is((select count(*)::int from public.app_itwo_list_pending_approvals()), 1, 'the IT approver persona sees the test request only (not the real ones)');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, 'the IT approver persona approves');
select is((public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'status'), 'approved', 'approved in the test world');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select is((select count(*)::int from public.app_itwo_list_it()), 1, 'the IT list in test mode holds test requests only');
select lives_ok($$ select public.app_itwo_start(current_setting('t.t1')::uuid) $$, 'IT admin persona starts');
select lives_ok($$ select public.app_itwo_save_access_changes(current_setting('t.t1')::uuid, '[{"system":"i_prime","action":"add","new_username":"t1"}]'::jsonb) $$, 'IT admin persona saves an access row');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.t1')::uuid) $$, 'IT admin persona closes');
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.o1')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a persona cannot see a real request');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o17')::uuid) $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a persona cannot decide a real request');
select throws_ok($$ select public.app_itwo_set_staff('ITWO-REQ2', true, false) $$, '23514', 'ตั้งสิทธิ์ทีม IT ในโหมดทดสอบไม่ได้', 'IT team rights cannot be edited in test mode');
select is(public.app_itwo_set_next_doc_seq(10)->>'next_doc_no', 'TEST-IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/010', 'the next number can be set for the test counter');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zt_staff')::uuid) $$, 'back to the requester persona');
select lives_ok($$ select public.app_itwo_receive(current_setting('t.t1')::uuid) $$, 'the requester persona confirms receipt');
select is((public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'status'), 'received', 'the test request is finished');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'the IT department requester persona');
select set_config('t.t2', (select id::text from public.app_itwo_create('system_access', null, 'no', null, 'ทดสอบแผนก IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.t2')::uuid)->>'doc_no', 'TEST-IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/010', 'the test number continues from the value that was set');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'IT approver persona again');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t2')::uuid) $$, 'one click for the IT department test request');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.t2')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved', 'one click recorded both steps in the test world');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.t1')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a real user cannot see a test request');
select is((select count(*)::int from public.app_itwo_list_mine()), 7, 'real lists never include test requests');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a real manager cannot decide a test request');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_it()), 19, 'the real IT list never includes test requests');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_work_orders where not is_test), 19, 'the real requests are unchanged by the test mode');
select is((select last_seq::int from public.itwo_doc_counters where is_test = false and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 102, 'the real counter did not move');
select is((select last_seq::int from public.itwo_doc_counters where is_test = true and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 10, 'the test counter is separate');
select is((select count(*)::int from public.itwo_events where is_test), 9, 'test events are flagged as test');
select is((select count(*)::int from public.itwo_admin_log where is_test and action = 'doc_seq_set'), 1, 'the test counter change is logged as a test row');
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000017","role":"authenticated"}', true);
select throws_ok($$ update public.itwo_staff set is_it_admin = is_it_admin $$, null, 'SANDBOX_MODULE_UNSUPPORTED', 'the IT staff table cannot be written while an admin is in test mode');
select set_config('request.jwt.claims', '', true);

-- 10b. ล้างข้อมูลทดสอบ --------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_sandbox_purge_itwo() $$, null, 'NOT_AUTHORIZED', 'a normal user cannot purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000017","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select throws_ok($$ select public.app_sandbox_purge_itwo() $$, null, 'SANDBOX_NOT_ACTIVE', 'the purge only works from inside the test mode');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zt_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itwo()->>'deleted')::int, 15, 'the purge deletes every test row (requests, history, access rows, log, counters)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_work_orders where is_test) + (select count(*)::int from public.itwo_events where is_test) + (select count(*)::int from public.itwo_access_changes where is_test) + (select count(*)::int from public.itwo_admin_log where is_test) + (select count(*)::int from public.itwo_doc_counters where is_test), 0, 'no test row is left');
select is((select count(*)::int from public.itwo_work_orders where not is_test), 19, 'the real work orders survived the purge');
select is((select count(*)::int from public.itwo_events where not is_test), (select count(*)::int from public.itwo_events), 'only real events are left');
select is((select count(*)::int from public.itwo_admin_log where not is_test), 9, 'the real admin log survived the purge');
select is((select count(*)::int from public.audit_logs where action = 'ITWO_SANDBOX_PURGE'), 1, 'the purge is written to the audit log');
select is(current_setting('itwo.purge', true), 'off', 'the purge flag is switched off again');
select throws_ok($$ delete from public.itwo_events where id = (select min(id) from public.itwo_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real history still cannot be deleted after a purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"1d700000-0000-0000-0000-000000000017","role":"authenticated"}', true);
select set_config('t.t3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'หลังล้าง', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.t3')::uuid)->>'doc_no', 'TEST-IT06-' || to_char(now() at time zone 'Asia/Bangkok', 'YY') || '/001', 'after the purge the test numbering starts again at 001');

select * from finish();
rollback;
