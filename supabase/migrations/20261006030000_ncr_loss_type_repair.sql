-- NCR: เพิ่มประเภทต้นทุน "ค่าซ่อม" (repair) แยกจาก "Rework" (rework)
--
-- ค่าซ่อม (ซ่อมแซมชิ้นงานให้ใช้ได้) กับ Rework เป็นต้นทุนคนละประเภท รายงานต้องแยกกันได้
-- ทั้งสองประเภทใช้องค์ประกอบเดียวกัน: ค่าแรง (labor) วัสดุ (material) ค่าจ้างภายนอก (external)
--
-- 1) ncr_losses.loss_type เพิ่มค่า 'repair' ค่าเดิมทั้งหมดใช้ได้ รายการ 'rework' เดิมไม่ถูกแก้
-- 2) private.ncr_insert_loss (ใช้ร่วมโดย app_ncr_add_loss และ app_ncr_add_losses) รับ 'repair'
-- 3) app_ncr_record_loss รับ 'repair' และใช้กฎองค์ประกอบเดียวกับ 'rework'
--
-- เริ่มจากนิยามล่าสุดของ private.ncr_insert_loss ใน 20261005050000_ncr_losses_batch_and_material.sql และของ
-- app_ncr_record_loss ใน 20261005090715_ncr_loss_outcomes_dashboard.sql เปลี่ยนเฉพาะรายการประเภทและกฎองค์ประกอบ
-- Deploy ฐานข้อมูลก่อน Pilot assets ที่เสนอตัวเลือก "ค่าซ่อม" ในฟอร์ม
-- Rollback: create or replace ฟังก์ชันทั้งสองกลับเป็นนิยามในไฟล์ต้นทางข้างต้น แล้วคืน check constraint เดิม
--   (ไม่มี 'repair') ได้เมื่อไม่มีแถว loss_type = 'repair' เหลืออยู่ (ย้ายรายการเป็น 'rework' หรือยกเลิกก่อน)

alter table public.ncr_losses drop constraint ncr_losses_loss_type_check;
alter table public.ncr_losses add constraint ncr_losses_loss_type_check
  check (loss_type in ('scrap', 'material', 'repair', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other'));

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
  if p_loss_type is null or p_loss_type not in ('scrap', 'material', 'repair', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other') then
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

create or replace function public.app_ncr_record_loss(p_ncr_id uuid, p_entry jsonb, p_loss_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_loss public.ncr_losses%rowtype;
  v_id uuid;
  v_type text := p_entry->>'loss_type';
  v_kind text := p_entry->>'entry_kind';
  v_status text := p_entry->>'cost_status';
  v_component text := p_entry->>'component';
  v_qty numeric := round((p_entry->>'quantity')::numeric, 3);
  v_rate numeric := round((p_entry->>'unit_cost')::numeric, 2);
  v_unit text := trim(coalesce(p_entry->>'unit', ''));
  v_ref text := nullif(trim(coalesce(p_entry->>'evidence_ref', '')), '');
  v_date date := (p_entry->>'incurred_on')::date;
  v_note text := nullif(trim(coalesce(p_entry->>'note', '')), '');
begin
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if not v_employee.is_test or not v_ncr.is_test then raise exception 'SANDBOX_ONLY'; end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status in ('closed', 'cancelled') then raise exception 'NCR_LOCKED'; end if;
  if v_type is null or v_type not in ('scrap','material','repair','rework','sort','reproduce','logistics','claim','downtime','other')
    or v_kind is null or v_kind not in ('loss','recovery') then raise exception 'INVALID_LOSS_TYPE'; end if;
  if v_status is null or v_status not in ('estimated','confirmed') then raise exception 'INVALID_LOSS_STATUS'; end if;
  if v_component is null or not (
    (v_kind = 'recovery' and v_component = 'amount') or
    (v_kind = 'loss' and (
      (v_type in ('repair','rework') and v_component in ('labor','material','external')) or
      (v_type = 'sort' and v_component in ('labor','external')) or
      (v_type in ('scrap','material','downtime') and v_component = 'quantity') or
      (v_type in ('reproduce','logistics','claim','other') and v_component = 'amount')
    ))) then raise exception 'INVALID_LOSS_COMPONENT'; end if;
  if v_qty is null or v_qty::text in ('NaN','Infinity','-Infinity') or v_qty <= 0 or v_qty > 1e9
    or v_rate is null or v_rate::text in ('NaN','Infinity','-Infinity') or v_rate < 0 or v_rate > 1e9
    or v_qty * v_rate >= 1e14 or char_length(v_unit) not between 1 and 20
    or char_length(coalesce(v_note,'')) > 500 or char_length(coalesce(v_ref,'')) > 200
    or (v_component in ('amount','external') and v_qty <> 1)
    then raise exception 'INVALID_LOSS'; end if;
  if v_date is null or not isfinite(v_date) or (v_status = 'confirmed' and v_date > private.bangkok_today()) then raise exception 'INVALID_LOSS_DATE'; end if;
  if v_status = 'confirmed' and v_ref is null then raise exception 'LOSS_EVIDENCE_REQUIRED'; end if;
  if v_type = 'other' and v_kind = 'loss' and char_length(coalesce(v_note,'')) < 5 then raise exception 'INVALID_LOSS_NOTE'; end if;
  if p_loss_id is not null then
    select * into v_loss from public.ncr_losses where id = p_loss_id and ncr_id = v_ncr.id for update;
    if v_loss.id is null then raise exception 'LOSS_NOT_FOUND'; end if;
    if v_loss.voided_at is not null then raise exception 'LOSS_ALREADY_VOIDED'; end if;
    -- Revising an existing estimate/legacy row replaces its amount, never creates a duplicate actual.
    update public.ncr_losses set loss_type = v_type, entry_kind = v_kind, cost_status = v_status,
      component = v_component, quantity = v_qty, unit = v_unit, unit_cost = v_rate,
      incurred_on = v_date, evidence_ref = v_ref, note = v_note,
      verified_by = case when v_status = 'confirmed' then v_employee.id end,
      verified_at = case when v_status = 'confirmed' then now() end
    where id = v_loss.id returning id into v_id;
  else
    insert into public.ncr_losses (ncr_id,loss_type,entry_kind,cost_status,component,quantity,unit,unit_cost,incurred_on,evidence_ref,note,recorded_by,verified_by,verified_at)
    values (v_ncr.id,v_type,v_kind,v_status,v_component,v_qty,v_unit,v_rate,v_date,v_ref,v_note,v_employee.id,
      case when v_status = 'confirmed' then v_employee.id end, case when v_status = 'confirmed' then now() end)
    returning id into v_id;
  end if;
  update public.ncr_outcomes set cost_reviewed = false where ncr_id = v_ncr.id;
  perform private.ncr_log(v_ncr.id,v_ncr.status,v_ncr.status,'loss_record',v_id::text || ' · ' || v_kind || ' · ' || v_status || ' · ' || round(v_qty*v_rate,2)::text,v_employee.id);
  return v_id;
end;
$$;
revoke all on function public.app_ncr_record_loss(uuid,jsonb,uuid) from public,anon;
grant execute on function public.app_ncr_record_loss(uuid,jsonb,uuid) to authenticated;
