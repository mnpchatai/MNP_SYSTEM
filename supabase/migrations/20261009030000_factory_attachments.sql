-- ฝ่ายโรงงาน (โหมดทดสอบ): ไฟล์แนบของเอกสาร (Item, BOM, ใบสั่งผลิต, ใบสั่งวัตถุดิบ, ใบงาน)
--
-- ทุกฟอร์มของโมดูลโรงงาน (สร้าง/แก้ไข/ส่ง/ตรวจ QC/บันทึกขั้น/ยกเลิก/ส่งกลับ) แนบไฟล์เพิ่มได้ ไฟล์ผูกกับเอกสารที่เกี่ยวข้อง
-- (entity_type + entity_id) แสดงรวมในส่วน "ไฟล์แนบ" ของเอกสารนั้น
--
-- 1) public.factory_attachments : ข้อมูลไฟล์ (deny-all, อ่านผ่าน app_factory_list_attachments, เขียนผ่าน app_factory_add_attachment)
--    มี is_test + trigger factory_sandbox_scope และลงทะเบียนใน private.sandbox_unguarded_tables() เหมือนตารางโรงงานอื่น
-- 2) bucket factory-attachments (private, 20 MB, ชนิดไฟล์เดียวกับ ncr-attachments) path = <entity_type>/<entity_id>/<uuid>-<ชื่อไฟล์>
--    ทุก policy ต้องเป็น admin ที่อยู่ในโหมดทดสอบ (private.sandbox_persona()) — โมดูลโรงงานเปิดเฉพาะโหมดทดสอบ
-- 3) ล้างข้อมูลทดสอบ: SQL ลบไฟล์จริงใน Storage ไม่ได้ ผู้เรียกต้องลบไฟล์ผ่าน Storage API ก่อน
--    (app_factory_attachment_paths ให้รายการ path) แล้ว app_sandbox_purge_factory ถึงล้างแถว — ถ้ายังมีไฟล์ค้างอยู่
--    ฟังก์ชันปฏิเสธด้วย FACTORY_FILES_REMAIN จึงไม่เกิดไฟล์ค้างที่ไม่มีแถวชี้
--
-- เริ่มจากนิยามล่าสุดของ app_sandbox_purge_factory ใน 20261007070000_factory_qc_ncr.sql และ private.sandbox_unguarded_tables
-- ในไฟล์เดียวกัน เปลี่ยนเฉพาะส่วนไฟล์แนบ
-- Rollback: drop function app_factory_add_attachment / app_factory_list_attachments / app_factory_attachment_paths,
--   create or replace app_sandbox_purge_factory และ private.sandbox_unguarded_tables กลับเป็นนิยามใน 20261007070000,
--   ลบไฟล์ใน bucket ผ่าน Storage API แล้ว drop policy factory_files_*, ลบ bucket และ drop table public.factory_attachments

-- 1. ตาราง -------------------------------------------------------------------------------
create table public.factory_attachments (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  entity_type text not null check (entity_type in ('item', 'bom', 'production_order', 'material_order', 'job')),
  entity_id uuid not null,
  uploader_id uuid references public.employees(id) on delete set null,
  storage_path text not null unique,
  file_name text not null check (char_length(file_name) between 1 and 255),
  content_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_at timestamptz not null default now()
);
create index factory_attachments_entity_idx on public.factory_attachments(entity_type, entity_id, created_at);
comment on table public.factory_attachments is 'ไฟล์แนบของเอกสารฝ่ายโรงงาน (เฉพาะโหมดทดสอบ) ผูกด้วย entity_type + entity_id ไม่มี FK เพราะอ้างหลายตาราง ตรวจที่ app_factory_add_attachment';

create trigger factory_attachments_sandbox_scope before insert or update or delete on public.factory_attachments
  for each row execute function private.factory_sandbox_scope();
create trigger factory_attachments_audit after insert or update or delete on public.factory_attachments
  for each row execute function private.audit_row_change();
revoke all on public.factory_attachments from anon, authenticated;
alter table public.factory_attachments enable row level security;
create policy factory_attachments_no_direct_access on public.factory_attachments
  for all to authenticated using (false) with check (false);

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการจาก 20261007070000 ทุกชื่อ แล้วเพิ่ม factory_attachments)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history',
    'factory_jobs','factory_job_steps','factory_job_history','factory_job_inspections',
    'factory_attachments']
$$;

-- 2. bucket + policy -------------------------------------------------------------------------
-- path ต้องเป็น <entity_type>/<uuid>/<ไฟล์> (ตรวจรูปแบบก่อน cast ไม่ให้ชื่อผิดรูปทำ policy error)
create or replace function private.factory_attachment_path_ok(p_object_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select (storage.foldername(p_object_name))[1] in ('item', 'bom', 'production_order', 'material_order', 'job')
     and (storage.foldername(p_object_name))[2] ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
$$;
revoke all on function private.factory_attachment_path_ok(text) from public, anon;
grant execute on function private.factory_attachment_path_ok(text) to authenticated;

-- policy ของ storage.objects ถูกประเมินในฐานะ authenticated กับทุก bucket (รวม ncr-attachments / request-attachments)
-- จึงต้องเรียกผ่านฟังก์ชันที่ authenticated execute ได้ — เรียก private.sandbox_persona() ตรง ๆ จะทำให้ผู้ใช้ทุกคนอัปโหลด/อ่านไฟล์ของ bucket อื่นไม่ได้
-- ฟังก์ชันนี้คืนแค่ true/false ว่าผู้เรียกเป็น admin ที่อยู่ในโหมดทดสอบหรือไม่ (ไม่เปิดเผย persona)
create or replace function private.factory_files_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.sandbox_persona()).id is not null
$$;
revoke all on function private.factory_files_allowed() from public, anon;
grant execute on function private.factory_files_allowed() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'factory-attachments',
  'factory-attachments',
  false,
  20971520,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy factory_files_read on storage.objects for select to authenticated
using (bucket_id = 'factory-attachments' and private.factory_files_allowed());
create policy factory_files_upload on storage.objects for insert to authenticated
with check (
  bucket_id = 'factory-attachments'
  and owner_id = (select auth.uid())::text
  and private.factory_files_allowed()
  and private.factory_attachment_path_ok(name)
);
-- ลบไฟล์ได้ทุกไฟล์ในโหมดทดสอบ: ข้อมูลทดสอบเป็นของส่วนกลาง admin คนอื่นต้องล้างไฟล์ที่ admin ก่อนหน้าอัปโหลดไว้ได้
-- (ใช้ตอนล้างข้อมูลทดสอบ และเก็บกวาดไฟล์ที่อัปโหลดแล้วบันทึกข้อมูลไม่สำเร็จ)
create policy factory_files_delete on storage.objects for delete to authenticated
using (bucket_id = 'factory-attachments' and private.factory_files_allowed());

-- 3. RPC -------------------------------------------------------------------------------------
create or replace function public.app_factory_add_attachment(
  p_entity_type text,
  p_entity_id uuid,
  p_storage_path text,
  p_file_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_object storage.objects%rowtype;
  v_size bigint;
  v_name text := left(btrim(coalesce(p_file_name, '')), 255);
  v_exists boolean;
  v_id uuid;
begin
  v_actor := private.factory_actor();
  if p_entity_type is null or p_entity_id is null or v_name = ''
     or p_storage_path is null or p_storage_path not like p_entity_type || '/' || p_entity_id::text || '/%' then
    raise exception 'INVALID_ATTACHMENT';
  end if;
  v_exists := case p_entity_type
    when 'item' then exists (select 1 from public.factory_items where id = p_entity_id and is_test)
    when 'bom' then exists (select 1 from public.factory_boms where id = p_entity_id and is_test)
    when 'production_order' then exists (select 1 from public.factory_production_orders where id = p_entity_id and is_test)
    when 'material_order' then exists (select 1 from public.factory_material_orders where id = p_entity_id and is_test)
    when 'job' then exists (select 1 from public.factory_jobs where id = p_entity_id and is_test)
    else null
  end;
  if v_exists is null then raise exception 'INVALID_ATTACHMENT'; end if;
  if not v_exists then raise exception 'ATTACHMENT_ENTITY_NOT_FOUND'; end if;

  -- ขนาดและชนิดไฟล์อ่านจาก storage.objects ไม่เชื่อค่าจาก client และต้องเป็นไฟล์ที่ผู้เรียกอัปโหลดเอง
  select * into v_object
  from storage.objects
  where bucket_id = 'factory-attachments' and name = p_storage_path and owner_id = auth.uid()::text;
  if v_object.id is null then raise exception 'ATTACHMENT_NOT_UPLOADED'; end if;
  v_size := coalesce((v_object.metadata->>'size')::bigint, 0);
  if v_size <= 0 or v_size > 20971520 then raise exception 'INVALID_ATTACHMENT'; end if;

  insert into public.factory_attachments (entity_type, entity_id, uploader_id, storage_path, file_name, content_type, size_bytes)
  values (p_entity_type, p_entity_id, v_actor.id, p_storage_path, v_name,
          coalesce(nullif(v_object.metadata->>'mimetype', ''), 'application/octet-stream'), v_size)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_factory_list_attachments(p_entity_type text, p_entity_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.factory_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'file_name', a.file_name, 'content_type', a.content_type, 'size_bytes', a.size_bytes,
      'storage_path', a.storage_path, 'created_at', a.created_at,
      'uploader_name', coalesce(btrim(e.first_name || ' ' || e.last_name), '')) order by a.created_at, a.id)
    from public.factory_attachments a
    left join public.employees e on e.id = a.uploader_id
    where a.is_test and a.entity_type = p_entity_type and a.entity_id = p_entity_id
  ), '[]'::jsonb);
end;
$$;

-- path ของไฟล์แนบทดสอบทั้งหมด ใช้ลบไฟล์ผ่าน Storage API ก่อนล้างข้อมูลทดสอบ (ต้องเป็น admin ที่อยู่ในโหมดทดสอบ)
create or replace function public.app_factory_attachment_paths()
returns text[]
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;
  return coalesce((select array_agg(storage_path order by storage_path) from public.factory_attachments where is_test), '{}'::text[]);
end;
$$;

revoke all on function public.app_factory_add_attachment(text, uuid, text, text) from public, anon;
revoke all on function public.app_factory_list_attachments(text, uuid) from public, anon;
revoke all on function public.app_factory_attachment_paths() from public, anon;
grant execute on function public.app_factory_add_attachment(text, uuid, text, text) to authenticated;
grant execute on function public.app_factory_list_attachments(text, uuid) to authenticated;
grant execute on function public.app_factory_attachment_paths() to authenticated;

-- 4. ล้างข้อมูลทดสอบ: ปฏิเสธถ้ายังมีไฟล์จริงค้างใน Storage -----------------------------------
create or replace function public.app_sandbox_purge_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_items integer;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ไฟล์แนบ: ลบไฟล์ผ่าน Storage API ก่อน (app_factory_attachment_paths) มิฉะนั้นไฟล์จริงจะค้างโดยไม่มีแถวชี้
  if exists (
    select 1 from public.factory_attachments a
    join storage.objects o on o.bucket_id = 'factory-attachments' and o.name = a.storage_path
    where a.is_test
  ) then
    raise exception 'FACTORY_FILES_REMAIN';
  end if;
  delete from public.factory_attachments where is_test;

  -- ใบงานผลิตและใบสั่งวัตถุดิบอ้างใบสั่งผลิต/BOM/Routing/คลัง ต้องลบก่อน (ลูกก่อนแม่)
  delete from public.factory_job_inspections where is_test;
  delete from public.factory_job_history where is_test;
  delete from public.factory_job_steps where is_test;
  delete from public.factory_jobs where is_test;
  delete from public.factory_material_order_history where is_test;
  delete from public.factory_material_order_lines where is_test;
  delete from public.factory_material_orders where is_test;
  delete from public.factory_inventory_movements where is_test;
  delete from public.factory_lots where is_test;
  delete from public.factory_production_order_history where is_test;
  delete from public.factory_production_orders where is_test;
  delete from public.factory_routing_steps where is_test;
  delete from public.factory_routings where is_test;
  delete from public.factory_bom_history where is_test;
  delete from public.factory_bom_lines where is_test;
  delete from public.factory_boms where is_test;
  delete from public.factory_item_unit_conversions where is_test;
  delete from public.factory_item_history where is_test;
  delete from public.factory_items where is_test;
  get diagnostics v_items = row_count;
  delete from public.factory_work_centers where is_test;
  delete from public.factory_warehouses where is_test;
  -- เริ่มนับเลขใบสั่งผลิต/ใบสั่งงานของโหมดทดสอบใหม่
  delete from public.document_counters where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST', 'FACTORY-MR-TEST', 'FACTORY-JB-TEST');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;
