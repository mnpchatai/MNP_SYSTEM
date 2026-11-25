-- ทดสอบการเปลี่ยน/ถอด/ย้าย/ติดตั้งชิ้นส่วนจากใบแจ้งซ่อม (20261225010000_itrp_itas_part_changes.sql) — เชื่อมโมดูล itrp กับทะเบียนอุปกรณ์ itas
--   1) โครงสร้าง: ตาราง itrp_part_changes (RLS/ไม่มี grant/trigger/ลงทะเบียนโหมดทดสอบ/append-only), RPC 3 ตัว anon เรียกไม่ได้, คอลัมน์อ้างใบใน itas, ตัวช่วยปิดจากผู้ใช้
--   2) สิทธิ์: ต้องเป็นผู้ดูแลงาน IT ของ itrp (itwo_staff) และอยู่ใน itas_admins ทั้งสองอย่าง · ผู้แจ้ง/ผู้จัดการ/ผู้อนุมัติ/คนอื่นเรียก context และ apply ไม่ได้
--   3) context: เครื่องของใบ + ชิ้นส่วนปัจจุบัน + ชิ้นสำรองแยกชนิด + เครื่องปลายทาง, can_apply ตามสถานะของใบ
--   4) apply ผิดกติกา: รูปแบบ/ช่องเกิน/ชิ้นไม่ได้ผูกเครื่อง/ชนิดไม่ตรง/ไม่ใช่ชิ้นสำรอง/ชิ้นซ้ำ/เครื่องไม่ใช่ของใบ/ปลายทางไม่มี — ทั้งก้อนไม่เกิด (atomic)
--   5) apply สำเร็จ 4 แบบ (replace/remove/move/install): สถานะ+host+slot ในทะเบียน, ประวัติ moves/log อ้างเลขที่ใบ, itrp_part_changes, ผลที่คืน, กดซ้ำถูกปฏิเสธ
--   6) ISO: itrp_part_changes แก้/ลบ/ล้างไม่ได้, การแก้ทะเบียนตามปกติไม่ติดเลขที่ใบ, ปลอมตั้ง itas.change_batch ไม่ได้ผล
--   7) get_part_changes: ผู้แจ้ง/ผู้จัดการแผนกอ่านได้ คนอื่นไม่ได้ ไม่มี id ของอุปกรณ์
--   8) โหมดทดสอบ: แยกโลก persona แตะของจริงไม่ได้ ล้างข้อมูลทดสอบลบ itrp_part_changes ของทดสอบและไม่แตะของจริง
-- ผู้ใช้ทดสอบเป็นบัญชีจริงใหม่ (ITP-*) ในแผนกทดสอบ ZPA ที่สร้างในไฟล์นี้ · persona SBX-IT-* มาจาก migration ใบสั่งงาน IT
begin;

create extension if not exists pgtap with schema extensions;
select plan(247);

-- ตัวช่วย (ชั่วคราว) ---------------------------------------------------------
-- claims ของผู้ใช้ทดสอบเลขที่ n
create function pg_temp.sub(n integer) returns text language sql as $$
  select format('{"sub":"1d700000-0000-0000-0000-%s","role":"authenticated"}', lpad(n::text, 12, '0')) $$;
-- ลองรันคำสั่ง: คืน 'OK' หรือ 'รหัส: ข้อความ'
create function pg_temp.try(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'OK';
exception when others then
  return sqlstate || ': ' || sqlerrm;
end $$;
-- ใบที่อนุมัติครบและเริ่มทำแล้ว (ผู้แจ้งคนที่ 1) · p_asset = รหัสเครื่องที่ผู้แจ้งกรอก (null ได้)
create function pg_temp.ready(p_asset text) returns uuid language plpgsql as $$
declare
  v_id uuid;
begin
  perform set_config('request.jwt.claims', pg_temp.sub(1), true);
  select c.id into v_id from public.app_itrp_create(p_asset, 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'อาการจากใบ', false) c;
  perform set_config('request.jwt.claims', pg_temp.sub(2), true);
  perform public.app_itrp_approve(v_id);
  perform set_config('request.jwt.claims', pg_temp.sub(4), true);
  perform public.app_itrp_approve(v_id);
  perform set_config('request.jwt.claims', pg_temp.sub(3), true);
  perform public.app_itrp_start(v_id);
  return v_id;
end $$;
-- ส่งงาน (IT ผู้ดูแลงาน = คนที่ 3) พร้อมเครื่องที่ซ่อม
create function pg_temp.done(p_id uuid, p_devices jsonb) returns uuid language sql as $$
  select public.app_itrp_complete(p_id, 'สายไฟหลวม', 'usage', null, 'internal', null, 'เสียบสายใหม่', null, '[]'::jsonb, p_devices) $$;
-- สร้างอุปกรณ์ในทะเบียน (ผู้ใช้ปัจจุบันต้องเป็น itas admin) แล้วจำ id ไว้ที่ t.<key>
create function pg_temp.mk(p_key text, p_type text, p_data jsonb) returns text language sql as $$
  select set_config('t.' || p_key, public.app_itas_save_asset(null, p_type, p_data) -> 'asset' ->> 'id', true) $$;
-- สถานะปัจจุบันของอุปกรณ์ในทะเบียน: 'สถานะ|เครื่อง|ช่อง'
create function pg_temp.st(p_key text) returns text language sql as $$
  select (a ->> 'status') || '|' || coalesce(a ->> 'host_code', '-') || '|' || coalesce(a ->> 'slot', '-')
  from (select public.app_itas_get_asset(current_setting('t.' || p_key)::uuid) a) x $$;
-- แถวของรายการเปลี่ยนชิ้นส่วน (ค่า null ไม่ส่ง) · asset/new = ชื่อ key ที่เก็บ id ไว้
create function pg_temp.cr(p_action text, p_host text, p_asset text, p_new text default null, p_result text default null,
                           p_to text default null, p_slot text default null, p_note text default null) returns jsonb language sql as $$
  select jsonb_strip_nulls(jsonb_build_object('action', p_action, 'host_code', p_host, 'asset_id', current_setting('t.' || p_asset, true),
    'new_asset_id', case when p_new is null then null else current_setting('t.' || p_new, true) end,
    'result_status', p_result, 'to_host_code', p_to, 'slot', p_slot, 'note', p_note)) $$;
-- คำสั่งเรียก apply (ข้อความ SQL) · p_req = ชื่อ key ของ id ใบ · p_rows = array ของ pg_temp.cr
create function pg_temp.ap(p_req text, p_rows jsonb) returns text language sql as $$
  select format('select public.app_itrp_apply_part_changes(%L::uuid, %L::jsonb)', current_setting('t.' || p_req), p_rows::text) $$;
create function pg_temp.ap1(p_req text, p_row jsonb) returns text language sql as $$
  select pg_temp.ap(p_req, jsonb_build_array(p_row)) $$;
create function pg_temp.mv(p_key text, p_idx integer default 0) returns jsonb language sql as $$
  select public.app_itas_asset_history(current_setting('t.' || p_key)::uuid) -> 'moves' -> p_idx $$;

-- 1. โครงสร้าง ----------------------------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = 'itrp_part_changes' and c.relkind = 'r' and c.relrowsecurity), 1, 'RLS is enabled on itrp_part_changes');
select ok(not exists (select 1 from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name = 'itrp_part_changes' and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')), 'anon, authenticated, service_role and PUBLIC have no direct grant on itrp_part_changes');
select ok(not exists (select 1 from pg_class c cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p(priv) cross join unnest(array['anon', 'authenticated', 'service_role']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname = 'itrp_part_changes' and has_table_privilege(r.rolname, c.oid, p.priv)), 'no role has any table privilege on itrp_part_changes (checked per privilege)');
select ok(not exists (select 1 from pg_class c cross join unnest(array['USAGE', 'SELECT', 'UPDATE']) p(priv) cross join unnest(array['service_role', 'anon', 'authenticated']) r(rolname) where c.relnamespace = 'public'::regnamespace and c.relname = 'itrp_part_changes_id_seq' and c.relkind = 'S' and has_sequence_privilege(r.rolname, c.oid, p.priv)), 'the identity sequence is closed');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'itrp_part_changes' and p.polname = 'itrp_part_changes_no_direct_access'), 1, 'the table has the deny-all policy');
select is((select count(*)::int from pg_policy p join pg_class c on c.oid = p.polrelid where c.relname = 'itrp_part_changes' and p.polname = 'lab_only_no_access' and not p.polpermissive), 1, 'the table has the restrictive lab-only policy');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'itrp_part_changes' and t.tgname = 'itrp_part_changes_sandbox_scope' and not t.tgisinternal), 1, 'the table has the sandbox scope trigger');
select is((select count(*)::int from pg_trigger t join pg_class c on c.oid = t.tgrelid where c.relname = 'itrp_part_changes' and t.tgname in ('itrp_part_changes_append_only', 'itrp_part_changes_no_truncate') and not t.tgisinternal), 2, 'the table is append-only (update/delete + truncate triggers)');
select ok('itrp_part_changes' = any (private.sandbox_unguarded_tables()), 'itrp_part_changes is registered in private.sandbox_unguarded_tables()');
select ok(array['itrp_requests', 'itrp_devices', 'itrp_history_entry_revisions', 'itas_assets', 'itas_asset_moves', 'itas_vault', 'itwo_work_orders', 'ncr_reports', 'audit_logs', 'sandbox_sessions', 'bom_gr_config', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables(), 'sandbox_unguarded_tables still keeps the earlier names (itrp, itas, itwo, BOM GR, rubberflow chemicals and central)');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_part_changes_context', 'app_itrp_apply_part_changes', 'app_itrp_get_part_changes')), 3, 'the three new RPCs exist');
select ok((select bool_and(has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and p.prosecdef and p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_part_changes_context', 'app_itrp_apply_part_changes', 'app_itrp_get_part_changes', 'app_itas_asset_history', 'app_sandbox_purge_itrp')), 'the new RPCs and the replaced public functions are SECURITY DEFINER with an empty search_path, callable by authenticated and not by anon');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_part_changes_require_admin', 'itrp_request_machine_codes', 'itrp_part_label', 'itrp_part_status_text', 'itrp_asset_brief', 'itrp_part_uuid', 'itrp_part_text', 'itrp_part_change_json', 'itas_change_source', 'itas_assets_moves', 'itas_assets_log') and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))), 'the private helpers and replaced trigger functions are not callable by anon or authenticated');
select ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p where p.pronamespace = 'private'::regnamespace and p.proname in ('itrp_part_changes_require_admin', 'itrp_request_machine_codes', 'itrp_part_label', 'itrp_part_status_text', 'itrp_asset_brief', 'itrp_part_uuid', 'itrp_part_text', 'itrp_part_change_json', 'itas_change_source', 'itas_assets_moves', 'itas_assets_log')), 'every new or replaced private function has an empty search_path');
select ok((select to_regprocedure('private.itrp_append_only_guard()') is not null and has_function_privilege('authenticated', 'private.itrp_storage_can_read(text, boolean)', 'execute')), 'the Storage helpers of itrp keep their grant to authenticated (this migration did not revoke the whole itrp_* group)');
select ok(not exists (select 1 from private.lab_only_unguarded_functions() f where f like '%part_changes%'), 'every new RPC has the lab-only guard');
select ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('app_itrp_part_changes_context', 'app_itrp_apply_part_changes', 'app_itrp_get_part_changes') and pg_get_functiondef(p.oid) like '%ใบสั่งงาน%'), 'the new messages say "ใบแจ้งซ่อม", never "ใบสั่งงาน"');
select ok(not exists (select 1 from pg_proc p where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and p.proname like '%part%' and p.proname like '%itrp%' and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.itwo_'), 'no part-changes function writes to any itwo table');
select ok(not exists (select 1 from pg_proc p where p.oid = 'public.app_itrp_apply_part_changes(uuid, jsonb)'::regprocedure and pg_get_functiondef(p.oid) ~* 'secrets'), 'the apply function never touches the secret columns (it cannot read or write ciphertext)');
select is((select count(*)::int from information_schema.columns c where c.table_schema = 'public' and c.table_name in ('itas_asset_moves', 'itas_asset_log') and c.column_name in ('source_request_id', 'source_doc_no') and c.is_nullable = 'YES'), 4, 'both itas history tables got two nullable source columns');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'app_itrp_complete'), 1, 'app_itrp_complete is untouched (still exactly one signature)');
select is((select count(*)::int from information_schema.columns c where c.table_schema = 'public' and c.table_name = 'itrp_part_changes' and c.column_name ~* '(pass|licen[sc]e|secret|key|serial)'), 0, 'the log has no column for passwords, license keys, serials or secrets');

-- 2. ข้อมูลทดสอบ (ผู้ใช้จริง ไม่ใช่ persona) ------------------------------
insert into public.departments (code, name_th, name_en) values ('ZPA', 'แผนกทดสอบ P (มีผู้จัดการ)', 'ZP A');
insert into auth.users (id, email, raw_user_meta_data)
select ('1d700000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid, 'itp-' || n || '@test.local', '{}'::jsonb
from generate_series(1, 9) n;
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, auth_user_id, is_active)
select v.no, 'ทดสอบ', v.no, lower(v.no) || '@itp.test', d.id, r.id, ('1d700000-0000-0000-0000-' || lpad(v.n::text, 12, '0'))::uuid, true
from (values
  (1, 'ITP-REQ', 'ZPA', 'staff'),
  (2, 'ITP-MGR', 'ZPA', 'department_manager'),
  (3, 'ITP-ADM', 'MGT', 'staff'),
  (4, 'ITP-APPR', 'MGT', 'general_manager'),
  (5, 'ITP-ITAS', 'MGT', 'staff'),
  (6, 'ITP-ADM2', 'MGT', 'staff'),
  (7, 'ITP-SBXADMIN', 'MGT', 'admin'),
  (8, 'ITP-OTHER', 'MGT', 'staff'),
  (9, 'ITP-REQ2', 'ZPA', 'staff')
) as v(n, no, dep, role)
join public.departments d on d.code = v.dep join public.roles r on r.code = v.role;
-- สิทธิ์ทีม IT ของใบ (itwo_staff): ADM/ADM2 = ผู้ดูแลงาน · APPR = ผู้อนุมัติขั้น IT · ITAS ไม่อยู่ในนี้
insert into public.itwo_staff (employee_id, is_it_admin, is_it_approver)
select e.id, v.adm, v.appr from (values ('ITP-ADM', true, false), ('ITP-APPR', false, true), ('ITP-ADM2', true, false)) v(no, adm, appr)
join public.employees e on e.employee_no = v.no;
-- สิทธิ์ทะเบียนอุปกรณ์ (itas_admins): ADM และ ITAS (ADM2 ไม่อยู่ในรายชื่อ)
insert into public.itas_admins (employee_id, is_test) select e.id, false from public.employees e where e.employee_no in ('ITP-ADM', 'ITP-ITAS');
insert into public.employees (employee_no, first_name, last_name, email, department_id, role_id, is_active, is_test) values
  ('SBX-P-STAFF', 'ทดสอบ', 'ผู้แจ้ง ZPA', 'sbx-p-staff@sandbox.local', (select id from public.departments where code = 'ZPA'), (select id from public.roles where code = 'staff'), false, true),
  ('SBX-P-MGR', 'ทดสอบ', 'ผจก. ZPA', 'sbx-p-mgr@sandbox.local', (select id from public.departments where code = 'ZPA'), (select id from public.roles where code = 'department_manager'), false, true);
select count(set_config('test.p_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where is_test;
select count(set_config('test.e_' || lower(replace(employee_no, '-', '_')), id::text, true)) from public.employees where employee_no like 'ITP-%';
select is((select count(*)::int from public.itrp_part_changes), 0, 'the part changes log is empty before the tests (clean database)');

-- ทะเบียนอุปกรณ์จริงของการทดสอบ (ผู้ดูแล ADM)
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select pg_temp.mk('com1', 'COMPUTER', '{"device_code": "itp-com1", "name": "คอมทดสอบ 1"}'::jsonb);
select pg_temp.mk('com2', 'COMPUTER', '{"device_code": "itp-com2", "name": "คอมทดสอบ 2"}'::jsonb);
select pg_temp.mk('com3', 'COMPUTER', '{"device_code": "itp-com3", "name": "คอมทดสอบ 3 (ไม่อยู่ในใบ)"}'::jsonb);
select pg_temp.mk('comr', 'COMPUTER', '{"device_code": "itp-comr", "name": "คอมที่เลิกใช้", "status": "retired"}'::jsonb);
select pg_temp.mk('ram_a', 'RAM', '{"reg_no": "itp-ram-a", "name": "RAM 8GB A", "host_code": "itp-com1", "slot": "DIMM1"}'::jsonb);
select pg_temp.mk('ram_a2', 'RAM', '{"reg_no": "itp-ram-a2", "name": "RAM 8GB A2", "host_code": "itp-com1", "slot": "DIMM2"}'::jsonb);
select pg_temp.mk('ram_b', 'RAM', '{"reg_no": "itp-ram-b", "name": "RAM 8GB สำรอง B", "status": "spare"}'::jsonb);
select pg_temp.mk('ram_c', 'RAM', '{"reg_no": "itp-ram-c", "name": "RAM 8GB สำรอง C", "status": "spare"}'::jsonb);
select pg_temp.mk('ram_d', 'RAM', '{"reg_no": "itp-ram-d", "name": "RAM 8GB สำรอง D", "status": "spare"}'::jsonb);
select pg_temp.mk('ram_bound', 'RAM', '{"reg_no": "itp-ram-bound", "name": "RAM ที่ใช้งานที่เครื่อง 3", "host_code": "itp-com3", "slot": "DIMM1"}'::jsonb);
select pg_temp.mk('ram_nohost', 'RAM', '{"reg_no": "itp-ram-nohost", "name": "RAM ใช้งานแต่ไม่ผูกเครื่อง"}'::jsonb);
select pg_temp.mk('hdd_a', 'STORAGE', '{"reg_no": "itp-hdd-a", "name": "HDD A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('hdd_b', 'STORAGE', '{"reg_no": "itp-hdd-b", "name": "SSD สำรอง B", "status": "spare"}'::jsonb);
select pg_temp.mk('mnt_a', 'MONITOR', '{"reg_no": "itp-mnt-a", "device_code": "itp-mnt-a", "name": "จอ A ชำรุด", "host_code": "itp-com1", "status": "broken"}'::jsonb);
select pg_temp.mk('mnt_s', 'MONITOR', '{"reg_no": "itp-mnt-s", "name": "จอสำรอง S", "status": "spare"}'::jsonb);
select pg_temp.mk('psu_r', 'PSU', '{"reg_no": "itp-psu-r", "name": "PSU เก่าที่เลิกใช้", "host_code": "itp-com1", "status": "retired"}'::jsonb);
select pg_temp.mk('mouse_a', 'MOUSE', '{"reg_no": "itp-mou-a", "name": "เมาส์ A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('kyb_a', 'KEYBOARD', '{"reg_no": "itp-kyb-a", "name": "คีย์บอร์ด A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('vga_a', 'VGA', '{"reg_no": "itp-vga-a", "name": "การ์ดจอ A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('cpu_a', 'CPU', '{"reg_no": "itp-cpu-a", "name": "CPU A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('cpu_b', 'CPU', '{"reg_no": "itp-cpu-b", "name": "CPU สำรอง B", "status": "spare"}'::jsonb);
select pg_temp.mk('rom_a', 'ROM', '{"reg_no": "itp-rom-a", "name": "ROM A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('case_a', 'CASE', '{"reg_no": "itp-case-a", "name": "เคส A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('lan_a', 'LAN_CARD', '{"reg_no": "itp-lan-a", "name": "การ์ดแลน A", "host_code": "itp-com1"}'::jsonb);
select pg_temp.mk('mb_a', 'MAINBOARD', '{"reg_no": "itp-mb-a", "name": "เมนบอร์ด A", "host_code": "itp-com1"}'::jsonb);

-- ใบทดสอบ (อนุมัติครบ เริ่มทำแล้ว) · r1 = เครื่อง ITP-COM1 · r2 = เครื่อง ITP-COM2 · r3 = ไม่มีรหัสเครื่อง · r4 = ยังรออนุมัติ
select set_config('t.r1', pg_temp.ready('itp-com1')::text, true);
select set_config('t.r2', pg_temp.ready('itp-com2')::text, true);
select set_config('t.r3', pg_temp.ready(null)::text, true);
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select set_config('t.r4', (select c.id::text from public.app_itrp_create('itp-com1', 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'ยังไม่อนุมัติ', false) c), true);
select set_config('t.d1', public.app_itrp_get_detail(current_setting('t.r1')::uuid) ->> 'doc_no', true);
select set_config('t.d2', public.app_itrp_get_detail(current_setting('t.r2')::uuid) ->> 'doc_no', true);
select ok(current_setting('t.d1') ~ '^IT01-[0-9]{2}/[0-9]{3}$' and current_setting('t.d1') <> current_setting('t.d2'), 'the test requests have their own document numbers');

-- 3. สิทธิ์ ------------------------------------------------------------------
reset role;
create temp table pg_temp_calls (name text, sql text);
insert into pg_temp_calls values
  ('context', 'select public.app_itrp_part_changes_context(current_setting(''t.r1'')::uuid)'),
  ('apply', 'select public.app_itrp_apply_part_changes(current_setting(''t.r1'')::uuid, ''[{"action":"install","host_code":"ITP-COM1","asset_id":"' || current_setting('t.ram_b') || '"}]''::jsonb)');
grant select on pg_temp_calls to authenticated;
set local role authenticated;
-- ผู้ดูแลงาน IT ของใบ (itwo admin) ที่ไม่อยู่ใน itas_admins
select set_config('request.jwt.claims', pg_temp.sub(6), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้', 'an itwo it_admin that is not in itas_admins cannot call ' || c.name) from pg_temp_calls c;
-- ผู้ใช้ทะเบียนอุปกรณ์ที่ไม่ใช่ผู้ดูแลงาน IT ของใบ
select set_config('request.jwt.claims', pg_temp.sub(5), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'an itas admin that is not an itwo it_admin cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'the IT approver cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'the department manager cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'the requester cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select is(pg_temp.try(c.sql), '42501: เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'a plain employee cannot call ' || c.name) from pg_temp_calls c;
select set_config('request.jwt.claims', '', true);
select is(substr(pg_temp.try(c.sql), 1, 5), '42501', 'a caller without a session cannot call ' || c.name) from pg_temp_calls c;
reset role;
set local role anon;
select throws_ok($$ select public.app_itrp_part_changes_context(gen_random_uuid()) $$, '42501', null, 'anon cannot read the context');
select throws_ok($$ select public.app_itrp_apply_part_changes(gen_random_uuid(), '[]'::jsonb) $$, '42501', null, 'anon cannot apply');
select throws_ok($$ select public.app_itrp_get_part_changes(gen_random_uuid()) $$, '42501', null, 'anon cannot read the part changes');
select throws_ok($$ select count(*) from public.itrp_part_changes $$, '42501', null, 'anon cannot read the table directly');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok($$ select count(*) from public.itrp_part_changes $$, '42501', null, 'even the IT admin cannot read the table directly (RPC only)');
select throws_ok($$ insert into public.itrp_part_changes (request_id, batch_id, line_no, action, host_code, asset_id, type_code, actor_id) values (current_setting('t.r1')::uuid, gen_random_uuid(), 1, 'install', 'X', gen_random_uuid(), 'RAM', current_setting('test.e_itp_adm')::uuid) $$, '42501', null, 'even the IT admin cannot insert into the table directly');
select throws_ok($$ select public.app_itrp_get_part_changes(gen_random_uuid()) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'an unknown request is not found');
select throws_ok($$ select public.app_itrp_part_changes_context(gen_random_uuid()) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'the context of an unknown request is not found');
select throws_ok($$ select public.app_itrp_apply_part_changes(gen_random_uuid(), '[{"action":"install"}]'::jsonb) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'applying to an unknown request is refused');

-- 4. context ------------------------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'request' ->> 'doc_no', current_setting('t.d1'), 'the context names the request');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) ->> 'can_apply', 'true', 'an in-progress request with a machine can take part changes');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'blocked_reason', 'null'::jsonb, 'and has no blocked reason');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) ->> 'max_changes', '20', 'the context states the limit of 20 rows');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'result_statuses', '["broken", "spare", "retired"]'::jsonb, 'and the statuses an old part can take');
select is(jsonb_array_length(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts'), 1, 'one machine (the asset code of the request)');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 ->> 'host_code', 'ITP-COM1', 'the machine code is trimmed and upper-cased');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 ->> 'source', 'request', 'it came from the requester');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 -> 'device' ->> 'name', 'คอมทดสอบ 1', 'the machine itself is the registry device with that code');
select is(jsonb_array_length(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 -> 'parts'), 12, 'twelve current parts (retired part and the machine itself are not listed; the broken monitor is)');
select ok(not exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 -> 'parts') p where p ->> 'id' in (current_setting('t.psu_r'), current_setting('t.com1'))), 'the retired part and the machine do not appear in the parts');
select ok(exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 -> 'parts') p where p ->> 'id' = current_setting('t.mnt_a') and p ->> 'status' = 'broken'), 'a broken part is listed (it can be replaced)');
select ok((select bool_and(p ? 'secrets' = false and p ? 'attrs' = false) from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 0 -> 'parts') p), 'the parts carry neither attrs nor secrets');
select is((select string_agg(g ->> 'type_code', ',' order by ord) from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'spares') with ordinality t(g, ord)), 'MONITOR,CPU,RAM,STORAGE', 'spares are grouped by type in the register order of the types');
select is((select jsonb_array_length(g -> 'items') from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'spares') g where g ->> 'type_code' = 'RAM'), 3, 'three spare RAM items (the bound and the no-host in-use ones are not spares)');
select ok(not exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'spares') g, jsonb_array_elements(g -> 'items') i where i ->> 'status' <> 'spare' or i ->> 'host_code' is not null), 'every listed spare is spare and unbound');
select ok(exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'move_targets') m where m ->> 'device_code' = 'ITP-COM2'), 'another machine is a move target');
select ok(not exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'move_targets') m where m ->> 'device_code' = 'ITP-COMR'), 'a retired machine is not a move target');
select is(public.app_itrp_part_changes_context(current_setting('t.r3')::uuid) ->> 'can_apply', 'false', 'a request without any machine code cannot take part changes yet');
select ok(public.app_itrp_part_changes_context(current_setting('t.r3')::uuid) ->> 'blocked_reason' like '%ยังไม่มีรหัสเครื่อง%', 'and says why (the machine must be named at delivery)');
select is(public.app_itrp_part_changes_context(current_setting('t.r4')::uuid) ->> 'can_apply', 'false', 'a request that is still waiting for approval cannot take part changes');
select ok(public.app_itrp_part_changes_context(current_setting('t.r4')::uuid) ->> 'blocked_reason' like '%กำลังดำเนินการหรือส่งงานแล้ว%', 'and says so');

-- 5. apply ผิดกติกา (ทุกข้อ: ไม่มีอะไรเปลี่ยน) ----------------------------------
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, '{"a": 1}'::jsonb) $$, current_setting('t.r1')), '23514', 'รายการเปลี่ยนชิ้นส่วนต้องเป็นรายการ', 'the changes must be an array');
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, null) $$, current_setting('t.r1')), '23514', 'รายการเปลี่ยนชิ้นส่วนต้องเป็นรายการ', 'null changes are refused');
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, '[]'::jsonb) $$, current_setting('t.r1')), '23514', 'กรุณาเลือกรายการเปลี่ยนชิ้นส่วนอย่างน้อย 1 รายการ', 'an empty list is refused');
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, (select jsonb_agg('{"action":"install"}'::jsonb) from generate_series(1, 21))) $$, current_setting('t.r1')), '23514', 'บันทึกการเปลี่ยนชิ้นส่วนได้ครั้งละไม่เกิน 20 รายการ', 'more than 20 rows are refused');
select throws_ok(pg_temp.ap('r1', '["x"]'::jsonb), '23514', 'แถวที่ 1: รูปแบบไม่ถูกต้อง', 'a row must be an object');
select throws_ok(pg_temp.ap1('r1', '{"action": "install", "foo": 1}'::jsonb), '23514', 'แถวที่ 1: ไม่รู้จักช่อง "foo"', 'an unknown field is refused');
select throws_ok(pg_temp.ap1('r1', '{"host_code": "ITP-COM1"}'::jsonb), '23514', 'แถวที่ 1: กรุณาเลือกประเภทรายการ (เปลี่ยนชิ้นส่วน ถอดออก ย้าย หรือติดตั้ง)', 'the action is required');
select throws_ok(pg_temp.ap1('r1', '{"action": "swap", "host_code": "ITP-COM1"}'::jsonb), '23514', 'แถวที่ 1: กรุณาเลือกประเภทรายการ (เปลี่ยนชิ้นส่วน ถอดออก ย้าย หรือติดตั้ง)', 'an unknown action is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', null, 'ram_b')), '23514', 'แถวที่ 1: กรุณาเลือกเครื่อง', 'the machine is required');
select throws_ok(pg_temp.ap1('r1', '{"action": "install", "host_code": "ITP-COM1"}'::jsonb), '23514', 'แถวที่ 1: กรุณาเลือกชิ้นส่วน', 'the part is required');
select throws_ok(pg_temp.ap1('r1', '{"action": "install", "host_code": "ITP-COM1", "asset_id": "not-a-uuid"}'::jsonb), '23514', 'แถวที่ 1: ชิ้นส่วน ไม่ถูกต้อง', 'a part id that is not a uuid is refused');
select throws_ok(pg_temp.ap1('r1', '{"action": "install", "host_code": "ITP-COM1", "asset_id": 5}'::jsonb), '23514', 'แถวที่ 1: ชิ้นส่วน ไม่ถูกต้อง', 'a part id that is not a string is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', null, 'broken')), '23514', 'แถวที่ 1: กรุณาเลือกชิ้นส่วนใหม่ที่จะใส่แทน', 'a replace needs the new part');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'ram_a', 'ram_b', 'broken')), '23514', 'แถวที่ 1: รายการประเภทนี้ไม่มีชิ้นส่วนใหม่', 'a remove must not carry a new part');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'ram_b')), '23514', 'แถวที่ 1: กรุณาเลือกสถานะของชิ้นเดิมที่ถอดออก (ชำรุด สำรอง หรือยกเลิกใช้งาน)', 'a replace needs the status of the old part');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'ram_a', null, 'in_use')), '23514', 'แถวที่ 1: กรุณาเลือกสถานะของชิ้นเดิมที่ถอดออก (ชำรุด สำรอง หรือยกเลิกใช้งาน)', 'the old part cannot stay in_use after it was removed');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_b', null, 'broken')), '23514', 'แถวที่ 1: รายการประเภทนี้ไม่ต้องระบุสถานะของชิ้นเดิม', 'an install must not carry a result status');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'ram_a')), '23514', 'แถวที่ 1: กรุณาเลือกเครื่องปลายทางที่จะย้ายไป', 'a move needs the destination');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'ram_a', null, 'spare', 'ITP-COM2')), '23514', 'แถวที่ 1: รายการประเภทนี้ไม่มีเครื่องปลายทาง', 'only a move has a destination');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_b', null, null, null, repeat('ก', 51))), '23514', 'แถวที่ 1: ช่อง/Slot ต้องไม่เกิน 50 ตัวอักษร', 'the slot is limited to 50 characters');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_b', null, null, null, null, repeat('ก', 201))), '23514', 'แถวที่ 1: หมายเหตุ ต้องไม่เกิน 200 ตัวอักษร', 'the note is limited to 200 characters');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_b', null, null, null, E'a\tb')), '23514', 'แถวที่ 1: ช่อง/Slot มีอักขระที่ใช้ไม่ได้', 'control characters are refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM3', 'ram_b')), '23514', 'แถวที่ 1: เครื่อง ITP-COM3 ไม่ได้อยู่ในรายการเครื่องของใบนี้ (รหัสเครื่องที่ผู้แจ้งกรอก หรือเครื่องที่ระบุตอนส่งงาน)', 'a machine that is not on the request is refused (even if it exists)');
select throws_ok(pg_temp.ap1('r3', pg_temp.cr('install', 'ITP-COM1', 'ram_b')), '23514', 'แถวที่ 1: เครื่อง ITP-COM1 ไม่ได้อยู่ในรายการเครื่องของใบนี้ (รหัสเครื่องที่ผู้แจ้งกรอก หรือเครื่องที่ระบุตอนส่งงาน)', 'a request without machines cannot apply anything');
select throws_ok(pg_temp.ap1('r4', pg_temp.cr('install', 'ITP-COM1', 'ram_b')), '23514', 'บันทึกการเปลี่ยนชิ้นส่วนได้เฉพาะใบที่ IT กำลังดำเนินการหรือส่งงานแล้ว · ใบแจ้งซ่อมนี้ไม่อยู่ในขั้นที่ทำรายการนี้ได้', 'a request waiting for approval cannot take part changes');
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, jsonb_build_array(jsonb_build_object('action', 'install', 'host_code', 'ITP-COM1', 'asset_id', gen_random_uuid()))) $$, current_setting('t.r1')), '23514', 'แถวที่ 1: ไม่พบชิ้นส่วนนี้ในทะเบียน (อาจเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่)', 'a part that is not in the register is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'ram_bound', null, 'spare')), '23514', 'แถวที่ 1: ITP-RAM-BOUND RAM ที่ใช้งานที่เครื่อง 3 ไม่ได้ติดตั้งที่เครื่อง ITP-COM1 ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)', 'a part bound to another machine cannot be removed from this one');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'ram_nohost', null, 'spare')), '23514', 'แถวที่ 1: ITP-RAM-NOHOST RAM ใช้งานแต่ไม่ผูกเครื่อง ไม่ได้ติดตั้งที่เครื่อง ITP-COM1 ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)', 'a part without a machine cannot be removed');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'psu_r', null, 'spare')), '23514', 'แถวที่ 1: ITP-PSU-R PSU เก่าที่เลิกใช้ มีสถานะ "ยกเลิกใช้งาน" จึงเปลี่ยน/ถอด/ย้ายไม่ได้ (ต้องเป็นใช้งานหรือชำรุด)', 'a retired part cannot be removed');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'com1', null, 'spare')), '23514', 'แถวที่ 1: ITP-COM1 คอมทดสอบ 1 ไม่ได้ติดตั้งที่เครื่อง ITP-COM1 ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)', 'the machine itself cannot be taken off itself (it is not bound to itself)');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'hdd_b', 'broken')), '23514', 'แถวที่ 1: ชนิดไม่ตรงกัน ชิ้นเดิมคือ RAM แต่ชิ้นใหม่คือ STORAGE (เปลี่ยนแทนกันได้เฉพาะชนิดเดียวกัน)', 'a new part of another type is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'ram_a2', 'broken')), '23514', 'แถวที่ 1: ชิ้นใหม่ ITP-RAM-A2 RAM 8GB A2 มีสถานะ "ใช้งาน" ใช้แทนได้เฉพาะชิ้นที่เป็นสำรอง', 'a new part that is in use is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'ram_nohost', 'broken')), '23514', 'แถวที่ 1: ชิ้นใหม่ ITP-RAM-NOHOST RAM ใช้งานแต่ไม่ผูกเครื่อง มีสถานะ "ใช้งาน" ใช้แทนได้เฉพาะชิ้นที่เป็นสำรอง', 'an in-use part without a machine is not a spare either');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_a2')), '23514', 'แถวที่ 1: ITP-RAM-A2 RAM 8GB A2 มีสถานะ "ใช้งาน" ติดตั้งได้เฉพาะชิ้นที่เป็นสำรอง', 'an install of a part that is in use is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'mnt_a')), '23514', 'แถวที่ 1: ITP-MNT-A จอ A ชำรุด มีสถานะ "ชำรุด" ติดตั้งได้เฉพาะชิ้นที่เป็นสำรอง', 'a broken part cannot be installed');
select throws_ok(pg_temp.ap('r1', jsonb_build_array(pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'ram_b', 'broken'), pg_temp.cr('install', 'ITP-COM1', 'ram_b'))), '23514', 'ใช้ชิ้นส่วนเดียวกันซ้ำในการบันทึกครั้งเดียวไม่ได้ (รวมชิ้นเดิมและชิ้นใหม่)', 'the same part cannot be used twice in one batch (new part of row 1 = part of row 2)');
select throws_ok(pg_temp.ap('r1', jsonb_build_array(pg_temp.cr('remove', 'ITP-COM1', 'ram_a', null, 'spare'), pg_temp.cr('move', 'ITP-COM1', 'ram_a', null, null, 'ITP-COM2'))), '23514', 'ใช้ชิ้นส่วนเดียวกันซ้ำในการบันทึกครั้งเดียวไม่ได้ (รวมชิ้นเดิมและชิ้นใหม่)', 'the same part twice as the main part is refused too');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'ram_a', null, null, 'ITP-COM1')), '23514', 'แถวที่ 1: เครื่องปลายทางต้องเป็นคนละเครื่องกับเครื่องเดิม', 'a move to the same machine is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'ram_a', null, null, 'ITP-NOPE')), '23514', 'แถวที่ 1: ไม่พบเครื่องปลายทาง ITP-NOPE ในทะเบียน (เลือกจากรายการเครื่องที่มีอยู่)', 'a move to a machine that is not in the register is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'ram_a', null, null, 'ITP-COMR')), '23514', 'แถวที่ 1: เครื่องปลายทาง ITP-COMR ยกเลิกใช้งานแล้ว', 'a move to a retired machine is refused');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'mnt_a', null, null, 'ITP-MNT-A')), '23514', 'แถวที่ 1: ย้ายเครื่องไปติดตั้งบนตัวมันเองไม่ได้', 'a device cannot be moved onto itself');
select throws_ok(pg_temp.ap('r1', jsonb_build_array(pg_temp.cr('install', 'ITP-COM1', 'ram_b'), pg_temp.cr('remove', 'ITP-COM1', 'ram_bound', null, 'spare'))), '23514', 'แถวที่ 2: ITP-RAM-BOUND RAM ที่ใช้งานที่เครื่อง 3 ไม่ได้ติดตั้งที่เครื่อง ITP-COM1 ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)', 'the error names the row that failed (row 2)');
select is(pg_temp.st('ram_b'), 'spare|-|-', 'atomic: row 1 of the failed batch did not happen (the spare is still a spare)');
select is(pg_temp.st('ram_a'), 'in_use|ITP-COM1|DIMM1', 'and the old part is untouched');
select is((select count(*)::int from (select 1 from public.app_itas_asset_history(current_setting('t.ram_b')::uuid) h, jsonb_array_elements(h -> 'moves')) x), 0, 'and no move was recorded');

-- 6. apply สำเร็จ ----------------------------------------------------------------
-- 6.1 เปลี่ยนชิ้นส่วน (RAM A -> สำรอง B) ชิ้นเดิมชำรุด ช่องเดิมตกทอดไปชิ้นใหม่
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'itp-com1', 'ram_a', 'ram_b', 'broken', null, null, 'เปลี่ยนเพราะเสีย')), 'a replace is applied (host code in lower case is accepted)');
select is(pg_temp.st('ram_a'), 'broken|-|-', 'the old part is broken and off the machine (host and slot cleared)');
select is(pg_temp.st('ram_b'), 'in_use|ITP-COM1|DIMM1', 'the new part is in use on the machine and took the slot of the old part');
select is(pg_temp.mv('ram_a') ->> 'source_doc_no', current_setting('t.d1'), 'the old part move record carries the repair request number');
select is(pg_temp.mv('ram_a') ->> 'source_request_id', current_setting('t.r1'), 'and the repair request id');
select is(pg_temp.mv('ram_a') ->> 'from_host', 'ITP-COM1', 'the move record: from the machine');
select is(pg_temp.mv('ram_a') -> 'to_host', 'null'::jsonb, 'to nowhere');
select is(pg_temp.mv('ram_a') ->> 'to_status', 'broken', 'status broken');
select is(pg_temp.mv('ram_a') ->> 'actor_employee_no', 'ITP-ADM', 'done by the IT admin');
select is(pg_temp.mv('ram_b') ->> 'source_doc_no', current_setting('t.d1'), 'the new part move record carries the request number too');
select is(pg_temp.mv('ram_b') ->> 'to_host', 'ITP-COM1', 'the new part: to the machine');
select is(pg_temp.mv('ram_b') ->> 'from_status', 'spare', 'from spare');
select is(public.app_itas_asset_history(current_setting('t.ram_a')::uuid) -> 'log' -> 0 ->> 'source_doc_no', current_setting('t.d1'), 'the change log of the old part names the request');
select is(public.app_itas_asset_history(current_setting('t.ram_b')::uuid) -> 'log' -> 0 ->> 'source_doc_no', current_setting('t.d1'), 'and the log of the new part');
select is(public.app_itas_asset_history(current_setting('t.ram_a')::uuid) -> 'log' -> 1 -> 'source_doc_no', 'null'::jsonb, 'older log rows (created by hand) have no request');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 ->> 'action', 'replace', 'the log of the request lists the replace');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 -> 'asset' ->> 'reg_no', 'ITP-RAM-A', 'it keeps a snapshot of the old part');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 -> 'new_asset' ->> 'reg_no', 'ITP-RAM-B', 'and of the new part');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 ->> 'result_status', 'broken', 'and the status of the old part');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 ->> 'note', 'เปลี่ยนเพราะเสีย', 'and the note');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 -> 'asset' ->> 'type_name', 'หน่วยความจำ (RAM)', 'the type name comes along for display');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 0 ->> 'actor_employee_no', 'ITP-ADM', 'and who did it');
select ok(not (public.app_itrp_get_part_changes(current_setting('t.r1')::uuid)::text like '%' || current_setting('t.ram_a') || '%'), 'the readable log never exposes the id of a register asset');
select is(public.app_itrp_get_part_changes(current_setting('t.r2')::uuid) -> 'items', '[]'::jsonb, 'another request has no part changes');
-- กดซ้ำ (ชิ้นเดิมไม่ได้อยู่ที่เครื่องนี้แล้ว / ชิ้นใหม่ไม่ใช่สำรองแล้ว)
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a', 'ram_c', 'broken')), '23514', 'แถวที่ 1: ITP-RAM-A RAM 8GB A ไม่ได้ติดตั้งที่เครื่อง ITP-COM1 ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)', 'applying the same replace again is refused (the old part is no longer on the machine)');
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'ram_a2', 'ram_b', 'broken')), '23514', 'แถวที่ 1: ชิ้นใหม่ ITP-RAM-B RAM 8GB สำรอง B มีสถานะ "ใช้งาน" ใช้แทนได้เฉพาะชิ้นที่เป็นสำรอง', 'a spare that was already used cannot be used again');
-- 6.2 ถอดออก (remove) ชิ้นเดิมเป็นสำรอง
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('remove', 'ITP-COM1', 'hdd_a', null, 'spare')), 'a remove is applied');
select is(pg_temp.st('hdd_a'), 'spare|-|-', 'the removed part is now a spare and off the machine');
select is(pg_temp.mv('hdd_a') ->> 'source_doc_no', current_setting('t.d1'), 'the removal names the request');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 1 ->> 'action', 'remove', 'the log lists the removal second');
select is(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items' -> 1 -> 'new_asset', 'null'::jsonb, 'a removal has no new part');
-- 6.3 ติดตั้งชิ้นสำรอง (install) พร้อมช่อง
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'mnt_s', null, null, null, 'HDMI1')), 'an install of a spare is applied');
select is(pg_temp.st('mnt_s'), 'in_use|ITP-COM1|HDMI1', 'the spare is in use on the machine in the chosen slot');
select is(pg_temp.mv('mnt_s') ->> 'source_doc_no', current_setting('t.d1'), 'the install names the request');
-- 6.4 ย้ายไปเครื่องอื่น (move) ใบ r1 เครื่อง COM1 -> COM2
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'mouse_a', null, null, 'itp-com2')), 'a move to another machine of the register is applied (destination in lower case is accepted)');
select is(pg_temp.st('mouse_a'), 'in_use|ITP-COM2|-', 'the part is on the other machine, status unchanged, slot cleared');
select is(pg_temp.mv('mouse_a') ->> 'from_host', 'ITP-COM1', 'the move record: from the first machine');
select is(pg_temp.mv('mouse_a') ->> 'to_host', 'ITP-COM2', 'to the second machine');
select is(pg_temp.mv('mouse_a') ->> 'source_doc_no', current_setting('t.d1'), 'and names the request');
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('move', 'ITP-COM1', 'kyb_a', null, null, 'ITP-COM3', 'USB2')), 'a move with a slot on the destination');
select is(pg_temp.st('kyb_a'), 'in_use|ITP-COM3|USB2', 'the slot is the one that was given');
-- ชิ้นที่ชำรุดเปลี่ยนได้ (จอชำรุด -> จอสำรอง)
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('replace', 'ITP-COM1', 'mnt_a', 'mnt_s', 'retired')), '23514', 'แถวที่ 1: ชิ้นใหม่ ITP-MNT-S จอสำรอง S มีสถานะ "ใช้งาน" ใช้แทนได้เฉพาะชิ้นที่เป็นสำรอง', 'the spare monitor was installed above so it is no spare any more');
-- 6.5 หลายแถวในก้อนเดียว (ใบ r1)
select is((public.app_itrp_apply_part_changes(current_setting('t.r1')::uuid, jsonb_build_array(
  pg_temp.cr('replace', 'ITP-COM1', 'cpu_a', 'cpu_b', 'retired', null, 'SOCKET'),
  pg_temp.cr('remove', 'ITP-COM1', 'rom_a', null, 'retired'),
  pg_temp.cr('move', 'ITP-COM1', 'vga_a', null, null, 'ITP-COM2'),
  pg_temp.cr('remove', 'ITP-COM1', 'lan_a', null, 'broken')))) ->> 'applied', '4', 'a batch of four rows of three kinds is applied at once');
select is(pg_temp.st('cpu_a'), 'retired|-|-', 'batch: the old CPU is retired');
select is(pg_temp.st('cpu_b'), 'in_use|ITP-COM1|SOCKET', 'batch: the new CPU is in use with the slot that was given');
select is(pg_temp.st('rom_a'), 'retired|-|-', 'batch: the ROM is removed as retired');
select is(pg_temp.st('vga_a'), 'in_use|ITP-COM2|-', 'batch: the VGA moved');
select is(pg_temp.st('lan_a'), 'broken|-|-', 'batch: the LAN card is removed as broken');
select is((select count(distinct m ->> 'source_doc_no')::int from (select jsonb_array_elements(public.app_itas_asset_history(current_setting('t.' || k)::uuid) -> 'moves') m from unnest(array['cpu_a', 'cpu_b', 'rom_a', 'vga_a', 'lan_a']) k) x where m ->> 'source_doc_no' is not null), 1, 'every move of the batch names the same request');
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items'), 9, 'the request now lists nine changes in the order they were saved');
select is((select string_agg(i ->> 'action', ',' order by ord) from jsonb_array_elements(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items') with ordinality t(i, ord) where ord > 5), 'replace,remove,move,remove', 'the batch keeps the order of the rows');
-- ผลที่คืนจาก apply
select is((public.app_itrp_apply_part_changes(current_setting('t.r2')::uuid, jsonb_build_array(pg_temp.cr('remove', 'ITP-COM2', 'vga_a', null, 'spare')))) -> 'changes' -> 0 -> 'asset' ->> 'reg_no', 'ITP-VGA-A', 'apply returns the saved change in the same shape as the reader (a part moved earlier can be removed from its new machine by another request)');
select is(pg_temp.st('vga_a'), 'spare|-|-', 'and it was applied (the part is a spare again)');
select is(pg_temp.mv('vga_a') ->> 'source_doc_no', current_setting('t.d2'), 'the newest move names the second request');
select is(pg_temp.mv('vga_a', 1) ->> 'source_doc_no', current_setting('t.d1'), 'while the older move still names the first');
-- ส่งงานแล้วยังบันทึกได้ (it_closed)
select lives_ok($$ select pg_temp.done(current_setting('t.r1')::uuid, '[{"device_code": "itp-com1"}, {"device_code": "itp-com3"}]'::jsonb) $$, 'the request is delivered by IT (with two machines)');
select is(public.app_itrp_get_detail(current_setting('t.r1')::uuid) ->> 'status', 'it_closed', 'it is now closed by IT');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) ->> 'can_apply', 'true', 'part changes can still be saved after IT delivered');
select is(jsonb_array_length(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts'), 2, 'and the machines named at delivery are added to the machines of the request');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) -> 'hosts' -> 1 ->> 'source', 'report', 'the second machine comes from the delivery');
select lives_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM3', 'ram_c')), 'a change on a machine named at delivery is applied');
select is(pg_temp.st('ram_c'), 'in_use|ITP-COM3|-', 'the spare is installed on that machine');
select is(pg_temp.mv('ram_c') ->> 'source_doc_no', current_setting('t.d1'), 'with the request number');
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select lives_ok($$ select public.app_itrp_receive(current_setting('t.r1')::uuid) $$, 'the requester confirms the work');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
select throws_ok(pg_temp.ap1('r1', pg_temp.cr('install', 'ITP-COM1', 'ram_d')), '23514', 'บันทึกการเปลี่ยนชิ้นส่วนได้เฉพาะใบที่ IT กำลังดำเนินการหรือส่งงานแล้ว · ใบแจ้งซ่อมนี้จบงานแล้ว (ได้รับงานแล้ว)', 'a finished request cannot take part changes any more');
select is(public.app_itrp_part_changes_context(current_setting('t.r1')::uuid) ->> 'can_apply', 'false', 'and its context says so');
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items'), 10, 'but the finished request still lists its ten changes');

-- 7. ไม่แตะข้อมูลอื่น + ไม่ติดเลขที่ใบเมื่อแก้ตามปกติ + ปลอมตั้ง change_batch ไม่ได้ผล -------------
select is((public.app_itas_get_asset(current_setting('t.ram_b')::uuid)) ->> 'name', 'RAM 8GB สำรอง B', 'the apply did not touch other fields of a part (name)');
select is((public.app_itas_get_asset(current_setting('t.ram_b')::uuid)) -> 'install_date', 'null'::jsonb, 'nor the install date (only status, machine and slot change)');
select is(current_setting('itas.change_batch', true), '', 'the batch marker is cleared when the apply is done');
select lives_ok(format($$ select public.app_itas_save_asset(%L::uuid, null, '{"note": "แก้ตามปกติ"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L::timestamptz) $$, current_setting('t.ram_b'), (public.app_itas_get_asset(current_setting('t.ram_b')::uuid)) ->> 'updated_at'), 'an ordinary edit of a part through the register works');
select is(public.app_itas_asset_history(current_setting('t.ram_b')::uuid) -> 'log' -> 0 -> 'source_doc_no', 'null'::jsonb, 'and its log row carries no request number');
select set_config('itas.change_batch', gen_random_uuid()::text, true);
select lives_ok(format($$ select public.app_itas_save_asset(%L::uuid, null, '{"note": "แก้อีกครั้ง"}'::jsonb, '{}'::jsonb, '{}'::jsonb, %L::timestamptz) $$, current_setting('t.ram_b'), (public.app_itas_get_asset(current_setting('t.ram_b')::uuid)) ->> 'updated_at'), 'an edit while someone has set a made-up batch marker works');
select is(public.app_itas_asset_history(current_setting('t.ram_b')::uuid) -> 'log' -> 0 -> 'source_doc_no', 'null'::jsonb, 'but a made-up marker does not stamp a request number on it');
select lives_ok(pg_temp.ap1('r2', pg_temp.cr('install', 'ITP-COM2', 'ram_d')), 'a second apply works after a made-up marker');
select is(current_setting('itas.change_batch', true), '', 'and clears the marker again (the made-up value is gone)');
select is(pg_temp.mv('ram_d') ->> 'source_doc_no', current_setting('t.d2'), 'and it stamps the real request number (the made-up marker did not matter)');
reset role;
select set_config('request.jwt.claims', '', true);
select throws_ok($$ update public.itrp_part_changes set note = 'x' $$, '42501', 'ประวัติการดำเนินการแก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'part changes cannot be updated');
select throws_ok($$ delete from public.itrp_part_changes $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'part changes cannot be deleted');
select throws_ok($$ truncate public.itrp_part_changes $$, '42501', 'ประวัติการดำเนินการล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)', 'part changes cannot be truncated');
select throws_ok($$ update public.itas_asset_moves set source_doc_no = 'IT01-26/999', source_request_id = gen_random_uuid() $$, '42501', 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)', 'the request number on a move record cannot be rewritten');
select throws_ok($$ insert into public.itas_asset_moves (is_test, asset_id, to_status, actor_id, source_doc_no) select false, id, 'in_use', created_by, 'IT01-26/001' from public.itas_assets limit 1 $$, '23514', null, 'a move record cannot carry a request number without a request id (and vice versa)');
select ok((select bool_and(c.is_test = r.is_test) from public.itrp_part_changes c join public.itrp_requests r on r.id = c.request_id), 'part changes always follow the mode of their request');
select is((select count(*)::int from public.itrp_part_changes where not is_test), 12, 'twelve real part changes were saved by the tests above (ten on r1, two on r2)');
select is((select count(*)::int from public.itas_asset_moves where source_doc_no is not null), (select count(distinct m.id)::int from public.itas_asset_moves m where m.source_doc_no is not null), 'every move record that names a request is a single row');
select ok((select bool_and(m.source_doc_no = r.doc_no) from public.itas_asset_moves m join public.itrp_requests r on r.id = m.source_request_id), 'the number on every move record is the number of the request it names');
select is((select count(*)::int from public.itas_asset_moves m where m.source_doc_no is not null), (select count(*)::int from public.itrp_part_changes c where c.action in ('remove', 'move', 'install')) + (select count(*)::int from public.itrp_part_changes c where c.action = 'replace') * 2, 'one move record per changed part (a replace changes two parts)');
select set_config('request.jwt.claims', pg_temp.sub(3), true);
set local role authenticated;

-- 8. get_part_changes: ใครอ่านได้ ------------------------------------------------
select set_config('request.jwt.claims', pg_temp.sub(1), true);
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items'), 10, 'the requester reads the part changes of the request');
select set_config('request.jwt.claims', pg_temp.sub(2), true);
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items'), 10, 'the manager of the department reads them too');
select set_config('request.jwt.claims', pg_temp.sub(4), true);
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) -> 'items'), 10, 'and the IT approver (IT team)');
select set_config('request.jwt.claims', pg_temp.sub(9), true);
select throws_ok($$ select public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'another requester cannot read them');
select set_config('request.jwt.claims', pg_temp.sub(8), true);
select throws_ok($$ select public.app_itrp_get_part_changes(current_setting('t.r1')::uuid) $$, '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'a plain employee of another department cannot read them');
select set_config('request.jwt.claims', pg_temp.sub(3), true);

-- 9. โหมดทดสอบ: แยกโลก + ล้างข้อมูลทดสอบ ------------------------------------
reset role;
select set_config('request.jwt.claims', '', true);
select count(set_config('t.real_changes', (select count(*)::text from public.itrp_part_changes where not is_test), true));
select count(set_config('t.real_moves', (select count(*)::text from public.itas_asset_moves where not is_test), true));
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_p_staff')::uuid) $$, 'the admin enters the test mode as a staff persona');
select set_config('t.s1', (select id::text from public.app_itrp_create('sbx-com1', 'เครื่องทดสอบ', 'repair', null, 'computer', null, 'อาการทดสอบ', false)), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_p_mgr')::uuid) $$, 'switching to the manager persona');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.s1')::uuid) $$, 'the persona manager approves');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_approver')::uuid) $$, 'switching to the IT approver persona');
select lives_ok($$ select public.app_itrp_approve(current_setting('t.s1')::uuid) $$, 'the persona IT approver approves');
select throws_ok($$ select public.app_itrp_part_changes_context(current_setting('t.s1')::uuid) $$, '42501', 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้', 'the IT approver persona cannot use the part changes');
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'switching to the IT admin persona');
select lives_ok($$ select public.app_itrp_start(current_setting('t.s1')::uuid) $$, 'the IT admin persona starts the test request');
select pg_temp.mk('s_com', 'COMPUTER', '{"device_code": "sbx-com1", "name": "คอมทดสอบ (โหมดทดสอบ)"}'::jsonb);
select pg_temp.mk('s_ram_old', 'RAM', '{"reg_no": "sbx-ram-1", "name": "RAM ทดสอบเดิม", "host_code": "sbx-com1", "slot": "A"}'::jsonb);
select pg_temp.mk('s_ram_new', 'RAM', '{"reg_no": "sbx-ram-2", "name": "RAM ทดสอบสำรอง", "status": "spare"}'::jsonb);
select is(jsonb_array_length(public.app_itrp_part_changes_context(current_setting('t.s1')::uuid) -> 'hosts' -> 0 -> 'parts'), 1, 'the test context sees only test parts (one part on the test machine)');
select is(jsonb_array_length(public.app_itrp_part_changes_context(current_setting('t.s1')::uuid) -> 'spares'), 1, 'and only the test spares');
select ok(not exists (select 1 from jsonb_array_elements(public.app_itrp_part_changes_context(current_setting('t.s1')::uuid) -> 'move_targets') m where m ->> 'device_code' like 'ITP-%'), 'and no real machine as a move target');
select throws_ok(pg_temp.ap1('s1', pg_temp.cr('replace', 'SBX-COM1', 'ram_b', 's_ram_new', 'broken')), '23514', 'แถวที่ 1: ไม่พบชิ้นส่วนนี้ในทะเบียน (อาจเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่)', 'the persona cannot take a real part as the old part');
select throws_ok(pg_temp.ap1('s1', pg_temp.cr('replace', 'SBX-COM1', 's_ram_old', 'ram_c', 'broken')), '23514', 'แถวที่ 1: ไม่พบชิ้นส่วนใหม่ในทะเบียน (อาจเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่)', 'nor a real spare as the new part');
select throws_ok(pg_temp.ap1('s1', pg_temp.cr('move', 'SBX-COM1', 's_ram_old', null, null, 'ITP-COM2')), '23514', 'แถวที่ 1: ไม่พบเครื่องปลายทาง ITP-COM2 ในทะเบียน (เลือกจากรายการเครื่องที่มีอยู่)', 'nor a real machine as the destination');
select throws_ok(format($$ select public.app_itrp_part_changes_context(%L::uuid) $$, current_setting('t.r2')), '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'the persona cannot open the context of a real request');
select throws_ok(format($$ select public.app_itrp_apply_part_changes(%L::uuid, '[{"action":"install"}]'::jsonb) $$, current_setting('t.r2')), '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'nor apply to a real request');
select throws_ok(format($$ select public.app_itrp_get_part_changes(%L::uuid) $$, current_setting('t.r1')), '23514', 'ไม่พบใบแจ้งซ่อมนี้', 'nor read the part changes of a real request');
select lives_ok(pg_temp.ap1('s1', pg_temp.cr('replace', 'SBX-COM1', 's_ram_old', 's_ram_new', 'spare', null, null, 'ทดสอบ')), 'the persona replaces a test part');
select is(pg_temp.st('s_ram_old'), 'spare|-|-', 'the old test part is a spare now');
select is(pg_temp.st('s_ram_new'), 'in_use|SBX-COM1|A', 'the new test part took the slot');
select is(pg_temp.mv('s_ram_new') ->> 'source_doc_no', (public.app_itrp_get_part_changes(current_setting('t.s1')::uuid)) ->> 'doc_no', 'the test move record names the test request');
select ok((public.app_itrp_get_part_changes(current_setting('t.s1')::uuid)) ->> 'doc_no' like 'TEST-IT01-%', 'whose number is a TEST- number');
select is(jsonb_array_length(public.app_itrp_get_part_changes(current_setting('t.s1')::uuid) -> 'items'), 1, 'one test change is listed');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_part_changes where is_test), 1, 'one test part change exists');
select is((select count(*)::int from public.itrp_part_changes where not is_test), current_setting('t.real_changes')::int, 'the real part changes are unchanged by the test mode');
select ok((select bool_and(m.is_test = a.is_test) from public.itas_asset_moves m join public.itas_assets a on a.id = m.asset_id), 'move rows follow the mode of their asset');
select is((select count(*)::int from public.itas_asset_moves where not is_test), current_setting('t.real_moves')::int, 'no real move record was added by the test mode');
select count(set_config('t.test_rows', ((select count(*) from public.itrp_requests where is_test) + (select count(*) from public.itrp_events where is_test) + (select count(*) from public.itrp_part_changes where is_test) + (select count(*) from public.itrp_doc_counters where is_test))::text, true));
select ok(current_setting('t.test_rows')::int >= 6, 'the test mode left some itrp test rows to purge');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_p_staff')::uuid) $$, 'the admin re-enters the test mode');
select is((public.app_sandbox_purge_itrp() ->> 'deleted')::int, current_setting('t.test_rows')::int, 'the purge deletes every itrp test row including the part changes');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itrp_part_changes where is_test), 0, 'no test part change is left');
select is((select count(*)::int from public.itrp_part_changes where not is_test), current_setting('t.real_changes')::int, 'the real part changes survived the purge');
select is((select count(*)::int from public.itas_assets where is_test and device_code = 'SBX-COM1'), 1, 'the test register assets are removed by their own purge (app_sandbox_purge_itas), not by the itrp purge');
select throws_ok($$ delete from public.itrp_part_changes where not is_test $$, '42501', 'ประวัติการดำเนินการลบไม่ได้ (บันทึกสำหรับ ISO)', 'real part changes still cannot be deleted after a purge');
select is(current_setting('itrp.purge', true), 'off', 'the purge flag is switched off again');
set local role authenticated;
select set_config('request.jwt.claims', pg_temp.sub(7), true);
select lives_ok($$ select public.app_sandbox_enter(current_setting('test.p_sbx_it_admin')::uuid) $$, 'the admin re-enters the test mode as the IT admin persona');
select lives_ok($$ select public.app_sandbox_purge_itas() $$, 'the register purge works after the itrp purge (no foreign key ties the two logs together)');
select lives_ok($$ select public.app_sandbox_exit() $$, 'the admin leaves the test mode');
reset role;
select set_config('request.jwt.claims', '', true);
select is((select count(*)::int from public.itas_assets where is_test), 0, 'no test asset is left after both purges');

select * from finish();
rollback;
