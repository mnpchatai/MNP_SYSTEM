-- ============================================================================
-- สายอนุมัติใบแจ้งซ่อมผิดมาตั้งแต่ต้น — หัวหน้าช่างไม่ใช่ผู้อนุมัติ
--
-- ขั้นตอนจริงหน้างาน:
--   ผู้แจ้ง → ผู้จัดการโรงงานอนุมัติ → ผู้จัดการทั่วไปอนุมัติ
--          → ผู้จัดการแผนกซ่อมบำรุง "มอบหมายช่าง" (ไม่ใช่ขั้นอนุมัติ)
--          → ช่างที่ถูกมอบหมายกดเริ่มงาน
--
-- ที่โค้ดทำอยู่จริงก่อนไฟล์นี้ (app_create_repair_request ใน 20260918060000):
--   ขั้น 1 'หัวหน้าแผนก'                  → approver_employee_id = manager_id ของผู้แจ้ง
--   ขั้น 2 'ผู้อนุมัติหน่วยงานรับผิดชอบ'  → resolve_approval_target(
--                                            request_types.final_approver_role_id,
--                                            request_types.owning_department_id)
--
-- ค่าที่ MT_REPAIR ถืออยู่ (seed เดิมใน 20260916070554 บรรทัด 528 ไม่เคยถูกแก้):
--   final_approver_role_id = 20000000-0000-0000-0000-000000000002
--   owning_department_id   = 10000000-0000-0000-0000-000000000002  (MT ฝ่ายซ่อมบำรุง)
-- role 0002 เดิมชื่อ 'approver' และถูก "เปลี่ยนชื่อ" เป็น 'department_manager' (ผู้จัดการแผนก)
-- ใน 20260919000000_unify_position_and_role โดยคง id เดิมไว้ — ผลคือขั้นที่ 2 ของใบแจ้งซ่อม
-- resolve ออกมาเป็น "ผู้จัดการแผนก ของแผนก MT" = หัวหน้าช่าง/ผจก.แผนกซ่อมบำรุง ตรงตัว
-- เขาจึงเป็นผู้อนุมัติขั้นสุดท้ายของทุกใบแจ้งซ่อม ทั้งที่ตามขั้นตอนจริงเขาไม่มีอำนาจอนุมัติเลย
-- มีแค่หน้าที่มอบหมายช่างและอัปเดตงาน ส่วน ผจก.โรงงาน กับ ผจก.ทั่วไป ไม่เคยอยู่ในสายอนุมัติ
-- ของใบแจ้งซ่อมเลยสักขั้น (คอมเมนต์บรรทัด 13 ของ 20260921040000 ที่เขียนว่าสายอนุมัติคือ
-- "หัวหน้าแผนกผู้แจ้ง → ผู้จัดการโรงงาน → ผู้จัดการทั่วไป" เป็นคำอธิบายที่ไม่ตรงกับโค้ดจริง)
--
-- ไฟล์นี้แก้ 5 จุดให้ตรงกับขั้นตอนจริง:
--   1) app_create_repair_request  — สายอนุมัติเป็น ผู้จัดการโรงงาน → ผู้จัดการทั่วไป
--      ตัดขั้น 'หัวหน้าแผนก' (หัวหน้าของผู้แจ้ง) และขั้นที่ผูกกับแผนกเจ้าของเอกสารออกทั้งคู่
--   2) app_approval_decision      — ข้ามการตรวจสิทธิ์ได้เฉพาะ role 'admin' จริงเท่านั้น
--      เดิมใช้ has_permission('requests.view_all') ซึ่ง factory_manager/general_manager ก็มี
--      (ดู 20260919000000 บรรทัด 65-73) ทำให้ทั้งสองคนกดอนุมัติ "ขั้นของอีกคน" ได้ ลำดับ
--      ผจก.โรงงาน → ผจก.ทั่วไป จึงไม่ถูกบังคับจริง — ใช้เกณฑ์เดียวกับที่ 20260921050000
--      ทำไว้แล้วกับปุ่มเริ่มงานซ่อม
--   3) app_list_module_permissions — ให้ factory_manager/general_manager ขึ้นในตารางสิทธิ์โมดูล
--      เดิมตัดทุก role ที่มี requests.view_all ออก เพราะสมัยนั้นสองคนนี้ bypass อยู่แล้ว
--      พอข้อ 2 เลิก bypass ถ้าไม่แก้ข้อนี้ Admin จะไม่มีที่ให้ติ๊กสิทธิ์โมดูลให้เขาเลย
--      (ยังตัด admin ออกเหมือนเดิม เพราะ admin bypass จริง)
--   4) ให้สิทธิ์โมดูลทุกประเภทที่เปิดใช้อยู่แก่ factory_manager/general_manager ที่ active
--      อยู่วันนี้ เพื่อให้กดอนุมัติได้ทันทีหลัง migrate ไม่ต้องรอ Admin มาติ๊กทีละคน
--   5) ใบแจ้งซ่อมที่ยังค้างอยู่ในขั้นอนุมัติ (pending_approval/more_info) ถูกย้ายมาสายใหม่
--      ใบที่เลยขั้นอนุมัติไปแล้ว (pending_assign เป็นต้นไป) ไม่ถูกแตะ ประวัติยังอยู่ครบ
--
-- ผลข้างเคียงที่ตั้งใจ: ข้อ 2 มีผลกับคำร้องทุกประเภท ไม่ใช่เฉพาะใบแจ้งซ่อม — ผจก.โรงงาน/
-- ผจก.ทั่วไป จะกดอนุมัติได้เฉพาะขั้นที่เป็นของตัวเองจริงๆ ไม่ใช่ทุกใบเหมือนเดิม
-- ============================================================================

-- 1. สร้างใบแจ้งซ่อม: สายอนุมัติ ผู้จัดการโรงงาน → ผู้จัดการทั่วไป
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
  v_first_role uuid;
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

  -- ข้ามขั้นที่ยังไม่มีคนถือบทบาทนั้น ไม่งั้นใบจะค้างโดยไม่มีใครกดอนุมัติได้เลย
  if v_factory_role is not null and exists (
    select 1 from public.employees e where e.role_id = v_factory_role and e.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
  end if;

  if v_general_role is not null and exists (
    select 1 from public.employees e where e.role_id = v_general_role and e.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
  end if;

  if v_step = 0 then
    -- ไม่มีผู้อนุมัติในระบบเลย — ตกไป pending_assign ให้ ผจก.แผนกซ่อมบำรุงมอบหมายช่างต่อ
    update public.requests
    set status = 'pending_assign', current_step = 0
    where id = v_request.id;
  else
    select approver_role_id into v_first_role
    from public.approval_steps
    where request_id = v_request.id and step_order = 1;

    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
           v_request.request_no || ' · ' || v_request.title,
           '/requests/' || v_request.id::text
    from public.employees e
    where e.role_id = v_first_role and e.is_active;
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

-- 2. ตัดสินอนุมัติ: ข้ามการตรวจได้เฉพาะ admin จริง และคง is-not-null guard จาก 20260921070000
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

  -- เฉพาะ role 'admin' เท่านั้นที่ข้ามได้ (เผื่อแก้ปัญหาระบบ) — factory_manager/general_manager
  -- ถือ requests.view_all ด้วย ถ้ายังใช้ has_permission เหมือนเดิมทั้งสองคนจะกดอนุมัติแทนกันได้
  -- ลำดับ ผจก.โรงงาน → ผจก.ทั่วไป ก็ไม่มีความหมาย ตอนนี้ทุกคนต้องตรงกับขั้นของตัวเองจริงๆ
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

-- 3. ตารางสิทธิ์โมดูลต้องมีแถวของ ผจก.โรงงาน/ผจก.ทั่วไป ให้ Admin ติ๊กได้ (ตัดเฉพาะ admin ออก)
create or replace function public.app_list_module_permissions()
returns table (
  employee_id uuid,
  employee_no text,
  full_name text,
  department_code text,
  role_code text,
  request_type_id uuid,
  request_type_code text,
  request_type_name text,
  granted boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.employee_no, e.first_name || ' ' || e.last_name, d.code, r.code,
         t.id, t.code, t.name_th,
         (m.employee_id is not null)
  from public.employees e
  join public.roles r on r.id = e.role_id
  join public.role_permissions rp on rp.role_id = r.id
  join public.permissions p on p.id = rp.permission_id and p.code = 'approvals.act'
  join public.departments d on d.id = e.department_id
  cross join public.request_types t
  left join public.approval_module_permissions m
    on m.employee_id = e.id and m.request_type_id = t.id
  where private.has_permission('approvals.manage')
    and e.is_active
    and t.is_active
    and r.code <> 'admin'
  order by e.employee_no, t.sort_order
$$;

revoke all on function public.app_list_module_permissions() from public, anon;
grant execute on function public.app_list_module_permissions() to authenticated;

-- 4. ผจก.โรงงาน/ผจก.ทั่วไป ที่ active อยู่วันนี้ ได้สิทธิ์โมดูลทุกประเภทที่เปิดใช้อยู่
insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
select e.id, t.id, null::uuid
from public.employees e
join public.roles r on r.id = e.role_id
cross join public.request_types t
where e.is_active
  and t.is_active
  and r.code in ('factory_manager', 'general_manager')
on conflict do nothing;

-- 5. ใบแจ้งซ่อมที่ยังค้างในขั้นอนุมัติ ย้ายมาสายใหม่ (ใบที่เลยขั้นอนุมัติไปแล้วไม่ถูกแตะ)
do $$
declare
  v_factory_role uuid;
  v_general_role uuid;
  v_has_factory boolean;
  v_has_general boolean;
  v_req record;
  v_step integer;
  v_first_role uuid;
begin
  select id into v_factory_role from public.roles where code = 'factory_manager';
  select id into v_general_role from public.roles where code = 'general_manager';

  v_has_factory := v_factory_role is not null and exists (
    select 1 from public.employees e where e.role_id = v_factory_role and e.is_active
  );
  v_has_general := v_general_role is not null and exists (
    select 1 from public.employees e where e.role_id = v_general_role and e.is_active
  );

  for v_req in
    select r.id, r.status, r.request_no, r.title
    from public.requests r
    join public.request_types t on t.id = r.request_type_id
    where t.uses_repair_workflow
      and r.status in ('pending_approval', 'more_info')
  loop
    -- แถวเดิมถูกลบผ่าน trigger approvals_audit จึงยังเหลือร่องรอยใน audit_logs ครบ
    delete from public.approval_steps where request_id = v_req.id;

    v_step := 0;
    if v_has_factory then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_req.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
    end if;
    if v_has_general then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_req.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
    end if;

    if v_step = 0 then
      update public.requests
      set status = 'pending_assign', current_step = 0
      where id = v_req.id;
    else
      update public.requests
      set status = 'pending_approval', current_step = 1
      where id = v_req.id;

      select approver_role_id into v_first_role
      from public.approval_steps
      where request_id = v_req.id and step_order = 1;

      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_req.id, 'มีคำร้องรออนุมัติ',
             v_req.request_no || ' · ' || v_req.title,
             '/requests/' || v_req.id::text
      from public.employees e
      where e.role_id = v_first_role and e.is_active;
    end if;

    insert into public.request_status_history (request_id, from_status, to_status, note)
    values (
      v_req.id, v_req.status,
      case when v_step = 0 then 'pending_assign' else 'pending_approval' end::public.request_status,
      'แก้สายอนุมัติให้ตรงขั้นตอนจริง: ผู้จัดการโรงงาน → ผู้จัดการทั่วไป'
    );
  end loop;
end $$;
