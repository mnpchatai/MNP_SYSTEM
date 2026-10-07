-- ============================================================================
-- ฝ่ายโรงงาน: ผลตรวจ QC ของขั้นตรวจขนาดในใบงาน และเชื่อม NCR (โหมดทดสอบเท่านั้น)
--
-- ต่อจากใบงานผลิต (20261007050000) ที่ขั้น QC (ศูนย์งาน QC = แผนก QA เช่น ตรวจขนาดยางเส้นยาว) กด "เสร็จ" ได้เลยโดยไม่มีบันทึกผลตรวจ
-- migration นี้ทำให้ขั้น QC ต้องบันทึกผลตรวจ ผ่าน/ไม่ผ่าน และถ้าไม่ผ่านออก NCR (ระบบ NCR เดิม) ให้ในธุรกรรมเดียวกัน
--
-- กติกา
--   * ขั้นที่ศูนย์งานเป็น QC ปิดได้ทาง app_factory_record_qc เท่านั้น app_factory_complete_job_step ปฏิเสธด้วย JOB_QC_INSPECTION_REQUIRED
--     (ตัวเนื้อหาของฟังก์ชันเดิมย้ายไป private.factory_run_job_step ไม่เปลี่ยนแม้แต่บรรทัดเดียว เพิ่มเฉพาะด่านนี้)
--   * ผ่าน (pass): บันทึกผลตรวจ (จำนวนที่ตรวจ + บันทึกผลวัด) แล้วปิดขั้นด้วยเนื้อหาเดิม (ตัดวัตถุดิบ/รับผลผลิตตามเดิมถ้าเป็นขั้นแรก/ขั้นสุดท้าย)
--     ขั้นสุดท้ายระบุจำนวนผลิตจริงได้ (p_output_qty) เหมือนเดิม
--   * ไม่ผ่าน (fail): ต้องระบุจำนวนที่ไม่ผ่าน (1 ถึงจำนวนที่ตรวจ) ประเภทข้อบกพร่องของ NCR และคำอธิบายอย่างน้อย 10 ตัวอักษร ระบบออก NCR
--     ด้วย public.app_ncr_issue (แหล่งที่พบ in_process, lot = เลขที่ใบงาน, ผู้ออกใบ = persona ผู้ตรวจ) ในธุรกรรมเดียวกัน ใบ NCR เดินตามขั้นตอน NCR เดิม
--     ใบงานคงสถานะเดิมและขั้น QC ยังรอทำ (ไม่ปิดขั้น ไม่ตัด/รับสต๊อกเพิ่ม) ผู้ตรวจบันทึกตรวจซ้ำได้ (ผ่านหรือออก NCR ใบใหม่) หรือฝ่ายวางแผน
--     ยกเลิกใบงานตามกติกาเดิม (คืนวัตถุดิบ) ระบบไม่ผูกการปิดขั้นกับผลปิด NCR (NCR ตามเรื่องของมันเอง)
--   * ผู้ทำ: แผนกที่ตรงกับขั้น (QC = QA) และต้องเป็นขั้นถัดไปตามลำดับ เหมือน app_factory_complete_job_step ทุกประการ
--   * ทุกครั้งที่บันทึกผล เขียน factory_job_inspections + factory_job_history (ไม่ผ่าน = action qc_fail, เพิ่ม version ของใบงาน)
--     + audit_logs (ผู้กระทำคือ admin ตัวจริงเบื้องหลัง persona) ใบ NCR ที่ออกเป็นข้อมูลทดสอบ (is_test) เลขที่ TEST-QA… ตามกติกาโหมดทดสอบเดิม
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_job_inspections ใช้แบบเดียวกับ factory_* ทุกตาราง (is_test จาก trigger, foreign key คู่ (id, is_test),
-- RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables()) ผูกใบ NCR ด้วย ncr_id (on delete set null เพราะล้างข้อมูล NCR
-- ทดสอบแยกจากล้างข้อมูลฝ่ายโรงงาน) พร้อมเก็บ ncr_no ไว้แสดง
--
-- เริ่มจากนิยามล่าสุดของ app_factory_complete_job_step / app_sandbox_purge_factory (20261007050000) และ app_factory_master_data (20261007060000)
--
-- ก่อนเปิดกับข้อมูลจริงต้องกำหนดบทบาทจริงของผู้ตรวจและผู้รับ NCR และช่องทางแจ้งเตือน (โหมดทดสอบไม่ส่งอีเมล/LINE กติกาข้อ 4)
--
-- Rollback (ข้อมูลทดสอบอย่างเดียว): drop function public.app_factory_record_qc(uuid, integer, integer, text, numeric, numeric, text, text, text, numeric);
--   drop function private.factory_ncr_unit(text); drop table public.factory_job_inspections;
--   คืน check ของ factory_job_history.action เป็นชุดเดิม (ลบแถว action = 'qc_fail' ก่อน);
--   แล้ว create or replace app_factory_complete_job_step ด้วยนิยามเดิมของ 20261007050000 (เนื้อหาเดียวกับ private.factory_run_job_step ตัดด่าน QC ออก)
--   drop function private.factory_run_job_step(...); และ create or replace app_factory_master_data / app_sandbox_purge_factory /
--   private.sandbox_unguarded_tables ด้วยนิยามเดิมของ 20261007060000 / 20261007050000
-- ============================================================================

-- 1. ตารางผลตรวจ QC -----------------------------------------------------------------------
create table public.factory_job_inspections (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  job_id uuid not null,
  step_sequence integer not null check (step_sequence > 0),
  result text not null check (result in ('pass', 'fail')),
  qty_checked numeric(18, 4) not null check (qty_checked > 0),
  qty_defect numeric(18, 4) not null default 0 check (qty_defect >= 0),
  measurement text not null default '' check (char_length(measurement) <= 1000),
  defect_type_code text check (defect_type_code is null or defect_type_code ~ '^[A-Z]{2,10}$'),
  description text not null default '' check (char_length(description) <= 5000),
  ncr_id uuid references public.ncr_reports(id) on delete set null,
  ncr_no text,
  inspected_by uuid references public.employees(id) on delete set null,
  inspected_at timestamptz not null default clock_timestamp(),
  foreign key (job_id, is_test) references public.factory_jobs(id, is_test),
  check (qty_defect <= qty_checked),
  check ((result = 'pass' and qty_defect = 0 and ncr_no is null and defect_type_code is null)
      or (result = 'fail' and qty_defect > 0 and ncr_no is not null and defect_type_code is not null))
);
create index factory_job_inspections_job_idx on public.factory_job_inspections(job_id, step_sequence, inspected_at desc);
comment on table public.factory_job_inspections is 'ผลตรวจ QC ของขั้น QC ในใบงาน: ผ่าน = ปิดขั้น · ไม่ผ่าน = ออก NCR และขั้นยังรอตรวจซ้ำ';

create trigger factory_job_inspections_sandbox_scope before insert or update or delete on public.factory_job_inspections
  for each row execute function private.factory_sandbox_scope();
revoke all on public.factory_job_inspections from anon, authenticated;
alter table public.factory_job_inspections enable row level security;
create policy factory_job_inspections_no_direct_access on public.factory_job_inspections
  for all to authenticated using (false) with check (false);

-- ประวัติของใบงานเพิ่มการกระทำ qc_fail (ตรวจไม่ผ่าน ออก NCR) ผ่านใช้การกระทำ step/complete ตามเดิม
alter table public.factory_job_history drop constraint if exists factory_job_history_action_check;
alter table public.factory_job_history
  add constraint factory_job_history_action_check
  check (action in ('create', 'step', 'complete', 'cancel', 'qc_fail'));

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261007050000 ทุกชื่อ แล้วเพิ่ม factory_job_inspections)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history','factory_bom_history',
    'factory_production_order_history',
    'factory_material_orders','factory_material_order_lines','factory_material_order_history',
    'factory_jobs','factory_job_steps','factory_job_history','factory_job_inspections']
$$;

-- 2. ขั้นทำงานของใบงาน: ฟังก์ชันเดิมย้ายเป็น private.factory_run_job_step (เนื้อหาเดิมทุกบรรทัด เพิ่มเฉพาะด่าน QC) --------
create or replace function private.factory_run_job_step(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_output_qty numeric, p_via_qc boolean)
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
  -- ขั้นตรวจขนาด (ศูนย์งาน QC) ปิดได้ทางบันทึกผลตรวจ QC เท่านั้น (app_factory_record_qc ผ่านเงื่อนไขนี้ด้วย p_via_qc)
  if v_step.work_center_code = 'QC' and not p_via_qc then raise exception 'JOB_QC_INSPECTION_REQUIRED'; end if;

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
revoke all on function private.factory_run_job_step(uuid, integer, integer, text, numeric, boolean) from public, anon, authenticated;

create or replace function public.app_factory_complete_job_step(
  p_id uuid, p_version integer, p_sequence integer, p_note text, p_output_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return private.factory_run_job_step(p_id, p_version, p_sequence, p_note, p_output_qty, false);
end;
$$;

-- 3. บันทึกผลตรวจ QC (ผ่าน → ปิดขั้น · ไม่ผ่าน → ออก NCR) -----------------------------------------
-- หน่วยของ Item โรงงาน → หน่วยที่ NCR รับ (แผ่น/อื่นๆ ที่ NCR ไม่มีใช้ "ชิ้น"/"รายการ")
create or replace function private.factory_ncr_unit(p_unit_code text)
returns text
language sql
immutable
set search_path = ''
as $$ select case upper(coalesce(p_unit_code, '')) when 'KG' then 'กก.' when 'SET' then 'ชุด' when 'PCS' then 'ชิ้น' when 'SHEET' then 'ชิ้น' else 'รายการ' end $$;
revoke all on function private.factory_ncr_unit(text) from public, anon, authenticated;

create or replace function public.app_factory_record_qc(
  p_id uuid, p_version integer, p_sequence integer, p_result text,
  p_qty_checked numeric, p_qty_defect numeric, p_measurement text,
  p_defect_type_code text, p_description text, p_output_qty numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_job public.factory_jobs%rowtype;
  v_step public.factory_job_steps%rowtype;
  v_item public.factory_items%rowtype;
  v_checked numeric;
  v_defect numeric;
  v_measure text := btrim(coalesce(p_measurement, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_defect_code text := nullif(btrim(coalesce(p_defect_type_code, '')), '');
  v_ncr jsonb;
  v_ncr_id uuid;
  v_ncr_no text;
  v_result jsonb;
begin
  v_actor := private.factory_actor();
  if p_result is null or p_result not in ('pass', 'fail') then raise exception 'INVALID_JOB_QC_RESULT'; end if;
  if p_qty_checked is null or p_qty_checked = 'NaN'::numeric then raise exception 'INVALID_JOB_QC_QTY'; end if;
  v_checked := round(p_qty_checked, 4);
  if v_checked <= 0 or v_checked > 1000000000 then raise exception 'INVALID_JOB_QC_QTY'; end if;
  if p_qty_defect is not null and p_qty_defect = 'NaN'::numeric then raise exception 'INVALID_JOB_QC_QTY'; end if;
  v_defect := coalesce(round(p_qty_defect, 4), 0);
  if p_result = 'pass' and v_defect <> 0 then raise exception 'INVALID_JOB_QC_QTY'; end if;
  if p_result = 'fail' and (v_defect <= 0 or v_defect > v_checked) then raise exception 'INVALID_JOB_QC_QTY'; end if;
  if char_length(v_measure) > 1000 then raise exception 'INVALID_JOB_QC_NOTE'; end if;

  v_job := private.factory_job_lock(p_id, p_version);
  if v_job.status not in ('open', 'in_progress') then raise exception 'JOB_NOT_ACTIVE'; end if;
  select * into v_step from public.factory_job_steps where job_id = v_job.id and sequence = p_sequence for update;
  if v_step.id is null then raise exception 'JOB_STEP_NOT_FOUND'; end if;
  if v_step.status = 'done' then raise exception 'JOB_STEP_ALREADY_DONE'; end if;
  if v_step.work_center_code <> 'QC' then raise exception 'JOB_STEP_NOT_QC'; end if;
  if not exists (select 1 from public.departments d
                 where d.id = v_actor.department_id and d.code = private.factory_center_department(v_step.work_center_code)) then
    raise exception 'JOB_STEP_DEPARTMENT_ONLY';
  end if;
  if exists (select 1 from public.factory_job_steps where job_id = v_job.id and sequence < v_step.sequence and status <> 'done') then
    raise exception 'JOB_STEP_OUT_OF_ORDER';
  end if;

  if p_result = 'pass' then
    -- ผ่าน: ปิดขั้นด้วยเนื้อหาเดิม (ตรวจจำนวนผลิตจริงของขั้นสุดท้ายในนั้น) แล้วบันทึกผลตรวจ
    v_result := private.factory_run_job_step(p_id, p_version, p_sequence, v_measure, p_output_qty, true);
    insert into public.factory_job_inspections (job_id, step_sequence, result, qty_checked, qty_defect, measurement, inspected_by)
    values (v_job.id, v_step.sequence, 'pass', v_checked, 0, v_measure, v_actor.id);
    return v_result;
  end if;

  -- ไม่ผ่าน: ต้องมีประเภทข้อบกพร่องและคำอธิบาย แล้วออก NCR ด้วยระบบ NCR เดิม
  if p_output_qty is not null then raise exception 'INVALID_JOB_OUTPUT_QTY'; end if;
  if v_defect_code is null or not exists (select 1 from public.ncr_defect_types where code = v_defect_code and is_active) then
    raise exception 'JOB_QC_DEFECT_TYPE_INVALID';
  end if;
  if char_length(v_desc) not between 10 and 4000 then raise exception 'JOB_QC_DESCRIPTION_REQUIRED'; end if;

  select * into v_item from public.factory_items where id = v_job.item_id;
  v_ncr := public.app_ncr_issue(
    v_item.name, v_checked, v_defect, private.factory_ncr_unit(v_item.unit_code), 'in_process', v_defect_code,
    'ตรวจ QC ใบงาน ' || v_job.code || ' ขั้น ' || v_step.name || ' ไม่ผ่าน: ' || v_desc,
    v_item.code, null, null, null, v_job.code, null, null);
  v_ncr_id := (v_ncr ->> 'id')::uuid;
  v_ncr_no := v_ncr ->> 'ncr_no';

  insert into public.factory_job_inspections
    (job_id, step_sequence, result, qty_checked, qty_defect, measurement, defect_type_code, description, ncr_id, ncr_no, inspected_by)
  values (v_job.id, v_step.sequence, 'fail', v_checked, v_defect, v_measure, v_defect_code, v_desc, v_ncr_id, v_ncr_no, v_actor.id);

  -- ใบงานยังอยู่ที่ขั้น QC (รอตรวจซ้ำ) เพิ่ม version ให้หน้าต่างที่เปิดค้างรู้ว่ามีผลตรวจใหม่
  update public.factory_jobs set version = v_job.version + 1, updated_by = v_actor.id, updated_at = now() where id = v_job.id;
  v_result := private.factory_job_log(v_job.id, 'qc_fail', v_step.sequence, v_desc, v_actor);
  return v_result || jsonb_build_object('ncr_id', v_ncr_id, 'ncr_no', v_ncr_no);
end;
$$;

revoke all on function public.app_factory_record_qc(uuid, integer, integer, text, numeric, numeric, text, text, text, numeric) from public, anon;
grant execute on function public.app_factory_record_qc(uuid, integer, integer, text, numeric, numeric, text, text, text, numeric) to authenticated;

-- 4. อ่านข้อมูล + ล้างข้อมูลทดสอบ ------------------------------------------------------------
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
  delete from public.factory_job_inspections where is_test;
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
