-- ============================================================================
-- ใบแจ้งซ่อมคอมพิวเตอร์ (itrp): พนักงานเลือกอุปกรณ์จากทะเบียนตอนแจ้งซ่อม · ส่วนฐานข้อมูลอย่างเดียว (หน้าเว็บทำต่อบน branch เดียวกัน)
--
-- ที่มา: เจ้าของตัดสิน 27/11/2026 · ฟอร์มแจ้งซ่อม: พนักงานพิมพ์รหัสเครื่องคอมที่ IT ติดไว้ (เช่น COM24, AIO01, NBD01) -> ระบบแสดงชื่อเครื่อง + ชื่อผู้ใช้ให้ยืนยัน
--   -> ติ๊กชนิดอุปกรณ์ที่มีปัญหา (คอมพิวเตอร์/โน้ตบุ๊ก, จอ, เครื่องพิมพ์, คีย์บอร์ด, เมาส์, UPS, โปรเจกเตอร์, อื่นๆ) -> ระบบเติมรหัสอุปกรณ์ที่ผูกกับเครื่องนั้นให้ พนักงานแก้ได้
--   ไม่ทราบรหัส/พิมพ์แล้วไม่พบ/ไม่มีคอมประจำ -> ติ๊ก "ไม่ทราบรหัส" ยังเลือกชนิดและพิมพ์รหัสเองได้ (ไม่บังคับ) ส่งใบได้
--
-- สิ่งที่เพิ่ม
--   1) public.app_itrp_lookup_host(p_code)  ผู้แจ้ง (ผู้ใช้ที่สร้างใบแจ้งซ่อมได้) ค้นเครื่องคอมจากทะเบียน itas แบบ "ตรงตัวเท่านั้น"
--        คืนเฉพาะ {found, host:{code,type_code,name,model,user_name}, devices:[{type_code,code,name,model}]} ไม่คืน serial/IP/แผนก/สถานที่/ราคา/attrs อื่น/ช่องลับ
--        ไม่ขยายสิทธิ์ RPC ของ itas (ทุก RPC itas ยังล็อกเฉพาะ itas_admins) · อ่านทะเบียนผ่านฟังก์ชันนี้ฟังก์ชันเดียวและเฉพาะช่องข้างบน
--   2) ตาราง public.itrp_request_devices  อุปกรณ์ที่ผู้แจ้งเลือกต่อใบ (1–10 แถว) เพิ่มได้อย่างเดียว (แก้/ลบ/ล้างไม่ได้) เขียนผ่าน app_itrp_create เท่านั้น
--   3) itrp_requests เพิ่มคอลัมน์ host_code (รหัสเครื่องคอมที่ระบบตรวจพบในทะเบียนตอนแจ้ง) + host_unknown (ผู้แจ้งเลือก "ไม่ทราบรหัสเครื่อง")
--   4) app_itrp_create รับพารามิเตอร์ใหม่ท้ายสุด p_host_code / p_host_unknown / p_devices (ซิกเนเจอร์เดียว ไม่มี overload)
--   5) app_itrp_get_detail คืนเพิ่ม host_code, host_unknown, devices[]
--
-- การตัดสินใจ (ผู้ตรวจ/หน้าเว็บโปรดทราบ)
--   - ใช้คอลัมน์ใหม่ host_code แยกจาก asset_code เดิม: asset_code เป็นข้อความที่ผู้แจ้ง/หน้าเว็บกรอกอิสระ (ใบเก่าและการเรียกแบบเดิมยังใช้) ส่วน host_code
--     "มีค่าก็ต่อเมื่อฐานข้อมูลตรวจเจอเครื่องนั้นในทะเบียนตอนส่งใบ" (ไม่เชื่อหน้าเว็บ) จึงเชื่อใจได้ว่ามีอยู่จริงในโหมดนั้น · เก็บรหัสมาตรฐานของเครื่อง
--     (device_code ถ้ามี ไม่งั้น reg_no) ไม่ใช่ข้อความที่พิมพ์ · หน้าเว็บยังเติม asset_code = รหัสเครื่องตามเดิม (ฟังก์ชันประวัติซ่อม/เปลี่ยนชิ้นส่วนอ่าน asset_code อยู่)
--   - host_unknown = true -> host_code เป็น null เสมอ (ข้อความที่ผู้แจ้งพิมพ์แล้วไม่พบไม่ถูกเก็บใน host_code เพื่อไม่ปนกับรหัสที่ยืนยันแล้ว) · CHECK บังคับที่ตาราง
--   - ใบเดิม/การเรียกแบบเดิม (ไม่ส่งทั้งสามพารามิเตอร์ใหม่) ได้ host_code null, host_unknown false และไม่มีแถวอุปกรณ์ · ตรวจแบบ "ส่งแบบใหม่" เมื่อมีอย่างใดอย่างหนึ่ง:
--     p_host_code ไม่ว่าง, p_host_unknown = true, หรือ p_devices ไม่ใช่ null (ส่ง [] มา = แบบใหม่ที่ไม่มีอุปกรณ์ = ถูกปฏิเสธ)
--     p_devices ตั้ง default เป็น null (ไม่ใช่ '[]' เหมือน app_itrp_complete) เพื่อแยก "ไม่ส่ง" ออกจาก "ส่งแล้วไม่ได้เลือก" ให้ชัด · หน้าเว็บรุ่นเก่าที่ยังเปิดค้างเรียกได้ต่อ
--   - แบบใหม่: host_unknown = false ต้องมี host_code ที่พบในทะเบียน (โหมดเดียวกับผู้แจ้ง ไม่นับเครื่องที่เลิกใช้) · ต้องมีอุปกรณ์ ≥1 แถว (ข้ามแถวว่างทุกช่อง) · ≤10 แถว · ชนิดซ้ำได้ (จอ 2 จอ)
--   - from_register คำนวณที่ฐานข้อมูลเอง: true เมื่อผู้แจ้งยืนยันเครื่องที่พบในทะเบียน (host_unknown = false) และรหัสของแถวนั้นตรงกับอุปกรณ์ที่ทะเบียนผูกกับเครื่องนั้น
--     (ชนิดเดียวกัน และรหัสตรง device_code หรือ reg_no ของอุปกรณ์) หรือเป็นรหัสของเครื่องคอมนั้นเองสำหรับแถวชนิด COMPUTER/LAPTOP · นอกนั้น false (ผู้แจ้งพิมพ์เอง/แก้เอง/ไม่ทราบรหัส)
--   - หน้า lookup ไม่แยกข้อความ "ไม่พบ" ออกจาก "เลิกใช้งานแล้ว" และไม่แยกรหัสสะกดผิดรูปแบบ: ทุกกรณีคืน {found:false} เหมือนกัน (กันการไล่เดาสถานะอุปกรณ์)
--
-- ข้อสังเกตสำหรับ auditor (ไม่ได้ทำ rate limit ตามที่เจ้าของสั่ง)
--   - ผู้ใช้ที่ล็อกอินแล้วทุกคนไล่เดารหัสเครื่องทีละรหัสได้ (COM01..COM99) และเห็นชื่อผู้ใช้เครื่อง (user_name) ของรหัสที่เดาถูก · ไม่มี list/search/LIKE · รูปแบบรหัสแคบ
--     (ตัวพิมพ์ใหญ่/ตัวเลข . _ / - ยาวไม่เกิน 50) · ถ้าต้องการลดความเสี่ยง ทางเลือกคือจำกัดจำนวนครั้งต่อนาทีต่อคน (ต้องมีตารางนับ) หรือซ่อนบางส่วนของชื่อ (เช่น ชื่อต้น + ตัวแรกของนามสกุล)
--   - ผลเปรียบเทียบข้อความ: ไม่มีการคืนข้อความผิดพลาดที่ต่างกันตามสถานะของเครื่อง
--
-- ฟังก์ชันเดิมที่ replace (เริ่มจากนิยามล่าสุดบน main ณ 27/11/2026 แก้เฉพาะจุดที่ระบุ · ก่อน apply ที่ production ให้เทียบ md5(pg_get_functiondef(oid)) กับค่าฐาน)
--   1) private.sandbox_unguarded_tables()      จาก 20270107010000_itar_access_requests.sql  แก้: ต่อชื่อ itrp_request_devices ท้ายกลุ่ม itrp (ชื่อเดิมครบ 105 ชื่อ -> 106 ชื่อ)
--   2) public.app_sandbox_purge_itrp()         จาก 20261225010000_itrp_itas_part_changes.sql  แก้: ล็อก + ลบแถว is_test ของ itrp_request_devices ก่อนตารางใบ
--   3) private.itrp_request_guard()            จาก 20261212010000_itrp_repair_requests.sql  แก้: เพิ่ม host_code, host_unknown ในรายการคอลัมน์ที่ห้ามแก้
--   4) public.app_itrp_get_detail(uuid)        จาก 20261230010000_office_it_approver_worktime.sql  แก้: เพิ่มคีย์ host_code, host_unknown, devices
--   5) public.app_itrp_create(8 พารามิเตอร์)   จาก 20261230010000_office_it_approver_worktime.sql  -> drop แล้ว create ฉบับ 11 พารามิเตอร์ (เนื้อหาเดิมครบ เพิ่มเฉพาะส่วนอุปกรณ์)
--   md5 ฐาน (ค่าจาก PGlite หลัง apply migration ถึง 20270107010000 · นิยามที่ prod อาจจัดรูปต่างได้ ให้เทียบกับ prod จริงก่อน apply และเทียบ 1 ตัวที่ไม่ได้แก้กับ main):
--     private.sandbox_unguarded_tables()                    e2a33acbff59e1ae9d784d8858ff543f  (105 ชื่อ)
--     public.app_sandbox_purge_itrp()                       532ef8075a0fd8a6bb8150185314b7f2
--     private.itrp_request_guard()                          65befcdb2b523f61c70b60ac1df9bd32
--     public.app_itrp_get_detail(uuid)                      c8dca113f68524335b4f07133e2a6e59
--     public.app_itrp_create(text,text,text,text,text,text,text,boolean)  b9c2f5657d7dc6203335fd228d141236
--
-- ไม่แตะ: ตาราง/ฟังก์ชันของ itwo/itas/itua/itar, itrp_request_machine_codes และฟังก์ชันประวัติซ่อม/เปลี่ยนชิ้นส่วน (ยังอ่าน asset_code), ฟังก์ชันกลางของเพื่อน, storage policy, bucket
--
-- ลำดับ deploy: apply migration นี้ก่อนหน้าเว็บจะเรียก app_itrp_lookup_host / ส่ง p_host_code, p_host_unknown, p_devices · หน้าเว็บรุ่นปัจจุบันบน main เรียก app_itrp_create แบบเดิมได้ปกติ
--   หลัง apply ตรวจ: itrp_request_devices relrowsecurity + ไม่มี grant ตรง, trigger 3 ตัว, app_itrp_lookup_host anon เรียกไม่ได้ authenticated เรียกได้,
--   app_itrp_create เหลือฟังก์ชันเดียว (11 พารามิเตอร์), unguarded 106 ชื่อ
--
-- ย้อน (ยังไม่มีข้อมูลจริงในตารางใหม่): drop function public.app_itrp_lookup_host · drop function private.itrp_find_host / itrp_host_devices ·
--   drop function public.app_itrp_create(11 พารามิเตอร์) แล้ว create ฉบับ 8 พารามิเตอร์จาก 20261230010000 กลับ (+ revoke/grant ตามส่วน 8 ท้ายไฟล์) ·
--   create or replace ฟังก์ชันข้อ 1–4 กลับเป็นนิยามของไฟล์ต้นทาง · drop table itrp_request_devices · alter table itrp_requests drop column host_code, host_unknown
--   ถ้ามีใบจริงที่เลือกอุปกรณ์แล้ว ห้ามย้อนด้วยการ drop (เป็นข้อมูลบันทึก) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itrp_part_changes') is null or to_regclass('public.itrp_requests') is null then
    raise exception 'ไม่พบตารางของโมดูลใบแจ้งซ่อม (รุ่นเปลี่ยนชิ้นส่วน) กรุณา apply 20261225010000_itrp_itas_part_changes.sql ก่อน';
  end if;
  if to_regclass('public.itas_assets') is null or to_regclass('public.itas_types') is null then
    raise exception 'ไม่พบทะเบียนอุปกรณ์ IT (itas_assets) กรุณา apply 20261222010000_itas_asset_register.sql ก่อน';
  end if;
  if to_regprocedure('public.app_itrp_create(text, text, text, text, text, text, text, boolean)') is null then
    raise exception 'ไม่พบ app_itrp_create ฉบับ 8 พารามิเตอร์ (apply migration นี้ซ้ำ หรือฐานไม่ใช่ฉบับล่าสุด) หยุดแล้วตรวจ';
  end if;
  if to_regprocedure('private.itrp_is_it_viewer(uuid)') is null then
    raise exception 'ไม่พบ private.itrp_is_it_viewer กรุณา apply 20261230010000_office_it_approver_worktime.sql ก่อน';
  end if;
  if not ('itar_attachments' = any (private.sandbox_unguarded_tables())) then
    raise exception 'private.sandbox_unguarded_tables() ยังไม่ใช่ฉบับของ 20270107010000 กรุณา apply ก่อน (รายชื่อต้องต่อจากฉบับนั้น)';
  end if;
end;
$$;

-- เก็บรายชื่อเดิมไว้ตรวจหลัง replace ว่าไม่มีชื่อใดหาย (ตารางชั่วคราวของ session นี้ · ลบทิ้งท้ายขั้นที่ 6 · ไม่ใช้ on commit drop
-- เพราะถ้าตัวรันไม่ห่อทั้งไฟล์ใน transaction เดียว ตารางจะหายก่อนถึงขั้นตรวจ)
drop table if exists pg_temp.itrp_picker_old_unguarded;
create temp table itrp_picker_old_unguarded as
  select t from unnest(private.sandbox_unguarded_tables()) as t;

-- 1. คอลัมน์ใหม่ของใบแจ้งซ่อม ----------------------------------------------------------
-- host_code: รหัสมาตรฐานของเครื่องคอมที่ฐานข้อมูลตรวจพบในทะเบียนตอนส่งใบ (null = ใบเดิม/ไม่ทราบรหัส)
-- host_unknown: ผู้แจ้งเลือก "ไม่ทราบรหัสเครื่อง" (ใบเดิม = false)
alter table public.itrp_requests
  add column host_code text check (host_code is null or (host_code = upper(btrim(host_code)) and char_length(host_code) between 1 and 50 and host_code !~ '[[:cntrl:]]')),
  add column host_unknown boolean not null default false,
  add constraint itrp_requests_host_ck check (not (host_unknown and host_code is not null));
comment on column public.itrp_requests.host_code is
  'รหัสเครื่องคอมพิวเตอร์ที่ฐานข้อมูลตรวจพบในทะเบียนอุปกรณ์ (itas) ตอนส่งใบ · รหัสมาตรฐาน (device_code หรือ reg_no) · null = ใบเดิม หรือผู้แจ้งเลือกไม่ทราบรหัส · แก้ไม่ได้';
comment on column public.itrp_requests.host_unknown is
  'ผู้แจ้งเลือก "ไม่ทราบรหัสเครื่อง" (true แล้ว host_code ต้องเป็น null) · ใบเดิม = false · แก้ไม่ได้';

-- 2. ตารางอุปกรณ์ที่ผู้แจ้งเลือกต่อใบ ---------------------------------------------------
-- เพิ่มได้อย่างเดียว (trigger เดียวกับตารางประวัติอื่นของ itrp) · เขียนผ่าน app_itrp_create เท่านั้น
-- device_code = รหัสที่ผู้แจ้งยืนยัน/แก้/พิมพ์เอง (ว่างได้ เช่น คีย์บอร์ดที่ไม่มีรหัส) · from_register ฐานข้อมูลคำนวณเอง (ดูหัวไฟล์)
create table public.itrp_request_devices (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  request_id uuid not null,
  seq smallint not null check (seq between 1 and 10),
  type_code text not null check (type_code in ('COMPUTER', 'LAPTOP', 'MONITOR', 'PRINTER', 'KEYBOARD', 'MOUSE', 'UPS', 'PROJECTOR', 'OTHER')),
  device_code text check (device_code is null or (device_code = upper(btrim(device_code)) and char_length(device_code) between 1 and 50 and device_code !~ '[[:cntrl:]]')),
  from_register boolean not null default false,
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 200 and note !~ '[[:cntrl:]]')),
  created_at timestamptz not null default now(),
  foreign key (request_id, is_test) references public.itrp_requests (id, is_test),
  unique (request_id, seq),
  -- "อื่นๆ" ต้องระบุว่าเป็นอุปกรณ์อะไร
  constraint itrp_request_devices_other_note_ck check (type_code <> 'OTHER' or note is not null)
);
-- รหัสเดียวกันอยู่ได้แถวเดียวต่อใบ (ชนิดซ้ำ/รหัสว่างได้หลายแถว)
create unique index itrp_request_devices_code_uk on public.itrp_request_devices (request_id, device_code) where device_code is not null;
create index itrp_request_devices_code_idx on public.itrp_request_devices (is_test, device_code) where device_code is not null;
comment on table public.itrp_request_devices is
  'อุปกรณ์ที่ผู้แจ้งเลือกในใบแจ้งซ่อม (1–10 แถวต่อใบ ใบเดิมไม่มี) · เพิ่มได้อย่างเดียว (trigger) เขียนผ่าน app_itrp_create เท่านั้น · from_register ฐานข้อมูลคำนวณเทียบทะเบียน itas ตอนส่งใบ';

-- ปิดการเข้าถึงตรง (deny-all) เหมือนตารางอื่นของ itrp: อ่าน/เขียนผ่าน RPC เท่านั้น
do $$
declare
  v_sequence text;
begin
  -- ถอน service_role ด้วย (เหตุผลเดียวกับตารางเดิมของ itrp: บันทึก ISO ต้องไม่ถูกเขียนตรงด้วย secret key)
  revoke all on public.itrp_request_devices from public, anon, authenticated, service_role;
  for v_sequence in
    select format('%I.%I', n.nspname, s.relname)
    from pg_catalog.pg_class s
    join pg_catalog.pg_namespace n on n.oid = s.relnamespace
    join pg_catalog.pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
    where s.relkind = 'S' and d.refobjid = 'public.itrp_request_devices'::regclass
  loop
    execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_sequence);
  end loop;
  alter table public.itrp_request_devices enable row level security;
  create policy itrp_request_devices_no_direct_access on public.itrp_request_devices for all to authenticated using (false) with check (false);
  -- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้
  perform private.lab_only_guard_table('public.itrp_request_devices');
end $$;

create trigger itrp_request_devices_sandbox_scope before insert or update or delete on public.itrp_request_devices
  for each row execute function private.sandbox_row_scope();
create trigger itrp_request_devices_append_only before update or delete on public.itrp_request_devices
  for each row execute function private.itrp_append_only_guard();
create trigger itrp_request_devices_no_truncate before truncate on public.itrp_request_devices
  for each statement execute function private.itrp_append_only_guard();

-- 3. ด่านของใบ: host_code / host_unknown แก้ไม่ได้ -------------------------------------
-- เหมือน 20261212010000 ทุกบรรทัด เพิ่มเฉพาะสองคอลัมน์ใหม่ในรายการที่ต้องไม่เปลี่ยน
create or replace function private.itrp_request_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itrp_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ใบแจ้งซ่อมลบไม่ได้ เปลี่ยนได้แค่สถานะ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ใบแจ้งซ่อมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;

  -- UPDATE: ทุกคอลัมน์ยกเว้น status (และ info_return_status ที่เปลี่ยนคู่กับ status) ต้องไม่เปลี่ยน
  if (new.id, new.is_test, new.doc_no, new.doc_year, new.doc_seq, new.requester_id, new.department_id,
      new.asset_code, new.device_name, new.request_kind, new.request_kind_note, new.repair_target, new.repair_target_note,
      new.symptom, new.is_urgent, new.created_at, new.host_code, new.host_unknown)
     is distinct from
     (old.id, old.is_test, old.doc_no, old.doc_year, old.doc_seq, old.requester_id, old.department_id,
      old.asset_code, old.device_name, old.request_kind, old.request_kind_note, old.repair_target, old.repair_target_note,
      old.symptom, old.is_urgent, old.created_at, old.host_code, old.host_unknown) then
    raise exception 'ใบแจ้งซ่อมแก้ไขเนื้อหาไม่ได้ เปลี่ยนได้แค่สถานะ (ถ้าต้องแก้ ให้ยกเลิกแล้วแจ้งใหม่)' using errcode = 'insufficient_privilege';
  end if;

  if new.status is distinct from old.status and not (
       (old.status = 'pending_dept' and new.status in ('pending_it_mgr', 'approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'pending_it_mgr' and new.status in ('approved', 'in_progress', 'rejected', 'cancelled', 'need_info'))
    or (old.status = 'approved' and new.status in ('in_progress', 'cancelled', 'need_info'))
    or (old.status = 'in_progress' and new.status in ('it_closed', 'rejected', 'cancelled', 'need_info'))
    -- it_closed -> in_progress = ผู้แจ้งขอแก้ไขงาน (ผ่าน app_itrp_request_rework เท่านั้น) · received / rejected / cancelled เปิดใหม่ไม่ได้
    or (old.status = 'it_closed' and new.status in ('received', 'in_progress'))
    -- need_info = รอผู้แจ้งตอบ: กลับสถานะเดิม (ตรวจต่อด้านล่าง) หรือจบด้วยยกเลิกเท่านั้น (ระหว่างรอคำตอบไม่อนุมัติไม่ได้)
    or (old.status = 'need_info' and new.status in ('pending_dept', 'pending_it_mgr', 'approved', 'in_progress', 'cancelled'))
  ) then
    raise exception 'เปลี่ยนสถานะใบแจ้งซ่อมจาก % เป็น % ไม่ได้', old.status, new.status using errcode = 'check_violation';
  end if;

  -- ถามกลับผู้แจ้ง: ต้องบันทึกสถานะที่จะกลับไปให้ตรงกับสถานะก่อนถาม · ตอนกลับต้องเป็นสถานะที่บันทึกไว้เท่านั้น (ยกเว้นยกเลิก)
  if new.status = 'need_info' and old.status <> 'need_info' and new.info_return_status is distinct from old.status then
    raise exception 'ถามกลับผู้แจ้งต้องบันทึกสถานะเดิมของใบ (%) ไว้เป็นสถานะที่จะกลับไป', old.status using errcode = 'check_violation';
  end if;
  if old.status = 'need_info' and new.status <> 'need_info'
     and new.status <> 'cancelled' and new.status is distinct from old.info_return_status then
    raise exception 'ใบที่รอผู้แจ้งตอบกลับได้เฉพาะสถานะเดิมก่อนถาม (%) เท่านั้น', old.info_return_status using errcode = 'check_violation';
  end if;
  if new.status = old.status and new.info_return_status is distinct from old.info_return_status then
    raise exception 'แก้สถานะที่ใบจะกลับไปไม่ได้' using errcode = 'check_violation';
  end if;

  -- การรับงานเป็นขั้นสุดท้ายเสมอ: ใบที่ IT เคยส่งงานแล้ว (มี completed) ยกเลิกไม่ได้ (ต้องขอแก้ไขงานหรือรับงานเท่านั้น)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and exists (
       select 1 from public.itrp_events e where e.request_id = old.id and e.action = 'completed') then
    raise exception 'ใบนี้ IT ส่งงานแล้ว ถ้างานยังไม่เรียบร้อยให้กด แก้ไขงาน' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function private.itrp_request_guard() from public, anon, authenticated;

-- 4. ตัวช่วยอ่านทะเบียน (private) ----------------------------------------------------
-- เครื่องคอมในทะเบียนจากรหัสที่พิมพ์ (ตรงตัวเท่านั้น ไม่ใช้ LIKE): ชนิด COMPUTER/LAPTOP ที่ยังไม่เลิกใช้ และ device_code หรือ reg_no ตรง
-- เลือกเฉพาะช่องที่ฟอร์มแจ้งซ่อมต้องใช้ (ไม่อ่าน serial/ราคา/สถานที่/ช่องลับ) · ชื่อผู้ใช้อ่านจาก attrs เฉพาะคีย์ user_name
-- ถ้ารหัสตรงทั้ง device_code ของเครื่องหนึ่งและ reg_no ของอีกเครื่อง (เกิดยาก) เลือกเครื่องที่ device_code ตรงก่อน · ผู้เรียกกำหนดโหมด (p_is_test) มาจากผู้ทำรายการ
create or replace function private.itrp_find_host(p_is_test boolean, p_code text)
returns table(id uuid, type_code text, code text, device_code text, reg_no text, name text, model text, user_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.type_code, coalesce(a.device_code, a.reg_no), a.device_code, a.reg_no, a.name, a.model, a.attrs ->> 'user_name'
  from public.itas_assets a
  where a.is_test = p_is_test
    and a.type_code in ('COMPUTER', 'LAPTOP')
    and a.status <> 'retired'
    and p_code is not null
    and (a.device_code = p_code or a.reg_no = p_code)
  order by (a.device_code = p_code) desc nulls last, a.id
  limit 1
$$;

-- อุปกรณ์ที่ทะเบียนผูกกับเครื่องคอมหนึ่งเครื่อง (host_code ตรงกับ device_code หรือ reg_no ของเครื่อง) เฉพาะ 6 ชนิดที่ฟอร์มรองรับ ยังไม่เลิกใช้
-- ไม่มีรหัส (ทั้ง device_code และ reg_no ว่าง) ไม่คืน เพราะผู้แจ้งอ้างถึงไม่ได้ · เรียงตามชนิดแล้วรหัส · ไม่เกิน 50 แถว
create or replace function private.itrp_host_devices(p_is_test boolean, p_device_code text, p_reg_no text)
returns table(type_code text, code text, device_code text, reg_no text, name text, model text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.type_code, coalesce(a.device_code, a.reg_no), a.device_code, a.reg_no, a.name, a.model
  from public.itas_assets a
  where a.is_test = p_is_test
    and a.host_code is not null
    and a.host_code in (p_device_code, p_reg_no)
    and a.status <> 'retired'
    and a.type_code in ('MONITOR', 'PRINTER', 'KEYBOARD', 'MOUSE', 'UPS', 'PROJECTOR')
    and coalesce(a.device_code, a.reg_no) is not null
  order by a.type_code collate "C", coalesce(a.device_code, a.reg_no) collate "C", a.id
  limit 50
$$;

-- 5. RPC: ค้นเครื่องคอมจากรหัส (ผู้แจ้ง) ------------------------------------------------
-- ผู้เรียก = ผู้ใช้ที่ใช้งานอยู่ซึ่งสร้างใบแจ้งซ่อมได้ (private.itrp_actor เหมือน app_itrp_create) · โหมดจริง/ทดสอบแยกกันตามผู้เรียก
-- ค้นตรงตัวเท่านั้น: normalize (ตัดช่องว่างหัวท้าย + ตัวพิมพ์ใหญ่) ว่าง = error · ยาวเกิน 50 หรือรูปแบบไม่ใช่ A-Z 0-9 . _ / - = {found:false} (ไม่ error)
-- คืนเฉพาะ: found, host{code,type_code,name,model,user_name}, devices[{type_code,code,name,model}] · ไม่คืนช่องอื่นของทะเบียนเลย
create or replace function public.app_itrp_lookup_host(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := private.itrp_norm_code(p_code);
  v_host_id uuid;
  v_host_type text;
  v_host_code text;
  v_host_dev text;
  v_host_reg text;
  v_host_name text;
  v_host_model text;
  v_host_user text;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  if v_code is null then
    raise exception 'กรุณาระบุรหัสเครื่อง' using errcode = 'check_violation';
  end if;
  -- รหัสผิดรูปแบบ/ยาวเกิน ไม่มีทางตรงกับเครื่องในทะเบียน: ตอบเหมือน "ไม่พบ" (ไม่แยกประเภทข้อผิดพลาด)
  if char_length(v_code) > 50 or v_code !~ '^[A-Z0-9][A-Z0-9._/-]*$' then
    return jsonb_build_object('found', false);
  end if;

  select h.id, h.type_code, h.code, h.device_code, h.reg_no, h.name, h.model, h.user_name
    into v_host_id, v_host_type, v_host_code, v_host_dev, v_host_reg, v_host_name, v_host_model, v_host_user
  from private.itrp_find_host(v_actor.is_test, v_code) h;
  if v_host_id is null then
    -- ไม่พบ / เลิกใช้งานแล้ว / ไม่ใช่เครื่องคอม: คำตอบเดียวกัน
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'host', jsonb_build_object(
      'code', v_host_code, 'type_code', v_host_type, 'name', v_host_name, 'model', v_host_model, 'user_name', v_host_user),
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'type_code', d.type_code, 'code', d.code, 'name', d.name, 'model', d.model
             ) order by d.type_code collate "C", d.code collate "C"), '[]'::jsonb)
      from private.itrp_host_devices(v_actor.is_test, v_host_dev, v_host_reg) d)
  );
end;
$$;

-- 6. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- เริ่มจากนิยามล่าสุดบน main/prod (20270107010000_itar_access_requests.sql) ครบทุกชื่อ + เพิ่ม itrp_request_devices ท้ายกลุ่ม itrp
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers','bom_order_requests',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions','itrp_part_changes','itrp_request_devices',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log','itas_admins',
                                      'itua_users','itua_emails','itua_folders','itua_folder_grants','itua_programs',
                                      'itua_program_grants','itua_log','itua_acknowledgements',
                                      'itar_doc_counters','itar_requests','itar_events','itar_admin_log','itar_request_items',
                                      'itar_item_results','itar_comments','itar_attachments']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- ชื่อเดิมต้องไม่หายสักชื่อ (ถ้าหายแปลว่าฐานของ replace ไม่ใช่ฉบับล่าสุด)
do $$
declare
  v_missing text;
begin
  select string_agg(o.t, ', ' order by o.t) into v_missing
  from itrp_picker_old_unguarded o
  where not (o.t = any (private.sandbox_unguarded_tables()));
  if v_missing is not null then
    raise exception 'private.sandbox_unguarded_tables() ใหม่ทำชื่อเดิมหาย: % (ฐานไม่ใช่ฉบับล่าสุด หยุดแล้วตรวจ migration ของเพื่อน)', v_missing;
  end if;
end $$;
drop table pg_temp.itrp_picker_old_unguarded;

-- ล้างข้อมูลทดสอบของใบแจ้งซ่อม: เหมือน 20261225010000 ทุกบรรทัด เพิ่มเฉพาะ ล็อกตาราง itrp_request_devices + ลบแถว is_test ของมันเป็นลำดับแรก (ลูกของ itrp_requests)
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
  -- ลำดับล็อกเรียงตามลำดับที่ RPC อื่นแตะ (ตัวนับ -> ใบ -> รอบแก้ไข/ข้อความ/ไฟล์แนบ -> ประวัติ -> บันทึกการซ่อม/อะไหล่/เครื่อง -> admin_log -> ทะเบียนเครื่อง/ประวัติย้อนหลัง -> บันทึกเปลี่ยนชิ้นส่วน -> อุปกรณ์ที่ผู้แจ้งเลือก) กัน deadlock
  lock table public.itrp_doc_counters, public.itrp_requests, public.itrp_reworks, public.itrp_comments, public.itrp_attachments,
             public.itrp_events, public.itrp_repair_reports, public.itrp_repair_parts, public.itrp_report_devices, public.itrp_admin_log,
             public.itrp_devices, public.itrp_device_log, public.itrp_history_entries, public.itrp_history_entry_revisions,
             public.itrp_part_changes, public.itrp_request_devices in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  -- ตั้ง itrp.purge = on (transaction-local) ให้ trigger ประวัติยอมให้ลบแถวทดสอบเท่านั้น
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itrp.purge', 'on', true);

  -- ลูกก่อนแม่: อุปกรณ์ที่ผู้แจ้งเลือก -> บันทึกเปลี่ยนชิ้นส่วน -> อะไหล่/เครื่องที่ซ่อม -> บันทึกการซ่อม (อ้าง event) -> ไฟล์แนบ (อ้างรอบแก้ไข/ข้อความ) -> ข้อความ (อ้างกันเองลบในคำสั่งเดียวได้) -> รอบแก้ไข -> ประวัติ -> ... -> ใบ
  -- แล้วค่อยลบกลุ่มทะเบียนเครื่อง/ประวัติย้อนหลัง (ไม่อ้างตารางใบ): รอยแก้ -> ประวัติย้อนหลัง -> log ทะเบียน -> ทะเบียนเครื่อง
  foreach v_table in array array['itrp_request_devices', 'itrp_part_changes', 'itrp_repair_parts', 'itrp_report_devices', 'itrp_repair_reports', 'itrp_attachments', 'itrp_comments', 'itrp_reworks',
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

-- 7. แจ้งซ่อม: เพิ่มรหัสเครื่องคอม + อุปกรณ์ที่เลือก ----------------------------------------
-- ต้อง drop ฉบับ 8 พารามิเตอร์ก่อน: create or replace เพิ่มพารามิเตอร์ไม่ได้ และถ้าเก็บไว้คู่กันการเรียกที่ไม่ส่งพารามิเตอร์ใหม่จะกำกวม (ทั้ง Postgres และ PostgREST)
-- ฉบับใหม่ให้ทั้งสามพารามิเตอร์ใหม่มี default จึงรับการเรียกแบบเดิมได้ทุกรูปแบบ (ตามตำแหน่งหรือตามชื่อ) · ที่เหลือเหมือน 20261230010000 ทุกบรรทัด
--   p_host_code    รหัสเครื่องคอมที่ผู้แจ้งยืนยัน (ฐานข้อมูลตรวจในทะเบียนเอง ไม่เชื่อหน้าเว็บ) · p_host_unknown = true -> host_code ถูกเก็บเป็น null
--   p_devices      jsonb array ≤10 แถว แต่ละแถว {"type_code": ชนิด 9 ค่า, "device_code": ข้อความ 1–50 หรือ null, "note": ≤200 (บังคับเมื่อ OTHER)}
--                  แถวว่างทุกช่องข้าม · รหัสซ้ำกันในใบเดียวกันไม่ได้ · ผิดได้ข้อความ "แถวที่ N: …" ภาษาไทย
--   "แบบเดิม" = ไม่ส่งทั้งสามพารามิเตอร์ (host null, unknown false, p_devices null) · นอกนั้นเป็น "แบบใหม่" ที่ต้องมี host_code ที่พบในทะเบียนหรือ host_unknown และมีอุปกรณ์ ≥1 แถว
drop function public.app_itrp_create(text, text, text, text, text, text, text, boolean);

create or replace function public.app_itrp_create(
  p_asset_code text,
  p_device_name text,
  p_request_kind text,
  p_request_kind_note text,
  p_repair_target text,
  p_repair_target_note text,
  p_symptom text,
  p_is_urgent boolean default false,
  p_host_code text default null,
  p_host_unknown boolean default false,
  p_devices jsonb default null
)
 returns table(id uuid, doc_no text)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_actor public.employees%rowtype;
  v_dept public.departments%rowtype;
  v_asset_code text := private.itrp_clean(p_asset_code);
  v_device_name text := private.itrp_clean(p_device_name);
  v_kind_note text := private.itrp_clean(p_request_kind_note);
  v_target_note text := private.itrp_clean(p_repair_target_note);
  v_symptom text := private.itrp_clean(p_symptom);
  v_is_urgent boolean := coalesce(p_is_urgent, false);
  v_host_input text := private.itrp_norm_code(p_host_code);
  v_host_unknown boolean := coalesce(p_host_unknown, false);
  v_devices jsonb := case when p_devices is null or jsonb_typeof(p_devices) = 'null' then null else p_devices end;
  v_new_style boolean;
  v_host_id uuid;
  v_host_code text;
  v_host_dev text;
  v_host_reg text;
  v_rows jsonb := '[]'::jsonb;
  v_row jsonb;
  v_i integer;
  v_seq integer := 0;
  v_dev_type text;
  v_dev_code text;
  v_dev_note text;
  v_dev_codes text[] := '{}';
  v_code_error text;
  v_from_register boolean;
  v_is_it_approver boolean;
  v_dept_is_it boolean;
  v_actor_is_dept_role boolean;
  v_has_dept_approvers boolean;
  v_status text;
  v_doc_year integer;
  v_doc_seq integer;
  v_doc_no text;
  v_request_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();

  select * into v_dept from public.departments d where d.id = v_actor.department_id;
  if v_dept.id is null or not v_dept.is_active then
    raise exception 'แผนกของคุณยังไม่ได้ตั้งค่าหรือถูกปิดใช้งาน กรุณาติดต่อ IT' using errcode = 'check_violation';
  end if;

  -- ตรวจข้อมูลที่กรอก ตามลำดับช่องในฟอร์ม (ข้อความภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ)
  if v_asset_code is not null and char_length(v_asset_code) > 50 then
    raise exception 'รหัสเครื่องคอมพิวเตอร์ต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if v_device_name is null then
    raise exception 'กรุณาระบุชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์' using errcode = 'check_violation';
  end if;
  if char_length(v_device_name) > 200 then
    raise exception 'ชื่อเครื่องคอมพิวเตอร์ / อุปกรณ์ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_request_kind is null or p_request_kind not in ('repair', 'replace_part', 'inspect', 'install', 'other') then
    raise exception 'กรุณาเลือกประเภทคำขอ' using errcode = 'check_violation';
  end if;
  if p_request_kind = 'other' then
    if v_kind_note is null then
      raise exception 'กรุณาระบุประเภทคำขอ (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_kind_note) > 200 then
      raise exception 'ประเภทคำขอ (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    -- ประเภทอื่นไม่เก็บข้อความระบุ ล้างทิ้งกันข้อมูลตกค้าง
    v_kind_note := null;
  end if;
  if p_repair_target is null or p_repair_target not in ('computer', 'device', 'other') then
    raise exception 'กรุณาเลือกประเภทงานซ่อม' using errcode = 'check_violation';
  end if;
  if p_repair_target = 'other' then
    if v_target_note is null then
      raise exception 'กรุณาระบุประเภทงานซ่อม (เมื่อเลือก "อื่นๆ")' using errcode = 'check_violation';
    end if;
    if char_length(v_target_note) > 200 then
      raise exception 'ประเภทงานซ่อม (อื่นๆ) ต้องไม่เกิน 200 ตัวอักษร' using errcode = 'check_violation';
    end if;
  else
    v_target_note := null;
  end if;
  if v_symptom is null then
    raise exception 'กรุณาระบุอาการเสีย-ขัดข้องที่เกิดขึ้นเบื้องต้น' using errcode = 'check_violation';
  end if;
  if char_length(v_symptom) > 2000 then
    raise exception 'อาการเสียต้องไม่เกิน 2,000 ตัวอักษร' using errcode = 'check_violation';
  end if;

  -- เครื่องคอมพิวเตอร์ + อุปกรณ์ที่เลือก (เฉพาะการส่งแบบใหม่ · การเรียกแบบเดิมข้ามทั้งส่วนนี้)
  v_new_style := v_host_input is not null or v_host_unknown or v_devices is not null;
  if v_new_style then
    if v_host_unknown then
      -- ผู้แจ้งไม่ทราบรหัส: ไม่เก็บข้อความที่พิมพ์ไว้ใน host_code (host_code ต้องเป็นรหัสที่ฐานข้อมูลตรวจพบแล้วเท่านั้น)
      v_host_input := null;
    else
      if v_host_input is null then
        raise exception 'กรุณาระบุรหัสเครื่องคอมพิวเตอร์ หรือเลือก "ไม่ทราบรหัสเครื่อง"' using errcode = 'check_violation';
      end if;
      v_code_error := private.itrp_code_error(v_host_input);
      if v_code_error is not null then
        raise exception '%', v_code_error using errcode = 'check_violation';
      end if;
      -- ตรวจในทะเบียนโหมดเดียวกับผู้แจ้ง (ไม่เชื่อว่าหน้าเว็บค้นเจอ) · ไม่พบ/เลิกใช้งานแล้ว/ไม่ใช่เครื่องคอม = ข้อความเดียวกัน
      select h.id, h.code, h.device_code, h.reg_no into v_host_id, v_host_code, v_host_dev, v_host_reg
      from private.itrp_find_host(v_actor.is_test, v_host_input) h;
      if v_host_id is null then
        raise exception 'ไม่พบรหัสเครื่อง % ในทะเบียนอุปกรณ์ กรุณาตรวจสอบรหัสที่ติดบนเครื่อง หรือเลือก "ไม่ทราบรหัสเครื่อง"', v_host_input using errcode = 'check_violation';
      end if;
      -- เครื่องที่ยืนยันในทะเบียนแล้ว: asset_code = รหัสมาตรฐานของเครื่องนั้นเสมอ (ไม่เชื่อ p_asset_code ที่หน้าเว็บส่งมา)
      -- ประวัติการซ่อมและการเปลี่ยนชิ้นส่วน (private.itrp_request_machine_codes) อ่านเครื่องของใบจาก asset_code จึงต้องผูกเครื่องที่ถูกต้องเสมอ
      v_asset_code := v_host_code;
    end if;

    if v_devices is null or jsonb_typeof(v_devices) <> 'array' then
      raise exception 'กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ' using errcode = 'check_violation';
    end if;
    if jsonb_array_length(v_devices) > 10 then
      raise exception 'อุปกรณ์ที่มีปัญหาต้องไม่เกิน 10 รายการ' using errcode = 'check_violation';
    end if;
    for v_i in 0 .. jsonb_array_length(v_devices) - 1 loop
      v_row := v_devices -> v_i;
      if jsonb_typeof(v_row) <> 'object' then
        raise exception 'แถวที่ % ของรายการอุปกรณ์ไม่ถูกต้อง', v_i + 1 using errcode = 'check_violation';
      end if;
      v_dev_type := upper(private.itrp_clean(v_row ->> 'type_code'));
      v_dev_code := private.itrp_norm_code(v_row ->> 'device_code');
      v_dev_note := private.itrp_clean(v_row ->> 'note');
      continue when v_dev_type is null and v_dev_code is null and v_dev_note is null;
      if v_dev_type is null or v_dev_type not in ('COMPUTER', 'LAPTOP', 'MONITOR', 'PRINTER', 'KEYBOARD', 'MOUSE', 'UPS', 'PROJECTOR', 'OTHER') then
        raise exception 'แถวที่ %: กรุณาเลือกชนิดอุปกรณ์', v_i + 1 using errcode = 'check_violation';
      end if;
      if v_dev_code is not null then
        v_code_error := private.itrp_code_error(v_dev_code);
        if v_code_error is not null then
          raise exception 'แถวที่ %: %', v_i + 1, v_code_error using errcode = 'check_violation';
        end if;
        if v_dev_code = any (v_dev_codes) then
          raise exception 'แถวที่ %: รหัสอุปกรณ์ % ซ้ำกับแถวก่อนหน้า (ใส่รหัสเดียวกันสองครั้งในใบเดียวกันไม่ได้)', v_i + 1, v_dev_code using errcode = 'check_violation';
        end if;
        v_dev_codes := v_dev_codes || v_dev_code;
      end if;
      if v_dev_note is not null and char_length(v_dev_note) > 200 then
        raise exception 'แถวที่ %: หมายเหตุอุปกรณ์ต้องไม่เกิน 200 ตัวอักษร', v_i + 1 using errcode = 'check_violation';
      end if;
      if v_dev_note is not null and v_dev_note ~ '[[:cntrl:]]' then
        raise exception 'แถวที่ %: หมายเหตุอุปกรณ์มีอักขระที่ใช้ไม่ได้', v_i + 1 using errcode = 'check_violation';
      end if;
      if v_dev_type = 'OTHER' and v_dev_note is null then
        raise exception 'แถวที่ %: กรุณาระบุอุปกรณ์ (เมื่อเลือก "อื่นๆ")', v_i + 1 using errcode = 'check_violation';
      end if;

      -- from_register: รหัสนี้ตรงกับที่ทะเบียนผูกกับเครื่องที่ผู้แจ้งยืนยัน (ฐานข้อมูลคำนวณเอง) · ผู้แจ้งพิมพ์เอง/แก้เอง/ไม่ทราบรหัส = false
      -- (coalesce: เครื่องที่มีแค่ device_code หรือแค่ reg_no ทำให้การเทียบอีกฝั่งเป็น null ต้องไม่หลุดเป็น null)
      v_from_register := coalesce(case
        when v_host_id is null or v_dev_code is null then false
        when v_dev_type in ('COMPUTER', 'LAPTOP') then v_dev_code = v_host_dev or v_dev_code = v_host_reg
        else exists (
          select 1 from private.itrp_host_devices(v_actor.is_test, v_host_dev, v_host_reg) d
          where d.type_code = v_dev_type and (d.device_code = v_dev_code or d.reg_no = v_dev_code))
      end, false);
      v_seq := v_seq + 1;
      v_rows := v_rows || jsonb_build_object(
        'seq', v_seq, 'type_code', v_dev_type, 'device_code', v_dev_code, 'from_register', v_from_register, 'note', v_dev_note);
    end loop;
    if v_seq = 0 then
      raise exception 'กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ' using errcode = 'check_violation';
    end if;
  end if;

  -- เลือกเส้นทางอนุมัติ (กติกาเดียวกับ itwo)
  v_is_it_approver := private.itrp_is_it_approver(v_actor.id);
  v_dept_is_it := private.itrp_is_it_department(v_dept.id);
  v_actor_is_dept_role := private.itrp_is_dept_approver(v_actor.id, v_dept.id, v_actor.is_test);
  v_has_dept_approvers := exists (
    select 1 from private.itrp_dept_approvers(v_dept.id, v_actor.is_test) a(id) where a.id <> v_actor.id);

  -- ผู้อนุมัติขั้น IT แจ้งเอง (กติกาใหม่ 26/11/2026): ไม่อนุมัติในตัวเองอีกต่อไป ใบวิ่งตามเส้นทางปกติ
  -- (แผนก IT / แผนกไม่มีผู้จัดการ -> รอขั้น IT ครั้งเดียวนับสองขั้น) แต่ขั้น IT ผู้อนุมัติเป็น "หัวหน้า IT" (is_it_viewer) แทน
  -- ถ้าตอนนี้ไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ผ่านอัตโนมัติ) และไม่ปฏิเสธการแจ้ง
  if not v_is_it_approver then
    -- ต้องมีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ ไม่เช่นนั้นใบจะค้างโดยไม่มีใครอนุมัติได้
    if not private.itrp_has_active_it_approver(v_actor.is_test) then
      raise exception 'ยังไม่มีผู้อนุมัติขั้น IT ที่ใช้งานอยู่ กรุณาติดต่อ IT' using errcode = 'check_violation';
    end if;
  end if;
  if v_dept_is_it then
    -- ผู้แจ้งอยู่แผนก IT: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น (บันทึกตอนอนุมัติ)
    v_status := 'pending_it_mgr';
  elsif v_actor_is_dept_role then
    -- ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยของแผนกตัวเอง: ข้ามขั้นแผนก (บันทึก dept_approved ด้านล่าง)
    v_status := 'pending_it_mgr';
  elsif not v_has_dept_approvers then
    -- แผนกไม่มีผู้จัดการ/ผู้ช่วย: ส่งให้ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
    v_status := 'pending_it_mgr';
  else
    v_status := 'pending_dept';
  end if;

  -- เลขที่เอกสาร: ล็อกแถวตัวนับของปีนั้นจนจบ transaction จึงไม่ซ้ำแม้กดพร้อมกัน
  select n.year_ce, n.seq_no, n.doc_no
    into v_doc_year, v_doc_seq, v_doc_no
  from private.itrp_next_doc_no(v_actor.is_test) n;

  insert into public.itrp_requests as rq (
    is_test, doc_no, doc_year, doc_seq, requester_id, department_id,
    asset_code, device_name, request_kind, request_kind_note, repair_target, repair_target_note, symptom, is_urgent, status,
    host_code, host_unknown
  ) values (
    v_actor.is_test, v_doc_no, v_doc_year, v_doc_seq, v_actor.id, v_dept.id,
    v_asset_code, v_device_name, p_request_kind, v_kind_note, p_repair_target, v_target_note, v_symptom, v_is_urgent, v_status,
    v_host_code, v_host_unknown
  ) returning rq.id into v_request_id;

  -- อุปกรณ์ที่ผู้แจ้งเลือก (ตรวจครบแล้วด้านบน) · ลำดับ seq ตามที่ส่งมา
  for v_i in 0 .. jsonb_array_length(v_rows) - 1 loop
    v_row := v_rows -> v_i;
    insert into public.itrp_request_devices (is_test, request_id, seq, type_code, device_code, from_register, note)
    values (v_actor.is_test, v_request_id, (v_row ->> 'seq')::smallint, v_row ->> 'type_code', v_row ->> 'device_code',
            (v_row ->> 'from_register')::boolean, v_row ->> 'note');
  end loop;

  -- ประวัติ ISO (ลำดับ: created ก่อน แล้วจึง dept_approved / it_mgr_approved)
  insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
  values (
    v_actor.is_test, v_request_id, v_actor.id, 'created',
    case when not v_dept_is_it and not v_actor_is_dept_role and not v_has_dept_approvers
         then 'แผนกของผู้แจ้งไม่มีผู้จัดการหรือผู้ช่วยผู้จัดการ ส่งให้ผู้อนุมัติขั้น IT อนุมัติครั้งเดียวนับเป็นทั้งสองขั้น'
    end);

  if v_actor_is_dept_role and not v_dept_is_it then
    insert into public.itrp_events (is_test, request_id, actor_id, action, reason)
    values (v_actor.is_test, v_request_id, v_actor.id, 'dept_approved', 'ผู้แจ้งเป็นผู้จัดการ/ผู้ช่วยผู้จัดการแผนก อนุมัติในตัวเมื่อแจ้งซ่อม');
  end if;

  id := v_request_id;
  doc_no := v_doc_no;
  return next;
end;
$function$;

-- 8. รายละเอียดใบ: เพิ่ม host_code, host_unknown, devices ----------------------------------------
-- เหมือน 20261230010000 ทุกบรรทัด เพิ่มเฉพาะสามคีย์หลัง asset_code · คีย์เดิมไม่เปลี่ยน
-- devices = [{seq, type_code, device_code, from_register, note}] เรียงตาม seq · ใบเดิม/ไม่ได้เลือก = []
CREATE OR REPLACE FUNCTION public.app_itrp_get_detail(p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_actor public.employees%rowtype;
  v_req public.itrp_requests%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itrp_actor();
  select * into v_req from public.itrp_requests w where w.id = p_request_id;
  if v_req.id is null or not private.itrp_can_view(v_req, v_actor) then
    raise exception 'ไม่พบใบแจ้งซ่อมนี้หรือคุณไม่มีสิทธิ์ดูใบนี้' using errcode = 'insufficient_privilege';
  end if;

  return jsonb_build_object(
    'id', v_req.id,
    'is_test', v_req.is_test,
    'doc_no', v_req.doc_no,
    'doc_year', v_req.doc_year,
    'doc_seq', v_req.doc_seq,
    'requester_id', v_req.requester_id,
    'department_id', v_req.department_id,
    'asset_code', v_req.asset_code,
    'host_code', v_req.host_code,
    'host_unknown', v_req.host_unknown,
    'devices', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'seq', d.seq,
               'type_code', d.type_code,
               'device_code', d.device_code,
               'from_register', d.from_register,
               'note', d.note
             ) order by d.seq), '[]'::jsonb)
      from public.itrp_request_devices d
      where d.request_id = v_req.id),
    'device_name', v_req.device_name,
    'request_kind', v_req.request_kind,
    'request_kind_note', v_req.request_kind_note,
    'repair_target', v_req.repair_target,
    'repair_target_note', v_req.repair_target_note,
    'symptom', v_req.symptom,
    'is_urgent', v_req.is_urgent,
    'status', v_req.status,
    'info_return_status', v_req.info_return_status,
    'created_at', v_req.created_at,
    'rework_round', (select coalesce(max(r.round_no), 0) from public.itrp_reworks r where r.request_id = v_req.id),
    -- วันที่กำหนดเสร็จของรอบขอแก้ไขล่าสุด (ไม่มีรอบแก้ไข = null · ใบแจ้งซ่อมไม่มีวันที่ต้องการงานตอนแจ้ง)
    'latest_due_date', (select r.due_date from public.itrp_reworks r where r.request_id = v_req.id order by r.round_no desc limit 1),
    'requester', (
      select jsonb_build_object('employee_no', r.employee_no, 'full_name', r.first_name || ' ' || r.last_name)
      from public.employees r where r.id = v_req.requester_id),
    'department', (
      select jsonb_build_object('code', d.code, 'name_th', d.name_th)
      from public.departments d where d.id = v_req.department_id),
    -- ประวัติ ISO เรียงตาม id (identity = ลำดับเหตุการณ์จริง) พร้อมชื่อผู้ทำ
    'events', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', ev.id,
               'action', ev.action,
               'reason', ev.reason,
               'created_at', ev.created_at,
               'actor_employee_no', a.employee_no,
               'actor_full_name', a.first_name || ' ' || a.last_name
             ) order by ev.id), '[]'::jsonb)
      from public.itrp_events ev
      join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id),
    'reworks', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', rw.id,
               'round_no', rw.round_no,
               'details', rw.details,
               'due_date', rw.due_date,
               'created_at', rw.created_at,
               'requested_by_employee_no', a.employee_no,
               'requested_by_full_name', a.first_name || ' ' || a.last_name
             ) order by rw.round_no), '[]'::jsonb)
      from public.itrp_reworks rw
      join public.employees a on a.id = rw.requested_by
      where rw.request_id = v_req.id),
    -- ไฟล์ตอนแจ้ง/รอบแก้ไข (ไฟล์ของข้อความถาม/ตอบอยู่ใน comments[].attachments)
    'attachments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', att.id,
               'rework_id', att.rework_id,
               'round_no', coalesce(rw.round_no, 0),
               'storage_path', att.storage_path,
               'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
               'file_name', att.file_name,
               'mime_type', att.mime_type,
               'size_bytes', att.size_bytes,
               'created_at', att.created_at,
               'uploaded_by_full_name', a.first_name || ' ' || a.last_name
             ) order by coalesce(rw.round_no, 0), att.created_at, att.id), '[]'::jsonb)
      from public.itrp_attachments att
      join public.employees a on a.id = att.uploaded_by
      left join public.itrp_reworks rw on rw.id = att.rework_id
      where att.request_id = v_req.id and att.comment_id is null),
    -- ถามตอบ (ทุกคนที่เห็นใบเห็นครบ) เรียงตามลำดับจริง (id)
    'comments', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', c.id,
               'kind', c.kind,
               'stage', c.stage,
               'body', c.body,
               'reply_to', c.reply_to,
               'created_at', c.created_at,
               'author_employee_no', a.employee_no,
               'author_full_name', a.first_name || ' ' || a.last_name,
               'attachments', (
                 select coalesce(jsonb_agg(jsonb_build_object(
                          'id', att.id,
                          'storage_path', att.storage_path,
                          'bucket', case when att.is_test then 'itrp-test-files' else 'itrp-files' end,
                          'file_name', att.file_name,
                          'mime_type', att.mime_type,
                          'size_bytes', att.size_bytes,
                          'created_at', att.created_at
                        ) order by att.created_at, att.id), '[]'::jsonb)
                 from public.itrp_attachments att
                 where att.comment_id = c.id)
             ) order by c.id), '[]'::jsonb)
      from public.itrp_comments c
      join public.employees a on a.id = c.author_id
      where c.request_id = v_req.id),
    -- คำถามที่ค้างอยู่ (เฉพาะตอนใบ need_info) ไม่มี = null
    'info_pending', case when v_req.status = 'need_info' then (
      select jsonb_build_object(
               'comment_id', q.id,
               'stage', q.stage,
               'body', q.body,
               'asked_at', q.created_at,
               'asked_by_employee_no', a.employee_no,
               'asked_by_full_name', a.first_name || ' ' || a.last_name)
      from public.itrp_comments q
      join public.employees a on a.id = q.author_id
      where q.id = (private.itrp_pending_question(v_req.id)).id) end,
    -- ลายเซ็นอนุมัติ (event แรกของแต่ละขั้น) ยังไม่อนุมัติ = null · it_mgr = "รับทราบ ฝ่ายบริหาร" บนใบพิมพ์
    'approvals', jsonb_build_object(
      'dept', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'dept_approved'
        order by ev.id limit 1),
      'it_mgr', (
        select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at, 'reason', ev.reason)
        from public.itrp_events ev join public.employees a on a.id = ev.actor_id
        where ev.request_id = v_req.id and ev.action = 'it_mgr_approved'
        order by ev.id limit 1)
    ),
    -- เวลาดำเนินการซ่อมบนใบพิมพ์: เริ่ม = event started · ซ่อมเสร็จ/ส่งมอบงาน = event completed ล่าสุด (ผู้กด = ช่างผู้ดำเนินการ) · รับมอบงาน = ผู้แจ้งที่กดรับ
    -- รวมเวลา (วัน/ชม.) ให้หน้าเว็บคำนวณจาก started.at ถึง completed.at ตอนแสดง
    'started', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'started'
      order by ev.id limit 1),
    'completed', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'completed'
      order by ev.id desc limit 1),
    'received', (
      select jsonb_build_object('by', a.first_name || ' ' || a.last_name, 'at', ev.created_at)
      from public.itrp_events ev join public.employees a on a.id = ev.actor_id
      where ev.request_id = v_req.id and ev.action = 'received'
      order by ev.id desc limit 1),
    -- มีการขอแก้ไขค้างอยู่ (ขอแก้ไขหลังการส่งงานล่าสุด และ IT ยังไม่ส่งงานใหม่) = ช่อง "ส่งแก้ไข" บนใบพิมพ์
    'rework_open', coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'rework_requested'
    ) > coalesce((
      select max(ev.id) from public.itrp_events ev where ev.request_id = v_req.id and ev.action = 'completed'
    ), 0), false),
    -- บันทึกการซ่อม: ชุดล่าสุด (ใช้แสดง/พิมพ์) และทุกชุดเรียงตามการส่งงาน (ประวัติ · ชุดล่าสุดอยู่ท้ายสุด) ยังไม่เคยส่งงาน = null / []
    'repair_report', (
      select private.itrp_report_json(r.id)
      from public.itrp_repair_reports r where r.request_id = v_req.id
      order by r.completed_event_id desc limit 1),
    'repair_reports', (
      select coalesce(jsonb_agg(private.itrp_report_json(r.id) order by r.completed_event_id), '[]'::jsonb)
      from public.itrp_repair_reports r where r.request_id = v_req.id),
    -- นาทีทำงานของ IT (เวลาทำงานเท่านั้น หักช่วงรอผู้แจ้งตอบ) · null = IT ยังไม่เคยส่งงาน
    'work_minutes', private.itrp_work_minutes(v_req.id),
    'allowed_actions', to_jsonb(private.itrp_allowed_actions(v_req, v_actor))
  );
end;
$function$;

-- 9. สิทธิ์เรียกฟังก์ชัน (เหมือนส่วน 15 ของ 20261212010000 · รันซ้ำทั้งชุดได้ ผลเดียวกัน) -----------------
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
