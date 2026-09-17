-- Admin แก้ไขบัญชีพนักงานได้ทุกคนและทุกช่อง และผู้ใช้ทั่วไปแก้ข้อมูลส่วนตัวของตนเองได้
--
-- employees ไม่มี grant UPDATE ให้ authenticated และไม่มี policy สำหรับเขียน
-- การแก้ไขทั้งหมดจึงต้องผ่าน RPC ที่ตรวจสิทธิ์ในนี้เท่านั้น
-- แถว employees ถูก audit อยู่แล้วโดย trigger employees_audit

-- 1. คลัง ID/รหัสผ่านต้องคืนข้อมูลให้พอสำหรับฟอร์มแก้ไขของ Admin
drop function if exists public.app_list_credentials();

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
  position_level public.position_level,
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
         e.department_id, d.code, e.role_id, r.code, e.position_level, e.is_active,
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

-- 2. Admin แก้ไขข้อมูลพนักงานคนใดก็ได้ ทุกช่องยกเว้นรหัสผ่านซึ่งต้องผ่าน Auth API
create or replace function public.app_admin_update_employee(
  p_employee_id uuid,
  p_employee_no text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text default null,
  p_job_title text default null,
  p_department_id uuid default null,
  p_position_level public.position_level default null,
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
      position_level = p_position_level,
      role_id = v_role_id,
      is_active = coalesce(p_is_active, true)
  where id = v_target.id;

  update public.account_credentials
  set username = v_employee_no
  where employee_id = v_target.id;

  return v_target.id;
end;
$$;

revoke all on function public.app_admin_update_employee(uuid, text, text, text, text, text, text, uuid, public.position_level, uuid, boolean) from public, anon;
grant execute on function public.app_admin_update_employee(uuid, text, text, text, text, text, text, uuid, public.position_level, uuid, boolean) to authenticated;

-- 3. หา auth user ของเป้าหมายเพื่อให้ Edge Function เปลี่ยนรหัสผ่านได้ หลังตรวจสิทธิ์แล้ว
create or replace function public.app_admin_target_auth_user(p_employee_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth_user_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select auth_user_id into v_auth_user_id from public.employees where id = p_employee_id;
  if v_auth_user_id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  return v_auth_user_id;
end;
$$;

revoke all on function public.app_admin_target_auth_user(uuid) from public, anon;
grant execute on function public.app_admin_target_auth_user(uuid) to authenticated;

-- 4. บันทึกรหัสผ่านที่ Admin ตั้งให้ลงคลัง เรียกหลังเปลี่ยนที่ Auth สำเร็จแล้ว
create or replace function public.app_admin_record_password(
  p_employee_id uuid,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
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
  if char_length(coalesce(p_password, '')) not between 8 and 72 then
    raise exception 'INVALID_PASSWORD';
  end if;

  select * into v_target from public.employees where id = p_employee_id;
  if v_target.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  insert into public.account_credentials (employee_id, username, password, updated_by)
  values (v_target.id, v_target.employee_no, p_password, v_actor.id)
  on conflict (employee_id) do update
    set username = excluded.username,
        password = excluded.password,
        updated_by = excluded.updated_by;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor.id, 'SET_CREDENTIAL', 'account_credentials', v_target.id::text,
    jsonb_build_object('employee_no', v_target.employee_no)
  );

  return v_target.id;
end;
$$;

revoke all on function public.app_admin_record_password(uuid, text) from public, anon;
grant execute on function public.app_admin_record_password(uuid, text) to authenticated;

-- 5. ผู้ใช้ทั่วไปแก้ข้อมูลส่วนตัวของตนเองได้ แต่ไม่รวมแผนก ตำแหน่งในแผนก และบทบาท
--    ซึ่งเป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ จึงยังต้องให้ Admin เป็นผู้แก้
create or replace function public.app_update_own_profile(
  p_first_name text,
  p_last_name text,
  p_email text default null,
  p_phone text default null,
  p_job_title text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_email text;
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
  if char_length(trim(coalesce(p_first_name, ''))) not between 1 and 100
     or char_length(trim(coalesce(p_last_name, ''))) not between 1 and 100 then
    raise exception 'INVALID_NAME';
  end if;

  v_email := lower(nullif(trim(coalesce(p_email, '')), ''));
  if v_email is null then
    v_email := lower(v_employee.email);
  end if;
  if exists (
    select 1 from public.employees e
    where e.id <> v_employee.id and lower(e.email) = v_email
  ) then
    raise exception 'EMAIL_TAKEN';
  end if;

  update public.employees
  set first_name = trim(p_first_name),
      last_name = trim(p_last_name),
      email = v_email,
      phone = nullif(trim(coalesce(p_phone, '')), ''),
      job_title = nullif(trim(coalesce(p_job_title, '')), '')
  where id = v_employee.id;

  return v_employee.id;
end;
$$;

revoke all on function public.app_update_own_profile(text, text, text, text, text) from public, anon;
grant execute on function public.app_update_own_profile(text, text, text, text, text) to authenticated;
