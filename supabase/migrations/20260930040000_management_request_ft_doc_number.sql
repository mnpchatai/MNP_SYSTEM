-- ใบคำร้องถึงฝ่ายบริหาร (request_types.code = 'MANAGEMENT') ออกเลขที่เอกสารรูปแบบ "FT xxx/yy"
-- (เช่น FT 001/26) แทนรูปแบบกลาง MG-YYYY-NNNNNN
--
-- - ใช้ตัวนับแยกของตัวเองใน document_counters (department_code = 'FT-MGMT') ไม่ปนกับเลขใบแจ้งซ่อม
--   แผนก FT ("FT042/26" ไม่มีช่องว่าง) จึงไม่ชน unique(request_no) และไม่ทำให้เลขใบแจ้งซ่อมข้าม
-- - ปีใช้ 2 หลักตามเวลา Asia/Bangkok เหมือนเลขใบแจ้งซ่อม ตัวนับเริ่มใหม่ทุกปี
-- - ใบที่ออกไปแล้วไม่ถูกแก้เลข ใบใหม่เท่านั้นที่ใช้รูปแบบใหม่
-- - ประเภทอื่นและใบแจ้งซ่อมคงพฤติกรรมเดิมทุกประการ
--
-- Rollback: คืนฟังก์ชัน private.assign_request_number ตามนิยามใน
-- 20260917101000_repair_workflow_schema.sql แล้ว drop function private.next_management_doc_number
create or replace function private.next_management_doc_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_next integer;
begin
  insert into public.document_counters (department_code, year_key, last_number)
  values ('FT-MGMT', v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;
  return 'FT ' || lpad(v_next::text, 3, '0') || '/' || v_year;
end;
$$;

revoke all on function private.next_management_doc_number() from public, anon, authenticated;

create or replace function private.assign_request_number()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_code text;
  type_prefix text;
  uses_repair boolean;
  dept_code text;
begin
  select code, prefix, uses_repair_workflow into type_code, type_prefix, uses_repair
  from public.request_types where id = new.request_type_id;
  if type_prefix is null then raise exception 'Unknown request type'; end if;

  if coalesce(uses_repair, false) then
    select code into dept_code from public.departments where id = new.department_id;
    if dept_code is null then raise exception 'Unknown department'; end if;
    new.request_no := private.next_repair_doc_number(dept_code);
    return new;
  end if;

  if type_code = 'MANAGEMENT' then
    new.request_no := private.next_management_doc_number();
    return new;
  end if;

  new.request_no := type_prefix || '-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.request_number_seq')::text, 6, '0');
  return new;
end;
$$;

revoke all on function private.assign_request_number() from public, anon, authenticated;
