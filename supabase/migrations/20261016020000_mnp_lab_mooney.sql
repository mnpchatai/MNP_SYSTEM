-- MNP LAB: โมดูลห้องปฏิบัติการ เริ่มที่ผลทดสอบ Mooney (ข้อมูลหลักมาจากสเปรดชีต Mooney_Test_Report)
--
-- ขอบเขต
--   - สิทธิ์เข้าโมดูล: ตอนนี้เฉพาะผู้ดูแลระบบ (บทบาท admin) ตัดสินที่ private.can_access_lab() ที่เดียว
--     ภายหลังเมื่อจะกำหนดว่า ID ไหนเข้าได้บ้าง ให้ create or replace ฟังก์ชันนี้ใน migration ใหม่
--     (เช่น เพิ่มตารางรายชื่อ + เงื่อนไข or exists) โดย RPC และหน้าเว็บไม่ต้องแก้
--   - ตารางผลทดสอบ: ปิดการเข้าถึงตรงทั้งหมด (RLS deny-all + ถอนสิทธิ์) อ่านได้ผ่าน RPC ที่ตรวจสิทธิ์เท่านั้น
--   - นำเข้า: app_lab_mooney_import เรียกได้เฉพาะ service_role (Edge Function lab-sheet-sync ที่ Apps Script ยิงมา
--     พร้อม secret) ทำงานแบบ "กระจกสะท้อนชีต" ในธุรกรรมเดียว: upsert ทุกแถวที่ส่งมา แล้วลบแถวที่หายไปจากชีต
--     มีด่านกันลบเกินครึ่ง (LAB_IMPORT_TOO_DESTRUCTIVE) เว้นแต่ยืนยันด้วย p_force
--   - ค่า AVG/SD ในชีตเป็นเซลล์ merge: Apps Script ขยายค่าไปทุกแถวในกลุ่มก่อนส่ง ระบบเก็บตามชีตไม่คำนวณเอง
--     (แท็บ "E00030S T" ไม่มีค่าเหล่านี้ จึงเป็น null ได้)
--   - โหมดทดสอบ: ตารางใหม่ผูกด่านกลาง private.sandbox_guard_table (ห้ามเขียนขณะอยู่ในโหมดทดสอบ)
--
-- Rollback/recovery (ยังไม่เคย apply บน production): drop function public.app_lab_access(), public.app_lab_mooney_overview(),
--   public.app_lab_mooney_results(text), public.app_lab_mooney_import(jsonb, boolean), private.can_access_lab();
--   drop table public.lab_mooney_results; ข้อมูลในตารางสร้างใหม่ได้จากชีตเสมอ (กด sync ซ้ำ)

-- 1. ตารางผลทดสอบ Mooney -------------------------------------------------------------
create table public.lab_mooney_results (
  id uuid primary key default gen_random_uuid(),
  -- ชื่อแท็บในชีตที่แถวนี้มา (ใช้ระบุแถวซ้ำ/ตรวจย้อนกลับ) ส่วน material คือค่าคอลัมน์ Material ที่ใช้จัดกลุ่มในหน้าเว็บ
  source_sheet text not null check (char_length(source_sheet) between 1 and 100),
  sample_id text not null check (char_length(sample_id) between 1 and 30),
  material text not null check (char_length(material) between 1 and 60),
  test_date date not null,
  test_time time not null,
  temperature_c numeric(5, 1) not null check (temperature_c between 0 and 300),
  test_minutes numeric(5, 1) not null check (test_minutes > 0 and test_minutes <= 999),
  mh numeric(8, 2) not null check (mh >= 0),
  mv numeric(8, 2) not null check (mv >= 0),
  avg_mh numeric(8, 2) check (avg_mh is null or avg_mh >= 0),
  sd_mh numeric(8, 2) check (sd_mh is null or sd_mh >= 0),
  avg_mv numeric(8, 2) check (avg_mv is null or avg_mv >= 0),
  sd_mv numeric(8, 2) check (sd_mv is null or sd_mv >= 0),
  imported_at timestamptz not null default now(),
  unique (source_sheet, sample_id, test_date, test_time)
);

create index lab_mooney_results_material_idx
  on public.lab_mooney_results (material, test_date desc, test_time desc);

revoke all on public.lab_mooney_results from public, anon, authenticated;
alter table public.lab_mooney_results enable row level security;

create policy lab_mooney_results_no_direct_access on public.lab_mooney_results
for all to authenticated using (false) with check (false);

select private.sandbox_guard_table('public.lab_mooney_results');

-- 2. สิทธิ์เข้าโมดูล -----------------------------------------------------------------
-- จุดเดียวที่ตัดสินว่าใครเข้า MNP LAB ได้ (ทุก RPC อ่านข้อมูลเรียกที่นี่) ตอนนี้ = admin ที่ยังใช้งานอยู่
-- ภายหลังเพิ่มรายชื่อ ID ที่ได้รับสิทธิ์ที่ฟังก์ชันนี้ โดยคง admin ไว้เสมอ
create or replace function private.can_access_lab()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_employee(private.current_employee_id()), false)
$$;
revoke all on function private.can_access_lab() from public, anon, authenticated;

-- 3. RPC ฝั่งผู้ใช้ (ตรวจสิทธิ์ทุกครั้ง) --------------------------------------------------
-- หน้าเว็บใช้ตัดสินว่าจะแสดงเมนู MNP LAB หรือไม่ (ไม่ใช่ตัวบังคับสิทธิ์ — ตัวบังคับคือ RPC อ่านข้อมูลด้านล่าง)
create or replace function public.app_lab_access()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  return private.can_access_lab();
end;
$$;
revoke all on function public.app_lab_access() from public, anon;
grant execute on function public.app_lab_access() to authenticated;

-- สรุปรายวัสดุ + เวลาที่ซิงก์ล่าสุด
create or replace function public.app_lab_mooney_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if not private.can_access_lab() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  return jsonb_build_object(
    'synced_at', (select max(imported_at) from public.lab_mooney_results),
    'materials', coalesce((
      select jsonb_agg(m order by m.material)
      from (
        select material,
               count(*)::integer as result_count,
               count(distinct test_date)::integer as test_days,
               min(test_date) as first_tested,
               max(test_date) as last_tested
        from public.lab_mooney_results
        group by material
      ) m
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.app_lab_mooney_overview() from public, anon;
grant execute on function public.app_lab_mooney_overview() to authenticated;

-- ผลทดสอบทุกแถวของวัสดุหนึ่งรายการ (ใหม่สุดก่อน)
create or replace function public.app_lab_mooney_results(p_material text)
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
    select jsonb_agg(to_jsonb(r) order by r.test_date desc, r.test_time desc, r.sample_id)
    from (
      select id, sample_id, test_date, test_time, temperature_c, test_minutes,
             mh, mv, avg_mh, sd_mh, avg_mv, sd_mv
      from public.lab_mooney_results
      where material = v_material
      order by test_date desc, test_time desc, sample_id
      limit 2000
    ) r
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.app_lab_mooney_results(text) from public, anon;
grant execute on function public.app_lab_mooney_results(text) to authenticated;

-- 4. นำเข้าจากชีต (service_role เท่านั้น) ---------------------------------------------
-- p_rows = อาร์เรย์ของ { source_sheet, sample_id, material, test_date 'YYYY-MM-DD', test_time 'HH:MM:SS',
--   temperature_c, test_minutes, mh, mv, avg_mh, sd_mh, avg_mv, sd_mv } ผู้เรียกคือ Edge Function ที่ตรวจ secret แล้ว
-- ไม่มี auth.uid() จึงไม่ผ่านด่านโหมดทดสอบ (ด่านนั้นกันเฉพาะผู้ใช้ที่ล็อกอินอยู่ในโหมดทดสอบ)
create or replace function public.app_lab_mooney_import(p_rows jsonb, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_started timestamptz := clock_timestamp();
  v_count integer;
  v_inserted integer;
  v_updated integer;
  v_stale integer;
  v_deleted integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;
  v_count := jsonb_array_length(p_rows);
  -- แถวว่างไม่ใช่ "ชีตว่าง": กันการอ่านชีตพลาดแล้วล้างตารางทั้งก้อน
  if v_count not between 1 and 20000 then
    raise exception 'LAB_INVALID_PAYLOAD';
  end if;

  -- นำเข้าทีละครั้ง ไม่ให้สองรอบลบแถวของกันและกัน
  perform pg_advisory_xact_lock(hashtext('lab_mooney_import'));

  begin
    with incoming as (
      select btrim(r.source_sheet) as source_sheet,
             btrim(r.sample_id) as sample_id,
             btrim(r.material) as material,
             r.test_date::date as test_date,
             r.test_time::time as test_time,
             r.temperature_c, r.test_minutes, r.mh, r.mv,
             r.avg_mh, r.sd_mh, r.avg_mv, r.sd_mv
      from jsonb_to_recordset(p_rows) as r(
        source_sheet text, sample_id text, material text, test_date text, test_time text,
        temperature_c numeric, test_minutes numeric, mh numeric, mv numeric,
        avg_mh numeric, sd_mh numeric, avg_mv numeric, sd_mv numeric
      )
      -- รูปแบบวันที่/เวลาตายตัว ไม่พึ่งการตั้งค่า DateStyle ของ session
      where r.test_date ~ '^\d{4}-\d{2}-\d{2}$' and r.test_time ~ '^\d{1,2}:\d{2}(:\d{2})?$'
    ), upserted as (
      insert into public.lab_mooney_results (
        source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
        mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, imported_at
      )
      select source_sheet, sample_id, material, test_date, test_time, temperature_c, test_minutes,
             mh, mv, avg_mh, sd_mh, avg_mv, sd_mv, v_started
      from incoming
      on conflict (source_sheet, sample_id, test_date, test_time) do update set
        material = excluded.material,
        temperature_c = excluded.temperature_c,
        test_minutes = excluded.test_minutes,
        mh = excluded.mh,
        mv = excluded.mv,
        avg_mh = excluded.avg_mh,
        sd_mh = excluded.sd_mh,
        avg_mv = excluded.avg_mv,
        sd_mv = excluded.sd_mv,
        imported_at = excluded.imported_at
      returning (xmax = 0) as was_inserted
    )
    select count(*) filter (where was_inserted)::integer,
           count(*) filter (where not was_inserted)::integer
    into v_inserted, v_updated
    from upserted;

    -- แถวที่ถูกกรองทิ้งเพราะรูปแบบวันที่/เวลาผิด = ข้อมูลไม่ถูกต้อง ไม่ใช่ "แถวที่หายไป"
    if v_inserted + v_updated <> v_count then
      raise exception 'LAB_INVALID_ROW';
    end if;
  exception
    when check_violation or not_null_violation or invalid_text_representation
      or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
      or string_data_right_truncation or cardinality_violation then
      -- ข้อความกลางๆ ไม่คืนค่าในแถวที่ผิดกลับไป
      raise exception 'LAB_INVALID_ROW';
  end;

  select count(*)::integer into v_stale
  from public.lab_mooney_results
  where imported_at < v_started;

  -- ด่านกันลบเกินครึ่ง: ชีตที่อ่านมาไม่ครบ (เช่นขาดหลายแท็บ) จะไม่ล้างข้อมูลที่มีอยู่
  if not coalesce(p_force, false) and v_stale >= 10 and v_stale * 2 > v_stale + v_updated then
    raise exception 'LAB_IMPORT_TOO_DESTRUCTIVE';
  end if;

  delete from public.lab_mooney_results where imported_at < v_started;
  get diagnostics v_deleted = row_count;

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (
    null, 'IMPORT', 'lab_mooney_results', null,
    jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated,
                       'deleted', v_deleted, 'forced', coalesce(p_force, false))
  );

  return jsonb_build_object('rows', v_count, 'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted);
end;
$$;
revoke all on function public.app_lab_mooney_import(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.app_lab_mooney_import(jsonb, boolean) to service_role;
