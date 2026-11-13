-- ============================================================================
-- กระดานติดตามสถานะ: คืนกำหนดเสร็จ (work_expected_date) ของใบแจ้งซ่อมด้วย
--
-- เหตุผล: รายการของแต่ละโมดูลขึ้นป้าย "เลยกำหนดเสร็จ" ให้ใบที่รอเริ่มงาน/กำลังซ่อมแล้วเลยวันที่
--   ผู้จัดการแผนกซ่อมบำรุงกำหนดไว้ แต่กระดานสถานะ (#/board) ไม่มีวันที่นี้ ใบเดียวกันจึงขึ้นป้ายในที่หนึ่ง
--   และไม่ขึ้นในอีกที่หนึ่ง
--
-- เปลี่ยน: เพิ่มคอลัมน์ work_expected_date (date) ต่อท้ายผลลัพธ์ เป็นข้อมูลระดับติดตามสถานะ
--   (วันที่อย่างเดียว ไม่มีรายละเอียดอาการ/ความเห็น) ส่วนอื่นของฟังก์ชันเหมือนเดิมทุกบรรทัด
--
-- เริ่มจากนิยามบน production (md5(pg_get_functiondef) = bf8401cc1c659eb678eb5ee9596c381f)
--   = 20260921030000_request_status_board.sql + บรรทัด perform private.lab_only_block();
--   ที่ private.lab_only_guard_functions() (20261019005000_lab_only_accounts.sql) เติมไว้
--
-- การเพิ่มคอลัมน์ใน returns table ต้อง drop แล้ว create ใหม่ (create or replace เปลี่ยนชนิดผลลัพธ์ไม่ได้)
--   สิทธิ์จึงตั้งใหม่ให้ตรงกับเดิม: authenticated และ service_role เรียกได้ public/anon เรียกไม่ได้
--
-- ความเข้ากันได้: Pilot Web อ่านคอลัมน์ตามชื่อ หน้าเว็บที่ยังไม่อัปเดตไม่สนใจคอลัมน์ใหม่
--   และหน้าเว็บใหม่ที่เจอฐานข้อมูลเดิม (ไม่มีคอลัมน์นี้) แค่ไม่ขึ้นป้าย
--
-- Rollback: drop function public.app_request_status_board(text, text, integer); แล้วสร้างจากนิยามเดิม
--   (20260921030000 + บรรทัด lab_only_block) และให้สิทธิ์แบบเดียวกับท้ายไฟล์นี้ ไม่มีข้อมูลถูกแก้
-- ============================================================================

drop function public.app_request_status_board(text, text, integer);

create function public.app_request_status_board(
  p_status text default null,
  p_search text default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  request_no text,
  subject text,
  type_code text,
  type_name_th text,
  uses_repair_workflow boolean,
  department_code text,
  department_name text,
  machine_code text,
  machine_name text,
  requester_name text,
  assignee_name text,
  waiting_on text,
  current_step_name text,
  steps_total integer,
  steps_done integer,
  status text,
  priority text,
  is_urgent boolean,
  submitted_at timestamptz,
  approved_at timestamptz,
  completed_at timestamptz,
  last_changed_at timestamptz,
  can_open boolean,
  work_expected_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee_id uuid;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  perform private.lab_only_block();
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  v_employee_id := private.current_employee_id();
  if v_employee_id is null then
    raise exception 'EMPLOYEE_NOT_FOUND';
  end if;

  return query
  select
    r.id,
    r.request_no,
    case
      when t.uses_repair_workflow then coalesce(
        nullif(
          concat_ws(
            ' · ',
            nullif(r.machine_code, ''),
            nullif(case when r.machine_name = r.machine_code then null else r.machine_name end, '')
          ),
          ''
        ),
        t.name_th
      )
      else r.title
    end as subject,
    t.code as type_code,
    t.name_th as type_name_th,
    t.uses_repair_workflow,
    d.code as department_code,
    d.name_th as department_name,
    r.machine_code,
    r.machine_name,
    coalesce(
      nullif(trim(coalesce(r.requester_name, '')), ''),
      nullif(trim(coalesce(req.first_name, '') || ' ' || coalesce(req.last_name, '')), '')
    ) as requester_name,
    nullif(trim(coalesce(asg.first_name, '') || ' ' || coalesce(asg.last_name, '')), '') as assignee_name,
    case r.status
      when 'pending_approval' then step.approver_label
      when 'more_info' then coalesce(
        nullif(trim(coalesce(r.requester_name, '')), ''),
        nullif(trim(coalesce(req.first_name, '') || ' ' || coalesce(req.last_name, '')), '')
      )
      when 'pending_assign' then
        'ผู้จัดการแผนก' || coalesce(' ' || own.name_th, '')
      when 'approved' then coalesce(
        nullif(trim(coalesce(asg.first_name, '') || ' ' || coalesce(asg.last_name, '')), ''),
        'ผู้ปฏิบัติงาน'
      )
      when 'assigned' then coalesce(
        nullif(trim(coalesce(asg.first_name, '') || ' ' || coalesce(asg.last_name, '')), ''),
        'ช่างผู้รับผิดชอบ'
      )
      when 'in_progress' then coalesce(
        nullif(trim(coalesce(asg.first_name, '') || ' ' || coalesce(asg.last_name, '')), ''),
        'ผู้ปฏิบัติงาน'
      )
      when 'pending_verify' then coalesce(
        nullif(trim(coalesce(r.requester_name, '')), ''),
        nullif(trim(coalesce(req.first_name, '') || ' ' || coalesce(req.last_name, '')), ''),
        'ผู้แจ้ง'
      )
      else null
    end as waiting_on,
    case
      when r.status in ('pending_approval', 'more_info') then step.step_name
      else null
    end as current_step_name,
    coalesce(tally.steps_total, 0)::integer as steps_total,
    coalesce(tally.steps_done, 0)::integer as steps_done,
    r.status::text,
    r.priority::text,
    r.is_urgent,
    r.submitted_at,
    r.approved_at,
    r.completed_at,
    r.updated_at as last_changed_at,
    private.can_access_request(r.id) as can_open,
    r.work_expected_date
  from public.requests r
  join public.request_types t on t.id = r.request_type_id
  join public.departments d on d.id = r.department_id
  left join public.departments own on own.id = t.owning_department_id
  left join public.employees req on req.id = r.requester_id
  left join public.employees asg on asg.id = r.assignee_id
  left join lateral (
    select
      s.step_name,
      coalesce(
        nullif(trim(coalesce(ae.first_name, '') || ' ' || coalesce(ae.last_name, '')), ''),
        ar.name_th,
        s.step_name
      ) as approver_label
    from public.approval_steps s
    left join public.employees ae on ae.id = s.approver_employee_id
    left join public.roles ar on ar.id = s.approver_role_id
    where s.request_id = r.id and s.step_order = r.current_step
    limit 1
  ) step on true
  left join lateral (
    select
      count(*) as steps_total,
      count(*) filter (where s.status = 'approved') as steps_done
    from public.approval_steps s
    where s.request_id = r.id
  ) tally on true
  where r.status <> 'draft'
    and (p_status is null or p_status = 'all' or r.status::text = p_status)
    and (
      v_search is null
      or r.request_no ilike '%' || v_search || '%'
      or coalesce(r.machine_code, '') ilike '%' || v_search || '%'
      or coalesce(r.machine_name, '') ilike '%' || v_search || '%'
      or coalesce(r.requester_name, '') ilike '%' || v_search || '%'
      or d.name_th ilike '%' || v_search || '%'
      or (not t.uses_repair_workflow and r.title ilike '%' || v_search || '%')
    )
  order by r.submitted_at desc
  limit v_limit;
end;
$$;

revoke all on function public.app_request_status_board(text, text, integer) from public, anon;
grant execute on function public.app_request_status_board(text, text, integer) to authenticated, service_role;
