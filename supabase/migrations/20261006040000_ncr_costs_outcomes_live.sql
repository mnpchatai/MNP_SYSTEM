-- NCR: เปิดระบบต้นทุนยืนยันยอด + ผลดำเนินการจริง (เดิมทดลองเฉพาะโหมดทดสอบ) ให้ใช้กับใบ NCR จริงด้วย
--
-- เดิม app_ncr_record_loss และ app_ncr_save_outcome ปฏิเสธบัญชี/ใบจริงด้วย 'SANDBOX_ONLY'
-- (20261005090715_ncr_loss_outcomes_dashboard.sql, 20261006030000_ncr_loss_type_repair.sql)
-- ตอนนี้ Pilot Web ใช้ฟอร์มความสูญเสีย/ผลดำเนินการ/แดชบอร์ดชุดเดียวกันทั้งโหมดทดสอบและข้อมูลจริง
--
-- เปลี่ยนเฉพาะเงื่อนไขโหมดข้อมูล: จาก "ต้องเป็นบัญชีทดสอบ + ใบทดสอบเท่านั้น" เป็น "ผู้ทำรายการกับใบต้องอยู่โหมดเดียวกัน"
--   - บัญชีจริง + ใบจริง  -> ทำได้ (ยังต้องผ่าน private.can_edit_ncr_losses เหมือนเดิม)
--   - persona ทดสอบ + ใบทดสอบ -> ทำได้
--   - ข้ามโหมด (จริง<->ทดสอบ) -> SANDBOX_SCOPE_MISMATCH ก่อนเขียนข้อมูล (trigger *_sandbox_scope ยังกันซ้ำอีกชั้น)
-- สิทธิ์แก้ไข สถานะที่ล็อก (closed/cancelled) การตรวจข้อมูล การบันทึกประวัติ และ grants ไม่เปลี่ยน
--
-- ไม่แตะข้อมูล: ยอดเดิมของใบจริงยังเป็น cost_status = 'legacy' (รอตรวจสอบ/ยืนยันในฟอร์มใหม่) ไม่ถูกนับเป็นยอดยืนยันจนกว่าจะตรวจ
-- และ app_ncr_add_loss / app_ncr_add_losses (API รุ่นเก่า) ยังอยู่ เพื่อให้ assets รุ่นเดิมที่ยังเปิดค้างใช้ต่อได้
--
-- เริ่มจากนิยามล่าสุดของ app_ncr_record_loss ใน 20261006030000_ncr_loss_type_repair.sql และของ app_ncr_save_outcome ใน
-- 20261005090715_ncr_loss_outcomes_dashboard.sql เปลี่ยนเฉพาะบรรทัดตรวจโหมดข้อมูล
-- Deploy ฐานข้อมูลนี้ก่อน Pilot assets ที่เรียก RPC สองตัวนี้จากข้อมูลจริง
-- Rollback: create or replace ฟังก์ชันทั้งสองกลับเป็นนิยามในไฟล์ต้นทางข้างต้น (กลับไปปฏิเสธข้อมูลจริงด้วย SANDBOX_ONLY)
--   แถว ncr_outcomes / ncr_losses ที่ผู้ใช้จริงบันทึกไปแล้วยังอยู่และอ่านได้ตามเดิม

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
  if v_employee.is_test is distinct from v_ncr.is_test then raise exception 'SANDBOX_SCOPE_MISMATCH'; end if;
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

create or replace function public.app_ncr_save_outcome(p_ncr_id uuid, p_result jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_status text := p_result->>'result_status';
  v_date date := (p_result->>'result_date')::date;
  v_ref text := nullif(trim(coalesce(p_result->>'evidence_ref','')), '');
  v_note text := nullif(trim(coalesce(p_result->>'note','')), '');
  v_sorted numeric := round((p_result->>'qty_sorted')::numeric,3);
  v_repaired numeric := round((p_result->>'qty_repaired')::numeric,3);
  v_scrapped numeric := round((p_result->>'qty_scrapped')::numeric,3);
  v_returned numeric := round((p_result->>'qty_returned')::numeric,3);
  v_accepted numeric := round((p_result->>'qty_accepted')::numeric,3);
  v_hours numeric := round((p_result->>'downtime_hours')::numeric,3);
  v_reviewed boolean := coalesce((p_result->>'cost_reviewed')::boolean,false);
  v_value numeric;
begin
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if v_employee.is_test is distinct from v_ncr.is_test then raise exception 'SANDBOX_SCOPE_MISMATCH'; end if;
  if not private.can_edit_ncr_losses(v_ncr.id,v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status in ('closed','cancelled') then raise exception 'NCR_LOCKED'; end if;
  if v_status is null or v_status not in ('draft','confirmed') then raise exception 'INVALID_OUTCOME'; end if;
  foreach v_value in array array[v_sorted,v_repaired,v_scrapped,v_returned,v_accepted,v_hours] loop
    if v_value is null or v_value::text in ('NaN','Infinity','-Infinity') or v_value < 0 or v_value > 1e9 then raise exception 'INVALID_OUTCOME'; end if;
  end loop;
  if v_sorted > v_ncr.qty_total or v_repaired + v_scrapped + v_returned + v_accepted > v_ncr.qty_total then raise exception 'OUTCOME_EXCEEDS_LOT'; end if;
  if v_date is null or not isfinite(v_date) or v_date > private.bangkok_today()
    or char_length(coalesce(v_ref,'')) > 200 or char_length(coalesce(v_note,'')) > 1000 then raise exception 'INVALID_OUTCOME'; end if;
  if v_status = 'confirmed' and v_ref is null then raise exception 'LOSS_EVIDENCE_REQUIRED'; end if;
  if v_reviewed and (v_status <> 'confirmed' or exists(select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null and cost_status <> 'confirmed')) then raise exception 'COST_REVIEW_PENDING'; end if;
  if v_reviewed and not exists(select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null) and v_note is null then raise exception 'ZERO_COST_REASON_REQUIRED'; end if;
  insert into public.ncr_outcomes (ncr_id,result_date,result_status,qty_sorted,qty_repaired,qty_scrapped,qty_returned,qty_accepted,downtime_hours,cost_reviewed,evidence_ref,note,updated_by,verified_by,verified_at)
  values(v_ncr.id,v_date,v_status,v_sorted,v_repaired,v_scrapped,v_returned,v_accepted,v_hours,v_reviewed,v_ref,v_note,v_employee.id,
    case when v_status = 'confirmed' then v_employee.id end,case when v_status = 'confirmed' then now() end)
  on conflict (ncr_id) do update set result_date=excluded.result_date,result_status=excluded.result_status,
    qty_sorted=excluded.qty_sorted,qty_repaired=excluded.qty_repaired,qty_scrapped=excluded.qty_scrapped,
    qty_returned=excluded.qty_returned,qty_accepted=excluded.qty_accepted,downtime_hours=excluded.downtime_hours,
    cost_reviewed=excluded.cost_reviewed,evidence_ref=excluded.evidence_ref,note=excluded.note,
    updated_by=excluded.updated_by,updated_at=now(),verified_by=excluded.verified_by,verified_at=excluded.verified_at;
  perform private.ncr_log(v_ncr.id,v_ncr.status,v_ncr.status,'outcome_record',v_status || ' · ' || coalesce(v_note,''),v_employee.id);
  return v_ncr.id;
end;
$$;

-- create or replace คง owner/grants เดิมไว้ แต่ย้ำให้ตรงกับนิยามต้นทางเพื่อให้ตรวจง่าย
revoke all on function public.app_ncr_record_loss(uuid,jsonb,uuid) from public,anon;
revoke all on function public.app_ncr_save_outcome(uuid,jsonb) from public,anon;
grant execute on function public.app_ncr_record_loss(uuid,jsonb,uuid) to authenticated;
grant execute on function public.app_ncr_save_outcome(uuid,jsonb) to authenticated;
