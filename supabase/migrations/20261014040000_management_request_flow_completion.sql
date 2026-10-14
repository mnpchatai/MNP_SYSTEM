-- ใบคำร้องถึงฝ่ายบริหาร (MANAGEMENT, PP01-FM08): ปิดช่องที่ทำให้ flow ไม่ครบหรือหลุดจากกติกา
--
-- 1. app_approval_decision (นิยามล่าสุดจาก 20261009094227_mt_first_approval_assistant_factory_manager.sql)
--    1.1 มติ "รับทราบข้อมูล" (acknowledged) ใช้ได้เฉพาะ MANAGEMENT ตามฟอร์ม PP01-FM08 เท่านั้น
--        เดิมฐานข้อมูลรับมตินี้กับทุกประเภท (ซ่อนไว้แค่ปุ่ม) ใครเรียก RPC ตรงก็ปิดใบแจ้งซ่อม MT/IT ได้
--        ด้วยสถานะที่ workflow ของประเภทนั้นไม่รองรับ
--    1.2 คืนกติกา "ไม่อนุมัติ" / "ขอข้อมูลเพิ่ม" ต้องระบุเหตุผลอย่างน้อย 3 ตัวอักษร (COMMENT_REQUIRED)
--        ที่เพิ่มใน 20260921090000_repair_workflow_spec_alignment.sql แต่หายไปเมื่อ
--        20260922010000_management_request_pp01_fm08.sql คัดลอกฟังก์ชันจากนิยามที่เก่ากว่า (20260921080000)
--        หน้าเว็บทั้งสองฝั่งบังคับอยู่แล้ว แต่ฐานข้อมูลต้องบังคับเองด้วย
-- 2. app_resubmit_request (นิยามล่าสุดจาก 20261010011123_mt_assistant_admin_email_notifications.sql)
--    ผู้รับแจ้งเตือน "ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว" ใช้ private.approval_step_recipients ชุดเดียวกับ
--    แจ้งเตือนรออนุมัติ/เตือนงานค้าง เดิมขั้นที่ไม่มีผู้ถือบทบาท (เช่น ยังไม่มี ผจก.ทั่วไป admin
--    อนุมัติแทนและขอข้อมูลเพิ่ม) ส่งกลับแล้วไม่มีใครได้รับแจ้งเลย ใบค้างเงียบ
--    ผลกับขั้นที่มีผู้ถือบทบาทเท่าเดิมทุกประการ (รวมข้อยกเว้น Admin ที่ทำหน้าที่ผู้ช่วย ผจก.โรงงานของ MT)
-- 3. app_update_request_status (นิยามล่าสุดจาก 20260921100000_keep_managers_out_of_technician_process.sql)
--    ใบคำร้องถึงฝ่ายบริหาร "จบที่มติ" (อนุมัติ/ไม่อนุมัติ/รับทราบ) ไม่มีขั้นรับงาน ตามกติกาเดียวกับ
--    การนับงานค้าง (modules/request-center.js) และการเตือนงานค้าง (20261005010000_pending_work_reminders.sql)
--    แต่เดิม RPC นี้ยังให้ผู้มี requests.operate กด approved → in_progress ได้ ใบจึงหลุดไปสถานะที่ไม่มี
--    ใครนับ/ไม่มีใครเตือน จึงห้าม approved → in_progress ของ MANAGEMENT
--    ใบเก่าที่เคยถูกกดเป็น in_progress ไปแล้ว (ถ้ามี) ยังปิดเป็น completed ได้ตามเดิม ไม่ค้าง
--
-- ไม่แก้ข้อมูลเดิม ไม่เปลี่ยนสายอนุมัติ ผู้มีสิทธิ์อนุมัติ หรือสิทธิ์อ่านของแผนกที่ได้รับสำเนา
--
-- Rollback: create or replace ทั้งสามฟังก์ชันด้วยนิยามจากไฟล์ที่ระบุในข้อ 1-3 (grant/revoke คงเดิม)

-- 1. app_approval_decision ------------------------------------------------------------------
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
  v_type_code text;
  v_comment text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_decision not in ('approved', 'rejected', 'more_info', 'acknowledged') then
    raise exception 'INVALID_DECISION';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
  -- ใหม่ (คืนกติกาเดิม): มีแต่ "อนุมัติ" และ "รับทราบข้อมูล" ที่ความเห็นเป็นทางเลือก
  if p_decision in ('rejected', 'more_info') and coalesce(char_length(v_comment), 0) < 3 then
    raise exception 'COMMENT_REQUIRED';
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

  select code, uses_repair_workflow into v_type_code, v_uses_repair
  from public.request_types
  where id = v_request.request_type_id;
  -- ใหม่: มติที่ 3 ของฟอร์ม PP01-FM08 เป็นของใบคำร้องถึงฝ่ายบริหารเท่านั้น
  if p_decision = 'acknowledged' and v_type_code is distinct from 'MANAGEMENT' then
    raise exception 'DECISION_NOT_ALLOWED';
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

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_comment
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info', 'acknowledged') then
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

-- 2. app_resubmit_request -------------------------------------------------------------------
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

  perform private.set_status_note(v_comment);
  update public.requests
  set status = 'pending_approval', current_step = v_step.step_order, last_changed_by = v_employee.id
  where id = v_request.id;

  -- ใหม่: ผู้รับชุดเดียวกับแจ้งเตือนรออนุมัติและการเตือนงานค้าง รวม admin รับแทนเมื่อขั้นนี้ไม่มีผู้ถือบทบาท
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select r.employee_id, v_request.id, 'ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว',
         v_request.request_no || ' · ' || v_step.step_name
           || case when r.is_fallback then ' · ขั้นนี้ยังไม่มีผู้ถือบทบาท ผู้ดูแลระบบพิจารณาแทนได้' else '' end,
         '/requests/' || v_request.id::text
  from private.approval_step_recipients(v_step.id) r;

  return v_request.id;
end;
$$;
revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;

-- 3. app_update_request_status --------------------------------------------------------------
create or replace function public.app_update_request_status(p_request_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_uses_repair boolean;
  v_type_code text;
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

  -- ใบแจ้งซ่อมต้องเดินผ่าน app_start_repair_work / app_finish_repair_work / app_verify_repair
  -- เท่านั้น ไม่งั้นคนที่มี requests.operate จะสั่ง in_progress → completed ปิดงานข้ามช่างและ
  -- ข้ามการตรวจรับของผู้แจ้งได้ตรงๆ (ใบแจ้งซ่อมผ่านสถานะ in_progress จริง จึงเข้าเงื่อนไขเดิมพอดี)
  select code, uses_repair_workflow into v_type_code, v_uses_repair
  from public.request_types
  where id = v_request.request_type_id;
  if coalesce(v_uses_repair, false) then
    raise exception 'REPAIR_USES_OWN_WORKFLOW';
  end if;
  -- ใหม่: ใบคำร้องถึงฝ่ายบริหารจบที่มติ ไม่มีขั้นรับงาน (ใบเก่าที่ in_progress อยู่แล้วยังปิดงานได้)
  if v_type_code = 'MANAGEMENT' and p_status = 'in_progress' then
    raise exception 'REQUEST_ENDS_AT_DECISION';
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
revoke all on function public.app_update_request_status(uuid, text) from public, anon;
grant execute on function public.app_update_request_status(uuid, text) to authenticated;
