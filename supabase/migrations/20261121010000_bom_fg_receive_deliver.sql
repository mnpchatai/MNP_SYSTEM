-- ============================================================================
-- BOM โหมดทดสอบ: แผนก WH (คลังสินค้า) รับของสำเร็จรูปเข้าคลัง · ใบสั่งผลิต (PI) ปิดอัตโนมัติเมื่อรับครบ · ส่งมอบลูกค้า (โหมดทดสอบเท่านั้น)
--
-- ทำไม: ผู้ใช้ตัดสิน 2026-11-14 ว่าขั้นที่ 5 ของใบ PI ไม่ใช่ "ปิดใบ" โดยกลุ่มวางแผนอีกต่อไป แต่เป็น "รับเข้าคลัง" โดยแผนก WH
--   เหตุ: ของสำเร็จรูปที่ PK รายงานแล้วต้องมีคนรับเข้าคลังจริง และใบจึงจะปิด · เดิมกลุ่มวางแผนกด completeOrder ได้โดยไม่มีการรับของ
--
-- กติกา (ยืนยันกับผู้ใช้ 2026-11-14)
--   1) WH รับของสำเร็จรูปต่อสินค้า (รหัส FG ของรายการในใบ) ทีละจำนวน รับหลายครั้งได้ · รับสะสมต่อสินค้า <= ยอดที่ PK รายงานแล้ว
--      (qty_done ของงานแผนก PK ชนิด FG ที่รหัสนั้นในใบ ไม่มีงาน = 0) เกิน = BOM_FG_EXCEEDS
--   2) ทุกสินค้ารับสะสม >= จำนวนที่สั่ง = ใบเปลี่ยนเป็น completed อัตโนมัติ (completed_at = เวลาเซิร์ฟเวอร์) ในธุรกรรมเดียวกับการรับ
--   3) PK ทำได้น้อยกว่าที่สั่ง: เมื่อทุกงาน PK ของใบ done และของที่ PK ทำได้รับครบแล้ว (รับสะสม = qty_done ของ PK ทุกสินค้า) และอย่างน้อยหนึ่งสินค้ารับน้อยกว่าที่สั่ง
--      WH กด "ปิดใบ (รับไม่ครบ)" พร้อมเหตุผล 3-300 ตัวอักษร (action closeOrderShort) = ใบ completed · ไม่ตรงเงื่อนไข = BOM_INVALID_TRANSITION
--   4) WH บันทึกส่งมอบลูกค้าต่อสินค้า ส่งมอบสะสม <= รับสะสม (ต่อใบ) ส่งได้ทั้งใบ released / in_progress / completed (ส่งหลังปิดใบได้) · เกิน = BOM_FG_EXCEEDS
--      "ส่งมอบแล้ว" ไม่มีสถานะใหม่ client คำนวณเอง: ใบ completed และทุกสินค้าส่งมอบสะสม >= รับสะสม (และรับ > 0 อย่างน้อยหนึ่งสินค้า)
--   5) ยอดคงคลังของสำเร็จรูปต่อรหัส = Σ รับ - Σ ส่งมอบ ทุกใบ (คำนวณจากประวัติ ไม่มีตารางยอด) แสดงอย่างเดียว ไม่ลดงาน PK ของใบ draft อื่น
--   6) ผู้ทำ: พนักงานแผนก WH (ทุกบทบาทของแผนก) หรือบทบาท admin เท่านั้น · กลุ่มวางแผน (PP, ผู้จัดการ) และแผนกอื่นดูอย่างเดียว (BOM_FORBIDDEN)
--      ไม่มีใครปิดใบผ่าน completeOrder อีก: action นี้ถูกตัดออกจาก private.bom_client_actions() และแถวใบที่จะเปลี่ยนเป็น completed ถูกปฏิเสธ BOM_FORBIDDEN ทุกชื่อ action ทุกผู้เรียก
--
-- ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test): bom_fg_moves (เขียนต่อท้ายโดยเซิร์ฟเวอร์ ไม่มีการแก้/ลบ) แบบเดียวกับ bom_stock_moves
--   trigger bom_fg_moves_sandbox_scope (is_test) + bom_fg_moves_stamp_version (changed_version) + RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only (private.lab_only_guard_table)
--   + ลงทะเบียนใน private.sandbox_unguarded_tables() + ล้างโดย app_sandbox_purge_bom (ก่อน bom_orders) · foreign key (order_pk, is_test) ไป bom_orders แบบเดียวกับ bom_jobs
--
-- รูปเรคอร์ดที่ส่ง/รับ (snapshot / delta เป็นสิบสี่ชุดเสมอ ชุดที่ Pilot รุ่นก่อนไม่รู้จักถูกเมิน)
--   fgMoves { id (uuid ข้อความ), orderId (เลข PI), fgCode (ว่างเมื่อ kind = 'close'), kind (receive | deliver | close), qty (0 เมื่อ close), note, at (ms), by (ชื่อ) }
--           เรียงตามเวลาแล้ว id · ชุด delete เป็น [] เสมอ
--
-- app_bom_save_master: ส่วนใหม่ fgMoves (upsert เท่านั้น ไม่อยู่ใน v_planner_sections: WH / admin ส่งได้ สิทธิ์ตรวจในตัวเขียน)
--   action ใหม่ในรายการ private.bom_client_actions() และ private.bom_staff_actions(): receiveFg, deliverFg, closeOrderShort · completeOrder ถูกตัดออกจากรายการ client
--   ส่วน fgMoves ส่งได้เฉพาะสามการกระทำนี้ และสามการกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG) · แถวเดียวต่อคำสั่ง
--     { orderId, kind ('receive' | 'deliver' | 'close' ต้องตรงกับ action: receiveFg / deliverFg / closeOrderShort), lines?: [{ fgCode, qty }], note? }
--   ตัวเขียนใหม่ private.bom_fg_move (ธุรกรรมเดียวกับ app_bom_save_master) ลำดับตรวจ:
--     รูปแถว (kind ตรง action, receive / deliver: lines 1-500 รหัสไม่ซ้ำ qty เป็นตัวเลข > 0 ไม่เกิน 1e9 note <= 300 · close: ไม่มี lines เหตุผล 3-300 = BOM_INVALID_FG)
--     -> สิทธิ์ WH / admin (BOM_FORBIDDEN) -> ล็อกแถวใบ (ไม่พบใบ หรือสินค้าไม่ใช่รายการของใบ = BOM_INVALID_FG) -> สถานะ (BOM_INVALID_TRANSITION) -> ยอด (BOM_FG_EXCEEDS)
--     receive: ใบ released / in_progress · deliver: released / in_progress / completed · close: released / in_progress + เงื่อนไขข้อ 3
--     เขียนประวัติหนึ่งแถวต่อบรรทัด (close หนึ่งแถว รหัสว่าง qty 0 เหตุผลอยู่ใน note) แล้วปิดใบตามข้อ 2 / 3 · เวอร์ชัน BOM เพิ่มครั้งเดียวต่อคำสั่ง · audit BOM_MASTER_SAVE นับ fgMoves ตามจำนวนแถวประวัติ และ orders +1 เมื่อใบถูกปิด
--   ไม่มี BOM_STALE ในกลุ่มนี้ (ยอดตรวจกับฐานข้อมูลโดยตรงใต้ล็อกแถวใบ) ยอดไม่พอ = BOM_FG_EXCEEDS ซึ่ง client ถือเป็นสำเนาเก่า (ตามทันแล้วแจ้งว่าตัวเลขเปลี่ยน)
--   ที่ผ่านมาปิดใบได้ทางแถวใบ (orders.upsert status completed โดยกลุ่มวางแผน) ตอนนี้ทุกแถวใบที่จะเปลี่ยนสถานะเป็น completed = BOM_FORBIDDEN (ตัวเขียน private.bom_save_orders)
--     เลือกแก้ในตัวเขียนใบ ไม่ใช่ตรวจใน app_bom_save_master ก่อนเรียก: ตัวเขียนเป็นด่านเดียวที่เห็นสถานะที่เก็บ + ค่า status ที่ parse แล้ว (ตัดช่องว่างเหมือนกัน)
--     การตรวจล่วงหน้าจากข้อความดิบของ payload เลี่ยงได้ด้วยรูปแบบที่ parse ต่างกัน และต้องจำลองการจับคู่เลข PI ซ้ำ
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดบน main ทุกตัว)
--   - private.sandbox_unguarded_tables จาก 20261113010000_master_account.sql (เพิ่ม bom_fg_moves)
--   - private.bom_client_actions, private.bom_staff_actions จาก 20261112010000_bom_part_returns.sql (เพิ่ม receiveFg, deliverFg, closeOrderShort · client ตัด completeOrder)
--   - private.bom_save_orders จาก 20261108020000_bom_release_opens_rubberflow_orders.sql (ลายเซ็น / ชนิดคืนเดิม: ด่าน BOM_FORBIDDEN ของ completed และตัดสาขา -> completed เดิม)
--   - private.bom_records จาก 20261112010000_bom_part_returns.sql, private.bom_delta จาก 20261111010000_bom_part_stock.sql (เพิ่มชุด fgMoves) · private.bom_snapshot / app_bom_master / app_bom_master_since ไม่แตะ (คืนชุดตามที่ bom_records / bom_delta คืน)
--   - public.app_bom_save_master จาก 20261112010000_bom_part_returns.sql (ส่วน fgMoves, action ใหม่, เรียก bom_fg_move, นับ audit) ลายเซ็นและสิทธิ์เดิม
--   - public.app_sandbox_purge_bom จาก 20261111010000_bom_part_stock.sql (ลบ bom_fg_moves ก่อน bom_orders) ลายเซ็นและสิทธิ์เดิม
--   - ใหม่: private.bom_fg_total, private.bom_fg_pk_done, private.bom_fg_move
--   - ไม่แตะ: private.bom_save_jobs และตัวเขียนอื่น · private.rf_apply_feedback (ป้อนกลับจาก RubberFlow ไม่เคยปิดใบ) · app_bom_audit (อ่านจำนวนต่อส่วนที่เซิร์ฟเวอร์บันทึกเองทุกส่วนอยู่แล้ว จึงแสดง fgMoves โดยไม่ต้องแก้)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก action ใหม่ (receiveFg / deliverFg / closeOrderShort) และอ่านชุด fgMoves จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของฟังก์ชันที่ replace ข้างบน
--   ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test, has_function_privilege (anon ไม่ได้ authenticated เฉพาะ RPC สาธารณะ, private.* เรียกไม่ได้), relrowsecurity + policy ของ bom_fg_moves
--   Pilot รุ่นเก่ากับฐานข้อมูลใหม่: ปุ่ม "ปิดใบ" ของกลุ่มวางแผน (completeOrder) ถูกปฏิเสธ (BOM_INVALID_ACTION) ใบจึงปิดไม่ได้จนกว่าจะอัปเดต Pilot · ชุด fgMoves ที่เพิ่มถูกเมิน ส่วนอื่นทำงานปกติ
--   Pilot รุ่นใหม่กับฐานข้อมูลเก่า: action ใหม่ถูกปฏิเสธ (BOM_FORBIDDEN สำหรับผู้ที่ไม่ใช่กลุ่มวางแผน, BOM_INVALID_ACTION สำหรับกลุ่มวางแผน) · ไม่มีชุด fgMoves ใน snapshot (client ต้องรับได้ว่าชุดนี้ไม่มี) · ใบปิดไม่ได้จนกว่าจะ apply
--
-- Rollback (ตารางใหม่มีแต่ข้อมูลทดสอบ) ลำดับสำคัญ:
--   1) คืนนิยามเดิมของ public.app_bom_save_master, public.app_sandbox_purge_bom, private.bom_records, private.bom_delta, private.bom_save_orders, private.bom_client_actions,
--      private.bom_staff_actions, private.sandbox_unguarded_tables จากไฟล์ต้นทางที่ระบุข้างบนด้วยการรัน create or replace (รวม revoke/grant ท้ายฟังก์ชัน)
--      ใบที่ปิดไปแล้วด้วยการรับของ (completed) ยังเป็น completed ต่อ · app_sandbox_purge_bom เดิมไม่รู้จัก bom_fg_moves จึงลบใบที่มีประวัติไม่ได้ ต้องทำข้อ 2 ก่อนล้างข้อมูลทดสอบ
--   2) drop function private.bom_fg_move(public.employees, text, jsonb), private.bom_fg_pk_done(uuid, text), private.bom_fg_total(uuid, text, text)
--   3) drop table public.bom_fg_moves (ข้อมูลทดสอบของประวัติรับ/ส่งมอบหายไป)
-- ============================================================================

-- 1. ตาราง: ประวัติรับเข้าคลัง / ส่งมอบลูกค้า / ปิดใบรับไม่ครบ (แยกโหมดด้วย is_test) ----------------------------------
-- เขียนต่อท้ายโดยเซิร์ฟเวอร์เท่านั้น (ไม่มีการแก้/ลบ) · ผูกกับใบ PI ด้วย foreign key คู่ (order_pk, is_test) แบบเดียวกับ bom_jobs (ไม่ cascade
-- ใบสั่งผลิตของโหมดทดสอบไม่มีการลบแถวนอกจาก purge ซึ่งลบตารางนี้ก่อน bom_orders) · ยอดคงคลังของสำเร็จรูปไม่มีตารางยอด: คำนวณจากผลรวมของประวัตินี้
create table public.bom_fg_moves (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  order_pk uuid not null,
  -- รหัสสินค้า (canonical) ของรายการในใบ · ว่างเฉพาะประวัติ close
  fg_code text not null default '' check (char_length(fg_code) <= 60),
  kind text not null check (kind in ('receive', 'deliver', 'close')),
  qty numeric not null default 0 check (qty >= 0 and qty <= 1000000000),
  -- หมายเหตุของการรับ/ส่งมอบ (ไม่บังคับ) หรือเหตุผลของ close (3-300 ตัวอักษร)
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  -- clock_timestamp: หลายรายการในธุรกรรมเดียวกัน (รับหลายสินค้าในคำสั่งเดียว) เรียงตามลำดับที่เขียนจริง
  created_at timestamptz not null default clock_timestamp(),
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  unique (id, is_test),
  constraint bom_fg_moves_shape_check check (
    (kind = 'close' and fg_code = '' and qty = 0 and char_length(note) between 3 and 300)
    or (kind in ('receive', 'deliver') and char_length(fg_code) between 1 and 60 and qty > 0))
);
comment on table public.bom_fg_moves is 'ประวัติรับของสำเร็จรูปเข้าคลัง (receive) ส่งมอบลูกค้า (deliver) และปิดใบรับไม่ครบ (close) ของใบสั่งผลิต · เขียนผ่าน app_bom_save_master (receiveFg / deliverFg / closeOrderShort) เท่านั้น ไม่มีสิทธิ์เขียนจาก client';
comment on column public.bom_fg_moves.changed_version is 'เวอร์ชันที่เขียนแถวนี้ (ดู bom_stock.changed_version)';

create index bom_fg_moves_changed_idx on public.bom_fg_moves (is_test, changed_version);
-- ดัชนีฝั่งตารางลูกของ foreign key (ล้างข้อมูลทดสอบ / ผลรวมต่อใบ ไม่ต้องสแกนทั้งตาราง)
create index bom_fg_moves_order_idx on public.bom_fg_moves (order_pk, is_test);

-- แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ฟังก์ชัน trigger เดิมของ 20261105010000)
create trigger bom_fg_moves_sandbox_scope before insert or update or delete on public.bom_fg_moves
  for each row execute function private.sandbox_row_scope();
create trigger bom_fg_moves_stamp_version before insert or update on public.bom_fg_moves
  for each row execute function private.bom_stamp_version();
revoke all on public.bom_fg_moves from anon, authenticated;
alter table public.bom_fg_moves enable row level security;
create policy bom_fg_moves_no_direct_access on public.bom_fg_moves for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.bom_fg_moves');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261113010000_master_account.sql ทุกชื่อ แล้วเพิ่ม bom_fg_moves)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. รายการ action (นิยามจาก 20261112010000_bom_part_returns.sql: เพิ่ม receiveFg, deliverFg, closeOrderShort · ตัด completeOrder ออกจาก client) -----------------
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
    'setStockCount', 'setStockCounts', 'cancelOrder',
    'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'saveCustomer',
    'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 3. ตัวช่วยและตัวเขียนของสำเร็จรูป (private เรียกจาก app_bom_save_master เท่านั้น) ------------------------------------------
-- ผลรวม qty ของประวัติชนิดหนึ่ง (receive / deliver) ของ (ใบ, รหัสสินค้า) · ไม่มีประวัติ = 0
create or replace function private.bom_fg_total(p_order_pk uuid, p_code text, p_kind text)
returns numeric
language sql
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_fg_moves m
  where m.is_test and m.order_pk = p_order_pk and m.fg_code = p_code and m.kind = p_kind
$$;
revoke all on function private.bom_fg_total(uuid, text, text) from public, anon, authenticated;

-- ยอดที่ PK รายงานแล้ว (qty_done) ของงาน PK / FG ของสินค้านั้นในใบ · ไม่มีงาน = 0
create or replace function private.bom_fg_pk_done(p_order_pk uuid, p_code text)
returns numeric
language sql
set search_path = ''
as $$
  select coalesce(sum(j.qty_done), 0)
  from public.bom_jobs j
  where j.is_test and j.order_pk = p_order_pk and j.dept = 'PK' and j.kind = 'FG' and j.item_code = p_code
$$;
revoke all on function private.bom_fg_pk_done(uuid, text) from public, anon, authenticated;

-- รับเข้าคลัง / ส่งมอบ / ปิดใบรับไม่ครบ (action receiveFg / deliverFg / closeOrderShort) · แถวเดียว { orderId, kind, lines?, note? } · คืน { moves, closed }
-- ลำดับตรวจ: รูปแถว (BOM_INVALID_FG) -> สิทธิ์ แผนก WH หรือ admin (BOM_FORBIDDEN) -> ล็อกแถวใบ (ไม่พบใบ / สินค้าไม่ใช่รายการของใบ = BOM_INVALID_FG)
--   -> สถานะ (BOM_INVALID_TRANSITION) -> ยอด (BOM_FG_EXCEEDS) · ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ ไม่เชื่อค่าที่ client คำนวณ · กลุ่มวางแผนที่ไม่ใช่ WH / admin ดูอย่างเดียว
create or replace function private.bom_fg_move(p_actor public.employees, p_action text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_expected text;
  v_kind text;
  v_pi text;
  v_note text;
  v_codes text[] := '{}';
  v_qtys numeric[] := '{}';
  v_code text;
  v_qty numeric;
  v_ord public.bom_orders%rowtype;
  v_item jsonb;
  v_received numeric;
  v_short boolean := false;
  v_n integer := 0;
  v_close boolean := false;
begin
  -- รูปแถว (ก่อนสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_FG'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
  v_expected := case p_action when 'receiveFg' then 'receive' when 'deliverFg' then 'deliver' when 'closeOrderShort' then 'close' end;
  v_kind := private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_FG');
  if v_expected is null or v_kind <> v_expected then raise exception 'BOM_INVALID_FG'; end if;
  v_pi := upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_FG'));
  v_node := v_row -> 'lines';
  if v_kind = 'close' then
    if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
      raise exception 'BOM_INVALID_FG';
    end if;
    v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_FG');
  else
    if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) not between 1 and 500 then raise exception 'BOM_INVALID_FG'; end if;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
      v_code := private.bom_code(private.bom_text(v_el, 'fgCode', 60, 1, 'BOM_INVALID_FG'));
      if v_code = any (v_codes) then raise exception 'BOM_INVALID_FG'; end if;
      v_qty := private.bom_num(v_el -> 'qty', 'BOM_INVALID_FG', 0, 1000000000);
      if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_FG'; end if;
      v_codes := v_codes || v_code;
      v_qtys := v_qtys || v_qty;
    end loop;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_FG');
  end if;

  -- สิทธิ์: พนักงานแผนก WH (ทุกบทบาทของแผนก) หรือบทบาท admin · กลุ่มวางแผน (PP) ไม่มีสิทธิ์รับ/ส่งมอบ/ปิดใบ
  if not (coalesce(private.bom_dept_of(p_actor) = 'WH', false) or coalesce(private.employee_role_code(p_actor.id) = 'admin', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  -- ล็อกแถวใบ: การรับ/ส่งมอบพร้อมกันของใบเดียวกันต่อคิวกัน ยอดรวมที่ตรวจจึงไม่ถูกแซง
  select * into v_ord from public.bom_orders o where o.is_test and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_FG'; end if;
  for i in 1 .. cardinality(v_codes) loop
    if not exists (select 1 from jsonb_array_elements(v_ord.items) it where it ->> 'fgCode' = v_codes[i]) then raise exception 'BOM_INVALID_FG'; end if;
  end loop;

  if v_kind = 'receive' then
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- รับสะสมของสินค้าหนึ่งเกินที่ PK รายงานแล้ว (qty_done ของงาน PK) ไม่ได้ · ไม่มีงาน PK = 0
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'receive') + v_qtys[i] > private.bom_fg_pk_done(v_ord.id, v_codes[i]) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  elsif v_kind = 'deliver' then
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- ส่งมอบสะสมของสินค้าหนึ่งเกินที่รับเข้าคลังแล้ว (ของใบนี้) ไม่ได้
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'deliver') + v_qtys[i] > private.bom_fg_total(v_ord.id, v_codes[i], 'receive') then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  else
    -- ปิดใบรับไม่ครบ: ใบยังเปิดอยู่ ทุกงาน PK เสร็จแล้ว ทุกสินค้ารับเข้าคลังเท่าที่ PK ทำได้ครบ และอย่างน้อยหนึ่งสินค้ารับน้อยกว่าที่สั่ง (ไม่เช่นนั้น BOM_INVALID_TRANSITION)
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_ord.id and j.dept = 'PK' and j.status <> 'done') then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    for v_item in select value from jsonb_array_elements(v_ord.items) loop
      v_code := v_item ->> 'fgCode';
      v_received := private.bom_fg_total(v_ord.id, v_code, 'receive');
      if v_received <> private.bom_fg_pk_done(v_ord.id, v_code) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_received < (v_item ->> 'qty')::numeric then v_short := true; end if;
    end loop;
    if not v_short then raise exception 'BOM_INVALID_TRANSITION'; end if;
  end if;

  -- เขียนประวัติ: หนึ่งแถวต่อบรรทัด (close: หนึ่งแถว รหัสว่าง qty 0 เหตุผลอยู่ใน note)
  if v_kind = 'close' then
    insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
    values (true, v_ord.id, '', 'close', 0, v_note, p_actor.id);
    v_n := 1;
    v_close := true;
  else
    for i in 1 .. cardinality(v_codes) loop
      insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
      values (true, v_ord.id, v_codes[i], v_kind, v_qtys[i], v_note, p_actor.id);
      v_n := v_n + 1;
    end loop;
    -- รับครบทุกสินค้า (รับสะสม >= ที่สั่ง) = ปิดใบอัตโนมัติ
    if v_kind = 'receive' and jsonb_array_length(v_ord.items) > 0 and not exists (
         select 1 from jsonb_array_elements(v_ord.items) it
         where private.bom_fg_total(v_ord.id, it ->> 'fgCode', 'receive') < (it ->> 'qty')::numeric) then
      v_close := true;
    end if;
  end if;
  if v_close then
    update public.bom_orders set status = 'completed', completed_at = now(), updated_at = now() where id = v_ord.id;
  end if;
  return jsonb_build_object('moves', v_n, 'closed', v_close);
end;
$$;
revoke all on function private.bom_fg_move(public.employees, text, jsonb) from public, anon, authenticated;

-- 4. ใบสั่งผลิต: เปลี่ยนเป็น completed ผ่านแถวใบไม่ได้ (นิยามจาก 20261108020000_bom_release_opens_rubberflow_orders.sql เพิ่มด่านเดียวและตัดสาขา released/in_progress -> completed ที่ไม่มีทางถึงอีก) ----------------------------
create or replace function private.bom_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_job_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_released uuid[] := '{}';
  v_cancelled text[] := '{}';
  v_reopened text[] := '{}';
  v_dept text := private.bom_dept_of(p_actor);
  v_pi text;
  v_customer text;
  v_country text;
  v_type text;
  v_ordered numeric;
  v_wh numeric;
  v_due jsonb;
  v_defaults jsonb;
  v_items jsonb;
  v_expl jsonb;
  v_counts jsonb;
  v_note text;
  v_status text;
  v_reason text;
  v_old public.bom_orders%rowtype;
  v_content boolean;
  v_counts_changed boolean;
  v_status_changed boolean;
  v_revision integer;
  v_reopen boolean;
  v_has_job boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
    if v_pi ~ '[[:cntrl:]]' or v_pi = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_pi;
    -- ชื่อลูกค้าบนใบใช้การจัดรูปเดียวกับตาราง bom_customers (ช่องว่างซ้ำรวมเป็นช่องเดียว ตัดหัวท้าย) client ใช้กฎเดียวกันกับกุญแจ
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_country := private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER'));
    if v_type not in ('SA', 'EX') then raise exception 'BOM_INVALID_ORDER'; end if;
    v_ordered := private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000);
    v_wh := private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000);
    if v_ordered is null or v_wh is null or v_ordered <> trunc(v_ordered) or v_wh <> trunc(v_wh) or v_wh < v_ordered then
      raise exception 'BOM_INVALID_ORDER';
    end if;
    v_due := private.bom_parse_due(v_row -> 'due');
    v_node := v_row -> 'dueDefaults';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 10 then raise exception 'BOM_INVALID_ORDER'; end if;
    v_defaults := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or (v_el #>> '{}') !~ '^[A-Z]{2}$' then raise exception 'BOM_INVALID_ORDER'; end if;
      v_defaults := v_defaults || jsonb_build_array(v_el);
    end loop;
    v_items := private.bom_parse_order_items(v_row -> 'items');
    v_expl := private.bom_parse_explosion(v_row -> 'explosion');
    v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER');
    v_reason := private.bom_text(v_row, 'cancelReason', 200, 0, 'BOM_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER');
    if v_status not in ('draft', 'released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_ORDER'; end if;

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id);
      continue;
    end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน: เช่นใบที่ผู้อื่นเพิ่งเปลี่ยนเป็น in_progress แล้วสำเนานี้ก็เป็น in_progress)
    if not (v_content or v_counts_changed or v_status_changed) then continue; end if;

    -- ใบเปลี่ยนเป็น completed ผ่านแถวใบสั่งผลิตไม่ได้เลย (ทุกชื่อ action ทุกผู้เรียก รวมกลุ่มวางแผนและ admin): ปิดใบได้ทางเดียวคือรับของสำเร็จรูปเข้าคลังครบ
    -- (ปิดอัตโนมัติ) หรือ closeOrderShort โดยแผนก WH / admin ผ่าน private.bom_fg_move · ตรวจก่อนชน/สิทธิ์เพื่อให้ได้ BOM_FORBIDDEN เหมือนกันทุกกรณี
    if v_status_changed and v_status = 'completed' then raise exception 'BOM_FORBIDDEN'; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน (ตัวเขียนงานตรวจชนของงานเอง)
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- ชนก่อนสิทธิ์เสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า
    -- (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    -- สิทธิ์: กลุ่มวางแผนแก้ได้ทุกอย่าง · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่นแก้ไม่ได้
    if not p_planner then
      if v_content or v_status_changed or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
    end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        null;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if exists (select 1 from public.bom_jobs j where j.is_test and j.order_pk = v_old.id and j.qty_done > 0) then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        -- WO ที่ผูกงาน: planned / released ยกเลิกให้ · เลยจากนั้น = BOM_RF_ORDER_STARTED (ผิดข้อใด ทั้งคำสั่งไม่เขียนอะไร)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- งานที่ผูก WO ที่เลย released ถูกนับว่าเริ่มแล้วข้างบน ที่เหลือ (WO planned / released) ยกเลิกให้ก่อนลบงาน
        v_reopened := v_reopened || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    update public.bom_orders set
      customer = v_customer, country = v_country, order_type = v_type, ordered_at = v_ordered::bigint, wh_due = v_wh::bigint,
      due = v_due, due_defaults = v_defaults, items = v_items, explosion = v_expl,
      exploded_at = case when v_reopen or v_expl is null then null
                         when v_old.explosion is distinct from v_expl or v_old.exploded_at is null then now()
                         else v_old.exploded_at end,
      stock_counts = v_counts,
      stock_counted_at = case when v_counts_changed then now() else v_old.stock_counted_at end,
      stock_counted_by = case when v_counts_changed then p_actor.id else v_old.stock_counted_by end,
      note = v_note, status = v_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened));
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. snapshot / delta (นิยามจาก 20261112010000_bom_part_returns.sql / 20261111010000_bom_part_stock.sql แล้วเพิ่มชุด fgMoves เป็นชุดที่สิบสี่) ----------------------------------------
-- fgMoves = ประวัติรับ/ส่งมอบ/ปิดใบ เรียงตามเวลาแล้ว id · ชุด delete เป็น [] เสมอ (ไม่มีการลบ) · ยอดรับ/ส่งมอบสะสมและสถานะ "ส่งมอบแล้ว" client คำนวณจากชุดนี้กับใบ/งาน
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
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''), 'note', m.note)
        order by m.created_at, m.id)
      from public.bom_stock_moves m where m.is_test and m.changed_version > p_since), '[]'::jsonb),
    'fgMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'orderId', o.pi_no, 'fgCode', m.fg_code, 'kind', m.kind, 'qty', m.qty, 'note', m.note,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''))
        order by m.created_at, m.id)
      from public.bom_fg_moves m join public.bom_orders o on o.id = m.order_pk
      where m.is_test and m.changed_version > p_since), '[]'::jsonb))
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
                   ('customers'), ('orders'), ('jobs'), ('stock'), ('stockMoves'), ('fgMoves')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;
revoke all on function private.bom_delta(bigint) from public, anon, authenticated;

-- 6. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261112010000_bom_part_returns.sql แล้วเพิ่มส่วน fgMoves, action receiveFg / deliverFg / closeOrderShort และเรียก bom_fg_move) ------------
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
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves'];
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
  v_fg jsonb;
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
      -- ของสำเร็จรูป: ส่วน fgMoves ส่งได้เฉพาะ receiveFg / deliverFg / closeOrderShort และสามการกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น)
      if v_n > 0 and ((v_key = 'fgMoves' and not (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort')))
                      or (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort') and v_key <> 'fgMoves')) then
        raise exception 'BOM_INVALID_FG';
      end if;
      -- สต็อกของซื้อ: ส่วน stock ส่งได้เฉพาะ countPartStock และ countPartStock ส่งได้เฉพาะส่วน stock · issueOrderParts ส่งได้เฉพาะงาน (jobs upsert)
      -- คืนของซื้อ: ส่วน partReturns ส่งได้เฉพาะ undoOrderParts / returnOrderParts และสองการกระทำนี้ส่งได้เฉพาะส่วน partReturns
      if v_n > 0 and ((v_key = 'stock' and p_action <> 'countPartStock')
                      or (p_action = 'countPartStock' and v_key <> 'stock')
                      or (p_action = 'issueOrderParts' and not (v_key = 'jobs' and v_sub = 'upsert'))
                      or (v_key = 'partReturns' and p_action not in ('undoOrderParts', 'returnOrderParts'))
                      or (p_action in ('undoOrderParts', 'returnOrderParts') and v_key <> 'partReturns')) then
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
    -- คืนของซื้อ (undoOrderParts / returnOrderParts): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (งานที่กลับไปรอเบิกจ่าย สต็อก ประวัติ) · นับเป็น stock ตามจำนวนประวัติที่เขียน
    if p_action in ('undoOrderParts', 'returnOrderParts') then
      v_stock_n := private.bom_return_parts(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{partReturns,upsert}', '[]'::jsonb), p_base_version, v_version);
      if v_stock_n > 0 then v_counts := v_counts || jsonb_build_object('stock', jsonb_build_object('upsert', v_stock_n)); end if;
    end if;
    -- ของสำเร็จรูป (receiveFg / deliverFg / closeOrderShort): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (ประวัติ และใบที่ปิดเอง) · audit นับเป็น fgMoves ตามจำนวนแถวประวัติที่เขียน และ orders +1 เมื่อใบถูกปิด
    if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort') then
      v_fg := private.bom_fg_move(v_actor, p_action, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', (v_fg ->> 'moves')::integer));
      if (v_fg ->> 'closed')::boolean then v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', 1)); end if;
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

revoke all on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_bom_save_master(jsonb, bigint, text, jsonb, text) to authenticated;

-- 7. ล้างข้อมูล BOM ทดสอบ (นิยามจาก 20261111010000_bom_part_stock.sql เพิ่ม bom_fg_moves ลบก่อน bom_orders คงการพัก JWT claims ระหว่างลบ) ------------
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
    'bom_fg_moves', 'bom_stock_moves', 'bom_stock', 'bom_jobs', 'bom_orders', 'bom_customers', 'bom_bom_lines', 'bom_boms', 'bom_routings', 'bom_color_sets', 'bom_packages',
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
revoke all on function public.app_sandbox_purge_bom() from public, anon;
grant execute on function public.app_sandbox_purge_bom() to authenticated;
