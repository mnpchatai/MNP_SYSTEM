-- ============================================================================
-- ฝ่ายโรงงาน: ยกเลิกใบงานที่เริ่มแล้ว + คืนวัตถุดิบ และยกเลิกใบสั่งผลิต (โหมดทดสอบเท่านั้น)
--
-- ต่อจากใบงานผลิต (20261007050000) ซึ่งยกเลิกได้เฉพาะใบงานที่ยังไม่มีขั้นใดเสร็จ และใบสั่งผลิตยังไม่มี RPC ที่เปลี่ยนไป cancelled
--
-- 1) ยกเลิกใบงานที่เริ่มแล้ว (app_factory_cancel_job ขยายจากเดิม)
--    * ยกเลิกได้เมื่อใบงานเป็น open หรือ in_progress (ผลผลิตยังไม่เข้าคลัง) ใบงาน completed ยกเลิกไม่ได้ เพราะผลผลิตเข้าคลังแล้ว
--    * ใบงาน in_progress: คืนวัตถุดิบที่ตัดไปตอนขั้นแรกทั้งหมดในธุรกรรมเดียวกับการเปลี่ยนสถานะ ด้วยรายการเคลื่อนไหวคลังชนิดใหม่
--      production_return (บวกยอด) ต่อหนึ่งรายการตัด production_issue โดยคืนเข้าคลังและล็อตเดิม ไม่แก้/ลบรายการตัดเดิม
--      (บัญชีคลังเป็นแบบเพิ่มอย่างเดียว) ใบงานยกเลิกได้ครั้งเดียว (ล็อกแถว + ตรวจสถานะ + เทียบ version) จึงคืนซ้ำไม่ได้
--    * รายการตัดของใบงานหนึ่งหาจากเลขที่ใบงานในช่องอ้างอิง ผ่านตัวช่วยตัวเดียวกันทั้งตอนตัดและตอนคืน
--      (private.factory_job_issue_reference / factory_job_return_reference) เลขที่ใบงานไม่ซ้ำภายในโหมดเดียวกันอยู่แล้ว
--    * ขั้นที่ทำเสร็จแล้วคงสถานะ done เป็นประวัติ ใบสั่งผลิตที่เป็น in_progress อยู่ไม่ถูกเปลี่ยนสถานะ
--    * สิทธิ์เหมือนเดิม: แผนก PP เท่านั้น ต้องระบุเหตุผล หน้าเว็บแสดงรายการที่คืน (jobs[].returned)
--
-- 2) ยกเลิกใบสั่งผลิต (app_factory_cancel_production_order ใหม่)
--    * แผนก PP เท่านั้น ต้องระบุเหตุผล ยกเลิกได้ขณะ planning / planned / released / in_progress
--      (ก่อนหน้านั้นฝ่ายขายถอนกลับ/ฝ่ายวางแผนส่งกลับได้อยู่แล้ว) ใบที่ completed หรือ cancelled แล้วยกเลิกไม่ได้
--    * ยกเลิกไม่ได้ถ้ายังมีใบงาน open / in_progress หรือ completed (PRODUCTION_ORDER_HAS_JOBS: ให้ยกเลิกใบงานก่อน ใบงานที่ผลิตเสร็จแล้ว
--      มีผลผลิตเข้าคลัง จึงยกเลิกใบสั่งผลิตไม่ได้) และถ้ายังมีใบสั่งวัตถุดิบ draft / ordered ที่ยังไม่ยกเลิก
--      (PRODUCTION_ORDER_HAS_MATERIAL_ORDERS: ให้แผนก ST ยกเลิกก่อน) ใบสั่งวัตถุดิบที่รับของแล้วคงยอดคลังตามจริง
--    * กันแข่งกัน: ยกเลิกใบสั่งผลิตล็อกแถวแบบ for update ส่วนออกใบงานและสั่งวัตถุดิบอ่านแถวใบสั่งผลิตแบบ for share
--      จึงไม่มีใบงานหรือใบสั่งวัตถุดิบใหม่แทรกเข้าใต้ใบสั่งผลิตที่เพิ่งยกเลิก
--    * เพิ่มคอลัมน์ cancel_note / cancelled_by / cancelled_at ของ factory_production_orders และการกระทำ cancel ในประวัติ
--
-- การแยกข้อมูลทดสอบ: ไม่เพิ่มตาราง ใช้ trigger/RLS/foreign key คู่ของตารางเดิมทั้งหมด (ทุก RPC เรียก private.factory_actor() ก่อน
-- จึงใช้ได้เฉพาะ admin ในโหมดทดสอบ) โหมดทดสอบไม่ส่งอีเมล/LINE (กติกาข้อ 4) ก่อนเปิดกับข้อมูลจริงต้องกำหนดบทบาทจริงที่ยกเลิกได้
--
-- เริ่มจากนิยามล่าสุดของ app_factory_cancel_job / app_factory_create_job / private.factory_issue_stock (20261007050000),
-- private.factory_assert_released_order (20261007040000), private.factory_order_snapshot (20261007030000) และ
-- app_factory_master_data (20261007050000) แล้วเพิ่มเฉพาะส่วนที่เกี่ยวข้อง
--
-- Rollback (เกี่ยวกับข้อมูลทดสอบเท่านั้น): drop function public.app_factory_cancel_production_order(uuid, integer, text);
--   ลบแถว factory_inventory_movements kind = 'production_return' แล้วคืน check ของ kind เป็นชุดเดิมของ 20261006050000;
--   ลบแถวประวัติ action = 'cancel' ของ factory_production_order_history แล้วคืน check ของ action เป็นชุดเดิมของ 20261007050000;
--   ลบคอลัมน์ cancel_note / cancelled_by / cancelled_at ของ factory_production_orders; drop function
--   private.factory_job_issue_reference(text), private.factory_job_return_reference(text), private.factory_return_job_stock(...);
--   แล้ว create or replace app_factory_cancel_job / app_factory_create_job / private.factory_issue_stock /
--   private.factory_assert_released_order / private.factory_order_snapshot / app_factory_master_data ด้วยนิยามเดิม
--   (ใบงานที่ยกเลิกหลังเริ่มแล้วต้องล้างด้วยปุ่ม "ล้างข้อมูลทดสอบฝ่ายโรงงาน" เพราะยอดที่คืนจะหายไปพร้อมรายการคืน)
-- ============================================================================

-- 1. สคีมา ------------------------------------------------------------------------------
alter table public.factory_inventory_movements drop constraint if exists factory_inventory_movements_kind_check;
alter table public.factory_inventory_movements
  add constraint factory_inventory_movements_kind_check
  check (kind in ('opening', 'receipt', 'issue', 'transfer_in', 'transfer_out',
                  'adjustment', 'production_output', 'production_issue', 'production_return'));

alter table public.factory_production_order_history drop constraint if exists factory_production_order_history_action_check;
alter table public.factory_production_order_history
  add constraint factory_production_order_history_action_check
  check (action in ('create', 'update', 'submit', 'withdraw', 'receive', 'return', 'plan', 'release', 'start', 'output', 'finish', 'cancel'));

alter table public.factory_production_orders
  add column cancel_note text not null default '' check (char_length(cancel_note) <= 1000),
  add column cancelled_by uuid references public.employees(id) on delete set null,
  add column cancelled_at timestamptz;
comment on column public.factory_production_orders.cancel_note is 'เหตุผลที่ฝ่ายวางแผนยกเลิกใบสั่งผลิต';

-- 2. ตัวช่วย (private) ---------------------------------------------------------------------
-- ข้อความอ้างอิงของรายการตัด/คืนวัตถุดิบของใบงาน: นิยามที่เดียว ใช้ทั้งตอนตัด ตอนคืน และตอนอ่าน
create or replace function private.factory_job_issue_reference(p_job_code text)
returns text language sql immutable set search_path = '' as $$ select 'ตัดวัตถุดิบตามใบงาน ' || p_job_code $$;
create or replace function private.factory_job_return_reference(p_job_code text)
returns text language sql immutable set search_path = '' as $$ select 'คืนวัตถุดิบจากการยกเลิกใบงาน ' || p_job_code $$;
revoke all on function private.factory_job_issue_reference(text) from public, anon, authenticated;
revoke all on function private.factory_job_return_reference(text) from public, anon, authenticated;

-- ตัดวัตถุดิบ: เหมือนนิยามเดิมทุกประการ ยกเว้นข้อความอ้างอิงมาจากตัวช่วยกลาง
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
    values (p_item_id, v_bal.warehouse_id, v_bal.lot_id, -v_take, 'production_issue', private.factory_job_issue_reference(p_job_code), p_production_order_id, p_actor_id);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then raise exception 'JOB_INSUFFICIENT_STOCK'; end if;
end;
$$;
revoke all on function private.factory_issue_stock(uuid, numeric, text, uuid, uuid) from public, anon, authenticated;


-- คืนวัตถุดิบของใบงานหนึ่งใบ: ต่อหนึ่งรายการตัด production_issue เพิ่มรายการ production_return ยอดเท่ากัน (บวก) เข้าคลัง/ล็อตเดิม
-- คืนจำนวนรายการที่คืน (ใบงานที่ยังไม่เคยตัดคืน 0)
create or replace function private.factory_return_job_stock(p_job public.factory_jobs, p_actor_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows integer;
begin
  insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, production_order_id, created_by)
  select m.item_id, m.warehouse_id, m.lot_id, -m.quantity, 'production_return',
         private.factory_job_return_reference(p_job.code), m.production_order_id, p_actor_id
  from public.factory_inventory_movements m
  where m.is_test and m.kind = 'production_issue'
    and m.reference = private.factory_job_issue_reference(p_job.code)
    and m.production_order_id = p_job.production_order_id;
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$$;
revoke all on function private.factory_return_job_stock(public.factory_jobs, uuid) from public, anon, authenticated;

-- ใบสั่งผลิตที่ออกใบสั่งงานแล้ว (released / in_progress) เท่านั้นที่สั่งวัตถุดิบได้ — อ่านแถวแบบ for share เพื่อไม่ให้แข่งกับการยกเลิกใบสั่งผลิต
create or replace function private.factory_assert_released_order(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
begin
  select status into v_status from public.factory_production_orders where id = p_id and is_test for share;
  if v_status is null then raise exception 'MATERIAL_WORK_ORDER_UNKNOWN'; end if;
  if v_status not in ('released', 'in_progress') then raise exception 'MATERIAL_WORK_ORDER_NOT_RELEASED'; end if;
end;
$$;
revoke all on function private.factory_assert_released_order(uuid) from public, anon, authenticated;

create or replace function private.factory_order_snapshot(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'code', p.code, 'status', p.status, 'version', p.version,
    'item_code', i.code, 'item_name', i.name, 'unit_code', i.unit_code, 'planned_qty', p.planned_qty,
    'due_date', p.due_date, 'customer', p.customer, 'note', p.note,
    'bom_revision', b.revision, 'routing_revision', r.revision,
    'survey_note', p.survey_note, 'return_note', p.return_note, 'work_order_no', p.work_order_no,
    'cancel_note', p.cancel_note)
  from public.factory_production_orders p
  join public.factory_items i on i.id = p.item_id
  left join public.factory_boms b on b.id = p.bom_id
  left join public.factory_routings r on r.id = p.routing_id
  where p.id = p_id
$$;
revoke all on function private.factory_order_snapshot(uuid) from public, anon, authenticated;


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

  select * into v_order from public.factory_production_orders where id = p_production_order_id and is_test for share;
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


-- ยกเลิกใบงานที่ยังไม่เสร็จ (open / in_progress) ใบงานที่เริ่มแล้วคืนวัตถุดิบที่ตัดไปแล้วในธุรกรรมเดียวกัน
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
  v_returned integer := 0;
begin
  v_actor := private.factory_order_actor('PP');
  if v_note = '' then raise exception 'JOB_CANCEL_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_JOB_NOTE'; end if;
  v_job := private.factory_job_lock(p_id, p_version);
  if v_job.status not in ('open', 'in_progress') then raise exception 'JOB_NOT_CANCELLABLE'; end if;
  if v_job.status = 'in_progress' then
    v_returned := private.factory_return_job_stock(v_job, v_actor.id);
  end if;
  update public.factory_jobs
  set status = 'cancelled', cancel_note = v_note, version = v_job.version + 1, cancelled_by = v_actor.id, cancelled_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_job.id;
  return private.factory_job_log(v_job.id, 'cancel', null, v_note, v_actor) || jsonb_build_object('returned_lines', v_returned);
end;
$$;

-- ยกเลิกใบสั่งผลิต (ฝ่ายวางแผน): ต้องไม่มีใบงานที่ยังไม่ยกเลิก และไม่มีใบสั่งวัตถุดิบที่ยังไม่รับ/ไม่ยกเลิก
create or replace function public.app_factory_cancel_production_order(p_id uuid, p_version integer, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_order public.factory_production_orders%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  v_actor := private.factory_order_actor('PP');
  if v_note = '' then raise exception 'PRODUCTION_CANCEL_NOTE_REQUIRED'; end if;
  if char_length(v_note) > 1000 then raise exception 'INVALID_PRODUCTION_NOTE'; end if;
  v_order := private.factory_order_lock(p_id, p_version);
  if v_order.status not in ('planning', 'planned', 'released', 'in_progress') then raise exception 'PRODUCTION_ORDER_NOT_CANCELLABLE'; end if;
  if exists (select 1 from public.factory_jobs j where j.production_order_id = v_order.id and j.status <> 'cancelled') then
    raise exception 'PRODUCTION_ORDER_HAS_JOBS';
  end if;
  if exists (select 1 from public.factory_material_orders m where m.production_order_id = v_order.id and m.status in ('draft', 'ordered')) then
    raise exception 'PRODUCTION_ORDER_HAS_MATERIAL_ORDERS';
  end if;
  update public.factory_production_orders
  set status = 'cancelled', cancel_note = v_note, version = v_order.version + 1, cancelled_by = v_actor.id, cancelled_at = now(),
      updated_by = v_actor.id, updated_at = now()
  where id = v_order.id;
  return private.factory_order_log(v_order.id, 'cancel', v_note, v_actor);
end;
$$;

-- อ่านข้อมูลทั้งหมดของโมดูล: เพิ่มเหตุผลยกเลิกของใบสั่งผลิต และรายการวัตถุดิบที่คืนของใบงาน
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

revoke all on function public.app_factory_cancel_production_order(uuid, integer, text) from public, anon;
grant execute on function public.app_factory_cancel_production_order(uuid, integer, text) to authenticated;
