-- ============================================================================
-- เอากล่อง "ความคิดเห็น" ทั่วไปออกจากหน้าคำร้อง (สับสนและให้คนที่ไม่เกี่ยวข้องมาคอมเมนต์ได้)
-- เพราะตอนขอข้อมูลเพิ่มมีช่องข้อความของตัวเองอยู่แล้ว (ปุ่ม "ส่งข้อมูลกลับให้พิจารณาอีกครั้ง")
--
-- ผลคือฟังก์ชันสองตัวใน 20260921000000_request_resubmit_more_info.sql ที่เคย insert
-- ข้อความไปที่ public.request_comments (เพื่อไม่ให้เหตุผล/คำตอบหายไปตอน resubmit) ต้องเขียนใหม่
-- ให้เก็บข้อความไว้ที่ approval_steps.comment แทน (ช่องเดียวกับที่ "ลำดับอนุมัติ" ในหน้าคำร้อง
-- แสดงอยู่แล้วไม่ว่า step จะสถานะอะไร) แทนที่จะพึ่งกระทู้ความคิดเห็นที่ถูกเอาออกไปแล้ว
-- ============================================================================

-- 1. ตัดการ insert ไปที่ request_comments ออก (ส่วนอื่นเหมือน 20260921000000 ทุกประการ)
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
          and (v_next.approver_department_id is null or e.department_id = v_next.approver_department_id)
          and private.can_approve_module(e.id, v_request.request_type_id);
      end if;
    end if;
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

-- 2. ตอบกลับด้วยข้อมูลเพิ่มเติม — เก็บคำตอบไว้ที่ approval_steps.comment ของ step เดิม (ต่อท้าย
--    เหตุผลเดิมที่ผู้อนุมัติขอไว้ ถ้ามี) แทนการ insert ไปที่ request_comments ที่ไม่มีหน้าไหน
--    แสดงผลแล้ว ส่วนอื่นเหมือน 20260921000000 ทุกประการ
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
    where e.role_id = v_step.approver_role_id
      and e.is_active
      and (v_step.approver_department_id is null or e.department_id = v_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;
