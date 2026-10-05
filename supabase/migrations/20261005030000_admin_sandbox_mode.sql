-- ============================================================================
-- โหมดทดสอบสำหรับผู้ดูแลระบบ (admin sandbox) — เริ่มที่ NCR
--
-- เป้าหมาย: admin เข้า "โหมดทดสอบ" แล้วใช้ NCR ตามบทบาทต่างๆ ได้ครบทุกขั้นบนฐานข้อมูลเดียวกับของจริง
-- โดยข้อมูลทดสอบ "แยกที่ฐานข้อมูล" ไม่ปนกับของจริง และไม่มีผลกับผู้ใช้จริง (เลขที่เอกสาร แจ้งเตือน
-- อีเมล ตัวเตือนงานค้าง ทะเบียน แดชบอร์ด)
--
-- แนวคิด
--   1) บัญชีทดสอบ (persona) = แถว employees ที่ is_test = true, is_active = false, ไม่มี auth_user_id
--      ล็อกอินไม่ได้ และเพราะ inactive ฟังก์ชันเดิมทุกตัวที่เลือกผู้อนุมัติ/ผู้รับแจ้งเตือนจะข้ามไปเอง
--      (ไม่ต้องแก้ฟังก์ชันของโมดูลอื่น) CHECK constraint บังคับเงื่อนไขนี้ไม่ให้ถูกแก้ภายหลัง
--   2) admin เข้าโหมด = แถวใน sandbox_sessions ชี้ไปที่ persona ที่ทำหน้าที่อยู่ ระหว่างนี้
--      private.ncr_current_employee() คืน persona แทน admin ทุก RPC ของ NCR (ซึ่งเรียกตัวนี้ทุกตัว)
--      จึงทำงานตามบทบาท/แผนกของ persona โดยไม่ต้องแก้ทีละ RPC สถานะตรวจซ้ำทุกครั้งว่ายังเป็น admin
--   3) ข้อมูลแยกด้วย ncr_reports.is_test ที่ trigger ฝั่งฐานข้อมูลกำหนดจากโหมดของผู้ทำรายการ (ไม่รับจาก client)
--      ใบทดสอบเห็น/แก้ได้เฉพาะในโหมดทดสอบ ใบจริงเห็น/แก้ได้เฉพาะนอกโหมดทดสอบ ฝ่าฝืน = SANDBOX_SCOPE_MISMATCH
--   4) เลขที่ใบทดสอบใช้ตัวนับ 'NCR-TEST' และขึ้นต้น TEST-QA… ไม่แตะตัวนับ QAxxx/yy จริง
--   5) private.ncr_audience() (จุดกลางของแจ้งเตือนและตัวเตือนงานค้าง) ไม่คืนผู้รับสำหรับใบทดสอบ
--      จึงไม่มีแจ้งเตือน อีเมล หรือเตือนงานค้างไปถึงใครเลย
--   6) ด่าน fail-closed ทุกตารางที่ยังไม่รู้จักโหมดทดสอบ: ระหว่างที่ admin อยู่ในโหมดทดสอบ การเขียน
--      ตารางเหล่านั้น (requests, employees, notifications ฯลฯ) ถูกปฏิเสธด้วย SANDBOX_MODULE_UNSUPPORTED
--      กันลืมออกจากโหมดแล้วไปสร้างคำร้องจริง และกันโมดูลอื่นเขียนข้อมูลจริงโดยไม่ตั้งใจ
--
-- โมดูลใหม่ในอนาคต: ตารางใหม่ใน public ต้องอยู่ในรายการ private.sandbox_unguarded_tables() (หมายถึง
-- รู้จักโหมดทดสอบแล้ว) หรือเรียก private.sandbox_guard_table('public.<ตาราง>') ไม่เช่นนั้น
-- supabase/tests/database/admin_sandbox_mode.test.sql จะไม่ผ่านใน CI
--
-- ข้อจำกัดของเวอร์ชันนี้
--   * รองรับเฉพาะ NCR การแนบไฟล์ในโหมดทดสอบถูกปิด (ลบไฟล์ใน Storage ด้วย SQL ไม่ได้ จึงไม่ปล่อยให้เกิดไฟล์ค้าง)
--   * audit_logs ยังบันทึกการกระทำในโหมดทดสอบ (ผู้กระทำคือบัญชี admin จริง) เพื่อให้ตรวจย้อนหลังได้
--   * has_permission() และ RLS ของตารางอื่นยังมองเป็นบัญชี admin จริง
--
-- Rollback: drop trigger sandbox_guard จากทุกตาราง, drop trigger *_sandbox_scope ของ ncr_*,
-- drop function public.app_sandbox_* และ private.sandbox_* นำนิยามเดิมของ private.ncr_current_employee,
-- can_access_ncr, can_upload_ncr_attachment, next_ncr_doc_number (20261002020000) และ ncr_audience
-- (20261005010000) กลับมา แล้วลบ persona (employees.is_test) ใบ NCR ที่ is_test, drop table sandbox_sessions
-- และคอลัมน์ is_test (ลบ ncr_reports where is_test ก่อน) ไม่มีข้อมูลจริงถูกแก้
-- ============================================================================

-- 1. คอลัมน์และข้อบังคับ ---------------------------------------------------------
alter table public.employees
  add column is_test boolean not null default false;
alter table public.employees
  add constraint employees_test_persona_inert
  check (not is_test or (not is_active and auth_user_id is null));
comment on column public.employees.is_test is
  'บัญชีทดสอบสำหรับโหมดทดสอบของ admin: ต้อง inactive และไม่มี auth_user_id จึงล็อกอินไม่ได้และไม่ถูกเลือกเป็นผู้อนุมัติ/ผู้รับแจ้งเตือน';

alter table public.ncr_reports
  add column is_test boolean not null default false;
comment on column public.ncr_reports.is_test is
  'ใบทดสอบจากโหมดทดสอบของ admin: trigger กำหนดจากโหมดของผู้ออกใบ ไม่รับจาก client';

create table public.sandbox_sessions (
  admin_auth_user_id uuid primary key references auth.users(id) on delete cascade,
  admin_employee_id uuid not null references public.employees(id) on delete cascade,
  persona_employee_id uuid not null references public.employees(id) on delete cascade,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sandbox_sessions_admin_employee_idx on public.sandbox_sessions(admin_employee_id);
create index sandbox_sessions_persona_idx on public.sandbox_sessions(persona_employee_id);
alter table public.sandbox_sessions enable row level security;
revoke all on public.sandbox_sessions from anon, authenticated;
comment on table public.sandbox_sessions is
  'admin ที่อยู่ในโหมดทดสอบ (1 แถวต่อ admin) เข้าถึงผ่าน app_sandbox_* เท่านั้น';

-- 2. ตัวช่วย (private) -----------------------------------------------------------
-- persona ที่ admin คนปัจจุบันกำลังทำหน้าที่ (NULL ถ้าไม่ได้อยู่ในโหมดทดสอบ)
-- ตรวจซ้ำทุกครั้งว่าบัญชียัง active และยังเป็น admin เมื่อถูกลดสิทธิ์โหมดทดสอบจะหยุดทำงานเอง
create or replace function private.sandbox_persona()
returns public.employees
language sql
stable
security definer
set search_path = ''
as $$
  select p.*
  from public.sandbox_sessions s
  join public.employees a on a.id = s.admin_employee_id and a.auth_user_id = s.admin_auth_user_id and a.is_active
  join public.roles r on r.id = a.role_id and r.code = 'admin'
  join public.employees p on p.id = s.persona_employee_id and p.is_test
  where s.admin_auth_user_id = auth.uid()
$$;
revoke all on function private.sandbox_persona() from public, anon, authenticated;

-- ผู้ดูแลระบบตัวจริง (ไม่ใช่ persona) ใช้กับ app_sandbox_*
create or replace function private.sandbox_admin()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  select * into v_admin
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_admin.id is null or not private.has_permission('accounts.manage')
     or not exists (select 1 from public.roles r where r.id = v_admin.role_id and r.code = 'admin') then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return v_admin;
end;
$$;
revoke all on function private.sandbox_admin() from public, anon, authenticated;

-- ผู้ทำรายการของ NCR: persona (ถ้าอยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานตัวจริง; NULL ถ้าไม่มี (ไม่ raise)
create or replace function private.ncr_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  v_employee := private.sandbox_persona();
  if v_employee.id is not null then
    return v_employee;
  end if;
  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    return null;
  end if;
  return v_employee;
end;
$$;
revoke all on function private.ncr_actor() from public, anon, authenticated;

-- ใบ/แถวที่มี is_test นี้ตรงกับโหมดของผู้ทำรายการหรือไม่ (งานที่ไม่มีผู้ใช้ เช่น cron/service ไม่ถูกจำกัด)
create or replace function private.sandbox_scope_matches(p_is_test boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is null or p_is_test = ((private.sandbox_persona()).id is not null)
$$;
revoke all on function private.sandbox_scope_matches(boolean) from public, anon, authenticated;

-- 3. NCR ใช้ผู้ทำรายการแบบมีโหมดทดสอบ ----------------------------------------------
-- ฟังก์ชันนี้ถูกเรียกต้นทุก app_ncr_* จึงเป็นจุดเดียวที่ทำให้ทั้งขั้นตอนทำงานตามบทบาทของ persona
create or replace function private.ncr_current_employee()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_employee := private.sandbox_persona();
  if v_employee.id is not null then
    return v_employee;
  end if;
  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;
  return v_employee;
end;
$$;

-- ผู้อ่าน NCR ได้ (กฎเดิมทุกข้อ) + ใบต้องอยู่โหมดเดียวกับผู้อ่าน (ใบทดสอบเห็นเฉพาะในโหมดทดสอบ)
-- requests.view_all เป็นสิทธิ์ของบัญชีจริง จึงใช้เฉพาะนอกโหมดทดสอบ
create or replace function private.can_access_ncr(p_ncr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ncr_reports n
    cross join private.ncr_actor() me
    where n.id = p_ncr_id
      and me.id is not null
      and n.is_test = me.is_test
      and (
        n.reporter_id = me.id
        or private.is_qa_department(me.department_id)
        or exists (
          select 1 from public.ncr_responsibilities r
          where r.ncr_id = n.id and r.department_id = me.department_id
        )
        or private.employee_role_code(me.id) in ('factory_manager', 'assistant_factory_manager', 'general_manager')
        or (not me.is_test and private.has_permission('requests.view_all'))
      )
  )
$$;
revoke all on function private.can_access_ncr(uuid) from public, anon;
grant execute on function private.can_access_ncr(uuid) to authenticated;

-- ไม่ให้อัปโหลดไฟล์เข้าใบทดสอบ (กันไฟล์ค้างใน Storage ที่ลบด้วย SQL ไม่ได้)
create or replace function private.can_upload_ncr_attachment(p_ncr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.can_access_ncr(p_ncr_id)
    and exists (
      select 1 from public.ncr_reports n
      where n.id = p_ncr_id and n.status not in ('closed', 'cancelled') and not n.is_test
    )
$$;
revoke all on function private.can_upload_ncr_attachment(uuid) from public, anon;
grant execute on function private.can_upload_ncr_attachment(uuid) to authenticated;

-- เลขที่: โหมดทดสอบใช้ตัวนับแยก 'NCR-TEST' และขึ้นต้น TEST- ตัวนับจริงไม่ขยับ (รูปแบบเลขจริงเหมือนเดิม)
create or replace function private.next_ncr_doc_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_test boolean := (private.sandbox_persona()).id is not null;
  v_next integer;
begin
  insert into public.document_counters (department_code, year_key, last_number)
  values (case when v_test then 'NCR-TEST' else 'NCR' end, v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;
  return case when v_test then 'TEST-' else '' end || 'QA' || lpad(v_next::text, 3, '0') || '/' || v_year;
end;
$$;

-- จุดกลางของแจ้งเตือนและตัวเตือนงานค้าง: ใบทดสอบไม่มีผู้รับ จึงไม่มีอีเมล/กระดิ่ง/เตือนถึงใคร
-- (คัดลอกจาก 20261005010000 เพิ่มเฉพาะเงื่อนไข "not n.is_test")
create or replace function private.ncr_audience(p_ncr_id uuid, p_audience text)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct e.id
  from public.ncr_reports n
  join public.employees e on e.is_active
  join public.roles r on r.id = e.role_id
  where n.id = p_ncr_id
    and not n.is_test
    and case p_audience
      when 'factory' then r.code = 'factory_manager'
      when 'general_manager' then r.code = 'general_manager'
      when 'reporter' then e.id = n.reporter_id
      when 'qa' then private.is_qa_department(e.department_id)
      when 'qa_managers' then private.is_qa_department(e.department_id)
        and r.code in ('department_manager', 'assistant_department_manager')
      when 'responsible_managers' then r.code in ('department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities x
          where x.ncr_id = n.id and x.department_id = e.department_id
        )
      else false
    end
$$;
revoke all on function private.ncr_audience(uuid, text) from public, anon, authenticated;

-- 4. ด่านฝั่งเขียนของ NCR (fail-closed) ------------------------------------------
create or replace function private.ncr_reports_sandbox_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- ใบใหม่ถือโหมดของผู้ออกใบเสมอ ไม่สนค่าที่ client ส่งมา
    if auth.uid() is not null then
      new.is_test := (private.sandbox_persona()).id is not null;
    end if;
    return new;
  end if;
  if not private.sandbox_scope_matches(old.is_test)
     or (tg_op = 'UPDATE' and auth.uid() is not null and new.is_test is distinct from old.is_test) then
    raise exception 'SANDBOX_SCOPE_MISMATCH';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.ncr_reports_sandbox_scope() from public, anon, authenticated;

create trigger ncr_reports_sandbox_scope before insert or update or delete on public.ncr_reports
for each row execute function private.ncr_reports_sandbox_scope();

create or replace function private.ncr_child_sandbox_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_test boolean;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select n.is_test into v_test
  from public.ncr_reports n
  where n.id = case when tg_op = 'DELETE' then old.ncr_id else new.ncr_id end;
  -- ไม่พบใบแม่ = กำลังลบต่อเนื่อง (cascade) จากใบที่ถูกลบไปแล้ว
  if v_test is not null and v_test is distinct from ((private.sandbox_persona()).id is not null) then
    raise exception 'SANDBOX_SCOPE_MISMATCH';
  end if;
  if tg_table_name = 'ncr_attachments' and tg_op <> 'DELETE' and v_test then
    raise exception 'SANDBOX_ATTACHMENT_UNSUPPORTED';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.ncr_child_sandbox_scope() from public, anon, authenticated;

create trigger ncr_responsibilities_sandbox_scope before insert or update or delete on public.ncr_responsibilities
for each row execute function private.ncr_child_sandbox_scope();
create trigger ncr_losses_sandbox_scope before insert or update or delete on public.ncr_losses
for each row execute function private.ncr_child_sandbox_scope();
create trigger ncr_status_history_sandbox_scope before insert or update or delete on public.ncr_status_history
for each row execute function private.ncr_child_sandbox_scope();
create trigger ncr_attachments_sandbox_scope before insert or update or delete on public.ncr_attachments
for each row execute function private.ncr_child_sandbox_scope();

-- 5. ด่านกลาง: ระหว่างอยู่ในโหมดทดสอบ ห้ามเขียนตารางที่ยังไม่รู้จักโหมดทดสอบ ---------
create or replace function private.sandbox_block_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and (private.sandbox_persona()).id is not null then
    raise exception 'SANDBOX_MODULE_UNSUPPORTED';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.sandbox_block_write() from public, anon, authenticated;

-- ตารางที่ "รู้จักโหมดทดสอบแล้ว" หรือจำเป็นต้องเขียนได้ระหว่างโหมดทดสอบ
-- โมดูลใหม่ที่รองรับโหมดทดสอบแล้วให้เพิ่มชื่อตารางที่นี่ (ผ่าน migration ใหม่ที่ create or replace)
create or replace function private.sandbox_unguarded_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'ncr_reports', 'ncr_responsibilities', 'ncr_losses', 'ncr_status_history', 'ncr_attachments',
    'ncr_defect_types',   -- ข้อมูลอ้างอิงร่วม ไม่มีการเขียนจากแอป
    'document_counters',  -- ตัวนับแยกชุด NCR-TEST
    'audit_logs',         -- บันทึกการกระทำในโหมดทดสอบไว้ตรวจย้อนหลัง
    'sandbox_sessions'
  ]
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

create or replace function private.sandbox_guard_table(p_table regclass)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format(
    'create or replace trigger sandbox_guard before insert or update or delete on %s '
    'for each row execute function private.sandbox_block_write()', p_table);
end;
$$;
revoke all on function private.sandbox_guard_table(regclass) from public, anon, authenticated;

do $$
declare
  v_table regclass;
begin
  for v_table in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and c.relname <> all (private.sandbox_unguarded_tables())
  loop
    perform private.sandbox_guard_table(v_table);
  end loop;
end $$;

-- 6. บัญชีทดสอบ (persona) ครบบทบาทที่ NCR ใช้ ------------------------------------
-- อีเมล .local ไม่มีใครรับ inactive + ไม่มี auth_user_id = ล็อกอินไม่ได้ ไม่ถูกเลือกเป็นผู้อนุมัติของโมดูลอื่น
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.employee_no, 'ทดสอบ', v.last_name, lower(v.employee_no) || '@sandbox.local', v.last_name || ' (ทดสอบ)',
       d.id, r.id, false, true
from (values
  ('SBX-RB-STAFF', 'พนักงาน RB', 'RB', 'staff'),
  ('SBX-PK-STAFF', 'พนักงาน PK', 'PK', 'staff'),
  ('SBX-FT-FM', 'ผจก.โรงงาน', 'FT', 'factory_manager'),
  ('SBX-RB-MGR', 'ผจก. RB', 'RB', 'department_manager'),
  ('SBX-GR-AMGR', 'ผู้ช่วย ผจก. GR', 'GR', 'assistant_department_manager'),
  ('SBX-PK-MGR', 'ผจก. PK', 'PK', 'department_manager'),
  ('SBX-QA-STAFF', 'พนักงาน QA', 'QA', 'staff'),
  ('SBX-QA-MGR', 'ผจก. QA', 'QA', 'department_manager'),
  ('SBX-MGT-GM', 'ผจก.ทั่วไป', 'MGT', 'general_manager')
) as v(employee_no, last_name, dept_code, role_code)
join public.departments d on d.code = v.dept_code
join public.roles r on r.code = v.role_code
on conflict (employee_no) do nothing;

-- บัญชีทดสอบไม่ใช่บัญชีผู้ใช้จริง ไม่แสดงในรายการบัญชีของ admin
-- (คัดลอกจาก 20261001030000 ทุกตัวอักษร เพิ่มเฉพาะเงื่อนไข "not e.is_test")
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
    and not e.is_test
  order by e.employee_no
$$;
revoke all on function public.app_list_credentials() from public, anon;
grant execute on function public.app_list_credentials() to authenticated;

-- 7. RPC สำหรับ admin ---------------------------------------------------------
create or replace function private.sandbox_persona_json(p_employee public.employees)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_employee.id,
    'employee_no', p_employee.employee_no,
    'first_name', p_employee.first_name,
    'last_name', p_employee.last_name,
    'email', p_employee.email,
    'job_title', p_employee.job_title,
    'department_id', p_employee.department_id,
    'role_id', p_employee.role_id,
    'role', (select jsonb_build_object('code', r.code, 'name_th', r.name_th) from public.roles r where r.id = p_employee.role_id),
    'department', (select jsonb_build_object('code', d.code, 'name_th', d.name_th) from public.departments d where d.id = p_employee.department_id)
  )
$$;
revoke all on function private.sandbox_persona_json(public.employees) from public, anon, authenticated;

create or replace function private.sandbox_status_json()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'active', (private.sandbox_persona()).id is not null,
    'persona', case when (private.sandbox_persona()).id is not null
                    then private.sandbox_persona_json(private.sandbox_persona()) end,
    'personas', coalesce((
      select jsonb_agg(private.sandbox_persona_json(p) order by p.employee_no)
      from public.employees p where p.is_test
    ), '[]'::jsonb)
  )
$$;
revoke all on function private.sandbox_status_json() from public, anon, authenticated;

create or replace function public.app_sandbox_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.sandbox_admin();
  return private.sandbox_status_json();
end;
$$;

create or replace function public.app_sandbox_enter(p_persona_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
begin
  v_admin := private.sandbox_admin();
  select * into v_persona from public.employees where id = p_persona_id and is_test;
  if v_persona.id is null then
    raise exception 'PERSONA_NOT_FOUND';
  end if;

  insert into public.sandbox_sessions (admin_auth_user_id, admin_employee_id, persona_employee_id)
  values (auth.uid(), v_admin.id, v_persona.id)
  on conflict (admin_auth_user_id) do update
    set persona_employee_id = excluded.persona_employee_id, updated_at = now();

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_ENTER', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('persona_employee_no', v_persona.employee_no));
  return private.sandbox_status_json();
end;
$$;

create or replace function public.app_sandbox_exit()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
begin
  v_admin := private.sandbox_admin();
  if exists (select 1 from public.sandbox_sessions where admin_auth_user_id = auth.uid()) then
    delete from public.sandbox_sessions where admin_auth_user_id = auth.uid();
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_admin.id, 'SANDBOX_EXIT', 'sandbox_session', v_admin.id::text, '{}'::jsonb);
  end if;
  return private.sandbox_status_json();
end;
$$;

-- ล้างใบ NCR ทดสอบทั้งหมดและเริ่มนับเลข TEST- ใหม่ ต้องอยู่ในโหมดทดสอบ (ด่านฝั่งเขียนจึงอนุญาตเฉพาะแถวทดสอบ)
create or replace function public.app_sandbox_purge_ncr()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_deleted integer;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  delete from public.ncr_reports where is_test;
  get diagnostics v_deleted = row_count;
  delete from public.document_counters where department_code = 'NCR-TEST';

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_NCR', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_ncr', v_deleted));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.app_sandbox_status() from public, anon;
revoke all on function public.app_sandbox_enter(uuid) from public, anon;
revoke all on function public.app_sandbox_exit() from public, anon;
revoke all on function public.app_sandbox_purge_ncr() from public, anon;
grant execute on function public.app_sandbox_status() to authenticated;
grant execute on function public.app_sandbox_enter(uuid) to authenticated;
grant execute on function public.app_sandbox_exit() to authenticated;
grant execute on function public.app_sandbox_purge_ncr() to authenticated;
