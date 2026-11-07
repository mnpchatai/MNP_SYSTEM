-- ============================================================================
-- จัดซื้อเคมีของ RubberFlow (PR 1 จาก 2): ใบสั่งซื้อวัตถุดิบ + จุดสั่งซื้อ (safety stock) + อายุเก็บ (shelf life) ของวัตถุดิบ
-- ต่อยอดกลไกเดียวกับ 20261107010000_rubberflow_core.sql / 20261108010000_rubberflow_shopfloor.sql ทุกประการ (ตัวนับ rf_master_state เดียวกัน, changed_version รายระเบียนประทับโดย trigger,
-- RF_STALE ก่อนตรวจสิทธิ์/เนื้อหาเสมอ, delta {upsert, delete}, audit ผ่าน app_rf_audit, ล้างข้อมูลทดสอบผ่าน app_sandbox_purge_rf) · โหมดทดสอบเท่านั้น
-- PR 2 (ภายหลัง) จะเพิ่มสต็อก/การเบิกชิ้นส่วนจัดซื้อของ BOM ในหน้าต่างเดียวกัน จึงตั้งชื่อแบบกลาง ๆ (ใบสั่งซื้อ + บรรทัด) ให้ต่อรูปเดิมได้
--
-- ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test): rf_purchase_orders
--   trigger rf_sandbox_scope (is_test) + rf_stamp_version (changed_version) + RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only (private.lab_only_guard_table)
--   + ลงทะเบียนใน private.sandbox_unguarded_tables() · lines เป็น jsonb (1-100 บรรทัด วัตถุดิบไม่ซ้ำ qtyKg > 0) จึงไม่มี foreign key (ล้างข้อมูลทดสอบลบใบสั่งซื้อก่อนวัตถุดิบ)
-- คอลัมน์ใหม่ของ rf_materials: safety_kg (สต็อกสำรองขั้นต่ำ 0..1e9 เริ่ม 0) · shelf_life_days (อายุเก็บเป็นวัน 1..3650 เริ่ม 180) · ADD COLUMN ด้วยค่าเริ่มต้นคงที่
--   ไม่เรียก trigger รายแถว จึงไม่ประทับ changed_version ของวัตถุดิบเดิม (client ที่ไม่มีช่องนี้ใช้ค่าเริ่มต้นเดียวกัน)
--
-- รูปเรคอร์ดที่ส่ง/รับ (ชุดที่ 12 ชื่อ purchaseOrders ใน app_rf_master / app_rf_master_since / คำตอบของ app_rf_save):
--   { id (= po_no, PO-yyyymmdd-nn), status (ordered | received | cancelled), sourcePi, sourceRequisition (ข้อความหรือ null), note, createdAt, createdBy, cancelledAt (ms หรือ null),
--     lines: [{ materialCode, needKg, availableKg, shortageKg, safetyKg, qtyKg, receivedKg, lotNo, expiry, receivedAt, receivedBy }] }
--   ช่องรับเข้าของบรรทัดที่ยังไม่รับ (receivedKg lotNo expiry receivedAt receivedBy) เป็น null ทั้งหมด · materials เพิ่มช่อง safetyKg และ shelfLifeDays
--
-- p_action เพิ่ม: createPurchaseOrder receivePurchaseLine cancelPurchaseOrder issueRequisition · saveMaterial รับ safetyKg / shelfLifeDays ได้ (ไม่ส่ง = คงค่าเดิม)
--   ชุดที่ส่งได้ต่อ action: createPurchaseOrder = purchaseOrders + materials · receivePurchaseLine = purchaseOrders + materialLots · cancelPurchaseOrder = purchaseOrders
--   และชุด purchaseOrders ส่งได้เฉพาะสามคำสั่งนี้ (ผิด = RF_INVALID_PURCHASE)
--
-- สิทธิ์ (ตัวบังคับจริงคือ RPC; หน้าเว็บซ่อนปุ่มอย่างเดียว):
--   สร้างใบ     กลุ่มวางแผน (private.bom_can_edit) หรือสมาชิก RB (ใบจากส่วนที่ขาดของใบเบิก) · ใบใหม่ต้อง ordered ไม่มีข้อมูลรับเข้า วัตถุดิบต้องมีอยู่และ active
--               เลขใบซ้ำ = RF_CONFLICT (หรือ RF_STALE ถ้าใบเดิมเปลี่ยนหลังเวอร์ชันฐาน) เหมือนเอกสารอื่น
--   รับเข้า     ST หรือกลุ่มวางแผน · เปลี่ยนบรรทัดเดียวจากยังไม่รับเป็นรับแล้ว (receivedKg > 0 <= 1e9, expiry > เวลารับ) และต้องมาพร้อมล็อตวัตถุดิบใหม่หนึ่งแถวในคำสั่งเดียวกัน
--               ที่ materialCode / qtyKg / initialKg / expiry ตรงกับบรรทัด และเลขล็อตเท่ากับ lotNo ของบรรทัด (ล็อตสร้างโดยตัวเขียน materialLots เดิม กฎเดียวกับ receiveMaterial)
--               เซิร์ฟเวอร์ตั้ง receivedAt / receivedBy ของบรรทัด (ล็อตใช้เวลา/ผู้รับของเซิร์ฟเวอร์) และตั้งสถานะใบเป็น received เมื่อรับครบทุกบรรทัด (ไม่ต้องอนุมัติ)
--   ยกเลิก      กลุ่มวางแผน ยกเลิกได้เมื่อใบ ordered และยังไม่มีบรรทัดไหนรับเข้า · เซิร์ฟเวอร์ตั้ง cancelledAt
--   อย่างอื่นของใบเดิม (แก้หมายเหตุ/จำนวน/บรรทัด ย้อนสถานะ รับซ้ำ รับใบที่ปิดแล้ว) = RF_INVALID_TRANSITION · รับเกินหนึ่งบรรทัดต่อคำสั่ง = RF_INVALID_PURCHASE
--   ผิดสิทธิ์ = RF_FORBIDDEN · ชนรายระเบียน = RF_STALE (ก่อนสิทธิ์/เนื้อหาเสมอ) · รูปข้อมูลผิด = RF_INVALID_PURCHASE (ข้อความตายตัว)
--   saveMaterial / createPurchaseOrder: ใบสั่งซื้อพ่วงแก้วัตถุดิบได้ช่องเดียวคือ safetyKg (วัตถุดิบต้องมีอยู่ ช่องอื่นต่างจากที่เก็บ = RF_INVALID_MATERIAL)
--
-- ใบเบิก (ผู้ใช้ขอ 2026-11-07): สร้างใบ = จ่ายทันที ไม่มีสถานีชั่งรายบรรทัด · createRequisition ให้เซิร์ฟเวอร์จัดสรร FEFO เองแล้วตั้ง actualKg = targetKg, weighedAt/weighedBy, หักสต็อกล็อต,
--   สถานะ issued, issued_at/by ในคำสั่งเดียว (ไม่มีเกณฑ์ชั่ง) · weighLine ยังใช้ได้กับใบเก่าที่ค้างสถานะ weighing · issueRequisition (ใหม่) จ่ายทุกบรรทัดที่ยังไม่ชั่งของใบ weighing
--   ที่ targetKg พอดีในคำสั่งเดียว (หักสต็อกเท่ากัน -> issued) · สิทธิ์: สมาชิก RB หรือกลุ่มวางแผน เหมือน weighLine · ชุดที่ส่งได้ไม่เปลี่ยน (requisitions + materialLots ที่ client คำนวณสำเนาไว้ เซิร์ฟเวอร์เมินค่า qty)
--
-- ลำดับการเขียนใน app_rf_save: ... molds -> purchaseOrders -> materialLots -> (ตรวจใบรับเข้า) -> requisitions ... ตัวเขียนใบสั่งซื้อทำก่อนตัวเขียนล็อต เพื่อให้ RF_STALE ของใบมาก่อนสิทธิ์
--   ของล็อต แล้ว private.rf_check_po_receipt ตรวจหลังตัวเขียนล็อตว่ามีล็อตที่เปลี่ยนในคำสั่งนี้เพียงแถวเดียวและตรงกับบรรทัดที่รับ (ไม่ตรง = ย้อนทั้งคำสั่ง)
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดทุกตัว)
--   - private.rf_save_materials: ลายเซ็นเดิม (uuid, jsonb, bigint, bigint) ถูก DROP แล้วสร้างใหม่เป็น (uuid, text, jsonb, bigint, bigint) (เพิ่ม p_action) จาก 20261107010000_rubberflow_core.sql
--   - private.rf_client_actions, private.sandbox_unguarded_tables, private.rf_records, private.rf_delta, public.app_rf_save  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.rf_save_requisitions: ลายเซ็นเดิม (uuid, text, boolean, jsonb, bigint, bigint) ถูก DROP แล้วสร้างใหม่เป็น (uuid, text, boolean, text, jsonb, bigint, bigint) (เพิ่ม p_action) จาก 20261108010000_rubberflow_shopfloor.sql
--   - public.app_sandbox_purge_rf  จาก 20261109010000_sandbox_purge_fast.sql (คงการพัก JWT claims ระหว่างลบ)
--   - ใหม่: private.rf_po_parse_lines, private.rf_save_purchase_orders, private.rf_check_po_receipt
--   - ไม่แตะ: app_rf_master / app_rf_master_since / app_rf_audit / rf_snapshot (คืนชุดที่ 12 ตามที่ rf_records / rf_delta คืน)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก RPC ที่เปลี่ยน (action ใหม่ ชุด purchaseOrders ช่องใหม่ของวัตถุดิบ) จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของฟังก์ชันที่ replace ข้างบน
--   ที่ production กับนิยามในไฟล์ต้นทาง (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test,
--   has_function_privilege (anon ไม่ได้ authenticated เฉพาะ RPC สาธารณะ), relrowsecurity + policy ของ rf_purchase_orders · Pilot Web รุ่นก่อนหน้ายังทำงานได้กับฐานข้อมูลนี้ (ชุด/ช่องใหม่ถูกเมิน)
--
-- Rollback (ตารางใหม่มีแต่ข้อมูลทดสอบ) ลำดับสำคัญ:
--   1) คืนนิยามเดิมของ public.app_rf_save, public.app_sandbox_purge_rf และ private.rf_records / rf_delta / rf_client_actions / sandbox_unguarded_tables ด้วยการรัน create or replace จาก
--      20261108010000_rubberflow_shopfloor.sql / 20261109010000_sandbox_purge_fast.sql (รวม revoke/grant ท้ายฟังก์ชัน)
--   2) drop function private.rf_save_materials(uuid, text, jsonb, bigint, bigint) แล้วสร้าง private.rf_save_materials(uuid, jsonb, bigint, bigint) ใหม่ตามนิยามใน 20261107010000_rubberflow_core.sql
--   3) drop function private.rf_po_parse_lines(jsonb), private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint), private.rf_check_po_receipt(uuid, jsonb, bigint)
--      และ drop function private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint) แล้วสร้าง private.rf_save_requisitions(uuid, text, boolean, jsonb, bigint, bigint) ใหม่ตามนิยามใน 20261108010000_rubberflow_shopfloor.sql
--      (ลำดับ: ทำข้อ 1 ก่อนเพื่อให้ app_rf_save เดิมเรียกลายเซ็นเดิม · ใบเบิกที่จ่ายทันทีแล้วอยู่ใน rf_requisitions ต่อเป็น issued ปกติ)
--   4) drop table public.rf_purchase_orders · alter table public.rf_materials drop column safety_kg, drop column shelf_life_days
--   ข้อมูลทดสอบของใบสั่งซื้อและค่าสต็อกสำรอง/อายุเก็บหายไปพร้อมกัน · ล็อตวัตถุดิบที่สร้างจากการรับเข้าแล้วอยู่ใน rf_material_lots ต่อ (ไม่ถูกย้อน)
-- ============================================================================

-- 1. คอลัมน์ใหม่ของวัตถุดิบ ------------------------------------------------------------------
alter table public.rf_materials
  add column safety_kg numeric not null default 0 check (safety_kg >= 0 and safety_kg <= 1000000000),
  add column shelf_life_days integer not null default 180 check (shelf_life_days between 1 and 3650);
comment on column public.rf_materials.safety_kg is 'สต็อกสำรองขั้นต่ำ (กก.) ใช้เป็นค่าเริ่มของจำนวนสั่งซื้อ แก้ได้ตอนสร้างใบสั่งซื้อ (createPurchaseOrder) หรือ saveMaterial';
comment on column public.rf_materials.shelf_life_days is 'อายุเก็บของวัตถุดิบ (วัน) ใช้ตั้งวันหมดอายุเริ่มต้นตอนรับเข้าจากใบสั่งซื้อ';

-- 2. ตารางใบสั่งซื้อ (แยกโหมดด้วย is_test) -----------------------------------------------------
create table public.rf_purchase_orders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  po_no text not null check (po_no ~ '^PO-[0-9]{8}-[0-9]{2,6}$'),
  status text not null default 'ordered' check (status in ('ordered', 'received', 'cancelled')),
  -- เลขใบ PI ของ BOM หรือเลขใบเบิกที่ทำให้สั่ง (ถ้ามี)
  source_pi text check (source_pi is null or char_length(source_pi) between 1 and 60),
  source_requisition text check (source_requisition is null or char_length(source_requisition) between 1 and 60),
  note text not null default '' check (char_length(note) <= 300),
  -- [{materialCode, needKg, availableKg, shortageKg, safetyKg, qtyKg, receivedKg, lotNo, expiry, receivedAt, receivedBy}] เซิร์ฟเวอร์สร้างรูปนี้เอง
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (po_no, is_test)
);
create index rf_purchase_orders_changed_idx on public.rf_purchase_orders (is_test, changed_version);
comment on table public.rf_purchase_orders is 'ใบสั่งซื้อวัตถุดิบเคมีของ RubberFlow ordered -> received (รับครบทุกบรรทัด) หรือ cancelled · ST รับเข้าทีละบรรทัดพร้อมสร้างล็อต · เซิร์ฟเวอร์เปลี่ยนสถานะเองทั้งหมด';
comment on column public.rf_purchase_orders.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (trigger rf_stamp_version ตั้งให้ ไม่รับจาก client) ใช้ตรวจชนรายระเบียนและคำนวณ delta';

-- 3. แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ใช้ rf_stamp_version() ของรอบที่ 1) ---------------------------
create trigger rf_purchase_orders_sandbox_scope before insert or update or delete on public.rf_purchase_orders
  for each row execute function private.sandbox_row_scope();
create trigger rf_purchase_orders_stamp_version before insert or update on public.rf_purchase_orders
  for each row execute function private.rf_stamp_version();
revoke all on public.rf_purchase_orders from anon, authenticated;
alter table public.rf_purchase_orders enable row level security;
create policy rf_purchase_orders_no_direct_access on public.rf_purchase_orders for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.rf_purchase_orders');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261108010000_rubberflow_shopfloor.sql ทุกชื่อ แล้วเพิ่ม rf_purchase_orders)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 4. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ชื่อ action ของ client ที่เขียนข้อมูลได้ (นิยามจาก 20261108010000_rubberflow_shopfloor.sql เพิ่มสามคำสั่งของใบสั่งซื้อ)
create or replace function private.rf_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveMaterial', 'createRecipe', 'saveRecipe', 'approveRecipe', 'createOrder', 'setOrderStatus',
    'recordMixing', 'recordExtrusion', 'recordCuring', 'recordFinishing', 'addQcRecord',
    'receiveMaterial', 'setMaterialLotStatus', 'createRequisition', 'weighLine', 'endRest',
    'createTransfer', 'receiveTransfer', 'shipBoxes', 'createNcr', 'updateNcr', 'closeNcr', 'cleanMold', 'saveMold',
    'createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'issueRequisition']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- วัตถุดิบ (กลุ่มวางแผนหรือสมาชิก RB ตรวจก่อนเรียก): เขียนซ้ำค่าเดิมทุกช่อง = ไม่ทำอะไร · ชนก่อนเนื้อหา/สิทธิ์
-- นิยามจาก 20261107010000_rubberflow_core.sql เพิ่ม safetyKg / shelfLifeDays (ไม่ส่ง = คงค่าเดิม ตอนสร้างใหม่ 0 / 180) และ p_action:
-- ใต้ createPurchaseOrder แก้ได้เฉพาะ safetyKg ของวัตถุดิบที่มีอยู่แล้ว (ช่องอื่นต่างจากที่เก็บ หรือไม่มีวัตถุดิบ = RF_INVALID_MATERIAL)
drop function if exists private.rf_save_materials(uuid, jsonb, bigint, bigint);
create or replace function private.rf_save_materials(p_actor uuid, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_code text;
  v_name text;
  v_category text;
  v_storage text;
  v_uom text;
  v_active boolean;
  v_safety numeric;
  v_shelf numeric;
  v_seen text[] := '{}';
  v_old public.rf_materials%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_code := private.bom_text(v_row, 'code', 40, 1, 'RF_INVALID_MATERIAL');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' or upper(v_code) = any (v_seen) then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_seen := v_seen || upper(v_code);
    v_name := private.bom_text(v_row, 'name', 160, 1, 'RF_INVALID_MATERIAL');
    v_category := private.bom_text(v_row, 'category', 60, 0, 'RF_INVALID_MATERIAL');
    v_storage := private.bom_text(v_row, 'storage', 160, 0, 'RF_INVALID_MATERIAL');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_MATERIAL'), ''), 'kg');
    v_node := v_row -> 'active';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_active := true;
    elsif jsonb_typeof(v_node) <> 'boolean' then
      raise exception 'RF_INVALID_MATERIAL';
    else
      v_active := (v_node #>> '{}')::boolean;
    end if;
    -- สต็อกสำรอง 0..1e9 และอายุเก็บเป็นวันเต็ม 1..3650 (ไม่ส่ง = null = คงค่าเดิม)
    v_safety := private.bom_num(v_row -> 'safetyKg', 'RF_INVALID_MATERIAL', 0, 1000000000);
    v_shelf := private.bom_num(v_row -> 'shelfLifeDays', 'RF_INVALID_MATERIAL', 1, 3650);
    if v_shelf is not null and v_shelf <> trunc(v_shelf) then raise exception 'RF_INVALID_MATERIAL'; end if;

    select * into v_old from public.rf_materials m where m.is_test and upper(m.code) = upper(v_code);
    if found then
      -- รหัสต่างกันแค่ตัวพิมพ์ = ซ้ำกับของเดิม (รหัสเป็นกุญแจ แก้ไม่ได้)
      if v_old.code <> v_code then raise exception 'RF_CONFLICT'; end if;
      if v_old.name = v_name and v_old.category = v_category and v_old.storage_location = v_storage
         and v_old.uom = v_uom and v_old.active = v_active
         and (v_safety is null or v_old.safety_kg = v_safety)
         and (v_shelf is null or v_old.shelf_life_days = v_shelf::integer) then
        continue;
      end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      -- ใบสั่งซื้อพ่วงมาแก้ได้ช่อง safetyKg ช่องเดียว
      if p_action = 'createPurchaseOrder'
         and (v_old.name <> v_name or v_old.category <> v_category or v_old.storage_location <> v_storage
              or v_old.uom <> v_uom or v_old.active <> v_active
              or (v_shelf is not null and v_old.shelf_life_days <> v_shelf::integer)) then
        raise exception 'RF_INVALID_MATERIAL';
      end if;
      update public.rf_materials set
        name = v_name, category = v_category, storage_location = v_storage, uom = v_uom, active = v_active,
        safety_kg = coalesce(v_safety, safety_kg), shelf_life_days = coalesce(v_shelf::integer, shelf_life_days),
        updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      -- ใบสั่งซื้อสร้างวัตถุดิบใหม่ไม่ได้
      if p_action = 'createPurchaseOrder' then raise exception 'RF_INVALID_MATERIAL'; end if;
      insert into public.rf_materials (is_test, code, name, category, storage_location, uom, active, safety_kg, shelf_life_days, created_by, updated_by)
      values (true, v_code, v_name, v_category, v_storage, v_uom, v_active, coalesce(v_safety, 0), coalesce(v_shelf::integer, 180), p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_materials(uuid, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. ตัวเขียนใบสั่งซื้อ (เรียกจาก app_rf_save เท่านั้น) ---------------------------------------------
-- ตรวจและแปลงบรรทัดของ client เป็นรูป canonical (ลำดับตามที่ส่งมา): 1-100 บรรทัด วัตถุดิบไม่ซ้ำ (ไม่แยกตัวพิมพ์) qtyKg > 0
-- ช่องรับเข้า receivedKg / lotNo / expiry ต้องมีครบทั้งสามหรือเป็น null ทั้งสาม (receivedAt / receivedBy ของ client เมินเสมอ เซิร์ฟเวอร์ตั้ง)
create or replace function private.rf_po_parse_lines(p_lines jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_line jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_qty numeric;
  v_recv numeric;
  v_lot text;
  v_exp numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception 'RF_INVALID_PURCHASE';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_code := private.bom_text(v_line, 'materialCode', 40, 1, 'RF_INVALID_PURCHASE');
    if upper(v_code) = any (v_seen) then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_seen := v_seen || upper(v_code);
    v_qty := private.bom_num(v_line -> 'qtyKg', 'RF_INVALID_PURCHASE', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_recv := private.bom_num(v_line -> 'receivedKg', 'RF_INVALID_PURCHASE', 0, 1000000000);
    v_lot := nullif(private.bom_text(v_line, 'lotNo', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_exp := private.bom_num(v_line -> 'expiry', 'RF_INVALID_PURCHASE', 1, 100000000000000);
    if v_recv is null then
      if v_lot is not null or v_exp is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
    elsif v_recv <= 0 or v_lot is null or v_lot !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_exp is null or v_exp <> trunc(v_exp) then
      raise exception 'RF_INVALID_PURCHASE';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'materialCode', v_code,
      'needKg', coalesce(private.bom_num(v_line -> 'needKg', 'RF_INVALID_PURCHASE', 0, 1000000000), 0),
      'availableKg', coalesce(private.bom_num(v_line -> 'availableKg', 'RF_INVALID_PURCHASE', -1000000000, 1000000000), 0),
      'shortageKg', coalesce(private.bom_num(v_line -> 'shortageKg', 'RF_INVALID_PURCHASE', 0, 1000000000), 0),
      'safetyKg', coalesce(private.bom_num(v_line -> 'safetyKg', 'RF_INVALID_PURCHASE', 0, 1000000000), 0),
      'qtyKg', v_qty,
      'receivedKg', v_recv,
      'lotNo', v_lot,
      'expiry', v_exp));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.rf_po_parse_lines(jsonb) from public, anon, authenticated;

-- ใบสั่งซื้อ: สร้างใหม่ (p_action = createPurchaseOrder) / รับเข้าหนึ่งบรรทัด (receivePurchaseLine) / ยกเลิก (cancelPurchaseOrder) กติกาดูหัวไฟล์
-- คืน { receipt } : null เมื่อไม่มีการรับเข้า ไม่เช่นนั้นข้อมูลล็อตที่ต้องเกิดในคำสั่งเดียวกัน ให้ private.rf_check_po_receipt ตรวจหลังตัวเขียนล็อตวัตถุดิบ
create or replace function private.rf_save_purchase_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rb boolean, p_st boolean,
  p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_status text;
  v_pi text;
  v_req text;
  v_note text;
  v_lines jsonb;
  v_old public.rf_purchase_orders%rowtype;
  v_mat public.rf_materials%rowtype;
  v_sl jsonb;
  v_nl jsonb;
  v_i integer;
  v_n integer;
  v_idx integer;
  v_recv_count integer;
  v_other boolean;
  v_final jsonb;
  v_receipt jsonb := null;
  v_ms bigint := private.bom_ms(now());
  v_kg numeric;
  v_exp numeric;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'RF_INVALID_PURCHASE');
    if v_no !~ '^PO-[0-9]{8}-[0-9]{2,6}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_seen := v_seen || v_no;
    v_status := coalesce(nullif(private.bom_text(v_row, 'status', 12, 0, 'RF_INVALID_PURCHASE'), ''), 'ordered');
    if v_status not in ('ordered', 'received', 'cancelled') then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_pi := nullif(private.bom_text(v_row, 'sourcePi', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_req := nullif(private.bom_text(v_row, 'sourceRequisition', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_PURCHASE');
    v_lines := private.rf_po_parse_lines(v_row -> 'lines');

    select * into v_old from public.rf_purchase_orders p where p.is_test and p.po_no = v_no;
    if found then
      -- ส่งมาเป็น "ใบใหม่" ด้วยเลขที่มีอยู่แล้ว (เวลาสร้างต่างจากที่เก็บ) = เลขเอกสารชนกัน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- เทียบกับแถวที่เก็บ: ช่องของใบ + ทุกบรรทัด (receivedAt / receivedBy ของ client ไม่นับ) นับบรรทัดที่ client บอกว่าเพิ่งรับเข้า
      v_n := jsonb_array_length(v_old.lines);
      v_other := v_old.source_pi is distinct from v_pi or v_old.source_requisition is distinct from v_req
        or v_old.note <> v_note or jsonb_array_length(v_lines) <> v_n;
      v_recv_count := 0;
      v_idx := null;
      if not v_other then
        for v_i in 0 .. v_n - 1 loop
          v_sl := v_old.lines -> v_i;
          v_nl := v_lines -> v_i;
          if (v_sl ->> 'materialCode') is distinct from (v_nl ->> 'materialCode')
             or (v_sl ->> 'needKg')::numeric is distinct from (v_nl ->> 'needKg')::numeric
             or (v_sl ->> 'availableKg')::numeric is distinct from (v_nl ->> 'availableKg')::numeric
             or (v_sl ->> 'shortageKg')::numeric is distinct from (v_nl ->> 'shortageKg')::numeric
             or (v_sl ->> 'safetyKg')::numeric is distinct from (v_nl ->> 'safetyKg')::numeric
             or (v_sl ->> 'qtyKg')::numeric is distinct from (v_nl ->> 'qtyKg')::numeric then
            v_other := true;
          elsif jsonb_typeof(v_sl -> 'receivedKg') = 'null' then
            if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' then
              v_recv_count := v_recv_count + 1;
              v_idx := v_i;
            end if;
          elsif (v_sl ->> 'receivedKg')::numeric is distinct from (v_nl ->> 'receivedKg')::numeric
             or (v_sl ->> 'lotNo') is distinct from (v_nl ->> 'lotNo')
             or (v_sl ->> 'expiry')::numeric is distinct from (v_nl ->> 'expiry')::numeric then
            v_other := true;
          end if;
        end loop;
      end if;
      -- ตรงกับที่เก็บทุกช่อง (สำเนาที่ client ได้จากเซิร์ฟเวอร์) = ไม่ทำอะไร
      if not (v_other or v_recv_count > 0 or v_status <> v_old.status) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      -- ยกเลิก: กลุ่มวางแผน เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้า
      if v_status = 'cancelled' and v_old.status <> 'cancelled' then
        if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'cancelPurchaseOrder' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other or v_recv_count > 0
           or exists (select 1 from jsonb_array_elements(v_old.lines) l where jsonb_typeof(l -> 'receivedKg') <> 'null') then
          raise exception 'RF_INVALID_TRANSITION';
        end if;
        update public.rf_purchase_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_old.id;
        continue;
      end if;

      -- ที่เหลือที่ยอมให้มีได้ทางเดียวคือรับเข้าหนึ่งบรรทัด (ST หรือกลุ่มวางแผน) ที่มาพร้อมล็อตใหม่
      if v_recv_count = 0 then raise exception 'RF_INVALID_TRANSITION'; end if;
      if not (p_planner or p_st) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'receivePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
      if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
      if v_recv_count <> 1 or v_receipt is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_sl := v_old.lines -> v_idx;
      v_nl := v_lines -> v_idx;
      v_kg := (v_nl ->> 'receivedKg')::numeric;
      v_exp := (v_nl ->> 'expiry')::numeric;
      if v_exp <= v_ms then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
        'receivedKg', v_kg, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'receivedAt', v_ms, 'receivedBy', p_actor_name));
      update public.rf_purchase_orders set
        lines = v_final,
        status = case when exists (select 1 from jsonb_array_elements(v_final) l where jsonb_typeof(l -> 'receivedKg') = 'null')
                      then 'ordered' else 'received' end,
        updated_at = now()
      where id = v_old.id;
      v_receipt := jsonb_build_object('materialCode', v_sl ->> 'materialCode', 'lotNo', v_nl ->> 'lotNo', 'qtyKg', v_kg, 'expiry', v_exp);
    else
      -- ใบใหม่: กลุ่มวางแผนหรือสมาชิก RB เท่านั้น ต้อง ordered ไม่มีข้อมูลรับเข้า วัตถุดิบทุกบรรทัดต้องมีอยู่และ active
      if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'createPurchaseOrder' or v_status <> 'ordered' then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_final := '[]'::jsonb;
      for v_nl in select value from jsonb_array_elements(v_lines) loop
        if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' then raise exception 'RF_INVALID_PURCHASE'; end if;
        select * into v_mat from public.rf_materials m where m.is_test and upper(m.code) = upper(v_nl ->> 'materialCode');
        if not found or not v_mat.active then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
          'materialCode', v_mat.code, 'receivedAt', null::bigint, 'receivedBy', null::text));
      end loop;
      insert into public.rf_purchase_orders (is_test, po_no, status, source_pi, source_requisition, note, lines, created_by)
      values (true, v_no, 'ordered', v_pi, v_req, v_note, v_final, p_actor.id);
    end if;
  end loop;
  return jsonb_build_object('receipt', v_receipt);
end;
$$;
revoke all on function private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- ตรวจหลังตัวเขียนล็อตวัตถุดิบ: ใบรับเข้าต้องมาพร้อมล็อตใหม่หนึ่งแถว (ล็อตเดียวที่เปลี่ยนในคำสั่งนี้ = changed_version > p_cur) ที่ตรงกับบรรทัดที่รับ
-- และเกิดในคำสั่งนี้ (รับเข้าโดยผู้เรียก ณ เวลาธุรกรรม) · ไม่ตรง = ย้อนทั้งคำสั่ง · p_receipt เป็น null = ไม่มีการรับเข้า ไม่ตรวจอะไร
create or replace function private.rf_check_po_receipt(p_actor uuid, p_receipt jsonb, p_cur bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.rf_material_lots%rowtype;
begin
  if p_receipt is null or jsonb_typeof(p_receipt) = 'null' then return; end if;
  if (select count(*) from public.rf_material_lots l where l.is_test and l.changed_version > p_cur) <> 1 then
    raise exception 'RF_INVALID_PURCHASE';
  end if;
  select * into v_lot from public.rf_material_lots l where l.is_test and l.changed_version > p_cur;
  if v_lot.lot_no <> (p_receipt ->> 'lotNo')
     or v_lot.material_code <> (p_receipt ->> 'materialCode')
     or v_lot.initial_kg <> (p_receipt ->> 'qtyKg')::numeric
     or v_lot.qty_kg <> v_lot.initial_kg
     or v_lot.expiry <> (p_receipt ->> 'expiry')::numeric
     or v_lot.status <> 'available'
     or v_lot.received_by is distinct from p_actor
     or v_lot.received_at <> now() then
    raise exception 'RF_INVALID_PURCHASE';
  end if;
end;
$$;
revoke all on function private.rf_check_po_receipt(uuid, jsonb, bigint) from public, anon, authenticated;

-- ใบเบิก (นิยามจาก 20261108010000_rubberflow_shopfloor.sql เพิ่ม p_action): สร้างใหม่ = เซิร์ฟเวอร์ระเบิดสูตรของ WO × จำนวน batch แล้วจัดสรร FEFO เองและ "จ่ายทันที" ในธุรกรรมเดียว
-- (ทุกบรรทัด actualKg = targetKg, weighedAt/weighedBy = เวลาและผู้เรียก, หักสต็อกล็อตตามบรรทัด, สถานะ issued, issued_at/by) ไม่มีเกณฑ์ชั่ง · บรรทัดที่ client ส่งมาเมิน
-- จำนวน batch ของใบใหม่ต้องเท่ากับที่ WO ยังไม่ได้เบิก (คำนวณจาก WO และใบเบิกเดิมของ WO นั้น ไม่เกิน 10 ต่อใบ) · WO ที่เบิกครบแล้วเบิกอีกไม่ได้ (RF_INVALID_REQUISITION)
-- ใบเดิม: ส่งซ้ำที่ทุกบรรทัดตรงกับที่เก็บ = ไม่ทำอะไร (เหมือนเดิม) · ใบที่ยัง weighing (ข้อมูลเก่า) ชั่งต่อได้ด้วย weighLine (client ใส่ actualKg ของบรรทัดที่ยังไม่ชั่ง อยู่ในเกณฑ์ ± max(0.02, 1.5%))
-- หรือจ่ายทั้งใบด้วย issueRequisition (ทุกบรรทัดที่ยังไม่ชั่งต้องตั้ง actualKg = targetKg พอดี ไม่ครบ/ไม่พอดี = RF_INVALID_REQUISITION) · ช่องอื่นของใบเดิม (status/issued/consumed) เมิน
-- p_may = สมาชิก RB หรือกลุ่มวางแผน · RF_STALE ก่อนสิทธิ์/สถานะเสมอ
drop function if exists private.rf_save_requisitions(uuid, text, boolean, jsonb, bigint, bigint);
create or replace function private.rf_save_requisitions(p_actor uuid, p_actor_name text, p_may boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_order text;
  v_batches numeric;
  v_note text;
  v_now_ms bigint := private.bom_ms(now());
  v_old public.rf_requisitions%rowtype;
  v_ord public.rf_orders%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_lot public.rf_material_lots%rowtype;
  v_item record;
  v_total numeric;
  v_need_kg numeric;
  v_done_kg numeric;
  v_next numeric;
  v_need numeric;
  v_left numeric;
  v_free numeric;
  v_take numeric;
  v_after numeric;
  v_short text[] := '{}';
  v_new_lines jsonb;
  v_clines jsonb;
  v_cline jsonb;
  v_sline jsonb;
  v_lines jsonb;
  v_i integer;
  v_cact numeric;
  v_sact numeric;
  v_target numeric;
  v_tol numeric;
  v_changed boolean;
  v_done boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_REQUISITION');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_requisitions q where q.is_test and q.req_no = v_no;
    if found then
      -- เลขใบเบิกซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      v_clines := v_row -> 'lines';
      if jsonb_typeof(v_clines) is distinct from 'array' then v_clines := '[]'::jsonb; end if;
      v_changed := false;
      for v_i in 0 .. jsonb_array_length(v_old.lines) - 1 loop
        v_cline := v_clines -> v_i;
        continue when v_cline is null or jsonb_typeof(v_cline) <> 'object';
        v_cact := case when jsonb_typeof(v_cline -> 'actualKg') = 'number' then (v_cline ->> 'actualKg')::numeric end;
        v_sact := case when jsonb_typeof(v_old.lines -> v_i -> 'actualKg') = 'number' then (v_old.lines -> v_i ->> 'actualKg')::numeric end;
        if v_cact is distinct from v_sact then v_changed := true; end if;
      end loop;
      if not v_changed then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      if not p_may then raise exception 'RF_FORBIDDEN'; end if;
      if v_old.status <> 'weighing' then raise exception 'RF_INVALID_TRANSITION'; end if;
      v_lines := v_old.lines;
      for v_i in 0 .. jsonb_array_length(v_old.lines) - 1 loop
        v_cline := v_clines -> v_i;
        continue when v_cline is null or jsonb_typeof(v_cline) <> 'object';
        v_cact := case when jsonb_typeof(v_cline -> 'actualKg') = 'number' then (v_cline ->> 'actualKg')::numeric end;
        v_sline := v_old.lines -> v_i;
        v_sact := case when jsonb_typeof(v_sline -> 'actualKg') = 'number' then (v_sline ->> 'actualKg')::numeric end;
        continue when v_cact is not distinct from v_sact;
        -- ชั่งซ้ำบรรทัดที่ชั่งแล้ว หรือลบค่าที่ชั่ง ไม่ได้
        if v_sact is not null or v_cact is null then raise exception 'RF_INVALID_REQUISITION'; end if;
        v_target := (v_sline ->> 'targetKg')::numeric;
        -- จ่ายทั้งใบ = ต้องเท่าเป้าหมายพอดี · ชั่งทีละบรรทัด (ข้อมูลเก่า) = อยู่ในเกณฑ์
        if p_action = 'issueRequisition' then
          if abs(v_cact - v_target) > 0.000000001 then raise exception 'RF_INVALID_REQUISITION'; end if;
        else
          v_tol := greatest(0.02, v_target * 1.5 / 100);
          if abs(v_cact - v_target) > v_tol + 0.000000001 then raise exception 'RF_OUT_OF_TOLERANCE'; end if;
        end if;
        select * into v_lot from public.rf_material_lots l where l.is_test and l.lot_no = (v_sline ->> 'lotNo') for update;
        if not found then raise exception 'RF_LOT_UNAVAILABLE'; end if;
        if v_lot.status = 'hold' or v_lot.qty_kg <= 0.0001 or v_lot.expiry <= v_now_ms or v_lot.qty_kg < v_cact then
          perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_LOT_UNAVAILABLE');
        end if;
        update public.rf_material_lots set qty_kg = greatest(0, trim_scale(round(v_lot.qty_kg - v_cact, 6))), updated_at = now() where id = v_lot.id;
        v_lines := jsonb_set(v_lines, array[v_i::text],
          (v_lines -> v_i) || jsonb_build_object('actualKg', v_cact, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
      end loop;
      v_done := not exists (select 1 from jsonb_array_elements(v_lines) e where jsonb_typeof(e -> 'actualKg') is distinct from 'number');
      if p_action = 'issueRequisition' and not v_done then raise exception 'RF_INVALID_REQUISITION'; end if;
      update public.rf_requisitions set
        lines = v_lines,
        status = case when v_done then 'issued' else status end,
        issued_at = case when v_done then now() else issued_at end,
        issued_by = case when v_done then p_actor else issued_by end,
        updated_at = now()
      where id = v_old.id;
      continue;
    end if;

    -- ใบใหม่: สมาชิก RB / กลุ่มวางแผน · WO ต้อง released หรือ in_progress · เซิร์ฟเวอร์จัดสรร FEFO เองแล้วจ่ายทันที
    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    v_order := private.bom_text(v_row, 'orderId', 40, 1, 'RF_INVALID_REQUISITION');
    v_batches := private.bom_num(v_row -> 'batches', 'RF_INVALID_REQUISITION', 1, 10);
    if v_batches is null then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_REQUISITION');
    -- ล็อกแถว WO ไว้ (และทั้งธุรกรรมถือ advisory lock ของ app_rf_save อยู่แล้ว) ใบเบิกของ WO เดียวกันจึงไม่ซ้อนกัน
    select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order for update;
    if not found then raise exception 'RF_INVALID_REQUISITION'; end if;
    if v_ord.status not in ('released', 'in_progress') then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_REQUISITION');
    end if;
    select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_ord.recipe_code and r.revision = v_ord.recipe_revision;
    -- จำนวน batch มาจาก WO ไม่ใช่ที่ผู้ใช้กรอก (เหมือน rules.nextRequisitionBatches ของ client): กิโลที่ WO ต้องใช้ = target_kg (ถ้ามี) ไม่เช่นนั้น target_qty ÷ yield_per_kg ของสูตรที่ WO ใช้
    -- ลบกิโลที่ใบเบิกทุกใบของ WO นี้เบิกไปแล้ว (batches × batch_kg · ไม่มีสถานะยกเลิก นับทุกใบ) ปัดขึ้นเป็น batch (เผื่อ 1e-9) ไม่เกิน 10 ต่อใบ
    -- 0 (เบิกครบแล้ว) หรือไม่ตรงกับที่ client ส่ง = RF_INVALID_REQUISITION · แต่ถ้าใบเบิกของ WO นี้เปลี่ยนหลังเวอร์ชันฐาน = client ถือข้อมูลเก่า ได้ RF_STALE (ตามทันแล้วลองใหม่)
    v_need_kg := case when v_ord.target_kg > 0 then v_ord.target_kg else v_ord.target_qty / v_rec.yield_per_kg end;
    v_done_kg := coalesce((select sum(q.batches * v_rec.batch_kg) from public.rf_requisitions q where q.is_test and q.order_no = v_order), 0);
    v_next := least(10, greatest(0, ceil(greatest(0, v_need_kg - v_done_kg) / v_rec.batch_kg - 0.000000001)));
    if v_batches is distinct from v_next or v_next < 1 then
      perform private.rf_fail((select max(q.changed_version) from public.rf_requisitions q where q.is_test and q.order_no = v_order), p_base, p_cur, 'RF_INVALID_REQUISITION');
    end if;
    v_total := (select sum((e ->> 'phr')::numeric) from jsonb_array_elements(v_rec.items) e);
    v_new_lines := '[]'::jsonb;
    for v_item in
      select t.e ->> 'materialCode' as code, coalesce((t.e ->> 'stage')::integer, 1) as stage, (t.e ->> 'phr')::numeric as phr
      from jsonb_array_elements(v_rec.items) with ordinality as t(e, ord)
      order by 2, t.ord
    loop
      v_need := round(v_item.phr / v_total * v_rec.batch_kg * v_batches, 4);
      v_left := v_need;
      -- ล็อกแถวล็อตของวัตถุดิบนี้ (เรียงตามเลขล็อต) ก่อนจัดสรร
      perform 1 from public.rf_material_lots l where l.is_test and l.material_code = v_item.code order by l.lot_no for update;
      for v_lot in
        select * from public.rf_material_lots l
        where l.is_test and l.material_code = v_item.code and l.status = 'available' and l.qty_kg > 0.0001 and l.expiry > v_now_ms
        order by l.expiry, l.received_at, l.lot_no
      loop
        exit when v_left <= 0.0001;
        -- คงเหลือที่จองได้ = สต็อก - ที่ใบเบิกเก่า (ยัง weighing) จองบรรทัดที่ยังไม่ชั่ง - ที่ใบนี้จัดสรรไปแล้ว
        v_free := v_lot.qty_kg
          - coalesce((select sum((e ->> 'targetKg')::numeric)
                      from public.rf_requisitions q, jsonb_array_elements(q.lines) e
                      where q.is_test and q.status = 'weighing' and e ->> 'lotNo' = v_lot.lot_no
                        and jsonb_typeof(e -> 'actualKg') is distinct from 'number'), 0)
          - coalesce((select sum((e ->> 'targetKg')::numeric) from jsonb_array_elements(v_new_lines) e where e ->> 'lotNo' = v_lot.lot_no), 0);
        continue when v_free <= 0.0001;
        v_take := trunc(least(v_free, v_left), 4);
        continue when v_take <= 0;
        v_new_lines := v_new_lines || jsonb_build_array(jsonb_build_object(
          'materialCode', v_item.code, 'stage', v_item.stage, 'lotNo', v_lot.lot_no,
          'targetKg', trim_scale(v_take), 'actualKg', null, 'weighedAt', null));
        v_left := v_left - v_take;
      end loop;
      if v_left > 0.0001 then
        v_short := v_short || (v_item.code || ' ขาด ' || trim_scale(round(v_left, 2))::text || ' kg');
      end if;
    end loop;
    if cardinality(v_short) > 0 then
      -- สต็อก/ใบเบิกเปลี่ยนหลังเวอร์ชันฐาน = client ถือข้อมูลเก่า (ตามทันแล้วลองใหม่) ไม่เช่นนั้นสต็อกไม่พอจริง
      if exists (select 1 from public.rf_material_lots l where l.is_test and l.changed_version > p_base and l.changed_version <= p_cur)
         or exists (select 1 from public.rf_requisitions q where q.is_test and q.changed_version > p_base and q.changed_version <= p_cur) then
        raise exception 'RF_STALE';
      end if;
      raise exception 'RF_INSUFFICIENT_STOCK';
    end if;
    -- จ่ายทันที: หักสต็อกล็อตตามบรรทัด (ล็อกไว้แล้วข้างบน จัดสรรไม่เกินคงเหลือ) แล้วตั้งค่าที่จ่ายจริง = เป้าหมาย
    for v_i in 0 .. jsonb_array_length(v_new_lines) - 1 loop
      v_sline := v_new_lines -> v_i;
      v_target := (v_sline ->> 'targetKg')::numeric;
      select * into v_lot from public.rf_material_lots l where l.is_test and l.lot_no = (v_sline ->> 'lotNo') for update;
      -- ตัดทศนิยม (trunc) ตอนจัดสรรไม่ให้เกินคงเหลือ · ถ้าหักแล้วติดลบให้หยุดทั้งธุรกรรม ไม่ปัดเป็น 0 เงียบ ๆ
      v_after := v_lot.qty_kg - v_target;
      if v_after < 0 then raise exception 'RF_INSUFFICIENT_STOCK'; end if;
      update public.rf_material_lots set qty_kg = trim_scale(v_after), updated_at = now() where id = v_lot.id;
      v_new_lines := jsonb_set(v_new_lines, array[v_i::text],
        v_sline || jsonb_build_object('actualKg', v_target, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
    end loop;
    insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines, status, note, requested_by, issued_at, issued_by)
    values (true, v_no, v_order, v_ord.recipe_code, v_ord.recipe_revision, v_batches,
            trim_scale(round(v_rec.batch_kg * v_batches, 4)), v_new_lines, 'issued', v_note, p_actor, now(), p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 6. snapshot / delta -----------------------------------------------------------------------
-- ระเบียนที่ changed_version > p_since แยกตามชุด เรียงแบบกำหนดได้ · p_since = -1 ได้ทั้งหมด (snapshot) · 12 ชุด (ชุดที่ 12 = purchaseOrders)
-- นิยามจาก 20261108010000_rubberflow_shopfloor.sql เพิ่มช่อง safetyKg / shelfLifeDays ของวัตถุดิบ และชุด purchaseOrders (ช่องว่างเป็น null ทุกช่อง)
create or replace function private.rf_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', m.code, 'name', m.name, 'category', m.category, 'storage', m.storage_location, 'uom', m.uom, 'active', m.active,
          'safetyKg', m.safety_kg, 'shelfLifeDays', m.shelf_life_days, 'createdAt', private.bom_ms(m.created_at)) order by m.code collate "C")
      from public.rf_materials m where m.is_test and m.changed_version > p_since), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.recipe_code, 'revision', r.revision, 'productCode', r.product_code,
          'uom', r.uom, 'batchKg', r.batch_kg, 'stages', r.stages, 'dumpTol', r.dump_tol,
          'restHours', r.rest_hours, 'yieldPerKg', r.yield_per_kg, 'items', r.items, 'status', r.status,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.approved_at is null then '{}'::jsonb
                else jsonb_build_object('approvedBy', coalesce(private.bom_person(r.approved_by), ''), 'approvedAt', private.bom_ms(r.approved_at)) end
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.wo_no, 'customer', o.customer, 'customerPo', o.customer_po, 'recipeId', o.recipe_code, 'recipeRevision', o.recipe_revision,
          'productCode', o.product_code, 'uom', o.uom, 'color', o.color,
          'targetQty', o.target_qty, 'producedQty', o.produced_qty, 'startDate', o.start_date, 'dueDate', o.due_date,
          'priority', o.priority, 'note', o.note, 'status', o.status,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.target_kg is null then '{}'::jsonb else jsonb_build_object('targetKg', o.target_kg) end
        || case when o.kg_per_unit is null then '{}'::jsonb else jsonb_build_object('kgPerUnit', o.kg_per_unit) end
        || case when o.source_job_no is null then '{}'::jsonb else jsonb_build_object('sourceJobId', o.source_job_no) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at), 'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at)) end
        order by o.created_at desc, o.wo_no collate "C" desc)
      from public.rf_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
    'molds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.mold_no, 'name', d.name, 'kind', d.kind, 'unit', d.unit, 'perCycle', d.per_cycle, 'cleanEvery', d.clean_every,
          'pmLimit', d.pm_limit, 'totalUsage', d.total_usage, 'usageSinceClean', d.usage_since_clean)
        || case when d.last_clean_at is null then '{}'::jsonb else jsonb_build_object('lastCleanAt', private.bom_ms(d.last_clean_at)) end
        order by d.mold_no collate "C")
      from public.rf_molds d where d.is_test and d.changed_version > p_since), '[]'::jsonb),
    'materialLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'lotNo', l.lot_no, 'materialCode', l.material_code, 'qtyKg', l.qty_kg, 'initialKg', l.initial_kg, 'expiry', l.expiry,
          'supplier', l.supplier, 'location', l.location, 'status', l.status, 'coa', l.coa,
          'receivedAt', private.bom_ms(l.received_at), 'receivedBy', coalesce(private.bom_person(l.received_by), ''))
        order by l.lot_no collate "C")
      from public.rf_material_lots l where l.is_test and l.changed_version > p_since), '[]'::jsonb),
    'requisitions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.req_no, 'orderId', q.order_no, 'recipeId', q.recipe_code, 'recipeRevision', q.recipe_revision,
          'batches', q.batches, 'totalKg', q.total_kg, 'lines', q.lines, 'status', q.status, 'note', q.note,
          'requestedBy', coalesce(private.bom_person(q.requested_by), ''), 'createdAt', private.bom_ms(q.created_at))
        || case when q.issued_at is null then '{}'::jsonb
                else jsonb_build_object('issuedAt', private.bom_ms(q.issued_at), 'issuedBy', coalesce(private.bom_person(q.issued_by), '')) end
        || case when q.consumed_by_lot is null then '{}'::jsonb else jsonb_build_object('consumedBy', q.consumed_by_lot) end
        order by q.req_no collate "C")
      from public.rf_requisitions q where q.is_test and q.changed_version > p_since), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', t.lot_no, 'stage', t.stage, 'orderId', t.order_no, 'uom', t.uom, 'machine', t.machine, 'shift', t.shift,
          'sources', t.sources, 'params', t.params, 'goodQty', t.good_qty, 'scrapQty', t.scrap_qty, 'scrapReason', t.scrap_reason,
          'qc', t.qc, 'holdReasons', t.hold_reasons, 'transferredQty', t.transferred_qty,
          'createdAt', private.bom_ms(t.created_at), 'operator', coalesce(private.bom_person(t.created_by), ''))
        || case when t.recipe_code is null then '{}'::jsonb else jsonb_build_object('recipeId', t.recipe_code) end
        || case when t.ready_at is null then '{}'::jsonb else jsonb_build_object('readyAt', private.bom_ms(t.ready_at)) end
        || case when t.stage = 'extrusion' and t.mold_id is not null then jsonb_build_object('dieId', t.mold_id)
                when t.stage = 'curing' and t.mold_id is not null then jsonb_build_object('moldId', t.mold_id)
                else '{}'::jsonb end
        || case when t.stage = 'finishing' then jsonb_build_object('grade', t.grade, 'boxes', t.boxes, 'countedToOrder', t.counted_to_order) else '{}'::jsonb end
        order by t.lot_no collate "C")
      from public.rf_lots t where t.is_test and t.changed_version > p_since), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', x.transfer_no, 'lotId', x.lot_no, 'orderId', x.order_no, 'from', x.from_stage, 'to', x.to_stage, 'uom', x.uom,
          'qtySent', x.qty_sent, 'qtyReceived', x.qty_received, 'remaining', x.remaining, 'condition', x.condition, 'note', x.note,
          'status', x.status, 'createdAt', private.bom_ms(x.created_at), 'createdBy', coalesce(private.bom_person(x.created_by), ''),
          'sentAt', private.bom_ms(x.created_at), 'sentBy', coalesce(private.bom_person(x.created_by), ''))
        || case when x.received_at is null then '{}'::jsonb
                else jsonb_build_object('receivedAt', private.bom_ms(x.received_at), 'receivedBy', coalesce(private.bom_person(x.received_by), '')) end
        order by x.transfer_no collate "C")
      from public.rf_transfers x where x.is_test and x.changed_version > p_since), '[]'::jsonb),
    'fgBoxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.box_no, 'lotId', b.lot_no, 'orderId', b.order_no, 'recipeId', b.recipe_code, 'productCode', b.product_code,
          'qty', b.qty, 'uom', b.uom, 'grade', b.grade, 'status', b.status, 'createdAt', private.bom_ms(b.created_at))
        || case when b.shipped_at is null then '{}'::jsonb
                else jsonb_build_object('shippedAt', private.bom_ms(b.shipped_at), 'shippedBy', coalesce(private.bom_person(b.shipped_by), '')) end
        order by b.box_no collate "C")
      from public.rf_fg_boxes b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'qcRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.qc_no, 'lotId', c.lot_no, 'orderId', c.order_no, 'stage', c.stage, 'tests', c.tests, 'result', c.result, 'note', c.note,
          'inspector', coalesce(private.bom_person(c.tested_by), ''), 'at', private.bom_ms(c.tested_at),
          'testedBy', coalesce(private.bom_person(c.tested_by), ''), 'testedAt', private.bom_ms(c.tested_at))
        order by c.qc_no collate "C")
      from public.rf_qc_records c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'ncrs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', n.ncr_no, 'title', n.title, 'stage', n.stage, 'lotId', n.lot_no, 'severity', n.severity, 'defectQty', n.defect_qty,
          'whys', n.whys, 'containment', n.containment, 'corrective', n.corrective, 'preventive', n.preventive, 'owner', n.owner,
          'status', n.status, 'createdAt', private.bom_ms(n.created_at), 'createdBy', coalesce(private.bom_person(n.created_by), ''),
          'openedAt', private.bom_ms(n.created_at), 'openedBy', coalesce(private.bom_person(n.created_by), ''))
        || case when n.closed_at is null then '{}'::jsonb
                else jsonb_build_object('closedAt', private.bom_ms(n.closed_at), 'closedBy', coalesce(private.bom_person(n.closed_by), ''), 'verification', n.verification) end
        order by n.ncr_no collate "C")
      from public.rf_ncrs n where n.is_test and n.changed_version > p_since), '[]'::jsonb),
    'purchaseOrders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.po_no, 'status', o.status, 'sourcePi', o.source_pi, 'sourceRequisition', o.source_requisition, 'note', o.note,
          'lines', o.lines, 'createdAt', private.bom_ms(o.created_at), 'createdBy', coalesce(private.bom_person(o.created_by), ''),
          'cancelledAt', private.bom_ms(o.cancelled_at))
        order by o.po_no collate "C")
      from public.rf_purchase_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- ส่วนต่างหลังเวอร์ชัน p_since: { version, epoch, changes: { <ชุด>: { upsert, delete } } } ครบ 12 ชุดเสมอ (ยังไม่มีการลบ delete เป็น [] ทุกชุด)
create or replace function private.rf_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.rf_master_state s where s.is_test), 0),
    'epoch', (select s.epoch from public.rf_master_state s where s.is_test),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object('upsert', r.records -> l.list, 'delete', '[]'::jsonb))
      from (values ('materials'), ('recipes'), ('orders'), ('molds'), ('materialLots'), ('requisitions'), ('lots'),
                   ('transfers'), ('fgBoxes'), ('qcRecords'), ('ncrs'), ('purchaseOrders')) as l(list)
      cross join (select private.rf_records(p_since) as records) r))
$$;
revoke all on function private.rf_delta(bigint) from public, anon, authenticated;

-- 7. RPC สาธารณะ -------------------------------------------------------------------------------
-- app_rf_master / app_rf_master_since / app_rf_audit ไม่เปลี่ยน (เรียก private.rf_snapshot / rf_delta ซึ่งคืน 12 ชุดแล้ว)
-- นิยามจาก 20261108010000_rubberflow_shopfloor.sql: เพิ่มชุด purchaseOrders (ส่งได้ทุกกลุ่มวางแผน / สมาชิก RB / ST ตรวจรายระเบียนในตัวเขียน), ข้อจำกัดชุดต่อ action ใบสั่งซื้อ,
-- ตัวเขียนใบสั่งซื้อก่อนตัวเขียนล็อต + ตรวจใบรับเข้าหลังตัวเขียนล็อต, rf_save_materials รับ p_action, และเงื่อนไข "ไม่มีแถวเปลี่ยนจริง" ครอบ rf_purchase_orders
create or replace function public.app_rf_save(
  p_changes jsonb, p_base_version bigint, p_action text, p_audit jsonb default '[]'::jsonb, p_epoch text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_actor_name text;
  v_planner boolean;
  v_rb boolean;
  v_head boolean;
  v_qa boolean;
  v_st boolean;
  v_sr boolean;
  v_wh boolean;
  v_sections constant text[] := array['materials', 'recipes', 'orders', 'molds', 'materialLots', 'requisitions', 'lots',
                                       'transfers', 'fgBoxes', 'qcRecords', 'ncrs', 'purchaseOrders'];
  v_key text;
  v_sub text;
  v_sec jsonb;
  v_node jsonb;
  v_n integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_audit jsonb := '[]'::jsonb;
  v_entry jsonb;
  v_version bigint;
  v_epoch uuid;
  v_res jsonb;
  v_bom_jobs integer := 0;
  v_bom_orders integer := 0;
  v_bom_version bigint;
  v_may boolean;
  v_po jsonb;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_bom_save_master (20261108020000: ปล่อยผลิตแล้วเปิด WO ล็อก BOM ก่อน RF) ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ จึงไม่วนกัน
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.rf_actor();
  v_planner := private.bom_can_edit(v_actor);
  v_rb := private.rf_is_rb(v_actor);
  v_head := private.rf_is_rb_head(v_actor);
  v_qa := private.rf_is_qa(v_actor);
  v_st := coalesce(private.bom_dept_of(v_actor) = 'ST', false);
  v_sr := coalesce(private.bom_dept_of(v_actor) = 'SR', false);
  v_wh := coalesce(private.bom_dept_of(v_actor) = 'WH', false);
  if p_action is null or not (p_action = any (private.rf_client_actions())) then raise exception 'RF_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'RF_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'RF_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'RF_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'RF_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert เท่านั้น (ไม่มีลบ), อาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'RF_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'RF_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if v_sub <> 'upsert' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'RF_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'RF_TOO_MANY'; end if;
      -- ใครส่งชุดไหนมาได้บ้าง (ตรวจหยาบก่อน: สิทธิ์รายระเบียน/รายช่องตรวจในตัวเขียนหลังตรวจชน) ชุดที่เป็นผลข้างเคียงของ action ของแผนกอื่น
      -- (เช่น ล็อตวัตถุดิบตอน RB ชั่ง กล่อง/ล็อตตอน QA ตรวจ) ผู้ส่งมาด้วยได้ แต่ช่องที่เซิร์ฟเวอร์คำนวณเองเมิน ช่องที่เขียนได้จริงตรวจรายช่อง
      v_may := case v_key
        when 'materials' then v_planner or v_rb
        when 'recipes' then v_planner or v_rb
        when 'orders' then v_planner or v_rb or (v_qa and p_action = 'addQcRecord')
        when 'molds' then v_planner or v_rb
        when 'materialLots' then v_planner or v_rb or v_st or v_qa
        when 'requisitions' then v_planner or v_rb
        when 'lots' then v_planner or v_rb or v_qa
        when 'transfers' then v_planner or v_rb or v_sr
        when 'fgBoxes' then v_planner or v_rb or v_wh or v_qa
        when 'qcRecords' then v_planner or v_qa
        when 'ncrs' then v_planner or v_qa or v_rb
        when 'purchaseOrders' then v_planner or v_rb or v_st
        else false end;
      if v_n > 0 and not v_may then raise exception 'RF_FORBIDDEN'; end if;
      -- ใบสั่งซื้อ: ชุด purchaseOrders ส่งได้เฉพาะสามคำสั่งของใบสั่งซื้อ และแต่ละคำสั่งส่งได้เฉพาะชุดที่เกี่ยวข้อง (รับเข้า = ใบ + ล็อตวัตถุดิบ, สร้าง = ใบ + วัตถุดิบ, ยกเลิก = ใบ)
      if v_n > 0 and ((v_key = 'purchaseOrders' and not (p_action = any (array['createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder'])))
                      or (p_action = 'createPurchaseOrder' and v_key not in ('purchaseOrders', 'materials'))
                      or (p_action = 'receivePurchaseLine' and v_key not in ('purchaseOrders', 'materialLots'))
                      or (p_action = 'cancelPurchaseOrder' and v_key <> 'purchaseOrders')) then
        raise exception 'RF_INVALID_PURCHASE';
      end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับ RF ก่อนตรวจชน (ลำดับล็อก: RF ก่อน BOM เสมอ) v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน)
  insert into public.rf_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.rf_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'RF_RESET'; end if;
  if p_base_version > v_version then raise exception 'RF_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.rf_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.rf_save_materials(v_actor.id, p_action, coalesce(p_changes #> '{materials,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_recipes(v_actor.id, v_head, coalesce(p_changes #> '{recipes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.rf_save_orders(v_actor, v_actor_name, v_planner, v_rb, v_head,
                                    coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    perform private.rf_save_molds(v_actor.id, v_planner or v_rb, p_action, coalesce(p_changes #> '{molds,upsert}', '[]'::jsonb), p_base_version, v_version);
    -- ใบสั่งซื้อก่อนล็อตวัตถุดิบ (RF_STALE ของใบมาก่อนสิทธิ์ของล็อต) แล้วตรวจว่าใบรับเข้ามีล็อตใหม่ที่ตรงกันหลังตัวเขียนล็อต
    v_po := private.rf_save_purchase_orders(v_actor, v_actor_name, v_planner, v_rb, v_st, p_action,
                                            coalesce(p_changes #> '{purchaseOrders,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_material_lots(v_actor.id, v_planner, v_st, v_qa, coalesce(p_changes #> '{materialLots,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_check_po_receipt(v_actor.id, v_po -> 'receipt', v_version);
    perform private.rf_save_requisitions(v_actor.id, v_actor_name, v_planner or v_rb, p_action, coalesce(p_changes #> '{requisitions,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_lots(v_actor, v_actor_name, v_planner or v_rb, v_planner or v_rb, p_action, coalesce(p_changes #> '{lots,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.rf_save_transfers(v_actor, v_actor_name, v_planner or v_rb, v_planner or v_sr,
                                       coalesce(p_changes #> '{transfers,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    perform private.rf_save_boxes(v_actor.id, v_planner or v_wh, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_qc(v_actor, v_planner or v_qa, v_planner or v_rb, coalesce(p_changes #> '{qcRecords,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_ncrs(v_actor, v_actor_name, v_planner or v_qa, v_planner or v_qa or v_rb, coalesce(p_changes #> '{ncrs,upsert}', '[]'::jsonb), p_base_version, v_version);
  exception
    when unique_violation then
      raise exception 'RF_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'RF_INVALID_DATA';
  end;

  -- ไม่มีแถวไหนเปลี่ยนจริง (ทุกเรคอร์ดตรงกับที่เก็บ หรือต่างกันเฉพาะช่องที่เซิร์ฟเวอร์คำนวณเอง): คืน delta โดยไม่เพิ่ม version ไม่เขียน audit
  -- แถวที่เขียนในคำสั่งนี้ถูก trigger ประทับ version ก่อนบันทึก + 1 จึงมี changed_version > v_version ส่วนฝั่ง BOM นับจาก v_bom_*
  if v_bom_jobs + v_bom_orders = 0
     and not exists (select 1 from public.rf_materials t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_recipes t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_orders t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_molds t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_material_lots t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_requisitions t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_lots t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_transfers t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_fg_boxes t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_qc_records t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_ncrs t where t.is_test and t.changed_version > v_version)
     and not exists (select 1 from public.rf_purchase_orders t where t.is_test and t.changed_version > v_version) then
    return private.rf_delta(p_base_version);
  end if;

  v_version := v_version + 1;
  update public.rf_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;

  -- เขียนฝั่ง BOM (ผูกงาน / ป้อนผลผลิตกลับ / ล้างการผูก): เพิ่มตัวนับ BOM อีก 1 (ล็อกไว้แล้วตอนเขียนงาน) แถวที่แก้ถูกประทับเวอร์ชันนี้โดย trigger แล้ว
  -- เขียน audit ของ BOM ด้วย ให้ประวัติ BOM บอกว่างาน/ใบเปลี่ยนเพราะ RubberFlow
  if v_bom_jobs + v_bom_orders > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when v_bom_jobs > 0 then jsonb_build_object('upsert', v_bom_jobs) end,
                                 'orders', case when v_bom_orders > 0 then jsonb_build_object('upsert', v_bom_orders) end)),
                               'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', v_bom_jobs, 'bom_orders', v_bom_orders,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;

-- ล้างข้อมูล RubberFlow ทดสอบ (นิยามจาก 20261109010000_sandbox_purge_fast.sql เพิ่ม rf_purchase_orders ลบก่อนวัตถุดิบ)
create or replace function public.app_sandbox_purge_rf()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_version bigint;
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_rf_save) การบันทึกที่กำลังทำอยู่จึงจบก่อน
  insert into public.rf_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.rf_master_state s where s.is_test for update;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) เพื่อให้ trigger รายแถว private.sandbox_row_scope ข้ามการหา persona
  -- (เหตุผลเดียวกับ app_sandbox_purge_bom)
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_table in array array['rf_purchase_orders', 'rf_ncrs', 'rf_qc_records', 'rf_fg_boxes', 'rf_transfers', 'rf_requisitions', 'rf_lots', 'rf_material_lots', 'rf_molds',
                                 'rf_orders', 'rf_recipes', 'rf_materials', 'rf_deleted_keys'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- คืน claims ก่อนอัปเดต epoch / เขียน audit (audit ใช้ v_admin ที่อ่านไว้ก่อนแล้ว)
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.rf_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.rf_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'RF_SANDBOX_PURGE', 'rf_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล RubberFlow ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;
grant execute on function public.app_sandbox_purge_rf() to authenticated;
