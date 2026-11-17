-- ============================================================================
-- BOM โหมดทดสอบ: สินค้าสำเร็จรูป (FG) เป็นส่วนประกอบของ BOM ไม่ได้ · ปิดงานก่อนถึงยอดแผนต้องมีเหตุผลเสมอ (ฝั่งฐานข้อมูลบังคับ)
--
-- ทำไม: ผู้ใช้ตัดสิน 2026-11-17 ว่าสินค้าสำเร็จรูปใช้เป็นส่วนประกอบของชิ้นอื่นไม่ได้ (Pilot รุ่นเดียวกับไฟล์นี้ปฏิเสธทุกทางแล้ว: rules.childKindError)
--   ฐานข้อมูลยังรับบรรทัด BOM ที่ลูกเป็น FG อยู่ การเรียก RPC ตรงจึงสร้างได้ · production ตรวจแล้วไม่มีบรรทัด BOM ที่ลูกเป็น FG เลย จึงไม่ต้องแก้ข้อมูล
--   และ 20261125010000 ให้ฝ่ายวางแผนปิดงานที่ไม่ถึงยอดได้โดยต้องมีเหตุผล (รายการรายงานยอด 0) แต่การเรียก RPC ตรงยังตั้งงานเป็น done โดยไม่เพิ่มยอดและไม่มีเหตุผลได้
--   (พนักงานแผนกกับงานของแผนกตัวเอง · ฝ่ายวางแผนที่ไม่ส่งรายการเหตุผล) Pilot ไม่ทำแบบนั้น: reportJob ตั้ง done เฉพาะเมื่อ qtyDone + 1e-9 >= qtyPlanned
--   และ setJobStatus เป็น done ผ่าน closeJob ซึ่งมีเหตุผลเสมอ
--
-- กติกาที่เพิ่ม (ไม่เปลี่ยนลายเซ็น ชนิดคืน สิทธิ์ EXECUTE ตาราง RLS หรือรหัสข้อผิดพลาดของกรณีอื่น)
--   1) public.app_bom_save_master: ตรวจชนิดพ่อ/ลูกหลังเขียน (BOM ที่ approved ของชิ้นที่ถูกแก้ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก)
--      เพิ่ม "ลูกเป็น FG" = BOM_INVALID_CHILD_KIND (บรรทัดใหม่ในเงื่อนไขเดิม · พ่อเป็นของซื้อ / สูตรยางยังได้ BOM_INVALID_PARENT_KIND เหมือนเดิม)
--      ครอบคลุมทั้งการบันทึก BOM ที่มีลูกเป็น FG และการเปลี่ยนชนิดของชิ้นที่เป็นลูกอยู่แล้วให้เป็น FG (ชิ้นที่ถูกแก้เป็นลูกของ BOM ที่ approved)
--   2) private.bom_save_jobs: งานเดิมที่เปลี่ยนจากไม่ done เป็น done (v_status = 'done' และ v_old.status <> 'done') โดยไม่มีรายการเหตุผลของการปิดงาน
--      (v_close_note is null) ต้องมี qty_done + 0.000000001 >= ยอดแผน (ค่าที่มากกว่าระหว่างยอดแผนเดิมกับที่ส่งมา ลดยอดแผนในคำสั่งเดียวกันจึงเลี่ยงไม่ได้) ไม่งั้น BOM_INVALID_JOB · ใช้กับทุกผู้เรียกและทุก action · ข้อที่ยังเหลือ: กลุ่มวางแผนลดยอดแผนของงานในคำสั่งหนึ่งแล้วตั้ง done ในคำสั่งถัดไปได้ (ทั้งสองคำสั่งอยู่ใน audit BOM_MASTER_SAVE)
--      วางต่อจากด่านเดิมของรายการปิดงาน (v_close_note กับยอดต้องเท่าเดิม) และหลังสาขางานของซื้อ (ST / PURCHASED) ที่ continue ไปก่อน งานของซื้อจึงไม่ถูกกระทบ
--      ทางที่ถูกต้องไม่ถูกกระทบ: reportJob ที่ยอดถึงแผน (done = true) · ฝ่ายวางแผนปิดงานพร้อมเหตุผล (v_close_note ไม่ว่าง) · private.rf_apply_feedback (RubberFlow ผ่านตกแต่ง)
--      ตั้งงาน done ที่ตารางเอง ไม่ผ่านฟังก์ชันนี้ · งานที่ done อยู่แล้วไม่เข้าเงื่อนไข (ไม่ใช่การเปลี่ยนสถานะ)
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม เริ่มจากนิยามล่าสุดบน main คัดลอกจาก 20261125010000_bom_close_rules.sql แก้เฉพาะจุดข้างบน
--   · security definer + set search_path = '' และ revoke / grant เหมือนต้นทาง)
--   - private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) (revoke all from public, anon, authenticated)
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text) (revoke all from public, anon · grant execute to authenticated · perform private.lab_only_block() ต้นฟังก์ชันเหมือนเดิม)
--
-- ก่อน apply / ลำดับ deploy: Pilot ใน PR เดียวกับไฟล์นี้ไม่พึ่งไฟล์นี้ (client ปฏิเสธทั้งสองกรณีอยู่แล้ว) จึงทำงานได้ทั้ง "Pilot ใหม่กับฐานข้อมูลเก่า" และ "Pilot เก่ากับฐานข้อมูลใหม่"
--   (Pilot เก่าที่ยังเลือก FG เป็นส่วนประกอบได้จะได้ BOM_INVALID_CHILD_KIND จากฐานข้อมูลใหม่ แสดงเป็นข้อความทั่วไปว่าข้อมูลไม่ผ่านการตรวจ ไม่มีข้อมูลเสีย)
--   แต่ตาม AGENTS.md ยัง apply ไฟล์นี้ก่อน merge ด้วยการอนุมัติของผู้ใช้ (ครั้งนี้เท่านั้น)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสองฟังก์ชันที่ replace ที่ production กับนิยามใน 20261125010000_bom_close_rules.sql (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด)
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege
--   (anon เรียก app_bom_save_master ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้)
--   ตรวจข้อมูลก่อน apply (อ่านอย่างเดียว): บรรทัด BOM ที่ลูกเป็น FG ต้องไม่มี
--     select count(*) from public.bom_bom_lines l join public.bom_items c on c.is_test and c.code = l.child_code where c.kind = 'FG';
--
-- Rollback: create or replace สองฟังก์ชันกลับด้วยนิยามใน 20261125010000_bom_close_rules.sql (รวม revoke / grant ท้ายฟังก์ชัน) ไม่มีตารางหรือคอลัมน์ใหม่
--   ข้อมูลที่เกิดแล้วใช้ได้กับนิยามเดิมทั้งหมด (กติกาใหม่เพียงปฏิเสธข้อมูลบางแบบ ไม่เปลี่ยนรูปข้อมูล)
-- ============================================================================

-- 1. งาน: ปิดงานก่อนถึงยอดแผนต้องมีเหตุผล (นิยามจาก 20261125010000_bom_close_rules.sql เพิ่มด่านยอดถึงแผนหลังด่านรายการปิดงาน) -------------------------------------------
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_el jsonb;
  v_seen text[] := '{}';
  v_started uuid[] := '{}';
  v_dept_actor text := private.bom_dept_of(p_actor);
  v_no text;
  v_ord public.bom_orders%rowtype;
  v_dept text;
  v_item text;
  v_name text;
  v_kind text;
  v_uom text;
  v_planned numeric;
  v_required numeric;
  v_stock numeric;
  v_done numeric;
  v_reject numeric;
  v_due numeric;
  v_status text;
  v_fg jsonb;
  v_ext jsonb;
  v_reports jsonb;
  v_old public.bom_jobs%rowtype;
  v_struct boolean;
  v_work boolean;
  v_ext_changed boolean;
  v_good numeric;
  v_rej numeric;
  v_ext_stored jsonb;
  v_done_at timestamptz;
  v_present boolean;
  v_contrib numeric;
  v_rep jsonb;
  v_last jsonb;
  v_close_note text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_ord from public.bom_orders o
    where o.is_test and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB'));
    if not found then raise exception 'BOM_INVALID_JOB'; end if;
    v_dept := private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT'));
    v_item := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_JOB'));
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_JOB');
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_JOB');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_JOB'; end if;
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_JOB');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_JOB'; end if;
    v_planned := private.bom_num(v_row -> 'qtyPlanned', 'BOM_INVALID_JOB', 0, 1000000000);
    v_required := private.bom_num(v_row -> 'qtyRequired', 'BOM_INVALID_JOB', 0, 1000000000);
    if v_planned is null or v_required is null then raise exception 'BOM_INVALID_JOB'; end if;
    v_stock := private.bom_num(v_row -> 'stockCounted', 'BOM_INVALID_JOB', 0, 1000000000);
    v_done := coalesce(private.bom_num(v_row -> 'qtyDone', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_reject := coalesce(private.bom_num(v_row -> 'qtyReject', 'BOM_INVALID_JOB', 0, 1000000000), 0);
    v_due := private.bom_num(v_row -> 'dueAt', 'BOM_INVALID_JOB', 1, 100000000000000);
    if v_due is not null and v_due <> trunc(v_due) then raise exception 'BOM_INVALID_JOB'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_JOB');
    if v_status not in ('queued', 'in_progress', 'done', 'hold') then raise exception 'BOM_INVALID_JOB'; end if;
    v_node := v_row -> 'fgCodes';
    if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
    if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 500 then raise exception 'BOM_INVALID_JOB'; end if;
    v_fg := '[]'::jsonb;
    for v_el in select value from jsonb_array_elements(v_node) loop
      if jsonb_typeof(v_el) <> 'string' or char_length(btrim(v_el #>> '{}')) not between 1 and 60 then raise exception 'BOM_INVALID_JOB'; end if;
      v_fg := v_fg || jsonb_build_array(private.bom_code(v_el #>> '{}'));
    end loop;
    v_ext := private.bom_parse_external_ref(v_row -> 'externalRef');

    select * into v_old from public.bom_jobs j where j.is_test and j.job_no = v_no;
    -- ชนก่อนสิทธิ์/รูปเสมอ: งานถูกคนอื่นแก้หลังเวอร์ชันฐาน หรือถูกลบหลังเวอร์ชันฐาน (เปิดใบกลับมาแก้ / ยกเลิก) = ฝั่ง client ถือสำเนาเก่า
    -- เทียบกับแถวล่าสุดแล้วตัดสินว่าไม่มีสิทธิ์ไม่ได้ (สองคนในแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน คนที่สองต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN)
    v_present := found;
    if v_present then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    elsif exists (select 1 from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no
                  and k.changed_version > p_base and k.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    if not v_present then
      -- งานใหม่: เกิดตอนปล่อยผลิตเท่านั้น (ใบ draft -> released ในคำสั่งเดียวกัน) เริ่มที่ queued ว่าง
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if not (v_ord.id = any (p_released)) then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_status <> 'queued' or v_done <> 0 or v_reject <> 0 or v_ext is not null
         or jsonb_array_length(private.bom_parse_reports(v_row -> 'reports', '[]'::jsonb, p_actor_name)) > 0 then
        raise exception 'BOM_INVALID_JOB';
      end if;
      delete from public.bom_deleted_keys k where k.is_test and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values (true, v_no, v_ord.id, v_dept, v_item, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
      continue;
    end if;

    -- ฝ่ายวางแผนปิดงานที่จะไม่รายงานต่อพร้อมเหตุผล (20261125010000): action setJobStatus งานเดิมยังไม่ done -> done และรายการรายงานใหม่หนึ่งรายการท้ายสุด
    -- ที่ยอดดีและยอดเสียเป็น 0 = เหตุผลของการปิด (note 3-200 ตัวอักษร) · private.bom_parse_reports ไม่รับรายการใหม่ที่ยอดเป็น 0 จึงแยกรายการนี้ออกมาเขียนเอง
    -- (เวลาและผู้ทำเซิร์ฟเวอร์ตั้ง) รายการเดิมทั้งหมดยังตรวจด้วย bom_parse_reports · พนักงานแผนก action อื่น หรือไม่มีเหตุผล = รายการยอด 0 ถูกปฏิเสธเหมือนเดิม (BOM_INVALID_JOB)
    v_close_note := null;
    v_rep := v_row -> 'reports';
    if p_planner and p_action = 'setJobStatus' and v_status = 'done' and v_old.status <> 'done' and jsonb_typeof(v_rep) = 'array' then
      if jsonb_array_length(v_rep) = coalesce(jsonb_array_length(v_old.reports), 0) + 1 then
        v_last := v_rep -> (jsonb_array_length(v_rep) - 1);
        if jsonb_typeof(v_last) = 'object' then
          if coalesce(private.bom_num(v_last -> 'good', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0
             and coalesce(private.bom_num(v_last -> 'reject', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0 then
            v_close_note := private.bom_text(v_last, 'note', 200, 3, 'BOM_INVALID_JOB');
          end if;
        end if;
      end if;
    end if;
    if v_close_note is null then
      v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    else
      v_reports := private.bom_parse_reports(v_rep - (jsonb_array_length(v_rep) - 1), v_old.reports, p_actor_name)
        || jsonb_build_array(jsonb_build_object('at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', v_close_note));
    end if;
    v_struct := v_old.dept <> v_dept or v_old.item_code <> v_item or v_old.name <> v_name
      or v_old.kind <> v_kind or v_old.uom <> v_uom or v_old.qty_planned <> v_planned or v_old.qty_required <> v_required
      or v_old.stock_counted is distinct from v_stock or v_old.due_at is distinct from v_due::bigint or v_old.fg_codes <> v_fg;
    v_work := v_old.status <> v_status or v_old.qty_done <> v_done or v_old.qty_reject <> v_reject or v_old.reports <> v_reports;
    v_ext_changed := (v_old.external_ref is null) <> (v_ext is null)
      or (v_ext is not null and (v_old.external_ref - 'linkedAt' - 'by' - 'auto') <> v_ext);
    if not (v_struct or v_work or v_ext_changed) then continue; end if;

    -- งานของซื้อของ ST (PURCHASED / ST): ช่องผลงาน (status, qty_done, qty_reject, reports) เปลี่ยนได้ทางเดียวคือ action issueOrderParts เท่านั้น (ผู้ทำ/ผู้วางแผนก็เช่นกัน)
    -- ภายใต้ action นั้นตัวเขียนนี้ตรวจชน (ข้างบน) และสถานะใบ แล้วข้ามแถวไป: private.bom_issue_parts ตั้งงานเป็น done หักสต็อก และเขียนประวัติเอง
    if v_work and ((v_old.kind = 'PURCHASED' and v_old.dept = 'ST') or (v_kind = 'PURCHASED' and v_dept = 'ST')) then
      if p_action is distinct from 'issueOrderParts' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_struct or v_ext_changed or v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if;
      select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
      if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_ord.status = 'released' then v_started := v_started || v_ord.id; end if;
      continue;
    end if;

    -- สิทธิ์รายช่อง
    if not p_planner then
      -- แผนกอื่นแก้ชื่อ จำนวนแผน วันครบกำหนด ชิ้นงาน ใบ ฯลฯ ไม่ได้
      if v_struct then raise exception 'BOM_FORBIDDEN'; end if;
      -- รายงาน/สถานะ/ยอด: พนักงานแผนกเดียวกับงาน (ทุกบทบาท)
      if v_work and v_dept_actor is distinct from v_old.dept then raise exception 'BOM_FORBIDDEN'; end if;
      -- ผูก WO: พนักงานแผนก RB เฉพาะงานที่ยังไม่ผูก
      if v_ext_changed and (v_dept_actor is distinct from 'RB' or v_old.external_ref is not null or v_ext is null) then
        raise exception 'BOM_FORBIDDEN';
      end if;
    end if;
    if v_old.order_pk <> v_ord.id then raise exception 'BOM_INVALID_JOB'; end if; -- ย้ายงานไปใบอื่นไม่ได้
    -- แก้งานได้เฉพาะใบที่ปล่อยผลิตแล้วและยังไม่ปิด (อ่านสถานะล่าสุดหลังเปลี่ยนสถานะใบในคำสั่งนี้)
    select * into v_ord from public.bom_orders o where o.id = v_old.order_pk;
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if v_ext_changed and v_ext is not null and v_old.dept <> 'RB' then raise exception 'BOM_INVALID_JOB'; end if;
    -- ปิดงานโดยฝ่ายวางแผน (20261125010000): ไม่เพิ่มหรือลดยอดดี / เสีย (ด่าน PK / FG ข้างล่างจึงผ่านเสมอสำหรับการปิด)
    if v_close_note is not null and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject) then raise exception 'BOM_INVALID_JOB'; end if;
    -- งานที่เปลี่ยนเป็น done โดยไม่มีรายการเหตุผลของการปิดงาน (20261126010000): ต้องถึงยอดแผนแล้ว (ตรงกับ reportJob: qtyDone + 1e-9 >= qtyPlanned)
    -- ไม่งั้นการเรียก RPC ตรงปิดงานที่ยังไม่ถึงแผนได้โดยไม่เพิ่มยอดและไม่มีเหตุผล · ปิดก่อนถึงแผนต้องผ่านรายการเหตุผล (v_close_note) ของฝ่ายวางแผนเท่านั้น
    if v_status = 'done' and v_old.status <> 'done' and v_close_note is null and v_done + 0.000000001 < greatest(v_planned, v_old.qty_planned) then
      raise exception 'BOM_INVALID_JOB';
    end if;
    -- งานของซื้อที่เบิกไปแล้ว (แถวเดิม ST / PURCHASED ที่ qty_done > 0 ครบหรือบางส่วน หรือ done): ตัวเขียนนี้ไม่แก้อะไรของงานนี้เลย ทุก action ทุกผู้เรียก (20261124010000)
    -- แถวที่มาถึงตรงนี้มีการแก้ช่องโครงสร้าง / WO เท่านั้น (แถวที่เท่าเดิมข้ามไปแล้ว แถวที่แก้ช่องผลงานไปสาขาของซื้อข้างบน) เช่นลด qty_planned ลงเท่ายอดที่เบิก
    -- = งาน in_progress ที่เบิกต่อไม่ได้ · ผลงานเปลี่ยนได้เฉพาะตัวเขียนเบิกจ่าย (issueOrderParts -> private.bom_issue_parts) และตัวเขียนคืน
    -- (undoOrderParts / returnOrderParts -> private.bom_return_parts แก้ตารางเอง ไม่ผ่านฟังก์ชันนี้) · งานของซื้อที่ยังไม่เบิก (ยอด 0 ไม่ done) แก้ได้เหมือนเดิม
    if v_old.kind = 'PURCHASED' and v_old.dept = 'ST' and (v_old.qty_done > 0 or v_old.status = 'done') then
      raise exception 'BOM_INVALID_JOB';
    end if;
    -- งานแพ็กสินค้าสำเร็จรูป (PK / FG): ยอดที่ PK รายงานรวมของสินค้านั้นในใบ (private.bom_fg_pk_done) ต้องไม่ต่ำกว่ายอดที่ WH รับเข้าคลังสะสมแล้ว
    -- (ต่ำกว่า = ใบค้างปิดไม่ได้: closeOrderShort ต้องการรับสะสม = ยอด PK ทุกสินค้า และรับเพิ่มไม่ได้เพราะเกินยอด PK) · ทุกผู้เรียกรวมกลุ่มวางแผน
    -- ตัวตนของงานอ่านจากแถวเดิม (v_old): ลดยอด หรือย้ายงานไปสินค้า / ชนิด / แผนกอื่นในแถวเดียวกัน = ยอดเดิมของงานนี้หายจากสินค้าเดิมเท่ากัน
    if v_old.dept = 'PK' and v_old.kind = 'FG' then
      v_contrib := case when v_dept = 'PK' and v_kind = 'FG' and v_item = v_old.item_code then v_done else 0 end;
      if v_contrib < v_old.qty_done
         and private.bom_fg_pk_done(v_old.order_pk, v_old.item_code) - v_old.qty_done + v_contrib
             < private.bom_fg_total(v_old.order_pk, v_old.item_code, 'receive') then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    if not p_planner and v_work then
      -- งานที่ done แล้วพนักงานแผนกแก้ไม่ได้ · ยอดเพิ่มได้อย่างเดียวและต้องมาพร้อมรายงาน (ผลรวมดี/เสียของรายการใหม่เท่าส่วนที่เพิ่ม)
      if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
      select coalesce(sum((t.value ->> 'good')::numeric), 0), coalesce(sum((t.value ->> 'reject')::numeric), 0)
      into v_good, v_rej
      from jsonb_array_elements(v_reports) with ordinality as t(value, ord)
      where t.ord > jsonb_array_length(v_old.reports);
      if abs((v_done - v_old.qty_done) - v_good) > 0.001 or abs((v_reject - v_old.qty_reject) - v_rej) > 0.001 then
        raise exception 'BOM_INVALID_JOB';
      end if;
    end if;

    v_done_at := case when v_status = 'done' then coalesce(v_old.done_at, now()) else null end;
    v_ext_stored := case
      when not v_ext_changed then v_old.external_ref
      when v_ext is null then null
      else v_ext || jsonb_build_object('linkedAt', private.bom_ms(now()), 'by', p_actor_name) end;
    update public.bom_jobs set
      dept = v_dept, item_code = v_item, name = v_name, kind = v_kind, uom = v_uom, qty_planned = v_planned, qty_required = v_required,
      stock_counted = v_stock, due_at = v_due::bigint, fg_codes = v_fg, status = v_status, qty_done = v_done, qty_reject = v_reject,
      reports = v_reports, external_ref = v_ext_stored, done_at = v_done_at, updated_at = now()
    where id = v_old.id;

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return v_started;
end;
$$;
revoke all on function private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) from public, anon, authenticated;

-- 2. RPC: บันทึกข้อมูลหลัก BOM ปฏิเสธบรรทัดที่ลูกเป็นสินค้าสำเร็จรูป (นิยามจาก 20261125010000_bom_close_rules.sql เพิ่มเงื่อนไข c.kind = 'FG') -------------------------------
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
      -- ของสำเร็จรูป: ส่วน fgMoves ส่งได้เฉพาะ receiveFg / deliverFg / closeOrderShort / closeOrder และสี่การกระทำนี้ส่งได้เฉพาะส่วน fgMoves (ผิด = BOM_INVALID_FG ตรวจก่อนกฎของส่วนอื่น)
      if v_n > 0 and ((v_key = 'fgMoves' and not (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder')))
                      or (p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder') and v_key <> 'fgMoves')) then
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

  -- ของสำเร็จรูป: receiveFg / deliverFg / closeOrderShort / closeOrder ต้องมีคำขอในส่วน fgMoves เสมอ (ไม่มีส่วนนี้ หรือ upsert ว่าง = BOM_INVALID_FG
  -- ไม่ใช่สำเร็จแบบไม่ทำอะไร) ตามสัญญา "คำขอเดียวต่อคำสั่ง" · ตรวจหลังรูป payload ก่อนล็อกตัวนับ (BOM_RESET / ฐานเวอร์ชันมาทีหลัง)
  if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder') and coalesce(jsonb_array_length(p_changes #> '{fgMoves,upsert}'), 0) = 0 then
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
    -- ของสำเร็จรูป (receiveFg / deliverFg / closeOrderShort / closeOrder): ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ (ประวัติ และใบที่ปิดเอง) · audit นับเป็น fgMoves ตามจำนวนแถวประวัติที่เขียน และ orders +1 เมื่อใบถูกปิด
    if p_action in ('receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder') then
      v_fg := private.bom_fg_move(v_actor, p_action, coalesce(p_changes #> '{fgMoves,upsert}', '[]'::jsonb));
      v_counts := v_counts || jsonb_build_object('fgMoves', jsonb_build_object('upsert', (v_fg ->> 'moves')::integer));
      if (v_fg ->> 'closed')::boolean then v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', 1)); end if;
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
