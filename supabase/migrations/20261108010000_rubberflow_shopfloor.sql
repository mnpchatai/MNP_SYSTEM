-- ============================================================================
-- RubberFlow (แผนก RB โหมดทดสอบ) ขึ้นฐานข้อมูล รอบที่ 2 จาก 2: ทุกอย่างที่เหลือใน localStorage ย้ายเข้า Supabase
-- ล็อตวัตถุดิบ (materialLots) ใบเบิก/ชั่งเคมี (requisitions) ล็อตผลิต 4 สถานี (lots: ผสม ฉีด อบ ตกแต่ง) ใบส่งมอบ WIP (transfers)
-- กล่องสินค้าสำเร็จรูป (fgBoxes) ผลตรวจ QC (qcRecords) NCR (ncrs) และแม่พิมพ์/หัวดาย (molds)
-- ต่อยอดกลไกเดียวกับรอบที่ 1 (20261107010000_rubberflow_core.sql) ทุกประการ: ตัวนับ rf_master_state (version + epoch) เดียวกัน, changed_version รายระเบียน
-- ประทับโดย trigger, ชนรายระเบียนด้วย RF_STALE ก่อนตรวจสิทธิ์/เนื้อหาเสมอ, delta {upsert, delete}, audit ผ่าน app_rf_audit, ล้างข้อมูลทดสอบผ่าน app_sandbox_purge_rf
-- หลังรอบนี้ไม่มีข้อมูลธุรกิจของ RubberFlow เหลือในเบราว์เซอร์ (mnp-rubberflow-local-v1 เลิกใช้) ฐานข้อมูลเริ่มจากว่าง ไม่มีข้อมูลสาธิต
--
-- ตารางใหม่ (ทดสอบเท่านั้น แยกโหมดด้วย is_test เหมือน rf_*): rf_molds, rf_material_lots, rf_requisitions, rf_lots, rf_transfers, rf_fg_boxes, rf_qc_records, rf_ncrs
--   ทุกตาราง: trigger rf_sandbox_scope (is_test) + rf_stamp_version (changed_version) + RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only
--   (private.lab_only_guard_table) + ลงทะเบียนใน private.sandbox_unguarded_tables() · อ้างอิงกันด้วย foreign key คู่กับ is_test (ล็อต -> ใบสั่งผลิต/แม่พิมพ์,
--   ใบส่งมอบ/กล่อง/ผล QC -> ล็อตผลิต, ใบเบิก -> ใบสั่งผลิต + สูตร, ล็อตวัตถุดิบ -> วัตถุดิบ) จึงไม่มีระเบียนลอย
--
-- RPC (สัญญากับ Pilot Web) ลายเซ็นเดิมของรอบที่ 1 ทั้งหมด ไม่เพิ่ม/ลบ RPC สาธารณะ:
--   app_rf_save และ app_sandbox_purge_rf ถูก replace · app_rf_master / app_rf_master_since / app_rf_audit ไม่เปลี่ยนนิยาม แต่ snapshot/delta มี 11 ชุดแล้ว (materials recipes orders +
--   molds materialLots requisitions lots transfers fgBoxes qcRecords ncrs) เพราะ private.rf_records / rf_delta ถูก replace · ไม่มีการลบระเบียนในรอบนี้ (delete เป็น [] เสมอ rf_deleted_keys ยังว่าง)
--   p_action เพิ่ม: receiveMaterial setMaterialLotStatus createRequisition weighLine endRest createTransfer receiveTransfer shipBoxes createNcr updateNcr closeNcr
--   cleanMold saveMold (ของรอบที่ 1: recordMixing recordExtrusion recordCuring recordFinishing addQcRecord อยู่ในรายการอยู่แล้ว) อย่างอื่น = RF_INVALID_ACTION
--
-- สิทธิ์ (ตัวบังคับจริงคือ RPC; หน้าเว็บซ่อนปุ่มอย่างเดียว) ต่อชุด/ต่อช่อง เปรียบเทียบระเบียนที่ส่งมากับแถวที่เก็บ:
--   กลุ่มวางแผน (private.bom_can_edit) ทำได้ทุกอย่าง · สมาชิก RB = แผนก RB ทุกบทบาท · หัว RB เหมือนรอบที่ 1 · ST/SR/QA/WH = แผนกนั้น (ทุกบทบาท)
--   ชุด                  ใครเขียนได้ (นอกจากกลุ่มวางแผน)
--   materialLots         ST รับเข้า (receiveMaterial: ล็อตใหม่ available เท่านั้น) · ST หรือ QA ตั้ง available <-> hold (เปลี่ยนอย่างอื่นของล็อตเดิมไม่ได้)
--   requisitions         สมาชิก RB สร้างใบ (เซิร์ฟเวอร์จัดสรร FEFO เอง ไม่เชื่อบรรทัดที่ client ส่ง) และชั่งทีละบรรทัด (weighLine)
--   lots                 สมาชิก RB บันทึกผสม/ฉีด/อบ/ตกแต่ง และจบเวลาบ่ม (endRest) · ล็อตเดิมไม่มีช่องที่ client แก้ได้นอกจาก readyAt ผ่าน endRest
--   transfers            สมาชิก RB สร้างใบส่งมอบ · SR รับมอบ (qtyReceived)
--   fgBoxes              กล่องเกิดจากการตกแต่งเท่านั้น · WH ส่งมอบ (in_stock -> shipped)
--   qcRecords            QA บันทึกผล (ผลตัดสิน pass/hold/fail ตั้งสถานะ QC ของล็อต)
--   ncrs                 QA เปิด/แก้/ปิด · สมาชิก RB กรอก corrective/preventive ของ NCR ที่ยังเปิดได้ (updateNcr) ช่องอื่นไม่ได้ · ปิดต้องมี corrective + preventive
--   molds                สมาชิก RB เพิ่ม/แก้ข้อมูลหลัก และล้างแม่พิมพ์ (cleanMold)
--   ผิดสิทธิ์ = RF_FORBIDDEN · สถานะผิดลำดับ = RF_INVALID_TRANSITION · ชนรายระเบียน = RF_STALE (ก่อนสิทธิ์/เนื้อหาเสมอ) · ช่องที่เซิร์ฟเวอร์คำนวณเอง
--   (ดูด้านล่าง) ที่ client ส่งมาต่างจากที่เก็บ ถูกเมินโดยไม่ถือเป็นการแก้ (client ใช้ค่าในคำตอบ delta แทน)
--
-- ค่าที่เซิร์ฟเวอร์คำนวณเอง (ไม่เชื่อ client):
--   - ใบเบิก: บรรทัดทั้งหมด (วัตถุดิบ ล็อต กิโลเป้าหมาย) จากสูตรของ WO × จำนวน batch แล้วจัดสรรแบบ FEFO ในธุรกรรมเดียว: เฉพาะล็อต available ไม่หมดอายุ
--     หักกิโลที่ใบเบิกอื่นที่ยัง weighing จองไว้ (เฉพาะบรรทัดที่ยังไม่ชั่ง) หมดอายุก่อนจ่ายก่อน ล็อกแถวล็อตของวัตถุดิบนั้นก่อนจัดสรร สต็อกไม่พอ = RF_INSUFFICIENT_STOCK
--     (หรือ RF_STALE ถ้ามีล็อต/ใบเบิกเปลี่ยนหลังเวอร์ชันฐาน) · สถานะ weighing -> issued (ชั่งครบ) -> consumed (บันทึกผสม) เซิร์ฟเวอร์เปลี่ยนเอง
--   - ชั่ง (weighLine): ค่าต้องอยู่ในเกณฑ์ ± max(0.02, 1.5% ของเป้าหมาย) ล็อตต้อง available ไม่หมดอายุและมีพอ · หักสต็อกล็อต (qty_kg) ทันทีที่ชั่งแต่ละบรรทัด
--     (ต่างจาก client เดิมที่หักตอนครบทุกบรรทัด) · ชั่งซ้ำบรรทัดเดิมไม่ได้ · ผู้ชั่ง/เวลาเซิร์ฟเวอร์ตั้ง
--   - ล็อตผลิต: QC อัตโนมัติ (hold พร้อมเหตุผลเมื่อ Dump temp ของขั้นไหนนอกช่วง ±dumpTol ของสูตรในขั้นนั้น / ค่าฉีด/อบนอกสเปก) readyAt ของล็อตผสม (= เวลาปัจจุบัน +
--     restHours ของสูตร) ผู้บันทึก/เวลา · แหล่งที่มา: ล็อตผสมมาจากใบเบิกสถานะ issued, ล็อตฉีด/อบ/ตกแต่งมาจากใบส่งมอบที่ received และส่งมาสถานีนั้น ยอดที่ใช้ไม่เกินคงเหลือของใบส่งมอบ
--     แล้วเซิร์ฟเวอร์หักคงเหลือของใบส่งมอบ · ผลข้างเคียงในธุรกรรมเดียวกัน: บันทึกผสม = ใบเบิก consumed + WO released -> in_progress, ฉีด/อบ = ยอดสะสมของแม่พิมพ์
--     (usage_since_clean, total_usage; อบนับเป็น shot = ceil((ดี + เสีย) / ชิ้นต่อรอบ)) · transferredQty ของล็อตเพิ่มเมื่อสร้างใบส่งมอบ ไม่รับจาก client
--   - ตกแต่ง: เซิร์ฟเวอร์สร้างกล่อง (rf_fg_boxes) จากล็อต (กล่องที่ client ส่งมาเมินทั้งหมด) ผ่าน QC (pass) = นับเข้าใบ: producedQty ของ WO เพิ่มเอง (ไม่เชื่อค่าที่ client ส่ง)
--     และ WO ที่ in_progress ปิดเองเป็น completed เมื่อครบเป้าหมาย (เฉพาะเมื่อผู้บันทึกเป็นสมาชิก RB หรือกลุ่มวางแผน เหมือนเดิม) producedQty ของ WO จึงมาจากล็อตตกแต่งที่นับแล้วเท่านั้น
--     (WO ที่มียอดเดิมจากรอบที่ 1 ยอดนั้นคงอยู่และบวกต่อ) · QA ตั้ง pass ให้ล็อตตกแต่งที่ยังไม่นับ = นับเข้าใบทันที (กฎ QA ของรอบที่ 1 ย้ายมาอยู่ฝั่งผลตรวจ)
--   - ใบส่งมอบ: ยอดที่ส่งต้องไม่เกินที่โอนได้ (goodQty - transferredQty ของล็อตผ่าน QC และบ่มครบ) transferredQty ของล็อตเพิ่มเอง · รับมอบ: qtyReceived <= qtySent x 1.02, remaining = qtyReceived
--   - ผลตรวจ QC: pass ของแต่ละค่าคำนวณใหม่จาก SPECS.lab · ผลตัดสิน pass ได้เมื่อทุกค่าผ่าน · สถานะ QC ของล็อต: จาก fail ย้อนกลับเป็น pass/hold ไม่ได้ (นอกนั้นเปลี่ยนได้)
--     กล่องที่ยังไม่ส่งของล็อตเปลี่ยนตาม (pass = in_stock อย่างอื่น = hold) · NCR ใหม่ทำให้ล็อตที่ pass อยู่เป็น hold (เหตุผล "เปิด <เลข NCR>")
--
-- การเชื่อมกับ BOM: การป้อนผลผลิตกลับเข้างาน BOM ย้ายจาก "ตอนปิด WO" (รอบที่ 1) มาเป็น "ตอน SR รับมอบใบส่งมอบ" ทุกใบ
--   เมื่อใบส่งมอบรับมอบ (receiveTransfer) และล็อตของใบเป็นของ WO ที่ผูกงาน BOM (external_ref ชี้มา WO นี้) เซิร์ฟเวอร์ต่อรายงานเข้างาน
--   { at, by, good = qtyReceived (ล็อตหน่วย kg และ WO ไม่ใช่หน่วย kg = qtyReceived / kgPerUnit ปัดทศนิยม 3 ตำแหน่ง ไม่มี kgPerUnit = ไม่เขียนอะไร), reject = 0,
--   note = "รับโอน TR-… จาก WO …" } บวก qty_done, done ถ้า >= qty_planned, ใบ PI released -> in_progress, ในธุรกรรมเดียวกับการรับมอบ (ลำดับล็อกเหมือนรอบที่ 1: rf ก่อน bom)
--   ข้ามไม่เขียน (รับมอบยังสำเร็จ) เมื่อไม่พบงาน/external_ref ไม่ชี้มา WO นี้/ใบ PI ไม่ใช่ released-in_progress/งาน done แล้ว/ยอดที่ป้อนเป็น 0
--   ปิด WO ที่ผูกงานไม่ต้องมี producedQty > 0 อีก (RF_INVALID_PRODUCED เลิกใช้) · ยกเลิก WO ล้าง external_ref เหมือนเดิม (rf_unlink_job ไม่เปลี่ยน)
--   สังเกต: ใบส่งมอบทุกสถานีรวมสถานีผสม (kg) ป้อนกลับตามสัญญา จึงรับยอดซ้ำเมื่อชิ้นงานเดียวกันผ่านหลายสถานีและถูกรับมอบหลายครั้ง (ตามที่ผู้ใช้กำหนด ไม่ใช่ข้อบกพร่อง)
--   rf_orders.fed_back_at ถูกลบ (เลิกใช้: ป้อนกลับต่อใบส่งมอบ ใบส่งมอบรับมอบได้ครั้งเดียวอยู่แล้ว) · WO: producedQty ที่ client ส่งมาถูกเมินเสมอ (เซิร์ฟเวอร์เป็นเจ้าของ)
--
-- รหัสข้อผิดพลาดใหม่ (ข้อความตายตัว): RF_INVALID_MOLD RF_INVALID_MATLOT RF_INVALID_REQ RF_INVALID_LOT RF_INVALID_TRANSFER RF_INVALID_BOX RF_INVALID_QC RF_INVALID_NCR
--   RF_INSUFFICIENT_STOCK (ของรอบที่ 1 ยังใช้: RF_FORBIDDEN RF_STALE RF_RESET RF_CONFLICT RF_INVALID_TRANSITION RF_INVALID_ORDER RF_INVALID_DATA ฯลฯ)
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดใน 20261107010000_rubberflow_core.sql ทุกตัว)
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text), app_sandbox_purge_rf()  (create or replace ลายเซ็นเดิม)
--   - private.rf_records(bigint), rf_delta(bigint) (create or replace) · private.rf_client_actions() · private.sandbox_unguarded_tables()
--   - private.rf_apply_feedback: ลายเซ็นเดิม (text, public.rf_orders) ถูก DROP แล้วสร้างใหม่เป็น (text, public.rf_transfers, public.rf_orders)
--   - private.rf_save_orders: ลายเซ็นเดิม (10 พารามิเตอร์) ถูก DROP แล้วสร้างใหม่ตัด p_qa/p_action (ไม่มีกฎ QA แล้ว) และตัดการป้อนกลับตอนปิด WO
--   - ไม่แตะ: rf_unlink_job rf_link_job rf_job_for_link rf_lock_bom rf_save_materials rf_save_recipes rf_parse_items rf_actor rf_is_* rf_stamp_version
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก RPC ใหม่/ที่เปลี่ยน จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น
--   ไม่นับรวมการอนุมัติรอบที่ 1) ก่อน merge PR นี้ ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของฟังก์ชันที่ replace ข้างบน
--   ที่ production กับนิยามใน 20261107010000_rubberflow_core.sql (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   ตรวจหลัง apply: เทียบ md5 ของฟังก์ชัน rf_* / app_rf_* กับ local stack ที่ผ่าน db:test, has_function_privilege (anon ไม่ได้ authenticated เฉพาะ RPC สาธารณะห้าตัว),
--   relrowsecurity + policy ของตาราง rf_* ทั้ง 13 ตาราง · Pilot Web รุ่นรอบที่ 1 ที่ยังเปิดอยู่จะทำงานไม่ครบกับฐานข้อมูลนี้ (ไม่รู้จักชุดใหม่ และ producedQty ถูกเมิน) ต้องโหลดหน้าใหม่
--
-- Rollback (ตารางใหม่มีแต่ข้อมูลทดสอบ) ลำดับสำคัญ:
--   1) คืนนิยามรอบที่ 1 ของ public.app_rf_save / app_sandbox_purge_rf และ private.rf_records / rf_delta / rf_client_actions / sandbox_unguarded_tables ด้วยการรัน create or replace จาก 20261107010000_rubberflow_core.sql (รวม revoke/grant ท้ายฟังก์ชัน)
--   2) drop function private.rf_save_orders (ลายเซ็น 8 พารามิเตอร์ของไฟล์นี้) และ private.rf_apply_feedback(text, public.rf_transfers, public.rf_orders) แล้วสร้างสองตัวนี้
--      ใหม่ตามนิยามรอบที่ 1 หลังเพิ่มคอลัมน์กลับ: alter table public.rf_orders add column fed_back_at timestamptz
--   3) drop function ใหม่ของไฟล์นี้: private.rf_save_molds, rf_save_material_lots, rf_save_requisitions, rf_save_lots, rf_save_transfers, rf_save_boxes, rf_save_qc, rf_save_ncrs,
--      rf_add_produced, rf_fail, rf_in_spec, rf_created_differs, rf_lab_specs
--   4) drop table (ลูกก่อนแม่): rf_ncrs, rf_qc_records, rf_fg_boxes, rf_transfers, rf_requisitions, rf_lots, rf_material_lots, rf_molds
--   ข้อมูลทดสอบของตารางใหม่หายไปพร้อมกัน · การป้อนกลับที่เขียนเข้างาน BOM แล้วไม่ถูกย้อนกลับ (เป็นข้อมูลของ BOM)
-- ============================================================================

-- 0. เลิกใช้ฟังก์ชัน/คอลัมน์ของรอบที่ 1 ที่ถูกแทน ----------------------------------------------------
drop function if exists private.rf_apply_feedback(text, public.rf_orders);
drop function if exists private.rf_save_orders(public.employees, text, boolean, boolean, boolean, boolean, text, jsonb, bigint, bigint);
alter table public.rf_orders drop column if exists fed_back_at;

-- 1. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
-- แม่พิมพ์ / หัวดาย / สายอบ: kind die|line|mold · per_cycle = ชิ้นต่อรอบ (นับ shot ของการอบ) · usage_* เซิร์ฟเวอร์เพิ่มตอนบันทึกฉีด/อบ
create table public.rf_molds (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  mold_no text not null check (mold_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  name text not null check (char_length(name) between 1 and 160),
  kind text not null default 'mold' check (kind in ('die', 'line', 'mold')),
  unit text not null default 'shot' check (char_length(unit) between 1 and 20),
  per_cycle numeric not null default 1 check (per_cycle > 0 and per_cycle <= 1000000),
  clean_every numeric not null check (clean_every > 0 and clean_every <= 1000000000),
  pm_limit numeric not null default 0 check (pm_limit >= 0 and pm_limit <= 1000000000),
  total_usage numeric not null default 0 check (total_usage >= 0 and total_usage <= 1000000000000),
  usage_since_clean numeric not null default 0 check (usage_since_clean >= 0 and usage_since_clean <= 1000000000000),
  last_clean_at timestamptz,
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (mold_no, is_test)
);
comment on table public.rf_molds is 'แม่พิมพ์ / หัวดาย / สายอบ (ข้อมูลหลัก) สมาชิก RB เพิ่ม/แก้ได้ · usage_* เพิ่มโดยเซิร์ฟเวอร์ตอนบันทึกฉีด/อบ ล้างด้วย cleanMold';

create table public.rf_material_lots (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  lot_no text not null check (lot_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  material_code text not null,
  qty_kg numeric not null check (qty_kg >= 0 and qty_kg <= 1000000000),
  initial_kg numeric not null check (initial_kg > 0 and initial_kg <= 1000000000),
  -- วันหมดอายุเป็นมิลลิวินาทีแบบ Date.now() ที่ client ใช้
  expiry bigint not null check (expiry > 0 and expiry <= 100000000000000),
  supplier text not null default '-' check (char_length(supplier) <= 120),
  location text not null default '' check (char_length(location) <= 160),
  status text not null default 'available' check (status in ('available', 'hold')),
  -- ใบรับรองคุณภาพ (CoA): true/false หรือวัตถุรายละเอียด (ไม่เกิน 2,000 ตัวอักษร)
  coa jsonb not null default 'false'::jsonb check (jsonb_typeof(coa) in ('boolean', 'object') and char_length(coa::text) <= 2000),
  received_by uuid references public.employees(id) on delete set null,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (material_code, is_test) references public.rf_materials(code, is_test),
  unique (id, is_test),
  unique (lot_no, is_test)
);
create index rf_material_lots_material_idx on public.rf_material_lots (is_test, material_code, expiry);
comment on table public.rf_material_lots is 'ล็อตวัตถุดิบในคลัง ST รับเข้า (ล็อตใหม่ available) ST/QA ตั้ง hold/available · qty_kg ลดโดยเซิร์ฟเวอร์ตอนชั่ง (weighLine) ไม่รับจาก client';

create table public.rf_requisitions (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  req_no text not null check (req_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  order_no text not null,
  recipe_code text not null,
  recipe_revision integer not null,
  batches numeric not null check (batches >= 1 and batches <= 10),
  total_kg numeric not null check (total_kg > 0 and total_kg <= 1000000000),
  -- [{materialCode, stage, lotNo, targetKg, actualKg, weighedAt, weighedBy}] จัดสรรโดยเซิร์ฟเวอร์ (FEFO) ตอนสร้างใบ
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 300),
  status text not null default 'weighing' check (status in ('weighing', 'issued', 'consumed')),
  note text not null default '' check (char_length(note) <= 300),
  requested_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by uuid references public.employees(id) on delete set null,
  -- เลขล็อตผสมที่ใช้ใบเบิกนี้ (ตั้งโดยเซิร์ฟเวอร์ตอนบันทึกผสม)
  consumed_by_lot text,
  updated_at timestamptz not null default now(),
  foreign key (order_no, is_test) references public.rf_orders(wo_no, is_test),
  foreign key (recipe_code, recipe_revision, is_test) references public.rf_recipes(recipe_code, revision, is_test),
  unique (id, is_test),
  unique (req_no, is_test)
);
create index rf_requisitions_status_idx on public.rf_requisitions (is_test, status);
comment on table public.rf_requisitions is 'ใบเบิกและชั่งเคมี weighing -> issued (ชั่งครบ) -> consumed (บันทึกผสม) เซิร์ฟเวอร์เปลี่ยนสถานะเองทั้งหมด';

create table public.rf_lots (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  lot_no text not null check (lot_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  stage text not null check (stage in ('mixing', 'extrusion', 'curing', 'finishing')),
  order_no text not null,
  -- สูตรของล็อตผสม (ล็อตสถานีอื่นไม่มี)
  recipe_code text,
  uom text not null check (char_length(uom) between 1 and 20),
  machine text not null default '' check (char_length(machine) <= 120),
  shift text not null default '' check (char_length(shift) <= 10),
  -- หัวดาย (ฉีด) หรือแม่พิมพ์/สายอบ (อบ)
  mold_id text,
  sources jsonb not null default '[]'::jsonb check (jsonb_typeof(sources) = 'array' and jsonb_array_length(sources) <= 20),
  params jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  good_qty numeric not null check (good_qty >= 0 and good_qty <= 1000000000),
  scrap_qty numeric not null default 0 check (scrap_qty >= 0 and scrap_qty <= 1000000000),
  scrap_reason text not null default '' check (char_length(scrap_reason) <= 200),
  qc text check (qc is null or qc in ('pass', 'hold', 'fail')),
  hold_reasons jsonb not null default '[]'::jsonb check (jsonb_typeof(hold_reasons) = 'array' and jsonb_array_length(hold_reasons) <= 50),
  transferred_qty numeric not null default 0 check (transferred_qty >= 0 and transferred_qty <= good_qty + 0.001),
  ready_at timestamptz,
  grade text not null default '' check (char_length(grade) <= 20),
  boxes integer check (boxes is null or boxes between 0 and 1000),
  counted_to_order boolean not null default false,
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_no, is_test) references public.rf_orders(wo_no, is_test),
  foreign key (mold_id, is_test) references public.rf_molds(mold_no, is_test),
  unique (id, is_test),
  unique (lot_no, is_test)
);
create index rf_lots_order_idx on public.rf_lots (is_test, order_no, stage);
comment on table public.rf_lots is 'ล็อตผลิตของ 4 สถานี (ผสม ฉีด อบ ตกแต่ง) สร้างผ่าน app_rf_save เท่านั้น · QC อัตโนมัติ readyAt transferred_qty counted_to_order เซิร์ฟเวอร์คำนวณเอง';

create table public.rf_transfers (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  transfer_no text not null check (transfer_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  lot_no text not null,
  order_no text not null,
  from_stage text not null check (from_stage in ('mixing', 'extrusion', 'curing')),
  to_stage text not null check (to_stage in ('extrusion', 'curing', 'finishing')),
  uom text not null check (char_length(uom) between 1 and 20),
  qty_sent numeric not null check (qty_sent > 0 and qty_sent <= 1000000000),
  qty_received numeric check (qty_received is null or (qty_received >= 0 and qty_received <= 1000000000)),
  remaining numeric not null default 0 check (remaining >= 0 and remaining <= 1000000000),
  condition text check (condition is null or char_length(condition) <= 40),
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'in_transit' check (status in ('in_transit', 'received')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  received_by uuid references public.employees(id) on delete set null,
  received_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (lot_no, is_test) references public.rf_lots(lot_no, is_test),
  foreign key (order_no, is_test) references public.rf_orders(wo_no, is_test),
  unique (id, is_test),
  unique (transfer_no, is_test)
);
create index rf_transfers_status_idx on public.rf_transfers (is_test, status);
comment on table public.rf_transfers is 'ใบส่งมอบ WIP ระหว่างสถานี in_transit -> received (SR รับมอบ) · remaining ลดโดยเซิร์ฟเวอร์ตอนบันทึกสถานีถัดไป · รับมอบป้อนผลผลิตกลับงาน BOM';

create table public.rf_fg_boxes (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  box_no text not null check (box_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  lot_no text not null,
  order_no text not null,
  recipe_code text not null,
  product_code text not null default '' check (char_length(product_code) <= 60),
  qty numeric not null check (qty > 0 and qty <= 1000000000),
  uom text not null check (char_length(uom) between 1 and 20),
  grade text not null default '' check (char_length(grade) <= 20),
  status text not null default 'in_stock' check (status in ('in_stock', 'hold', 'shipped')),
  created_at timestamptz not null default now(),
  shipped_at timestamptz,
  shipped_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (lot_no, is_test) references public.rf_lots(lot_no, is_test),
  foreign key (order_no, is_test) references public.rf_orders(wo_no, is_test),
  unique (id, is_test),
  unique (box_no, is_test)
);
create index rf_fg_boxes_lot_idx on public.rf_fg_boxes (is_test, lot_no);
comment on table public.rf_fg_boxes is 'กล่องสินค้าสำเร็จรูป สร้างโดยเซิร์ฟเวอร์จากการบันทึกตกแต่งเท่านั้น · WH ส่งมอบ in_stock -> shipped · QC เปลี่ยน in_stock <-> hold';

create table public.rf_qc_records (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  qc_no text not null check (qc_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  lot_no text not null,
  order_no text not null,
  stage text not null check (stage in ('mixing', 'extrusion', 'curing', 'finishing')),
  -- [{key, value, pass}] pass คำนวณโดยเซิร์ฟเวอร์จาก SPECS.lab
  tests jsonb not null check (jsonb_typeof(tests) = 'array' and jsonb_array_length(tests) between 1 and 20),
  result text not null check (result in ('pass', 'hold', 'fail')),
  note text not null default '' check (char_length(note) <= 300),
  tested_by uuid references public.employees(id) on delete set null,
  tested_at timestamptz not null default now(),
  foreign key (lot_no, is_test) references public.rf_lots(lot_no, is_test),
  foreign key (order_no, is_test) references public.rf_orders(wo_no, is_test),
  unique (id, is_test),
  unique (qc_no, is_test)
);
create index rf_qc_records_lot_idx on public.rf_qc_records (is_test, lot_no);
comment on table public.rf_qc_records is 'ผลตรวจ QC ของล็อตผลิต (ต่อท้ายอย่างเดียว แก้/ลบไม่ได้) QA บันทึก ผลตัดสินตั้งสถานะ QC ของล็อต';

create table public.rf_ncrs (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  ncr_no text not null check (ncr_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  title text not null check (char_length(title) between 1 and 200),
  stage text not null default '' check (stage in ('', 'warehouse', 'mixing', 'extrusion', 'curing', 'finishing', 'fg')),
  lot_no text not null check (lot_no ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$'),
  severity text not null default 'major' check (severity in ('minor', 'major', 'critical')),
  defect_qty numeric not null default 0 check (defect_qty >= 0 and defect_qty <= 1000000000),
  -- 5 Why: ข้อความไม่เกิน 10 บรรทัด
  whys jsonb not null default '[]'::jsonb check (jsonb_typeof(whys) = 'array' and jsonb_array_length(whys) <= 10),
  containment text not null default '' check (char_length(containment) <= 1000),
  corrective text not null default '' check (char_length(corrective) <= 1000),
  preventive text not null default '' check (char_length(preventive) <= 1000),
  owner text not null default '' check (char_length(owner) <= 120),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  closed_by uuid references public.employees(id) on delete set null,
  closed_at timestamptz,
  verification text not null default '' check (char_length(verification) <= 1000),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (ncr_no, is_test)
);
create index rf_ncrs_status_idx on public.rf_ncrs (is_test, status);
comment on table public.rf_ncrs is 'NCR ของ RubberFlow open -> closed (ปิดต้องมี corrective + preventive) QA เปิด/แก้/ปิด สมาชิก RB กรอก corrective/preventive ได้';

create index rf_molds_changed_idx on public.rf_molds (is_test, changed_version);
create index rf_material_lots_changed_idx on public.rf_material_lots (is_test, changed_version);
create index rf_requisitions_changed_idx on public.rf_requisitions (is_test, changed_version);
create index rf_lots_changed_idx on public.rf_lots (is_test, changed_version);
create index rf_transfers_changed_idx on public.rf_transfers (is_test, changed_version);
create index rf_fg_boxes_changed_idx on public.rf_fg_boxes (is_test, changed_version);
create index rf_qc_records_changed_idx on public.rf_qc_records (is_test, changed_version);
create index rf_ncrs_changed_idx on public.rf_ncrs (is_test, changed_version);
comment on column public.rf_molds.changed_version is 'เวอร์ชันของ rf_master_state ที่แก้แถวนี้ล่าสุด (trigger rf_stamp_version ตั้งให้ ไม่รับจาก client) ใช้ตรวจชนรายระเบียนและคำนวณ delta';
comment on column public.rf_material_lots.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_requisitions.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_lots.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_transfers.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_fg_boxes.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_qc_records.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';
comment on column public.rf_ncrs.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (ดู rf_molds.changed_version)';

-- 2. แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ใช้ rf_stamp_version() ของรอบที่ 1) ---------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array['rf_molds', 'rf_material_lots', 'rf_requisitions', 'rf_lots', 'rf_transfers', 'rf_fg_boxes', 'rf_qc_records', 'rf_ncrs'] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.sandbox_row_scope()', v_table || '_sandbox_scope', v_table);
    execute format(
      'create trigger %I before insert or update on public.%I '
      'for each row execute function private.rf_stamp_version()', v_table || '_stamp_version', v_table);
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;

select private.lab_only_guard_table('public.rf_molds');
select private.lab_only_guard_table('public.rf_material_lots');
select private.lab_only_guard_table('public.rf_requisitions');
select private.lab_only_guard_table('public.rf_lots');
select private.lab_only_guard_table('public.rf_transfers');
select private.lab_only_guard_table('public.rf_fg_boxes');
select private.lab_only_guard_table('public.rf_qc_records');
select private.lab_only_guard_table('public.rf_ncrs');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261107010000_rubberflow_core.sql ทุกชื่อ แล้วเพิ่ม rf_* แปดตาราง)
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
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 3. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ชื่อ action ของ client ที่เขียนข้อมูลได้ (รอบที่ 1 + รอบที่ 2) ใช้ตรวจ p_action
create or replace function private.rf_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveMaterial', 'createRecipe', 'saveRecipe', 'approveRecipe', 'createOrder', 'setOrderStatus',
    'recordMixing', 'recordExtrusion', 'recordCuring', 'recordFinishing', 'addQcRecord',
    'receiveMaterial', 'setMaterialLotStatus', 'createRequisition', 'weighLine', 'endRest',
    'createTransfer', 'receiveTransfer', 'shipBoxes', 'createNcr', 'updateNcr', 'closeNcr', 'cleanMold', 'saveMold']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- ผิดเงื่อนไข: ถ้าแถวที่เกี่ยวข้องถูกคนอื่นแก้หลังเวอร์ชันฐาน (client ถือสำเนาเก่า) = RF_STALE ไม่เช่นนั้นข้อผิดพลาดที่ระบุ (p_changed null = ไม่มีแถวให้เทียบ)
create or replace function private.rf_fail(p_changed bigint, p_base bigint, p_cur bigint, p_error text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_changed is not null and p_changed > p_base and p_changed <= p_cur then
    raise exception 'RF_STALE';
  end if;
  raise exception '%', p_error;
end;
$$;
revoke all on function private.rf_fail(bigint, bigint, bigint, text) from public, anon, authenticated;

-- ค่าอยู่ในสเปกหรือไม่ (เหมือน inSpec ใน modules/rubberflow-rules.js): ค่าว่างไม่ผ่าน, p_min = ขั้นต่ำ, p_target ± p_tol (เผื่อ 1e-9)
create or replace function private.rf_in_spec(p_value numeric, p_target numeric, p_tol numeric, p_min numeric)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_value is not null
     and (p_min is null or p_value >= p_min)
     and (p_target is null or abs(p_value - p_target) <= p_tol + 0.000000001)
$$;
revoke all on function private.rf_in_spec(numeric, numeric, numeric, numeric) from public, anon, authenticated;

-- สเปกห้องแล็บ (SPECS.lab ของ modules/rubberflow-rules.js) ต้องตรงกัน
create or replace function private.rf_lab_specs()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{"hardness":{"target":65,"tol":5},"tensile":{"min":10},"elongation":{"min":300},"sg":{"target":1.18,"tol":0.03},"t90":{"target":3.2,"tol":0.5}}'::jsonb
$$;
revoke all on function private.rf_lab_specs() from public, anon, authenticated;

-- ระเบียนที่ client ส่งมาอ้างเวลาสร้าง (createdAt ฯลฯ) ต่างจากแถวที่เก็บ = client "สร้างใหม่" ด้วยเลขที่มีอยู่แล้ว (เลขเอกสารชนกัน)
-- ไม่มีช่องเวลาในระเบียน = ไม่ถือว่าต่าง (สำเนาที่ client ได้จากเซิร์ฟเวอร์มีช่องเวลาตรงกับที่เก็บเสมอ)
create or replace function private.rf_created_differs(p_row jsonb, p_keys text[], p_stored timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1 from unnest(p_keys) k
    where jsonb_typeof(p_row -> k) = 'number' and (p_row ->> k)::numeric <> private.bom_ms(p_stored))
$$;
revoke all on function private.rf_created_differs(jsonb, text[], timestamptz) from public, anon, authenticated;

-- ยอดผลิตเข้าใบ (เหมือน addProduced ของ client): เพิ่มได้อย่างเดียว ใบ planned / released / cancelled รับไม่ได้ (RF_INVALID_ORDER)
-- ใบ in_progress ปิดเองเป็น completed เมื่อครบเป้าหมายและผู้บันทึกปิดใบได้ (p_may_close)
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
  select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = p_order for update;
  if not found or not (p_qty > 0) then return; end if;
  if v_ord.status in ('planned', 'released', 'cancelled') then
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
revoke all on function private.rf_add_produced(text, numeric, boolean, bigint, bigint) from public, anon, authenticated;

-- 4. ตัวเขียนของรอบที่ 2 (เรียกจาก app_rf_save เท่านั้น) ----------------------------------------------
-- แม่พิมพ์ / หัวดาย: เพิ่ม/แก้ข้อมูลหลัก (สมาชิก RB หรือกลุ่มวางแผน = p_may) และล้าง (p_action = 'cleanMold') · usage_* / last_clean_at ของ client เมินยกเว้นตอนสร้างครั้งแรก
-- (ยอดสะสมตั้งต้น) และตอนล้าง · ระเบียนที่ต่างกันเฉพาะช่องที่เซิร์ฟเวอร์คำนวณ (usage) = ไม่ทำอะไร
create or replace function private.rf_save_molds(p_actor uuid, p_may boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_name text;
  v_kind text;
  v_unit text;
  v_per numeric;
  v_every numeric;
  v_pm numeric;
  v_total numeric;
  v_since numeric;
  v_clean_ms numeric;
  v_old public.rf_molds%rowtype;
  v_master boolean;
  v_clean boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MOLD'; end if;
    v_id := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_MOLD');
    if v_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_id = any (v_seen) then raise exception 'RF_INVALID_MOLD'; end if;
    v_seen := v_seen || v_id;
    v_name := private.bom_text(v_row, 'name', 160, 1, 'RF_INVALID_MOLD');
    v_kind := coalesce(nullif(private.bom_text(v_row, 'kind', 10, 0, 'RF_INVALID_MOLD'), ''), 'mold');
    if v_kind not in ('die', 'line', 'mold') then raise exception 'RF_INVALID_MOLD'; end if;
    v_unit := coalesce(nullif(private.bom_text(v_row, 'unit', 20, 0, 'RF_INVALID_MOLD'), ''), 'shot');
    v_per := coalesce(private.bom_num(v_row -> 'perCycle', 'RF_INVALID_MOLD', 0, 1000000), 1);
    v_every := private.bom_num(v_row -> 'cleanEvery', 'RF_INVALID_MOLD', 0, 1000000000);
    v_pm := coalesce(private.bom_num(v_row -> 'pmLimit', 'RF_INVALID_MOLD', 0, 1000000000), 0);
    v_total := coalesce(private.bom_num(v_row -> 'totalUsage', 'RF_INVALID_MOLD', 0, 1000000000), 0);
    v_since := coalesce(private.bom_num(v_row -> 'usageSinceClean', 'RF_INVALID_MOLD', 0, 1000000000), 0);
    v_clean_ms := private.bom_num(v_row -> 'lastCleanAt', 'RF_INVALID_MOLD', 0, 100000000000000);
    if v_per <= 0 or v_every is null or v_every <= 0 then raise exception 'RF_INVALID_MOLD'; end if;

    select * into v_old from public.rf_molds m where m.is_test and m.mold_no = v_id;
    if found then
      v_master := v_old.name <> v_name or v_old.kind <> v_kind or v_old.unit <> v_unit or v_old.per_cycle <> v_per
        or v_old.clean_every <> v_every or v_old.pm_limit <> v_pm;
      -- ล้าง: action cleanMold และ client ตั้งยอดสะสมหลังล้างเป็น 0 (และมีอะไรให้ล้าง หรือบันทึกเวลาล้างใหม่)
      v_clean := p_action = 'cleanMold' and v_since = 0
        and (v_old.usage_since_clean > 0 or (v_clean_ms is not null and v_clean_ms <> coalesce(private.bom_ms(v_old.last_clean_at), -1)));
      if not (v_master or v_clean) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      if not p_may then raise exception 'RF_FORBIDDEN'; end if;
      update public.rf_molds set
        name = v_name, kind = v_kind, unit = v_unit, per_cycle = v_per, clean_every = v_every, pm_limit = v_pm,
        usage_since_clean = case when v_clean then 0 else usage_since_clean end,
        last_clean_at = case when v_clean then now() else last_clean_at end,
        updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      if not p_may then raise exception 'RF_FORBIDDEN'; end if;
      insert into public.rf_molds (is_test, mold_no, name, kind, unit, per_cycle, clean_every, pm_limit, total_usage, usage_since_clean, last_clean_at, created_by, updated_by)
      values (true, v_id, v_name, v_kind, v_unit, v_per, v_every, v_pm, v_total, v_since,
              case when v_clean_ms is null then null else to_timestamp(v_clean_ms / 1000.0) end, p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_molds(uuid, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- ล็อตวัตถุดิบ: ST (หรือกลุ่มวางแผน) รับเข้าเป็นล็อตใหม่ available · ST/QA (หรือกลุ่มวางแผน) ตั้ง available <-> hold · เนื้อหาของล็อตเดิมแก้ไม่ได้
-- (RF_INVALID_MATLOT) · qty_kg / initial_kg ของล็อตเดิมที่ client ส่งมาเมิน (เซิร์ฟเวอร์ลดเองตอนชั่ง) · ผู้รับ/เวลาเซิร์ฟเวอร์ตั้ง
create or replace function private.rf_save_material_lots(p_actor uuid, p_planner boolean, p_st boolean, p_qa boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_code text;
  v_qty numeric;
  v_exp numeric;
  v_sup text;
  v_loc text;
  v_status text;
  v_node jsonb;
  v_coa jsonb;
  v_old public.rf_material_lots%rowtype;
  v_mat public.rf_materials%rowtype;
  v_content boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MATLOT'; end if;
    v_no := private.bom_text(v_row, 'lotNo', 60, 1, 'RF_INVALID_MATLOT');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_MATLOT'; end if;
    v_seen := v_seen || v_no;
    v_code := private.bom_text(v_row, 'materialCode', 40, 1, 'RF_INVALID_MATLOT');
    v_qty := private.bom_num(v_row -> 'qtyKg', 'RF_INVALID_MATLOT', 0, 1000000000);
    v_exp := private.bom_num(v_row -> 'expiry', 'RF_INVALID_MATLOT', 1, 100000000000000);
    if v_exp is null or v_exp <> trunc(v_exp) then raise exception 'RF_INVALID_MATLOT'; end if;
    v_sup := coalesce(nullif(private.bom_text(v_row, 'supplier', 120, 0, 'RF_INVALID_MATLOT'), ''), '-');
    v_loc := private.bom_text(v_row, 'location', 160, 0, 'RF_INVALID_MATLOT');
    v_status := coalesce(nullif(private.bom_text(v_row, 'status', 10, 0, 'RF_INVALID_MATLOT'), ''), 'available');
    if v_status not in ('available', 'hold') then raise exception 'RF_INVALID_MATLOT'; end if;
    v_node := v_row -> 'coa';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_coa := 'false'::jsonb;
    elsif jsonb_typeof(v_node) in ('boolean', 'object') and char_length(v_node::text) <= 2000 then
      v_coa := v_node;
    else
      raise exception 'RF_INVALID_MATLOT';
    end if;

    select * into v_old from public.rf_material_lots l where l.is_test and l.lot_no = v_no;
    if found then
      -- เลขล็อตซ้ำกับที่คนอื่นเพิ่งรับเข้า (เวลารับเข้าต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['receivedAt'], v_old.received_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      v_content := v_old.material_code <> v_code or v_old.expiry <> v_exp::bigint or v_old.supplier <> v_sup
        or v_old.location <> v_loc or v_old.coa <> v_coa;
      if not (v_content or v_old.status <> v_status) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      if not (p_planner or p_st or p_qa) then raise exception 'RF_FORBIDDEN'; end if;
      if v_content then raise exception 'RF_INVALID_MATLOT'; end if;
      update public.rf_material_lots set status = v_status, updated_at = now() where id = v_old.id;
      continue;
    end if;

    -- ล็อตใหม่ = ST (หรือกลุ่มวางแผน) รับเข้า เริ่มที่ available เสมอ
    if not (p_planner or p_st) then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'available' then raise exception 'RF_INVALID_TRANSITION'; end if;
    select * into v_mat from public.rf_materials m where m.is_test and m.code = v_code;
    if not found or not v_mat.active then raise exception 'RF_INVALID_MATLOT'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'RF_INVALID_MATLOT'; end if;
    if v_exp <= private.bom_ms(now()) then raise exception 'RF_INVALID_MATLOT'; end if;
    insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry, supplier, location, status, coa, received_by)
    values (true, v_no, v_mat.code, v_qty, v_qty, v_exp::bigint, v_sup, coalesce(nullif(v_loc, ''), v_mat.storage_location), 'available', v_coa, p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- ใบเบิก: สร้างใหม่ = เซิร์ฟเวอร์ระเบิดสูตรของ WO × จำนวน batch แล้วจัดสรร FEFO เองในธุรกรรมเดียว (บรรทัดที่ client ส่งมาเมิน) · ชั่ง = ระเบียนเดิมที่ client
-- ใส่ actualKg ของบรรทัดที่ยังไม่ชั่ง (ช่องอื่นของใบเดิม รวม status/issued/consumed เมิน: เซิร์ฟเวอร์เปลี่ยนเอง) p_may = สมาชิก RB หรือกลุ่มวางแผน
create or replace function private.rf_save_requisitions(p_actor uuid, p_actor_name text, p_may boolean, p_rows jsonb, p_base bigint, p_cur bigint)
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
  v_need numeric;
  v_left numeric;
  v_free numeric;
  v_take numeric;
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
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_REQ'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_REQ');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_REQ'; end if;
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
        if v_sact is not null or v_cact is null then raise exception 'RF_INVALID_REQ'; end if;
        v_target := (v_sline ->> 'targetKg')::numeric;
        v_tol := greatest(0.02, v_target * 1.5 / 100);
        if abs(v_cact - v_target) > v_tol + 0.000000001 then raise exception 'RF_INVALID_REQ'; end if;
        select * into v_lot from public.rf_material_lots l where l.is_test and l.lot_no = (v_sline ->> 'lotNo') for update;
        if not found then raise exception 'RF_INVALID_REQ'; end if;
        if v_lot.status = 'hold' or v_lot.qty_kg <= 0.0001 or v_lot.expiry <= v_now_ms or v_lot.qty_kg < v_cact then
          perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_REQ');
        end if;
        update public.rf_material_lots set qty_kg = greatest(0, trim_scale(round(v_lot.qty_kg - v_cact, 6))), updated_at = now() where id = v_lot.id;
        v_lines := jsonb_set(v_lines, array[v_i::text],
          (v_lines -> v_i) || jsonb_build_object('actualKg', v_cact, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
      end loop;
      v_done := not exists (select 1 from jsonb_array_elements(v_lines) e where jsonb_typeof(e -> 'actualKg') is distinct from 'number');
      update public.rf_requisitions set
        lines = v_lines,
        status = case when v_done then 'issued' else status end,
        issued_at = case when v_done then now() else issued_at end,
        issued_by = case when v_done then p_actor else issued_by end,
        updated_at = now()
      where id = v_old.id;
      continue;
    end if;

    -- ใบใหม่: สมาชิก RB / กลุ่มวางแผน · WO ต้อง released หรือ in_progress · เซิร์ฟเวอร์จัดสรร FEFO เอง
    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    v_order := private.bom_text(v_row, 'orderId', 40, 1, 'RF_INVALID_REQ');
    v_batches := private.bom_num(v_row -> 'batches', 'RF_INVALID_REQ', 1, 10);
    if v_batches is null then raise exception 'RF_INVALID_REQ'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_REQ');
    select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order;
    if not found then raise exception 'RF_INVALID_REQ'; end if;
    if v_ord.status not in ('released', 'in_progress') then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_REQ');
    end if;
    select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_ord.recipe_code and r.revision = v_ord.recipe_revision;
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
        -- คงเหลือที่จองได้ = สต็อก - ที่ใบเบิกอื่น (ยัง weighing) จองบรรทัดที่ยังไม่ชั่ง - ที่ใบนี้จัดสรรไปแล้ว
        v_free := v_lot.qty_kg
          - coalesce((select sum((e ->> 'targetKg')::numeric)
                      from public.rf_requisitions q, jsonb_array_elements(q.lines) e
                      where q.is_test and q.status = 'weighing' and e ->> 'lotNo' = v_lot.lot_no
                        and jsonb_typeof(e -> 'actualKg') is distinct from 'number'), 0)
          - coalesce((select sum((e ->> 'targetKg')::numeric) from jsonb_array_elements(v_new_lines) e where e ->> 'lotNo' = v_lot.lot_no), 0);
        continue when v_free <= 0.0001;
        v_take := round(least(v_free, v_left), 4);
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
    insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines, status, note, requested_by)
    values (true, v_no, v_order, v_ord.recipe_code, v_ord.recipe_revision, v_batches,
            trim_scale(round(v_rec.batch_kg * v_batches, 4)), v_new_lines, 'weighing', v_note, p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_requisitions(uuid, text, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- ล็อตผลิต 4 สถานี: ล็อตใหม่ = สมาชิก RB / กลุ่มวางแผน (p_may) บันทึกผสม/ฉีด/อบ/ตกแต่ง · ล็อตเดิมไม่มีช่องที่ client แก้ได้ นอกจาก readyAt ของล็อตผสมผ่าน action endRest
-- (เซิร์ฟเวอร์ตั้งเป็นเวลาปัจจุบัน) · QC อัตโนมัติ/ผู้บันทึก/เวลา/สถานะที่ client ส่งมาเมินหมด เซิร์ฟเวอร์คำนวณจากสูตร สเปก และเอกสารต้นทาง
-- (ผสม <- ใบเบิกสถานะ issued · ฉีด/อบ/ตกแต่ง <- ใบส่งมอบ received ที่ส่งมาสถานีนี้ ยอดที่ใช้ไม่เกินคงเหลือ) ผลข้างเคียงในธุรกรรมเดียวกัน: ใบเบิก -> consumed, WO released ->
-- in_progress, ยอดคงเหลือของใบส่งมอบลด, ยอดสะสมแม่พิมพ์เพิ่ม, ตกแต่งสร้างกล่อง + นับยอดผลิตเข้า WO (p_may_close = ปิด WO เองเมื่อครบเป้าหมาย)
create or replace function private.rf_save_lots(
  p_actor public.employees, p_actor_name text, p_may boolean, p_may_close boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
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
  v_temp numeric;
  v_time numeric;
  v_press numeric;
  v_shots numeric;
  v_cid text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_LOT'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_LOT');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_LOT'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_lots l where l.is_test and l.lot_no = v_no;
    if found then
      -- เลขล็อตซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- ล็อตเดิม: ข้ามเวลาบ่ม (endRest) ได้อย่างเดียว ช่องอื่นเป็นของเซิร์ฟเวอร์
      if p_action = 'endRest' and v_old.ready_at is not null and jsonb_typeof(v_row -> 'readyAt') = 'number'
         and (v_row ->> 'readyAt')::numeric <> private.bom_ms(v_old.ready_at) then
        if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
        if not p_may then raise exception 'RF_FORBIDDEN'; end if;
        update public.rf_lots set ready_at = now(), updated_at = now() where id = v_old.id and ready_at > now();
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

    if v_stage = 'mixing' then
      select * into v_req from public.rf_requisitions q where q.is_test and q.req_no = v_src_id for update;
      if not found then raise exception 'RF_INVALID_LOT'; end if;
      if v_req.status <> 'issued' then
        perform private.rf_fail(v_req.changed_version, p_base, p_cur, 'RF_INVALID_TRANSITION');
      end if;
      v_order_no := v_req.order_no;
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_req.recipe_code and r.revision = v_req.recipe_revision;
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
      select * into v_tr from public.rf_transfers t where t.is_test and t.transfer_no = v_src_id for update;
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
      select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order_no;
      v_uom := v_ord.uom;
      v_sources := jsonb_build_array(jsonb_build_object('type', 'transfer', 'id', v_tr.transfer_no, 'lotId', v_tr.lot_no, 'qty', v_use));

      if v_stage = 'extrusion' then
        v_rework := coalesce(private.bom_num(v_params -> 'reworkKg', 'RF_INVALID_LOT', 0, 1000000000), 0);
        v_pct := v_rework / (v_use + v_rework) * 100;
        if v_pct > 10 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'dieId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test and m.mold_no = v_mold_id for update;
        if not found then raise exception 'RF_INVALID_LOT'; end if;
        v_thick := private.bom_num(v_params -> 'thickness', 'RF_INVALID_LOT', 0, 1000000);
        v_width := private.bom_num(v_params -> 'width', 'RF_INVALID_LOT', 0, 1000000);
        v_wpm := private.bom_num(v_params -> 'weightPerM', 'RF_INVALID_LOT', 0, 1000000);
        if v_thick is null or v_width is null or v_wpm is null then raise exception 'RF_INVALID_LOT'; end if;
        if not private.rf_in_spec(v_thick, 2.5, 0.12, null) then
          v_reasons := v_reasons || to_jsonb('ความหนา ' || trim_scale(v_thick)::text || ' mm นอกสเปก');
        end if;
        if not private.rf_in_spec(v_width, 18, 0.25, null) then
          v_reasons := v_reasons || to_jsonb('ความกว้าง ' || trim_scale(v_width)::text || ' mm นอกสเปก');
        end if;
        if not private.rf_in_spec(v_wpm, 160, 6, null) then
          v_reasons := v_reasons || to_jsonb('น้ำหนักต่อเมตร ' || trim_scale(v_wpm)::text || ' g/m นอกสเปก');
        end if;
        v_out := jsonb_build_object('thickness', v_thick, 'width', v_width, 'weightPerM', v_wpm,
                                    'reworkKg', v_rework, 'reworkPct', trim_scale(round(v_pct, 2)), 'useKg', v_use);
      elsif v_stage = 'curing' then
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_mold_id := private.bom_text(v_row, 'moldId', 60, 1, 'RF_INVALID_LOT');
        select * into v_mold from public.rf_molds m where m.is_test and m.mold_no = v_mold_id for update;
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
        v_perbox := private.bom_num(v_params -> 'perBox', 'RF_INVALID_LOT', 0, 1000000000);
        if v_perbox is null or v_perbox <= 0 then raise exception 'RF_INVALID_LOT'; end if;
        if v_good + v_scrap > v_use + 0.000000001 then raise exception 'RF_INVALID_LOT'; end if;
        v_grade := coalesce(nullif(private.bom_text(v_row, 'grade', 20, 0, 'RF_INVALID_LOT'), ''), 'A');
        v_boxes := case when v_good > 0 then ceil(v_good / v_perbox)::integer else 0 end;
        if v_boxes > 1000 then raise exception 'RF_INVALID_LOT'; end if;
        v_out := jsonb_build_object('perBox', v_perbox);
      end if;
    end if;

    -- ล็อตที่ client ระบุใบสั่งผลิตต่างจากเอกสารต้นทาง = ผิด
    v_cid := nullif(private.bom_text(v_row, 'orderId', 40, 0, 'RF_INVALID_LOT'), '');
    if v_cid is not null and v_cid <> v_order_no then raise exception 'RF_INVALID_LOT'; end if;

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
      true, v_no, v_stage, v_order_no, case when v_stage = 'mixing' then v_rec.recipe_code end, v_uom, v_machine, v_shift, v_mold_id,
      v_sources, v_out, v_good, v_scrap, v_reason, v_qc, v_reasons, 0, v_ready, v_grade, v_boxes, (v_stage = 'finishing' and v_qc = 'pass'), p_actor.id);

    -- ผลข้างเคียง (ธุรกรรมเดียวกัน) ---------------------------------------------------------------
    if v_stage = 'mixing' then
      update public.rf_requisitions set status = 'consumed', consumed_by_lot = v_no, updated_at = now() where id = v_req.id;
      update public.rf_orders set status = 'in_progress', updated_at = now() where is_test and wo_no = v_order_no and status = 'released';
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
          values (true, regexp_replace(v_no, 'FN', 'BOX') || '-' || lpad(v_i::text, 3, '0'), v_no, v_order_no, v_ord.recipe_code, v_ord.product_code,
                  trim_scale(round(least(v_perbox, v_good - (v_i - 1) * v_perbox), 3)), v_uom, v_grade,
                  case when v_qc = 'pass' then 'in_stock' else 'hold' end);
        end loop;
        if v_qc = 'pass' then
          perform private.rf_add_produced(v_order_no, v_good, p_may_close, p_base, p_cur);
        end if;
      end if;
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- ใบ WO (นิยามจาก 20261107010000_rubberflow_core.sql ตัดส่วนที่ย้ายไป: producedQty เป็นของเซิร์ฟเวอร์ (client ส่งมาเมิน) ไม่มีกฎ QA เขียนใบ ไม่ป้อนกลับงาน BOM ตอนปิด)
-- สิทธิ์ + กฎสถานะ + ผูก/ล้างการผูกงาน BOM (ดูหัวไฟล์รอบที่ 1) คืนจำนวนแถว BOM ที่เขียน { jobs, orders }
-- p_planner = กลุ่มวางแผน · p_rb = สมาชิก RB · p_head = หัว RB
create or replace function private.rf_save_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rb boolean, p_head boolean,
  p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_wo text;
  v_customer text;
  v_po text;
  v_rcode text;
  v_rrev numeric;
  v_color text;
  v_target numeric;
  v_tkg numeric;
  v_kpu numeric;
  v_prod numeric;
  v_start numeric;
  v_due numeric;
  v_priority text;
  v_note text;
  v_status text;
  v_src text;
  v_uom text;
  v_old public.rf_orders%rowtype;
  v_new public.rf_orders%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_job public.bom_jobs%rowtype;
  v_content boolean;
  v_status_changed boolean;
  v_flow boolean;
  v_res jsonb;
  v_bom_jobs integer := 0;
  v_bom_orders integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_ORDER'; end if;
    v_wo := private.bom_text(v_row, 'id', 40, 1, 'RF_INVALID_ORDER');
    if v_wo !~ '^[A-Za-z0-9._-]{1,40}$' or v_wo = any (v_seen) then raise exception 'RF_INVALID_ORDER'; end if;
    v_seen := v_seen || v_wo;
    v_customer := btrim(regexp_replace(private.bom_text(v_row, 'customer', 120, 1, 'RF_INVALID_ORDER'), '\s+', ' ', 'g'));
    v_po := private.bom_text(v_row, 'customerPo', 60, 0, 'RF_INVALID_ORDER');
    v_rcode := private.bom_text(v_row, 'recipeId', 60, 1, 'RF_INVALID_ORDER');
    v_rrev := private.bom_num(v_row -> 'recipeRevision', 'RF_INVALID_ORDER', 1, 9999);
    if v_rrev is not null and v_rrev <> trunc(v_rrev) then raise exception 'RF_INVALID_ORDER'; end if;
    v_color := private.bom_text(v_row, 'color', 40, 0, 'RF_INVALID_ORDER');
    v_target := private.bom_num(v_row -> 'targetQty', 'RF_INVALID_ORDER', 0, 1000000000);
    if v_target is null or v_target <= 0 then raise exception 'RF_INVALID_ORDER'; end if;
    v_tkg := private.bom_num(v_row -> 'targetKg', 'RF_INVALID_ORDER', 0, 1000000000);
    v_kpu := private.bom_num(v_row -> 'kgPerUnit', 'RF_INVALID_ORDER', 0, 1000000000);
    v_prod := coalesce(private.bom_num(v_row -> 'producedQty', 'RF_INVALID_ORDER', 0, 1000000000), 0);
    v_start := private.bom_num(v_row -> 'startDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    v_due := private.bom_num(v_row -> 'dueDate', 'RF_INVALID_ORDER', 1, 100000000000000);
    if v_start is null or v_due is null or v_start <> trunc(v_start) or v_due <> trunc(v_due) or v_due < v_start then
      raise exception 'RF_INVALID_ORDER';
    end if;
    v_priority := coalesce(nullif(private.bom_text(v_row, 'priority', 10, 0, 'RF_INVALID_ORDER'), ''), 'normal');
    if v_priority not in ('normal', 'urgent') then raise exception 'RF_INVALID_ORDER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_ORDER');
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_ORDER');
    if v_status not in ('planned', 'released', 'in_progress', 'on_hold', 'completed', 'cancelled') then raise exception 'RF_INVALID_ORDER'; end if;
    v_src := nullif(private.bom_text(v_row, 'sourceJobId', 40, 0, 'RF_INVALID_ORDER'), '');
    if v_src is not null and v_src !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'RF_INVALID_ORDER'; end if;

    select * into v_old from public.rf_orders o where o.is_test and o.wo_no = v_wo;
    if found then
      -- ใบเดิม: เนื้อหาแก้ไม่ได้หลังสร้าง (recipeRevision ที่ client ไม่ส่งมาไม่นับ) · สถานะเปลี่ยนได้ตามกฎ · producedQty ที่ client ส่งมาเมิน (เซิร์ฟเวอร์นับจากล็อตตกแต่ง)
      v_content := v_old.customer <> v_customer or v_old.customer_po <> v_po or v_old.recipe_code <> v_rcode
        or (v_rrev is not null and v_old.recipe_revision <> v_rrev::integer) or v_old.color <> v_color
        or v_old.target_qty <> v_target or v_old.target_kg is distinct from v_tkg or v_old.kg_per_unit is distinct from v_kpu
        or v_old.start_date <> v_start::bigint or v_old.due_date <> v_due::bigint or v_old.priority <> v_priority
        or v_old.note <> v_note or v_old.source_job_no is distinct from v_src;
      v_status_changed := v_old.status <> v_status;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if not (v_content or v_status_changed) then continue; end if;

      -- ชนก่อนสิทธิ์/กฎเสมอ: สำเนาที่ต่างจากแถวล่าสุดและแถวนั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
      if v_content then raise exception 'RF_INVALID_ORDER'; end if;
      -- ปล่อยผลิต: กลุ่มวางแผนหรือหัว RB (ตรวจสิทธิ์ก่อนความถูกต้องของสถานะ)
      if v_status_changed and v_status = 'released' and not (p_planner or p_head) then raise exception 'RF_FORBIDDEN'; end if;
      if v_status_changed then
        v_flow := case v_old.status
          when 'planned' then v_status in ('released', 'cancelled')
          when 'released' then v_status in ('in_progress', 'on_hold', 'cancelled')
          when 'in_progress' then v_status in ('on_hold', 'completed')
          when 'on_hold' then v_status = 'in_progress'
          else false end;
        if not v_flow then raise exception 'RF_INVALID_TRANSITION'; end if;
      end if;

      update public.rf_orders set
        status = v_status,
        released_at = case when v_status = 'released' and v_status_changed then now() else released_at end,
        released_by = case when v_status = 'released' and v_status_changed then p_actor.id else released_by end,
        completed_at = case when v_status = 'completed' and v_status_changed then now() else completed_at end,
        cancelled_at = case when v_status = 'cancelled' and v_status_changed then now() else cancelled_at end,
        updated_at = now()
      where id = v_old.id
      returning * into v_new;
      -- ยกเลิก WO ที่ผูกงาน BOM: ล้างการผูกของงาน (ผูกกับ WO ใบใหม่ได้) ในธุรกรรมเดียวกัน
      if v_status_changed and v_status = 'cancelled' and v_new.source_job_no is not null then
        v_res := private.rf_unlink_job(p_actor_name, v_new);
        v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
        v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
      end if;
      continue;
    end if;

    -- ใบใหม่: กลุ่มวางแผนหรือสมาชิก RB เริ่มที่ planned เสมอ ยอดผลิต 0
    if not (p_planner or p_rb) then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'planned' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if v_prod <> 0 then raise exception 'RF_INVALID_ORDER'; end if;
    -- สูตร: ใช้ได้เฉพาะ approved (ไม่ระบุ revision = ตัวที่ approved อยู่) สูตรที่ถูกแก้หลังเวอร์ชันฐาน = ถือสำเนาเก่า
    if v_rrev is null then
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode and r.status = 'approved';
    else
      select * into v_rec from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode and r.revision = v_rrev::integer;
    end if;
    if not found or v_rec.status <> 'approved' then
      if exists (select 1 from public.rf_recipes r where r.is_test and r.recipe_code = v_rcode
                 and r.changed_version > p_base and r.changed_version <= p_cur) then
        raise exception 'RF_STALE';
      end if;
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_uom := v_rec.uom;
    if v_src is not null then
      -- ตรวจและล็อกงาน BOM ก่อนเขียน WO (ผิด = RF_INVALID_SOURCE_JOB) WO ใช้หน่วยของงาน
      v_job := private.rf_job_for_link(v_src);
      v_uom := v_job.uom;
    end if;
    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      true, v_wo, v_customer, v_po, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_uom, v_color,
      v_target, v_tkg, v_kpu, 0, v_start::bigint, v_due::bigint, v_priority, v_note, 'planned', v_src, p_actor.id);
    if v_src is not null then
      v_res := private.rf_link_job(v_job, p_actor_name, v_wo, coalesce(v_tkg, 0));
      v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
      v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_bom_jobs, 'orders', v_bom_orders);
end;
$$;
revoke all on function private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- ป้อนผลผลิตกลับงาน BOM ต่อใบส่งมอบ (เรียกตอน SR รับมอบ) ต่อรายงาน { good, reject = 0, note = "รับโอน TR-… จาก WO …" } บวก qty_done ตั้งสถานะ ดันใบ released -> in_progress
-- good = qtyReceived · ล็อตหน่วย kg แต่ WO ไม่ใช่หน่วย kg = qtyReceived / kgPerUnit ของ WO (ปัด 3 ตำแหน่ง ไม่มี kgPerUnit = ไม่เขียน)
-- ข้ามไม่เขียนเมื่อ WO ไม่ผูกงาน / ไม่พบงาน / external_ref ของงานไม่ชี้มา WO นี้ / ใบไม่ใช่ released-in_progress / งาน done แล้ว / good <= 0 คืน { jobs, orders }
-- ล็อกตัวนับ BOM ต่อจาก rf_master_state เหมือนเดิม (rf ก่อน bom) เฉพาะเมื่อ WO ผูกงาน
create or replace function private.rf_apply_feedback(p_actor_name text, p_transfer public.rf_transfers, p_wo public.rf_orders)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_good numeric;
  v_done numeric;
  v_status text;
  v_orders integer := 0;
begin
  if p_wo.source_job_no is null then return jsonb_build_object('jobs', 0, 'orders', 0); end if;
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test and j.job_no = p_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk for update;
  if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  if p_transfer.uom = 'kg' and p_wo.uom <> 'kg' then
    if coalesce(p_wo.kg_per_unit, 0) <= 0 then return jsonb_build_object('jobs', 0, 'orders', 0); end if;
    v_good := trim_scale(round(p_transfer.qty_received / p_wo.kg_per_unit, 3));
  else
    v_good := trim_scale(p_transfer.qty_received);
  end if;
  if v_good is null or v_good <= 0 then return jsonb_build_object('jobs', 0, 'orders', 0); end if;

  v_done := v_job.qty_done + v_good;
  v_status := case when v_done >= v_job.qty_planned then 'done' else 'in_progress' end;
  update public.bom_jobs set
    qty_done = v_done,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', v_good, 'reject', 0,
      'note', left('รับโอน ' || p_transfer.transfer_no || ' จาก WO ' || p_wo.wo_no, 200))),
    status = v_status,
    done_at = case when v_status = 'done' then coalesce(v_job.done_at, now()) else null end,
    updated_at = now()
  where id = v_job.id;
  if v_ord.status = 'released' then
    update public.bom_orders set status = 'in_progress', updated_at = now() where id = v_ord.id;
    v_orders := 1;
  end if;
  return jsonb_build_object('jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_apply_feedback(text, public.rf_transfers, public.rf_orders) from public, anon, authenticated;

-- ใบส่งมอบ: ใบใหม่ = สมาชิก RB / กลุ่มวางแผน (ล็อตต้อง QC ผ่าน บ่มครบ ยอดไม่เกินที่โอนได้ · from/to/WO/หน่วยมาจากล็อต) · รับมอบ = SR / กลุ่มวางแผน (in_transit -> received
-- พร้อม qtyReceived <= qtySent x 1.02) แล้วป้อนผลผลิตกลับงาน BOM ในธุรกรรมเดียวกัน · ช่องอื่นของใบเดิมที่ client ส่งมา (remaining ฯลฯ) เมิน
-- คืน { jobs, orders } ของ BOM ที่เขียน
create or replace function private.rf_save_transfers(
  p_actor public.employees, p_actor_name text, p_may_send boolean, p_may_receive boolean, p_rows jsonb, p_base bigint, p_cur bigint)
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
  v_old public.rf_transfers%rowtype;
  v_new public.rf_transfers%rowtype;
  v_lot public.rf_lots%rowtype;
  v_wo public.rf_orders%rowtype;
  v_q numeric;
  v_next text;
  v_avail numeric;
  v_note text;
  v_cond text;
  v_text text;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_TRANSFER'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_TRANSFER');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_TRANSFER'; end if;
    v_seen := v_seen || v_no;
    v_cstatus := private.bom_text(v_row, 'status', 12, 1, 'RF_INVALID_TRANSFER');
    if v_cstatus not in ('in_transit', 'received') then raise exception 'RF_INVALID_TRANSFER'; end if;

    select * into v_old from public.rf_transfers t where t.is_test and t.transfer_no = v_no;
    if found then
      -- เลขใบส่งมอบซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt', 'sentAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      if v_cstatus = v_old.status then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      if not p_may_receive then raise exception 'RF_FORBIDDEN'; end if;
      if v_cstatus <> 'received' or v_old.status <> 'in_transit' then raise exception 'RF_INVALID_TRANSITION'; end if;
      v_q := private.bom_num(v_row -> 'qtyReceived', 'RF_INVALID_TRANSFER', 0, 1000000000);
      if v_q is null or v_q > v_old.qty_sent * 1.02 + 0.000000001 then raise exception 'RF_INVALID_TRANSFER'; end if;
      v_cond := coalesce(nullif(private.bom_text(v_row, 'condition', 40, 0, 'RF_INVALID_TRANSFER'), ''), 'ok');
      update public.rf_transfers set
        status = 'received', qty_received = v_q, remaining = v_q, condition = v_cond,
        received_by = p_actor.id, received_at = now(), updated_at = now()
      where id = v_old.id
      returning * into v_new;
      select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = v_new.order_no;
      v_res := private.rf_apply_feedback(p_actor_name, v_new, v_wo);
      v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
      v_orders := v_orders + (v_res ->> 'orders')::integer;
      continue;
    end if;

    -- ใบใหม่ ---------------------------------------------------------------------------------
    if not p_may_send then raise exception 'RF_FORBIDDEN'; end if;
    if v_cstatus <> 'in_transit' then raise exception 'RF_INVALID_TRANSITION'; end if;
    v_text := private.bom_text(v_row, 'lotId', 60, 1, 'RF_INVALID_TRANSFER');
    v_q := private.bom_num(v_row -> 'qtySent', 'RF_INVALID_TRANSFER', 0, 1000000000);
    if v_q is null or v_q <= 0 then raise exception 'RF_INVALID_TRANSFER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_TRANSFER');
    select * into v_lot from public.rf_lots l where l.is_test and l.lot_no = v_text for update;
    if not found then raise exception 'RF_INVALID_TRANSFER'; end if;
    v_next := case v_lot.stage when 'mixing' then 'extrusion' when 'extrusion' then 'curing' when 'curing' then 'finishing' else null end;
    if v_next is null then raise exception 'RF_INVALID_TRANSFER'; end if;
    -- ที่มา/ปลายทาง/ใบสั่งผลิตที่ client ระบุต้องตรงกับล็อต (ค่าจริงมาจากล็อต)
    if (nullif(private.bom_text(v_row, 'from', 12, 0, 'RF_INVALID_TRANSFER'), '') is not null and private.bom_text(v_row, 'from', 12, 0, 'RF_INVALID_TRANSFER') <> v_lot.stage)
       or (nullif(private.bom_text(v_row, 'to', 12, 0, 'RF_INVALID_TRANSFER'), '') is not null and private.bom_text(v_row, 'to', 12, 0, 'RF_INVALID_TRANSFER') <> v_next)
       or (nullif(private.bom_text(v_row, 'orderId', 40, 0, 'RF_INVALID_TRANSFER'), '') is not null and private.bom_text(v_row, 'orderId', 40, 0, 'RF_INVALID_TRANSFER') <> v_lot.order_no) then
      raise exception 'RF_INVALID_TRANSFER';
    end if;
    if v_lot.qc is distinct from 'pass' or (v_lot.stage = 'mixing' and v_lot.ready_at > now()) then
      perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_TRANSFER');
    end if;
    v_avail := greatest(0, round(v_lot.good_qty - v_lot.transferred_qty, 3));
    if v_q > v_avail + 0.000000001 then
      perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_TRANSFER');
    end if;
    insert into public.rf_transfers (is_test, transfer_no, lot_no, order_no, from_stage, to_stage, uom, qty_sent, remaining, note, status, created_by)
    values (true, v_no, v_lot.lot_no, v_lot.order_no, v_lot.stage, v_next, v_lot.uom, v_q, 0, v_note, 'in_transit', p_actor.id);
    update public.rf_lots set transferred_qty = trim_scale(round(transferred_qty + v_q, 3)), updated_at = now() where id = v_lot.id;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_save_transfers(public.employees, text, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- กล่องสินค้าสำเร็จรูป: เซิร์ฟเวอร์สร้างจากการบันทึกตกแต่งเท่านั้น (กล่องใหม่ที่ client ส่งมาพร้อมล็อตตกแต่งเมิน อย่างอื่น = RF_INVALID_BOX)
-- WH (หรือกลุ่มวางแผน = p_may_ship) ส่งมอบ in_stock -> shipped · การเปลี่ยน in_stock <-> hold ที่ client ส่งมาเมิน (QC เป็นผู้เปลี่ยนตอนบันทึกผล)
create or replace function private.rf_save_boxes(p_actor uuid, p_may_ship boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
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
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_BOX'; end if;
    v_no := private.bom_text(v_row, 'id', 80, 1, 'RF_INVALID_BOX');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_BOX'; end if;
    v_seen := v_seen || v_no;
    v_cstatus := private.bom_text(v_row, 'status', 12, 1, 'RF_INVALID_BOX');
    if v_cstatus not in ('in_stock', 'hold', 'shipped') then raise exception 'RF_INVALID_BOX'; end if;

    select * into v_old from public.rf_fg_boxes b where b.is_test and b.box_no = v_no;
    if not found then
      -- กล่องเกิดจากล็อตตกแต่งที่เพิ่งบันทึกในคำสั่งเดียวกันเท่านั้น (เซิร์ฟเวอร์สร้างไว้แล้ว) นอกนั้นสร้างเองไม่ได้
      v_lot := private.bom_text(v_row, 'lotId', 60, 0, 'RF_INVALID_BOX');
      if v_lot <> '' and exists (select 1 from public.rf_lots l where l.is_test and l.lot_no = v_lot and l.stage = 'finishing' and l.changed_version > p_cur) then
        continue;
      end if;
      raise exception 'RF_INVALID_BOX';
    end if;
    if v_cstatus <> 'shipped' or v_old.status = 'shipped' then continue; end if;
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
    if not p_may_ship then raise exception 'RF_FORBIDDEN'; end if;
    if v_old.status <> 'in_stock' then raise exception 'RF_INVALID_TRANSITION'; end if;
    update public.rf_fg_boxes set status = 'shipped', shipped_at = now(), shipped_by = p_actor, updated_at = now() where id = v_old.id;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- ผลตรวจ QC: QA (หรือกลุ่มวางแผน = p_may) บันทึกผลใหม่เท่านั้น (ระเบียนเดิมแก้ไม่ได้) · pass ของแต่ละค่าคำนวณใหม่จาก SPECS.lab · ผลตัดสิน pass ได้เมื่อทุกค่าผ่าน
-- ผลตัดสินตั้งสถานะ QC ของล็อต (fail ย้อนเป็น pass/hold ไม่ได้) กล่องที่ยังไม่ส่งของล็อตเปลี่ยนตาม · ล็อตตกแต่งที่ผ่านและยังไม่นับ = นับเข้า WO (p_may_close = ปิด WO เองเมื่อครบ)
create or replace function private.rf_save_qc(p_actor public.employees, p_may boolean, p_may_close boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
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
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_QC'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_QC');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_QC'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_qc_records q where q.is_test and q.qc_no = v_no;
    if found then
      -- ผลตรวจเดิมแก้ไม่ได้ (เมินความต่าง) · เลขซ้ำกับที่คนอื่นเพิ่งบันทึก (เวลาต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['at', 'testedAt'], v_old.tested_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      continue;
    end if;

    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    select * into v_lot from public.rf_lots l where l.is_test and l.lot_no = private.bom_text(v_row, 'lotId', 60, 1, 'RF_INVALID_QC') for update;
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
    values (true, v_no, v_lot.lot_no, v_lot.order_no, v_lot.stage, v_tests, v_result, v_note, p_actor.id);
    v_count := v_lot.stage = 'finishing' and v_result = 'pass' and not v_lot.counted_to_order;
    update public.rf_lots set
      qc = v_result,
      hold_reasons = case when v_result = 'pass' then '[]'::jsonb else hold_reasons end,
      counted_to_order = counted_to_order or v_count,
      updated_at = now()
    where id = v_lot.id
      and (qc is distinct from v_result or (v_result = 'pass' and hold_reasons <> '[]'::jsonb) or v_count);
    update public.rf_fg_boxes set status = case when v_result = 'pass' then 'in_stock' else 'hold' end, updated_at = now()
    where is_test and lot_no = v_lot.lot_no and status <> 'shipped' and status <> case when v_result = 'pass' then 'in_stock' else 'hold' end;
    if v_count then
      perform private.rf_add_produced(v_lot.order_no, v_lot.good_qty, p_may_close, p_base, p_cur);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- NCR: ใบใหม่ = QA / กลุ่มวางแผน (p_full) เริ่มที่ open (ล็อตที่ pass อยู่เป็น hold เหตุผล "เปิด <เลข>") · NCR ที่เปิดอยู่: สมาชิก RB (p_fill) กรอก corrective / preventive ได้
-- ช่องเดียว ช่องอื่น (หัวข้อ ล็อต ความรุนแรง 5 Why มาตรการกักกัน ผู้รับผิดชอบ การตรวจสอบ) และการปิด = p_full · ปิดต้องมี corrective + preventive · ปิดแล้วแก้ไม่ได้
create or replace function private.rf_save_ncrs(p_actor public.employees, p_actor_name text, p_full boolean, p_fill boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_title text;
  v_stage text;
  v_lot text;
  v_sev text;
  v_defect numeric;
  v_node jsonb;
  v_el jsonb;
  v_whys jsonb;
  v_contain text;
  v_corr text;
  v_prev text;
  v_owner text;
  v_verif text;
  v_status text;
  v_old public.rf_ncrs%rowtype;
  v_other boolean;
  v_fill boolean;
  v_close boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_NCR'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_NCR');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_NCR'; end if;
    v_seen := v_seen || v_no;
    v_title := private.bom_text(v_row, 'title', 200, 1, 'RF_INVALID_NCR');
    v_stage := private.bom_text(v_row, 'stage', 12, 0, 'RF_INVALID_NCR');
    if v_stage not in ('', 'warehouse', 'mixing', 'extrusion', 'curing', 'finishing', 'fg') then raise exception 'RF_INVALID_NCR'; end if;
    v_lot := private.bom_text(v_row, 'lotId', 60, 1, 'RF_INVALID_NCR');
    if v_lot !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' then raise exception 'RF_INVALID_NCR'; end if;
    v_sev := coalesce(nullif(private.bom_text(v_row, 'severity', 10, 0, 'RF_INVALID_NCR'), ''), 'major');
    if v_sev not in ('minor', 'major', 'critical') then raise exception 'RF_INVALID_NCR'; end if;
    v_defect := coalesce(private.bom_num(v_row -> 'defectQty', 'RF_INVALID_NCR', 0, 1000000000), 0);
    v_node := v_row -> 'whys';
    v_whys := '[]'::jsonb;
    if v_node is not null and jsonb_typeof(v_node) <> 'null' then
      if jsonb_typeof(v_node) <> 'array' then raise exception 'RF_INVALID_NCR'; end if;
      for v_el in select value from jsonb_array_elements(v_node) loop
        if jsonb_typeof(v_el) <> 'string' or char_length(v_el #>> '{}') > 300 then raise exception 'RF_INVALID_NCR'; end if;
        if btrim(v_el #>> '{}') <> '' then v_whys := v_whys || to_jsonb(btrim(v_el #>> '{}')); end if;
      end loop;
      if jsonb_array_length(v_whys) > 10 then raise exception 'RF_INVALID_NCR'; end if;
    end if;
    v_contain := private.bom_text(v_row, 'containment', 1000, 0, 'RF_INVALID_NCR');
    v_corr := private.bom_text(v_row, 'corrective', 1000, 0, 'RF_INVALID_NCR');
    v_prev := private.bom_text(v_row, 'preventive', 1000, 0, 'RF_INVALID_NCR');
    v_owner := private.bom_text(v_row, 'owner', 120, 0, 'RF_INVALID_NCR');
    v_verif := private.bom_text(v_row, 'verification', 1000, 0, 'RF_INVALID_NCR');
    v_status := coalesce(nullif(private.bom_text(v_row, 'status', 10, 0, 'RF_INVALID_NCR'), ''), 'open');
    if v_status not in ('open', 'closed') then raise exception 'RF_INVALID_NCR'; end if;

    select * into v_old from public.rf_ncrs n where n.is_test and n.ncr_no = v_no;
    if found then
      -- เลข NCR ซ้ำกับที่คนอื่นเพิ่งเปิด (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt', 'openedAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      v_other := v_old.title <> v_title or v_old.stage <> v_stage or v_old.lot_no <> v_lot or v_old.severity <> v_sev
        or v_old.defect_qty <> v_defect or v_old.whys <> v_whys or v_old.containment <> v_contain
        or v_old.owner <> v_owner or v_old.verification <> v_verif;
      v_fill := v_old.corrective <> v_corr or v_old.preventive <> v_prev;
      v_close := v_old.status <> v_status;
      if not (v_other or v_fill or v_close) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      if v_other or v_close then
        if not p_full then raise exception 'RF_FORBIDDEN'; end if;
      elsif not p_fill then
        raise exception 'RF_FORBIDDEN';
      end if;
      if v_old.status = 'closed' then raise exception 'RF_INVALID_TRANSITION'; end if;
      if v_close and (v_status <> 'closed' or btrim(v_corr) = '' or btrim(v_prev) = '') then
        if v_status <> 'closed' then raise exception 'RF_INVALID_TRANSITION'; end if;
        raise exception 'RF_INVALID_NCR';
      end if;
      update public.rf_ncrs set
        title = v_title, stage = v_stage, lot_no = v_lot, severity = v_sev, defect_qty = v_defect, whys = v_whys,
        containment = v_contain, corrective = v_corr, preventive = v_prev, owner = v_owner, verification = v_verif,
        status = v_status,
        closed_by = case when v_close then p_actor.id else closed_by end,
        closed_at = case when v_close then now() else closed_at end,
        updated_at = now()
      where id = v_old.id;
      continue;
    end if;

    if not p_full then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'open' then raise exception 'RF_INVALID_TRANSITION'; end if;
    insert into public.rf_ncrs (is_test, ncr_no, title, stage, lot_no, severity, defect_qty, whys, containment, corrective, preventive, owner, status, created_by)
    values (true, v_no, v_title, v_stage, v_lot, v_sev, v_defect, v_whys, v_contain, v_corr, v_prev,
            coalesce(nullif(v_owner, ''), p_actor_name), 'open', p_actor.id);
    update public.rf_lots set qc = 'hold', hold_reasons = hold_reasons || to_jsonb('เปิด ' || v_no), updated_at = now()
    where is_test and lot_no = v_lot and qc = 'pass';
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_ncrs(public.employees, text, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. snapshot / delta -----------------------------------------------------------------------
-- ระเบียนที่ changed_version > p_since แยกตามชุด เรียงแบบกำหนดได้ · p_since = -1 ได้ทั้งหมด (snapshot) · 11 ชุด (รอบที่ 1: materials recipes orders)
-- ชื่อช่องตามรูปทรงระเบียนของ client (modules/rubberflow-actions.js) ใบส่งมอบ/ผลตรวจ/NCR มีช่องเวลา-ผู้ทำ ทั้งชื่อที่ client ใช้ (createdAt/inspector/at) และชื่อในสัญญา (sentAt/testedAt ฯลฯ)
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
          'createdAt', private.bom_ms(m.created_at)) order by m.code collate "C")
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
      from public.rf_ncrs n where n.is_test and n.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- ส่วนต่างหลังเวอร์ชัน p_since: { version, epoch, changes: { <ชุด>: { upsert, delete } } } ครบ 11 ชุดเสมอ (ยังไม่มีการลบ delete เป็น [] ทุกชุด)
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
                   ('transfers'), ('fgBoxes'), ('qcRecords'), ('ncrs')) as l(list)
      cross join (select private.rf_records(p_since) as records) r))
$$;
revoke all on function private.rf_delta(bigint) from public, anon, authenticated;

-- 6. RPC สาธารณะ -------------------------------------------------------------------------------
-- app_rf_master / app_rf_master_since / app_rf_audit ไม่เปลี่ยน (เรียก private.rf_snapshot / rf_delta ซึ่งคืน 11 ชุดแล้ว)
-- บันทึกชุดการเปลี่ยนแปลงในธุรกรรมเดียว ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย คืน delta ตั้งแต่ p_base_version: { version, epoch, changes }
-- ไม่มีการเปลี่ยนแปลงเลย (ทุกส่วนว่าง) = คืน delta โดยไม่เพิ่ม version และไม่เขียน audit
-- ลำดับล็อก (กัน deadlock): rf_master_state ก่อน แล้ว bom_master_state เฉพาะเมื่อมีการเขียนฝั่ง BOM (ผูก/ล้างการผูกงาน หรือป้อนผลผลิตกลับตอนรับมอบ)
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
                                       'transfers', 'fgBoxes', 'qcRecords', 'ncrs'];
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
begin
  perform private.lab_only_block();
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
        else false end;
      if v_n > 0 and not v_may then raise exception 'RF_FORBIDDEN'; end if;
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
    perform private.rf_save_materials(v_actor.id, coalesce(p_changes #> '{materials,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_recipes(v_actor.id, v_head, coalesce(p_changes #> '{recipes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.rf_save_orders(v_actor, v_actor_name, v_planner, v_rb, v_head,
                                    coalesce(p_changes #> '{orders,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    perform private.rf_save_molds(v_actor.id, v_planner or v_rb, p_action, coalesce(p_changes #> '{molds,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_material_lots(v_actor.id, v_planner, v_st, v_qa, coalesce(p_changes #> '{materialLots,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_requisitions(v_actor.id, v_actor_name, v_planner or v_rb, coalesce(p_changes #> '{requisitions,upsert}', '[]'::jsonb), p_base_version, v_version);
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
     and not exists (select 1 from public.rf_ncrs t where t.is_test and t.changed_version > v_version) then
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

-- ล้างข้อมูล RubberFlow ทดสอบ (admin จริงที่อยู่ในโหมดทดสอบ แบบเดียวกับ app_sandbox_purge_bom) นิยามจากรอบที่ 1 เพิ่มตารางของรอบที่ 2
-- ลบทุกแถว is_test ของตาราง rf_* (ลูกก่อนแม่) เปลี่ยน epoch (ตัวนับ version เดินต่อ) เขียน audit (audit_logs เดิมคงไว้) ไม่แตะข้อมูลจริง และไม่แตะ BOM
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

  foreach v_table in array array['rf_ncrs', 'rf_qc_records', 'rf_fg_boxes', 'rf_transfers', 'rf_requisitions', 'rf_lots', 'rf_material_lots', 'rf_molds',
                                 'rf_orders', 'rf_recipes', 'rf_materials', 'rf_deleted_keys'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
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
