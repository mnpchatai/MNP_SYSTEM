-- ============================================================================
-- ประวัติการซ่อมเครื่องคอมพิวเตอร์ (IT01-FM02) — ส่วนเสริมของโมดูลใบแจ้งซ่อม (itrp) · ส่วนฐานข้อมูลอย่างเดียว (ยังไม่มีหน้าเว็บ ไม่นำเข้าข้อมูล)
--
-- ที่มา: สเปกที่เจ้าของตัดสิน 23/11/2026 (Work-Order/docs/itrp-history-spec.md รวม "เจ้าของตัดสินรอบ 2")
--   เป้าหมาย: IT กด "ส่งงาน" ครั้งเดียว ประวัติของเครื่องขึ้นเอง · IT เปิดดูประวัติรายเครื่องแบบ FM02 ได้ · ลงประวัติย้อนหลัง (ใบกระดาษ/Excel เก่า) ได้ในเว็บ
--
-- ตารางใหม่ (5) · ทุกตารางมี is_test + trigger private.sandbox_row_scope · RLS deny-all + ไม่มี grant ตรง (anon/authenticated/service_role) + lab-only
--   - itrp_devices               ทะเบียนเครื่องอย่างย่อ (รหัส ชนิด ผู้ใช้ แผนก Processor วันเริ่มใช้ เลขทะเบียนทรัพย์สิน สถานะ) · แก้ได้ (รหัสแก้ไม่ได้) ลบไม่ได้ (ปิดการใช้งานแทน)
--                                ไม่เก็บรหัสผ่าน/License key ใด ๆ (เจ้าของสั่ง: ข้อมูลลับจาก Excel ห้ามเข้าเว็บ/repo)
--   - itrp_device_log            ประวัติการเพิ่ม/แก้ทะเบียนเครื่อง (ค่าเดิม ค่าใหม่ ใคร เมื่อไร) · เพิ่มได้อย่างเดียว · เขียนโดย trigger บนตารางเครื่อง (เลี่ยงไม่ได้แม้ไม่ผ่าน RPC)
--   - itrp_report_devices        เครื่องที่ซ่อมต่อบันทึกการซ่อม 1 รอบ (0–10 แถว) · เพิ่มได้อย่างเดียวเหมือน itrp_repair_parts · เขียนผ่าน app_itrp_complete เท่านั้น
--   - itrp_history_entries       ประวัติที่ไม่ได้มาจากใบในระบบ: source import (นำเข้าจาก Excel ด้วยสคริปต์แยกภายหลัง) / manual (IT ลงย้อนหลังในเว็บ)
--                                แก้ได้แต่ทุกครั้งที่แก้/ยกเลิก trigger เก็บ "ฉบับก่อนแก้" ลง revisions ให้เอง · ลบไม่ได้ ทำได้แค่ "ยกเลิกรายการ" พร้อมเหตุผล
--   - itrp_history_entry_revisions ฉบับก่อนแก้/ก่อนยกเลิกของรายการข้างบน (snapshot ทั้งแถว + ใครแก้ + เมื่อไร) · เพิ่มได้อย่างเดียว
--
-- ประวัติของเครื่อง (app_itrp_device_history) = รวม 3 แหล่ง เรียงตามวันที่แจ้ง:
--   (ก) ใบในระบบที่ IT เคยส่งงานอย่างน้อย 1 ครั้งและสถานะไม่ใช่ cancelled/rejected (ขึ้นทันทีที่ส่งงาน ไม่รอผู้แจ้งยืนยัน) ใช้บันทึกการซ่อม "รอบล่าสุด"
--       เครื่องของใบ = แถวใน itrp_report_devices ของบันทึกรอบล่าสุด · ถ้ารอบล่าสุดไม่มีแถวเครื่องเลย (ส่งงานจากหน้าเว็บรุ่นเก่าที่ยังไม่ส่ง p_devices)
--       จะใช้รหัสเครื่องที่ผู้แจ้งกรอก (asset_code) แทน "ตอนอ่าน" (ไม่เขียนเพิ่มลงตารางใด ๆ) · อาการ/การแก้ไขของเครื่อง ว่าง = ใช้ของใบ
--   (ข)(ค) itrp_history_entries ที่ยังไม่ถูกยกเลิก · แยกโหมดจริง/ทดสอบตาม is_test (โหมดทดสอบเห็นเฉพาะข้อมูลทดสอบ)
--
-- สิทธิ์: อ่าน (ทะเบียน/ประวัติ) = ผู้ดูแลงาน IT (it_admin) + ผู้อนุมัติขั้น IT จาก itwo_staff · เขียน = it_admin เท่านั้น · anon เรียกไม่ได้
--   ผู้แจ้ง/ผู้จัดการแผนก/ทีม IT ที่ไม่ใช่สองกลุ่มข้างบน (เช่น persona SBX-IT-STAFF) อ่าน/เขียนไม่ได้
--
-- การตัดสินใจเรื่องโหมดทดสอบของทะเบียนเครื่อง: แยกแถวด้วย is_test เหมือนทุกตารางของ itrp (ไม่ใช้ทะเบียนจริงร่วมกัน)
--   เหตุผล: persona ทดสอบต้องแก้ทะเบียนจริงไม่ได้เด็ดขาด (trigger sandbox_row_scope บังคับ) และต้องลองเพิ่ม/แก้เครื่องได้จริงโดยไม่ปนของจริง
--   ข้อเสีย: โหมดทดสอบเริ่มจากทะเบียนว่าง (ต้องเพิ่มเครื่องทดสอบเอง) · ล้างด้วย app_sandbox_purge_itrp
--
-- app_itrp_complete: เพิ่ม p_devices jsonb default '[]' ท้ายพารามิเตอร์ (หน้าเว็บรุ่นเก่าที่ไม่ส่ง p_devices ยังเรียกได้เหมือนเดิม)
--   ต้อง "drop แล้ว create ใหม่" เพราะ create or replace เพิ่มพารามิเตอร์ไม่ได้ และเก็บฟังก์ชันเก่าไว้คู่กันไม่ได้ (PostgREST/Postgres จะเลือกไม่ได้ว่าเรียกตัวไหน)
--   ACL คงเดิมโดยรันชุด revoke/grant ท้ายไฟล์ซ้ำ (public/anon ถอน · authenticated ให้ execute) · ฟังก์ชันเดิมไม่มี comment
--   p_devices = array ≤10 แถว {"device_code": ข้อความ 1–50 (trim + ตัวพิมพ์ใหญ่ ห้ามซ้ำในรอบเดียวกัน), "symptom_note": ข้อความ ≤2000 หรือ null,
--     "action_note": ข้อความ ≤2000 หรือ null, "remark": ข้อเสนอแนะ ≤500 หรือ null} · แถวที่ว่างทุกช่องข้ามให้ · ผิดได้ข้อความ "แถวที่ N: …" ภาษาไทย
--
-- app_itrp_get_detail: ไม่ replace ตัวฟังก์ชัน · เพิ่มคีย์ devices[] ใน repair_report และ repair_reports[] (ผ่าน private.itrp_report_json) = เครื่องของบันทึกแต่ละรอบ
--
-- สิ่งที่แตะนอกจากของใหม่
--   1) replace private.sandbox_unguarded_tables() — เริ่มจากนิยามล่าสุดบน main (20261216010000_bom_gr_module.sql ทุกชื่อ) แล้วต่อ 5 ตารางใหม่ในส่วน to_regclass เดียวกับ itrp_*
--      ก่อน apply ต้องเทียบ md5(pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure)) บน prod · ถ้าไม่ตรงกับฉบับของ bom_gr (หรือฉบับ itrp เดิม
--      ถ้า bom_gr ยังไม่ถูก apply) ให้หยุดแล้วใช้ฉบับล่าสุดเป็นฐาน
--   2) replace private.itrp_report_json(uuid) (ของ itrp เอง) — เพิ่มคีย์ devices · คีย์เดิมไม่เปลี่ยน
--   3) replace public.app_sandbox_purge_itrp() (ของ itrp เอง) — ล้างแถว is_test ของ 5 ตารางใหม่ด้วย (ลูกก่อนแม่) และล็อกตารางใหม่
--   4) drop + create public.app_itrp_complete (ดูข้างบน)
--   ไม่แตะ: ตาราง/ฟังก์ชัน/trigger ของ itwo, ฟังก์ชันกลางของเพื่อน (นอกจาก sandbox_unguarded_tables), storage policy, bucket
--
-- ลำดับ deploy: migration นี้ต้อง apply ก่อนที่หน้าเว็บจะส่ง p_devices / เรียก RPC ใหม่ · หน้าเว็บรุ่นปัจจุบันบน main เรียก app_itrp_complete แบบเดิม (ไม่ส่ง p_devices) ได้ปกติ
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod, md5 ของ private.sandbox_unguarded_tables / private.itrp_report_json / public.app_sandbox_purge_itrp /
--   public.app_itrp_complete(uuid,text,text,text,text,text,text,text,jsonb) ว่าตรงกับฉบับที่ main ระบุ · หลัง apply ตรวจ: relrowsecurity ของ 5 ตาราง, ไม่มี grant ตรง,
--   RPC ใหม่ anon เรียกไม่ได้ และ app_itrp_complete เหลือฟังก์ชันเดียว (10 พารามิเตอร์)
--
-- Rollback (ยังไม่มีข้อมูลจริงในตารางใหม่): drop function public.app_itrp_history_get / _void / _update / _add / app_itrp_device_history / app_itrp_save_device / app_itrp_list_devices ·
--   drop function private.itrp_history_rows ·
--   drop function public.app_itrp_complete(uuid,text,text,text,text,text,text,text,jsonb,jsonb) แล้ว create ฉบับ 9 พารามิเตอร์จาก 20261212010000 กลับ (+ revoke/grant ตามส่วน 15 ของไฟล์นั้น) ·
--   create or replace private.itrp_report_json / public.app_sandbox_purge_itrp / private.sandbox_unguarded_tables กลับเป็นนิยามเดิม (ตัดชื่อ/คีย์ใหม่ออก) ·
--   drop table itrp_history_entry_revisions, itrp_history_entries, itrp_report_devices, itrp_device_log, itrp_devices (ลูกก่อนแม่) · drop function private.itrp_devices_*, itrp_history_entries_guard, itrp_norm_code, itrp_code_error
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itrp_repair_reports') is null or to_regclass('public.itrp_repair_parts') is null then
    raise exception 'ไม่พบตารางของโมดูลใบแจ้งซ่อม (itrp_repair_reports) กรุณา apply 20261212010000_itrp_repair_requests.sql ก่อน';
  end if;
  if to_regclass('public.itwo_staff') is null then
    raise exception 'ไม่พบตาราง itwo_staff (สิทธิ์ทีม IT) กรุณา apply migration ใบสั่งงาน IT ก่อน';
  end if;
  if to_regclass('public.bom_gr_config') is null then
    raise exception 'ไม่พบตาราง bom_gr_config กรุณา apply 20261216010000_bom_gr_module.sql ก่อน (รายชื่อ private.sandbox_unguarded_tables ต้องต่อจากฉบับนั้น)';
  end if;
end;
$$;

-- 1. ตาราง -----------------------------------------------------------------------
-- ทะเบียนเครื่องอย่างย่อ (รหัสเครื่องตัวพิมพ์ใหญ่ ไม่ซ้ำต่อโหมด) · แก้ได้ผ่าน app_itrp_save_device เท่านั้น · รหัสแก้ไม่ได้ ลบไม่ได้
create table public.itrp_devices (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code = upper(btrim(code)) and char_length(code) between 1 and 50 and code !~ '[[:cntrl:]]'),
  kind text not null default 'other' check (kind in ('computer', 'laptop', 'monitor', 'printer', 'ups', 'other')),
  user_name text check (user_name is null or (btrim(user_name) <> '' and char_length(user_name) <= 200)),
  division text check (division is null or (btrim(division) <> '' and char_length(division) <= 200)),
  cpu_name text check (cpu_name is null or (btrim(cpu_name) <> '' and char_length(cpu_name) <= 200)),
  cpu_model text check (cpu_model is null or (btrim(cpu_model) <> '' and char_length(cpu_model) <= 200)),
  started_on date check (started_on is null or started_on between date '1990-01-01' and date '2100-01-01'),
  asset_no text check (asset_no is null or (btrim(asset_no) <> '' and char_length(asset_no) <= 100)),
  status text not null default 'active' check (status in ('active', 'retired')),
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 1000)),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  unique (is_test, code),
  unique (id, is_test)
);
create index itrp_devices_created_by_idx on public.itrp_devices (created_by);
create index itrp_devices_updated_by_idx on public.itrp_devices (updated_by);
comment on table public.itrp_devices is
  'ทะเบียนเครื่องอย่างย่อสำหรับประวัติการซ่อม (FM02) · รหัสแก้ไม่ได้ ลบไม่ได้ (ปิดการใช้งานแทน) · ทุกการเพิ่ม/แก้ลง itrp_device_log โดย trigger · เขียนผ่าน app_itrp_save_device เท่านั้น · ไม่เก็บรหัสผ่าน/License key';

-- ประวัติการเพิ่ม/แก้ทะเบียนเครื่อง (เพิ่มได้อย่างเดียว) · old_values เป็น null ตอนเพิ่มเครื่อง
create table public.itrp_device_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  device_id uuid not null,
  device_code text not null,
  action text not null check (action in ('created', 'updated')),
  actor_id uuid not null references public.employees(id),
  old_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (device_id, is_test) references public.itrp_devices (id, is_test),
  constraint itrp_device_log_old_values_ck check ((action = 'created') = (old_values is null))
);
create index itrp_device_log_device_idx on public.itrp_device_log (device_id, id);
create index itrp_device_log_actor_idx on public.itrp_device_log (actor_id);
comment on table public.itrp_device_log is
  'ประวัติการเพิ่ม/แก้ทะเบียนเครื่อง (ค่าเดิม ค่าใหม่ ใคร เมื่อไร) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itrp_devices';

-- เครื่องที่ซ่อมต่อบันทึกการซ่อม 1 รอบ (เพิ่มได้อย่างเดียว) · รหัสเครื่องเป็นข้อความ ไม่บังคับว่าต้องมีในทะเบียน
create table public.itrp_report_devices (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  report_id uuid not null,
  seq smallint not null check (seq between 1 and 10),
  device_code text not null check (device_code = upper(btrim(device_code)) and char_length(device_code) between 1 and 50 and device_code !~ '[[:cntrl:]]'),
  -- ว่าง = ใช้อาการ/การซ่อมของใบ (ตัดสินตอนอ่านประวัติ)
  symptom_note text check (symptom_note is null or (btrim(symptom_note) <> '' and char_length(symptom_note) <= 2000)),
  action_note text check (action_note is null or (btrim(action_note) <> '' and char_length(action_note) <= 2000)),
  -- ข้อเสนอแนะต่อเครื่อง (ไม่บังคับ)
  remark text check (remark is null or (btrim(remark) <> '' and char_length(remark) <= 500)),
  created_at timestamptz not null default now(),
  foreign key (report_id, is_test) references public.itrp_repair_reports (id, is_test),
  unique (report_id, seq),
  unique (report_id, device_code)
);
create index itrp_report_devices_code_idx on public.itrp_report_devices (is_test, device_code);
comment on table public.itrp_report_devices is
  'เครื่อง/อุปกรณ์ที่ซ่อมในบันทึกการซ่อมแต่ละรอบ (0–10 แถว) · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_complete เท่านั้น';

-- ประวัติการซ่อมที่ไม่ได้มาจากใบในระบบ: import = นำเข้าจาก Excel (สคริปต์แยก) · manual = IT ลงย้อนหลังในเว็บ
-- แก้ได้แต่ trigger เก็บฉบับก่อนแก้ลง itrp_history_entry_revisions ทุกครั้ง · ลบไม่ได้ ยกเลิกได้ (voided_*) พร้อมเหตุผล และยกเลิกแล้วแก้อีกไม่ได้
create table public.itrp_history_entries (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  source text not null check (source in ('import', 'manual')),
  doc_no text check (doc_no is null or (btrim(doc_no) <> '' and char_length(doc_no) <= 50)),
  device_code text not null check (device_code = upper(btrim(device_code)) and char_length(device_code) between 1 and 50 and device_code !~ '[[:cntrl:]]'),
  reported_on date check (reported_on is null or reported_on between date '1990-01-01' and date '2100-01-01'),
  symptom text check (symptom is null or (btrim(symptom) <> '' and char_length(symptom) <= 2000)),
  action text check (action is null or (btrim(action) <> '' and char_length(action) <= 2000)),
  finished_on date check (finished_on is null or finished_on between date '1990-01-01' and date '2100-01-01'),
  remark text check (remark is null or (btrim(remark) <> '' and char_length(remark) <= 500)),
  reporter_name text check (reporter_name is null or (btrim(reporter_name) <> '' and char_length(reporter_name) <= 200)),
  -- ผู้ลง (ตอนนำเข้า = ผู้สั่งรันสคริปต์) + เวลา
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.employees(id),
  updated_at timestamptz,
  voided_by uuid references public.employees(id),
  voided_at timestamptz,
  void_reason text check (void_reason is null or (btrim(void_reason) <> '' and char_length(void_reason) <= 500)),
  unique (id, is_test),
  constraint itrp_history_entries_updated_ck check ((updated_by is null) = (updated_at is null)),
  constraint itrp_history_entries_void_ck check (
    (voided_at is null and voided_by is null and void_reason is null)
    or (voided_at is not null and voided_by is not null and void_reason is not null))
);
create index itrp_history_entries_code_idx on public.itrp_history_entries (is_test, device_code) where voided_at is null;
create index itrp_history_entries_created_by_idx on public.itrp_history_entries (created_by);
create index itrp_history_entries_updated_by_idx on public.itrp_history_entries (updated_by) where updated_by is not null;
create index itrp_history_entries_voided_by_idx on public.itrp_history_entries (voided_by) where voided_by is not null;
comment on table public.itrp_history_entries is
  'ประวัติการซ่อมเครื่องที่ไม่ได้มาจากใบในระบบ (import จาก Excel / manual ลงย้อนหลัง) · แก้ได้พร้อมเก็บรอยแก้ในตาราง revisions (trigger) · ลบไม่ได้ ยกเลิกรายการพร้อมเหตุผลได้ · เขียนผ่าน app_itrp_history_* เท่านั้น';

-- ฉบับก่อนแก้/ก่อนยกเลิก (เพิ่มได้อย่างเดียว) · snapshot = ทั้งแถวก่อนเปลี่ยน · change_kind void = ฉบับก่อนยกเลิก (reason = เหตุผลยกเลิก)
create table public.itrp_history_entry_revisions (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  entry_id bigint not null,
  revision_no integer not null check (revision_no >= 1),
  change_kind text not null check (change_kind in ('update', 'void')),
  snapshot jsonb not null,
  changed_by uuid not null references public.employees(id),
  reason text check (reason is null or char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  foreign key (entry_id, is_test) references public.itrp_history_entries (id, is_test),
  unique (entry_id, revision_no)
);
create index itrp_history_entry_revisions_changed_by_idx on public.itrp_history_entry_revisions (changed_by);
comment on table public.itrp_history_entry_revisions is
  'ฉบับก่อนแก้/ก่อนยกเลิกของ itrp_history_entries · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itrp_history_entries';

-- 2. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions'
  ] loop
    -- ถอน service_role ด้วย (เหตุผลเดียวกับตารางเดิมของ itrp: บันทึก ISO ต้องไม่ถูกเขียนตรงด้วย secret key)
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    for v_sequence in
      select format('%I.%I', n.nspname, s.relname)
      from pg_catalog.pg_class s
      join pg_catalog.pg_namespace n on n.oid = s.relnamespace
      join pg_catalog.pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
      where s.relkind = 'S' and d.refobjid = ('public.' || v_table)::regclass
    loop
      execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_sequence);
    end loop;
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
    -- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้
    execute format('select private.lab_only_guard_table(%L)', 'public.' || v_table);
  end loop;
end $$;

-- 3. ตัวช่วยรหัสเครื่อง + trigger ของแต่ละตาราง ----------------------------------------
-- รหัสเครื่องมาตรฐาน: ตัดช่องว่างหัวท้าย + ตัวพิมพ์ใหญ่ (ว่าง = null)
create or replace function private.itrp_norm_code(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(private.itrp_clean(p_text))
$$;

-- ข้อความผิดพลาดของรหัสเครื่องที่ผ่าน itrp_norm_code แล้ว (ผ่าน = null)
create or replace function private.itrp_code_error(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_code is null then 'กรุณาระบุรหัสเครื่อง'
    when char_length(p_code) > 50 then 'รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร'
    when p_code ~ '[[:cntrl:]]' then 'รหัสเครื่องมีอักขระที่ใช้ไม่ได้'
  end
$$;

-- ค่าที่แก้ได้ของทะเบียนเครื่อง (ใช้เทียบ/ลง log)
create or replace function private.itrp_device_values(p_device public.itrp_devices)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', p_device.kind, 'user_name', p_device.user_name, 'division', p_device.division,
    'cpu_name', p_device.cpu_name, 'cpu_model', p_device.cpu_model, 'started_on', p_device.started_on,
    'asset_no', p_device.asset_no, 'status', p_device.status, 'note', p_device.note)
$$;

-- ทะเบียนเครื่อง: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · แก้ได้ทุกคอลัมน์ยกเว้น id/โหมด/รหัส/ผู้และเวลาที่สร้าง
create or replace function private.itrp_devices_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itrp_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ทะเบียนเครื่องลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกการใช้งานแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ทะเบียนเครื่องล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.is_test, new.code, new.created_by, new.created_at)
     is distinct from (old.id, old.is_test, old.code, old.created_by, old.created_at) then
    raise exception 'รหัสเครื่องและผู้บันทึกแก้ไขไม่ได้ (ถ้ารหัสผิด ให้เพิ่มรหัสใหม่แล้วยกเลิกการใช้งานรหัสเดิม)' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;

-- ลง itrp_device_log ทุกครั้งที่เพิ่ม/แก้ทะเบียน (หลังบันทึก) · actor = updated_by · แก้โดยไม่เปลี่ยนค่าใด ๆ ไม่ลง log
create or replace function private.itrp_devices_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.itrp_device_log (is_test, device_id, device_code, action, actor_id, old_values, new_values)
    values (new.is_test, new.id, new.code, 'created', new.updated_by, null, private.itrp_device_values(new));
  elsif private.itrp_device_values(new) is distinct from private.itrp_device_values(old) then
    insert into public.itrp_device_log (is_test, device_id, device_code, action, actor_id, old_values, new_values)
    values (new.is_test, new.id, new.code, 'updated', new.updated_by, private.itrp_device_values(old), private.itrp_device_values(new));
  end if;
  return null;
end;
$$;

-- ประวัติย้อนหลัง/นำเข้า: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · แก้ได้เฉพาะเนื้อหา (รหัสเครื่อง เลขที่ใบ วันที่ อาการ การแก้ไข ซ่อมเสร็จ ข้อเสนอแนะ ผู้แจ้ง)
-- ทุกครั้งที่แก้เนื้อหา/ยกเลิก เก็บ "ฉบับก่อนแก้" (ทั้งแถว) ลง itrp_history_entry_revisions ในธุรกรรมเดียวกัน · ยกเลิกแล้วแก้/ยกเลิกซ้ำไม่ได้
create or replace function private.itrp_history_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_content_changed boolean;
  v_voiding boolean;
  v_revision_no integer;
begin
  if tg_op = 'DELETE' then
    if private.itrp_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติการซ่อมลบไม่ได้ ให้ยกเลิกรายการพร้อมเหตุผลแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ประวัติการซ่อมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  if (new.id, new.is_test, new.source, new.created_by, new.created_at)
     is distinct from (old.id, old.is_test, old.source, old.created_by, old.created_at) then
    raise exception 'แหล่งที่มา ผู้ลง และเวลาที่ลงของประวัติการซ่อมแก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  if old.voided_at is not null then
    raise exception 'รายการที่ยกเลิกแล้วแก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  v_voiding := new.voided_at is not null;
  v_content_changed := (new.device_code, new.doc_no, new.reported_on, new.symptom, new.action, new.finished_on, new.remark, new.reporter_name)
    is distinct from (old.device_code, old.doc_no, old.reported_on, old.symptom, old.action, old.finished_on, old.remark, old.reporter_name);

  if v_voiding then
    if v_content_changed then
      raise exception 'ยกเลิกรายการต้องไม่แก้เนื้อหาพร้อมกัน' using errcode = 'check_violation';
    end if;
  elsif v_content_changed then
    if new.updated_by is null then
      raise exception 'ต้องระบุผู้แก้ไข' using errcode = 'check_violation';
    end if;
    new.updated_at := now();
  else
    -- ไม่มีอะไรเปลี่ยน: ห้ามเปลี่ยนเฉพาะผู้แก้/เวลาแก้ (จะดูเหมือนแก้แต่ไม่มีรอยแก้)
    if (new.updated_by, new.updated_at) is distinct from (old.updated_by, old.updated_at) then
      raise exception 'แก้เฉพาะผู้แก้ไข/เวลาแก้ไม่ได้' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;

  select coalesce(max(r.revision_no), 0) + 1 into v_revision_no
  from public.itrp_history_entry_revisions r where r.entry_id = old.id;
  insert into public.itrp_history_entry_revisions (is_test, entry_id, revision_no, change_kind, snapshot, changed_by, reason)
  values (old.is_test, old.id, v_revision_no,
          case when v_voiding then 'void' else 'update' end,
          to_jsonb(old),
          case when v_voiding then new.voided_by else new.updated_by end,
          case when v_voiding then new.void_reason end);
  return new;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'itrp_devices', 'itrp_device_log', 'itrp_report_devices', 'itrp_history_entries', 'itrp_history_entry_revisions'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.sandbox_row_scope()',
                   v_table || '_sandbox_scope', v_table);
  end loop;
  -- เพิ่มได้อย่างเดียว: กัน UPDATE/DELETE (ยกเว้น purge แถวทดสอบ) และ TRUNCATE
  foreach v_table in array array['itrp_device_log', 'itrp_report_devices', 'itrp_history_entry_revisions'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.itrp_append_only_guard()',
                   v_table || '_append_only', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.itrp_append_only_guard()',
                   v_table || '_no_truncate', v_table);
  end loop;
end $$;

create trigger itrp_devices_guard before update or delete on public.itrp_devices
  for each row execute function private.itrp_devices_guard();
create trigger itrp_devices_no_truncate before truncate on public.itrp_devices
  for each statement execute function private.itrp_devices_guard();
create trigger itrp_devices_log after insert or update on public.itrp_devices
  for each row execute function private.itrp_devices_log();
-- ชื่อ trigger เรียงตัวอักษร: _guard ตรวจก่อน (เก็บรอยแก้ตอนผ่านแล้ว) แล้วค่อย _sandbox_scope
create trigger itrp_history_entries_guard before update or delete on public.itrp_history_entries
  for each row execute function private.itrp_history_entries_guard();
create trigger itrp_history_entries_no_truncate before truncate on public.itrp_history_entries
  for each statement execute function private.itrp_history_entries_guard();

-- 4. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- เริ่มจากนิยามล่าสุดบน main (20261216010000_bom_gr_module.sql) ครบทุกชื่อ + เพิ่ม 5 ตารางใหม่ในส่วน to_regclass ของ itrp_*
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 5. get_detail: เพิ่มคีย์เครื่องของบันทึกการซ่อม ----------------------------------------
-- replace private.itrp_report_json (ใช้ใน app_itrp_get_detail ทั้ง repair_report และ repair_reports[]) · คีย์เดิมไม่เปลี่ยน เพิ่ม devices[]
-- devices[] = เครื่องของบันทึกรอบนั้น เรียงตามลำดับที่ส่ง [{seq, device_code, symptom_note, action_note, remark}] · ไม่มี = []
create or replace function private.itrp_report_json(p_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'completed_event_id', r.completed_event_id,
    'completed_at', ev.created_at,
    'completed_by_employee_no', a.employee_no,
    'completed_by_full_name', a.first_name || ' ' || a.last_name,
    'cause', r.cause,
    'cause_kind', r.cause_kind,
    'cause_kind_note', r.cause_kind_note,
    'repair_method', r.repair_method,
    'repair_vendor', r.repair_vendor,
    'repair_action', r.repair_action,
    'pr_po_no', r.pr_po_no,
    'parts', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'line_no', p.line_no,
               'item_name', p.item_name,
               'quantity', p.quantity,
               'price', p.price,
               'note', p.note
             ) order by p.line_no), '[]'::jsonb)
      from public.itrp_repair_parts p
      where p.report_id = r.id),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'seq', d.seq,
               'device_code', d.device_code,
               'symptom_note', d.symptom_note,
               'action_note', d.action_note,
               'remark', d.remark
             ) order by d.seq), '[]'::jsonb)
      from public.itrp_report_devices d
      where d.report_id = r.id)
  )
  from public.itrp_repair_reports r
  join public.itrp_events ev on ev.id = r.completed_event_id
  join public.employees a on a.id = r.created_by
  where r.id = p_report_id
$$;

-- 6. IT ส่งงาน: เพิ่มเครื่องที่ซ่อม (p_devices) ---------------------------------------------
-- ต้อง drop ฉบับ 9 พารามิเตอร์ก่อน: create or replace เพิ่มพารามิเตอร์ไม่ได้ และถ้าเก็บไว้คู่กันการเรียกที่ไม่ส่ง p_devices จะกำกวม (ทั้ง Postgres และ PostgREST)
-- ฟังก์ชันใหม่มี p_devices default '[]' จึงรับการเรียกแบบเดิมได้ทุกรูปแบบ (ตามตำแหน่งหรือตามชื่อ) · ที่เหลือเหมือน 20261212010000 ทุกบรรทัด
drop function public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb);

-- IT ส่งงาน: บันทึกส่วน "สำหรับแผนก IT" (บันทึกการซ่อม + รายการอะไหล่ + เครื่องที่ซ่อม) พร้อมเปลี่ยนสถานะและ event completed ในธุรกรรมเดียว
--   ส่งงานได้เมื่อ in_progress และอนุมัติครบทั้งสองขั้นแล้วเท่านั้น (งานด่วนและงานที่ขอแก้ไขก็เช่นกัน) · เฉพาะผู้ดูแลงาน IT (it_admin ใน itwo_staff)
--   p_parts = jsonb array ≤10 แถว แต่ละแถว {"item_name": ข้อความ ≤200, "quantity": ตัวเลข >0 ทศนิยม ≤2 ตำแหน่ง, "price": ตัวเลข ≥0 ทศนิยม ≤2 ตำแหน่ง หรือ null, "note": ข้อความ ≤200 หรือ null}
--     แถวที่ว่างทุกช่องข้ามให้ · ลำดับแถว (line_no) นับตามลำดับที่ส่งมา
--   p_devices = jsonb array ≤10 แถว แต่ละแถว {"device_code": รหัสเครื่อง 1–50 (trim + ตัวพิมพ์ใหญ่ ห้ามซ้ำในรอบเดียวกัน), "symptom_note": ≤2000 หรือ null,
--     "action_note": ≤2000 หรือ null, "remark": ข้อเสนอแนะ ≤500 หรือ null} · แถวที่ว่างทุกช่องข้ามให้ · ไม่ส่ง/ส่งว่าง = ไม่มีเครื่อง (รองรับหน้าเว็บรุ่นเก่า)
--   คืน id ของบันทึกการซ่อมที่สร้าง
create or replace function public.app_itrp_complete(
  p_request_id uuid,
  p_cause text,
  p_cause_kind text,
  p_cause_kind_note text,
  p_repair_method text,
  p_repair_vendor text,
  p_repair_action text,
  p_pr_po_no text,
  p_parts jsonb default '[]'::jsonb,
  p_devices jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_dept_done boolean;
  v_it_done boolean;
  v_cause text := private.itrp_clean(p_cause);
  v_cause_note text := private.itrp_clean(p_cause_kind_note);
  v_vendor text := private.itrp_clean(p_repair_vendor);
  v_action text := private.itrp_clean(p_repair_action);
  v_pr_po text := private.itrp_clean(p_pr_po_no);
  v_parts jsonb := case when p_parts is null or jsonb_typeof(p_parts) = 'null' then '[]'::jsonb else p_parts end;
  v_devices jsonb := case when p_devices is null or jsonb_typeof(p_devices) = 'null' then '[]'::jsonb else p_devices end;
  c_decimal constant text := '^[0-9]{1,8}(\.[0-9]{1,2})?$';
  v_row jsonb;
  v_i integer;
  v_line integer := 0;
  v_item text;
  v_qty_text text;
  v_price_text text;
  v_note text;
  v_dev_code text;
  v_dev_symptom text;
  v_dev_action text;
  v_dev_remark text;
  v_dev_codes text[] := '{}';
  v_dev_seq integer := 0;
  v_code_error text;
  v_event_id bigint;
  v_report_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ส่งงานได้' using errcode = 'insufficient_privilege';
  end if;

  select * into v_req from public.itrp_requests w where w.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.status <> 'in_progress' then
    raise exception '%', case
      when v_req.status in ('pending_dept', 'pending_it_mgr', 'approved')
        then 'ใบแจ้งซ่อมต้องอยู่ในสถานะกำลังดำเนินการ (กดเริ่มทำก่อน) จึงจะส่งงานได้'
      when v_req.status = 'it_closed' then 'IT ส่งงานใบนี้ไปแล้ว'
      else private.itrp_status_message(v_req.status)
    end using errcode = 'check_violation';
  end if;

  select s.dept_done, s.it_done into v_dept_done, v_it_done from private.itrp_event_state(v_req.id) s;
  if not v_dept_done and not v_it_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกและผู้อนุมัติขั้น IT อนุมัติครบก่อน' using errcode = 'check_violation';
  elsif not v_dept_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกอนุมัติก่อน' using errcode = 'check_violation';
  elsif not v_it_done then
    raise exception 'ส่งงานไม่ได้ ต้องรอผู้อนุมัติขั้น IT อนุมัติก่อน' using errcode = 'check_violation';
  end if;

  -- ตรวจส่วน "สำหรับแผนก IT" ทั้งหมดก่อนแตะข้อมูล (ตารางก็มี CHECK ซ้ำอีกชั้น)
  if v_cause is null then
    raise exception 'กรุณาระบุสาเหตุ' using errcode = 'check_violation';
  end if;
  if char_length(v_cause) > 2000 then
    raise exception 'สาเหตุต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_cause_kind is null or p_cause_kind not in ('usage', 'part_expired', 'other') then
    raise exception 'กรุณาเลือกสรุปสาเหตุเกิดจาก' using errcode = 'check_violation';
  end if;
  if p_cause_kind = 'other' then
    if v_cause_note is null then
      raise exception 'กรุณาระบุสรุปสาเหตุ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_cause_note) > 200 then
      raise exception 'สรุปสาเหตุ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    v_cause_note := null;
  end if;
  if p_repair_method is null or p_repair_method not in ('internal', 'external_onsite', 'sent_out') then
    raise exception 'กรุณาเลือกการตรวจซ่อม' using errcode = 'check_violation';
  end if;
  if p_repair_method = 'sent_out' and v_vendor is null then
    raise exception 'กรุณาระบุสถานที่ที่ส่งซ่อม' using errcode = 'check_violation';
  end if;
  if v_vendor is not null and char_length(v_vendor) > 200 then
    raise exception 'ชื่อผู้ซ่อม/สถานที่ส่งซ่อมต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_repair_method = 'internal' then
    -- ซ่อมภายในไม่มีผู้ซ่อมภายนอก ล้างทิ้งกันข้อมูลตกค้าง
    v_vendor := null;
  end if;
  if v_action is null then
    raise exception 'กรุณาระบุการซ่อม-แก้ไขที่เกิดขึ้น' using errcode = 'check_violation';
  end if;
  if char_length(v_action) > 2000 then
    raise exception 'การซ่อม-แก้ไขที่เกิดขึ้นต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_pr_po is not null and char_length(v_pr_po) > 100 then
    raise exception 'เลขที่ PR./PO. ต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(v_parts) <> 'array' then
    raise exception 'รายการอะไหล่/วัสดุที่ใช้ต้องเป็นรายการ' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_parts) > 10 then
    raise exception 'รายการอะไหล่/วัสดุที่ใช้ต้องไม่เกิน 10 แถว' using errcode = 'check_violation';
  end if;
  -- ตรวจทุกแถวก่อนบันทึก (แถวที่ว่างทุกช่องข้าม · ตัวเลขรับเฉพาะเลขจำนวนเต็ม/ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ติดลบ ไม่เกิน 8 หลักก่อนจุด)
  for v_i in 0 .. jsonb_array_length(v_parts) - 1 loop
    v_row := v_parts -> v_i;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'แถวที่ % ของรายการอะไหล่/วัสดุไม่ถูกต้อง', v_i + 1 using errcode = 'check_violation';
    end if;
    v_item := private.itrp_clean(v_row ->> 'item_name');
    v_qty_text := private.itrp_clean(v_row ->> 'quantity');
    v_price_text := private.itrp_clean(v_row ->> 'price');
    v_note := private.itrp_clean(v_row ->> 'note');
    continue when v_item is null and v_qty_text is null and v_price_text is null and v_note is null;
    if v_item is null then
      raise exception 'แถวที่ %: กรุณาระบุรายการอะไหล่/วัสดุ', v_i + 1 using errcode = 'check_violation';
    end if;
    if char_length(v_item) > 200 then
      raise exception 'แถวที่ %: ชื่อรายการต้องไม่เกิน 200 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_qty_text is null then
      raise exception 'แถวที่ %: กรุณาระบุจำนวน', v_i + 1 using errcode = 'check_violation';
    end if;
    -- ตรวจรูปแบบก่อนแล้วค่อยแปลงเป็นตัวเลข (แยก if กัน cast ของข้อความผิดรูปแบบทำให้ error ที่ไม่ใช่ภาษาไทย)
    if v_qty_text !~ c_decimal then
      raise exception 'แถวที่ %: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_qty_text::numeric <= 0 then
      raise exception 'แถวที่ %: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_price_text is not null and v_price_text !~ c_decimal then
      raise exception 'แถวที่ %: ราคาต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_note is not null and char_length(v_note) > 200 then
      raise exception 'แถวที่ %: หมายเหตุต้องไม่เกิน 200 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
  end loop;

  -- เครื่อง/อุปกรณ์ที่ซ่อม (ใหม่): ตรวจทุกแถวก่อนบันทึก · แถวที่ว่างทุกช่องข้าม · รหัสเครื่องซ้ำกันในรอบเดียวกันไม่ได้
  if jsonb_typeof(v_devices) <> 'array' then
    raise exception 'รายการเครื่อง/อุปกรณ์ที่ซ่อมต้องเป็นรายการ' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(v_devices) > 10 then
    raise exception 'เครื่อง/อุปกรณ์ที่ซ่อมต้องไม่เกิน 10 รายการ' using errcode = 'check_violation';
  end if;
  for v_i in 0 .. jsonb_array_length(v_devices) - 1 loop
    v_row := v_devices -> v_i;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'แถวที่ % ของรายการเครื่อง/อุปกรณ์ไม่ถูกต้อง', v_i + 1 using errcode = 'check_violation';
    end if;
    v_dev_code := private.itrp_norm_code(v_row ->> 'device_code');
    v_dev_symptom := private.itrp_clean(v_row ->> 'symptom_note');
    v_dev_action := private.itrp_clean(v_row ->> 'action_note');
    v_dev_remark := private.itrp_clean(v_row ->> 'remark');
    continue when v_dev_code is null and v_dev_symptom is null and v_dev_action is null and v_dev_remark is null;
    v_code_error := private.itrp_code_error(v_dev_code);
    if v_code_error is not null then
      raise exception 'แถวที่ %: %', v_i + 1, v_code_error using errcode = 'check_violation';
    end if;
    if v_dev_code = any (v_dev_codes) then
      raise exception 'แถวที่ %: รหัสเครื่อง % ซ้ำกับแถวก่อนหน้า (ใส่รหัสเดียวกันสองครั้งในการส่งงานเดียวกันไม่ได้)', v_i + 1, v_dev_code using errcode = 'check_violation';
    end if;
    v_dev_codes := v_dev_codes || v_dev_code;
    if v_dev_symptom is not null and char_length(v_dev_symptom) > 2000 then
      raise exception 'แถวที่ %: อาการของเครื่องต้องไม่เกิน 2,000 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_dev_action is not null and char_length(v_dev_action) > 2000 then
      raise exception 'แถวที่ %: การแก้ไขของเครื่องต้องไม่เกิน 2,000 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
    if v_dev_remark is not null and char_length(v_dev_remark) > 500 then
      raise exception 'แถวที่ %: ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
    end if;
  end loop;

  update public.itrp_requests set status = 'it_closed' where id = v_req.id;
  insert into public.itrp_events (is_test, request_id, actor_id, action)
  values (v_req.is_test, v_req.id, v_actor.id, 'completed')
  returning id into v_event_id;

  insert into public.itrp_repair_reports (
    is_test, request_id, completed_event_id, cause, cause_kind, cause_kind_note,
    repair_method, repair_vendor, repair_action, pr_po_no, created_by)
  values (
    v_req.is_test, v_req.id, v_event_id, v_cause, p_cause_kind, v_cause_note,
    p_repair_method, v_vendor, v_action, v_pr_po, v_actor.id)
  returning id into v_report_id;

  for v_i in 0 .. jsonb_array_length(v_parts) - 1 loop
    v_row := v_parts -> v_i;
    v_item := private.itrp_clean(v_row ->> 'item_name');
    v_qty_text := private.itrp_clean(v_row ->> 'quantity');
    v_price_text := private.itrp_clean(v_row ->> 'price');
    v_note := private.itrp_clean(v_row ->> 'note');
    continue when v_item is null and v_qty_text is null and v_price_text is null and v_note is null;
    v_line := v_line + 1;
    insert into public.itrp_repair_parts (is_test, report_id, line_no, item_name, quantity, price, note)
    values (v_req.is_test, v_report_id, v_line, v_item, v_qty_text::numeric, v_price_text::numeric, v_note);
  end loop;

  for v_i in 0 .. jsonb_array_length(v_devices) - 1 loop
    v_row := v_devices -> v_i;
    v_dev_code := private.itrp_norm_code(v_row ->> 'device_code');
    v_dev_symptom := private.itrp_clean(v_row ->> 'symptom_note');
    v_dev_action := private.itrp_clean(v_row ->> 'action_note');
    v_dev_remark := private.itrp_clean(v_row ->> 'remark');
    continue when v_dev_code is null and v_dev_symptom is null and v_dev_action is null and v_dev_remark is null;
    v_dev_seq := v_dev_seq + 1;
    insert into public.itrp_report_devices (is_test, report_id, seq, device_code, symptom_note, action_note, remark)
    values (v_req.is_test, v_report_id, v_dev_seq, v_dev_code, v_dev_symptom, v_dev_action, v_dev_remark);
  end loop;

  return v_report_id;
end;
$$;

-- 7. ประวัติการซ่อมรายเครื่อง + ทะเบียนเครื่อง ------------------------------------------
-- แถวประวัติของเครื่อง (หรือทุกเครื่องถ้า p_code เป็น null) รวม 3 แหล่งในโหมดที่ระบุ · ใช้ภายในเท่านั้น (ผู้เรียกตรวจสิทธิ์/โหมดมาแล้ว)
--   source = request (ใบในระบบ) | import | manual · entry_id ว่างเมื่อมาจากใบ · request_id ว่างเมื่อมาจาก entries
--   ใบ: ต้องเคยส่งงาน (มีบันทึกการซ่อม) และสถานะไม่ใช่ cancelled/rejected · ใช้บันทึกรอบล่าสุด · วันที่แจ้ง/ซ่อมเสร็จเป็นวันที่เวลาไทย
--   เครื่องของใบ = แถวใน itrp_report_devices ของรอบล่าสุด ถ้าไม่มีแถวเลย ใช้ asset_code ที่ผู้แจ้งกรอก (หน้าเว็บรุ่นเก่า) · อาการ/การแก้ไขของเครื่อง ว่าง = ใช้ของใบ/ของบันทึก
create or replace function private.itrp_history_rows(p_is_test boolean, p_code text default null)
returns table(
  h_device_code text, h_source text, h_entry_id bigint, h_request_id uuid, h_request_status text, h_doc_no text,
  h_reported_on date, h_symptom text, h_action text, h_finished_on date, h_remark text, h_reporter_name text,
  h_revision_count integer, h_updated_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(d.device_code, upper(btrim(rq.asset_code))),
         'request'::text, null::bigint, rq.id, rq.status, rq.doc_no,
         (rq.created_at at time zone 'Asia/Bangkok')::date,
         coalesce(d.symptom_note, rq.symptom),
         coalesce(d.action_note, lr.repair_action),
         (ev.created_at at time zone 'Asia/Bangkok')::date,
         d.remark,
         emp.first_name || ' ' || emp.last_name,
         0, null::timestamptz
  from public.itrp_requests rq
  join lateral (
    select r.id, r.completed_event_id, r.repair_action
    from public.itrp_repair_reports r
    where r.request_id = rq.id
    order by r.completed_event_id desc
    limit 1
  ) lr on true
  join public.itrp_events ev on ev.id = lr.completed_event_id
  join public.employees emp on emp.id = rq.requester_id
  left join public.itrp_report_devices d on d.report_id = lr.id
  where rq.is_test = p_is_test
    and rq.status not in ('cancelled', 'rejected')
    and coalesce(d.device_code, upper(btrim(rq.asset_code))) is not null
    and (p_code is null or coalesce(d.device_code, upper(btrim(rq.asset_code))) = p_code)
  union all
  select e.device_code, e.source, e.id, null::uuid, null::text, e.doc_no,
         e.reported_on, e.symptom, e.action, e.finished_on, e.remark, e.reporter_name,
         (select count(*)::integer from public.itrp_history_entry_revisions r where r.entry_id = e.id),
         e.updated_at
  from public.itrp_history_entries e
  where e.is_test = p_is_test and e.voided_at is null
    and (p_code is null or e.device_code = p_code)
$$;

-- ประวัติการซ่อมของเครื่องหนึ่งเครื่อง (รูปแบบ FM02): หัวจากทะเบียน (device = null ถ้ารหัสไม่อยู่ในทะเบียนของโหมดนี้) + แถวเรียงตามวันที่แจ้ง (เก่าสุดก่อน)
--   rows[] = {source, entry_id, request_id, request_status, doc_no, reported_on, symptom, action, finished_on, remark, reporter_name, revision_count, updated_at}
--   7 คอลัมน์ของ FM02 = doc_no, reported_on, symptom, action, finished_on, remark, reporter_name · อ่านได้เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT
create or replace function public.app_itrp_device_history(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := private.itrp_norm_code(p_code);
  v_code_error text;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  v_code_error := private.itrp_code_error(v_code);
  if v_code_error is not null then
    raise exception '%', v_code_error using errcode = 'check_violation';
  end if;

  return jsonb_build_object(
    'code', v_code,
    'is_test', v_actor.is_test,
    'device', (
      select jsonb_build_object(
               'id', d.id, 'code', d.code, 'kind', d.kind, 'user_name', d.user_name, 'division', d.division,
               'cpu_name', d.cpu_name, 'cpu_model', d.cpu_model, 'started_on', d.started_on,
               'asset_no', d.asset_no, 'status', d.status, 'note', d.note)
      from public.itrp_devices d where d.is_test = v_actor.is_test and d.code = v_code),
    'rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'source', h.h_source, 'entry_id', h.h_entry_id, 'request_id', h.h_request_id, 'request_status', h.h_request_status,
               'doc_no', h.h_doc_no, 'reported_on', h.h_reported_on, 'symptom', h.h_symptom, 'action', h.h_action,
               'finished_on', h.h_finished_on, 'remark', h.h_remark, 'reporter_name', h.h_reporter_name,
               'revision_count', h.h_revision_count, 'updated_at', h.h_updated_at
             ) order by coalesce(h.h_reported_on, h.h_finished_on) nulls last, h.h_doc_no nulls last, h.h_entry_id nulls last, h.h_request_id), '[]'::jsonb)
      from private.itrp_history_rows(v_actor.is_test, v_code) h)
  );
end;
$$;

-- รายการเครื่อง (ทะเบียน + รหัสที่มีในประวัติแต่ไม่อยู่ในทะเบียน in_registry = false) พร้อมจำนวนประวัติและวันที่ซ่อมล่าสุด
--   p_search ค้นแบบไม่สนตัวพิมพ์ใหญ่เล็กใน รหัส/ผู้ใช้/แผนก/เลขทะเบียนทรัพย์สิน/Processor · p_include_retired = false ซ่อนเครื่องที่ยกเลิกการใช้งาน
--   เรียงตามรหัส · คืนไม่เกิน 2,000 รายการ · อ่านได้เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT
create or replace function public.app_itrp_list_devices(p_search text default null, p_include_retired boolean default true)
returns table(
  code text, in_registry boolean, device_id uuid, kind text, user_name text, division text, cpu_name text, cpu_model text,
  started_on date, asset_no text, status text, note text, history_count integer, last_repair_on date, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_search text := lower(private.itrp_clean(p_search));
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูทะเบียนเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  return query
  with hist as (
    select h.h_device_code as device_code, count(*)::integer as cnt, max(coalesce(h.h_finished_on, h.h_reported_on)) as last_on
    from private.itrp_history_rows(v_actor.is_test, null) h
    group by h.h_device_code
  ),
  codes as (
    select dv.code as c from public.itrp_devices dv where dv.is_test = v_actor.is_test
    union
    select hs.device_code from hist hs
  )
  select cs.c, (d.id is not null), d.id, d.kind, d.user_name, d.division, d.cpu_name, d.cpu_model,
         d.started_on, d.asset_no, d.status, d.note, coalesce(hs.cnt, 0), hs.last_on, d.updated_at
  from codes cs
  left join public.itrp_devices d on d.is_test = v_actor.is_test and d.code = cs.c
  left join hist hs on hs.device_code = cs.c
  where (p_include_retired or d.status is distinct from 'retired')
    and (v_search is null
         or position(v_search in lower(cs.c)) > 0
         or position(v_search in lower(coalesce(d.user_name, ''))) > 0
         or position(v_search in lower(coalesce(d.division, ''))) > 0
         or position(v_search in lower(coalesce(d.asset_no, ''))) > 0
         or position(v_search in lower(coalesce(d.cpu_name, ''))) > 0
         or position(v_search in lower(coalesce(d.cpu_model, ''))) > 0)
  order by cs.c
  limit 2000;
end;
$$;

-- เพิ่ม/แก้ทะเบียนเครื่อง (เฉพาะผู้ดูแลงาน IT): ไม่มีรหัสนี้ในโหมดนี้ = เพิ่ม · มีแล้ว = แก้ (ส่งค่าทั้งหมดของเครื่อง ช่องที่ส่ง null = ล้างค่า · รหัสแก้ไม่ได้)
--   ลง itrp_device_log โดย trigger (ค่าเดิม ค่าใหม่ ใคร เมื่อไร) · ไม่มีค่าใดเปลี่ยน = ไม่ลง log (changed = false) · คืน {id, code, created, changed}
create or replace function public.app_itrp_save_device(
  p_code text,
  p_kind text default 'other',
  p_user_name text default null,
  p_division text default null,
  p_cpu_name text default null,
  p_cpu_model text default null,
  p_started_on date default null,
  p_asset_no text default null,
  p_status text default 'active',
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := private.itrp_norm_code(p_code);
  v_code_error text;
  v_kind text := coalesce(private.itrp_clean(p_kind), 'other');
  v_status text := coalesce(private.itrp_clean(p_status), 'active');
  v_user text := private.itrp_clean(p_user_name);
  v_division text := private.itrp_clean(p_division);
  v_cpu_name text := private.itrp_clean(p_cpu_name);
  v_cpu_model text := private.itrp_clean(p_cpu_model);
  v_asset text := private.itrp_clean(p_asset_no);
  v_note text := private.itrp_clean(p_note);
  v_old public.itrp_devices%rowtype;
  v_new public.itrp_devices%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่เพิ่ม/แก้ทะเบียนเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  v_code_error := private.itrp_code_error(v_code);
  if v_code_error is not null then
    raise exception '%', v_code_error using errcode = 'check_violation';
  end if;
  if v_kind not in ('computer', 'laptop', 'monitor', 'printer', 'ups', 'other') then
    raise exception 'ชนิดอุปกรณ์ไม่ถูกต้อง' using errcode = 'check_violation';
  end if;
  if v_status not in ('active', 'retired') then
    raise exception 'สถานะเครื่องต้องเป็น ใช้งาน หรือ ยกเลิกการใช้งาน' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_user, '')) > 200 then
    raise exception 'ชื่อผู้ใช้เครื่องต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_division, '')) > 200 then
    raise exception 'ชื่อแผนก/ส่วนงานต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_cpu_name, '')) > 200 or char_length(coalesce(v_cpu_model, '')) > 200 then
    raise exception 'ข้อมูล Processor ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_asset, '')) > 100 then
    raise exception 'เลขทะเบียนทรัพย์สินต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_note, '')) > 1000 then
    raise exception 'หมายเหตุต้องไม่เกิน 1,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_started_on is not null and p_started_on not between date '1990-01-01' and date '2100-01-01' then
    raise exception 'วันที่เริ่มใช้ไม่ถูกต้อง' using errcode = 'check_violation';
  end if;

  select * into v_old from public.itrp_devices d where d.is_test = v_actor.is_test and d.code = v_code for update;
  if v_old.id is null then
    insert into public.itrp_devices (
      is_test, code, kind, user_name, division, cpu_name, cpu_model, started_on, asset_no, status, note, created_by, updated_by)
    values (
      v_actor.is_test, v_code, v_kind, v_user, v_division, v_cpu_name, v_cpu_model, p_started_on, v_asset, v_status, v_note, v_actor.id, v_actor.id)
    on conflict (is_test, code) do nothing
    returning * into v_new;
    if v_new.id is null then
      raise exception 'รหัสเครื่อง % ถูกเพิ่มโดยผู้อื่นพร้อมกัน กรุณาลองใหม่', v_code using errcode = 'check_violation';
    end if;
    return jsonb_build_object('id', v_new.id, 'code', v_new.code, 'created', true, 'changed', true);
  end if;

  v_new := v_old;
  v_new.kind := v_kind;
  v_new.user_name := v_user;
  v_new.division := v_division;
  v_new.cpu_name := v_cpu_name;
  v_new.cpu_model := v_cpu_model;
  v_new.started_on := p_started_on;
  v_new.asset_no := v_asset;
  v_new.status := v_status;
  v_new.note := v_note;
  if private.itrp_device_values(v_new) is not distinct from private.itrp_device_values(v_old) then
    return jsonb_build_object('id', v_old.id, 'code', v_old.code, 'created', false, 'changed', false);
  end if;
  update public.itrp_devices
  set kind = v_kind, user_name = v_user, division = v_division, cpu_name = v_cpu_name, cpu_model = v_cpu_model,
      started_on = p_started_on, asset_no = v_asset, status = v_status, note = v_note,
      updated_by = v_actor.id, updated_at = now()
  where id = v_old.id;
  return jsonb_build_object('id', v_old.id, 'code', v_old.code, 'created', false, 'changed', true);
end;
$$;

-- 8. ประวัติย้อนหลัง (ใบกระดาษที่ไม่มีในระบบ) --------------------------------------------
-- ลงประวัติย้อนหลัง (เฉพาะผู้ดูแลงาน IT) · source = manual · ต้องมี รหัสเครื่อง + วันที่แจ้ง + (อาการ หรือ การแก้ไข อย่างน้อยหนึ่งอย่าง)
--   วันที่ต้องไม่เป็นอนาคต (เวลาไทย) และวันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้ง · เลขที่ใบ "-" หรือว่าง = ไม่ระบุ
--   เครื่องเดียวกัน + เลขที่ใบเดียวกัน ลงซ้ำไม่ได้ (เฉพาะรายการที่ยังไม่ยกเลิก) · คืน id ของรายการ
create or replace function public.app_itrp_history_add(
  p_device_code text,
  p_doc_no text,
  p_reported_on date,
  p_symptom text,
  p_action text,
  p_finished_on date,
  p_remark text,
  p_reporter_name text
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := private.itrp_norm_code(p_device_code);
  v_code_error text;
  v_doc text := nullif(private.itrp_clean(p_doc_no), '-');
  v_symptom text := private.itrp_clean(p_symptom);
  v_action text := private.itrp_clean(p_action);
  v_remark text := private.itrp_clean(p_remark);
  v_reporter text := private.itrp_clean(p_reporter_name);
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_id bigint;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ลงประวัติการซ่อมย้อนหลังได้' using errcode = 'insufficient_privilege';
  end if;
  v_code_error := private.itrp_code_error(v_code);
  if v_code_error is not null then
    raise exception '%', v_code_error using errcode = 'check_violation';
  end if;
  if p_reported_on is null then
    raise exception 'กรุณาระบุวันที่แจ้งซ่อม' using errcode = 'check_violation';
  end if;
  if p_reported_on < date '1990-01-01' or p_reported_on > v_today then
    raise exception 'วันที่แจ้งซ่อมไม่ถูกต้อง (ต้องไม่เป็นวันในอนาคต)' using errcode = 'check_violation';
  end if;
  if p_finished_on is not null and (p_finished_on < p_reported_on or p_finished_on > v_today) then
    raise exception 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต' using errcode = 'check_violation';
  end if;
  if v_symptom is null and v_action is null then
    raise exception 'กรุณาระบุอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_doc, '')) > 50 then
    raise exception 'เลขที่ใบแจ้งซ่อมต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_symptom, '')) > 2000 then
    raise exception 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_action, '')) > 2000 then
    raise exception 'การแก้ไขต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_remark, '')) > 500 then
    raise exception 'ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_reporter, '')) > 200 then
    raise exception 'ชื่อผู้แจ้งต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_doc is not null and exists (
       select 1 from public.itrp_history_entries e
       where e.is_test = v_actor.is_test and e.device_code = v_code and e.doc_no = v_doc and e.voided_at is null) then
    raise exception 'มีประวัติของเครื่อง % เลขที่ใบ % อยู่แล้ว', v_code, v_doc using errcode = 'check_violation';
  end if;

  insert into public.itrp_history_entries (
    is_test, source, doc_no, device_code, reported_on, symptom, action, finished_on, remark, reporter_name, created_by)
  values (
    v_actor.is_test, 'manual', v_doc, v_code, p_reported_on, v_symptom, v_action, p_finished_on, v_remark, v_reporter, v_actor.id)
  returning id into v_id;
  return v_id;
end;
$$;

-- แก้ประวัติย้อนหลัง/ที่นำเข้า (เฉพาะผู้ดูแลงาน IT): ส่งค่าทั้งหมดของเนื้อหา (null = ล้าง) · trigger เก็บฉบับก่อนแก้ลง revisions ให้ทุกครั้ง
--   กติกาข้อมูลเหมือน app_itrp_history_add (วันที่แจ้ง/อาการหรือการแก้ไข/วันที่ต้องไม่เป็นอนาคต) · ไม่มีอะไรเปลี่ยน = ผิดพลาด (ไม่ให้เกิดรอยแก้เปล่า)
--   แก้รายการที่ยกเลิกแล้วไม่ได้ · คืน {id, revision_count}
create or replace function public.app_itrp_history_update(
  p_entry_id bigint,
  p_device_code text,
  p_doc_no text,
  p_reported_on date,
  p_symptom text,
  p_action text,
  p_finished_on date,
  p_remark text,
  p_reporter_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_entry public.itrp_history_entries%rowtype;
  v_code text := private.itrp_norm_code(p_device_code);
  v_code_error text;
  v_doc text := nullif(private.itrp_clean(p_doc_no), '-');
  v_symptom text := private.itrp_clean(p_symptom);
  v_action text := private.itrp_clean(p_action);
  v_remark text := private.itrp_clean(p_remark);
  v_reporter text := private.itrp_clean(p_reporter_name);
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่แก้ประวัติการซ่อมได้' using errcode = 'insufficient_privilege';
  end if;
  select * into v_entry from public.itrp_history_entries e where e.id = p_entry_id for update;
  if v_entry.id is null or v_entry.is_test <> v_actor.is_test then
    raise exception 'ไม่พบรายการประวัติการซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_entry.voided_at is not null then
    raise exception 'รายการนี้ถูกยกเลิกแล้ว แก้ไขไม่ได้' using errcode = 'check_violation';
  end if;
  v_code_error := private.itrp_code_error(v_code);
  if v_code_error is not null then
    raise exception '%', v_code_error using errcode = 'check_violation';
  end if;
  if p_reported_on is null then
    raise exception 'กรุณาระบุวันที่แจ้งซ่อม' using errcode = 'check_violation';
  end if;
  if p_reported_on < date '1990-01-01' or p_reported_on > v_today then
    raise exception 'วันที่แจ้งซ่อมไม่ถูกต้อง (ต้องไม่เป็นวันในอนาคต)' using errcode = 'check_violation';
  end if;
  if p_finished_on is not null and (p_finished_on < p_reported_on or p_finished_on > v_today) then
    raise exception 'วันที่ซ่อมเสร็จต้องไม่ก่อนวันที่แจ้งและไม่เป็นวันในอนาคต' using errcode = 'check_violation';
  end if;
  if v_symptom is null and v_action is null then
    raise exception 'กรุณาระบุอาการเสียหรือการแก้ไขอย่างน้อยหนึ่งอย่าง' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_doc, '')) > 50 then
    raise exception 'เลขที่ใบแจ้งซ่อมต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_symptom, '')) > 2000 then
    raise exception 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_action, '')) > 2000 then
    raise exception 'การแก้ไขต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_remark, '')) > 500 then
    raise exception 'ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_reporter, '')) > 200 then
    raise exception 'ชื่อผู้แจ้งต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if (v_code, v_doc, p_reported_on, v_symptom, v_action, p_finished_on, v_remark, v_reporter)
     is not distinct from
     (v_entry.device_code, v_entry.doc_no, v_entry.reported_on, v_entry.symptom, v_entry.action, v_entry.finished_on, v_entry.remark, v_entry.reporter_name) then
    raise exception 'ไม่มีการเปลี่ยนแปลงจากรายการเดิม' using errcode = 'check_violation';
  end if;
  if v_doc is not null and exists (
       select 1 from public.itrp_history_entries e
       where e.is_test = v_actor.is_test and e.id <> v_entry.id and e.device_code = v_code and e.doc_no = v_doc and e.voided_at is null) then
    raise exception 'มีประวัติของเครื่อง % เลขที่ใบ % อยู่แล้ว', v_code, v_doc using errcode = 'check_violation';
  end if;

  -- ฉบับก่อนแก้ถูกเก็บลง revisions โดย trigger itrp_history_entries_guard
  update public.itrp_history_entries
  set device_code = v_code, doc_no = v_doc, reported_on = p_reported_on, symptom = v_symptom, action = v_action,
      finished_on = p_finished_on, remark = v_remark, reporter_name = v_reporter,
      updated_by = v_actor.id, updated_at = now()
  where id = v_entry.id;
  return jsonb_build_object(
    'id', v_entry.id,
    'revision_count', (select count(*)::integer from public.itrp_history_entry_revisions r where r.entry_id = v_entry.id));
end;
$$;

-- ยกเลิกรายการประวัติ (เฉพาะผู้ดูแลงาน IT): ต้องใส่เหตุผล ≤500 · ไม่ลบแถว ไม่ขึ้นในประวัติของเครื่องอีก แต่ยังเปิดดูได้ที่ app_itrp_history_get · ยกเลิกแล้วทำซ้ำ/แก้ไม่ได้
--   trigger เก็บฉบับก่อนยกเลิกลง revisions (change_kind = void) · คืน {id}
create or replace function public.app_itrp_history_void(p_entry_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_entry public.itrp_history_entries%rowtype;
  v_reason text := private.itrp_clean(p_reason);
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not private.itrp_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ยกเลิกรายการประวัติการซ่อมได้' using errcode = 'insufficient_privilege';
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่ยกเลิกรายการ' using errcode = 'check_violation';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'เหตุผลต้องไม่เกิน 500 ตัวอักษร' using errcode = 'check_violation';
  end if;
  select * into v_entry from public.itrp_history_entries e where e.id = p_entry_id for update;
  if v_entry.id is null or v_entry.is_test <> v_actor.is_test then
    raise exception 'ไม่พบรายการประวัติการซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_entry.voided_at is not null then
    raise exception 'รายการนี้ถูกยกเลิกไปแล้ว' using errcode = 'check_violation';
  end if;
  update public.itrp_history_entries
  set voided_at = now(), voided_by = v_actor.id, void_reason = v_reason
  where id = v_entry.id;
  return jsonb_build_object('id', v_entry.id);
end;
$$;

-- ดูรายการประวัติหนึ่งรายการพร้อมรอยแก้ทั้งหมด (รวมรายการที่ยกเลิกแล้ว) · ผู้ดูแลงาน IT และผู้อนุมัติขั้น IT
--   {entry{...ทุกคอลัมน์ + ชื่อผู้ลง/ผู้แก้/ผู้ยกเลิก}, revisions[{revision_no, change_kind, snapshot, changed_by_employee_no, changed_by_full_name, reason, created_at}]}
--   revisions เรียงตามลำดับการแก้ (เก่าสุดก่อน) · snapshot = ฉบับก่อนการแก้ครั้งนั้น
create or replace function public.app_itrp_history_get(p_entry_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_entry public.itrp_history_entries%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if not (private.itrp_is_it_admin(v_actor.id) or private.itrp_is_it_approver(v_actor.id)) then
    raise exception 'เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมเครื่องได้' using errcode = 'insufficient_privilege';
  end if;
  select * into v_entry from public.itrp_history_entries e where e.id = p_entry_id;
  if v_entry.id is null or v_entry.is_test <> v_actor.is_test then
    raise exception 'ไม่พบรายการประวัติการซ่อมนี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'entry', jsonb_build_object(
      'id', v_entry.id, 'source', v_entry.source, 'doc_no', v_entry.doc_no, 'device_code', v_entry.device_code,
      'reported_on', v_entry.reported_on, 'symptom', v_entry.symptom, 'action', v_entry.action,
      'finished_on', v_entry.finished_on, 'remark', v_entry.remark, 'reporter_name', v_entry.reporter_name,
      'created_at', v_entry.created_at,
      'created_by_employee_no', (select e.employee_no from public.employees e where e.id = v_entry.created_by),
      'created_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.created_by),
      'updated_at', v_entry.updated_at,
      'updated_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.updated_by),
      'voided_at', v_entry.voided_at, 'void_reason', v_entry.void_reason,
      'voided_by_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = v_entry.voided_by)),
    'revisions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'revision_no', r.revision_no, 'change_kind', r.change_kind, 'snapshot', r.snapshot,
               'changed_by_employee_no', a.employee_no, 'changed_by_full_name', a.first_name || ' ' || a.last_name,
               'reason', r.reason, 'created_at', r.created_at
             ) order by r.revision_no), '[]'::jsonb)
      from public.itrp_history_entry_revisions r
      join public.employees a on a.id = r.changed_by
      where r.entry_id = v_entry.id)
  );
end;
$$;

-- 9. ล้างข้อมูลทดสอบ: ครอบ 5 ตารางใหม่ด้วย ---------------------------------------------------
-- เหมือน 20261212010000 ทุกบรรทัด เพิ่มเฉพาะ: ล็อกตารางใหม่ + ลบแถว is_test ของตารางใหม่ (ลูกก่อนแม่: report_devices อยู่ก่อน repair_reports,
-- history_entry_revisions ก่อน history_entries, device_log ก่อน devices) · ตั้งค่า itrp.purge ให้ trigger ของตารางใหม่ยอมลบเฉพาะแถวทดสอบ
create or replace function public.app_sandbox_purge_itrp()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_files text[];
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกตารางเขียนของโมดูลทั้งหมดไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นแจ้ง/อนุมัติใบทดสอบพร้อมกันระหว่างล้าง
  -- จนเหลือแถวลูกกำพร้า หรือได้เลข TEST- ที่ชนกับตัวนับที่กำลังถูกลบ · ถ้าสั่งพร้อมกัน ฝั่งที่มาทีหลังจะรอแล้วทำงานหลังล้างเสร็จ
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> รอบแก้ไข/ข้อความ/ไฟล์แนบ -> ประวัติ -> บันทึกการซ่อม/อะไหล่/เครื่อง -> admin_log -> ทะเบียนเครื่อง/ประวัติย้อนหลัง) กัน deadlock
  lock table public.itrp_doc_counters, public.itrp_requests, public.itrp_reworks, public.itrp_comments, public.itrp_attachments,
             public.itrp_events, public.itrp_repair_reports, public.itrp_repair_parts, public.itrp_report_devices, public.itrp_admin_log,
             public.itrp_devices, public.itrp_device_log, public.itrp_history_entries, public.itrp_history_entry_revisions in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itrp.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itrp.purge', 'on', true);

  -- ลูกก่อนแม่: อะไหล่/เครื่องที่ซ่อม -> บันทึกการซ่อม (อ้าง event) -> ไฟล์แนบ (อ้างรอบแก้ไข/ข้อความ) -> ข้อความ (อ้างกันเองลบในคำสั่งเดียวได้) -> รอบแก้ไข -> ประวัติ -> ... -> ใบ
  -- แล้วค่อยลบกลุ่มทะเบียนเครื่อง/ประวัติย้อนหลัง (ไม่อ้างตารางใบ): รอยแก้ -> ประวัติย้อนหลัง -> log ทะเบียน -> ทะเบียนเครื่อง
  foreach v_table in array array['itrp_repair_parts', 'itrp_report_devices', 'itrp_repair_reports', 'itrp_attachments', 'itrp_comments', 'itrp_reworks',
                                 'itrp_events', 'itrp_admin_log', 'itrp_requests', 'itrp_doc_counters',
                                 'itrp_history_entry_revisions', 'itrp_history_entries', 'itrp_device_log', 'itrp_devices'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  perform set_config('itrp.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  select coalesce(array_agg(o.name order by o.name), '{}'::text[]) into v_files
  from storage.objects o where o.bucket_id = 'itrp-test-files';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITRP_SANDBOX_PURGE', 'itrp_requests', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'files_to_remove', cardinality(v_files)));
  return jsonb_build_object('deleted', v_deleted, 'files', to_jsonb(v_files));
end;
$$;

-- 10. สิทธิ์เรียกฟังก์ชัน (เหมือนส่วน 15 ของ 20261212010000 · รันซ้ำทั้งชุดได้ ผลเดียวกัน) -----------------
-- private.itrp_*: ถอนจาก public/anon/authenticated ทั้งหมด ยกเว้นตัวช่วยของ policy Storage 3 ตัวที่ต้องเรียกด้วยสิทธิ์ผู้ใช้ (เหมือนเดิม)
-- public.app_itrp_* และ app_sandbox_purge_itrp: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจพนักงานและบทบาทซ้ำอีกชั้น) anon เรียกไม่ได้
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'itrp\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('itrp_storage_can_read', 'itrp_storage_can_upload', 'itrp_storage_test_file_removable')
  loop
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itrp\_%' or p.proname = 'app_sandbox_purge_itrp')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
