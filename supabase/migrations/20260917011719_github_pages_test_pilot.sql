-- GitHub Pages pilot support.
-- Keeps privileged workflow transitions in Postgres while the static client
-- uses the authenticated user's JWT. Every function validates auth.uid() and
-- business permissions before changing data.

-- Demo employees used for the multi-role pilot. Authentication accounts are
-- created separately through the pilot-auth Edge Function after an invite code
-- has been presented. No passwords or invite codes are stored in this migration.
insert into public.employees
  (id, employee_no, first_name, last_name, email, job_title, department_id, role_id, manager_id)
values
  (
    '50000000-0000-0000-0000-000000000002', 'MNP0101', 'สมชาย', 'หัวหน้างาน',
    'mnp0101@pilot.mnp.local', 'หัวหน้าฝ่ายปฏิบัติการ',
    '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000002', null
  ),
  (
    '50000000-0000-0000-0000-000000000003', 'MNP0102', 'สายฝน', 'พนักงาน',
    'mnp0102@pilot.mnp.local', 'เจ้าหน้าที่ฝ่ายปฏิบัติการ',
    '10000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000001',
    '50000000-0000-0000-0000-000000000002'
  ),
  (
    '50000000-0000-0000-0000-000000000004', 'MNP0201', 'อนันต์', 'ช่างซ่อม',
    'mnp0201@pilot.mnp.local', 'ช่างซ่อมบำรุง',
    '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', null
  )
on conflict (employee_no) do update set
  first_name = excluded.first_name,
  last_name = excluded.last_name,
  job_title = excluded.job_title,
  department_id = excluded.department_id,
  role_id = excluded.role_id,
  manager_id = excluded.manager_id,
  is_active = true;

-- Operators must be able to discover approved work before it has an assignee.
-- This extends the existing helper without broadening access to requests in
-- other states. Admin access remains permission-based.
create or replace function private.can_access_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    join public.employees me on me.auth_user_id = (select auth.uid()) and me.is_active
    where r.id = target_request_id
      and (
        r.requester_id = me.id
        or r.assignee_id = me.id
        or exists (
          select 1 from public.approval_steps s
          where s.request_id = r.id
            and (
              s.approver_employee_id = me.id
              or (
                s.approver_role_id = me.role_id
                and (s.approver_department_id is null or s.approver_department_id = me.department_id)
              )
            )
        )
        or private.has_permission('requests.view_all')
        or (
          private.has_permission('requests.operate')
          and r.status in ('approved', 'in_progress')
        )
      )
  )
$$;

revoke all on function private.can_access_request(uuid) from public;
grant execute on function private.can_access_request(uuid) to authenticated;

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

  if v_type.requires_manager_approval and v_employee.manager_id is not null then
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
    v_step := v_step + 1;
    insert into public.approval_steps (
      request_id, step_order, step_name, approver_role_id, approver_department_id
    ) values (
      v_request.id, v_step, 'ผู้อนุมัติหน่วยงานรับผิดชอบ',
      v_type.final_approver_role_id, v_type.owning_department_id
    );

    if v_step = 1 then
      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.role_id = v_type.final_approver_role_id
        and e.is_active
        and (v_type.owning_department_id is null or e.department_id = v_type.owning_department_id);
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

create or replace function public.app_approval_decision(
  p_step_id uuid,
  p_decision text,
  p_comment text default null
)
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
      update public.requests
      set status = 'approved', current_step = 0, approved_at = now(),
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

create or replace function public.app_update_request_status(
  p_request_id uuid,
  p_status text
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
  if p_status not in ('in_progress', 'completed') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not private.has_permission('requests.operate') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.assignee_id is not null and v_request.assignee_id <> v_employee.id and not v_is_admin then
    raise exception 'ASSIGNED_TO_ANOTHER_OPERATOR';
  end if;
  if (p_status = 'in_progress' and v_request.status <> 'approved')
     or (p_status = 'completed' and v_request.status <> 'in_progress') then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.requests
  set status = p_status::public.request_status,
      assignee_id = coalesce(assignee_id, v_employee.id),
      completed_at = case when p_status = 'completed' then now() else null end,
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_create_request(uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
revoke all on function public.app_update_request_status(uuid, text) from public, anon;

grant execute on function public.app_create_request(uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;
grant execute on function public.app_update_request_status(uuid, text) to authenticated;
