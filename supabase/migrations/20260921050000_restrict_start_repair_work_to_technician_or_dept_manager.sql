-- ============================================================================
-- ปุ่ม "เริ่มงานซ่อม": จำกัดสิทธิ์ให้เฉพาะช่างที่ถูกมอบหมาย กับผู้จัดการแผนกที่เป็นเจ้าของ
-- ประเภทเอกสารนั้น (เช่น ผู้จัดการแผนกซ่อมบำรุงของใบแจ้งซ่อม MT) เท่านั้น
--
-- เดิม v_is_admin := private.has_permission('requests.view_all') ครอบคลุมทั้ง admin,
-- factory_manager และ general_manager (ดูคอมเมนต์ใน 20260919000000_unify_position_and_role
-- บรรทัด 65) ทำให้ผู้บริหารระดับสูงที่ไม่ได้เกี่ยวข้องกับงานซ่อมนี้โดยตรงกดเริ่มงานแทนช่างได้
-- ซึ่งเปิดช่องให้คนที่ไม่เกี่ยวข้องเข้ามายุ่งกับงานได้ ตามที่ผู้ใช้แจ้ง
--
-- แก้โดยตัด factory_manager/general_manager ออกจากข้อยกเว้น เหลือเฉพาะ:
--   1) admin (เผื่อกรณีต้องแก้ปัญหาระบบ)
--   2) ช่างที่ถูกมอบหมาย (request.assignee_id = ตัวเอง) — เหมือนเดิม
--   3) ผู้จัดการแผนก (department_manager) ของแผนกที่เป็นเจ้าของประเภทเอกสารนี้ — เพิ่มใหม่
--      ให้ตรงกับสิทธิ์ "มอบหมายช่าง" ที่ app_assign_repair_technician ให้ไว้อยู่แล้ว
-- ============================================================================
create or replace function public.app_start_repair_work(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_owning_department_id uuid;
  v_is_admin boolean;
  v_is_owning_department_manager boolean;
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
  if v_request.status <> 'assigned' then
    raise exception 'REQUEST_NOT_ASSIGNED';
  end if;

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  v_is_owning_department_manager := v_owning_department_id is not null
    and v_employee.department_id = v_owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code = 'department_manager'
    );

  if v_request.assignee_id is null
     or (v_request.assignee_id <> v_employee.id and not v_is_admin and not v_is_owning_department_manager)
  then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

  update public.requests
  set status = 'in_progress',
      work_started_date = coalesce(work_started_date, current_date),
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_start_repair_work(uuid) from public, anon;
grant execute on function public.app_start_repair_work(uuid) to authenticated;
