-- ตัดข้อบังคับ "ชื่อผู้จัดการที่รับใบ" ออกจากขั้นมอบหมายช่าง
--
-- 20260921090000/100000 เพิ่มช่องนี้ตามสเปกระบบเดิมและบังคับกรอกตอนมอบหมายครั้งแรก แต่ผู้ใช้จริง
-- ไม่ต้องการช่องนี้แล้ว (ทำให้กดมอบหมายงานไม่ผ่านเพราะ browser ค้างที่ required field) — เอา
-- ช่องออกจากฟอร์มฝั่ง Pilot Web แล้ว (app.js) จึงต้องตัดข้อบังคับฝั่ง RPC ตามไปด้วย ไม่งั้นเรียกไม่ผ่าน
--
-- คอลัมน์ received_by_name และพารามิเตอร์ p_received_by_name ยังอยู่ครบ (ใบเก่าที่กรอกไว้แล้วยังอ่าน/
-- แสดงผลได้ตามปกติ) เปลี่ยนแค่ตัดเงื่อนไขบังคับตอน v_first_assign ออกเท่านั้น
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
      where r.id = v_employee.role_id and r.code = 'department_manager'
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

revoke all on function public.app_assign_repair_technician(uuid, uuid[], text, text, text, date, date) from public, anon;
grant execute on function public.app_assign_repair_technician(uuid, uuid[], text, text, text, date, date) to authenticated;
