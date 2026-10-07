-- ============================================================================
-- ฝ่ายโรงงาน: ขั้น 4–8 ของ workflow การผลิต — ใบงานผลิต (สายผลิตทุกแผนก) โหมดทดสอบเท่านั้น
--   4. สายผลิตยาง (RB ขึ้นรูป → SR รับเข้าคลัง → QC ตรวจขนาด → GR แปรรูป) · 5. PT พลาสติก · 6. BG กระเป๋า
--   7. PK ประกอบและบรรจุ · 8. WH รับสินค้าสำเร็จรูปเข้าคลัง
--
-- ต่อจากขั้น 3 (20261007040000) ที่มีใบสั่งงานและวัตถุดิบพร้อมแล้ว ระบบเดียวใช้กับทุกสายเพราะทุกสายมีรูปแบบเดียวกัน คือ
--   "ผลิต Item หนึ่งตาม Routing ของมัน โดยแต่ละขั้นเป็นของแผนกหนึ่ง ใช้วัตถุดิบตาม BOM แล้วรับผลผลิตเข้าคลัง"
-- ใบงานผลิต (factory_jobs) = งานผลิต Item หนึ่งของใบสั่งผลิตหนึ่งใบ (ชิ้นงาน WIP เช่น ยางเส้นยาว ชิ้นงานยางแปรรูป ชิ้นงานพลาสติก กระเป๋า
-- หรือสินค้าสำเร็จรูป FG ที่ PK ประกอบ) ขั้นตอนของใบงาน (factory_job_steps) คัดลอกจาก Routing ตอนออกใบงาน แต่ละขั้นระบุศูนย์งาน = แผนกที่ทำ
-- ลำดับระหว่างสายเกิดจากยอดคงคลัง: ใบงานที่ใช้ชิ้นงานจากสายอื่น (เช่น GR ใช้ยางเส้นยาว PK ใช้ชิ้นงานยาง/พลาสติก/กระเป๋า) จะเริ่มไม่ได้จนกว่าสายนั้นรับผลผลิตเข้าคลัง
--
-- สถานะของใบงาน (factory_jobs.status)
--   open ──ทำขั้นแรกเสร็จ──▶ in_progress ──ทำขั้นสุดท้ายเสร็จ──▶ completed   · open ──ยกเลิก (PP)──▶ cancelled (เฉพาะที่ยังไม่มีขั้นใดเสร็จ)
--   * ขั้นแรกเสร็จ = เริ่มงาน: ตัดวัตถุดิบตาม BOM ที่อนุมัติ × จำนวนของใบงาน (เผื่อสูญเสียแบบบวกเพิ่ม) ออกจากคลังจริง (production_issue)
--     หยิบจากล็อตเก่าสุดก่อน (FIFO) ข้ามคลังได้ ถ้ายอดรวมไม่พอทั้งธุรกรรมถูกยกเลิก (JOB_INSUFFICIENT_STOCK) ไม่มีการตัดครึ่งๆ
--   * ขั้นสุดท้ายเสร็จ = รับผลผลิตเข้าคลังที่เลือกตอนออกใบงาน (production_output) ตามจำนวนผลิตจริง (ไม่ระบุ = จำนวนของใบงาน)
--     สร้างล็อต LOT-<เลขที่ใบงาน> ถ้า Item ติดตามล็อต
--   * ใบงานของ Item เดียวกับใบสั่งผลิต (สินค้าสำเร็จรูป) สะสมจำนวนที่ผลิตเสร็จ (completed_qty) ครบแล้วใบสั่งผลิตเป็น completed
--     ใบสั่งผลิตเป็น in_progress เมื่อมีขั้นแรกของใบงานใดๆ เสร็จ (บันทึกประวัติของใบสั่งผลิตเพิ่ม start/output/finish)
--
-- สิทธิ์ (ทุก RPC เรียก private.factory_actor() ก่อน จึงใช้ได้เฉพาะ admin ในโหมดทดสอบ) และจำกัดตามแผนกของ persona
--   * ออก/ยกเลิกใบงาน: แผนก PP เท่านั้น (PRODUCTION_PLANNING_ONLY)
--   * ทำขั้นตอน: แผนกที่ตรงกับศูนย์งานของขั้นนั้น (JOB_STEP_DEPARTMENT_ONLY) รหัสศูนย์งานตรงกับรหัสแผนก (RB SR GR PT BG PK WH)
--     ยกเว้น QC ที่ฝ่ายตรวจสอบขนาดคือแผนก QA ในฐานข้อมูล (ไม่มีแผนก QC) แก้ที่ private.factory_center_department ถ้าเปลี่ยน
--     ศูนย์งานของชุดตัวอย่างเดิม (MIX PRESS CUT PACK) ไม่ตรงแผนกใด ใช้กับใบงานไม่ได้ (ชุดทดลอง 5 สินค้าใช้ศูนย์งานตามแผนก)
--   * ก่อนเปิดกับข้อมูลจริงต้องกำหนดตัวบทบาทจริง (หัวหน้าสายยืนยันขั้น ผู้ตรวจ ผู้รับของเข้าคลัง) และช่องทางแจ้งเตือน
--
-- กฎที่ฐานข้อมูลบังคับ
--   * ใบสั่งผลิตต้อง released/in_progress · Item เป็น WIP/FG ใช้งานอยู่ ผลิตเอง/ซื้อ-ผลิต มี BOM ที่อนุมัติ และ Routing ที่ไม่ obsolete ที่มีขั้นตอน
--     (Item เดียวกับใบสั่งผลิตใช้ Routing ที่ผูกไว้ตอนวางแผน Item อื่นใช้ Revision ล่าสุด) · จำนวน > 0 ไม่เกิน 1,000,000,000 (ปัด 4 ทศนิยม)
--   * ขั้นตอนต้องทำตามลำดับ (JOB_STEP_OUT_OF_ORDER) ทำซ้ำไม่ได้ (JOB_STEP_ALREADY_DONE) ทุกขั้นล็อกแถวเทียบ version (JOB_VERSION_CONFLICT)
--     ตรวจสถานะในธุรกรรมเดียวกับการเปลี่ยน แล้วเขียน factory_job_history (พร้อม snapshot) และ audit_logs (ผู้กระทำคือ admin ตัวจริง)
--   * เลขที่ใบงาน TEST-JB-yy-nnn จากตัวนับแยกชุดทดสอบ (document_counters 'FACTORY-JB-TEST') รีเซ็ตตอนล้างข้อมูลทดสอบฝ่ายโรงงาน
--   * โหมดทดสอบไม่ส่งอีเมล/LINE (กติกาข้อ 4)
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_jobs / factory_job_steps / factory_job_history ใช้แบบเดียวกับ factory_* ทุกตาราง (is_test จาก trigger,
-- foreign key คู่ (id, is_test), RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables()) เพิ่มบัญชีทดสอบ SR/GR/PT/BG/WH
--
-- เริ่มจากนิยามล่าสุดของ private.next_factory_doc_number / private.sandbox_unguarded_tables / app_factory_master_data /
-- app_sandbox_purge_factory (20261007040000) แล้วเพิ่มเฉพาะส่วนของใบงานผลิต และขยาย check ของ factory_production_order_history.action
--
-- Rollback (ตารางเหล่านี้มีแต่ข้อมูลทดสอบ): drop function public.app_factory_create_job(...), app_factory_complete_job_step(...),
--   app_factory_cancel_job(...); drop function private.factory_job_lock(uuid, integer), factory_job_log(...), factory_job_snapshot(uuid),
--   factory_issue_stock(...), factory_center_department(text); drop table factory_job_history, factory_job_steps, factory_jobs (ลูกก่อนแม่);
--   ลบแถว employees SBX-SR/GR/PT/BG/WH-STAFF; คืน check ของ factory_production_order_history.action เป็นชุดเดิมของ 20261007030000
--   (ลบแถวประวัติ start/output/finish ก่อน); แล้ว create or replace private.next_factory_doc_number / private.sandbox_unguarded_tables /
--   app_factory_master_data / app_sandbox_purge_factory ด้วยนิยามเดิมจาก 20261007040000 (ยอดคงคลังจากใบงานเป็นข้อมูลทดสอบ ล้างด้วยปุ่ม
--   "ล้างข้อมูลทดสอบฝ่ายโรงงาน")
-- ============================================================================

-- 1. ตาราง -----------------------------------------------------------------------------
create table public.factory_jobs (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
  production_order_id uuid not null,
  item_id uuid not null,
  bom_id uuid not null,
  routing_id uuid not null,
  warehouse_id uuid not null,
  qty numeric(18, 4) not null check (qty > 0),
  output_qty numeric(18, 4) check (output_qty is null or output_qty > 0),
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  note text not null default '' check (char_length(note) <= 1000),
  cancel_note text not null default '' check (char_length(cancel_note) <= 1000),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_by uuid references public.employees(id) on delete set null,
  cancelled_at timestamptz,
  foreign key (production_order_id, is_test) references public.factory_production_orders(id, is_test),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  foreign key (bom_id, is_test) references public.factory_boms(id, is_test),
  foreign key (routing_id, is_test) references public.factory_routings(id, is_test),
  foreign key (warehouse_id, is_test) references public.factory_warehouses(id, is_test),
  unique (id, is_test),
  unique (is_test, code),
  check ((status = 'completed') = (output_qty is not null))
);
create index factory_jobs_production_idx on public.factory_jobs(production_order_id);
comment on table public.factory_jobs is 'ใบงานผลิต: ผลิต Item หนึ่งของใบสั่งผลิตหนึ่งใบตาม Routing (ขั้น 4–8) ขั้นแรกเสร็จตัดวัตถุดิบ ขั้นสุดท้ายเสร็จรับผลผลิตเข้าคลัง';

create table public.factory_job_steps (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  job_id uuid not null,
  sequence integer not null check (sequence > 0),
  name text not null check (char_length(name) between 1 and 120),
  work_center_code text not null check (work_center_code ~ '^[A-Z0-9_-]{2,20}$'),
  instruction text not null default '' check (char_length(instruction) <= 1000),
  setup_minutes numeric(10, 2) not null default 0 check (setup_minutes >= 0),
  run_minutes numeric(10, 2) not null default 0 check (run_minutes >= 0),
  status text not null default 'pending' check (status in ('pending', 'done')),
  note text not null default '' check (char_length(note) <= 1000),
  completed_by uuid references public.employees(id) on delete set null,
  completed_at timestamptz,
  foreign key (job_id, is_test) references public.factory_jobs(id, is_test),
  unique (job_id, sequence),
  check ((status = 'done') = (completed_at is not null))
);
comment on table public.factory_job_steps is 'ขั้นตอนของใบงาน (คัดลอกจาก Routing ตอนออกใบงาน): ศูนย์งานระบุแผนกที่ทำ';

create table public.factory_job_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  job_id uuid not null,
  action text not null check (action in ('create', 'step', 'complete', 'cancel')),
  version integer not null check (version >= 1),
  status_after text not null check (status_after in ('open', 'in_progress', 'completed', 'cancelled')),
  step_sequence integer,
  note text not null default '' check (char_length(note) <= 1000),
  snapshot jsonb not null,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (job_id, is_test) references public.factory_jobs(id, is_test)
);
create index factory_job_history_job_idx on public.factory_job_history(job_id, created_at desc);

do $$
declare
  v_table text;
begin
  foreach v_table in array array['factory_jobs', 'factory_job_steps', 'factory_job_history'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.factory_sandbox_scope()', v_table || '_sandbox_scope', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;
revoke all on sequence public.factory_job_history_id_seq from anon, authenticated;

-- ประวัติของใบสั่งผลิตเพิ่มการกระทำที่เกิดจากใบงาน: start = ขั้นแรกของใบงานใดๆ เสร็จ · output = ใบงานสินค้าสำเร็จรูปเสร็จบางส่วน · finish = ผลิตครบ
alter table public.factory_production_order_history drop constraint if exists factory_production_order_history_action_check;
alter table public.factory_production_order_history
  add constraint factory_production_order_history_action_check
  check (action in ('create', 'update', 'submit', 'withdraw', 'receive', 'return', 'plan', 'release', 'start', 'output', 'finish'));

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261007040000 ทุกชื่อ แล้วเพิ่มตารางของใบงานผลิต)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history',
    'factory_jobs','factory_job_steps','factory_job_history']
$$;

-- 2. บัญชีทดสอบของแผนกในสายผลิต (RB/PK/QA มีอยู่แล้ว) -----------------------------------------
insert into public.employees (employee_no, first_name, last_name, email, job_title, department_id, role_id, is_active, is_test)
select v.employee_no, 'ทดสอบ', v.last_name, lower(v.employee_no) || '@sandbox.local', v.last_name || ' (ทดสอบ)',
       d.id, r.id, false, true
from (values
  ('SBX-SR-STAFF', 'พนักงาน SR', 'SR', 'staff'),
  ('SBX-GR-STAFF', 'พนักงาน GR', 'GR', 'staff'),
  ('SBX-PT-STAFF', 'พนักงาน PT', 'PT', 'staff'),
  ('SBX-BG-STAFF', 'พนักงาน BG', 'BG', 'staff'),
  ('SBX-WH-STAFF', 'พนักงาน WH', 'WH', 'staff')
) as v(employee_no, last_name, dept_code, role_code)
join public.departments d on d.code = v.dept_code
join public.roles r on r.code = v.role_code
on conflict (employee_no) do nothing;

-- 3. ตัวช่วย (private) -------------------------------------------------------------------
-- เลขที่เอกสารของโหมดทดสอบ (เพิ่มชนิด 'JB' ใบงานผลิต จากนิยามของ 20261007040000)
create or replace function private.next_factory_doc_number(p_kind text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year text := to_char(now() at time zone 'Asia/Bangkok', 'YY');
  v_next integer;
begin
  if p_kind not in ('MO', 'WO', 'MR', 'JB') then raise exception 'INVALID_FACTORY_DOC_KIND'; end if;
  insert into public.document_counters (department_code, year_key, last_number)
  values ('FACTORY-' || p_kind || '-TEST', v_year, 1)
  on conflict (department_code, year_key) do update
    set last_number = public.document_counters.last_number + 1, updated_at = now()
  returning last_number into v_next;
  return 'TEST-' || p_kind || '-' || v_year || '-' || lpad(v_next::text, 3, '0');
end;
$$;
revoke all on function private.next_factory_doc_number(text) from public, anon, authenticated;

-- แผนกที่ทำขั้นตอนของศูนย์งานนั้น: รหัสศูนย์งานตรงกับรหัสแผนก ยกเว้น QC (ตรวจสอบขนาด) ซึ่งในฐานข้อมูลคือแผนก QA
create or replace function private.factory_center_department(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$ select case upper(p_code) when 'QC' then 'QA' else upper(p_code) end $$;
revoke all on function private.factory_center_department(text) from public, anon, authenticated;

create or replace function private.factory_job_lock(p_id uuid, p_version integer)
returns public.factory_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.factory_jobs%rowtype;
begin
  select * into v_job from public.factory_jobs where id = p_id and is_test for update;
  if v_job.id is null then raise exception 'JOB_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_job.version then raise exception 'JOB_VERSION_CONFLICT'; end if;
  return v_job;
end;
$$;
revoke all on function private.factory_job_lock(uuid, integer) from public, anon, authenticated;

create or replace function private.factory_job_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id, 'code', j.code, 'status', j.status, 'version', j.version, 'production_code', p.code,
    'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code, 'qty', j.qty, 'output_qty', j.output_qty,
    'warehouse', w.code, 'note', j.note, 'cancel_note', j.cancel_note,
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object('sequence', s.sequence, 'name', s.name, 'work_center', s.work_center_code,
                                          'status', s.status, 'note', s.note) order by s.sequence)
      from public.factory_job_steps s where s.job_id = j.id), '[]'::jsonb))
  from public.factory_jobs j
  join public.factory_production_orders p on p.id = j.production_order_id
  join public.factory_items i on i.id = j.item_id
  join public.factory_warehouses w on w.id = j.warehouse_id
  where j.id = p_id
$$;
revoke all on function private.factory_job_snapshot(uuid) from public, anon, authenticated;

create or replace function private.factory_job_log(p_job_id uuid, p_action text, p_sequence integer, p_note text, p_actor public.employees)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.factory_jobs%rowtype;
  v_admin_id uuid;
begin
  select * into v_job from public.factory_jobs where id = p_job_id;
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.factory_job_history (job_id, action, version, status_after, step_sequence, note, snapshot, changed_by)
  values (v_job.id, p_action, v_job.version, v_job.status, p_sequence, coalesce(p_note, ''), private.factory_job_snapshot(v_job.id), p_actor.id);
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_JOB_' || upper(p_action), 'factory_jobs', v_job.id::text,
          jsonb_build_object('code', v_job.code, 'version', v_job.version, 'status', v_job.status, 'step', p_sequence,
                             'is_test', v_job.is_test, 'persona_employee_no', p_actor.employee_no));
  return jsonb_build_object('id', v_job.id, 'version', v_job.version, 'code', v_job.code, 'status', v_job.status);
end;
$$;
revoke all on function private.factory_job_log(uuid, text, integer, text, public.employees) from public, anon, authenticated;

-- ตัดวัตถุดิบหนึ่ง Item ออกจากคลังจริง: หยิบจากล็อตเก่าสุดก่อน (ไม่มีล็อต/ล็อตไม่ระบุวันที่ไปท้ายสุด) ข้ามคลังได้ ยอดคงเหลือต่อ (คลัง, ล็อต) ต้อง > 0
-- ถ้ายอดรวมไม่พอ raise JOB_INSUFFICIENT_STOCK (ธุรกรรมทั้งใบถูกยกเลิก ไม่ตัดบางส่วน)
create or replace function private.factory_issue_stock(p_item_id uuid, p_qty numeric, p_job_code text, p_production_order_id uuid, p_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_left numeric := p_qty;
  v_take numeric;
  v_bal record;
begin
  for v_bal in
    select m.warehouse_id, m.lot_id, sum(m.quantity) as balance
    from public.factory_inventory_movements m
    left join public.factory_lots l on l.id = m.lot_id
    where m.is_test and m.item_id = p_item_id
    group by m.warehouse_id, m.lot_id, l.received_date, l.lot_number
    having sum(m.quantity) > 0
    order by l.received_date nulls last, l.lot_number nulls last, m.warehouse_id
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_bal.balance);
    insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, production_order_id, created_by)
    values (p_item_id, v_bal.warehouse_id, v_bal.lot_id, -v_take, 'production_issue', 'ตัดวัตถุดิบตามใบงาน ' || p_job_code, p_production_order_id, p_actor_id);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'JOB_INSUFFICIENT_STOCK'; end if;
end;
$$;
revoke all on function private.factory_issue_stock(uuid, numeric, text, uuid, uuid) from public, anon, authenticated;

-- 4. ออกใบงาน / ยกเลิก (ฝ่ายวางแผน) ---------------------------------------------------------
create or replace function public.app_factory_create_job(
  p_production_order_id uuid, p_item_id uuid, p_qty numeric, p_warehouse_code text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_item public.factory_items%rowtype;
  v_bom_id uuid;
  v_routing_id uuid;
  v_warehouse_id uuid;
  v_qty numeric;
  v_note text := btrim(coalesce(p_note, ''));
  v_job public.factory_jobs%rowtype;
begin
  v_actor := private.factory_order_actor('PP');
  if p_qty is null or p_qty = 'NaN'::numeric then raise exception 'INVALID_JOB_QTY'; end if;
  v_qty := round(p_qty, 4);
  if v_qty <= 0 or v_qty > 1000000000 then raise exception 'INVALID_JOB_QTY'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_JOB_NOTE'; end if;

  select * into v_order from public.factory_production_orders where id = p_production_order_id and is_test;
  if v_order.id is null then raise exception 'JOB_WORK_ORDER_UNKNOWN'; end if;
  if v_order.status not in ('released', 'in_progress') then raise exception 'JOB_WORK_ORDER_NOT_RELEASED'; end if;

  select * into v_item from public.factory_items where id = p_item_id and is_test;
  if v_item.id is null then raise exception 'JOB_ITEM_UNKNOWN'; end if;
  if v_item.status <> 'active' or v_item.item_type not in ('WIP', 'FG') or v_item.procurement not in ('make', 'both') then
    raise exception 'JOB_ITEM_INVALID';
  end if;

  select id into v_bom_id from public.factory_boms where item_id = v_item.id and is_test and status = 'approved';
  if v_bom_id is null then raise exception 'JOB_BOM_INVALID'; end if;

  -- Item เดียวกับใบสั่งผลิตใช้ Routing ที่ผูกไว้ตอนวางแผน ส่วน Item อื่นใช้ Revision ล่าสุดที่ไม่เลิกใช้
  if v_item.id = v_order.item_id then
    select r.id into v_routing_id from public.factory_routings r where r.id = v_order.routing_id and r.is_test and r.status <> 'obsolete';
  else
    select r.id into v_routing_id from public.factory_routings r
    where r.item_id = v_item.id and r.is_test and r.status <> 'obsolete' order by r.revision desc limit 1;
  end if;
  if v_routing_id is null or not exists (select 1 from public.factory_routing_steps where routing_id = v_routing_id) then
    raise exception 'JOB_ROUTING_INVALID';
  end if;

  select id into v_warehouse_id from public.factory_warehouses where is_test and code = upper(btrim(coalesce(p_warehouse_code, '')));
  if v_warehouse_id is null then raise exception 'JOB_WAREHOUSE_UNKNOWN'; end if;

  insert into public.factory_jobs (code, production_order_id, item_id, bom_id, routing_id, warehouse_id, qty, note, created_by, updated_by)
  values (private.next_factory_doc_number('JB'), v_order.id, v_item.id, v_bom_id, v_routing_id, v_warehouse_id, v_qty, v_note, v_actor.id, v_actor.id)
  returning * into v_job;

  insert into public.factory_job_steps (job_id, sequence, name, work_center_code, instruction, setup_minutes, run_minutes)
  select v_job.id, s.sequence, s.name, w.code, s.instruction, s.setup_minutes, s.run_minutes
  from public.factory_routing_steps s join public.factory_work_centers w on w.id = s.work_center_id
  where s.routing_id = v_routing_id;

  return private.factory_job_log(v_job.id, 'create', null, v_note, v_actor);
end;
$$;

-- ยกเลิกได้เฉพาะใบงานที่ยังไม่มีขั้นใดเสร็จ (ยังไม่ตัดวัตถุดิบ)
create or replace function public.app_factory_cancel_job(p_id uuid, p_version integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_actor := private.factory_order_actor('PP');
  if v_note = '' then raise exception 'JOB_CANCEL_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_JOB_NOTE'; end if;
  v_job := private.factory_job_lock(p_id, p_version);
  if v_job.status <> 'open' then raise exception 'JOB_NOT_CANCELLABLE'; end if;
  update public.factory_jobs
  set status = 'cancelled', cancel_note = v_note, version = v_job.version + 1, cancelled_by = v_actor.id, cancelled_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_job.id;
  return private.factory_job_log(v_job.id, 'cancel', null, v_note, v_actor);
end;
$$;

-- 5. ทำขั้นตอนของใบงาน (แผนกที่ตรงกับศูนย์งานของขั้นนั้น) ------------------------------------------
-- ขั้นแรก: ตัดวัตถุดิบตาม BOM · ขั้นสุดท้าย: รับผลผลิตเข้าคลัง (p_output_qty ระบุได้เฉพาะขั้นสุดท้าย) · ทั้งหมดในธุรกรรมเดียว
create or replace function public.app_factory_complete_job_step(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_output_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_step public.factory_job_steps%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_first boolean;
  v_last boolean;
  v_out numeric;
  v_line record;
  v_need numeric;
  v_item public.factory_items%rowtype;
  v_lot uuid;
  v_done numeric;
begin
  v_actor := private.factory_actor();
  if char_length(v_note) > 1000 then raise exception 'INVALID_JOB_NOTE'; end if;
  v_job := private.factory_job_lock(p_id, p_version);
  if v_job.status not in ('open', 'in_progress') then raise exception 'JOB_NOT_ACTIVE'; end if;

  select * into v_step from public.factory_job_steps where job_id = v_job.id and sequence = p_sequence for update;
  if v_step.id is null then raise exception 'JOB_STEP_NOT_FOUND'; end if;
  if v_step.status = 'done' then raise exception 'JOB_STEP_ALREADY_DONE'; end if;
  if exists (select 1 from public.factory_job_steps where job_id = v_job.id and sequence < v_step.sequence and status <> 'done') then
    raise exception 'JOB_STEP_OUT_OF_ORDER';
  end if;
  if not exists (select 1 from public.departments d
                 where d.id = v_actor.department_id and d.code = private.factory_center_department(v_step.work_center_code)) then
    raise exception 'JOB_STEP_DEPARTMENT_ONLY';
  end if;

  v_first := not exists (select 1 from public.factory_job_steps where job_id = v_job.id and status = 'done');
  v_last := not exists (select 1 from public.factory_job_steps where job_id = v_job.id and sequence <> v_step.sequence and status <> 'done');
  if p_output_qty is not null and not v_last then raise exception 'INVALID_JOB_OUTPUT_QTY'; end if;

  select * into v_order from public.factory_production_orders where id = v_job.production_order_id for update;

  if v_first then
    -- เริ่มงาน: ตัดวัตถุดิบตาม BOM ที่ผูกไว้ × จำนวนของใบงาน (เผื่อสูญเสียแบบบวกเพิ่ม ปัด 4 ทศนิยมต่อบรรทัด)
    for v_line in
      select l.component_id, round((l.quantity * v_job.qty / b.output_qty) * (1 + l.scrap_percent / 100), 4) as need
      from public.factory_bom_lines l join public.factory_boms b on b.id = l.bom_id
      where l.bom_id = v_job.bom_id order by l.line_no
    loop
      v_need := v_line.need;
      if v_need > 0 then
        perform private.factory_issue_stock(v_line.component_id, v_need, v_job.code, v_job.production_order_id, v_actor.id);
      end if;
    end loop;
  end if;

  update public.factory_job_steps
  set status = 'done', note = v_note, completed_by = v_actor.id, completed_at = now()
  where id = v_step.id;

  if v_last then
    v_out := coalesce(round(p_output_qty, 4), v_job.qty);
    if v_out is null or v_out = 'NaN'::numeric or v_out <= 0 or v_out > 1000000000 then raise exception 'INVALID_JOB_OUTPUT_QTY'; end if;
    select * into v_item from public.factory_items where id = v_job.item_id;
    v_lot := null;
    if v_item.lot_tracking then
      insert into public.factory_lots (item_id, lot_number, received_date)
      values (v_item.id, 'LOT-' || v_job.code, (now() at time zone 'Asia/Bangkok')::date)
      returning id into v_lot;
    end if;
    insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, production_order_id, created_by)
    values (v_item.id, v_job.warehouse_id, v_lot, v_out, 'production_output', 'รับผลผลิตตามใบงาน ' || v_job.code, v_job.production_order_id, v_actor.id);
    update public.factory_jobs
    set status = 'completed', output_qty = v_out, version = v_job.version + 1, started_at = coalesce(started_at, now()),
        completed_at = now(), updated_by = v_actor.id, updated_at = now()
    where id = v_job.id;
  else
    update public.factory_jobs
    set status = 'in_progress', version = v_job.version + 1, started_at = coalesce(started_at, now()),
        updated_by = v_actor.id, updated_at = now()
    where id = v_job.id;
  end if;

  -- ความคืบหน้าของใบสั่งผลิต: ขั้นแรกของใบงานใดๆ → in_progress · ใบงานสินค้าสำเร็จรูปเสร็จ → สะสมจำนวนที่ผลิตแล้ว ครบ → completed
  if v_first and v_order.status = 'released' then
    update public.factory_production_orders set status = 'in_progress', version = v_order.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_order.id;
    perform private.factory_order_log(v_order.id, 'start', v_job.code, v_actor);
    v_order.version := v_order.version + 1;
    v_order.status := 'in_progress';
  end if;
  if v_last and v_job.item_id = v_order.item_id then
    v_done := least(v_order.planned_qty, v_order.completed_qty + v_out);
    update public.factory_production_orders
    set completed_qty = v_done, status = case when v_done >= planned_qty then 'completed' else status end,
        version = v_order.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_order.id;
    perform private.factory_order_log(v_order.id, case when v_done >= v_order.planned_qty then 'finish' else 'output' end, v_job.code, v_actor);
  end if;

  return private.factory_job_log(v_job.id, case when v_last then 'complete' else 'step' end, v_step.sequence, v_note, v_actor);
end;
$$;

-- 6. อ่านข้อมูลทั้งหมดของโมดูล: เพิ่ม jobs และ job_history ----------------------------------------
create or replace function public.app_factory_master_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_test boolean;
begin
  perform private.factory_actor();
  v_test := (private.sandbox_persona()).id is not null;
  return jsonb_build_object(
    'units', coalesce((
      select jsonb_agg(jsonb_build_object('code', u.code, 'name_th', u.name_th) order by u.sort_order, u.code)
      from public.factory_units u), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('code', c.code, 'name_th', c.name_th) order by c.sort_order, c.code)
      from public.factory_categories c), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'code', i.code, 'name', i.name, 'name_en', i.name_en, 'item_type', i.item_type,
          'category_code', i.category_code, 'category_name', c.name_th, 'brand', i.brand,
          'unit_code', i.unit_code, 'procurement', i.procurement, 'status', i.status,
          'lot_tracking', i.lot_tracking, 'min_stock', i.min_stock, 'specification', i.specification,
          'version', i.version, 'created_at', i.created_at, 'updated_at', i.updated_at,
          'updated_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = i.updated_by),
          'stock', coalesce((select sum(m.quantity) from public.factory_inventory_movements m
                             where m.item_id = i.id and m.is_test = v_test), 0)
        ) order by i.code)
      from public.factory_items i
      join public.factory_categories c on c.code = i.category_code
      where i.is_test = v_test), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', b.id, 'item_id', b.item_id, 'code', i.code, 'name', i.name, 'unit_code', i.unit_code,
          'revision', b.revision, 'output_qty', b.output_qty, 'status', b.status, 'effective_date', b.effective_date,
          'version', b.version, 'note', b.note, 'created_at', b.created_at, 'updated_at', b.updated_at,
          'submitted_at', b.submitted_at, 'decided_at', b.decided_at, 'decision_note', b.decision_note,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.created_by),
          'submitted_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.submitted_by),
          'decided_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = b.decided_by)
        ) order by i.code, b.revision)
      from public.factory_boms b join public.factory_items i on i.id = b.item_id
      where b.is_test = v_test), '[]'::jsonb),
    'bom_lines', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id, 'bom_id', l.bom_id, 'line_no', l.line_no, 'component_id', l.component_id,
          'code', i.code, 'name', i.name, 'unit_code', i.unit_code, 'quantity', l.quantity,
          'scrap_percent', l.scrap_percent
        ) order by l.bom_id, l.line_no)
      from public.factory_bom_lines l join public.factory_items i on i.id = l.component_id
      where l.is_test = v_test), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'item_id', r.item_id, 'code', i.code, 'name', i.name,
          'revision', r.revision, 'status', r.status
        ) order by i.code, r.revision)
      from public.factory_routings r join public.factory_items i on i.id = r.item_id
      where r.is_test = v_test), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'routing_id', s.routing_id, 'sequence', s.sequence, 'name', s.name,
          'work_center', w.name, 'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes,
          'instruction', s.instruction
        ) order by s.routing_id, s.sequence)
      from public.factory_routing_steps s join public.factory_work_centers w on w.id = s.work_center_id
      where s.is_test = v_test), '[]'::jsonb),
    'warehouses', coalesce((
      select jsonb_agg(jsonb_build_object('id', w.id, 'code', w.code, 'name', w.name) order by w.code)
      from public.factory_warehouses w where w.is_test = v_test), '[]'::jsonb),
    -- คงเหลือต่อ Item × คลัง × ล็อต ของ Item ที่ใช้งาน (Item ที่ยังไม่มีรายการเคลื่อนไหวแสดง 0 ไม่ระบุคลัง)
    'inventory', coalesce((
      select jsonb_agg(jsonb_build_object(
          'item_id', x.item_id, 'code', x.code, 'name', x.name, 'unit_code', x.unit_code, 'min_stock', x.min_stock,
          'warehouse', x.warehouse, 'lot_number', x.lot_number, 'quantity', x.quantity
        ) order by x.code, x.warehouse, x.lot_number)
      from (
        select i.id as item_id, i.code, i.name, i.unit_code, i.min_stock,
               coalesce(w.name, 'ยังไม่ระบุคลัง') as warehouse, l.lot_number,
               coalesce(sum(m.quantity), 0) as quantity
        from public.factory_items i
        left join public.factory_inventory_movements m on m.item_id = i.id and m.is_test = v_test
        left join public.factory_warehouses w on w.id = m.warehouse_id
        left join public.factory_lots l on l.id = m.lot_id
        where i.is_test = v_test and i.status = 'active'
        group by i.id, i.code, i.name, i.unit_code, i.min_stock, w.name, l.lot_number
      ) x), '[]'::jsonb),
    'production', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', p.id, 'code', p.code, 'item_id', p.item_id, 'item_code', i.code, 'name', i.name, 'unit_code', i.unit_code,
          'bom_id', p.bom_id, 'routing_id', p.routing_id, 'planned_qty', p.planned_qty,
          'completed_qty', p.completed_qty, 'status', p.status, 'due_date', p.due_date,
          'customer', p.customer, 'note', p.note, 'survey_note', p.survey_note, 'return_note', p.return_note,
          'work_order_no', p.work_order_no, 'version', p.version,
          'bom_revision', b.revision, 'bom_status', b.status, 'routing_revision', r.revision,
          'created_at', p.created_at, 'updated_at', p.updated_at, 'submitted_at', p.submitted_at,
          'received_at', p.received_at, 'planned_at', p.planned_at, 'released_at', p.released_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.created_by),
          'submitted_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.submitted_by),
          'received_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.received_by),
          'planned_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.planned_by),
          'released_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.released_by)
        ) order by p.code)
      from public.factory_production_orders p
      join public.factory_items i on i.id = p.item_id
      left join public.factory_boms b on b.id = p.bom_id
      left join public.factory_routings r on r.id = p.routing_id
      where p.is_test = v_test), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'item_id', x.item_id, 'code', i.code, 'name', i.name, 'action', x.action,
            'version', x.version, 'before_data', x.before_data, 'after_data', x.after_data,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_item_history x join public.factory_items i on i.id = x.item_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 50
      ) h), '[]'::jsonb),
    -- ประวัติของ BOM ทุกฉบับ (300 รายการล่าสุด) ไม่รวม snapshot เพื่อไม่ให้ข้อมูลหนักเกินไป
    'bom_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'bom_id', x.bom_id, 'code', i.code, 'name', i.name, 'revision', b.revision,
            'action', x.action, 'version', x.version, 'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_bom_history x
        join public.factory_boms b on b.id = x.bom_id
        join public.factory_items i on i.id = b.item_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb),
    -- ประวัติของใบสั่งผลิตทุกใบ (300 รายการล่าสุด) ไม่รวม snapshot
    'production_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'order_id', x.order_id, 'code', p.code, 'action', x.action, 'version', x.version,
            'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_production_order_history x
        join public.factory_production_orders p on p.id = x.order_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb),
    -- ใบสั่งวัตถุดิบของแผนก ST พร้อมบรรทัด (ขั้น 3.1)
    'material_orders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id, 'code', m.code, 'status', m.status, 'version', m.version,
          'production_order_id', m.production_order_id, 'production_code', p.code,
          'item_code', fi.code, 'item_name', fi.name,
          'supplier', m.supplier, 'expected_date', m.expected_date, 'note', m.note, 'cancel_note', m.cancel_note,
          'created_at', m.created_at, 'ordered_at', m.ordered_at, 'received_at', m.received_at, 'cancelled_at', m.cancelled_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.created_by),
          'ordered_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.ordered_by),
          'received_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.received_by),
          'cancelled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = m.cancelled_by),
          'lines', coalesce((
            select jsonb_agg(jsonb_build_object(
                'line_no', l.line_no, 'item_id', l.item_id, 'code', ci.code, 'name', ci.name,
                'unit_code', ci.unit_code, 'quantity', l.quantity) order by l.line_no)
            from public.factory_material_order_lines l join public.factory_items ci on ci.id = l.item_id
            where l.order_id = m.id), '[]'::jsonb)
        ) order by m.code desc)
      from public.factory_material_orders m
      join public.factory_production_orders p on p.id = m.production_order_id
      join public.factory_items fi on fi.id = p.item_id
      where m.is_test = v_test), '[]'::jsonb),
    -- ประวัติของใบสั่งวัตถุดิบทุกใบ (300 รายการล่าสุด) ไม่รวม snapshot
    'material_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'order_id', x.order_id, 'code', m.code, 'action', x.action, 'version', x.version,
            'status_after', x.status_after, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_material_order_history x
        join public.factory_material_orders m on m.id = x.order_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb),
    -- ใบงานผลิตพร้อมขั้นตอน (ขั้น 4–8)
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', j.id, 'code', j.code, 'status', j.status, 'version', j.version,
          'production_order_id', j.production_order_id, 'production_code', p.code,
          'order_item_code', oi.code, 'item_id', j.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code,
          'qty', j.qty, 'output_qty', j.output_qty, 'bom_id', j.bom_id, 'bom_revision', b.revision,
          'routing_id', j.routing_id, 'routing_revision', r.revision, 'warehouse_code', w.code, 'warehouse_name', w.name,
          'note', j.note, 'cancel_note', j.cancel_note,
          'created_at', j.created_at, 'started_at', j.started_at, 'completed_at', j.completed_at, 'cancelled_at', j.cancelled_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = j.created_by),
          'cancelled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = j.cancelled_by),
          'steps', coalesce((
            select jsonb_agg(jsonb_build_object(
                'sequence', s.sequence, 'name', s.name, 'work_center_code', s.work_center_code,
                'department_code', private.factory_center_department(s.work_center_code),
                'instruction', s.instruction, 'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes,
                'status', s.status, 'note', s.note, 'completed_at', s.completed_at,
                'completed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = s.completed_by)
              ) order by s.sequence)
            from public.factory_job_steps s where s.job_id = j.id), '[]'::jsonb)
        ) order by j.code desc)
      from public.factory_jobs j
      join public.factory_production_orders p on p.id = j.production_order_id
      join public.factory_items oi on oi.id = p.item_id
      join public.factory_items i on i.id = j.item_id
      join public.factory_boms b on b.id = j.bom_id
      join public.factory_routings r on r.id = j.routing_id
      join public.factory_warehouses w on w.id = j.warehouse_id
      where j.is_test = v_test), '[]'::jsonb),
    -- ประวัติของใบงานทุกใบ (300 รายการล่าสุด) ไม่รวม snapshot
    'job_history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'job_id', x.job_id, 'code', j.code, 'action', x.action, 'version', x.version,
            'status_after', x.status_after, 'step_sequence', x.step_sequence, 'note', x.note,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by),
            'created_at', x.created_at) as entry
        from public.factory_job_history x
        join public.factory_jobs j on j.id = x.job_id
        where x.is_test = v_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb)
  );
end;
$$;

-- 7. ล้างข้อมูลทดสอบของฝ่ายโรงงาน: เพิ่มใบงานผลิตและตัวนับเลข JB -----------------------------------
create or replace function public.app_sandbox_purge_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_items integer;
begin
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ใบงานผลิตและใบสั่งวัตถุดิบอ้างใบสั่งผลิต/BOM/Routing/คลัง ต้องลบก่อน (ลูกก่อนแม่)
  delete from public.factory_job_history where is_test;
  delete from public.factory_job_steps where is_test;
  delete from public.factory_jobs where is_test;
  delete from public.factory_material_order_history where is_test;
  delete from public.factory_material_order_lines where is_test;
  delete from public.factory_material_orders where is_test;
  delete from public.factory_inventory_movements where is_test;
  delete from public.factory_lots where is_test;
  delete from public.factory_production_order_history where is_test;
  delete from public.factory_production_orders where is_test;
  delete from public.factory_routing_steps where is_test;
  delete from public.factory_routings where is_test;
  delete from public.factory_bom_history where is_test;
  delete from public.factory_bom_lines where is_test;
  delete from public.factory_boms where is_test;
  delete from public.factory_item_unit_conversions where is_test;
  delete from public.factory_item_history where is_test;
  delete from public.factory_items where is_test;
  get diagnostics v_items = row_count;
  delete from public.factory_work_centers where is_test;
  delete from public.factory_warehouses where is_test;
  -- เริ่มนับเลขใบสั่งผลิต/ใบสั่งงานของโหมดทดสอบใหม่
  delete from public.document_counters where department_code in ('FACTORY-MO-TEST', 'FACTORY-WO-TEST', 'FACTORY-MR-TEST', 'FACTORY-JB-TEST');

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;

revoke all on function public.app_factory_create_job(uuid, uuid, numeric, text, text) from public, anon;
revoke all on function public.app_factory_cancel_job(uuid, integer, text) from public, anon;
revoke all on function public.app_factory_complete_job_step(uuid, integer, integer, text, numeric) from public, anon;
grant execute on function public.app_factory_create_job(uuid, uuid, numeric, text, text) to authenticated;
grant execute on function public.app_factory_cancel_job(uuid, integer, text) to authenticated;
grant execute on function public.app_factory_complete_job_step(uuid, integer, integer, text, numeric) to authenticated;
