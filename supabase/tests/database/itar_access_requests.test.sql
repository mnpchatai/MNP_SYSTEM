-- ทดสอบโมดูลใบขอสิทธิ์ IT (20270107010000_itar_access_requests.sql) — ส่วนแกนของโมดูล
--   1) โครงสร้าง: RLS ทุกตาราง, ไม่มีสิทธิ์เขียน/อ่านตรง, RPC เป็น SECURITY DEFINER + search_path ว่าง + anon เรียกไม่ได้, ด่าน lab-only, ไม่มีช่องรหัสผ่าน
--   2) ยื่น: ตรวจทุกช่อง, เลข IT08-01-YY/NNN, เส้นทางอนุมัติทุกกรณี (ผจก. แผนกไม่มีผจก. แผนก IT ผู้ยื่นเป็นผู้อนุมัติขั้น IT -> หัวหน้า IT),
--      ยื่นแทน (IT ทุกประเภท · ผจก.แผนกเฉพาะยกเลิกทั้งหมด · พนักงานแทนผู้อื่นไม่ได้), from ต้องตรงกับทะเบียน
--   3) อนุมัติ/ไม่อนุมัติ/ถาม-ตอบ/ยกเลิก/รับงาน · ห้ามอนุมัติใบที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ · หลังบันทึกลงทะเบียนยกเลิกไม่ได้
--   4) app_itar_apply: atomic (ข้อมูลเก่า = 40001 ไม่เปลี่ยนอะไร), เขียนทะเบียนผ่าน itua พร้อมที่มา (source_request_id/doc_no) ที่ปลอมไม่ได้,
--      ผลต่อรายการ, ขอใหม่สร้างผู้ใช้, change ที่ยังไม่ผูก (เลือกผู้ใช้ + ผูกพนักงาน), revoke_all (ถอดครบ + ปิดอีเมล + ลาออก + จบทันที)
--   5) รับทราบ: ออนไลน์ (ผู้รับสิทธิ์) · กระดาษ (ต้องแนบรูป) · snapshot ใน itua_acknowledgements
--   6) ISO: events/ผลต่อรายการ/รายการ/ข้อความ/ไฟล์ แก้-ลบ-ล้างไม่ได้ · ใบเปลี่ยนสถานะได้เฉพาะตามตาราง · การมองเห็น · เลขเอกสาร · โหมดทดสอบ + ล้างข้อมูล
-- ไฟล์แนบ/Storage อยู่ที่ itar_files.test.sql · แจ้งเตือนอยู่ที่ itar_notify.test.sql
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (AR-*) ในแผนกทดสอบ ZR* ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน
begin;

create extension if not exists pgtap with schema extensions;
select plan(516);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1c400000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
create function pg_temp.e(p_no text) returns uuid language sql as $$ select current_setting('t.e_' || lower(replace(p_no, '-', '_')))::uuid $$;
-- ยื่นใบ (คืน id เป็นข้อความ)
create function pg_temp.mk(p_type text, p_reason text, p_items jsonb default '[]'::jsonb, p_subject jsonb default null) returns text language sql as $$
  select (select id::text from public.app_itar_create(p_type, p_reason, p_items, p_subject)) $$;
create function pg_temp.st(p_id uuid) returns text language sql as $$ select public.app_itar_get_detail(p_id) ->> 'status' $$;
create function pg_temp.acts(p_id uuid) returns text language sql as $$
  select string_agg(e ->> 'action', ',' order by (e ->> 'id')::bigint) from jsonb_array_elements(public.app_itar_get_detail(p_id) -> 'events') e $$;
create function pg_temp.yy() returns text language sql as $$ select to_char(now() at time zone 'Asia/Bangkok', 'YY') $$;
create function pg_temp.doc(p_id uuid) returns text language sql as $$ select public.app_itar_get_detail(p_id) ->> 'doc_no' $$;
-- id ของรายการในใบตามลำดับบรรทัด
create function pg_temp.item(p_id uuid, p_line integer) returns text language sql as $$
  select i ->> 'id' from jsonb_array_elements(public.app_itar_get_detail(p_id) -> 'items') i where (i ->> 'line_no')::int = p_line $$;
-- ตัดสินทุกรายการเป็น applied (ยกเว้นบรรทัดที่ระบุเป็น rejected)
create function pg_temp.decide_all(p_id uuid, p_reject_line integer default null) returns jsonb language sql as $$
  select coalesce(jsonb_agg(case when (i ->> 'line_no')::int = p_reject_line
                                 then jsonb_build_object('item_id', i ->> 'id', 'decision', 'rejected', 'reason', 'ไม่จำเป็นต้องใช้')
                                 else jsonb_build_object('item_id', i ->> 'id', 'decision', 'applied') end order by (i ->> 'line_no')::int), '[]'::jsonb)
  from jsonb_array_elements(public.app_itar_get_detail(p_id) -> 'items') i $$;
-- ผู้ใช้ทะเบียน (ต้องเรียกด้วยสิทธิ์ itas_admins) · สิทธิ์โฟลเดอร์/สถานะในรูปข้อความสั้น ๆ
create function pg_temp.uid(p_auth text) returns uuid language sql as $$
  select (e ->> 'id')::uuid from jsonb_array_elements(public.app_itua_list_users(p_auth) -> 'items') e where e ->> 'auth_id' = p_auth $$;
create function pg_temp.g(p_auth text) returns jsonb language sql as $$ select public.app_itua_get_user(pg_temp.uid(p_auth)) $$;
create function pg_temp.fl(p_auth text) returns text language sql as $$
  select coalesce(string_agg((f ->> 'code') || ':' || (f ->> 'level'), ',' order by (f ->> 'code') collate "C"), '') from jsonb_array_elements(pg_temp.g(p_auth) -> 'folders') f $$;
create function pg_temp.pl(p_auth text) returns text language sql as $$
  select coalesce(string_agg(p ->> 'code', ',' order by (p ->> 'code') collate "C"), '') from jsonb_array_elements(pg_temp.g(p_auth) -> 'programs') p $$;
create function pg_temp.em(p_auth text) returns text language sql as $$
  select coalesce(string_agg((m ->> 'address') || '=' || (m ->> 'status'), ',' order by (m ->> 'address') collate "C"), '') from jsonb_array_elements(pg_temp.g(p_auth) -> 'emails') m $$;
create function pg_temp.ts(p_auth text) returns timestamptz language sql as $$ select (pg_temp.g(p_auth) -> 'user' ->> 'updated_at')::timestamptz $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itar\_%' and c.relkind = 'r' and c.relrowsecurity), 8, 'RLS is enabled on all eight itar tables');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itar\_%' and c.relkind = 'r'), 8, 'the module has exactly the eight documented tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name like 'itar\_%' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no direct grant on the itar tables');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itar\_%' and c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, p.priv)), 'no role has any table privilege on the itar tables (checked per privilege)');
select ok(exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itar\_%' and c.relkind = 'S') and not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itar\_%' and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequences exist and are closed to anon, authenticated and service_role');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itar\_%' and p.polname like '%\_no\_direct\_access'), 8, 'every itar table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itar\_%' and p.polname = 'lab_only_no_access' and not p.polpermissive), 8, 'every itar table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itar\_%' and t.tgname like '%\_sandbox\_scope' and not t.tgisinternal), 8, 'every itar table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itar\_%' and (t.tgname like '%\_append\_only' or t.tgname like '%\_no\_truncate') and not t.tgisinternal), 13, 'the six append-only tables carry update/delete + truncate triggers and the request table cannot be truncated');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itar_doc_counters', 'itar_requests', 'itar_events', 'itar_admin_log', 'itar_request_items', 'itar_item_results', 'itar_comments', 'itar_attachments']) t), 'the eight new tables are registered in private.sandbox_unguarded_tables()');
select ok(array['itua_users', 'itua_acknowledgements', 'itrp_requests', 'itwo_work_orders', 'itas_assets', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config', 'bom_order_requests', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itua, itrp, itwo, itas, BOM and central)');
select is((select count(*)::int from unnest(private.sandbox_unguarded_tables()) t where t like 'itar\_%'), 8, 'exactly the 8 itar names were added');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itar\_%' or p.proname = 'app_sandbox_purge_itar')), 26, 'the module exposes 25 app_itar RPCs + the purge');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itar\_%' or p.proname = 'app_sandbox_purge_itar')), 'every public itar function is SECURITY DEFINER with an empty search_path');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_%' and p.prokind = 'f'), 'every private itar function has an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itar\_%' or p.proname = 'app_sandbox_purge_itar') and (has_function_privilege('anon', p.oid, 'execute') or not has_function_privilege('authenticated', p.oid, 'execute'))), 'every itar RPC is callable by authenticated and not by anon');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itar\_%' and p.proname not like 'itar\_storage\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itar helpers (including itar_begin_apply) are not callable by anon or authenticated');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itar%'), 'every itar RPC has the lab-only guard');
select ok(position('Asia/Bangkok' in pg_get_functiondef('private.itar_next_doc_no(boolean, timestamptz)'::regprocedure)) > 0, 'the document year is computed in Asia/Bangkok time');
select ok(position('itwo_staff' in pg_get_functiondef('private.itar_is_it_admin(uuid)'::regprocedure)) > 0 and position('itwo_staff' in pg_get_functiondef('private.itar_is_it_approver(uuid)'::regprocedure)) > 0 and position('itwo_staff' in pg_get_functiondef('private.itar_is_it_viewer(uuid)'::regprocedure)) > 0, 'the IT roles are read from itwo_staff');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itar%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.(itwo_|itrp_|itas_)'), 'no itar function writes to any itwo, itrp or itas table');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itar%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.itua_(users|emails|folders|programs|folder_grants|program_grants|log)'), 'no itar function writes to the register tables directly (only through the app_itua RPCs); only itua_acknowledgements is written directly');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itar%' and pg_get_functiondef(p.oid) ~* '(pgcrypto|pgp_sym|decrypt|gen_random_bytes|crypt\()'), 'no itar function uses pgcrypto or decrypts anything');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itar\_%') and pg_get_functiondef(p.oid) ~ '(ใบสั่งงาน|ใบแจ้งซ่อม)'), 'user-facing messages say "ใบขอสิทธิ์", never "ใบสั่งงาน" or "ใบแจ้งซ่อม"');
select ok(not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name like 'itar\_%' and c.column_name ~* '(pass|secret|licen[sc]e|plain|cipher|credential)'), 'no itar table has a column that could hold a password or another secret');
select ok(not exists (select 1 from pg_proc p cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) a(arg) where p.pronamespace = 'public'::regnamespace and p.proname like 'app\_itar\_%' and a.arg ~* '(password|plain|passphrase|secret)'), 'no RPC has a parameter named like a password or a secret');
select ok(position('itua.source_event_id' in pg_get_functiondef('private.itua_log()'::regprocedure)) > 0 and position('itar_events' in pg_get_functiondef('private.itua_log()'::regprocedure)) > 0 and position('source_request_id' in pg_get_functiondef('private.itua_log()'::regprocedure)) > 0, 'the register log trigger takes the source from the applied event only (never a caller-supplied request id)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'app\_itua\_%' and pg_get_functiondef(p.oid) ~* 'itua\.source'), 'no itua RPC can set the source (only private.itar_begin_apply does)');
select is((select count(*)::int from storage.buckets where id in ('itar-files', 'itar-test-files') and not public and file_size_limit = 20971520), 2, 'both itar buckets exist, are private and limited to 20 MB');
select is((select count(*)::int from public.employees where is_test and employee_no in ('SBX-IT-STAFF', 'SBX-IT-ADMIN', 'SBX-IT-APPROVER')), 3, 'the IT test personas of the work order module are reused');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
select count(set_config('t.itwo_staff_before', (select count(*)::text from public.itwo_staff), true));
select count(set_config('t.itrp_before', (select count(*)::text from public.itrp_requests), true));
select count(set_config('t.itua_users_before', (select count(*)::text from public.itua_users), true));
insert into public.departments (code, name_th, name_en) values
  ('ZRA', 'แผนกทดสอบ A (มีผู้จัดการ)', 'ZR A'), ('ZRB', 'แผนกทดสอบ B (ไม่มีผู้จัดการ)', 'ZR B'), ('ZRM', 'แผนกทดสอบ M (ทีม IT)', 'ZR M');
insert into auth.users (id, email, raw_user_meta_data)
select ('1c400000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itar-u' || n || '@test.local', '{}'::jsonb
from generate_series(1, 14) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itar.test', d.id, r.id, ('1c400000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'AR-REQ1', 'ZRA', 'staff'),
  (2, 'AR-REQ2', 'ZRA', 'staff'),
  (3, 'AR-MGRA', 'ZRA', 'department_manager'),
  (4, 'AR-REQB', 'ZRB', 'staff'),
  (5, 'AR-ADM', 'ZRM', 'staff'),
  (6, 'AR-HEAD', 'ZRM', 'staff'),
  (7, 'AR-ITONLY', 'ZRM', 'staff'),
  (8, 'AR-REQIT', 'IT', 'staff'),
  (9, 'AR-SBXADMIN', 'ZRM', 'admin'),
  (10, 'MNPLAB001', 'ZRA', 'staff'),
  (11, 'AR-AMGRA', 'ZRA', 'assistant_department_manager'),
  (12, 'AR-REQ3', 'ZRA', 'staff'),
  (13, 'AR-REQ4', 'ZRB', 'staff'),
  (14, 'AR-OTHER', 'ZRB', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- AR-ADM = ผู้ดูแลงาน IT + ผู้อนุมัติขั้น IT + อยู่ใน itas_admins (เหมือน IT3462) · AR-HEAD = หัวหน้า IT (viewer = FANG) · AR-ITONLY = ผู้ดูแลงานแต่ไม่อยู่ใน itas_admins
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver, is_it_viewer)
select e.id, v.adm, v.appr, v.head from (values ('AR-ADM', true, true, false), ('AR-HEAD', false, false, true), ('AR-ITONLY', true, false, false)) v(no, adm, appr, head)
join public.employees e on e.employee_no = v.no;
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no = 'AR-ADM';
select count(set_config('t.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'AR-%' or employee_no = 'MNPLAB001';
select count(set_config('t.dept_zrb', (select id::text from public.departments where code = 'ZRB'), true));
select count(set_config('t.dept_zra', (select id::text from public.departments where code = 'ZRA'), true));
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select is((select count(*)::int from public.itar_requests), 0, 'there are no access requests before the tests (clean database)');

-- ข้อมูลทะเบียนสิทธิ์ (ผ่าน RPC ของทะเบียนด้วยสิทธิ์ AR-ADM)
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itua_save_folder('ACC', 'แชร์บัญชี', 'โฟลเดอร์ฝ่ายบัญชี', 10) $$, 'the register has the ACC folder');
select lives_ok($$ select public.app_itua_save_folder('HR', 'แชร์บุคคล', null, 20) $$, 'the register has the HR folder');
select lives_ok($$ select public.app_itua_save_folder('OLDF', 'โฟลเดอร์เก่า', null, 30) $$, 'the register has the OLDF folder');
select lives_ok($$ select public.app_itua_save_folder('OLDF', 'โฟลเดอร์เก่า', null, 30, false, 'ปิดใช้งาน') $$, 'OLDF is closed (cannot be requested any more)');
select lives_ok(format($$ select public.app_itua_save_user(null, '{"auth_id": "req1.a", "name_th": "ทดสอบ AR-REQ1", "department_code": "ZRA", "division": "office", "employee_id": "%s"}'::jsonb) $$, current_setting('t.e_ar_req1')), 'register user req1.a is linked to the employee AR-REQ1');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "old.user", "name_th": "ผู้ใช้เก่า ไม่มีบัญชี", "name_en": "Old User", "department_code": "ZRB", "division": "factory"}'::jsonb) $$, 'register user old.user has no employee account');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "spare.one", "name_th": "ผู้ใช้สำรองหนึ่ง", "department_code": "ZRA", "division": "office"}'::jsonb) $$, 'register user spare.one is not linked to anyone');
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('req1.a'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "R"}]'::jsonb, 'ตั้งต้นสำหรับทดสอบ') $$, 'req1.a starts with ACC:R');
select lives_ok($$ select public.app_itua_add_email(pg_temp.uid('req1.a'), 'req1.a@itar.test', 'internal') $$, 'req1.a has an internal e-mail');
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('old.user'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "F"}, {"kind": "internet", "from": false, "to": true}, {"kind": "program", "code": "IPRIME", "from": false, "to": true}]'::jsonb, 'ตั้งต้นสำหรับทดสอบ') $$, 'old.user starts with ACC:F, internet and IPRIME');
select lives_ok($$ select public.app_itua_add_email(pg_temp.uid('old.user'), 'old.user@itar.test', 'internal') $$, 'old.user has an internal e-mail');
select lives_ok($$ select public.app_itua_add_email(pg_temp.uid('old.user'), 'old.shared@itar.test', 'extra') $$, 'old.user has an extra e-mail');
select count(set_config('t.u_req1', pg_temp.uid('req1.a')::text, true));
select count(set_config('t.u_old', pg_temp.uid('old.user')::text, true));
select count(set_config('t.u_spare', pg_temp.uid('spare.one')::text, true));
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_log where source_request_id is not null), 0, 'register changes made outside an access request carry no source request');

-- 3. ยื่น: ตรวจข้อมูล + ขอบเขตการยื่นแทน ---------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try($$ select pg_temp.mk(null, 'x', '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb) $$), '23514: กรุณาเลือกประเภทคำขอ (ขอใหม่ เปลี่ยนแปลง หรือยกเลิกทั้งหมด)', 'the request type is required');
select is(pg_temp.try($$ select pg_temp.mk('foo', 'x') $$), '23514: กรุณาเลือกประเภทคำขอ (ขอใหม่ เปลี่ยนแปลง หรือยกเลิกทั้งหมด)', 'an unknown request type is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', '   ', '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb) $$), '23514: กรุณาระบุเหตุผลที่ขอ', 'the overall reason is required');
select is(pg_temp.try($$ select pg_temp.mk('change', repeat('ก', 2001), '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb) $$), '23514: เหตุผลต้องไม่เกิน 2,000 ตัวอักษร', 'the reason is limited to 2,000 characters');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[]'::jsonb) $$), '23514: กรุณาเลือกสิทธิ์ที่ต้องการอย่างน้อยหนึ่งรายการ', 'a change needs at least one item');
select is(pg_temp.try($$ select pg_temp.mk('revoke_all', 'เหตุผล', '[{"kind":"internet","from":true,"to":false}]'::jsonb) $$), '23514: ประเภทยกเลิกสิทธิ์ทั้งหมดไม่ต้องระบุรายการสิทธิ์ (ระบบถอดสิทธิ์ทั้งหมดของผู้ใช้ให้)', 'revoke_all takes no items');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '{"kind":"internet"}'::jsonb) $$), '23514: รายการสิทธิ์ที่ขอต้องเป็นรูปแบบ array', 'items must be an array');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"bogus"}]'::jsonb) $$), '23514: รายการที่ 1: kind ต้องเป็น folder, internet, program หรือ email', 'an unknown item kind is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"NOPE","from":null,"to":"R"}]'::jsonb) $$), '23514: ไม่พบโฟลเดอร์ NOPE', 'an unknown folder is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"OLDF","from":null,"to":"R"}]'::jsonb) $$), '23514: โฟลเดอร์ OLDF: โฟลเดอร์ปิดการใช้งานอยู่ ขอสิทธิ์ไม่ได้', 'a closed folder cannot be requested');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"ACC","from":null,"to":"X"}]'::jsonb) $$), '23514: โฟลเดอร์ ACC: สิทธิ์ที่ขอ (to) ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', 'the folder level must be R, F or null');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"ACC","to":"F"}]'::jsonb) $$), '23514: โฟลเดอร์ ACC: สิทธิ์ปัจจุบัน (from) ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', 'the current level (from) is required when the register is linked');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"ACC","from":"F","to":"R"}]'::jsonb) $$), '40001: โฟลเดอร์ ACC: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale "from" is refused with 40001');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"ACC","from":"R","to":"R"}]'::jsonb) $$), '23514: โฟลเดอร์ ACC: สิทธิ์ที่ขอเหมือนเดิม ไม่มีการเปลี่ยนแปลง', 'asking for the same level is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","from":false,"to":true}]'::jsonb) $$), '23514: กรุณาระบุเหตุผลที่ขอใช้อินเทอร์เน็ต', 'asking for internet needs its own reason');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","from":true,"to":true,"note":"x"}]'::jsonb) $$), '40001: อินเทอร์เน็ต: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'internet "from" must match the register');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"program","target":"OTHER","from":false,"to":true}]'::jsonb) $$), '23514: โปรแกรม OTHER: ต้องระบุว่าเป็นโปรแกรมอะไร', 'the "other" program needs a description');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"program","target":"NOPE","from":false,"to":true}]'::jsonb) $$), '23514: ไม่พบโปรแกรม NOPE', 'an unknown program is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"bad","to":"add"}]'::jsonb) $$), '23514: รายการที่ 1: รูปแบบอีเมลไม่ถูกต้อง', 'a bad e-mail address is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"req1.a@itar.test","to":"add","email_kind":"extra"}]'::jsonb) $$), '23514: อีเมล req1.a@itar.test: ที่อยู่นี้ถูกใช้งานอยู่ในทะเบียนแล้ว', 'an address that is already active cannot be requested');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"new.int@itar.test","to":"add","email_kind":"internal"}]'::jsonb) $$), '23514: อีเมล new.int@itar.test: ผู้ใช้นี้มีอีเมลภายในที่ใช้งานอยู่แล้ว (มีได้ 1 ที่อยู่)', 'a second internal e-mail is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"nobody@itar.test","to":"close"}]'::jsonb) $$), '23514: อีเมล nobody@itar.test: ไม่พบอีเมลนี้ที่ใช้งานอยู่ของผู้ใช้', 'closing an e-mail the user does not have is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"HR","from":null,"to":"R"},{"kind":"folder","target":"hr","from":null,"to":"F"}]'::jsonb) $$), '23514: โฟลเดอร์ HR ซ้ำกันในรายการเดียวกัน', 'the same folder twice in one request is refused');
select is(pg_temp.try($$ select pg_temp.mk('new', 'เหตุผล', '[{"kind":"folder","target":"HR","to":"R"}]'::jsonb) $$), '23514: ผู้ใช้นี้มีอยู่ในทะเบียนสิทธิ์แล้ว กรุณาเลือกประเภท "เปลี่ยนแปลง" แทน', 'a new request for someone who is already in the register is refused');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"folder","target":"HR","from":null,"to":"R"}]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req2') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)', 'a plain employee cannot file for a colleague');
select is(pg_temp.try($$ select pg_temp.mk('revoke_all', 'เหตุผล', '[]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req2') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)', 'a plain employee cannot revoke a colleague either');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb, ('{"name_th": "คนนอก", "department_id": "' || current_setting('t.dept_zrb') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์ให้คนที่ไม่มีบัญชีได้เฉพาะผู้ดูแลงาน IT (หรือผู้จัดการแผนกที่ยกเลิกสิทธิ์ทั้งหมดของผู้ใช้ในแผนกตัวเอง)', 'a plain employee cannot file for someone without an account');
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb, '{"employee_id": "not-a-uuid"}'::jsonb) $$), '23514: รหัสผู้รับสิทธิ์หรือแผนกไม่ถูกต้อง', 'a malformed subject id is refused');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","from":false,"to":true,"note":"x"}]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req1') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)', 'a department manager cannot file a change for a subordinate (revoke_all only)');
select is(pg_temp.try($$ select pg_temp.mk('revoke_all', 'เหตุผล', '[]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req4') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)', 'a department manager cannot revoke someone of another department');
select is(pg_temp.try($$ select pg_temp.mk('revoke_all', 'เหตุผล', '[]'::jsonb, ('{"user_id": "' || current_setting('t.u_old') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์ให้คนที่ไม่มีบัญชีได้เฉพาะผู้ดูแลงาน IT (หรือผู้จัดการแผนกที่ยกเลิกสิทธิ์ทั้งหมดของผู้ใช้ในแผนกตัวเอง)', 'a department manager cannot revoke a register user of another department');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_requests), 0, 'every refused request left nothing behind (no request, no document number used)');
select is((select count(*)::int from public.itar_doc_counters), 0, 'and no counter row was created');

-- 4. ยื่น: เส้นทางอนุมัติแต่ละกรณี ---------------------------------------
set local role authenticated;
-- r1: REQ1 (ZRA มีผจก.) ขอเปลี่ยนสิทธิ์ของตัวเอง (ผูกทะเบียนแล้ว)
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r1', pg_temp.mk('change', 'ย้ายงานไปทีมบัญชีและต้องใช้ระบบเพิ่ม', '[
  {"kind":"folder","target":"ACC","from":"R","to":"F"},
  {"kind":"folder","target":"HR","from":null,"to":"R"},
  {"kind":"internet","from":false,"to":true,"note":"ต้องค้นข้อมูลลูกค้า"},
  {"kind":"program","target":"IPRIME","from":false,"to":true},
  {"kind":"email","target":"req1.extra@itar.test","to":"add","email_kind":"extra"}]'::jsonb), true);
-- r2: MGRA (ผจก.ZRA) ยกเลิกสิทธิ์ทั้งหมดแทน REQ1 -> ข้ามขั้นแผนก
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.r2', pg_temp.mk('revoke_all', 'พนักงานลาออก', '[]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req1') || '"}')::jsonb), true);
-- r3: REQB (ZRB ไม่มีผจก.) ขอสิทธิ์ (ยังไม่ผูกทะเบียน -> ไม่รู้ค่าเดิม)
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select set_config('t.r3', pg_temp.mk('change', 'ขอเพิ่มสิทธิ์', '[{"kind":"folder","target":"HR","to":"R"},{"kind":"program","target":"IPRIME","to":true}]'::jsonb), true);
-- r4: REQIT (แผนก IT) ขอใหม่ (ผู้ใช้ยังไม่มีในทะเบียน)
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select set_config('t.r4', pg_temp.mk('new', 'เข้าทำงานใหม่', '[{"kind":"folder","target":"ACC","to":"R"},{"kind":"internet","to":true,"note":"งานติดต่อลูกค้า"},{"kind":"email","target":"req.it@itar.test","to":"add","email_kind":"internal"}]'::jsonb, '{"division": "office"}'::jsonb), true);
-- r5: ADM (ผู้อนุมัติขั้น IT) ยื่นของตัวเอง -> ไม่อนุมัติในตัว รอหัวหน้า IT
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.r5', pg_temp.mk('change', 'ผู้ดูแลระบบขอสิทธิ์ทดสอบ', '[{"kind":"folder","target":"ACC","to":"R"}]'::jsonb), true);
-- r6: ADM ยื่นแทนผู้ใช้ทะเบียนที่ไม่มีบัญชี (old.user · แผนก ZRB)
select set_config('t.r6', pg_temp.mk('change', 'ขอถอนโฟลเดอร์ ACC ให้ผู้ใช้เก่า', '[{"kind":"folder","target":"ACC","from":"F","to":"R"},{"kind":"email","target":"old.shared@itar.test","to":"close"}]'::jsonb, ('{"user_id": "' || current_setting('t.u_old') || '"}')::jsonb), true);
-- r7: ADM ยื่นแทนพนักงานที่มีบัญชีแต่ยังไม่ผูกทะเบียน (REQ2)
select set_config('t.r7', pg_temp.mk('change', 'ขอสิทธิ์แทนพนักงาน', '[{"kind":"folder","target":"ACC","to":"R"}]'::jsonb, ('{"employee_id": "' || current_setting('t.e_ar_req2') || '"}')::jsonb), true);
-- r8: ADM ยื่นขอใหม่แทนคนที่ไม่มีบัญชีเลย (ระบุชื่อ + แผนก + ฝ่าย)
select set_config('t.r8', pg_temp.mk('new', 'ผู้รับเหมาเข้าทำงานชั่วคราว', '[{"kind":"internet","to":true,"note":"ติดต่อซัพพลายเออร์"}]'::jsonb, ('{"name_th": "สมชาย ผู้รับเหมา", "department_id": "' || current_setting('t.dept_zrb') || '", "division": "factory"}')::jsonb), true);
-- r9: ผู้จัดการ ZRA ยื่นของตัวเอง (ผู้จัดการแผนก = ผู้ยื่น) -> ข้ามขั้นแผนก
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.r9', pg_temp.mk('new', 'ผู้จัดการขอสิทธิ์ใหม่', '[{"kind":"program","target":"POWERBI","to":true}]'::jsonb, '{"division": "manager"}'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.st(current_setting('t.r1')::uuid), 'pending_dept', 'a staff member of a department with a manager waits for the department step');
select is(pg_temp.acts(current_setting('t.r1')::uuid), 'created', 'a normal request records only "created"');
select is(pg_temp.doc(current_setting('t.r1')::uuid), 'IT08-01-' || pg_temp.yy() || '/001', 'document numbers run IT08-01-YY/NNN in order');
select is(pg_temp.st(current_setting('t.r2')::uuid), 'pending_it_mgr', 'a manager revoking a subordinate skips the department step');
select is(pg_temp.acts(current_setting('t.r2')::uuid), 'created,dept_approved', 'the department step is signed automatically in the requester name');
select is(public.app_itar_get_detail(current_setting('t.r2')::uuid) -> 'events' -> 1 ->> 'actor_employee_no', 'AR-MGRA', 'the automatic department approval is signed by the manager who filed');
select is(public.app_itar_get_detail(current_setting('t.r2')::uuid) -> 'subject' ->> 'employee_no', 'AR-REQ1', 'the revoke request is about AR-REQ1');
select is(public.app_itar_get_detail(current_setting('t.r2')::uuid) -> 'subject' ->> 'user_id', current_setting('t.u_req1'), 'the subject is linked to the register user through the employee');
select is(pg_temp.st(current_setting('t.r3')::uuid), 'pending_it_mgr', 'a department without any manager goes straight to the IT approver');
select ok((public.app_itar_get_detail(current_setting('t.r3')::uuid) -> 'events' -> 0 ->> 'reason') like '%ไม่มีผู้จัดการ%', 'the created event says why the department step is skipped');
select is((public.app_itar_get_detail(current_setting('t.r3')::uuid) -> 'subject' ->> 'user_id'), null, 'an employee that is not in the register yet has no linked register user');
select is((select string_agg(i ->> 'from_known', ',') from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.r3')::uuid) -> 'items') i), 'false,false', 'items of an unlinked subject are stored with an unknown current value');
select is(pg_temp.st(current_setting('t.r4')::uuid), 'pending_it_mgr', 'an IT department subject waits for the IT approver only');
select is(public.app_itar_get_detail(current_setting('t.r4')::uuid) -> 'subject' ->> 'division', 'office', 'a new request keeps the division chosen by the requester');
select is(pg_temp.st(current_setting('t.r5')::uuid), 'pending_it_mgr', 'an IT approver filing is not approved in his own name (waits for the IT head)');
select is(pg_temp.acts(current_setting('t.r5')::uuid), 'created', 'the IT approver signs nothing at filing');
select is(public.app_itar_get_detail(current_setting('t.r6')::uuid) -> 'subject' ->> 'name_th', 'ผู้ใช้เก่า ไม่มีบัญชี', 'the register user name is copied into the request');
select is(public.app_itar_get_detail(current_setting('t.r6')::uuid) -> 'subject' ->> 'has_account', 'false', 'a subject without an account is flagged (paper acknowledgement)');
select is(public.app_itar_get_detail(current_setting('t.r6')::uuid) ->> 'department_id', current_setting('t.dept_zrb'), 'the department is found from the register department code');
select is(pg_temp.st(current_setting('t.r6')::uuid), 'pending_it_mgr', 'ZRB has no manager: the request waits for the IT stage');
select is(public.app_itar_get_detail(current_setting('t.r7')::uuid) -> 'subject' ->> 'has_account', 'true', 'IT filing for an employee with an account keeps the account on the request');
select is(pg_temp.st(current_setting('t.r7')::uuid), 'pending_dept', 'a request for a ZRA employee waits for the ZRA manager even when IT filed it');
select is(pg_temp.st(current_setting('t.r8')::uuid), 'pending_it_mgr', 'a request for a person without an account in a department without manager goes to the IT stage');
select is(public.app_itar_get_detail(current_setting('t.r8')::uuid) -> 'subject' ->> 'division', 'factory', 'the division of a new person is kept');
select is(pg_temp.st(current_setting('t.r9')::uuid), 'pending_it_mgr', 'a department manager filing for himself skips the department step');
select is(pg_temp.acts(current_setting('t.r9')::uuid), 'created,dept_approved', 'and signs the department step automatically');
select is(pg_temp.try($$ select pg_temp.mk('new', 'x', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$), '23514: กรุณาเลือกฝ่ายของผู้ใช้ใหม่ (สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน InDesign)', 'a new user needs a division');
select is(pg_temp.try($$ select pg_temp.mk('new', 'x', '[{"kind":"internet","to":false}]'::jsonb, ('{"division": "office", "name_th": "x", "department_id": "' || current_setting('t.dept_zrb') || '"}')::jsonb) $$), '23514: อินเทอร์เน็ต: ขอสิทธิ์ใหม่เพิ่มสิทธิ์ได้อย่างเดียว', 'a new request can only add rights');
select is(pg_temp.try($$ select pg_temp.mk('new', 'x', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb, '{"name_th": "x", "division": "office"}'::jsonb) $$), '23514: กรุณาเลือกแผนกของผู้รับสิทธิ์', 'a person without an account needs a department');
select is(jsonb_array_length(public.app_itar_search_subjects('ar-req') -> 'employees'), 6, 'IT admin searching "ar-req" finds the six matching employees');
select is(jsonb_array_length(public.app_itar_search_subjects('old.user') -> 'users'), 1, 'and the register user old.user');
select is(pg_temp.try($$ select public.app_itar_search_subjects('x') $$), '23514: กรุณาพิมพ์คำค้นอย่างน้อย 2 ตัวอักษร', 'a one-letter search is refused');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(jsonb_array_length(public.app_itar_search_subjects('ar-req') -> 'employees'), 3, 'a department manager only finds employees of the own department');
select is(jsonb_array_length(public.app_itar_search_subjects('old.user') -> 'users'), 0, 'and no register user of another department');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try($$ select public.app_itar_search_subjects('ar-req') $$), '42501: เฉพาะผู้ดูแลงาน IT หรือผู้จัดการ/ผู้ช่วยผู้จัดการแผนกเท่านั้นที่ค้นหาผู้รับสิทธิ์ได้', 'a plain employee cannot search subjects');

-- 5. ฟอร์มยื่น (form_context) --------------------------------------------
select is(public.app_itar_form_context('change') -> 'subject' ->> 'employee_id', current_setting('t.e_ar_req1'), 'the form context defaults to the caller as the subject');
select is(public.app_itar_form_context('change') ->> 'linked', 'true', 'the caller is linked to the register');
select is(jsonb_array_length(public.app_itar_form_context('change') -> 'rights' -> 'folders'), 1, 'the form shows the current rights of the subject (ACC:R)');
select is(public.app_itar_form_context('change') -> 'rights' -> 'folders' -> 0 ->> 'level', 'R', 'with the level');
select is(jsonb_array_length(public.app_itar_form_context('change') -> 'catalog' -> 'folders'), 2, 'only the open folders can be requested (ACC, HR)');
select ok(public.app_itar_form_context('change') -> 'departments' is null or jsonb_typeof(public.app_itar_form_context('change') -> 'departments') = 'null', 'a plain employee gets no department list');
select is(pg_temp.try($$ select public.app_itar_form_context('new') $$), '23514: ผู้ใช้นี้มีอยู่ในทะเบียนสิทธิ์แล้ว กรุณาเลือกประเภท "เปลี่ยนแปลง" แทน', 'a linked employee cannot start a "new" form');
select is(pg_temp.try($$ select public.app_itar_form_context('x') $$), '23514: ประเภทคำขอต้องเป็น new, change หรือ revoke_all', 'the form context checks the type');
select is(public.app_itar_form_context('change', ('{"employee_id": "' || current_setting('t.e_ar_req1') || '"}')::jsonb) ->> 'linked', 'true', 'asking for oneself explicitly works too');
select is(pg_temp.try($$ select public.app_itar_form_context('change', ('{"employee_id": "' || current_setting('t.e_ar_req2') || '"}')::jsonb) $$), '42501: ยื่นใบขอสิทธิ์แทนผู้อื่นได้เฉพาะผู้ดูแลงาน IT (ทุกประเภท) หรือผู้จัดการ/ผู้ช่วยผู้จัดการของแผนกนั้น (เฉพาะยกเลิกสิทธิ์ทั้งหมด)', 'a plain employee cannot read the rights of a colleague through the form context');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select ok(jsonb_array_length(public.app_itar_form_context('change') -> 'departments') >= 3, 'IT admin gets the department list for filing on behalf of a person without an account');
select is(public.app_itar_form_context('change', ('{"user_id": "' || current_setting('t.u_old') || '"}')::jsonb) -> 'rights' ->> 'internet', 'true', 'IT admin sees the rights of a register user');
select is(public.app_itar_form_context('change', ('{"user_id": "' || current_setting('t.u_old') || '"}')::jsonb) -> 'subject' ->> 'department_name', 'แผนกทดสอบ B (ไม่มีผู้จัดการ)', 'with the department found from the register');

-- 6. อนุมัติ · ห้ามอนุมัติใบตัวเอง · ถาม-ตอบ ----------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r1'))), '42501: ไม่สามารถอนุมัติหรือไม่อนุมัติใบขอสิทธิ์ที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ได้', 'the requester cannot approve his own request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.try(format($$ select public.app_itar_get_detail('%s') $$, current_setting('t.r1'))), '42501: ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a colleague of the same department cannot even see the request');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r1'))), '23514: ต้องรอผู้จัดการแผนกอนุมัติก่อน', 'the IT approver must wait for the department step when the department has a manager');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r5'))), '42501: ไม่สามารถอนุมัติหรือไม่อนุมัติใบขอสิทธิ์ที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ได้', 'the IT approver cannot approve his own request');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r3'))), '42501: คุณไม่มีสิทธิ์พิจารณาใบขอสิทธิ์นี้', 'an IT admin who is not an approver cannot approve');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r3'))), '42501: คุณไม่มีสิทธิ์พิจารณาใบขอสิทธิ์นี้', 'the IT head cannot approve an ordinary request');
select is(public.app_itar_pending_count(), 3, 'the IT head has the three requests that involve the IT approver pending (r5, r6, r8)');
select is((select string_agg(doc_no, ',' order by doc_no) from public.app_itar_list_pending_approvals()), pg_temp.doc(current_setting('t.r5')::uuid) || ',' || pg_temp.doc(current_setting('t.r6')::uuid) || ',' || pg_temp.doc(current_setting('t.r8')::uuid), 'the pending list matches');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r2'))), '42501: คุณไม่มีสิทธิ์พิจารณาใบขอสิทธิ์นี้', 'the IT head cannot approve a request that does not involve the IT approver');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r5')), 'the IT head approves the IT approver request (both steps in one click)');
select is(pg_temp.acts(current_setting('t.r5')::uuid), 'created,dept_approved,it_mgr_approved', 'one click recorded both steps in the IT head name');
select is(pg_temp.st(current_setting('t.r5')::uuid), 'approved', 'the request is approved');
select is(public.app_itar_get_detail(current_setting('t.r5')::uuid) -> 'events' -> 2 ->> 'actor_employee_no', 'AR-HEAD', 'signed by the IT head, not by the requester');
select is((select count(*)::int from public.app_itar_list_pending_approvals()), 2, 'the IT head still has r6 and r8 pending');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itar_pending_count(), 2, 'the ZRA manager has r1 and r7 pending (not his own r9 nor the revoke he filed)');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r2'))), '42501: ไม่สามารถอนุมัติหรือไม่อนุมัติใบขอสิทธิ์ที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ได้', 'the manager cannot approve the revoke request he filed');
select is(pg_temp.try(format($$ select public.app_itar_reject('%s', null) $$, current_setting('t.r1'))), '23514: กรุณาระบุเหตุผลที่ไม่อนุมัติ', 'rejecting needs a reason');
select is(pg_temp.try(format($$ select public.app_itar_reject('%s', repeat('ก', 501)) $$, current_setting('t.r1'))), '23514: เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'the rejection reason is limited');
-- ถามผู้ยื่น: ผู้จัดการแผนกถามก่อนอนุมัติ
select is(pg_temp.try(format($$ select public.app_itar_request_info('%s', '   ') $$, current_setting('t.r1'))), '23514: กรุณาพิมพ์ข้อความที่ต้องการถามผู้ยื่น', 'a question needs text');
select lives_ok(format($$ select public.app_itar_request_info('%s', 'ต้องใช้อินเทอร์เน็ตกี่วัน') $$, current_setting('t.r1')), 'the department manager asks the requester a question');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'need_info', 'the request waits for the answer');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้รอผู้ยื่นตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้', 'approving is blocked while the question is open');
select is(pg_temp.try(format($$ select public.app_itar_reject('%s', 'ไม่ผ่าน') $$, current_setting('t.r1'))), '23514: ใบนี้กำลังรอผู้ยื่นตอบคำถาม กรุณารอคำตอบก่อน', 'rejecting is blocked too');
select is(pg_temp.try(format($$ select public.app_itar_request_info('%s', 'อีกข้อ') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้มีคำถามที่รอผู้ยื่นตอบอยู่แล้ว ถามเพิ่มได้หลังผู้ยื่นตอบ', 'a second question cannot be asked while one is open');
select ok(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' ? 'cancel' = false, 'the manager has no cancel button on a request he does not own');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select ok(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' ? 'provide_info', 'the requester can answer');
select is((select info_stage from public.app_itar_list_mine() where id = current_setting('t.r1')::uuid), 'dept', 'the list shows which step asked');
select is(pg_temp.try(format($$ select public.app_itar_provide_info('%s', '   ') $$, current_setting('t.r1'))), '23514: กรุณาพิมพ์คำตอบ', 'an answer needs text');
select lives_ok(format($$ select public.app_itar_provide_info('%s', 'ประมาณ 2 สัปดาห์') $$, current_setting('t.r1')), 'the requester answers');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'pending_dept', 'the request returns to the department step');
select is(pg_temp.try(format($$ select public.app_itar_provide_info('%s', 'อีกครั้ง') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้ไม่มีคำถามที่รอตอบ', 'there is nothing left to answer');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'comments'), 2, 'the detail shows the question and the answer');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r1')), 'the department manager approves r1');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'pending_it_mgr', 'r1 now waits for the IT approver');
select lives_ok(format($$ select public.app_itar_reject('%s', 'ไม่จำเป็นต้องใช้โฟลเดอร์นี้') $$, current_setting('t.r7')), 'the department manager rejects r7 with a reason');
select is(pg_temp.st(current_setting('t.r7')::uuid), 'rejected', 'a rejection ends the request at once');
select is(pg_temp.acts(current_setting('t.r7')::uuid), 'created,dept_rejected', 'the rejection is recorded');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r7'))), '23514: ใบขอสิทธิ์นี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be approved afterwards');
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'x') $$, current_setting('t.r7'))), '42501: เฉพาะผู้ยื่นหรือผู้ดูแลงาน IT เท่านั้นที่ยกเลิกใบขอสิทธิ์ได้', 'only the requester or IT can cancel');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'x') $$, current_setting('t.r7'))), '23514: ใบขอสิทธิ์นี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be cancelled');
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r6'))), '42501: ไม่สามารถอนุมัติหรือไม่อนุมัติใบขอสิทธิ์ที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ได้', 'the IT approver cannot approve r6 either: he filed it, so the IT head decides');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r1')), 'the IT approver approves r1 (department already done)');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r2')), 'the IT approver approves r2 (revoke filed by the manager)');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r3')), 'the IT approver approves r3 (department without manager: one click for both steps)');
select is(pg_temp.acts(current_setting('t.r3')::uuid), 'created,dept_approved,it_mgr_approved', 'r3 records both steps');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r4')), 'the IT approver approves r4 (IT department subject)');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r9')), 'the IT approver approves r9');
select is((select string_agg(pg_temp.st(x::uuid), ',' order by x) from unnest(array[current_setting('t.r1'), current_setting('t.r2'), current_setting('t.r3'), current_setting('t.r4'), current_setting('t.r9')]) x), 'approved,approved,approved,approved,approved', 'five requests are approved by the IT approver');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r6')), 'the IT head approves r6 (the request IT filed on behalf of someone without an account)');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.r8')), 'the IT head approves r8 (new person without an account)');

-- 7. ยกเลิก (ผู้ยื่น / IT แทน) -----------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select set_config('t.c1', pg_temp.mk('change', 'ขอแล้วเปลี่ยนใจ', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', '  ') $$, current_setting('t.c1'))), '23514: กรุณาระบุเหตุผลที่ยกเลิก', 'a cancellation needs a reason');
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', repeat('ก', 501)) $$, current_setting('t.c1'))), '23514: เหตุผลต้องไม่เกิน 500 ตัวอักษร', 'and it is limited to 500 characters');
select lives_ok(format($$ select public.app_itar_cancel('%s', 'เปลี่ยนใจ') $$, current_setting('t.c1')), 'the requester cancels his own request');
select is(pg_temp.st(current_setting('t.c1')::uuid), 'cancelled', 'cancelled');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_approve('%s') $$, current_setting('t.c1'))), '23514: ใบขอสิทธิ์นี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be approved');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'อีกที') $$, current_setting('t.c1'))), '23514: ใบขอสิทธิ์นี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be cancelled again');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select set_config('t.c2', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(14), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'x') $$, current_setting('t.c2'))), '42501: เฉพาะผู้ยื่นหรือผู้ดูแลงาน IT เท่านั้นที่ยกเลิกใบขอสิทธิ์ได้', 'a colleague cannot cancel a request of another employee');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'ผู้ยื่นลาออกแล้ว') $$, current_setting('t.c2'))), 'OK', 'an IT admin cancels on behalf of the requester');
select is(public.app_itar_get_detail(current_setting('t.c2')::uuid) -> 'events' -> 1 ->> 'reason', 'IT ยกเลิกแทนผู้ยื่น: ผู้ยื่นลาออกแล้ว', 'the history says IT cancelled on behalf');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select set_config('t.c3', pg_temp.mk('change', 'ขอสิทธิ์', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb), true);
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.c3')), 'the IT approver approves c3 (department without manager)');
select is(pg_temp.try(format($$ select public.app_itar_request_info('%s', 'ขอรายละเอียดเพิ่ม') $$, current_setting('t.c3'))), 'OK', 'IT admin asks a question after the approval');
select is(pg_temp.st(current_setting('t.c3')::uuid), 'need_info', 'waiting for the answer');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select is(pg_temp.try(format($$ select public.app_itar_provide_info('%s', 'เพื่อใช้ติดต่อซัพพลายเออร์') $$, current_setting('t.c3'))), 'OK', 'the requester answers IT');
select is(pg_temp.st(current_setting('t.c3')::uuid), 'approved', 'the request returns to "approved"');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r3'))), 'OK', 'an IT admin (not in itas_admins) can take the work (start)');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r3'))), '23514: ใบขอสิทธิ์นี้ IT เริ่มดำเนินการไปแล้ว', 'starting twice is refused');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r1'))), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่รับงานใบขอสิทธิ์ได้', 'a requester cannot take the work');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.c1'))), '23514: ใบขอสิทธิ์นี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be started');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r9'))), 'OK', 'IT admin starts r9');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r1'))), 'OK', 'IT admin starts r1');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r2'))), 'OK', 'IT admin starts r2');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r4'))), 'OK', 'IT admin starts r4');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r5'))), 'OK', 'IT admin starts r5 (his own request: the IT head approved it)');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r6'))), 'OK', 'IT admin starts r6');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.r8'))), 'OK', 'IT admin starts r8');
reset role;
select set_config('request.jwt.claims', '', true);

-- 8. IT บันทึกสิทธิ์ลงทะเบียน (apply) -----------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r1'))), '42501: เฉพาะผู้ดูแลงาน IT ที่อยู่ในรายชื่อผู้ใช้ทะเบียนสิทธิ์เท่านั้นที่บันทึกสิทธิ์ลงทะเบียนได้', 'an IT admin that is not in itas_admins cannot apply');
select is(pg_temp.try(format($$ select public.app_itar_apply_context('%s') $$, current_setting('t.r1'))), '42501: เฉพาะผู้ดูแลงาน IT ที่อยู่ในรายชื่อผู้ใช้ทะเบียนสิทธิ์เท่านั้นที่บันทึกสิทธิ์ลงทะเบียนได้', 'nor open the apply screen data');
select ok(not (public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' ? 'apply'), 'and the apply button is not offered to him');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(substr(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r1'))), 1, 5), '42501', 'the IT head cannot apply');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(substr(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r1'))), 1, 5), '42501', 'a requester cannot apply');
select set_config('request.jwt.claims', '', true);
set local role anon;
select throws_ok(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r1')), '42501', null, 'anon cannot call apply');
select throws_ok($$ select private.itar_begin_apply(1) $$, '42501', null, 'anon cannot set the register source');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select private.itar_begin_apply(1) $$, '42501', null, 'even IT cannot set the register source by hand');
select throws_ok($$ select public.app_itar_apply_context('00000000-0000-0000-0000-000000000000') $$, '23514', 'ไม่พบใบขอสิทธิ์นี้', 'apply_context of an unknown request');

-- 8.1 ตรวจการตัดสินต่อรายการ
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r1'))), '23514: ต้องตัดสินให้ครบทุกรายการของใบ (บันทึกลงทะเบียน หรือไม่บันทึกพร้อมเหตุผล)', 'every item needs a decision');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '{}'::jsonb) $$, current_setting('t.r1'))), '23514: การตัดสินต่อรายการต้องเป็นรูปแบบ array', 'the decisions must be an array');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', jsonb_set(pg_temp.decide_all('%s'), '{0,decision}', '"maybe"')) $$, current_setting('t.r1'), current_setting('t.r1'))), '23514: การตัดสินต่อรายการต้องเป็น applied (บันทึกลงทะเบียน) หรือ rejected (ไม่บันทึก)', 'a decision must be applied or rejected');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', jsonb_set(pg_temp.decide_all('%s'), '{0}', jsonb_build_object('item_id', pg_temp.item('%s', 1), 'decision', 'rejected'))) $$, current_setting('t.r1'), current_setting('t.r1'), current_setting('t.r1'))), '23514: กรุณาระบุเหตุผลที่ไม่บันทึกรายการนี้ลงทะเบียน', 'a rejected item needs a reason');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', jsonb_set(pg_temp.decide_all('%s'), '{0,item_id}', '"00000000-0000-0000-0000-000000000000"')) $$, current_setting('t.r1'), current_setting('t.r1'))), '23514: การตัดสินอ้างรายการที่ไม่อยู่ในใบนี้', 'a decision about an item of another request is refused');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', jsonb_set(pg_temp.decide_all('%s'), '{1,item_id}', to_jsonb(pg_temp.item('%s', 1)))) $$, current_setting('t.r1'), current_setting('t.r1'), current_setting('t.r1'))), '23514: มีการตัดสินซ้ำสำหรับรายการเดียวกัน', 'two decisions for one item are refused');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', (select jsonb_agg(jsonb_build_object('item_id', i ->> 'id', 'decision', 'rejected', 'reason', 'x')) from jsonb_array_elements(public.app_itar_get_detail('%s') -> 'items') i)) $$, current_setting('t.r1'), current_setting('t.r1'))), '23514: ต้องบันทึกลงทะเบียนอย่างน้อยหนึ่งรายการ (ถ้าไม่ดำเนินการเลย ให้ยกเลิกใบพร้อมเหตุผลแทน)', 'rejecting every item is not an apply (cancel the request instead)');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[{"item_id": "x", "decision": "applied"}]'::jsonb) $$, current_setting('t.r2'))), '23514: การตัดสินอ้างรายการที่ไม่อยู่ในใบนี้', 'a revoke_all request has no items to decide');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.c3'))), '23514: ต้องกดรับงานก่อนจึงจะบันทึกสิทธิ์ลงทะเบียนได้', 'an approved request must be taken (started) before applying');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.r7'))), '23514: ใบขอสิทธิ์นี้ไม่อนุมัติไปแล้ว', 'a rejected request cannot be applied');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.c1'))), '23514: ใบขอสิทธิ์นี้ถูกยกเลิกแล้ว', 'a cancelled request cannot be applied');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_events where action = 'applied'), 0, 'no refused apply left an applied event behind');
select is((select count(*)::int from public.itar_item_results), 0, 'nor any item result');

-- 8.2 ข้อมูลเก่า: ทะเบียนถูกแก้หลังยื่น -> 40001 และไม่เปลี่ยนอะไรเลย (atomic)
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('req1.a'), '[{"kind": "folder", "code": "ACC", "from": "R", "to": "F"}]'::jsonb, 'IT แก้เองก่อน') $$, 'someone changed ACC of req1.a in the register after the request was filed');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s', 5)) $$, current_setting('t.r1'), current_setting('t.r1'))), '40001: โฟลเดอร์ ACC: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale current value stops the whole apply with 40001');
select is(pg_temp.fl('req1.a'), 'ACC:F', 'the register is untouched (only the earlier manual change)');
select is(pg_temp.pl('req1.a'), '', 'no program was granted');
select is(pg_temp.g('req1.a') -> 'user' ->> 'internet', 'false', 'internet was not granted');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'in_progress', 'the request is still in progress');
select is(pg_temp.acts(current_setting('t.r1')::uuid), 'created,info_requested,info_provided,dept_approved,it_mgr_approved,started', 'no applied event was recorded');
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('req1.a'), '[{"kind": "folder", "code": "ACC", "from": "F", "to": "R"}]'::jsonb, 'คืนค่าเดิมเพื่อทดสอบต่อ') $$, 'the register is put back to the state the request was filed against');
-- ผู้ยื่นขอปิดอีเมลที่ไม่เคยมี: ตรวจตอนบันทึกลงทะเบียน (add email ที่ถูกคนอื่นใช้ไปแล้วระหว่างนั้น)
select lives_ok($$ select public.app_itua_add_email(pg_temp.uid('spare.one'), 'req1.extra@itar.test', 'extra') $$, 'meanwhile another user took the e-mail address that r1 asked for');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s')) $$, current_setting('t.r1'), current_setting('t.r1'))), '23514: อีเมล req1.extra@itar.test มีผู้ใช้งานอยู่ในทะเบียนแล้ว', 'an e-mail address that became taken stops the apply (the register refuses it)');
select is(pg_temp.fl('req1.a'), 'ACC:R', 'and nothing before it stuck either (ACC:R, no HR)');
select is(pg_temp.pl('req1.a'), '', 'no program');
select lives_ok($$ select public.app_itua_close_email((select (m ->> 'id')::uuid from jsonb_array_elements(pg_temp.g('spare.one') -> 'emails') m where m ->> 'address' = 'req1.extra@itar.test'), 'คืนที่อยู่เพื่อทดสอบต่อ') $$, 'the address is released again');

-- 8.3 บันทึกลงทะเบียนสำเร็จ: r1 (ปฏิเสธรายการอีเมล)
select set_config('t.r1res', public.app_itar_apply(current_setting('t.r1')::uuid, pg_temp.decide_all(current_setting('t.r1')::uuid, 5))::text, true);
select is(current_setting('t.r1res')::jsonb ->> 'status', 'awaiting_ack', 'a change request goes to "awaiting_ack" after the apply');
select is(current_setting('t.r1res')::jsonb ->> 'applied', '4', 'four items were applied');
select is(current_setting('t.r1res')::jsonb ->> 'rejected', '1', 'one item was not applied');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'awaiting_ack', 'the request waits for the user to acknowledge');
select is(pg_temp.fl('req1.a'), 'ACC:F,HR:R', 'the register now has ACC:F and HR:R');
select is(pg_temp.pl('req1.a'), 'IPRIME', 'the program was granted');
select is(pg_temp.g('req1.a') -> 'user' ->> 'internet', 'true', 'internet was granted');
select is(pg_temp.em('req1.a'), 'req1.a@itar.test=active', 'the rejected e-mail was not added');
select is(pg_temp.g('req1.a') -> 'user' ->> 'granted_doc_no', pg_temp.doc(current_setting('t.r1')::uuid), 'the user carries the document number of the last grant');
select is(pg_temp.g('req1.a') -> 'user' ->> 'granted_on', to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'), 'and the (Thai) date');
select is((select string_agg((i -> 'result' ->> 'decision'), ',' order by (i ->> 'line_no')::int) from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'items') i), 'applied,applied,applied,applied,rejected', 'the detail shows the decision of every item');
select is((public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'items' -> 4 -> 'result' ->> 'reason'), 'ไม่จำเป็นต้องใช้', 'with the reason of the rejected one');
select is(pg_temp.acts(current_setting('t.r1')::uuid), 'created,info_requested,info_provided,dept_approved,it_mgr_approved,started,applied', 'the apply is the last event');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'applied_summary' -> 'before' -> 'folders' -> 0 ->> 'level', 'R', 'the summary keeps the state before (ACC:R)');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'applied_summary' -> 'after' ->> 'internet', 'true', 'and after');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'subject_rights' ->> 'granted_doc_no', pg_temp.doc(current_setting('t.r1')::uuid), 'the detail shows the current rights of the subject');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s')) $$, current_setting('t.r1'), current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว กำลังรอผู้ใช้รับทราบ', 'a second apply is refused');
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'ขอยกเลิก') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว กำลังรอผู้ใช้รับทราบ', 'IT cannot cancel after the apply');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'ขอยกเลิก') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้ IT บันทึกสิทธิ์ลงทะเบียนแล้ว กำลังรอผู้ใช้รับทราบ', 'neither can the requester');
select ok(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' ? 'acknowledge', 'the subject is offered the acknowledge button');
select ok(not (public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' ? 'cancel'), 'and no cancel button any more');
select is((select needs_my_ack from public.app_itar_list_mine() where id = current_setting('t.r1')::uuid), true, 'the list marks the request as waiting for his acknowledgement');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r1')::uuid), 5, 'five register changes carry the source request (ACC, HR, IPRIME, internet, granted stamp)');
select is((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r1')::uuid and source_doc_no is distinct from (select doc_no from public.itar_requests where id = current_setting('t.r1')::uuid)), 0, 'with the matching document number');
select is((select count(*)::int from public.itua_log where reason like 'ตามใบขอสิทธิ์ %' and source_request_id is null), 0, 'every change made for a request is tagged (none without a source)');
select is((select count(*)::int from public.itua_log where source_request_id is not null and source_request_id <> current_setting('t.r1')::uuid), 0, 'no other change carries a source yet');
select is((select count(*)::int from public.itar_item_results where request_id = current_setting('t.r1')::uuid), 5, 'the result of every item is stored');
select throws_ok(format($$ update public.itar_requests set status = 'cancelled' where id = '%s' $$, current_setting('t.r1')), '23514', 'เปลี่ยนสถานะใบขอสิทธิ์จาก awaiting_ack เป็น cancelled ไม่ได้', 'the table refuses cancelling a request after the apply');
select throws_ok(format($$ update public.itar_requests set status = 'done' where id = '%s' $$, current_setting('t.r1')), '23514', 'ต้องมีการรับทราบ (acknowledged) ก่อนจบใบ', 'the table refuses finishing without an acknowledgement event');
select throws_ok(format($$ update public.itar_requests set applied_summary = '{}'::jsonb where id = '%s' $$, current_setting('t.r1')), '42501', 'แก้ผลการบันทึกลงทะเบียนหรือผู้ใช้ที่ผูกกับใบไม่ได้ (ตั้งได้ครั้งเดียวตอน IT บันทึกลงทะเบียน)', 'the summary cannot be rewritten');
select throws_ok(format($$ update public.itar_requests set subject_user_id = gen_random_uuid() where id = '%s' $$, current_setting('t.r1')), '42501', 'แก้ผลการบันทึกลงทะเบียนหรือผู้ใช้ที่ผูกกับใบไม่ได้ (ตั้งได้ครั้งเดียวตอน IT บันทึกลงทะเบียน)', 'neither can the linked register user');

-- 8.4 รับทราบออนไลน์
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r1'))), '42501: เฉพาะผู้รับสิทธิ์เท่านั้นที่กดรับทราบสิทธิ์ของตัวเองได้', 'IT cannot acknowledge for someone who has an account');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.r1'))), '23514: ผู้รับสิทธิ์คนนี้มีบัญชีในระบบ ต้องกดรับทราบเองในระบบ (ไม่ใช้ใบกระดาษ)', 'and not with paper either');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r1'))), '23514: ไม่พบใบขอสิทธิ์นี้', 'a colleague cannot reach the request at all');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r2'))), '23514: ใบขอสิทธิ์นี้ IT เริ่มดำเนินการไปแล้ว', 'a request that is not waiting for an acknowledgement cannot be acknowledged');
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r1')), 'the subject acknowledges and accepts the policy');
select is(pg_temp.st(current_setting('t.r1')::uuid), 'done', 'the request is done');
select is(pg_temp.acts(current_setting('t.r1')::uuid), 'created,info_requested,info_provided,dept_approved,it_mgr_approved,started,applied,acknowledged', 'the acknowledgement is the last event');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'acknowledged' ->> 'method', 'online', 'the detail says the acknowledgement was made online');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r1'))), '23514: ใบขอสิทธิ์นี้รับทราบและจบงานแล้ว', 'a second acknowledgement is refused');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_acknowledgements where request_id = current_setting('t.r1')::uuid), 1, 'one acknowledgement row was written');
select is((select a.snapshot ->> 'method' from public.itua_acknowledgements a where a.request_id = current_setting('t.r1')::uuid), 'online', 'with the method');
select is((select jsonb_array_length(a.snapshot -> 'folders') from public.itua_acknowledgements a where a.request_id = current_setting('t.r1')::uuid), 2, 'a snapshot of every right after the change (two folders)');
select is((select a.policy_version from public.itua_acknowledgements a where a.request_id = current_setting('t.r1')::uuid), 'IT08-01/1', 'and the policy version');
select is((select e.employee_no from public.itua_acknowledgements a join public.employees e on e.id = a.acknowledged_by where a.request_id = current_setting('t.r1')::uuid), 'AR-REQ1', 'signed by the subject');
select ok(not exists (select 1 from public.itua_acknowledgements a where a.request_id = current_setting('t.r1')::uuid and a.snapshot::text ~* '(password|secret|cipher)'), 'the snapshot holds no secret');
select throws_ok($$ update public.itua_acknowledgements set policy_version = 'x' $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'an acknowledgement cannot be changed');

-- 8.5 ปลอมที่มาของประวัติทะเบียนไม่ได้
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select set_config('t.ev_created_r9', (select (e ->> 'id') from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.r9')::uuid) -> 'events') e where e ->> 'action' = 'created'), true);
select set_config('t.ev_applied_r1', (select (e ->> 'id') from jsonb_array_elements(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'events') e where e ->> 'action' = 'applied'), true);
select set_config('itua.source_event_id', '999999999', true);
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('spare.one'), '[{"kind": "program", "code": "LINE", "from": false, "to": true}]'::jsonb, 'ทดสอบปลอมที่มา 1') $$, 'a register change is made with a made-up source event id');
select set_config('itua.source_event_id', current_setting('t.ev_created_r9'), true);
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('spare.one'), '[{"kind": "program", "code": "LINE", "from": true, "to": false}]'::jsonb, 'ทดสอบปลอมที่มา 2') $$, 'and with the id of a "created" event');
select set_config('itua.source_event_id', current_setting('t.ev_applied_r1'), true);
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('spare.one'), '[{"kind": "program", "code": "LINE", "from": false, "to": true}]'::jsonb, 'ทดสอบปลอมที่มา 3') $$, 'and with the applied event of a request that is already finished');
select set_config('itua.source_event_id', 'abc', true);
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('spare.one'), '[{"kind": "program", "code": "LINE", "from": true, "to": false}]'::jsonb, 'ทดสอบปลอมที่มา 4') $$, 'and with garbage');
select set_config('itua.source_event_id', '', true);
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_log where reason like 'ทดสอบปลอมที่มา%'), 4, 'the four forged changes were logged');
select is((select count(*)::int from public.itua_log where reason like 'ทดสอบปลอมที่มา%' and (source_request_id is not null or source_doc_no is not null)), 0, 'and none of them carries a source');

-- 8.6 ขอใหม่ (r4: ผู้ขอแผนก IT) + ตรวจก่อนสร้างผู้ใช้
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s')) $$, current_setting('t.r4'), current_setting('t.r4'))), '23514: กรุณาระบุ Auth. Name ของผู้ใช้ใหม่ (เช่น somchai.k)', 'a new request needs the Auth. Name of the new user');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s'), pg_temp.uid('req1.a')) $$, current_setting('t.r4'), current_setting('t.r4'))), '23514: ใบขอสิทธิ์ใหม่สร้างผู้ใช้ใหม่ในทะเบียน ไม่ต้องเลือกผู้ใช้เดิม', 'and no existing user may be chosen');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s'), null, '{"auth_id": "req1.a"}'::jsonb) $$, current_setting('t.r4'), current_setting('t.r4'))), '23514: Auth. Name req1.a ซ้ำกับผู้ใช้อื่น', 'a duplicate Auth. Name is refused by the register');
select is(jsonb_array_length(public.app_itua_list_users('req.it') -> 'items'), 0, 'nothing was created by the refused attempts');
select is(pg_temp.st(current_setting('t.r4')::uuid), 'in_progress', 'the request is still in progress');
select is(public.app_itar_apply_context(current_setting('t.r4')::uuid) ->> 'needs_new_user', 'true', 'the apply screen says a new user must be created');
select is(public.app_itar_apply_context(current_setting('t.r4')::uuid) ->> 'needs_user_choice', 'false', 'and that no existing user has to be chosen');
select set_config('t.r4res', public.app_itar_apply(current_setting('t.r4')::uuid, pg_temp.decide_all(current_setting('t.r4')::uuid), null, '{"auth_id": "Req.IT", "name_en": "Req It"}'::jsonb)::text, true);
select is(current_setting('t.r4res')::jsonb ->> 'status', 'awaiting_ack', 'a new request goes to "awaiting_ack"');
select is(pg_temp.fl('req.it'), 'ACC:R', 'the new user has the requested folder');
select is(pg_temp.g('req.it') -> 'user' ->> 'internet', 'true', 'and internet');
select is(pg_temp.em('req.it'), 'req.it@itar.test=active', 'and the internal e-mail');
select is(pg_temp.g('req.it') -> 'user' ->> 'employee_id', current_setting('t.e_ar_reqit'), 'the new user is linked to the employee of the request');
select is(pg_temp.g('req.it') -> 'user' ->> 'department_code', 'IT', 'with the department code of the request');
select is(pg_temp.g('req.it') -> 'user' ->> 'division', 'office', 'and the division');
select is(pg_temp.g('req.it') -> 'user' ->> 'name_en', 'Req It', 'the English name was typed by IT');
select is(pg_temp.g('req.it') -> 'user' ->> 'granted_doc_no', pg_temp.doc(current_setting('t.r4')::uuid), 'the document number is stamped at creation');
select is(public.app_itar_get_detail(current_setting('t.r4')::uuid) -> 'subject' ->> 'user_id', pg_temp.uid('req.it')::text, 'the request is now linked to the new register user');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.r4')::uuid) -> 'applied_summary' -> 'before' -> 'folders'), 0, 'the state before was empty');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r4')), 'the new employee acknowledges his rights');
select is(pg_temp.st(current_setting('t.r4')::uuid), 'done', 'r4 is done');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r4')::uuid and action = 'created' and entity = 'user'), 1, 'the creation of the user is tagged with the request');
select ok((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r4')::uuid) >= 4, 'so are the grants and the e-mail');

-- 8.7 change ที่ยังไม่ผูกทะเบียน (r3) → เลือกผู้ใช้ + ผูกพนักงาน
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(public.app_itar_apply_context(current_setting('t.r3')::uuid) ->> 'needs_user_choice', 'true', 'the apply screen says IT has to choose the register user');
select is(jsonb_array_length(public.app_itar_apply_context(current_setting('t.r3')::uuid) -> 'suggested_users'), 0, 'nobody in the register matches yet');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s')) $$, current_setting('t.r3'), current_setting('t.r3'))), '23514: กรุณาเลือกผู้ใช้ในทะเบียนสิทธิ์ที่ตรงกับผู้รับสิทธิ์', 'IT must choose a register user');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s'), pg_temp.uid('req1.a')) $$, current_setting('t.r3'), current_setting('t.r3'))), '23514: ผู้ใช้ในทะเบียนนี้ผูกกับพนักงานคนอื่น เลือกผู้ใช้ไม่ตรงกับผู้รับสิทธิ์', 'a register user linked to another employee cannot be chosen');
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "has.hr", "name_th": "ผู้ใช้มี HR", "department_code": "ZRB", "division": "factory"}'::jsonb) $$, 'a register user that already has HR:R');
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('has.hr'), '[{"kind": "folder", "code": "HR", "from": null, "to": "R"}]'::jsonb, 'ตั้งต้น') $$, 'granted');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s'), pg_temp.uid('has.hr')) $$, current_setting('t.r3'), current_setting('t.r3'))), '23514: โฟลเดอร์ HR: ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', 'a right the register already has (unknown current value) must be rejected by IT, not applied');
select is((select string_agg(i ->> 'current_value', ',' order by (i ->> 'line_no')::int) from jsonb_array_elements(public.app_itar_apply_context(current_setting('t.r3')::uuid) -> 'items') i), null, 'the unlinked request shows no current values') ;
select lives_ok($$ select public.app_itua_save_user(pg_temp.uid('spare.one'), '{"name_en": "Spare One"}'::jsonb, 'เพิ่มชื่ออังกฤษ', pg_temp.ts('spare.one')) $$, 'the spare user gets an English name');
select set_config('t.r3res', public.app_itar_apply(current_setting('t.r3')::uuid, pg_temp.decide_all(current_setting('t.r3')::uuid), pg_temp.uid('spare.one'), null, true)::text, true);
select is(current_setting('t.r3res')::jsonb ->> 'status', 'awaiting_ack', 'r3 is applied to the chosen register user');
select is(pg_temp.fl('spare.one'), 'HR:R', 'the folder was granted');
select is(pg_temp.pl('spare.one'), 'IPRIME', 'and the program');
select is(pg_temp.g('spare.one') -> 'user' ->> 'employee_id', current_setting('t.e_ar_reqb'), 'the register user was linked to the employee of the request');
select is(public.app_itar_get_detail(current_setting('t.r3')::uuid) -> 'subject' ->> 'user_id', pg_temp.uid('spare.one')::text, 'and the request to the register user');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r3')), 'the requester (also the subject) acknowledges');
select is(pg_temp.st(current_setting('t.r3')::uuid), 'done', 'r3 is done');

-- 8.8 r5: ผู้ดูแลระบบขอสิทธิ์ของตัวเอง (ไม่ผูก) · r6: ผู้ใช้ทะเบียนที่ไม่มีบัญชี · r8: คนใหม่ไม่มีบัญชี · r9: ผู้จัดการขอใหม่
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_itua_save_user(null, '{"auth_id": "adm.user", "name_th": "ผู้ดูแลระบบ", "department_code": "ZRM", "division": "office"}'::jsonb) $$, 'a register user for the IT admin');
select lives_ok($$ select public.app_itua_set_grants(pg_temp.uid('adm.user'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "R"}]'::jsonb, 'ตั้งต้น') $$, 'who already has ACC:R');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', pg_temp.decide_all('%s'), pg_temp.uid('adm.user')) $$, current_setting('t.r5'), current_setting('t.r5'))), '23514: โฟลเดอร์ ACC: ทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว กรุณาเลือก "ไม่บันทึก" พร้อมเหตุผล', 'r5 asks for something the user already has');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', jsonb_build_array(jsonb_build_object('item_id', pg_temp.item('%s', 1), 'decision', 'rejected', 'reason', 'มีสิทธิ์อยู่แล้ว'))) $$, current_setting('t.r5'), current_setting('t.r5'))), '23514: ต้องบันทึกลงทะเบียนอย่างน้อยหนึ่งรายการ (ถ้าไม่ดำเนินการเลย ให้ยกเลิกใบพร้อมเหตุผลแทน)', 'rejecting the only item is not an apply');
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'มีสิทธิ์อยู่แล้ว') $$, current_setting('t.r5'))), 'OK', 'the request is cancelled instead (the requester is IT)');
select set_config('t.r6res', public.app_itar_apply(current_setting('t.r6')::uuid, pg_temp.decide_all(current_setting('t.r6')::uuid))::text, true);
select is(current_setting('t.r6res')::jsonb ->> 'status', 'awaiting_ack', 'r6 (register user without account) waits for the paper acknowledgement');
select is(pg_temp.fl('old.user'), 'ACC:R', 'ACC went from F to R');
select is(pg_temp.em('old.user'), 'old.shared@itar.test=closed,old.user@itar.test=active', 'the shared address was closed');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r6'))), '42501: เฉพาะผู้รับสิทธิ์เท่านั้นที่กดรับทราบสิทธิ์ของตัวเองได้', 'nobody can acknowledge online for a person without an account');
select is(pg_temp.try(format($$ select public.app_itar_acknowledge_paper('%s') $$, current_setting('t.r6'))), '23514: กรุณาแนบรูปใบรับทราบที่เซ็นแล้วอย่างน้อย 1 ไฟล์ก่อน', 'the paper acknowledgement needs the photo of the signed paper first');
select ok(public.app_itar_get_detail(current_setting('t.r6')::uuid) -> 'allowed_actions' ?& array['acknowledge_paper', 'add_paper_attachment'], 'IT is offered the paper acknowledgement and the upload');
select ok(not (public.app_itar_get_detail(current_setting('t.r6')::uuid) -> 'allowed_actions' ? 'acknowledge'), 'but not the online one');
select set_config('t.r8res', public.app_itar_apply(current_setting('t.r8')::uuid, pg_temp.decide_all(current_setting('t.r8')::uuid), null, '{"auth_id": "contractor.s"}'::jsonb)::text, true);
select is(pg_temp.g('contractor.s') -> 'user' ->> 'name_th', 'สมชาย ผู้รับเหมา', 'r8 created the user from the name of the request');
select is(pg_temp.g('contractor.s') -> 'user' ->> 'division', 'factory', 'with the division');
select is(pg_temp.g('contractor.s') -> 'user' ->> 'employee_id', null, 'without an employee link (no account)');
select is(pg_temp.g('contractor.s') -> 'user' ->> 'department_code', 'ZRB', 'and the department code');
select set_config('t.r9res', public.app_itar_apply(current_setting('t.r9')::uuid, pg_temp.decide_all(current_setting('t.r9')::uuid), null, '{"auth_id": "mgra.new"}'::jsonb)::text, true);
select is(pg_temp.pl('mgra.new'), 'POWERBI', 'r9 granted the program to the new user');
select is(pg_temp.g('mgra.new') -> 'user' ->> 'division', 'manager', 'with the division the manager typed');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.r9')), 'the manager acknowledges r9');

-- 8.9 ยกเลิกสิทธิ์ทั้งหมด (r2) -> จบทันที ไม่ต้องรับทราบ
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(public.app_itar_apply_context(current_setting('t.r2')::uuid) -> 'subject_rights' ->> 'status', 'active', 'before the revoke the user is active');
select is(jsonb_array_length(public.app_itar_apply_context(current_setting('t.r2')::uuid) -> 'subject_rights' -> 'folders'), 2, 'with two folders');
select set_config('t.r2res', public.app_itar_apply(current_setting('t.r2')::uuid, null)::text, true);
select is(current_setting('t.r2res')::jsonb ->> 'status', 'done', 'a revoke_all request is done right after the apply (no acknowledgement)');
select is(pg_temp.st(current_setting('t.r2')::uuid), 'done', 'the request is done');
select is(pg_temp.acts(current_setting('t.r2')::uuid), 'created,dept_approved,it_mgr_approved,started,applied', 'with no acknowledgement event');
select is(pg_temp.g('req1.a') -> 'user' ->> 'status', 'resigned', 'the register user is resigned');
select is(pg_temp.fl('req1.a'), '', 'every folder was removed');
select is(pg_temp.pl('req1.a'), '', 'every program was removed');
select is(pg_temp.g('req1.a') -> 'user' ->> 'internet', 'false', 'internet was removed');
select is(pg_temp.em('req1.a'), 'req1.a@itar.test=closed', 'the e-mail was closed (not deleted)');
select is(public.app_itar_get_detail(current_setting('t.r2')::uuid) -> 'applied_summary' -> 'after' ->> 'status', 'resigned', 'the summary records the state after');
select is(jsonb_array_length(public.app_itar_get_detail(current_setting('t.r2')::uuid) -> 'applied_summary' -> 'before' -> 'folders'), 2, 'and before');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', null) $$, current_setting('t.r2'))), '23514: ใบขอสิทธิ์นี้จบงานแล้ว', 'a finished revoke cannot be applied again');
select is(pg_temp.try(format($$ select public.app_itar_cancel('%s', 'x') $$, current_setting('t.r2'))), '23514: ใบขอสิทธิ์นี้จบงานแล้ว', 'nor cancelled');
select is(pg_temp.try($$ select pg_temp.mk('change', 'x', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb, jsonb_build_object('user_id', pg_temp.uid('req1.a'))) $$), '23514: ผู้ใช้นี้ลาออกแล้วในทะเบียนสิทธิ์ ไม่สามารถขอเปลี่ยนแปลงหรือยกเลิกสิทธิ์ได้', 'a resigned register user cannot get a new change request');
reset role;
select set_config('request.jwt.claims', '', true);
select ok((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r2')::uuid) >= 6, 'the revoke changes (folders, program, internet, e-mail, status) are all tagged with the request');
select is((select count(*)::int from public.itua_log where source_request_id = current_setting('t.r2')::uuid and source_doc_no is distinct from (select doc_no from public.itar_requests where id = current_setting('t.r2')::uuid)), 0, 'with its document number');
select is((select count(*)::int from public.itua_acknowledgements where request_id = current_setting('t.r2')::uuid), 0, 'a revoke needs no acknowledgement row');

-- 9. ISO: ประวัติแก้/ลบ/ล้างไม่ได้ · ใบเปลี่ยนสถานะได้เฉพาะตามตาราง · เข้าตารางตรงไม่ได้ ----------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itar_events set reason = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'an event cannot be changed');
select throws_ok($$ delete from public.itar_events $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'an event cannot be deleted');
select throws_ok($$ truncate public.itar_events $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the events cannot be truncated');
select throws_ok($$ update public.itar_request_items set note = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a requested item cannot be changed');
select throws_ok($$ delete from public.itar_request_items $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a requested item cannot be deleted');
select throws_ok($$ truncate public.itar_request_items cascade $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the items cannot be truncated');
select throws_ok($$ update public.itar_item_results set reason = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'an item result cannot be changed');
select throws_ok($$ delete from public.itar_item_results $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'an item result cannot be deleted');
select throws_ok($$ truncate public.itar_item_results $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the item results cannot be truncated');
select throws_ok($$ update public.itar_comments set body = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a comment cannot be changed');
select throws_ok($$ delete from public.itar_comments $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a comment cannot be deleted');
select throws_ok($$ truncate public.itar_comments cascade $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the comments cannot be truncated');
select throws_ok($$ truncate public.itar_attachments $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the attachments cannot be truncated');
select throws_ok($$ truncate public.itar_admin_log $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be truncated');
select throws_ok($$ delete from public.itar_requests $$, '42501', 'ใบขอสิทธิ์ลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)', 'a request cannot be deleted');
select throws_ok($$ truncate public.itar_requests cascade $$, '42501', 'ใบขอสิทธิ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the requests cannot be truncated');
select throws_ok(format($$ update public.itar_requests set reason = 'แก้เหตุผล' where id = '%s' $$, current_setting('t.c3')), '42501', 'ใบขอสิทธิ์แก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วยื่นใหม่)', 'the content of a request cannot be edited');
select throws_ok(format($$ update public.itar_requests set subject_name_th = 'อื่น' where id = '%s' $$, current_setting('t.c3')), '42501', 'ใบขอสิทธิ์แก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วยื่นใหม่)', 'nor the subject snapshot');
select throws_ok(format($$ update public.itar_requests set status = 'approved' where id = '%s' $$, current_setting('t.r7')), '23514', 'เปลี่ยนสถานะใบขอสิทธิ์จาก rejected เป็น approved ไม่ได้', 'a rejected request cannot be reopened');
select throws_ok(format($$ update public.itar_requests set status = 'pending_dept' where id = '%s' $$, current_setting('t.c1')), '23514', 'เปลี่ยนสถานะใบขอสิทธิ์จาก cancelled เป็น pending_dept ไม่ได้', 'a cancelled request cannot be reopened');
select throws_ok(format($$ update public.itar_requests set status = 'in_progress' where id = '%s' $$, current_setting('t.r1')), '23514', 'เปลี่ยนสถานะใบขอสิทธิ์จาก done เป็น in_progress ไม่ได้', 'a finished request cannot be reopened');
select throws_ok(format($$ update public.itar_requests set status = 'awaiting_ack', applied_summary = '{}'::jsonb, subject_user_id = gen_random_uuid() where id = '%s' $$, current_setting('t.c3')), '23514', 'เปลี่ยนสถานะใบขอสิทธิ์จาก approved เป็น awaiting_ack ไม่ได้', 'a request cannot jump from approved to awaiting_ack');
select throws_ok(format($$ update public.itar_requests set status = 'need_info' where id = '%s' $$, current_setting('t.c3')), '23514', 'ถามกลับผู้ยื่นต้องบันทึกสถานะเดิมของใบ (approved) ไว้เป็นสถานะที่จะกลับไป', 'the status to return to is mandatory when asking');
select throws_ok(format($$ insert into public.itar_events (is_test, request_id, actor_id, action) values (false, '%s', '%s', 'applied') $$, current_setting('t.r7'), current_setting('t.e_ar_adm')), '23514', 'บันทึกลงทะเบียนได้เฉพาะใบที่ IT กำลังดำเนินการ', 'an applied event cannot be written for a request that is not in progress');
select throws_ok(format($$ insert into public.itar_events (is_test, request_id, actor_id, action) values (false, '%s', '%s', 'acknowledged') $$, current_setting('t.c3'), current_setting('t.e_ar_adm')), '23514', 'รับทราบได้เฉพาะใบที่รอผู้ใช้รับทราบ', 'an acknowledged event cannot be written before the apply');
select throws_ok(format($$ insert into public.itar_item_results (is_test, request_id, item_id, decision, decided_by) values (false, '%s', '%s', 'applied', '%s') $$, current_setting('t.c3'), (select i.id from public.itar_request_items i where i.request_id = current_setting('t.c3')::uuid limit 1), current_setting('t.e_ar_adm')), '23514', 'ผลต่อรายการต้องผูกกับเหตุการณ์บันทึกลงทะเบียนของใบเดียวกันและผู้กดคนเดียวกัน', 'an item result needs an applied event of the same request and the same person');
select throws_ok(format($$ insert into public.itar_comments (is_test, request_id, kind, stage, author_id, body) values (false, '%s', 'question', 'it', '%s', 'ถามตัวเอง') $$, current_setting('t.c3'), current_setting('t.e_ar_req4')), '23514', 'ผู้ยื่นถามกลับใบขอสิทธิ์ของตัวเองไม่ได้', 'the requester cannot ask himself a question');
select throws_ok(format($$ insert into public.itar_request_items (is_test, request_id, line_no, kind, target, to_value) values (false, '%s', 9, 'folder', null, 'R') $$, current_setting('t.c3')), '23514', null, 'an item with the wrong shape is refused by the table (folder without target)');
select throws_ok(format($$ insert into public.itar_request_items (is_test, request_id, line_no, kind, target, from_known, from_value, to_value) values (false, '%s', 9, 'internet', null, true, 'true', 'true') $$, current_setting('t.c3')), '23514', null, 'an item that changes nothing is refused by the table');
select throws_ok(format($$ insert into public.itar_request_items (is_test, request_id, line_no, kind, target, from_known, from_value, to_value) values (false, '%s', 9, 'internet', null, true, 'false', 'true') $$, current_setting('t.c3')), '23505', null, 'the same thing cannot be requested twice in one request (unique per target)');
select throws_ok(format($$ update public.itar_requests set status = 'done' where id = '%s' $$, current_setting('t.r6')), '23514', 'ต้องมีการรับทราบ (acknowledged) ก่อนจบใบ', 'the paper request cannot be finished without an acknowledgement event');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok($$ select * from public.itar_requests $$, '42501', null, 'even IT cannot read the table directly');
select throws_ok($$ insert into public.itar_events (is_test, request_id, actor_id, action) values (false, gen_random_uuid(), gen_random_uuid(), 'cancelled') $$, '42501', null, 'nor write history directly');
select throws_ok($$ update public.itar_requests set status = 'cancelled' $$, '42501', null, 'nor change a request directly');
select throws_ok($$ select * from public.itar_item_results $$, '42501', null, 'nor read the item results');
set local role anon;
select throws_ok($$ select * from public.itar_requests $$, '42501', null, 'anon cannot read the table');
select throws_ok($$ select public.app_itar_my_role() $$, '42501', null, 'anon cannot call the RPCs');
set local role authenticated;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.app_itar_my_role() $$, '42501', 'กรุณาเข้าสู่ระบบ', 'a caller without a session is refused');
select set_config('request.jwt.claims', pg_temp.sub(10), true);
select throws_ok($$ select public.app_itar_my_role() $$, null, null, 'a lab-only account cannot use the module');
select throws_ok($$ select public.app_itar_list_mine() $$, null, null, 'nor list requests');

-- 10. การมองเห็น + รายการ + บทบาท ----------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is((select count(*)::int from public.app_itar_list_mine()), 1, 'REQ2 only sees r7 (IT filed it for him; he is the subject)');
select is((select is_requester from public.app_itar_list_mine() limit 1), false, 'marked as not filed by him');
select is((select needs_my_ack from public.app_itar_list_mine() limit 1), false, 'and not waiting for his acknowledgement (it was rejected)');
select is(public.app_itar_get_detail(current_setting('t.r7')::uuid) ->> 'status', 'rejected', 'the subject can open the detail of the request about him');
select set_config('request.jwt.claims', pg_temp.sub(14), true);
select is(pg_temp.try(format($$ select public.app_itar_get_detail('%s') $$, current_setting('t.r6'))), '42501: ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'an employee of the same department as the person without account cannot see r6');
select is((select count(*)::int from public.app_itar_list_mine()), 0, 'and has no request of his own');
select is(pg_temp.try($$ select public.app_itar_list_it() $$), '42501: เฉพาะทีม IT เท่านั้นที่ดูรายการงานทั้งหมดได้', 'only the IT team lists all requests');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.st(current_setting('t.r7')::uuid), 'rejected', 'the department manager sees the requests of the own department');
select is(pg_temp.try(format($$ select public.app_itar_get_detail('%s') $$, current_setting('t.r6'))), '42501: ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'but not those of another department');
select is((select count(*)::int from public.app_itar_list_mine()), 2, 'his own list holds r2 (he filed) and r9 (his own new request)');
select is((select count(*)::int from public.app_itar_list_pending_approvals()), 0, 'nothing is waiting for him');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is((select count(*)::int from public.app_itar_list_mine()), 2, 'REQ1 sees r1 (his own) and r2 (about him)');
select is((select string_agg(is_requester::text, ',' order by doc_no) from public.app_itar_list_mine()), 'true,false', 'with the flag telling which one he filed');
select ok(pg_temp.st(current_setting('t.r2')::uuid) = 'done', 'the subject sees the revoke request about him');
select ok(public.app_itar_get_detail(current_setting('t.r1')::uuid)::text !~* '(password|secret|cipher|licen[sc]e)', 'the detail document holds no secret or password key');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'policy' ->> 'version', 'IT08-01/1', 'the detail carries the policy version');
select is(public.app_itar_my_role() ->> 'can_file_for_others', 'false', 'a plain employee cannot file for others');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itar_my_role() ->> 'can_file_for_others', 'true', 'a department manager can (revoke_all)');
select is(public.app_itar_my_role() ->> 'is_dept_approver', 'true', 'and is flagged as department approver');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is((public.app_itar_my_role() ->> 'is_it_admin') || ',' || (public.app_itar_my_role() ->> 'is_it_approver') || ',' || (public.app_itar_my_role() ->> 'is_it_viewer') || ',' || (public.app_itar_my_role() ->> 'is_itas_admin'), 'true,true,false,true', 'the IT admin flags (admin, approver, not viewer, itas admin)');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is((public.app_itar_my_role() ->> 'is_it_admin') || ',' || (public.app_itar_my_role() ->> 'is_itas_admin'), 'true,false', 'the other IT admin is not an itas admin');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is((public.app_itar_my_role() ->> 'is_it_viewer') || ',' || (public.app_itar_my_role() ->> 'is_it_admin'), 'true,false', 'the IT head is a viewer only');
select is((select count(*)::int from public.app_itar_list_it()), 12, 'the IT head sees every request (read only)');
select is(pg_temp.st(current_setting('t.r8')::uuid), 'awaiting_ack', 'and can open any of them');
select ok(public.app_itar_get_detail(current_setting('t.r8')::uuid) -> 'allowed_actions' = '[]'::jsonb, 'but is offered no action on a waiting-for-acknowledgement request');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is((select count(*)::int from public.app_itar_list_it()), 12, 'the IT admin sees the twelve requests of the test (nine + three)');
select is((select doc_no from public.app_itar_list_it() limit 1), pg_temp.doc(current_setting('t.c3')::uuid), 'requests waiting for IT (approved / in progress) come first');
select is(public.app_itar_pending_count(), 0, 'nothing is waiting for the IT approver any more');
select is((select string_agg(s.employee_no || ':' || s.is_itas_admin::text, ',' order by s.employee_no) from public.app_itar_list_staff() s where s.employee_no like 'AR-%'), 'AR-ADM:true,AR-HEAD:false,AR-ITONLY:false', 'the IT team list tells who may apply');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try($$ select public.app_itar_list_staff() $$), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูรายชื่อทีม IT ได้', 'a plain employee cannot list the IT team');
select is(public.app_itar_get_detail(current_setting('t.r1')::uuid) -> 'allowed_actions' = '[]'::jsonb, true, 'a finished request offers no action to its subject');

-- 11. เลขที่เอกสาร -------------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try($$ select public.app_itar_get_doc_counter() $$), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ดูตัวนับเลขที่เอกสารได้', 'a plain employee cannot read the counter');
select is(pg_temp.try($$ select public.app_itar_set_next_doc_seq(100) $$), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ตั้งเลขที่เอกสารถัดไปได้', 'nor set the next number');
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select is(public.app_itar_get_doc_counter() ->> 'last_seq', '12', 'twelve numbers were used');
select is(public.app_itar_get_doc_counter() ->> 'next_doc_no', 'IT08-01-' || pg_temp.yy() || '/013', 'the next number follows');
select is(pg_temp.try($$ select public.app_itar_set_next_doc_seq(0) $$), '23514: เลขถัดไปต้องเป็นจำนวนเต็ม 1 ถึง 9999', 'the number must be 1 to 9999');
select is(pg_temp.try($$ select public.app_itar_set_next_doc_seq(5) $$), '23514: ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง 12, เลขถัดไปต้องไม่น้อยกว่า 13)', 'the number cannot go back');
select is(pg_temp.try($$ select public.app_itar_set_next_doc_seq(100, 2020) $$), '23514: ตั้งเลขได้เฉพาะปีนี้หรือปีหน้า', 'only this year or next year can be set');
select is(public.app_itar_set_next_doc_seq(100) ->> 'next_doc_no', 'IT08-01-' || pg_temp.yy() || '/100', 'the next number can be moved forward (continuing the paper register)');
select is(pg_temp.try($$ select public.app_itar_set_next_doc_seq(99) $$), '23514: ตั้งเลขถอยหลังหรือซ้ำเลขที่ใช้แล้วไม่ได้ (เลขที่ใช้ไปแล้วถึง 99, เลขถัดไปต้องไม่น้อยกว่า 100)', 'and never back again');
select set_config('request.jwt.claims', pg_temp.sub(13), true);
select set_config('t.n100', pg_temp.mk('change', 'ทดสอบเลข', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb), true);
select is(pg_temp.doc(current_setting('t.n100')::uuid), 'IT08-01-' || pg_temp.yy() || '/100', 'the next request gets the number that was set');
select lives_ok(format($$ select public.app_itar_cancel('%s', 'ใช้ทดสอบเลข') $$, current_setting('t.n100')), 'cancelled again');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_admin_log where action = 'doc_seq_set' and not is_test), 1, 'the number change is written to the admin log');
select throws_ok($$ update public.itar_admin_log set detail = '{}' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the admin log cannot be changed');
select is((select year_ce::text || ':' || seq_no::text || ':' || doc_no from private.itar_next_doc_no(false, '2090-12-31 16:59:59+00')), '2090:1:IT08-01-90/001', '23:59:59 Thai time on 31/12 is still the old year');
select is((select year_ce::text || ':' || seq_no::text || ':' || doc_no from private.itar_next_doc_no(false, '2090-12-31 17:00:00+00')), '2091:1:IT08-01-91/001', 'midnight Thai time starts the new year at 001');
select is((select doc_no from private.itar_next_doc_no(true, '2090-12-31 17:00:01+00')), 'TEST-IT08-01-91/001', 'the test counter is separate and prefixed TEST-');
select is(private.itar_format_doc_no(false, 2026, 1000), 'IT08-01-26/1000', 'numbers above 999 are shown in full');

-- 12. โหมดทดสอบ + ล้างข้อมูลทดสอบ ----------------------------------------
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-AR-STAFF', 'ทดสอบ', 'ผู้ยื่น ZRA', 'sbx-ar-staff@sandbox.local', (select id from public.departments where code = 'ZRA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-AR-MGR', 'ทดสอบ', 'ผจก. ZRA', 'sbx-ar-mgr@sandbox.local', (select id from public.departments where code = 'ZRA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('t.real_requests', (select count(*)::text from public.itar_requests where not is_test), true));
select count(set_config('t.real_events', (select count(*)::text from public.itar_events where not is_test), true));
select count(set_config('t.real_users', (select count(*)::text from public.itua_users where not is_test), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin enters the test mode as the IT admin persona');
select is(public.app_itar_my_role() ->> 'is_test', 'true', 'the module recognizes the test mode');
select is(public.app_itar_my_role() ->> 'is_itas_admin', 'true', 'the IT admin persona is in itas_admins (test mode)');
select lives_ok($$ select public.app_itua_save_folder('TF', 'โฟลเดอร์ทดสอบ', null, 10) $$, 'a test folder is created in the test register');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_ar_staff')::uuid) $$, 'switching to the requester persona');
select set_config('t.t1', pg_temp.mk('new', 'ทดลองในโหมดทดสอบ', '[{"kind":"folder","target":"TF","to":"R"}]'::jsonb, '{"division": "office"}'::jsonb), true);
select is(pg_temp.doc(current_setting('t.t1')::uuid), 'TEST-IT08-01-' || pg_temp.yy() || '/001', 'a test request gets a TEST- number from its own counter');
select is(public.app_itar_get_detail(current_setting('t.t1')::uuid) ->> 'is_test', 'true', 'the request is flagged as a test request');
select is(pg_temp.st(current_setting('t.t1')::uuid), 'pending_dept', 'the test department manager persona is the approver of the department');
select is(pg_temp.try(format($$ select public.app_itar_get_detail('%s') $$, current_setting('t.r1'))), '42501: ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a persona cannot see a real request');
select is((select count(*)::int from public.app_itar_list_mine()), 1, 'the persona sees only test requests');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_ar_mgr')::uuid) $$, 'switching to the manager persona');
select is(public.app_itar_pending_count(), 1, 'the persona manager has the test request pending');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.t1')), 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona (admin + approver + itas admin)');
select is((select count(*)::int from public.app_itar_list_pending_approvals()), 1, 'the IT approver persona sees only the test request');
select lives_ok(format($$ select public.app_itar_approve('%s') $$, current_setting('t.t1')), 'the IT approver persona approves');
select lives_ok(format($$ select public.app_itar_start('%s') $$, current_setting('t.t1')), 'the IT admin persona takes the work');
select is(pg_temp.try(format($$ select public.app_itar_start('%s') $$, current_setting('t.c3'))), '23514: ไม่พบใบขอสิทธิ์นี้', 'a persona cannot touch a real request');
select is(pg_temp.try(format($$ select public.app_itar_apply('%s', '[]'::jsonb) $$, current_setting('t.c3'))), '23514: ไม่พบใบขอสิทธิ์นี้', 'nor apply one');
select is((select count(*)::int from public.app_itar_list_it()), 1, 'the IT list in test mode holds the test request only');
select set_config('t.t1res', public.app_itar_apply(current_setting('t.t1')::uuid, pg_temp.decide_all(current_setting('t.t1')::uuid), null, '{"auth_id": "sbx.user"}'::jsonb)::text, true);
select is(current_setting('t.t1res')::jsonb ->> 'status', 'awaiting_ack', 'the test request is applied in the test register');
select is(jsonb_array_length(public.app_itua_list_users('sbx.user') -> 'items'), 1, 'the new user exists in the test register');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_ar_staff')::uuid) $$, 'back to the requester persona');
select lives_ok(format($$ select public.app_itar_acknowledge('%s') $$, current_setting('t.t1')), 'the requester persona acknowledges (he is the subject)');
select is(pg_temp.st(current_setting('t.t1')::uuid), 'done', 'the test request is done');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(format($$ select public.app_itar_get_detail('%s') $$, current_setting('t.t1'))), '42501: ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'a real user cannot see a test request');
select is((select count(*)::int from public.app_itar_list_it()), 13, 'real lists never include test requests');
select is(jsonb_array_length(public.app_itua_list_users('sbx.user') -> 'items'), 0, 'the real register does not hold the test user');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_requests where not is_test), current_setting('t.real_requests')::int, 'the real requests are unchanged by the test mode');
select is((select count(*)::int from public.itar_events where not is_test), current_setting('t.real_events')::int, 'so are the real events');
select is((select count(*)::int from public.itua_users where not is_test), current_setting('t.real_users')::int, 'and the real register users');
select is((select last_seq::int from public.itar_doc_counters where is_test and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), 1, 'the test counter is separate');
select ok(not exists (select 1 from public.itar_events e join public.itar_requests r on r.id = e.request_id where e.is_test <> r.is_test), 'test events never mix with real requests');
select ok(exists (select 1 from public.itua_acknowledgements a where a.is_test and a.request_id = current_setting('t.t1')::uuid), 'the test acknowledgement is flagged as test');
select is((select count(*)::int from public.itua_log where source_request_id = current_setting('t.t1')::uuid and is_test), (select count(*)::int from public.itua_log where source_request_id = current_setting('t.t1')::uuid), 'the register history of the test apply is test history');

-- 12b. ล้างข้อมูลทดสอบ ---------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select public.app_sandbox_purge_itar() $$, null, 'NOT_AUTHORIZED', 'a normal user cannot purge');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_sandbox_purge_itar() $$, null, 'SANDBOX_NOT_ACTIVE', 'the purge only works from inside the test mode');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_ar_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itar() ->> 'deleted')::int, 11, 'the purge deletes every test row of the module (2 counters, 1 request, 1 item, 1 result, 6 events)');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itar_requests where is_test) + (select count(*)::int from public.itar_events where is_test) + (select count(*)::int from public.itar_request_items where is_test) + (select count(*)::int from public.itar_item_results where is_test) + (select count(*)::int from public.itar_comments where is_test) + (select count(*)::int from public.itar_attachments where is_test) + (select count(*)::int from public.itar_admin_log where is_test) + (select count(*)::int from public.itar_doc_counters where is_test), 0, 'no test row is left in any of the eight tables');
select is((select count(*)::int from public.itar_requests where not is_test), current_setting('t.real_requests')::int, 'the real requests survived the purge');
select is((select count(*)::int from public.itar_events where not is_test), current_setting('t.real_events')::int, 'and the real events');
select is((select count(*)::int from public.itar_item_results where not is_test), 14, 'and the real item results');
select is((select count(*)::int from public.itar_admin_log where not is_test), 1, 'and the real admin log');
select is((select count(*)::int from public.itua_users where is_test and auth_id = 'sbx.user'), 1, 'the purge of this module does not touch the register (that has its own purge)');
select is((select count(*)::int from public.audit_logs where action = 'ITAR_SANDBOX_PURGE'), 1, 'the purge is written to the audit log');
select is(current_setting('itar.purge', true), 'off', 'the purge flag is switched off again');
select throws_ok($$ delete from public.itar_events where id = (select min(id) from public.itar_events) $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real history still cannot be deleted after a purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select set_config('t.t3', pg_temp.mk('change', 'หลังล้าง', '[{"kind":"folder","target":"TF","from":"R","to":"F"}]'::jsonb), true);
select is(pg_temp.doc(current_setting('t.t3')::uuid), 'TEST-IT08-01-' || pg_temp.yy() || '/001', 'after the purge the test numbering starts again at 001');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode at the end');
reset role;
select set_config('request.jwt.claims', '', true);

-- 12c. ใบที่ไม่มีผู้อนุมัติขั้น IT อนุมัติได้ต้องถูกปฏิเสธตอนยื่น + ตอนยื่นไม่เปิดให้เดาว่าอีเมลใดมีในทะเบียน ------------
-- ตัวช่วย: ลองยื่นจริงแล้วย้อนกลับเสมอ (subtransaction) ได้ 'OK' ถ้ายื่นผ่าน จึงไม่ทิ้งใบ/เลขที่เอกสารไว้กระทบข้อมูลอื่น
create function pg_temp.probe(p_sql text) returns text language plpgsql as $$
begin
  begin
    execute p_sql;
    raise exception 'probe_ok';
  exception when others then
    if sqlerrm = 'probe_ok' then return 'OK'; end if;
    return sqlstate || ': ' || sqlerrm;
  end;
end $$;
select count(set_config('t.n_before', (select count(*)::text from public.itar_requests), true));
select count(set_config('t.seq_before', (select last_seq::text from public.itar_doc_counters where not is_test and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), true));

-- ข้อ 3: อีเมลที่มีในทะเบียนของคนอื่น พนักงานทั่วไปเช็กไม่ได้ (ยื่นผ่าน) · ผู้ดูแลงาน IT เช็กทั้งทะเบียน
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(12), true);
select is(pg_temp.probe($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"old.user@itar.test","to":"add","email_kind":"extra"}]'::jsonb) $$), 'OK', 'a plain employee asking for an address that belongs to someone else is not told that it exists (no oracle)');
select is(pg_temp.probe($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"fresh.one@itar.test","to":"add","email_kind":"extra"}]'::jsonb) $$), 'OK', 'a brand-new address is accepted (control)');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.probe($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"email","target":"old.user@itar.test","to":"add","email_kind":"extra"}]'::jsonb) $$), '23514: อีเมล old.user@itar.test: ที่อยู่นี้ถูกใช้งานอยู่ในทะเบียนแล้ว', 'the IT admin is checked against the whole register');

-- ข้อ 1: ผู้อนุมัติขั้น IT ที่อนุมัติได้จริง
select is(pg_temp.probe($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$), 'OK', 'the IT approver filing for himself is accepted while the IT head is active (control)');
select is(pg_temp.probe(format($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb, '{"employee_id": "%s"}'::jsonb) $$, current_setting('t.e_ar_head'))), '23514: ใบนี้ไม่มีผู้อนุมัติขั้น IT ที่อนุมัติได้ (ไม่มีผู้อนุมัติที่ใช้งานอยู่ หรือผู้อนุมัติเป็นผู้ยื่นหรือผู้รับสิทธิ์ของใบนี้เอง) กรุณาให้ผู้ดูแลงาน IT คนอื่นยื่นแทน หรือติดต่อหัวหน้า IT', 'the IT approver filing for the only IT head is refused (the head cannot approve his own request)');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(pg_temp.probe(format($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$)), 'OK', 'the IT head filing for himself is accepted (the IT approver approves, control)');
reset role;
select set_config('request.jwt.claims', '', true);
update public.itwo_staff set is_it_viewer = false, is_it_admin = true where employee_id = pg_temp.e('AR-HEAD');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$), '23514: ใบนี้ไม่มีผู้อนุมัติขั้น IT ที่อนุมัติได้ (ไม่มีผู้อนุมัติที่ใช้งานอยู่ หรือผู้อนุมัติเป็นผู้ยื่นหรือผู้รับสิทธิ์ของใบนี้เอง) กรุณาให้ผู้ดูแลงาน IT คนอื่นยื่นแทน หรือติดต่อหัวหน้า IT', 'with no active IT head, a request of the IT approver is refused at filing instead of waiting forever');
select set_config('request.jwt.claims', pg_temp.sub(12), true);
select is(pg_temp.probe($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$), 'OK', 'an ordinary request is still accepted without an IT head (the IT approver can approve it)');
reset role;
select set_config('request.jwt.claims', '', true);
update public.itwo_staff set is_it_viewer = true, is_it_admin = false where employee_id = pg_temp.e('AR-HEAD');
update public.itwo_staff set is_it_approver = false where employee_id = pg_temp.e('AR-ADM');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(12), true);
select is(pg_temp.try($$ select pg_temp.mk('change', 'เหตุผล', '[{"kind":"internet","to":true,"note":"x"}]'::jsonb) $$), '23514: ใบนี้ไม่มีผู้อนุมัติขั้น IT ที่อนุมัติได้ (ไม่มีผู้อนุมัติที่ใช้งานอยู่ หรือผู้อนุมัติเป็นผู้ยื่นหรือผู้รับสิทธิ์ของใบนี้เอง) กรุณาให้ผู้ดูแลงาน IT คนอื่นยื่นแทน หรือติดต่อหัวหน้า IT', 'an ordinary request is refused at filing when nobody is an active IT approver');
reset role;
select set_config('request.jwt.claims', '', true);
update public.itwo_staff set is_it_approver = true where employee_id = pg_temp.e('AR-ADM');
select is((select count(*)::int from public.itar_requests), current_setting('t.n_before')::int, 'no request was left behind by the probes or by the refusals');
select is((select last_seq::text from public.itar_doc_counters where not is_test and doc_year = extract(year from now() at time zone 'Asia/Bangkok')::int), current_setting('t.seq_before'), 'and no document number was used');
select is((select string_agg(s.employee_no || ':' || st.is_it_admin::text || ':' || st.is_it_approver::text || ':' || st.is_it_viewer::text, ',' order by s.employee_no) from public.itwo_staff st join public.employees s on s.id = st.employee_id where s.employee_no in ('AR-ADM', 'AR-HEAD')), 'AR-ADM:true:true:false,AR-HEAD:false:false:true', 'the IT roles used by this section are restored');

-- 13. สิ่งที่ไม่ถูกแตะ -------------------------------------------------------
select is((select count(*)::text from public.itwo_staff), (current_setting('t.itwo_staff_before')::int + 3)::text, 'itwo_staff holds only the three rows this test added (the module never wrote to it)');
select is((select count(*)::int from public.itrp_requests), current_setting('t.itrp_before')::int, 'no repair request was created or touched');

select * from finish();
rollback;
