-- ============================================================================
-- BOM โหมดทดสอบ: ขั้นตอนรายแผนกของ PT (ขึ้นรูปพลาสติก) BG (เย็บจักร) และ PK (ประกอบและบรรจุ) แบบเดียวกับ GR · ส่งงาน PT / BG → PK และ PK → WH (โรงงาน ขั้น 7)
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-25, factory-step7-spec):
--   1) PK แยก 3 ขั้นแบบ GR: ประกอบ → ใส่กระเป๋า → บรรจุกล่อง บันทึกต่อคน × ขั้น × วัน ยอดของงาน = ดีของขั้นสุดท้าย · หัวหน้า PK แก้รายการขั้นตอนเอง
--   2) PT / BG แบบ GR รายคน × ขั้น × วัน · หัวหน้าแผนกตั้งรายการขั้นตอนของแผนกเองในตั้งค่า
--   3) PT / BG → PK แบบ GR: หัวหน้าแผนก (หรือกลุ่มวางแผน) กดส่งให้ PK ไม่เกินยอดดี · พนักงาน PK คนใดก็ได้กดรับทั้งรายการ · ที่ยังไม่ส่ง = รอที่แผนก
--   4) PK → WH: หัวหน้า PK (หรือกลุ่มวางแผน) กดส่งให้ WH พร้อมจำนวน · WH รับได้ไม่เกินที่ PK ส่ง (หน้ารับของ WH เหมือนเดิม รับบางส่วนได้ ปิดใบอัตโนมัติเหมือนเดิม)
--   5) เหตุผลของเสียและการแก้ไขเหมือน GR: รายการเหตุผลต่อแผนก (หัวหน้าแผนกแก้) · พนักงานแก้ / ยกเลิกผลของตัวเองได้วันที่บันทึก · หัวหน้าแผนกและกลุ่มวางแผนได้ทุกวันพร้อมเหตุผล เก็บประวัติ
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และ private.bom_actor() (นอกโหมดทดสอบ = BOM_TEST_MODE_ONLY)
--
-- แบบที่เลือก: ใช้กลไกเดียวของ GR (20261216010000_bom_gr_module.sql) กับสี่แผนก GR PT BG PK ไม่สร้างตารางคู่ขนาน
--   - bom_gr_config + คอลัมน์ dept (ค่าเดิม 'GR') หนึ่งแถวต่อโหมด × แผนก (unique (is_test) → unique (is_test, dept)) · ไม่มีแถว = ค่าเริ่มต้นของแผนก (private.bom_dept_default_config)
--   - bom_gr_job_plans / bom_gr_records ไม่เปลี่ยนโครงสร้าง: แผนกมาจากงาน (bom_jobs.dept) · trigger bom_jobs_gr_guard ใช้กับทุกงานที่มีแผนขั้นตอนอยู่แล้ว จึงครอบ PT / BG / PK ทันที
--   - bom_gr_handovers + from_dept / to_dept (ค่าเดิม 'GR' / 'PK' = แถวเดิมทั้งหมด) เส้นทางที่ยอมรับ GR / PT / BG → PK และ PK → WH
--     qty integer → numeric: ส่งให้ PK ยังเป็นจำนวนเต็มเท่านั้น (ตัวเขียนและ constraint) · ส่ง PK → WH มีทศนิยมได้ 4 ตำแหน่ง (ยอดของงาน PK / FG เป็นทศนิยมได้ เช่นเดียวกับที่ WH รับ)
--     PK → WH มีสถานะ sent / cancelled เท่านั้น (WH รับด้วย receiveFg ตามเดิม ไม่เปลี่ยนแถวส่ง)
--   ไม่มีตารางใหม่: sandbox_unguarded_tables / app_sandbox_purge_bom / lab_only_guard_table / RLS / grant ของห้าตาราง GR ครอบอยู่แล้ว ไม่ต้อง replace
--   ไม่มีชุดเรคอร์ดใหม่: ชุด grConfig / grHandovers / grWorkers เพิ่มช่อง (ข้างล่าง) จำนวนชุดของ snapshot / delta คง 22 ชุด (bom_delta ไม่ต้อง replace)
--
-- ค่าเริ่มต้นของแผนกใหม่ (ตัดสินโดยไม่ได้ถามเจ้าของ: รายงานให้เจ้าของยืนยัน) · รหัสขั้นใช้รหัสขั้นตอนผลิตเดิมของ BOM (DEFAULT_PROCESSES) routing จึงตรงกับขั้นของงาน
--   PT: สายหลัก PT-01 ขึ้นรูป · BG: สายหลัก BG-02 เย็บ (BG-02 = เย็บกระเป๋าใส่สินค้าใน routing) · PK: สายหลัก PK-01 ประกอบ → PK-02 ใส่กระเป๋า → PK-03 บรรจุกล่อง
--   เหตุผลของเสีย PT: ขึ้นรูปไม่เต็ม · ขนาดไม่ได้ · ผิวไม่สวย/มีรอย · สีไม่ตรง · วัตถุดิบมีตำหนิ · อื่นๆ
--     BG: ฝีเข็มไม่สวย/หลุด · เย็บผิดตำแหน่ง · ขนาดไม่ได้ · ผ้า/ซิปมีตำหนิ · อื่นๆ · PK: ประกอบไม่ได้ · ชิ้นส่วนมีตำหนิ · ชิ้นส่วนไม่ครบ · กระเป๋า/กล่องเสียหาย · อื่นๆ
--   รหัสขั้นที่หัวหน้าเพิ่มเองเป็นรูป <แผนก>-<ตัวอักษร/ตัวเลข 1-10> · GR คงค่าเริ่มต้นเดิม (private.bom_gr_default_config ไม่เปลี่ยน)
--
-- ใคร: หัวหน้าแผนก = private.bom_gr_is_head(ผู้เรียก, แผนก) (department_manager หรือ assistant_department_manager ของแผนกนั้น) · กลุ่มวางแผน (private.bom_can_edit) ทำได้ทุกอย่าง
--
-- action (ส่วน upsert แถวเดียวต่อคำสั่ง ลำดับตรวจเหมือน GR: รูปแถว → สิทธิ์ → แถวที่อ้าง → ชนรุ่น → สถานะ → กติกาข้อมูล)
--   saveGrConfig grConfig [{dept? ('GR' เมื่อไม่ส่ง | 'PT' | 'BG' | 'PK'), steps, reasons, targets}] หัวหน้าแผนกนั้น / กลุ่มวางแผน · รหัสขั้นขึ้นต้นด้วยแผนก
--     ขั้นที่ลบไม่ได้ตรวจเฉพาะผล / แผนของงานแผนกเดียวกัน
--   setGrJobSteps / addGrRecord / editGrRecord / voidGrRecord: แผนกมาจากงาน (GR / PT / BG / PK) · สิทธิ์ ผู้ทำ (พนักงานของแผนกนั้น) เหตุผลของเสีย และขั้นในตั้งค่า ตามแผนกของงาน
--     ด่านหยาบก่อนอ่านงาน (ลำดับเดิมของ GR): ไม่ใช่กลุ่มวางแผนและไม่ใช่ (พนักงาน / หัวหน้า) ของสี่แผนก = BOM_FORBIDDEN · งานของแผนกอื่น = BOM_FORBIDDEN
--   sendGrToPk {id, jobId, qty, note}: เหมือนเดิม (งาน GR หัวหน้า GR / กลุ่มวางแผน)
--   sendToPk {id, jobId, qty, note}: งาน GR / PT / BG หัวหน้าแผนกของงาน / กลุ่มวางแผน · ใบ released / in_progress · Σ ที่ส่ง (ไม่นับยกเลิก) ≤ ยอดดีของงาน (BOM_GR_EXCEEDS)
--   receiveGrAtPk = receiveAtPk {id}: แถวที่ส่งให้ PK (จากแผนกใดก็ได้) แผนก PK ทุกบทบาท / กลุ่มวางแผน รับทั้งรายการ sent → received
--   cancelGrHandover = cancelHandover {id, reason 3-200}: แถวที่ส่งให้ PK · sent → cancelled = หัวหน้าแผนกผู้ส่ง / กลุ่มวางแผน · received → sent = หัวหน้า PK / กลุ่มวางแผน
--   sendPkToWh {id, jobId, qty (> 0 ทศนิยม 4), note}: งาน PK ชนิด FG หัวหน้า PK / กลุ่มวางแผน · ใบ released / in_progress / completed (ส่วนที่ PK ผลิตเกินส่งได้หลังใบปิด เหมือนที่ WH รับได้)
--     Σ ที่ส่ง (ไม่นับยกเลิก) ≤ ยอดดีของงาน (BOM_GR_EXCEEDS)
--   cancelPkToWh {id, reason 3-200}: แถวที่ส่งให้ WH สถานะ sent หัวหน้า PK / กลุ่มวางแผน · ใบ released / in_progress / completed
--     ยกเลิกได้เฉพาะส่วนที่ WH ยังไม่รับ: Σ ที่ส่งที่เหลือ (ใบ × รหัส) ต้องไม่ต่ำกว่าที่ WH รับสุทธิแล้ว ไม่งั้น BOM_FG_EXCEEDS (ให้ WH ย้อนรับเข้าก่อน)
--   แก้ / ยกเลิกผล หรือเปลี่ยนขั้นสุดท้ายของงาน PK จนยอดดีต่ำกว่าที่ส่งให้ WH แล้ว = BOM_GR_EXCEEDS (private.bom_gr_recompute เดิมนับทุกการส่งของงาน)
--   receiveFg (private.bom_fg_move): เพดานรับสะสมของใบ × สินค้า = min(ยอดที่ PK ทำ (bom_fg_pk_done เดิม), Σ ที่ PK ส่งให้ WH ไม่นับยกเลิก (bom_fg_pk_sent)) เกิน = BOM_FG_EXCEEDS
--     อย่างอื่นของ bom_fg_move ไม่เปลี่ยน: รับบางส่วน ปิดใบอัตโนมัติ closeOrder / closeOrderShort (ยังต้องรับเท่ายอดที่ PK ทำ) ส่วนเกินเป็นสต็อก reverseFg
--   ข้อมูลเดิม (ข้อ 7): ใบ × สินค้าที่ WH รับเข้าแล้วก่อนไฟล์นี้ได้แถวส่ง PK → WH (sent · note 'ยอดรับก่อนมีการส่ง') เท่ายอดรับสุทธิ ทั้งสองโหมด
--     จึง Σ ที่ส่ง >= ที่รับเสมอ: ใบเก่าไม่ค้าง "ยังไม่ได้ส่ง WH" และ closeOrderShort ไม่ติดเพดานใหม่
--   รหัสข้อผิดพลาด: ใช้รหัสเดิมทั้งหมด (BOM_INVALID_GR / BOM_GR_EXCEEDS / BOM_FG_EXCEEDS / BOM_FORBIDDEN / BOM_STALE / BOM_INVALID_TRANSITION)
--
-- รูปเรคอร์ดที่ส่งกลับ (เพิ่มช่อง ชุดเดิม): grConfig + dept · key = lower(dept) ('gr' ของ GR เหมือนเดิม) เรียง GR ก่อน
--   grHandovers + fromDept, toDept · grWorkers + dept และรวมพนักงาน PT / BG / PK (GR ก่อน) · grRecords / grPlans ไม่เปลี่ยน (แผนกดูจากงาน)
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main)
--   - private.bom_gr_config_now()  จาก 20261216010000_bom_gr_module.sql (อ่านแถวของ GR: ตารางมีหลายแผนกแล้ว)
--   - private.bom_gr_section(text)  จาก 20261216010000_bom_gr_module.sql (+ ห้า action)
--   - private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_gr_save_plan(public.employees, text, boolean, jsonb, bigint, bigint)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_gr_save_record(public.employees, text, boolean, text, jsonb, bigint, bigint)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_gr_save_handover(public.employees, text, boolean, text, jsonb, bigint, bigint)  จาก 20261216010000_bom_gr_module.sql
--   - private.bom_client_actions()  จาก 20261216010000_bom_gr_module.sql (+ ห้า action)
--   - private.bom_staff_actions()  จาก 20261216010000_bom_gr_module.sql (+ ห้า action · สิทธิ์จริงตรวจในตัวเขียน)
--   - private.bom_records(bigint)  จาก 20261216010000_bom_gr_module.sql (ช่องใหม่ของสามชุด)
--   - private.bom_fg_move(public.employees, text, jsonb)  จาก 20261130010000_bom_rf_go_live.sql (เพดานรับ)
--   ใหม่ (search_path = '' · revoke all from public, anon, authenticated): private.bom_dept_default_config(text), private.bom_dept_config_now(text) (security definer),
--     private.bom_fg_pk_sent(uuid, text)
--   ไม่แตะ: app_bom_save_master · bom_delta · bom_gr_save · bom_gr_recompute · bom_gr_job_guard · bom_gr_is_head · bom_gr_default_config · bom_save_jobs ·
--     sandbox_unguarded_tables · app_sandbox_purge_bom · private.bom_real_open() · private.bom_actor()
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ที่ใช้ action / ช่องใหม่ต้องรอให้ apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge
--   ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสิบฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   Pilot เก่า + ฐานข้อมูลใหม่: GR ใช้ได้เหมือนเดิม (action เดิม แถวตั้งค่าของ GR มาก่อนเสมอ ช่องใหม่ถูกเมิน) · ข้อต่างที่เห็นได้:
--     WH รับของได้เฉพาะที่ PK ส่งให้ WH แล้ว แต่ Pilot เก่าไม่มีปุ่มส่ง (ช่วงสั้นระหว่าง apply กับ merge · โหมดทดสอบเท่านั้น)
--     รายชื่อผู้ทำของหัวหน้า GR ใน Pilot เก่ามีพนักงาน PT / BG / PK ด้วย (เลือกแล้วฐานข้อมูลปฏิเสธ BOM_INVALID_GR)
--   Pilot ใหม่ + ฐานข้อมูลเก่า: action ใหม่ = BOM_INVALID_ACTION / BOM_FORBIDDEN และ WH รับได้ตามยอด PK แบบเดิม · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace สิบฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่)
--   2) drop function private.bom_fg_pk_sent(uuid, text), private.bom_dept_config_now(text), private.bom_dept_default_config(text)
--   3) delete from public.bom_gr_handovers where from_dept <> 'GR' (รวมแถวที่ข้อ 7 เติม) · delete from public.bom_gr_config where dept <> 'GR'
--      · ลบผล / แผนของงาน PT BG PK: delete from public.bom_gr_records r using public.bom_jobs j where j.id = r.job_id and j.dept <> 'GR' (และ bom_gr_job_plans แบบเดียวกัน)
--   4) alter table public.bom_gr_handovers drop constraint bom_gr_handovers_route_check, drop constraint bom_gr_handovers_wh_status_check, drop constraint bom_gr_handovers_qty_check,
--      drop column from_dept, drop column to_dept, alter column qty type integer, add constraint bom_gr_handovers_qty_check check (qty between 1 and 10000000)
--      · alter table public.bom_gr_config drop constraint bom_gr_config_is_test_dept_key, drop column dept, add constraint bom_gr_config_is_test_key unique (is_test)
-- ============================================================================

-- 1. ตาราง: มิติแผนกของตั้งค่า และเส้นทางของการส่งงาน ------------------------------------------------------------------------------
alter table public.bom_gr_config add column dept text not null default 'GR' check (dept in ('GR', 'PT', 'BG', 'PK'));
alter table public.bom_gr_config drop constraint bom_gr_config_is_test_key;
alter table public.bom_gr_config add constraint bom_gr_config_is_test_dept_key unique (is_test, dept);
comment on table public.bom_gr_config is 'ตั้งค่าขั้นตอนรายแผนก GR / PT / BG / PK (ขั้นตอน เหตุผลของเสีย เป้าชิ้นต่อชั่วโมง) หนึ่งแถวต่อโหมด × แผนก · ไม่มีแถว = private.bom_dept_default_config(dept) · เขียนผ่าน app_bom_save_master (saveGrConfig) เท่านั้น';
comment on table public.bom_gr_job_plans is 'ขั้นตอนของงาน GR / PT / BG / PK (หนึ่งแถวต่องาน แผนกดูจากงาน) · เขียนผ่าน app_bom_save_master (setGrJobSteps) เท่านั้น';
comment on table public.bom_gr_records is 'ผลรายวันของแผนก GR / PT / BG / PK ต่องาน × ขั้น × วัน × คน (ชั่วโมง จำนวนคน ดี เสีย เหตุผล) · เขียนผ่าน app_bom_save_master (addGrRecord / editGrRecord / voidGrRecord) เท่านั้น';

alter table public.bom_gr_handovers
  add column from_dept text not null default 'GR',
  add column to_dept text not null default 'PK';
alter table public.bom_gr_handovers drop constraint bom_gr_handovers_qty_check;
alter table public.bom_gr_handovers alter column qty type numeric;
alter table public.bom_gr_handovers
  add constraint bom_gr_handovers_qty_check check (qty > 0 and qty <= 10000000 and (to_dept = 'WH' or qty = trunc(qty)) and qty = round(qty, 4)),
  add constraint bom_gr_handovers_route_check check ((from_dept in ('GR', 'PT', 'BG') and to_dept = 'PK') or (from_dept = 'PK' and to_dept = 'WH')),
  add constraint bom_gr_handovers_wh_status_check check (to_dept <> 'WH' or status in ('sent', 'cancelled'));
comment on table public.bom_gr_handovers is 'การส่งงานระหว่างแผนก GR / PT / BG → PK (sent -> received / cancelled) และ PK → WH (sent / cancelled · WH รับด้วย receiveFg) · เขียนผ่าน app_bom_save_master (sendGrToPk / sendToPk / receiveGrAtPk / receiveAtPk / cancelGrHandover / cancelHandover / sendPkToWh / cancelPkToWh) เท่านั้น';
-- เพดานรับของ WH รวมตามใบ × รหัส ของแถวที่ส่งให้ WH
create index bom_gr_handovers_wh_idx on public.bom_gr_handovers (order_pk, item_code) where to_dept = 'WH';

-- 2. ตั้งค่ารายแผนก -----------------------------------------------------------------------------------------------------------------
-- ค่าเริ่มต้นของแผนก (ตรงกับ DEPT_DEFAULT_CONFIG ของ modules/bom-rules.js) · GR = private.bom_gr_default_config() เดิม · แผนกอื่น = null
create or replace function private.bom_dept_default_config(p_dept text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_dept
    when 'GR' then private.bom_gr_default_config()
    when 'PT' then jsonb_build_object(
      'steps', jsonb_build_array(jsonb_build_object('code', 'PT-01', 'name', 'ขึ้นรูป', 'kind', 'main', 'seq', 1, 'active', true)),
      'reasons', jsonb_build_array('ขึ้นรูปไม่เต็ม', 'ขนาดไม่ได้', 'ผิวไม่สวย/มีรอย', 'สีไม่ตรง', 'วัตถุดิบมีตำหนิ', 'อื่นๆ'),
      'targets', '[]'::jsonb)
    when 'BG' then jsonb_build_object(
      'steps', jsonb_build_array(jsonb_build_object('code', 'BG-02', 'name', 'เย็บ', 'kind', 'main', 'seq', 1, 'active', true)),
      'reasons', jsonb_build_array('ฝีเข็มไม่สวย/หลุด', 'เย็บผิดตำแหน่ง', 'ขนาดไม่ได้', 'ผ้า/ซิปมีตำหนิ', 'อื่นๆ'),
      'targets', '[]'::jsonb)
    when 'PK' then jsonb_build_object(
      'steps', jsonb_build_array(
        jsonb_build_object('code', 'PK-01', 'name', 'ประกอบ', 'kind', 'main', 'seq', 1, 'active', true),
        jsonb_build_object('code', 'PK-02', 'name', 'ใส่กระเป๋า', 'kind', 'main', 'seq', 2, 'active', true),
        jsonb_build_object('code', 'PK-03', 'name', 'บรรจุกล่อง', 'kind', 'main', 'seq', 3, 'active', true)),
      'reasons', jsonb_build_array('ประกอบไม่ได้', 'ชิ้นส่วนมีตำหนิ', 'ชิ้นส่วนไม่ครบ', 'กระเป๋า/กล่องเสียหาย', 'อื่นๆ'),
      'targets', '[]'::jsonb)
  end
$$;
revoke all on function private.bom_dept_default_config(text) from public, anon, authenticated;

-- ตั้งค่าที่ใช้อยู่ของแผนกในโหมดผู้เรียก { steps, reasons, targets }: แถวของโหมด × แผนก หรือค่าเริ่มต้นของแผนก
create or replace function private.bom_dept_config_now(p_dept text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('steps', c.steps, 'reasons', c.reasons, 'targets', c.targets)
                   from public.bom_gr_config c where c.is_test = (select private.bom_test_mode()) and c.dept = p_dept),
                  private.bom_dept_default_config(p_dept))
$$;
revoke all on function private.bom_dept_config_now(text) from public, anon, authenticated;

-- private.bom_gr_config_now() จาก 20261216010000_bom_gr_module.sql: ตั้งค่าของ GR (ตารางมีหลายแผนกแล้ว จึงเลือกแถว dept = 'GR')
create or replace function private.bom_gr_config_now()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.bom_dept_config_now('GR')
$$;
revoke all on function private.bom_gr_config_now() from public, anon, authenticated;

-- private.bom_gr_section(text) จาก 20261216010000_bom_gr_module.sql (+ sendToPk / receiveAtPk / cancelHandover / sendPkToWh / cancelPkToWh → grHandovers)
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
    when 'sendToPk' then 'grHandovers'
    when 'receiveAtPk' then 'grHandovers'
    when 'cancelHandover' then 'grHandovers'
    when 'sendPkToWh' then 'grHandovers'
    when 'cancelPkToWh' then 'grHandovers'
  end
$$;
revoke all on function private.bom_gr_section(text) from public, anon, authenticated;

-- 3. ตัวเขียน -----------------------------------------------------------------------------------------------------------------------
-- private.bom_gr_save_config จาก 20261216010000_bom_gr_module.sql: แถวมี dept (ไม่ส่ง = 'GR') · รหัสขั้น <แผนก>-… · สิทธิ์ = หัวหน้าแผนกนั้น · ขั้นที่ใช้อยู่ตรวจเฉพาะงานของแผนกนั้น
-- ลำดับตรวจ: รูปแถว (BOM_INVALID_GR) -> สิทธิ์ (BOM_FORBIDDEN) -> ชนรุ่น (BOM_STALE) -> ขั้นที่ใช้อยู่ถูกลบ (BOM_INVALID_GR) · คืน 1
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
  v_dept text;
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
  -- แผนกของตั้งค่า: ไม่ส่ง = GR (Pilot รุ่นก่อน) · GR / PT / BG / PK เท่านั้น
  v_dept := upper(private.bom_text(v_row, 'dept', 2, 0, 'BOM_INVALID_GR'));
  if v_dept = '' then v_dept := 'GR'; end if;
  if v_dept not in ('GR', 'PT', 'BG', 'PK') then raise exception 'BOM_INVALID_GR'; end if;
  -- ขั้นตอน 1-40: รหัส <แผนก>-<A-Z0-9 1-10> ไม่ซ้ำ · ชื่อ 1-60 · main | side · ลำดับ 1-1000 · ใช้อยู่ true | false
  v_node := v_row -> 'steps';
  if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) < 1 or jsonb_array_length(v_node) > 40 then
    raise exception 'BOM_INVALID_GR';
  end if;
  for v_el in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
    v_code := upper(private.bom_text(v_el, 'code', 20, 1, 'BOM_INVALID_GR'));
    if v_code !~ ('^' || v_dept || '-[A-Z0-9]{1,10}$') or v_code = any (v_codes) then raise exception 'BOM_INVALID_GR'; end if;
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

  if not (p_planner or private.bom_gr_is_head(p_actor, v_dept)) then raise exception 'BOM_FORBIDDEN'; end if;

  select * into v_old from public.bom_gr_config c where c.is_test = (select private.bom_test_mode()) and c.dept = v_dept for update;
  v_found := found;
  if v_found and v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
  -- ขั้นที่มีผลบันทึกแล้ว (ทุกสถานะ) หรืออยู่ในขั้นตอนของงานใดของแผนกนี้ ลบออกจากรายการไม่ได้ (ตั้งเป็นไม่ใช้แทน)
  if exists (select 1 from public.bom_gr_records r join public.bom_jobs j on j.id = r.job_id
             where r.is_test = (select private.bom_test_mode()) and j.dept = v_dept and not (r.step_code = any (v_codes)))
     or exists (select 1 from public.bom_gr_job_plans p join public.bom_jobs j on j.id = p.job_id
                cross join lateral jsonb_array_elements(p.steps) as s
                where p.is_test = (select private.bom_test_mode()) and j.dept = v_dept and not ((s.value ->> 'code') = any (v_codes))) then
    raise exception 'BOM_INVALID_GR';
  end if;
  if v_found then
    update public.bom_gr_config set steps = v_steps, reasons = v_reasons, targets = v_targets, updated_by = p_actor.id, updated_at = now()
    where id = v_old.id;
  else
    insert into public.bom_gr_config (is_test, dept, steps, reasons, targets, updated_by)
    values ((select private.bom_test_mode()), v_dept, v_steps, v_reasons, v_targets, p_actor.id);
  end if;
  return 1;
end;
$$;
revoke all on function private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- private.bom_gr_save_plan จาก 20261216010000_bom_gr_module.sql: งานของแผนก GR / PT / BG / PK · ขั้นจากตั้งค่าของแผนกของงาน · สิทธิ์ = หัวหน้าแผนกของงาน
-- ลำดับตรวจ: รูปแถว -> สิทธิ์ (ด่านหยาบ) -> งาน (ไม่พบ / ไม่ใช่สี่แผนก = BOM_INVALID_GR) -> สิทธิ์ของแผนกงาน -> ชนรุ่นของแผน -> สถานะใบ / งาน -> ขั้น · คืน { jobs, orders }
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
  v_dept text := private.bom_dept_of(p_actor);
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

  -- ด่านหยาบ: กลุ่มวางแผน หรือหัวหน้าของแผนกที่มีขั้นตอน (GR / PT / BG / PK)
  if not (p_planner or (coalesce(v_dept in ('GR', 'PT', 'BG', 'PK'), false) and private.bom_gr_is_head(p_actor, v_dept))) then raise exception 'BOM_FORBIDDEN'; end if;

  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
  if not found or v_job.dept not in ('GR', 'PT', 'BG', 'PK') then raise exception 'BOM_INVALID_GR'; end if;
  -- หัวหน้าตั้งขั้นตอนได้เฉพาะงานของแผนกตัวเอง
  if not (p_planner or private.bom_gr_is_head(p_actor, v_job.dept)) then raise exception 'BOM_FORBIDDEN'; end if;
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
  -- ขั้นต้องมีในตั้งค่าของแผนกของงาน · ขั้นที่ไม่ใช้แล้วคงไว้ได้เฉพาะที่อยู่ในแผนเดิม
  v_config := private.bom_dept_config_now(v_job.dept);
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
  return private.bom_gr_recompute(v_job.id, p_actor_name, v_job.dept || ' ตั้งขั้นตอนของงาน');
end;
$$;
revoke all on function private.bom_gr_save_plan(public.employees, text, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- private.bom_gr_save_record จาก 20261216010000_bom_gr_module.sql: งานของแผนก GR / PT / BG / PK · สิทธิ์ ผู้ทำ เหตุผล ตามแผนกของงาน
-- ลำดับตรวจ: รูปแถว -> สิทธิ์ (ด่านหยาบ: กลุ่มวางแผน หรือพนักงานของสี่แผนก) -> ผล / งาน (ไม่พบ = BOM_INVALID_GR) -> ชนรุ่น -> สิทธิ์ของแผนกงาน
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
  v_dept text := private.bom_dept_of(p_actor);
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
    -- เสีย 0 = ไม่เก็บเหตุผล · เสีย > 0 ต้องมีเหตุผล (ตรวจกับรายการตั้งค่าของแผนกข้างล่าง)
    v_reason := nullif(private.bom_text(v_row, 'reason', 60, 0, 'BOM_INVALID_GR'), '');
    if v_reject = 0 then v_reason := null; elsif v_reason is null then raise exception 'BOM_INVALID_GR'; end if;
    v_note := private.bom_text(v_row, 'note', 200, 0, 'BOM_INVALID_GR');
  end if;

  -- ด่านหยาบ: พนักงานของแผนกที่มีขั้นตอน (GR / PT / BG / PK) ทุกบทบาท หรือกลุ่มวางแผน (แผนกของงานตรวจหลังอ่านงาน)
  if not (p_planner or coalesce(v_dept in ('GR', 'PT', 'BG', 'PK'), false)) then raise exception 'BOM_FORBIDDEN'; end if;

  if p_action = 'addGrRecord' then
    -- id เดิม (กดซ้ำ / ส่งซ้ำ) = ไม่นับซ้ำ
    if exists (select 1 from public.bom_gr_records r where r.id = v_id::uuid) then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
    if not found or v_job.dept not in ('GR', 'PT', 'BG', 'PK') then raise exception 'BOM_INVALID_GR'; end if;
  else
    select * into v_rec from public.bom_gr_records r where r.is_test = (select private.bom_test_mode()) and r.id = v_id::uuid for update;
    if not found then raise exception 'BOM_INVALID_GR'; end if;
    if v_rec.changed_version > p_base and v_rec.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    select * into v_job from public.bom_jobs j where j.id = v_rec.job_id for update;
  end if;

  -- สิทธิ์ของแผนกงาน: พนักงานของแผนกนั้นทุกบทบาท หรือกลุ่มวางแผน · หัวหน้าแผนกนั้น / กลุ่มวางแผน = ผู้นำ (ของทุกคนทุกวัน)
  if not (p_planner or coalesce(v_dept = v_job.dept, false)) then raise exception 'BOM_FORBIDDEN'; end if;
  v_lead := p_planner or private.bom_gr_is_head(p_actor, v_job.dept);

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
  -- งานที่ฝ่ายวางแผนปิดพร้อมเหตุผล (done ทั้งที่ยอดดีต่ำกว่าแผน) = กลุ่มวางแผนเท่านั้น · งานที่ done เพราะยอดถึงแผน = กติกาปกติ (bom_gr_recompute คืนเป็นกำลังทำเมื่อยอดลดต่ำกว่าแผน)
  -- งานที่พักอยู่เพิ่มผลไม่ได้ (เหมือน reportJob) · ผลที่ยกเลิกแล้วแก้ / ยกเลิกซ้ำไม่ได้
  if v_job.status = 'done' and v_job.qty_done + 0.000000001 < v_job.qty_planned and not p_planner then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action = 'addGrRecord' and v_job.status = 'hold' then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action <> 'addGrRecord' and v_rec.status <> 'active' then raise exception 'BOM_INVALID_TRANSITION'; end if;

  if p_action <> 'voidGrRecord' then
    -- ขั้นต้องอยู่ในขั้นตอนของงาน
    select p.steps into v_steps from public.bom_gr_job_plans p where p.job_id = v_job.id;
    if v_steps is null or not exists (select 1 from jsonb_array_elements(v_steps) as s where s.value ->> 'code' = v_step) then
      raise exception 'BOM_INVALID_GR';
    end if;
    -- ผู้ทำ (ใหม่หรือเปลี่ยน) = พนักงานของแผนกของงานในโหมดเดียวกัน: ใช้งานจริง = active · บัญชีทดสอบ (persona) เป็น inactive เสมอตามข้อบังคับ employees_test_persona_inert จึงไม่ตรวจ active
    if (p_action = 'addGrRecord' or v_worker <> v_rec.worker_id) and not exists (
         select 1 from public.employees e join public.departments d on d.id = e.department_id
         where e.id = v_worker and (e.is_active or e.is_test) and e.is_test = (select private.bom_test_mode()) and d.code = v_job.dept) then
      raise exception 'BOM_INVALID_GR';
    end if;
    if v_date > v_today or v_date < date '2000-01-01' then raise exception 'BOM_INVALID_GR'; end if;
    v_config := private.bom_dept_config_now(v_job.dept);
    if v_reason is not null and not ((v_config -> 'reasons') ? v_reason) then raise exception 'BOM_INVALID_GR'; end if;
  end if;
  if p_action <> 'addGrRecord' and jsonb_array_length(v_rec.edits) >= 100 then raise exception 'BOM_INVALID_GR'; end if;

  if p_action = 'addGrRecord' then
    insert into public.bom_gr_records (id, is_test, job_id, step_code, work_date, worker_id, hours, people, good, reject, reason, note, created_by)
    values (v_id::uuid, (select private.bom_test_mode()), v_job.id, v_step, v_date, v_worker, v_hours, v_people::integer, v_good::integer, v_reject::integer,
            v_reason, v_note, p_actor.id);
    v_label := v_job.dept || ' บันทึกผล ' || v_step || ' ' || v_date_text;
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
    v_label := v_job.dept || (case when p_action = 'voidGrRecord' then ' ยกเลิกผล ' else ' แก้ไขผล ' end) || v_rec.step_code || ' ' || to_char(v_rec.work_date, 'YYYY-MM-DD');
  end if;
  return private.bom_gr_recompute(v_job.id, p_actor_name, v_label);
end;
$$;
revoke all on function private.bom_gr_save_record(public.employees, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- private.bom_gr_save_handover จาก 20261216010000_bom_gr_module.sql: แปด action ของการส่งงาน (หนึ่งแถว) · คืน 1
--   ส่ง: sendGrToPk (งาน GR · หัวหน้า GR) · sendToPk (งาน GR / PT / BG · หัวหน้าแผนกของงาน) · sendPkToWh (งาน PK ชนิด FG · หัวหน้า PK) · กลุ่มวางแผนส่งได้ทุกแบบ
--   รับ: receiveGrAtPk = receiveAtPk (แถวที่ส่งให้ PK · แผนก PK ทุกบทบาท) · ยกเลิก / ย้อนรับ: cancelGrHandover = cancelHandover (แถวที่ส่งให้ PK) · cancelPkToWh (แถวที่ส่งให้ WH)
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
  v_dept text := private.bom_dept_of(p_actor);
  -- ปลายทางของ action: ส่ง / ยกเลิกให้ WH = WH · อื่น ๆ = PK
  v_to text := (case when p_action in ('sendPkToWh', 'cancelPkToWh') then 'WH' else 'PK' end);
begin
  if p_action not in ('sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover', 'sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh') then
    raise exception 'BOM_INVALID_GR';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_GR'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_GR'; end if;
  v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_GR'));
  if v_id !~ v_uuid then raise exception 'BOM_INVALID_GR'; end if;

  if p_action in ('sendGrToPk', 'sendToPk', 'sendPkToWh') then
    v_no := private.bom_text(v_row, 'jobId', 40, 1, 'BOM_INVALID_GR');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_GR'; end if;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_GR', 0, 10000000);
    -- ส่งให้ PK = จำนวนเต็มอย่างน้อย 1 · ส่งให้ WH = มากกว่า 0 ทศนิยมไม่เกิน 4 ตำแหน่ง
    if v_qty is null or v_qty <= 0 or v_qty <> round(v_qty, 4) or (v_to = 'PK' and v_qty <> trunc(v_qty)) then raise exception 'BOM_INVALID_GR'; end if;
    v_note := private.bom_text(v_row, 'note', 200, 0, 'BOM_INVALID_GR');
    -- ส่งได้ (ด่านหยาบ ก่อนอ่านงาน): กลุ่มวางแผน · sendGrToPk = หัวหน้า GR · sendToPk = หัวหน้า GR / PT / BG · sendPkToWh = หัวหน้า PK
    if not (p_planner
            or (p_action = 'sendGrToPk' and private.bom_gr_is_head(p_actor, 'GR'))
            or (p_action = 'sendToPk' and coalesce(v_dept in ('GR', 'PT', 'BG'), false) and private.bom_gr_is_head(p_actor, v_dept))
            or (p_action = 'sendPkToWh' and private.bom_gr_is_head(p_actor, 'PK'))) then
      raise exception 'BOM_FORBIDDEN';
    end if;
    if exists (select 1 from public.bom_gr_handovers h where h.id = v_id::uuid) then raise exception 'BOM_INVALID_GR'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no for update;
    if not found
       or (p_action = 'sendGrToPk' and v_job.dept <> 'GR')
       or (p_action = 'sendToPk' and v_job.dept not in ('GR', 'PT', 'BG'))
       or (p_action = 'sendPkToWh' and (v_job.dept <> 'PK' or v_job.kind <> 'FG')) then
      raise exception 'BOM_INVALID_GR';
    end if;
    -- หัวหน้าส่งได้เฉพาะงานของแผนกตัวเอง
    if p_action = 'sendToPk' and not (p_planner or private.bom_gr_is_head(p_actor, v_job.dept)) then raise exception 'BOM_FORBIDDEN'; end if;
    select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
    -- ส่งให้ PK: ใบ released / in_progress · ส่งให้ WH: + completed (ส่วนที่ PK ผลิตเกินจำนวนสั่ง WH รับเป็นสต็อกได้หลังใบปิด)
    if v_ord.status not in ('released', 'in_progress') and not (v_to = 'WH' and v_ord.status = 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- Σ ที่ส่งแล้วของงาน (ไม่นับยกเลิก) + ครั้งนี้ ต้องไม่เกินยอดดีของงาน
    select coalesce(sum(h.qty), 0) into v_sent from public.bom_gr_handovers h where h.job_id = v_job.id and h.status <> 'cancelled';
    if v_sent + v_qty > v_job.qty_done + 0.000000001 then raise exception 'BOM_GR_EXCEEDS'; end if;
    insert into public.bom_gr_handovers (id, is_test, job_id, order_pk, item_code, qty, note, sent_by, moves, from_dept, to_dept)
    values (v_id::uuid, (select private.bom_test_mode()), v_job.id, v_ord.id, v_job.item_code, trim_scale(v_qty), v_note, p_actor.id,
            jsonb_build_array(jsonb_build_object('kind', 'send', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_note)),
            v_job.dept, v_to);
    return 1;
  end if;

  if p_action in ('cancelGrHandover', 'cancelHandover', 'cancelPkToWh') then v_why := private.bom_text(v_row, 'reason', 200, 3, 'BOM_INVALID_GR'); end if;
  select * into v_ho from public.bom_gr_handovers h where h.is_test = (select private.bom_test_mode()) and h.id = v_id::uuid for update;
  -- แถวต้องไปปลายทางเดียวกับ action (รับ / ยกเลิกของ PK ใช้กับแถวที่ส่งให้ WH ไม่ได้ และกลับกัน)
  if not found or v_ho.to_dept <> v_to then raise exception 'BOM_INVALID_GR'; end if;
  -- สิทธิ์ตามสถานะ: รับ = แผนก PK · ยกเลิกที่ยังไม่รับ = หัวหน้าแผนกผู้ส่ง · ย้อนการรับ = หัวหน้า PK · ยกเลิกการส่งให้ WH = หัวหน้า PK · กลุ่มวางแผนทำได้ทุกอย่าง
  if p_action in ('receiveGrAtPk', 'receiveAtPk') and not (p_planner or coalesce(v_dept = 'PK', false)) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action in ('cancelGrHandover', 'cancelHandover')
     and not (p_planner or private.bom_gr_is_head(p_actor, (case when v_ho.status = 'received' then 'PK' else v_ho.from_dept end))) then
    raise exception 'BOM_FORBIDDEN';
  end if;
  if p_action = 'cancelPkToWh' and not (p_planner or private.bom_gr_is_head(p_actor, 'PK')) then raise exception 'BOM_FORBIDDEN'; end if;
  if v_ho.changed_version > p_base and v_ho.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;

  if p_action = 'cancelPkToWh' then
    -- ล็อกแถวใบเหมือน private.bom_fg_move: การรับเข้าคลังพร้อมกันของใบนี้ต่อคิวกัน ยอดที่ตรวจจึงไม่ถูกแซง
    select * into v_ord from public.bom_orders o where o.id = v_ho.order_pk for update;
    if v_ord.status not in ('released', 'in_progress', 'completed') or v_ho.status <> 'sent' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- ยกเลิกได้เฉพาะส่วนที่ WH ยังไม่รับ: ที่ส่งที่เหลือ (ใบ × รหัส ไม่นับยกเลิก ไม่นับแถวนี้) ต้องไม่ต่ำกว่าที่ WH รับสุทธิแล้ว
    select coalesce(sum(h.qty), 0) into v_sent from public.bom_gr_handovers h
    where h.order_pk = v_ho.order_pk and h.item_code = v_ho.item_code and h.to_dept = 'WH' and h.status <> 'cancelled' and h.id <> v_ho.id;
    if private.bom_fg_total(v_ho.order_pk, v_ho.item_code, 'receive') > v_sent + 0.000000001 then raise exception 'BOM_FG_EXCEEDS'; end if;
    update public.bom_gr_handovers set status = 'cancelled', cancelled_by = p_actor.id, cancelled_at = clock_timestamp(), cancel_reason = v_why,
      moves = moves || jsonb_build_array(jsonb_build_object('kind', 'cancel', 'at', private.bom_ms(now()), 'by', p_actor_name, 'note', v_why))
    where id = v_ho.id;
    return 1;
  end if;

  select * into v_ord from public.bom_orders o where o.id = v_ho.order_pk;
  if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
  if p_action in ('receiveGrAtPk', 'receiveAtPk') then
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

-- 4. รายการ action ------------------------------------------------------------------------------------------------------------------
-- private.bom_client_actions() จาก 20261216010000_bom_gr_module.sql (+ ห้า action ของการส่งงานรายแผนก)
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
    'sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- private.bom_staff_actions() จาก 20261216010000_bom_gr_module.sql (+ ห้า action · สิทธิ์จริงตรวจในตัวเขียน private.bom_gr_save_handover)
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods', 'receiveRodsOpening', 'setRodLocation',
    'saveGrConfig', 'setGrJobSteps', 'addGrRecord', 'editGrRecord', 'voidGrRecord', 'requestRods', 'cancelRodRequest', 'sendGrToPk', 'receiveGrAtPk', 'cancelGrHandover',
    'sendToPk', 'receiveAtPk', 'cancelHandover', 'sendPkToWh', 'cancelPkToWh']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 5. ชุดเรคอร์ด -------------------------------------------------------------------------------------------------------------------
-- private.bom_records(bigint) จาก 20261216010000_bom_gr_module.sql
--   grConfig + dept (key = lower(dept) · GR ก่อน) · grHandovers + fromDept / toDept · grWorkers + dept และพนักงานของ PT / BG / PK (GR ก่อน)
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
    -- พนักงานของแผนกที่มีขั้นตอน GR / PT / BG / PK ในโหมดเดียวกัน (หัวหน้าเลือกผู้ทำ: ใช้งานจริง = active · บัญชีทดสอบ inactive เสมอจึงไม่ตรวจ) + dept (20261224010000 · GR ก่อน)
    -- เฉพาะ snapshot (p_since < 0) · ส่วนต่างเป็น [] เสมอ (ตารางพนักงานไม่มีเลขรุ่น)
    'grWorkers', case when p_since >= 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id::text, 'name', e.first_name || ' ' || e.last_name, 'dept', d.code)
                       order by (d.code <> 'GR'), d.code collate "C", e.first_name, e.last_name, e.id)
      from public.employees e join public.departments d on d.id = e.department_id
      where d.code in ('GR', 'PT', 'BG', 'PK') and (e.is_active or e.is_test) and e.is_test = (select private.bom_test_mode())), '[]'::jsonb) end)
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- 6. รับสินค้าสำเร็จรูปเข้าคลังได้ไม่เกินที่ PK ส่งให้ WH --------------------------------------------------------------------------------
-- Σ ที่ PK ส่งให้ WH ของใบ × สินค้า (ไม่นับยกเลิก) · แบบเดียวกับ private.bom_fg_pk_done
create or replace function private.bom_fg_pk_sent(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(h.qty), 0)
  from public.bom_gr_handovers h
  where h.is_test = (select private.bom_test_mode()) and h.order_pk = p_order_pk and h.item_code = p_code and h.to_dept = 'WH' and h.status <> 'cancelled'
$$;
revoke all on function private.bom_fg_pk_sent(uuid, text) from public, anon, authenticated;

-- private.bom_fg_move(public.employees, text, jsonb) จาก 20261130010000_bom_rf_go_live.sql: เพดานรับ = min(ยอดที่ PK ทำ, Σ ที่ PK ส่งให้ WH) · อย่างอื่นเหมือนเดิม
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
  v_prod_done boolean;
begin
  -- รูปแถว (ก่อนสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_FG'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
  v_expected := case p_action when 'receiveFg' then 'receive' when 'deliverFg' then 'deliver' when 'closeOrderShort' then 'close' when 'closeOrder' then 'close' end;
  v_kind := private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_FG');
  if v_expected is null or v_kind <> v_expected then raise exception 'BOM_INVALID_FG'; end if;
  v_pi := upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_FG'));
  v_node := v_row -> 'lines';
  if v_kind = 'close' then
    if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
      raise exception 'BOM_INVALID_FG';
    end if;
    if p_action = 'closeOrder' then
      -- ปิดใบเมื่อรับครบ (20261125010000): client ไม่ส่งเหตุผล (note ว่างหรือไม่ส่ง) · แถว close ใช้ข้อความคงที่ของเซิร์ฟเวอร์ (ตาราง: close ต้องมี note 3-300)
      perform private.bom_text(v_row, 'note', 0, 0, 'BOM_INVALID_FG');
      v_note := 'รับครบ ปิดใบโดยคลังสินค้า';
    else
      v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_FG');
    end if;
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
  select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_FG'; end if;
  for i in 1 .. cardinality(v_codes) loop
    if not exists (select 1 from jsonb_array_elements(v_ord.items) it where it ->> 'fgCode' = v_codes[i]) then raise exception 'BOM_INVALID_FG'; end if;
  end loop;
  -- งานผลิตของใบเสร็จครบหรือยัง (20261125010000): ทุกงานยกเว้นการเบิกของซื้อ (แผนก ST ชนิด PURCHASED) ต้อง done · ใบที่ไม่มีงานผลิตเลยถือว่าครบ
  -- อ่านหลังล็อกแถวใบ · งานไม่เปลี่ยนในคำสั่งของสำเร็จรูป (สี่การกระทำนี้ส่งได้เฉพาะส่วน fgMoves)
  v_prod_done := not exists (select 1 from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.status <> 'done' and not (j.dept = 'ST' and j.kind = 'PURCHASED'));

  if v_kind = 'receive' then
    -- รับได้ทั้งหลังปิดใบ (completed): ส่วนที่ PK ผลิตเกินจำนวนสั่งกลายเป็นสต็อกสินค้าสำเร็จรูป (20261123010000)
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- รับสะสมของใบเอง (own) ของสินค้าหนึ่งเกินที่ PK รายงานแล้ว (qty_done ของงาน PK) ไม่ได้ · ไม่มีงาน PK = 0
    -- 20261224010000: และเกินที่ PK ส่งให้ WH แล้ว (sendPkToWh ไม่นับยกเลิก) ไม่ได้ · เพดาน = ค่าน้อยกว่าของสองยอด
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'receive') + v_qtys[i]
         > least(private.bom_fg_pk_done(v_ord.id, v_codes[i]), private.bom_fg_pk_sent(v_ord.id, v_codes[i])) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  elsif v_kind = 'deliver' then
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- ส่งมอบสะสมของสินค้าหนึ่งเกินที่ใบนี้มี (have = own + in) หักที่ใบอื่นหยิบไป (out) ไม่ได้
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'deliver') + v_qtys[i]
         > private.bom_fg_have(v_ord.id, v_codes[i]) - private.bom_fg_out(v_ord.id, v_codes[i]) then
        raise exception 'BOM_FG_EXCEEDS';
      end if;
    end loop;
  elsif p_action = 'closeOrder' then
    -- ปิดใบ (รับครบ) โดย WH / admin (20261125010000): ใบยังเปิด · ทุกงานผลิตเสร็จ · ทุกสินค้ามีของครบ (have >= ที่สั่ง) · ไม่ตรง = BOM_INVALID_TRANSITION
    -- (ใช้เมื่อรับครบไปแล้วตอนที่ยังมีงานผลิตเปิดอยู่ ใบจึงไม่ได้ปิดเองตอนรับ)
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if not v_prod_done then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if jsonb_array_length(v_ord.items) = 0 or exists (
         select 1 from jsonb_array_elements(v_ord.items) it
         where private.bom_fg_have(v_ord.id, it ->> 'fgCode') < (it ->> 'qty')::numeric) then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
  else
    -- ปิดใบรับไม่ครบ: ใบยังเปิดอยู่ ทุกงาน PK เสร็จแล้ว ทุกสินค้ารับเข้าคลังเท่าที่ PK ทำได้ครบ (own) และอย่างน้อยหนึ่งสินค้า have น้อยกว่าที่สั่ง (ไม่เช่นนั้น BOM_INVALID_TRANSITION)
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if exists (select 1 from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'PK' and j.status <> 'done') then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    -- ทุกงานผลิตของทุกแผนก (ไม่ใช่แค่ PK) ต้องเสร็จก่อน (20261125010000)
    if not v_prod_done then raise exception 'BOM_INVALID_TRANSITION'; end if;
    for v_item in select value from jsonb_array_elements(v_ord.items) loop
      v_code := v_item ->> 'fgCode';
      v_received := private.bom_fg_total(v_ord.id, v_code, 'receive');
      if v_received <> private.bom_fg_pk_done(v_ord.id, v_code) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if private.bom_fg_have(v_ord.id, v_code) < (v_item ->> 'qty')::numeric then v_short := true; end if;
    end loop;
    if not v_short then raise exception 'BOM_INVALID_TRANSITION'; end if;
  end if;

  -- เขียนประวัติ: หนึ่งแถวต่อบรรทัด (close: หนึ่งแถว รหัสว่าง qty 0 เหตุผลอยู่ใน note)
  if v_kind = 'close' then
    insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
    values ((select private.bom_test_mode()), v_ord.id, '', 'close', 0, v_note, p_actor.id);
    v_n := 1;
    v_close := true;
  else
    for i in 1 .. cardinality(v_codes) loop
      insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by)
      values ((select private.bom_test_mode()), v_ord.id, v_codes[i], v_kind, v_qtys[i], v_note, p_actor.id);
      v_n := v_n + 1;
    end loop;
    -- ใบที่ยังไม่ปิด: ทุกสินค้ามีครบ (have >= ที่สั่ง) และทุกงานผลิตเสร็จแล้ว = ปิดใบอัตโนมัติ · ใบที่ completed แล้วรับเพิ่มไม่เปลี่ยนใบ
    -- ยังมีงานผลิตเปิดอยู่ (20261125010000) = ใบเปิดต่อ ปิดได้เมื่อทุกงานผลิตเสร็จด้วย closeOrder (WH / admin)
    if v_kind = 'receive' and v_ord.status <> 'completed' and v_prod_done and jsonb_array_length(v_ord.items) > 0 and not exists (
         select 1 from jsonb_array_elements(v_ord.items) it
         where private.bom_fg_have(v_ord.id, it ->> 'fgCode') < (it ->> 'qty')::numeric) then
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

-- 7. ยอดที่ WH รับเข้าก่อนมีการส่ง PK → WH: เติมแถวส่ง (sent) เท่ายอดรับสุทธิ ----------------------------------------------------------------
-- ทำไม: ใบที่ WH รับเข้าแล้วก่อนไฟล์นี้ไม่มีแถวส่งให้ WH · เพดานใหม่ (ข้อ 6) = min(ยอด PK, Σ ที่ส่ง) จึงต้องนับที่รับไปแล้วเป็นที่ส่งแล้ว
--   ไม่งั้นการ์ด PK แสดง "ยังไม่ได้ส่ง WH" เท่ายอดที่ WH รับไปแล้ว ส่งแล้ว WH ก็รับเพิ่มไม่ได้ และ closeOrderShort ติด
--   หลังเติม: ทุกใบ × สินค้า Σ ที่ส่ง (ไม่นับยกเลิก) >= ที่ WH รับสุทธิ (pgTAP bom_dept_steps ตรวจ) · client นับที่ยังไม่ได้ส่งจากแถวส่งอย่างเดียว เหมือนฐานข้อมูล
-- ยอดรับสุทธิต่อโหมด × ใบ × สินค้า = Σ receive − Σ unreceive (แบบ private.bom_fg_total · ทั้งสองโหมด is_test ไม่ผ่าน bom_test_mode())
--   กระจายลงงาน PK / FG ของใบ × สินค้า ตามลำดับงาน (created_at, job_no) งานละไม่เกินยอดดีของงาน (qty_done: เพดาน Σ ที่ส่งของ private.bom_gr_recompute)
--   ปัดขึ้นทศนิยม 4 ตำแหน่ง (constraint ของแถว) ถ้าไม่เกินยอดดี ไม่งั้นปัดลง · ส่วนที่เกินยอดดีของทุกงาน (ไม่ควรมี: เพดานรับเดิม = ยอด PK) ไม่มีงานให้ผูก จึงไม่เติม
-- แถวที่เติม: note = 'ยอดรับก่อนมีการส่ง' · sent_by / sent_at = ผู้รับและเวลาของการรับครั้งแรก (sent_by เป็น null ได้: on delete set null) · moves = หนึ่งแถว send ชื่อผู้รับ (ไม่มี = 'ระบบ')
--   trigger ของตาราง: sandbox_row_scope ไม่ทับ is_test ตอนไม่มี auth.uid() (migration) · bom_stamp_version ประทับเวอร์ชันถัดไป client จึงได้แถวใน delta รอบหน้า
--   ไม่มีแถวส่งให้ WH ก่อนข้อนี้ (คอลัมน์ to_dept เพิ่งเพิ่ม) จึงไม่ต้องหักที่ส่งอยู่แล้ว · rollback ข้อ 3 (from_dept <> 'GR') ลบแถวเหล่านี้ไปด้วย
with recv as (
  select m.is_test, m.order_pk, m.fg_code,
         sum(case when m.kind = 'receive' then m.qty else -m.qty end) as qty,
         min(m.created_at) filter (where m.kind = 'receive') as first_at,
         (array_agg(m.created_by order by m.created_at, m.id) filter (where m.kind = 'receive'))[1] as first_by
  from public.bom_fg_moves m
  where m.kind in ('receive', 'unreceive')
  group by m.is_test, m.order_pk, m.fg_code
), jobs as (
  select r.is_test, r.order_pk, r.fg_code, r.qty as received, r.first_at, r.first_by, j.id as job_id, j.qty_done,
         coalesce(sum(j.qty_done) over (partition by r.is_test, r.order_pk, r.fg_code order by j.created_at, j.job_no
                                        rows between unbounded preceding and 1 preceding), 0) as before
  from recv r
  join public.bom_jobs j on j.is_test = r.is_test and j.order_pk = r.order_pk and j.dept = 'PK' and j.kind = 'FG' and j.item_code = r.fg_code and j.qty_done > 0
  where r.qty > 0
), alloc as (
  select a.*, least(a.qty_done, a.received - a.before) as raw
  from jobs a
  where a.received - a.before > 0
)
insert into public.bom_gr_handovers (is_test, job_id, order_pk, item_code, qty, note, sent_by, sent_at, moves, from_dept, to_dept)
select a.is_test, a.job_id, a.order_pk, a.fg_code, trim_scale(q.qty), 'ยอดรับก่อนมีการส่ง', a.first_by, a.first_at,
       jsonb_build_array(jsonb_build_object('kind', 'send', 'at', private.bom_ms(a.first_at), 'by', coalesce(private.bom_person(a.first_by), 'ระบบ'),
                                            'note', 'ยอดรับก่อนมีการส่ง')),
       'PK', 'WH'
from alloc a
cross join lateral (select case when ceil(a.raw * 10000) / 10000 <= a.qty_done then ceil(a.raw * 10000) / 10000 else floor(a.raw * 10000) / 10000 end as qty) q
where q.qty > 0;
