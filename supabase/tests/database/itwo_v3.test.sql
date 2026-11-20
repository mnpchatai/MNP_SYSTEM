-- ทดสอบใบสั่งงาน IT รุ่น 3 (20261206010000_itwo_v3_request_info.sql) — สร้างจาก template ด้วย scratch script (ข้อความผู้ใช้ทดสอบเป็นบัญชีใหม่ ITW-*)
--   A) โครงสร้าง: itwo_comments (RLS deny-all, ไม่มีสิทธิ์ตรง, lab-only, trigger เพิ่มได้อย่างเดียว/โหมดทดสอบ/กติกาข้อความ), RPC ใหม่, ลายเซ็นเดิมของ app_itwo_add_attachment
--   B) ถามผู้แจ้งก่อนอนุมัติ: ขั้นแผนก (ผู้จัดการ/ผู้ช่วยผู้จัดการ) และขั้น IT (รวมกดครั้งเดียวนับสองขั้น) · ใครถามไม่ได้ · ถามซ้อนไม่ได้ · อนุมัติระหว่างรอไม่ได้ ไม่อนุมัติได้
--   C) IT ถามหลังอนุมัติ/ระหว่างทำงาน (รวมงานด่วนและรอบแก้ไข) · ระหว่างรอ เริ่ม/ส่งงานไม่ได้
--   D) ผู้แจ้งตอบ (เฉพาะผู้แจ้ง) กลับสถานะเดิม · ถามได้หลายรอบ · ยกเลิกระหว่างรอได้ตามกติกาเดิม
--   E) รายการ/ตัวเลข: list_mine / list_pending_approvals / list_it ส่ง info_return_status + info_stage · pending_count ไม่นับ need_info
--   F) ไฟล์แนบของข้อความ: policy ของ Storage (ผู้ถามอัปโหลดได้) + app_itwo_add_comment_attachment + ลายเซ็นเดิมของ app_itwo_add_attachment ยังใช้ได้
--   G) ISO: ข้อความและ events แก้/ลบไม่ได้ · guard สถานะ/CHECK ของ info_return_status ที่ระดับตาราง
--   H) โหมดทดสอบ + ล้างข้อมูลทดสอบรวม itwo_comments
begin;

create extension if not exists pgtap with schema extensions;
select plan(216);

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.itwo_comments'::regclass), 'RLS is enabled on itwo_comments');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'itwo_comments' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no grant on itwo_comments');
select ok(not exists (select 1 from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where has_table_privilege(r.rolname, 'public.itwo_comments'::regclass, p.priv)), 'no client role holds any privilege on itwo_comments');
select ok(not exists (select 1 from pg_depend d join pg_class s on s.oid = d.objid and s.relkind = 'S' cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where d.refobjid = 'public.itwo_comments'::regclass and has_sequence_privilege(r.rolname, s.oid, p.priv)), 'the identity sequence of itwo_comments is closed too');
select is((select count(*)::int from pg_policy p where p.polrelid = 'public.itwo_comments'::regclass and p.polname = 'itwo_comments_no_direct_access'), 1, 'itwo_comments has the deny-all policy');
select is((select count(*)::int from pg_policy p where p.polrelid = 'public.itwo_comments'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive), 1, 'itwo_comments has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.itwo_comments'::regclass and t.tgname in ('itwo_comments_sandbox_scope', 'itwo_comments_append_only', 'itwo_comments_no_truncate', 'itwo_comments_insert_guard')), 4, 'itwo_comments has the sandbox scope, append-only, no-truncate and insert-guard triggers');
-- ทุกชื่อจากนิยามล่าสุดใน 20261205010000 ยังอยู่ครบ + itwo_comments
select ok(array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs','itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
    'itwo_reworks','itwo_attachments','itwo_comments'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables keeps every earlier name and adds itwo_comments');
select is(cardinality(private.sandbox_unguarded_tables()), 59, 'sandbox_unguarded_tables has exactly the earlier 58 names plus itwo_comments');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itwo_request_info', 'app_itwo_provide_info', 'app_itwo_add_comment_attachment')), 'the three new RPCs are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itwo_request_info', 'app_itwo_provide_info', 'app_itwo_add_comment_attachment') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'anon cannot execute the new RPCs and authenticated can');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'app\_itwo\_%' and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'after the drop/create of the list RPCs no itwo RPC is executable by anon');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itwo%'), 'every itwo RPC (new and replaced) still has the lab-only guard');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itwo_info_stage', 'itwo_pending_question', 'itwo_comment_attach_open', 'itwo_read_stored_file')), 'the new private helpers are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itwo_info_stage', 'itwo_pending_question', 'itwo_comment_attach_open', 'itwo_read_stored_file', 'itwo_comments_guard') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the new private helpers are closed to anon and authenticated');
select ok(to_regprocedure('public.app_itwo_add_attachment(uuid, uuid, text, text, text, bigint)') is not null and (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname = 'app_itwo_add_attachment') = 1, 'app_itwo_add_attachment keeps its exact v2 signature (the v2 page on production calls it)');
select ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'itwo_work_orders_status_check')) like '%need_info%', 'the status check accepts need_info');
select ok(pg_get_functiondef('public.app_itwo_complete(uuid)'::regprocedure) not like '%ปิดงาน%' and pg_get_functiondef('public.app_itwo_complete(uuid)'::regprocedure) like '%ส่งงาน%', 'app_itwo_complete says ส่งงาน instead of ปิดงาน');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZWC', 'แผนกทดสอบ W-C (มีผู้จัดการ)', 'ZW C'), ('ZWD', 'แผนกทดสอบ W-D (ไม่มีผู้จัดการ)', 'ZW D'), ('ZWE', 'แผนกทดสอบ W-E (แผนกอื่น)', 'ZW E');
insert into auth.users (id, email, raw_user_meta_data)
select ('3d700000-0000-0000-0000-0000000000' || n)::uuid, 'itw-u' || n || '@test.local', '{}'::jsonb
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09']) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itw.test', d.id, r.id, v.uid::uuid, true
from (values
  ('ITW-REQ1', 'ZWC', 'staff', '3d700000-0000-0000-0000-000000000001'),
  ('ITW-REQ2', 'ZWC', 'staff', '3d700000-0000-0000-0000-000000000002'),
  ('ITW-MGR', 'ZWC', 'department_manager', '3d700000-0000-0000-0000-000000000003'),
  ('ITW-ADM', 'MGT', 'staff', '3d700000-0000-0000-0000-000000000004'),
  ('ITW-APPR', 'MGT', 'general_manager', '3d700000-0000-0000-0000-000000000005'),
  ('ITW-REQB', 'ZWD', 'staff', '3d700000-0000-0000-0000-000000000006'),
  ('ITW-SBXADMIN', 'MGT', 'admin', '3d700000-0000-0000-0000-000000000007'),
  ('ITW-ASST', 'ZWC', 'assistant_department_manager', '3d700000-0000-0000-0000-000000000008'),
  ('ITW-OMGR', 'ZWE', 'department_manager', '3d700000-0000-0000-0000-000000000009')
) as v(no, dep, role, uid)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITW-ADM', true, false), ('ITW-APPR', true, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZW-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZWC', 'sbx-zw-staff@sandbox.local', (select id from public.departments where code = 'ZWC'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZW-MGR', 'ทดสอบ', 'ผจก. ZWC', 'sbx-zw-mgr@sandbox.local', (select id from public.departments where code = 'ZWC'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'ITW-%';

-- 3. ขั้นแผนก: ใครถามได้/ไม่ได้ ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบหลักของรุ่น 3', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_dept', 'the order waits for the department step');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments', '[]'::jsonb, 'a new order has no question yet');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending', 'null'::jsonb, 'and nothing is pending');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามตัวเอง') $$, '42501', 'ผู้แจ้งถามกลับใบสั่งงานของตัวเองไม่ได้', 'the requester cannot ask on their own order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the department manager can approve, reject or ask the requester');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the assistant department manager gets the same actions');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามแทน') $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a colleague (cannot view the order) cannot ask and learns nothing about it');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000009","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามข้ามแผนก') $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a manager of another department cannot ask');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'IT admin has no action (and cannot ask) while the order waits for the department');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'IT ถามก่อนอนุมัติ') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'IT admin cannot ask before the approvals');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ขั้น IT ถามก่อนขั้นแผนก') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'the IT approver cannot ask while the department step is still open (it is not their step yet)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, '   ') $$, '23514', 'กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง', 'the question text is required');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, repeat('ก', 2001)) $$, '23514', 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร', 'the question is at most 2000 characters');
select throws_ok($$ select public.app_itwo_request_info('00000000-0000-0000-0000-000000000000', 'ไม่มีใบ') $$, '23514', 'ไม่พบใบสั่งงานนี้', 'an unknown order is reported as not found');

-- 4. ถามครั้งแรก (ขั้นแผนก) --------------------------------------------------
select set_config('t.q1', (public.app_itwo_request_info(current_setting('t.o1')::uuid, repeat('ข', 1980) || ' <b>ขอไฟล์</b>')->>'comment_id'), true);
select ok(current_setting('t.q1')::bigint > 0, 'request_info returns the id of the question');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'need_info', 'the order now waits for the requester (need_info)');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'info_return_status', 'pending_dept', 'and remembers to return to pending_dept');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending'->>'stage', 'dept', 'the pending question belongs to the department step');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending'->>'asked_by_employee_no', 'ITW-MGR', 'the pending question shows who asked');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->0->>'body', repeat('ข', 1980) || ' <b>ขอไฟล์</b>', 'the question body is stored as typed (the page escapes it)');
select is((select e->>'reason' from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e where e->>'action' = 'info_requested'), 'ถามผู้แจ้ง (ผู้จัดการแผนก): ' || repeat('ข', 300), 'the event info_requested names the step and keeps the first 300 characters');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามซ้ำ') $$, '23514', 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ', 'only one open question at a time');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["reject"]'::jsonb, 'while waiting for the answer the manager can only reject');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'approving is refused while the question is open');
select is(public.app_itwo_pending_count(), 0, 'pending_count does not count an order that waits for the requester');
select is((select status || '/' || info_stage || '/' || info_return_status || '/' || pending_step from public.app_itwo_list_pending_approvals() where id = current_setting('t.o1')::uuid), 'need_info/dept/pending_dept/dept', 'the approvals list still shows it (status need_info, stage dept)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ผู้ช่วยถามซ้อน') $$, '23514', 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ', 'the assistant manager cannot add a second open question either');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["cancel", "provide_info"]'::jsonb, 'the requester can answer (or cancel)');
select is((select status || '/' || info_stage || '/' || info_return_status from public.app_itwo_list_mine() where id = current_setting('t.o1')::uuid), 'need_info/dept/pending_dept', 'list_mine shows need_info with the stage (รอคุณตอบ)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select status || '/' || info_stage from public.app_itwo_list_it() where id = current_setting('t.o1')::uuid), 'need_info/dept', 'list_it shows the open question too');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้', 'nothing can be started while waiting');

-- 5. ไฟล์แนบของคำถาม (ผู้ถามอัปโหลด + ลงทะเบียน) ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 300, "mimetype": "application/pdf"}'::jsonb) $$, 'the asker (department manager, not the requester) can upload into the order folder');
select set_config('t.f1', public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001.pdf', '<img src=x onerror=alert(1)>.pdf', 'image/png', 1)::text, true);
select is(public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001.pdf', 'อีกชื่อ.pdf', 'application/pdf', 1)::text, current_setting('t.f1'), 'registering the same path again returns the same row (retry after a lost reply)');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->0->'attachments'->0->>'mime_type', 'application/pdf', 'the type comes from Storage, not from the caller');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->0->'attachments'->0->>'size_bytes')::int, 300, 'the size comes from Storage, not from the caller');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'attachments', '[]'::jsonb, 'files of a question are not listed with the files of the order (the v2 page keeps working)');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o1')::uuid, null, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่แนบไฟล์ให้ใบสั่งงานได้', 'the old RPC still only lets the requester register order files');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000002.pdf', '3d700000-0000-0000-0000-000000000001', '{"size": 1}'::jsonb) $$, '42501', null, 'the asker cannot upload a file owned by someone else');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000009.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบไฟล์ที่อัปโหลด กรุณาอัปโหลดไฟล์ใหม่', 'a path that was never uploaded is refused');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, '00000000-0000-0000-0000-000000000000/b1000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'a path outside the order folder is refused');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, 999999999, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบข้อความนี้ในใบสั่งงาน', 'an unknown comment is refused');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000003.pdf', '  ', 'application/pdf', 1) $$, '23514', 'กรุณาระบุชื่อไฟล์', 'the file name is required');
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000004.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 100, "mimetype": "image/png"}'),
  ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000005.exe', '3d700000-0000-0000-0000-000000000003', '{"size": 100, "mimetype": "application/x-msdownload"}'),
  ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000006.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 30000000, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000004.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่', 'an extension that does not match the stored type is refused');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000005.exe', 'x.exe', 'application/pdf', 1) $$, '23514', 'ที่อยู่ไฟล์ไม่ถูกต้อง หรือไม่ใช่ไฟล์ของใบสั่งงานนี้', 'an extension outside the list is refused');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000006.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไฟล์ต้องมีขนาดไม่เกิน 20 MB', 'a file over 20 MB is refused');
-- 10 ไฟล์ต่อข้อความ
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.o1') || '/b2000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0') || '.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 10, "mimetype": "application/pdf"}'::jsonb
from generate_series(1, 10) n;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select count(public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b2000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0') || '.pdf', 'ไฟล์ ' || n || '.pdf', 'application/pdf', 10)) from generate_series(1, 9) n $$, 'nine more files make ten files on the question');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b2000000-0000-0000-0000-000000000010.pdf', 'ไฟล์ 10.pdf', 'application/pdf', 10) $$, '23514', 'แนบไฟล์ได้ไม่เกิน 10 ไฟล์ต่อข้อความ', 'the eleventh file of one message is refused');
-- คนอื่นแนบไฟล์ให้ข้อความของผู้จัดการไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/b2000000-0000-0000-0000-000000000010.pdf', 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'the requester cannot attach files to the question of the manager');
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001')), 1, 'the requester can read the file of the question (can view the order)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.o1') || '/')), 0, 'a colleague cannot read files of the question');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000007.pdf', '3d700000-0000-0000-0000-000000000002', '{"size": 1}'::jsonb) $$, '42501', null, 'a colleague cannot upload into the order folder');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000008.pdf', '3d700000-0000-0000-0000-000000000008', '{"size": 1}'::jsonb) $$, '42501', null, 'another approver who wrote no message cannot upload');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is((select count(*)::int from storage.objects where bucket_id = 'itwo-files' and starts_with(name, current_setting('t.o1') || '/b1000000-0000-0000-0000-000000000001')), 1, 'IT staff can read the file of the question');

-- 6. ผู้แจ้งตอบ -----------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบแทน') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้', 'a colleague cannot answer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบเอง') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้', 'the asker cannot answer their own question');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, '') $$, '23514', 'กรุณาพิมพ์คำตอบ', 'the answer text is required');
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, repeat('ค', 2001)) $$, '23514', 'ข้อความต้องไม่เกิน 2,000 ตัวอักษร', 'the answer is at most 2000 characters');
select set_config('t.a1', (public.app_itwo_provide_info(current_setting('t.o1')::uuid, repeat('ค', 2000))->>'comment_id'), true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_dept', 'after the answer the order goes back to the department step');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_return_status', 'null'::jsonb, 'the return status is cleared');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending', 'null'::jsonb, 'nothing is pending any more');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->1->>'reply_to'), current_setting('t.q1'), 'the answer points to the question');
select is((public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->1->>'stage'), 'dept', 'the answer carries the stage of the question');
select is((select e->>'reason' from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e where e->>'action' = 'info_provided'), 'ผู้แจ้งตอบคำถาม: ' || repeat('ค', 300), 'the event info_provided keeps the first 300 characters');
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบซ้ำ') $$, '23514', 'ใบสั่งงานนี้ไม่มีคำถามที่รอตอบ', 'no second answer without a new question');
-- ผู้แจ้งแนบไฟล์ให้คำตอบได้ (ภายใน 30 นาที)
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o1') || '/c1000000-0000-0000-0000-000000000001.png', '3d700000-0000-0000-0000-000000000001', '{"size": 50, "mimetype": "image/png"}'::jsonb) $$, 'the requester uploads a file for the answer (flag = no does not matter)');
select lives_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.a1')::bigint, current_setting('t.o1') || '/c1000000-0000-0000-0000-000000000001.png', 'ภาพหน้าจอ.png', 'image/png', 50) $$, 'and registers it on the answer');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q1')::bigint, current_setting('t.o1') || '/c1000000-0000-0000-0000-000000000001.png', 'x.png', 'image/png', 50) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'the requester cannot move the file to the question of someone else');
select throws_ok($$ select public.app_itwo_add_attachment(current_setting('t.o1')::uuid, null, current_setting('t.o1') || '/c1000000-0000-0000-0000-000000000001.png', 'x.png', 'image/png', 50) $$, '23514', 'ไฟล์นี้ถูกลงทะเบียนไว้แล้ว', 'a file of a message cannot be registered again as an order file');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments'->1->'attachments'), 1, 'the answer shows its file');

-- 7. ถามรอบที่ 2 (ผู้ช่วยผู้จัดการ) แล้วอนุมัติ -> ขั้น IT ---------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'after the answer the manager can approve again');
select is(public.app_itwo_pending_count(), 1, 'and the order counts as waiting for the manager again');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ขอถามเพิ่มอีกข้อ') $$, 'a second round of questions is allowed (by the assistant manager)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบข้อที่สอง') $$, 'the requester answers the second question');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the manager approves after the answers');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_it_mgr', 'the order moves to the IT step');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามหลังอนุมัติแผนกแล้ว') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'the department manager cannot ask once their step is done');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'IT ถามระหว่างรออนุมัติขั้น IT') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'IT admin (not an approver) cannot ask while the IT approval is open');

-- 8. ขั้น IT ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the IT approver can approve, reject or ask');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ขั้น IT ขอรายละเอียดเพิ่ม') $$, 'the IT approver asks');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending'->>'stage', 'it_mgr', 'the question belongs to the IT approval step');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'info_return_status', 'pending_it_mgr', 'and the order returns to pending_it_mgr');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["reject"]'::jsonb, 'the IT approver can only reject while waiting');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'the IT approver cannot approve while waiting');
select is((select pending_step || '/' || info_stage from public.app_itwo_list_pending_approvals() where id = current_setting('t.o1')::uuid), 'it_mgr/it_mgr', 'the approvals list of the IT approver shows the waiting order of their step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is((select count(*)::int from public.app_itwo_list_pending_approvals() where id = current_setting('t.o1')::uuid), 0, 'the department manager no longer lists it (their step is done)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบขั้น IT') $$, 'the requester answers the IT approver');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_it_mgr', 'the order returns to the IT approval step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the IT approver approves');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'approved', 'the order is approved');

-- 9. IT ถามหลังอนุมัติ / ระหว่างทำงาน ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["start", "request_info"]'::jsonb, 'IT admin can start or ask on an approved order');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'IT ขอข้อมูลก่อนเริ่ม') $$, 'IT admin asks before starting');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'info_pending'->>'stage', 'it', 'the question belongs to the IT team');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'IT has no action while waiting');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้', 'IT cannot start while waiting');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'the approvers have nothing to decide on an approved order that waits for an answer');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o1')::uuid, 'ไม่อนุมัติทีหลัง') $$, '23514', 'ใบสั่งงานนี้ผู้อนุมัติขั้น IT พิจารณาไปแล้ว', 'an approved order cannot be rejected through the IT question');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบ IT') $$, 'the requester answers IT');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'approved', 'the order goes back to approved');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, 'IT starts');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["complete", "request_info"]'::jsonb, 'IT can deliver (ส่งงาน) or ask during the work');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'IT ขอข้อมูลระหว่างทำงาน') $$, 'IT asks during the work');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'info_return_status', 'in_progress', 'the order returns to in_progress after the answer');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะทำรายการนี้ได้', 'IT cannot deliver while waiting');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามซ้อน IT') $$, '23514', 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ', 'another IT member cannot add a second open question');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["cancel", "provide_info"]'::jsonb, 'before any delivery the requester may still cancel while IT waits for an answer');
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'ตอบระหว่างทำงาน') $$, 'the requester answers');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'in_progress', 'the order is back in progress');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'IT delivers the work (ส่งงาน)');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, '23514', 'IT ส่งงานใบนี้ไปแล้ว', 'delivering twice says ส่งงาน');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถามหลังส่งงาน') $$, '23514', 'ใบสั่งงานนี้ IT ส่งงานแล้ว', 'nobody can ask after the work was delivered');
-- รอบแก้ไขงาน: IT ถามได้ และผู้แจ้งยกเลิกไม่ได้ระหว่างรอ (เคยส่งงานแล้ว)
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'ขอแก้สีโลโก้', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the requester asks for a rework');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'สีโลโก้ใช้รหัสอะไร') $$, 'IT asks during the rework round');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["provide_info"]'::jsonb, 'during a rework round the requester can answer but not cancel');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'ยกเลิกระหว่างรอ') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'an order that was delivered once cannot be cancelled while IT waits for an answer');
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o1')::uuid, 'รหัส #123456') $$, 'the requester answers in the rework round');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'in_progress', 'the rework continues');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'events') e),
  'created,info_requested,info_provided,info_requested,info_provided,dept_approved,info_requested,info_provided,it_mgr_approved,info_requested,info_provided,started,info_requested,info_provided,completed,rework_requested,info_requested,info_provided',
  'every question and answer is in the ISO history in order');
select is((select string_agg((c->>'kind') || ':' || (c->>'stage'), ',' order by (c->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'comments') c),
  'question:dept,answer:dept,question:dept,answer:dept,question:it_mgr,answer:it_mgr,question:it,answer:it,question:it,answer:it,question:it,answer:it',
  'get_detail returns every message with its stage in order');

-- 10. ไม่อนุมัติระหว่างรอผู้แจ้งตอบ / ยกเลิกระหว่างรอ -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบที่จะไม่อนุมัติ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.o3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบที่จะยกเลิก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o2')::uuid, 'ขอเหตุผลที่ต้องทำ') $$, 'the manager asks on the second order');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o3')::uuid, 'ขอเหตุผลที่ต้องทำ') $$, 'the manager asks on the third order');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o2')::uuid, ' ') $$, '23514', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'rejecting while waiting still needs a reason');
select lives_ok($$ select public.app_itwo_reject(current_setting('t.o2')::uuid, 'ไม่จำเป็น') $$, 'the manager rejects while waiting for the answer');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->>'status', 'rejected', 'the order is rejected (ends)');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'info_return_status', 'null'::jsonb, 'the return status is cleared on reject');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_provide_info(current_setting('t.o2')::uuid, 'ตอบช้า') $$, '23514', 'ใบสั่งงานนี้ไม่มีคำถามที่รอตอบ', 'a rejected order cannot be answered');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions', '[]'::jsonb, 'no action is left on the rejected order');
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.o3')::uuid, 'ไม่ต้องทำแล้ว') $$, 'the requester cancels while the question is open');
select is(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->>'status', 'cancelled', 'the order is cancelled');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o3')::uuid, 'ถามใบที่ยกเลิก') $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'a cancelled order cannot be asked');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o3') || '/b3000000-0000-0000-0000-000000000001.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 1}'::jsonb) $$, '42501', null, 'the asker cannot upload into a cancelled order');

-- 11. แผนกไม่มีผู้จัดการ: ผู้อนุมัติขั้น IT ถาม แล้วกดครั้งเดียวนับสองขั้น --------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('t.o4', (select id::text from public.app_itwo_create('design', null, 'no', null, 'แผนกไม่มีผู้จัดการ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status', 'pending_it_mgr', 'the order goes straight to the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o4')::uuid, 'ขอข้อมูลก่อนอนุมัติทั้งสองขั้น') $$, 'the IT approver asks on a single-click order');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'info_pending'->>'stage', 'it_mgr', 'the question belongs to the IT approval step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o4')::uuid, 'ข้อมูลครบแล้ว') $$, 'the requester answers');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o4')::uuid) $$, 'one click approves both steps after the answer');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'events') e), 'created,info_requested,info_provided,dept_approved,it_mgr_approved', 'both approvals are recorded after the question');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status', 'approved', 'the order is approved');

-- 12. งานด่วนที่ IT เริ่มก่อนอนุมัติครบ ------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o5', (select id::text from public.app_itwo_create('design', null, 'no', null, 'งานด่วน', ((now() at time zone 'Asia/Bangkok')::date + 3), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'allowed_actions', '["start"]'::jsonb, 'IT cannot ask on an urgent order that is not started and not approved');
select lives_ok($$ select public.app_itwo_start(current_setting('t.o5')::uuid) $$, 'IT starts the urgent order before the approvals');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the manager can still approve or ask on the started urgent order');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o5')::uuid, 'ด่วนจริงไหม') $$, 'the manager asks on the started urgent order');
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->>'info_return_status', 'in_progress', 'it returns to in_progress after the answer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o5')::uuid, 'ด่วนจริง') $$, 'the requester answers');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'allowed_actions', '["request_info"]'::jsonb, 'IT can ask on the started urgent order (it cannot deliver before the approvals)');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o5')::uuid, 'IT ถามงานด่วน') $$, 'IT asks on the started urgent order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->'allowed_actions', '["reject"]'::jsonb, 'while IT waits for the answer the manager can only reject');
select is(public.app_itwo_pending_count(), 0, 'and it is not counted as waiting for the manager');

-- 13. ลายเซ็นเดิมของ app_itwo_add_attachment ยังใช้ได้ (ใบรอผู้แจ้งตอบ ภายใน 30 นาที) --------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o6', (select id::text from public.app_itwo_create('design', null, 'yes', null, 'ใบมีไฟล์', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o6')::uuid, 'ขอไฟล์ต้นฉบับ') $$, 'the manager asks right after filing');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o6') || '/d1000000-0000-0000-0000-000000000001.pdf', '3d700000-0000-0000-0000-000000000001', '{"size": 77, "mimetype": "application/pdf"}'::jsonb) $$, 'the requester can still upload an order file while the question is open');
select lives_ok($$ select public.app_itwo_add_attachment(current_setting('t.o6')::uuid, null, current_setting('t.o6') || '/d1000000-0000-0000-0000-000000000001.pdf', 'ต้นฉบับ.pdf', 'application/pdf', 77) $$, 'the v2 RPC (same signature) registers it on a need_info order');
select is(jsonb_array_length(public.app_itwo_get_detail(current_setting('t.o6')::uuid)->'attachments'), 1, 'the file is an order file');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o6')::uuid, (public.app_itwo_get_detail(current_setting('t.o6')::uuid)->'info_pending'->>'comment_id')::bigint, current_setting('t.o6') || '/d1000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 77) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'the requester cannot attach to the question of the manager');

-- 14. เพดานไฟล์ในโฟลเดอร์ = 20 ต่อ (1 + รอบแก้ไข + ข้อความ) และหมดเวลาแนบ -------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o7', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบทดสอบเพดาน', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select set_config('t.q7', (public.app_itwo_request_info(current_setting('t.o7')::uuid, 'ถามใบเพดาน')->>'comment_id'), true);
reset role;
select set_config('request.jwt.claims', '', true);
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'itwo-files', current_setting('t.o7') || '/e1000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0') || '.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 1, "mimetype": "application/pdf"}'::jsonb
from generate_series(1, 39) n;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o7') || '/e1000000-0000-0000-0000-000000000040.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 1}'::jsonb) $$, 'the 40th file fits under the cap (20 × (1 + 1 message))');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o7') || '/e1000000-0000-0000-0000-000000000041.pdf', '3d700000-0000-0000-0000-000000000003', '{"size": 1}'::jsonb) $$, '42501', null, 'the 41st file is refused by the folder cap');
reset role;
select set_config('request.jwt.claims', '', true);
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '-1 second' $$;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('itwo-files', current_setting('t.o4') || '/e2000000-0000-0000-0000-000000000001.pdf', '3d700000-0000-0000-0000-000000000005', '{"size": 1, "mimetype": "application/pdf"}');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.o4') || '/e2000000-0000-0000-0000-000000000002.pdf', '3d700000-0000-0000-0000-000000000005', '{"size": 1}'::jsonb) $$, '42501', null, 'after 30 minutes the asker cannot upload any more');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o4')::uuid, (public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'comments'->0->>'id')::bigint, current_setting('t.o4') || '/e2000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังส่งข้อความ)', 'after 30 minutes the asker cannot register files any more');
reset role;
select set_config('request.jwt.claims', '', true);
create or replace function private.itwo_attach_window() returns interval language sql stable security definer set search_path = '' as $$ select interval '30 minutes' $$;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o2')::uuid, (public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'comments'->0->>'id')::bigint, current_setting('t.o2') || '/e2000000-0000-0000-0000-000000000003.pdf', 'x.pdf', 'application/pdf', 1) $$, '42501', 'เฉพาะผู้เขียนข้อความเท่านั้นที่แนบไฟล์ให้ข้อความนั้นได้', 'IT staff cannot attach to the question of the manager');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o2')::uuid, (public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'comments'->0->>'id')::bigint, current_setting('t.o2') || '/e2000000-0000-0000-0000-000000000003.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ใบสั่งงานนี้สิ้นสุดแล้ว แนบไฟล์ไม่ได้', 'no file can be attached to a message of a rejected order');
select throws_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.o1')::uuid, current_setting('t.q7')::bigint, current_setting('t.o1') || '/b2000000-0000-0000-0000-000000000010.pdf', 'x.pdf', 'application/pdf', 1) $$, '23514', 'ไม่พบข้อความนี้ในใบสั่งงาน', 'a message of another order cannot be used');

-- 15. ISO: ข้อความ/ประวัติแก้-ลบไม่ได้ + guard ระดับตาราง ----------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_comments set body = 'แก้ข้อความ' where id = current_setting('t.q1')::bigint $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a message cannot be edited, even by the table owner');
select throws_ok($$ delete from public.itwo_comments where id = current_setting('t.q1')::bigint $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a message cannot be deleted');
select throws_ok($$ truncate public.itwo_comments cascade $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the messages cannot be truncated');
select throws_ok($$ update public.itwo_events set reason = 'แก้' where action = 'info_requested' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the info events cannot be edited');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body) values (current_setting('t.o7')::uuid, 'question', 'dept', current_setting('test.e_itw_req1')::uuid, 'ผู้แจ้งถาม') $$, '23514', 'ผู้แจ้งถามกลับใบสั่งงานของตัวเองไม่ได้', 'the table refuses a question written by the requester');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body) values (current_setting('t.o7')::uuid, 'question', 'dept', current_setting('test.e_itw_asst')::uuid, 'ถามซ้อน') $$, '23514', 'ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว', 'the table refuses a second open question');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body, reply_to) values (current_setting('t.o7')::uuid, 'answer', 'dept', current_setting('test.e_itw_mgr')::uuid, 'ตอบแทน', current_setting('t.q7')::bigint) $$, '23514', 'เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้', 'the table refuses an answer not written by the requester');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body, reply_to) values (current_setting('t.o7')::uuid, 'answer', 'it', current_setting('test.e_itw_req1')::uuid, 'ตอบผิดขั้น', current_setting('t.q7')::bigint) $$, '23514', 'คำตอบต้องใช้ขั้นเดียวกับคำถามที่ตอบ', 'the table refuses an answer with another stage');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body, reply_to) values (current_setting('t.o7')::uuid, 'answer', 'dept', current_setting('test.e_itw_req1')::uuid, 'ตอบข้าม', current_setting('t.q1')::bigint) $$, '23514', 'คำตอบต้องอ้างถึงคำถามของใบสั่งงานเดียวกัน', 'the table refuses an answer to a question of another order');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body, reply_to) values (current_setting('t.o1')::uuid, 'answer', 'dept', current_setting('test.e_itw_req1')::uuid, 'ตอบซ้ำ', current_setting('t.q1')::bigint) $$, '23505', null, 'a question can only be answered once');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body) values (current_setting('t.o7')::uuid, 'question', 'dept', current_setting('test.e_itw_mgr')::uuid, repeat('ก', 2001)) $$, '23514', null, 'the table refuses a body over 2000 characters');
select throws_ok($$ update public.itwo_work_orders set status = 'need_info' where id = current_setting('t.o4')::uuid $$, '23514', null, 'need_info without a return status is refused (CHECK)');
select throws_ok($$ update public.itwo_work_orders set status = 'need_info', info_return_status = 'pending_dept' where id = current_setting('t.o4')::uuid $$, '23514', 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (approved) ไว้เป็นสถานะที่จะกลับไป', 'the return status must equal the status before the question');
select throws_ok($$ update public.itwo_work_orders set status = 'received', info_return_status = null where id = current_setting('t.o7')::uuid $$, '23514', 'เปลี่ยนสถานะใบสั่งงานจาก need_info เป็น received ไม่ได้', 'a waiting order cannot jump to received');
select throws_ok($$ update public.itwo_work_orders set status = 'approved', info_return_status = null where id = current_setting('t.o7')::uuid $$, '23514', 'ใบที่รอผู้แจ้งตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (pending_dept) เท่านั้น', 'a waiting order can only go back to its saved status');
select throws_ok($$ update public.itwo_work_orders set info_return_status = 'approved' where id = current_setting('t.o7')::uuid $$, '23514', 'แก้สถานะที่ใบจะกลับไปไม่ได้', 'the saved return status cannot be changed');
select throws_ok($$ update public.itwo_work_orders set status = 'need_info', info_return_status = 'it_closed' where id = current_setting('t.o1')::uuid $$, '23514', null, 'an order in rework cannot be set to return to it_closed (CHECK)');
select throws_ok($$ insert into public.itwo_attachments (work_order_id, rework_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values (current_setting('t.o1')::uuid, (select id from public.itwo_reworks where work_order_id = current_setting('t.o1')::uuid), current_setting('t.q1')::bigint, current_setting('t.o1') || '/f1000000-0000-0000-0000-000000000001.pdf', 'x.pdf', 'application/pdf', 1, current_setting('test.e_itw_mgr')::uuid) $$, '23514', null, 'a file belongs to a rework round or to a message, not both');
select throws_ok($$ insert into public.itwo_attachments (work_order_id, comment_id, storage_path, file_name, mime_type, size_bytes, uploaded_by) values (current_setting('t.o2')::uuid, current_setting('t.q1')::bigint, current_setting('t.o2') || '/f1000000-0000-0000-0000-000000000002.pdf', 'x.pdf', 'application/pdf', 1, current_setting('test.e_itw_mgr')::uuid) $$, '23503', null, 'a file cannot point to a message of another order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok($$ select * from public.itwo_comments $$, '42501', null, 'authenticated cannot read itwo_comments directly');
select throws_ok($$ insert into public.itwo_comments (work_order_id, kind, stage, author_id, body) values (current_setting('t.o7')::uuid, 'question', 'dept', current_setting('test.e_itw_mgr')::uuid, 'ตรง') $$, '42501', null, 'authenticated cannot write itwo_comments directly');
set local role anon;
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o7')::uuid, 'anon') $$, '42501', null, 'anon cannot call request_info');

-- 16. โหมดทดสอบ + ล้างข้อมูลทดสอบ ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zw_staff')::uuid) $$, 'the admin enters the test mode as the requester persona');
select set_config('t.t1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบทดสอบถามตอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o7')::uuid, 'ข้ามโหมด') $$, '23514', 'ไม่พบใบสั่งงานนี้', 'a persona cannot ask on a real order');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zw_mgr')::uuid) $$, 'switch to the manager persona');
select set_config('t.tq', (public.app_itwo_request_info(current_setting('t.t1')::uuid, 'คำถามทดสอบ')->>'comment_id'), true);
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'status', 'need_info', 'the test order waits for the persona requester');
select throws_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-files', current_setting('t.t1') || '/a7000000-0000-0000-0000-000000000001.pdf', '3d700000-0000-0000-0000-000000000007', '{"size": 1}'::jsonb) $$, '42501', null, 'a test message cannot put files in the live bucket');
select lives_ok($$ insert into storage.objects (bucket_id, name, owner_id, metadata) values ('itwo-test-files', current_setting('t.t1') || '/a7000000-0000-0000-0000-000000000002.pdf', '3d700000-0000-0000-0000-000000000007', '{"size": 10, "mimetype": "application/pdf"}'::jsonb) $$, 'the manager persona uploads into the test bucket');
select lives_ok($$ select public.app_itwo_add_comment_attachment(current_setting('t.t1')::uuid, current_setting('t.tq')::bigint, current_setting('t.t1') || '/a7000000-0000-0000-0000-000000000002.pdf', 'ทดสอบ.pdf', 'application/pdf', 10) $$, 'and registers it on the test question');
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->'comments'->0->'attachments'->0->>'bucket', 'itwo-test-files', 'the test file is served from the test bucket');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zw_staff')::uuid) $$, 'back to the requester persona');
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.t1')::uuid, 'คำตอบทดสอบ') $$, 'the requester persona answers');
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('t.expect_deleted', ((select count(*) from public.itwo_work_orders where is_test) + (select count(*) from public.itwo_events where is_test) + (select count(*) from public.itwo_access_changes where is_test) + (select count(*) from public.itwo_reworks where is_test) + (select count(*) from public.itwo_attachments where is_test) + (select count(*) from public.itwo_comments where is_test) + (select count(*) from public.itwo_admin_log where is_test) + (select count(*) from public.itwo_doc_counters where is_test))::text, true);
select set_config('t.real_comments', (select count(*)::text from public.itwo_comments where not is_test), true);
select is((select count(*)::int from public.itwo_comments where is_test), 2, 'two test messages exist before the purge');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"3d700000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select set_config('t.purge', public.app_sandbox_purge_itwo()::text, true);
select is((current_setting('t.purge')::jsonb->>'deleted')::int, current_setting('t.expect_deleted')::int, 'the purge deletes every test row including itwo_comments');
select is(current_setting('t.purge')::jsonb->'files', to_jsonb(array[current_setting('t.t1') || '/a7000000-0000-0000-0000-000000000002.pdf']), 'the purge lists the test file of the message for removal');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_comments where is_test), 0, 'no test message remains');
select is((select count(*)::int from public.itwo_comments where not is_test)::text, current_setting('t.real_comments'), 'the real messages survived the purge');
select throws_ok($$ delete from public.itwo_comments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real messages still cannot be deleted after a purge');

select * from finish();
rollback;
