-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: แผนกคลังวัตถุดิบ (ST) ตั้งสต็อกขั้นต่ำได้ด้วย ทั้งของซื้อ (BOM bom_stock.safety_qty) และเคมี (RubberFlow rf_materials.safety_kg)
--
-- ทำไม: ผู้ใช้ตัดสิน 2026-11-14 ให้แผนก ST ตั้งสต็อกขั้นต่ำได้เองเพิ่มจากกลุ่มวางแผน (PP, ผู้จัดการแผนกขึ้นไป, admin) ที่มีสิทธิ์อยู่แล้ว
--   เหตุ: ตั้งแต่ 20261119010000_rf_purchase_by_st.sql มีแต่ ST ที่สร้างใบสั่งซื้อได้ แต่ ST เปลี่ยนสต็อกขั้นต่ำไม่ได้ ช่องสต็อกขั้นต่ำในหน้าต่างสั่งซื้อจึงใช้ไม่ได้สำหรับคนเดียวที่สั่งของ
--
-- สิ่งที่เปลี่ยน (เงื่อนไขสิทธิ์ 4 จุดใน 3 ฟังก์ชัน กับข้อ 4 ด้านล่าง ไม่เปลี่ยนอย่างอื่น: ลำดับตรวจ, รหัสข้อผิดพลาด, ผลที่คืน, ลายเซ็น, สิทธิ์ EXECUTE)
--   1) private.bom_save_stock (action countPartStock): เปลี่ยนสต็อกขั้นต่ำ (safetyQty)  p_planner  ->  p_planner หรือแผนก ST  (ไม่เช่นนั้น BOM_FORBIDDEN)
--      WH ยังนับยอดได้อย่างเดียว (ไม่มีสิทธิ์สต็อกขั้นต่ำ) · QA / SR / RB / ผู้ช่วยผู้จัดการแผนกนอกกลุ่มวางแผน ยังเปลี่ยนไม่ได้
--   2) private.rf_save_purchase_orders (สร้างใบใหม่ บรรทัดของซื้อ source 'bom'): เปลี่ยนสต็อกขั้นต่ำของชิ้นที่มีแถวสต็อกแล้ว และสร้างแถวสต็อกใหม่ที่ safetyKg <> 0
--      p_planner  ->  (p_planner หรือ p_st)  ทั้งสองจุด · หมายเหตุ: ด่านบนสุดของสาขาใบใหม่ (p_st หรือ admin) ผ่านแล้วเท่ากับเป็น ST หรือ admin ซึ่ง admin นับเป็นกลุ่มวางแผนอยู่แล้ว
--      เงื่อนไขนี้จึงไม่ปฏิเสธใครอีกในปัจจุบัน แต่คงไว้เป็นด่านชั้นใน เผื่อสิทธิ์สร้างใบถูกเปลี่ยนภายหลัง
--   3) public.app_rf_save (ด่านหยาบรายส่วน): ส่วน 'materials'  v_planner หรือ v_rb  ->  v_planner หรือ v_rb หรือ (v_st และ p_action = 'createPurchaseOrder')
--      ST ส่งชุด materials ได้เฉพาะพร้อมคำสั่งสร้างใบสั่งซื้อ (saveMaterial หรือ action อื่นที่พก materials มาด้วย = RF_FORBIDDEN เหมือนเดิม)
--      ตัวเขียน private.rf_save_materials (20261110010000_rf_purchase_orders.sql ยังเป็นนิยามล่าสุด ไม่มี migration ไหนแทน) ไม่ตรวจบทบาทเอง แต่ใต้ createPurchaseOrder
--      มันให้ต่างจากที่เก็บได้ช่อง safetyKg ช่องเดียว (ช่องอื่นต่าง = RF_INVALID_MATERIAL) และสร้างวัตถุดิบใหม่ไม่ได้ (RF_INVALID_MATERIAL) จึงไม่ต้องแก้ ST เปลี่ยนสต็อกขั้นต่ำของเคมีได้เฉพาะเป็นส่วนหนึ่งของการสร้างใบสั่งซื้อ
--      ธุรกรรมเดียวกับการสร้างใบ: ใบถูกปฏิเสธ (เช่น ไม่ใช่ ST / admin) = สต็อกขั้นต่ำที่พ่วงมาย้อนด้วย
--      หมายเหตุ: ด่านนี้ดูเฉพาะชื่อคำสั่ง ST จึงส่ง createPurchaseOrder ที่มีแต่ชุด materials (ไม่มีใบ) เพื่อแก้ safetyKg ของเคมีได้ด้วย
--      ซึ่งอยู่ในกติกา "ST ตั้งสต็อกขั้นต่ำได้" (ช่องอื่นของวัตถุดิบยังแก้ไม่ได้) · Pilot ไม่ส่งแบบนั้น
--   4) private.rf_save_purchase_orders อ่านช่อง storedSafetyKg ของบรรทัดของซื้อในใบใหม่ (ค่าที่หน้าต่างสั่งซื้อแสดงตอนเปิด ไม่บังคับ ไม่เก็บลงใบ):
--      safetyKg = storedSafetyKg แปลว่าผู้สั่งไม่ได้แก้ช่อง จึงไม่เขียนทับ bom_stock.safety_qty ที่ผู้อื่นเพิ่งตั้ง และบรรทัดของใบเก็บค่าที่ใช้อยู่จริง
--      (เดิมผู้สั่งที่ไม่มีสิทธิ์ได้ RF_FORBIDDEN จากหน้าต่างค่าเก่า เมื่อ ST มีสิทธิ์แล้วค่าเก่าจะถูกเขียนทับเงียบ ๆ) · ไม่ส่งช่องนี้ = เทียบกับที่เก็บเหมือนเดิม
--   - ไม่เปลี่ยน: สิทธิ์ของกลุ่มวางแผน / RB (RB ยังตั้งสต็อกขั้นต่ำของเคมีได้ทาง saveMaterial) · RB ยังสร้างใบสั่งซื้อไม่ได้ (RF_FORBIDDEN) · สิทธิ์รับ/ยกเลิกใบ · ตารางทั้งหมด RLS สิทธิ์ตาราง
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิมทั้งหมด; เริ่มจากนิยามล่าสุดบน main; ตัวเขียนเป็น security definer + set search_path = '' เหมือนต้นทาง)
--   - private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint) จาก 20261111010000_bom_part_stock.sql
--     revoke all from public, anon, authenticated เหมือนต้นทาง (เรียกผ่าน public.app_bom_save_master เท่านั้น)
--   - private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261119010000_rf_purchase_by_st.sql
--     revoke all from public, anon, authenticated เหมือนต้นทาง (เรียกผ่าน public.app_rf_save เท่านั้น)
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261116010000_rf_bom_feedback_on_finishing.sql
--     สิทธิ์เหมือนต้นทาง: revoke all from public, anon · grant execute to authenticated (perform private.lab_only_block() ต่อท้าย begin เหมือนเดิม)
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ทำให้ช่องสต็อกขั้นต่ำแก้ได้สำหรับ ST จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md
--   Pilot รุ่นใหม่กับฐานข้อมูลเก่า: ST แก้สต็อกขั้นต่ำแล้วถูกปฏิเสธ (BOM_FORBIDDEN / RF_FORBIDDEN) แต่อย่างอื่นไม่พัง
--   Pilot รุ่นเก่ากับฐานข้อมูลใหม่: ไม่เห็นความต่าง (รุ่นเก่าไม่เปิดช่องให้ ST แก้)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของสามฟังก์ชันที่ production กับนิยามในไฟล์ต้นทางที่ระบุข้างบน (ถ้ามี migration อื่นแก้ไปแล้วต้องเริ่มจากนิยามล่าสุด)
--   แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test และตรวจ has_function_privilege (anon เรียก app_rf_save ไม่ได้, authenticated เรียกได้, private.* เรียกไม่ได้)
--
-- Rollback: create or replace สามฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน (รวม revoke / grant ท้ายฟังก์ชัน) ไม่มีข้อมูลที่ต้องย้อน
--   (สต็อกขั้นต่ำที่ ST ตั้งไว้แล้วเป็นข้อมูลทดสอบปกติของ bom_stock / rf_materials คงอยู่ต่อ)
-- ============================================================================

-- 1. สต็อกของซื้อ (action countPartStock): นิยามจาก 20261111010000_bom_part_stock.sql เปลี่ยนเฉพาะสิทธิ์เปลี่ยนสต็อกขั้นต่ำ = กลุ่มวางแผนหรือแผนก ST
-- ลำดับตรวจเดิม: รูป/รหัส (ต้องเป็น PURCHASED ที่มีอยู่) -> ชนรายระเบียน (BOM_STALE) -> สิทธิ์รายช่อง: เปลี่ยนยอดต้องเป็นกลุ่มวางแผนหรือแผนก ST / WH, เปลี่ยนสต็อกขั้นต่ำต้องเป็นกลุ่มวางแผนหรือแผนก ST (BOM_FORBIDDEN)
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
    if not exists (select 1 from public.bom_items i where i.is_test and i.code = v_code and i.kind = 'PURCHASED') then
      raise exception 'BOM_INVALID_STOCK';
    end if;

    select * into v_old from public.bom_stock s where s.is_test and s.item_code = v_code for update;
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
      values (true, v_code, v_new_qty, v_new_safety, case when v_qty_changed then now() end, case when v_qty_changed then p_actor.id end);
    end if;
    if v_qty_changed then
      insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
      values (true, v_code, 'count', v_new_qty - v_old_qty, v_new_qty, null, p_actor.id);
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_save_stock(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 2. ใบสั่งซื้อ (นิยามจาก 20261119010000_rf_purchase_by_st.sql เปลี่ยนเฉพาะสิทธิ์เปลี่ยนสต็อกขั้นต่ำของของซื้อ 2 จุดในสาขาใบใหม่ = (p_planner หรือ p_st)): คืน { receipt, bomStock, partReceipt }
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

    select * into v_old from public.rf_purchase_orders p where p.is_test and p.po_no = v_no;
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
          elsif jsonb_typeof(v_sl -> 'receivedKg') = 'null' then
            if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' then
              v_recv_count := v_recv_count + 1;
              v_idx := v_i;
            end if;
          elsif (v_sl ->> 'receivedKg')::numeric is distinct from (v_nl ->> 'receivedKg')::numeric
             or (v_sl ->> 'lotNo') is distinct from (v_nl ->> 'lotNo')
             or (v_sl ->> 'expiry')::numeric is distinct from (v_nl ->> 'expiry')::numeric then
            v_other := true;
          end if;
        end loop;
      end if;
      -- ตรงกับที่เก็บทุกช่อง (สำเนาที่ client ได้จากเซิร์ฟเวอร์) = ไม่ทำอะไร
      if not (v_other or v_recv_count > 0 or v_status <> v_old.status) then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      -- ยกเลิก: คลังวัตถุดิบ (ST) หรือ admin เฉพาะใบ ordered ที่ยังไม่มีบรรทัดไหนรับเข้า
      if v_status = 'cancelled' and v_old.status <> 'cancelled' then
        if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
        if p_action <> 'cancelPurchaseOrder' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_old.status <> 'ordered' or v_other or v_recv_count > 0
           or exists (select 1 from jsonb_array_elements(v_old.lines) l where jsonb_typeof(l -> 'receivedKg') <> 'null') then
          raise exception 'RF_INVALID_TRANSITION';
        end if;
        update public.rf_purchase_orders set status = 'cancelled', cancelled_at = now(), updated_at = now() where id = v_old.id;
        continue;
      end if;

      -- ที่เหลือที่ยอมให้มีได้ทางเดียวคือรับเข้าหนึ่งบรรทัด (ST หรือ admin) ที่มาพร้อมล็อตใหม่
      if v_recv_count = 0 then raise exception 'RF_INVALID_TRANSITION'; end if;
      if not (p_st or v_admin) then raise exception 'RF_FORBIDDEN'; end if;
      if p_action <> 'receivePurchaseLine' then raise exception 'RF_INVALID_PURCHASE'; end if;
      if v_old.status <> 'ordered' or v_other then raise exception 'RF_INVALID_TRANSITION'; end if;
      if v_recv_count <> 1 or v_receipt is not null then raise exception 'RF_INVALID_PURCHASE'; end if;
      v_sl := v_old.lines -> v_idx;
      v_nl := v_lines -> v_idx;
      v_kg := (v_nl ->> 'receivedKg')::numeric;
      v_src := coalesce(v_sl ->> 'source', 'rf');
      if v_src = 'bom' then
        -- บรรทัดของซื้อ: บวกยอดคงเหลือ + ประวัติ 'receive' (ref = เลขใบ) ไม่มีล็อต/วันหมดอายุ (ตัวแยกวิเคราะห์บรรทัดบังคับ lotNo / expiry เป็น null แล้ว)
        -- ชิ้นต้องยังเป็นของซื้อที่มีอยู่ใน item master (เปลี่ยนชนิดหรือหายไปหลังสั่งแล้ว = รับเข้าไม่ได้)
        if not exists (select 1 from public.bom_items i where i.is_test and i.code = (v_sl ->> 'materialCode') and i.kind = 'PURCHASED') then
          raise exception 'RF_INVALID_PURCHASE';
        end if;
        -- ล็อกตัวนับ BOM (private.rf_lock_bom: rf_master_state ถูกล็อกก่อนแล้วใน app_rf_save) แล้วค่อยเขียนแถวสต็อก
        if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
        select * into v_stock from public.bom_stock s where s.is_test and s.item_code = (v_sl ->> 'materialCode') for update;
        if found then
          v_bal := v_stock.qty + v_kg;
          if v_bal > 1000000000 then raise exception 'RF_INVALID_PURCHASE'; end if;
          update public.bom_stock set qty = v_bal, updated_at = now() where id = v_stock.id;
        else
          v_bal := v_kg;
          insert into public.bom_stock (is_test, item_code, qty) values (true, v_sl ->> 'materialCode', v_bal);
        end if;
        insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by)
        values (true, v_sl ->> 'materialCode', 'receive', v_kg, v_bal, v_no, p_actor.id);
        v_bom_n := v_bom_n + 1;
        v_part := true;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_kg, 'lotNo', null::text, 'expiry', null::bigint, 'receivedAt', v_ms, 'receivedBy', p_actor_name));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when exists (select 1 from jsonb_array_elements(v_final) l where jsonb_typeof(l -> 'receivedKg') = 'null')
                        then 'ordered' else 'received' end,
          updated_at = now()
        where id = v_old.id;
      else
        v_exp := (v_nl ->> 'expiry')::numeric;
        if v_exp <= v_ms then raise exception 'RF_INVALID_PURCHASE'; end if;
        v_final := jsonb_set(v_old.lines, array[v_idx::text], v_sl || jsonb_build_object(
          'receivedKg', v_kg, 'lotNo', v_nl ->> 'lotNo', 'expiry', v_exp, 'receivedAt', v_ms, 'receivedBy', p_actor_name));
        update public.rf_purchase_orders set
          lines = v_final,
          status = case when exists (select 1 from jsonb_array_elements(v_final) l where jsonb_typeof(l -> 'receivedKg') = 'null')
                        then 'ordered' else 'received' end,
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
        if jsonb_typeof(v_nl -> 'receivedKg') <> 'null' then raise exception 'RF_INVALID_PURCHASE'; end if;
        if v_nl ->> 'source' = 'bom' then
          -- ของซื้อ: ต้องเป็นชิ้น PURCHASED ที่มีอยู่ (รหัสตามที่เก็บ หน่วยจาก bom_items) · สต็อกขั้นต่ำที่ต่างจาก bom_stock.safety_qty (ไม่มีแถว = 0) เซิร์ฟเวอร์ upsert ให้
          select * into v_item from public.bom_items i where i.is_test and i.code = private.bom_code(v_nl ->> 'materialCode') and i.kind = 'PURCHASED';
          if not found then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_safety := (v_nl ->> 'safetyKg')::numeric;
          -- storedSafetyKg = ค่าที่หน้าต่างสั่งซื้อแสดงตอนเปิด (rf_po_parse_lines ตัดช่องนี้ออก จึงอ่านจากบรรทัดดิบ): ค่าที่ส่งมาเท่ากับค่านี้
          -- แปลว่าผู้สั่งไม่ได้แก้ช่อง จึงไม่เขียนทับค่าที่ผู้อื่นเพิ่งตั้ง (บรรทัดของใบเก็บค่าที่ใช้อยู่จริง) · client รุ่นก่อนไม่ส่งช่องนี้ = เทียบกับที่เก็บเหมือนเดิม
          select private.bom_num(l.value -> 'storedSafetyKg', 'RF_INVALID_PURCHASE', 0, 1000000000) into v_stored
          from jsonb_array_elements(v_row -> 'lines') l where upper(l.value ->> 'materialCode') = upper(v_nl ->> 'materialCode') limit 1;
          if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
          select * into v_stock from public.bom_stock s where s.is_test and s.item_code = v_item.code for update;
          if found and v_stored is not null and v_safety = v_stored then
            v_safety := v_stock.safety_qty;
          elsif found then
            if v_stock.safety_qty <> v_safety then
              -- สต็อกขั้นต่ำเปลี่ยนได้โดยกลุ่มวางแผนหรือแผนก ST (ด่านสร้างใบด้านบนเหลือแต่ ST / admin ซึ่ง admin นับเป็นกลุ่มวางแผน)
              if not (p_planner or p_st) then raise exception 'RF_FORBIDDEN'; end if;
              update public.bom_stock set safety_qty = v_safety, updated_at = now() where id = v_stock.id;
              v_bom_n := v_bom_n + 1;
            end if;
          elsif v_safety <> 0 then
            if not (p_planner or p_st) then raise exception 'RF_FORBIDDEN'; end if;
            insert into public.bom_stock (is_test, item_code, qty, safety_qty) values (true, v_item.code, 0, v_safety);
            v_bom_n := v_bom_n + 1;
          end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_item.code, 'uom', v_item.uom, 'safetyKg', v_safety, 'receivedAt', null::bigint, 'receivedBy', null::text));
        else
          select * into v_mat from public.rf_materials m where m.is_test and upper(m.code) = upper(v_nl ->> 'materialCode');
          if not found or not v_mat.active then raise exception 'RF_INVALID_PURCHASE'; end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_mat.code, 'receivedAt', null::bigint, 'receivedBy', null::text));
        end if;
      end loop;
      insert into public.rf_purchase_orders (is_test, po_no, status, source_pi, source_requisition, note, lines, created_by)
      values (true, v_no, 'ordered', v_pi, v_req, v_note, v_final, p_actor.id);
    end if;
  end loop;
  return jsonb_build_object('receipt', v_receipt, 'bomStock', v_bom_n, 'partReceipt', v_part);
end;
$$;
revoke all on function private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 3. RPC ของ RubberFlow: นิยามจาก 20261116010000_rf_bom_feedback_on_finishing.sql เปลี่ยนเฉพาะด่านหยาบของส่วน materials (ST ส่งได้เฉพาะพร้อม createPurchaseOrder)
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
