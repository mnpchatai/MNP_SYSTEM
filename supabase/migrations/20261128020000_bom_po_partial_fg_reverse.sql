-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ (ชุดแก้ 2 จากรายงานทดสอบ docs/BOM_TEST_REPORT.md: W2 U3)
--   รับของตามใบสั่งซื้อได้หลายครั้งต่อบรรทัด และ ST ปิดยอดที่เหลือพร้อมเหตุผล · ผู้จัดการแผนกคลังสินค้า (WH) และ admin ย้อนการรับเข้าคลัง / ส่งมอบสินค้าสำเร็จรูปที่บันทึกผิดได้
--
-- ทำไม (รายงานทดสอบ 2026-11-17):
--   W2  รับของตามใบสั่งซื้อไม่ครบ (สั่ง 77.25 รับ 50) บรรทัดถือว่ารับแล้ว ปุ่มหาย ส่วนที่ผู้ขายยังไม่ส่งไม่นับเป็น "สั่งแล้วรอรับ" ใบร่างกลับมาขาดและ ST ได้การ์ดให้สั่งซ้ำ
--       (private.rf_save_purchase_orders เก็บ receivedKg ครั้งเดียว · ยอดค้างรับฝั่ง client นับเฉพาะบรรทัดที่ receivedKg ยังว่าง)
--   U3  รับเข้าคลังหรือส่งมอบผิด (พิมพ์ 50 แทน 5) แก้ไม่ได้เลย: bom_fg_moves เขียนต่อท้ายอย่างเดียว ไม่มีคำสั่งย้อน
--
-- กติกาใหม่ (ทุกข้อฝั่งฐานข้อมูล · mock ของ harness ทำเหมือนกัน scripts/pilot-harness-mock.mjs · กฎฝั่งหน้าจอ modules/rubberflow-rules.js poLine* และ modules/bom-rules.js fgLedger)
--   1) บรรทัดใบสั่งซื้อ (rf_purchase_orders.lines[] เป็น jsonb ไม่มีคอลัมน์หรือสถานะใหม่ · CHECK ของสถานะเดิม ordered / received / cancelled)
--      - receivedKg = ยอดรับสะสม · receipts = [{ kg, lotNo, expiry, at, by }] เซิร์ฟเวอร์ต่อท้ายทีละครั้ง · lotNo / expiry / receivedAt / receivedBy ของบรรทัด = ของครั้งล่าสุด
--      - closedRemainder = { kg, reason, at, by } ตั้งโดยคำสั่งใหม่ closePurchaseLine (kg = ยอดที่ไม่รับแล้ว ณ ตอนปิด)
--      - received(บรรทัด) = Σ receipts ถ้ามี ไม่เช่นนั้น receivedKg (ไม่มี = 0) · closed = มี closedRemainder หรือบรรทัดรุ่นเก่า (มี receivedKg แต่ไม่มี receipts)
--        open = closed ? 0 : max(0, qtyKg - received) · บรรทัดครบ (done) = closed หรือ received >= qtyKg · ใบเป็น received เมื่อทุกบรรทัดครบ ไม่เช่นนั้น ordered
--        (private.rf_po_line_received / private.rf_po_line_done ใหม่ · บรรทัดรุ่นเก่าที่รับไปแล้วถือว่าปิด ตัวเลขเดิมไม่กลับมาค้างรับ)
--   2) รับเข้า (receivePurchaseLine) ซ้ำได้ขณะที่บรรทัดยังไม่ครบ · แผนก ST หรือ admin เหมือนเดิม · client ส่ง receivedKg = ยอดสะสมใหม่
--      เซิร์ฟเวอร์คำนวณยอดครั้งนี้ = สะสมใหม่ - สะสมที่เก็บ ต้อง > 0 (ไม่เชื่อส่วนต่างของ client) · สะสมน้อยกว่าที่เก็บ = แก้การรับที่บันทึกแล้ว (RF_INVALID_TRANSITION เหมือนเดิม)
--      บรรทัดที่ครบแล้วรับอีกไม่ได้ (RF_INVALID_TRANSITION) · รับเกินยอดสั่งได้เหมือนเดิม (open เป็น 0)
--      ของซื้อ: บวกสต็อกเฉพาะยอดครั้งนี้ ประวัติ bom_stock_moves หนึ่งแถวต่อครั้ง · เคมี: ล็อตใหม่หนึ่งล็อตต่อครั้ง (private.rf_check_po_receipt เดิม ยอดล็อต = ยอดครั้งนี้)
--   3) ปิดยอดที่เหลือ (ใหม่ closePurchaseLine): แผนก ST หรือ admin (อื่น = RF_FORBIDDEN) · ใบ ordered · หนึ่งบรรทัดที่ยังไม่ครบต่อคำสั่ง (ครบแล้ว = RF_INVALID_TRANSITION)
--      เหตุผล closedRemainder.reason 3-300 ตัวอักษร (ผิด = RF_INVALID_PURCHASE) · ไม่เปลี่ยนสต็อกหรือล็อต · ส่งได้เฉพาะชุด purchaseOrders
--      client ส่งได้แค่ { reason } ช่องอื่นของ closedRemainder และ receipts เซิร์ฟเวอร์สร้างเอง (rf_po_parse_lines ตัดทิ้ง · ใบใหม่ที่มีคำขอปิด = RF_INVALID_PURCHASE)
--   4) ยกเลิกใบสั่งซื้อได้เฉพาะเมื่อไม่มีบรรทัดไหนรับเข้าหรือปิดยอด (เดิม: ไม่มีบรรทัดรับเข้า)
--   5) สินค้าสำเร็จรูป: ชนิดใหม่ unreceive / undeliver (ย้อนรับเข้า / ย้อนส่งมอบ) คอลัมน์ใหม่ bom_fg_moves.reverses_id ชี้แถวเดิม (foreign key คู่ is_test)
--      ดัชนีเฉพาะ reverses_id (ย้อนแถวหนึ่งได้ครั้งเดียว) · แถวย้อนต้องมีเหตุผลใน note 3-300 · ย้อนเต็มแถวเท่านั้น (qty = ของแถวเดิม) แล้วบันทึกตัวเลขที่ถูกใหม่ด้วย receiveFg / deliverFg
--      คำสั่งใหม่ reverseFg (private.bom_fg_reverse) คำขอ { orderId, kind: 'reverse', moveId, note }
--      ผู้ทำ: admin หรือผู้จัดการแผนก (department_manager) ของแผนก WH · พนักงาน WH และกลุ่มวางแผนอื่น = BOM_FORBIDDEN
--      ปฏิเสธ: ไม่พบแถว / แถวของใบอื่น / ไม่ใช่ receive หรือ deliver = BOM_INVALID_FG · ย้อนแล้ว = BOM_INVALID_TRANSITION · ใบที่ยกเลิก / ร่าง = BOM_INVALID_TRANSITION
--        ย้อนรับเข้าที่ทำให้ (have หลังย้อน - out) < ส่งมอบสุทธิ = BOM_FG_EXCEEDS (ย้อนการส่งมอบก่อน)
--        ย้อนรับเข้าของใบที่ใบอื่นหยิบสต็อกไปแล้ว (out > 0) และ (have หลังย้อน - out) < จำนวนสั่ง = BOM_FG_EXCEEDS · ย้อนส่งมอบไม่มีด่านยอด
--      ใบที่ปิดแล้ว (completed) ที่หลังย้อนรับเข้ามีสินค้าที่ have < จำนวนสั่ง: เปิดกลับเป็น in_progress (completed_at = null) แถว close เดิมคงอยู่ในประวัติ
--        รับเข้าครั้งถัดไปปิดใบเองตามกติกาเดิม หรือคลังสินค้าปิดใบ (รับไม่ครบ) อีกครั้ง
--   6) ทุกยอดของสินค้าสำเร็จรูปหักแถวย้อน: private.bom_fg_total(receive) = Σ receive - Σ unreceive · (deliver) = Σ deliver - Σ undeliver
--      จึงครอบ have / free / สต็อก / เพดานรับและส่งมอบ / closeOrderShort (own = ยอด PK) / ด่านยอด PK ใน bom_save_jobs โดยไม่ต้องแก้ฟังก์ชันเหล่านั้น
--      private.bom_fg_return_stock (ยกเลิก / เปิดใบกลับ) ดูส่งมอบสุทธิ > 0 แทนการมีแถว deliver
--   ลำดับล็อก: app_bom_save_master ถือ advisory lock 'mnp_bom_rf_master' และแถว bom_master_state ทุกคำสั่ง การปล่อยผลิตที่หยิบสต็อกกับการย้อนจึงต่อคิวกันอยู่แล้ว
--      (ไม่ต้องล็อกแถวใบต้นทางเพิ่ม) · bom_fg_reverse ล็อกแถวใบของตัวเองด้วย FOR UPDATE เหมือน bom_fg_move
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม เริ่มจากนิยามล่าสุด · security definer + set search_path = '' และ revoke / grant เหมือนต้นทาง)
--   - private.rf_po_parse_lines(jsonb)                                  จาก 20261111010000_bom_part_stock.sql
--   - private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261122010000_bom_fg_guards.sql
--   - private.rf_client_actions()                                       จาก 20261128010000_bom_cancel_rf_stop.sql
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)               จาก 20261128010000_bom_cancel_rf_stop.sql (revoke all from public, anon · grant execute to authenticated)
--   - private.bom_fg_total(uuid, text, text)                            จาก 20261121010000_bom_fg_receive_deliver.sql (language sql ไม่เปลี่ยน)
--   - private.bom_fg_return_stock(uuid, uuid)                           จาก 20261123010000_bom_fg_stock.sql
--   - private.bom_records(bigint)                                       จาก 20261123010000_bom_fg_stock.sql (fgMoves มีช่อง reversesId เฉพาะแถวย้อน)
--   - private.bom_client_actions()                                      จาก 20261125010000_bom_close_rules.sql (bom_staff_actions ไม่เปลี่ยน: reverseFg ไม่อยู่ในรายการของพนักงาน)
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)       จาก 20261126010000_bom_fg_child_and_close_reason.sql (revoke all from public, anon · grant execute to authenticated)
--   ใหม่: private.rf_po_line_received(jsonb), private.rf_po_line_done(jsonb), private.bom_fg_reverse(public.employees, jsonb) (revoke all from public, anon, authenticated)
--   ตาราง: bom_fg_moves เพิ่มคอลัมน์ reverses_id + foreign key + ดัชนีเฉพาะ · constraint bom_fg_moves_kind_check / bom_fg_moves_shape_check สร้างใหม่ (แถวเดิมทุกแถวผ่าน: reverses_id เป็น null)
--   ไม่แตะ: RLS สิทธิ์ตาราง private.bom_fg_move private.bom_save_jobs private.bom_save_orders private.bom_fg_free / bom_fg_stock / bom_fg_have private.rf_check_po_receipt
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้รับของซ้ำบรรทัดเดิม ส่ง closePurchaseLine และ reverseFg จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของทุกฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางข้างบน แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (anon เรียก app_rf_save / app_bom_save_master ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้)
--   Pilot เก่า + ฐานข้อมูลใหม่: รับไม่ครบครั้งแรกเหมือนเดิม แต่บรรทัดยังค้างรับ (Pilot เก่าแสดงเป็นรับแล้ว ไม่มีปุ่มรับซ้ำ) · ไม่มีปุ่มย้อน · ข้อมูลไม่เสียหาย
--   Pilot ใหม่ + ฐานข้อมูลเก่า: รับซ้ำบรรทัดเดิม = RF_INVALID_TRANSITION · closePurchaseLine = RF_INVALID_ACTION · reverseFg = BOM_INVALID_ACTION · ไม่มีอะไรถูกเขียน
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace ฟังก์ชันทั้งหมดกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke / grant) แล้ว drop function private.bom_fg_reverse(public.employees, jsonb),
--      private.rf_po_line_done(jsonb), private.rf_po_line_received(jsonb)
--   2) delete from public.bom_fg_moves where kind in ('unreceive', 'undeliver') (ยอดกลับเป็นก่อนย้อน · ใบที่ถูกเปิดกลับยังเป็น in_progress) แล้ว drop constraint bom_fg_moves_shape_check /
--      bom_fg_moves_kind_check สร้างกลับตาม 20261123010000 · drop index bom_fg_moves_reverses_idx · drop constraint bom_fg_moves_reverses_fkey · drop column reverses_id
--   3) ใบสั่งซื้อ: ช่อง receipts / closedRemainder เป็น jsonb ที่นิยามเดิมเมิน · บรรทัดที่รับหลายครั้งยังอ่านได้ (receivedKg = ยอดสะสม) แต่นิยามเดิมถือว่ารับครั้งเดียว
-- ============================================================================

-- 1. ใบสั่งซื้อ: ยอดรับสะสมและบรรทัดครบ (ใหม่ · กฎเดียวกับ poLineReceived / poLineDone ของ modules/rubberflow-rules.js) ------------------------------------
-- received = Σ receipts[].kg ถ้ามีรายการรับ ไม่เช่นนั้น receivedKg (ไม่มี = 0)
create or replace function private.rf_po_line_received(p_line jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when jsonb_typeof(p_line -> 'receipts') = 'array' and jsonb_array_length(p_line -> 'receipts') > 0
              then (select coalesce(sum((r.value ->> 'kg')::numeric), 0) from jsonb_array_elements(p_line -> 'receipts') r)
              else coalesce((p_line ->> 'receivedKg')::numeric, 0) end
$$;
revoke all on function private.rf_po_line_received(jsonb) from public, anon, authenticated;

-- ครบ (ไม่ค้างรับ) = ปิดยอดที่เหลือแล้ว · หรือบรรทัดรุ่นเก่า (รับครั้งเดียวก่อน 20261128020000: มี receivedKg แต่ไม่มี receipts) · หรือรับสะสมถึงยอดสั่ง
create or replace function private.rf_po_line_done(p_line jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_typeof(p_line -> 'closedRemainder') = 'object', false)
      or coalesce(jsonb_typeof(p_line -> 'receivedKg') = 'number' and jsonb_typeof(p_line -> 'receipts') is distinct from 'array', false)
      or coalesce(private.rf_po_line_received(p_line) >= (p_line ->> 'qtyKg')::numeric, false)
$$;
revoke all on function private.rf_po_line_done(jsonb) from public, anon, authenticated;

-- 2. ใบสั่งซื้อ: แยกวิเคราะห์บรรทัด เก็บคำขอปิดยอดที่เหลือ (นิยามจาก 20261111010000_bom_part_stock.sql) --------------------------------------------
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
  v_node jsonb;
  v_closed jsonb;
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
    -- ปิดยอดที่เหลือ (20261128020000): client ส่งได้เฉพาะ { reason } ของคำขอปิด (ไม่ส่ง / null = ไม่ขอ) · ช่องอื่นของ closedRemainder และ receipts เซิร์ฟเวอร์สร้างเอง จึงถูกตัดทิ้งที่นี่
    -- ความยาวขั้นต่ำของเหตุผล (3) ตรวจตอนปิดใน private.rf_save_purchase_orders (สำเนาของบรรทัดที่ปิดแล้วส่งกลับมาได้เสมอ)
    v_node := v_line -> 'closedRemainder';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_closed := null;
    elsif jsonb_typeof(v_node) <> 'object' then
      raise exception 'RF_INVALID_PURCHASE';
    else
      v_closed := jsonb_build_object('reason', private.bom_text(v_node, 'reason', 300, 0, 'RF_INVALID_PURCHASE'));
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
      'expiry', v_exp,
      'closedRemainder', v_closed));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.rf_po_parse_lines(jsonb) from public, anon, authenticated;

-- 3. ใบสั่งซื้อ: รับสะสมหลายครั้ง · ปิดยอดที่เหลือ · ยกเลิกเมื่อไม่มีการรับหรือปิด (นิยามจาก 20261122010000_bom_fg_guards.sql) -------------------------
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
  v_close_count integer;
  v_cidx integer;
  v_old_recv numeric;
  v_new_recv numeric;
  v_reason text;
  v_left numeric;
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
  v_stored numeric;
  v_bom_n integer := 0;
  v_part boolean := false;
  v_locked boolean := false;
  v_admin boolean := coalesce(private.employee_role_code(p_actor.id) = 'admin', false);
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
      v_close_count := 0;
      v_cidx := null;
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
          else
            -- รับสะสม (20261128020000): receivedKg ของ client มากกว่ายอดสะสมที่เก็บ = ขอรับเพิ่มหนึ่งครั้ง (ยอดครั้งนี้ = ส่วนต่าง เซิร์ฟเวอร์คำนวณข้างล่าง)
            -- เท่าเดิม = ไม่เปลี่ยน (บรรทัดที่รับแล้ว: ล็อต / วันหมดอายุของครั้งล่าสุดต้องเท่าที่เก็บด้วย) · น้อยกว่าหรือลบออก = แก้การรับที่บันทึกแล้ว (ไม่ยอม)
            v_old_recv := (v_sl ->> 'receivedKg')::numeric;
            v_new_recv := (v_nl ->> 'receivedKg')::numeric;
            if v_new_recv is not distinct from v_old_recv then
              if v_old_recv is not null and ((v_sl ->> 'lotNo') is distinct from (v_nl ->> 'lotNo')
                 or (v_sl ->> 'expiry')::numeric is distinct from (v_nl ->> 'expiry')::numeric) then
                v_other := true;
              end if;
            elsif v_new_recv is not null and v_new_recv > coalesce(v_old_recv, 0) then
              v_recv_count := v_recv_count + 1;
              v_idx := v_i;
            else
              v_other := true;
            end if;
            -- ปิดยอดที่เหลือ: บรรทัดที่เก็บยังไม่ปิดและ client ส่ง closedRemainder มา = ขอปิดหนึ่งบรรทัด · บรรทัดที่ปิดแล้วเป็นของเซิร์ฟเวอร์ (ค่าของ client เมิน)
            if jsonb_typeof(v_sl -> 'closedRemainder') is distinct from 'object' and jsonb_typeof(v_nl -> 'closedRemainder') = 'object' then
              v_close_count := v_close_count + 1;
              v_cidx := v_i;
            end if;
          end if;
        end loop;
      end if;
      -- ตรงกับที่เก็บทุกช่อง (สำเนาที่ client ได้จากเซิร์ฟเวอร์) = ไม่ทำอะไร
      if not (v_other or v_recv_count > 0 or v_close_count > 0 or v_status <> v_old.status) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      -- ยกเลิก: คลังวัตถุดิบ (ST) หรือ admin เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้าหรือปิดยอดที่เหลือ (20261128020000)
      if v_status = 'cancelled' and v_old.status <> 'cancelled' then
        if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'cancelPurchaseOrder' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other or v_recv_count > 0 or v_close_count > 0
           or exists (select 1 from jsonb_array_elements(v_old.lines) l
                      where jsonb_typeof(l -> 'receivedKg') <> 'null' or jsonb_typeof(l -> 'closedRemainder') = 'object') then
          raise exception 'RF_INVALID_TRANSITION';
        end if;
        update public.rf_purchase_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_old.id;
        continue;
      end if;

      -- ปิดยอดที่เหลือ (closePurchaseLine · 20261128020000): แผนก ST หรือ admin ปิดหนึ่งบรรทัดที่ยังไม่ครบ พร้อมเหตุผล 3-300 ตัวอักษร
      -- ไม่เปลี่ยนสต็อกหรือล็อต · บรรทัดเก็บ closedRemainder = { kg (ยอดที่ไม่รับแล้ว), reason, at, by } · ทุกบรรทัดครบหรือปิดแล้ว = ใบ received
      if v_close_count > 0 then
        if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'closePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
        if v_close_count <> 1 or v_recv_count <> 0 then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_sl := v_old.lines -> v_cidx;
        if private.rf_po_line_done(v_sl) then raise exception 'RF_INVALID_TRANSITION'; end if;
        v_reason := v_lines -> v_cidx -> 'closedRemainder' ->> 'reason';
        if char_length(coalesce(v_reason, '')) < 3 then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_left := greatest(0, (v_sl ->> 'qtyKg')::numeric - private.rf_po_line_received(v_sl));
        v_final := jsonb_set(v_old.lines, array[v_cidx::text], v_sl || jsonb_build_object('closedRemainder',
          jsonb_build_object('kg', v_left, 'reason', v_reason, 'at', v_ms, 'by', p_actor_name)));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
        continue;
      end if;

      -- ที่เหลือที่ยอมให้มีได้ทางเดียวคือรับเข้าหนึ่งบรรทัด (ST หรือ admin) ที่มาพร้อมล็อตใหม่ (เคมี) · รับซ้ำบรรทัดเดิมได้จนกว่าจะครบ (20261128020000)
      if v_recv_count = 0 then raise exception 'RF_INVALID_TRANSITION'; end if;
      if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'receivePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
      if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
      if v_recv_count <> 1 or v_receipt is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_sl := v_old.lines -> v_idx;
      v_nl := v_lines -> v_idx;
      -- บรรทัดที่ครบแล้ว (รับถึงยอดสั่ง / ปิดยอดที่เหลือ / บรรทัดรุ่นเก่าที่รับไปแล้ว) รับอีกไม่ได้
      if private.rf_po_line_done(v_sl) then raise exception 'RF_INVALID_TRANSITION'; end if;
      -- ยอดครั้งนี้ = สะสมใหม่ - สะสมที่เก็บ (> 0 ตามการตรวจข้างบน) · ไม่เชื่อส่วนต่างหรือรายการรับของ client
      v_new_recv := (v_nl ->> 'receivedKg')::numeric;
      v_kg := v_new_recv - coalesce((v_sl ->> 'receivedKg')::numeric, 0);
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
          'receivedKg', v_new_recv, 'lotNo', null::text, 'expiry', null::bigint, 'receivedAt', v_ms, 'receivedBy', p_actor_name,
          'receipts', (case when jsonb_typeof(v_sl -> 'receipts') = 'array' then v_sl -> 'receipts' else '[]'::jsonb end)
                      || jsonb_build_array(jsonb_build_object('kg', v_kg, 'lotNo', null::text, 'expiry', null::bigint, 'at', v_ms, 'by', p_actor_name))));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
      else
        v_exp := (v_nl ->> 'expiry')::numeric;
        if v_exp <= v_ms then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_new_recv, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'receivedAt', v_ms, 'receivedBy', p_actor_name,
          'receipts', (case when jsonb_typeof(v_sl -> 'receipts') = 'array' then v_sl -> 'receipts' else '[]'::jsonb end)
                      || jsonb_build_array(jsonb_build_object('kg', v_kg, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'at', v_ms, 'by', p_actor_name))));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
        v_receipt := jsonb_build_object('materialCode', v_sl ->> 'materialCode', 'lotNo', v_nl ->> 'lotNo', 'qtyKg', v_kg, 'expiry', v_exp);
      end if;
    else
      -- ใบใหม่: คลังวัตถุดิบ (ST) หรือ admin เท่านั้น ต้อง ordered ไม่มีข้อมูลรับเข้า วัตถุดิบทุกบรรทัดต้องมีอยู่และ active
      if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'createPurchaseOrder' or v_status <> 'ordered' then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_final := '[]'::jsonb;
      for v_nl in select value from jsonb_array_elements(v_lines) loop
        if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' or jsonb_typeof(v_nl -> 'closedRemainder') = 'object' then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_nl := v_nl - 'closedRemainder';
        if v_nl ->> 'source' = 'bom' then
          -- ของซื้อ: ต้องเป็นชิ้น PURCHASED ที่มีอยู่ (รหัสตามที่เก็บ หน่วยจาก bom_items) · สต็อกขั้นต่ำที่ต่างจาก bom_stock.safety_qty (ไม่มีแถว = 0) เซิร์ฟเวอร์ upsert ให้
          select * into v_item from public.bom_items i where i.is_test and i.code = private.bom_code(v_nl ->> 'materialCode') and i.kind = 'PURCHASED';
          if not found then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_safety := (v_nl ->> 'safetyKg')::numeric;
          -- storedSafetyKg = ค่าที่หน้าต่างสั่งซื้อแสดงตอนเปิด (rf_po_parse_lines ตัดช่องนี้ออก จึงอ่านจากบรรทัดดิบ): ค่าที่ส่งมาเท่ากับค่านี้
          -- แปลว่าผู้สั่งไม่ได้แก้ช่อง จึงไม่เขียนทับค่าที่ผู้อื่นเพิ่งตั้ง (บรรทัดของใบเก็บค่าที่ใช้อยู่จริง) · client รุ่นก่อนไม่ส่งช่องนี้ = เทียบกับที่เก็บเหมือนเดิม
          select private.bom_num(l.value -> 'storedSafetyKg', 'RF_INVALID_PURCHASE', 0, 1000000000) into v_stored
          from jsonb_array_elements(v_row -> 'lines') l where upper(l.value ->> 'materialCode') = upper(v_nl ->> 'materialCode') limit 1;
          if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
          select * into v_stock from public.bom_stock s where s.is_test and s.item_code = v_item.code for update;
          if found and v_stored is not null and v_safety = v_stored then
            v_safety := v_stock.safety_qty;
          elsif found then
            if v_stock.safety_qty <> v_safety then
              -- สต็อกขั้นต่ำเปลี่ยนได้โดยกลุ่มวางแผน (admin นับรวม) หรือแผนก ST ที่ส่ง storedSafetyKg มาด้วย (หน้าต่างรุ่นที่บอกค่าตอนเปิด)
              -- ST จาก client รุ่นก่อนที่ไม่ส่งช่องนี้ = RF_FORBIDDEN: แยกไม่ได้ว่าผู้สั่งแก้ช่องเอง หรือหน้าต่างค้างค่าเก่าแล้วจะเขียนทับค่าที่ผู้อื่นเพิ่งตั้ง
              if not (p_planner or (p_st and v_stored is not null)) then raise exception 'RF_FORBIDDEN'; end if;
              update public.bom_stock set safety_qty = v_safety, updated_at = now() where id = v_stock.id;
              v_bom_n := v_bom_n + 1;
            end if;
          elsif v_safety <> 0 then
            if not (p_planner or (p_st and v_stored is not null)) then raise exception 'RF_FORBIDDEN'; end if;
            insert into public.bom_stock (is_test, item_code, qty, safety_qty) values (true, v_item.code, 0, v_safety);
            v_bom_n := v_bom_n + 1;
          end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_item.code, 'uom', v_item.uom, 'safetyKg', v_safety, 'receivedAt', null::bigint, 'receivedBy', null::text));
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

-- 4. RubberFlow: action ใหม่ closePurchaseLine (นิยามจาก 20261128010000_bom_cancel_rf_stop.sql) ---------------------------------------------------
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
    'createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'issueRequisition', 'returnRequisition', 'closePurchaseLine']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

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
        when 'materials' then v_planner or v_rb or (v_st and p_action = 'createPurchaseOrder')
        when 'recipes' then v_planner or v_rb
        when 'orders' then v_planner or v_rb or (v_qa and p_action = 'addQcRecord')
        when 'molds' then v_planner or v_rb
        when 'materialLots' then v_planner or v_rb or v_st or v_qa
        when 'requisitions' then v_planner or v_rb or (v_st and p_action = 'returnRequisition')
        when 'lots' then v_planner or v_rb or v_qa
        when 'transfers' then v_planner or v_rb or v_sr
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
    perform private.rf_save_transfers(v_actor, v_planner or v_rb, v_planner or v_sr,
                                      coalesce(p_changes #> '{transfers,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_boxes(v_actor.id, v_planner or v_wh, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.rf_save_qc(v_actor, v_planner or v_qa, v_planner or v_rb, coalesce(p_changes #> '{qcRecords,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
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

revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;

-- 5. ตาราง: ย้อนรับเข้า / ย้อนส่งมอบ (unreceive / undeliver) ชี้แถวเดิมด้วย reverses_id --------------------------------------------------
alter table public.bom_fg_moves add column reverses_id uuid;
comment on column public.bom_fg_moves.reverses_id is 'แถว receive / deliver ที่แถวนี้ย้อน (เฉพาะชนิด unreceive / undeliver) · ย้อนได้ครั้งเดียวต่อแถว (ดัชนีเฉพาะ)';
-- foreign key คู่กับ is_test แบบเดียวกับ order_pk (แถวโหมดทดสอบชี้แถวจริงไม่ได้) · purge ลบทั้งตารางในคำสั่งเดียว foreign key ในตารางเดียวกันจึงไม่ขวาง
alter table public.bom_fg_moves add constraint bom_fg_moves_reverses_fkey
  foreign key (reverses_id, is_test) references public.bom_fg_moves(id, is_test);
create unique index bom_fg_moves_reverses_idx on public.bom_fg_moves (reverses_id) where reverses_id is not null;
alter table public.bom_fg_moves drop constraint bom_fg_moves_kind_check;
alter table public.bom_fg_moves add constraint bom_fg_moves_kind_check
  check (kind in ('receive', 'deliver', 'close', 'transfer', 'untransfer', 'unreceive', 'undeliver'));
alter table public.bom_fg_moves drop constraint bom_fg_moves_shape_check;
alter table public.bom_fg_moves add constraint bom_fg_moves_shape_check check (
  (kind = 'close' and fg_code = '' and qty = 0 and char_length(note) between 3 and 300 and from_order_pk is null and reverses_id is null)
  or (kind in ('receive', 'deliver') and char_length(fg_code) between 1 and 60 and qty > 0 and from_order_pk is null and reverses_id is null)
  or (kind in ('transfer', 'untransfer') and char_length(fg_code) between 1 and 60 and qty > 0
      and from_order_pk is not null and from_order_pk <> order_pk and reverses_id is null)
  or (kind in ('unreceive', 'undeliver') and char_length(fg_code) between 1 and 60 and qty > 0 and from_order_pk is null
      and reverses_id is not null and reverses_id <> id and char_length(btrim(note)) between 3 and 300));
comment on table public.bom_fg_moves is 'ประวัติรับของสำเร็จรูปเข้าคลัง (receive) ส่งมอบลูกค้า (deliver) ปิดใบ (close) หยิบ / คืนสต็อกสินค้าสำเร็จรูประหว่างใบ (transfer / untransfer) และย้อนรับเข้า / ย้อนส่งมอบ (unreceive / undeliver) · เขียนผ่าน app_bom_save_master เท่านั้น ไม่มีสิทธิ์เขียนจาก client';

-- 6. ยอดสุทธิของชนิดหนึ่ง (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql): หักแถวย้อนของชนิดนั้น ----------------------------------------
-- receive = Σ receive - Σ unreceive · deliver = Σ deliver - Σ undeliver ของ (ใบ, รหัสสินค้า) · ไม่มีประวัติ = 0
-- ผู้เรียกทุกตัว (have / free / สต็อก / เพดานรับและส่งมอบ / closeOrderShort / ด่านยอด PK ของ bom_save_jobs) จึงเห็นยอดหลังย้อนโดยไม่ต้องแก้
create or replace function private.bom_fg_total(p_order_pk uuid, p_code text, p_kind text)
returns numeric
language sql
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = p_kind then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test and m.order_pk = p_order_pk and m.fg_code = p_code
    and (m.kind = p_kind or m.kind = case p_kind when 'receive' then 'unreceive' when 'deliver' then 'undeliver' end)
$$;
revoke all on function private.bom_fg_total(uuid, text, text) from public, anon, authenticated;

-- 7. ยกเลิก / เปิดใบกลับ: ส่งมอบสุทธิ (นิยามจาก 20261123010000_bom_fg_stock.sql) ----------------------------------------------------------------
-- ยกเลิก / เปิดกลับเป็นร่าง: ใบที่ส่งมอบสุทธิ > 0 หรือให้สต็อกใบอื่นไปแล้ว (out สุทธิ > 0 รหัสใดก็ตาม) = BOM_INVALID_TRANSITION
create or replace function private.bom_fg_return_stock(p_order_pk uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- ส่งมอบสุทธิ (deliver - undeliver) > 0 ของรหัสใดก็ตาม (20261128020000: การส่งมอบที่ย้อนแล้วไม่นับ)
  if exists (
    select 1 from public.bom_fg_moves m
    where m.is_test and m.order_pk = p_order_pk and m.kind in ('deliver', 'undeliver')
    group by m.fg_code
    having sum(case when m.kind = 'deliver' then m.qty else -m.qty end) > 0) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  if exists (
    select 1 from public.bom_fg_moves m
    where m.is_test and m.from_order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.fg_code
    having sum(case when m.kind = 'transfer' then m.qty else -m.qty end) > 0) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
  select true, p_order_pk, t.from_order_pk, t.fg_code, 'untransfer', t.net, '', p_actor
  from (
    select m.from_order_pk, m.fg_code, sum(case when m.kind = 'transfer' then m.qty else -m.qty end) as net
    from public.bom_fg_moves m
    where m.is_test and m.order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.from_order_pk, m.fg_code) t
  join public.bom_orders s on s.id = t.from_order_pk
  where t.net > 0
  order by t.fg_code collate "C", s.released_at, s.pi_no collate "C";
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.bom_fg_return_stock(uuid, uuid) from public, anon, authenticated;

-- 8. ย้อนรับเข้าคลัง / ย้อนส่งมอบ (ใหม่ · action reverseFg) ------------------------------------------------------------------
-- คำขอแถวเดียว { orderId, kind: 'reverse', moveId, note } (ไม่มี lines) · คืน { moves: 1, closed: false, reopened }
-- ลำดับตรวจ: รูปแถวและเหตุผล 3-300 (BOM_INVALID_FG) -> สิทธิ์ admin หรือผู้จัดการแผนก WH (BOM_FORBIDDEN) -> ล็อกแถวใบ (ไม่พบใบ = BOM_INVALID_FG)
--   -> แถวเดิม: ไม่พบ / ของใบอื่น / ไม่ใช่ receive หรือ deliver = BOM_INVALID_FG -> ย้อนแล้ว = BOM_INVALID_TRANSITION -> สถานะใบ (ร่าง / ยกเลิก = BOM_INVALID_TRANSITION)
--   -> ยอด (ย้อนรับเข้าเท่านั้น: BOM_FG_EXCEEDS) · เขียนแถวย้อน qty = ของแถวเดิม · ใบที่ปิดแล้วซึ่งของไม่ครบหลังย้อนรับเข้า = เปิดกลับเป็น in_progress
create or replace function private.bom_fg_reverse(p_actor public.employees, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_pi text;
  v_id_text text;
  v_note text;
  v_ord public.bom_orders%rowtype;
  v_move public.bom_fg_moves%rowtype;
  v_ordered numeric;
  v_have numeric;
  v_out numeric;
  v_delivered numeric;
  v_reopen boolean := false;
begin
  -- รูปแถว (ก่อนสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_FG'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
  if private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_FG') <> 'reverse' then raise exception 'BOM_INVALID_FG'; end if;
  v_pi := upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_FG'));
  v_id_text := private.bom_text(v_row, 'moveId', 40, 1, 'BOM_INVALID_FG');
  if v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BOM_INVALID_FG'; end if;
  v_node := v_row -> 'lines';
  if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
    raise exception 'BOM_INVALID_FG';
  end if;
  -- เหตุผลบังคับ 3-300 ตัวอักษร (ตัดช่องว่างหัวท้าย) เก็บใน note ของแถวย้อน
  v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_FG');

  -- สิทธิ์: admin หรือผู้จัดการแผนก (department_manager) ของแผนก WH · พนักงาน WH และกลุ่มวางแผนแผนกอื่น = BOM_FORBIDDEN
  if not (coalesce(private.employee_role_code(p_actor.id) = 'admin', false)
          or (coalesce(private.bom_dept_of(p_actor) = 'WH', false) and coalesce(private.employee_role_code(p_actor.id) = 'department_manager', false))) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  -- ล็อกแถวใบ (เหมือน bom_fg_move): รับ / ส่งมอบ / ย้อนของใบเดียวกันต่อคิวกัน ยอดที่ตรวจจึงไม่ถูกแซง
  select * into v_ord from public.bom_orders o where o.is_test and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_FG'; end if;
  select * into v_move from public.bom_fg_moves m where m.is_test and m.id = v_id_text::uuid;
  if not found or v_move.order_pk <> v_ord.id or v_move.kind not in ('receive', 'deliver') then raise exception 'BOM_INVALID_FG'; end if;
  if exists (select 1 from public.bom_fg_moves m where m.is_test and m.reverses_id = v_move.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- ใบที่ยกเลิกแล้ว (ของที่รับเข้าเป็นสต็อกของรหัสนั้น) และใบร่างย้อนไม่ได้
  if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;

  if v_move.kind = 'receive' then
    v_ordered := coalesce((select sum((it ->> 'qty')::numeric) from jsonb_array_elements(v_ord.items) it where it ->> 'fgCode' = v_move.fg_code), 0);
    v_have := private.bom_fg_have(v_ord.id, v_move.fg_code) - v_move.qty;
    v_out := private.bom_fg_out(v_ord.id, v_move.fg_code);
    v_delivered := private.bom_fg_total(v_ord.id, v_move.fg_code, 'deliver');
    -- ส่งมอบไปแล้วมากกว่าที่จะเหลือ: ย้อนการส่งมอบก่อน
    if v_have - v_out < v_delivered then raise exception 'BOM_FG_EXCEEDS'; end if;
    -- ใบอื่นหยิบสต็อกของใบนี้ไปแล้ว และที่เหลือไม่พอจำนวนสั่ง: ส่วนเกินที่ถูกหยิบไปคือของที่จะย้อน (สต็อกติดลบ) ให้ใบที่หยิบคืนก่อน
    if v_out > 0 and v_have - v_out < v_ordered then raise exception 'BOM_FG_EXCEEDS'; end if;
  end if;

  insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by, reverses_id)
  values (true, v_ord.id, v_move.fg_code, case v_move.kind when 'receive' then 'unreceive' else 'undeliver' end, v_move.qty, v_note, p_actor.id, v_move.id);

  -- ใบที่ปิดแล้ว (รับครบ / ปิดใบ / ปิดรับไม่ครบ) ที่หลังย้อนรับเข้ามีสินค้าที่ของไม่ครบตามที่สั่ง: เปิดกลับเป็น in_progress (แถว close เดิมคงอยู่ในประวัติ)
  -- รับเข้าครั้งถัดไปที่ครบปิดเองตามกติกาเดิม (private.bom_fg_move) หรือคลังสินค้าปิดใบ / ปิดรับไม่ครบอีกครั้ง
  if v_move.kind = 'receive' and v_ord.status = 'completed' and exists (
       select 1 from jsonb_array_elements(v_ord.items) it
       where private.bom_fg_have(v_ord.id, it ->> 'fgCode') < (it ->> 'qty')::numeric) then
    update public.bom_orders set status = 'in_progress', completed_at = null, updated_at = now() where id = v_ord.id;
    v_reopen := true;
  end if;
  return jsonb_build_object('moves', 1, 'closed', false, 'reopened', v_reopen);
end;
$$;
revoke all on function private.bom_fg_reverse(public.employees, jsonb) from public, anon, authenticated;

-- 9. snapshot / delta: fgMoves มี reversesId (นิยามจาก 20261123010000_bom_fg_stock.sql เปลี่ยนเฉพาะชุด fgMoves) ---------------------------------------
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
      select jsonb_agg(
        jsonb_build_object(
          'id', m.id::text, 'orderId', o.pi_no, 'fgCode', m.fg_code, 'kind', m.kind, 'qty', m.qty, 'note', m.note,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''))
        -- transfer / untransfer เท่านั้นที่มีใบต้นทาง (constraint ของตาราง) · ชนิดอื่นคงรูปเดิม 8 ช่อง
        || case when m.from_order_pk is null then '{}'::jsonb else jsonb_build_object('fromOrderId', s.pi_no) end
        -- unreceive / undeliver เท่านั้นที่มีแถวเดิม (20261128020000): reversesId = id ของแถว receive / deliver ที่ถูกย้อน
        || case when m.reverses_id is null then '{}'::jsonb else jsonb_build_object('reversesId', m.reverses_id::text) end
        order by m.created_at, m.id)
      from public.bom_fg_moves m join public.bom_orders o on o.id = m.order_pk
      left join public.bom_orders s on s.id = m.from_order_pk
      where m.is_test and m.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- 10. รายการ action ของ BOM: เพิ่ม reverseFg (นิยามจาก 20261125010000_bom_close_rules.sql · bom_staff_actions ไม่เปลี่ยน) ----------------------------------
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
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- 11. RPC: reverseFg อยู่ในกลุ่มของสำเร็จรูป (นิยามจาก 20261126010000_bom_fg_child_and_close_reason.sql แก้เฉพาะรายการ action ของสำเร็จรูปและตัวเขียน) --------
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
  v_fg_orders_n integer;
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
      -- ของสำเร็จรูป: ส่วน fgMoves ส่งได้เฉพาะ receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg และห้าการกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น)
      if v_n > 0 and ((v_key = 'fgMoves' and not (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg')))
                      or (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') and v_key <> 'fgMoves')) then
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

  -- ของสำเร็จรูป: receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg ต้องมีคำขอในส่วน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG
  -- ไม่ใช่สำเร็จแบบไม่ทำอะไร) ตามสัญญา "คำขอเดียวต่อคำสั่ง" · ตรวจหลังรูป payload ก่อนล็อกตัวนับ (BOM_RESET / ฐานเวอร์ชันมาทีหลัง)
  if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') and coalesce(jsonb_array_length(p_changes #> '{fgMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_FG';
  end if;

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
    -- สต็อกสินค้าสำเร็จรูป: แถว transfer (ปล่อยผลิต) / untransfer (ยกเลิก / เปิดกลับ) ที่ตัวเขียนใบเขียนเอง นับเป็น fgMoves (ส่วน fgMoves ไม่มากับ action ของใบ)
    v_fg_orders_n := coalesce((v_res ->> 'fgMoves')::integer, 0);
    if v_fg_orders_n > 0 then v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', v_fg_orders_n)); end if;
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
    -- ของสำเร็จรูป (receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (ประวัติ และใบที่ปิดเอง / เปิดกลับ)
    -- audit นับเป็น fgMoves ตามจำนวนแถวประวัติที่เขียน และ orders +1 เมื่อใบถูกปิด หรือถูกเปิดกลับเพราะย้อนรับเข้า (reverseFg ใช้ตัวเขียน private.bom_fg_reverse · 20261128020000)
    if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') then
      if p_action = 'reverseFg' then
        v_fg := private.bom_fg_reverse(v_actor, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      else
        v_fg := private.bom_fg_move(v_actor, p_action, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      end if;
      v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', (v_fg ->> 'moves')::integer));
      if (v_fg ->> 'closed')::boolean or coalesce((v_fg ->> 'reopened')::boolean, false) then
        v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', 1));
      end if;
    end if;
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตในคำสั่งนี้: ยังไม่ completed ต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้) · completed (bom_save_orders ปิดให้เพราะได้ครบทุกสินค้าจากสต็อก
    -- สินค้าสำเร็จรูป) ต้องไม่มีงาน เพราะงานของใบที่ปิดแล้วทำต่อไม่ได้ (bom_save_jobs แก้งานได้เฉพาะใบ released / in_progress) · ข้อหลังเพิ่มใน 20261124010000
    -- ตรวจจากสถานะสุดท้ายหลังเขียนใบ ลบงาน และเขียนงานของคำสั่งนี้ครบแล้ว และก่อนเปิด WO ใน RubberFlow ให้งาน RB ของใบเหล่านี้ (ผิด = ทั้งคำสั่งไม่เขียนอะไร)
    if exists (select 1 from unnest(v_released) r(id) join public.bom_orders o on o.id = r.id
               where (o.status <> 'completed' and not exists (select 1 from public.bom_jobs j where j.order_pk = r.id))
                  or (o.status = 'completed' and exists (select 1 from public.bom_jobs j where j.order_pk = r.id))) then
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
      -- ชนิดพ่อ/ลูก (rules.childKindError) · ลูกเป็น FG = BOM_INVALID_CHILD_KIND (20261126010000)
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
             or (c.kind = 'CP' and p.kind <> 'RB')
             or c.kind = 'FG')
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
