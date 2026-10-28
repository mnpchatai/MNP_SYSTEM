-- ============================================================================
-- ฝ่ายโรงงาน: พารามิเตอร์กระบวนการของขั้นตอนใน Routing และการกักกันใบงานอัตโนมัติ (Auto Hold) โหมดทดสอบเท่านั้น
--
-- ต่อจากใบงานผลิต (20261007050000) และผลตรวจ QC (20261007070000) ที่ขั้นในสายผลิต (เช่น RB ขึ้นรูปยาง) กด "เสร็จ" ได้โดยไม่บันทึกค่าใดๆ
-- migration นี้ให้ฝ่ายวางแผนกำหนดพารามิเตอร์พร้อมสเปก (min/max) ที่ขั้นของ Routing แล้วบังคับให้แผนกที่ทำขั้นนั้นบันทึกค่าจริงตอนปิดขั้น
-- ค่าใดหลุดสเปก ระบบกักกัน (Hold) ใบงานทันทีในธุรกรรมเดียวกัน จนกว่า QA จะตัดสิน
--
-- กติกา
--   * กำหนดพารามิเตอร์: app_factory_set_step_params แผนก PP เท่านั้น (PRODUCTION_PLANNING_ONLY) แทนที่ชุดเดิมของขั้นนั้นทั้งชุด
--     ไม่เกิน 20 รายการต่อขั้น รหัสไม่ซ้ำ ต้องมี min หรือ max อย่างน้อยหนึ่งค่า min ≤ max · ขั้นศูนย์งาน QC กำหนดไม่ได้ (ใช้ผลตรวจ QC เดิม)
--     ใบงานที่ยังไม่ถึงขั้นนั้นใช้สเปกล่าสุดตอนบันทึก (ค่าที่บันทึกเก็บ min/max ณ เวลานั้นไว้ด้วย)
--   * ขั้นที่มีพารามิเตอร์ปิดได้ทาง app_factory_complete_job_step_with_readings เท่านั้น app_factory_complete_job_step ปฏิเสธด้วย
--     JOB_STEP_READINGS_REQUIRED (ตัวเนื้อหาของ private.factory_run_job_step คงเดิม เพิ่มด่านนี้และด่าน Hold)
--     ต้องส่งค่าครบทุกรหัสเป็นตัวเลข ไม่มีรหัสเกิน ค่าหลุดสเปก = ปิดขั้นตามเดิม (ตัดวัตถุดิบ/รับผลผลิตตามเดิม) แล้วกักกันใบงาน
--   * ใบงานที่ถูกกักกันทำขั้นถัดไปไม่ได้ (JOB_ON_HOLD) รวมถึงตรวจ QC ผ่าน ฝ่ายวางแผนยังยกเลิกใบงานได้ตามกติกาเดิม
--   * QA ตัดสิน: app_factory_decide_job_hold แผนก QA เท่านั้น ต้องมีเหตุผล 10–1,000 ตัวอักษร
--     release = ปลดกักกัน ใบงานเดินต่อ · ncr = ออก NCR ด้วย public.app_ncr_issue (แหล่งที่พบ in_process, lot = เลขที่ใบงาน)
--     ใบงานยังถูกกักกันรอปลดหรือยกเลิก (ออก NCR ซ้ำได้)
--   * ทุกการกระทำเขียน factory_job_history (hold / release / hold_ncr) และ audit_logs (ผู้กระทำคือ admin ตัวจริงเบื้องหลัง persona)
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_routing_step_params / factory_job_step_readings ใช้แบบเดียวกับ factory_* ทุกตาราง
-- (is_test จาก trigger, foreign key คู่ (id, is_test), RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables())
-- ล้างพร้อมข้อมูลทดสอบฝ่ายโรงงาน (นับรวมใน details ของหน้า "ข้อมูลทดสอบ")
--
-- เริ่มจากนิยามล่าสุดของ private.factory_run_job_step (20261007070000), private.factory_job_snapshot (20261008010000),
-- app_factory_master_data (20261008030000), private.factory_test_data_counts / app_sandbox_purge_factory (20261014030000)
-- และ private.sandbox_unguarded_tables (20261027010000)
--
-- Rollback (ข้อมูลทดสอบอย่างเดียว): drop function public.app_factory_set_step_params(uuid, jsonb),
--   public.app_factory_complete_job_step_with_readings(uuid, integer, integer, text, jsonb, numeric),
--   public.app_factory_decide_job_hold(uuid, integer, text, text, numeric, text),
--   private.factory_run_job_step(uuid, integer, integer, text, numeric, boolean, boolean);
--   create or replace private.factory_run_job_step(6 อาร์กิวเมนต์) ด้วยนิยามเดิมของ 20261007070000;
--   drop table public.factory_job_step_readings, public.factory_routing_step_params;
--   alter table public.factory_jobs drop column on_hold, hold_reason, held_at, hold_ncr_id, hold_ncr_no;
--   alter table public.factory_routing_steps drop constraint factory_routing_steps_id_is_test_key;
--   คืน check ของ factory_job_history.action เป็นชุดของ 20261008010000 (ลบแถว hold/release/hold_ncr ก่อน);
--   แล้ว create or replace private.factory_job_snapshot / app_factory_master_data / private.factory_test_data_counts /
--   app_sandbox_purge_factory / private.sandbox_unguarded_tables ด้วยนิยามเดิมที่ระบุข้างบน
-- ============================================================================

-- 1. ตาราง -----------------------------------------------------------------------------
alter table public.factory_routing_steps add constraint factory_routing_steps_id_is_test_key unique (id, is_test);

create table public.factory_routing_step_params (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  routing_step_id uuid not null,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  label text not null check (char_length(label) between 1 and 80),
  unit text not null default '' check (char_length(unit) <= 20),
  min_value numeric(18, 4),
  max_value numeric(18, 4),
  sort_order integer not null check (sort_order > 0),
  foreign key (routing_step_id, is_test) references public.factory_routing_steps(id, is_test),
  unique (routing_step_id, code),
  check (min_value is not null or max_value is not null),
  check (min_value is null or max_value is null or min_value <= max_value)
);
comment on table public.factory_routing_step_params is 'พารามิเตอร์กระบวนการของขั้นใน Routing พร้อมสเปก min/max: แผนกที่ทำขั้นต้องบันทึกค่าจริงตอนปิดขั้น หลุดสเปก = กักกันใบงาน';

create table public.factory_job_step_readings (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  job_id uuid not null,
  step_sequence integer not null check (step_sequence > 0),
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{0,19}$'),
  label text not null check (char_length(label) between 1 and 80),
  unit text not null default '' check (char_length(unit) <= 20),
  value numeric(18, 4) not null,
  min_value numeric(18, 4),
  max_value numeric(18, 4),
  in_spec boolean not null,
  recorded_by uuid references public.employees(id) on delete set null,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, is_test) references public.factory_jobs(id, is_test),
  unique (job_id, step_sequence, code)
);
create index factory_job_step_readings_job_idx on public.factory_job_step_readings(job_id, step_sequence);
comment on table public.factory_job_step_readings is 'ค่าพารามิเตอร์ที่บันทึกตอนปิดขั้นของใบงาน พร้อมสเปก ณ เวลาที่บันทึก';

do $$
declare
  v_table text;
begin
  foreach v_table in array array['factory_routing_step_params', 'factory_job_step_readings'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.factory_sandbox_scope()', v_table || '_sandbox_scope', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;
-- บัญชี lab-only (20261019005000) ห้ามเข้าถึงตารางใหม่ทุกตาราง
select private.lab_only_guard_table('public.factory_routing_step_params');
select private.lab_only_guard_table('public.factory_job_step_readings');

-- สถานะกักกันของใบงาน: แยกจาก status (ใบงานยัง in_progress/completed ตามเดิม แต่ทำขั้นถัดไปไม่ได้จนกว่า QA ปลด)
alter table public.factory_jobs
  add column on_hold boolean not null default false,
  add column hold_reason text not null default '' check (char_length(hold_reason) <= 1000),
  add column held_at timestamptz,
  add column hold_ncr_id uuid references public.ncr_reports(id) on delete set null,
  add column hold_ncr_no text;

-- ประวัติของใบงานเพิ่ม hold (กักกันอัตโนมัติ) release (QA ปลด) hold_ncr (QA ออก NCR ระหว่างกักกัน)
alter table public.factory_job_history drop constraint if exists factory_job_history_action_check;
alter table public.factory_job_history
  add constraint factory_job_history_action_check
  check (action in ('create', 'step', 'complete', 'cancel', 'qc_fail', 'schedule', 'hold', 'release', 'hold_ncr'));

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261027010000 ทุกชื่อ แล้วเพิ่มสองตารางใหม่)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history',
    'factory_jobs','factory_job_steps','factory_job_history','factory_job_inspections',
    'factory_attachments',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'factory_routing_step_params','factory_job_step_readings']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- snapshot ของใบงานเก็บสถานะกักกันด้วย (คัดลอกนิยามของ 20261008010000 เพิ่มเฉพาะ on_hold / hold_reason)
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
    'planned_start', j.planned_start, 'planned_end', j.planned_end, 'schedule_version', j.schedule_version,
    'on_hold', j.on_hold, 'hold_reason', j.hold_reason,
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

-- 2. ขั้นทำงานของใบงาน: เนื้อหาเดิมของ 20261007070000 ทุกบรรทัด เพิ่มเฉพาะด่าน Hold และด่านพารามิเตอร์ ------------
create or replace function private.factory_run_job_step(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_output_qty numeric, p_via_qc boolean, p_via_readings boolean)
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
  -- ใบงานที่ถูกกักกันทำขั้นใดไม่ได้จนกว่า QA ปลด (app_factory_decide_job_hold)
  if v_job.on_hold then raise exception 'JOB_ON_HOLD'; end if;

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
  -- ขั้นตรวจขนาด (ศูนย์งาน QC) ปิดได้ทางบันทึกผลตรวจ QC เท่านั้น (app_factory_record_qc ผ่านเงื่อนไขนี้ด้วย p_via_qc)
  if v_step.work_center_code = 'QC' and not p_via_qc then raise exception 'JOB_QC_INSPECTION_REQUIRED'; end if;
  -- ขั้นที่ Routing กำหนดพารามิเตอร์ไว้ ปิดได้ทางบันทึกค่าเท่านั้น (app_factory_complete_job_step_with_readings ผ่านด้วย p_via_readings)
  if not p_via_readings and exists (
    select 1 from public.factory_routing_step_params x
    join public.factory_routing_steps s on s.id = x.routing_step_id
    where s.routing_id = v_job.routing_id and s.sequence = v_step.sequence) then
    raise exception 'JOB_STEP_READINGS_REQUIRED';
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
revoke all on function private.factory_run_job_step(uuid, integer, integer, text, numeric, boolean, boolean) from public, anon, authenticated;

-- ลายเซ็นเดิม (app_factory_complete_job_step และ app_factory_record_qc เรียกอยู่) ส่งต่อไปฟังก์ชันใหม่โดยไม่ผ่านด่านพารามิเตอร์
create or replace function private.factory_run_job_step(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_output_qty numeric, p_via_qc boolean)
returns jsonb
language sql
security definer
set search_path = ''
as $$ select private.factory_run_job_step(p_id, p_version, p_sequence, p_note, p_output_qty, p_via_qc, false) $$;
revoke all on function private.factory_run_job_step(uuid, integer, integer, text, numeric, boolean) from public, anon, authenticated;

-- 3. กำหนดพารามิเตอร์ของขั้นใน Routing (ฝ่ายวางแผน) ---------------------------------------------
create or replace function public.app_factory_set_step_params(p_routing_step_id uuid, p_params jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_step public.factory_routing_steps%rowtype;
  v_center text;
  v_entry jsonb;
  v_order integer;
  v_code text;
  v_label text;
  v_unit text;
  v_min numeric;
  v_max numeric;
  v_codes text[] := '{}';
  v_admin_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.factory_actor();
  if not exists (select 1 from public.departments d where d.id = v_actor.department_id and d.code = 'PP') then
    raise exception 'PRODUCTION_PLANNING_ONLY';
  end if;
  select * into v_step from public.factory_routing_steps where id = p_routing_step_id and is_test for update;
  if v_step.id is null then raise exception 'ROUTING_STEP_NOT_FOUND'; end if;
  select w.code into v_center from public.factory_work_centers w where w.id = v_step.work_center_id;
  if v_center = 'QC' then raise exception 'STEP_PARAMS_QC_STEP'; end if;
  if p_params is null or jsonb_typeof(p_params) <> 'array' or jsonb_array_length(p_params) > 20 then
    raise exception 'INVALID_STEP_PARAMS';
  end if;

  delete from public.factory_routing_step_params where routing_step_id = v_step.id;
  for v_entry, v_order in select e.value, e.ordinality::integer from jsonb_array_elements(p_params) with ordinality e loop
    if jsonb_typeof(v_entry) <> 'object'
       or coalesce(jsonb_typeof(v_entry -> 'min'), 'null') not in ('number', 'null')
       or coalesce(jsonb_typeof(v_entry -> 'max'), 'null') not in ('number', 'null') then
      raise exception 'INVALID_STEP_PARAMS';
    end if;
    v_code := upper(btrim(coalesce(v_entry ->> 'code', '')));
    v_label := btrim(coalesce(v_entry ->> 'label', ''));
    v_unit := btrim(coalesce(v_entry ->> 'unit', ''));
    v_min := (v_entry ->> 'min')::numeric;
    v_max := (v_entry ->> 'max')::numeric;
    if v_code !~ '^[A-Z][A-Z0-9_]{0,19}$' or v_code = any (v_codes)
       or char_length(v_label) not between 1 and 80 or char_length(v_unit) > 20
       or (v_min is null and v_max is null) or (v_min is not null and v_max is not null and v_min > v_max)
       or abs(coalesce(v_min, 0)) > 1000000000 or abs(coalesce(v_max, 0)) > 1000000000 then
      raise exception 'INVALID_STEP_PARAMS';
    end if;
    v_codes := v_codes || v_code;
    insert into public.factory_routing_step_params (routing_step_id, code, label, unit, min_value, max_value, sort_order)
    values (v_step.id, v_code, v_label, v_unit, round(v_min, 4), round(v_max, 4), v_order);
  end loop;

  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_STEP_PARAMS_SET', 'factory_routing_steps', v_step.id::text,
          jsonb_build_object('routing_id', v_step.routing_id, 'sequence', v_step.sequence, 'codes', to_jsonb(v_codes),
                             'is_test', v_step.is_test, 'persona_employee_no', v_actor.employee_no));
  return jsonb_build_object('routing_step_id', v_step.id, 'count', cardinality(v_codes));
end;
$$;
revoke all on function public.app_factory_set_step_params(uuid, jsonb) from public, anon;
grant execute on function public.app_factory_set_step_params(uuid, jsonb) to authenticated;

-- 4. ปิดขั้นพร้อมบันทึกค่า (หลุดสเปก → กักกันใบงาน) -----------------------------------------------
create or replace function public.app_factory_complete_job_step_with_readings(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_readings jsonb, p_output_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_param record;
  v_raw jsonb;
  v_value numeric;
  v_ok boolean;
  v_count integer := 0;
  v_out text[] := '{}';
  v_reason text;
  v_result jsonb;
begin
  perform private.lab_only_block();
  -- ปิดขั้นด้วยเนื้อหาเดิมก่อน (ตรวจโหมด แผนก ลำดับ version Hold และทำงานกับคลัง) ค่าที่ผิดด้านล่างยกเลิกทั้งธุรกรรม
  v_result := private.factory_run_job_step(p_id, p_version, p_sequence, p_note, p_output_qty, false, true);
  v_actor := private.factory_actor();
  select * into v_job from public.factory_jobs where id = p_id;

  if p_readings is null or jsonb_typeof(p_readings) <> 'object' then raise exception 'INVALID_JOB_READINGS'; end if;
  for v_param in
    select x.code, x.label, x.unit, x.min_value, x.max_value
    from public.factory_routing_step_params x
    join public.factory_routing_steps s on s.id = x.routing_step_id
    where s.routing_id = v_job.routing_id and s.sequence = p_sequence
    order by x.sort_order
  loop
    v_raw := p_readings -> v_param.code;
    if v_raw is null or jsonb_typeof(v_raw) <> 'number' then raise exception 'INVALID_JOB_READINGS'; end if;
    v_value := round((v_raw #>> '{}')::numeric, 4);
    if abs(v_value) > 1000000000 then raise exception 'INVALID_JOB_READINGS'; end if;
    v_ok := (v_param.min_value is null or v_value >= v_param.min_value) and (v_param.max_value is null or v_value <= v_param.max_value);
    insert into public.factory_job_step_readings
      (job_id, step_sequence, code, label, unit, value, min_value, max_value, in_spec, recorded_by)
    values (v_job.id, p_sequence, v_param.code, v_param.label, v_param.unit, v_value, v_param.min_value, v_param.max_value, v_ok, v_actor.id);
    v_count := v_count + 1;
    if not v_ok then
      v_out := v_out || (v_param.label || ' ' || trim_scale(v_value)::text || coalesce(' ' || nullif(v_param.unit, ''), '')
        || ' (สเปก ' || coalesce(trim_scale(v_param.min_value)::text, '—') || '–' || coalesce(trim_scale(v_param.max_value)::text, '—') || ')');
    end if;
  end loop;
  if v_count = 0 then raise exception 'JOB_STEP_NO_PARAMS'; end if;
  if (select count(*) from jsonb_object_keys(p_readings)) <> v_count then raise exception 'INVALID_JOB_READINGS'; end if;

  if cardinality(v_out) = 0 then
    return v_result || jsonb_build_object('held', false);
  end if;

  v_reason := left('ค่าหลุดสเปกที่ขั้น ' || (p_sequence / 10)::text || ': ' || array_to_string(v_out, ', '), 1000);
  update public.factory_jobs
  set on_hold = true, hold_reason = v_reason, held_at = now(), hold_ncr_id = null, hold_ncr_no = null,
      version = version + 1, updated_by = v_actor.id, updated_at = now()
  where id = v_job.id;
  return private.factory_job_log(v_job.id, 'hold', p_sequence, v_reason, v_actor) || jsonb_build_object('held', true, 'hold_reason', v_reason);
end;
$$;
revoke all on function public.app_factory_complete_job_step_with_readings(uuid, integer, integer, text, jsonb, numeric) from public, anon;
grant execute on function public.app_factory_complete_job_step_with_readings(uuid, integer, integer, text, jsonb, numeric) to authenticated;

-- 5. QA ตัดสินใบงานที่ถูกกักกัน (ปลด หรือ ออก NCR) -----------------------------------------------
create or replace function public.app_factory_decide_job_hold(
  p_id uuid, p_version integer, p_decision text, p_note text, p_qty_defect numeric default null, p_defect_type_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_item public.factory_items%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
  v_defect_code text := nullif(btrim(coalesce(p_defect_type_code, '')), '');
  v_base numeric;
  v_defect numeric;
  v_ncr jsonb;
  v_ncr_id uuid;
  v_ncr_no text;
begin
  perform private.lab_only_block();
  v_actor := private.factory_actor();
  if p_decision is null or p_decision not in ('release', 'ncr') then raise exception 'INVALID_JOB_HOLD_DECISION'; end if;
  if char_length(v_note) not between 10 and 1000 then raise exception 'JOB_HOLD_NOTE_REQUIRED'; end if;
  v_job := private.factory_job_lock(p_id, p_version);
  if not v_job.on_hold or v_job.status = 'cancelled' then raise exception 'JOB_NOT_HELD'; end if;
  if not exists (select 1 from public.departments d where d.id = v_actor.department_id and d.code = 'QA') then
    raise exception 'JOB_HOLD_QA_ONLY';
  end if;

  if p_decision = 'release' then
    if p_qty_defect is not null or v_defect_code is not null then raise exception 'INVALID_JOB_HOLD_DECISION'; end if;
    update public.factory_jobs
    set on_hold = false, version = v_job.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_job.id;
    return private.factory_job_log(v_job.id, 'release', null, v_note, v_actor);
  end if;

  -- ออก NCR: ใบงานยังถูกกักกันรอปลดหรือให้ฝ่ายวางแผนยกเลิก
  v_base := coalesce(v_job.output_qty, v_job.qty);
  if p_qty_defect is null or p_qty_defect = 'NaN'::numeric then raise exception 'JOB_HOLD_DEFECT_INVALID'; end if;
  v_defect := round(p_qty_defect, 4);
  if v_defect <= 0 or v_defect > v_base then raise exception 'JOB_HOLD_DEFECT_INVALID'; end if;
  if v_defect_code is null or not exists (select 1 from public.ncr_defect_types where code = v_defect_code and is_active) then
    raise exception 'JOB_HOLD_DEFECT_INVALID';
  end if;

  select * into v_item from public.factory_items where id = v_job.item_id;
  v_ncr := public.app_ncr_issue(
    v_item.name, v_base, v_defect, private.factory_ncr_unit(v_item.unit_code), 'in_process', v_defect_code,
    'ใบงาน ' || v_job.code || ' ถูกกักกัน: ' || v_job.hold_reason || ' — ' || v_note,
    v_item.code, null, null, null, v_job.code, null, null);
  v_ncr_id := (v_ncr ->> 'id')::uuid;
  v_ncr_no := v_ncr ->> 'ncr_no';

  update public.factory_jobs
  set hold_ncr_id = v_ncr_id, hold_ncr_no = v_ncr_no, version = v_job.version + 1, updated_by = v_actor.id, updated_at = now()
  where id = v_job.id;
  return private.factory_job_log(v_job.id, 'hold_ncr', null, left('ออก NCR ' || v_ncr_no || ': ' || v_note, 1000), v_actor)
         || jsonb_build_object('ncr_id', v_ncr_id, 'ncr_no', v_ncr_no);
end;
$$;
revoke all on function public.app_factory_decide_job_hold(uuid, integer, text, text, numeric, text) from public, anon;
grant execute on function public.app_factory_decide_job_hold(uuid, integer, text, text, numeric, text) to authenticated;

-- 6. อ่านข้อมูล + ล้างข้อมูลทดสอบ ------------------------------------------------------------
-- ข้อมูลทั้งหมดของโมดูล: นิยามล่าสุดของ 20261008030000 เพิ่มพารามิเตอร์ของขั้นใน Routing สถานะกักกันของใบงาน และค่าที่บันทึก
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
  perform private.lab_only_block();
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
          'lot_tracking', i.lot_tracking, 'min_stock', i.min_stock, 'specification', i.specification, 'part_code', i.part_code,
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
          'work_center', w.name, 'work_center_code', w.code, 'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes,
          'instruction', s.instruction,
          'params', coalesce((
            select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'unit', x.unit,
                                                'min', x.min_value, 'max', x.max_value) order by x.sort_order)
            from public.factory_routing_step_params x where x.routing_step_id = s.id), '[]'::jsonb)
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
          'cancel_note', p.cancel_note, 'cancelled_at', p.cancelled_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.created_by),
          'submitted_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.submitted_by),
          'received_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.received_by),
          'planned_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.planned_by),
          'released_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.released_by),
          'cancelled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = p.cancelled_by)
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
    -- ใบงานผลิตพร้อมขั้นตอน (ขั้น 4–8) สถานะกักกัน และพารามิเตอร์ที่ต้องบันทึกของแต่ละขั้น (ตาม Routing ของใบงาน)
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', j.id, 'code', j.code, 'status', j.status, 'version', j.version,
          'production_order_id', j.production_order_id, 'production_code', p.code,
          'order_item_code', oi.code, 'item_id', j.item_id, 'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code,
          'qty', j.qty, 'output_qty', j.output_qty, 'bom_id', j.bom_id, 'bom_revision', b.revision,
          'routing_id', j.routing_id, 'routing_revision', r.revision, 'warehouse_code', w.code, 'warehouse_name', w.name,
          'note', j.note, 'cancel_note', j.cancel_note,
          'on_hold', j.on_hold, 'hold_reason', j.hold_reason, 'held_at', j.held_at,
          'hold_ncr_id', j.hold_ncr_id, 'hold_ncr_no', j.hold_ncr_no,
          'created_at', j.created_at, 'started_at', j.started_at, 'completed_at', j.completed_at, 'cancelled_at', j.cancelled_at,
          'created_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = j.created_by),
          'cancelled_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = j.cancelled_by),
          -- วัตถุดิบที่คืนเข้าคลังตอนยกเลิกใบงานที่เริ่มแล้ว (รวมต่อ Item)
          'returned', coalesce((
            select jsonb_agg(jsonb_build_object('code', ri.code, 'name', ri.name, 'unit_code', ri.unit_code, 'quantity', t.qty) order by ri.code)
            from (select m.item_id, sum(m.quantity) as qty from public.factory_inventory_movements m
                  where m.is_test = v_test and m.kind = 'production_return'
                    and m.reference = private.factory_job_return_reference(j.code)
                  group by m.item_id) t
            join public.factory_items ri on ri.id = t.item_id), '[]'::jsonb),
          'steps', coalesce((
            select jsonb_agg(jsonb_build_object(
                'sequence', s.sequence, 'name', s.name, 'work_center_code', s.work_center_code,
                'department_code', private.factory_center_department(s.work_center_code),
                'instruction', s.instruction, 'setup_minutes', s.setup_minutes, 'run_minutes', s.run_minutes,
                'status', s.status, 'note', s.note, 'completed_at', s.completed_at,
                'completed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = s.completed_by),
                'params', coalesce((
                  select jsonb_agg(jsonb_build_object('code', x.code, 'label', x.label, 'unit', x.unit,
                                                      'min', x.min_value, 'max', x.max_value) order by x.sort_order)
                  from public.factory_routing_step_params x
                  join public.factory_routing_steps rs on rs.id = x.routing_step_id
                  where rs.routing_id = j.routing_id and rs.sequence = s.sequence), '[]'::jsonb)
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
    -- ผลตรวจ QC ของขั้น QC ในใบงาน (ผ่าน/ไม่ผ่าน พร้อมเลขที่ NCR ที่ออกให้) และประเภทข้อบกพร่องของ NCR ที่ใช้เลือกในฟอร์ม
    'job_inspections', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', x.id, 'job_id', x.job_id, 'step_sequence', x.step_sequence, 'result', x.result,
          'qty_checked', x.qty_checked, 'qty_defect', x.qty_defect, 'measurement', x.measurement,
          'defect_type_code', x.defect_type_code, 'defect_type_name', dt.name_th, 'description', x.description,
          'ncr_id', x.ncr_id, 'ncr_no', x.ncr_no, 'inspected_at', x.inspected_at,
          'inspected_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.inspected_by)
        ) order by x.inspected_at desc, x.id desc)
      from public.factory_job_inspections x
      left join public.ncr_defect_types dt on dt.code = x.defect_type_code
      where x.is_test = v_test), '[]'::jsonb),
    -- ค่าพารามิเตอร์ที่บันทึกตอนปิดขั้น พร้อมสเปก ณ เวลาที่บันทึก
    'job_readings', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', x.id, 'job_id', x.job_id, 'step_sequence', x.step_sequence, 'code', x.code, 'label', x.label,
          'unit', x.unit, 'value', x.value, 'min', x.min_value, 'max', x.max_value, 'in_spec', x.in_spec,
          'recorded_at', x.recorded_at,
          'recorded_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.recorded_by)
        ) order by x.job_id, x.step_sequence, x.recorded_at, x.code)
      from public.factory_job_step_readings x
      where x.is_test = v_test), '[]'::jsonb),
    'ncr_defect_types', coalesce((
      select jsonb_agg(jsonb_build_object('code', d.code, 'name_th', d.name_th) order by d.sort_order, d.code)
      from public.ncr_defect_types d where d.is_active), '[]'::jsonb),
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

-- นับข้อมูลทดสอบ: นิยามของ 20261014030000 เพิ่มสองตารางใหม่ใน details
create or replace function private.factory_test_data_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'items', (select count(*) from public.factory_items where is_test),
    'boms', (select count(*) from public.factory_boms where is_test),
    'routings', (select count(*) from public.factory_routings where is_test),
    'production_orders', (select count(*) from public.factory_production_orders where is_test),
    'material_orders', (select count(*) from public.factory_material_orders where is_test),
    'jobs', (select count(*) from public.factory_jobs where is_test),
    'inventory_movements', (select count(*) from public.factory_inventory_movements where is_test),
    'lots', (select count(*) from public.factory_lots where is_test),
    'attachments', (select count(*) from public.factory_attachments where is_test),
    'work_centers', (select count(*) from public.factory_work_centers where is_test),
    'warehouses', (select count(*) from public.factory_warehouses where is_test),
    -- รายการย่อยและประวัติที่ถูกลบตามเอกสารแม่
    'details', (select count(*) from public.factory_job_inspections where is_test)
             + (select count(*) from public.factory_job_step_readings where is_test)
             + (select count(*) from public.factory_job_history where is_test)
             + (select count(*) from public.factory_job_steps where is_test)
             + (select count(*) from public.factory_material_order_history where is_test)
             + (select count(*) from public.factory_material_order_lines where is_test)
             + (select count(*) from public.factory_production_order_history where is_test)
             + (select count(*) from public.factory_routing_step_params where is_test)
             + (select count(*) from public.factory_routing_steps where is_test)
             + (select count(*) from public.factory_bom_history where is_test)
             + (select count(*) from public.factory_bom_lines where is_test)
             + (select count(*) from public.factory_item_unit_conversions where is_test)
             + (select count(*) from public.factory_item_history where is_test)
  )
$$;
revoke all on function private.factory_test_data_counts() from public, anon, authenticated;

-- ล้างข้อมูลทดสอบ: นิยามของ 20261014030000 เพิ่มการลบสองตารางใหม่ (ลูกก่อนแม่)
create or replace function public.app_sandbox_purge_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_items integer;
  v_counts jsonb;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  if (private.sandbox_persona()).id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ไฟล์แนบ: ลบไฟล์ผ่าน Storage API ก่อน (app_factory_attachment_paths) มิฉะนั้นไฟล์จริงจะค้างโดยไม่มีแถวชี้
  if exists (
    select 1 from public.factory_attachments a
    join storage.objects o on o.bucket_id = 'factory-attachments' and o.name = a.storage_path
    where a.is_test
  ) then
    raise exception 'FACTORY_FILES_REMAIN';
  end if;

  -- รายการที่จะลบ นับในธุรกรรมเดียวกับการลบ (ชุดเดียวกับที่หน้า "ข้อมูลทดสอบ" แสดงก่อนยืนยัน)
  v_counts := private.factory_test_data_counts();

  delete from public.factory_attachments where is_test;

  -- ใบงานผลิตและใบสั่งวัตถุดิบอ้างใบสั่งผลิต/BOM/Routing/คลัง ต้องลบก่อน (ลูกก่อนแม่)
  delete from public.factory_job_inspections where is_test;
  delete from public.factory_job_step_readings where is_test;
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
  delete from public.factory_routing_step_params where is_test;
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
          jsonb_build_object('deleted_items', v_items, 'counts', v_counts));
  return jsonb_build_object('deleted', v_items, 'counts', v_counts);
end;
$$;
revoke all on function public.app_sandbox_purge_factory() from public, anon;
grant execute on function public.app_sandbox_purge_factory() to authenticated;
