-- MNP LAB: ข้อมูลเพิ่มเติมของยางเส้น (ออเดอร์ที่ใช้ ขนาดวงนอก/รูใน และสเปกที่กำหนด) ต่อ ID ของผลทดสอบ Mooney
--
-- ที่มา: ห้อง LAB ขอให้บันทึกได้ว่ายางเส้นของแต่ละ ID ใช้กับออเดอร์ไหน ได้ขนาดเท่าไหร่ (วงนอก รูใน) และสเปกที่กำหนดไว้
--
-- ขอบเขต
--   - หนึ่งแถว = หนึ่ง (วัสดุ, ID) ตามคอลัมน์ Material/ID ของชีต Mooney_Test_Report: ทุกครั้งที่ทดสอบของ ID เดียวกันใช้ข้อมูลชุดเดียวกัน
--   - ข้อมูลที่บันทึก: เลขที่ออเดอร์ (ข้อความอิสระ), ขนาดที่วัดได้ของวงนอกและรูใน (มม.), สเปกต่ำสุด/สูงสุดของวงนอกและรูใน (มม.)
--     ทุกช่องไม่บังคับ แต่ต้องมีอย่างน้อยหนึ่งช่อง สเปกใช้ช่วงต่ำสุด–สูงสุด (ใส่ด้านเดียวได้ เช่น "ห้ามลบ") ทุกรูปแบบที่โรงงานเขียนแปลงเป็นช่วงได้
--   - ตารางนี้แยกจาก lab_mooney_results โดยตั้งใจ: ตารางผลทดสอบเป็นกระจกสะท้อนชีต (ซิงก์แล้วลบแถวที่หายไปจากชีต) ข้อมูลที่คนกรอกในเว็บจึงต้องไม่อยู่ในตารางนั้น
--     และไม่ผูก foreign key กับมัน แถวนี้จึงไม่ถูกลบเมื่อชีตซิงก์ใหม่ ถ้า ID หายไปจากชีตภายหลัง ข้อมูลยังอยู่และแก้/ลบได้
--   - สิทธิ์: อ่าน/เขียน/ลบ ผ่าน RPC ที่ตรวจ session + พนักงานที่ใช้งานอยู่ + private.can_access_lab() (ตอนนี้ = admin) ที่ฐานข้อมูลทุกครั้ง
--     ตารางปิดการเข้าถึงตรงทั้งหมด (RLS deny-all + ถอนสิทธิ์) ภายหลังเมื่อขยายรายชื่อผู้เข้า LAB แก้ที่ can_access_lab ที่เดียว
--   - บันทึกซ้อนกันไม่ได้: แก้ไข/ลบต้องส่ง version ที่เห็นล่าสุด ไม่ตรง = LAB_SPEC_CONFLICT (ล็อกแถวในธุรกรรมเดียวกับการเขียน)
--   - ตรวจสอบย้อนหลัง: ทุกการเพิ่ม/แก้/ลบเขียน audit_logs (ค่าก่อน-หลัง) พร้อมผู้ทำรายการ
--   - โหมดทดสอบ: ผูกด่านกลาง private.sandbox_guard_table (ห้ามเขียนขณะอยู่ในโหมดทดสอบ) เหมือน lab_mooney_results
--
-- เป็น migration แบบเพิ่มของใหม่อย่างเดียว ไม่แก้ฟังก์ชันหรือตารางเดิม (ไม่ replace app_lab_mooney_* ใดๆ)
-- หน้าเว็บทำงานได้ทั้งกับฐานข้อมูลที่ยังไม่มี migration นี้ (ซ่อนส่วนนี้) และที่มีแล้ว ลำดับ deploy จึงไม่ทำให้หน้า LAB เดิมพัง
--
-- Rollback/recovery (ยังไม่เคย apply บน production): drop function public.app_lab_strand_specs(text),
--   public.app_lab_strand_spec_save(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, integer),
--   public.app_lab_strand_spec_delete(text, text, integer); drop table public.lab_strand_specs;
--   ข้อมูลในตารางนี้คนกรอกเอง ไม่มีที่อื่นให้สร้างใหม่ — ก่อน drop บน production ให้สำรองด้วย select * จากตารางนี้
--   (แถว audit_logs ที่ entity_type = 'lab_strand_specs' เก็บค่าก่อน-หลังของทุกการแก้ไขไว้ด้วย)

-- 1. ตาราง ----------------------------------------------------------------------------
create table public.lab_strand_specs (
  id uuid primary key default gen_random_uuid(),
  material text not null check (char_length(material) between 1 and 60 and material = btrim(material)),
  sample_id text not null check (char_length(sample_id) between 1 and 30 and sample_id = btrim(sample_id)),
  order_no text check (order_no is null or (char_length(order_no) between 1 and 60 and order_no = btrim(order_no))),
  -- ขนาดเป็นมิลลิเมตร ทศนิยมไม่เกิน 2 ตำแหน่ง (เท่าที่เครื่องวัดอ่านได้) วงนอก = เส้นผ่านศูนย์กลางนอก, รูใน = เส้นผ่านศูนย์กลางรู
  outer_mm numeric(7, 2) check (outer_mm > 0),
  inner_mm numeric(7, 2) check (inner_mm > 0),
  outer_min_mm numeric(7, 2) check (outer_min_mm > 0),
  outer_max_mm numeric(7, 2) check (outer_max_mm > 0),
  inner_min_mm numeric(7, 2) check (inner_min_mm > 0),
  inner_max_mm numeric(7, 2) check (inner_max_mm > 0),
  version integer not null default 1 check (version >= 1),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (material, sample_id),
  check (outer_min_mm is null or outer_max_mm is null or outer_min_mm <= outer_max_mm),
  check (inner_min_mm is null or inner_max_mm is null or inner_min_mm <= inner_max_mm),
  check (num_nonnulls(order_no, outer_mm, inner_mm, outer_min_mm, outer_max_mm, inner_min_mm, inner_max_mm) > 0)
);
comment on table public.lab_strand_specs is
  'MNP LAB: ออเดอร์ ขนาดวงนอก/รูใน และสเปกของยางเส้นต่อ (วัสดุ, ID) ที่กรอกในเว็บ — แยกจาก lab_mooney_results ที่เป็นกระจกสะท้อนชีต ไม่ผูก FK เพื่อไม่ให้ถูกลบตามชีต';

revoke all on public.lab_strand_specs from public, anon, authenticated;
alter table public.lab_strand_specs enable row level security;

create policy lab_strand_specs_no_direct_access on public.lab_strand_specs
for all to authenticated using (false) with check (false);

select private.sandbox_guard_table('public.lab_strand_specs');

-- 2. อ่าน: ทุกแถวของวัสดุหนึ่งรายการ ------------------------------------------------------
create or replace function public.app_lab_strand_specs(p_material text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_material text := btrim(coalesce(p_material, ''));
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.can_access_lab() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if char_length(v_material) not between 1 and 60 then
    raise exception 'LAB_INVALID_MATERIAL';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'sample_id', s.sample_id, 'order_no', s.order_no,
        'outer_mm', s.outer_mm, 'inner_mm', s.inner_mm,
        'outer_min_mm', s.outer_min_mm, 'outer_max_mm', s.outer_max_mm,
        'inner_min_mm', s.inner_min_mm, 'inner_max_mm', s.inner_max_mm,
        'version', s.version, 'updated_at', s.updated_at
      ) order by s.sample_id
    )
    from public.lab_strand_specs s
    where s.material = v_material
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.app_lab_strand_specs(text) from public, anon;
grant execute on function public.app_lab_strand_specs(text) to authenticated;

-- 3. บันทึก (เพิ่มหรือแก้) -----------------------------------------------------------------
-- p_expected_version null = เพิ่มใหม่ (ต้องยังไม่มีข้อมูลของ ID นี้ และ ID ต้องมีในผลทดสอบของวัสดุนั้น)
-- p_expected_version = ค่า version ที่ผู้ใช้เห็นล่าสุด = แก้ไข (ไม่ตรงหรือแถวถูกลบไปแล้ว = LAB_SPEC_CONFLICT)
-- ค่าที่ส่งมาเป็นข้อมูลทั้งชุดของ ID นั้น: ช่องที่ส่ง null = ล้างค่าช่องนั้น ข้อความว่างถือเป็น null
create or replace function public.app_lab_strand_spec_save(
  p_material text,
  p_sample_id text,
  p_order_no text,
  p_outer_mm numeric,
  p_inner_mm numeric,
  p_outer_min_mm numeric,
  p_outer_max_mm numeric,
  p_inner_min_mm numeric,
  p_inner_max_mm numeric,
  p_expected_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_material text := btrim(coalesce(p_material, ''));
  v_sample text := btrim(coalesce(p_sample_id, ''));
  v_order text := nullif(btrim(coalesce(p_order_no, '')), '');
  v_old public.lab_strand_specs%rowtype;
  v_new public.lab_strand_specs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.can_access_lab() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  v_actor := private.current_employee_id();

  if char_length(v_material) not between 1 and 60 then
    raise exception 'LAB_INVALID_MATERIAL';
  end if;
  if char_length(v_sample) not between 1 and 30 then
    raise exception 'LAB_INVALID_SAMPLE';
  end if;
  if char_length(coalesce(v_order, 'x')) > 60 then
    raise exception 'LAB_INVALID_ORDER';
  end if;
  -- ขนาดต้องเป็นบวก ไม่เกินช่วงของคอลัมน์ และทศนิยมไม่เกิน 2 ตำแหน่ง (ไม่ปัดค่าให้เงียบๆ) NaN/Infinity ไม่ผ่านเงื่อนไขนี้
  if exists (
    select 1
    from unnest(array[p_outer_mm, p_inner_mm, p_outer_min_mm, p_outer_max_mm, p_inner_min_mm, p_inner_max_mm]) as v(size)
    where v.size is not null and not (v.size > 0 and v.size < 100000 and v.size = round(v.size, 2))
  ) then
    raise exception 'LAB_INVALID_SIZE';
  end if;
  if p_outer_min_mm > p_outer_max_mm or p_inner_min_mm > p_inner_max_mm then
    raise exception 'LAB_INVALID_SPEC_RANGE';
  end if;
  if num_nonnulls(v_order, p_outer_mm, p_inner_mm, p_outer_min_mm, p_outer_max_mm, p_inner_min_mm, p_inner_max_mm) = 0 then
    raise exception 'LAB_SPEC_EMPTY';
  end if;

  if p_expected_version is null then
    -- กันผูกข้อมูลกับ ID ที่พิมพ์ผิด: ต้องเป็น ID ที่มีในผลทดสอบของวัสดุนี้จริง (ตรวจเฉพาะตอนเพิ่ม ไม่ตรวจตอนแก้ เพราะชีตอาจลบแถวไปแล้ว)
    if not exists (
      select 1 from public.lab_mooney_results r where r.material = v_material and r.sample_id = v_sample
    ) then
      raise exception 'LAB_SAMPLE_NOT_FOUND';
    end if;
    insert into public.lab_strand_specs (
      material, sample_id, order_no, outer_mm, inner_mm, outer_min_mm, outer_max_mm, inner_min_mm, inner_max_mm,
      created_by, updated_by
    ) values (
      v_material, v_sample, v_order, p_outer_mm, p_inner_mm, p_outer_min_mm, p_outer_max_mm, p_inner_min_mm, p_inner_max_mm,
      v_actor, v_actor
    )
    on conflict (material, sample_id) do nothing
    returning * into v_new;
    -- มีข้อมูลของ ID นี้อยู่แล้ว (มีคนเพิ่มไปก่อน หรือกดบันทึกซ้ำ): ไม่ทับ ให้เปิดดูค่าล่าสุดก่อน
    if not found then
      raise exception 'LAB_SPEC_CONFLICT';
    end if;
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_actor, 'LAB_STRAND_SPEC_CREATE', 'lab_strand_specs', v_new.id::text,
            jsonb_build_object('material', v_material, 'sample_id', v_sample, 'after', to_jsonb(v_new) - 'id' - 'created_by' - 'updated_by'));
  else
    select * into v_old
    from public.lab_strand_specs s
    where s.material = v_material and s.sample_id = v_sample
    for update;
    if not found or v_old.version <> p_expected_version then
      raise exception 'LAB_SPEC_CONFLICT';
    end if;
    -- ไม่มีอะไรเปลี่ยน: คืนค่าเดิม ไม่เพิ่ม version และไม่เขียน audit ซ้ำ
    if (v_old.order_no, v_old.outer_mm, v_old.inner_mm, v_old.outer_min_mm, v_old.outer_max_mm, v_old.inner_min_mm, v_old.inner_max_mm)
       is not distinct from (v_order, p_outer_mm, p_inner_mm, p_outer_min_mm, p_outer_max_mm, p_inner_min_mm, p_inner_max_mm) then
      v_new := v_old;
    else
      update public.lab_strand_specs s set
        order_no = v_order, outer_mm = p_outer_mm, inner_mm = p_inner_mm,
        outer_min_mm = p_outer_min_mm, outer_max_mm = p_outer_max_mm,
        inner_min_mm = p_inner_min_mm, inner_max_mm = p_inner_max_mm,
        version = s.version + 1, updated_by = v_actor, updated_at = now()
      where s.id = v_old.id
      returning * into v_new;
      insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
      values (v_actor, 'LAB_STRAND_SPEC_UPDATE', 'lab_strand_specs', v_new.id::text,
              jsonb_build_object('material', v_material, 'sample_id', v_sample,
                                 'before', to_jsonb(v_old) - 'id' - 'created_by' - 'updated_by',
                                 'after', to_jsonb(v_new) - 'id' - 'created_by' - 'updated_by'));
    end if;
  end if;

  return jsonb_build_object(
    'sample_id', v_new.sample_id, 'order_no', v_new.order_no,
    'outer_mm', v_new.outer_mm, 'inner_mm', v_new.inner_mm,
    'outer_min_mm', v_new.outer_min_mm, 'outer_max_mm', v_new.outer_max_mm,
    'inner_min_mm', v_new.inner_min_mm, 'inner_max_mm', v_new.inner_max_mm,
    'version', v_new.version, 'updated_at', v_new.updated_at
  );
end;
$$;
revoke all on function public.app_lab_strand_spec_save(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, integer) from public, anon;
grant execute on function public.app_lab_strand_spec_save(text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, integer) to authenticated;

-- 4. ลบ ------------------------------------------------------------------------------------
-- ใช้ลบข้อมูลที่ผูกผิด ID หรือกรอกผิดทั้งชุด ต้องส่ง version ล่าสุดเช่นเดียวกับการแก้ไข ค่าก่อนลบเก็บใน audit_logs
create or replace function public.app_lab_strand_spec_delete(p_material text, p_sample_id text, p_expected_version integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_material text := btrim(coalesce(p_material, ''));
  v_sample text := btrim(coalesce(p_sample_id, ''));
  v_old public.lab_strand_specs%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.can_access_lab() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  v_actor := private.current_employee_id();

  if char_length(v_material) not between 1 and 60 then
    raise exception 'LAB_INVALID_MATERIAL';
  end if;
  if char_length(v_sample) not between 1 and 30 then
    raise exception 'LAB_INVALID_SAMPLE';
  end if;
  if p_expected_version is null then
    raise exception 'LAB_SPEC_CONFLICT';
  end if;

  select * into v_old
  from public.lab_strand_specs s
  where s.material = v_material and s.sample_id = v_sample
  for update;
  if not found or v_old.version <> p_expected_version then
    raise exception 'LAB_SPEC_CONFLICT';
  end if;

  delete from public.lab_strand_specs where id = v_old.id;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_actor, 'LAB_STRAND_SPEC_DELETE', 'lab_strand_specs', v_old.id::text,
          jsonb_build_object('material', v_material, 'sample_id', v_sample,
                             'before', to_jsonb(v_old) - 'id' - 'created_by' - 'updated_by'));
  return jsonb_build_object('deleted', true, 'sample_id', v_sample);
end;
$$;
revoke all on function public.app_lab_strand_spec_delete(text, text, integer) from public, anon;
grant execute on function public.app_lab_strand_spec_delete(text, text, integer) to authenticated;
