-- ============================================================================
-- บทบาทที่ทำหน้าที่ (acting role) ของบัญชีผู้ดูแลระบบ
--
-- ปัญหา: ผู้จัดการทั่วไปที่ต้องใช้สิทธิ์ admin ด้วย (บัญชี role = admin) ได้รับแจ้งเตือนและเห็น
-- "รออนุมัติ" ของทุกคำร้องในบริษัท แต่กลับไม่ได้รับแจ้งเตือนของขั้น "ผู้จัดการทั่วไป" เลย เพราะ
-- ผู้รับแจ้งเตือนเลือกจาก employees.role_id ตรงตัว ยิ่งกว่านั้น app_create_repair_request และ
-- app_create_request (สาย ผจก.โรงงาน → ผจก.ทั่วไป) "ข้ามขั้นที่ไม่มีคนถือบทบาทนั้น" จึงตัดขั้น
-- ผู้จัดการทั่วไปทิ้งทุกใบเมื่อไม่มีใครถือ role general_manager
--
-- แก้: เพิ่ม employees.acting_role_id ให้บัญชี admin เลือกได้เองว่าทำงานในฐานะบทบาทใด
--   * NULL (ค่าเริ่มต้น) = ทำงานแบบผู้ดูแลระบบเหมือนเดิมทุกอย่าง
--   * ตั้งค่าแล้ว = ในเรื่องสายอนุมัติและการแจ้งเตือน ระบบถือว่าบัญชีนี้ถือบทบาทนั้น:
--       - นับเป็นผู้ถือบทบาทตอนสร้างสายอนุมัติ ผจก.โรงงาน → ผจก.ทั่วไป
--       - ได้รับ "มีคำร้องรออนุมัติ" / "ผู้ยื่นคำร้องส่งข้อมูลเพิ่มเติมแล้ว" ของขั้นที่ผูกกับบทบาทนั้น
--         (ยังต้องมีสิทธิ์โมดูลเหมือนผู้ถือบทบาทจริง)
--       - ไม่ได้รับแจ้งเตือนเฉพาะผู้ดูแลระบบ (คำร้องเปิดบัญชี/แก้ไข ID/รหัสผ่าน) เพราะบทบาทที่
--         เลือกไม่มีสิทธิ์ accounts.manage — หน้า Admin ยังจัดการคำร้องเหล่านี้ได้ตามปกติ
--   สิทธิ์ admin อื่นทั้งหมด (RLS, หน้า Admin, อนุมัติข้ามขั้นได้) ไม่เปลี่ยน คอลัมน์นี้ไม่ได้ให้
--   สิทธิ์ใหม่ เพราะ admin อนุมัติขั้นใดก็ได้อยู่แล้วใน app_approval_decision
--
-- ข้อจำกัดที่ตั้งใจ: NCR ยังตรวจบทบาทจริง (ncr_notify / app_ncr_signoff) ไม่ได้ใช้ค่านี้
--
-- ฟังก์ชันที่ redefine ด้านล่างคัดลอกจากนิยามล่าสุดบน main ทุกตัวอักษร เปลี่ยนเฉพาะเงื่อนไข
-- "e.role_id = <บทบาท>" เป็น "coalesce(e.acting_role_id, e.role_id) = <บทบาท>"
-- ส่วนการตรวจสิทธิ์อนุมัติใน app_approval_decision ยังใช้ role จริง (admin อนุมัติได้ทุกขั้นอยู่แล้ว)
--   app_create_request          จาก 20260922010000_management_request_pp01_fm08.sql
--   app_create_repair_request   จาก 20260921080000_repair_approval_chain_factory_then_general_manager.sql
--   app_approval_decision       จาก 20260922050000_cc_department_notify_on_approval.sql
--   app_resubmit_request        จาก 20260921010000_more_info_reply_on_step.sql
--   app_request_credential_change จาก 20260919000000_unify_position_and_role.sql
--
-- Rollback: ตั้ง acting_role_id = null ให้ทุกแถวก่อน แล้วค่อยนำนิยามฟังก์ชันเดิมจากไฟล์ข้างต้นกลับมา
-- และ drop คอลัมน์/trigger/RPC ในไฟล์นี้ (ไม่มีข้อมูลเดิมถูกแก้)
-- ============================================================================

-- 1. คอลัมน์ + ข้อบังคับ: มีค่าได้เฉพาะบัญชี role admin และห้ามชี้กลับไปที่ admin เอง
--    ตั้งใจไม่ใส่ foreign key ไปที่ roles: ถ้ามี FK ที่สองจาก employees ไป roles ทุก query ที่
--    embed "role:roles(...)" จาก employees (หน้า login ของ Pilot Web และ Next.js) จะ error
--    PGRST201 ทันที รวมถึง app.js ที่ค้างใน cache ของเบราว์เซอร์ก่อน deploy หน้าเว็บใหม่
--    trigger ด้านล่างตรวจว่ามี role นั้นจริงแทน
alter table public.employees
  add column acting_role_id uuid;

comment on column public.employees.acting_role_id is
  'บทบาทที่บัญชี admin เลือกทำหน้าที่ในสายอนุมัติและการแจ้งเตือน NULL = ผู้ดูแลระบบเต็มรูปแบบ';

-- ถ้าบัญชีถูกเปลี่ยนออกจาก admin ค่านี้ต้องหายไปเอง ไม่งั้นพนักงานทั่วไปจะได้แจ้งเตือนของบทบาทอื่น
create or replace function private.normalize_employee_acting_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.acting_role_id is not null and (
    not exists (select 1 from public.roles r where r.id = new.role_id and r.code = 'admin')
    or not exists (select 1 from public.roles r where r.id = new.acting_role_id and r.code <> 'admin')
  ) then
    new.acting_role_id := null;
  end if;
  return new;
end;
$$;

revoke all on function private.normalize_employee_acting_role() from public, anon, authenticated;

create trigger employees_normalize_acting_role
before insert or update of role_id, acting_role_id on public.employees
for each row execute function private.normalize_employee_acting_role();

-- 2. RPC: admin ตั้ง/ล้างบทบาทที่ทำหน้าที่ของตัวเอง (p_role_id null = กลับเป็นผู้ดูแลระบบเต็มรูปแบบ)
create or replace function public.app_set_my_acting_role(p_role_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select e.* into v_employee
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.auth_user_id = auth.uid() and e.is_active and r.code = 'admin'
  limit 1;
  if v_employee.id is null then
    raise exception 'NOT_AUTHORIZED';
  end if;

  if p_role_id is not null and not exists (
    select 1 from public.roles r where r.id = p_role_id and r.code <> 'admin'
  ) then
    raise exception 'INVALID_ROLE';
  end if;

  -- trigger audit_row_change ของ employees บันทึกการเปลี่ยนแปลงนี้ไว้ใน audit_logs
  update public.employees
  set acting_role_id = p_role_id
  where id = v_employee.id;

  return v_employee.id;
end;
$$;

revoke all on function public.app_set_my_acting_role(uuid) from public, anon;
grant execute on function public.app_set_my_acting_role(uuid) to authenticated;

-- 3. app_create_request
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
    -- (เหมือน app_create_repair_request) และข้ามขั้นที่ยังไม่มีคนถือบทบาทนั้น ไม่งั้นใบจะค้าง
    select id into v_factory_role from public.roles where code = 'factory_manager';
    select id into v_general_role from public.roles where code = 'general_manager';

    if v_factory_role is not null and exists (
      select 1 from public.employees e where coalesce(e.acting_role_id, e.role_id) = v_factory_role and e.is_active
    ) then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
    end if;

    if v_general_role is not null and exists (
      select 1 from public.employees e where coalesce(e.acting_role_id, e.role_id) = v_general_role and e.is_active
    ) then
      v_step := v_step + 1;
      insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
      values (v_request.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
    end if;

    if v_step >= 1 then
      select approver_role_id into v_final_role
      from public.approval_steps
      where request_id = v_request.id and step_order = 1;

      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where coalesce(e.acting_role_id, e.role_id) = v_final_role
        and e.is_active
        and private.can_approve_module(e.id, v_type.id);
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

-- 4. app_create_repair_request
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
    select 1 from public.employees e where coalesce(e.acting_role_id, e.role_id) = v_factory_role and e.is_active
  ) then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
  end if;

  if v_general_role is not null and exists (
    select 1 from public.employees e where coalesce(e.acting_role_id, e.role_id) = v_general_role and e.is_active
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
    where coalesce(e.acting_role_id, e.role_id) = v_first_role and e.is_active;
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


-- 5. app_approval_decision
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
        where coalesce(e.acting_role_id, e.role_id) = v_next.approver_role_id
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

-- 6. app_resubmit_request
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
    where coalesce(e.acting_role_id, e.role_id) = v_step.approver_role_id
      and e.is_active
      and (v_step.approver_department_id is null or e.department_id = v_step.approver_department_id)
      and private.can_approve_module(e.id, v_request.request_type_id);
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_resubmit_request(uuid, text) from public, anon;
grant execute on function public.app_resubmit_request(uuid, text) to authenticated;

-- 7. app_request_credential_change
create or replace function public.app_request_credential_change(
  p_employee_no text,
  p_password text,
  p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_employee_no text;
  v_request_id uuid;
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

  v_employee_no := upper(trim(coalesce(p_employee_no, '')));
  if v_employee_no = '' then
    v_employee_no := v_employee.employee_no;
  end if;
  if v_employee_no !~ '^[A-Z0-9][A-Z0-9.-]{2,31}$' then
    raise exception 'INVALID_EMPLOYEE_NO';
  end if;
  if char_length(coalesce(p_password, '')) not between 8 and 72 then
    raise exception 'INVALID_PASSWORD';
  end if;
  if v_employee_no <> v_employee.employee_no and exists (
    select 1 from public.employees e where e.employee_no = v_employee_no
  ) then
    raise exception 'EMPLOYEE_NO_TAKEN';
  end if;
  if exists (
    select 1 from public.account_requests
    where status = 'pending' and employee_no = v_employee_no
  ) then
    raise exception 'REQUEST_ALREADY_PENDING';
  end if;

  insert into public.account_requests (
    kind, employee_id, employee_no, first_name, last_name, email, phone,
    department_id, desired_role_id, job_title, desired_password, reason
  ) values (
    'credential_change', v_employee.id, v_employee_no, v_employee.first_name,
    v_employee.last_name, v_employee.email, v_employee.phone,
    v_employee.department_id, v_employee.role_id, v_employee.job_title,
    p_password, nullif(left(trim(coalesce(p_reason, '')), 1000), '')
  ) returning id into v_request_id;

  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select e.id, null, 'มีคำร้องขอแก้ไข ID/รหัสผ่าน',
         v_employee.employee_no || ' · ' || v_employee.first_name || ' ' || v_employee.last_name,
         '/admin'
  from public.employees e
  join public.role_permissions rp on rp.role_id = coalesce(e.acting_role_id, e.role_id)
  join public.permissions p on p.id = rp.permission_id
  where p.code = 'accounts.manage' and e.is_active;

  return v_request_id;
end;
$$;

revoke all on function public.app_request_credential_change(text, text, text) from public, anon;
grant execute on function public.app_request_credential_change(text, text, text) to authenticated;
