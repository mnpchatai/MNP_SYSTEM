-- ============================================================================
-- ใบแจ้งซ่อม (itrp) ↔ ทะเบียนอุปกรณ์ IT (itas): เปลี่ยน / ถอด / ย้าย / ติดตั้ง ชิ้นส่วน แล้วอัปเดตการผูกในทะเบียนให้เองโดยอ้างเลขที่ใบแจ้งซ่อม
-- ส่วนฐานข้อมูลอย่างเดียว (หน้าเว็บทำรอบถัดไป) · ไม่แตะ app_itrp_complete และไม่เปลี่ยนพฤติกรรมของ itwo/itrp เดิม
--
-- เจตนา (เจ้าของสั่ง 25/11/2026): "ใส่แล้วไม่พลาด แต่ไม่ยุ่งยาก" = IT "เลือกจากรายการ" ไม่แยกวิเคราะห์ข้อความอิสระ
--   หน้าเว็บเรียก app_itrp_part_changes_context เพื่อได้เครื่องของใบ + ชิ้นส่วนที่ติดตั้งอยู่ + ชิ้นสำรองแยกตามชนิด
--   แล้วส่งสิ่งที่เลือกกลับมาใน app_itrp_apply_part_changes ครั้งเดียว (atomic ทั้งก้อน)
--
-- สิ่งที่เพิ่ม
--   ตาราง itrp_part_changes (บันทึกสำหรับ ISO เพิ่มได้อย่างเดียว) · RLS deny-all + ไม่มี grant ตรง + lab-only + trigger โหมดทดสอบ + ลงทะเบียนใน private.sandbox_unguarded_tables()
--     ไม่มี FK ไปที่ itas_assets (ตั้งใจ): ล้างข้อมูลทดสอบของ itrp กับ itas เป็นคนละฟังก์ชัน ถ้ามี FK ลำดับล้างจะชนกัน
--     จึงเก็บ "ภาพถ่าย" เลขทะเบียน/รหัสอุปกรณ์/ชื่อของชิ้นส่วน ณ ตอนทำรายการไว้ในแถวเอง (อ่านได้แม้ทะเบียนถูกแก้ภายหลัง) และตรวจความมีอยู่จริงตอนเขียนใน RPC
--   RPC (SECURITY DEFINER, search_path ว่าง, anon เรียกไม่ได้, ทุกตัวมีด่าน lab-only)
--     app_itrp_part_changes_context(p_request_id)   เครื่องของใบ + ชิ้นส่วนปัจจุบัน + ชิ้นสำรอง + เครื่องปลายทางที่ย้ายไปได้ (ผู้ดูแลงาน IT ที่อยู่ใน itas_admins เท่านั้น)
--     app_itrp_apply_part_changes(p_request_id, p_changes jsonb)   บันทึกการเปลี่ยน/ถอด/ย้าย/ติดตั้ง ≤20 รายการ ครั้งเดียวทั้งก้อน (สิทธิ์เดียวกัน)
--     app_itrp_get_part_changes(p_request_id)       รายการที่บันทึกไว้ของใบ (ใครเห็นใบได้ก็อ่านได้ · ไม่คืน id ของอุปกรณ์ ไม่คืนช่องลับ)
--     ไม่ replace app_itrp_get_detail: ใช้ RPC แยกแทนเพื่อแก้ฟังก์ชันเดิมให้น้อยที่สุด (หน้าเว็บเรียกเพิ่มอีกหนึ่งครั้งตอนเปิดรายละเอียด)
--   ตัวช่วย private.itrp_part_* / private.itrp_request_machine_codes / private.itrp_asset_brief / private.itas_change_source (ไม่เปิดให้ผู้ใช้เรียกตรง)
--
-- การอ้างเลขที่ใบแจ้งซ่อมในประวัติของ itas
--   เพิ่มคอลัมน์ source_request_id / source_doc_no (nullable) ใน itas_asset_moves และ itas_asset_log · แถวเดิมเป็น null
--   trigger เดิม (private.itas_assets_moves / itas_assets_log) ถูก replace ให้ถามตัวช่วย private.itas_change_source ว่า "การแก้ครั้งนี้มาจากใบแจ้งซ่อมไหน"
--   คำตอบมาจากแถว itrp_part_changes ที่ RPC เพิ่งเขียนในธุรกรรมเดียวกัน (ตรงกับ batch ที่ RPC ตั้งไว้ใน itas.change_batch แบบ transaction-local + created_at = now())
--   ไม่ใช่ค่าที่ผู้เรียกส่งมาเอง: ถึงจะตั้ง itas.change_batch เองด้วย set_config ก็ใช้ปลอมอ้างใบไม่ได้ เพราะต้องมีแถว itrp_part_changes ของ batch นั้นที่เขียนในธุรกรรมเดียวกันและตรงกับชิ้นส่วนนั้น
--   การแก้ชิ้นส่วนผ่าน app_itas_save_asset ตามปกติไม่มีการอ้างใบ (null) เหมือนเดิม
--
-- กติกาของ app_itrp_apply_part_changes (ตรวจที่ฐานข้อมูลทั้งหมด)
--   - ผู้เรียกต้องเป็นผู้ดูแลงาน IT ของ itrp (itwo_staff.is_it_admin) และอยู่ใน itas_admins ทั้งสองอย่าง · ใบต้องอยู่โหมดเดียวกับผู้เรียก (is_test)
--   - ใบต้องอยู่สถานะ in_progress (IT กำลังทำ) หรือ it_closed (IT ส่งงานแล้วรอผู้แจ้งยืนยัน) เท่านั้น · สถานะอื่น (รออนุมัติ/รอผู้แจ้งตอบ/จบ/ยกเลิก) บันทึกไม่ได้
--   - เครื่องที่ทำรายการ (host_code) ต้องเป็นเครื่องของใบนี้: รหัสเครื่องที่ผู้แจ้งกรอก (asset_code) หรือเครื่องที่ IT ระบุตอนส่งงาน (itrp_report_devices ทุกรอบ)
--   - action 4 แบบ (แต่ละแถวต้องส่งเฉพาะช่องที่เกี่ยว):
--       replace  host_code, asset_id (ชิ้นเดิม), new_asset_id (ชิ้นใหม่), result_status (broken/spare/retired ของชิ้นเดิม) [slot, note]
--                ชิ้นเดิมต้องติดตั้งที่ host_code นั้นจริงตอนนี้ (กดซ้ำ/ข้อมูลเก่า = ถูกปฏิเสธ) สถานะใช้งานหรือชำรุด · ชิ้นใหม่ต้องชนิดเดียวกัน สถานะสำรอง และยังไม่ผูกกับเครื่องใด
--                ผล: ชิ้นเดิมถูกถอดออกจากเครื่อง (host/slot = null) และเปลี่ยนเป็น result_status · ชิ้นใหม่ผูกเข้าเครื่อง สถานะใช้งาน ช่อง (slot) = ที่ส่งมา หรือช่องเดิมของชิ้นเดิม
--       remove   host_code, asset_id, result_status [note]   ถอดออกจากเครื่อง + เปลี่ยนสถานะเป็น result_status
--       move     host_code, asset_id, to_host_code [slot, note]   ย้ายไปเครื่องอื่นที่มีอยู่จริงในทะเบียน (device_code ตรง ยังไม่ยกเลิกใช้งาน) สถานะคงเดิม ช่อง = ที่ส่งมา (ไม่ส่ง = ล้าง เพราะช่องของเครื่องเก่าไม่ใช้กับเครื่องใหม่)
--       install  host_code, asset_id (ชิ้นสำรอง) [slot, note]   ใส่ชิ้นสำรองเข้าเครื่อง สถานะใช้งาน
--   - ห้ามใช้ชิ้นเดียวกันซ้ำในก้อนเดียว (รวม asset_id กับ new_asset_id) · ก้อนละ 1–20 แถว · ชิ้นส่วน/เครื่องปลายทางต้องอยู่โหมดเดียวกับใบ (is_test ตรงกัน)
--   - แถวใดผิด = ทั้งก้อนไม่เกิดขึ้นเลย (ข้อความ "แถวที่ N: ..." ภาษาไทย) · ล็อกแถวชิ้นส่วนเรียงตาม id กัน deadlock และกันสองคนแก้ชิ้นเดียวกันพร้อมกัน
--   - ไม่แก้ install_date/place/ข้อมูลอื่นของชิ้นส่วน (แก้เฉพาะ status, host_code, slot, updated_by) ถ้าต้องการวันที่ติดตั้งให้แก้ผ่าน app_itas_save_asset
--
-- สิ่งที่แตะนอกจากของใหม่
--   1) replace private.sandbox_unguarded_tables() — ฐาน = ฉบับบน prod (md5(pg_get_functiondef) = 9b22c42d2011e5f706429f3a94319f78 ตรงกับ 20261222010000_itas_asset_register.sql) ครบทุกชื่อ + เพิ่ม itrp_part_changes
--   2) replace public.app_sandbox_purge_itrp() — ฐาน = ฉบับบน prod (md5 5ec2f53b344ba543dd45d7de97261df6 ตรงกับ 20261218010000_itrp_repair_history.sql) เพิ่มการล็อก + ลบแถว is_test ของ itrp_part_changes เป็นลำดับแรก (ลูกก่อนแม่)
--   3) replace private.itas_assets_moves() (md5 3f9f95f60f76dd3c368c591f48b72e91) และ private.itas_assets_log() (md5 ecd34ede9cc5bd3ff0ed0c8bbca2d24b) — ของโมดูล itas เอง เพิ่มการเติม source_request_id/source_doc_no เท่านั้น
--   4) replace public.app_itas_asset_history(uuid, integer) (md5 beb3886338f6b4d7f9f39b555e1befbf) — ของ itas เอง เพิ่มคีย์ source_request_id / source_doc_no ในแต่ละแถวของ log และ moves (คีย์เดิมไม่เปลี่ยน)
--      md5 ทั้งหมดข้างบนวัดจาก prod ด้วย SELECT เมื่อ 25/11/2026 และเนื้อหาตรงกับไฟล์ migration ต้นทางทุกตัว (เทียบหลัง normalize ช่องว่าง)
--   5) alter table itas_asset_moves / itas_asset_log เพิ่มคอลัมน์ nullable 2 คอลัมน์ (ตารางมีข้อมูลจริงแล้ว: ไม่ rewrite แถวเดิม · ไม่มี default)
--   ไม่แตะ: app_itrp_complete, app_itrp_get_detail, ตาราง/ฟังก์ชัน/trigger ของ itwo, ฟังก์ชันกลางของเพื่อน (นอกจาก sandbox_unguarded_tables), storage
--
-- ลำดับ deploy: ตารางและ RPC ใหม่ล้วน ยังไม่มีหน้าเว็บเรียก · apply ก่อน merge หน้าเว็บที่จะเรียก RPC เหล่านี้
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod, md5 ของ 5 ฟังก์ชันข้างบนยังตรง (ไม่ตรง = มีคนแก้ ให้หยุดแล้วใช้ฉบับล่าสุดเป็นฐาน)
--   หลัง apply ตรวจ: relrowsecurity ของ itrp_part_changes, ไม่มี grant ตรง, RPC 3 ตัว anon เรียกไม่ได้, itrp_part_changes อยู่ใน sandbox_unguarded_tables, ไม่มีแถวใน itrp_part_changes
--
-- Rollback (ยังไม่มีข้อมูลจริงในตารางใหม่): drop function public.app_itrp_part_changes_context / app_itrp_apply_part_changes / app_itrp_get_part_changes ·
--   drop function private.itrp_part_* / itrp_request_machine_codes / itrp_asset_brief / itas_change_source ·
--   create or replace private.itas_assets_moves / itas_assets_log / public.app_itas_asset_history / app_sandbox_purge_itrp / private.sandbox_unguarded_tables กลับเป็นนิยามเดิมของไฟล์ต้นทาง ·
--   drop table itrp_part_changes · alter table itas_asset_moves / itas_asset_log drop column source_request_id, source_doc_no (ถ้าคอลัมน์ยังเป็น null ทุกแถว)
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itrp_report_devices') is null or to_regprocedure('public.app_itrp_complete(uuid, text, text, text, text, text, text, text, jsonb, jsonb)') is null then
    raise exception 'ไม่พบโมดูลใบแจ้งซ่อมรุ่นประวัติการซ่อม กรุณา apply 20261218010000_itrp_repair_history.sql ก่อน';
  end if;
  if to_regclass('public.itas_assets') is null or to_regprocedure('private.itas_is_it_admin(uuid)') is null then
    raise exception 'ไม่พบทะเบียนอุปกรณ์ IT กรุณา apply 20261222010000_itas_asset_register.sql ก่อน';
  end if;
end;
$$;

-- 1. ตารางบันทึกการเปลี่ยนชิ้นส่วนของใบแจ้งซ่อม -----------------------------------------
-- 1 แถว = 1 รายการที่ IT เลือก · batch_id = ชุดที่กดบันทึกพร้อมกัน (line_no 1..20 ตามลำดับที่ส่ง) · เพิ่มได้อย่างเดียว
create table public.itrp_part_changes (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  request_id uuid not null,
  batch_id uuid not null,
  line_no smallint not null check (line_no between 1 and 20),
  action text not null check (action in ('replace', 'remove', 'move', 'install')),
  -- เครื่องที่ทำรายการ (เครื่องต้นทางของ move) และเครื่องปลายทาง (เฉพาะ move)
  host_code text not null check (host_code = upper(btrim(host_code)) and char_length(host_code) between 1 and 50 and host_code !~ '[[:cntrl:]]'),
  to_host_code text check (to_host_code is null or (to_host_code = upper(btrim(to_host_code)) and char_length(to_host_code) between 1 and 50 and to_host_code !~ '[[:cntrl:]]')),
  -- ชิ้นที่ถูกเปลี่ยนออก/ถอด/ย้าย หรือชิ้นที่ติดตั้ง (install) · ชิ้นใหม่ของ replace อยู่ที่ new_asset_id
  asset_id uuid not null,
  type_code text not null check (char_length(type_code) between 1 and 30),
  asset_reg_no text check (asset_reg_no is null or char_length(asset_reg_no) <= 50),
  asset_device_code text check (asset_device_code is null or char_length(asset_device_code) <= 50),
  asset_name text check (asset_name is null or char_length(asset_name) <= 200),
  new_asset_id uuid,
  new_asset_reg_no text check (new_asset_reg_no is null or char_length(new_asset_reg_no) <= 50),
  new_asset_device_code text check (new_asset_device_code is null or char_length(new_asset_device_code) <= 50),
  new_asset_name text check (new_asset_name is null or char_length(new_asset_name) <= 200),
  -- สถานะใหม่ของชิ้นที่ถูกถอด (replace/remove เท่านั้น)
  result_status text check (result_status is null or result_status in ('broken', 'spare', 'retired')),
  slot text check (slot is null or (btrim(slot) <> '' and char_length(slot) <= 50 and slot !~ '[[:cntrl:]]')),
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 200 and note !~ '[[:cntrl:]]')),
  actor_id uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  unique (batch_id, line_no),
  constraint itrp_part_changes_to_host_ck check ((action = 'move') = (to_host_code is not null)),
  constraint itrp_part_changes_new_asset_ck check ((action = 'replace') = (new_asset_id is not null)),
  constraint itrp_part_changes_result_ck check ((action in ('replace', 'remove')) = (result_status is not null)),
  constraint itrp_part_changes_distinct_assets_ck check (new_asset_id is null or new_asset_id <> asset_id)
);
create index itrp_part_changes_req_idx on public.itrp_part_changes (request_id, is_test, id);
create index itrp_part_changes_asset_idx on public.itrp_part_changes (asset_id);
create index itrp_part_changes_new_asset_idx on public.itrp_part_changes (new_asset_id) where new_asset_id is not null;
create index itrp_part_changes_actor_idx on public.itrp_part_changes (actor_id);
comment on table public.itrp_part_changes is
  'บันทึกการเปลี่ยน/ถอด/ย้าย/ติดตั้งชิ้นส่วนของใบแจ้งซ่อม (อัปเดตทะเบียนอุปกรณ์ itas ในธุรกรรมเดียวกัน) · เพิ่มได้อย่างเดียว (trigger) · เขียนผ่าน app_itrp_apply_part_changes เท่านั้น · เก็บภาพถ่ายเลขทะเบียน/ชื่อชิ้นส่วนไว้ในแถว (ไม่มี FK ไป itas_assets)';

-- ปิดการเข้าถึงตรง (deny-all) เหมือนตารางอื่นของ itrp
do $$
declare
  v_sequence text;
begin
  revoke all on public.itrp_part_changes from public, anon, authenticated, service_role;
  for v_sequence in
    select format('%I.%I', n.nspname, s.relname)
    from pg_catalog.pg_class s
    join pg_catalog.pg_namespace n on n.oid = s.relnamespace
    join pg_catalog.pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
    where s.relkind = 'S' and d.refobjid = 'public.itrp_part_changes'::regclass
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_sequence);
  end loop;
  alter table public.itrp_part_changes enable row level security;
  create policy itrp_part_changes_no_direct_access on public.itrp_part_changes for all to authenticated using (false) with check (false);
  -- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้
  perform private.lab_only_guard_table('public.itrp_part_changes');
end $$;

-- โหมดทดสอบ: is_test ตามโหมดของผู้ทำรายการ แก้/ลบข้ามโหมดไม่ได้ · เพิ่มได้อย่างเดียว (ลบเฉพาะแถวทดสอบตอนล้างข้อมูลทดสอบ)
create trigger itrp_part_changes_sandbox_scope before insert or update or delete on public.itrp_part_changes
  for each row execute function private.sandbox_row_scope();
create trigger itrp_part_changes_append_only before update or delete on public.itrp_part_changes
  for each row execute function private.itrp_append_only_guard();
create trigger itrp_part_changes_no_truncate before truncate on public.itrp_part_changes
  for each statement execute function private.itrp_append_only_guard();

-- 2. ประวัติของ itas อ้างเลขที่ใบแจ้งซ่อมได้ --------------------------------------------
alter table public.itas_asset_moves
  add column source_request_id uuid,
  add column source_doc_no text check (source_doc_no is null or char_length(source_doc_no) <= 50),
  add constraint itas_asset_moves_source_ck check ((source_request_id is null) = (source_doc_no is null));
alter table public.itas_asset_log
  add column source_request_id uuid,
  add column source_doc_no text check (source_doc_no is null or char_length(source_doc_no) <= 50),
  add constraint itas_asset_log_source_ck check ((source_request_id is null) = (source_doc_no is null));
comment on column public.itas_asset_moves.source_request_id is
  'ใบแจ้งซ่อม (itrp_requests.id) ที่เป็นต้นเหตุของการย้าย/เปลี่ยนชิ้นส่วนนี้ · null = แก้ตามปกติผ่านทะเบียน (ไม่มี FK: ล้างข้อมูลทดสอบของสองโมดูลแยกกัน)';
comment on column public.itas_asset_log.source_request_id is
  'ใบแจ้งซ่อม (itrp_requests.id) ที่เป็นต้นเหตุของการแก้ไขนี้ · null = แก้ตามปกติผ่านทะเบียน';

-- ตัวช่วย: การแก้ชิ้นส่วนที่กำลังเกิดในธุรกรรมนี้มาจากใบแจ้งซ่อมไหน (ว่าง = ไม่ได้มาจากใบ)
-- ต้องมีแถว itrp_part_changes ของ batch ที่ app_itrp_apply_part_changes ตั้งไว้ใน itas.change_batch (transaction-local) เขียนในธุรกรรมเดียวกัน และเกี่ยวกับชิ้นส่วนนี้จริง
create or replace function private.itas_change_source(p_asset_id uuid, p_is_test boolean)
returns table(request_id uuid, doc_no text)
language sql
stable
security definer
set search_path = ''
as $$
  select c.request_id, r.doc_no
  from public.itrp_part_changes c
  join public.itrp_requests r on r.id = c.request_id and r.is_test = c.is_test
  where c.is_test = p_is_test
    and c.batch_id::text = coalesce(current_setting('itas.change_batch', true), '')
    and c.created_at = now()
    and (c.asset_id = p_asset_id or c.new_asset_id = p_asset_id)
  order by c.id desc
  limit 1
$$;

-- ลง itas_asset_moves เมื่อ host_code / slot / status เปลี่ยน (ตอนสร้างลงเมื่อมี host_code) · เหมือนฉบับ 20261222010000 ทุกบรรทัด เพิ่มเฉพาะการเติมเลขที่ใบแจ้งซ่อม
create or replace function private.itas_assets_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_doc_no text;
begin
  select s.request_id, s.doc_no into v_request_id, v_doc_no from private.itas_change_source(new.id, new.is_test) s;
  if tg_op = 'INSERT' then
    if new.host_code is not null then
      insert into public.itas_asset_moves (is_test, asset_id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_id, source_request_id, source_doc_no)
      values (new.is_test, new.id, null, new.host_code, null, new.slot, null, new.status, new.updated_by, v_request_id, v_doc_no);
    end if;
  elsif (new.host_code, new.slot, new.status) is distinct from (old.host_code, old.slot, old.status) then
    insert into public.itas_asset_moves (is_test, asset_id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_id, source_request_id, source_doc_no)
    values (new.is_test, new.id, old.host_code, new.host_code, old.slot, new.slot, old.status, new.status, new.updated_by, v_request_id, v_doc_no);
  end if;
  return null;
end;
$$;

-- ลง itas_asset_log ทุกครั้งที่เพิ่ม/แก้อุปกรณ์ (ทั้งแถว ช่องลับเป็น ciphertext) · เหมือนฉบับ 20261222010000 ทุกบรรทัด เพิ่มเฉพาะการเติมเลขที่ใบแจ้งซ่อม
create or replace function private.itas_assets_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_doc_no text;
begin
  select s.request_id, s.doc_no into v_request_id, v_doc_no from private.itas_change_source(new.id, new.is_test) s;
  if tg_op = 'INSERT' then
    insert into public.itas_asset_log (is_test, asset_id, action, actor_id, old_values, new_values, source_request_id, source_doc_no)
    values (new.is_test, new.id, 'created', new.updated_by, null, to_jsonb(new), v_request_id, v_doc_no);
  elsif (to_jsonb(new) - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    insert into public.itas_asset_log (is_test, asset_id, action, actor_id, old_values, new_values, source_request_id, source_doc_no)
    values (new.is_test, new.id, 'updated', new.updated_by, to_jsonb(old), to_jsonb(new), v_request_id, v_doc_no);
  end if;
  return null;
end;
$$;

-- ประวัติของอุปกรณ์หนึ่งชิ้น (เหมือน 20261222010000 ทุกบรรทัด เพิ่มคีย์ source_request_id / source_doc_no ในแต่ละแถวของ log และ moves)
--   source_doc_no = เลขที่ใบแจ้งซ่อมที่เป็นต้นเหตุ (null = แก้ตามปกติผ่านทะเบียน)
create or replace function public.app_itas_asset_history(p_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–500' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.itas_assets a where a.id = p_id and a.is_test = v_actor.is_test) then
    raise exception 'ไม่พบอุปกรณ์นี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'asset_id', p_id,
    'log', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'action', l.action, 'actor_employee_no', e.employee_no, 'actor_full_name', e.first_name || ' ' || e.last_name,
               'old_values', l.old_values, 'new_values', l.new_values, 'created_at', l.created_at,
               'source_request_id', l.source_request_id, 'source_doc_no', l.source_doc_no
             ) order by l.id desc), '[]'::jsonb)
      from (select * from public.itas_asset_log x where x.asset_id = p_id and x.is_test = v_actor.is_test order by x.id desc limit p_limit) l
      join public.employees e on e.id = l.actor_id),
    'moves', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'from_host', m.from_host, 'to_host', m.to_host, 'from_slot', m.from_slot, 'to_slot', m.to_slot,
               'from_status', m.from_status, 'to_status', m.to_status,
               'actor_employee_no', e.employee_no, 'actor_full_name', e.first_name || ' ' || e.last_name, 'created_at', m.created_at,
               'source_request_id', m.source_request_id, 'source_doc_no', m.source_doc_no
             ) order by m.id desc), '[]'::jsonb)
      from (select * from public.itas_asset_moves x where x.asset_id = p_id and x.is_test = v_actor.is_test order by x.id desc limit p_limit) m
      join public.employees e on e.id = m.actor_id)
  );
end;
$$;

-- 3. โหมดทดสอบ: ลงทะเบียนตารางใหม่ + ล้างข้อมูลทดสอบ -----------------------------------
-- replace private.sandbox_unguarded_tables(): เหมือนฉบับ 20261222010000 ครบทุกชื่อ + เพิ่ม itrp_part_changes ในส่วน to_regclass
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
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions','itrp_part_changes',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log','itas_admins']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- ล้างข้อมูลทดสอบของใบแจ้งซ่อม: เหมือน 20261218010000 ทุกบรรทัด เพิ่มเฉพาะ ล็อกตาราง itrp_part_changes + ลบแถว is_test ของมันเป็นลำดับแรก (ลูกของ itrp_requests)
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
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> รอบแก้ไข/ข้อความ/ไฟล์แนบ -> ประวัติ -> บันทึกการซ่อม/อะไหล่/เครื่อง -> admin_log -> ทะเบียนเครื่อง/ประวัติย้อนหลัง -> บันทึกเปลี่ยนชิ้นส่วน) กัน deadlock
  lock table public.itrp_doc_counters, public.itrp_requests, public.itrp_reworks, public.itrp_comments, public.itrp_attachments,
             public.itrp_events, public.itrp_repair_reports, public.itrp_repair_parts, public.itrp_report_devices, public.itrp_admin_log,
             public.itrp_devices, public.itrp_device_log, public.itrp_history_entries, public.itrp_history_entry_revisions,
             public.itrp_part_changes in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itrp.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itrp.purge', 'on', true);

  -- ลูกก่อนแม่: บันทึกเปลี่ยนชิ้นส่วน -> อะไหล่/เครื่องที่ซ่อม -> บันทึกการซ่อม (อ้าง event) -> ไฟล์แนบ (อ้างรอบแก้ไข/ข้อความ) -> ข้อความ (อ้างกันเองลบในคำสั่งเดียวได้) -> รอบแก้ไข -> ประวัติ -> ... -> ใบ
  -- แล้วค่อยลบกลุ่มทะเบียนเครื่อง/ประวัติย้อนหลัง (ไม่อ้างตารางใบ): รอยแก้ -> ประวัติย้อนหลัง -> log ทะเบียน -> ทะเบียนเครื่อง
  foreach v_table in array array['itrp_part_changes', 'itrp_repair_parts', 'itrp_report_devices', 'itrp_repair_reports', 'itrp_attachments', 'itrp_comments', 'itrp_reworks',
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

-- 4. ตัวช่วย (private) ------------------------------------------------------------------
-- ผู้ทำรายการต้องเป็นผู้ดูแลงาน IT ของ itrp (itwo_staff.is_it_admin) และอยู่ใน itas_admins (ทะเบียนอุปกรณ์) ทั้งสองอย่าง
create or replace function private.itrp_part_changes_require_admin(p_actor public.employees)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.itrp_is_it_admin(p_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้' using errcode = 'insufficient_privilege';
  end if;
  if not private.itas_is_it_admin(p_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้' using errcode = 'insufficient_privilege';
  end if;
end;
$$;

-- เครื่องของใบ: รหัสที่ผู้แจ้งกรอก (asset_code) + เครื่องที่ IT ระบุตอนส่งงานทุกรอบ (itrp_report_devices) · source = request ถ้ามาจากผู้แจ้ง ไม่เช่นนั้น report
create or replace function private.itrp_request_machine_codes(p_request_id uuid)
returns table(code text, source text, ord integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.code, (array_agg(c.source order by c.ord))[1], min(c.ord)
  from (
    select upper(btrim(r.asset_code)) as code, 'request'::text as source, 1 as ord
    from public.itrp_requests r
    where r.id = p_request_id and nullif(btrim(r.asset_code), '') is not null
    union all
    select d.device_code, 'report'::text, 2
    from public.itrp_report_devices d
    join public.itrp_repair_reports rr on rr.id = d.report_id
    where rr.request_id = p_request_id
  ) c
  group by c.code
$$;

-- ป้ายชื่อของชิ้นส่วนสำหรับข้อความผิดพลาด: "เลขทะเบียน/รหัส ชื่อ"
create or replace function private.itrp_part_label(p_asset public.itas_assets)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(concat_ws(' ', coalesce(p_asset.reg_no, p_asset.device_code), p_asset.name), ''), 'ชิ้นส่วนที่ไม่มีเลขทะเบียนและชื่อ')
$$;

create or replace function private.itrp_part_status_text(p_status text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_status
    when 'in_use' then 'ใช้งาน'
    when 'spare' then 'สำรอง'
    when 'broken' then 'ชำรุด'
    when 'retired' then 'ยกเลิกใช้งาน'
    else coalesce(p_status, '')
  end
$$;

-- รูปย่อของอุปกรณ์ที่ส่งให้หน้าเลือก (ไม่มีช่องลับ ไม่มี attrs/secrets · serial เป็นช่องปกติของทะเบียน)
create or replace function private.itrp_asset_brief(p_asset public.itas_assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_asset.id,
    'type_code', p_asset.type_code,
    'type_name', (select t.name from public.itas_types t where t.is_test = p_asset.is_test and t.code = p_asset.type_code),
    'reg_no', p_asset.reg_no,
    'device_code', p_asset.device_code,
    'name', p_asset.name,
    'model', p_asset.model,
    'serial', p_asset.serial,
    'status', p_asset.status,
    'host_code', p_asset.host_code,
    'slot', p_asset.slot,
    'place', p_asset.place,
    'updated_at', p_asset.updated_at
  )
$$;

-- อ่านช่อง uuid ของแถวที่ส่งมา (ไม่มี/null = null · ไม่ใช่ uuid = ผิดพลาด ระบุแถว)
create or replace function private.itrp_part_uuid(p_row jsonb, p_key text, p_no integer, p_label text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_row -> p_key is null or jsonb_typeof(p_row -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_row -> p_key) <> 'string' then
    raise exception 'แถวที่ %: % ไม่ถูกต้อง', p_no, p_label using errcode = 'check_violation';
  end if;
  v_text := btrim(p_row ->> p_key);
  if v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'แถวที่ %: % ไม่ถูกต้อง', p_no, p_label using errcode = 'check_violation';
  end if;
  return v_text::uuid;
end;
$$;

-- อ่านช่องข้อความของแถวที่ส่งมา (ตัดช่องว่าง · ว่าง/null = null · ต้องเป็นข้อความ · ยาวเกินหรือมีอักขระควบคุมไม่ได้)
create or replace function private.itrp_part_text(p_row jsonb, p_key text, p_no integer, p_label text, p_max integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_row -> p_key is null or jsonb_typeof(p_row -> p_key) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_row -> p_key) <> 'string' then
    raise exception 'แถวที่ %: % ต้องเป็นข้อความ', p_no, p_label using errcode = 'check_violation';
  end if;
  v_text := nullif(btrim(p_row ->> p_key, E' \t\r\n'), '');
  if v_text is null then
    return null;
  end if;
  if char_length(v_text) > p_max then
    raise exception 'แถวที่ %: % ต้องไม่เกิน % ตัวอักษร', p_no, p_label, p_max using errcode = 'check_violation';
  end if;
  if v_text ~ '[[:cntrl:]]' then
    raise exception 'แถวที่ %: % มีอักขระที่ใช้ไม่ได้', p_no, p_label using errcode = 'check_violation';
  end if;
  return v_text;
end;
$$;

-- รูป JSON ของรายการที่บันทึกไว้ 1 แถว (ไม่มี id ของอุปกรณ์ · ไม่มีช่องลับ)
create or replace function private.itrp_part_change_json(p_change public.itrp_part_changes)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_change.id,
    'line_no', p_change.line_no,
    'action', p_change.action,
    'host_code', p_change.host_code,
    'to_host_code', p_change.to_host_code,
    'asset', jsonb_build_object(
      'type_code', p_change.type_code,
      'type_name', (select t.name from public.itas_types t where t.is_test = p_change.is_test and t.code = p_change.type_code),
      'reg_no', p_change.asset_reg_no,
      'device_code', p_change.asset_device_code,
      'name', p_change.asset_name),
    'new_asset', case when p_change.new_asset_id is null then null else jsonb_build_object(
      'type_code', p_change.type_code,
      'type_name', (select t.name from public.itas_types t where t.is_test = p_change.is_test and t.code = p_change.type_code),
      'reg_no', p_change.new_asset_reg_no,
      'device_code', p_change.new_asset_device_code,
      'name', p_change.new_asset_name) end,
    'result_status', p_change.result_status,
    'slot', p_change.slot,
    'note', p_change.note,
    'actor_employee_no', (select e.employee_no from public.employees e where e.id = p_change.actor_id),
    'actor_full_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p_change.actor_id),
    'created_at', p_change.created_at
  )
$$;

-- 5. RPC -------------------------------------------------------------------------------
-- ข้อมูลให้หน้าเลือกชิ้นส่วนของใบหนึ่งใบ (ผู้ดูแลงาน IT ที่อยู่ใน itas_admins เท่านั้น) · อ่านอย่างเดียว ไม่แก้ข้อมูล
--   {request: {id, doc_no, status, is_test, asset_code, device_name}, can_apply, blocked_reason, max_changes: 20, result_statuses: ['broken','spare','retired'],
--    hosts: [{host_code, source: request|report, device: อุปกรณ์ตัวเครื่อง (device_code ตรงรหัส) หรือ null, parts: [อุปกรณ์ที่ host_code = รหัสนี้ ไม่นับตัวเครื่องเอง ไม่นับที่ยกเลิกใช้งานแล้ว]}],
--    spares: [{type_code, type_name, items: [อุปกรณ์สถานะสำรองที่ยังไม่ผูกเครื่อง]}] เรียงตามลำดับชนิด,
--    move_targets: [{device_code, name, type_code}] เครื่อง/อุปกรณ์ที่มีรหัสอุปกรณ์และยังไม่ยกเลิกใช้งาน}
--   อุปกรณ์แต่ละชิ้น = {id, type_code, type_name, reg_no, device_code, name, model, serial, status, host_code, slot, place, updated_at}
--   can_apply = false เมื่อใบไม่อยู่สถานะ in_progress/it_closed (blocked_reason บอกเหตุผล) · ไม่มีเครื่องของใบ (hosts ว่าง) ก็บันทึกไม่ได้ (ให้ส่งงานโดยระบุเครื่องก่อน)
create or replace function public.app_itrp_part_changes_context(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_blocked text;
  v_hosts jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  perform private.itrp_part_changes_require_admin(v_actor);
  select * into v_req from public.itrp_requests r where r.id = p_request_id;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'host_code', m.code,
           'source', m.source,
           'device', (select private.itrp_asset_brief(a) from public.itas_assets a where a.is_test = v_actor.is_test and a.device_code = m.code),
           'parts', coalesce((
             select jsonb_agg(private.itrp_asset_brief(p) order by p.slot nulls last, p.reg_no nulls last, p.id)
             from public.itas_assets p
             where p.is_test = v_actor.is_test and p.host_code = m.code and p.status <> 'retired' and p.device_code is distinct from m.code), '[]'::jsonb)
         ) order by m.ord, m.code), '[]'::jsonb)
  into v_hosts
  from private.itrp_request_machine_codes(v_req.id) m;

  v_blocked := case
    when v_req.status not in ('in_progress', 'it_closed') then
      'บันทึกการเปลี่ยนชิ้นส่วนได้เฉพาะใบที่ IT กำลังดำเนินการหรือส่งงานแล้ว · ' || private.itrp_status_message(v_req.status)
    when v_hosts = '[]'::jsonb then
      'ใบนี้ยังไม่มีรหัสเครื่อง กรุณาระบุเครื่องที่ซ่อมตอนส่งงานก่อน จึงจะบันทึกการเปลี่ยนชิ้นส่วนได้'
    else null
  end;

  return jsonb_build_object(
    'request', jsonb_build_object('id', v_req.id, 'doc_no', v_req.doc_no, 'status', v_req.status, 'is_test', v_req.is_test,
                                  'asset_code', v_req.asset_code, 'device_name', v_req.device_name),
    'can_apply', v_blocked is null,
    'blocked_reason', v_blocked,
    'max_changes', 20,
    'result_statuses', jsonb_build_array('broken', 'spare', 'retired'),
    'hosts', v_hosts,
    'spares', (
      select coalesce(jsonb_agg(g.obj order by g.sort, g.code), '[]'::jsonb)
      from (
        select t.sort, t.code,
               jsonb_build_object('type_code', t.code, 'type_name', t.name,
                                  'items', jsonb_agg(private.itrp_asset_brief(a) order by a.reg_no nulls last, a.device_code nulls last, a.id)) as obj
        from public.itas_assets a
        join public.itas_types t on t.is_test = a.is_test and t.code = a.type_code
        where a.is_test = v_actor.is_test and a.status = 'spare' and a.host_code is null
        group by t.sort, t.code, t.name
      ) g),
    'move_targets', (
      select coalesce(jsonb_agg(jsonb_build_object('device_code', a.device_code, 'name', a.name, 'type_code', a.type_code)
                                order by a.device_code), '[]'::jsonb)
      from public.itas_assets a
      where a.is_test = v_actor.is_test and a.device_code is not null and a.status <> 'retired')
  );
end;
$$;

-- บันทึกการเปลี่ยน/ถอด/ย้าย/ติดตั้งชิ้นส่วนของใบหนึ่งใบ ครั้งเดียวทั้งก้อน (ผู้ดูแลงาน IT ที่อยู่ใน itas_admins เท่านั้น)
--   p_changes = array 1–20 แถว ชนิดของแต่ละแถวดูหัวไฟล์ · ช่องที่รับ: action, host_code, asset_id, new_asset_id, to_host_code, result_status, slot, note (ช่องอื่น = ผิดพลาด)
--   คืน {request_id, doc_no, batch_id, applied, changes: [รายการที่บันทึก รูปเดียวกับ app_itrp_get_part_changes]}
--   ลง itas_assets (status/host_code/slot/updated_by) + itas_asset_log + itas_asset_moves (อ้างเลขที่ใบ) + itrp_part_changes ในธุรกรรมเดียว
create or replace function public.app_itrp_apply_part_changes(p_request_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
  v_machines text[];
  v_n integer;
  v_i integer;
  v_no integer;
  v_row jsonb;
  v_key text;
  v_plan jsonb := '[]'::jsonb;
  v_p jsonb;
  v_ids uuid[] := '{}';
  v_batch uuid := gen_random_uuid();
  v_action text;
  v_host text;
  v_to_host text;
  v_asset_id uuid;
  v_new_id uuid;
  v_result text;
  v_slot text;
  v_note text;
  v_asset public.itas_assets%rowtype;
  v_new public.itas_assets%rowtype;
  v_target public.itas_assets%rowtype;
  v_changes jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  perform private.itrp_part_changes_require_admin(v_actor);

  if p_changes is null or jsonb_typeof(p_changes) <> 'array' then
    raise exception 'รายการเปลี่ยนชิ้นส่วนต้องเป็นรายการ' using errcode = 'check_violation';
  end if;
  v_n := jsonb_array_length(p_changes);
  if v_n = 0 then
    raise exception 'กรุณาเลือกรายการเปลี่ยนชิ้นส่วนอย่างน้อย 1 รายการ' using errcode = 'check_violation';
  end if;
  if v_n > 20 then
    raise exception 'บันทึกการเปลี่ยนชิ้นส่วนได้ครั้งละไม่เกิน 20 รายการ' using errcode = 'check_violation';
  end if;

  -- ล็อกแถวใบไว้ (กันสถานะเปลี่ยนระหว่างบันทึก เช่น ผู้แจ้งขอแก้ไขงานพร้อมกัน)
  select * into v_req from public.itrp_requests r where r.id = p_request_id for update;
  if v_req.id is null or v_req.is_test <> v_actor.is_test then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  if v_req.status not in ('in_progress', 'it_closed') then
    raise exception 'บันทึกการเปลี่ยนชิ้นส่วนได้เฉพาะใบที่ IT กำลังดำเนินการหรือส่งงานแล้ว · %', private.itrp_status_message(v_req.status)
      using errcode = 'check_violation';
  end if;
  v_machines := array(select m.code from private.itrp_request_machine_codes(v_req.id) m);

  -- เฟส 1: อ่านและตรวจรูปแบบของทุกแถว (ยังไม่แตะข้อมูล)
  for v_i in 0 .. v_n - 1 loop
    v_no := v_i + 1;
    v_row := p_changes -> v_i;
    if jsonb_typeof(v_row) <> 'object' then
      raise exception 'แถวที่ %: รูปแบบไม่ถูกต้อง', v_no using errcode = 'check_violation';
    end if;
    for v_key in select k from jsonb_object_keys(v_row) k loop
      if v_key <> all (array['action', 'host_code', 'asset_id', 'new_asset_id', 'to_host_code', 'result_status', 'slot', 'note']) then
        raise exception 'แถวที่ %: ไม่รู้จักช่อง "%"', v_no, v_key using errcode = 'check_violation';
      end if;
    end loop;

    v_action := private.itrp_part_text(v_row, 'action', v_no, 'ประเภทรายการ', 20);
    if v_action is null or v_action not in ('replace', 'remove', 'move', 'install') then
      raise exception 'แถวที่ %: กรุณาเลือกประเภทรายการ (เปลี่ยนชิ้นส่วน ถอดออก ย้าย หรือติดตั้ง)', v_no using errcode = 'check_violation';
    end if;
    v_host := upper(private.itrp_part_text(v_row, 'host_code', v_no, 'รหัสเครื่อง', 50));
    v_to_host := upper(private.itrp_part_text(v_row, 'to_host_code', v_no, 'เครื่องปลายทาง', 50));
    v_asset_id := private.itrp_part_uuid(v_row, 'asset_id', v_no, 'ชิ้นส่วน');
    v_new_id := private.itrp_part_uuid(v_row, 'new_asset_id', v_no, 'ชิ้นส่วนใหม่');
    v_result := private.itrp_part_text(v_row, 'result_status', v_no, 'สถานะของชิ้นเดิม', 20);
    v_slot := private.itrp_part_text(v_row, 'slot', v_no, 'ช่อง/Slot', 50);
    v_note := private.itrp_part_text(v_row, 'note', v_no, 'หมายเหตุ', 200);

    if v_host is null then
      raise exception 'แถวที่ %: กรุณาเลือกเครื่อง', v_no using errcode = 'check_violation';
    end if;
    if v_asset_id is null then
      raise exception 'แถวที่ %: กรุณาเลือกชิ้นส่วน', v_no using errcode = 'check_violation';
    end if;
    if v_action = 'replace' and v_new_id is null then
      raise exception 'แถวที่ %: กรุณาเลือกชิ้นส่วนใหม่ที่จะใส่แทน', v_no using errcode = 'check_violation';
    end if;
    if v_action <> 'replace' and v_new_id is not null then
      raise exception 'แถวที่ %: รายการประเภทนี้ไม่มีชิ้นส่วนใหม่', v_no using errcode = 'check_violation';
    end if;
    if v_action = 'move' and v_to_host is null then
      raise exception 'แถวที่ %: กรุณาเลือกเครื่องปลายทางที่จะย้ายไป', v_no using errcode = 'check_violation';
    end if;
    if v_action <> 'move' and v_to_host is not null then
      raise exception 'แถวที่ %: รายการประเภทนี้ไม่มีเครื่องปลายทาง', v_no using errcode = 'check_violation';
    end if;
    if v_action in ('replace', 'remove') then
      if v_result is null or v_result not in ('broken', 'spare', 'retired') then
        raise exception 'แถวที่ %: กรุณาเลือกสถานะของชิ้นเดิมที่ถอดออก (ชำรุด สำรอง หรือยกเลิกใช้งาน)', v_no using errcode = 'check_violation';
      end if;
    elsif v_result is not null then
      raise exception 'แถวที่ %: รายการประเภทนี้ไม่ต้องระบุสถานะของชิ้นเดิม', v_no using errcode = 'check_violation';
    end if;

    v_ids := v_ids || v_asset_id;
    if v_new_id is not null then
      v_ids := v_ids || v_new_id;
    end if;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object(
      'line_no', v_no, 'action', v_action, 'host', v_host, 'to_host', v_to_host, 'asset_id', v_asset_id, 'new_id', v_new_id,
      'result', v_result, 'slot', v_slot, 'note', v_note));
  end loop;

  if (select count(*) <> count(distinct x) from unnest(v_ids) x) then
    raise exception 'ใช้ชิ้นส่วนเดียวกันซ้ำในการบันทึกครั้งเดียวไม่ได้ (รวมชิ้นเดิมและชิ้นใหม่)' using errcode = 'check_violation';
  end if;

  -- ล็อกแถวชิ้นส่วนทั้งหมดเรียงตาม id (กัน deadlock และกันสองคนแก้ชิ้นเดียวกันพร้อมกัน) แล้วค่อยอ่านค่าปัจจุบัน
  perform 1 from public.itas_assets a where a.id = any (v_ids) order by a.id for update;

  -- เฟส 2: ตรวจกับข้อมูลจริงทีละแถว
  for v_i in 0 .. v_n - 1 loop
    v_p := v_plan -> v_i;
    v_no := (v_p ->> 'line_no')::integer;
    v_action := v_p ->> 'action';
    v_host := v_p ->> 'host';
    v_to_host := v_p ->> 'to_host';
    v_asset_id := (v_p ->> 'asset_id')::uuid;
    v_new_id := (v_p ->> 'new_id')::uuid;

    if v_host <> all (v_machines) then
      raise exception 'แถวที่ %: เครื่อง % ไม่ได้อยู่ในรายการเครื่องของใบนี้ (รหัสเครื่องที่ผู้แจ้งกรอก หรือเครื่องที่ระบุตอนส่งงาน)', v_no, v_host
        using errcode = 'check_violation';
    end if;

    select * into v_asset from public.itas_assets a where a.id = v_asset_id and a.is_test = v_actor.is_test;
    if v_asset.id is null then
      raise exception 'แถวที่ %: ไม่พบชิ้นส่วนนี้ในทะเบียน (อาจเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่)', v_no using errcode = 'check_violation';
    end if;

    if v_action in ('replace', 'remove', 'move') then
      -- ชิ้นที่จะถอด/ย้าย ต้องติดตั้งอยู่ที่เครื่องนี้จริงตอนนี้ (กันกดซ้ำ/ข้อมูลเก่า)
      if v_asset.host_code is distinct from v_host then
        raise exception 'แถวที่ %: % ไม่ได้ติดตั้งที่เครื่อง % ในทะเบียนแล้ว (อาจถูกย้ายหรือถอดไปก่อนหน้านี้ กรุณาโหลดข้อมูลใหม่)',
          v_no, private.itrp_part_label(v_asset), v_host using errcode = 'check_violation';
      end if;
      if v_asset.status not in ('in_use', 'broken') then
        raise exception 'แถวที่ %: % มีสถานะ "%" จึงเปลี่ยน/ถอด/ย้ายไม่ได้ (ต้องเป็นใช้งานหรือชำรุด)',
          v_no, private.itrp_part_label(v_asset), private.itrp_part_status_text(v_asset.status) using errcode = 'check_violation';
      end if;
      if v_asset.device_code is not distinct from v_host then
        raise exception 'แถวที่ %: ตัวเครื่องเองไม่ใช่ชิ้นส่วนที่เปลี่ยน/ถอด/ย้ายได้', v_no using errcode = 'check_violation';
      end if;
    else
      -- install: ต้องเป็นชิ้นสำรองที่ยังไม่ผูกเครื่องใด
      if v_asset.status <> 'spare' then
        raise exception 'แถวที่ %: % มีสถานะ "%" ติดตั้งได้เฉพาะชิ้นที่เป็นสำรอง',
          v_no, private.itrp_part_label(v_asset), private.itrp_part_status_text(v_asset.status) using errcode = 'check_violation';
      end if;
      if v_asset.host_code is not null then
        raise exception 'แถวที่ %: % ยังผูกอยู่กับเครื่อง % ต้องถอดออกก่อน', v_no, private.itrp_part_label(v_asset), v_asset.host_code using errcode = 'check_violation';
      end if;
      if v_asset.device_code is not distinct from v_host then
        raise exception 'แถวที่ %: ติดตั้งเครื่องลงบนตัวมันเองไม่ได้', v_no using errcode = 'check_violation';
      end if;
    end if;

    if v_action = 'replace' then
      select * into v_new from public.itas_assets a where a.id = v_new_id and a.is_test = v_actor.is_test;
      if v_new.id is null then
        raise exception 'แถวที่ %: ไม่พบชิ้นส่วนใหม่ในทะเบียน (อาจเปลี่ยนไปแล้ว กรุณาโหลดข้อมูลใหม่)', v_no using errcode = 'check_violation';
      end if;
      if v_new.type_code <> v_asset.type_code then
        raise exception 'แถวที่ %: ชนิดไม่ตรงกัน ชิ้นเดิมคือ % แต่ชิ้นใหม่คือ % (เปลี่ยนแทนกันได้เฉพาะชนิดเดียวกัน)', v_no, v_asset.type_code, v_new.type_code
          using errcode = 'check_violation';
      end if;
      if v_new.status <> 'spare' then
        raise exception 'แถวที่ %: ชิ้นใหม่ % มีสถานะ "%" ใช้แทนได้เฉพาะชิ้นที่เป็นสำรอง',
          v_no, private.itrp_part_label(v_new), private.itrp_part_status_text(v_new.status) using errcode = 'check_violation';
      end if;
      if v_new.host_code is not null then
        raise exception 'แถวที่ %: ชิ้นใหม่ % ยังผูกอยู่กับเครื่อง % ต้องถอดออกก่อน', v_no, private.itrp_part_label(v_new), v_new.host_code using errcode = 'check_violation';
      end if;
      if v_new.device_code is not distinct from v_host then
        raise exception 'แถวที่ %: ติดตั้งเครื่องลงบนตัวมันเองไม่ได้', v_no using errcode = 'check_violation';
      end if;
    elsif v_action = 'move' then
      if v_to_host = v_host then
        raise exception 'แถวที่ %: เครื่องปลายทางต้องเป็นคนละเครื่องกับเครื่องเดิม', v_no using errcode = 'check_violation';
      end if;
      select * into v_target from public.itas_assets a where a.is_test = v_actor.is_test and a.device_code = v_to_host;
      if v_target.id is null then
        raise exception 'แถวที่ %: ไม่พบเครื่องปลายทาง % ในทะเบียน (เลือกจากรายการเครื่องที่มีอยู่)', v_no, v_to_host using errcode = 'check_violation';
      end if;
      if v_target.status = 'retired' then
        raise exception 'แถวที่ %: เครื่องปลายทาง % ยกเลิกใช้งานแล้ว', v_no, v_to_host using errcode = 'check_violation';
      end if;
      if v_asset.device_code is not distinct from v_to_host then
        raise exception 'แถวที่ %: ย้ายเครื่องไปติดตั้งบนตัวมันเองไม่ได้', v_no using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  -- เฟส 3: เขียน — บันทึกรายการก่อน (trigger ของ itas ใช้แถวนี้ระบุเลขที่ใบ) แล้วค่อยแก้ทะเบียน
  perform set_config('itas.change_batch', v_batch::text, true);
  for v_i in 0 .. v_n - 1 loop
    v_p := v_plan -> v_i;
    select * into v_asset from public.itas_assets a where a.id = (v_p ->> 'asset_id')::uuid;
    v_new := null;
    if (v_p ->> 'new_id') is not null then
      select * into v_new from public.itas_assets a where a.id = (v_p ->> 'new_id')::uuid;
    end if;
    insert into public.itrp_part_changes (
      is_test, request_id, batch_id, line_no, action, host_code, to_host_code,
      asset_id, type_code, asset_reg_no, asset_device_code, asset_name,
      new_asset_id, new_asset_reg_no, new_asset_device_code, new_asset_name,
      result_status, slot, note, actor_id)
    values (
      v_req.is_test, v_req.id, v_batch, (v_p ->> 'line_no')::smallint, v_p ->> 'action', v_p ->> 'host', v_p ->> 'to_host',
      v_asset.id, v_asset.type_code, v_asset.reg_no, v_asset.device_code, v_asset.name,
      v_new.id, v_new.reg_no, v_new.device_code, v_new.name,
      v_p ->> 'result', v_p ->> 'slot', v_p ->> 'note', v_actor.id);
  end loop;

  for v_i in 0 .. v_n - 1 loop
    v_p := v_plan -> v_i;
    v_action := v_p ->> 'action';
    v_asset_id := (v_p ->> 'asset_id')::uuid;
    v_slot := v_p ->> 'slot';
    if v_action in ('replace', 'remove') then
      -- ชิ้นเดิมถอดออกจากเครื่อง (host/slot ว่าง) และเปลี่ยนเป็นสถานะที่เลือก · ช่องเดิมใช้เป็นค่าเริ่มต้นของชิ้นใหม่ (อ่านก่อนล้าง)
      select * into v_asset from public.itas_assets a where a.id = v_asset_id;
      update public.itas_assets
      set status = v_p ->> 'result', host_code = null, slot = null, updated_by = v_actor.id
      where id = v_asset_id;
      if v_action = 'replace' then
        update public.itas_assets
        set status = 'in_use', host_code = v_p ->> 'host', slot = coalesce(v_slot, v_asset.slot), updated_by = v_actor.id
        where id = (v_p ->> 'new_id')::uuid;
      end if;
    elsif v_action = 'move' then
      update public.itas_assets
      set host_code = v_p ->> 'to_host', slot = v_slot, updated_by = v_actor.id
      where id = v_asset_id;
    else
      update public.itas_assets
      set status = 'in_use', host_code = v_p ->> 'host', slot = v_slot, updated_by = v_actor.id
      where id = v_asset_id;
    end if;
  end loop;
  -- เลิกให้ trigger อ้างใบนี้ (กันการแก้อื่นในธุรกรรมเดียวกันติดเลขที่ใบไปด้วย)
  perform set_config('itas.change_batch', '', true);

  select coalesce(jsonb_agg(private.itrp_part_change_json(c) order by c.line_no), '[]'::jsonb) into v_changes
  from public.itrp_part_changes c where c.batch_id = v_batch;
  return jsonb_build_object('request_id', v_req.id, 'doc_no', v_req.doc_no, 'batch_id', v_batch, 'applied', v_n, 'changes', v_changes);
end;
$$;

-- รายการเปลี่ยนชิ้นส่วนที่บันทึกไว้ของใบ (ใครเห็นใบนี้ได้ก็อ่านได้: ผู้แจ้ง ทีม IT ผู้อนุมัติขั้นแผนก) เรียงตามลำดับที่บันทึก
--   {request_id, doc_no, items: [{id, line_no, action, host_code, to_host_code, asset{type_code, type_name, reg_no, device_code, name},
--     new_asset{...}|null, result_status, slot, note, actor_employee_no, actor_full_name, created_at}]} · ไม่คืน id ของอุปกรณ์/ช่องลับ
create or replace function public.app_itrp_get_part_changes(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  select * into v_req from public.itrp_requests r where r.id = p_request_id;
  if v_req.id is null or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'request_id', v_req.id,
    'doc_no', v_req.doc_no,
    'items', (
      select coalesce(jsonb_agg(private.itrp_part_change_json(c) order by c.id), '[]'::jsonb)
      from public.itrp_part_changes c
      where c.request_id = v_req.id and c.is_test = v_req.is_test));
end;
$$;

-- 6. สิทธิ์เรียกฟังก์ชัน (รันซ้ำได้ ผลเดียวกัน) -----------------------------------------
-- ตัวช่วย private: ถอนจาก public/anon/authenticated (เรียกจาก RPC ที่ SECURITY DEFINER และ trigger เท่านั้น) · ระบุชื่อเอง ไม่ไล่ทั้งกลุ่ม itrp_* (กลุ่มนั้นมีตัวช่วย Storage ที่ต้องเปิดให้ authenticated)
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace
      and p.proname in ('itrp_part_changes_require_admin', 'itrp_request_machine_codes', 'itrp_part_label', 'itrp_part_status_text',
                        'itrp_asset_brief', 'itrp_part_uuid', 'itrp_part_text', 'itrp_part_change_json', 'itas_change_source',
                        'itas_assets_moves', 'itas_assets_log')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('app_itrp_part_changes_context', 'app_itrp_apply_part_changes', 'app_itrp_get_part_changes',
                        'app_itas_asset_history', 'app_sandbox_purge_itrp')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
