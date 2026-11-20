-- ทดสอบแจ้งเตือนของใบสั่งงาน IT (20261209010000_itwo_notifications.sql)
--   A) โครงสร้าง: trigger บน itwo_events + ฟังก์ชัน private ทั้งหมด (SECURITY DEFINER, search_path ว่าง, ถอนสิทธิ์ anon/authenticated)
--   B) helper กลาง: office_clip / office_format_date / office_notify (ผู้รับที่ไม่ใช่ตัวคน, ตัดความยาว, ตัวกรองแผนก ID ตัด email/push ให้เอง)
--   C) ทุกเหตุการณ์ได้ผู้รับถูก: แจ้งงานใหม่ (ขั้นแผนก / ขั้น IT ทันที / ผจก.แจ้งเอง / ผู้อนุมัติ IT แจ้งเอง / แผนกไม่มีผจก.),
--      แผนกอนุมัติ, อนุมัติครบ, ไม่อนุมัติ, ถาม-ตอบ (ก่อนอนุมัติ/หลังอนุมัติ), ส่งงาน, ขอแก้ไขงาน, ยกเลิก (ทุกขั้น + IT ยกเลิกแทน)
--      ไม่แจ้ง: เริ่มงาน (รวมงานด่วนก่อนอนุมัติ) และรับงาน · ไม่ส่งถึงคนที่กดเอง · ไม่ซ้ำผู้รับเดียวกันในเหตุการณ์เดียว
--      ผู้รับที่ inactive / ไม่มีบัญชีล็อกอินไม่ได้รับ · ข้อความ/ลิงก์ถูกต้อง
--   D) ใบทดสอบ (โหมดทดสอบ) ไม่ insert เลย และการกระทำไม่ล้ม · แจ้งเตือนล้มเหลวแล้วการอนุมัติไม่ล้มตาม
--      (ปิด sandbox_guard ชั่วคราวเพื่อพิสูจน์ว่าบรรทัดเช็กโหมดทดสอบใน office_notify ทำงานจริง และปิด FK ชั่วคราวเพื่อแยกพิสูจน์ is_test ของ event / ของใบ)
--   E) ไม่อนุมัติโดยผู้อนุมัติขั้น IT · ผู้แจ้งแผนก IT กดครั้งเดียวนับสองขั้น
--      งานด่วน: ผู้ดูแลงาน IT ได้แจ้งทันทีตอนแจ้ง · ป้าย "🚨 [ด่วน] " ครั้งเดียวทุกข้อความของใบด่วน · อนุมัติครบหลัง IT เริ่มงานแล้วไม่พูดว่ารอรับงาน
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (NT-*) ในแผนกทดสอบ ZNA/ZNB · persona SBX-IT-* มาจาก migration ของใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(173);

-- ตัวช่วย: รหัสพนักงานของผู้รับแจ้งเตือนของใบ (เรียงตามรหัส) ที่หัวข้อตรงรูปแบบ
create function pg_temp.who(p_order text, p_title_like text default '%') returns text language sql as $$
  select coalesce(string_agg(e.employee_no, ',' order by e.employee_no), '')
  from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = '/office/work-order/' || p_order and n.title like p_title_like
$$;
create function pg_temp.total(p_order text) returns integer language sql as $$
  select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || p_order
$$;
create function pg_temp.mine(p_order text, p_employee_no text) returns integer language sql as $$
  select count(*)::int from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = '/office/work-order/' || p_order and e.employee_no = p_employee_no
$$;

-- 1. โครงสร้าง ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.itwo_events'::regclass and t.tgname = 'itwo_events_notify' and t.tgtype & 1 = 1 and t.tgtype & 2 = 0), 1, 'itwo_events has the row level AFTER trigger itwo_events_notify');
select is((select (t.tgtype & 4)::int from pg_trigger t where t.tgrelid = 'public.itwo_events'::regclass and t.tgname = 'itwo_events_notify'), 4, 'and it fires on INSERT only (an event can never be updated or deleted)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('office_notify', 'itwo_notify_on_event', 'itwo_notify_each', 'itwo_notify_stage_approver_ids', 'itwo_notify_dept_approver_ids', 'itwo_notify_it_approver_ids', 'itwo_notify_it_admin_ids', 'itwo_request_type_text')), 'the notification functions that read tables are SECURITY DEFINER with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('office_clip', 'office_format_date')), 'the pure helper functions have an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('office_clip', 'office_format_date', 'office_notify', 'itwo_request_type_text', 'itwo_notify_on_event', 'itwo_notify_each', 'itwo_notify_stage_approver_ids', 'itwo_notify_dept_approver_ids', 'itwo_notify_it_approver_ids', 'itwo_notify_it_admin_ids') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'none of them can be called by anon or authenticated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%notify%' and p.proname like '%itwo%'), 0, 'no new public RPC was added (the browser cannot create these notifications)');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZNA', 'แผนกทดสอบ N-A (มีผู้จัดการ)', 'ZN A'), ('ZNB', 'แผนกทดสอบ N-B (ไม่มีผู้จัดการ)', 'ZN B');
-- แผนก ID (จำกัดอีเมล/push เฉพาะบางโมดูล) ใช้ของที่มีอยู่ ถ้ายังไม่มีสร้างให้
insert into public.departments (code, name_th, name_en)
select 'ID', 'อินดีไซน์ (ทดสอบ)', 'Indesign' where not exists (select 1 from public.departments where code = 'ID');
insert into auth.users (id, email, raw_user_meta_data)
select ('4e800000-0000-0000-0000-0000000000' || n)::uuid, 'itn-u' || n || '@test.local', '{}'::jsonb
from unnest(array['01', '02', '03', '04', '05', '06', '07', '08', '09', '11', '12', '13', '14']) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itn.test', d.id, r.id, v.uid::uuid, v.active
from (values
  ('NT-REQ', 'ZNA', 'staff', '4e800000-0000-0000-0000-000000000001', true),
  ('NT-MGR', 'ZNA', 'department_manager', '4e800000-0000-0000-0000-000000000002', true),
  ('NT-AMGR', 'ZNA', 'assistant_department_manager', '4e800000-0000-0000-0000-000000000003', true),
  ('NT-ADM', 'MGT', 'staff', '4e800000-0000-0000-0000-000000000004', true),
  ('NT-ADM2', 'MGT', 'staff', '4e800000-0000-0000-0000-000000000005', true),
  ('NT-APPR', 'MGT', 'general_manager', '4e800000-0000-0000-0000-000000000006', true),
  ('NT-APPR2', 'MGT', 'general_manager', '4e800000-0000-0000-0000-000000000007', true),
  ('NT-REQB', 'ZNB', 'staff', '4e800000-0000-0000-0000-000000000008', true),
  ('NT-INACT', 'ZNA', 'assistant_department_manager', '4e800000-0000-0000-0000-000000000009', false),
  ('NT-DUAL', 'ZNA', 'staff', '4e800000-0000-0000-0000-000000000011', true),
  ('NT-SBXADM', 'MGT', 'admin', '4e800000-0000-0000-0000-000000000012', true),
  ('NT-IDUSER', 'ID', 'staff', '4e800000-0000-0000-0000-000000000013', true)
) as v(no, dep, role, uid, active)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- พนักงานที่ถูกลบ (soft delete)
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active, deleted_at)
select 'NT-DELETED', 'ทดสอบ', 'NT-DELETED', 'nt-deleted@itn.test', d.id, r.id, ('4e800000-0000-0000-0000-000000000014')::uuid, false, now()
from public.departments d, public.roles r where d.code = 'ZNA' and r.code = 'staff';
-- ผู้อนุมัติแผนกที่ล็อกอินไม่ได้ (ยังไม่ผูกบัญชี) ต้องไม่ถูกนับเป็นผู้รับ
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select 'NT-NOAUTH', 'ทดสอบ', 'NT-NOAUTH', 'nt-noauth@itn.test', d.id, r.id, null, true
from public.departments d, public.roles r where d.code = 'ZNA' and r.code = 'assistant_department_manager';
-- NT-ADM, NT-ADM2 = ผู้ดูแลงาน IT · NT-APPR, NT-APPR2 = ผู้อนุมัติขั้น IT อย่างเดียว · NT-DUAL = ผู้แจ้งที่จะเป็นผู้ดูแลงาน IT ด้วยเฉพาะข้อ 10
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr
from (values ('NT-ADM', true, false), ('NT-ADM2', true, false), ('NT-APPR', false, true), ('NT-APPR2', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'NT-%' or employee_no in ('SBX-IT-STAFF', 'SBX-IT-ADMIN', 'SBX-IT-APPROVER');

-- 3. helper กลาง: ฟังก์ชันล้วน ---------------------------------------------
select is(private.office_clip(E'  หลาย\n  บรรทัด\t  ต่อกัน ', 100), 'หลาย บรรทัด ต่อกัน', 'office_clip: collapses whitespace and newlines into single spaces');
select is(private.office_clip(repeat('ก', 50), 10), repeat('ก', 9) || '…', 'office_clip: cuts at the limit and adds an ellipsis');
select is(private.office_clip(null, 10), '', 'office_clip: null becomes an empty string');
select is(private.office_format_date(date '2026-11-20'), '20/11/2569', 'office_format_date: dd/mm/yyyy in the Buddhist era, same as the module screens');
select is(private.office_format_date(null), '—', 'office_format_date: null is a dash');
select is(private.itwo_request_type_text('design', null), 'งานออกแบบ', 'request type text: design');
select is(private.itwo_request_type_text('misc', '  ซ่อมเครื่องพิมพ์  '), 'เบ็ดเตล็ดอื่นๆ · ซ่อมเครื่องพิมพ์', 'request type text: misc shows the detail the requester typed');
select is(private.itwo_request_type_text('system_access', null), 'สิทธิ์การใช้งานในระบบคอมพิวเตอร์', 'request type text: legacy system_access still has a name');

-- 4. helper กลาง: office_notify --------------------------------------------
select set_config('t.n0', (select count(*)::text from public.notifications), true);
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, 'หัวข้อทดสอบ', 'เนื้อหา', '/office/work-order/helper-1'), true, 'office_notify: a valid recipient gets the notification');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/helper-1' and n.recipient_id = current_setting('test.p_nt_req')::uuid and n.kind = 'event' and n.read_at is null and n.request_id is null and n.title = 'หัวข้อทดสอบ' and n.body = 'เนื้อหา'), 1, 'it is one unread kind=event row with no request_id (the same queue as email and push)');
select is((select n.email_status || '/' || n.push_status from public.notifications n where n.action_url = '/office/work-order/helper-1'), 'pending/pending', 'a department without restriction gets email and push queued as pending');
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, 'ตัวเอง', 'x', '/office/work-order/helper-2', current_setting('test.p_nt_req')::uuid), false, 'office_notify: never to the person who clicked (exclude id)');
select is(private.office_notify(null, 'ไม่มีผู้รับ', 'x', '/office/work-order/helper-2'), false, 'office_notify: no recipient');
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, '   ', 'x', '/office/work-order/helper-2'), false, 'office_notify: a blank title is refused');
select is(private.office_notify(current_setting('test.p_nt_inact')::uuid, 'ปิดการใช้งาน', 'x', '/office/work-order/helper-2'), false, 'office_notify: an inactive employee gets nothing');
select is(private.office_notify((select id from public.employees where employee_no = 'NT-NOAUTH'), 'ไม่มีบัญชี', 'x', '/office/work-order/helper-2'), false, 'office_notify: an employee without a login account (auth_user_id) gets nothing');
select is(private.office_notify((select id from public.employees where employee_no = 'SBX-IT-ADMIN'), 'บัญชีทดสอบ', 'x', '/office/work-order/helper-2'), false, 'office_notify: a test persona gets nothing');
select is(private.office_notify(current_setting('test.p_nt_deleted')::uuid, 'ถูกลบ', 'x', '/office/work-order/helper-2'), false, 'office_notify: a deleted employee gets nothing');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/helper-2'), 0, 'none of the refused calls wrote a row');
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, repeat('ห', 300), repeat('ข', 800), '/office/work-order/helper-3'), true, 'office_notify: very long text is accepted');
select is((select char_length(n.title) || '/' || char_length(n.body) from public.notifications n where n.action_url = '/office/work-order/helper-3'), '200/500', 'but cut to 200 characters for the title and 500 for the body');
-- แผนก ID: ตัวกรองเดิมตัด email/push ให้เอง กระดิ่งยังมี
select is(private.office_notify(current_setting('test.p_nt_iduser')::uuid, 'แผนก ID', 'x', '/office/work-order/helper-4'), true, 'office_notify: a department-ID employee still gets the bell row');
select is((select n.email_status || '/' || n.push_status || '/' || n.email_error || '/' || n.push_error from public.notifications n where n.action_url = '/office/work-order/helper-4'), 'skipped/skipped/DEPARTMENT_FILTERED/DEPARTMENT_FILTERED', 'but the existing department filter skipped its email and push (office work orders are not on the ID list)');

-- 5. ใบปกติ: แจ้งงาน → แผนกอนุมัติ → IT อนุมัติ → เริ่ม → ส่งงาน → ขอแก้ไข → ส่งงาน → รับงาน --------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oa', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบหลักของแจ้งเตือน', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select set_config('t.needed', to_char((now() at time zone 'Asia/Bangkok')::date + 3, 'DD/MM/') || (extract(year from ((now() at time zone 'Asia/Bangkok')::date + 3))::int + 543)::text, true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% รอคุณอนุมัติ'), 'NT-AMGR,NT-MGR', 'created (waits for the department): every department approver (manager and assistant), not the requester, not the inactive or login-less approver, not the IT side');
select is(pg_temp.total(current_setting('t.oa')), 2, 'and nobody else got a notification');
select is((select n.title from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oa') and n.recipient_id = current_setting('test.p_nt_mgr')::uuid), 'ใบสั่งงาน ' || (select doc_no from public.itwo_work_orders where id = current_setting('t.oa')::uuid) || ' รอคุณอนุมัติ', 'the title carries the document number');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oa') and n.recipient_id = current_setting('test.p_nt_mgr')::uuid), 'ทดสอบ NT-REQ · แผนกทดสอบ N-A (มีผู้จัดการ) · งานออกแบบ · ต้องการ ' || current_setting('t.needed'), 'the body is requester · department · type · needed date (dd/mm/yyyy)');
select is((select n.kind || '/' || n.email_status || '/' || n.push_status from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oa') and n.recipient_id = current_setting('test.p_nt_mgr')::uuid), 'event/pending/pending', 'it is a normal event row, so email and push are queued');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oa')::uuid) $$, 'the department manager approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% รอคุณอนุมัติ'), 'NT-AMGR,NT-APPR,NT-APPR2,NT-MGR', 'department approved: the IT approvers are asked next');
select is(pg_temp.total(current_setting('t.oa')), 4, 'one new row per IT approver and none for the manager who clicked');
select is(pg_temp.mine(current_setting('t.oa'), 'NT-MGR'), 1, 'the department manager who approved got nothing new (only the earlier request)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oa')::uuid) $$, 'the IT approver approves (both steps are now done)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% อนุมัติครบแล้ว'), 'NT-REQ', 'approved in full: the requester is told');
select is(pg_temp.who(current_setting('t.oa'), '% อนุมัติครบ พร้อมให้ IT รับงาน'), 'NT-ADM,NT-ADM2', 'and every IT admin (not the approver who clicked)');
select is(pg_temp.total(current_setting('t.oa')), 7, 'three new rows');
select is(pg_temp.mine(current_setting('t.oa'), 'NT-APPR'), 1, 'the IT approver who clicked got no new row (only the earlier request)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.oa')::uuid) $$, 'IT starts the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.oa')), 7, 'starting the work notifies nobody');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.oa')::uuid) $$, 'IT delivers the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), 'IT ส่งงานใบสั่งงาน % แล้ว กรุณาตรวจรับ'), 'NT-REQ', 'delivered: only the requester is told');
select is(pg_temp.total(current_setting('t.oa')), 8, 'one new row');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_rework(current_setting('t.oa')::uuid, 'ขอแก้สีโลโก้ให้เข้มขึ้น', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the requester asks for a rework');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oa'), '% ผู้แจ้งขอแก้ไขงาน'), 'NT-ADM,NT-ADM2', 'rework: every IT admin is told');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oa') and n.title like '% ผู้แจ้งขอแก้ไขงาน' and n.recipient_id = current_setting('test.p_nt_adm')::uuid), 'ทดสอบ NT-REQ · รอบที่ 1 · ต้องการ ' || private.office_format_date((now() at time zone 'Asia/Bangkok')::date + 2) || ' · ขอแก้สีโลโก้ให้เข้มขึ้น', 'the rework body has the round, the due date and the request');
select is(pg_temp.total(current_setting('t.oa')), 10, 'two new rows');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.oa')::uuid) $$, 'IT delivers the rework');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_receive(current_setting('t.oa')::uuid) $$, 'the requester receives the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.oa')), 11, 'delivering again notified the requester once; receiving the work notifies nobody');

-- 6. ไม่อนุมัติ: แจ้งผู้แจ้งพร้อมเหตุผลย่อ ---------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.ob', (select id::text from public.app_itwo_create('misc', null, 'no', null, 'ใบที่จะถูกปฏิเสธ', ((now() at time zone 'Asia/Bangkok')::date + 3), false, 'ซ่อมเครื่องพิมพ์ชั้น 2')), true);
select is(public.app_itwo_get_detail(current_setting('t.ob')::uuid)->>'status', 'pending_dept', 'the second order waits for the department');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_reject(current_setting('t.ob')::uuid, (select string_agg('เหตุผลยาว' || g, E'\n') from generate_series(1, 30) g)) $$, 'the assistant manager rejects with a long multi line reason');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ob'), '% ไม่ได้รับอนุมัติ'), 'NT-REQ', 'rejected: only the requester is told');
select is(pg_temp.total(current_setting('t.ob')), 3, 'together with the two department approvers asked at the start');
select ok((select char_length(n.body) <= 500 and n.body not like E'%\n%' and n.body like 'เหตุผล: เหตุผลยาว1 %' and n.body like '%… · โดย ทดสอบ NT-AMGR' from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ob') and n.title like '% ไม่ได้รับอนุมัติ'), 'the reason is shortened to one line and says who rejected');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ob') and n.recipient_id = current_setting('test.p_nt_mgr')::uuid), 'ทดสอบ NT-REQ · แผนกทดสอบ N-A (มีผู้จัดการ) · เบ็ดเตล็ดอื่นๆ · ซ่อมเครื่องพิมพ์ชั้น 2 · ต้องการ ' || private.office_format_date((now() at time zone 'Asia/Bangkok')::date + 3), 'a misc order names the work the requester typed');

-- 7. ผู้จัดการแผนกแจ้งเอง: ข้ามขั้นแผนก ไปรอผู้อนุมัติขั้น IT ทันที ---------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('t.oc', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผจก.แจ้งเอง', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oc')), 'NT-APPR,NT-APPR2', 'a department manager filing his own order: the IT approvers are asked at once (and the automatic department approval does not ask them twice)');
select is(pg_temp.total(current_setting('t.oc')), 2, 'two rows in all');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000007","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oc')::uuid) $$, 'the IT approver approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oc'), '% อนุมัติครบแล้ว'), 'NT-MGR', 'the manager who filed it is told it is fully approved');
select is(pg_temp.who(current_setting('t.oc'), '% พร้อมให้ IT รับงาน'), 'NT-ADM,NT-ADM2', 'and the IT admins');

-- 8. ผู้อนุมัติขั้น IT แจ้งเอง: อนุมัติครบทันที แจ้งเฉพาะผู้ดูแลงาน IT ----------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('t.od', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้อนุมัติ IT แจ้งเอง', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.od')), 'NT-ADM,NT-ADM2', 'an IT approver filing an order (approved at once): only the IT admins are told, once each');
select is(pg_temp.total(current_setting('t.od')), 2, 'no row for the requester himself and none for the other IT approver');

-- 9. แผนกไม่มีผู้จัดการ: ผู้อนุมัติขั้น IT กดครั้งเดียวนับสองขั้น ---------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000008","role":"authenticated"}', true);
select set_config('t.oe', (select id::text from public.app_itwo_create('design', null, 'no', null, 'แผนกไม่มีผู้จัดการ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oe')), 'NT-APPR,NT-APPR2', 'a department without managers sends it to the IT approvers');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oe')::uuid) $$, 'one click counts both steps');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oe'), '% อนุมัติครบแล้ว'), 'NT-REQB', 'the requester is told once');
select is(pg_temp.total(current_setting('t.oe')), 5, 'two asked + requester + two IT admins (the double event of one click made no extra row)');
select is(pg_temp.mine(current_setting('t.oe'), 'NT-APPR2'), 1, 'the other IT approver got only the request, not an "asked again" row');
select is(pg_temp.mine(current_setting('t.oe'), 'NT-APPR'), 1, 'the approver who clicked got only his own earlier request (nothing new)');

-- 10. ผู้แจ้งที่เป็นผู้ดูแลงาน IT ด้วย: ได้ข้อความเดียวในเหตุการณ์เดียว -------------------------
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver) values (current_setting('test.p_nt_dual')::uuid, true, false);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select set_config('t.of', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้แจ้งเป็นผู้ดูแลงาน IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.of')::uuid) $$, 'the manager approves');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.of')::uuid) $$, 'the IT approver approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.mine(current_setting('t.of'), 'NT-DUAL'), 1, 'a requester who is also an IT admin gets exactly one "fully approved" message');
select is(pg_temp.who(current_setting('t.of'), '% พร้อมให้ IT รับงาน'), 'NT-ADM,NT-ADM2', 'and the "ready for IT" message goes to the other admins only');
delete from public.itwo_staff where employee_id = current_setting('test.p_nt_dual')::uuid;

-- 11. ถาม-ตอบ ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.og', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ถามตอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.og')::uuid, 'ขอรายละเอียดเพิ่ม') $$, 'the department manager asks the requester');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.og'), '% มีคำถามถึงคุณ'), 'NT-REQ', 'ask: only the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.og') and n.title like '% มีคำถามถึงคุณ'), 'ทดสอบ NT-MGR: ขอรายละเอียดเพิ่ม', 'with who asked and the question');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.og')::uuid, 'แนบรายละเอียดตามที่ขอ') $$, 'the requester answers');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.og'), '% ผู้แจ้งตอบคำถามแล้ว'), 'NT-MGR', 'answer: only the person who asked is told (not the other department approvers)');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.og') and n.title like '% ผู้แจ้งตอบคำถามแล้ว'), 'ทดสอบ NT-REQ: แนบรายละเอียดตามที่ขอ', 'with the answer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.og')::uuid) $$, 'the manager approves after the answer');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.og')::uuid) $$, 'the IT approver approves');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.og')::uuid, 'ขอไฟล์ต้นฉบับ') $$, 'IT asks after the approval');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.og')::uuid, 'ส่งไฟล์ให้แล้ว') $$, 'the requester answers IT');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.og'), '% มีคำถามถึงคุณ'), 'NT-REQ,NT-REQ', 'the requester got both questions (one from the manager, one from IT)');
select is(pg_temp.who(current_setting('t.og'), '% ผู้แจ้งตอบคำถามแล้ว'), 'NT-ADM,NT-MGR', 'each answer went to the person who asked that question');

-- 12. ยกเลิก: ผู้รับตามขั้นที่ใบรออยู่ --------------------------------------------
-- 12.1 รอขั้นแผนก -> ผู้อนุมัติแผนก
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oh1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ยกเลิกตอนรอแผนก', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.oh1')::uuid, 'เปลี่ยนใจ') $$, 'the requester cancels while the department step is open');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh1'), '% ถูกยกเลิก'), 'NT-AMGR,NT-MGR', 'cancel at the department step: the department approvers');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oh1') and n.title like '% ถูกยกเลิก' and n.recipient_id = current_setting('test.p_nt_mgr')::uuid), 'ผู้แจ้งยกเลิก · เปลี่ยนใจ · ทดสอบ NT-REQ · แผนกทดสอบ N-A (มีผู้จัดการ) · งานออกแบบ · ต้องการ ' || private.office_format_date((now() at time zone 'Asia/Bangkok')::date + 3), 'the body says the requester cancelled, with the reason');
-- 12.2 รอขั้น IT -> ผู้อนุมัติขั้น IT
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select set_config('t.oh2', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ยกเลิกตอนรอ IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.oh2')::uuid, 'ไม่ต้องการแล้ว') $$, 'a manager cancels his own order while the IT step is open');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh2'), '% ถูกยกเลิก'), 'NT-APPR,NT-APPR2', 'cancel at the IT step: the IT approvers (not the IT admins)');
-- 12.3 อนุมัติครบแล้ว -> ผู้ดูแลงาน IT
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oh3', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ยกเลิกหลังอนุมัติ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oh3')::uuid) $$, 'department approves');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oh3')::uuid) $$, 'IT approves');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.oh3')::uuid, 'เลิกใช้') $$, 'the requester cancels an approved order');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh3'), '% ถูกยกเลิก'), 'NT-ADM,NT-ADM2', 'cancel after approval: the IT admins only');
-- 12.4 งานด่วนที่ IT เริ่มก่อนอนุมัติ: เริ่มงานไม่แจ้ง · ยกเลิก -> ผู้อนุมัติขั้นที่ค้าง + ผู้ดูแลงาน IT
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oh4', (select id::text from public.app_itwo_create('design', null, 'no', null, 'งานด่วน', ((now() at time zone 'Asia/Bangkok')::date + 1), true)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.oh4')::uuid) $$, 'IT starts an urgent order before any approval');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.oh4')), 4, 'starting it added no notification (only the two department approvers and the two IT admins told at filing)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.oh4')::uuid, 'ไม่เร่งแล้ว') $$, 'the requester cancels the urgent order that IT has started');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh4'), '% ถูกยกเลิก'), 'NT-ADM,NT-ADM2,NT-AMGR,NT-MGR', 'cancel: the approvers of the open step and the IT admins who had started');
-- 12.5 IT ยกเลิกแทนผู้แจ้ง (ใบที่รอผู้แจ้งตอบ) -> ผู้แจ้ง
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oh5', (select id::text from public.app_itwo_create('design', null, 'no', null, 'IT ยกเลิกแทน', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.oh5')::uuid, 'ขอข้อมูล') $$, 'the manager asks and the order waits for the requester');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_cancel(current_setting('t.oh5')::uuid, 'ผู้แจ้งไม่ตอบ') $$, 'IT cancels on behalf of the requester');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oh5'), '% ถูกยกเลิก'), 'NT-REQ', 'IT cancelled on behalf: the requester is told');
select ok((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oh5') and n.title like '% ถูกยกเลิก') = 'ทดสอบ NT-ADM · IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้งไม่ตอบ', 'the body says IT did it, with the reason');

-- 13. แจ้งเตือนล้มเหลวต้องไม่ทำให้การทำงานล้ม --------------------------------------
create function public.zz_notify_block() returns trigger language plpgsql as $$
begin
  if new.recipient_id = (select e.id from public.employees e where e.employee_no = 'NT-AMGR') then
    raise exception 'boom (test)';
  end if;
  return new;
end $$;
create trigger zz_notify_block before insert on public.notifications for each row execute function public.zz_notify_block();
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oi', (select id::text from public.app_itwo_create('design', null, 'no', null, 'แจ้งเตือนล้ม', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.oi')::uuid)->>'status', 'pending_dept', 'a notification row that fails does not stop the order from being filed');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oi')), 'NT-MGR', 'and the other recipients of the same event still got theirs');
select is((select count(*)::int from public.itwo_events e where e.work_order_id = current_setting('t.oi')::uuid and e.action = 'created'), 1, 'the ISO event is recorded');
drop trigger zz_notify_block on public.notifications;

-- 14. โหมดทดสอบ: ใบทดสอบไม่ insert เลย และการกระทำไม่ล้ม -----------------------------------
select set_config('t.n_before', (select count(*)::text from public.notifications), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'the admin enters the test mode as the IT requester persona');
select set_config('t.t1', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ใบทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
select is(public.app_itwo_get_detail(current_setting('t.t1')::uuid)->>'is_test', 'true', 'filing in the test mode makes a test order (the notification trigger runs in test mode without error)');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switch to the IT approver persona');
select lives_ok($$ select public.app_itwo_request_info(current_setting('t.t1')::uuid, 'ถามในโหมดทดสอบ') $$, 'the persona asks');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'back to the requester persona');
select lives_ok($$ select public.app_itwo_provide_info(current_setting('t.t1')::uuid, 'ตอบในโหมดทดสอบ') $$, 'the persona answers');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switch to the IT approver persona again');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.t1')::uuid) $$, 'the persona approves (both steps)');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switch to the IT admin persona');
select lives_ok($$ select public.app_itwo_start(current_setting('t.t1')::uuid) $$, 'the persona starts');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.t1')::uuid) $$, 'the persona delivers');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'back to the requester persona for the rework');
select lives_ok($$ select public.app_itwo_request_rework(current_setting('t.t1')::uuid, 'แก้ในโหมดทดสอบ', ((now() at time zone 'Asia/Bangkok')::date + 2)) $$, 'the persona asks for a rework');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itwo_events e where e.work_order_id = current_setting('t.t1')::uuid), 8, 'the test order has its whole history');
select is((select count(*)::text from public.notifications), current_setting('t.n_before'), 'but not a single notification row was added by the whole test-mode flow (no email, no push, no bell)');
select is(pg_temp.total(current_setting('t.t1')), 0, 'and none points at the test order');
-- ชั้นที่สอง: แม้ trigger ถูกเรียกขณะ session อยู่ในโหมดทดสอบ office_notify ก็ไม่เขียน
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'the admin enters the test mode again');
-- ฟังก์ชัน private เรียกได้เฉพาะเจ้าของ: กลับเป็น postgres แต่คงตัวตนของ admin (auth.uid) ไว้
reset role;
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, 'ในโหมดทดสอบ', 'x', '/office/work-order/helper-5'), false, 'office_notify itself refuses to write while the session is in the test mode');
-- พิสูจน์ว่าเป็นบรรทัดเช็กโหมดทดสอบของ office_notify ไม่ใช่ sandbox_guard ที่ exception block จับไว้เงียบ ๆ: ปิด guard ชั่วคราว (เปิดคืนท้ายส่วนนี้) แล้วต้องยังไม่เขียน
alter table public.notifications disable trigger sandbox_guard;
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, 'ในโหมดทดสอบ (ปิด guard)', 'x', '/office/work-order/helper-6'), false, 'with sandbox_guard switched off, office_notify still refuses in the test mode (its own check, not the guard)');
select is(pg_temp.total('helper-6'), 0, 'and wrote nothing');
set local role authenticated;
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
-- ตัวควบคุม: นอกโหมดทดสอบ ด้วย guard ที่ยังปิดอยู่ คำเรียกเดียวกันเขียนได้ (แปลว่าผลข้างบนมาจากการเช็กโหมดทดสอบจริง)
select is(private.office_notify(current_setting('test.p_nt_req')::uuid, 'นอกโหมดทดสอบ', 'x', '/office/work-order/helper-6'), true, 'control: the same call outside the test mode does write (so the refusal above came from the test mode check)');
alter table public.notifications enable trigger sandbox_guard;
select is((select t.tgenabled::text from pg_trigger t where t.tgrelid = 'public.notifications'::regclass and t.tgname = 'sandbox_guard'), 'O', 'sandbox_guard is switched back on');
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total('helper-5'), 0, 'nothing was written');
-- ใบทดสอบที่แทรกตรง ๆ (เหมือน persona) ก็ไม่แจ้ง และไม่ล้ม
select lives_ok($$ insert into public.itwo_events (is_test, work_order_id, actor_id, action) values (true, current_setting('t.t1')::uuid, (select id from public.employees where employee_no = 'SBX-IT-ADMIN'), 'completed') $$, 'an event on a test order inserted directly (as postgres) does not fail');

-- แยกพิสูจน์ is_test ของ event กับ is_test ของใบ: ปกติ FK (work_order_id, is_test) บังคับให้เท่ากันเสมอ จึงปิด FK ชั่วคราว (ย้อนด้วย rollback ของธุรกรรม)
-- ผู้รับที่ใช้ (ผู้ดูแลงาน IT NT-ADM/NT-ADM2 และผู้แจ้ง NT-REQ) เป็นบัญชีจริง ชั้นอื่น (office_notify) จึงไม่บัง
alter table public.itwo_events drop constraint itwo_events_work_order_id_is_test_fkey;
select set_config('t.n_is_test', (select count(*)::text from public.notifications), true);
select lives_ok($$ insert into public.itwo_events (is_test, work_order_id, actor_id, action) values (true, current_setting('t.oa')::uuid, current_setting('test.p_nt_appr')::uuid, 'it_mgr_approved') $$, 'an event flagged is_test on a real order is inserted');
select is((select count(*)::text from public.notifications), current_setting('t.n_is_test'), 'and the trigger skips it on the event flag alone (real recipients, nothing written)');
select lives_ok($$ insert into public.itwo_events (is_test, work_order_id, actor_id, action) values (false, current_setting('t.t1')::uuid, current_setting('test.p_nt_appr')::uuid, 'it_mgr_approved') $$, 'an unflagged event on a test order is inserted');
select is((select count(*)::text from public.notifications), current_setting('t.n_is_test'), 'and the trigger skips it on the order flag alone (real IT admins, nothing written)');
select lives_ok($$ insert into public.itwo_events (is_test, work_order_id, actor_id, action) values (false, current_setting('t.oa')::uuid, current_setting('test.p_nt_appr')::uuid, 'it_mgr_approved') $$, 'control: the same event with both flags false is inserted');
select ok((select count(*) from public.notifications) > current_setting('t.n_is_test')::bigint, 'and that one does notify (so the two skips above came from the is_test checks)');

-- 15. ไม่อนุมัติโดยผู้อนุมัติขั้น IT ----------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.oj', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ถูกปฏิเสธขั้น IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.oj')::uuid) $$, 'the department manager approves');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_reject(current_setting('t.oj')::uuid, 'งบไม่พอ') $$, 'the IT approver rejects at the IT step');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.oj'), '% ไม่ได้รับอนุมัติ'), 'NT-REQ', 'IT step rejected: only the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oj') and n.title like '% ไม่ได้รับอนุมัติ'), 'เหตุผล: งบไม่พอ · โดย ทดสอบ NT-APPR', 'with the reason and who rejected');
select is(pg_temp.who(current_setting('t.oj'), '% อนุมัติครบ%'), '', 'and nobody is told it was approved in full');
select is(pg_temp.total(current_setting('t.oj')), 5, 'two department approvers asked at filing, two IT approvers asked after the department, and the requester (nothing for IT admins)');

-- 16. ผู้แจ้งอยู่แผนก IT: ไม่มีขั้นแผนก ผู้อนุมัติขั้น IT กดครั้งเดียวนับสองขั้น -------------------
insert into auth.users (id, email, raw_user_meta_data) values ('4e800000-0000-0000-0000-000000000015', 'itn-u15@test.local', '{}'::jsonb);
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select 'NT-ITREQ', 'ทดสอบ', 'NT-ITREQ', 'nt-itreq@itn.test', d.id, r.id, '4e800000-0000-0000-0000-000000000015'::uuid, true
from public.departments d, public.roles r where d.code = 'IT' and r.code = 'staff';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000015","role":"authenticated"}', true);
select set_config('t.ok', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้แจ้งแผนก IT', ((now() at time zone 'Asia/Bangkok')::date + 3), false)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ok')), 'NT-APPR,NT-APPR2', 'a requester in the IT department: the IT approvers are asked at once (there is no department step)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.ok')::uuid) $$, 'one click by the IT approver counts both steps');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ok'), '% อนุมัติครบแล้ว'), 'NT-ITREQ', 'the requester is told once');
select is(pg_temp.who(current_setting('t.ok'), '% พร้อมให้ IT รับงาน'), 'NT-ADM,NT-ADM2', 'and the IT admins');
select is(pg_temp.total(current_setting('t.ok')), 5, 'two asked + requester + two IT admins: the department approval of the same click asked nobody again');

-- 17. งานด่วน: แจ้ง IT ทันที + ป้ายด่วน + อนุมัติครบหลัง IT เริ่มงานแล้ว --------------------------
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.oa') and n.title like '%ด่วน%'), 0, 'a normal order never carries the urgent mark (checked on the very first order of this file)');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select set_config('t.ou', (select id::text from public.app_itwo_create('design', null, 'no', null, 'งานด่วนเต็มรูปแบบ', ((now() at time zone 'Asia/Bangkok')::date + 1), true)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select set_config('t.ou_no', (select doc_no from public.itwo_work_orders where id = current_setting('t.ou')::uuid), true);
select is(pg_temp.who(current_setting('t.ou')), 'NT-ADM,NT-ADM2,NT-AMGR,NT-MGR', 'urgent filing: the department approvers AND every IT admin are told at once');
select is(pg_temp.who(current_setting('t.ou'), '% แจ้งงานด่วน เริ่มทำได้ก่อนอนุมัติครบ'), 'NT-ADM,NT-ADM2', 'the admins get the "may start before approval" message');
select is((select n.title from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.recipient_id = current_setting('test.p_nt_adm')::uuid), '🚨 [ด่วน] ใบสั่งงาน ' || current_setting('t.ou_no') || ' แจ้งงานด่วน เริ่มทำได้ก่อนอนุมัติครบ', 'the admin title is exactly the urgent mark + document number + message');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.title not like '🚨 [ด่วน] %'), 0, 'every message of an urgent order starts with the urgent mark');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.title like '%[ด่วน]%[ด่วน]%'), 0, 'and the mark is there only once');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.ou')::uuid) $$, 'IT starts the urgent order before any approval');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.ou')::uuid) $$, 'the department manager approves the order that is already in progress');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select w.status from public.itwo_work_orders w where w.id = current_setting('t.ou')::uuid), 'in_progress', 'the order stays in progress after the department approval');
select is(pg_temp.who(current_setting('t.ou'), '% รอคุณอนุมัติ'), 'NT-AMGR,NT-APPR,NT-APPR2,NT-MGR', 'department approval on an urgent order in progress: the IT approvers are asked');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.title like '% รอคุณอนุมัติ' and n.title like '🚨 [ด่วน] %'), 4, 'and those messages carry the urgent mark too');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.ou')::uuid) $$, 'the IT approver approves: fully approved while IT is already working');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ou'), '% อนุมัติครบแล้ว ส่งงานได้'), 'NT-ADM,NT-ADM2', 'fully approved after IT started: the admins are told they may deliver');
select is(pg_temp.who(current_setting('t.ou'), '% พร้อมให้ IT รับงาน'), '', 'and nobody is told it is "ready for IT to take"');
select is((select n.body from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.title like '% อนุมัติครบแล้ว' and n.recipient_id = current_setting('test.p_nt_req')::uuid), 'IT กำลังดำเนินการ · งานออกแบบ · ต้องการ ' || private.office_format_date((now() at time zone 'Asia/Bangkok')::date + 1), 'the requester is told IT is working on it (not that it waits for IT)');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.body like '%รอ IT ดำเนินการ%'), 0, 'no message of that order says it waits for IT');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok($$ select public.app_itwo_complete(current_setting('t.ou')::uuid) $$, 'IT delivers the urgent order');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select n.title from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ou') and n.title like '%ส่งงาน%แล้ว กรุณาตรวจรับ'), '🚨 [ด่วน] IT ส่งงานใบสั่งงาน ' || current_setting('t.ou_no') || ' แล้ว กรุณาตรวจรับ', 'the delivered message carries the urgent mark once');
-- ผู้อนุมัติขั้น IT แจ้งงานด่วนเอง (อนุมัติครบตั้งแต่แจ้ง): ผู้ดูแลงานได้ข้อความเดียวต่อคน ไม่ซ้ำกับ "แจ้งงานด่วน"
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"4e800000-0000-0000-0000-000000000006","role":"authenticated"}', true);
select set_config('t.ov', (select id::text from public.app_itwo_create('design', null, 'no', null, 'ผู้อนุมัติ IT แจ้งงานด่วน', ((now() at time zone 'Asia/Bangkok')::date + 1), true)), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.ov')), 'NT-ADM,NT-ADM2', 'an IT approver filing an urgent order (approved at once): each admin gets one message, not two');
select is((select count(*)::int from public.notifications n where n.action_url = '/office/work-order/' || current_setting('t.ov') and n.title like '🚨 [ด่วน] % อนุมัติครบ พร้อมให้ IT รับงาน'), 2, 'and it is the "approved in full, ready for IT" one, with the urgent mark');

select * from finish();
rollback;
