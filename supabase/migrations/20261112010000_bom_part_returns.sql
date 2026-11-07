-- ============================================================================
-- คืนของซื้อเข้าสต็อก (ต่อยอด PR #319): ยกเลิกการเบิกจ่ายของซื้อทั้งใบ PI และคืนของเหลือบางรายการ (โหมดทดสอบเท่านั้น)
-- ต่อยอด 20261111010000_bom_part_stock.sql (bom_stock / bom_stock_moves / issueOrderParts) ทุกประการ: ตัวนับ bom_master_state เดียว, changed_version รายระเบียนประทับโดย trigger
-- bom_stamp_version, BOM_STALE ก่อนตรวจสิทธิ์/เนื้อหาเสมอ, delta {upsert, delete}, RLS deny-all, audit BOM_MASTER_SAVE, ล้างข้อมูลทดสอบผ่าน app_sandbox_purge_bom (ไม่ต้องแก้ เพราะตารางเดิม)
--
-- กติกา (ยืนยันกับผู้ใช้ 2026-11-07)
--   1) ของซื้อที่ ST เบิกจ่ายให้ใบ PI (issueOrderParts) คืนเข้าสต็อกได้สองทาง ผู้ทำ = กลุ่มวางแผนหรือพนักงานแผนก ST (คนเดียวกับที่เบิกจ่ายได้) คนอื่น = BOM_FORBIDDEN
--      ก) ยกเลิกการเบิกจ่าย (action undoOrderParts, mode 'undo'): ของซื้อที่เบิกจ่ายของทั้งใบคืนสต็อกทั้งหมด (ส่วนที่ยังไม่เคยคืนเป็นของเหลือ) งาน ST / PURCHASED ของใบกลับไปรอเบิกจ่าย
--         (status queued, qty_done 0, done_at null) สถานะใบไม่เปลี่ยน จึงเบิกจ่ายใหม่ได้ หรือยกเลิก / เปิดใบกลับมาแก้ได้เหมือนใบที่ไม่มีงานเริ่ม (ถ้าไม่มีงานแผนกอื่นเริ่มแล้ว)
--      ข) คืนของเหลือ (action returnOrderParts, mode 'leftover'): คืนบางรายการ รายการละจำนวนที่พิมพ์ (ของที่ใช้ไม่หมด) งานยังเป็น done ใบยังนับว่าเบิกจ่ายแล้ว
--   2) ต้องระบุเหตุผล 1-200 ตัวอักษร ทั้งสองทาง เก็บในประวัติสต็อก (bom_stock_moves.note)
--   3) ยอดที่คืนได้ต่อ (ใบ PI, รายการ) = ยอดที่เบิกจ่าย (ผลรวม qty_done ของงาน ST / PURCHASED ที่ done ของรายการนั้นในใบ) - ยอดที่คืนไปแล้ว
--      ยอดที่คืนไปแล้ว = ผลรวม qty ของประวัติ 'return' ที่ ref = เลข PI และรหัสรายการนั้น "นับตั้งแต่ประวัติ 'issue' ล่าสุดของ (เลข PI, รายการ)" (private.bom_part_returned)
--      เพราะหลังยกเลิกการเบิกจ่ายแล้วเบิกจ่ายใหม่ ของเหลือที่คืนก่อนหน้าไม่นับกับการเบิกจ่ายรอบใหม่
--
-- ตาราง: bom_stock_moves
--   - kind เพิ่มค่า 'return' (ลบแล้วสร้าง check ใหม่ชื่อเดิม bom_stock_moves_kind_check: ที่ production ชื่อนี้ ค่าเดิม ('count','receive','issue'))
--   - note text null (1-200 ตัวอักษร) = เหตุผลของการคืน · เฉพาะประวัติ 'return' มี note (check bom_stock_moves_note_return_check) ประวัติชนิดอื่นเป็น null
--
-- รูปเรคอร์ดที่ส่ง/รับ (snapshot / delta ยังสิบสามชุดเสมอ)
--   stockMoves เพิ่มช่อง note (ข้อความ | null) · kind เพิ่ม 'return' (qty เป็นค่าบวก ref = เลข PI)
--   ส่วนใหม่ของ app_bom_save_master: partReturns (upsert เท่านั้น ไม่อยู่ใน v_planner_sections) ไม่ใช่ชุดใน snapshot/delta
--   แถวเดียวต่อคำสั่ง { orderId, mode ('undo' | 'leftover'), reason, lines?: [{ itemCode, qty }] } (lines เฉพาะ leftover) ผลคำนวณที่เซิร์ฟเวอร์ทั้งหมด ไม่เชื่อสำเนาที่ client คำนวณ
--
-- app_bom_save_master: action ใหม่ undoOrderParts, returnOrderParts ในรายการ private.bom_client_actions() และ private.bom_staff_actions()
--   ส่วน partReturns ส่งได้เฉพาะสองการกระทำนี้ และสองการกระทำนี้ส่งได้เฉพาะส่วน partReturns (ผิด = BOM_INVALID_PAYLOAD)
--   ตัวเขียนใหม่ private.bom_return_parts (เรียกหลังตัวเขียนงาน/สต็อกเดิม ธุรกรรมเดียวกัน) ลำดับตรวจ:
--     รูปแถว (แถวเดียว, mode, เหตุผล 1-200, lines, รหัสไม่ซ้ำ, qty > 0, ใบต้องมี = BOM_INVALID_RETURN) -> ชนรายระเบียน (งาน ST / PURCHASED ของใบ หรือแถวสต็อกของรายการเหล่านั้นเปลี่ยนหลังเวอร์ชันฐาน = BOM_STALE)
--     -> สิทธิ์ (BOM_FORBIDDEN) -> สถานะใบ (BOM_INVALID_TRANSITION) -> ยอด (BOM_INVALID_RETURN)
--   undo: ใบ released / in_progress (ไม่เช่นนั้น BOM_INVALID_TRANSITION) ต้องมีงาน ST / PURCHASED ที่ done อย่างน้อยหนึ่งงาน (ไม่เช่นนั้น BOM_INVALID_RETURN)
--         ต่อรายการ: คืน = ผลรวม qty_done - ยอดที่คืนไปแล้ว (ถ้า > 0 บวกสต็อก สร้างแถวถ้ายังไม่มี เขียน 'return' พร้อมเหตุผล) แล้วตั้งงานกลับเป็น queued
--   leftover: ใบ released / in_progress / completed (cancelled = BOM_INVALID_TRANSITION) lines 1-100 แต่ละรายการต้องมีงาน done ของใบและ 0 < qty <= ยอดที่คืนได้ (ไม่เช่นนั้น BOM_INVALID_RETURN)
--         บวกสต็อก เขียน 'return' พร้อมเหตุผล งานไม่เปลี่ยน · ล็อกแถวสต็อกเรียงตามรหัสก่อนเขียน (เหมือน bom_issue_parts) · คืนจำนวนประวัติที่เขียน (นับเป็น stock ใน audit)
--   สมมติฐาน: ปล่อยผลิตสร้างงานของซื้อหนึ่งงานต่อรายการต่อใบ (ถ้ามีหลายงานของรายการเดียวกัน ตัวเขียนรวมยอดเบิกจ่ายของรายการเป็นก้อนเดียวและตั้งทุกงานกลับ)
--
-- นิยามที่ replace / ถูกแทนในไฟล์นี้ (เริ่มจากนิยามล่าสุดบน main ทุกตัว: ทั้งหมดมาจาก 20261111010000_bom_part_stock.sql)
--   - private.bom_client_actions, private.bom_staff_actions จาก 20261111010000_bom_part_stock.sql (เพิ่ม undoOrderParts, returnOrderParts)
--   - private.bom_records จาก 20261111010000_bom_part_stock.sql (stockMoves เพิ่ม note) · private.bom_delta เรียก bom_records จึงไม่ต้องแก้
--   - public.app_bom_save_master จาก 20261111010000_bom_part_stock.sql (ส่วน partReturns, action ใหม่, เรียก bom_return_parts, นับ audit) ลายเซ็นและสิทธิ์เดิม
--   - ใหม่: private.bom_part_returned, private.bom_stock_add_return, private.bom_return_parts
--   - ไม่แตะ: private.bom_save_jobs / bom_issue_parts / bom_save_stock / bom_save_orders (ยกเลิกใบหลัง undo ผ่านด้วยกติกาเดิม: ไม่มีงาน qty_done > 0) · app_bom_master* / app_sandbox_purge_bom
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้เรียก action ใหม่ (undoOrderParts / returnOrderParts) และอ่านช่อง note จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge PR ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของฟังก์ชันที่ replace ข้างบน
--   ที่ production กับนิยามใน 20261111010000 แล้วตรวจว่า bom_stock_moves_kind_check ที่ production คือ CHECK kind = ANY (ARRAY['count','receive','issue']) ก่อน (ไฟล์นี้ drop ตามชื่อนี้)
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test, has_function_privilege (anon ไม่ได้ authenticated เฉพาะ RPC สาธารณะ), และสองการกระทำอยู่ในรายการ action
--   Pilot Web รุ่นก่อนหน้ายังทำงานกับฐานข้อมูลนี้ได้ (ช่อง note ที่เพิ่มถูกเมิน, ไม่เคยส่ง action ใหม่, 'return' ในประวัติแสดงเป็นรหัสดิบที่หน้าประวัติรุ่นเก่า)
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) คืนนิยามเดิมของ public.app_bom_save_master, private.bom_records, private.bom_client_actions, private.bom_staff_actions จาก 20261111010000_bom_part_stock.sql ด้วยการรัน create or replace
--      จากไฟล์นั้น (รวม grant ท้ายฟังก์ชัน)
--   2) drop function private.bom_return_parts(public.employees, text, boolean, jsonb, bigint, bigint), private.bom_stock_add_return(uuid, text, numeric, text, text), private.bom_part_returned(text, text)
--   3) delete from public.bom_stock_moves where kind = 'return' (ยอดสต็อกที่เพิ่มจากการคืนไม่ถูกย้อน: ถ้าต้องย้อนให้ล้างข้อมูลทดสอบด้วย app_sandbox_purge_bom) แล้ว
--      alter table public.bom_stock_moves drop constraint bom_stock_moves_note_return_check, drop column note, drop constraint bom_stock_moves_kind_check,
--      add constraint bom_stock_moves_kind_check check (kind in ('count', 'receive', 'issue'))
-- ============================================================================

-- 1. ตาราง: ประวัติสต็อกเพิ่มชนิด 'return' และเหตุผล ---------------------------------------------------
-- ชื่อ constraint เดิมของ kind ที่ production คือ bom_stock_moves_kind_check (ค่า 'count','receive','issue') drop ตามชื่อ: ไม่มีชื่อนี้ = ล้มดัง ๆ ไม่ปล่อยให้ check เก่าค้าง
alter table public.bom_stock_moves drop constraint bom_stock_moves_kind_check;
alter table public.bom_stock_moves add constraint bom_stock_moves_kind_check check (kind in ('count', 'receive', 'issue', 'return'));
alter table public.bom_stock_moves add column note text check (note is null or char_length(note) between 1 and 200);
alter table public.bom_stock_moves add constraint bom_stock_moves_note_return_check check (note is null or kind = 'return');
comment on column public.bom_stock_moves.note is 'เหตุผลของการคืน (เฉพาะประวัติ return) เซิร์ฟเวอร์เขียนจากเหตุผลที่ผู้คืนระบุ';

-- 2. รายการ action (นิยามจาก 20261111010000_bom_part_stock.sql เพิ่ม undoOrderParts, returnOrderParts) -----------------
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
    'setStockCount', 'setStockCounts', 'cancelOrder', 'completeOrder',
    'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'saveCustomer',
    'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 3. ตัวช่วยและตัวเขียนการคืน (private เรียกจาก app_bom_save_master เท่านั้น) ------------------------------------------
-- ยอดที่คืนไปแล้วของ (เลข PI, รายการ) นับตั้งแต่ประวัติ 'issue' ล่าสุดของคู่นี้ (หลังยกเลิกการเบิกจ่ายแล้วเบิกจ่ายใหม่ ของเหลือรอบก่อนไม่นับ) · ไม่มีประวัติ issue = นับทั้งหมด
create or replace function private.bom_part_returned(p_pi text, p_item text)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(m.qty), 0)
  from public.bom_stock_moves m
  where m.is_test and m.kind = 'return' and m.ref = p_pi and m.item_code = p_item
    and m.created_at > coalesce((select max(i.created_at) from public.bom_stock_moves i
                                 where i.is_test and i.kind = 'issue' and i.ref = p_pi and i.item_code = p_item), '-infinity'::timestamptz)
$$;
revoke all on function private.bom_part_returned(text, text) from public, anon, authenticated;

-- บวกสต็อกของรายการ (สร้างแถวถ้ายังไม่มี) และเขียนประวัติ 'return' (qty บวก, balance หลังรายการ, ref = เลข PI, note = เหตุผล) · ผู้เรียกล็อกแถวสต็อกไว้แล้ว
create or replace function private.bom_stock_add_return(p_actor_id uuid, p_code text, p_qty numeric, p_pi text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_old numeric;
begin
  select s.qty into v_old from public.bom_stock s where s.is_test and s.item_code = p_code;
  if found then
    update public.bom_stock set qty = v_old + p_qty, updated_at = now() where is_test and item_code = p_code;
  else
    v_old := 0;
    insert into public.bom_stock (is_test, item_code, qty) values (true, p_code, p_qty);
  end if;
  insert into public.bom_stock_moves (is_test, item_code, kind, qty, balance, ref, created_by, note)
  values (true, p_code, 'return', p_qty, v_old + p_qty, p_pi, p_actor_id, p_reason);
end;
$$;
revoke all on function private.bom_stock_add_return(uuid, text, numeric, text, text) from public, anon, authenticated;

-- คืนของซื้อของใบ PI (action undoOrderParts / returnOrderParts) · แถวเดียว { orderId, mode, reason, lines? } · รายละเอียดกติกาดูหัวไฟล์
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
    select coalesce(array_agg(distinct j.item_code), '{}') into v_codes
    from public.bom_jobs j
    where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.status = 'done';
    if cardinality(v_codes) = 0 then raise exception 'BOM_INVALID_RETURN'; end if;
    perform 1 from public.bom_stock s where s.is_test and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.status = 'done' and j.item_code = v_code;
      v_left := v_issued - private.bom_part_returned(v_ord.pi_no, v_code);
      if v_left > 0 then
        perform private.bom_stock_add_return(p_actor.id, v_code, v_left, v_ord.pi_no, v_reason);
        v_n := v_n + 1;
      end if;
    end loop;
    -- งานกลับไปรอเบิกจ่าย (ใบไม่เปลี่ยนสถานะ) · ไม่มีงานเริ่มจึงยกเลิก/เปิดใบกลับมาแก้ได้ตามกติกาเดิม
    update public.bom_jobs set status = 'queued', qty_done = 0, done_at = null, updated_at = now()
    where is_test and order_pk = v_ord.id and dept = 'ST' and kind = 'PURCHASED' and status = 'done';
  else
    if v_ord.status not in ('released', 'in_progress', 'completed') then raise exception 'BOM_INVALID_TRANSITION'; end if;
    perform 1 from public.bom_stock s where s.is_test and s.item_code = any (v_codes) order by s.item_code collate "C" for update;
    for v_code in select u.c from unnest(v_codes) as u(c) order by u.c collate "C" loop
      select sum(j.qty_done) into v_issued from public.bom_jobs j
      where j.is_test and j.order_pk = v_ord.id and j.dept = 'ST' and j.kind = 'PURCHASED' and j.status = 'done' and j.item_code = v_code;
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

-- 4. snapshot (นิยามจาก 20261111010000 แล้วเพิ่มช่อง note ของ stockMoves) · private.bom_delta เรียก bom_records จึงไม่ต้องแก้ ------------------------------
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
      from public.bom_items i where i.is_test and i.changed_version > p_since), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test and b.changed_version > p_since), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test and p.changed_version > p_since), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test and r.changed_version > p_since), '[]'::jsonb),
    'customers', coalesce((
      select jsonb_agg(jsonb_build_object(
          'name', c.name, 'country', c.country, 'orderType', c.order_type, 'note', c.note,
          'createdAt', private.bom_ms(c.created_at)) order by lower(c.name) collate "C", c.name collate "C")
      from public.bom_customers c where c.is_test and c.changed_version > p_since), '[]'::jsonb),
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
      from public.bom_orders o where o.is_test and o.changed_version > p_since), '[]'::jsonb),
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
      where j.is_test and j.changed_version > p_since), '[]'::jsonb),
    'stock', coalesce((
      select jsonb_agg(jsonb_build_object(
          'itemCode', s.item_code, 'qty', s.qty, 'safetyQty', s.safety_qty, 'countedAt', private.bom_ms(s.counted_at),
          'countedBy', coalesce(private.bom_person(s.counted_by), ''), 'updatedAt', private.bom_ms(s.updated_at))
        order by s.item_code collate "C")
      from public.bom_stock s where s.is_test and s.changed_version > p_since), '[]'::jsonb),
    'stockMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty, 'balance', m.balance, 'ref', m.ref,
          'at', private.bom_ms(m.created_at), 'by', coalesce(private.bom_person(m.created_by), ''), 'note', m.note)
        order by m.created_at, m.id)
      from public.bom_stock_moves m where m.is_test and m.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- 5. RPC: บันทึกชุดการเปลี่ยนแปลง (นิยามจาก 20261111010000 แล้วเพิ่มส่วน partReturns, action undoOrderParts / returnOrderParts และเรียก bom_return_parts) ------------
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
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns'];
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
    if cardinality(v_started) > 0 then
      update public.bom_orders set status = 'in_progress', updated_at = now() where is_test and status = 'released' and id = any (v_started);
    end if;
    -- ใบที่ปล่อยผลิตต้องมีงาน (ปล่อยผลิตโดยไม่มีงานเลยไม่ได้)
    if exists (select 1 from unnest(v_released) r(id) where not exists (select 1 from public.bom_jobs j where j.order_pk = r.id)) then
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
      -- ชนิดพ่อ/ลูก (rules.childKindError)
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
             or (c.kind = 'CP' and p.kind <> 'RB'))
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

