-- Admin เพิ่มบัญชีเองและลบบัญชีได้จากหน้าผู้ดูแลระบบ
--
-- เพิ่มบัญชี: app_admin_create_account_request สร้างคำร้องเปิดบัญชีในนามผู้ดูแล (ตรวจสิทธิ์ accounts.manage)
--   จากนั้น Edge Function pilot-auth สร้างบัญชี Auth และเรียก app_apply_account_request ตัวเดิม
--   ทางเดียวกับการอนุมัติคำร้องปกติ — คำร้องที่อนุมัติแล้วเป็นหลักฐานว่าใครสร้างบัญชีเมื่อไร
--
-- ลบบัญชี: app_admin_delete_employee
--   * ไม่มีประวัติเลย (ไม่ถูกอ้างอิงจากคำร้อง ขั้นอนุมัติ ความเห็น ไฟล์แนบ audit log ฯลฯ) → ลบแถวถาวร
--   * มีประวัติ → เก็บแถวไว้ให้เอกสารเก่ายังแสดงชื่อได้ แต่ปิดใช้งาน ซ่อนจากรายการ และตัดบัญชีล็อกอิน
--   ตาราง "ของบัญชีเอง" ที่ไม่ถือเป็นประวัติ (ลบตามได้): คลังรหัสผ่าน สิทธิ์อนุมัติตามโมดูล บัญชี LINE
--   แจ้งเตือนที่ส่งถึงคนนี้ โทเค็นตั้งรหัสผ่าน และลิงก์ employee_id ในคำร้องเปิดบัญชี
--   ตารางอื่นที่อ้างถึง employees ทุกตาราง (รวมที่จะเพิ่มในอนาคต) นับเป็นประวัติโดยอัตโนมัติ
--
-- Rollback: drop function app_admin_create_account_request / app_admin_delete_employee,
--   คืน app_list_credentials / app_admin_update_employee จาก 20260919000000 แล้ว drop column deleted_at, deleted_by
--   (แถวที่ถูกลบถาวรไปแล้วกู้คืนไม่ได้ ดูรายการได้จาก audit_logs action = 'DELETE_EMPLOYEE')

alter table public.employees
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.employees(id) on delete set null;

create index if not exists employees_deleted_by_idx on public.employees(deleted_by) where deleted_by is not null;

-- 1. สร้างคำร้องเปิดบัญชีในนามผู้ดูแลระบบ (ยังเป็น pending จนกว่า pilot-auth จะสร้างบัญชี Auth แล้วอนุมัติ)
create or replace function public.app_admin_create_account_request(
  p_employee_no text,
  p_password text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_job_title text,
  p_department_id uuid,
  p_role_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_employee_no text;
  v_email text;
  v_phone text;
  v_request_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active and deleted_at is null
  limit 1;
  if v_actor.id is null or not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_employee_no := upper(trim(coalesce(p_employee_no, '')));
  if v_employee_no !~ '^[A-Z0-9][A-Z0-9.-]{2,31}$' then
    raise exception 'INVALID_EMPLOYEE_NO';
  end if;
  if char_length(coalesce(p_password, '')) not between 8 and 72 then
    raise exception 'INVALID_PASSWORD';
  end if;
  if char_length(trim(coalesce(p_first_name, ''))) not between 1 and 100
     or char_length(trim(coalesce(p_last_name, ''))) not between 1 and 100 then
    raise exception 'INVALID_NAME';
  end if;
  v_email := lower(trim(coalesce(p_email, '')));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or char_length(v_email) > 200 then
    raise exception 'INVALID_EMAIL';
  end if;
  v_phone := trim(coalesce(p_phone, ''));
  if v_phone !~ '^[0-9+\-\s]+$' or char_length(regexp_replace(v_phone, '\D', '', 'g')) < 9
     or char_length(v_phone) > 40 then
    raise exception 'INVALID_PHONE';
  end if;
  if not exists (select 1 from public.departments d where d.id = p_department_id and d.is_active) then
    raise exception 'DEPARTMENT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.roles r where r.id = p_role_id) then
    raise exception 'INVALID_POSITION';
  end if;
  if exists (select 1 from public.employees e where e.employee_no = v_employee_no) then
    raise exception 'EMPLOYEE_NO_TAKEN';
  end if;
  if exists (select 1 from public.employees e where lower(e.email) = v_email) then
    raise exception 'EMAIL_TAKEN';
  end if;
  if exists (
    select 1 from public.account_requests ar
    where ar.employee_no = v_employee_no and ar.status = 'pending'
  ) then
    raise exception 'REQUEST_ALREADY_PENDING';
  end if;

  insert into public.account_requests (
    kind, employee_no, first_name, last_name, email, phone, department_id,
    desired_role_id, job_title, desired_password, reason
  ) values (
    'new_account', v_employee_no, trim(p_first_name), trim(p_last_name), v_email, v_phone,
    p_department_id, p_role_id, nullif(trim(coalesce(p_job_title, '')), ''), p_password,
    'สร้างโดยผู้ดูแลระบบ ' || v_actor.employee_no
  ) returning id into v_request_id;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor.id, 'ADMIN_CREATE_ACCOUNT_REQUEST', 'account_requests', v_request_id::text,
    jsonb_build_object('employee_no', v_employee_no)
  );

  return v_request_id;
end;
$$;

revoke all on function public.app_admin_create_account_request(text, text, text, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.app_admin_create_account_request(text, text, text, text, text, text, text, uuid, uuid) to authenticated;

-- 2. ลบบัญชี: ลบถาวรเมื่อไม่มีประวัติ ไม่เช่นนั้นเก็บไว้แบบปิดใช้งานและซ่อน
--    คืน mode ('deleted' | 'archived') และ auth_user_id เดิม ให้ pilot-auth ลบบัญชีล็อกอินต่อ
create or replace function public.app_admin_delete_employee(p_employee_id uuid)
returns table (mode text, auth_user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_target public.employees%rowtype;
  v_ref record;
  v_found boolean;
  v_has_history boolean := false;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select * into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.deleted_at is null
  limit 1;
  if v_actor.id is null or not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_target
  from public.employees e
  where e.id = p_employee_id and e.deleted_at is null
  for update;
  if v_target.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if v_target.id = v_actor.id then
    raise exception 'CANNOT_DELETE_SELF';
  end if;

  -- ไล่ทุก foreign key ที่ชี้มาที่ employees ยกเว้นตารางที่เป็นของบัญชีนี้เอง
  for v_ref in
    select c.conrelid::regclass::text as table_name, a.attname::text as column_name
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.employees'::regclass
      and (c.conrelid::regclass::text, a.attname::text) not in (
        ('public.account_credentials', 'employee_id'),
        ('public.approval_module_permissions', 'employee_id'),
        ('public.line_accounts', 'employee_id'),
        ('public.notifications', 'recipient_id'),
        ('public.password_setup_tokens', 'employee_id'),
        ('public.account_requests', 'employee_id')
      )
  loop
    if v_ref.table_name = 'public.employees' then
      execute format('select exists (select 1 from public.employees where %I = $1 and id <> $1)', v_ref.column_name)
        into v_found using v_target.id;
    else
      execute format('select exists (select 1 from %s where %I = $1)', v_ref.table_name, v_ref.column_name)
        into v_found using v_target.id;
    end if;
    if v_found then
      v_has_history := true;
      exit;
    end if;
  end loop;

  if v_has_history then
    update public.employees
    set is_active = false,
        deleted_at = now(),
        deleted_by = v_actor.id,
        auth_user_id = null
    where id = v_target.id;
    delete from public.account_credentials where employee_id = v_target.id;
    delete from public.approval_module_permissions where employee_id = v_target.id;
    delete from public.line_accounts where employee_id = v_target.id;
    delete from public.password_setup_tokens where employee_id = v_target.id;
  else
    update public.account_requests set employee_id = null where employee_id = v_target.id;
    delete from public.employees where id = v_target.id;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor.id,
    case when v_has_history then 'ARCHIVE_EMPLOYEE' else 'DELETE_EMPLOYEE' end,
    'employees', v_target.id::text,
    jsonb_build_object(
      'employee_no', v_target.employee_no,
      'full_name', v_target.first_name || ' ' || v_target.last_name,
      'email', v_target.email
    )
  );

  return query select case when v_has_history then 'archived' else 'deleted' end, v_target.auth_user_id;
end;
$$;

revoke all on function public.app_admin_delete_employee(uuid) from public, anon;
grant execute on function public.app_admin_delete_employee(uuid) to authenticated;

-- 3. คลัง ID/รหัสผ่าน ไม่แสดงบัญชีที่ถูกลบ
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
    and e.deleted_at is null
  order by e.employee_no
$$;

revoke all on function public.app_list_credentials() from public, anon;
grant execute on function public.app_list_credentials() to authenticated;

-- 4. แก้ไข/เปิดใช้งานบัญชีที่ถูกลบไม่ได้
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

  -- บัญชีที่ถูกลบ (เก็บไว้เพื่อประวัติ) แก้ไขหรือเปิดใช้งานกลับไม่ได้
  select * into v_target from public.employees where id = p_employee_id and deleted_at is null for update;
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
