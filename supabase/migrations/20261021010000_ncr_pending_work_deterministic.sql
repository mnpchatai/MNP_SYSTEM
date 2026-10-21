-- ตัวเตือนงานค้าง (NCR): เลือกรายการเดียวต่อ (ผู้ถือ, ใบ) ให้ได้ผลเดิมทุกรอบ
--
-- เดิม private.pending_work_items ใช้ distinct on (holder_id, item_type, item_id) เรียงด้วย waiting_since อย่างเดียว
-- ใบที่ awaiting_followup และยังไม่มีแนวทางป้องกัน มี 2 รายการสำหรับคนที่อยู่ทั้ง audience 'qa' และ 'responsible_managers'
-- (เช่น พนักงานหรือ ผจก. แผนก QA เมื่อ QA เป็นแผนกที่รับผิดชอบของใบนั้น): "ติดตามผลการแก้ไข" (ไม่มี due_date) กับ
-- "ส่งแนวทางป้องกัน" (due_date = prevention_due) สองรายการใช้ n.since เท่ากัน รายการที่ถูกเลือกจึงไม่แน่นอน
-- และอาจสลับกันระหว่างรอบ
--
-- ตอนนี้: เมื่อ waiting_since เท่ากัน เลือกรายการที่มี due_date ก่อน (คือ "ส่งแนวทางป้องกัน" เพราะ QA ปิดประเด็นไม่ได้
-- จนกว่าจะมีแนวทางป้องกัน) แล้วเรียงตามข้อความ action เพื่อให้ผลแน่นอนทุกกรณี เมื่อส่งแนวทางป้องกันแล้วรายการนั้นหายไป
-- และเหลือ "ติดตามผลการแก้ไข" ตามเดิม
--
-- ไม่เปลี่ยนตาราง คอลัมน์ผลลัพธ์ หรือกรณีอื่น (ถ้า waiting_since ต่างกัน ยังเลือกรายการที่รอนานกว่าเหมือนเดิม)
-- ไม่มี client ที่พึ่ง migration นี้ ระบบจริงไม่เปลี่ยนจนกว่าจะ apply ขึ้นฐานข้อมูล
--
-- (คัดจากนิยามล่าสุดใน 20261015010000_ncr_prevention_after_response.sql เปลี่ยนเฉพาะบรรทัด order by ท้ายฟังก์ชัน)
-- Rollback: นำนิยาม private.pending_work_items จาก 20261015010000_ncr_prevention_after_response.sql กลับมา

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
  order by i.holder_id, i.item_type, i.item_id, i.waiting_since, i.due_date nulls last, i.action
$$;
revoke all on function private.pending_work_items(timestamptz) from public, anon, authenticated;
