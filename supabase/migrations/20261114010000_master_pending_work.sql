-- ============================================================================
-- หน้า #/master แท็บ "งานค้าง": งานที่รอใครสักคนทำอยู่ทั้งบริษัท (คำร้องและ NCR) อ่านได้เฉพาะบัญชี master
--
-- ใช้กติกาเดียวกับอีเมลเตือนงานค้าง (private.pending_work_items จาก
-- 20261021010000_ncr_pending_work_deterministic.sql) ไม่เขียนกติกา "ใครต้องทำอะไร" ซ้ำ:
--   - หนึ่งแถวต่อ (เอกสาร, สิ่งที่ต้องทำ) พร้อมรายชื่อผู้ที่ทำได้ (holders) และจำนวนวันที่ค้าง (เวลาไทย)
--   - NCR ทดสอบ (is_test) ไม่ถูกนับ
--   - เพิ่มงานที่ "ไม่มีผู้รับผิดชอบ": เอกสารที่ยังรอขั้นถัดไปแต่ pending_work_items ไม่พบผู้ทำที่ใช้งานอยู่
--     (เช่น ผู้แจ้งหรือช่างถูกปิดบัญชี หรือไม่มีใครถือบทบาทของขั้นนั้น) holders เป็น [] และ action บอกขั้นที่รอ
--     คำร้องที่นับ: pending_approval, more_info, pending_assign, assigned, pending_verify ทุกใบที่ไม่มีผู้ทำ,
--     in_progress ของงานซ่อมที่ไม่มีช่าง (ผู้รับงาน/ช่างในใบ) ที่ใช้งานอยู่เลย (ใบที่ช่างยังอยู่และยังไม่เลยกำหนด
--     ไม่ใช่งานค้าง), approved ของคำร้องที่ไม่ใช่งานซ่อมและไม่ใช่ MANAGEMENT ที่ไม่มีผู้รับงาน · NCR: ทุกสถานะที่ยังไม่ปิด/ยกเลิก
--
-- ไม่มีการเขียนข้อมูล ไม่มีตารางใหม่ ไม่ได้ redefine ฟังก์ชันเดิม
-- Rollback: drop function public.app_master_pending_work();
-- ============================================================================

create or replace function public.app_master_pending_work()
returns table (
  item_type text,
  item_id uuid,
  doc_no text,
  doc_label text,
  title text,
  status text,
  action text,
  waiting_since timestamptz,
  days_waiting integer,
  due_date date,
  is_urgent boolean,
  holders jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  perform private.lab_only_block();
  perform private.assert_master();

  return query
  with items as (
    select w.*
    from private.pending_work_items(now()) w
    where w.item_type <> 'ncr'
       or exists (select 1 from public.ncr_reports n where n.id = w.item_id and not n.is_test)
  ),
  grouped as (
    select i.item_type, i.item_id, i.doc_no, i.doc_label, i.title, i.status, i.action,
           min(i.waiting_since) as waiting_since,
           min(i.due_date) as due_date,
           bool_or(i.is_urgent) as is_urgent,
           jsonb_agg(jsonb_build_object(
             'id', e.id,
             'employee_no', e.employee_no,
             'name', nullif(trim(concat_ws(' ', e.first_name, e.last_name)), ''),
             'department', d.code
           ) order by e.employee_no) as holders
    from items i
    join public.employees e on e.id = i.holder_id
    left join public.departments d on d.id = e.department_id
    group by i.item_type, i.item_id, i.doc_no, i.doc_label, i.title, i.status, i.action
  ),
  orphan_requests as (
    select 'request'::text as item_type, r.id as item_id, r.request_no as doc_no, t.name_th as doc_label,
           r.title, r.status::text as status,
           case r.status::text
             when 'pending_approval' then 'พิจารณาอนุมัติ'
             when 'more_info' then 'ส่งข้อมูลเพิ่มเติมที่ผู้อนุมัติขอ'
             when 'pending_assign' then 'มอบหมายช่าง'
             when 'assigned' then 'เริ่มงานซ่อม'
             when 'in_progress' then 'บันทึกผลซ่อม'
             when 'pending_verify' then 'ตรวจรับผลการซ่อม'
             else 'รับงานและเริ่มดำเนินการ'
           end as action,
           greatest(
             (select max(h.created_at) from public.request_status_history h where h.request_id = r.id),
             (select max(s.acted_at) from public.approval_steps s where s.request_id = r.id),
             r.submitted_at,
             r.created_at
           ) as waiting_since,
           null::date as due_date,
           (r.is_urgent or r.priority = 'urgent') as is_urgent,
           '[]'::jsonb as holders
    from public.requests r
    join public.request_types t on t.id = r.request_type_id
    where not exists (select 1 from items i where i.item_type = 'request' and i.item_id = r.id)
      and (
        r.status in ('pending_approval', 'more_info', 'pending_assign', 'assigned', 'pending_verify')
        or (
          r.status = 'in_progress' and coalesce(t.uses_repair_workflow, false)
          and not exists (
            select 1 from public.employees e
            where e.is_active
              and (e.id = r.assignee_id
                   or e.id in (select rt.technician_id from public.request_technicians rt where rt.request_id = r.id))
          )
        )
        or (r.status = 'approved' and not coalesce(t.uses_repair_workflow, false) and t.code <> 'MANAGEMENT')
      )
  ),
  orphan_ncrs as (
    select 'ncr'::text, n.id, n.ncr_no, 'NCR'::text, n.product_name, n.status,
           case n.status
             when 'awaiting_disposition' then 'ให้ความเห็นและเลือกแผนกที่รับผิดชอบ (ส่วนที่ 2)'
             when 'awaiting_response' then 'ตอบ NCR: สาเหตุและแนวทางแก้ไข (ส่วนที่ 3)'
             when 'awaiting_followup' then 'ติดตามผลการแก้ไข (ส่วนที่ 4)'
             when 'awaiting_info' then 'ให้ข้อมูลเพิ่มเติมที่ผู้ลงนามขอ'
             else 'ลงนามปิด NCR'
           end,
           coalesce((select max(h.changed_at) from public.ncr_status_history h where h.ncr_id = n.id), n.created_at),
           null::date, false, '[]'::jsonb
    from public.ncr_reports n
    where not n.is_test
      and n.status in ('awaiting_disposition', 'awaiting_response', 'awaiting_followup', 'awaiting_signoff', 'awaiting_info')
      and not exists (select 1 from items i where i.item_type = 'ncr' and i.item_id = n.id)
  ),
  all_rows as (
    select * from grouped
    union all select * from orphan_requests
    union all select * from orphan_ncrs
  )
  select a.item_type, a.item_id, a.doc_no, a.doc_label, a.title, a.status, a.action,
         a.waiting_since,
         greatest(v_today - (a.waiting_since at time zone 'Asia/Bangkok')::date, 0),
         a.due_date, a.is_urgent, a.holders
  from all_rows a
  order by a.waiting_since, a.doc_no, a.action;
end;
$$;
revoke all on function public.app_master_pending_work() from public, anon;
grant execute on function public.app_master_pending_work() to authenticated;
