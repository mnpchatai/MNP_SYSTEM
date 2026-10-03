-- ยกเพดานขนาดไฟล์แนบจาก 10 MB เป็น 20 MB ต่อไฟล์ (คำร้อง + หลักฐาน NCR)
--
-- เดิมไฟล์แนบจำกัด 10 MB ต่อไฟล์ที่ฝั่งฐานข้อมูล 3 จุด: check constraint ของตาราง, file_size_limit ของ bucket, และฟังก์ชัน
-- app_ncr_add_attachment (สำหรับ NCR) นอกจากนี้ฝั่งเบราว์เซอร์/server action ตรวจซ้ำอีกชั้น (modules/attachment-image.js MAX_FILE_BYTES)
-- migration นี้ยกทั้ง 3 จุดฝั่งฐานข้อมูลเป็น 20 MB (20971520 ไบต์) พร้อมกัน ไม่แตะชนิดไฟล์ RLS หรือ grants
--
-- ต้อง apply migration นี้ "ก่อน" หรือพร้อมกับการ deploy Pilot Web รุ่นที่ยกเพดานเป็น 20 MB (npx supabase db push)
-- ไม่งั้นไฟล์ 10-20 MB จะผ่านการตรวจฝั่งเบราว์เซอร์แต่ถูก Storage/ฐานข้อมูลปฏิเสธ
-- นอกจากนี้ "Global file size limit" ของ Storage ในโปรเจกต์ Supabase (Dashboard > Storage > Settings) ต้อง >= 20 MB
-- เพราะ bucket ตั้งเกินค่ารวมไม่ได้ (supabase/config.toml ตั้งไว้ 20MiB สำหรับ local/CI)
--
-- Rollback (ถ้าจำเป็น): ตั้งค่าทั้ง 3 จุดกลับเป็น 10485760 ได้ก็ต่อเมื่อไม่มีแถวใน request_attachments / ncr_attachments
-- ที่ size_bytes > 10485760 เพราะ add constraint จะตรวจแถวเดิมและล้มเหลวถ้ามี (ไฟล์เหล่านั้นเป็นหลักฐาน ห้ามลบเพื่อให้ rollback ผ่าน)

-- 1) check constraint ของตาราง (ชื่อมาตรฐานของ Postgres: <ตาราง>_<คอลัมน์>_check)
--    ไม่ใส่ "if exists" ตั้งใจ: ถ้าชื่อไม่ตรง migration ต้องล้มทันที ไม่ใช่ข้ามเงียบๆ แล้วเหลือเพดาน 10 MB เดิมค้างอยู่
alter table public.request_attachments drop constraint request_attachments_size_bytes_check;
alter table public.request_attachments
  add constraint request_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 20971520);

alter table public.ncr_attachments drop constraint ncr_attachments_size_bytes_check;
alter table public.ncr_attachments
  add constraint ncr_attachments_size_bytes_check check (size_bytes > 0 and size_bytes <= 20971520);

-- 2) bucket (ทั้งสองใบเป็น private เหมือนเดิม)
update storage.buckets
set file_size_limit = 20971520
where id in ('request-attachments', 'ncr-attachments');

-- 3) ฟังก์ชันบันทึกไฟล์หลักฐาน NCR — คัดจากนิยามล่าสุดใน 20261002020000_ncr_phase1.sql เปลี่ยนเฉพาะเพดานขนาด
-- บันทึกข้อมูลไฟล์หลักฐานหลังอัปโหลดเข้า storage แล้ว — ขนาดและชนิดไฟล์อ่านจาก storage.objects
-- ไม่เชื่อค่าจาก client และต้องเป็นไฟล์ที่ผู้เรียกอัปโหลดเองในโฟลเดอร์ของ NCR นั้น
create or replace function public.app_ncr_add_attachment(
  p_ncr_id uuid,
  p_section text,
  p_storage_path text,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_status text;
  v_object storage.objects%rowtype;
  v_size bigint;
  v_id uuid;
begin
  v_employee := private.ncr_current_employee();
  if p_section is null or p_section not in ('report', 'response', 'followup') then
    raise exception 'INVALID_ATTACHMENT';
  end if;
  if char_length(trim(coalesce(p_file_name, ''))) not between 1 and 255
     or p_storage_path is null or p_storage_path not like p_ncr_id::text || '/%' then
    raise exception 'INVALID_ATTACHMENT';
  end if;

  select status into v_status from public.ncr_reports where id = p_ncr_id for update;
  if v_status is null or not private.can_access_ncr(p_ncr_id) then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;

  select * into v_object
  from storage.objects
  where bucket_id = 'ncr-attachments' and name = p_storage_path and owner_id = auth.uid()::text;
  if v_object.id is null then
    raise exception 'ATTACHMENT_NOT_UPLOADED';
  end if;
  v_size := coalesce((v_object.metadata->>'size')::bigint, 0);
  if v_size <= 0 or v_size > 20971520 then
    raise exception 'INVALID_ATTACHMENT';
  end if;

  insert into public.ncr_attachments (ncr_id, section, uploader_id, storage_path, file_name, content_type, size_bytes)
  values (p_ncr_id, p_section, v_employee.id, p_storage_path, left(trim(p_file_name), 255),
          coalesce(nullif(v_object.metadata->>'mimetype', ''), 'application/octet-stream'), v_size)
  returning id into v_id;
  perform private.ncr_log(p_ncr_id, v_status, v_status, 'attachment', left(trim(p_file_name), 255), v_employee.id);
  return v_id;
end;
$$;

revoke all on function public.app_ncr_add_attachment(uuid, text, text, text) from public, anon;
grant execute on function public.app_ncr_add_attachment(uuid, text, text, text) to authenticated;
