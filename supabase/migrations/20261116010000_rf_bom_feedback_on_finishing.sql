-- ============================================================================
-- RubberFlow ป้อนผลผลิตกลับงาน BOM เมื่อชิ้นงานผ่านสถานีสุดท้ายเท่านั้น (ล็อตตกแต่ง QC ผ่าน และนับเข้า WO) · ไม่ป้อนตอนรับมอบใบส่งมอบอีก
--
-- ทำไม: ก่อนหน้านี้ private.rf_apply_feedback ทำงานทุกครั้งที่ SR รับมอบใบส่งมอบ (ผสม -> ฉีด, ฉีด -> อบ, อบ -> ตกแต่ง) แล้วบวก bom_jobs.qty_done
--   ทดสอบจริงกับข้อมูลทดสอบบน production (2026-11-10): WO-20261110-03 (งานแผน 2.7523 ชิ้น, kgPerUnit 0.1126) ได้ +2.752 ตอนรับมอบใบส่งมอบสถานีผสม 0.31 kg
--   (คอมปาวด์ kg / kgPerUnit ทั้งที่ยังไม่ได้ฉีดเป็นชิ้น) แล้วได้ +3 อีกครั้งตอนรับมอบใบส่งมอบฉีด -> อบของยางชุดเดียวกัน
--   รวม 5.752 / 2.7523 "เสร็จ" ทั้งที่ยังไม่ผ่านการอบและตกแต่ง = นับซ้ำ
--
-- กติกาใหม่ (ผู้ใช้ตัดสิน 2026-11-10): ป้อนกลับงาน BOM เฉพาะเมื่อชิ้นงานผ่านสถานีสุดท้าย = ล็อตตกแต่งที่ QC ผ่านและนับเข้า WO
--   คือจังหวะเดียวกับที่เซิร์ฟเวอร์เรียก private.rf_add_produced อยู่แล้ว 2 จุด:
--     - private.rf_save_lots: บันทึกล็อตตกแต่งใหม่ที่ qc = 'pass'
--     - private.rf_save_qc: QA ตัดสินล็อตตกแต่งเป็น pass และล็อตยังไม่ถูกนับเข้า WO (counted_to_order = false) เช่นล็อตที่บันทึกเป็น hold / fail ก่อน
--   - ล็อตตกแต่งที่บันทึกเป็น hold / fail ไม่ป้อนอะไรจนกว่า QA ตัดสินเป็น pass (ป้อนครั้งเดียว ผลตรวจใบถัดมาไม่ป้อนซ้ำ เพราะ counted_to_order เป็น true แล้ว)
--   - ไม่ย้อนเมื่อ QC เปลี่ยนจาก pass ภายหลัง (เหมือนยอดนับเข้า WO)
--   - รับมอบใบส่งมอบ (receiveTransfer) ไม่เขียน BOM อีก
--   - เงื่อนไขข้ามเหมือนเดิม (RubberFlow บันทึกสำเร็จ แต่ไม่เขียน BOM): WO ไม่ผูกงาน / ไม่พบงาน / external_ref.woId ไม่ใช่ WO นี้ / ใบ PI ไม่ใช่ released-in_progress / งาน done แล้ว
--   - รายงานของงาน { at, by, good, reject: 0, note } โดย good = good_qty ของล็อตตกแต่ง (หน่วยของ WO เสมอ เพราะ rf_save_lots ตั้ง uom ล็อต = uom ของ WO จึงตัดการแปลง kg ทิ้ง)
--     note = "ผ่านตกแต่ง <เลขล็อต> จาก WO <เลข WO>" · qty_done บวก good · ครบแผน = status done · ใบ released -> in_progress
--   - ลำดับล็อกเดิม: rf_master_state ก่อน แล้ว private.rf_lock_bom() · เวอร์ชัน BOM + audit BOM_MASTER_SAVE ประทับที่ app_rf_save เหมือนเดิม
--     (app_rf_save นับแถว BOM ที่เขียนจากค่าที่ rf_save_lots / rf_save_qc คืนมา แทนค่าของ rf_save_transfers) ผลตอบกลับของ app_rf_save จึงยังรายงานงาน/ใบ BOM ที่เปลี่ยน
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดบน main ทุกตัว: ไม่มี migration หลัง 20261108010000 แทน rf_* เหล่านี้ ยกเว้น app_rf_save)
--   - private.rf_apply_feedback: ลายเซ็นเดิม (text, public.rf_transfers, public.rf_orders) ของ 20261108010000_rubberflow_shopfloor.sql ถูก DROP
--     แล้วสร้างใหม่เป็น (text, public.rf_lots, public.rf_orders)
--   - private.rf_save_transfers: ลายเซ็นเดิม (public.employees, text, boolean, boolean, jsonb, bigint, bigint) จาก 20261108010000_rubberflow_shopfloor.sql ถูก DROP
--     แล้วสร้างใหม่ตัด p_actor_name และคืน integer (จำนวนใบที่ส่งมา) แทน { jobs, orders }
--   - private.rf_save_lots: ลายเซ็นเดิมจาก 20261108010000_rubberflow_shopfloor.sql ถูก DROP แล้วสร้างใหม่ ลายเซ็นเท่าเดิมแต่คืน jsonb { jobs, orders } แทน integer
--   - private.rf_save_qc: ลายเซ็นเดิมจาก 20261108010000_rubberflow_shopfloor.sql ถูก DROP แล้วสร้างใหม่ ลายเซ็นเท่าเดิมแต่คืน jsonb { jobs, orders } แทน integer
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261111010000_bom_part_stock.sql (create or replace ลายเซ็นเดิม; perform private.lab_only_block()
--     ต่อท้าย begin เหมือนเดิม; สิทธิ์เหมือนเดิม: ถอน public/anon ให้ authenticated)
--   - ไม่แตะ: private.rf_add_produced rf_lock_bom rf_link_job rf_unlink_job rf_save_orders ตารางทั้งหมด RLS และสิทธิ์ตาราง
--   - ตัวเขียนทั้งหมดเป็น security definer + set search_path = '' · revoke all from public, anon, authenticated (เรียกผ่าน app_rf_save เท่านั้น) เหมือนเดิม
--
-- ก่อน apply / ลำดับ deploy: migration ก่อน Pilot Web ที่คาดหวังกติกาใหม่ (ต้องได้รับอนุมัติจากผู้ใช้ให้ apply ที่ production ก่อน merge ตาม "Deployment order" ใน AGENTS.md)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของ app_rf_save / rf_save_lots / rf_save_qc / rf_save_transfers / rf_apply_feedback ที่ production
--   กับนิยามใน 20261111010000_bom_part_stock.sql และ 20261108010000_rubberflow_shopfloor.sql แล้ว apply "ไฟล์นี้ตามที่อยู่บน branch" · ตรวจหลัง apply:
--   นิยามและ grant ตรงกับ local stack ที่ผ่าน db:test (anon / authenticated เรียก private.rf_* ไม่ได้ authenticated เรียก app_rf_save ได้)
--   Pilot Web รุ่นก่อน: ไม่พังกับฐานข้อมูลใหม่ (ลายเซ็น RPC และรูปผลตอบกลับของ app_rf_save เท่าเดิม) แต่ toast เรื่องงาน BOM ตอนรับมอบจะไม่ขึ้นอีก
--   Pilot Web รุ่นใหม่กับฐานข้อมูลเก่า: ยังทำงานได้ แต่ฐานข้อมูลเก่ายังป้อน BOM ตอนรับมอบ (นับซ้ำต่อไปจนกว่าจะ apply) และไม่ป้อนตอนตกแต่งผ่านเพิ่ม
--
-- Rollback: รัน create or replace จาก 20261108010000_rubberflow_shopfloor.sql ของ rf_apply_feedback(text, public.rf_transfers, public.rf_orders) และ rf_save_transfers /
--   rf_save_lots / rf_save_qc (หลัง drop ลายเซ็นของไฟล์นี้: drop function private.rf_apply_feedback(text, public.rf_lots, public.rf_orders),
--   private.rf_save_transfers(public.employees, boolean, boolean, jsonb, bigint, bigint)) แล้วคืน public.app_rf_save จาก 20261111010000_bom_part_stock.sql
--   ข้อมูลทดสอบ qty_done / reports ของงาน BOM ที่ป้อนกลับไปแล้วไม่ถูกย้อน (ล้างด้วยการล้างข้อมูลทดสอบของโหมดทดสอบ)
-- ============================================================================

-- 1. ตัวป้อนผลผลิตกลับ (ลายเซ็นใหม่) ----------------------------------------------------------
-- ป้อนผลผลิตกลับงาน BOM เมื่อชิ้นงานผ่านสถานีสุดท้าย = ล็อตตกแต่งที่ QC ผ่านและนับเข้า WO (เรียกจุดเดียวกับ rf_add_produced ใน rf_save_lots / rf_save_qc)
-- ต่อรายงาน { at, by, good = good_qty ของล็อต, reject = 0, note = "ผ่านตกแต่ง FN-… จาก WO …" } บวก qty_done ตั้งสถานะ (ครบแผน = done) ดันใบ released -> in_progress
-- ล็อตตกแต่งใช้หน่วยของ WO เสมอ (rf_save_lots ตั้ง uom ล็อต = uom ของ WO) จึงไม่มีการแปลง kg -> หน่วย
-- ข้ามไม่เขียนเมื่อ WO ไม่ผูกงาน / ไม่พบงาน / external_ref ของงานไม่ชี้มา WO นี้ / ใบไม่ใช่ released-in_progress / งาน done แล้ว / good <= 0 / ล็อตไม่ใช่ตกแต่ง คืน { jobs, orders } เป็น 0
-- ล็อกตัวนับ BOM ต่อจาก rf_master_state เหมือนเดิม (rf ก่อน bom) เฉพาะเมื่อ WO ผูกงาน · ไม่ย้อนเมื่อ QC เปลี่ยนจาก pass ภายหลัง (เหมือนยอดนับเข้า WO)
drop function if exists private.rf_apply_feedback(text, public.rf_transfers, public.rf_orders);
create or replace function private.rf_apply_feedback(p_actor_name text, p_lot public.rf_lots, p_wo public.rf_orders)
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
  if p_wo.source_job_no is null or p_lot.stage is distinct from 'finishing' then return jsonb_build_object('jobs', 0, 'orders', 0); end if;
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test and j.job_no = p_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk for update;
  if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  v_good := trim_scale(p_lot.good_qty);
  if v_good is null or v_good <= 0 then return jsonb_build_object('jobs', 0, 'orders', 0); end if;

  v_done := v_job.qty_done + v_good;
  v_status := case when v_done >= v_job.qty_planned then 'done' else 'in_progress' end;
  update public.bom_jobs set
    qty_done = v_done,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', v_good, 'reject', 0,
      'note', left('ผ่านตกแต่ง ' || p_lot.lot_no || ' จาก WO ' || p_wo.wo_no, 200))),
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
revoke all on function private.rf_apply_feedback(text, public.rf_lots, public.rf_orders) from public, anon, authenticated;

-- 2. ใบส่งมอบ: รับมอบไม่ป้อนกลับ BOM อีก (นิยามจาก 20261108010000_rubberflow_shopfloor.sql ตัดการเรียก rf_apply_feedback; คืนจำนวนใบที่ส่งมา) ---------
drop function if exists private.rf_save_transfers(public.employees, text, boolean, boolean, jsonb, bigint, bigint);
create or replace function private.rf_save_transfers(
  p_actor public.employees, p_may_send boolean, p_may_receive boolean, p_rows jsonb, p_base bigint, p_cur bigint)
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
  v_old public.rf_transfers%rowtype;
  v_lot public.rf_lots%rowtype;
  v_q numeric;
  v_next text;
  v_avail numeric;
  v_note text;
  v_cond text;
  v_text text;
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
      where id = v_old.id;
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
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_transfers(public.employees, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 3. ล็อตผลิต: ล็อตตกแต่ง QC ผ่านป้อนกลับ BOM (นิยามจาก 20261108010000_rubberflow_shopfloor.sql; คืน { jobs, orders } ของ BOM ที่เขียน) -------------
drop function if exists private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint);
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

-- 4. ผลตรวจ QC: QA ตัดสินล็อตตกแต่งเป็น pass ครั้งแรกป้อนกลับ BOM (นิยามจาก 20261108010000_rubberflow_shopfloor.sql; คืน { jobs, orders }) -------------
drop function if exists private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint);
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
      -- QA ตัดสินล็อตตกแต่งเป็น pass ครั้งแรก = ชิ้นผ่านสถานีสุดท้าย ป้อนผลผลิตกลับงาน BOM ณ จุดเดียวกับที่นับเข้า WO
      select * into v_wo from public.rf_orders o where o.is_test and o.wo_no = v_lot.order_no;
      v_res := private.rf_apply_feedback(p_actor.first_name || ' ' || p_actor.last_name, v_lot, v_wo);
      v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
      v_orders := v_orders + (v_res ->> 'orders')::integer;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders);
end;
$$;
revoke all on function private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. RPC ของ RubberFlow: นิยามจาก 20261111010000_bom_part_stock.sql เปลี่ยนเฉพาะการนับแถว BOM จาก rf_save_lots / rf_save_qc แทน rf_save_transfers ------------
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
    perform private.rf_save_requisitions(v_actor.id, v_actor_name, v_planner or v_rb, p_action, coalesce(p_changes #> '{requisitions,upsert}', '[]'::jsonb), p_base_version, v_version);
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
