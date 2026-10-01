-- แสดงเลขที่เอกสารถัดไปของใบคำร้องถึงฝ่ายบริหาร (FT xxx/yy) ให้ผู้แจ้งเห็นตอนเลือกประเภทคำร้อง
-- อ่านอย่างเดียว ไม่ขยับตัวนับ (ตัวเลขจริงยังถูกจองตอน insert โดย private.next_management_doc_number
-- เท่านั้น อาจไม่ตรงเป๊ะถ้ามีคนอื่นส่งใบแทรกก่อน) — แนวทางเดียวกับ app_peek_repair_doc_number
--
-- Rollback: drop function public.app_peek_management_doc_number();
create or replace function public.app_peek_management_doc_number()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_last integer;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select last_number into v_last
  from public.document_counters
  where department_code = 'FT-MGMT' and year_key = v_year;

  return 'FT ' || lpad((coalesce(v_last, 0) + 1)::text, 3, '0') || '/' || v_year;
end;
$$;

revoke all on function public.app_peek_management_doc_number() from public, anon;
grant execute on function public.app_peek_management_doc_number() to authenticated;
