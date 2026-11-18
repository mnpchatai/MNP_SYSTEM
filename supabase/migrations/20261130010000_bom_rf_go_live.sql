-- ============================================================================
-- BOM / RubberFlow ใช้งานจริง (go-live switch): พนักงานจริงใช้ #/bom และ #/rubberflow ได้ด้วยบัญชีของตัวเอง
--
-- ทำไม (เจ้าของโรงงาน 2026-11-18): ต้องให้พนักงานจริงใช้ BOM และ RubberFlow ได้ในเดือนมกราคม · เดิมทั้งสองโมดูลเปิดเฉพาะ admin ในโหมดทดสอบ
--   (private.bom_actor / private.rf_actor raise BOM_TEST_MODE_ONLY / RF_TEST_MODE_ONLY ถ้าไม่ได้สวม persona) และทุกคำสั่งอ่าน/เขียนเฉพาะแถว is_test = true
--
-- กติกาใหม่
--   1) ผู้ทำรายการ (private.bom_actor / private.rf_actor)
--      - โหมดทดสอบ (admin ที่ active อยู่ใน sandbox_sessions และสวม persona: private.sandbox_persona() ไม่ว่าง) = persona เหมือนเดิมทุกอย่าง
--      - นอกโหมดทดสอบ = แถว employees ของ auth.uid() ที่ is_active และไม่ใช่ persona (is_test = false) · ไม่มี / inactive = BOM_FORBIDDEN / RF_FORBIDDEN
--      - ไม่มี session = AUTH_REQUIRED เหมือนเดิม · anon เรียก RPC ไม่ได้อยู่แล้ว (execute เฉพาะ authenticated) · บัญชี lab-only ถูก private.lab_only_block ตัดก่อนเหมือนเดิม
--      สิทธิ์ทุกข้อ (กลุ่มวางแผน แผนกของงาน ST WH QA SR หัวหน้า RB ฯลฯ) มาจากแถว employees ของผู้ทำรายการอยู่แล้ว จึงใช้กับพนักงานจริงเหมือน persona ทุกข้อ ไม่แก้กฎใด
--   2) โหมดของข้อมูล: private.bom_test_mode() ใหม่ = (private.sandbox_persona()).id is not null คือค่าเดียวกับที่ trigger private.sandbox_row_scope ตั้ง is_test ของแถวใหม่
--      ทุกฟังก์ชันของ BOM / RubberFlow ที่เดิมกรอง "<ตาราง>.is_test" (ค่าคงที่ true) เปลี่ยนเป็น "<ตาราง>.is_test = (select private.bom_test_mode())" (sub-select = ประเมินครั้งเดียวต่อคำสั่ง)
--      จึงอ่าน / ล็อก / ตรวจซ้ำ / นับเลขเอกสาร (เช่นเลข WO) เฉพาะแถวของโหมดผู้เรียก: โหมดจริงเห็นเฉพาะ is_test = false โหมดทดสอบเฉพาะ is_test = true
--      ค่าแรกของ insert ที่คอลัมน์แรกเป็น is_test เปลี่ยนจาก true เป็นค่าเดียวกัน (trigger ทับด้วยค่าเดียวกันอยู่แล้ว เขียนให้อ่านตรงกับที่เกิดจริง)
--      audit_logs ของ BOM_MASTER_SAVE / RF_SAVE เก็บ is_test ตามโหมด และ app_bom_audit / app_rf_audit อ่านเฉพาะแถวของโหมดผู้เรียก
--      ตัวนับ bom_master_state / rf_master_state มีแถวละโหมด (primary key is_test) · แถวโหมดจริงเกิดเองตอนบันทึกครั้งแรก (insert ... on conflict do nothing เดิมของ RPC บันทึก
--      และ rf_lock_bom / bom_lock_rf) ก่อนนั้นอ่านได้ version 0 epoch ว่าง (client รับได้อยู่แล้ว) ไฟล์นี้จึงไม่ insert แถวใด
--   3) ไม่เปลี่ยน: trigger private.sandbox_row_scope (ตั้ง is_test จากโหมด และห้ามแก้ / ลบแถวข้ามโหมด = SANDBOX_SCOPE_MISMATCH) · private.bom_stamp_version / rf_stamp_version
--      (เทียบ is_test ของแถวเอง) · private.bom_audit_actor_id · app_sandbox_purge_bom / app_sandbox_purge_rf (ยังเป็นของ admin ในโหมดทดสอบเท่านั้น ลบเฉพาะ is_test)
--      · unique ทุกตัวของตาราง bom_* / rf_* มี is_test อยู่แล้ว (เช่น pi_no, job_no, wo_no, lot_no, po_no) เลขเดียวกันจึงมีได้ทั้งสองโหมด ไม่ต้องแก้
--      · สูตรยาง / ข้อมูลหลักของโหมดทดสอบไม่ถูกคัดลอกมาโหมดจริง (ผู้ใช้จะย้ายเองภายหลัง) โหมดจริงเริ่มว่าง
--
-- นิยามที่ replace (นิยามล่าสุดบน main ทุกตัว · ไม่เปลี่ยนลายเซ็น จึงคง owner / revoke / grant เดิม)
--   มือ: private.bom_actor()  จาก 20261105010000_bom_master_data.sql · private.rf_actor()  จาก 20261107010000_rubberflow_core.sql
--   กลไก (เฉพาะการแทนสี่แบบข้างบน ไม่มีการแก้อื่น):
--   - private.bom_parse_lines(text, text, jsonb)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_check_keyed(text, text, text, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_colors(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_processes(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_items(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_color_sets(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_packages(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_save_routings(uuid, jsonb, bigint, bigint)  จาก 20261105010000_bom_master_data.sql
--   - public.app_bom_master_since(bigint)  จาก 20261105010000_bom_master_data.sql
--   - private.bom_delete_order_jobs(uuid)  จาก 20261106010000_bom_orders_jobs.sql
--   - private.bom_parse_order_items(jsonb)  จาก 20261106010000_bom_orders_jobs.sql
--   - private.bom_save_customers(uuid, jsonb, bigint, bigint)  จาก 20261106010000_bom_orders_jobs.sql
--   - private.bom_delete_jobs(boolean, jsonb, bigint, bigint)  จาก 20261106010000_bom_orders_jobs.sql
--   - private.bom_snapshot()  จาก 20261106010000_bom_orders_jobs.sql
--   - public.app_bom_audit(integer)  จาก 20261106010000_bom_orders_jobs.sql
--   - private.rf_lock_bom()  จาก 20261107010000_rubberflow_core.sql
--   - private.rf_parse_items(jsonb, jsonb)  จาก 20261107010000_rubberflow_core.sql
--   - private.rf_job_for_link(text)  จาก 20261107010000_rubberflow_core.sql
--   - private.rf_unlink_job(text, public.rf_orders)  จาก 20261107010000_rubberflow_core.sql
--   - private.rf_snapshot()  จาก 20261107010000_rubberflow_core.sql
--   - public.app_rf_master_since(bigint)  จาก 20261107010000_rubberflow_core.sql
--   - public.app_rf_audit(integer)  จาก 20261107010000_rubberflow_core.sql
--   - private.bom_save_compounds(uuid, jsonb, bigint, bigint)  จาก 20261107010000_rubberflow_core.sql
--   - private.rf_add_produced(text, numeric, boolean, bigint, bigint)  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.rf_save_molds(uuid, boolean, text, jsonb, bigint, bigint)  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint)  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint)  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.rf_save_ncrs(public.employees, text, boolean, boolean, jsonb, bigint, bigint)  จาก 20261108010000_rubberflow_shopfloor.sql
--   - private.bom_lock_rf()  จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.bom_rb_job_kg(public.bom_jobs, public.bom_items)  จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.bom_open_rf_orders(public.employees, text, uuid)  จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.bom_started_jobs(uuid)  จาก 20261108020000_bom_release_opens_rubberflow_orders.sql
--   - private.rf_save_materials(uuid, text, jsonb, bigint, bigint)  จาก 20261110010000_rf_purchase_orders.sql
--   - private.rf_check_po_receipt(uuid, jsonb, bigint)  จาก 20261110010000_rf_purchase_orders.sql
--   - private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint)  จาก 20261110010000_rf_purchase_orders.sql
--   - private.rf_delta(bigint)  จาก 20261110010000_rf_purchase_orders.sql
--   - private.bom_part_returned(text, text)  จาก 20261112010000_bom_part_returns.sql
--   - private.bom_stock_add_return(uuid, text, numeric, text, text)  จาก 20261112010000_bom_part_returns.sql
--   - private.rf_apply_feedback(text, public.rf_lots, public.rf_orders)  จาก 20261116010000_rf_bom_feedback_on_finishing.sql
--   - private.rf_save_transfers(public.employees, boolean, boolean, jsonb, bigint, bigint)  จาก 20261116010000_rf_bom_feedback_on_finishing.sql
--   - private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint)  จาก 20261116010000_rf_bom_feedback_on_finishing.sql
--   - private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint)  จาก 20261119010000_rf_purchase_by_st.sql
--   - private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint)  จาก 20261120010000_st_sets_safety_stock.sql
--   - private.bom_fg_pk_done(uuid, text)  จาก 20261121010000_bom_fg_receive_deliver.sql
--   - private.bom_delta(bigint)  จาก 20261121010000_bom_fg_receive_deliver.sql
--   - private.bom_fg_in(uuid, text)  จาก 20261123010000_bom_fg_stock.sql
--   - private.bom_fg_out(uuid, text)  จาก 20261123010000_bom_fg_stock.sql
--   - private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint)  จาก 20261123020000_bom_issue_parts_partial.sql
--   - private.bom_fg_move(public.employees, text, jsonb)  จาก 20261125010000_bom_close_rules.sql
--   - private.bom_fg_free(uuid, text)  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.bom_fg_stock(text)  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint)  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint)  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint)  จาก 20261128010000_bom_cancel_rf_stop.sql
--   - private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - private.bom_fg_total(uuid, text, text)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - private.bom_fg_return_stock(uuid, uuid)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - private.bom_fg_reverse(public.employees, jsonb)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - private.bom_records(bigint)  จาก 20261128020000_bom_po_partial_fg_reverse.sql
--   - private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint)  จาก 20261129010000_bom_group2_rules.sql
--   - private.rf_records(bigint)  จาก 20261129010000_bom_group2_rules.sql
--   - private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint)  จาก 20261129010000_bom_group2_rules.sql
--   - private.bom_cancel_rf_job(text, text)  จาก 20261129010000_bom_group2_rules.sql
--   - private.bom_cancel_rf_orders(uuid)  จาก 20261129010000_bom_group2_rules.sql
--   - private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint)  จาก 20261129010000_bom_group2_rules.sql
--   - private.bom_save_boms(uuid, text, jsonb, bigint, bigint)  จาก 20261129010000_bom_group2_rules.sql
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261129010000_bom_group2_rules.sql
--   ใหม่: private.bom_test_mode() (revoke all from public, anon, authenticated)
--   ตาราง: ไม่มี (ไม่แตะ RLS สิทธิ์ตาราง constraint หรือข้อมูล)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เปิดเมนู BOM / RubberFlow ให้พนักงานจริง จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของทุกฟังก์ชันที่ replace (70 ตัวข้างบน) ที่ production กับนิยามในไฟล์ต้นทาง แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (anon เรียก app_bom_* / app_rf_* ไม่ได้, private.* เรียกไม่ได้)
--   Pilot เก่า + ฐานข้อมูลใหม่: เมนูยังเปิดเฉพาะโหมดทดสอบ (พนักงานจริงไม่เห็น ไม่เรียก) โหมดทดสอบทำงานเหมือนเดิมทุกอย่าง → apply ก่อน merge ได้ปลอดภัย
--   Pilot ใหม่ + ฐานข้อมูลเก่า: พนักงานจริงเห็นเมนูแต่โหลดข้อมูลไม่ได้ (BOM_TEST_MODE_ONLY / RF_TEST_MODE_ONLY แสดงเป็นข้อความ "ใช้ได้เฉพาะผู้ดูแลระบบในโหมดทดสอบ")
--     ไม่มีอะไรถูกเขียน · โหมดทดสอบใช้ได้เหมือนเดิม
--
-- Rollback: create or replace ทุกฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่) แล้ว drop function private.bom_test_mode()
--   แถวจริง (is_test = false) ที่พนักงานสร้างระหว่างนั้นยังอยู่ในตาราง แต่ RPC เดิมมองไม่เห็นและพนักงานเรียกไม่ได้ (BOM_TEST_MODE_ONLY) · ลบแถวตัวนับโหมดจริงได้ด้วย
--   delete from public.bom_master_state where not is_test; delete from public.rf_master_state where not is_test; หลังลบแถวข้อมูลจริงที่สร้างแล้วเท่านั้น (สำรองก่อน)
-- ============================================================================

-- 1. โหมดของข้อมูลของผู้เรียก ---------------------------------------------------------------------------------------------------------
-- true = admin ที่ active สวม persona อยู่ (ข้อมูลทดสอบ) · false = พนักงานจริง / ไม่มี session · ค่าเดียวกับที่ private.sandbox_row_scope ตั้ง is_test ของแถวใหม่
create or replace function private.bom_test_mode()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.sandbox_persona()).id is not null
$$;
revoke all on function private.bom_test_mode() from public, anon, authenticated;
comment on function private.bom_test_mode() is
  'โหมดของข้อมูล BOM / RubberFlow ของผู้เรียก: true = admin ในโหมดทดสอบสวม persona (แถว is_test) · false = พนักงานจริง (แถวจริง)';

-- 2. ผู้ทำรายการ: persona ในโหมดทดสอบ ไม่เช่นนั้นพนักงานจริงที่ active ของ session ------------------------------------------------------
-- private.bom_actor() จาก 20261105010000_bom_master_data.sql
create or replace function private.bom_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- sandbox_persona ตรวจทุกครั้งว่ายังเป็น admin ที่ active และอยู่ในโหมดทดสอบจริง
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  -- นอกโหมดทดสอบ: พนักงานจริงของ session (persona ไม่มี auth_user_id อยู่แล้ว ตรวจซ้ำให้ชัด)
  select e.* into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.is_test = false
  limit 1;
  if v_actor.id is null then
    raise exception 'BOM_FORBIDDEN';
  end if;
  return v_actor;
end;
$$;

-- private.rf_actor() จาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  select e.* into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.is_test = false
  limit 1;
  if v_actor.id is null then
    raise exception 'RF_FORBIDDEN';
  end if;
  return v_actor;
end;
$$;

-- 3. ทุกฟังก์ชันที่กรอง is_test: นิยามล่าสุดบน main แทนเฉพาะ "<ตาราง>.is_test" → "<ตาราง>.is_test = (select private.bom_test_mode())",
--    "where is_test" (update / delete) แบบเดียวกัน, ค่าแรก true ของ insert ที่คอลัมน์แรกเป็น is_test, 'is_test', true ของ audit และตัวกรอง audit ->> 'is_test' = 'true'
--    เรียงตามไฟล์ต้นทางแล้วตามบรรทัด -----------------------------------------------------------------------------------------------

-- private.bom_parse_lines(text, text, jsonb) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_parse_lines(p_parent_code text, p_parent_dept text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_line jsonb;
  v_seen text[] := '{}';
  v_child public.bom_items%rowtype;
  v_code text;
  v_qty numeric;
  v_scrap numeric;
  v_step numeric;
  v_uom text;
  v_consumer text;
  v_producer text;
  v_flags jsonb;
  v_flag jsonb;
  v_entry jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'BOM_INVALID_LINE';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'BOM_INVALID_LINE'; end if;
    v_code := private.bom_code(private.bom_text(v_line, 'childCode', 60, 1, 'BOM_INVALID_LINE'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_LINE'; end if;
    v_seen := v_seen || v_code;
    select * into v_child from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_code;
    if not found then raise exception 'BOM_CHILD_NOT_FOUND'; end if;

    v_qty := private.bom_num(v_line -> 'qty', 'BOM_INVALID_LINE', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_LINE'; end if;
    v_scrap := coalesce(private.bom_num(v_line -> 'scrapPct', 'BOM_INVALID_LINE', 0, 1000), 0);
    v_step := private.bom_num(v_line -> 'step', 'BOM_INVALID_LINE', 1, 20);
    if v_step is not null and v_step <> trunc(v_step) then raise exception 'BOM_INVALID_LINE'; end if;

    v_uom := coalesce(nullif(private.bom_text(v_line, 'uom', 20, 0, 'BOM_INVALID_LINE'), ''), v_child.uom);
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_LINE'; end if;
    v_consumer := private.bom_dept(coalesce(nullif(private.bom_text(v_line, 'consumerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), p_parent_dept));
    v_producer := private.bom_dept(coalesce(nullif(private.bom_text(v_line, 'producerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), v_child.owner_dept));

    v_flags := v_line -> 'flags';
    if v_flags is null or jsonb_typeof(v_flags) = 'null' then v_flags := '[]'::jsonb; end if;
    if jsonb_typeof(v_flags) <> 'array' or jsonb_array_length(v_flags) > 20 then raise exception 'BOM_INVALID_LINE'; end if;
    for v_flag in select value from jsonb_array_elements(v_flags) loop
      if jsonb_typeof(v_flag) <> 'string' or char_length(v_flag #>> '{}') > 60 then raise exception 'BOM_INVALID_LINE'; end if;
    end loop;

    v_entry := jsonb_build_object(
      'childCode', v_code, 'qty', v_qty, 'uom', v_uom, 'consumerDept', v_consumer, 'producerDept', v_producer,
      'scrapPct', v_scrap, 'flags', v_flags, 'note', private.bom_text(v_line, 'note', 200, 0, 'BOM_INVALID_LINE'));
    if v_step is not null then
      v_entry := v_entry || jsonb_build_object('step', v_step::integer);
    end if;
    v_out := v_out || jsonb_build_array(v_entry);
  end loop;
  return v_out;
end;
$$;

-- private.bom_check_keyed(text, text, text, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_check_keyed(p_list text, p_key_base text, p_code text, p_base bigint, p_cur bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  if p_list = 'colorSets' then
    select s.changed_version into v_version from public.bom_color_sets s where s.is_test = (select private.bom_test_mode()) and s.base = p_key_base and s.code = p_code;
  else
    select p.changed_version into v_version from public.bom_packages p where p.is_test = (select private.bom_test_mode()) and p.base = p_key_base and p.code = p_code;
  end if;
  if found then
    if v_version > p_base and v_version <= p_cur then raise exception 'BOM_STALE'; end if;
    return;
  end if;
  if exists (
    select 1 from public.bom_deleted_keys k
    where k.is_test = (select private.bom_test_mode()) and k.list = p_list and k.base = p_key_base and k.code = p_code
      and k.changed_version > p_base and k.changed_version <= p_cur) then
    raise exception 'BOM_STALE';
  end if;
  delete from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = p_list and k.base = p_key_base and k.code = p_code;
end;
$$;

-- private.bom_save_colors(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_colors(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR'; end if;
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR'));
    if v_code !~ '^[A-Z]{2}[0-9]{2}$' or v_code = any (v_seen) then raise exception 'BOM_INVALID_COLOR'; end if;
    v_seen := v_seen || v_code;
    if exists (select 1 from public.bom_colors c where c.is_test = (select private.bom_test_mode()) and c.code = v_code
               and c.changed_version > p_base and c.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    insert into public.bom_colors (is_test, code, name)
    values ((select private.bom_test_mode()), v_code, private.bom_text(v_row, 'name', 60, 1, 'BOM_INVALID_COLOR'))
    on conflict (code, is_test) do update set name = excluded.name, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_save_processes(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_processes(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PROCESS'; end if;
    v_code := private.bom_text(v_row, 'code', 60, 1, 'BOM_INVALID_PROCESS');
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_PROCESS'; end if;
    v_seen := v_seen || v_code;
    if exists (select 1 from public.bom_processes p where p.is_test = (select private.bom_test_mode()) and p.code = v_code
               and p.changed_version > p_base and p.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    insert into public.bom_processes (is_test, code, name, dept)
    values ((select private.bom_test_mode()), v_code, private.bom_text(v_row, 'name', 80, 1, 'BOM_INVALID_PROCESS'),
            private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT')))
    on conflict (code, is_test) do update set name = excluded.name, dept = excluded.dept, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_save_items(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_items(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_codes text[] := '{}';
  v_code text;
  v_kind text;
  v_name text;
  v_dept text;
  v_uom text;
  v_weight numeric;
  v_node jsonb;
  v_rubber jsonb;
  v_key text;
  v_val jsonb;
  v_legacy jsonb;
  v_entry jsonb;
  v_active boolean;
  v_group text;
  v_cost numeric;
  v_image text;
  v_image_total integer := 0;
  v_old_kind text;
  v_old_version bigint;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ITEM'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'code', 60, 1, 'BOM_INVALID_ITEM'));
    if v_code = any (v_codes) then raise exception 'BOM_INVALID_ITEM'; end if;
    v_codes := v_codes || v_code;
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_ITEM');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_ITEM'; end if;
    -- รหัสสูตรยางต้องไม่เกิน 20 ตัวอักษร (ช่องสูตรของเส้นยางเก็บได้เท่านี้)
    if v_kind = 'CP' and char_length(v_code) > 20 then raise exception 'BOM_INVALID_ITEM'; end if;
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_ITEM');
    v_dept := private.bom_dept(private.bom_text(v_row, 'ownerDept', 10, 1, 'BOM_INVALID_DEPT'));
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_ITEM');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_ITEM'; end if;
    v_weight := coalesce(private.bom_num(v_row -> 'weightG', 'BOM_INVALID_ITEM', 0, 1000000000), 0);

    -- ข้อมูลยาง: เฉพาะ RB/SE คีย์ที่รู้จักเท่านั้น ค่า null ถูกตัดทิ้ง
    v_node := v_row -> 'rubber';
    v_rubber := null;
    if v_node is not null and jsonb_typeof(v_node) <> 'null' then
      if jsonb_typeof(v_node) <> 'object' or v_kind not in ('RB', 'SE') then raise exception 'BOM_INVALID_RUBBER'; end if;
      v_rubber := '{}'::jsonb;
      for v_key, v_val in select key, value from jsonb_each(v_node) loop
        if jsonb_typeof(v_val) = 'null' then continue; end if;
        if v_key in ('compound', 'type', 'color', 'product') then
          if jsonb_typeof(v_val) <> 'string' or char_length(v_val #>> '{}') > 60 then raise exception 'BOM_INVALID_RUBBER'; end if;
        elsif v_key in ('lengthMm', 'holeMm', 'odMm', 'kgPerRoll', 'cutLengthCm', 'pcsPerRoll', 'sePerGr') then
          perform private.bom_num(v_val, 'BOM_INVALID_RUBBER', 0, 1000000000);
        else
          raise exception 'BOM_INVALID_RUBBER';
        end if;
        v_rubber := v_rubber || jsonb_build_object(v_key, v_val);
      end loop;
    end if;

    v_legacy := v_row -> 'legacyCodes';
    if v_legacy is null or jsonb_typeof(v_legacy) = 'null' then v_legacy := '[]'::jsonb; end if;
    if jsonb_typeof(v_legacy) <> 'array' or jsonb_array_length(v_legacy) > 200 then raise exception 'BOM_INVALID_ITEM'; end if;
    for v_entry in select value from jsonb_array_elements(v_legacy) loop
      if jsonb_typeof(v_entry) <> 'string' or char_length(v_entry #>> '{}') not between 1 and 200 then raise exception 'BOM_INVALID_ITEM'; end if;
    end loop;

    v_node := v_row -> 'active';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_active := true;
    elsif jsonb_typeof(v_node) <> 'boolean' then
      raise exception 'BOM_INVALID_ITEM';
    else
      v_active := (v_node #>> '{}')::boolean;
    end if;
    v_group := coalesce(nullif(private.bom_text(v_row, 'group', 20, 0, 'BOM_INVALID_ITEM'), ''), 'TOY');
    v_cost := private.bom_num(v_row -> 'unitCost', 'BOM_INVALID_ITEM', 0, 1000000000);

    -- รูป: data URL PNG/JPEG/WebP ไม่เกิน 80,000 ตัวอักษร (เพดานรวมต่อคำสั่ง)
    v_node := v_row -> 'image';
    v_image := null;
    if v_node is not null and jsonb_typeof(v_node) <> 'null' then
      if jsonb_typeof(v_node) <> 'string' then raise exception 'BOM_INVALID_IMAGE'; end if;
      v_image := nullif(btrim(v_node #>> '{}'), '');
    end if;
    if v_image is not null then
      if char_length(v_image) > 80000 or v_image !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' then
        raise exception 'BOM_INVALID_IMAGE';
      end if;
      v_image_total := v_image_total + char_length(v_image);
      if v_image_total > 4000000 then raise exception 'BOM_TOO_LARGE'; end if;
    end if;

    -- ชิ้นที่มี BOM แล้วเปลี่ยนชนิดไม่ได้ (rules: เปลี่ยนชนิดของชิ้นที่มี BOM แล้วไม่ได้)
    select i.kind, i.changed_version into v_old_kind, v_old_version from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_code;
    -- มีคนอื่นแก้ชิ้นนี้หลังเวอร์ชันฐานของ client (หรือสร้างรหัสนี้ไปก่อนแล้ว)
    if found and v_old_version > p_base and v_old_version <= p_cur then raise exception 'BOM_STALE'; end if;
    if found and v_old_kind <> v_kind and exists (
      select 1 from public.bom_boms b where b.is_test = (select private.bom_test_mode()) and b.item_code = v_code and b.status = 'approved') then
      raise exception 'BOM_ITEM_KIND_LOCKED';
    end if;

    insert into public.bom_items (
      is_test, code, kind, name, owner_dept, uom, weight_g, rubber, legacy_codes, active, item_group, unit_cost, image,
      imported_from, cloned_from, created_by, updated_by)
    values (
      (select private.bom_test_mode()), v_code, v_kind, v_name, v_dept, v_uom, v_weight, v_rubber, v_legacy, v_active, v_group, v_cost, v_image,
      nullif(private.bom_text(v_row, 'importedFrom', 200, 0, 'BOM_INVALID_ITEM'), ''),
      nullif(private.bom_text(v_row, 'clonedFrom', 200, 0, 'BOM_INVALID_ITEM'), ''),
      p_actor, p_actor)
    on conflict (code, is_test) do update set
      kind = excluded.kind, name = excluded.name, owner_dept = excluded.owner_dept, uom = excluded.uom,
      weight_g = excluded.weight_g, rubber = excluded.rubber, legacy_codes = excluded.legacy_codes,
      active = excluded.active, item_group = excluded.item_group, unit_cost = excluded.unit_cost,
      image = excluded.image, imported_from = excluded.imported_from, cloned_from = excluded.cloned_from,
      updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return v_codes;
end;
$$;

-- private.bom_save_color_sets(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_color_sets(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_slot jsonb;
  v_slots jsonb;
  v_clean jsonb;
  v_key text;
  v_color text;
  v_base text;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
    v_base := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
    if v_code !~ '^[A-Z]$' or (v_base || '|' || v_code) = any (v_seen) then raise exception 'BOM_INVALID_COLOR_SET'; end if;
    v_seen := v_seen || (v_base || '|' || v_code);
    v_slots := v_row -> 'slots';
    if v_slots is null or jsonb_typeof(v_slots) <> 'array' or jsonb_array_length(v_slots) not between 1 and 50 then
      raise exception 'BOM_INVALID_COLOR_SET';
    end if;
    v_clean := '[]'::jsonb;
    for v_slot in select value from jsonb_array_elements(v_slots) loop
      if jsonb_typeof(v_slot) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_key := upper(private.bom_text(v_slot, 'key', 100, 1, 'BOM_INVALID_COLOR_SET'));
      v_color := upper(private.bom_text(v_slot, 'color', 4, 0, 'BOM_INVALID_COLOR_SET'));
      if v_key !~ '^(SE|RB)-[A-Z0-9-]+-\*-' or (v_color <> '' and v_color !~ '^[A-Z]{2}[0-9]{2}$') then
        raise exception 'BOM_INVALID_COLOR_SET';
      end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('key', v_key, 'color', v_color));
    end loop;
    perform private.bom_check_keyed('colorSets', v_base, v_code, p_base, p_cur);
    insert into public.bom_color_sets (is_test, base, code, name, note, slots, created_by, updated_by)
    values ((select private.bom_test_mode()), v_base, v_code, private.bom_text(v_row, 'name', 60, 0, 'BOM_INVALID_COLOR_SET'),
            private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_COLOR_SET'), v_clean, p_actor, p_actor)
    on conflict (base, code, is_test) do update set
      name = excluded.name, note = excluded.note, slots = excluded.slots, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_save_packages(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_packages(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_line jsonb;
  v_lines jsonb;
  v_clean jsonb;
  v_child text;
  v_qty numeric;
  v_kind text;
  v_base text;
  v_code text;
  v_seen text[] := '{}';
  v_children text[];
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
    v_base := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
    if v_code !~ '^[A-Z0-9-]{1,4}$' or (v_base || '|' || v_code) = any (v_seen) then raise exception 'BOM_INVALID_PACKAGE'; end if;
    v_seen := v_seen || (v_base || '|' || v_code);
    v_lines := v_row -> 'lines';
    if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 100 then
      raise exception 'BOM_INVALID_PACKAGE';
    end if;
    v_clean := '[]'::jsonb;
    v_children := '{}';
    for v_line in select value from jsonb_array_elements(v_lines) loop
      if jsonb_typeof(v_line) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_child := private.bom_code(private.bom_text(v_line, 'childCode', 60, 1, 'BOM_INVALID_PACKAGE'));
      if v_child = any (v_children) then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_children := v_children || v_child;
      select i.kind into v_kind from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_child;
      if not found then raise exception 'BOM_CHILD_NOT_FOUND'; end if;
      -- บรรจุภัณฑ์เป็นของซื้อ/คลังเท่านั้น
      if v_kind <> 'PURCHASED' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_qty := private.bom_num(v_line -> 'qty', 'BOM_INVALID_PACKAGE', 0, 1000000000);
      if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('childCode', v_child, 'qty', v_qty));
    end loop;
    perform private.bom_check_keyed('packages', v_base, v_code, p_base, p_cur);
    insert into public.bom_packages (is_test, base, code, name, lines, created_by, updated_by)
    values ((select private.bom_test_mode()), v_base, v_code, private.bom_text(v_row, 'name', 60, 0, 'BOM_INVALID_PACKAGE'), v_clean, p_actor, p_actor)
    on conflict (base, code, is_test) do update set
      name = excluded.name, lines = excluded.lines, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_save_routings(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function private.bom_save_routings(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_item_code text;
  v_kind text;
  v_rev numeric;
  v_status text;
  v_steps jsonb;
  v_old public.bom_routings%rowtype;
  v_max integer;
  v_changed boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_id := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ROUTING');
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' or v_id = any (v_seen) then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_seen := v_seen || v_id;
    v_item_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_ROUTING'));
    select i.kind into v_kind from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_item_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    -- ของซื้อและสูตรยางไม่มีขั้นตอนผลิต
    if v_kind in ('PURCHASED', 'CP') then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'BOM_INVALID_ROUTING', 1, 100000);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ROUTING');
    if v_status not in ('approved', 'superseded') then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_steps := private.bom_parse_steps(v_row -> 'steps');

    select * into v_old from public.bom_routings r where r.is_test = (select private.bom_test_mode()) and r.routing_id = v_id;
    if found then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
      if v_old.item_code <> v_item_code or v_old.revision <> v_rev::integer or v_old.steps <> v_steps then
        raise exception 'BOM_REVISION_IMMUTABLE';
      end if;
      if v_old.status = 'superseded' and v_status = 'approved' then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      update public.bom_routings set
        status = v_status,
        superseded_at = case when v_old.status = 'approved' and v_status = 'superseded' then now() else v_old.superseded_at end
      where id = v_old.id;
    else
      if v_status <> 'approved' then raise exception 'BOM_INVALID_ROUTING'; end if;
      select coalesce(max(r.revision), 0), coalesce(bool_or(r.changed_version > p_base and r.changed_version <= p_cur), false)
      into v_max, v_changed from public.bom_routings r where r.is_test = (select private.bom_test_mode()) and r.item_code = v_item_code;
      if v_changed then raise exception 'BOM_STALE'; end if;
      if v_rev::integer <> v_max + 1 then raise exception 'BOM_REVISION_ORDER'; end if;
      update public.bom_routings set status = 'superseded', superseded_at = now()
      where is_test = (select private.bom_test_mode()) and item_code = v_item_code and status = 'approved';
      insert into public.bom_routings (is_test, routing_id, item_code, revision, status, steps, created_by)
      values ((select private.bom_test_mode()), v_id, v_item_code, v_rev::integer, 'approved', v_steps, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;

-- public.app_bom_master_since(bigint) · นิยามล่าสุดจาก 20261105010000_bom_master_data.sql
create or replace function public.app_bom_master_since(p_version bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.bom_actor();
  if p_version is null or p_version < 0
     or p_version > coalesce((select s.version from public.bom_master_state s where s.is_test = (select private.bom_test_mode())), 0) then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;
  return private.bom_delta(p_version);
end;
$$;

-- private.bom_delete_order_jobs(uuid) · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function private.bom_delete_order_jobs(p_order uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  with d as (delete from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.order_pk = p_order returning j.job_no)
  insert into public.bom_deleted_keys (is_test, list, base, code)
  select (select private.bom_test_mode()), 'jobs', '', d.job_no from d
  on conflict (list, base, code, is_test) do update set deleted_at = now();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- private.bom_parse_order_items(jsonb) · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function private.bom_parse_order_items(p_node jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_qty numeric;
  v_kind text;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) > 500 then
    raise exception 'BOM_INVALID_ORDER';
  end if;
  for v_item in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_item) <> 'object' then raise exception 'BOM_INVALID_ORDER'; end if;
    v_code := private.bom_code(private.bom_text(v_item, 'fgCode', 60, 1, 'BOM_INVALID_ORDER'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_ORDER'; end if;
    v_seen := v_seen || v_code;
    v_qty := private.bom_num(v_item -> 'qty', 'BOM_INVALID_ORDER', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_ORDER'; end if;
    select i.kind into v_kind from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    if v_kind <> 'FG' then raise exception 'BOM_INVALID_ITEM'; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'fgCode', v_code, 'qty', v_qty,
      'colorSet', private.bom_text(v_item, 'colorSet', 10, 0, 'BOM_INVALID_ORDER'),
      'note', private.bom_text(v_item, 'note', 120, 0, 'BOM_INVALID_ORDER')));
  end loop;
  return v_out;
end;
$$;

-- private.bom_save_customers(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function private.bom_save_customers(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_name text;
  v_key text;
  v_country text;
  v_type text;
  v_note text;
  v_seen text[] := '{}';
  v_old public.bom_customers%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_name := btrim(regexp_replace(private.bom_text(v_row, 'name', 120, 1, 'BOM_INVALID_CUSTOMER'), '\s+', ' ', 'g'));
    v_key := lower(v_name);
    if v_key = any (v_seen) then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_seen := v_seen || v_key;
    v_country := private.bom_text(v_row, 'country', 60, 0, 'BOM_INVALID_CUSTOMER');
    v_type := upper(private.bom_text(v_row, 'orderType', 2, 0, 'BOM_INVALID_CUSTOMER'));
    if v_type not in ('', 'SA', 'EX') then raise exception 'BOM_INVALID_CUSTOMER'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_CUSTOMER');

    select * into v_old from public.bom_customers c where c.is_test = (select private.bom_test_mode()) and lower(c.name) = v_key;
    if found then
      if v_old.name = v_name and v_old.country = v_country and v_old.order_type is not distinct from nullif(v_type, '') and v_old.note = v_note then
        continue;
      end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
      update public.bom_customers set
        name = v_name, country = v_country, order_type = nullif(v_type, ''), note = v_note, updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      insert into public.bom_customers (is_test, name, country, order_type, note, created_by, updated_by)
      values ((select private.bom_test_mode()), v_name, v_country, nullif(v_type, ''), v_note, p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_delete_jobs(boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function private.bom_delete_jobs(p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_no text;
  v_job public.bom_jobs%rowtype;
  v_n integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if not p_planner then raise exception 'BOM_FORBIDDEN'; end if;
    if jsonb_typeof(v_row) = 'string' then
      v_no := btrim(v_row #>> '{}');
    elsif jsonb_typeof(v_row) = 'object' then
      v_no := coalesce(nullif(private.bom_text(v_row, 'id', 40, 0, 'BOM_INVALID_JOB'), ''), private.bom_text(v_row, 'code', 40, 0, 'BOM_INVALID_JOB'));
    else
      raise exception 'BOM_INVALID_JOB';
    end if;
    if v_no is null or v_no !~ '^[A-Za-z0-9._-]{1,40}$' then raise exception 'BOM_INVALID_JOB'; end if;
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no;
    if not found then
      -- ถูกลบในคำสั่งเดียวกัน (changed_version > p_cur) = ข้าม · ถูกคนอื่นลบหลังเวอร์ชันฐาน = BOM_STALE · ไม่เคยมี = BOM_NOT_FOUND
      if exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no and k.changed_version > p_cur) then
        continue;
      end if;
      if exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no
                 and k.changed_version > p_base and k.changed_version <= p_cur) then
        raise exception 'BOM_STALE';
      end if;
      raise exception 'BOM_NOT_FOUND';
    end if;
    if v_job.changed_version > p_base and v_job.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    if v_job.status <> 'queued' or v_job.qty_done > 0 or v_job.qty_reject > 0 or jsonb_array_length(v_job.reports) > 0 or v_job.external_ref is not null then
      raise exception 'BOM_INVALID_TRANSITION';
    end if;
    delete from public.bom_jobs where id = v_job.id;
    insert into public.bom_deleted_keys (is_test, list, base, code) values ((select private.bom_test_mode()), 'jobs', '', v_no)
    on conflict (list, base, code, is_test) do update set deleted_at = now();
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- private.bom_snapshot() · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function private.bom_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', coalesce((select s.version from public.bom_master_state s where s.is_test = (select private.bom_test_mode())), 0),
                            'epoch', (select s.epoch from public.bom_master_state s where s.is_test = (select private.bom_test_mode())))
         || private.bom_records(-1)
$$;

-- public.app_bom_audit(integer) · นิยามล่าสุดจาก 20261106010000_bom_orders_jobs.sql
create or replace function public.app_bom_audit(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  perform private.lab_only_block();
  perform private.bom_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', t.at, 'user', t.usr, 'action', t.action, 'detail', t.detail, 'entries', t.entries) order by t.id desc)
    from (
      select a.id, private.bom_ms(a.created_at) as at,
             coalesce(a.metadata ->> 'persona_name', a.metadata ->> 'persona_employee_no', '') as usr,
             case when a.action = 'BOM_SANDBOX_PURGE' then 'ล้างข้อมูล BOM ทดสอบ' else coalesce(a.metadata ->> 'client_action', a.action) end as action,
             case when a.action = 'BOM_SANDBOX_PURGE' then 'ลบ ' || coalesce(a.metadata ->> 'deleted', '0') || ' แถว'
                  else coalesce((
                    select string_agg(c.key || coalesce(' +' || nullif(c.value ->> 'upsert', '0'), '') || coalesce(' -' || nullif(c.value ->> 'delete', '0'), ''), ', ' order by c.key)
                    from jsonb_each(case when jsonb_typeof(a.metadata -> 'counts') = 'object' then a.metadata -> 'counts' else '{}'::jsonb end) c
                    where jsonb_typeof(c.value) = 'object'
                      and (coalesce(c.value ->> 'upsert', '0') <> '0' or coalesce(c.value ->> 'delete', '0') <> '0')), '') end as detail,
             case when a.action = 'BOM_MASTER_SAVE' and jsonb_typeof(a.metadata -> 'entries') = 'array' then a.metadata -> 'entries' else '[]'::jsonb end as entries
      from public.audit_logs a
      where a.action in ('BOM_MASTER_SAVE', 'BOM_SANDBOX_PURGE') and a.metadata ->> 'is_test' = (select private.bom_test_mode())::text
      order by a.id desc
      limit v_limit
    ) t), '[]'::jsonb);
end;
$$;

-- private.rf_lock_bom() · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_lock_bom()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  insert into public.bom_master_state (is_test) values ((select private.bom_test_mode())) on conflict (is_test) do nothing;
  select s.version into v_version from public.bom_master_state s where s.is_test = (select private.bom_test_mode()) for update;
  return v_version;
end;
$$;

-- private.rf_parse_items(jsonb, jsonb) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_parse_items(p_node jsonb, p_prev jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_el jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_phr numeric;
  v_stage numeric;
  v_active boolean;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) not between 1 and 100 then
    raise exception 'RF_INVALID_RECIPE';
  end if;
  for v_el in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_code := private.bom_text(v_el, 'materialCode', 40, 1, 'RF_INVALID_RECIPE');
    if v_code = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || v_code;
    v_phr := private.bom_num(v_el -> 'phr', 'RF_INVALID_RECIPE', 0, 100000);
    if v_phr is null or v_phr <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
    v_stage := coalesce(private.bom_num(v_el -> 'stage', 'RF_INVALID_RECIPE', 1, 2), 1);
    if v_stage <> trunc(v_stage) then raise exception 'RF_INVALID_RECIPE'; end if;
    select m.active into v_active from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.code = v_code;
    if not found then raise exception 'RF_INVALID_RECIPE'; end if;
    if not v_active and not exists (
         select 1 from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) e where e ->> 'materialCode' = v_code) then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('materialCode', v_code, 'phr', v_phr, 'stage', v_stage::integer));
  end loop;
  return v_out;
end;
$$;

-- private.rf_job_for_link(text) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_job_for_link(p_job_no text)
returns public.bom_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
begin
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_job_no for update;
  if not found or v_job.dept <> 'RB' or v_job.status = 'done' then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  -- ผูกแล้วผูกซ้ำไม่ได้ เว้นแต่ WO เดิมถูกยกเลิก (ปกติยกเลิก WO ล้าง external_ref เองแล้ว กรณีนี้รับข้อมูลค้างจากก่อนหน้า)
  if v_job.external_ref is not null and not exists (
       select 1 from public.rf_orders o
       where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_job.external_ref ->> 'woId' and o.status = 'cancelled') then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk;
  if not found or v_ord.status not in ('released', 'in_progress') then
    raise exception 'RF_INVALID_SOURCE_JOB';
  end if;
  return v_job;
end;
$$;

-- private.rf_unlink_job(text, public.rf_orders) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_unlink_job(p_actor_name text, p_wo public.rf_orders)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_ord public.bom_orders%rowtype;
begin
  perform private.rf_lock_bom();
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_wo.source_job_no for update;
  if not found or (v_job.external_ref ->> 'woId') is distinct from p_wo.wo_no then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  -- ใบ PI ที่ปิด/ยกเลิกแล้ว หรืองานที่ done แล้ว ไม่ถูกแตะ (เงื่อนไขเดียวกับ rf_apply_feedback)
  select * into v_ord from public.bom_orders o where o.id = v_job.order_pk for update;
  if v_ord.status not in ('released', 'in_progress') or v_job.status = 'done' then
    return jsonb_build_object('jobs', 0, 'orders', 0);
  end if;
  update public.bom_jobs set
    external_ref = null,
    reports = v_job.reports || jsonb_build_array(jsonb_build_object(
      'at', private.bom_ms(now()), 'by', p_actor_name, 'good', 0, 'reject', 0, 'note', left('WO ' || p_wo.wo_no || ' ถูกยกเลิก', 200))),
    updated_at = now()
  where id = v_job.id;
  return jsonb_build_object('jobs', 1, 'orders', 0);
end;
$$;

-- private.rf_snapshot() · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.rf_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('version', coalesce((select s.version from public.rf_master_state s where s.is_test = (select private.bom_test_mode())), 0),
                            'epoch', (select s.epoch from public.rf_master_state s where s.is_test = (select private.bom_test_mode())))
         || private.rf_records(-1)
$$;

-- public.app_rf_master_since(bigint) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function public.app_rf_master_since(p_version bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.rf_actor();
  if p_version is null or p_version < 0
     or p_version > coalesce((select s.version from public.rf_master_state s where s.is_test = (select private.bom_test_mode())), 0) then
    raise exception 'RF_INVALID_PAYLOAD';
  end if;
  return private.rf_delta(p_version);
end;
$$;

-- public.app_rf_audit(integer) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function public.app_rf_audit(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 1000);
begin
  perform private.lab_only_block();
  perform private.rf_actor();
  return coalesce((
    select jsonb_agg(jsonb_build_object('at', t.at, 'user', t.usr, 'action', t.action, 'detail', t.detail, 'entries', t.entries) order by t.id desc)
    from (
      select a.id, private.bom_ms(a.created_at) as at,
             coalesce(a.metadata ->> 'persona_name', a.metadata ->> 'persona_employee_no', '') as usr,
             case when a.action = 'RF_SANDBOX_PURGE' then 'ล้างข้อมูล RubberFlow ทดสอบ' else coalesce(a.metadata ->> 'client_action', a.action) end as action,
             case when a.action = 'RF_SANDBOX_PURGE' then 'ลบ ' || coalesce(a.metadata ->> 'deleted', '0') || ' แถว'
                  else coalesce((
                    select string_agg(c.key || coalesce(' +' || nullif(c.value ->> 'upsert', '0'), ''), ', ' order by c.key)
                    from jsonb_each(case when jsonb_typeof(a.metadata -> 'counts') = 'object' then a.metadata -> 'counts' else '{}'::jsonb end) c
                    where jsonb_typeof(c.value) = 'object' and coalesce(c.value ->> 'upsert', '0') <> '0'), '') end as detail,
             case when a.action = 'RF_SAVE' and jsonb_typeof(a.metadata -> 'entries') = 'array' then a.metadata -> 'entries' else '[]'::jsonb end as entries
      from public.audit_logs a
      where a.action in ('RF_SAVE', 'RF_SANDBOX_PURGE') and a.metadata ->> 'is_test' = (select private.bom_test_mode())::text
      order by a.id desc
      limit v_limit
    ) t), '[]'::jsonb);
end;
$$;

-- private.bom_save_compounds(uuid, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261107010000_rubberflow_core.sql
create or replace function private.bom_save_compounds(p_actor uuid, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_recipe text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_code := upper(private.bom_text(v_row, 'code', 20, 1, 'BOM_INVALID_COMPOUND'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_seen := v_seen || v_code;
    if exists (select 1 from public.bom_compounds c where c.is_test = (select private.bom_test_mode()) and c.code = v_code
               and c.changed_version > p_base and c.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    v_recipe := nullif(private.bom_text(v_row, 'recipeId', 60, 0, 'BOM_INVALID_COMPOUND'), '');
    if v_recipe is not null
       and (select c.recipe_id from public.bom_compounds c where c.is_test = (select private.bom_test_mode()) and c.code = v_code) is distinct from v_recipe
       and not exists (select 1 from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_recipe) then
      raise exception 'BOM_INVALID_COMPOUND';
    end if;
    insert into public.bom_compounds (is_test, code, name, recipe_id, recipe_name)
    values ((select private.bom_test_mode()), v_code,
            coalesce(nullif(private.bom_text(v_row, 'name', 120, 0, 'BOM_INVALID_COMPOUND'), ''), v_code),
            v_recipe,
            nullif(private.bom_text(v_row, 'recipeName', 120, 0, 'BOM_INVALID_COMPOUND'), ''))
    on conflict (code, is_test) do update set
      name = excluded.name, recipe_id = excluded.recipe_id, recipe_name = excluded.recipe_name, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_add_produced(text, numeric, boolean, bigint, bigint) · นิยามล่าสุดจาก 20261108010000_rubberflow_shopfloor.sql
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
  select * into v_ord from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = p_order for update;
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

-- private.rf_save_molds(uuid, boolean, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261108010000_rubberflow_shopfloor.sql
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
    v_name := private.bom_text(v_row, 'name', 120, 1, 'RF_INVALID_MOLD');
    v_kind := coalesce(nullif(private.bom_text(v_row, 'kind', 10, 0, 'RF_INVALID_MOLD'), ''), 'mold');
    if v_kind not in ('die', 'line', 'mold') then raise exception 'RF_INVALID_MOLD'; end if;
    v_unit := coalesce(nullif(private.bom_text(v_row, 'unit', 20, 0, 'RF_INVALID_MOLD'), ''), 'shot');
    v_per := coalesce(private.bom_num(v_row -> 'perCycle', 'RF_INVALID_MOLD', 0, 1000000), 1);
    v_every := private.bom_num(v_row -> 'cleanEvery', 'RF_INVALID_MOLD', 0, 1000000000);
    v_pm := coalesce(private.bom_num(v_row -> 'pmLimit', 'RF_INVALID_MOLD', 0, 1000000000), 0);
    v_since := coalesce(private.bom_num(v_row -> 'usageSinceClean', 'RF_INVALID_MOLD', 0, 1000000000), 0);
    v_clean_ms := private.bom_num(v_row -> 'lastCleanAt', 'RF_INVALID_MOLD', 0, 100000000000000);
    if v_per <= 0 or v_every is null or v_every <= 0 then raise exception 'RF_INVALID_MOLD'; end if;

    select * into v_old from public.rf_molds m where m.is_test = (select private.bom_test_mode()) and m.mold_no = v_id;
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
      -- แม่พิมพ์ใหม่: ยอดใช้งานเริ่มที่ 0 และเวลาล้างล่าสุดเป็นเวลาเซิร์ฟเวอร์ (ค่า totalUsage / usageSinceClean / lastCleanAt จาก client เมิน)
      values ((select private.bom_test_mode()), v_id, v_name, v_kind, v_unit, v_per, v_every, v_pm, 0, 0, now(), p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_save_orders(public.employees, text, boolean, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261108010000_rubberflow_shopfloor.sql
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

    select * into v_old from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_wo;
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
      select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode and r.status = 'approved';
    else
      select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode and r.revision = v_rrev::integer;
    end if;
    if not found or v_rec.status <> 'approved' then
      if exists (select 1 from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_rcode
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
      (select private.bom_test_mode()), v_wo, v_customer, v_po, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_uom, v_color,
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

-- private.rf_save_boxes(uuid, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261108010000_rubberflow_shopfloor.sql
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

    select * into v_old from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.box_no = v_no;
    if not found then
      -- กล่องเกิดจากล็อตตกแต่งที่เพิ่งบันทึกในคำสั่งเดียวกันเท่านั้น (เซิร์ฟเวอร์สร้างไว้แล้ว) นอกนั้นสร้างเองไม่ได้
      v_lot := private.bom_text(v_row, 'lotId', 60, 0, 'RF_INVALID_BOX');
      if v_lot <> '' and exists (select 1 from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_lot and l.stage = 'finishing' and l.changed_version > p_cur) then
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

-- private.rf_save_ncrs(public.employees, text, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261108010000_rubberflow_shopfloor.sql
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

    select * into v_old from public.rf_ncrs n where n.is_test = (select private.bom_test_mode()) and n.ncr_no = v_no;
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
    values ((select private.bom_test_mode()), v_no, v_title, v_stage, v_lot, v_sev, v_defect, v_whys, v_contain, v_corr, v_prev,
            coalesce(nullif(v_owner, ''), p_actor_name), 'open', p_actor.id);
    update public.rf_lots set qc = 'hold', hold_reasons = hold_reasons || to_jsonb('เปิด ' || v_no), updated_at = now()
    where is_test = (select private.bom_test_mode()) and lot_no = v_lot and qc = 'pass';
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_lock_rf() · นิยามล่าสุดจาก 20261108020000_bom_release_opens_rubberflow_orders.sql
create or replace function private.bom_lock_rf()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version bigint;
begin
  insert into public.rf_master_state (is_test) values ((select private.bom_test_mode())) on conflict (is_test) do nothing;
  select s.version into v_version from public.rf_master_state s where s.is_test = (select private.bom_test_mode()) for update;
  return v_version;
end;
$$;

-- private.bom_rb_job_kg(public.bom_jobs, public.bom_items) · นิยามล่าสุดจาก 20261108020000_bom_release_opens_rubberflow_orders.sql
create or replace function private.bom_rb_job_kg(p_job public.bom_jobs, p_item public.bom_items)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_qty numeric := greatest(0, p_job.qty_planned - p_job.qty_done);
  v_line public.bom_bom_lines%rowtype;
  v_roll numeric;
  v_kg numeric := 0;
begin
  if p_item.code is null then return 0; end if;
  select l.* into v_line
  from public.bom_bom_lines l
  join public.bom_boms b on b.id = l.bom_pk
  where b.is_test = (select private.bom_test_mode()) and b.status = 'approved' and b.item_code = p_item.code
  order by l.line_no
  limit 1;
  if found and v_line.uom in ('kg', 'g') and v_line.qty > 0 then
    return round(v_qty * v_line.qty * (case when v_line.uom = 'kg' then 1 else 0.001 end) * (1 + v_line.scrap_pct / 100), 2);
  end if;
  if p_item.uom = 'kg' then
    v_kg := v_qty;
  else
    v_roll := case when jsonb_typeof(p_item.rubber -> 'kgPerRoll') = 'number' then (p_item.rubber ->> 'kgPerRoll')::numeric else 0 end;
    if v_roll > 0 then
      v_kg := v_qty * v_roll;
    elsif p_item.weight_g > 0 then
      v_kg := v_qty * p_item.weight_g / 1000;
    end if;
  end if;
  return round(v_kg * 1.05, 2);
end;
$$;

-- private.bom_open_rf_orders(public.employees, text, uuid) · นิยามล่าสุดจาก 20261108020000_bom_release_opens_rubberflow_orders.sql
create or replace function private.bom_open_rf_orders(p_actor public.employees, p_actor_name text, p_order_pk uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ord public.bom_orders%rowtype;
  v_job public.bom_jobs%rowtype;
  v_item public.bom_items%rowtype;
  v_rec public.rf_recipes%rowtype;
  v_compound text;
  v_recipe_code text;
  v_reason text;
  v_qty numeric;
  v_kg numeric;
  v_wo text;
  v_seq numeric := 0;
  v_locked boolean := false;
  v_stamp text := to_char(now() at time zone 'Asia/Bangkok', 'YYYYMMDD');
  v_today bigint := private.bom_ms((date_trunc('day', now() at time zone 'Asia/Bangkok')) at time zone 'Asia/Bangkok');
  v_now bigint := private.bom_ms(now());
  v_opened jsonb := '[]'::jsonb;
  v_skipped jsonb := '[]'::jsonb;
begin
  select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.id = p_order_pk;
  if not found then return jsonb_build_object('opened', v_opened, 'skipped', v_skipped); end if;

  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test = (select private.bom_test_mode()) and j.order_pk = p_order_pk and j.dept = 'RB' and j.external_ref is null
    order by j.job_no collate "C"
    for update
  loop
    v_reason := null;
    v_rec := null;
    select * into v_item from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_job.item_code;
    v_compound := nullif(v_item.rubber ->> 'compound', '');
    if v_compound is null then
      v_reason := 'ไม่มีรหัสสูตรยาง';
    else
      select c.recipe_id into v_recipe_code from public.bom_compounds c where c.is_test = (select private.bom_test_mode()) and c.code = v_compound;
      if v_recipe_code is null then
        v_reason := 'ยังไม่ผูกสูตร RubberFlow';
      else
        select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_recipe_code and r.status = 'approved';
        if not found then v_reason := 'สูตร ' || v_recipe_code || ' ยังไม่อนุมัติ'; end if;
      end if;
    end if;
    v_qty := greatest(0, v_job.qty_planned - v_job.qty_done);
    if v_reason is null and v_qty <= 0 then v_reason := 'ไม่มียอดให้ผลิต'; end if;
    if v_reason is null then
      v_kg := private.bom_rb_job_kg(v_job, v_item);
      -- เพดานเท่าคอลัมน์ target_kg และ kg_per_unit: เกินแล้วข้าม ไม่ปล่อยให้ constraint ทำการปล่อยผลิตล้ม
      if v_kg is null or v_kg <= 0 or v_kg > 1000000000 or v_kg / v_qty > 1000000000 then v_reason := 'คำนวณกิโลกรัมไม่ได้'; end if;
    end if;

    if v_reason is not null then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'itemCode', v_job.item_code, 'reason', v_reason));
      continue;
    end if;

    if not v_locked then
      perform private.bom_lock_rf();
      v_locked := true;
      -- เลข WO ถัดไปของวันนี้ (เวลา Asia/Bangkok): สูงสุดของ WO-<วัน>-<เลข> ที่มีอยู่ + 1 (ตัวเลขยาวผิดปกติเทียบเป็น numeric ไม่ล้น)
      select coalesce(max((m.n)[1]::numeric), 0) into v_seq
      from (select regexp_match(o.wo_no, '^WO-' || v_stamp || '-(\d{1,8})$') as n from public.rf_orders o where o.is_test = (select private.bom_test_mode())) m
      where m.n is not null;
    end if;
    v_seq := v_seq + 1;
    v_wo := 'WO-' || v_stamp || '-' || lpad(v_seq::text, greatest(2, length(v_seq::text)), '0');

    insert into public.rf_orders (
      is_test, wo_no, customer, customer_po, recipe_code, recipe_revision, product_code, uom, color,
      target_qty, target_kg, kg_per_unit, produced_qty, start_date, due_date, priority, note, status, source_job_no, created_by)
    values (
      (select private.bom_test_mode()), v_wo, v_ord.customer, v_ord.pi_no, v_rec.recipe_code, v_rec.revision, v_rec.product_code, v_job.uom,
      coalesce(nullif(left(v_item.rubber ->> 'color', 40), ''), 'ดำ'),
      v_qty, v_kg, private.bom_kg_per_unit(v_kg, v_qty), 0, v_today, greatest(coalesce(v_job.due_at, v_today), v_today),
      case when v_job.due_at < v_now then 'urgent' else 'normal' end,
      left('จาก BOM งาน ' || v_job.job_no || ' · PI ' || v_ord.pi_no || ' · ' || v_job.item_code || ' ' || trim_scale(v_qty)::text || ' ' || v_job.uom
           || ' ≈ ' || trim_scale(v_kg)::text || ' kg · เปิดอัตโนมัติตอนปล่อยใบ', 300),
      'planned', v_job.job_no, p_actor.id);

    update public.bom_jobs set
      external_ref = jsonb_build_object('system', 'rubberflow', 'woId', v_wo, 'kg', v_kg, 'linkedAt', v_now, 'by', p_actor_name, 'auto', true),
      updated_at = now()
    where id = v_job.id;

    v_opened := v_opened || jsonb_build_array(jsonb_build_object('jobId', v_job.job_no, 'woId', v_wo, 'kg', v_kg));
  end loop;

  return jsonb_build_object('opened', v_opened, 'skipped', v_skipped);
end;
$$;

-- private.bom_started_jobs(uuid) · นิยามล่าสุดจาก 20261108020000_bom_release_opens_rubberflow_orders.sql
create or replace function private.bom_started_jobs(p_order uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.bom_jobs j
    where j.is_test = (select private.bom_test_mode()) and j.order_pk = p_order
      and (j.status <> 'queued' or j.qty_done > 0 or j.qty_reject > 0 or jsonb_array_length(j.reports) > 0
           -- ผูก WO: นับว่าเริ่มแล้วต่อเมื่อ WO เลย released ไปแล้ว หรือหา WO ไม่พบ (WO planned / released / cancelled ไม่นับ)
           or (j.external_ref is not null and not exists (
                 select 1 from public.rf_orders o
                 where o.is_test = (select private.bom_test_mode()) and o.wo_no = (j.external_ref ->> 'woId') and o.source_job_no = j.job_no and o.status in ('planned', 'released', 'cancelled')))))
$$;

-- private.rf_save_materials(uuid, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261110010000_rf_purchase_orders.sql
create or replace function private.rf_save_materials(p_actor uuid, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_code text;
  v_name text;
  v_category text;
  v_storage text;
  v_uom text;
  v_active boolean;
  v_safety numeric;
  v_shelf numeric;
  v_seen text[] := '{}';
  v_old public.rf_materials%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_code := private.bom_text(v_row, 'code', 40, 1, 'RF_INVALID_MATERIAL');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$' or upper(v_code) = any (v_seen) then raise exception 'RF_INVALID_MATERIAL'; end if;
    v_seen := v_seen || upper(v_code);
    v_name := private.bom_text(v_row, 'name', 160, 1, 'RF_INVALID_MATERIAL');
    v_category := private.bom_text(v_row, 'category', 60, 0, 'RF_INVALID_MATERIAL');
    v_storage := private.bom_text(v_row, 'storage', 160, 0, 'RF_INVALID_MATERIAL');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_MATERIAL'), ''), 'kg');
    v_node := v_row -> 'active';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_active := true;
    elsif jsonb_typeof(v_node) <> 'boolean' then
      raise exception 'RF_INVALID_MATERIAL';
    else
      v_active := (v_node #>> '{}')::boolean;
    end if;
    -- สต็อกสำรอง 0..1e9 และอายุเก็บเป็นวันเต็ม 1..3650 (ไม่ส่ง = null = คงค่าเดิม)
    v_safety := private.bom_num(v_row -> 'safetyKg', 'RF_INVALID_MATERIAL', 0, 1000000000);
    v_shelf := private.bom_num(v_row -> 'shelfLifeDays', 'RF_INVALID_MATERIAL', 1, 3650);
    if v_shelf is not null and v_shelf <> trunc(v_shelf) then raise exception 'RF_INVALID_MATERIAL'; end if;

    select * into v_old from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and upper(m.code) = upper(v_code);
    if found then
      -- รหัสต่างกันแค่ตัวพิมพ์ = ซ้ำกับของเดิม (รหัสเป็นกุญแจ แก้ไม่ได้)
      if v_old.code <> v_code then raise exception 'RF_CONFLICT'; end if;
      if v_old.name = v_name and v_old.category = v_category and v_old.storage_location = v_storage
         and v_old.uom = v_uom and v_old.active = v_active
         and (v_safety is null or v_old.safety_kg = v_safety)
         and (v_shelf is null or v_old.shelf_life_days = v_shelf::integer) then
        continue;
      end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;
      -- ใบสั่งซื้อพ่วงมาแก้ได้ช่อง safetyKg ช่องเดียว
      if p_action = 'createPurchaseOrder'
         and (v_old.name <> v_name or v_old.category <> v_category or v_old.storage_location <> v_storage
              or v_old.uom <> v_uom or v_old.active <> v_active
              or (v_shelf is not null and v_old.shelf_life_days <> v_shelf::integer)) then
        raise exception 'RF_INVALID_MATERIAL';
      end if;
      update public.rf_materials set
        name = v_name, category = v_category, storage_location = v_storage, uom = v_uom, active = v_active,
        safety_kg = coalesce(v_safety, safety_kg), shelf_life_days = coalesce(v_shelf::integer, shelf_life_days),
        updated_by = p_actor, updated_at = now()
      where id = v_old.id;
    else
      -- ใบสั่งซื้อสร้างวัตถุดิบใหม่ไม่ได้
      if p_action = 'createPurchaseOrder' then raise exception 'RF_INVALID_MATERIAL'; end if;
      insert into public.rf_materials (is_test, code, name, category, storage_location, uom, active, safety_kg, shelf_life_days, created_by, updated_by)
      values ((select private.bom_test_mode()), v_code, v_name, v_category, v_storage, v_uom, v_active, coalesce(v_safety, 0), coalesce(v_shelf::integer, 180), p_actor, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_check_po_receipt(uuid, jsonb, bigint) · นิยามล่าสุดจาก 20261110010000_rf_purchase_orders.sql
create or replace function private.rf_check_po_receipt(p_actor uuid, p_receipt jsonb, p_cur bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lot public.rf_material_lots%rowtype;
begin
  if p_receipt is null or jsonb_typeof(p_receipt) = 'null' then return; end if;
  if (select count(*) from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_cur) <> 1 then
    raise exception 'RF_INVALID_PURCHASE';
  end if;
  select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_cur;
  if v_lot.lot_no <> (p_receipt ->> 'lotNo')
     or v_lot.material_code <> (p_receipt ->> 'materialCode')
     or v_lot.initial_kg <> (p_receipt ->> 'qtyKg')::numeric
     or v_lot.qty_kg <> v_lot.initial_kg
     or v_lot.expiry <> (p_receipt ->> 'expiry')::numeric
     or v_lot.status <> 'available'
     or v_lot.received_by is distinct from p_actor
     or v_lot.received_at <> now() then
    raise exception 'RF_INVALID_PURCHASE';
  end if;
end;
$$;

-- private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261110010000_rf_purchase_orders.sql
create or replace function private.rf_save_requisitions(p_actor uuid, p_actor_name text, p_may boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
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
  v_need_kg numeric;
  v_done_kg numeric;
  v_next numeric;
  v_need numeric;
  v_left numeric;
  v_free numeric;
  v_take numeric;
  v_after numeric;
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
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_no := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_REQUISITION');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_seen := v_seen || v_no;

    select * into v_old from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.req_no = v_no;
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
        if v_sact is not null or v_cact is null then raise exception 'RF_INVALID_REQUISITION'; end if;
        v_target := (v_sline ->> 'targetKg')::numeric;
        -- จ่ายทั้งใบ = ต้องเท่าเป้าหมายพอดี · ชั่งทีละบรรทัด (ข้อมูลเก่า) = อยู่ในเกณฑ์
        if p_action = 'issueRequisition' then
          if abs(v_cact - v_target) > 0.000000001 then raise exception 'RF_INVALID_REQUISITION'; end if;
        else
          v_tol := greatest(0.02, v_target * 1.5 / 100);
          if abs(v_cact - v_target) > v_tol + 0.000000001 then raise exception 'RF_OUT_OF_TOLERANCE'; end if;
        end if;
        select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_sline ->> 'lotNo') for update;
        if not found then raise exception 'RF_LOT_UNAVAILABLE'; end if;
        if v_lot.status = 'hold' or v_lot.qty_kg <= 0.0001 or v_lot.expiry <= v_now_ms or v_lot.qty_kg < v_cact then
          perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_LOT_UNAVAILABLE');
        end if;
        update public.rf_material_lots set qty_kg = greatest(0, trim_scale(round(v_lot.qty_kg - v_cact, 6))), updated_at = now() where id = v_lot.id;
        v_lines := jsonb_set(v_lines, array[v_i::text],
          (v_lines -> v_i) || jsonb_build_object('actualKg', v_cact, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
      end loop;
      v_done := not exists (select 1 from jsonb_array_elements(v_lines) e where jsonb_typeof(e -> 'actualKg') is distinct from 'number');
      if p_action = 'issueRequisition' and not v_done then raise exception 'RF_INVALID_REQUISITION'; end if;
      update public.rf_requisitions set
        lines = v_lines,
        status = case when v_done then 'issued' else status end,
        issued_at = case when v_done then now() else issued_at end,
        issued_by = case when v_done then p_actor else issued_by end,
        updated_at = now()
      where id = v_old.id;
      continue;
    end if;

    -- ใบใหม่: สมาชิก RB / กลุ่มวางแผน · WO ต้อง released หรือ in_progress · เซิร์ฟเวอร์จัดสรร FEFO เองแล้วจ่ายทันที
    if not p_may then raise exception 'RF_FORBIDDEN'; end if;
    v_order := private.bom_text(v_row, 'orderId', 40, 1, 'RF_INVALID_REQUISITION');
    v_batches := private.bom_num(v_row -> 'batches', 'RF_INVALID_REQUISITION', 1, 10);
    if v_batches is null then raise exception 'RF_INVALID_REQUISITION'; end if;
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_REQUISITION');
    -- ล็อกแถว WO ไว้ (และทั้งธุรกรรมถือ advisory lock ของ app_rf_save อยู่แล้ว) ใบเบิกของ WO เดียวกันจึงไม่ซ้อนกัน
    select * into v_ord from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_order for update;
    if not found then raise exception 'RF_INVALID_REQUISITION'; end if;
    if v_ord.status not in ('released', 'in_progress') then
      perform private.rf_fail(v_ord.changed_version, p_base, p_cur, 'RF_INVALID_REQUISITION');
    end if;
    select * into v_rec from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_ord.recipe_code and r.revision = v_ord.recipe_revision;
    -- จำนวน batch มาจาก WO ไม่ใช่ที่ผู้ใช้กรอก (เหมือน rules.nextRequisitionBatches ของ client): กิโลที่ WO ต้องใช้ = target_kg (ถ้ามี) ไม่เช่นนั้น target_qty ÷ yield_per_kg ของสูตรที่ WO ใช้
    -- ลบกิโลที่ใบเบิกทุกใบของ WO นี้เบิกไปแล้ว (batches × batch_kg · ไม่มีสถานะยกเลิก นับทุกใบ) ปัดขึ้นเป็น batch (เผื่อ 1e-9) ไม่เกิน 10 ต่อใบ
    -- 0 (เบิกครบแล้ว) หรือไม่ตรงกับที่ client ส่ง = RF_INVALID_REQUISITION · แต่ถ้าใบเบิกของ WO นี้เปลี่ยนหลังเวอร์ชันฐาน = client ถือข้อมูลเก่า ได้ RF_STALE (ตามทันแล้วลองใหม่)
    v_need_kg := case when v_ord.target_kg > 0 then v_ord.target_kg else v_ord.target_qty / v_rec.yield_per_kg end;
    v_done_kg := coalesce((select sum(q.batches * v_rec.batch_kg) from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.order_no = v_order), 0);
    v_next := least(10, greatest(0, ceil(greatest(0, v_need_kg - v_done_kg) / v_rec.batch_kg - 0.000000001)));
    if v_batches is distinct from v_next or v_next < 1 then
      perform private.rf_fail((select max(q.changed_version) from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.order_no = v_order), p_base, p_cur, 'RF_INVALID_REQUISITION');
    end if;
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
      perform 1 from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.material_code = v_item.code order by l.lot_no for update;
      for v_lot in
        select * from public.rf_material_lots l
        where l.is_test = (select private.bom_test_mode()) and l.material_code = v_item.code and l.status = 'available' and l.qty_kg > 0.0001 and l.expiry > v_now_ms
        order by l.expiry, l.received_at, l.lot_no
      loop
        exit when v_left <= 0.0001;
        -- คงเหลือที่จองได้ = สต็อก - ที่ใบเบิกเก่า (ยัง weighing) จองบรรทัดที่ยังไม่ชั่ง - ที่ใบนี้จัดสรรไปแล้ว
        v_free := v_lot.qty_kg
          - coalesce((select sum((e ->> 'targetKg')::numeric)
                      from public.rf_requisitions q, jsonb_array_elements(q.lines) e
                      where q.is_test = (select private.bom_test_mode()) and q.status = 'weighing' and e ->> 'lotNo' = v_lot.lot_no
                        and jsonb_typeof(e -> 'actualKg') is distinct from 'number'), 0)
          - coalesce((select sum((e ->> 'targetKg')::numeric) from jsonb_array_elements(v_new_lines) e where e ->> 'lotNo' = v_lot.lot_no), 0);
        continue when v_free <= 0.0001;
        v_take := trunc(least(v_free, v_left), 4);
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
      if exists (select 1 from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_base and l.changed_version <= p_cur)
         or exists (select 1 from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.changed_version > p_base and q.changed_version <= p_cur) then
        raise exception 'RF_STALE';
      end if;
      raise exception 'RF_INSUFFICIENT_STOCK';
    end if;
    -- จ่ายทันที: หักสต็อกล็อตตามบรรทัด (ล็อกไว้แล้วข้างบน จัดสรรไม่เกินคงเหลือ) แล้วตั้งค่าที่จ่ายจริง = เป้าหมาย
    for v_i in 0 .. jsonb_array_length(v_new_lines) - 1 loop
      v_sline := v_new_lines -> v_i;
      v_target := (v_sline ->> 'targetKg')::numeric;
      select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_sline ->> 'lotNo') for update;
      -- ตัดทศนิยม (trunc) ตอนจัดสรรไม่ให้เกินคงเหลือ · ถ้าหักแล้วติดลบให้หยุดทั้งธุรกรรม ไม่ปัดเป็น 0 เงียบ ๆ
      v_after := v_lot.qty_kg - v_target;
      if v_after < 0 then raise exception 'RF_INSUFFICIENT_STOCK'; end if;
      update public.rf_material_lots set qty_kg = trim_scale(v_after), updated_at = now() where id = v_lot.id;
      v_new_lines := jsonb_set(v_new_lines, array[v_i::text],
        v_sline || jsonb_build_object('actualKg', v_target, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
    end loop;
    insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines, status, note, requested_by, issued_at, issued_by)
    values ((select private.bom_test_mode()), v_no, v_order, v_ord.recipe_code, v_ord.recipe_revision, v_batches,
            trim_scale(round(v_rec.batch_kg * v_batches, 4)), v_new_lines, 'issued', v_note, p_actor, now(), p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_delta(bigint) · นิยามล่าสุดจาก 20261110010000_rf_purchase_orders.sql
create or replace function private.rf_delta(p_since bigint)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.rf_master_state s where s.is_test = (select private.bom_test_mode())), 0),
    'epoch', (select s.epoch from public.rf_master_state s where s.is_test = (select private.bom_test_mode())),
    'changes', (
      select jsonb_object_agg(l.list, jsonb_build_object('upsert', r.records -> l.list, 'delete', '[]'::jsonb))
      from (values ('materials'), ('recipes'), ('orders'), ('molds'), ('materialLots'), ('requisitions'), ('lots'),
                   ('transfers'), ('fgBoxes'), ('qcRecords'), ('ncrs'), ('purchaseOrders')) as l(list)
      cross join (select private.rf_records(p_since) as records) r))
$$;

-- private.bom_part_returned(text, text) · นิยามล่าสุดจาก 20261112010000_bom_part_returns.sql
create or replace function private.bom_part_returned(p_pi text, p_item text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_stock_moves m
  where m.is_test = (select private.bom_test_mode()) and m.kind = 'return' and m.ref = p_pi and m.item_code = p_item
    and m.created_at > coalesce((select max(i.created_at) from public.bom_stock_moves i
                                 where i.is_test = (select private.bom_test_mode()) and i.kind = 'issue' and i.ref = p_pi and i.item_code = p_item), '-infinity'::timestamptz)
$$;

-- private.bom_stock_add_return(uuid, text, numeric, text, text) · นิยามล่าสุดจาก 20261112010000_bom_part_returns.sql
create or replace function private.bom_stock_add_return(p_actor_id uuid, p_code text, p_qty numeric, p_pi text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old numeric;
begin
  select s.qty into v_old from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = p_code;
  if found then
    update public.bom_stock set qty = v_old + p_qty, updated_at = now() where is_test = (select private.bom_test_mode()) and item_code = p_code;
  else
    v_old := 0;
    insert into public.bom_stock (is_test, item_code, qty) values ((select private.bom_test_mode()), p_code, p_qty);
  end if;
  insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by, note)
  values ((select private.bom_test_mode()), p_code, 'return', p_qty, v_old + p_qty, p_pi, p_actor_id, p_reason);
end;
$$;

-- private.rf_apply_feedback(text, public.rf_lots, public.rf_orders) · นิยามล่าสุดจาก 20261116010000_rf_bom_feedback_on_finishing.sql
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
  select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = p_wo.source_job_no for update;
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

-- private.rf_save_transfers(public.employees, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261116010000_rf_bom_feedback_on_finishing.sql
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

    select * into v_old from public.rf_transfers t where t.is_test = (select private.bom_test_mode()) and t.transfer_no = v_no;
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
    select * into v_lot from public.rf_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_text for update;
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
    values ((select private.bom_test_mode()), v_no, v_lot.lot_no, v_lot.order_no, v_lot.stage, v_next, v_lot.uom, v_q, 0, v_note, 'in_transit', p_actor.id);
    update public.rf_lots set transferred_qty = trim_scale(round(transferred_qty + v_q, 3)), updated_at = now() where id = v_lot.id;
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261116010000_rf_bom_feedback_on_finishing.sql
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
      v_res := private.rf_apply_feedback(p_actor.first_name || ' ' || p_actor.last_name, v_lot, v_wo);
      v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
      v_orders := v_orders + (v_res ->> 'orders')::integer;
    end if;
  end loop;
  return jsonb_build_object('jobs', v_jobs, 'orders', v_orders);
end;
$$;

-- private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261119010000_rf_purchase_by_st.sql
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
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    v_no := private.bom_text(v_row, 'lotNo', 60, 1, 'RF_INVALID_MATERIAL_LOT');
    if v_no !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    v_seen := v_seen || v_no;
    v_code := private.bom_text(v_row, 'materialCode', 40, 1, 'RF_INVALID_MATERIAL_LOT');
    v_qty := private.bom_num(v_row -> 'qtyKg', 'RF_INVALID_MATERIAL_LOT', 0, 1000000000);
    v_exp := private.bom_num(v_row -> 'expiry', 'RF_INVALID_MATERIAL_LOT', 1, 100000000000000);
    if v_exp is null or v_exp <> trunc(v_exp) then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    v_sup := coalesce(nullif(private.bom_text(v_row, 'supplier', 120, 0, 'RF_INVALID_MATERIAL_LOT'), ''), '-');
    v_loc := private.bom_text(v_row, 'location', 160, 0, 'RF_INVALID_MATERIAL_LOT');
    v_status := coalesce(nullif(private.bom_text(v_row, 'status', 10, 0, 'RF_INVALID_MATERIAL_LOT'), ''), 'available');
    if v_status not in ('available', 'hold') then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    v_node := v_row -> 'coa';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_coa := 'false'::jsonb;
    elsif jsonb_typeof(v_node) in ('boolean', 'object') and char_length(v_node::text) <= 2000 then
      v_coa := v_node;
    else
      raise exception 'RF_INVALID_MATERIAL_LOT';
    end if;

    select * into v_old from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_no;
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
      if v_content then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
      update public.rf_material_lots set status = v_status, updated_at = now() where id = v_old.id;
      continue;
    end if;

    -- ล็อตใหม่ = ST (หรือ admin) รับเข้า เริ่มที่ available เสมอ
    if not (p_st or coalesce(private.employee_role_code(p_actor) = 'admin', false)) then raise exception 'RF_FORBIDDEN'; end if;
    if v_status <> 'available' then raise exception 'RF_INVALID_TRANSITION'; end if;
    select * into v_mat from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.code = v_code;
    if not found or not v_mat.active then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    if v_exp <= private.bom_ms(now()) then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry, supplier, location, status, coa, received_by)
    values ((select private.bom_test_mode()), v_no, v_mat.code, v_qty, v_qty, v_exp::bigint, v_sup, coalesce(nullif(v_loc, ''), v_mat.storage_location), 'available', v_coa, p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261120010000_st_sets_safety_stock.sql
create or replace function private.bom_save_stock(
  p_actor public.employees, p_planner boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dept text := private.bom_dept_of(p_actor);
  v_may_count boolean := p_planner or coalesce(v_dept in ('ST', 'WH'), false);
  v_row jsonb;
  v_seen text[] := '{}';
  v_code text;
  v_qty numeric;
  v_safety numeric;
  v_old public.bom_stock%rowtype;
  v_found boolean;
  v_old_qty numeric;
  v_old_safety numeric;
  v_new_qty numeric;
  v_new_safety numeric;
  v_qty_changed boolean;
  v_n integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_STOCK'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_STOCK'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_STOCK'; end if;
    v_seen := v_seen || v_code;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_STOCK', 0, 1000000000);
    v_safety := private.bom_num(v_row -> 'safetyQty', 'BOM_INVALID_STOCK', 0, 1000000000);
    if not exists (select 1 from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_code and i.kind = 'PURCHASED') then
      raise exception 'BOM_INVALID_STOCK';
    end if;

    select * into v_old from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = v_code for update;
    v_found := found;
    v_old_qty := case when v_found then v_old.qty else 0 end;
    v_old_safety := case when v_found then v_old.safety_qty else 0 end;
    v_new_qty := coalesce(v_qty, v_old_qty);
    v_new_safety := coalesce(v_safety, v_old_safety);
    -- ค่าเท่าที่เก็บ (สำเนาที่ client ได้จากเซิร์ฟเวอร์) หรือแถวที่ยังไม่มีและขอ 0 / 0 = ไม่ทำอะไร
    if v_new_qty = v_old_qty and v_new_safety = v_old_safety then continue; end if;
    if v_found and v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    v_qty_changed := v_new_qty <> v_old_qty;
    if v_qty_changed and not v_may_count then raise exception 'BOM_FORBIDDEN'; end if;
    if v_new_safety <> v_old_safety and not (p_planner or coalesce(v_dept = 'ST', false)) then raise exception 'BOM_FORBIDDEN'; end if;

    if v_found then
      update public.bom_stock set
        qty = v_new_qty, safety_qty = v_new_safety,
        counted_at = case when v_qty_changed then now() else counted_at end,
        counted_by = case when v_qty_changed then p_actor.id else counted_by end,
        updated_at = now()
      where id = v_old.id;
    else
      insert into public.bom_stock (is_test, item_code, qty, safety_qty, counted_at, counted_by)
      values ((select private.bom_test_mode()), v_code, v_new_qty, v_new_safety, case when v_qty_changed then now() end, case when v_qty_changed then p_actor.id end);
    end if;
    if v_qty_changed then
      insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
      values ((select private.bom_test_mode()), v_code, 'count', v_new_qty - v_old_qty, v_new_qty, null, p_actor.id);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- private.bom_fg_pk_done(uuid, text) · นิยามล่าสุดจาก 20261121010000_bom_fg_receive_deliver.sql
create or replace function private.bom_fg_pk_done(p_order_pk uuid, p_code text)
returns numeric
language sql
set search_path = ''
as $$
  select coalesce(sum(j.qty_done), 0)
  from public.bom_jobs j
  where j.is_test = (select private.bom_test_mode()) and j.order_pk = p_order_pk and j.dept = 'PK' and j.kind = 'FG' and j.item_code = p_code
$$;

-- private.bom_delta(bigint) · นิยามล่าสุดจาก 20261121010000_bom_fg_receive_deliver.sql
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
                   ('customers'), ('orders'), ('jobs'), ('stock'), ('stockMoves'), ('fgMoves')) as l(list)
      cross join (select private.bom_records(p_since) as records) r))
$$;

-- private.bom_fg_in(uuid, text) · นิยามล่าสุดจาก 20261123010000_bom_fg_stock.sql
create or replace function private.bom_fg_in(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = 'transfer' then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test = (select private.bom_test_mode()) and m.order_pk = p_order_pk and m.fg_code = p_code and m.kind in ('transfer', 'untransfer')
$$;

-- private.bom_fg_out(uuid, text) · นิยามล่าสุดจาก 20261123010000_bom_fg_stock.sql
create or replace function private.bom_fg_out(p_order_pk uuid, p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = 'transfer' then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test = (select private.bom_test_mode()) and m.from_order_pk = p_order_pk and m.fg_code = p_code and m.kind in ('transfer', 'untransfer')
$$;

-- private.bom_issue_parts(public.employees, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261123020000_bom_issue_parts_partial.sql
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
    select * into v_job from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no;
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
    perform 1 from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = v_job.item_code for update;
    v_amount := (v_want ->> v_job.id::text)::numeric - v_job.qty_done;
    v_stock := coalesce((select s.qty from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = v_job.item_code), 0);
    if v_amount > v_stock then v_short := true; end if;
  end loop;
  if v_short then
    if exists (select 1 from public.bom_stock s join public.bom_jobs j on j.item_code = s.item_code
               where j.id = any (v_jobs) and s.is_test = (select private.bom_test_mode()) and s.changed_version > p_base and s.changed_version <= p_cur) then
      raise exception 'BOM_STALE';
    end if;
    raise exception 'BOM_INSUFFICIENT_STOCK';
  end if;

  for v_job in select * from public.bom_jobs j where j.id = any (v_jobs) order by j.item_code collate "C" loop
    v_total := (v_want ->> v_job.id::text)::numeric;
    v_amount := v_total - v_job.qty_done;
    v_stock := (select s.qty from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = v_job.item_code);
    update public.bom_stock set qty = v_stock - v_amount, updated_at = now() where is_test = (select private.bom_test_mode()) and item_code = v_job.item_code;
    insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
    values ((select private.bom_test_mode()), v_job.item_code, 'issue', -v_amount, v_stock - v_amount, v_ord.pi_no, p_actor.id);
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

-- private.bom_fg_move(public.employees, text, jsonb) · นิยามล่าสุดจาก 20261125010000_bom_close_rules.sql
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
    for i in 1 .. cardinality(v_codes) loop
      if private.bom_fg_total(v_ord.id, v_codes[i], 'receive') + v_qtys[i] > private.bom_fg_pk_done(v_ord.id, v_codes[i]) then
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

-- private.bom_fg_free(uuid, text) · นิยามล่าสุดจาก 20261128010000_bom_cancel_rf_stop.sql
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
    where o.is_test = (select private.bom_test_mode()) and o.id = p_order_pk and o.status in ('released', 'in_progress', 'completed', 'cancelled')), 0)
$$;

-- private.bom_fg_stock(text) · นิยามล่าสุดจาก 20261128010000_bom_cancel_rf_stop.sql
create or replace function private.bom_fg_stock(p_code text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(private.bom_fg_free(o.id, p_code)), 0)
  from public.bom_orders o
  where o.is_test = (select private.bom_test_mode()) and o.status in ('released', 'in_progress', 'completed', 'cancelled')
    and exists (select 1 from public.bom_fg_moves m where m.is_test = (select private.bom_test_mode()) and m.order_pk = o.id and m.fg_code = p_code)
$$;

-- private.bom_save_orders(public.employees, text, boolean, jsonb, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261128010000_bom_cancel_rf_stop.sql
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

-- private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261128010000_bom_cancel_rf_stop.sql
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
  where o.is_test = (select private.bom_test_mode()) and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_RETURN')) for update;
  if not found then raise exception 'BOM_INVALID_RETURN'; end if;

  -- ชนรายระเบียนก่อนสิทธิ์: งานของซื้อของใบหรือแถวสต็อกของรายการเหล่านั้นถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า (ยอดที่คืนได้อาจเปลี่ยนไปแล้ว)
  if exists (select 1 from public.bom_jobs j
             where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.changed_version > p_base and j.changed_version <= p_cur)
     or exists (select 1 from public.bom_stock s
                where s.is_test = (select private.bom_test_mode()) and s.changed_version > p_base and s.changed_version <= p_cur
                  and s.item_code in (select j.item_code from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED')) then
    raise exception 'BOM_STALE';
  end if;
  if not (p_planner or coalesce(v_dept = 'ST', false)) then raise exception 'BOM_FORBIDDEN'; end if;

  if v_mode = 'undo' then
    if v_ord.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    -- งานที่เบิกแล้ว = done หรือเบิกไปบางส่วน (qty_done > 0)
    select coalesce(array_agg(distinct j.item_code), '{}') into v_codes
    from public.bom_jobs j
    where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and (j.status = 'done' or j.qty_done > 0);
    if cardinality(v_codes) = 0 then raise exception 'BOM_INVALID_RETURN'; end if;
    perform 1 from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and (j.status = 'done' or j.qty_done > 0) and j.item_code = v_code;
      v_left := v_issued - private.bom_part_returned(v_ord.pi_no, v_code);
      if v_left > 0 then
        perform private.bom_stock_add_return(p_actor.id, v_code, v_left, v_ord.pi_no, v_reason);
        v_n := v_n + 1;
      end if;
    end loop;
    -- งานกลับไปรอเบิกจ่าย (ใบไม่เปลี่ยนสถานะ) · ไม่มีงานเริ่มจึงยกเลิก/เปิดใบกลับมาแก้ได้ตามกติกาเดิม
    update public.bom_jobs set status = 'queued', qty_done = 0, done_at = null, updated_at = now()
    where is_test = (select private.bom_test_mode()) and order_pk = v_ord.id and dept = 'ST' and kind = 'PURCHASED' and (status = 'done' or qty_done > 0);
  else
    -- ใบที่ยกเลิกแล้ว (20261128010000) คืนของเหลือได้เหมือนใบที่ปิดแล้ว: งานของใบยังอยู่ (ยกเลิกไม่ลบงานแล้ว) ของที่เบิกไปคืนเข้าสต็อกได้
    if v_ord.status not in ('released', 'in_progress', 'completed', 'cancelled') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    perform 1 from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      -- งานที่คืนของเหลือได้ = done · หรือเบิกไปบางส่วนเมื่อใบปิดแล้ว (completed: เบิกส่วนที่เหลือและยกเลิกการเบิกจ่ายทำไม่ได้แล้ว)
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test = (select private.bom_test_mode()) and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.item_code = v_code
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

-- private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261128010000_bom_cancel_rf_stop.sql
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
    select * into v_old from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.req_no = v_no for update;
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
    select o.status into v_wo_status from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_old.order_no;
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
    where l.is_test = (select private.bom_test_mode()) and l.lot_no in (select e ->> 'lotNo' from jsonb_array_elements(v_old.lines) e)
    order by l.lot_no
    for update;
    v_lines := v_old.lines;
    for v_i in 0 .. v_n - 1 loop
      v_sline := v_old.lines -> v_i;
      v_kg := v_kgs[v_i + 1];
      if v_kg > 0 then
        select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_sline ->> 'lotNo');
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

-- private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
create or replace function private.rf_save_purchase_orders(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_rb boolean, p_st boolean,
  p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_no text;
  v_status text;
  v_pi text;
  v_req text;
  v_note text;
  v_lines jsonb;
  v_old public.rf_purchase_orders%rowtype;
  v_mat public.rf_materials%rowtype;
  v_sl jsonb;
  v_nl jsonb;
  v_i integer;
  v_n integer;
  v_idx integer;
  v_recv_count integer;
  v_close_count integer;
  v_cidx integer;
  v_old_recv numeric;
  v_new_recv numeric;
  v_reason text;
  v_left numeric;
  v_other boolean;
  v_final jsonb;
  v_receipt jsonb := null;
  v_ms bigint := private.bom_ms(now());
  v_kg numeric;
  v_exp numeric;
  v_src text;
  v_item public.bom_items%rowtype;
  v_stock public.bom_stock%rowtype;
  v_bal numeric;
  v_safety numeric;
  v_stored numeric;
  v_bom_n integer := 0;
  v_part boolean := false;
  v_locked boolean := false;
  v_admin boolean := coalesce(private.employee_role_code(p_actor.id) = 'admin', false);
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'RF_INVALID_PURCHASE');
    if v_no !~ '^PO-[0-9]{8}-[0-9]{2,6}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_seen := v_seen || v_no;
    v_status := coalesce(nullif(private.bom_text(v_row, 'status', 12, 0, 'RF_INVALID_PURCHASE'), ''), 'ordered');
    if v_status not in ('ordered', 'received', 'cancelled') then raise exception 'RF_INVALID_PURCHASE'; end if;
    v_pi := nullif(private.bom_text(v_row, 'sourcePi', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_req := nullif(private.bom_text(v_row, 'sourceRequisition', 60, 0, 'RF_INVALID_PURCHASE'), '');
    v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_PURCHASE');
    v_lines := private.rf_po_parse_lines(v_row -> 'lines');

    select * into v_old from public.rf_purchase_orders p where p.is_test = (select private.bom_test_mode()) and p.po_no = v_no;
    if found then
      -- ส่งมาเป็น "ใบใหม่" ด้วยเลขที่มีอยู่แล้ว (เวลาสร้างต่างจากที่เก็บ) = เลขเอกสารชนกัน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- เทียบกับแถวที่เก็บ: ช่องของใบ + ทุกบรรทัด (receivedAt / receivedBy ของ client ไม่นับ) นับบรรทัดที่ client บอกว่าเพิ่งรับเข้า
      v_n := jsonb_array_length(v_old.lines);
      v_other := v_old.source_pi is distinct from v_pi or v_old.source_requisition is distinct from v_req
        or v_old.note <> v_note or jsonb_array_length(v_lines) <> v_n;
      v_recv_count := 0;
      v_idx := null;
      v_close_count := 0;
      v_cidx := null;
      if not v_other then
        for v_i in 0 .. v_n - 1 loop
          v_sl := v_old.lines -> v_i;
          v_nl := v_lines -> v_i;
          if coalesce(v_sl ->> 'source', 'rf') is distinct from (v_nl ->> 'source')
             or (v_sl ->> 'materialCode') is distinct from (v_nl ->> 'materialCode')
             or (v_sl ->> 'needKg')::numeric is distinct from (v_nl ->> 'needKg')::numeric
             or (v_sl ->> 'availableKg')::numeric is distinct from (v_nl ->> 'availableKg')::numeric
             or (v_sl ->> 'shortageKg')::numeric is distinct from (v_nl ->> 'shortageKg')::numeric
             or (v_sl ->> 'safetyKg')::numeric is distinct from (v_nl ->> 'safetyKg')::numeric
             or (v_sl ->> 'qtyKg')::numeric is distinct from (v_nl ->> 'qtyKg')::numeric then
            v_other := true;
          else
            -- รับสะสม (20261128020000): receivedKg ของ client มากกว่ายอดสะสมที่เก็บ = ขอรับเพิ่มหนึ่งครั้ง (ยอดครั้งนี้ = ส่วนต่าง เซิร์ฟเวอร์คำนวณข้างล่าง)
            -- เท่าเดิม = ไม่เปลี่ยน (บรรทัดที่รับแล้ว: ล็อต / วันหมดอายุของครั้งล่าสุดต้องเท่าที่เก็บด้วย) · น้อยกว่าหรือลบออก = แก้การรับที่บันทึกแล้ว (ไม่ยอม)
            v_old_recv := (v_sl ->> 'receivedKg')::numeric;
            v_new_recv := (v_nl ->> 'receivedKg')::numeric;
            if v_new_recv is not distinct from v_old_recv then
              if v_old_recv is not null and ((v_sl ->> 'lotNo') is distinct from (v_nl ->> 'lotNo')
                 or (v_sl ->> 'expiry')::numeric is distinct from (v_nl ->> 'expiry')::numeric) then
                v_other := true;
              end if;
            elsif v_new_recv is not null and v_new_recv > coalesce(v_old_recv, 0) then
              v_recv_count := v_recv_count + 1;
              v_idx := v_i;
            else
              v_other := true;
            end if;
            -- ปิดยอดที่เหลือ: บรรทัดที่เก็บยังไม่ปิดและ client ส่ง closedRemainder มา = ขอปิดหนึ่งบรรทัด · บรรทัดที่ปิดแล้วเป็นของเซิร์ฟเวอร์ (ค่าของ client เมิน)
            if jsonb_typeof(v_sl -> 'closedRemainder') is distinct from 'object' and jsonb_typeof(v_nl -> 'closedRemainder') = 'object' then
              v_close_count := v_close_count + 1;
              v_cidx := v_i;
            end if;
          end if;
        end loop;
      end if;
      -- ตรงกับที่เก็บทุกช่อง (สำเนาที่ client ได้จากเซิร์ฟเวอร์) = ไม่ทำอะไร
      if not (v_other or v_recv_count > 0 or v_close_count > 0 or v_status <> v_old.status) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      -- ยกเลิก: คลังวัตถุดิบ (ST) หรือ admin เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้าหรือปิดยอดที่เหลือ (20261128020000)
      if v_status = 'cancelled' and v_old.status <> 'cancelled' then
        if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'cancelPurchaseOrder' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other or v_recv_count > 0 or v_close_count > 0
           or exists (select 1 from jsonb_array_elements(v_old.lines) l
                      where jsonb_typeof(l -> 'receivedKg') <> 'null' or jsonb_typeof(l -> 'closedRemainder') = 'object') then
          raise exception 'RF_INVALID_TRANSITION';
        end if;
        update public.rf_purchase_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_old.id;
        continue;
      end if;

      -- ปิดยอดที่เหลือ (closePurchaseLine · 20261128020000): แผนก ST หรือ admin ปิดหนึ่งบรรทัดที่ยังไม่ครบ พร้อมเหตุผล 3-300 ตัวอักษร
      -- ไม่เปลี่ยนสต็อกหรือล็อต · บรรทัดเก็บ closedRemainder = { kg (ยอดที่ไม่รับแล้ว), reason, at, by } · ทุกบรรทัดครบหรือปิดแล้ว = ใบ received
      if v_close_count > 0 then
        if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'closePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
        if v_close_count <> 1 or v_recv_count <> 0 then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_sl := v_old.lines -> v_cidx;
        if private.rf_po_line_done(v_sl) then raise exception 'RF_INVALID_TRANSITION'; end if;
        v_reason := v_lines -> v_cidx -> 'closedRemainder' ->> 'reason';
        if char_length(coalesce(v_reason, '')) < 3 then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_left := greatest(0, (v_sl ->> 'qtyKg')::numeric - private.rf_po_line_received(v_sl));
        v_final := jsonb_set(v_old.lines, array[v_cidx::text], v_sl || jsonb_build_object('closedRemainder',
          jsonb_build_object('kg', v_left, 'reason', v_reason, 'at', v_ms, 'by', p_actor_name)));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
        continue;
      end if;

      -- ที่เหลือที่ยอมให้มีได้ทางเดียวคือรับเข้าหนึ่งบรรทัด (ST หรือ admin) ที่มาพร้อมล็อตใหม่ (เคมี) · รับซ้ำบรรทัดเดิมได้จนกว่าจะครบ (20261128020000)
      if v_recv_count = 0 then raise exception 'RF_INVALID_TRANSITION'; end if;
      if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'receivePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
      if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
      if v_recv_count <> 1 or v_receipt is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_sl := v_old.lines -> v_idx;
      v_nl := v_lines -> v_idx;
      -- บรรทัดที่ครบแล้ว (รับถึงยอดสั่ง / ปิดยอดที่เหลือ / บรรทัดรุ่นเก่าที่รับไปแล้ว) รับอีกไม่ได้
      if private.rf_po_line_done(v_sl) then raise exception 'RF_INVALID_TRANSITION'; end if;
      -- ยอดครั้งนี้ = สะสมใหม่ - สะสมที่เก็บ (> 0 ตามการตรวจข้างบน) · ไม่เชื่อส่วนต่างหรือรายการรับของ client
      v_new_recv := (v_nl ->> 'receivedKg')::numeric;
      v_kg := v_new_recv - coalesce((v_sl ->> 'receivedKg')::numeric, 0);
      v_src := coalesce(v_sl ->> 'source', 'rf');
      if v_src = 'bom' then
        -- บรรทัดของซื้อ: บวกยอดคงเหลือ + ประวัติ 'receive' (ref = เลขใบ) ไม่มีล็อต/วันหมดอายุ (ตัวแยกวิเคราะห์บรรทัดบังคับ lotNo / expiry เป็น null แล้ว)
        -- ชิ้นต้องยังเป็นของซื้อที่มีอยู่ใน item master (เปลี่ยนชนิดหรือหายไปหลังสั่งแล้ว = รับเข้าไม่ได้)
        if not exists (select 1 from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = (v_sl ->> 'materialCode') and i.kind = 'PURCHASED') then
          raise exception 'RF_INVALID_PURCHASE';
        end if;
        -- ล็อกตัวนับ BOM (private.rf_lock_bom: rf_master_state ถูกล็อกก่อนแล้วใน app_rf_save) แล้วค่อยเขียนแถวสต็อก
        if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
        select * into v_stock from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = (v_sl ->> 'materialCode') for update;
        if found then
          v_bal := v_stock.qty + v_kg;
          if v_bal > 1000000000 then raise exception 'RF_INVALID_PURCHASE'; end if;
          update public.bom_stock set qty = v_bal, updated_at = now() where id = v_stock.id;
        else
          v_bal := v_kg;
          insert into public.bom_stock (is_test, item_code, qty) values ((select private.bom_test_mode()), v_sl ->> 'materialCode', v_bal);
        end if;
        insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
        values ((select private.bom_test_mode()), v_sl ->> 'materialCode', 'receive', v_kg, v_bal, v_no, p_actor.id);
        v_bom_n := v_bom_n + 1;
        v_part := true;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_new_recv, 'lotNo', null::text, 'expiry', null::bigint, 'receivedAt', v_ms, 'receivedBy', p_actor_name,
          'receipts', (case when jsonb_typeof(v_sl -> 'receipts') = 'array' then v_sl -> 'receipts' else '[]'::jsonb end)
                      || jsonb_build_array(jsonb_build_object('kg', v_kg, 'lotNo', null::text, 'expiry', null::bigint, 'at', v_ms, 'by', p_actor_name))));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
      else
        v_exp := (v_nl ->> 'expiry')::numeric;
        if v_exp <= v_ms then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_new_recv, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'receivedAt', v_ms, 'receivedBy', p_actor_name,
          'receipts', (case when jsonb_typeof(v_sl -> 'receipts') = 'array' then v_sl -> 'receipts' else '[]'::jsonb end)
                      || jsonb_build_array(jsonb_build_object('kg', v_kg, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'at', v_ms, 'by', p_actor_name))));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when (select bool_and(private.rf_po_line_done(l)) from jsonb_array_elements(v_final) l) then 'received' else 'ordered' end,
          updated_at = now()
        where id = v_old.id;
        v_receipt := jsonb_build_object('materialCode', v_sl ->> 'materialCode', 'lotNo', v_nl ->> 'lotNo', 'qtyKg', v_kg, 'expiry', v_exp);
      end if;
    else
      -- ใบใหม่: คลังวัตถุดิบ (ST) หรือ admin เท่านั้น ต้อง ordered ไม่มีข้อมูลรับเข้า วัตถุดิบทุกบรรทัดต้องมีอยู่และ active
      if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'createPurchaseOrder' or v_status <> 'ordered' then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_final := '[]'::jsonb;
      for v_nl in select value from jsonb_array_elements(v_lines) loop
        if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' or jsonb_typeof(v_nl -> 'closedRemainder') = 'object' then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_nl := v_nl - 'closedRemainder';
        if v_nl ->> 'source' = 'bom' then
          -- ของซื้อ: ต้องเป็นชิ้น PURCHASED ที่มีอยู่ (รหัสตามที่เก็บ หน่วยจาก bom_items) · สต็อกขั้นต่ำที่ต่างจาก bom_stock.safety_qty (ไม่มีแถว = 0) เซิร์ฟเวอร์ upsert ให้
          select * into v_item from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = private.bom_code(v_nl ->> 'materialCode') and i.kind = 'PURCHASED';
          if not found then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_safety := (v_nl ->> 'safetyKg')::numeric;
          -- storedSafetyKg = ค่าที่หน้าต่างสั่งซื้อแสดงตอนเปิด (rf_po_parse_lines ตัดช่องนี้ออก จึงอ่านจากบรรทัดดิบ): ค่าที่ส่งมาเท่ากับค่านี้
          -- แปลว่าผู้สั่งไม่ได้แก้ช่อง จึงไม่เขียนทับค่าที่ผู้อื่นเพิ่งตั้ง (บรรทัดของใบเก็บค่าที่ใช้อยู่จริง) · client รุ่นก่อนไม่ส่งช่องนี้ = เทียบกับที่เก็บเหมือนเดิม
          select private.bom_num(l.value -> 'storedSafetyKg', 'RF_INVALID_PURCHASE', 0, 1000000000) into v_stored
          from jsonb_array_elements(v_row -> 'lines') l where upper(l.value ->> 'materialCode') = upper(v_nl ->> 'materialCode') limit 1;
          if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
          select * into v_stock from public.bom_stock s where s.is_test = (select private.bom_test_mode()) and s.item_code = v_item.code for update;
          if found and v_stored is not null and v_safety = v_stored then
            v_safety := v_stock.safety_qty;
          elsif found then
            if v_stock.safety_qty <> v_safety then
              -- สต็อกขั้นต่ำเปลี่ยนได้โดยกลุ่มวางแผน (admin นับรวม) หรือแผนก ST ที่ส่ง storedSafetyKg มาด้วย (หน้าต่างรุ่นที่บอกค่าตอนเปิด)
              -- ST จาก client รุ่นก่อนที่ไม่ส่งช่องนี้ = RF_FORBIDDEN: แยกไม่ได้ว่าผู้สั่งแก้ช่องเอง หรือหน้าต่างค้างค่าเก่าแล้วจะเขียนทับค่าที่ผู้อื่นเพิ่งตั้ง
              if not (p_planner or (p_st and v_stored is not null)) then raise exception 'RF_FORBIDDEN'; end if;
              update public.bom_stock set safety_qty = v_safety, updated_at = now() where id = v_stock.id;
              v_bom_n := v_bom_n + 1;
            end if;
          elsif v_safety <> 0 then
            if not (p_planner or (p_st and v_stored is not null)) then raise exception 'RF_FORBIDDEN'; end if;
            insert into public.bom_stock (is_test, item_code, qty, safety_qty) values ((select private.bom_test_mode()), v_item.code, 0, v_safety);
            v_bom_n := v_bom_n + 1;
          end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_item.code, 'uom', v_item.uom, 'safetyKg', v_safety, 'receivedAt', null::bigint, 'receivedBy', null::text));
        else
          select * into v_mat from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and upper(m.code) = upper(v_nl ->> 'materialCode');
          if not found or not v_mat.active then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_mat.code, 'receivedAt', null::bigint, 'receivedBy', null::text));
        end if;
      end loop;
      insert into public.rf_purchase_orders (is_test, po_no, status, source_pi, source_requisition, note, lines, created_by)
      values ((select private.bom_test_mode()), v_no, 'ordered', v_pi, v_req, v_note, v_final, p_actor.id);
    end if;
  end loop;
  return jsonb_build_object('receipt', v_receipt, 'bomStock', v_bom_n, 'partReceipt', v_part);
end;
$$;

-- public.app_rf_save(jsonb, bigint, text, jsonb, text) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
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
  if v_bom_jobs + v_bom_orders + v_bom_stock > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode())
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when v_bom_jobs > 0 then jsonb_build_object('upsert', v_bom_jobs) end,
                                 'orders', case when v_bom_orders > 0 then jsonb_build_object('upsert', v_bom_orders) end,
                                 'stock', case when v_bom_stock > 0 then jsonb_build_object('upsert', v_bom_stock) end)),
                               'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', v_bom_jobs, 'bom_orders', v_bom_orders, 'bom_stock', v_bom_stock,
                             'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;

-- private.bom_fg_total(uuid, text, text) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
create or replace function private.bom_fg_total(p_order_pk uuid, p_code text, p_kind text)
returns numeric
language sql
set search_path = ''
as $$
  select coalesce(sum(case when m.kind = p_kind then m.qty else -m.qty end), 0)
  from public.bom_fg_moves m
  where m.is_test = (select private.bom_test_mode()) and m.order_pk = p_order_pk and m.fg_code = p_code
    and (m.kind = p_kind or m.kind = case p_kind when 'receive' then 'unreceive' when 'deliver' then 'undeliver' end)
$$;

-- private.bom_fg_return_stock(uuid, uuid) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
create or replace function private.bom_fg_return_stock(p_order_pk uuid, p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- ส่งมอบสุทธิ (deliver - undeliver) > 0 ของรหัสใดก็ตาม (20261128020000: การส่งมอบที่ย้อนแล้วไม่นับ)
  if exists (
    select 1 from public.bom_fg_moves m
    where m.is_test = (select private.bom_test_mode()) and m.order_pk = p_order_pk and m.kind in ('deliver', 'undeliver')
    group by m.fg_code
    having sum(case when m.kind = 'deliver' then m.qty else -m.qty end) > 0) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  if exists (
    select 1 from public.bom_fg_moves m
    where m.is_test = (select private.bom_test_mode()) and m.from_order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.fg_code
    having sum(case when m.kind = 'transfer' then m.qty else -m.qty end) > 0) then
    raise exception 'BOM_INVALID_TRANSITION';
  end if;
  insert into public.bom_fg_moves (is_test, order_pk, from_order_pk, fg_code, kind, qty, note, created_by)
  select (select private.bom_test_mode()), p_order_pk, t.from_order_pk, t.fg_code, 'untransfer', t.net, '', p_actor
  from (
    select m.from_order_pk, m.fg_code, sum(case when m.kind = 'transfer' then m.qty else -m.qty end) as net
    from public.bom_fg_moves m
    where m.is_test = (select private.bom_test_mode()) and m.order_pk = p_order_pk and m.kind in ('transfer', 'untransfer')
    group by m.from_order_pk, m.fg_code) t
  join public.bom_orders s on s.id = t.from_order_pk
  where t.net > 0
  order by t.fg_code collate "C", s.released_at, s.pi_no collate "C";
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- private.bom_fg_reverse(public.employees, jsonb) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
create or replace function private.bom_fg_reverse(p_actor public.employees, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_pi text;
  v_id_text text;
  v_note text;
  v_ord public.bom_orders%rowtype;
  v_move public.bom_fg_moves%rowtype;
  v_ordered numeric;
  v_have numeric;
  v_out numeric;
  v_delivered numeric;
  v_reopen boolean := false;
begin
  -- รูปแถว (ก่อนสิทธิ์ เหมือนตัวเขียนอื่น)
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) <> 1 then raise exception 'BOM_INVALID_FG'; end if;
  v_row := p_rows -> 0;
  if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_FG'; end if;
  if private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_FG') <> 'reverse' then raise exception 'BOM_INVALID_FG'; end if;
  v_pi := upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_FG'));
  v_id_text := private.bom_text(v_row, 'moveId', 40, 1, 'BOM_INVALID_FG');
  if v_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'BOM_INVALID_FG'; end if;
  v_node := v_row -> 'lines';
  if v_node is not null and jsonb_typeof(v_node) <> 'null' and not (jsonb_typeof(v_node) = 'array' and jsonb_array_length(v_node) = 0) then
    raise exception 'BOM_INVALID_FG';
  end if;
  -- เหตุผลบังคับ 3-300 ตัวอักษร (ตัดช่องว่างหัวท้าย) เก็บใน note ของแถวย้อน
  v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_FG');

  -- สิทธิ์: admin หรือผู้จัดการแผนก (department_manager) ของแผนก WH · พนักงาน WH และกลุ่มวางแผนแผนกอื่น = BOM_FORBIDDEN
  if not (coalesce(private.employee_role_code(p_actor.id) = 'admin', false)
          or (coalesce(private.bom_dept_of(p_actor) = 'WH', false) and coalesce(private.employee_role_code(p_actor.id) = 'department_manager', false))) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  -- ล็อกแถวใบ (เหมือน bom_fg_move): รับ / ส่งมอบ / ย้อนของใบเดียวกันต่อคิวกัน ยอดที่ตรวจจึงไม่ถูกแซง
  select * into v_ord from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = v_pi for update;
  if not found then raise exception 'BOM_INVALID_FG'; end if;
  select * into v_move from public.bom_fg_moves m where m.is_test = (select private.bom_test_mode()) and m.id = v_id_text::uuid;
  if not found or v_move.order_pk <> v_ord.id or v_move.kind not in ('receive', 'deliver') then raise exception 'BOM_INVALID_FG'; end if;
  if exists (select 1 from public.bom_fg_moves m where m.is_test = (select private.bom_test_mode()) and m.reverses_id = v_move.id) then raise exception 'BOM_INVALID_TRANSITION'; end if;
  -- ใบที่ยกเลิกแล้ว (ของที่รับเข้าเป็นสต็อกของรหัสนั้น) และใบร่างย้อนไม่ได้
  if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;

  if v_move.kind = 'receive' then
    v_ordered := coalesce((select sum((it ->> 'qty')::numeric) from jsonb_array_elements(v_ord.items) it where it ->> 'fgCode' = v_move.fg_code), 0);
    v_have := private.bom_fg_have(v_ord.id, v_move.fg_code) - v_move.qty;
    v_out := private.bom_fg_out(v_ord.id, v_move.fg_code);
    v_delivered := private.bom_fg_total(v_ord.id, v_move.fg_code, 'deliver');
    -- ส่งมอบไปแล้วมากกว่าที่จะเหลือ: ย้อนการส่งมอบก่อน
    if v_have - v_out < v_delivered then raise exception 'BOM_FG_EXCEEDS'; end if;
    -- ใบอื่นหยิบสต็อกของใบนี้ไปแล้ว และที่เหลือไม่พอจำนวนสั่ง: ส่วนเกินที่ถูกหยิบไปคือของที่จะย้อน (สต็อกติดลบ) ให้ใบที่หยิบคืนก่อน
    if v_out > 0 and v_have - v_out < v_ordered then raise exception 'BOM_FG_EXCEEDS'; end if;
  end if;

  insert into public.bom_fg_moves (is_test, order_pk, fg_code, kind, qty, note, created_by, reverses_id)
  values ((select private.bom_test_mode()), v_ord.id, v_move.fg_code, case v_move.kind when 'receive' then 'unreceive' else 'undeliver' end, v_move.qty, v_note, p_actor.id, v_move.id);

  -- ใบที่ปิดแล้ว (รับครบ / ปิดใบ / ปิดรับไม่ครบ) ที่หลังย้อนรับเข้ามีสินค้าที่ของไม่ครบตามที่สั่ง: เปิดกลับเป็น in_progress (แถว close เดิมคงอยู่ในประวัติ)
  -- รับเข้าครั้งถัดไปที่ครบปิดเองตามกติกาเดิม (private.bom_fg_move) หรือคลังสินค้าปิดใบ / ปิดรับไม่ครบอีกครั้ง
  if v_move.kind = 'receive' and v_ord.status = 'completed' and exists (
       select 1 from jsonb_array_elements(v_ord.items) it
       where private.bom_fg_have(v_ord.id, it ->> 'fgCode') < (it ->> 'qty')::numeric) then
    update public.bom_orders set status = 'in_progress', completed_at = null, updated_at = now() where id = v_ord.id;
    v_reopen := true;
  end if;
  return jsonb_build_object('moves', 1, 'closed', false, 'reopened', v_reopen);
end;
$$;

-- private.bom_records(bigint) · นิยามล่าสุดจาก 20261128020000_bom_po_partial_fg_reverse.sql
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
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb))
$$;

-- private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
create or replace function private.rf_save_recipes(p_actor uuid, p_head boolean, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_node jsonb;
  v_seen text[] := '{}';
  v_approving text[] := '{}';
  v_code text;
  v_rev numeric;
  v_pcode text;
  v_uom text;
  v_batch numeric;
  v_stages jsonb;
  v_el jsonb;
  v_i integer;
  v_mixer numeric;
  v_dump numeric;
  v_mix numeric;
  v_tol numeric;
  v_rest numeric;
  v_yield numeric;
  v_items jsonb;
  v_status text;
  v_old public.rf_recipes%rowtype;
  v_latest public.rf_recipes%rowtype;
  v_found boolean;
  v_has_latest boolean;
  v_same boolean;
  v_spec jsonb;
begin
  -- รหัสสูตรที่มีแถวกำลังจะเป็น approved ในคำสั่งนี้ (ใช้ยอมรับสำเนา superseded ของตัวเดิมที่ client ส่งมาด้วย)
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    if private.bom_text(v_row, 'status', 20, 0, 'RF_INVALID_RECIPE') = 'approved' then
      v_approving := v_approving || private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    end if;
  end loop;

  for v_row in select value from jsonb_array_elements(p_rows) loop
    v_code := private.bom_text(v_row, 'id', 60, 1, 'RF_INVALID_RECIPE');
    if v_code !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,59}$' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'RF_INVALID_RECIPE', 1, 9999);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'RF_INVALID_RECIPE'; end if;
    if (v_code || '#' || v_rev::integer) = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || (v_code || '#' || v_rev::integer);
    v_pcode := private.bom_text(v_row, 'productCode', 60, 0, 'RF_INVALID_RECIPE');
    v_uom := coalesce(nullif(private.bom_text(v_row, 'uom', 20, 0, 'RF_INVALID_RECIPE'), ''), 'm');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_batch := private.bom_num(v_row -> 'batchKg', 'RF_INVALID_RECIPE', 0, 1000000);
    v_tol := coalesce(private.bom_num(v_row -> 'dumpTol', 'RF_INVALID_RECIPE', 0, 100), 5);
    -- ผสมสองขั้น: ต้องมีขั้น 1 และขั้น 2 อย่างละหนึ่ง (เก็บเรียง 1, 2 ให้เทียบกับที่เก็บได้) อุณหภูมิ 0-1000 °C เวลา > 0 ถึง 1440 นาที
    v_node := v_row -> 'stages';
    if v_node is null or jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) <> 2 then raise exception 'RF_INVALID_RECIPE'; end if;
    v_stages := '[]'::jsonb;
    for v_i in 1..2 loop
      select t.e into v_el from jsonb_array_elements(v_node) as t(e) where jsonb_typeof(t.e) = 'object' and t.e ->> 'stage' = v_i::text;
      if not found then raise exception 'RF_INVALID_RECIPE'; end if;
      v_mixer := private.bom_num(v_el -> 'mixerTemp', 'RF_INVALID_RECIPE', 0, 1000);
      v_dump := private.bom_num(v_el -> 'dumpTemp', 'RF_INVALID_RECIPE', 0, 1000);
      v_mix := private.bom_num(v_el -> 'mixMin', 'RF_INVALID_RECIPE', 0, 1440);
      if v_mixer is null or v_dump is null or v_mix is null or v_mix <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
      v_stages := v_stages || jsonb_build_array(jsonb_build_object('stage', v_i, 'mixerTemp', v_mixer, 'dumpTemp', v_dump, 'mixMin', v_mix));
    end loop;
    v_rest := coalesce(private.bom_num(v_row -> 'restHours', 'RF_INVALID_RECIPE', 0, 1000), 4);
    v_yield := private.bom_num(v_row -> 'yieldPerKg', 'RF_INVALID_RECIPE', 0, 1000000000);
    if v_batch is null or v_batch <= 0 or v_yield is null or v_yield <= 0 then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'RF_INVALID_RECIPE');
    if v_status not in ('draft', 'approved', 'superseded') then raise exception 'RF_INVALID_RECIPE'; end if;
    -- สเปกมิติการฉีด (20261129010000): ไม่ส่ง / null = ไม่มีสเปก
    v_spec := private.rf_parse_extrusion_spec(v_row -> 'extrusionSpec');

    select * into v_old from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_code and r.revision = v_rev::integer;
    v_found := found;
    select * into v_latest from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_code order by r.revision desc limit 1;
    v_has_latest := found;
    v_node := case when v_found then v_old.items when v_has_latest then v_latest.items end;
    v_items := private.rf_parse_items(v_row -> 'items', v_node);

    if v_found then
      v_same := v_old.product_code = v_pcode and v_old.uom = v_uom
        and v_old.batch_kg = v_batch and v_old.stages = v_stages and v_old.dump_tol = v_tol
        and v_old.rest_hours = v_rest and v_old.yield_per_kg = v_yield and v_old.items = v_items
        and v_old.extrusion_spec is not distinct from v_spec;
      -- สำเนาที่ตรงกับแถวล่าสุดทุกช่อง ไม่เขียนอะไร (ไม่ต้องตรวจชน)
      if v_same and v_old.status = v_status then continue; end if;

      -- ชนก่อนสิทธิ์/กฎ revision เสมอ: แถวถูกคนอื่นแก้หลังเวอร์ชันฐาน = client ถือสำเนาเก่า
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if v_old.status = 'draft' then
        if v_status = 'draft' then
          update public.rf_recipes set
            product_code = v_pcode, uom = v_uom, batch_kg = v_batch, stages = v_stages,
            dump_tol = v_tol, rest_hours = v_rest, yield_per_kg = v_yield, items = v_items, extrusion_spec = v_spec, updated_at = now()
          where id = v_old.id;
        elsif v_status = 'approved' then
          -- อนุมัติ: หัว RB เท่านั้น และเนื้อหาต้องตรงกับที่เก็บ (แก้พร้อมอนุมัติในคำสั่งเดียวไม่ได้)
          if not p_head then raise exception 'RF_FORBIDDEN'; end if;
          if not v_same then raise exception 'RF_INVALID_TRANSITION'; end if;
          update public.rf_recipes set status = 'superseded', superseded_at = now(), updated_at = now()
          where is_test = (select private.bom_test_mode()) and recipe_code = v_code and status = 'approved' and id <> v_old.id;
          update public.rf_recipes set status = 'approved', approved_by = p_actor, approved_at = now(), updated_at = now()
          where id = v_old.id;
        else
          raise exception 'RF_INVALID_TRANSITION';
        end if;
      elsif v_old.status = 'approved' then
        if not v_same then raise exception 'RF_REVISION_IMMUTABLE'; end if;
        -- approved -> superseded เกิดเองตอนอนุมัติ revision ใหม่ ยอมรับสำเนา superseded ที่มาพร้อมการอนุมัตินั้น (ข้าม) อย่างอื่นไม่ได้
        if v_status = 'superseded' and v_code = any (v_approving) then continue; end if;
        raise exception 'RF_INVALID_TRANSITION';
      else
        -- superseded เป็นสถานะสุดท้าย
        raise exception 'RF_REVISION_IMMUTABLE';
      end if;
      continue;
    end if;

    -- ระเบียนใหม่: เริ่มเป็นร่างเสมอ
    if v_status <> 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    if not v_has_latest then
      -- สูตรใหม่ทั้งรหัส: รหัสที่ต่างจากของเดิมแค่ตัวพิมพ์ = ซ้ำ · revision แรกต้องเป็น 1
      if exists (select 1 from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and upper(r.recipe_code) = upper(v_code)) then
        raise exception 'RF_CONFLICT';
      end if;
      if v_rev <> 1 then raise exception 'RF_REVISION_ORDER'; end if;
    else
      if v_rev::integer <> v_latest.revision + 1 then
        -- มีคนแก้สูตรนี้หลังเวอร์ชันฐาน = ถือสำเนาเก่า (ตามทันแล้วทำใหม่) ไม่เช่นนั้นข้ามลำดับเอง
        if exists (select 1 from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.recipe_code = v_code
                   and r.changed_version > p_base and r.changed_version <= p_cur) then
          raise exception 'RF_STALE';
        end if;
        raise exception 'RF_REVISION_ORDER';
      end if;
      -- มีร่างค้างอยู่แล้ว: ให้แก้ร่างนั้น ไม่เปิดร่างที่สอง
      if v_latest.status = 'draft' then raise exception 'RF_INVALID_TRANSITION'; end if;
    end if;
    insert into public.rf_recipes (
      is_test, recipe_code, revision, product_code, uom, batch_kg, stages, dump_tol, rest_hours,
      yield_per_kg, items, status, created_by, extrusion_spec)
    values ((select private.bom_test_mode()), v_code, v_rev::integer, v_pcode, v_uom, v_batch, v_stages, v_tol, v_rest,
            v_yield, v_items, 'draft', p_actor, v_spec);
  end loop;
  return cardinality(v_seen);
end;
$$;

-- private.rf_records(bigint) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
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
          'safetyKg', m.safety_kg, 'shelfLifeDays', m.shelf_life_days, 'createdAt', private.bom_ms(m.created_at)) order by m.code collate "C")
      from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
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
        || case when r.extrusion_spec is null then '{}'::jsonb else jsonb_build_object('extrusionSpec', r.extrusion_spec) end
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test = (select private.bom_test_mode()) and r.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb),
    'molds', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', d.mold_no, 'name', d.name, 'kind', d.kind, 'unit', d.unit, 'perCycle', d.per_cycle, 'cleanEvery', d.clean_every,
          'pmLimit', d.pm_limit, 'totalUsage', d.total_usage, 'usageSinceClean', d.usage_since_clean)
        || case when d.last_clean_at is null then '{}'::jsonb else jsonb_build_object('lastCleanAt', private.bom_ms(d.last_clean_at)) end
        order by d.mold_no collate "C")
      from public.rf_molds d where d.is_test = (select private.bom_test_mode()) and d.changed_version > p_since), '[]'::jsonb),
    'materialLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'lotNo', l.lot_no, 'materialCode', l.material_code, 'qtyKg', l.qty_kg, 'initialKg', l.initial_kg, 'expiry', l.expiry,
          'supplier', l.supplier, 'location', l.location, 'status', l.status, 'coa', l.coa,
          'receivedAt', private.bom_ms(l.received_at), 'receivedBy', coalesce(private.bom_person(l.received_by), ''))
        order by l.lot_no collate "C")
      from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_requisitions q where q.is_test = (select private.bom_test_mode()) and q.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_transfers x where x.is_test = (select private.bom_test_mode()) and x.changed_version > p_since), '[]'::jsonb),
    'fgBoxes', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.box_no, 'lotId', b.lot_no, 'orderId', b.order_no, 'recipeId', b.recipe_code, 'productCode', b.product_code,
          'qty', b.qty, 'uom', b.uom, 'grade', b.grade, 'status', b.status, 'createdAt', private.bom_ms(b.created_at))
        || case when b.shipped_at is null then '{}'::jsonb
                else jsonb_build_object('shippedAt', private.bom_ms(b.shipped_at), 'shippedBy', coalesce(private.bom_person(b.shipped_by), '')) end
        order by b.box_no collate "C")
      from public.rf_fg_boxes b where b.is_test = (select private.bom_test_mode()) and b.changed_version > p_since), '[]'::jsonb),
    'qcRecords', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', c.qc_no, 'lotId', c.lot_no, 'orderId', c.order_no, 'stage', c.stage, 'tests', c.tests, 'result', c.result, 'note', c.note,
          'inspector', coalesce(private.bom_person(c.tested_by), ''), 'at', private.bom_ms(c.tested_at),
          'testedBy', coalesce(private.bom_person(c.tested_by), ''), 'testedAt', private.bom_ms(c.tested_at))
        order by c.qc_no collate "C")
      from public.rf_qc_records c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb),
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
      from public.rf_ncrs n where n.is_test = (select private.bom_test_mode()) and n.changed_version > p_since), '[]'::jsonb),
    'purchaseOrders', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', o.po_no, 'status', o.status, 'sourcePi', o.source_pi, 'sourceRequisition', o.source_requisition, 'note', o.note,
          'lines', o.lines, 'createdAt', private.bom_ms(o.created_at), 'createdBy', coalesce(private.bom_person(o.created_by), ''),
          'cancelledAt', private.bom_ms(o.cancelled_at))
        order by o.po_no collate "C")
      from public.rf_purchase_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb))
$$;

-- private.rf_save_lots(public.employees, text, boolean, boolean, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
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

-- private.bom_cancel_rf_job(text, text) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
create or replace function private.bom_cancel_rf_job(p_job_no text, p_wo_no text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_wo public.rf_orders%rowtype;
begin
  if p_wo_no is null then return null; end if;
  perform private.bom_lock_rf();
  select * into v_wo from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = p_wo_no and o.source_job_no = p_job_no for update;
  if not found then return null; end if;
  if v_wo.status in ('planned', 'released', 'in_progress', 'on_hold') then
    update public.rf_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_wo.id;
    return v_wo.wo_no;
  end if;
  return null;
end;
$$;

-- private.bom_cancel_rf_orders(uuid) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
create or replace function private.bom_cancel_rf_orders(p_order_pk uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.bom_jobs%rowtype;
  v_cancelled text[] := '{}';
  v_wo_no text;
begin
  for v_job in
    select j.* from public.bom_jobs j
    where j.is_test = (select private.bom_test_mode()) and j.order_pk = p_order_pk and j.external_ref is not null
    order by j.job_no collate "C"
    for update
  loop
    v_wo_no := private.bom_cancel_rf_job(v_job.job_no, v_job.external_ref ->> 'woId');
    if v_wo_no is not null then v_cancelled := v_cancelled || v_wo_no; end if;
  end loop;
  return v_cancelled;
end;
$$;

-- private.bom_save_jobs(public.employees, text, boolean, text, jsonb, uuid[], bigint, bigint) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
create or replace function private.bom_save_jobs(
  p_actor public.employees, p_actor_name text, p_planner boolean, p_action text, p_rows jsonb, p_released uuid[], p_base bigint, p_cur bigint)
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
  v_rf_cancelled text[] := '{}';
  v_wo_no text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_JOB'; end if;
    v_no := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_JOB');
    if v_no !~ '^[A-Za-z0-9._-]{1,40}$' or v_no = any (v_seen) then raise exception 'BOM_INVALID_JOB'; end if;
    v_seen := v_seen || v_no;
    select * into v_ord from public.bom_orders o
    where o.is_test = (select private.bom_test_mode()) and o.pi_no = upper(private.bom_text(v_row, 'orderId', 40, 1, 'BOM_INVALID_JOB'));
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

    select * into v_old from public.bom_jobs j where j.is_test = (select private.bom_test_mode()) and j.job_no = v_no;
    -- ชนก่อนสิทธิ์/รูปเสมอ: งานถูกคนอื่นแก้หลังเวอร์ชันฐาน หรือถูกลบหลังเวอร์ชันฐาน (เปิดใบกลับมาแก้ / ยกเลิก) = ฝั่ง client ถือสำเนาเก่า
    -- เทียบกับแถวล่าสุดแล้วตัดสินว่าไม่มีสิทธิ์ไม่ได้ (สองคนในแผนกเดียวกันรายงานงานเดียวกันจากฐานเดียวกัน คนที่สองต้องได้ BOM_STALE ไม่ใช่ BOM_FORBIDDEN)
    v_present := found;
    if v_present then
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
    elsif exists (select 1 from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no
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
      delete from public.bom_deleted_keys k where k.is_test = (select private.bom_test_mode()) and k.list = 'jobs' and k.code = v_no;
      insert into public.bom_jobs (
        is_test, job_no, order_pk, dept, item_code, name, kind, uom, qty_planned, qty_required, stock_counted, due_at, fg_codes, created_by)
      values ((select private.bom_test_mode()), v_no, v_ord.id, v_dept, v_item, v_name, v_kind, v_uom, v_planned, v_required, v_stock, v_due::bigint, v_fg, p_actor.id);
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
                  where o.is_test = (select private.bom_test_mode()) and o.wo_no = (v_old.external_ref ->> 'woId') and o.source_job_no = v_old.job_no and o.status in ('planned', 'released', 'cancelled')))
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

    if v_work then
      -- พนักงานแผนก: งานที่ done แล้วแก้ไม่ได้ · ยอดลดไม่ได้
      if not p_planner then
        if v_old.status = 'done' then raise exception 'BOM_INVALID_TRANSITION'; end if;
        if v_done < v_old.qty_done or v_reject < v_old.qty_reject then raise exception 'BOM_INVALID_JOB'; end if;
      end if;
      -- ทุกผู้เรียกรวมกลุ่มวางแผน (20261129010000 · เดิมเฉพาะพนักงานแผนก): ยอดดี / เสียที่เปลี่ยนต้องเท่าผลรวมดี / เสียของรายการรายงานใหม่ในคำสั่งเดียวกัน
      -- รายการรายงานยอดติดลบไม่มี ยอดจึงลดไม่ได้ · ปิด / พักพร้อมเหตุผล (รายการยอด 0) และเปลี่ยนสถานะเฉย ๆ ไม่เปลี่ยนยอดจึงผ่าน
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

    -- ฝ่ายวางแผนปิดงานที่ผูก WO พร้อมเหตุผล (20261129010000): WO ที่ยังไม่จบถูกยกเลิก (planned / released) หรือหยุด (in_progress / on_hold) แบบเดียวกับยกเลิกใบ
    -- completed / cancelled คงเดิม · การผูกของงานคงอยู่ · ผู้เรียก (app_bom_save_master) เพิ่ม version ของ RF และเขียน audit bom:closeJob
    if v_close_note is not null and (v_ext_stored ->> 'woId') is not null then
      v_wo_no := private.bom_cancel_rf_job(v_old.job_no, v_ext_stored ->> 'woId');
      if v_wo_no is not null then v_rf_cancelled := v_rf_cancelled || v_wo_no; end if;
    end if;

    -- งานเริ่มแล้ว (ไม่ใช่ queued ว่าง) -> ใบ released เปลี่ยนเป็น in_progress
    if v_ord.status = 'released'
       and (v_status <> 'queued' or v_done > 0 or v_reject > 0 or jsonb_array_length(v_reports) > 0 or v_ext_stored is not null) then
      v_started := v_started || v_ord.id;
    end if;
  end loop;
  return jsonb_build_object('started', to_jsonb(v_started), 'cancelled', to_jsonb(v_rf_cancelled));
end;
$$;

-- private.bom_save_boms(uuid, text, jsonb, bigint, bigint) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
create or replace function private.bom_save_boms(p_actor uuid, p_actor_name text, p_rows jsonb, p_base bigint, p_cur bigint)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_roots text[] := '{}';
  v_seen text[] := '{}';
  v_id text;
  v_item_code text;
  v_item public.bom_items%rowtype;
  v_rev numeric;
  v_status text;
  v_dept text;
  v_note text;
  v_lines jsonb;
  v_log jsonb;
  v_old public.bom_boms%rowtype;
  v_max integer;
  v_changed boolean;
  v_pk uuid;
  v_content boolean;
  v_locked boolean;
  v_inplace boolean;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_BOM'; end if;
    v_id := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_BOM');
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' or v_id = any (v_seen) then raise exception 'BOM_INVALID_BOM'; end if;
    v_seen := v_seen || v_id;
    v_item_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_BOM'));
    select * into v_item from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_item_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'BOM_INVALID_BOM', 1, 100000);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'BOM_INVALID_BOM'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_BOM');
    if v_status not in ('approved', 'superseded') then raise exception 'BOM_INVALID_BOM'; end if;
    v_dept := private.bom_dept(coalesce(nullif(private.bom_text(v_row, 'ownerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), v_item.owner_dept));
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_BOM');
    v_lines := private.bom_parse_lines(v_item_code, v_dept, v_row -> 'lines');

    select * into v_old from public.bom_boms b where b.is_test = (select private.bom_test_mode()) and b.bom_id = v_id;
    if found then
      -- มีคนอื่นแก้ revision นี้หลังเวอร์ชันฐานของ client (เช่น ตั้ง superseded ด้วย revision ใหม่ หรือย้ายแผนกเจ้าของ)
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'BOM_STALE'; end if;
      -- revision ที่มีอยู่แล้วเปลี่ยนได้เฉพาะ approved -> superseded, แผนกเจ้าของ และ changeLog ต่อท้าย · ชิ้นและเลข revision เปลี่ยนไม่ได้เสมอ
      if v_old.item_code <> v_item_code or v_old.revision <> v_rev::integer then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      if v_old.status = 'superseded' and v_status = 'approved' then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      -- แก้บรรทัด / หมายเหตุในฉบับเดิม (20261129010000): ฉบับเดิมและที่ส่งมาเป็น approved และเป็น revision สูงสุดของชิ้น · ผู้อนุมัติฉบับนั้นคือผู้บันทึกครั้งนี้
      -- อนุมัติวันเดียวกับวันนี้ (Asia/Bangkok) · ไม่มีใบสั่งผลิตที่ไม่ใช่ร่าง (รวม cancelled) ที่ explosion อ้างฉบับนี้ · ไม่ครบ = BOM_REVISION_IMMUTABLE เหมือนเดิม
      v_content := v_old.note <> v_note or private.bom_lines_json(v_old.id) <> v_lines;
      if v_content then
        v_locked := exists (
          select 1 from public.bom_orders o, jsonb_array_elements(coalesce(o.explosion, '[]'::jsonb)) as e(line)
          where o.is_test = (select private.bom_test_mode()) and o.status <> 'draft' and e.line ->> 'bomId' = v_old.bom_id);
        v_inplace := coalesce(
          v_old.status = 'approved' and v_status = 'approved'
          and v_old.approved_by = p_actor
          and (v_old.approved_at at time zone 'Asia/Bangkok')::date = (now() at time zone 'Asia/Bangkok')::date
          and not exists (select 1 from public.bom_boms b where b.is_test = (select private.bom_test_mode()) and b.item_code = v_old.item_code and b.revision > v_old.revision)
          and not v_locked, false);
        if not v_inplace then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      end if;
      v_log := private.bom_log(v_row -> 'changeLog', v_old.change_log, p_actor_name);
      -- การแก้ในฉบับเดิมต้องมีบันทึกการแก้ต่อท้ายอย่างน้อยหนึ่งรายการ (ประวัติของฉบับบอกว่าแก้อะไร)
      if v_content and jsonb_array_length(v_log) <= jsonb_array_length(v_old.change_log) then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      update public.bom_boms set
        status = v_status,
        superseded_at = case when v_old.status = 'approved' and v_status = 'superseded' then now() else v_old.superseded_at end,
        owner_dept = v_dept,
        note = v_note,
        change_log = v_log
      where id = v_old.id;
      if v_content then
        -- บรรทัดถูกแทนทั้งชุดในลำดับที่ส่งมา · ชิ้นนี้เข้ารายการตรวจกฎ / วงจรหลังเขียนเหมือน revision ใหม่
        delete from public.bom_bom_lines l where l.bom_pk = v_old.id;
        insert into public.bom_bom_lines (
          is_test, bom_pk, line_no, step, child_code, qty, uom, consumer_dept, producer_dept, scrap_pct, flags, note)
        select (select private.bom_test_mode()), v_old.id, (t.ord - 1)::integer, (t.ln ->> 'step')::integer, t.ln ->> 'childCode',
               (t.ln ->> 'qty')::numeric, t.ln ->> 'uom', t.ln ->> 'consumerDept', t.ln ->> 'producerDept',
               (t.ln ->> 'scrapPct')::numeric, t.ln -> 'flags', t.ln ->> 'note'
        from jsonb_array_elements(v_lines) with ordinality as t(ln, ord);
        v_roots := v_roots || v_item_code;
      end if;
    else
      -- revision ใหม่: approved เสมอ และต้องเป็น (สูงสุดเดิม + 1) ตัวที่ approved อยู่ถูกตั้ง superseded ในคำสั่งเดียวกัน
      if v_status <> 'approved' then raise exception 'BOM_INVALID_BOM'; end if;
      select coalesce(max(b.revision), 0), coalesce(bool_or(b.changed_version > p_base and b.changed_version <= p_cur), false)
      into v_max, v_changed from public.bom_boms b where b.is_test = (select private.bom_test_mode()) and b.item_code = v_item_code;
      -- มีคนอื่นเพิ่ม/แก้ revision ของชิ้นนี้หลังเวอร์ชันฐานของ client = ชน (ให้ client โหลดส่วนต่างแล้วทำใหม่) · เลขรุ่นข้ามลำดับโดยไม่มีใครแก้ = ผิดลำดับ
      if v_changed then raise exception 'BOM_STALE'; end if;
      if v_rev::integer <> v_max + 1 then raise exception 'BOM_REVISION_ORDER'; end if;
      update public.bom_boms set status = 'superseded', superseded_at = now()
      where is_test = (select private.bom_test_mode()) and item_code = v_item_code and status = 'approved';
      v_log := private.bom_log(v_row -> 'changeLog', null, p_actor_name);
      insert into public.bom_boms (
        is_test, bom_id, item_code, revision, status, owner_dept, note, created_by, approved_by, approved_at, change_log)
      values ((select private.bom_test_mode()), v_id, v_item_code, v_rev::integer, 'approved', v_dept, v_note, p_actor, p_actor, now(), v_log)
      returning id into v_pk;
      insert into public.bom_bom_lines (
        is_test, bom_pk, line_no, step, child_code, qty, uom, consumer_dept, producer_dept, scrap_pct, flags, note)
      select (select private.bom_test_mode()), v_pk, (t.ord - 1)::integer, (t.ln ->> 'step')::integer, t.ln ->> 'childCode',
             (t.ln ->> 'qty')::numeric, t.ln ->> 'uom', t.ln ->> 'consumerDept', t.ln ->> 'producerDept',
             (t.ln ->> 'scrapPct')::numeric, t.ln -> 'flags', t.ln ->> 'note'
      from jsonb_array_elements(v_lines) with ordinality as t(ln, ord);
      v_roots := v_roots || v_item_code;
    end if;
  end loop;
  return v_roots;
end;
$$;

-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) · นิยามล่าสุดจาก 20261129010000_bom_group2_rules.sql
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
  v_rf_close_n integer := 0;
  v_jobs jsonb;
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
