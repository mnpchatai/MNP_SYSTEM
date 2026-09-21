-- ============================================================================
-- สถานะ "ขอข้อมูลเพิ่ม" (more_info) เดิมไม่มีทางออก — ไม่มี RPC ใดพาคำร้องกลับเข้าสู่การอนุมัติ
-- ได้เลยหลังผู้อนุมัติกดขอข้อมูลเพิ่ม และหน้าจอก็ไม่ได้ระบุว่า "รอข้อมูลจากใคร"
--
-- คำตอบของ "รอข้อมูลจากใคร" คือผู้ยื่นคำร้อง (requester_id) เสมอ เพราะเป็นเจ้าของคำร้อง
-- จึงล็อกสิทธิ์ "ตอบกลับ" ไว้เฉพาะคนนั้นคนเดียวผ่าน RPC ใหม่ด้านล่าง คนอื่นที่มีสิทธิ์ดูคำร้องนี้
-- (เช่น แอดมิน) จะยังเห็นข้อมูลได้ตามเดิม แต่ตอบแทนผู้ยื่นคำร้องไม่ได้
-- ============================================================================

-- 1. เมื่อผู้อนุมัติกด "ขอข้อมูลเพิ่ม" พร้อมความเห็น ให้บันทึกความเห็นนั้นลงกระทู้ความคิดเห็นด้วย
--    (เดิมความเห็นอยู่แค่ใน approval_steps.comment ซึ่งจะถูกล้างทิ้งเมื่อคำร้องถูกส่งกลับไปพิจารณา
--    ใหม่ ทำให้เหตุผลที่ขอข้อมูลเพิ่มหายไปจากประวัติ) ตรรกะส่วนอื่นเหมือนไฟล์
--    20260918060000_approval_module_permissions.sql ทุกประการ
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

  if p_decision = 'more_info' and v_comment is not null then
    insert into public.request_comments (request_id, author_id, body)
    values (v_request.id, v_employee.id, 'ขอข้อมูลเพิ่มเติม (' || v_step.step_name || '): ' || v_comment);
  end if;

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

-- 2. ให้ "ผู้ยื่นคำร้อง" (เจ้าของคำร้องเท่านั้น) ส่งข้อมูลเพิ่มเติมกลับ แล้วพาคำร้องเข้าสู่การอนุมัติ
--    ที่ขั้นเดิม (step_order เดิม) อีกครั้ง — ต้องเป็นสถานะ more_info และต้องเป็น requester_id ของ
--    คำร้องนั้นเท่านั้น คนอื่น (รวมถึงแอดมิน) ตอบแทนไม่ได้
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
  if v_comment is not null then
    insert into public.request_comments (request_id, author_id, body)
    values (v_request.id, v_employee.id, 'ส่งข้อมูลเพิ่มเติม: ' || v_comment);
  end if;

  update public.approval_steps
  set status = 'pending', acted_by = null, acted_at = null, comment = null
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
