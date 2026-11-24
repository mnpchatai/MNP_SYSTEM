-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: โรงงาน ขั้น 5 (QA) การตัดสินสามเรื่องเป็นของหัวหน้า QA
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-24, factory-step5-qa-spec ข้อ 4-6): "ให้หัวหน้า QA เท่านั้น" สำหรับ
--   A) ปล่อยล็อตที่กักในสายผลิต: ผลตรวจใหม่ที่เป็น pass หรือ fail บนล็อต RubberFlow ที่ qc ปัจจุบันเป็น hold
--   B) ตัดสินยางเส้นยาวที่ SR กัก: decideRods (accept / return / scrap) ของล็อต held ในคลังยางเส้นยาว
--   C) ปล่อยวัตถุดิบที่กัก: ล็อตวัตถุดิบ hold -> available · คำสั่งเพิ่มของเจ้าของ (2026-11-24): "วัตถุดิบที่กักให้มี 2 ที่ คือ QA และ ST และให้หัวหน้า ST ปลดได้ด้วย"
--      = หัวหน้า QA หรือหัวหน้า ST (private.material_release_ok) · ข้อ A และ B ยังเป็นหัวหน้า QA อย่างเดียว
--   ผู้ทำแทนได้: ผู้จัดการโรงงาน / ผู้จัดการทั่วไป / ผู้ดูแลระบบ · ฝ่ายวางแผน (PP) หัวหน้าแผนกอื่น (รวมหัวหน้า RB) และพนักงาน QA / ST ทั่วไปทำไม่ได้แล้ว
--   ไม่เปลี่ยน: บันทึกผล hold บนล็อตที่กัก · บันทึกผลใดก็ได้บนล็อตที่ไม่ได้กัก (QA ทุกบทบาท หรือกลุ่มวางแผน) · กักวัตถุดิบ (กลุ่มวางแผน / ST / QA)
--     · ข้ามเวลาบ่ม endRest (หัวหน้า RB หรือ QA ทุกบทบาท ต้องมีเหตุผล) · เปิด / ปิด NCR ของ RubberFlow
--   ทางอื่นที่ปล่อยล็อตที่กัก: ไม่มี · rf_save_ncrs เปิด NCR = กักล็อตที่ pass (hold) แต่ปิด NCR ไม่ปล่อยล็อต (ปล่อยด้วยผลตรวจใหม่ผ่าน rf_save_qc เท่านั้น)
--     · rf_save_lots ล็อตเดิมแก้ได้แค่ endRest · rf_save_boxes ไม่เปลี่ยนกล่อง hold · กล่องกลับจาก hold ได้เฉพาะใน rf_save_qc
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และกลไก bom_actor / rf_actor / rf_reader
--
-- หัวหน้า QA = private.qa_head(public.employees) (ใหม่ · security definer · search_path = '' · revoke all from public, anon, authenticated)
--   (แผนก QA ตาม private.rf_is_qa และบทบาท department_manager / assistant_department_manager · แบบเดียวกับ private.rf_is_rb_head)
--   หรือบทบาท factory_manager / general_manager / admin (ทุกแผนก)
--   ไม่รวม assistant_factory_manager: เจ้าของระบุ "ผู้จัดการโรงงาน" และบทบาทนี้ไม่ได้เท่ากับ factory_manager ทุกที่ (เช่น NCR phase 1 ใช้ factory_manager อย่างเดียว)
--   แผนก QC ไม่มีในตาราง departments (QC เป็นชื่อเรียกของ QA) จึงตรวจรหัส QA อย่างเดียวผ่าน private.rf_is_qa
-- ผู้ปล่อยวัตถุดิบที่กัก = private.material_release_ok(public.employees) (ใหม่ · security definer · search_path = '' · revoke all from public, anon, authenticated)
--   = private.qa_head หรือหัวหน้า ST (แผนก ST ตาม private.bom_dept_of และบทบาท department_manager / assistant_department_manager · แบบเดียวกับ qa_head)
--
-- รหัสข้อผิดพลาดใหม่ (client แสดงข้อความภาษาไทยได้): RF_QA_HEAD_ONLY (app_rf_save: addQcRecord บนล็อตที่กัก)
--   · RF_MATERIAL_RELEASE_HEAD_ONLY (app_rf_save: setMaterialLotStatus ปล่อยล็อตวัตถุดิบ hold -> available โดยผู้ที่ไม่ใช่หัวหน้า QA / หัวหน้า ST)
--   · BOM_QA_HEAD_ONLY (app_bom_save_master: decideRods · ทุกคนที่ไม่ใช่หัวหน้า QA รวม SR / RB ที่เดิมได้ BOM_FORBIDDEN)
--   ลำดับตรวจเดิมคงอยู่: รูปแถว / ค่าไม่ถูก -> ชน (RF_STALE) -> สิทธิ์เดิม (RF_FORBIDDEN) -> หัวหน้า QA · fail เป็นสถานะสุดท้ายยังได้ RF_INVALID_TRANSITION ก่อน
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main 2119c68 เปลี่ยนเฉพาะสิทธิ์)
--   - private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint)  จาก 20261207010000_wh_rb_boxes.sql
--   - private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb)  จาก 20261204010000_bom_sr_store_module.sql
--   - private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   ไม่แตะ: public.app_rf_save / public.app_bom_save_master (ด่านหยาบเดิม QA และกลุ่มวางแผนยังเข้าได้ ตัวเขียนตัดสินเอง) · private.rf_save_ncrs · private.rf_save_lots
--     · private.rf_is_qa / rf_is_rb_head / bom_can_edit · private.bom_real_open() · rf_actor() · bom_actor()
--
-- ลำดับ deploy: backward compatible ทั้งสองทาง (ไม่มีช่องหรือ action ใหม่ แค่ปฏิเสธเพิ่ม)
--   Pilot เก่า + ฐานข้อมูลใหม่: ปุ่มตัดสินของพนักงาน QA / กลุ่มวางแผนยังแสดงแต่กดแล้วได้ RF_QA_HEAD_ONLY / RF_MATERIAL_RELEASE_HEAD_ONLY / BOM_QA_HEAD_ONLY (ข้อความผิดพลาดทั่วไป)
--   Pilot ใหม่ + ฐานข้อมูลเก่า: ซ่อนปุ่มของผู้ที่ไม่ใช่หัวหน้า QA (วัตถุดิบ: หัวหน้า QA / ST) แต่ฐานข้อมูลยังยอมให้พนักงาน QA / ST / กลุ่มวางแผนตัดสินถ้าเรียก RPC ตรง
--   ก่อน apply ที่ production (ต้องได้อนุมัติของผู้ใช้สำหรับไฟล์นี้): เทียบ md5(pg_get_functiondef(oid)) ของสามฟังก์ชันที่ replace กับนิยามในไฟล์ต้นทางที่ระบุ
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test + has_function_privilege ของ private.qa_head / private.material_release_ok
--
-- Rollback (ไม่มีข้อมูลเปลี่ยน · ไม่ต้องลบแถว):
--   1) create or replace สามฟังก์ชันกลับด้วยนิยามในไฟล์ต้นทาง (rf_save_qc จาก 20261207010000_wh_rb_boxes.sql · bom_rod_save_lots จาก
--      20261204010000_bom_sr_store_module.sql · rf_save_material_lots จาก 20261130010000_bom_rf_go_live.sql) ลายเซ็นเดิม สิทธิ์เดิมคงอยู่
--   2) drop function private.material_release_ok(public.employees); แล้ว drop function private.qa_head(public.employees);  (หลังข้อ 1 เท่านั้น เพราะสามฟังก์ชันใหม่เรียกสองตัวนี้)
-- ============================================================================

-- 1. หัวหน้า QA ------------------------------------------------------------------------------------------------------------------
-- หัวหน้า QA: สมาชิกแผนก QA ที่เป็น department_manager / assistant_department_manager หรือบทบาท factory_manager / general_manager / admin
create or replace function private.qa_head(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (private.rf_is_qa(p_employee)
          and coalesce(private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager'), false))
      or coalesce(private.employee_role_code(p_employee.id) in ('factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.qa_head(public.employees) from public, anon, authenticated;
comment on function private.qa_head(public.employees) is 'หัวหน้า QA (20261221010000): แผนก QA บทบาท department_manager / assistant_department_manager หรือบทบาท factory_manager / general_manager / admin · ผู้ตัดสินล็อตที่กัก (rf_save_qc) ยางเส้นยาวที่กัก (decideRods) · ปล่อยวัตถุดิบที่กักผ่าน private.material_release_ok';

-- หัวหน้า QA หรือหัวหน้า ST: ผู้ปล่อยวัตถุดิบที่กัก (hold -> available) · หัวหน้า ST = สมาชิกแผนก ST ที่เป็น department_manager / assistant_department_manager
create or replace function private.material_release_ok(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.qa_head(p_employee)
      or (coalesce(private.bom_dept_of(p_employee) = 'ST', false)
          and coalesce(private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager'), false))
$$;
revoke all on function private.material_release_ok(public.employees) from public, anon, authenticated;
comment on function private.material_release_ok(public.employees) is 'ผู้ปล่อยวัตถุดิบที่กัก (20261221010000): private.qa_head หรือหัวหน้า ST (แผนก ST บทบาท department_manager / assistant_department_manager) · ใช้ใน rf_save_material_lots ตอน hold -> available';

-- 2. ตัดสินล็อตที่กักของสายผลิต ------------------------------------------------------------------------------------------------
-- private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) จาก 20261207010000_wh_rb_boxes.sql (+ ล็อตที่กัก: pass / fail = หัวหน้า QA)
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
  v_linked boolean;
  v_dest text;
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
    -- 20261221010000: ตัดสินล็อตที่กักอยู่ (qc ปัจจุบัน = hold) เป็น pass (ปล่อย) หรือ fail = หัวหน้า QA (private.qa_head) เท่านั้น
    --   พนักงาน QA และกลุ่มวางแผนที่ไม่ใช่หัวหน้า QA ยังบันทึกผล hold ซ้ำบนล็อตที่กัก และบันทึกผลใดก็ได้บนล็อตที่ไม่ได้กักเหมือนเดิม
    --   ล็อตเปลี่ยนหลังเวอร์ชันฐานของผู้เรียก (เช่นเพิ่งถูกกักด้วย NCR) = RF_STALE ก่อน RF_QA_HEAD_ONLY
    if v_lot.qc = 'hold' and v_result in ('pass', 'fail') and not private.qa_head(p_actor) then
      perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_QA_HEAD_ONLY');
    end if;

    insert into public.rf_qc_records (is_test, qc_no, lot_no, order_no, stage, tests, result, note, tested_by)
    values ((select private.bom_test_mode()), v_no, v_lot.lot_no, v_lot.order_no, v_lot.stage, v_tests, v_result, v_note, p_actor.id);
    v_count := v_lot.stage = 'finishing' and v_result = 'pass' and not v_lot.counted_to_order;
    v_dest := v_lot.destination;
    v_linked := false;
    if v_count then
      select * into v_wo from public.rf_orders o where o.is_test = (select private.bom_test_mode()) and o.wo_no = v_lot.order_no;
      v_linked := coalesce(private.bom_rod_wo_linked(v_wo), false);
      -- 20261207010000: ล็อตที่กักไว้ไม่มีปลายทาง QA ปล่อยครั้งแรก = WO ที่ผูกงานไปคลังยางเส้นยาว SR (เหมือนเดิม) · WO ที่ไม่ผูกงานส่งมอบให้ลูกค้าผ่าน WH
      v_dest := coalesce(v_dest, case when v_linked then 'sr' else 'customer' end);
    end if;
    update public.rf_lots set
      qc = v_result,
      hold_reasons = case when v_result = 'pass' then '[]'::jsonb else hold_reasons end,
      counted_to_order = counted_to_order or v_count,
      destination = v_dest,
      updated_at = now()
    where id = v_lot.id
      and (qc is distinct from v_result or (v_result = 'pass' and hold_reasons <> '[]'::jsonb) or v_count);
    -- กล่องตามผล QA (20261207010000): ผ่าน = เฉพาะกล่องที่กักไว้ (hold) กลับที่เดิม (WH รับเข้าแล้ว received_at มีค่า = in_stock · ยังไม่รับ = pending_wh รอ WH รับ)
    --   กล่องที่รอ WH / อยู่ในคลัง / ส่งมอบแล้วไม่ถูกแตะ (QA ผ่านซ้ำไม่ส่งกล่องในคลังกลับไปรอ WH) · อื่น = กล่องที่ยังไม่ส่งมอบและยังไม่กักเป็น hold
    update public.rf_fg_boxes b
    set status = (case when v_result <> 'pass' then 'hold' when b.received_at is null then 'pending_wh' else 'in_stock' end), updated_at = now()
    where b.is_test = (select private.bom_test_mode()) and b.lot_no = v_lot.lot_no
      and (case when v_result = 'pass' then b.status = 'hold' else b.status not in ('shipped', 'hold') end);
    -- QA ตัดสินไม่ผ่าน (fail · สถานะสุดท้าย) ล็อตที่นับยอดเข้างาน RB ไว้ตอน WH รับเข้า: ถอนยอดนั้นในธุรกรรมเดียวกัน (รายงาน good 0 ของงานบอกล็อต ยอด และเลขผลตรวจ · ล้าง wh_credit_*)
    --   QA ต้องบันทึกไม่ผ่านได้เสมอ: ใบที่ไม่ใช่ released / in_progress (completed / ยกเลิก) หรือไม่พบงาน = บันทึกผล fail โดยไม่ถอนยอดและคง wh_credit_* ไว้
    if v_result = 'fail' and v_lot.wh_credit_qty is not null then
      v_res := private.rf_box_uncredit(p_actor.first_name || ' ' || p_actor.last_name, v_lot, 'qa_fail', v_no);
      v_jobs := v_jobs + (v_res ->> 'jobs')::integer;
    end if;
    if v_count then
      perform private.rf_add_produced(v_lot.order_no, v_lot.good_qty, p_may_close, p_base, p_cur);
      -- QA ตัดสินล็อตตกแต่งเป็น pass ครั้งแรก = ชิ้นผ่านสถานีสุดท้าย ป้อนผลผลิตกลับงาน BOM ณ จุดเดียวกับที่นับเข้า WO
      -- 20261202010000: ล็อตของ WO ที่ผูกงาน BOM เป็นแท่งรอรับเข้าคลัง SR (ครั้งเดียว: v_count เป็นจริงครั้งเดียวต่อล็อต) แทนการป้อนยอดให้งาน
      if v_linked then
        if v_dest = 'sr' then
          v_rods := v_rods + private.bom_rod_lot_create(v_lot, v_wo);
        end if;
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
revoke all on function private.rf_save_qc(public.employees, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 3. ตัดสินยางเส้นยาวที่ SR กัก ------------------------------------------------------------------------------------------------
-- private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb) จาก 20261204010000_bom_sr_store_module.sql (+ decideRods = หัวหน้า QA)
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
  v_item public.bom_items%rowtype;
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
  v_location text;
  v_lot_no text;
  v_code text;
  v_res jsonb := jsonb_build_object('moves', 0, 'jobs', 0, 'orders', 0);
begin
  if p_action is null or p_action not in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') then raise exception 'BOM_INVALID_ROD'; end if;
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
    -- ตำแหน่งจัดเก็บ (จำเป็น) 1-40 ตัวอักษรหลังตัดช่องว่าง
    v_location := private.bom_text(v_row, 'location', 40, 1, 'BOM_INVALID_ROD');
  elsif p_action = 'decideRods' then
    v_decision := private.bom_text(v_row, 'decision', 10, 1, 'BOM_INVALID_ROD');
    if v_decision not in ('accept', 'return', 'scrap') then raise exception 'BOM_INVALID_ROD'; end if;
    v_note := private.bom_text(v_row, 'decisionNote', 300, 3, 'BOM_INVALID_ROD');
  elsif p_action = 'receiveRodsOpening' then
    -- เลขล็อตตัวพิมพ์ใหญ่ 1-40 · FN- เป็นของล็อตตกแต่งของ RubberFlow (bom_rod_lot_create ใช้เลขเดียวกัน) จึงใช้ไม่ได้
    v_lot_no := upper(private.bom_text(v_row, 'lotNo', 40, 1, 'BOM_INVALID_ROD'));
    if v_lot_no like 'FN-%' then raise exception 'BOM_INVALID_ROD'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_ROD'));
    if v_code = '' then raise exception 'BOM_INVALID_ROD'; end if;
    v_q := private.bom_num(v_row -> 'qty', 'BOM_INVALID_ROD', 0, 1000000000);
    if v_q is null or v_q <= 0 then raise exception 'BOM_INVALID_ROD'; end if;
    v_location := private.bom_text(v_row, 'location', 40, 1, 'BOM_INVALID_ROD');
    -- ที่มา / เหตุผล (จำเป็น) 3-300
    v_note := private.bom_text(v_row, 'note', 300, 3, 'BOM_INVALID_ROD');
  else
    v_location := private.bom_text(v_row, 'location', 40, 1, 'BOM_INVALID_ROD');
  end if;

  -- สิทธิ์: รับเข้า / รับนอกใบสั่ง / ย้ายตำแหน่ง = แผนก SR หรือกลุ่มวางแผน
  -- ตัดสินล็อตที่กัก (20261221010000) = หัวหน้า QA (private.qa_head) เท่านั้น · พนักงาน QA กลุ่มวางแผน และแผนกอื่น = BOM_QA_HEAD_ONLY
  if p_action in ('receiveRods', 'receiveRodsOpening', 'setRodLocation') and not (p_planner or coalesce(v_dept = 'SR', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;
  if p_action = 'decideRods' and not private.qa_head(p_actor) then raise exception 'BOM_QA_HEAD_ONLY'; end if;

  -- รับนอกใบสั่ง: ล็อตใหม่ stored เป็นสต็อกกลางทันที (ไม่มีผลตรวจขนาด ไม่มีใบ / งาน / WO) + แถว receive
  if p_action = 'receiveRodsOpening' then
    select * into v_item from public.bom_items i where i.is_test = (select private.bom_test_mode()) and i.code = v_code;
    if not found or v_item.kind <> 'RB' then raise exception 'BOM_INVALID_ROD'; end if;
    if exists (select 1 from public.bom_rod_lots l where l.id = v_id_text::uuid) then raise exception 'BOM_INVALID_ROD'; end if;
    if exists (select 1 from public.bom_rod_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_lot_no) then
      raise exception 'BOM_INVALID_ROD';
    end if;
    insert into public.bom_rod_lots (id, is_test, lot_no, item_code, order_pk, job_no, wo_no, recipe_code, uom, qty_sent, spec, status,
                                     qty_received, qc, received_by, received_at, location, source, source_note)
    values (v_id_text::uuid, (select private.bom_test_mode()), v_lot_no, v_item.code, null, null, null, null, v_item.uom, trim_scale(v_q), null, 'stored',
            trim_scale(v_q), null, p_actor.id, clock_timestamp(), v_location, 'opening', v_note)
    returning * into v_lot;
    insert into public.bom_rod_moves (is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((select private.bom_test_mode()), v_lot.id, v_lot.item_code, 'receive', v_lot.qty_received, null, null, v_note, p_actor.id);
    return jsonb_build_object('lots', 1, 'moves', 1, 'jobs', 0, 'orders', 0);
  end if;

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
      received_at = clock_timestamp(),
      location = v_location
    where id = v_lot.id
    returning * into v_lot;
    if v_result = 'pass' then
      v_res := private.bom_rod_credit(p_actor.id, p_actor_name, v_lot);
    end if;
  elsif p_action = 'decideRods' then
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
  else
    -- ย้ายตำแหน่ง: เฉพาะล็อตที่อยู่ในคลัง (stored) หรือกักรอ QA (held) · ล็อตรอรับ คืน RB หรือทิ้งแล้ว = BOM_INVALID_TRANSITION
    if v_lot.status not in ('held', 'stored') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    update public.bom_rod_lots set location = v_location where id = v_lot.id;
  end if;
  return v_res || jsonb_build_object('lots', 1);
end;
$$;
revoke all on function private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb) from public, anon, authenticated;

-- 4. ปล่อยวัตถุดิบที่กัก ----------------------------------------------------------------------------------------------------------
-- private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql (+ hold -> available = หัวหน้า QA หรือหัวหน้า ST)
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
  v_emp public.employees%rowtype;
begin
  select * into v_emp from public.employees e where e.id = p_actor;
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
      -- 20261221010000: ปล่อยล็อตที่กัก (hold -> available) = หัวหน้า QA หรือหัวหน้า ST (private.material_release_ok) เท่านั้น · กัก (available -> hold) = กลุ่มวางแผน / ST / QA เหมือนเดิม
      if v_old.status = 'hold' and v_status = 'available' and not private.material_release_ok(v_emp) then raise exception 'RF_MATERIAL_RELEASE_HEAD_ONLY'; end if;
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
revoke all on function private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;
