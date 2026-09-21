-- ============================================================================
-- ผจก.โรงงาน/ผจก.ทั่วไป ต้องไม่เข้ามายุ่งในขั้นตอนของช่าง
--
-- 20260921090000 ตัดสิทธิ์สองคนนี้ออกจาก "จบงาน" กับ "ตรวจรับ" ไปแล้ว แต่เหลืออีกสองทางที่ยังเข้าได้
-- เพราะใช้ has_permission('requests.view_all') เป็นเกณฑ์ข้ามการตรวจ ซึ่งทั้ง factory_manager และ
-- general_manager ถือสิทธิ์นั้นอยู่ (ดู 20260919000000_unify_position_and_role บรรทัด 65-73)
--
--   1) app_assign_repair_technician — มอบหมาย/เปลี่ยนช่างได้ ทั้งที่การแจกจ่ายงานเป็นหน้าที่
--      ผจก.แผนกซ่อมบำรุงคนเดียว (ผู้ใช้เจอกับตัว: ผจก.โรงงานเปิดใบ FT044/26 แล้วเห็นฟอร์มมอบหมายช่าง)
--
--   2) app_update_request_status — ร้ายกว่าข้อแรก ฟังก์ชันนี้รับ p_status = 'completed' เมื่อใบอยู่
--      สถานะ in_progress ซึ่งใบแจ้งซ่อม "ผ่านสถานะนั้นจริง" คนที่มี requests.operate/view_all จึง
--      เรียกตรงๆ เพื่อปิดงานได้ โดยข้ามทั้งการบันทึกผลซ่อมของช่างและการตรวจรับของผู้แจ้ง
--      (หน้าเว็บไม่เคยแสดงปุ่มนี้กับใบแจ้งซ่อม แต่ RPC เปิดรับอยู่ = บังคับจริงไม่ได้)
--
-- เกณฑ์ที่ใช้ตั้งแต่นี้: ใบแจ้งซ่อมทุกขั้นหลังอนุมัติ ข้ามได้เฉพาะ role 'admin' จริงเท่านั้น
-- ตรงกับที่ 20260921050000 และ 20260921090000 ทำไว้แล้วกับปุ่มเริ่มงาน/จบงาน/ตรวจรับ/หมุด
-- ============================================================================

-- 1. มอบหมาย/เปลี่ยนช่าง — ผจก.แผนกเจ้าของประเภทเอกสาร กับ admin เท่านั้น
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

  -- เดิมเป็น has_permission('requests.view_all') ซึ่งรวม ผจก.โรงงาน/ผจก.ทั่วไป — ตัดออก
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

-- 2. เปลี่ยนสถานะแบบทั่วไป — ห้ามแตะใบแจ้งซ่อมเด็ดขาด ใบแจ้งซ่อมมี RPC ของตัวเองครบทุกขั้นแล้ว
create or replace function public.app_update_request_status(p_request_id uuid, p_status text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_request public.requests%rowtype;
  v_uses_repair boolean;
  v_is_admin boolean;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if p_status not in ('in_progress', 'completed') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_employee
  from public.employees
  where auth_user_id = auth.uid() and is_active
  limit 1;
  if v_employee.id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  v_is_admin := private.has_permission('requests.view_all');
  if not v_is_admin and not private.has_permission('requests.operate') then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_request
  from public.requests
  where id = p_request_id
  for update;
  if v_request.id is null then
    raise exception 'REQUEST_NOT_FOUND';
  end if;

  -- ใบแจ้งซ่อมต้องเดินผ่าน app_start_repair_work / app_finish_repair_work / app_verify_repair
  -- เท่านั้น ไม่งั้นคนที่มี requests.operate จะสั่ง in_progress → completed ปิดงานข้ามช่างและ
  -- ข้ามการตรวจรับของผู้แจ้งได้ตรงๆ (ใบแจ้งซ่อมผ่านสถานะ in_progress จริง จึงเข้าเงื่อนไขเดิมพอดี)
  select uses_repair_workflow into v_uses_repair
  from public.request_types
  where id = v_request.request_type_id;
  if coalesce(v_uses_repair, false) then
    raise exception 'REPAIR_USES_OWN_WORKFLOW';
  end if;

  if v_request.assignee_id is not null and v_request.assignee_id <> v_employee.id and not v_is_admin then
    raise exception 'ASSIGNED_TO_ANOTHER_OPERATOR';
  end if;
  if (p_status = 'in_progress' and v_request.status <> 'approved')
     or (p_status = 'completed' and v_request.status <> 'in_progress') then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.requests
  set status = p_status::public.request_status,
      assignee_id = coalesce(assignee_id, v_employee.id),
      completed_at = case when p_status = 'completed' then now() else null end,
      last_changed_by = v_employee.id
  where id = v_request.id;

  return v_request.id;
end;
$$;

revoke all on function public.app_update_request_status(uuid, text) from public, anon;
grant execute on function public.app_update_request_status(uuid, text) to authenticated;
