-- ทดสอบแจ้งเตือนของใบแจ้งซ่อมคอมพิวเตอร์ (20261212010000_itrp_repair_requests.sql ส่วนที่ 14)
--   A) โครงสร้าง: trigger บน itrp_events + ฟังก์ชัน private (SECURITY DEFINER, search_path ว่าง, ถอนสิทธิ์ anon/authenticated) · ไม่มี RPC สาธารณะใหม่ · ไม่ replace private.office_notify
--   B) ทุกเหตุการณ์ได้ผู้รับถูก: แจ้งซ่อมใหม่ (ขั้นแผนก / ขั้น IT ทันที / ผจก.แจ้งเอง / ผู้อนุมัติ IT แจ้งเอง / แผนกไม่มีผจก.), อนุมัติทีละขั้น, อนุมัติครบ, ไม่อนุมัติ,
--      ถาม-ตอบ, ส่งงาน, ขอแก้ไขงาน, ยกเลิก (ผู้แจ้ง / IT แทน) · ไม่แจ้ง: เริ่มงานและรับงาน · ไม่ส่งถึงคนที่กดเอง · ไม่ซ้ำผู้รับเดียวกัน · ผู้รับที่ inactive / ไม่มีบัญชีล็อกอินไม่ได้รับ
--   C) ข้อความ/ลิงก์ถูกต้อง: ลิงก์ /office/repair/<uuid> · คำว่า "ใบแจ้งซ่อม" · งานด่วนขึ้นหัว "🚨 [ด่วน] " ทุกข้อความ และแจ้ง it_admin ทันที
--   D) ใบทดสอบ (โหมดทดสอบ) ไม่ส่งเลย · แจ้งเตือนล้มเหลวแล้วการอนุมัติ/ส่งงานไม่ล้มตาม
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (NR-*) ในแผนกทดสอบ ZRN-A/ZRN-B · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
-- (ไม่ตรวจคอลัมน์ email_status/push_status ของ notifications: เป็นเรื่องของตัวกลาง office_notify ที่ทดสอบใน itwo_notify.test.sql)
begin;

create extension if not exists pgtap with schema extensions;
select plan(106);

create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"4e900000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.new_req(p_urgent boolean default false) returns text language sql as $$
  select (select id::text from public.app_itrp_create(null, 'PC-01', 'repair', null, 'computer', null, 'เปิดเครื่องไม่ติด', p_urgent)) $$;
-- รหัสพนักงานของผู้รับแจ้งเตือนของใบ (เรียงตามรหัส) ที่หัวข้อตรงรูปแบบ · ต้องเรียกด้วยสิทธิ์เจ้าของ (ตาราง notifications ปิดจาก role ผู้ใช้)
create function pg_temp.who(p_req text, p_title_like text default '%') returns text language sql as $$
  select coalesce(string_agg(e.employee_no, ',' order by e.employee_no), '')
  from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = '/office/repair/' || p_req and n.title like p_title_like $$;
create function pg_temp.total(p_req text) returns integer language sql as $$
  select count(*)::int from public.notifications n where n.action_url = '/office/repair/' || p_req $$;
create function pg_temp.mine(p_req text, p_no text) returns integer language sql as $$
  select count(*)::int from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = '/office/repair/' || p_req and e.employee_no = p_no $$;
create function pg_temp.dn(p_req text) returns text language sql as $$ select doc_no from public.itrp_requests where id = p_req::uuid $$;
create function pg_temp.name(p_no text) returns text language sql as $$ select first_name || ' ' || last_name from public.employees where employee_no = p_no $$;

-- 1. โครงสร้าง ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.itrp_events'::regclass and t.tgname = 'itrp_events_notify' and t.tgtype & 1 = 1 and t.tgtype & 2 = 0), 1, 'itrp_events has the row level AFTER trigger itrp_events_notify');
select is((select (t.tgtype & 4)::int from pg_trigger t where t.tgrelid = 'public.itrp_events'::regclass and t.tgname = 'itrp_events_notify'), 4, 'and it fires on INSERT only (an event can never be updated or deleted)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_notify_on_event', 'itrp_notify_each', 'itrp_notify_stage_approver_ids', 'itrp_notify_dept_approver_ids', 'itrp_notify_it_admin_ids', 'itrp_notify_it_approver_ids')), 'the notification helpers are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_request_kind_text', 'itrp_notify_on_event', 'itrp_notify_each', 'itrp_notify_stage_approver_ids', 'itrp_notify_dept_approver_ids', 'itrp_notify_it_admin_ids', 'itrp_notify_it_approver_ids') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'none of them is callable by anon or authenticated (only the trigger runs them)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%notify%' and p.proname like '%itrp%'), 0, 'no public RPC was added for notifications (the browser cannot create these rows)');
select ok(position('itrp' in pg_get_functiondef('private.office_notify(uuid, text, text, text, uuid)'::regprocedure)) = 0, 'the shared private.office_notify was not replaced (it knows nothing about itrp)');
select is(private.itrp_request_kind_text('repair', null), 'ซ่อม', 'kind text: repair');
select is(private.itrp_request_kind_text('replace_part', null), 'เปลี่ยนอะไหล่', 'kind text: replace_part');
select is(private.itrp_request_kind_text('inspect', null), 'ตรวจเช็ค', 'kind text: inspect');
select is(private.itrp_request_kind_text('install', null), 'ติดตั้ง', 'kind text: install');
select is(private.itrp_request_kind_text('other', '  ย้ายเครื่อง  '), 'อื่นๆ · ย้ายเครื่อง', 'kind text: other shows what the requester typed');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZRNA', 'แผนกทดสอบ R-A (มีผู้จัดการ)', 'ZRN A'), ('ZRNB', 'แผนกทดสอบ R-B (ไม่มีผู้จัดการ)', 'ZRN B');
insert into auth.users (id, email, raw_user_meta_data)
select ('4e900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itr-u' || n || '@test.local', '{}'::jsonb from generate_series(1, 13) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itr.test', d.id, r.id, ('4e900000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, v.active
from (values
  (1, 'NR-REQ', 'ZRNA', 'staff', true),
  (2, 'NR-MGR', 'ZRNA', 'department_manager', true),
  (3, 'NR-AMGR', 'ZRNA', 'assistant_department_manager', true),
  (4, 'NR-ADM', 'MGT', 'staff', true),
  (5, 'NR-ADM2', 'MGT', 'staff', true),
  (6, 'NR-APPR', 'MGT', 'general_manager', true),
  (7, 'NR-APPR2', 'MGT', 'general_manager', true),
  (8, 'NR-REQB', 'ZRNB', 'staff', true),
  (9, 'NR-INACT', 'ZRNA', 'assistant_department_manager', false),
  (10, 'NR-DUAL', 'ZRNA', 'staff', true),
  (11, 'NR-SBXADM', 'MGT', 'admin', true),
  (12, 'NR-REQ2', 'ZRNA', 'staff', true),
  (13, 'NR-HEAD', 'MGT', 'staff', true)
) as v(n, no, dep, role, active)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- ผู้อนุมัติแผนกที่ล็อกอินไม่ได้ (ยังไม่ผูกบัญชี) ต้องไม่ถูกนับเป็นผู้รับ
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select 'NR-NOAUTH', 'ทดสอบ', 'NR-NOAUTH', 'nr-noauth@itr.test', d.id, r.id, null, true
from public.departments d, public.roles r where d.code = 'ZRNA' and r.code = 'assistant_department_manager';
-- NR-ADM, NR-ADM2 = ผู้ดูแลงาน IT · NR-APPR, NR-APPR2 = ผู้อนุมัติขั้น IT อย่างเดียว · NR-DUAL = ผู้ดูแลงาน IT ที่เป็นผู้แจ้งด้วย
-- NR-HEAD = หัวหน้า IT (ดูอย่างเดียว) ผู้อนุมัติขั้น IT ของใบที่ผู้อนุมัติขั้น IT แจ้งเอง (26/11/2026)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer)
select e.id, v.adm, v.appr, v.head
from (values ('NR-ADM', true, false, false), ('NR-ADM2', true, false, false), ('NR-APPR', false, true, false), ('NR-APPR2', false, true, false), ('NR-DUAL', true, false, false), ('NR-HEAD', false, false, true)) v(no, adm, appr, head)
join public.employees e on e.employee_no = v.no;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZRN-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZRNA', 'sbx-zrn-staff@sandbox.local', (select id from public.departments where code = 'ZRNA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZRN-MGR', 'ทดสอบ', 'ผจก. ZRNA', 'sbx-zrn-mgr@sandbox.local', (select id from public.departments where code = 'ZRNA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test or employee_no like 'NR-%';
select set_config('t.n0', (select count(*)::text from public.notifications where action_url like '/office/repair/%'), true);

-- 3. ใบปกติ: แจ้งซ่อม → แผนกอนุมัติ → IT อนุมัติ → เริ่ม → ส่งงาน → ขอแก้ไข → ส่งงาน → รับงาน ------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.oa', pg_temp.new_req(), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% รอคุณอนุมัติ'), 'NR-AMGR,NR-MGR', 'created (waits for the department): every department approver (manager and assistant), not the requester, not the inactive or login-less approver, not the IT side');
select is(pg_temp.total(current_setting('t.oa')), 2, 'and nobody else got a notification');
select is((select n.title from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.oa') and n.recipient_id = current_setting('test.p_nr_mgr')::uuid), 'ใบแจ้งซ่อม ' || pg_temp.dn(current_setting('t.oa')) || ' รอคุณอนุมัติ', 'the title says "ใบแจ้งซ่อม <document number>" and what is expected of the reader');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.oa') and n.recipient_id = current_setting('test.p_nr_mgr')::uuid), 'ทดสอบ NR-REQ · แผนกทดสอบ R-A (มีผู้จัดการ) · PC-01 · ซ่อม', 'the body is "<requester> · <department> · <device> · <request kind>" (there is no needed date on a repair request)');
select is((select count(*)::int from public.notifications n where n.action_url like '/office/repair/%' and n.action_url !~ '^/office/repair/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), 0, 'every link is /office/repair/<uuid> (the route the page opens directly)');
select is((select count(*)::int from public.notifications n where n.title like '%ใบสั่งงาน%' and n.action_url like '/office/repair/%'), 0, 'no message says "ใบสั่งงาน"');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oa')::uuid) $$, 'the department manager approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% รอคุณอนุมัติ'), 'NR-AMGR,NR-APPR,NR-APPR2,NR-MGR', 'department approved: the IT approvers are asked next');
select is(pg_temp.total(current_setting('t.oa')), 4, 'one new row per IT approver and none for the manager who clicked');
select is(pg_temp.mine(current_setting('t.oa'), 'NR-MGR'), 1, 'the department manager who approved got nothing new (only the earlier request)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oa')::uuid) $$, 'the IT approver approves (both steps are now done)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% อนุมัติครบแล้ว'), 'NR-REQ', 'approved in full: the requester is told');
select is((select n.body from public.notifications n join public.employees e on e.id = n.recipient_id where n.action_url = '/office/repair/' || current_setting('t.oa') and n.title like '% อนุมัติครบแล้ว' and e.employee_no = 'NR-REQ'), 'รอ IT ดำเนินการ · PC-01 · ซ่อม', 'the requester is told IT is waiting to do the work');
select is(pg_temp.who(current_setting('t.oa'), '% อนุมัติครบ พร้อมให้ IT รับงาน'), 'NR-ADM,NR-ADM2,NR-DUAL', 'and every IT admin (not the approver who clicked)');
select is(pg_temp.total(current_setting('t.oa')), 8, 'four new rows');
select is(pg_temp.mine(current_setting('t.oa'), 'NR-APPR'), 1, 'the IT approver who clicked got no new row (only the earlier request)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_start(current_setting('t.oa')::uuid) $$, 'IT starts the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.oa')), 8, 'starting the work notifies nobody');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_complete(current_setting('t.oa')::uuid, 'สายหลวม', 'usage', null, 'internal', null, 'เสียบสายใหม่', null) $$, 'IT delivers the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), 'IT ส่งงานใบแจ้งซ่อม % แล้ว กรุณาตรวจรับ'), 'NR-REQ', 'delivered: only the requester is asked to check it');
select is((select n.title from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.oa') and n.title like 'IT ส่งงาน%'), 'IT ส่งงานใบแจ้งซ่อม ' || pg_temp.dn(current_setting('t.oa')) || ' แล้ว กรุณาตรวจรับ', 'the delivery title names the repair request');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.oa') and n.title like 'IT ส่งงาน%'), 'กดรับงาน หรือขอแก้ไขงานได้ที่หน้าใบแจ้งซ่อม · PC-01 · ซ่อม', 'the body tells what the requester can do');
select is(pg_temp.total(current_setting('t.oa')), 9, 'one new row');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_request_rework(current_setting('t.oa')::uuid, 'ยังเปิดไม่ติด', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the requester asks for a rework');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% ผู้แจ้งขอแก้ไขงาน'), 'NR-ADM,NR-ADM2,NR-DUAL', 'rework: every IT admin is told');
select is((select n.body from public.notifications n join public.employees e on e.id = n.recipient_id where n.action_url = '/office/repair/' || current_setting('t.oa') and n.title like '% ผู้แจ้งขอแก้ไขงาน' and e.employee_no = 'NR-ADM'), 'ทดสอบ NR-REQ · รอบที่ 1 · ต้องการ ' || to_char((now() at time zone 'Asia/Bangkok')::date + 2, 'DD/MM/') || ((extract(year from (now() at time zone 'Asia/Bangkok')::date + 2))::int + 543)::text || ' · ยังเปิดไม่ติด', 'the body has the round, the due date (Buddhist era) and the reason');
select is(pg_temp.total(current_setting('t.oa')), 12, 'three new rows');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_complete(current_setting('t.oa')::uuid, 'ขั้วเสีย', 'usage', null, 'internal', null, 'เปลี่ยนขั้ว', null) $$, 'IT delivers again');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_receive(current_setting('t.oa')::uuid) $$, 'the requester confirms receipt');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.oa')), 13, 'the second delivery notified the requester again and the receipt notified nobody');

-- 4. ไม่อนุมัติ -------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.ob', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_reject(current_setting('t.ob')::uuid, 'อาการไม่ชัดเจน') $$, 'the department manager rejects');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ob'), '% ไม่ได้รับอนุมัติ'), 'NR-REQ', 'rejected: the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.ob') and n.title like '% ไม่ได้รับอนุมัติ'), 'เหตุผล: อาการไม่ชัดเจน · โดย ' || pg_temp.name('NR-MGR'), 'the body has the reason and who decided');
select is(pg_temp.total(current_setting('t.ob')), 3, 'only that one row besides the two "waiting for you" rows');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.oc', pg_temp.new_req(), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oc'), '% รอคุณอนุมัติ'), 'NR-APPR,NR-APPR2', 'a department without a manager goes straight to the IT approvers (nobody from the department)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_itrp_reject(current_setting('t.oc')::uuid, 'ไม่จำเป็น') $$, 'the IT approver rejects');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oc'), '% ไม่ได้รับอนุมัติ'), 'NR-REQB', 'the requester is told of the IT rejection too');

-- 5. ถาม-ตอบ + ยกเลิก -------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.od', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.od')::uuid, 'เครื่องเสียตอนไหน') $$, 'the department manager asks');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.od'), '% มีคำถามถึงคุณ'), 'NR-REQ', 'question: the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.od') and n.title like '% มีคำถามถึงคุณ'), pg_temp.name('NR-MGR') || ': เครื่องเสียตอนไหน', 'the body is "<who>: <question>"');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_provide_info(current_setting('t.od')::uuid, 'เมื่อเช้า') $$, 'the requester answers');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.od'), '% ผู้แจ้งตอบคำถามแล้ว'), 'NR-MGR', 'answer: only the person who asked is told (not the other approver)');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.od') and n.title like '% ผู้แจ้งตอบคำถามแล้ว'), pg_temp.name('NR-REQ') || ': เมื่อเช้า', 'the body is "<requester>: <answer>"');
-- ผู้แจ้งยกเลิกเอง: ขั้นแผนก -> ผู้อนุมัติแผนก
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.od')::uuid, 'แจ้งผิดเครื่อง') $$, 'the requester cancels while the department step is pending');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.od'), '% ถูกยกเลิก'), 'NR-AMGR,NR-MGR', 'cancelled by the requester: the approvers of the step the request was waiting in');
select is((select n.body from public.notifications n join public.employees e on e.id = n.recipient_id where n.action_url = '/office/repair/' || current_setting('t.od') and n.title like '% ถูกยกเลิก' and e.employee_no = 'NR-MGR'), 'ผู้แจ้งยกเลิก · แจ้งผิดเครื่อง · ทดสอบ NR-REQ · แผนกทดสอบ R-A (มีผู้จัดการ) · PC-01 · ซ่อม', 'the body says the requester cancelled, why and what it was');
-- ยกเลิกตอนรอขั้น IT -> ผู้อนุมัติขั้น IT
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.oe', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oe')::uuid) $$, 'department step approved');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.oe')::uuid, 'ไม่ซ่อมแล้ว') $$, 'the requester cancels while the IT step is pending');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oe'), '% ถูกยกเลิก'), 'NR-APPR,NR-APPR2', 'cancelled in the IT step: the IT approvers (not IT admins: nothing was started)');
-- ยกเลิกหลังอนุมัติครบ -> ผู้ดูแลงาน IT
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.of', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.of')::uuid) $$, 'approved (department)');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.of')::uuid) $$, 'approved (IT)');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.of')::uuid, 'เปลี่ยนใจ') $$, 'cancelled after the full approval');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.of'), '% ถูกยกเลิก'), 'NR-ADM,NR-ADM2,NR-DUAL', 'cancelled after full approval: the IT admins (no step is waiting any more)');
-- IT ยกเลิกแทนผู้แจ้งที่ไม่ตอบ
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(12), true);
select set_config('t.og', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.og')::uuid) $$, 'approved (department)');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.og')::uuid) $$, 'approved (IT)');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_request_info(current_setting('t.og')::uuid, 'ขอรหัสเครื่อง') $$, 'IT asks after the approvals');
select lives_ok($$ select public.app_itrp_cancel(current_setting('t.og')::uuid, 'ผู้แจ้งไม่ตอบ') $$, 'IT cancels on behalf of the requester');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.og'), '% ถูกยกเลิก'), 'NR-REQ2', 'cancelled by IT: the requester is told (nobody else)');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.og') and n.title like '% ถูกยกเลิก'), pg_temp.name('NR-ADM') || ' · IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้งไม่ตอบ', 'the body names IT and says it cancelled on behalf of the requester');

-- 6. กรณีพิเศษของผู้แจ้ง ----------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.oh', pg_temp.new_req(), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh'), '% รอคุณอนุมัติ'), 'NR-APPR,NR-APPR2', 'a department manager filing: the department step is signed at once, only the IT approvers are asked');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select set_config('t.oi', pg_temp.new_req(), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oi')), 'NR-HEAD', 'an IT approver filing: nothing is approved at filing, only the IT head is asked (not the requester, not the other IT approvers, not the IT admins)');
select is(pg_temp.total(current_setting('t.oi')), 1, 'and nobody else');
-- ผู้แจ้งเป็นผู้ดูแลงาน IT ด้วย: ได้ข้อความเดียว ไม่ซ้ำ
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select set_config('t.oj', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oj')::uuid) $$, 'approved (department)');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.oj')::uuid) $$, 'approved (IT)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.mine(current_setting('t.oj'), 'NR-DUAL'), 1, 'a requester who is also an IT admin gets only one message about the full approval (no duplicate)');
select is(pg_temp.who(current_setting('t.oj'), '% อนุมัติครบ%'), 'NR-ADM,NR-ADM2,NR-DUAL', 'and the other IT admins still get theirs');

-- 7. งานด่วน ---------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.ou', pg_temp.new_req(true), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ou'), '% รอคุณอนุมัติ'), 'NR-AMGR,NR-MGR', 'urgent, created: the department approvers are asked as usual');
select is(pg_temp.who(current_setting('t.ou'), '% แจ้งซ่อมด่วน เริ่มทำได้ก่อนอนุมัติครบ'), 'NR-ADM,NR-ADM2,NR-DUAL', 'and every IT admin is told at once that IT can start before the approvals');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.ou') and n.title not like '🚨 [ด่วน] ใบแจ้งซ่อม %'), 0, 'every message of an urgent request starts with the urgent mark, once');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.ou') and n.title like '🚨 [ด่วน] 🚨%'), 0, 'the mark is not repeated');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.oa') and n.title like '🚨%'), 0, 'a normal request never gets the mark');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itrp_start(current_setting('t.ou')::uuid) $$, 'IT starts the urgent work before the approvals');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.ou')::uuid) $$, 'the department manager approves afterwards');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.ou')::uuid) $$, 'the IT approver approves afterwards');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ou'), '% อนุมัติครบแล้ว'), 'NR-REQ', 'fully approved after the start: the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.ou') and n.title like '% อนุมัติครบแล้ว'), 'IT กำลังดำเนินการ · PC-01 · ซ่อม', 'and the message says IT is already working (not "waiting for IT")');
select is(pg_temp.who(current_setting('t.ou'), '% อนุมัติครบแล้ว ส่งงานได้'), 'NR-ADM,NR-ADM2,NR-DUAL', 'the IT admins are told they can deliver now');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/repair/' || current_setting('t.ou') and n.title like '% พร้อมให้ IT รับงาน'), 0, 'nobody is told to "pick up" work that already started');

-- 8. โหมดทดสอบไม่ส่งแจ้งเตือน ------------------------------------------------
select set_config('t.n1', (select count(*)::text from public.notifications where action_url like '/office/repair/%'), true);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(11), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zrn_staff')::uuid) $$, 'the admin enters the test mode');
select set_config('t.t1', pg_temp.new_req(true), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zrn_mgr')::uuid) $$, 'switching to the manager persona');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.t1')::uuid) $$, 'the persona manager approves the urgent test request');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona (also the IT approver since 26/11/2026)');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.t1')::uuid) $$, 'the IT approver persona approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select lives_ok($$ select public.app_itrp_start(current_setting('t.t1')::uuid) $$, 'IT admin persona starts');
select lives_ok($$ select public.app_itrp_complete(current_setting('t.t1')::uuid, 'ก', 'usage', null, 'internal', null, 'ซ่อม', null) $$, 'and delivers');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.notifications where action_url like '/office/repair/%'), current_setting('t.n1')::int, 'a whole test-mode flow (file, approve, start, deliver) wrote no notification');
select is((select count(*)::int from public.notifications where action_url = '/office/repair/' || current_setting('t.t1')), 0, 'in particular none for the test request');
select is((select count(*)::int from public.itrp_events where is_test and request_id = current_setting('t.t1')::uuid), 5, 'while its history was recorded as usual');

-- 9. แจ้งเตือนล้มเหลวแล้วการกระทำไม่ล้มตาม (ทำท้ายสุด: แทนที่ฟังก์ชันส่งด้วยตัวที่ error) ----
create or replace function private.itrp_notify_each(p_recipients uuid[], p_already uuid[], p_actor_id uuid, p_title text, p_body text, p_action_url text)
returns uuid[] language plpgsql security definer set search_path = '' as $$
begin raise exception 'จำลองแจ้งเตือนล้มเหลว'; end $$;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select pg_temp.new_req() $$, 'filing still works when the notification code fails');
select set_config('t.ov', pg_temp.new_req(), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.ov')::uuid) $$, 'approving still works when the notification code fails');
select is(public.app_itrp_get_detail(current_setting('t.ov')::uuid)->>'status', 'pending_it_mgr', 'and the new status is saved');
select is((select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itrp_get_detail(current_setting('t.ov')::uuid)->'events') e), 'created,dept_approved', 'and the history (the ISO signature) is saved too');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.ov')), 0, 'no notification row exists for it');

select * from finish();
rollback;
