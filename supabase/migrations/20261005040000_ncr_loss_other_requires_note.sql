-- NCR: ความสูญเสียประเภท "อื่นๆ" ต้องมีหมายเหตุอธิบาย
--
-- ประเภท 'other' ไม่มีสูตรคิดตายตัว ถ้าไม่มีหมายเหตุ ยอดจะกองรวมกันโดยไม่มีคำอธิบายและตรวจย้อนไม่ได้
-- เพิ่มการตรวจฝั่งฐานข้อมูล (client ตรวจซ้ำเพื่อความสะดวกของผู้ใช้เท่านั้น):
--   app_ncr_add_loss  loss_type = 'other' ต้องมี p_note ที่ไม่ว่างอย่างน้อย 5 ตัวอักษร (หลัง trim)
--                     มิฉะนั้นคืน INVALID_LOSS_NOTE
-- รายการ 'other' เดิมที่ไม่มีหมายเหตุไม่ถูกแตะ และไม่เพิ่ม check constraint บนตารางเพื่อไม่ให้กระทบข้อมูลเดิม
--
-- เริ่มจากนิยามล่าสุดใน 20261002020000_ncr_phase1.sql (ไม่มี migration อื่นแทนที่) ลายเซ็นเท่าเดิมจึงคงสิทธิ์ execute เดิม
-- Rollback: create or replace app_ncr_add_loss กลับเป็นนิยามใน 20261002020000_ncr_phase1.sql

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
  v_id uuid;
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
  if p_loss_type is null or p_loss_type not in ('scrap', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other') then
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
  values (v_ncr.id, p_loss_type, p_quantity, trim(p_unit), round(p_unit_cost, 2),
          nullif(trim(coalesce(p_note, '')), ''), v_employee.id)
  returning id into v_id;
  return v_id;
end;
$$;
