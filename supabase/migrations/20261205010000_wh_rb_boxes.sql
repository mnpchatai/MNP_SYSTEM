-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: โรงงาน ขั้น 4 คลังสินค้าสำเร็จรูป (WH) รับกล่องจาก RB เข้าคลัง ส่งมอบให้ลูกค้า และย้อนรายการที่บันทึกผิด
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-19, factory-step4-wh-spec): ล็อตตกแต่ง (สถานีที่ 4) ที่ผ่านมีสองปลายทาง
--   คลังยางเส้นยาว SR (ยางเส้นยาวของงาน BOM ไป GR ต่อ · เหมือนเดิม) หรือ "ส่งมอบให้ลูกค้า ผ่านคลังสินค้าสำเร็จรูป (WH)"
--   1) ล็อตของ WO ที่ผูกงาน BOM ที่ส่งมอบให้ลูกค้า นับยอดเข้างาน RB ของใบนั้นเมื่อ WH รับกล่องเข้าคลัง (ไม่ใช่ตอนตกแต่ง)
--   2) WO ที่ไม่ผูกงาน: ผ่าน = ส่งลูกค้าผ่าน WH (กล่องรอ WH รับเข้าก่อน ไม่พร้อมส่งทันทีอีกต่อไป) หรือกักรอ QC
--   3) รับเข้า / ส่งมอบกล่อง = แผนก WH (ทุกบทบาท) หรือผู้ดูแลระบบเท่านั้น (เดิมส่งมอบ = กลุ่มวางแผนหรือแผนก WH) · กลุ่มวางแผนดูอย่างเดียว
--   5) ล็อตละปลายทางเดียว · 6) รับทั้งล็อตทีเดียว ไม่มีตำแหน่งจัดเก็บ
--   7) ย้อนรับเข้า (ทั้งล็อต) / ย้อนส่งมอบ (รายกล่อง) = ผู้จัดการแผนก WH หรือผู้ดูแลระบบ เหตุผล 3-300 ตัวอักษร ประวัติเก็บไว้
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และกลไก bom_actor / rf_actor (นอกโหมดทดสอบ = RF_TEST_MODE_ONLY)
--
-- ตาราง (ไม่มีตารางใหม่: RLS / grant / trigger sandbox_scope + stamp_version / lab-only / การล้างข้อมูลทดสอบเดิมครอบคอลัมน์ใหม่อยู่แล้ว)
--   public.rf_lots
--     + destination text null ('sr' | 'customer' · เฉพาะล็อตตกแต่ง · null = กัก / ล็อตก่อนไฟล์นี้)
--     + wh_credit_job_no text null, wh_credit_qty numeric null (มีค่าคู่กัน: ยอดที่นับเข้างาน RB ตอน WH รับล็อตเข้าคลัง ใช้ถอนตอนย้อน · เฉพาะ customer)
--   public.rf_fg_boxes
--     status เพิ่ม 'pending_wh' (รอ WH รับเข้า) · ทาง: pending_wh -> in_stock -> shipped · ย้อน in_stock -> pending_wh, shipped -> in_stock · QA: <-> hold
--     + customer text, customer_po text (สำเนาลูกค้า / เลข PO หรือ PI ของ WO ตอนสร้างกล่อง · กล่องก่อนไฟล์นี้เป็น '')
--     + received_at timestamptz, received_by uuid (WH รับเข้า · ย้อนรับเข้าล้างค่า · กล่อง in_stock ก่อนไฟล์นี้เป็น null)
--     + moves jsonb [{kind receive | ship | unreceive | unship, at (ms), by (ชื่อ), note}] ประวัติต่อท้ายที่เซิร์ฟเวอร์เขียน (ค่าของ client เมิน)
--
-- RubberFlow app_rf_save
--   recordFinishing: แถวล็อตตกแต่งรับ destination ('sr' | 'customer' | ไม่ส่ง) · pass + ไม่ส่ง = WO ที่ผูกงานไป sr (Pilot รุ่นก่อนยังใช้ได้) · WO ที่ไม่ผูกงานไป customer
--     sr ของ WO ที่ไม่ผูกงาน / ปลายทางของผล hold หรือ fail / ค่าอื่น = RF_INVALID_LOT
--     customer = สร้างกล่อง (perBox บังคับ > 0) สถานะ pending_wh พร้อมลูกค้า / PO ของ WO · ไม่สร้างล็อตยางเส้นยาว · rf_apply_feedback เรียกเฉพาะ WO ที่ไม่ผูกงานเหมือนเดิม
--     sr = เหมือน 20261202010000 ทุกอย่าง (ไม่มีกล่อง ล็อตยางเส้นยาวรอ SR รับ) · hold = เหมือนเดิม (กล่อง hold เฉพาะ WO ที่ไม่ผูกงาน)
--   addQcRecord: QA ปล่อยล็อตตกแต่งครั้งแรก ตั้งปลายทางที่ยังว่างตามการผูกงาน (sr | customer) · กล่องที่ยังไม่ส่งมอบ: ผ่าน = in_stock ถ้า WH รับแล้ว
--     (received_at มีค่า) ไม่เช่นนั้น pending_wh · อื่น = hold
--   คำสั่งของกล่อง (ส่งได้เฉพาะชุด fgBoxes · ชุดอื่น = RF_INVALID_BOX) แถว = เรคอร์ดกล่องเต็มที่เปลี่ยน status (ช่องอื่นเมิน)
--     receiveBoxes (ใหม่ · แผนก WH หรือ admin): pending_wh -> in_stock ทุกกล่อง pending_wh ของล็อตต้องมาในคำสั่งเดียว (ขาด = RF_INVALID_BOX)
--       ล็อต customer ของ WO ที่ผูกงาน (งานยังผูก WO นี้ ใบ released / in_progress งานยังไม่ done) = งาน RB ได้ยอด good_qty ของล็อต + รายงาน
--       ใบ released -> in_progress (ตรรกะเดียวกับ private.bom_rod_credit ไม่มีสต็อกกลาง) · เงื่อนไขไม่ครบ = ไม่นับ · นับได้ครั้งเดียวต่อการรับ
--     shipBoxes (เดิม · สิทธิ์แคบลงเป็นแผนก WH หรือ admin): in_stock -> shipped
--     reverseBoxReceipt (ใหม่ · ผู้จัดการแผนก WH หรือ admin): in_stock -> pending_wh ทุกกล่องของล็อตในคำสั่งเดียว ล็อตที่มีกล่องส่งมอบแล้วหรือกัก = RF_INVALID_TRANSITION
--       ถอนยอดที่นับไว้ (qty_done ลดไม่ต่ำกว่า 0 · done -> in_progress เมื่อต่ำกว่าแผน · รายงาน good 0 พร้อมเหตุผล) · ใบ completed = RF_INVALID_TRANSITION
--     reverseBoxShip (ใหม่ · ผู้จัดการแผนก WH หรือ admin): shipped -> in_stock รายกล่อง
--     ย้อนทั้งสองต้องมีเหตุผล 3-300 ตัวอักษรในรายการท้ายของ moves ของแถวที่ส่ง ({kind: unreceive | unship, note}) ไม่มี / ชนิดไม่ตรง = RF_INVALID_BOX
--     สถานะอื่นที่ส่งมา (เช่นสำเนาผล QA) เมินเหมือนเดิม · ถึงปลายทางแล้ว = ไม่เขียน (ส่งซ้ำได้) · ลำดับตรวจ: ชนรุ่น (RF_STALE) -> สิทธิ์ (RF_FORBIDDEN) -> ทาง (RF_INVALID_TRANSITION)
--   ทุกการเปลี่ยนของกล่องต่อท้าย moves {kind, at, by, note} · ไม่มีรหัสข้อผิดพลาดใหม่
--
-- รูปเรคอร์ดที่ส่งกลับ (rf_records)
--   lots (ตกแต่ง) เพิ่ม destination ('sr' | 'customer' | null), whCredit ({jobNo, qty} | null)
--   fgBoxes เพิ่ม customer, customerPo, moves เสมอ · receivedAt (ms), receivedBy (ชื่อ) เมื่อ WH รับอยู่ · status เพิ่ม pending_wh
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main)
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint)  จาก 20261202010000_bom_sr_rod_store.sql
--   - private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint)  จาก 20261202010000_bom_sr_rod_store.sql
--   - private.rf_records(bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.rf_client_actions()  จาก 20261128020000_bom_po_partial_fg_reverse.sql (+ receiveBoxes, reverseBoxReceipt, reverseBoxShip)
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)  จาก 20261204010000_bom_sr_store_module.sql
--   แทนที่ด้วยลายเซ็นใหม่: private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql ถูก drop
--     แล้วสร้าง private.rf_save_boxes(public.employees, text, text, jsonb, bigint, bigint) (ผู้เรียกเดียวคือ app_rf_save)
--   ใหม่ (security definer · search_path = '' · revoke all from public, anon, authenticated): private.rf_box_credit(text, public.rf_lots),
--     private.rf_box_uncredit(text, public.rf_lots, text)
--   ไม่แตะ: private.rf_delta (เรียก rf_records) · private.bom_rod_credit / bom_rod_lot_create / bom_rod_wo_linked · private.rf_apply_feedback
--     · ฝั่ง BOM (app_bom_save_master, bom_fg_move, bom_fg_reverse) · private.bom_real_open(), bom_actor(), rf_actor()
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ของ PR เดียวกับไฟล์นี้ส่ง destination และเรียกคำสั่งใหม่ จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของห้าฟังก์ชันที่ replace
--   และ rf_save_boxes เดิมที่ production กับนิยามในไฟล์ต้นทางที่ระบุ แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   Pilot เก่า + ฐานข้อมูลใหม่: ล็อตตกแต่งของ WO ที่ผูกงานไป SR เหมือนเดิม · กล่องของ WO ที่ไม่ผูกงานรอ WH รับเข้า (Pilot เก่ารับไม่ได้ จึงส่งมอบไม่ได้)
--     · กลุ่มวางแผนที่ไม่ใช่ WH / admin ส่งมอบกล่องไม่ได้แล้ว
--   Pilot ใหม่ + ฐานข้อมูลเก่า: destination ถูกเมิน (WO ที่ผูกงานไป SR เสมอ) · คำสั่งใหม่ = RF_INVALID_ACTION · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace ห้าฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน · drop function private.rf_save_boxes(public.employees, text, text, jsonb, bigint, bigint),
--      private.rf_box_credit(text, public.rf_lots), private.rf_box_uncredit(text, public.rf_lots, text) แล้วสร้าง
--      private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint) ตาม 20261130010000_bom_rf_go_live.sql (+ revoke all from public, anon, authenticated)
--   2) ยอดที่นับเข้างาน RB ตอน WH รับเข้าคงอยู่ในงาน (ไม่ถอนอัตโนมัติ)
--   3) update public.rf_fg_boxes set status = 'in_stock' where status = 'pending_wh' (ทุกโหมด · ก่อนคืน check เดิม)
--   4) alter table public.rf_fg_boxes drop constraint rf_fg_boxes_status_check, drop constraint rf_fg_boxes_receipt_check, drop column customer,
--      drop column customer_po, drop column received_at, drop column received_by, drop column moves
--      แล้ว add constraint rf_fg_boxes_status_check check (status in ('in_stock', 'hold', 'shipped'))
--   5) alter table public.rf_lots drop constraint rf_lots_destination_check, drop constraint rf_lots_wh_credit_check, drop column destination,
--      drop column wh_credit_job_no, drop column wh_credit_qty
-- ============================================================================

-- 1. ตาราง ------------------------------------------------------------------------------------------------------------------------
alter table public.rf_lots
  add column destination text,
  add column wh_credit_job_no text,
  add column wh_credit_qty numeric;
alter table public.rf_lots add constraint rf_lots_destination_check check (
  destination is null or (stage = 'finishing' and destination in ('sr', 'customer')));
alter table public.rf_lots add constraint rf_lots_wh_credit_check check (
  (wh_credit_job_no is null) = (wh_credit_qty is null)
  and (wh_credit_qty is null or (destination = 'customer' and wh_credit_qty > 0 and wh_credit_qty <= 1000000000
                                 and wh_credit_job_no ~ '^[A-Za-z0-9._-]{1,40}$')));
comment on column public.rf_lots.destination is 'ปลายทางของล็อตตกแต่งที่ผ่าน: sr = คลังยางเส้นยาว SR (WO ที่ผูกงาน BOM) · customer = ส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป WH · null = กัก / ล็อตก่อน 20261205010000';
comment on column public.rf_lots.wh_credit_job_no is 'งาน RB ของ BOM ที่ได้ยอดจากล็อตนี้ตอน WH รับกล่องเข้าคลัง (null = ไม่ได้นับ) ใช้ถอนตอนย้อนรับเข้า';
comment on column public.rf_lots.wh_credit_qty is 'ยอดที่นับเข้างาน RB ตอน WH รับกล่องของล็อตเข้าคลัง (มีค่าคู่กับ wh_credit_job_no)';

alter table public.rf_fg_boxes drop constraint rf_fg_boxes_status_check;
alter table public.rf_fg_boxes add constraint rf_fg_boxes_status_check check (status in ('pending_wh', 'in_stock', 'hold', 'shipped'));
alter table public.rf_fg_boxes
  add column customer text not null default '' check (char_length(customer) <= 120),
  add column customer_po text not null default '' check (char_length(customer_po) <= 60),
  add column received_at timestamptz,
  add column received_by uuid references public.employees(id) on delete set null,
  add column moves jsonb not null default '[]'::jsonb check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) <= 200);
-- กล่องที่รอ WH รับเข้ายังไม่มีผู้รับ
alter table public.rf_fg_boxes add constraint rf_fg_boxes_receipt_check check (status <> 'pending_wh' or (received_at is null and received_by is null));
comment on table public.rf_fg_boxes is 'กล่องสินค้าสำเร็จรูป สร้างโดยเซิร์ฟเวอร์จากการบันทึกตกแต่งเท่านั้น · pending_wh (รอ WH รับ) -> in_stock (WH รับเข้า) -> shipped (ส่งมอบลูกค้า) · ย้อนโดยผู้จัดการแผนก WH / admin · QC เปลี่ยน <-> hold';
comment on column public.rf_fg_boxes.customer is 'ลูกค้าของ WO ตอนสร้างกล่อง (ผู้รับสินค้า) · กล่องก่อน 20261205010000 เป็นค่าว่าง';
comment on column public.rf_fg_boxes.customer_po is 'เลข PO / PI ของลูกค้าตาม WO ตอนสร้างกล่อง';
comment on column public.rf_fg_boxes.moves is 'ประวัติของกล่อง [{kind receive | ship | unreceive | unship, at, by, note}] เซิร์ฟเวอร์ต่อท้ายเท่านั้น';

-- 2. รายการ action ----------------------------------------------------------------------------------------------------------------
-- private.rf_client_actions() จาก 20261128020000_bom_po_partial_fg_reverse.sql (+ receiveBoxes, reverseBoxReceipt, reverseBoxShip)
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
    'createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'issueRequisition', 'returnRequisition', 'closePurchaseLine',
    'receiveBoxes', 'reverseBoxReceipt', 'reverseBoxShip']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- 3. นับยอด / ถอนยอดงาน RB ตอน WH รับเข้า / ย้อนรับเข้า ----------------------------------------------------------------------------------
-- ล็อต customer ของ WO ที่ผูกงาน BOM (งานยังผูก WO นี้: external_ref.woId = เลข WO เหมือน bom_rod_lot_create) ที่ WH เพิ่งรับทั้งล็อตเข้าคลัง
-- ใบ released / in_progress และงานยังไม่ done: งานได้ยอด good_qty ของล็อตเต็ม + รายงาน · ใบ released -> in_progress (ตรรกะของ bom_rod_credit ไม่มีสต็อกกลาง
-- เพราะของออกไปหาลูกค้า) · ล็อตจำยอดและงานไว้ (wh_credit_*) · ไม่เข้าเงื่อนไข / นับไว้แล้ว = ไม่ทำอะไร · คืน { jobs, orders }
create or replace function private.rf_box_credit(p_actor_name text, p_lot public.rf_lots)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q numeric := trim_scale(p_lot.good_qty);
  v_wo public.rf_orders%rowtype;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_done numeric;
  v_status text;
  v_orders integer := 0;
begin
  if p_lot.destination is distinct from 'customer' or p_lot.wh_credit_qty is not null or coalesce(v_q, 0) <= 0 then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  select * into v_wo from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = p_lot.order_no;
  if not found or not coalesce(private.bom_rod_wo_linked(v_wo), false) then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  -- ล็อกตัวนับ BOM ก่อนเขียน (เหมือน rf_apply_feedback / bom_rod_lot_create) แถวที่แก้ถูกประทับเวอร์ชันถัดไปที่ app_rf_save เพิ่มให้
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from v_wo.wo_no or v_job.status = 'done' then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.id = v_job.order_pk for update;
  if not found or v_ord.status not in ('released', 'in_progress') then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  v_done := v_job.qty_done + v_q;
  v_status := case when v_done >= v_job.qty_planned then 'done' else 'in_progress' end;
  update public.bom_jobs set
    qty_done = v_done,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', v_q, 'reject', 0,
      'note', left('คลังสินค้าสำเร็จรูป (WH) รับเข้า ล็อต ' || p_lot.lot_no || ' ส่งมอบให้ลูกค้า', 200))),
    status = v_status,
    done_at = case when v_status = 'done' then coalesce(v_job.done_at, now()) else null end,
    updated_at = now()
  where id = v_job.id;
  if v_ord.status = 'released' then
    update public.bom_orders set status = 'in_progress', updated_at = now() where id = v_ord.id;
    v_orders := 1;
  end if;
  update public.rf_lots set wh_credit_job_no = v_job.job_no, wh_credit_qty = v_q, updated_at = now() where id = p_lot.id;
  return jsonb_build_object('jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_box_credit(text, public.rf_lots) from public, anon, authenticated;

-- ย้อนรับเข้าของล็อตที่นับยอดไว้: ถอนยอด wh_credit_qty ออกจากงาน (qty_done ไม่ต่ำกว่า 0 · done -> in_progress เมื่อต่ำกว่าแผน)
-- + รายงาน good 0 พร้อมเหตุผล (bom_parse_reports รับรายการเดิมที่เป็น 0 ได้ · ห้ามติดลบ) · ใบ completed (ทุกงานผลิตเสร็จแล้ว) = RF_INVALID_TRANSITION
-- ใบที่ยกเลิก / ไม่พบงาน = ล้างค่าที่จำไว้โดยไม่แตะงาน · คืน { jobs, orders }
create or replace function private.rf_box_uncredit(p_actor_name text, p_lot public.rf_lots, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_ord_found boolean;
  v_done numeric;
  v_status text;
  v_jobs integer := 0;
begin
  if p_lot.wh_credit_qty is null then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_lot.wh_credit_job_no for update;
  if found then
    select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.id = v_job.order_pk for update;
    v_ord_found := found;
    if v_ord_found and v_ord.status = 'completed' then
      raise exception 'RF_INVALID_TRANSITION';
    end if;
    if v_ord_found and v_ord.status in ('released', 'in_progress') then
      v_done := greatest(v_job.qty_done - p_lot.wh_credit_qty, 0);
      v_status := v_job.status;
      if v_status = 'done' and v_done < v_job.qty_planned then
        v_status := 'in_progress';
      end if;
      update public.bom_jobs set
        qty_done = v_done,
        reports = v_job.reports || jsonb_build_array(jsonb_build_object(
          'at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0,
          'note', left('ย้อนรับเข้าคลังสินค้าสำเร็จรูป (WH) ล็อต ' || p_lot.lot_no || ' ถอน ' || trim_scale(p_lot.wh_credit_qty)::text
                       || ' · ' || coalesce(p_note, ''), 200))),
        status = v_status,
        done_at = case when v_status = 'done' then v_job.done_at else null end,
        updated_at = now()
      where id = v_job.id;
      v_jobs := 1;
    end if;
  end if;
  update public.rf_lots set wh_credit_job_no = null, wh_credit_qty = null, updated_at = now() where id = p_lot.id;
  return jsonb_build_object('jobs', v_jobs, 'orders', 0);
end;
$$;
revoke all on function private.rf_box_uncredit(text, public.rf_lots, text) from public, anon, authenticated;

-- 4. ตัวเขียนกล่อง: รับเข้า / ส่งมอบ / ย้อน ---------------------------------------------------------------------------------------
-- private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql ถูกแทนด้วยลายเซ็นใหม่ (สิทธิ์และคำสั่งตัดสินในตัวเขียน)
drop function private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint);
create or replace function private.rf_save_boxes(p_actor public.employees, p_actor_name text, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_cstatus text;
  v_old public.rf_fg_boxes%rowtype;
  v_lot text;
  v_from text;
  v_to text;
  v_kind text;
  v_may boolean;
  v_note text;
  v_lots text[] := '{}';
  v_notes jsonb := '{}'::jsonb;
  v_flot public.rf_lots%rowtype;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
begin
  -- ทางเดียวของแต่ละคำสั่ง (จาก -> ไป) · คำสั่งอื่นไม่เปลี่ยนสถานะกล่อง (v_to null)
  v_from := case p_action when 'receiveBoxes' then 'pending_wh' when 'shipBoxes' then 'in_stock'
                          when 'reverseBoxReceipt' then 'in_stock' when 'reverseBoxShip' then 'shipped' end;
  v_to := case p_action when 'receiveBoxes' then 'in_stock' when 'shipBoxes' then 'shipped'
                        when 'reverseBoxReceipt' then 'pending_wh' when 'reverseBoxShip' then 'in_stock' end;
  v_kind := case p_action when 'receiveBoxes' then 'receive' when 'shipBoxes' then 'ship'
                          when 'reverseBoxReceipt' then 'unreceive' when 'reverseBoxShip' then 'unship' end;
  -- สิทธิ์: รับเข้า / ส่งมอบ = แผนก WH (ทุกบทบาท) หรือ admin · ย้อน = ผู้จัดการแผนก (department_manager) ของแผนก WH หรือ admin
  if p_action in ('reverseBoxReceipt', 'reverseBoxShip') then
    v_may := coalesce(private.employee_role_code(p_actor.id) = 'admin', false)
          or (coalesce(private.bom_dept_of(p_actor) = 'WH', false) and coalesce(private.employee_role_code(p_actor.id) = 'department_manager', false));
  else
    v_may := coalesce(private.employee_role_code(p_actor.id) = 'admin', false) or coalesce(private.bom_dept_of(p_actor) = 'WH', false);
  end if;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_BOX'; end if;
    v_no := private.bom_text(v_row, 'id', 80, 1, 'RF_INVALID_BOX');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_BOX'; end if;
    v_seen := v_seen || v_no;
    v_cstatus := private.bom_text(v_row, 'status', 12, 1, 'RF_INVALID_BOX');
    if v_cstatus not in ('pending_wh', 'in_stock', 'hold', 'shipped') then raise exception 'RF_INVALID_BOX'; end if;

    select * into v_old from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.box_no = v_no;
    if not found then
      -- กล่องเกิดจากล็อตตกแต่งที่เพิ่งบันทึกในคำสั่งเดียวกันเท่านั้น (เซิร์ฟเวอร์สร้างไว้แล้ว) นอกนั้นสร้างเองไม่ได้
      v_lot := private.bom_text(v_row, 'lotId', 60, 0, 'RF_INVALID_BOX');
      if v_lot <> '' and exists (select 1 from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_lot and l.stage = 'finishing' and l.changed_version > p_cur) then
        continue;
      end if;
      raise exception 'RF_INVALID_BOX';
    end if;
    -- สถานะที่ไม่ใช่ปลายทางของคำสั่ง (เช่นสำเนาผล QA ที่ client เปลี่ยนเอง) เมิน · ถึงปลายทางแล้ว = ส่งซ้ำ ไม่เขียน
    if v_to is null or v_cstatus <> v_to or v_old.status = v_to then continue; end if;
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
    if not v_may then raise exception 'RF_FORBIDDEN'; end if;
    if v_old.status <> v_from then raise exception 'RF_INVALID_TRANSITION'; end if;
    v_note := '';
    if v_kind in ('unreceive', 'unship') then
      -- เหตุผลของการย้อน: รายการท้ายของ moves ในแถวที่ส่งมา (client ต่อท้าย {kind, note}) ชนิดต้องตรงกับคำสั่ง · 3-300 ตัวอักษร
      if jsonb_typeof(v_row -> 'moves') is distinct from 'array' or (v_row -> 'moves' -> -1 ->> 'kind') is distinct from v_kind then
        raise exception 'RF_INVALID_BOX';
      end if;
      v_note := private.bom_text(v_row -> 'moves' -> -1, 'note', 300, 3, 'RF_INVALID_BOX');
    end if;
    update public.rf_fg_boxes set
      status = v_to,
      received_at = case v_kind when 'receive' then now() when 'unreceive' then null else received_at end,
      received_by = case v_kind when 'receive' then p_actor.id when 'unreceive' then null else received_by end,
      shipped_at = case v_kind when 'ship' then now() when 'unship' then null else shipped_at end,
      shipped_by = case v_kind when 'ship' then p_actor.id when 'unship' then null else shipped_by end,
      moves = moves || jsonb_build_array(jsonb_build_object('kind', v_kind, 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_note)),
      updated_at = now()
    where id = v_old.id;
    if not (v_old.lot_no = any (v_lots)) then
      v_lots := v_lots || v_old.lot_no;
    end if;
    v_notes := v_notes || jsonb_build_object(v_old.lot_no, v_note);
  end loop;

  -- ทั้งล็อตทีเดียว (เจ้าของ 2026-11-19): รับเข้า = ไม่มีกล่อง pending_wh ของล็อตเหลือ แล้วนับยอดเข้างาน RB ·
  -- ย้อนรับเข้า = ล็อตไม่มีกล่องที่ส่งมอบแล้ว / กัก และไม่มีกล่องที่ยังอยู่ในคลัง แล้วถอนยอดที่นับไว้
  foreach v_lot in array v_lots loop
    if p_action not in ('receiveBoxes', 'reverseBoxReceipt') then
      continue;
    end if;
    select * into v_flot from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_lot for update;
    if not found then raise exception 'RF_INVALID_BOX'; end if;
    if p_action = 'receiveBoxes' then
      if exists (select 1 from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.lot_no = v_lot and b.status = 'pending_wh') then
        raise exception 'RF_INVALID_BOX';
      end if;
      v_res := private.rf_box_credit(p_actor_name, v_flot);
    else
      if exists (select 1 from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.lot_no = v_lot and b.status in ('shipped', 'hold')) then
        raise exception 'RF_INVALID_TRANSITION';
      end if;
      if exists (select 1 from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.lot_no = v_lot and b.status = 'in_stock') then
        raise exception 'RF_INVALID_BOX';
      end if;
      v_res := private.rf_box_uncredit(p_actor_name, v_flot, v_notes ->> v_lot);
    end if;
    v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
    v_orders := v_orders + (v_res ->> 'orders')::integer;
  end loop;
  return jsonb_build_object('boxes', cardinality(v_seen), 'jobs', v_jobs, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_save_boxes(public.employees, text, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. ล็อตตกแต่ง: ปลายทาง SR / ลูกค้า ---------------------------------------------------------------------------------------------
-- private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261202010000_bom_sr_rod_store.sql
--   (+ destination · กล่องของ customer รอ WH รับ (pending_wh) พร้อมลูกค้า / PO · WO ที่ผูกงานไป customer = มีกล่อง ไม่สร้างล็อตยางเส้นยาว)
create or replace function private.rf_save_lots(
  p_actor public.employees, p_actor_name text, p_may boolean, p_may_close boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_old public.rf_lots%rowtype;
  v_stage text;
  v_prefix text;
  v_params jsonb;
  v_srcs jsonb;
  v_src jsonb;
  v_src_id text;
  v_use numeric;
  v_machine text;
  v_shift text;
  v_reason text;
  v_good numeric;
  v_scrap numeric;
  v_order_no text;
  v_req public.rf_requisitions%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_tr public.rf_transfers%rowtype;
  v_ord public.rf_orders%rowtype;
  v_mold public.rf_molds%rowtype;
  v_mold_id text;
  v_stage_arr jsonb;
  v_stages jsonb;
  v_i integer;
  v_el jsonb;
  v_std jsonb;
  v_mixer numeric;
  v_dump numeric;
  v_mix numeric;
  v_issued numeric;
  v_reasons jsonb;
  v_qc text;
  v_ready timestamptz;
  v_uom text;
  v_out jsonb;
  v_sources jsonb;
  v_grade text;
  v_perbox numeric;
  v_boxes integer;
  v_rework numeric;
  v_pct numeric;
  v_thick numeric;
  v_width numeric;
  v_wpm numeric;
  v_espec jsonb;
  v_temp numeric;
  v_time numeric;
  v_press numeric;
  v_shots numeric;
  v_cid text;
  v_flot public.rf_lots%rowtype;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
  v_linked boolean;
  v_rods integer := 0;
  v_dest text;
  v_boxed boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_LOT'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_LOT');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_LOT'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_no;
    if found then
      -- เลขล็อตซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- ล็อตเดิม: ข้ามเวลาบ่ม (endRest) ได้อย่างเดียว ช่องอื่นเป็นของเซิร์ฟเวอร์
      if p_action = 'endRest' and v_old.ready_at is not null and jsonb_typeof(v_row -> 'readyAt') = 'number'
         and (v_row ->> 'readyAt')::numeric <> private.bom_ms(v_old.ready_at) then
        if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
        -- ข้ามเวลาบ่ม (20261128010000): หัวหน้า RB (private.rf_is_rb_head รวมผู้ช่วยผู้จัดการโรงงานขึ้นไปและ admin) หรือแผนก QA (private.rf_is_qa) เท่านั้น
        -- พนักงาน RB ทั่วไปและกลุ่มวางแผนที่ไม่ใช่สองกลุ่มนี้ = RF_FORBIDDEN · เหตุผล 3-300 ตัวอักษร (params.skipRest.reason ของแถวที่ส่งมา ไม่มี/สั้น/ยาวเกิน = RF_INVALID_LOT)
        -- เซิร์ฟเวอร์เก็บ { by, reason, at } ไว้ที่ params.skipRest ของล็อต (ผู้ทำและเวลาเซิร์ฟเวอร์ตั้ง ไม่เชื่อ client) · ล็อตที่บ่มครบแล้วไม่เขียนอะไร
        if not (private.rf_is_rb_head(p_actor) or private.rf_is_qa(p_actor)) then raise exception 'RF_FORBIDDEN'; end if;
        v_reason := private.bom_text(v_row #> '{params,skipRest}', 'reason', 300, 3, 'RF_INVALID_LOT');
        update public.rf_lots set
          ready_at = now(),
          params = params || jsonb_build_object('skipRest', jsonb_build_object('by', p_actor_name, 'reason', v_reason, 'at', private.bom_ms(now()))),
          updated_at = now()
        where id = v_old.id and ready_at > now();
      end if;
      continue;
    end if;

    -- ล็อตใหม่ -------------------------------------------------------------------------------
    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    v_stage := private.bom_text(v_row, 'stage', 12, 1, 'RF_INVALID_LOT');
    if v_stage not in ('mixing', 'extrusion', 'curing', 'finishing') then raise exception 'RF_INVALID_LOT'; end if;
    v_prefix := case v_stage when 'mixing' then 'MX' when 'extrusion' then 'EX' when 'curing' then 'CU' else 'FN' end;
    if v_no !~ ('^' || v_prefix || '-[A-Za-z0-9._-]{1,50}$') then raise exception 'RF_INVALID_LOT'; end if;
    v_params := coalesce(v_row -> 'params', '{}'::jsonb);
    if jsonb_typeof(v_params) <> 'object' then raise exception 'RF_INVALID_LOT'; end if;
    v_machine := private.bom_text(v_row, 'machine', 120, 0, 'RF_INVALID_LOT');
    v_shift := private.bom_text(v_row, 'shift', 10, 0, 'RF_INVALID_LOT');
    v_reason := private.bom_text(v_row, 'scrapReason', 200, 0, 'RF_INVALID_LOT');
    v_good := private.bom_num(v_row -> 'goodQty', 'RF_INVALID_LOT', 0, 1000000000);
    v_scrap := coalesce(private.bom_num(v_row -> 'scrapQty', 'RF_INVALID_LOT', 0, 1000000000), 0);
    if v_good is null then raise exception 'RF_INVALID_LOT'; end if;
    v_srcs := v_row -> 'sources';
    if jsonb_typeof(v_srcs) is distinct from 'array' then raise exception 'RF_INVALID_LOT'; end if;
    v_src := null;
    select t.e into v_src from jsonb_array_elements(v_srcs) as t(e)
    where jsonb_typeof(t.e) = 'object'
      and coalesce(t.e ->> 'type', t.e ->> 'kind') = case when v_stage = 'mixing' then 'requisition' else 'transfer' end
    limit 1;
    if v_src is null then raise exception 'RF_INVALID_LOT'; end if;
    v_src_id := private.bom_text(v_src, 'id', 60, 1, 'RF_INVALID_LOT');
    v_reasons := '[]'::jsonb;
    v_mold_id := null;
    v_ready := null;
    v_grade := '';
    v_boxes := null;
    v_rec := null;
    v_linked := false;
    v_dest := null;

    if v_stage = 'mixing' then
      select * into v_req from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.req_no = v_src_id for update;
      if not found then raise exception 'RF_INVALID_LOT'; end if;
      if v_req.status <> 'issued' then
        perform private.rf_fail(v_req.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
      end if;
      v_order_no := v_req.order_no;
      select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_req.recipe_code and r.revision = v_req.recipe_revision;
      -- ผสมสองขั้น: บันทึกทั้งสองขั้น Dump temp ของแต่ละขั้นเทียบกับค่าของสูตรในขั้นนั้นด้วยค่าเผื่อ dumpTol เดียวกัน ขั้นไหนหลุด = ล็อตถูก QC Hold
      v_stage_arr := v_params -> 'stages';
      if jsonb_typeof(v_stage_arr) is distinct from 'array' or jsonb_array_length(v_stage_arr) <> 2 then raise exception 'RF_INVALID_LOT'; end if;
      v_stages := '[]'::jsonb;
      for v_i in 1..2 loop
        select t.e into v_el from jsonb_array_elements(v_stage_arr) as t(e) where jsonb_typeof(t.e) = 'object' and t.e ->> 'stage' = v_i::text;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_mixer := private.bom_num(v_el -> 'mixerTemp', 'RF_INVALID_LOT', 0, 1000);
        v_dump := private.bom_num(v_el -> 'dumpTemp', 'RF_INVALID_LOT', 0, 1000);
        v_mix := private.bom_num(v_el -> 'mixMin', 'RF_INVALID_LOT', 0, 1440);
        if v_mixer is null or v_dump is null or v_mix is null or v_mix <= 0 then raise exception 'RF_INVALID_LOT'; end if;
        select t.e into v_std from jsonb_array_elements(v_rec.stages) as t(e) where t.e ->> 'stage' = v_i::text;
        -- สูตรที่ไม่มีค่ามาตรฐานของขั้นนี้ (ข้อมูลรูปเก่า) บันทึกไม่ได้ แทนที่จะปล่อยผ่านโดยไม่เทียบ
        if not found then raise exception 'RF_INVALID_RECIPE'; end if;
        if abs(v_dump - (v_std ->> 'dumpTemp')::numeric) > v_rec.dump_tol then
          v_reasons := v_reasons || to_jsonb('Dump temp ขั้น ' || v_i || ' ' || trim_scale(v_dump)::text || '°C นอกช่วง '
            || trim_scale((v_std ->> 'dumpTemp')::numeric)::text || '±' || trim_scale(v_rec.dump_tol)::text);
        end if;
        v_stages := v_stages || jsonb_build_array(jsonb_build_object('stage', v_i, 'mixerTemp', v_mixer, 'dumpTemp', v_dump, 'mixMin', v_mix));
      end loop;
      v_issued := coalesce((select sum((e ->> 'actualKg')::numeric) from jsonb_array_elements(v_req.lines) e), 0);
      if v_good + v_scrap > v_issued + 0.5 then raise exception 'RF_INVALID_LOT'; end if;
      v_uom := 'kg';
      v_ready := now() + v_rec.rest_hours::double precision * interval '1 hour';
      v_out := jsonb_build_object('stages', v_stages, 'batches', v_req.batches);
      v_sources := jsonb_build_array(jsonb_build_object('type', 'requisition', 'id', v_req.req_no));
    else
      -- ฉีด / อบ / ตกแต่ง: รับจากใบส่งมอบที่รับมอบแล้วและส่งมาสถานีนี้
      select * into v_tr from public.rf_transfers t where t.is_test = (select private.bom_test_mode()) and t.transfer_no = v_src_id for update;
      if not found or v_tr.to_stage <> v_stage then raise exception 'RF_INVALID_LOT'; end if;
      if v_tr.status <> 'received' then
        perform private.rf_fail(v_tr.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
      end if;
      v_use := private.bom_num(v_src -> 'qty', 'RF_INVALID_LOT', 0, 1000000000);
      if v_use is null or v_use <= 0 then raise exception 'RF_INVALID_LOT'; end if;
      if v_use > v_tr.remaining + 0.000000001 then
        perform private.rf_fail(v_tr.changed_version, p_base, p_cur, 'RF_INVALID_LOT');
      end if;
      v_order_no := v_tr.order_no;
      select * into v_ord from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_order_no;
      v_uom := v_ord.uom;
      v_sources := jsonb_build_array(jsonb_build_object('type', 'transfer', 'id', v_tr.transfer_no, 'lotId', v_tr.lot_no, 'qty', v_use));

      if v_stage = 'extrusion' then
        v_rework := coalesce(private.bom_num(v_params -> 'reworkKg', 'RF_INVALID_LOT', 0, 1000000000), 0);
        v_pct := v_rework / (v_use + v_rework) * 100;
        if v_pct > 10 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'dieId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test = (select private.bom_test_mode()) and m.mold_no = v_mold_id for update;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_thick := private.bom_num(v_params -> 'thickness', 'RF_INVALID_LOT', 0, 1000000);
        v_width := private.bom_num(v_params -> 'width', 'RF_INVALID_LOT', 0, 1000000);
        v_wpm := private.bom_num(v_params -> 'weightPerM', 'RF_INVALID_LOT', 0, 1000000);
        if v_thick is null or v_width is null or v_wpm is null then raise exception 'RF_INVALID_LOT'; end if;
        -- สเปกมิติของสูตรยางที่ WO ผูก (revision ของ WO · 20261129010000) แทนค่าตายตัวของเส้น Door Seal: กักเฉพาะค่าที่สูตรกำหนด
        -- สูตรที่ไม่มีสเปก หรือไม่มีค่านั้น = เก็บค่าที่วัด ไม่กักตามมิติ · ข้อความเหตุผลรูปเดิม
        v_espec := null;
        select r.extrusion_spec into v_espec from public.rf_recipes r
        where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_ord.recipe_code and r.revision = v_ord.recipe_revision;
        if coalesce(v_espec ? 'thickness', false)
           and not private.rf_in_spec(v_thick, (v_espec #>> '{thickness,target}')::numeric, (v_espec #>> '{thickness,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('ความหนา ' || trim_scale(v_thick)::text || ' mm นอกสเปก');
        end if;
        if coalesce(v_espec ? 'width', false)
           and not private.rf_in_spec(v_width, (v_espec #>> '{width,target}')::numeric, (v_espec #>> '{width,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('ความกว้าง ' || trim_scale(v_width)::text || ' mm นอกสเปก');
        end if;
        if coalesce(v_espec ? 'weightPerM', false)
           and not private.rf_in_spec(v_wpm, (v_espec #>> '{weightPerM,target}')::numeric, (v_espec #>> '{weightPerM,tol}')::numeric, null) then
          v_reasons := v_reasons || to_jsonb('น้ำหนักต่อเมตร ' || trim_scale(v_wpm)::text || ' g/m นอกสเปก');
        end if;
        v_out := jsonb_build_object('thickness', v_thick, 'width', v_width, 'weightPerM', v_wpm,
                                    'reworkKg', v_rework, 'reworkPct', trim_scale(round(v_pct, 2)), 'useKg', v_use);
      elsif v_stage = 'curing' then
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'moldId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test = (select private.bom_test_mode()) and m.mold_no = v_mold_id for update;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_temp := private.bom_num(v_params -> 'temp', 'RF_INVALID_LOT', 0, 1000000);
        v_time := private.bom_num(v_params -> 'time', 'RF_INVALID_LOT', 0, 1000000);
        v_press := private.bom_num(v_params -> 'pressure', 'RF_INVALID_LOT', 0, 1000000);
        if v_temp is null or v_time is null or v_press is null then raise exception 'RF_INVALID_LOT'; end if;
        if not private.rf_in_spec(v_temp, 200, 6, null) then
          v_reasons := v_reasons || to_jsonb('อุณหภูมิอบ ' || trim_scale(v_temp)::text || ' °C นอกสเปก');
        end if;
        if not private.rf_in_spec(v_time, 150, 10, null) then
          v_reasons := v_reasons || to_jsonb('เวลาอบ ' || trim_scale(v_time)::text || ' s นอกสเปก');
        end if;
        if not private.rf_in_spec(v_press, 150, 15, null) then
          v_reasons := v_reasons || to_jsonb('ความดัน ' || trim_scale(v_press)::text || ' bar นอกสเปก');
        end if;
        v_out := jsonb_build_object('temp', v_temp, 'time', v_time, 'pressure', v_press);
        v_machine := v_mold.name;
      else
        -- ปลายทางของล็อตตกแต่ง (20261205010000): ผลผ่านไปคลังยางเส้นยาว SR (sr · เฉพาะ WO ที่ผูกงาน BOM) หรือส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป WH (customer)
        --   ไม่ส่งปลายทาง = WO ที่ผูกงานไป sr (เหมือน Pilot รุ่นก่อน) · WO ที่ไม่ผูกงานไป customer เสมอ (ส่ง sr มา = RF_INVALID_LOT)
        --   ผล hold / fail ไม่มีปลายทาง (ส่งมา = RF_INVALID_LOT) · QA ปล่อยภายหลังเลือกตามการผูกงาน (rf_save_qc)
        v_linked := coalesce(private.bom_rod_wo_linked(v_ord), false);
        v_qc := coalesce(nullif(private.bom_text(v_row, 'qc', 10, 0, 'RF_INVALID_LOT'), ''), 'pass');
        if v_qc not in ('pass', 'hold', 'fail') then raise exception 'RF_INVALID_LOT'; end if;
        v_dest := nullif(private.bom_text(v_row, 'destination', 10, 0, 'RF_INVALID_LOT'), '');
        if v_qc = 'pass' then
          v_dest := coalesce(v_dest, case when v_linked then 'sr' else 'customer' end);
          if v_dest not in ('sr', 'customer') or (v_dest = 'sr' and not v_linked) then raise exception 'RF_INVALID_LOT'; end if;
        elsif v_dest is not null then
          raise exception 'RF_INVALID_LOT';
        end if;
        -- กล่องเกิดเมื่อของไปหาลูกค้า: WO ที่ไม่ผูกงานทุกผล หรือ WO ที่ผูกงานที่เลือก customer (perBox บังคับ > 0)
        -- ยางเส้นยาวที่ไป SR และล็อตกักของ WO ที่ผูกงานไม่มีกล่อง (boxes = 0 perBox ไม่บังคับ ส่งมาต้อง > 0)
        v_boxed := not v_linked or coalesce(v_dest = 'customer', false);
        v_perbox := private.bom_num(v_params -> 'perBox', 'RF_INVALID_LOT', 0, 1000000000);
        if v_perbox is null then
          if v_boxed then raise exception 'RF_INVALID_LOT'; end if;
        elsif v_perbox <= 0 then
          raise exception 'RF_INVALID_LOT';
        end if;
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_grade := coalesce(nullif(private.bom_text(v_row, 'grade', 20, 0, 'RF_INVALID_LOT'), ''), 'A');
        if v_boxed then
          v_boxes := case when v_good > 0 then ceil(v_good / v_perbox)::integer else 0 end;
          if v_boxes > 1000 then raise exception 'RF_INVALID_LOT'; end if;
          v_out := jsonb_build_object('perBox', v_perbox);
        else
          v_boxes := 0;
          v_out := case when v_perbox is null then '{}'::jsonb else jsonb_build_object('perBox', v_perbox) end;
        end if;
      end if;
    end if;

    -- ล็อตที่ client ระบุใบสั่งผลิตต่างจากเอกสารต้นทาง = ผิด
    v_cid := nullif(private.bom_text(v_row, 'orderId', 40, 0, 'RF_INVALID_LOT'), '');
    if v_cid is not null and v_cid <> v_order_no then raise exception 'RF_INVALID_LOT'; end if;

    -- บันทึกล็อตของสถานีไหนก็ได้เฉพาะใบ WO ที่ released / in_progress / on_hold (planned / completed / cancelled = RF_INVALID_TRANSITION)
    -- ข้อยกเว้นเดียว: ล็อตตกแต่งที่ client ปิดใบเป็น completed ในคำสั่งเดียวกัน (ใบถูกประทับด้วยเวอร์ชันของคำสั่งนี้ เพราะ client ปิดใบเองเมื่อครบเป้า)
    select * into v_ord from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_order_no for update;
    if not found then raise exception 'RF_INVALID_LOT'; end if;
    if v_ord.status not in ('released', 'in_progress', 'on_hold')
       and not (v_stage = 'finishing' and v_ord.status = 'completed' and v_ord.changed_version > p_cur) then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
    end if;

    if v_stage = 'finishing' then
      -- ผลตัดสินของงานตกแต่งมาจากผู้บันทึก (ผ่านนับเข้าใบทันที) อื่น ๆ รอ QA
      v_qc := coalesce(nullif(private.bom_text(v_row, 'qc', 10, 0, 'RF_INVALID_LOT'), ''), 'pass');
      if v_qc not in ('pass', 'hold', 'fail') then raise exception 'RF_INVALID_LOT'; end if;
      if v_qc <> 'pass' then v_reasons := to_jsonb(array['ผลตรวจตกแต่งไม่ผ่าน/รอตัดสิน']); end if;
    else
      v_qc := case when jsonb_array_length(v_reasons) > 0 then 'hold' else 'pass' end;
    end if;

    insert into public.rf_lots (
      is_test, lot_no, stage, order_no, recipe_code, uom, machine, shift, mold_id, sources, params, good_qty, scrap_qty, scrap_reason,
      qc, hold_reasons, transferred_qty, ready_at, grade, boxes, counted_to_order, destination, created_by)
    values (
      (select private.bom_test_mode()), v_no, v_stage, v_order_no, case when v_stage = 'mixing' then v_rec.recipe_code end, v_uom, v_machine, v_shift, v_mold_id,
      v_sources, v_out, v_good, v_scrap, v_reason, v_qc, v_reasons, 0, v_ready, v_grade, v_boxes, (v_stage = 'finishing' and v_qc = 'pass'), v_dest, p_actor.id)
    returning * into v_flot;

    -- ผลข้างเคียง (ธุรกรรมเดียวกัน) ---------------------------------------------------------------
    if v_stage = 'mixing' then
      update public.rf_requisitions set status = 'consumed', consumed_by_lot = v_no, updated_at = now() where id = v_req.id;
      update public.rf_orders set status = 'in_progress', updated_at = now() where is_test = (select private.bom_test_mode()) and wo_no = v_order_no and status = 'released';
    else
      update public.rf_transfers set remaining = trim_scale(round(remaining - v_use, 3)), updated_at = now() where id = v_tr.id;
      if v_stage = 'extrusion' then
        update public.rf_molds set usage_since_clean = usage_since_clean + v_good, total_usage = total_usage + v_good, updated_at = now() where id = v_mold.id;
      elsif v_stage = 'curing' then
        v_shots := ceil((v_good + v_scrap) / v_mold.per_cycle);
        update public.rf_molds set usage_since_clean = usage_since_clean + v_shots, total_usage = total_usage + v_shots, updated_at = now() where id = v_mold.id;
      else
        -- กล่อง: ใบละไม่เกิน perBox ชิ้น (กล่องสุดท้ายเศษ) id = เลขล็อต (FN -> BOX) ต่อด้วยลำดับ 3 หลัก
        -- 20261205010000: กล่องที่ผ่านรอ WH รับเข้า (pending_wh) แทนพร้อมส่งทันที · เก็บลูกค้าและเลข PO / PI ของ WO ไว้กับกล่อง (ส่งมอบให้ลูกค้ารายนั้น)
        for v_i in 1..v_boxes loop
          insert into public.rf_fg_boxes (is_test, box_no, lot_no, order_no, recipe_code, product_code, qty, uom, grade, status, customer, customer_po)
          values ((select private.bom_test_mode()), regexp_replace(v_no, 'FN', 'BOX') || '-' || lpad(v_i::text, 3, '0'), v_no, v_order_no, v_ord.recipe_code, v_ord.product_code,
                  trim_scale(round(least(v_perbox, v_good - (v_i - 1) * v_perbox), 3)), v_uom, v_grade,
                  case when v_qc = 'pass' then 'pending_wh' else 'hold' end, v_ord.customer, v_ord.customer_po);
        end loop;
        if v_qc = 'pass' then
          perform private.rf_add_produced(v_order_no, v_good, p_may_close, p_base, p_cur);
          -- ชิ้นผ่านสถานีสุดท้าย (ตกแต่ง QC ผ่าน นับเข้า WO) = ป้อนผลผลิตกลับงาน BOM ที่ผูกกับ WO นี้ ณ จุดเดียวกับที่นับเข้า WO
          -- 20261202010000: WO ที่ผูกงาน BOM ไม่ป้อนยอดให้งานที่นี่แล้ว ล็อตเป็นแท่งรอรับเข้าคลัง SR (bom_rod_lots pending)
          -- งาน RB ได้ยอดเมื่อ SR รับเข้าผ่าน / QA ยอมรับ · WO ที่ไม่ผูกงานเรียก rf_apply_feedback เหมือนเดิม
          -- 20261205010000: ปลายทาง customer ของ WO ที่ผูกงานไม่สร้างล็อตยางเส้นยาว งาน RB นับยอดเมื่อ WH รับกล่องของล็อตเข้าคลัง (private.rf_box_credit)
          if v_linked then
            if v_dest = 'sr' then
              v_rods := v_rods + private.bom_rod_lot_create(v_flot, v_ord);
            end if;
          else
            v_res := private.rf_apply_feedback(p_actor_name, v_flot, v_ord);
            v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
            v_orders := v_orders + (v_res ->> 'orders')::integer;
          end if;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders, 'rodLots', v_rods);
end;
$$;
revoke all on function private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) จาก 20261202010000_bom_sr_rod_store.sql
--   (+ ปลายทางของล็อตที่ QA ปล่อยครั้งแรก · กล่องที่ผ่านกลับไป pending_wh / in_stock ตามการรับของ WH)
create or replace function private.rf_save_qc(p_actor public.employees, p_may boolean, p_may_close boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_old public.rf_qc_records%rowtype;
  v_lot public.rf_lots%rowtype;
  v_node jsonb;
  v_el jsonb;
  v_tests jsonb;
  v_keys text[];
  v_key text;
  v_spec jsonb;
  v_val numeric;
  v_pass boolean;
  v_all boolean;
  v_result text;
  v_note text;
  v_count boolean;
  v_wo public.rf_orders%rowtype;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
  v_rods integer := 0;
  v_linked boolean;
  v_dest text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_QC'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_QC');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_QC'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_qc_records q where q.is_test = (select private.bom_test_mode()) and q.qc_no = v_no;
    if found then
      -- ผลตรวจเดิมแก้ไม่ได้ (เมินความต่าง) · เลขซ้ำกับที่คนอื่นเพิ่งบันทึก (เวลาต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['at', 'testedAt'], v_old.tested_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      continue;
    end if;

    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    select * into v_lot from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = private.bom_text(v_row, 'lotId', 60, 1, 'RF_INVALID_QC') for update;
    if not found then raise exception 'RF_INVALID_QC'; end if;
    v_node := v_row -> 'tests';
    if jsonb_typeof(v_node) is distinct from 'array' or jsonb_array_length(v_node) not between 1 and 20 then raise exception 'RF_INVALID_QC'; end if;
    v_tests := '[]'::jsonb;
    v_keys := '{}';
    v_all := true;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'object' then raise exception 'RF_INVALID_QC'; end if;
      v_key := private.bom_text(v_el, 'key', 20, 1, 'RF_INVALID_QC');
      v_spec := private.rf_lab_specs() -> v_key;
      if v_spec is null or v_key = any (v_keys) then raise exception 'RF_INVALID_QC'; end if;
      v_keys := v_keys || v_key;
      v_val := private.bom_num(v_el -> 'value', 'RF_INVALID_QC', -1000000000, 1000000000);
      if v_val is null then raise exception 'RF_INVALID_QC'; end if;
      v_pass := private.rf_in_spec(v_val, (v_spec ->> 'target')::numeric, (v_spec ->> 'tol')::numeric, (v_spec ->> 'min')::numeric);
      v_all := v_all and v_pass;
      v_tests := v_tests || jsonb_build_array(jsonb_build_object('key', v_key, 'value', v_val, 'pass', v_pass));
    end loop;
    v_result := private.bom_text(v_row, 'result', 10, 1, 'RF_INVALID_QC');
    if v_result not in ('pass', 'hold', 'fail') or (v_result = 'pass' and not v_all) then raise exception 'RF_INVALID_QC'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_QC');
    -- fail เป็นสถานะสุดท้ายของล็อต (ย้อนเป็น pass/hold ไม่ได้)
    if v_lot.qc = 'fail' and v_result <> 'fail' then
      perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
    end if;

    insert into public.rf_qc_records (is_test, qc_no, lot_no, order_no, stage, tests, result, note, tested_by)
    values ((select private.bom_test_mode()), v_no, v_lot.lot_no, v_lot.order_no, v_lot.stage, v_tests, v_result, v_note, p_actor.id);
    v_count := v_lot.stage = 'finishing' and v_result = 'pass' and not v_lot.counted_to_order;
    v_dest := v_lot.destination;
    v_linked := false;
    if v_count then
      select * into v_wo from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_lot.order_no;
      v_linked := coalesce(private.bom_rod_wo_linked(v_wo), false);
      -- 20261205010000: ล็อตที่กักไว้ไม่มีปลายทาง QA ปล่อยครั้งแรก = WO ที่ผูกงานไปคลังยางเส้นยาว SR (เหมือนเดิม) · WO ที่ไม่ผูกงานส่งมอบให้ลูกค้าผ่าน WH
      v_dest := coalesce(v_dest, case when v_linked then 'sr' else 'customer' end);
    end if;
    update public.rf_lots set
      qc = v_result,
      hold_reasons = case when v_result = 'pass' then '[]'::jsonb else hold_reasons end,
      counted_to_order = counted_to_order or v_count,
      destination = v_dest,
      updated_at = now()
    where id = v_lot.id
      and (qc is distinct from v_result or (v_result = 'pass' and hold_reasons <> '[]'::jsonb) or v_count);
    -- กล่องที่ยังไม่ส่งมอบตามผล QA (20261205010000): ผ่าน = กลับที่เดิม (WH รับเข้าแล้ว received_at มีค่า = in_stock · ยังไม่รับ = pending_wh รอ WH รับ) · อื่น = hold
    update public.rf_fg_boxes b
    set status = (case when v_result <> 'pass' then 'hold' when b.received_at is null then 'pending_wh' else 'in_stock' end), updated_at = now()
    where b.is_test = (select private.bom_test_mode()) and b.lot_no = v_lot.lot_no and b.status <> 'shipped'
      and b.status <> (case when v_result <> 'pass' then 'hold' when b.received_at is null then 'pending_wh' else 'in_stock' end);
    if v_count then
      perform private.rf_add_produced(v_lot.order_no, v_lot.good_qty, p_may_close, p_base, p_cur);
      -- QA ตัดสินล็อตตกแต่งเป็น pass ครั้งแรก = ชิ้นผ่านสถานีสุดท้าย ป้อนผลผลิตกลับงาน BOM ณ จุดเดียวกับที่นับเข้า WO
      -- 20261202010000: ล็อตของ WO ที่ผูกงาน BOM เป็นแท่งรอรับเข้าคลัง SR (ครั้งเดียว: v_count เป็นจริงครั้งเดียวต่อล็อต) แทนการป้อนยอดให้งาน
      if v_linked then
        if v_dest = 'sr' then
          v_rods := v_rods + private.bom_rod_lot_create(v_lot, v_wo);
        end if;
      else
        v_res := private.rf_apply_feedback(p_actor.first_name || ' ' || p_actor.last_name, v_lot, v_wo);
        v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
        v_orders := v_orders + (v_res ->> 'orders')::integer;
      end if;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders, 'rodLots', v_rods);
end;
$$;
revoke all on function private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 6. ชุดเรคอร์ด ----------------------------------------------------------------------------------------------------------------
-- private.rf_records(bigint) จาก 20261130010000_bom_rf_go_live.sql (+ destination / whCredit ของล็อตตกแต่ง · customer / customerPo / moves / receivedAt / receivedBy ของกล่อง)
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
      from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
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
        || case when r.extrusion_spec is null then '{}'::jsonb else jsonb_build_object('extrusionSpec', r.extrusion_spec) end
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb),
    'molds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.mold_no, 'name', d.name, 'kind', d.kind, 'unit', d.unit, 'perCycle', d.per_cycle, 'cleanEvery', d.clean_every,
          'pmLimit', d.pm_limit, 'totalUsage', d.total_usage, 'usageSinceClean', d.usage_since_clean)
        || case when d.last_clean_at is null then '{}'::jsonb else jsonb_build_object('lastCleanAt', private.bom_ms(d.last_clean_at)) end
        order by d.mold_no collate "C")
      from public.rf_molds d where d.is_test = (select private.bom_test_mode()) and d.changed_version > p_since), '[]'::jsonb),
    'materialLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'lotNo', l.lot_no, 'materialCode', l.material_code, 'qtyKg', l.qty_kg, 'initialKg', l.initial_kg, 'expiry', l.expiry,
          'supplier', l.supplier, 'location', l.location, 'status', l.status, 'coa', l.coa,
          'receivedAt', private.bom_ms(l.received_at), 'receivedBy', coalesce(private.bom_person(l.received_by), ''))
        order by l.lot_no collate "C")
      from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.changed_version > p_since), '[]'::jsonb),
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
        || case when t.stage = 'finishing' then jsonb_build_object('grade', t.grade, 'boxes', t.boxes, 'countedToOrder', t.counted_to_order,
                  'destination', t.destination,
                  'whCredit', case when t.wh_credit_qty is null then null else jsonb_build_object('jobNo', t.wh_credit_job_no, 'qty', t.wh_credit_qty) end)
                else '{}'::jsonb end
        order by t.lot_no collate "C")
      from public.rf_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_transfers x where x.is_test = (select private.bom_test_mode()) and x.changed_version > p_since), '[]'::jsonb),
    'fgBoxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.box_no, 'lotId', b.lot_no, 'orderId', b.order_no, 'recipeId', b.recipe_code, 'productCode', b.product_code,
          'qty', b.qty, 'uom', b.uom, 'grade', b.grade, 'status', b.status, 'createdAt', private.bom_ms(b.created_at),
          'customer', b.customer, 'customerPo', b.customer_po, 'moves', b.moves)
        || case when b.received_at is null then '{}'::jsonb
                else jsonb_build_object('receivedAt', private.bom_ms(b.received_at), 'receivedBy', coalesce(private.bom_person(b.received_by), '')) end
        || case when b.shipped_at is null then '{}'::jsonb
                else jsonb_build_object('shippedAt', private.bom_ms(b.shipped_at), 'shippedBy', coalesce(private.bom_person(b.shipped_by), '')) end
        order by b.box_no collate "C")
      from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.changed_version > p_since), '[]'::jsonb),
    'qcRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.qc_no, 'lotId', c.lot_no, 'orderId', c.order_no, 'stage', c.stage, 'tests', c.tests, 'result', c.result, 'note', c.note,
          'inspector', coalesce(private.bom_person(c.tested_by), ''), 'at', private.bom_ms(c.tested_at),
          'testedBy', coalesce(private.bom_person(c.tested_by), ''), 'testedAt', private.bom_ms(c.tested_at))
        order by c.qc_no collate "C")
      from public.rf_qc_records c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_ncrs n where n.is_test = (select private.bom_test_mode()) and n.changed_version > p_since), '[]'::jsonb),
    'purchaseOrders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.po_no, 'status', o.status, 'sourcePi', o.source_pi, 'sourceRequisition', o.source_requisition, 'note', o.note,
          'lines', o.lines, 'createdAt', private.bom_ms(o.created_at), 'createdBy', coalesce(private.bom_person(o.created_by), ''),
          'cancelledAt', private.bom_ms(o.cancelled_at))
        order by o.po_no collate "C")
      from public.rf_purchase_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- 7. RPC บันทึกของ RubberFlow ----------------------------------------------------------------------------------------------------
-- public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261204010000_bom_sr_store_module.sql
--   (+ คำสั่งของกล่องส่งได้เฉพาะชุด fgBoxes · ตัวเขียนกล่องลายเซ็นใหม่ นับงาน / ใบของ BOM ที่ตัวเขียนกล่องแก้)
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
  v_bom_rods integer := 0;
  v_box_actions constant text[] := array['shipBoxes', 'receiveBoxes', 'reverseBoxReceipt', 'reverseBoxShip'];
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_bom_save_master (20261108020000: ปล่อยผลิตแล้วเปิด WO ล็อก BOM ก่อน RF) ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ จึงไม่วนกัน
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.rf_reader();
  v_planner := private.bom_can_edit(v_actor);
  v_rb := private.rf_is_rb(v_actor);
  v_head := private.rf_is_rb_head(v_actor);
  v_qa := private.rf_is_qa(v_actor);
  v_st := coalesce(private.bom_dept_of(v_actor) = 'ST', false);
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
      -- กล่องสินค้า (20261205010000): สี่คำสั่งของกล่อง (รับเข้า ส่งมอบ ย้อนรับเข้า ย้อนส่งมอบ) ส่งได้เฉพาะชุด fgBoxes (รูปคำขอ ตรวจก่อนสิทธิ์ของชุด)
      if v_n > 0 and p_action = any (v_box_actions) and v_key <> 'fgBoxes' then
        raise exception 'RF_INVALID_BOX';
      end if;
      -- ใครส่งชุดไหนมาได้บ้าง (ตรวจหยาบก่อน: สิทธิ์รายระเบียน/รายช่องตรวจในตัวเขียนหลังตรวจชน) ชุดที่เป็นผลข้างเคียงของ action ของแผนกอื่น
      -- (เช่น ล็อตวัตถุดิบตอน RB ชั่ง กล่อง/ล็อตตอน QA ตรวจ) ผู้ส่งมาด้วยได้ แต่ช่องที่เซิร์ฟเวอร์คำนวณเองเมิน ช่องที่เขียนได้จริงตรวจรายช่อง
      v_may := case v_key
        when 'materials' then v_planner or v_rb or (v_st and p_action = 'createPurchaseOrder')
        when 'recipes' then v_planner or v_rb
        when 'orders' then v_planner or v_rb or (v_qa and p_action = 'addQcRecord')
        when 'molds' then v_planner or v_rb
        when 'materialLots' then v_planner or v_rb or v_st or v_qa
        when 'requisitions' then v_planner or v_rb or (v_st and p_action = 'returnRequisition')
        when 'lots' then v_planner or v_rb or v_qa
        -- ใบส่งมอบ WIP ระหว่างสถานีของ RB: ส่งและรับมอบโดยแผนก RB หรือกลุ่มวางแผน (ผู้รับเดิมคือแผนก SR จนถึง 20261202010000)
        when 'transfers' then v_planner or v_rb
        when 'fgBoxes' then v_planner or v_rb or v_wh or v_qa
        when 'qcRecords' then v_planner or v_qa
        when 'ncrs' then v_planner or v_qa or v_rb
        when 'purchaseOrders' then v_planner or v_rb or v_st
        else false end;
      if v_n > 0 and not v_may then raise exception 'RF_FORBIDDEN'; end if;
      -- ใบสั่งซื้อ: ชุด purchaseOrders ส่งได้เฉพาะสี่คำสั่งของใบสั่งซื้อ และแต่ละคำสั่งส่งได้เฉพาะชุดที่เกี่ยวข้อง (รับเข้า = ใบ + ล็อตวัตถุดิบ, สร้าง = ใบ + วัตถุดิบ, ยกเลิก / ปิดยอดที่เหลือ = ใบ)
      if v_n > 0 and ((v_key = 'purchaseOrders' and not (p_action = any (array['createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'closePurchaseLine'])))
                      or (p_action = 'createPurchaseOrder' and v_key not in ('purchaseOrders', 'materials'))
                      or (p_action = 'receivePurchaseLine' and v_key not in ('purchaseOrders', 'materialLots'))
                      or (p_action in ('cancelPurchaseOrder', 'closePurchaseLine') and v_key <> 'purchaseOrders')) then
        raise exception 'RF_INVALID_PURCHASE';
      end if;
      -- รับเคมีคืน (20261128010000): returnRequisition ส่งได้เฉพาะชุดใบเบิก และล็อตวัตถุดิบ (สำเนายอดที่ client คำนวณไว้ ตัวเขียนล็อตเมินยอดอยู่แล้ว)
      if v_n > 0 and p_action = 'returnRequisition' and v_key not in ('requisitions', 'materialLots') then
        raise exception 'RF_INVALID_REQUISITION';
      end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับ RF ก่อนตรวจชน (ลำดับล็อก: RF ก่อน BOM เสมอ) v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน)
  insert into public.rf_master_state (is_test) values ((select private.bom_test_mode())) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.rf_master_state s where s.is_test = (select private.bom_test_mode()) for update;
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
       and exists (select 1 from public.rf_material_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version) then
      raise exception 'RF_INVALID_PURCHASE';
    end if;
    -- รับเคมีคืนเข้าล็อตเดิม (returnRequisition: แผนก ST หรือ admin) ใช้ตัวเขียนของตัวเอง · คำสั่งอื่นใช้ตัวเขียนใบเบิกเดิม
    if p_action = 'returnRequisition' then
      perform private.rf_return_requisitions(v_actor, v_actor_name, coalesce(p_changes #> '{requisitions,upsert}', '[]'::jsonb), p_base_version, v_version);
    else
      perform private.rf_save_requisitions(v_actor.id, v_actor_name, v_planner or v_rb, p_action, coalesce(p_changes #> '{requisitions,upsert}', '[]'::jsonb), p_base_version, v_version);
    end if;
    -- ป้อนผลผลิตกลับงาน BOM เกิดที่ล็อตตกแต่งผ่าน (rf_save_lots) และตอน QA ตัดสินล็อตตกแต่งเป็น pass (rf_save_qc) เท่านั้น ใบส่งมอบรับมอบไม่เขียน BOM
    v_res := private.rf_save_lots(v_actor, v_actor_name, v_planner or v_rb, v_planner or v_rb, p_action, coalesce(p_changes #> '{lots,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    -- คลังแท่งยาว SR (20261202010000): ล็อตตกแต่งของ WO ที่ผูกงาน BOM ที่ผ่าน = แท่งรอรับเข้าคลัง (bom_rod_lots) นับเป็นการเขียนฝั่ง BOM
    v_bom_rods := v_bom_rods + coalesce((v_res ->> 'rodLots')::integer, 0);
    -- รับมอบใบส่งมอบ WIP: แผนก RB หรือกลุ่มวางแผน (20261204010000 · เดิมแผนก SR)
    perform private.rf_save_transfers(v_actor, v_planner or v_rb, v_planner or v_rb,
                                      coalesce(p_changes #> '{transfers,upsert}', '[]'::jsonb), p_base_version, v_version);
    -- กล่องสินค้า (20261205010000): รับเข้า / ส่งมอบ = แผนก WH หรือ admin · ย้อนรับเข้า / ย้อนส่งมอบ = ผู้จัดการแผนก WH หรือ admin (ตรวจในตัวเขียน)
    --   รับเข้าล็อตที่ส่งมอบให้ลูกค้าของ WO ที่ผูกงาน BOM = นับยอดเข้างาน RB · ย้อนรับเข้า = ถอนยอดนั้น (เขียนฝั่ง BOM นับใน v_bom_jobs / v_bom_orders)
    v_res := private.rf_save_boxes(v_actor, v_actor_name, p_action, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    v_res := private.rf_save_qc(v_actor, v_planner or v_qa, v_planner or v_rb, coalesce(p_changes #> '{qcRecords,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    v_bom_rods := v_bom_rods + coalesce((v_res ->> 'rodLots')::integer, 0);
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
  if v_bom_jobs + v_bom_orders + v_bom_stock + v_bom_rods = 0
     and not exists (select 1 from public.rf_materials t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_recipes t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_orders t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_molds t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_material_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_requisitions t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_transfers t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_fg_boxes t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_qc_records t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_ncrs t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_purchase_orders t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version) then
    return private.rf_delta(p_base_version);
  end if;

  v_version := v_version + 1;
  update public.rf_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode());

  -- เขียนฝั่ง BOM (ผูกงาน / ป้อนผลผลิตกลับ / ล้างการผูก): เพิ่มตัวนับ BOM อีก 1 (ล็อกไว้แล้วตอนเขียนงาน) แถวที่แก้ถูกประทับเวอร์ชันนี้โดย trigger แล้ว
  -- เขียน audit ของ BOM ด้วย ให้ประวัติ BOM บอกว่างาน/ใบเปลี่ยนเพราะ RubberFlow
  if v_bom_jobs + v_bom_orders + v_bom_stock + v_bom_rods > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode())
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when v_bom_jobs > 0 then jsonb_build_object('upsert', v_bom_jobs) end,
                                 'orders', case when v_bom_orders > 0 then jsonb_build_object('upsert', v_bom_orders) end,
                                 'stock', case when v_bom_stock > 0 then jsonb_build_object('upsert', v_bom_stock) end,
                                 'rodLots', case when v_bom_rods > 0 then jsonb_build_object('upsert', v_bom_rods) end)),
                               'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', v_bom_jobs, 'bom_orders', v_bom_orders, 'bom_stock', v_bom_stock, 'bom_rod_lots', v_bom_rods,
                             'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;
revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;
