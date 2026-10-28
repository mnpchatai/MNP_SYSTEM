-- ============================================================================
-- ฝ่ายโรงงาน: วันหมดอายุและการกักกันล็อต + ตัดวัตถุดิบแบบ FEFO (โหมดทดสอบเท่านั้น)
--
-- ย้ายจากต้นแบบ prototypes/rubber-mes (allocateFefo / lotState ใน src/lib/rules.js, setMaterialLotStatus ใน src/data/actions.js)
-- เดิม factory_lots มีแค่ received_date และขั้นแรกของใบงานตัดวัตถุดิบแบบ FIFO (ล็อตที่รับก่อนออกก่อน) ไม่ว่าล็อตจะหมดอายุหรือมีปัญหาคุณภาพ
--
-- กติกา
--   * ล็อตมีวันหมดอายุ (ไม่บังคับ: null = ไม่มีวันหมดอายุ) และสถานะกักกัน (on_hold) แยกกัน
--     ล็อตใช้ได้ = ไม่ถูกกักกัน และ (ไม่มีวันหมดอายุ หรือวันหมดอายุ ≥ วันนี้ตามเวลาไทย) — ใช้ได้ถึงสิ้นวันหมดอายุ
--   * ตั้ง/แก้/ล้างวันหมดอายุ: app_factory_set_lot_expiry แผนก ST (รับของเข้าคลัง) หรือ QA (LOT_EXPIRY_STORES_OR_QA_ONLY)
--     ปี 2000–2100 และไม่ก่อนวันที่รับของ (INVALID_LOT_EXPIRY) ค่าเดิม = LOT_EXPIRY_UNCHANGED
--   * กักกัน/ปลดกักกัน: app_factory_set_lot_hold แผนก QA เท่านั้น (LOT_HOLD_QA_ONLY) เหตุผล 10–1,000 ตัวอักษร (LOT_HOLD_NOTE_REQUIRED)
--     กักกันซ้ำ = LOT_ALREADY_HELD · ปลดล็อตที่ไม่ได้กักกัน = LOT_NOT_HELD
--   * ทั้งสอง RPC ล็อกแถวและตรวจ version (LOT_STALE) เขียน factory_lot_history และ audit_logs (ผู้กระทำคือ admin ตัวจริงเบื้องหลัง persona)
--   * ตัดวัตถุดิบ (private.factory_issue_stock): FEFO = วันหมดอายุใกล้สุดก่อน (ไม่มีวันหมดอายุไว้หลัง) แล้วตามวันที่รับ เลขล็อต คลัง
--     ข้ามล็อตที่ถูกกักกันหรือหมดอายุ ยอดที่ใช้ได้ไม่พอ: ถ้ารวมล็อตที่ถูกข้ามแล้วพอ = JOB_STOCK_LOT_BLOCKED ไม่เช่นนั้น JOB_INSUFFICIENT_STOCK
--     ธุรกรรมทั้งใบยังถูกยกเลิกเหมือนเดิม (ไม่ตัดบางส่วน) ยอดที่ไม่มีล็อต (Item ที่ไม่ติดตามล็อต) ตัดตามเดิม
--   * อ่าน: app_factory_lots ล็อตทั้งหมดพร้อมยอดคงเหลือ สถานะ และประวัติ 300 รายการล่าสุด ทุก persona ในโหมดทดสอบอ่านได้
--     (สิทธิ์ที่หน้าเว็บใช้ซ่อน/แสดงปุ่มมาจาก can_set_expiry / can_hold แต่ RPC ตรวจเองทุกครั้ง)
--   * ยอดคงคลังรวมของ Item (app_factory_master_data) ยังนับล็อตที่ถูกกักกัน/หมดอายุ เพราะของยังอยู่ในคลังจริง
--
-- การแยกข้อมูลทดสอบ: ตารางใหม่ factory_lot_history ใช้แบบเดียวกับ factory_* ทุกตาราง (is_test จาก trigger, foreign key คู่ (id, is_test),
-- RLS deny-all, ถอนสิทธิ์ตรง, ลงทะเบียนใน private.sandbox_unguarded_tables(), กันบัญชี lab-only) ล้างพร้อมข้อมูลทดสอบฝ่ายโรงงาน
-- ไม่มีแจ้งเตือน (กติกาโหมดทดสอบข้อ 4) ก่อนเปิดกับข้อมูลจริงต้องกำหนดบทบาทจริงของผู้ตั้งวันหมดอายุและผู้กักกัน/ปลดล็อต
--
-- เริ่มจากนิยามล่าสุดของ private.factory_issue_stock (20261007060000), private.sandbox_unguarded_tables /
-- private.factory_test_data_counts / app_sandbox_purge_factory (20261029010000)
--
-- Rollback (ข้อมูลทดสอบอย่างเดียว): drop function public.app_factory_lots(), public.app_factory_set_lot_expiry(uuid, integer, date),
--   public.app_factory_set_lot_hold(uuid, integer, boolean, text); drop table public.factory_lot_history;
--   alter table public.factory_lots drop column expiry_date, on_hold, hold_reason, held_at, version, updated_by, updated_at;
--   แล้ว create or replace private.factory_issue_stock ด้วยนิยามของ 20261007060000 และ private.sandbox_unguarded_tables /
--   private.factory_test_data_counts / app_sandbox_purge_factory ด้วยนิยามของ 20261029010000
-- ============================================================================

-- 1. ตาราง -----------------------------------------------------------------------------
alter table public.factory_lots
  add column expiry_date date check (expiry_date between date '2000-01-01' and date '2100-12-31'),
  add column on_hold boolean not null default false,
  add column hold_reason text not null default '' check (char_length(hold_reason) <= 1000),
  add column held_at timestamptz,
  add column version integer not null default 1 check (version > 0),
  add column updated_by uuid references public.employees(id) on delete set null,
  add column updated_at timestamptz;
comment on column public.factory_lots.expiry_date is 'วันหมดอายุของล็อต (null = ไม่มี) ใช้ได้ถึงสิ้นวันนี้ตามเวลาไทย ตัดวัตถุดิบแบบ FEFO';
comment on column public.factory_lots.on_hold is 'QA กักกันล็อต: ตัดวัตถุดิบข้ามล็อตนี้จนกว่า QA ปลด';

create table public.factory_lot_history (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  lot_id uuid not null,
  action text not null check (action in ('expiry', 'hold', 'release')),
  expiry_before date,
  expiry_after date,
  note text not null default '' check (char_length(note) <= 1000),
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (lot_id, is_test) references public.factory_lots(id, is_test)
);
create index factory_lot_history_lot_idx on public.factory_lot_history(lot_id, created_at);
comment on table public.factory_lot_history is 'ประวัติวันหมดอายุและการกักกัน/ปลดกักกันของล็อต';

create trigger factory_lot_history_sandbox_scope before insert or update or delete on public.factory_lot_history
  for each row execute function private.factory_sandbox_scope();
revoke all on public.factory_lot_history from anon, authenticated;
alter table public.factory_lot_history enable row level security;
create policy factory_lot_history_no_direct_access on public.factory_lot_history for all to authenticated using (false) with check (false);
-- บัญชี lab-only (20261019005000) ห้ามเข้าถึงตารางใหม่ทุกตาราง
select private.lab_only_guard_table('public.factory_lot_history');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261029010000 ทุกชื่อ แล้วเพิ่ม factory_lot_history)
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
    'factory_routing_step_params','factory_job_step_readings',
    'factory_lot_history']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. ตัวช่วย (private) ---------------------------------------------------------------------
-- วันนี้ตามเวลาไทย: ล็อตใช้ได้ถึงสิ้นวันหมดอายุ
create or replace function private.factory_today()
returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
revoke all on function private.factory_today() from public, anon, authenticated;

-- ล็อตใช้ตัดวัตถุดิบได้หรือไม่ (ยอดที่ไม่มีล็อต = ใช้ได้) — นิยามเดียว ใช้ทั้งตอนตัดและตอนอ่าน
create or replace function private.factory_lot_usable(p_on_hold boolean, p_expiry_date date)
returns boolean language sql stable set search_path = '' as $$
  select not coalesce(p_on_hold, false) and (p_expiry_date is null or p_expiry_date >= private.factory_today())
$$;
revoke all on function private.factory_lot_usable(boolean, date) from public, anon, authenticated;

-- ตัดวัตถุดิบ: นิยามของ 20261007060000 เปลี่ยนจาก FIFO เป็น FEFO และข้ามล็อตที่ถูกกักกัน/หมดอายุ
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
  v_blocked numeric;
begin
  for v_bal in
    select m.warehouse_id, m.lot_id, sum(m.quantity) as balance
    from public.factory_inventory_movements m
    left join public.factory_lots l on l.id = m.lot_id
    where m.is_test and m.item_id = p_item_id and private.factory_lot_usable(l.on_hold, l.expiry_date)
    group by m.warehouse_id, m.lot_id, l.expiry_date, l.received_date, l.lot_number
    having sum(m.quantity) > 0
    order by l.expiry_date nulls last, l.received_date nulls last, l.lot_number nulls last, m.warehouse_id
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_bal.balance);
    insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, production_order_id, created_by)
    values (p_item_id, v_bal.warehouse_id, v_bal.lot_id, -v_take, 'production_issue', private.factory_job_issue_reference(p_job_code), p_production_order_id, p_actor_id);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    -- ยอดในล็อตที่ถูกข้าม (กักกัน/หมดอายุ) พอจะตัดได้หรือไม่: บอกสาเหตุให้ตรงกว่า "คงคลังไม่พอ"
    select coalesce(sum(t.balance), 0) into v_blocked
    from (select sum(m.quantity) as balance
          from public.factory_inventory_movements m
          join public.factory_lots l on l.id = m.lot_id
          where m.is_test and m.item_id = p_item_id and not private.factory_lot_usable(l.on_hold, l.expiry_date)
          group by m.warehouse_id, m.lot_id
          having sum(m.quantity) > 0) t;
    if v_blocked >= v_left then raise exception 'JOB_STOCK_LOT_BLOCKED'; end if;
    raise exception 'JOB_INSUFFICIENT_STOCK';
  end if;
end;
$$;
revoke all on function private.factory_issue_stock(uuid, numeric, text, uuid, uuid) from public, anon, authenticated;

-- ล็อกล็อตของโหมดทดสอบพร้อมตรวจ version
create or replace function private.factory_lot_lock(p_id uuid, p_version integer)
returns public.factory_lots
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.factory_lots%rowtype;
begin
  select * into v_lot from public.factory_lots where id = p_id and is_test for update;
  if v_lot.id is null then raise exception 'LOT_NOT_FOUND'; end if;
  if p_version is null or v_lot.version <> p_version then raise exception 'LOT_STALE'; end if;
  return v_lot;
end;
$$;
revoke all on function private.factory_lot_lock(uuid, integer) from public, anon, authenticated;

-- ประวัติ + audit ของการเปลี่ยนล็อต (ผู้กระทำใน audit_logs คือ admin ตัวจริงเบื้องหลัง persona)
create or replace function private.factory_lot_log(
  p_lot public.factory_lots, p_action text, p_expiry_before date, p_note text, p_actor public.employees)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin_id uuid;
  v_after public.factory_lots%rowtype;
begin
  select * into v_after from public.factory_lots where id = p_lot.id;
  insert into public.factory_lot_history (lot_id, action, expiry_before, expiry_after, note, changed_by)
  values (p_lot.id, p_action, p_expiry_before, v_after.expiry_date, p_note, p_actor.id);
  select a.id into v_admin_id
  from public.sandbox_sessions s join public.employees a on a.id = s.admin_employee_id
  where s.admin_auth_user_id = auth.uid();
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin_id, 'FACTORY_LOT_' || upper(p_action), 'factory_lots', p_lot.id::text,
          jsonb_build_object('lot_number', p_lot.lot_number, 'expiry_before', p_expiry_before, 'expiry_after', v_after.expiry_date,
                             'on_hold', v_after.on_hold, 'is_test', p_lot.is_test, 'persona_employee_no', p_actor.employee_no));
  return jsonb_build_object('id', v_after.id, 'version', v_after.version, 'expiry_date', v_after.expiry_date, 'on_hold', v_after.on_hold);
end;
$$;
revoke all on function private.factory_lot_log(public.factory_lots, text, date, text, public.employees) from public, anon, authenticated;

-- 3. RPC ---------------------------------------------------------------------------------
create or replace function public.app_factory_set_lot_expiry(p_id uuid, p_version integer, p_expiry_date date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_lot public.factory_lots%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.factory_actor();
  if not exists (select 1 from public.departments d where d.id = v_actor.department_id and d.code in ('ST', 'QA')) then
    raise exception 'LOT_EXPIRY_STORES_OR_QA_ONLY';
  end if;
  v_lot := private.factory_lot_lock(p_id, p_version);
  if p_expiry_date is not null and (p_expiry_date not between date '2000-01-01' and date '2100-12-31' or p_expiry_date < v_lot.received_date) then
    raise exception 'INVALID_LOT_EXPIRY';
  end if;
  if p_expiry_date is not distinct from v_lot.expiry_date then raise exception 'LOT_EXPIRY_UNCHANGED'; end if;
  update public.factory_lots
  set expiry_date = p_expiry_date, version = v_lot.version + 1, updated_by = v_actor.id, updated_at = now()
  where id = v_lot.id;
  return private.factory_lot_log(v_lot, 'expiry', v_lot.expiry_date, '', v_actor);
end;
$$;
revoke all on function public.app_factory_set_lot_expiry(uuid, integer, date) from public, anon;
grant execute on function public.app_factory_set_lot_expiry(uuid, integer, date) to authenticated;

create or replace function public.app_factory_set_lot_hold(p_id uuid, p_version integer, p_hold boolean, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_lot public.factory_lots%rowtype;
  v_note text := btrim(coalesce(p_note, ''));
begin
  perform private.lab_only_block();
  v_actor := private.factory_actor();
  if not exists (select 1 from public.departments d where d.id = v_actor.department_id and d.code = 'QA') then
    raise exception 'LOT_HOLD_QA_ONLY';
  end if;
  if p_hold is null then raise exception 'INVALID_LOT_HOLD'; end if;
  if char_length(v_note) not between 10 and 1000 then raise exception 'LOT_HOLD_NOTE_REQUIRED'; end if;
  v_lot := private.factory_lot_lock(p_id, p_version);
  if p_hold and v_lot.on_hold then raise exception 'LOT_ALREADY_HELD'; end if;
  if not p_hold and not v_lot.on_hold then raise exception 'LOT_NOT_HELD'; end if;
  update public.factory_lots
  set on_hold = p_hold,
      hold_reason = case when p_hold then v_note else hold_reason end,
      held_at = case when p_hold then now() else held_at end,
      version = v_lot.version + 1, updated_by = v_actor.id, updated_at = now()
  where id = v_lot.id;
  return private.factory_lot_log(v_lot, case when p_hold then 'hold' else 'release' end, v_lot.expiry_date, v_note, v_actor);
end;
$$;
revoke all on function public.app_factory_set_lot_hold(uuid, integer, boolean, text) from public, anon;
grant execute on function public.app_factory_set_lot_hold(uuid, integer, boolean, text) to authenticated;

-- ล็อตทั้งหมดของโหมดทดสอบ: ยอดคงเหลือรวมทุกคลัง สถานะ (available / hold / expired) และประวัติล่าสุด
-- can_set_expiry / can_hold บอกหน้าเว็บว่า persona นี้เห็นปุ่มไหน (การควบคุมสิทธิ์จริงอยู่ที่ RPC ด้านบน)
create or replace function public.app_factory_lots()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_dept text;
begin
  perform private.lab_only_block();
  v_actor := private.factory_actor();
  select d.code into v_dept from public.departments d where d.id = v_actor.department_id;
  return jsonb_build_object(
    'today', private.factory_today(),
    'can_set_expiry', coalesce(v_dept in ('ST', 'QA'), false),
    'can_hold', coalesce(v_dept = 'QA', false),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id, 'version', l.version, 'lot_number', l.lot_number, 'item_id', i.id, 'item_code', i.code, 'item_name', i.name,
          'unit_code', i.unit_code, 'received_date', l.received_date, 'expiry_date', l.expiry_date,
          'on_hold', l.on_hold, 'hold_reason', l.hold_reason, 'held_at', l.held_at,
          'status', case when l.on_hold then 'hold' when l.expiry_date < private.factory_today() then 'expired' else 'available' end,
          'balance', coalesce((select sum(m.quantity) from public.factory_inventory_movements m where m.lot_id = l.id), 0),
          'updated_at', l.updated_at,
          'updated_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = l.updated_by)
        ) order by l.expiry_date nulls last, l.received_date, i.code, l.lot_number)
      from public.factory_lots l join public.factory_items i on i.id = l.item_id
      where l.is_test), '[]'::jsonb),
    'history', coalesce((
      select jsonb_agg(h.entry order by h.created_at desc, h.id desc)
      from (
        select x.id, x.created_at, jsonb_build_object(
            'id', x.id, 'lot_id', x.lot_id, 'lot_number', l.lot_number, 'item_code', i.code, 'action', x.action,
            'expiry_before', x.expiry_before, 'expiry_after', x.expiry_after, 'note', x.note, 'created_at', x.created_at,
            'changed_by_name', (select e.first_name || ' ' || e.last_name from public.employees e where e.id = x.changed_by)) as entry
        from public.factory_lot_history x
        join public.factory_lots l on l.id = x.lot_id
        join public.factory_items i on i.id = l.item_id
        where x.is_test
        order by x.created_at desc, x.id desc
        limit 300
      ) h), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.app_factory_lots() from public, anon;
grant execute on function public.app_factory_lots() to authenticated;

-- 4. ล้างข้อมูลทดสอบ ------------------------------------------------------------------------
-- นับข้อมูลทดสอบ: นิยามของ 20261029010000 เพิ่ม factory_lot_history ใน details
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
             + (select count(*) from public.factory_lot_history where is_test)
  )
$$;
revoke all on function private.factory_test_data_counts() from public, anon, authenticated;

-- ล้างข้อมูลทดสอบ: นิยามของ 20261029010000 เพิ่มการลบ factory_lot_history ก่อน factory_lots (ลูกก่อนแม่)
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
  delete from public.factory_lot_history where is_test;
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
