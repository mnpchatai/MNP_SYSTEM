-- ตอบกลับ "ขอข้อมูลเพิ่มเติม" ได้จริง + เก็บทั้งคำขอและคำตอบไว้ใน request_comments
--
-- ปัญหาที่พบ: เมื่อผู้อนุมัติกด "ขอข้อมูลเพิ่ม" (more_info) ใน Pilot Web ใบจะค้างสถานะ
-- more_info ตลอดไป เพราะไม่มีทางให้ผู้แจ้งตอบกลับแล้วส่งเข้าคิวอนุมัติใหม่เลย (ต่างจากแอป
-- Next.js ที่มี resubmitRequestAction) และเหตุผลของคำขอ/คำตอบก็ไม่เคยถูกรวมไว้ที่เดียวให้
-- อ่านง่าย
--
-- ไฟล์นี้แก้ 2 จุด:
--   1. app_approval_decision: เมื่อผลเป็น more_info ให้ก็อปปี้เหตุผลเข้า request_comments
--      ด้วย (นอกจาก approval_steps.comment เดิม) เพื่อให้ "คำขอ" ปรากฏในประวัติคอมเมนต์
--   2. app_resubmit_request (ใหม่): ผู้แจ้ง (หรือ Admin) ตอบกลับด้วยข้อความบังคับกรอก แล้ว
--      ระบบสร้างขั้นอนุมัติถัดไปแบบเดียวกับขั้นที่ขอข้อมูลเพิ่ม ส่งใบกลับเป็น pending_approval
--      พร้อมบันทึกคำตอบลง request_comments ด้วย เพื่อให้ "คำตอบ" ปรากฏในประวัติคอมเมนต์เช่นกัน
--
-- ขอบเขต: ใช้ได้กับคำร้องทุกประเภทที่มีขั้นอนุมัติแบบ more_info ไม่ใช่แค่ใบแจ้งซ่อม

-- 1. app_approval_decision — เพิ่มการมิเรอร์เหตุผลของ more_info เข้า request_comments
--    ตรรกะอื่นเหมือนไฟล์ 20260918060000_approval_module_permissions.sql ทุกประการ
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
  v_clean_comment text;
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

  v_clean_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_clean_comment
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info') then
    update public.requests
    set status = case when p_decision = 'rejected'
                      then 'rejected'::public.request_status
                      else 'more_info'::public.request_status end,
        last_changed_by = v_employee.id
    where id = v_request.id;

    -- มิเรอร์เหตุผลของ "ขอข้อมูลเพิ่ม" เข้าประวัติคอมเมนต์ ให้ผู้แจ้งเห็นคำถามพร้อมคำตอบที่เดียว
    if p_decision = 'more_info' then
      insert into public.request_comments (request_id, author_id, body)
      values (
        v_request.id, v_employee.id,
        'ขอข้อมูลเพิ่มเติม (' || v_step.step_name || ')' ||
        coalesce(': ' || v_clean_comment, ' — ไม่ได้ระบุรายละเอียดเพิ่มเติม')
      );
    end if;
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

-- 2. app_resubmit_request — ผู้แจ้งตอบกลับข้อมูลเพิ่มเติมแล้วส่งกลับเข้าคิวอนุมัติ
--
-- คัดลอกโครงจาก resubmitRequestAction ในแอป Next.js (src/app/actions/requests.ts) ทุก
-- ประการ ต่างกันแค่รับข้อความคำตอบเป็นพารามิเตอร์บังคับ แล้วบันทึกลง request_comments
-- ด้วย (ของเดิมใน Next.js ให้ผู้แจ้งพิมพ์ผ่านกล่องความคิดเห็นแยกต่างหากก่อนกดปุ่ม)
create or replace function public.app_resubmit_request(
  p_request_id uuid,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_current_step public.approval_steps%rowtype;
  v_target_step public.approval_steps%rowtype;
  v_next_order integer;
  v_is_admin boolean;
  v_clean_comment text;
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

  v_clean_comment := trim(coalesce(p_comment, ''));
  if char_length(v_clean_comment) not between 3 and 3000 then
    raise exception 'INVALID_COMMENT';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'more_info' then
    raise exception 'REQUEST_NOT_MORE_INFO';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if v_request.requester_id <> v_employee.id and not v_is_admin then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_current_step
  from public.approval_steps
  where request_id = p_request_id and step_order = v_request.current_step;
  if v_current_step.id is null then
    raise exception 'CURRENT_STEP_NOT_FOUND';
  end if;

  if v_current_step.status = 'pending' then
    -- current_step ถูกเตรียมขั้นถัดไปไว้แล้วแบบยังไม่มีใครกด (เช่น ใบที่ถูกย้ายลำดับอนุมัติ
    -- ระหว่างที่ยังค้าง more_info — ดูไมเกรชัน repair_rechain_open_requests.sql) แค่ส่งใบ
    -- กลับเข้าคิวอนุมัติที่ขั้นเดิมนี้ ไม่ต้องเปิดขั้นใหม่ซ้อน
    update public.requests
    set status = 'pending_approval', last_changed_by = v_employee.id
    where id = p_request_id;
    v_target_step := v_current_step;
  elsif v_current_step.status = 'more_info' then
    -- ขั้นนี้ถูกใช้ตัดสินใจไปแล้ว (more_info) แก้กลับเป็น pending ไม่ได้ จึงเปิดขั้นใหม่ต่อท้าย
    -- ด้วยผู้อนุมัติชุดเดียวกัน แล้วชี้ current_step ไปที่ขั้นใหม่นี้แทน
    select coalesce(max(step_order), 0) + 1 into v_next_order
    from public.approval_steps
    where request_id = p_request_id;

    insert into public.approval_steps (
      request_id, step_order, step_name,
      approver_employee_id, approver_role_id, approver_department_id
    ) values (
      p_request_id, v_next_order, v_current_step.step_name || ' (พิจารณาอีกครั้ง)',
      v_current_step.approver_employee_id, v_current_step.approver_role_id,
      v_current_step.approver_department_id
    );

    update public.requests
    set status = 'pending_approval', current_step = v_next_order, last_changed_by = v_employee.id
    where id = p_request_id;

    select * into v_target_step
    from public.approval_steps
    where request_id = p_request_id and step_order = v_next_order;
  else
    raise exception 'CURRENT_STEP_NOT_ACTIONABLE';
  end if;

  insert into public.request_comments (request_id, author_id, body)
  values (p_request_id, v_employee.id, v_clean_comment);

  if v_target_step.approver_employee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_target_step.approver_employee_id, v_request.id, 'ผู้ขอส่งข้อมูลเพิ่มเติมแล้ว',
      v_request.request_no || ' พร้อมให้พิจารณาอีกครั้ง',
      '/requests/' || v_request.id::text
    );
  elsif v_target_step.approver_role_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'ผู้ขอส่งข้อมูลเพิ่มเติมแล้ว',
           v_request.request_no || ' พร้อมให้พิจารณาอีกครั้ง',
           '/requests/' || v_request.id::text
    from public.employees e
    where e.role_id = v_target_step.approver_role_id
      and e.is_active
      and (v_target_step.approver_department_id is null or e.department_id = v_target_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;
