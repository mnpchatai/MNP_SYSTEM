-- ============================================================================
-- BOM โหมดทดสอบ: ลดยอดแผนของงานที่เริ่มแล้วไม่ได้ (ฝั่งฐานข้อมูลบังคับ)
--
-- ทำไม: 20261126010000 บังคับว่าปิดงานก่อนถึงยอดแผนต้องมีเหตุผล แต่ยังเหลือช่องว่าง: กลุ่มวางแผนลดยอดแผน (qty_planned) ของงานที่รายงานยอดไปแล้ว
--   ในคำสั่งหนึ่ง แล้วตั้ง done ในคำสั่งถัดไปโดยไม่มีเหตุผล (ยอดถึง "แผนใหม่" แล้ว) ซึ่งทำให้ยอดที่ขาดหายไปโดยไม่มีบันทึกเหตุผล
--   Pilot ไม่เคยแก้ยอดแผนของงานที่มีอยู่แล้ว: งานเกิดตอนปล่อยผลิต (releaseOrder) · เปิดใบกลับมาแก้ลบงานของใบทั้งหมด (ห้ามถ้ามีงานเริ่ม)
--   แล้วปล่อยผลิตใหม่สร้างงานใหม่ · เบิกของซื้อ (issueOrderParts) ส่ง qtyPlanned เท่าที่เก็บ · รายงาน / ตั้งสถานะ / ปิดงาน ไม่แตะยอดแผน
--   การลดยอดแผนของงานที่เริ่มแล้วจึงเกิดได้จากการเรียก RPC ตรงเท่านั้น
--
-- กติกาที่เพิ่ม (ไม่เปลี่ยนลายเซ็น ชนิดคืน สิทธิ์ EXECUTE ตาราง RLS หรือรหัสข้อผิดพลาดของกรณีอื่น)
--   private.bom_save_jobs: แถวงานเดิม (v_present) ที่ส่งยอดแผนต่ำกว่าที่เก็บ (v_planned < v_old.qty_planned) และงาน "เริ่มแล้ว" = BOM_INVALID_JOB
--     "เริ่มแล้ว" = เงื่อนไขรายงานของ private.bom_started_jobs (นิยามล่าสุดใน 20261108020000_bom_release_opens_rubberflow_orders.sql) กับแถวเดิม:
--       status <> 'queued' · qty_done > 0 · qty_reject > 0 · มีรายงาน · หรือผูก WO ที่ไม่พบ WO ใน rf_orders (is_test, wo_no = external_ref ->> 'woId',
--       source_job_no = job_no) สถานะ planned / released / cancelled
--     หรือแถวที่ส่งมาเริ่มงานในคำสั่งเดียวกัน (v_status <> 'queued' · v_done > 0 · v_reject > 0 · รายการรายงานหลังรวมไม่ว่าง) ลดยอดพร้อมรายงาน / เริ่มงานจึงถูกปฏิเสธด้วย
--     ใช้กับทุกผู้เรียกและทุก action รวมกลุ่มวางแผน · พนักงานแผนกที่แก้ยอดแผนยังได้ BOM_FORBIDDEN ก่อน (ด่านสิทธิ์รายช่องเดิม)
--     วางต่อจากด่าน "done ต้องถึงแผน" ของ 20261126010000 (หลังสาขางานของซื้อ ST / PURCHASED ที่ continue ไปก่อน: สาขานั้นปฏิเสธการแก้ช่องโครงสร้างอยู่แล้ว
--     ยอดแผนจึงเปลี่ยนในสาขานั้นไม่ได้) · แถวที่เท่าเดิมข้ามไปก่อน (continue) ไม่ถูกตรวจ
--     ยังทำได้: เพิ่มยอดแผน (ทั้งงานที่เริ่มแล้วและยังไม่เริ่ม) · ลดหรือแก้ยอดแผนของงานที่ยังไม่เริ่ม (queued ว่าง ไม่ผูก WO ที่เริ่มแล้ว) ในคำสั่งที่ไม่เริ่มงาน
--     ข้อที่ยังเหลือ: กลุ่มวางแผนลดยอดแผนของงานที่ยังไม่เริ่มในคำสั่งหนึ่ง แล้วรายงาน / ตั้ง done ตามแผนใหม่ในคำสั่งถัดไปได้ (ทั้งสองคำสั่งอยู่ใน audit BOM_MASTER_SAVE)
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม เริ่มจากนิยามล่าสุดบน main คัดลอกจาก 20261126010000_bom_fg_child_and_close_reason.sql ทุกบรรทัด
--   เพิ่มเฉพาะด่านข้างบน · security definer + set search_path = '' และ revoke เหมือนต้นทาง)
--   - private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) (revoke all from public, anon, authenticated)
--
-- ก่อน apply / ลำดับ deploy: Pilot ใน PR เดียวกับไฟล์นี้ไม่พึ่งไฟล์นี้ (Pilot ไม่ส่งยอดแผนที่ลดลงของงานที่มีอยู่แล้วในทางใดเลย)
--   จึงทำงานได้ทั้ง "Pilot ใหม่กับฐานข้อมูลเก่า" และ "Pilot เก่ากับฐานข้อมูลใหม่" แต่ตาม AGENTS.md ยัง apply ไฟล์นี้ก่อน merge ด้วยการอนุมัติของผู้ใช้ (ครั้งนี้เท่านั้น)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของ private.bom_save_jobs ที่ production กับนิยามใน 20261126010000_bom_fg_child_and_close_reason.sql
--   (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด) แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   และตรวจ has_function_privilege (anon / authenticated เรียก private.bom_save_jobs ไม่ได้ · app_bom_save_master ไม่ถูกแตะ สิทธิ์เดิม)
--
-- Rollback: create or replace private.bom_save_jobs กลับด้วยนิยามใน 20261126010000_bom_fg_child_and_close_reason.sql (รวม revoke ท้ายฟังก์ชัน)
--   ไม่มีตารางหรือคอลัมน์ใหม่ ข้อมูลที่เกิดแล้วใช้ได้กับนิยามเดิมทั้งหมด (กติกาใหม่เพียงปฏิเสธคำขอบางแบบ ไม่เปลี่ยนรูปข้อมูล)
-- ============================================================================

-- งาน: ลดยอดแผนของงานที่เริ่มแล้วไม่ได้ (นิยามจาก 20261126010000_bom_fg_child_and_close_reason.sql เพิ่มด่านหลังด่าน "done ต้องถึงแผน") ------------------------
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
    -- ลดยอดแผนของงานที่เริ่มแล้วไม่ได้ (20261127010000) ทุกผู้เรียกทุก action รวมกลุ่มวางแผน · "เริ่มแล้ว" = เงื่อนไขรายงานของ private.bom_started_jobs กับแถวเดิม
    -- (สถานะไม่ใช่ queued มียอดดี / เสีย มีรายงาน หรือผูก WO ที่เลย released ไปแล้วหรือหาไม่พบ) หรือแถวที่ส่งมาเริ่มงานในคำสั่งเดียวกัน (ลดยอดพร้อมรายงาน / เริ่มงานจึงเลี่ยงไม่ได้)
    -- เพิ่มยอดแผน และแก้ยอดแผนของงานที่ยังไม่เริ่มยังทำได้เหมือนเดิม
    if v_planned < v_old.qty_planned
       and (v_old.status <> 'queued' or v_old.qty_done > 0 or v_old.qty_reject > 0 or jsonb_array_length(v_old.reports) > 0
            or (v_old.external_ref is not null and not exists (
                  select 1 from public.rf_orders o
                  where o.is_test and o.wo_no = (v_old.external_ref ->> 'woId') and o.source_job_no = v_old.job_no and o.status in ('planned', 'released', 'cancelled')))
            or v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0) then
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
