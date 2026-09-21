-- ============================================================================
-- กระดานติดตามสถานะคำร้อง (อ่านอย่างเดียว) — ให้ "ทุกคน" เห็นว่าแต่ละใบไปถึงขั้นไหนแล้ว
--
-- ปัญหาเดิม: RLS ของ public.requests ใช้ private.can_access_request ซึ่งเปิดให้เห็นเฉพาะ
--   ใบของตัวเอง · ใบที่ตัวเองเป็นผู้รับผิดชอบ · ใบที่ตัวเองเป็นผู้อนุมัติขั้นใดขั้นหนึ่ง ·
--   หรือคนที่มีสิทธิ์ requests.view_all / requests.operate
-- พนักงานทั่วไปจึงมองไม่เห็นเลยว่าใบแจ้งซ่อมของแผนกอื่น (หรือใบที่ตัวเองไม่ได้แจ้งเอง)
-- เดินไปถึงขั้นไหนแล้ว ต้องไปถามกันเองนอกระบบ
--
-- ทางแก้: ไม่แตะ RLS ของตารางใด ๆ ทั้งสิ้น — รายละเอียดอาการ (description) ไฟล์แนบ
-- ความเห็นผู้อนุมัติ ประวัติสถานะ และการตรวจรับ ยังปิดตามสิทธิ์เดิมทุกประการ แต่เพิ่ม
-- ฟังก์ชัน security definer ตัวนี้ซึ่งคืน "เฉพาะข้อมูลระดับติดตามสถานะ" ให้พนักงานที่ยัง
-- active ทุกคนอ่านได้ คือ เลขที่ใบ · ประเภท · แผนกที่แจ้ง · เครื่องจักร · ผู้แจ้ง ·
-- สถานะและขั้นที่ไปถึง · คนที่ต้องดำเนินการต่อ · ช่างผู้รับผิดชอบ · วันที่
--
-- สิ่งที่ตั้งใจไม่คืนออกไป เพราะไม่ใช่ข้อมูลติดตามสถานะ:
--   - requests.description / details (รายละเอียดอาการเสีย เหตุผลทางธุรกิจ ฯลฯ)
--   - requests.title ของใบแจ้งซ่อม เพราะ app_create_repair_request ประกอบ title จาก
--     "<ชื่อเครื่องจักร> — <รายละเอียดอาการ>" การส่ง title ออกไปจึงเท่ากับส่ง description
--     ออกไปด้วย ใบแจ้งซ่อมจึงคืน subject เป็นรหัส/ชื่อเครื่องจักรแทน
--   - approval_steps.comment, request_verifications.note, cause_analysis, parts_used
--
-- can_open บอกฝั่ง UI ว่าผู้เรียกมีสิทธิ์เปิดดูใบนั้นเต็ม ๆ หรือไม่ จะได้ทำเป็นลิงก์เฉพาะ
-- ใบที่กดเข้าไปแล้วเห็นจริง (ตัวบังคับสิทธิ์จริงยังเป็น RLS ในหน้ารายละเอียดเหมือนเดิม)
-- ============================================================================
create or replace function public.app_request_status_board(
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
  can_open boolean
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
    private.can_access_request(r.id) as can_open
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
grant execute on function public.app_request_status_board(text, text, integer) to authenticated;
