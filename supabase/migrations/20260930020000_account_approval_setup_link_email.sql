-- อีเมลยืนยันการอนุมัติสิทธิ์เข้าระบบ: แนบ ID + ลิงก์ตั้งรหัสผ่านใหม่ (ไม่ส่งรหัสผ่านตัวจริง)
-- และส่งย้อนหลังให้ผู้ที่ได้รับอนุมัติไปแล้ว
--
-- 1) notifications.email_setup_link: ธงบอก Edge Function notify-email ว่าอีเมลของแถวนี้ต้องแนบ
--    ID + ลิงก์ตั้งรหัสผ่านใหม่ ตัวโทเค็นถูกสร้างตอนส่งอีเมลเท่านั้น ไม่เก็บดิบไว้ที่ไหนเลย
-- 2) password_setup_tokens: เก็บเฉพาะ SHA-256 ของโทเค็น + วันหมดอายุ + เวลาที่ใช้ RLS เปิดและไม่มี
--    policy และถอน grant ทั้งหมด เข้าถึงได้เฉพาะ service role (Edge Function) เท่านั้น
-- 3) ฟังก์ชันสำหรับ service role: ตรวจโทเค็น / ใช้โทเค็นแบบ atomic (กันใช้ซ้ำ) / คืนโทเค็นเมื่อเปลี่ยนรหัสไม่สำเร็จ /
--    บันทึกรหัสผ่านที่ตั้งเองลงคลัง account_credentials (คงพฤติกรรมเดิมที่ทุกการเปลี่ยนรหัสผ่านต้องเข้าคลัง)
-- 4) app_apply_account_request: ตั้งธงนี้ตอนอนุมัติ (ตรรกะอื่นคงตาม 20260919000000_unify_position_and_role)
-- 5) ส่งย้อนหลัง: แจ้งเตือนหนึ่งแถวต่อพนักงานที่เคยถูกอนุมัติและยัง active รันซ้ำได้ไม่สร้างซ้ำ
--    อีเมลออกเมื่อ notify-email ไล่คิวรอบถัดไป และข้ามเองถ้าอีเมลผู้รับเป็นค่า placeholder
--
-- Rollback: apply นิยาม app_apply_account_request จาก 20260919000000 อีกครั้ง แล้ว
--   delete from public.notifications where email_setup_link and email_status = 'pending';
--   drop function public.app_peek_password_setup_token(text), public.app_consume_password_setup_token(text),
--     public.app_release_password_setup_token(text), public.app_record_self_set_password(uuid, text);
--   drop table public.password_setup_tokens;
--   alter table public.notifications drop column email_setup_link;

alter table public.notifications
  add column if not exists email_setup_link boolean not null default false;

comment on column public.notifications.email_setup_link is
  'true = notify-email แนบ ID + ลิงก์ตั้งรหัสผ่านใหม่ในอีเมลของแถวนี้ (ไม่ส่งรหัสผ่าน)';

create table if not exists public.password_setup_tokens (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_setup_tokens_employee_idx
  on public.password_setup_tokens(employee_id);

alter table public.password_setup_tokens enable row level security;
revoke all on public.password_setup_tokens from public, anon, authenticated;

-- ตรวจโทเค็นโดยไม่ใช้ (ให้หน้าเว็บแสดง ID ก่อนกรอกรหัสผ่าน) คืนค่าเฉพาะ ID
create or replace function public.app_peek_password_setup_token(p_token_hash text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.employee_no
  from public.password_setup_tokens t
  join public.employees e on e.id = t.employee_id and e.is_active
  where t.token_hash = p_token_hash
    and t.used_at is null
    and t.expires_at > now()
$$;

-- ใช้โทเค็นแบบ atomic: update ... where used_at is null คืนแถวเดียวให้ผู้เรียกที่ชนะเท่านั้น
create or replace function public.app_consume_password_setup_token(p_token_hash text)
returns table (employee_id uuid, employee_no text, auth_user_id uuid)
language sql
security definer
set search_path = ''
as $$
  with used as (
    update public.password_setup_tokens t
    set used_at = now()
    from public.employees e
    where t.token_hash = p_token_hash
      and t.used_at is null
      and t.expires_at > now()
      and e.id = t.employee_id
      and e.is_active
      and e.auth_user_id is not null
    returning t.employee_id, e.employee_no, e.auth_user_id
  )
  select used.employee_id, used.employee_no, used.auth_user_id from used
$$;

-- เปลี่ยนรหัสผ่านที่ Auth ไม่สำเร็จ → คืนโทเค็นให้ผู้ใช้ลองใหม่ได้ด้วยลิงก์เดิม
create or replace function public.app_release_password_setup_token(p_token_hash text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.password_setup_tokens set used_at = null where token_hash = p_token_hash
$$;

-- บันทึกรหัสผ่านที่ผู้ใช้ตั้งเองลงคลัง (เรียกหลังเปลี่ยนที่ Auth สำเร็จ) + audit log (ไม่ใส่รหัสผ่านใน log)
create or replace function public.app_record_self_set_password(p_employee_id uuid, p_password text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if char_length(coalesce(p_password, '')) not between 8 and 72 then
    raise exception 'INVALID_PASSWORD';
  end if;
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  insert into public.account_credentials (employee_id, username, password, updated_by)
  values (v_employee.id, v_employee.employee_no, p_password, v_employee.id)
  on conflict (employee_id) do update
    set username = excluded.username,
        password = excluded.password,
        updated_by = excluded.updated_by;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    v_employee.id, 'SET_PASSWORD_VIA_EMAIL_LINK', 'account_credentials', v_employee.id::text,
    jsonb_build_object('employee_no', v_employee.employee_no)
  );
end;
$$;

revoke all on function public.app_peek_password_setup_token(text) from public, anon, authenticated;
revoke all on function public.app_consume_password_setup_token(text) from public, anon, authenticated;
revoke all on function public.app_release_password_setup_token(text) from public, anon, authenticated;
revoke all on function public.app_record_self_set_password(uuid, text) from public, anon, authenticated;
grant execute on function public.app_peek_password_setup_token(text) to service_role;
grant execute on function public.app_consume_password_setup_token(text) to service_role;
grant execute on function public.app_release_password_setup_token(text) to service_role;
grant execute on function public.app_record_self_set_password(uuid, text) to service_role;

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

  -- email_setup_link: notify-email แนบ ID + ลิงก์ตั้งรหัสผ่านใหม่ (ใช้ครั้งเดียว) ในอีเมลฉบับนี้
  -- ไม่ส่งรหัสผ่านทางอีเมล และไม่ใส่อะไรที่เป็นความลับลง body ของแจ้งเตือน
  insert into public.notifications (recipient_id, request_id, title, body, action_url, email_setup_link)
  values (
    v_employee.id, null,
    case when v_request.kind = 'new_account' then 'บัญชีของคุณได้รับการอนุมัติ'
         else 'คำร้องแก้ไข ID/รหัสผ่านได้รับการอนุมัติ' end,
    'ใช้รหัสพนักงาน ' || v_request.employee_no || ' เข้าสู่ระบบได้ทันที',
    '/profile',
    true
  );

  return v_employee.id;
end;
$$;

-- ส่งย้อนหลัง: พนักงานที่เคยถูกอนุมัติ (คำร้องเปิดบัญชี/แก้ไข ID ที่ approved) และยัง active
insert into public.notifications (recipient_id, request_id, title, body, action_url, email_setup_link)
select e.id, null,
       'บัญชีของคุณได้รับการอนุมัติ (แจ้งยืนยันย้อนหลัง)',
       'ใช้รหัสพนักงาน ' || e.employee_no || ' เข้าสู่ระบบได้ทันที',
       '/profile',
       true
from public.employees e
where e.is_active
  and e.auth_user_id is not null
  and exists (
    select 1 from public.account_requests a
    where a.employee_id = e.id and a.status = 'approved'
  )
  and not exists (
    select 1 from public.notifications n
    where n.recipient_id = e.id and n.email_setup_link
  );
