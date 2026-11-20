-- ทดสอบใบสั่งงาน IT รุ่น 1.02 (20261208010000_itwo_v4_approver_rules.sql)
--   A) หัวหน้า IT (ผู้อนุมัติขั้น IT ที่ไม่ใช่ it_admin) อนุมัติ/ไม่อนุมัติ/ถามตอนรออนุมัติ + ดูได้ แต่ start / complete / ถามหลังอนุมัติ / ตั้งค่าทีม IT ไม่ได้
--      persona ทดสอบ SBX-IT-APPROVER ถูกถอดสิทธิ์ผู้ดูแลงาน IT (บัญชีจริง เจ้าของแก้เองในแท็บตั้งค่า migration ไม่แตะ)
--   B) ระหว่างรอผู้แจ้งตอบ (need_info) ผู้ถาม/ผู้อนุมัติขั้นนั้น "อนุมัติ" และ "ไม่อนุมัติ" ไม่ได้ (ข้อความไทย) · ผู้แจ้งยังยกเลิกได้ · ตอบแล้วค่อยตัดสินได้
--   B2) IT (it_admin) ยกเลิกใบ need_info แทนผู้แจ้งได้ (เหตุผลบังคับ) · ใบสถานะอื่น/ใบที่เคยส่งงานยกเลิกไม่ได้ · ผู้อนุมัติที่ไม่ใช่ it_admin ยกเลิกไม่ได้
--   C) ข้อความสถานะ received ที่ฐานข้อมูลส่งออก + โครงสร้างของฟังก์ชันที่ replace
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (V4-*) ในแผนกทดสอบ ZV* ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration
begin;

create extension if not exists pgtap with schema extensions;
select plan(105);

-- 1. persona + โครงสร้าง -----------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select s.is_it_admin::text || ',' || s.is_it_approver::text from public.itwo_staff s join public.employees e on e.id = s.employee_id where e.employee_no = 'SBX-IT-APPROVER'), 'false,true', 'the IT approver test persona is an approver only (no IT admin right)');
select is((select s.is_it_admin::text || ',' || s.is_it_approver::text from public.itwo_staff s join public.employees e on e.id = s.employee_id where e.employee_no = 'SBX-IT-ADMIN'), 'true,false', 'the IT admin test persona is an admin only');
select is((select count(*)::int from public.itwo_admin_log l join public.employees a on a.id = l.actor_id join public.employees t on t.id = l.target_employee_id where l.is_test and l.action = 'staff_changed' and a.employee_no = 'SBX-IT-ADMIN' and t.employee_no = 'SBX-IT-APPROVER' and l.detail->'new' = '{"is_it_admin": false, "is_it_approver": true}'::jsonb and l.detail->'old' = '{"is_it_admin": true, "is_it_approver": true}'::jsonb), 1, 'the migration logged the persona change as a test row with the IT admin persona as the actor');
select ok(not exists (select 1 from public.itwo_admin_log l where not l.is_test and l.detail->>'employee_no' = 'SBX-IT-APPROVER'), 'and no real (ISO) log row was written for it');
select ok(array['itwo_work_orders', 'itwo_events', 'itwo_access_changes', 'itwo_doc_counters', 'itwo_admin_log', 'itwo_reworks', 'itwo_attachments', 'itwo_comments'] <@ private.sandbox_unguarded_tables(), 'every itwo table is still registered in sandbox_unguarded_tables (this migration does not touch it; no count check)');
select ok(private.itwo_status_message('received') like '%จบงานแล้ว%' and private.itwo_status_message('received') not like '%ไม่%', 'the status message of a received order says it is finished (จบงานแล้ว)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itwo_approval_caps', 'itwo_decide', 'itwo_allowed_actions')), 'the replaced private functions are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itwo_approval_caps', 'itwo_decide', 'itwo_allowed_actions', 'itwo_work_order_guard') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the replaced private functions are closed to anon and authenticated');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'app\_itwo\_%' and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'no itwo RPC is executable by anon and authenticated can still call them');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZVC', 'แผนกทดสอบ V-C (มีผู้จัดการ)', 'ZV C'), ('ZVD', 'แผนกทดสอบ V-D (ไม่มีผู้จัดการ)', 'ZV D');
insert into auth.users (id, email, raw_user_meta_data)
select ('4d700000-0000-0000-0000-0000000000' || n)::uuid, 'itv4-u' || n || '@test.local', '{}'::jsonb
from unnest(array['01', '02', '03', '04', '05', '06']) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itv4.test', d.id, r.id, v.uid::uuid, true
from (values
  ('V4-REQ', 'ZVC', 'staff', '4d700000-0000-0000-0000-000000000001'),
  ('V4-MGR', 'ZVC', 'department_manager', '4d700000-0000-0000-0000-000000000002'),
  ('V4-ADM', 'MGT', 'staff', '4d700000-0000-0000-0000-000000000003'),
  ('V4-APPR', 'MGT', 'general_manager', '4d700000-0000-0000-0000-000000000004'),
  ('V4-REQD', 'ZVD', 'staff', '4d700000-0000-0000-0000-000000000005'),
  ('V4-SBXADMIN', 'MGT', 'admin', '4d700000-0000-0000-0000-000000000006')
) as v(no, dep, role, uid)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- V4-ADM = ผู้ดูแลงาน IT อย่างเดียว · V4-APPR = ผู้อนุมัติขั้น IT อย่างเดียว (ไม่ใช่ it_admin เหมือน FANG หลังเจ้าของแก้สิทธิ์)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('V4-ADM', true, false), ('V4-APPR', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. หัวหน้า IT (ไม่ใช่ it_admin): ทำได้แค่อนุมัติ/ไม่อนุมัติ/ถาม/ดู -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_my_role()->>'is_it_admin', 'false', 'my_role: the IT approver is not an IT admin');
select is(public.app_itwo_my_role()->>'is_it_approver', 'true', 'my_role: but is the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบหลักของรุ่น 1.02', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.o2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'งานด่วนรุ่น 1.02', ((now() at time zone 'Asia/Bangkok')::date + 3), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_dept', 'the IT approver (staff) can read any order, here one that waits for the department');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'but has no action before the department step is done');
select is((select count(*)::int from public.app_itwo_list_it() where id in (current_setting('t.o1')::uuid, current_setting('t.o2')::uuid)), 2, 'the IT approver sees the whole IT work list (read only)');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o2')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'the IT approver cannot start even an urgent order');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions', '[]'::jsonb, 'and the urgent order offers the IT approver no start button');
select throws_ok($$ select * from public.app_itwo_list_staff() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'the IT approver cannot open the settings (team list)');
select throws_ok($$ select public.app_itwo_set_staff('V4-REQ', true, false) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้', 'nor change the team rights');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the department manager approves the main order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'at the IT step the IT approver can approve, reject or ask the requester');
select is(public.app_itwo_pending_count(), 1, 'and one order waits for the IT approver');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, 'the IT approver approves');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'approved', 'the order is approved');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'afterwards the IT approver has no action at all (no start, no ask)');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'the IT approver cannot start an approved order');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'IT approver ถามหลังอนุมัติ') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'the IT approver cannot ask after the approval (that is the IT work)');
select is((select count(*)::int from public.app_itwo_list_it() where id = current_setting('t.o1')::uuid), 1, 'the approved order is still in the read-only IT list');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["start", "request_info"]'::jsonb, 'the IT admin can start or ask on the approved order');
select lives_ok($$ select public.app_itwo_start(current_setting('t.o1')::uuid) $$, 'the IT admin starts');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '["complete", "request_info"]'::jsonb, 'then the IT admin can deliver or ask');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'while IT works the IT approver still has no action');
select throws_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้', 'the IT approver cannot deliver the work');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(900) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'nor set the next document number (an IT admin only action)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.o1')::uuid) $$, 'the IT admin delivers');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'it_closed', 'the order waits for the requester to confirm');

-- 4. ระหว่าง need_info: อนุมัติ/ไม่อนุมัติไม่ได้ (ขั้นแผนก) ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.o3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ถามตอนรอผู้จัดการแผนก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o3')::uuid, 'ขอรายละเอียดเพิ่ม') $$, 'the department manager asks');
select is(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->>'status', 'need_info', 'the order waits for the requester');
select is(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->'allowed_actions', '[]'::jsonb, 'the asking manager has no action while waiting (no approve, no reject, no second question)');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o3')::uuid, 'ไม่อนุมัติระหว่างรอ') $$, '23514', 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน', 'rejecting while waiting is refused with the Thai message');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o3')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'approving while waiting is still refused');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o3')::uuid, ' ') $$, '23514', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'a blank reason is still reported first');
select is(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->>'status', 'need_info', 'the refused attempts changed nothing (still waiting)');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->'events') e), 'created,info_requested', 'and wrote no rejection event');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o3')::uuid)->'allowed_actions', '[]'::jsonb, 'the IT approver gets no action either on a waiting order');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o3')::uuid, 'ไม่อนุมัติระหว่างรอ') $$, '23514', 'ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'someone who could not decide anyway still gets the earlier message (the IT step waits for the department)');
select is((select pending_step || '/' || info_stage from public.app_itwo_list_pending_approvals() where id = current_setting('t.o3')::uuid), null, 'the waiting department order is not on the IT approver pending list');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select is((select status || '/' || info_stage from public.app_itwo_list_pending_approvals() where id = current_setting('t.o3')::uuid), 'need_info/dept', 'the asking manager still sees the waiting order in the read-only approvals list');
select is(public.app_itwo_pending_count(), 1, 'the count has only the urgent order of the manager (the waiting order is not counted)');
-- ด่านซ้อนที่ระดับตาราง: need_info -> rejected เขียนตรงไม่ได้
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set status = 'rejected', info_return_status = null where id = current_setting('t.o3')::uuid $$, '23514', 'เปลี่ยนสถานะใบสั่งงานจาก need_info เป็น rejected ไม่ได้', 'the table guard refuses need_info -> rejected');
select lives_ok($$ update public.itwo_work_orders set status = 'cancelled', info_return_status = null where id = current_setting('t.o3')::uuid $$, 'while need_info -> cancelled stays possible (the requester cancel)');

-- 5. ผู้แจ้งยกเลิกใบที่รอตอบได้ · ตอบแล้วผู้อนุมัติตัดสินได้ ----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select set_config('t.o4', (select id::text from public.app_itwo_create('design', null, 'no', null, 'แผนกไม่มีผู้จัดการ ถามตอนรอผู้อนุมัติขั้น IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.o5', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ถามแล้วผู้แจ้งยกเลิก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status', 'pending_it_mgr', 'a department without manager goes straight to the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o4')::uuid, 'ขอใบเสนอราคา') $$, 'the IT approver asks at the IT step');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o5')::uuid, 'ขอเหตุผล') $$, 'and on the other order');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'allowed_actions', '[]'::jsonb, 'the asking IT approver has no action while waiting');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o4')::uuid, 'ไม่อนุมัติระหว่างรอ') $$, '23514', 'ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน', 'the IT approver cannot reject while waiting');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o4')::uuid) $$, '23514', 'ใบสั่งงานนี้รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'nor approve');
select is((select status || '/' || pending_step || '/' || info_stage from public.app_itwo_list_pending_approvals() where id = current_setting('t.o4')::uuid), 'need_info/it_mgr/it_mgr', 'the waiting order stays listed (read only) for the IT step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'allowed_actions', '["cancel", "provide_info"]'::jsonb, 'the requester can still cancel or answer');
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.o5')::uuid, 'ไม่ต้องทำแล้ว') $$, 'the requester cancels a waiting order');
select is(public.app_itwo_get_detail(current_setting('t.o5')::uuid)->>'status', 'cancelled', 'it is cancelled');
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.o4')::uuid, 'แนบใบเสนอราคาแล้ว') $$, 'the requester answers the other order');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status', 'pending_it_mgr', 'it is back at the IT step');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'after the answer the IT approver can decide or ask again');
select lives_ok($$ select public.app_itwo_reject(current_setting('t.o4')::uuid, 'ราคาสูงเกิน') $$, 'and rejects with a reason');
select is(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->>'status', 'rejected', 'the order ends as rejected');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.o4')::uuid)->'events') e), 'created,info_requested,info_provided,it_mgr_rejected', 'the ISO history shows the question, the answer and then the rejection in order');

-- 5.1 IT ยกเลิกใบที่รอผู้แจ้งตอบแทนผู้แจ้ง (รุ่น 1.02) -----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.c1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้แจ้งไม่ตอบ ใบที่ 1', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.c2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้แจ้งลาออก ใบที่ 2', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.c1')::uuid, 'ขอรายละเอียด 1') $$, 'the department manager asks on the first order');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.c2')::uuid, 'ขอรายละเอียด 2') $$, 'and on the second order');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, 'ผู้จัดการยกเลิก') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้', 'the asking manager (not an IT admin) cannot cancel a waiting order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, 'หัวหน้า IT ยกเลิก') $$, '42501', 'เฉพาะผู้แจ้งเท่านั้นที่ยกเลิกใบสั่งงานได้', 'the IT approver who is not an IT admin cannot cancel either');
select is(public.app_itwo_get_detail(current_setting('t.c1')::uuid)->'allowed_actions', '[]'::jsonb, 'and is not offered the cancel button');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select is(public.app_itwo_get_detail(current_setting('t.c1')::uuid)->'allowed_actions', '["cancel"]'::jsonb, 'the IT admin is offered only the cancel button on a waiting order');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, '') $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิก', 'the IT admin must give a reason (blank refused)');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, null) $$, '23514', 'กรุณาระบุเหตุผลที่ยกเลิก', 'a missing reason is refused too');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, repeat('ก', 480)) $$, '23514', 'เหตุผลต้องไม่เกิน 479 ตัวอักษร', 'the reason limit leaves room for the on-behalf prefix (479)');
select is(public.app_itwo_get_detail(current_setting('t.c1')::uuid)->>'status', 'need_info', 'the refused attempts changed nothing');
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.c1')::uuid, repeat('ก', 479)) $$, 'a 479 character reason is accepted (the stored text is exactly 500)');
select is((select char_length(e->>'reason') from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.c1')::uuid)->'events') e where e->>'action' = 'cancelled'), 500, 'the stored reason is the prefix plus the reason (500 characters, the table limit)');
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.c2')::uuid, 'ผู้แจ้งลาออกแล้ว') $$, 'the IT admin cancels the second waiting order on behalf of the requester');
select is(public.app_itwo_get_detail(current_setting('t.c2')::uuid)->>'status', 'cancelled', 'it is cancelled');
select is((select e->>'actor_employee_no' || '|' || (e->>'reason') from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.c2')::uuid)->'events') e where e->>'action' = 'cancelled'), 'V4-ADM|IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้งลาออกแล้ว', 'the history names the IT admin as the actor and says it was on behalf of the requester');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(current_setting('t.c2')::uuid)->'events') e), 'created,info_requested,cancelled', 'the ISO history is created, question, cancel (append only)');
select is(public.app_itwo_get_detail(current_setting('t.c2')::uuid)->'allowed_actions', '[]'::jsonb, 'a cancelled order offers no action');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.c2')::uuid, 'อีกครั้ง') $$, '23514', 'ใบสั่งงานนี้ถูกยกเลิกแล้ว', 'and cannot be cancelled twice');
-- IT ยกเลิกแทนได้เฉพาะ need_info: ใบที่รอผู้จัดการ / กำลังดำเนินการ / ส่งงานแล้ว ยกเลิกไม่ได้ (ต้องเป็นผู้แจ้ง)
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o2')::uuid, 'IT ยกเลิกใบรออนุมัติ') $$, '42501', 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ', 'the IT admin cannot cancel an order that waits for approval');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions', '["start"]'::jsonb, 'and is not offered cancel there (urgent order: start only)');
select lives_ok($$ select public.app_itwo_start(current_setting('t.o2')::uuid) $$, 'the IT admin starts the urgent order');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o2')::uuid, 'IT ยกเลิกใบที่กำลังทำ') $$, '42501', 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ', 'nor an order that is in progress');
select ok(not (public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions' @> '"cancel"'::jsonb), 'cancel is not offered on an in-progress order either');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'IT ยกเลิกใบที่ส่งงานแล้ว') $$, '42501', 'ผู้ดูแลงาน IT ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ', 'nor an order IT has delivered (waiting for the requester to confirm)');
-- ใบที่เคยส่งงาน (completed) แล้วอยู่ need_info ในรอบแก้ไข: ทั้งผู้แจ้งและ IT ยกเลิกไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select * from public.app_itwo_request_rework(current_setting('t.o1')::uuid, 'ขอแก้ไขงานรอบแรก', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the requester asks for a rework of the delivered order');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ขอรายละเอียดการแก้') $$, 'the IT admin asks in the rework round');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'need_info', 'the delivered order now waits for the requester (need_info)');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'the IT admin is not offered cancel on it (it was delivered once)');
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'IT ยกเลิกใบที่เคยส่งงาน') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'the IT admin cannot cancel an order that has a completed event');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok($$ select public.app_itwo_cancel(current_setting('t.o1')::uuid, 'ผู้แจ้งยกเลิก') $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'and neither can the requester (unchanged rule)');
-- ด่านตารางยังกันยกเลิกใบที่เคยส่งงานแม้เขียนตรง
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itwo_work_orders set status = 'cancelled', info_return_status = null where id = current_setting('t.o1')::uuid $$, '23514', 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน', 'the table guard also refuses to cancel an order with a completed event');

-- 6. โหมดทดสอบ: persona ผู้อนุมัติขั้น IT ไม่ใช่ผู้ดูแลงาน IT -------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4d700000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'the admin switches to the IT approver test persona');
select is(public.app_itwo_my_role()->>'is_it_admin', 'false', 'in test mode the IT approver persona is not an IT admin');
select is(public.app_itwo_my_role()->>'is_it_approver', 'true', 'but is an IT approver');
select throws_ok($$ select * from public.app_itwo_list_staff() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'and cannot open the settings');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin switches to the IT admin test persona');
select is(public.app_itwo_my_role()->>'is_it_admin', 'true', 'the IT admin persona keeps the IT admin right');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode again');

select * from finish();
rollback;
