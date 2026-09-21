-- ============================================================================
-- ปรับ workflow แจ้งซ่อมให้ตรงสเปกของระบบเดิม (Maintanance-MT) ทั้งชุด
--
-- ไฟล์ 20260921080000 แก้ไปแล้วเฉพาะ "สายอนุมัติ" (ผจก.โรงงาน → ผจก.ทั่วไป) ไฟล์นี้เก็บส่วนที่เหลือ
-- ซึ่งยังไม่ตรงสเปกอีก 8 เรื่อง:
--
--   1) ช่างมอบหมายได้คนเดียว          → สเปกให้เลือกได้หลายคน และแจ้งเตือนช่างทุกคน
--   2) มอบหมายแล้วเปลี่ยนช่างไม่ได้    → สเปกให้ ผจก.ซ่อมบำรุงแก้รายชื่อช่างได้ทุกสถานะ ยกเว้น rejected
--   3) ฟิลด์ตอนมอบหมายอยู่ผิดขั้น      → "การดำเนินงาน" กับ "ความคิดเห็นของช่างผู้ตรวจสอบ" เป็นของ
--                                       ผจก.ซ่อมบำรุงตอนมอบหมาย ไม่ใช่ของช่างตอนจบงาน และยังขาดช่อง
--                                       "ชื่อผู้จัดการที่รับใบ" — ช่างเหลือกรอกแค่วิเคราะห์สาเหตุ+อะไหล่
--   4) ไม่มีหมุดความคืบหน้า            → แนวทางที่มีของต้องรอ ต้องมีหมุดให้กดบันทึกพร้อมวันที่
--   5) ไม่บังคับเหตุผลตอนปฏิเสธ        → สเปกบังคับทั้ง "ไม่อนุมัติ" และ "ขอข้อมูลเพิ่มเติม"
--   6) วันเริ่ม/วันคาดว่าเสร็จไม่บังคับ → สเปกบังคับทั้งคู่ และวันเสร็จต้องไม่ก่อนวันเริ่ม
--   7) แจ้งเตือนขาด                    → ซ่อมเสร็จต้องแจ้ง ผจก.ซ่อมบำรุงด้วย · ตรวจรับผ่านต้องแจ้ง
--                                       ช่างทุกคน + ผจก.ซ่อมบำรุง (เดิมแจ้งเฉพาะตอนไม่ผ่าน)
--   8) ธงด่วนไม่ขึ้นหัวข้อความ          → สเปกให้ใบด่วนขึ้น "🚨 [ด่วน]" นำหน้า
--
-- และตามที่ยืนยันเพิ่ม: ผจก.โรงงาน/ผจก.ทั่วไป กดจบงานแทนช่าง หรือกดตรวจรับแทนผู้แจ้ง "ไม่ได้"
-- ส่วน ผจก.แผนกซ่อมบำรุงยังกดเริ่มงานแทนช่างได้เหมือนเดิม และประเภทเอกสารยังเป็นผู้แจ้งเลือกตอนเปิดใบ
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. โครงข้อมูลใหม่
-- ---------------------------------------------------------------------------

-- ชื่อผู้จัดการที่รับใบ — เก็บเป็นข้อความตามระบบเดิม (เป็นการบันทึกว่าใครรับเรื่อง ไม่ใช่ FK สิทธิ์)
alter table public.requests
  add column if not exists received_by_name text;

-- ช่างผู้รับผิดชอบหลายคนต่อหนึ่งใบ
-- requests.assignee_id ยังอยู่ ใช้เป็น "ช่างคนแรกของชุด" เพื่อไม่ให้ RLS/หน้าจอ/สำเนาชีตที่อ้างอยู่
-- ต้องแก้พร้อมกันทั้งหมด — ทุกจุดที่ถามว่า "ใบนี้เป็นงานของฉันไหม" ตรวจทั้งสองที่
create table if not exists public.request_technicians (
  request_id uuid not null references public.requests(id) on delete cascade,
  technician_id uuid not null references public.employees(id) on delete cascade,
  assigned_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (request_id, technician_id)
);

create index if not exists request_technicians_tech_idx
  on public.request_technicians(technician_id);

alter table public.request_technicians enable row level security;
revoke all on public.request_technicians from anon, authenticated;
grant select on public.request_technicians to authenticated;

drop policy if exists request_technicians_read on public.request_technicians;
create policy request_technicians_read on public.request_technicians for select to authenticated
using (private.can_access_request(request_id));

-- หมุดความคืบหน้าระหว่างทาง สร้างตอนมอบหมายตามแนวทางที่เลือก
create table if not exists public.request_progress_steps (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id) on delete cascade,
  step_key text not null,
  step_label text not null,
  sort_order integer not null default 0,
  done_on date,
  recorded_by uuid references public.employees(id) on delete set null,
  recorded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, step_key)
);

create index if not exists request_progress_steps_request_idx
  on public.request_progress_steps(request_id);

alter table public.request_progress_steps enable row level security;
revoke all on public.request_progress_steps from anon, authenticated;
grant select on public.request_progress_steps to authenticated;

drop policy if exists request_progress_steps_read on public.request_progress_steps;
create policy request_progress_steps_read on public.request_progress_steps for select to authenticated
using (private.can_access_request(request_id));

-- ยกช่างที่มอบหมายไว้แล้วเข้าตารางใหม่ ใบที่เดินอยู่จึงไม่สะดุด
insert into public.request_technicians (request_id, technician_id, assigned_by)
select r.id, r.assignee_id, r.assigned_by
from public.requests r
where r.assignee_id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. ตัวช่วยที่ใช้ร่วมกันหลายฟังก์ชัน
-- ---------------------------------------------------------------------------

-- "คนนี้เป็นช่างของใบนี้ไหม" — ดูทั้งช่างคนแรก (assignee_id) และรายชื่อในตารางช่าง
create or replace function private.is_request_technician(p_request_id uuid, p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.requests r
    where r.id = p_request_id and r.assignee_id = p_employee_id
  ) or exists (
    select 1 from public.request_technicians rt
    where rt.request_id = p_request_id and rt.technician_id = p_employee_id
  )
$$;

revoke all on function private.is_request_technician(uuid, uuid) from public, anon;
grant execute on function private.is_request_technician(uuid, uuid) to authenticated;

-- ผจก.แผนกซ่อมบำรุงของใบนี้ = department_manager ของแผนกเจ้าของประเภทเอกสาร
create or replace function private.owning_department_managers(p_request_id uuid)
returns table (employee_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id
  from public.requests r
  join public.request_types t on t.id = r.request_type_id
  join public.employees e on e.department_id = t.owning_department_id and e.is_active
  join public.roles ro on ro.id = e.role_id and ro.code = 'department_manager'
  where r.id = p_request_id
$$;

revoke all on function private.owning_department_managers(uuid) from public, anon;

-- หัวข้อความของใบด่วนขึ้น 🚨 [ด่วน] นำหน้าตามระบบเดิม
create or replace function private.notify_title(p_request_id uuid, p_title text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.requests r where r.id = p_request_id and r.is_urgent)
      then '🚨 [ด่วน] ' || p_title
    else p_title
  end
$$;

revoke all on function private.notify_title(uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 3. การมองเห็น: ช่างทุกคนในชุด ไม่ใช่เฉพาะคนแรก
-- ---------------------------------------------------------------------------
create or replace function private.can_access_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.requests r
    join public.employees me on me.auth_user_id = (select auth.uid()) and me.is_active
    where r.id = target_request_id
      and (
        r.requester_id = me.id
        or r.assignee_id = me.id
        or exists (
          select 1 from public.request_technicians rt
          where rt.request_id = r.id and rt.technician_id = me.id
        )
        or exists (
          select 1 from public.approval_steps s
          where s.request_id = r.id
            and (
              s.approver_employee_id = me.id
              or (
                s.approver_role_id = me.role_id
                and (s.approver_department_id is null or s.approver_department_id = me.department_id)
                and private.can_approve_module(me.id, r.request_type_id)
              )
            )
        )
        or private.has_permission('requests.view_all')
        or (
          private.has_permission('requests.operate')
          and r.status in ('approved', 'in_progress')
        )
        or exists (
          select 1
          from public.request_types rt
          join public.roles me_role on me_role.id = me.role_id
          where rt.id = r.request_type_id
            and me_role.code = 'department_manager'
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
      )
  )
$$;

-- ---------------------------------------------------------------------------
-- 4. อนุมัติ: "ไม่อนุมัติ" และ "ขอข้อมูลเพิ่มเติม" ต้องระบุเหตุผล
-- ---------------------------------------------------------------------------
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
  if p_decision not in ('approved', 'rejected', 'more_info') then
    raise exception 'INVALID_DECISION';
  end if;

  v_comment := nullif(left(trim(coalesce(p_comment, '')), 1000), '');
  -- สเปก: มีแต่ "อนุมัติ" ที่หมายเหตุเป็นทางเลือก อีกสองทางต้องบอกเหตุผลเสมอ
  if p_decision in ('rejected', 'more_info') and coalesce(char_length(v_comment), 0) < 3 then
    raise exception 'COMMENT_REQUIRED';
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

  update public.approval_steps
  set status = p_decision::public.approval_status,
      acted_by = v_employee.id,
      acted_at = now(),
      comment = v_comment
  where id = v_step.id and status = 'pending';

  if p_decision in ('rejected', 'more_info') then
    update public.requests
    set status = case when p_decision = 'rejected'
                      then 'rejected'::public.request_status
                      else 'more_info'::public.request_status end,
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

      -- อนุมัติครบทุกชั้นแล้ว: ปลุก ผจก.ซ่อมบำรุงให้มามอบหมายช่าง
      if coalesce(v_uses_repair, false) then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select m.employee_id, v_request.id,
               private.notify_title(v_request.id, 'อนุมัติครบแล้ว รอมอบหมายช่าง'),
               v_request.request_no || ' · ' || v_request.title,
               '/requests/' || v_request.id::text
        from private.owning_department_managers(v_request.id) m;
      end if;
    else
      update public.requests
      set current_step = v_next.step_order, last_changed_by = v_employee.id
      where id = v_request.id;

      if v_next.approver_employee_id is not null then
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        values (
          v_next.approver_employee_id, v_request.id,
          private.notify_title(v_request.id, 'มีคำร้องรออนุมัติ'),
          v_request.request_no || ' · ' || v_next.step_name,
          '/requests/' || v_request.id::text
        );
      else
        insert into public.notifications (recipient_id, request_id, title, body, action_url)
        select e.id, v_request.id,
               private.notify_title(v_request.id, 'มีคำร้องรออนุมัติ'),
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

-- ---------------------------------------------------------------------------
-- 5. มอบหมายช่าง — หลายคน, ฟิลด์ของ ผจก.ซ่อมบำรุง, วันที่บังคับ, แก้ทีหลังได้
-- ---------------------------------------------------------------------------
create or replace function public.app_assign_repair_technician(
  p_request_id uuid,
  p_technician_ids uuid[],
  p_received_by_name text default null,
  p_execution_plan text default null,
  p_inspector_opinion text default null,
  p_work_started_date date default null,
  p_work_expected_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
  v_is_admin boolean;
  v_first_assign boolean;
  v_ids uuid[];
  v_count integer;
  v_received text;
  v_plan text;
  v_opinion text;
  v_start date;
  v_expected date;
  v_tech uuid;
  v_sort integer := 0;
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

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  -- สเปก: แก้รายชื่อช่างได้ทุกสถานะ ยกเว้นใบที่ถูกปฏิเสธไปแล้ว และต้องอนุมัติครบก่อนถึงจะมอบหมายครั้งแรก
  if v_request.status in ('rejected', 'pending_approval', 'more_info', 'draft') then
    raise exception 'REQUEST_NOT_ASSIGNABLE';
  end if;

  select * into v_type
  from public.request_types
  where id = v_request.request_type_id;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not (
    v_type.owning_department_id is not null
    and v_employee.department_id = v_type.owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code = 'department_manager'
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_first_assign := v_request.status = 'pending_assign';

  -- ช่างต้องเป็นพนักงาน active ของแผนกเจ้าของประเภทเอกสาร และห้ามซ้ำกันในชุดเดียว
  select array_agg(distinct e.id) into v_ids
  from unnest(coalesce(p_technician_ids, array[]::uuid[])) as t(id)
  join public.employees e on e.id = t.id
  where e.is_active and e.department_id = v_type.owning_department_id;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    raise exception 'TECHNICIAN_NOT_FOUND';
  end if;
  if v_count <> coalesce(array_length(array(select distinct unnest(coalesce(p_technician_ids, array[]::uuid[]))), 1), 0) then
    -- มี id ที่ไม่ผ่านเงื่อนไข (ลาออก/คนละแผนก) ปนมา — ไม่เงียบ ให้บอกไปเลย
    raise exception 'TECHNICIAN_NOT_FOUND';
  end if;

  -- ค่าที่ ผจก.ซ่อมบำรุงกรอก: บังคับครบตอนมอบหมายครั้งแรก ครั้งต่อไปไม่ส่งมา = คงค่าเดิม
  v_received  := coalesce(nullif(trim(coalesce(p_received_by_name, '')), ''), v_request.received_by_name);
  v_plan      := coalesce(nullif(trim(coalesce(p_execution_plan, '')), ''), v_request.execution_plan);
  v_opinion   := coalesce(nullif(trim(coalesce(p_inspector_opinion, '')), ''), v_request.inspector_opinion);
  v_start     := coalesce(p_work_started_date, v_request.work_started_date);
  v_expected  := coalesce(p_work_expected_date, v_request.work_expected_date);

  if v_plan is not null and v_plan not in ('immediate', 'need_purchase', 'use_existing') then
    raise exception 'INVALID_EXECUTION_PLAN';
  end if;
  if v_opinion is not null and v_opinion not in ('send_repair', 'external', 'self_repair', 'buy_parts') then
    raise exception 'INVALID_INSPECTOR_OPINION';
  end if;

  if v_first_assign then
    if v_received is null then raise exception 'RECEIVED_BY_REQUIRED'; end if;
    if v_plan is null then raise exception 'EXECUTION_PLAN_REQUIRED'; end if;
    if v_opinion is null then raise exception 'INSPECTOR_OPINION_REQUIRED'; end if;
    if v_start is null then raise exception 'WORK_START_DATE_REQUIRED'; end if;
    if v_expected is null then raise exception 'WORK_EXPECTED_DATE_REQUIRED'; end if;
  end if;
  if v_start is not null and v_expected is not null and v_expected < v_start then
    raise exception 'WORK_DATE_RANGE_INVALID';
  end if;

  -- เขียนรายชื่อช่างใหม่ทั้งชุด (ตัดคนที่ถูกเอาออก เพิ่มคนที่เพิ่มเข้ามา)
  delete from public.request_technicians
  where request_id = v_request.id and technician_id <> all(v_ids);

  insert into public.request_technicians (request_id, technician_id, assigned_by)
  select v_request.id, t.id, v_employee.id
  from unnest(v_ids) as t(id)
  on conflict (request_id, technician_id) do nothing;

  update public.requests
  set status = case when v_first_assign then 'assigned'::public.request_status else status end,
      assignee_id = v_ids[1],
      assigned_by = v_employee.id,
      assigned_at = now(),
      received_by_name = v_received,
      execution_plan = v_plan,
      inspector_opinion = v_opinion,
      work_started_date = v_start,
      work_expected_date = v_expected,
      last_changed_by = v_employee.id
  where id = v_request.id;

  -- หมุดความคืบหน้าตามแนวทางที่เลือก — สร้างเฉพาะที่ยังไม่มี ไม่ลบของเดิมที่กดไปแล้ว
  -- ทางที่ "ต้องรอของ" เท่านั้นที่มีหมุด ส่วน ซ่อมเอง/ทำได้ทันที/ใช้ของที่มี ไม่มีหมุด
  if v_plan = 'need_purchase' or v_opinion = 'buy_parts' then
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'purchase_ordered', 'สั่งซื้ออุปกรณ์เรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'purchase_received', 'ของมาส่งเรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
  end if;
  if v_opinion = 'send_repair' then
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'sent_out_repair', 'ส่งออกไปซ่อมเรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'returned_from_repair', 'รับกลับจากร้านซ่อมเรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
  end if;
  if v_opinion = 'external' then
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'external_booked', 'นัดหมายช่างภายนอกเรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
    v_sort := v_sort + 1;
    insert into public.request_progress_steps (request_id, step_key, step_label, sort_order)
    values (v_request.id, 'external_arrived', 'ช่างภายนอกเข้าหน้างานเรียบร้อย', v_sort)
    on conflict (request_id, step_key) do nothing;
  end if;

  -- แจ้งช่างทุกคนในชุด และแจ้งผู้แจ้งว่ามีช่างรับงานแล้ว (สเปกข้อ 04)
  foreach v_tech in array v_ids loop
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_tech, v_request.id,
      private.notify_title(v_request.id, 'ได้รับมอบหมายงานซ่อม'),
      v_request.request_no || ' · ' || coalesce(v_request.machine_name, v_request.title),
      '/requests/' || v_request.id::text
    );
  end loop;

  if v_first_assign then
    insert into public.notifications (recipient_id, request_id, title, body, action_url)
    values (
      v_request.requester_id, v_request.id,
      private.notify_title(v_request.id, 'มอบหมายช่างให้ใบแจ้งซ่อมของคุณแล้ว'),
      v_request.request_no || ' · ' || coalesce(v_request.machine_name, v_request.title),
      '/requests/' || v_request.id::text
    );
  end if;

  return v_request.id;
end;
$$;

revoke all on function public.app_assign_repair_technician(uuid, uuid[], text, text, text, date, date) from public, anon;
grant execute on function public.app_assign_repair_technician(uuid, uuid[], text, text, text, date, date) to authenticated;

-- ลายเซ็นเดิม (ช่างคนเดียว) ไม่มีผู้เรียกแล้ว — app.js ปรับตามในคอมมิตเดียวกัน
drop function if exists public.app_assign_repair_technician(uuid, uuid, date, date);

-- ---------------------------------------------------------------------------
-- 6. หมุดความคืบหน้า — ช่างในชุด กับ ผจก.ซ่อมบำรุง เท่านั้นที่กดได้
-- ---------------------------------------------------------------------------
create or replace function public.app_record_progress_step(
  p_step_id uuid,
  p_done_on date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_step public.request_progress_steps%rowtype;
  v_request public.requests%rowtype;
  v_type public.request_types%rowtype;
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

  select * into v_step
  from public.request_progress_steps
  where id = p_step_id
  for update;
  if v_step.id is null then
    raise exception 'STEP_NOT_FOUND';
  end if;

  select * into v_request from public.requests where id = v_step.request_id;
  select * into v_type from public.request_types where id = v_request.request_type_id;

  v_allowed := private.is_request_technician(v_request.id, v_employee.id)
    or exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('admin', 'department_manager')
        and (r.code = 'admin' or v_employee.department_id = v_type.owning_department_id)
    );
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.request_progress_steps
  set done_on = coalesce(p_done_on, current_date),
      recorded_by = v_employee.id,
      recorded_at = now()
  where id = v_step.id;

  -- แจ้งผู้แจ้ง + ผจก.ซ่อมบำรุง ว่างานขยับ (สเปก: หมุดคือการรายงานความคืบหน้าให้คนรอทราบ)
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'อัปเดตความคืบหน้างานซ่อม'),
         v_request.request_no || ' · ' || v_step.step_label,
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_step.id;
end;
$$;

revoke all on function public.app_record_progress_step(uuid, date) from public, anon;
grant execute on function public.app_record_progress_step(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. เริ่มงาน — ช่างคนใดก็ได้ในชุด (หรือ ผจก.ซ่อมบำรุง / admin)
-- ---------------------------------------------------------------------------
create or replace function public.app_start_repair_work(p_request_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_owning_department_id uuid;
  v_is_admin boolean;
  v_is_owning_department_manager boolean;
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

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'assigned' then
    raise exception 'REQUEST_NOT_ASSIGNED';
  end if;

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  v_is_owning_department_manager := v_owning_department_id is not null
    and v_employee.department_id = v_owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code = 'department_manager'
    );

  if not (v_is_admin or v_is_owning_department_manager
          or private.is_request_technician(v_request.id, v_employee.id)) then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

  update public.requests
  set status = 'in_progress',
      work_started_date = coalesce(work_started_date, current_date),
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_start_repair_work(uuid) from public, anon;
grant execute on function public.app_start_repair_work(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. จบงาน — ช่างในชุดเท่านั้น (admin เผื่อแก้ระบบ) กรอกแค่วิเคราะห์สาเหตุ + อะไหล่
-- ---------------------------------------------------------------------------
create or replace function public.app_finish_repair_work(
  p_request_id uuid,
  p_cause_analysis text,
  p_parts_used_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_is_admin boolean;
  v_item jsonb;
  v_name text;
  v_qty text;
  v_unit text;
  v_price text;
  v_shop text;
  v_note text;
  v_items jsonb := '[]'::jsonb;
  v_summary text := '';
  v_line text;
  v_n integer := 0;
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

  if char_length(trim(coalesce(p_cause_analysis, ''))) not between 3 and 5000 then
    raise exception 'INVALID_CAUSE_ANALYSIS';
  end if;
  if jsonb_typeof(coalesce(p_parts_used_items, '[]'::jsonb)) <> 'array' then
    raise exception 'INVALID_PARTS_USED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'in_progress' then
    raise exception 'REQUEST_NOT_IN_PROGRESS';
  end if;

  -- ผจก.โรงงาน/ผจก.ทั่วไป กดจบงานแทนช่างไม่ได้แล้ว (ยืนยันจากผู้ใช้) เหลือช่างในชุดกับ admin
  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  if not (v_is_admin or private.is_request_technician(v_request.id, v_employee.id)) then
    raise exception 'NOT_ASSIGNED_TECHNICIAN';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_parts_used_items, '[]'::jsonb))
  loop
    v_name := nullif(trim(coalesce(v_item->>'name', '')), '');
    continue when v_name is null;
    v_name := left(v_name, 200);
    v_qty := nullif(left(trim(coalesce(v_item->>'qty', '')), 50), '');
    v_unit := nullif(left(trim(coalesce(v_item->>'unit', '')), 50), '');
    v_price := nullif(left(trim(coalesce(v_item->>'price', '')), 50), '');
    v_shop := nullif(left(trim(coalesce(v_item->>'shop', '')), 200), '');
    v_note := nullif(left(trim(coalesce(v_item->>'note', '')), 500), '');

    v_n := v_n + 1;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'name', v_name, 'qty', v_qty, 'unit', v_unit, 'price', v_price, 'shop', v_shop, 'note', v_note
    ));

    v_line := v_n::text || '. ' || v_name;
    if v_qty is not null or v_unit is not null then
      v_line := v_line || ' / จำนวน ' || trim(both ' ' from concat_ws(' ', v_qty, v_unit));
    end if;
    if v_price is not null then
      v_line := v_line || ' / ราคา ' || v_price || ' บาท';
    end if;
    if v_shop is not null then
      v_line := v_line || ' / ร้าน ' || v_shop;
    end if;
    if v_note is not null then
      v_line := v_line || ' / หมายเหตุ ' || v_note;
    end if;
    v_summary := v_summary || case when v_n = 1 then '' else chr(10) end || v_line;
  end loop;

  update public.requests
  set status = 'pending_verify',
      cause_analysis = trim(p_cause_analysis),
      parts_used = nullif(v_summary, ''),
      parts_used_items = v_items,
      last_changed_by = v_employee.id
  where id = v_request.id;

  -- สเปกข้อ 06: แจ้งผู้แจ้งให้ไปลองใช้งาน และแจ้ง ผจก.ซ่อมบำรุงว่างานรอตรวจรับอยู่
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'ซ่อมเสร็จแล้ว รอตรวจรับ'),
         v_request.request_no || ' · ' || coalesce(v_request.machine_name, v_request.title),
         '/requests/' || v_request.id::text
  from (
    select v_request.requester_id as employee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_finish_repair_work(uuid, text, jsonb) from public, anon;
grant execute on function public.app_finish_repair_work(uuid, text, jsonb) to authenticated;

-- ลายเซ็นเดิมที่รับ execution_plan/inspector_opinion จากช่าง — ย้ายไปขั้นมอบหมายแล้ว
drop function if exists public.app_finish_repair_work(uuid, text, text, text, jsonb);

-- ---------------------------------------------------------------------------
-- 9. ตรวจรับ — ผู้แจ้งเท่านั้น (admin เผื่อแก้ระบบ) และแจ้งครบทุกฝ่ายทั้งผ่านและไม่ผ่าน
-- ---------------------------------------------------------------------------
create or replace function public.app_verify_repair(
  p_request_id uuid,
  p_result text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_is_admin boolean;
  v_note text;
  v_title text;
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

  if p_result not in ('pass', 'fail') then
    raise exception 'INVALID_RESULT';
  end if;
  v_note := nullif(trim(coalesce(p_note, '')), '');
  if p_result = 'fail' and coalesce(char_length(v_note), 0) < 3 then
    raise exception 'NOTE_REQUIRED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;
  if v_request.status <> 'pending_verify' then
    raise exception 'REQUEST_NOT_PENDING_VERIFY';
  end if;

  -- ผจก.โรงงาน/ผจก.ทั่วไป กดตรวจรับแทนผู้แจ้งไม่ได้แล้ว (ยืนยันจากผู้ใช้)
  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  if v_request.requester_id <> v_employee.id and not v_is_admin then
    raise exception 'NOT_AUTHORIZED';
  end if;

  insert into public.request_verifications (request_id, result, note, verified_by)
  values (v_request.id, p_result, v_note, v_employee.id);

  update public.requests
  set status = case when p_result = 'pass' then 'completed' else 'assigned' end::public.request_status,
      completed_at = case when p_result = 'pass' then now() else completed_at end,
      last_changed_by = v_employee.id
  where id = v_request.id;

  v_title := case when p_result = 'pass'
                  then 'ตรวจรับผ่าน ปิดงานแล้ว'
                  else 'ตรวจรับไม่ผ่าน ต้องซ่อมเพิ่มเติม' end;

  -- สเปกข้อ 07: ทั้งผ่านและไม่ผ่าน แจ้งช่างทุกคนในชุด + ผจก.ซ่อมบำรุง
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, v_title),
         v_request.request_no || coalesce(' · ' || v_note, ''),
         '/requests/' || v_request.id::text
  from (
    select rt.technician_id as employee_id from public.request_technicians rt where rt.request_id = v_request.id
    union
    select v_request.assignee_id
    union
    select m.employee_id from private.owning_department_managers(v_request.id) m
  ) x
  where x.employee_id is not null and x.employee_id <> v_employee.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_verify_repair(uuid, text, text) from public, anon;
grant execute on function public.app_verify_repair(uuid, text, text) to authenticated;
