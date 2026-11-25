-- ============================================================================
-- BOM โหมดทดสอบ: ใบสั่งผลิตจากฝ่ายขาย (SA) ส่งให้ฝ่ายวางแผน (PP) · ฝ่ายขายแก้ / ยกเลิกใบเองแล้วแจ้งฝ่ายวางแผน · ผู้เขียนใบสั่งผลิตและลูกค้า (โรงงาน ขั้น 8)
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-25, factory-step8-spec · รอบ 2 "Owner round 2" แทนกติกาคำขอยกเลิก / คำขอแก้ใบของรอบแรก):
--   "ต้นทางเอกสารเป็นทางฝ่ายขายเป็นคนเปิดเอกสาร จึงไม่จำเป็นต้องขออนุญาตฝ่ายวางแผนในการขอแก้ไข แต่เป็นการให้ฝ่ายวางแผนรับทราบการแก้ไขมากกว่า"
--   1) ฝ่ายขายแก้ใบได้ทุกสถานะยกเว้นยกเลิก / เสร็จสิ้น · ยังไม่มีแผนกไหนเริ่มงาน = ใบกลับเป็นร่างให้ฝ่ายวางแผนปล่อยใหม่ (กติกาเปิดใบกลับเดิม)
--      เริ่มงานแล้ว = ใบเปลี่ยนทันที (สถานะคงเดิม งานรายแผนกไม่เปลี่ยน ไม่คำนวณใหม่) + แจ้งฝ่ายวางแผน "ฝ่ายขายแก้ใบ" (ค่าเดิม → ค่าใหม่) ให้กด "รับทราบ"
--   2) ทะเบียนลูกค้า: ฝ่ายขายและฝ่ายวางแผน · 3) ฝ่ายวางแผนยังเปิดใบเองได้ (ใบบอกที่มา source)
--   5) ฝ่ายขายยกเลิกพร้อมเหตุผล: ร่าง หรือปล่อยแล้วแต่ยังไม่เริ่มงาน = ยกเลิกทันที + แจ้ง "ฝ่ายขายยกเลิกใบ" (รับทราบ)
--      เริ่มงานแล้ว = ใบหยุดรับงานใหม่ทันที (ยกเลิกโดยฝ่ายขาย รอตัดสิน) แล้วฝ่ายวางแผนเลือก "ผลิตต่อจนจบส่ง WH" (ของที่รับเข้าเป็นสต็อกสินค้าสำเร็จรูป ไม่ส่งลูกค้า)
--      หรือ "หยุด เก็บยางเส้นยาวที่ SR" (ยกเลิกใบตามทางเดิม: ยางเส้นยาวของใบในคลัง SR เป็นสต็อกกลาง · ล็อตที่ RB ส่งแล้วรอรับ SR รับเข้าเป็นสต็อกกลาง)
--   6) ฝ่ายขายทุกคนเห็น / แก้ได้ทุกใบของฝ่ายขาย (ใบบอกผู้เปิด)
--   7) ใบสั่งผลิตและลูกค้าเขียนได้เฉพาะฝ่ายขาย ฝ่ายวางแผน ผู้จัดการ (ผู้ช่วยผู้จัดการโรงงาน ผู้จัดการโรงงาน ผู้จัดการทั่วไป) และ admin
--      ผู้จัดการแผนกในสายผลิต (private.bom_production_depts) ไม่อยู่ในกลุ่มนี้แล้ว · สิทธิ์อื่นของผู้จัดการแผนกคงเดิม (private.bom_can_edit ไม่เปลี่ยน)
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และ private.bom_actor() (นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY)
--
-- ข้อมูล
--   - bom_orders + source ('PP' | 'SA' · ใบเดิมทั้งหมด = 'PP') · sent_at / sent_by (ฝ่ายขายส่งให้ฝ่ายวางแผน ตั้งครั้งเดียว · มีได้เฉพาะใบ 'SA')
--     ใบของฝ่ายขายที่ยังไม่ส่ง = draft + sent_at null (หน้าของฝ่ายวางแผนซ่อนเอง) · สถานะของใบไม่เพิ่ม (CHECK เดิม)
--     + sales_cancel_at / sales_cancel_by / sales_cancel_reason (3-200) = ฝ่ายขายยกเลิกใบที่เริ่มงานแล้ว (สถานะคงเดิม) · sales_cancel_choice = ฝ่ายวางแผนเลือก
--       'continue' (ผลิตต่อจนจบส่ง WH) / 'stop' (หยุด = ใบ cancelled) · null = รอตัดสิน · มีได้เฉพาะใบ 'SA'
--   - ตารางใหม่ bom_order_requests = การแจ้งฝ่ายวางแผนของฝ่ายขาย (เซิร์ฟเวอร์เขียนเองตอนฝ่ายขายแก้ / ยกเลิก · client ไม่ส่งแถวนี้)
--     kind change (ฝ่ายขายแก้ใบที่เริ่มงานแล้ว · reason = สรุปค่าเดิม → ค่าใหม่ 3-300) | cancel (ฝ่ายขายยกเลิกใบที่ส่งแล้ว · reason = เหตุผลยกเลิก 3-200)
--     status open | done · decision (เมื่อ done) ack = รับทราบ · continue / stop = ทางเลือกของใบที่ยกเลิกกลางทาง (เฉพาะ kind cancel) · ผู้แจ้ง / เวลา · ผู้ตัดสิน / เวลา
--     การแจ้งยกเลิกที่ยังเปิดต่อใบได้หนึ่งรายการ (unique index บางส่วน) · แจ้งแก้ใบเปิดพร้อมกันได้หลายรายการ (แก้หลายครั้ง)
--     RLS เปิด ไม่มี grant ให้ anon / authenticated (เขียน / อ่านผ่าน app_bom_* เท่านั้น) · is_test + sandbox_row_scope + bom_stamp_version + lab_only_guard_table
--     · อยู่ใน private.sandbox_unguarded_tables() และ app_sandbox_purge_bom (ลบก่อน bom_orders)
--
-- ใคร (ฟังก์ชันใหม่ search_path = '' · revoke all from public, anon, authenticated)
--   private.bom_can_sell(employee) = แผนก SA ทุกบทบาท · private.bom_can_plan_orders(employee) = แผนก PP ทุกบทบาท หรือ assistant_factory_manager / factory_manager /
--   general_manager / admin · private.bom_can_order(employee) = สองข้อแรกข้อใดข้อหนึ่ง (ผู้เขียนใบสั่งผลิตและลูกค้า)
--   app_bom_save_master: ด่านหยาบเพิ่มทางของฝ่ายขาย (private.bom_sales_actions) · ส่วน customers = bom_can_order · ตัวเขียนใบได้ p_planner = bom_can_plan_orders
--
-- action (ชื่อใน private.bom_client_actions · ฝ่ายขายเรียกได้เฉพาะใน private.bom_sales_actions)
--   createOrder / addOrderItem / removeOrderItem / updateOrderItem / updateOrderHeader / cancelOrder / saveCustomer / sendOrderToPlanning: แถวของใบในส่วน orders
--     (ตัวเขียนตรวจรายช่องตามเดิม · action เป็นแค่ด่านหยาบ) · updateOrderHeader / sendOrderToPlanning เป็นชื่อใหม่
--   ฝ่ายขาย (ไม่ใช่กลุ่มวางแผนของใบสั่งผลิต) ในตัวเขียนใบ private.bom_save_orders (ไม่ผ่าน = BOM_FORBIDDEN):
--     ใบใหม่ได้ source 'SA' · ไม่มีกำหนดเสร็จรายแผนก (due {} dueDefaults []) ผลระเบิด และยอดที่ใช้จากสต็อก · ชุดสีของบรรทัด = ชุดสีในรหัสสินค้า
--     ใบเดิม: เฉพาะ source 'SA' · แก้ลูกค้า ประเทศ ประเภท วันส่งมอบคลัง หมายเหตุ และรายการสินค้า (จำนวน / หมายเหตุ · บรรทัดใหม่ชุดสีตามรหัส บรรทัดเดิมชุดสีเดิม)
--     · ห้ามแก้วันที่สั่งผลิต กำหนดเสร็จรายแผนก ผลระเบิด (ล้างเป็น null ได้ ตอนแก้สินค้า) ยอดที่ใช้จากสต็อก (ยกเว้นผลของการแก้สินค้า: คีย์ของสินค้าที่ลบออก / ลดลงเท่าจำนวนสั่งใหม่)
--     · สถานะ: draft → cancelled (เหตุผล 3-200) · released / in_progress → draft (เปิดกลับ ห้ามเมื่อเริ่มงาน กติกาเดิม) · released / in_progress → cancelled
--       (เฉพาะใบที่ยังไม่เริ่มงาน private.bom_order_locked = false · เริ่มแล้ว = BOM_INVALID_TRANSITION ให้ใช้ salesCancelReason) · อื่น ๆ (ปล่อยผลิต) = BOM_FORBIDDEN
--     · แก้ใบที่เริ่มงานแล้ว (released / in_progress ที่ private.bom_order_locked · สถานะเท่าเดิม): ผลระเบิดต้องเท่าเดิม ใบต้องไม่ถูกฝ่ายขายยกเลิกไว้
--       (ไม่งั้น BOM_INVALID_TRANSITION) · ลดจำนวนสั่งของสินค้าต่ำกว่าที่ส่งมอบลูกค้าแล้ว (ส่งมอบสุทธิ) หรือลบสินค้านั้น = BOM_FG_EXCEEDS
--       (กติกาเดียวกับการส่งมอบ: ของที่ส่งให้ลูกค้าแล้วถอนไม่ได้ · ลดต่ำกว่าที่ WH รับเข้าแล้วได้ ส่วนเกินเป็นสต็อกสินค้าสำเร็จรูปตาม private.bom_fg_free)
--       งานรายแผนก ยอดที่ใช้จากสต็อก และสต็อกที่หยิบไว้ไม่เปลี่ยน · เขียนการแจ้ง kind change (private.bom_sa_change_summary) ผู้แจ้ง = ฝ่ายขาย
--     · ยกเลิกใบที่เริ่มงานแล้ว: แถวใบสถานะเท่าเดิม + salesCancelReason 3-200 (ไม่มีช่องอื่นเปลี่ยน · ไม่งั้น BOM_INVALID_TRANSITION · ใบยังไม่เริ่ม = BOM_INVALID_TRANSITION)
--       = ตั้ง sales_cancel_* (เวลา / ผู้ เซิร์ฟเวอร์ตั้ง ครั้งเดียว ค่าของ client หลังจากนั้นถูกเมิน) + การแจ้ง kind cancel · ผู้อื่นส่ง salesCancelReason = BOM_FORBIDDEN
--     · ยกเลิกทันที (ร่างที่ส่งแล้ว / ปล่อยแล้วยังไม่เริ่ม) เขียนการแจ้ง kind cancel ด้วย (ร่างที่ยังไม่เคยส่งไม่แจ้ง)
--   ใบที่ฝ่ายขายยกเลิกกลางทาง: เปิดกลับเป็นร่างไม่ได้ (BOM_INVALID_TRANSITION) · ระหว่างรอตัดสินไม่รับงานใหม่ใน app_bom_save_master: issueRods (จ่ายยางเส้นยาวให้ใบ)
--     issueOrderParts (เบิกของซื้อให้ใบ) requestRods (GR ขอเบิกยางเส้นยาวของใบ) = BOM_INVALID_TRANSITION · deliverFg ของใบที่ฝ่ายขายยกเลิก (รอตัดสิน / ผลิตต่อ) = BOM_INVALID_TRANSITION
--     ทางเลือกผลิตต่อ: private.bom_fg_free นับจำนวนสั่ง = 0 (เหมือนใบที่ยกเลิก) ของที่ใบมีอยู่และรับเข้าต่อจากนี้จึงเป็นสต็อกสินค้าสำเร็จรูปที่ใบอื่นใช้ได้
--     ทางเลือกหยุด: ยกเลิกใบตามทางเดิม (คืนสต็อกที่หยิบ ยกเลิก WO · ถังยางเส้นยาวของใบที่ยกเลิกเป็นสต็อกกลาง · ล็อตรอรับ SR รับเข้าเป็นสต็อกกลาง private.bom_rod_credit)
--       · ฝ่ายวางแผนยกเลิกใบที่รอตัดสินตรง ๆ = เลือกหยุดเช่นกัน (sales_cancel_choice = 'stop')
--   ส่วน orderRequests (แถวเดียว · ผิดรูป / ส่วนไม่ตรง action = BOM_INVALID_REQUEST) ตัวเขียน private.bom_save_order_request:
--     decideOrderRequest {id, decision ack | continue | stop}: กลุ่มวางแผนของใบสั่งผลิตเท่านั้น · การแจ้งต้อง open (ไม่ใช่ = BOM_INVALID_TRANSITION · ชนรุ่น = BOM_STALE)
--       ack = แจ้งแก้ใบ หรือแจ้งยกเลิกของใบที่ยกเลิกทันที (ใบที่ยกเลิกกลางทางต้องเลือก = BOM_INVALID_REQUEST)
--       continue = ใบที่ยกเลิกกลางทางรอตัดสิน (released / in_progress / completed) → sales_cancel_choice 'continue' (ส่งแถวใบมาได้หนึ่งแถว ไม่มีอะไรเปลี่ยน)
--       stop = ต้องมากับแถวยกเลิกใบ (ส่วน orders แถวเดียว คำสั่งเดียวกัน) ที่เหตุผล = เหตุผลของฝ่ายขาย · ไม่งั้น BOM_INVALID_TRANSITION
--     ใบถูกยกเลิก (ทุกทางในคำสั่งใดก็ได้): การแจ้งอื่นของใบที่ยังเปิดปิดเองใน app_bom_save_master หลังตัวเขียนการแจ้ง (decision ack · แจ้งยกเลิกของใบที่เลือกหยุด = stop
--       ผู้ตัดสิน = ผู้ยกเลิกใบ) ยกเว้นการแจ้งที่เพิ่งเขียนในคำสั่งนี้ จึงไม่มีการแจ้งเก่าค้างบนใบที่ยกเลิกแล้ว
--   บันทึกการใช้งาน: แถว BOM_MASTER_SAVE เดิม (client_action + จำนวนต่อส่วน + entries ของ client เช่น "ฝ่ายขายแก้ใบ" "ฝ่ายขายยกเลิกใบ" "ฝ่ายวางแผนรับทราบ"
--     "ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH" "ฝ่ายวางแผนเลือกหยุดและเก็บยางเส้นยาวที่ SR") · ผู้แจ้ง / ผู้ตัดสิน / ทางเลือกเก็บในแถวการแจ้ง
--   รหัสข้อผิดพลาดใหม่: BOM_INVALID_REQUEST
--
-- รูปเรคอร์ดที่ส่งกลับ: orders + source ('PP' | 'SA') และ sentAt / sentBy (เฉพาะใบที่ส่งแล้ว) · salesCancelAt / salesCancelBy / salesCancelReason / salesCancelChoice
--   (เฉพาะใบที่ฝ่ายขายยกเลิกกลางทาง) · ชุดใหม่ orderRequests
--   [{id, orderId, kind, reason, status, decision, requestedBy, requestedById, requestedAt, decidedBy, decidedAt}] (snapshot / delta ครบ 23 ชุด)
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main)
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint)  จาก 20261202010000_bom_sr_rod_store.sql
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_records(bigint)  จาก 20261224010000_bom_dept_steps.sql
--   - private.bom_delta(bigint)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_client_actions()  จาก 20261224010000_bom_dept_steps.sql
--   - public.app_sandbox_purge_bom()  จาก 20261216010000_bom_gr_module.sql
--   - private.sandbox_unguarded_tables()  จาก 20261225010000_itrp_itas_part_changes.sql
--   - private.bom_fg_free(uuid, text)  จาก 20261130010000_bom_rf_go_live.sql (+ ใบที่ฝ่ายวางแผนเลือกผลิตต่อ นับจำนวนสั่ง = 0)
--   ใหม่: private.bom_can_sell(public.employees), private.bom_can_plan_orders(public.employees), private.bom_can_order(public.employees),
--     private.bom_sales_actions(), private.bom_sa_items_ok(jsonb, jsonb), private.bom_order_locked(uuid), private.bom_sa_change_summary(public.bom_orders, text, text, text, bigint, text, jsonb),
--     private.bom_save_order_request(public.employees, boolean, text, jsonb, uuid[], bigint, bigint)
--   ไม่แตะ: private.bom_can_edit · private.bom_staff_actions · private.bom_save_customers · private.bom_save_jobs · private.bom_real_open() · private.bom_actor()
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ที่ใช้ action / ช่องใหม่ (โมดูล SA) ต้องรอให้ apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge
--   ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของแปดฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   Pilot เก่า + ฐานข้อมูลใหม่ (ใช้ได้): action / ช่องเดิมทำงานเหมือนเดิม (ช่องใหม่ของใบถูกส่งกลับมาแล้วเซิร์ฟเวอร์เมิน · ชุด orderRequests ถูกเมิน)
--     ข้อต่างที่เห็นได้: ผู้จัดการแผนกในสายผลิตยังเห็นปุ่มเปิด / แก้ใบและลูกค้าใน Pilot เก่า แต่ฐานข้อมูลปฏิเสธ (BOM_FORBIDDEN) · ใบของฝ่ายขายยังไม่มี (Pilot เก่าเปิดไม่ได้)
--   Pilot ใหม่ + ฐานข้อมูลเก่า (ไม่รองรับ): action ใหม่ = BOM_INVALID_ACTION / BOM_FORBIDDEN · ฝ่ายขายเปิดใบไม่ได้ · ใบไม่มี source (client ถือเป็น 'PP') · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น · ใบของฝ่ายขายเป็นใบธรรมดาหลัง rollback) ลำดับสำคัญ:
--   1) create or replace แปดฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่)
--   2) drop function private.bom_save_order_request(public.employees, boolean, text, jsonb, uuid[], bigint, bigint),
--      private.bom_sa_change_summary(public.bom_orders, text, text, text, bigint, text, jsonb), private.bom_order_locked(uuid), private.bom_sa_items_ok(jsonb, jsonb),
--      private.bom_sales_actions(), private.bom_can_order(public.employees), private.bom_can_plan_orders(public.employees), private.bom_can_sell(public.employees)
--   3) drop table public.bom_order_requests (การแจ้งทดสอบหายไป)
--   4) alter table public.bom_orders drop constraint bom_orders_sales_cancel_check, drop constraint bom_orders_sent_check, drop column sales_cancel_choice,
--      drop column sales_cancel_reason, drop column sales_cancel_by, drop column sales_cancel_at, drop column sent_by, drop column sent_at, drop column source
-- ============================================================================

-- 1. ใบสั่งผลิต: ที่มาของใบและการส่งให้ฝ่ายวางแผน -------------------------------------------------------------------------------
alter table public.bom_orders
  add column source text not null default 'PP' check (source in ('PP', 'SA')),
  add column sent_at timestamptz,
  add column sent_by uuid references public.employees(id) on delete set null;
alter table public.bom_orders add constraint bom_orders_sent_check check ((sent_at is null and sent_by is null) or source = 'SA');
comment on column public.bom_orders.source is 'ที่มาของใบ: PP = ฝ่ายวางแผนเปิดเอง · SA = ฝ่ายขายเปิด (เซิร์ฟเวอร์ตั้งจากแผนกของผู้เปิด · 20261226010000)';
comment on column public.bom_orders.sent_at is 'เวลาที่ฝ่ายขายส่งใบให้ฝ่ายวางแผน (ครั้งเดียว · null = ยังไม่ส่ง หรือใบของฝ่ายวางแผน)';
-- ฝ่ายขายยกเลิกใบที่เริ่มงานแล้ว (รอบ 2): สถานะของใบคงเดิม · ใบหยุดรับงานใหม่จนฝ่ายวางแผนเลือก continue (ผลิตต่อจนจบส่ง WH) หรือ stop (ใบ cancelled)
alter table public.bom_orders
  add column sales_cancel_at timestamptz,
  add column sales_cancel_by uuid references public.employees(id) on delete set null,
  add column sales_cancel_reason text,
  add column sales_cancel_choice text check (sales_cancel_choice in ('continue', 'stop'));
alter table public.bom_orders add constraint bom_orders_sales_cancel_check check (
  (sales_cancel_at is null and sales_cancel_reason is null and sales_cancel_choice is null)
  or (sales_cancel_at is not null and source = 'SA' and sales_cancel_reason is not null and char_length(sales_cancel_reason) between 3 and 200));
comment on column public.bom_orders.sales_cancel_at is 'เวลาที่ฝ่ายขายยกเลิกใบที่เริ่มงานแล้ว (ครั้งเดียว · null = ไม่ได้ยกเลิกกลางทาง) · sales_cancel_choice null = รอฝ่ายวางแผนตัดสิน';
comment on column public.bom_orders.sales_cancel_choice is 'ทางเลือกของฝ่ายวางแผน: continue = ผลิตต่อจนจบส่ง WH (ของเป็นสต็อกสินค้าสำเร็จรูป ไม่ส่งลูกค้า) · stop = หยุด ยกเลิกใบ (ยางเส้นยาวเป็นสต็อกกลางของ SR)';

-- 2. การแจ้งฝ่ายวางแผนของฝ่ายขาย (ฝ่ายขายแก้ใบที่เริ่มงานแล้ว / ยกเลิกใบ) -------------------------------------------------------------------
create table public.bom_order_requests (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  order_pk uuid not null,
  kind text not null check (kind in ('cancel', 'change')),
  reason text not null check (char_length(reason) between 3 and 300 and (kind <> 'cancel' or char_length(reason) <= 200)),
  status text not null default 'open' check (status in ('open', 'done')),
  decision text check (decision in ('ack', 'continue', 'stop')),
  requested_by uuid references public.employees(id) on delete set null,
  requested_at timestamptz not null default clock_timestamp(),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  unique (id, is_test),
  constraint bom_order_requests_state_check check (
    (status = 'open' and decision is null and decided_at is null)
    or (status = 'done' and decision is not null and decided_at is not null)),
  -- ผลิตต่อ / หยุด เป็นทางเลือกของการแจ้งยกเลิกเท่านั้น · การแจ้งแก้ใบรับทราบอย่างเดียว
  constraint bom_order_requests_decision_check check (decision is null or decision = 'ack' or kind = 'cancel')
);
comment on table public.bom_order_requests is 'การแจ้งฝ่ายวางแผนของฝ่ายขาย: change = ฝ่ายขายแก้ใบที่เริ่มงานแล้ว · cancel = ฝ่ายขายยกเลิกใบ (open -> done: ack รับทราบ / continue ผลิตต่อ / stop หยุด) · เซิร์ฟเวอร์เขียนใน app_bom_save_master (ตัวเขียนใบ และ decideOrderRequest) เท่านั้น';
-- การแจ้งยกเลิกที่ยังเปิดต่อใบได้หนึ่งรายการ (ฝ่ายขายยกเลิกใบได้ครั้งเดียว · ดัชนีนี้กันซ้ำอีกชั้น) · แจ้งแก้ใบเปิดพร้อมกันได้หลายรายการ
create unique index bom_order_requests_one_open_idx on public.bom_order_requests (order_pk, is_test) where status = 'open' and kind = 'cancel';
create index bom_order_requests_changed_idx on public.bom_order_requests (is_test, changed_version);
create index bom_order_requests_order_idx on public.bom_order_requests (order_pk, is_test);

-- แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ฟังก์ชัน trigger เดิมของ 20261105010000 แบบเดียวกับตารางของ GR ใน 20261216010000)
create trigger bom_order_requests_sandbox_scope before insert or update or delete on public.bom_order_requests
  for each row execute function private.sandbox_row_scope();
create trigger bom_order_requests_stamp_version before insert or update on public.bom_order_requests
  for each row execute function private.bom_stamp_version();
revoke all on public.bom_order_requests from anon, authenticated;
alter table public.bom_order_requests enable row level security;
create policy bom_order_requests_no_direct_access on public.bom_order_requests for all to authenticated using (false) with check (false);
select private.lab_only_guard_table('public.bom_order_requests');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว: private.sandbox_unguarded_tables() จาก 20261225010000_itrp_itas_part_changes.sql ทุกชื่อ (+ bom_order_requests ต่อท้ายชุด BOM)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers','bom_order_requests',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions','itrp_part_changes',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log','itas_admins']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 3. ใครเขียนใบสั่งผลิตและลูกค้า ------------------------------------------------------------------------------------------------
-- ฝ่ายขาย: แผนก SA ทุกบทบาท
create or replace function private.bom_can_sell(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_employee) = 'SA', false)
$$;
revoke all on function private.bom_can_sell(public.employees) from public, anon, authenticated;

-- กลุ่มวางแผนของใบสั่งผลิต: แผนก PP ทุกบทบาท หรือ ผู้ช่วยผู้จัดการโรงงาน / ผู้จัดการโรงงาน / ผู้จัดการทั่วไป / admin (ทุกแผนก)
-- = private.bom_can_edit ที่ไม่มีผู้จัดการแผนกในสายผลิต (คำตอบเจ้าของข้อ 7 · เฉพาะใบสั่งผลิตและลูกค้า)
create or replace function private.bom_can_plan_orders(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_employee) = 'PP', false)
      or coalesce(private.employee_role_code(p_employee.id) in
           ('assistant_factory_manager', 'factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.bom_can_plan_orders(public.employees) from public, anon, authenticated;

-- ผู้เขียนใบสั่งผลิตและลูกค้า: ฝ่ายขาย หรือกลุ่มวางแผนของใบสั่งผลิต
create or replace function private.bom_can_order(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.bom_can_sell(p_employee) or private.bom_can_plan_orders(p_employee)
$$;
revoke all on function private.bom_can_order(public.employees) from public, anon, authenticated;

-- action ที่ฝ่ายขายเรียกได้ (ด่านหยาบของ app_bom_save_master · สิทธิ์จริงตรวจรายส่วนและรายช่อง)
create or replace function private.bom_sales_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['createOrder', 'addOrderItem', 'removeOrderItem', 'updateOrderItem', 'updateOrderHeader', 'cancelOrder', 'saveCustomer',
    'sendOrderToPlanning']
$$;
revoke all on function private.bom_sales_actions() from public, anon, authenticated;

-- ชุดสีของบรรทัดสินค้าที่ฝ่ายขายส่ง: บรรทัดเดิม (รหัสเดียวกัน) = ชุดสีเดิม · บรรทัดใหม่ = ชุดสีในรหัสสินค้า (ตัวอักษรเดียวท้าย -X เหมือน parseFgCode ของ modules/bom-rules.js · ไม่มี = '')
create or replace function private.bom_sa_items_ok(p_old jsonb, p_new jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
    from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) as n(item)
    where coalesce(n.item ->> 'colorSet', '') is distinct from coalesce(
            (select o.item ->> 'colorSet' from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) as o(item)
             where o.item ->> 'fgCode' = n.item ->> 'fgCode' limit 1),
            substring(n.item ->> 'fgCode' from '-([A-Z])$'), ''))
$$;
revoke all on function private.bom_sa_items_ok(jsonb, jsonb) from public, anon, authenticated;

-- 4. รายการ action ------------------------------------------------------------------------------------------------------------------
-- private.bom_client_actions() จาก 20261224010000_bom_dept_steps.sql (+ สาม action ของฝ่ายขาย / การแจ้ง: updateOrderHeader sendOrderToPlanning decideOrderRequest)
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
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods', 'receiveRodsOpening', 'setRodLocation',
    'saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover',
    'sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh',
    'updateOrderHeader', 'sendOrderToPlanning', 'decideOrderRequest']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- 4b. ใบที่ "เริ่มงานแล้ว" สำหรับฝ่ายขาย = เปิดกลับเป็นร่าง / ยกเลิกทันทีไม่ได้ตามกติกาเดิม (bom_save_orders: งานเริ่ม · SR จ่ายยางเส้นยาวให้ใบสุทธิ > 0
--     · private.bom_fg_return_stock: ส่งมอบสุทธิ > 0 หรือให้สต็อกใบอื่นสุทธิ > 0) · true = ฝ่ายขายแก้ใบตรง (แจ้งฝ่ายวางแผน) / ยกเลิกกลางทาง
create or replace function private.bom_order_locked(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.bom_started_jobs(p_order)
      or coalesce((select sum(m.qty) from public.bom_rod_moves m
                   where m.is_test = (select private.bom_test_mode()) and m.kind in ('issue', 'unissue') and m.for_order_pk = p_order), 0) < 0
      or exists (select 1 from public.bom_fg_moves m
                 where m.is_test = (select private.bom_test_mode()) and m.order_pk = p_order and m.kind in ('deliver', 'undeliver')
                 group by m.fg_code
                 having sum(case when m.kind = 'deliver' then m.qty else -m.qty end) > 0)
      or exists (select 1 from public.bom_fg_moves m
                 where m.is_test = (select private.bom_test_mode()) and m.from_order_pk = p_order and m.kind in ('transfer', 'untransfer')
                 group by m.fg_code
                 having sum(case when m.kind = 'transfer' then m.qty else -m.qty end) > 0)
$$;
revoke all on function private.bom_order_locked(uuid) from public, anon, authenticated;

-- 4c. สรุปการแก้ใบของฝ่ายขาย (เหตุผลของการแจ้ง kind change): หัวใบที่เปลี่ยน แล้วสินค้าตามลำดับใหม่ (เพิ่ม / จำนวน / หมายเหตุ) แล้วสินค้าที่ลบตามลำดับเดิม
--     คั่นด้วย " · " · วันที่ = วันที่ไทย (Asia/Bangkok) แบบ DD/MM/YYYY · จำนวนตัดศูนย์ท้าย · ยาวเกิน 300 ตัด 299 + "…" · ไม่มีอะไรให้สรุป = "แก้รายการสินค้า"
--     client (modules/bom-actions.js salesChangeSummary) และ harness mock สรุปแบบเดียวกันทุกตัวอักษร
create or replace function private.bom_sa_change_summary(
  p_old public.bom_orders, p_customer text, p_country text, p_type text, p_wh bigint, p_note text, p_items jsonb)
returns text
language sql
stable
set search_path = ''
as $$
  with parts as (
    select 1 as grp, 1 as ord, 'ลูกค้า ' || p_old.customer || ' → ' || p_customer as part where p_old.customer <> p_customer
    union all
    select 1, 2, 'ประเทศ ' || p_old.country || ' → ' || p_country where p_old.country <> p_country
    union all
    select 1, 3, 'ประเภท ' || p_old.order_type || ' → ' || p_type where p_old.order_type <> p_type
    union all
    select 1, 4, 'กำหนดส่งคลัง ' || to_char(to_timestamp(p_old.wh_due / 1000.0) at time zone 'Asia/Bangkok', 'DD/MM/YYYY')
                 || ' → ' || to_char(to_timestamp(p_wh / 1000.0) at time zone 'Asia/Bangkok', 'DD/MM/YYYY')
    where p_old.wh_due <> p_wh
    union all
    select 1, 5, 'แก้หมายเหตุ' where p_old.note <> p_note
    union all
    select 2, n.ord::integer,
           case when o.item is null then 'เพิ่ม ' || (n.item ->> 'fgCode') || ' × ' || trim_scale((n.item ->> 'qty')::numeric)::text
                when (o.item ->> 'qty')::numeric <> (n.item ->> 'qty')::numeric
                  then (n.item ->> 'fgCode') || ' ' || trim_scale((o.item ->> 'qty')::numeric)::text || ' → ' || trim_scale((n.item ->> 'qty')::numeric)::text
                else (n.item ->> 'fgCode') || ' แก้หมายเหตุ' end
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as n(item, ord)
    left join lateral (
      select x.item from jsonb_array_elements(coalesce(p_old.items, '[]'::jsonb)) as x(item) where x.item ->> 'fgCode' = n.item ->> 'fgCode' limit 1) o on true
    where o.item is null or (o.item ->> 'qty')::numeric <> (n.item ->> 'qty')::numeric
       or coalesce(o.item ->> 'note', '') <> coalesce(n.item ->> 'note', '')
    union all
    select 3, x.ord::integer, 'ลบ ' || (x.item ->> 'fgCode') || ' × ' || trim_scale((x.item ->> 'qty')::numeric)::text
    from jsonb_array_elements(coalesce(p_old.items, '[]'::jsonb)) with ordinality as x(item, ord)
    where not exists (select 1 from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) as n(item) where n.item ->> 'fgCode' = x.item ->> 'fgCode')
  ), joined as (
    select coalesce(string_agg(part, ' · ' order by grp, ord), '') as summary from parts
  )
  select case when summary = '' then 'แก้รายการสินค้า'
              when char_length(summary) > 300 then left(summary, 299) || '…'
              else summary end
  from joined
$$;
revoke all on function private.bom_sa_change_summary(public.bom_orders, text, text, text, bigint, text, jsonb) from public, anon, authenticated;

-- 4d. สต็อกสินค้าสำเร็จรูปของใบ: private.bom_fg_free(uuid, text) จาก 20261130010000_bom_rf_go_live.sql
--     + ใบที่ฝ่ายขายยกเลิกกลางทางแล้วฝ่ายวางแผนเลือกผลิตต่อ (sales_cancel_choice = 'continue') นับจำนวนสั่ง = 0 เหมือนใบที่ยกเลิก:
--       ของที่ใบมี (รับเข้าเอง + ได้จากสต็อก) หักที่ให้ใบอื่น / ส่งมอบแล้ว เป็นสต็อกสินค้าสำเร็จรูปที่ใบอื่นใช้ได้ (ใบอื่นหยิบตอนปล่อยผลิต)
create or replace function private.bom_fg_free(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select greatest(0, private.bom_fg_have(o.id, p_code) - private.bom_fg_out(o.id, p_code)
             - greatest(case when o.status = 'cancelled' or o.sales_cancel_choice = 'continue' then 0
                             else coalesce((select sum((it ->> 'qty')::numeric) from jsonb_array_elements(o.items) it where it ->> 'fgCode' = p_code), 0) end,
                        private.bom_fg_total(o.id, p_code, 'deliver')))
    from public.bom_orders o
    where o.is_test = (select private.bom_test_mode()) and o.id = p_order_pk and o.status in ('released', 'in_progress', 'completed', 'cancelled')), 0)
$$;
revoke all on function private.bom_fg_free(uuid, text) from public, anon, authenticated;

-- 5. ตัวเขียนใบสั่งผลิต ---------------------------------------------------------------------------------------------------------------
-- private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261202010000_bom_sr_rod_store.sql
--   p_planner = private.bom_can_plan_orders (เดิม bom_can_edit) · + ฝ่ายขาย (v_seller) · source / sentAt · ใบ 'SA' ที่ยังไม่ส่งปล่อยผลิตไม่ได้ · คืน cancelledOrders (uuid ของใบที่ยกเลิกในคำสั่งนี้)
--   + ฝ่ายขายแก้ใบที่เริ่มงานแล้ว (แจ้ง change) · ยกเลิกทันที / ยกเลิกกลางทาง (salesCancelReason · แจ้ง cancel) · คืน notices (uuid ของการแจ้งที่เขียนในคำสั่งนี้)
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
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened),
                            'fgMoves', v_moves, 'rodMoves', v_rod_moves, 'cancelledOrders', to_jsonb(v_cancelled_orders), 'notices', to_jsonb(v_notices));
end;
$$;

-- 6. ตัวตัดสินการแจ้งของฝ่ายขาย (decideOrderRequest · หนึ่งแถว) · คืนจำนวนใบที่เปลี่ยนในตัวนี้ (ผลิตต่อ = 1 · อื่น ๆ = 0) ------------------------------------
-- p_planner = private.bom_can_plan_orders ของผู้เรียก · p_cancelled = ใบที่ private.bom_save_orders ยกเลิกในคำสั่งเดียวกัน
-- ลำดับตรวจ: รูปแถว (BOM_INVALID_REQUEST) → สิทธิ์ (BOM_FORBIDDEN) → แถวที่อ้าง → ชนรุ่น (BOM_STALE) → สถานะ (BOM_INVALID_TRANSITION) → กติกา
-- การแจ้งเขียนโดยตัวเขียนใบ (ฝ่ายขายแก้ / ยกเลิก) เท่านั้น · ตัวนี้ปิดการแจ้งด้วย ack (รับทราบ) / continue (ผลิตต่อจนจบส่ง WH) / stop (หยุด เก็บยางเส้นยาวที่ SR)
create or replace function private.bom_save_order_request(
  p_actor public.employees, p_planner boolean, p_action text, p_rows jsonb, p_cancelled uuid[], p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_id text;
  v_decision text;
  v_ord public.bom_orders%rowtype;
  v_req public.bom_order_requests%rowtype;
  v_changed integer := 0;
begin
  if p_action is distinct from 'decideOrderRequest' then raise exception 'BOM_INVALID_REQUEST'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_REQUEST'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_REQUEST'; end if;
  v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_REQUEST'));
  if v_id !~ v_uuid then raise exception 'BOM_INVALID_REQUEST'; end if;
  v_decision := private.bom_text(v_row, 'decision', 10, 1, 'BOM_INVALID_REQUEST');
  if v_decision not in ('ack', 'continue', 'stop') then raise exception 'BOM_INVALID_REQUEST'; end if;

  -- ตัดสินได้ = กลุ่มวางแผนของใบสั่งผลิตเท่านั้น (ฝ่ายขาย ผู้จัดการแผนกในสายผลิต พนักงานแผนกอื่น = BOM_FORBIDDEN)
  if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
  select * into v_req from public.bom_order_requests q where q.is_test = (select private.bom_test_mode()) and q.id = v_id::uuid for update;
  if not found then raise exception 'BOM_INVALID_REQUEST'; end if;
  if v_req.changed_version > p_base and v_req.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  if v_req.status <> 'open' then raise exception 'BOM_INVALID_TRANSITION'; end if;
  select * into v_ord from public.bom_orders o where o.id = v_req.order_pk for update;

  -- แจ้งแก้ใบ: รับทราบอย่างเดียว · แจ้งยกเลิก: ใบที่ยกเลิกทันที (ไม่มี sales_cancel_at) รับทราบ · ใบที่ยกเลิกกลางทางต้องเลือกผลิตต่อ / หยุด
  if (v_req.kind = 'change' and v_decision <> 'ack')
     or (v_req.kind = 'cancel' and ((v_decision = 'ack') = (v_ord.sales_cancel_at is not null))) then
    raise exception 'BOM_INVALID_REQUEST';
  end if;
  if v_decision = 'continue' then
    -- ผลิตต่อจนจบส่ง WH: ใบยังไม่ถูกตัดสิน และยังไม่ถูกยกเลิก (รับเข้า WH ครบจนปิดใบไปก่อนแล้วก็เลือกได้)
    if v_ord.sales_cancel_choice is not null or v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    update public.bom_orders set sales_cancel_choice = 'continue', updated_at = now() where id = v_ord.id;
    v_changed := 1;
  elsif v_decision = 'stop' then
    -- หยุด: ใบต้องถูกยกเลิกในคำสั่งนี้ (แถวยกเลิกใบที่มาด้วย · ตัวเขียนใบตั้งทางเลือก stop ให้แล้ว) ด้วยเหตุผลของฝ่ายขาย
    if not coalesce(v_ord.id = any (p_cancelled), false) or v_ord.status <> 'cancelled' or v_ord.sales_cancel_choice is distinct from 'stop'
       or v_ord.cancel_reason is distinct from v_ord.sales_cancel_reason then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
  end if;
  update public.bom_order_requests
  set status = 'done', decision = v_decision, decided_by = p_actor.id, decided_at = clock_timestamp()
  where id = v_req.id;
  return v_changed;
end;
$$;
revoke all on function private.bom_save_order_request(public.employees, boolean, text, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 7. ชุดเรคอร์ด -------------------------------------------------------------------------------------------------------------------
-- private.bom_records(bigint) จาก 20261224010000_bom_dept_steps.sql (orders + source / sentAt / sentBy · ชุดใหม่ orderRequests)
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
          'createdBy', coalesce(private.bom_person(o.created_by), ''), 'createdAt', private.bom_ms(o.created_at), 'source', o.source)
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

-- private.bom_delta(bigint) จาก 20261216010000_bom_gr_module.sql (+ ชุด orderRequests)
create or replace function private.bom_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.bom_master_state s where s.is_test = (select private.bom_test_mode())), 0),
    'epoch', (select s.epoch from public.bom_master_state s where s.is_test = (select private.bom_test_mode())),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object(
        'upsert', r.records -> l.list,
        'delete', case
          when l.list in ('colorSets', 'packages') then coalesce((
            select jsonb_agg(jsonb_build_object('base', k.base, 'code', k.code) order by k.base collate "C", k.code collate "C")
            from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = l.list and k.changed_version > p_since), '[]'::jsonb)
          when l.list = 'jobs' then coalesce((
            select jsonb_agg(jsonb_build_object('id', k.code, 'code', k.code) order by k.code collate "C")
            from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.changed_version > p_since), '[]'::jsonb)
          else '[]'::jsonb end))
      from (values ('items'), ('compounds'), ('colors'), ('colorSets'), ('packages'), ('boms'), ('processes'), ('routings'),
                   ('customers'), ('orders'), ('jobs'), ('stock'), ('stockMoves'), ('fgMoves'), ('rodLots'), ('rodMoves'),
                   ('grConfig'), ('grPlans'), ('grRecords'), ('rodRequests'), ('grHandovers'), ('grWorkers'), ('orderRequests')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;

-- 8. RPC บันทึก ------------------------------------------------------------------------------------------------------------------
-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261216010000_bom_gr_module.sql
--   (+ ผู้เขียนใบสั่งผลิต / ลูกค้า: private.bom_can_order · ด่านหยาบของฝ่ายขาย · ส่วน orderRequests กับตัวเขียน private.bom_save_order_request)
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
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_order_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
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
    v_jobs := private.bom_save_jobs(v_actor, v_actor_name, v_planner, p_action, coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb),
                                    v_released, p_base_version, v_version);
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
  v_rf_n := jsonb_array_length(v_rf_opened) + jsonb_array_length(v_rf_cancelled);
  if v_rf_n > 0 then
    update public.rf_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode()) returning version into v_rf_version;
    -- แถว audit ละชนิด (ปล่อยผลิต / ยกเลิกใบ / เปิดใบกลับเป็นร่าง) ใช้ version ใหม่ตัวเดียวกัน
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    select private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_rf_version::text,
           jsonb_build_object('client_action', k.action, 'version', v_rf_version, 'base_version', v_rf_version - 1,
                              'counts', jsonb_build_object('orders', jsonb_build_object('upsert', k.n)),
                              'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                              'entries', '[]'::jsonb)
    from (values (1, 'bom:releaseOrder', jsonb_array_length(v_rf_opened)), (2, 'bom:cancelOrder', v_rf_cancel_n), (3, 'bom:reopenOrder', v_rf_reopen_n),
                 (4, 'bom:closeJob', v_rf_close_n)) as k(ord, action, n)
    where k.n > 0
    order by k.ord;
  end if;
  if v_rf_n > 0 or jsonb_array_length(v_rf_skipped) > 0 then
    v_rf_meta := jsonb_build_object('rubberflow', jsonb_build_object(
      'opened', jsonb_array_length(v_rf_opened), 'skipped', jsonb_array_length(v_rf_skipped), 'cancelled', jsonb_array_length(v_rf_cancelled)));
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
    v_delta := v_delta || jsonb_build_object('rubberflow', jsonb_build_object('opened', v_rf_opened, 'skipped', v_rf_skipped, 'cancelled', v_rf_cancelled));
  end if;
  return v_delta;
end;
$$;

-- 9. ล้างข้อมูล BOM ทดสอบ: public.app_sandbox_purge_bom() จาก 20261216010000_bom_gr_module.sql (+ bom_order_requests ลบก่อน bom_orders)
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
    'bom_order_requests', 'bom_gr_records', 'bom_gr_handovers', 'bom_rod_requests', 'bom_gr_job_plans', 'bom_gr_config',
    'bom_rod_moves', 'bom_rod_lots', 'bom_fg_moves', 'bom_stock_moves', 'bom_stock', 'bom_jobs', 'bom_orders', 'bom_customers', 'bom_bom_lines', 'bom_boms', 'bom_routings', 'bom_color_sets', 'bom_packages',
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
