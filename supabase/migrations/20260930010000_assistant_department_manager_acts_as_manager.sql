-- ให้ "ผู้ช่วยผู้จัดการแผนก" (assistant_department_manager) ทำแทน "ผู้จัดการแผนก" ได้ทุกจุดที่
-- RPC/RLS ตรวจจาก role code 'department_manager' — เป็นรากฐานให้ปรับตำแหน่งขึ้นเป็นผู้จัดการแผนกได้
-- โดยสิทธิ์ไม่เปลี่ยนตามตัวบุคคล
--
-- ทุกฟังก์ชันด้านล่างคัดลอกจากนิยามล่าสุดใน migration ก่อนหน้า (ระบุไว้ที่หัวแต่ละตัว) แล้วเปลี่ยน
-- เฉพาะเงื่อนไข role code: 'department_manager' -> in ('department_manager', 'assistant_department_manager')
-- create or replace คงสิทธิ์ grant/revoke เดิมไว้ ไม่ต้อง grant ซ้ำ
--
-- Rollback: apply นิยามเดิมจาก migration ที่ระบุที่หัวแต่ละฟังก์ชันอีกครั้ง


-- private.can_access_request (จาก 20260922050000_cc_department_notify_on_approval.sql)
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
            and me_role.code in ('department_manager', 'assistant_department_manager')
            and rt.owning_department_id is not null
            and rt.owning_department_id = me.department_id
            and r.status <> 'draft'
        )
        -- ใหม่: แผนกที่ถูกติ๊ก "สำเนาถึงแผนก" อ่านได้ก็ต่อเมื่ออนุมัติผ่านครบแล้วเท่านั้น
        or (
          r.status = 'approved'
          and me.department_id = any(r.cc_department_ids)
        )
      )
  )
$$;

-- private.owning_department_managers (จาก 20260921090000_repair_workflow_spec_alignment.sql)
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
  join public.roles ro on ro.id = e.role_id and ro.code in ('department_manager', 'assistant_department_manager')
  where r.id = p_request_id
$$;

-- public.app_assign_repair_technician (จาก 20260921110000_drop_received_by_name_requirement.sql)
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
  if v_request.status in ('rejected', 'pending_approval', 'more_info', 'draft') then
    raise exception 'REQUEST_NOT_ASSIGNABLE';
  end if;

  select * into v_type
  from public.request_types
  where id = v_request.request_type_id;

  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  if not v_is_admin and not (
    v_type.owning_department_id is not null
    and v_employee.department_id = v_type.owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('department_manager', 'assistant_department_manager')
    )
  ) then
    raise exception 'NOT_AUTHORIZED';
  end if;

  v_first_assign := v_request.status = 'pending_assign';

  select array_agg(distinct e.id) into v_ids
  from unnest(coalesce(p_technician_ids, array[]::uuid[])) as t(id)
  join public.employees e on e.id = t.id
  where e.is_active and e.department_id = v_type.owning_department_id;

  v_count := coalesce(array_length(v_ids, 1), 0);
  if v_count = 0 then
    raise exception 'TECHNICIAN_NOT_FOUND';
  end if;
  if v_count <> coalesce(array_length(array(select distinct unnest(coalesce(p_technician_ids, array[]::uuid[]))), 1), 0) then
    raise exception 'TECHNICIAN_NOT_FOUND';
  end if;

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

  -- ตัด "if v_received is null then raise exception 'RECEIVED_BY_REQUIRED'" ออก — ไม่บังคับแล้ว
  if v_first_assign then
    if v_plan is null then raise exception 'EXECUTION_PLAN_REQUIRED'; end if;
    if v_opinion is null then raise exception 'INSPECTOR_OPINION_REQUIRED'; end if;
    if v_start is null then raise exception 'WORK_START_DATE_REQUIRED'; end if;
    if v_expected is null then raise exception 'WORK_EXPECTED_DATE_REQUIRED'; end if;
  end if;
  if v_start is not null and v_expected is not null and v_expected < v_start then
    raise exception 'WORK_DATE_RANGE_INVALID';
  end if;

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

-- public.app_start_repair_work (จาก 20260921090000_repair_workflow_spec_alignment.sql)
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
      where r.id = v_employee.role_id and r.code in ('department_manager', 'assistant_department_manager')
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

-- public.app_record_progress_step (จาก 20260922030000_purchase_progress_expected_delivery.sql)
create or replace function public.app_record_progress_step(
  p_step_id uuid,
  p_done_on date default null,
  p_received_now boolean default null,
  p_expected_on date default null
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
  v_done_on date;
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
      where r.id = v_employee.role_id and r.code in ('admin', 'department_manager', 'assistant_department_manager')
        and (r.code = 'admin' or v_employee.department_id = v_type.owning_department_id)
    );
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  -- หมุด "สั่งซื้ออุปกรณ์เรียบร้อย" ต้องเลือกอย่างใดอย่างหนึ่งเสมอ: รับของทันที หรือระบุวันที่คาดว่าจะมาส่ง
  if v_step.step_key = 'purchase_ordered' and not coalesce(p_received_now, false) and p_expected_on is null then
    raise exception 'EXPECTED_DATE_REQUIRED';
  end if;

  v_done_on := coalesce(p_done_on, current_date);

  update public.request_progress_steps
  set done_on = v_done_on,
      recorded_by = v_employee.id,
      recorded_at = now()
  where id = v_step.id;

  if v_step.step_key = 'purchase_ordered' then
    if coalesce(p_received_now, false) then
      -- รับของพร้อมสั่งซื้อ — ปิดหมุด "ของมาส่งเรียบร้อย" ให้พร้อมกันเลย ไม่ต้องรอกดซ้ำอีกที
      update public.request_progress_steps
      set done_on = v_done_on,
          recorded_by = v_employee.id,
          recorded_at = now(),
          expected_on = null,
          reminder_last_sent_on = null
      where request_id = v_step.request_id and step_key = 'purchase_received' and done_on is null;
    else
      -- ยังไม่ได้ของ — ตั้งวันที่คาดว่าจะมาส่งไว้ที่หมุด "ของมาส่งเรียบร้อย" ให้ pg_cron ใช้เตือนภายหลัง
      update public.request_progress_steps
      set expected_on = p_expected_on,
          reminder_last_sent_on = null
      where request_id = v_step.request_id and step_key = 'purchase_received' and done_on is null;
    end if;
  end if;

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

-- public.app_reschedule_progress_step (จาก 20260922030000_purchase_progress_expected_delivery.sql)
create or replace function public.app_reschedule_progress_step(
  p_step_id uuid,
  p_expected_on date
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
  if p_expected_on is null then
    raise exception 'EXPECTED_DATE_REQUIRED';
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
  if v_step.done_on is not null then
    raise exception 'STEP_ALREADY_DONE';
  end if;

  select * into v_request from public.requests where id = v_step.request_id;
  select * into v_type from public.request_types where id = v_request.request_type_id;

  v_allowed := private.is_request_technician(v_request.id, v_employee.id)
    or exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('admin', 'department_manager', 'assistant_department_manager')
        and (r.code = 'admin' or v_employee.department_id = v_type.owning_department_id)
    );
  if not v_allowed then
    raise exception 'NOT_AUTHORIZED';
  end if;

  update public.request_progress_steps
  set expected_on = p_expected_on,
      reminder_last_sent_on = null
  where id = v_step.id;

  -- ของยังไม่มาตามนัด แจ้งผู้แจ้ง + ผจก.ซ่อมบำรุงเหมือนตอนบันทึกหมุด กันเข้าใจผิดว่าของถึงแล้ว
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select x.employee_id, v_request.id,
         private.notify_title(v_request.id, 'เลื่อนวันที่คาดว่าของจะมาส่ง'),
         v_request.request_no || ' · ' || v_step.step_label || ' · คาดว่าจะมาส่ง ' || to_char(p_expected_on, 'DD/MM/YYYY'),
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

-- public.app_finish_repair_work (จาก 20260921120000_allow_dept_manager_finish_repair_work.sql)
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
  v_owning_department_id uuid;
  v_is_admin boolean;
  v_is_owning_department_manager boolean;
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

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  -- ผจก.โรงงาน/ผจก.ทั่วไป กดจบงานแทนช่างไม่ได้ (ยืนยันจากผู้ใช้) เหลือช่างในชุด + หัวหน้าแผนก
  -- ซ่อมบำรุงเจ้าของงาน + admin — เงื่อนไขเดียวกับปุ่มเริ่มงาน/หมุดความคืบหน้า
  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  v_is_owning_department_manager := v_owning_department_id is not null
    and v_employee.department_id = v_owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('department_manager', 'assistant_department_manager')
    );
  if not (v_is_admin or v_is_owning_department_manager
          or private.is_request_technician(v_request.id, v_employee.id)) then
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

-- public.app_save_repair_work_progress (จาก 20260922020000_save_repair_work_progress.sql)
create or replace function public.app_save_repair_work_progress(
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
  v_owning_department_id uuid;
  v_is_admin boolean;
  v_is_owning_department_manager boolean;
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

  -- ต่างจาก app_finish_repair_work ตรงที่ยอมให้บันทึกค่าว่าง/ไม่ครบได้ (แค่บันทึกความคืบหน้า)
  if char_length(coalesce(p_cause_analysis, '')) > 5000 then
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

  select owning_department_id into v_owning_department_id
  from public.request_types
  where id = v_request.request_type_id;

  -- เงื่อนไขสิทธิ์เดียวกับ app_finish_repair_work: ช่างในชุด + หัวหน้าแผนกซ่อมบำรุงเจ้าของงาน + admin
  v_is_admin := exists (
    select 1 from public.roles r
    where r.id = v_employee.role_id and r.code = 'admin'
  );
  v_is_owning_department_manager := v_owning_department_id is not null
    and v_employee.department_id = v_owning_department_id
    and exists (
      select 1 from public.roles r
      where r.id = v_employee.role_id and r.code in ('department_manager', 'assistant_department_manager')
    );
  if not (v_is_admin or v_is_owning_department_manager
          or private.is_request_technician(v_request.id, v_employee.id)) then
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

  -- ไม่แตะ status และไม่ insert notifications — แค่บันทึกความคืบหน้า ไม่ใช่การจบงาน
  update public.requests
  set cause_analysis = nullif(trim(coalesce(p_cause_analysis, '')), ''),
      parts_used = nullif(v_summary, ''),
      parts_used_items = v_items,
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;
