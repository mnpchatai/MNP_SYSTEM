-- Account registration workflow.
--
-- พนักงานส่งคำร้องขอเปิดบัญชี (ID/รหัสผ่าน) ได้เองจากหน้า Login โดยยังไม่มี
-- สิทธิ์ใด ๆ ในระบบ จากนั้น Admin เป็นผู้กดอนุมัติและกำหนดสิทธิ์ ระบบจึงสร้าง
-- บัญชีจริงให้ ผู้ใช้ที่มีบัญชีแล้วส่งคำร้องขอแก้ไข ID/รหัสผ่านได้เช่นกัน
--
-- ID และรหัสผ่านที่ออกให้ถูกเก็บไว้ใน public.account_credentials เพื่อให้ Admin
-- ค้นคืนได้เมื่อผู้ใช้ลืม ทั้งสองตารางนี้ถูกปิดการเข้าถึงตรงทั้งหมด (deny-all RLS
-- + ไม่มี grant ให้ anon/authenticated) อ่านได้ผ่าน RPC ที่ตรวจสิทธิ์เท่านั้น และ
-- การเปิดดูรหัสผ่านทุกครั้งถูกบันทึกลง audit_logs

-- 1. แผนกตามผังจริงของโรงงาน ชื่อภาษาไทยใช้ตัวย่อไปก่อนและแก้ภายหลังได้
insert into public.departments (code, name_th, name_en) values
  ('RB', 'RB', 'RB'),
  ('GR', 'GR', 'GR'),
  ('BG', 'BG', 'BG'),
  ('PT', 'PT', 'PT'),
  ('PK', 'PK', 'PK'),
  ('QA', 'QA', 'QA'),
  ('ST', 'ST', 'ST'),
  ('WH', 'WH', 'WH'),
  ('SR', 'SR', 'SR'),
  ('FT', 'FT', 'FT'),
  ('AD', 'AD', 'AD')
on conflict (code) do nothing;

-- 2. ระดับตำแหน่งในแผนก
do $$
begin
  if not exists (select 1 from pg_type where typname = 'position_level') then
    create type public.position_level as enum ('department_head', 'assistant_head', 'staff');
  end if;
  if not exists (select 1 from pg_type where typname = 'account_request_kind') then
    create type public.account_request_kind as enum ('new_account', 'credential_change');
  end if;
  if not exists (select 1 from pg_type where typname = 'account_request_status') then
    create type public.account_request_status as enum ('pending', 'approved', 'rejected');
  end if;
end;
$$;

alter table public.employees
  add column if not exists position_level public.position_level;

-- 3. คำร้องขอเปิดบัญชี / ขอแก้ไข ID-รหัสผ่าน
create table if not exists public.account_requests (
  id uuid primary key default gen_random_uuid(),
  kind public.account_request_kind not null,
  employee_id uuid references public.employees(id) on delete set null,
  employee_no text not null check (employee_no ~ '^[A-Z0-9][A-Z0-9.-]{2,31}$'),
  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text,
  phone text,
  department_id uuid references public.departments(id),
  position_level public.position_level,
  job_title text,
  desired_password text check (char_length(desired_password) between 8 and 72),
  reason text check (reason is null or char_length(reason) <= 1000),
  status public.account_request_status not null default 'pending',
  reviewed_by uuid references public.employees(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_requests_status_idx on public.account_requests(status, created_at);
create index if not exists account_requests_employee_idx on public.account_requests(employee_id)
  where employee_id is not null;
create index if not exists account_requests_department_idx on public.account_requests(department_id)
  where department_id is not null;
create index if not exists account_requests_reviewed_by_idx on public.account_requests(reviewed_by)
  where reviewed_by is not null;

-- คำร้องค้างได้ครั้งละหนึ่งใบต่อรหัสพนักงานหนึ่งรหัส
create unique index if not exists account_requests_pending_employee_no_idx
  on public.account_requests(employee_no)
  where status = 'pending';

-- 4. คลัง ID/รหัสผ่านที่ออกให้ สำหรับกรณีผู้ใช้ลืม
create table if not exists public.account_credentials (
  employee_id uuid primary key references public.employees(id) on delete cascade,
  username text not null unique,
  password text not null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists account_credentials_updated_by_idx on public.account_credentials(updated_by)
  where updated_by is not null;

drop trigger if exists account_requests_touch on public.account_requests;
create trigger account_requests_touch before update on public.account_requests
for each row execute function private.touch_updated_at();

drop trigger if exists account_credentials_touch on public.account_credentials;
create trigger account_credentials_touch before update on public.account_credentials
for each row execute function private.touch_updated_at();

-- audit ครอบคลุมทั้งสองตาราง แต่ไม่บันทึกค่ารหัสผ่านลง metadata
create or replace function private.audit_account_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  v_new := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;
  if v_old ? 'desired_password' then v_old := v_old || jsonb_build_object('desired_password', null); end if;
  if v_new ? 'desired_password' then v_new := v_new || jsonb_build_object('desired_password', null); end if;
  if v_old ? 'password' then v_old := v_old || jsonb_build_object('password', null); end if;
  if v_new ? 'password' then v_new := v_new || jsonb_build_object('password', null); end if;

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
  values (
    private.current_employee_id(),
    tg_op,
    tg_table_name,
    coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'),
             (to_jsonb(new)->>'employee_id'), (to_jsonb(old)->>'employee_id')),
    jsonb_build_object('old', v_old, 'new', v_new)
  );
  return coalesce(new, old);
end;
$$;

revoke all on function private.audit_account_row_change() from public, anon, authenticated;

drop trigger if exists account_requests_audit on public.account_requests;
create trigger account_requests_audit after insert or update or delete on public.account_requests
for each row execute function private.audit_account_row_change();

drop trigger if exists account_credentials_audit on public.account_credentials;
create trigger account_credentials_audit after insert or update or delete on public.account_credentials
for each row execute function private.audit_account_row_change();

-- 5. ปิดการเข้าถึงตรงทั้งหมด เข้าถึงได้เฉพาะผ่าน RPC ที่ตรวจสิทธิ์
revoke all on public.account_requests from anon, authenticated;
revoke all on public.account_credentials from anon, authenticated;
alter table public.account_requests enable row level security;
alter table public.account_credentials enable row level security;

drop policy if exists account_requests_no_direct_access on public.account_requests;
create policy account_requests_no_direct_access on public.account_requests
for all to authenticated using (false) with check (false);

drop policy if exists account_credentials_no_direct_access on public.account_credentials;
create policy account_credentials_no_direct_access on public.account_credentials
for all to authenticated using (false) with check (false);

-- 6. สิทธิ์ใหม่สำหรับผู้ดูแลระบบ
insert into public.permissions (code, description)
values ('accounts.manage', 'Review account requests and recover issued credentials')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r, public.permissions p
where r.code = 'admin' and p.code = 'accounts.manage'
on conflict do nothing;

-- 7. ระดับตำแหน่ง -> บทบาทเริ่มต้นที่ Admin ปรับได้ตอนอนุมัติ
create or replace function private.default_role_for_position(p_position public.position_level)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select r.id
  from public.roles r
  where r.code = case
    when p_position in ('department_head', 'assistant_head') then 'approver'
    else 'employee'
  end
  limit 1
$$;

revoke all on function private.default_role_for_position(public.position_level) from public, anon, authenticated;

-- 8. ผู้ใช้ที่มีบัญชีแล้วขอแก้ไข ID/รหัสผ่านของตนเอง
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
    department_id, position_level, job_title, desired_password, reason
  ) values (
    'credential_change', v_employee.id, v_employee_no, v_employee.first_name,
    v_employee.last_name, v_employee.email, v_employee.phone,
    v_employee.department_id, v_employee.position_level, v_employee.job_title,
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

-- 9. Admin: รายการคำร้อง (ไม่คืนค่ารหัสผ่าน)
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
  position_level public.position_level,
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
         a.email, a.phone, a.department_id, d.code, d.name_th, a.position_level,
         a.job_title, a.reason, a.status,
         case when r.id is null then null else r.first_name || ' ' || r.last_name end,
         a.reviewed_at, a.review_note, a.created_at
  from public.account_requests a
  left join public.departments d on d.id = a.department_id
  left join public.employees r on r.id = a.reviewed_by
  where private.has_permission('accounts.manage')
    and (p_status is null or a.status = p_status)
  order by case when a.status = 'pending' then 0 else 1 end, a.created_at desc
$$;

revoke all on function public.app_list_account_requests(public.account_request_status) from public, anon;
grant execute on function public.app_list_account_requests(public.account_request_status) to authenticated;

-- 10. Admin: อนุมัติคำร้อง (Edge Function สร้างบัญชี auth แล้วส่ง auth_user_id เข้ามา)
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

    v_role_id := coalesce(p_role_id, private.default_role_for_position(v_request.position_level));
    if v_role_id is null then
      raise exception 'ROLE_NOT_FOUND';
    end if;
    v_email := coalesce(
      nullif(trim(coalesce(v_request.email, '')), ''),
      lower(v_request.employee_no) || '@pilot.mnp.local'
    );

    insert into public.employees (
      auth_user_id, employee_no, first_name, last_name, email, phone,
      job_title, department_id, role_id, position_level
    ) values (
      p_auth_user_id, v_request.employee_no, v_request.first_name, v_request.last_name,
      v_email, v_request.phone, v_request.job_title, v_request.department_id,
      v_role_id, v_request.position_level
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

-- 11. Admin: ไม่อนุมัติคำร้อง
create or replace function public.app_reject_account_request(
  p_request_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_request public.account_requests%rowtype;
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

  update public.account_requests
  set status = 'rejected',
      reviewed_by = v_actor.id,
      reviewed_at = now(),
      review_note = nullif(left(trim(coalesce(p_note, '')), 1000), ''),
      desired_password = null
  where id = v_request.id;

  if v_request.employee_id is not null then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_request.employee_id, null, 'คำร้องเกี่ยวกับบัญชีไม่ได้รับอนุมัติ',
      coalesce(nullif(trim(coalesce(p_note, '')), ''), 'กรุณาติดต่อผู้ดูแลระบบ'),
      '/profile'
    );
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_reject_account_request(uuid, text) from public, anon;
grant execute on function public.app_reject_account_request(uuid, text) to authenticated;

-- 12. Admin: คลัง ID/รหัสผ่าน รหัสผ่านถูกปิดไว้จนกว่าจะกดเปิดดูรายคน
create or replace function public.app_list_credentials()
returns table (
  employee_id uuid,
  employee_no text,
  username text,
  full_name text,
  department_code text,
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
         d.code, r.code, e.position_level, e.is_active,
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

-- 13. Admin: เปิดดูรหัสผ่านหนึ่งรายการ ทุกครั้งถูกบันทึกลง audit_logs
create or replace function public.app_reveal_credential(p_employee_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_password text;
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

  select * into v_target from public.employees where id = p_employee_id;
  select nullif(password, '') into v_password
  from public.account_credentials
  where employee_id = p_employee_id;
  if v_password is null then
    raise exception 'CREDENTIAL_NOT_FOUND';
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_actor.id, 'REVEAL_CREDENTIAL', 'account_credentials', p_employee_id::text,
    jsonb_build_object('employee_no', v_target.employee_no)
  );

  return v_password;
end;
$$;

revoke all on function public.app_reveal_credential(uuid) from public, anon;
grant execute on function public.app_reveal_credential(uuid) to authenticated;

-- บัญชีที่สร้างไว้ก่อนหน้านี้จะยังไม่มีรหัสผ่านในคลัง เพราะ Supabase Auth เก็บเป็น
-- hash และย้อนกลับไม่ได้ คลังจะแสดงสถานะว่ายังไม่มีรหัสผ่านบันทึกไว้ ผู้ใช้ต้องส่ง
-- คำร้องขอแก้ไขรหัสผ่านหนึ่งครั้งจึงจะกู้คืนให้ได้ในภายหลัง
