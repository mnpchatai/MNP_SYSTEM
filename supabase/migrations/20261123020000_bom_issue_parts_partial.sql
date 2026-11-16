-- ============================================================================
-- BOM โหมดทดสอบ: ST เบิกจ่ายของซื้อของใบ PI เลือกรายการและจำนวนได้ (เบิกบางรายการ เบิกไม่ครบแล้วเบิกส่วนที่เหลือทีหลัง เบิกเกินได้ไม่เกินสต็อก)
--
-- ทำไม (ผู้ใช้ตัดสิน 2026-11-16): เดิมกด "เบิกจ่าย" ครั้งเดียวต่อใบ ทุกงานของซื้อจ่ายเต็มส่วนที่เหลือ ฐานข้อมูลปฏิเสธอย่างอื่นทั้งหมด
--   1) หน้าต่างเบิกจ่ายมีช่องเลือกรายละบรรทัด คลังวัตถุดิบ (ST) เลือกเองว่าจะเบิกรายการไหนครั้งนี้
--   2) จำนวนที่เบิกแก้ได้รายบรรทัด ค่าเริ่ม = ส่วนที่ยังต้องเบิก (แผน - เบิกไปแล้ว)
--   3) เบิกน้อยกว่าที่ต้องการ = บรรทัดยังเปิด เบิกส่วนที่เหลือครั้งหน้าได้ · บรรทัดที่ไม่ได้เลือกก็ยังเปิด
--   4) เบิกเกินได้ ไม่เกินยอดคงเหลือในสต็อก
--   5) หักสต็อกตามที่เบิกจริงในคำสั่งเดียวกัน เขียนประวัติ 'issue' หนึ่งรายการต่อบรรทัด (เหมือนเดิม)
--   6) ใบปิด (completed) ระหว่างที่บรรทัดยังเบิกไม่ครบ: เบิกส่วนที่เหลือและยกเลิกการเบิกจ่ายทำไม่ได้แล้ว จึงคืนของเหลือของบรรทัดนั้นได้ (กติกาเดิม
--      "คืนของเหลือได้จนกว่าใบจะถูกยกเลิก รวมใบที่ปิดแล้ว") · ใบที่ยังเปิดอยู่ บรรทัดที่เบิกไม่ครบคืนของเหลือไม่ได้ (เบิกส่วนที่เหลือ หรือยกเลิกการเบิกจ่าย)
--   ไม่เปลี่ยน: ผู้เบิก (แผนก ST หรือกลุ่มวางแผน) · ใบต้อง released / in_progress · ทั้งคำสั่งผ่านหรือไม่ผ่านพร้อมกัน · action issueOrderParts ส่วน jobs.upsert
--
-- สัญญาของแถว (action issueOrderParts, payload { jobs: { upsert } } เท่านั้นเหมือนเดิม)
--   แต่ละแถว = งานของซื้อ (dept ST, kind PURCHASED) ที่ยังไม่ done ของใบเดียวกันทุกแถว อย่างน้อยหนึ่งแถว ไม่ต้องครบทุกงานที่เปิดอยู่ของใบ
--   qtyDone = ยอดเบิกสะสมใหม่ (> qty_done ที่เก็บ ทศนิยมไม่เกิน 4 ตำแหน่ง เว้นแต่เท่าแผนพอดี) · qtyPlanned = เท่าที่เก็บ · status = 'done' เมื่อยอดสะสมใหม่ >= แผน ไม่เช่นนั้น 'in_progress'
--   เซิร์ฟเวอร์คิดยอดที่เบิกครั้งนี้ = ยอดสะสมใหม่ - ที่เก็บ · ไม่เป็นบวก สถานะผิด แผนต่าง งานซ้ำ งานของใบอื่น งานที่ไม่ใช่ของซื้อ/เสร็จแล้ว = BOM_INVALID_JOB
--   ยอดที่เบิกเกินสต็อกของรายการใด = ไม่เขียนอะไรเลย BOM_INSUFFICIENT_STOCK (หรือ BOM_STALE ถ้าแถวสต็อกของรายการเหล่านั้นเปลี่ยนหลังเวอร์ชันฐาน เหมือนเดิม)
--   ผ่านแล้ว: หักสต็อก เขียน 'issue' (qty = -ยอดครั้งนี้, ref = เลข PI) ตั้ง qty_done = ยอดสะสมใหม่ สถานะตามข้างบน done_at = เวลาเซิร์ฟเวอร์เมื่อ done (null เมื่อยังไม่ครบ)
--   Pilot รุ่นก่อน (ส่งทุกงานที่เปิดอยู่ด้วย qtyDone = qtyPlanned และ done) ยังเป็นแถวที่ถูกต้องตามสัญญานี้ จึงทำงานต่อได้ (งานที่เบิกบางส่วนแล้วได้ส่วนที่เหลือ)
--
-- ฟังก์ชันอื่นที่ต้องดูให้ครบ (ไม่ได้แก้ เหตุผลตามนี้)
--   - private.bom_save_jobs (ล่าสุด 20261122010000_bom_fg_guards.sql): ภายใต้ issueOrderParts แถวของงานของซื้อที่ช่องผลงานเปลี่ยน ตรวจชน / ช่องโครงสร้าง (รวม qtyPlanned) / ใบเดิม /
--     สถานะใบ แล้วข้ามให้ bom_issue_parts เขียน · ไม่มีด่านที่เทียบ qty_done กับ qty_planned หรือห้าม in_progress จึงรับงานที่เบิกบางส่วน (in_progress, qty_done > 0)
--     และงานที่เบิกเกิน (qty_done > qty_planned) ได้ · แถวที่ช่องผลงานไม่เปลี่ยนถูกข้าม แล้ว bom_issue_parts ปฏิเสธเพราะยอดครั้งนี้ไม่เป็นบวก
--     ทางอื่น (reportJob / setJobStatus / ฯลฯ) ยังแก้ช่องผลงานของงานของซื้อไม่ได้ (BOM_INVALID_TRANSITION) เหมือนเดิม
--   - public.app_bom_save_master (ล่าสุด 20261123010000_bom_fg_stock.sql): กติกา payload ของ issueOrderParts (jobs.upsert เท่านั้น) และการนับ audit (stock = จำนวนแถวที่เบิก) ใช้ได้ตามเดิม
--   - private.bom_save_orders (ล่าสุด 20261123010000_bom_fg_stock.sql): ยกเลิกใบที่มีงาน qty_done > 0 ไม่ได้ (BOM_INVALID_TRANSITION) งานของซื้อที่เบิกบางส่วนจึงกันการยกเลิก
--     เหมือนงานที่เบิกครบ · ต้อง "ยกเลิกการเบิกจ่าย" (undoOrderParts) ก่อน แล้วจึงยกเลิกใบได้ (ปุ่มยกเลิกใบของ Pilot ใช้กติกาเดียวกันใน cancelOrder)
--   - private.bom_started_jobs (ล่าสุด 20261108020000): งาน in_progress นับว่าเริ่มแล้ว เปิดใบกลับมาแก้ไม่ได้ (BOM_INVALID_TRANSITION) จนกว่าจะยกเลิกการเบิกจ่ายเหมือนงานที่เบิกครบ
--   - private.bom_fg_move (ล่าสุด 20261123010000_bom_fg_stock.sql): รับสินค้าเข้าคลังครบ / closeOrderShort ปิดใบได้โดยไม่ดูงานของซื้อ ใบจึงปิดได้ขณะบรรทัดของซื้อยังเบิกไม่ครบ
--     (ข้อ 6 ด้านบนคือทางคืนของที่เบิกไปแล้วของบรรทัดนั้น)
--   - private.bom_part_returned (20261112010000): ยอดที่คืนไปแล้ว = ผลรวม 'return' ของ (เลข PI, รายการ) หลัง 'issue' ล่าสุดของคู่นั้น ยังถูกสำหรับทุกบรรทัดรวมบรรทัดที่เบิกไม่ครบ
--     เพราะหนึ่งรายการมีงานเดียวต่อใบ (unique (order_pk, dept, item_code)) และไม่มี 'return' ใดแทรกระหว่างการเบิกสองครั้งของรอบเดียวกัน:
--     · คืนของเหลือของบรรทัดที่เบิกไม่ครบทำได้เฉพาะใบ completed และใบ completed เบิกเพิ่มไม่ได้ (bom_issue_parts ต้อง released / in_progress, ใบที่ปิดแล้วเปลี่ยนสถานะไม่ได้)
--       จึงไม่มี 'issue' หลัง 'return' ของเหลือของบรรทัดนั้น · บรรทัดที่ done เบิกเพิ่มไม่ได้ (เหมือนเดิม)
--     · ยกเลิกการเบิกจ่ายตั้ง qty_done = 0 ('return' ของรอบก่อนอยู่ก่อน 'issue' ของรอบใหม่ จึงไม่ถูกนับกับรอบใหม่ เหมือนเดิม)
--     ผลคือเพดานคืนของเหลือของบรรทัดที่เบิกไม่ครบในใบที่ปิดแล้ว = qty_done (ยอดที่เบิกไปจริงทุกครั้งของรอบนี้) - ที่คืนไปแล้ว เหมือนบรรทัดที่ done
--     (created_at ของประวัติเป็น clock_timestamp() จึงเรียงตามลำดับเขียนแม้อยู่ในธุรกรรมเดียวกัน)
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม security definer + set search_path = '' + revoke all from public, anon, authenticated เหมือนต้นทาง)
--   1) private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint) จาก 20261111010000_bom_part_stock.sql (ยังเป็นนิยามล่าสุด) ต่างจากต้นทาง:
--      - แถว: เดิมต้อง status 'done' และ qtyDone = qty_planned → ใหม่ qtyDone (ตัวเลข 0..1e9 ต้องมี) > qty_done ที่เก็บ,
--        ทศนิยมไม่เกิน 4 ตำแหน่ง (qtyDone <> round(qtyDone, 4) และ <> qty_planned = BOM_INVALID_JOB), qtyPlanned = qty_planned (เหมือนเดิม),
--        status = 'done' ถ้า qtyDone >= qty_planned ไม่เช่นนั้น 'in_progress' · ยอดสะสมใหม่ของแต่ละงานเก็บไว้ใน v_want (กุญแจ = id ของงาน)
--      - ตัดด่าน "ต้องครบทุกงานของซื้อที่ยังไม่ done ของใบ" ออก (ยังต้องเป็นใบเดียว ไม่ซ้ำ อย่างน้อยหนึ่งแถว)
--      - ตรวจสต็อกด้วยยอดครั้งนี้ (ยอดสะสมใหม่ - qty_done) แทนส่วนที่เหลือ (qty_planned - qty_done)
--      - เขียน: หักสต็อกและเขียน 'issue' ด้วยยอดครั้งนี้ (เป็นบวกเสมอ จึงไม่มีสาขา "ส่วนที่เหลือ = 0") · งาน: qty_done = ยอดสะสมใหม่ สถานะ done / in_progress
--        done_at = coalesce(done_at, now()) เมื่อ done ไม่เช่นนั้น null (เดิมตั้ง done ทุกงาน qty_done = qty_planned)
--      - ลำดับตรวจคงเดิม: สิทธิ์ (BOM_FORBIDDEN) → รูปแถว/งาน (BOM_INVALID_JOB) → สถานะใบ (BOM_INVALID_TRANSITION) → สต็อก (BOM_STALE / BOM_INSUFFICIENT_STOCK) · คืนจำนวนงานที่เบิกเหมือนเดิม
--   2) private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint) จาก 20261112010000_bom_part_returns.sql (ยังเป็นนิยามล่าสุด) ต่างจากต้นทาง:
--      - ยกเลิกการเบิกจ่าย (mode 'undo'): งานที่นับว่าเบิกแล้ว = งานของซื้อของใบที่ status 'done' หรือ qty_done > 0 (เดิม status 'done' อย่างเดียว) ทั้งสามจุด
--        (หารายการ, รวมยอดที่เบิกของรายการ, ตั้งงานกลับเป็น queued / 0 / done_at null) จึงคืนยอดที่เบิกบางส่วนและยกเลิกงานที่ยังเบิกไม่ครบได้
--        ยอดที่คืน = ผลรวม qty_done - ยอดที่คืนไปแล้ว (private.bom_part_returned) เหมือนเดิม จึงคืนครบทั้งยอดที่เบิกเกิน
--      - คืนของเหลือ (mode 'leftover'): งานที่นับ = status 'done' หรือ (ใบ completed และ qty_done > 0) (เดิม status 'done' อย่างเดียว) หนึ่งจุด (รวมยอดที่เบิกของรายการ)
--        เพดาน = qty_done - ที่คืนไปแล้ว เหมือนเดิม (รวมยอดที่เบิกเกินแผน) · ใบ released / in_progress: บรรทัดที่ยังเบิกไม่ครบ = BOM_INVALID_RETURN (ไม่นับ)
--        ใบที่ปิดแล้ว: บรรทัดที่ไม่เคยเบิก (qty_done = 0) ยังเป็น BOM_INVALID_RETURN
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ส่งแถวที่เบิกบางรายการ / บางส่วน / เกินแผน ซึ่งฐานข้อมูลก่อนไฟล์นี้ปฏิเสธด้วย BOM_INVALID_JOB
--   จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md
--   Pilot ใหม่ + ฐานข้อมูลเก่า: เบิกทุกบรรทัดเต็มส่วนที่เหลือยังผ่าน · เลือกไม่ครบ แก้จำนวน หรือเบิกเกิน = BOM_INVALID_JOB (ไม่เขียนอะไร)
--     · คืนของเหลือของบรรทัดที่เบิกไม่ครบในใบที่ปิดแล้ว = BOM_INVALID_RETURN (ไม่เขียนอะไร)
--   Pilot เก่า + ฐานข้อมูลใหม่: ทำงานได้ (แถวของ Pilot เก่าเป็นกรณีหนึ่งของสัญญาใหม่)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสองฟังก์ชันที่ production กับนิยามในไฟล์ต้นทางที่ระบุข้างบน (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด)
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (private.* เรียกจาก anon / authenticated ไม่ได้)
--
-- Rollback: create or replace สองฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke ท้ายฟังก์ชัน) ไม่มีตารางที่ต้องย้อน
--   ข้อมูลทดสอบที่เกิดหลังไฟล์นี้: งานของซื้อที่เบิกบางส่วน (in_progress, qty_done > 0) undo และคืนของเหลือของนิยามเดิมไม่เห็น (คืนของไม่ได้ งานไม่กลับไปรอเบิก)
--   ก่อน rollback ให้ "ยกเลิกการเบิกจ่าย" ใบที่มีงานเบิกบางส่วน หรือล้างข้อมูลทดสอบด้วย app_sandbox_purge_bom · งานที่เบิกเกิน (done, qty_done > qty_planned) ใช้กับนิยามเดิมได้
-- ============================================================================

-- 1. เบิกจ่ายของซื้อ: เลือกงานและยอดสะสมใหม่ต่องาน (นิยามจาก 20261111010000_bom_part_stock.sql) ------------------------------
-- เรียกหลัง private.bom_save_jobs ซึ่งตรวจชนรายระเบียนของงานแล้วและข้ามแถวผลงานของงานของซื้อให้ฟังก์ชันนี้เขียนเอง
-- ผู้เรียกต้องเป็นกลุ่มวางแผนหรือแผนก ST · แถวเป็นงาน PURCHASED / ST ที่ยังไม่ done ของใบเดียว (อย่างน้อยหนึ่งงาน ไม่ต้องครบ)
-- แต่ละแถว qtyDone = ยอดสะสมใหม่ (> ที่เก็บ ทศนิยมไม่เกิน 4 ตำแหน่งหรือเท่าแผน) qtyPlanned = ที่เก็บ status = done เมื่อยอดสะสมใหม่ >= แผน ไม่เช่นนั้น in_progress
-- ใบต้อง released / in_progress · ทุกงานต้องมีสต็อกพอสำหรับยอดครั้งนี้ ไม่เช่นนั้นไม่เขียนอะไร (BOM_INSUFFICIENT_STOCK หรือ BOM_STALE ถ้าแถวสต็อกเปลี่ยนหลังเวอร์ชันฐาน)
-- ผ่านแล้ว: หักสต็อก เขียน 'issue' (ref = เลข PI) ตั้งยอดและสถานะของงานในธุรกรรมเดียว · คืนจำนวนงานที่เบิก
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
  v_want jsonb := '{}'::jsonb;
  v_total numeric;
  v_amount numeric;
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
    -- ยอดสะสมใหม่ต้องมากกว่าที่เก็บ (ยอดครั้งนี้เป็นบวก) · แผนต้องเท่าที่เก็บ · สถานะต้องตรงกับยอดสะสมใหม่เทียบแผน
    -- ทศนิยมเกิน 4 ตำแหน่ง (ความละเอียดของ Pilot) = ปฏิเสธ เว้นแต่เท่าแผนพอดี (Pilot รุ่นก่อนส่งแผนตามที่เก็บ)
    v_total := private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_total is null or v_total <= v_job.qty_done
       or (v_total <> round(v_total, 4) and v_total <> v_job.qty_planned)
       or private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000) is distinct from v_job.qty_planned
       or private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB')
          <> (case when v_total >= v_job.qty_planned then 'done' else 'in_progress' end) then
      raise exception 'BOM_INVALID_JOB';
    end if;
    v_jobs := v_jobs || v_job.id;
    v_want := v_want || jsonb_build_object(v_job.id::text, v_total);
  end loop;

  select * into v_ord from public.bom_orders o where o.id = v_order for update;
  if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;

  -- สต็อกพอสำหรับยอดครั้งนี้ทุกงานหรือไม่จ่ายอะไรเลย (ล็อกแถวสต็อกเรียงตามรหัส · หนึ่งงานต่อรายการต่อใบ จึงเทียบรายงานได้)
  for v_job in select * from public.bom_jobs j where j.id = any (v_jobs) order by j.item_code collate "C" loop
    perform 1 from public.bom_stock s where s.is_test and s.item_code = v_job.item_code for update;
    v_amount := (v_want ->> v_job.id::text)::numeric - v_job.qty_done;
    v_stock := coalesce((select s.qty from public.bom_stock s where s.is_test and s.item_code = v_job.item_code), 0);
    if v_amount > v_stock then v_short := true; end if;
  end loop;
  if v_short then
    if exists (select 1 from public.bom_stock s join public.bom_jobs j on j.item_code = s.item_code
               where j.id = any (v_jobs) and s.is_test and s.changed_version > p_base and s.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    raise exception 'BOM_INSUFFICIENT_STOCK';
  end if;

  for v_job in select * from public.bom_jobs j where j.id = any (v_jobs) order by j.item_code collate "C" loop
    v_total := (v_want ->> v_job.id::text)::numeric;
    v_amount := v_total - v_job.qty_done;
    v_stock := (select s.qty from public.bom_stock s where s.is_test and s.item_code = v_job.item_code);
    update public.bom_stock set qty = v_stock - v_amount, updated_at = now() where is_test and item_code = v_job.item_code;
    insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
    values (true, v_job.item_code, 'issue', -v_amount, v_stock - v_amount, v_ord.pi_no, p_actor.id);
    update public.bom_jobs set
      status = case when v_total >= qty_planned then 'done' else 'in_progress' end,
      qty_done = v_total,
      done_at = case when v_total >= qty_planned then coalesce(done_at, now()) else null end,
      updated_at = now()
    where id = v_job.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 2. คืนของซื้อ: ยกเลิกการเบิกจ่ายนับงานที่เบิกบางส่วนด้วย · คืนของเหลือนับงานที่เบิกบางส่วนเมื่อใบปิดแล้ว
--    (นิยามจาก 20261112010000_bom_part_returns.sql เปลี่ยนเงื่อนไขงานที่เบิกแล้วของ mode undo สามจุด และของ mode leftover หนึ่งจุด) -------------
create or replace function private.bom_return_parts(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept text := private.bom_dept_of(p_actor);
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_mode text;
  v_reason text;
  v_ord public.bom_orders%rowtype;
  v_codes text[] := '{}';
  v_want jsonb := '{}'::jsonb;
  v_code text;
  v_qty numeric;
  v_issued numeric;
  v_left numeric;
  v_n integer := 0;
begin
  -- รูปแถว (ก่อนชนและสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_RETURN'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_RETURN'; end if;
  v_mode := private.bom_text(v_row, 'mode', 10, 1, 'BOM_INVALID_RETURN');
  if v_mode not in ('undo', 'leftover') then raise exception 'BOM_INVALID_RETURN'; end if;
  v_reason := private.bom_text(v_row, 'reason', 200, 1, 'BOM_INVALID_RETURN');
  v_node := v_row -> 'lines';
  if v_mode = 'undo' then
    if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
      raise exception 'BOM_INVALID_RETURN';
    end if;
  else
    if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) not between 1 and 100 then raise exception 'BOM_INVALID_RETURN'; end if;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'object' then raise exception 'BOM_INVALID_RETURN'; end if;
      v_code := private.bom_code(private.bom_text(v_el, 'itemCode', 60, 1, 'BOM_INVALID_RETURN'));
      if v_code = any (v_codes) then raise exception 'BOM_INVALID_RETURN'; end if;
      v_qty := private.bom_num(v_el -> 'qty', 'BOM_INVALID_RETURN', 0, 1000000000);
      if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_RETURN'; end if;
      v_codes := v_codes || v_code;
      v_want := v_want || jsonb_build_object(v_code, v_qty);
    end loop;
  end if;
  select * into v_ord from public.bom_orders o
  where o.is_test and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_RETURN')) for update;
  if not found then raise exception 'BOM_INVALID_RETURN'; end if;

  -- ชนรายระเบียนก่อนสิทธิ์: งานของซื้อของใบหรือแถวสต็อกของรายการเหล่านั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า (ยอดที่คืนได้อาจเปลี่ยนไปแล้ว)
  if exists (select 1 from public.bom_jobs j
             where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.changed_version > p_base and j.changed_version <= p_cur)
     or exists (select 1 from public.bom_stock s
                where s.is_test and s.changed_version > p_base and s.changed_version <= p_cur
                  and s.item_code in (select j.item_code from public.bom_jobs j where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED')) then
    raise exception 'BOM_STALE';
  end if;
  if not (p_planner or coalesce(v_dept = 'ST', false)) then raise exception 'BOM_FORBIDDEN'; end if;

  if v_mode = 'undo' then
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- งานที่เบิกแล้ว = done หรือเบิกไปบางส่วน (qty_done > 0)
    select coalesce(array_agg(distinct j.item_code), '{}') into v_codes
    from public.bom_jobs j
    where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and (j.status = 'done' or j.qty_done > 0);
    if cardinality(v_codes) = 0 then raise exception 'BOM_INVALID_RETURN'; end if;
    perform 1 from public.bom_stock s where s.is_test and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and (j.status = 'done' or j.qty_done > 0) and j.item_code = v_code;
      v_left := v_issued - private.bom_part_returned(v_ord.pi_no, v_code);
      if v_left > 0 then
        perform private.bom_stock_add_return(p_actor.id, v_code, v_left, v_ord.pi_no, v_reason);
        v_n := v_n + 1;
      end if;
    end loop;
    -- งานกลับไปรอเบิกจ่าย (ใบไม่เปลี่ยนสถานะ) · ไม่มีงานเริ่มจึงยกเลิก/เปิดใบกลับมาแก้ได้ตามกติกาเดิม
    update public.bom_jobs set status = 'queued', qty_done = 0, done_at = null, updated_at = now()
    where is_test and order_pk = v_ord.id and dept = 'ST' and kind = 'PURCHASED' and (status = 'done' or qty_done > 0);
  else
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    perform 1 from public.bom_stock s where s.is_test and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      -- งานที่คืนของเหลือได้ = done · หรือเบิกไปบางส่วนเมื่อใบปิดแล้ว (completed: เบิกส่วนที่เหลือและยกเลิกการเบิกจ่ายทำไม่ได้แล้ว)
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.item_code = v_code
        and (j.status = 'done' or (v_ord.status = 'completed' and j.qty_done > 0));
      if v_issued is null then raise exception 'BOM_INVALID_RETURN'; end if;
      v_qty := (v_want ->> v_code)::numeric;
      v_left := v_issued - private.bom_part_returned(v_ord.pi_no, v_code);
      if v_qty > v_left then raise exception 'BOM_INVALID_RETURN'; end if;
      perform private.bom_stock_add_return(p_actor.id, v_code, v_qty, v_ord.pi_no, v_reason);
      v_n := v_n + 1;
    end loop;
  end if;
  return v_n;
end;
$$;
revoke all on function private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint) from public, anon, authenticated;
