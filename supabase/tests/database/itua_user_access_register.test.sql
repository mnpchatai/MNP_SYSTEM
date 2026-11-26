-- ทดสอบทะเบียนสิทธิ์ผู้ใช้ (20270105010000_itua_user_access_register.sql) — ส่วนฐานข้อมูลของโมดูล itua (ขั้นที่ 1: ทะเบียน)
--   1) โครงสร้าง: 8 ตาราง RLS/ไม่มี grant/trigger/ลงทะเบียนโหมดทดสอบ, RPC ทุกตัว SECURITY DEFINER + anon เรียกไม่ได้, ไม่มีคอลัมน์ที่เก็บรหัสผ่านได้, seed โปรแกรม 8 + 8
--   2) สิทธิ์: เฉพาะผู้อยู่ใน itas_admins (allowlist ของทะเบียนอุปกรณ์) — it_admin ของใบสั่งงาน IT / ผจก. / พนักงาน / admin ของระบบที่ไม่อยู่ในรายชื่อ / anon เรียกไม่ได้ทุก RPC
--   3) รายการโฟลเดอร์/โปรแกรม: เพิ่ม/แก้ (ต้องมีเหตุผลเมื่อแก้) ปิดใช้งาน ไม่มีทางลบ
--   4) ผู้ใช้: เพิ่ม/แก้ตรวจรูปแบบ, Auth. Name ซ้ำไม่ได้, แก้ชนกัน, ผูกพนักงาน, เปลี่ยนสถานะ + ผู้ใช้ที่ลาออกเพิ่มสิทธิ์ไม่ได้
--   5) สิทธิ์: set_grants เป็นชุดเดียว atomic (ผิดข้อเดียว = ไม่เปลี่ยนอะไร), ค่าเดิมต้องตรงกับฐาน, OTHER ต้องมีหมายเหตุ, ปิดใช้งานเพิ่มไม่ได้แต่ถอนได้
--   6) อีเมล: ภายใน 1 ต่อคน, ที่อยู่ซ้ำไม่ได้, ปิดได้ลบไม่ได้, ปิดแล้วเปิดใหม่ไม่ได้
--   7) อ่าน: list/matrix/get_user (ค้น/กรอง/นับ R-F/ประวัติ/รับทราบ)
--   8) ISO: log เขียนโดย trigger ทุกการเปลี่ยน (ผู้ทำ เหตุผล ค่าเดิม→ใหม่) แก้/ลบ/truncate log และรับทราบไม่ได้ ลบข้อมูลทะเบียนไม่ได้ แก้โดยตรงต้องมีผู้ทำและเหตุผล
--   9) โหมดทดสอบ: แยกผู้ใช้/โฟลเดอร์/โปรแกรม, persona แตะของจริงไม่ได้, ล้างข้อมูลทดสอบไม่แตะของจริงและ seed โปรแกรมทดสอบกลับ
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITU-*) · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT · SBX-IT-ADMIN อยู่ใน itas_admins (โหมดทดสอบ)
begin;

create extension if not exists pgtap with schema extensions;
select plan(359);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
-- claims ของผู้ใช้ทดสอบเลขที่ n
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1a600000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
-- ลองรันคำสั่ง: คืน 'OK' หรือ 'รหัส: ข้อความ'
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- id ของผู้ใช้ทะเบียนจาก Auth. Name (อ่านผ่าน RPC ด้วยสิทธิ์ผู้ดูแล)
create function pg_temp.uid(p_auth text) returns uuid language sql as $$
  select (e ->> 'id')::uuid from jsonb_array_elements(public.app_itua_list_users(p_auth) -> 'items') e where e ->> 'auth_id' = p_auth $$;
create function pg_temp.g(p_auth text) returns jsonb language sql as $$ select public.app_itua_get_user(pg_temp.uid(p_auth)) $$;
create function pg_temp.ts(p_auth text) returns timestamptz language sql as $$ select (pg_temp.g(p_auth) -> 'user' ->> 'updated_at')::timestamptz $$;
-- ระดับสิทธิ์โฟลเดอร์/สถานะของผู้ใช้ในรูปข้อความสั้น ๆ เช่น 'ACC:R,HR:F'
create function pg_temp.fl(p_auth text) returns text language sql as $$
  select coalesce(string_agg((f ->> 'code') || ':' || (f ->> 'level'), ',' order by (f ->> 'code') collate "C"), '') from jsonb_array_elements(pg_temp.g(p_auth) -> 'folders') f $$;
create function pg_temp.pl(p_auth text) returns text language sql as $$
  select coalesce(string_agg(p ->> 'code', ',' order by (p ->> 'code') collate "C"), '') from jsonb_array_elements(pg_temp.g(p_auth) -> 'programs') p $$;
create function pg_temp.codes(p_items jsonb) returns text language sql as $$
  select coalesce(string_agg(e ->> 'auth_id', ',' order by ord), '') from jsonb_array_elements(p_items) with ordinality t(e, ord) $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('itua_users', 'itua_emails', 'itua_folders', 'itua_folder_grants', 'itua_programs', 'itua_program_grants', 'itua_log', 'itua_acknowledgements') and c.relkind = 'r' and c.relrowsecurity), 8, 'RLS is enabled on the eight itua tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name like 'itua\_%' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no direct grant on the itua tables');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itua\_%' and c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, p.priv)), 'no role has any table privilege on the itua tables (checked per privilege)');
select ok(not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itua\_%' and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequences of the itua tables are closed');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itua\_%' and c.relkind = 'S'), 2, 'the two identity sequences exist (log, acknowledgements)');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itua\_%' and p.polname like '%\_no\_direct\_access'), 8, 'every itua table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itua\_%' and p.polname = 'lab_only_no_access' and not p.polpermissive), 8, 'every itua table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itua\_%' and t.tgname like '%\_sandbox\_scope' and not t.tgisinternal), 8, 'every itua table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itua_log', 'itua_acknowledgements') and (t.tgname like '%\_append\_only' or t.tgname like '%\_no\_truncate') and not t.tgisinternal), 4, 'the log and the acknowledgements are append-only (update/delete + truncate triggers)');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itua_users', 'itua_emails', 'itua_folders', 'itua_programs', 'itua_folder_grants', 'itua_program_grants') and t.tgname like '%\_no\_truncate' and not t.tgisinternal), 6, 'no register table can be truncated');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itua_users', 'itua_emails', 'itua_folders', 'itua_programs', 'itua_folder_grants', 'itua_program_grants') and t.tgname like '%\_guard' and not t.tgisinternal), 6, 'every register table has the guard trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itua\_%' and t.tgname like '%\_log' and not t.tgisinternal), 6, 'the history writers are triggers on the six register tables (not RPC code)');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itua_users', 'itua_emails', 'itua_folders', 'itua_folder_grants', 'itua_programs', 'itua_program_grants', 'itua_log', 'itua_acknowledgements']) t), 'the eight new tables are registered in private.sandbox_unguarded_tables()');
select ok(array['itrp_requests', 'itrp_part_changes', 'itwo_work_orders', 'itas_assets', 'itas_vault', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config', 'bom_order_requests', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itrp, itwo, itas, BOM and central)');
select ok(cardinality(array(select t from unnest(private.sandbox_unguarded_tables()) t where t not like 'itua\_%')) >= 80 and cardinality(array(select t from unnest(private.sandbox_unguarded_tables()) t where t like 'itua\_%')) = 8, 'sandbox_unguarded_tables keeps every earlier name and gains exactly the 8 itua names');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itua\_%' or p.proname = 'app_sandbox_purge_itua')), 12, 'the twelve public RPCs exist');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itua\_%' or p.proname = 'app_sandbox_purge_itua')), 'every itua RPC is SECURITY DEFINER with an empty search_path, callable by authenticated and not by anon');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itua\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itua helpers are not callable by anon or authenticated');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itua%'), 'every itua RPC has the lab-only guard');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itua%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.(itwo_|itrp_|itas_)'), 'no itua function writes to any itwo, itrp or itas table');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itua%' and pg_get_functiondef(p.oid) ~* '(pgcrypto|pgp_sym|decrypt|gen_random_bytes|crypt\()'), 'no itua function uses pgcrypto or decrypts anything (the register holds no secret in this step)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itua\_%' or p.proname = 'app_sandbox_purge_itua') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'the itua messages never say "ใบสั่งงาน"');
select ok(not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name like 'itua\_%' and c.column_name ~* '(pass|secret|licen[sc]e|plain|cipher|credential)'), 'no itua table has a column that could hold a password or another secret');
select ok(not exists (select 1 from pg_proc p cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) a(arg) where p.pronamespace = 'public'::regnamespace and p.proname like 'app\_itua\_%' and a.arg ~* '(password|plain|passphrase|secret)'), 'no RPC has a parameter named like a password or a secret');
select ok(position('itua.source_event_id' in pg_get_functiondef('private.itua_log()'::regprocedure)) > 0 and position('itar_events' in pg_get_functiondef('private.itua_log()'::regprocedure)) > 0, 'the log trigger takes the source request only from an applied event of an access request (never from a caller-supplied request id; step 4 replaced the null-only version, see itar_access_requests.test.sql)');
select is((select count(*)::int from public.itua_programs where not is_test), 8, 'the real mode is seeded with 8 programs');
select is((select count(*)::int from public.itua_programs where is_test), 8, 'the test mode is seeded with 8 programs');
select is((select string_agg(code || '=' || name, ',' order by sort) from public.itua_programs where not is_test), 'IPRIME=iPrime,ADOBE=Adobe Design,EXPRESS=Express,PAYROLL=PayRoll & Time Attendance,AUTODESK=Autodesk Software,POWERBI=PowerBI,LINE=Line,OTHER=อื่นๆ', 'the 8 seeded programs in form order');
select is((select count(*)::int from public.itua_programs where created_by is not null or updated_by is not null), 0, 'seeded programs have no author (system rows)');
select is((select count(*)::int from public.itua_log), 0, 'seeding writes no log');
select is((select count(*)::int from public.itua_users) + (select count(*)::int from public.itua_folders) + (select count(*)::int from public.itua_emails), 0, 'nothing is imported: no user, folder or email exists before the tests');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
insert into auth.users (id, email, raw_user_meta_data)
select ('1a600000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itua-' || n || '@test.local', '{}'::jsonb
from generate_series(1, 7) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itua.test', d.id, r.id, ('1a600000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'ITU-ADM', 'MGT', 'staff'),
  (2, 'ITU-ITADM', 'MGT', 'staff'),
  (3, 'ITU-MGR', 'MGT', 'department_manager'),
  (4, 'ITU-STAFF', 'MGT', 'staff'),
  (5, 'ITU-SBXADMIN', 'MGT', 'admin'),
  (6, 'ITU-LINK', 'MGT', 'staff'),
  (7, 'ITU-LINK2', 'MGT', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- ITU-ITADM เป็น it_admin ของใบสั่งงาน IT แต่ไม่อยู่ใน itas_admins · ITU-ADM อยู่ใน itas_admins (โหมดจริง)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, true, false from public.employees e where e.employee_no = 'ITU-ITADM';
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no = 'ITU-ADM';
select count(set_config('test.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'ITU-%';
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. สิทธิ์: ผู้อยู่ใน itas_admins เท่านั้น ------------------------------
create temp table pg_temp_calls (name text, sql text);
insert into pg_temp_calls values
  ('list_users', $$ select public.app_itua_list_users() $$),
  ('get_user', $$ select public.app_itua_get_user('00000000-0000-0000-0000-000000000001') $$),
  ('matrix', $$ select public.app_itua_matrix() $$),
  ('list_catalog', $$ select public.app_itua_list_catalog() $$),
  ('save_user', $$ select public.app_itua_save_user(null, '{"auth_id": "x.y", "name_th": "x", "division": "office"}'::jsonb) $$),
  ('set_status', $$ select public.app_itua_set_status('00000000-0000-0000-0000-000000000001', 'resigned', 'x') $$),
  ('set_grants', $$ select public.app_itua_set_grants('00000000-0000-0000-0000-000000000001', '[{"kind": "internet", "from": false, "to": true}]'::jsonb, 'x') $$),
  ('add_email', $$ select public.app_itua_add_email('00000000-0000-0000-0000-000000000001', 'a@b.co') $$),
  ('close_email', $$ select public.app_itua_close_email('00000000-0000-0000-0000-000000000001', 'x') $$),
  ('save_folder', $$ select public.app_itua_save_folder('ZZ', 'x') $$),
  ('save_program', $$ select public.app_itua_save_program('ZZ', 'x') $$);
grant select on pg_temp_calls to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้', 'an itwo it_admin that is not in itas_admins cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้', 'a department manager cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้', 'a plain employee cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้', 'an MNP admin that is not in itas_admins cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', '', true);
select is(substr(pg_temp.try(c.sql), 1, 5), '42501', 'a caller without a session cannot call ' || c.name) from pg_temp_calls c;
set local role anon;
select throws_ok($$ select public.app_itua_list_users() $$, '42501', null, 'the anon role has no permission to call the RPCs');
select throws_ok($$ select public.app_sandbox_purge_itua() $$, '42501', null, 'anon cannot purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select throws_ok($$ select public.app_sandbox_purge_itua() $$, null, null, 'a plain employee cannot purge');

-- 4. รายการโฟลเดอร์/โปรแกรม -------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'programs'), 8, 'the admin sees the 8 seeded programs');
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'folders'), 0, 'and no folder yet (nothing is seeded)');
select throws_ok($$ select public.app_itua_save_folder('bad code', 'x') $$, '23514', 'รหัสโฟลเดอร์ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_/- ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 30 ตัว', 'a folder code with a space is refused');
select throws_ok($$ select public.app_itua_save_folder('ACC', '   ') $$, '23514', 'กรุณาระบุชื่อโฟลเดอร์', 'a folder needs a name');
select throws_ok($$ select public.app_itua_save_folder('ACC', 'บัญชี', null, 10000) $$, '23514', 'ลำดับต้องเป็นจำนวนเต็ม 0–9999', 'the sort order is bounded');
select throws_ok($$ select public.app_itua_save_folder('ACC', 'บัญชี', null, 10, null) $$, '23514', 'กรุณาระบุสถานะการใช้งานของโฟลเดอร์', 'the active flag cannot be null');
select is(public.app_itua_save_folder(' acc ', 'บัญชี', 'แฟ้มบัญชี', 10) ->> 'created', 'true', 'a folder is created (code is trimmed and upper-cased, no reason needed for a new row)');
select is(public.app_itua_save_folder('HR', 'บุคคล', null, 20) ->> 'created', 'true', 'a second folder');
select is(public.app_itua_save_folder('SHARE', 'ส่วนกลาง', 'ทุกแผนก', 30) ->> 'created', 'true', 'a third folder');
select is(public.app_itua_save_folder('OLD', 'โฟลเดอร์เก่า', null, 40) ->> 'created', 'true', 'a fourth folder (to be closed later)');
select is(public.app_itua_save_folder('ACC', 'บัญชี', 'แฟ้มบัญชี', 10) ->> 'changed', 'false', 'saving the same values again changes nothing (and writes no log)');
select throws_ok($$ select public.app_itua_save_folder('ACC', 'บัญชีและการเงิน', 'แฟ้มบัญชี', 10) $$, '23514', 'กรุณาระบุเหตุผลที่แก้รายการโฟลเดอร์ (บันทึกสำหรับ ISO)', 'editing a folder needs a reason');
select is(public.app_itua_save_folder('ACC', 'บัญชีและการเงิน', 'แฟ้มบัญชี', 10, true, 'ปรับชื่อให้ตรงกับฟอร์ม') ->> 'changed', 'true', 'a folder is renamed with a reason');
select is((select f ->> 'name' from jsonb_array_elements(public.app_itua_list_catalog() -> 'folders') f where f ->> 'code' = 'ACC'), 'บัญชีและการเงิน', 'the new name is stored');
select is((select string_agg(f ->> 'code', ',' order by ord) from jsonb_array_elements(public.app_itua_list_catalog() -> 'folders') with ordinality t(f, ord)), 'ACC,HR,SHARE,OLD', 'folders are listed in sort order');
select is(public.app_itua_save_program('vpn', 'VPN ภายนอก', 90) ->> 'created', 'true', 'a program is added');
select throws_ok($$ select public.app_itua_save_program('VPN', 'VPN ระยะไกล', 90) $$, '23514', 'กรุณาระบุเหตุผลที่แก้รายการโปรแกรม (บันทึกสำหรับ ISO)', 'editing a program needs a reason');
select is(public.app_itua_save_program('VPN', 'VPN ระยะไกล', 90, true, 'เปลี่ยนชื่อ') ->> 'changed', 'true', 'a program is renamed with a reason');
select throws_ok($$ select public.app_itua_save_program('bad code', 'x') $$, '23514', 'รหัสโปรแกรมต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_/- ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 30 ตัว', 'a bad program code is refused');
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'programs'), 9, 'the catalog now has 9 programs');

-- 5. ผู้ใช้ -----------------------------------------------------------------
select throws_ok($$ select public.app_itua_save_user(null, '{"name_th": "ไม่มีรหัส", "division": "office"}'::jsonb) $$, '23514', 'กรุณาระบุ Auth. Name', 'a user needs an Auth. Name');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "name_th": "ไม่มีฝ่าย"}'::jsonb) $$, '23514', 'กรุณาเลือกฝ่าย (สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน InDesign)', 'a user needs a division');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "division": "office"}'::jsonb) $$, '23514', 'กรุณาระบุชื่อ (ไทยหรืออังกฤษอย่างน้อยหนึ่ง)', 'a user needs a name (Thai or English)');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "bad name!", "name_th": "x", "division": "office"}'::jsonb) $$, '23514', 'Auth. Name ต้องเป็นตัวอักษรอังกฤษ ตัวเลข . _ - (ขึ้นต้นและลงท้ายด้วยตัวอักษรหรือตัวเลข ไม่เกิน 60 ตัว) เช่น somchai.k', 'an Auth. Name with a space or symbol is refused');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": ".dot", "name_th": "x", "division": "office"}'::jsonb) $$, '23514', null, 'an Auth. Name cannot start with a dot');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "name_th": "x", "division": "boss"}'::jsonb) $$, '23514', 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)', 'an unknown division is refused');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "name_th": "x", "division": "office", "internet": true}'::jsonb) $$, '23514', 'ไม่รู้จักช่องข้อมูล "internet"', 'internet cannot be set through save_user (only through set_grants)');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "name_th": "x", "division": "office", "status": "resigned"}'::jsonb) $$, '23514', 'ไม่รู้จักช่องข้อมูล "status"', 'status cannot be set through save_user (only through set_status)');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "ok.name", "name_th": "x", "division": "office", "granted_on": "2026-13-45"}'::jsonb) $$, '23514', null, 'a bad grant date is refused');
select throws_ok($$ select public.app_itua_save_user(null, '"not an object"'::jsonb) $$, '23514', 'ข้อมูลที่ส่งมาต้องเป็นรูปแบบ {ช่อง: ค่า}', 'the data must be an object');
select is(public.app_itua_save_user(null, '{"auth_id": "  Somchai.K ", "name_th": "สมชาย ใจดี", "name_en": "Somchai K", "department_code": " ac ", "division": "office", "granted_doc_no": "IT08-01-26/001", "granted_on": "2026-05-04", "note": "หมายเหตุ\nบรรทัดสอง"}'::jsonb) -> 'user' ->> 'auth_id', 'somchai.k', 'a user is created: the Auth. Name is trimmed and lower-cased');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'department_code'), 'AC', 'the department code is upper-cased');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'internet'), 'false', 'a new user has no internet access');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'status'), 'active', 'a new user is active');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'granted_on'), '2026-05-04', 'the grant date is stored');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'created_by_employee_no'), 'ITU-ADM', 'the author is recorded');
select is(public.app_itua_save_user(null, '{"auth_id": "wanna.p", "name_en": "Wanna P", "department_code": "pd", "division": "factory"}'::jsonb) ->> 'created', 'true', 'a user with an English name only is allowed');
select is(public.app_itua_save_user(null, '{"auth_id": "chief.m", "name_th": "หัวหน้า", "division": "manager"}'::jsonb) ->> 'created', 'true', 'a manager-division user');
select is(public.app_itua_save_user(null, '{"auth_id": "desk.id", "name_th": "ออกแบบ", "department_code": "ID", "division": "office_indesign"}'::jsonb) ->> 'created', 'true', 'an InDesign office user');
select throws_ok($$ select public.app_itua_save_user(null, '{"auth_id": "SOMCHAI.K", "name_th": "ซ้ำ", "division": "office"}'::jsonb) $$, '23514', 'Auth. Name somchai.k ซ้ำกับผู้ใช้อื่น', 'the same Auth. Name (any case) cannot be created twice');
select throws_ok($$ select public.app_itua_save_user(pg_temp.uid('somchai.k'), '{"name_th": "แก้"}'::jsonb, 'เหตุผล') $$, '23514', 'ผู้ใช้นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไข (ต้องส่ง expected_updated_at)', 'editing needs the expected_updated_at');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"name_th": "แก้"}'::jsonb, 'เหตุผล', %L) $$, pg_temp.uid('somchai.k'), (pg_temp.ts('somchai.k') - interval '1 second')::text), '40001', 'ข้อมูลผู้ใช้นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale timestamp is a conflict');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"name_th": "แก้ไม่มีเหตุผล"}'::jsonb, null, %L) $$, pg_temp.uid('somchai.k'), pg_temp.ts('somchai.k')::text), '23514', 'กรุณาระบุเหตุผลที่แก้ข้อมูลผู้ใช้ (บันทึกสำหรับ ISO)', 'editing an existing user needs a reason');
select is(public.app_itua_save_user(pg_temp.uid('somchai.k'), '{"name_th": "สมชาย ใจดี"}'::jsonb, null, pg_temp.ts('somchai.k')) ->> 'changed', 'false', 'saving unchanged values needs no reason and writes no log');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"name_en": null}'::jsonb, 'ลบชื่อ', %L) $$, pg_temp.uid('wanna.p'), pg_temp.ts('wanna.p')::text), '23514', 'กรุณาระบุชื่อ (ไทยหรืออังกฤษอย่างน้อยหนึ่ง)', 'a name that is the only one cannot be cleared');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"auth_id": "chief.m"}'::jsonb, 'เปลี่ยนรหัส', %L) $$, pg_temp.uid('wanna.p'), pg_temp.ts('wanna.p')::text), '23514', 'Auth. Name chief.m ซ้ำกับผู้ใช้อื่น', 'renaming into an existing Auth. Name is refused');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"division": null}'::jsonb, 'ล้างฝ่าย', %L) $$, pg_temp.uid('wanna.p'), pg_temp.ts('wanna.p')::text), '23514', 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)', 'the division cannot be cleared');
select is(public.app_itua_save_user(pg_temp.uid('wanna.p'), '{"name_th": "วรรณา พงษ์", "department_code": "pp", "granted_doc_no": "IT08-01-26/002"}'::jsonb, 'ปรับข้อมูลตามทะเบียนกระดาษ', pg_temp.ts('wanna.p')) ->> 'changed', 'true', 'a user is edited with a reason');
select is((pg_temp.g('wanna.p') -> 'user' ->> 'name_th') || '/' || (pg_temp.g('wanna.p') -> 'user' ->> 'department_code'), 'วรรณา พงษ์/PP', 'the edit is stored');
select throws_ok(format($$ select public.app_itua_save_user(%L, %L::jsonb, 'ผูกพนักงาน', %L) $$, pg_temp.uid('chief.m'), jsonb_build_object('employee_id', current_setting('test.p_sbx_it_admin'))::text, pg_temp.ts('chief.m')::text), '23514', 'ไม่พบพนักงานที่จะผูกกับผู้ใช้นี้', 'a test-mode persona cannot be linked from the real mode');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"employee_id": "not-a-uuid"}'::jsonb, 'ผูกพนักงาน', %L) $$, pg_temp.uid('chief.m'), pg_temp.ts('chief.m')::text), '23514', 'รหัสพนักงานที่ผูกต้องเป็น uuid', 'a bad employee id is refused');
select is(public.app_itua_save_user(pg_temp.uid('chief.m'), jsonb_build_object('employee_id', current_setting('test.e_itu_link')), 'ผูกพนักงาน', pg_temp.ts('chief.m')) ->> 'changed', 'true', 'a real employee is linked');
select throws_ok(format($$ select public.app_itua_save_user(%L, %L::jsonb, 'ผูกซ้ำ', %L) $$, pg_temp.uid('desk.id'), jsonb_build_object('employee_id', current_setting('test.e_itu_link'))::text, pg_temp.ts('desk.id')::text), '23514', 'พนักงานคนนี้ถูกผูกกับผู้ใช้อื่นในทะเบียนแล้ว', 'one employee can be linked to one register row only');
select is(public.app_itua_save_user(pg_temp.uid('chief.m'), '{"employee_id": null}'::jsonb, 'ปลดการผูก', pg_temp.ts('chief.m')) ->> 'changed', 'true', 'the link can be removed with a reason');
select throws_ok($$ select public.app_itua_get_user('00000000-0000-0000-0000-000000000001') $$, '23514', 'ไม่พบผู้ใช้นี้', 'an unknown user id is not found');
select throws_ok(format($$ select public.app_itua_get_user(%L, 0) $$, pg_temp.uid('somchai.k')), '23514', 'จำนวนประวัติที่ขอต่อครั้งต้องอยู่ระหว่าง 1–500', 'the log limit is bounded');

-- 6. สิทธิ์ (set_grants) -----------------------------------------------------
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุรายการสิทธิ์ที่จะเปลี่ยนอย่างน้อยหนึ่งรายการ', 'an empty change list is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '{"kind": "folder"}'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุรายการสิทธิ์ที่จะเปลี่ยนอย่างน้อยหนึ่งรายการ', 'the change list must be an array');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": false, "to": true}]'::jsonb, null) $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุเหตุผลที่เปลี่ยนสิทธิ์ (บันทึกสำหรับ ISO)', 'a reason is required');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": false, "to": true}]'::jsonb, '   ') $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุเหตุผลที่เปลี่ยนสิทธิ์ (บันทึกสำหรับ ISO)', 'a blank reason is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, (select jsonb_agg(jsonb_build_object('kind', 'internet', 'from', false, 'to', true)) from generate_series(1, 201)), 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'เปลี่ยนสิทธิ์ได้ครั้งละไม่เกิน 200 รายการ', 'at most 200 changes per call');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "to": "R"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'รายการที่ 1 ต้องมี kind, from และ to (from = ค่าเดิมที่หน้าจอเห็น)', 'every change must carry the old value it saw (from)');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "tape", "from": null, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'รายการที่ 1: kind ต้องเป็น folder, internet หรือ program', 'an unknown kind is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "NOPE", "from": null, "to": "R"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ไม่พบโฟลเดอร์ NOPE', 'an unknown folder is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": null, "to": "W"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โฟลเดอร์ ACC: สิทธิ์ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', 'a level other than R/F is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": null, "to": null}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โฟลเดอร์ ACC: สิทธิ์ใหม่เหมือนเดิม ไม่มีการเปลี่ยนแปลง', 'a no-op change is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": null, "to": "R"}, {"kind": "folder", "code": "acc", "from": null, "to": "F"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โฟลเดอร์ ACC ซ้ำกันในรายการเดียวกัน', 'the same folder twice in one batch is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "NOPE", "from": false, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ไม่พบโปรแกรม NOPE', 'an unknown program is refused');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": "no", "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'อินเทอร์เน็ต: from และ to ต้องเป็น true หรือ false', 'internet takes booleans only');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "OTHER", "from": false, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โปรแกรม OTHER: ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร', 'the OTHER program needs a note');
select is(pg_temp.fl('somchai.k') || '|' || pg_temp.pl('somchai.k') || '|' || (pg_temp.g('somchai.k') -> 'user' ->> 'internet'), '||false', 'so far nothing was granted (every refused call changed nothing)');
-- ชุดเดียวผสม: ข้อสุดท้ายผิด (from ไม่ตรง) → ทั้งชุดไม่เปลี่ยน
select is(pg_temp.try(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": null, "to": "R"}, {"kind": "internet", "from": false, "to": true}, {"kind": "program", "code": "IPRIME", "from": false, "to": true}, {"kind": "folder", "code": "HR", "from": "R", "to": "F"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k'))), '40001: โฟลเดอร์ HR: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale old value in the last item is a conflict (40001)');
select is(pg_temp.fl('somchai.k') || '|' || pg_temp.pl('somchai.k') || '|' || (pg_temp.g('somchai.k') -> 'user' ->> 'internet'), '||false', 'and the earlier good items of that batch were NOT applied (atomic)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.g('somchai.k') -> 'log') l where l ->> 'entity' in ('folder_grant', 'program_grant')), 0, 'and the failed batch left no log row');
-- ชุดดี
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "R"}, {"kind": "folder", "code": "HR", "from": null, "to": "F"}, {"kind": "internet", "from": false, "to": true}, {"kind": "program", "code": "IPRIME", "from": false, "to": true}, {"kind": "program", "code": "OTHER", "from": false, "to": true, "note": "โปรแกรมตัดต่อ"}]'::jsonb, 'ขอสิทธิ์ตามใบ IT08-01-26/001') ->> 'applied', '5', 'a batch of five grants is applied at once');
select is(pg_temp.fl('somchai.k'), 'ACC:R,HR:F', 'the folder levels are stored');
select is(pg_temp.pl('somchai.k'), 'IPRIME,OTHER', 'the programs are stored');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'internet'), 'true', 'the internet flag is set');
select is((select p ->> 'note' from jsonb_array_elements(pg_temp.g('somchai.k') -> 'programs') p where p ->> 'code' = 'OTHER'), 'โปรแกรมตัดต่อ', 'the OTHER note is stored');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": null, "to": "F"}]'::jsonb, 'ชนกัน') $$, pg_temp.uid('somchai.k')), '40001', 'โฟลเดอร์ ACC: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'granting from a stale "none" is a conflict');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": false, "to": true}]'::jsonb, 'ชนกัน') $$, pg_temp.uid('somchai.k')), '40001', 'อินเทอร์เน็ต: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale internet value is a conflict');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "IPRIME", "from": false, "to": true}]'::jsonb, 'ชนกัน') $$, pg_temp.uid('somchai.k')), '40001', 'โปรแกรม IPRIME: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale program value is a conflict');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "OTHER", "from": true, "to": true, "from_note": "ค่าเก่า", "note": "ใหม่"}]'::jsonb, 'ชนกัน') $$, pg_temp.uid('somchai.k')), '40001', 'โปรแกรม OTHER: หมายเหตุปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale program note is a conflict');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "IPRIME", "from": true, "to": true}]'::jsonb, 'ไม่เปลี่ยน') $$, pg_temp.uid('somchai.k')), '23514', 'โปรแกรม IPRIME: สิทธิ์ใหม่เหมือนเดิม ไม่มีการเปลี่ยนแปลง', 'true to true without a note change is a no-op');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "OTHER", "from": true, "to": true, "note": null}]'::jsonb, 'ล้างหมายเหตุ') $$, pg_temp.uid('somchai.k')), '23514', 'โปรแกรม OTHER: ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร', 'the OTHER note cannot be cleared');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "program", "code": "OTHER", "from": true, "to": true, "from_note": "โปรแกรมตัดต่อ", "note": "โปรแกรมตัดต่อวิดีโอ"}]'::jsonb, 'แก้หมายเหตุ') ->> 'applied', '1', 'the note of an existing grant is edited');
select is((select p ->> 'note' from jsonb_array_elements(pg_temp.g('somchai.k') -> 'programs') p where p ->> 'code' = 'OTHER'), 'โปรแกรมตัดต่อวิดีโอ', 'the new note is stored');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "folder", "code": "ACC", "from": "R", "to": "F"}, {"kind": "folder", "code": "HR", "from": "F", "to": null}, {"kind": "program", "code": "IPRIME", "from": true, "to": false}]'::jsonb, 'ปรับสิทธิ์') ->> 'applied', '3', 'a batch that upgrades, revokes and removes');
select is(pg_temp.fl('somchai.k') || '|' || pg_temp.pl('somchai.k'), 'ACC:F|OTHER', 'R became F, the HR grant and the IPRIME grant are gone');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "internet", "from": true, "to": false}]'::jsonb, 'ถอนอินเทอร์เน็ต') ->> 'applied', '1', 'internet is revoked');
select is(public.app_itua_set_grants(pg_temp.uid('wanna.p'), '[{"kind": "folder", "code": "OLD", "from": null, "to": "R"}]'::jsonb, 'ให้สิทธิ์ก่อนปิดโฟลเดอร์') ->> 'applied', '1', 'wanna.p gets the OLD folder while it is still open');
select is(public.app_itua_save_folder('OLD', 'โฟลเดอร์เก่า', null, 40, false, 'เลิกใช้') ->> 'changed', 'true', 'a folder is closed (not deleted)');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "OLD", "from": null, "to": "R"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โฟลเดอร์ OLD: โฟลเดอร์ปิดการใช้งานอยู่ เพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้)', 'a closed folder cannot be granted');
select is(public.app_itua_save_program('VPN', 'VPN ระยะไกล', 90, false, 'เลิกใช้') ->> 'changed', 'true', 'a program is closed');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "VPN", "from": false, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'โปรแกรม VPN: โปรแกรมปิดการใช้งานอยู่ เพิ่มสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้)', 'a closed program cannot be granted');
-- สิทธิ์ที่ให้ไว้ก่อนปิดโฟลเดอร์ ถอนได้หลังปิด (แต่เปลี่ยนระดับไม่ได้)
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "OLD", "from": "R", "to": "F"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('wanna.p')), '23514', 'โฟลเดอร์ OLD: โฟลเดอร์ปิดการใช้งานอยู่ เพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้)', 'a level on a closed folder cannot be changed');
select is(public.app_itua_set_grants(pg_temp.uid('wanna.p'), '[{"kind": "folder", "code": "OLD", "from": "R", "to": null}]'::jsonb, 'ถอนสิทธิ์โฟลเดอร์ที่ปิดแล้ว') ->> 'applied', '1', 'but the grant of a closed folder can be revoked');
select is(pg_temp.fl('wanna.p'), '', 'wanna.p has no folder again');

-- 7. สถานะ: ลาออก -----------------------------------------------------------
select throws_ok(format($$ select public.app_itua_set_status(%L, 'gone', 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'สถานะต้องเป็น ใช้งาน หรือ ลาออก', 'an unknown status is refused');
select throws_ok(format($$ select public.app_itua_set_status(%L, 'resigned', null) $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุเหตุผลที่เปลี่ยนสถานะผู้ใช้ (บันทึกสำหรับ ISO)', 'resigning needs a reason');
select is(public.app_itua_set_status(pg_temp.uid('somchai.k'), 'active', null) ->> 'changed', 'false', 'setting the same status needs no reason and changes nothing');
select is(public.app_itua_add_email(pg_temp.uid('somchai.k'), 'Somchai.K@mnp.example', 'internal') -> 'email' ->> 'address', 'somchai.k@mnp.example', 'an internal email is added (lower-cased)');
select is(public.app_itua_set_status(pg_temp.uid('somchai.k'), 'resigned', 'ลาออก 30/11/2026') -> 'remaining' ->> 'folders', '1', 'resigning reports the grants still left (one folder)');
select is((pg_temp.g('somchai.k') -> 'user' ->> 'status'), 'resigned', 'the user is resigned');
select is(public.app_itua_set_status(pg_temp.uid('somchai.k'), 'resigned', 'อีกครั้ง') ->> 'changed', 'false', 'resigning twice changes nothing');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "HR", "from": null, "to": "R"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)', 'a resigned user cannot get a new folder');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "folder", "code": "ACC", "from": "F", "to": "R"}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)', 'nor change a level');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": false, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)', 'nor internet access');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "program", "code": "LINE", "from": false, "to": true}]'::jsonb, 'เหตุผล') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)', 'nor a program');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'late@mnp.example') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้ที่ลาออกแล้วเพิ่มอีเมลไม่ได้', 'nor an email');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "folder", "code": "ACC", "from": "F", "to": null}, {"kind": "program", "code": "OTHER", "from": true, "to": false}]'::jsonb, 'ถอนสิทธิ์ทั้งหมดตามใบลาออก') ->> 'applied', '2', 'a resigned user can still be revoked');
select is(pg_temp.fl('somchai.k') || '|' || pg_temp.pl('somchai.k'), '|', 'nothing is left');
select throws_ok(format($$ select public.app_itua_set_status(%L, 'active', null) $$, pg_temp.uid('somchai.k')), '23514', 'กรุณาระบุเหตุผลที่เปลี่ยนสถานะผู้ใช้ (บันทึกสำหรับ ISO)', 'reactivating needs a reason too');
select is(public.app_itua_set_status(pg_temp.uid('somchai.k'), 'active', 'กลับเข้าทำงาน') ->> 'changed', 'true', 'a resigned user can be reactivated with a reason');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "folder", "code": "SHARE", "from": null, "to": "R"}]'::jsonb, 'สิทธิ์ใหม่หลังกลับเข้าทำงาน') ->> 'applied', '1', 'and gets grants again');

-- 8. อีเมล -------------------------------------------------------------------
select throws_ok(format($$ select public.app_itua_add_email(%L, 'not an email') $$, pg_temp.uid('somchai.k')), '23514', 'รูปแบบอีเมลไม่ถูกต้อง', 'a malformed address is refused');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'a@b') $$, pg_temp.uid('somchai.k')), '23514', 'รูปแบบอีเมลไม่ถูกต้อง', 'an address without a domain dot is refused');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'a@b.co', 'weird') $$, pg_temp.uid('somchai.k')), '23514', 'ชนิดอีเมลต้องเป็น ภายใน (internal) หรือ อื่น ๆ (extra)', 'an unknown email kind is refused');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'second@mnp.example', 'internal') $$, pg_temp.uid('somchai.k')), '23514', 'ผู้ใช้นี้มีอีเมลภายในที่ใช้งานอยู่แล้ว (ปิดอันเดิมก่อนจึงเพิ่มใหม่ได้)', 'only one active internal email per user');
select is(public.app_itua_add_email(pg_temp.uid('somchai.k'), 'somchai@gmail.example', 'extra', 'อีเมลสำรองตามใบขอ') -> 'email' ->> 'kind', 'extra', 'an extra email is added with a reason');
select is(public.app_itua_add_email(pg_temp.uid('somchai.k'), 'somchai2@gmail.example') -> 'email' ->> 'kind', 'extra', 'extra emails are unlimited (kind defaults to extra)');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'SOMCHAI.K@mnp.example') $$, pg_temp.uid('wanna.p')), '23514', 'อีเมล somchai.k@mnp.example มีผู้ใช้งานอยู่ในทะเบียนแล้ว', 'an active address cannot be used by two users');
select throws_ok(format($$ select public.app_itua_close_email(%L, 'x') $$, '00000000-0000-0000-0000-000000000001'), '23514', 'ไม่พบอีเมลนี้', 'an unknown email id is not found');
select throws_ok(format($$ select public.app_itua_close_email(%L, null) $$, (select (e ->> 'id') from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e where e ->> 'address' = 'somchai2@gmail.example')), '23514', 'กรุณาระบุเหตุผลที่ปิดอีเมล (บันทึกสำหรับ ISO)', 'closing an email needs a reason');
select is(public.app_itua_close_email((select (e ->> 'id')::uuid from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e where e ->> 'address' = 'somchai2@gmail.example'), 'ไม่ใช้แล้ว') ->> 'changed', 'true', 'an email is closed (not deleted)');
select is(public.app_itua_close_email((select (e ->> 'id')::uuid from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e where e ->> 'address' = 'somchai2@gmail.example'), 'อีกครั้ง') ->> 'changed', 'false', 'closing it again changes nothing');
select is(public.app_itua_add_email(pg_temp.uid('wanna.p'), 'somchai2@gmail.example') ->> 'created', 'true', 'a closed address can be used again by someone else (new row)');
select is((select string_agg((e ->> 'address') || '=' || (e ->> 'status'), ',' order by (e ->> 'address') collate "C") from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e), 'somchai.k@mnp.example=active,somchai2@gmail.example=closed,somchai@gmail.example=active', 'the user keeps the closed address in the list (history)');
select is((select e ->> 'address' from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e limit 1), 'somchai.k@mnp.example', 'the active internal email is listed first');
select is(public.app_itua_close_email((select (e ->> 'id')::uuid from jsonb_array_elements(pg_temp.g('somchai.k') -> 'emails') e where e ->> 'kind' = 'internal'), 'เปลี่ยนอีเมลภายใน') ->> 'changed', 'true', 'the internal email is closed');
select is(public.app_itua_add_email(pg_temp.uid('somchai.k'), 'somchai.k@mnp.example', 'internal') ->> 'created', 'true', 'and the same internal address can be added again as a new row');

-- 9. อ่าน: list / matrix / get_user -----------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(public.app_itua_list_users() ->> 'total', '4', 'four users in the register');
select is(pg_temp.codes(public.app_itua_list_users() -> 'items'), 'chief.m,desk.id,somchai.k,wanna.p', 'sorted by Auth. Name');
select is(pg_temp.codes(public.app_itua_list_users('SOMCHAI.K') -> 'items'), 'somchai.k', 'search by Auth. Name ignores case');
select is(pg_temp.codes(public.app_itua_list_users('ใจดี') -> 'items'), 'somchai.k', 'search by Thai name');
select is(pg_temp.codes(public.app_itua_list_users('wanna p') -> 'items'), 'wanna.p', 'search by English name');
select is(pg_temp.codes(public.app_itua_list_users('gmail.example') -> 'items'), 'somchai.k,wanna.p', 'search by an active email address (somchai2@gmail.example is active for wanna.p)');
select is(pg_temp.codes(public.app_itua_list_users('%') -> 'items'), '', 'search treats % literally (no wildcard)');
select is(pg_temp.codes(public.app_itua_list_users(null, 'ac') -> 'items'), 'somchai.k', 'filter by department (any case)');
select is(pg_temp.codes(public.app_itua_list_users(null, null, 'factory') -> 'items'), 'wanna.p', 'filter by division');
select is(pg_temp.codes(public.app_itua_list_users(null, null, 'office_indesign') -> 'items'), 'desk.id', 'filter by the InDesign division');
select is(pg_temp.codes(public.app_itua_list_users(null, null, null, 'resigned') -> 'items'), '', 'nobody is resigned right now');
select is(public.app_itua_list_users(null, null, null, null, 2, 1) ->> 'total', '4', 'paging keeps the total');
select is(pg_temp.codes(public.app_itua_list_users(null, null, null, null, 2, 1) -> 'items'), 'desk.id,somchai.k', 'and returns the requested page');
select throws_ok($$ select public.app_itua_list_users(null, null, 'boss') $$, '23514', 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)', 'an unknown division filter is refused');
select throws_ok($$ select public.app_itua_list_users(null, null, null, 'gone') $$, '23514', 'สถานะต้องเป็น ใช้งาน หรือ ลาออก', 'an unknown status filter is refused');
select throws_ok($$ select public.app_itua_list_users(null, null, null, null, 0) $$, '23514', 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000', 'the page size is bounded');
select throws_ok($$ select public.app_itua_list_users(null, null, null, null, 10, -1) $$, '23514', 'ตำแหน่งเริ่มต้องไม่ติดลบ', 'the offset cannot be negative');
select is((select (e ->> 'folder_r') || '/' || (e ->> 'folder_f') || '/' || (e ->> 'program_count') || '/' || (e ->> 'internal_email') || '/' || (e ->> 'email_count') from jsonb_array_elements(public.app_itua_list_users('somchai.k') -> 'items') e), '1/0/0/somchai.k@mnp.example/2', 'the list counts R, F, programs and active emails and shows the internal email');
select is(public.app_itua_set_grants(pg_temp.uid('wanna.p'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "F"}, {"kind": "folder", "code": "HR", "from": null, "to": "R"}, {"kind": "folder", "code": "SHARE", "from": null, "to": "R"}]'::jsonb, 'ตั้งต้นสิทธิ์') ->> 'applied', '3', 'wanna.p gets three folders');
select is((select (e ->> 'folder_r') || '/' || (e ->> 'folder_f') from jsonb_array_elements(public.app_itua_list_users('wanna.p') -> 'items') e), '2/1', 'the list shows 2 R and 1 F for wanna.p');
select is((select string_agg(f ->> 'code', ',' order by ord) from jsonb_array_elements(public.app_itua_matrix() -> 'folders') with ordinality t(f, ord)), 'ACC,HR,SHARE', 'the matrix columns are the active folders only (OLD is closed)');
select is((select r -> 'levels' from jsonb_array_elements(public.app_itua_matrix() -> 'rows') r where r ->> 'auth_id' = 'wanna.p'), '{"ACC": "F", "HR": "R", "SHARE": "R"}'::jsonb, 'the matrix row holds the level per folder code');
select is((select r -> 'levels' from jsonb_array_elements(public.app_itua_matrix() -> 'rows') r where r ->> 'auth_id' = 'desk.id'), '{}'::jsonb, 'a user without grants has an empty row');
select is(pg_temp.codes(public.app_itua_matrix('wanna') -> 'rows'), 'wanna.p', 'the matrix honours the same filters');
select is(public.app_itua_matrix() ->> 'total', '4', 'the matrix reports the total');
select is(jsonb_array_length(pg_temp.g('somchai.k') -> 'folders'), 1, 'get_user lists the folders the user has');
select is((pg_temp.g('somchai.k') -> 'folders' -> 0 ->> 'code') || ':' || (pg_temp.g('somchai.k') -> 'folders' -> 0 ->> 'level'), 'SHARE:R', 'with code and level');
select is(jsonb_array_length(public.app_itua_get_user(pg_temp.uid('somchai.k'), 3) -> 'log'), 3, 'the log limit caps the history');
select is((public.app_itua_get_user(pg_temp.uid('somchai.k'), 500) -> 'log' -> 0 ->> 'action') || '/' || (public.app_itua_get_user(pg_temp.uid('somchai.k'), 500) -> 'log' -> 0 ->> 'entity'), 'created/email', 'the log is newest first (the last change was the new internal email)');
select is(jsonb_array_length(pg_temp.g('somchai.k') -> 'acknowledgements'), 0, 'no acknowledgement yet');

-- 10. ISO: ประวัติ + กันแก้/ลบ ------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_log l where l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test) and l.entity = 'user'), 5, 'the user row has five log rows: created, internet on, internet off, resigned, reactivated (the unchanged saves and the grant-only timestamp bumps wrote nothing)');
select is((select string_agg(l.action || ':' || coalesce(l.reason, '-'), ' | ' order by l.id) from public.itua_log l where l.entity = 'user' and l.entity_code = 'somchai.k' and not l.is_test), 'created:- | updated:ขอสิทธิ์ตามใบ IT08-01-26/001 | updated:ถอนอินเทอร์เน็ต | updated:ลาออก 30/11/2026 | updated:กลับเข้าทำงาน', 'user row history: create, internet on, internet off, resign, reactivate — each with its reason');
select is((select count(*)::int from public.itua_log l where l.actor_id <> current_setting('test.e_itu_adm')::uuid), 0, 'every log row names the acting admin');
select ok((select bool_and(l.source_request_id is null and l.source_doc_no is null) from public.itua_log l), 'no log row carries a source request (only app_itar_apply sets one and this test never uses it)');
select is((select (l.old_values ->> 'internet') || '>' || (l.new_values ->> 'internet') from public.itua_log l where l.entity = 'user' and l.entity_code = 'somchai.k' and l.reason = 'ถอนอินเทอร์เน็ต'), 'true>false', 'old and new values are kept');
select is((select count(*)::int from public.itua_log l where l.entity = 'folder_grant' and l.entity_code = 'ACC' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 3, 'folder ACC for somchai.k: created, upgraded R->F, deleted');
select is((select string_agg(l.action, ',' order by l.id) from public.itua_log l where l.entity = 'folder_grant' and l.entity_code = 'ACC' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 'created,updated,deleted', 'in that order');
select is((select (l.old_values ->> 'level') || '>' || (l.new_values ->> 'level') from public.itua_log l where l.entity = 'folder_grant' and l.entity_code = 'ACC' and l.action = 'updated' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 'R>F', 'the upgrade keeps R and F');
select ok((select l.new_values is null and l.old_values ->> 'level' = 'F' and l.reason = 'ถอนสิทธิ์ทั้งหมดตามใบลาออก' from public.itua_log l where l.entity = 'folder_grant' and l.action = 'deleted' and l.entity_code = 'ACC' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 'a revoked grant is logged with the old value, no new value and the reason');
select is((select count(*)::int from public.itua_log l where l.entity = 'program_grant' and l.entity_code = 'OTHER' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 3, 'program OTHER: created, note edited, deleted');
select is((select count(*)::int from public.itua_log l where l.entity = 'folder' and l.entity_code = 'ACC'), 2, 'the catalog edit is logged too: folder ACC created and renamed');
select ok((select l.user_id is null and l.old_values ->> 'name' = 'บัญชี' and l.new_values ->> 'name' = 'บัญชีและการเงิน' and l.reason = 'ปรับชื่อให้ตรงกับฟอร์ม' from public.itua_log l where l.entity = 'folder' and l.entity_code = 'ACC' and l.action = 'updated'), 'with old name, new name and reason (no user attached)');
select is((select count(*)::int from public.itua_log l where l.entity = 'program' and l.entity_code = 'VPN'), 3, 'program VPN: created, renamed, closed');
select is((select count(*)::int from public.itua_log l where l.entity = 'email' and l.entity_code = 'somchai2@gmail.example' and not l.is_test), 3, 'an address: added for somchai.k, closed, added for wanna.p');
select is((select count(*)::int from public.itua_log l where l.entity = 'program' and l.action = 'created' and l.entity_code <> 'VPN'), 0, 'seeding the 8 programs wrote no log');
select is((select count(*)::int from public.itua_log l where l.entity = 'folder' and l.entity_code = 'ACC' and l.action = 'updated' and l.reason is null), 0, 'no update row without a reason');
select throws_ok($$ update public.itua_log set reason = 'แก้ย้อนหลัง' $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the log cannot be edited');
select throws_ok($$ delete from public.itua_log where not is_test $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the log cannot be deleted');
select throws_ok($$ truncate public.itua_log $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the log cannot be truncated');
select throws_ok($$ truncate public.itua_users cascade $$, '42501', 'ทะเบียนสิทธิ์ผู้ใช้ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the users cannot be truncated');
select throws_ok($$ delete from public.itua_users where not is_test $$, '42501', 'ผู้ใช้ในทะเบียนสิทธิ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นลาออกแทน (บันทึกสำหรับ ISO)', 'a user cannot be deleted');
select throws_ok($$ delete from public.itua_emails where not is_test $$, '42501', 'อีเมลในทะเบียนสิทธิ์ลบไม่ได้ ให้ปิดแทน (บันทึกสำหรับ ISO)', 'an email cannot be deleted');
select throws_ok($$ delete from public.itua_folders where not is_test $$, '42501', 'รายการโฟลเดอร์/โปรแกรมลบไม่ได้ ให้ปิดการใช้งานแทน (บันทึกสำหรับ ISO)', 'a folder cannot be deleted');
select throws_ok($$ delete from public.itua_programs where not is_test $$, '42501', 'รายการโฟลเดอร์/โปรแกรมลบไม่ได้ ให้ปิดการใช้งานแทน (บันทึกสำหรับ ISO)', 'a program cannot be deleted');
select throws_ok($$ truncate public.itua_emails $$, '42501', 'อีเมลในทะเบียนสิทธิ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'emails cannot be truncated');
select throws_ok($$ truncate public.itua_folder_grants $$, '42501', 'สิทธิ์โฟลเดอร์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'folder grants cannot be truncated');
select throws_ok($$ truncate public.itua_program_grants $$, '42501', 'สิทธิ์โปรแกรมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'program grants cannot be truncated');
select throws_ok($$ truncate public.itua_folders cascade $$, '42501', 'รายการโฟลเดอร์/โปรแกรมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'folders cannot be truncated');
select throws_ok($$ update public.itua_users set auth_id = 'other.name' where auth_id = 'chief.m' and not is_test $$, '23514', 'ต้องระบุเหตุผลทุกครั้งที่แก้หรือถอดข้อมูลทะเบียนสิทธิ์ผู้ใช้ (บันทึกสำหรับ ISO)', 'even a direct edit by a database administrator needs a reason (fail-closed)');
select throws_ok($$ update public.itua_users set created_by = updated_by, created_at = now() - interval '1 day' where auth_id = 'chief.m' and not is_test $$, '42501', 'รหัสผู้ใช้ โหมด และผู้บันทึกของผู้ใช้ในทะเบียนแก้ไขไม่ได้', 'the author and creation time of a user cannot be changed');
select throws_ok($$ update public.itua_users set id = gen_random_uuid() where auth_id = 'chief.m' and not is_test $$, '42501', 'รหัสผู้ใช้ โหมด และผู้บันทึกของผู้ใช้ในทะเบียนแก้ไขไม่ได้', 'the id of a user cannot be changed');
select throws_ok($$ delete from public.itua_folder_grants where user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test) $$, '42501', 'ไม่ทราบผู้ทำรายการ จึงแก้หรือลบข้อมูลทะเบียนสิทธิ์ผู้ใช้ไม่ได้ (บันทึกสำหรับ ISO)', 'a direct delete of a grant without an actor is refused (fail-closed)');
select set_config('itua.actor_id', current_setting('test.e_itu_adm'), true);
select throws_ok($$ delete from public.itua_folder_grants where user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test) $$, '23514', 'ต้องระบุเหตุผลทุกครั้งที่แก้หรือถอดข้อมูลทะเบียนสิทธิ์ผู้ใช้ (บันทึกสำหรับ ISO)', 'nor without a reason');
select set_config('itua.reason', 'แก้ตรงโดยผู้ดูแลฐานข้อมูล (ทดสอบ)', true);
select lives_ok($$ delete from public.itua_folder_grants where user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test) $$, 'with an actor and a reason a direct revoke goes through');
select is((select l.reason || '/' || l.action from public.itua_log l where l.entity = 'folder_grant' and l.entity_code = 'SHARE' and l.action = 'deleted' and l.user_id = (select id from public.itua_users where auth_id = 'somchai.k' and not is_test)), 'แก้ตรงโดยผู้ดูแลฐานข้อมูล (ทดสอบ)/deleted', 'and that revoke is logged with the reason');
select set_config('itua.actor_id', '', true);
select set_config('itua.reason', '', true);
select throws_ok($$ update public.itua_emails set address = 'changed@mnp.example' where address = 'somchai@gmail.example' and not is_test $$, '42501', 'ที่อยู่อีเมล ชนิด และเจ้าของแก้ไม่ได้ (ให้ปิดแล้วเพิ่มใหม่)', 'an email address cannot be edited');
select throws_ok($$ update public.itua_emails set status = 'active' where address = 'somchai2@gmail.example' and status = 'closed' and not is_test $$, '42501', 'อีเมลที่ปิดแล้วเปิดใหม่ไม่ได้ ให้เพิ่มเป็นรายการใหม่', 'a closed email cannot be reopened');
select throws_ok($$ update public.itua_folders set code = 'XX' where code = 'ACC' and not is_test $$, '42501', 'รหัสและผู้บันทึกของโฟลเดอร์/โปรแกรมแก้ไขไม่ได้', 'a folder code cannot be changed');
select throws_ok($$ update public.itua_programs set code = 'XX' where code = 'LINE' and not is_test $$, '42501', 'รหัสและผู้บันทึกของโฟลเดอร์/โปรแกรมแก้ไขไม่ได้', 'a program code cannot be changed');
select throws_ok($$ insert into public.itua_program_grants (user_id, program_id, is_test, note, created_by, updated_by) select u.id, p.id, false, null, u.created_by, u.created_by from public.itua_users u, public.itua_programs p where u.auth_id = 'wanna.p' and not u.is_test and p.code = 'OTHER' and not p.is_test $$, '23514', 'สิทธิ์โปรแกรม "อื่นๆ" ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร', 'the table itself refuses an OTHER grant without a note');
select throws_ok($$ insert into public.itua_users (auth_id, name_th, division, created_by, updated_by) select 'chief.m', 'ซ้ำ', 'office', created_by, created_by from public.itua_users where auth_id = 'chief.m' and not is_test $$, '23505', null, 'a duplicate Auth. Name is refused by a unique index even on a direct insert');
select throws_ok($$ insert into public.itua_users (auth_id, name_th, division, created_by, updated_by) select 'Upper.Case', 'x', 'office', created_by, created_by from public.itua_users where auth_id = 'chief.m' and not is_test $$, '23514', null, 'an upper-case Auth. Name is refused by a CHECK');
select throws_ok($$ insert into public.itua_users (auth_id, name_th, division, created_by, updated_by) select 'bad.div', 'x', 'space', created_by, created_by from public.itua_users where auth_id = 'chief.m' and not is_test $$, '23514', null, 'an unknown division is refused by a CHECK');
select throws_ok($$ insert into public.itua_folder_grants (user_id, folder_id, is_test, level, created_by, updated_by) select u.id, f.id, false, 'X', u.created_by, u.created_by from public.itua_users u, public.itua_folders f where u.auth_id = 'wanna.p' and not u.is_test and f.code = 'OLD' and not f.is_test $$, '23514', null, 'a level other than R/F is refused by a CHECK');
select throws_ok($$ insert into public.itua_folder_grants (user_id, folder_id, is_test, level, created_by, updated_by) select u.id, f.id, true, 'R', u.created_by, u.created_by from public.itua_users u, public.itua_folders f where u.auth_id = 'wanna.p' and not u.is_test and f.code = 'OLD' and not f.is_test $$, '42501', 'เพิ่มสิทธิ์โฟลเดอร์ไม่ได้: ผู้ใช้ไม่ได้ใช้งานอยู่ (ลาออกแล้วหรืออยู่คนละโหมด)', 'a grant cannot be added across modes (real user, test-mode row) even by a direct insert');
select throws_ok($$ insert into public.itua_acknowledgements (user_id, is_test, acknowledged_by, snapshot, policy_version) select u.id, false, u.created_by, '[]'::jsonb, 'v1' from public.itua_users u where u.auth_id = 'wanna.p' and not u.is_test $$, '23514', null, 'an acknowledgement snapshot must be an object');
select lives_ok($$ insert into public.itua_acknowledgements (user_id, is_test, request_id, acknowledged_by, snapshot, policy_version) select u.id, false, gen_random_uuid(), u.created_by, '{"folders": {"ACC": "F"}, "internet": true}'::jsonb, 'v1' from public.itua_users u where u.auth_id = 'wanna.p' and not u.is_test $$, 'an acknowledgement row can be appended (the RPC arrives in step 4)');
select throws_ok($$ update public.itua_acknowledgements set policy_version = 'v2' $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'an acknowledgement cannot be edited');
select throws_ok($$ delete from public.itua_acknowledgements where not is_test $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้ลบไม่ได้ (บันทึกสำหรับ ISO)', 'an acknowledgement cannot be deleted');
select throws_ok($$ truncate public.itua_acknowledgements $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'acknowledgements cannot be truncated');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(jsonb_array_length(pg_temp.g('wanna.p') -> 'acknowledgements'), 1, 'get_user shows the acknowledgement');
select is((pg_temp.g('wanna.p') -> 'acknowledgements' -> 0 -> 'snapshot' -> 'folders' ->> 'ACC') || '/' || (pg_temp.g('wanna.p') -> 'acknowledgements' -> 0 ->> 'policy_version') || '/' || (pg_temp.g('wanna.p') -> 'acknowledgements' -> 0 ->> 'acknowledged_by_employee_no'), 'F/v1/ITU-ADM', 'with its snapshot, policy version and who acknowledged');
select throws_ok($$ select * from public.itua_users $$, '42501', null, 'an authenticated user cannot read the register table directly');
select throws_ok($$ insert into public.itua_log (is_test, entity, entity_id, action, actor_id, new_values) values (false, 'user', gen_random_uuid(), 'created', gen_random_uuid(), '{}') $$, '42501', null, 'nor write the log directly');

-- 11. โหมดทดสอบ ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select count(set_config('t.real_users', (select count(*)::text from public.itua_users where not is_test), true));
select count(set_config('t.real_log', (select count(*)::text from public.itua_log where not is_test), true));
select count(set_config('t.real_folders', (select count(*)::text from public.itua_folders where not is_test), true));
select count(set_config('t.real_programs', (select count(*)::text from public.itua_programs where not is_test), true));
select count(set_config('t.real_grants', ((select count(*) from public.itua_folder_grants where not is_test) + (select count(*) from public.itua_program_grants where not is_test))::text, true));
select count(set_config('t.real_emails', (select count(*)::text from public.itua_emails where not is_test), true));
select count(set_config('t.real_acks', (select count(*)::text from public.itua_acknowledgements where not is_test), true));
select count(set_config('t.real_admins', (select count(*)::text from public.itas_admins), true));
select count(set_config('t.real_notify', (select count(*)::text from public.notifications), true));
select count(set_config('t.real_somchai', (select id::text from public.itua_users where auth_id = 'somchai.k' and not is_test), true));
select count(set_config('t.real_somchai_ts', (select updated_at::text from public.itua_users where auth_id = 'somchai.k' and not is_test), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'the admin enters the test mode as the IT staff persona (no register rights)');
select throws_ok($$ select public.app_itua_list_users() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้', 'the IT staff persona cannot use the register');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona (in itas_admins)');
select is(public.app_itua_list_users() ->> 'total', '0', 'the test mode starts empty (the real users are invisible)');
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'folders'), 0, 'the real folders are invisible');
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'programs'), 8, 'the test mode has its own 8 seeded programs (the real VPN program is not there)');
select is(jsonb_array_length(public.app_itua_matrix() -> 'folders'), 0, 'the test matrix has no columns');
select throws_ok(format($$ select public.app_itua_get_user(%L) $$, current_setting('t.real_somchai')), '23514', 'ไม่พบผู้ใช้นี้', 'the persona cannot open a real user');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"name_th": "แก้ของจริง"}'::jsonb, 'x', %L) $$, current_setting('t.real_somchai'), current_setting('t.real_somchai_ts')), '23514', 'ไม่พบผู้ใช้นี้ หรือรหัสผู้ใช้ (id) นี้ถูกใช้แล้ว', 'the persona cannot edit a real user (even with the right timestamp)');
select throws_ok(format($$ select public.app_itua_save_user(%L, '{"auth_id": "clash.id", "name_th": "ชนรหัส", "division": "office"}'::jsonb) $$, current_setting('t.real_somchai')), '23514', 'ไม่พบผู้ใช้นี้ หรือรหัสผู้ใช้ (id) นี้ถูกใช้แล้ว', 'the persona cannot create a user with the id of a real user');
select throws_ok(format($$ select public.app_itua_set_grants(%L, '[{"kind": "internet", "from": false, "to": true}]'::jsonb, 'x') $$, current_setting('t.real_somchai')), '23514', 'ไม่พบผู้ใช้นี้', 'the persona cannot change the grants of a real user');
select throws_ok(format($$ select public.app_itua_set_status(%L, 'resigned', 'x') $$, current_setting('t.real_somchai')), '23514', 'ไม่พบผู้ใช้นี้', 'nor the status');
select throws_ok(format($$ select public.app_itua_add_email(%L, 'x@y.co') $$, current_setting('t.real_somchai')), '23514', 'ไม่พบผู้ใช้นี้', 'nor add an email to a real user');
select throws_ok($$ select public.app_itua_close_email((select (e ->> 'id')::uuid from jsonb_array_elements(null::jsonb) e), 'x') $$, '23514', 'ไม่พบอีเมลนี้', 'nor close an email (null id is not found)');
select is(public.app_itua_save_user(null, '{"auth_id": "somchai.k", "name_th": "ทดสอบ สมชาย", "division": "office"}'::jsonb) ->> 'created', 'true', 'the same Auth. Name can exist in the test world');
select is(public.app_itua_save_folder('ACC', 'บัญชี (ทดสอบ)', null, 10) ->> 'created', 'true', 'the same folder code can be created in the test world (separate rows)');
select is(public.app_itua_save_program('VPN', 'VPN ทดสอบ', 90) ->> 'created', 'true', 'and the same program code');
select is(public.app_itua_save_program('IPRIME', 'iPrime (ลองแก้)', 10, true, 'ลองแก้ในโหมดทดสอบ') ->> 'changed', 'true', 'the persona edits a seeded test program');
select is(public.app_itua_set_grants(pg_temp.uid('somchai.k'), '[{"kind": "folder", "code": "ACC", "from": null, "to": "F"}, {"kind": "internet", "from": false, "to": true}, {"kind": "program", "code": "IPRIME", "from": false, "to": true}]'::jsonb, 'ลองในโหมดทดสอบ') ->> 'applied', '3', 'grants work in the test world');
select is(public.app_itua_add_email(pg_temp.uid('somchai.k'), 'somchai.k@mnp.example', 'internal') ->> 'created', 'true', 'the same email address can exist in the test world');
select is(public.app_itua_list_users() ->> 'total', '1', 'one test user');
select is(jsonb_array_length(pg_temp.g('somchai.k') -> 'log'), 5, 'the test user has its own log (created, 3 grants, email)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select throws_ok($$ select public.app_sandbox_purge_itua() $$, null, 'SANDBOX_NOT_ACTIVE', 'the purge needs an active test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_users where not is_test), current_setting('t.real_users')::int, 'the test mode did not add or remove any real user');
select is((select count(*)::int from public.itua_log where not is_test), current_setting('t.real_log')::int, 'nor any real log row');
select is((select count(*)::int from public.itua_users where is_test), 1, 'one test user exists');
select ok((select bool_and(l.is_test) from public.itua_log l where l.user_id = (select id from public.itua_users where is_test)), 'log rows follow the mode of their user');
select is((select updated_at::text from public.itua_users where auth_id = 'somchai.k' and not is_test), current_setting('t.real_somchai_ts'), 'the real somchai.k was not touched');
select is((select name from public.itua_programs where code = 'IPRIME' and is_test), 'iPrime (ลองแก้)', 'the edited test program is in the test world');
select is((select name from public.itua_programs where code = 'IPRIME' and not is_test), 'iPrime', 'and the real IPRIME program is untouched');
select count(set_config('t.test_rows', ((select count(*) from public.itua_users where is_test) + (select count(*) from public.itua_emails where is_test) + (select count(*) from public.itua_folders where is_test) + (select count(*) from public.itua_folder_grants where is_test) + (select count(*) from public.itua_programs where is_test) + (select count(*) from public.itua_program_grants where is_test) + (select count(*) from public.itua_log where is_test) + (select count(*) from public.itua_acknowledgements where is_test))::text, true));
select ok(current_setting('t.test_rows')::int >= 20, 'the test mode left a good number of test rows to purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itua() ->> 'deleted')::int, current_setting('t.test_rows')::int, 'the purge deletes every test row of all eight tables');
select is(jsonb_array_length(public.app_itua_list_catalog() -> 'programs'), 8, 'the purge re-seeds the 8 default programs of the test world');
select is((select e ->> 'name' from jsonb_array_elements(public.app_itua_list_catalog() -> 'programs') e where e ->> 'code' = 'IPRIME'), 'iPrime', 'and the test program definitions are back to the defaults');
select is(public.app_itua_list_users() ->> 'total', '0', 'the test users are gone');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itua_users where is_test) + (select count(*)::int from public.itua_emails where is_test) + (select count(*)::int from public.itua_folders where is_test) + (select count(*)::int from public.itua_folder_grants where is_test) + (select count(*)::int from public.itua_program_grants where is_test) + (select count(*)::int from public.itua_log where is_test) + (select count(*)::int from public.itua_acknowledgements where is_test), 0, 'no test user, email, folder, grant, log or acknowledgement is left');
select is((select count(*)::int from public.itua_programs where is_test), 8, 'the test world has exactly its 8 default programs');
select is((select count(*)::int from public.itua_users where not is_test), current_setting('t.real_users')::int, 'the real users survived the purge');
select is((select count(*)::int from public.itua_log where not is_test), current_setting('t.real_log')::int, 'the real log survived the purge');
select is((select count(*)::int from public.itua_folders where not is_test), current_setting('t.real_folders')::int, 'the real folders survived the purge');
select is((select count(*)::int from public.itua_programs where not is_test), current_setting('t.real_programs')::int, 'the real programs survived the purge');
select is((select count(*)::int from public.itua_folder_grants where not is_test) + (select count(*)::int from public.itua_program_grants where not is_test), current_setting('t.real_grants')::int, 'the real grants survived the purge');
select is((select count(*)::int from public.itua_emails where not is_test), current_setting('t.real_emails')::int, 'the real emails survived the purge');
select is((select count(*)::int from public.itua_acknowledgements where not is_test), current_setting('t.real_acks')::int, 'the real acknowledgements survived the purge');
select throws_ok($$ delete from public.itua_users where not is_test $$, '42501', 'ผู้ใช้ในทะเบียนสิทธิ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นลาออกแทน (บันทึกสำหรับ ISO)', 'real users still cannot be deleted after a purge');
select throws_ok($$ delete from public.itua_log where not is_test $$, '42501', 'ประวัติทะเบียนสิทธิ์ผู้ใช้ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the real log still cannot be deleted after a purge');
select is(current_setting('itua.purge', true), 'off', 'the purge flag is switched off again');
select is((select count(*)::int from public.audit_logs where action = 'ITUA_SANDBOX_PURGE'), 1, 'the purge is recorded in the audit log');
select ok(array['itua_users', 'itua_log'] <@ private.sandbox_unguarded_tables(), 'the register is still listed after the purge');
select is((select count(*)::int from public.itas_admins), current_setting('t.real_admins')::int, 'the purge does not touch the allowlist');
select is((select count(*)::int from public.notifications), current_setting('t.real_notify')::int, 'the register sends no notification at all');
select is(current_setting('itua.actor_id', true), '', 'the actor variable is cleared after every write');

select * from finish();
rollback;
