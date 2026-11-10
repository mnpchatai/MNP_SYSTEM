-- NCR ความสูญเสีย: ผู้ตอบ NCR ใบนั้นใส่และแก้ยอดประมาณการได้ (ผู้ใช้ตัดสิน 2026-11-10)
--
-- เดิม (20261017030000, 20261101010000) ผู้ใส่ยอดความสูญเสียมีแค่ผู้กรอกต้นทุน (private.can_edit_ncr_losses):
--   ผจก.ทั่วไป, ผจก.โรงงาน, ผช.ผจก.โรงงาน และ ผจก./ผช.ผจก.แผนก QA (รวม admin ที่ตั้งบทบาทหลักเป็นบทบาทเหล่านี้)
-- ผู้ใช้สั่งให้ผู้ที่รับผิดชอบในการตอบ NCR ใบนั้นใส่ยอดและแก้ไขได้ด้วย และตัดสิน (ถามแล้ว 2026-11-10):
--   - ผู้ตอบ = คนที่ตอบ NCR ใบนั้นได้ ตามกติกาเดียวกับการตอบ (private.ncr_can_respond: พนักงาน/ผจก./ผช.ผจก.
--     ของแผนกที่รับผิดชอบ ถ้า ผจก.โรงงานระบุผู้ตอบของแผนกนั้นไว้ ก็เฉพาะคนนั้น)
--   - ผู้ตอบใส่และแก้ได้เฉพาะยอดประมาณการ (cost_status = 'estimated') และแก้ได้เฉพาะรายการที่ยังเป็นประมาณการ
--     ยืนยันยอด (confirmed) ยกเลิกรายการ (app_ncr_void_loss) ติ๊ก "ประเมินค่าเสียหายครบแล้ว" (app_ncr_review_costs)
--     และบันทึกผลดำเนินการ (app_ncr_save_outcome) ยังเป็นของผู้กรอกต้นทุนเท่านั้น แผนกจึงไม่ยืนยันยอดของตัวเอง
--   - คงผู้กรอกต้นทุนเดิมทั้งหมด (รวม ผจก./ผช.ผจก. QA)
-- ผลคือ
--   - ผู้ตอบส่ง cost_status = 'confirmed' หรือแก้รายการที่ยืนยันแล้ว/รายการเดิม (legacy) → LOSS_ESTIMATE_ONLY
--   - คนที่ไม่ใช่ทั้งผู้กรอกต้นทุนและผู้ตอบ → NOT_AUTHORIZED เหมือนเดิม
--   - ช่วงสถานะใบเหมือนผู้กรอกต้นทุน (ใบที่ยกเลิกล็อก NCR_LOCKED ใบที่ปิดแล้วลงย้อนหลังได้) และการใส่ยอดยังรีเซ็ต
--     "ประเมินครบแล้ว" (cost_reviewed = false) เหมือนเดิม
--
-- เปลี่ยนเฉพาะ public.app_ncr_record_loss (ทางเข้าที่ Pilot Web ใช้ใส่และแก้ยอด) ไม่แก้ private.can_edit_ncr_losses
-- ทางเข้าอื่นที่ใช้ฟังก์ชันนั้น (void / review / save_outcome / API รุ่นเก่า app_ncr_add_loss, app_ncr_add_losses) จึงยังปฏิเสธผู้ตอบ
-- ไม่แก้ตารางและข้อมูล สิทธิ์ execute คงเดิม (create or replace) และย้ำไว้ท้ายไฟล์
-- นิยามต้นทาง: public.app_ncr_record_loss จาก 20261015060000_ncr_loss_retroactive_and_assistant_factory_manager.sql
--   บวกบรรทัด perform private.lab_only_block(); ที่ 20261019005000_lab_only_accounts.sql เติมให้ทุก RPC (ฐานข้อมูลจริงก่อน migration นี้:
--   md5(prosrc) = e9078a63055ccc15e599edb9c182379b ตรวจ 2026-11-10) ต่างจากนั้นเฉพาะ v_full และสามบรรทัดตรวจสิทธิ์ที่มีคอมเมนต์กำกับ
-- ลำดับ deploy: ขึ้น migration นี้ก่อนเผยแพร่ Pilot Web รุ่นที่แสดงฟอร์มยอดประมาณการให้ผู้ตอบ
--   (Pilot Web รุ่นเก่าไม่แสดงฟอร์มให้ผู้ตอบ จึงทำงานกับฐานข้อมูลรุ่นนี้ได้)
-- Rollback: create or replace กลับเป็นนิยามใน 20261015060000 (รายการประมาณการที่ผู้ตอบใส่ไว้แล้วยังอยู่ ผู้กรอกต้นทุนยืนยันหรือยกเลิกได้ตามปกติ)

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
  v_full boolean;
begin
  perform private.lab_only_block();
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if v_employee.is_test is distinct from v_ncr.is_test then raise exception 'SANDBOX_SCOPE_MISMATCH'; end if;
  -- ผู้กรอกต้นทุน (can_edit_ncr_losses) ทำได้ทุกอย่างเหมือนเดิม · ผู้ตอบ NCR ใบนั้น (ncr_can_respond) ใส่/แก้ได้เฉพาะยอดประมาณการ
  v_full := private.can_edit_ncr_losses(v_ncr.id, v_employee);
  if not v_full and not private.ncr_can_respond(v_ncr.id, v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status = 'cancelled' then raise exception 'NCR_LOCKED'; end if;
  if v_type is null or v_type not in ('scrap','material','repair','rework','sort','reproduce','logistics','claim','downtime','other')
    or v_kind is null or v_kind not in ('loss','recovery') then raise exception 'INVALID_LOSS_TYPE'; end if;
  if v_status is null or v_status not in ('estimated','confirmed') then raise exception 'INVALID_LOSS_STATUS'; end if;
  if not v_full and v_status <> 'estimated' then raise exception 'LOSS_ESTIMATE_ONLY'; end if;
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
    -- ผู้ตอบแก้ได้เฉพาะรายการที่ยังเป็นประมาณการ (ยอดที่ยืนยันแล้วหรือรายการเดิมเป็นของผู้กรอกต้นทุน)
    if not v_full and v_loss.cost_status <> 'estimated' then raise exception 'LOSS_ESTIMATE_ONLY'; end if;
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

revoke all on function public.app_ncr_record_loss(uuid, jsonb, uuid) from public, anon;
grant execute on function public.app_ncr_record_loss(uuid, jsonb, uuid) to authenticated;
