-- NCR: บันทึกความสูญเสียหลายรายการในครั้งเดียว + ประเภทใหม่ "ต้นทุนวัตถุดิบ" (material)
--
-- 1) ncr_losses.loss_type เพิ่มค่า 'material' (ต้นทุนวัตถุดิบที่สูญเสีย) ค่าเดิมทั้งหมดยังใช้ได้
-- 2) แยกกฎตรวจ/บันทึกรายการเดียวเป็น private.ncr_insert_loss ให้ app_ncr_add_loss (รายการเดียว) และ
--    app_ncr_add_losses (หลายรายการ) ใช้กฎเดียวกัน ไม่ copy ซ้ำ
-- 3) app_ncr_add_losses(p_ncr_id, p_losses jsonb): รับ array 1-30 รายการ
--    [{"loss_type","quantity","unit","unit_cost","note"}] ตรวจสิทธิ์/สถานะ NCR ครั้งเดียวใน transaction เดียว
--    ถ้ามีรายการใดไม่ผ่านจะไม่บันทึกเลยสักรายการ (all-or-nothing) และบอกลำดับแถวใน detail ("line=N")
--    คืน uuid[] ของรายการที่เพิ่ม ตามลำดับที่ส่งมา
--
-- เริ่มจากนิยามล่าสุดของ app_ncr_add_loss ใน 20261005040000_ncr_loss_other_requires_note.sql
-- Rollback: drop function public.app_ncr_add_losses(uuid, jsonb); drop function private.ncr_insert_loss(...);
--   create or replace app_ncr_add_loss กลับเป็นนิยามใน 20261005040000_ncr_loss_other_requires_note.sql;
--   คืน check constraint เดิม (ไม่มี 'material') ได้เมื่อไม่มีแถว loss_type = 'material' เหลืออยู่

alter table public.ncr_losses drop constraint ncr_losses_loss_type_check;
alter table public.ncr_losses add constraint ncr_losses_loss_type_check
  check (loss_type in ('scrap', 'material', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other'));

-- ตรวจและบันทึกความสูญเสีย 1 รายการ (ไม่ตรวจสิทธิ์/สถานะ NCR — ผู้เรียกต้องตรวจก่อนแล้ว)
create or replace function private.ncr_insert_loss(
  p_ncr_id uuid,
  p_employee_id uuid,
  p_loss_type text,
  p_quantity numeric,
  p_unit text,
  p_unit_cost numeric,
  p_note text
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_loss_type is null or p_loss_type not in ('scrap', 'material', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other') then
    raise exception 'INVALID_LOSS_TYPE';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1e9
     or p_unit_cost is null or p_unit_cost < 0 or p_unit_cost > 1e9
     or char_length(trim(coalesce(p_unit, ''))) not between 1 and 20
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_LOSS';
  end if;
  if p_loss_type = 'other' and char_length(trim(coalesce(p_note, ''))) < 5 then
    raise exception 'INVALID_LOSS_NOTE';
  end if;

  insert into public.ncr_losses (ncr_id, loss_type, quantity, unit, unit_cost, note, recorded_by)
  values (p_ncr_id, p_loss_type, p_quantity, trim(p_unit), round(p_unit_cost, 2),
          nullif(trim(coalesce(p_note, '')), ''), p_employee_id)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function private.ncr_insert_loss(uuid, uuid, text, numeric, text, numeric, text) from public, anon, authenticated;

create or replace function public.app_ncr_add_loss(
  p_ncr_id uuid,
  p_loss_type text,
  p_quantity numeric,
  p_unit text,
  p_unit_cost numeric,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
begin
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;

  return private.ncr_insert_loss(v_ncr.id, v_employee.id, p_loss_type, p_quantity, p_unit, p_unit_cost, p_note);
end;
$$;

create or replace function public.app_ncr_add_losses(p_ncr_id uuid, p_losses jsonb)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_line jsonb;
  v_line_no integer := 0;
  v_ids uuid[] := '{}';
begin
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;
  if p_losses is null or jsonb_typeof(p_losses) <> 'array'
     or jsonb_array_length(p_losses) not between 1 and 30 then
    raise exception 'INVALID_LOSS_BATCH';
  end if;

  for v_line in select value from jsonb_array_elements(p_losses) loop
    v_line_no := v_line_no + 1;
    begin
      -- ชนิดข้อมูลของแต่ละช่องต้องตรงก่อน cast เพื่อไม่ให้ค่าที่ client ส่งมาผิดรูปหลุดเป็น error ของ Postgres
      if jsonb_typeof(v_line) <> 'object'
         or jsonb_typeof(v_line -> 'quantity') is distinct from 'number'
         or jsonb_typeof(v_line -> 'unit_cost') is distinct from 'number'
         or jsonb_typeof(v_line -> 'unit') is distinct from 'string'
         or jsonb_typeof(v_line -> 'loss_type') is distinct from 'string'
         or coalesce(jsonb_typeof(v_line -> 'note'), 'null') not in ('string', 'null') then
        raise exception 'INVALID_LOSS';
      end if;
      v_ids := v_ids || private.ncr_insert_loss(
        v_ncr.id, v_employee.id,
        v_line ->> 'loss_type',
        (v_line ->> 'quantity')::numeric,
        v_line ->> 'unit',
        (v_line ->> 'unit_cost')::numeric,
        v_line ->> 'note'
      );
    exception when others then
      -- ส่งรหัสเดิมกลับพร้อมลำดับแถว (ลำดับเริ่มที่ 1) transaction ทั้งก้อนถูกยกเลิก ไม่มีรายการใดค้างอยู่
      raise exception '%', sqlerrm using detail = format('line=%s', v_line_no);
    end;
  end loop;

  return v_ids;
end;
$$;

revoke all on function public.app_ncr_add_loss(uuid, text, numeric, text, numeric, text) from public, anon;
grant execute on function public.app_ncr_add_loss(uuid, text, numeric, text, numeric, text) to authenticated;
revoke all on function public.app_ncr_add_losses(uuid, jsonb) from public, anon;
grant execute on function public.app_ncr_add_losses(uuid, jsonb) to authenticated;
