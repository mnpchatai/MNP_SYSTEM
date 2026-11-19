-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: คลังแท่งยาว SR (ขั้น 05-06 ของผังงานโรงงาน) รับแท่งยาวจาก RB เข้าคลังรายล็อต ตรวจมิติ กัก / ตัดสิน จ่ายให้ GR ตามใบสั่งผลิต
--
-- ทำไม (เจ้าของโรงงาน 2026-11-18, sr-store-rules): แท่งยาวที่ RB ผลิตเพื่องาน BOM ไม่ใช่สินค้าสำเร็จรูปที่ WH ส่งลูกค้า แต่เข้าคลัง SR แล้วจ่ายให้ GR
--   เดิม (#333 / 20261116010000) ล็อตตกแต่งของ WO ที่ผูกงาน BOM สร้างกล่อง rf_fg_boxes (พร้อมส่ง) และป้อนยอดให้งาน RB ทันทีที่ตกแต่งผ่าน (ผลตรวจรอบ N8)
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และกลไก bom_actor / rf_actor
--
-- กติกา (ยืนยันกับผู้ใช้ 2026-11-18)
--   1) สต็อกนับรายล็อต (หนึ่งล็อต = ล็อตตกแต่งหนึ่งล็อตของ RubberFlow ย้อนกลับได้ทาง rf_lots) จ่ายเสนอล็อตเก่าก่อน (received_at แล้วเลขล็อต)
--   2) SR วัดมิติตอนรับเข้า: ไม่ผ่าน = ล็อตถูกกัก (held: อยู่ในคลัง จ่ายไม่ได้ ไม่นับ) QA (หรือกลุ่มวางแผน) ตัดสิน ยอมรับ / ส่งคืน RB / ทิ้ง
--   3) งาน RB ของใบสั่งผลิตนับยอดเมื่อแท่งเข้าคลังแบบยอมรับแล้วเท่านั้น (รับเข้าผ่าน หรือ QA ยอมรับ) ไม่ใช่ตอนตกแต่งผ่านแล้ว
--   4) SR จ่ายแท่งให้ GR ตามใบสั่งผลิตพร้อมจำนวน · แท่งที่เกินความต้องการของใบเป็นสต็อกกลาง · กลุ่มวางแผนตั้ง "ใช้จากคลัง SR" ของใบร่าง
--      (stockCounts[รหัส RB]) ลดสิ่งที่ RB ต้องผลิต และหยิบจริงตอนปล่อยผลิต
--
-- ตารางใหม่ (แยกโหมดด้วย is_test · trigger *_sandbox_scope + *_stamp_version · RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only
--   + private.sandbox_unguarded_tables() + ล้างโดย app_sandbox_purge_bom ก่อน bom_orders)
--   - bom_rod_lots: หนึ่งแถวต่อล็อตตกแต่งของ WO ที่ผูกงาน BOM สถานะ pending -> stored | held -> stored | returned | scrapped
--   - bom_rod_moves: ประวัติต่อท้ายของสต็อกที่จ่ายได้ (ล็อต held / returned / scrapped ไม่มีแถว) qty มีเครื่องหมายเป็นค่าเปลี่ยนของ "ถัง"
--     ถัง = (ล็อต, owner_order_pk) owner null = สต็อกกลาง · ยอดถังห้ามติดลบ (ตรวจในตัวเขียนใต้ล็อกแถวล็อต)
--     สต็อกกลางของรหัส RB = ผลรวมถังที่ owner null หรือใบเจ้าของ completed / cancelled (ใบที่ปิดคืนของเหลือโดยไม่ต้องมีแถว)
--
-- RubberFlow: ล็อตตกแต่งของ WO ที่ source_job_no ตรงกับ bom_jobs (โหมดเดียวกัน) ไม่สร้างกล่อง (boxes = 0, perBox ไม่บังคับ) และไม่เรียก rf_apply_feedback
--   เมื่อ qc เป็น pass (ตอนบันทึก หรือ QA ตัดสิน pass ครั้งแรก = counted_to_order false -> true เหมือนเดิม) สร้าง bom_rod_lots สถานะ pending
--   (เฉพาะเมื่องานยังผูก WO นี้: external_ref.woId = เลข WO เหมือน rf_apply_feedback เดิม) qty_sent = good_qty spec = extrusion_spec ของ revision สูตรของ WO · rf_add_produced (ความคืบหน้า WO) เหมือนเดิม · WO ที่ไม่ผูกงาน (ขายเป็นสินค้า) เหมือนเดิมทุกอย่าง
--   app_rf_save นับล็อตที่สร้างเป็น rodLots ของ BOM (เพิ่มตัวนับ BOM หนึ่งครั้ง และ audit BOM_MASTER_SAVE 'rubberflow:<action>' counts.rodLots)
--
-- action ใหม่ของ app_bom_save_master (ส่วน rodLots / rodMoves upsert เท่านั้น · ส่วนกับ action ต้องคู่กัน ผิด / ว่าง = BOM_INVALID_ROD)
--   receiveRods (SR หรือกลุ่มวางแผน) rodLots [{id, qtyReceived, qc:{values:{thickness?,width?,weightPerM?}, result, note}}] หนึ่งแถว ล็อต pending
--     0 < qtyReceived <= qty_sent · values > 0 · มี spec: ทุกคีย์ของ spec ต้องมีค่า และ result ต้องเท่ากับผลคำนวณ (pass เมื่อทุก |ค่า - target| <= tol)
--     ไม่มี spec: result (pass | fail) คือการตัดสินด้วยตาของ SR บังคับ · note <= 300 (fail ต้อง >= 3) · pass = stored + เครดิต · fail = held
--   decideRods (QA หรือกลุ่มวางแผน) rodLots [{id, decision, decisionNote 3-300}] ล็อต held · accept = stored + เครดิต · return = returned · scrap = scrapped
--   เครดิต (private.bom_rod_credit): ใบ released / in_progress และงานยังไม่ done: owned = min(q, max(qty_planned - qty_done, 0)) เข้าถังของใบ ส่วนเกินเข้าสต็อกกลาง
--     qty_done += q + รายงานแบบ rf_apply_feedback ใบ released -> in_progress · ไม่เช่นนั้นเข้าสต็อกกลางทั้งหมด งานไม่ถูกแตะ
--   issueRods (SR หรือกลุ่มวางแผน) rodMoves 1-50 แถว {id, kind:'issue', lotId, ownerOrderId, forOrderId, itemCode, qty < 0} ทั้งหมดหรือไม่เลย
--   reverseRodIssue (SR หรือกลุ่มวางแผน) rodMoves [{id, kind:'unissue', reversesId, note 3-300}] ย้อนได้ครั้งเดียวต่อแถว issue
--   adjustRods (กลุ่มวางแผนเท่านั้น) rodMoves [{id, kind:'adjust', lotId, qty (มีเครื่องหมาย <> 0), note 3-300}] เฉพาะสต็อกกลาง
--   ปล่อยผลิต: stockCounts[รหัสของบรรทัดผลระเบิดชนิด RB ของใบ] = n > 0 หยิบ n จากสต็อกกลางล็อตเก่าก่อน (ถัง owner null ก่อน แล้วใบที่ปิดตาม released_at)
--     ต่อถังต้นทางสองแถว transfer (-k ถังต้นทาง, +k ถังของใบ) for_order_pk = ใบ · ไม่พอ = BOM_ROD_EXCEEDS ทั้งคำสั่งไม่เขียน
--     คีย์รหัส RB นี้ตั้ง / แก้ได้เฉพาะกลุ่มวางแผน: ST / WH ที่นับใบร่างได้ แก้ได้เฉพาะคีย์ที่เป็นบรรทัดผลระเบิดของใบที่ไม่ใช่ RB และไม่ใช่สินค้าของใบ
--     (ใบที่ยังไม่มีผลระเบิด หรือรหัสนอกผลระเบิด = BOM_FORBIDDEN)
--   เปิดกลับเป็นร่าง: คืน min(transfer สุทธิที่ใบนี้หยิบ, ยอดถังของใบ) ต่อล็อตกลับสต็อกกลาง · ยกเลิกไม่ต้องทำอะไร (ถังของใบที่ยกเลิกเป็นสต็อกกลางเอง)
--     SR จ่ายแท่งตามใบนี้แล้ว (issue + unissue สุทธิ for_order = ใบนี้ ยังค้าง) = นับว่างานเริ่มแล้ว เปิดกลับไม่ได้ (BOM_INVALID_TRANSITION)
--   รหัสข้อผิดพลาดใหม่: BOM_INVALID_ROD, BOM_ROD_EXCEEDS (ใช้ BOM_FORBIDDEN / BOM_INVALID_TRANSITION / BOM_CONFLICT เดิมด้วย)
--   สิทธิ์อ่าน: แผนก QA และ SR อ่าน BOM ได้ (private.bom_can_read) · สิทธิ์อ่าน RubberFlow ไม่เปลี่ยน
--
-- รูปเรคอร์ดที่ส่งกลับ (snapshot / delta เป็นสิบหกชุดเสมอ ชุดที่ Pilot รุ่นก่อนไม่รู้จักถูกเมิน · ชุด delete เป็น [] เสมอ)
--   rodLots  { id (uuid), lotNo, itemCode, orderId (เลข PI), jobNo, woNo, recipeCode, uom, qtySent, spec, status, qtyReceived, qc, receivedBy, receivedAt,
--              decision, decisionNote, decidedBy, decidedAt, createdAt } ช่องที่ยังไม่มีค่าเป็น null · เรียงตามเวลาสร้างแล้วเลขล็อต
--   rodMoves { id (uuid), lotId, itemCode, kind, qty, ownerOrderId (เลข PI | null = สต็อกกลาง), forOrderId (เลข PI | null), reversesId (uuid | null),
--              note, by (ชื่อ), at (ms) } (by / at แบบเดียวกับ fgMoves) · เรียงตามเวลาแล้ว id
--   เลข PI ของใบ (orderId / ownerOrderId / forOrderId) ทั้งในเรคอร์ดและในแถวคำขอ เหมือน fgMoves.orderId
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · เริ่มจากนิยามล่าสุดบน main ทุกตัว)
--   - private.sandbox_unguarded_tables()  จาก 20261121010000_bom_fg_receive_deliver.sql (เพิ่ม bom_rod_lots, bom_rod_moves)
--   - private.bom_client_actions()  จาก 20261128020000_bom_po_partial_fg_reverse.sql (เพิ่มห้า action)
--   - private.bom_staff_actions()  จาก 20261125010000_bom_close_rules.sql (เพิ่ม receiveRods, decideRods, issueRods, reverseRodIssue · adjustRods ไม่อยู่)
--   - private.bom_can_read(public.employees)  จาก 20261130010000_bom_rf_go_live.sql (เพิ่มแผนก QA, SR)
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.bom_records(bigint)  จาก 20261130010000_bom_rf_go_live.sql (เพิ่มชุด rodLots, rodMoves)
--   - private.bom_delta(bigint)  จาก 20261130010000_bom_rf_go_live.sql (เพิ่มชุด rodLots, rodMoves)
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261130010000_bom_rf_go_live.sql
--   - public.app_sandbox_purge_bom()  จาก 20261121010000_bom_fg_receive_deliver.sql (ลบ bom_rod_moves, bom_rod_lots ก่อน bom_fg_moves / bom_orders)
--   ไม่แตะ: private.bom_real_open(), private.bom_actor(), private.rf_actor() (20261201010000) · private.rf_apply_feedback (WO ที่ไม่ผูกงานยังเรียกเหมือนเดิม คืน 0 เสมอ)
--     · private.rf_records (ล็อตตกแต่งของ WO ที่ผูกงานมี boxes = 0 ซึ่งเป็นค่าที่ถูกต้องของคอลัมน์อยู่แล้ว)
--   ใหม่ (security definer · search_path = '' · revoke all from public, anon, authenticated): private.bom_rod_balance, bom_rod_free, bom_rod_owned,
--     bom_rod_wo_linked, bom_rod_lot_create, bom_rod_credit, bom_rod_save_lots, bom_rod_save_moves, bom_rod_take, bom_rod_return
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก action ใหม่และอ่านชุด rodLots / rodMoves จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสิบสองฟังก์ชันที่ replace
--   ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   และตรวจ has_function_privilege (private.* เรียกไม่ได้) relrowsecurity + policy ของสองตารางใหม่
--   Pilot เก่า + ฐานข้อมูลใหม่ (โหมดทดสอบ): ล็อตตกแต่งของ WO ที่ผูกงานไม่มีกล่องและงาน RB ไม่ได้ยอดจนกว่าจะรับเข้าคลัง SR (ซึ่ง Pilot เก่าทำไม่ได้)
--     stockCounts ของรหัส RB บนใบร่าง (เดิมเป็นยอดนับ) ถูกหยิบจากคลัง SR ตอนปล่อยผลิต สต็อกไม่พอ = BOM_ROD_EXCEEDS · ชุดใหม่ถูกเมิน
--   Pilot ใหม่ + ฐานข้อมูลเก่า: action ใหม่ = BOM_INVALID_ACTION / BOM_FORBIDDEN และไม่มีชุด rodLots / rodMoves · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace สิบสองฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่ · app_sandbox_purge_bom รวม revoke / grant ท้ายฟังก์ชัน)
--      งาน RB ที่ได้ยอดจากการรับเข้าคลังคงยอดไว้ · ล็อตตกแต่งที่บันทึกระหว่างนั้นไม่มีกล่อง
--   2) drop function private.bom_rod_return(uuid, uuid), private.bom_rod_take(uuid, jsonb, jsonb, uuid), private.bom_rod_save_moves(public.employees, boolean, text, jsonb),
--      private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb), private.bom_rod_credit(uuid, text, public.bom_rod_lots),
--      private.bom_rod_lot_create(public.rf_lots, public.rf_orders), private.bom_rod_wo_linked(public.rf_orders), private.bom_rod_owned(uuid, text),
--      private.bom_rod_free(text), private.bom_rod_balance(uuid, uuid)
--   3) drop table public.bom_rod_moves แล้ว public.bom_rod_lots (ข้อมูลทดสอบของคลังแท่งยาวหายไป)
-- ============================================================================

-- 1. ตาราง ------------------------------------------------------------------------------------------------------------------------
-- ล็อตแท่งยาวรอรับ / ในคลัง SR: หนึ่งแถวต่อล็อตตกแต่งของ WO ที่ผูกงาน BOM (lot_no = rf_lots.lot_no) · สถานะเปลี่ยนผ่าน app_bom_save_master เท่านั้น
create table public.bom_rod_lots (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  lot_no text not null check (char_length(lot_no) between 1 and 60),
  -- รหัส RB ของงานที่ WO ผูก (bom_jobs.item_code) · ใบ / งาน / WO / สูตร ณ ตอนสร้างล็อต
  item_code text not null check (char_length(item_code) between 1 and 60),
  order_pk uuid not null,
  job_no text not null check (char_length(job_no) between 1 and 40),
  wo_no text not null check (char_length(wo_no) between 1 and 60),
  recipe_code text not null check (char_length(recipe_code) between 1 and 60),
  uom text not null check (char_length(uom) between 1 and 20),
  qty_sent numeric not null check (qty_sent > 0 and qty_sent <= 1000000000),
  -- สำเนา rf_recipes.extrusion_spec ของ revision สูตรของ WO ตอนสร้าง (null = ไม่มีสเปก SR ตัดสินด้วยตา)
  spec jsonb check (spec is null or jsonb_typeof(spec) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'held', 'stored', 'returned', 'scrapped')),
  qty_received numeric check (qty_received is null or (qty_received > 0 and qty_received <= qty_sent)),
  -- { values: {thickness?, width?, weightPerM?}, result: 'pass' | 'fail', note }
  qc jsonb check (qc is null or jsonb_typeof(qc) = 'object'),
  received_by uuid references public.employees(id) on delete set null,
  received_at timestamptz,
  decision text check (decision is null or decision in ('accept', 'return', 'scrap')),
  decision_note text check (decision_note is null or char_length(decision_note) <= 300),
  decided_by uuid references public.employees(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  unique (id, is_test),
  unique (lot_no, is_test),
  constraint bom_rod_lots_state_check check (
    ((decision is null) = (decided_at is null))
    and ((status = 'pending' and qty_received is null and qc is null and received_at is null and decision is null)
         or (status = 'held' and qty_received is not null and qc is not null and received_at is not null and decision is null)
         or (status = 'stored' and qty_received is not null and qc is not null and received_at is not null and (decision is null or decision = 'accept'))
         or (status = 'returned' and qty_received is not null and qc is not null and received_at is not null and decision = 'return')
         or (status = 'scrapped' and qty_received is not null and qc is not null and received_at is not null and decision = 'scrap')))
);
comment on table public.bom_rod_lots is 'ล็อตแท่งยาวของงาน RB ที่รอรับ / อยู่ในคลัง SR (หนึ่งแถวต่อล็อตตกแต่งของ WO ที่ผูกงาน BOM) · สร้างโดย app_rf_save เปลี่ยนสถานะผ่าน app_bom_save_master (receiveRods / decideRods) เท่านั้น ไม่มีสิทธิ์เขียนจาก client';
comment on column public.bom_rod_lots.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู bom_stock.changed_version)';

-- ประวัติของสต็อกที่จ่ายได้: เขียนต่อท้ายโดยเซิร์ฟเวอร์เท่านั้น qty มีเครื่องหมาย = ค่าเปลี่ยนของถัง (lot_id, owner_order_pk) owner null = สต็อกกลาง
create table public.bom_rod_moves (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  lot_id uuid not null,
  item_code text not null check (char_length(item_code) between 1 and 60),
  kind text not null check (kind in ('receive', 'transfer', 'issue', 'unissue', 'adjust')),
  qty numeric not null check (qty <> 0 and qty >= -1000000000 and qty <= 1000000000),
  -- ถังที่แถวนี้เปลี่ยน (null = สต็อกกลาง)
  owner_order_pk uuid,
  -- issue / unissue = ใบที่จ่ายให้ · transfer = ใบที่การโอนนี้รับใช้ (หยิบตอนปล่อยผลิต / คืนตอนเปิดกลับ)
  for_order_pk uuid,
  -- แถว issue ที่แถว unissue นี้ย้อน (ย้อนได้ครั้งเดียว: ดัชนีเฉพาะข้างล่าง)
  reverses_id uuid,
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  -- clock_timestamp: หลายแถวในธุรกรรมเดียวกัน (จ่ายหลายล็อต / หยิบตอนปล่อยผลิต) เรียงตามลำดับที่เขียนจริง
  created_at timestamptz not null default clock_timestamp(),
  foreign key (lot_id, is_test) references public.bom_rod_lots(id, is_test),
  foreign key (owner_order_pk, is_test) references public.bom_orders(id, is_test),
  foreign key (for_order_pk, is_test) references public.bom_orders(id, is_test),
  unique (id, is_test),
  constraint bom_rod_moves_shape_check check (
    (kind = 'receive' and qty > 0 and for_order_pk is null and reverses_id is null)
    or (kind = 'transfer' and for_order_pk is not null and reverses_id is null)
    or (kind = 'issue' and qty < 0 and for_order_pk is not null and reverses_id is null)
    or (kind = 'unissue' and qty > 0 and for_order_pk is not null and reverses_id is not null and reverses_id <> id
        and char_length(btrim(note)) between 3 and 300)
    or (kind = 'adjust' and owner_order_pk is null and for_order_pk is null and reverses_id is null and char_length(btrim(note)) between 3 and 300))
);
-- foreign key คู่กับ is_test แบบเดียวกับ order_pk · purge ลบทั้งตารางในคำสั่งเดียว foreign key ในตารางเดียวกันจึงไม่ขวาง
alter table public.bom_rod_moves add constraint bom_rod_moves_reverses_fkey
  foreign key (reverses_id, is_test) references public.bom_rod_moves(id, is_test);
create unique index bom_rod_moves_reverses_idx on public.bom_rod_moves (reverses_id) where reverses_id is not null;
comment on table public.bom_rod_moves is 'ประวัติสต็อกแท่งยาวที่จ่ายได้ของคลัง SR (receive / transfer / issue / unissue / adjust) ต่อถัง (ล็อต, ใบเจ้าของ) · เขียนผ่าน app_bom_save_master เท่านั้น ไม่มีสิทธิ์เขียนจาก client';
comment on column public.bom_rod_moves.changed_version is 'เวอร์ชันที่เขียนแถวนี้ (ดู bom_stock.changed_version)';

create index bom_rod_lots_changed_idx on public.bom_rod_lots (is_test, changed_version);
create index bom_rod_lots_order_idx on public.bom_rod_lots (order_pk, is_test);
create index bom_rod_moves_changed_idx on public.bom_rod_moves (is_test, changed_version);
create index bom_rod_moves_lot_idx on public.bom_rod_moves (lot_id, is_test);
create index bom_rod_moves_owner_idx on public.bom_rod_moves (owner_order_pk, is_test);
create index bom_rod_moves_for_idx on public.bom_rod_moves (for_order_pk, is_test);
create index bom_rod_moves_item_idx on public.bom_rod_moves (item_code, is_test);

-- แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ฟังก์ชัน trigger เดิมของ 20261105010000)
do $$
declare
  v_table text;
begin
  foreach v_table in array array['bom_rod_lots', 'bom_rod_moves'] loop
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

select private.lab_only_guard_table('public.bom_rod_lots');
select private.lab_only_guard_table('public.bom_rod_moves');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql ทุกชื่อ แล้วเพิ่ม bom_rod_lots, bom_rod_moves · คงชื่อ itwo_* ที่ migration itwo_work_orders ของ repo งานซ่อม IT เพิ่มไว้บน production 20261118093030 ชื่อที่ไม่มีตารางไม่มีผล)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs', 'itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. รายการ action และสิทธิ์อ่าน -------------------------------------------------------------------------------------------------------
-- private.bom_client_actions() จาก 20261128020000_bom_po_partial_fg_reverse.sql (+ ห้า action ของคลังแท่งยาว)
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
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- private.bom_staff_actions() จาก 20261125010000_bom_close_rules.sql (+ สี่ action ของพนักงานแผนก · adjustRods เป็นของกลุ่มวางแผนเท่านั้นจึงไม่อยู่ในรายการนี้)
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- private.bom_can_read(public.employees) จาก 20261130010000_bom_rf_go_live.sql (+ แผนก QA และ SR: SR รับ / จ่ายแท่งยาว QA ตัดสินล็อตที่กัก)
create or replace function private.bom_can_read(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.bom_can_edit(p_employee)
      or coalesce(exists (
           select 1 from public.departments d
           where d.id = p_employee.department_id and d.code in ('RB', 'GR', 'PT', 'BG', 'PK', 'ST', 'WH', 'QA', 'SR')), false)
$$;
revoke all on function private.bom_can_read(public.employees) from public, anon, authenticated;

-- 3. ตัวช่วยของคลังแท่งยาว (private เรียกจากตัวเขียนใน app_bom_save_master / app_rf_save เท่านั้น) ---------------------------------------------
-- ยอดของถัง (ล็อต, เจ้าของ) · เจ้าของ null = สต็อกกลาง
create or replace function private.bom_rod_balance(p_lot_id uuid, p_owner uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_rod_moves m
  where m.is_test = (select private.bom_test_mode()) and m.lot_id = p_lot_id and m.owner_order_pk is not distinct from p_owner
$$;
revoke all on function private.bom_rod_balance(uuid, uuid) from public, anon, authenticated;

-- สต็อกกลางของรหัส RB: ถังที่ไม่มีเจ้าของ หรือใบเจ้าของปิดแล้ว (completed / cancelled)
create or replace function private.bom_rod_free(p_code text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_rod_moves m
  left join public.bom_orders o on o.id = m.owner_order_pk
  where m.is_test = (select private.bom_test_mode()) and m.item_code = p_code
    and (m.owner_order_pk is null or o.status in ('completed', 'cancelled'))
$$;
revoke all on function private.bom_rod_free(text) from public, anon, authenticated;

-- แท่งของรหัส RB ที่อยู่ในถังของใบ
create or replace function private.bom_rod_owned(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_rod_moves m
  where m.is_test = (select private.bom_test_mode()) and m.owner_order_pk = p_order_pk and m.item_code = p_code
$$;
revoke all on function private.bom_rod_owned(uuid, text) from public, anon, authenticated;

-- WO ผูกงาน BOM ไหม: source_job_no ตรงกับงานของโหมดผู้เรียก (WO ขายเป็นสินค้าไม่มี source_job_no)
create or replace function private.bom_rod_wo_linked(p_wo public.rf_orders)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_wo.source_job_no is not null
     and exists (select 1 from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_wo.source_job_no)
$$;
revoke all on function private.bom_rod_wo_linked(public.rf_orders) from public, anon, authenticated;

-- ล็อตตกแต่งที่ผ่านของ WO ที่ผูกงาน = แท่งรอรับเข้าคลัง SR (pending) · ผู้เรียกตรวจว่าล็อตเพิ่งนับเข้า WO (ครั้งเดียว) · คืนจำนวนแถวที่สร้าง (0 / 1)
create or replace function private.bom_rod_lot_create(p_lot public.rf_lots, p_wo public.rf_orders)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_spec jsonb;
  v_n integer;
begin
  if p_wo.source_job_no is null or p_lot.stage is distinct from 'finishing' or coalesce(p_lot.good_qty, 0) <= 0 then
    return 0;
  end if;
  -- ล็อกตัวนับ BOM ก่อนเขียน (เหมือน rf_apply_feedback) แถวใหม่ถูกประทับเวอร์ชันถัดไปที่ app_rf_save เพิ่มให้
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_wo.source_job_no;
  -- งานต้องผูก WO นี้อยู่ (external_ref.woId = เลข WO) เหมือน rf_apply_feedback เดิม · งานที่ผูก WO อื่น = ไม่สร้างล็อตแท่ง
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then return 0; end if;
  select r.extrusion_spec into v_spec from public.rf_recipes r
  where r.is_test = (select private.bom_test_mode()) and r.recipe_code = p_wo.recipe_code and r.revision = p_wo.recipe_revision;
  insert into public.bom_rod_lots (is_test, lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, spec)
  values ((select private.bom_test_mode()), p_lot.lot_no, v_job.item_code, v_job.order_pk, v_job.job_no, p_wo.wo_no, p_wo.recipe_code,
          p_lot.uom, trim_scale(p_lot.good_qty), v_spec)
  on conflict (lot_no, is_test) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.bom_rod_lot_create(public.rf_lots, public.rf_orders) from public, anon, authenticated;

-- เครดิตล็อตที่เข้าคลังแบบยอมรับแล้ว (รับเข้าผ่าน / QA ยอมรับ) q = qty_received · คืน { moves, jobs, orders }
-- ใบ released / in_progress และงานยังไม่ done: ส่วนที่งานยังต้องการเข้าถังของใบ ส่วนเกินเข้าสต็อกกลาง งานได้ยอด q เต็ม (ตรรกะเดียวกับ rf_apply_feedback)
-- ไม่เช่นนั้น (ใบปิด / ยกเลิก / ร่าง หรืองาน done / ไม่พบงาน) เข้าสต็อกกลางทั้งหมด งานไม่ถูกแตะ
create or replace function private.bom_rod_credit(p_actor_id uuid, p_actor_name text, p_lot public.bom_rod_lots)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q numeric := p_lot.qty_received;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_job_found boolean;
  v_open boolean;
  v_owned numeric;
  v_done numeric;
  v_status text;
  v_moves integer := 0;
  v_orders integer := 0;
begin
  if v_q is null or v_q <= 0 then raise exception 'BOM_INVALID_ROD'; end if;
  select * into v_job from public.bom_jobs j
  where j.is_test = (select private.bom_test_mode()) and j.job_no = p_lot.job_no and j.order_pk = p_lot.order_pk
  for update;
  v_job_found := found;
  select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.id = p_lot.order_pk for update;
  v_open := coalesce(v_job_found and found and v_ord.status in ('released', 'in_progress') and v_job.status <> 'done', false);

  if not v_open then
    insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((select private.bom_test_mode()), p_lot.id, p_lot.item_code, 'receive', v_q, null, null, '', p_actor_id);
    return jsonb_build_object('moves', 1, 'jobs', 0, 'orders', 0);
  end if;

  v_owned := least(v_q, greatest(v_job.qty_planned - v_job.qty_done, 0));
  if v_owned > 0 then
    insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((select private.bom_test_mode()), p_lot.id, p_lot.item_code, 'receive', v_owned, p_lot.order_pk, null, '', p_actor_id);
    v_moves := v_moves + 1;
  end if;
  if v_q - v_owned > 0 then
    insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((select private.bom_test_mode()), p_lot.id, p_lot.item_code, 'receive', v_q - v_owned, null, null, '', p_actor_id);
    v_moves := v_moves + 1;
  end if;

  v_done := v_job.qty_done + v_q;
  v_status := case when v_done >= v_job.qty_planned then 'done' else 'in_progress' end;
  update public.bom_jobs set
    qty_done = v_done,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', v_q, 'reject', 0,
      'note', left('รับเข้าคลัง SR ผ่านตรวจ ล็อต ' || p_lot.lot_no
                   || case when v_q > v_owned then ' · เกิน ' || trim_scale(v_q - v_owned)::text || ' เข้าสต็อกกลาง' else '' end, 200))),
    status = v_status,
    done_at = case when v_status = 'done' then coalesce(v_job.done_at, now()) else null end,
    updated_at = now()
  where id = v_job.id;
  if v_ord.status = 'released' then
    update public.bom_orders set status = 'in_progress', updated_at = now() where id = v_ord.id;
    v_orders := 1;
  end if;
  return jsonb_build_object('moves', v_moves, 'jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.bom_rod_credit(uuid, text, public.bom_rod_lots) from public, anon, authenticated;

-- ตัวเขียน receiveRods / decideRods (หนึ่งแถว) ลำดับตรวจ: รูปแถว (BOM_INVALID_ROD) -> สิทธิ์ (BOM_FORBIDDEN) -> ล็อกแถวล็อต (ไม่พบ = BOM_INVALID_ROD)
-- -> สถานะ (BOM_INVALID_TRANSITION) -> จำนวน / สเปก (BOM_INVALID_ROD) · คืน { lots, moves, jobs, orders }
create or replace function private.bom_rod_save_lots(p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_id_text text;
  v_lot public.bom_rod_lots%rowtype;
  v_dept text := private.bom_dept_of(p_actor);
  v_q numeric;
  v_qc jsonb;
  v_values jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_val jsonb;
  v_num numeric;
  v_result text;
  v_pass boolean;
  v_note text;
  v_decision text;
  v_res jsonb := jsonb_build_object('moves', 0, 'jobs', 0, 'orders', 0);
begin
  if p_action is null or p_action not in ('receiveRods', 'decideRods') then raise exception 'BOM_INVALID_ROD'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_ROD'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ROD'; end if;
  v_id_text := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ROD'));
  if v_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BOM_INVALID_ROD'; end if;

  if p_action = 'receiveRods' then
    v_q := private.bom_num(v_row -> 'qtyReceived', 'BOM_INVALID_ROD', 0, 1000000000);
    if v_q is null or v_q <= 0 then raise exception 'BOM_INVALID_ROD'; end if;
    v_qc := v_row -> 'qc';
    if v_qc is null or jsonb_typeof(v_qc) <> 'object' then raise exception 'BOM_INVALID_ROD'; end if;
    v_values := v_qc -> 'values';
    if v_values is null or jsonb_typeof(v_values) = 'null' then v_values := '{}'::jsonb; end if;
    if jsonb_typeof(v_values) <> 'object' then raise exception 'BOM_INVALID_ROD'; end if;
    -- ค่าที่วัด: เฉพาะสามมิติของสเปกการฉีด เป็นตัวเลข > 0 (null = ไม่ได้วัด)
    for v_key, v_val in select e.key, e.value from jsonb_each(v_values) as e loop
      if v_key not in ('thickness', 'width', 'weightPerM') then raise exception 'BOM_INVALID_ROD'; end if;
      v_num := private.bom_num(v_val, 'BOM_INVALID_ROD', 0, 1000000);
      if v_num is null then continue; end if;
      if v_num <= 0 then raise exception 'BOM_INVALID_ROD'; end if;
      v_clean := v_clean || jsonb_build_object(v_key, trim_scale(v_num));
    end loop;
    v_result := private.bom_text(v_qc, 'result', 10, 0, 'BOM_INVALID_ROD');
    if v_result not in ('pass', 'fail') then raise exception 'BOM_INVALID_ROD'; end if;
    v_note := private.bom_text(v_qc, 'note', 300, 0, 'BOM_INVALID_ROD');
    if v_result = 'fail' and char_length(v_note) < 3 then raise exception 'BOM_INVALID_ROD'; end if;
  else
    v_decision := private.bom_text(v_row, 'decision', 10, 1, 'BOM_INVALID_ROD');
    if v_decision not in ('accept', 'return', 'scrap') then raise exception 'BOM_INVALID_ROD'; end if;
    v_note := private.bom_text(v_row, 'decisionNote', 300, 3, 'BOM_INVALID_ROD');
  end if;

  -- สิทธิ์: รับเข้า = แผนก SR หรือกลุ่มวางแผน · ตัดสินล็อตที่กัก = แผนก QA หรือกลุ่มวางแผน
  if p_action = 'receiveRods' and not (p_planner or coalesce(v_dept = 'SR', false)) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action = 'decideRods' and not (p_planner or coalesce(v_dept = 'QA', false)) then raise exception 'BOM_FORBIDDEN'; end if;

  select * into v_lot from public.bom_rod_lots l where l.is_test = (select private.bom_test_mode()) and l.id = v_id_text::uuid for update;
  if not found then raise exception 'BOM_INVALID_ROD'; end if;

  if p_action = 'receiveRods' then
    if v_lot.status <> 'pending' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_q > v_lot.qty_sent then raise exception 'BOM_INVALID_ROD'; end if;
    -- มีสเปก: ทุกคีย์ของสเปกต้องมีค่า และผลที่ส่งมาต้องเท่ากับผลคำนวณ (rf_in_spec: |ค่า - target| <= tol เผื่อ 1e-9)
    if v_lot.spec is not null then
      v_pass := true;
      for v_key in select k.name from jsonb_object_keys(v_lot.spec) as k(name) loop
        if not (v_clean ? v_key) then raise exception 'BOM_INVALID_ROD'; end if;
        v_pass := v_pass and private.rf_in_spec((v_clean ->> v_key)::numeric, (v_lot.spec -> v_key ->> 'target')::numeric,
                                                (v_lot.spec -> v_key ->> 'tol')::numeric, null);
      end loop;
      if v_result <> (case when v_pass then 'pass' else 'fail' end) then raise exception 'BOM_INVALID_ROD'; end if;
    end if;
    update public.bom_rod_lots set
      status = case when v_result = 'pass' then 'stored' else 'held' end,
      qty_received = v_q,
      qc = jsonb_build_object('values', v_clean, 'result', v_result, 'note', v_note),
      received_by = p_actor.id,
      -- clock_timestamp: ลำดับรับเข้าจริงใช้เรียงล็อตเก่าก่อน (หลายการรับในธุรกรรมเดียวกันก็เรียงถูก)
      received_at = clock_timestamp()
    where id = v_lot.id
    returning * into v_lot;
    if v_result = 'pass' then
      v_res := private.bom_rod_credit(p_actor.id, p_actor_name, v_lot);
    end if;
  else
    if v_lot.status <> 'held' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    update public.bom_rod_lots set
      status = case v_decision when 'accept' then 'stored' when 'return' then 'returned' else 'scrapped' end,
      decision = v_decision,
      decision_note = v_note,
      decided_by = p_actor.id,
      decided_at = clock_timestamp()
    where id = v_lot.id
    returning * into v_lot;
    if v_decision = 'accept' then
      v_res := private.bom_rod_credit(p_actor.id, p_actor_name, v_lot);
    end if;
  end if;
  return v_res || jsonb_build_object('lots', 1);
end;
$$;
revoke all on function private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb) from public, anon, authenticated;

-- ตัวเขียน issueRods (1-50 แถว ทั้งหมดหรือไม่เลย) / reverseRodIssue (หนึ่งแถว) / adjustRods (หนึ่งแถว) ลำดับตรวจ: รูปทุกแถว (BOM_INVALID_ROD)
-- -> สิทธิ์ (BOM_FORBIDDEN) -> รายแถวใต้ล็อกแถวล็อต: สถานะ (BOM_INVALID_TRANSITION) -> รหัส / ถัง (BOM_INVALID_ROD) -> ยอดถัง (BOM_ROD_EXCEEDS)
-- id ของแถวมาจาก client (uuid) · id ซ้ำในคำสั่ง หรือมีอยู่แล้วในตาราง = BOM_INVALID_ROD
-- ownerOrderId / forOrderId = เลข PI · คืนจำนวนแถวที่เขียน
create or replace function private.bom_rod_save_moves(p_actor public.employees, p_planner boolean, p_action text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := case p_action when 'issueRods' then 'issue' when 'reverseRodIssue' then 'unissue' when 'adjustRods' then 'adjust' end;
  v_dept text := private.bom_dept_of(p_actor);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_ref text;
  v_owner_pi text;
  v_for_pi text;
  v_code text;
  v_qty numeric;
  v_note text;
  v_lot public.bom_rod_lots%rowtype;
  v_owner public.bom_orders%rowtype;
  v_for public.bom_orders%rowtype;
  v_orig public.bom_rod_moves%rowtype;
  v_owner_pk uuid;
  v_for_pk uuid;
  v_n integer := 0;
begin
  if v_kind is null then raise exception 'BOM_INVALID_ROD'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > (case when v_kind = 'issue' then 50 else 1 end) then
    raise exception 'BOM_INVALID_ROD';
  end if;

  -- รูปทุกแถวก่อนสิทธิ์ (เหมือนตัวเขียนอื่น)
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ROD'; end if;
    v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ROD'));
    if v_id !~ v_uuid or v_id = any (v_seen) then raise exception 'BOM_INVALID_ROD'; end if;
    if exists (select 1 from public.bom_rod_moves m where m.id = v_id::uuid) then raise exception 'BOM_INVALID_ROD'; end if;
    v_seen := v_seen || v_id;
    if private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_ROD') <> v_kind then raise exception 'BOM_INVALID_ROD'; end if;
    -- หมายเหตุ: จ่าย <= 300 ไม่บังคับ · ย้อนจ่าย / ปรับยอด 3-300 บังคับ
    v_note := private.bom_text(v_row, 'note', 300, (case when v_kind = 'issue' then 0 else 3 end), 'BOM_INVALID_ROD');
    if v_kind = 'unissue' then
      v_ref := lower(private.bom_text(v_row, 'reversesId', 40, 1, 'BOM_INVALID_ROD'));
      if v_ref !~ v_uuid then raise exception 'BOM_INVALID_ROD'; end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_id, 'reversesId', v_ref, 'note', v_note));
      continue;
    end if;
    v_ref := lower(private.bom_text(v_row, 'lotId', 40, 1, 'BOM_INVALID_ROD'));
    if v_ref !~ v_uuid then raise exception 'BOM_INVALID_ROD'; end if;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_ROD', -1000000000, 1000000000);
    if v_qty is null or v_qty = 0 or (v_kind = 'issue' and v_qty > 0) then raise exception 'BOM_INVALID_ROD'; end if;
    v_owner_pi := nullif(upper(private.bom_text(v_row, 'ownerOrderId', 40, 0, 'BOM_INVALID_ROD')), '');
    v_code := nullif(private.bom_code(private.bom_text(v_row, 'itemCode', 60, 0, 'BOM_INVALID_ROD')), '');
    if v_kind = 'issue' then
      v_for_pi := upper(private.bom_text(v_row, 'forOrderId', 40, 1, 'BOM_INVALID_ROD'));
      if v_code is null then raise exception 'BOM_INVALID_ROD'; end if;
    else
      -- ปรับยอดได้เฉพาะสต็อกกลาง (ไม่มีใบเจ้าของ ไม่มีใบที่จ่ายให้)
      if v_owner_pi is not null or nullif(private.bom_text(v_row, 'forOrderId', 40, 0, 'BOM_INVALID_ROD'), '') is not null then
        raise exception 'BOM_INVALID_ROD';
      end if;
      v_for_pi := null;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'lotId', v_ref, 'qty', v_qty, 'ownerPi', v_owner_pi, 'forPi', v_for_pi, 'itemCode', v_code, 'note', v_note));
  end loop;

  -- สิทธิ์: จ่าย / ย้อนจ่าย = แผนก SR หรือกลุ่มวางแผน · ปรับยอด = กลุ่มวางแผนเท่านั้น
  if v_kind = 'adjust' then
    if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
  elsif not (p_planner or coalesce(v_dept = 'SR', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows) loop
    if v_kind = 'unissue' then
      select * into v_orig from public.bom_rod_moves m
      where m.is_test = (select private.bom_test_mode()) and m.id = (v_row ->> 'reversesId')::uuid;
      if not found then raise exception 'BOM_INVALID_ROD'; end if;
      perform 1 from public.bom_rod_lots l where l.is_test = (select private.bom_test_mode()) and l.id = v_orig.lot_id for update;
      -- ย้อนได้เฉพาะแถว issue (อื่น = BOM_INVALID_ROD) ที่ยังไม่ถูกย้อน (ย้อนซ้ำ = BOM_INVALID_TRANSITION)
      if v_orig.kind <> 'issue' then raise exception 'BOM_INVALID_ROD'; end if;
      if exists (select 1 from public.bom_rod_moves m where m.is_test = (select private.bom_test_mode()) and m.reverses_id = v_orig.id) then
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
      insert into public.bom_rod_moves (id, is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, reverses_id, note, created_by)
      values ((v_row ->> 'id')::uuid, (select private.bom_test_mode()), v_orig.lot_id, v_orig.item_code, 'unissue', -v_orig.qty,
              v_orig.owner_order_pk, v_orig.for_order_pk, v_orig.id, v_row ->> 'note', p_actor.id);
      v_n := v_n + 1;
      continue;
    end if;

    select * into v_lot from public.bom_rod_lots l
    where l.is_test = (select private.bom_test_mode()) and l.id = (v_row ->> 'lotId')::uuid
    for update;
    if not found then raise exception 'BOM_INVALID_ROD'; end if;
    if v_lot.status <> 'stored' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if (v_row ->> 'itemCode') is not null and (v_row ->> 'itemCode') <> v_lot.item_code then raise exception 'BOM_INVALID_ROD'; end if;
    v_qty := (v_row ->> 'qty')::numeric;
    v_owner_pk := null;
    v_for_pk := null;
    if v_kind = 'issue' then
      -- ใบที่จ่ายให้ต้อง released / in_progress · ถังต้นทางเป็นของใบนั้นเอง หรือสต็อกกลาง (ไม่มีเจ้าของ / ใบเจ้าของปิดแล้ว)
      select * into v_for from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = (v_row ->> 'forPi');
      if not found then raise exception 'BOM_INVALID_ROD'; end if;
      if v_for.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
      v_for_pk := v_for.id;
      if (v_row ->> 'ownerPi') is not null then
        select * into v_owner from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = (v_row ->> 'ownerPi');
        if not found then raise exception 'BOM_INVALID_ROD'; end if;
        if v_owner.id <> v_for.id and v_owner.status not in ('completed', 'cancelled') then raise exception 'BOM_INVALID_ROD'; end if;
        v_owner_pk := v_owner.id;
      end if;
    end if;
    -- ยอดถังห้ามติดลบ (อ่านรวมแถวที่เพิ่งเขียนในคำสั่งนี้)
    if private.bom_rod_balance(v_lot.id, v_owner_pk) + v_qty < 0 then raise exception 'BOM_ROD_EXCEEDS'; end if;
    insert into public.bom_rod_moves (id, is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((v_row ->> 'id')::uuid, (select private.bom_test_mode()), v_lot.id, v_lot.item_code, v_kind, v_qty, v_owner_pk, v_for_pk,
            v_row ->> 'note', p_actor.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_rod_save_moves(public.employees, boolean, text, jsonb) from public, anon, authenticated;

-- ปล่อยผลิต: หยิบแท่งจากสต็อกกลางตาม stockCounts[รหัส RB ที่อยู่ในผลระเบิดของใบ] = n > 0 · ล็อตเก่าก่อน (received_at แล้วเลขล็อต)
-- ในล็อตเดียวกันถังไม่มีเจ้าของก่อน แล้วใบที่ปิดตาม released_at / เลข PI · ต่อถังต้นทางสองแถว transfer · ไม่พอ = BOM_ROD_EXCEEDS · คืนจำนวนแถว
create or replace function private.bom_rod_take(p_order_pk uuid, p_counts jsonb, p_expl jsonb, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_need numeric;
  v_src record;
  v_part numeric;
  v_n integer := 0;
begin
  for v_code, v_need in
    select c.key, (c.value #>> '{}')::numeric
    from jsonb_each(coalesce(p_counts, '{}'::jsonb)) as c
    where jsonb_typeof(c.value) = 'number' and (c.value #>> '{}')::numeric > 0
      -- รหัส RB = บรรทัดผลระเบิดของใบที่ kind = 'RB' (กฎเดียวกับ client: netRequirements อ่านชนิดจากบรรทัดผลระเบิด)
      and exists (select 1 from jsonb_array_elements(coalesce(p_expl, '[]'::jsonb)) as e(line)
                  where e.line ->> 'itemCode' = c.key and e.line ->> 'kind' = 'RB')
    order by c.key collate "C"
  loop
    -- ล็อกแถวล็อตของรหัสนี้ (ยอดถังตรวจใต้ล็อกเดียวกับการจ่าย)
    perform 1 from public.bom_rod_lots l
    where l.is_test = (select private.bom_test_mode()) and l.item_code = v_code and l.status = 'stored'
    order by l.id
    for update;
    if private.bom_rod_free(v_code) < v_need then raise exception 'BOM_ROD_EXCEEDS'; end if;
    for v_src in
      select b.lot_id, b.owner, b.bal
      from (select m.lot_id, m.owner_order_pk as owner, sum(m.qty) as bal
            from public.bom_rod_moves m
            where m.is_test = (select private.bom_test_mode()) and m.item_code = v_code
            group by m.lot_id, m.owner_order_pk) as b
      join public.bom_rod_lots l on l.id = b.lot_id
      left join public.bom_orders o on o.id = b.owner
      where b.bal > 0 and (b.owner is null or o.status in ('completed', 'cancelled'))
      order by l.received_at, l.lot_no collate "C", (b.owner is not null), o.released_at, o.pi_no collate "C"
    loop
      exit when v_need <= 0;
      v_part := least(v_need, v_src.bal);
      insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
      values ((select private.bom_test_mode()), v_src.lot_id, v_code, 'transfer', -v_part, v_src.owner, p_order_pk, '', p_actor),
             ((select private.bom_test_mode()), v_src.lot_id, v_code, 'transfer', v_part, p_order_pk, p_order_pk, '', p_actor);
      v_need := v_need - v_part;
      v_n := v_n + 2;
    end loop;
    if v_need > 0 then raise exception 'BOM_ROD_EXCEEDS'; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_rod_take(uuid, jsonb, jsonb, uuid) from public, anon, authenticated;

-- เปิดใบกลับเป็นร่าง: คืนแท่งที่ใบนี้หยิบจากสต็อกกลาง ต่อล็อต k = min(transfer สุทธิเข้าถังของใบที่ for_order = ใบนี้, ยอดถังของใบในล็อตนั้น)
-- สองแถว transfer (-k ถังของใบ, +k สต็อกกลาง) for_order_pk = ใบนี้ · คืนจำนวนแถว
create or replace function private.bom_rod_return(p_order_pk uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src record;
  v_n integer := 0;
begin
  for v_src in
    select t.lot_id, t.item_code, least(t.net_in, private.bom_rod_balance(t.lot_id, p_order_pk)) as k
    from (select m.lot_id, m.item_code, sum(m.qty) as net_in
          from public.bom_rod_moves m
          where m.is_test = (select private.bom_test_mode()) and m.kind = 'transfer'
            and m.for_order_pk = p_order_pk and m.owner_order_pk = p_order_pk
          group by m.lot_id, m.item_code) as t
    join public.bom_rod_lots l on l.id = t.lot_id
    order by t.item_code collate "C", l.received_at, l.lot_no collate "C"
  loop
    continue when v_src.k <= 0;
    insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((select private.bom_test_mode()), v_src.lot_id, v_src.item_code, 'transfer', -v_src.k, p_order_pk, p_order_pk, '', p_actor),
           ((select private.bom_test_mode()), v_src.lot_id, v_src.item_code, 'transfer', v_src.k, null, p_order_pk, '', p_actor);
    v_n := v_n + 2;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_rod_return(uuid, uuid) from public, anon, authenticated;

-- 4. RubberFlow: ล็อตตกแต่งของ WO ที่ผูกงาน BOM เป็นแท่งรอรับเข้าคลัง SR (ไม่มีกล่อง ไม่ป้อนยอดให้งาน) ------------------------------------------
-- private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ WO ที่ผูกงาน: boxes = 0 perBox ไม่บังคับ ล็อตผ่าน = bom_rod_lot_create แทน rf_apply_feedback · คืน rodLots)
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
        -- WO ที่ผูกงาน BOM (20261202010000): แท่งยาวเข้าคลัง SR ไม่เป็นกล่องสินค้าสำเร็จรูป จึงไม่สร้างกล่อง (boxes = 0) และ perBox ไม่บังคับ (ส่งมาต้อง > 0)
        v_linked := coalesce(private.bom_rod_wo_linked(v_ord), false);
        v_perbox := private.bom_num(v_params -> 'perBox', 'RF_INVALID_LOT', 0, 1000000000);
        if v_perbox is null then
          if not v_linked then raise exception 'RF_INVALID_LOT'; end if;
        elsif v_perbox <= 0 then
          raise exception 'RF_INVALID_LOT';
        end if;
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_grade := coalesce(nullif(private.bom_text(v_row, 'grade', 20, 0, 'RF_INVALID_LOT'), ''), 'A');
        if v_linked then
          v_boxes := 0;
          v_out := case when v_perbox is null then '{}'::jsonb else jsonb_build_object('perBox', v_perbox) end;
        else
          v_boxes := case when v_good > 0 then ceil(v_good / v_perbox)::integer else 0 end;
          if v_boxes > 1000 then raise exception 'RF_INVALID_LOT'; end if;
          v_out := jsonb_build_object('perBox', v_perbox);
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
      qc, hold_reasons, transferred_qty, ready_at, grade, boxes, counted_to_order, created_by)
    values (
      (select private.bom_test_mode()), v_no, v_stage, v_order_no, case when v_stage = 'mixing' then v_rec.recipe_code end, v_uom, v_machine, v_shift, v_mold_id,
      v_sources, v_out, v_good, v_scrap, v_reason, v_qc, v_reasons, 0, v_ready, v_grade, v_boxes, (v_stage = 'finishing' and v_qc = 'pass'), p_actor.id)
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
        for v_i in 1..v_boxes loop
          insert into public.rf_fg_boxes (is_test, box_no, lot_no, order_no, recipe_code, product_code, qty, uom, grade, status)
          values ((select private.bom_test_mode()), regexp_replace(v_no, 'FN', 'BOX') || '-' || lpad(v_i::text, 3, '0'), v_no, v_order_no, v_ord.recipe_code, v_ord.product_code,
                  trim_scale(round(least(v_perbox, v_good - (v_i - 1) * v_perbox), 3)), v_uom, v_grade,
                  case when v_qc = 'pass' then 'in_stock' else 'hold' end);
        end loop;
        if v_qc = 'pass' then
          perform private.rf_add_produced(v_order_no, v_good, p_may_close, p_base, p_cur);
          -- ชิ้นผ่านสถานีสุดท้าย (ตกแต่ง QC ผ่าน นับเข้า WO) = ป้อนผลผลิตกลับงาน BOM ที่ผูกกับ WO นี้ ณ จุดเดียวกับที่นับเข้า WO
          -- 20261202010000: WO ที่ผูกงาน BOM ไม่ป้อนยอดให้งานที่นี่แล้ว ล็อตเป็นแท่งรอรับเข้าคลัง SR (bom_rod_lots pending)
          -- งาน RB ได้ยอดเมื่อ SR รับเข้าผ่าน / QA ยอมรับ · WO ที่ไม่ผูกงานเรียก rf_apply_feedback เหมือนเดิม
          if v_linked then
            v_rods := v_rods + private.bom_rod_lot_create(v_flot, v_ord);
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

-- private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ QA ตัดสินล็อตตกแต่งของ WO ที่ผูกงานเป็น pass ครั้งแรก = bom_rod_lot_create แทน rf_apply_feedback · คืน rodLots)
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
    update public.rf_lots set
      qc = v_result,
      hold_reasons = case when v_result = 'pass' then '[]'::jsonb else hold_reasons end,
      counted_to_order = counted_to_order or v_count,
      updated_at = now()
    where id = v_lot.id
      and (qc is distinct from v_result or (v_result = 'pass' and hold_reasons <> '[]'::jsonb) or v_count);
    update public.rf_fg_boxes set status = case when v_result = 'pass' then 'in_stock' else 'hold' end, updated_at = now()
    where is_test = (select private.bom_test_mode()) and lot_no = v_lot.lot_no and status <> 'shipped' and status <> case when v_result = 'pass' then 'in_stock' else 'hold' end;
    if v_count then
      perform private.rf_add_produced(v_lot.order_no, v_lot.good_qty, p_may_close, p_base, p_cur);
      -- QA ตัดสินล็อตตกแต่งเป็น pass ครั้งแรก = ชิ้นผ่านสถานีสุดท้าย ป้อนผลผลิตกลับงาน BOM ณ จุดเดียวกับที่นับเข้า WO
      select * into v_wo from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_lot.order_no;
      -- 20261202010000: ล็อตของ WO ที่ผูกงาน BOM เป็นแท่งรอรับเข้าคลัง SR (ครั้งเดียว: v_count เป็นจริงครั้งเดียวต่อล็อต) แทนการป้อนยอดให้งาน
      if coalesce(private.bom_rod_wo_linked(v_wo), false) then
        v_rods := v_rods + private.bom_rod_lot_create(v_lot, v_wo);
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

-- public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261130010000_bom_rf_go_live.sql
--   (+ นับ rodLots จาก rf_save_lots / rf_save_qc: เพิ่มตัวนับ BOM และ audit ของ BOM counts.rodLots · audit RF_SAVE มี bom_rod_lots)
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
  v_bom_rods integer := 0;
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
    perform private.rf_save_transfers(v_actor, v_planner or v_rb, v_planner or v_sr,
                                      coalesce(p_changes #> '{transfers,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_boxes(v_actor.id, v_planner or v_wh, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
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

-- 5. BOM: ปล่อยผลิตหยิบ / เปิดกลับคืนแท่ง ชุดเรคอร์ดใหม่ และ action ใหม่ ---------------------------------------------------------------------
-- private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ ปล่อยผลิต: private.bom_rod_take · เปิดกลับเป็นร่าง: private.bom_rod_return · คืน rodMoves)
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

    select * into v_old from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        (select private.bom_test_mode()), v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
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
    -- (ใบที่มาจากสต็อกทั้งหมดเป็น completed ตอนปล่อยผลิต: เซิร์ฟเวอร์ตั้งเองข้างล่าง client ส่ง released)
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

    -- นับคงคลังได้เฉพาะใบ draft · ใบที่ไม่ใช่ draft แก้เนื้อหาไม่ได้ (เว้นแต่เปิดกลับเป็น draft)
    if v_counts_changed and v_old.status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_content and v_old.status <> 'draft' and v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;

    v_reopen := false;
    v_release := false;
    v_revision := v_old.revision;
    if v_status_changed then
      if v_old.status = 'draft' and v_status = 'released' then
        if jsonb_array_length(v_items) = 0 or v_expl is null then raise exception 'BOM_INVALID_TRANSITION'; end if;
        v_released := v_released || v_old.id;
        v_release := true;
      elsif v_old.status = 'draft' and v_status = 'cancelled' then
        -- ยกเลิกต้องมีเหตุผล 3-200 ตัวอักษร (เก็บที่ cancel_reason) ทุกสถานะที่ยกเลิกได้ (20261128010000)
        if char_length(v_reason) < 3 then raise exception 'BOM_INVALID_ORDER'; end if;
      elsif v_old.status in ('released', 'in_progress') and v_status = 'cancelled' then
        if char_length(v_reason) < 3 then raise exception 'BOM_INVALID_ORDER'; end if;
        -- งานที่มียอดแล้วไม่กันการยกเลิกอีก (20261128010000): งานทุกงานของใบคงอยู่พร้อมยอดและรายงาน (ไม่ลบ) และแก้ต่อไม่ได้เพราะใบไม่ใช่ released / in_progress
        -- สต็อกสินค้าสำเร็จรูป: ส่งมอบแล้ว / ให้ใบอื่นไปแล้ว = BOM_INVALID_TRANSITION · ไม่เช่นนั้นคืนที่หยิบมา (untransfer) · ที่ใบนี้รับเข้าเองอยู่ในคลังต่อเป็นสต็อก (bom_fg_free นับสั่ง = 0)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
        -- WO ที่ผูกงาน: planned / released ยกเลิก · in_progress / on_hold หยุด · completed คงเดิม (private.bom_cancel_rf_orders ไม่ปฏิเสธแล้ว)
        v_cancelled := v_cancelled || private.bom_cancel_rf_orders(v_old.id);
      elsif v_old.status in ('released', 'in_progress') and v_status = 'draft' then
        -- เปิดใบกลับมาแก้ได้เมื่อไม่มีงานใดเริ่ม (ตรวจจากสถานะในฐานข้อมูล) งานทั้งหมดถูกลบ revision + 1 ยอดนับคงคลังคงอยู่
        if private.bom_started_jobs(v_old.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
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
      updated_at = now()
    where id = v_old.id;
  end loop;
  return jsonb_build_object('released', to_jsonb(v_released), 'cancelled', to_jsonb(v_cancelled), 'reopened', to_jsonb(v_reopened),
                            'fgMoves', v_moves, 'rodMoves', v_rod_moves);
end;
$$;

-- private.bom_records(bigint) จาก 20261130010000_bom_rf_go_live.sql (+ ชุด rodLots, rodMoves)
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
    -- คลังแท่งยาว SR (20261202010000): ล็อตแท่งยาว (ช่องที่ยังไม่มีค่าเป็น null) และประวัติสต็อกที่จ่ายได้ (เลข PI ของถัง / ใบที่จ่ายให้ null = ไม่มี)
    'rodLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id::text, 'lotNo', l.lot_no, 'itemCode', l.item_code, 'orderId', o.pi_no, 'jobNo', l.job_no, 'woNo', l.wo_no,
          'recipeCode', l.recipe_code, 'uom', l.uom, 'qtySent', l.qty_sent, 'spec', l.spec, 'status', l.status,
          'qtyReceived', l.qty_received, 'qc', l.qc,
          'receivedBy', case when l.received_at is null then null else coalesce(private.bom_person(l.received_by), '') end,
          'receivedAt', private.bom_ms(l.received_at),
          'decision', l.decision, 'decisionNote', l.decision_note,
          'decidedBy', case when l.decided_at is null then null else coalesce(private.bom_person(l.decided_by), '') end,
          'decidedAt', private.bom_ms(l.decided_at), 'createdAt', private.bom_ms(l.created_at))
        order by l.created_at, l.lot_no collate "C")
      from public.bom_rod_lots l join public.bom_orders o on o.id = l.order_pk
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
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb))
$$;

-- private.bom_delta(bigint) จาก 20261130010000_bom_rf_go_live.sql (+ ชุด rodLots, rodMoves)
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
                   ('customers'), ('orders'), ('jobs'), ('stock'), ('stockMoves'), ('fgMoves'), ('rodLots'), ('rodMoves')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;

-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261130010000_bom_rf_go_live.sql
--   (+ ส่วน rodLots / rodMoves ห้า action ของคลังแท่งยาว และนับ rodMoves ของปล่อยผลิต / เปิดกลับ)
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
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves', 'rodLots', 'rodMoves'];
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
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_reader();
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
      -- คลังแท่งยาว SR (20261202010000): ส่วน rodLots ส่งได้เฉพาะ receiveRods / decideRods · ส่วน rodMoves เฉพาะ issueRods / reverseRodIssue / adjustRods
      -- และห้าการกระทำนี้ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_ROD)
      if v_n > 0 and ((v_key = 'rodLots' and p_action not in ('receiveRods', 'decideRods'))
                      or (v_key = 'rodMoves' and p_action not in ('issueRods', 'reverseRodIssue', 'adjustRods'))
                      or (p_action in ('receiveRods', 'decideRods') and v_key <> 'rodLots')
                      or (p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and v_key <> 'rodMoves')) then
        raise exception 'BOM_INVALID_ROD';
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
  -- คลังแท่งยาว SR: ห้าการกระทำต้องมีคำขอในส่วนของตัวเองเสมอ (ไม่มี / ว่าง = BOM_INVALID_ROD)
  if p_action in ('receiveRods', 'decideRods') and coalesce(jsonb_array_length(p_changes #> '{rodLots,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
  end if;
  if p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and coalesce(jsonb_array_length(p_changes #> '{rodMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
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
    v_res := private.bom_save_orders(v_actor, v_actor_name, v_planner, coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb),
                                     coalesce(p_changes #> '{jobs,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_released := array(select t.value::uuid from jsonb_array_elements_text(v_res -> 'released') as t(value));
    v_rf_cancel_n := jsonb_array_length(v_res -> 'cancelled');
    v_rf_reopen_n := jsonb_array_length(v_res -> 'reopened');
    v_rf_cancelled := (v_res -> 'cancelled') || (v_res -> 'reopened');
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
    -- คลังแท่งยาว SR (20261202010000): รับเข้า / ตัดสินล็อตที่กัก (rodLots) และจ่าย / ย้อนจ่าย / ปรับยอด (rodMoves) ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์
    -- audit นับ rodMoves ตามจำนวนแถวประวัติที่เขียน และ jobs / orders เมื่อการรับเข้าบันทึกยอดให้งาน RB (rodLots นับจากคำขอตามปกติ)
    if p_action in ('receiveRods', 'decideRods') then
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

-- 6. ล้างข้อมูล BOM ทดสอบ (นิยามจาก 20261121010000_bom_fg_receive_deliver.sql เพิ่ม bom_rod_moves, bom_rod_lots ลบก่อน bom_fg_moves / bom_orders) -------
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
