-- ทดสอบทะเบียนอุปกรณ์ IT (20261221010000_itas_asset_register.sql) — ส่วนฐานข้อมูลของโมดูล itas
--   1) โครงสร้าง: 7 ตาราง RLS/ไม่มี grant/trigger/ลงทะเบียนโหมดทดสอบ, RPC ทุกตัว SECURITY DEFINER + anon เรียกไม่ได้, ไม่มีฟังก์ชันถอดรหัสฝั่งเซิร์ฟเวอร์, seed 23 ชนิด
--   2) สิทธิ์: it_admin เท่านั้น (ผู้อนุมัติขั้น IT / ผจก. / พนักงาน / anon เรียกไม่ได้ทุก RPC)
--   3) ชนิดอุปกรณ์: เพิ่ม/แก้นิยามช่อง กติกาลบ/เปลี่ยนช่องที่มีข้อมูลแล้ว log ลบ/ล้างไม่ได้
--   4) อุปกรณ์: เพิ่ม/แก้/ค้น/กรอง/แบ่งหน้า, ตรวจ attrs ตามนิยามช่อง, ช่องลับรับเฉพาะ envelope ที่ถูกรูป (plaintext ผิดช่อง/envelope ผิดรูป/key ไม่รู้จักถูกปฏิเสธ),
--      ส่งบางช่องลับ = แก้เฉพาะช่องนั้น + null = ลบ, กันแก้ชนกัน, unique ต่อโหมด (ไม่นับ null), log + moves จาก trigger, ลบ/แก้ย้อนหลัง/truncate ไม่ได้, host_overview
--   5) ตู้เซฟ: ตั้งได้ครั้งเดียว, rotate ต้องส่ง rev ปัจจุบัน, ตรวจรูปแบบ/รอบ KDF, log ไม่เก็บ secret, สิทธิ์
--   6) โหมดทดสอบ: แยกชนิด/อุปกรณ์/ตู้เซฟ, persona แตะของจริงไม่ได้, ล้างข้อมูลทดสอบไม่แตะของจริงและ seed ชนิดทดสอบกลับ
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITA-*) · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(429);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
-- claims ของผู้ใช้ทดสอบเลขที่ n
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1a500000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
-- ลองรันคำสั่ง: คืน 'OK' หรือ 'รหัส: ข้อความ' (ใช้เทียบหลายบทบาทพร้อมกัน)
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- envelope ที่รูปแบบถูกต้อง (ไม่ใช่การเข้ารหัสจริง: nonce 12 ไบต์ + ciphertext n ไบต์ซ้ำค่าเดิม) · seed ต่างกัน = ค่าต่างกัน
create function pg_temp.env(p_seed integer, p_bytes integer default 32) returns jsonb language sql as $$
  select jsonb_build_object('v', 1,
    'n', replace(encode(decode(lpad(to_hex(p_seed), 24, '0'), 'hex'), 'base64'), chr(10), ''),
    'c', replace(encode(decode(repeat(lpad(to_hex(p_seed), 2, '0'), p_bytes), 'hex'), 'base64'), chr(10), '')) $$;
create function pg_temp.b64(p_seed integer, p_bytes integer) returns text language sql as $$
  select replace(encode(decode(repeat(lpad(to_hex(p_seed), 2, '0'), p_bytes), 'hex'), 'base64'), chr(10), '') $$;
-- กุญแจที่ห่อ {n 12 ไบต์, c 48 ไบต์}
create function pg_temp.wrap(p_seed integer) returns jsonb language sql as $$
  select jsonb_build_object('n', pg_temp.b64(p_seed, 12), 'c', pg_temp.b64(p_seed, 48)) $$;
create function pg_temp.asset(p_id uuid) returns jsonb language sql as $$ select public.app_itas_get_asset(p_id) $$;
create function pg_temp.ua(p_id uuid) returns timestamptz language sql as $$ select (public.app_itas_get_asset(p_id) ->> 'updated_at')::timestamptz $$;
create function pg_temp.items(p_type text default null, p_search text default null, p_status text default null, p_host text default null) returns jsonb language sql as $$
  select public.app_itas_list_assets(p_type, p_search, p_status, p_host) -> 'items' $$;
create function pg_temp.codes(p_items jsonb) returns text language sql as $$
  select coalesce(string_agg(coalesce(e ->> 'device_code', e ->> 'reg_no', e ->> 'name'), ',' order by ord), '') from jsonb_array_elements(p_items) with ordinality t(e, ord) $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('itas_types', 'itas_type_log', 'itas_assets', 'itas_asset_log', 'itas_asset_moves', 'itas_vault', 'itas_vault_log') and c.relkind = 'r' and c.relrowsecurity), 7, 'RLS is enabled on the seven itas tables');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name like 'itas\_%' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no direct grant on the itas tables');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itas\_%' and c.relkind = 'r' and has_table_privilege(r.rolname, c.oid, p.priv)), 'no role has any table privilege on the itas tables (checked per privilege)');
select ok(not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname like 'itas\_%' and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequences of the itas tables are closed');
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname like 'itas\_%' and c.relkind = 'S'), 4, 'the four identity sequences exist (type log, asset log, moves, vault log)');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itas\_%' and p.polname like '%\_no\_direct\_access'), 7, 'every itas table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname like 'itas\_%' and p.polname = 'lab_only_no_access' and not p.polpermissive), 7, 'every itas table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname like 'itas\_%' and t.tgname like '%\_sandbox\_scope' and not t.tgisinternal), 7, 'every itas table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itas_type_log', 'itas_asset_log', 'itas_asset_moves', 'itas_vault_log') and (t.tgname like '%\_append\_only' or t.tgname like '%\_no\_truncate') and not t.tgisinternal), 8, 'the four logs are append-only (update/delete + truncate triggers)');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itas_types', 'itas_assets', 'itas_vault') and t.tgname like '%\_no\_truncate' and not t.tgisinternal), 3, 'types, assets and vault cannot be truncated');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itas_types', 'itas_assets', 'itas_vault') and t.tgname like '%\_guard' and not t.tgisinternal), 3, 'types, assets and vault have the update/delete guard');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname in ('itas_assets', 'itas_types', 'itas_vault') and t.tgname in ('itas_assets_log', 'itas_assets_moves', 'itas_types_log', 'itas_vault_log') and not t.tgisinternal), 4, 'the history writers are triggers (not RPC code)');
select ok((select bool_and(t = any (private.sandbox_unguarded_tables())) from unnest(array['itas_types', 'itas_type_log', 'itas_assets', 'itas_asset_log', 'itas_asset_moves', 'itas_vault', 'itas_vault_log']) t), 'the seven new tables are registered in private.sandbox_unguarded_tables()');
select ok(array['itrp_requests', 'itrp_devices', 'itrp_history_entry_revisions', 'itwo_work_orders', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itrp, itwo, BOM GR and central)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itas\_%' or p.proname = 'app_sandbox_purge_itas')), 11, 'the eleven public RPCs exist');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itas\_%' or p.proname = 'app_sandbox_purge_itas')), 'every itas RPC is SECURITY DEFINER with an empty search_path, callable by authenticated and not by anon');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname like 'itas\_%' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private itas helpers are not callable by anon or authenticated');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itas%'), 'every itas RPC has the lab-only guard');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itas%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.(itwo_|itrp_)'), 'no itas function writes to any itwo or itrp table');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%itas%' and pg_get_functiondef(p.oid) ~* '(pgcrypto|pgp_sym|decrypt|gen_random_bytes|crypt\()'), 'no itas function decrypts or uses pgcrypto (the server never sees the plaintext of a secret)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itas\_%' or p.proname = 'app_sandbox_purge_itas') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'the itas messages never say "ใบสั่งงาน"');
select ok(not exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('itas_assets', 'itas_types') and c.column_name ~* '(pass|licen[sc]e|plain)'), 'the asset and type tables have no column that could hold a plaintext secret');
select ok(not exists (select 1 from pg_proc p cross join lateral unnest(coalesce(p.proargnames, '{}'::text[])) a(arg) where p.pronamespace = 'public'::regnamespace and (p.proname like 'app\_itas\_%') and a.arg ~* '(password|plain|passphrase|dek|secret_value)'), 'no RPC has a parameter named like a password or a plaintext secret');
select is((select count(*)::int from public.itas_types where not is_test), 23, 'the real mode is seeded with 23 types');
select is((select count(*)::int from public.itas_types where is_test), 23, 'the test mode is seeded with 23 types');
select is((select string_agg(code, ',' order by sort) from public.itas_types where not is_test), 'COMPUTER,LAPTOP,MONITOR,PRINTER,UPS,PSU,MAINBOARD,CPU,RAM,STORAGE,CASE,MOUSE,KEYBOARD,VGA,ROM,LAN_CARD,NETWORK,ACCESSORY,SOFTWARE,INK_TONER,PHONE_SIM,PROJECTOR,OTHER', 'the 23 seeded type codes in sheet order');
select is((select string_agg(code, ',' order by code) from public.itas_types where not is_test and has_device_code), 'COMPUTER,LAPTOP,MONITOR,PRINTER,UPS', 'five types have their own device code (COMnn, laptop name, MNTnn, PRTnn, UPSnn)');
select is((select string_agg(code || ':' || (select string_agg(f ->> 'key', '+' order by f ->> 'key') from jsonb_array_elements(t.fields) f where (f ->> 'secret')::boolean), ' ' order by code) from public.itas_types t where not is_test and exists (select 1 from jsonb_array_elements(t.fields) f where (f ->> 'secret')::boolean)), 'COMPUTER:ip+license_adobe+license_antivirus+license_autodesk+license_office+license_os+license_pdf+mac LAPTOP:license_os SOFTWARE:license', 'only COMPUTER (8), LAPTOP (1) and SOFTWARE (1) have secret fields');
select ok((select bool_and((f ->> 'type') = 'text') from public.itas_types t cross join jsonb_array_elements(t.fields) f where (f ->> 'secret')::boolean), 'every secret field is a text field');
select ok((select bool_and(btrim(f ->> 'label') <> '' and (f ->> 'key') ~ '^[a-z][a-z0-9_]{0,39}$' and (f -> 'order') is not null) from public.itas_types t cross join jsonb_array_elements(t.fields) f), 'every seeded field has a key, a label and an order');
select is((select count(*)::int from public.itas_types t where jsonb_array_length(t.fields) = 0), 0, 'every seeded type has at least one specific field');
select is((select count(*)::int from public.itas_types t where created_by is not null or updated_by is not null), 0, 'seeded types have no author (system rows)');
select is((select count(*)::int from public.itas_type_log), 0, 'seeding writes no type log');
select is((select jsonb_array_length(fields) from public.itas_types where code = 'COMPUTER' and not is_test), 28, 'COMPUTER has 28 fields (20 plain + 8 secret)');
select is((select fields -> 4 ->> 'key' from public.itas_types where code = 'COMPUTER' and not is_test), 'os_bit', 'the fields keep the order of the sheet');
select is((select (fields -> 19) ->> 'type' from public.itas_types where code = 'COMPUTER' and not is_test), 'date', 'started_on is a date field');
select is((select (fields -> 1) ->> 'type' from public.itas_types where code = 'OTHER' and not is_test), 'number', 'OTHER.quantity is a number field');
select is((select count(*)::int from public.itas_assets) + (select count(*)::int from public.itas_vault), 0, 'there is no asset and no vault before the tests (nothing is imported)');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
insert into public.departments (code, name_th, name_en) values ('ZIA', 'แผนกทดสอบ ITA (มีผู้จัดการ)', 'ZI A');
insert into auth.users (id, email, raw_user_meta_data)
select ('1a500000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itas-' || n || '@test.local', '{}'::jsonb
from generate_series(1, 6) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itas.test', d.id, r.id, ('1a500000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'ITA-ADM', 'MGT', 'staff'),
  (2, 'ITA-APPR', 'MGT', 'general_manager'),
  (3, 'ITA-MGR', 'ZIA', 'department_manager'),
  (4, 'ITA-STAFF', 'ZIA', 'staff'),
  (5, 'ITA-SBXADMIN', 'MGT', 'admin'),
  (6, 'ITA-ADM2', 'MGT', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- สิทธิ์ทีม IT อยู่ที่ itwo_staff (itas อ่านอย่างเดียว): ADM/ADM2 = ผู้ดูแลงาน (it_admin) · APPR = ผู้อนุมัติขั้น IT เท่านั้น (ไม่มีสิทธิ์ทะเบียน)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITA-ADM', true, false), ('ITA-APPR', false, true), ('ITA-ADM2', true, false)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
select count(set_config('test.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'ITA-%';
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;

-- 3. สิทธิ์: it_admin เท่านั้น ------------------------------------------
create temp table pg_temp_calls (name text, sql text);
insert into pg_temp_calls values
  ('list_types', $$ select public.app_itas_list_types() $$),
  ('save_type', $$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ') $$),
  ('list_assets', $$ select public.app_itas_list_assets() $$),
  ('get_asset', $$ select public.app_itas_get_asset('00000000-0000-0000-0000-000000000001') $$),
  ('save_asset', $$ select public.app_itas_save_asset(null, 'MONITOR', '{"name": "x"}'::jsonb) $$),
  ('asset_history', $$ select public.app_itas_asset_history('00000000-0000-0000-0000-000000000001') $$),
  ('host_overview', $$ select public.app_itas_host_overview('COM01') $$),
  ('vault_get', $$ select public.app_itas_vault_get() $$),
  ('vault_init', $$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, 'AAAAAAAAAAAAAAAAAAAAAA==', '{}'::jsonb, 600000, 'AAAAAAAAAAAAAAAAAAAAAA==', '{}'::jsonb) $$),
  ('vault_rotate', $$ select public.app_itas_vault_rotate(1, 'change_password') $$);
grant select on pg_temp_calls to authenticated;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'the IT approver (no it_admin right) cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'a department manager cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'a plain employee cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'an MNP admin without an itwo_staff admin row cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', '', true);
select is(substr(pg_temp.try(c.sql), 1, 5), '42501', 'a caller without a session cannot call ' || c.name) from pg_temp_calls c;
reset role;
set local role anon;
select throws_ok($$ select public.app_itas_list_types() $$, '42501', null, 'anon cannot list the types');
select throws_ok($$ select public.app_itas_list_assets() $$, '42501', null, 'anon cannot list the assets');
select throws_ok($$ select public.app_itas_vault_get() $$, '42501', null, 'anon cannot read the vault');
select throws_ok($$ select public.app_itas_save_asset(null, 'MONITOR', '{"name": "x"}'::jsonb) $$, '42501', null, 'anon cannot save an asset');
select throws_ok($$ select public.app_sandbox_purge_itas() $$, '42501', null, 'anon cannot purge');
select throws_ok($$ select count(*) from public.itas_assets $$, '42501', null, 'anon cannot read the asset table directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select count(*) from public.itas_assets $$, '42501', null, 'even it_admin cannot read the asset table directly (RPC only)');
select throws_ok($$ select count(*) from public.itas_vault $$, '42501', null, 'even it_admin cannot read the vault table directly');
select throws_ok($$ insert into public.itas_assets (type_code, name, created_by, updated_by) values ('MONITOR', 'x', current_setting('test.e_ita_adm')::uuid, current_setting('test.e_ita_adm')::uuid) $$, '42501', null, 'even it_admin cannot insert into the asset table directly');
reset role;
select is(jsonb_array_length(public.app_itas_list_types()), 23, 'it_admin lists the 23 seeded types');
select is((public.app_itas_list_types() -> 0) ->> 'code', 'COMPUTER', 'the first type is COMPUTER (sorted by sort)');
select is((public.app_itas_list_types() -> 2) ->> 'asset_count', '0', 'no asset yet in MONITOR');

-- 4. ชนิดอุปกรณ์ -------------------------------------------------------------
select throws_ok($$ select public.app_itas_save_type('x', 'ทดสอบ') $$, '23514', 'รหัสชนิดอุปกรณ์ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร ยาว 2–30 ตัว', 'a one-letter code is refused');
select throws_ok($$ select public.app_itas_save_type('1ABC', 'ทดสอบ') $$, '23514', 'รหัสชนิดอุปกรณ์ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร ยาว 2–30 ตัว', 'a code starting with a digit is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', '  ') $$, '23514', 'กรุณาระบุชื่อชนิดอุปกรณ์', 'a blank name is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', repeat('ก', 101)) $$, '23514', 'ชื่อชนิดอุปกรณ์ต้องไม่เกิน 100 ตัวอักษร', 'a name over 100 characters is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', repeat('A', 41)) $$, '23514', 'คำนำหน้าเลขทะเบียนต้องไม่เกิน 40 ตัวอักษร', 'a prefix over 40 characters is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '{"a": 1}'::jsonb) $$, '23514', 'นิยามช่องต้องเป็นรายการ', 'fields must be a list');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[1]'::jsonb) $$, '23514', 'ช่องที่ 1 ของนิยามไม่ถูกต้อง', 'a field must be an object');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "Bad Key", "label": "x", "type": "text"}]'::jsonb) $$, '23514', 'ช่องที่ 1: key ต้องเป็นตัวพิมพ์เล็ก/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร ไม่เกิน 40 ตัว', 'a key with capitals and a space is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "text"}, {"key": "a", "label": "y", "type": "text"}]'::jsonb) $$, '23514', 'ช่อง key "a" ซ้ำกัน', 'a duplicate key is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": " ", "type": "text"}]'::jsonb) $$, '23514', 'ช่อง "a": กรุณาระบุป้ายชื่อ', 'a blank label is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "blob"}]'::jsonb) $$, '23514', 'ช่อง "a": ชนิดข้อมูลต้องเป็น text, number, date หรือ choice', 'an unknown data type is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "text", "colour": "red"}]'::jsonb) $$, '23514', 'ช่องที่ 1: ไม่รู้จักคุณสมบัติ "colour"', 'an unknown property is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "number", "secret": true}]'::jsonb) $$, '23514', 'ช่อง "a": ช่องลับต้องเป็นชนิดข้อความ (text)', 'a secret number field is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "text", "max": 0}]'::jsonb) $$, '23514', 'ช่อง "a": max ต้องเป็นจำนวนเต็ม 1–4000', 'max 0 is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "text", "max": "abc"}]'::jsonb) $$, '23514', 'ช่อง "a": max ต้องเป็นจำนวนเต็ม 1–4000', 'a non-numeric max is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "date", "max": 5}]'::jsonb) $$, '23514', 'ช่อง "a": max ใช้ได้เฉพาะชนิดข้อความ', 'max on a date field is refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "choice"}]'::jsonb) $$, '23514', 'ช่อง "a": ชนิด choice ต้องมีตัวเลือก 1–100 ตัว', 'a choice field needs choices');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "choice", "choices": ["ก", "ก"]}]'::jsonb) $$, '23514', 'ช่อง "a": ตัวเลือก "ก" ซ้ำกัน', 'duplicate choices are refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[{"key": "a", "label": "x", "type": "text", "choices": ["ก"]}]'::jsonb) $$, '23514', 'ช่อง "a": choices ใช้ได้เฉพาะชนิด choice', 'choices on a text field are refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, (select jsonb_agg(jsonb_build_object('key', 'f' || g, 'label', 'F' || g, 'type', 'text')) from generate_series(1, 81) g)) $$, '23514', 'ชนิดอุปกรณ์มีช่องเฉพาะได้ไม่เกิน 80 ช่อง', 'more than 80 fields are refused');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ทดสอบ', null, false, '[]'::jsonb, 10000) $$, '23514', 'ลำดับต้องเป็นจำนวนเต็ม 0–9999', 'a sort over 9999 is refused');
select is(public.app_itas_save_type('zz_test', ' ชนิดทดสอบ ', 'ZZT', true,
  '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50, "order": 9}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) ->> 'created', 'true', 'a new type is created (code upper-cased, name trimmed)');
select is((select name from public.itas_types where code = 'ZZ_TEST' and not is_test), 'ชนิดทดสอบ', 'the name was trimmed');
select is((select fields -> 1 ->> 'order' from public.itas_types where code = 'ZZ_TEST' and not is_test), '2', 'the field order follows the list position (the client order value is ignored)');
select is((select fields -> 1 ->> 'max' from public.itas_types where code = 'ZZ_TEST' and not is_test), '50', 'a given max is kept');
select is((select fields -> 4 ->> 'max' from public.itas_types where code = 'ZZ_TEST' and not is_test), '200', 'a text field without max gets 200');
select is((select count(*)::int from public.itas_type_log where type_code = 'ZZ_TEST' and action = 'created' and not is_test), 1, 'the creation is logged by the trigger');
select is((select actor_id::text from public.itas_type_log where type_code = 'ZZ_TEST' and not is_test), current_setting('test.e_ita_adm'), 'the type log records the actor');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ', 'ZZT', true, (select fields from public.itas_types where code = 'ZZ_TEST' and not is_test), 500, true) ->> 'changed', 'false', 'saving the same definition changes nothing');
select is((select count(*)::int from public.itas_type_log where type_code = 'ZZ_TEST' and not is_test), 1, 'and writes no log');
select is(public.app_itas_save_type('COMPUTER', 'คอมพิวเตอร์ (Computer)', null, true, (select fields from public.itas_types where code = 'COMPUTER' and not is_test), 10, true) ->> 'changed', 'false', 'saving the seeded COMPUTER definition back unchanged is a no-op (the seed is already in normal form)');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, (select fields from public.itas_types where code = 'ZZ_TEST' and not is_test), 500, true) ->> 'changed', 'true', 'renaming the type is a change');
select is((select count(*)::int from public.itas_type_log where type_code = 'ZZ_TEST' and action = 'updated' and not is_test), 1, 'the change is logged with action updated');
select is((select old_values ->> 'name' from public.itas_type_log where type_code = 'ZZ_TEST' and action = 'updated' and not is_test), 'ชนิดทดสอบ', 'the log keeps the old values');
select is((select new_values ->> 'name' from public.itas_type_log where type_code = 'ZZ_TEST' and action = 'updated' and not is_test), 'ชนิดทดสอบ 2', 'and the new values');
select is(jsonb_array_length(public.app_itas_list_types()), 24, 'the list shows the new type too');
-- ลบช่อง/เปลี่ยนชนิดข้อมูลของช่องที่ยังไม่มีข้อมูล ทำได้ · ที่มีข้อมูลแล้วทำไม่ได้ (ทดสอบหลังมีอุปกรณ์ในหัวข้อถัดไป)
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true,
  '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}, {"key": "extra", "label": "เพิ่ม", "type": "text"}]'::jsonb, 500, true) ->> 'changed', 'true', 'a field can be added');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true,
  '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) ->> 'changed', 'true', 'a field without any data can be removed again');
select throws_ok($$ update public.itas_types set code = 'ZZ_OTHER' where code = 'ZZ_TEST' $$, '42501', null, 'the type table is closed to direct updates for everyone (no grant)');

-- 5. อุปกรณ์ -------------------------------------------------------------
select set_config('t.mon1_id', '2a500000-0000-0000-0000-000000000001', true);
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, 'monitor',
  '{"reg_no": " mnt20190001 ", "device_code": "mnt01", "name": "Dell 24", "model": "P2419H", "serial": "SN123", "host_code": " com01 ", "slot": "Port 1", "place": "ห้อง IT", "install_date": "2019-03-05", "record_date": "2019-03-06", "purchase_date": "2019-03-01", "vendor": "ร้าน A", "price": 4500.5, "tax_rate": 7, "warranty_text": "3-Y", "warranty_end": "2022-03-01", "express_code": "X1", "account_no": "A-1", "note": "หมายเหตุ"}'::jsonb,
  '{"monitor_type": "LED", "spec": "1920x1080"}'::jsonb, '{}'::jsonb, null) ->> 'created', 'true', 'a monitor is created with a client-supplied id (needed as AAD)');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'id', current_setting('t.mon1_id'), 'the supplied id was kept');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'reg_no', 'MNT20190001', 'reg_no is trimmed and upper-cased');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'device_code', 'MNT01', 'device_code is upper-cased');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'host_code', 'COM01', 'host_code is trimmed and upper-cased');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'status', 'in_use', 'the status defaults to in_use');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'type_code', 'MONITOR', 'the type code is upper-cased');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'price', '4500.50', 'the price is stored with two decimals');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'warranty_end', '2022-03-01', 'dates round-trip');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) -> 'attrs' ->> 'spec', '1920x1080', 'the type specific fields are stored in attrs');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'created_by_employee_no', 'ITA-ADM', 'the creator is recorded');
select is((select count(*)::int from public.itas_asset_log where asset_id = current_setting('t.mon1_id')::uuid and action = 'created'), 1, 'the creation is logged by the trigger');
select is((select count(*)::int from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid), 1, 'a move row is written at creation when the asset has a host');
select is((select to_host || '/' || to_slot || '/' || to_status || '/' || coalesce(from_host, 'null') from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid), 'COM01/Port 1/in_use/null', 'the creation move goes from nothing to COM01');
select set_config('t.mon1_ua', pg_temp.ua(current_setting('t.mon1_id')::uuid)::text, true);
-- สร้างโดยไม่ส่ง id
select set_config('t.com1_id', (public.app_itas_save_asset(null, 'COMPUTER', '{"device_code": "com01", "name": "เครื่องบัญชี", "status": "in_use"}'::jsonb, '{"auth_name": "somchai", "os": "Windows 11", "started_on": "2020-05-01", "express": "yes"}'::jsonb,
  jsonb_build_object('ip', pg_temp.env(1), 'license_os', pg_temp.env(2, 64)), null) -> 'asset' ->> 'id'), true);
select ok(current_setting('t.com1_id')::uuid is not null, 'an asset created without an id gets a generated uuid');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'ip', pg_temp.env(1), 'the secret comes back exactly as it was sent (ciphertext only)');
select is((select count(*)::int from public.itas_asset_moves where asset_id = current_setting('t.com1_id')::uuid), 0, 'no move row when the asset has no host');
select is(jsonb_array_length(public.app_itas_list_types() -> 0 -> 'fields'), 28, 'COMPUTER still has its fields');
-- ROM หลายแถวที่ไม่มีเลข (null ไม่ชน unique)
select lives_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "DVD ไม่มีเลข 1"}'::jsonb) $$, 'a ROM without any number can be created');
select lives_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "DVD ไม่มีเลข 2"}'::jsonb) $$, 'a second ROM without any number can be created (unique ignores null)');
select lives_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"reg_no": "ROM20180001"}'::jsonb, '{"rom_type": "DVD-RW"}'::jsonb) $$, 'a ROM with only a registration number can be created');
select lives_ok($$ select public.app_itas_save_asset(null, 'RAM', '{"reg_no": "RAM20170001", "host_code": "COM01", "slot": "Slot 1", "model": "DDR4 8GB"}'::jsonb, '{"ram_type": "DDR4", "capacity": "8GB"}'::jsonb) $$, 'a RAM module installed in COM01 is created');
select lives_ok($$ select public.app_itas_save_asset(null, 'RAM', '{"reg_no": "RAM20170002", "host_code": "COM01", "slot": "Slot 2", "model": "DDR4 8GB", "status": "broken"}'::jsonb, '{"ram_type": "DDR4"}'::jsonb) $$, 'a broken RAM module in COM01 is created');
select lives_ok($$ select public.app_itas_save_asset(null, 'UPS', '{"device_code": "UPS01", "reg_no": "UPS20190001", "host_code": "COM01", "status": "retired"}'::jsonb) $$, 'a retired UPS of COM01 is created');
select lives_ok($$ select public.app_itas_save_asset(null, 'CPU', '{"reg_no": "CPU20170001", "host_code": "COM99", "name": "Core i5"}'::jsonb, '{"generation": "7"}'::jsonb) $$, 'a CPU in another computer is created');
select is((select count(*)::int from public.itas_assets where not is_test), 9, 'nine real assets exist');

-- ค้นหา / กรอง / แบ่งหน้า
select is(public.app_itas_list_assets() ->> 'total', '9', 'the list total counts every real asset');
select is(jsonb_array_length(pg_temp.items()), 9, 'the list returns every asset by default');
select is(pg_temp.codes(pg_temp.items('ram')), 'RAM20170001,RAM20170002', 'filter by type (case-insensitive code)');
select is(pg_temp.codes(pg_temp.items(null, null, 'broken')), 'RAM20170002', 'filter by status');
select is(pg_temp.codes(pg_temp.items(null, null, null, ' com01')), 'MNT01,RAM20170001,RAM20170002,UPS01', 'filter by host (trimmed, upper-cased, exact), sorted by device code or reg no');
select is(pg_temp.codes(pg_temp.items(null, 'dell')), 'MNT01', 'search finds a name case-insensitively');
select is(pg_temp.codes(pg_temp.items(null, 'sn123')), 'MNT01', 'search finds a serial');
select is(pg_temp.codes(pg_temp.items(null, 'p2419')), 'MNT01', 'search finds a model');
select is(pg_temp.codes(pg_temp.items(null, 'mnt2019')), 'MNT01', 'search finds a registration number');
select is(pg_temp.codes(pg_temp.items(null, 'ups0')), 'UPS01', 'search finds a device code');
select is(pg_temp.codes(pg_temp.items(null, 'com99')), 'CPU20170001', 'search finds a host code');
select is(jsonb_array_length(pg_temp.items(null, '%')), 0, 'a percent sign in the search is a plain character (no wildcard)');
select is(jsonb_array_length(pg_temp.items(null, '_')), 0, 'an underscore in the search is a plain character (no wildcard)');
select is(jsonb_array_length(pg_temp.items(null, 'somchai')), 0, 'search does not look into attrs (only name, model, serial, reg no, device code, host code)');
select is(jsonb_array_length(pg_temp.items(null, 'ไม่มีเลข')), 2, 'search finds Thai text');
select is(jsonb_array_length(public.app_itas_list_assets(null, null, null, null, 3, 0) -> 'items'), 3, 'limit 3 returns three items');
select is(public.app_itas_list_assets(null, null, null, null, 3, 0) ->> 'total', '9', 'the total ignores the limit');
select is(pg_temp.codes(public.app_itas_list_assets(null, null, null, null, 2, 2) -> 'items'), pg_temp.codes((select jsonb_agg(e) from (select e from jsonb_array_elements(pg_temp.items()) with ordinality t(e, ord) order by ord offset 2 limit 2) s)), 'offset pages follow the same order');
select throws_ok($$ select public.app_itas_list_assets(null, null, 'gone') $$, '23514', 'สถานะต้องเป็น ใช้งาน สำรอง ชำรุด หรือ ยกเลิกใช้งาน', 'an unknown status filter is refused');
select throws_ok($$ select public.app_itas_list_assets(null, null, null, null, 0, 0) $$, '23514', 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000', 'limit 0 is refused');
select throws_ok($$ select public.app_itas_list_assets(null, null, null, null, 2001, 0) $$, '23514', 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000', 'limit 2001 is refused');
select throws_ok($$ select public.app_itas_list_assets(null, null, null, null, 10, -1) $$, '23514', 'ตำแหน่งเริ่มต้องไม่ติดลบ', 'a negative offset is refused');
select is((public.app_itas_list_types() -> 1) ->> 'asset_count', '0', 'LAPTOP has no asset');
select is((select (e ->> 'asset_count') from jsonb_array_elements(public.app_itas_list_types()) e where e ->> 'code' = 'RAM'), '2', 'the type list counts the assets of a type');
select throws_ok($$ select public.app_itas_get_asset('2a500000-0000-0000-0000-0000000000ff') $$, '23514', 'ไม่พบอุปกรณ์นี้', 'an unknown id is refused');

-- ตรวจข้อมูลตอนบันทึก
select throws_ok($$ select public.app_itas_save_asset(null, null, '{"name": "x"}'::jsonb) $$, '23514', 'กรุณาเลือกชนิดอุปกรณ์', 'a type is required when creating');
select throws_ok($$ select public.app_itas_save_asset(null, 'NOPE', '{"name": "x"}'::jsonb) $$, '23514', 'ไม่พบชนิดอุปกรณ์นี้', 'an unknown type is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{}'::jsonb) $$, '23514', 'กรุณาระบุอย่างน้อยหนึ่งอย่าง: เลขทะเบียน รหัสอุปกรณ์ ชื่อ รุ่น Serial หรือหมายเหตุ', 'an asset with no identifying field at all is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '[1]'::jsonb) $$, '23514', 'ข้อมูลที่ส่งมาต้องเป็นรูปแบบ {ช่อง: ค่า}', 'data must be an object');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "colour": "red"}'::jsonb) $$, '23514', 'ไม่รู้จักช่องข้อมูล "colour"', 'an unknown base field is refused (typo guard)');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": 5}'::jsonb) $$, '23514', 'ช่อง "ชื่อ" ต้องเป็นข้อความ', 'a non-text name is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', jsonb_build_object('name', repeat('ก', 201))) $$, '23514', 'ช่อง "ชื่อ" ต้องไม่เกิน 200 ตัวอักษร', 'a name over 200 characters is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', jsonb_build_object('name', 'a' || chr(7) || 'b')) $$, '23514', 'ช่อง "ชื่อ" มีอักขระที่ใช้ไม่ได้', 'a control character is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "status": "gone"}'::jsonb) $$, '23514', 'สถานะต้องเป็น ใช้งาน สำรอง ชำรุด หรือ ยกเลิกใช้งาน', 'an unknown status is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "status": null}'::jsonb) $$, '23514', 'สถานะต้องเป็น ใช้งาน สำรอง ชำรุด หรือ ยกเลิกใช้งาน', 'a null status is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "price": -1}'::jsonb) $$, '23514', 'ช่อง "ราคา" ต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a negative price is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "price": "12.345"}'::jsonb) $$, '23514', 'ช่อง "ราคา" ต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', 'a price with three decimals is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "tax_rate": 101}'::jsonb) $$, '23514', 'ช่อง "ภาษี (%)" ต้องไม่เกิน 100', 'a tax rate over 100 is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "install_date": "2019-02-30"}'::jsonb) $$, '23514', 'ช่อง "วันที่ติดตั้ง" ไม่ใช่วันที่ที่ถูกต้อง', 'an impossible date is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "install_date": "01/02/2019"}'::jsonb) $$, '23514', 'ช่อง "วันที่ติดตั้ง" ต้องเป็นวันที่ (ปปปป-ดด-วว แบบ ค.ศ.)', 'a date in another format is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ROM', '{"name": "x", "purchase_date": "1980-01-01"}'::jsonb) $$, '23514', 'ช่อง "วันที่ซื้อ" ต้องอยู่ระหว่างปี 1990–2100', 'a date before 1990 is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'MONITOR', '{"reg_no": "mnt20190001"}'::jsonb) $$, '23514', 'เลขทะเบียน MNT20190001 ซ้ำกับอุปกรณ์อื่น', 'a duplicate registration number is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'MONITOR', '{"device_code": " mnt01 "}'::jsonb) $$, '23514', 'รหัสอุปกรณ์ MNT01 ซ้ำกับอุปกรณ์อื่น', 'a duplicate device code is refused (after trim and upper-case)');
select throws_ok($$ select public.app_itas_save_asset(null, 'MONITOR', '{"device_code": "mnt77", "host_code": "mnt77"}'::jsonb) $$, '23514', 'ติดตั้งที่รหัสเดียวกับรหัสอุปกรณ์ของตัวเองไม่ได้', 'an asset cannot be installed in itself');
select throws_ok($$ select public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, 'MONITOR', '{"name": "x"}'::jsonb) $$, '23514', 'อุปกรณ์นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไข (ต้องส่ง expected_updated_at)', 'saving an existing id without expected_updated_at is refused (no silent overwrite or double create)');
select lives_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "ZZ ตัวแรก"}'::jsonb, '{"colour": "แดง", "bought": "2020-01-31", "cnt": 3, "note2": "ok"}'::jsonb) $$, 'a custom type works with choice, date, number and text fields');
-- ตรวจ attrs ตามนิยามช่อง
select throws_ok($$ select public.app_itas_save_asset(null, 'MONITOR', '{"name": "x"}'::jsonb, '{"nope": "1"}'::jsonb) $$, '23514', 'ช่อง "nope" ไม่มีในชนิดอุปกรณ์ MONITOR', 'an attribute not in the type is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, '{"colour": "ดำ"}'::jsonb) $$, '23514', 'ช่อง "สี" ต้องเลือกจากตัวเลือกที่กำหนด', 'a choice outside the list is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, '{"cnt": "3"}'::jsonb) $$, '23514', 'ช่อง "จำนวน" ต้องเป็นตัวเลข', 'a number given as a string is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, '{"cnt": 1e13}'::jsonb) $$, '23514', 'ช่อง "จำนวน" ต้องมีค่าไม่เกิน ±1,000,000,000,000', 'a huge number is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, '{"bought": "2020-13-01"}'::jsonb) $$, '23514', 'ช่อง "ซื้อเมื่อ" ไม่ใช่วันที่ที่ถูกต้อง', 'an invalid attribute date is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, jsonb_build_object('note2', repeat('ก', 51))) $$, '23514', 'ช่อง "อื่น" ต้องไม่เกิน 50 ตัวอักษร', 'an attribute longer than its max is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb, '{"colour": 5}'::jsonb) $$, '23514', 'ช่อง "สี" ต้องเป็นข้อความ', 'a non-text choice value is refused');
-- plaintext ผิดช่อง / envelope ผิดรูป
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{"ip": "192.168.1.5"}'::jsonb) $$, '23514', 'ช่อง "IP Address" เป็นช่องลับ ต้องส่งในรูปข้อมูลที่เข้ารหัสแล้ว (secrets) เท่านั้น ห้ามส่งค่าลับใน attrs', 'a plaintext sent to a secret field in attrs is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{"license_os": null}'::jsonb) $$, '23514', 'ช่อง "License OS" เป็นช่องลับ ต้องส่งในรูปข้อมูลที่เข้ารหัสแล้ว (secrets) เท่านั้น ห้ามส่งค่าลับใน attrs', 'even a null for a secret key in attrs is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, '{"ip": "192.168.1.5"}'::jsonb) $$, '23514', 'ช่องลับ "IP Address": รูปแบบข้อมูลลับต้องเป็นข้อมูลที่เข้ารหัสแล้ว {v, n, c}', 'a plaintext string in secrets is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, '{"os": {"v": 1, "n": "AAAAAAAAAAAAAAAA", "c": "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}}'::jsonb) $$, '23514', 'ช่อง "ระบบปฏิบัติการ (OS)" ไม่ใช่ช่องลับ ให้ส่งใน attrs', 'a non-secret field sent in secrets is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('wifi_password', pg_temp.env(1))) $$, '23514', 'ช่อง "wifi_password" ไม่มีในชนิดอุปกรณ์ COMPUTER', 'an unknown secret key is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', '["a"]'::jsonb)) $$, '23514', 'ช่องลับ "IP Address": รูปแบบข้อมูลลับต้องเป็นข้อมูลที่เข้ารหัสแล้ว {v, n, c}', 'an array instead of an envelope is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || '{"extra": 1}'::jsonb)) $$, '23514', 'ช่องลับ "IP Address": รูปแบบข้อมูลลับต้องมีเฉพาะ v, n, c', 'an envelope with an extra key is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) - 'n')) $$, '23514', 'ช่องลับ "IP Address": รูปแบบข้อมูลลับต้องมีเฉพาะ v, n, c', 'an envelope without a nonce is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || '{"v": 2}'::jsonb)) $$, '23514', 'ช่องลับ "IP Address": เวอร์ชันของข้อมูลลับต้องเป็น 1', 'an envelope with another version is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || jsonb_build_object('n', pg_temp.b64(1, 11)))) $$, '23514', 'ช่องลับ "IP Address": nonce ของข้อมูลลับต้องเป็น base64 ยาว 12 ไบต์', 'a nonce of 11 bytes is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || jsonb_build_object('n', pg_temp.b64(1, 13)))) $$, '23514', 'ช่องลับ "IP Address": nonce ของข้อมูลลับต้องเป็น base64 ยาว 12 ไบต์', 'a nonce of 13 bytes is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || '{"n": "not base64!"}'::jsonb)) $$, '23514', 'ช่องลับ "IP Address": nonce ของข้อมูลลับต้องเป็น base64 ยาว 12 ไบต์', 'a nonce that is not base64 is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1) || '{"c": "192.168.1.5"}'::jsonb)) $$, '23514', 'ช่องลับ "IP Address": ciphertext ของข้อมูลลับต้องเป็น base64 ที่ถูกต้อง', 'a ciphertext that is a plaintext IP is refused (not base64)');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1, 16))) $$, '23514', 'ช่องลับ "IP Address": ciphertext ของข้อมูลลับต้องยาว 17–4,096 ไบต์ (ค่าลับยาวสุดประมาณ 4,000 ตัวอักษร)', 'a ciphertext of 16 bytes (tag only, empty plaintext) is refused');
select throws_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "x"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1, 4097))) $$, '23514', 'ช่องลับ "IP Address": ciphertext ของข้อมูลลับต้องยาว 17–4,096 ไบต์ (ค่าลับยาวสุดประมาณ 4,000 ตัวอักษร)', 'a ciphertext over 4 KB is refused');
select lives_ok($$ select public.app_itas_save_asset(null, 'COMPUTER', '{"name": "ขอบเขตขนาด"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1, 17), 'mac', pg_temp.env(2, 4096))) $$, 'ciphertexts of exactly 17 and 4096 bytes are accepted');
select is((select count(*)::int from public.itas_assets where not is_test), 11, 'the refused saves created nothing (11 = 9 + the ZZ_TEST asset + the boundary computer)');

-- แก้อุปกรณ์: กันแก้ชนกัน / ชนิดเปลี่ยนไม่ได้ / merge ราย key
select throws_ok(format($$ select public.app_itas_save_asset(%L, 'MONITOR', '{"name": "ชื่อใหม่"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L) $$, current_setting('t.mon1_id'), (current_setting('t.mon1_ua')::timestamptz - interval '1 second')::text), '40001', 'ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', 'a stale expected_updated_at is refused with 40001');
select throws_ok(format($$ select public.app_itas_save_asset(%L, 'COMPUTER', '{"name": "ชื่อใหม่"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L) $$, current_setting('t.mon1_id'), current_setting('t.mon1_ua')), '23514', 'เปลี่ยนชนิดอุปกรณ์ไม่ได้ (ถ้าชนิดผิด ให้ยกเลิกใช้งานแล้วเพิ่มรายการใหม่)', 'the type of an existing asset cannot change');
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, null, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, current_setting('t.mon1_ua')::timestamptz) ->> 'changed', 'false', 'saving nothing new reports changed = false');
select is((select count(*)::int from public.itas_asset_log where asset_id = current_setting('t.mon1_id')::uuid), 1, 'and writes no log row');
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, 'monitor', '{"name": " Dell 24 นิ้ว ", "note": null}'::jsonb, '{"monitor_type": null, "spec": "FHD"}'::jsonb, '{}'::jsonb, current_setting('t.mon1_ua')::timestamptz) ->> 'changed', 'true', 'a real edit (matching type given in lower case) is applied');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'name', 'Dell 24 นิ้ว', 'the name was trimmed and changed');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'note', null, 'null clears a base field');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'model', 'P2419H', 'a field that was not sent keeps its value');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) -> 'attrs', '{"spec": "FHD"}'::jsonb, 'attrs are merged by key and null removes a key');
select is(pg_temp.asset(current_setting('t.mon1_id')::uuid) ->> 'updated_by_employee_no', 'ITA-ADM', 'the editor is recorded');
select is((select count(*)::int from public.itas_asset_log where asset_id = current_setting('t.mon1_id')::uuid and action = 'updated'), 1, 'the edit is logged');
select is((select old_values ->> 'name' || ' -> ' || (new_values ->> 'name') from public.itas_asset_log where asset_id = current_setting('t.mon1_id')::uuid and action = 'updated'), 'Dell 24 -> Dell 24 นิ้ว', 'the log keeps the old and the new row');
select is((select count(*)::int from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid), 1, 'an edit that leaves host/slot/status alone writes no move');
select set_config('t.mon1_ua', pg_temp.ua(current_setting('t.mon1_id')::uuid)::text, true);
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, null, '{"slot": "Port 2"}'::jsonb, '{}'::jsonb, '{}'::jsonb, current_setting('t.mon1_ua')::timestamptz) ->> 'changed', 'true', 'changing the slot is saved');
select is((select count(*)::int from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid), 2, 'a slot change writes a move');
select is((select from_slot || '->' || to_slot from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid order by id desc limit 1), 'Port 1->Port 2', 'the move records the old and the new slot');
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, null, '{"host_code": "com02", "status": "spare"}'::jsonb, '{}'::jsonb, '{}'::jsonb, current_setting('t.mon1_ua')::timestamptz) ->> 'changed', 'true', 'moving to another host and status is saved');
select is((select from_host || '->' || to_host || ' ' || from_status || '->' || to_status from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid order by id desc limit 1), 'COM01->COM02 in_use->spare', 'the move records host and status changes');
select is((select count(*)::int from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid), 3, 'three moves so far (create, slot, host+status)');
select is(public.app_itas_save_asset(current_setting('t.mon1_id')::uuid, null, '{"host_code": null}'::jsonb, '{}'::jsonb, '{}'::jsonb, pg_temp.ua(current_setting('t.mon1_id')::uuid)) ->> 'changed', 'true', 'clearing the host is a move too');
select is((select from_host || '->' || coalesce(to_host, 'null') from public.itas_asset_moves where asset_id = current_setting('t.mon1_id')::uuid order by id desc limit 1), 'COM02->null', 'a move to no host is recorded');
select set_config('t.mon1_ua', pg_temp.ua(current_setting('t.mon1_id')::uuid)::text, true);
select throws_ok(format($$ select public.app_itas_save_asset(%L, null, '{"reg_no": "RAM20170001"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L) $$, current_setting('t.mon1_id'), current_setting('t.mon1_ua')), '23514', 'เลขทะเบียน RAM20170001 ซ้ำกับอุปกรณ์อื่น', 'an edit cannot take the registration number of another asset');
select throws_ok(format($$ select public.app_itas_save_asset(%L, null, '{"reg_no": null, "device_code": null, "name": null, "model": null, "serial": null, "note": null}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L) $$, current_setting('t.mon1_id'), current_setting('t.mon1_ua')), '23514', 'กรุณาระบุอย่างน้อยหนึ่งอย่าง: เลขทะเบียน รหัสอุปกรณ์ ชื่อ รุ่น Serial หรือหมายเหตุ', 'an edit cannot blank every identifying field');

-- ช่องลับ: ส่งบางช่อง = แก้เฉพาะช่องนั้น · null = ลบ
select set_config('t.com1_ua', pg_temp.ua(current_setting('t.com1_id')::uuid)::text, true);
select is(public.app_itas_save_asset(current_setting('t.com1_id')::uuid, null, '{}'::jsonb, '{}'::jsonb, jsonb_build_object('mac', pg_temp.env(3)), current_setting('t.com1_ua')::timestamptz) ->> 'changed', 'true', 'adding one secret field is a change');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'ip', pg_temp.env(1), 'the secrets that were not sent are untouched (ip)');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'license_os', pg_temp.env(2, 64), 'the secrets that were not sent are untouched (license_os)');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'mac', pg_temp.env(3), 'the new secret is stored');
select is(public.app_itas_save_asset(current_setting('t.com1_id')::uuid, null, '{}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(1)), current_setting('t.com1_ua')::timestamptz) ->> 'changed', 'false', 'sending the identical ciphertext again changes nothing');
select is(public.app_itas_save_asset(current_setting('t.com1_id')::uuid, null, '{}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(4)), pg_temp.ua(current_setting('t.com1_id')::uuid)) ->> 'changed', 'true', 'replacing one secret is a change');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'ip', pg_temp.env(4), 'the replaced secret is the new ciphertext');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'license_os', pg_temp.env(2, 64), 'and the others are still the same');
select is(public.app_itas_save_asset(current_setting('t.com1_id')::uuid, null, '{}'::jsonb, '{}'::jsonb, '{"mac": null}'::jsonb, pg_temp.ua(current_setting('t.com1_id')::uuid)) ->> 'changed', 'true', 'null removes the secret of that field');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets') k), array['ip', 'license_os'], 'only the removed field is gone');
select is((select (new_values -> 'secrets' -> 'ip') from public.itas_asset_log where asset_id = current_setting('t.com1_id')::uuid order by id desc limit 1), pg_temp.env(4), 'the log row keeps ciphertext only (never a plaintext)');
select ok(not exists (select 1 from public.itas_asset_log l where l.asset_id = current_setting('t.com1_id')::uuid and (l.new_values::text like '%192.168%' or coalesce(l.old_values::text, '') like '%192.168%')), 'no plaintext appears in the log');

-- ชนิด: ช่องที่มีข้อมูลแล้วลบ/เปลี่ยนไม่ได้ (ใช้ ZZ_TEST ที่มีอุปกรณ์แล้ว)
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) $$, '23514', 'ช่อง "อื่น" มีข้อมูลในทะเบียนแล้ว ลบหรือเปลี่ยนชนิด/ความลับไม่ได้ (ถ้าไม่ต้องการแสดง ให้ซ่อนช่องแทน)', 'a field that already holds data cannot be removed');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "text"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) $$, '23514', 'ช่อง "ซื้อเมื่อ" มีข้อมูลในทะเบียนแล้ว ลบหรือเปลี่ยนชนิด/ความลับไม่ได้ (ถ้าไม่ต้องการแสดง ให้ซ่อนช่องแทน)', 'the data type of a field with data cannot change');
select throws_ok($$ select public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง", "ขาว"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50, "secret": true}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) $$, '23514', 'ช่อง "อื่น" มีข้อมูลในทะเบียนแล้ว ลบหรือเปลี่ยนชนิด/ความลับไม่ได้ (ถ้าไม่ต้องการแสดง ให้ซ่อนช่องแทน)', 'a field with data cannot become secret (the plaintext would stay in attrs)');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, '[{"key": "colour", "label": "สี", "type": "choice", "choices": ["แดง"]}, {"key": "note2", "label": "อื่น", "type": "text", "max": 50, "hidden": true}, {"key": "bought", "label": "ซื้อเมื่อ", "type": "date"}, {"key": "cnt", "label": "จำนวน", "type": "number"}, {"key": "pw", "label": "รหัส", "type": "text", "secret": true}]'::jsonb, 500, true) ->> 'changed', 'true', 'hiding a field and shrinking its choices is allowed');
select is((select fields -> 1 ->> 'hidden' from public.itas_types where code = 'ZZ_TEST' and not is_test), 'true', 'the hidden flag is stored');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบ 2', 'ZZT', true, (select fields from public.itas_types where code = 'ZZ_TEST' and not is_test), 500, false) ->> 'changed', 'true', 'a type can be deactivated');
select throws_ok($$ select public.app_itas_save_asset(null, 'ZZ_TEST', '{"name": "x"}'::jsonb) $$, '23514', 'ชนิดอุปกรณ์นี้ปิดการใช้งานอยู่ เพิ่มรายการใหม่ไม่ได้', 'a new asset cannot use an inactive type');
select is(jsonb_array_length(pg_temp.items('ZZ_TEST')), 1, 'but the existing asset of an inactive type is still listed');
select is(public.app_itas_save_asset((pg_temp.items('ZZ_TEST') -> 0 ->> 'id')::uuid, null, '{"name": "ZZ แก้ได้"}'::jsonb, '{}'::jsonb, '{}'::jsonb, (pg_temp.items('ZZ_TEST') -> 0 ->> 'updated_at')::timestamptz) ->> 'changed', 'true', 'and it can still be edited');

-- ประวัติ
select is(jsonb_array_length(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'log'), 5, 'the history lists 1 creation + 4 edits');
select is(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'log' -> 0 ->> 'action', 'updated', 'the log is newest first');
select is(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'log' -> 4 ->> 'action', 'created', 'and the creation is last');
select is(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'log' -> 0 ->> 'actor_employee_no', 'ITA-ADM', 'the history names the actor');
select is(jsonb_array_length(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'moves'), 4, 'the history lists four moves');
select is(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid) -> 'moves' -> 0 ->> 'from_host', 'COM02', 'moves are newest first');
select is(jsonb_array_length(public.app_itas_asset_history(current_setting('t.mon1_id')::uuid, 2) -> 'log'), 2, 'p_limit caps each list');
select throws_ok($$ select public.app_itas_asset_history('2a500000-0000-0000-0000-000000000001', 0) $$, '23514', 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–500', 'a limit of 0 is refused');
select throws_ok($$ select public.app_itas_asset_history('2a500000-0000-0000-0000-0000000000ff') $$, '23514', 'ไม่พบอุปกรณ์นี้', 'the history of an unknown asset is refused');

-- ภาพรวมของเครื่อง
select is(public.app_itas_host_overview(' com01 ') ->> 'host_code', 'COM01', 'the host code is trimmed and upper-cased');
select is(public.app_itas_host_overview('com01') -> 'device' ->> 'name', 'เครื่องบัญชี', 'the overview holds the computer itself (device code = host code)');
select is(public.app_itas_host_overview('com01') ->> 'total_parts', '3', 'three parts are installed in COM01 (two RAM + a retired UPS; the monitor moved away)');
select is((select string_agg(g ->> 'type_code', ',' order by ord) from jsonb_array_elements(public.app_itas_host_overview('com01') -> 'groups') with ordinality t(g, ord)), 'UPS,RAM', 'groups follow the order of the types');
select is((select jsonb_array_length(g -> 'items') from jsonb_array_elements(public.app_itas_host_overview('com01') -> 'groups') g where g ->> 'type_code' = 'RAM'), 2, 'the RAM group has two modules');
select is((select (g -> 'items' -> 0 ->> 'slot') from jsonb_array_elements(public.app_itas_host_overview('com01') -> 'groups') g where g ->> 'type_code' = 'RAM'), 'Slot 1', 'parts are sorted by slot inside a group');
select is((select string_agg(g ->> 'type_name', ',') from jsonb_array_elements(public.app_itas_host_overview('com01') -> 'groups') g where g ->> 'type_code' = 'RAM'), 'หน่วยความจำ (RAM)', 'the group carries the type name');
select is(public.app_itas_host_overview('com01', false) ->> 'total_parts', '2', 'include_retired = false hides the retired UPS');
select is(public.app_itas_host_overview('com99') -> 'device', 'null'::jsonb, 'a host that has no asset row has no device');
select is(public.app_itas_host_overview('com99') ->> 'total_parts', '1', 'but its parts are still listed (the CPU)');
select is(public.app_itas_host_overview('nothing') -> 'groups', '[]'::jsonb, 'an unknown host has no groups');
select throws_ok($$ select public.app_itas_host_overview('  ') $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'a blank host code is refused');
select ok(public.app_itas_host_overview('com01') -> 'device' -> 'secrets' ? 'ip', 'the overview carries the secrets of the computer as ciphertext too');

-- ISO: ลบ/แก้ย้อนหลัง/truncate ไม่ได้ แม้เขียนตรงด้วยสิทธิ์สูง
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ delete from public.itas_assets where not is_test $$, '42501', 'อุปกรณ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกใช้งานแทน (บันทึกสำหรับ ISO)', 'an asset cannot be deleted');
select throws_ok($$ truncate public.itas_assets cascade $$, '42501', null, 'the asset table cannot be truncated');
select throws_ok(format($$ update public.itas_assets set type_code = 'CPU' where id = %L $$, current_setting('t.mon1_id')), '42501', 'ชนิดอุปกรณ์และผู้บันทึกแก้ไขไม่ได้ (ถ้าชนิดผิด ให้ยกเลิกใช้งานแล้วเพิ่มรายการใหม่)', 'the type of an asset cannot be changed even by a direct update');
select throws_ok(format($$ update public.itas_assets set created_by = %L where id = %L $$, current_setting('test.e_ita_adm2'), current_setting('t.mon1_id')), '42501', 'ชนิดอุปกรณ์และผู้บันทึกแก้ไขไม่ได้ (ถ้าชนิดผิด ให้ยกเลิกใช้งานแล้วเพิ่มรายการใหม่)', 'the creator of an asset cannot be changed');
select throws_ok(format($$ update public.itas_assets set secrets = '{"ip": "192.168.1.5"}'::jsonb where id = %L $$, current_setting('t.com1_id')), '23514', null, 'even a direct write cannot store a plaintext as a secret (CHECK on the envelope shape)');
select throws_ok(format($$ update public.itas_assets set secrets = jsonb_build_object('IP', %L::jsonb) where id = %L $$, pg_temp.env(1)::text, current_setting('t.com1_id')), '23514', null, 'a secret key with capitals is refused by the CHECK');
select throws_ok(format($$ update public.itas_assets set price = -5 where id = %L $$, current_setting('t.mon1_id')), '23514', null, 'a negative price is refused by the CHECK');
select throws_ok(format($$ update public.itas_assets set reg_no = 'abc' where id = %L $$, current_setting('t.mon1_id')), '23514', null, 'a lower-case reg_no is refused by the CHECK');
select throws_ok($$ update public.itas_asset_log set action = 'created' $$, '42501', 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the asset log cannot be updated');
select throws_ok($$ delete from public.itas_asset_log where not is_test $$, '42501', 'ประวัติทะเบียนอุปกรณ์ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the asset log cannot be deleted');
select throws_ok($$ truncate public.itas_asset_log $$, '42501', 'ประวัติทะเบียนอุปกรณ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the asset log cannot be truncated');
select throws_ok($$ update public.itas_asset_moves set to_host = 'X' $$, '42501', 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the moves cannot be updated');
select throws_ok($$ delete from public.itas_asset_moves where not is_test $$, '42501', 'ประวัติทะเบียนอุปกรณ์ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the moves cannot be deleted');
select throws_ok($$ truncate public.itas_asset_moves $$, '42501', 'ประวัติทะเบียนอุปกรณ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the moves cannot be truncated');
select throws_ok($$ update public.itas_type_log set action = 'created' $$, '42501', 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the type log cannot be updated');
select throws_ok($$ delete from public.itas_types where not is_test $$, '42501', 'ชนิดอุปกรณ์ลบไม่ได้ ให้ปิดการใช้งานแทน (บันทึกสำหรับ ISO)', 'a type cannot be deleted');
select throws_ok($$ truncate public.itas_types cascade $$, '42501', null, 'the type table cannot be truncated');
select throws_ok($$ update public.itas_types set code = 'ZZ_OTHER' where code = 'ZZ_TEST' and not is_test $$, '42501', 'รหัสชนิดและผู้บันทึกของชนิดอุปกรณ์แก้ไขไม่ได้', 'the code of a type cannot change');
select ok(not exists (select 1 from public.itas_asset_log l where l.action = 'updated' and l.old_values is null) and not exists (select 1 from public.itas_asset_log l where l.action = 'created' and l.old_values is not null), 'the log table forces old values to exist exactly for updates');

-- 6. ตู้เซฟ -------------------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(public.app_itas_vault_get(), '{"initialized": false, "is_test": false}'::jsonb, 'the vault is not initialized at first');
select throws_ok($$ select public.app_itas_vault_init('SHA1', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'รองรับเฉพาะ KDF แบบ PBKDF2-SHA256', 'only PBKDF2-SHA256 is accepted');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 599999, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'จำนวนรอบ KDF ของรหัสตู้เซฟต้องอยู่ระหว่าง 600,000–10,000,000', 'fewer than 600000 rounds are refused');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 10000001, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'จำนวนรอบ KDF ของรหัสตู้เซฟต้องอยู่ระหว่าง 600,000–10,000,000', 'more than 10 million rounds are refused (ceiling)');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 1000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'จำนวนรอบ KDF ของรหัสกู้คืนต้องอยู่ระหว่าง 600,000–10,000,000', 'the recovery code needs the same minimum rounds');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 15), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'salt ของรหัสตู้เซฟต้องเป็น base64 ยาว 16 ไบต์', 'a salt of 15 bytes is refused');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, 'not base64', pg_temp.wrap(2)) $$, '23514', 'salt ของรหัสกู้คืนต้องเป็น base64 ยาว 16 ไบต์', 'a recovery salt that is not base64 is refused');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1) || '{"extra": 1}'::jsonb, 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'กุญแจที่ห่อด้วยรหัสตู้เซฟ: กุญแจที่ห่อต้องมีเฉพาะ n และ c', 'a wrapped key with an extra key is refused');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), jsonb_build_object('n', pg_temp.b64(1, 12), 'c', pg_temp.b64(1, 47)), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'กุญแจที่ห่อด้วยรหัสตู้เซฟ: กุญแจที่ห่อต้องเป็น base64 ยาว 48 ไบต์ (กุญแจ 32 ไบต์ + tag 16 ไบต์)', 'a wrapped key of 47 bytes is refused (must be exactly 32 + 16)');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), jsonb_build_object('n', pg_temp.b64(2, 13), 'c', pg_temp.b64(2, 48))) $$, '23514', 'กุญแจที่ห่อด้วยรหัสกู้คืน: nonce ของกุญแจที่ห่อต้องเป็น base64 ยาว 12 ไบต์', 'a recovery wrapped key with a 13-byte nonce is refused');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), '"just text"'::jsonb, 600000, pg_temp.b64(2, 16), pg_temp.wrap(2)) $$, '23514', 'กุญแจที่ห่อด้วยรหัสตู้เซฟ: กุญแจที่ห่อต้องเป็นข้อมูล {n, c}', 'a wrapped key that is a string is refused');
select is(public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 700000, pg_temp.b64(2, 16), pg_temp.wrap(2)), '{"rev": 1, "key_version": 1}'::jsonb, 'the vault is initialized (rev 1, key version 1)');
select throws_ok($$ select public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(3, 16), pg_temp.wrap(3), 600000, pg_temp.b64(4, 16), pg_temp.wrap(4)) $$, '23514', 'ตั้งตู้เซฟไปแล้ว ตั้งซ้ำไม่ได้ (ถ้าจะเปลี่ยนรหัสให้ใช้การเปลี่ยนรหัสตู้เซฟ)', 'initializing twice is refused (never overwrites)');
select is(public.app_itas_vault_get() ->> 'initialized', 'true', 'the vault is initialized now');
select is(public.app_itas_vault_get() ->> 'kdf_iterations', '600000', 'the vault returns the password KDF rounds');
select is(public.app_itas_vault_get() ->> 'recovery_kdf_iterations', '700000', 'and the recovery KDF rounds');
select is(public.app_itas_vault_get() -> 'wrapped_key_pass', pg_temp.wrap(1), 'the wrapped key is returned to it_admin (needed to unlock in the browser)');
select is(public.app_itas_vault_get() ->> 'salt', pg_temp.b64(1, 16), 'the salt is returned');
select ok(not (public.app_itas_vault_get() ? 'created_by') and not (public.app_itas_vault_get() ? 'password'), 'the vault response has no author and no password field');
select is((select count(*)::int from public.itas_vault_log where action = 'init' and rev = 1 and not is_test), 1, 'the initialization is logged (without any secret)');
select throws_ok($$ select public.app_itas_vault_rotate(2, 'change_password', 600000, pg_temp.b64(5, 16), pg_temp.wrap(5)) $$, '40001', 'ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว กรุณาโหลดตู้เซฟใหม่แล้วลองอีกครั้ง', 'rotating with a wrong rev is refused with 40001');
select throws_ok($$ select public.app_itas_vault_rotate(null, 'change_password', 600000, pg_temp.b64(5, 16), pg_temp.wrap(5)) $$, '40001', 'ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว กรุณาโหลดตู้เซฟใหม่แล้วลองอีกครั้ง', 'rotating without a rev is refused');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'reset', 600000, pg_temp.b64(5, 16), pg_temp.wrap(5)) $$, '23514', 'การกระทำต้องเป็น change_password หรือ new_recovery', 'an unknown action is refused');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 600000, pg_temp.b64(5, 16), pg_temp.wrap(5), 600000, pg_temp.b64(6, 16), pg_temp.wrap(6)) $$, '23514', 'เปลี่ยนรหัสตู้เซฟต้องไม่ส่งข้อมูลของรหัสกู้คืนมาด้วย', 'a password change must not carry recovery data');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 1000, pg_temp.b64(5, 16), pg_temp.wrap(5)) $$, '23514', 'จำนวนรอบ KDF ของรหัสตู้เซฟต้องอยู่ระหว่าง 600,000–10,000,000', 'a password change below 600000 rounds is refused');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 600000, pg_temp.b64(1, 16), pg_temp.wrap(5)) $$, '23514', 'ต้องใช้ salt และการห่อกุญแจชุดใหม่ (สุ่มใหม่ทุกครั้ง)', 'the old salt cannot be reused');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 600000, pg_temp.b64(5, 16), pg_temp.wrap(1)) $$, '23514', 'ต้องใช้ salt และการห่อกุญแจชุดใหม่ (สุ่มใหม่ทุกครั้ง)', 'the old wrapped key cannot be replayed');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 600000, pg_temp.b64(5, 15), pg_temp.wrap(5)) $$, '23514', 'salt ของรหัสตู้เซฟต้องเป็น base64 ยาว 16 ไบต์', 'a 15-byte salt is refused on rotation too');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'new_recovery', 600000, null, null, 600000, pg_temp.b64(6, 16), pg_temp.wrap(6)) $$, '23514', 'ออกรหัสกู้คืนใหม่ต้องไม่ส่งข้อมูลของรหัสตู้เซฟมาด้วย', 'a new recovery code must not carry password data');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'new_recovery', null, null, null, 600000, pg_temp.b64(2, 16), pg_temp.wrap(6)) $$, '23514', 'ต้องใช้ salt และการห่อกุญแจชุดใหม่ (สุ่มใหม่ทุกครั้ง)', 'the old recovery salt cannot be reused');
select is(public.app_itas_vault_rotate(1, 'change_password', 800000, pg_temp.b64(5, 16), pg_temp.wrap(5)), '{"rev": 2, "key_version": 1}'::jsonb, 'the password is changed (rev 2, key version unchanged so the ciphertexts still decrypt)');
select is(public.app_itas_vault_get() ->> 'salt', pg_temp.b64(5, 16), 'the new salt is stored');
select is(public.app_itas_vault_get() ->> 'kdf_iterations', '800000', 'the new rounds are stored');
select is(public.app_itas_vault_get() -> 'wrapped_key_recovery', pg_temp.wrap(2), 'the recovery wrapping is untouched by a password change');
select throws_ok($$ select public.app_itas_vault_rotate(1, 'change_password', 600000, pg_temp.b64(7, 16), pg_temp.wrap(7)) $$, '40001', 'ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว กรุณาโหลดตู้เซฟใหม่แล้วลองอีกครั้ง', 'the old rev no longer works');
select is(public.app_itas_vault_rotate(2, 'new_recovery', null, null, null, 650000, pg_temp.b64(6, 16), pg_temp.wrap(6)), '{"rev": 3, "key_version": 1}'::jsonb, 'a new recovery code is issued (rev 3)');
select is(public.app_itas_vault_get() -> 'wrapped_key_pass', pg_temp.wrap(5), 'the password wrapping is untouched by a new recovery code');
select is(public.app_itas_vault_get() ->> 'recovery_kdf_iterations', '650000', 'the new recovery rounds are stored');
select is((select string_agg(action || ':' || rev, ',' order by id) from public.itas_vault_log where not is_test), 'init:1,change_password:2,new_recovery:3', 'the vault log has one row per change and no secret');
select ok(not exists (select 1 from information_schema.columns c where c.table_name = 'itas_vault_log' and c.column_name not in ('id', 'is_test', 'action', 'rev', 'actor_id', 'created_at')), 'the vault log table has no column that could hold a secret');
select is(pg_temp.asset(current_setting('t.com1_id')::uuid) -> 'secrets' -> 'ip', pg_temp.env(4), 'rotating the vault never touches the encrypted asset data');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itas_vault set rev = rev + 2 where not is_test $$, '23514', 'ตู้เซฟต้องแก้ทีละรุ่น (rev เพิ่มทีละ 1)', 'a direct update must raise rev by exactly one');
select throws_ok($$ update public.itas_vault set key_version = 2 where not is_test $$, '42501', 'รุ่นของกุญแจหลักและผู้ตั้งตู้เซฟแก้ไขไม่ได้', 'the key version cannot be changed');
select throws_ok($$ update public.itas_vault set salt = 'short', rev = rev + 1 where not is_test $$, '23514', null, 'a direct update cannot store a malformed salt');
select throws_ok($$ update public.itas_vault set kdf_iterations = 1000, rev = rev + 1 where not is_test $$, '23514', null, 'a direct update cannot lower the KDF rounds');
select throws_ok($$ delete from public.itas_vault where not is_test $$, '42501', 'ตู้เซฟลบไม่ได้ (ข้อมูลลับที่เข้ารหัสไว้จะกู้ไม่ได้)', 'the vault cannot be deleted');
select throws_ok($$ truncate public.itas_vault cascade $$, '42501', null, 'the vault cannot be truncated');
select throws_ok($$ delete from public.itas_vault_log where not is_test $$, '42501', 'ประวัติทะเบียนอุปกรณ์ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the vault log cannot be deleted');
select throws_ok($$ update public.itas_vault_log set action = 'init' $$, '42501', 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the vault log cannot be updated');
select is((select count(*)::int from public.itas_vault where not is_test), 1, 'there is exactly one real vault');
select throws_ok($$ insert into public.itas_vault (is_test, kdf, kdf_iterations, salt, wrapped_key_pass, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery, created_by, updated_by) values (false, 'PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2), current_setting('test.e_ita_adm')::uuid, current_setting('test.e_ita_adm')::uuid) $$, '23505', null, 'a second vault row for the same mode cannot be added');
select throws_ok($$ insert into public.itas_vault (is_test, kdf, kdf_iterations, salt, wrapped_key_pass, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery, created_by, updated_by) values (true, 'PBKDF2-SHA256', 600000, 'short', pg_temp.wrap(1), 600000, pg_temp.b64(2, 16), pg_temp.wrap(2), current_setting('test.e_ita_adm')::uuid, current_setting('test.e_ita_adm')::uuid) $$, '23514', null, 'the table refuses a vault row with a malformed salt');
select throws_ok($$ insert into public.itas_vault (is_test, kdf, kdf_iterations, salt, wrapped_key_pass, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery, created_by, updated_by) values (true, 'PBKDF2-SHA256', 600000, pg_temp.b64(1, 16), pg_temp.wrap(1), 600000, 'short', pg_temp.wrap(2), current_setting('test.e_ita_adm')::uuid, current_setting('test.e_ita_adm')::uuid) $$, '23514', null, 'the table refuses a vault row with a malformed recovery salt');

-- 7. โหมดทดสอบ ----------------------------------------------------------
select count(set_config('t.real_assets', (select count(*)::text from public.itas_assets where not is_test), true));
select count(set_config('t.real_log', (select count(*)::text from public.itas_asset_log where not is_test), true));
select count(set_config('t.real_types', (select count(*)::text from public.itas_types where not is_test), true));
select count(set_config('t.real_type_log', (select count(*)::text from public.itas_type_log where not is_test), true));
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'the admin enters the test mode as the IT approver persona');
select throws_ok($$ select public.app_itas_list_types() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'the IT approver persona has no register rights either');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_staff')::uuid) $$, 'switching to the IT staff persona (no IT rights)');
select throws_ok($$ select public.app_itas_list_assets() $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'the IT staff persona cannot use the register');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select is(jsonb_array_length(public.app_itas_list_types()), 23, 'the test mode has its own seeded 23 types (the real ZZ_TEST type is not there)');
select is((select count(*)::int from jsonb_array_elements(public.app_itas_list_types()) e where e ->> 'code' = 'ZZ_TEST'), 0, 'the real custom type is invisible in the test mode');
select is(public.app_itas_list_assets() ->> 'total', '0', 'the test registry starts empty (the real assets are invisible)');
select is(public.app_itas_vault_get(), '{"initialized": false, "is_test": true}'::jsonb, 'the test vault is separate and not initialized');
select throws_ok(format($$ select public.app_itas_get_asset(%L) $$, current_setting('t.mon1_id')), '23514', 'ไม่พบอุปกรณ์นี้', 'the persona cannot open a real asset');
select throws_ok(format($$ select public.app_itas_asset_history(%L) $$, current_setting('t.mon1_id')), '23514', 'ไม่พบอุปกรณ์นี้', 'the persona cannot read the history of a real asset');
select throws_ok(format($$ select public.app_itas_save_asset(%L, null, '{"name": "แก้ของจริง"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L) $$, current_setting('t.mon1_id'), current_setting('t.mon1_ua')), '23514', 'ไม่พบอุปกรณ์นี้ หรือรหัสอุปกรณ์ (id) นี้ถูกใช้แล้ว', 'the persona cannot edit a real asset (even with the right timestamp)');
select throws_ok(format($$ select public.app_itas_save_asset(%L, 'MONITOR', '{"name": "ชนรหัส"}'::jsonb) $$, current_setting('t.mon1_id')), '23514', 'ไม่พบอุปกรณ์นี้ หรือรหัสอุปกรณ์ (id) นี้ถูกใช้แล้ว', 'the persona cannot create an asset with the id of a real asset');
select is(public.app_itas_host_overview('com01') -> 'device', 'null'::jsonb, 'the persona sees no real device in the overview');
select is(public.app_itas_save_asset(null, 'MONITOR', '{"reg_no": "MNT20190001", "device_code": "MNT01", "name": "จอทดสอบ", "host_code": "COM01"}'::jsonb) ->> 'created', 'true', 'the same registration number and device code can exist in the test world');
select is(public.app_itas_save_asset(null, 'MONITOR', '{"name": "จอทดสอบ 2", "host_code": "COM01", "slot": "P1"}'::jsonb, '{"monitor_type": "LCD"}'::jsonb) ->> 'created', 'true', 'a second test asset is created');
select is(public.app_itas_save_type('ZZ_TEST', 'ชนิดทดสอบในโหมดทดสอบ', null, false, '[{"key": "k1", "label": "K1", "type": "text"}]'::jsonb, 1, true) ->> 'created', 'true', 'the same custom type code can be created in the test world (separate rows)');
select is(public.app_itas_save_type('MONITOR', 'จอภาพ (ลองแก้)', 'MNT', true, (select fields from public.itas_types where code = 'MONITOR' and is_test), 30, true) ->> 'changed', 'true', 'the persona edits a seeded test type');
select is(public.app_itas_vault_init('PBKDF2-SHA256', 600000, pg_temp.b64(21, 16), pg_temp.wrap(21), 600000, pg_temp.b64(22, 16), pg_temp.wrap(22)) ->> 'rev', '1', 'the test vault is initialized on its own');
select is(public.app_itas_vault_get() ->> 'is_test', 'true', 'and reports itself as the test vault');
select is(public.app_itas_host_overview('com01') ->> 'total_parts', '2', 'the test overview counts only test assets');
select is(public.app_itas_save_asset(null, 'COMPUTER', '{"name": "คอมทดสอบ"}'::jsonb, '{}'::jsonb, jsonb_build_object('ip', pg_temp.env(9))) ->> 'created', 'true', 'a test computer with a (fake) secret');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
select throws_ok($$ select public.app_sandbox_purge_itas() $$, null, 'SANDBOX_NOT_ACTIVE', 'the purge needs an active test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itas_assets where not is_test), current_setting('t.real_assets')::int, 'the test mode did not add or remove any real asset');
select is((select count(*)::int from public.itas_asset_log where not is_test), current_setting('t.real_log')::int, 'nor any real log row');
select is((select count(*)::int from public.itas_assets where is_test), 3, 'three test assets exist');
select ok((select bool_and(l.is_test = a.is_test) from public.itas_asset_log l join public.itas_assets a on a.id = l.asset_id), 'log rows follow the mode of their asset');
select ok((select bool_and(m.is_test = a.is_test) from public.itas_asset_moves m join public.itas_assets a on a.id = m.asset_id), 'move rows follow the mode of their asset');
select is((select count(*)::int from public.itas_vault where is_test), 1, 'one test vault exists');
select is((select count(*)::int from public.itas_vault where not is_test), 1, 'and the real vault is untouched');
select is((select rev from public.itas_vault where not is_test), 3, 'the real vault is still at rev 3');
select is((select count(*)::int from public.itas_types where is_test), 24, 'the test world has 23 seeded types + its own ZZ_TEST');
select is((select name from public.itas_types where code = 'MONITOR' and is_test), 'จอภาพ (ลองแก้)', 'the edited test type is in the test world');
select is((select name from public.itas_types where code = 'MONITOR' and not is_test), 'จอภาพ (Monitor)', 'and the real MONITOR type is untouched');
select count(set_config('t.test_rows', ((select count(*) from public.itas_assets where is_test) + (select count(*) from public.itas_asset_log where is_test) + (select count(*) from public.itas_asset_moves where is_test) + (select count(*) from public.itas_types where is_test) + (select count(*) from public.itas_type_log where is_test) + (select count(*) from public.itas_vault where is_test) + (select count(*) from public.itas_vault_log where is_test))::text, true));
select ok(current_setting('t.test_rows')::int >= 30, 'the test mode left a good number of test rows to purge');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itas() ->> 'deleted')::int, current_setting('t.test_rows')::int, 'the purge deletes every test row of all seven tables');
select is(jsonb_array_length(public.app_itas_list_types()), 23, 'the purge re-seeds the 23 default types of the test world');
select is((select e ->> 'name' from jsonb_array_elements(public.app_itas_list_types()) e where e ->> 'code' = 'MONITOR'), 'จอภาพ (Monitor)', 'and the test type definitions are back to the defaults');
select is(public.app_itas_vault_get() ->> 'initialized', 'false', 'the test vault is gone (it must be set up again)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itas_assets where is_test) + (select count(*)::int from public.itas_asset_log where is_test) + (select count(*)::int from public.itas_asset_moves where is_test) + (select count(*)::int from public.itas_type_log where is_test) + (select count(*)::int from public.itas_vault where is_test) + (select count(*)::int from public.itas_vault_log where is_test), 0, 'no test asset, log, move, vault or type log is left');
select is((select count(*)::int from public.itas_types where is_test), 23, 'the test world has exactly its 23 default types');
select is((select count(*)::int from public.itas_assets where not is_test), current_setting('t.real_assets')::int, 'the real assets survived the purge');
select is((select count(*)::int from public.itas_asset_log where not is_test), current_setting('t.real_log')::int, 'the real log survived the purge');
select is((select count(*)::int from public.itas_types where not is_test), current_setting('t.real_types')::int, 'the real types survived the purge');
select is((select count(*)::int from public.itas_type_log where not is_test), current_setting('t.real_type_log')::int, 'the real type log survived the purge');
select is((select rev from public.itas_vault where not is_test), 3, 'the real vault survived the purge');
select is((select count(*)::int from public.itas_vault_log where not is_test), 3, 'the real vault log survived the purge');
select throws_ok($$ delete from public.itas_assets where not is_test $$, '42501', 'อุปกรณ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกใช้งานแทน (บันทึกสำหรับ ISO)', 'real assets still cannot be deleted after a purge');
select throws_ok($$ delete from public.itas_asset_log where not is_test $$, '42501', 'ประวัติทะเบียนอุปกรณ์ลบไม่ได้ (บันทึกสำหรับ ISO)', 'the real log still cannot be deleted after a purge');
select throws_ok($$ delete from public.itas_vault where not is_test $$, '42501', 'ตู้เซฟลบไม่ได้ (ข้อมูลลับที่เข้ารหัสไว้จะกู้ไม่ได้)', 'the real vault still cannot be deleted after a purge');
select is(current_setting('itas.purge', true), 'off', 'the purge flag is switched off again');
select is((select count(*)::int from public.audit_logs where action = 'ITAS_SANDBOX_PURGE'), 1, 'the purge is recorded in the audit log');
select ok(array['itas_assets', 'itas_vault'] <@ private.sandbox_unguarded_tables(), 'the registry is still listed after the purge');

select * from finish();
rollback;
