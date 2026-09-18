-- ระยะ 2 ของการยกระบบแจ้งซ่อม MT เข้า MNP System: RPC ของ workflow แจ้งซ่อม
--
-- ใบแจ้งซ่อม (request_types.uses_repair_workflow) เดินผ่าน approval engine เดิมทุกประการ
-- (หัวหน้าแผนกผู้แจ้ง แล้วต่อด้วยผู้อนุมัติของหน่วยงานเจ้าของประเภทเอกสาร) เมื่ออนุมัติครบ
-- ขั้นสุดท้ายจะไปที่ pending_assign แทน approved แล้วเดินต่อ:
--   pending_assign --[มอบหมายช่าง]--> assigned --[เริ่มงาน]--> in_progress
--   --[จบงาน]--> pending_verify --[ผู้แจ้งตรวจรับผ่าน]--> completed
--                                --[ผู้แจ้งตรวจรับไม่ผ่าน]--> assigned (ซ่อมเพิ่มเติม)
--
-- history/notification ทั่วไปยังมาจาก trigger requests_status_history เดิม (ยิงทุกครั้งที่
-- requests.status เปลี่ยน) ฟังก์ชันในไฟล์นี้เพิ่มแค่การแจ้งเตือนเจาะจงถึงช่างที่เกี่ยวข้อง

-- 1. อนุมัติขั้นสุดท้ายของใบแจ้งซ่อมต้องไป pending_assign ไม่ใช่ approved
create or replace function public.app_approval_decision(p_step_id uuid, p_decision text, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_next public.approval_steps%rowtype;
  v_is_admin boolean;
  v_uses_repair boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info') then
    raise exception 'INVALID_DECISION';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  select * into v_step
  from public.approval_steps
  where id = p_step_id
  for update;
  if v_step.id is null or v_step.status <> 'pending' then
    raise exception 'STEP_NOT_PENDING';
  end if;

  select * into v_request
  from public.requests
  where id = v_step.request_id
  for update;
  if v_request.status <> 'pending_approval' or v_request.current_step <> v_step.step_order then
    raise exception 'STEP_NOT_CURRENT';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not (
    (v_step.approver_employee_id = v_employee.id)
    or (
      v_step.approver_role_id = v_employee.role_id
      and (v_step.approver_department_id is null or v_step.approver_department_id = v_employee.department_id)
      and private.has_permission('approvals.act')
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = nullif(left(trim(coalesce(p_comment, '')), 1000), '')
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info') then
    update public.requests
    set status = case when p_decision = 'rejected'
                      then 'rejected'::public.request_status
                      else 'more_info'::public.request_status end,
        last_changed_by = v_employee.id
    where id = v_request.id;
  else
    select * into v_next
    from public.approval_steps
    where request_id = v_request.id
      and status = 'pending'
      and step_order > v_step.step_order
    order by step_order
    limit 1;

    if v_next.id is null then
      select uses_repair_workflow into v_uses_repair
      from public.request_types
      where id = v_request.request_type_id;

      update public.requests
      set status = case when coalesce(v_uses_repair, false)
                        then 'pending_assign'::public.request_status
                        else 'approved'::public.request_status end,
          current_step = 0, approved_at = now(),
          last_changed_by = v_employee.id
      where id = v_request.id;
    else
      update public.requests
      set current_step = v_next.step_order, last_changed_by = v_employee.id
      where id = v_request.id;

      if v_next.approver_employee_id is not null then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        values (
          v_next.approver_employee_id, v_request.id, 'มีคำร้องรออนุมัติ',
          v_request.request_no || ' · ' || v_next.step_name,
          '/requests/' || v_request.id::text
        );
      else
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
               v_request.request_no || ' · ' || v_next.step_name,
               '/requests/' || v_request.id::text
        from public.employees e
        where e.role_id = v_next.approver_role_id
          and e.is_active
          and (v_next.approver_department_id is null or e.department_id = v_next.approver_department_id);
      end if;
    end if;
  end if;

  return v_request.id;
end;
$$;

-- 2. สร้างใบแจ้งซ่อม — รับแผนก/เครื่องจักร/ประเภทเอกสาร/ธงด่วน/ชื่อผู้แจ้ง แล้วเข้า approval
--    chain แบบเดียวกับ app_create_request (คัดลอกโครงมาเพราะ input/field ต่างจากคำร้องทั่วไป)
create or replace function public.app_create_repair_request(
  p_department_id uuid,
  p_machine_id uuid,
  p_doc_type text,
  p_description text,
  p_is_urgent boolean default false,
  p_needed_date date default null,
  p_requester_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_type public.request_types%rowtype;
  v_department public.departments%rowtype;
  v_machine public.machines%rowtype;
  v_request public.requests%rowtype;
  v_requester_name text;
  v_title text;
  v_step integer := 0;
  v_final_role uuid;
  v_final_department uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null or not private.has_permission('requests.create') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_doc_type not in ('request', 'repair') then
    raise exception 'INVALID_DOC_TYPE';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 3 and 5000 then
    raise exception 'INVALID_DESCRIPTION';
  end if;

  select * into v_department
  from public.departments
  where id = p_department_id and is_active and is_repair_site
  limit 1;
  if v_department.id is null then
    raise exception 'DEPARTMENT_NOT_REPAIR_SITE';
  end if;

  select * into v_machine
  from public.machines
  where id = p_machine_id and department_id = v_department.id and is_active
  limit 1;
  if v_machine.id is null then
    raise exception 'MACHINE_NOT_FOUND';
  end if;

  select * into v_type
  from public.request_types
  where code = 'MT_REPAIR' and is_active
  limit 1;
  if v_type.id is null then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  v_requester_name := nullif(trim(coalesce(p_requester_name, '')), '');
  if v_requester_name is null then
    v_requester_name := trim(v_employee.first_name || ' ' || v_employee.last_name);
  end if;
  v_title := left(trim(v_machine.name || ' — ' || trim(p_description)), 200);

  insert into public.requests (
    request_type_id, requester_id, department_id, title, description,
    details, priority, status, current_step, last_changed_by,
    doc_type, machine_id, machine_code, machine_name, needed_date,
    is_urgent, requester_name
  ) values (
    v_type.id, v_employee.id, v_department.id, v_title, trim(p_description),
    '{}'::jsonb,
    case when coalesce(p_is_urgent, false) then 'urgent' else 'normal' end::public.request_priority,
    'pending_approval', 1, v_employee.id,
    p_doc_type, v_machine.id, v_machine.code, v_machine.name, p_needed_date,
    coalesce(p_is_urgent, false), v_requester_name
  ) returning * into v_request;

  -- โครงขั้นอนุมัติเดียวกับ app_create_request: หัวหน้าแผนกผู้แจ้ง (ถ้ามีและยัง active)
  -- แล้วต่อด้วยผู้อนุมัติของหน่วยงานเจ้าของประเภทเอกสาร (แผนกซ่อมบำรุง)
  if v_type.requires_manager_approval and exists (
    select 1 from public.employees m
    where m.id = v_employee.manager_id and m.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_employee_id
    ) values (v_request.id, v_step, 'หัวหน้าแผนก', v_employee.manager_id);

    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_employee.manager_id, v_request.id, 'มีคำร้องรออนุมัติ',
      v_request.request_no || ' · ' || v_request.title,
      '/requests/' || v_request.id::text
    );
  end if;

  if v_type.final_approver_role_id is not null then
    select t.approver_role_id, t.approver_department_id
      into v_final_role, v_final_department
    from private.resolve_approval_target(
      v_type.final_approver_role_id, v_type.owning_department_id
    ) t;

    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_role_id, approver_department_id
    ) values (
      v_request.id, v_step, 'ผู้อนุมัติหน่วยงานรับผิดชอบ',
      v_final_role, v_final_department
    );

    if v_step = 1 then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.role_id = v_final_role
        and e.is_active
        and (v_final_department is null or e.department_id = v_final_department);
    end if;
  end if;

  -- ไม่มีขั้นอนุมัติเลย (ผู้แจ้งไม่มีหัวหน้า active และ type ไม่ตั้ง final approver) —
  -- ใบแจ้งซ่อมข้ามไป pending_assign ตรงๆ ต่างจาก app_create_request ที่ข้ามไป approved
  if v_step = 0 then
    update public.requests
    set status = 'pending_assign', current_step = 0
    where id = v_request.id;
  end if;

  insert into public.request_status_history (
    request_id, from_status, to_status, changed_by, note
  ) values (
    v_request.id, null, 'pending_approval', v_employee.id, 'สร้างใบแจ้งซ่อมผ่าน Pilot Web'
  );

  return v_request.id;
end;
$$;

revoke all on function public.app_create_repair_request(uuid, uuid, text, text, boolean, date, text) from public, anon;
grant execute on function public.app_create_repair_request(uuid, uuid, text, text, boolean, date, text) to authenticated;

-- 3. มอบหมายช่าง — ผู้อนุมัติหรือผู้ปฏิบัติงานของหน่วยงานเจ้าของประเภทเอกสาร (แผนกซ่อมบำรุง)
--    เท่านั้นที่มอบหมายได้ ยกเว้น admin
create or replace function public.app_assign_repair_technician(
  p_request_id uuid,
  p_technician_id uuid,
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
    and (private.has_permission('requests.operate') or private.has_permission('approvals.act'))
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

revoke all on function public.app_assign_repair_technician(uuid, uuid, date) from public, anon;
grant execute on function public.app_assign_repair_technician(uuid, uuid, date) to authenticated;

-- 4. ช่างเริ่มงาน — ต้องเป็นช่างที่ถูกมอบหมายใบนี้เท่านั้น (หรือ admin)
create or replace function public.app_start_repair_work(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
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
  if v_request.status <> 'assigned' then
    raise exception 'REQUEST_NOT_ASSIGNED';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if v_request.assignee_id is null or (v_request.assignee_id <> v_employee.id and not v_is_admin) then
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

-- 5. ช่างจบงาน — บันทึกการดำเนินงาน/สาเหตุ/ความเห็นผู้ตรวจสอบ/อะไหล่ที่ใช้ แล้วส่งต่อผู้แจ้งตรวจรับ
create or replace function public.app_finish_repair_work(
  p_request_id uuid,
  p_execution_plan text,
  p_cause_analysis text,
  p_inspector_opinion text,
  p_parts_used text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
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

  if p_execution_plan not in ('immediate', 'need_purchase', 'use_existing') then
    raise exception 'INVALID_EXECUTION_PLAN';
  end if;
  if p_inspector_opinion not in ('send_repair', 'external', 'self_repair', 'buy_parts') then
    raise exception 'INVALID_INSPECTOR_OPINION';
  end if;
  if char_length(trim(coalesce(p_cause_analysis, ''))) not between 3 and 5000 then
    raise exception 'INVALID_CAUSE_ANALYSIS';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'in_progress' then
    raise exception 'REQUEST_NOT_IN_PROGRESS';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if v_request.assignee_id is null or (v_request.assignee_id <> v_employee.id and not v_is_admin) then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

  update public.requests
  set status = 'pending_verify',
      execution_plan = p_execution_plan,
      cause_analysis = trim(p_cause_analysis),
      inspector_opinion = p_inspector_opinion,
      parts_used = nullif(trim(coalesce(p_parts_used, '')), ''),
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_finish_repair_work(uuid, text, text, text, text) from public, anon;
grant execute on function public.app_finish_repair_work(uuid, text, text, text, text) to authenticated;

-- 6. ผู้แจ้งตรวจรับผ่าน/ไม่ผ่าน — ผ่าน = completed, ไม่ผ่าน = กลับไป assigned ให้ช่างซ่อมเพิ่มเติม
create or replace function public.app_verify_repair(
  p_request_id uuid,
  p_result text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
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

  if p_result not in ('pass', 'fail') then
    raise exception 'INVALID_RESULT';
  end if;
  if p_result = 'fail' and char_length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'NOTE_REQUIRED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'pending_verify' then
    raise exception 'REQUEST_NOT_PENDING_VERIFY';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if v_request.requester_id <> v_employee.id and not v_is_admin then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.request_verifications (request_id, result, note, verified_by)
  values (v_request.id, p_result, nullif(trim(coalesce(p_note, '')), ''), v_employee.id);

  update public.requests
  set status = case when p_result = 'pass' then 'completed' else 'assigned' end::public.request_status,
      completed_at = case when p_result = 'pass' then now() else completed_at end,
      last_changed_by = v_employee.id
  where id = v_request.id;

  if p_result = 'fail' and v_request.assignee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_request.assignee_id, v_request.id, 'ตรวจรับไม่ผ่าน ต้องซ่อมเพิ่มเติม',
      v_request.request_no || coalesce(' · ' || nullif(trim(p_note), ''), ''),
      '/requests/' || v_request.id::text
    );
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_verify_repair(uuid, text, text) from public, anon;
grant execute on function public.app_verify_repair(uuid, text, text) to authenticated;
