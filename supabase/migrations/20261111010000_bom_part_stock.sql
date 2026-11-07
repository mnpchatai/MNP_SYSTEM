-- ============================================================================
-- จัดซื้อ (PR 2 จาก 2): สต็อกของซื้อ (ชิ้นส่วน PURCHASED ของ BOM) + ST เบิกจ่ายของซื้อรายใบ PI + บรรทัดของซื้อในใบสั่งซื้อใบเดียวกับเคมี (โหมดทดสอบเท่านั้น)
-- ต่อยอด 20261110010000_rf_purchase_orders.sql (ใบสั่งซื้อ rf_purchase_orders) และตาราง bom_* ของ 20261105010000 / 20261106010000 ทุกประการ:
-- ตัวนับ bom_master_state เดียว, changed_version รายระเบียนประทับโดย trigger bom_stamp_version, BOM_STALE ก่อนตรวจสิทธิ์/เนื้อหาเสมอ, delta {upsert, delete},
-- RLS deny-all + ถอนสิทธิ์ + lab-only, audit BOM_MASTER_SAVE, ล้างข้อมูลทดสอบผ่าน app_sandbox_purge_bom
--
-- กติกา (ยืนยันกับผู้ใช้ 2026-11-07)
--   1) ชิ้นส่วนของซื้อ (bom_items.kind = 'PURCHASED') มียอดคงเหลือต่อรายการเดียว + ประวัติการเคลื่อนไหว (นับ / รับเข้า / เบิกจ่าย) ไม่มีล็อต ไม่มีวันหมดอายุ
--   2) ยอดตั้งต้นมาจาก ST นับที่หน้า "คลังของซื้อ" (action countPartStock) · หน้านับคงคลังตามใบ (setStockCount / setStockCounts) ไม่รับชิ้นของซื้ออีก
--      (ฝั่ง client) และตอนปล่อยผลิตยอดนับตามใบของชิ้นของซื้อถูกเมิน (netRequirements: ความต้องการสุทธิ = ความต้องการเต็ม)
--   3) ST เบิกจ่ายของซื้อของใบ PI ด้วยการกดครั้งเดียว (action issueOrderParts): ทุกงานของซื้อ (PURCHASED / ST) ที่ยังไม่เสร็จของใบจ่ายเต็มส่วนที่เหลือ หักสต็อก
--      ถ้ารายการใดสต็อกไม่พอ = ไม่จ่ายอะไรเลย (BOM_INSUFFICIENT_STOCK) · PI ที่ยังไม่ได้เบิกจ่ายนับเป็น "จองแล้ว" ในหน้าสั่งซื้อ (ฝั่ง client)
--   4) ใบสั่งซื้อ (rf_purchase_orders, PO-yyyymmdd-nn) ผสมบรรทัดเคมีและบรรทัดของซื้อได้ · ST รับทีละบรรทัด: เคมีสร้างล็อตพร้อมวันหมดอายุเหมือนเดิม
--      บรรทัดของซื้อบวกยอดคงเหลือและเขียนประวัติ ไม่มีล็อต/วันหมดอายุ
--
-- งานของซื้อ: ตอนปล่อยผลิตแต่ละใบ PI client สร้างงาน dept = ST, kind = PURCHASED ต่อรายการของซื้อที่ระเบิดได้ (qtyPlanned = qtyRequired = ความต้องการเต็ม) ตัวเขียนงานเดิมรับอยู่แล้ว
--   งานของซื้อของ ST เปลี่ยนช่องผลงาน (status, qtyDone, qtyReject, reports) ได้ทางเดียวคือ action issueOrderParts (ตัวเขียนงานตรวจ p_action: ผิด = BOM_INVALID_TRANSITION)
--   PI ที่ปล่อยผลิตก่อนไฟล์นี้ไม่มีงานของซื้อ จึงไม่มีอะไรให้เบิกจ่าย (ไม่ย้ายข้อมูลเก่า)
--
-- ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test): bom_stock (หนึ่งแถวต่อรหัสของซื้อ), bom_stock_moves (ประวัติ เขียนต่อท้ายโดยเซิร์ฟเวอร์เท่านั้น)
--   trigger bom_*_sandbox_scope (is_test) + bom_*_stamp_version (changed_version) + RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only (private.lab_only_guard_table)
--   + ลงทะเบียนใน private.sandbox_unguarded_tables() + ล้างโดย app_sandbox_purge_bom · รหัสชิ้นไม่มี foreign key (ตัวเขียนตรวจว่าเป็น PURCHASED ที่มีอยู่)
--
-- รูปเรคอร์ดที่ส่ง/รับ (snapshot / delta ได้อีก 2 ชุด รวมสิบสามชุดเสมอ ชุดเก่าที่ Pilot รุ่นก่อนไม่รู้จักถูกเมิน)
--   stock      { itemCode, qty, safetyQty, countedAt (ms | null), countedBy (ชื่อ | ''), updatedAt (ms) } เรียงตามรหัส (collate "C")
--   stockMoves { id (uuid ข้อความ), itemCode, kind (count | receive | issue), qty (ค่าเปลี่ยนมีเครื่องหมาย ไม่เป็น 0), balance (ยอดหลังรายการ), ref (เลข PI ตอนเบิกจ่าย / เลข PO ตอนรับเข้า / null ตอนนับ),
--              at (ms), by (ชื่อ) } เรียงตามเวลาแล้ว id · ชุด delete เป็น [] เสมอ (ไม่มีการลบ)
--
-- app_bom_save_master: ส่วนใหม่ stock (upsert เท่านั้น ไม่อยู่ใน v_planner_sections: ST/WH ส่งได้ สิทธิ์รายช่องตรวจในตัวเขียน)
--   action ใหม่ในรายการ private.bom_client_actions() และ private.bom_staff_actions(): countPartStock, issueOrderParts
--   countPartStock: ส่งได้เฉพาะส่วน stock และส่วน stock ส่งได้เฉพาะ action นี้ (ผิด = BOM_INVALID_PAYLOAD) · แต่ละแถว { itemCode, qty?, safetyQty? } (0..1e9 ไม่ส่ง = คงค่าเดิม)
--     รหัสต้องเป็นชิ้น PURCHASED ที่มีอยู่ (ไม่เช่นนั้น BOM_INVALID_STOCK) · ค่าเท่าที่เก็บ = ไม่ทำอะไร · ชนรายระเบียน (BOM_STALE) ก่อนสิทธิ์
--     เปลี่ยนยอด (qty): กลุ่มวางแผน หรือพนักงานแผนก ST / WH · เปลี่ยนสต็อกขั้นต่ำ (safetyQty): กลุ่มวางแผนเท่านั้น (ไม่เช่นนั้น BOM_FORBIDDEN)
--     ยอดเปลี่ยน = เขียน 'count' (qty = ใหม่ - เก่า, balance = ใหม่) และตั้ง counted_at / counted_by เป็นเวลาเซิร์ฟเวอร์/ผู้เรียก
--   issueOrderParts: payload { jobs: { upsert } } เท่านั้น (อย่างอื่น = BOM_INVALID_PAYLOAD) ผู้เรียกต้องเป็นกลุ่มวางแผนหรือพนักงานแผนก ST (BOM_FORBIDDEN)
--     แถวต้องครบทุกงาน PURCHASED / ST ที่ยังไม่ done ของใบเดียว และแต่ละแถวส่ง status 'done' กับ qtyDone = qtyPlanned (ไม่ครบ/ไม่ตรง = BOM_INVALID_JOB)
--     ใบต้องเป็น released หรือ in_progress (BOM_INVALID_TRANSITION) · ชนรายระเบียนของงานตรวจก่อน (ตัวเขียนงาน) · สต็อกไม่พอบางรายการ = ไม่เขียนอะไร BOM_INSUFFICIENT_STOCK
--     (ถ้าแถวสต็อกของรายการเหล่านั้นเปลี่ยนหลังเวอร์ชันฐานของ client = BOM_STALE แทน เพราะ client ถือยอดเก่า) · ผ่านแล้วเซิร์ฟเวอร์เป็นผู้ตั้งงานเป็น done (qty_done = qty_planned,
--     done_at = เวลาเซิร์ฟเวอร์) หักสต็อกเท่าส่วนที่เหลือ เขียน 'issue' (qty = -ส่วนที่เหลือ, ref = เลข PI) ใบ released เป็น in_progress ด้วยกติกางานเริ่มเดิม
--
-- ใบสั่งซื้อ (rf_purchase_orders.lines เป็น jsonb จึงไม่เปลี่ยนตาราง): บรรทัดมีช่องใหม่
--   source 'rf' (เคมี ค่าเริ่มต้นเมื่อไม่มี เช่น ใบ/Pilot รุ่นเก่า) | 'bom' (ของซื้อ) · uom (หน่วยของชิ้นจาก bom_items.uom ที่เซิร์ฟเวอร์ตั้ง ค่าของ client เมิน; null ในบรรทัด rf)
--   ชื่อช่องเดิม (materialCode, needKg, availableKg, shortageKg, safetyKg, qtyKg, receivedKg) ใช้ต่อกับบรรทัด bom โดยหน่วยเป็นหน่วยของชิ้นนั้น (ไม่ใช่ kg) · lotNo / expiry เป็น null เสมอ
--   สร้างใบ: บรรทัด bom ต้องเป็นชิ้น PURCHASED ที่มีอยู่ (รหัสเป็น canonical ตามที่เก็บ) ถ้า safetyKg ต่างจาก bom_stock.safety_qty (ไม่มีแถว = 0) เซิร์ฟเวอร์ upsert สต็อกขั้นต่ำให้
--     (หน้าต่างสั่งซื้อแก้สต็อกขั้นต่ำของชิ้นได้) · การเปลี่ยนสต็อกขั้นต่ำของชิ้นต้องเป็นกลุ่มวางแผนเท่านั้น เหมือน countPartStock (สมาชิก RB สร้างใบได้ แต่ safetyKg ของบรรทัด bom ต้องเท่าที่เก็บ ไม่เช่นนั้น RF_FORBIDDEN)
--     · app_rf_save ล็อก bom_master_state ต่อจาก RF (private.rf_lock_bom ของ 20261107010000) แล้วเพิ่มเวอร์ชัน BOM หนึ่งครั้งพร้อม audit BOM_MASTER_SAVE (client_action 'rubberflow:<action>')
--   รับบรรทัด bom (receivePurchaseLine, ST หรือกลุ่มวางแผน): ชิ้นต้องยังเป็น PURCHASED ใน bom_items (ไม่เช่นนั้น RF_INVALID_PURCHASE), receivedKg > 0, ห้ามมี lotNo/expiry, ห้ามส่งล็อตวัตถุดิบมาด้วย (RF_INVALID_PURCHASE) · เซิร์ฟเวอร์บวก bom_stock.qty
--     เขียน 'receive' (ref = เลข PO) ตั้ง receivedAt / receivedBy ของบรรทัด และตั้งใบเป็น received เมื่อรับครบทุกบรรทัด · บรรทัดเคมีไม่เปลี่ยน (สร้างล็อต + วันหมดอายุ)
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดบน main ทุกตัว)
--   - private.sandbox_unguarded_tables จาก 20261110010000_rf_purchase_orders.sql (เพิ่ม bom_stock, bom_stock_moves)
--   - private.bom_client_actions, private.bom_staff_actions จาก 20261106010000_bom_orders_jobs.sql (เพิ่ม countPartStock, issueOrderParts)
--   - private.bom_save_jobs: ลายเซ็นเดิม (public.employees, text, boolean, jsonb, uuid[], bigint, bigint) ถูก DROP แล้วสร้างใหม่เป็น
--     (public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) (เพิ่ม p_action หลัง p_planner) จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.bom_records, private.bom_delta จาก 20261106010000_bom_orders_jobs.sql (เพิ่มชุด stock, stockMoves)
--   - public.app_bom_save_master จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - public.app_sandbox_purge_bom จาก 20261109010000_sandbox_purge_fast.sql (คงการพัก JWT claims ระหว่างลบ)
--   - private.rf_po_parse_lines, private.rf_save_purchase_orders, public.app_rf_save จาก 20261110010000_rf_purchase_orders.sql
--   - ใหม่: private.bom_save_stock, private.bom_issue_parts (ล็อกตัวนับ BOM ฝั่ง RF ใช้ private.rf_lock_bom() เดิมของ 20261107010000 ไม่สร้างใหม่)
--   - ไม่แตะ: private.bom_snapshot / app_bom_master / app_bom_master_since / app_bom_audit (คืนชุดตามที่ bom_records / bom_delta คืน) · rf_records / rf_delta · rf_check_po_receipt
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก RPC ที่เปลี่ยน (action ใหม่ countPartStock / issueOrderParts, ชุด stock / stockMoves, บรรทัดใบสั่งซื้อ source 'bom')
--   จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid))
--   ของฟังก์ชันที่ replace ข้างบนที่ production กับนิยามในไฟล์ต้นทาง (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test, has_function_privilege (anon ไม่ได้ authenticated เฉพาะ RPC สาธารณะ), relrowsecurity + policy ของ bom_stock / bom_stock_moves
--   Pilot Web รุ่นก่อนหน้ายังทำงานกับฐานข้อมูลนี้ได้ (ชุดใหม่ถูกเมิน, บรรทัดใบสั่งซื้อที่ไม่มี source = เคมี)
--
-- Rollback (ตารางใหม่มีแต่ข้อมูลทดสอบ) ลำดับสำคัญ:
--   1) คืนนิยามเดิมของ public.app_rf_save และ private.sandbox_unguarded_tables จาก 20261110010000_rf_purchase_orders.sql, public.app_sandbox_purge_bom จาก 20261109010000_sandbox_purge_fast.sql,
--      public.app_bom_save_master จาก 20261108020000_bom_release_opens_rubberflow_orders.sql, private.bom_records / bom_delta / bom_client_actions / bom_staff_actions จาก
--      20261106010000_bom_orders_jobs.sql ด้วยการรัน create or replace จากไฟล์เหล่านั้น (รวม revoke/grant ท้ายฟังก์ชัน) · ทำข้อ 1 ก่อนข้อ 2 เพื่อให้ app_bom_save_master เดิมเรียกลายเซ็นเดิมของ bom_save_jobs
--   2) drop function private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) แล้วสร้าง private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint)
--      ใหม่ตามนิยามใน 20261108020000_bom_release_opens_rubberflow_orders.sql · คืน private.rf_po_parse_lines / rf_save_purchase_orders จาก 20261110010000_rf_purchase_orders.sql
--   3) drop function private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint), private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint)
--   4) drop table public.bom_stock_moves, public.bom_stock
--   ข้อมูลทดสอบของสต็อก/ประวัติหายไปพร้อมกัน · งานของซื้อที่สร้างตอนปล่อยผลิตอยู่ใน bom_jobs ต่อ (ไม่ถูกย้อน) · บรรทัด bom ใน rf_purchase_orders.lines คงอยู่ (jsonb)
-- ============================================================================

-- 1. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
-- สต็อกของซื้อ: หนึ่งแถวต่อรหัสชิ้น PURCHASED ต่อโหมด (ตัวเขียนตรวจว่าเป็น PURCHASED ที่มีอยู่) ไม่มี foreign key ไปชิ้นงาน
create table public.bom_stock (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  item_code text not null check (char_length(item_code) between 1 and 60),
  qty numeric not null default 0 check (qty >= 0 and qty <= 1000000000),
  safety_qty numeric not null default 0 check (safety_qty >= 0 and safety_qty <= 1000000000),
  counted_at timestamptz,
  counted_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (item_code, is_test)
);
comment on table public.bom_stock is 'ยอดคงเหลือและสต็อกขั้นต่ำของชิ้นส่วนของซื้อ (PURCHASED) หนึ่งแถวต่อรหัส · ยอดเปลี่ยนผ่าน app_bom_save_master (นับ / เบิกจ่าย) และ app_rf_save (รับเข้าตามใบสั่งซื้อ) เท่านั้น';
comment on column public.bom_stock.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (trigger bom_stamp_version ตั้งให้ ไม่รับจาก client) ใช้ตรวจชนรายระเบียนและคำนวณ delta';

-- ประวัติการเคลื่อนไหว: เขียนต่อท้ายโดยเซิร์ฟเวอร์เท่านั้น (ไม่มีการแก้/ลบ) qty เป็นค่าเปลี่ยนมีเครื่องหมาย balance เป็นยอดหลังรายการ
create table public.bom_stock_moves (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  item_code text not null check (char_length(item_code) between 1 and 60),
  kind text not null check (kind in ('count', 'receive', 'issue')),
  qty numeric not null check (qty <> 0 and qty >= -1000000000 and qty <= 1000000000),
  balance numeric not null check (balance >= 0 and balance <= 1000000000),
  -- เลข PI ตอนเบิกจ่าย / เลข PO ตอนรับเข้า / null ตอนนับ
  ref text check (ref is null or char_length(ref) between 1 and 60),
  created_by uuid references public.employees(id) on delete set null,
  -- clock_timestamp: รายการหลายรายการในธุรกรรมเดียวกัน (เบิกจ่ายหลายรายการ) เรียงตามลำดับที่เขียนจริง
  created_at timestamptz not null default clock_timestamp(),
  unique (id, is_test)
);
comment on table public.bom_stock_moves is 'ประวัติการเคลื่อนไหวของ bom_stock (count / receive / issue) เขียนต่อท้ายโดยเซิร์ฟเวอร์ ไม่มีสิทธิ์เขียนจาก client';
comment on column public.bom_stock_moves.changed_version is 'เวอร์ชันที่เขียนแถวนี้ (ดู bom_stock.changed_version)';

create index bom_stock_changed_idx on public.bom_stock (is_test, changed_version);
create index bom_stock_moves_changed_idx on public.bom_stock_moves (is_test, changed_version);

-- แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ฟังก์ชัน trigger เดิมของ 20261105010000)
do $$
declare
  v_table text;
begin
  foreach v_table in array array['bom_stock', 'bom_stock_moves'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.sandbox_row_scope()', v_table || '_sandbox_scope', v_table);
    execute format(
      'create trigger %I before insert or update on public.%I '
      'for each row execute function private.bom_stamp_version()', v_table || '_stamp_version', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;

select private.lab_only_guard_table('public.bom_stock');
select private.lab_only_guard_table('public.bom_stock_moves');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261110010000_rf_purchase_orders.sql ทุกชื่อ แล้วเพิ่ม bom_stock, bom_stock_moves)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. รายการ action (นิยามจาก 20261106010000_bom_orders_jobs.sql เพิ่ม countPartStock, issueOrderParts) -----------------
create or replace function private.bom_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveItem', 'saveBom', 'saveBomTree', 'linkCompound', 'importFlat',
    'saveColor', 'saveColorSet', 'removeColorSet', 'learnColorSet', 'savePackage', 'removePackage', 'createVariant',
    'saveRouting', 'saveProcess', 'setItemCost', 'setItemImage',
    'createOrder', 'addOrderItem', 'removeOrderItem', 'updateOrderItem', 'explodeOrder', 'releaseOrder',
    'setStockCount', 'setStockCounts', 'cancelOrder', 'completeOrder',
    'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'saveCustomer',
    'countPartStock', 'issueOrderParts']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- action ที่คนนอกกลุ่มวางแผนเรียกได้ (ด่านหยาบ: สิทธิ์จริงตรวจรายส่วนและรายช่องใน app_bom_save_master และตัวเขียน)
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 3. ตัวเขียนใหม่ (private เรียกจาก app_bom_save_master / app_rf_save เท่านั้น) ------------------------------------------
-- สต็อกของซื้อ (action countPartStock): แถว { itemCode, qty?, safetyQty? } ไม่ส่งช่องใด = คงค่าเดิม ค่าเท่าที่เก็บ = ไม่ทำอะไร
-- ลำดับตรวจ: รูป/รหัส (ต้องเป็น PURCHASED ที่มีอยู่) -> ชนรายระเบียน (BOM_STALE) -> สิทธิ์รายช่อง: เปลี่ยนยอดต้องเป็นกลุ่มวางแผนหรือแผนก ST / WH, เปลี่ยนสต็อกขั้นต่ำต้องเป็นกลุ่มวางแผน (BOM_FORBIDDEN)
-- ยอดเปลี่ยน = เขียน 'count' (qty = ใหม่ - เก่า balance = ใหม่) และตั้ง counted_at / counted_by · คืนจำนวนแถวที่เขียน
create or replace function private.bom_save_stock(
  p_actor public.employees, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept text := private.bom_dept_of(p_actor);
  v_may_count boolean := p_planner or coalesce(v_dept in ('ST', 'WH'), false);
  v_row jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_qty numeric;
  v_safety numeric;
  v_old public.bom_stock%rowtype;
  v_found boolean;
  v_old_qty numeric;
  v_old_safety numeric;
  v_new_qty numeric;
  v_new_safety numeric;
  v_qty_changed boolean;
  v_n integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_STOCK'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_STOCK'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_STOCK'; end if;
    v_seen := v_seen || v_code;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_STOCK', 0, 1000000000);
    v_safety := private.bom_num(v_row -> 'safetyQty', 'BOM_INVALID_STOCK', 0, 1000000000);
    if not exists (select 1 from public.bom_items i where i.is_test and i.code = v_code and i.kind = 'PURCHASED') then
      raise exception 'BOM_INVALID_STOCK';
    end if;

    select * into v_old from public.bom_stock s where s.is_test and s.item_code = v_code for update;
    v_found := found;
    v_old_qty := case when v_found then v_old.qty else 0 end;
    v_old_safety := case when v_found then v_old.safety_qty else 0 end;
    v_new_qty := coalesce(v_qty, v_old_qty);
    v_new_safety := coalesce(v_safety, v_old_safety);
    -- ค่าเท่าที่เก็บ (สำเนาที่ client ได้จากเซิร์ฟเวอร์) หรือแถวที่ยังไม่มีและขอ 0 / 0 = ไม่ทำอะไร
    if v_new_qty = v_old_qty and v_new_safety = v_old_safety then continue; end if;
    if v_found and v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    v_qty_changed := v_new_qty <> v_old_qty;
    if v_qty_changed and not v_may_count then raise exception 'BOM_FORBIDDEN'; end if;
    if v_new_safety <> v_old_safety and not p_planner then raise exception 'BOM_FORBIDDEN'; end if;

    if v_found then
      update public.bom_stock set
        qty = v_new_qty, safety_qty = v_new_safety,
        counted_at = case when v_qty_changed then now() else counted_at end,
        counted_by = case when v_qty_changed then p_actor.id else counted_by end,
        updated_at = now()
      where id = v_old.id;
    else
      insert into public.bom_stock (is_test, item_code, qty, safety_qty, counted_at, counted_by)
      values (true, v_code, v_new_qty, v_new_safety, case when v_qty_changed then now() end, case when v_qty_changed then p_actor.id end);
    end if;
    if v_qty_changed then
      insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
      values (true, v_code, 'count', v_new_qty - v_old_qty, v_new_qty, null, p_actor.id);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- เบิกจ่ายของซื้อรายใบ PI (action issueOrderParts): เรียกหลัง private.bom_save_jobs ซึ่งตรวจชนรายระเบียนของงานแล้วและข้ามแถวผลงานของงานของซื้อให้ฟังก์ชันนี้เขียนเอง
-- ผู้เรียกต้องเป็นกลุ่มวางแผนหรือแผนก ST · แถวต้องเป็นทุกงาน PURCHASED / ST ที่ยังไม่ done ของใบเดียวพอดี แต่ละแถว status 'done' และ qtyDone = qtyPlanned (ที่เก็บ)
-- ใบต้อง released / in_progress · ทุกรายการต้องมีสต็อกพอสำหรับส่วนที่เหลือ (qty_planned - qty_done) ไม่เช่นนั้นไม่เขียนอะไร (BOM_INSUFFICIENT_STOCK หรือ BOM_STALE ถ้าแถวสต็อกเปลี่ยนหลังเวอร์ชันฐาน)
-- ผ่านแล้ว: หักสต็อก เขียน 'issue' (ref = เลข PI) ตั้งงานเป็น done (qty_done = qty_planned, done_at) ในธุรกรรมเดียว · คืนจำนวนงานที่จ่าย
create or replace function private.bom_issue_parts(
  p_actor public.employees, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept text := private.bom_dept_of(p_actor);
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_order uuid;
  v_ord public.bom_orders%rowtype;
  v_job public.bom_jobs%rowtype;
  v_jobs uuid[] := '{}';
  v_remaining numeric;
  v_stock numeric;
  v_short boolean := false;
  v_n integer := 0;
begin
  if not (p_planner or coalesce(v_dept = 'ST', false)) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'BOM_INVALID_JOB'; end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_job from public.bom_jobs j where j.is_test and j.job_no = v_no;
    if not found or v_job.kind <> 'PURCHASED' or v_job.dept <> 'ST' or v_job.status = 'done' then raise exception 'BOM_INVALID_JOB'; end if;
    if v_order is not null and v_order <> v_job.order_pk then raise exception 'BOM_INVALID_JOB'; end if;
    v_order := v_job.order_pk;
    if private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB') <> 'done'
       or private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000) is distinct from v_job.qty_planned
       or private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000) is distinct from v_job.qty_planned then
      raise exception 'BOM_INVALID_JOB';
    end if;
    v_jobs := v_jobs || v_job.id;
  end loop;

  select * into v_ord from public.bom_orders o where o.id = v_order for update;
  if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- ต้องครบทุกงานของซื้อที่ยังไม่เสร็จของใบ (แถวไม่ซ้ำและเป็นงานเหล่านั้นทั้งหมดแล้ว จึงเทียบจำนวนพอ)
  if (select count(*) from public.bom_jobs j
      where j.is_test and j.order_pk = v_order and j.dept = 'ST' and j.kind = 'PURCHASED' and j.status <> 'done') <> cardinality(v_jobs) then
    raise exception 'BOM_INVALID_JOB';
  end if;

  -- สต็อกพอทุกรายการหรือไม่จ่ายอะไรเลย (ล็อกแถวสต็อกเรียงตามรหัส)
  for v_job in select * from public.bom_jobs j where j.id = any (v_jobs) order by j.item_code collate "C" loop
    perform 1 from public.bom_stock s where s.is_test and s.item_code = v_job.item_code for update;
    v_remaining := v_job.qty_planned - v_job.qty_done;
    v_stock := coalesce((select s.qty from public.bom_stock s where s.is_test and s.item_code = v_job.item_code), 0);
    if v_remaining > v_stock then v_short := true; end if;
  end loop;
  if v_short then
    if exists (select 1 from public.bom_stock s join public.bom_jobs j on j.item_code = s.item_code
               where j.id = any (v_jobs) and s.is_test and s.changed_version > p_base and s.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    raise exception 'BOM_INSUFFICIENT_STOCK';
  end if;

  for v_job in select * from public.bom_jobs j where j.id = any (v_jobs) order by j.item_code collate "C" loop
    v_remaining := v_job.qty_planned - v_job.qty_done;
    if v_remaining > 0 then
      v_stock := (select s.qty from public.bom_stock s where s.is_test and s.item_code = v_job.item_code);
      update public.bom_stock set qty = v_stock - v_remaining, updated_at = now() where is_test and item_code = v_job.item_code;
      insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
      values (true, v_job.item_code, 'issue', -v_remaining, v_stock - v_remaining, v_ord.pi_no, p_actor.id);
    end if;
    update public.bom_jobs set status = 'done', qty_done = qty_planned, done_at = coalesce(done_at, now()), updated_at = now() where id = v_job.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- ล็อกตัวนับ BOM ฝั่ง RF ใช้ private.rf_lock_bom() เดิมของ 20261107010000 (ไม่สร้างฟังก์ชันใหม่)
-- 4. งานรายแผนก: ช่องผลงานของงานของซื้อ (PURCHASED / ST) เขียนได้เฉพาะ action issueOrderParts (นิยามจาก 20261108020000 แล้วเพิ่ม p_action และด่านข้างบน) ------------
drop function if exists private.bom_save_jobs(public.employees, text, boolean, jsonb, uuid[], bigint, bigint);
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_started uuid[] := '{}';
  v_dept_actor text := private.bom_dept_of(p_actor);
  v_no text;
  v_ord public.bom_orders%rowtype;
  v_dept text;
  v_item text;
  v_name text;
  v_kind text;
  v_uom text;
  v_planned numeric;
  v_required numeric;
  v_stock numeric;
  v_done numeric;
  v_reject numeric;
  v_due numeric;
  v_status text;
  v_fg jsonb;
  v_ext jsonb;
  v_reports jsonb;
  v_old public.bom_jobs%rowtype;
  v_struct boolean;
  v_work boolean;
  v_ext_changed boolean;
  v_good numeric;
  v_rej numeric;
  v_ext_stored jsonb;
  v_done_at timestamptz;
  v_present boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_ord from public.bom_orders o
    where o.is_test and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB'));
    if not found then raise exception 'BOM_INVALID_JOB'; end if;
    v_dept := private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT'));
    v_item := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_JOB'));
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_JOB');
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_JOB');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_JOB'; end if;
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_JOB');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_JOB'; end if;
    v_planned := private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000);
    v_required := private.bom_num(v_row -> 'qtyRequired', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_planned is null or v_required is null then raise exception 'BOM_INVALID_JOB'; end if;
    v_stock := private.bom_num(v_row -> 'stockCounted', 'BOM_INVALID_JOB', 0, 1000000000);
    v_done := coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_reject := coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_due := private.bom_num(v_row -> 'dueAt', 'BOM_INVALID_JOB', 1, 100000000000000);
    if v_due is not null and v_due <> trunc(v_due) then raise exception 'BOM_INVALID_JOB'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB');
    if v_status not in ('queued', 'in_progress', 'done', 'hold') then raise exception 'BOM_INVALID_JOB'; end if;
    v_node := v_row -> 'fgCodes';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 500 then raise exception 'BOM_INVALID_JOB'; end if;
    v_fg := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or char_length(btrim(v_el #>> '{}')) not between 1 and 60 then raise exception 'BOM_INVALID_JOB'; end if;
      v_fg := v_fg || jsonb_build_array(private.bom_code(v_el #>> '{}'));
    end loop;
    v_ext := private.bom_parse_external_ref(v_row -> 'externalRef');

    select * into v_old from public.bom_jobs j where j.is_test and j.job_no = v_no;
    -- ชนก่อนสิทธิ์/รูปเสมอ: งานถูกคนอื่นแก้หลังเวอร์ชันฐาน หรือถูกลบหลังเวอร์ชันฐาน (เปิดใบกลับมาแก้ / ยกเลิก) = ฝั่ง client ถือสำเนาเก่า
    -- เทียบกับแถวล่าสุดแล้วตัดสินว่าไม่มีสิทธิ์ไม่ได้ (สองคนในแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน คนที่สองต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN)
    v_present := found;
    if v_present then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    elsif exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no
                  and k.changed_version > p_base and k.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    if not v_present then
      -- งานใหม่: เกิดตอนปล่อยผลิตเท่านั้น (ใบ draft -> released ในคำสั่งเดียวกัน) เริ่มที่ queued ว่าง
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if not (v_ord.id = any (p_released)) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_status <> 'queued' or v_done <> 0 or v_reject <> 0 or v_ext is not null
         or jsonb_array_length(private.bom_parse_reports(v_row -> 'reports', '[]'::jsonb, p_actor_name)) > 0 then
        raise exception 'BOM_INVALID_JOB';
      end if;
      delete from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values (true, v_no, v_ord.id, v_dept, v_item, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
      continue;
    end if;

    v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

    -- งานของซื้อของ ST (PURCHASED / ST): ช่องผลงาน (status, qty_done, qty_reject, reports) เปลี่ยนได้ทางเดียวคือ action issueOrderParts เท่านั้น (ผู้ทำ/ผู้วางแผนก็เช่นกัน)
    -- ภายใต้ action นั้นตัวเขียนนี้ตรวจชน (ข้างบน) และสถานะใบ แล้วข้ามแถวไป: private.bom_issue_parts ตั้งงานเป็น done หักสต็อก และเขียนประวัติเอง
    if v_work and ((v_old.kind = 'PURCHASED' and v_old.dept = 'ST') or (v_kind = 'PURCHASED' and v_dept = 'ST')) then
      if p_action is distinct from 'issueOrderParts' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_struct or v_ext_changed or v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if;
      select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
      if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_ord.status = 'released' then v_started := v_started || v_ord.id; end if;
      continue;
    end if;

    -- สิทธิ์รายช่อง
    if not p_planner then
      -- แผนกอื่นแก้ชื่อ จำนวนแผน วันครบกำหนด ชิ้นงาน ใบ ฯลฯ ไม่ได้
      if v_struct then raise exception 'BOM_FORBIDDEN'; end if;
      -- รายงาน/สถานะ/ยอด: พนักงานแผนกเดียวกับงาน (ทุกบทบาท)
      if v_work and v_dept_actor is distinct from v_old.dept then raise exception 'BOM_FORBIDDEN'; end if;
      -- ผูก WO: พนักงานแผนก RB เฉพาะงานที่ยังไม่ผูก
      if v_ext_changed and (v_dept_actor is distinct from 'RB' or v_old.external_ref is not null or v_ext is null) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;
    if v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if; -- ย้ายงานไปใบอื่นไม่ได้
    -- แก้งานได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด (อ่านสถานะล่าสุดหลังเปลี่ยนสถานะใบในคำสั่งนี้)
    select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;

    if not p_planner and v_work then
      -- งานที่ done แล้วพนักงานแผนกแก้ไม่ได้ · ยอดเพิ่มได้อย่างเดียวและต้องมาพร้อมรายงาน (ผลรวมดี/เสียของรายการใหม่เท่าส่วนที่เพิ่ม)
      if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
      select coalesce(sum((t.value ->> 'good')::numeric), 0), coalesce(sum((t.value ->> 'reject')::numeric), 0)
      into v_good, v_rej
      from jsonb_array_elements(v_reports) with ordinality as t(value, ord)
      where t.ord > jsonb_array_length(v_old.reports);
      if abs((v_done - v_old.qty_done) - v_good) > 0.001 or abs((v_reject - v_old.qty_reject) - v_rej) > 0.001 then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    v_done_at := case when v_status = 'done' then coalesce(v_old.done_at, now()) else null end;
    v_ext_stored := case
      when not v_ext_changed then v_old.external_ref
      when v_ext is null then null
      else v_ext || jsonb_build_object('linkedAt', private.bom_ms(now()), 'by', p_actor_name) end;
    update public.bom_jobs set
      dept = v_dept, item_code = v_item, name = v_name, kind = v_kind, uom = v_uom, qty_planned = v_planned, qty_required = v_required,
      stock_counted = v_stock, due_at = v_due::bigint, fg_codes = v_fg, status = v_status, qty_done = v_done, qty_reject = v_reject,
      reports = v_reports, external_ref = v_ext_stored, done_at = v_done_at, updated_at = now()
    where id = v_old.id;

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return v_started;
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 5. snapshot / delta (นิยามจาก 20261106010000 แล้วเพิ่มชุด stock, stockMoves) ------------------------------
-- stock = ยอดคงเหลือต่อรหัสของซื้อ เรียงตามรหัส · stockMoves = ประวัติเรียงตามเวลาแล้ว id · ชุด delete ของสองชุดนี้เป็น [] (ไม่มีการลบ) · ครบสิบสามชุดเสมอ
create or replace function private.bom_records(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', i.code, 'kind', i.kind, 'name', i.name, 'ownerDept', i.owner_dept, 'uom', i.uom,
          'weightG', i.weight_g, 'rubber', i.rubber, 'legacyCodes', i.legacy_codes, 'active', i.active,
          'group', i.item_group, 'createdAt', private.bom_ms(i.created_at), 'updatedAt', private.bom_ms(i.updated_at))
        || case when i.unit_cost is null then '{}'::jsonb else jsonb_build_object('unitCost', i.unit_cost) end
        || case when i.image is null then '{}'::jsonb else jsonb_build_object('image', i.image) end
        || case when i.imported_from is null then '{}'::jsonb else jsonb_build_object('importedFrom', i.imported_from) end
        || case when i.cloned_from is null then '{}'::jsonb else jsonb_build_object('clonedFrom', i.cloned_from) end
        order by i.code collate "C")
      from public.bom_items i where i.is_test and i.changed_version > p_since), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name, 'country', c.country, 'orderType', c.order_type, 'note', c.note,
          'createdAt', private.bom_ms(c.created_at)) order by lower(c.name) collate "C", c.name collate "C")
      from public.bom_customers c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.pi_no, 'customer', o.customer, 'country', o.country, 'orderType', o.order_type,
          'orderedAt', o.ordered_at, 'whDue', o.wh_due, 'due', o.due, 'dueDefaults', o.due_defaults,
          'revision', o.revision, 'status', o.status, 'items', o.items, 'explosion', o.explosion,
          'explodedAt', private.bom_ms(o.exploded_at), 'stockCounts', o.stock_counts, 'note', o.note,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at))
        || case when o.stock_counted_at is null then '{}'::jsonb
                else jsonb_build_object('stockCountedAt', private.bom_ms(o.stock_counted_at),
                                        'stockCountedBy', coalesce(private.bom_person(o.stock_counted_by), '')) end
        || case when o.released_at is null then '{}'::jsonb
                else jsonb_build_object('releasedAt', private.bom_ms(o.released_at),
                                        'releasedBy', coalesce(private.bom_person(o.released_by), '')) end
        || case when o.completed_at is null then '{}'::jsonb else jsonb_build_object('completedAt', private.bom_ms(o.completed_at)) end
        || case when o.cancelled_at is null then '{}'::jsonb
                else jsonb_build_object('cancelledAt', private.bom_ms(o.cancelled_at), 'cancelReason', o.cancel_reason) end
        order by o.ordered_at desc, o.pi_no collate "C")
      from public.bom_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
    'jobs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', j.job_no, 'orderId', o.pi_no, 'dept', j.dept, 'itemCode', j.item_code, 'name', j.name, 'kind', j.kind, 'uom', j.uom,
          'qtyPlanned', j.qty_planned, 'qtyRequired', j.qty_required, 'stockCounted', j.stock_counted,
          'qtyDone', j.qty_done, 'qtyReject', j.qty_reject, 'dueAt', j.due_at, 'status', j.status,
          'externalRef', j.external_ref, 'fgCodes', j.fg_codes, 'reports', j.reports, 'createdAt', private.bom_ms(j.created_at))
        || case when j.done_at is null then '{}'::jsonb else jsonb_build_object('doneAt', private.bom_ms(j.done_at)) end
        order by o.pi_no collate "C", j.dept collate "C", j.item_code collate "C", j.job_no collate "C")
      from public.bom_jobs j join public.bom_orders o on o.id = j.order_pk
      where j.is_test and j.changed_version > p_since), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemCode', s.item_code, 'qty', s.qty, 'safetyQty', s.safety_qty, 'countedAt', private.bom_ms(s.counted_at),
          'countedBy', coalesce(private.bom_person(s.counted_by), ''), 'updatedAt', private.bom_ms(s.updated_at))
        order by s.item_code collate "C")
      from public.bom_stock s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'stockMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty, 'balance', m.balance, 'ref', m.ref,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''))
        order by m.created_at, m.id)
      from public.bom_stock_moves m where m.is_test and m.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

create or replace function private.bom_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.bom_master_state s where s.is_test), 0),
    'epoch', (select s.epoch from public.bom_master_state s where s.is_test),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object(
        'upsert', r.records -> l.list,
        'delete', case
          when l.list in ('colorSets', 'packages') then coalesce((
            select jsonb_agg(jsonb_build_object('base', k.base, 'code', k.code) order by k.base collate "C", k.code collate "C")
            from public.bom_deleted_keys k where k.is_test and k.list = l.list and k.changed_version > p_since), '[]'::jsonb)
          when l.list = 'jobs' then coalesce((
            select jsonb_agg(jsonb_build_object('id', k.code, 'code', k.code) order by k.code collate "C")
            from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.changed_version > p_since), '[]'::jsonb)
          else '[]'::jsonb end))
      from (values ('items'), ('compounds'), ('colors'), ('colorSets'), ('packages'), ('boms'), ('processes'), ('routings'),
                   ('customers'), ('orders'), ('jobs'), ('stock'), ('stockMoves')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;
revoke all on function private.bom_delta(bigint) from public, anon, authenticated;

-- 6. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261108020000 แล้วเพิ่มส่วน stock, action countPartStock / issueOrderParts และ p_action ของตัวเขียนงาน) ------------
create or replace function public.app_bom_save_master(
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
  v_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                      'customers', 'orders', 'jobs', 'stock'];
  -- ส่วนที่เขียนได้เฉพาะกลุ่มวางแผน (orders / jobs ตรวจรายช่องในตัวเขียน)
  v_planner_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings',
                                              'customers'];
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
  v_row jsonb;
  v_dbase text;
  v_dcode text;
  v_row_version bigint;
  v_item_codes text[] := '{}';
  v_roots text[] := '{}';
  v_touched text[];
  v_released uuid[] := '{}';
  v_started uuid[] := '{}';
  v_bad text;
  v_res jsonb;
  v_oid uuid;
  v_delta jsonb;
  v_rf_opened jsonb := '[]'::jsonb;
  v_rf_skipped jsonb := '[]'::jsonb;
  v_rf_cancelled jsonb := '[]'::jsonb;
  v_rf_n integer;
  v_rf_cancel_n integer := 0;
  v_rf_reopen_n integer := 0;
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
  v_stock_n integer;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_actor();
  v_planner := private.bom_can_edit(v_actor);
  -- ด่านหยาบ: คนนอกกลุ่มวางแผนเรียกได้เฉพาะ action ของนับคงคลัง/รายงานงาน (สิทธิ์จริงตรวจรายส่วนและรายช่องข้างล่าง)
  if not v_planner and (p_action is null or not (p_action = any (private.bom_staff_actions()))) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action is null or not (p_action = any (private.bom_client_actions())) then raise exception 'BOM_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null or p_base_version < 0 then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- audit ของ client: [{action, detail}] ไม่เกิน 20 รายการ
  if p_audit is not null and jsonb_typeof(p_audit) <> 'null' then
    if jsonb_typeof(p_audit) <> 'array' or jsonb_array_length(p_audit) > 20 then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_entry in select value from jsonb_array_elements(p_audit) loop
      if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_audit := v_audit || jsonb_build_array(jsonb_build_object(
        'action', private.bom_text(v_entry, 'action', 80, 1, 'BOM_INVALID_PAYLOAD'),
        'detail', private.bom_text(v_entry, 'detail', 300, 0, 'BOM_INVALID_PAYLOAD')));
    end loop;
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert (ทุกส่วน) / delete (เฉพาะ colorSets, packages และ jobs), เป็นอาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if not (v_sub = 'upsert' or (v_sub = 'delete' and v_key in ('colorSets', 'packages', 'jobs'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'BOM_TOO_MANY'; end if;
      -- สต็อกของซื้อ: ส่วน stock ส่งได้เฉพาะ countPartStock และ countPartStock ส่งได้เฉพาะส่วน stock · issueOrderParts ส่งได้เฉพาะงาน (jobs upsert)
      if v_n > 0 and ((v_key = 'stock' and p_action <> 'countPartStock')
                      or (p_action = 'countPartStock' and v_key <> 'stock')
                      or (p_action = 'issueOrderParts' and not (v_key = 'jobs' and v_sub = 'upsert'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      -- ข้อมูลหลักและลูกค้าเขียนได้เฉพาะกลุ่มวางแผน
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับก่อนตรวจชน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็นเวอร์ชันของระเบียนที่คนแรกเพิ่งแก้ (changed_version) แล้วได้ BOM_STALE เฉพาะที่ชนกัน
  -- v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน) ระเบียนที่แก้ในคำสั่งนี้ได้ v_version + 1 จึงไม่ถูกนับว่าเป็นของคนอื่น
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.bom_master_state s where s.is_test for update;
  -- client ถือข้อมูลของรอบก่อนล้างข้อมูลทดสอบ: ไม่เขียนอะไร (ระเบียนที่มันถืออยู่ไม่มีแล้ว การบันทึกจะสร้างระเบียนที่ถูกล้างกลับมา)
  if p_epoch is not null and p_epoch <> v_epoch::text then raise exception 'BOM_RESET'; end if;
  if p_base_version > v_version then raise exception 'BOM_INVALID_PAYLOAD'; end if;
  if v_total = 0 then return private.bom_delta(p_base_version); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.bom_save_compounds(v_actor.id, coalesce(p_changes #> '{compounds,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_colors(v_actor.id, coalesce(p_changes #> '{colors,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_processes(v_actor.id, coalesce(p_changes #> '{processes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_item_codes := private.bom_save_items(v_actor.id, coalesce(p_changes #> '{items,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลบก่อนเขียน (ลบแล้วสร้างใหม่รหัสเดิมในคำสั่งเดียวกันได้) ไม่พบ = BOM_NOT_FOUND แต่ถ้าคนอื่นเพิ่งลบหลังเวอร์ชันฐาน = BOM_STALE
    -- แถวที่คนอื่นแก้หลังเวอร์ชันฐานลบไม่ได้ (BOM_STALE) · ที่ลบแล้วจดหลุมฝังศพไว้ให้ delta
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{colorSets,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
      select s.changed_version into v_row_version from public.bom_color_sets s where s.is_test and s.base = v_dbase and s.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'colorSets' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_color_sets where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'colorSets', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      select p.changed_version into v_row_version from public.bom_packages p where p.is_test and p.base = v_dbase and p.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'packages' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_packages where is_test and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values (true, 'packages', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลูกค้า → ใบสั่งผลิต (รวมเปลี่ยนสถานะ ลบงานของใบที่ยกเลิก/เปิดกลับมาแก้) → ลบงานตรง ๆ → งาน (เพิ่ม/แก้) ตามลำดับนี้เสมอ
    perform private.bom_save_customers(v_actor.id, coalesce(p_changes #> '{customers,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := array(select t.value::uuid from jsonb_array_elements_text(v_res -> 'released') as t(value));
    v_rf_cancel_n := jsonb_array_length(v_res -> 'cancelled');
    v_rf_reopen_n := jsonb_array_length(v_res -> 'reopened');
    v_rf_cancelled := (v_res -> 'cancelled') || (v_res -> 'reopened');
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_started := private.bom_save_jobs(v_actor, v_actor_name, v_planner, p_action, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                       v_released, p_base_version, v_version);
    -- สต็อกของซื้อ: นับ (countPartStock) / เบิกจ่ายรายใบ (issueOrderParts: ตัวเขียนงานตรวจชนและข้ามแถวผลงานของงานของซื้อมาแล้ว) ทั้งสองอยู่ในธุรกรรมเดียวกับงาน
    perform private.bom_save_stock(v_actor, v_planner, coalesce(p_changes #> '{stock,upsert}', '[]'::jsonb), p_base_version, v_version);
    if p_action = 'issueOrderParts' then
      v_stock_n := private.bom_issue_parts(v_actor, v_planner, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
      v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n));
    end if;
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    if exists (select 1 from unnest(v_released) r(id) where not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- เปิด WO ใน RubberFlow ให้งาน RB ของใบที่เพิ่งปล่อยผลิต (เปิดไม่ได้ = ข้ามพร้อมเหตุผล ไม่ทำให้การปล่อยล้ม)
    foreach v_oid in array v_released loop
      v_res := private.bom_open_rf_orders(v_actor, v_actor_name, v_oid);
      v_rf_opened := v_rf_opened || (v_res -> 'opened');
      v_rf_skipped := v_rf_skipped || (v_res -> 'skipped');
    end loop;

    -- ตรวจกฎ BOM หลังเขียนเฉพาะส่วนที่เกี่ยว: BOM ที่ approved ของชิ้นที่ถูกแก้/มี revision ใหม่ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก
    v_touched := v_item_codes || v_roots;
    if cardinality(v_touched) > 0 then
      -- ชนิดพ่อ/ลูก (rules.childKindError)
      select case when p.kind in ('PURCHASED', 'CP') then 'BOM_INVALID_PARENT_KIND' else 'BOM_INVALID_CHILD_KIND' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test and c.code = l.child_code
      where b.is_test and b.status = 'approved'
        and (b.item_code = any (v_touched) or l.child_code = any (v_touched))
        and (p.kind in ('PURCHASED', 'CP')
             or (p.kind = 'RB' and c.kind <> 'CP')
             or (c.kind = 'CP' and p.kind <> 'RB'))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;

      -- เส้นยาง: บรรทัดสูตรยางได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
      select case when x.n <> 1 then 'BOM_RB_ONE_COMPOUND' else 'BOM_RB_COMPOUND_MISMATCH' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test and b.status = 'approved' and b.item_code = any (v_touched)
        and (x.n <> 1
             or (coalesce(p.rubber ->> 'compound', '') <> '' and private.bom_code(p.rubber ->> 'compound') <> x.child))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;

    -- วงจร: เดินจากพ่อของ revision ใหม่ลงไปตาม BOM ที่ approved (วงจรใหม่เกิดจากเส้นใหม่เท่านั้น) เพดาน 30 ชั้น
    if cardinality(v_roots) > 0 then
      with recursive walk(code, path) as (
        select l.child_code, array[r.root, l.child_code]
        from unnest(v_roots) as r(root)
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = w.code
        join public.bom_bom_lines l on l.bom_pk = b.id
        where cardinality(w.path) < 30
          and not (w.code = any (w.path[1:cardinality(w.path) - 1]))
      )
      select case
               when bool_or(w.code = any (w.path[1:cardinality(w.path) - 1])) then 'BOM_CYCLE'
               when max(cardinality(w.path)) >= 30 then 'BOM_TOO_DEEP'
             end
      into v_bad
      from walk w;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  exception
    when unique_violation then
      raise exception 'BOM_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'BOM_INVALID_DATA';
  end;

  -- WO ที่เปิด/ยกเลิกในคำสั่งนี้: เพิ่ม version ของ RF อีก 1 ครั้งเดียว (แถวถูก trigger rf_stamp_version ประทับ version + 1 แล้ว) และเขียน audit ของ RF ให้ app_rf_master_since / หน้า audit เห็น
  -- ล็อกแถวตัวนับ RF ถูกถือแล้ว (bom_lock_rf ตอนเขียน WO) ไม่มี WO ที่เปิด/ยกเลิก = ไม่แตะ RF เลย
  v_rf_n := jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_cancelled);
  if v_rf_n > 0 then
    update public.rf_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test returning version into v_rf_version;
    -- แถว audit ละชนิด (ปล่อยผลิต / ยกเลิกใบ / เปิดใบกลับเป็นร่าง) ใช้ version ใหม่ตัวเดียวกัน
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_rf_version::text,
           jsonb_build_object('client_action', k.action, 'version', v_rf_version, 'base_version', v_rf_version - 1,
                              'counts', jsonb_build_object('orders', jsonb_build_object('upsert', k.n)),
                              'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                              'entries', '[]'::jsonb)
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n)) as k(ord, action, n)
    where k.n > 0
    order by k.ord;
  end if;
  if v_rf_n > 0 or jsonb_array_length(v_rf_skipped) > 0 then
    v_rf_meta := jsonb_build_object('rubberflow', jsonb_build_object(
      'opened', jsonb_array_length(v_rf_opened), 'skipped', jsonb_array_length(v_rf_skipped), 'cancelled', jsonb_array_length(v_rf_cancelled)));
  end if;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit) || v_rf_meta);
  v_delta := private.bom_delta(p_base_version);
  if v_rf_meta <> '{}'::jsonb then
    v_delta := v_delta || jsonb_build_object('rubberflow', jsonb_build_object('opened', v_rf_opened, 'skipped', v_rf_skipped, 'cancelled', v_rf_cancelled));
  end if;
  return v_delta;
end;
$$;

-- 7. ล้างข้อมูล BOM ทดสอบ (นิยามจาก 20261109010000_sandbox_purge_fast.sql เพิ่ม bom_stock_moves, bom_stock ลบก่อนแถวอื่น คงการพัก JWT claims ระหว่างลบ) ------------
create or replace function public.app_sandbox_purge_bom()
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

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_bom_save_master) การบันทึกที่กำลังทำอยู่จึงจบก่อน และไม่มีการบันทึกใหม่แทรกระหว่างลบ
  insert into public.bom_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.bom_master_state s where s.is_test for update;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) เพื่อให้ trigger รายแถว private.sandbox_row_scope ข้ามการหา persona
  -- (auth.uid() เป็น null = sandbox_scope_matches ตอบ true ทันที) ไม่เช่นนั้นการลบหลักหมื่นแถวเรียก persona หลักหมื่นครั้งจนเกิน statement_timeout 8 วินาที
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_table in array array[
    'bom_stock_moves', 'bom_stock', 'bom_jobs', 'bom_orders', 'bom_customers', 'bom_bom_lines', 'bom_boms', 'bom_routings', 'bom_color_sets', 'bom_packages',
    'bom_colors', 'bom_processes', 'bom_compounds', 'bom_items', 'bom_deleted_keys'
  ] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- คืน claims ก่อนอัปเดต epoch / เขียน audit (trigger ของตัวนับและ audit เห็นผู้เรียกเหมือนเดิม; audit ใช้ v_admin ที่อ่านไว้ก่อนแล้ว)
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ แถวที่สร้างหลังล้างจึงได้เวอร์ชันใหม่กว่าที่ client ใดเคยถือ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.bom_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.bom_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'BOM_SANDBOX_PURGE', 'bom_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล BOM ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- ตรวจและแปลงบรรทัดของ client เป็นรูป canonical (นิยามจาก 20261110010000_rf_purchase_orders.sql เพิ่ม source / uom ของบรรทัดของซื้อ)
-- ลำดับตามที่ส่งมา: 1-100 บรรทัด รหัสไม่ซ้ำ (ไม่แยกตัวพิมพ์) qtyKg > 0 · source 'rf' (เคมี ค่าเริ่มต้นเมื่อไม่ส่ง) | 'bom' (ของซื้อ รหัสยาวได้ 60 หน่วยเป็นหน่วยของชิ้น)
-- บรรทัด rf: receivedKg / lotNo / expiry ต้องมีครบทั้งสามหรือเป็น null ทั้งสาม · บรรทัด bom: lotNo / expiry เป็น null เสมอ (แม้รับแล้ว) receivedKg เป็น null หรือ > 0
-- receivedAt / receivedBy ของ client เมินเสมอ เซิร์ฟเวอร์ตั้ง · uom ของบรรทัด bom เซิร์ฟเวอร์ตั้งจาก bom_items ตอนสร้างใบ (ค่านี้ใช้เฉพาะแสดงผลจนกว่าจะถูกแทน)
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
  v_source text;
  v_uom text;
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
    v_code := private.bom_text(v_line, 'materialCode', 60, 1, 'RF_INVALID_PURCHASE');
    if upper(v_code) = any (v_seen) then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_seen := v_seen || upper(v_code);
    v_source := coalesce(nullif(private.bom_text(v_line, 'source', 10, 0, 'RF_INVALID_PURCHASE'), ''), 'rf');
    if v_source not in ('rf', 'bom') then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_uom := nullif(private.bom_text(v_line, 'uom', 20, 0, 'RF_INVALID_PURCHASE'), '');
    v_qty := private.bom_num(v_line -> 'qtyKg', 'RF_INVALID_PURCHASE', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_recv := private.bom_num(v_line -> 'receivedKg', 'RF_INVALID_PURCHASE', 0, 1000000000);
    v_lot := nullif(private.bom_text(v_line, 'lotNo', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_exp := private.bom_num(v_line -> 'expiry', 'RF_INVALID_PURCHASE', 1, 100000000000000);
    if v_source = 'bom' then
      if v_lot is not null or v_exp is not null or (v_recv is not null and v_recv <= 0) then raise exception 'RF_INVALID_PURCHASE'; end if;
    elsif v_recv is null then
      if v_lot is not null or v_exp is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
    elsif v_recv <= 0 or v_lot is null or v_lot !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_exp is null or v_exp <> trunc(v_exp) then
      raise exception 'RF_INVALID_PURCHASE';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'materialCode', v_code,
      'source', v_source,
      'uom', case when v_source = 'bom' then v_uom end,
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

-- ใบสั่งซื้อ (นิยามจาก 20261110010000_rf_purchase_orders.sql เพิ่มบรรทัดของซื้อ source 'bom'): คืน { receipt, bomStock, partReceipt }
--   receipt = ข้อมูลล็อตเคมีที่ต้องเกิดในคำสั่งเดียวกัน (null เมื่อไม่มีการรับ หรือรับบรรทัดของซื้อ) · bomStock = จำนวนแถว bom_stock ที่เขียน (app_rf_save เพิ่มเวอร์ชัน BOM ถ้ามากกว่า 0)
--   partReceipt = รับบรรทัดของซื้อ (app_rf_save ตรวจว่าไม่มีล็อตวัตถุดิบเปลี่ยนในคำสั่งเดียวกัน)
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
  v_src text;
  v_item public.bom_items%rowtype;
  v_stock public.bom_stock%rowtype;
  v_bal numeric;
  v_safety numeric;
  v_bom_n integer := 0;
  v_part boolean := false;
  v_locked boolean := false;
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
          if coalesce(v_sl ->> 'source', 'rf') is distinct from (v_nl ->> 'source')
             or (v_sl ->> 'materialCode') is distinct from (v_nl ->> 'materialCode')
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
      v_src := coalesce(v_sl ->> 'source', 'rf');
      if v_src = 'bom' then
        -- บรรทัดของซื้อ: บวกยอดคงเหลือ + ประวัติ 'receive' (ref = เลขใบ) ไม่มีล็อต/วันหมดอายุ (ตัวแยกวิเคราะห์บรรทัดบังคับ lotNo / expiry เป็น null แล้ว)
        -- ชิ้นต้องยังเป็นของซื้อที่มีอยู่ใน item master (เปลี่ยนชนิดหรือหายไปหลังสั่งแล้ว = รับเข้าไม่ได้)
        if not exists (select 1 from public.bom_items i where i.is_test and i.code = (v_sl ->> 'materialCode') and i.kind = 'PURCHASED') then
          raise exception 'RF_INVALID_PURCHASE';
        end if;
        -- ล็อกตัวนับ BOM (private.rf_lock_bom: rf_master_state ถูกล็อกก่อนแล้วใน app_rf_save) แล้วค่อยเขียนแถวสต็อก
        if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
        select * into v_stock from public.bom_stock s where s.is_test and s.item_code = (v_sl ->> 'materialCode') for update;
        if found then
          v_bal := v_stock.qty + v_kg;
          if v_bal > 1000000000 then raise exception 'RF_INVALID_PURCHASE'; end if;
          update public.bom_stock set qty = v_bal, updated_at = now() where id = v_stock.id;
        else
          v_bal := v_kg;
          insert into public.bom_stock (is_test, item_code, qty) values (true, v_sl ->> 'materialCode', v_bal);
        end if;
        insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
        values (true, v_sl ->> 'materialCode', 'receive', v_kg, v_bal, v_no, p_actor.id);
        v_bom_n := v_bom_n + 1;
        v_part := true;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_kg, 'lotNo', null::text, 'expiry', null::bigint, 'receivedAt', v_ms, 'receivedBy', p_actor_name));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when exists (select 1 from jsonb_array_elements(v_final) l where jsonb_typeof(l -> 'receivedKg') = 'null')
                        then 'ordered' else 'received' end,
          updated_at = now()
        where id = v_old.id;
      else
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
      end if;
    else
      -- ใบใหม่: กลุ่มวางแผนหรือสมาชิก RB เท่านั้น ต้อง ordered ไม่มีข้อมูลรับเข้า วัตถุดิบทุกบรรทัดต้องมีอยู่และ active
      if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'createPurchaseOrder' or v_status <> 'ordered' then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_final := '[]'::jsonb;
      for v_nl in select value from jsonb_array_elements(v_lines) loop
        if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_nl ->> 'source' = 'bom' then
          -- ของซื้อ: ต้องเป็นชิ้น PURCHASED ที่มีอยู่ (รหัสตามที่เก็บ หน่วยจาก bom_items) · สต็อกขั้นต่ำที่ต่างจาก bom_stock.safety_qty (ไม่มีแถว = 0) เซิร์ฟเวอร์ upsert ให้
          select * into v_item from public.bom_items i where i.is_test and i.code = private.bom_code(v_nl ->> 'materialCode') and i.kind = 'PURCHASED';
          if not found then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_safety := (v_nl ->> 'safetyKg')::numeric;
          if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
          select * into v_stock from public.bom_stock s where s.is_test and s.item_code = v_item.code for update;
          if found then
            if v_stock.safety_qty <> v_safety then
              -- สต็อกขั้นต่ำเปลี่ยนได้เฉพาะกลุ่มวางแผน (สมาชิก RB สร้างใบที่ไม่แตะสต็อกขั้นต่ำได้)
              if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
              update public.bom_stock set safety_qty = v_safety, updated_at = now() where id = v_stock.id;
              v_bom_n := v_bom_n + 1;
            end if;
          elsif v_safety <> 0 then
            if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
            insert into public.bom_stock (is_test, item_code, qty, safety_qty) values (true, v_item.code, 0, v_safety);
            v_bom_n := v_bom_n + 1;
          end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_item.code, 'uom', v_item.uom, 'receivedAt', null::bigint, 'receivedBy', null::text));
        else
          select * into v_mat from public.rf_materials m where m.is_test and upper(m.code) = upper(v_nl ->> 'materialCode');
          if not found or not v_mat.active then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_mat.code, 'receivedAt', null::bigint, 'receivedBy', null::text));
        end if;
      end loop;
      insert into public.rf_purchase_orders (is_test, po_no, status, source_pi, source_requisition, note, lines, created_by)
      values (true, v_no, 'ordered', v_pi, v_req, v_note, v_final, p_actor.id);
    end if;
  end loop;
  return jsonb_build_object('receipt', v_receipt, 'bomStock', v_bom_n, 'partReceipt', v_part);
end;
$$;
revoke all on function private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 8. RPC ของ RubberFlow: นิยามจาก 20261110010000_rf_purchase_orders.sql เพิ่มการนับแถว bom_stock ที่ใบสั่งซื้อเขียน (เพิ่มเวอร์ชัน BOM + audit BOM_MASTER_SAVE ครั้งเดียว) และตรวจรับบรรทัดของซื้อไม่มีล็อตมาด้วย ------------
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
  v_bom_stock integer := 0;
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
    v_bom_stock := coalesce((v_po ->> 'bomStock')::integer, 0);
    perform private.rf_save_material_lots(v_actor.id, v_planner, v_st, v_qa, coalesce(p_changes #> '{materialLots,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_check_po_receipt(v_actor.id, v_po -> 'receipt', v_version);
    -- รับบรรทัดของซื้อ = ไม่มีล็อตวัตถุดิบมาด้วย (ล็อตที่ถูกเขียนในคำสั่งนี้ = ย้อนทั้งคำสั่ง)
    if coalesce((v_po ->> 'partReceipt')::boolean, false)
       and exists (select 1 from public.rf_material_lots t where t.is_test and t.changed_version > v_version) then
      raise exception 'RF_INVALID_PURCHASE';
    end if;
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
  if v_bom_jobs + v_bom_orders + v_bom_stock = 0
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
  if v_bom_jobs + v_bom_orders + v_bom_stock > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when v_bom_jobs > 0 then jsonb_build_object('upsert', v_bom_jobs) end,
                                 'orders', case when v_bom_orders > 0 then jsonb_build_object('upsert', v_bom_orders) end,
                                 'stock', case when v_bom_stock > 0 then jsonb_build_object('upsert', v_bom_stock) end)),
                               'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', v_bom_jobs, 'bom_orders', v_bom_orders, 'bom_stock', v_bom_stock,
                             'is_test', true, 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;

revoke all on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) from public, anon;
revoke all on function public.app_sandbox_purge_bom() from public, anon;
revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) to authenticated;
grant execute on function public.app_sandbox_purge_bom() to authenticated;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;
