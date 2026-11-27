-- ============================================================================
-- ต้นทุนการผลิต เฟส 3: ต้นทุนต่อชิ้นของ GR / PT / BG / PK (จำนวนคนของเป้าต่อชั่วโมง + หมวดของของซื้อ)
-- ผู้ใช้ตัดสิน 2026-11-27
--   1) เวลามาตรฐานของ GR / PT / BG / PK = เป้าชิ้นต่อชั่วโมงที่หัวหน้าแผนกตั้งใน "ตั้งค่าขั้นตอนและเป้า" (bom_gr_config.targets) ไม่ใช่ตารางใหม่
--      เป้าแต่ละรายการมีจำนวนคน people (จำนวนเต็ม 1-50 · ไม่ส่ง = 1) · ค่าแรงต่อชิ้น = อัตราค่าแรงของแผนก × people / perHour (คำนวณที่หน้าเว็บ)
--      กติกา "ต้องทำ = ชม. × เป้า × 0.95" ไม่เปลี่ยนและไม่ใช้ people
--   2) ราคาของซื้อ = rf_material_prices ชนิด part เท่านั้น · ของซื้อมีหมวดของตัวเอง (หมวดของของซื้อ ตั้งในคลัง ST)
--      อ่าน: ผู้เห็นต้นทุน + แผนก ST (private.rf_price_reader) · แก้: แผนก ST ทุกบทบาท + admin (private.rf_price_writer) เหมือนราคา
--   3) สูตร PHR เปลี่ยนเป็นแบบน้ำหนักใน revision ใหม่: ฐานข้อมูลไม่ห้ามอยู่แล้ว จึงไม่แตะ private.rf_parse_items / private.rf_save_recipes
--      (rf_parse_items ตรวจว่าทุกบรรทัดของ revision เดียวเป็นแบบเดียวกัน · p_prev ใช้ตรวจวัตถุดิบที่เลิกใช้เท่านั้น ·
--       rf_save_recipes ไม่เทียบแบบของ revision ใหม่กับ revision ก่อน) · ห้ามแบบน้ำหนัก -> PHR เป็นกติกาของหน้าเว็บ
--
-- สิ่งที่แตะ
--   ใหม่: public.rf_part_categories (แบบเดียวกับ rf_material_prices: is_test + trigger private.sandbox_row_scope · revoke anon / authenticated ·
--         RLS + policy ปิดทั้งหมด · lab_only_guard_table · อยู่ใน private.sandbox_unguarded_tables() และ public.app_sandbox_purge_rf())
--         แถวเพิ่มอย่างเดียว ไม่มี RPC ใดแก้หรือลบ · หมวดของรหัส = แถวล่าสุดของ (is_test, item_code) · หมวดว่าง = ล้างหมวด
--   ใหม่: private.rf_part_category_out(public.employees) · public.app_rf_part_categories() · public.app_rf_part_category_save(text, text)
--   แก้ในที่ (อ่านนิยามที่ใช้อยู่แล้วแทนข้อความ ไม่คัดลอกทั้งฟังก์ชัน จึงไม่ทับงานของ migration อื่น):
--         private.sandbox_unguarded_tables() (ฐาน 20261220010000 + แทรกโดย 20270109010000 / 20270110010000) + 'rf_part_categories' ต่อจาก 'rf_station_standards'
--         public.app_sandbox_purge_rf() (ฐาน 20261220010000 + แทรกโดย 20270109010000 / 20270110010000) + ลบ rf_part_categories ของโหมดทดสอบ
--         private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint) (นิยามล่าสุด = 20261224010000_bom_dept_steps.sql):
--           เป้าแต่ละรายการรับ people ที่ไม่บังคับ (JSON number จำนวนเต็ม 1-50 · ไม่ส่ง / null = 1 · อื่น ๆ = BOM_INVALID_GR) และเก็บเป็น
--           {itemCode, stepCode, perHour, people} · นอกนั้นคงเดิมทุกบรรทัด (ตัวอ่านส่ง targets ตามที่เก็บ จึงไม่ต้องแก้ตัวอ่าน)
--   ไม่แตะ: bom_items.unit_cost · private.bom_records · private.bom_save_items · public.app_bom_audit · private.rf_parse_items · private.rf_save_recipes
--   ไม่เติม people ให้เป้าที่บันทึกไว้ก่อนไฟล์นี้: เป้าที่ไม่มี people = 1 คน (หน้าเว็บใช้ค่าเริ่มต้น 1 · บันทึกครั้งถัดไปเขียน people: 1 ให้เอง)
--
-- ลำดับ deploy: apply migration นี้ก่อน merge หน้าเว็บ (หน้าเว็บใหม่ส่ง people ในเป้า และเรียก RPC หมวดของซื้อ)
--   หน้าเว็บรุ่นก่อนใช้กับฐานข้อมูลนี้ได้: เป้าที่ไม่ส่ง people ถูกเก็บเป็น 1 คน (ช่องใหม่ถูกเมิน) · หน้าเว็บรุ่นก่อนไม่เรียก RPC ใหม่
--   หน้าเว็บใหม่ + ฐานข้อมูลเก่า: เป้าที่มี people ถูกบันทึกโดยทิ้ง people (ฐานเก่าไม่อ่านช่องนี้) และ RPC หมวดของซื้อไม่มี จึงห้าม merge ก่อน apply
--   migration รุ่นหลังที่ replace private.sandbox_unguarded_tables() / public.app_sandbox_purge_rf() ต้องคง rf_material_prices rf_labour_rates
--   rf_station_standards rf_part_categories ไว้ · ที่ replace private.bom_gr_save_config ต้องคงการตรวจและเก็บ people ของเป้าไว้
--   (ไฟล์นี้แก้ในนิยามที่ใช้อยู่ จึงไม่มีนิยามเต็มของสามตัวนั้นในไฟล์นี้ให้คัดลอก · ถ้าข้อความที่ต้องแทนไม่อยู่ในนิยามที่ใช้อยู่ migration หยุดพร้อมข้อความ)
--   ก่อน apply ที่ production: เทียบ md5(pg_get_functiondef(...)) ของ private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint)
--   กับ stack ที่ apply ถึง 20270110010000_cost_rb_labour.sql (ต้องยังเป็นนิยามของ 20261224010000)
--
-- Rollback (ยังเป็นข้อมูลทดสอบทั้งหมด): drop function public.app_rf_part_category_save(text, text), public.app_rf_part_categories(),
--   private.rf_part_category_out(public.employees) · เอา 'rf_part_categories' ออกจาก private.sandbox_unguarded_tables() และ public.app_sandbox_purge_rf()
--   (แทนข้อความกลับในนิยามที่ใช้อยู่) · create or replace private.bom_gr_save_config กลับเป็นนิยามของ 20261224010000
--   (เป้าที่บันทึก people แล้วยังอ่านได้ ช่อง people ถูกทิ้งเมื่อบันทึกครั้งถัดไป) · drop table public.rf_part_categories
-- ============================================================================

-- 0. ตรวจฐานที่ migration นี้ต่อยอด ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.rf_labour_rates') is null or to_regprocedure('private.rf_labour_out(public.employees)') is null then
    raise exception 'ไม่พบค่าแรงของเฟส 2 กรุณา apply 20270110010000_cost_rb_labour.sql ก่อน';
  end if;
  if to_regprocedure('private.rf_price_reader(public.employees)') is null or to_regprocedure('private.rf_price_writer(public.employees)') is null then
    raise exception 'ไม่พบสิทธิ์ราคาของเฟส 1 กรุณา apply 20270109010000_cost_rb_formula_prices.sql ก่อน';
  end if;
  if not (array['rf_material_prices', 'rf_labour_rates', 'rf_station_standards'] <@ private.sandbox_unguarded_tables()) then
    raise exception 'private.sandbox_unguarded_tables() ไม่มีตารางของเฟส 1 / 2 (ฐานไม่ใช่ฉบับที่คาดไว้)';
  end if;
  if to_regprocedure('private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)') is null then
    raise exception 'ไม่พบ private.bom_gr_save_config กรุณา apply 20261224010000_bom_dept_steps.sql ก่อน';
  end if;
end $$;

-- 1. ตาราง (แยกโหมดด้วย is_test · เพิ่มอย่างเดียว) -------------------------------------------------------------------------------
create table public.rf_part_categories (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- รหัสของซื้อของ BOM (bom_items.code ชนิด PURCHASED ของโหมดเดียวกัน) ตรวจใน app_rf_part_category_save · ไม่ผูก FK (ไม่มี unique (code, is_test) ให้อ้าง)
  item_code text not null check (char_length(item_code) between 1 and 60),
  -- หมวด 0-40 ตัวอักษร ตัดช่องว่างหัวท้ายแล้ว ไม่มีอักขระควบคุม · ว่าง = ล้างหมวดของรหัสนี้
  category text not null default '' check (char_length(category) <= 40 and category = btrim(category) and category !~ '[[:cntrl:]]'),
  created_by uuid references public.employees(id) on delete set null,
  -- clock_timestamp (ไม่ใช่ now) เพื่อให้สองแถวในธุรกรรมเดียวกันมีลำดับก่อนหลังจริง (แถวล่าสุดชนะ)
  created_at timestamptz not null default clock_timestamp(),
  unique (id, is_test)
);
create index rf_part_categories_lookup_idx on public.rf_part_categories (is_test, item_code, created_at desc);
comment on table public.rf_part_categories is 'หมวดของของซื้อของ BOM (ตั้งในคลัง ST) · เพิ่มอย่างเดียว (แก้หมวด = แถวใหม่ · หมวดว่าง = ล้าง) · หมวดของรหัส = แถวล่าสุดของโหมด · อ่าน/เขียนผ่าน app_rf_part_categories / app_rf_part_category_save เท่านั้น';

create trigger rf_part_categories_sandbox_scope before insert or update or delete on public.rf_part_categories
  for each row execute function private.sandbox_row_scope();
revoke all on public.rf_part_categories from anon, authenticated;
alter table public.rf_part_categories enable row level security;
create policy rf_part_categories_no_direct_access on public.rf_part_categories for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.rf_part_categories');

-- 2. ตารางใหม่รู้จักโหมดทดสอบ + ล้างข้อมูลทดสอบ: แทรกชื่อในนิยามที่ใช้อยู่ ------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  if not ('rf_part_categories' = any (private.sandbox_unguarded_tables())) then
    v_def := pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure);
    v_new := replace(v_def, '''rf_station_standards'',', '''rf_station_standards'',''rf_part_categories'',');
    if v_new = v_def then
      raise exception 'แทรก rf_part_categories ใน private.sandbox_unguarded_tables() ไม่ได้ (ไม่พบ ''rf_station_standards'', ในนิยาม)';
    end if;
    execute v_new;
  end if;
  if not (array['rf_part_categories', 'rf_labour_rates', 'rf_station_standards', 'rf_material_prices', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables()) then
    raise exception 'private.sandbox_unguarded_tables() หลังแก้ไม่ครบ';
  end if;

  v_def := pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure);
  if position('rf_part_categories' in v_def) = 0 then
    v_new := replace(v_def, 'array[''rf_labour_rates'',', 'array[''rf_part_categories'', ''rf_labour_rates'',');
    if v_new = v_def then
      raise exception 'แทรก rf_part_categories ใน public.app_sandbox_purge_rf() ไม่ได้ (ไม่พบรายชื่อตารางที่ขึ้นต้นด้วย rf_labour_rates)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_sandbox_purge_rf() to authenticated;

-- 3. จำนวนคนของเป้าต่อชั่วโมง (saveGrConfig ของ GR / PT / BG / PK): แก้ในนิยามที่ใช้อยู่ ---------------------------------------------
--   people ไม่บังคับ: ไม่ส่ง / null = 1 · ต้องเป็น JSON number จำนวนเต็ม 1-50 ไม่งั้น BOM_INVALID_GR (ลำดับตรวจเดิม: รูปแถวก่อนสิทธิ์)
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('private.bom_gr_save_config(public.employees,boolean,jsonb,bigint,bigint)'::regprocedure);
  if position('v_people' in v_def) = 0 then
    v_new := replace(v_def, 'v_per numeric;', 'v_per numeric;
  v_people numeric;');
    if v_new = v_def then
      raise exception 'แก้ private.bom_gr_save_config ไม่ได้ (ไม่พบ v_per numeric; ในนิยาม)';
    end if;
    v_def := v_new;
    v_new := replace(v_def,
      'v_targets := v_targets || jsonb_build_array(jsonb_build_object(''itemCode'', v_item, ''stepCode'', v_code, ''perHour'', trim_scale(v_per)));',
      'v_people := coalesce(private.bom_num(v_el -> ''people'', ''BOM_INVALID_GR'', 1, 50), 1);
    if v_people <> trunc(v_people) then raise exception ''BOM_INVALID_GR''; end if;
    v_targets := v_targets || jsonb_build_array(jsonb_build_object(''itemCode'', v_item, ''stepCode'', v_code, ''perHour'', trim_scale(v_per), ''people'', v_people::integer));');
    if v_new = v_def then
      raise exception 'แก้ private.bom_gr_save_config ไม่ได้ (ไม่พบบรรทัดที่เก็บเป้า itemCode / stepCode / perHour ในนิยาม)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function private.bom_gr_save_config(public.employees, boolean, jsonb, bigint, bigint) from public, anon, authenticated;

-- 4. หมวดของของซื้อ ---------------------------------------------------------------------------------------------------------------
-- คำตอบของ RPC ทั้งสอง: { categories: [{itemCode, category}] (หมวดล่าสุดที่ไม่ว่างของแต่ละรหัสในโหมดผู้เรียก เรียงตามรหัส), canWrite }
--   ผู้เรียกต้องตรวจ private.rf_price_reader ก่อน
create or replace function private.rf_part_category_out(p_actor public.employees)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object('itemCode', x.item_code, 'category', x.category) order by x.item_code collate "C")
      from (select distinct on (c.item_code) c.item_code, c.category
            from public.rf_part_categories c
            where c.is_test = (select private.bom_test_mode())
            order by c.item_code, c.created_at desc, c.id desc) x
      where x.category <> ''), '[]'::jsonb),
    'canWrite', private.rf_price_writer(p_actor))
$$;
revoke all on function private.rf_part_category_out(public.employees) from public, anon, authenticated;

-- อ่าน: ผู้เห็นต้นทุน หรือแผนก ST (ผู้อ่านราคา)
create or replace function public.app_rf_part_categories()
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
  return private.rf_part_category_out(v_actor);
end;
$$;
revoke all on function public.app_rf_part_categories() from public, anon;
grant execute on function public.app_rf_part_categories() to authenticated;

-- ตั้งหมวดของของซื้อหนึ่งรหัส (เพิ่มแถวใหม่ · หมวดว่าง = ล้าง) · แผนก ST หรือ admin (ผู้แก้ราคา) · คืนรูปเดียวกับ app_rf_part_categories
create or replace function public.app_rf_part_category_save(p_item_code text, p_category text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := btrim(coalesce(p_item_code, ''));
  v_cat text := btrim(coalesce(p_category, ''));
  v_test boolean;
  v_last public.rf_part_categories%rowtype;
  v_found boolean;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_price_writer(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  v_test := private.bom_test_mode();
  if v_code = '' or char_length(v_code) > 60
     or not exists (select 1 from public.bom_items i where i.is_test = v_test and i.code = v_code and i.kind = 'PURCHASED')
     or char_length(v_cat) > 40 or v_cat ~ '[[:cntrl:]]' then
    raise exception 'RF_INVALID_CATEGORY';
  end if;
  -- กันกดซ้ำ: หมวดล่าสุดของรหัสนี้เหมือนเดิมแล้ว (หรือล้างรหัสที่ไม่เคยมีหมวด) ไม่เพิ่มแถว
  select * into v_last from public.rf_part_categories c
  where c.is_test = v_test and c.item_code = v_code
  order by c.created_at desc, c.id desc limit 1;
  v_found := found;
  if (v_found and v_last.category <> v_cat) or (not v_found and v_cat <> '') then
    insert into public.rf_part_categories (is_test, item_code, category, created_by)
    values (v_test, v_code, v_cat, v_actor.id);
  end if;
  return private.rf_part_category_out(v_actor);
end;
$$;
revoke all on function public.app_rf_part_category_save(text, text) from public, anon;
grant execute on function public.app_rf_part_category_save(text, text) to authenticated;
