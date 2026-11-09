-- ============================================================================
-- บัญชี master: บัญชีเดียวเหนือผู้ดูแลระบบ (THTWGOT) สำหรับผู้พัฒนาและทดสอบระบบคนเดียว
--
-- ทำ 4 อย่าง
--   1. employees.is_master: ธงของบัญชี master มีได้บัญชีเดียว (unique index) ตั้งได้จาก migration
--      (ไม่มีผู้ล็อกอิน) เท่านั้น ไม่มี RPC ใดตั้งหรือถอนธงนี้ บัญชีต้องเป็น admin ที่ยังใช้งานอยู่
--      ตั้งให้ THTWGOT ในไฟล์นี้ บทบาทที่ทำหน้าที่ (acting_role_id) ของบัญชีนี้ไม่เปลี่ยน
--   2. ป้องกันบัญชี master จากผู้ดูแลระบบคนอื่น
--      - trigger บน employees: ผู้ล็อกอินที่ไม่ใช่ master แก้ ปิดใช้งาน เปลี่ยนบทบาท/บทบาทที่ทำหน้าที่
--        หรือลบแถวของ master ไม่ได้ (MASTER_PROTECTED) ครอบคลุมทุก RPC ที่เขียน employees
--        รวม app_admin_update_employee, app_admin_set_acting_role, app_admin_delete_employee
--        และ app_apply_account_request
--      - app_admin_target_auth_user (pilot-auth ใช้ก่อนเปลี่ยนรหัสผ่านที่ Supabase Auth),
--        app_admin_record_password, app_reveal_credential และ app_set_module_permission ปฏิเสธเมื่อ
--        เป้าหมายเป็น master และผู้เรียกไม่ใช่ master เอง
--      - ข้อจำกัดที่รู้: คำร้องเปลี่ยนรหัสผ่านที่ master ส่งเอง ผู้ดูแลคนอื่นยังกดอนุมัติได้ เพราะ pilot-auth
--        เปลี่ยนรหัสที่ Supabase Auth ก่อนเรียกฐานข้อมูล (รหัสที่ได้คือรหัสที่ master เลือกเอง) แก้ใน Edge Function แยก
--   3. บันทึกกิจกรรม (audit_logs) อ่านได้เฉพาะ master
--      - เดิม policy audit_read ใช้ audit.view ซึ่ง admin ทุกคนถือ และแถวเก่าของ account_credentials /
--        account_requests เก็บรหัสผ่านไว้ใน metadata (old/new) ตอนนี้ผู้ดูแลคนอื่นจึงอ่านตารางนี้ตรงไม่ได้แล้ว
--      - app_master_activity_log คืนรายการพร้อมชื่อผู้ทำและเฉพาะฟิลด์ที่เปลี่ยน โดยซ่อนค่าของ key ที่ชื่อ
--        เกี่ยวกับรหัสผ่าน/โทเค็น/secret ทุกระดับ (private.redact_secrets) ข้อมูลในตารางไม่ถูกแก้
--      - RPC ของ BOM / RubberFlow (app_bom_audit, app_rf_audit) เป็น security definer จึงไม่กระทบ
--   4. บันทึกข้อผิดพลาดจากการใช้งานจริง (client_error_logs)
--      - Pilot Web ส่งข้อผิดพลาดที่ผู้ใช้เห็นผ่าน app_log_client_error (เขียนได้อย่างเดียว อ่านคืนไม่ได้)
--        จำกัด 30 รายการ / คน / 10 นาที ข้ามรายการซ้ำใน 60 วินาที ตัดความยาว และลบโทเค็น/รหัสผ่านที่
--        อาจติดมาในข้อความ เก็บ 180 วัน
--      - master อ่านผ่าน app_master_client_errors และ app_master_client_error_summary
--      - บัญชี lab-only ส่งข้อผิดพลาดได้ (อยู่ใน private.lab_only_allowed_functions)
--
-- การ apply ขึ้น production: ฟังก์ชันที่ redefine ด้านล่างคัดลอกจากนิยามบน production (ซึ่งมี
-- perform private.lab_only_block() ที่ private.lab_only_guard_functions เติมไว้) เพิ่มเฉพาะบรรทัด
-- private.assert_master_target_allowed ก่อน apply ให้ตรวจว่า md5(pg_get_functiondef(oid)) ยังตรงกับ
--   app_admin_target_auth_user   fd672ab30d277100d5d5c9294fa72b98  (20260917090000_admin_account_editing.sql)
--   app_admin_record_password    b61067a6f878d74282083c218f577bf1  (20260917090000_admin_account_editing.sql)
--   app_reveal_credential        881eac86351b230ccba791015e613711  (20260917070000_account_registration_workflow.sql)
--   app_set_module_permission    08bb338453abc01d86022baa5d29f42f  (20260918060000_approval_module_permissions.sql)
--   private.lab_only_allowed_functions bb559dd270cdb40fd50e21c2f98f5d4e (20261019005000_lab_only_accounts.sql)
--   private.sandbox_unguarded_tables   880bf79142e450607a67952e8e7a9fdb (20261111010000_bom_part_stock.sql)
--
-- Rollback (ไม่มีข้อมูลเดิมถูกแก้ นอกจากธง is_master ของ THTWGOT):
--   1) นำนิยามเดิมของ 4 RPC ข้างบน, policy audit_read (using private.has_permission('audit.view'))
--      และ private.lab_only_allowed_functions กลับมาจากไฟล์ที่ระบุ
--   1b) นำ private.sandbox_unguarded_tables จาก 20261111010000 กลับมา
--   2) drop trigger employees_master_guard, drop function ทั้งหมดที่สร้างในไฟล์นี้
--   3) drop table public.client_error_logs; alter table public.employees drop column is_master
-- ============================================================================

-- 1. ธง master ------------------------------------------------------------------
alter table public.employees add column if not exists is_master boolean not null default false;
create unique index if not exists employees_single_master_idx on public.employees (is_master) where is_master;
comment on column public.employees.is_master is
  'บัญชี master (มีได้บัญชีเดียว) ตั้งได้จาก migration เท่านั้น ผู้ดูแลระบบคนอื่นแก้หรือลบบัญชีนี้ไม่ได้';

-- ผู้ล็อกอินอยู่เป็นบัญชี master ที่ยังใช้งานอยู่หรือไม่
create or replace function private.is_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = (select auth.uid())
      and e.is_active
      and e.is_master
  )
$$;
revoke all on function private.is_master() from public, anon;
grant execute on function private.is_master() to authenticated;

create or replace function private.assert_master()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.is_master() then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_master() from public, anon, authenticated;

-- เป้าหมายเป็น master และผู้เรียกไม่ใช่ master เอง → ปฏิเสธ
create or replace function private.assert_master_target_allowed(p_employee_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.employees e
    where e.id = p_employee_id
      and e.is_master
      and e.id is distinct from private.current_employee_id()
  ) then
    raise exception 'MASTER_PROTECTED' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.assert_master_target_allowed(uuid) from public, anon, authenticated;

-- 2. ป้องกันแถวของ master --------------------------------------------------------
-- ไม่มีผู้ล็อกอิน (auth.uid() is null) = migration หรือ service role → ตั้ง/ถอนธงได้
-- ลบแถว master ไม่ได้ในทุกกรณี ต้องถอนธงก่อน
create or replace function private.guard_master_employee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_master then
      raise exception 'MASTER_PROTECTED' using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.is_master and auth.uid() is not null then
      raise exception 'MASTER_PROTECTED' using errcode = '42501';
    end if;
  else
    if new.is_master is distinct from old.is_master and auth.uid() is not null then
      raise exception 'MASTER_PROTECTED' using errcode = '42501';
    end if;
    if old.is_master and auth.uid() is not null
       and private.current_employee_id() is distinct from old.id then
      raise exception 'MASTER_PROTECTED' using errcode = '42501';
    end if;
  end if;

  if new.is_master and (
    not new.is_active
    or new.deleted_at is not null
    or not exists (select 1 from public.roles r where r.id = new.role_id and r.code = 'admin')
  ) then
    raise exception 'MASTER_MUST_BE_ACTIVE_ADMIN' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_master_employee() from public, anon, authenticated;

drop trigger if exists employees_master_guard on public.employees;
create trigger employees_master_guard
before insert or update or delete on public.employees
for each row execute function private.guard_master_employee();

update public.employees e
set is_master = true
where e.employee_no = 'THTWGOT'
  and e.is_active
  and e.deleted_at is null
  and not e.is_test
  and exists (select 1 from public.roles r where r.id = e.role_id and r.code = 'admin');

-- ถ้ามีบัญชี THTWGOT แต่ตั้งธงไม่ได้ (ไม่ใช่ admin / ปิดใช้งาน / บัญชีทดสอบ) ให้ migration ล้ม
-- เพราะหลังไฟล์นี้ audit_logs อ่านได้เฉพาะ master — ฐานข้อมูล local/CI ไม่มีบัญชีนี้จึงผ่านไปเฉย ๆ
do $$
begin
  if exists (select 1 from public.employees where employee_no = 'THTWGOT')
     and not exists (select 1 from public.employees where employee_no = 'THTWGOT' and is_master) then
    raise exception 'THTWGOT exists but is not an active admin, so it cannot become the master account';
  end if;
end;
$$;

-- 2.1 RPC บัญชีที่แตะ Supabase Auth / คลังรหัสผ่าน: นิยามจาก production + private.assert_master_target_allowed
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
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.has_permission('accounts.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  perform private.assert_master_target_allowed(p_employee_id);

  select auth_user_id into v_auth_user_id from public.employees where id = p_employee_id;
  if v_auth_user_id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  return v_auth_user_id;
end;
$$;
revoke all on function public.app_admin_target_auth_user(uuid) from public, anon;
grant execute on function public.app_admin_target_auth_user(uuid) to authenticated;

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
  perform private.lab_only_block();
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
  perform private.assert_master_target_allowed(p_employee_id);
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
  perform private.lab_only_block();
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
  perform private.assert_master_target_allowed(p_employee_id);

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

-- สิทธิ์อนุมัติตามโมดูลของ master (เขียน approval_module_permissions ไม่ผ่าน trigger ของ employees)
create or replace function public.app_set_module_permission(p_employee_id uuid, p_request_type_id uuid, p_granted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_actor
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_actor.id is null or not private.has_permission('approvals.manage') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  perform private.assert_master_target_allowed(p_employee_id);

  if not exists (select 1 from public.employees where id = p_employee_id) then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  if not exists (select 1 from public.request_types where id = p_request_type_id) then
    raise exception 'REQUEST_TYPE_NOT_FOUND';
  end if;

  if coalesce(p_granted, false) then
    insert into public.approval_module_permissions (employee_id, request_type_id, granted_by)
    values (p_employee_id, p_request_type_id, v_actor.id)
    on conflict (employee_id, request_type_id) do nothing;
  else
    delete from public.approval_module_permissions
    where employee_id = p_employee_id and request_type_id = p_request_type_id;
  end if;
end;
$$;
revoke all on function public.app_set_module_permission(uuid, uuid, boolean) from public, anon;
grant execute on function public.app_set_module_permission(uuid, uuid, boolean) to authenticated;

-- หน้าเว็บถามว่าบัญชีที่ล็อกอินเป็น master หรือไม่ (ใช้แค่เลือกว่าจะแสดงเมนู สิทธิ์จริงตรวจในทุก RPC)
create or replace function public.app_am_i_master()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_master()
$$;
revoke all on function public.app_am_i_master() from public, anon;
grant execute on function public.app_am_i_master() to authenticated;

-- 3. บันทึกกิจกรรม: อ่านได้เฉพาะ master ---------------------------------------------
drop policy if exists audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated
using ((select private.is_master()));

-- ชื่อ key ที่ถือเป็นความลับ (รหัสผ่าน/โทเค็น/secret)
create or replace function private.is_secret_key(p_key text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_key ~* '(password|passwd|secret|token|otp|hash|api_?key|credential|service_role)', false)
$$;
revoke all on function private.is_secret_key(text) from public, anon, authenticated;

-- ซ่อนค่าของ key ที่เกี่ยวกับรหัสผ่าน/โทเค็น/secret ทุกระดับของ jsonb (ชื่อ key ยังเห็นว่ามีการเปลี่ยน)
create or replace function private.redact_secrets(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_result jsonb;
  v_key text;
  v_item jsonb;
begin
  if p_value is null then
    return null;
  end if;
  if jsonb_typeof(p_value) = 'object' then
    v_result := '{}'::jsonb;
    for v_key, v_item in select e.key, e.value from jsonb_each(p_value) as e loop
      if private.is_secret_key(v_key) then
        v_result := v_result || jsonb_build_object(v_key, '[ซ่อน]');
      else
        v_result := v_result || jsonb_build_object(v_key, private.redact_secrets(v_item));
      end if;
    end loop;
    return v_result;
  end if;
  if jsonb_typeof(p_value) = 'array' then
    select coalesce(jsonb_agg(private.redact_secrets(t.item) order by t.ord), '[]'::jsonb)
    into v_result
    from jsonb_array_elements(p_value) with ordinality as t(item, ord);
    return v_result;
  end if;
  return p_value;
end;
$$;
revoke all on function private.redact_secrets(jsonb) from public, anon, authenticated;

-- UPDATE: เฉพาะฟิลด์ที่เปลี่ยน {field: {old, new}} (เทียบจากค่าจริง ฟิลด์ลับที่เปลี่ยนจึงยังขึ้นว่าเปลี่ยน
-- แต่ค่าเป็น "[ซ่อน]") · INSERT/DELETE: แถวทั้งแถว · อื่น ๆ: metadata
create or replace function private.audit_changes(p_action text, p_metadata jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_action = 'UPDATE'
         and jsonb_typeof(p_metadata -> 'old') = 'object'
         and jsonb_typeof(p_metadata -> 'new') = 'object' then (
      select coalesce(jsonb_object_agg(
               k.key,
               case
                 when private.is_secret_key(k.key) then jsonb_build_object('old', '[ซ่อน]', 'new', '[ซ่อน]')
                 else jsonb_build_object(
                   'old', private.redact_secrets(p_metadata -> 'old' -> k.key),
                   'new', private.redact_secrets(p_metadata -> 'new' -> k.key))
               end), '{}'::jsonb)
      from (
        select key from jsonb_object_keys(p_metadata -> 'old') as key
        union
        select key from jsonb_object_keys(p_metadata -> 'new') as key
      ) k
      where k.key <> 'updated_at'
        and (p_metadata -> 'old' -> k.key) is distinct from (p_metadata -> 'new' -> k.key)
    )
    when p_action = 'INSERT' and jsonb_typeof(p_metadata -> 'new') = 'object' then private.redact_secrets(p_metadata -> 'new')
    when p_action = 'DELETE' and jsonb_typeof(p_metadata -> 'old') = 'object' then private.redact_secrets(p_metadata -> 'old')
    else private.redact_secrets(p_metadata)
  end
$$;
revoke all on function private.audit_changes(text, jsonb) from public, anon, authenticated;

create or replace function private.try_uuid(p_value text)
returns uuid
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid
  end
$$;
revoke all on function private.try_uuid(text) from public, anon, authenticated;

-- วันที่กรองเป็นวันตามเวลาไทย (p_to รวมทั้งวัน) · เรียงใหม่ไปเก่า · หน้าถัดไปส่ง p_before_id = id ตัวสุดท้าย
create or replace function public.app_master_activity_log(
  p_before_id bigint default null,
  p_limit integer default 100,
  p_actor_id uuid default null,
  p_entity_type text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  id bigint,
  created_at timestamptz,
  actor_id uuid,
  actor_no text,
  actor_name text,
  action text,
  entity_type text,
  entity_id text,
  entity_label text,
  request_id uuid,
  changes jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.lab_only_block();
  perform private.assert_master();

  return query
  select
    a.id,
    a.created_at,
    a.actor_id,
    e.employee_no,
    nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''),
    a.action,
    a.entity_type,
    a.entity_id,
    coalesce(
      a.metadata -> 'new' ->> 'request_no', a.metadata -> 'old' ->> 'request_no',
      a.metadata -> 'new' ->> 'ncr_no', a.metadata -> 'old' ->> 'ncr_no',
      a.metadata -> 'new' ->> 'employee_no', a.metadata -> 'old' ->> 'employee_no',
      a.metadata ->> 'request_no', a.metadata ->> 'ncr_no', a.metadata ->> 'employee_no',
      a.metadata ->> 'persona_employee_no'
    ),
    case
      when a.entity_type = 'requests' then private.try_uuid(a.entity_id)
      else private.try_uuid(coalesce(a.metadata -> 'new' ->> 'request_id', a.metadata -> 'old' ->> 'request_id'))
    end,
    private.audit_changes(a.action, a.metadata)
  from public.audit_logs a
  left join public.employees e on e.id = a.actor_id
  where (p_before_id is null or a.id < p_before_id)
    and (p_actor_id is null or a.actor_id = p_actor_id)
    and (p_entity_type is null or a.entity_type = p_entity_type)
    and (p_from is null or a.created_at >= (p_from::timestamp at time zone 'Asia/Bangkok'))
    and (p_to is null or a.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok'))
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;
revoke all on function public.app_master_activity_log(bigint, integer, uuid, text, date, date) from public, anon;
grant execute on function public.app_master_activity_log(bigint, integer, uuid, text, date, date) to authenticated;

-- ตัวเลือกของตัวกรอง: ประเภทรายการและผู้ทำที่มีอยู่ในบันทึก พร้อมจำนวน
create or replace function public.app_master_activity_facets()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entity_types jsonb;
  v_actors jsonb;
begin
  perform private.lab_only_block();
  perform private.assert_master();

  select coalesce(jsonb_agg(jsonb_build_object('entity_type', t.entity_type, 'count', t.n) order by t.n desc), '[]'::jsonb)
  into v_entity_types
  from (select a.entity_type, count(*) as n from public.audit_logs a group by a.entity_type) t;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', t.actor_id, 'employee_no', e.employee_no,
           'name', nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''), 'count', t.n)
         order by e.employee_no), '[]'::jsonb)
  into v_actors
  from (select a.actor_id, count(*) as n from public.audit_logs a where a.actor_id is not null group by a.actor_id) t
  join public.employees e on e.id = t.actor_id;

  return jsonb_build_object('entity_types', v_entity_types, 'actors', v_actors);
end;
$$;
revoke all on function public.app_master_activity_facets() from public, anon;
grant execute on function public.app_master_activity_facets() to authenticated;

-- 4. บันทึกข้อผิดพลาดจากการใช้งานจริง -------------------------------------------------
create table if not exists public.client_error_logs (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- ตั้งใจไม่มี foreign key: app_admin_delete_employee นับทุก FK ที่ชี้มา employees เป็น "ประวัติ"
  -- ถ้ามี FK พนักงานที่เคยเจอข้อผิดพลาดแม้ครั้งเดียวจะถูกลบถาวรไม่ได้อีก (ชื่อผู้ใช้ join แบบ left join)
  employee_id uuid,
  kind text not null check (kind in ('js', 'promise', 'rpc', 'network', 'ui')),
  code text check (char_length(code) <= 80),
  message text not null check (char_length(message) between 1 and 1000),
  page text check (char_length(page) <= 200),
  detail text check (char_length(detail) <= 4000),
  app_version text check (char_length(app_version) <= 60),
  user_agent text check (char_length(user_agent) <= 300),
  is_sandbox boolean not null default false
);
create index if not exists client_error_logs_created_idx on public.client_error_logs (created_at desc);
create index if not exists client_error_logs_employee_idx on public.client_error_logs (employee_id, created_at desc);
alter table public.client_error_logs enable row level security;
revoke all on public.client_error_logs from public, anon, authenticated;
-- ไม่มี policy อนุญาตใด ๆ: ผู้ล็อกอินอ่าน/เขียนตารางตรงไม่ได้ ใช้ RPC ด้านล่างเท่านั้น
select private.lab_only_guard_table('public.client_error_logs'::regclass);

-- ลบโทเค็น/รหัสผ่านที่อาจติดมาในข้อความ แล้วตัดความยาว
create or replace function private.scrub_client_text(p_value text, p_max integer)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          trim(coalesce(p_value, '')),
          'eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+', '[token]', 'g'),
        '(password|passwd|token|secret|apikey|api_key|authorization)(["'']?\s*[:=]\s*["'']?)[^\s"'',;&]+', '\1\2[ซ่อน]', 'gi'),
      '[A-Za-z0-9+/_-]{40,}={0,2}', '[…]', 'g'),
    p_max), '')
$$;
revoke all on function private.scrub_client_text(text, integer) from public, anon, authenticated;

create or replace function public.app_log_client_error(
  p_kind text,
  p_message text,
  p_code text default null,
  p_page text default null,
  p_detail text default null,
  p_app_version text default null,
  p_user_agent text default null,
  p_is_sandbox boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_kind text;
  v_message text;
  v_page text;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    return;
  end if;

  v_message := private.scrub_client_text(p_message, 1000);
  if v_message is null then
    return;
  end if;
  v_kind := case when p_kind in ('js', 'promise', 'rpc', 'network', 'ui') then p_kind else 'ui' end;
  v_page := private.scrub_client_text(p_page, 200);

  -- จำกัดจำนวนต่อคน และข้ามรายการซ้ำที่เพิ่งส่งมา
  if (select count(*) from public.client_error_logs l
      where l.employee_id = v_employee_id and l.created_at > now() - interval '10 minutes') >= 30 then
    return;
  end if;
  if exists (
    select 1 from public.client_error_logs l
    where l.employee_id = v_employee_id
      and l.created_at > now() - interval '60 seconds'
      and l.message = v_message
      and l.page is not distinct from v_page
  ) then
    return;
  end if;

  insert into public.client_error_logs (employee_id, kind, code, message, page, detail, app_version, user_agent, is_sandbox)
  values (
    v_employee_id, v_kind,
    private.scrub_client_text(p_code, 80),
    v_message,
    v_page,
    private.scrub_client_text(p_detail, 4000),
    private.scrub_client_text(p_app_version, 60),
    private.scrub_client_text(p_user_agent, 300),
    coalesce(p_is_sandbox, false)
  );

  -- เก็บ 180 วัน: ลบของเก่าทีละไม่เกิน 200 แถวต่อการเรียก
  delete from public.client_error_logs l
  where l.id in (
    select o.id from public.client_error_logs o
    where o.created_at < now() - interval '180 days'
    order by o.id
    limit 200
  );
end;
$$;
revoke all on function public.app_log_client_error(text, text, text, text, text, text, text, boolean) from public, anon;
grant execute on function public.app_log_client_error(text, text, text, text, text, text, text, boolean) to authenticated;

create or replace function public.app_master_client_errors(
  p_before_id bigint default null,
  p_limit integer default 100,
  p_employee_id uuid default null,
  p_kind text default null,
  p_from date default null,
  p_to date default null
)
returns table (
  id bigint,
  created_at timestamptz,
  employee_id uuid,
  employee_no text,
  employee_name text,
  kind text,
  code text,
  message text,
  page text,
  detail text,
  app_version text,
  user_agent text,
  is_sandbox boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.lab_only_block();
  perform private.assert_master();

  return query
  select l.id, l.created_at, l.employee_id, e.employee_no,
         nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''),
         l.kind, l.code, l.message, l.page, l.detail, l.app_version, l.user_agent, l.is_sandbox
  from public.client_error_logs l
  left join public.employees e on e.id = l.employee_id
  where (p_before_id is null or l.id < p_before_id)
    and (p_employee_id is null or l.employee_id = p_employee_id)
    and (p_kind is null or l.kind = p_kind)
    and (p_from is null or l.created_at >= (p_from::timestamp at time zone 'Asia/Bangkok'))
    and (p_to is null or l.created_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok'))
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
end;
$$;
revoke all on function public.app_master_client_errors(bigint, integer, uuid, text, date, date) from public, anon;
grant execute on function public.app_master_client_errors(bigint, integer, uuid, text, date, date) to authenticated;

-- ปัญหาที่เกิดบ่อยในช่วง p_days วันล่าสุด รวมตามชนิด + รหัส + ข้อความ
create or replace function public.app_master_client_error_summary(p_days integer default 7)
returns table (
  kind text,
  code text,
  message text,
  occurrences bigint,
  people bigint,
  pages text[],
  first_at timestamptz,
  last_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  perform private.lab_only_block();
  perform private.assert_master();

  return query
  select l.kind, l.code, l.message,
         count(*),
         count(distinct l.employee_id),
         (array_agg(distinct l.page) filter (where l.page is not null))[1:5],
         min(l.created_at),
         max(l.created_at)
  from public.client_error_logs l
  where l.created_at > now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 180))
  group by l.kind, l.code, l.message
  order by count(*) desc, max(l.created_at) desc
  limit 50;
end;
$$;
revoke all on function public.app_master_client_error_summary(integer) from public, anon;
grant execute on function public.app_master_client_error_summary(integer) to authenticated;

-- โหมดทดสอบ: ข้อผิดพลาดที่เกิดในโหมดทดสอบยังบันทึกได้ (แยกด้วย is_sandbox) จึงไม่ติด sandbox_guard
-- เหมือน audit_logs (นิยามจาก 20261111010000_bom_part_stock.sql + 'client_error_logs')
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- บัญชี lab-only ต้องรายงานข้อผิดพลาดและถามสถานะ master ได้ (นิยามจาก 20261019005000 + 2 ชื่อ)
create or replace function private.lab_only_allowed_functions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'app_my_approval_modules',
    'app_update_own_profile', 'app_update_own_photo', 'app_request_credential_change',
    'app_am_i_master', 'app_log_client_error'
  ]
$$;
revoke all on function private.lab_only_allowed_functions() from public, anon, authenticated;
