-- ============================================================================
-- สายอนุมัติ ผู้จัดการโรงงาน → ผู้จัดการทั่วไป ต้องไม่ข้ามขั้นแบบเงียบๆ
--
-- ปัญหา (ใบแจ้งซ่อม BG021/26 และอีก 3 ใบ): app_create_repair_request และ app_create_request
-- (ประเภทที่ uses_factory_general_chain) "ข้ามขั้นที่ยังไม่มีคนถือบทบาทนั้น" โดยตรวจ ณ ตอนสร้างใบ
-- ระหว่างที่ยังไม่มีบัญชีใดถือบทบาท general_manager (ก่อนตั้ง acting_role_id ใน 20261003010000)
-- ใบที่สร้างช่วงนั้นจึงมีแค่ขั้น ผจก.โรงงาน พอ ผจก.โรงงานอนุมัติ ใบก็ไปถึง "รอมอบหมายช่าง"
-- ทันทีโดยไม่ผ่าน ผจก.ทั่วไป และไม่มีใครได้รับแจ้งว่าขั้นนั้นถูกตัดทิ้ง
--
-- แก้:
--   1) private.notify_approval_step — แจ้ง "มีคำร้องรออนุมัติ" ถึงผู้มีสิทธิ์อนุมัติขั้นนั้น
--      (เงื่อนไขเดียวกับที่ฟังก์ชันเดิมใช้) ถ้าไม่มีผู้รับเลยสักคน แจ้ง admin ที่ active ทุกคน
--      แทน เพราะ app_approval_decision ให้ role admin อนุมัติได้ทุกขั้นอยู่แล้ว ใบจึงไม่ค้าง
--      (นับ admin ที่ตั้ง acting_role_id ด้วย เพราะยังอนุมัติข้ามขั้นได้ตาม role จริง)
--   2) app_create_request / app_create_repair_request — สร้างขั้น ผจก.โรงงาน และ ผจก.ทั่วไป
--      เสมอ ไม่ตรวจว่ามีผู้ถือบทบาทหรือไม่ แจ้งขั้นแรกผ่านข้อ 1
--   3) app_approval_decision — แจ้งขั้นถัดไปผ่านข้อ 1 (ส่วนอื่นไม่เปลี่ยน)
--   4) ใบแจ้งซ่อม (MT_REPAIR) ที่ค้างอยู่ "รอมอบหมายช่าง" ยังไม่มีช่างถูกมอบหมาย และขาดขั้นใดขั้นหนึ่ง
--      ของสายนี้ ถูกเติมขั้นที่ขาดต่อท้าย แล้วย้อนกลับไป "รออนุมัติ" ที่ขั้นที่เติม ขั้นที่อนุมัติไปแล้ว
--      ไม่ถูกแตะ trigger requests_status_history บันทึกการเปลี่ยนสถานะ (เติมหมายเหตุให้) และแจ้ง
--      ผู้แจ้งตามปกติ ใบที่มอบหมายช่างแล้ว/ซ่อมไปแล้ว และคำร้องประเภทอื่นไม่ถูกแตะ
--
-- ฟังก์ชันที่ redefine คัดลอกจากนิยามล่าสุดบน main (20261003010000_admin_acting_role.sql)
-- เปลี่ยนเฉพาะจุดที่ระบุข้างต้น
--
-- Rollback: นำนิยาม app_create_request / app_create_repair_request / app_approval_decision จาก
-- 20261003010000_admin_acting_role.sql กลับมา แล้ว drop private.notify_approval_step และ
-- private.restore_missing_factory_general_steps
-- ข้อ 4 ย้อนได้ด้วยการลบขั้นที่เติม (step_name ตามสาย, status = 'pending', สร้างใน migration นี้)
-- แล้วตั้งสถานะใบกลับเป็น pending_assign / current_step = 0 — ประวัติทั้งหมดอยู่ใน
-- request_status_history และ audit_logs (trigger approvals_audit / requests_audit)
-- ============================================================================

-- 1. แจ้งผู้มีสิทธิ์อนุมัติขั้น ถ้าไม่มีเลยแจ้ง admin แทน
create or replace function private.notify_approval_step(p_step_id uuid, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_count integer := 0;
begin
  select * into v_step from public.approval_steps where id = p_step_id;
  if v_step.id is null then
    return 0;
  end if;
  select * into v_request from public.requests where id = v_step.request_id;

  if v_step.approver_employee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'มีคำร้องรออนุมัติ', p_body, '/requests/' || v_request.id::text
    from public.employees e
    where e.id = v_step.approver_employee_id and e.is_active;
  else
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'มีคำร้องรออนุมัติ', p_body, '/requests/' || v_request.id::text
    from public.employees e
    where coalesce(e.acting_role_id, e.role_id) = v_step.approver_role_id
      and e.is_active
      and (v_step.approver_department_id is null or e.department_id = v_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'มีคำร้องรออนุมัติ (ขั้นนี้ยังไม่มีผู้อนุมัติ)',
           p_body || ' · ขั้น ' || v_step.step_name || ' ยังไม่มีผู้ถือบทบาทนี้ ผู้ดูแลระบบอนุมัติแทนได้',
           '/requests/' || v_request.id::text
    from public.employees e
    join public.roles r on r.id = e.role_id and r.code = 'admin'
    where e.is_active;
    get diagnostics v_count = row_count;
  end if;

  return v_count;
end;
$$;

revoke all on function private.notify_approval_step(uuid, text) from public, anon, authenticated;

-- 2a. app_create_request
create or replace function public.app_create_request(
  p_type_id uuid,
  p_title text,
  p_description text,
  p_priority text default 'normal',
  p_details jsonb default '{}'::jsonb,
  p_cc_department_ids uuid[] default '{}'::uuid[]
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
  v_factory_role uuid;
  v_general_role uuid;
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
  if coalesce(array_length(p_cc_department_ids, 1), 0) > 0 and exists (
    select 1 from unnest(p_cc_department_ids) as d(id)
    where not exists (select 1 from public.departments dep where dep.id = d.id and dep.is_active)
  ) then
    raise exception 'INVALID_CC_DEPARTMENTS';
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
    details, priority, status, current_step, last_changed_by, cc_department_ids
  ) values (
    v_type.id, v_employee.id, v_employee.department_id, trim(p_title),
    trim(p_description), coalesce(p_details, '{}'::jsonb),
    p_priority::public.request_priority, 'pending_approval', 1, v_employee.id,
    coalesce(p_cc_department_ids, '{}'::uuid[])
  ) returning * into v_request;

  if v_type.uses_factory_general_chain then
    -- สายอนุมัติคงที่ตามฟอร์มจริง: ผู้จัดการโรงงาน -> ผู้จัดการทั่วไป ผูกกับ "บทบาท" ไม่ผูกแผนก
    -- (เหมือน app_create_repair_request) สร้างครบทั้งสองขั้นเสมอ ไม่ข้ามขั้นที่ยังไม่มีคนถือบทบาท
    -- ขั้นที่ไม่มีผู้ถือ private.notify_approval_step แจ้ง admin ให้อนุมัติแทน
    select id into v_factory_role from public.roles where code = 'factory_manager';
    select id into v_general_role from public.roles where code = 'general_manager';

    if v_factory_role is not null then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
    end if;

    if v_general_role is not null then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_request.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
    end if;

    if v_step >= 1 then
      perform private.notify_approval_step(
        (select s.id from public.approval_steps s where s.request_id = v_request.id and s.step_order = 1),
        v_request.request_no || ' · ' || v_request.title
      );
    end if;
  else
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
        where coalesce(e.acting_role_id, e.role_id) = v_final_role
          and e.is_active
          and (v_final_department is null or e.department_id = v_final_department)
          and private.can_approve_module(e.id, v_type.id);
      end if;
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

revoke all on function public.app_create_request(uuid, text, text, text, jsonb, uuid[]) from anon;

-- 2b. app_create_repair_request
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
  v_factory_role uuid;
  v_general_role uuid;
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

  -- สายอนุมัติของใบแจ้งซ่อมกำหนดตายตัวสองขั้นตามขั้นตอนจริง ไม่อ่านจาก
  -- request_types.final_approver_role_id/requires_manager_approval อีกต่อไป (สองค่านั้นชี้ไปที่
  -- ผจก.แผนกเจ้าของเอกสาร = หัวหน้าช่าง ซึ่งไม่ใช่ผู้อนุมัติตามขั้นตอนจริง) ทั้งสองขั้นผูกกับ
  -- "บทบาท" ไม่ผูกแผนก เพราะ ผจก.โรงงาน/ผจก.ทั่วไป ดูแลข้ามแผนกอยู่แล้ว
  select id into v_factory_role from public.roles where code = 'factory_manager';
  select id into v_general_role from public.roles where code = 'general_manager';

  -- สร้างครบทั้งสองขั้นเสมอ ไม่ข้ามขั้นที่ยังไม่มีคนถือบทบาท (เดิมข้าม ทำให้ใบไปถึงรอมอบหมายช่าง
  -- โดยไม่ผ่าน ผจก.ทั่วไป) ขั้นที่ไม่มีผู้ถือ private.notify_approval_step แจ้ง admin ให้อนุมัติแทน
  if v_factory_role is not null then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
  end if;

  if v_general_role is not null then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
  end if;

  if v_step = 0 then
    -- เกิดได้เฉพาะเมื่อไม่มี role factory_manager/general_manager ในตาราง roles เลย (ตั้งค่าระบบผิด)
    -- คงพฤติกรรมเดิม: ตกไป pending_assign ให้ ผจก.แผนกซ่อมบำรุงมอบหมายช่างต่อ
    update public.requests
    set status = 'pending_assign', current_step = 0
    where id = v_request.id;
  else
    perform private.notify_approval_step(
      (select s.id from public.approval_steps s where s.request_id = v_request.id and s.step_order = 1),
      v_request.request_no || ' · ' || v_request.title
    );
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

-- 3. app_approval_decision
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

      perform private.notify_approval_step(v_next.id, v_request.request_no || ' · ' || v_next.step_name);
    end if;
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_approval_decision(uuid, text, text) from public, anon;
grant execute on function public.app_approval_decision(uuid, text, text) to authenticated;

-- 4. ใบแจ้งซ่อมที่หลุดไปรอมอบหมายช่างโดยขาดขั้นในสาย ผจก.โรงงาน → ผจก.ทั่วไป
--    เขียนเป็นฟังก์ชัน private (ไม่ grant ให้ใคร) เพื่อให้ทดสอบได้ใน supabase/tests/database
--    รันซ้ำได้ปลอดภัย: ใบที่แก้แล้วไม่อยู่ในเงื่อนไขอีก คืนจำนวนใบที่ถูกย้อนกลับ
create or replace function private.restore_missing_factory_general_steps()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_factory_role uuid;
  v_general_role uuid;
  v_req record;
  v_order integer;
  v_first public.approval_steps%rowtype;
  v_note constant text := 'ย้อนกลับมารออนุมัติ: ใบนี้ถูกสร้างตอนที่ระบบข้ามขั้นที่ยังไม่มีผู้ถือบทบาท จึงขาดขั้นอนุมัติตามสาย ผู้จัดการโรงงาน → ผู้จัดการทั่วไป';
begin
  select id into v_factory_role from public.roles where code = 'factory_manager';
  select id into v_general_role from public.roles where code = 'general_manager';
  if v_factory_role is null or v_general_role is null then
    return 0;
  end if;

  for v_req in
    select r.id, r.request_no
    from public.requests r
    join public.request_types t on t.id = r.request_type_id
    where t.code = 'MT_REPAIR'
      and r.status = 'pending_assign'
      and r.assignee_id is null
      and not exists (select 1 from public.request_technicians rt where rt.request_id = r.id)
      and (
        not exists (select 1 from public.approval_steps s where s.request_id = r.id and s.approver_role_id = v_factory_role)
        or not exists (select 1 from public.approval_steps s where s.request_id = r.id and s.approver_role_id = v_general_role)
      )
    order by r.created_at
    for update of r
  loop
    select coalesce(max(step_order), 0) into v_order
    from public.approval_steps where request_id = v_req.id;

    if not exists (select 1 from public.approval_steps s where s.request_id = v_req.id and s.approver_role_id = v_factory_role) then
      v_order := v_order + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_req.id, v_order, 'ผู้จัดการโรงงาน', v_factory_role);
    end if;
    if not exists (select 1 from public.approval_steps s where s.request_id = v_req.id and s.approver_role_id = v_general_role) then
      v_order := v_order + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_req.id, v_order, 'ผู้จัดการทั่วไป', v_general_role);
    end if;

    select * into v_first
    from public.approval_steps
    where request_id = v_req.id and status = 'pending'
    order by step_order
    limit 1;

    -- last_changed_by = null: trigger บันทึกประวัติโดยไม่ระบุผู้ทำ (migration ไม่ใช่ผู้ใช้คนใด)
    update public.requests
    set status = 'pending_approval', current_step = v_first.step_order,
        approved_at = null, last_changed_by = null
    where id = v_req.id;

    update public.request_status_history
    set note = v_note
    where request_id = v_req.id
      and from_status = 'pending_assign' and to_status = 'pending_approval'
      and note is null;

    perform private.notify_approval_step(v_first.id, v_req.request_no || ' · ' || v_first.step_name);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.restore_missing_factory_general_steps() from public, anon, authenticated;

select private.restore_missing_factory_general_steps();
