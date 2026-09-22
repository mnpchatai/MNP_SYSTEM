-- ============================================================================
-- หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกว่ารับของทันที หรือระบุวันที่คาดว่าของจะมาส่ง
--
-- เดิมกดหมุดไหนก็บันทึกวันนี้เฉยๆ ไม่มีที่เก็บ "วันที่คาดว่าจะมาส่ง" ของหมุด "ของมาส่งเรียบร้อย"
-- (คู่กันเสมอ สร้างพร้อมกันใน app_assign_repair_technician) ทำให้ไม่มีข้อมูลให้ pg_cron ใช้เตือน
-- ทุกวัน 16:00 น. ว่าของมาส่งหรือยัง (ดูไมเกรชันถัดไป) ไฟล์นี้เพิ่มที่เก็บข้อมูลนั้นก่อน:
--
--   1) เพิ่ม expected_on / reminder_last_sent_on ลงตาราง request_progress_steps
--   2) กดหมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องส่ง p_received_now = true (รับของทันที ปิดหมุด
--      "ของมาส่งเรียบร้อย" ให้พร้อมกันเลย) หรือ p_expected_on (ตั้งวันคาดว่าจะมาส่งไว้ที่หมุดนั้นแทน)
--   3) RPC ใหม่ app_reschedule_progress_step ให้เลื่อนวันที่คาดว่าจะมาส่งได้ตอนของยังไม่ถึงตามนัด
-- ============================================================================

alter table public.request_progress_steps
  add column if not exists expected_on date,
  add column if not exists reminder_last_sent_on date;

comment on column public.request_progress_steps.expected_on is
  'วันที่คาดว่าหมุดนี้จะเสร็จ (ปัจจุบันใช้กับหมุด "ของมาส่งเรียบร้อย" เท่านั้น) — ตั้งตอนกดหมุด "สั่งซื้ออุปกรณ์เรียบร้อย" แล้วเลือกว่ายังไม่ได้รับของทันที หรือเลื่อนวันที่ผ่าน app_reschedule_progress_step';
comment on column public.request_progress_steps.reminder_last_sent_on is
  'วันที่ (เวลาไทย) ที่ส่งอีเมลเตือนถามว่าของมาส่งหรือยังล่าสุด กันส่งซ้ำวันเดียวกันตอน pg_cron รันทุกวัน 16:00 น.';

-- ---------------------------------------------------------------------------
-- 1. บันทึกหมุด — เพิ่มพารามิเตอร์ทางเลือกสำหรับหมุด "สั่งซื้ออุปกรณ์เรียบร้อย" เท่านั้น
--    หมุดอื่นเรียกแบบเดิมได้ปกติ (ไม่ส่ง p_received_now/p_expected_on มา = ไม่มีผลอะไรเพิ่ม)
-- ---------------------------------------------------------------------------
create or replace function public.app_record_progress_step(
  p_step_id uuid,
  p_done_on date default null,
  p_received_now boolean default null,
  p_expected_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.request_progress_steps%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
  v_allowed boolean;
  v_done_on date;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_step
  from public.request_progress_steps
  where id = p_step_id
  for update;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;

  select * into v_request from public.requests where id = v_step.request_id;
  select * into v_type from public.request_types where id = v_request.request_type_id;

  v_allowed := private.is_request_technician(v_request.id, v_employee.id)
    or exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('admin', 'department_manager')
        and (r.code = 'admin' or v_employee.department_id = v_type.owning_department_id)
    );
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกอย่างใดอย่างหนึ่งเสมอ: รับของทันที หรือระบุวันที่คาดว่าจะมาส่ง
  if v_step.step_key = 'purchase_ordered' and not coalesce(p_received_now, false) and p_expected_on is null then
    raise exception 'EXPECTED_DATE_REQUIRED';
  end if;

  v_done_on := coalesce(p_done_on, current_date);

  update public.request_progress_steps
  set done_on = v_done_on,
      recorded_by = v_employee.id,
      recorded_at = now()
  where id = v_step.id;

  if v_step.step_key = 'purchase_ordered' then
    if coalesce(p_received_now, false) then
      -- รับของพร้อมสั่งซื้อ — ปิดหมุด "ของมาส่งเรียบร้อย" ให้พร้อมกันเลย ไม่ต้องรอกดซ้ำอีกที
      update public.request_progress_steps
      set done_on = v_done_on,
          recorded_by = v_employee.id,
          recorded_at = now(),
          expected_on = null,
          reminder_last_sent_on = null
      where request_id = v_step.request_id and step_key = 'purchase_received' and done_on is null;
    else
      -- ยังไม่ได้ของ — ตั้งวันที่คาดว่าจะมาส่งไว้ที่หมุด "ของมาส่งเรียบร้อย" ให้ pg_cron ใช้เตือนภายหลัง
      update public.request_progress_steps
      set expected_on = p_expected_on,
          reminder_last_sent_on = null
      where request_id = v_step.request_id and step_key = 'purchase_received' and done_on is null;
    end if;
  end if;

  -- แจ้งผู้แจ้ง + ผจก.ซ่อมบำรุง ว่างานขยับ (สเปก: หมุดคือการรายงานความคืบหน้าให้คนรอทราบ)
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'อัปเดตความคืบหน้างานซ่อม'),
         v_request.request_no || ' · ' || v_step.step_label,
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_step.id;
end;
$$;

revoke all on function public.app_record_progress_step(uuid, date, boolean, date) from public, anon;
grant execute on function public.app_record_progress_step(uuid, date, boolean, date) to authenticated;

-- ลายเซ็นเดิม (ไม่มีพารามิเตอร์รับของทันที/วันที่คาดว่าจะมาส่ง) ไม่มีผู้เรียกแล้ว — app.js ปรับตามในคอมมิตเดียวกัน
drop function if exists public.app_record_progress_step(uuid, date);

-- ---------------------------------------------------------------------------
-- 2. เลื่อนวันที่คาดว่าจะมาส่ง — ใช้ตอนถึงวันนัดแล้วของยังไม่มา (สิทธิ์ชุดเดียวกับบันทึกหมุด)
-- ---------------------------------------------------------------------------
create or replace function public.app_reschedule_progress_step(
  p_step_id uuid,
  p_expected_on date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.request_progress_steps%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
  v_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_expected_on is null then
    raise exception 'EXPECTED_DATE_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_step
  from public.request_progress_steps
  where id = p_step_id
  for update;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;
  if v_step.done_on is not null then
    raise exception 'STEP_ALREADY_DONE';
  end if;

  select * into v_request from public.requests where id = v_step.request_id;
  select * into v_type from public.request_types where id = v_request.request_type_id;

  v_allowed := private.is_request_technician(v_request.id, v_employee.id)
    or exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('admin', 'department_manager')
        and (r.code = 'admin' or v_employee.department_id = v_type.owning_department_id)
    );
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.request_progress_steps
  set expected_on = p_expected_on,
      reminder_last_sent_on = null
  where id = v_step.id;

  -- ของยังไม่มาตามนัด แจ้งผู้แจ้ง + ผจก.ซ่อมบำรุงเหมือนตอนบันทึกหมุด กันเข้าใจผิดว่าของถึงแล้ว
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'เลื่อนวันที่คาดว่าของจะมาส่ง'),
         v_request.request_no || ' · ' || v_step.step_label || ' · คาดว่าจะมาส่ง ' || to_char(p_expected_on, 'DD/MM/YYYY'),
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_step.id;
end;
$$;

revoke all on function public.app_reschedule_progress_step(uuid, date) from public, anon;
grant execute on function public.app_reschedule_progress_step(uuid, date) to authenticated;
