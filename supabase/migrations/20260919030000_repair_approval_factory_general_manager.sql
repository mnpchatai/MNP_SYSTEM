-- ลำดับอนุมัติใบแจ้งซ่อมใหม่: ผู้จัดการโรงงาน → ผู้จัดการทั่วไป
--
-- เดิมใบแจ้งซ่อม (request_types.uses_repair_workflow) ใช้โครงอนุมัติ "แบบปกติ" ชุดเดียวกับ
-- คำร้องทั่วไป คือ
--   ขั้นที่ 1 "หัวหน้าแผนก"                 (requests.requester → employees.manager_id)
--   ขั้นที่ 2 "ผู้อนุมัติหน่วยงานรับผิดชอบ"   (request_types.final_approver_role_id + owning_department_id)
-- ซึ่งไม่ตรงกับของจริงในระบบแจ้งซ่อม MT เดิมที่ใช้ผู้อนุมัติสองระดับคือ ผจก.โรงงาน แล้วต่อด้วย
-- ผจก.ทั่วไป (สถานะ PENDING_FM → PENDING_GM) ไมเกรชันนี้จึง
--   1. เพิ่มบทบาท factory_manager (ผู้จัดการโรงงาน) และ general_manager (ผู้จัดการทั่วไป)
--   2. เปลี่ยน app_create_repair_request ให้สร้างขั้นอนุมัติเป็น ผจก.โรงงาน → ผจก.ทั่วไป
--   3. ยกเลิกขั้น "หัวหน้าแผนก" และ "ผู้อนุมัติหน่วยงานรับผิดชอบ" ออกจากใบแจ้งซ่อม
--      (คำร้องประเภทอื่นที่ยังเดินผ่าน app_create_request ใช้โครงเดิมไม่เปลี่ยนแปลง)
--
-- ใบที่สร้างไว้ก่อนไมเกรชันนี้ยังคงขั้นอนุมัติเดิมของตัวเองไว้ทั้งหมด เพื่อไม่ให้ประวัติการอนุมัติ
-- ที่เกิดขึ้นจริงถูกเขียนทับ — ลำดับใหม่มีผลกับใบที่สร้างหลังจากนี้

-- 1. บทบาทผู้อนุมัติสองระดับของใบแจ้งซ่อม
insert into public.roles (id, code, name_th, description)
values
  ('20000000-0000-0000-0000-000000000005', 'factory_manager', 'ผู้จัดการโรงงาน',
   'อนุมัติใบแจ้งซ่อมขั้นที่ 1 ในระดับโรงงาน'),
  ('20000000-0000-0000-0000-000000000006', 'general_manager', 'ผู้จัดการทั่วไป',
   'อนุมัติใบแจ้งซ่อมขั้นที่ 2 ซึ่งเป็นขั้นสุดท้าย')
on conflict (code) do update
set name_th = excluded.name_th,
    description = excluded.description;

-- 2. สิทธิ์พื้นฐานของทั้งสองบทบาท: สร้างคำร้องของตัวเองได้ และกดอนุมัติได้
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code in ('factory_manager', 'general_manager')
  and p.code in ('requests.create', 'approvals.act')
on conflict do nothing;

-- 3. สิทธิ์อนุมัติรายโมดูล (approval_module_permissions) ของ ผจก.โรงงาน/ผจก.ทั่วไป
--
-- app_approval_decision และ RLS ต้องการให้ผู้อนุมัติแบบผูกกับบทบาทมีสิทธิ์โมดูลนั้นด้วย ถ้าไม่มี
-- แถวสิทธิ์ ผู้จัดการจะมองไม่เห็นใบที่รอตัวเองอยู่เลย ซึ่งเป็นกับดักที่มองไม่ออกจากหน้าจอ จึงให้
-- สิทธิ์โมดูลที่เปิดใช้งานทั้งหมดแก่ผู้ถือบทบาทผู้จัดการโดยอัตโนมัติ (Admin ยังถอดออกทีหลังได้
-- ผ่านหน้าจัดการสิทธิ์อนุมัติเหมือนผู้อนุมัติคนอื่น)
create or replace function private.grant_manager_module_permissions(p_employee_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
  select e.id, t.id, null::uuid
  from public.employees e
  join public.roles r on r.id = e.role_id
  cross join public.request_types t
  where e.id = p_employee_id
    and e.is_active
    and t.is_active
    and r.code in ('factory_manager', 'general_manager')
  on conflict do nothing;
$$;

revoke all on function private.grant_manager_module_permissions(uuid) from public, anon, authenticated;

create or replace function private.sync_manager_module_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.grant_manager_module_permissions(new.id);
  return new;
end;
$$;

revoke all on function private.sync_manager_module_permissions() from public, anon, authenticated;

drop trigger if exists employees_manager_module_permissions on public.employees;
create trigger employees_manager_module_permissions
after insert or update of role_id, is_active on public.employees
for each row execute function private.sync_manager_module_permissions();

-- ผู้ถือบทบาทที่มีอยู่แล้ววันนี้ (ถ้ามี) ได้สิทธิ์ทันทีโดยไม่ต้องรอ trigger
select private.grant_manager_module_permissions(e.id)
from public.employees e
join public.roles r on r.id = e.role_id
where r.code in ('factory_manager', 'general_manager') and e.is_active;

-- 4. ข้อมูลประเภทคำร้อง MT_REPAIR ให้ตรงกับลำดับใหม่
--    requires_manager_approval = false เพราะไม่มีขั้น "หัวหน้าแผนก" อีกต่อไป และผู้อนุมัติขั้น
--    สุดท้ายคือ ผจก.ทั่วไป ไม่ใช่ผู้อนุมัติของแผนกซ่อมบำรุง
update public.request_types
set requires_manager_approval = false,
    final_approver_role_id = (select id from public.roles where code = 'general_manager')
where code = 'MT_REPAIR';

-- 5. สร้างใบแจ้งซ่อมด้วยลำดับอนุมัติใหม่
--
--   ขั้นที่ 1 "ผู้จัดการโรงงาน"  → approver_role_id = factory_manager (ไม่จำกัดแผนก)
--   ขั้นที่ 2 "ผู้จัดการทั่วไป"   → approver_role_id = general_manager (ไม่จำกัดแผนก)
--
-- ทั้งสองขั้นผูกกับบทบาทตรงๆ ไม่ผ่าน private.resolve_approval_target เพราะ fallback ของฟังก์ชัน
-- นั้นจะสลับไปใช้บทบาทอื่นเมื่อบทบาทเป้าหมายยังไม่มีผู้ถือ ซึ่งจะทำให้ลำดับที่ตั้งใจไว้เพี้ยนไป
-- เงียบๆ ระหว่างที่ยังไม่ได้ตั้งผู้จัดการ ใบจะไม่ค้างถาวร เพราะบัญชีที่ถือสิทธิ์ requests.view_all
-- (Admin) อนุมัติแทนได้ทุกขั้นอยู่แล้วตามเงื่อนไขใน app_approval_decision
--
-- ตรรกะส่วนที่เหลือ (ตรวจสิทธิ์ผู้แจ้ง แผนก เครื่องจักร เลขที่เอกสาร ประวัติสถานะ) เหมือนเดิมทุก
-- ประการกับไฟล์ 20260918060000_approval_module_permissions.sql
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

  select id into v_factory_role from public.roles where code = 'factory_manager';
  select id into v_general_role from public.roles where code = 'general_manager';

  if v_factory_role is not null then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการโรงงาน', v_factory_role);
    if v_first_role is null then
      v_first_role := v_factory_role;
    end if;
  end if;

  if v_general_role is not null then
    v_step := v_step + 1;
    insert into public.approval_steps (request_id, step_order, step_name, approver_role_id)
    values (v_request.id, v_step, 'ผู้จัดการทั่วไป', v_general_role);
    if v_first_role is null then
      v_first_role := v_general_role;
    end if;
  end if;

  if v_first_role is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    select e.id, v_request.id, 'มีคำร้องรออนุมัติ',
           v_request.request_no || ' · ' || v_request.title,
           '/requests/' || v_request.id::text
    from public.employees e
    where e.role_id = v_first_role
      and e.is_active
      and private.can_approve_module(e.id, v_type.id);
  end if;

  -- ไม่มีขั้นอนุมัติเลย (ยังไม่ได้สร้างบทบาทผู้จัดการทั้งสอง) — ใบแจ้งซ่อมข้ามไป pending_assign
  -- ตรงๆ ต่างจาก app_create_request ที่ข้ามไป approved
  if v_step = 0 then
    update public.requests
    set status = 'pending_assign', current_step = 0
    where id = v_request.id;
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
