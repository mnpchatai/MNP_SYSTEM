-- ทดสอบ "พนักงานเลือกอุปกรณ์จากทะเบียนตอนแจ้งซ่อม" (20270108010000_itrp_request_devices.sql) — ส่วนฐานข้อมูลของโมดูลใบแจ้งซ่อม (itrp)
--   1) โครงสร้าง: ตาราง itrp_request_devices (RLS/ไม่มี grant/trigger/ลงทะเบียนโหมดทดสอบ), คอลัมน์ใหม่ของใบ, RPC ใหม่ anon เรียกไม่ได้, app_itrp_create เหลือซิกเนเจอร์เดียว
--   2) app_itrp_lookup_host: พบ/ไม่พบ/เครื่องเลิกใช้/ไม่ใช่เครื่องคอม/รูปแบบผิด/ค้นตรงตัวเท่านั้น, คืนเฉพาะช่องที่อนุญาต (ไม่มี serial/IP/แผนก/สถานที่/ราคา/attrs อื่น),
--      อุปกรณ์ที่ผูกกับเครื่อง (ชนิดที่รองรับ ไม่เลิกใช้ เรียงตามชนิดแล้วรหัส), จับคู่ด้วย device_code หรือ reg_no, ผู้ใช้ไม่ active/anon เรียกไม่ได้
--   3) app_itrp_create: แบบเดิม (ไม่ส่งพารามิเตอร์ใหม่) ยังใช้ได้, แบบใหม่ (host พบในทะเบียน/ไม่ทราบรหัส + อุปกรณ์ 1–10 แถว), from_register คำนวณที่ฐานข้อมูล, ข้อความผิดพลาดทุกกรณี
--   4) รายละเอียดใบ: คีย์ใหม่ host_code / devices[]
--   5) ISO: อุปกรณ์ของใบแก้/ลบ/ล้างไม่ได้, host_code แก้ไม่ได้, เขียนตรงไม่ได้
--   6) โหมดทดสอบ: ทะเบียนแยกโลก (persona เห็นเฉพาะเครื่องทดสอบ), ล้างข้อมูลทดสอบลบอุปกรณ์ของใบทดสอบโดยไม่แตะของจริง
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITD-*) ในแผนกทดสอบ ZPD ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(157);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
-- claims ของผู้ใช้ทดสอบเลขที่ n
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1d900000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
-- ลองรันคำสั่ง: คืน 'OK' หรือ 'รหัส: ข้อความ'
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- สร้างอุปกรณ์ในทะเบียน (ผู้ใช้ปัจจุบันต้องเป็น itas admin) · p_attrs = ช่องไม่ลับของชนิด
create function pg_temp.mk(p_type text, p_data jsonb, p_attrs jsonb default '{}'::jsonb) returns text language sql as $$
  select public.app_itas_save_asset(null, p_type, p_data, p_attrs) -> 'asset' ->> 'id' $$;
-- ค้นเครื่อง
create function pg_temp.lk(p_code text) returns jsonb language sql as $$ select public.app_itrp_lookup_host(p_code) $$;
-- อุปกรณ์ที่ค้นเจอ: 'ชนิด:รหัส,...' ตามลำดับที่ระบบคืน
create function pg_temp.lkdev(p_code text) returns text language sql as $$
  select coalesce(string_agg((d ->> 'type_code') || ':' || (d ->> 'code'), ',' order by o), '-')
  from jsonb_array_elements(public.app_itrp_lookup_host(p_code) -> 'devices') with ordinality x(d, o) $$;
-- แจ้งซ่อมแบบใหม่ · คืน id ของใบ (ข้อความ)
create function pg_temp.req(p_host text, p_devices jsonb) returns text language sql as $$
  select (select c.id::text from public.app_itrp_create(null, 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'อาการทดสอบ', false, p_host, p_devices) c) $$;
-- คำสั่งแจ้งซ่อมแบบใหม่ (ข้อความ SQL ให้ throws_ok/try)
create function pg_temp.reqsql(p_host text, p_devices jsonb) returns text language sql as $$
  select format('select public.app_itrp_create(null, %L, %L, null, %L, null, %L, false, %L, %L::jsonb)',
                'เครื่องทดสอบ', 'repair', 'computer', 'อาการทดสอบ', p_host, p_devices::text) $$;
-- แถวอุปกรณ์ใน jsonb
create function pg_temp.d(p_type text, p_code text default null, p_note text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('type_code', p_type, 'device_code', p_code, 'note', p_note)) $$;
-- อุปกรณ์ของใบ (จากรายละเอียดใบ): 'ชนิด:รหัส:t/f,...' ตามลำดับ seq
create function pg_temp.dv(p_id text) returns text language sql as $$
  select coalesce(string_agg((e ->> 'type_code') || ':' || coalesce(e ->> 'device_code', '-') || ':' || case when (e ->> 'from_register')::boolean then 't' else 'f' end, ',' order by (e ->> 'seq')::int), '-')
  from jsonb_array_elements(public.app_itrp_get_detail(p_id::uuid) -> 'devices') e $$;
create function pg_temp.det(p_id text) returns jsonb language sql as $$ select public.app_itrp_get_detail(p_id::uuid) $$;
-- ชื่อคีย์ของ jsonb object เรียงตัวอักษร (ใช้เทียบว่าไม่มีคีย์เกิน)
create function pg_temp.keys(p_obj jsonb) returns text language sql as $$
  select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(p_obj) k $$;

-- อ่านตารางที่ผู้ใช้อ่านตรงไม่ได้ (รันด้วยสิทธิ์เจ้าของฟังก์ชัน = postgres): คืนค่าคอลัมน์แรกของแถวแรกเป็นข้อความ
create function pg_temp.q(p_sql text) returns text language plpgsql security definer as $$
declare
  v_result text;
begin
  execute p_sql into v_result;
  return v_result;
end $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'itrp_request_devices' and c.relkind = 'r' and c.relrowsecurity), 1, 'RLS is enabled on itrp_request_devices');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'itrp_request_devices' and g.grantee in ('anon', 'authenticated', 'PUBLIC')), 'anon, authenticated and PUBLIC have no direct grant on the table');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) where c.relname = 'itrp_request_devices' and has_table_privilege('service_role', c.oid, p.priv)), 'service_role has no privilege on the table (the secret key cannot write it directly)');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'itrp_request_devices' and p.polname = 'itrp_request_devices_no_direct_access'), 1, 'the table has a deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'itrp_request_devices' and p.polname = 'lab_only_no_access' and not p.polpermissive), 1, 'the table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'itrp_request_devices' and not t.tgisinternal and t.tgname in ('itrp_request_devices_sandbox_scope', 'itrp_request_devices_append_only', 'itrp_request_devices_no_truncate')), 3, 'sandbox scope, append-only and no-truncate triggers are in place');
select ok('itrp_request_devices' = any (private.sandbox_unguarded_tables()), 'itrp_request_devices is registered in private.sandbox_unguarded_tables()');
select is(cardinality(private.sandbox_unguarded_tables()), 107, 'sandbox_unguarded_tables has 107 names (the 105 earlier names + itrp_request_devices + rf_material_prices of 20270109010000)');
select ok(array['itrp_requests', 'itrp_part_changes', 'itas_assets', 'itwo_work_orders', 'itua_users', 'itar_requests', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables(), 'the earlier names (itrp, itas, itwo, itua, itar, BOM and central) are still there');
select is((select count(*)::int from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'itrp_requests' and c.column_name = 'host_code'), 1, 'itrp_requests has the host_code column');
select is((select count(*)::int from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'itrp_requests' and c.column_name = 'host_unknown'), 0, 'there is no host_unknown column (the "unknown host" option was removed)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itrp_create'), 1, 'app_itrp_create has exactly one signature (no ambiguous overload)');
select is((select p.pronargs::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itrp_create'), 10, 'the signature has 10 arguments (8 old + host_code, devices)');
select is((select p.pronargdefaults::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itrp_create'), 3, 'p_is_urgent and the two new arguments have defaults (old callers still work)');
select ok(to_regprocedure('public.app_itrp_create(text, text, text, text, text, text, text, boolean)') is null, 'the old 8-argument signature is gone');
select ok(not has_function_privilege('anon', 'public.app_itrp_lookup_host(text)', 'execute') and has_function_privilege('authenticated', 'public.app_itrp_lookup_host(text)', 'execute'), 'the lookup RPC is callable by authenticated and not by anon');
select ok(not has_function_privilege('anon', 'public.app_itrp_create(text, text, text, text, text, text, text, boolean, text, jsonb)', 'execute') and has_function_privilege('authenticated', 'public.app_itrp_create(text, text, text, text, text, text, text, boolean, text, jsonb)', 'execute'), 'app_itrp_create keeps its grants (authenticated only)');
select ok((select bool_and(p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_lookup_host', 'app_itrp_create', 'app_itrp_get_detail', 'app_sandbox_purge_itrp')), 'the lookup, create, detail and purge functions are SECURITY DEFINER with an empty search_path');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_find_host', 'itrp_host_devices') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute') or not p.prosecdef or not (p.proconfig @> array['search_path=""']))), 'the two private register helpers are closed to users and have an empty search_path');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%itrp%'), 'every itrp RPC (including the new lookup) has the lab-only guard');
select ok(pg_get_functiondef('public.app_itrp_lookup_host(text)'::regprocedure) !~* '\y(serial|secret|secrets|price|place|auth_name|vendor|attrs)\y' and pg_get_functiondef('private.itrp_host_devices(boolean, text, text)'::regprocedure) !~* '\y(serial|secret|secrets|price|place|auth_name|vendor|attrs)\y', 'the lookup and the device helper never read serial, price, place, secrets or attrs');
select ok(pg_get_functiondef('private.itrp_find_host(boolean, text)'::regprocedure) !~* '\y(serial|secret|secrets|price|place|auth_name|vendor)\y' and (length(pg_get_functiondef('private.itrp_find_host(boolean, text)'::regprocedure)) - length(replace(pg_get_functiondef('private.itrp_find_host(boolean, text)'::regprocedure), 'attrs', ''))) / 5 = 1 and position('attrs ->> ''user_name''' in pg_get_functiondef('private.itrp_find_host(boolean, text)'::regprocedure)) > 0, 'the host helper reads exactly one key of attrs (user_name) and no serial, price, place or secret');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname in ('app_itrp_lookup_host', 'itrp_find_host', 'itrp_host_devices') and pg_get_functiondef(p.oid) ~* '(like|ilike|similar to|~~)\s'), 'the lookup and its helpers never use LIKE (exact match only)');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_lookup_host', 'app_itrp_create') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'the new messages say "ใบแจ้งซ่อม", never "ใบสั่งงาน"');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
insert into public.departments (code, name_th, name_en) values ('ZPD', 'แผนกทดสอบ D (มีผู้จัดการ)', 'ZP D');
insert into auth.users (id, email, raw_user_meta_data)
select ('1d900000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itd-' || n || '@test.local', '{}'::jsonb
from generate_series(1, 9) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itd.test', d.id, r.id, ('1d900000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, v.active
from (values
  (1, 'ITD-REQ', 'ZPD', 'staff', true),
  (2, 'ITD-MGR', 'ZPD', 'department_manager', true),
  (3, 'ITD-ADM', 'MGT', 'staff', true),
  (4, 'ITD-APPR', 'MGT', 'general_manager', true),
  (5, 'ITD-OTHER', 'MGT', 'staff', true),
  (6, 'ITD-OFF', 'ZPD', 'staff', false),
  (7, 'ITD-SBXADMIN', 'MGT', 'admin', true)
) as v(n, no, dep, role, active)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- สิทธิ์ทีม IT ของใบ (itwo_staff): ADM = ผู้ดูแลงาน · APPR = ผู้อนุมัติขั้น IT (ต้องมีผู้อนุมัติที่ใช้งานอยู่ ใบจึงสร้างได้)
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITD-ADM', true, false), ('ITD-APPR', false, true)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
-- สิทธิ์ทะเบียนอุปกรณ์ (itas_admins): ADM เท่านั้น (ผู้แจ้งทั่วไปอ่านทะเบียนตรงไม่ได้ ต้องผ่าน lookup)
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no = 'ITD-ADM';
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-D-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZPD', 'sbx-d-staff@sandbox.local', (select id from public.departments where code = 'ZPD'), (select id from public.roles where code = 'staff'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select is((select count(*)::int from public.itrp_request_devices), 0, 'the devices table is empty before the tests (clean database)');
select count(set_config('t.real_requests_before', (select count(*)::text from public.itrp_requests), true));

-- ทะเบียนอุปกรณ์จริงของการทดสอบ (ผู้ดูแล ADM)
-- เครื่อง PD-COM1: มีช่องที่ห้ามหลุด (serial, ชื่อ Auth., แผนก, สถานที่, ราคา) ไว้ตรวจว่า lookup ไม่คืน
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select set_config('t.com1', pg_temp.mk('COMPUTER', '{"device_code": "pd-com1", "name": "คอมทดสอบ 1", "model": "ModelX", "serial": "SERIAL-SECRET-1", "place": "ห้องลับชั้น 9", "price": 123456.78}'::jsonb,
  '{"user_name": "สมชาย ทดสอบ", "auth_name": "AUTHNAME-SECRET", "division": "แผนกลับ"}'::jsonb), true);
select set_config('t.com2', pg_temp.mk('COMPUTER', '{"device_code": "pd-com2", "reg_no": "pd-reg2", "name": "คอมทดสอบ 2 (มีทั้งสองรหัส)"}'::jsonb, '{"user_name": "สมหญิง ทดสอบ"}'::jsonb), true);
select set_config('t.comr', pg_temp.mk('COMPUTER', '{"device_code": "pd-comr", "name": "คอมที่เลิกใช้", "status": "retired"}'::jsonb), true);
select set_config('t.nb1', pg_temp.mk('LAPTOP', '{"reg_no": "pd-nbs1", "name": "โน้ตบุ๊กทดสอบ (มีแต่เลขทะเบียน)"}'::jsonb), true);
-- อุปกรณ์ของ PD-COM1
select pg_temp.mk('MONITOR', '{"device_code": "pd-mnt1", "reg_no": "pd-mnt-reg1", "name": "จอ 1", "model": "M1", "host_code": "pd-com1"}'::jsonb);
select pg_temp.mk('MONITOR', '{"device_code": "pd-mnt2", "name": "จอ 2", "host_code": "pd-com1"}'::jsonb);
select pg_temp.mk('PRINTER', '{"device_code": "pd-prt1", "name": "เครื่องพิมพ์ 1", "host_code": "pd-com1"}'::jsonb);
select pg_temp.mk('KEYBOARD', '{"reg_no": "pd-kyb1", "name": "คีย์บอร์ด (มีแต่เลขทะเบียน)", "host_code": "pd-com1"}'::jsonb);
select pg_temp.mk('MOUSE', '{"device_code": "pd-mou1", "name": "เมาส์ที่เลิกใช้", "host_code": "pd-com1", "status": "retired"}'::jsonb);
select pg_temp.mk('UPS', '{"device_code": "pd-ups1", "name": "UPS 1", "host_code": "pd-com1", "status": "broken"}'::jsonb);
select pg_temp.mk('PROJECTOR', '{"device_code": "pd-pjt1", "name": "โปรเจกเตอร์ 1", "host_code": "pd-com1"}'::jsonb);
select pg_temp.mk('RAM', '{"reg_no": "pd-ram1", "name": "RAM (ชนิดที่ฟอร์มไม่รองรับ)", "host_code": "pd-com1", "slot": "DIMM1"}'::jsonb);
-- อุปกรณ์ของเครื่องอื่น (ต้องไม่ปนใน PD-COM1)
select pg_temp.mk('MONITOR', '{"device_code": "pd-mnt3", "name": "จอของ PD-COM2", "host_code": "pd-com2"}'::jsonb);
select pg_temp.mk('MONITOR', '{"device_code": "pd-mnt-r2", "name": "จอผูกด้วยเลขทะเบียนของ PD-COM2", "host_code": "pd-reg2"}'::jsonb);
select pg_temp.mk('MONITOR', '{"device_code": "pd-mnt-nb", "name": "จอของโน้ตบุ๊ก", "host_code": "pd-nbs1"}'::jsonb);
-- อุปกรณ์ที่ไม่ผูกเครื่อง (ต้องไม่โผล่ที่ไหน)
select pg_temp.mk('PRINTER', '{"device_code": "pd-prt-free", "name": "เครื่องพิมพ์ไม่ผูกเครื่อง"}'::jsonb);

-- 3. ค้นเครื่อง (ผู้แจ้งทั่วไป ไม่ใช่ผู้ดูแลทะเบียน) -----------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.lk('pd-com1') -> 'host' ->> 'code', 'PD-COM1', 'the lookup finds a computer (code normalized to upper case)');
select is(pg_temp.lk('  pd-com1  ') -> 'host' ->> 'code', 'PD-COM1', 'leading and trailing spaces are trimmed');
select is(pg_temp.lk('PD-COM1') ->> 'found', 'true', 'found is true');
select is(pg_temp.lk('PD-COM1') -> 'host' ->> 'name', 'คอมทดสอบ 1', 'the machine name is returned');
select is(pg_temp.lk('PD-COM1') -> 'host' ->> 'user_name', 'สมชาย ทดสอบ', 'the user name is returned for the requester to confirm');
select is(pg_temp.lk('PD-COM1') -> 'host' ->> 'model', 'ModelX', 'the model is returned');
select is(pg_temp.lk('PD-COM1') -> 'host' ->> 'type_code', 'COMPUTER', 'the host type is returned');
select is(pg_temp.keys(pg_temp.lk('PD-COM1')), 'devices,found,host', 'the top level has exactly found, host and devices');
select is(pg_temp.keys(pg_temp.lk('PD-COM1') -> 'host'), 'code,model,name,type_code,user_name', 'the host has exactly code, type_code, name, model and user_name');
select is((select string_agg(distinct pg_temp.keys(d), '|') from jsonb_array_elements(pg_temp.lk('PD-COM1') -> 'devices') d), 'code,model,name,type_code', 'every device has exactly type_code, code, name and model');
select ok(position('SERIAL-SECRET-1' in pg_temp.lk('PD-COM1')::text) = 0 and position('AUTHNAME-SECRET' in pg_temp.lk('PD-COM1')::text) = 0 and position('แผนกลับ' in pg_temp.lk('PD-COM1')::text) = 0 and position('ห้องลับ' in pg_temp.lk('PD-COM1')::text) = 0 and position('123456' in pg_temp.lk('PD-COM1')::text) = 0, 'the answer carries no serial, Auth. name, division, place or price');
select is(pg_temp.lkdev('PD-COM1'), 'KEYBOARD:PD-KYB1,MONITOR:PD-MNT1,MONITOR:PD-MNT2,PRINTER:PD-PRT1,PROJECTOR:PD-PJT1,UPS:PD-UPS1', 'the devices are the supported types bound to the machine, ordered by type then code (the code is the device code, or the register number when there is none)');
select ok(position('PD-MOU1' in pg_temp.lk('PD-COM1')::text) = 0, 'a retired device is not offered');
select ok(position('PD-RAM1' in pg_temp.lk('PD-COM1')::text) = 0, 'a part type the form does not support (RAM) is not offered');
select ok(position('PD-MNT3' in pg_temp.lk('PD-COM1')::text) = 0 and position('PD-PRT-FREE' in pg_temp.lk('PD-COM1')::text) = 0, 'devices of another machine and unbound devices are not offered');
select is(pg_temp.lk('pd-reg2') -> 'host' ->> 'code', 'PD-COM2', 'the lookup also matches the register number (the answer uses the device code)');
select is(pg_temp.lkdev('PD-COM2'), 'MONITOR:PD-MNT-R2,MONITOR:PD-MNT3', 'devices bound by either the device code or the register number of the machine are offered');
select is(pg_temp.lk('pd-nbs1') -> 'host' ->> 'code', 'PD-NBS1', 'a laptop with only a register number is found by it');
select is(pg_temp.lk('pd-nbs1') -> 'host' ->> 'type_code', 'LAPTOP', 'its type is LAPTOP');
select is(pg_temp.lk('pd-nbs1') -> 'host' -> 'user_name', 'null'::jsonb, 'a laptop has no user name (null)');
select is(pg_temp.lkdev('PD-NBS1'), 'MONITOR:PD-MNT-NB', 'the devices of the laptop');
select is(pg_temp.lk('PD-COMR'), '{"found": false}'::jsonb, 'a retired computer is answered exactly like a missing one');
select is(pg_temp.lk('PD-NOPE'), '{"found": false}'::jsonb, 'an unknown code is not found');
select is(pg_temp.lk('PD-MNT1'), '{"found": false}'::jsonb, 'a monitor code is not a machine (not found)');
select is(pg_temp.lk('PD-CO'), '{"found": false}'::jsonb, 'no partial match');
select is(pg_temp.lk('PD-COM%'), '{"found": false}'::jsonb, 'a LIKE wildcard matches nothing');
select is(pg_temp.lk('PD_COM1'), '{"found": false}'::jsonb, 'an underscore is not a wildcard either');
select is(pg_temp.lk('PD COM1'), '{"found": false}'::jsonb, 'a code with a space is not found (no error)');
select is(pg_temp.lk('คอม'), '{"found": false}'::jsonb, 'a Thai text is not found (no error)');
select is(pg_temp.lk(repeat('A', 51)), '{"found": false}'::jsonb, 'a code longer than 50 characters is not found (no error)');
select is(pg_temp.lk('x'' or 1=1 --'), '{"found": false}'::jsonb, 'an injection-looking text is just not found');
select throws_ok($$ select pg_temp.lk('   ') $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'an empty code is rejected with a Thai message');
select throws_ok($$ select pg_temp.lk(null) $$, '23514', 'กรุณาระบุรหัสเครื่อง', 'a null code is rejected');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.lk('pd-com1') ->> 'found', 'true', 'an employee of another department can look up too (any requester may)');
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select throws_ok($$ select pg_temp.lk('pd-com1') $$, '42501', 'ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT', 'a deactivated user cannot look up');
select set_config('request.jwt.claims', '{"sub":"1d900000-0000-0000-0000-000000000099","role":"authenticated"}', true);
select throws_ok($$ select pg_temp.lk('pd-com1') $$, '42501', 'ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT', 'a signed-in user without an employee row cannot look up');
reset role;
set local role anon;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ select public.app_itrp_lookup_host('pd-com1') $$, '42501', null, 'anon cannot call the lookup (permission denied)');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.itas_assets limit 1 $$, '42501', null, 'the requester still cannot read the register directly (itas is not opened up)');
select throws_ok($$ select public.app_itas_list_assets() $$, null, null, 'nor through the register RPCs (they stay admin only)');

-- 4. แจ้งซ่อม: แบบเดิมยังใช้ได้ ------------------------------------------------
select set_config('t.old1', (select c.id::text from public.app_itrp_create(null, 'PC-01', 'repair', null, 'computer', null, 'เปิดไม่ติด', false) c), true);
select is((pg_temp.det(current_setting('t.old1')) ->> 'host_code'), null, 'a request made the old way has no host_code');
select is(pg_temp.det(current_setting('t.old1')) -> 'devices', '[]'::jsonb, 'and an empty devices list');
select lives_ok($$ select public.app_itrp_create(p_asset_code => null, p_device_name => 'PC-02', p_request_kind => 'repair', p_request_kind_note => null, p_repair_target => 'computer', p_repair_target_note => null, p_symptom => 'เรียกแบบเดิมตามชื่อ') $$, 'the old call by argument names (no urgency, no new arguments) still works');
select lives_ok($$ select public.app_itrp_create('COM24', 'PC-03', 'repair', null, 'computer', null, 'ส่ง asset_code แบบเดิม', true) $$, 'the old positional call with an urgent flag still works');
select is(pg_temp.q('select count(*) from public.itrp_request_devices')::int, 0, 'no device row is created by old-style calls');

-- 5. แจ้งซ่อม: แบบใหม่ ---------------------------------------------------------
select set_config('t.n1', pg_temp.req('pd-com1', jsonb_build_array(
  pg_temp.d('COMPUTER', 'pd-com1'), pg_temp.d('MONITOR', 'pd-mnt1'), pg_temp.d('monitor', ' pd-mnt2 '), pg_temp.d('KEYBOARD', 'PD-KYB1'),
  pg_temp.d('PRINTER', 'typed-prt'), pg_temp.d('OTHER', null, 'กล้องวงจรปิด'))), true);
select is(pg_temp.det(current_setting('t.n1')) ->> 'host_code', 'PD-COM1', 'the host_code is the canonical code found in the register');
select is(pg_temp.dv(current_setting('t.n1')), 'COMPUTER:PD-COM1:t,MONITOR:PD-MNT1:t,MONITOR:PD-MNT2:t,KEYBOARD:PD-KYB1:t,PRINTER:TYPED-PRT:f,OTHER:-:f', 'six devices in order; the ones the register binds to the machine are from_register = true (codes are normalized), a typed code and an OTHER row are false');
select is(pg_temp.q(format($q$ select string_agg(seq::text, ',' order by seq) from public.itrp_request_devices where request_id = %L::uuid $q$, current_setting('t.n1'))), '1,2,3,4,5,6', 'seq runs 1..6');
select is(pg_temp.q(format($q$ select note from public.itrp_request_devices where request_id = %L::uuid and type_code = 'OTHER' $q$, current_setting('t.n1'))), 'กล้องวงจรปิด', 'the OTHER row keeps its note');
select is(pg_temp.q(format($q$ select count(*) from public.itrp_request_devices where request_id = %L::uuid and not is_test $q$, current_setting('t.n1')))::int, 6, 'the rows are real (is_test false)');
select set_config('t.n2', pg_temp.req('PD-REG2', jsonb_build_array(pg_temp.d('COMPUTER', 'pd-reg2'), pg_temp.d('MONITOR', 'pd-mnt-r2'), pg_temp.d('MONITOR', 'pd-mnt3'))), true);
select is(pg_temp.det(current_setting('t.n2')) ->> 'host_code', 'PD-COM2', 'the host given by its register number is stored under its device code');
select is(pg_temp.dv(current_setting('t.n2')), 'COMPUTER:PD-REG2:t,MONITOR:PD-MNT-R2:t,MONITOR:PD-MNT3:t', 'a computer row with the register number is from_register; both monitors bound to that machine are too');
select set_config('t.n3', pg_temp.req('pd-nbs1', jsonb_build_array(pg_temp.d('LAPTOP', 'pd-nbs1'), pg_temp.d('MONITOR', 'pd-mnt-nb'))), true);
select is(pg_temp.dv(current_setting('t.n3')), 'LAPTOP:PD-NBS1:t,MONITOR:PD-MNT-NB:t', 'a laptop host works the same way');
select set_config('t.n4', pg_temp.req('pd-com1', jsonb_build_array(
  pg_temp.d('COMPUTER', 'pd-com2'), pg_temp.d('MOUSE', 'pd-mnt1'), pg_temp.d('MONITOR', 'pd-mnt3'), pg_temp.d('MONITOR', 'pd-mou1'), pg_temp.d('PRINTER'))), true);
select is(pg_temp.dv(current_setting('t.n4')), 'COMPUTER:PD-COM2:f,MOUSE:PD-MNT1:f,MONITOR:PD-MNT3:f,MONITOR:PD-MOU1:f,PRINTER:-:f', 'from_register is false for another machine, a wrong type, a device of another machine, a retired device and a row without a code');
select set_config('t.n7', pg_temp.req('PD-COM1', jsonb_build_array('{}'::jsonb, pg_temp.d('MONITOR', 'pd-mnt1'), '{"note": "  "}'::jsonb, pg_temp.d('PRINTER', 'pd-prt1'))), true);
select is(pg_temp.dv(current_setting('t.n7')), 'MONITOR:PD-MNT1:t,PRINTER:PD-PRT1:t', 'rows empty in every field are skipped and seq stays contiguous');
select is(pg_temp.q(format($q$ select max(seq) from public.itrp_request_devices where request_id = %L::uuid $q$, current_setting('t.n7')))::int, 2, 'seq of the kept rows is 1 and 2');
select lives_ok(pg_temp.reqsql('PD-COM1', (select jsonb_agg(pg_temp.d('MONITOR')) from generate_series(1, 10))), 'ten devices are accepted');
select is(pg_temp.q('select count(*) from public.itrp_request_devices where request_id = (select r.id from public.itrp_requests r order by r.doc_seq desc limit 1)')::int, 10, 'all ten rows were stored');

-- asset_code: เครื่องที่ยืนยันในทะเบียนแล้วถูกผูกด้วยรหัสมาตรฐานฝั่งฐานข้อมูล ไม่เชื่อค่าที่หน้าเว็บส่งมา (ประวัติซ่อม/เปลี่ยนชิ้นส่วนอ่านเครื่องของใบจาก asset_code)
select set_config('t.a1', (select c.id::text from public.app_itrp_create('WRONG-CODE', 'หน้าจอ', 'repair', null, 'device', null, 'ทดสอบ asset_code', false, 'pd-reg2', jsonb_build_array(pg_temp.d('MONITOR', 'pd-mnt3'))) c), true);
select is(pg_temp.det(current_setting('t.a1')) ->> 'asset_code', 'PD-COM2', 'a confirmed host replaces the asset_code sent by the page with the canonical register code (found here by its register number)');
select set_config('t.a2', (select c.id::text from public.app_itrp_create(null, 'คอม', 'repair', null, 'computer', null, 'ไม่ส่ง asset_code', false, 'pd-com1', jsonb_build_array(pg_temp.d('COMPUTER', 'pd-com1'))) c), true);
select is(pg_temp.det(current_setting('t.a2')) ->> 'asset_code', 'PD-COM1', 'a request that sends no asset_code still gets the host code, so the repair history knows the machine');

-- 6. แจ้งซ่อม: ผิดกติกา (ทั้งใบไม่เกิดขึ้น) --------------------------------------
select set_config('t.req_count', pg_temp.q('select count(*) from public.itrp_requests'), true);
select set_config('t.dev_count', pg_temp.q('select count(*) from public.itrp_request_devices'), true);
select set_config('t.seq_count', pg_temp.q('select coalesce(sum(last_seq), 0) from public.itrp_doc_counters'), true);
select throws_ok(pg_temp.reqsql('PD-NOPE', jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'a host that is not in the register is rejected (not unknown)');
select is(replace(pg_temp.try(pg_temp.reqsql('PD-COMR', jsonb_build_array(pg_temp.d('MONITOR')))), 'PD-COMR', 'X'), replace(pg_temp.try(pg_temp.reqsql('PD-NOPE', jsonb_build_array(pg_temp.d('MONITOR')))), 'PD-NOPE', 'X'), 'a retired host gets the same error as a missing one (no hint about its state)');
select throws_ok(pg_temp.reqsql('PD-MNT1', jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'a code of a non-computer is not accepted as the host');
select throws_ok(pg_temp.reqsql('PD COM1', jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'a host with a space is not found');
select throws_ok(pg_temp.reqsql(repeat('A', 51), jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร', 'a host longer than 50 characters is rejected');
select throws_ok(pg_temp.reqsql(null, jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'devices without a host and without "unknown" are rejected');
select throws_ok(pg_temp.reqsql('  ', jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'a blank host is the same as no host');
select throws_ok($$ select public.app_itrp_create(null, 'x', 'repair', null, 'computer', null, 'x', false, 'PD-COM1', null) $$, '23514', 'ต้องส่งรหัสเครื่องและรายการอุปกรณ์ที่มีปัญหาพร้อมกัน', 'a host without the devices argument is rejected (the two must come together)');
select throws_ok(pg_temp.reqsql('PD-COM1', '[]'::jsonb), '23514', 'กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ', 'an empty devices list is rejected in the new style');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array('{}'::jsonb, '{"note": " "}'::jsonb)), '23514', 'กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ', 'only empty rows count as none');
select throws_ok($$ select public.app_itrp_create(null, 'x', 'repair', null, 'computer', null, 'x', false, null, '[]'::jsonb) $$, '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'an explicit empty list without a host is the new style and is rejected');
select throws_ok($$ select public.app_itrp_create(null, 'x', 'repair', null, 'computer', null, 'x', false, 'PD-COM1', '{"type_code": "MONITOR"}'::jsonb) $$, '23514', 'กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ', 'devices that are not a list are rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', (select jsonb_agg(pg_temp.d('MONITOR')) from generate_series(1, 11))), '23514', 'อุปกรณ์ที่มีปัญหาต้องไม่เกิน 10 รายการ', 'more than ten devices are rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('MONITOR'), '"x"'::jsonb)), '23514', 'แถวที่ 2 ของรายการอุปกรณ์ไม่ถูกต้อง', 'a row that is not an object is rejected with its number');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('SCANNER', 'x1'))), '23514', 'แถวที่ 1: กรุณาเลือกชนิดอุปกรณ์', 'an unsupported type is rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('MONITOR'), pg_temp.d(null, 'pd-mnt1'))), '23514', 'แถวที่ 2: กรุณาเลือกชนิดอุปกรณ์', 'a row with a code but no type is rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('OTHER', 'abc'))), '23514', 'แถวที่ 1: กรุณาระบุอุปกรณ์ (เมื่อเลือก "อื่นๆ")', 'OTHER needs a note');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('OTHER', null, repeat('ก', 201)))), '23514', 'แถวที่ 1: หมายเหตุอุปกรณ์ต้องไม่เกิน 200 ตัวอักษร', 'a note longer than 200 characters is rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('MONITOR', repeat('B', 51)))), '23514', 'แถวที่ 1: รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร', 'a device code longer than 50 characters is rejected');
select throws_ok(pg_temp.reqsql('PD-COM1', jsonb_build_array(pg_temp.d('MONITOR', 'pd-mnt1'), pg_temp.d('PRINTER', 'PD-MNT1'))), '23514', 'แถวที่ 2: รหัสอุปกรณ์ PD-MNT1 ซ้ำกับแถวก่อนหน้า (ใส่รหัสเดียวกันสองครั้งในใบเดียวกันไม่ได้)', 'the same code twice in one request is rejected');
select is(pg_temp.q('select count(*) from public.itrp_requests'), current_setting('t.req_count'), 'no request was created by any of the rejected calls');
select is(pg_temp.q('select count(*) from public.itrp_request_devices'), current_setting('t.dev_count'), 'and no device row either');
select is(pg_temp.q('select coalesce(sum(last_seq), 0) from public.itrp_doc_counters'), current_setting('t.seq_count'), 'a rejected call (host not found, host or devices missing) does not use up a document number');

-- 7. รายละเอียดใบ -----------------------------------------------------------
select is((select count(*)::int from jsonb_object_keys(pg_temp.det(current_setting('t.n1')))), 38, 'get_detail has 38 keys (the 36 before + host_code, devices)');
select ok(pg_temp.det(current_setting('t.n1')) ?& array['host_code', 'devices'], 'the two new keys are present');
select ok(not (pg_temp.det(current_setting('t.n1')) ? 'host_unknown'), 'get_detail has no host_unknown key');
select is(pg_temp.keys(pg_temp.det(current_setting('t.n1')) -> 'devices' -> 0), 'device_code,from_register,note,seq,type_code', 'a device in the detail has exactly seq, type_code, device_code, from_register and note');
select is(pg_temp.det(current_setting('t.n1')) -> 'devices' -> 0 ->> 'type_code', 'COMPUTER', 'the first device is the computer');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.dv(current_setting('t.n1')), 'COMPUTER:PD-COM1:t,MONITOR:PD-MNT1:t,MONITOR:PD-MNT2:t,KEYBOARD:PD-KYB1:t,PRINTER:TYPED-PRT:f,OTHER:-:f', 'the department manager sees the same devices');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.det(current_setting('t.n1')) ->> 'host_code', 'PD-COM1', 'the IT approver sees the host code too');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(pg_temp.det(current_setting('t.n1')) ->> 'host_code', 'PD-COM1', 'and so does the IT admin');
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select throws_ok(format($$ select public.app_itrp_get_detail(%L::uuid) $$, current_setting('t.n1')), '42501', 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้', 'an employee of another department still cannot open the request (the devices do not widen who can see it)');

-- 8. ISO: เพิ่มได้อย่างเดียว ----------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok(format($$ update public.itrp_request_devices set device_code = 'HACK' where request_id = %L::uuid $$, current_setting('t.n1')), '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'a device row cannot be updated');
select throws_ok(format($$ update public.itrp_request_devices set from_register = true where request_id = %L::uuid $$, current_setting('t.n1')), '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'from_register cannot be switched afterwards');
select throws_ok(format($$ delete from public.itrp_request_devices where request_id = %L::uuid $$, current_setting('t.n1')), '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'a device row cannot be deleted');
select throws_ok($$ truncate public.itrp_request_devices $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'the table cannot be truncated');
select throws_ok(format($$ update public.itrp_requests set host_code = 'HACK' where id = %L::uuid $$, current_setting('t.n1')), '42501', 'ใบแจ้งซ่อมแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)', 'host_code of a request cannot be changed');
select throws_ok($$ insert into public.itrp_request_devices (is_test, request_id, seq, type_code, device_code) select false, r.id, 9, 'SCANNER', 'Z1' from public.itrp_requests r limit 1 $$, '23514', null, 'the table only accepts the nine documented types');
select throws_ok($$ insert into public.itrp_request_devices (is_test, request_id, seq, type_code) select false, r.id, 9, 'OTHER' from public.itrp_requests r limit 1 $$, '23514', null, 'the table itself requires a note for OTHER');
select lives_ok(format($$ update public.itrp_requests set status = status where id = %L::uuid $$, current_setting('t.n1')), 'a no-op update of the request still works (the guard only blocks content changes)');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select throws_ok($$ select * from public.itrp_request_devices $$, '42501', null, 'a signed-in user cannot read the table directly');
select throws_ok($$ insert into public.itrp_request_devices (request_id, seq, type_code) values (gen_random_uuid(), 1, 'MONITOR') $$, '42501', null, 'nor insert into it');
select throws_ok($$ delete from public.itrp_request_devices $$, '42501', null, 'nor delete from it');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select lives_ok(format($$ select public.app_itrp_approve(%L::uuid) $$, current_setting('t.n1')), 'the department manager can still approve a request that has devices');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select lives_ok(format($$ select public.app_itrp_approve(%L::uuid) $$, current_setting('t.n1')), 'and the IT approver too');
select is(pg_temp.det(current_setting('t.n1')) ->> 'status', 'approved', 'the request reached approved');
select is(pg_temp.dv(current_setting('t.n1')), 'COMPUTER:PD-COM1:t,MONITOR:PD-MNT1:t,MONITOR:PD-MNT2:t,KEYBOARD:PD-KYB1:t,PRINTER:TYPED-PRT:f,OTHER:-:f', 'the devices are unchanged by the approvals');

-- 9. โหมดทดสอบ: ทะเบียนแยกโลก + ล้างข้อมูลทดสอบ ------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select count(set_config('t.real_devices', (select count(*)::text from public.itrp_request_devices where not is_test), true));
select count(set_config('t.real_reqs', (select count(*)::text from public.itrp_requests where not is_test), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin enters the test mode as the IT admin persona');
select pg_temp.mk('COMPUTER', '{"device_code": "sbx-pc1", "name": "คอมทดสอบ (โหมดทดสอบ)"}'::jsonb, '{"user_name": "ผู้ใช้ทดสอบ"}'::jsonb);
select pg_temp.mk('MONITOR', '{"device_code": "sbx-mnt1", "name": "จอทดสอบ", "host_code": "sbx-pc1"}'::jsonb);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_d_staff')::uuid) $$, 'switching to the staff persona');
select is(pg_temp.lk('sbx-pc1') -> 'host' ->> 'user_name', 'ผู้ใช้ทดสอบ', 'the persona finds the test machine');
select is(pg_temp.lkdev('sbx-pc1'), 'MONITOR:SBX-MNT1', 'and its test devices');
select is(pg_temp.lk('pd-com1'), '{"found": false}'::jsonb, 'the persona cannot find a real machine (the answer is the same as for a missing code)');
select ok(position('PD-' in pg_temp.lk('sbx-pc1')::text) = 0, 'no real device shows up in a test answer');
select throws_ok(pg_temp.reqsql('pd-com1', jsonb_build_array(pg_temp.d('MONITOR', 'pd-mnt1'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'a test request cannot use a real machine as its host');
select set_config('t.s1', pg_temp.req('sbx-pc1', jsonb_build_array(pg_temp.d('COMPUTER', 'sbx-pc1'), pg_temp.d('MONITOR', 'sbx-mnt1'), pg_temp.d('MOUSE'))), true);
select is(pg_temp.dv(current_setting('t.s1')), 'COMPUTER:SBX-PC1:t,MONITOR:SBX-MNT1:t,MOUSE:-:f', 'a test request keeps its devices with from_register computed against the test register');
select is(pg_temp.det(current_setting('t.s1')) ->> 'host_code', 'SBX-PC1', 'and its host_code');
select ok(pg_temp.det(current_setting('t.s1')) ->> 'doc_no' like 'TEST-IT01-%', 'the test request has a TEST- number');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_request_devices where is_test), 3, 'three test device rows exist');
select ok((select bool_and(d.is_test = r.is_test) from public.itrp_request_devices d join public.itrp_requests r on r.id = d.request_id), 'every device row has the same mode as its request');
select is((select count(*)::int from public.itrp_request_devices where not is_test), current_setting('t.real_devices')::int, 'the real device rows are unchanged by the test mode');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.lk('sbx-pc1'), '{"found": false}'::jsonb, 'a real user cannot find a test machine');
select throws_ok(pg_temp.reqsql('sbx-pc1', jsonb_build_array(pg_temp.d('MONITOR'))), '23514', 'ไม่พบรหัสเครื่องในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT', 'nor use it as the host of a real request');
reset role;
select set_config('request.jwt.claims', '', true);
select count(set_config('t.test_rows', ((select count(*) from public.itrp_request_devices where is_test) + (select count(*) from public.itrp_requests where is_test) + (select count(*) from public.itrp_events where is_test) + (select count(*) from public.itrp_doc_counters where is_test))::text, true));
select ok(current_setting('t.test_rows')::int >= 6, 'the test mode left itrp test rows (3 devices, a request, its created event and a counter) to purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_d_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itrp() ->> 'deleted')::int, current_setting('t.test_rows')::int, 'the purge deletes every itrp test row, the device rows included');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_request_devices where is_test), 0, 'no test device row is left after the purge');
select is((select count(*)::int from public.itrp_request_devices where not is_test), current_setting('t.real_devices')::int, 'the real device rows survived the purge');
select is((select count(*)::int from public.itrp_requests where not is_test), current_setting('t.real_reqs')::int, 'and so did the real requests');
select throws_ok($$ delete from public.itrp_request_devices where not is_test $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real device rows still cannot be deleted after a purge');
select is(current_setting('itrp.purge', true), 'off', 'the purge flag is switched off again');
select is((select count(*)::int from public.itas_assets where is_test and device_code = 'SBX-PC1'), 1, 'the test register assets are removed by their own purge (app_sandbox_purge_itas), not by the itrp purge');

select * from finish();
rollback;
