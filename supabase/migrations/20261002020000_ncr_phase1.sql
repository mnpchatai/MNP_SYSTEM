-- NCR Phase 1: ใบรายงานผลิตภัณฑ์ที่ไม่เป็นไปตามข้อกำหนด (QA02-FM01 Rev.00) แบบ workflow เต็มรูปแบบ
--
-- แยกจากตาราง requests เพราะ
--   - เลขที่ NCR รูปแบบ "QAxxx/yy" ตรงกับรูปแบบเลขใบแจ้งซ่อมของแผนก QA (private.next_repair_doc_number('QA')
--     ออก "QA011/26" อยู่แล้ว) ถ้าใช้ requests.request_no ร่วมกันจะชนกันที่ unique(request_no)
--   - ฟอร์มมี 4 ส่วน ผู้ทำแต่ละส่วนคนละบทบาท และมีข้อมูลเชิงปริมาณ/ความสูญเสียที่ต้องวิเคราะห์ภายหลัง
--
-- ขั้นตอน (ทุกขั้นทำผ่าน RPC ด้านล่างเท่านั้น ตาราง ncr_* ไม่มี grant เขียนให้ authenticated):
--   app_ncr_issue      ส่วนที่ 1  พนักงานทุกคน                         -> awaiting_disposition
--   app_ncr_dispose    ส่วนที่ 2  ผู้จัดการโรงงาน (factory_manager)       -> awaiting_response (ตอบภายใน 7 วัน)
--   app_ncr_respond    ส่วนที่ 3  ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบ     -> awaiting_followup
--   app_ncr_followup   ส่วนที่ 4  พนักงานแผนก QA: close -> awaiting_signoff / return -> awaiting_response
--   app_ncr_signoff    ลงนามตามลำดับ ผจก.แผนก QA -> ผจก.โรงงาน -> ผจก.ทั่วไป -> closed
--   app_ncr_cancel     ผจก.แผนก QA ยกเลิกได้ก่อนปิด (คงเลขที่ไว้ ไม่นำกลับมาใช้)
--   app_ncr_add_loss / app_ncr_void_loss  บันทึก/ยกเลิกรายการความสูญเสีย (ไม่ลบจริง เก็บไว้ตรวจสอบ)
-- "ออก CAR" ในส่วนที่ 4 รอ Phase 2 (ตาราง CAR ยังไม่มี)
--
-- Rollback (ยังไม่มีข้อมูลจริง): drop function public.app_ncr_* ทั้ง 8 ตัวและ private.*ncr* แล้ว
--   drop table public.ncr_losses, public.ncr_status_history, public.ncr_responsibilities,
--   public.ncr_reports, public.ncr_defect_types; delete from public.document_counters where department_code = 'NCR';
-- ถ้ามีข้อมูลจริงแล้ว ให้ export ตาราง ncr_* เก็บไว้ก่อน drop

-- 1. ข้อมูลหลัก: ประเภทข้อบกพร่อง (ร่างจาก NCR LOG 2026 — QA ปรับเพิ่ม/ปิดได้ภายหลัง)
create table public.ncr_defect_types (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z]{2,10}$'),
  name_th text not null check (char_length(name_th) between 2 and 100),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.ncr_defect_types (code, name_th, sort_order) values
  ('DIM', 'ขนาดไม่ได้สเปค', 10),
  ('SURF', 'ผิวไม่สมบูรณ์ (ตามด/ลายเส้น/ตุ่ม)', 20),
  ('COLOR', 'สีเพี้ยน', 30),
  ('MAT', 'คุณสมบัติวัสดุ (ความแข็ง/ลอยน้ำ)', 40),
  ('ASSY', 'ประกอบ/ติดกาว/เจาะไม่ได้', 50),
  ('PACK', 'บรรจุ/ฉลาก/สกรีนผิด', 60),
  ('WRONG', 'ส่งสินค้าผิดรายการ', 70),
  ('STOCK', 'ยอดสต็อกไม่ตรง', 80),
  ('OTHER', 'อื่นๆ', 90)
on conflict (code) do nothing;

-- 2. ใบ NCR
create table public.ncr_reports (
  id uuid primary key default gen_random_uuid(),
  ncr_no text not null unique,
  form_code text not null default 'QA02-FM01 Rev.00',
  status text not null default 'awaiting_disposition' check (status in (
    'awaiting_disposition', 'awaiting_response', 'awaiting_followup', 'awaiting_signoff', 'closed', 'cancelled'
  )),

  -- ส่วนที่ 1 ผู้รายงาน/ผู้ตรวจสอบ
  reporter_id uuid not null references public.employees(id),
  reporter_department_id uuid not null references public.departments(id),
  issue_date date not null,
  product_code text check (product_code is null or char_length(product_code) <= 100),
  product_name text not null check (char_length(product_name) between 2 and 300),
  customer_name text check (customer_name is null or char_length(customer_name) <= 200),
  customer_code text check (customer_code is null or char_length(customer_code) <= 50),
  po_no text check (po_no is null or char_length(po_no) <= 100),
  lot_no text check (lot_no is null or char_length(lot_no) <= 100),
  qty_total numeric(14, 3) not null check (qty_total > 0),
  qty_sampled numeric(14, 3) check (qty_sampled is null or (qty_sampled > 0 and qty_sampled <= qty_total)),
  qty_defect numeric(14, 3) not null check (qty_defect > 0 and qty_defect <= qty_total),
  qty_returned numeric(14, 3) check (qty_returned is null or (qty_returned >= 0 and qty_returned <= qty_total)),
  -- หน่วยตามฟอร์ม (ชุด ชิ้น เซต ม้วน เส้น กก.) + หน่วยที่ใช้จริงใน NCR LOG 2026
  unit text not null check (unit in ('ชุด', 'ชิ้น', 'เซต', 'ม้วน', 'เส้น', 'กก.', 'ท่อน', 'เมตร', 'ลูก', 'ใบ', 'รายการ')),
  source text not null check (source in ('incoming', 'in_process', 'final_fg', 'customer_reject', 'other')),
  defect_type_id uuid not null references public.ncr_defect_types(id),
  description text not null check (char_length(description) between 10 and 5000),

  -- ส่วนที่ 2 ฝ่ายบริหารโรงงานพิจารณา
  dispositions text[] not null default '{}' check (dispositions <@ array[
    'return', 'accept', 'reproduce', 'exchange', 'repair', 'sort', 'scrap', 'sell', 'other'
  ]::text[]),
  disposition_note text check (disposition_note is null or char_length(disposition_note) <= 1000),
  disposed_by uuid references public.employees(id),
  disposed_at timestamptz,
  response_due date,

  -- ส่วนที่ 3 ผู้รับเรื่องดำเนินการ
  causes text[] not null default '{}' check (causes <@ array[
    'man', 'machine', 'material', 'method', 'measure', 'environment', 'other'
  ]::text[]),
  root_cause text check (root_cause is null or char_length(root_cause) <= 5000),
  correction text check (correction is null or char_length(correction) <= 5000),
  correction_due date,
  prevention text check (prevention is null or char_length(prevention) <= 5000),
  prevention_due date,
  responded_by uuid references public.employees(id),
  responded_at timestamptz,

  -- ส่วนที่ 4 การตรวจติดตาม + ลงนาม
  followup_note text check (followup_note is null or char_length(followup_note) <= 2000),
  followed_up_by uuid references public.employees(id),
  followed_up_at timestamptz,
  signoff_qa_by uuid references public.employees(id),
  signoff_qa_at timestamptz,
  signoff_factory_by uuid references public.employees(id),
  signoff_factory_at timestamptz,
  signoff_gm_by uuid references public.employees(id),
  signoff_gm_at timestamptz,
  closed_at timestamptz,
  cancelled_by uuid references public.employees(id),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index ncr_reports_status_idx on public.ncr_reports(status, issue_date desc);
create index ncr_reports_issue_date_idx on public.ncr_reports(issue_date desc);
create index ncr_reports_reporter_idx on public.ncr_reports(reporter_id);

-- แผนกที่รับผิดชอบ + สัดส่วน (แทนการนับ 0.5/0.25 ด้วยมือในชีตสรุปเดิม) รวมต้องเท่ากับ 1
create table public.ncr_responsibilities (
  ncr_id uuid not null references public.ncr_reports(id) on delete cascade,
  department_id uuid not null references public.departments(id),
  share numeric(5, 4) not null check (share > 0 and share <= 1),
  primary key (ncr_id, department_id)
);
create index ncr_responsibilities_department_idx on public.ncr_responsibilities(department_id);

-- ความสูญเสีย: ไม่ลบจริง ยกเลิกด้วย voided_* เพื่อให้ตรวจย้อนได้ มูลค่าคำนวณจากจำนวน x ราคาต่อหน่วย
create table public.ncr_losses (
  id uuid primary key default gen_random_uuid(),
  ncr_id uuid not null references public.ncr_reports(id) on delete cascade,
  loss_type text not null check (loss_type in ('scrap', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other')),
  quantity numeric(14, 3) not null check (quantity > 0),
  unit text not null check (char_length(unit) between 1 and 20),
  unit_cost numeric(14, 2) not null check (unit_cost >= 0),
  amount numeric(16, 2) generated always as (round(quantity * unit_cost, 2)) stored,
  note text check (note is null or char_length(note) <= 500),
  recorded_by uuid not null references public.employees(id),
  recorded_at timestamptz not null default now(),
  voided_by uuid references public.employees(id),
  voided_at timestamptz,
  void_reason text check (void_reason is null or char_length(void_reason) <= 500),
  check ((voided_at is null) = (voided_by is null))
);
create index ncr_losses_ncr_idx on public.ncr_losses(ncr_id);

create table public.ncr_status_history (
  id bigint generated always as identity primary key,
  ncr_id uuid not null references public.ncr_reports(id) on delete cascade,
  from_status text,
  to_status text not null,
  action text not null,
  note text,
  changed_by uuid references public.employees(id),
  changed_at timestamptz not null default now()
);
create index ncr_status_history_ncr_idx on public.ncr_status_history(ncr_id, changed_at);

create trigger ncr_reports_touch before update on public.ncr_reports
for each row execute function private.touch_updated_at();
create trigger ncr_reports_audit after insert or update or delete on public.ncr_reports
for each row execute function private.audit_row_change();
create trigger ncr_responsibilities_audit after insert or update or delete on public.ncr_responsibilities
for each row execute function private.audit_row_change();
create trigger ncr_losses_audit after insert or update or delete on public.ncr_losses
for each row execute function private.audit_row_change();

-- 3. ตัวนับเลขที่ NCR แยกจากตัวนับใบแจ้งซ่อมแผนก QA (department_code = 'QA')
--    NCR LOG 2026 ใช้ถึง QA037/26 และจองแถว QA038–QA040 ไว้ จึงเริ่มต่อที่ QA041/26 กันชนกับเลขที่
--    อาจออกในกระดาษไปแล้ว ถ้า QA ยืนยันว่า 038–040 ไม่ได้ใช้ ปรับ last_number ก่อนเปิดใช้งานได้
insert into public.document_counters (department_code, year_key, last_number)
values ('NCR', '26', 40)
on conflict (department_code, year_key) do nothing;

create or replace function private.bangkok_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;

create or replace function private.next_ncr_doc_number()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_next integer;
begin
  insert into public.document_counters (department_code, year_key, last_number)
  values ('NCR', v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1,
        updated_at = now()
  returning last_number into v_next;
  return 'QA' || lpad(v_next::text, 3, '0') || '/' || v_year;
end;
$$;

-- 4. ตัวช่วยตรวจสิทธิ์ (อยู่ใน schema private ไม่ถูกเปิดผ่าน Data API)
create or replace function private.ncr_current_employee()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
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
  return v_employee;
end;
$$;

create or replace function private.employee_role_code(p_employee_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select r.code
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.id = p_employee_id
$$;

create or replace function private.is_qa_department(p_department_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.departments d where d.id = p_department_id and d.code = 'QA')
$$;

-- ผู้อ่าน NCR ได้: ผู้รายงาน, พนักงานแผนก QA, พนักงานแผนกที่รับผิดชอบ, ผจก.โรงงาน/ผู้ช่วย/ผจก.ทั่วไป
-- และผู้ที่มี requests.view_all (admin, factory_manager, general_manager)
create or replace function private.can_access_ncr(p_ncr_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.ncr_reports n
    join public.employees me on me.auth_user_id = (select auth.uid()) and me.is_active
    join public.roles me_role on me_role.id = me.role_id
    where n.id = p_ncr_id
      and (
        n.reporter_id = me.id
        or private.is_qa_department(me.department_id)
        or exists (
          select 1 from public.ncr_responsibilities r
          where r.ncr_id = n.id and r.department_id = me.department_id
        )
        or me_role.code in ('factory_manager', 'assistant_factory_manager', 'general_manager')
        or private.has_permission('requests.view_all')
      )
  )
$$;

-- ผู้บันทึก/ยกเลิกรายการความสูญเสีย: พนักงานแผนก QA, ผจก.โรงงาน, ผจก./ผู้ช่วยของแผนกที่รับผิดชอบ
create or replace function private.can_edit_ncr_losses(p_ncr_id uuid, p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_qa_department(p_employee.department_id)
    or private.employee_role_code(p_employee.id) = 'factory_manager'
    or (
      private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager')
      and exists (
        select 1 from public.ncr_responsibilities r
        where r.ncr_id = p_ncr_id and r.department_id = p_employee.department_id
      )
    )
$$;

create or replace function private.ncr_log(
  p_ncr_id uuid, p_from text, p_to text, p_action text, p_note text, p_actor uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.ncr_status_history (ncr_id, from_status, to_status, action, note, changed_by)
  values (p_ncr_id, p_from, p_to, p_action, nullif(trim(coalesce(p_note, '')), ''), p_actor)
$$;

-- แจ้งเตือนในระบบ (และอีเมลผ่านคิวเดิม) ไม่แจ้งผู้ทำรายการเอง
-- p_audience: factory | responsible_managers | qa | qa_managers | general_manager | reporter
create or replace function private.ncr_notify(p_ncr_id uuid, p_audience text, p_title text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ncr public.ncr_reports%rowtype;
begin
  select * into v_ncr from public.ncr_reports where id = p_ncr_id;
  insert into public.notifications (recipient_id, request_id, title, body, action_url)
  select distinct e.id, null::uuid, p_title,
         v_ncr.ncr_no || ' · ' || v_ncr.product_name,
         '/ncr/' || v_ncr.id::text
  from public.employees e
  join public.roles r on r.id = e.role_id
  where e.is_active
    and e.id is distinct from p_actor
    and case p_audience
      when 'factory' then r.code = 'factory_manager'
      when 'general_manager' then r.code = 'general_manager'
      when 'reporter' then e.id = v_ncr.reporter_id
      when 'qa' then private.is_qa_department(e.department_id)
      when 'qa_managers' then private.is_qa_department(e.department_id)
        and r.code in ('department_manager', 'assistant_department_manager')
      when 'responsible_managers' then r.code in ('department_manager', 'assistant_department_manager')
        and exists (
          select 1 from public.ncr_responsibilities x
          where x.ncr_id = v_ncr.id and x.department_id = e.department_id
        )
      else false
    end;
end;
$$;

revoke all on function private.bangkok_today() from public, anon, authenticated;
revoke all on function private.next_ncr_doc_number() from public, anon, authenticated;
revoke all on function private.ncr_current_employee() from public, anon, authenticated;
revoke all on function private.employee_role_code(uuid) from public, anon, authenticated;
revoke all on function private.is_qa_department(uuid) from public, anon, authenticated;
revoke all on function private.can_edit_ncr_losses(uuid, public.employees) from public, anon, authenticated;
revoke all on function private.ncr_log(uuid, text, text, text, text, uuid) from public, anon, authenticated;
revoke all on function private.ncr_notify(uuid, text, text, uuid) from public, anon, authenticated;
-- can_access_ncr ถูกเรียกจาก RLS policy ในฐานะ authenticated
revoke all on function private.can_access_ncr(uuid) from public, anon;
grant execute on function private.can_access_ncr(uuid) to authenticated;

-- 5. RLS + grants: อ่านอย่างเดียว เขียนผ่าน RPC เท่านั้น
alter table public.ncr_defect_types enable row level security;
alter table public.ncr_reports enable row level security;
alter table public.ncr_responsibilities enable row level security;
alter table public.ncr_losses enable row level security;
alter table public.ncr_status_history enable row level security;

revoke all on public.ncr_defect_types, public.ncr_reports, public.ncr_responsibilities,
  public.ncr_losses, public.ncr_status_history from anon, authenticated;
grant select on public.ncr_defect_types, public.ncr_reports, public.ncr_responsibilities,
  public.ncr_losses, public.ncr_status_history to authenticated;

create policy ncr_defect_types_read on public.ncr_defect_types for select to authenticated
using (true);
create policy ncr_reports_read on public.ncr_reports for select to authenticated
using (private.can_access_ncr(id));
create policy ncr_responsibilities_read on public.ncr_responsibilities for select to authenticated
using (private.can_access_ncr(ncr_id));
create policy ncr_losses_read on public.ncr_losses for select to authenticated
using (private.can_access_ncr(ncr_id));
create policy ncr_status_history_read on public.ncr_status_history for select to authenticated
using (private.can_access_ncr(ncr_id));

-- 6. RPC ---------------------------------------------------------------------

-- ส่วนที่ 1: ออก NCR (ออกเลขที่ในขั้นนี้เท่านั้น ไม่มีร่างที่จองเลข)
create or replace function public.app_ncr_issue(
  p_product_name text,
  p_qty_total numeric,
  p_qty_defect numeric,
  p_unit text,
  p_source text,
  p_defect_type_code text,
  p_description text,
  p_product_code text default null,
  p_customer_name text default null,
  p_customer_code text default null,
  p_po_no text default null,
  p_lot_no text default null,
  p_qty_sampled numeric default null,
  p_qty_returned numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_defect_type_id uuid;
  v_id uuid;
  v_no text;
begin
  v_employee := private.ncr_current_employee();

  if char_length(trim(coalesce(p_product_name, ''))) not between 2 and 300 then
    raise exception 'INVALID_PRODUCT_NAME';
  end if;
  if char_length(trim(coalesce(p_description, ''))) not between 10 and 5000 then
    raise exception 'INVALID_NCR_DESCRIPTION';
  end if;
  if p_qty_total is null or p_qty_total <= 0
     or p_qty_defect is null or p_qty_defect <= 0 or p_qty_defect > p_qty_total
     or (p_qty_sampled is not null and (p_qty_sampled <= 0 or p_qty_sampled > p_qty_total))
     or (p_qty_returned is not null and (p_qty_returned < 0 or p_qty_returned > p_qty_total)) then
    raise exception 'INVALID_QUANTITY';
  end if;
  if p_unit is null or p_unit not in ('ชุด', 'ชิ้น', 'เซต', 'ม้วน', 'เส้น', 'กก.', 'ท่อน', 'เมตร', 'ลูก', 'ใบ', 'รายการ') then
    raise exception 'INVALID_UNIT';
  end if;
  if p_source is null or p_source not in ('incoming', 'in_process', 'final_fg', 'customer_reject', 'other') then
    raise exception 'INVALID_SOURCE';
  end if;
  select id into v_defect_type_id
  from public.ncr_defect_types
  where code = p_defect_type_code and is_active;
  if v_defect_type_id is null then
    raise exception 'INVALID_DEFECT_TYPE';
  end if;

  v_no := private.next_ncr_doc_number();
  insert into public.ncr_reports (
    ncr_no, reporter_id, reporter_department_id, issue_date,
    product_code, product_name, customer_name, customer_code, po_no, lot_no,
    qty_total, qty_sampled, qty_defect, qty_returned, unit, source, defect_type_id, description
  ) values (
    v_no, v_employee.id, v_employee.department_id, private.bangkok_today(),
    nullif(left(trim(coalesce(p_product_code, '')), 100), ''),
    trim(p_product_name),
    nullif(left(trim(coalesce(p_customer_name, '')), 200), ''),
    nullif(left(trim(coalesce(p_customer_code, '')), 50), ''),
    nullif(left(trim(coalesce(p_po_no, '')), 100), ''),
    nullif(left(trim(coalesce(p_lot_no, '')), 100), ''),
    p_qty_total, p_qty_sampled, p_qty_defect, p_qty_returned, p_unit, p_source, v_defect_type_id,
    trim(p_description)
  )
  returning id into v_id;

  perform private.ncr_log(v_id, null, 'awaiting_disposition', 'issue', null, v_employee.id);
  perform private.ncr_notify(v_id, 'factory', 'NCR ใหม่ รอพิจารณา', v_employee.id);
  return jsonb_build_object('id', v_id, 'ncr_no', v_no);
end;
$$;

-- ส่วนที่ 2: ผู้จัดการโรงงานเลือกวิธีจัดการ + แผนกที่รับผิดชอบพร้อมสัดส่วน
-- p_responsibilities = [{"department_id": "...", "share": 0.7}, ...] รวม share = 1
create or replace function public.app_ncr_dispose(
  p_ncr_id uuid,
  p_dispositions text[],
  p_responsibilities jsonb,
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
  v_item jsonb;
  v_department_id uuid;
  v_share numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_departments uuid[] := '{}';
begin
  v_employee := private.ncr_current_employee();
  if private.employee_role_code(v_employee.id) <> 'factory_manager' then
    raise exception 'NOT_AUTHORIZED';
  end if;

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status <> 'awaiting_disposition' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if coalesce(cardinality(p_dispositions), 0) = 0
     or not (p_dispositions <@ array['return', 'accept', 'reproduce', 'exchange', 'repair', 'sort', 'scrap', 'sell', 'other']::text[]) then
    raise exception 'INVALID_DISPOSITION';
  end if;
  if char_length(coalesce(p_note, '')) > 1000 then
    raise exception 'INVALID_NOTE';
  end if;
  if jsonb_typeof(coalesce(p_responsibilities, 'null'::jsonb)) <> 'array'
     or jsonb_array_length(p_responsibilities) = 0
     or jsonb_array_length(p_responsibilities) > 10 then
    raise exception 'INVALID_RESPONSIBILITIES';
  end if;

  for v_item in select * from jsonb_array_elements(p_responsibilities)
  loop
    begin
      v_department_id := (v_item->>'department_id')::uuid;
      v_share := (v_item->>'share')::numeric;
    exception when others then
      raise exception 'INVALID_RESPONSIBILITIES';
    end;
    if v_department_id is null or v_share is null or v_share <= 0 or v_share > 1
       or v_department_id = any(v_departments)
       or not exists (select 1 from public.departments d where d.id = v_department_id and d.is_active) then
      raise exception 'INVALID_RESPONSIBILITIES';
    end if;
    v_departments := v_departments || v_department_id;
    v_total := v_total + round(v_share, 4);
    v_count := v_count + 1;
  end loop;
  if abs(v_total - 1) > 0.0005 then
    raise exception 'INVALID_RESPONSIBILITIES';
  end if;

  insert into public.ncr_responsibilities (ncr_id, department_id, share)
  select v_ncr.id, (x->>'department_id')::uuid, round((x->>'share')::numeric, 4)
  from jsonb_array_elements(p_responsibilities) x;

  update public.ncr_reports
  set status = 'awaiting_response',
      dispositions = (select array_agg(distinct d) from unnest(p_dispositions) d),
      disposition_note = nullif(trim(coalesce(p_note, '')), ''),
      disposed_by = v_employee.id,
      disposed_at = now(),
      response_due = private.bangkok_today() + 7
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_response', 'dispose', p_note, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'responsible_managers', 'NCR รอแผนกตอบภายใน 7 วัน', v_employee.id);
  return v_ncr.id;
end;
$$;

-- ส่วนที่ 3: ผจก./ผู้ช่วย ผจก. ของแผนกที่รับผิดชอบตอบสาเหตุ แนวทางแก้ไข และป้องกัน
create or replace function public.app_ncr_respond(
  p_ncr_id uuid,
  p_causes text[],
  p_root_cause text,
  p_correction text,
  p_correction_due date,
  p_prevention text,
  p_prevention_due date
)
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
  if char_length(trim(coalesce(p_prevention, ''))) not between 5 and 5000 then
    raise exception 'INVALID_PREVENTION';
  end if;
  if p_correction_due is null or p_prevention_due is null
     or p_correction_due < v_ncr.issue_date or p_prevention_due < v_ncr.issue_date then
    raise exception 'INVALID_DUE_DATE';
  end if;

  update public.ncr_reports
  set status = 'awaiting_followup',
      causes = (select array_agg(distinct c) from unnest(p_causes) c),
      root_cause = trim(p_root_cause),
      correction = trim(p_correction),
      correction_due = p_correction_due,
      prevention = trim(p_prevention),
      prevention_due = p_prevention_due,
      responded_by = v_employee.id,
      responded_at = now()
  where id = v_ncr.id;

  perform private.ncr_log(v_ncr.id, v_ncr.status, 'awaiting_followup', 'respond', null, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'qa', 'NCR ตอบกลับแล้ว รอ QA ติดตามผล', v_employee.id);
  return v_ncr.id;
end;
$$;

-- ส่วนที่ 4: พนักงานแผนก QA สรุปผลติดตาม — close (ปิดประเด็น -> รอลงนาม) หรือ return (ส่งกลับให้แผนกตอบใหม่)
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

  v_next := case p_result when 'close' then 'awaiting_signoff' else 'awaiting_response' end;
  update public.ncr_reports
  set status = v_next,
      followup_note = nullif(trim(coalesce(p_note, '')), ''),
      followed_up_by = v_employee.id,
      followed_up_at = now(),
      response_due = case when p_result = 'return' then private.bangkok_today() + 7 else response_due end
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

-- ลงนามปิดตามลำดับ ผจก.แผนก QA -> ผจก.โรงงาน -> ผจก.ทั่วไป
create or replace function public.app_ncr_signoff(p_ncr_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_ncr public.ncr_reports%rowtype;
  v_role text;
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
    if not (v_role in ('department_manager', 'assistant_department_manager')
            and private.is_qa_department(v_employee.department_id)) then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports set signoff_qa_by = v_employee.id, signoff_qa_at = now() where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'signoff_qa', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'factory', 'NCR รอลงนามปิด (ผจก.โรงงาน)', v_employee.id);
    return 'qa';
  elsif v_ncr.signoff_factory_at is null then
    if v_role <> 'factory_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports set signoff_factory_by = v_employee.id, signoff_factory_at = now() where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, v_ncr.status, 'signoff_factory', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'general_manager', 'NCR รอลงนามปิด (ผจก.ทั่วไป)', v_employee.id);
    return 'factory';
  else
    if v_role <> 'general_manager' then
      raise exception 'NOT_AUTHORIZED';
    end if;
    update public.ncr_reports
    set signoff_gm_by = v_employee.id, signoff_gm_at = now(), status = 'closed', closed_at = now()
    where id = v_ncr.id;
    perform private.ncr_log(v_ncr.id, v_ncr.status, 'closed', 'signoff_gm', null, v_employee.id);
    perform private.ncr_notify(v_ncr.id, 'reporter', 'NCR ปิดเรียบร้อยแล้ว', v_employee.id);
    return 'gm';
  end if;
end;
$$;

-- ผจก.แผนก QA ยกเลิกได้ก่อนปิด เลขที่ยังอยู่ในทะเบียนพร้อมสถานะ cancelled
create or replace function public.app_ncr_cancel(p_ncr_id uuid, p_reason text)
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
  if not (private.employee_role_code(v_employee.id) in ('department_manager', 'assistant_department_manager')
          and private.is_qa_department(v_employee.department_id)) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if char_length(trim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'INVALID_REASON';
  end if;

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if v_ncr.status in ('closed', 'cancelled') then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.ncr_reports
  set status = 'cancelled', cancelled_by = v_employee.id, cancelled_at = now(), cancel_reason = trim(p_reason)
  where id = v_ncr.id;
  perform private.ncr_log(v_ncr.id, v_ncr.status, 'cancelled', 'cancel', p_reason, v_employee.id);
  perform private.ncr_notify(v_ncr.id, 'reporter', 'NCR ถูกยกเลิก', v_employee.id);
  return v_ncr.id;
end;
$$;

create or replace function public.app_ncr_add_loss(
  p_ncr_id uuid,
  p_loss_type text,
  p_quantity numeric,
  p_unit text,
  p_unit_cost numeric,
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
  v_id uuid;
begin
  v_employee := private.ncr_current_employee();

  select * into v_ncr from public.ncr_reports where id = p_ncr_id for update;
  if v_ncr.id is null then
    raise exception 'NCR_NOT_FOUND';
  end if;
  if not private.can_edit_ncr_losses(v_ncr.id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_ncr.status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;
  if p_loss_type is null or p_loss_type not in ('scrap', 'rework', 'sort', 'reproduce', 'logistics', 'claim', 'downtime', 'other') then
    raise exception 'INVALID_LOSS_TYPE';
  end if;
  if p_quantity is null or p_quantity <= 0 or p_quantity > 1e9
     or p_unit_cost is null or p_unit_cost < 0 or p_unit_cost > 1e9
     or char_length(trim(coalesce(p_unit, ''))) not between 1 and 20
     or char_length(coalesce(p_note, '')) > 500 then
    raise exception 'INVALID_LOSS';
  end if;

  insert into public.ncr_losses (ncr_id, loss_type, quantity, unit, unit_cost, note, recorded_by)
  values (v_ncr.id, p_loss_type, p_quantity, trim(p_unit), round(p_unit_cost, 2),
          nullif(trim(coalesce(p_note, '')), ''), v_employee.id)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.app_ncr_void_loss(p_loss_id uuid, p_reason text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee public.employees%rowtype;
  v_loss public.ncr_losses%rowtype;
  v_status text;
begin
  v_employee := private.ncr_current_employee();
  if char_length(trim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'INVALID_REASON';
  end if;

  select * into v_loss from public.ncr_losses where id = p_loss_id for update;
  if v_loss.id is null then
    raise exception 'LOSS_NOT_FOUND';
  end if;
  select status into v_status from public.ncr_reports where id = v_loss.ncr_id for update;
  if not private.can_edit_ncr_losses(v_loss.ncr_id, v_employee) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_status in ('closed', 'cancelled') then
    raise exception 'NCR_LOCKED';
  end if;
  if v_loss.voided_at is not null then
    raise exception 'LOSS_ALREADY_VOIDED';
  end if;

  update public.ncr_losses
  set voided_by = v_employee.id, voided_at = now(), void_reason = trim(p_reason)
  where id = v_loss.id;
  return v_loss.id;
end;
$$;

revoke all on function public.app_ncr_issue(text, numeric, numeric, text, text, text, text, text, text, text, text, text, numeric, numeric) from public, anon;
revoke all on function public.app_ncr_dispose(uuid, text[], jsonb, text) from public, anon;
revoke all on function public.app_ncr_respond(uuid, text[], text, text, date, text, date) from public, anon;
revoke all on function public.app_ncr_followup(uuid, text, text) from public, anon;
revoke all on function public.app_ncr_signoff(uuid) from public, anon;
revoke all on function public.app_ncr_cancel(uuid, text) from public, anon;
revoke all on function public.app_ncr_add_loss(uuid, text, numeric, text, numeric, text) from public, anon;
revoke all on function public.app_ncr_void_loss(uuid, text) from public, anon;
grant execute on function public.app_ncr_issue(text, numeric, numeric, text, text, text, text, text, text, text, text, text, numeric, numeric) to authenticated;
grant execute on function public.app_ncr_dispose(uuid, text[], jsonb, text) to authenticated;
grant execute on function public.app_ncr_respond(uuid, text[], text, text, date, text, date) to authenticated;
grant execute on function public.app_ncr_followup(uuid, text, text) to authenticated;
grant execute on function public.app_ncr_signoff(uuid) to authenticated;
grant execute on function public.app_ncr_cancel(uuid, text) to authenticated;
grant execute on function public.app_ncr_add_loss(uuid, text, numeric, text, numeric, text) to authenticated;
grant execute on function public.app_ncr_void_loss(uuid, text) to authenticated;
