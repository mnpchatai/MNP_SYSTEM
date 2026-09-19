-- รวม "ตำแหน่งในแผนก" (position_level) กับ "บทบาท/สิทธิ์" (roles) เป็น field เดียว
--
-- ก่อนหน้านี้ระบบมี 2 field แยกกันที่สร้างความสับสน: position_level (หัวหน้าแผนก/
-- ผู้ช่วยหัวหน้าแผนก/พนักงานทั่วไป) เป็นแค่ label ไม่ผูกสิทธิ์โดยตรง ส่วน role_id
-- ต่างหากเป็นตัวกำหนดสิทธิ์จริง จากนี้ไปตำแหน่งคือ role_id โดยตรง มีแค่ 6 ตำแหน่ง:
--   ผู้จัดการทั่วไป, ผู้จัดการโรงงาน, ผู้ช่วยผู้จัดการโรงงาน, ผู้จัดการแผนก,
--   พนักงานทั่วไป, ผู้ดูแลระบบ
--
-- กลยุทธ์: เปลี่ยนชื่อ role เดิม 3 ตัวที่ยังใช้ได้ (คง id เดิมไว้ ไม่กระทบ FK ใดๆ
-- ทั้ง employees.role_id, approval_steps.approver_role_id,
-- request_types.final_approver_role_id ที่อ้างถึงอยู่แล้ว) แล้วเพิ่มอีก 2 ตำแหน่งใหม่
-- employee -> staff (พนักงานทั่วไป), approver -> department_manager (ผู้จัดการแผนก),
-- operator -> assistant_factory_manager (ผู้ช่วยผู้จัดการโรงงาน, ได้สิทธิ์อนุมัติเพิ่ม)
-- admin คงเดิมทุกอย่าง

-- 1. เปลี่ยนชื่อ 3 ตำแหน่งเดิม (คง id เดิม)
update public.roles set code = 'staff', name_th = 'พนักงานทั่วไป',
  description = 'สร้างและติดตามคำร้องของตนเอง'
where id = '20000000-0000-0000-0000-000000000001';

update public.roles set code = 'department_manager', name_th = 'ผู้จัดการแผนก',
  description = 'อนุมัติคำร้องของแผนกตนเอง/หน่วยงานที่รับผิดชอบ'
where id = '20000000-0000-0000-0000-000000000002';

update public.roles set code = 'assistant_factory_manager', name_th = 'ผู้ช่วยผู้จัดการโรงงาน',
  description = 'อนุมัติและดำเนินงานข้ามแผนกในขอบเขตปฏิบัติการของโรงงาน'
where id = '20000000-0000-0000-0000-000000000003';

update public.roles set description = 'จัดการข้อมูลหลัก สิทธิ์ และตรวจสอบระบบ'
where id = '20000000-0000-0000-0000-000000000004';

-- 2. เพิ่ม 2 ตำแหน่งใหม่ที่ไม่เคยมีมาก่อน
insert into public.roles (id, code, name_th, description) values
  ('20000000-0000-0000-0000-000000000005', 'factory_manager', 'ผู้จัดการโรงงาน',
    'เห็นและดำเนินการคำร้องได้ทุกใบในโรงงาน'),
  ('20000000-0000-0000-0000-000000000006', 'general_manager', 'ผู้จัดการทั่วไป',
    'เห็นและดำเนินการคำร้องได้ทุกใบทั้งองค์กร')
on conflict (id) do nothing;

-- 3. ลำดับการแสดงผล ตามลำดับที่ผู้ใช้กำหนด (สูง -> ต่ำ, admin ไว้ท้ายสุดเพราะเป็น
--    บทบาทเชิงระบบไม่ใช่ลำดับขั้นในองค์กร) — เพิ่มคอลัมน์ใหม่ตามแบบแผนเดิมของระบบ
--    (departments/request_types/machines ก็มี sort_order ให้ UI เรียงตามนี้แทน code)
alter table public.roles add column if not exists sort_order integer not null default 0;

update public.roles set sort_order = case code
  when 'general_manager' then 10
  when 'factory_manager' then 20
  when 'assistant_factory_manager' then 30
  when 'department_manager' then 40
  when 'staff' then 50
  when 'admin' then 60
  else 100
end;

-- 4. สิทธิ์ของตำแหน่งใหม่/ที่เปลี่ยนความหมาย
--    department_manager (เดิม approver) และ staff (เดิม employee) สิทธิ์ไม่เปลี่ยน
--    assistant_factory_manager (เดิม operator) เพิ่ม approvals.act เพราะยกระดับจาก
--    "ผู้ปฏิบัติงาน" เป็นตำแหน่งบริหารระดับโรงงาน ควรอนุมัติได้ด้วยไม่ใช่แค่ดำเนินงาน
insert into public.role_permissions (role_id, permission_id)
select '20000000-0000-0000-0000-000000000003', p.id
from public.permissions p
where p.code = 'approvals.act'
on conflict do nothing;

-- factory_manager และ general_manager: มองเห็น/ดำเนินการคำร้องได้ทุกใบ (requests.view_all
-- ทำให้ RPC ทุกตัว bypass เช็คแผนก/สิทธิ์โมดูลเหมือน admin) บวกอนุมัติและดำเนินงานได้ด้วย
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.code in ('factory_manager', 'general_manager')
  and p.code in ('requests.create', 'approvals.act', 'requests.operate', 'requests.view_all')
on conflict do nothing;

-- 5. เตรียม account_requests ให้เก็บ "ตำแหน่งที่ขอ" เป็น role_id โดยตรงแทน position_level
alter table public.account_requests
  add column if not exists desired_role_id uuid references public.roles(id);

-- ย้ายคำร้องที่ยังค้างอยู่ (ถ้ามี) ไปตำแหน่งที่ใกล้เคียงที่สุด Admin ยังเลือกอื่นแทนได้
-- ตอนกดอนุมัติอยู่แล้วผ่านช่อง "ตำแหน่งที่ให้" จึงไม่กระทบความถูกต้องของการอนุมัติจริง
update public.account_requests a
set desired_role_id = case a.position_level::text
  when 'department_head' then '20000000-0000-0000-0000-000000000002'::uuid
  when 'assistant_head' then '20000000-0000-0000-0000-000000000002'::uuid
  else '20000000-0000-0000-0000-000000000001'::uuid
end
where a.desired_role_id is null and a.status = 'pending';

-- 6. ลบฟังก์ชัน/ลายเซ็นเดิมที่อ้าง position_level ก่อนแก้ไขให้ตรงกับโครงสร้างใหม่
drop function if exists public.app_admin_update_employee(
  uuid, text, text, text, text, text, text, uuid, public.position_level, uuid, boolean
);
drop function if exists public.app_list_account_requests(public.account_request_status);
drop function if exists public.app_list_credentials();
drop function if exists private.default_role_for_position(public.position_level);

-- 7. ผู้ใช้ที่มีบัญชีแล้วขอแก้ไข ID/รหัสผ่าน — เก็บ role ปัจจุบันแทน position_level
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
  join public.role_permissions rp on rp.role_id = e.role_id
  join public.permissions p on p.id = rp.permission_id
  where p.code = 'accounts.manage' and e.is_active;

  return v_request_id;
end;
$$;

revoke all on function public.app_request_credential_change(text, text, text) from public, anon;
grant execute on function public.app_request_credential_change(text, text, text) to authenticated;

-- 8. Admin: รายการคำร้อง — คืนตำแหน่งที่ขอเป็นชื่อ role แทน position_level
create or replace function public.app_list_account_requests(
  p_status public.account_request_status default null
)
returns table (
  id uuid,
  kind public.account_request_kind,
  employee_id uuid,
  employee_no text,
  first_name text,
  last_name text,
  email text,
  phone text,
  department_id uuid,
  department_code text,
  department_name text,
  desired_role_id uuid,
  desired_role_code text,
  desired_role_name text,
  job_title text,
  reason text,
  status public.account_request_status,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.kind, a.employee_id, a.employee_no, a.first_name, a.last_name,
         a.email, a.phone, a.department_id, d.code, d.name_th,
         a.desired_role_id, dr.code, dr.name_th,
         a.job_title, a.reason, a.status,
         case when rv.id is null then null else rv.first_name || ' ' || rv.last_name end,
         a.reviewed_at, a.review_note, a.created_at
  from public.account_requests a
  left join public.departments d on d.id = a.department_id
  left join public.roles dr on dr.id = a.desired_role_id
  left join public.employees rv on rv.id = a.reviewed_by
  where private.has_permission('accounts.manage')
    and (p_status is null or a.status = p_status)
  order by case when a.status = 'pending' then 0 else 1 end, a.created_at desc
$$;

revoke all on function public.app_list_account_requests(public.account_request_status) from public, anon;
grant execute on function public.app_list_account_requests(public.account_request_status) to authenticated;

-- 9. Admin: อนุมัติคำร้อง — ใช้ desired_role_id แทน default_role_for_position(position_level)
create or replace function public.app_apply_account_request(
  p_request_id uuid,
  p_auth_user_id uuid default null,
  p_role_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_request public.account_requests%rowtype;
  v_employee public.employees%rowtype;
  v_role_id uuid;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_actor.id is null or not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_request
  from public.account_requests
  where id = p_request_id
  for update;
  if v_request.id is null or v_request.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING';
  end if;

  if v_request.kind = 'new_account' then
    if p_auth_user_id is null then
      raise exception 'AUTH_USER_REQUIRED';
    end if;
    if exists (select 1 from public.employees e where e.employee_no = v_request.employee_no) then
      raise exception 'EMPLOYEE_NO_TAKEN';
    end if;
    if v_request.department_id is null then
      raise exception 'DEPARTMENT_REQUIRED';
    end if;

    v_role_id := coalesce(p_role_id, v_request.desired_role_id);
    if v_role_id is null then
      raise exception 'ROLE_NOT_FOUND';
    end if;
    v_email := coalesce(
      nullif(trim(coalesce(v_request.email, '')), ''),
      lower(v_request.employee_no) || '@pilot.mnp.local'
    );

    insert into public.employees (
      auth_user_id, employee_no, first_name, last_name, email, phone,
      job_title, department_id, role_id
    ) values (
      p_auth_user_id, v_request.employee_no, v_request.first_name, v_request.last_name,
      v_email, v_request.phone, v_request.job_title, v_request.department_id,
      v_role_id
    ) returning * into v_employee;
  else
    select * into v_employee
    from public.employees
    where id = v_request.employee_id
    for update;
    if v_employee.id is null then
      raise exception 'EMPLOYEE_NOT_FOUND';
    end if;
    if v_request.employee_no <> v_employee.employee_no then
      if exists (select 1 from public.employees e where e.employee_no = v_request.employee_no) then
        raise exception 'EMPLOYEE_NO_TAKEN';
      end if;
      update public.employees
      set employee_no = v_request.employee_no
      where id = v_employee.id;
    end if;
    if p_role_id is not null and p_role_id <> v_employee.role_id then
      update public.employees set role_id = p_role_id where id = v_employee.id;
    end if;
  end if;

  if v_request.desired_password is null then
    raise exception 'PASSWORD_MISSING';
  end if;

  insert into public.account_credentials (employee_id, username, password, updated_by)
  values (v_employee.id, v_request.employee_no, v_request.desired_password, v_actor.id)
  on conflict (employee_id) do update
    set username = excluded.username,
        password = excluded.password,
        updated_by = excluded.updated_by;

  update public.account_requests
  set status = 'approved',
      employee_id = v_employee.id,
      reviewed_by = v_actor.id,
      reviewed_at = now(),
      desired_password = null
  where id = v_request.id;

  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  values (
    v_employee.id, null,
    case when v_request.kind = 'new_account' then 'บัญชีของคุณได้รับการอนุมัติ'
         else 'คำร้องแก้ไข ID/รหัสผ่านได้รับการอนุมัติ' end,
    'ใช้รหัสพนักงาน ' || v_request.employee_no || ' เข้าสู่ระบบได้ทันที',
    '/profile'
  );

  return v_employee.id;
end;
$$;

revoke all on function public.app_apply_account_request(uuid, uuid, uuid) from public, anon;
grant execute on function public.app_apply_account_request(uuid, uuid, uuid) to authenticated;

-- 10. Admin: คลัง ID/รหัสผ่าน — ตัด position_level ออกจากผลลัพธ์
create or replace function public.app_list_credentials()
returns table (
  employee_id uuid,
  employee_no text,
  username text,
  full_name text,
  first_name text,
  last_name text,
  email text,
  phone text,
  job_title text,
  department_id uuid,
  department_code text,
  role_id uuid,
  role_code text,
  is_active boolean,
  has_password boolean,
  updated_at timestamptz,
  updated_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.employee_no, c.username, e.first_name || ' ' || e.last_name,
         e.first_name, e.last_name, e.email, e.phone, e.job_title,
         e.department_id, d.code, e.role_id, r.code, e.is_active,
         coalesce(c.password, '') <> '', c.updated_at,
         case when u.id is null then null else u.first_name || ' ' || u.last_name end
  from public.employees e
  left join public.account_credentials c on c.employee_id = e.id
  left join public.departments d on d.id = e.department_id
  left join public.roles r on r.id = e.role_id
  left join public.employees u on u.id = c.updated_by
  where private.has_permission('accounts.manage')
  order by e.employee_no
$$;

revoke all on function public.app_list_credentials() from public, anon;
grant execute on function public.app_list_credentials() to authenticated;

-- 11. Admin แก้ไขข้อมูลพนักงาน — ตัดพารามิเตอร์ position_level ออก (ตำแหน่ง = role_id แล้ว)
create or replace function public.app_admin_update_employee(
  p_employee_id uuid,
  p_employee_no text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_job_title text default null,
  p_department_id uuid default null,
  p_role_id uuid default null,
  p_is_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
  v_employee_no text;
  v_email text;
  v_role_id uuid;
  v_department_id uuid;
  v_keeps_manage boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_actor.id is null or not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_target from public.employees where id = p_employee_id for update;
  if v_target.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  v_employee_no := upper(trim(coalesce(p_employee_no, '')));
  if v_employee_no !~ '^[A-Z0-9][A-Z0-9.-]{2,31}$' then
    raise exception 'INVALID_EMPLOYEE_NO';
  end if;
  if char_length(trim(coalesce(p_first_name, ''))) not between 1 and 100
     or char_length(trim(coalesce(p_last_name, ''))) not between 1 and 100 then
    raise exception 'INVALID_NAME';
  end if;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then
    v_email := lower(v_employee_no) || '@pilot.mnp.local';
  end if;

  if exists (
    select 1 from public.employees e
    where e.id <> v_target.id and e.employee_no = v_employee_no
  ) then
    raise exception 'EMPLOYEE_NO_TAKEN';
  end if;
  if exists (
    select 1 from public.employees e
    where e.id <> v_target.id and lower(e.email) = v_email
  ) then
    raise exception 'EMAIL_TAKEN';
  end if;

  v_role_id := coalesce(p_role_id, v_target.role_id);
  v_department_id := coalesce(p_department_id, v_target.department_id);
  if not exists (select 1 from public.roles r where r.id = v_role_id) then
    raise exception 'ROLE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.departments d where d.id = v_department_id) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;

  -- กันผู้ดูแลระบบถอดสิทธิ์หรือปิดบัญชีของตนเองจนไม่มีใครเข้าไปแก้ได้อีก
  if v_target.id = v_actor.id then
    select exists (
      select 1
      from public.role_permissions rp
      join public.permissions p on p.id = rp.permission_id
      where rp.role_id = v_role_id and p.code = 'accounts.manage'
    ) into v_keeps_manage;
    if not coalesce(p_is_active, true) or not v_keeps_manage then
      raise exception 'CANNOT_DEMOTE_SELF';
    end if;
  end if;

  update public.employees
  set employee_no = v_employee_no,
      first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      email = v_email,
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      job_title = nullif(trim(coalesce(p_job_title, '')), ''),
      department_id = v_department_id,
      role_id = v_role_id,
      is_active = coalesce(p_is_active, true)
  where id = v_target.id;

  update public.account_credentials
  set username = v_employee_no
  where employee_id = v_target.id;

  return v_target.id;
end;
$$;

revoke all on function public.app_admin_update_employee(uuid, text, text, text, text, text, text, uuid, uuid, boolean) from public, anon;
grant execute on function public.app_admin_update_employee(uuid, text, text, text, text, text, text, uuid, uuid, boolean) to authenticated;

-- 12. ตัด position_level ออกจากทั้งสองตาราง แล้วลบ type ที่ไม่มีใครใช้แล้ว
alter table public.employees drop column if exists position_level;
alter table public.account_requests drop column if exists position_level;
drop type if exists public.position_level;
