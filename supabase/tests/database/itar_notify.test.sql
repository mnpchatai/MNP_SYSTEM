-- ทดสอบแจ้งเตือนของใบขอสิทธิ์ IT (20270107010000_itar_access_requests.sql ส่วนที่ 19)
--   A) โครงสร้าง: trigger บน itar_events + ฟังก์ชัน private (SECURITY DEFINER, search_path ว่าง, ถอนสิทธิ์ anon/authenticated) · ไม่มี RPC สาธารณะใหม่ · ไม่ replace private.office_notify
--   B) ทุกเหตุการณ์ได้ผู้รับถูก: ยื่นใหม่ (ขั้นแผนก / ขั้น IT ทันที / ผู้ยื่นเป็นผู้อนุมัติขั้น IT -> หัวหน้า IT), อนุมัติแผนก -> ขั้น IT, อนุมัติครบ (ผู้ยื่น + ผู้รับสิทธิ์ + IT),
--      ไม่อนุมัติ, ถาม-ตอบ, IT บันทึกลงทะเบียน (ผู้รับสิทธิ์ต้องกดรับทราบ / ยกเลิกทั้งหมดแจ้งผู้ยื่น), รับทราบ, ยกเลิก (ผู้ยื่น / IT แทน) · ไม่แจ้ง: รับงาน · ไม่ส่งถึงคนที่กดเอง
--   C) ข้อความ/ลิงก์ถูกต้อง: ลิงก์ /office/access/<uuid> · คำว่า "ใบขอสิทธิ์" · ไม่มีรหัสผ่าน
--   D) ใบทดสอบ (โหมดทดสอบ) ไม่ส่งเลย · แจ้งเตือนล้มเหลวแล้วการอนุมัติไม่ล้มตาม
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (N-*) ในแผนกทดสอบ ZNA/ZNB/ZNM · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
-- (ไม่ตรวจคอลัมน์ email_status/push_status ของ notifications: เป็นเรื่องของตัวกลาง office_notify ที่ทดสอบใน itwo_notify.test.sql)
begin;

create extension if not exists pgtap with schema extensions;
select plan(94);

create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"3c400000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.mk(p_type text, p_reason text, p_items jsonb default '[]'::jsonb, p_subject jsonb default null) returns text language sql as $$
  select (select id::text from public.app_itar_create(p_type, p_reason, p_items, p_subject)) $$;
create function pg_temp.items(p_id uuid) returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('item_id', i ->> 'id', 'decision', 'applied') order by (i ->> 'line_no')::int) from jsonb_array_elements(public.app_itar_get_detail(p_id) -> 'items') i $$;
-- รหัสพนักงานของผู้รับแจ้งเตือนของใบ (เรียงตามรหัส) ที่หัวข้อตรงรูปแบบ · ต้องเรียกด้วยสิทธิ์เจ้าของตาราง
create function pg_temp.who(p_req text, p_title_like text default '%') returns text language sql as $$
  select coalesce(string_agg(e.employee_no, ',' order by e.employee_no), '')
  from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = '/office/access/' || p_req and n.title like p_title_like $$;
create function pg_temp.total(p_req text) returns integer language sql as $$
  select count(*)::int from public.notifications n where n.action_url = '/office/access/' || p_req $$;
create function pg_temp.dn(p_req text) returns text language sql as $$ select doc_no from public.itar_requests where id = p_req::uuid $$;
create function pg_temp.name(p_no text) returns text language sql as $$ select first_name || ' ' || last_name from public.employees where employee_no = p_no $$;

-- 1. โครงสร้าง ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_trigger t where t.tgrelid = 'public.itar_events'::regclass and t.tgname = 'itar_events_notify' and t.tgtype & 1 = 1 and t.tgtype & 2 = 0), 1, 'itar_events has the row level AFTER trigger itar_events_notify');
select is((select (t.tgtype & 4)::int from pg_trigger t where t.tgrelid = 'public.itar_events'::regclass and t.tgname = 'itar_events_notify'), 4, 'and it fires on INSERT only (an event can never be updated or deleted)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itar_notify_on_event', 'itar_notify_each', 'itar_notify_stage_approver_ids', 'itar_notify_dept_approver_ids', 'itar_notify_it_admin_ids', 'itar_notify_it_stage_ids')), 'the notification helpers are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_notify\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'and not callable by anon or authenticated');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like '%notify%' and p.proname like '%itar%'), 0, 'no public RPC was added for notifications (the browser cannot create these rows)');
select ok(position('itar' in pg_get_functiondef('private.office_notify(uuid, text, text, text, uuid)'::regprocedure)) = 0, 'the shared private.office_notify was not replaced (it knows nothing about itar)');
select is(private.itar_type_text('new'), 'ขอสิทธิ์ใหม่', 'type text: new');
select is(private.itar_type_text('change'), 'เปลี่ยนแปลงสิทธิ์', 'type text: change');
select is(private.itar_type_text('revoke_all'), 'ยกเลิกสิทธิ์ทั้งหมด', 'type text: revoke_all');

-- 2. ข้อมูลทดสอบ ----------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZNA', 'แผนกทดสอบ N-A (มีผู้จัดการ)', 'ZN A'), ('ZNB', 'แผนกทดสอบ N-B (ไม่มีผู้จัดการ)', 'ZN B'), ('ZNM', 'แผนกทดสอบ N-M (ทีม IT)', 'ZN M');
insert into auth.users (id, email, raw_user_meta_data)
select ('3c400000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itan-u' || n || '@test.local', '{}'::jsonb from generate_series(1, 10) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itan.test', d.id, r.id, ('3c400000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'N-REQ', 'ZNA', 'staff'),
  (2, 'N-MGR', 'ZNA', 'department_manager'),
  (3, 'N-AMGR', 'ZNA', 'assistant_department_manager'),
  (4, 'N-ADM', 'ZNM', 'staff'),
  (5, 'N-ADM2', 'ZNM', 'staff'),
  (6, 'N-HEAD', 'ZNM', 'staff'),
  (7, 'N-REQB', 'ZNB', 'staff'),
  (8, 'N-REQ2', 'ZNA', 'staff'),
  (9, 'N-SBXADM', 'ZNM', 'admin'),
  (10, 'N-ADM3', 'ZNM', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- N-ADM = ผู้ดูแลงาน IT + ผู้อนุมัติขั้น IT + itas_admins · N-ADM2/N-ADM3 = ผู้ดูแลงาน IT · N-HEAD = หัวหน้า IT (ดูอย่างเดียว)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer)
select e.id, v.adm, v.appr, v.head
from (values ('N-ADM', true, true, false), ('N-ADM2', true, false, false), ('N-ADM3', true, false, false), ('N-HEAD', false, false, true)) v(no, adm, appr, head)
join public.employees e on e.employee_no = v.no;
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no = 'N-ADM';
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-ZN-STAFF', 'ทดสอบ', 'ผู้ยื่น ZNA', 'sbx-zn-staff@sandbox.local', (select id from public.departments where code = 'ZNA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-ZN-MGR', 'ทดสอบ', 'ผจก. ZNA', 'sbx-zn-mgr@sandbox.local', (select id from public.departments where code = 'ZNA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('t.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'N-%';
select count(set_config('t.dept_znb', (select id::text from public.departments where code = 'ZNB'), true));
select is((select count(*)::int from public.notifications where action_url like '/office/access/%'), 0, 'there is no access-request notification before the tests');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itua_save_folder('NF', 'โฟลเดอร์ทดสอบแจ้งเตือน', null, 10) $$, 'a folder to ask for');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "n.user", "name_th": "ผู้ใช้ทะเบียนทดสอบ", "department_code": "ZNA", "division": "office"}'::jsonb) $$, 'a register user that is not linked to anybody');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "n.user2", "name_th": "ผู้ใช้ทะเบียนทดสอบ 2", "department_code": "ZNA", "division": "office"}'::jsonb) $$, 'and a second one');
select set_config('t.u1', (select e ->> 'id' from jsonb_array_elements(public.app_itua_list_users('n.user') -> 'items') e where e ->> 'auth_id' = 'n.user'), true);
select set_config('t.u2', (select e ->> 'id' from jsonb_array_elements(public.app_itua_list_users('n.user2') -> 'items') e where e ->> 'auth_id' = 'n.user2'), true);

-- 3. ใบเดินครบทุกขั้น: ขั้นแผนก -> ขั้น IT -> อนุมัติครบ -> รับงาน -> บันทึกลงทะเบียน -> รับทราบ ---------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.o1', pg_temp.mk('change', 'ขอสิทธิ์ใช้โฟลเดอร์ทดสอบ', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o1'), '% รอคุณอนุมัติ'), 'N-AMGR,N-MGR', 'filing: both approvers of the department are told (the requester is not)');
select is(pg_temp.total(current_setting('t.o1')), 2, 'and nobody else');
select is((select n.title from public.notifications n join public.employees e on e.id = n.recipient_id where n.action_url = '/office/access/' || current_setting('t.o1') and e.employee_no = 'N-MGR'), 'ใบขอสิทธิ์ ' || pg_temp.dn(current_setting('t.o1')) || ' รอคุณอนุมัติ', 'the title names the request');
select is((select n.body from public.notifications n join public.employees e on e.id = n.recipient_id where n.action_url = '/office/access/' || current_setting('t.o1') and e.employee_no = 'N-MGR'), pg_temp.name('N-REQ') || ' · ผู้รับสิทธิ์ ' || pg_temp.name('N-REQ') || ' · แผนกทดสอบ N-A (มีผู้จัดการ) · เปลี่ยนแปลงสิทธิ์', 'the body names the requester, the subject, the department and the type');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
set local role authenticated;
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o1')), 'the department manager approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o1'), '% รอคุณอนุมัติ'), 'N-ADM,N-AMGR,N-MGR', 'after the department step the IT approver is told (the head of IT is not: this request does not involve the IT approver)');
select is(pg_temp.total(current_setting('t.o1')), 3, 'three notifications so far');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o1')), 'the IT approver approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o1'), '% อนุมัติครบแล้ว'), 'N-REQ', 'fully approved: the requester (also the subject, told once) hears it');
select is(pg_temp.who(current_setting('t.o1'), '% อนุมัติครบ พร้อมให้ IT รับงาน'), 'N-ADM2,N-ADM3', 'and the IT admins other than the one who approved');
select is(pg_temp.total(current_setting('t.o1')), 6, 'six notifications so far');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.o1')), 'IT takes the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.o1')), 6, 'starting the work tells nobody');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_apply('%s', pg_temp.items('%s'), '%s'::uuid, null, true) $$, current_setting('t.o1'), current_setting('t.o1'), current_setting('t.u1')), 'IT records the rights in the register (and links the employee)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o1'), '% IT ปรับสิทธิ์ให้แล้ว กรุณากดรับทราบ'), 'N-REQ', 'the subject is asked to acknowledge');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o1') and n.title like '% IT ปรับสิทธิ์ให้แล้ว%'), 'เปิดใบเพื่อตรวจสิทธิ์ของคุณและกดรับทราบ · เปลี่ยนแปลงสิทธิ์', 'with a body that tells what to do');
select is(pg_temp.total(current_setting('t.o1')), 7, 'the requester, who is also the subject, is told once');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.o1')), 'the subject acknowledges');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.o1')), 7, 'the person who acknowledged is not told about his own action');
select ok(not exists (select 1 from public.notifications n where n.action_url like '/office/access/%' and (n.title || ' ' || n.body) ~* '(password|รหัสผ่าน|secret)'), 'no notification text mentions a password or a secret');
select ok(not exists (select 1 from public.notifications n where n.action_url like '/office/access/%' and (n.title like '%ใบสั่งงาน%' or n.title like '%ใบแจ้งซ่อม%')), 'the titles say "ใบขอสิทธิ์", not another module name');
select ok(not exists (select 1 from public.notifications n where n.action_url like '/office/access/%' and n.action_url !~ '^/office/access/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'), 'every link is /office/access/<uuid>');

-- 4. ไม่อนุมัติ · ถาม-ตอบ · ยกเลิก ---------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.o2', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok(format($$ select public.app_itar_reject('%s', 'ไม่จำเป็นต้องใช้โฟลเดอร์นี้') $$, current_setting('t.o2')), 'the assistant manager rejects');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o2'), '% ไม่ได้รับอนุมัติ'), 'N-REQ2', 'rejected: the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o2') and n.title like '% ไม่ได้รับอนุมัติ'), 'เหตุผล: ไม่จำเป็นต้องใช้โฟลเดอร์นี้ · โดย ' || pg_temp.name('N-AMGR'), 'with the reason and who rejected');
-- ถาม-ตอบ (ผู้ยื่นแผนกไม่มีผู้จัดการ -> ขั้น IT)
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select set_config('t.o3', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o3'), '% รอคุณอนุมัติ'), 'N-ADM', 'a department without managers: straight to the IT approver (not the head of IT)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_request_info('%s', 'ใช้กับงานอะไร') $$, current_setting('t.o3')), 'the IT approver asks a question');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o3'), '% มีคำถามถึงคุณ'), 'N-REQB', 'question: the requester is told');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o3') and n.title like '% มีคำถามถึงคุณ'), pg_temp.name('N-ADM') || ': ใช้กับงานอะไร', 'with the text of the question');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok(format($$ select public.app_itar_provide_info('%s', 'ทำรายงานประจำเดือน') $$, current_setting('t.o3')), 'the requester answers');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o3'), '% ผู้ยื่นตอบคำถามแล้ว'), 'N-ADM', 'answer: only the person who asked is told');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o3') and n.title like '% ผู้ยื่นตอบคำถามแล้ว'), pg_temp.name('N-REQB') || ': ทำรายงานประจำเดือน', 'with the text of the answer');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok(format($$ select public.app_itar_cancel('%s', 'ไม่ต้องการแล้ว') $$, current_setting('t.o3')), 'the requester cancels while the IT step is pending');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o3'), '% ถูกยกเลิก'), 'N-ADM', 'cancelled in the IT step: the IT approver is told (nothing was started)');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o3') and n.title like '% ถูกยกเลิก'), 'ผู้ยื่นยกเลิก · ไม่ต้องการแล้ว · ' || pg_temp.name('N-REQB') || ' · ผู้รับสิทธิ์ ' || pg_temp.name('N-REQB') || ' · แผนกทดสอบ N-B (ไม่มีผู้จัดการ) · เปลี่ยนแปลงสิทธิ์', 'with the reason and the summary');
-- ยกเลิกหลังอนุมัติครบ: ผู้ดูแลงาน IT ทุกคนทราบ
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select set_config('t.o4', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o4')), 'the IT approver approves a request of a department without managers (one click)');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok(format($$ select public.app_itar_cancel('%s', 'เปลี่ยนใจ') $$, current_setting('t.o4')), 'the requester cancels after the full approval');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o4'), '% ถูกยกเลิก'), 'N-ADM,N-ADM2,N-ADM3', 'cancelled after full approval: every IT admin is told (the requester is the one who cancelled)');
-- IT ยกเลิกแทนผู้ยื่น
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.o5', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok(format($$ select public.app_itar_cancel('%s', 'ผู้ยื่นไม่อยู่') $$, current_setting('t.o5')), 'an IT admin cancels on behalf of the requester');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o5'), '% ถูกยกเลิก'), 'N-REQ2', 'the requester is told that IT cancelled it');
select ok((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o5') and n.title like '% ถูกยกเลิก') like '%IT ยกเลิกแทนผู้ยื่น: ผู้ยื่นไม่อยู่%', 'with the on-behalf reason');

-- 5. ยื่นแทน: ผู้ยื่นเป็นผู้อนุมัติขั้น IT -> หัวหน้า IT · ผู้รับสิทธิ์ได้รับแจ้งแยกจากผู้ยื่น ------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select set_config('t.o6', pg_temp.mk('change', 'ขอสิทธิ์แทนพนักงาน', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb, jsonb_build_object('employee_id', current_setting('t.e_n_req2'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o6'), '% รอคุณอนุมัติ'), 'N-AMGR,N-MGR', 'IT filing for an employee: the department managers of the subject are told');
select is(pg_temp.total(current_setting('t.o6')), 2, 'not the subject, not the requester');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o6')), 'the department manager approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o6'), '% รอคุณอนุมัติ'), 'N-AMGR,N-HEAD,N-MGR', 'the IT step of a request the IT approver filed goes to the head of IT, not to the IT approver');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o6')), 'the head of IT approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o6'), '% อนุมัติครบแล้ว'), 'N-ADM,N-REQ2', 'fully approved: the requester and the subject (two different people) are both told');
select is(pg_temp.who(current_setting('t.o6'), '% อนุมัติครบ พร้อมให้ IT รับงาน'), 'N-ADM2,N-ADM3', 'and the other IT admins (the requester was already told)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.o6')), 'IT takes the work');
select lives_ok(format($$ select public.app_itar_apply('%s', pg_temp.items('%s'), '%s'::uuid, null, true) $$, current_setting('t.o6'), current_setting('t.o6'), current_setting('t.u2')), 'IT records the rights');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o6'), '% IT ปรับสิทธิ์ให้แล้ว กรุณากดรับทราบ'), 'N-REQ2', 'the subject is asked to acknowledge');
select is(pg_temp.who(current_setting('t.o6'), '% IT บันทึกสิทธิ์ลงทะเบียนแล้ว รอผู้ใช้รับทราบ'), '', 'the requester (the one who pressed the button) is not told');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.o6')), 'the subject acknowledges');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o6'), '% ผู้ใช้รับทราบสิทธิ์แล้ว ใบจบงาน'), 'N-ADM', 'the requester is told that the request is finished');
select is((select n.body from public.notifications n where n.action_url = '/office/access/' || current_setting('t.o6') and n.title like '% ผู้ใช้รับทราบสิทธิ์แล้ว%'), 'โดย ' || pg_temp.name('N-REQ2') || ' · ' || pg_temp.name('N-REQ2'), 'with the name of the person who acknowledged');

-- 6. ยกเลิกสิทธิ์ทั้งหมด (ผู้จัดการยื่น) -> แจ้งผู้ยื่นตอนจบ -------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select set_config('t.o7', pg_temp.mk('revoke_all', 'พนักงานลาออก', '[]'::jsonb, jsonb_build_object('employee_id', current_setting('t.e_n_req'))), true);
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o7'), '% รอคุณอนุมัติ'), 'N-ADM', 'a revoke filed by the manager skips the department step: the IT approver is told');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o7')), 'the IT approver approves');
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.o7')), 'takes the work');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o7'), '% อนุมัติครบแล้ว'), 'N-MGR,N-REQ', 'fully approved: the manager who filed and the employee concerned are told');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.o7')), 'IT revokes everything (finished at once)');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o7'), '% ยกเลิกสิทธิ์ทั้งหมดเรียบร้อยแล้ว'), 'N-MGR', 'the manager who filed is told that it is done');
select is(pg_temp.total(current_setting('t.o7')), 6, 'six notifications on this request: IT approver, two on approval, two other IT admins, the manager at the end');

-- 7. คนไม่มีบัญชี: รอใบรับทราบกระดาษ -> แจ้งผู้ยื่น (ถ้าไม่ใช่คนกด) -------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select set_config('t.o8', pg_temp.mk('new', 'ผู้รับเหมาเข้าทำงาน', '[{"kind":"folder","target":"NF","to":"R"}]'::jsonb, jsonb_build_object('name_th', 'สมศักดิ์ ผู้รับเหมา', 'department_id', current_setting('t.dept_znb'), 'division', 'factory')), true);
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.o8')), 'the head of IT approves');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.o8')), 'another IT admin takes the work');
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_apply('%s', pg_temp.items('%s'), null, '{"auth_id": "n.contractor"}'::jsonb) $$, current_setting('t.o8'), current_setting('t.o8')), 'IT records the rights for a person without an account');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who(current_setting('t.o8'), '% IT บันทึกสิทธิ์ลงทะเบียนแล้ว รอใบรับทราบ (กระดาษ)'), '', 'the requester pressed the button himself: nobody is told');

-- 8. ใบทดสอบ (โหมดทดสอบ) ไม่ส่งแจ้งเตือน -----------------------------------------
select count(set_config('t.n1', (select count(*)::text from public.notifications where action_url like '/office/access/%'), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zn_staff')::uuid) $$, 'the admin enters the test mode as a requester persona');
select set_config('t.t1', pg_temp.mk('revoke_all', 'ทดสอบ'), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_zn_mgr')::uuid) $$, 'switching to the manager persona');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.t1')), 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT persona');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.t1')), 'the IT approver persona approves');
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.t1')), 'and takes the work');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.notifications where action_url like '/office/access/%'), current_setting('t.n1')::int, 'a whole test-mode flow wrote no notification');
select is((select count(*)::int from public.notifications where action_url = '/office/access/' || current_setting('t.t1')), 0, 'in particular none for the test request');
select ok((select count(*)::int from public.itar_events where is_test and request_id = current_setting('t.t1')::uuid) >= 4, 'while its history was recorded as usual');

-- 9. แจ้งเตือนล้มเหลวแล้วการกระทำไม่ล้มตาม (ทำท้ายสุด: แทนที่ฟังก์ชันส่งด้วยตัวที่ error) ----
create or replace function private.itar_notify_each(p_recipients uuid[], p_already uuid[], p_actor_id uuid, p_title text, p_body text, p_action_url text)
returns uuid[] language plpgsql security definer set search_path = '' as $$
begin raise exception 'จำลองแจ้งเตือนล้มเหลว'; end $$;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select lives_ok($$ select pg_temp.mk('revoke_all', 'แจ้งเตือนล้ม') $$, 'filing still works when the notification code fails');
select set_config('t.ov', pg_temp.mk('revoke_all', 'แจ้งเตือนล้มอีกใบ'), true);
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.ov')), 'approving still works when the notification code fails');
select is(public.app_itar_get_detail(current_setting('t.ov')::uuid) ->> 'status', 'pending_it_mgr', 'and the new status is saved');
select is((select string_agg(e ->> 'action', ',' order by (e ->> 'id')::bigint) from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.ov')::uuid) -> 'events') e), 'created,dept_approved', 'and the history (the ISO signature) is saved too');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.total(current_setting('t.ov')), 0, 'no notification row exists for it');

select * from finish();
rollback;
