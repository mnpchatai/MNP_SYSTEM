-- ============================================================================
-- ฝ่ายโรงงาน: ชุดข้อมูลทดลอง "สินค้า 5 Item ตาม workflow การผลิต" (โหมดทดสอบเท่านั้น)
--
-- เพิ่ม RPC app_sandbox_seed_factory_trial() (ปุ่ม "เติมชุดทดลอง 5 สินค้า" ในทะเบียนสินค้า) ใส่ข้อมูลสมมติที่เดินตามสายงาน
--   สั่งผลิต (ขาย) → วางแผน (PP) → สั่งวัตถุดิบ (ST) → RB → SR → QC → GR ┐
--                                                       PT ───────────────┼→ PK → WH
--                                                       BG ───────────────┘
-- ด้วยโครงสร้างของระบบเดิมโดยไม่เพิ่มตาราง: Item (RM/WIP/FG/PKG) → BOM หลายชั้น → Routing ตามแผนก → ใบสั่งผลิต → ยอดยกมา
--   * FG 5 รายการ (FG-TRY-001..005) = ชุดมือจับยาง + ฝาพลาสติก 5 ขนาด ใส่กระเป๋า บรรจุกล่อง (ชื่อ ขนาด สูตร เวลาเป็นข้อมูลสมมติ)
--   * ชิ้นงานระหว่างผลิต: ยางเส้นยาว (RB→SR/QC) ใช้ร่วมกัน, ชิ้นงานยางแปรรูป (GR) และชิ้นงานพลาสติก (PT) ต่อขนาด,
--     กระเป๋า (BG) ใช้ร่วมกัน → รวม 27 Item (FG 5 · WIP 12 · RM 9 · PKG 1)
--   * Routing เรียงขั้นตามที่ฝ่ายผลิตกำหนด: ยางเส้นยาว RB-01..RB-13 → SR → QC · ชิ้นงานยางแปรรูป GR-01..04 ·
--     พลาสติก PT · กระเป๋า BG · สินค้าสำเร็จรูป PK-01..05 → WH
--   * ใบสั่งผลิต 5 ใบ (หนึ่งใบต่อ FG) สถานะวางแผน · ยอดยกมาของวัตถุดิบ/ยางเส้นยาว/กล่อง เพื่อลองขั้น "สำรวจคงคลังก่อนสั่งผลิต"
--
-- ขอบเขต: ไม่เพิ่มตาราง ไม่เปลี่ยนสิทธิ์ ไม่แก้ฟังก์ชันเดิม (app_sandbox_seed_factory ทำงานเหมือนเดิม) ใช้ตารางและ trigger แยกโหมดชุดเดิม
--   (factory_sandbox_scope ตั้ง is_test จากโหมดของผู้ทำรายการ) จึงเขียนได้เฉพาะโหมดทดสอบ และ app_sandbox_purge_factory ล้างชุดนี้ด้วย
--   * ทำได้เฉพาะ admin ที่อยู่ในโหมดทดสอบ (private.sandbox_admin / private.sandbox_persona เหมือน app_sandbox_seed_factory)
--   * เติมซ้ำไม่ได้: ถ้ามี Item รหัส *-TRY-* ในโหมดทดสอบแล้ว คืน seeded=false ไม่แตะอะไร (ล้างข้อมูลทดสอบแล้วเติมใหม่ได้)
--   * ใช้ร่วมกับชุดตัวอย่าง 16 รายการได้: รหัส Item ไม่ชน ส่วนศูนย์งาน/คลังที่มีรหัสเดียวกันอยู่แล้ว (เช่น QC) ใช้ตัวเดิม
--   * BOM ทุกใบเป็นฉบับร่าง Revision A (เหมือนชุดตัวอย่างเดิม) พร้อมประวัติ "สร้างฉบับร่าง" ลองส่งขออนุมัติ/อนุมัติได้ที่หน้าโครงสร้างสินค้า
--   * Routing เป็นฉบับร่าง (ระบบยังไม่มีขั้นอนุมัติ Routing) ใบสั่งผลิตผูก BOM/Routing ของ FG
--   * ไม่ส่งอีเมล/LINE (กติกาข้อ 4 ของโหมดทดสอบ) บันทึก audit_logs ระบุ admin ตัวจริงและ persona
--
-- Rollback (ข้อมูลทดสอบอย่างเดียว): drop function public.app_sandbox_seed_factory_trial();
--   ข้อมูลที่เติมไปแล้วล้างได้ด้วยปุ่ม "ล้างข้อมูลทดสอบฝ่ายโรงงาน" (app_sandbox_purge_factory)
-- ============================================================================

create or replace function public.app_sandbox_seed_factory_trial()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.employees%rowtype;
  v_persona public.employees%rowtype;
  v_items integer;
  v_boms integer;
  v_steps integer;
  -- ขนาดมือจับ (มม.) 5 ขนาด: ลำดับในอาร์เรย์ = เลขท้ายรหัส Item (001..005)
  v_sizes constant integer[] := array[25, 32, 40, 50, 65];
begin
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;
  if exists (select 1 from public.factory_items where is_test and code like '%-TRY-%') then
    return jsonb_build_object('seeded', false,
      'items', (select count(*) from public.factory_items where is_test and code like '%-TRY-%'));
  end if;

  -- ศูนย์งานตามแผนก และคลัง (ใช้ตัวเดิมถ้ารหัสซ้ำกับชุดตัวอย่างเดิม)
  insert into public.factory_work_centers (code, name)
  select v.code, v.name
  from (values
    ('RB', 'แผนก RB ขึ้นรูปยาง'), ('SR', 'แผนก SR คลังยางเส้นยาว'), ('QC', 'แผนก QC ตรวจสอบขนาด'),
    ('GR', 'แผนก GR แปรรูปยาง'), ('PT', 'แผนก PT ขึ้นรูปพลาสติก'), ('BG', 'แผนก BG เย็บกระเป๋า'),
    ('PK', 'แผนก PK ประกอบและบรรจุ'), ('WH', 'แผนก WH คลังสินค้าสำเร็จรูป')
  ) as v(code, name)
  where not exists (select 1 from public.factory_work_centers w where w.is_test and w.code = v.code);

  insert into public.factory_warehouses (code, name)
  select v.code, v.name
  from (values
    ('RM', 'คลังวัตถุดิบ'), ('SR', 'คลังยางเส้นยาว (SR)'), ('WIP', 'คลังระหว่างผลิต'), ('FG', 'คลังสินค้าสำเร็จรูป')
  ) as v(code, name)
  where not exists (select 1 from public.factory_warehouses w where w.is_test and w.code = v.code);

  -- Item: ขนาดมือจับ 5 ขนาด → FG / ชิ้นงานยางแปรรูป / ชิ้นงานพลาสติก ต่อขนาด + วัตถุดิบและชิ้นงานที่ใช้ร่วมกัน
  insert into public.factory_items (code, name, name_en, item_type, category_code, brand, unit_code, procurement,
                                    lot_tracking, min_stock, specification, status, created_by, updated_by)
  select v.code, v.name, v.name_en, v.item_type, v.category_code, 'MNP', v.unit_code, v.procurement,
         v.lot_tracking, v.min_stock, v.specification, 'active', v_persona.id, v_persona.id
  from (
    select 'FG-TRY-' || lpad(s.n::text, 3, '0') as code,
           'ชุดมือจับยาง-ฝาพลาสติก ' || s.mm || ' มม. (ใส่กระเป๋า)' as name,
           'Rubber grip with plastic cap ' || s.mm || ' mm, bagged' as name_en,
           'FG' as item_type, 'industrial' as category_code, 'SET' as unit_code, 'make' as procurement,
           false as lot_tracking, 0::numeric as min_stock,
           'ชุดทดลอง ' || s.mm || ' มม.: ยางแปรรูป 1 + ฝาพลาสติก 1 ใส่กระเป๋า บรรจุกล่องละ 12 ชุด • ข้อมูลสมมติ ไม่ใช่สินค้าจริง' as specification
    from unnest(v_sizes) with ordinality as s(mm, n)
    union all
    select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 'ชิ้นงานยางแปรรูป ' || s.mm || ' มม. (GR)',
           'Processed rubber part ' || s.mm || ' mm', 'WIP', 'industrial', 'PCS', 'make', false, 0,
           'ผลิตที่แผนก GR จากยางเส้นยาว (ตัด ทากาว เจียร คัดแยก) ส่งให้แผนก PK • ข้อมูลสมมติ'
    from unnest(v_sizes) with ordinality as s(mm, n)
    union all
    select 'WIP-TRY-PTP-' || lpad(s.n::text, 3, '0'), 'ชิ้นงานพลาสติก ฝาครอบ ' || s.mm || ' มม. (PT)',
           'Plastic cap ' || s.mm || ' mm', 'WIP', 'industrial', 'PCS', 'make', false, 0,
           'ขึ้นรูปที่แผนก PT ส่งให้แผนก PK • ข้อมูลสมมติ'
    from unnest(v_sizes) with ordinality as s(mm, n)
    union all
    select * from (values
      ('WIP-TRY-RBL-001', 'ยางเส้นยาว สีดำ (RB→SR)', 'Black rubber long strip', 'WIP', 'compound', 'KG', 'make', true, 200::numeric,
       'ผลิตที่แผนก RB (RB-01..RB-13) รับเข้าคลัง SR และตรวจขนาดโดย QC • สูตรสมมติ ไม่ใช่สูตรผลิตจริง'),
      ('WIP-TRY-BAG-001', 'กระเป๋าผ้าใส่สินค้า (BG)', 'Product carry bag', 'WIP', 'packaging', 'PCS', 'make', false, 0::numeric,
       'เย็บด้วยจักรที่แผนก BG ส่งให้แผนก PK ใช้ร่วมกับทุกขนาด • ข้อมูลสมมติ'),
      ('RM-TRY-NR-001', 'ยางธรรมชาติ STR 20 (ทดลอง)', 'Natural rubber STR 20', 'RM', 'rubber', 'KG', 'buy', true, 500::numeric, 'วัตถุดิบหลักของยางเส้นยาว • ข้อมูลสมมติ'),
      ('RM-TRY-CB-001', 'คาร์บอนแบล็ก N330 (ทดลอง)', 'Carbon black N330', 'RM', 'chemical', 'KG', 'buy', true, 200::numeric, 'เคมีขั้นที่ 1 • ข้อมูลสมมติ'),
      ('RM-TRY-ZNO-001', 'ซิงค์ออกไซด์ (ทดลอง)', 'Zinc oxide', 'RM', 'chemical', 'KG', 'buy', true, 50::numeric, 'เคมีขั้นที่ 2 • ข้อมูลสมมติ'),
      ('RM-TRY-SUL-001', 'กำมะถันชนิดผง (ทดลอง)', 'Sulfur powder', 'RM', 'chemical', 'KG', 'buy', true, 40::numeric, 'เคมีขั้นที่ 3 (เครื่อง Auto เล็ก) • ข้อมูลสมมติ'),
      ('RM-TRY-ACC-001', 'สารเร่งปฏิกิริยา (ทดลอง)', 'Rubber accelerator', 'RM', 'chemical', 'KG', 'buy', true, 20::numeric, 'เคมีขั้นที่ 3 • ข้อมูลสมมติ (ยอดยกมาตั้งใจให้ต่ำกว่าขั้นต่ำ เพื่อลองขั้นสำรวจคงคลัง)'),
      ('RM-TRY-GLUE-001', 'กาวยางสำหรับชิ้นงาน (ทดลอง)', 'Rubber adhesive', 'RM', 'chemical', 'KG', 'buy', true, 30::numeric, 'ใช้ที่ GR-02 ทากาว • ข้อมูลสมมติ'),
      ('RM-TRY-PP-001', 'เม็ดพลาสติก PP (ทดลอง)', 'Polypropylene resin', 'RM', 'polymer', 'KG', 'buy', true, 300::numeric, 'ใช้ขึ้นรูปฝาพลาสติกที่ PT • ข้อมูลสมมติ'),
      ('RM-TRY-FAB-001', 'ผ้าใบสำหรับเย็บกระเป๋า (ทดลอง)', 'Canvas fabric', 'RM', 'packaging', 'SHEET', 'buy', true, 100::numeric, 'ใช้เย็บกระเป๋าที่ BG • ข้อมูลสมมติ'),
      ('RM-TRY-THR-001', 'ด้ายเย็บกระเป๋า (ทดลอง)', 'Sewing thread', 'RM', 'packaging', 'KG', 'buy', true, 5::numeric, 'ใช้เย็บกระเป๋าที่ BG • ข้อมูลสมมติ'),
      ('PKG-TRY-BOX-001', 'กล่องลูกฟูกบรรจุ 12 ชุด (ทดลอง)', 'Corrugated box for 12 sets', 'PKG', 'packaging', 'PCS', 'buy', false, 50::numeric, 'บรรจุที่ PK-04 • ข้อมูลสมมติ')
    ) as x(code, name, name_en, item_type, category_code, unit_code, procurement, lot_tracking, min_stock, specification)
  ) as v;
  get diagnostics v_items = row_count;

  -- BOM: ทุกใบเป็นฉบับร่าง Revision A (ลองส่งขออนุมัติ/อนุมัติได้ที่หน้าโครงสร้างสินค้า)
  -- ผลผลิต: FG = 12 ชุด/สูตร · ชิ้นงานยาง/พลาสติก/กระเป๋า = 100 ชิ้น · ยางเส้นยาว = 100 กก.
  insert into public.factory_boms (item_id, revision, output_qty, status, effective_date, note, created_by, updated_by)
  select i.id, 'A', case when i.item_type = 'FG' then 12 else 100 end,
         'draft', current_date, 'ชุดทดลอง 5 สินค้า (ข้อมูลสมมติ)', v_persona.id, v_persona.id
  from public.factory_items i
  where i.is_test and i.code like any (array['FG-TRY-%', 'WIP-TRY-%']);
  get diagnostics v_boms = row_count;

  insert into public.factory_bom_lines (bom_id, line_no, component_id, quantity, scrap_percent)
  select b.id, v.line_no, c.id, v.quantity, v.scrap_percent
  from (
    -- ยางเส้นยาว 100 กก. (เคมีขั้นที่ 1–3)
    select 'WIP-TRY-RBL-001' as parent_code, 1 as line_no, 'RM-TRY-NR-001' as component_code, 62::numeric as quantity, 2::numeric as scrap_percent
    union all select 'WIP-TRY-RBL-001', 2, 'RM-TRY-CB-001', 28, 0
    union all select 'WIP-TRY-RBL-001', 3, 'RM-TRY-ZNO-001', 4, 0
    union all select 'WIP-TRY-RBL-001', 4, 'RM-TRY-SUL-001', 2.5, 0
    union all select 'WIP-TRY-RBL-001', 5, 'RM-TRY-ACC-001', 1.5, 0
    -- กระเป๋า 100 ใบ
    union all select 'WIP-TRY-BAG-001', 1, 'RM-TRY-FAB-001', 60, 3
    union all select 'WIP-TRY-BAG-001', 2, 'RM-TRY-THR-001', 0.4, 0
    -- ต่อขนาด: ชิ้นงานยางแปรรูป (ปริมาณยางเส้นยาวเพิ่มตามขนาด) · ชิ้นงานพลาสติก · FG
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 1, 'WIP-TRY-RBL-001', (s.mm * 0.2)::numeric, 3 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 2, 'RM-TRY-GLUE-001', (s.mm * 0.01)::numeric, 0 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-PTP-' || lpad(s.n::text, 3, '0'), 1, 'RM-TRY-PP-001', (s.mm * 0.1)::numeric, 2 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 1, 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 12, 0 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 2, 'WIP-TRY-PTP-' || lpad(s.n::text, 3, '0'), 12, 0 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 3, 'WIP-TRY-BAG-001', 12, 1 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 4, 'PKG-TRY-BOX-001', 1, 0 from unnest(v_sizes) with ordinality as s(mm, n)
  ) as v
  join public.factory_items p on p.is_test and p.code = v.parent_code
  join public.factory_boms b on b.item_id = p.id and b.revision = 'A'
  join public.factory_items c on c.is_test and c.code = v.component_code;

  insert into public.factory_bom_history (bom_id, action, version, status_after, note, snapshot, changed_by)
  select b.id, 'create', b.version, 'draft', 'ชุดทดลอง 5 สินค้า', private.factory_bom_snapshot(b.id), v_persona.id
  from public.factory_boms b
  join public.factory_items i on i.id = b.item_id
  where b.is_test and i.code like any (array['FG-TRY-%', 'WIP-TRY-%']);

  -- Routing: ยางเส้นยาว / ชิ้นงานยางแปรรูป / ชิ้นงานพลาสติก / กระเป๋า / FG แต่ละตัวมีหนึ่ง Routing (ฉบับร่าง)
  insert into public.factory_routings (item_id, revision, status)
  select i.id, 'A', 'draft'
  from public.factory_items i
  where i.is_test and i.code like any (array['FG-TRY-%', 'WIP-TRY-%']);

  insert into public.factory_routing_steps (routing_id, sequence, name, work_center_id, setup_minutes, run_minutes, instruction)
  select r.id, t.step_no * 10, t.step_name, w.id, t.setup_minutes, t.run_minutes,
         'เวลาตัวอย่างต่อชุดผลิต ต้องยืนยันกับหน้างาน'
  from (
    select 'WIP-TRY-RBL-001' as item_code, 1 as step_no, 'RB-01 ชั่งเคมี' as step_name, 'RB' as center, 10::numeric as setup_minutes, 30::numeric as run_minutes
    union all select 'WIP-TRY-RBL-001', 2, 'RB-02 ตียางด้วยเครื่อง Auto และใส่เคมีขั้นที่ 1', 'RB', 10, 25
    union all select 'WIP-TRY-RBL-001', 3, 'RB-03 ตียางด้วยเครื่อง 2 ลูกกลิ้ง ขั้นที่ 1', 'RB', 5, 20
    union all select 'WIP-TRY-RBL-001', 4, 'RB-04 พักยาง 4 ชั่วโมง', 'RB', 0, 240
    union all select 'WIP-TRY-RBL-001', 5, 'RB-05 ตียางด้วยเครื่อง Auto และใส่เคมีขั้นที่ 2', 'RB', 10, 25
    union all select 'WIP-TRY-RBL-001', 6, 'RB-06 ตียางด้วยเครื่อง 2 ลูกกลิ้ง ขั้นที่ 2', 'RB', 5, 20
    union all select 'WIP-TRY-RBL-001', 7, 'RB-07 พักยาง 4 ชั่วโมง', 'RB', 0, 240
    union all select 'WIP-TRY-RBL-001', 8, 'RB-08 แบ่งยาง 4 กิโลกรัม แล้วใส่เคมีขั้นที่ 3 ที่เครื่อง Auto เล็ก', 'RB', 10, 15
    union all select 'WIP-TRY-RBL-001', 9, 'RB-09 นำยางที่ผสมเคมีจากเครื่อง Auto เล็ก มาผสมกับยางที่เหลือด้วยเครื่อง 2 ลูกกลิ้ง', 'RB', 5, 25
    union all select 'WIP-TRY-RBL-001', 10, 'RB-10 ฉีดยาง', 'RB', 20, 60
    union all select 'WIP-TRY-RBL-001', 11, 'RB-11 อบยางด้วย Oven', 'RB', 10, 90
    union all select 'WIP-TRY-RBL-001', 12, 'RB-12 อบยางด้วย HCM', 'RB', 10, 60
    union all select 'WIP-TRY-RBL-001', 13, 'RB-13 ตัดยางเส้นยาว', 'RB', 5, 30
    union all select 'WIP-TRY-RBL-001', 14, 'SR-01 รับยางเส้นยาวจากแผนก RB เข้าคลัง', 'SR', 0, 15
    union all select 'WIP-TRY-RBL-001', 15, 'QC-01 ตรวจขนาดยางขณะ SR รับยางเข้าคลัง', 'QC', 0, 20
    union all select 'WIP-TRY-BAG-001', 1, 'BG-01 เย็บกระเป๋าใส่สินค้าด้วยจักร', 'BG', 10, 120
    union all select 'WIP-TRY-BAG-001', 2, 'BG-02 ส่งกระเป๋าให้แผนก PK', 'BG', 0, 10
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 1, 'GR-01 นำยางเส้นยาวจากคลัง SR มาตัด', 'GR', 5, 40 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 2, 'GR-02 ทากาว', 'GR', 5, 30 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 3, 'GR-03 เจียรแปรรูป', 'GR', 10, 60 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-RBP-' || lpad(s.n::text, 3, '0'), 4, 'GR-04 คัดแยก แล้วส่งชิ้นงานยางแปรรูปให้แผนก PK', 'GR', 0, 20 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-PTP-' || lpad(s.n::text, 3, '0'), 1, 'PT-01 นำพลาสติกมาขึ้นรูปตามรูปแบบที่ต้องการ', 'PT', 20, 90 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'WIP-TRY-PTP-' || lpad(s.n::text, 3, '0'), 2, 'PT-02 ส่งชิ้นงานพลาสติกให้แผนก PK', 'PT', 0, 10 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 1, 'PK-01 รับชิ้นงานยางแปรรูปจาก GR และชิ้นงานพลาสติกจาก PT', 'PK', 0, 15 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 2, 'PK-02 ประกอบชิ้นงานเป็นสินค้า', 'PK', 5, 60 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 3, 'PK-03 นำสินค้าใส่กระเป๋าที่แผนก BG เย็บไว้', 'PK', 0, 30 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 4, 'PK-04 บรรจุสินค้าลงกล่อง', 'PK', 0, 20 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 5, 'PK-05 ส่งสินค้าสำเร็จรูปให้แผนก WH', 'PK', 0, 10 from unnest(v_sizes) with ordinality as s(mm, n)
    union all select 'FG-TRY-' || lpad(s.n::text, 3, '0'), 6, 'WH-01 รับสินค้าสำเร็จรูปจากแผนก PK เข้าคลัง', 'WH', 0, 15 from unnest(v_sizes) with ordinality as s(mm, n)
  ) as t
  join public.factory_items i on i.is_test and i.code = t.item_code
  join public.factory_routings r on r.item_id = i.id and r.revision = 'A'
  join public.factory_work_centers w on w.is_test and w.code = t.center;
  get diagnostics v_steps = row_count;

  -- ใบสั่งผลิตจากฝ่ายขาย (หนึ่งใบต่อ FG) สถานะวางแผน รอฝ่ายวางแผนสำรวจคงคลัง จัดทำ BOM และออกใบสั่งงาน
  insert into public.factory_production_orders (code, item_id, bom_id, routing_id, planned_qty, status, due_date)
  select 'MO-TRY-' || lpad(s.n::text, 3, '0'), i.id, b.id, r.id, 600 + s.n * 120, 'planned', current_date + 14 + (s.n * 2)::integer
  from unnest(v_sizes) with ordinality as s(mm, n)
  join public.factory_items i on i.is_test and i.code = 'FG-TRY-' || lpad(s.n::text, 3, '0')
  join public.factory_boms b on b.item_id = i.id and b.revision = 'A'
  join public.factory_routings r on r.item_id = i.id and r.revision = 'A';

  -- ยอดยกมา: วัตถุดิบ/กล่อง → คลัง RM · ยางเส้นยาว → คลัง SR · Item ที่ติดตามล็อตได้ล็อตละ 1 ใบ
  insert into public.factory_lots (item_id, lot_number, received_date)
  select i.id, 'LOT-TRY-' || lpad(v.seq::text, 3, '0'), current_date
  from (values
    ('WIP-TRY-RBL-001', 1), ('RM-TRY-NR-001', 2), ('RM-TRY-CB-001', 3), ('RM-TRY-ZNO-001', 4), ('RM-TRY-SUL-001', 5),
    ('RM-TRY-ACC-001', 6), ('RM-TRY-GLUE-001', 7), ('RM-TRY-PP-001', 8), ('RM-TRY-FAB-001', 9), ('RM-TRY-THR-001', 10)
  ) as v(code, seq)
  join public.factory_items i on i.is_test and i.code = v.code;

  insert into public.factory_inventory_movements (item_id, warehouse_id, lot_id, quantity, kind, reference, created_by)
  select i.id, w.id, l.id, v.quantity, 'opening', 'ยอดยกมาชุดทดลอง (ข้อมูลสมมติ)', v_persona.id
  from (values
    ('WIP-TRY-RBL-001', 'SR', 260), ('RM-TRY-NR-001', 'RM', 1500), ('RM-TRY-CB-001', 'RM', 420), ('RM-TRY-ZNO-001', 'RM', 90),
    ('RM-TRY-SUL-001', 'RM', 75), ('RM-TRY-ACC-001', 'RM', 8), ('RM-TRY-GLUE-001', 'RM', 60), ('RM-TRY-PP-001', 'RM', 650),
    ('RM-TRY-FAB-001', 'RM', 220), ('RM-TRY-THR-001', 'RM', 12), ('PKG-TRY-BOX-001', 'RM', 400)
  ) as v(code, warehouse_code, quantity)
  join public.factory_items i on i.is_test and i.code = v.code
  join public.factory_warehouses w on w.is_test and w.code = v.warehouse_code
  left join public.factory_lots l on l.item_id = i.id and i.lot_tracking;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'SANDBOX_SEED_FACTORY_TRIAL', 'sandbox_session', v_admin.id::text,
          jsonb_build_object('items', v_items, 'boms', v_boms, 'routing_steps', v_steps,
                             'persona_employee_no', v_persona.employee_no));
  return jsonb_build_object('seeded', true, 'items', v_items, 'boms', v_boms, 'steps', v_steps);
end;
$$;

revoke all on function public.app_sandbox_seed_factory_trial() from public, anon;
grant execute on function public.app_sandbox_seed_factory_trial() to authenticated;
