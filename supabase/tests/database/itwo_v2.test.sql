-- ทดสอบใบสั่งงาน IT รุ่น 2 (20261205010000_itwo_v2_rework_files.sql)
--   A) ถอดส่วนสิทธิ์ในระบบ: ไม่รับ system_access, บันทึกส่วนสิทธิ์ถูกปฏิเสธ, ไม่มี edit_access
--   B) งานเบ็ดเตล็ด (misc) ต้องระบุงาน (misc_detail) + guard ไม่ให้แก้
--   C) แนบไฟล์: บัคเก็ต/policy ของ Storage, ลงทะเบียน (≤10 ไฟล์ต่อครั้ง, เวลา, ใบ, flag, การอนุมัติจริง), อ่านตามสิทธิ์เห็นใบ, เพิ่มได้อย่างเดียว
--   D) ขอแก้ไขงาน (rework) หลายรอบ + ไฟล์แนบของแต่ละรอบ + เพิ่มได้อย่างเดียว
--   E) ผู้แจ้งคนเดียวแจ้งได้หลายใบ
--   F) โหมดทดสอบ + ล้างข้อมูลทดสอบ (แถวทะเบียน/รอบแก้ไข + รายการไฟล์ที่ต้องลบผ่าน Storage API)
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITV-*) ในแผนก ZVA/ZVB ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration, SBX-ZV-* สร้างในไฟล์นี้
begin;

create extension if not exists pgtap with schema extensions;
select plan(249);

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('itwo_reworks', 'itwo_attachments') and c.relkind = 'r' and c.relrowsecurity), 2, 'RLS is enabled on both new tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('itwo_reworks', 'itwo_attachments') and g.grantee in ('anon', 'authenticated', 'PUBLIC')), 'anon, authenticated and PUBLIC have no direct grant on the new tables');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) where c.relnamespace = 'public'::regnamespace and c.relname in ('itwo_reworks', 'itwo_attachments') and (has_table_privilege('service_role', c.oid, p.priv) or has_table_privilege('anon', c.oid, p.priv) or has_table_privilege('authenticated', c.oid, p.priv))), 'service_role, anon and authenticated hold no privilege at all on the new tables');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('itwo_reworks', 'itwo_attachments') and p.polname like '%\_no\_direct\_access'), 2, 'both new tables have a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname in ('itwo_reworks', 'itwo_attachments') and p.polname = 'lab_only_no_access' and not p.polpermissive), 2, 'both new tables have the restrictive lab-only policy');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itwo_reworks', 'itwo_attachments', 'itwo_work_orders', 'itwo_events', 'itwo_access_changes', 'itwo_doc_counters', 'itwo_admin_log', 'ncr_reports', 'bom_rod_lots', 'bom_rod_moves', 'rf_purchase_orders', 'client_error_logs']) t), 'the new tables are registered in sandbox_unguarded_tables() and every older name is still there');
select is((select count(*)::int from pg_trigger t where t.tgrelid in ('public.itwo_reworks'::regclass, 'public.itwo_attachments'::regclass) and t.tgname in ('itwo_reworks_sandbox_scope', 'itwo_attachments_sandbox_scope', 'itwo_reworks_append_only', 'itwo_attachments_append_only', 'itwo_reworks_no_truncate', 'itwo_attachments_no_truncate')), 6, 'the new tables have the sandbox scope, append-only and no-truncate triggers');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.itwo_work_orders'::regclass and t.tgname = 'itwo_work_orders_insert_guard' and not t.tgisinternal), 'work orders have the insert guard (misc detail, no system_access)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itwo_request_rework', 'app_itwo_add_attachment')), 'the two new RPCs are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itwo_request_rework', 'app_itwo_add_attachment') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'anon cannot execute the new RPCs and authenticated can');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itwo%'), 'every itwo RPC (including the new and replaced ones) has the lab-only guard');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itwo\_%' and p.prokind = 'f' and p.prorettype <> 'trigger'::regtype and p.proname not in ('itwo_purge_allowed', 'itwo_is_dept_role', 'itwo_format_doc_no', 'itwo_clean', 'itwo_status_message')), 'every private itwo helper (new ones included) is SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itwo\_%' and p.proname not like 'itwo\_storage\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itwo helpers are closed to anon and authenticated except the three Storage policy helpers');
select ok((select count(*) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itwo\_storage\_%') = 3 and not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itwo\_storage\_%' and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'the three Storage policy helpers can be executed by authenticated (policies run as the caller) but not by anon');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itwo_create'), 1, 'there is exactly one app_itwo_create (the old 7-argument overload is gone, so no ambiguous call)');
-- buckets
select is((select count(*)::int from storage.buckets where id in ('itwo-files', 'itwo-test-files') and not public and file_size_limit = 20971520), 2, 'both buckets exist, are private and are limited to 20 MB');
select ok((select bool_and(b.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf', 'application/msword', 'application/vnd.ms-excel', 'text/plain', 'text/csv', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'] and cardinality(b.allowed_mime_types) = 13) from storage.buckets b where b.id in ('itwo-files', 'itwo-test-files')), 'the buckets accept exactly jpg/png/webp/heic/heif/pdf/docx/xlsx/pptx/doc/xls/txt/csv');
-- policies ของ Storage
select ok((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('itwo_files_read', 'itwo_files_upload', 'itwo_test_files_read', 'itwo_test_files_upload', 'itwo_test_files_delete')) = 5, 'the five itwo Storage policies exist');
select ok(not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'itwo\_%' and (cmd = 'UPDATE' or cmd = 'ALL' or (policyname like 'itwo\_files\_%' and cmd = 'DELETE'))), 'no itwo policy allows UPDATE (no overwrite) and the live bucket has no DELETE policy');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZVA', 'แผนกทดสอบ V-A (มีผู้จัดการ)', 'ZV A'), ('ZVB', 'แผนกทดสอบ V-B (ไม่มีผู้จัดการ)', 'ZV B');
insert into auth.users (id, email, raw_user_meta_data)
select ('2d700000-0000-0000-0000-0000000000' || n)::uuid, 'itv-u' || n || '@test.local', '{}'::jsonb
from unnest(array['01', '02', '03', '04', '05', '06', '07']) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itv.test', d.id, r.id, v.uid::uuid, true
from (values
  ('ITV-REQ1', 'ZVA', 'staff', '2d700000-0000-0000-0000-000000000001'),
  ('ITV-REQ2', 'ZVA', 'staff', '2d700000-0000-0000-0000-000000000002'),
  ('ITV-MGR', 'ZVA', 'department_manager', '2d700000-0000-0000-0000-000000000003'),
  ('ITV-ADM', 'MGT', 'staff', '2d700000-0000-0000-0000-000000000004'),
  ('ITV-APPR', 'MGT', 'general_manager', '2d700000-0000-0000-0000-000000000005'),
  ('ITV-REQB', 'ZVB', 'staff', '2d700000-0000-0000-0000-000000000006'),
  ('ITV-SBXADMIN', 'MGT', 'admin', '2d700000-0000-0000-0000-000000000007')
) as v(no, dep, role, uid)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITV-ADM', true, false), ('ITV-APPR', true, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZV-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZVA', 'sbx-zv-staff@sandbox.local', (select id from public.departments where code = 'ZVA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZV-MGR', 'ทดสอบ', 'ผจก. ZVA', 'sbx-zv-mgr@sandbox.local', (select id from public.departments where code = 'ZVA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. A) ถอดส่วนสิทธิ์ในระบบ ------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_create('system_access', null, 'no', null, 'ขอสิทธิ์', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'ใบสั่งงาน IT ไม่รับประเภท "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)', 'a new request of type system_access is refused');
select throws_ok($$ select * from public.app_itwo_create('bogus', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาเลือกประเภทคำขอ', 'an unknown type still gets the old message');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_work_orders), 0, 'the refused system_access request did not create a row');
select is((select last_seq::int from public.itwo_doc_counters where not is_test), null, 'the refused request did not consume a document number');
select throws_ok($$ insert into public.itwo_work_orders (doc_no, doc_year, doc_seq, requester_id, department_id, request_type, attachment_flag, details, needed_date) select 'IT06-99/998', 2099, 998, e.id, e.department_id, 'system_access', 'no', 'x', current_date from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', 'ใบสั่งงาน IT ไม่รับประเภท "สิทธิ์การใช้งานในระบบคอมพิวเตอร์" แล้ว (แยกเป็นโมดูลขอสิทธิ์ต่างหาก)', 'the database itself refuses a new system_access row (the legacy rows stay, new ones are blocked)');

-- 4. B) เบ็ดเตล็ดต้องระบุงาน -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_create('misc', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false) $$, '23514', 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร', 'misc without a detail is refused');
select throws_ok($$ select * from public.app_itwo_create('misc', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false, E'  \t\n ') $$, '23514', 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร', 'misc with a blank detail is refused');
select throws_ok($$ select * from public.app_itwo_create('misc', null, 'no', null, 'x', ((now() at time zone 'Asia/Bangkok')::date + 3), false, repeat('ก', 201)) $$, '23514', 'งานเบ็ดเตล็ดต้องไม่เกิน 200 ตัวอักษร', 'the misc detail is limited to 200 characters');
select set_config('t.misc', (select id::text from public.app_itwo_create('misc', null, 'no', null, 'ทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false, '  ซ่อมโปรเจกเตอร์ห้องประชุม  ')), true);
select is(public.app_itwo_get_detail(current_setting('t.misc')::uuid)->>'misc_detail', 'ซ่อมโปรเจกเตอร์ห้องประชุม', 'the misc detail is trimmed and returned by get_detail');
select is(public.app_itwo_get_detail(current_setting('t.misc')::uuid)->>'request_type', 'misc', 'the request type is misc');
select is((select misc_detail from public.app_itwo_list_mine() where id = current_setting('t.misc')::uuid), 'ซ่อมโปรเจกเตอร์ห้องประชุม', 'list_mine returns the misc detail');
select set_config('t.design', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false, 'ไม่ควรถูกเก็บ')), true);
select is(public.app_itwo_get_detail(current_setting('t.design')::uuid)->>'misc_detail', null, 'a non-misc request stores no misc detail even if one is sent');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select misc_detail from public.app_itwo_list_pending_approvals() where id = current_setting('t.misc')::uuid), 'ซ่อมโปรเจกเตอร์ห้องประชุม', 'list_pending_approvals returns the misc detail');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select misc_detail from public.app_itwo_list_it() where id = current_setting('t.misc')::uuid), 'ซ่อมโปรเจกเตอร์ห้องประชุม', 'list_it returns the misc detail');
select is((select rework_round from public.app_itwo_list_it() where id = current_setting('t.misc')::uuid), 0, 'list_it reports rework round 0 for a request that was never reworked');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set misc_detail = 'แก้ย้อนหลัง' where id = current_setting('t.misc')::uuid $$, '42501', 'ใบสั่งงานแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)', 'the misc detail cannot be edited afterwards (the content guard covers the new column)');
select throws_ok($$ insert into public.itwo_work_orders (doc_no, doc_year, doc_seq, requester_id, department_id, request_type, attachment_flag, details, needed_date) select 'IT06-99/997', 2099, 997, e.id, e.department_id, 'misc', 'no', 'x', current_date from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', 'กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร', 'the database refuses a new misc row without a detail');
select throws_ok($$ insert into public.itwo_work_orders (doc_no, doc_year, doc_seq, requester_id, department_id, request_type, attachment_flag, details, needed_date, misc_detail) select 'IT06-99/996', 2099, 996, e.id, e.department_id, 'design', 'no', 'x', current_date, 'ไม่ใช่ misc' from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', null, 'a detail on a non-misc row violates the check constraint');
select lives_ok($$ update public.itwo_work_orders set status = 'cancelled' where id = current_setting('t.design')::uuid $$, 'a status change is still allowed (the insert-only rule does not block updates)');

-- 5. E) ผู้แจ้งคนเดียวแจ้งได้หลายใบ ----------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_mine()), 2, 'one requester has filed several requests (nothing limits it) and list_mine shows them all');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(not exists (select 1 from pg_index i where i.indrelid = 'public.itwo_work_orders'::regclass and i.indisunique and i.indnatts = 1 and i.indkey[0] = (select a.attnum from pg_attribute a where a.attrelid = 'public.itwo_work_orders'::regclass and a.attname = 'requester_id')), 'there is no unique index on requester_id');

-- 6. D) ขอแก้ไขงาน -------------------------------------------------------
-- ใบ O1: REQ1 แจ้ง (เอกสารแนบ = ไม่มี) -> ผจก. -> ผู้อนุมัติ IT -> IT เริ่ม -> IT ปิด
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'งานออกแบบที่จะขอแก้ไข', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.o2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบที่ยังไม่ปิดงาน', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'แก้หน่อย', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น', 'a rework cannot be requested before IT closes the work');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the department manager approves O1');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o2')::uuid) $$, 'the department manager approves O2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the IT approver approves O1');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o2')::uuid) $$, 'the IT approver approves O2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, 'IT starts O1');
select lives_ok($$ select public.app_itwo_start(current_setting('t.o2')::uuid) $$, 'IT starts O2');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT closes O1');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'it_closed', 'O1 waits for the requester');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'IT has no action on a closed request');
-- ผู้ไม่ใช่ผู้แจ้ง / สถานะผิด
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'IT ขอเอง', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้', 'IT cannot request a rework on behalf of the requester');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'เพื่อนร่วมแผนก', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้', 'a colleague cannot request a rework');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'ผจก.', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ขอแก้ไขงานได้', 'the department manager cannot request a rework either');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o2')::uuid, 'ยังไม่ปิด', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น', 'a rework cannot be requested while the request is in progress');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions', '["cancel"]'::jsonb, 'before IT has ever closed it, an in-progress request can still be cancelled by the requester');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.design')::uuid, 'ยกเลิกแล้ว', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be reworked');
select throws_ok($$ select * from public.app_itwo_request_rework('00000000-0000-0000-0000-000000000000', 'x', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'ไม่พบใบสั่งงานนี้', 'an unknown request is refused');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["receive", "request_rework"]'::jsonb, 'the requester may receive the work or request a rework');
-- ตรวจข้อมูลที่กรอก
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, '   ', ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข', 'the rework needs details');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, null, ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข', 'null details are refused');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, repeat('ก', 2001), ((now() at time zone 'Asia/Bangkok')::date + 5)) $$, '23514', 'รายละเอียดที่ต้องการให้แก้ไขต้องไม่เกิน 2,000 ตัวอักษร', 'the rework details are limited to 2000 characters');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'แก้ไข', null) $$, '23514', 'กรุณาระบุวันที่ต้องการให้แก้ไขเสร็จ', 'the due date is required');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'แก้ไข', ((now() at time zone 'Asia/Bangkok')::date - 1)) $$, '23514', 'วันที่ต้องการให้แก้ไขเสร็จต้องไม่ใช่วันที่ผ่านมาแล้ว', 'the due date cannot be in the past (Thai date)');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'it_closed', 'refused attempts did not change the status');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'reworks'), 0, 'refused attempts did not create a rework');
-- รอบที่ 1 (เก็บ id ไว้ใช้แนบไฟล์)
select set_config('t.rw1', (select id::text from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'ขอแก้สีโลโก้ให้เข้มขึ้น', ((now() at time zone 'Asia/Bangkok')::date))), true);
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'in_progress', 'the request goes back to in_progress at once (no new approval)');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e), 'created,dept_approved,it_mgr_approved,started,completed,rework_requested', 'the history gets a rework_requested event and no new approval');
select ok((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events'->5->>'reason') like 'ขอแก้ไขงานรอบที่ 1 ต้องการภายใน %: ขอแก้สีโลโก้ให้เข้มขึ้น', 'the event reason summarizes round, due date and details');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events'->5->>'actor_employee_no', 'ITV-REQ1', 'the rework event is signed by the requester');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'rework_round')::int, 1, 'get_detail reports rework round 1');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'latest_due_date')::date, ((now() at time zone 'Asia/Bangkok')::date), 'the latest due date is the rework due date (today is allowed)');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'reworks'->0->>'details', 'ขอแก้สีโลโก้ให้เข้มขึ้น', 'get_detail lists the rework details');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'reworks'->0->>'requested_by_employee_no', 'ITV-REQ1', 'get_detail names who requested the rework');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'needed_date', ((now() at time zone 'Asia/Bangkok')::date + 3)::text, 'the original needed date is kept');
-- การรับงานเป็นขั้นสุดท้ายเสมอ: ใบที่ IT เคยปิดงานแล้ว (มี completed) ผู้แจ้งยกเลิกไม่ได้อีก แม้กลับมา in_progress เพราะขอแก้ไขงาน
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'the requester has no action while the rework is in progress (cancel is gone once IT has closed the request)');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'ไม่เอาแล้ว') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'a request IT has already closed once cannot be cancelled during a rework');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set status = 'cancelled' where id = current_setting('t.o1')::uuid $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'the status guard also refuses to cancel a request that has a completed event');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select rework_round from public.app_itwo_list_mine() where id = current_setting('t.o1')::uuid), 1, 'list_mine shows rework round 1');
select is((select rework_due_date from public.app_itwo_list_mine() where id = current_setting('t.o1')::uuid), ((now() at time zone 'Asia/Bangkok')::date), 'list_mine shows the rework due date');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["complete", "request_info"]'::jsonb, 'IT can close the reworked request again (or ask the requester)');
select is((select rework_round from public.app_itwo_list_it() where id = current_setting('t.o1')::uuid), 1, 'list_it shows that this is rework round 1');
select is((select rework_due_date from public.app_itwo_list_it() where id = current_setting('t.o1')::uuid), ((now() at time zone 'Asia/Bangkok')::date), 'list_it shows the due date of the rework');
select is((select id from public.app_itwo_list_it() where status = 'in_progress' order by is_urgent desc, coalesce(rework_due_date, needed_date) limit 1), current_setting('t.o1')::uuid, 'list_it sorts a reworked request by the rework due date (earlier than the other in-progress request)');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้เริ่มดำเนินการไปแล้ว', 'IT does not need to start the request again');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT closes the request again after the rework');
-- รอบที่ 2 และ 3 (ไม่จำกัดจำนวนครั้ง)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["receive", "request_rework"]'::jsonb, 'after the second close the requester can again receive or rework');
select is((select round_no from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'รอบสอง: ปรับขนาดตัวอักษร', ((now() at time zone 'Asia/Bangkok')::date + 7))), 2, 'the second rework is round 2');
select set_config('t.rw2', (select r.id::text from jsonb_to_recordset(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'reworks') as r(id uuid, round_no int) where r.round_no = 2), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT closes after round 2');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select round_no from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'รอบสาม', ((now() at time zone 'Asia/Bangkok')::date + 9))), 3, 'the third rework is round 3 (no limit on the number of rounds)');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'latest_due_date')::date, ((now() at time zone 'Asia/Bangkok')::date + 9), 'the latest due date follows the newest round');
select is((select string_agg((r->>'round_no') || ':' || (r->>'due_date'), ',' order by (r->>'round_no')::int) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'reworks') r), '1:' || ((now() at time zone 'Asia/Bangkok')::date)::text || ',2:' || ((now() at time zone 'Asia/Bangkok')::date + 7)::text || ',3:' || ((now() at time zone 'Asia/Bangkok')::date + 9)::text, 'all rounds are listed in order');
select is((select count(*)::int from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e where e->>'action' = 'rework_requested'), 3, 'three rework events are recorded');
select is((select count(*)::int from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e where e->>'action' in ('dept_approved', 'it_mgr_approved')), 2, 'the approvals were never repeated');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT closes after round 3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_receive(current_setting('t.o1')::uuid) $$, 'the requester finally confirms receipt');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status'), 'received', 'the request is finished');
select throws_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'หลังจบงาน', ((now() at time zone 'Asia/Bangkok')::date + 9)) $$, '23514', 'ใบสั่งงานนี้จบงานแล้ว (ได้รับงานแล้ว) ขอแก้ไขไม่ได้', 'a finished request cannot be reworked');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'a finished request offers no action');
-- ISO: รอบแก้ไขเพิ่มได้อย่างเดียว และสถานะย้อนกลับได้ตามตารางเท่านั้น
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_reworks set details = 'แก้ย้อนหลัง' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a rework cannot be edited afterwards');
select throws_ok($$ delete from public.itwo_reworks $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a real rework cannot be deleted');
select throws_ok($$ truncate public.itwo_reworks, public.itwo_attachments $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the rework and attachment tables cannot be truncated');
select throws_ok($$ update public.itwo_work_orders set status = 'in_progress' where id = current_setting('t.o1')::uuid $$, '23514', 'เปลี่ยนสถานะใบสั่งงานจาก received เป็น in_progress ไม่ได้', 'a finished request cannot be reopened by the status guard');
select throws_ok($$ update public.itwo_work_orders set status = 'in_progress' where id = current_setting('t.design')::uuid $$, '23514', 'เปลี่ยนสถานะใบสั่งงานจาก cancelled เป็น in_progress ไม่ได้', 'a cancelled request cannot be reopened by the status guard');
select throws_ok($$ update public.itwo_work_orders set status = 'approved' where id = current_setting('t.o2')::uuid $$, '23514', 'เปลี่ยนสถานะใบสั่งงานจาก in_progress เป็น approved ไม่ได้', 'the guard still blocks every other backward step');
select lives_ok($$ update public.itwo_work_orders set status = 'it_closed' where id = current_setting('t.o2')::uuid $$, 'the normal forward step still works');
select lives_ok($$ update public.itwo_work_orders set status = 'in_progress' where id = current_setting('t.o2')::uuid $$, 'it_closed -> in_progress is the one new backward step the guard allows');
select throws_ok($$ insert into public.itwo_events (is_test, work_order_id, actor_id, action) select false, current_setting('t.o2')::uuid, e.id, 'bogus' from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', null, 'the events constraint still rejects unknown actions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- O2 ไม่เคยมี completed (ขยับสถานะตรงๆ ด้านบน ไม่ผ่าน app_itwo_complete) จึงต้องยกเลิกผ่าน RPC ได้: ล็อกว่า trigger guard ชั้นสองไม่บล็อกกรณีที่ควรผ่าน
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.o2')::uuid, 'ไม่ต้องการแล้ว') $$, 'an in-progress request IT has never closed can still be cancelled by the requester (the status guard lets it through)');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->>'status', 'cancelled', 'and it is cancelled');
select throws_ok($$ select count(*) from public.itwo_reworks $$, '42501', null, 'an authenticated user cannot read the rework table directly');
select throws_ok($$ insert into public.itwo_reworks (work_order_id, round_no, details, due_date, requested_by) values (gen_random_uuid(), 1, 'x', current_date, gen_random_uuid()) $$, '42501', null, 'an authenticated user cannot write the rework table directly');

-- 7. C) แนบไฟล์ -----------------------------------------------------------
-- ใบ OA (แนบ = มี, REQ1) · OB (แนบ = ไม่มี, REQ1) · OC (แนบ = มี, REQ2) · OD (cap) · OE (จะมีผู้อนุมัติ) · OF (ผจก.แจ้งเอง) · OG (ยกเลิก) · OH (ผู้อนุมัติ IT แจ้งเอง)
select set_config('t.oa', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบมีไฟล์แนบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.ob', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบไม่มีไฟล์แนบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.od', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบทดสอบเพดานโฟลเดอร์', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.oe', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบที่จะมีผู้อนุมัติ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.og', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบที่จะยกเลิก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.og')::uuid, 'ไม่ใช้แล้ว') $$, 'OG is cancelled');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('t.oc', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบของเพื่อนร่วมแผนก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('t.of', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ผจก.แจ้งเอง', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('t.oh', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ผู้อนุมัติ IT แจ้งเอง', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is((public.app_itwo_get_detail(current_setting('t.oh')::uuid)->>'status'), 'approved', 'the IT approver request is approved at once (auto approvals are not real approvals)');

-- 7.1 อัปโหลดผ่าน policy (ผู้แจ้งเท่านั้น ใน path ของใบตัวเอง)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 2048, "mimetype": "application/pdf"}'::jsonb) $$, 'the requester uploads a file into the folder of an order with attachment = yes');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 2048}'::jsonb) $$, '23505', null, 'the same path cannot be overwritten (unique name, no upsert)');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/มีชื่อไทย.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'a path that is not <order>/<uuid>.<ext> is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000002.exe', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'an extension outside the allowed list is refused');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/AAAAAAAA-0000-0000-0000-000000000002.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'the file name must be a lower-case uuid');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000003.pdf', '2d700000-0000-0000-0000-000000000002', '{"size": 1}'::jsonb) $$, '42501', null, 'the owner of the object must be the caller');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.ob') || '/aaaaaaaa-0000-0000-0000-000000000004.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'no upload into an order with attachment = no');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oc') || '/aaaaaaaa-0000-0000-0000-000000000005.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'no upload into the folder of another requester order');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', '00000000-0000-0000-0000-000000000000/aaaaaaaa-0000-0000-0000-000000000006.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'no upload into a folder of an order that does not exist');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-test-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000007.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'a real order cannot receive files in the test bucket');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.og') || '/aaaaaaaa-0000-0000-0000-000000000008.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'no upload into a cancelled order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000009.pdf', '2d700000-0000-0000-0000-000000000002', '{"size": 1}'::jsonb) $$, '42501', null, 'a colleague cannot upload into the order of someone else');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000010.pdf', '2d700000-0000-0000-0000-000000000003', '{"size": 1}'::jsonb) $$, '42501', null, 'the department manager cannot upload into the order of an employee');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000011.pdf', '2d700000-0000-0000-0000-000000000004', '{"size": 1}'::jsonb) $$, '42501', null, 'IT cannot upload into the order of an employee');
-- ผู้ที่ล็อกอินไม่ได้ (anon) ไม่มีสิทธิ์เลย
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000012.pdf', null, '{"size": 1}'::jsonb) $$, '42501', null, 'anon cannot upload');
reset role;

-- 7.2 อ่านไฟล์ตามสิทธิ์เห็นใบ
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the requester sees the file of the own order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'the department manager of the requester sees the file');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.oa') || '/')), 1, 'IT staff sees the file');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.oa') || '/')), 0, 'a colleague of the same department cannot see the file');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.oa') || '/')), 0, 'an employee of another department cannot see the file');
reset role;
select set_config('request.jwt.claims', '', true);
set local role anon;
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files'), 0, 'anon sees no file');
reset role;

-- 7.3 ลงทะเบียนไฟล์ (app_itwo_add_attachment)
-- ใส่วัตถุใน Storage แทนการอัปโหลดผ่าน API (ด้วยสิทธิ์เจ้าของฐานข้อมูล) · ขนาด/ชนิดอยู่ใน metadata เหมือน Storage จริง
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.ob') || '/aaaaaaaa-0000-0000-0000-000000000021.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oc') || '/aaaaaaaa-0000-0000-0000-000000000022.pdf', '2d700000-0000-0000-0000-000000000002', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000023.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/zip"}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000024.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 20971521, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000025.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 20971520, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000026.pdf', '2d700000-0000-0000-0000-000000000009', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.og') || '/aaaaaaaa-0000-0000-0000-000000000027.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}');
-- วัตถุที่ metadata ไม่สมบูรณ์ หรือนามสกุลไม่ตรงชนิด (ต้องถูกปฏิเสธ แม้ผู้เรียกส่งชนิด/ขนาดที่ดูถูกต้องมา)
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000031.jpg', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000032.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100}'),
  ('itwo-files', current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000033.pdf', '2d700000-0000-0000-0000-000000000001', '{"mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.att1', public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', '  รายงาน.pdf  ', 'application/pdf', 1)::text, true);
select ok(current_setting('t.att1')::uuid is not null, 'the uploaded file is registered and an id is returned');
select is(public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', 'รายงาน.pdf', 'application/pdf', 1)::text, current_setting('t.att1'), 'registering the same path again returns the same id (safe retry)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.ob')::uuid, null, current_setting('t.ob') || '/aaaaaaaa-0000-0000-0000-000000000021.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ใบสั่งงานนี้ไม่ได้เลือกเอกสารแนบเป็น "มี" จึงแนบไฟล์ไม่ได้', 'the attachment flag must be "yes"');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oc') || '/aaaaaaaa-0000-0000-0000-000000000022.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'a file of another order cannot be registered');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, 'ไม่ใช่path', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'a malformed path is refused');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, null, 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'a null path is refused');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oc')::uuid, null, current_setting('t.oc') || '/aaaaaaaa-0000-0000-0000-000000000022.pdf', 'x.pdf', 'application/pdf', 100) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบสั่งงานได้', 'only the requester can register files for an order (colleague order)');
select throws_ok($$ select public.app_itwo_add_attachment('00000000-0000-0000-0000-000000000000', null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบใบสั่งงานนี้', 'an unknown order is refused');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000030.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'the file must exist in Storage');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000026.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'a file uploaded by somebody else cannot be registered by the caller');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000023.pdf', 'x.zip', 'application/zip', 100) $$, '23514', 'ชนิดไฟล์นี้ไม่รองรับ (รับรูปภาพ PDF Word Excel PowerPoint ข้อความ และ CSV)', 'a file type outside the list is refused');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000024.pdf', 'big.pdf', 'application/pdf', 100) $$, '23514', 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB', 'a file above 20 MB is refused (the size comes from Storage, not from the caller)');
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000025.pdf', 'exactly20.pdf', 'application/pdf', 1) $$, 'a file of exactly 20 MB is accepted');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000031.jpg', 'x.jpg', 'image/jpeg', 100) $$, '23514', 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่', 'the extension in the path must match the Storage mimetype (.jpg stored as application/pdf is refused even if the caller says image/jpeg)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000032.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'a Storage object without a mimetype is refused (the caller value is not a fallback)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000033.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ตรวจชนิดหรือขนาดของไฟล์ที่อัปโหลดไม่ได้ กรุณาอัปโหลดไฟล์ใหม่', 'a Storage object without a size is refused (the caller value is not a fallback)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', '   ', 'application/pdf', 1) $$, '23514', 'กรุณาระบุชื่อไฟล์', 'a blank file name is refused (even for a registered path the name is checked first)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.og')::uuid, null, current_setting('t.og') || '/aaaaaaaa-0000-0000-0000-000000000027.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้', 'a cancelled order cannot get files');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, gen_random_uuid(), current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000023.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบรอบขอแก้ไขงานนี้', 'an unknown rework id is refused');
reset role;
select set_config('request.jwt.claims', '', true);
select ok(
  (select bool_and(private.itwo_ext_matches_mime('x/y.' || m.ext, m.mime) = m.expected)
   from (values
     ('jpg', 'image/jpeg', true), ('jpeg', 'image/jpeg', true), ('png', 'image/png', true), ('webp', 'image/webp', true),
     ('heic', 'image/heic', true), ('heif', 'image/heif', true), ('pdf', 'application/pdf', true),
     ('docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', true),
     ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true),
     ('pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', true),
     ('doc', 'application/msword', true), ('xls', 'application/vnd.ms-excel', true), ('txt', 'text/plain', true), ('csv', 'text/csv', true),
     ('pdf', 'image/jpeg', false), ('jpg', 'image/png', false), ('heic', 'image/heif', false), ('docx', 'application/msword', false),
     ('doc', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', false), ('txt', 'text/csv', false),
     ('csv', 'application/vnd.ms-excel', false), ('ppt', 'application/vnd.ms-powerpoint', false), ('exe', 'application/pdf', false)
   ) as m(ext, mime, expected))
  and not private.itwo_ext_matches_mime('noextension', 'application/pdf') and not private.itwo_ext_matches_mime(null, 'application/pdf'),
  'the extension-to-mimetype table matches every allowed type, rejects crossed pairs, .ppt and unknown or missing extensions');
select is((select mime_type || '|' || size_bytes || '|' || file_name from public.itwo_attachments where id = current_setting('t.att1')::uuid), 'application/pdf|2048|รายงาน.pdf', 'size and type come from Storage (2048), the file name is trimmed, the caller values were ignored');
select is((select uploaded_by from public.itwo_attachments where id = current_setting('t.att1')::uuid), (select id from public.employees where employee_no = 'ITV-REQ1'), 'the uploader is the requester');
select is((select count(*)::int from public.itwo_attachments where work_order_id = current_setting('t.oa')::uuid), 2, 'two files are registered on OA so far (the 20 MB one and the first)');

-- 7.4 ≤ 10 ไฟล์ต่อครั้งที่ส่ง (ตอนแจ้ง)
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.oa') || '/bbbbbbbb-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'
from generate_series(1, 9) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/bbbbbbbb-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', 'f' || g || '.pdf', 'application/pdf', 100)) from generate_series(1, 8) g)::int, 8, 'eight more files are registered (ten in total on OA)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/bbbbbbbb-0000-0000-0000-000000000009.pdf', 'f9.pdf', 'application/pdf', 100) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง', 'the eleventh file at filing time is refused');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.oa')::uuid)->'attachments'), 10, 'get_detail lists the ten files');
select is(public.app_itwo_get_detail(current_setting('t.oa')::uuid)->'attachments'->0->>'bucket', 'itwo-files', 'each file names the bucket to download from');
select is((select count(*)::int from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.oa')::uuid)->'attachments') a where (a->>'round_no')::int = 0 and a->>'rework_id' is null), 10, 'files attached at filing time are round 0 with no rework id');
select ok(public.app_itwo_get_detail(current_setting('t.oa')::uuid)->'attachments'->0 ?& array['id', 'storage_path', 'file_name', 'mime_type', 'size_bytes', 'created_at', 'uploaded_by_full_name'], 'each file entry carries the fields the page needs');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.oa')::uuid)->'attachments'), 10, 'the department manager sees the file list too');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_get_detail(current_setting('t.oa')::uuid) $$, '42501', 'ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague cannot read the file list (no access to the order)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/bbbbbbbb-0000-0000-0000-000000000009.pdf', 'f9.pdf', 'application/pdf', 100) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบสั่งงานได้', 'a colleague cannot register files for the order of someone else');

-- 7.5 เพดานจำนวนไฟล์ในโฟลเดอร์ (กัน spam ที่อัปโหลดแล้วไม่ลงทะเบียน) = 20 ต่อ (1 + จำนวนรอบแก้ไข)
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.od') || '/cccccccc-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1, "mimetype": "application/pdf"}'
from generate_series(1, 19) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.od') || '/cccccccc-0000-0000-0000-000000000099.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, 'the twentieth object in the folder is allowed');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.od') || '/cccccccc-0000-0000-0000-000000000098.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'the twenty-first object in the folder is refused (anti-spam cap)');

-- 7.6 ไม่มีการแก้/ลบไฟล์ผ่าน API ของบัคเก็ตจริง (policy ไม่มี UPDATE/DELETE)
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itwo-files' and name = current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf';
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and name = current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf'), 1, 'the requester cannot delete a file of the live bucket (no DELETE policy)');
update storage.objects set metadata = '{"size": 1, "mimetype": "application/pdf"}'::jsonb where bucket_id = 'itwo-files' and name = current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf';
reset role;
select set_config('request.jwt.claims', '', true);
select is((select metadata->>'size' from storage.objects where bucket_id = 'itwo-files' and name = current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf'), '2048', 'the requester cannot rewrite a file (no UPDATE policy)');

-- 7.7 หน้าต่างเวลา และการอนุมัติจริงปิดการแนบ
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '-1 second' $$;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.oa') || '/dddddddd-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000002.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'when the time window is over, uploads are refused by the policy');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oe')::uuid, null, current_setting('t.oa') || '/dddddddd-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'sanity: the path check runs before the time check');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000003.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oe')::uuid, null, current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000003.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)', 'registering after the time window is refused');
reset role;
-- คืนค่าเดิม (30 นาที) แล้วทดสอบการอนุมัติจริง
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '30 minutes' $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.oe')::uuid, null, current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000003.pdf', 'ก่อนอนุมัติ.pdf', 'application/pdf', 100) $$, 'inside the window and before any approval the file is registered');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000004.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, 'and the upload is allowed too');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oe')::uuid) $$, 'the department manager approves OE (a real approval)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oe')::uuid, null, current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000004.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'มีผู้อนุมัติใบสั่งงานนี้แล้ว แนบไฟล์เพิ่มไม่ได้', 'after a real approval no more files can be registered');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.oe') || '/dddddddd-0000-0000-0000-000000000005.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'and no more uploads are allowed');
-- การอนุมัติอัตโนมัติตอนแจ้งเอง (ผจก. / ผู้อนุมัติ IT) ไม่ปิดการแนบ
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.of') || '/dddddddd-0000-0000-0000-000000000006.pdf', '2d700000-0000-0000-0000-000000000003', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-files', current_setting('t.oh') || '/dddddddd-0000-0000-0000-000000000007.pdf', '2d700000-0000-0000-0000-000000000005', '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.of')::uuid, null, current_setting('t.of') || '/dddddddd-0000-0000-0000-000000000006.pdf', 'ผจก.pdf', 'application/pdf', 100) $$, 'the automatic department approval of a manager who files does not close the window');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.oh')::uuid, null, current_setting('t.oh') || '/dddddddd-0000-0000-0000-000000000007.pdf', 'อนุมัติเอง.pdf', 'application/pdf', 100) $$, 'the automatic double approval of the IT approver who files does not close the window either');
reset role;
select set_config('request.jwt.claims', '', true);

-- 7.8 ISO: ทะเบียนไฟล์เพิ่มได้อย่างเดียว
select throws_ok($$ update public.itwo_attachments set file_name = 'แก้ชื่อ' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a registered file cannot be edited');
select throws_ok($$ delete from public.itwo_attachments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a registered real file cannot be deleted');
select throws_ok($$ insert into public.itwo_attachments (is_test, work_order_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) select false, current_setting('t.oa')::uuid, current_setting('t.ob') || '/eeeeeeee-0000-0000-0000-000000000001.pdf', 'x', 'application/pdf', 1, e.id from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', null, 'a registered path must sit under the folder of its own order (check constraint)');
select throws_ok($$ insert into public.itwo_attachments (is_test, work_order_id, rework_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) select false, current_setting('t.oa')::uuid, current_setting('t.rw1')::uuid, current_setting('t.oa') || '/eeeeeeee-0000-0000-0000-000000000002.pdf', 'x', 'application/pdf', 1, e.id from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23503', null, 'a file cannot point to a rework of another order (foreign key)');
select throws_ok($$ insert into public.itwo_attachments (is_test, work_order_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) select false, current_setting('t.oa')::uuid, current_setting('t.oa') || '/eeeeeeee-0000-0000-0000-000000000003.pdf', 'x', 'application/pdf', 20971521, e.id from public.employees e where e.employee_no = 'ITV-REQ1' $$, '23514', null, 'the table itself limits a file to 20 MB');
-- ไฟล์ของใบจริงที่ (ผิดพลาด) วางในบัคเก็ตทดสอบ: ไม่มีใครในโลกจริงเห็นได้ แม้เป็นผู้แจ้งเอง
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-test-files', current_setting('t.oa') || '/66666666-0000-0000-0000-000000000002.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files'), 0, 'a file of a real order that sits in the test bucket is invisible to its own requester (the bucket must match the mode of the order)');
select throws_ok($$ select count(*) from public.itwo_attachments $$, '42501', null, 'an authenticated user cannot read the attachment table directly');
select throws_ok($$ insert into public.itwo_attachments (work_order_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values (gen_random_uuid(), 'x', 'x', 'x', 1, gen_random_uuid()) $$, '42501', null, 'an authenticated user cannot write the attachment table directly');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itwo-test-files' and name like '%66666666-0000-0000-0000-000000000002.pdf';
select set_config('storage.allow_delete_query', 'false', true);

-- 8. D+C) ไฟล์แนบของรอบแก้ไข --------------------------------------------
-- O1 (แนบ = ไม่มี) อยู่ในสถานะ received แล้ว จึงสร้างใบใหม่ O3 ที่ผ่านขั้นตอนถึง it_closed เพื่อทดสอบแนบไฟล์กับรอบแก้ไข
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบสำหรับแนบไฟล์รอบแก้ไข', ((now() at time zone 'Asia/Bangkok')::date + 3), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o3')::uuid) $$, 'dept approval of O3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o3')::uuid) $$, 'IT approval of O3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.o3')::uuid) $$, 'IT starts O3');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o3')::uuid) $$, 'IT closes O3');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
-- ก่อนขอแก้ไข: ผู้แจ้งอัปโหลดเข้าใบที่ปิดงานแล้วไม่ได้ (flag = ไม่มี และยังไม่มีรอบแก้ไข)
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'before a rework exists the requester cannot upload to a closed request');
select set_config('t.rw3', (select id::text from public.app_itwo_request_rework(current_setting('t.o3')::uuid, 'แก้ตามไฟล์แนบ', ((now() at time zone 'Asia/Bangkok')::date + 2))), true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, 'after the rework request the requester can upload files for that round (the order flag "no" does not matter)');
select is(public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw3')::uuid, current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000001.pdf', 'ภาพที่ต้องแก้.pdf', 'application/pdf', 100) is not null, true, 'the file is registered against the rework round');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, null, current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว', 'a file registered for a rework cannot be registered again for the original filing');
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000002.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw1')::uuid, current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000002.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบรอบขอแก้ไขงานนี้', 'a rework id of another order is refused');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, null, current_setting('t.o3') || '/ffffffff-0000-0000-0000-000000000002.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ใบสั่งงานนี้ไม่ได้เลือกเอกสารแนบเป็น "มี" จึงแนบไฟล์ไม่ได้', 'without a rework id the original attachment flag still applies');
-- 10 ไฟล์ต่อรอบ
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.o3') || '/11111111-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'
from generate_series(1, 10) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is((select count(public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw3')::uuid, current_setting('t.o3') || '/11111111-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', 'r1-' || g || '.pdf', 'application/pdf', 100)) from generate_series(1, 9) g)::int, 9, 'nine more files are registered for round 1 (ten in total)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw3')::uuid, current_setting('t.o3') || '/11111111-0000-0000-0000-000000000010.pdf', 'r1-10.pdf', 'application/pdf', 100) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง', 'the eleventh file of one rework round is refused');
-- รอบ 2 มีโควตา 10 ไฟล์ของตัวเอง และรอบ 1 แนบเพิ่มไม่ได้อีก
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o3')::uuid) $$, 'IT closes O3 after round 1');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.rw4', (select id::text from public.app_itwo_request_rework(current_setting('t.o3')::uuid, 'รอบสอง', ((now() at time zone 'Asia/Bangkok')::date + 4))), true);
reset role;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.o3') || '/22222222-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 100, "mimetype": "application/pdf"}'
from generate_series(1, 11) g;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw3')::uuid, current_setting('t.o3') || '/22222222-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'แนบไฟล์ได้เฉพาะรอบขอแก้ไขงานล่าสุดของคุณ', 'files can only be added to the latest rework round');
select is((select count(public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw4')::uuid, current_setting('t.o3') || '/22222222-0000-0000-0000-' || lpad(g::text, 12, '0') || '.pdf', 'r2-' || g || '.pdf', 'application/pdf', 100)) from generate_series(1, 10) g)::int, 10, 'round 2 has its own quota of ten files');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o3')::uuid, current_setting('t.rw4')::uuid, current_setting('t.o3') || '/22222222-0000-0000-0000-000000000011.pdf', 'r2-11.pdf', 'application/pdf', 100) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อครั้งที่ส่ง', 'the eleventh file of round 2 is refused');
select is((select jsonb_object_agg(k, c) from (select a->>'round_no' as k, count(*)::int as c from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->'attachments') a group by a->>'round_no') x), '{"1": 10, "2": 10}'::jsonb, 'get_detail separates the files by round (ten for round 1, ten for round 2)');
select is((select count(*)::int from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->'attachments') a where a->>'rework_id' = current_setting('t.rw4')), 10, 'each file names its rework id');
-- หน้าต่างเวลาของรอบแก้ไข
reset role;
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '-1 second' $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o3') || '/33333333-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'after the time window of the rework upload is refused');
reset role;
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '30 minutes' $$;
select set_config('request.jwt.claims', '', true);

-- 9. F) โหมดทดสอบและล้างข้อมูลทดสอบ ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zv_staff')::uuid) $$, 'the admin enters the test mode as the requester persona');
select set_config('t.t1', (select id::text from public.app_itwo_create('misc', null, 'yes', null, 'ใบทดสอบมีไฟล์', ((now() at time zone 'Asia/Bangkok')::date + 3), false, 'งานทดสอบเบ็ดเตล็ด')), true);
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'is_test', 'true', 'the order is a test order');
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.t1') || '/66666666-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 1, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.t1') || '/44444444-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 1}'::jsonb) $$, '42501', null, 'a test order cannot receive files in the live bucket');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-test-files', current_setting('t.t1') || '/44444444-0000-0000-0000-000000000002.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, 'the admin uploads a test file into the test bucket (acting as the requester persona)');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-test-files', current_setting('t.oa') || '/44444444-0000-0000-0000-000000000003.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 1}'::jsonb) $$, '42501', null, 'a real order cannot receive files in the test bucket even in test mode');
select set_config('t.tatt', public.app_itwo_add_attachment(current_setting('t.t1')::uuid, null, current_setting('t.t1') || '/44444444-0000-0000-0000-000000000002.pdf', 'ทดสอบ.pdf', 'application/pdf', 100)::text, true);
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->'attachments'->0->>'bucket', 'itwo-test-files', 'a test file is served from the test bucket');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.oa')::uuid, null, current_setting('t.oa') || '/aaaaaaaa-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 100) $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a persona cannot register files on a real order');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files' and name = current_setting('t.t1') || '/44444444-0000-0000-0000-000000000002.pdf'), 1, 'the requester persona sees the test file');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files'), 0, 'a persona sees no file of the live bucket');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zv_mgr')::uuid) $$, 'switching to the department manager persona');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files' and name = current_setting('t.t1') || '/44444444-0000-0000-0000-000000000002.pdf'), 1, 'the department manager persona sees the test file (it can view the order)');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, 'the manager persona approves the test order');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switching to the IT approver persona');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, 'the IT approver persona approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select lives_ok($$ select public.app_itwo_start(current_setting('t.t1')::uuid) $$, 'the IT admin persona starts');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.t1')::uuid) $$, 'the IT admin persona closes');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zv_staff')::uuid) $$, 'back to the requester persona');
select set_config('t.trw', (select id::text from public.app_itwo_request_rework(current_setting('t.t1')::uuid, 'ขอแก้ในโหมดทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 2))), true);
select is((public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'status'), 'in_progress', 'a test order can be reworked as well');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-test-files', current_setting('t.t1') || '/44444444-0000-0000-0000-000000000004.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 100, "mimetype": "application/pdf"}'::jsonb) $$, 'a test file for the rework round is uploaded');
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.t1')::uuid, current_setting('t.trw')::uuid, current_setting('t.t1') || '/44444444-0000-0000-0000-000000000004.pdf', 'แก้ไข.pdf', 'application/pdf', 100) $$, 'and registered against the test rework');
-- ไฟล์ที่อัปโหลดแต่ไม่ได้ลงทะเบียน (orphan) ลบได้ในโหมดทดสอบ ส่วนไฟล์ที่ลงทะเบียนแล้วลบไม่ได้
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-test-files', current_setting('t.t1') || '/44444444-0000-0000-0000-000000000005.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 100, "mimetype": "application/pdf"}'),
  ('itwo-test-files', '99999999-0000-0000-0000-000000000000/55555555-0000-0000-0000-000000000001.pdf', '2d700000-0000-0000-0000-000000000007', '{"size": 100, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itwo-test-files';
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files'), 2, 'in test mode the admin can delete unregistered test files only (the two registered files stay)');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files' and name like '%44444444-0000-0000-0000-00000000000_.pdf'), 2, 'the files that stay are exactly the registered ones');
-- คนจริง (ไม่อยู่ในโหมดทดสอบ) ไม่เห็น ไม่ลบ ไฟล์ทดสอบ
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files'), 0, 'out of test mode nobody sees the test bucket');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files'), 0, 'IT staff of the real world does not see test files');
select throws_ok($$ select public.app_sandbox_purge_itwo() $$, null, 'NOT_AUTHORIZED', 'a normal user cannot purge');
-- ล้างข้อมูลทดสอบ: นับแถวทดสอบก่อน แล้วเทียบกับที่ purge รายงาน
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('t.expect_deleted', ((select count(*) from public.itwo_work_orders where is_test) + (select count(*) from public.itwo_events where is_test) + (select count(*) from public.itwo_access_changes where is_test) + (select count(*) from public.itwo_reworks where is_test) + (select count(*) from public.itwo_attachments where is_test) + (select count(*) from public.itwo_admin_log where is_test) + (select count(*) from public.itwo_doc_counters where is_test))::text, true);
select set_config('t.real_att', (select count(*)::text from public.itwo_attachments where not is_test), true);
select set_config('t.real_rw', (select count(*)::text from public.itwo_reworks where not is_test), true);
select is((select count(*)::int from public.itwo_reworks where is_test), 1, 'one test rework exists before the purge');
select is((select count(*)::int from public.itwo_attachments where is_test), 2, 'two test files are registered before the purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"2d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zv_staff')::uuid) $$, 'the admin enters the test mode again');
select set_config('t.purge', public.app_sandbox_purge_itwo()::text, true);
select is((current_setting('t.purge')::jsonb->>'deleted')::int, current_setting('t.expect_deleted')::int, 'the purge deletes every test row including the new tables');
select is(current_setting('t.purge')::jsonb->'files', to_jsonb(array[current_setting('t.t1') || '/44444444-0000-0000-0000-000000000002.pdf', current_setting('t.t1') || '/44444444-0000-0000-0000-000000000004.pdf']), 'the purge returns the paths of the files that remain in the test bucket (for the page to delete through the Storage API)');
-- หลังล้างทะเบียน ไฟล์ทั้งหมดไม่มีใครอ้างถึง ผู้ดูแลที่อยู่ในโหมดทดสอบลบผ่าน Storage API ได้
select set_config('storage.allow_delete_query', 'true', true);
delete from storage.objects where bucket_id = 'itwo-test-files' and name = any (array(select jsonb_array_elements_text(current_setting('t.purge')::jsonb->'files')));
select set_config('storage.allow_delete_query', 'false', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-test-files'), 0, 'after the purge the listed files can be removed through the Storage API (nothing references them any more)');
select is(public.app_sandbox_purge_itwo()->'files', '[]'::jsonb, 'a second purge reports no file left');
select is((public.app_sandbox_purge_itwo()->>'deleted')::int, 0, 'and deletes nothing more');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_reworks where is_test) + (select count(*)::int from public.itwo_attachments where is_test) + (select count(*)::int from public.itwo_work_orders where is_test), 0, 'no test rework, attachment or work order remains');
select is((select count(*)::int from public.itwo_attachments where not is_test)::text, current_setting('t.real_att'), 'the real attachments survived the purge');
select is((select count(*)::int from public.itwo_reworks where not is_test)::text, current_setting('t.real_rw'), 'the real reworks survived the purge');
select ok((select count(*) from storage.objects where bucket_id = 'itwo-files') > 20, 'the live bucket was not touched by the purge');
select throws_ok($$ delete from public.itwo_reworks $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real reworks still cannot be deleted after a purge');
select throws_ok($$ delete from public.itwo_attachments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real attachments still cannot be deleted after a purge');
select is(current_setting('itwo.purge', true), 'off', 'the purge flag is switched off again');

select * from finish();
rollback;
