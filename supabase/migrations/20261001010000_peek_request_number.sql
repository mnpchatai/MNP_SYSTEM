-- แสดงเลขที่เอกสารถัดไปของทุกโมดูลคำร้องที่ไม่ใช่ใบแจ้งซ่อม ให้ผู้แจ้งเห็นตอนเลือกประเภทคำร้อง
-- (ใบแจ้งซ่อมใช้ app_peek_repair_doc_number ที่ผูกกับแผนกอยู่แล้ว)
--   - MANAGEMENT      -> FT xxx/yy   (ตัวนับ document_counters 'FT-MGMT')
--   - ประเภทอื่น       -> <prefix>-YYYY-NNNNNN (ตัวนับกลาง request_number_seq)
-- อ่านอย่างเดียว ไม่ขยับตัวนับ ตัวเลขจริงยังถูกจองตอน insert โดย private.assign_request_number
-- เท่านั้น อาจไม่ตรงเป๊ะถ้ามีคนอื่นส่งใบแทรกก่อน
--
-- แทนที่ app_peek_management_doc_number (เพิ่มเมื่อวานนี้ ใช้เฉพาะ MANAGEMENT และยังไม่มีผู้เรียกอื่น)
-- Rollback: drop function public.app_peek_request_number(uuid);
--           แล้วสร้าง public.app_peek_management_doc_number() กลับจาก 20261001000000_peek_management_doc_number.sql
create or replace function public.app_peek_request_number(p_request_type_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_type public.request_types%rowtype;
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_last integer;
  v_seq_last bigint;
  v_seq_called boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_type from public.request_types where id = p_request_type_id and is_active;
  if v_type.id is null then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;
  if coalesce(v_type.uses_repair_workflow, false) then
    raise exception 'REQUEST_TYPE_NOT_SUPPORTED';
  end if;

  if v_type.code = 'MANAGEMENT' then
    select last_number into v_last
    from public.document_counters
    where department_code = 'FT-MGMT' and year_key = v_year;
    return 'FT ' || lpad((coalesce(v_last, 0) + 1)::text, 3, '0') || '/' || v_year;
  end if;

  select last_value, is_called into v_seq_last, v_seq_called from public.request_number_seq;
  return v_type.prefix || '-' || to_char(now(), 'YYYY') || '-' ||
    lpad((case when v_seq_called then v_seq_last + 1 else v_seq_last end)::text, 6, '0');
end;
$$;

revoke all on function public.app_peek_request_number(uuid) from public, anon;
grant execute on function public.app_peek_request_number(uuid) to authenticated;

drop function if exists public.app_peek_management_doc_number();
