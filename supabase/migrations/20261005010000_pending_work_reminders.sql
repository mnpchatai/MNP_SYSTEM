-- ============================================================================
-- เตือนงานค้างซ้ำทางอีเมล + CC หัวหน้า + ประวัติการแก้วันที่คาดว่าจะเสร็จของใบแจ้งซ่อม
--
-- กติกา (ตกลงกับผู้ใช้งาน 2026-10-05)
--   1) เตือนซ้ำเวลา 08:30 และ 13:30 น. (เวลาไทย) วันจันทร์-เสาร์ ข้ามวันหยุดของบริษัท
--      (ตาราง company_holidays ที่ Admin บันทึกเอง ระบบไม่เดาวันหยุดนักขัตฤกษ์ให้)
--   2) เตือน "คนที่ถือลูก" ตามสถานะปัจจุบันของงาน ส่งเป็นอีเมลสรุปฉบับเดียวต่อคนต่อรอบ
--      ระบบคำนวณจากสถานะ ณ เวลาที่เตือนทุกครั้ง ไม่เก็บรายการเตือนล่วงหน้า พอสถานะเปลี่ยน
--      คนเดิมจึงไม่ถูกเตือนอีกเอง
--   3) หลังช่างกดเริ่มงาน (in_progress) ไม่เตือน ยกเว้นเลยวันที่คาดว่าจะเสร็จแล้ว: เตือนช่าง
--      ให้บันทึกผลซ่อมหรือแก้วันที่คาดว่าจะเสร็จใหม่ ทุกการแก้วันที่ (ทั้งปุ่มแก้วันที่และการแก้ไข
--      การมอบหมาย) บันทึกประวัติ "จากกำหนดเสร็จเดิม → วันที่ใหม่" ใน request_expected_date_changes
--   4) 2 ชั่วโมงหลังรอบเตือน (10:30 และ 15:30 น.) ถ้ายังค้างกับคนเดิม ส่งสำเนาถึงหัวหน้า
--      (employees.manager_id ก่อน ถ้าไม่ได้ตั้งไว้จึงไล่ตามตำแหน่ง ดู private.employee_supervisors)
--   งานที่เพิ่งมาถึงมือไม่ถึง 2 ชั่วโมงก่อนรอบเตือนยังไม่ถูกเตือน เพราะเพิ่งได้อีเมลแจ้งเหตุการณ์ไป
--
-- ใครถือลูกในแต่ละสถานะ (ใช้ฟังก์ชันกลางชุดเดียวกับแจ้งเตือนตอนเกิดเหตุการณ์)
--   คำร้อง pending_approval → ผู้อนุมัติขั้นปัจจุบัน (private.approval_step_recipients)
--          more_info / pending_verify → ผู้ยื่น
--          pending_assign → ผจก.แผนกเจ้าของงาน (private.owning_department_managers)
--          assigned (ใบแจ้งซ่อม) → ช่างทุกคนในชุด
--          in_progress (ใบแจ้งซ่อม) → ช่างทุกคนในชุด เฉพาะเมื่อเลยวันที่คาดว่าจะเสร็จ
--          approved (คำร้องทั่วไป ยกเว้นฝ่ายบริหารซึ่งจบที่อนุมัติ) → ผู้รับผิดชอบ หรือผู้มี requests.operate
--   NCR    awaiting_disposition → ผจก.โรงงาน, awaiting_response → ผจก.แผนกที่รับผิดชอบ,
--          awaiting_followup → แผนก QA, awaiting_signoff → ผู้ลงนามคนถัดไป (private.ncr_audience)
--
-- อีเมลสรุปถึงหัวหน้าไม่ใส่ชื่อเรื่อง/รายละเอียดที่ผู้ยื่นพิมพ์ เพราะหัวหน้าอาจไม่มีสิทธิ์อ่านใบนั้น
-- (เช่น คำร้องถึงฝ่ายบริหาร) แสดงแค่เลขที่ ประเภท สิ่งที่ค้าง และระยะเวลา
--
-- Rollback / recovery (ไม่มีการลบหรือแก้ข้อมูลเดิม):
--   select cron.unschedule('pending-work-reminders'); select cron.unschedule('pending-work-escalations');
--   drop function public.app_reschedule_repair_expected_date(uuid, date, text);
--   drop function public.app_admin_set_holiday(date, text); drop function public.app_admin_delete_holiday(date);
--   drop trigger requests_expected_date_history on public.requests; drop function private.log_expected_date_change();
--   drop function private.run_pending_work_reminders(), private.run_pending_work_escalations(),
--     private.send_pending_work_reminders(timestamptz), private.send_pending_work_escalations(timestamptz),
--     private.pending_work_items(timestamptz), private.employee_supervisors(uuid), private.reminder_slot(timestamptz),
--     private.is_reminder_day(date);
--   drop table public.pending_work_reminder_log, public.request_expected_date_changes, public.company_holidays;
--   alter table public.notifications drop column digest, drop column kind;
--   private.notify_approval_step / private.ncr_notify ให้ผลเหมือนเดิมทุกประการ จึงคงไว้ได้ หรือย้อนกลับ
--   เป็นนิยามใน 20261003030000 / 20261002020000 พร้อม drop private.approval_step_recipients(uuid),
--   private.ncr_audience(uuid, text)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. ผู้รับของแต่ละขั้น: แยกออกเป็นฟังก์ชันกลาง ให้แจ้งเตือนตอนเกิดเหตุการณ์กับการเตือนซ้ำ
--    เลือกคนชุดเดียวกันเสมอ (ตรรกะคัดจาก notify_approval_step ใน 20261003030000 และ
--    ncr_notify ใน 20261002020000 ทุกเงื่อนไข)
-- ---------------------------------------------------------------------------
create or replace function private.approval_step_recipients(p_step_id uuid)
returns table (employee_id uuid, is_fallback boolean)
language sql
stable
security definer
set search_path = ''
as $$
  with step as (
    select s.*, r.request_type_id
    from public.approval_steps s
    join public.requests r on r.id = s.request_id
    where s.id = p_step_id
  ),
  approvers as (
    select e.id
    from step s
    join public.employees e on e.is_active
    where case
      when s.approver_employee_id is not null then e.id = s.approver_employee_id
      else coalesce(e.acting_role_id, e.role_id) = s.approver_role_id
        and (s.approver_department_id is null or e.department_id = s.approver_department_id)
        and private.can_approve_module(e.id, s.request_type_id)
    end
  )
  select a.id, false from approvers a
  union all
  -- ขั้นที่ไม่มีผู้ถือบทบาท: ให้ admin รับแทน (admin อนุมัติแทนได้)
  select e.id, true
  from public.employees e
  join public.roles ro on ro.id = e.role_id and ro.code = 'admin'
  where e.is_active
    and exists (select 1 from step)
    and not exists (select 1 from approvers)
$$;
revoke all on function private.approval_step_recipients(uuid) from public, anon, authenticated;

create or replace function private.notify_approval_step(p_step_id uuid, p_body text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_step public.approval_steps%rowtype;
  v_request public.requests%rowtype;
  v_count integer := 0;
begin
  select * into v_step from public.approval_steps where id = p_step_id;
  if v_step.id is null then
    return 0;
  end if;
  select * into v_request from public.requests where id = v_step.request_id;

  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         case when x.is_fallback then 'มีคำร้องรออนุมัติ (ขั้นนี้ยังไม่มีผู้อนุมัติ)' else 'มีคำร้องรออนุมัติ' end,
         case when x.is_fallback
           then p_body || ' · ขั้น ' || v_step.step_name || ' ยังไม่มีผู้ถือบทบาทนี้ ผู้ดูแลระบบอนุมัติแทนได้'
           else p_body
         end,
         '/requests/' || v_request.id::text
  from private.approval_step_recipients(v_step.id) x;
  get diagnostics v_count = row_count;

  return v_count;
end;
$$;
revoke all on function private.notify_approval_step(uuid, text) from public, anon, authenticated;

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

create or replace function private.ncr_notify(p_ncr_id uuid, p_audience text, p_title text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ncr public.ncr_reports%rowtype;
begin
  select * into v_ncr from public.ncr_reports where id = p_ncr_id;
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select a.employee_id, null::uuid, p_title,
         v_ncr.ncr_no || ' · ' || v_ncr.product_name,
         '/ncr/' || v_ncr.id::text
  from private.ncr_audience(v_ncr.id, p_audience) a
  where a.employee_id is distinct from p_actor;
end;
$$;
revoke all on function private.ncr_notify(uuid, text, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. วันหยุดของบริษัท: Admin บันทึกเอง (วันหยุดนักขัตฤกษ์และวันหยุดชดเชยเปลี่ยนทุกปี)
-- ---------------------------------------------------------------------------
create table public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null unique,
  name_th text not null check (char_length(btrim(name_th)) between 1 and 100),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create trigger company_holidays_audit after insert or update or delete on public.company_holidays
for each row execute function private.audit_row_change();

alter table public.company_holidays enable row level security;
revoke all on public.company_holidays from anon, authenticated;
grant select on public.company_holidays to authenticated;
create policy company_holidays_read on public.company_holidays for select to authenticated using (true);

create or replace function private.is_admin_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.employees e
    join public.roles r on r.id = e.role_id
    where e.id = p_employee_id and e.is_active and r.code = 'admin'
  )
$$;
revoke all on function private.is_admin_employee(uuid) from public, anon, authenticated;

create or replace function public.app_admin_set_holiday(p_date date, p_name text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_name text := btrim(coalesce(p_name, ''));
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_actor := private.current_employee_id();
  if v_actor is null or not private.is_admin_employee(v_actor) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_date is null then
    raise exception 'HOLIDAY_DATE_REQUIRED';
  end if;
  if char_length(v_name) not between 1 and 100 then
    raise exception 'HOLIDAY_NAME_REQUIRED';
  end if;

  insert into public.company_holidays (holiday_date, name_th, created_by)
  values (p_date, v_name, v_actor)
  on conflict (holiday_date) do update set name_th = excluded.name_th
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.app_admin_set_holiday(date, text) from public, anon;
grant execute on function public.app_admin_set_holiday(date, text) to authenticated;

create or replace function public.app_admin_delete_holiday(p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_actor := private.current_employee_id();
  if v_actor is null or not private.is_admin_employee(v_actor) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  delete from public.company_holidays where holiday_date = p_date;
  return found;
end;
$$;
revoke all on function public.app_admin_delete_holiday(date) from public, anon;
grant execute on function public.app_admin_delete_holiday(date) to authenticated;

create or replace function private.is_reminder_day(p_date date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select extract(isodow from p_date) between 1 and 6
    and not exists (select 1 from public.company_holidays h where h.holiday_date = p_date)
$$;
revoke all on function private.is_reminder_day(date) from public, anon, authenticated;

-- รอบเตือนที่เวลานี้สังกัด: เช้า 08:30 (ก่อนเที่ยง) หรือบ่าย 13:30 เวลาไทย ใช้เป็นกุญแจกันส่งซ้ำ
-- เมื่อ cron ยิงช้ากว่ากำหนดหรือถูกเรียกซ้ำในรอบเดียวกัน
create or replace function private.reminder_slot(p_at timestamptz)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select (
    (p_at at time zone 'Asia/Bangkok')::date
    + case when (p_at at time zone 'Asia/Bangkok')::time < time '12:00' then time '08:30' else time '13:30' end
  ) at time zone 'Asia/Bangkok'
$$;
revoke all on function private.reminder_slot(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. ประวัติการแก้วันที่คาดว่าจะเสร็จ (ไม่ใส่ใน request_status_history เพราะไม่ใช่การเปลี่ยนสถานะ)
-- ---------------------------------------------------------------------------
create table public.request_expected_date_changes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  old_date date,
  new_date date,
  note text check (note is null or char_length(note) <= 500),
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now()
);
create index request_expected_date_changes_request_idx on public.request_expected_date_changes(request_id, created_at);

alter table public.request_expected_date_changes enable row level security;
revoke all on public.request_expected_date_changes from anon, authenticated;
grant select on public.request_expected_date_changes to authenticated;
create policy request_expected_date_changes_read on public.request_expected_date_changes for select to authenticated
using (private.can_access_request(request_id));

-- บันทึกทุกเส้นทางที่แก้ work_expected_date (ปุ่มแก้วันที่ และฟอร์มแก้ไขการมอบหมายช่าง)
-- การตั้งวันที่ครั้งแรกตอนมอบหมาย (ค่าเดิมว่าง) ไม่นับเป็นการแก้ไข
create or replace function private.log_expected_date_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.work_expected_date is not null and new.work_expected_date is distinct from old.work_expected_date then
    insert into public.request_expected_date_changes (request_id, old_date, new_date, note, changed_by)
    values (
      new.id, old.work_expected_date, new.work_expected_date,
      nullif(btrim(coalesce(current_setting('mnp.expected_date_note', true), '')), ''),
      private.current_employee_id()
    );
  end if;
  return null;
end;
$$;
revoke all on function private.log_expected_date_change() from public, anon, authenticated;

create trigger requests_expected_date_history after update of work_expected_date on public.requests
for each row execute function private.log_expected_date_change();

create or replace function public.app_reschedule_repair_expected_date(
  p_request_id uuid,
  p_expected_date date,
  p_note text default null
)
returns date
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_allowed boolean;
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
  if p_expected_date is null then
    raise exception 'WORK_EXPECTED_DATE_REQUIRED';
  end if;
  if char_length(coalesce(v_note, '')) > 500 then
    raise exception 'NOTE_TOO_LONG';
  end if;

  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  select * into v_type from public.request_types where id = v_request.request_type_id;

  -- สิทธิ์เดียวกับหมุดความคืบหน้า: ช่างในชุด + ผจก.แผนกเจ้าของงาน + admin
  v_allowed := private.is_admin_employee(v_employee.id)
    or private.is_request_technician(v_request.id, v_employee.id)
    or exists (select 1 from private.owning_department_managers(v_request.id) m where m.employee_id = v_employee.id);
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if not coalesce(v_type.uses_repair_workflow, false) or v_request.status not in ('assigned', 'in_progress') then
    raise exception 'REQUEST_NOT_RESCHEDULABLE';
  end if;
  if p_expected_date < private.bangkok_today() then
    raise exception 'EXPECTED_DATE_IN_PAST';
  end if;
  if v_request.work_started_date is not null and p_expected_date < v_request.work_started_date then
    raise exception 'WORK_DATE_RANGE_INVALID';
  end if;
  if p_expected_date = v_request.work_expected_date then
    raise exception 'EXPECTED_DATE_UNCHANGED';
  end if;

  perform set_config('mnp.expected_date_note', coalesce(v_note, ''), true);
  update public.requests set work_expected_date = p_expected_date where id = v_request.id;
  perform set_config('mnp.expected_date_note', '', true);

  -- ใบเก่าที่ยังไม่เคยมีกำหนดเสร็จไม่เข้า trigger (ค่าเดิมว่าง) จึงบันทึกเองให้ครบทุกครั้งที่กดแก้
  if v_request.work_expected_date is null then
    insert into public.request_expected_date_changes (request_id, old_date, new_date, note, changed_by)
    values (v_request.id, null, p_expected_date, v_note, v_employee.id);
  end if;

  -- ผู้แจ้งรอของอยู่ และ ผจก.เจ้าของงานต้องรู้ว่ากำหนดเลื่อน (คนกดไม่ต้องได้แจ้งเตือนของตัวเอง)
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'เลื่อนกำหนดเสร็จงานซ่อม'),
         v_request.request_no || ' · กำหนดเสร็จเดิม '
           || coalesce(to_char(v_request.work_expected_date, 'DD/MM/YYYY'), '—')
           || ' เป็น ' || to_char(p_expected_date, 'DD/MM/YYYY')
           || coalesce(' · ' || v_note, ''),
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return p_expected_date;
end;
$$;
revoke all on function public.app_reschedule_repair_expected_date(uuid, date, text) from public, anon;
grant execute on function public.app_reschedule_repair_expected_date(uuid, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. หัวหน้าของพนักงาน (ผู้รับสำเนาเมื่องานค้าง)
--    manager_id ที่ตั้งไว้ชนะเสมอ ถ้าไม่ได้ตั้งไล่ตามตำแหน่ง:
--      staff → ผจก./ผู้ช่วย ผจก. แผนกเดียวกัน, ผู้ช่วย ผจก.แผนก → ผจก.แผนกเดียวกัน,
--      ผจก.แผนก / ผู้ช่วย ผจก.โรงงาน → ผจก.โรงงาน, ผจก.โรงงาน → ผจก.ทั่วไป,
--      ผจก.ทั่วไป / admin → ไม่มี
--    ระดับไหนไม่มีคน ให้ขึ้นไประดับถัดไป (ผจก.โรงงาน แล้ว ผจก.ทั่วไป)
-- ---------------------------------------------------------------------------
create or replace function private.employee_supervisors(p_employee_id uuid)
returns table (employee_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_role text;
  v_found boolean := false;
begin
  select * into v_employee from public.employees where id = p_employee_id;
  if v_employee.id is null then
    return;
  end if;

  return query
    select m.id from public.employees m
    where m.id = v_employee.manager_id and m.is_active and m.id <> v_employee.id;
  if found then
    return;
  end if;

  select r.code into v_role from public.roles r where r.id = coalesce(v_employee.acting_role_id, v_employee.role_id);

  if v_role in ('staff', 'assistant_department_manager') then
    return query
      select e.id from public.employees e
      join public.roles r on r.id = e.role_id
      where e.is_active and e.id <> v_employee.id
        and e.department_id = v_employee.department_id
        and (r.code = 'department_manager'
             or (r.code = 'assistant_department_manager' and v_role <> 'assistant_department_manager'));
    v_found := found;
  end if;

  if not v_found and v_role in ('staff', 'assistant_department_manager', 'department_manager',
                                'assistant_factory_manager') then
    return query
      select e.id from public.employees e
      join public.roles r on r.id = coalesce(e.acting_role_id, e.role_id)
      where e.is_active and e.id <> v_employee.id and r.code = 'factory_manager';
    v_found := found;
  end if;

  if not v_found and v_role in ('staff', 'assistant_department_manager', 'department_manager',
                                'assistant_factory_manager', 'factory_manager') then
    return query
      select e.id from public.employees e
      join public.roles r on r.id = coalesce(e.acting_role_id, e.role_id)
      where e.is_active and e.id <> v_employee.id and r.code = 'general_manager';
  end if;
end;
$$;
revoke all on function private.employee_supervisors(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. งานค้าง ณ เวลาหนึ่ง: หนึ่งแถวต่อ (ผู้ถือลูก, งาน)
--    waiting_since = เวลาที่ลูกมาถึงมือ (ความเคลื่อนไหวล่าสุดของใบ) ใช้กันเตือนงานที่เพิ่งมาถึง
--    ใบแจ้งซ่อมที่เลยกำหนดเสร็จนับเริ่มค้างตั้งแต่ต้นวันถัดจากวันกำหนดเสร็จ
-- ---------------------------------------------------------------------------
create or replace function private.pending_work_items(p_at timestamptz)
returns table (
  holder_id uuid,
  item_type text,
  item_id uuid,
  doc_no text,
  doc_label text,
  title text,
  status text,
  action text,
  waiting_since timestamptz,
  due_date date,
  is_urgent boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with today as (
    select (p_at at time zone 'Asia/Bangkok')::date as d
  ),
  req as (
    select r.id, r.request_no, r.title, r.status::text as status, r.current_step, r.requester_id, r.assignee_id,
           r.work_expected_date, (r.is_urgent or r.priority = 'urgent') as is_urgent,
           t.code as type_code, t.name_th as type_name, coalesce(t.uses_repair_workflow, false) as is_repair,
           greatest(
             (select max(h.created_at) from public.request_status_history h where h.request_id = r.id),
             (select max(s.acted_at) from public.approval_steps s where s.request_id = r.id),
             r.submitted_at,
             r.created_at
           ) as since
    from public.requests r
    join public.request_types t on t.id = r.request_type_id
    where r.status in ('pending_approval', 'more_info', 'pending_assign', 'assigned', 'in_progress', 'pending_verify', 'approved')
  ),
  techs as (
    select r.id as request_id, x.employee_id
    from req r
    cross join lateral (
      select rt.technician_id as employee_id from public.request_technicians rt where rt.request_id = r.id
      union
      select r.assignee_id where r.assignee_id is not null
    ) x
    where r.is_repair
  ),
  operators as (
    select e.id
    from public.employees e
    join public.roles ro on ro.id = e.role_id and ro.code <> 'admin'
    where e.is_active
      and exists (
        select 1 from public.role_permissions rp
        join public.permissions p on p.id = rp.permission_id and p.code = 'requests.operate'
        where rp.role_id = e.role_id
      )
  ),
  request_holders as (
    select x.employee_id as holder_id, r.id, 'พิจารณาอนุมัติ (ขั้น ' || s.step_name || ')' as action, r.since, null::date as due_date
    from req r
    join public.approval_steps s on s.request_id = r.id and s.step_order = r.current_step and s.status = 'pending'
    cross join lateral private.approval_step_recipients(s.id) x
    where r.status = 'pending_approval'
    union all
    select r.requester_id, r.id, 'ส่งข้อมูลเพิ่มเติมที่ผู้อนุมัติขอ', r.since, null::date
    from req r where r.status = 'more_info'
    union all
    select m.employee_id, r.id, 'มอบหมายช่าง', r.since, null::date
    from req r cross join lateral private.owning_department_managers(r.id) m
    where r.status = 'pending_assign'
    union all
    select t.employee_id, r.id, 'เริ่มงานซ่อม', r.since, r.work_expected_date
    from req r join techs t on t.request_id = r.id
    where r.status = 'assigned'
    union all
    select t.employee_id, r.id, 'เลยกำหนดเสร็จแล้ว: บันทึกผลซ่อม หรือแก้ไขวันที่คาดว่าจะเสร็จ',
           (r.work_expected_date + 1)::timestamp at time zone 'Asia/Bangkok', r.work_expected_date
    from req r join techs t on t.request_id = r.id
    cross join today
    where r.status = 'in_progress' and r.work_expected_date < today.d
    union all
    select r.requester_id, r.id, 'ตรวจรับผลการซ่อม', r.since, null::date
    from req r where r.status = 'pending_verify'
    union all
    select coalesce(r.assignee_id, o.id), r.id, 'รับงานและเริ่มดำเนินการ', r.since, null::date
    from req r
    left join operators o on r.assignee_id is null
    where r.status = 'approved' and not r.is_repair and r.type_code <> 'MANAGEMENT'
  ),
  ncr as (
    select n.id, n.ncr_no, n.product_name, n.status, n.response_due,
           coalesce((select max(h.changed_at) from public.ncr_status_history h where h.ncr_id = n.id), n.created_at) as since,
           case n.status
             when 'awaiting_disposition' then 'factory'
             when 'awaiting_response' then 'responsible_managers'
             when 'awaiting_followup' then 'qa'
             else case
               when n.signoff_qa_at is null then 'qa_managers'
               when n.signoff_factory_at is null then 'factory'
               else 'general_manager'
             end
           end as audience,
           case n.status
             when 'awaiting_disposition' then 'ให้ความเห็นและเลือกแผนกที่รับผิดชอบ (ส่วนที่ 2)'
             when 'awaiting_response' then 'ตอบ NCR: สาเหตุ การแก้ไข และการป้องกัน (ส่วนที่ 3)'
             when 'awaiting_followup' then 'ติดตามผลการแก้ไข (ส่วนที่ 4)'
             else 'ลงนามปิด NCR'
           end as action
    from public.ncr_reports n
    where n.status in ('awaiting_disposition', 'awaiting_response', 'awaiting_followup', 'awaiting_signoff')
  ),
  all_items as (
    select h.holder_id, 'request'::text as item_type, r.id as item_id, r.request_no as doc_no, r.type_name as doc_label,
           r.title, r.status, h.action, h.since as waiting_since, h.due_date, r.is_urgent
    from request_holders h join req r on r.id = h.id
    union all
    select a.employee_id, 'ncr', n.id, n.ncr_no, 'NCR', n.product_name, n.status, n.action, n.since,
           case when n.status = 'awaiting_response' then n.response_due end, false
    from ncr n cross join lateral private.ncr_audience(n.id, n.audience) a
  )
  select distinct on (i.holder_id, i.item_type, i.item_id)
         i.holder_id, i.item_type, i.item_id, i.doc_no, i.doc_label, i.title, i.status, i.action,
         i.waiting_since, i.due_date, i.is_urgent
  from all_items i
  join public.employees e on e.id = i.holder_id and e.is_active
  order by i.holder_id, i.item_type, i.item_id, i.waiting_since
$$;
revoke all on function private.pending_work_items(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. อีเมลสรุปเป็นแถวใน notifications ชุดเดิม (คิวอีเมลเดิมส่งให้) แยกชนิดด้วย kind
--    digest = รายการงานแบบ JSON ให้ notify-email ประกอบตาราง
--    สรุปใหม่ทำให้สรุปเก่าที่ยังไม่ได้อ่านถูกปิดเป็นอ่านแล้ว กระดิ่งในแอปจึงไม่พองขึ้นทุกรอบ
-- ---------------------------------------------------------------------------
alter table public.notifications
  add column if not exists kind text not null default 'event',
  add column if not exists digest jsonb;
alter table public.notifications
  add constraint notifications_kind_check check (kind in ('event', 'reminder', 'escalation')),
  add constraint notifications_digest_array check (digest is null or jsonb_typeof(digest) = 'array');

create table public.pending_work_reminder_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('reminder', 'escalation')),
  slot_at timestamptz not null,
  recipient_id uuid not null references public.employees(id) on delete cascade,
  holder_id uuid not null references public.employees(id) on delete cascade,
  item_type text not null check (item_type in ('request', 'ncr')),
  item_id uuid not null,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, slot_at, recipient_id, holder_id, item_type, item_id)
);
create index pending_work_reminder_log_slot_idx on public.pending_work_reminder_log(kind, slot_at);

-- ตารางภายในของงานตั้งเวลา ไม่เปิดให้ผู้ใช้อ่านหรือเขียน
alter table public.pending_work_reminder_log enable row level security;
revoke all on public.pending_work_reminder_log from public, anon, authenticated;

create or replace function private.digest_summary(p_items jsonb, p_with_holder boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(line, ' | ' order by ordinality), '')
    || case when jsonb_array_length(p_items) > 5 then ' | และอีก ' || (jsonb_array_length(p_items) - 5) || ' รายการ' else '' end
  from (
    select (case when p_with_holder then (e ->> 'holder_name') || ': ' else '' end)
             || coalesce(e ->> 'doc_no', e ->> 'doc_label') || ' · ' || (e ->> 'action') as line,
           ordinality
    from jsonb_array_elements(p_items) with ordinality as x(e, ordinality)
    where ordinality <= 5
  ) lines
$$;
revoke all on function private.digest_summary(jsonb, boolean) from public, anon, authenticated;

create or replace function private.send_pending_work_reminders(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot timestamptz;
  v_rec record;
  v_notification uuid;
  v_sent integer := 0;
begin
  if not private.is_reminder_day((p_now at time zone 'Asia/Bangkok')::date) then
    return 0;
  end if;
  v_slot := private.reminder_slot(p_now);

  for v_rec in
    select w.holder_id,
           count(*) as item_count,
           bool_or(w.is_urgent) as any_urgent,
           jsonb_agg(jsonb_build_object(
             'item_type', w.item_type, 'item_id', w.item_id, 'doc_no', w.doc_no, 'doc_label', w.doc_label,
             'title', w.title, 'status', w.status, 'action', w.action, 'waiting_since', w.waiting_since,
             'due_date', w.due_date, 'is_urgent', w.is_urgent
           ) order by w.is_urgent desc, w.waiting_since) as items
    from private.pending_work_items(p_now) w
    where w.waiting_since <= v_slot - interval '2 hours'
      and not exists (
        select 1 from public.pending_work_reminder_log l
        where l.kind = 'reminder' and l.slot_at = v_slot and l.recipient_id = w.holder_id
          and l.item_type = w.item_type and l.item_id = w.item_id
      )
    group by w.holder_id
  loop
    update public.notifications
    set read_at = now()
    where recipient_id = v_rec.holder_id and kind = 'reminder' and read_at is null;

    insert into public.notifications (recipient_id, request_id, title, body, action_url, kind, digest)
    values (
      v_rec.holder_id, null,
      case when v_rec.any_urgent then '🚨 [ด่วน] ' else '' end || 'งานค้างรอคุณดำเนินการ ' || v_rec.item_count || ' รายการ',
      private.digest_summary(v_rec.items, false),
      '/', 'reminder', v_rec.items
    )
    returning id into v_notification;

    insert into public.pending_work_reminder_log (kind, slot_at, recipient_id, holder_id, item_type, item_id, notification_id)
    select 'reminder', v_slot, v_rec.holder_id, v_rec.holder_id, e ->> 'item_type', (e ->> 'item_id')::uuid, v_notification
    from jsonb_array_elements(v_rec.items) e;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;
revoke all on function private.send_pending_work_reminders(timestamptz) from public, anon, authenticated;

create or replace function private.send_pending_work_escalations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot timestamptz;
  v_rec record;
  v_notification uuid;
  v_sent integer := 0;
begin
  if not private.is_reminder_day((p_now at time zone 'Asia/Bangkok')::date) then
    return 0;
  end if;
  -- รอบเตือนที่ผ่านมาแล้วอย่างน้อย 2 ชั่วโมง (10:30 → รอบ 08:30, 15:30 → รอบ 13:30)
  v_slot := private.reminder_slot(p_now - interval '2 hours');
  if p_now < v_slot + interval '2 hours'
     or (v_slot at time zone 'Asia/Bangkok')::date <> (p_now at time zone 'Asia/Bangkok')::date then
    return 0;
  end if;

  for v_rec in
    with current_items as materialized (
      select * from private.pending_work_items(p_now)
    ),
    still_pending as (
      select w.*
      from public.pending_work_reminder_log l
      join current_items w on w.holder_id = l.holder_id and w.item_type = l.item_type and w.item_id = l.item_id
      where l.kind = 'reminder' and l.slot_at = v_slot
    ),
    targets as (
      select s.*, sup.employee_id as supervisor_id
      from still_pending s
      cross join lateral private.employee_supervisors(s.holder_id) sup
      -- หัวหน้าที่ถือลูกงานเดียวกันอยู่แล้วได้อีเมลเตือนของตัวเองไปแล้ว
      where not exists (
          select 1 from current_items w2
          where w2.holder_id = sup.employee_id and w2.item_type = s.item_type and w2.item_id = s.item_id
        )
        and not exists (
          select 1 from public.pending_work_reminder_log l2
          where l2.kind = 'escalation' and l2.slot_at = v_slot and l2.recipient_id = sup.employee_id
            and l2.holder_id = s.holder_id and l2.item_type = s.item_type and l2.item_id = s.item_id
        )
    )
    select t.supervisor_id,
           count(*) as item_count,
           bool_or(t.is_urgent) as any_urgent,
           jsonb_agg(jsonb_build_object(
             'item_type', t.item_type, 'item_id', t.item_id, 'doc_no', t.doc_no, 'doc_label', t.doc_label,
             'status', t.status, 'action', t.action, 'waiting_since', t.waiting_since, 'due_date', t.due_date,
             'is_urgent', t.is_urgent, 'holder_id', t.holder_id,
             'holder_name', btrim(e.first_name || ' ' || e.last_name)
           ) order by e.first_name, e.last_name, t.waiting_since) as items
    from targets t
    join public.employees e on e.id = t.holder_id
    group by t.supervisor_id
  loop
    update public.notifications
    set read_at = now()
    where recipient_id = v_rec.supervisor_id and kind = 'escalation' and read_at is null;

    insert into public.notifications (recipient_id, request_id, title, body, action_url, kind, digest)
    values (
      v_rec.supervisor_id, null,
      case when v_rec.any_urgent then '🚨 [ด่วน] ' else '' end || 'สำเนาถึงหัวหน้า: งานค้างของทีม ' || v_rec.item_count || ' รายการ',
      private.digest_summary(v_rec.items, true),
      '/', 'escalation', v_rec.items
    )
    returning id into v_notification;

    insert into public.pending_work_reminder_log (kind, slot_at, recipient_id, holder_id, item_type, item_id, notification_id)
    select 'escalation', v_slot, v_rec.supervisor_id, (e ->> 'holder_id')::uuid, e ->> 'item_type', (e ->> 'item_id')::uuid, v_notification
    from jsonb_array_elements(v_rec.items) e;

    v_sent := v_sent + 1;
  end loop;

  return v_sent;
end;
$$;
revoke all on function private.send_pending_work_escalations(timestamptz) from public, anon, authenticated;

-- ตัวที่ cron เรียก: ส่งเข้าคิวแล้วเรียก notify-email ทันทีเฉพาะเมื่อมีอะไรเข้าคิว
create or replace function private.run_pending_work_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer;
begin
  v_sent := private.send_pending_work_reminders(now());
  if v_sent > 0 then
    perform private.dispatch_pending_notification_emails();
  end if;
  return v_sent;
end;
$$;
revoke all on function private.run_pending_work_reminders() from public, anon, authenticated;

create or replace function private.run_pending_work_escalations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sent integer;
begin
  v_sent := private.send_pending_work_escalations(now());
  if v_sent > 0 then
    perform private.dispatch_pending_notification_emails();
  end if;
  return v_sent;
end;
$$;
revoke all on function private.run_pending_work_escalations() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. ตั้งเวลา (UTC; ไทยไม่มี DST): 01:30/06:30 UTC = 08:30/13:30 น. และ 03:30/08:30 UTC = 10:30/15:30 น.
--    จันทร์-เสาร์ (วันเดียวกันทั้ง UTC และเวลาไทยในช่วงเวลานี้) วันหยุดบริษัทตรวจในฟังก์ชัน
-- ---------------------------------------------------------------------------
select cron.schedule(
  'pending-work-reminders',
  '30 1,6 * * 1-6',
  $cron$ select private.run_pending_work_reminders(); $cron$
);
select cron.schedule(
  'pending-work-escalations',
  '30 3,8 * * 1-6',
  $cron$ select private.run_pending_work_escalations(); $cron$
);
