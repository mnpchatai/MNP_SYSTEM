-- NCR: ผู้ลงนามขอข้อมูลเพิ่มเติมได้ในทุกลำดับ (ผจก.แผนก QA -> ผจก.โรงงาน -> ผจก.ทั่วไป)
--
-- กติกา (ตกลงกับผู้ใช้งานแล้ว)
--   * ผู้ที่ถึงลำดับลงนามกด "ขอข้อมูลเพิ่มเติม" พร้อมข้อความ -> สถานะ awaiting_signoff เปลี่ยนเป็น awaiting_info
--   * ผู้ตอบคือ ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบ (ncr_responsibilities) เสมอ -> ตอบแล้วกลับ awaiting_signoff
--     ลายเซ็นที่ลงไปแล้วยังนับอยู่ (ไม่ถูกล้าง) และผู้ลงนามลำดับเดิมต้องลงนามต่อ
--   * ขอได้ทีละคำขอ (ต้องตอบก่อนจึงขอใหม่/ลงนามต่อได้) ผจก.แผนก QA ยกเลิก NCR ได้ตามเดิมแม้อยู่ในสถานะนี้
--
-- โครงสร้าง
--   public.ncr_info_requests  คำขอ/คำตอบ ต่อ NCR (อ่านได้ตามสิทธิ์อ่าน NCR เขียนผ่าน RPC เท่านั้น)
--   public.app_ncr_request_info(ncr_id, note)  ผู้ลงนามลำดับปัจจุบันขอข้อมูล + แจ้งเตือนแผนกที่รับผิดชอบ
--   public.app_ncr_answer_info(ncr_id, note)   แผนกที่รับผิดชอบตอบ + แจ้งเตือนผู้ลงนามลำดับนั้น
--   ncr_reports.status เพิ่มค่า awaiting_info; ตัวเตือนงานค้าง (private.pending_work_items) เตือนแผนกที่รับผิดชอบ
--   โหมดทดสอบ: ตารางใหม่ผูก trigger ขอบเขตทดสอบ และอยู่ใน private.sandbox_unguarded_tables()
--
-- เริ่มจากนิยามล่าสุดของ private.pending_work_items (20261005010000) และ private.sandbox_unguarded_tables (20261005030000)
-- Rollback: คืน NCR ที่อยู่ใน awaiting_info กลับ awaiting_signoff ก่อน, drop function app_ncr_request_info/app_ncr_answer_info,
--   drop table ncr_info_requests, คืน check constraint ของ status (ไม่มี awaiting_info) และ create or replace
--   private.pending_work_items / private.sandbox_unguarded_tables กลับเป็นนิยามเดิม

alter table public.ncr_reports drop constraint ncr_reports_status_check;
alter table public.ncr_reports add constraint ncr_reports_status_check check (status in (
  'awaiting_disposition', 'awaiting_response', 'awaiting_followup', 'awaiting_signoff', 'awaiting_info', 'closed', 'cancelled'
));

create table public.ncr_info_requests (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references public.ncr_reports(id) on delete cascade,
  step text not null check (step in ('qa', 'factory', 'gm')),
  request_note text not null check (char_length(request_note) between 5 and 2000),
  requested_by uuid not null references public.employees(id),
  requested_at timestamptz not null default now(),
  answer_note text check (answer_note is null or char_length(answer_note) between 5 and 5000),
  answered_by uuid references public.employees(id),
  answered_at timestamptz,
  check ((answered_at is null) = (answered_by is null) and (answered_at is null) = (answer_note is null))
);
-- มีคำขอที่ยังไม่ตอบได้ครั้งละหนึ่งรายการต่อ NCR
create unique index ncr_info_requests_one_open on public.ncr_info_requests(ncr_id) where answered_at is null;
create index ncr_info_requests_ncr_idx on public.ncr_info_requests(ncr_id, requested_at);

create trigger ncr_info_requests_audit after insert or update or delete on public.ncr_info_requests
for each row execute function private.audit_row_change();
create trigger ncr_info_requests_sandbox_scope before insert or update or delete on public.ncr_info_requests
for each row execute function private.ncr_child_sandbox_scope();

alter table public.ncr_info_requests enable row level security;
revoke all on public.ncr_info_requests from anon, authenticated;
grant select on public.ncr_info_requests to authenticated;
create policy ncr_info_requests_read on public.ncr_info_requests for select to authenticated
using (private.can_access_ncr(ncr_id));

-- ผู้ลงนามลำดับปัจจุบันขอข้อมูลเพิ่มเติม (สิทธิ์ตรงกับ app_ncr_signoff ของลำดับนั้น)
create or replace function public.app_ncr_request_info(p_ncr_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_role text;
  v_step text;
  v_id uuid;
begin
  v_employee := private.ncr_current_employee();
  v_role := private.employee_role_code(v_employee.id);

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_signoff' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_ncr.signoff_qa_at is null then
    v_step := 'qa';
    if not (v_role in ('department_manager', 'assistant_department_manager')
            and private.is_qa_department(v_employee.department_id)) then
      raise exception 'NOT_AUTHORIZED';
    end if;
  elsif v_ncr.signoff_factory_at is null then
    v_step := 'factory';
    if v_role <> 'factory_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
  else
    v_step := 'gm';
    if v_role <> 'general_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
  end if;

  if char_length(trim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'INVALID_INFO_REQUEST';
  end if;

  insert into public.ncr_info_requests (ncr_id, step, request_note, requested_by)
  values (v_ncr.id, v_step, trim(p_note), v_employee.id)
  returning id into v_id;
  update public.ncr_reports set status = 'awaiting_info' where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_info', 'request_info', p_note, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'responsible_managers', 'NCR ผู้ลงนามขอข้อมูลเพิ่มเติม', v_employee.id);
  return v_id;
end;
$$;

-- ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบตอบ -> กลับไปรอลงนามที่ลำดับเดิม ลายเซ็นเดิมยังอยู่
create or replace function public.app_ncr_answer_info(p_ncr_id uuid, p_note text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_request public.ncr_info_requests%rowtype;
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
  if v_ncr.status <> 'awaiting_info' then
    raise exception 'INVALID_TRANSITION';
  end if;

  select * into v_request
  from public.ncr_info_requests
  where ncr_id = v_ncr.id and answered_at is null
  for update;
  if v_request.id is null then
    raise exception 'INVALID_TRANSITION';
  end if;
  if char_length(trim(coalesce(p_note, ''))) not between 5 and 5000 then
    raise exception 'INVALID_INFO_ANSWER';
  end if;

  update public.ncr_info_requests
  set answer_note = trim(p_note), answered_by = v_employee.id, answered_at = now()
  where id = v_request.id;
  update public.ncr_reports set status = 'awaiting_signoff' where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_signoff', 'answer_info', p_note, v_employee.id);
  perform private.ncr_notify(
    v_ncr.id,
    case v_request.step when 'qa' then 'qa_managers' when 'factory' then 'factory' else 'general_manager' end,
    'NCR ได้รับข้อมูลเพิ่มเติมแล้ว รอลงนามต่อ',
    v_employee.id
  );
  return v_request.id;
end;
$$;

revoke all on function public.app_ncr_request_info(uuid, text) from public, anon;
grant execute on function public.app_ncr_request_info(uuid, text) to authenticated;
revoke all on function public.app_ncr_answer_info(uuid, text) from public, anon;
grant execute on function public.app_ncr_answer_info(uuid, text) to authenticated;

-- ตัวเตือนงานค้าง: NCR ที่รอข้อมูลเพิ่มเติมเตือนแผนกที่รับผิดชอบ
-- (คัดจากนิยามล่าสุดใน 20261005010000_pending_work_reminders.sql เปลี่ยนเฉพาะสถานะ awaiting_info)
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
             when 'awaiting_info' then 'responsible_managers'
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
  )
  select distinct on (i.holder_id, i.item_type, i.item_id)
         i.holder_id, i.item_type, i.item_id, i.doc_no, i.doc_label, i.title, i.status, i.action,
         i.waiting_since, i.due_date, i.is_urgent
  from all_items i
  join public.employees e on e.id = i.holder_id and e.is_active
  order by i.holder_id, i.item_type, i.item_id, i.waiting_since
$$;
revoke all on function private.pending_work_items(timestamptz) from public, anon, authenticated;

-- โหมดทดสอบรู้จักตารางใหม่ผ่าน trigger ขอบเขตทดสอบข้างบน จึงอยู่ในรายการที่ไม่ต้องใส่ด่านปิดการเขียนกลาง
-- (คัดจากนิยามล่าสุดใน 20261005030000_admin_sandbox_mode.sql เพิ่มเฉพาะ ncr_info_requests)
create or replace function private.sandbox_unguarded_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'ncr_reports', 'ncr_responsibilities', 'ncr_losses', 'ncr_status_history', 'ncr_attachments', 'ncr_info_requests',
    'ncr_defect_types',   -- ข้อมูลอ้างอิงร่วม ไม่มีการเขียนจากแอป
    'document_counters',  -- ตัวนับแยกชุด NCR-TEST
    'audit_logs',         -- บันทึกการกระทำในโหมดทดสอบไว้ตรวจย้อนหลัง
    'sandbox_sessions'
  ]
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;
