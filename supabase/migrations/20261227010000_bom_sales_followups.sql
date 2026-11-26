-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: งานตามหลังของใบสั่งผลิตจากฝ่ายขาย (โรงงาน ขั้น 9 · ต่อจาก 20261226010000_bom_sales_orders.sql)
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-26):
--   1) ไม่เปลี่ยน: ระหว่างฝ่ายขายยกเลิกกลางทางรอฝ่ายวางแผนตัดสิน RB / เคมีของ ST / รายงานผลรายแผนก / การส่งงาน / WH รับเข้า ยังทำได้
--      · SR จ่ายยางเส้นยาว (issueRods) ST เบิกของซื้อ (issueOrderParts) GR ขอเบิกยางเส้นยาว (requestRods) ยังถูกปฏิเสธ · deliverFg ถูกปฏิเสธตั้งแต่ฝ่ายขายยกเลิก
--      (ล็อกด้วย pgTAP bom_sales_followups.test.sql)
--   2) ฝ่ายวางแผนเลือก "หยุด" แล้ว RB ยังบันทึกล็อตตกแต่งของ WO ที่การหยุดนั้นยกเลิกได้ · ยางเส้นยาวเข้าสต็อกกลางของ SR ไม่นับให้ใบ / งานที่ยกเลิก
--   3) ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ (addJobsForChanges) ใช้สต็อกได้แบบเดียวกับปล่อยผลิต: สต็อกสินค้าสำเร็จรูป WH ต่อรหัสสินค้า
--      และสต็อกกลางยางเส้นยาว SR ต่อรหัส RB · ส่วนที่เหลือเปิดงาน
--   4) นับเฉพาะที่ฝ่ายขายเปลี่ยนจริง: ใบจำจำนวนสินค้าที่เปิดงานไว้แล้ว (planned_items) · งานเดิมที่เพิ่มยอดแผนได้ "ต้องการ" เพิ่มตาม (ไม่แสดง "8 ชุด ต้องการ 6" อีก)
--   5) ต้องแก้: ฝ่ายขายอ่าน WO ของ RubberFlow ไม่ได้ client จึงคิดว่าใบที่มี WO ทุกใบเริ่มงานแล้ว · เซิร์ฟเวอร์ส่ง started / locked ต่อใบ
--   6) ต้องแก้: ใบที่ปิด (completed) การแจ้ง "ฝ่ายขายแก้ใบ" ที่ยังเปิดปิดเองแบบเดียวกับตอนยกเลิกใบ
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) private.bom_actor() และ private.rf_actor()
--
-- ข้อมูล
--   - bom_orders + planned_items jsonb (null หรือ object รหัสสินค้า → จำนวน · constraint bom_orders_planned_items_check)
--     = จำนวนสินค้าที่เปิดงานไว้แล้ว: ตั้งตอนปล่อยผลิต (รายการของใบ ณ ตอนนั้น รวมใบที่ได้ครบจากสต็อก) · addJobsForChanges ตั้งเป็นรายการปัจจุบัน
--     · เปิดกลับเป็นร่าง = null · ยกเลิก / ปิดใบ / ฝ่ายขายแก้ใบตรง = คงเดิม · ใบใหม่ = null
--     backfill (ข้อมูลทดสอบเท่านั้น · BOM ยังเป็นโหมดทดสอบ): ใบ released / in_progress / completed ทุกใบ = ต่อสินค้าของรายการปัจจุบัน
--       ผลรวม required ของบรรทัดผลระเบิด level 0 ที่ itemCode = รหัสสินค้า (ผลระเบิดเป็นของจำนวนที่เปิดงานไว้: ตอนปล่อย หรือตอนเปิดงานเพิ่มครั้งล่าสุด
--       ตรงกับ stored() ของ extraJobsFor ใน modules/bom-actions.js) · ไม่มีบรรทัดนั้น = จำนวนสั่งปัจจุบัน
--   - การแจ้ง kind change ที่ยังเปิดของใบ completed (ข้อมูลทดสอบ) ปิดใน migration นี้: done / ack / decided_by null (ระบบ)
--   - ไม่มีตารางใหม่ (grant / RLS / sandbox guard ไม่เปลี่ยน)
--
-- กติกา
--   ข้อ 2 · private.rf_wo_sales_stopped(public.rf_orders) (ใหม่): WO cancelled ที่ผูกงาน BOM (source_job_no = งาน และงานยังชี้ WO นี้ external_ref.woId)
--     ของใบที่ cancelled ด้วยทางเลือก stop (sales_cancel_choice) และ WO ถูกยกเลิกพร้อมใบ (rf_orders.cancelled_at = bom_orders.cancelled_at:
--     private.bom_cancel_rf_job ตั้ง now() ในธุรกรรมเดียวกับที่ private.bom_save_orders ยกเลิกใบ) · WO ที่ยกเลิกทางอื่น / ก่อนหน้า / ใบที่ยกเลิกทางอื่น = false
--     private.rf_save_lots: ล็อตตกแต่ง (finishing) ของ WO เช่นนี้บันทึกได้ (สถานีอื่น / WO cancelled อื่นยัง RF_INVALID_TRANSITION ตามเดิม)
--       ผล pass ไปได้ปลายทาง sr เท่านั้น (ไม่ส่ง = sr ตามเดิม · customer = RF_INVALID_LOT) · hold / fail บันทึกได้ (QA ปล่อยภายหลังผ่าน rf_save_qc ไปที่ sr)
--     private.rf_add_produced: WO เช่นนี้นับยอดผลิตเพิ่ม (สถานะคง cancelled ไม่ปิด) · WO cancelled อื่นยัง RF_INVALID_ORDER
--     ทางยางเส้นยาวเดิมทั้งหมด (ไม่แก้): private.bom_rod_lot_create สร้างล็อตรอรับ (bom_rod_lots pending ของใบ / งาน / WO) → SR รับเข้า (receiveRods)
--       → private.bom_rod_credit: ใบไม่ใช่ released / in_progress = แถว receive owner_order_pk null ทั้งล็อต (สต็อกกลาง) งานไม่ถูกแตะ
--       = รูปเดียวกับที่ "หยุด" ใช้กับล็อตที่ RB ส่งแล้วรอรับ · audit เดิม (RF_SAVE + BOM_MASTER_SAVE 'rubberflow:recordFinishing' / 'rubberflow:addQcRecord')
--   ข้อ 3 + 4 · private.bom_add_change_jobs (addJobsForChanges) ลำดับตรวจ: ผู้เรียก (BOM_FORBIDDEN) → รูปคำสั่ง (BOM_INVALID_PAYLOAD) → ใบ (BOM_INVALID_ORDER / BOM_STALE)
--       → ไม่มีงานและ stockCounts เท่าเดิม = BOM_INVALID_PAYLOAD → สถานะ / ฝ่ายขายยกเลิกไว้ (BOM_INVALID_TRANSITION)
--       → ไม่มีสินค้าใดที่จำนวนสั่งปัจจุบัน > planned_items = BOM_INVALID_TRANSITION (ข้อ 4) → ช่องอื่นของใบ (BOM_INVALID_ORDER) → stockCounts → งาน → หยิบสต็อก
--     แถวใบ: ทุกช่องเท่าเดิมยกเว้น explosion (ผลระเบิดใหม่) และ stockCounts (เพิ่มได้อย่างเดียว · ทุกคีย์ที่ต่าง: ค่าใหม่ > ค่าเดิม ไม่มีคีย์ = 0 · ลด / ลบคีย์ = BOM_INVALID_ORDER)
--       คีย์รหัสสินค้าของใบ: ค่าใหม่ ≤ จำนวนสั่ง และส่วนที่เพิ่ม ≤ max(0, จำนวนสั่ง − planned_items) (ไม่งั้น BOM_INVALID_ORDER) · หยิบส่วนที่เพิ่มจากสต็อกสินค้าสำเร็จรูป
--         เหมือนปล่อยผลิต (private.bom_fg_stock ไม่พอ = BOM_FG_EXCEEDS · แถว transfer ต่อใบต้นทาง ใบที่ปล่อยก่อนก่อน)
--       คีย์รหัส RB ของบรรทัดผลระเบิดใหม่ (kind RB): หยิบส่วนที่เพิ่มจากสต็อกกลาง SR ด้วย private.bom_rod_take เดิม (ไม่พอ = BOM_ROD_EXCEEDS)
--       คีย์อื่น = BOM_INVALID_ORDER · stock_counted_at / by = ผู้เรียกเมื่อ stockCounts เปลี่ยน
--     งาน: ส่งไม่ได้เลยก็ได้ (ใช้สต็อกได้ครบ) · งานใหม่เหมือนเดิม · งานเดิม: qtyRequired ต้องไม่ต่ำกว่าเดิม (BOM_INVALID_JOB)
--       = ค่าเดิม → เซิร์ฟเวอร์เพิ่ม qty_required เท่ายอดแผนที่เพิ่ม · มากกว่าเดิม = เก็บค่าที่ส่ง (ความต้องการจริงจากผลระเบิดใหม่ แบบปล่อยผลิต)
--       · stockCounted ของงานเดิมที่เพิ่มยอดเปลี่ยนตามที่ส่งได้ (ยอดที่ใช้จากสต็อก) · ช่องอื่นเหมือนเดิม
--     ท้ายคำสั่ง: planned_items = รายการปัจจุบัน · คืน + fgMoves / rodMoves (จำนวนแถว) · app_bom_save_master นับเป็น fgMoves / rodMoves ของบันทึกการใช้งาน
--     app_bom_save_master: addJobsForChanges ต้องมีแถวใบหนึ่งแถว (ส่วน jobs ไม่บังคับแล้ว)
--   ข้อ 5 · private.bom_records ใบทุกใบ + started (private.bom_started_jobs) / locked (private.bom_order_locked = กติกาเปิดกลับเป็นร่าง / ยกเลิกทันทีไม่ได้)
--       เฉพาะใบ released / in_progress (สถานะอื่น = false ทั้งคู่) + plannedItems (เฉพาะเมื่อไม่เป็น null)
--     ข้อจำกัด: ค่าคำนวณตอนส่งแถวใบ · ใน delta แถวใบถูกส่งใหม่เมื่อแถวใบเปลี่ยน (เช่นงานแรกเริ่ม released → in_progress)
--       แต่ WO เริ่มผลิตใน RubberFlow / SR จ่ายยางเส้นยาว ไม่แตะแถวใบ ค่าใน client จึงอาจค้างจนโหลดชุดใหม่ (เซิร์ฟเวอร์ยังตรวจกติกาเองทุกครั้ง)
--   ข้อ 6 · app_bom_save_master ท้ายตัวเขียนทั้งหมด (ทุกทางที่ใบเป็น completed อยู่ในฟังก์ชันนี้: ปล่อยผลิตได้ครบจากสต็อก private.bom_save_orders,
--       รับเข้าครบ / closeOrder / closeOrderShort ของ private.bom_fg_move): การแจ้ง kind change ที่ยังเปิดของใบ completed = done / ack / ผู้ตัดสิน = ระบบ (decided_by null เหมือน backfill: ผู้ที่ปิดใบไม่ได้รับทราบการแจ้ง)
--       ยกเว้นการแจ้งที่เขียนในคำสั่งนี้ · นับเป็น orderRequests ของบันทึกการใช้งาน
--     การแจ้งยกเลิกกลางทางที่ยังรอตัดสินของใบที่ปิดแล้วไม่ถูกปิดเอง: ฝ่ายวางแผนยังต้องเลือก "ผลิตต่อ" (decideOrderRequest รับใบ completed อยู่แล้ว)
--       ถ้าปิดเป็น ack ทางเลือกของใบเป็น null ตลอด ของในคลังถูกนับเป็นของลูกค้าที่ยกเลิก (private.bom_fg_free) และส่งมอบไม่ได้
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main dd5e759 · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ที่ production)
--   - private.rf_add_produced(text, numeric, boolean, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint)  จาก 20261207010000_wh_rb_boxes.sql
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint)  จาก 20261226010000_bom_sales_orders.sql
--   - private.bom_add_change_jobs(public.employees, text, boolean, jsonb, jsonb, bigint, bigint)  จาก 20261226010000_bom_sales_orders.sql
--   - private.bom_records(bigint)  จาก 20261226010000_bom_sales_orders.sql
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261226010000_bom_sales_orders.sql
--   ใหม่ (search_path = '' · revoke all from public, anon, authenticated): private.bom_items_qty(jsonb), private.rf_wo_sales_stopped(public.rf_orders)
--   ไม่แตะ: private.rf_save_qc · private.bom_rod_lot_create · private.bom_rod_credit · private.bom_rod_take · private.bom_fg_move · private.bom_delta
--     · private.bom_save_order_request · private.bom_order_locked · private.bom_real_open() · private.bom_actor() · private.rf_actor()
--
-- ลำดับ deploy (AGENTS.md "Deployment order"): ไฟล์นี้ต้อง apply ที่ production (ด้วยการอนุมัติของผู้ใช้สำหรับไฟล์นี้) ก่อน merge Pilot ที่ใช้ช่อง / กติกาใหม่
--   Pilot เก่า + ฐานข้อมูลใหม่ (ใช้ได้): ช่องใหม่ของใบถูกเมิน · addJobsForChanges เดิม (stockCounts เท่าเดิม qtyRequired เดิม) ผ่าน และ "ต้องการ" ของงานเดิมเพิ่มตามยอดแผน
--     · ใบที่ไม่มีสินค้าเพิ่มจาก planned_items = BOM_INVALID_TRANSITION (Pilot เก่าไม่แสดงปุ่มอยู่แล้วเพราะเทียบกับผลระเบิดแบบเดียวกัน)
--     · RB ของ Pilot เก่าอาจไม่แสดง WO ที่ยกเลิกให้บันทึก (ฐานข้อมูลรับแล้ว) · การแจ้งแก้ใบของใบที่ปิดแสดงเป็นรับทราบแล้ว
--   Pilot ใหม่ + ฐานข้อมูลเก่า (ไม่รองรับ): stockCounts ที่เพิ่ม = BOM_INVALID_ORDER · ไม่มีงาน = BOM_INVALID_PAYLOAD · ไม่มี started / locked / plannedItems
--     · ล็อตตกแต่งของ WO ที่ยกเลิก = RF_INVALID_TRANSITION · จึงห้าม merge ก่อน apply (หรือ client ต้อง fallback เมื่อไม่มีช่อง)
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace หกฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่)
--      ล็อตตกแต่ง / แถว transfer ที่เขียนระหว่างนั้นคงอยู่ (ประวัติจริงของโหมดทดสอบ) · การแจ้งที่ปิดเองคง done
--   2) drop function private.rf_wo_sales_stopped(public.rf_orders), private.bom_items_qty(jsonb)  (หลังข้อ 1 เท่านั้น)
--   3) alter table public.bom_orders drop constraint bom_orders_planned_items_check, drop column planned_items
-- ============================================================================

-- 1. ใบสั่งผลิต: จำนวนสินค้าที่เปิดงานไว้แล้ว -------------------------------------------------------------------------------------
alter table public.bom_orders add column planned_items jsonb;
alter table public.bom_orders add constraint bom_orders_planned_items_check check (planned_items is null or jsonb_typeof(planned_items) = 'object');
comment on column public.bom_orders.planned_items is 'จำนวนสินค้าที่เปิดงานไว้แล้ว (รหัสสินค้า → จำนวน · 20261227010000): ตั้งตอนปล่อยผลิตและตอนฝ่ายวางแผนเปิดงานเพิ่ม (addJobsForChanges) · เปิดกลับเป็นร่าง = null · เปิดงานเพิ่มได้เฉพาะเมื่อมีสินค้าที่จำนวนสั่งมากกว่านี้';

-- รายการสินค้าของใบ → object รหัสสินค้า → ผลรวมจำนวน (รายการว่าง = {})
create or replace function private.bom_items_qty(p_items jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.code, s.qty), '{}'::jsonb)
  from (select it.item ->> 'fgCode' as code, sum((it.item ->> 'qty')::numeric) as qty
        from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) as it(item)
        where jsonb_typeof(it.item) = 'object' and jsonb_typeof(it.item -> 'fgCode') = 'string' and jsonb_typeof(it.item -> 'qty') = 'number'
        group by it.item ->> 'fgCode') as s
$$;
revoke all on function private.bom_items_qty(jsonb) from public, anon, authenticated;

-- backfill (ข้อมูลทดสอบ): ต่อสินค้าของรายการปัจจุบัน = ผลรวม required ของบรรทัดผลระเบิด level 0 ที่ itemCode = รหัสสินค้า · ไม่มี = จำนวนสั่งปัจจุบัน
update public.bom_orders o
set planned_items = (
  select coalesce(jsonb_object_agg(it.item ->> 'fgCode', coalesce(
           (select sum((e.line ->> 'required')::numeric)
            from jsonb_array_elements(case when jsonb_typeof(o.explosion) = 'array' then o.explosion else '[]'::jsonb end) as e(line)
            where jsonb_typeof(e.line) = 'object' and e.line ->> 'itemCode' = it.item ->> 'fgCode'
              and (e.line ->> 'level') = '0' and jsonb_typeof(e.line -> 'required') = 'number'),
           (it.item ->> 'qty')::numeric)), '{}'::jsonb)
  from jsonb_array_elements(o.items) as it(item))
where o.status in ('released', 'in_progress', 'completed');

-- 2. WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (ฝ่ายขายยกเลิกกลางทาง) -------------------------------------------------------------------
create or replace function private.rf_wo_sales_stopped(p_wo public.rf_orders)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_wo.status = 'cancelled' and p_wo.source_job_no is not null and p_wo.cancelled_at is not null and exists (
    select 1
    from public.bom_jobs j
    join public.bom_orders o on o.id = j.order_pk
    where j.is_test = (select private.bom_test_mode()) and j.job_no = p_wo.source_job_no
      and (j.external_ref ->> 'woId') = p_wo.wo_no
      and o.status = 'cancelled' and o.sales_cancel_choice = 'stop' and o.cancelled_at = p_wo.cancelled_at), false)
$$;
revoke all on function private.rf_wo_sales_stopped(public.rf_orders) from public, anon, authenticated;
comment on function private.rf_wo_sales_stopped(public.rf_orders) is 'WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (20261227010000): RB ยังบันทึกล็อตตกแต่งได้ ยางเส้นยาวเข้าสต็อกกลางของ SR (private.bom_rod_credit)';

-- 3. RubberFlow: ยอดผลิตของ WO ----------------------------------------------------------------------------------------------------
-- private.rf_add_produced(text, numeric, boolean, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql (+ WO ที่ยกเลิกพร้อมใบที่เลือกหยุด นับยอดได้ สถานะคงเดิม)
create or replace function private.rf_add_produced(p_order text, p_qty numeric, p_may_close boolean, p_base bigint, p_cur bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ord public.rf_orders%rowtype;
  v_total numeric;
  v_close boolean;
begin
  select * into v_ord from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = p_order for update;
  if not found or not (p_qty > 0) then return; end if;
  -- 20261227010000: WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (private.rf_wo_sales_stopped) นับยอดผลิตได้ · สถานะคง cancelled (ปิดเฉพาะ in_progress ข้างล่าง)
  if v_ord.status in ('planned', 'released') or (v_ord.status = 'cancelled' and not private.rf_wo_sales_stopped(v_ord)) then
    perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_ORDER');
  end if;
  v_total := trim_scale(round(v_ord.produced_qty + p_qty, 3));
  v_close := p_may_close and v_total >= v_ord.target_qty and v_ord.status = 'in_progress';
  update public.rf_orders set
    produced_qty = v_total,
    status = case when v_close then 'completed' else status end,
    completed_at = case when v_close then now() else completed_at end,
    updated_at = now()
  where id = v_ord.id;
end;
$$;

-- 4. RubberFlow: ล็อตของสถานี ------------------------------------------------------------------------------------------------------
-- private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261207010000_wh_rb_boxes.sql
--   (+ ล็อตตกแต่งของ WO ที่ยกเลิกพร้อมใบที่เลือกหยุด: บันทึกได้ ผล pass ไปที่ SR เท่านั้น)
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
        -- ปลายทางของล็อตตกแต่ง (20261207010000): ผลผ่านไปคลังยางเส้นยาว SR (sr · เฉพาะ WO ที่ผูกงาน BOM) หรือส่งมอบให้ลูกค้าผ่านคลังสินค้าสำเร็จรูป WH (customer)
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
    -- 20261227010000: ล็อตตกแต่งของ WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (private.rf_wo_sales_stopped) บันทึกได้ · ผล pass ไปที่ SR เท่านั้น
    --   (ยางเส้นยาวรอรับ → SR รับเข้าเป็นสต็อกกลาง private.bom_rod_credit) · WO cancelled อื่นและสถานีอื่น = RF_INVALID_TRANSITION ตามเดิม
    if v_ord.status not in ('released', 'in_progress', 'on_hold')
       and not (v_stage = 'finishing' and v_ord.status = 'completed' and v_ord.changed_version > p_cur)
       and not (v_stage = 'finishing' and private.rf_wo_sales_stopped(v_ord)) then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
    end if;
    if v_ord.status = 'cancelled' and v_dest is not null and v_dest <> 'sr' then raise exception 'RF_INVALID_LOT'; end if;

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
        -- 20261207010000: กล่องที่ผ่านรอ WH รับเข้า (pending_wh) แทนพร้อมส่งทันที · เก็บลูกค้าและเลข PO / PI ของ WO ไว้กับกล่อง (ส่งมอบให้ลูกค้ารายนั้น)
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
          -- 20261207010000: ปลายทาง customer ของ WO ที่ผูกงานไม่สร้างล็อตยางเส้นยาว งาน RB นับยอดเมื่อ WH รับกล่องของล็อตเข้าคลัง (private.rf_box_credit)
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

-- 5. ตัวเขียนใบสั่งผลิต ---------------------------------------------------------------------------------------------------------------
-- private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261226010000_bom_sales_orders.sql
--   (+ planned_items: ปล่อยผลิต = รายการของใบ · เปิดกลับเป็นร่าง = null)
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
  v_release boolean;
  v_new_status text;
  v_full boolean;
  v_code text;
  v_qty numeric;
  v_take numeric;
  v_part numeric;
  v_src record;
  v_moves integer := 0;
  v_rod_moves integer := 0;
  -- ฝ่ายขาย (20261226010000): ผู้เรียกที่ไม่ใช่กลุ่มวางแผนของใบสั่งผลิตแต่อยู่แผนก SA · ขอส่งใบให้ฝ่ายวางแผน · ใบที่ยกเลิกในคำสั่งนี้ (ฝ่ายวางแผนเลือกหยุด)
  v_seller boolean := not p_planner and private.bom_can_sell(p_actor);
  v_send boolean;
  v_send_changed boolean;
  v_source text;
  v_cancelled_orders uuid[] := '{}';
  -- รอบ 2: ฝ่ายขายแก้ใบที่เริ่มงานแล้ว (v_inplace) · ฝ่ายขายยกเลิกกลางทาง (v_sc_req + เหตุผล) · การแจ้งที่เขียนในคำสั่งนี้
  v_inplace boolean;
  v_sc_reason text;
  v_sc_req boolean;
  v_nid uuid;
  v_notices uuid[] := '{}';
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
    -- ส่งใบให้ฝ่ายวางแผน (20261226010000): sentAt ไม่มี / null = ไม่ขอส่ง · ตัวเลข = ขอส่ง (เวลาและผู้ส่งเซิร์ฟเวอร์ตั้งเอง ส่งแล้วไม่เปลี่ยน)
    -- source ของแถวที่ client ส่งมาถูกเมินเสมอ (เซิร์ฟเวอร์ตั้งตอนเปิดใบ)
    v_node := v_row -> 'sentAt';
    v_send := v_node is not null and jsonb_typeof(v_node) <> 'null';
    if v_send then perform private.bom_num(v_node, 'BOM_INVALID_ORDER', 1, 100000000000000); end if;
    -- ฝ่ายขายยกเลิกใบที่เริ่มงานแล้ว (รอบ 2): salesCancelReason ไม่ว่าง = ขอยกเลิกกลางทาง (เฉพาะใบที่ยังไม่เคยถูกยกเลิกแบบนี้ · หลังจากนั้นค่าของ client ถูกเมิน)
    -- เวลา / ผู้ / ทางเลือก (salesCancelAt / By / Choice) ของ client ถูกเมินเสมอ
    v_sc_reason := private.bom_text(v_row, 'salesCancelReason', 200, 0, 'BOM_INVALID_ORDER');

    select * into v_old from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = v_pi;
    if not found then
      if v_sc_reason <> '' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      -- ใบใหม่: กลุ่มวางแผนของใบสั่งผลิต (p_planner) หรือฝ่ายขาย เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      -- ที่มาของใบเซิร์ฟเวอร์ตั้งจากแผนกของผู้เปิด: แผนก SA = 'SA' · แผนกอื่น = 'PP' (20261226010000)
      -- ฝ่ายขายเปิดได้เฉพาะหัวใบและรายการสินค้า: ไม่มีกำหนดเสร็จรายแผนก ผลระเบิด ยอดที่ใช้จากสต็อก และชุดสีของบรรทัดตรงกับรหัสสินค้า (ไม่งั้น BOM_FORBIDDEN)
      -- ขอส่งให้ฝ่ายวางแผนพร้อมเปิดได้เฉพาะใบ 'SA' ที่มีสินค้า (ไม่งั้น BOM_INVALID_TRANSITION)
      if not (p_planner or v_seller) then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      v_source := case when coalesce(v_dept = 'SA', false) then 'SA' else 'PP' end;
      if v_seller and (v_due <> '{}'::jsonb or v_defaults <> '[]'::jsonb or v_expl is not null or v_counts <> '{}'::jsonb
                       or not private.bom_sa_items_ok('[]'::jsonb, v_items)) then
        raise exception 'BOM_FORBIDDEN';
      end if;
      if v_send and (v_source <> 'SA' or jsonb_array_length(v_items) = 0) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by, source, sent_at, sent_by)
      values (
        (select private.bom_test_mode()), v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
        case when v_expl is null then null else now() end, v_counts, v_note,
        case when v_counts = '{}'::jsonb then null else now() end,
        case when v_counts = '{}'::jsonb then null else p_actor.id end, p_actor.id,
        v_source, case when v_send then now() end, case when v_send then p_actor.id end);
      continue;
    end if;

    v_content := v_old.customer <> v_customer or v_old.country <> v_country or v_old.order_type <> v_type
      or v_old.ordered_at <> v_ordered::bigint or v_old.wh_due <> v_wh::bigint or v_old.due <> v_due
      or v_old.due_defaults <> v_defaults or v_old.items <> v_items or v_old.explosion is distinct from v_expl or v_old.note <> v_note;
    v_counts_changed := v_old.stock_counts <> v_counts;
    v_status_changed := v_old.status <> v_status;
    -- ขอส่งใบที่ยังไม่เคยส่ง (ส่งแล้ว = เมินค่าของ client)
    v_send_changed := v_send and v_old.sent_at is null;
    v_sc_req := v_old.sales_cancel_at is null and v_sc_reason <> '';
    -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน: เช่นใบที่ผู้อื่นเพิ่งเปลี่ยนเป็น in_progress แล้วสำเนานี้ก็เป็น in_progress)
    if not (v_content or v_counts_changed or v_status_changed or v_send_changed or v_sc_req) then continue; end if;

    -- ใบเปลี่ยนเป็น completed ผ่านแถวใบสั่งผลิตไม่ได้เลย (ทุกชื่อ action ทุกผู้เรียก รวมกลุ่มวางแผนและ admin): ปิดใบได้ทางเดียวคือรับของสำเร็จรูปเข้าคลังครบ
    -- (ปิดอัตโนมัติ) หรือ closeOrderShort โดยแผนก WH / admin ผ่าน private.bom_fg_move · ตรวจก่อนชน/สิทธิ์เพื่อให้ได้ BOM_FORBIDDEN เหมือนกันทุกกรณี
    -- (ใบที่มาจากสต็อกทั้งหมดเป็น completed ตอนปล่อยผลิต: เซิร์ฟเวอร์ตั้งเองข้างล่าง client ส่ง released)
    if v_status_changed and v_status = 'completed' then raise exception 'BOM_FORBIDDEN'; end if;

    -- released -> in_progress เกิดเองเมื่องานเริ่ม (ตั้งตอนบันทึกงาน) ยอมรับเมื่อมาพร้อมงานของใบนี้ ข้ามไม่เขียน (ตัวเขียนงานตรวจชนของงานเอง)
    if v_status_changed and v_old.status = 'released' and v_status = 'in_progress' and not v_content and not v_counts_changed and not v_send_changed and not v_sc_req then
      v_has_job := exists (select 1 from jsonb_array_elements(p_job_rows) j where upper(btrim(coalesce(j.value ->> 'orderId', ''))) = v_pi);
      if not v_has_job then raise exception 'BOM_INVALID_TRANSITION'; end if;
      continue;
    end if;

    -- ชนก่อนสิทธิ์เสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = ฝั่ง client ถือสำเนาเก่า
    -- (เทียบสิทธิ์/เนื้อหากับแถวล่าสุดไม่ได้ ไม่งั้นสำเนาเก่าถูกมองเป็นการแก้ที่ไม่มีสิทธิ์) ให้ตามทันแล้วทำใหม่
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

    -- สิทธิ์: กลุ่มวางแผนของใบสั่งผลิตแก้ได้ทุกอย่าง · ฝ่ายขายแก้ได้เฉพาะใบของฝ่ายขายตามกติกาข้างล่าง (20261226010000)
    -- · ST/WH แก้ได้เฉพาะ stockCounts ของใบ draft · คนอื่น (รวมผู้จัดการแผนกในสายผลิต) แก้ไม่ได้
    if v_seller then
      if v_old.source <> 'SA' then raise exception 'BOM_FORBIDDEN'; end if;
      -- ช่องของฝ่ายวางแผน: วันที่สั่งผลิต กำหนดเสร็จรายแผนก ผลระเบิด (ล้างเป็น null ได้ เพราะแก้สินค้าแล้วต้องคำนวณใหม่) และชุดสีของบรรทัดสินค้า
      if v_old.ordered_at <> v_ordered::bigint or v_old.due <> v_due or v_old.due_defaults <> v_defaults
         or (v_expl is not null and v_old.explosion is distinct from v_expl)
         or not private.bom_sa_items_ok(v_old.items, v_items) then
        raise exception 'BOM_FORBIDDEN';
      end if;
      -- ยอดที่ใช้จากสต็อก: ฝ่ายขายตั้งไม่ได้ · เปลี่ยนได้เฉพาะผลของการแก้สินค้า (คีย์ของสินค้าที่ลบออกจากใบหายไป · ยอดของสินค้าที่ลดจำนวนสั่งลดลงเท่าจำนวนสั่งใหม่)
      if v_counts_changed and exists (
           select 1
           from (select t.k from jsonb_object_keys(coalesce(v_old.stock_counts, '{}'::jsonb)) as t(k)
                 union
                 select t.k from jsonb_object_keys(v_counts) as t(k)) as c
           where (v_old.stock_counts -> c.k) is distinct from (v_counts -> c.k)
             and not coalesce(
               (v_old.stock_counts -> c.k) is not null
               and exists (select 1 from jsonb_array_elements(v_old.items) as it(item) where it.item ->> 'fgCode' = c.k)
               and (((v_counts -> c.k) is null
                     and not exists (select 1 from jsonb_array_elements(v_items) as it(item) where it.item ->> 'fgCode' = c.k))
                    or ((v_counts ->> c.k)::numeric < (v_old.stock_counts ->> c.k)::numeric
                        and (v_counts ->> c.k)::numeric = (select (it.item ->> 'qty')::numeric from jsonb_array_elements(v_items) as it(item)
                                                           where it.item ->> 'fgCode' = c.k limit 1))), false)) then
        raise exception 'BOM_FORBIDDEN';
      end if;
      -- สถานะ: ยกเลิกใบร่าง (เหตุผลตรวจข้างล่าง) · เปิดใบที่ปล่อยแล้วกลับเป็นร่าง / ยกเลิกใบที่ปล่อยแล้ว (ห้ามเมื่อเริ่มงาน ตรวจข้างล่าง) · ปล่อยผลิตไม่ได้
      if v_status_changed and not ((v_old.status = 'draft' and v_status = 'cancelled')
                                   or (v_old.status in ('released', 'in_progress') and v_status in ('draft', 'cancelled'))) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    elsif not p_planner then
      if v_content or v_status_changed or v_send_changed or v_sc_req or v_dept is null or v_dept not in ('ST', 'WH') then raise exception 'BOM_FORBIDDEN'; end if;
      -- ST / WH นับได้เฉพาะชิ้นที่อยู่ในผลระเบิดของใบ (20261202010000): ทุกคีย์ที่เพิ่ม / แก้ / ลบ ต้องเป็นรหัสของบรรทัดผลระเบิดที่ไม่ใช่ชนิด RB
      -- และไม่ใช่สินค้าของใบ · คีย์สินค้า (ใช้จากสต็อกสินค้าสำเร็จรูป) และคีย์รหัส RB (ใช้จากคลัง SR ตอนปล่อยผลิต) ตั้งได้เฉพาะกลุ่มวางแผน
      -- ใบที่ยังไม่มีผลระเบิด (ใบใหม่ หรือหลังแก้สินค้า) หรือรหัสที่ไม่อยู่ในผลระเบิด = BOM_FORBIDDEN (คำนวณใหม่แล้วคีย์คงอยู่ จึงห้ามตั้งไว้ก่อน)
      if v_counts_changed and exists (
           select 1
           from (select t.k from jsonb_object_keys(coalesce(v_old.stock_counts, '{}'::jsonb)) as t(k)
                 union
                 select t.k from jsonb_object_keys(v_counts) as t(k)) as c
           where (v_old.stock_counts -> c.k) is distinct from (v_counts -> c.k)
             and not exists (
               select 1 from jsonb_array_elements(coalesce(v_old.explosion, '[]'::jsonb)) as e(line)
               where e.line ->> 'itemCode' = c.k and (e.line ->> 'kind') is distinct from 'RB'
                 and not exists (select 1 from jsonb_array_elements(v_old.items) as it(item) where it.item ->> 'fgCode' = c.k))) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;

    -- ยกเลิกกลางทางเป็นของฝ่ายขายเท่านั้น (กลุ่มวางแผนยกเลิกใบตรง ๆ ได้อยู่แล้ว)
    if v_sc_req and not v_seller then raise exception 'BOM_FORBIDDEN'; end if;

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft หรือฝ่ายขายแก้ใบที่เริ่มงานแล้ว)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    v_inplace := v_content and v_old.status <> 'draft' and v_status <> 'draft';
    if v_inplace then
      -- ฝ่ายขายแก้ใบที่เริ่มงานแล้ว (รอบ 2): สถานะเท่าเดิม · ใบ released / in_progress ที่เปิดกลับไม่ได้ (private.bom_order_locked · ยังไม่เริ่ม = เปิดกลับเป็นร่างแทน)
      -- ผลระเบิดเท่าเดิม (งานรายแผนกไม่เปลี่ยน ไม่คำนวณใหม่) · ใบที่ฝ่ายขายยกเลิกไว้แก้ไม่ได้ · ผู้อื่น (รวมกลุ่มวางแผน) แก้ใบที่ไม่ใช่ร่างไม่ได้ตามเดิม
      if not v_seller or v_status_changed or v_sc_req or v_old.status not in ('released', 'in_progress') or v_old.sales_cancel_at is not null
         or v_old.explosion is distinct from v_expl or not private.bom_order_locked(v_old.id) then
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
      -- จำนวนสั่งของสินค้า (ลบ = 0) ต่ำกว่าที่ส่งมอบลูกค้าแล้ว (สุทธิ) ไม่ได้ · ต่ำกว่าที่ WH รับเข้าแล้วได้ (ส่วนเกินเป็นสต็อกสินค้าสำเร็จรูป)
      if exists (
           select 1 from jsonb_array_elements(v_old.items) as o(item)
           where private.bom_fg_total(v_old.id, o.item ->> 'fgCode', 'deliver')
                 > coalesce((select sum((n.item ->> 'qty')::numeric) from jsonb_array_elements(v_items) as n(item) where n.item ->> 'fgCode' = o.item ->> 'fgCode'), 0)) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
      insert into public.bom_order_requests (is_test, order_pk, kind, reason, requested_by)
      values ((select private.bom_test_mode()), v_old.id, 'change',
              private.bom_sa_change_summary(v_old, v_customer, v_country, v_type, v_wh::bigint, v_note, v_items), p_actor.id)
      returning id into v_nid;
      v_notices := v_notices || v_nid;
    end if;
    -- ฝ่ายขายยกเลิกใบที่เริ่มงานแล้ว (รอบ 2): แถวใบที่สถานะและเนื้อหาเท่าเดิม + เหตุผล 3-200 · ใบที่ยังไม่เริ่ม = ยกเลิกทันทีแทน (BOM_INVALID_TRANSITION)
    -- ใบหยุดรับงานใหม่ (app_bom_save_master) จนฝ่ายวางแผนเลือก · แจ้งฝ่ายวางแผน kind cancel
    if v_sc_req then
      if v_content or v_counts_changed or v_status_changed or v_send_changed or v_old.status not in ('released', 'in_progress') then
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
      if char_length(v_sc_reason) < 3 then raise exception 'BOM_INVALID_ORDER'; end if;
      if not private.bom_order_locked(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_order_requests (is_test, order_pk, kind, reason, requested_by)
      values ((select private.bom_test_mode()), v_old.id, 'cancel', v_sc_reason, p_actor.id)
      returning id into v_nid;
      v_notices := v_notices || v_nid;
    end if;
    -- ส่งให้ฝ่ายวางแผน: เฉพาะใบของฝ่ายขายที่เป็นร่างและมีสินค้า (20261226010000)
    if v_send_changed and (v_old.source <> 'SA' or v_old.status <> 'draft' or v_status <> 'draft' or jsonb_array_length(v_items) = 0) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;

    v_reopen := false;
    v_release := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- ใบของฝ่ายขายที่ยังไม่ส่งให้ฝ่ายวางแผนปล่อยผลิตไม่ได้ (20261226010000)
        if v_old.source = 'SA' and v_old.sent_at is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
        v_release := true;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        -- ยกเลิกต้องมีเหตุผล 3-200 ตัวอักษร (เก็บที่ cancel_reason) ทุกสถานะที่ยกเลิกได้ (20261128010000)
        if char_length(v_reason) < 3 then raise exception 'BOM_INVALID_ORDER'; end if;
        v_cancelled_orders := v_cancelled_orders || v_old.id;
        -- ฝ่ายขายยกเลิกร่างที่ส่งให้ฝ่ายวางแผนแล้ว: แจ้งฝ่ายวางแผน (ร่างที่ยังไม่เคยส่ง ฝ่ายวางแผนไม่เคยเห็น ไม่แจ้ง)
        if v_seller and v_old.sent_at is not null then
          insert into public.bom_order_requests (is_test, order_pk, kind, reason, requested_by)
          values ((select private.bom_test_mode()), v_old.id, 'cancel', v_reason, p_actor.id)
          returning id into v_nid;
          v_notices := v_notices || v_nid;
        end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if char_length(v_reason) < 3 then raise exception 'BOM_INVALID_ORDER'; end if;
        -- ฝ่ายขายยกเลิกทันทีได้เฉพาะใบที่ยังไม่เริ่มงาน (เริ่มแล้ว = ยกเลิกกลางทางด้วย salesCancelReason ให้ฝ่ายวางแผนเลือก) · ใบที่ฝ่ายขายยกเลิกไว้แล้วยกเลิกซ้ำไม่ได้
        if v_seller and (v_old.sales_cancel_at is not null or private.bom_order_locked(v_old.id)) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_cancelled_orders := v_cancelled_orders || v_old.id;
        -- งานที่มียอดแล้วไม่กันการยกเลิกอีก (20261128010000): งานทุกงานของใบคงอยู่พร้อมยอดและรายงาน (ไม่ลบ) และแก้ต่อไม่ได้เพราะใบไม่ใช่ released / in_progress
        -- สต็อกสินค้าสำเร็จรูป: ส่งมอบแล้ว / ให้ใบอื่นไปแล้ว = BOM_INVALID_TRANSITION · ไม่เช่นนั้นคืนที่หยิบมา (untransfer) · ที่ใบนี้รับเข้าเองอยู่ในคลังต่อเป็นสต็อก (bom_fg_free นับสั่ง = 0)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
        -- WO ที่ผูกงาน: planned / released ยกเลิก · in_progress / on_hold หยุด · completed คงเดิม (private.bom_cancel_rf_orders ไม่ปฏิเสธแล้ว)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
        if v_seller then
          insert into public.bom_order_requests (is_test, order_pk, kind, reason, requested_by)
          values ((select private.bom_test_mode()), v_old.id, 'cancel', v_reason, p_actor.id)
          returning id into v_nid;
          v_notices := v_notices || v_nid;
        end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- ใบที่ฝ่ายขายยกเลิกกลางทาง (รอตัดสิน / ผลิตต่อ) กลับเป็นร่างไม่ได้ (รอบ 2)
        if v_old.sales_cancel_at is not null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        -- คลังแท่งยาว SR (20261202010000): SR จ่ายแท่งให้ GR ตามใบนี้แล้ว (จ่ายสุทธิหลังย้อนจ่าย > 0) = งานเริ่มแล้ว เปิดกลับไม่ได้
        if coalesce((select sum(m.qty) from public.bom_rod_moves m
                     where m.is_test = (select private.bom_test_mode()) and m.kind in ('issue', 'unissue') and m.for_order_pk = v_old.id), 0) < 0 then
          raise exception 'BOM_INVALID_TRANSITION';
        end if;
        -- สต็อกสินค้าสำเร็จรูป: เหมือนยกเลิก (stockCounts คงอยู่ ปล่อยผลิตใหม่ก็หยิบใหม่)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
        -- คลังแท่งยาว SR (20261202010000): คืนแท่งที่ใบนี้หยิบจากสต็อกกลางตอนปล่อยผลิต (เท่าที่ยังอยู่ในถังของใบ) · ยกเลิกไม่ต้องคืน (ถังของใบที่ยกเลิกเป็นสต็อกกลาง)
        v_rod_moves := v_rod_moves + private.bom_rod_return(v_old.id, p_actor.id);
        -- งานที่ผูก WO ที่เลย released ถูกนับว่าเริ่มแล้วข้างบน ที่เหลือ (WO planned / released) ยกเลิกให้ก่อนลบงาน
        v_reopened := v_reopened || private.bom_cancel_rf_orders(v_old.id);
        perform private.bom_delete_order_jobs(v_old.id);
        v_reopen := true;
        v_revision := v_old.revision + 1;
      else
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
    end if;

    -- ปล่อยผลิต: หยิบสต็อกสินค้าสำเร็จรูปตาม stockCounts[รหัสสินค้า] = n > 0 · n เกินจำนวนสั่ง = BOM_INVALID_ORDER · สต็อกไม่พอ = BOM_FG_EXCEEDS
    -- (client ถือเป็นตัวเลขเก่า) · หยิบจากใบต้นทางที่ปล่อยผลิตก่อน (released_at แล้วเลข PI) หนึ่งแถว transfer ต่อใบต้นทาง
    -- ใบที่ปล่อยก่อนในคำสั่งเดียวกันหยิบก่อน (ลำดับแถว) · ทุกสินค้ามีครบจากสต็อก = ใบ completed ในคำสั่งนี้ (ไม่มีงานให้ทำ)
    v_new_status := v_status;
    if v_release then
      v_full := true;
      for v_el in select value from jsonb_array_elements(v_items) loop
        v_code := v_el ->> 'fgCode';
        v_qty := (v_el ->> 'qty')::numeric;
        v_take := coalesce((v_counts ->> v_code)::numeric, 0);
        if v_take > 0 then
          if v_take > v_qty then raise exception 'BOM_INVALID_ORDER'; end if;
          if private.bom_fg_stock(v_code) < v_take then raise exception 'BOM_FG_EXCEEDS'; end if;
          for v_src in
            select o.id, private.bom_fg_free(o.id, v_code) as avail
            from public.bom_orders o
            where o.is_test = (select private.bom_test_mode()) and o.id <> v_old.id and o.status in ('released', 'in_progress', 'completed', 'cancelled')
              and exists (select 1 from public.bom_fg_moves m where m.is_test = (select private.bom_test_mode()) and m.order_pk = o.id and m.fg_code = v_code)
            order by o.released_at, o.pi_no collate "C"
          loop
            exit when v_take <= 0;
            continue when v_src.avail <= 0;
            v_part := least(v_take, v_src.avail);
            insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
            values ((select private.bom_test_mode()), v_old.id, v_src.id, v_code, 'transfer', v_part, '', p_actor.id);
            v_take := v_take - v_part;
            v_moves := v_moves + 1;
          end loop;
          if v_take > 0 then raise exception 'BOM_FG_EXCEEDS'; end if;
        end if;
        if private.bom_fg_have(v_old.id, v_code) < v_qty then v_full := false; end if;
      end loop;
      if v_full then v_new_status := 'completed'; end if;
      -- คลังแท่งยาว SR (20261202010000): stockCounts[รหัส RB ของผลระเบิด] = n > 0 หยิบ n จากสต็อกกลาง ล็อตเก่าก่อน (ไม่พอ = BOM_ROD_EXCEEDS)
      v_rod_moves := v_rod_moves + private.bom_rod_take(v_old.id, v_counts, v_expl, p_actor.id);
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
      note = v_note, status = v_new_status, revision = v_revision,
      released_at = case when v_status = 'released' and v_status_changed then now() when v_reopen then null else v_old.released_at end,
      released_by = case when v_status = 'released' and v_status_changed then p_actor.id when v_reopen then null else v_old.released_by end,
      completed_at = case when v_new_status = 'completed' and v_status_changed then now() else v_old.completed_at end,
      cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else v_old.cancelled_at end,
      cancel_reason = case when v_status = 'cancelled' and v_status_changed then v_reason else v_old.cancel_reason end,
      sent_at = case when v_send_changed then now() else v_old.sent_at end,
      sent_by = case when v_send_changed then p_actor.id else v_old.sent_by end,
      -- ฝ่ายขายยกเลิกกลางทาง: ตั้งครั้งเดียว · ใบที่รอตัดสินแล้วถูกยกเลิก (ฝ่ายวางแผนเลือกหยุด หรือยกเลิกตรง ๆ) = ทางเลือก stop
      sales_cancel_at = case when v_sc_req then now() else v_old.sales_cancel_at end,
      sales_cancel_by = case when v_sc_req then p_actor.id else v_old.sales_cancel_by end,
      sales_cancel_reason = case when v_sc_req then v_sc_reason else v_old.sales_cancel_reason end,
      sales_cancel_choice = case when v_status = 'cancelled' and v_status_changed and v_old.sales_cancel_at is not null and v_old.sales_cancel_choice is null then 'stop'
                                 else v_old.sales_cancel_choice end,
      -- จำนวนสินค้าที่เปิดงานไว้แล้ว (20261227010000): ปล่อยผลิต = รายการของใบ (รวมใบที่ได้ครบจากสต็อก) · เปิดกลับเป็นร่าง = null (งานถูกลบ) · อื่น ๆ คงเดิม
      planned_items = case when v_release then private.bom_items_qty(v_items) when v_reopen then null else v_old.planned_items end,
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened),
                            'fgMoves', v_moves, 'rodMoves', v_rod_moves, 'cancelledOrders', to_jsonb(v_cancelled_orders), 'notices', to_jsonb(v_notices));
end;
$$;

-- 6. ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ --------------------------------------------------------------------------------------------
-- private.bom_add_change_jobs(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261226010000_bom_sales_orders.sql
--   (+ ใช้สต็อกสินค้าสำเร็จรูป / ยางเส้นยาวกับส่วนที่เพิ่ม · planned_items · qty_required ของงานเดิมเพิ่มตาม · งานไม่บังคับ)
create or replace function private.bom_add_change_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_orders jsonb, p_jobs jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_el jsonb;
  v_node jsonb;
  v_old public.bom_orders%rowtype;
  v_job public.bom_jobs%rowtype;
  v_item public.bom_items%rowtype;
  v_pi text;
  v_expl jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_dept text;
  v_code text;
  v_name text;
  v_kind text;
  v_uom text;
  v_planned numeric;
  v_required numeric;
  v_stock numeric;
  v_due numeric;
  v_status text;
  v_fg jsonb;
  v_ext jsonb;
  v_wo public.rf_orders%rowtype;
  v_qty numeric;
  v_kg numeric;
  v_locked boolean := false;
  v_raised jsonb := '[]'::jsonb;
  -- งาน RB ที่คำสั่งนี้สร้าง: ผู้เรียกเปิด WO ให้เฉพาะงานเหล่านี้ (private.bom_open_rf_jobs)
  v_new_rb text[] := '{}';
  -- 20261227010000: stockCounts ที่เพิ่ม / planned_items / สต็อกที่หยิบให้ส่วนที่เพิ่ม
  v_counts jsonb;
  v_old_counts jsonb;
  v_cur_items jsonb;
  v_plan jsonb;
  v_key text;
  v_was numeric;
  v_now numeric;
  v_delta numeric;
  v_ordered numeric;
  v_take numeric;
  v_part numeric;
  v_src record;
  v_fg_take jsonb := '{}'::jsonb;
  v_rod_take jsonb := '{}'::jsonb;
  v_fg_moves integer := 0;
  v_rod_moves integer := 0;
begin
  if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
  -- 20261227010000: งานส่งว่างได้ (ใช้สต็อกได้ครบส่วนที่เพิ่ม) · ไม่มีงานและไม่ได้ใช้สต็อกเพิ่ม = BOM_INVALID_PAYLOAD (ตรวจหลังอ่านใบ)
  if jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) <> 1 or jsonb_typeof(p_jobs) is distinct from 'array' then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- ใบ: ทุกช่องเท่าเดิมยกเว้นผลระเบิด (การจัดรูปเดียวกับ private.bom_save_orders)
  v_row := p_orders -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
  v_pi := upper(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ORDER'));
  select * into v_old from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_ORDER'; end if;
  if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  v_counts := private.bom_parse_stock_counts(v_row -> 'stockCounts');
  v_old_counts := coalesce(v_old.stock_counts, '{}'::jsonb);
  if jsonb_array_length(p_jobs) = 0 and v_counts = v_old_counts then raise exception 'BOM_INVALID_PAYLOAD'; end if;
  if v_old.status not in ('released', 'in_progress') or v_old.sales_cancel_at is not null then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- นับเฉพาะที่ฝ่ายขายเปลี่ยนจริง (20261227010000): ต้องมีสินค้าที่จำนวนสั่งปัจจุบันมากกว่าที่เปิดงานไว้แล้ว (planned_items · null = รายการปัจจุบัน)
  v_cur_items := private.bom_items_qty(v_old.items);
  v_plan := coalesce(v_old.planned_items, v_cur_items);
  if not exists (select 1 from jsonb_each(v_cur_items) as c(code, qty)
                 where (c.qty #>> '{}')::numeric > coalesce((v_plan ->> c.code)::numeric, 0)) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  v_node := coalesce(v_row -> 'dueDefaults', '[]'::jsonb);
  if jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
  if btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'BOM_INVALID_ORDER'), '\s+', ' ', 'g')) <> v_old.customer
     or private.bom_text(v_row, 'country', 60, 1, 'BOM_INVALID_ORDER') <> v_old.country
     or upper(private.bom_text(v_row, 'orderType', 2, 1, 'BOM_INVALID_ORDER')) <> v_old.order_type
     or private.bom_num(v_row -> 'orderedAt', 'BOM_INVALID_ORDER', 1, 100000000000000) is distinct from v_old.ordered_at::numeric
     or private.bom_num(v_row -> 'whDue', 'BOM_INVALID_ORDER', 1, 100000000000000) is distinct from v_old.wh_due::numeric
     or private.bom_parse_due(v_row -> 'due') <> v_old.due
     or v_node <> v_old.due_defaults
     or private.bom_parse_order_items(v_row -> 'items') <> v_old.items
     or private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_ORDER') <> v_old.note
     or private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ORDER') <> v_old.status then
    raise exception 'BOM_INVALID_ORDER';
  end if;
  v_expl := private.bom_parse_explosion(v_row -> 'explosion');
  if v_expl is null or jsonb_array_length(v_expl) = 0 then raise exception 'BOM_INVALID_ORDER'; end if;
  -- ยอดที่ใช้จากสต็อก (20261227010000): ทุกคีย์ที่ต่างจากเดิมต้องเพิ่มขึ้น (ไม่มีคีย์ = 0 · ลด / ลบคีย์ = BOM_INVALID_ORDER)
  --   รหัสสินค้าของใบ: ค่าใหม่ไม่เกินจำนวนสั่ง และส่วนที่เพิ่มไม่เกินส่วนที่ฝ่ายขายเพิ่ม (จำนวนสั่ง − planned_items) → หยิบจากสต็อกสินค้าสำเร็จรูป
  --   รหัส RB ของบรรทัดผลระเบิดใหม่ (kind RB) → หยิบจากสต็อกกลางยางเส้นยาว SR · คีย์อื่น = BOM_INVALID_ORDER
  for v_key in
    select k.code from (select jsonb_object_keys(v_old_counts) as code union select jsonb_object_keys(v_counts)) as k order by k.code collate "C"
  loop
    continue when (v_old_counts -> v_key) is not distinct from (v_counts -> v_key);
    v_was := coalesce((v_old_counts ->> v_key)::numeric, 0);
    v_now := (v_counts ->> v_key)::numeric;
    if v_now is null or v_now <= v_was then raise exception 'BOM_INVALID_ORDER'; end if;
    v_delta := v_now - v_was;
    v_ordered := (v_cur_items ->> v_key)::numeric;
    if v_ordered is not null then
      if v_now > v_ordered or v_delta > greatest(0, v_ordered - coalesce((v_plan ->> v_key)::numeric, 0)) then raise exception 'BOM_INVALID_ORDER'; end if;
      v_fg_take := v_fg_take || jsonb_build_object(v_key, v_delta);
    elsif exists (select 1 from jsonb_array_elements(v_expl) as e(line) where e.line ->> 'itemCode' = v_key and e.line ->> 'kind' = 'RB') then
      v_rod_take := v_rod_take || jsonb_build_object(v_key, v_delta);
    else
      raise exception 'BOM_INVALID_ORDER';
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_jobs) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    if upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB')) <> v_pi then raise exception 'BOM_INVALID_JOB'; end if;
    v_dept := private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT'));
    v_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_JOB'));
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_JOB');
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_JOB');
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_JOB');
    v_planned := private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000);
    v_required := private.bom_num(v_row -> 'qtyRequired', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_planned is null or v_required is null or v_planned <= 0 then raise exception 'BOM_INVALID_JOB'; end if;
    v_stock := private.bom_num(v_row -> 'stockCounted', 'BOM_INVALID_JOB', 0, 1000000000);
    v_due := private.bom_num(v_row -> 'dueAt', 'BOM_INVALID_JOB', 1, 100000000000000);
    if v_due is not null and v_due <> trunc(v_due) then raise exception 'BOM_INVALID_JOB'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB');
    v_node := v_row -> 'fgCodes';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 500 then raise exception 'BOM_INVALID_JOB'; end if;
    v_fg := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or char_length(btrim(v_el #>> '{}')) not between 1 and 60 then raise exception 'BOM_INVALID_JOB'; end if;
      v_fg := v_fg || jsonb_build_array(private.bom_code(v_el #>> '{}'));
    end loop;
    v_ext := private.bom_parse_external_ref(v_row -> 'externalRef');

    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
    if not found then
      -- งานใหม่ (รูปเดียวกับงานที่ปล่อยผลิตสร้าง): รอคิวว่าง ยังไม่มีงานคู่ (แผนก, ชิ้นงาน) เดียวกันในใบ
      if exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no
                 and k.changed_version > p_base and k.changed_version <= p_cur) then
        raise exception 'BOM_STALE';
      end if;
      if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') or not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_JOB'; end if;
      if v_status <> 'queued' or coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0) <> 0
         or coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0) <> 0 or v_ext is not null
         or jsonb_array_length(private.bom_parse_reports(v_row -> 'reports', '[]'::jsonb, p_actor_name)) > 0 then
        raise exception 'BOM_INVALID_JOB';
      end if;
      if exists (select 1 from public.bom_jobs j where j.order_pk = v_old.id and j.dept = v_dept and j.item_code = v_code) then raise exception 'BOM_INVALID_JOB'; end if;
      delete from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values ((select private.bom_test_mode()), v_no, v_old.id, v_dept, v_code, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
      if v_dept = 'RB' then v_new_rb := v_new_rb || v_no; end if;
      continue;
    end if;

    -- งานเดิม: เพิ่มยอดแผนอย่างเดียว
    if v_job.changed_version > p_base and v_job.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    if v_job.order_pk <> v_old.id
       or v_job.dept <> v_dept or v_job.item_code <> v_code or v_job.name <> v_name or v_job.kind <> v_kind or v_job.uom <> v_uom
       or v_required < v_job.qty_required or v_job.due_at is distinct from v_due::bigint or v_job.fg_codes <> v_fg
       or v_job.status <> v_status
       or v_job.qty_done <> coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0)
       or v_job.qty_reject <> coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0)
       or private.bom_parse_reports(v_row -> 'reports', v_job.reports, p_actor_name) <> v_job.reports
       or (v_job.external_ref is null) <> (v_ext is null)
       or (v_ext is not null and (v_job.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext)
       or v_planned <= v_job.qty_planned then
      raise exception 'BOM_INVALID_JOB';
    end if;
    if v_job.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    v_wo := null;
    if (v_job.external_ref ->> 'woId') is not null then
      select * into v_wo from public.rf_orders o
      where o.is_test = (select private.bom_test_mode()) and o.wo_no = (v_job.external_ref ->> 'woId') and o.source_job_no = v_job.job_no
      for update;
      if not found or v_wo.status <> 'planned' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    end if;
    -- 20261227010000: ความต้องการเพิ่มตามยอดแผน (ส่งค่าเดิม = เพิ่มเท่ายอดแผนที่เพิ่ม · ส่งมากกว่าเดิม = ค่าที่ส่ง) · ยอดที่ใช้จากสต็อกตามที่ส่ง
    update public.bom_jobs set
      qty_planned = v_planned,
      qty_required = case when v_required = v_job.qty_required then v_job.qty_required + (v_planned - v_job.qty_planned) else v_required end,
      stock_counted = v_stock,
      updated_at = now()
    where id = v_job.id returning * into v_job;
    if v_wo.id is not null then
      -- WO ที่ยังวางแผนอยู่ได้ยอดและกิโลกรัมตามงาน (เพดานเท่าคอลัมน์ของ rf_orders เหมือน private.bom_open_rf_orders · คำนวณไม่ได้ = ไม่เพิ่ม)
      if not v_locked then perform private.bom_lock_rf(); v_locked := true; end if;
      select * into v_item from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_job.item_code;
      v_qty := greatest(0, v_job.qty_planned - v_job.qty_done);
      v_kg := private.bom_rb_job_kg(v_job, v_item);
      if v_qty <= 0 or v_kg is null or v_kg <= 0 or v_kg > 1000000000 or v_kg / v_qty > 1000000000 then raise exception 'BOM_INVALID_TRANSITION'; end if;
      update public.rf_orders set target_qty = v_qty, target_kg = v_kg, kg_per_unit = private.bom_kg_per_unit(v_kg, v_qty), updated_at = now() where id = v_wo.id;
      update public.bom_jobs set external_ref = external_ref || jsonb_build_object('kg', v_kg), updated_at = now() where id = v_job.id;
      v_raised := v_raised || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'woId', v_wo.wo_no, 'kg', v_kg));
    end if;
  end loop;

  -- สต็อกที่ใช้กับส่วนที่เพิ่ม (20261227010000 · แบบเดียวกับปล่อยผลิตใน private.bom_save_orders): สินค้าสำเร็จรูปจากใบต้นทางที่ปล่อยก่อนก่อน
  --   หนึ่งแถว transfer ต่อใบต้นทาง (ไม่พอ = BOM_FG_EXCEEDS) · ยางเส้นยาวจากสต็อกกลาง SR ล็อตเก่าก่อน (private.bom_rod_take · ไม่พอ = BOM_ROD_EXCEEDS)
  for v_key, v_take in
    select c.key, (c.value #>> '{}')::numeric from jsonb_each(v_fg_take) as c order by c.key collate "C"
  loop
    if private.bom_fg_stock(v_key) < v_take then raise exception 'BOM_FG_EXCEEDS'; end if;
    for v_src in
      select o.id, private.bom_fg_free(o.id, v_key) as avail
      from public.bom_orders o
      where o.is_test = (select private.bom_test_mode()) and o.id <> v_old.id and o.status in ('released', 'in_progress', 'completed', 'cancelled')
        and exists (select 1 from public.bom_fg_moves m where m.is_test = (select private.bom_test_mode()) and m.order_pk = o.id and m.fg_code = v_key)
      order by o.released_at, o.pi_no collate "C"
    loop
      exit when v_take <= 0;
      continue when v_src.avail <= 0;
      v_part := least(v_take, v_src.avail);
      insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
      values ((select private.bom_test_mode()), v_old.id, v_src.id, v_key, 'transfer', v_part, '', p_actor.id);
      v_take := v_take - v_part;
      v_fg_moves := v_fg_moves + 1;
    end loop;
    if v_take > 0 then raise exception 'BOM_FG_EXCEEDS'; end if;
  end loop;
  v_rod_moves := private.bom_rod_take(v_old.id, v_rod_take, v_expl, p_actor.id);

  update public.bom_orders set
    explosion = v_expl, exploded_at = now(),
    stock_counts = v_counts,
    stock_counted_at = case when v_counts <> v_old_counts then now() else v_old.stock_counted_at end,
    stock_counted_by = case when v_counts <> v_old_counts then p_actor.id else v_old.stock_counted_by end,
    planned_items = v_cur_items,
    updated_at = now()
  where id = v_old.id;
  return jsonb_build_object('orderPk', v_old.id, 'raised', v_raised, 'newRb', to_jsonb(v_new_rb), 'fgMoves', v_fg_moves, 'rodMoves', v_rod_moves);
end;
$$;
revoke all on function private.bom_add_change_jobs(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 7. ชุดเรคอร์ด -------------------------------------------------------------------------------------------------------------------
-- private.bom_records(bigint) จาก 20261226010000_bom_sales_orders.sql (orders + started / locked / plannedItems)
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
      from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.changed_version > p_since), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test = (select private.bom_test_mode()) and s.changed_version > p_since), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test = (select private.bom_test_mode()) and p.changed_version > p_since), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test = (select private.bom_test_mode()) and b.changed_version > p_since), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test = (select private.bom_test_mode()) and p.changed_version > p_since), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test = (select private.bom_test_mode()) and r.changed_version > p_since), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name, 'country', c.country, 'orderType', c.order_type, 'note', c.note,
          'createdAt', private.bom_ms(c.created_at)) order by lower(c.name) collate "C", c.name collate "C")
      from public.bom_customers c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.pi_no, 'customer', o.customer, 'country', o.country, 'orderType', o.order_type,
          'orderedAt', o.ordered_at, 'whDue', o.wh_due, 'due', o.due, 'dueDefaults', o.due_defaults,
          'revision', o.revision, 'status', o.status, 'items', o.items, 'explosion', o.explosion,
          'explodedAt', private.bom_ms(o.exploded_at), 'stockCounts', o.stock_counts, 'note', o.note,
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at), 'source', o.source,
          -- 20261227010000: เริ่มงานแล้ว (private.bom_started_jobs: งานมียอด / รายงาน หรือ WO เลย released) · เปิดกลับเป็นร่าง / ยกเลิกทันทีไม่ได้ (private.bom_order_locked)
          -- เฉพาะใบ released / in_progress (สถานะอื่น = false) · ฝ่ายขายอ่าน WO ของ RubberFlow ไม่ได้ จึงใช้สองช่องนี้แทนการเดาจาก WO
          'started', case when o.status in ('released', 'in_progress') then private.bom_started_jobs(o.id) else false end,
          'locked', case when o.status in ('released', 'in_progress') then private.bom_order_locked(o.id) else false end)
        -- จำนวนสินค้าที่เปิดงานไว้แล้ว (20261227010000 · null = ไม่มีช่องนี้: ร่าง / ใบใหม่ / เปิดกลับเป็นร่าง)
        || case when o.planned_items is null then '{}'::jsonb else jsonb_build_object('plannedItems', o.planned_items) end
        -- ฝ่ายขาย (20261226010000): ส่งให้ฝ่ายวางแผนแล้ว = sentAt / sentBy (ยังไม่ส่ง หรือใบของฝ่ายวางแผน = ไม่มีสองช่องนี้)
        || case when o.sent_at is null then '{}'::jsonb
                else jsonb_build_object('sentAt', private.bom_ms(o.sent_at), 'sentBy', coalesce(private.bom_person(o.sent_by), '')) end
        -- ฝ่ายขายยกเลิกกลางทาง (รอบ 2): เวลา ผู้ยกเลิก เหตุผล และทางเลือกของฝ่ายวางแผน (null = รอตัดสิน) · ใบที่ไม่ได้ถูกยกเลิกแบบนี้ไม่มีสี่ช่องนี้
        || case when o.sales_cancel_at is null then '{}'::jsonb
                else jsonb_build_object('salesCancelAt', private.bom_ms(o.sales_cancel_at), 'salesCancelBy', coalesce(private.bom_person(o.sales_cancel_by), ''),
                                        'salesCancelReason', o.sales_cancel_reason, 'salesCancelChoice', o.sales_cancel_choice) end
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
      from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb),
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
      where j.is_test = (select private.bom_test_mode()) and j.changed_version > p_since), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemCode', s.item_code, 'qty', s.qty, 'safetyQty', s.safety_qty, 'countedAt', private.bom_ms(s.counted_at),
          'countedBy', coalesce(private.bom_person(s.counted_by), ''), 'updatedAt', private.bom_ms(s.updated_at))
        order by s.item_code collate "C")
      from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.changed_version > p_since), '[]'::jsonb),
    'stockMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty, 'balance', m.balance, 'ref', m.ref,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''), 'note', m.note)
        order by m.created_at, m.id)
      from public.bom_stock_moves m where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
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
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
    -- คลังยางเส้นยาว SR (20261202010000): ล็อตยางเส้นยาว (ช่องที่ยังไม่มีค่าเป็น null) และประวัติสต็อกที่จ่ายได้ (เลข PI ของถัง / ใบที่จ่ายให้ null = ไม่มี)
    -- 20261204010000: + location (ตำแหน่งจัดเก็บ '' = ยังไม่ได้บันทึก) source ('order' | 'opening') sourceNote · ล็อตนอกใบสั่งไม่มีใบ (left join: orderId null)
    'rodLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id::text, 'lotNo', l.lot_no, 'itemCode', l.item_code, 'orderId', o.pi_no, 'jobNo', l.job_no, 'woNo', l.wo_no,
          'recipeCode', l.recipe_code, 'uom', l.uom, 'qtySent', l.qty_sent, 'spec', l.spec, 'status', l.status,
          'qtyReceived', l.qty_received, 'qc', l.qc,
          'receivedBy', case when l.received_at is null then null else coalesce(private.bom_person(l.received_by), '') end,
          'receivedAt', private.bom_ms(l.received_at),
          'decision', l.decision, 'decisionNote', l.decision_note,
          'decidedBy', case when l.decided_at is null then null else coalesce(private.bom_person(l.decided_by), '') end,
          'decidedAt', private.bom_ms(l.decided_at), 'createdAt', private.bom_ms(l.created_at),
          'location', l.location, 'source', l.source, 'sourceNote', l.source_note)
        order by l.created_at, l.lot_no collate "C")
      from public.bom_rod_lots l left join public.bom_orders o on o.id = l.order_pk
      where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_since), '[]'::jsonb),
    'rodMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'lotId', m.lot_id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty,
          'ownerOrderId', ow.pi_no, 'forOrderId', fo.pi_no, 'reversesId', m.reverses_id::text, 'note', m.note,
          'by', coalesce(private.bom_person(m.created_by), ''), 'at', private.bom_ms(m.created_at))
        order by m.created_at, m.id)
      from public.bom_rod_moves m
      left join public.bom_orders ow on ow.id = m.owner_order_pk
      left join public.bom_orders fo on fo.id = m.for_order_pk
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
    -- แปรรูปยาง GR (20261216010000): ตั้งค่า (ว่าง = ใช้ค่าเริ่มต้น) ขั้นตอนของงาน ผลรายวัน คำขอเบิกยางเส้นยาว การส่งงานให้ PK (เลขงาน / เลข PI แทน uuid ของแถว)
    -- ขั้นตอนรายแผนก (20261224010000): ตั้งค่าหนึ่งแถวต่อแผนก GR / PT / BG / PK · การส่งงาน GR / PT / BG → PK และ PK → WH
    'grConfig', coalesce((
      select jsonb_agg(jsonb_build_object(
          'key', lower(c.dept), 'dept', c.dept, 'steps', c.steps, 'reasons', c.reasons, 'targets', c.targets,
          'updatedBy', coalesce(private.bom_person(c.updated_by), ''), 'updatedAt', private.bom_ms(c.updated_at))
        order by (c.dept <> 'GR'), c.dept collate "C")
      from public.bom_gr_config c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
    'grPlans', coalesce((
      select jsonb_agg(jsonb_build_object(
          'jobId', j.job_no, 'orderId', o.pi_no, 'steps', p.steps,
          'createdBy', coalesce(private.bom_person(p.created_by), ''), 'createdAt', private.bom_ms(p.created_at),
          'updatedBy', coalesce(private.bom_person(p.updated_by), ''), 'updatedAt', private.bom_ms(p.updated_at))
        order by j.job_no collate "C")
      from public.bom_gr_job_plans p join public.bom_jobs j on j.id = p.job_id join public.bom_orders o on o.id = j.order_pk
      where p.is_test = (select private.bom_test_mode()) and p.changed_version > p_since), '[]'::jsonb),
    'grRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id::text, 'jobId', j.job_no, 'orderId', o.pi_no, 'itemCode', j.item_code, 'stepCode', r.step_code,
          'workDate', to_char(r.work_date, 'YYYY-MM-DD'), 'workerId', r.worker_id::text, 'workerName', coalesce(private.bom_person(r.worker_id), ''),
          'hours', trim_scale(r.hours), 'people', r.people, 'good', r.good, 'reject', r.reject, 'reason', r.reason, 'note', r.note,
          'status', r.status, 'voidReason', r.void_reason, 'edits', r.edits,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdById', r.created_by::text, 'createdAt', private.bom_ms(r.created_at),
          'updatedBy', case when r.updated_at is null then null else coalesce(private.bom_person(r.updated_by), '') end,
          'updatedAt', private.bom_ms(r.updated_at))
        order by r.created_at, r.id)
      from public.bom_gr_records r join public.bom_jobs j on j.id = r.job_id join public.bom_orders o on o.id = j.order_pk
      where r.is_test = (select private.bom_test_mode()) and r.changed_version > p_since), '[]'::jsonb),
    'rodRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', q.id::text, 'orderId', o.pi_no, 'jobId', j.job_no, 'itemCode', q.item_code, 'qty', q.qty, 'note', q.note, 'status', q.status,
          'createdBy', coalesce(private.bom_person(q.created_by), ''), 'createdById', q.created_by::text, 'createdAt', private.bom_ms(q.created_at),
          'cancelledBy', case when q.cancelled_at is null then null else coalesce(private.bom_person(q.cancelled_by), '') end,
          'cancelledAt', private.bom_ms(q.cancelled_at), 'cancelReason', q.cancel_reason)
        order by q.created_at, q.id)
      from public.bom_rod_requests q join public.bom_jobs j on j.id = q.job_id join public.bom_orders o on o.id = q.order_pk
      where q.is_test = (select private.bom_test_mode()) and q.changed_version > p_since), '[]'::jsonb),
    'grHandovers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', h.id::text, 'jobId', j.job_no, 'orderId', o.pi_no, 'itemCode', h.item_code, 'qty', h.qty, 'status', h.status, 'note', h.note, 'fromDept', h.from_dept, 'toDept', h.to_dept,
          'sentBy', coalesce(private.bom_person(h.sent_by), ''), 'sentAt', private.bom_ms(h.sent_at),
          'receivedBy', case when h.received_at is null then null else coalesce(private.bom_person(h.received_by), '') end,
          'receivedAt', private.bom_ms(h.received_at),
          'cancelledBy', case when h.cancelled_at is null then null else coalesce(private.bom_person(h.cancelled_by), '') end,
          'cancelledAt', private.bom_ms(h.cancelled_at), 'cancelReason', h.cancel_reason, 'moves', h.moves)
        order by h.sent_at, h.id)
      from public.bom_gr_handovers h join public.bom_jobs j on j.id = h.job_id join public.bom_orders o on o.id = h.order_pk
      where h.is_test = (select private.bom_test_mode()) and h.changed_version > p_since), '[]'::jsonb),
    -- การแจ้งฝ่ายวางแผนของฝ่ายขาย (20261226010000): เลข PI แทน uuid ของใบ · ผู้ตัดสิน / ทางเลือก null = ยังไม่ตัดสิน
    'orderRequests', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', q.id::text, 'orderId', o.pi_no, 'kind', q.kind, 'reason', q.reason, 'status', q.status, 'decision', q.decision,
          'requestedBy', coalesce(private.bom_person(q.requested_by), ''), 'requestedById', q.requested_by::text, 'requestedAt', private.bom_ms(q.requested_at),
          'decidedBy', case when q.decided_at is null then null else coalesce(private.bom_person(q.decided_by), '') end,
          'decidedAt', private.bom_ms(q.decided_at))
        order by q.requested_at, q.id)
      from public.bom_order_requests q join public.bom_orders o on o.id = q.order_pk
      where q.is_test = (select private.bom_test_mode()) and q.changed_version > p_since), '[]'::jsonb),
    -- พนักงานของแผนกที่มีขั้นตอน GR / PT / BG / PK ในโหมดเดียวกัน (หัวหน้าเลือกผู้ทำ: ใช้งานจริง = active · บัญชีทดสอบ inactive เสมอจึงไม่ตรวจ) + dept (20261224010000 · GR ก่อน)
    -- เฉพาะ snapshot (p_since < 0) · ส่วนต่างเป็น [] เสมอ (ตารางพนักงานไม่มีเลขรุ่น)
    'grWorkers', case when p_since >= 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id::text, 'name', e.first_name || ' ' || e.last_name, 'dept', d.code)
                       order by (d.code <> 'GR'), d.code collate "C", e.first_name, e.last_name, e.id)
      from public.employees e join public.departments d on d.id = e.department_id
      where d.code in ('GR', 'PT', 'BG', 'PK') and (e.is_active or e.is_test) and e.is_test = (select private.bom_test_mode())), '[]'::jsonb) end)
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- 8. RPC บันทึก ------------------------------------------------------------------------------------------------------------------
-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261226010000_bom_sales_orders.sql
--   (+ addJobsForChanges: งานไม่บังคับ นับแถวสต็อกที่หยิบ · ใบ completed ปิดการแจ้งแก้ใบที่ยังเปิด)
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
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves', 'rodLots', 'rodMoves',
                                      'grConfig', 'grPlans', 'grRecords', 'rodRequests', 'grHandovers', 'orderRequests'];
  -- ส่วนที่เขียนได้เฉพาะกลุ่มวางแผน (orders / jobs ตรวจรายช่องในตัวเขียน · customers = ผู้เขียนใบสั่งผลิต private.bom_can_order ตั้งแต่ 20261226010000)
  v_planner_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings'];
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
  v_rf_close_n integer := 0;
  v_jobs jsonb;
  v_rf_version bigint;
  v_rf_meta jsonb := '{}'::jsonb;
  v_stock_n integer;
  v_fg jsonb;
  v_fg_orders_n integer;
  v_rod jsonb;
  v_rod_n integer;
  v_rod_orders_n integer;
  v_gr jsonb;
  v_gr_section text := private.bom_gr_section(p_action);
  v_order_planner boolean;
  v_orderer boolean;
  v_cancelled_orders uuid[] := '{}';
  v_notices uuid[] := '{}';
  -- เปิดงานเพิ่มจากฝ่ายขายแก้ใบ (addJobsForChanges): ส่วน orders / jobs ไปที่ private.bom_add_change_jobs แทนตัวเขียนใบและตัวเขียนงาน (v_std = ส่วนที่ตัวเขียนเดิมเห็น)
  v_std jsonb := p_changes;
  v_rf_raised jsonb := '[]'::jsonb;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_reader();
  v_planner := private.bom_can_edit(v_actor);
  -- ผู้เขียนใบสั่งผลิตและลูกค้า (20261226010000): กลุ่มวางแผนของใบสั่งผลิต (แผนก PP · ผู้ช่วยผู้จัดการโรงงานขึ้นไป · admin) หรือฝ่ายขาย (แผนก SA)
  -- ผู้จัดการแผนกในสายผลิตยังอยู่ใน v_planner สำหรับส่วนอื่นทั้งหมด แต่ไม่ใช่ผู้เขียนใบสั่งผลิต / ลูกค้าแล้ว
  v_order_planner := private.bom_can_plan_orders(v_actor);
  v_orderer := private.bom_can_order(v_actor);
  -- ด่านหยาบ: คนนอกกลุ่มวางแผนเรียกได้เฉพาะ action ของนับคงคลัง/รายงานงาน · ฝ่ายขายเรียกได้เพิ่มเฉพาะ action ของใบสั่งผลิตและลูกค้า (private.bom_sales_actions)
  -- (สิทธิ์จริงตรวจรายส่วนและรายช่องข้างล่าง)
  if not v_planner and not coalesce(p_action = any (private.bom_staff_actions()), false)
     and not (v_orderer and coalesce(p_action = any (private.bom_sales_actions()), false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;
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
      -- คลังยางเส้นยาว SR (20261202010000 · 20261204010000): ส่วน rodLots ส่งได้เฉพาะ receiveRods / decideRods / receiveRodsOpening / setRodLocation
      -- · ส่วน rodMoves เฉพาะ issueRods / reverseRodIssue / adjustRods · และเจ็ดการกระทำนี้ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_ROD)
      if v_n > 0 and ((v_key = 'rodLots' and p_action not in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation'))
                      or (v_key = 'rodMoves' and p_action not in ('issueRods', 'reverseRodIssue', 'adjustRods'))
                      or (p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') and v_key <> 'rodLots')
                      or (p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and v_key <> 'rodMoves')) then
        raise exception 'BOM_INVALID_ROD';
      end if;
      -- แปรรูปยาง GR (20261216010000): ส่วน grConfig / grPlans / grRecords / rodRequests / grHandovers ส่งได้เฉพาะ action ของส่วนนั้น (private.bom_gr_section)
      -- และสิบ action ของ GR ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_GR)
      if v_n > 0 and ((v_key in ('grConfig', 'grPlans', 'grRecords', 'rodRequests', 'grHandovers') and v_gr_section is distinct from v_key)
                      or (v_gr_section is not null and v_key <> v_gr_section)) then
        raise exception 'BOM_INVALID_GR';
      end if;
      -- การแจ้งของฝ่ายขาย (20261226010000 รอบ 2): ส่วน orderRequests ส่งได้เฉพาะ decideOrderRequest · decideOrderRequest ส่งได้เฉพาะส่วนนี้และแถวใบสั่งผลิตหนึ่งแถว
      -- (หยุด = แถวยกเลิกใบในคำสั่งเดียวกัน · ผลิตต่อ = แถวใบที่ไม่เปลี่ยน) · ผิด = BOM_INVALID_REQUEST
      if v_n > 0 and ((v_key = 'orderRequests' and p_action <> 'decideOrderRequest')
                      or (p_action = 'decideOrderRequest' and not (v_key = 'orderRequests' or (v_key = 'orders' and v_sub = 'upsert' and v_n = 1)))) then
        raise exception 'BOM_INVALID_REQUEST';
      end if;
      -- เปิดงานเพิ่มจากฝ่ายขายแก้ใบ (20261226010000): ส่งได้เฉพาะแถวใบ (orders upsert) และงาน (jobs upsert) · ผิด = BOM_INVALID_PAYLOAD
      if v_n > 0 and p_action = 'addJobsForChanges' and not (v_key in ('orders', 'jobs') and v_sub = 'upsert') then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      -- ข้อมูลหลักเขียนได้เฉพาะกลุ่มวางแผน · ลูกค้าเขียนได้เฉพาะผู้เขียนใบสั่งผลิต (ฝ่ายขาย ฝ่ายวางแผน ผู้จัดการ admin · 20261226010000)
      if v_n > 0 and v_key = any (v_planner_sections) and not v_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_n > 0 and v_key = 'customers' and not v_orderer then raise exception 'BOM_FORBIDDEN'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ของสำเร็จรูป: receiveFg / deliverFg / closeOrderShort / closeOrder / reverseFg ต้องมีคำขอในส่วน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG
  -- ไม่ใช่สำเร็จแบบไม่ทำอะไร) ตามสัญญา "คำขอเดียวต่อคำสั่ง" · ตรวจหลังรูป payload ก่อนล็อกตัวนับ (BOM_RESET / ฐานเวอร์ชันมาทีหลัง)
  if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg') and coalesce(jsonb_array_length(p_changes #> '{fgMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_FG';
  end if;
  -- คลังยางเส้นยาว SR: เจ็ดการกระทำต้องมีคำขอในส่วนของตัวเองเสมอ (ไม่มี / ว่าง = BOM_INVALID_ROD)
  if p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') and coalesce(jsonb_array_length(p_changes #> '{rodLots,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
  end if;
  if p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and coalesce(jsonb_array_length(p_changes #> '{rodMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
  end if;
  -- แปรรูปยาง GR: action ของ GR ต้องมีคำขอในส่วนของตัวเองเสมอ (ไม่มี / ว่าง = BOM_INVALID_GR)
  if v_gr_section is not null and coalesce(jsonb_array_length(p_changes #> array[v_gr_section, 'upsert']), 0) = 0 then
    raise exception 'BOM_INVALID_GR';
  end if;
  -- การแจ้งของฝ่ายขาย: decideOrderRequest ต้องมีแถวเดียวในส่วน orderRequests เสมอ (ไม่มี / ว่าง / เกินหนึ่งแถว = BOM_INVALID_REQUEST)
  if p_action = 'decideOrderRequest' and coalesce(jsonb_array_length(p_changes #> '{orderRequests,upsert}'), 0) <> 1 then
    raise exception 'BOM_INVALID_REQUEST';
  end if;
  -- เปิดงานเพิ่ม: แถวใบหนึ่งแถวเสมอ (ไม่มี = BOM_INVALID_PAYLOAD) · ตัวเขียนใบ / ตัวเขียนงานเดิมไม่เห็นสองส่วนนี้
  --   งานไม่บังคับตั้งแต่ 20261227010000 (ใช้สต็อกได้ครบส่วนที่เพิ่ม · ไม่มีทั้งงานและสต็อกที่เพิ่ม = BOM_INVALID_PAYLOAD ในตัวเขียน)
  if p_action = 'addJobsForChanges' then
    if coalesce(jsonb_array_length(p_changes #> '{orders,upsert}'), 0) <> 1 then
      raise exception 'BOM_INVALID_PAYLOAD';
    end if;
    v_std := p_changes - 'orders' - 'jobs';
  end if;

  -- ล็อกตัวนับก่อนตรวจชน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็นเวอร์ชันของระเบียนที่คนแรกเพิ่งแก้ (changed_version) แล้วได้ BOM_STALE เฉพาะที่ชนกัน
  -- v_version = เวอร์ชันก่อนบันทึกนี้ (p_cur ของตัวเขียน) ระเบียนที่แก้ในคำสั่งนี้ได้ v_version + 1 จึงไม่ถูกนับว่าเป็นของคนอื่น
  insert into public.bom_master_state (is_test) values ((select private.bom_test_mode())) on conflict (is_test) do nothing;
  select s.version, s.epoch into v_version, v_epoch from public.bom_master_state s where s.is_test = (select private.bom_test_mode()) for update;
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
      select s.changed_version into v_row_version from public.bom_color_sets s where s.is_test = (select private.bom_test_mode()) and s.base = v_dbase and s.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'colorSets' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_color_sets where is_test = (select private.bom_test_mode()) and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values ((select private.bom_test_mode()), 'colorSets', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_dbase := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
      v_dcode := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      select p.changed_version into v_row_version from public.bom_packages p where p.is_test = (select private.bom_test_mode()) and p.base = v_dbase and p.code = v_dcode;
      if not found then
        if exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'packages' and k.base = v_dbase and k.code = v_dcode
                   and k.changed_version > p_base_version and k.changed_version <= v_version) then
          raise exception 'BOM_STALE';
        end if;
        raise exception 'BOM_NOT_FOUND';
      end if;
      if v_row_version > p_base_version and v_row_version <= v_version then raise exception 'BOM_STALE'; end if;
      delete from public.bom_packages where is_test = (select private.bom_test_mode()) and base = v_dbase and code = v_dcode;
      insert into public.bom_deleted_keys (is_test, list, base, code) values ((select private.bom_test_mode()), 'packages', v_dbase, v_dcode)
      on conflict (list, base, code, is_test) do update set deleted_at = now();
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb), p_base_version, v_version);

    -- ลูกค้า → ใบสั่งผลิต (รวมเปลี่ยนสถานะ ลบงานของใบที่ยกเลิก/เปิดกลับมาแก้) → ลบงานตรง ๆ → งาน (เพิ่ม/แก้) ตามลำดับนี้เสมอ
    perform private.bom_save_customers(v_actor.id, coalesce(p_changes #> '{customers,upsert}', '[]'::jsonb), p_base_version, v_version);
    -- ตัวเขียนใบได้กลุ่มวางแผนของใบสั่งผลิต (ไม่ใช่ v_planner): ผู้จัดการแผนกในสายผลิตแก้ใบได้เท่าพนักงานแผนกของตน (ST / WH นับคงคลัง) · ฝ่ายขายตรวจในตัวเขียน
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_order_planner, coalesce(v_std #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(v_std #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := array(select t.value::uuid from jsonb_array_elements_text(v_res -> 'released') as t(value));
    v_rf_cancel_n := jsonb_array_length(v_res -> 'cancelled');
    v_rf_reopen_n := jsonb_array_length(v_res -> 'reopened');
    v_rf_cancelled := (v_res -> 'cancelled') || (v_res -> 'reopened');
    -- การแจ้งฝ่ายวางแผนของฝ่ายขาย (20261226010000 รอบ 2): ตัวเขียนใบเขียนเองตอนฝ่ายขายแก้ใบที่เริ่มงานแล้ว / ยกเลิกใบ (นับเป็น orderRequests ของบันทึกการใช้งาน)
    -- · ฝ่ายวางแผนตัดสิน (หยุด = มาพร้อมแถวยกเลิกใบที่ตัวเขียนใบเพิ่งยกเลิกให้ในคำสั่งนี้ · ผลิตต่อ = ตัวตัดสินตั้งทางเลือกของใบเอง นับ orders)
    v_cancelled_orders := array(select t.value::uuid from jsonb_array_elements_text(coalesce(v_res -> 'cancelledOrders', '[]'::jsonb)) as t(value));
    v_notices := array(select t.value::uuid from jsonb_array_elements_text(coalesce(v_res -> 'notices', '[]'::jsonb)) as t(value));
    if cardinality(v_notices) > 0 then
      v_counts := v_counts || jsonb_build_object('orderRequests', jsonb_build_object('upsert', coalesce((v_counts #>> '{orderRequests,upsert}')::integer, 0) + cardinality(v_notices)));
    end if;
    if p_action = 'decideOrderRequest' then
      v_n := private.bom_save_order_request(v_actor, v_order_planner, p_action, p_changes #> '{orderRequests,upsert}', v_cancelled_orders, p_base_version, v_version);
      if v_n > 0 and v_counts -> 'orders' is null then v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', v_n)); end if;
    end if;
    -- ใบที่ยกเลิกในคำสั่งนี้ (ฝ่ายวางแผนยกเลิกตรง / เลือกหยุด / ฝ่ายขายยกเลิกทันที): การแจ้งอื่นของใบที่ยังเปิดอยู่ปิดเองหลังตัวตัดสิน
    -- (ที่เพิ่งตัดสินในคำสั่งนี้เป็น done แล้ว · ที่ตัวเขียนใบเพิ่งเขียนในคำสั่งนี้ไม่ถูกแตะ) · decision ack · แจ้งยกเลิกของใบที่เลือกหยุด = stop · ผู้ตัดสิน = ผู้ยกเลิกใบ
    -- นับเป็น orderRequests ของบันทึกการใช้งาน
    if cardinality(v_cancelled_orders) > 0 then
      update public.bom_order_requests q
      set status = 'done',
          decision = case when q.kind = 'cancel'
                               and exists (select 1 from public.bom_orders o where o.id = q.order_pk and o.sales_cancel_choice = 'stop') then 'stop'
                          else 'ack' end,
          decided_by = v_actor.id, decided_at = clock_timestamp()
      where q.is_test = (select private.bom_test_mode()) and q.status = 'open' and q.order_pk = any (v_cancelled_orders)
        and not (q.id = any (v_notices));
      get diagnostics v_n = row_count;
      if v_n > 0 then
        v_counts := v_counts || jsonb_build_object('orderRequests', jsonb_build_object('upsert', coalesce((v_counts #>> '{orderRequests,upsert}')::integer, 0) + v_n));
      end if;
    end if;
    -- ใบที่ฝ่ายขายยกเลิกกลางทางรอฝ่ายวางแผนตัดสิน (20261226010000 รอบ 2): ไม่รับงานใหม่ · SR จ่ายยางเส้นยาวให้ใบ (issueRods) ST เบิกของซื้อให้ใบ (issueOrderParts)
    -- GR ขอเบิกยางเส้นยาวของใบ (requestRods) = BOM_INVALID_TRANSITION (ตรวจก่อนตัวเขียนของ action จากใบที่คำสั่งอ้าง ก่อนสิทธิ์ของตัวเขียน · ทั้งคำสั่งไม่เขียนอะไร) · งานที่ทำอยู่บันทึกผล / ปิดงานได้ตามเดิม
    if p_action in ('issueRods', 'issueOrderParts', 'requestRods') and exists (
         select 1 from public.bom_orders o
         where o.is_test = (select private.bom_test_mode()) and o.sales_cancel_at is not null and o.sales_cancel_choice is null
           and o.status in ('released', 'in_progress')
           and ((p_action = 'issueRods'
                 and o.pi_no in (select upper(btrim(coalesce(r.value ->> 'forOrderId', '')))
                                 from jsonb_array_elements(coalesce(p_changes #> '{rodMoves,upsert}', '[]'::jsonb)) as r))
                or (p_action = 'issueOrderParts'
                    and o.pi_no in (select upper(btrim(coalesce(r.value ->> 'orderId', '')))
                                    from jsonb_array_elements(coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb)) as r))
                or (p_action = 'requestRods'
                    and o.id in (select j.order_pk from public.bom_jobs j
                                 join jsonb_array_elements(coalesce(p_changes #> '{rodRequests,upsert}', '[]'::jsonb)) as r on j.job_no = r.value ->> 'jobId'
                                 where j.is_test = (select private.bom_test_mode()))))) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- ใบที่ฝ่ายขายยกเลิกกลางทาง (รอตัดสิน หรือผลิตต่อจนจบ): คลังสินค้าส่งมอบให้ลูกค้าของใบไม่ได้ (ของที่รับเข้าเป็นสต็อกสินค้าสำเร็จรูปเมื่อเลือกผลิตต่อ)
    if p_action = 'deliverFg' and exists (
         select 1 from public.bom_orders o
         where o.is_test = (select private.bom_test_mode()) and o.sales_cancel_at is not null
           and o.pi_no in (select upper(btrim(coalesce(r.value ->> 'orderId', '')))
                           from jsonb_array_elements(coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb)) as r)) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- สต็อกสินค้าสำเร็จรูป: แถว transfer (ปล่อยผลิต) / untransfer (ยกเลิก / เปิดกลับ) ที่ตัวเขียนใบเขียนเอง นับเป็น fgMoves (ส่วน fgMoves ไม่มากับ action ของใบ)
    v_fg_orders_n := coalesce((v_res ->> 'fgMoves')::integer, 0);
    if v_fg_orders_n > 0 then v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', v_fg_orders_n)); end if;
    -- คลังแท่งยาว SR: แถว transfer ที่ตัวเขียนใบเขียนเอง (ปล่อยผลิตหยิบจากสต็อกกลาง / เปิดกลับเป็นร่างคืน) นับเป็น rodMoves
    v_rod_orders_n := coalesce((v_res ->> 'rodMoves')::integer, 0);
    if v_rod_orders_n > 0 then v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', v_rod_orders_n)); end if;
    perform private.bom_delete_jobs(v_planner, coalesce(p_changes #> '{jobs,delete}', '[]'::jsonb), p_base_version, v_version);
    v_jobs := private.bom_save_jobs(v_actor, v_actor_name, v_planner, p_action, coalesce(v_std #> '{jobs,upsert}', '[]'::jsonb),
                                    v_released, p_base_version, v_version);
    -- เปิดงานเพิ่มจากฝ่ายขายแก้ใบ (20261226010000): งานใหม่ / เพิ่มยอดแผน + ผลระเบิดใหม่ของใบ (WO ที่ยังวางแผนอยู่เพิ่มยอดตาม) แล้วเปิด WO ให้เฉพาะงาน RB ที่คำสั่งนี้สร้าง
    if p_action = 'addJobsForChanges' then
      v_res := private.bom_add_change_jobs(v_actor, v_actor_name, v_order_planner, p_changes #> '{orders,upsert}', coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                           p_base_version, v_version);
      v_rf_raised := coalesce(v_res -> 'raised', '[]'::jsonb);
      -- สต็อกที่หยิบให้ส่วนที่เพิ่ม (20261227010000): แถว transfer ของสินค้าสำเร็จรูป / ยางเส้นยาว นับเป็น fgMoves / rodMoves ของบันทึกการใช้งาน
      v_n := coalesce((v_res ->> 'fgMoves')::integer, 0);
      if v_n > 0 then
        v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', coalesce((v_counts #>> '{fgMoves,upsert}')::integer, 0) + v_n));
      end if;
      v_n := coalesce((v_res ->> 'rodMoves')::integer, 0);
      if v_n > 0 then
        v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', coalesce((v_counts #>> '{rodMoves,upsert}')::integer, 0) + v_n));
      end if;
      -- WO เฉพาะงาน RB ที่คำสั่งนี้สร้าง (งาน RB อื่นของใบที่ไม่มี WO ไม่ถูกแตะ: ปิดแล้ว ข้ามตอนปล่อย หรือ WO ถูกยกเลิก)
      v_res := private.bom_open_rf_jobs(v_actor, v_actor_name, (v_res ->> 'orderPk')::uuid,
                                        array(select jsonb_array_elements_text(coalesce(v_res -> 'newRb', '[]'::jsonb))));
      v_rf_opened := v_rf_opened || (v_res -> 'opened');
      v_rf_skipped := v_rf_skipped || (v_res -> 'skipped');
    end if;
    v_started := array(select t.value::uuid from jsonb_array_elements_text(v_jobs -> 'started') as t(value));
    -- ฝ่ายวางแผนปิดงานที่ผูก WO (20261129010000): WO ที่ยกเลิก / หยุดรวมใน rubberflow.cancelled ของคำตอบ และ audit ของ RF แถว bom:closeJob
    v_rf_close_n := jsonb_array_length(v_jobs -> 'cancelled');
    v_rf_cancelled := v_rf_cancelled || (v_jobs -> 'cancelled');
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
    -- คลังยางเส้นยาว SR (20261202010000 · 20261204010000): รับเข้า / ตัดสินล็อตที่กัก / รับนอกใบสั่ง / ย้ายตำแหน่ง (rodLots) และจ่าย / ย้อนจ่าย / ปรับยอด (rodMoves)
    -- ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ · audit นับ rodMoves ตามจำนวนแถวประวัติที่เขียน และ jobs / orders เมื่อการรับเข้าบันทึกยอดให้งาน RB (rodLots นับจากคำขอตามปกติ)
    if p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') then
      v_rod := private.bom_rod_save_lots(v_actor, v_actor_name, v_planner, p_action, p_changes #> '{rodLots,upsert}');
      if (v_rod ->> 'moves')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', (v_rod ->> 'moves')::integer));
      end if;
      if (v_rod ->> 'jobs')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('jobs', jsonb_build_object('upsert', (v_rod ->> 'jobs')::integer));
      end if;
      if (v_rod ->> 'orders')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', (v_rod ->> 'orders')::integer));
      end if;
    elsif p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') then
      v_rod_n := private.bom_rod_save_moves(v_actor, v_planner, p_action, p_changes #> '{rodMoves,upsert}');
      v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', v_rod_n));
    end if;
    -- แปรรูปยาง GR (20261216010000): ตั้งค่า / ขั้นตอนของงาน / ผลรายวัน / ขอเบิกยางเส้นยาว / ส่งงานให้ PK ผ่าน private.bom_gr_save (แถวคำขอเดียว)
    -- ยอดของงาน GR คำนวณใหม่ในธุรกรรมเดียวกัน · audit นับส่วนของคำขอตามปกติ และ jobs / orders เมื่อยอดหรือสถานะของงาน / ใบเปลี่ยน
    if v_gr_section is not null then
      v_gr := private.bom_gr_save(v_actor, v_actor_name, v_planner, p_action, p_changes #> array[v_gr_section, 'upsert'], p_base_version, v_version);
      if (v_gr ->> 'jobs')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('jobs', jsonb_build_object('upsert', (v_gr ->> 'jobs')::integer));
      end if;
      if (v_gr ->> 'orders')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', (v_gr ->> 'orders')::integer));
      end if;
    end if;
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test = (select private.bom_test_mode()) and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปิด (completed · 20261227010000): การแจ้งแก้ใบที่ยังเปิดปิดเอง (decision ack · ผู้ตัดสิน = ระบบ decided_by null เหมือน backfill ข้อ 9: ผู้ที่ปิดใบไม่ได้รับทราบการแจ้ง) ยกเว้นที่เพิ่งเขียนในคำสั่งนี้
    --   ตรวจครั้งเดียวหลังตัวเขียนทั้งหมด (ทุกทางที่ใบเป็น completed อยู่ในคำสั่งนี้: ปล่อยผลิตได้ครบจากสต็อก / รับเข้าครบ / closeOrder / closeOrderShort)
    --   การแจ้งยกเลิกกลางทางที่ยังรอตัดสินไม่ถูกปิด (ฝ่ายวางแผนยังเลือกผลิตต่อกับใบที่ปิดแล้วได้) · นับเป็น orderRequests ของบันทึกการใช้งาน
    update public.bom_order_requests q
    set status = 'done', decision = 'ack', decided_by = null, decided_at = clock_timestamp()
    from public.bom_orders o
    where q.is_test = (select private.bom_test_mode()) and q.status = 'open' and q.kind = 'change'
      and o.id = q.order_pk and o.status = 'completed' and not (q.id = any (v_notices));
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_counts := v_counts || jsonb_build_object('orderRequests', jsonb_build_object('upsert', coalesce((v_counts #>> '{orderRequests,upsert}')::integer, 0) + v_n));
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
      join public.bom_items p on p.is_test = (select private.bom_test_mode()) and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test = (select private.bom_test_mode()) and c.code = l.child_code
      where b.is_test = (select private.bom_test_mode()) and b.status = 'approved'
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
      join public.bom_items p on p.is_test = (select private.bom_test_mode()) and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test = (select private.bom_test_mode()) and b.status = 'approved' and b.item_code = any (v_touched)
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
        join public.bom_boms b on b.is_test = (select private.bom_test_mode()) and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test = (select private.bom_test_mode()) and b.status = 'approved' and b.item_code = w.code
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
  v_rf_n := jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_cancelled) + jsonb_array_length(v_rf_raised);
  if v_rf_n > 0 then
    update public.rf_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode()) returning version into v_rf_version;
    -- แถว audit ละชนิด (ปล่อยผลิต / ยกเลิกใบ / เปิดใบกลับเป็นร่าง) ใช้ version ใหม่ตัวเดียวกัน
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_rf_version::text,
           jsonb_build_object('client_action', k.action, 'version', v_rf_version, 'base_version', v_rf_version - 1,
                              'counts', jsonb_build_object('orders', jsonb_build_object('upsert', k.n)),
                              'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                              'entries', '[]'::jsonb)
    -- เปิดงานเพิ่มจากฝ่ายขายแก้ใบ: WO ที่เปิดใหม่และที่เพิ่มยอดนับรวมแถวเดียว bom:addJobsForChanges
    from (values (1, case when p_action = 'addJobsForChanges' then 'bom:addJobsForChanges' else 'bom:releaseOrder' end, jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_raised)),
                 (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n),
                 (4, 'bom:closeJob', v_rf_close_n)) as k(ord, action, n)
    where k.n > 0
    order by k.ord;
  end if;
  if v_rf_n > 0 or jsonb_array_length(v_rf_skipped) > 0 then
    v_rf_meta := jsonb_build_object('rubberflow', jsonb_build_object(
      'opened', jsonb_array_length(v_rf_opened), 'skipped', jsonb_array_length(v_rf_skipped), 'cancelled', jsonb_array_length(v_rf_cancelled))
      || case when jsonb_array_length(v_rf_raised) > 0 then jsonb_build_object('raised', jsonb_array_length(v_rf_raised)) else '{}'::jsonb end);
  end if;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode());
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit) || v_rf_meta);
  v_delta := private.bom_delta(p_base_version);
  if v_rf_meta <> '{}'::jsonb then
    v_delta := v_delta || jsonb_build_object('rubberflow', jsonb_build_object('opened', v_rf_opened, 'skipped', v_rf_skipped, 'cancelled', v_rf_cancelled)
      || case when jsonb_array_length(v_rf_raised) > 0 then jsonb_build_object('raised', v_rf_raised) else '{}'::jsonb end);
  end if;
  return v_delta;
end;
$$;

-- 9. การแจ้งแก้ใบที่ยังเปิดของใบที่ปิดแล้ว (ข้อมูลทดสอบ): ปิดเป็นรับทราบโดยระบบ (decided_by null) ----------------------------------------------
update public.bom_order_requests q
set status = 'done', decision = 'ack', decided_by = null, decided_at = clock_timestamp()
from public.bom_orders o
where o.id = q.order_pk and o.status = 'completed' and q.status = 'open' and q.kind = 'change';
