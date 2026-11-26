-- ทดสอบ 20261230010000_office_it_approver_worktime.sql (เจ้าของสั่ง 26/11/2026)
--   A) ผู้อนุมัติขั้น IT = ผู้ที่มีธง is_it_approver · หัวหน้า IT (is_it_viewer) ดูอย่างเดียว
--      - หัวหน้า IT เห็นทุกใบแต่ทำงานฝั่ง IT ไม่ได้ (เริ่ม/ส่งงาน/ถาม/ตั้งค่า) และไม่ได้รับแจ้งเตือนใบทั่วไป
--      - ใบที่ผู้อนุมัติขั้น IT แจ้งเอง ไม่ผ่านอัตโนมัติ รอหัวหน้า IT (แผนก IT/ไม่มีผจก. กดครั้งเดียวนับสองขั้น)
--      - หัวหน้า IT อนุมัติใบคนอื่นไม่ได้ · ผู้อนุมัติอนุมัติใบตัวเอง/ใบของผู้อนุมัติด้วยกันไม่ได้ · แจ้งเตือนไปถูกคน
--      - app_itwo_set_staff เรียก 3 พารามิเตอร์แบบเดิมได้ (ธงหัวหน้า IT คงเดิม) · list_staff/my_role มี is_it_viewer
--      - itrp: เหมือนกัน + หัวหน้า IT อ่านประวัติการซ่อมได้แต่เขียนไม่ได้
--   B) สรุปเวลาทำงาน: office_working_minutes (พักเที่ยง, อาทิตย์, วันหยุด, นอกเวลา, ข้ามคืน, เขตเวลาไทย, ค่าตั้งค่า)
--      office_work_minutes_from_events (ถาม-ตอบ, ขอแก้ไขหลายรอบ, ยังไม่ส่งงาน = null) และคีย์ work_minutes ใน get_detail ของ itwo/itrp
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (W-*) ในแผนกทดสอบ ZWA/ZWB ที่สร้างในไฟล์นี้ · วันที่ที่ใช้คำนวณเวลาเป็นวันในอดีตคงที่ (มี.ค. 2026)
--   2026-03-02 = วันจันทร์ · 03 อังคาร · 04 พุธ · 07 เสาร์ · 08 อาทิตย์ · 09 จันทร์
begin;

create extension if not exists pgtap with schema extensions;
select plan(179);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"5a700000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.new_wo(p_urgent boolean default false) returns text language sql as $$
  select (select id::text from public.app_itwo_create('design', null, 'no', null, 'ทดสอบ 26/11', ((now() at time zone 'Asia/Bangkok')::date + 3), p_urgent)) $$;
create function pg_temp.new_rq(p_urgent boolean default false) returns text language sql as $$
  select (select id::text from public.app_itrp_create(null, 'PC-01', 'repair', null, 'computer', null, 'เปิดเครื่องไม่ติด', p_urgent)) $$;
create function pg_temp.wo_acts(p_id uuid) returns text language sql as $$
  select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itwo_get_detail(p_id)->'events') e $$;
create function pg_temp.rq_acts(p_id uuid) returns text language sql as $$
  select string_agg(e->>'action', ',' order by (e->>'id')::bigint) from jsonb_array_elements(public.app_itrp_get_detail(p_id)->'events') e $$;
create function pg_temp.wo_st(p_id uuid) returns text language sql as $$ select public.app_itwo_get_detail(p_id)->>'status' $$;
create function pg_temp.rq_st(p_id uuid) returns text language sql as $$ select public.app_itrp_get_detail(p_id)->>'status' $$;
-- ใครได้แจ้งเตือน (title ตรงกับรูปแบบ) ของใบ · ใช้ได้ตอนเป็น postgres เท่านั้น
create function pg_temp.who(p_url text, p_title_like text default '%') returns text language sql as $$
  select coalesce(string_agg(e.employee_no, ',' order by e.employee_no), '')
  from public.notifications n join public.employees e on e.id = n.recipient_id
  where n.action_url = p_url and n.title like p_title_like $$;
-- ธงสิทธิ์ทีม IT ของรหัสพนักงาน (admin/approver/viewer เป็น true/false) หรือ 'none' ถ้าไม่มีแถว · อ่านตารางตรงได้เพราะเป็น definer (ใช้ตอนเป็น authenticated)
create function pg_temp.flags(p_no text) returns text language sql security definer as $$
  select coalesce((select s.is_it_admin::text || ',' || s.is_it_approver::text || ',' || s.is_it_viewer::text from public.itwo_staff s join public.employees e on e.id = s.employee_id where e.employee_no = p_no), 'none') $$;
-- นาทีทำงานระหว่างสองเวลา (เขียนเป็นข้อความ เวลาไทย)
create function pg_temp.wm(p_from text, p_to text) returns integer language sql as $$
  select private.office_working_minutes(p_from::timestamptz, p_to::timestamptz) $$;
create function pg_temp.ev(p_actions text[], p_times text[]) returns integer language sql as $$
  select private.office_work_minutes_from_events(p_actions, (select array_agg(t::timestamptz order by o) from unnest(p_times) with ordinality as x(t, o))) $$;

-- 1. โครงสร้าง ------------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'itwo_staff' and column_name = 'is_it_viewer' and is_nullable = 'NO' and column_default = 'false'), 'itwo_staff has the is_it_viewer flag (not null, default false)');
select is((select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid = 'public.itwo_staff'::regclass and c.conname = 'itwo_staff_has_a_role'), 'CHECK ((is_it_admin OR is_it_approver OR is_it_viewer))', 'the check counts the new flag: every row needs at least one right');
select is((select count(*)::int from public.office_work_hours), 1, 'office_work_hours holds exactly one row');
select is((select work_start::text || '-' || work_end::text || ' break ' || break_start::text || '-' || break_end::text || ' days ' || working_isodow::text from public.office_work_hours), '08:00:00-17:00:00 break 12:00:00-13:00:00 days {1,2,3,4,5,6}', 'the default hours are 08:00-17:00 with a 12:00-13:00 break, Monday to Saturday');
select throws_ok($$ insert into public.office_work_hours (id) values (false) $$, '23514', null, 'the settings table cannot hold a second row (id is always true)');
select throws_ok($$ update public.office_work_hours set work_start = '12:30' $$, '23514', null, 'the working hours must keep start < break start <= break end < end');
select throws_ok($$ update public.office_work_hours set working_isodow = '{0,1}' $$, '23514', null, 'working days must be 1-7');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'office_work_hours' and g.grantee in ('anon', 'authenticated', 'PUBLIC', 'service_role')), 'no role has a direct grant on office_work_hours');
select ok((select c.relrowsecurity from pg_class c where c.oid = 'public.office_work_hours'::regclass) and exists (select 1 from pg_policy p where p.polrelid = 'public.office_work_hours'::regclass and p.polname = 'office_work_hours_no_direct_access'), 'RLS is on with a deny-all policy');
select ok(exists (select 1 from pg_trigger t where t.tgrelid = 'public.office_work_hours'::regclass and t.tgname = 'sandbox_guard' and not t.tgisinternal), 'the settings table is blocked while an admin is in test mode (sandbox_guard)');
select ok(exists (select 1 from pg_policy p where p.polrelid = 'public.office_work_hours'::regclass and p.polname = 'lab_only_no_access' and not p.polpermissive), 'the lab-only accounts cannot see it (restrictive policy)');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itwo%' or f like '%itrp%'), 'every itwo/itrp RPC (including the recreated list_staff / set_staff) still has the lab-only guard');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('office_working_seconds', 'office_working_minutes', 'office_work_minutes_from_events', 'itwo_work_minutes', 'itrp_work_minutes', 'itwo_is_it_viewer', 'itrp_is_it_viewer', 'itwo_is_it_stage_approver', 'itrp_is_it_stage_approver', 'itwo_notify_it_stage_ids', 'itrp_notify_it_stage_ids')), 'the new private functions are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('office_working_seconds', 'office_working_minutes', 'office_work_minutes_from_events', 'itwo_work_minutes', 'itrp_work_minutes', 'itwo_is_it_viewer', 'itrp_is_it_viewer', 'itwo_is_it_stage_approver', 'itrp_is_it_stage_approver', 'itwo_notify_it_stage_ids', 'itrp_notify_it_stage_ids') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'and no browser role can call them');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itwo_set_staff', 'app_itwo_list_staff', 'app_itrp_list_staff') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'the recreated RPCs keep the old grants (authenticated only, no anon)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itwo_set_staff'), 1, 'only one app_itwo_set_staff exists (the 3-argument version was replaced, so a 3-argument call is not ambiguous)');
select is((select pronargs::int || '/' || pronargdefaults::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itwo_set_staff'), '4/1', 'the new viewer argument has a default');
select is((select count(*)::int from public.itwo_admin_log l join public.employees t on t.id = l.target_employee_id where l.is_test and l.action = 'staff_changed' and l.detail->'new' ? 'is_it_viewer' and t.employee_no in ('SBX-IT-ADMIN', 'SBX-IT-APPROVER')), 2, 'the migration logged the two persona changes as test rows');
select ok(not exists (select 1 from public.itwo_admin_log l where not l.is_test and l.detail->'new' ? 'is_it_viewer' and l.detail->>'employee_no' like 'SBX-%'), 'and wrote no real (ISO) log row for the personas');

-- 2. ข้อมูลทดสอบ -------------------------------------------------------------
insert into public.departments (code, name_th, name_en) values
  ('ZWA', 'แผนกทดสอบ W-A (มีผู้จัดการ)', 'ZW A'), ('ZWB', 'แผนกทดสอบ W-B (ไม่มีผู้จัดการ)', 'ZW B');
insert into auth.users (id, email, raw_user_meta_data)
select ('5a700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'w-u' || n || '@test.local', '{}'::jsonb from generate_series(1, 13) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@w.test', d.id, r.id, ('5a700000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'W-REQ', 'ZWA', 'staff'),
  (2, 'W-MGR', 'ZWA', 'department_manager'),
  (3, 'W-REQ2', 'ZWB', 'staff'),
  (4, 'W-ADM', 'MGT', 'staff'),
  (5, 'W-APPR', 'MGT', 'general_manager'),
  (6, 'W-APPR2', 'MGT', 'general_manager'),
  (7, 'W-HEAD', 'MGT', 'staff'),
  (8, 'W-ITAPPR', 'IT', 'staff'),
  (9, 'W-APPRM', 'ZWA', 'staff'),
  (10, 'W-NONE', 'MGT', 'staff'),
  (11, 'W-TARGET', 'ZWB', 'staff'),
  (12, 'W-VIEW2', 'ZWB', 'staff'),
  (13, 'W-HEAD2', 'MGT', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- W-ADM = ผู้ดูแลงาน IT อย่างเดียว · W-APPR/W-APPR2/W-ITAPPR/W-APPRM = ผู้อนุมัติขั้น IT · W-HEAD/W-HEAD2 = หัวหน้า IT (ดูอย่างเดียว)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer)
select e.id, v.adm, v.appr, v.head from (values
  ('W-ADM', true, false, false), ('W-APPR', false, true, false), ('W-APPR2', false, true, false), ('W-ITAPPR', false, true, false),
  ('W-APPRM', false, true, false), ('W-HEAD', false, false, true), ('W-HEAD2', false, false, true)) v(no, adm, appr, head)
join public.employees e on e.employee_no = v.no;
select throws_ok($$ insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer) select id, false, false, false from public.employees where employee_no = 'W-NONE' $$, '23514', null, 'a staff row with no right at all is refused');

-- 3. หัวหน้า IT (W-HEAD): เห็นทุกใบ ทำงานฝั่ง IT ไม่ได้ -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.o1', pg_temp.new_wo(), true);
select set_config('t.o2', pg_temp.new_wo(true), true);
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itwo_my_role()->>'is_it_viewer', 'true', 'itwo my_role: the IT head has is_it_viewer');
select is((public.app_itwo_my_role()->>'is_it_admin') || (public.app_itwo_my_role()->>'is_it_approver'), 'falsefalse', 'and is neither an IT admin nor an IT approver');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->>'status', 'pending_dept', 'the IT head can read any order');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'allowed_actions', '[]'::jsonb, 'and has no action on an ordinary order');
select is((select count(*)::int from public.app_itwo_list_it() where id in (current_setting('t.o1')::uuid, current_setting('t.o2')::uuid)), 2, 'the IT head sees the whole IT list');
select is(public.app_itwo_get_detail(current_setting('t.o2')::uuid)->'allowed_actions', '[]'::jsonb, 'even the urgent order offers the IT head no start button');
select throws_ok($$ select public.app_itwo_start(current_setting('t.o2')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'the IT head cannot start work');
select throws_ok($$ select public.app_itwo_request_info(current_setting('t.o1')::uuid, 'ถาม') $$, '42501', 'คุณไม่มีสิทธิ์ถามผู้แจ้งในใบสั่งงานนี้ในขั้นตอนนี้', 'cannot ask the requester');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.o1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'cannot approve an ordinary order');
select throws_ok($$ select public.app_itwo_reject(current_setting('t.o1')::uuid, 'x') $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'cannot reject an ordinary order');
select throws_ok($$ select * from public.app_itwo_list_staff() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'cannot open the team settings');
select throws_ok($$ select public.app_itwo_set_staff('W-NONE', true, false) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งสิทธิ์ทีม IT ได้', 'cannot edit the team rights');
select throws_ok($$ select public.app_itwo_set_next_doc_seq(900) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'cannot set the document number');
select is(public.app_itwo_pending_count(), 0, 'nothing waits for the IT head among ordinary orders');
select is((select count(*)::int from public.app_itwo_list_pending_approvals()), 0, 'and the approvals list is empty');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who('/office/work-order/' || current_setting('t.o1')), 'W-MGR', 'only the department manager is told about an ordinary order (the IT head gets nothing)');
select is(pg_temp.who('/office/work-order/' || current_setting('t.o2')), 'W-ADM,W-MGR', 'the urgent order tells the manager and the IT admin only (not the IT head, not the approvers who cannot act yet)');

-- 4. ใบของผู้อนุมัติขั้น IT: รอหัวหน้า IT (แผนกไม่มีผู้จัดการ → กดครั้งเดียวนับสองขั้น) -----------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.a1', pg_temp.new_wo(), true);
select is(pg_temp.wo_st(current_setting('t.a1')::uuid), 'pending_it_mgr', 'an IT approver filing is not approved in his own name: it waits for the IT step');
select is(pg_temp.wo_acts(current_setting('t.a1')::uuid), 'created', 'nothing is signed at filing');
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'allowed_actions', '["cancel"]'::jsonb, 'the requester can only cancel (never approve his own order)');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.a1')::uuid) $$, '42501', 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบสั่งงานที่ตัวเองเป็นผู้แจ้งได้', 'he cannot approve his own order');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'allowed_actions', '[]'::jsonb, 'another IT approver has no action on it either');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.a1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'another IT approver cannot approve it');
select is(public.app_itwo_pending_count(), 0, 'it is not in the other approver pending count');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the IT head can approve, reject or ask');
select is(public.app_itwo_pending_count(), 1, 'it is in the IT head pending count');
select is((select pending_step from public.app_itwo_list_pending_approvals() where id = current_setting('t.a1')::uuid), 'it_mgr', 'listed as the IT step');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who('/office/work-order/' || current_setting('t.a1'), '% รอคุณอนุมัติ'), 'W-HEAD,W-HEAD2', 'only the IT heads are asked to approve it (not the requester, not the other approvers)');
select is(pg_temp.who('/office/work-order/' || current_setting('t.a1')), 'W-HEAD,W-HEAD2', 'and nobody else is told anything');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.a1')::uuid) $$, 'the IT head approves');
select is(pg_temp.wo_st(current_setting('t.a1')::uuid), 'approved', 'the order is approved');
select is(pg_temp.wo_acts(current_setting('t.a1')::uuid), 'created,dept_approved,it_mgr_approved', 'one click recorded both steps (the department has no manager)');
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'events'->2->>'actor_employee_no', 'W-HEAD', 'both signatures are the IT head');
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'approvals'->'it_mgr'->>'by', 'ทดสอบ W-HEAD', 'the print shows the IT head as the IT approver');
select is(public.app_itwo_get_detail(current_setting('t.a1')::uuid)->'allowed_actions', '[]'::jsonb, 'afterwards the IT head still has no action (no start)');
select throws_ok($$ select public.app_itwo_start(current_setting('t.a1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เริ่มดำเนินการใบสั่งงานได้', 'and cannot start the approved order');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who('/office/work-order/' || current_setting('t.a1'), '% อนุมัติครบแล้ว'), 'W-APPR', 'full approval tells the requester');
select is(pg_temp.who('/office/work-order/' || current_setting('t.a1'), '% อนุมัติครบ พร้อมให้ IT รับงาน'), 'W-ADM', 'and the IT admin (not the IT head)');

-- 4b. ผู้อนุมัติขั้น IT อยู่แผนก IT: หัวหน้า IT กดครั้งเดียว ------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.a2', pg_temp.new_wo(), true);
select is(pg_temp.wo_st(current_setting('t.a2')::uuid), 'pending_it_mgr', 'an IT-department approver filing waits for the IT head');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.a2')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'an IT approver cannot approve an order of another IT approver');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.a2')::uuid) $$, 'any active IT head can approve it');
select is(pg_temp.wo_acts(current_setting('t.a2')::uuid), 'created,dept_approved,it_mgr_approved', 'one click counts both steps');
select ok((public.app_itwo_get_detail(current_setting('t.a2')::uuid)->'approvals'->'dept'->>'reason') like '%แผนก IT%', 'the department signature says why one click was enough');

-- 4c. ผู้อนุมัติขั้น IT อยู่แผนกที่มีผู้จัดการ: ผจก.แผนกก่อน แล้วหัวหน้า IT ----------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select set_config('t.a3', pg_temp.new_wo(), true);
select is(pg_temp.wo_st(current_setting('t.a3')::uuid), 'pending_dept', 'an IT approver of a department with a manager waits for the department first');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itwo_get_detail(current_setting('t.a3')::uuid)->'allowed_actions', '[]'::jsonb, 'the IT head has no action yet');
select throws_ok($$ select public.app_itwo_approve(current_setting('t.a3')::uuid) $$, '23514', 'ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'and is told to wait for the department manager');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.a3')::uuid) $$, 'the department manager approves');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who('/office/work-order/' || current_setting('t.a3'), '% รอคุณอนุมัติ'), 'W-HEAD,W-HEAD2,W-MGR', 'the manager was asked first, then the IT heads once the department had approved');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_itwo_approve(current_setting('t.a3')::uuid) $$, 'then the IT head approves the IT step');
select is(pg_temp.wo_acts(current_setting('t.a3')::uuid), 'created,dept_approved,it_mgr_approved', 'two signatures: the manager and the IT head');
select is(public.app_itwo_get_detail(current_setting('t.a3')::uuid)->'events'->1->>'actor_employee_no', 'W-MGR', 'the department step is the manager');
select is(public.app_itwo_get_detail(current_setting('t.a3')::uuid)->'events'->2->>'actor_employee_no', 'W-HEAD', 'the IT step is the IT head');

-- 4d. หัวหน้า IT อนุมัติใบทั่วไปไม่ได้ / ผู้อนุมัติอนุมัติใบทั่วไปได้ -----------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.b1', pg_temp.new_wo(), true);
select is(pg_temp.wo_st(current_setting('t.b1')::uuid), 'pending_it_mgr', 'an ordinary order of a department without manager waits at the IT step');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select throws_ok($$ select public.app_itwo_approve(current_setting('t.b1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบสั่งงานนี้', 'the IT head cannot approve an ordinary order');
select is(public.app_itwo_pending_count(), 0, 'it is not in his pending count');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(public.app_itwo_get_detail(current_setting('t.b1')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the IT approver can approve it');
select lives_ok($$ select public.app_itwo_approve(current_setting('t.b1')::uuid) $$, 'the IT approver approves (both steps)');
select is(pg_temp.wo_acts(current_setting('t.b1')::uuid), 'created,dept_approved,it_mgr_approved', 'as before the change');

-- 4e. ไม่มีหัวหน้า IT ที่ใช้งานอยู่: ใบรอไว้ ไม่ผ่านอัตโนมัติ และการแจ้งไม่ถูกปฏิเสธ ------------------
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = false where employee_no in ('W-HEAD', 'W-HEAD2');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select set_config('t.a4', pg_temp.new_wo(), true) $$, 'an IT approver can still file when no IT head is active');
select is(pg_temp.wo_st(current_setting('t.a4')::uuid), 'pending_it_mgr', 'the order waits (it is not approved automatically)');
select is(pg_temp.wo_acts(current_setting('t.a4')::uuid), 'created', 'and nothing is signed');
reset role;
select set_config('request.jwt.claims', '', true);
update public.employees set is_active = true where employee_no in ('W-HEAD', 'W-HEAD2');

-- 5. รายชื่อทีม IT และตั้งสิทธิ์ (ผู้ดูแลงาน W-ADM) -------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(public.app_itwo_my_role()->>'is_it_viewer', 'false', 'my_role of an IT admin: not a viewer');
select ok((select bool_and(r.is_it_viewer is not null) and bool_or(r.employee_no = 'W-HEAD' and r.is_it_viewer and not r.is_it_admin and not r.is_it_approver) from public.app_itwo_list_staff() r), 'list_staff shows the viewer column');
select lives_ok($$ select public.app_itwo_set_staff('W-NONE', true, false) $$, 'the old 3-argument call still works');
select is(pg_temp.flags('W-NONE'), 'true,false,false', 'and creates a row without the viewer right');
select lives_ok($$ select public.app_itwo_set_staff('W-NONE', false, false) $$, 'removing with the old call deletes a row that has no viewer right');
select is(pg_temp.flags('W-NONE'), 'none', 'the row is gone');
select lives_ok($$ select public.app_itwo_set_staff('W-VIEW2', false, false, true) $$, 'W-VIEW2 is made an IT head');
select lives_ok($$ select public.app_itwo_set_staff('W-VIEW2', false, false) $$, 'an old-style call on an IT head (false, false) ...');
select is(pg_temp.flags('W-VIEW2'), 'false,false,true', '... keeps the IT head right (the viewer flag is kept when the 4th argument is omitted)');
select lives_ok($$ select public.app_itwo_set_staff('W-VIEW2', false, false, false) $$, 'an explicit viewer = false removes the last right');
select is(pg_temp.flags('W-VIEW2'), 'none', 'and the row is deleted');
select lives_ok($$ select public.app_itwo_set_staff('W-TARGET', false, false, true) $$, 'an IT head can be added with the 4th argument');
select is(pg_temp.flags('W-TARGET'), 'false,false,true', 'with only the viewer flag');
select public.app_itwo_set_staff('W-TARGET', false, false, false);
select throws_ok($$ select public.app_itwo_set_staff('W-ADM', true, true, true) $$, '42501', 'ไม่สามารถแก้สิทธิ์ทีม IT ของตัวเองได้ กรุณาให้ผู้ดูแลงาน IT คนอื่นเป็นผู้ตั้งให้', 'nobody edits his own rights (also with the viewer argument)');


-- 6. ใบแจ้งซ่อม (itrp): กติกาเดียวกัน ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r1', pg_temp.new_rq(), true);
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itrp_my_role()->>'is_it_viewer', 'true', 'itrp my_role: the IT head has is_it_viewer');
select is(public.app_itrp_get_detail(current_setting('t.r1')::uuid)->>'status', 'pending_dept', 'the IT head reads any repair request');
select is(public.app_itrp_get_detail(current_setting('t.r1')::uuid)->'allowed_actions', '[]'::jsonb, 'and has no action on an ordinary one');
select is((select count(*)::int from public.app_itrp_list_it() where id = current_setting('t.r1')::uuid), 1, 'the IT list shows it');
select throws_ok($$ select public.app_itrp_approve(current_setting('t.r1')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'the IT head cannot approve an ordinary request');
select throws_ok($$ select public.app_itrp_start(current_setting('t.r1')::uuid) $$, '42501', null, 'cannot start');
select throws_ok($$ select * from public.app_itrp_list_staff() $$, '42501', null, 'cannot list the team');
select lives_ok($$ select * from public.app_itrp_list_devices() $$, 'the IT head can read the device registry (it could as an approver)');
select lives_ok($$ select public.app_itrp_device_history('WH-X1') $$, 'and the repair history of a machine');
select throws_ok($$ select public.app_itrp_save_device('WH-X1', 'computer', 'ทดสอบ') $$, '42501', null, 'but cannot write the registry');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.r2', pg_temp.new_rq(), true);
select is(pg_temp.rq_st(current_setting('t.r2')::uuid), 'pending_it_mgr', 'an IT approver repair request is not approved in his own name');
select is(pg_temp.rq_acts(current_setting('t.r2')::uuid), 'created', 'nothing is signed at filing');
select throws_ok($$ select public.app_itrp_approve(current_setting('t.r2')::uuid) $$, '42501', 'ไม่สามารถอนุมัติหรือไม่อนุมัติใบแจ้งซ่อมที่ตัวเองเป็นผู้แจ้งได้', 'he cannot approve his own request');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.r2')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'another IT approver cannot approve it');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itrp_get_detail(current_setting('t.r2')::uuid)->'allowed_actions', '["approve", "reject", "request_info"]'::jsonb, 'the IT head can approve, reject or ask');
select is(public.app_itrp_pending_count(), 1, 'it is in the IT head pending count');
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.who('/office/repair/' || current_setting('t.r2')), 'W-HEAD,W-HEAD2', 'only the IT heads are asked');
select is(pg_temp.who('/office/repair/' || current_setting('t.r1')), 'W-MGR', 'an ordinary request asks the department manager only');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.r2')::uuid) $$, 'the IT head approves');
select is(pg_temp.rq_acts(current_setting('t.r2')::uuid), 'created,dept_approved,it_mgr_approved', 'one click counts both steps (no department manager)');
select is(public.app_itrp_get_detail(current_setting('t.r2')::uuid)->'events'->2->>'actor_employee_no', 'W-HEAD', 'signed by the IT head');
select throws_ok($$ select public.app_itrp_start(current_setting('t.r2')::uuid) $$, '42501', null, 'the IT head still cannot start the approved request');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.r3', pg_temp.new_rq(), true);
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select throws_ok($$ select public.app_itrp_approve(current_setting('t.r3')::uuid) $$, '42501', 'คุณไม่มีสิทธิ์พิจารณาใบแจ้งซ่อมนี้', 'the IT head cannot approve an ordinary request at the IT step either');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select ok((select bool_and(r.is_it_viewer is not null) and bool_or(r.employee_no = 'W-HEAD' and r.is_it_viewer) from public.app_itrp_list_staff() r), 'itrp list_staff shows the viewer column');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.r4', pg_temp.new_rq(), true);
select is(pg_temp.rq_st(current_setting('t.r4')::uuid), 'pending_it_mgr', 'an IT department approver repair request waits for the IT head');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select lives_ok($$ select public.app_itrp_approve(current_setting('t.r4')::uuid) $$, 'any IT head approves it');
select is(pg_temp.rq_acts(current_setting('t.r4')::uuid), 'created,dept_approved,it_mgr_approved', 'both steps are signed');

-- 7. สรุปเวลาทำงาน: office_working_minutes -----------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is(pg_temp.wm('2026-03-02 09:00+07', '2026-03-02 11:30+07'), 150, 'a morning stretch counts as it is');
select is(pg_temp.wm('2026-03-02 11:00+07', '2026-03-02 14:00+07'), 120, 'the lunch hour is not counted (60 before + 60 after)');
select is(pg_temp.wm('2026-03-02 12:10+07', '2026-03-02 12:50+07'), 0, 'a stretch inside the lunch break is 0');
select is(pg_temp.wm('2026-03-02 08:00+07', '2026-03-02 17:00+07'), 480, 'a full day is 8 working hours');
select is(pg_temp.wm('2026-03-02 06:00+07', '2026-03-02 07:59+07'), 0, 'before opening is 0');
select is(pg_temp.wm('2026-03-02 17:00+07', '2026-03-02 23:00+07'), 0, 'after closing is 0');
select is(pg_temp.wm('2026-03-02 16:00+07', '2026-03-03 09:00+07'), 120, 'overnight: the last hour of Monday and the first hour of Tuesday');
select is(pg_temp.wm('2026-03-08 10:00+07', '2026-03-08 15:00+07'), 0, 'Sunday is not counted');
select is(pg_temp.wm('2026-03-07 16:00+07', '2026-03-09 09:00+07'), 120, 'across the weekend: Saturday 16-17 + Monday 8-9, Sunday skipped');
select is(pg_temp.wm('2026-03-07 08:00+07', '2026-03-07 12:00+07'), 240, 'Saturday is a working day');
select is(pg_temp.wm('2026-03-02 08:00+07', '2026-03-09 08:00+07'), 2880, 'a whole week is Monday to Saturday x 8 hours');
select is(pg_temp.wm('2026-03-02 16:00+07', '2026-03-04 09:00+07'), 600, 'without a holiday Tuesday is a full working day (60 + 480 + 60)');
insert into public.company_holidays (holiday_date, name_th) values ('2026-03-03', 'วันหยุดทดสอบ');
select is(pg_temp.wm('2026-03-02 16:00+07', '2026-03-04 09:00+07'), 120, 'a company holiday is skipped (60 + 0 + 60)');
select is(pg_temp.wm('2026-03-03 08:00+07', '2026-03-03 17:00+07'), 0, 'and counts 0 inside the holiday itself');
select is(pg_temp.wm('2026-03-02 09:00+07', '2026-03-02 09:00+07'), 0, 'an empty stretch is 0');
select is(pg_temp.wm('2026-03-02 11:00+07', '2026-03-02 09:00+07'), 0, 'a reversed stretch is 0');
select is(private.office_working_minutes(null, '2026-03-02 09:00+07'::timestamptz), 0, 'a missing time gives 0');
select is(pg_temp.wm('2026-03-02 02:00:00+00', '2026-03-02 04:30:00+00'), 150, 'times in UTC are read in Bangkok time (09:00-11:30)');
select is(pg_temp.wm('2026-03-02 23:30+07', '2026-03-03 00:30+07'), 0, 'across midnight outside working hours is 0');
select is(pg_temp.wm('2026-03-02 09:00:00+07', '2026-03-02 09:00:59+07'), 0, 'less than a whole minute is 0');
select is(private.office_working_seconds('2026-03-02 09:00:30+07', '2026-03-02 09:02:30+07'), 120::numeric, 'office_working_seconds keeps the seconds');
select is(pg_temp.wm('2026-03-02 09:00:30+07', '2026-03-02 09:02:30+07'), 2, 'and the minutes are the whole minutes');
-- ค่าตั้งค่า
update public.office_work_hours set working_isodow = '{1,2,3,4,5}';
select is(pg_temp.wm('2026-03-07 08:00+07', '2026-03-07 12:00+07'), 0, 'config: with Saturday removed from the working days it counts 0');
update public.office_work_hours set working_isodow = '{1,2,3,4,5,6}', work_start = '09:00';
select is(pg_temp.wm('2026-03-02 08:00+07', '2026-03-02 10:00+07'), 60, 'config: a later opening time (09:00) is honoured');
update public.office_work_hours set work_start = '08:00', break_start = '11:00';
select is(pg_temp.wm('2026-03-02 10:00+07', '2026-03-02 14:00+07'), 120, 'config: a break of 11:00-13:00 is honoured (10-11 + 13-14)');
update public.office_work_hours set break_start = '12:00';
select is(pg_temp.wm('2026-03-02 08:00+07', '2026-03-02 17:00+07'), 480, 'config restored');
delete from public.office_work_hours;
select is(pg_temp.wm('2026-03-02 11:00+07', '2026-03-02 14:00+07'), 120, 'with no settings row the built-in defaults apply');
insert into public.office_work_hours (id) values (true);

-- 8. สรุปเวลาทำงาน: รวมจากประวัติ --------------------------------------------------------------
select is(private.office_work_minutes_from_events('{}'::text[], '{}'::timestamptz[]), null, 'no events gives null');
select is(pg_temp.ev(array['started'], array['2026-03-02 09:00+07']), null, 'started but never delivered gives null');
select is(pg_temp.ev(array['started', 'info_requested'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07']), null, 'started, asked, never delivered still gives null');
select is(pg_temp.ev(array['completed'], array['2026-03-02 10:00+07']), null, 'a delivery with no start gives null');
select is(pg_temp.ev(array['started', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 11:00+07']), 120, 'start to delivery');
select is(pg_temp.ev(array['started', 'info_requested', 'info_provided', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07', '2026-03-02 13:00+07', '2026-03-02 15:00+07']), 180, 'waiting for the requester is not counted (09-10 and 13-15)');
select is(pg_temp.ev(array['info_requested', 'info_provided', 'started', 'completed'], array['2026-03-02 08:00+07', '2026-03-02 08:30+07', '2026-03-02 09:00+07', '2026-03-02 10:00+07']), 60, 'a question before the start (a manager asking before approval) has no effect');
select is(pg_temp.ev(array['started', 'completed', 'rework_requested', 'completed', 'rework_requested', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07', '2026-03-05 09:00+07', '2026-03-05 10:30+07', '2026-03-06 13:00+07', '2026-03-06 14:00+07']), 210, 'two rework rounds are all added up (60 + 90 + 60)');
select is(pg_temp.ev(array['started', 'completed', 'rework_requested'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07', '2026-03-05 09:00+07']), 60, 'a rework that is still open is not counted yet');
select is(pg_temp.ev(array['started', 'completed', 'rework_requested', 'info_requested', 'info_provided', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07', '2026-03-05 09:00+07', '2026-03-05 09:30+07', '2026-03-05 14:00+07', '2026-03-05 15:00+07']), 150, 'a question inside a rework round is also deducted (60 + 30 + 60)');
select is(pg_temp.ev(array['created', 'dept_approved', 'it_mgr_approved', 'started', 'received', 'completed'], array['2026-03-02 07:00+07', '2026-03-02 07:10+07', '2026-03-02 07:20+07', '2026-03-02 09:00+07', '2026-03-02 09:30+07', '2026-03-02 10:00+07']), 60, 'other actions are ignored');
select is(pg_temp.ev(array['started', 'info_requested', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 10:00+07', '2026-03-02 11:00+07']), 60, 'delivered while a question is open: only the time before the question counts');
select is(pg_temp.ev(array['started', 'started', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 09:30+07', '2026-03-02 10:00+07']), 60, 'a second start inside a running stretch changes nothing');
select is(pg_temp.ev(array['started', 'info_provided', 'completed'], array['2026-03-02 09:00+07', '2026-03-02 09:30+07', '2026-03-02 10:00+07']), 60, 'an answer with no open question changes nothing');
select is(pg_temp.ev(array['started', 'completed', 'rework_requested', 'completed'], array['2026-03-02 09:00:00+07', '2026-03-02 09:00:40+07', '2026-03-02 09:10:00+07', '2026-03-02 09:10:40+07']), 1, 'seconds are added up before rounding down (40 s + 40 s = 1 minute, not 0 + 0)');
select is(pg_temp.ev(array['started', 'completed'], array['2026-03-07 16:00+07', '2026-03-09 09:00+07']), 120, 'the weekend is skipped inside a delivery too');

-- 9. work_minutes ใน get_detail ----------------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is((select count(*)::int from jsonb_object_keys(public.app_itwo_get_detail(current_setting('t.o1')::uuid))), 31, 'itwo get_detail has the 30 old keys plus work_minutes');
select ok(public.app_itwo_get_detail(current_setting('t.o1')::uuid) ?& array['id', 'is_test', 'doc_no', 'status', 'details', 'requester', 'department', 'events', 'access_changes', 'reworks', 'attachments', 'comments', 'info_pending', 'approvals', 'allowed_actions', 'work_minutes'], 'the old keys are all still there');
select is(public.app_itwo_get_detail(current_setting('t.o1')::uuid)->'work_minutes', 'null'::jsonb, 'work_minutes is null while IT has not delivered');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.itwo_events (is_test, work_order_id, actor_id, action, created_at)
select false, current_setting('t.a2')::uuid, (select id from public.employees where employee_no = 'W-ADM'), v.action, v.at::timestamptz
from (values
  ('info_requested', '2026-03-02 08:00+07'), ('info_provided', '2026-03-02 08:30+07'), ('started', '2026-03-02 09:00+07'),
  ('info_requested', '2026-03-02 10:00+07'), ('info_provided', '2026-03-02 14:00+07'), ('completed', '2026-03-02 16:00+07'),
  ('rework_requested', '2026-03-05 09:00+07'), ('completed', '2026-03-05 10:00+07')) v(action, at);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(public.app_itwo_get_detail(current_setting('t.a2')::uuid)->'work_minutes', '240'::jsonb, 'itwo: 60 + 120 (question 10-14 deducted) + 60 of the rework = 240');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itwo_get_detail(current_setting('t.a2')::uuid)->'work_minutes', '240'::jsonb, 'the IT head sees the same figure');
select is(public.app_itwo_get_detail(current_setting('t.b1')::uuid)->'work_minutes', 'null'::jsonb, 'an approved order that IT has not started has null');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok($$ select public.app_itwo_start(current_setting('t.b1')::uuid) $$, 'the IT admin starts a real order');
select lives_ok($$ select public.app_itwo_complete(current_setting('t.b1')::uuid) $$, 'and delivers it');
select is(jsonb_typeof(public.app_itwo_get_detail(current_setting('t.b1')::uuid)->'work_minutes'), 'number', 'after a real delivery work_minutes is a number (0 when it happened outside working hours)');
select ok((public.app_itwo_get_detail(current_setting('t.b1')::uuid)->>'work_minutes')::int >= 0, 'and never negative');
reset role;
select set_config('request.jwt.claims', '', true);
insert into public.itrp_events (is_test, request_id, actor_id, action, created_at)
select false, current_setting('t.r2')::uuid, (select id from public.employees where employee_no = 'W-ADM'), v.action, v.at::timestamptz
from (values ('started', '2026-03-02 11:00+07'), ('completed', '2026-03-02 14:00+07'), ('rework_requested', '2026-03-05 09:00+07')) v(action, at);
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is((select count(*)::int from jsonb_object_keys(public.app_itrp_get_detail(current_setting('t.r2')::uuid))), 36, 'itrp get_detail has the 35 old keys plus work_minutes');
select ok(public.app_itrp_get_detail(current_setting('t.r2')::uuid) ?& array['id', 'is_test', 'doc_no', 'status', 'requester', 'department', 'events', 'approvals', 'allowed_actions', 'work_minutes'], 'the old itrp keys are all still there');
select is(public.app_itrp_get_detail(current_setting('t.r2')::uuid)->'work_minutes', '120'::jsonb, 'itrp: 11-14 minus lunch = 120, and the open rework round is not counted');
select is(public.app_itrp_get_detail(current_setting('t.r1')::uuid)->'work_minutes', 'null'::jsonb, 'itrp: null before delivery');

select * from finish();
rollback;
