-- จัดโมดูล "ใบคำร้องถึงฝ่ายบริหาร" (request_types.code = 'MANAGEMENT') ให้ตรงกับฟอร์มกระดาษ
-- PP01-FM08 Rev.00 (14-11-24) ที่ใช้งานจริงในโรงงาน มี 3 การเปลี่ยนแปลงหลัก:
--
--   1) สายอนุมัติของฟอร์มจริงคือ ฝ่ายบริหารโรงงาน -> ผู้จัดการทั่วไป (ดูจากช่องลงนามสองช่อง
--      ในส่วนที่ 2) ไม่ใช่ "หัวหน้าแผนกผู้แจ้ง -> ผู้จัดการแผนกเจ้าของโมดูล" ที่ระบบใช้อยู่เดิม
--      (ผ่าน requires_manager_approval + final_approver_role_id) จึงเพิ่มคอลัมน์
--      uses_factory_general_chain แล้วให้ทั้ง app_create_request (RPC ของ Pilot Web) และ
--      createRequestAction (Server Action ของเว็บ Next.js) แตกสายอนุมัติแบบเดียวกับที่
--      MT_REPAIR ใช้อยู่แล้วใน 20260921080000_repair_approval_chain_factory_then_general_manager.sql
--   2) ส่วนที่ 3 ของฟอร์ม "สำเนาถึงแผนก" เป็น checkbox 23 แผนก + อื่นๆ ต้องมีที่เก็บข้อมูลนี้
--      เพิ่มคอลัมน์ requests.cc_department_ids (ตรวจความถูกต้องที่ชั้นแอป/RPC เพราะ Postgres
--      ไม่มี foreign key บน element ของ array โดยตรง)
--   3) ฟอร์มมีแผนกที่ยังไม่มีในตาราง departments อีก 9 รหัส (PP, MS, PC, BD, SE, AC, EX, SP, SA)

-- 1. แผนกที่ฟอร์มอ้างถึงแต่ยังไม่มีในระบบ — ตั้งชื่อเป็นตัวย่อไปก่อนตามรูปแบบเดียวกับ
--    20260917070000_account_registration_workflow.sql เพราะฟอร์มต้นฉบับก็ไม่มีคำเต็มกำกับ
--    ยกเว้น FT ที่ฟอร์มเขียนชื่อเต็มไว้ตรงๆ ว่า "ธุรการ FT" จึงแก้ชื่อให้ถูกต้องได้เลย
insert into public.departments (code, name_th, name_en) values
  ('PP', 'PP', 'PP'),
  ('MS', 'MS', 'MS'),
  ('PC', 'PC', 'PC'),
  ('BD', 'BD', 'BD'),
  ('SE', 'SE', 'SE'),
  ('AC', 'AC', 'AC'),
  ('EX', 'EX', 'EX'),
  ('SP', 'SP', 'SP'),
  ('SA', 'SA', 'SA')
on conflict (code) do nothing;

update public.departments
set name_th = 'ธุรการ', name_en = 'General Affairs'
where code = 'FT';

-- 2. สายอนุมัติคงที่ + สำเนาถึงแผนก
alter table public.request_types
  add column if not exists uses_factory_general_chain boolean not null default false;

alter table public.requests
  add column if not exists cc_department_ids uuid[] not null default '{}'::uuid[];

update public.request_types
set
  uses_factory_general_chain = true,
  -- เดิม form_schema อ้าง required_date/business_reason ซึ่งไม่ตรงกับฟอร์มจริง (มีแค่ เรื่อง /
  -- สิ่งที่แนบมาด้วย / รายละเอียด ซึ่ง เรื่อง กับ รายละเอียด ใช้ title/description เดิมอยู่แล้ว
  -- เหลือแค่ "สิ่งที่แนบมาด้วย" ที่ต้องมีช่องเพิ่ม)
  form_schema = '{"fields":["attachment_note"]}'::jsonb
where code = 'MANAGEMENT';

-- ผจก.โรงงาน/ผจก.ทั่วไป ที่ active อยู่วันนี้ ต้องมีสิทธิ์โมดูล MANAGEMENT ไว้กดอนุมัติได้ทันที
-- (ให้ผลเหมือน step 4 ของ 20260921080000 แต่เจาะจงเฉพาะโมดูลนี้ เผื่อมีคนถือ role นี้เพิ่ม
-- เข้ามาหลัง migration นั้น)
insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
select e.id, t.id, null::uuid
from public.employees e
join public.roles r on r.id = e.role_id
cross join public.request_types t
where e.is_active
  and t.code = 'MANAGEMENT'
  and r.code in ('factory_manager', 'general_manager')
on conflict do nothing;

-- 3. app_create_request (Pilot Web) — เพิ่มพารามิเตอร์ cc_department_ids และแตกสายอนุมัติ
--    ตาม uses_factory_general_chain เหมือน app_create_repair_request
drop function if exists public.app_create_request(uuid, text, text, text, jsonb);

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

    if v_step >= 1 then
      select approver_role_id into v_final_role
      from public.approval_steps
      where request_id = v_request.id and step_order = 1;

      insert into public.notifications (recipient_id, request_id, title, body, action_url)
      select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
             v_request.request_no || ' · ' || v_request.title,
             '/requests/' || v_request.id::text
      from public.employees e
      where e.role_id = v_final_role
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
        where e.role_id = v_final_role
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

-- 4. app_approval_decision — เพิ่มมติ "รับทราบ" เป็นสถานะปิดคำร้องแบบ terminal เหมือน rejected
--    (ไม่ไปต่อขั้นถัดไป) ตรรกะส่วนที่เหลือเหมือนเดิมทุกประการ (คัดลอกจาก 20260921080000)
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
