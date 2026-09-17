-- Guarantee that every pending approval step has at least one eligible approver.
--
-- Problem observed on the pilot: request types point their final step at
-- (final_approver_role_id, owning_department_id). When nobody holds that role
-- inside that department the step is created with zero eligible approvers, so
-- no account ever sees the approve buttons and the request is stuck forever
-- (IA-2026-000001 waited on role=approver + department=IT while the only
-- approver account belongs to MT).
--
-- Resolution order for a role-based step:
--   1. the intended role inside the owning department
--   2. the intended role in any department
--   3. any active role that may both act on approvals and view every request
-- The department scope is only relaxed when it would otherwise strand the step.

create or replace function private.resolve_approval_target(
  p_role_id uuid,
  p_department_id uuid
)
returns table (approver_role_id uuid, approver_department_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_fallback_role uuid;
begin
  if p_role_id is null then
    approver_role_id := null;
    approver_department_id := null;
    return next;
    return;
  end if;

  if exists (
    select 1 from public.employees e
    where e.role_id = p_role_id
      and e.is_active
      and (p_department_id is null or e.department_id = p_department_id)
  ) then
    approver_role_id := p_role_id;
    approver_department_id := p_department_id;
    return next;
    return;
  end if;

  if exists (
    select 1 from public.employees e
    where e.role_id = p_role_id and e.is_active
  ) then
    approver_role_id := p_role_id;
    approver_department_id := null;
    return next;
    return;
  end if;

  select r.id into v_fallback_role
  from public.roles r
  where exists (select 1 from public.employees e where e.role_id = r.id and e.is_active)
    and exists (
      select 1 from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'approvals.act'
    )
    and exists (
      select 1 from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = r.id and p.code = 'requests.view_all'
    )
  order by r.code
  limit 1;

  -- Nothing better exists: keep the configured target so the workflow stays
  -- auditable instead of silently pointing somewhere unexpected.
  approver_role_id := coalesce(v_fallback_role, p_role_id);
  approver_department_id := case when v_fallback_role is null then p_department_id else null end;
  return next;
end;
$$;

revoke all on function private.resolve_approval_target(uuid, uuid) from public;

create or replace function public.app_create_request(
  p_type_id uuid,
  p_title text,
  p_description text,
  p_priority text default 'normal',
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_type public.request_types%rowtype;
  v_request public.requests%rowtype;
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
  if char_length(trim(coalesce(p_title, ''))) not between 3 and 200 then
    raise exception 'INVALID_TITLE';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 3 and 5000 then
    raise exception 'INVALID_DESCRIPTION';
  end if;
  if p_priority not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'INVALID_PRIORITY';
  end if;
  if jsonb_typeof(coalesce(p_details, '{}'::jsonb)) <> 'object' then
    raise exception 'INVALID_DETAILS';
  end if;

  select * into v_type
  from public.request_types
  where id = p_type_id and is_active
  limit 1;
  if v_type.id is null then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  insert into public.requests (
    request_type_id, requester_id, department_id, title, description,
    details, priority, status, current_step, last_changed_by
  ) values (
    v_type.id, v_employee.id, v_employee.department_id, trim(p_title),
    trim(p_description), coalesce(p_details, '{}'::jsonb),
    p_priority::public.request_priority, 'pending_approval', 1, v_employee.id
  ) returning * into v_request;

  -- An inactive manager cannot act, so that step would strand the request.
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

  if v_step = 0 then
    update public.requests
    set status = 'approved', current_step = 0
    where id = v_request.id;
  end if;

  insert into public.request_status_history (
    request_id, from_status, to_status, changed_by, note
  ) values (
    v_request.id, null, 'pending_approval', v_employee.id, 'สร้างและส่งคำร้องผ่าน Pilot Web'
  );

  return v_request.id;
end;
$$;

revoke all on function public.app_create_request(uuid, text, text, text, jsonb) from anon;

-- Repair steps that are already stranded, and tell the resolved approvers.
do $$
declare
  v_row record;
  v_role uuid;
  v_department uuid;
begin
  for v_row in
    select s.id, s.request_id, s.step_order, s.step_name,
           s.approver_role_id, s.approver_department_id,
           r.request_no, r.current_step
    from public.approval_steps s
    join public.requests r on r.id = s.request_id
    where s.status = 'pending'
      and s.approver_employee_id is null
      and s.approver_role_id is not null
      and r.status = 'pending_approval'
      and not exists (
        select 1 from public.employees e
        where e.is_active
          and e.role_id = s.approver_role_id
          and (s.approver_department_id is null or e.department_id = s.approver_department_id)
      )
  loop
    select t.approver_role_id, t.approver_department_id into v_role, v_department
    from private.resolve_approval_target(v_row.approver_role_id, v_row.approver_department_id) t;

    update public.approval_steps
    set approver_role_id = v_role,
        approver_department_id = v_department
    where id = v_row.id;

    if v_row.step_order = v_row.current_step then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_row.request_id, 'มีคำร้องรออนุมัติ',
             v_row.request_no || ' · ' || v_row.step_name,
             '/requests/' || v_row.request_id::text
      from public.employees e
      where e.role_id = v_role
        and e.is_active
        and (v_department is null or e.department_id = v_department);
    end if;
  end loop;
end;
$$;
