-- ============================================================================
-- มอบหมายช่างซ่อม: จำกัดสิทธิ์ให้เฉพาะ "ผู้จัดการแผนก" (department_manager) ของแผนกที่เป็น
-- เจ้าของประเภทเอกสารเท่านั้น — เดิมอนุญาตทั้ง department_manager และ assistant_factory_manager
-- (หรือใครก็ตามในแผนกที่มี requests.operate/approvals.act) กว้างเกินไป
--
-- เพิ่ม p_work_started_date (วันเริ่มงาน) ให้กรอกพร้อมกำหนดเสร็จตอนมอบหมายได้เลย โดยใช้คอลัมน์
-- work_started_date เดิม (มีอยู่แล้วในตาราง requests) — app_start_repair_work เดิมเขียนแบบ
-- `coalesce(work_started_date, current_date)` อยู่แล้ว จึงไม่ทับวันที่ที่ผู้จัดการกรอกไว้ล่วงหน้า
-- ตอนช่างกดเริ่มงานจริง ไม่ต้องเพิ่มคอลัมน์ใหม่
-- ============================================================================
create or replace function public.app_assign_repair_technician(
  p_request_id uuid,
  p_technician_id uuid,
  p_work_started_date date default null,
  p_work_expected_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
  v_technician public.employees%rowtype;
  v_is_admin boolean;
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

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'pending_assign' then
    raise exception 'REQUEST_NOT_PENDING_ASSIGN';
  end if;

  select * into v_type
  from public.request_types
  where id = v_request.request_type_id;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not (
    v_employee.department_id = v_type.owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code = 'department_manager'
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_technician
  from public.employees
  where id = p_technician_id and is_active and department_id = v_type.owning_department_id
  limit 1;
  if v_technician.id is null then
    raise exception 'TECHNICIAN_NOT_FOUND';
  end if;

  update public.requests
  set status = 'assigned',
      assignee_id = v_technician.id,
      assigned_by = v_employee.id,
      assigned_at = now(),
      work_started_date = p_work_started_date,
      work_expected_date = p_work_expected_date,
      last_changed_by = v_employee.id
  where id = v_request.id;

  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  values (
    v_technician.id, v_request.id, 'ได้รับมอบหมายงานซ่อม',
    v_request.request_no || ' · ' || coalesce(v_request.machine_name, ''),
    '/requests/' || v_request.id::text
  );

  return v_request.id;
end;
$$;

revoke all on function public.app_assign_repair_technician(uuid, uuid, date, date) from public, anon;
grant execute on function public.app_assign_repair_technician(uuid, uuid, date, date) to authenticated;

-- ฟังก์ชันเดิมมีแค่ลายเซ็น (uuid, uuid, date) — ลบเมื่อไม่มีใครอ้างอิงแล้ว
drop function if exists public.app_assign_repair_technician(uuid, uuid, date);
