-- ============================================================================
-- บัญชีที่เห็นเฉพาะ MNP LAB (lab-only): MNPLAB001, MNPLAB002
--
-- เป้าหมาย: สองบัญชีนี้เข้า MNP LAB ได้ และ "ไม่มีทางเห็นหรือใช้โมดูลอื่น" ที่ฐานข้อมูล
-- (เมนูที่ซ่อนในหน้าเว็บเป็นแค่ UX — ตัวบังคับจริงคือฐานข้อมูล)
--
-- แนวคิด
--   1) รายชื่อ ID อยู่ที่เดียว private.lab_only_employee_nos() (employees.employee_no เก็บเป็นตัวพิมพ์ใหญ่)
--      คิดจาก ID ไม่ใช่บทบาท: ต่อให้ admin ตั้งบทบาทให้บัญชีเหล่านี้สูงแค่ไหนก็ยังเห็นเฉพาะ LAB
--   2) private.can_access_lab() = admin หรือบัญชี lab-only ที่ยังใช้งานอยู่ (จุดตัดสินเดิมของโมดูล)
--   3) RPC ฝั่งผู้ใช้ทุกตัวใน public ที่ authenticated เรียกได้ ถูกเติมบรรทัดแรก private.lab_only_block()
--      ซึ่งปฏิเสธด้วย LAB_ONLY_ACCOUNT เมื่อผู้เรียกเป็นบัญชี lab-only ยกเว้นรายการใน
--      private.lab_only_allowed_functions() (RPC ของ LAB และ RPC ข้อมูลส่วนตัวของตนเอง)
--      เติมด้วยการอ่านนิยามปัจจุบันของแต่ละฟังก์ชันตอน apply จึงไม่ทับนิยามที่ migration อื่นเพิ่งแก้
--      และถ้าเติมไม่สำเร็จแม้ตัวเดียว migration จะล้มทั้งก้อน (ไม่ปล่อยช่องโหว่เงียบ ๆ)
--   4) ตารางทุกตารางใน public (ยกเว้น roles/departments ที่เป็นข้อมูลอ้างอิงของแถบข้าง) มี policy แบบ restrictive
--      lab_only_no_access ห้ามอ่าน/เขียนผ่าน Data API ส่วน employees เห็นได้เฉพาะแถวของตนเอง
--      และ Storage ทุก bucket ยกเว้น employee-photos (รูปโปรไฟล์ของตนเอง) ถูกปิดด้วย policy เดียวกัน
--
-- โมดูล/ฟังก์ชัน/ตารางใหม่ในอนาคต: supabase/tests/database/lab_only_accounts.test.sql จะไม่ผ่านใน CI
-- จนกว่าตารางใหม่จะเรียก private.lab_only_guard_table('public.<ตาราง>') และฟังก์ชันใหม่จะมีบรรทัด
-- perform private.lab_only_block(); ต่อจาก begin (ฟังก์ชัน SQL: select private.lab_only_block(); เป็นประโยคแรก)
-- หรืออยู่ในรายการ private.lab_only_allowed_functions() — และ migration ที่ create or replace ฟังก์ชันเดิม
-- ต้องเริ่มจากนิยามล่าสุดที่มีบรรทัดนี้อยู่แล้ว ไม่เช่นนั้นเทสต์เดียวกันจะไม่ผ่าน
--
-- เปลี่ยนรายชื่อ ID: create or replace private.lab_only_employee_nos() ใน migration ใหม่ ข้อควรระวัง:
-- การเปลี่ยน ID ของบัญชีเหล่านี้ (เช่น ผ่านคำร้องแก้ ID ที่ admin อนุมัติ) จะทำให้พ้นข้อจำกัด lab-only
--
-- Rollback (ไม่มีข้อมูลถูกแก้): drop policy lab_only_no_access / lab_only_own_row บนทุกตารางใน public และ
-- lab_only_no_files บน storage.objects; ลบบรรทัด "perform private.lab_only_block();" (หรือ
-- "select private.lab_only_block();" ในฟังก์ชัน SQL) ออกจากทุกฟังก์ชันที่มี โดย create or replace จากนิยามเดิมลบบรรทัดนั้น;
-- นำ private.can_access_lab() กลับเป็นนิยามของ 20261016020000_mnp_lab_mooney.sql; drop function
-- public.app_lab_only(), private.lab_only_*(), private.is_lab_only_*()
-- ============================================================================

-- 1. รายชื่อบัญชีและตัวตรวจ -----------------------------------------------------------
create or replace function private.lab_only_employee_nos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['MNPLAB001', 'MNPLAB002']
$$;
revoke all on function private.lab_only_employee_nos() from public, anon, authenticated;

-- ผู้เรียกเป็นบัญชี lab-only หรือไม่ — ไม่ดู is_active โดยตั้งใจ: บัญชีที่ถูกปิดก็ยังถือเป็น lab-only (fail-closed)
-- ใช้ใน policy ของทุกตารางจึงต้องให้ authenticated เรียกได้ (ไม่เปิดข้อมูลใด ๆ นอกจากค่าจริง/เท็จของตนเอง)
create or replace function private.is_lab_only_caller()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = (select auth.uid())
      and upper(e.employee_no) = any (private.lab_only_employee_nos())
  )
$$;
revoke all on function private.is_lab_only_caller() from public, anon;
grant execute on function private.is_lab_only_caller() to authenticated;

create or replace function private.is_lab_only_employee(p_employee_id uuid)
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
      and upper(e.employee_no) = any (private.lab_only_employee_nos())
  )
$$;
revoke all on function private.is_lab_only_employee(uuid) from public, anon, authenticated;

-- ด่านที่เติมบรรทัดแรกของ RPC ทุกตัว (ผู้เรียกที่ไม่ใช่ lab-only ผ่านโดยไม่มีผลใด ๆ)
create or replace function private.lab_only_block()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_lab_only_caller() then
    raise exception 'LAB_ONLY_ACCOUNT' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.lab_only_block() from public, anon;
grant execute on function private.lab_only_block() to authenticated;

-- 2. สิทธิ์เข้า MNP LAB -------------------------------------------------------------
-- จุดตัดสินเดียวของโมดูล (ทุก RPC อ่านข้อมูลของ LAB เรียกที่นี่): admin ที่ยังใช้งานอยู่ หรือบัญชี lab-only ที่ยังใช้งานอยู่
create or replace function private.can_access_lab()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.is_admin_employee(private.current_employee_id()), false)
      or coalesce(private.is_lab_only_employee(private.current_employee_id()), false)
$$;
revoke all on function private.can_access_lab() from public, anon, authenticated;

-- หน้าเว็บใช้ตัดสินว่าจะแสดงแถบข้างแบบเหลือเฉพาะ MNP LAB หรือไม่ (ไม่ใช่ตัวบังคับ — ตัวบังคับคือด่านด้านล่าง)
create or replace function public.app_lab_only()
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
  return private.is_lab_only_caller();
end;
$$;
revoke all on function public.app_lab_only() from public, anon;
grant execute on function public.app_lab_only() to authenticated;

-- 3. RPC ที่บัญชี lab-only เรียกได้ ----------------------------------------------------
-- MNP LAB, สิทธิ์ของโมดูลที่แถบข้างเรียกทุกครั้งตอนล็อกอิน (app_my_approval_modules คืนเฉพาะของตนเอง)
-- และข้อมูลส่วนตัวของตนเอง (โปรไฟล์ รูป คำร้องเปลี่ยนรหัสผ่านถึง admin) — ฟังก์ชันอื่นถูกปิดทั้งหมด
create or replace function private.lab_only_allowed_functions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'app_lab_access', 'app_lab_only', 'app_lab_mooney_overview', 'app_lab_mooney_results', 'app_lab_mooney_feed',
    'app_my_approval_modules',
    'app_update_own_profile', 'app_update_own_photo', 'app_request_credential_change'
  ]
$$;
revoke all on function private.lab_only_allowed_functions() from public, anon, authenticated;

do $$
declare
  v_fn record;
  v_def text;
  v_new text;
  v_count integer := 0;
begin
  for v_fn in
    select p.oid, p.oid::regprocedure::text as signature, l.lanname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> all (private.lab_only_allowed_functions())
    order by p.proname, p.oid
  loop
    v_def := pg_get_functiondef(v_fn.oid);
    if v_def like '%private.lab_only_block()%' then
      continue;
    end if;

    if v_fn.lanname = 'plpgsql' then
      -- ต่อจาก begin ของบล็อกหลัก (บรรทัดแรกที่มีแต่ begin) — ก่อนคำสั่งแรกของฟังก์ชัน
      v_new := regexp_replace(v_def, E'(\\n[ \\t]*begin[ \\t]*\\n)', E'\\1  perform private.lab_only_block();\n', 'i');
    elsif v_fn.lanname = 'sql' then
      v_new := regexp_replace(v_def, E'(AS \\$function\\$\\n)', E'\\1select private.lab_only_block();\n');
    else
      raise exception 'lab-only guard: unsupported language % for %', v_fn.lanname, v_fn.signature;
    end if;

    if v_new = v_def or v_new not like '%private.lab_only_block()%' then
      raise exception 'lab-only guard: could not add the guard to %', v_fn.signature;
    end if;
    execute v_new;
    v_count := v_count + 1;
  end loop;

  -- ตรวจซ้ำจากนิยามที่อยู่ในฐานข้อมูลจริง: ต้องไม่เหลือฟังก์ชันที่ไม่มีด่าน
  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname <> all (private.lab_only_allowed_functions())
      and pg_get_functiondef(p.oid) not like '%private.lab_only_block()%'
  ) then
    raise exception 'lab-only guard: some callable functions are still unguarded';
  end if;
  raise notice 'lab-only guard added to % functions', v_count;
end $$;

-- 4. ตารางและ Storage -----------------------------------------------------------------
-- ตารางที่บัญชี lab-only ยังอ่านได้: ข้อมูลอ้างอิงที่แถบข้างต้องใช้ตอนโหลดโปรไฟล์ของตนเอง (ชื่อบทบาท/แผนก)
-- employees ไม่อยู่ในรายการนี้แต่มี policy ของตัวเอง (เห็นเฉพาะแถวตนเอง)
create or replace function private.lab_only_open_tables()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['roles', 'departments', 'employees']
$$;
revoke all on function private.lab_only_open_tables() from public, anon, authenticated;

-- ตารางใหม่ใน public ต้องเรียกฟังก์ชันนี้ (หรือถูกเพิ่มในรายการข้างบนพร้อมเหตุผล) ไม่เช่นนั้นเทสต์ไม่ผ่านใน CI
create or replace function private.lab_only_guard_table(p_table regclass)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  execute format('alter table %s enable row level security', p_table);
  execute format('drop policy if exists lab_only_no_access on %s', p_table);
  execute format(
    'create policy lab_only_no_access on %s as restrictive for all to authenticated '
    'using (not (select private.is_lab_only_caller())) '
    'with check (not (select private.is_lab_only_caller()))', p_table);
end;
$$;
revoke all on function private.lab_only_guard_table(regclass) from public, anon, authenticated;

do $$
declare
  v_table regclass;
begin
  for v_table in
    select c.oid::regclass
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relispartition
      and c.relname <> all (private.lab_only_open_tables())
  loop
    perform private.lab_only_guard_table(v_table);
  end loop;
end $$;

create policy lab_only_own_row on public.employees
as restrictive for all to authenticated
using (not (select private.is_lab_only_caller()) or auth_user_id = (select auth.uid()))
with check (not (select private.is_lab_only_caller()) or auth_user_id = (select auth.uid()));

-- ไฟล์แนบของทุกโมดูลอยู่ใน bucket private ของ Storage: ปิดทั้งหมด เหลือเฉพาะรูปโปรไฟล์ (bucket สาธารณะอยู่แล้ว)
create policy lab_only_no_files on storage.objects
as restrictive for all to authenticated
using (bucket_id = 'employee-photos' or not (select private.is_lab_only_caller()))
with check (bucket_id = 'employee-photos' or not (select private.is_lab_only_caller()));
