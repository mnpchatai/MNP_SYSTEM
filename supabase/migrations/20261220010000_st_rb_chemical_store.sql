-- ============================================================================
-- BOM / RubberFlow โหมดทดสอบ: โรงงาน ขั้น 3 แยกคลังเคมี ST (คลังวัตถุดิบกลาง) กับคลังเคมีของ RB
--
-- ทำไม (คำตอบเจ้าของโรงงาน 2026-11-24, factory-step3-st-spec): ST เป็นคลังเคมีกลาง RB มีคลังเคมีของตัวเอง
--   1) RB ขอเบิกเคมี (รหัส + kg ไม่ผูก WO ใส่หมายเหตุได้) -> ST จ่าย: เซิร์ฟเวอร์จัดสรรล็อต FEFO (ข้ามล็อตกักกัน / หมดอายุ) kg ย้าย ST -> RB ทันที
--      จ่ายบางส่วนได้ · ST ปิดยอดที่เหลือพร้อมเหตุผล · RB ยกเลิกใบที่ยังไม่ได้จ่ายเลยได้
--   2) ใบเบิกผสมของ RB (createRequisition) ตัดคลัง RB รายล็อต (FEFO บน rb_kg) · ใบเบิกเดิม (คลัง ST) ชั่ง / จ่าย / คืนต่อจากคลัง ST เหมือนเดิม
--   3) นับ / ปรับยอดคลัง RB รายล็อตพร้อมเหตุผล = ผู้จัดการแผนก RB (department_manager ของแผนก RB) หรือฝ่ายวางแผนคลังเคมี (private.rf_chem_planner) เท่านั้น
--      · พนักงาน RB นับไม่ได้ · ผู้จัดการแผนกอื่นในสายผลิต (WH QA GR ST SR ...) ไม่อยู่ในกลุ่มนี้ แม้จะอยู่ใน private.bom_can_edit
--   4) RB คืนเคมีที่ไม่ใช้รายล็อตจากคลัง RB -> รอ ST รับ -> ST รับทั้งใบตามยอดที่ส่ง (ไม่มีรับบางส่วน) หรือปฏิเสธพร้อมเหตุผล (kg กลับคลัง RB)
--   ที่เจ้าของยังไม่ตัดสิน (ข้อเสนอ ระบุใน PR): กักกันมีผลทั้งล็อตทั้งสองคลัง · เคมีของใบเบิกคลัง RB ของ WO ที่ยกเลิก คืนเข้าคลัง RB (ฝ่ายวางแผนคลังเคมี / RB)
--   ยังเป็นโหมดทดสอบเท่านั้น: ไม่แตะ private.bom_real_open() (ยังเป็น false) และกลไก rf_actor / rf_reader / bom_actor
--
-- ตาราง
--   public.rf_material_lots + rb_kg numeric not null default 0 (0..1e9) = ยอดของล็อตที่อยู่คลัง RB · qty_kg = ยอดในคลัง ST (ความหมายเดิม)
--     ล็อตเดิมทั้งหมดอยู่ ST (rb_kg = 0) · ตัวเขียนคุมยอด ST + RB + ที่คืนระหว่างทาง ไม่เกิน initial_kg (ไม่ใส่ CHECK ไม่ให้ migration ล้มกับข้อมูลเดิม)
--   public.rf_requisitions + source_store text not null default 'ST' ('ST' | 'RB') = คลังที่ใบเบิกตัด · แถวเดิมทั้งหมด = ST · ใบใหม่ = RB
--   public.rf_chem_docs (ใหม่ · แบบ rf_purchase_orders: sandbox_row_scope + rf_stamp_version · revoke anon / authenticated · RLS + policy ปิดทั้งหมด
--     · lab_only_guard_table · อยู่ใน sandbox_unguarded_tables และ app_sandbox_purge_rf · เข้าผ่าน app_rf_save เท่านั้น)
--     doc_no CR- (ขอเบิก) / CT- (คืน) / CC- (นับ) -yyyymmdd-nn · kind request | return | count
--     status: request open -> partial -> done | closed | cancelled · return pending -> received | rejected · count done
--     lines (ช่องคำนวณเป็นของเซิร์ฟเวอร์): request {materialCode, qtyKg, issuedKg, issues:[{lotNo, kg, at, by}]}
--       · return {lotNo, materialCode, kg, receivedKg} · count {lotNo, materialCode, beforeKg, countedKg}
--
-- ฝ่ายวางแผนคลังเคมี = private.rf_chem_planner(): แผนก PP ทุกบทบาท หรือบทบาท admin / general_manager / factory_manager / assistant_factory_manager (ทุกแผนก)
--   ไม่ใช่ private.bom_can_edit เพราะตัวนั้นรวม department_manager ของทุกแผนกในสายผลิต (หัวหน้า ST จะขอเบิกแล้วจ่ายให้ตัวเองได้ · หัวหน้า WH จะนับคลัง RB ได้)
-- คำสั่งใหม่ของ app_rf_save (ส่งได้เฉพาะชุด chemDocs + สำเนาล็อตวัตถุดิบที่ตรงกับที่เก็บทุกช่องยกเว้นยอด · ชุดอื่น / ชุด chemDocs กับคำสั่งอื่น
--   / สำเนาล็อตที่ต่างจากที่เก็บ (สถานะ ข้อมูลล็อต หรือล็อตใหม่) = RF_INVALID_CHEM ด้วย private.rf_check_chem_lot_copies ก่อนตัวเขียนล็อต)
--   requestChemicals (ฝ่ายวางแผนคลังเคมี | RB) · cancelChemicalRequest (ฝ่ายวางแผนคลังเคมี | RB · ใบ open ที่ยังไม่จ่ายเลย)
--   issueChemicals (ST | admin · issuedKg สะสมต่อบรรทัด เซิร์ฟเวอร์คิดยอดครั้งนี้จากส่วนต่าง จัดสรร FEFO จาก qty_kg หักที่ใบเบิกเดิมของคลัง ST ที่ค้างชั่งจองไว้)
--     · closeChemicalRequest (ST | admin · เหตุผล 3-300)
--   countRbStock (ฝ่ายวางแผนคลังเคมี | department_manager ของแผนก RB · เหตุผล 3-300 · ตั้ง rb_kg = countedKg ไม่เกิน initial_kg - qty_kg - ที่คืนระหว่างทาง)
--   returnChemicals (ฝ่ายวางแผนคลังเคมี | RB · หัก rb_kg ทันที) · receiveChemicalReturn (ST | admin · ทั้งใบ บวก qty_kg) · rejectChemicalReturn (ST | admin · เหตุผล 3-300 · บวก rb_kg คืน)
--   ลำดับตรวจ: ชน (RF_STALE) -> สิทธิ์ (RF_FORBIDDEN) -> ทาง (RF_INVALID_TRANSITION) -> เนื้อหา (RF_INVALID_CHEM) · ST ไม่พอ = RF_INSUFFICIENT_STOCK
--   คำสั่งเดิม: createRequisition FEFO บน rb_kg และใส่ source_store RB · weighLine / issueRequisition ตัดคอลัมน์ตาม source_store
--     · returnRequisition: ใบคลัง ST = เดิม (ST | admin เข้า qty_kg) · ใบคลัง RB = ฝ่ายวางแผนคลังเคมี | RB เข้า rb_kg · เพดานใหม่ qty_kg + rb_kg + ระหว่างทาง + คืน <= initial_kg
--   รูปเรคอร์ดที่ส่งกลับ: materialLots + rbKg · requisitions + store · ชุดใหม่ chemDocs {id, kind, status, lines, note, reason, createdAt, createdBy, doneAt?, doneBy?}
--
-- นิยามที่ replace (ลายเซ็นเดิม คง owner / grant เดิม · ทุกตัวเริ่มจากนิยามล่าสุดบน main)
--   - private.rf_client_actions()  จาก 20261207010000_wh_rb_boxes.sql (+ 8 คำสั่ง)
--   - private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - private.rf_records(bigint)  จาก 20261207010000_wh_rb_boxes.sql
--   - private.rf_delta(bigint)  จาก 20261130010000_bom_rf_go_live.sql
--   - public.app_rf_save(jsonb, bigint, text, jsonb, text)  จาก 20261207010000_wh_rb_boxes.sql
--   - private.sandbox_unguarded_tables()  จาก 20261218010000_itrp_repair_history.sql (+ rf_chem_docs)
--   - public.app_sandbox_purge_rf()  จาก 20261110010000_rf_purchase_orders.sql (+ rf_chem_docs)
--   ใหม่ (security definer · search_path = '' · revoke all from public, anon, authenticated): private.rf_lot_in_transit(text),
--     private.rf_chem_planner(public.employees), private.rf_check_chem_lot_copies(jsonb, bigint, bigint),
--     private.rf_save_chem_docs(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint)
--   ไม่แตะ: rf_save_material_lots (ล็อตใหม่ rb_kg = 0 · ยอดจาก client เมินเหมือนเดิม) · rf_check_po_receipt · rf_snapshot · app_rf_master(_since)
--     · rf_save_lots (ผสมไม่แตะล็อตวัตถุดิบ) · private.bom_real_open() · rf_actor() · rf_reader()
--
-- ไม่ backward compatible: apply แล้ว merge ทันที (ตาม "Deployment order" ใน AGENTS.md · ต้องได้อนุมัติของผู้ใช้สำหรับไฟล์นี้)
--   ก่อน apply เทียบ md5(pg_get_functiondef(oid)) ของแปดฟังก์ชันที่ replace ที่ production กับนิยามในไฟล์ต้นทางที่ระบุ แล้ว apply "ไฟล์ที่อยู่บน branch" ตรง ๆ
--   หลัง apply เทียบ md5 กับ local stack ที่ผ่าน db:test + has_function_privilege + relrowsecurity ของ rf_chem_docs
--   Pilot เก่า + ฐานข้อมูลใหม่: อ่านได้ (ช่อง rbKg / store / ชุด chemDocs ถูกเมิน) · เบิกผสมได้ RF_INSUFFICIENT_STOCK เพราะคลัง RB ว่าง · ที่เหลือใช้ได้
--   Pilot ใหม่ + ฐานข้อมูลเก่า: คำสั่งใหม่ = RF_INVALID_ACTION · ชุด chemDocs = RF_INVALID_PAYLOAD · คลัง RB = 0 -> ห้าม merge ก่อน apply
--
-- Rollback (ข้อมูลทดสอบเท่านั้น) ลำดับสำคัญ:
--   1) update public.rf_material_lots set qty_kg = qty_kg + rb_kg + private.rf_lot_in_transit(lot_no) (ทำในโหมดของแถว: is_test true / false แยกกัน
--      ด้วย app_sandbox_enter หรือคำนวณจาก rf_chem_docs ตรง) ให้เคมีที่อยู่คลัง RB / ระหว่างทางกลับคลัง ST
--   2) create or replace แปดฟังก์ชันกลับด้วยนิยามต้นทางที่ระบุข้างบน · drop function private.rf_save_chem_docs(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint),
--      private.rf_check_chem_lot_copies(jsonb, bigint, bigint), private.rf_chem_planner(public.employees), private.rf_lot_in_transit(text)
--   3) drop table public.rf_chem_docs · alter table public.rf_requisitions drop column source_store · alter table public.rf_material_lots drop column rb_kg
--   ใบเบิกคลัง RB ที่สร้างหลังไฟล์นี้กลายเป็นใบของคลัง ST (ยอดถูกรวมกลับข้อ 1 แล้ว)
-- ============================================================================

-- 1. ตาราง ------------------------------------------------------------------------------------------------------------------------
alter table public.rf_material_lots
  add column rb_kg numeric not null default 0 check (rb_kg >= 0 and rb_kg <= 1000000000);
comment on column public.rf_material_lots.rb_kg is 'ยอดของล็อตที่อยู่คลังเคมีของ RB (kg) · qty_kg = ยอดในคลัง ST · ย้ายด้วยใบขอเบิก / คืน / นับใน rf_chem_docs และใบเบิกผสมของคลัง RB เท่านั้น (เซิร์ฟเวอร์คำนวณ)';
alter table public.rf_requisitions
  add column source_store text not null default 'ST' check (source_store in ('ST', 'RB'));
comment on column public.rf_requisitions.source_store is 'คลังที่ใบเบิกตัด: ST = qty_kg (ใบก่อน 20261220010000) · RB = rb_kg (ใบเบิกผสมที่สร้างหลังจากนั้น)';

create table public.rf_chem_docs (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  changed_version bigint not null default 0 check (changed_version >= 0),
  doc_no text not null check (doc_no ~ '^C[RTC]-[0-9]{8}-[0-9]{2,6}$'),
  kind text not null check (kind in ('request', 'return', 'count')),
  status text not null,
  -- request {materialCode, qtyKg, issuedKg, issues} · return {lotNo, materialCode, kg, receivedKg} · count {lotNo, materialCode, beforeKg, countedKg} เซิร์ฟเวอร์สร้างรูปนี้เอง
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  note text not null default '' check (char_length(note) <= 300),
  reason text not null default '' check (char_length(reason) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  done_by uuid references public.employees(id) on delete set null,
  done_at timestamptz,
  updated_at timestamptz not null default now(),
  check ((kind = 'request' and doc_no like 'CR-%' and status in ('open', 'partial', 'done', 'closed', 'cancelled'))
      or (kind = 'return' and doc_no like 'CT-%' and status in ('pending', 'received', 'rejected'))
      or (kind = 'count' and doc_no like 'CC-%' and status = 'done')),
  unique (id, is_test),
  unique (doc_no, is_test)
);
create index rf_chem_docs_changed_idx on public.rf_chem_docs (is_test, changed_version);
comment on table public.rf_chem_docs is 'เอกสารคลังเคมี ST / RB: ใบขอเบิกของ RB (CR) ST จ่ายตาม FEFO ย้าย qty_kg -> rb_kg · ใบคืน (CT) rb_kg -> รอ ST รับ -> qty_kg (หรือปฏิเสธกลับ rb_kg) · ใบนับคลัง RB (CC) · เซิร์ฟเวอร์เปลี่ยนสถานะและยอดเองทั้งหมด';
comment on column public.rf_chem_docs.changed_version is 'เวอร์ชันที่แก้แถวนี้ล่าสุด (trigger rf_stamp_version ตั้งให้ ไม่รับจาก client) ใช้ตรวจชนรายระเบียนและคำนวณ delta';

create trigger rf_chem_docs_sandbox_scope before insert or update or delete on public.rf_chem_docs
  for each row execute function private.sandbox_row_scope();
create trigger rf_chem_docs_stamp_version before insert or update on public.rf_chem_docs
  for each row execute function private.rf_stamp_version();
revoke all on public.rf_chem_docs from anon, authenticated;
alter table public.rf_chem_docs enable row level security;
create policy rf_chem_docs_no_direct_access on public.rf_chem_docs for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.rf_chem_docs');

-- 2. รายการ action ----------------------------------------------------------------------------------------------------------------
-- private.rf_client_actions() จาก 20261207010000_wh_rb_boxes.sql (+ 8 คำสั่งของคลังเคมี ST / RB)
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
    'createPurchaseOrder', 'receivePurchaseLine', 'cancelPurchaseOrder', 'issueRequisition', 'returnRequisition', 'closePurchaseLine',
    'receiveBoxes', 'reverseBoxReceipt', 'reverseBoxShip',
    'requestChemicals', 'cancelChemicalRequest', 'issueChemicals', 'closeChemicalRequest', 'countRbStock',
    'returnChemicals', 'receiveChemicalReturn', 'rejectChemicalReturn']
$$;
revoke all on function private.rf_client_actions() from public, anon, authenticated;

-- 3. ยอดที่คืนระหว่างทางของล็อต (ใบคืน CT ที่รอ ST รับ) ของโหมดปัจจุบัน ------------------------------------------------------------
create or replace function private.rf_lot_in_transit(p_lot_no text)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((e ->> 'kg')::numeric), 0)
  from public.rf_chem_docs d, jsonb_array_elements(d.lines) e
  where d.is_test = (select private.bom_test_mode()) and d.kind = 'return' and d.status = 'pending' and e ->> 'lotNo' = p_lot_no
$$;
revoke all on function private.rf_lot_in_transit(text) from public, anon, authenticated;

-- 3b. ฝ่ายวางแผนคลังเคมี (กฎของเจ้าของโรงงาน: นับ / ปรับยอดคลัง RB = ผู้จัดการแผนก RB และฝ่ายวางแผน · ขอเบิก ยกเลิก คืน = แผนก RB และฝ่ายวางแผน)
--   แผนก PP ทุกบทบาท หรือบทบาทระดับโรงงาน / admin (ชุดเดียวกับ private.rf_is_rb_head) · ไม่รวม department_manager ของแผนกในสายผลิตอื่นแบบ private.bom_can_edit
create or replace function private.rf_chem_planner(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.bom_dept_of(p_employee) = 'PP', false)
      or coalesce(private.employee_role_code(p_employee.id) in ('assistant_factory_manager', 'factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.rf_chem_planner(public.employees) from public, anon, authenticated;

-- 3c. สำเนาล็อตวัตถุดิบที่มากับคำสั่งคลังเคมี (ผู้เรียกเดียวคือ app_rf_save ก่อนตัวเขียนล็อต) ------------------------------------
--   สำเนาต้องเป็นล็อตที่มีอยู่และตรงกับที่เก็บทุกช่องที่ rf_save_material_lots เขียนได้ (รหัส หมดอายุ ผู้ขาย ตำแหน่ง CoA สถานะ · อ่านแบบเดียวกับตัวเขียนล็อต)
--   ยอด (qtyKg rbKg) และตราของเซิร์ฟเวอร์เมินได้ · ล็อตใหม่ / ต่างจากที่เก็บ = RF_INVALID_CHEM (ล็อตเปลี่ยนหลังเวอร์ชันฐาน = RF_STALE)
--   ไม่เช่นนั้นคำสั่งคลังเคมีจะรับเข้าล็อตใหม่หรือกักกันล็อตได้ภายใต้ client_action ที่ไม่ใช่ของงานนั้น
create or replace function private.rf_check_chem_lot_copies(p_rows jsonb, p_base bigint, p_cur bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_no text;
  v_exp numeric;
  v_node jsonb;
  v_coa jsonb;
  v_old public.rf_material_lots%rowtype;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_CHEM'; end if;
    v_no := private.bom_text(v_row, 'lotNo', 60, 1, 'RF_INVALID_CHEM');
    select * into v_old from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = v_no;
    if not found then raise exception 'RF_INVALID_CHEM'; end if;
    v_exp := private.bom_num(v_row -> 'expiry', 'RF_INVALID_CHEM', 1, 100000000000000);
    v_node := v_row -> 'coa';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_coa := 'false'::jsonb;
    elsif jsonb_typeof(v_node) in ('boolean', 'object') and char_length(v_node::text) <= 2000 then
      v_coa := v_node;
    else
      raise exception 'RF_INVALID_CHEM';
    end if;
    if v_exp is null or v_exp <> trunc(v_exp)
       or v_old.material_code <> private.bom_text(v_row, 'materialCode', 40, 1, 'RF_INVALID_CHEM')
       or v_old.expiry <> v_exp::bigint
       or v_old.supplier <> coalesce(nullif(private.bom_text(v_row, 'supplier', 120, 0, 'RF_INVALID_CHEM'), ''), '-')
       or v_old.location <> private.bom_text(v_row, 'location', 160, 0, 'RF_INVALID_CHEM')
       or v_old.coa <> v_coa
       or v_old.status <> coalesce(nullif(private.bom_text(v_row, 'status', 10, 0, 'RF_INVALID_CHEM'), ''), 'available') then
      perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_INVALID_CHEM');
    end if;
  end loop;
end;
$$;
revoke all on function private.rf_check_chem_lot_copies(jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. ตัวเขียนเอกสารคลังเคมี (ผู้เรียกเดียวคือ app_rf_save) -----------------------------------------------------------------------
-- แถว = เรคอร์ดเต็มของเอกสาร · ช่องที่เขียนได้ขึ้นกับคำสั่ง (ช่องอื่นเมิน) · ระเบียนเดิมที่ไม่มีอะไรเปลี่ยนตามความหมายของคำสั่ง = ข้าม (ส่งซ้ำได้)
--   requestChemicals: ใบใหม่ CR · lines [{materialCode, qtyKg > 0}] 1..100 รหัสไม่ซ้ำ วัตถุดิบต้องใช้งานอยู่ · note 0-300
--   cancelChemicalRequest: status cancelled · ใบ open ที่ยังไม่จ่ายเลย · reason 0-300
--   issueChemicals: lines[i].issuedKg = ยอดจ่ายสะสมใหม่ (ยอดครั้งนี้ = ส่วนต่าง 0..คงค้าง อย่างน้อยหนึ่งบรรทัด > 0) · open | partial
--   closeChemicalRequest: status closed · open | partial · reason 3-300
--   returnChemicals: ใบใหม่ CT · lines [{lotNo, kg > 0 ไม่เกิน rb_kg}] ล็อตไม่ซ้ำ · note 0-300
--   receiveChemicalReturn: status received · pending · ทั้งใบ (receivedKg = kg) · rejectChemicalReturn: status rejected · pending · reason 3-300
--   countRbStock: ใบใหม่ CC · lines [{lotNo, countedKg >= 0}] ล็อตไม่ซ้ำ · reason 3-300 · note 0-300
-- p_chem_plan = private.rf_chem_planner(ผู้ทำ) (ไม่ใช่ bom_can_edit) · p_rb = สมาชิกแผนก RB · p_st = สมาชิกแผนก ST
--   ขอเบิก / ยกเลิก / คืน = p_chem_plan | p_rb · นับ = p_chem_plan | department_manager ของแผนก RB · จ่าย / ปิดยอด / รับคืน / ปฏิเสธ = p_st | admin
create or replace function private.rf_save_chem_docs(
  p_actor public.employees, p_actor_name text, p_chem_plan boolean, p_rb boolean, p_st boolean, p_action text, p_rows jsonb, p_base bigint, p_cur bigint)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_keys text[];
  v_no text;
  v_status text;
  v_note text;
  v_reason text;
  v_old public.rf_chem_docs%rowtype;
  v_lot public.rf_material_lots%rowtype;
  v_mat public.rf_materials%rowtype;
  v_clines jsonb;
  v_cline jsonb;
  v_sline jsonb;
  v_lines jsonb;
  v_issues jsonb;
  v_i integer;
  v_n integer;
  v_code text;
  v_lot_no text;
  v_kg numeric;
  v_old_kg numeric;
  v_new_kg numeric;
  v_left numeric;
  v_take numeric;
  v_free numeric;
  v_any boolean;
  v_changed boolean;
  v_done boolean;
  v_st_admin boolean := p_st or coalesce(private.employee_role_code(p_actor.id) = 'admin', false);
  v_rb_side boolean := p_chem_plan or p_rb;
  v_rb_count boolean := p_chem_plan or (p_rb and coalesce(private.employee_role_code(p_actor.id) = 'department_manager', false));
  v_now_ms bigint := private.bom_ms(now());
  v_count integer := 0;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'RF_INVALID_CHEM'; end if;
    v_no := private.bom_text(v_row, 'id', 30, 1, 'RF_INVALID_CHEM');
    if v_no !~ '^C[RTC]-[0-9]{8}-[0-9]{2,6}$' or v_no = any (v_seen) then raise exception 'RF_INVALID_CHEM'; end if;
    v_seen := v_seen || v_no;
    v_status := private.bom_text(v_row, 'status', 20, 0, 'RF_INVALID_CHEM');
    v_clines := v_row -> 'lines';
    if jsonb_typeof(v_clines) is distinct from 'array' then v_clines := '[]'::jsonb; end if;

    select * into v_old from public.rf_chem_docs d where d.is_test = (select private.bom_test_mode()) and d.doc_no = v_no for update;
    if found then
      -- เลขเอกสารซ้ำกับที่คนอื่นเพิ่งสร้าง (เวลาสร้างต่างกัน) = ชน
      if private.rf_created_differs(v_row, array['createdAt'], v_old.created_at) then
        perform private.rf_fail(v_old.changed_version, p_base, p_cur, 'RF_CONFLICT');
      end if;
      -- สิ่งที่ client บอกได้: สถานะ (ยกเลิก ปิดยอด รับ ปฏิเสธ) และยอดจ่ายสะสมของใบขอเบิก · ใบนับแก้ไม่ได้ (ข้ามเสมอ)
      v_changed := v_status <> '' and v_status <> v_old.status;
      if v_old.kind = 'request' and not v_changed then
        for v_i in 0 .. jsonb_array_length(v_old.lines) - 1 loop
          v_cline := v_clines -> v_i;
          continue when v_cline is null or jsonb_typeof(v_cline) is distinct from 'object' or jsonb_typeof(v_cline -> 'issuedKg') is distinct from 'number';
          if abs((v_cline ->> 'issuedKg')::numeric - (v_old.lines -> v_i ->> 'issuedKg')::numeric) > 0.0000005 then v_changed := true; end if;
        end loop;
      end if;
      if v_old.kind = 'count' then v_changed := false; end if;
      if not v_changed then continue; end if;
      if v_old.changed_version > p_base and v_old.changed_version <= p_cur then raise exception 'RF_STALE'; end if;

      if p_action = 'issueChemicals' then
        if v_old.kind <> 'request' then raise exception 'RF_INVALID_CHEM'; end if;
        if not v_st_admin then raise exception 'RF_FORBIDDEN'; end if;
        if v_old.status not in ('open', 'partial') then raise exception 'RF_INVALID_TRANSITION'; end if;
        v_n := jsonb_array_length(v_old.lines);
        if jsonb_array_length(v_clines) <> v_n then raise exception 'RF_INVALID_CHEM'; end if;
        v_lines := v_old.lines;
        v_any := false;
        for v_i in 0 .. v_n - 1 loop
          v_sline := v_old.lines -> v_i;
          v_cline := v_clines -> v_i;
          if jsonb_typeof(v_cline) is distinct from 'object' or (v_cline ->> 'materialCode') is distinct from (v_sline ->> 'materialCode') then
            raise exception 'RF_INVALID_CHEM';
          end if;
          v_old_kg := (v_sline ->> 'issuedKg')::numeric;
          v_new_kg := coalesce(private.bom_num(v_cline -> 'issuedKg', 'RF_INVALID_CHEM', 0, 1000000000), v_old_kg);
          -- ยอดครั้งนี้ = ส่วนต่างของยอดสะสม (ปัด 6 ตำแหน่งตัดเศษเลขทศนิยมของเครื่อง) ไม่ติดลบ ไม่เกินคงค้าง
          v_kg := round(v_new_kg - v_old_kg, 6);
          if v_kg < 0 then raise exception 'RF_INVALID_CHEM'; end if;
          continue when v_kg = 0;
          v_left := (v_sline ->> 'qtyKg')::numeric - v_old_kg;
          if v_kg > v_left + 0.000001 then raise exception 'RF_INVALID_CHEM'; end if;
          v_kg := least(v_kg, v_left);
          continue when v_kg <= 0;
          v_any := true;
          v_code := v_sline ->> 'materialCode';
          -- ล็อกแถวล็อตของวัตถุดิบนี้ (เรียงตามเลขล็อตแบบ rf_save_requisitions) แล้วจัดสรร FEFO จากคลัง ST: available ไม่หมดอายุ หมดอายุก่อนจ่ายก่อน
          perform 1 from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.material_code = v_code order by l.lot_no for update;
          v_issues := coalesce(v_sline -> 'issues', '[]'::jsonb);
          v_left := v_kg;
          for v_lot in
            select * from public.rf_material_lots l
            where l.is_test = (select private.bom_test_mode()) and l.material_code = v_code and l.status = 'available' and l.qty_kg > 0.0001 and l.expiry > v_now_ms
            order by l.expiry, l.received_at, l.lot_no
          loop
            exit when v_left <= 0;
            -- ใบเบิกเดิมของคลัง ST ที่ยังค้างชั่งจองยอดของล็อตไว้ (บรรทัดที่ยังไม่ชั่ง) ส่วนนั้นจ่ายให้ RB ไม่ได้
            v_free := v_lot.qty_kg
              - coalesce((select sum((e ->> 'targetKg')::numeric)
                          from public.rf_requisitions q, jsonb_array_elements(q.lines) e
                          where q.is_test = (select private.bom_test_mode()) and q.status = 'weighing' and q.source_store = 'ST' and e ->> 'lotNo' = v_lot.lot_no
                            and jsonb_typeof(e -> 'actualKg') is distinct from 'number'), 0);
            continue when v_free <= 0.0001;
            v_take := least(v_free, v_left);
            update public.rf_material_lots set qty_kg = trim_scale(qty_kg - v_take), rb_kg = trim_scale(rb_kg + v_take), updated_at = now() where id = v_lot.id;
            v_issues := v_issues || jsonb_build_array(jsonb_build_object('lotNo', v_lot.lot_no, 'kg', trim_scale(v_take), 'at', v_now_ms, 'by', p_actor_name));
            v_left := v_left - v_take;
          end loop;
          if v_left > 0 then
            -- ล็อตเปลี่ยนหลังเวอร์ชันฐาน = client ถือข้อมูลเก่า (ตามทันแล้วลองใหม่) ไม่เช่นนั้นคลัง ST ไม่พอจริง
            if exists (select 1 from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_base and l.changed_version <= p_cur) then
              raise exception 'RF_STALE';
            end if;
            raise exception 'RF_INSUFFICIENT_STOCK';
          end if;
          v_lines := jsonb_set(v_lines, array[v_i::text], v_sline || jsonb_build_object('issuedKg', trim_scale(v_old_kg + v_kg), 'issues', v_issues));
        end loop;
        if not v_any then raise exception 'RF_INVALID_CHEM'; end if;
        v_done := not exists (select 1 from jsonb_array_elements(v_lines) e where (e ->> 'issuedKg')::numeric < (e ->> 'qtyKg')::numeric);
        update public.rf_chem_docs set
          lines = v_lines,
          status = (case when v_done then 'done' else 'partial' end),
          done_by = (case when v_done then p_actor.id else done_by end),
          done_at = (case when v_done then now() else done_at end),
          updated_at = now()
        where id = v_old.id;
      elsif p_action = 'cancelChemicalRequest' then
        if v_old.kind <> 'request' or v_status <> 'cancelled' then raise exception 'RF_INVALID_CHEM'; end if;
        if not v_rb_side then raise exception 'RF_FORBIDDEN'; end if;
        if v_old.status <> 'open' or exists (select 1 from jsonb_array_elements(v_old.lines) e where (e ->> 'issuedKg')::numeric > 0) then
          raise exception 'RF_INVALID_TRANSITION';
        end if;
        v_reason := private.bom_text(v_row, 'reason', 300, 0, 'RF_INVALID_CHEM');
        update public.rf_chem_docs set status = 'cancelled', reason = v_reason, done_by = p_actor.id, done_at = now(), updated_at = now() where id = v_old.id;
      elsif p_action = 'closeChemicalRequest' then
        if v_old.kind <> 'request' or v_status <> 'closed' then raise exception 'RF_INVALID_CHEM'; end if;
        if not v_st_admin then raise exception 'RF_FORBIDDEN'; end if;
        if v_old.status not in ('open', 'partial') then raise exception 'RF_INVALID_TRANSITION'; end if;
        v_reason := private.bom_text(v_row, 'reason', 300, 3, 'RF_INVALID_CHEM');
        update public.rf_chem_docs set status = 'closed', reason = v_reason, done_by = p_actor.id, done_at = now(), updated_at = now() where id = v_old.id;
      elsif p_action in ('receiveChemicalReturn', 'rejectChemicalReturn') then
        if v_old.kind <> 'return' or v_status <> (case when p_action = 'receiveChemicalReturn' then 'received' else 'rejected' end) then
          raise exception 'RF_INVALID_CHEM';
        end if;
        if not v_st_admin then raise exception 'RF_FORBIDDEN'; end if;
        if v_old.status <> 'pending' then raise exception 'RF_INVALID_TRANSITION'; end if;
        v_reason := private.bom_text(v_row, 'reason', 300, (case when p_action = 'rejectChemicalReturn' then 3 else 0 end), 'RF_INVALID_CHEM');
        -- ล็อกล็อตของใบเรียงตามเลขล็อต แล้วรับทั้งใบตามยอดที่ส่ง (เข้าคลัง ST) หรือปฏิเสธ (กลับคลัง RB)
        perform 1 from public.rf_material_lots l
        where l.is_test = (select private.bom_test_mode()) and l.lot_no in (select e ->> 'lotNo' from jsonb_array_elements(v_old.lines) e)
        order by l.lot_no
        for update;
        v_lines := '[]'::jsonb;
        for v_sline in select value from jsonb_array_elements(v_old.lines) loop
          v_kg := (v_sline ->> 'kg')::numeric;
          select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_sline ->> 'lotNo');
          if not found then raise exception 'RF_INVALID_CHEM'; end if;
          if p_action = 'receiveChemicalReturn' then
            update public.rf_material_lots set qty_kg = trim_scale(qty_kg + v_kg), updated_at = now() where id = v_lot.id;
            v_lines := v_lines || jsonb_build_array(v_sline || jsonb_build_object('receivedKg', v_kg));
          else
            update public.rf_material_lots set rb_kg = trim_scale(rb_kg + v_kg), updated_at = now() where id = v_lot.id;
            v_lines := v_lines || jsonb_build_array(v_sline);
          end if;
        end loop;
        update public.rf_chem_docs set
          lines = v_lines,
          status = (case when p_action = 'receiveChemicalReturn' then 'received' else 'rejected' end),
          reason = v_reason, done_by = p_actor.id, done_at = now(), updated_at = now()
        where id = v_old.id;
      else
        raise exception 'RF_INVALID_CHEM';
      end if;
      v_count := v_count + 1;
      continue;
    end if;

    -- เอกสารใหม่: ชนิดตามคำสั่ง (เลขเอกสารต้องตรงชนิด) · สิทธิ์ก่อนเนื้อหา
    if p_action = 'requestChemicals' then
      if not v_rb_side then raise exception 'RF_FORBIDDEN'; end if;
      if v_no !~ '^CR-' then raise exception 'RF_INVALID_CHEM'; end if;
      v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_CHEM');
      v_n := jsonb_array_length(v_clines);
      if v_n < 1 or v_n > 100 then raise exception 'RF_INVALID_CHEM'; end if;
      v_keys := '{}';
      v_lines := '[]'::jsonb;
      for v_cline in select value from jsonb_array_elements(v_clines) loop
        if jsonb_typeof(v_cline) <> 'object' then raise exception 'RF_INVALID_CHEM'; end if;
        v_code := private.bom_text(v_cline, 'materialCode', 40, 1, 'RF_INVALID_CHEM');
        if v_code = any (v_keys) then raise exception 'RF_INVALID_CHEM'; end if;
        v_keys := v_keys || v_code;
        select * into v_mat from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.code = v_code;
        if not found or not v_mat.active then raise exception 'RF_INVALID_CHEM'; end if;
        v_kg := round(private.bom_num(v_cline -> 'qtyKg', 'RF_INVALID_CHEM', 0, 1000000000), 6);
        if v_kg is null or v_kg <= 0 then raise exception 'RF_INVALID_CHEM'; end if;
        v_lines := v_lines || jsonb_build_array(jsonb_build_object('materialCode', v_mat.code, 'qtyKg', trim_scale(v_kg), 'issuedKg', 0, 'issues', '[]'::jsonb));
      end loop;
      insert into public.rf_chem_docs (is_test, doc_no, kind, status, lines, note, created_by)
      values ((select private.bom_test_mode()), v_no, 'request', 'open', v_lines, v_note, p_actor.id);
    elsif p_action in ('returnChemicals', 'countRbStock') then
      if p_action = 'returnChemicals' and not v_rb_side then raise exception 'RF_FORBIDDEN'; end if;
      -- นับ / ปรับยอดคลัง RB: ผู้จัดการแผนก RB หรือฝ่ายวางแผนคลังเคมีเท่านั้น (พนักงาน RB และผู้จัดการแผนกอื่นนับไม่ได้)
      if p_action = 'countRbStock' and not v_rb_count then raise exception 'RF_FORBIDDEN'; end if;
      if v_no !~ (case when p_action = 'returnChemicals' then '^CT-' else '^CC-' end) then raise exception 'RF_INVALID_CHEM'; end if;
      v_note := private.bom_text(v_row, 'note', 300, 0, 'RF_INVALID_CHEM');
      v_reason := private.bom_text(v_row, 'reason', 300, (case when p_action = 'countRbStock' then 3 else 0 end), 'RF_INVALID_CHEM');
      v_n := jsonb_array_length(v_clines);
      if v_n < 1 or v_n > 100 then raise exception 'RF_INVALID_CHEM'; end if;
      v_keys := '{}';
      for v_cline in select value from jsonb_array_elements(v_clines) loop
        if jsonb_typeof(v_cline) <> 'object' then raise exception 'RF_INVALID_CHEM'; end if;
        v_lot_no := private.bom_text(v_cline, 'lotNo', 60, 1, 'RF_INVALID_CHEM');
        if v_lot_no = any (v_keys) then raise exception 'RF_INVALID_CHEM'; end if;
        v_keys := v_keys || v_lot_no;
      end loop;
      -- ล็อกล็อตทั้งใบเรียงตามเลขล็อตก่อนอ่านยอด
      perform 1 from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = any (v_keys) order by l.lot_no for update;
      v_lines := '[]'::jsonb;
      for v_cline in select value from jsonb_array_elements(v_clines) loop
        select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_cline ->> 'lotNo');
        if not found then raise exception 'RF_INVALID_CHEM'; end if;
        if p_action = 'returnChemicals' then
          v_kg := round(private.bom_num(v_cline -> 'kg', 'RF_INVALID_CHEM', 0, 1000000000), 6);
          if v_kg is null or v_kg <= 0 then raise exception 'RF_INVALID_CHEM'; end if;
          -- คืนได้ไม่เกินยอดคลัง RB ของล็อต (ล็อตเปลี่ยนหลังเวอร์ชันฐาน = RF_STALE)
          if v_kg > v_lot.rb_kg then perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_CHEM'); end if;
          update public.rf_material_lots set rb_kg = trim_scale(rb_kg - v_kg), updated_at = now() where id = v_lot.id;
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('lotNo', v_lot.lot_no, 'materialCode', v_lot.material_code, 'kg', trim_scale(v_kg), 'receivedKg', null));
        else
          v_kg := round(private.bom_num(v_cline -> 'countedKg', 'RF_INVALID_CHEM', 0, 1000000000), 6);
          if v_kg is null then raise exception 'RF_INVALID_CHEM'; end if;
          -- ยอดนับไม่เกินที่ล็อตเหลือให้คลัง RB ได้ (ยอดรับเข้า - คลัง ST - ที่คืนระหว่างทาง)
          if v_kg > v_lot.initial_kg - v_lot.qty_kg - private.rf_lot_in_transit(v_lot.lot_no) + 0.000001 then
            perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_INVALID_CHEM');
          end if;
          v_lines := v_lines || jsonb_build_array(jsonb_build_object('lotNo', v_lot.lot_no, 'materialCode', v_lot.material_code, 'beforeKg', v_lot.rb_kg, 'countedKg', trim_scale(v_kg)));
          if v_kg <> v_lot.rb_kg then
            update public.rf_material_lots set rb_kg = trim_scale(v_kg), updated_at = now() where id = v_lot.id;
          end if;
        end if;
      end loop;
      insert into public.rf_chem_docs (is_test, doc_no, kind, status, lines, note, reason, created_by, done_by, done_at)
      values ((select private.bom_test_mode()), v_no, (case when p_action = 'returnChemicals' then 'return' else 'count' end),
              (case when p_action = 'returnChemicals' then 'pending' else 'done' end), v_lines, v_note, v_reason, p_actor.id,
              (case when p_action = 'countRbStock' then p_actor.id end), (case when p_action = 'countRbStock' then now() end));
    else
      raise exception 'RF_INVALID_CHEM';
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.rf_save_chem_docs(public.employees, text, boolean, boolean, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 5. ใบเบิก: ใบใหม่ตัดคลัง RB · ใบเดิมตัดคลังของใบ ---------------------------------------------------------------------------
-- private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ ใบใหม่ FEFO และตัดยอดคลัง RB · source_store RB · ใบ weighing เดิมชั่ง / จ่ายตัดคอลัมน์ตามคลังของใบ)
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
  v_have numeric;
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
        -- คลังของใบ (20261220010000): ใบเดิม (source_store ST) ตัดคลัง ST (qty_kg) เหมือนเดิม · ใบของคลัง RB ตัด rb_kg
        v_have := (case when v_old.source_store = 'RB' then v_lot.rb_kg else v_lot.qty_kg end);
        if v_lot.status = 'hold' or v_have <= 0.0001 or v_lot.expiry <= v_now_ms or v_have < v_cact then
          perform private.rf_fail(v_lot.changed_version, p_base, p_cur, 'RF_LOT_UNAVAILABLE');
        end if;
        if v_old.source_store = 'RB' then
          update public.rf_material_lots set rb_kg = greatest(0, trim_scale(round(v_lot.rb_kg - v_cact, 6))), updated_at = now() where id = v_lot.id;
        else
          update public.rf_material_lots set qty_kg = greatest(0, trim_scale(round(v_lot.qty_kg - v_cact, 6))), updated_at = now() where id = v_lot.id;
        end if;
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
    -- 20261220010000: ใบใหม่ตัดคลังเคมีของ RB (rb_kg) ไม่ใช่คลัง ST · คลัง RB ไม่พอ = RF_INSUFFICIENT_STOCK (ขอเบิกจาก ST ก่อน)
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
        where l.is_test = (select private.bom_test_mode()) and l.material_code = v_item.code and l.status = 'available' and l.rb_kg > 0.0001 and l.expiry > v_now_ms
        order by l.expiry, l.received_at, l.lot_no
      loop
        exit when v_left <= 0.0001;
        -- คงเหลือที่จองได้ = ยอดคลัง RB ของล็อต - ที่ใบเบิกเก่าของคลัง RB (ยัง weighing) จองบรรทัดที่ยังไม่ชั่ง - ที่ใบนี้จัดสรรไปแล้ว
        -- (ใบ weighing เดิมเป็นของคลัง ST จึงจองยอด ST ไม่ใช่ยอดคลัง RB)
        v_free := v_lot.rb_kg
          - coalesce((select sum((e ->> 'targetKg')::numeric)
                      from public.rf_requisitions q, jsonb_array_elements(q.lines) e
                      where q.is_test = (select private.bom_test_mode()) and q.status = 'weighing' and q.source_store = 'RB' and e ->> 'lotNo' = v_lot.lot_no
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
    -- จ่ายทันที: หักยอดคลัง RB ของล็อตตามบรรทัด (ล็อกไว้แล้วข้างบน จัดสรรไม่เกินคงเหลือ) แล้วตั้งค่าที่จ่ายจริง = เป้าหมาย
    for v_i in 0 .. jsonb_array_length(v_new_lines) - 1 loop
      v_sline := v_new_lines -> v_i;
      v_target := (v_sline ->> 'targetKg')::numeric;
      select * into v_lot from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.lot_no = (v_sline ->> 'lotNo') for update;
      -- ตัดทศนิยม (trunc) ตอนจัดสรรไม่ให้เกินคงเหลือ · ถ้าหักแล้วติดลบให้หยุดทั้งธุรกรรม ไม่ปัดเป็น 0 เงียบ ๆ
      v_after := v_lot.rb_kg - v_target;
      if v_after < 0 then raise exception 'RF_INSUFFICIENT_STOCK'; end if;
      update public.rf_material_lots set rb_kg = trim_scale(v_after), updated_at = now() where id = v_lot.id;
      v_new_lines := jsonb_set(v_new_lines, array[v_i::text],
        v_sline || jsonb_build_object('actualKg', v_target, 'weighedAt', v_now_ms, 'weighedBy', p_actor_name));
    end loop;
    insert into public.rf_requisitions (is_test, req_no, order_no, recipe_code, recipe_revision, batches, total_kg, lines, status, note, requested_by, issued_at, issued_by, source_store)
    values ((select private.bom_test_mode()), v_no, v_order, v_ord.recipe_code, v_ord.recipe_revision, v_batches,
            trim_scale(round(v_rec.batch_kg * v_batches, 4)), v_new_lines, 'issued', v_note, p_actor, now(), p_actor, 'RB');
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.rf_save_requisitions(uuid, text, boolean, text, jsonb, bigint, bigint) from public, anon, authenticated;

-- 6. รับเคมีคืนของใบเบิกของ WO ที่ยกเลิก: ตามคลังของใบ -----------------------------------------------------------------------
-- private.rf_return_requisitions(public.employees, text, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ ใบของคลัง RB: ฝ่ายวางแผนคลังเคมี (private.rf_chem_planner) / RB คืนเข้า rb_kg · ใบคลัง ST เหมือนเดิม · เพดานรวมสองคลังและที่คืนระหว่างทาง)
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
    -- ใบของคลัง RB (20261220010000): ฝ่ายวางแผนคลังเคมีหรือแผนก RB คืนเข้าคลัง RB (ไม่ใช่ผู้จัดการแผนกอื่นใน bom_can_edit) · ใบเดิมของคลัง ST: แผนก ST หรือ admin เข้าคลัง ST เหมือนเดิม
    if (v_old.source_store = 'RB' and not (private.rf_chem_planner(p_actor) or private.rf_is_rb(p_actor)))
       or (v_old.source_store <> 'RB'
           and not (coalesce(private.bom_dept_of(p_actor) = 'ST', false) or coalesce(private.employee_role_code(p_actor.id) = 'admin', false))) then
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
        -- เพดาน (20261220010000): ยอดคลัง ST + คลัง RB + ที่คืนระหว่างทาง + ที่คืนครั้งนี้ ไม่เกินยอดรับเข้าของล็อต
        if v_lot.qty_kg + v_lot.rb_kg + private.rf_lot_in_transit(v_lot.lot_no) + v_kg > v_lot.initial_kg + 0.000001 then raise exception 'RF_INVALID_REQUISITION'; end if;
        if v_old.source_store = 'RB' then
          update public.rf_material_lots set rb_kg = trim_scale(v_lot.rb_kg + v_kg), updated_at = now() where id = v_lot.id;
        else
          update public.rf_material_lots set qty_kg = trim_scale(v_lot.qty_kg + v_kg), updated_at = now() where id = v_lot.id;
        end if;
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

-- 7. ชุดเรคอร์ด --------------------------------------------------------------------------------------------------------------
-- private.rf_records(bigint) จาก 20261207010000_wh_rb_boxes.sql (+ rbKg ของล็อตวัตถุดิบ · store ของใบเบิก · ชุดใหม่ chemDocs)
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
          'lotNo', l.lot_no, 'materialCode', l.material_code, 'qtyKg', l.qty_kg, 'rbKg', l.rb_kg, 'initialKg', l.initial_kg, 'expiry', l.expiry,
          'supplier', l.supplier, 'location', l.location, 'status', l.status, 'coa', l.coa,
          'receivedAt', private.bom_ms(l.received_at), 'receivedBy', coalesce(private.bom_person(l.received_by), ''))
        order by l.lot_no collate "C")
      from public.rf_material_lots l where l.is_test = (select private.bom_test_mode()) and l.changed_version > p_since), '[]'::jsonb),
    'requisitions', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', q.req_no, 'orderId', q.order_no, 'recipeId', q.recipe_code, 'recipeRevision', q.recipe_revision,
          'batches', q.batches, 'totalKg', q.total_kg, 'lines', q.lines, 'status', q.status, 'note', q.note, 'store', q.source_store,
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
        || case when t.stage = 'finishing' then jsonb_build_object('grade', t.grade, 'boxes', t.boxes, 'countedToOrder', t.counted_to_order,
                  'destination', t.destination,
                  'whCredit', case when t.wh_credit_qty is null then null else jsonb_build_object('jobNo', t.wh_credit_job_no, 'qty', t.wh_credit_qty) end)
                else '{}'::jsonb end
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
          'qty', b.qty, 'uom', b.uom, 'grade', b.grade, 'status', b.status, 'createdAt', private.bom_ms(b.created_at),
          'customer', b.customer, 'customerPo', b.customer_po, 'moves', b.moves)
        || case when b.received_at is null then '{}'::jsonb
                else jsonb_build_object('receivedAt', private.bom_ms(b.received_at), 'receivedBy', coalesce(private.bom_person(b.received_by), '')) end
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
      from public.rf_purchase_orders o where o.is_test = (select private.bom_test_mode()) and o.changed_version > p_since), '[]'::jsonb),
    'chemDocs', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', c.doc_no, 'kind', c.kind, 'status', c.status, 'lines', c.lines, 'note', c.note, 'reason', c.reason,
          'createdAt', private.bom_ms(c.created_at), 'createdBy', coalesce(private.bom_person(c.created_by), ''))
        || case when c.done_at is null then '{}'::jsonb
                else jsonb_build_object('doneAt', private.bom_ms(c.done_at), 'doneBy', coalesce(private.bom_person(c.done_by), '')) end
        order by c.doc_no collate "C")
      from public.rf_chem_docs c where c.is_test = (select private.bom_test_mode()) and c.changed_version > p_since), '[]'::jsonb))
$$;
revoke all on function private.rf_records(bigint) from public, anon, authenticated;

-- 8. ส่วนต่าง ----------------------------------------------------------------------------------------------------------------
-- private.rf_delta(bigint) จาก 20261130010000_bom_rf_go_live.sql (+ chemDocs)
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
                   ('transfers'), ('fgBoxes'), ('qcRecords'), ('ncrs'), ('purchaseOrders'), ('chemDocs')) as l(list)
      cross join (select private.rf_records(p_since) as records) r))
$$;
revoke all on function private.rf_delta(bigint) from public, anon, authenticated;

-- 9. RPC บันทึกของ RubberFlow ----------------------------------------------------------------------------------------------------
-- public.app_rf_save(jsonb, bigint, text, jsonb, text) จาก 20261207010000_wh_rb_boxes.sql
--   (+ ชุด chemDocs และแปดคำสั่งของคลังเคมี ST / RB · ตัวเขียน private.rf_save_chem_docs · ตรวจ no-op รวม rf_chem_docs)
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
                                       'transfers', 'fgBoxes', 'qcRecords', 'ncrs', 'purchaseOrders', 'chemDocs'];
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
  v_box_actions constant text[] := array['shipBoxes', 'receiveBoxes', 'reverseBoxReceipt', 'reverseBoxShip'];
  v_chem_actions constant text[] := array['requestChemicals', 'cancelChemicalRequest', 'issueChemicals', 'closeChemicalRequest', 'countRbStock',
                                          'returnChemicals', 'receiveChemicalReturn', 'rejectChemicalReturn'];
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
      -- กล่องสินค้า (20261207010000): สี่คำสั่งของกล่อง (รับเข้า ส่งมอบ ย้อนรับเข้า ย้อนส่งมอบ) ส่งได้เฉพาะชุด fgBoxes (รูปคำขอ ตรวจก่อนสิทธิ์ของชุด)
      if v_n > 0 and p_action = any (v_box_actions) and v_key <> 'fgBoxes' then
        raise exception 'RF_INVALID_BOX';
      end if;
      -- คลังเคมี ST / RB (20261220010000): ชุด chemDocs ส่งได้เฉพาะแปดคำสั่งของคลังเคมี และคำสั่งเหล่านั้นส่งได้เฉพาะชุด chemDocs
      --   กับสำเนาล็อตวัตถุดิบ (ยอดที่ client คำนวณไว้ ตัวเขียนล็อตเมินยอดอยู่แล้ว) · ผิด = RF_INVALID_CHEM (รูปคำขอ ตรวจก่อนสิทธิ์ของชุด)
      if v_n > 0 and ((v_key = 'chemDocs' and not (p_action = any (v_chem_actions)))
                      or (p_action = any (v_chem_actions) and v_key not in ('chemDocs', 'materialLots'))) then
        raise exception 'RF_INVALID_CHEM';
      end if;
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
        -- เอกสารคลังเคมี: ด่านหยาบ · สิทธิ์รายคำสั่งตรวจในตัวเขียน (ขอเบิก / ยกเลิก / คืน = ฝ่ายวางแผนคลังเคมี | RB · จ่าย / ปิดยอด / รับคืน / ปฏิเสธ = ST | admin
        --   · นับ = ฝ่ายวางแผนคลังเคมี | ผู้จัดการแผนก RB) ผู้จัดการแผนกอื่นผ่านด่านนี้ได้แต่ตัวเขียนปฏิเสธ
        when 'chemDocs' then v_planner or v_rb or v_st
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
    -- คำสั่งคลังเคมี (20261220010000): สำเนาล็อตที่มาด้วยต้องตรงกับที่เก็บทุกช่องยกเว้นยอด (ล็อตใหม่ / เปลี่ยนสถานะ / ข้อมูลล็อต = RF_INVALID_CHEM)
    --   ตรวจก่อนตัวเขียนล็อต ตัวเขียนล็อตจึงข้ามทุกแถว (ไม่มีการรับเข้าหรือกักกันภายใต้คำสั่งคลังเคมี)
    if p_action = any (v_chem_actions) then
      perform private.rf_check_chem_lot_copies(coalesce(p_changes #> '{materialLots,upsert}', '[]'::jsonb), p_base_version, v_version);
    end if;
    perform private.rf_save_material_lots(v_actor.id, v_planner, v_st, v_qa, coalesce(p_changes #> '{materialLots,upsert}', '[]'::jsonb), p_base_version, v_version);
    perform private.rf_check_po_receipt(v_actor.id, v_po -> 'receipt', v_version);
    -- รับบรรทัดของซื้อ = ไม่มีล็อตวัตถุดิบมาด้วย (ล็อตที่ถูกเขียนในคำสั่งนี้ = ย้อนทั้งคำสั่ง)
    if coalesce((v_po ->> 'partReceipt')::boolean, false)
       and exists (select 1 from public.rf_material_lots t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version) then
      raise exception 'RF_INVALID_PURCHASE';
    end if;
    -- เอกสารคลังเคมี ST / RB (20261220010000): หลังตัวเขียนล็อต (สำเนาล็อตที่มากับคำสั่งถูกเมินยอด) ก่อนใบเบิก · ล็อกล็อตตามเลขล็อตเหมือนตัวเขียนใบเบิก
    --   สิทธิ์ใช้ฝ่ายวางแผนคลังเคมี (private.rf_chem_planner) ไม่ใช่ v_planner (bom_can_edit รวมผู้จัดการแผนกทุกแผนกในสายผลิต)
    perform private.rf_save_chem_docs(v_actor, v_actor_name, private.rf_chem_planner(v_actor), v_rb, v_st, p_action,
                                      coalesce(p_changes #> '{chemDocs,upsert}', '[]'::jsonb), p_base_version, v_version);
    -- รับเคมีคืนเข้าล็อตเดิม (returnRequisition: ใบคลัง ST = แผนก ST หรือ admin · ใบคลัง RB = ฝ่ายวางแผนคลังเคมี หรือ RB) ใช้ตัวเขียนของตัวเอง · คำสั่งอื่นใช้ตัวเขียนใบเบิกเดิม
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
    -- กล่องสินค้า (20261207010000): รับเข้า / ส่งมอบ = แผนก WH หรือ admin · ย้อนรับเข้า / ย้อนส่งมอบ = ผู้จัดการแผนก WH หรือ admin (ตรวจในตัวเขียน)
    --   รับเข้าล็อตที่ส่งมอบให้ลูกค้าของ WO ที่ผูกงาน BOM = นับยอดเข้างาน RB · ย้อนรับเข้า = ถอนยอดนั้น (เขียนฝั่ง BOM นับใน v_bom_jobs / v_bom_orders)
    v_res := private.rf_save_boxes(v_actor, v_actor_name, p_action, coalesce(p_changes #> '{fgBoxes,upsert}', '[]'::jsonb), p_base_version, v_version);
    v_bom_jobs := v_bom_jobs + (v_res ->> 'jobs')::integer;
    v_bom_orders := v_bom_orders + (v_res ->> 'orders')::integer;
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
     and not exists (select 1 from public.rf_purchase_orders t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version)
     and not exists (select 1 from public.rf_chem_docs t where t.is_test = (select private.bom_test_mode()) and t.changed_version > v_version) then
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
revoke all on function public.app_rf_save(jsonb, bigint, text, jsonb, text) from public, anon;
grant execute on function public.app_rf_save(jsonb, bigint, text, jsonb, text) to authenticated;

-- 10. ตารางใหม่รู้จักโหมดทดสอบ: private.sandbox_unguarded_tables() จาก 20261218010000_itrp_repair_history.sql ครบทุกชื่อ + rf_chem_docs
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 11. ล้างข้อมูล RubberFlow ทดสอบ: public.app_sandbox_purge_rf() จาก 20261110010000_rf_purchase_orders.sql (+ rf_chem_docs ลบก่อน)
create or replace function public.app_sandbox_purge_rf()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_table text;
  v_n integer;
  v_deleted integer := 0;
  v_version bigint;
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกแถวตัวนับก่อนลบ (เหมือน app_rf_save) การบันทึกที่กำลังทำอยู่จึงจบก่อน
  insert into public.rf_master_state (is_test, version) values (true, 0) on conflict (is_test) do nothing;
  perform 1 from public.rf_master_state s where s.is_test for update;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) เพื่อให้ trigger รายแถว private.sandbox_row_scope ข้ามการหา persona
  -- (เหตุผลเดียวกับ app_sandbox_purge_bom)
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);

  foreach v_table in array array['rf_chem_docs', 'rf_purchase_orders', 'rf_ncrs', 'rf_qc_records', 'rf_fg_boxes', 'rf_transfers', 'rf_requisitions', 'rf_lots', 'rf_material_lots', 'rf_molds',
                                 'rf_orders', 'rf_recipes', 'rf_materials', 'rf_deleted_keys'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;

  -- คืน claims ก่อนอัปเดต epoch / เขียน audit (audit ใช้ v_admin ที่อ่านไว้ก่อนแล้ว)
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  -- ไม่ตั้ง version กลับเป็น 0: ตัวนับเดินต่อ · epoch ใหม่บอก client เก่าให้โหลดทั้งชุด
  update public.rf_master_state set epoch = gen_random_uuid(), updated_at = now(), updated_by = null where is_test returning version into v_version;
  if not found then
    insert into public.rf_master_state (is_test, version) values (true, 0);
    v_version := 0;
  end if;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'RF_SANDBOX_PURGE', 'rf_master', v_version::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no,
                             'persona_name', v_persona.first_name || ' ' || v_persona.last_name,
                             'entries', jsonb_build_array(jsonb_build_object(
                               'action', 'ล้างข้อมูล RubberFlow ทดสอบ', 'detail', 'ลบ ' || v_deleted || ' แถว'))));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_sandbox_purge_rf() to authenticated;
