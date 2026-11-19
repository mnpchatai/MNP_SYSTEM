-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: โมดูลคลังยางเส้นยาว SR (โรงงาน ขั้น 1) ตำแหน่งจัดเก็บ รับยางนอกใบสั่ง SR ปรับยอดเอง และย้ายผู้รับมอบ WIP ของ RubberFlow ไป RB
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-19, factory-step1-sr-spec): คลังยางเส้นยาวเป็นโมดูลของแผนก SR เอง
--   2) ตำแหน่งจัดเก็บ (ชั้น / โซน) SR พิมพ์เองตอนรับเข้า ย้ายภายหลังได้ ค้นหาได้
--   3) ยางเส้นยาวที่ไม่ได้มาจากใบสั่งผลิต SR (หรือกลุ่มวางแผน) รับเข้าเป็นสต็อกกลางเองพร้อมรหัส จำนวน และที่มา / เหตุผล (เก็บผู้รับและเวลา)
--   4) ปรับยอด: SR ปรับเองได้ (เดิมกลุ่มวางแผนเท่านั้น) ต้องมีเหตุผลทุกครั้ง กฎเดิมทุกข้อ
--   7) ใบส่งมอบ WIP ระหว่างสถานีของ RB อยู่ใน RubberFlow ตามเดิม แต่ผู้รับมอบเป็นแผนก RB (หรือกลุ่มวางแผน) แทนแผนก SR
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และกลไก bom_actor / rf_actor
--
-- ตาราง public.bom_rod_lots (ไม่มีตารางใหม่ RLS / grant / trigger / lab-only เดิมคงอยู่)
--   + location text not null default '' (<= 40 ตัวอักษร) ตำแหน่งจัดเก็บ · ล็อตเดิมเป็น '' (ยังไม่ได้บันทึก)
--   + source text not null default 'order' ('order' = ล็อตตกแต่งของ WO ที่ผูกงาน BOM เหมือนเดิม · 'opening' = SR รับเข้าเองนอกใบสั่ง)
--   + source_note text null (ที่มา / เหตุผลของล็อตนอกใบสั่ง <= 300)
--   order_pk, job_no, wo_no, recipe_code เป็น null ได้: ล็อต order ต้องมีครบสี่ช่อง · ล็อต opening ต้องไม่มี order_pk / job_no / wo_no (foreign key เดิมคงอยู่)
--   bom_rod_lots_state_check: ล็อต stored ของ opening ไม่มีผลตรวจ (qc null) ได้ · ข้ออื่นเหมือนเดิม
--
-- action ของ app_bom_save_master (ส่วน rodLots upsert แถวเดียว ส่วนกับ action ต้องคู่กัน ผิด / ว่าง = BOM_INVALID_ROD)
--   receiveRods (เดิม) แถวคำขอต้องมี location 1-40 ตัวอักษร (หลังตัดช่องว่าง) บันทึกลงล็อต · ไม่มี = BOM_INVALID_ROD
--   receiveRodsOpening (ใหม่ · SR หรือกลุ่มวางแผน) [{id (uuid ใหม่), lotNo 1-40, itemCode, qty > 0, location 1-40, note 3-300}]
--     เลขล็อตเป็นตัวพิมพ์ใหญ่ ไม่ซ้ำในโหมดเดียวกัน และห้ามขึ้นต้นด้วย FN- (เลขล็อตตกแต่งของ RubberFlow ที่จะกลายเป็นล็อตยางเส้นยาว
--     ไม่เช่นนั้นล็อตตกแต่งที่มาทีหลังด้วยเลขเดียวกันจะไม่เกิดล็อตรอรับ) · itemCode ต้องเป็นชิ้นชนิด RB ที่มีในทะเบียน
--     สร้างล็อต stored source opening (qty_sent = qty_received = qty, uom จากชิ้น, spec / qc null, ผู้รับ = ผู้เรียก) + แถว receive +qty สต็อกกลาง (note = ที่มา)
--   setRodLocation (ใหม่ · SR หรือกลุ่มวางแผน) [{id, location 1-40}] ล็อต held / stored เท่านั้น (อื่น = BOM_INVALID_TRANSITION) แก้เฉพาะตำแหน่ง
--   adjustRods (เดิม) แผนก SR ทำได้ด้วย (เพิ่มใน bom_staff_actions และตัวเขียน) กฎเดิม: สต็อกกลางเท่านั้น เหตุผล 3-300 ยอดไม่ติดลบ
--   รหัสข้อผิดพลาด: ใช้ของเดิม BOM_FORBIDDEN, BOM_INVALID_TRANSITION, BOM_INVALID_ROD, BOM_ROD_EXCEEDS, BOM_STALE (ไม่มีรหัสใหม่)
-- RubberFlow app_rf_save: รับมอบใบส่งมอบ (rf_save_transfers p_may_receive) และด่านหยาบของชุด transfers = กลุ่มวางแผน หรือแผนก RB (เดิม SR) · อื่นไม่เปลี่ยน
--
-- รูปเรคอร์ด rodLots ที่ส่งกลับเพิ่ม location (ข้อความ '' = ยังไม่ได้บันทึก), source ('order' | 'opening'), sourceNote (ข้อความ | null)
--   ล็อต opening มี orderId / jobNo / woNo / recipeCode / spec / qc เป็น null (bom_records ต่อ bom_orders แบบ left join แล้ว)
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main คือ 20261202010000_bom_sr_rod_store.sql)
--   - private.bom_client_actions()  จาก 20261202010000_bom_sr_rod_store.sql (+ receiveRodsOpening, setRodLocation)
--   - private.bom_staff_actions()  จาก 20261202010000_bom_sr_rod_store.sql (+ adjustRods, receiveRodsOpening, setRodLocation)
--   - private.bom_rod_save_lots(public.employees, text, boolean, text, jsonb)  จาก 20261202010000_bom_sr_rod_store.sql (+ location, สอง action ใหม่)
--   - private.bom_rod_save_moves(public.employees, boolean, text, jsonb)  จาก 20261202010000_bom_sr_rod_store.sql (adjustRods: SR ด้วย)
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)  จาก 20261202010000_bom_sr_rod_store.sql (ผู้รับมอบ WIP = RB)
--   - private.bom_records(bigint)  จาก 20261202010000_bom_sr_rod_store.sql (ช่องใหม่ของ rodLots · left join ใบ)
--   - public.app_bom_save_master(jsonb, bigint, text, jsonb, text)  จาก 20261202010000_bom_sr_rod_store.sql (สอง action ใหม่ในส่วน rodLots)
--   ไม่แตะ: private.bom_delta (เรียก bom_records จึงได้ช่องใหม่เอง) · private.bom_rod_credit / bom_rod_take / bom_rod_return / bom_rod_lot_create
--     · private.rf_save_transfers (สิทธิ์มาจากพารามิเตอร์ของ app_rf_save) · private.bom_real_open(), bom_actor(), rf_actor()
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ส่ง location ไปกับ receiveRods และเรียก action ใหม่ จึงต้อง apply ไฟล์นี้ที่ production
--   (ด้วยการอนุมัติของผู้ใช้ ครั้งนี้เท่านั้น) ก่อน merge ตาม "Deployment order" ใน AGENTS.md · ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของเจ็ดฟังก์ชันที่ replace
--   ที่ production กับนิยามใน 20261202010000_bom_sr_rod_store.sql แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ · หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test
--   Pilot เก่า + ฐานข้อมูลใหม่: receiveRods ของ Pilot เก่าไม่มี location = BOM_INVALID_ROD (รับยางเส้นยาวเข้าคลังไม่ได้จนกว่าจะ merge) · SR รับมอบ WIP ไม่ได้แล้ว
--   Pilot ใหม่ + ฐานข้อมูลเก่า: action ใหม่ = BOM_INVALID_ACTION / BOM_FORBIDDEN · location ถูกเมิน · ชุด rodLots ไม่มีช่องใหม่ · จึงห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) create or replace เจ็ดฟังก์ชันกลับด้วยนิยามใน 20261202010000_bom_sr_rod_store.sql (ลายเซ็นเดิม สิทธิ์เดิมคงอยู่)
--   2) delete from public.bom_rod_moves where lot_id in (select id from public.bom_rod_lots where source = 'opening') แล้ว delete from public.bom_rod_lots where source = 'opening'
--      (ล็อตนอกใบสั่งที่รับไว้หายไป)
--   3) alter table public.bom_rod_lots drop constraint bom_rod_lots_source_check, drop constraint bom_rod_lots_state_check แล้วสร้าง bom_rod_lots_state_check
--      ตามนิยามเดิมใน 20261202010000 · alter column order_pk / job_no / wo_no / recipe_code set not null · drop column location, source, source_note
-- ============================================================================

-- 1. ตาราง ------------------------------------------------------------------------------------------------------------------------
alter table public.bom_rod_lots
  add column location text not null default '' check (char_length(location) <= 40),
  add column source text not null default 'order' check (source in ('order', 'opening')),
  add column source_note text check (source_note is null or char_length(source_note) <= 300);
alter table public.bom_rod_lots
  alter column order_pk drop not null,
  alter column job_no drop not null,
  alter column wo_no drop not null,
  alter column recipe_code drop not null;
-- ล็อตจากใบสั่ง (ล็อตตกแต่งของ WO ที่ผูกงาน) มีใบ / งาน / WO / สูตรครบ · ล็อตนอกใบสั่งไม่มีใบ งาน และ WO
alter table public.bom_rod_lots add constraint bom_rod_lots_source_check check (
  (source = 'opening' or (order_pk is not null and job_no is not null and wo_no is not null and recipe_code is not null))
  and (source <> 'opening' or (order_pk is null and job_no is null and wo_no is null)));
-- สถานะ (นิยามเดิมของ 20261202010000) · ล็อต stored ที่รับนอกใบสั่งไม่มีผลตรวจขนาด (qc null)
alter table public.bom_rod_lots drop constraint bom_rod_lots_state_check;
alter table public.bom_rod_lots add constraint bom_rod_lots_state_check check (
  ((decision is null) = (decided_at is null))
  and ((status = 'pending' and qty_received is null and qc is null and received_at is null and decision is null)
       or (status = 'held' and qty_received is not null and qc is not null and received_at is not null and decision is null)
       or (status = 'stored' and qty_received is not null and (qc is not null or source = 'opening') and received_at is not null
           and (decision is null or decision = 'accept'))
       or (status = 'returned' and qty_received is not null and qc is not null and received_at is not null and decision = 'return')
       or (status = 'scrapped' and qty_received is not null and qc is not null and received_at is not null and decision = 'scrap')));
comment on table public.bom_rod_lots is 'ล็อตยางเส้นยาวของคลังยางเส้นยาว SR: ล็อตตกแต่งของ WO ที่ผูกงาน BOM (source order สร้างโดย app_rf_save) หรือยางเส้นยาวที่ SR รับเข้าเองนอกใบสั่ง (source opening) · เปลี่ยนผ่าน app_bom_save_master (receiveRods / decideRods / receiveRodsOpening / setRodLocation) เท่านั้น ไม่มีสิทธิ์เขียนจาก client';
comment on column public.bom_rod_lots.location is 'ตำแหน่งจัดเก็บที่ SR พิมพ์เองตอนรับเข้า (เช่น A-01) ย้ายได้ด้วย setRodLocation · ว่าง = ยังไม่ได้บันทึก';
comment on column public.bom_rod_lots.source is 'ที่มาของล็อต: order = ล็อตตกแต่งของ WO ที่ผูกงาน BOM · opening = SR รับเข้าเองนอกใบสั่ง (สต็อกกลาง)';
comment on column public.bom_rod_lots.source_note is 'ที่มา / เหตุผลของล็อตที่รับนอกใบสั่ง (3-300 ตัวอักษร) · ล็อตจากใบสั่งเป็น null';
comment on table public.bom_rod_moves is 'ประวัติสต็อกยางเส้นยาวที่จ่ายได้ของคลังยางเส้นยาว SR (receive / transfer / issue / unissue / adjust) ต่อถัง (ล็อต, ใบเจ้าของ) · เขียนผ่าน app_bom_save_master เท่านั้น ไม่มีสิทธิ์เขียนจาก client';

-- 2. รายการ action ------------------------------------------------------------------------------------------------------------------
-- private.bom_client_actions() จาก 20261202010000_bom_sr_rod_store.sql (+ receiveRodsOpening, setRodLocation)
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
    'setStockCount', 'setStockCounts', 'cancelOrder',
    'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'saveCustomer',
    'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder', 'reverseFg',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods', 'receiveRodsOpening', 'setRodLocation']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- private.bom_staff_actions() จาก 20261202010000_bom_sr_rod_store.sql (+ adjustRods: SR ปรับยอดเองได้ · receiveRodsOpening, setRodLocation ของ SR)
create or replace function private.bom_staff_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['setStockCount', 'setStockCounts', 'reportJob', 'setJobStatus', 'linkJobToRubberFlow', 'countPartStock', 'issueOrderParts', 'undoOrderParts', 'returnOrderParts',
    'receiveFg', 'deliverFg', 'closeOrderShort', 'closeOrder',
    'receiveRods', 'decideRods', 'issueRods', 'reverseRodIssue', 'adjustRods', 'receiveRodsOpening', 'setRodLocation']
$$;
revoke all on function private.bom_staff_actions() from public, anon, authenticated;

-- 3. ตัวเขียนของคลังยางเส้นยาว ---------------------------------------------------------------------------------------------------------
-- private.bom_rod_save_lots จาก 20261202010000_bom_sr_rod_store.sql (+ receiveRods บันทึก location · receiveRodsOpening · setRodLocation)
-- ตัวเขียน receiveRods / decideRods / receiveRodsOpening / setRodLocation (หนึ่งแถว) ลำดับตรวจ: รูปแถว (BOM_INVALID_ROD) -> สิทธิ์ (BOM_FORBIDDEN)
-- -> รับนอกใบสั่ง: ชิ้น RB / id / เลขล็อตซ้ำ (BOM_INVALID_ROD) · อื่น: ล็อกแถวล็อต (ไม่พบ = BOM_INVALID_ROD) -> สถานะ (BOM_INVALID_TRANSITION) -> จำนวน / สเปก (BOM_INVALID_ROD)
-- คืน { lots, moves, jobs, orders }
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

  -- สิทธิ์: รับเข้า / รับนอกใบสั่ง / ย้ายตำแหน่ง = แผนก SR หรือกลุ่มวางแผน · ตัดสินล็อตที่กัก = แผนก QA หรือกลุ่มวางแผน
  if p_action in ('receiveRods', 'receiveRodsOpening', 'setRodLocation') and not (p_planner or coalesce(v_dept = 'SR', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;
  if p_action = 'decideRods' and not (p_planner or coalesce(v_dept = 'QA', false)) then raise exception 'BOM_FORBIDDEN'; end if;

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

-- private.bom_rod_save_moves(public.employees, boolean, text, jsonb) จาก 20261202010000_bom_sr_rod_store.sql (adjustRods: แผนก SR ทำได้ด้วย ข้ออื่นเหมือนเดิม)
-- ตัวเขียน issueRods (1-50 แถว ทั้งหมดหรือไม่เลย) / reverseRodIssue (หนึ่งแถว) / adjustRods (หนึ่งแถว) ลำดับตรวจ: รูปทุกแถว (BOM_INVALID_ROD)
-- -> สิทธิ์ (BOM_FORBIDDEN) -> รายแถวใต้ล็อกแถวล็อต: สถานะ (BOM_INVALID_TRANSITION) -> รหัส / ถัง (BOM_INVALID_ROD) -> ยอดถัง (BOM_ROD_EXCEEDS)
-- id ของแถวมาจาก client (uuid) · id ซ้ำในคำสั่ง หรือมีอยู่แล้วในตาราง = BOM_INVALID_ROD
-- ownerOrderId / forOrderId = เลข PI · คืนจำนวนแถวที่เขียน
create or replace function private.bom_rod_save_moves(p_actor public.employees, p_planner boolean, p_action text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text := case p_action when 'issueRods' then 'issue' when 'reverseRodIssue' then 'unissue' when 'adjustRods' then 'adjust' end;
  v_dept text := private.bom_dept_of(p_actor);
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_row jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_ref text;
  v_owner_pi text;
  v_for_pi text;
  v_code text;
  v_qty numeric;
  v_note text;
  v_lot public.bom_rod_lots%rowtype;
  v_owner public.bom_orders%rowtype;
  v_for public.bom_orders%rowtype;
  v_orig public.bom_rod_moves%rowtype;
  v_owner_pk uuid;
  v_for_pk uuid;
  v_n integer := 0;
begin
  if v_kind is null then raise exception 'BOM_INVALID_ROD'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) < 1
     or jsonb_array_length(p_rows) > (case when v_kind = 'issue' then 50 else 1 end) then
    raise exception 'BOM_INVALID_ROD';
  end if;

  -- รูปทุกแถวก่อนสิทธิ์ (เหมือนตัวเขียนอื่น)
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ROD'; end if;
    v_id := lower(private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ROD'));
    if v_id !~ v_uuid or v_id = any (v_seen) then raise exception 'BOM_INVALID_ROD'; end if;
    if exists (select 1 from public.bom_rod_moves m where m.id = v_id::uuid) then raise exception 'BOM_INVALID_ROD'; end if;
    v_seen := v_seen || v_id;
    if private.bom_text(v_row, 'kind', 10, 1, 'BOM_INVALID_ROD') <> v_kind then raise exception 'BOM_INVALID_ROD'; end if;
    -- หมายเหตุ: จ่าย <= 300 ไม่บังคับ · ย้อนจ่าย / ปรับยอด 3-300 บังคับ
    v_note := private.bom_text(v_row, 'note', 300, (case when v_kind = 'issue' then 0 else 3 end), 'BOM_INVALID_ROD');
    if v_kind = 'unissue' then
      v_ref := lower(private.bom_text(v_row, 'reversesId', 40, 1, 'BOM_INVALID_ROD'));
      if v_ref !~ v_uuid then raise exception 'BOM_INVALID_ROD'; end if;
      v_rows := v_rows || jsonb_build_array(jsonb_build_object('id', v_id, 'reversesId', v_ref, 'note', v_note));
      continue;
    end if;
    v_ref := lower(private.bom_text(v_row, 'lotId', 40, 1, 'BOM_INVALID_ROD'));
    if v_ref !~ v_uuid then raise exception 'BOM_INVALID_ROD'; end if;
    v_qty := private.bom_num(v_row -> 'qty', 'BOM_INVALID_ROD', -1000000000, 1000000000);
    if v_qty is null or v_qty = 0 or (v_kind = 'issue' and v_qty > 0) then raise exception 'BOM_INVALID_ROD'; end if;
    v_owner_pi := nullif(upper(private.bom_text(v_row, 'ownerOrderId', 40, 0, 'BOM_INVALID_ROD')), '');
    v_code := nullif(private.bom_code(private.bom_text(v_row, 'itemCode', 60, 0, 'BOM_INVALID_ROD')), '');
    if v_kind = 'issue' then
      v_for_pi := upper(private.bom_text(v_row, 'forOrderId', 40, 1, 'BOM_INVALID_ROD'));
      if v_code is null then raise exception 'BOM_INVALID_ROD'; end if;
    else
      -- ปรับยอดได้เฉพาะสต็อกกลาง (ไม่มีใบเจ้าของ ไม่มีใบที่จ่ายให้)
      if v_owner_pi is not null or nullif(private.bom_text(v_row, 'forOrderId', 40, 0, 'BOM_INVALID_ROD'), '') is not null then
        raise exception 'BOM_INVALID_ROD';
      end if;
      v_for_pi := null;
    end if;
    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'lotId', v_ref, 'qty', v_qty, 'ownerPi', v_owner_pi, 'forPi', v_for_pi, 'itemCode', v_code, 'note', v_note));
  end loop;

  -- สิทธิ์: จ่าย / ย้อนจ่าย / ปรับยอด = แผนก SR หรือกลุ่มวางแผน (ปรับยอดเดิมเป็นของกลุ่มวางแผนเท่านั้น · SR ทำได้ตั้งแต่ 20261204010000)
  if not (p_planner or coalesce(v_dept = 'SR', false)) then
    raise exception 'BOM_FORBIDDEN';
  end if;

  for v_row in select value from jsonb_array_elements(v_rows) loop
    if v_kind = 'unissue' then
      select * into v_orig from public.bom_rod_moves m
      where m.is_test = (select private.bom_test_mode()) and m.id = (v_row ->> 'reversesId')::uuid;
      if not found then raise exception 'BOM_INVALID_ROD'; end if;
      perform 1 from public.bom_rod_lots l where l.is_test = (select private.bom_test_mode()) and l.id = v_orig.lot_id for update;
      -- ย้อนได้เฉพาะแถว issue (อื่น = BOM_INVALID_ROD) ที่ยังไม่ถูกย้อน (ย้อนซ้ำ = BOM_INVALID_TRANSITION)
      if v_orig.kind <> 'issue' then raise exception 'BOM_INVALID_ROD'; end if;
      if exists (select 1 from public.bom_rod_moves m where m.is_test = (select private.bom_test_mode()) and m.reverses_id = v_orig.id) then
        raise exception 'BOM_INVALID_TRANSITION';
      end if;
      insert into public.bom_rod_moves (id, is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, reverses_id, note, created_by)
      values ((v_row ->> 'id')::uuid, (select private.bom_test_mode()), v_orig.lot_id, v_orig.item_code, 'unissue', -v_orig.qty,
              v_orig.owner_order_pk, v_orig.for_order_pk, v_orig.id, v_row ->> 'note', p_actor.id);
      v_n := v_n + 1;
      continue;
    end if;

    select * into v_lot from public.bom_rod_lots l
    where l.is_test = (select private.bom_test_mode()) and l.id = (v_row ->> 'lotId')::uuid
    for update;
    if not found then raise exception 'BOM_INVALID_ROD'; end if;
    if v_lot.status <> 'stored' then raise exception 'BOM_INVALID_TRANSITION'; end if;
    if (v_row ->> 'itemCode') is not null and (v_row ->> 'itemCode') <> v_lot.item_code then raise exception 'BOM_INVALID_ROD'; end if;
    v_qty := (v_row ->> 'qty')::numeric;
    v_owner_pk := null;
    v_for_pk := null;
    if v_kind = 'issue' then
      -- ใบที่จ่ายให้ต้อง released / in_progress · ถังต้นทางเป็นของใบนั้นเอง หรือสต็อกกลาง (ไม่มีเจ้าของ / ใบเจ้าของปิดแล้ว)
      select * into v_for from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = (v_row ->> 'forPi');
      if not found then raise exception 'BOM_INVALID_ROD'; end if;
      if v_for.status not in ('released', 'in_progress') then raise exception 'BOM_INVALID_TRANSITION'; end if;
      v_for_pk := v_for.id;
      if (v_row ->> 'ownerPi') is not null then
        select * into v_owner from public.bom_orders o where o.is_test = (select private.bom_test_mode()) and o.pi_no = (v_row ->> 'ownerPi');
        if not found then raise exception 'BOM_INVALID_ROD'; end if;
        if v_owner.id <> v_for.id and v_owner.status not in ('completed', 'cancelled') then raise exception 'BOM_INVALID_ROD'; end if;
        v_owner_pk := v_owner.id;
      end if;
    end if;
    -- ยอดถังห้ามติดลบ (อ่านรวมแถวที่เพิ่งเขียนในคำสั่งนี้)
    if private.bom_rod_balance(v_lot.id, v_owner_pk) + v_qty < 0 then raise exception 'BOM_ROD_EXCEEDS'; end if;
    insert into public.bom_rod_moves (id, is_test, lot_id, item_code, kind, qty, owner_order_pk, for_order_pk, note, created_by)
    values ((v_row ->> 'id')::uuid, (select private.bom_test_mode()), v_lot.id, v_lot.item_code, v_kind, v_qty, v_owner_pk, v_for_pk,
            v_row ->> 'note', p_actor.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function private.bom_rod_save_moves(public.employees, boolean, text, jsonb) from public, anon, authenticated;

-- 4. RubberFlow: ผู้รับมอบใบส่งมอบ WIP = แผนก RB หรือกลุ่มวางแผน -------------------------------------------------------------------------
-- public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261202010000_bom_sr_rod_store.sql
--   (ด่านหยาบของชุด transfers และ p_may_receive ของ rf_save_transfers: v_planner or v_rb แทน v_planner or v_sr · ตัวแปร v_sr ไม่ใช้แล้วจึงเอาออก)
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
  v_bom_rods integer := 0;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_bom_save_master (20261108020000: ปล่อยผลิตแล้วเปิด WO ล็อก BOM ก่อน RF) ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ จึงไม่วนกัน
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.rf_reader();
  v_planner := private.bom_can_edit(v_actor);
  v_rb := private.rf_is_rb(v_actor);
  v_head := private.rf_is_rb_head(v_actor);
  v_qa := private.rf_is_qa(v_actor);
  v_st := coalesce(private.bom_dept_of(v_actor) = 'ST', false);
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
        -- ใบส่งมอบ WIP ระหว่างสถานีของ RB: ส่งและรับมอบโดยแผนก RB หรือกลุ่มวางแผน (ผู้รับเดิมคือแผนก SR จนถึง 20261202010000)
        when 'transfers' then v_planner or v_rb
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
    -- คลังแท่งยาว SR (20261202010000): ล็อตตกแต่งของ WO ที่ผูกงาน BOM ที่ผ่าน = แท่งรอรับเข้าคลัง (bom_rod_lots) นับเป็นการเขียนฝั่ง BOM
    v_bom_rods := v_bom_rods + coalesce((v_res ->> 'rodLots')::integer, 0);
    -- รับมอบใบส่งมอบ WIP: แผนก RB หรือกลุ่มวางแผน (20261204010000 · เดิมแผนก SR)
    perform private.rf_save_transfers(v_actor, v_planner or v_rb, v_planner or v_rb,
                                      coalesce(p_changes #> '{transfers,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_save_boxes(v_actor.id, v_planner or v_wh, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_res := private.rf_save_qc(v_actor, v_planner or v_qa, v_planner or v_rb, coalesce(p_changes #> '{qcRecords,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
    v_bom_rods := v_bom_rods + coalesce((v_res ->> 'rodLots')::integer, 0);
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
  if v_bom_jobs + v_bom_orders + v_bom_stock + v_bom_rods = 0
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
  if v_bom_jobs + v_bom_orders + v_bom_stock + v_bom_rods > 0 then
    update public.bom_master_state set version = version + 1, updated_at = now(), updated_by = v_actor.id where is_test = (select private.bom_test_mode())
    returning version into v_bom_version;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_bom_version::text,
            jsonb_build_object('client_action', 'rubberflow:' || p_action, 'version', v_bom_version, 'base_version', v_bom_version - 1,
                               'counts', jsonb_strip_nulls(jsonb_build_object(
                                 'jobs', case when v_bom_jobs > 0 then jsonb_build_object('upsert', v_bom_jobs) end,
                                 'orders', case when v_bom_orders > 0 then jsonb_build_object('upsert', v_bom_orders) end,
                                 'stock', case when v_bom_stock > 0 then jsonb_build_object('upsert', v_bom_stock) end,
                                 'rodLots', case when v_bom_rods > 0 then jsonb_build_object('upsert', v_bom_rods) end)),
                               'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                               'entries', '[]'::jsonb));
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'RF_SAVE', 'rf_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'base_version', p_base_version, 'counts', v_counts,
                             'bom_jobs', v_bom_jobs, 'bom_orders', v_bom_orders, 'bom_stock', v_bom_stock, 'bom_rod_lots', v_bom_rods,
                             'is_test', (select private.bom_test_mode()), 'persona_employee_no', v_actor.employee_no, 'persona_name', v_actor_name,
                             'entries', v_audit));
  return private.rf_delta(p_base_version);
end;
$$;

-- 5. ชุดเรคอร์ดและ action ใหม่ ---------------------------------------------------------------------------------------------------------
-- private.bom_records(bigint) จาก 20261202010000_bom_sr_rod_store.sql (+ location, source, sourceNote ของ rodLots · ต่อใบแบบ left join: ล็อตนอกใบสั่งไม่มีใบ)
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
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb),
    -- คลังยางเส้นยาว SR (20261202010000): ล็อตยางเส้นยาว (ช่องที่ยังไม่มีค่าเป็น null) และประวัติสต็อกที่จ่ายได้ (เลข PI ของถัง / ใบที่จ่ายให้ null = ไม่มี)
    -- 20261204010000: + location (ตำแหน่งจัดเก็บ '' = ยังไม่ได้บันทึก) source ('order' | 'opening') sourceNote · ล็อตนอกใบสั่งไม่มีใบ (left join: orderId null)
    'rodLots', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', l.id::text, 'lotNo', l.lot_no, 'itemCode', l.item_code, 'orderId', o.pi_no, 'jobNo', l.job_no, 'woNo', l.wo_no,
          'recipeCode', l.recipe_code, 'uom', l.uom, 'qtySent', l.qty_sent, 'spec', l.spec, 'status', l.status,
          'qtyReceived', l.qty_received, 'qc', l.qc,
          'receivedBy', case when l.received_at is null then null else coalesce(private.bom_person(l.received_by), '') end,
          'receivedAt', private.bom_ms(l.received_at),
          'decision', l.decision, 'decisionNote', l.decision_note,
          'decidedBy', case when l.decided_at is null then null else coalesce(private.bom_person(l.decided_by), '') end,
          'decidedAt', private.bom_ms(l.decided_at), 'createdAt', private.bom_ms(l.created_at),
          'location', l.location, 'source', l.source, 'sourceNote', l.source_note)
        order by l.created_at, l.lot_no collate "C")
      from public.bom_rod_lots l left join public.bom_orders o on o.id = l.order_pk
      where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_since), '[]'::jsonb),
    'rodMoves', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', m.id::text, 'lotId', m.lot_id::text, 'itemCode', m.item_code, 'kind', m.kind, 'qty', m.qty,
          'ownerOrderId', ow.pi_no, 'forOrderId', fo.pi_no, 'reversesId', m.reverses_id::text, 'note', m.note,
          'by', coalesce(private.bom_person(m.created_by), ''), 'at', private.bom_ms(m.created_at))
        order by m.created_at, m.id)
      from public.bom_rod_moves m
      left join public.bom_orders ow on ow.id = m.owner_order_pk
      left join public.bom_orders fo on fo.id = m.for_order_pk
      where m.is_test = (select private.bom_test_mode()) and m.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;

-- public.app_bom_save_master(jsonb, bigint, text, jsonb, text) จาก 20261202010000_bom_sr_rod_store.sql
--   (+ receiveRodsOpening / setRodLocation ในส่วน rodLots ผ่าน private.bom_rod_save_lots)
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
                                      'customers', 'orders', 'jobs', 'stock', 'partReturns', 'fgMoves', 'rodLots', 'rodMoves'];
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
  v_rod jsonb;
  v_rod_n integer;
  v_rod_orders_n integer;
begin
  perform private.lab_only_block();
  -- ล็อกเดียวกับ app_rf_save (ธุรกรรมละหนึ่งตัว ปล่อยเมื่อจบ): ฟังก์ชันนี้ล็อก BOM ก่อนแล้วเปิด/ยกเลิก WO ใน RF ส่วน app_rf_save ล็อก RF ก่อนแล้ว BOM ถ้าไม่มีล็อกนี้จะวนกันได้
  perform pg_advisory_xact_lock(hashtext('mnp_bom_rf_master'));
  v_actor := private.bom_reader();
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
      -- คลังยางเส้นยาว SR (20261202010000 · 20261204010000): ส่วน rodLots ส่งได้เฉพาะ receiveRods / decideRods / receiveRodsOpening / setRodLocation
      -- · ส่วน rodMoves เฉพาะ issueRods / reverseRodIssue / adjustRods · และเจ็ดการกระทำนี้ส่งได้เฉพาะส่วนของตัวเอง (ผิด = BOM_INVALID_ROD)
      if v_n > 0 and ((v_key = 'rodLots' and p_action not in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation'))
                      or (v_key = 'rodMoves' and p_action not in ('issueRods', 'reverseRodIssue', 'adjustRods'))
                      or (p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') and v_key <> 'rodLots')
                      or (p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and v_key <> 'rodMoves')) then
        raise exception 'BOM_INVALID_ROD';
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
  -- คลังยางเส้นยาว SR: เจ็ดการกระทำต้องมีคำขอในส่วนของตัวเองเสมอ (ไม่มี / ว่าง = BOM_INVALID_ROD)
  if p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') and coalesce(jsonb_array_length(p_changes #> '{rodLots,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
  end if;
  if p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') and coalesce(jsonb_array_length(p_changes #> '{rodMoves,upsert}'), 0) = 0 then
    raise exception 'BOM_INVALID_ROD';
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
    -- คลังแท่งยาว SR: แถว transfer ที่ตัวเขียนใบเขียนเอง (ปล่อยผลิตหยิบจากสต็อกกลาง / เปิดกลับเป็นร่างคืน) นับเป็น rodMoves
    v_rod_orders_n := coalesce((v_res ->> 'rodMoves')::integer, 0);
    if v_rod_orders_n > 0 then v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', v_rod_orders_n)); end if;
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
    -- คลังยางเส้นยาว SR (20261202010000 · 20261204010000): รับเข้า / ตัดสินล็อตที่กัก / รับนอกใบสั่ง / ย้ายตำแหน่ง (rodLots) และจ่าย / ย้อนจ่าย / ปรับยอด (rodMoves)
    -- ผลทั้งหมดคำนวณที่เซิร์ฟเวอร์ · audit นับ rodMoves ตามจำนวนแถวประวัติที่เขียน และ jobs / orders เมื่อการรับเข้าบันทึกยอดให้งาน RB (rodLots นับจากคำขอตามปกติ)
    if p_action in ('receiveRods', 'decideRods', 'receiveRodsOpening', 'setRodLocation') then
      v_rod := private.bom_rod_save_lots(v_actor, v_actor_name, v_planner, p_action, p_changes #> '{rodLots,upsert}');
      if (v_rod ->> 'moves')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', (v_rod ->> 'moves')::integer));
      end if;
      if (v_rod ->> 'jobs')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('jobs', jsonb_build_object('upsert', (v_rod ->> 'jobs')::integer));
      end if;
      if (v_rod ->> 'orders')::integer > 0 then
        v_counts := v_counts || jsonb_build_object('orders', jsonb_build_object('upsert', (v_rod ->> 'orders')::integer));
      end if;
    elsif p_action in ('issueRods', 'reverseRodIssue', 'adjustRods') then
      v_rod_n := private.bom_rod_save_moves(v_actor, v_planner, p_action, p_changes #> '{rodMoves,upsert}');
      v_counts := v_counts || jsonb_build_object('rodMoves', jsonb_build_object('upsert', v_rod_n));
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
