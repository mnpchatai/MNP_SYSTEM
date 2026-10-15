-- NCR: รวม "ผลดำเนินการจริง" เข้ากับส่วนความสูญเสีย — เหลือเฉพาะการยืนยันว่าประเมินค่าเสียหายครบแล้ว
--
-- เดิมหน้า NCR มีฟอร์ม "ผลดำเนินการจริง" (จำนวนคัดแยก/ซ่อม/ทิ้ง/ส่งคืน/ยอมรับ ชั่วโมงเครื่องหยุด และหลักฐาน) แยกจาก
-- ส่วนความสูญเสีย ทำให้ผู้ใช้ต้องกรอกจำนวนทิ้งและชั่วโมงเครื่องหยุดซ้ำสองที่ และติ๊ก "ประเมินค่าเสียหายครบแล้ว" ได้เฉพาะ
-- เมื่อยืนยันผลดำเนินการพร้อมหลักฐานแล้วเท่านั้น หน้าจอรุ่นใหม่เลิกใช้ฟอร์มนั้น ยอดทิ้งนับจากรายการความสูญเสียประเภท
-- ของเสีย/ทิ้ง และการยืนยันประเมินครบย้ายมาอยู่ท้ายส่วนความสูญเสีย
--
-- 1) ncr_outcomes: ยกเลิก check "cost_reviewed ต้องคู่กับ result_status = 'confirmed'" เพื่อให้ยืนยันประเมินครบได้โดยไม่ต้อง
--    มีผลดำเนินการ ตาราง คอลัมน์ และข้อมูลเดิมไม่เปลี่ยน (จำนวนที่เคยบันทึกยังอ่านได้) check อื่นคงเดิม
-- 2) app_ncr_review_costs(p_ncr_id, p_reviewed, p_note): ติ๊ก/ยกเลิก "ประเมินค่าเสียหายครบแล้ว" พร้อมหมายเหตุ
--    ตรวจผู้ใช้ โหมดทดสอบ สิทธิ์ (private.can_edit_ncr_losses เดียวกับการลงยอด) และล็อกใบที่ยกเลิกเหมือน app_ncr_save_outcome
--    กฎประเมินครบเหมือนเดิม: ต้องไม่มีรายการประมาณการ/รายการเดิมค้าง และถ้าไม่มีค่าเสียหายเลยต้องระบุเหตุผล
--    ใบที่ยังไม่มีแถว ncr_outcomes จะสร้างแถวสถานะ 'draft' จำนวนเป็น 0 ใบที่มีแถวเดิมแก้เฉพาะ cost_reviewed / note /
--    ผู้แก้ล่าสุด จำนวนและหลักฐานเดิมไม่ถูกเขียนทับ บันทึกประวัติ 'cost_review' และ audit ผ่าน trigger เดิมของตาราง
--    trigger ncr_losses_invalidate_review ยังยกเลิกเครื่องหมายเมื่อมีการเพิ่ม/แก้/ยกเลิกรายการความสูญเสียเหมือนเดิม
--
-- app_ncr_save_outcome ไม่เปลี่ยน ยังใช้ได้กับ assets รุ่นเดิมที่เปิดค้างอยู่ (และยังบังคับ confirmed + หลักฐานในตัวฟังก์ชันเอง)
-- ลำดับ deploy: ต้องขึ้น migration นี้ก่อนเผยแพร่ assets รุ่นที่เรียก app_ncr_review_costs
-- Rollback: drop function public.app_ncr_review_costs(uuid,boolean,text); แล้วเพิ่ม check เดิมกลับหลังแก้แถวที่ขัดกฎ
--   (update public.ncr_outcomes set cost_reviewed = false where cost_reviewed and result_status <> 'confirmed';
--    alter table public.ncr_outcomes add check (not cost_reviewed or result_status = 'confirmed');)

do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.ncr_outcomes'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) = 'CHECK (((NOT cost_reviewed) OR (result_status = ''confirmed''::text)))';
  if v_name is null then
    raise exception 'ncr_outcomes cost_reviewed check not found';
  end if;
  execute format('alter table public.ncr_outcomes drop constraint %I', v_name);
end;
$$;

create or replace function public.app_ncr_review_costs(p_ncr_id uuid, p_reviewed boolean, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  v_employee := private.ncr_current_employee();
  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then raise exception 'NCR_NOT_FOUND'; end if;
  if v_employee.is_test is distinct from v_ncr.is_test then raise exception 'SANDBOX_SCOPE_MISMATCH'; end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then raise exception 'NOT_AUTHORIZED'; end if;
  if v_ncr.status = 'cancelled' then raise exception 'NCR_LOCKED'; end if;
  if p_reviewed is null or char_length(coalesce(v_note, '')) > 1000 then raise exception 'INVALID_NOTE'; end if;
  if p_reviewed and exists (
    select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null and cost_status is distinct from 'confirmed'
  ) then raise exception 'COST_REVIEW_PENDING'; end if;
  if p_reviewed and v_note is null and not exists (
    select 1 from public.ncr_losses where ncr_id = v_ncr.id and voided_at is null
  ) then raise exception 'ZERO_COST_REASON_REQUIRED'; end if;

  insert into public.ncr_outcomes (ncr_id, result_date, result_status, cost_reviewed, note, updated_by)
  values (v_ncr.id, private.bangkok_today(), 'draft', p_reviewed, v_note, v_employee.id)
  on conflict (ncr_id) do update set cost_reviewed = excluded.cost_reviewed, note = excluded.note,
    updated_by = excluded.updated_by, updated_at = now();

  perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'cost_review',
    case when p_reviewed then 'ประเมินครบแล้ว' else 'ยังประเมินไม่ครบ' end || coalesce(' · ' || v_note, ''), v_employee.id);
  return v_ncr.id;
end;
$$;

revoke all on function public.app_ncr_review_costs(uuid, boolean, text) from public, anon;
grant execute on function public.app_ncr_review_costs(uuid, boolean, text) to authenticated;
