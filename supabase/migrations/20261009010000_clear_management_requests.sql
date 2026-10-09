-- เคลียรายการ "ใบคำร้องถึงฝ่ายบริหาร" (request_types.code = 'MANAGEMENT') ให้เหลือ 0 รายการ
-- ลบเฉพาะแถวคำร้อง — ไม่แตะโครงสร้าง/ฟังก์ชัน/สิทธิ์/สายอนุมัติของโมดูล ผู้ใช้ยังยื่นใบใหม่ได้ตามเดิม
--
-- สิ่งที่ถูกลบ: public.requests ประเภท MANAGEMENT ทุกแถว และตารางลูกที่ผูก request_id แบบ
--   on delete cascade (approval_steps, request_comments, request_attachments, request_status_history,
--   notifications, request_expected_date_changes และตารางลูกของ workflow ซ่อม)
-- สิ่งที่ "ไม่" แตะ:
--   - request_types / approval_module_permissions / departments / roles และฟังก์ชันทั้งหมด
--   - document_counters ('FT-MGMT') ไม่รีเซ็ต เพื่อไม่ให้เลขที่เอกสารใหม่ไปซ้ำกับเลขเก่าที่
--     สำรองไว้ในสเปรดชีต Apps Script (ชีตนั้น upsert ทับด้วยเลขที่เอกสาร)
--   - ไฟล์จริงใน Storage bucket request-attachments (ลบด้วย SQL ไม่ได้ลบไฟล์จริง) — path ของไฟล์
--     ที่กลายเป็นไฟล์ค้างถูกบันทึกใน audit_logs เพื่อให้ลบผ่าน Storage API ได้ภายหลัง
--
-- Audit: trigger requests_audit / approvals_audit เก็บข้อมูลเดิมของทุกแถวที่ถูกลบไว้ใน
--   audit_logs.metadata->'old' และฟังก์ชันนี้เพิ่มแถวสรุป action = 'purge_requests_by_type'
--
-- Rollback/recovery: ลบแล้วคืนอัตโนมัติไม่ได้ ให้กู้จาก backup ของฐานข้อมูลก่อน deploy
--   หรือสร้างแถว requests/approval_steps กลับจาก audit_logs (entity_type = 'requests' / 'approval_steps',
--   action = 'DELETE', metadata->'old') ส่วน comments/attachments/history/notifications ไม่มี audit

create or replace function private.purge_requests_by_type(p_type_code text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type_id uuid;
  v_request_nos text[];
  v_storage_paths text[];
  v_count integer;
begin
  select id into v_type_id from public.request_types where code = p_type_code;
  if v_type_id is null then
    return 0;
  end if;

  select coalesce(array_agg(r.request_no order by r.request_no), '{}'::text[])
  into v_request_nos
  from public.requests r
  where r.request_type_id = v_type_id;

  select coalesce(array_agg(a.storage_path order by a.storage_path), '{}'::text[])
  into v_storage_paths
  from public.request_attachments a
  join public.requests r on r.id = a.request_id
  where r.request_type_id = v_type_id;

  delete from public.requests where request_type_id = v_type_id;
  get diagnostics v_count = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null,
    'purge_requests_by_type',
    'request_types',
    v_type_id::text,
    jsonb_build_object(
      'type_code', p_type_code,
      'deleted_count', v_count,
      'request_nos', to_jsonb(v_request_nos),
      'orphaned_storage_paths', to_jsonb(v_storage_paths)
    )
  );

  return v_count;
end;
$$;

revoke all on function private.purge_requests_by_type(text) from public, anon, authenticated;

select private.purge_requests_by_type('MANAGEMENT');
