-- ============================================================================
-- BOM โหมดทดสอบ: โมดูลแปรรูปยาง GR (โรงงาน ขั้น 2) ขั้นตอนของงาน บันทึกผลรายวันต่อคน × ขั้น × วัน ขอเบิกยางเส้นยาวจาก SR และส่งงานให้ PK
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-23, factory-step2-gr-spec · gr-owner-rules):
--   1) ขั้นตอนตามแอป Grinding-GR: สายหลัก 9 ขั้น รีด → ปั๊ม → เปเปอร์ → ตัดยาง → ทากาว → เจียร์ → เจียร์(หยาบ) → เจียร์(ละเอียด) → เจาะ และขั้นเสริม ใส่ท่อ คัดแยก ตัดยาง(เข้ามุม)
--      หัวหน้า GR แก้รายการขั้นตอน เหตุผลของเสีย และเป้า (ชิ้น/ชม. ที่ 100% ต่อรหัสชิ้น × ขั้น) ได้ และเลือกขั้นตอนของแต่ละงาน
--   2) พนักงาน GR ทุกคนบันทึกผลเองต่อคน × ขั้น × วัน (ชั่วโมง จำนวนคน ดี เสีย + เหตุผล) · ไม่มีจำนวนเงินในรอบนี้
--   3) GR ขอเบิกยางเส้นยาวต่องาน SR จ่ายตามเดิม (issueRods FIFO ไม่เปลี่ยน) · GR กดส่งให้ PK พร้อมจำนวน PK กดรับ ที่ยังไม่ส่ง = รอที่ GR
--   6) พนักงานแก้ / ยกเลิกผลของตัวเองได้เฉพาะวันที่บันทึก · หัวหน้า GR และกลุ่มวางแผนแก้ของทุกคนทุกวัน ต้องมีเหตุผลทุกครั้ง เก็บประวัติ
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และ private.bom_actor() (นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY)
--
-- รหัสขั้นตอนเริ่มต้น (ตัดสินครั้งเดียว): ใช้รหัสขั้นตอนผลิตเดิมของ BOM ที่มีอยู่แล้ว routing ของสินค้าจึงตรงกับขั้นของงานทันที
--   สายหลัก GR-01 รีด · GR-02 ปั๊ม · GR-03 เปเปอร์ · GR-04 ตัดยาง · GR-05 ทากาว · GR-06 เจียร์ · GR-07 เจียร์(หยาบ) · GR-08 เจียร์(ละเอียด) · GR-09 เจาะ
--   ขั้นเสริม GR-11 ใส่ท่อ · GR-10 คัดแยก (รหัสเดิมของ Pilot) · GR-12 ตัดยาง(เข้ามุม) · รหัสใหม่ที่หัวหน้าเพิ่มเองเป็นรูป GR-<ตัวอักษร/ตัวเลข 1-10>
--   เหตุผลของเสียเริ่มต้น: ขนาดไม่ได้ · ผิวไม่สวย/มีรอย · กาวไม่ติด · เจียร์เกิน · เจาะผิดตำแหน่ง · ยางมีตำหนิจากต้นทาง · อื่นๆ · เป้าเริ่มต้น: ไม่มี
--   ไม่มีแถวตั้งค่าของโหมด = ใช้ค่าเริ่มต้น (private.bom_gr_default_config ตรงกับ GR_DEFAULT_CONFIG ของ modules/bom-rules.js)
--
-- ใคร: หัวหน้า GR = department_manager หรือ assistant_department_manager ของแผนก GR (บัญชีทดสอบ SBX-GR-AMGR) · กลุ่มวางแผน (private.bom_can_edit) ทำได้ทุกอย่าง
--   หัวหน้า PK = department_manager หรือ assistant_department_manager ของแผนก PK
--
-- ตารางใหม่ (แยกโหมดด้วย is_test · trigger *_sandbox_scope + *_stamp_version · RLS deny-all + ถอนสิทธิ์ anon/authenticated + lab-only
--   + private.sandbox_unguarded_tables() + ล้างโดย app_sandbox_purge_bom ก่อน bom_rod_moves / bom_jobs / bom_orders)
--   - bom_gr_config: หนึ่งแถวต่อโหมด steps [{code, name, kind main|side, seq, active}] reasons [ข้อความ] targets [{itemCode, stepCode, perHour}]
--   - bom_gr_job_plans: ขั้นตอนของงาน GR (หนึ่งแถวต่องาน) steps [{code, qtyTarget}] ตามลำดับ ขั้นสุดท้ายของรายการ = ขั้นที่นับเป็นยอดดีของงาน
--   - bom_gr_records: ผลรายวัน (id จาก client) ต่องาน × ขั้น × วัน × คน · status active | void · edits = ประวัติการแก้ / ยกเลิกที่เซิร์ฟเวอร์ต่อท้าย
--   - bom_rod_requests: GR ขอเบิกยางเส้นยาวของใบ × รหัสเส้นยาง (ผูกงาน GR) status open | cancelled · "ได้ครบแล้ว" คำนวณจากการจ่ายของ SR (ไม่เก็บ)
--   - bom_gr_handovers: GR ส่งงานให้ PK status sent -> received (ย้อนรับ = กลับเป็น sent) | sent -> cancelled · moves = ประวัติที่เซิร์ฟเวอร์ต่อท้าย
--
-- ยอดของงาน GR ที่มีขั้นตอน (ไม่มีใครพิมพ์ยอดซ้ำ): หลังเพิ่ม / แก้ / ยกเลิกผลทุกครั้ง และหลังตั้งขั้นตอน ในธุรกรรมเดียวกัน private.bom_gr_recompute ตั้ง
--   qty_done = Σ ดีของผลที่ active ของขั้นสุดท้ายในแผน · qty_reject = Σ เสียของผลที่ active ของทุกขั้นในแผน
--   สถานะ: hold คงเดิม · done ที่ฝ่ายวางแผนปิดพร้อมเหตุผล (done ทั้งที่ยอดต่ำกว่าแผน) คงเดิม · ยอดดี >= แผน = done (done_at) · มีผลแล้ว = in_progress · ใบ released -> in_progress
--   ยอดเปลี่ยน = ต่อท้าย bom_jobs.reports หนึ่งรายการ {at, by, good: max(ยอดดีที่เพิ่ม, 0), reject: max(ยอดเสียที่เพิ่ม, 0), note (ยอดเดิม → ยอดใหม่), kind: 'gr'}
--     เหตุที่ไม่ใส่ค่าติดลบ: private.bom_parse_reports ตรวจรายการเดิมทุกครั้งที่ bom_save_jobs แก้งาน (พัก / ปิด) และรับเฉพาะยอด >= 0
--     ไม่มีผู้อ่านใดใช้ Σ รายการเป็นยอดของงาน (ยอดจริงอยู่ที่ qty_done / qty_reject แบบเดียวกับ rf_box_uncredit ที่ถอนยอดด้วยรายการยอด 0)
--     รายการเต็ม 1000 แล้ว = ตั้งยอดโดยไม่ต่อท้ายรายการ · ยอดไม่เปลี่ยน = ไม่ต่อท้าย
--   งาน GR ที่มีขั้นตอนแล้ว: trigger bom_jobs_gr_guard ปฏิเสธการเปลี่ยน qty_done / qty_reject จากทางอื่น (reportJob ผ่าน bom_save_jobs ได้ BOM_INVALID_JOB)
--     โดยไม่ต้องเขียน bom_save_jobs ใหม่ · พัก / ทำต่อ / คืนคิว / ปิดงานพร้อมเหตุผล ยังทำได้เพราะไม่เปลี่ยนยอด
--   งานที่รายงานยอดแบบเดิมไปแล้ว (qty_done / qty_reject > 0 และยังไม่มีขั้นตอน) ตั้งขั้นตอนไม่ได้ (BOM_INVALID_TRANSITION) ยอดเดิมจึงไม่ถูกทับ
--
-- action ใหม่ของ app_bom_save_master (ส่วน upsert แถวเดียวต่อคำสั่ง ส่วนกับ action ต้องคู่กัน ผิด / ว่าง = BOM_INVALID_GR) ลำดับตรวจ: รูปแถว (BOM_INVALID_GR)
--   -> สิทธิ์ (BOM_FORBIDDEN) -> แถวที่อ้าง (ไม่พบ = BOM_INVALID_GR) -> ชนรุ่น (BOM_STALE) -> สถานะ (BOM_INVALID_TRANSITION) -> กติกาข้อมูล (BOM_INVALID_GR / BOM_GR_EXCEEDS)
--   saveGrConfig (หัวหน้า GR / กลุ่มวางแผน) grConfig [{steps 1-40, reasons 1-30, targets 0-2000}] ชื่อ <= 60 · รหัสไม่ซ้ำ · perHour > 0 <= 100000 · รหัสชิ้นของเป้าต้องมีในทะเบียน
--     ขั้นที่มีผลบันทึกแล้ว (ทุกสถานะ) หรืออยู่ในขั้นตอนของงานใด ลบออกไม่ได้ (ตั้งเป็นไม่ใช้แทน)
--   setGrJobSteps (หัวหน้า GR / กลุ่มวางแผน) grPlans [{jobId, steps [{code, qtyTarget 1-10000000}] 1-40}] งานแผนก GR ใบ released / in_progress งานยังไม่ done
--     ขั้นต้องมีในตั้งค่า (ขั้นที่ไม่ใช้แล้วคงไว้ได้เฉพาะที่อยู่ในแผนเดิม) · ขั้นที่มีผล active ของงานนี้เอาออกไม่ได้
--   addGrRecord grRecords [{id (uuid ใหม่), jobId, stepCode, workDate YYYY-MM-DD, workerId, hours 0 < h <= 24 (ทศนิยม 2), people 1-50, good, reject, reason, note <= 200}]
--   editGrRecord grRecords [{id, stepCode, workDate, workerId, hours, people, good, reject, reason, note, editReason 3-200}] · voidGrRecord grRecords [{id, reason 3-200}]
--     พนักงานแผนก GR: ผลของตัวเองเท่านั้น (workerId = ผู้เรียก) วันที่ทำงาน = วันนี้หรือเมื่อวาน (Asia/Bangkok) · แก้ / ยกเลิกผลของตัวเองได้เฉพาะวันที่บันทึก
--     หัวหน้า GR / กลุ่มวางแผน: ผลของพนักงาน GR คนใดก็ได้ (แผนก GR โหมดเดียวกัน: ใช้งานจริงต้อง active · บัญชีทดสอบ inactive เสมอ) วันที่ใดก็ได้ไม่เกินวันนี้ แก้ / ยกเลิกได้ทุกวัน
--     งานต้องมีขั้นตอนที่มีขั้นนั้น · ใบ released / in_progress · งาน done = กลุ่มวางแผนเท่านั้น · งานที่พักอยู่เพิ่มผลไม่ได้ (เหมือน reportJob) แก้ / ยกเลิกได้
--     ดี + เสีย > 0 · เสีย > 0 ต้องมีเหตุผลจากรายการตั้งค่า (เสีย 0 = ไม่เก็บเหตุผล) · แก้ได้ไม่เกิน 100 ครั้งต่อผล
--   requestRods (แผนก GR / กลุ่มวางแผน) rodRequests [{id (uuid ใหม่), jobId, itemCode, qty 1-100000, note <= 200}] งาน GR ใบ released / in_progress งานยังไม่ done
--     รหัสต้องเป็นบรรทัดเส้นยาง (RB) ของผลระเบิดของใบที่ชิ้นแม่คือชิ้นของงาน GR นี้
--   cancelRodRequest (ผู้ขอ / หัวหน้า GR / กลุ่มวางแผน) rodRequests [{id, reason 3-200}] คำขอ open เท่านั้น
--   sendGrToPk (หัวหน้า GR / กลุ่มวางแผน) grHandovers [{id (uuid ใหม่), jobId, qty > 0, note <= 200}] Σ ที่ส่ง (ไม่นับยกเลิก) ต้องไม่เกินยอดดีของงาน (BOM_GR_EXCEEDS)
--   receiveGrAtPk (แผนก PK / กลุ่มวางแผน) grHandovers [{id}] รับทั้งรายการ sent -> received
--   cancelGrHandover grHandovers [{id, reason 3-200}] sent -> cancelled (หัวหน้า GR / กลุ่มวางแผน) · received -> sent = ย้อนการรับ (หัวหน้า PK / กลุ่มวางแผน)
--   ทุกการส่ง / รับ ใบต้อง released / in_progress · ส่งซ้ำ (id เดิม) = BOM_INVALID_GR ไม่นับซ้ำ · กดซ้ำหลังเปลี่ยนสถานะแล้ว = BOM_INVALID_TRANSITION
--   รหัสข้อผิดพลาดใหม่: BOM_INVALID_GR, BOM_GR_EXCEEDS (ใช้ BOM_FORBIDDEN / BOM_STALE / BOM_INVALID_TRANSITION / BOM_INVALID_JOB เดิมด้วย)
--
-- รูปเรคอร์ดที่ส่งกลับ (snapshot / delta มีชุดใหม่หกชุด ชุดที่ Pilot รุ่นก่อนไม่รู้จักถูกเมิน · ชุด delete เป็น [] เสมอ)
--   grConfig [{key 'gr', steps, reasons, targets, updatedBy, updatedAt}] (ว่าง = ยังไม่เคยตั้ง ใช้ค่าเริ่มต้น)
--   grPlans [{jobId, orderId, steps, createdBy, createdAt, updatedBy, updatedAt}]
--   grRecords [{id, jobId, orderId, itemCode, stepCode, workDate, workerId, workerName, hours, people, good, reject, reason, note, status, voidReason, edits,
--               createdBy, createdById, createdAt, updatedBy, updatedAt}]
--   rodRequests [{id, orderId, jobId, itemCode, qty, note, status, createdBy, createdById, createdAt, cancelledBy, cancelledAt, cancelReason}]
--   grHandovers [{id, jobId, orderId, itemCode, qty, status, note, sentBy, sentAt, receivedBy, receivedAt, cancelledBy, cancelledAt, cancelReason, moves}]
--   grWorkers [{id, name}] พนักงานของแผนก GR ในโหมดเดียวกัน (ใช้งานจริง active) (ให้หัวหน้าเลือกผู้ทำ) · มีเฉพาะใน snapshot (ส่วนต่างเป็น [] เสมอ)
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main)
--   - private.sandbox_unguarded_tables()  จาก 20261212010000_itrp_repair_requests.sql (+ ห้าตาราง bom_gr_* / bom_rod_requests)
--   - private.bom_client_actions()  จาก 20261204010000_bom_sr_store_module.sql (+ สิบ action)
--   - private.bom_staff_actions()  จาก 20261204010000_bom_sr_store_module.sql (+ สิบ action · สิทธิ์จริงตรวจในตัวเขียน)
--   - private.bom_records(bigint)  จาก 20261204010000_bom_sr_store_module.sql (+ หกชุด)
--   - private.bom_delta(bigint)  จาก 20261202010000_bom_sr_rod_store.sql (+ หกชุด)
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261204010000_bom_sr_store_module.sql (+ ห้าส่วน ตัวเขียน GR)
--   - public.app_sandbox_purge_bom()  จาก 20261202010000_bom_sr_rod_store.sql (+ ห้าตารางใหม่ ลบก่อน bom_rod_moves)
--   ใหม่ (security definer · search_path = '' · revoke all from public, anon, authenticated): private.bom_gr_default_config, bom_gr_config_now, bom_gr_is_head,
--     bom_gr_today, bom_gr_section, bom_gr_job_guard (trigger bom_jobs_gr_guard), bom_gr_recompute, bom_gr_save_config, bom_gr_save_plan, bom_gr_save_record,
--     bom_gr_save_request, bom_gr_save_handover, bom_gr_save
--   ไม่แตะ: private.bom_save_jobs (ด่านยอดของงานที่มีขั้นตอนอยู่ที่ trigger) · private.bom_rod_save_moves (SR จ่ายเหมือนเดิม) · private.bom_real_open(), bom_actor()
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ที่ใช้ชุดและ action ใหม่ต้องรอให้ apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge
--   ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของเจ็ดฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ relrowsecurity + policy ของห้าตารางใหม่
--   Pilot เก่า + ฐานข้อมูลใหม่: ชุดใหม่ถูกเมิน · งาน GR ยังไม่มีใครตั้งขั้นตอน (ตั้งได้จาก Pilot ใหม่เท่านั้น) reportJob จึงยังใช้ได้เหมือนเดิม
--   Pilot ใหม่ + ฐานข้อมูลเก่า: action ใหม่ = BOM_FORBIDDEN / BOM_INVALID_ACTION และไม่มีชุดใหม่ (หน้าของ GR ใช้ค่าเริ่มต้นและรายการว่าง) · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace เจ็ดฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่ · app_sandbox_purge_bom รวม revoke / grant ท้ายฟังก์ชัน)
--   2) drop trigger bom_jobs_gr_guard on public.bom_jobs · ยอดของงาน GR ที่ตั้งจากผลรายวันคงอยู่
--   3) drop function private.bom_gr_save(public.employees, text, boolean, text, jsonb, bigint, bigint), private.bom_gr_save_handover(public.employees, text, boolean, text, jsonb, bigint, bigint),
--      private.bom_gr_save_request(public.employees, boolean, text, jsonb, bigint, bigint), private.bom_gr_save_record(public.employees, text, boolean, text, jsonb, bigint, bigint),
--      private.bom_gr_save_plan(public.employees, text, boolean, jsonb, bigint, bigint), private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint),
--      private.bom_gr_recompute(uuid, text, text), private.bom_gr_job_guard(), private.bom_gr_section(text), private.bom_gr_today(),
--      private.bom_gr_is_head(public.employees, text), private.bom_gr_config_now(), private.bom_gr_default_config()
--   4) drop table public.bom_gr_handovers, public.bom_rod_requests, public.bom_gr_records, public.bom_gr_job_plans, public.bom_gr_config (ข้อมูลทดสอบของ GR หายไป)
-- ============================================================================

-- 1. ตาราง ------------------------------------------------------------------------------------------------------------------------
-- ตั้งค่าของ GR หนึ่งแถวต่อโหมด (ไม่มีแถว = ค่าเริ่มต้น) · เขียนผ่าน app_bom_save_master (saveGrConfig) เท่านั้น
create table public.bom_gr_config (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  -- [{code, name, kind: main | side, seq, active}]
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 40),
  -- [ข้อความ] เหตุผลของเสียที่เลือกได้
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array' and jsonb_array_length(reasons) between 1 and 30),
  -- [{itemCode, stepCode, perHour}] ชิ้น/ชม. ที่ 100%
  targets jsonb not null default '[]'::jsonb check (jsonb_typeof(targets) = 'array' and jsonb_array_length(targets) <= 2000),
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (is_test)
);
comment on table public.bom_gr_config is 'ตั้งค่าของแผนก GR (ขั้นตอน เหตุผลของเสีย เป้าชิ้นต่อชั่วโมง) หนึ่งแถวต่อโหมด · ไม่มีแถว = private.bom_gr_default_config() · เขียนผ่าน app_bom_save_master (saveGrConfig) เท่านั้น';

-- ขั้นตอนของงาน GR หนึ่งแถวต่องาน · งานถูกลบ (เปิดใบกลับมาแก้ / ลบงานที่ยังไม่เริ่ม) = แผนหายไปด้วย
create table public.bom_gr_job_plans (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  job_id uuid not null,
  -- [{code, qtyTarget}] ตามลำดับ ขั้นสุดท้าย = ขั้นที่นับเป็นยอดดีของงาน
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) between 1 and 40),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (job_id, is_test) references public.bom_jobs(id, is_test) on delete cascade,
  unique (job_id),
  unique (id, is_test)
);
comment on table public.bom_gr_job_plans is 'ขั้นตอนของงาน GR (หนึ่งแถวต่องาน) · เขียนผ่าน app_bom_save_master (setGrJobSteps) เท่านั้น';

-- ผลรายวันต่องาน × ขั้น × วัน × คน · id มาจาก client (ส่งซ้ำไม่นับซ้ำ) · ไม่ลบ ยกเลิกเป็น void พร้อมเหตุผล
create table public.bom_gr_records (
  id uuid primary key,
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  job_id uuid not null,
  step_code text not null check (char_length(step_code) between 1 and 20),
  work_date date not null,
  worker_id uuid not null references public.employees(id),
  hours numeric(5, 2) not null check (hours > 0 and hours <= 24),
  people integer not null check (people between 1 and 50),
  good integer not null check (good between 0 and 10000000),
  reject integer not null check (reject between 0 and 10000000),
  reason text check (reason is null or char_length(reason) between 1 and 60),
  note text not null default '' check (char_length(note) <= 200),
  status text not null default 'active' check (status in ('active', 'void')),
  void_reason text check (void_reason is null or char_length(void_reason) between 3 and 200),
  -- [{at (ms), by (ชื่อ), kind: edit | void, reason, before: {...}}] เซิร์ฟเวอร์ต่อท้าย
  edits jsonb not null default '[]'::jsonb check (jsonb_typeof(edits) = 'array' and jsonb_array_length(edits) <= 100),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_by uuid references public.employees(id) on delete set null,
  updated_at timestamptz,
  foreign key (job_id, is_test) references public.bom_jobs(id, is_test),
  unique (id, is_test),
  constraint bom_gr_records_qty_check check (good + reject > 0 and ((reject > 0) = (reason is not null))),
  constraint bom_gr_records_void_check check ((status = 'void') = (void_reason is not null))
);
comment on table public.bom_gr_records is 'ผลรายวันของแผนก GR ต่องาน × ขั้น × วัน × คน (ชั่วโมง จำนวนคน ดี เสีย เหตุผล) · เขียนผ่าน app_bom_save_master (addGrRecord / editGrRecord / voidGrRecord) เท่านั้น';

-- GR ขอเบิกยางเส้นยาวจาก SR ต่อใบ × รหัสเส้นยาง (ผูกงาน GR) · ได้ครบแล้วหรือยังคำนวณจากการจ่าย (bom_rod_moves) ไม่เก็บ
create table public.bom_rod_requests (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  order_pk uuid not null,
  job_id uuid not null,
  item_code text not null check (char_length(item_code) between 1 and 60),
  qty integer not null check (qty between 1 and 100000),
  note text not null default '' check (char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'cancelled')),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  cancelled_by uuid references public.employees(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 3 and 200),
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  foreign key (job_id, is_test) references public.bom_jobs(id, is_test) on delete cascade,
  unique (id, is_test),
  constraint bom_rod_requests_state_check check (
    (status = 'open' and cancelled_at is null and cancel_reason is null)
    or (status = 'cancelled' and cancelled_at is not null and cancel_reason is not null))
);
comment on table public.bom_rod_requests is 'คำขอเบิกยางเส้นยาวของแผนก GR ต่อใบ × รหัสเส้นยาง · เขียนผ่าน app_bom_save_master (requestRods / cancelRodRequest) เท่านั้น · SR จ่ายด้วย issueRods เหมือนเดิม';

-- GR ส่งงานให้ PK · PK รับทั้งรายการ · ย้อนการรับ = กลับเป็น sent · ประวัติใน moves
create table public.bom_gr_handovers (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  job_id uuid not null,
  order_pk uuid not null,
  item_code text not null check (char_length(item_code) between 1 and 60),
  qty integer not null check (qty between 1 and 10000000),
  status text not null default 'sent' check (status in ('sent', 'received', 'cancelled')),
  note text not null default '' check (char_length(note) <= 200),
  sent_by uuid references public.employees(id) on delete set null,
  sent_at timestamptz not null default clock_timestamp(),
  received_by uuid references public.employees(id) on delete set null,
  received_at timestamptz,
  cancelled_by uuid references public.employees(id) on delete set null,
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) between 3 and 200),
  -- [{kind: send | receive | unreceive | cancel, at (ms), by (ชื่อ), note}]
  moves jsonb not null default '[]'::jsonb check (jsonb_typeof(moves) = 'array' and jsonb_array_length(moves) <= 200),
  foreign key (job_id, is_test) references public.bom_jobs(id, is_test),
  foreign key (order_pk, is_test) references public.bom_orders(id, is_test),
  unique (id, is_test),
  constraint bom_gr_handovers_state_check check (
    (status = 'sent' and received_at is null and cancelled_at is null)
    or (status = 'received' and received_at is not null and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null and received_at is null and cancel_reason is not null))
);
comment on table public.bom_gr_handovers is 'รายการส่งงานจาก GR ให้ PK (sent -> received / cancelled) · เขียนผ่าน app_bom_save_master (sendGrToPk / receiveGrAtPk / cancelGrHandover) เท่านั้น';

create index bom_gr_config_changed_idx on public.bom_gr_config (is_test, changed_version);
create index bom_gr_job_plans_changed_idx on public.bom_gr_job_plans (is_test, changed_version);
create index bom_gr_records_changed_idx on public.bom_gr_records (is_test, changed_version);
create index bom_gr_records_job_idx on public.bom_gr_records (job_id, is_test);
create index bom_rod_requests_changed_idx on public.bom_rod_requests (is_test, changed_version);
create index bom_rod_requests_job_idx on public.bom_rod_requests (job_id, is_test);
create index bom_rod_requests_order_idx on public.bom_rod_requests (order_pk, is_test);
create index bom_gr_handovers_changed_idx on public.bom_gr_handovers (is_test, changed_version);
create index bom_gr_handovers_job_idx on public.bom_gr_handovers (job_id, is_test);
create index bom_gr_handovers_order_idx on public.bom_gr_handovers (order_pk, is_test);

-- แยกโหมด + ประทับเวอร์ชัน + ปิดการเข้าถึงตรง (ฟังก์ชัน trigger เดิมของ 20261105010000 แบบเดียวกับ bom_rod_lots / bom_rod_moves)
do $$
declare
  v_table text;
begin
  foreach v_table in array array['bom_gr_config', 'bom_gr_job_plans', 'bom_gr_records', 'bom_rod_requests', 'bom_gr_handovers'] loop
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

select private.lab_only_guard_table('public.bom_gr_config');
select private.lab_only_guard_table('public.bom_gr_job_plans');
select private.lab_only_guard_table('public.bom_gr_records');
select private.lab_only_guard_table('public.bom_rod_requests');
select private.lab_only_guard_table('public.bom_gr_handovers');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว: private.sandbox_unguarded_tables() จาก 20261212010000_itrp_repair_requests.sql ทุกชื่อ (+ ห้าตารางของ GR ต่อท้ายชุด BOM)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 2. ตัวช่วยของ GR (private เรียกจากตัวเขียนใน app_bom_save_master เท่านั้น) -----------------------------------------------------------------
-- ค่าเริ่มต้นของตั้งค่า GR (ตรงกับ GR_DEFAULT_CONFIG ของ modules/bom-rules.js)
create or replace function private.bom_gr_default_config()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'steps', jsonb_build_array(
      jsonb_build_object('code', 'GR-01', 'name', 'รีด', 'kind', 'main', 'seq', 1, 'active', true),
      jsonb_build_object('code', 'GR-02', 'name', 'ปั๊ม', 'kind', 'main', 'seq', 2, 'active', true),
      jsonb_build_object('code', 'GR-03', 'name', 'เปเปอร์', 'kind', 'main', 'seq', 3, 'active', true),
      jsonb_build_object('code', 'GR-04', 'name', 'ตัดยาง', 'kind', 'main', 'seq', 4, 'active', true),
      jsonb_build_object('code', 'GR-05', 'name', 'ทากาว', 'kind', 'main', 'seq', 5, 'active', true),
      jsonb_build_object('code', 'GR-06', 'name', 'เจียร์', 'kind', 'main', 'seq', 6, 'active', true),
      jsonb_build_object('code', 'GR-07', 'name', 'เจียร์(หยาบ)', 'kind', 'main', 'seq', 7, 'active', true),
      jsonb_build_object('code', 'GR-08', 'name', 'เจียร์(ละเอียด)', 'kind', 'main', 'seq', 8, 'active', true),
      jsonb_build_object('code', 'GR-09', 'name', 'เจาะ', 'kind', 'main', 'seq', 9, 'active', true),
      jsonb_build_object('code', 'GR-11', 'name', 'ใส่ท่อ', 'kind', 'side', 'seq', 10, 'active', true),
      jsonb_build_object('code', 'GR-10', 'name', 'คัดแยก', 'kind', 'side', 'seq', 11, 'active', true),
      jsonb_build_object('code', 'GR-12', 'name', 'ตัดยาง(เข้ามุม)', 'kind', 'side', 'seq', 12, 'active', true)),
    'reasons', jsonb_build_array('ขนาดไม่ได้', 'ผิวไม่สวย/มีรอย', 'กาวไม่ติด', 'เจียร์เกิน', 'เจาะผิดตำแหน่ง', 'ยางมีตำหนิจากต้นทาง', 'อื่นๆ'),
    'targets', '[]'::jsonb)
$$;
revoke all on function private.bom_gr_default_config() from public, anon, authenticated;

-- ตั้งค่าที่ใช้อยู่ของโหมดผู้เรียก { steps, reasons, targets }: แถวของโหมด หรือค่าเริ่มต้นเมื่อยังไม่เคยตั้ง
create or replace function private.bom_gr_config_now()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('steps', c.steps, 'reasons', c.reasons, 'targets', c.targets)
                   from public.bom_gr_config c where c.is_test = (select private.bom_test_mode())),
                  private.bom_gr_default_config())
$$;
revoke all on function private.bom_gr_config_now() from public, anon, authenticated;

-- หัวหน้าแผนก: ผู้จัดการแผนก (department_manager) หรือผู้ช่วยผู้จัดการแผนก (assistant_department_manager) ของแผนก p_dept
create or replace function private.bom_gr_is_head(p_actor public.employees, p_dept text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_actor) = p_dept, false)
     and coalesce(private.employee_role_code(p_actor.id) in ('department_manager', 'assistant_department_manager'), false)
$$;
revoke all on function private.bom_gr_is_head(public.employees, text) from public, anon, authenticated;

-- วันนี้ตามเวลาไทย (วันที่ทำงานของผลรายวัน)
create or replace function private.bom_gr_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;
revoke all on function private.bom_gr_today() from public, anon, authenticated;

-- action ของ GR -> ส่วนของ p_changes ที่ส่งแถวคำขอ (null = ไม่ใช่ action ของ GR)
create or replace function private.bom_gr_section(p_action text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_action
    when 'saveGrConfig' then 'grConfig'
    when 'setGrJobSteps' then 'grPlans'
    when 'addGrRecord' then 'grRecords'
    when 'editGrRecord' then 'grRecords'
    when 'voidGrRecord' then 'grRecords'
    when 'requestRods' then 'rodRequests'
    when 'cancelRodRequest' then 'rodRequests'
    when 'sendGrToPk' then 'grHandovers'
    when 'receiveGrAtPk' then 'grHandovers'
    when 'cancelGrHandover' then 'grHandovers'
  end
$$;
revoke all on function private.bom_gr_section(text) from public, anon, authenticated;

-- 3. ยอดของงาน GR ที่มีขั้นตอน ----------------------------------------------------------------------------------------------------------
-- งานที่มีแผนขั้นตอนแล้ว: qty_done / qty_reject เปลี่ยนได้เฉพาะ private.bom_gr_recompute (ตั้งค่า mnp.bom_gr_recompute ระหว่างเขียน)
-- reportJob / การแก้ยอดอื่นผ่าน bom_save_jobs = BOM_INVALID_JOB · พัก / ทำต่อ / ปิดงานพร้อมเหตุผลไม่เปลี่ยนยอดจึงผ่าน
create or replace function private.bom_gr_job_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.qty_done is distinct from old.qty_done or new.qty_reject is distinct from old.qty_reject)
     and coalesce(current_setting('mnp.bom_gr_recompute', true), '') <> 'on'
     and exists (select 1 from public.bom_gr_job_plans p where p.job_id = old.id) then
    raise exception 'BOM_INVALID_JOB';
  end if;
  return new;
end;
$$;
revoke all on function private.bom_gr_job_guard() from public, anon, authenticated;
create trigger bom_jobs_gr_guard before update on public.bom_jobs
  for each row execute function private.bom_gr_job_guard();

-- คำนวณยอดของงานใหม่จากผลรายวัน (เรียกในธุรกรรมเดียวกับการเขียนผล / แผน) · คืน { jobs, orders } = จำนวนแถวที่เปลี่ยน
-- ยอดดี = Σ good ของผล active ของขั้นสุดท้ายในแผน · ยอดเสีย = Σ reject ของผล active ของทุกขั้นในแผน
create or replace function private.bom_gr_recompute(p_job_id uuid, p_actor_name text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_steps jsonb;
  v_last text;
  v_good numeric;
  v_rej numeric;
  v_any boolean;
  v_status text;
  v_reports jsonb;
  v_dg numeric;
  v_dr numeric;
  v_orders integer := 0;
begin
  select * into v_job from public.bom_jobs j where j.id = p_job_id for update;
  if not found then raise exception 'BOM_INVALID_GR'; end if;
  select p.steps into v_steps from public.bom_gr_job_plans p where p.job_id = p_job_id;
  if v_steps is null or jsonb_array_length(v_steps) = 0 then raise exception 'BOM_INVALID_GR'; end if;
  v_last := v_steps -> (jsonb_array_length(v_steps) - 1) ->> 'code';
  select coalesce(sum(r.good) filter (where r.step_code = v_last), 0), coalesce(sum(r.reject), 0)
  into v_good, v_rej
  from public.bom_gr_records r
  where r.job_id = p_job_id and r.status = 'active'
    and r.step_code in (select s.value ->> 'code' from jsonb_array_elements(v_steps) as s);
  v_any := exists (select 1 from public.bom_gr_records r where r.job_id = p_job_id);
  -- พักอยู่ = คงพัก · ฝ่ายวางแผนปิดพร้อมเหตุผล (done ทั้งที่ยอดต่ำกว่าแผน) = คง done · ถึงแผน = done · มีผลแล้ว = กำลังทำ
  v_status := case
    when v_job.status = 'hold' then 'hold'
    when v_job.status = 'done' and v_job.qty_done + 0.000000001 < v_job.qty_planned then 'done'
    when v_any and v_good + 0.000000001 >= v_job.qty_planned then 'done'
    when v_any or v_job.status <> 'queued' then 'in_progress'
    else 'queued' end;
  v_dg := v_good - v_job.qty_done;
  v_dr := v_rej - v_job.qty_reject;
  if v_dg = 0 and v_dr = 0 and v_status = v_job.status then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  v_reports := v_job.reports;
  -- รายการรายงานยอด >= 0 เสมอ (bom_parse_reports ตรวจรายการเดิมด้วยช่วง 0..1e9) · ยอดที่ลดบอกในหมายเหตุ · เต็ม 1000 รายการ = ไม่ต่อท้าย
  if (v_dg <> 0 or v_dr <> 0) and jsonb_array_length(v_reports) < 1000 then
    v_reports := v_reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', greatest(v_dg, 0), 'reject', greatest(v_dr, 0),
      'note', left(p_note || ' · ยอดดี ' || trim_scale(v_job.qty_done)::text || ' → ' || trim_scale(v_good)::text
                   || ' เสีย ' || trim_scale(v_job.qty_reject)::text || ' → ' || trim_scale(v_rej)::text, 200),
      'kind', 'gr'));
  end if;
  perform set_config('mnp.bom_gr_recompute', 'on', true);
  update public.bom_jobs set
    qty_done = v_good,
    qty_reject = v_rej,
    status = v_status,
    reports = v_reports,
    done_at = case when v_status = 'done' then coalesce(v_job.done_at, now()) else null end,
    updated_at = now()
  where id = v_job.id;
  perform set_config('mnp.bom_gr_recompute', '', true);
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk for update;
  if v_ord.status = 'released' and (v_status <> 'queued' or v_good > 0 or v_rej > 0) then
    update public.bom_orders set status = 'in_progress', updated_at = now() where id = v_ord.id;
    v_orders := 1;
  end if;
  return jsonb_build_object('jobs', 1, 'orders', v_orders);
end;
$$;
revoke all on function private.bom_gr_recompute(uuid, text, text) from public, anon, authenticated;

-- 4. ตัวเขียนของ GR ------------------------------------------------------------------------------------------------------------------
-- saveGrConfig (หนึ่งแถว) ลำดับตรวจ: รูปแถว (BOM_INVALID_GR) -> สิทธิ์ (BOM_FORBIDDEN) -> ชนรุ่น (BOM_STALE) -> ขั้นที่ใช้อยู่ถูกลบ (BOM_INVALID_GR) · คืน 1
create or replace function private.bom_gr_save_config(p_actor public.employees, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_reasons jsonb := '[]'::jsonb;
  v_targets jsonb := '[]'::jsonb;
  v_codes text[] := '{}';
  v_seen text[] := '{}';
  v_code text;
  v_name text;
  v_kind text;
  v_seq numeric;
  v_text text;
  v_item text;
  v_per numeric;
  v_old public.bom_gr_config%rowtype;
  v_found boolean;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  -- ขั้นตอน 1-40: รหัส GR-<A-Z0-9 1-10> ไม่ซ้ำ · ชื่อ 1-60 · main | side · ลำดับ 1-1000 · ใช้อยู่ true | false
  v_node := v_row -> 'steps';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) < 1 or jsonb_array_length(v_node) > 40 then
    raise exception 'BOM_INVALID_GR';
  end if;
  for v_el in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
    v_code := upper(private.bom_text(v_el, 'code', 20, 1, 'BOM_INVALID_GR'));
    if v_code !~ '^GR-[A-Z0-9]{1,10}$' or v_code = any (v_codes) then raise exception 'BOM_INVALID_GR'; end if;
    v_codes := v_codes || v_code;
    v_name := private.bom_text(v_el, 'name', 60, 1, 'BOM_INVALID_GR');
    v_kind := private.bom_text(v_el, 'kind', 10, 1, 'BOM_INVALID_GR');
    if v_kind not in ('main', 'side') then raise exception 'BOM_INVALID_GR'; end if;
    v_seq := private.bom_num(v_el -> 'seq', 'BOM_INVALID_GR', 1, 1000);
    if v_seq is null or v_seq <> trunc(v_seq) then raise exception 'BOM_INVALID_GR'; end if;
    if jsonb_typeof(v_el -> 'active') is distinct from 'boolean' then raise exception 'BOM_INVALID_GR'; end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object(
      'code', v_code, 'name', v_name, 'kind', v_kind, 'seq', v_seq::integer, 'active', (v_el ->> 'active')::boolean));
  end loop;
  -- เหตุผลของเสีย 1-30 ข้อความ 1-60 ไม่ซ้ำ
  v_node := v_row -> 'reasons';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) < 1 or jsonb_array_length(v_node) > 30 then
    raise exception 'BOM_INVALID_GR';
  end if;
  for v_el in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_el) <> 'string' then raise exception 'BOM_INVALID_GR'; end if;
    v_text := btrim(v_el #>> '{}');
    if char_length(v_text) < 1 or char_length(v_text) > 60 or v_reasons ? v_text then raise exception 'BOM_INVALID_GR'; end if;
    v_reasons := v_reasons || jsonb_build_array(v_text);
  end loop;
  -- เป้า 0-2000: รหัสชิ้นในทะเบียน × รหัสขั้นในรายการข้างบน ไม่ซ้ำคู่ · 0 < perHour <= 100000
  v_node := v_row -> 'targets';
  if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
  if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 2000 then raise exception 'BOM_INVALID_GR'; end if;
  for v_el in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
    v_item := private.bom_code(private.bom_text(v_el, 'itemCode', 60, 1, 'BOM_INVALID_GR'));
    v_code := upper(private.bom_text(v_el, 'stepCode', 20, 1, 'BOM_INVALID_GR'));
    if v_item = '' or not (v_code = any (v_codes)) or (v_item || '|' || v_code) = any (v_seen) then raise exception 'BOM_INVALID_GR'; end if;
    v_seen := v_seen || (v_item || '|' || v_code);
    v_per := private.bom_num(v_el -> 'perHour', 'BOM_INVALID_GR', 0, 100000);
    if v_per is null or v_per <= 0 then raise exception 'BOM_INVALID_GR'; end if;
    v_targets := v_targets || jsonb_build_array(jsonb_build_object('itemCode', v_item, 'stepCode', v_code, 'perHour', trim_scale(v_per)));
  end loop;
  if exists (select 1 from jsonb_array_elements(v_targets) t
             where not exists (select 1 from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = t.value ->> 'itemCode')) then
    raise exception 'BOM_INVALID_GR';
  end if;

  if not (p_planner or private.bom_gr_is_head(p_actor, 'GR')) then raise exception 'BOM_FORBIDDEN'; end if;

  select * into v_old from public.bom_gr_config c where c.is_test = (select private.bom_test_mode()) for update;
  v_found := found;
  if v_found and v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  -- ขั้นที่มีผลบันทึกแล้ว (ทุกสถานะ) หรืออยู่ในขั้นตอนของงานใด ลบออกจากรายการไม่ได้ (ตั้งเป็นไม่ใช้แทน)
  if exists (select 1 from public.bom_gr_records r where r.is_test = (select private.bom_test_mode()) and not (r.step_code = any (v_codes)))
     or exists (select 1 from public.bom_gr_job_plans p cross join lateral jsonb_array_elements(p.steps) as s
                where p.is_test = (select private.bom_test_mode()) and not ((s.value ->> 'code') = any (v_codes))) then
    raise exception 'BOM_INVALID_GR';
  end if;
  if v_found then
    update public.bom_gr_config set steps = v_steps, reasons = v_reasons, targets = v_targets, updated_by = p_actor.id, updated_at = now()
    where id = v_old.id;
  else
    insert into public.bom_gr_config (is_test, steps, reasons, targets, updated_by)
    values ((select private.bom_test_mode()), v_steps, v_reasons, v_targets, p_actor.id);
  end if;
  return 1;
end;
$$;
revoke all on function private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- setGrJobSteps (หนึ่งแถว) ลำดับตรวจ: รูปแถว -> สิทธิ์ -> งาน (ไม่พบ / ไม่ใช่ GR = BOM_INVALID_GR) -> ชนรุ่นของแผน -> สถานะใบ / งาน -> ขั้น · คืน { jobs, orders }
create or replace function private.bom_gr_save_plan(p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_no text;
  v_steps jsonb := '[]'::jsonb;
  v_codes text[] := '{}';
  v_code text;
  v_qty numeric;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_old public.bom_gr_job_plans%rowtype;
  v_found boolean;
  v_config jsonb;
  v_cfg jsonb;
  v_old_codes text[] := '{}';
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  v_no := private.bom_text(v_row, 'jobId', 40, 1, 'BOM_INVALID_GR');
  if v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_GR'; end if;
  v_node := v_row -> 'steps';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) < 1 or jsonb_array_length(v_node) > 40 then
    raise exception 'BOM_INVALID_GR';
  end if;
  for v_el in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
    v_code := upper(private.bom_text(v_el, 'code', 20, 1, 'BOM_INVALID_GR'));
    if v_code = any (v_codes) then raise exception 'BOM_INVALID_GR'; end if;
    v_codes := v_codes || v_code;
    v_qty := private.bom_num(v_el -> 'qtyTarget', 'BOM_INVALID_GR', 1, 10000000);
    if v_qty is null or v_qty <> trunc(v_qty) then raise exception 'BOM_INVALID_GR'; end if;
    v_steps := v_steps || jsonb_build_array(jsonb_build_object('code', v_code, 'qtyTarget', v_qty::integer));
  end loop;

  if not (p_planner or private.bom_gr_is_head(p_actor, 'GR')) then raise exception 'BOM_FORBIDDEN'; end if;

  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
  if not found or v_job.dept <> 'GR' then raise exception 'BOM_INVALID_GR'; end if;
  select * into v_old from public.bom_gr_job_plans p where p.job_id = v_job.id for update;
  v_found := found;
  if v_found and v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
  if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- รายงานยอดแบบเดิมไปแล้ว (ยังไม่มีแผน) = ตั้งขั้นตอนไม่ได้ ยอดเดิมจึงไม่ถูกคำนวณทับ
  if not v_found and (v_job.qty_done > 0 or v_job.qty_reject > 0) then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if v_found then
    v_old_codes := array(select s.value ->> 'code' from jsonb_array_elements(v_old.steps) as s);
  end if;
  -- ขั้นต้องมีในตั้งค่า · ขั้นที่ไม่ใช้แล้วคงไว้ได้เฉพาะที่อยู่ในแผนเดิม
  v_config := private.bom_gr_config_now();
  foreach v_code in array v_codes loop
    select s.value into v_cfg from jsonb_array_elements(v_config -> 'steps') as s where s.value ->> 'code' = v_code;
    if v_cfg is null then raise exception 'BOM_INVALID_GR'; end if;
    if not coalesce((v_cfg ->> 'active')::boolean, false) and not (v_code = any (v_old_codes)) then raise exception 'BOM_INVALID_GR'; end if;
    v_cfg := null;
  end loop;
  -- ขั้นที่มีผล active ของงานนี้เอาออกไม่ได้
  if exists (select 1 from public.bom_gr_records r where r.job_id = v_job.id and r.status = 'active' and not (r.step_code = any (v_codes))) then
    raise exception 'BOM_INVALID_GR';
  end if;
  if v_found then
    update public.bom_gr_job_plans set steps = v_steps, updated_by = p_actor.id, updated_at = now() where id = v_old.id;
  else
    insert into public.bom_gr_job_plans (is_test, job_id, steps, created_by, updated_by)
    values ((select private.bom_test_mode()), v_job.id, v_steps, p_actor.id, p_actor.id);
  end if;
  -- ขั้นสุดท้ายเปลี่ยน = ยอดของงานเปลี่ยนตาม
  return private.bom_gr_recompute(v_job.id, p_actor_name, 'GR ตั้งขั้นตอนของงาน');
end;
$$;
revoke all on function private.bom_gr_save_plan(public.employees, text, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- addGrRecord / editGrRecord / voidGrRecord (หนึ่งแถว) ลำดับตรวจ: รูปแถว -> สิทธิ์ของแผนก -> ผล / งาน (ไม่พบ = BOM_INVALID_GR) -> ชนรุ่น
-- -> สิทธิ์ของพนักงาน (ของตัวเอง วันที่) -> สถานะใบ / งาน / ผล -> ขั้น ผู้ทำ วันที่ เหตุผล · คืน { jobs, orders }
create or replace function private.bom_gr_save_record(p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_id text;
  v_no text;
  v_step text;
  v_date_text text;
  v_date date;
  v_worker_text text;
  v_worker uuid;
  v_hours numeric;
  v_people numeric;
  v_good numeric;
  v_reject numeric;
  v_reason text;
  v_note text;
  v_why text;
  v_lead boolean;
  v_today date := private.bom_gr_today();
  v_rec public.bom_gr_records%rowtype;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_steps jsonb;
  v_config jsonb;
  v_label text;
begin
  if p_action not in ('addGrRecord', 'editGrRecord', 'voidGrRecord') then raise exception 'BOM_INVALID_GR'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_GR'));
  if v_id !~ v_uuid then raise exception 'BOM_INVALID_GR'; end if;
  if p_action = 'voidGrRecord' then
    v_why := private.bom_text(v_row, 'reason', 200, 3, 'BOM_INVALID_GR');
  else
    if p_action = 'addGrRecord' then
      v_no := private.bom_text(v_row, 'jobId', 40, 1, 'BOM_INVALID_GR');
      if v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_GR'; end if;
    else
      v_why := private.bom_text(v_row, 'editReason', 200, 3, 'BOM_INVALID_GR');
    end if;
    v_step := upper(private.bom_text(v_row, 'stepCode', 20, 1, 'BOM_INVALID_GR'));
    v_date_text := private.bom_text(v_row, 'workDate', 10, 10, 'BOM_INVALID_GR');
    if v_date_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'BOM_INVALID_GR'; end if;
    begin
      v_date := v_date_text::date;
    exception when others then
      raise exception 'BOM_INVALID_GR';
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> v_date_text then raise exception 'BOM_INVALID_GR'; end if;
    v_worker_text := lower(private.bom_text(v_row, 'workerId', 40, 1, 'BOM_INVALID_GR'));
    if v_worker_text !~ v_uuid then raise exception 'BOM_INVALID_GR'; end if;
    v_worker := v_worker_text::uuid;
    v_hours := private.bom_num(v_row -> 'hours', 'BOM_INVALID_GR', 0, 24);
    if v_hours is null or v_hours <= 0 or v_hours <> round(v_hours, 2) then raise exception 'BOM_INVALID_GR'; end if;
    v_people := private.bom_num(v_row -> 'people', 'BOM_INVALID_GR', 1, 50);
    if v_people is null or v_people <> trunc(v_people) then raise exception 'BOM_INVALID_GR'; end if;
    v_good := coalesce(private.bom_num(v_row -> 'good', 'BOM_INVALID_GR', 0, 10000000), 0);
    v_reject := coalesce(private.bom_num(v_row -> 'reject', 'BOM_INVALID_GR', 0, 10000000), 0);
    if v_good <> trunc(v_good) or v_reject <> trunc(v_reject) or v_good + v_reject <= 0 then raise exception 'BOM_INVALID_GR'; end if;
    -- เสีย 0 = ไม่เก็บเหตุผล · เสีย > 0 ต้องมีเหตุผล (ตรวจกับรายการตั้งค่าข้างล่าง)
    v_reason := nullif(private.bom_text(v_row, 'reason', 60, 0, 'BOM_INVALID_GR'), '');
    if v_reject = 0 then v_reason := null; elsif v_reason is null then raise exception 'BOM_INVALID_GR'; end if;
    v_note := private.bom_text(v_row, 'note', 200, 0, 'BOM_INVALID_GR');
  end if;

  -- สิทธิ์ของแผนก: พนักงานแผนก GR ทุกบทบาท หรือกลุ่มวางแผน · หัวหน้า GR / กลุ่มวางแผน = ผู้นำ (ของทุกคนทุกวัน)
  if not (p_planner or coalesce(private.bom_dept_of(p_actor) = 'GR', false)) then raise exception 'BOM_FORBIDDEN'; end if;
  v_lead := p_planner or private.bom_gr_is_head(p_actor, 'GR');

  if p_action = 'addGrRecord' then
    -- id เดิม (กดซ้ำ / ส่งซ้ำ) = ไม่นับซ้ำ
    if exists (select 1 from public.bom_gr_records r where r.id = v_id::uuid) then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
    if not found or v_job.dept <> 'GR' then raise exception 'BOM_INVALID_GR'; end if;
  else
    select * into v_rec from public.bom_gr_records r where r.is_test = (select private.bom_test_mode()) and r.id = v_id::uuid for update;
    if not found then raise exception 'BOM_INVALID_GR'; end if;
    if v_rec.changed_version > p_base and v_rec.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    select * into v_job from public.bom_jobs j where j.id = v_rec.job_id for update;
  end if;

  -- พนักงาน (ไม่ใช่ผู้นำ): ผลของตัวเอง วันที่ทำงานวันนี้หรือเมื่อวาน · แก้ / ยกเลิกได้เฉพาะวันที่บันทึก
  if not v_lead then
    if p_action <> 'addGrRecord' and (v_rec.worker_id <> p_actor.id or (v_rec.created_at at time zone 'Asia/Bangkok')::date <> v_today) then
      raise exception 'BOM_FORBIDDEN';
    end if;
    if p_action <> 'voidGrRecord' and (v_worker <> p_actor.id or v_date not in (v_today, v_today - 1)) then
      raise exception 'BOM_FORBIDDEN';
    end if;
  end if;

  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
  if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- งานเสร็จแล้ว = กลุ่มวางแผนเท่านั้น · งานที่พักอยู่เพิ่มผลไม่ได้ (เหมือน reportJob) · ผลที่ยกเลิกแล้วแก้ / ยกเลิกซ้ำไม่ได้
  if v_job.status = 'done' and not p_planner then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action = 'addGrRecord' and v_job.status = 'hold' then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action <> 'addGrRecord' and v_rec.status <> 'active' then raise exception 'BOM_INVALID_TRANSITION'; end if;

  if p_action <> 'voidGrRecord' then
    -- ขั้นต้องอยู่ในขั้นตอนของงาน
    select p.steps into v_steps from public.bom_gr_job_plans p where p.job_id = v_job.id;
    if v_steps is null or not exists (select 1 from jsonb_array_elements(v_steps) as s where s.value ->> 'code' = v_step) then
      raise exception 'BOM_INVALID_GR';
    end if;
    -- ผู้ทำ (ใหม่หรือเปลี่ยน) = พนักงานของแผนก GR ในโหมดเดียวกัน: ใช้งานจริง = active · บัญชีทดสอบ (persona) เป็น inactive เสมอตามข้อบังคับ employees_test_persona_inert จึงไม่ตรวจ active
    if (p_action = 'addGrRecord' or v_worker <> v_rec.worker_id) and not exists (
         select 1 from public.employees e join public.departments d on d.id = e.department_id
         where e.id = v_worker and (e.is_active or e.is_test) and e.is_test = (select private.bom_test_mode()) and d.code = 'GR') then
      raise exception 'BOM_INVALID_GR';
    end if;
    if v_date > v_today or v_date < date '2000-01-01' then raise exception 'BOM_INVALID_GR'; end if;
    v_config := private.bom_gr_config_now();
    if v_reason is not null and not ((v_config -> 'reasons') ? v_reason) then raise exception 'BOM_INVALID_GR'; end if;
  end if;
  if p_action <> 'addGrRecord' and jsonb_array_length(v_rec.edits) >= 100 then raise exception 'BOM_INVALID_GR'; end if;

  if p_action = 'addGrRecord' then
    insert into public.bom_gr_records (id, is_test, job_id, step_code, work_date, worker_id, hours, people, good, reject, reason, note, created_by)
    values (v_id::uuid, (select private.bom_test_mode()), v_job.id, v_step, v_date, v_worker, v_hours, v_people::integer, v_good::integer, v_reject::integer,
            v_reason, v_note, p_actor.id);
    v_label := 'GR บันทึกผล ' || v_step || ' ' || v_date_text;
  else
    -- ประวัติ: ค่าก่อนแก้ / ยกเลิก พร้อมเหตุผล ผู้ทำ และเวลา (เซิร์ฟเวอร์ต่อท้าย)
    update public.bom_gr_records set
      step_code = case when p_action = 'editGrRecord' then v_step else step_code end,
      work_date = case when p_action = 'editGrRecord' then v_date else work_date end,
      worker_id = case when p_action = 'editGrRecord' then v_worker else worker_id end,
      hours = case when p_action = 'editGrRecord' then v_hours else hours end,
      people = case when p_action = 'editGrRecord' then v_people::integer else people end,
      good = case when p_action = 'editGrRecord' then v_good::integer else good end,
      reject = case when p_action = 'editGrRecord' then v_reject::integer else reject end,
      reason = case when p_action = 'editGrRecord' then v_reason else reason end,
      note = case when p_action = 'editGrRecord' then v_note else note end,
      status = case when p_action = 'voidGrRecord' then 'void' else status end,
      void_reason = case when p_action = 'voidGrRecord' then v_why else void_reason end,
      edits = edits || jsonb_build_array(jsonb_build_object(
        'at', private.bom_ms(now()), 'by', p_actor_name, 'kind', case when p_action = 'voidGrRecord' then 'void' else 'edit' end, 'reason', v_why,
        'before', jsonb_build_object('stepCode', v_rec.step_code, 'workDate', to_char(v_rec.work_date, 'YYYY-MM-DD'), 'workerId', v_rec.worker_id::text,
                                     'hours', trim_scale(v_rec.hours), 'people', v_rec.people, 'good', v_rec.good, 'reject', v_rec.reject,
                                     'reason', v_rec.reason, 'note', v_rec.note))),
      updated_by = p_actor.id,
      updated_at = clock_timestamp()
    where id = v_rec.id;
    v_label := case when p_action = 'voidGrRecord' then 'GR ยกเลิกผล ' else 'GR แก้ไขผล ' end || v_rec.step_code || ' ' || to_char(v_rec.work_date, 'YYYY-MM-DD');
  end if;
  return private.bom_gr_recompute(v_job.id, p_actor_name, v_label);
end;
$$;
revoke all on function private.bom_gr_save_record(public.employees, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- requestRods / cancelRodRequest (หนึ่งแถว) · คืน 1
create or replace function private.bom_gr_save_request(p_actor public.employees, p_planner boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_id text;
  v_no text;
  v_code text;
  v_qty numeric;
  v_note text;
  v_why text;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_req public.bom_rod_requests%rowtype;
begin
  if p_action not in ('requestRods', 'cancelRodRequest') then raise exception 'BOM_INVALID_GR'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_GR'));
  if v_id !~ v_uuid then raise exception 'BOM_INVALID_GR'; end if;

  if p_action = 'requestRods' then
    v_no := private.bom_text(v_row, 'jobId', 40, 1, 'BOM_INVALID_GR');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_GR'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_GR'));
    if v_code = '' then raise exception 'BOM_INVALID_GR'; end if;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_GR', 1, 100000);
    if v_qty is null or v_qty <> trunc(v_qty) then raise exception 'BOM_INVALID_GR'; end if;
    v_note := private.bom_text(v_row, 'note', 200, 0, 'BOM_INVALID_GR');
    -- ขอได้ = แผนก GR ทุกบทบาท หรือกลุ่มวางแผน
    if not (p_planner or coalesce(private.bom_dept_of(p_actor) = 'GR', false)) then raise exception 'BOM_FORBIDDEN'; end if;
    if exists (select 1 from public.bom_rod_requests q where q.id = v_id::uuid) then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no;
    if not found or v_job.dept <> 'GR' then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
    if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- รหัสต้องเป็นบรรทัดเส้นยาง (RB) ของผลระเบิดของใบที่ชิ้นแม่คือชิ้นของงานนี้
    if not exists (select 1 from jsonb_array_elements(coalesce(v_ord.explosion, '[]'::jsonb)) as e
                   where e.value ->> 'itemCode' = v_code and e.value ->> 'kind' = 'RB' and e.value ->> 'parentCode' = v_job.item_code) then
      raise exception 'BOM_INVALID_GR';
    end if;
    insert into public.bom_rod_requests (id, is_test, order_pk, job_id, item_code, qty, note, created_by)
    values (v_id::uuid, (select private.bom_test_mode()), v_ord.id, v_job.id, v_code, v_qty::integer, v_note, p_actor.id);
    return 1;
  end if;

  v_why := private.bom_text(v_row, 'reason', 200, 3, 'BOM_INVALID_GR');
  select * into v_req from public.bom_rod_requests q where q.is_test = (select private.bom_test_mode()) and q.id = v_id::uuid for update;
  if not found then raise exception 'BOM_INVALID_GR'; end if;
  -- ยกเลิกได้ = ผู้ขอ หัวหน้า GR หรือกลุ่มวางแผน
  if not (p_planner or private.bom_gr_is_head(p_actor, 'GR') or v_req.created_by = p_actor.id) then raise exception 'BOM_FORBIDDEN'; end if;
  if v_req.changed_version > p_base and v_req.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  if v_req.status <> 'open' then raise exception 'BOM_INVALID_TRANSITION'; end if;
  update public.bom_rod_requests set status = 'cancelled', cancelled_by = p_actor.id, cancelled_at = clock_timestamp(), cancel_reason = v_why
  where id = v_req.id;
  return 1;
end;
$$;
revoke all on function private.bom_gr_save_request(public.employees, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- sendGrToPk / receiveGrAtPk / cancelGrHandover (หนึ่งแถว) · คืน 1
create or replace function private.bom_gr_save_handover(p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_id text;
  v_no text;
  v_qty numeric;
  v_note text;
  v_why text;
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
  v_ho public.bom_gr_handovers%rowtype;
  v_sent numeric;
begin
  if p_action not in ('sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover') then raise exception 'BOM_INVALID_GR'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_GR'));
  if v_id !~ v_uuid then raise exception 'BOM_INVALID_GR'; end if;

  if p_action = 'sendGrToPk' then
    v_no := private.bom_text(v_row, 'jobId', 40, 1, 'BOM_INVALID_GR');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_GR'; end if;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_GR', 1, 10000000);
    if v_qty is null or v_qty <> trunc(v_qty) then raise exception 'BOM_INVALID_GR'; end if;
    v_note := private.bom_text(v_row, 'note', 200, 0, 'BOM_INVALID_GR');
    -- ส่งได้ = หัวหน้า GR หรือกลุ่มวางแผน
    if not (p_planner or private.bom_gr_is_head(p_actor, 'GR')) then raise exception 'BOM_FORBIDDEN'; end if;
    if exists (select 1 from public.bom_gr_handovers h where h.id = v_id::uuid) then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
    if not found or v_job.dept <> 'GR' then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- Σ ที่ส่งแล้ว (sent / received) + ครั้งนี้ ต้องไม่เกินยอดดีของงาน
    select coalesce(sum(h.qty), 0) into v_sent from public.bom_gr_handovers h where h.job_id = v_job.id and h.status <> 'cancelled';
    if v_sent + v_qty > v_job.qty_done + 0.000000001 then raise exception 'BOM_GR_EXCEEDS'; end if;
    insert into public.bom_gr_handovers (id, is_test, job_id, order_pk, item_code, qty, note, sent_by, moves)
    values (v_id::uuid, (select private.bom_test_mode()), v_job.id, v_ord.id, v_job.item_code, v_qty::integer, v_note, p_actor.id,
            jsonb_build_array(jsonb_build_object('kind', 'send', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_note)));
    return 1;
  end if;

  if p_action = 'cancelGrHandover' then v_why := private.bom_text(v_row, 'reason', 200, 3, 'BOM_INVALID_GR'); end if;
  select * into v_ho from public.bom_gr_handovers h where h.is_test = (select private.bom_test_mode()) and h.id = v_id::uuid for update;
  if not found then raise exception 'BOM_INVALID_GR'; end if;
  -- สิทธิ์ตามสถานะ: รับ = แผนก PK · ยกเลิกที่ยังไม่รับ = หัวหน้า GR · ย้อนการรับ = หัวหน้า PK · กลุ่มวางแผนทำได้ทุกอย่าง
  if p_action = 'receiveGrAtPk' and not (p_planner or coalesce(private.bom_dept_of(p_actor) = 'PK', false)) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action = 'cancelGrHandover' and not (p_planner or private.bom_gr_is_head(p_actor, (case when v_ho.status = 'received' then 'PK' else 'GR' end))) then
    raise exception 'BOM_FORBIDDEN';
  end if;
  if v_ho.changed_version > p_base and v_ho.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  select * into v_ord from public.bom_orders o where o.id = v_ho.order_pk;
  if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action = 'receiveGrAtPk' then
    if v_ho.status <> 'sent' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    update public.bom_gr_handovers set status = 'received', received_by = p_actor.id, received_at = clock_timestamp(),
      moves = moves || jsonb_build_array(jsonb_build_object('kind', 'receive', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', ''))
    where id = v_ho.id;
  elsif v_ho.status = 'sent' then
    update public.bom_gr_handovers set status = 'cancelled', cancelled_by = p_actor.id, cancelled_at = clock_timestamp(), cancel_reason = v_why,
      moves = moves || jsonb_build_array(jsonb_build_object('kind', 'cancel', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_why))
    where id = v_ho.id;
  elsif v_ho.status = 'received' then
    update public.bom_gr_handovers set status = 'sent', received_by = null, received_at = null,
      moves = moves || jsonb_build_array(jsonb_build_object('kind', 'unreceive', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_why))
    where id = v_ho.id;
  else
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  return 1;
end;
$$;
revoke all on function private.bom_gr_save_handover(public.employees, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- ทางเข้าเดียวจาก app_bom_save_master: action -> ตัวเขียน · คืน { jobs, orders } (งาน / ใบที่ยอดหรือสถานะเปลี่ยนเพราะคำสั่งนี้)
create or replace function private.bom_gr_save(p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_section text := private.bom_gr_section(p_action);
begin
  if v_section is null then raise exception 'BOM_INVALID_GR'; end if;
  if v_section = 'grConfig' then
    perform private.bom_gr_save_config(p_actor, p_planner, p_rows, p_base, p_cur);
  elsif v_section = 'grPlans' then
    return private.bom_gr_save_plan(p_actor, p_actor_name, p_planner, p_rows, p_base, p_cur);
  elsif v_section = 'grRecords' then
    return private.bom_gr_save_record(p_actor, p_actor_name, p_planner, p_action, p_rows, p_base, p_cur);
  elsif v_section = 'rodRequests' then
    perform private.bom_gr_save_request(p_actor, p_planner, p_action, p_rows, p_base, p_cur);
  else
    perform private.bom_gr_save_handover(p_actor, p_actor_name, p_planner, p_action, p_rows, p_base, p_cur);
  end if;
  return jsonb_build_object('jobs', 0, 'orders', 0);
end;
$$;
revoke all on function private.bom_gr_save(public.employees, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. รายการ action ------------------------------------------------------------------------------------------------------------------
-- private.bom_client_actions() จาก 20261204010000_bom_sr_store_module.sql (+ สิบ action ของ GR)
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
    'saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- private.bom_staff_actions() จาก 20261204010000_bom_sr_store_module.sql (+ สิบ action ของ GR · สิทธิ์จริงตรวจในตัวเขียน private.bom_gr_save_*)
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods', 'receiveRodsOpening', 'setRodLocation',
    'saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 6. ชุดเรคอร์ด -------------------------------------------------------------------------------------------------------------------
-- private.bom_records(bigint) จาก 20261204010000_bom_sr_store_module.sql (+ grConfig, grPlans, grRecords, rodRequests, grHandovers, grWorkers)
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
    -- แปรรูปยาง GR (20261214010000): ตั้งค่า (ว่าง = ใช้ค่าเริ่มต้น) ขั้นตอนของงาน ผลรายวัน คำขอเบิกยางเส้นยาว การส่งงานให้ PK (เลขงาน / เลข PI แทน uuid ของแถว)
    'grConfig', coalesce((
      select jsonb_agg(jsonb_build_object(
          'key', 'gr', 'steps', c.steps, 'reasons', c.reasons, 'targets', c.targets,
          'updatedBy', coalesce(private.bom_person(c.updated_by), ''), 'updatedAt', private.bom_ms(c.updated_at)))
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
          'id', h.id::text, 'jobId', j.job_no, 'orderId', o.pi_no, 'itemCode', h.item_code, 'qty', h.qty, 'status', h.status, 'note', h.note,
          'sentBy', coalesce(private.bom_person(h.sent_by), ''), 'sentAt', private.bom_ms(h.sent_at),
          'receivedBy', case when h.received_at is null then null else coalesce(private.bom_person(h.received_by), '') end,
          'receivedAt', private.bom_ms(h.received_at),
          'cancelledBy', case when h.cancelled_at is null then null else coalesce(private.bom_person(h.cancelled_by), '') end,
          'cancelledAt', private.bom_ms(h.cancelled_at), 'cancelReason', h.cancel_reason, 'moves', h.moves)
        order by h.sent_at, h.id)
      from public.bom_gr_handovers h join public.bom_jobs j on j.id = h.job_id join public.bom_orders o on o.id = h.order_pk
      where h.is_test = (select private.bom_test_mode()) and h.changed_version > p_since), '[]'::jsonb),
    -- พนักงานของแผนก GR ในโหมดเดียวกัน (หัวหน้าเลือกผู้ทำ: ใช้งานจริง = active · บัญชีทดสอบ inactive เสมอจึงไม่ตรวจ) เฉพาะ snapshot (p_since < 0) · ส่วนต่างเป็น [] เสมอ (ตารางพนักงานไม่มีเลขรุ่น)
    'grWorkers', case when p_since >= 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id::text, 'name', e.first_name || ' ' || e.last_name) order by e.first_name, e.last_name, e.id)
      from public.employees e join public.departments d on d.id = e.department_id
      where d.code = 'GR' and (e.is_active or e.is_test) and e.is_test = (select private.bom_test_mode())), '[]'::jsonb) end)
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- private.bom_delta(bigint) จาก 20261202010000_bom_sr_rod_store.sql (+ หกชุดของ GR)
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
                   ('grConfig'), ('grPlans'), ('grRecords'), ('rodRequests'), ('grHandovers'), ('grWorkers')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;

-- 7. RPC บันทึก ------------------------------------------------------------------------------------------------------------------
-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261204010000_bom_sr_store_module.sql
--   (+ ห้าส่วนของ GR จับคู่กับ action ผ่าน private.bom_gr_section และตัวเขียน private.bom_gr_save ก่อนเปลี่ยนใบที่งานเริ่มเป็น in_progress)
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
                                      'grConfig', 'grPlans', 'grRecords', 'rodRequests', 'grHandovers'];
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
  v_gr jsonb;
  v_gr_section text := private.bom_gr_section(p_action);
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
      -- คลังยางเส้นยาว SR (20261202010000 · 20261204010000): ส่วน rodLots ส่งได้เฉพาะ receiveRods / decideRods / receiveRodsOpening / setRodLocation
      -- · ส่วน rodMoves เฉพาะ issueRods / reverseRodIssue / adjustRods · และเจ็ดการกระทำนี้ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_ROD)
      if v_n > 0 and ((v_key = 'rodLots' and p_action not in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation'))
                      or (v_key = 'rodMoves' and p_action not in ('issueRods', 'reverseRodIssue', 'adjustRods'))
                      or (p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') and v_key <> 'rodLots')
                      or (p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and v_key <> 'rodMoves')) then
        raise exception 'BOM_INVALID_ROD';
      end if;
      -- แปรรูปยาง GR (20261214010000): ส่วน grConfig / grPlans / grRecords / rodRequests / grHandovers ส่งได้เฉพาะ action ของส่วนนั้น (private.bom_gr_section)
      -- และสิบ action ของ GR ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_GR)
      if v_n > 0 and ((v_key in ('grConfig', 'grPlans', 'grRecords', 'rodRequests', 'grHandovers') and v_gr_section is distinct from v_key)
                      or (v_gr_section is not null and v_key <> v_gr_section)) then
        raise exception 'BOM_INVALID_GR';
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
    -- แปรรูปยาง GR (20261214010000): ตั้งค่า / ขั้นตอนของงาน / ผลรายวัน / ขอเบิกยางเส้นยาว / ส่งงานให้ PK ผ่าน private.bom_gr_save (แถวคำขอเดียว)
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

-- 8. ล้างข้อมูล BOM ทดสอบ: public.app_sandbox_purge_bom() จาก 20261202010000_bom_sr_rod_store.sql (+ ห้าตารางของ GR ลบก่อน bom_rod_moves / bom_jobs / bom_orders)
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
    'bom_gr_records', 'bom_gr_handovers', 'bom_rod_requests', 'bom_gr_job_plans', 'bom_gr_config',
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
