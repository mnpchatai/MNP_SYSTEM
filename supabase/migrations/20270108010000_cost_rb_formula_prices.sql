-- ============================================================================
-- ต้นทุนการผลิต เฟส 1: ต้นทุนสูตรยางของ RB (สูตรแบบน้ำหนัก 4 ส่วน + ราคาเคมีต่อ kg + ข้อมูลต้นทุนสูตร)
-- ผู้ใช้ตัดสิน 2026-11-27
--   1) ใบสูตรจริงมี 4 ส่วนต่อโม่: ขั้นเตรียมวัตถุดิบ + ขั้นผสม 1, 2, 3 กรอกเป็นน้ำหนัก (kg หรือ g) ไม่ใช่ PHR
--      บรรทัดที่ระบุเคมีแต่ไม่มีน้ำหนัก เก็บเป็นบรรทัดน้ำหนัก 0 (ไม่เบิก ไม่ชั่ง ต้นทุน 0)
--      ค่ามาตรฐานการผสม (อุณหภูมิเครื่องผสม อุณหภูมิปล่อยยาง เวลาผสม) คงเดิม เฉพาะขั้น 1 และ 2
--   2) ราคาเคมีต่อ kg กรอกและเก็บในโมดูล ST มีวันที่เริ่มใช้ เก็บประวัติทุกครั้ง
--   3) ใครเห็นอะไร (บังคับที่ RPC):
--      - ต้นทุนและราคาทั้งหมด: บทบาท general_manager / factory_manager / admin หรือแผนก PP ทุกบทบาท
--      - ราคาวัตถุดิบอย่างเดียว (อ่านและแก้): แผนก ST ทุกบทบาท · admin แก้ราคาได้ด้วย
--      - คนอื่นทั้งหมด (RB จัดซื้อ assistant_factory_manager ผู้จัดการแผนกอื่น) ไม่เห็นราคาและไม่เห็นต้นทุน
--
-- สิ่งที่แตะ
--   ใหม่: public.rf_material_prices (แบบ rf_purchase_orders: is_test + trigger private.sandbox_row_scope · revoke anon / authenticated ·
--         RLS + policy ปิดทั้งหมด · lab_only_guard_table · อยู่ใน private.sandbox_unguarded_tables() และ public.app_sandbox_purge_rf())
--         แถวเพิ่มอย่างเดียว ไม่มี RPC ใดแก้หรือลบ (แก้ราคา = เพิ่มแถวใหม่) · ราคาที่ใช้ ณ วันที่ D = แถวที่ effective_from มากสุดที่ไม่เกิน D
--         ซ้ำวันเดียวกันใช้แถวที่ created_at ล่าสุด
--   ใหม่: private.rf_cost_viewer / rf_price_writer / rf_price_reader (public.employees) · private.rf_price_rows() · private.rf_items_by_weight(jsonb)
--         public.app_rf_prices() · public.app_rf_price_save(text, numeric, date, text) · public.app_rf_cost_data()
--   replace: private.rf_parse_items(jsonb, jsonb) จาก 20261130010000_bom_rf_go_live.sql
--            (+ บรรทัดแบบน้ำหนัก {materialCode, stage 0-3, kg, unit} · บรรทัด PHR เดิมไม่เปลี่ยน)
--   replace: private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--            (+ สี่บรรทัดหลัง rf_parse_items: สูตรแบบน้ำหนัก batch_kg = ผลรวมน้ำหนัก นอกนั้นคงเดิมทุกบรรทัด)
--   แก้ในที่ (อ่านนิยามที่ใช้อยู่แล้วแทรกชื่อตาราง ไม่คัดลอกทั้งฟังก์ชัน จึงไม่ทับงานของ migration อื่นที่เพิ่งเปลี่ยนรายชื่อ):
--            private.sandbox_unguarded_tables() + 'rf_material_prices' · public.app_sandbox_purge_rf() + ลบ rf_material_prices ของโหมดทดสอบ
--   ไม่แตะ: private.rf_save_requisitions / rf_save_lots / rf_records / public.app_rf_save และตาราง rf_* เดิมทุกตาราง (ไม่มีคอลัมน์ใหม่)
--
-- รูปข้อมูลสูตร (rf_recipes.items jsonb · ไม่เปลี่ยนโครงตาราง)
--   แบบเดิม (PHR):  [{materialCode, phr > 0, stage 1|2}]                      batch_kg = ค่าที่กรอก · kg ต่อโม่ = phr / ผลรวม phr × batch_kg
--   แบบน้ำหนัก:     [{materialCode, stage 0|1|2|3, kg = 0 หรือ 0.001-10000, unit 'kg'|'g', phr}]  stage 0 = ขั้นเตรียมวัตถุดิบ · kg เป็นกิโลกรัมเสมอ (ทศนิยมไม่เกิน 4 ตำแหน่ง = 0.1 g)
--                   unit = หน่วยที่กรอกตามใบสูตร ใช้แสดงผลเท่านั้น · เซิร์ฟเวอร์เขียน phr = kg และ batch_kg = ผลรวม kg
--                   ทุกตัวที่แบ่งด้วย phr / ผลรวม phr × batch_kg (rf_save_requisitions และ client รุ่นก่อน) จึงได้ kg ของบรรทัดพอดี โดยไม่ต้องแก้
--                   บรรทัด kg = 0 ได้ need = 0 ใน rf_save_requisitions จึงไม่เกิดบรรทัดเบิก
--   สูตรหนึ่ง revision เป็นแบบเดียว (ปนกันไม่ได้) · สูตรเดิมไม่ถูกแปลง ยังเปิด เบิก ชั่ง ผสมได้เหมือนเดิม
--   ใบเบิก rf_requisitions.lines[].stage รับค่า 0-3 ตามสูตร (เดิมอ่านด้วย coalesce(stage, 1) อยู่แล้ว)
--
-- ลำดับ deploy: apply migration นี้ก่อน merge หน้าเว็บ (หน้าเว็บใหม่ส่งบรรทัดแบบน้ำหนักและเรียก RPC ใหม่)
--   หน้าเว็บรุ่นก่อนอ่านฐานข้อมูลนี้ได้ (สูตรแบบน้ำหนักมี phr และ stages สองขั้นครบ แสดงเป็นสูตร PHR) แต่ถ้าแก้สูตรแบบน้ำหนักด้วยหน้าเว็บรุ่นก่อน
--   ร่างจะถูกส่งกลับเป็นแบบ PHR (บรรทัดน้ำหนัก 0 หาย ส่วน 0 / 3 กลายเป็นขั้น 1) จึงควร merge หน้าเว็บทันทีหลัง apply
--   migration รุ่นหลังที่ replace private.sandbox_unguarded_tables() หรือ public.app_sandbox_purge_rf() ต้องคง rf_material_prices ไว้
--   (ไฟล์นี้แทรกชื่อในนิยามที่ใช้อยู่ จึงไม่มีนิยามเต็มของสองตัวนั้นในไฟล์นี้ให้คัดลอก)
--   ก่อน apply ที่ production: เทียบ md5(pg_get_functiondef(...)) ของ private.rf_parse_items(jsonb, jsonb) และ
--   private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) กับ stack ที่ apply ถึง 20270107010000 (ต้องยังเป็นนิยามของ 20261130010000)
--
-- Rollback (ยังเป็นข้อมูลทดสอบทั้งหมด): drop function public.app_rf_cost_data(), public.app_rf_price_save(text, numeric, date, text), public.app_rf_prices(),
--   private.rf_price_rows(), private.rf_price_reader(public.employees), private.rf_price_writer(public.employees), private.rf_cost_viewer(public.employees) ·
--   create or replace private.rf_parse_items / private.rf_save_recipes กลับเป็นนิยามของ 20261130010000 (สูตรแบบน้ำหนักที่บันทึกแล้วยังอ่านได้ แต่แก้ไม่ได้) ·
--   drop function private.rf_items_by_weight(jsonb) · เอา 'rf_material_prices' ออกจาก private.sandbox_unguarded_tables() และ public.app_sandbox_purge_rf() ·
--   drop table public.rf_material_prices
-- ============================================================================

-- 0. ตรวจฐานที่ migration นี้ต่อยอด ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.rf_chem_docs') is null or to_regprocedure('private.rf_chem_planner(public.employees)') is null then
    raise exception 'ไม่พบคลังเคมี ST / RB กรุณา apply 20261220010000_st_rb_chemical_store.sql ก่อน';
  end if;
  if to_regprocedure('private.bom_real_open()') is null or to_regprocedure('private.rf_actor()') is null then
    raise exception 'ไม่พบ private.bom_real_open / private.rf_actor กรุณา apply 20261201010000_bom_rf_sandbox_lock.sql ก่อน';
  end if;
  if not ('rf_chem_docs' = any (private.sandbox_unguarded_tables())) then
    raise exception 'private.sandbox_unguarded_tables() ไม่มี rf_chem_docs (ฐานไม่ใช่ฉบับที่คาดไว้)';
  end if;
end $$;

-- 1. ตารางราคาเคมีต่อ kg (แยกโหมดด้วย is_test · เพิ่มอย่างเดียว) ---------------------------------------------------------------
create table public.rf_material_prices (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- รหัสวัตถุดิบของ rf_materials (โหมดเดียวกัน) ตรวจว่ามีอยู่จริงใน app_rf_price_save · ไม่ผูก FK เพราะ rf_materials ไม่มี unique (code, is_test) ให้อ้าง
  material_code text not null check (material_code ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  -- บาทต่อกิโลกรัม ทศนิยมไม่เกิน 4 ตำแหน่ง
  price_per_kg numeric not null check (price_per_kg > 0 and price_per_kg <= 10000000 and price_per_kg = round(price_per_kg, 4)),
  effective_from date not null check (effective_from >= date '2000-01-01'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  -- clock_timestamp (ไม่ใช่ now) เพื่อให้สองแถวในธุรกรรมเดียวกันมีลำดับก่อนหลังจริง (ซ้ำวันใช้แถวล่าสุด)
  created_at timestamptz not null default clock_timestamp(),
  unique (id, is_test)
);
create index rf_material_prices_lookup_idx on public.rf_material_prices (is_test, material_code, effective_from desc, created_at desc);
comment on table public.rf_material_prices is 'ราคาเคมีต่อ kg ของวัตถุดิบ RubberFlow มีวันที่เริ่มใช้ · เพิ่มอย่างเดียว (แก้ราคา = แถวใหม่) · อ่าน/เขียนผ่าน app_rf_prices / app_rf_price_save / app_rf_cost_data เท่านั้น';
comment on column public.rf_material_prices.effective_from is 'วันที่เริ่มใช้ราคา · ราคาที่ใช้ ณ วันที่ D = แถวที่ effective_from มากสุดที่ไม่เกิน D ซ้ำวันใช้ created_at ล่าสุด';

create trigger rf_material_prices_sandbox_scope before insert or update or delete on public.rf_material_prices
  for each row execute function private.sandbox_row_scope();
revoke all on public.rf_material_prices from anon, authenticated;
alter table public.rf_material_prices enable row level security;
create policy rf_material_prices_no_direct_access on public.rf_material_prices for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.rf_material_prices');

-- 2. ตารางใหม่รู้จักโหมดทดสอบ + ล้างข้อมูลทดสอบ: แทรกชื่อในนิยามที่ใช้อยู่ ------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  if not ('rf_material_prices' = any (private.sandbox_unguarded_tables())) then
    v_def := pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure);
    v_new := replace(v_def, '''rf_chem_docs'',', '''rf_chem_docs'',''rf_material_prices'',');
    if v_new = v_def then
      raise exception 'แทรก rf_material_prices ใน private.sandbox_unguarded_tables() ไม่ได้ (ไม่พบ ''rf_chem_docs'', ในนิยาม)';
    end if;
    execute v_new;
  end if;
  if not ('rf_material_prices' = any (private.sandbox_unguarded_tables())) or not ('rf_chem_docs' = any (private.sandbox_unguarded_tables())) then
    raise exception 'private.sandbox_unguarded_tables() หลังแก้ไม่มี rf_material_prices';
  end if;

  v_def := pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure);
  if position('rf_material_prices' in v_def) = 0 then
    v_new := replace(v_def, 'array[''rf_chem_docs'', ''rf_purchase_orders'',', 'array[''rf_material_prices'', ''rf_chem_docs'', ''rf_purchase_orders'',');
    if v_new = v_def then
      raise exception 'แทรก rf_material_prices ใน public.app_sandbox_purge_rf() ไม่ได้ (ไม่พบรายชื่อตารางที่ขึ้นต้นด้วย rf_chem_docs)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_sandbox_purge_rf() to authenticated;

-- 3. สูตรแบบน้ำหนัก ---------------------------------------------------------------------------------------------------------------
-- สูตรเป็นแบบน้ำหนักเมื่อทุกบรรทัดมี kg เป็นตัวเลข (ผลของ rf_parse_items เป็นแบบเดียวทั้งสูตรเสมอ)
create or replace function private.rf_items_by_weight(p_items jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0
     and not exists (select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e -> 'kg') is distinct from 'number')
$$;
revoke all on function private.rf_items_by_weight(jsonb) from public, anon, authenticated;

-- private.rf_parse_items(jsonb, jsonb) จาก 20261130010000_bom_rf_go_live.sql
--   (+ บรรทัดแบบน้ำหนัก: มี kg = stage 0-3 (ไม่ระบุ = 1) kg = 0 หรือ 0.001-10000 ทศนิยมไม่เกิน 4 ตำแหน่ง unit kg|g (ไม่ระบุ = kg) เขียน phr = kg
--      ทั้งสูตรต้องเป็นแบบเดียว และสูตรแบบน้ำหนักต้องมีน้ำหนักรวมมากกว่า 0 · บรรทัด PHR เดิม: phr > 0 stage 1|2 เหมือนเดิม)
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
  v_weight boolean;
  v_mode boolean;
  v_kg numeric;
  v_unit text;
  v_sum numeric := 0;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) not between 1 and 100 then
    raise exception 'RF_INVALID_RECIPE';
  end if;
  for v_el in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_el) <> 'object' then raise exception 'RF_INVALID_RECIPE'; end if;
    v_code := private.bom_text(v_el, 'materialCode', 40, 1, 'RF_INVALID_RECIPE');
    if v_code = any (v_seen) then raise exception 'RF_INVALID_RECIPE'; end if;
    v_seen := v_seen || v_code;
    -- แบบของบรรทัด: มี kg (ไม่ใช่ null) = แบบน้ำหนัก · ทุกบรรทัดต้องเป็นแบบเดียวกับบรรทัดแรก
    v_weight := (v_el -> 'kg') is not null and jsonb_typeof(v_el -> 'kg') <> 'null';
    if v_mode is null then
      v_mode := v_weight;
    elsif v_mode <> v_weight then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    if v_weight then
      v_kg := private.bom_num(v_el -> 'kg', 'RF_INVALID_RECIPE', 0, 10000);
      -- น้ำหนักที่ไม่ใช่ 0 ต้องไม่ต่ำกว่า 1 g: rf_save_requisitions ถือว่ายอดไม่เกิน 0.0001 kg คือจัดสรรครบแล้ว บรรทัดที่เล็กกว่านั้นจะไม่ถูกเบิกโดยไม่แจ้ง
      if v_kg <> round(v_kg, 4) or (v_kg > 0 and v_kg < 0.001) then raise exception 'RF_INVALID_RECIPE'; end if;
      v_unit := coalesce(nullif(private.bom_text(v_el, 'unit', 2, 0, 'RF_INVALID_RECIPE'), ''), 'kg');
      if v_unit not in ('kg', 'g') then raise exception 'RF_INVALID_RECIPE'; end if;
      v_stage := coalesce(private.bom_num(v_el -> 'stage', 'RF_INVALID_RECIPE', 0, 3), 1);
      v_sum := v_sum + v_kg;
    else
      v_phr := private.bom_num(v_el -> 'phr', 'RF_INVALID_RECIPE', 0, 100000);
      if v_phr is null or v_phr <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
      v_stage := coalesce(private.bom_num(v_el -> 'stage', 'RF_INVALID_RECIPE', 1, 2), 1);
    end if;
    if v_stage <> trunc(v_stage) then raise exception 'RF_INVALID_RECIPE'; end if;
    select m.active into v_active from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.code = v_code;
    if not found then raise exception 'RF_INVALID_RECIPE'; end if;
    if not v_active and not exists (
         select 1 from jsonb_array_elements(coalesce(p_prev, '[]'::jsonb)) e where e ->> 'materialCode' = v_code) then
      raise exception 'RF_INVALID_RECIPE';
    end if;
    if v_weight then
      v_kg := trim_scale(v_kg);
      v_out := v_out || jsonb_build_array(jsonb_build_object('materialCode', v_code, 'phr', v_kg, 'stage', v_stage::integer, 'kg', v_kg, 'unit', v_unit));
    else
      v_out := v_out || jsonb_build_array(jsonb_build_object('materialCode', v_code, 'phr', v_phr, 'stage', v_stage::integer));
    end if;
  end loop;
  if v_mode and v_sum <= 0 then raise exception 'RF_INVALID_RECIPE'; end if;
  return v_out;
end;
$$;
revoke all on function private.rf_parse_items(jsonb, jsonb) from public, anon, authenticated;

-- private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) จาก 20261130010000_bom_rf_go_live.sql
--   (+ สี่บรรทัดหลัง rf_parse_items: สูตรแบบน้ำหนัก batch_kg = ผลรวมน้ำหนักของบรรทัด · นอกนั้นคงเดิมทุกบรรทัด)
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
    -- สูตรแบบน้ำหนัก (20270108010000): น้ำหนักต่อชุดผสม = ผลรวมน้ำหนักทุกบรรทัด เซิร์ฟเวอร์คำนวณเอง ไม่ใช้ค่าที่ client ส่ง
    if private.rf_items_by_weight(v_items) then
      v_batch := (select trim_scale(sum((e ->> 'kg')::numeric)) from jsonb_array_elements(v_items) e);
    end if;

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
revoke all on function private.rf_save_recipes(uuid, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. สิทธิ์ของราคาและต้นทุน -------------------------------------------------------------------------------------------------------
-- เห็นต้นทุนและราคาทั้งหมด: บทบาท general_manager / factory_manager / admin หรือแผนก PP ทุกบทบาท
--   (assistant_factory_manager ไม่อยู่ในกลุ่มนี้ เว้นแต่สังกัดแผนก PP)
create or replace function private.rf_cost_viewer(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
     and (coalesce(private.employee_role_code(p_employee.id) in ('general_manager', 'factory_manager', 'admin'), false)
          or coalesce(private.bom_dept_of(p_employee) = 'PP', false))
$$;
revoke all on function private.rf_cost_viewer(public.employees) from public, anon, authenticated;

-- แก้ราคาเคมี: แผนก ST ทุกบทบาท (ตัวตรวจเดียวกับงานคลัง ST ใน app_rf_save) หรือ admin
create or replace function private.rf_price_writer(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
     and (coalesce(private.bom_dept_of(p_employee) = 'ST', false)
          or coalesce(private.employee_role_code(p_employee.id) = 'admin', false))
$$;
revoke all on function private.rf_price_writer(public.employees) from public, anon, authenticated;

-- อ่านราคาเคมี: ผู้เห็นต้นทุน หรือผู้แก้ราคา (แผนก ST)
create or replace function private.rf_price_reader(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.rf_cost_viewer(p_employee) or private.rf_price_writer(p_employee)
$$;
revoke all on function private.rf_price_reader(public.employees) from public, anon, authenticated;

-- ราคาทุกแถวของโหมดผู้เรียก (ประวัติครบ) · ผู้เรียกต้องตรวจสิทธิ์ก่อน
create or replace function private.rf_price_rows()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
        'id', p.id, 'materialCode', p.material_code, 'pricePerKg', p.price_per_kg, 'effectiveFrom', to_char(p.effective_from, 'YYYY-MM-DD'),
        'note', p.note, 'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''))
      order by p.material_code collate "C", p.effective_from desc, p.created_at desc, p.id)
    from public.rf_material_prices p where p.is_test = (select private.bom_test_mode())), '[]'::jsonb)
$$;
revoke all on function private.rf_price_rows() from public, anon, authenticated;

-- 5. RPC ---------------------------------------------------------------------------------------------------------------------------
-- อ่านราคาเคมี: { canWrite, prices: [{id, materialCode, pricePerKg, effectiveFrom, note, createdAt, createdBy}] }
create or replace function public.app_rf_prices()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_price_reader(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  return jsonb_build_object('canWrite', private.rf_price_writer(v_actor), 'prices', private.rf_price_rows());
end;
$$;
revoke all on function public.app_rf_prices() from public, anon;
grant execute on function public.app_rf_prices() to authenticated;

-- บันทึกราคาเคมี (เพิ่มแถวใหม่เสมอ ไม่แก้แถวเดิม) คืนรูปเดียวกับ app_rf_prices
create or replace function public.app_rf_price_save(p_material_code text, p_price_per_kg numeric, p_effective_from date, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := btrim(coalesce(p_material_code, ''));
  v_note text := btrim(coalesce(p_note, ''));
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_last public.rf_material_prices%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_price_writer(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  if p_price_per_kg is null or p_price_per_kg = 'NaN'::numeric or p_price_per_kg <= 0 or p_price_per_kg > 10000000
     or p_price_per_kg <> round(p_price_per_kg, 4)
     or p_effective_from is null or p_effective_from < date '2000-01-01' or p_effective_from > v_today + 366
     or char_length(v_note) > 300
     or not exists (select 1 from public.rf_materials m where m.is_test = (select private.bom_test_mode()) and m.code = v_code) then
    raise exception 'RF_INVALID_PRICE';
  end if;
  -- กันกดซ้ำ: แถวที่ใช้อยู่ของวันเดียวกันเหมือนกันทุกช่องแล้ว ไม่เพิ่มแถว
  select * into v_last from public.rf_material_prices p
  where p.is_test = (select private.bom_test_mode()) and p.material_code = v_code and p.effective_from = p_effective_from
  order by p.created_at desc, p.id desc limit 1;
  if not found or v_last.price_per_kg <> p_price_per_kg or v_last.note <> v_note then
    insert into public.rf_material_prices (is_test, material_code, price_per_kg, effective_from, note, created_by)
    values ((select private.bom_test_mode()), v_code, p_price_per_kg, p_effective_from, v_note, v_actor.id);
  end if;
  return jsonb_build_object('canWrite', true, 'prices', private.rf_price_rows());
end;
$$;
revoke all on function public.app_rf_price_save(text, numeric, date, text) from public, anon;
grant execute on function public.app_rf_price_save(text, numeric, date, text) to authenticated;

-- ข้อมูลต้นทุนสูตร: ราคา + วัตถุดิบ + สูตรทุก revision + ล็อตผสมล่าสุด 200 ล็อตพร้อมบรรทัดที่ชั่งจริงของใบเบิกที่ใช้ผสม
--   เฉพาะผู้เห็นต้นทุน (ST อ่านราคาได้จาก app_rf_prices แต่เรียกตัวนี้ไม่ได้)
create or replace function public.app_rf_cost_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_test boolean;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_cost_viewer(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  v_test := private.bom_test_mode();
  return jsonb_build_object(
    'prices', private.rf_price_rows(),
    'materials', coalesce((
      select jsonb_agg(jsonb_build_object('code', m.code, 'name', m.name, 'category', m.category) order by m.code collate "C")
      from public.rf_materials m where m.is_test = v_test), '[]'::jsonb),
    'recipes', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.recipe_code, 'revision', r.revision, 'status', r.status, 'productCode', r.product_code, 'batchKg', r.batch_kg, 'items', r.items)
        order by r.recipe_code collate "C", r.revision)
      from public.rf_recipes r where r.is_test = v_test), '[]'::jsonb),
    'lots', coalesce((
      select jsonb_agg(x.lot order by x.created_at desc, x.lot_no collate "C")
      from (
        select l.created_at, l.lot_no, jsonb_build_object(
            'lotNo', l.lot_no, 'orderId', l.order_no, 'recipeId', l.recipe_code,
            'recipeRevision', (
              select q.recipe_revision from public.rf_requisitions q
              where q.is_test = v_test and q.req_no in (select s ->> 'id' from jsonb_array_elements(l.sources) s where s ->> 'type' = 'requisition')
              order by q.req_no collate "C" limit 1),
            'batches', (
              select sum(q.batches) from public.rf_requisitions q
              where q.is_test = v_test and q.req_no in (select s ->> 'id' from jsonb_array_elements(l.sources) s where s ->> 'type' = 'requisition')),
            'createdAt', private.bom_ms(l.created_at),
            'requisitions', coalesce((
              select jsonb_agg(jsonb_build_object(
                  'id', q.req_no, 'issuedAt', private.bom_ms(q.issued_at),
                  'lines', coalesce((
                    select jsonb_agg(jsonb_build_object(
                        'materialCode', t.e -> 'materialCode', 'stage', t.e -> 'stage', 'targetKg', t.e -> 'targetKg',
                        'actualKg', t.e -> 'actualKg', 'weighedAt', t.e -> 'weighedAt') order by t.ord)
                    from jsonb_array_elements(q.lines) with ordinality as t(e, ord)), '[]'::jsonb))
                order by q.req_no collate "C")
              from public.rf_requisitions q
              where q.is_test = v_test and q.req_no in (select s ->> 'id' from jsonb_array_elements(l.sources) s where s ->> 'type' = 'requisition')), '[]'::jsonb)) as lot
        from public.rf_lots l
        where l.is_test = v_test and l.stage = 'mixing'
        order by l.created_at desc, l.lot_no collate "C"
        limit 200) x), '[]'::jsonb));
end;
$$;
revoke all on function public.app_rf_cost_data() from public, anon;
grant execute on function public.app_rf_cost_data() to authenticated;
