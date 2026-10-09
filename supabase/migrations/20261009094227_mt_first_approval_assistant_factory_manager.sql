-- MT step 1 can be approved by either factory manager. All other targets stay unchanged.
-- Existing and new requests use this rule; the general manager remains step 2.
-- Definitions below start from their latest definitions on main.
-- Recovery: restore can_access_request from 20261001040000, recipients from
-- 20261005010000, and decision/resubmit from 20261005020000, then drop the helper.
-- Module grants are audited; revoke only grants introduced by this migration if rolling back.
create or replace function private.approval_role_matches(p_step_id uuid, p_role_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.approval_steps s
    join public.requests r on r.id = s.request_id
    join public.request_types t on t.id = r.request_type_id
    join public.roles target on target.id = s.approver_role_id
    join public.roles actor on actor.id = p_role_id
    where s.id = p_step_id
      and (
        s.approver_role_id = p_role_id
        or (t.code = 'MT_REPAIR' and s.step_order = 1
            and s.approver_employee_id is null
            and target.code = 'factory_manager'
            and actor.code = 'assistant_factory_manager')
      )
  )
$$;
revoke all on function private.approval_role_matches(uuid, uuid) from public, anon, authenticated;

-- Enable current active assistant factory managers for MT once. Admin can revoke
-- this per-person grant afterwards; new accounts still follow normal Admin setup.
insert into public.approval_module_permissions (employee_id, request_type_id)
select e.id, t.id
from public.employees e
join public.roles ro on ro.id = e.role_id and ro.code = 'assistant_factory_manager'
cross join public.request_types t
where e.is_active and t.code = 'MT_REPAIR'
on conflict (employee_id, request_type_id) do nothing;

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
                private.approval_role_matches(s.id, me.role_id)
                and (s.approver_department_id is null or s.approver_department_id = me.department_id)
                and private.can_approve_module(me.id, r.request_type_id)
              )
            )
        )
        or private.has_permission('requests.view_all')
        or (
          private.has_permission('requests.operate')
          and r.status in ('approved', 'in_progress')
        )
        or exists (
          select 1
          from public.request_types rt
          join public.roles me_role on me_role.id = me.role_id
          where rt.id = r.request_type_id
            and me_role.code in ('department_manager', 'assistant_department_manager')
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
        -- แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" อ่านได้ตั้งแต่อนุมัติครบแล้ว รวมถึงหลังเดินสถานะต่อเป็น
        -- in_progress / completed
        or (
          r.status in ('approved', 'in_progress', 'completed')
          and me.department_id = any(r.cc_department_ids)
        )
      )
  )
$$;

create or replace function private.approval_step_recipients(p_step_id uuid)
returns table (employee_id uuid, is_fallback boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with step as (
    select s.*, r.request_type_id
    from public.approval_steps s
    join public.requests r on r.id = s.request_id
    where s.id = p_step_id
  ),
  approvers as (
    select e.id
    from step s
    join public.employees e on e.is_active
    where case
      when s.approver_employee_id is not null then e.id = s.approver_employee_id
      else private.approval_role_matches(s.id, coalesce(e.acting_role_id, e.role_id))
        and (s.approver_department_id is null or e.department_id = s.approver_department_id)
        and private.can_approve_module(e.id, s.request_type_id)
    end
  )
  select a.id, false from approvers a
  union all
  -- ขั้นที่ไม่มีผู้ถือบทบาท: ให้ admin รับแทน (admin อนุมัติแทนได้)
  select e.id, true
  from public.employees e
  join public.roles ro on ro.id = e.role_id and ro.code = 'admin'
  where e.is_active
    and exists (select 1 from step)
    and not exists (select 1 from approvers)
$$;
revoke all on function private.approval_step_recipients(uuid) from public, anon, authenticated;

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
  v_comment text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info', 'acknowledged') then
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

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  if not v_is_admin and not (
    (v_step.approver_employee_id is not null and v_step.approver_employee_id = v_employee.id)
    or (
      v_step.approver_role_id is not null
      and private.approval_role_matches(v_step.id, v_employee.role_id)
      and (v_step.approver_department_id is null or v_step.approver_department_id = v_employee.department_id)
      and private.has_permission('approvals.act')
      and private.can_approve_module(v_employee.id, v_request.request_type_id)
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_comment
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info', 'acknowledged') then
    -- ใหม่: ความเห็นของผู้อนุมัติไปอยู่ในแถวประวัติสถานะด้วย ไม่หายเมื่อ comment ของขั้นถูกเขียนทับ
    perform private.set_status_note(v_comment);
    update public.requests
    set status = case p_decision
                   when 'rejected' then 'rejected'::public.request_status
                   when 'acknowledged' then 'acknowledged'::public.request_status
                   else 'more_info'::public.request_status
                 end,
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

      -- ใหม่: ความเห็นตอนอนุมัติขั้นสุดท้ายไปอยู่ในแถวประวัติสถานะด้วย
      perform private.set_status_note(v_comment);
      update public.requests
      set status = case when coalesce(v_uses_repair, false)
                        then 'pending_assign'::public.request_status
                        else 'approved'::public.request_status end,
          current_step = 0, approved_at = now(),
          last_changed_by = v_employee.id
      where id = v_request.id;

      -- อนุมัติผ่านครบทุกขั้นแล้ว (ไม่ใช่สายซ่อมที่ไปต่อ pending_assign) — ส่งสำเนาให้
      -- แผนกที่ถูกติ๊กไว้ตอนสร้างคำร้อง ถ้ามี
      if not coalesce(v_uses_repair, false)
         and coalesce(array_length(v_request.cc_department_ids, 1), 0) > 0 then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select e.id, v_request.id, 'ได้รับสำเนาคำร้อง',
               v_request.request_no || ' · ' || v_request.title,
               '/requests/' || v_request.id::text
        from public.employees e
        where e.is_active
          and e.department_id = any(v_request.cc_department_ids);
      end if;
    else
      update public.requests
      set current_step = v_next.step_order, last_changed_by = v_employee.id
      where id = v_request.id;

      perform private.notify_approval_step(v_next.id, v_request.request_no || ' · ' || v_next.step_name);
    end if;
  end if;

  return v_request.id;
end;
$$;
revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

create or replace function public.app_resubmit_request(p_request_id uuid, p_comment text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_step public.approval_steps%rowtype;
  v_comment text;
  v_step_comment text;
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
  if v_request.status <> 'more_info' then
    raise exception 'REQUEST_NOT_AWAITING_INFO';
  end if;
  if v_request.requester_id <> v_employee.id then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_step
  from public.approval_steps
  where request_id = v_request.id and status = 'more_info'
  order by step_order desc
  limit 1
  for update;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
  v_step_comment := case
    when v_comment is not null and v_step.comment is not null then v_step.comment || ' | ตอบกลับ: ' || v_comment
    when v_comment is not null then 'ตอบกลับ: ' || v_comment
    else v_step.comment
  end;

  update public.approval_steps
  set status = 'pending', acted_by = null, acted_at = null, comment = v_step_comment
  where id = v_step.id;

  -- ใหม่: คำตอบของผู้ยื่นคำร้องไปอยู่ในแถวประวัติสถานะด้วย ไม่หายเมื่อถูกขอข้อมูลเพิ่มรอบถัดไป
  perform private.set_status_note(v_comment);
  update public.requests
  set status = 'pending_approval', current_step = v_step.step_order, last_changed_by = v_employee.id
  where id = v_request.id;

  if v_step.approver_employee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_step.approver_employee_id, v_request.id, 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว',
      v_request.request_no || ' · ' || v_step.step_name,
      '/requests/' || v_request.id::text
    );
  else
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว',
           v_request.request_no || ' · ' || v_step.step_name,
           '/requests/' || v_request.id::text
    from public.employees e
    where private.approval_role_matches(v_step.id, coalesce(e.acting_role_id, e.role_id))
      and e.is_active
      and (v_step.approver_department_id is null or e.department_id = v_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;

  return v_request.id;
end;
$$;
revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;
