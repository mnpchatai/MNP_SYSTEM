-- แจ้งเตือน + เปิดสิทธิ์อ่านให้แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" (requests.cc_department_ids)
-- ก็ต่อเมื่อคำร้องอนุมัติผ่านครบทุกขั้นแล้วเท่านั้น (status = 'approved') — ก่อนหน้านี้คอลัมน์
-- cc_department_ids เก็บ/แสดงผลอย่างเดียว ไม่เคยให้สิทธิ์ดูหรือแจ้งเตือนใครมาก่อนเลย (เพิ่มคอลัมน์
-- ไว้ใน 20260922010000_management_request_pp01_fm08.sql แต่ยังไม่ได้ต่อพฤติกรรมใดๆ)
--
-- ผู้รับ = พนักงานทุกคนที่ active อยู่ในแผนกที่ถูกติ๊ก (ไม่ใช่แค่หัวหน้าแผนก) ตามที่ผู้ใช้ยืนยัน
-- ช่องทาง = แจ้งเตือนในระบบ (ตาราง notifications) + อีเมล — อีเมลอาศัยกลไกเดิมที่มีอยู่แล้วทั้งคู่:
--   * Pilot Web: insert แถว notifications แล้ว client เรียก triggerNotificationEmails(requestId)
--     อยู่แล้วทุกครั้งหลัง app_approval_decision สำเร็จ (ดู app.js) จึงไม่ต้องแก้ app.js เพิ่ม
--   * Next.js: เรียก notifyEmployeeByEmail ตรงในฟังก์ชัน (ดู approvalDecisionAction ใน
--     src/app/actions/requests.ts) ตามแบบเดียวกับตอนแจ้งผู้อนุมัติขั้นถัดไป
--
-- ไม่จำกัดเฉพาะโมดูล MANAGEMENT เพราะ cc_department_ids เป็นคอลัมน์ทั่วไปของ requests —
-- ประเภทเอกสารไหนก็ตามที่ใส่ค่านี้ตอนสร้างคำร้องจะได้พฤติกรรมเดียวกัน

-- 1. สิทธิ์อ่าน: แผนกที่ถูกสำเนาอ่านคำร้องได้ก็ต่อเมื่ออนุมัติผ่านครบแล้ว (สาขาที่ 7 ต่อจาก
--    20260921040000_owning_department_manager_access.sql — ตรรกะสาขาอื่นคัดลอกมาทุกตัวอักษร)
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
            and me_role.code = 'department_manager'
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
        -- ใหม่: แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" อ่านได้ก็ต่อเมื่ออนุมัติผ่านครบแล้วเท่านั้น
        or (
          r.status = 'approved'
          and me.department_id = any(r.cc_department_ids)
        )
      )
  )
$$;

revoke all on function private.can_access_request(uuid) from public;
grant execute on function private.can_access_request(uuid) to authenticated;

-- 2. app_approval_decision (Pilot Web RPC) — เมื่อขั้นสุดท้ายอนุมัติผ่าน (v_next.id is null และ
--    ไม่ใช่ MT_REPAIR ที่ไปต่อ pending_assign) แจ้งเตือนพนักงาน active ทุกคนของแผนกที่ถูกสำเนา
--    ตรรกะส่วนที่เหลือคัดลอกจาก 20260922010000_management_request_pp01_fm08.sql ทุกตัวอักษร
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
      and v_step.approver_role_id = v_employee.role_id
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

      update public.requests
      set status = case when coalesce(v_uses_repair, false)
                        then 'pending_assign'::public.request_status
                        else 'approved'::public.request_status end,
          current_step = 0, approved_at = now(),
          last_changed_by = v_employee.id
      where id = v_request.id;

      -- ใหม่: อนุมัติผ่านครบทุกขั้นแล้ว (ไม่ใช่สายซ่อมที่ไปต่อ pending_assign) — ส่งสำเนาให้
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
