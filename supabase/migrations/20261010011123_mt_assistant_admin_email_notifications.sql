-- Add email/in-app recipients for Admin accounts acting as assistant factory
-- managers on MT step 1. Existing approval authorization and module grants stay unchanged.
-- Notifications use the existing email_status='pending' queue and notify-email sender.
-- Event notifications and reminders both use approval_step_recipients; resubmitted
-- information uses the same exception below. No historical notifications are replayed.
-- Rollback: restore approval_step_recipients and app_resubmit_request from
-- 20261009094227_mt_first_approval_assistant_factory_manager.sql, then drop the helper.

create or replace function private.mt_assistant_admin_receives_notifications(
  p_employee_id uuid, p_request_type_id uuid, p_step_order integer
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.roles actual_role on actual_role.id = e.role_id and actual_role.code = 'admin'
    join public.roles working_role on working_role.id = e.acting_role_id
      and working_role.code = 'assistant_factory_manager'
    join public.request_types t on t.id = p_request_type_id and t.code = 'MT_REPAIR'
    where e.id = p_employee_id and e.is_active and p_step_order = 1
  )
$$;
revoke all on function private.mt_assistant_admin_receives_notifications(uuid, uuid, integer)
  from public, anon, authenticated;

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
        and (
          private.can_approve_module(e.id, s.request_type_id)
          or private.mt_assistant_admin_receives_notifications(e.id, s.request_type_id, s.step_order)
        )
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
      and (
        private.can_approve_module(e.id, v_request.request_type_id)
        or private.mt_assistant_admin_receives_notifications(e.id, v_request.request_type_id, v_step.step_order)
      );
  end if;

  return v_request.id;
end;
$$;
revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;
