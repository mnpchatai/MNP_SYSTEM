-- ============================================================================
-- ต้นทุนการผลิต เฟส 2: เวลามาตรฐานของ RB + อัตราค่าแรง (ค่าแรงต่อชุดผสมของสูตรยาง)
-- ผู้ใช้ตัดสิน 2026-11-27
--   1) อัตราค่าแรง บาท/ชั่วโมง ต่อแผนก มีวันที่เริ่มใช้ เก็บประวัติทุกครั้ง
--      อ่านและแก้: ผู้เห็นต้นทุน (general_manager / factory_manager / admin หรือแผนก PP ทุกบทบาท · private.rf_cost_viewer)
--   2) เวลามาตรฐานผูกกับรหัสสินค้า (rf_recipes.product_code) ไม่ใช่รหัสสูตร · หน่วย = นาทีต่อ 1 ชุดผสม (โม่) ทุกขั้น + จำนวนคนของขั้นนั้น
--      สถานีผสมแยก 4 ส่วน (ขั้นเตรียมวัตถุดิบ + ขั้น 1, 2, 3) แล้วตามด้วย ฉีดขึ้นรูป อบ ตกแต่งและบรรจุ = 7 ขั้น
--      อ่าน: ผู้เห็นต้นทุน + แผนก RB ทุกบทบาท · แก้: ผู้เห็นต้นทุน + หัวหน้าแผนก RB (department_manager / assistant_department_manager ของแผนก RB)
--      แผนก RB เห็นเวลา แต่ไม่เห็นอัตราค่าแรงและต้นทุน
--   3) bom_items.unit_cost (ต้นทุนต่อหน่วยของชิ้นงาน BOM) ส่งให้เฉพาะผู้เห็นต้นทุน และแก้ได้เฉพาะผู้เห็นต้นทุน
--      (เดิมส่งให้ทุกคนที่อ่าน BOM · การบันทึกชิ้นงานโดยผู้ที่ไม่เห็นต้นทุนต้องไม่ล้างค่าที่เก็บไว้)
--
-- สิ่งที่แตะ
--   ใหม่: public.rf_labour_rates · public.rf_station_standards (แบบเดียวกับ rf_material_prices: is_test + trigger private.sandbox_row_scope ·
--         revoke anon / authenticated · RLS + policy ปิดทั้งหมด · lab_only_guard_table · อยู่ใน private.sandbox_unguarded_tables() และ public.app_sandbox_purge_rf())
--         แถวเพิ่มอย่างเดียว ไม่มี RPC ใดแก้หรือลบ · ค่าที่ใช้ ณ วันที่ D = แถวที่ effective_from มากสุดที่ไม่เกิน D ซ้ำวันใช้ created_at ล่าสุด
--   ใหม่: private.rf_labour_depts() · private.rf_standard_steps() · private.rf_standard_reader / rf_standard_writer (public.employees) ·
--         private.rf_parse_standard_steps(jsonb) · private.rf_labour_out(public.employees)
--         public.app_rf_labour() · public.app_rf_labour_rate_save(text, numeric, date, text) · public.app_rf_station_standard_save(text, date, jsonb, text)
--   แก้ในที่ (อ่านนิยามที่ใช้อยู่แล้วแทนข้อความ ไม่คัดลอกทั้งฟังก์ชัน จึงไม่ทับงานของ migration อื่น):
--         private.sandbox_unguarded_tables() + 'rf_labour_rates', 'rf_station_standards' · public.app_sandbox_purge_rf() + ลบสองตารางนี้ของโหมดทดสอบ
--         private.bom_records(bigint): unitCost เฉพาะผู้เห็นต้นทุน
--         private.bom_save_items(uuid, jsonb, bigint, bigint): ผู้ที่ไม่เห็นต้นทุน = unit_cost เดิมคงอยู่ (ชิ้นใหม่ = null) ไม่ว่าจะส่งค่าอะไรมา
--         public.app_bom_audit(integer) (นิยามล่าสุด = 20261130010000_bom_rf_go_live.sql): รายการ "ตั้งราคาต้นทุน" ของผู้บันทึก (entries) มีรายละเอียดว่างสำหรับผู้ที่ไม่เห็นต้นทุน
--         (แถวเก่ามีตัวเลขราคา) · security definer / search_path / สิทธิ์ / lab_only_block คงเดิม
--   ไม่แตะ: public.app_rf_cost_data() และฟังก์ชันของเฟส 1 ทั้งหมด (หน้าต้นทุนเรียก app_rf_labour เพิ่มอีกหนึ่งตัว)
--
-- ลำดับ deploy: apply migration นี้ก่อน merge หน้าเว็บ (หน้าเว็บใหม่เรียก app_rf_labour และ RPC บันทึกสองตัว)
--   หน้าเว็บรุ่นก่อนใช้กับฐานข้อมูลนี้ได้ ยกเว้นข้อเดียว: ผู้วางแผนที่ไม่ใช่ผู้เห็นต้นทุนจะไม่เห็นราคาในหน้าต้นทุน BOM และปุ่ม "ราคา" ของหน้าเว็บรุ่นก่อนบันทึกแล้วไม่มีผล
--   (หน้าเว็บรุ่นก่อนยังเขียนตัวเลขราคาลงบันทึกการใช้งาน แต่ app_bom_audit ส่งรายละเอียดนั้นเฉพาะผู้เห็นต้นทุน)
--   migration รุ่นหลังที่ replace private.sandbox_unguarded_tables() / public.app_sandbox_purge_rf() ต้องคง rf_material_prices rf_labour_rates rf_station_standards ไว้
--   migration รุ่นหลังที่ replace private.bom_records / private.bom_save_items ต้องคงเงื่อนไข private.rf_cost_viewer ของ unit_cost ไว้
--   migration รุ่นหลังที่ replace public.app_bom_audit ต้องคงการทำรายละเอียดของรายการ "ตั้งราคาต้นทุน" ให้ว่างสำหรับผู้ที่ไม่เห็นต้นทุน (private.rf_cost_viewer)
--   (ไฟล์นี้แก้ในนิยามที่ใช้อยู่ จึงไม่มีนิยามเต็มของห้าตัวนั้นในไฟล์นี้ให้คัดลอก · ถ้าข้อความที่ต้องแทนไม่อยู่ในนิยามที่ใช้อยู่ migration หยุดพร้อมข้อความ)
--
-- Rollback (ยังเป็นข้อมูลทดสอบทั้งหมด): drop function public.app_rf_station_standard_save(text, date, jsonb, text), public.app_rf_labour_rate_save(text, numeric, date, text),
--   public.app_rf_labour(), private.rf_labour_out(public.employees), private.rf_parse_standard_steps(jsonb), private.rf_standard_writer(public.employees),
--   private.rf_standard_reader(public.employees), private.rf_standard_steps(), private.rf_labour_depts() · เอาสองชื่อตารางออกจาก private.sandbox_unguarded_tables() และ
--   public.app_sandbox_purge_rf() · create or replace private.bom_records / private.bom_save_items กลับเป็นนิยามของ 20261227010000 / 20261130010000 ·
--   create or replace public.app_bom_audit(integer) กลับเป็นนิยามของ 20261130010000 (ข้อมูลในบันทึกไม่ถูกแก้ จึงไม่มีอะไรต้องคืน) ·
--   drop table public.rf_station_standards, public.rf_labour_rates
-- ============================================================================

-- 0. ตรวจฐานที่ migration นี้ต่อยอด ---------------------------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.rf_material_prices') is null or to_regprocedure('private.rf_cost_viewer(public.employees)') is null then
    raise exception 'ไม่พบราคาวัตถุดิบของเฟส 1 กรุณา apply 20270109010000_cost_rb_formula_prices.sql ก่อน';
  end if;
  if not ('rf_material_prices' = any (private.sandbox_unguarded_tables())) then
    raise exception 'private.sandbox_unguarded_tables() ไม่มี rf_material_prices (ฐานไม่ใช่ฉบับที่คาดไว้)';
  end if;
  if to_regprocedure('private.bom_records(bigint)') is null or to_regprocedure('private.bom_save_items(uuid,jsonb,bigint,bigint)') is null
     or to_regprocedure('private.bom_actor()') is null or to_regprocedure('public.app_bom_audit(integer)') is null then
    raise exception 'ไม่พบ private.bom_records / private.bom_save_items / private.bom_actor / public.app_bom_audit';
  end if;
end $$;

-- 1. ตาราง (แยกโหมดด้วย is_test · เพิ่มอย่างเดียว) -------------------------------------------------------------------------------
create table public.rf_labour_rates (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- รหัสแผนกผลิต (private.rf_labour_depts) ตรวจใน app_rf_labour_rate_save
  department_code text not null check (char_length(department_code) between 1 and 20),
  -- บาทต่อชั่วโมงต่อคน ทศนิยมไม่เกิน 2 ตำแหน่ง
  rate_per_hour numeric not null check (rate_per_hour > 0 and rate_per_hour <= 100000 and rate_per_hour = round(rate_per_hour, 2)),
  effective_from date not null check (effective_from >= date '2000-01-01'),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, is_test)
);
create index rf_labour_rates_lookup_idx on public.rf_labour_rates (is_test, department_code, effective_from desc, created_at desc);
comment on table public.rf_labour_rates is 'อัตราค่าแรง บาท/ชั่วโมง/คน ต่อแผนก มีวันที่เริ่มใช้ · เพิ่มอย่างเดียว (แก้อัตรา = แถวใหม่) · อ่าน/เขียนผ่าน app_rf_labour / app_rf_labour_rate_save เท่านั้น (เฉพาะผู้เห็นต้นทุน)';

create table public.rf_station_standards (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- รหัสสินค้าของสูตรยาง (rf_recipes.product_code ของโหมดเดียวกัน) ตรวจใน app_rf_station_standard_save
  product_code text not null check (char_length(product_code) between 1 and 60),
  effective_from date not null check (effective_from >= date '2000-01-01'),
  -- [{step, minutes, workers}] ครบ 7 ขั้นตามลำดับ private.rf_standard_steps() · minutes = นาทีต่อ 1 ชุดผสม · workers = จำนวนคน
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) = 7),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  unique (id, is_test)
);
create index rf_station_standards_lookup_idx on public.rf_station_standards (is_test, product_code, effective_from desc, created_at desc);
comment on table public.rf_station_standards is 'เวลามาตรฐานของ RB ต่อรหัสสินค้า (นาทีต่อชุดผสม + จำนวนคน ของ 7 ขั้น) มีวันที่เริ่มใช้ · เพิ่มอย่างเดียว · อ่าน/เขียนผ่าน app_rf_labour / app_rf_station_standard_save เท่านั้น';

create trigger rf_labour_rates_sandbox_scope before insert or update or delete on public.rf_labour_rates
  for each row execute function private.sandbox_row_scope();
create trigger rf_station_standards_sandbox_scope before insert or update or delete on public.rf_station_standards
  for each row execute function private.sandbox_row_scope();
revoke all on public.rf_labour_rates, public.rf_station_standards from anon, authenticated;
alter table public.rf_labour_rates enable row level security;
alter table public.rf_station_standards enable row level security;
create policy rf_labour_rates_no_direct_access on public.rf_labour_rates for all to authenticated using (false) with check (false);
create policy rf_station_standards_no_direct_access on public.rf_station_standards for all to authenticated using (false) with check (false);

select private.lab_only_guard_table('public.rf_labour_rates');
select private.lab_only_guard_table('public.rf_station_standards');

-- 2. ตารางใหม่รู้จักโหมดทดสอบ + ล้างข้อมูลทดสอบ: แทรกชื่อในนิยามที่ใช้อยู่ ------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  if not ('rf_labour_rates' = any (private.sandbox_unguarded_tables())) then
    v_def := pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure);
    v_new := replace(v_def, '''rf_material_prices'',', '''rf_material_prices'',''rf_labour_rates'',''rf_station_standards'',');
    if v_new = v_def then
      raise exception 'แทรกตารางค่าแรงใน private.sandbox_unguarded_tables() ไม่ได้ (ไม่พบ ''rf_material_prices'', ในนิยาม)';
    end if;
    execute v_new;
  end if;
  if not (array['rf_labour_rates', 'rf_station_standards', 'rf_material_prices', 'rf_chem_docs'] <@ private.sandbox_unguarded_tables()) then
    raise exception 'private.sandbox_unguarded_tables() หลังแก้ไม่ครบ';
  end if;

  v_def := pg_get_functiondef('public.app_sandbox_purge_rf()'::regprocedure);
  if position('rf_labour_rates' in v_def) = 0 then
    v_new := replace(v_def, 'array[''rf_material_prices'',', 'array[''rf_labour_rates'', ''rf_station_standards'', ''rf_material_prices'',');
    if v_new = v_def then
      raise exception 'แทรกตารางค่าแรงใน public.app_sandbox_purge_rf() ไม่ได้ (ไม่พบรายชื่อตารางที่ขึ้นต้นด้วย rf_material_prices)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;
revoke all on function public.app_sandbox_purge_rf() from public, anon;
grant execute on function public.app_sandbox_purge_rf() to authenticated;

-- 3. ต้นทุนต่อหน่วยของชิ้นงาน BOM: เฉพาะผู้เห็นต้นทุน (แก้ในนิยามที่ใช้อยู่) --------------------------------------------------------
do $$
declare
  v_def text;
  v_new text;
begin
  -- อ่าน: unitCost ออกเฉพาะเมื่อผู้เรียก (persona ในโหมดทดสอบ) เป็นผู้เห็นต้นทุน · (select ...) = ประเมินครั้งเดียวต่อคำสั่ง
  v_def := pg_get_functiondef('private.bom_records(bigint)'::regprocedure);
  if position('rf_cost_viewer' in v_def) = 0 then
    v_new := replace(v_def, 'case when i.unit_cost is null then',
      'case when i.unit_cost is null or not (select coalesce(private.rf_cost_viewer(private.bom_actor()), false)) then');
    if v_new = v_def then
      raise exception 'แก้ private.bom_records ไม่ได้ (ไม่พบ case when i.unit_cost is null then ในนิยาม)';
    end if;
    execute v_new;
  end if;

  -- เขียน: ผู้ที่ไม่เห็นต้นทุน = ชิ้นใหม่ไม่มีต้นทุน ชิ้นเดิมคงค่าที่เก็บไว้ (client ของเขาไม่มีค่านี้ จึงส่งมาไม่ครบเสมอ)
  v_def := pg_get_functiondef('private.bom_save_items(uuid,jsonb,bigint,bigint)'::regprocedure);
  if position('rf_cost_viewer' in v_def) = 0 then
    v_new := replace(v_def, 'unit_cost = excluded.unit_cost,',
      'unit_cost = case when (select coalesce(private.rf_cost_viewer(e), false) from public.employees e where e.id = p_actor) then excluded.unit_cost else public.bom_items.unit_cost end,');
    if v_new = v_def then
      raise exception 'แก้ private.bom_save_items ไม่ได้ (ไม่พบ unit_cost = excluded.unit_cost, ในนิยาม)';
    end if;
    v_def := v_new;
    v_new := replace(v_def, 'v_cost := private.bom_num(v_row -> ''unitCost'', ''BOM_INVALID_ITEM'', 0, 1000000000);',
      'v_cost := private.bom_num(v_row -> ''unitCost'', ''BOM_INVALID_ITEM'', 0, 1000000000);
    if not coalesce((select private.rf_cost_viewer(e) from public.employees e where e.id = p_actor), false) then v_cost := null; end if;');
    if v_new = v_def then
      raise exception 'แก้ private.bom_save_items ไม่ได้ (ไม่พบบรรทัดอ่าน unitCost ในนิยาม)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function private.bom_records(bigint) from public, anon, authenticated;
revoke all on function private.bom_save_items(uuid, jsonb, bigint, bigint) from public, anon, authenticated;

-- 3.1 บันทึกการใช้งาน BOM: รายการ "ตั้งราคาต้นทุน" ที่ผู้บันทึกเขียนไว้ (entries) ส่งรายละเอียดเฉพาะผู้เห็นต้นทุน (แก้ในนิยามที่ใช้อยู่) --------------------------
--   หน้าเว็บตั้งแต่ migration นี้ไม่เขียนตัวเลขราคาลงบันทึกแล้ว แต่แถวที่บันทึกไว้ก่อนหน้ามี ("P-BOX = 5.50 บาท/กล่อง") · ผู้ที่ไม่เห็นต้นทุนได้รายละเอียดว่าง
--   (ชื่อรายการ เวลา และผู้บันทึกยังอยู่) · ผู้เห็นต้นทุนเห็นเหมือนเดิม · รายการอื่นและบรรทัดหลัก (จำนวนระเบียนต่อส่วน) ไม่เปลี่ยน
do $$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.app_bom_audit(integer)'::regprocedure);
  if position('rf_cost_viewer' in v_def) = 0 then
    v_new := replace(v_def, 'then a.metadata -> ''entries'' else ''[]''::jsonb end as entries',
      'then (case when (select coalesce(private.rf_cost_viewer(private.bom_actor()), false)) then a.metadata -> ''entries''
                        else (select coalesce(jsonb_agg(case when jsonb_typeof(x.value) = ''object'' and x.value ->> ''action'' = ''ตั้งราคาต้นทุน''
                                                             then x.value || jsonb_build_object(''detail'', '''') else x.value end order by x.ord), ''[]''::jsonb)
                              from jsonb_array_elements(a.metadata -> ''entries'') with ordinality as x(value, ord)) end)
                  else ''[]''::jsonb end as entries');
    if v_new = v_def then
      raise exception 'แก้ public.app_bom_audit ไม่ได้ (ไม่พบ then a.metadata -> ''entries'' else ''[]''::jsonb end as entries ในนิยาม)';
    end if;
    execute v_new;
  end if;
end $$;
revoke all on function public.app_bom_audit(integer) from public, anon;
grant execute on function public.app_bom_audit(integer) to authenticated;

-- 4. ค่าคงที่และสิทธิ์ -------------------------------------------------------------------------------------------------------------
-- แผนกผลิตที่ตั้งอัตราค่าแรงได้ (เฟส 2 ใช้ RB · GR PT BG PK ใช้ในเฟส 3)
create or replace function private.rf_labour_depts()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['RB', 'GR', 'PT', 'BG', 'PK'] $$;
revoke all on function private.rf_labour_depts() from public, anon, authenticated;

-- ขั้นของเวลามาตรฐาน RB ตามลำดับงาน: ผสม 4 ส่วน (เตรียมวัตถุดิบ + ขั้น 1-3) → ฉีดขึ้นรูป → อบ → ตกแต่งและบรรจุ
create or replace function private.rf_standard_steps()
returns text[]
language sql
immutable
set search_path = ''
as $$ select array['prep', 'mix1', 'mix2', 'mix3', 'extrusion', 'curing', 'finishing'] $$;
revoke all on function private.rf_standard_steps() from public, anon, authenticated;

-- อ่านเวลามาตรฐาน: ผู้เห็นต้นทุน หรือแผนก RB ทุกบทบาท
create or replace function private.rf_standard_reader(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
     and (private.rf_cost_viewer(p_employee) or coalesce(private.bom_dept_of(p_employee) = 'RB', false))
$$;
revoke all on function private.rf_standard_reader(public.employees) from public, anon, authenticated;

-- แก้เวลามาตรฐาน: ผู้เห็นต้นทุน หรือหัวหน้าแผนก RB (ผู้จัดการแผนก / ผู้ช่วยผู้จัดการแผนก ของแผนก RB)
--   แคบกว่า private.rf_is_rb_head: assistant_factory_manager ที่ไม่อยู่แผนก PP ไม่ได้สิทธิ์นี้
create or replace function private.rf_standard_writer(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_employee.id is not null
     and (private.rf_cost_viewer(p_employee)
          or (coalesce(private.bom_dept_of(p_employee) = 'RB', false)
              and coalesce(private.employee_role_code(p_employee.id) in ('department_manager', 'assistant_department_manager'), false)))
$$;
revoke all on function private.rf_standard_writer(public.employees) from public, anon, authenticated;

-- ตรวจและจัดรูป steps: array ของ object ครบ 7 ขั้น ขั้นละหนึ่งรายการ ไม่มีขั้นอื่น
--   minutes 0-100000 (นาทีต่อชุดผสม) · workers 0-1000 (จำนวนคน) ทศนิยมไม่เกิน 2 ตำแหน่ง · ต้องมีอย่างน้อยหนึ่งขั้นที่ minutes > 0
create or replace function private.rf_parse_standard_steps(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step text;
  v_el jsonb;
  v_min numeric;
  v_workers numeric;
  v_out jsonb := '[]'::jsonb;
  v_any boolean := false;
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) <> 7 then raise exception 'RF_INVALID_STANDARD'; end if;
  if exists (select 1 from jsonb_array_elements(p_node) e where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'step') is distinct from 'string') then
    raise exception 'RF_INVALID_STANDARD';
  end if;
  foreach v_step in array private.rf_standard_steps() loop
    select e into v_el from jsonb_array_elements(p_node) e where e ->> 'step' = v_step;
    if not found then raise exception 'RF_INVALID_STANDARD'; end if;
    if jsonb_typeof(v_el -> 'minutes') is distinct from 'number' or jsonb_typeof(v_el -> 'workers') is distinct from 'number' then
      raise exception 'RF_INVALID_STANDARD';
    end if;
    v_min := (v_el ->> 'minutes')::numeric;
    v_workers := (v_el ->> 'workers')::numeric;
    if v_min < 0 or v_min > 100000 or v_min <> round(v_min, 2) or v_workers < 0 or v_workers > 1000 or v_workers <> round(v_workers, 2) then
      raise exception 'RF_INVALID_STANDARD';
    end if;
    if v_min > 0 then v_any := true; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('step', v_step, 'minutes', trim_scale(v_min), 'workers', trim_scale(v_workers)));
  end loop;
  if not v_any then raise exception 'RF_INVALID_STANDARD'; end if;
  return v_out;
end;
$$;
revoke all on function private.rf_parse_standard_steps(jsonb) from public, anon, authenticated;

-- คำตอบของ app_rf_labour และ RPC บันทึกทั้งสอง · ผู้เรียกต้องตรวจ rf_standard_reader ก่อน
--   อัตราค่าแรงออกเฉพาะผู้เห็นต้นทุน (แผนก RB ได้ rates = [] เสมอ)
create or replace function private.rf_labour_out(p_actor public.employees)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'canSeeRates', private.rf_cost_viewer(p_actor),
    'canWriteRates', private.rf_cost_viewer(p_actor),
    'canWriteStandards', private.rf_standard_writer(p_actor),
    'rates', case when private.rf_cost_viewer(p_actor) then coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', r.id, 'departmentCode', r.department_code, 'ratePerHour', r.rate_per_hour, 'effectiveFrom', to_char(r.effective_from, 'YYYY-MM-DD'),
          'note', r.note, 'createdAt', private.bom_ms(r.created_at), 'createdBy', coalesce(private.bom_person(r.created_by), ''))
        order by r.department_code collate "C", r.effective_from desc, r.created_at desc, r.id)
      from public.rf_labour_rates r where r.is_test = (select private.bom_test_mode())), '[]'::jsonb) else '[]'::jsonb end,
    'standards', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', s.id, 'productCode', s.product_code, 'effectiveFrom', to_char(s.effective_from, 'YYYY-MM-DD'), 'steps', s.steps,
          'note', s.note, 'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''))
        order by s.product_code collate "C", s.effective_from desc, s.created_at desc, s.id)
      from public.rf_station_standards s where s.is_test = (select private.bom_test_mode())), '[]'::jsonb))
$$;
revoke all on function private.rf_labour_out(public.employees) from public, anon, authenticated;

-- 5. RPC ---------------------------------------------------------------------------------------------------------------------------
-- อ่าน: { canSeeRates, canWriteRates, canWriteStandards, rates: [...], standards: [...] }
create or replace function public.app_rf_labour()
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
  if not private.rf_standard_reader(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  return private.rf_labour_out(v_actor);
end;
$$;
revoke all on function public.app_rf_labour() from public, anon;
grant execute on function public.app_rf_labour() to authenticated;

-- บันทึกอัตราค่าแรงของแผนก (เพิ่มแถวใหม่เสมอ) · เฉพาะผู้เห็นต้นทุน
create or replace function public.app_rf_labour_rate_save(p_department_code text, p_rate_per_hour numeric, p_effective_from date, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_dept text := coalesce(p_department_code, '');
  v_test boolean;
  v_note text := btrim(coalesce(p_note, ''));
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_last public.rf_labour_rates%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_cost_viewer(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  v_test := private.bom_test_mode();
  if not (v_dept = any (private.rf_labour_depts()))
     or p_rate_per_hour is null or p_rate_per_hour = 'NaN'::numeric or p_rate_per_hour <= 0 or p_rate_per_hour > 100000
     or p_rate_per_hour <> round(p_rate_per_hour, 2)
     or p_effective_from is null or p_effective_from < date '2000-01-01' or p_effective_from > v_today + 366
     or char_length(v_note) > 300 then
    raise exception 'RF_INVALID_LABOUR';
  end if;
  -- กันกดซ้ำ: แถวล่าสุดของวันเดียวกันเหมือนกันทุกช่องแล้ว ไม่เพิ่มแถว
  select * into v_last from public.rf_labour_rates r
  where r.is_test = v_test and r.department_code = v_dept and r.effective_from = p_effective_from
  order by r.created_at desc, r.id desc limit 1;
  if not found or v_last.rate_per_hour <> p_rate_per_hour or v_last.note <> v_note then
    insert into public.rf_labour_rates (is_test, department_code, rate_per_hour, effective_from, note, created_by)
    values (v_test, v_dept, p_rate_per_hour, p_effective_from, v_note, v_actor.id);
  end if;
  return private.rf_labour_out(v_actor);
end;
$$;
revoke all on function public.app_rf_labour_rate_save(text, numeric, date, text) from public, anon;
grant execute on function public.app_rf_labour_rate_save(text, numeric, date, text) to authenticated;

-- บันทึกเวลามาตรฐานของรหัสสินค้า (เพิ่มแถวใหม่เสมอ ครบ 7 ขั้นต่อแถว) · ผู้เห็นต้นทุน หรือหัวหน้าแผนก RB
create or replace function public.app_rf_station_standard_save(p_product_code text, p_effective_from date, p_steps jsonb, p_note text default '')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := btrim(coalesce(p_product_code, ''));
  v_test boolean;
  v_note text := btrim(coalesce(p_note, ''));
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_steps jsonb;
  v_last public.rf_station_standards%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.rf_actor();
  if not private.rf_standard_writer(v_actor) then raise exception 'RF_FORBIDDEN'; end if;
  v_test := private.bom_test_mode();
  if v_code = '' or char_length(v_code) > 60
     or not exists (select 1 from public.rf_recipes r where r.is_test = v_test and r.product_code = v_code)
     or p_effective_from is null or p_effective_from < date '2000-01-01' or p_effective_from > v_today + 366
     or char_length(v_note) > 300 then
    raise exception 'RF_INVALID_STANDARD';
  end if;
  v_steps := private.rf_parse_standard_steps(p_steps);
  select * into v_last from public.rf_station_standards s
  where s.is_test = v_test and s.product_code = v_code and s.effective_from = p_effective_from
  order by s.created_at desc, s.id desc limit 1;
  if not found or v_last.steps <> v_steps or v_last.note <> v_note then
    insert into public.rf_station_standards (is_test, product_code, effective_from, steps, note, created_by)
    values (v_test, v_code, p_effective_from, v_steps, v_note, v_actor.id);
  end if;
  return private.rf_labour_out(v_actor);
end;
$$;
revoke all on function public.app_rf_station_standard_save(text, date, jsonb, text) from public, anon;
grant execute on function public.app_rf_station_standard_save(text, date, jsonb, text) to authenticated;
