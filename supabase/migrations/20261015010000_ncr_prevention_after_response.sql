-- NCR ส่วนที่ 3: ตอบภายใน 5 วันระบุแค่สาเหตุและแนวทางแก้ไข แนวทางป้องกันส่งตามมาภายหลัง
--
-- เดิม app_ncr_respond บังคับกรอกแนวทางป้องกันพร้อมแนวทางแก้ไขในการตอบครั้งเดียว แต่การวิเคราะห์หา
-- แนวทางป้องกันไม่ให้เกิดซ้ำใช้เวลามากกว่า 5 วัน จึงแยกเป็นสองขั้น:
--   app_ncr_respond            (ภายในกำหนดตอบ = วันออกใบ + 5) บังคับ 4M+E, สาเหตุ, แนวทางแก้ไข
--                              แนวทางป้องกันไม่บังคับ (กรอกมาด้วยได้ถ้าพร้อม) -> awaiting_followup เหมือนเดิม
--   app_ncr_submit_prevention  (ใหม่) ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบส่ง/แก้แนวทางป้องกันระหว่างรอ QA ติดตามผล
--                              สถานะไม่เปลี่ยน บันทึกประวัติ 'prevention' และแจ้ง QA
--   app_ncr_followup           QA ส่งกลับได้เสมอ แต่ "ปิดประเด็น" ได้เมื่อมีแนวทางป้องกันแล้วเท่านั้น
--                              (NCR_PREVENTION_REQUIRED) เพื่อไม่ให้ใบปิดโดยไม่มีแนวทางป้องกัน
-- กำหนดเสร็จยังตั้งให้อัตโนมัติเหมือนเดิม: แก้ไข = กำหนดตอบ, ป้องกัน = กำหนดตอบ + 7 วัน
-- ตัวเตือนงานค้างเพิ่มรายการ "ส่งแนวทางป้องกัน" ให้แผนกที่รับผิดชอบ (กำหนด = prevention_due)
--
-- ไม่เปลี่ยนตาราง (ncr_reports.prevention เป็น nullable อยู่แล้ว) ใบเดิมที่ตอบครบแล้วไม่กระทบ
-- Rollback: drop function public.app_ncr_submit_prevention(uuid, text) แล้วนำนิยาม app_ncr_respond /
--   app_ncr_followup จาก 20261002020000_ncr_phase1.sql และ private.pending_work_items จาก
--   20261005060000_ncr_signoff_request_info.sql กลับมา (ใบที่อยู่ awaiting_followup โดยยังไม่มีแนวทางป้องกัน
--   ต้องให้แผนกส่งแนวทางป้องกันก่อน หรือ QA ส่งกลับให้ตอบใหม่)

-- ส่วนที่ 3 (ตอบภายใน 5 วัน): สาเหตุและแนวทางแก้ไขบังคับ แนวทางป้องกันไม่บังคับ
-- ส่งค่าว่าง = ยังไม่ส่ง (คงค่าที่เคยส่งไว้ เช่น กรณี QA ส่งกลับแล้วตอบใหม่) ถ้าส่งมาต้องมี 5–5,000 ตัวอักษร
-- (คัดจากนิยามล่าสุดใน 20261002020000_ncr_phase1.sql เปลี่ยนเฉพาะการตรวจและบันทึก prevention)
create or replace function public.app_ncr_respond(
  p_ncr_id uuid,
  p_causes text[],
  p_root_cause text,
  p_correction text,
  p_prevention text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_prevention text := nullif(trim(coalesce(p_prevention, '')), '');
begin
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if private.employee_role_code(v_employee.id) not in ('department_manager', 'assistant_department_manager')
     or not exists (
       select 1 from public.ncr_responsibilities r
       where r.ncr_id = v_ncr.id and r.department_id = v_employee.department_id
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status <> 'awaiting_response' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if coalesce(cardinality(p_causes), 0) = 0
     or not (p_causes <@ array['man', 'machine', 'material', 'method', 'measure', 'environment', 'other']::text[]) then
    raise exception 'INVALID_CAUSES';
  end if;
  if char_length(trim(coalesce(p_root_cause, ''))) not between 5 and 5000 then
    raise exception 'INVALID_ROOT_CAUSE';
  end if;
  if char_length(trim(coalesce(p_correction, ''))) not between 5 and 5000 then
    raise exception 'INVALID_CORRECTION';
  end if;
  if v_prevention is not null and char_length(v_prevention) not between 5 and 5000 then
    raise exception 'INVALID_PREVENTION';
  end if;

  update public.ncr_reports
  set status = 'awaiting_followup',
      causes = (select array_agg(distinct c) from unnest(p_causes) c),
      root_cause = trim(p_root_cause),
      correction = trim(p_correction),
      correction_due = v_ncr.response_due,
      prevention = coalesce(v_prevention, v_ncr.prevention),
      prevention_due = v_ncr.response_due + 7,
      responded_by = v_employee.id,
      responded_at = now()
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_followup', 'respond', null, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'qa', 'NCR ตอบกลับแล้ว รอ QA ติดตามผล', v_employee.id);
  return v_ncr.id;
end;
$$;

-- ส่วนที่ 3 (ภายหลัง): ส่ง/แก้แนวทางป้องกันไม่ให้เกิดซ้ำระหว่างรอ QA ติดตามผล — สถานะไม่เปลี่ยน
-- สิทธิ์เดียวกับ app_ncr_respond: ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบใบนั้น
create or replace function public.app_ncr_submit_prevention(p_ncr_id uuid, p_prevention text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
begin
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if private.employee_role_code(v_employee.id) not in ('department_manager', 'assistant_department_manager')
     or not exists (
       select 1 from public.ncr_responsibilities r
       where r.ncr_id = v_ncr.id and r.department_id = v_employee.department_id
     ) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status <> 'awaiting_followup' then
    raise exception 'INVALID_TRANSITION';
  end if;
  if char_length(trim(coalesce(p_prevention, ''))) not between 5 and 5000 then
    raise exception 'INVALID_PREVENTION';
  end if;

  update public.ncr_reports
  set prevention = trim(p_prevention)
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'prevention', null, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'qa', 'NCR แผนกส่งแนวทางป้องกันแล้ว', v_employee.id);
  return v_ncr.id;
end;
$$;

revoke all on function public.app_ncr_submit_prevention(uuid, text) from public, anon;
grant execute on function public.app_ncr_submit_prevention(uuid, text) to authenticated;

-- ส่วนที่ 4: QA ปิดประเด็นได้เมื่อแผนกส่งแนวทางป้องกันแล้วเท่านั้น ส่งกลับได้เสมอ
-- (คัดจากนิยามล่าสุดใน 20261002020000_ncr_phase1.sql เพิ่มเฉพาะ NCR_PREVENTION_REQUIRED)
create or replace function public.app_ncr_followup(
  p_ncr_id uuid,
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
  v_ncr public.ncr_reports%rowtype;
  v_next text;
begin
  v_employee := private.ncr_current_employee();
  if not private.is_qa_department(v_employee.department_id) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if p_result is null or p_result not in ('close', 'return') then
    raise exception 'INVALID_FOLLOWUP_RESULT';
  end if;
  if char_length(coalesce(p_note, '')) > 2000 then
    raise exception 'INVALID_NOTE';
  end if;
  if p_result = 'return' and char_length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'NCR_RETURN_NOTE_REQUIRED';
  end if;

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_followup' then
    raise exception 'INVALID_TRANSITION';
  end if;
  if p_result = 'close' and v_ncr.prevention is null then
    raise exception 'NCR_PREVENTION_REQUIRED';
  end if;

  v_next := case p_result when 'close' then 'awaiting_signoff' else 'awaiting_response' end;
  update public.ncr_reports
  set status = v_next,
      followup_note = nullif(trim(coalesce(p_note, '')), ''),
      followed_up_by = v_employee.id,
      followed_up_at = now(),
      response_due = case when p_result = 'return' then private.bangkok_today() + 5 else response_due end
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, v_next, 'followup_' || p_result, p_note, v_employee.id);
  if p_result = 'close' then
    perform private.ncr_notify(v_ncr.id, 'qa_managers', 'NCR รอลงนามปิด (ผจก.แผนก QA)', v_employee.id);
  else
    perform private.ncr_notify(v_ncr.id, 'responsible_managers', 'NCR ถูกส่งกลับให้แก้ไขคำตอบ', v_employee.id);
  end if;
  return v_ncr.id;
end;
$$;

-- ตัวเตือนงานค้าง: แผนกที่รับผิดชอบได้รายการ "ส่งแนวทางป้องกัน" จนกว่าจะส่ง (กำหนด = prevention_due)
-- (คัดจากนิยามล่าสุดใน 20261005060000_ncr_signoff_request_info.sql เปลี่ยนข้อความขั้นรอแผนกตอบ
--  และเพิ่มรายการแนวทางป้องกัน)
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
    select n.id, n.ncr_no, n.product_name, n.status, n.response_due, n.prevention, n.prevention_due,
           coalesce((select max(h.changed_at) from public.ncr_status_history h where h.ncr_id = n.id), n.created_at) as since,
           case n.status
             when 'awaiting_disposition' then 'factory'
             when 'awaiting_response' then 'responsible_managers'
             when 'awaiting_followup' then 'qa'
             when 'awaiting_info' then 'responsible_managers'
             else case
               when n.signoff_qa_at is null then 'qa_managers'
               when n.signoff_factory_at is null then 'factory'
               else 'general_manager'
             end
           end as audience,
           case n.status
             when 'awaiting_disposition' then 'ให้ความเห็นและเลือกแผนกที่รับผิดชอบ (ส่วนที่ 2)'
             when 'awaiting_response' then 'ตอบ NCR: สาเหตุและแนวทางแก้ไข (ส่วนที่ 3)'
             when 'awaiting_followup' then 'ติดตามผลการแก้ไข (ส่วนที่ 4)'
             when 'awaiting_info' then 'ให้ข้อมูลเพิ่มเติมที่ผู้ลงนามขอ'
             else 'ลงนามปิด NCR'
           end as action
    from public.ncr_reports n
    where n.status in ('awaiting_disposition', 'awaiting_response', 'awaiting_followup', 'awaiting_signoff', 'awaiting_info')
  ),
  all_items as (
    select h.holder_id, 'request'::text as item_type, r.id as item_id, r.request_no as doc_no, r.type_name as doc_label,
           r.title, r.status, h.action, h.since as waiting_since, h.due_date, r.is_urgent
    from request_holders h join req r on r.id = h.id
    union all
    select a.employee_id, 'ncr', n.id, n.ncr_no, 'NCR', n.product_name, n.status, n.action, n.since,
           case when n.status = 'awaiting_response' then n.response_due end, false
    from ncr n cross join lateral private.ncr_audience(n.id, n.audience) a
    union all
    select a.employee_id, 'ncr', n.id, n.ncr_no, 'NCR', n.product_name, n.status,
           'ส่งแนวทางป้องกันไม่ให้เกิดซ้ำ (ส่วนที่ 3)', n.since, n.prevention_due, false
    from ncr n cross join lateral private.ncr_audience(n.id, 'responsible_managers') a
    where n.status = 'awaiting_followup' and n.prevention is null
  )
  select distinct on (i.holder_id, i.item_type, i.item_id)
         i.holder_id, i.item_type, i.item_id, i.doc_no, i.doc_label, i.title, i.status, i.action,
         i.waiting_since, i.due_date, i.is_urgent
  from all_items i
  join public.employees e on e.id = i.holder_id and e.is_active
  order by i.holder_id, i.item_type, i.item_id, i.waiting_since
$$;
revoke all on function private.pending_work_items(timestamptz) from public, anon, authenticated;
