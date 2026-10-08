-- ============================================================================
-- ฝ่ายโรงงาน: เพิ่มช่อง "รหัสอะไหล่" ใน Item (โหมดทดสอบ)
--
-- ที่มา: ในใบคำนวณวัตถุดิบ "รหัส Item" คือรหัสสินค้า (คอลัมน์ B) ที่เกิดจากการประกอบ "รหัสอะไหล่" (คอลัมน์ X: รหัส FG/RB/SE/ST/PT/BG) มาก่อน
-- จึงเก็บสองอย่างแยกกัน: factory_items.code = รหัส Item (ไม่ซ้ำในโหมดเดียวกัน) · factory_items.part_code = รหัสอะไหล่ที่ใช้ประกอบ/อ้างอิง
-- (ซ้ำกันได้ เช่น อะไหล่รหัสเดียวกันแต่คนละสี เป็นคนละ Item) ใช้ค้นหาในทะเบียนสินค้าได้
--
--   * คอลัมน์ part_code ไม่บังคับ (null = ไม่มี) ตัดช่องว่างหัวท้าย ยาวไม่เกิน 60 ไม่มีอักขระควบคุม (INVALID_ITEM_PART_CODE)
--   * app_factory_save_item มีรุ่น 15 พารามิเตอร์ (เพิ่ม p_part_code: null = ไม่แตะค่าเดิม · ค่าว่าง = ล้าง) หน้าเว็บเรียกรุ่นนี้
--     รุ่น 14 พารามิเตอร์เดิมคงไว้เป็นตัวห่อที่เรียกรุ่นใหม่ด้วย null เพื่อไม่ให้ผู้เรียกเดิมและเทสต์เดิมพัง
--   * app_factory_master_data ส่ง part_code ของ Item เพิ่ม (คัดลอกนิยามล่าสุดจาก 20261007070000 เพิ่มเฉพาะบรรทัดนี้)
--   * ประวัติ Item (factory_item_history) เก็บ to_jsonb ของแถว จึงมี part_code ในประวัติโดยอัตโนมัติ
--
-- Rollback: เรียกรุ่น 15 พารามิเตอร์ไม่ได้อีกเมื่อลบ: drop function public.app_factory_save_item(uuid, integer, text, text, text, text, text, text, text, text, text, boolean, numeric, text, text);
--   create or replace app_factory_save_item (14 พารามิเตอร์) ด้วยนิยามเดิมของ 20261006050000 และ app_factory_master_data ด้วยนิยามเดิมของ 20261007070000;
--   drop index factory_items_part_code_idx; alter table public.factory_items drop column part_code;
-- ============================================================================

alter table public.factory_items
  add column part_code text check (part_code is null or (part_code = btrim(part_code) and char_length(part_code) between 1 and 60 and part_code !~ '[[:cntrl:]]'));
comment on column public.factory_items.part_code is 'รหัสอะไหล่ (คอลัมน์ X ของใบคำนวณวัตถุดิบ) ที่ใช้ประกอบเป็น Item นี้ ไม่บังคับ ซ้ำกันได้';
create index factory_items_part_code_idx on public.factory_items (is_test, part_code) where part_code is not null;

-- รุ่น 15 พารามิเตอร์ (เนื้อหาเดิมของ 20261006050000 เพิ่มเฉพาะ p_part_code)
create or replace function public.app_factory_save_item(
  p_id uuid,
  p_version integer,
  p_code text,
  p_name text,
  p_name_en text,
  p_item_type text,
  p_category_code text,
  p_brand text,
  p_unit_code text,
  p_procurement text,
  p_status text,
  p_lot_tracking boolean,
  p_min_stock numeric,
  p_specification text,
  p_part_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_admin_id uuid;
  v_test boolean;
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
  v_name_en text := btrim(coalesce(p_name_en, ''));
  v_spec text := btrim(coalesce(p_specification, ''));
  -- รหัสอะไหล่: null = ไม่แตะค่าเดิม (แก้ไข) / ไม่มี (เพิ่มใหม่) · ค่าว่าง = ล้างรหัสอะไหล่
  v_part text := btrim(p_part_code);
  v_old public.factory_items%rowtype;
  v_new public.factory_items%rowtype;
begin
  v_actor := private.factory_actor();
  v_test := true;  -- factory_actor ยืนยันแล้วว่าอยู่ในโหมดทดสอบ
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();

  if v_code !~ '^[A-Z0-9_-]{2,40}$' then raise exception 'INVALID_ITEM_CODE'; end if;
  if char_length(v_name) not between 1 and 160 then raise exception 'INVALID_ITEM_NAME_TH'; end if;
  if char_length(v_name_en) > 160 then raise exception 'INVALID_ITEM_NAME_EN'; end if;
  if p_item_type is null or p_item_type not in ('RM', 'WIP', 'FG', 'PKG') then raise exception 'INVALID_ITEM_TYPE'; end if;
  if not exists (select 1 from public.factory_categories where code = p_category_code) then raise exception 'INVALID_ITEM_CATEGORY'; end if;
  if p_brand is null or p_brand not in ('MNP', 'SAFSOF') then raise exception 'INVALID_ITEM_BRAND'; end if;
  if not exists (select 1 from public.factory_units where code = p_unit_code) then raise exception 'INVALID_ITEM_UNIT'; end if;
  if p_procurement is null or p_procurement not in ('buy', 'make', 'both') then raise exception 'INVALID_ITEM_PROCUREMENT'; end if;
  if p_status is null or p_status not in ('active', 'inactive') then raise exception 'INVALID_ITEM_STATUS'; end if;
  if p_lot_tracking is null then raise exception 'INVALID_ITEM_LOT_TRACKING'; end if;
  -- numeric รับ NaN/Infinity ได้ จึงตรวจตรงๆ ก่อนเทียบช่วง
  if p_min_stock is null or p_min_stock = 'NaN'::numeric or p_min_stock < 0 or p_min_stock > 1000000000 then
    raise exception 'INVALID_ITEM_MIN_STOCK';
  end if;
  if char_length(v_spec) > 3000 then raise exception 'INVALID_ITEM_SPECIFICATION'; end if;
  if v_part is not null and (char_length(v_part) > 60 or v_part ~ '[[:cntrl:]]') then raise exception 'INVALID_ITEM_PART_CODE'; end if;

  if p_id is null then
    if exists (select 1 from public.factory_items where is_test = v_test and code = v_code) then
      raise exception 'ITEM_CODE_TAKEN';
    end if;
    insert into public.factory_items (code, name, name_en, item_type, category_code, brand, unit_code, procurement,
                                      status, lot_tracking, min_stock, specification, part_code, created_by, updated_by)
    values (v_code, v_name, v_name_en, p_item_type, p_category_code, p_brand, p_unit_code, p_procurement,
            p_status, p_lot_tracking, p_min_stock, v_spec, nullif(v_part, ''), v_actor.id, v_actor.id)
    returning * into v_new;
    insert into public.factory_item_history (item_id, action, version, before_data, after_data, changed_by)
    values (v_new.id, 'create', v_new.version, null, to_jsonb(v_new), v_actor.id);
  else
    select * into v_old from public.factory_items where id = p_id and is_test = v_test for update;
    if v_old.id is null then
      raise exception 'ITEM_NOT_FOUND';
    end if;
    if p_version is null or p_version <> v_old.version then
      raise exception 'ITEM_VERSION_CONFLICT';
    end if;
    if p_item_type <> v_old.item_type or p_unit_code <> v_old.unit_code or p_lot_tracking <> v_old.lot_tracking then
      raise exception 'ITEM_LOCKED_FIELDS';
    end if;
    if v_code <> v_old.code
       and exists (select 1 from public.factory_items where is_test = v_test and code = v_code and id <> v_old.id) then
      raise exception 'ITEM_CODE_TAKEN';
    end if;
    update public.factory_items
    set code = v_code, name = v_name, name_en = v_name_en, category_code = p_category_code, brand = p_brand,
        procurement = p_procurement, status = p_status, min_stock = p_min_stock, specification = v_spec,
        part_code = case when v_part is null then v_old.part_code else nullif(v_part, '') end,
        version = v_old.version + 1, updated_by = v_actor.id, updated_at = now()
    where id = v_old.id
    returning * into v_new;
    insert into public.factory_item_history (item_id, action, version, before_data, after_data, changed_by)
    values (v_new.id, 'update', v_new.version, to_jsonb(v_old), to_jsonb(v_new), v_actor.id);
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, case when p_id is null then 'FACTORY_ITEM_CREATE' else 'FACTORY_ITEM_UPDATE' end,
          'factory_items', v_new.id::text,
          jsonb_build_object('code', v_new.code, 'version', v_new.version, 'is_test', v_new.is_test,
                             'persona_employee_no', v_actor.employee_no));
  return jsonb_build_object('id', v_new.id, 'version', v_new.version, 'code', v_new.code);
exception
  -- สองหน้าต่างเพิ่มรหัสเดียวกันพร้อมกัน: unique (is_test, code) กันไว้ แปลงเป็นข้อความเดียวกับที่ตรวจล่วงหน้า
  when unique_violation then
    raise exception 'ITEM_CODE_TAKEN';
end;
$$;

-- รุ่น 14 พารามิเตอร์เดิม: ห่อรุ่นใหม่ (ไม่แตะรหัสอะไหล่)
create or replace function public.app_factory_save_item(
  p_id uuid,
  p_version integer,
  p_code text,
  p_name text,
  p_name_en text,
  p_item_type text,
  p_category_code text,
  p_brand text,
  p_unit_code text,
  p_procurement text,
  p_status text,
  p_lot_tracking boolean,
  p_min_stock numeric,
  p_specification text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.app_factory_save_item(p_id, p_version, p_code, p_name, p_name_en, p_item_type, p_category_code, p_brand,
                                      p_unit_code, p_procurement, p_status, p_lot_tracking, p_min_stock, p_specification, null::text)
$$;

-- ข้อมูลทั้งหมดของโมดูล: นิยามล่าสุดของ 20261007070000 เพิ่ม part_code ของ Item
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

revoke all on function public.app_factory_save_item(uuid, integer, text, text, text, text, text, text, text, text, text, boolean, numeric, text, text) from public, anon;
grant execute on function public.app_factory_save_item(uuid, integer, text, text, text, text, text, text, text, text, text, boolean, numeric, text, text) to authenticated;
