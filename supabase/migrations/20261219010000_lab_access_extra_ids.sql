-- ============================================================================
-- เปิด MNP LAB ให้พนักงานทั่วไปบางคนตาม ID แบบดูอย่างเดียว
-- (เจ้าของสั่ง 2026-11-23: "ปรับ ID : GODGAZ ให้เห็นโมดูล MNP LAB" แล้วเลือก "ดูอย่างเดียว ไม่อัปโหลด")
--
-- ก่อนหน้านี้ private.can_access_lab() = admin หรือบัญชี lab-only (MNPLAB001/002) เท่านั้น
-- GODGAZ เป็นพนักงาน QA บทบาท staff จึงไม่เห็นโมดูล การใส่ GODGAZ ในรายชื่อ lab-only ใช้ไม่ได้
-- เพราะบัญชี lab-only ถูกปิดทุกโมดูลอื่น (GODGAZ ต้องใช้งานโมดูลอื่นตามปกติต่อไป)
--
-- แนวคิด
--   - รายชื่อ ID ที่เข้า LAB ได้เพิ่ม (โดยไม่จำกัดโมดูลอื่น) อยู่ที่เดียว private.lab_access_employee_nos()
--     employees.employee_no เก็บเป็นตัวพิมพ์ใหญ่ เทียบแบบ upper() เหมือน lab_only_employee_nos()
--   - นับเฉพาะพนักงานที่ยังใช้งานอยู่ (is_active)
--   - private.can_access_lab() = admin หรือ lab-only หรือ ID ในรายชื่อนี้ — ทุก RPC ของ LAB (app_lab_access,
--     app_lab_mooney_feed, app_lab_mdr_feed, app_lab_mdr_upload, app_lab_mdr_curves ฯลฯ) ตรวจที่ฟังก์ชันนี้จุดเดียว
--     หน้าเว็บอ่านผ่าน app_lab_access
--   - ดูอย่างเดียว: private.can_write_lab() = admin หรือ lab-only (นิยามเดิมของ can_access_lab ก่อน migration นี้)
--     RPC ที่เขียนข้อมูลของ LAB ตรวจเพิ่มที่นี่: app_lab_mdr_upload (นิยามจาก 20261215010000 + หนึ่งบรรทัด) และ
--     app_lab_strand_spec_save ถ้ามีในฐานข้อมูล (มีบน production จาก branch ที่ยังไม่ merge — เติมบรรทัดเดียวกันต่อจาก
--     ด่าน can_access_lab ของนิยามปัจจุบัน ถ้าหาด่านนั้นไม่เจอ migration ล้มทั้งก้อน)
--     หน้าเว็บถาม app_lab_can_write เพื่อซ่อนปุ่มอัปโหลด (UX เท่านั้น)
--   - ข้อควรระวังเดียวกับรายชื่อ lab-only: การเปลี่ยน ID ของพนักงาน (คำร้องแก้ ID ที่ admin อนุมัติ) จะทำให้สิทธิ์นี้ย้ายตาม ID
--
-- เพิ่ม/ลด ID: create or replace private.lab_access_employee_nos() ใน migration ใหม่
--
-- Rollback (ไม่มีข้อมูลถูกแก้): นำ private.can_access_lab() กลับเป็นนิยามของ 20261019005000_lab_only_accounts.sql;
--   นำ app_lab_mdr_upload กลับเป็นนิยามของ 20261215010000_lab_mdr_tests.sql; ลบบรรทัด
--   "if not private.can_write_lab() then raise exception 'NOT_AUTHORIZED'; end if;" ออกจาก app_lab_strand_spec_save และ app_lab_strand_spec_delete (ถ้ามี);
--   drop function public.app_lab_can_write(), private.can_write_lab(), private.is_lab_access_employee(uuid),
--   private.lab_access_employee_nos()
-- ============================================================================

create or replace function private.lab_access_employee_nos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['GODGAZ']
$$;
revoke all on function private.lab_access_employee_nos() from public, anon, authenticated;

create or replace function private.is_lab_access_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.id = p_employee_id
      and e.is_active
      and upper(e.employee_no) = any (private.lab_access_employee_nos())
  )
$$;
revoke all on function private.is_lab_access_employee(uuid) from public, anon, authenticated;

-- จุดตัดสินเดียวของโมดูล: เริ่มจากนิยามล่าสุดของ 20261019005000_lab_only_accounts.sql แล้วเพิ่มเงื่อนไขที่สาม
create or replace function private.can_access_lab()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_only_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_access_employee(private.current_employee_id()), false)
$$;
revoke all on function private.can_access_lab() from public, anon, authenticated;

-- สิทธิ์เขียนใน LAB (อัปโหลด/บันทึก): admin หรือบัญชี lab-only ที่ยังใช้งานอยู่ — ID ในรายชื่อด้านบนดูได้อย่างเดียว
create or replace function private.can_write_lab()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_only_employee(private.current_employee_id()), false)
$$;
revoke all on function private.can_write_lab() from public, anon, authenticated;

-- หน้าเว็บใช้ซ่อนปุ่มอัปโหลด (ไม่ใช่ตัวบังคับ — ตัวบังคับคือ RPC ที่เขียนข้อมูล)
create or replace function public.app_lab_can_write()
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
  return private.can_access_lab() and private.can_write_lab();
end;
$$;
revoke all on function public.app_lab_can_write() from public, anon;
grant execute on function public.app_lab_can_write() to authenticated;


-- app_lab_mdr_upload: นิยามของ 20261215010000_lab_mdr_tests.sql (ตรงกับ production) + ด่านสิทธิ์เขียนหนึ่งบรรทัด
create or replace function public.app_lab_mdr_upload(p_tests jsonb)
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
  -- ดูอย่างเดียว (ID ใน private.lab_access_employee_nos) อัปโหลดไม่ได้
  if not private.can_write_lab() then raise exception 'NOT_AUTHORIZED'; end if;
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

-- ฟังก์ชันบันทึก/ลบสเปกยางเส้น (app_lab_strand_spec_save, app_lab_strand_spec_delete): ไม่มีใน migrations ของ main
-- (save มีบน production จาก branch ที่ยังไม่ merge · delete ไม่มีบน production ณ 2026-11-23 แต่อยู่ใน branch เดียวกัน)
-- เติมด่านสิทธิ์เขียนต่อจากด่าน can_access_lab ของนิยามปัจจุบัน: ไม่มีฟังก์ชัน = ข้าม · มีด่านแล้ว = ข้าม (รันซ้ำได้)
-- หาด่าน can_access_lab ไม่เจอหรือเจอมากกว่าหนึ่ง = ล้มทั้ง migration
-- ถ้าภายหลัง apply migration ของ branch นั้นทับ (create or replace) ด่านนี้จะหาย ต้องใส่ can_write_lab ใน branch นั้นก่อน merge
do $$
declare
  v_name text;
  v_fn regprocedure;
  v_def text;
  v_pattern constant text := 'if not private\.can_access_lab\(\) then\s+raise exception ''NOT_AUTHORIZED'';\s+end if;';
begin
  foreach v_name in array array[
    'public.app_lab_strand_spec_save(text,text,text,numeric,numeric,numeric,numeric,numeric,numeric,integer)',
    'public.app_lab_strand_spec_delete(text,text,integer)'
  ] loop
    v_fn := to_regprocedure(v_name);
    continue when v_fn is null;
    v_def := pg_get_functiondef(v_fn);
    continue when v_def ~ 'private\.can_write_lab\(\)';
    if (select count(*) from regexp_matches(v_def, v_pattern, 'g')) <> 1 then
      raise exception '%: expected exactly one can_access_lab check, definition changed — update this migration', v_name;
    end if;
    execute regexp_replace(v_def, '(' || v_pattern || ')',
      E'\\1\n  if not private.can_write_lab() then raise exception ''NOT_AUTHORIZED''; end if;');
    if pg_get_functiondef(v_fn) !~ 'private\.can_write_lab\(\)' then
      raise exception '%: write check was not added', v_name;
    end if;
  end loop;
end;
$$;
