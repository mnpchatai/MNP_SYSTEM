-- ============================================================================
-- ใบตรวจ QC (QA01-PM11): Part Number ไม่บังคับ (ชิ้นงานเดี่ยวบางแบบไม่มีเลข Part ฟอร์มกระดาษใส่ "-")
--
-- ที่มา: ผู้ใช้ระบุว่า Part Number ต้องไม่บังคับ ส่วน Part Name ยังบังคับ แม่แบบยังเป็นตัวกำหนดรายการตรวจ
--   ชิ้นงานเดี่ยวใช้แม่แบบที่มีแต่ Part Name
--
-- สิ่งที่เปลี่ยน
--   1) qc_inspection_templates / qc_inspection_reports: part_number ว่างได้ (เก็บเป็น '' ไม่ใช่ null เหมือนฟิลด์ข้อความอื่นของโมดูล)
--      check ความยาวเปลี่ยนจาก 1-60 เป็นไม่เกิน 60
--   2) กุญแจแม่แบบ: เดิม unique (is_test, part_number) ตอนนี้เป็น unique index บางส่วนเฉพาะ part_number <> ''
--      แม่แบบที่ไม่มีเลข Part มีได้หลายแบบ (แยกกันด้วย Part Name) ส่วนเลข Part ที่มีค่ายังซ้ำกันไม่ได้
--      ตัวตรวจ QC_PART_NUMBER_TAKEN ใน app_qc_save_template ตรวจเฉพาะเมื่อมีเลข Part
--   3) app_qc_save_template / app_qc_save_report รับ part_number ว่าง (ยังไม่เกิน 60 ตัวอักษร)
--   4) app_qc_issue_ncr ส่ง product_code เป็น null เมื่อใบไม่มีเลข Part (app_ncr_issue รับ null อยู่แล้ว)
--   5) app_qc_templates เรียงแม่แบบที่มีเลข Part ก่อน แล้วแม่แบบที่ไม่มีเลข Part เรียงตาม Part Name
--   6) app_qc_reports: ตัวกรอง part_number ค้นใน Part Name ด้วย (ใบของชิ้นงานที่ไม่มีเลข Part ค้นจากชื่อได้)
--
-- ฟังก์ชันที่แทนที่ทั้งหมดเริ่มจากนิยามล่าสุดใน 20261027010000_qc_inspection_reports.sql และเปลี่ยนเฉพาะข้อ 3-6 ข้างต้น
-- (ยังขึ้นต้นด้วย private.lab_only_block() ยังเป็น security definer, search_path = '' เหมือนเดิม) สิทธิ์ระบุซ้ำท้ายไฟล์
--
-- การปรับใช้: ไคลเอนต์ Pilot Web ที่ส่ง part_number ว่างต้องการ migration นี้ ต้อง apply บน production (ผู้ใช้อนุมัติ) ก่อน merge
--   ไคลเอนต์เก่าที่ส่ง part_number เสมอยังใช้ได้กับฐานข้อมูลใหม่
--
-- Rollback / กู้คืน (ทำได้ต่อเมื่อไม่มีแถวที่ part_number = '' ในสองตาราง ไม่เช่นนั้นต้องแก้หรือลบแถวเหล่านั้นก่อน):
--   drop index public.qc_inspection_templates_part_number_uidx;
--   alter table public.qc_inspection_templates drop constraint qc_inspection_templates_part_number_check;
--   alter table public.qc_inspection_templates add check (char_length(part_number) between 1 and 60);
--   alter table public.qc_inspection_templates add unique (is_test, part_number);
--   alter table public.qc_inspection_reports drop constraint qc_inspection_reports_part_number_check;
--   alter table public.qc_inspection_reports add check (char_length(part_number) between 1 and 60);
--   แล้ว create or replace app_qc_templates, app_qc_save_template, app_qc_save_report, app_qc_issue_ncr
--   ด้วยนิยามเดิมจาก 20261027010000_qc_inspection_reports.sql (และระบุสิทธิ์ซ้ำ)
-- ============================================================================

-- 1. ตาราง: part_number ว่างได้ ---------------------------------------------------------------
alter table public.qc_inspection_templates drop constraint qc_inspection_templates_part_number_check;
alter table public.qc_inspection_templates add check (char_length(part_number) <= 60);
alter table public.qc_inspection_templates drop constraint qc_inspection_templates_is_test_part_number_key;
create unique index qc_inspection_templates_part_number_uidx
  on public.qc_inspection_templates (is_test, part_number) where part_number <> '';
alter table public.qc_inspection_reports drop constraint qc_inspection_reports_part_number_check;
alter table public.qc_inspection_reports add check (char_length(part_number) <= 60);
comment on column public.qc_inspection_templates.part_number is
  'เลข Part (ว่างได้ = ชิ้นงานเดี่ยวที่ไม่มีเลข Part) ไม่ซ้ำภายในโหมดเดียวกันเฉพาะเมื่อมีค่า';

-- 2. RPC (เริ่มจากนิยามใน 20261027010000 เปลี่ยนเฉพาะที่ระบุในหัวไฟล์) ------------------------------

create or replace function public.app_qc_templates()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  return coalesce((
    select jsonb_agg(private.qc_template_json(t.id) order by (t.part_number = ''), t.part_number, t.part_name)
    from public.qc_inspection_templates t
    where t.is_test), '[]'::jsonb);
end;
$$;

-- สร้าง/แก้แม่แบบ: มี id ต้องส่ง version ตรง ไม่งั้นสร้างใหม่ รายการแทนที่ทั้งชุด
create or replace function public.app_qc_save_template(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_id uuid;
  v_version integer;
  v_part_number text;
  v_part_name text;
  v_customer text;
  v_drawing_note text;
  v_status text;
  v_node jsonb;
  v_item jsonb;
  v_ord bigint;
  v_item_no text;
  v_seen text[] := '{}';
  v_min numeric;
  v_max numeric;
  v_required numeric;
  v_tpl public.qc_inspection_templates%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;

  begin
    v_id := nullif(p_payload ->> 'id', '')::uuid;
    v_version := nullif(p_payload ->> 'version', '')::integer;
  exception
    when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'QC_INVALID_PAYLOAD';
  end;
  v_part_number := private.qc_text(p_payload, 'part_number', 60, 0, 'QC_INVALID_PAYLOAD');
  v_part_name := private.qc_text(p_payload, 'part_name', 200, 1, 'QC_INVALID_PAYLOAD');
  v_customer := private.qc_text(p_payload, 'customer', 100, 0, 'QC_INVALID_PAYLOAD');
  v_drawing_note := private.qc_text(p_payload, 'drawing_note', 500, 0, 'QC_INVALID_PAYLOAD');
  v_status := private.qc_text(p_payload, 'status', 20, 0, 'QC_INVALID_PAYLOAD');
  if v_status = '' then v_status := 'active'; end if;
  if v_status not in ('active', 'inactive') then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_node := p_payload -> 'items';
  if v_node is null or jsonb_typeof(v_node) <> 'array' then raise exception 'QC_INVALID_PAYLOAD'; end if;
  if jsonb_array_length(v_node) not between 1 and 30 then raise exception 'QC_INVALID_ITEM'; end if;

  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  if v_id is null then
    if v_version is not null then raise exception 'QC_INVALID_PAYLOAD'; end if;
    if v_part_number <> ''
       and exists (select 1 from public.qc_inspection_templates where is_test = v_test and part_number = v_part_number) then
      raise exception 'QC_PART_NUMBER_TAKEN';
    end if;
    insert into public.qc_inspection_templates (part_number, part_name, customer, drawing_note, status, created_by, updated_by)
    values (v_part_number, v_part_name, v_customer, v_drawing_note, v_status, v_actor.id, v_actor.id)
    returning * into v_tpl;
  else
    select * into v_tpl from public.qc_inspection_templates where id = v_id and is_test = v_test for update;
    if v_tpl.id is null then raise exception 'QC_NOT_FOUND'; end if;
    if v_version is null or v_version <> v_tpl.version then raise exception 'QC_VERSION_CONFLICT'; end if;
    if v_part_number <> ''
       and exists (select 1 from public.qc_inspection_templates
                   where is_test = v_test and part_number = v_part_number and id <> v_tpl.id) then
      raise exception 'QC_PART_NUMBER_TAKEN';
    end if;
    update public.qc_inspection_templates
    set part_number = v_part_number, part_name = v_part_name, customer = v_customer, drawing_note = v_drawing_note,
        status = v_status, version = v_tpl.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_tpl.id
    returning * into v_tpl;
    delete from public.qc_inspection_template_items where template_id = v_tpl.id;
  end if;

  for v_item, v_ord in select value, ordinality from jsonb_array_elements(v_node) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'QC_INVALID_ITEM'; end if;
    v_item_no := private.qc_text(v_item, 'item_no', 2, 1, 'QC_INVALID_ITEM');
    if v_item_no !~ '^[A-Z]{1,2}$' or v_item_no = any (v_seen) then raise exception 'QC_INVALID_ITEM'; end if;
    v_seen := v_seen || v_item_no;
    v_min := private.qc_num(v_item -> 'spec_min', 'QC_INVALID_ITEM');
    v_max := private.qc_num(v_item -> 'spec_max', 'QC_INVALID_ITEM');
    if v_min is not null and v_max is not null and v_min > v_max then raise exception 'QC_INVALID_ITEM'; end if;
    v_required := coalesce(private.qc_num(v_item -> 'points_required', 'QC_INVALID_ITEM'), 5);
    if v_required <> trunc(v_required) or v_required not between 1 and 5 then raise exception 'QC_INVALID_ITEM'; end if;
    insert into public.qc_inspection_template_items
      (template_id, item_no, sort_order, name, instrument, unit, spec_min, spec_std, spec_max, points_required)
    values (v_tpl.id, v_item_no, v_ord::integer,
            private.qc_text(v_item, 'name', 100, 1, 'QC_INVALID_ITEM'),
            private.qc_text(v_item, 'instrument', 100, 0, 'QC_INVALID_ITEM'),
            private.qc_text(v_item, 'unit', 20, 0, 'QC_INVALID_ITEM'),
            v_min, private.qc_num(v_item -> 'spec_std', 'QC_INVALID_ITEM'), v_max, v_required::integer);
  end loop;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.qc_audit_actor_id(), 'QC_TEMPLATE_SAVE', 'qc_inspection_templates', v_tpl.id::text,
          jsonb_build_object('part_number', v_tpl.part_number, 'version', v_tpl.version, 'is_test', v_tpl.is_test,
                             'persona_employee_no', v_actor.employee_no));
  return private.qc_template_json(v_tpl.id);
end;
$$;

-- สร้าง/แก้ใบสถานะ draft เท่านั้น รายการตรวจแทนที่ทั้งชุด ฐานข้อมูลคำนวณ min/max/avg/judge/result เอง
create or replace function public.app_qc_save_report(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_id uuid;
  v_version integer;
  v_template_id uuid;
  v_inspected_at timestamptz;
  v_part_number text;
  v_part_name text;
  v_customer text;
  v_order_no text;
  v_code text;
  v_sample_label text;
  v_remark text;
  v_lots text[] := '{}';
  v_lot_node jsonb;
  v_lot jsonb;
  v_text text;
  v_node jsonb;
  v_item jsonb;
  v_ord bigint;
  v_seen text[] := '{}';
  v_item_no text;
  v_name text;
  v_instrument text;
  v_unit text;
  v_note text;
  v_min numeric;
  v_std numeric;
  v_max numeric;
  v_points numeric[];
  v_judge text;
  v_override text;
  v_action text;
  v_rep public.qc_inspection_reports%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;

  begin
    v_id := nullif(p_payload ->> 'id', '')::uuid;
    v_version := nullif(p_payload ->> 'version', '')::integer;
    v_template_id := nullif(p_payload ->> 'template_id', '')::uuid;
    v_inspected_at := nullif(p_payload ->> 'inspected_at', '')::timestamptz;
  exception
    when invalid_text_representation or numeric_value_out_of_range
      or invalid_datetime_format or datetime_field_overflow then
      raise exception 'QC_INVALID_PAYLOAD';
  end;
  if v_inspected_at is not null and not isfinite(v_inspected_at) then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_part_number := private.qc_text(p_payload, 'part_number', 60, 0, 'QC_INVALID_PAYLOAD');
  v_part_name := private.qc_text(p_payload, 'part_name', 200, 1, 'QC_INVALID_PAYLOAD');
  v_customer := private.qc_text(p_payload, 'customer', 100, 0, 'QC_INVALID_PAYLOAD');
  v_order_no := private.qc_text(p_payload, 'order_no', 60, 0, 'QC_INVALID_PAYLOAD');
  v_code := private.qc_text(p_payload, 'code', 60, 0, 'QC_INVALID_PAYLOAD');
  v_sample_label := private.qc_text(p_payload, 'sample_label', 30, 0, 'QC_INVALID_PAYLOAD');
  if v_sample_label = '' then v_sample_label := '2M'; end if;
  v_remark := private.qc_text(p_payload, 'remark', 2000, 0, 'QC_INVALID_PAYLOAD');

  -- Lot ยางผสม: ไม่เกิน 10 ค่า แต่ละค่า 1-60 ตัวอักษร ไม่ซ้ำ
  v_lot_node := p_payload -> 'compound_lots';
  if v_lot_node is not null and jsonb_typeof(v_lot_node) <> 'null' then
    if jsonb_typeof(v_lot_node) <> 'array' or jsonb_array_length(v_lot_node) > 10 then
      raise exception 'QC_INVALID_LOT';
    end if;
    for v_lot in select value from jsonb_array_elements(v_lot_node) loop
      if jsonb_typeof(v_lot) <> 'string' then raise exception 'QC_INVALID_LOT'; end if;
      v_text := btrim(v_lot #>> '{}');
      if char_length(v_text) not between 1 and 60 or v_text = any (v_lots) then raise exception 'QC_INVALID_LOT'; end if;
      v_lots := v_lots || v_text;
    end loop;
  end if;

  v_node := p_payload -> 'items';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 30 then
    raise exception 'QC_INVALID_PAYLOAD';
  end if;

  if v_template_id is not null
     and not exists (select 1 from public.qc_inspection_templates where id = v_template_id and is_test = v_test) then
    raise exception 'QC_TEMPLATE_NOT_FOUND';
  end if;

  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  if v_id is null then
    if v_version is not null then raise exception 'QC_INVALID_PAYLOAD'; end if;
    insert into public.qc_inspection_reports
      (report_no, template_id, part_number, part_name, customer, order_no, code, compound_lots, sample_label,
       inspected_by, inspected_at, remark, created_by)
    values (private.next_qc_doc_number(), v_template_id, v_part_number, v_part_name, v_customer, v_order_no, v_code,
            v_lots, v_sample_label, v_actor.id, v_inspected_at, v_remark, v_actor.id)
    returning * into v_rep;
    v_action := 'create';
  else
    select * into v_rep from public.qc_inspection_reports where id = v_id and is_test = v_test for update;
    if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
    if v_version is null or v_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
    if v_rep.status <> 'draft' then raise exception 'QC_NOT_DRAFT'; end if;
    update public.qc_inspection_reports
    set template_id = v_template_id, part_number = v_part_number, part_name = v_part_name, customer = v_customer,
        order_no = v_order_no, code = v_code, compound_lots = v_lots, sample_label = v_sample_label,
        inspected_at = v_inspected_at, remark = v_remark, version = v_rep.version + 1, updated_at = now()
    where id = v_rep.id
    returning * into v_rep;
    delete from public.qc_inspection_items where report_id = v_rep.id;
    v_action := 'update';
  end if;

  for v_item, v_ord in select value, ordinality from jsonb_array_elements(v_node) with ordinality loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'QC_INVALID_ITEM'; end if;
    v_item_no := private.qc_text(v_item, 'item_no', 2, 1, 'QC_INVALID_ITEM');
    if v_item_no !~ '^[A-Z]{1,2}$' or v_item_no = any (v_seen) then raise exception 'QC_INVALID_ITEM'; end if;
    v_seen := v_seen || v_item_no;
    v_name := private.qc_text(v_item, 'name', 100, 1, 'QC_INVALID_ITEM');
    v_instrument := private.qc_text(v_item, 'instrument', 100, 0, 'QC_INVALID_ITEM');
    v_unit := private.qc_text(v_item, 'unit', 20, 0, 'QC_INVALID_ITEM');
    v_note := private.qc_text(v_item, 'note', 500, 0, 'QC_INVALID_ITEM');
    v_min := private.qc_num(v_item -> 'spec_min', 'QC_INVALID_ITEM');
    v_std := private.qc_num(v_item -> 'spec_std', 'QC_INVALID_ITEM');
    v_max := private.qc_num(v_item -> 'spec_max', 'QC_INVALID_ITEM');
    if v_min is not null and v_max is not null and v_min > v_max then raise exception 'QC_INVALID_ITEM'; end if;

    if jsonb_typeof(v_item -> 'points') is distinct from 'array'
       or jsonb_array_length(v_item -> 'points') not between 1 and 5 then
      raise exception 'QC_INVALID_ITEM';
    end if;
    select array_agg(private.qc_num(t.x, 'QC_INVALID_ITEM') order by t.o) into v_points
    from jsonb_array_elements(v_item -> 'points') with ordinality as t(x, o);
    if array_position(v_points, null) is not null then raise exception 'QC_INVALID_ITEM'; end if;

    -- ตัดสินจากสเปก: ผู้ตรวจยอมรับรายการที่ N ได้เป็น AC เท่านั้น (ต้องมีหมายเหตุ)
    v_judge := private.qc_judge(v_points, v_min, v_max);
    v_override := private.qc_text(v_item, 'judge_override', 10, 0, 'QC_INVALID_JUDGE');
    if v_override <> '' then
      if v_override <> 'AC' or v_judge <> 'N' then raise exception 'QC_INVALID_JUDGE'; end if;
      if char_length(v_note) < 5 then raise exception 'QC_ACCEPT_NOTE_REQUIRED'; end if;
      v_judge := 'AC';
    end if;

    insert into public.qc_inspection_items
      (report_id, item_no, sort_order, name, instrument, unit, spec_min, spec_std, spec_max,
       points, point_min, point_max, point_avg, judge, note)
    select v_rep.id, v_item_no, v_ord::integer, v_name, v_instrument, v_unit, v_min, v_std, v_max,
           v_points, min(x), max(x), round(avg(x), 4), v_judge, v_note
    from unnest(v_points) as x;
  end loop;

  update public.qc_inspection_reports
  set result = private.qc_result(v_rep.id)
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, v_action, '', v_actor.id, 'QC_REPORT_SAVE');
  return private.qc_report_json(v_rep.id);
end;
$$;

-- ออก NCR จากใบที่ผลเป็น 'ng' (ใบละ 1 NCR) ด้วย app_ncr_issue ในธุรกรรมเดียวกัน
create or replace function public.app_qc_issue_ncr(
  p_id uuid, p_version integer, p_defect_type_code text, p_qty_total numeric, p_qty_defect numeric,
  p_unit text, p_description text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean := true;
  v_desc text := btrim(coalesce(p_description, ''));
  v_rep public.qc_inspection_reports%rowtype;
  v_ncr jsonb;
  v_ncr_id uuid;
  v_ncr_no text;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_edit(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if char_length(v_desc) not between 10 and 4000 then raise exception 'INVALID_NCR_DESCRIPTION'; end if;
  perform pg_advisory_xact_lock(hashtext('qc_inspection'));

  select * into v_rep from public.qc_inspection_reports where id = p_id and is_test = v_test for update;
  if v_rep.id is null then raise exception 'QC_NOT_FOUND'; end if;
  if p_version is null or p_version <> v_rep.version then raise exception 'QC_VERSION_CONFLICT'; end if;
  if v_rep.ncr_id is not null then raise exception 'QC_NCR_EXISTS'; end if;
  if v_rep.result is distinct from 'ng' then raise exception 'QC_NOT_NG'; end if;
  if v_rep.status = 'cancelled' then raise exception 'QC_NOT_ACTIVE'; end if;
  if v_rep.status in ('draft', 'rejected') then raise exception 'QC_NOT_SUBMITTED'; end if;

  -- ตรวจชนิดข้อบกพร่อง จำนวน และหน่วยด้วยกติกาเดิมของ app_ncr_issue
  v_ncr := public.app_ncr_issue(
    v_rep.part_name, p_qty_total, p_qty_defect, p_unit, 'final_fg', p_defect_type_code,
    'ใบตรวจ QC ' || v_rep.report_no || ': ' || v_desc,
    nullif(v_rep.part_number, ''), nullif(v_rep.customer, ''), null, nullif(v_rep.order_no, ''),
    nullif(array_to_string(v_rep.compound_lots, ', '), ''), null, null);
  v_ncr_id := (v_ncr ->> 'id')::uuid;
  v_ncr_no := v_ncr ->> 'ncr_no';

  update public.qc_inspection_reports
  set ncr_id = v_ncr_id, ncr_no = v_ncr_no, version = v_rep.version + 1, updated_at = now()
  where id = v_rep.id;

  perform private.qc_record(v_rep.id, 'ncr', v_ncr_no, v_actor.id, 'QC_REPORT_NCR');
  return private.qc_report_json(v_rep.id) || jsonb_build_object('ncr_id', v_ncr_id, 'ncr_no', v_ncr_no);
end;
$$;

-- รายการใบ (ไม่รวมรายการตรวจ) ล่าสุด 200 ใบ กรองด้วย status, part_number (มีคำนี้อยู่ใน Part Number หรือ Part Name ไม่สนตัวพิมพ์
-- เพื่อให้ใบของชิ้นงานที่ไม่มีเลข Part ค้นเจอ), lot (ตรงทั้งค่า), result — นิยามจาก 20261027010000 เปลี่ยนเฉพาะเงื่อนไขค้นหา
create or replace function public.app_qc_reports(p_filter jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_filter jsonb := coalesce(p_filter, '{}'::jsonb);
  v_status text;
  v_part text;
  v_lot text;
  v_result text;
begin
  perform private.lab_only_block();
  v_actor := private.qc_actor();
  if not private.qc_can_read(v_actor) then raise exception 'NOT_AUTHORIZED'; end if;
  if jsonb_typeof(v_filter) <> 'object' then raise exception 'QC_INVALID_PAYLOAD'; end if;
  v_status := private.qc_text(v_filter, 'status', 30, 0, 'QC_INVALID_PAYLOAD');
  v_part := private.qc_text(v_filter, 'part_number', 60, 0, 'QC_INVALID_PAYLOAD');
  v_lot := private.qc_text(v_filter, 'lot', 60, 0, 'QC_INVALID_PAYLOAD');
  v_result := private.qc_text(v_filter, 'result', 10, 0, 'QC_INVALID_PAYLOAD');
  if v_status not in ('', 'draft', 'pending_qa_manager', 'pending_factory_manager', 'pending_general_manager',
                      'approved', 'rejected', 'cancelled')
     or v_result not in ('', 'ok', 'ng', 'accept') then
    raise exception 'QC_INVALID_PAYLOAD';
  end if;

  return jsonb_build_object('reports', coalesce((
    select jsonb_agg(x.entry order by x.created_at desc, x.id desc)
    from (
      select r.id, r.created_at, jsonb_build_object(
          'id', r.id, 'report_no', r.report_no, 'part_number', r.part_number, 'part_name', r.part_name,
          'customer', r.customer, 'order_no', r.order_no, 'compound_lots', to_jsonb(r.compound_lots),
          'inspected_at', r.inspected_at,
          'inspector_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = r.inspected_by),
          'result', r.result, 'status', r.status, 'current_step', r.current_step, 'version', r.version,
          'ncr_no', case when r.ncr_id is null then null else r.ncr_no end, 'created_at', r.created_at) as entry
      from public.qc_inspection_reports r
      where r.is_test
        and (v_status = '' or r.status = v_status)
        and (v_part = '' or strpos(lower(r.part_number), lower(v_part)) > 0 or strpos(lower(r.part_name), lower(v_part)) > 0)
        and (v_lot = '' or v_lot = any (r.compound_lots))
        and (v_result = '' or r.result = v_result)
      order by r.created_at desc, r.id desc
      limit 200
    ) x), '[]'::jsonb));
end;
$$;

-- สิทธิ์ (ระบุซ้ำหลัง create or replace ให้ตรงกับ 20261027010000: ไม่เปิดให้ anon, เรียกได้เฉพาะผู้ล็อกอิน)
revoke all on function public.app_qc_templates() from public, anon;
revoke all on function public.app_qc_reports(jsonb) from public, anon;
revoke all on function public.app_qc_save_template(jsonb) from public, anon;
revoke all on function public.app_qc_save_report(jsonb) from public, anon;
revoke all on function public.app_qc_issue_ncr(uuid, integer, text, numeric, numeric, text, text) from public, anon;
grant execute on function public.app_qc_templates() to authenticated;
grant execute on function public.app_qc_reports(jsonb) to authenticated;
grant execute on function public.app_qc_save_template(jsonb) to authenticated;
grant execute on function public.app_qc_save_report(jsonb) to authenticated;
grant execute on function public.app_qc_issue_ncr(uuid, integer, text, numeric, numeric, text, text) to authenticated;
