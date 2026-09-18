-- ระยะ 3: โชว์เลขที่เอกสารให้ผู้แจ้งเห็นก่อนกดส่งจริง — อ่านอย่างเดียว ไม่ขยับตัวนับ
-- (ตัวเลขจริงยังคงถูกจองตอน insert โดย private.assign_request_number/next_repair_doc_number
-- เท่านั้น อาจไม่ตรงเป๊ะถ้ามีคนอื่นส่งใบแทรกก่อน แต่พอเป็น hint ในฟอร์มได้)
create or replace function public.app_peek_repair_doc_number(p_department_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_department public.departments%rowtype;
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_last integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_department
  from public.departments
  where id = p_department_id and is_active and is_repair_site
  limit 1;
  if v_department.id is null then
    raise exception 'DEPARTMENT_NOT_REPAIR_SITE';
  end if;

  select last_number into v_last
  from public.document_counters
  where department_code = v_department.code and year_key = v_year;

  return v_department.code || lpad((coalesce(v_last, 0) + 1)::text, 3, '0') || '/' || v_year;
end;
$$;

revoke all on function public.app_peek_repair_doc_number(uuid) from public, anon;
grant execute on function public.app_peek_repair_doc_number(uuid) to authenticated;
