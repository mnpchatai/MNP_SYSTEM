-- ============================================================================
-- ฝ่ายโรงงาน: Item master (ทะเบียนสินค้า) + BOM / Routing / คลัง / ใบสั่งผลิต — เปิดเฉพาะโหมดทดสอบ
--
-- ที่มา: ย้ายจากแอปตัวอย่าง "MNP SYSTEM · Item Master" ที่ผู้ใช้ส่งมา (Cloudflare D1/SQLite 15 ตาราง)
-- มาเป็น Postgres ของระบบนี้ โดยคงโครงสร้างเดิมแต่ปรับให้เข้ากติกาของโปรเจกต์:
--   * ทุกตารางขึ้นต้น factory_ (กันชื่อชนกับตารางอื่นในอนาคต เช่น items/lots/warehouses)
--   * จำนวนใช้ numeric (ทศนิยมแน่นอน) แทน REAL, วันที่เป็น date/timestamptz, ID เป็น uuid
--   * app_meta ของแอปเดิม (กัน seed ซ้ำ) ไม่ต้องใช้ เพราะ seed ตรวจว่ามี Item ทดสอบอยู่แล้วหรือยัง
--   * เอกสารอ้างอิงหน่วยนับ/หมวดหมู่เก็บเป็นข้อมูลร่วม (ไม่มี is_test) ใส่ในไฟล์นี้ ไม่มีการเขียนจากแอป
--
-- ขอบเขตรอบนี้
--   * เพิ่ม/แก้ไข/หยุดใช้งาน Item ได้จริงผ่าน app_factory_save_item (ไม่มีการลบ ใช้สถานะหยุดใช้งานแทน)
--   * BOM, Routing, คลัง, ใบสั่งผลิต อ่านอย่างเดียวผ่าน app_factory_master_data ยังไม่มี RPC เขียน
--   * item_unit_conversions มีโครงสร้างแต่ยังไม่มีข้อมูลและยังไม่ใช้คำนวณ (เหมือนแอปเดิม)
--
-- เปิดเฉพาะโหมดทดสอบ (admin ที่ทำหน้าที่เป็น persona) — ยังไม่เปิดกับข้อมูลจริง
--   README (กติกาการเริ่ม Phase ใหม่) กำหนดให้ระบุเจ้าของข้อมูลหลัก แหล่งข้อมูล และ permission matrix
--   ก่อนใช้จริง ซึ่งยังไม่มี RPC ทุกตัวจึงปฏิเสธนอกโหมดทดสอบด้วย FACTORY_TEST_MODE_ONLY
--   (private.factory_actor) ในโหมดทดสอบ persona ใดก็เพิ่ม/แก้ Item ได้ เพราะเข้าโหมดทดสอบได้เฉพาะ admin
--   เมื่อจะเปิดใช้จริง ต้องกำหนดบทบาทผู้แก้ไขใน factory_actor และเพิ่มเทสต์อนุญาต/ปฏิเสธของบทบาทนั้น
--
-- การแยกข้อมูลทดสอบ (ตามกติกา 5 ข้อของโหมดทดสอบใน README)
--   1) ทุกตารางข้อมูลมี is_test ที่ trigger private.factory_sandbox_scope กำหนดจากโหมดของผู้ทำรายการ
--      (ไม่รับจาก client) และห้ามแก้/ลบแถวข้ามโหมด (SANDBOX_SCOPE_MISMATCH)
--      foreign key แบบคู่ (id, is_test) ทำให้แถวทดสอบอ้างแถวจริงไม่ได้และกลับกัน ที่ระดับฐานข้อมูล
--   2) ผู้ทำรายการมาจาก private.sandbox_persona() ผ่าน private.factory_actor
--   3) ไม่มีเลขที่เอกสารที่ระบบออกเอง (รหัส Item ผู้ใช้กรอก) รหัสไม่ซ้ำแยกตามโหมด unique (is_test, code)
--   4) โมดูลนี้ไม่ส่งแจ้งเตือน
--   5) ใช้ persona ชุดเดิม (SBX-*) และมี pgTAP ทั้งอนุญาต/ปฏิเสธที่ factory_item_master.test.sql
--
-- สิทธิ์: ทุกตารางปิด RLS แบบ deny-all และถอนสิทธิ์ anon/authenticated ทั้งหมด อ่าน/เขียนผ่าน RPC
-- security definer (search_path ว่าง) ที่ตรวจผู้ทำรายการเท่านั้น การแก้ Item ใช้ version กันบันทึกทับ
-- (select ... for update + เทียบ version ในธุรกรรมเดียวกับการเขียนประวัติ) และบันทึก audit_logs ทุกครั้ง
--
-- Rollback (ไม่มีข้อมูลจริงในตารางเหล่านี้เพราะเขียนได้เฉพาะโหมดทดสอบ):
--   drop function public.app_factory_master_data(), public.app_factory_save_item(...),
--   public.app_sandbox_seed_factory(), public.app_sandbox_purge_factory(), private.factory_actor(),
--   private.factory_sandbox_scope(); drop table factory_* ตามลำดับลูกก่อนแม่; แล้ว create or replace
--   private.sandbox_unguarded_tables() ด้วยนิยามเดิมจาก 20261005090715_ncr_loss_outcomes_dashboard.sql
-- ============================================================================

-- 1. ข้อมูลอ้างอิงร่วม (ไม่แยกโหมด ไม่มีการเขียนจากแอป) -----------------------------
create table public.factory_units (
  code text primary key check (code ~ '^[A-Z]{1,10}$'),
  name_th text not null check (char_length(name_th) between 1 and 60),
  sort_order integer not null default 0
);
comment on table public.factory_units is 'หน่วยนับฐานของ Item ฝ่ายโรงงาน (ข้อมูลอ้างอิงร่วม อ่านผ่าน app_factory_master_data)';

create table public.factory_categories (
  code text primary key check (code ~ '^[a-z_]{2,30}$'),
  name_th text not null check (char_length(name_th) between 1 and 80),
  sort_order integer not null default 0
);
comment on table public.factory_categories is 'หมวดหมู่ Item ฝ่ายโรงงาน (ข้อมูลอ้างอิงร่วม อ่านผ่าน app_factory_master_data)';

insert into public.factory_units (code, name_th, sort_order) values
  ('KG', 'กิโลกรัม', 10),
  ('PCS', 'ชิ้น', 20),
  ('SET', 'ชุด', 30),
  ('SHEET', 'แผ่น', 40)
on conflict (code) do nothing;

insert into public.factory_categories (code, name_th, sort_order) values
  ('rubber', 'ยางธรรมชาติ', 10),
  ('polymer', 'พอลิเมอร์', 20),
  ('chemical', 'สารเคมีและสี', 30),
  ('compound', 'ยางคอมพาวด์', 40),
  ('foam', 'โฟมกึ่งสำเร็จรูป', 50),
  ('mat', 'แผ่นยาง', 60),
  ('toy', 'ของเล่นโฟม', 70),
  ('industrial', 'ชิ้นส่วนอุตสาหกรรม', 80),
  ('packaging', 'บรรจุภัณฑ์', 90)
on conflict (code) do nothing;

-- 2. ตารางข้อมูล (แยกโหมดด้วย is_test) ------------------------------------------
create table public.factory_items (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
  name text not null check (char_length(name) between 1 and 160 and name = btrim(name)),
  name_en text not null default '' check (char_length(name_en) <= 160),
  item_type text not null check (item_type in ('RM', 'WIP', 'FG', 'PKG')),
  category_code text not null references public.factory_categories(code),
  brand text not null check (brand in ('MNP', 'SAFSOF')),
  unit_code text not null references public.factory_units(code),
  procurement text not null check (procurement in ('buy', 'make', 'both')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  lot_tracking boolean not null default true,
  min_stock numeric(18, 3) not null default 0 check (min_stock >= 0 and min_stock <= 1000000000),
  specification text not null default '' check (char_length(specification) <= 3000),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (is_test, code)
);
create index factory_items_type_status_idx on public.factory_items(is_test, item_type, status);
comment on table public.factory_items is
  'ทะเบียน Item ฝ่ายโรงงาน: id ถาวร, code ไม่ซ้ำในโหมดเดียวกัน, version กันบันทึกทับ, ไม่ลบ (ใช้ status)';
comment on column public.factory_items.is_test is 'แถวโหมดทดสอบ: trigger กำหนดจากโหมดผู้ทำรายการ ไม่รับจาก client';

create table public.factory_item_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  item_id uuid not null,
  from_unit text not null references public.factory_units(code),
  to_unit text not null references public.factory_units(code),
  factor numeric(18, 6) not null check (factor > 0),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  check (from_unit <> to_unit),
  unique (item_id, from_unit, to_unit)
);
comment on table public.factory_item_unit_conversions is 'อัตราแปลงหน่วยเฉพาะ Item (โครงสร้างไว้ก่อน ยังไม่ใช้คำนวณ)';

create table public.factory_work_centers (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name text not null check (char_length(name) between 1 and 120),
  unique (id, is_test),
  unique (is_test, code)
);

create table public.factory_warehouses (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  name text not null check (char_length(name) between 1 and 120),
  unique (id, is_test),
  unique (is_test, code)
);

create table public.factory_boms (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  item_id uuid not null,
  revision text not null check (revision ~ '^[A-Z0-9]{1,10}$'),
  output_qty numeric(18, 4) not null check (output_qty > 0),
  status text not null default 'draft' check (status in ('draft', 'approved', 'obsolete')),
  effective_date date not null,
  created_at timestamptz not null default now(),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  unique (id, is_test),
  unique (item_id, revision)
);
comment on table public.factory_boms is 'หัวสูตรการผลิต (โครงสร้างสินค้า) ต่อ Item และ Revision';

create table public.factory_bom_lines (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  bom_id uuid not null,
  line_no integer not null check (line_no > 0),
  component_id uuid not null,
  quantity numeric(18, 4) not null check (quantity > 0),
  scrap_percent numeric(5, 2) not null default 0 check (scrap_percent >= 0 and scrap_percent < 100),
  foreign key (bom_id, is_test) references public.factory_boms(id, is_test),
  foreign key (component_id, is_test) references public.factory_items(id, is_test),
  unique (bom_id, line_no),
  unique (bom_id, component_id)
);
comment on table public.factory_bom_lines is 'ส่วนประกอบของสูตร: ปริมาณต่อปริมาณผลผลิตของหัวสูตร และ % เผื่อสูญเสียแบบบวกเพิ่ม';

create table public.factory_routings (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  item_id uuid not null,
  revision text not null check (revision ~ '^[A-Z0-9]{1,10}$'),
  status text not null default 'draft' check (status in ('draft', 'approved', 'obsolete')),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  unique (id, is_test),
  unique (item_id, revision)
);

create table public.factory_routing_steps (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  routing_id uuid not null,
  sequence integer not null check (sequence > 0),
  name text not null check (char_length(name) between 1 and 120),
  work_center_id uuid not null,
  setup_minutes numeric(10, 2) not null default 0 check (setup_minutes >= 0),
  run_minutes numeric(10, 2) not null default 0 check (run_minutes >= 0),
  instruction text not null default '' check (char_length(instruction) <= 1000),
  foreign key (routing_id, is_test) references public.factory_routings(id, is_test),
  foreign key (work_center_id, is_test) references public.factory_work_centers(id, is_test),
  unique (routing_id, sequence)
);

create table public.factory_lots (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  item_id uuid not null,
  lot_number text not null check (lot_number ~ '^[A-Z0-9_-]{1,40}$'),
  received_date date not null,
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  unique (id, is_test),
  unique (item_id, lot_number)
);

create table public.factory_production_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z0-9_-]{2,40}$'),
  item_id uuid not null,
  bom_id uuid not null,
  routing_id uuid not null,
  planned_qty numeric(18, 4) not null check (planned_qty > 0),
  completed_qty numeric(18, 4) not null default 0,
  status text not null default 'planned' check (status in ('planned', 'released', 'in_progress', 'completed', 'cancelled')),
  due_date date not null,
  created_at timestamptz not null default now(),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  foreign key (bom_id, is_test) references public.factory_boms(id, is_test),
  foreign key (routing_id, is_test) references public.factory_routings(id, is_test),
  check (completed_qty >= 0 and completed_qty <= planned_qty),
  unique (id, is_test),
  unique (is_test, code)
);
comment on table public.factory_production_orders is 'ใบสั่งผลิต: ผูก Item กับ BOM และ Routing revision ที่ใช้';

create table public.factory_inventory_movements (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  item_id uuid not null,
  warehouse_id uuid not null,
  lot_id uuid,
  quantity numeric(18, 4) not null check (quantity <> 0),
  kind text not null check (kind in ('opening', 'receipt', 'issue', 'transfer_in', 'transfer_out',
                                     'adjustment', 'production_output', 'production_issue')),
  reference text not null check (char_length(reference) between 1 and 200),
  production_order_id uuid,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (item_id, is_test) references public.factory_items(id, is_test),
  foreign key (warehouse_id, is_test) references public.factory_warehouses(id, is_test),
  foreign key (lot_id, is_test) references public.factory_lots(id, is_test),
  foreign key (production_order_id, is_test) references public.factory_production_orders(id, is_test)
);
create index factory_inventory_movements_item_idx on public.factory_inventory_movements(item_id, warehouse_id);
comment on table public.factory_inventory_movements is 'บัญชีเคลื่อนไหวคลังแบบมีเครื่องหมาย ยอดคงเหลือ = SUM(quantity)';

create table public.factory_item_history (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  item_id uuid not null,
  action text not null check (action in ('create', 'update')),
  version integer not null check (version >= 1),
  before_data jsonb,
  after_data jsonb not null,
  changed_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (item_id, is_test) references public.factory_items(id, is_test)
);
create index factory_item_history_item_idx on public.factory_item_history(item_id, created_at desc);
comment on table public.factory_item_history is 'ประวัติเพิ่ม/แก้ไข Item พร้อม snapshot ก่อน/หลัง เขียนในธุรกรรมเดียวกับการบันทึก Item';

-- 3. แยกโหมด: is_test มาจากโหมดของผู้ทำรายการ ห้ามแก้/ลบข้ามโหมด -----------------
-- เหมือน private.ncr_reports_sandbox_scope (20261005030000) แต่ใช้กับทุกตาราง factory_*
create or replace function private.factory_sandbox_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.is_test := (private.sandbox_persona()).id is not null;
    end if;
    return new;
  end if;
  if not private.sandbox_scope_matches(old.is_test)
     or (tg_op = 'UPDATE' and auth.uid() is not null and new.is_test is distinct from old.is_test) then
    raise exception 'SANDBOX_SCOPE_MISMATCH';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.factory_sandbox_scope() from public, anon, authenticated;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'factory_items', 'factory_item_unit_conversions', 'factory_work_centers', 'factory_warehouses',
    'factory_boms', 'factory_bom_lines', 'factory_routings', 'factory_routing_steps', 'factory_lots',
    'factory_production_orders', 'factory_inventory_movements', 'factory_item_history'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.factory_sandbox_scope()', v_table || '_sandbox_scope', v_table);
  end loop;
end $$;

-- 4. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น ------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'factory_units', 'factory_categories',
    'factory_items', 'factory_item_unit_conversions', 'factory_work_centers', 'factory_warehouses',
    'factory_boms', 'factory_bom_lines', 'factory_routings', 'factory_routing_steps', 'factory_lots',
    'factory_production_orders', 'factory_inventory_movements', 'factory_item_history'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;
revoke all on sequence public.factory_item_history_id_seq from anon, authenticated;

-- ตารางข้อมูลรู้จักโหมดทดสอบแล้ว (คัดลอกรายการเดิมจาก 20261005090715 ทุกชื่อ แล้วเพิ่ม factory_*)
-- ตารางอ้างอิงร่วม factory_units / factory_categories ไม่เขียนในโหมดทดสอบ จึงใส่ด่าน sandbox_guard แทน
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'factory_items','factory_item_unit_conversions','factory_work_centers','factory_warehouses',
    'factory_boms','factory_bom_lines','factory_routings','factory_routing_steps','factory_lots',
    'factory_production_orders','factory_inventory_movements','factory_item_history']
$$;
select private.sandbox_guard_table('public.factory_units');
select private.sandbox_guard_table('public.factory_categories');

-- 5. ผู้ทำรายการ: เปิดเฉพาะโหมดทดสอบ ----------------------------------------------
create or replace function private.factory_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_persona public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- sandbox_persona ตรวจทุกครั้งว่ายังเป็น admin ที่ active และอยู่ในโหมดทดสอบจริง
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'FACTORY_TEST_MODE_ONLY';
  end if;
  return v_persona;
end;
$$;
revoke all on function private.factory_actor() from public, anon, authenticated;

-- 6. อ่านข้อมูลทั้งหมดของโมดูล (ชุดเดียว เหมือน GET /api/data ของแอปเดิม) -------------
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
          'revision', b.revision, 'output_qty', b.output_qty, 'status', b.status, 'effective_date', b.effective_date
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
          'id', p.id, 'code', p.code, 'item_id', p.item_id, 'name', i.name, 'unit_code', i.unit_code,
          'bom_id', p.bom_id, 'routing_id', p.routing_id, 'planned_qty', p.planned_qty,
          'completed_qty', p.completed_qty, 'status', p.status, 'due_date', p.due_date
        ) order by p.code)
      from public.factory_production_orders p join public.factory_items i on i.id = p.item_id
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
      ) h), '[]'::jsonb)
  );
end;
$$;

-- 7. เพิ่ม/แก้ไข Item ---------------------------------------------------------------
-- p_id ว่าง = เพิ่มใหม่, มีค่า = แก้ไข (ต้องส่ง p_version ที่เปิดฟอร์มมา)
-- ประเภท หน่วยนับฐาน และการติดตามล็อตล็อกหลังสร้าง (เปลี่ยนต้องทำกระบวนการแปลงข้อมูลแยก)
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

  if p_id is null then
    if exists (select 1 from public.factory_items where is_test = v_test and code = v_code) then
      raise exception 'ITEM_CODE_TAKEN';
    end if;
    insert into public.factory_items (code, name, name_en, item_type, category_code, brand, unit_code, procurement,
                                      status, lot_tracking, min_stock, specification, created_by, updated_by)
    values (v_code, v_name, v_name_en, p_item_type, p_category_code, p_brand, p_unit_code, p_procurement,
            p_status, p_lot_tracking, p_min_stock, v_spec, v_actor.id, v_actor.id)
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

-- 8. ข้อมูลตัวอย่างในโหมดทดสอบ (ปุ่ม "เติมข้อมูลตัวอย่าง") --------------------------
-- ข้อมูลสมมติทั้งหมดจากแอปตัวอย่างที่ผู้ใช้ส่งมา (16 Item, 3 คลัง, 5 ศูนย์งาน, BOM/Routing 3 ชุด,
-- ใบสั่งผลิต 2 ใบ, ยอดยกมา) ชื่อ ขนาด สูตร และเวลาผลิตไม่ใช่ข้อมูลจริง ใช้สาธิตเท่านั้น
-- เติมได้เฉพาะในโหมดทดสอบ (ทุกแถวเป็น is_test) และเติมครั้งเดียว: ถ้ามี Item ทดสอบอยู่แล้วจะไม่แตะอะไร
create or replace function public.app_sandbox_seed_factory()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_items integer;
begin
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;
  if exists (select 1 from public.factory_items where is_test) then
    return jsonb_build_object('seeded', false, 'items', (select count(*) from public.factory_items where is_test));
  end if;

  insert into public.factory_work_centers (code, name) values
    ('MIX', 'ห้องผสม'), ('PRESS', 'ขึ้นรูป'), ('CUT', 'ตัดแต่ง'), ('QC', 'ตรวจคุณภาพ'), ('PACK', 'บรรจุ');
  insert into public.factory_warehouses (code, name) values
    ('RM', 'คลังวัตถุดิบ'), ('WIP', 'คลังระหว่างผลิต'), ('FG', 'คลังสินค้าสำเร็จรูป');

  insert into public.factory_items (code, name, name_en, item_type, category_code, brand, unit_code, procurement,
                                    lot_tracking, min_stock, specification, status, created_by, updated_by)
  select v.code, v.name, v.name_en, v.item_type, v.category_code, v.brand, v.unit_code, v.procurement,
         v.lot_tracking, v.min_stock, v.specification, v.status, v_persona.id, v_persona.id
  from (values
    ('RM-NR-001', 'ยางธรรมชาติ STR 20', 'Natural rubber STR 20', 'RM', 'rubber', 'MNP', 'KG', 'buy', true, 500, 'เกรด STR 20 • บรรจุ 35 กก./ก้อน', 'active'),
    ('RM-EVA-001', 'เม็ดพลาสติก EVA', 'EVA resin', 'RM', 'polymer', 'SAFSOF', 'KG', 'buy', true, 300, 'ตัวอย่างวัตถุดิบสำหรับผลิตโฟม', 'active'),
    ('RM-CB-001', 'คาร์บอนแบล็ก N330', 'Carbon black N330', 'RM', 'chemical', 'MNP', 'KG', 'buy', true, 150, 'สารเสริมแรงสำหรับยางคอมพาวด์', 'active'),
    ('RM-SUL-001', 'กำมะถันชนิดผง', 'Sulfur powder', 'RM', 'chemical', 'MNP', 'KG', 'buy', true, 50, 'ตัวอย่างสารคงรูป', 'active'),
    ('RM-PIG-001', 'สีมาสเตอร์แบตช์ สีน้ำเงิน', 'Blue masterbatch', 'RM', 'chemical', 'SAFSOF', 'KG', 'buy', true, 30, 'รหัสสีตัวอย่าง BL-01', 'active'),
    ('RM-OIL-001', 'น้ำมันพาราฟิน', 'Paraffinic oil', 'RM', 'chemical', 'MNP', 'KG', 'buy', true, 100, 'ตัวอย่างสารช่วยในกระบวนการผลิต', 'active'),
    ('WIP-CMP-001', 'ยางคอมพาวด์ สีดำ', 'Black rubber compound', 'WIP', 'compound', 'MNP', 'KG', 'make', true, 200, 'สูตรตัวอย่าง CMP-BK • ไม่ใช่สูตรผลิตจริง', 'active'),
    ('WIP-FOAM-001', 'แผ่นโฟม EVA สีน้ำเงิน', 'Blue EVA foam sheet', 'WIP', 'foam', 'SAFSOF', 'SHEET', 'make', true, 100, 'ขนาดตัวอย่าง 1 × 1 ม. หนา 10 มม.', 'active'),
    ('FG-MAT-001', 'แผ่นยางกันลื่น ลายเหรียญ', 'Anti-slip rubber mat', 'FG', 'mat', 'MNP', 'PCS', 'make', true, 50, 'ขนาดตัวอย่าง 50 × 50 ซม.', 'active'),
    ('FG-SAF-001', 'SAFSOF ลูกบอลโฟม 70 มม.', 'SAFSOF soft foam ball 70 mm', 'FG', 'toy', 'SAFSOF', 'PCS', 'make', true, 200, 'สีน้ำเงิน • ขนาดและวัสดุสมมติสำหรับสาธิต', 'active'),
    ('FG-SAF-002', 'SAFSOF ชุดบล็อกโฟม 12 ชิ้น', 'SAFSOF foam blocks 12 pcs', 'FG', 'toy', 'SAFSOF', 'SET', 'make', true, 80, 'ชุดตัวอย่าง 12 ชิ้น • ข้อมูลสาธิต', 'active'),
    ('FG-SEAL-001', 'ซีลยางวงแหวน 50 มม.', 'Rubber ring seal 50 mm', 'FG', 'industrial', 'MNP', 'PCS', 'make', true, 500, 'ขนาดตัวอย่าง OD 50 มม.', 'active'),
    ('PKG-BOX-001', 'กล่องลูกฟูก SAFSOF', 'SAFSOF corrugated box', 'PKG', 'packaging', 'SAFSOF', 'PCS', 'buy', false, 300, 'กล่องสำหรับบรรจุสินค้าตัวอย่าง', 'active'),
    ('PKG-BAG-001', 'ถุงใสสำหรับลูกบอลโฟม', 'Clear ball bag', 'PKG', 'packaging', 'SAFSOF', 'PCS', 'buy', false, 500, 'บรรจุ 1 ชิ้น/ถุง', 'active'),
    ('PKG-LBL-001', 'ฉลากสินค้า SAFSOF', 'SAFSOF product label', 'PKG', 'packaging', 'SAFSOF', 'PCS', 'buy', false, 500, 'ฉลากตัวอย่าง', 'active'),
    ('RM-EVA-OLD', 'เม็ด EVA เกรดเดิม', 'Legacy EVA grade', 'RM', 'polymer', 'SAFSOF', 'KG', 'buy', true, 0, 'หยุดใช้งานในตัวอย่าง', 'inactive')
  ) as v(code, name, name_en, item_type, category_code, brand, unit_code, procurement, lot_tracking, min_stock, specification, status);
  get diagnostics v_items = row_count;

  insert into public.factory_boms (item_id, revision, output_qty, status, effective_date)
  select i.id, 'A', v.output_qty, 'draft', date '2026-10-01'
  from (values ('WIP-CMP-001', 100), ('FG-MAT-001', 1), ('FG-SAF-001', 100)) as v(code, output_qty)
  join public.factory_items i on i.is_test and i.code = v.code;

  insert into public.factory_bom_lines (bom_id, line_no, component_id, quantity, scrap_percent)
  select b.id, v.line_no, c.id, v.quantity, v.scrap_percent
  from (values
    ('WIP-CMP-001', 1, 'RM-NR-001', 70, 2), ('WIP-CMP-001', 2, 'RM-CB-001', 25, 0),
    ('WIP-CMP-001', 3, 'RM-SUL-001', 2, 0), ('WIP-CMP-001', 4, 'RM-OIL-001', 3, 0),
    ('FG-MAT-001', 1, 'WIP-CMP-001', 1.2, 3),
    ('FG-SAF-001', 1, 'RM-EVA-001', 3, 2), ('FG-SAF-001', 2, 'RM-PIG-001', 0.06, 0),
    ('FG-SAF-001', 3, 'PKG-BAG-001', 100, 1), ('FG-SAF-001', 4, 'PKG-LBL-001', 100, 0)
  ) as v(parent_code, line_no, component_code, quantity, scrap_percent)
  join public.factory_items p on p.is_test and p.code = v.parent_code
  join public.factory_boms b on b.item_id = p.id and b.revision = 'A'
  join public.factory_items c on c.is_test and c.code = v.component_code;

  insert into public.factory_routings (item_id, revision, status)
  select i.id, 'A', 'draft'
  from public.factory_items i
  where i.is_test and i.code in ('WIP-CMP-001', 'FG-MAT-001', 'FG-SAF-001');

  insert into public.factory_routing_steps (routing_id, sequence, name, work_center_id, setup_minutes, run_minutes, instruction)
  select r.id, v.step_no * 10, v.step_name, w.id,
         case when v.step_no = 1 then 15 else 5 end,
         case when v.center = 'PRESS' then 30 else 10 end,
         'เวลาตัวอย่างต่อชุดผลิต ต้องยืนยันกับหน้างาน'
  from (values
    ('WIP-CMP-001', 1, 'MIX', 'ผสมวัตถุดิบ'), ('WIP-CMP-001', 2, 'QC', 'ตรวจคุณภาพ'),
    ('FG-MAT-001', 1, 'PRESS', 'ขึ้นรูป'), ('FG-MAT-001', 2, 'CUT', 'ตัดแต่ง'),
    ('FG-MAT-001', 3, 'QC', 'ตรวจคุณภาพ'), ('FG-MAT-001', 4, 'PACK', 'บรรจุ'),
    ('FG-SAF-001', 1, 'MIX', 'ผสมวัตถุดิบ'), ('FG-SAF-001', 2, 'PRESS', 'ขึ้นรูป'),
    ('FG-SAF-001', 3, 'CUT', 'ตัดแต่ง'), ('FG-SAF-001', 4, 'QC', 'ตรวจคุณภาพ'),
    ('FG-SAF-001', 5, 'PACK', 'บรรจุ')
  ) as v(item_code, step_no, center, step_name)
  join public.factory_items i on i.is_test and i.code = v.item_code
  join public.factory_routings r on r.item_id = i.id and r.revision = 'A'
  join public.factory_work_centers w on w.is_test and w.code = v.center;

  insert into public.factory_production_orders (code, item_id, bom_id, routing_id, planned_qty, completed_qty, status, due_date)
  select v.code, i.id, b.id, r.id, v.planned_qty, v.completed_qty, v.status, v.due_date
  from (values
    ('MO-2610-001', 'FG-SAF-001', 1000, 650, 'in_progress', date '2026-10-09'),
    ('MO-2610-002', 'FG-MAT-001', 200, 0, 'planned', date '2026-10-12')
  ) as v(code, item_code, planned_qty, completed_qty, status, due_date)
  join public.factory_items i on i.is_test and i.code = v.item_code
  join public.factory_boms b on b.item_id = i.id and b.revision = 'A'
  join public.factory_routings r on r.item_id = i.id and r.revision = 'A';

  -- ยอดยกมา: Item ที่ติดตามล็อตได้ล็อตละ 1 ใบ คลังตามประเภท (FG/WIP/อื่น = RM)
  insert into public.factory_lots (item_id, lot_number, received_date)
  select i.id, 'LOT-2610-' || lpad(v.seq::text, 3, '0'), date '2026-10-01'
  from (values
    ('RM-NR-001', 1), ('RM-EVA-001', 2), ('RM-CB-001', 3), ('RM-SUL-001', 4), ('RM-PIG-001', 5),
    ('RM-OIL-001', 6), ('WIP-CMP-001', 7), ('WIP-FOAM-001', 8), ('FG-MAT-001', 9), ('FG-SAF-001', 10),
    ('FG-SAF-002', 11), ('FG-SEAL-001', 12)
  ) as v(code, seq)
  join public.factory_items i on i.is_test and i.code = v.code;

  insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, created_by)
  select i.id, w.id, l.id, v.quantity, 'opening', 'ยอดยกมาตัวอย่าง', v_persona.id
  from (values
    ('RM-NR-001', 1200), ('RM-EVA-001', 240), ('RM-CB-001', 380), ('RM-SUL-001', 85), ('RM-PIG-001', 18),
    ('RM-OIL-001', 220), ('WIP-CMP-001', 450), ('WIP-FOAM-001', 160), ('FG-MAT-001', 120), ('FG-SAF-001', 650),
    ('FG-SAF-002', 45), ('FG-SEAL-001', 850), ('PKG-BOX-001', 620), ('PKG-BAG-001', 1800), ('PKG-LBL-001', 2400)
  ) as v(code, quantity)
  join public.factory_items i on i.is_test and i.code = v.code
  join public.factory_warehouses w on w.is_test
       and w.code = case i.item_type when 'FG' then 'FG' when 'WIP' then 'WIP' else 'RM' end
  left join public.factory_lots l on l.item_id = i.id and i.lot_tracking;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_SEED_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('items', v_items, 'persona_employee_no', v_persona.employee_no));
  return jsonb_build_object('seeded', true, 'items', v_items);
end;
$$;

-- 9. ล้างข้อมูลทดสอบของฝ่ายโรงงาน (ลบลูกก่อนแม่ เฉพาะแถว is_test) ------------------
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

  delete from public.factory_inventory_movements where is_test;
  delete from public.factory_lots where is_test;
  delete from public.factory_production_orders where is_test;
  delete from public.factory_routing_steps where is_test;
  delete from public.factory_routings where is_test;
  delete from public.factory_bom_lines where is_test;
  delete from public.factory_boms where is_test;
  delete from public.factory_item_unit_conversions where is_test;
  delete from public.factory_item_history where is_test;
  delete from public.factory_items where is_test;
  get diagnostics v_items = row_count;
  delete from public.factory_work_centers where is_test;
  delete from public.factory_warehouses where is_test;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_PURGE_FACTORY', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('deleted_items', v_items));
  return jsonb_build_object('deleted', v_items);
end;
$$;

revoke all on function public.app_factory_master_data() from public, anon;
revoke all on function public.app_factory_save_item(uuid, integer, text, text, text, text, text, text, text, text, text, boolean, numeric, text) from public, anon;
revoke all on function public.app_sandbox_seed_factory() from public, anon;
revoke all on function public.app_sandbox_purge_factory() from public, anon;
grant execute on function public.app_factory_master_data() to authenticated;
grant execute on function public.app_factory_save_item(uuid, integer, text, text, text, text, text, text, text, text, text, boolean, numeric, text) to authenticated;
grant execute on function public.app_sandbox_seed_factory() to authenticated;
grant execute on function public.app_sandbox_purge_factory() to authenticated;
