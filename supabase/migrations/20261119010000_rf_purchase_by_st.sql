-- ============================================================================
-- RubberFlow / BOM โหมดทดสอบ: สั่งซื้อของขาด และรับของเข้าคลัง ทำได้เฉพาะแผนกคลังวัตถุดิบ (ST) · กลุ่มวางแผน (PP, ผู้จัดการแผนกขึ้นไป) และแผนก RB ดูอย่างเดียว · admin ยังทำได้ไว้ตรวจปัญหา
--
-- ทำไม: ผู้ใช้ตัดสิน 2026-11-13 ว่าคนสั่งของขาดและรับของเข้าต้องเป็นคลังวัตถุดิบ (ST) คนเดียว ไม่ใช่กลุ่มวางแผน / RB
--   ก่อนหน้านี้ private.rf_save_purchase_orders ให้ "สร้างใบ" แก่ p_planner หรือ p_rb · "รับบรรทัด" แก่ p_planner หรือ p_st · "ยกเลิก" แก่ p_planner
--   และ private.rf_save_material_lots ให้ "รับล็อตใหม่" แก่ p_planner หรือ p_st
--
-- สิ่งที่เปลี่ยน (เฉพาะเงื่อนไขสิทธิ์ 4 จุด · admin = coalesce(private.employee_role_code(<employee id>) = 'admin', false) เหมือนที่ private.bom_can_edit ใช้):
--   - rf_save_purchase_orders สร้างใบใหม่: (p_planner or p_rb)  ->  (p_st or admin)
--   - rf_save_purchase_orders รับบรรทัด:  (p_planner or p_st)  ->  (p_st or admin)
--   - rf_save_purchase_orders ยกเลิก:      p_planner           ->  (p_st or admin)
--   - rf_save_material_lots ล็อตใหม่:      (p_planner or p_st)  ->  (p_st or admin)
--   - ไม่เปลี่ยน: ลำดับตรวจ (RF_STALE ก่อนสิทธิ์) · รหัสข้อผิดพลาด · ผลที่คืน · สิทธิ์เปลี่ยนสต็อกขั้นต่ำของของซื้อผ่านใบสั่งซื้อที่ยังต้องเป็น p_planner
--     (admin ผ่านเพราะ private.bom_can_edit นับ admin เป็นกลุ่มวางแผนอยู่แล้ว) · สิทธิ์พัก/ปล่อยล็อต (ST / QA / กลุ่มวางแผน) · ประตูหยาบของ public.app_rf_save
--     (purchaseOrders = planner / RB / ST, materialLots = planner / RB / ST / QA) ซึ่งยังกว้างกว่ากติกาใหม่ แล้วตัวเขียนรายระเบียนเป็นด่านจริง
--
-- นิยามที่ replace (create or replace ลายเซ็นเดิมทั้งหมด; เริ่มจากนิยามล่าสุดบน main)
--   - private.rf_save_purchase_orders(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) จาก 20261111010000_bom_part_stock.sql
--   - private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) จาก 20261108010000_rubberflow_shopfloor.sql
--   - ตัวเขียนเป็น security definer + set search_path = '' · revoke all from public, anon, authenticated เหมือนเดิม (เรียกผ่าน public.app_rf_save เท่านั้น)
--   - ไม่แตะ: public.app_rf_save ตาราง RLS สิทธิ์ตาราง
--
-- ลำดับ deploy: Pilot Web ในรุ่นเดียวกันซ่อนปุ่มสั่งซื้อ / รับของ / ยกเลิกจากกลุ่มวางแผนและ RB อยู่แล้ว
--   Pilot Web รุ่นใหม่กับฐานข้อมูลเก่า: ใช้ไม่ได้ครบ — ฐานข้อมูลเก่าปฏิเสธ ST ที่สร้างหรือยกเลิกใบสั่งซื้อ (RF_FORBIDDEN) และรุ่นใหม่ไม่มีปุ่มสั่งให้กลุ่มวางแผน / RB แล้ว จึงไม่มีใครสั่งซื้อได้
--     (รับเข้าโดย ST ยังได้) => ต้อง apply ไฟล์นี้ก่อน merge Pilot Web ตาม "Deployment order" ใน AGENTS.md
--   Pilot Web รุ่นเก่ากับฐานข้อมูลใหม่: กลุ่มวางแผน / RB ที่ยังเห็นปุ่มจะได้ RF_FORBIDDEN (ไม่พังอย่างอื่น)
--   ก่อน apply ที่ production ต้องได้รับอนุมัติจากผู้ใช้ และเทียบ md5(pg_get_functiondef(oid)) ของสองฟังก์ชันกับนิยามในไฟล์ที่ระบุข้างต้นก่อน
--
-- Rollback: create or replace สองฟังก์ชันกลับด้วยนิยามจาก 20261111010000_bom_part_stock.sql (rf_save_purchase_orders)
--   และ 20261108010000_rubberflow_shopfloor.sql (rf_save_material_lots) ไม่มีข้อมูลที่ต้องย้อน
-- ============================================================================

-- ใบสั่งซื้อ (นิยามจาก 20261111010000_bom_part_stock.sql เปลี่ยนเฉพาะสิทธิ์: สร้าง / รับบรรทัด / ยกเลิก = ST หรือ admin): คืน { receipt, bomStock, partReceipt }
--   receipt = ข้อมูลล็อตเคมีที่ต้องเกิดในคำสั่งเดียวกัน (null เมื่อไม่มีการรับ หรือรับบรรทัดของซื้อ) · bomStock = จำนวนแถว bom_stock ที่เขียน (app_rf_save เพิ่มเวอร์ชัน BOM ถ้ามากกว่า 0)
--   partReceipt = รับบรรทัดของซื้อ (app_rf_save ตรวจว่าไม่มีล็อตวัตถุดิบเปลี่ยนในคำสั่งเดียวกัน)
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
          if not v_locked then perform private.rf_lock_bom(); v_locked := true; end if;
          select * into v_stock from public.bom_stock s where s.is_test and s.item_code = v_item.code for update;
          if found then
            if v_stock.safety_qty <> v_safety then
              -- สต็อกขั้นต่ำเปลี่ยนได้เฉพาะกลุ่มวางแผน (สมาชิก RB สร้างใบที่ไม่แตะสต็อกขั้นต่ำได้)
              if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
              update public.bom_stock set safety_qty = v_safety, updated_at = now() where id = v_stock.id;
              v_bom_n := v_bom_n + 1;
            end if;
          elsif v_safety <> 0 then
            if not p_planner then raise exception 'RF_FORBIDDEN'; end if;
            insert into public.bom_stock (is_test, item_code, qty, safety_qty) values (true, v_item.code, 0, v_safety);
            v_bom_n := v_bom_n + 1;
          end if;
          v_final := v_final || jsonb_build_array(v_nl || jsonb_build_object(
            'materialCode', v_item.code, 'uom', v_item.uom, 'receivedAt', null::bigint, 'receivedBy', null::text));
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

-- ล็อตวัตถุดิบ (นิยามจาก 20261108010000_rubberflow_shopfloor.sql เปลี่ยนเฉพาะสิทธิ์รับล็อตใหม่ = ST หรือ admin):
-- ST (หรือ admin) รับเข้าเป็นล็อตใหม่ available · ST/QA (หรือกลุ่มวางแผน) ตั้ง available <-> hold · เนื้อหาของล็อตเดิมแก้ไม่ได้
-- (RF_INVALID_MATERIAL_LOT) · qty_kg / initial_kg ของล็อตเดิมที่ client ส่งมาเมิน (เซิร์ฟเวอร์ลดเองตอนชั่ง) · ผู้รับ/เวลาเซิร์ฟเวอร์ตั้ง
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

    select * into v_old from public.rf_material_lots l where l.is_test and l.lot_no = v_no;
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
    select * into v_mat from public.rf_materials m where m.is_test and m.code = v_code;
    if not found or not v_mat.active then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    if v_qty is null or v_qty <= 0 then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    if v_exp <= private.bom_ms(now()) then raise exception 'RF_INVALID_MATERIAL_LOT'; end if;
    insert into public.rf_material_lots (is_test, lot_no, material_code, qty_kg, initial_kg, expiry, supplier, location, status, coa, received_by)
    values (true, v_no, v_mat.code, v_qty, v_qty, v_exp::bigint, v_sup, coalesce(nullif(v_loc, ''), v_mat.storage_location), 'available', v_coa, p_actor);
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_material_lots(uuid, boolean, boolean, boolean, jsonb, bigint, bigint) from public, anon, authenticated;
