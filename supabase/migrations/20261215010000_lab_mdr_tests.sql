-- MNP LAB: รายงานทดสอบ MDR (moving die rheometer)
--
-- เครื่อง MDR บันทึกไฟล์ .ini หนึ่งไฟล์ต่อหนึ่งการทดสอบ (หัวไฟล์สรุปผล + แรงบิดทุก 1 วินาที) เจ้าหน้าที่ LAB อัปโหลดไฟล์จากหน้าเว็บ
-- (#/lab?module=mdr) หน้าเว็บอ่านไฟล์ แยกสูตรกับชุดทดสอบจากชื่อ แล้วส่งผลเข้ามาที่ app_lab_mdr_upload
--   ชื่อลงท้าย F1 = ทดสอบการสุกของยาง (มีกราฟแรงบิด) · F2 = ทดสอบการพองตัวของยาง (เครื่องบันทึกเฉพาะหัวไฟล์ ไม่มีกราฟ)
--   ชื่ออื่นหน้าเว็บข้ามและแจ้งผู้ใช้ ฐานข้อมูลก็ไม่รับ
-- F1: ML/MH/ts1/ts2/t50/t90 คำนวณจากกราฟ (หัวไฟล์บางไฟล์ใส่ชื่อ T ผิดตำแหน่ง) ฐานข้อมูลตรวจว่า ML/MH ตรงกับค่าต่ำสุด/สูงสุดของกราฟ
-- และเวลาทุกค่าอยู่ภายในช่วงของกราฟ
--
-- สิทธิ์: อ่านและอัปโหลดผ่าน RPC เท่านั้น ทั้งสองตรวจ private.can_access_lab() (admin หรือบัญชี lab-only ที่ยังใช้งานอยู่)
-- ตารางเปิด RLS ไม่มี policy ให้ใคร และไม่ grant ตารางให้ anon/authenticated
-- การทดสอบซ้ำ (ชื่อ + วันที่ + เวลา + ID เดียวกัน) ไม่ถูกเขียนทับ นับเป็น "มีอยู่แล้ว"
--
-- Rollback: drop function public.app_lab_mdr_feed(text, text, date); drop function public.app_lab_mdr_upload(jsonb);
-- drop table public.lab_mdr_tests; (ข้อมูลที่อัปโหลดหายด้วย อัปโหลดไฟล์ .ini ชุดเดิมใหม่ได้)

create table public.lab_mdr_tests (
  id bigint generated always as identity primary key,
  test_name text not null check (test_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,38}F[12]$'),
  formula text not null check (formula ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,38}$'),
  part text not null check (part in ('F1', 'F2')),
  machine_id text not null check (machine_id ~ '^[A-Za-z0-9]{1,12}$'),
  test_date date not null,
  test_time time not null,
  temperature_c numeric not null check (temperature_c between 0 and 300),
  set_minutes numeric not null check (set_minutes between 0 and 600),
  ml numeric not null check (ml >= 0),
  mh numeric not null check (mh >= ml),
  ts1_s integer check (ts1_s between 0 and 36000),
  ts2_s integer check (ts2_s between 0 and 36000),
  t50_s integer check (t50_s between 0 and 36000),
  t90_s integer check (t90_s between 0 and 36000),
  vc1 numeric check (vc1 between -100000 and 100000),
  vc2 numeric check (vc2 between -100000 and 100000),
  result text check (char_length(result) <= 20),
  curve real[] check (curve is null or cardinality(curve) between 10 and 7201),
  header jsonb not null default '{}'::jsonb check (jsonb_typeof(header) = 'object'),
  uploaded_by uuid references public.employees(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  constraint lab_mdr_tests_formula_part check (test_name = formula || part),
  constraint lab_mdr_tests_curve_f1 check (part <> 'F1' or curve is not null),
  constraint lab_mdr_tests_unique unique (test_name, test_date, test_time, machine_id)
);
create index lab_mdr_tests_formula_idx on public.lab_mdr_tests (part, formula, test_date desc);

alter table public.lab_mdr_tests enable row level security;
revoke all on public.lab_mdr_tests from public, anon, authenticated;
select private.lab_only_guard_table('public.lab_mdr_tests');
-- ผลทดสอบจริงทั้งหมด: admin ที่อยู่ในโหมดทดสอบเขียนไม่ได้ (trigger sandbox_guard แบบเดียวกับ lab_mooney_results)
select private.sandbox_guard_table('public.lab_mdr_tests');

-- p_tests = อาร์เรย์ของผลทดสอบ 1–25 รายการ (หน้าเว็บแบ่งส่งเป็นชุด) แต่ละรายการ:
--   name (ชื่อในไฟล์ ตัดช่องว่างแล้ว), machine_id, test_date (YYYY-MM-DD), test_time (HH:MM), temperature_c, set_minutes,
--   ml, mh, ts1_s, ts2_s, t50_s, t90_s (วินาที หรือ null), vc1, vc2, result, curve (แรงบิดทุก 1 วินาที หรือ null), header (หัวไฟล์ดิบ)
-- สูตรและชุดทดสอบคำนวณที่นี่จากชื่อ ไม่รับจากหน้าเว็บ · รายการใดผิดรูปแบบ = ปฏิเสธทั้งชุด (LAB_MDR_INVALID_TEST + ลำดับใน detail)
create function public.app_lab_mdr_upload(p_tests jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_employee uuid;
  v_item jsonb;
  v_index integer := 0;
  v_name text;
  v_part text;
  v_curve real[];
  v_ml numeric;
  v_mh numeric;
  v_points integer;
  v_inserted integer := 0;
  v_count integer;
  v_row_count integer;
  v_time_key text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.can_access_lab() then raise exception 'NOT_AUTHORIZED'; end if;
  -- โหมดทดสอบเขียนผลจริงไม่ได้ (trigger sandbox_guard ก็กันอยู่) ตรวจก่อนวนรายการ เพราะตัวจับ exception ในวนจะแปลงทุก raise เป็น LAB_MDR_INVALID_TEST
  if (private.sandbox_persona()).id is not null then raise exception 'SANDBOX_MODULE_UNSUPPORTED'; end if;
  v_employee := private.current_employee_id();
  if p_tests is null or jsonb_typeof(p_tests) <> 'array' then raise exception 'LAB_MDR_INVALID_PAYLOAD'; end if;
  v_count := jsonb_array_length(p_tests);
  if v_count not between 1 and 25 then raise exception 'LAB_MDR_INVALID_PAYLOAD'; end if;

  for v_item in select value from jsonb_array_elements(p_tests) loop
    v_index := v_index + 1;
    begin
      if jsonb_typeof(v_item) <> 'object' then raise exception 'bad item'; end if;
      v_name := btrim(v_item->>'name');
      if v_name is null or v_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,38}F[12]$' then raise exception 'bad name'; end if;
      v_part := right(v_name, 2);
      if coalesce(v_item->>'test_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
        or coalesce(v_item->>'test_time', '') !~ '^\d{1,2}:\d{2}$'
        or (v_item->>'test_date')::date not between date '2000-01-01' and current_date + 1 then
        raise exception 'bad date';
      end if;
      if jsonb_typeof(v_item->'header') is distinct from 'object' or char_length((v_item->'header')::text) > 4000
        or (select count(*) from jsonb_object_keys(v_item->'header')) > 40 then
        raise exception 'bad header';
      end if;
      -- ตัวเลขต้องเป็น number ของ JSON (ไม่รับข้อความ) ค่า null ได้เฉพาะเวลา/VC/ผล
      if jsonb_typeof(v_item->'ml') <> 'number' or jsonb_typeof(v_item->'mh') <> 'number'
        or jsonb_typeof(v_item->'temperature_c') <> 'number' or jsonb_typeof(v_item->'set_minutes') <> 'number'
        or exists (select 1 from unnest(array['ts1_s', 'ts2_s', 't50_s', 't90_s', 'vc1', 'vc2']) k
                   where jsonb_typeof(v_item->k) not in ('number', 'null'))
        or jsonb_typeof(v_item->'result') not in ('string', 'null') then
        raise exception 'bad number';
      end if;
      v_ml := (v_item->>'ml')::numeric;
      v_mh := (v_item->>'mh')::numeric;
      if v_ml < 0 or v_mh < v_ml or v_mh > (case when v_part = 'F1' then 1000 else 10000000 end) then
        raise exception 'bad torque';
      end if;

      v_curve := null;
      if jsonb_typeof(v_item->'curve') = 'array' then
        if jsonb_array_length(v_item->'curve') not between 10 and 7201
          or exists (select 1 from jsonb_array_elements(v_item->'curve') e where jsonb_typeof(e) <> 'number')
        then
          raise exception 'bad curve';
        end if;
        select array_agg(e::text::real order by o) into v_curve
        from jsonb_array_elements(v_item->'curve') with ordinality as c(e, o);
        if exists (select 1 from unnest(v_curve) v where v not between -100 and 1000) then raise exception 'bad curve'; end if;
      elsif jsonb_typeof(v_item->'curve') is distinct from 'null' and v_item ? 'curve' then
        raise exception 'bad curve';
      end if;

      if v_part = 'F1' then
        -- การสุก: ต้องมีกราฟ และ ML/MH = ค่าต่ำสุด/สูงสุดของกราฟ เวลาทุกค่าอยู่ภายในกราฟและเรียงลำดับถูก
        if v_curve is null then raise exception 'no curve'; end if;
        v_points := cardinality(v_curve);
        if abs(v_ml - (select min(v) from unnest(v_curve) v)) > 0.0005
          or abs(v_mh - (select max(v) from unnest(v_curve) v)) > 0.0005 then
          raise exception 'torque mismatch';
        end if;
        foreach v_time_key in array array['ts1_s', 'ts2_s', 't50_s', 't90_s'] loop
          if (v_item->>v_time_key)::integer >= v_points then raise exception 'time outside curve'; end if;
        end loop;
        if (v_item->>'ts1_s')::integer > (v_item->>'ts2_s')::integer
          or (v_item->>'t50_s')::integer > (v_item->>'t90_s')::integer then
          raise exception 'time order';
        end if;
      end if;

      insert into public.lab_mdr_tests (
        test_name, formula, part, machine_id, test_date, test_time, temperature_c, set_minutes,
        ml, mh, ts1_s, ts2_s, t50_s, t90_s, vc1, vc2, result, curve, header, uploaded_by
      ) values (
        v_name, left(v_name, -2), v_part, btrim(v_item->>'machine_id'),
        (v_item->>'test_date')::date, (v_item->>'test_time')::time,
        (v_item->>'temperature_c')::numeric, (v_item->>'set_minutes')::numeric,
        v_ml, v_mh,
        (v_item->>'ts1_s')::integer, (v_item->>'ts2_s')::integer, (v_item->>'t50_s')::integer, (v_item->>'t90_s')::integer,
        (v_item->>'vc1')::numeric, (v_item->>'vc2')::numeric, nullif(btrim(v_item->>'result'), ''),
        v_curve, v_item->'header', v_employee
      )
      on conflict on constraint lab_mdr_tests_unique do nothing;
      get diagnostics v_row_count = row_count;
      v_inserted := v_inserted + v_row_count;
    exception
      when raise_exception or check_violation or not_null_violation or invalid_text_representation
        or invalid_datetime_format or datetime_field_overflow or numeric_value_out_of_range
        or string_data_right_truncation or invalid_parameter_value or data_exception then
        -- ข้อความกลาง ๆ ไม่คืนค่าในไฟล์กลับไป บอกเฉพาะลำดับของรายการ
        raise exception 'LAB_MDR_INVALID_TEST' using detail = v_index::text;
    end;
  end loop;

  if v_inserted > 0 then
    insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
    values (v_employee, 'IMPORT', 'lab_mdr_tests', null,
            jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted));
  end if;
  return jsonb_build_object('received', v_count, 'inserted', v_inserted, 'duplicates', v_count - v_inserted);
end;
$$;
revoke all on function public.app_lab_mdr_upload(jsonb) from public, anon;
grant execute on function public.app_lab_mdr_upload(jsonb) to authenticated;

-- ชุดทดสอบเดียวต่อคำขอ (p_part = F1 หรือ F2):
--   formulas = ทุกสูตรของชุดนั้น (จำนวนการทดสอบ จำนวนวัน วันแรก/วันล่าสุด) — ไม่มีค่าผลทดสอบ
--   tests = ผลทุกครั้งของสูตรที่เลือก (ไม่มีกราฟ) · curve_date + curves = กราฟของวันที่เลือก (ไม่ระบุ = วันล่าสุดของสูตร)
-- กราฟส่งเฉพาะวันเดียว เพราะหนึ่งวันมีไม่กี่ครั้ง ส่วนสูตรหนึ่งมีได้หลายสิบครั้ง
create function public.app_lab_mdr_feed(p_part text, p_formula text default null, p_date date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_formula text := nullif(btrim(p_formula), '');
  v_date date;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.can_access_lab() then raise exception 'NOT_AUTHORIZED'; end if;
  if p_part is null or p_part not in ('F1', 'F2') then raise exception 'LAB_MDR_INVALID_PART'; end if;
  if v_formula is not null and char_length(v_formula) > 40 then raise exception 'LAB_MDR_INVALID_FORMULA'; end if;
  if v_formula is not null then
    select coalesce(
      (select t.test_date from public.lab_mdr_tests t
        where t.part = p_part and t.formula = v_formula and t.test_date = p_date limit 1),
      (select max(t.test_date) from public.lab_mdr_tests t where t.part = p_part and t.formula = v_formula)
    ) into v_date;
  end if;
  return jsonb_build_object(
    'formulas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'formula', f.formula, 'tests', f.tests, 'days', f.days,
               'first_date', f.first_date, 'last_date', f.last_date) order by f.formula)
      from (
        select t.formula, count(*)::integer as tests, count(distinct t.test_date)::integer as days,
               min(t.test_date) as first_date, max(t.test_date) as last_date
        from public.lab_mdr_tests t where t.part = p_part group by t.formula
      ) f
    ), '[]'::jsonb),
    'tests', case when v_formula is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', t.id, 'machine_id', t.machine_id, 'test_date', t.test_date,
               'test_time', to_char(t.test_time, 'HH24:MI'), 'temperature_c', t.temperature_c,
               'set_minutes', t.set_minutes, 'ml', t.ml, 'mh', t.mh, 'ts1_s', t.ts1_s, 'ts2_s', t.ts2_s,
               't50_s', t.t50_s, 't90_s', t.t90_s, 'vc1', t.vc1, 'vc2', t.vc2, 'result', t.result)
             order by t.test_date desc, t.test_time, t.machine_id)
      from public.lab_mdr_tests t where t.part = p_part and t.formula = v_formula
    ), '[]'::jsonb) end,
    'curve_date', v_date,
    'curves', case when v_date is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'curve', to_jsonb(t.curve)) order by t.test_time, t.machine_id)
      from public.lab_mdr_tests t
      where t.part = p_part and t.formula = v_formula and t.test_date = v_date and t.curve is not null
    ), '[]'::jsonb) end
  );
end;
$$;
revoke all on function public.app_lab_mdr_feed(text, text, date) from public, anon;
grant execute on function public.app_lab_mdr_feed(text, text, date) to authenticated;
