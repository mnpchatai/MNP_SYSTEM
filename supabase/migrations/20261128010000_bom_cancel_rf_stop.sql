-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ (ชุดแก้ 1 จากรายงานทดสอบ docs/BOM_TEST_REPORT.md: B1 W1 W3 W8 U12)
--   ยกเลิกใบสั่งผลิตได้แม้ WO เริ่มผลิตแล้ว (หยุด WO) · ยกเลิกและพักงานต้องมีเหตุผล · ST รับเคมีที่เบิกไปแล้วคืนเข้าล็อตเดิม ·
--   งานที่ผูก WO รับยอดจาก RubberFlow เท่านั้น · ข้ามเวลาบ่มเฉพาะหัวหน้า RB / QA พร้อมเหตุผล
--
-- ทำไม (รายงานทดสอบ 2026-11-17):
--   B1  ใบที่ WO เริ่มผลิตแล้วยกเลิกไม่ได้ทุกทาง: private.bom_cancel_rf_orders ปฏิเสธ BOM_RF_ORDER_STARTED และข้อความชี้ไปทางที่ไม่มี (RubberFlow ยกเลิก WO ที่กำลังผลิตไม่ได้)
--   W1  ยกเลิก / เปิดใบกลับมาแก้หลัง WO เบิกเคมีไปแล้ว: ใบเบิกยังเป็น "จ่ายแล้ว" เคมีหายจากสต็อก และใบเบิกยังอยู่ในหน้าผสม
--   W3  งาน RB ที่ผูก WO แล้วยังรายงานผลด้วยมือได้ ยอดนับซ้ำกับที่ RubberFlow ป้อนกลับ
--   W8  "ข้ามเวลาบ่ม" เปิดให้พนักงาน RB ทุกคน ไม่มีเหตุผลเก็บไว้
--   U12 พักงานและยกเลิกใบไม่มีเหตุผล (ฐานข้อมูลยอมให้ว่าง)
--
-- กติกาใหม่ (ทุกข้อฝั่งฐานข้อมูล · mock ของ harness ทำเหมือนกัน scripts/pilot-harness-mock.mjs)
--   1) ยกเลิกใบ (bom_save_orders): กลุ่มวางแผนยกเลิกใบ draft / released / in_progress ได้เมื่อมีเหตุผล cancelReason 3-200 ตัวอักษร (ไม่มี = BOM_INVALID_ORDER)
--      - งานที่มียอดแล้ว (qty_done > 0) ไม่กันการยกเลิกอีก · งานทุกงานของใบที่ยกเลิกคงอยู่พร้อมยอดและรายงาน (ไม่ลบ) และแก้ต่อไม่ได้ (bom_save_jobs แก้ได้เฉพาะใบ released / in_progress)
--      - WO ที่ผูกงาน: planned / released = ยกเลิก · in_progress / on_hold = หยุด (สถานะ cancelled ยอดผลิต ล็อต บันทึกสถานีคงอยู่) · completed คงเดิม · ไม่มี BOM_RF_ORDER_STARTED จากทางนี้แล้ว
--        (เปิดใบกลับมาแก้ยังห้ามเมื่อมีงานเริ่ม: private.bom_started_jobs นับงานที่ผูก WO ที่เลย released เป็นงานที่เริ่มแล้ว เหมือนเดิม)
--      - สินค้าสำเร็จรูป: ส่งมอบแล้วหรือให้ใบอื่นไปแล้ว = BOM_INVALID_TRANSITION (เดิม) · ที่ได้จากสต็อกคืนต้นทาง (เดิม) · ที่ใบนี้รับเข้าเองอยู่ในคลังต่อเป็นสต็อกสินค้าสำเร็จรูป
--        (bom_fg_free / bom_fg_stock นับใบ cancelled ด้วย จำนวนสั่ง = 0 · ใบร่างอื่นหยิบใช้ตอนปล่อยผลิตได้ · ใบที่ยกเลิกรับเข้า/ส่งมอบเองไม่ได้)
--      - คืนของซื้อที่เบิกไปแล้ว (bom_return_parts mode leftover) ทำได้กับใบที่ยกเลิกแล้วเหมือนใบที่ปิดแล้ว · ยกเลิกการเบิกจ่าย (undo) ยังเฉพาะใบที่เปิดอยู่
--   2) รับเคมีคืน (ใหม่ private.rf_return_requisitions · action returnRequisition): ใบเบิก issued / weighing ที่หักสต็อกแล้วของ WO ที่ยกเลิก = งานของแผนก ST
--      ST (หรือ admin) กรอกยอดที่คืนจริงรายบรรทัด 0..actualKg · คืนไม่ครบต้องมีเหตุผล 3-300 · บวกกลับเข้าล็อตเดิม (ไม่เกิน initial_kg) · ครั้งเดียวต่อใบ
--      ข้อมูลเก็บใน lines[] ของใบเบิกเอง (returnedKg / returnedAt / returnedBy / returnNote) ไม่มีตาราง คอลัมน์ หรือสถานะใหม่ (rf_records / purge / CHECK ไม่ต้องแก้)
--      ใบเบิกที่ผสมแล้ว (consumed) คืนไม่ได้: ยางที่ผสมแล้วอยู่เป็นล็อตของ WO ที่ยกเลิก
--      app_rf_save: ส่วน requisitions ของแผนก ST ส่งได้เฉพาะ returnRequisition และ returnRequisition ส่งได้เฉพาะชุด requisitions / materialLots (ผิด = RF_INVALID_REQUISITION)
--   3) งานที่ผูก WO (bom_save_jobs): ยอดดี / เสียเปลี่ยน หรือรายการรายงานใหม่ที่ไม่ใช่เหตุผลของการปิดงาน / การพัก = BOM_INVALID_JOB ทุกผู้เรียกรวมกลุ่มวางแผน
--      (ป้อนกลับจาก RubberFlow เขียนตารางเองใน private.rf_apply_feedback จึงไม่ถูกด่าน) · พัก / คืนคิว / ทำต่อ / ปิดงานพร้อมเหตุผลยังทำได้
--   4) พักงาน (bom_save_jobs): เปลี่ยนเป็น hold ต้องมาพร้อมรายการรายงานใหม่หนึ่งรายการยอด 0 ที่มีเหตุผล 3-200 ตัวอักษร ภายใต้ action setJobStatus
--      เซิร์ฟเวอร์เขียนรายการเอง { at, by, good: 0, reject: 0, note, kind: 'hold' } · ไม่มี = BOM_INVALID_JOB ทุกผู้เรียก · การพักเปลี่ยนยอดไม่ได้
--   5) ข้ามเวลาบ่ม (rf_save_lots action endRest): หัวหน้า RB (private.rf_is_rb_head) หรือแผนก QA (private.rf_is_qa) เท่านั้น (อื่น = RF_FORBIDDEN)
--      เหตุผล params.skipRest.reason 3-300 (ผิด = RF_INVALID_LOT) · เก็บ params.skipRest = { by, reason, at } ที่ล็อต
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิม เริ่มจากนิยามล่าสุดบน main · security definer + set search_path = '' และ revoke / grant เหมือนต้นทาง)
--   - private.bom_cancel_rf_orders(uuid)                         จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.bom_fg_free(uuid, text) · private.bom_fg_stock(text) จาก 20261123010000_bom_fg_stock.sql (language sql ไม่เปลี่ยน)
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) จาก 20261123010000_bom_fg_stock.sql
--   - private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint)   จาก 20261123020000_bom_issue_parts_partial.sql
--   - private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) จาก 20261127010000_bom_no_lower_started_plan.sql
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261116010000_rf_bom_feedback_on_finishing.sql
--   - private.rf_client_actions()                                จาก 20261110010000_rf_purchase_orders.sql
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)         จาก 20261120010000_st_sets_safety_stock.sql (revoke all from public, anon · grant execute to authenticated เหมือนเดิม)
--   ใหม่: private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint) (revoke all from public, anon, authenticated)
--   ไม่แตะ: ตาราง RLS สิทธิ์ตาราง public.app_bom_save_master private.bom_delete_order_jobs (ยังใช้ตอนเปิดใบกลับมาแก้) private.rf_save_requisitions
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ส่งเหตุผลตอนยกเลิกใบ / พักงาน และใช้ returnRequisition จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของทุกฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางข้างบน แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (anon เรียก app_rf_save ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้)
--   Pilot เก่า + ฐานข้อมูลใหม่: ยกเลิกใบโดยไม่มีเหตุผล = BOM_INVALID_ORDER · พักงานโดยไม่มีเหตุผล = BOM_INVALID_JOB · รายงานงานที่ผูก WO = BOM_INVALID_JOB (ไม่เขียนอะไร)
--   Pilot ใหม่ + ฐานข้อมูลเก่า: ยกเลิกใบที่มีงานเริ่มแล้วถูกปฏิเสธเหมือนเดิม · พักงานไม่ได้เลย (รายการเหตุผลยอด 0 ถูก bom_parse_reports เดิมปฏิเสธ = BOM_INVALID_JOB)
--     · returnRequisition = RF_INVALID_ACTION · ข้อมูลไม่เสียหาย
--
-- Rollback: create or replace ฟังก์ชันทั้งหมดกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke / grant) แล้ว drop function private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint)
--   ข้อมูลทดสอบที่เกิดหลังไฟล์นี้ใช้กับนิยามเดิมได้: งานของใบที่ยกเลิก (นิยามเดิมลบตอนยกเลิก) ค้างอยู่ได้เพราะแก้ไม่ได้อยู่แล้ว · ช่อง returned* / skipRest / kind เป็น jsonb ที่นิยามเดิมเมิน
--   ล้างข้อมูลทดสอบได้ด้วย app_sandbox_purge_bom / app_sandbox_purge_rf ตามปกติ
-- ============================================================================

-- 1. ยกเลิก / หยุด WO ที่ผูกงานของใบ (นิยามจาก 20261108020000_bom_release_opens_rubberflow_orders.sql เปลี่ยนเฉพาะสาขาสถานะ) -------------------------
create or replace function private.bom_cancel_rf_orders(p_order_pk uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_wo public.rf_orders%rowtype;
  v_cancelled text[] := '{}';
  v_locked boolean := false;
begin
  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test and j.order_pk = p_order_pk and j.external_ref is not null
    order by j.job_no collate "C"
    for update
  loop
    if not v_locked then
      perform private.bom_lock_rf();
      v_locked := true;
    end if;
    -- WO ต้องชี้กลับมาที่งานนี้ (source_job_no) ไม่งั้นถือว่าไม่มี WO ให้ยกเลิก (งานที่ถูกผูกมือกับ WO ของใบอื่นแตะ WO นั้นไม่ได้)
    select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = (v_job.external_ref ->> 'woId') and o.source_job_no = v_job.job_no for update;
    if not found then continue; end if;
    -- planned / released = ยกเลิก · in_progress / on_hold = หยุด (สถานะ cancelled เหมือนกัน ยอดผลิต ล็อต และบันทึกผสม/ฉีด/อบ/ตกแต่งคงอยู่ทั้งหมด)
    -- completed = ไม่มีอะไรให้หยุด คงเดิม · cancelled อยู่แล้ว = ข้าม · ไม่ปฏิเสธ WO ที่เริ่มผลิตแล้วอีก (20261128010000)
    if v_wo.status in ('planned', 'released', 'in_progress', 'on_hold') then
      update public.rf_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_wo.id;
      v_cancelled := v_cancelled || v_wo.wo_no;
    end if;
  end loop;
  return v_cancelled;
end;
$$;
revoke all on function private.bom_cancel_rf_orders(uuid) from public, anon, authenticated;

-- 2. สต็อกสินค้าสำเร็จรูป: ใบที่ยกเลิกแล้วนับเป็นใบที่ถือของ (จำนวนสั่ง = 0) (นิยามจาก 20261123010000_bom_fg_stock.sql) -------------------------------
create or replace function private.bom_fg_free(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((
    select greatest(0, private.bom_fg_have(o.id, p_code) - private.bom_fg_out(o.id, p_code)
             - greatest(case when o.status = 'cancelled' then 0
                             else coalesce((select sum((it ->> 'qty')::numeric) from jsonb_array_elements(o.items) it where it ->> 'fgCode' = p_code), 0) end,
                        private.bom_fg_total(o.id, p_code, 'deliver')))
    from public.bom_orders o
    where o.is_test and o.id = p_order_pk and o.status in ('released', 'in_progress', 'completed', 'cancelled')), 0)
$$;
revoke all on function private.bom_fg_free(uuid, text) from public, anon, authenticated;

create or replace function private.bom_fg_stock(p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(private.bom_fg_free(o.id, p_code)), 0)
  from public.bom_orders o
  where o.is_test and o.status in ('released', 'in_progress', 'completed', 'cancelled')
    and exists (select 1 from public.bom_fg_moves m where m.is_test and m.order_pk = o.id and m.fg_code = p_code)
$$;
revoke all on function private.bom_fg_stock(text) from public, anon, authenticated;

-- 3. ใบสั่งผลิต: ยกเลิกต้องมีเหตุผล · งานที่มียอดไม่กันการยกเลิก · ไม่ลบงานของใบที่ยกเลิก · ใบที่ยกเลิกเป็นต้นทางสต็อกได้ (นิยามจาก 20261123010000_bom_fg_stock.sql) ----
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

    select * into v_old from public.bom_orders o where o.is_test and o.pi_no = v_pi;
    if not found then
      -- ใบใหม่: กลุ่มวางแผนเท่านั้น เริ่มที่ draft เสมอ (revision 0, ผู้สร้าง/เวลา เซิร์ฟเวอร์ตั้ง)
      if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
      if v_status <> 'draft' then raise exception 'BOM_INVALID_TRANSITION'; end if;
      insert into public.bom_orders (
        is_test, pi_no, customer, country, order_type, ordered_at, wh_due, due, due_defaults, revision, status, items, explosion,
        exploded_at, stock_counts, note, stock_counted_at, stock_counted_by, created_by)
      values (
        true, v_pi, v_customer, v_country, v_type, v_ordered::bigint, v_wh::bigint, v_due, v_defaults, 0, 'draft', v_items, v_expl,
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
      -- คีย์ที่เป็นรหัสสินค้าของใบ (จำนวนที่หยิบจากสต็อกสินค้าสำเร็จรูป) ตั้งได้เฉพาะกลุ่มวางแผน · ST / WH นับชิ้นอื่นของใบได้เหมือนเดิม
      if v_counts_changed and exists (
           select 1 from jsonb_array_elements(v_old.items) it
           where (v_old.stock_counts -> (it ->> 'fgCode')) is distinct from (v_counts -> (it ->> 'fgCode'))) then
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
        -- สต็อกสินค้าสำเร็จรูป: เหมือนยกเลิก (stockCounts คงอยู่ ปล่อยผลิตใหม่ก็หยิบใหม่)
        v_moves := v_moves + private.bom_fg_return_stock(v_old.id, p_actor.id);
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
            where o.is_test and o.id <> v_old.id and o.status in ('released', 'in_progress', 'completed', 'cancelled')
              and exists (select 1 from public.bom_fg_moves m where m.is_test and m.order_pk = o.id and m.fg_code = v_code)
            order by o.released_at, o.pi_no collate "C"
          loop
            exit when v_take <= 0;
            continue when v_src.avail <= 0;
            v_part := least(v_take, v_src.avail);
            insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
            values (true, v_old.id, v_src.id, v_code, 'transfer', v_part, '', p_actor.id);
            v_take := v_take - v_part;
            v_moves := v_moves + 1;
          end loop;
          if v_take > 0 then raise exception 'BOM_FG_EXCEEDS'; end if;
        end if;
        if private.bom_fg_have(v_old.id, v_code) < v_qty then v_full := false; end if;
      end loop;
      if v_full then v_new_status := 'completed'; end if;
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
                            'fgMoves', v_moves);
end;
$$;
revoke all on function private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. คืนของซื้อ: คืนของเหลือของใบที่ยกเลิกแล้วได้ (นิยามจาก 20261123020000_bom_issue_parts_partial.sql) --------------------------------------------
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
    -- ใบที่ยกเลิกแล้ว (20261128010000) คืนของเหลือได้เหมือนใบที่ปิดแล้ว: งานของใบยังอยู่ (ยกเลิกไม่ลบงานแล้ว) ของที่เบิกไปคืนเข้าสต็อกได้
    if v_ord.status not in ('released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    perform 1 from public.bom_stock s where s.is_test and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      -- งานที่คืนของเหลือได้ = done · หรือเบิกไปบางส่วนเมื่อใบปิดแล้ว (completed: เบิกส่วนที่เหลือและยกเลิกการเบิกจ่ายทำไม่ได้แล้ว)
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.item_code = v_code
        and (j.status = 'done' or (v_ord.status in ('completed', 'cancelled') and j.qty_done > 0));
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

-- 5. งาน: พักงานต้องมีเหตุผล · งานที่ผูก WO รับยอดจาก RubberFlow เท่านั้น (นิยามจาก 20261127010000_bom_no_lower_started_plan.sql) ---------------------------
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
  v_hold_note text;
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
    -- พักงานพร้อมเหตุผล (20261128010000): action setJobStatus งานเดิมที่ยังไม่ hold -> hold และรายการรายงานใหม่หนึ่งรายการท้ายสุดที่ยอดดีและยอดเสียเป็น 0
    -- = เหตุผลของการพัก (note 3-200 ตัวอักษร) · เซิร์ฟเวอร์เขียนรายการเองแบบเดียวกับการปิดงาน (เวลา ผู้ทำ) พร้อมเครื่องหมาย kind = 'hold' ประวัติของงานจึงเห็นเหตุผล
    -- ผู้พักได้ = ผู้ที่เปลี่ยนสถานะงานนี้ได้อยู่แล้ว (แผนกของงาน หรือกลุ่มวางแผน: ด่านสิทธิ์รายช่องเดิม) · ไม่มีรายการนี้ = พักไม่ได้ (ด่านข้างล่าง)
    v_hold_note := null;
    if p_action = 'setJobStatus' and v_status = 'hold' and v_old.status <> 'hold' and jsonb_typeof(v_rep) = 'array' then
      if jsonb_array_length(v_rep) = coalesce(jsonb_array_length(v_old.reports), 0) + 1 then
        v_last := v_rep -> (jsonb_array_length(v_rep) - 1);
        if jsonb_typeof(v_last) = 'object' then
          if coalesce(private.bom_num(v_last -> 'good', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0
             and coalesce(private.bom_num(v_last -> 'reject', 'BOM_INVALID_JOB', 0, 1000000000), 0) = 0 then
            v_hold_note := private.bom_text(v_last, 'note', 200, 3, 'BOM_INVALID_JOB');
          end if;
        end if;
      end if;
    end if;
    if v_close_note is null and v_hold_note is null then
      v_reports := private.bom_parse_reports(v_row -> 'reports', v_old.reports, p_actor_name);
    elsif v_close_note is not null then
      v_reports := private.bom_parse_reports(v_rep - (jsonb_array_length(v_rep) - 1), v_old.reports, p_actor_name)
        || jsonb_build_array(jsonb_build_object('at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', v_close_note));
    else
      v_reports := private.bom_parse_reports(v_rep - (jsonb_array_length(v_rep) - 1), v_old.reports, p_actor_name)
        || jsonb_build_array(jsonb_build_object('at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', v_hold_note, 'kind', 'hold'));
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
    -- พักงานต้องมีเหตุผล (20261128010000): งานที่เปลี่ยนเป็น hold โดยไม่มีรายการเหตุผลของการพัก = BOM_INVALID_JOB ทุกผู้เรียกทุก action · การพักไม่เพิ่มหรือลดยอด
    if v_status = 'hold' and v_old.status <> 'hold' and v_hold_note is null then raise exception 'BOM_INVALID_JOB'; end if;
    if v_hold_note is not null and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject) then raise exception 'BOM_INVALID_JOB'; end if;
    -- งานที่ผูก WO ของ RubberFlow (external_ref.woId ของแถวเดิมหรือแถวที่ส่งมา): ยอดดี / เสียและรายงานผลมาจาก RubberFlow เท่านั้น (20261128010000)
    -- ทุกผู้เรียกรวมกลุ่มวางแผน: ยอดเปลี่ยน หรือรายการรายงานใหม่ที่ไม่ใช่รายการเหตุผลของการปิดงาน / การพัก = BOM_INVALID_JOB
    -- ยังทำได้: พัก / คืนคิว / ทำต่อ / ปิดงานพร้อมเหตุผล · private.rf_apply_feedback เขียนตารางเองไม่ผ่านฟังก์ชันนี้ จึงไม่ถูกด่านนี้
    if ((v_old.external_ref ->> 'woId') is not null or (v_ext ->> 'woId') is not null)
       and (v_done <> v_old.qty_done or v_reject <> v_old.qty_reject
            or jsonb_array_length(v_reports) - coalesce(jsonb_array_length(v_old.reports), 0)
               > (case when v_close_note is not null or v_hold_note is not null then 1 else 0 end)) then
      raise exception 'BOM_INVALID_JOB';
    end if;
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

-- 6. ล็อตผลิต: ข้ามเวลาบ่มเฉพาะหัวหน้า RB / QA พร้อมเหตุผลที่เก็บไว้ที่ล็อต (นิยามจาก 20261116010000_rf_bom_feedback_on_finishing.sql) --------------------
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
  v_temp numeric;
  v_time numeric;
  v_press numeric;
  v_shots numeric;
  v_cid text;
  v_flot public.rf_lots%rowtype;
  v_res jsonb;
  v_jobs integer := 0;
  v_orders integer := 0;
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

    -- บันทึกล็อตของสถานีไหนก็ได้เฉพาะใบ WO ที่ released / in_progress / on_hold (planned / completed / cancelled = RF_INVALID_TRANSITION)
    -- ข้อยกเว้นเดียว: ล็อตตกแต่งที่ client ปิดใบเป็น completed ในคำสั่งเดียวกัน (ใบถูกประทับด้วยเวอร์ชันของคำสั่งนี้ เพราะ client ปิดใบเองเมื่อครบเป้า)
    select * into v_ord from public.rf_orders o where o.is_test and o.wo_no = v_order_no for update;
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
      true, v_no, v_stage, v_order_no, case when v_stage = 'mixing' then v_rec.recipe_code end, v_uom, v_machine, v_shift, v_mold_id,
      v_sources, v_out, v_good, v_scrap, v_reason, v_qc, v_reasons, 0, v_ready, v_grade, v_boxes, (v_stage = 'finishing' and v_qc = 'pass'), p_actor.id)
    returning * into v_flot;

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
          -- ชิ้นผ่านสถานีสุดท้าย (ตกแต่ง QC ผ่าน นับเข้า WO) = ป้อนผลผลิตกลับงาน BOM ที่ผูกกับ WO นี้ ณ จุดเดียวกับที่นับเข้า WO
          v_res := private.rf_apply_feedback(p_actor_name, v_flot, v_ord);
          v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
          v_orders := v_orders + (v_res ->> 'orders')::integer;
        end if;
      end if;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 7. รายการ action ของ RubberFlow: เพิ่ม returnRequisition (นิยามจาก 20261110010000_rf_purchase_orders.sql) ----------------------------------------------
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
    'createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'issueRequisition', 'returnRequisition']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- 8. รับเคมีที่เบิกไปแล้วคืนเข้าล็อตเดิม (ใหม่) ------------------------------------------------------------------------------------------------
-- action returnRequisition: แผนก ST (หรือ admin) บันทึกเคมีที่ได้คืนของใบเบิกที่จ่ายแล้วแต่ยังไม่ได้ผสม ซึ่ง WO ถูกยกเลิก (ยกเลิกใบ PI / เปิดใบกลับมาแก้ / ยกเลิก WO ใน RubberFlow)
-- แถว = ใบเบิก { id, lines: [{ ..., returnedKg }], returnNote } · ทุกบรรทัดที่จ่ายแล้ว (actualKg > 0) ต้องมี returnedKg (0 ได้) 0 <= returnedKg <= actualKg (ไม่บังคับทศนิยม: ใบเบิกเก่าที่ชั่งเองอาจจ่ายเกิน 4 ตำแหน่ง ต้องคืนเต็มยอดได้)
-- คืนไม่ครบบรรทัดใด = ต้องมีเหตุผล returnNote 3-300 ตัวอักษร · คืนครบทุกบรรทัด เหตุผลไม่บังคับ (ไม่เกิน 300)
-- ลำดับตรวจ: รูปแถว / ไม่พบใบ (RF_INVALID_REQUISITION) -> ไม่มีบรรทัดไหนที่ returnedKg ต่างจากที่เก็บ = ข้าม -> ชน (RF_STALE) -> สิทธิ์ ST / admin (RF_FORBIDDEN)
--   -> สถานะ: ใบ issued / weighing ของ WO ที่ cancelled และยังไม่เคยรับคืน (RF_INVALID_TRANSITION) -> ยอด (RF_INVALID_REQUISITION)
-- ผ่านแล้ว: ล็อกล็อตวัตถุดิบของใบเรียงตามเลขล็อต (ทั้งธุรกรรมถือ advisory lock ของ app_rf_save อยู่แล้ว) บวกยอดที่คืนเข้าล็อตเดิมของบรรทัด (lines[].lotNo)
--   ยอดคงเหลือหลังคืนเกินยอดรับเข้าของล็อต (initial_kg) ไม่ได้ (RF_INVALID_REQUISITION) · ล็อตคงวันหมดอายุและสถานะเดิม (ล็อตหมดอายุยังหมดอายุ FEFO ข้ามเหมือนเดิม)
--   ทุกบรรทัดได้ returnedKg / returnedAt / returnedBy / returnNote ที่เซิร์ฟเวอร์ตั้ง (ใบนี้รับคืนได้ครั้งเดียว) · สถานะใบไม่เปลี่ยน
-- คืนจำนวนใบที่รับคืน
create or replace function private.rf_return_requisitions(
  p_actor public.employees, p_actor_name text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_old public.rf_requisitions%rowtype;
  v_wo_status text;
  v_clines jsonb;
  v_cline jsonb;
  v_sline jsonb;
  v_lines jsonb;
  v_n integer;
  v_act numeric;
  v_kg numeric;
  v_kgs numeric[];
  v_short boolean;
  v_changed boolean;
  v_note text;
  v_lot public.rf_material_lots%rowtype;
  v_ms bigint := private.bom_ms(now());
  v_count integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_REQUISITION');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_seen := v_seen || v_no;
    select * into v_old from public.rf_requisitions q where q.is_test and q.req_no = v_no for update;
    if not found then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_clines := v_row -> 'lines';
    if jsonb_typeof(v_clines) is distinct from 'array' then v_clines := '[]'::jsonb; end if;
    v_n := jsonb_array_length(v_old.lines);

    -- สำเนาที่ไม่มีบรรทัดไหนตั้ง returnedKg ต่างจากที่เก็บ (null / ไม่มี = ไม่ได้ตั้ง) ไม่ใช่การรับคืน: ข้ามเหมือนตัวเขียนอื่น
    v_changed := false;
    for v_i in 0 .. v_n - 1 loop
      v_cline := v_clines -> v_i;
      continue when v_cline is null or jsonb_typeof(v_cline) <> 'object';
      if nullif(v_cline -> 'returnedKg', 'null'::jsonb) is distinct from nullif(v_old.lines -> v_i -> 'returnedKg', 'null'::jsonb) then
        v_changed := true;
      end if;
    end loop;
    if not v_changed then continue; end if;
    if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
    if not (coalesce(private.bom_dept_of(p_actor) = 'ST', false) or coalesce(private.employee_role_code(p_actor.id) = 'admin', false)) then
      raise exception 'RF_FORBIDDEN';
    end if;

    -- ใบที่หักสต็อกแล้ว (issued · weighing ที่จ่ายไปบางบรรทัด) ของ WO ที่ยกเลิกแล้ว และยังไม่เคยรับคืน · consumed (ผสมแล้ว) คืนไม่ได้
    select o.status into v_wo_status from public.rf_orders o where o.is_test and o.wo_no = v_old.order_no;
    if v_old.status not in ('issued', 'weighing') or v_wo_status is distinct from 'cancelled'
       or exists (select 1 from jsonb_array_elements(v_old.lines) e where e ? 'returnedAt') then
      raise exception 'RF_INVALID_TRANSITION';
    end if;

    if jsonb_array_length(v_clines) <> v_n then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_note := private.bom_text(v_row, 'returnNote', 300, 0, 'RF_INVALID_REQUISITION');
    v_kgs := '{}';
    v_short := false;
    for v_i in 0 .. v_n - 1 loop
      v_cline := v_clines -> v_i;
      v_sline := v_old.lines -> v_i;
      if jsonb_typeof(v_cline) <> 'object' then raise exception 'RF_INVALID_REQUISITION'; end if;
      -- ที่จ่ายไปจริงของบรรทัด (บรรทัดของใบเก่าที่ยังไม่ชั่ง = 0 ไม่มีอะไรให้คืน)
      v_act := case when jsonb_typeof(v_sline -> 'actualKg') = 'number' then (v_sline ->> 'actualKg')::numeric else 0 end;
      v_kg := private.bom_num(v_cline -> 'returnedKg', 'RF_INVALID_REQUISITION', 0, 1000000000);
      if v_kg is null then
        if v_act > 0 then raise exception 'RF_INVALID_REQUISITION'; end if;
        v_kg := 0;
      end if;
      if v_kg > v_act + 0.000000001 then raise exception 'RF_INVALID_REQUISITION'; end if;
      if v_kg < v_act - 0.000000001 then v_short := true; end if;
      v_kgs := v_kgs || v_kg;
    end loop;
    if v_short and char_length(v_note) < 3 then raise exception 'RF_INVALID_REQUISITION'; end if;

    -- ล็อกล็อตของใบเรียงตามเลขล็อต (ลำดับเดียวกับ rf_save_requisitions) แล้วบวกยอดคืนเข้าล็อตเดิมทีละบรรทัด (ล็อตเดียวกันหลายบรรทัดอ่านยอดล่าสุดทุกครั้ง)
    perform 1 from public.rf_material_lots l
    where l.is_test and l.lot_no in (select e ->> 'lotNo' from jsonb_array_elements(v_old.lines) e)
    order by l.lot_no
    for update;
    v_lines := v_old.lines;
    for v_i in 0 .. v_n - 1 loop
      v_sline := v_old.lines -> v_i;
      v_kg := v_kgs[v_i + 1];
      if v_kg > 0 then
        select * into v_lot from public.rf_material_lots l where l.is_test and l.lot_no = (v_sline ->> 'lotNo');
        if not found then raise exception 'RF_INVALID_REQUISITION'; end if;
        if v_lot.qty_kg + v_kg > v_lot.initial_kg + 0.000001 then raise exception 'RF_INVALID_REQUISITION'; end if;
        update public.rf_material_lots set qty_kg = trim_scale(v_lot.qty_kg + v_kg), updated_at = now() where id = v_lot.id;
      end if;
      v_lines := jsonb_set(v_lines, array[v_i::text], v_sline || jsonb_build_object(
        'returnedKg', v_kg, 'returnedAt', v_ms, 'returnedBy', p_actor_name, 'returnNote', v_note));
    end loop;
    update public.rf_requisitions set lines = v_lines, updated_at = now() where id = v_old.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 9. RPC ของ RubberFlow: ส่วนใบเบิกของ ST เฉพาะ returnRequisition (นิยามจาก 20261120010000_st_sets_safety_stock.sql) ---------------------------------------
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
      -- ใบสั่งซื้อ: ชุด purchaseOrders ส่งได้เฉพาะสามคำสั่งของใบสั่งซื้อ และแต่ละคำสั่งส่งได้เฉพาะชุดที่เกี่ยวข้อง (รับเข้า = ใบ + ล็อตวัตถุดิบ, สร้าง = ใบ + วัตถุดิบ, ยกเลิก = ใบ)
      if v_n > 0 and ((v_key = 'purchaseOrders' and not (p_action = any (array['createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder'])))
                      or (p_action = 'createPurchaseOrder' and v_key not in ('purchaseOrders', 'materials'))
                      or (p_action = 'receivePurchaseLine' and v_key not in ('purchaseOrders', 'materialLots'))
                      or (p_action = 'cancelPurchaseOrder' and v_key <> 'purchaseOrders')) then
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
