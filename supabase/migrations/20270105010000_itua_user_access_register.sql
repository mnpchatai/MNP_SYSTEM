-- ============================================================================
-- ทะเบียนสิทธิ์ผู้ใช้ (ย้ายชีต Authorization ของ User_Authorization_Record.xlsx เข้าเว็บ) — โมดูลของระบบสำนักงาน › IT SUPPORT
-- ขั้นที่ 1 ตามสเปก Work-Order/docs/it-user-access-spec.md (เจ้าของตอบ "ตามที่แนะนำ" 26/11/2026) · ส่วนฐานข้อมูลของ "ทะเบียน" อย่างเดียว
-- (ยังไม่มีหน้าเว็บ · ไม่นำเข้าข้อมูลใด ๆ · ไม่มีใบขอสิทธิ์ itar_* · ไม่มีช่องลับ/รหัสผ่าน — ช่องลับเพิ่มได้หลัง security-auditor ตรวจตู้เซฟเท่านั้น)
-- สัญญาสำหรับหน้าเว็บ: docs/itua-contract.md
--
-- ตาราง (8):
--   itua_users            ผู้ใช้ 1 แถวต่อ 1 Auth. Name (เช่น somchai.k) · แผนก/ฝ่าย/อินเทอร์เน็ต/สถานะ (ใช้งาน/ลาออก) · ลบไม่ได้ (ใช้สถานะ resigned)
--   itua_emails           อีเมลของผู้ใช้ (ภายใน 1 + อื่น ๆ ไม่จำกัด) · ปิดได้ ลบไม่ได้ · ไม่มีรหัสผ่าน
--   itua_folders          รายการโฟลเดอร์แชร์ (ชื่อจริงมาจากหัวคอลัมน์ชีต Authorization ตอนนำเข้า ขั้นที่ 2) — ไม่ seed ในรอบนี้ · ลบไม่ได้
--   itua_folder_grants    สิทธิ์โฟลเดอร์ R/F ปัจจุบัน 1 แถวต่อคู่ (ผู้ใช้, โฟลเดอร์) · ไม่มีสิทธิ์ = ไม่มีแถว
--   itua_programs         รายการโปรแกรม (seed 8 ตัวต่อโหมด) · ลบไม่ได้
--   itua_program_grants   สิทธิ์โปรแกรมปัจจุบัน (หมายเหตุบังคับเมื่อเป็น "อื่นๆ")
--   itua_log              ประวัติทุกการเปลี่ยนแปลงของทั้งหมดข้างบน (ใคร เมื่อไร ค่าเดิม → ค่าใหม่ เหตุผล) เพิ่มได้อย่างเดียว · เขียนโดย trigger เท่านั้น
--   itua_acknowledgements ประวัติผู้ใช้กดรับทราบสิทธิ์ (snapshot สิทธิ์ ณ ตอนรับทราบ) เพิ่มได้อย่างเดียว · รอบนี้สร้างตารางเปล่า RPC รับทราบอยู่ขั้นที่ 4 (ใบขอสิทธิ์)
--
-- สิทธิ์: ผู้อยู่ใน public.itas_admins (allowlist ของทะเบียนอุปกรณ์ที่เจ้าของให้ใช้ร่วม = IT3462 + persona SBX-IT-ADMIN) เท่านั้นทุก RPC · ไม่อ่าน itwo_staff
--   anon เรียกไม่ได้ · RLS deny-all ทุกตาราง + ไม่มี grant ตรงให้ anon/authenticated/service_role · อ่าน/เขียนผ่าน RPC app_itua_* (SECURITY DEFINER, search_path ว่าง) เท่านั้น
--
-- ประวัติ ISO (itua_log): เขียนโดย trigger หลังเพิ่ม/แก้/ลบแถวในตารางข้างบนทุกทาง (ไม่ใช่โค้ด RPC) · RPC ส่ง "ผู้ทำรายการ" และ "เหตุผล" ผ่านตัวแปร
--   transaction-local itua.actor_id / itua.reason · แก้หรือลบแถวที่มีอยู่แล้วโดยไม่มีผู้ทำรายการ/เหตุผล = error (fail-closed) · แก้โดยค่าไม่เปลี่ยน = ไม่ลง log
--   source_request_id / source_doc_no (อ้างเลขใบขอสิทธิ์ ขั้นที่ 4) เตรียมคอลัมน์ไว้แต่ trigger ไม่อ่านค่าจากผู้เรียกเลย → ใส่ null เสมอในรอบนี้ (ปลอมไม่ได้)
--   ตัดสินใจเอง: แถวสิทธิ์โฟลเดอร์/โปรแกรม (current-state) ลบแถวได้เมื่อ "ถอดสิทธิ์" — ผ่าน app_itua_set_grants เท่านั้น และ log เก็บค่าเดิมครบ (action = deleted)
--   ส่วนแถวผู้ใช้/อีเมล/โฟลเดอร์/โปรแกรม RPC ไม่มีทางลบเลย (trigger กันลบทุกทางยกเว้นล้างข้อมูลทดสอบ)
--
-- โหมดทดสอบ (Admin Sandbox): ทุกตารางมี is_test + trigger private.sandbox_row_scope (แบบเดียวกับ itas) · persona แตะของจริงไม่ได้
--   โปรแกรมตั้งต้น 8 ตัว seed ให้ทั้งโหมดจริงและโหมดทดสอบ · app_sandbox_purge_itua ล้างแถวทดสอบทั้งหมดแล้ว seed โปรแกรมทดสอบกลับ
--   ตัดสินใจเอง (ต้องรายงาน):
--     - employee_id ผูกพนักงานได้คนละ 1 แถวต่อโหมด (unique บางส่วน) กันทะเบียนซ้ำคน
--     - อีเมลภายในที่ใช้งานอยู่ได้ 1 ต่อผู้ใช้ · ที่อยู่อีเมลที่ใช้งานอยู่ไม่ซ้ำข้ามผู้ใช้ (ปิดแล้วใช้ซ้ำได้)
--     - แก้ข้อมูลที่มีอยู่แล้วทุกอย่างต้องมีเหตุผล (ผู้ใช้ อีเมลที่ปิด โฟลเดอร์/โปรแกรม สิทธิ์ สถานะ) · สร้างใหม่ไม่ต้อง
--     - ผู้ใช้ที่ลาออกแล้ว เพิ่ม/เปลี่ยนสิทธิ์และเพิ่มอีเมลไม่ได้ (ถอดสิทธิ์ได้) · เปลี่ยนสถานะเป็นลาออกไม่ถอดสิทธิ์ให้เอง (RPC บอกจำนวนสิทธิ์ที่ยังเหลือเพื่อให้หน้าเว็บเตือน)
--     - โฟลเดอร์/โปรแกรมที่ปิดใช้งาน: เพิ่ม/เปลี่ยนสิทธิ์ใหม่ไม่ได้ ถอดได้
--
-- สิ่งที่แตะนอกจากของใหม่ itua_*
--   1) replace private.sandbox_unguarded_tables() — เริ่มจากนิยามล่าสุดบน main (20261226010000_bom_sales_orders.sql ทุกชื่อ รวม bom_order_requests และ itwo/itrp/itas)
--      แล้วต่อ 8 ตารางใหม่ในส่วน to_regclass · md5 ฐาน (prod 26/11/2026 หลัง migration ล่าสุด 20261227010000):
--        md5(pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure)) = 1e1a3f14e4533fc1c62a1484add64cf1 (89 ชื่อ)
--      ก่อน apply ต้องเทียบ md5 บน prod ตรงค่านี้ · ไม่ตรง = เพื่อนมี migration ใหม่ที่ replace ไว้ ให้หยุดแล้วใช้ฉบับล่าสุดเป็นฐาน
--      (migration นี้ตรวจเองว่าชื่อเดิมครบทุกชื่อหลัง replace ถ้าขาดจะ raise)
--   ไม่แตะ: ตาราง/ฟังก์ชัน/trigger ของ itwo, itrp, itas · ฟังก์ชันกลางอื่นของเพื่อน · storage
--
-- ลำดับ deploy: ตารางและ RPC ใหม่ล้วน ยังไม่มีหน้าเว็บเรียก · apply ก่อน merge หน้าเว็บ (ขั้นที่ 3)
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod (ต้องไม่มีอะไรใหม่กว่า 20261230010000 ที่ replace sandbox_unguarded_tables), md5 ข้างบน, itas_admins มี IT3462 (active) และ persona SBX-IT-ADMIN
--   หลัง apply ตรวจ: relrowsecurity ของ 8 ตาราง, ไม่มี grant ตรง, RPC anon เรียกไม่ได้, โปรแกรมตั้งต้น 8 + 8 (จริง/ทดสอบ), ไม่มีแถว itua_users/โฟลเดอร์, itas_admins ไม่เปลี่ยน
--
-- Rollback (ยังไม่มีข้อมูลจริง): drop function public.app_itua_* / app_sandbox_purge_itua / private.itua_* · drop table itua_acknowledgements, itua_log, itua_program_grants, itua_folder_grants,
--   itua_emails, itua_programs, itua_folders, itua_users (ลูกก่อนแม่) · create or replace private.sandbox_unguarded_tables() กลับเป็นนิยามของ 20261226010000
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itas_admins') is null or to_regprocedure('private.itas_actor()') is null then
    raise exception 'ไม่พบ itas_admins (ทะเบียนอุปกรณ์ IT) กรุณา apply 20261222010000_itas_asset_register.sql ก่อน';
  end if;
  if to_regclass('public.employees') is null or to_regprocedure('private.sandbox_persona()') is null
     or to_regprocedure('private.lab_only_block()') is null then
    raise exception 'ไม่พบตารางพนักงานหรือระบบโหมดทดสอบ (Admin Sandbox) กรุณา apply migration ก่อนหน้า';
  end if;
  if not ('bom_order_requests' = any (private.sandbox_unguarded_tables())) or to_regclass('public.bom_order_requests') is null then
    raise exception 'private.sandbox_unguarded_tables() ยังไม่ใช่ฉบับของ 20261226010000_bom_sales_orders.sql กรุณา apply ก่อน (รายชื่อต้องต่อจากฉบับนั้น)';
  end if;
end;
$$;

-- เก็บรายชื่อเดิมไว้ตรวจหลัง replace ว่าไม่มีชื่อใดหาย (ตารางชั่วคราวของ session นี้ · ลบทิ้งท้ายขั้นที่ 5 · ไม่ใช้ on commit drop
-- เพราะถ้าตัวรันไม่ห่อทั้งไฟล์ใน transaction เดียว ตารางจะหายก่อนถึงขั้นตรวจ)
drop table if exists pg_temp.itua_old_unguarded;
create temp table itua_old_unguarded as
  select t from unnest(private.sandbox_unguarded_tables()) as t;

-- 1. ตาราง -----------------------------------------------------------------------
create table public.itua_users (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- Auth. Name ของผู้ใช้ในระบบ (เช่น somchai.k) เก็บตัวเล็ก ไม่มีช่องว่าง · ไม่ซ้ำต่อโหมด (รวมคนที่ลาออกแล้ว)
  auth_id text not null check (auth_id = lower(btrim(auth_id)) and auth_id ~ '^[a-z0-9]([a-z0-9._-]{0,58}[a-z0-9])?$'),
  name_th text check (name_th is null or (btrim(name_th) <> '' and char_length(name_th) <= 200 and name_th !~ '[[:cntrl:]]')),
  name_en text check (name_en is null or (btrim(name_en) <> '' and char_length(name_en) <= 200 and name_en !~ '[[:cntrl:]]')),
  -- รหัสแผนกเป็นข้อความอิสระ ไม่ผูก FK (ข้อมูลเก่าอาจไม่ตรงแผนกของระบบ) เก็บตัวพิมพ์ใหญ่
  department_code text check (department_code is null or (department_code = upper(btrim(department_code)) and btrim(department_code) <> '' and char_length(department_code) <= 50 and department_code !~ '[[:cntrl:]]')),
  division text not null check (division in ('office', 'factory', 'manager', 'office_indesign')),
  internet boolean not null default false,
  status text not null default 'active' check (status in ('active', 'resigned')),
  -- เลขใบ/วันที่ให้สิทธิ์ล่าสุด (ข้อความอิสระจากไฟล์เดิม · ขั้นที่ 4 จะเติมจากเลขใบขอสิทธิ์)
  granted_doc_no text check (granted_doc_no is null or (btrim(granted_doc_no) <> '' and char_length(granted_doc_no) <= 50 and granted_doc_no !~ '[[:cntrl:]]')),
  granted_on date check (granted_on is null or granted_on between date '1990-01-01' and date '2100-01-01'),
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 2000)),
  -- ผูกบัญชีพนักงานของระบบ (ไม่บังคับ · ผูกได้คนละ 1 แถวต่อโหมด)
  employee_id uuid references public.employees(id),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  constraint itua_users_name_ck check (name_th is not null or name_en is not null),
  unique (id, is_test)
);
create unique index itua_users_auth_id_uk on public.itua_users (is_test, auth_id);
create unique index itua_users_employee_uk on public.itua_users (is_test, employee_id) where employee_id is not null;
create index itua_users_dept_idx on public.itua_users (is_test, department_code);
create index itua_users_employee_idx on public.itua_users (employee_id) where employee_id is not null;
create index itua_users_created_by_idx on public.itua_users (created_by);
create index itua_users_updated_by_idx on public.itua_users (updated_by);
comment on table public.itua_users is
  'ทะเบียนสิทธิ์ผู้ใช้ (1 แถวต่อ Auth. Name) · ลบไม่ได้ (ใช้สถานะ resigned) · เขียนผ่าน app_itua_* เท่านั้น · ลงประวัติใน itua_log โดย trigger';

create table public.itua_emails (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  user_id uuid not null,
  address text not null check (address = lower(btrim(address)) and char_length(address) <= 200 and address ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  kind text not null check (kind in ('internal', 'extra')),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  foreign key (user_id, is_test) references public.itua_users (id, is_test)
);
create unique index itua_emails_address_uk on public.itua_emails (is_test, address) where status = 'active';
create unique index itua_emails_internal_uk on public.itua_emails (user_id) where kind = 'internal' and status = 'active';
create index itua_emails_user_idx on public.itua_emails (user_id, is_test);
create index itua_emails_created_by_idx on public.itua_emails (created_by);
create index itua_emails_updated_by_idx on public.itua_emails (updated_by);
comment on table public.itua_emails is
  'อีเมลของผู้ใช้ในทะเบียนสิทธิ์ (ที่อยู่อย่างเดียว ไม่เก็บรหัสผ่าน) · ปิดได้ ลบไม่ได้ · ที่ปิดแล้วเปิดใหม่ไม่ได้ (เพิ่มแถวใหม่)';

create table public.itua_folders (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  name text not null check (btrim(name) <> '' and char_length(name) <= 200 and name !~ '[[:cntrl:]]'),
  description text check (description is null or (btrim(description) <> '' and char_length(description) <= 1000 and description !~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]')),
  sort integer not null default 100 check (sort between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  unique (id, is_test)
);
create unique index itua_folders_code_uk on public.itua_folders (is_test, code);
create index itua_folders_created_by_idx on public.itua_folders (created_by);
create index itua_folders_updated_by_idx on public.itua_folders (updated_by);
comment on table public.itua_folders is
  'รายการโฟลเดอร์แชร์ที่ให้สิทธิ์ได้ (รหัสแก้ไม่ได้ ลบไม่ได้ ปิดใช้งานแทน) · ไม่ seed — นำเข้าจากหัวคอลัมน์ชีต Authorization ในขั้นที่ 2';

-- แถว seed ไม่มีผู้ทำรายการ (created_by/updated_by เป็น null) · แถวที่ผู้ใช้สร้างมีเสมอ
create table public.itua_programs (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code = upper(btrim(code)) and code ~ '^[A-Z0-9][A-Z0-9_-]{0,29}$'),
  name text not null check (btrim(name) <> '' and char_length(name) <= 200 and name !~ '[[:cntrl:]]'),
  sort integer not null default 100 check (sort between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.employees(id),
  updated_at timestamptz not null default now(),
  unique (id, is_test)
);
create unique index itua_programs_code_uk on public.itua_programs (is_test, code);
create index itua_programs_created_by_idx on public.itua_programs (created_by) where created_by is not null;
create index itua_programs_updated_by_idx on public.itua_programs (updated_by) where updated_by is not null;
comment on table public.itua_programs is
  'รายการโปรแกรมที่ให้สิทธิ์ได้ (seed 8 ตัวต่อโหมด: IPRIME ADOBE EXPRESS PAYROLL AUTODESK POWERBI LINE OTHER) · รหัสแก้ไม่ได้ ลบไม่ได้ ปิดใช้งานแทน';

-- สิทธิ์โฟลเดอร์ปัจจุบัน: R = อ่านอย่างเดียว · F = เต็ม · ไม่มีสิทธิ์ = ไม่มีแถว
create table public.itua_folder_grants (
  user_id uuid not null,
  folder_id uuid not null,
  is_test boolean not null default false,
  level text not null check (level in ('R', 'F')),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, folder_id),
  foreign key (user_id, is_test) references public.itua_users (id, is_test),
  foreign key (folder_id, is_test) references public.itua_folders (id, is_test)
);
create index itua_folder_grants_folder_idx on public.itua_folder_grants (folder_id);
create index itua_folder_grants_created_by_idx on public.itua_folder_grants (created_by);
create index itua_folder_grants_updated_by_idx on public.itua_folder_grants (updated_by);
comment on table public.itua_folder_grants is
  'สิทธิ์โฟลเดอร์แชร์ปัจจุบัน (R/F) 1 แถวต่อคู่ · เปลี่ยนผ่าน app_itua_set_grants เท่านั้น · ถอดสิทธิ์ = ลบแถว โดย log เก็บค่าเดิมครบ';

create table public.itua_program_grants (
  user_id uuid not null,
  program_id uuid not null,
  is_test boolean not null default false,
  -- หมายเหตุ (บังคับเมื่อโปรแกรมรหัส OTHER = "อื่นๆ ระบุ" · trigger ตรวจ)
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500 and note !~ '[[:cntrl:]]')),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  primary key (user_id, program_id),
  foreign key (user_id, is_test) references public.itua_users (id, is_test),
  foreign key (program_id, is_test) references public.itua_programs (id, is_test)
);
create index itua_program_grants_program_idx on public.itua_program_grants (program_id);
create index itua_program_grants_created_by_idx on public.itua_program_grants (created_by);
create index itua_program_grants_updated_by_idx on public.itua_program_grants (updated_by);
comment on table public.itua_program_grants is
  'สิทธิ์โปรแกรมปัจจุบัน (ต่อคน) · เปลี่ยนผ่าน app_itua_set_grants เท่านั้น · ถอดสิทธิ์ = ลบแถว โดย log เก็บค่าเดิมครบ';

-- ประวัติทุกการเปลี่ยนแปลง (ISO) · เขียนโดย trigger เท่านั้น
create table public.itua_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  -- ผู้ใช้ที่เกี่ยวข้อง (null สำหรับการแก้รายการโฟลเดอร์/โปรแกรมกลาง)
  user_id uuid,
  entity text not null check (entity in ('user', 'email', 'folder_grant', 'program_grant', 'folder', 'program')),
  -- user/email/folder/program = id ของแถว · folder_grant/program_grant = id ของโฟลเดอร์/โปรแกรม
  entity_id uuid not null,
  -- ชื่ออ่านง่ายของสิ่งที่เปลี่ยน ณ ตอนนั้น: auth_id / ที่อยู่อีเมล / รหัสโฟลเดอร์ / รหัสโปรแกรม
  entity_code text,
  action text not null check (action in ('created', 'updated', 'deleted')),
  actor_id uuid not null references public.employees(id),
  reason text check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 1000)),
  old_values jsonb,
  new_values jsonb,
  -- เตรียมไว้ให้ใบขอสิทธิ์ (ขั้นที่ 4) · รอบนี้ trigger ไม่เขียนค่าเหล่านี้ (null เสมอ)
  source_request_id uuid,
  source_doc_no text check (source_doc_no is null or (btrim(source_doc_no) <> '' and char_length(source_doc_no) <= 50)),
  created_at timestamptz not null default now(),
  foreign key (user_id, is_test) references public.itua_users (id, is_test),
  constraint itua_log_old_values_ck check ((action = 'created') = (old_values is null)),
  constraint itua_log_new_values_ck check ((action = 'deleted') = (new_values is null))
);
create index itua_log_user_idx on public.itua_log (user_id, id);
create index itua_log_actor_idx on public.itua_log (actor_id);
create index itua_log_mode_idx on public.itua_log (is_test, id);
comment on table public.itua_log is
  'ประวัติเพิ่ม/แก้/ถอนสิทธิ์ของทะเบียนสิทธิ์ผู้ใช้ทุกอย่าง (ใคร เมื่อไร ค่าเดิม ค่าใหม่ เหตุผล) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บนตารางทะเบียน';

-- ผู้ใช้กดรับทราบสิทธิ์ (ลายเซ็นอิเล็กทรอนิกส์) · รอบนี้ยังไม่มี RPC เขียน (ขั้นที่ 4)
create table public.itua_acknowledgements (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  user_id uuid not null,
  request_id uuid,
  acknowledged_by uuid not null references public.employees(id),
  acknowledged_at timestamptz not null default now(),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  policy_version text not null check (btrim(policy_version) <> '' and char_length(policy_version) <= 50),
  foreign key (user_id, is_test) references public.itua_users (id, is_test)
);
create index itua_acknowledgements_user_idx on public.itua_acknowledgements (user_id, id);
create index itua_acknowledgements_by_idx on public.itua_acknowledgements (acknowledged_by);
comment on table public.itua_acknowledgements is
  'ประวัติรับทราบสิทธิ์ของผู้ใช้ (ชื่อ + วันเวลา + snapshot สิทธิ์ + เวอร์ชันนโยบาย) · เพิ่มได้อย่างเดียว (trigger)';

-- 2. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itua_users', 'itua_emails', 'itua_folders', 'itua_folder_grants', 'itua_programs', 'itua_program_grants', 'itua_log', 'itua_acknowledgements'
  ] loop
    -- ถอน service_role ด้วย (บันทึก ISO ต้องไม่ถูกเขียนตรงด้วย secret key)
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', v_table);
    for v_sequence in
      select format('%I.%I', n.nspname, s.relname)
      from pg_catalog.pg_class s
      join pg_catalog.pg_namespace n on n.oid = s.relnamespace
      join pg_catalog.pg_depend d on d.objid = s.oid and d.deptype in ('a', 'i')
      where s.relkind = 'S' and d.refobjid = ('public.' || v_table)::regclass
    loop
      execute format('revoke all on sequence %s from public, anon, authenticated, service_role', v_sequence);
    end loop;
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
    -- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้
    execute format('select private.lab_only_guard_table(%L)', 'public.' || v_table);
  end loop;
end $$;

-- 3. ตัวช่วยของ RPC + trigger -------------------------------------------------------------
create or replace function private.itua_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '')
$$;

-- ผู้ทำรายการ: persona (ถ้าอยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานตัวจริงที่ผูกบัญชีและเปิดใช้งาน (เหมือน private.itas_actor)
create or replace function private.itua_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบ' using errcode = 'insufficient_privilege';
  end if;
  v_actor := private.sandbox_persona();
  if v_actor.id is not null then
    return v_actor;
  end if;
  select * into v_actor
  from public.employees e
  where e.auth_user_id = auth.uid() and e.is_active and e.deleted_at is null and not e.is_test
  limit 1;
  if v_actor.id is null then
    raise exception 'ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT' using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- ผู้ทำรายการต้องอยู่ใน itas_admins (แถวต้องอยู่โหมดเดียวกับพนักงาน) · ทุก RPC เรียกเป็นลำดับแรกหลังด่าน lab-only · คืนแถวพนักงาน
create or replace function private.itua_require_admin()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  v_actor := private.itua_actor();
  if not exists (
       select 1 from public.itas_admins a
       where a.employee_id = v_actor.id and a.is_test = v_actor.is_test) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้' using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- ลบได้เฉพาะแถวทดสอบ ภายใน app_sandbox_purge_itua (ตั้ง itua.purge = on แบบ transaction-local) แถวจริงลบไม่ได้เลย
create or replace function private.itua_purge_allowed(p_is_test boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_is_test and coalesce(current_setting('itua.purge', true), '') = 'on'
$$;

-- RPC แจ้ง "ผู้ทำรายการ + เหตุผล" ให้ trigger ลง itua_log (transaction-local) · จบแล้วล้างค่า
create or replace function private.itua_begin_change(p_actor_id uuid, p_reason text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('itua.actor_id', p_actor_id::text, true);
  perform set_config('itua.reason', coalesce(p_reason, ''), true);
end;
$$;

create or replace function private.itua_end_change()
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  perform set_config('itua.actor_id', '', true);
  perform set_config('itua.reason', '', true);
end;
$$;

-- กันแก้/ลบประวัติ (log, acknowledgements)
create or replace function private.itua_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ประวัติทะเบียนสิทธิ์ผู้ใช้แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if private.itua_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติทะเบียนสิทธิ์ผู้ใช้ลบไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ประวัติทะเบียนสิทธิ์ผู้ใช้ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
end;
$$;

-- ผู้ใช้: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · id/โหมด/ผู้และเวลาที่สร้างแก้ไม่ได้ · เวลาแก้ล่าสุดตั้งโดย trigger (ใช้กันแก้ชนกัน)
create or replace function private.itua_users_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itua_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ผู้ใช้ในทะเบียนสิทธิ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นลาออกแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ทะเบียนสิทธิ์ผู้ใช้ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.is_test, new.created_by, new.created_at) is distinct from (old.id, old.is_test, old.created_by, old.created_at) then
    raise exception 'รหัสผู้ใช้ โหมด และผู้บันทึกของผู้ใช้ในทะเบียนแก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- อีเมล: ลบไม่ได้ · แก้ได้อย่างเดียวคือ active -> closed (ที่อยู่/ชนิด/เจ้าของแก้ไม่ได้ ปิดแล้วเปิดใหม่ไม่ได้)
create or replace function private.itua_emails_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itua_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'อีเมลในทะเบียนสิทธิ์ลบไม่ได้ ให้ปิดแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'อีเมลในทะเบียนสิทธิ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.is_test, new.user_id, new.address, new.kind, new.created_by, new.created_at)
     is distinct from (old.id, old.is_test, old.user_id, old.address, old.kind, old.created_by, old.created_at) then
    raise exception 'ที่อยู่อีเมล ชนิด และเจ้าของแก้ไม่ได้ (ให้ปิดแล้วเพิ่มใหม่)' using errcode = 'insufficient_privilege';
  end if;
  if new.status is distinct from old.status and not (old.status = 'active' and new.status = 'closed') then
    raise exception 'อีเมลที่ปิดแล้วเปิดใหม่ไม่ได้ ให้เพิ่มเป็นรายการใหม่' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- โฟลเดอร์/โปรแกรม (รายการกลาง): ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · รหัส/โหมด/ผู้และเวลาที่สร้างแก้ไม่ได้
create or replace function private.itua_catalog_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itua_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'รายการโฟลเดอร์/โปรแกรมลบไม่ได้ ให้ปิดการใช้งานแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'รายการโฟลเดอร์/โปรแกรมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.is_test, new.code, new.created_by, new.created_at) is distinct from (old.id, old.is_test, old.code, old.created_by, old.created_at) then
    raise exception 'รหัสและผู้บันทึกของโฟลเดอร์/โปรแกรมแก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- สิทธิ์โฟลเดอร์: เพิ่มได้เฉพาะผู้ใช้ที่ยังใช้งาน · แก้ได้เฉพาะระดับ (R/F) · ลบแถวได้ (ถอดสิทธิ์ — trigger log จะไม่ยอมถ้าไม่มีผู้ทำรายการ/เหตุผล) · ล้างทั้งตารางไม่ได้
create or replace function private.itua_folder_grants_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'สิทธิ์โฟลเดอร์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    return old;
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from public.itua_users u where u.id = new.user_id and u.is_test = new.is_test and u.status = 'active') then
      raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มสิทธิ์โฟลเดอร์ไม่ได้' using errcode = 'insufficient_privilege';
    end if;
    return new;
  end if;
  if (new.user_id, new.folder_id, new.is_test, new.created_by, new.created_at) is distinct from (old.user_id, old.folder_id, old.is_test, old.created_by, old.created_at) then
    raise exception 'ผู้ใช้ โฟลเดอร์ และผู้บันทึกของสิทธิ์แก้ไม่ได้ (ให้ถอดแล้วเพิ่มใหม่)' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- สิทธิ์โปรแกรม: เหมือนสิทธิ์โฟลเดอร์ + โปรแกรมรหัส OTHER ("อื่นๆ ระบุ") ต้องมีหมายเหตุเสมอ
create or replace function private.itua_program_grants_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'TRUNCATE' then
    raise exception 'สิทธิ์โปรแกรมล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    return old;
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from public.itua_users u where u.id = new.user_id and u.is_test = new.is_test and u.status = 'active') then
      raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มสิทธิ์โปรแกรมไม่ได้' using errcode = 'insufficient_privilege';
    end if;
  else
    if (new.user_id, new.program_id, new.is_test, new.created_by, new.created_at) is distinct from (old.user_id, old.program_id, old.is_test, old.created_by, old.created_at) then
      raise exception 'ผู้ใช้ โปรแกรม และผู้บันทึกของสิทธิ์แก้ไม่ได้ (ให้ถอดแล้วเพิ่มใหม่)' using errcode = 'insufficient_privilege';
    end if;
    new.updated_at := now();
  end if;
  if new.note is null and exists (select 1 from public.itua_programs p where p.id = new.program_id and p.is_test = new.is_test and p.code = 'OTHER') then
    raise exception 'สิทธิ์โปรแกรม "อื่นๆ" ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ลง itua_log ทุกครั้งที่เพิ่ม/แก้/ลบแถวของตารางทะเบียน (ทุกทางเข้า) · TG_ARGV[0] = ชนิด entity
--   ผู้ทำรายการ: itua.actor_id (RPC ตั้ง) · ถ้าไม่มี ใช้ updated_by ของแถวที่เพิ่ม/แก้ · ลบแถวต้องมี itua.actor_id เท่านั้น
--   เหตุผล: itua.reason · แก้/ลบแถวที่มีอยู่แล้วต้องมีเหตุผลเสมอ · เพิ่มแถวใหม่ไม่บังคับ
--   แถว seed (เพิ่มโดยไม่มีผู้ทำรายการ) ไม่ลง log · ล้างข้อมูลทดสอบ (purge) ไม่ลง log · แก้โดยค่าไม่เปลี่ยน (ยกเว้น updated_*) ไม่ลง log
create or replace function private.itua_log()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb;
  v_new jsonb;
  v_row jsonb;
  v_is_test boolean;
  v_actor uuid;
  v_reason text;
  v_user_id uuid;
  v_entity_id uuid;
  v_code text;
begin
  if tg_op <> 'INSERT' then
    v_old := to_jsonb(old);
  end if;
  if tg_op <> 'DELETE' then
    v_new := to_jsonb(new);
  end if;
  v_row := coalesce(v_new, v_old);
  v_is_test := (v_row ->> 'is_test')::boolean;
  if private.itua_purge_allowed(v_is_test) then
    return null;
  end if;
  if tg_op = 'UPDATE' and (v_new - 'updated_at' - 'updated_by') is not distinct from (v_old - 'updated_at' - 'updated_by') then
    return null;
  end if;

  v_actor := nullif(current_setting('itua.actor_id', true), '')::uuid;
  if tg_op <> 'DELETE' then
    v_actor := coalesce(v_actor, nullif(v_new ->> 'updated_by', '')::uuid);
  end if;
  if v_actor is null then
    if tg_op = 'INSERT' then
      return null;
    end if;
    raise exception 'ไม่ทราบผู้ทำรายการ จึงแก้หรือลบข้อมูลทะเบียนสิทธิ์ผู้ใช้ไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  v_reason := private.itua_clean(current_setting('itua.reason', true));
  if tg_op <> 'INSERT' and v_reason is null then
    raise exception 'ต้องระบุเหตุผลทุกครั้งที่แก้หรือถอดข้อมูลทะเบียนสิทธิ์ผู้ใช้ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
  end if;

  v_user_id := case
    when v_entity = 'user' then (v_row ->> 'id')::uuid
    when v_entity in ('folder', 'program') then null
    else (v_row ->> 'user_id')::uuid end;
  v_entity_id := case
    when v_entity = 'folder_grant' then (v_row ->> 'folder_id')::uuid
    when v_entity = 'program_grant' then (v_row ->> 'program_id')::uuid
    else (v_row ->> 'id')::uuid end;
  v_code := case
    when v_entity = 'user' then v_row ->> 'auth_id'
    when v_entity = 'email' then v_row ->> 'address'
    when v_entity in ('folder', 'program') then v_row ->> 'code'
    when v_entity = 'folder_grant' then (select f.code from public.itua_folders f where f.id = v_entity_id)
    else (select p.code from public.itua_programs p where p.id = v_entity_id) end;

  insert into public.itua_log (is_test, user_id, entity, entity_id, entity_code, action, actor_id, reason, old_values, new_values)
  values (v_is_test, v_user_id, v_entity, v_entity_id, v_code,
          case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end,
          v_actor, v_reason, v_old, v_new);
  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'itua_users', 'itua_emails', 'itua_folders', 'itua_folder_grants', 'itua_programs', 'itua_program_grants', 'itua_log', 'itua_acknowledgements'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.sandbox_row_scope()',
                   v_table || '_sandbox_scope', v_table);
  end loop;
  -- เพิ่มได้อย่างเดียว: กัน UPDATE/DELETE (ยกเว้น purge แถวทดสอบ) และ TRUNCATE
  foreach v_table in array array['itua_log', 'itua_acknowledgements'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.itua_append_only_guard()',
                   v_table || '_append_only', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.itua_append_only_guard()',
                   v_table || '_no_truncate', v_table);
  end loop;
end $$;

-- ชื่อ trigger เรียงตัวอักษร: _guard ตรวจก่อน แล้วค่อย _sandbox_scope
create trigger itua_users_guard before update or delete on public.itua_users
  for each row execute function private.itua_users_guard();
create trigger itua_users_no_truncate before truncate on public.itua_users
  for each statement execute function private.itua_users_guard();
create trigger itua_users_log after insert or update on public.itua_users
  for each row execute function private.itua_log('user');

create trigger itua_emails_guard before update or delete on public.itua_emails
  for each row execute function private.itua_emails_guard();
create trigger itua_emails_no_truncate before truncate on public.itua_emails
  for each statement execute function private.itua_emails_guard();
create trigger itua_emails_log after insert or update on public.itua_emails
  for each row execute function private.itua_log('email');

create trigger itua_folders_guard before update or delete on public.itua_folders
  for each row execute function private.itua_catalog_guard();
create trigger itua_folders_no_truncate before truncate on public.itua_folders
  for each statement execute function private.itua_catalog_guard();
create trigger itua_folders_log after insert or update on public.itua_folders
  for each row execute function private.itua_log('folder');

create trigger itua_programs_guard before update or delete on public.itua_programs
  for each row execute function private.itua_catalog_guard();
create trigger itua_programs_no_truncate before truncate on public.itua_programs
  for each statement execute function private.itua_catalog_guard();
create trigger itua_programs_log after insert or update on public.itua_programs
  for each row execute function private.itua_log('program');

create trigger itua_folder_grants_guard before insert or update or delete on public.itua_folder_grants
  for each row execute function private.itua_folder_grants_guard();
create trigger itua_folder_grants_no_truncate before truncate on public.itua_folder_grants
  for each statement execute function private.itua_folder_grants_guard();
create trigger itua_folder_grants_log after insert or update or delete on public.itua_folder_grants
  for each row execute function private.itua_log('folder_grant');

create trigger itua_program_grants_guard before insert or update or delete on public.itua_program_grants
  for each row execute function private.itua_program_grants_guard();
create trigger itua_program_grants_no_truncate before truncate on public.itua_program_grants
  for each statement execute function private.itua_program_grants_guard();
create trigger itua_program_grants_log after insert or update or delete on public.itua_program_grants
  for each row execute function private.itua_log('program_grant');

-- 4. โปรแกรมตั้งต้น 8 ตัว (ชื่อตามฟอร์ม IT01-FM08 ไม่มีค่าข้อมูลจริง) -----------------------
-- seed ของโหมดที่ระบุ (ไม่ทับรายการที่มีอยู่แล้ว) · คืนจำนวนที่เพิ่ม · ใช้ตอน migration และตอนล้างข้อมูลทดสอบ
create or replace function private.itua_seed_programs(p_is_test boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.itua_programs (is_test, code, name, sort)
  select p_is_test, t.code, t.name, t.sort
  from (values
    ('IPRIME', 'iPrime', 10),
    ('ADOBE', 'Adobe Design', 20),
    ('EXPRESS', 'Express', 30),
    ('PAYROLL', 'PayRoll & Time Attendance', 40),
    ('AUTODESK', 'Autodesk Software', 50),
    ('POWERBI', 'PowerBI', 60),
    ('LINE', 'Line', 70),
    ('OTHER', 'อื่นๆ', 80)
  ) as t(code, name, sort)
  on conflict (is_test, code) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- seed ทั้งโหมดจริงและโหมดทดสอบ (auth.uid() เป็น null ตอน migration trigger แยกโหมดจึงเคารพค่า is_test ที่ส่งมา)
select private.itua_seed_programs(false);
select private.itua_seed_programs(true);

-- 5. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- เริ่มจากนิยามล่าสุดบน main (20261226010000_bom_sales_orders.sql) ครบทุกชื่อ + เพิ่ม 8 ตารางใหม่ในส่วน to_regclass (หลัง itas_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers','bom_order_requests',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions','itrp_part_changes',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log','itas_admins',
                                      'itua_users','itua_emails','itua_folders','itua_folder_grants','itua_programs',
                                      'itua_program_grants','itua_log','itua_acknowledgements']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- ชื่อเดิมต้องไม่หายสักชื่อ (ถ้าหายแปลว่าฐานของ replace ไม่ใช่ฉบับล่าสุด)
do $$
declare
  v_missing text;
begin
  select string_agg(o.t, ', ' order by o.t) into v_missing
  from itua_old_unguarded o
  where not (o.t = any (private.sandbox_unguarded_tables()));
  if v_missing is not null then
    raise exception 'private.sandbox_unguarded_tables() ใหม่ทำชื่อเดิมหาย: % (ฐานไม่ใช่ฉบับล่าสุด หยุดแล้วตรวจ migration ของเพื่อน)', v_missing;
  end if;
end $$;
drop table pg_temp.itua_old_unguarded;

-- 6. ตัวช่วยตรวจข้อมูลของ RPC (ผิดแล้วแจ้งเป็นภาษาไทย) --------------------------------------
-- ข้อความ: null/JSON null -> null · ต้องเป็น string · ตัดช่องว่างหัวท้าย · ว่าง -> null · ยาวเกิน/มีอักขระควบคุมไม่ได้ (p_multiline = ยอมขึ้นบรรทัดใหม่/แท็บ)
create or replace function private.itua_text_field(p_value jsonb, p_label text, p_max integer, p_multiline boolean default false)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'ช่อง "%" ต้องเป็นข้อความ', p_label using errcode = 'check_violation';
  end if;
  v_text := private.itua_clean(p_value #>> '{}');
  if v_text is null then
    return null;
  end if;
  if char_length(v_text) > p_max then
    raise exception 'ช่อง "%" ต้องไม่เกิน % ตัวอักษร', p_label, p_max using errcode = 'check_violation';
  end if;
  if (case when p_multiline then v_text ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' else v_text ~ '[[:cntrl:]]' end) then
    raise exception 'ช่อง "%" มีอักขระที่ใช้ไม่ได้', p_label using errcode = 'check_violation';
  end if;
  return v_text;
end;
$$;

-- วันที่: รับข้อความ YYYY-MM-DD (ค.ศ.) ที่เป็นวันที่จริง ระหว่าง 1990-01-01 ถึง 2100-01-01
create or replace function private.itua_date_field(p_value jsonb, p_label text)
returns date
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
  v_date date;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) <> 'string' then
    raise exception 'ช่อง "%" ต้องเป็นวันที่ (ปปปป-ดด-วว แบบ ค.ศ.)', p_label using errcode = 'check_violation';
  end if;
  v_text := private.itua_clean(p_value #>> '{}');
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception 'ช่อง "%" ต้องเป็นวันที่ (ปปปป-ดด-วว แบบ ค.ศ.)', p_label using errcode = 'check_violation';
  end if;
  begin
    v_date := v_text::date;
  exception when others then
    raise exception 'ช่อง "%" ไม่ใช่วันที่ที่ถูกต้อง', p_label using errcode = 'check_violation';
  end;
  if v_date not between date '1990-01-01' and date '2100-01-01' then
    raise exception 'ช่อง "%" ต้องอยู่ระหว่างปี 1990–2100', p_label using errcode = 'check_violation';
  end if;
  return v_date;
end;
$$;

-- รูป JSON ของผู้ใช้หนึ่งแถว (ใช้ร่วมกันทุก RPC ที่คืนผู้ใช้)
create or replace function private.itua_user_json(p_user public.itua_users)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_user.id,
    'auth_id', p_user.auth_id,
    'name_th', p_user.name_th,
    'name_en', p_user.name_en,
    'department_code', p_user.department_code,
    'division', p_user.division,
    'internet', p_user.internet,
    'status', p_user.status,
    'granted_doc_no', p_user.granted_doc_no,
    'granted_on', p_user.granted_on,
    'note', p_user.note,
    'employee_id', p_user.employee_id,
    'created_at', p_user.created_at,
    'created_by_employee_no', (select e.employee_no from public.employees e where e.id = p_user.created_by),
    'updated_at', p_user.updated_at,
    'updated_by_employee_no', (select e.employee_no from public.employees e where e.id = p_user.updated_by)
  )
$$;

-- 7. RPC อ่านข้อมูล (เฉพาะผู้อยู่ใน itas_admins) ------------------------------------------------
-- รายการผู้ใช้ · คืน {total, items[{id, auth_id, name_th, name_en, department_code, division, internet, status, granted_doc_no, granted_on, updated_at,
--   folder_r, folder_f, program_count, internal_email, email_count}]}
--   p_search ค้นแบบไม่สนตัวพิมพ์ใหญ่เล็กใน Auth. Name/ชื่อไทย/ชื่ออังกฤษ/อีเมลที่ใช้งานอยู่ (ใช้ position ไม่ใช้ like จึงไม่ตีความ % _)
--   p_department_code ตรงทั้งคำ (ไม่สนตัวพิมพ์) · p_division = office/factory/manager/office_indesign · p_status = active/resigned · ว่าง = ทุกค่า
--   folder_r/folder_f = จำนวนสิทธิ์โฟลเดอร์ระดับ R/F ทั้งหมดที่ผู้ใช้มี (รวมโฟลเดอร์ที่ปิดใช้งาน) · เรียงตาม Auth. Name · p_limit 1–2000 (ค่าเริ่มต้น 1000)
create or replace function public.app_itua_list_users(
  p_search text default null,
  p_department_code text default null,
  p_division text default null,
  p_status text default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_search text := lower(private.itua_clean(p_search));
  v_dept text := upper(private.itua_clean(p_department_code));
  v_division text := private.itua_clean(p_division);
  v_status text := private.itua_clean(p_status);
  v_result jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_division is not null and v_division not in ('office', 'factory', 'manager', 'office_indesign') then
    raise exception 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)' using errcode = 'check_violation';
  end if;
  if v_status is not null and v_status not in ('active', 'resigned') then
    raise exception 'สถานะต้องเป็น ใช้งาน หรือ ลาออก' using errcode = 'check_violation';
  end if;
  if p_limit is null or p_limit not between 1 and 2000 then
    raise exception 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000' using errcode = 'check_violation';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'ตำแหน่งเริ่มต้องไม่ติดลบ' using errcode = 'check_violation';
  end if;
  with f as (
    select u.id, u.auth_id as sort_key
    from public.itua_users u
    where u.is_test = v_actor.is_test
      and (v_dept is null or u.department_code = v_dept)
      and (v_division is null or u.division = v_division)
      and (v_status is null or u.status = v_status)
      and (v_search is null
           or position(v_search in lower(u.auth_id)) > 0
           or position(v_search in lower(coalesce(u.name_th, ''))) > 0
           or position(v_search in lower(coalesce(u.name_en, ''))) > 0
           or exists (select 1 from public.itua_emails m where m.user_id = u.id and m.status = 'active' and position(v_search in m.address) > 0))
  ),
  pg as (
    select f.id, f.sort_key from f order by f.sort_key, f.id limit p_limit offset p_offset
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from f),
           'items', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', u.id, 'auth_id', u.auth_id, 'name_th', u.name_th, 'name_en', u.name_en,
                      'department_code', u.department_code, 'division', u.division, 'internet', u.internet, 'status', u.status,
                      'granted_doc_no', u.granted_doc_no, 'granted_on', u.granted_on, 'updated_at', u.updated_at,
                      'folder_r', (select count(*)::integer from public.itua_folder_grants g where g.user_id = u.id and g.level = 'R'),
                      'folder_f', (select count(*)::integer from public.itua_folder_grants g where g.user_id = u.id and g.level = 'F'),
                      'program_count', (select count(*)::integer from public.itua_program_grants g where g.user_id = u.id),
                      'internal_email', (select m.address from public.itua_emails m where m.user_id = u.id and m.kind = 'internal' and m.status = 'active' limit 1),
                      'email_count', (select count(*)::integer from public.itua_emails m where m.user_id = u.id and m.status = 'active')
                    ) order by pg.sort_key, pg.id)
             from pg join public.itua_users u on u.id = pg.id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- ผู้ใช้หนึ่งคนครบทุกอย่าง · คืน {user, folders[{folder_id, code, name, is_active, level, updated_at}], emails[{id, address, kind, status, created_at, updated_at}],
--   programs[{program_id, code, name, is_active, note, updated_at}], log[...ใหม่สุดก่อน ไม่เกิน p_log_limit], acknowledgements[...ใหม่สุดก่อน ไม่เกิน 20]}
--   log: [{id, entity, entity_id, entity_code, action, reason, actor_employee_no, actor_full_name, old_values, new_values, source_request_id, source_doc_no, created_at}]
--   acknowledgements: [{id, request_id, acknowledged_by_employee_no, acknowledged_by_full_name, acknowledged_at, snapshot, policy_version}]
--   p_log_limit 1–500 (ค่าเริ่มต้น 200)
create or replace function public.app_itua_get_user(p_id uuid, p_log_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_user public.itua_users%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if p_log_limit is null or p_log_limit not between 1 and 500 then
    raise exception 'จำนวนประวัติที่ขอต่อครั้งต้องอยู่ระหว่าง 1–500' using errcode = 'check_violation';
  end if;
  select * into v_user from public.itua_users u where u.id = p_id and u.is_test = v_actor.is_test;
  if v_user.id is null then
    raise exception 'ไม่พบผู้ใช้นี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'user', private.itua_user_json(v_user),
    'folders', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'folder_id', f.id, 'code', f.code, 'name', f.name, 'is_active', f.is_active, 'level', g.level, 'updated_at', g.updated_at
             ) order by f.sort, f.code), '[]'::jsonb)
      from public.itua_folder_grants g join public.itua_folders f on f.id = g.folder_id
      where g.user_id = v_user.id),
    'emails', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'address', m.address, 'kind', m.kind, 'status', m.status, 'created_at', m.created_at, 'updated_at', m.updated_at
             ) order by (m.status = 'active') desc, (m.kind = 'internal') desc, m.created_at, m.id), '[]'::jsonb)
      from public.itua_emails m where m.user_id = v_user.id),
    'programs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'program_id', p.id, 'code', p.code, 'name', p.name, 'is_active', p.is_active, 'note', g.note, 'updated_at', g.updated_at
             ) order by p.sort, p.code), '[]'::jsonb)
      from public.itua_program_grants g join public.itua_programs p on p.id = g.program_id
      where g.user_id = v_user.id),
    'log', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'entity', l.entity, 'entity_id', l.entity_id, 'entity_code', l.entity_code, 'action', l.action, 'reason', l.reason,
               'actor_employee_no', e.employee_no, 'actor_full_name', e.first_name || ' ' || e.last_name,
               'old_values', l.old_values, 'new_values', l.new_values,
               'source_request_id', l.source_request_id, 'source_doc_no', l.source_doc_no, 'created_at', l.created_at
             ) order by l.id desc), '[]'::jsonb)
      from (select * from public.itua_log x where x.user_id = v_user.id and x.is_test = v_actor.is_test order by x.id desc limit p_log_limit) l
      join public.employees e on e.id = l.actor_id),
    'acknowledgements', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', a.id, 'request_id', a.request_id, 'acknowledged_by_employee_no', e.employee_no,
               'acknowledged_by_full_name', e.first_name || ' ' || e.last_name, 'acknowledged_at', a.acknowledged_at,
               'snapshot', a.snapshot, 'policy_version', a.policy_version
             ) order by a.id desc), '[]'::jsonb)
      from (select * from public.itua_acknowledgements x where x.user_id = v_user.id and x.is_test = v_actor.is_test order by x.id desc limit 20) a
      join public.employees e on e.id = a.acknowledged_by)
  );
end;
$$;

-- เมทริกซ์สิทธิ์ (ผู้ใช้ × โฟลเดอร์ที่ใช้งานอยู่) · คืน {folders[{id, code, name, description, sort}], total, rows[{user_id, auth_id, name_th, name_en, department_code, division, status, internet, levels}]}
--   levels = {รหัสโฟลเดอร์: 'R'|'F'} เฉพาะโฟลเดอร์ที่ใช้งานอยู่และผู้ใช้มีสิทธิ์ (ไม่มีสิทธิ์ = ไม่มีคีย์) · ตัวกรอง/การเรียง/p_limit เหมือน app_itua_list_users
create or replace function public.app_itua_matrix(
  p_search text default null,
  p_department_code text default null,
  p_division text default null,
  p_status text default null,
  p_limit integer default 1000,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_search text := lower(private.itua_clean(p_search));
  v_dept text := upper(private.itua_clean(p_department_code));
  v_division text := private.itua_clean(p_division);
  v_status text := private.itua_clean(p_status);
  v_result jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_division is not null and v_division not in ('office', 'factory', 'manager', 'office_indesign') then
    raise exception 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)' using errcode = 'check_violation';
  end if;
  if v_status is not null and v_status not in ('active', 'resigned') then
    raise exception 'สถานะต้องเป็น ใช้งาน หรือ ลาออก' using errcode = 'check_violation';
  end if;
  if p_limit is null or p_limit not between 1 and 2000 then
    raise exception 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000' using errcode = 'check_violation';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'ตำแหน่งเริ่มต้องไม่ติดลบ' using errcode = 'check_violation';
  end if;
  with f as (
    select u.id, u.auth_id as sort_key
    from public.itua_users u
    where u.is_test = v_actor.is_test
      and (v_dept is null or u.department_code = v_dept)
      and (v_division is null or u.division = v_division)
      and (v_status is null or u.status = v_status)
      and (v_search is null
           or position(v_search in lower(u.auth_id)) > 0
           or position(v_search in lower(coalesce(u.name_th, ''))) > 0
           or position(v_search in lower(coalesce(u.name_en, ''))) > 0
           or exists (select 1 from public.itua_emails m where m.user_id = u.id and m.status = 'active' and position(v_search in m.address) > 0))
  ),
  pg as (
    select f.id, f.sort_key from f order by f.sort_key, f.id limit p_limit offset p_offset
  )
  select jsonb_build_object(
           'folders', (
             select coalesce(jsonb_agg(jsonb_build_object(
                      'id', fo.id, 'code', fo.code, 'name', fo.name, 'description', fo.description, 'sort', fo.sort
                    ) order by fo.sort, fo.code), '[]'::jsonb)
             from public.itua_folders fo where fo.is_test = v_actor.is_test and fo.is_active),
           'total', (select count(*)::integer from f),
           'rows', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'user_id', u.id, 'auth_id', u.auth_id, 'name_th', u.name_th, 'name_en', u.name_en,
                      'department_code', u.department_code, 'division', u.division, 'status', u.status, 'internet', u.internet,
                      'levels', coalesce((
                        select jsonb_object_agg(fo.code, g.level)
                        from public.itua_folder_grants g join public.itua_folders fo on fo.id = g.folder_id
                        where g.user_id = u.id and fo.is_active), '{}'::jsonb)
                    ) order by pg.sort_key, pg.id)
             from pg join public.itua_users u on u.id = pg.id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- รายการโฟลเดอร์และโปรแกรมทั้งหมดของโหมดปัจจุบัน (รวมที่ปิดใช้งาน) พร้อมจำนวนผู้ที่มีสิทธิ์
--   {folders[{id, code, name, description, sort, is_active, grant_count, updated_at}], programs[{id, code, name, sort, is_active, grant_count, updated_at}]} เรียงตาม sort
create or replace function public.app_itua_list_catalog()
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
  v_actor := private.itua_require_admin();
  return jsonb_build_object(
    'folders', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', f.id, 'code', f.code, 'name', f.name, 'description', f.description, 'sort', f.sort, 'is_active', f.is_active,
               'grant_count', (select count(*)::integer from public.itua_folder_grants g where g.folder_id = f.id), 'updated_at', f.updated_at
             ) order by f.sort, f.code), '[]'::jsonb)
      from public.itua_folders f where f.is_test = v_actor.is_test),
    'programs', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', p.id, 'code', p.code, 'name', p.name, 'sort', p.sort, 'is_active', p.is_active,
               'grant_count', (select count(*)::integer from public.itua_program_grants g where g.program_id = p.id), 'updated_at', p.updated_at
             ) order by p.sort, p.code), '[]'::jsonb)
      from public.itua_programs p where p.is_test = v_actor.is_test));
end;
$$;

-- 8. RPC เขียนข้อมูล (เฉพาะผู้อยู่ใน itas_admins) ------------------------------------------------
-- เพิ่ม/แก้ข้อมูลหลักของผู้ใช้
--   p_id: ว่าง = เพิ่มใหม่ (ฐานข้อมูลสร้าง uuid) · uuid ที่ยังไม่มี = เพิ่มใหม่ด้วย id นั้น · uuid ที่มีแล้ว = แก้ (ต้องส่ง expected_updated_at + เหตุผล)
--   p_data: {auth_id, name_th, name_en, department_code, division, granted_doc_no, granted_on, note, employee_id} · ส่งเฉพาะช่องที่ต้องการตั้ง/เปลี่ยน (ช่องที่ไม่ส่งคงค่าเดิม)
--     null/"" = ล้างค่า (auth_id และ division ล้างไม่ได้ · ต้องเหลือชื่อไทยหรืออังกฤษอย่างน้อยหนึ่ง) · ช่องที่ไม่รู้จัก (รวม internet/status ซึ่งเปลี่ยนผ่าน set_grants/set_status) = ผิดพลาด
--     auth_id ถูกตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็ก (a-z 0-9 . _ - ขึ้นต้นและลงท้ายด้วยตัวอักษร/ตัวเลข ≤60) · department_code ตัวพิมพ์ใหญ่ ≤50 · division = office/factory/manager/office_indesign
--     granted_on วันที่ YYYY-MM-DD (ค.ศ.) · employee_id = uuid ของพนักงานในโหมดเดียวกัน (ผูกได้คนละ 1 แถว)
--   สร้างใหม่ต้องมี auth_id และ division · แก้ข้อมูลที่มีอยู่ต้องมีเหตุผล (เฉพาะเมื่อมีค่าเปลี่ยนจริง) · ไม่มีค่าใดเปลี่ยน = changed false (ไม่ลง log)
--   คืน {user, created, changed} · ลง itua_log โดย trigger
create or replace function public.app_itua_save_user(
  p_id uuid default null,
  p_data jsonb default '{}'::jsonb,
  p_reason text default null,
  p_expected_updated_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_data jsonb := coalesce(p_data, '{}'::jsonb);
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_old public.itua_users%rowtype;
  v_row public.itua_users%rowtype;
  v_exists boolean;
  v_key text;
  v_val jsonb;
  v_text text;
  v_saved public.itua_users%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if jsonb_typeof(v_data) <> 'object' then
    raise exception 'ข้อมูลที่ส่งมาต้องเป็นรูปแบบ {ช่อง: ค่า}' using errcode = 'check_violation';
  end if;

  if p_id is not null then
    select * into v_old from public.itua_users u where u.id = p_id for update;
  end if;
  v_exists := v_old.id is not null;
  if v_exists and v_old.is_test <> v_actor.is_test then
    raise exception 'ไม่พบผู้ใช้นี้ หรือรหัสผู้ใช้ (id) นี้ถูกใช้แล้ว' using errcode = 'check_violation';
  end if;

  if v_exists then
    if p_expected_updated_at is null then
      raise exception 'ผู้ใช้นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไข (ต้องส่ง expected_updated_at)' using errcode = 'check_violation';
    end if;
    if p_expected_updated_at <> v_old.updated_at then
      raise exception 'ข้อมูลผู้ใช้นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่' using errcode = '40001';
    end if;
    v_row := v_old;
  else
    v_row.id := coalesce(p_id, gen_random_uuid());
    v_row.is_test := v_actor.is_test;
    v_row.internet := false;
    v_row.status := 'active';
  end if;

  for v_key, v_val in select d.key, d.value from jsonb_each(v_data) d loop
    case v_key
      when 'auth_id' then
        v_text := lower(private.itua_text_field(v_val, 'Auth. Name', 60));
        if v_text is null or v_text !~ '^[a-z0-9]([a-z0-9._-]{0,58}[a-z0-9])?$' then
          raise exception 'Auth. Name ต้องเป็นตัวอักษรอังกฤษ ตัวเลข . _ - (ขึ้นต้นและลงท้ายด้วยตัวอักษรหรือตัวเลข ไม่เกิน 60 ตัว) เช่น somchai.k' using errcode = 'check_violation';
        end if;
        v_row.auth_id := v_text;
      when 'name_th' then v_row.name_th := private.itua_text_field(v_val, 'ชื่อ (ไทย)', 200);
      when 'name_en' then v_row.name_en := private.itua_text_field(v_val, 'ชื่อ (อังกฤษ)', 200);
      when 'department_code' then v_row.department_code := upper(private.itua_text_field(v_val, 'แผนก', 50));
      when 'division' then
        v_text := private.itua_text_field(v_val, 'ฝ่าย', 30);
        if v_text is null or v_text not in ('office', 'factory', 'manager', 'office_indesign') then
          raise exception 'ฝ่ายต้องเป็น สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน (InDesign)' using errcode = 'check_violation';
        end if;
        v_row.division := v_text;
      when 'granted_doc_no' then v_row.granted_doc_no := private.itua_text_field(v_val, 'เลขใบที่ให้สิทธิ์', 50);
      when 'granted_on' then v_row.granted_on := private.itua_date_field(v_val, 'วันที่ให้สิทธิ์');
      when 'note' then v_row.note := private.itua_text_field(v_val, 'หมายเหตุ', 2000, true);
      when 'employee_id' then
        if jsonb_typeof(v_val) = 'null' or private.itua_clean(v_val #>> '{}') is null then
          v_row.employee_id := null;
        else
          begin
            v_row.employee_id := (v_val #>> '{}')::uuid;
          exception when others then
            raise exception 'รหัสพนักงานที่ผูกต้องเป็น uuid' using errcode = 'check_violation';
          end;
          if not exists (select 1 from public.employees e where e.id = v_row.employee_id and e.is_test = v_actor.is_test and e.deleted_at is null) then
            raise exception 'ไม่พบพนักงานที่จะผูกกับผู้ใช้นี้' using errcode = 'check_violation';
          end if;
        end if;
      else raise exception 'ไม่รู้จักช่องข้อมูล "%"', v_key using errcode = 'check_violation';
    end case;
  end loop;

  if v_row.auth_id is null then
    raise exception 'กรุณาระบุ Auth. Name' using errcode = 'check_violation';
  end if;
  if v_row.division is null then
    raise exception 'กรุณาเลือกฝ่าย (สำนักงาน โรงงาน ผู้จัดการ หรือ สำนักงาน InDesign)' using errcode = 'check_violation';
  end if;
  if v_row.name_th is null and v_row.name_en is null then
    raise exception 'กรุณาระบุชื่อ (ไทยหรืออังกฤษอย่างน้อยหนึ่ง)' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.itua_users u where u.is_test = v_actor.is_test and u.auth_id = v_row.auth_id and u.id <> v_row.id) then
    raise exception 'Auth. Name % ซ้ำกับผู้ใช้อื่น', v_row.auth_id using errcode = 'check_violation';
  end if;
  if v_row.employee_id is not null and exists (
       select 1 from public.itua_users u where u.is_test = v_actor.is_test and u.employee_id = v_row.employee_id and u.id <> v_row.id) then
    raise exception 'พนักงานคนนี้ถูกผูกกับผู้ใช้อื่นในทะเบียนแล้ว' using errcode = 'check_violation';
  end if;

  if v_exists then
    if to_jsonb(v_row) is not distinct from to_jsonb(v_old) then
      return jsonb_build_object('user', private.itua_user_json(v_old), 'created', false, 'changed', false);
    end if;
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่แก้ข้อมูลผู้ใช้ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
    end if;
    perform private.itua_begin_change(v_actor.id, v_reason);
    begin
      update public.itua_users
      set auth_id = v_row.auth_id, name_th = v_row.name_th, name_en = v_row.name_en, department_code = v_row.department_code,
          division = v_row.division, granted_doc_no = v_row.granted_doc_no, granted_on = v_row.granted_on, note = v_row.note,
          employee_id = v_row.employee_id, updated_by = v_actor.id
      where id = v_old.id;
    exception when unique_violation then
      raise exception 'Auth. Name หรือพนักงานที่ผูกซ้ำกับผู้ใช้อื่น (มีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่' using errcode = 'check_violation';
    end;
    perform private.itua_end_change();
    select * into v_saved from public.itua_users u where u.id = v_old.id;
    return jsonb_build_object('user', private.itua_user_json(v_saved), 'created', false, 'changed', true);
  end if;

  perform private.itua_begin_change(v_actor.id, v_reason);
  begin
    insert into public.itua_users (id, is_test, auth_id, name_th, name_en, department_code, division, internet, status,
                                   granted_doc_no, granted_on, note, employee_id, created_by, updated_by)
    values (v_row.id, v_row.is_test, v_row.auth_id, v_row.name_th, v_row.name_en, v_row.department_code, v_row.division, false, 'active',
            v_row.granted_doc_no, v_row.granted_on, v_row.note, v_row.employee_id, v_actor.id, v_actor.id);
  exception when unique_violation then
    raise exception 'Auth. Name รหัสผู้ใช้ (id) หรือพนักงานที่ผูกซ้ำกับรายการที่มีอยู่ (หรือมีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่' using errcode = 'check_violation';
  end;
  perform private.itua_end_change();
  select * into v_saved from public.itua_users u where u.id = v_row.id;
  return jsonb_build_object('user', private.itua_user_json(v_saved), 'created', true, 'changed', true);
end;
$$;

-- เปลี่ยนสถานะผู้ใช้ active <-> resigned (ต้องมีเหตุผล) · ไม่ถอดสิทธิ์ให้เอง (ถอดผ่าน app_itua_set_grants)
--   คืน {user, changed, remaining: {folders, programs, internet, emails}} = สิทธิ์ที่ผู้ใช้ยังเหลืออยู่ (หน้าเว็บใช้เตือนเมื่อเปลี่ยนเป็นลาออกแล้วยังมีสิทธิ์)
create or replace function public.app_itua_set_status(p_user_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_status text := private.itua_clean(p_status);
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_user public.itua_users%rowtype;
  v_changed boolean := false;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_status is null or v_status not in ('active', 'resigned') then
    raise exception 'สถานะต้องเป็น ใช้งาน หรือ ลาออก' using errcode = 'check_violation';
  end if;
  select * into v_user from public.itua_users u where u.id = p_user_id and u.is_test = v_actor.is_test for update;
  if v_user.id is null then
    raise exception 'ไม่พบผู้ใช้นี้' using errcode = 'check_violation';
  end if;
  if v_user.status <> v_status then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่เปลี่ยนสถานะผู้ใช้ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
    end if;
    perform private.itua_begin_change(v_actor.id, v_reason);
    update public.itua_users set status = v_status, updated_by = v_actor.id where id = v_user.id;
    perform private.itua_end_change();
    v_changed := true;
    select * into v_user from public.itua_users u where u.id = p_user_id;
  end if;
  return jsonb_build_object(
    'user', private.itua_user_json(v_user),
    'changed', v_changed,
    'remaining', jsonb_build_object(
      'folders', (select count(*)::integer from public.itua_folder_grants g where g.user_id = v_user.id),
      'programs', (select count(*)::integer from public.itua_program_grants g where g.user_id = v_user.id),
      'internet', v_user.internet,
      'emails', (select count(*)::integer from public.itua_emails m where m.user_id = v_user.id and m.status = 'active')));
end;
$$;

-- เปลี่ยนสิทธิ์ของผู้ใช้หนึ่งคนเป็นชุดเดียว (atomic: ผิดข้อใดข้อหนึ่ง = ไม่เปลี่ยนอะไรเลย รวมถึง log) · ต้องมีเหตุผล
--   p_changes: array ของรายการ (ไม่เกิน 200) แต่ละรายการต้องมีคีย์ from (ค่าเดิมที่หน้าเว็บเห็น) และ to (ค่าใหม่)
--     {kind:'folder', code:'<รหัสโฟลเดอร์>', from:null|'R'|'F', to:null|'R'|'F'}   null = ไม่มีสิทธิ์
--     {kind:'internet', from:boolean, to:boolean}
--     {kind:'program', code:'<รหัสโปรแกรม>', from:boolean, to:boolean, note?:text, from_note?:text}   note บังคับเมื่อ to=true และเป็นโปรแกรม OTHER · from=to=true + note ต่างจากเดิม = แก้หมายเหตุ
--   ค่า from ต้องตรงกับฐานข้อมูลตอนนี้ ไม่ตรง = error 40001 (ข้อมูลเก่า/ชนกัน — ให้โหลดใหม่) · from = to (ไม่มีการเปลี่ยน) / รายการซ้ำ = error
--   ผู้ใช้ที่ลาออกแล้ว: ถอนสิทธิ์ได้อย่างเดียว · โฟลเดอร์/โปรแกรมที่ปิดใช้งาน: เพิ่ม/เปลี่ยนไม่ได้ ถอนได้
--   คืน {user_id, applied, changes[{kind, code, from, to}]} · ลง itua_log (action created/updated/deleted ต่อรายการ) โดย trigger
create or replace function public.app_itua_set_grants(p_user_id uuid, p_changes jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_user public.itua_users%rowtype;
  v_el jsonb;
  v_ord integer := 0;
  v_kind text;
  v_code text;
  v_from_json jsonb;
  v_to_json jsonb;
  v_from_level text;
  v_to_level text;
  v_from_flag boolean;
  v_to_flag boolean;
  v_note text;
  v_cur_level text;
  v_cur_note text;
  v_cur_exists boolean;
  v_folder public.itua_folders%rowtype;
  v_program public.itua_programs%rowtype;
  v_seen text[] := '{}';
  v_key text;
  v_done jsonb := '[]'::jsonb;
  v_label text;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่เปลี่ยนสิทธิ์ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_changes) is distinct from 'array' or jsonb_array_length(p_changes) = 0 then
    raise exception 'กรุณาระบุรายการสิทธิ์ที่จะเปลี่ยนอย่างน้อยหนึ่งรายการ' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_changes) > 200 then
    raise exception 'เปลี่ยนสิทธิ์ได้ครั้งละไม่เกิน 200 รายการ' using errcode = 'check_violation';
  end if;
  select * into v_user from public.itua_users u where u.id = p_user_id and u.is_test = v_actor.is_test for update;
  if v_user.id is null then
    raise exception 'ไม่พบผู้ใช้นี้' using errcode = 'check_violation';
  end if;

  perform private.itua_begin_change(v_actor.id, v_reason);
  for v_el in select e.value from jsonb_array_elements(p_changes) e loop
    v_ord := v_ord + 1;
    if jsonb_typeof(v_el) <> 'object' or not (v_el ? 'from') or not (v_el ? 'to') then
      raise exception 'รายการที่ % ต้องมี kind, from และ to (from = ค่าเดิมที่หน้าจอเห็น)', v_ord using errcode = 'check_violation';
    end if;
    v_kind := v_el ->> 'kind';
    v_from_json := v_el -> 'from';
    v_to_json := v_el -> 'to';

    if v_kind = 'folder' then
      v_code := upper(private.itua_text_field(v_el -> 'code', 'รหัสโฟลเดอร์', 30));
      v_label := 'โฟลเดอร์ ' || coalesce(v_code, '?');
      if v_code is null then
        raise exception 'รายการที่ %: กรุณาระบุรหัสโฟลเดอร์', v_ord using errcode = 'check_violation';
      end if;
      select * into v_folder from public.itua_folders f where f.is_test = v_actor.is_test and f.code = v_code;
      if v_folder.id is null then
        raise exception 'ไม่พบโฟลเดอร์ %', v_code using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_from_json) not in ('null', 'string') or jsonb_typeof(v_to_json) not in ('null', 'string') then
        raise exception '%: สิทธิ์ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', v_label using errcode = 'check_violation';
      end if;
      v_from_level := case when jsonb_typeof(v_from_json) = 'string' then v_from_json #>> '{}' end;
      v_to_level := case when jsonb_typeof(v_to_json) = 'string' then v_to_json #>> '{}' end;
      if (v_from_level is not null and v_from_level not in ('R', 'F')) or (v_to_level is not null and v_to_level not in ('R', 'F')) then
        raise exception '%: สิทธิ์ต้องเป็น R, F หรือ null (ไม่มีสิทธิ์)', v_label using errcode = 'check_violation';
      end if;
      v_key := 'folder:' || v_code;
      if v_key = any (v_seen) then
        raise exception '% ซ้ำกันในรายการเดียวกัน', v_label using errcode = 'check_violation';
      end if;
      v_seen := v_seen || v_key;
      if v_from_level is not distinct from v_to_level then
        raise exception '%: สิทธิ์ใหม่เหมือนเดิม ไม่มีการเปลี่ยนแปลง', v_label using errcode = 'check_violation';
      end if;
      select g.level into v_cur_level from public.itua_folder_grants g where g.user_id = v_user.id and g.folder_id = v_folder.id;
      if v_cur_level is distinct from v_from_level then
        raise exception '%: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
      end if;
      if v_to_level is not null then
        if v_user.status <> 'active' then
          raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)' using errcode = 'check_violation';
        end if;
        if not v_folder.is_active then
          raise exception '%: โฟลเดอร์ปิดการใช้งานอยู่ เพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้)', v_label using errcode = 'check_violation';
        end if;
      end if;
      if v_from_level is null then
        insert into public.itua_folder_grants (user_id, folder_id, is_test, level, created_by, updated_by)
        values (v_user.id, v_folder.id, v_user.is_test, v_to_level, v_actor.id, v_actor.id);
      elsif v_to_level is null then
        delete from public.itua_folder_grants where user_id = v_user.id and folder_id = v_folder.id;
      else
        update public.itua_folder_grants set level = v_to_level, updated_by = v_actor.id where user_id = v_user.id and folder_id = v_folder.id;
      end if;
      v_done := v_done || jsonb_build_array(jsonb_build_object('kind', 'folder', 'code', v_code, 'from', v_from_json, 'to', v_to_json));

    elsif v_kind = 'internet' then
      if jsonb_typeof(v_from_json) <> 'boolean' or jsonb_typeof(v_to_json) <> 'boolean' then
        raise exception 'อินเทอร์เน็ต: from และ to ต้องเป็น true หรือ false' using errcode = 'check_violation';
      end if;
      v_key := 'internet';
      if v_key = any (v_seen) then
        raise exception 'อินเทอร์เน็ตซ้ำกันในรายการเดียวกัน' using errcode = 'check_violation';
      end if;
      v_seen := v_seen || v_key;
      v_from_flag := (v_from_json #>> '{}')::boolean;
      v_to_flag := (v_to_json #>> '{}')::boolean;
      if v_from_flag = v_to_flag then
        raise exception 'อินเทอร์เน็ต: สิทธิ์ใหม่เหมือนเดิม ไม่มีการเปลี่ยนแปลง' using errcode = 'check_violation';
      end if;
      if v_user.internet <> v_from_flag then
        raise exception 'อินเทอร์เน็ต: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่' using errcode = '40001';
      end if;
      if v_to_flag and v_user.status <> 'active' then
        raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)' using errcode = 'check_violation';
      end if;
      update public.itua_users set internet = v_to_flag, updated_by = v_actor.id where id = v_user.id;
      v_user.internet := v_to_flag;
      v_done := v_done || jsonb_build_array(jsonb_build_object('kind', 'internet', 'code', null, 'from', v_from_json, 'to', v_to_json));

    elsif v_kind = 'program' then
      v_code := upper(private.itua_text_field(v_el -> 'code', 'รหัสโปรแกรม', 30));
      v_label := 'โปรแกรม ' || coalesce(v_code, '?');
      if v_code is null then
        raise exception 'รายการที่ %: กรุณาระบุรหัสโปรแกรม', v_ord using errcode = 'check_violation';
      end if;
      select * into v_program from public.itua_programs p where p.is_test = v_actor.is_test and p.code = v_code;
      if v_program.id is null then
        raise exception 'ไม่พบโปรแกรม %', v_code using errcode = 'check_violation';
      end if;
      if jsonb_typeof(v_from_json) not in ('null', 'boolean') or jsonb_typeof(v_to_json) not in ('null', 'boolean') then
        raise exception '%: from และ to ต้องเป็น true หรือ false', v_label using errcode = 'check_violation';
      end if;
      v_from_flag := coalesce((v_from_json #>> '{}')::boolean, false);
      v_to_flag := coalesce((v_to_json #>> '{}')::boolean, false);
      v_note := private.itua_text_field(v_el -> 'note', 'หมายเหตุโปรแกรม', 500);
      v_key := 'program:' || v_code;
      if v_key = any (v_seen) then
        raise exception '% ซ้ำกันในรายการเดียวกัน', v_label using errcode = 'check_violation';
      end if;
      v_seen := v_seen || v_key;
      select true, g.note into v_cur_exists, v_cur_note from public.itua_program_grants g where g.user_id = v_user.id and g.program_id = v_program.id;
      v_cur_exists := coalesce(v_cur_exists, false);
      if v_cur_exists is distinct from v_from_flag then
        raise exception '%: สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
      end if;
      if v_el ? 'from_note' and v_cur_exists and private.itua_text_field(v_el -> 'from_note', 'หมายเหตุเดิม', 500) is distinct from v_cur_note then
        raise exception '%: หมายเหตุปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่', v_label using errcode = '40001';
      end if;
      if v_to_flag then
        if v_user.status <> 'active' then
          raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มหรือเปลี่ยนสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้อย่างเดียว)' using errcode = 'check_violation';
        end if;
        if not v_program.is_active and not v_cur_exists then
          raise exception '%: โปรแกรมปิดการใช้งานอยู่ เพิ่มสิทธิ์ไม่ได้ (ถอนสิทธิ์ได้)', v_label using errcode = 'check_violation';
        end if;
        if v_program.code = 'OTHER' and v_note is null and not (v_cur_exists and not (v_el ? 'note')) then
          raise exception '%: ต้องระบุหมายเหตุว่าเป็นโปรแกรมอะไร', v_label using errcode = 'check_violation';
        end if;
      end if;
      if v_from_flag = v_to_flag then
        -- true -> true ได้เฉพาะเมื่อแก้หมายเหตุ (ส่ง note ที่ต่างจากเดิม)
        if not v_to_flag or not (v_el ? 'note') or v_note is not distinct from v_cur_note then
          raise exception '%: สิทธิ์ใหม่เหมือนเดิม ไม่มีการเปลี่ยนแปลง', v_label using errcode = 'check_violation';
        end if;
        update public.itua_program_grants set note = v_note, updated_by = v_actor.id where user_id = v_user.id and program_id = v_program.id;
      elsif v_to_flag then
        insert into public.itua_program_grants (user_id, program_id, is_test, note, created_by, updated_by)
        values (v_user.id, v_program.id, v_user.is_test, v_note, v_actor.id, v_actor.id);
      else
        delete from public.itua_program_grants where user_id = v_user.id and program_id = v_program.id;
      end if;
      v_done := v_done || jsonb_build_array(jsonb_build_object('kind', 'program', 'code', v_code, 'from', to_jsonb(v_from_flag), 'to', to_jsonb(v_to_flag)));

    else
      raise exception 'รายการที่ %: kind ต้องเป็น folder, internet หรือ program', v_ord using errcode = 'check_violation';
    end if;
  end loop;

  -- ให้เวลาแก้ล่าสุดของผู้ใช้สะท้อนการเปลี่ยนสิทธิ์ทุกชนิด (ไม่ลง log เพราะค่าของแถวผู้ใช้ไม่เปลี่ยน)
  update public.itua_users set updated_by = v_actor.id where id = v_user.id;
  perform private.itua_end_change();
  return jsonb_build_object('user_id', v_user.id, 'applied', v_ord, 'changes', v_done);
end;
$$;

-- เพิ่มอีเมลให้ผู้ใช้ (เหตุผลไม่บังคับ) · p_kind = internal (อีเมลภายใน ใช้งานได้ 1 ต่อผู้ใช้) หรือ extra (อื่น ๆ ไม่จำกัด)
--   ที่อยู่ถูกตัดช่องว่างและแปลงเป็นตัวพิมพ์เล็ก · ที่อยู่ที่ใช้งานอยู่ซ้ำกับผู้ใช้อื่นไม่ได้ · ผู้ใช้ที่ลาออกแล้วเพิ่มไม่ได้ · คืน {email, created}
create or replace function public.app_itua_add_email(p_user_id uuid, p_address text, p_kind text default 'extra', p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_address text := lower(private.itua_clean(p_address));
  v_kind text := private.itua_clean(p_kind);
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_user public.itua_users%rowtype;
  v_id uuid := gen_random_uuid();
  v_row public.itua_emails%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_address is null or char_length(v_address) > 200 or v_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'รูปแบบอีเมลไม่ถูกต้อง' using errcode = 'check_violation';
  end if;
  if v_kind is null or v_kind not in ('internal', 'extra') then
    raise exception 'ชนิดอีเมลต้องเป็น ภายใน (internal) หรือ อื่น ๆ (extra)' using errcode = 'check_violation';
  end if;
  select * into v_user from public.itua_users u where u.id = p_user_id and u.is_test = v_actor.is_test for update;
  if v_user.id is null then
    raise exception 'ไม่พบผู้ใช้นี้' using errcode = 'check_violation';
  end if;
  if v_user.status <> 'active' then
    raise exception 'ผู้ใช้ที่ลาออกแล้วเพิ่มอีเมลไม่ได้' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.itua_emails m where m.is_test = v_actor.is_test and m.address = v_address and m.status = 'active') then
    raise exception 'อีเมล % มีผู้ใช้งานอยู่ในทะเบียนแล้ว', v_address using errcode = 'check_violation';
  end if;
  if v_kind = 'internal' and exists (select 1 from public.itua_emails m where m.user_id = v_user.id and m.kind = 'internal' and m.status = 'active') then
    raise exception 'ผู้ใช้นี้มีอีเมลภายในที่ใช้งานอยู่แล้ว (ปิดอันเดิมก่อนจึงเพิ่มใหม่ได้)' using errcode = 'check_violation';
  end if;
  perform private.itua_begin_change(v_actor.id, v_reason);
  begin
    insert into public.itua_emails (id, is_test, user_id, address, kind, created_by, updated_by)
    values (v_id, v_user.is_test, v_user.id, v_address, v_kind, v_actor.id, v_actor.id);
  exception when unique_violation then
    raise exception 'อีเมลซ้ำกับรายการที่มีอยู่ (หรือมีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่' using errcode = 'check_violation';
  end;
  perform private.itua_end_change();
  select * into v_row from public.itua_emails m where m.id = v_id;
  return jsonb_build_object('email', jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'address', v_row.address, 'kind', v_row.kind, 'status', v_row.status,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at), 'created', true);
end;
$$;

-- ปิดอีเมล (ไม่ลบ · ต้องมีเหตุผล) · ปิดแล้วเปิดใหม่ไม่ได้ (เพิ่มเป็นรายการใหม่) · คืน {email, changed} · ปิดอยู่แล้ว = changed false
create or replace function public.app_itua_close_email(p_email_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_row public.itua_emails%rowtype;
  v_changed boolean := false;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  select * into v_row from public.itua_emails m where m.id = p_email_id and m.is_test = v_actor.is_test for update;
  if v_row.id is null then
    raise exception 'ไม่พบอีเมลนี้' using errcode = 'check_violation';
  end if;
  if v_row.status = 'active' then
    if v_reason is null then
      raise exception 'กรุณาระบุเหตุผลที่ปิดอีเมล (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
    end if;
    perform private.itua_begin_change(v_actor.id, v_reason);
    update public.itua_emails set status = 'closed', updated_by = v_actor.id where id = v_row.id;
    perform private.itua_end_change();
    v_changed := true;
    select * into v_row from public.itua_emails m where m.id = p_email_id;
  end if;
  return jsonb_build_object('email', jsonb_build_object(
    'id', v_row.id, 'user_id', v_row.user_id, 'address', v_row.address, 'kind', v_row.kind, 'status', v_row.status,
    'created_at', v_row.created_at, 'updated_at', v_row.updated_at), 'changed', v_changed);
end;
$$;

-- เพิ่ม/แก้โฟลเดอร์ในรายการกลาง · ไม่มีรหัสนี้ในโหมดนี้ = เพิ่ม · มีแล้ว = แก้ (ส่งค่าทั้งหมด · ต้องมีเหตุผลเมื่อมีค่าเปลี่ยนจริง)
--   p_code: A–Z 0–9 _ - ขึ้นต้นด้วยตัวอักษร/ตัวเลข ยาว ≤30 (แก้ทีหลังไม่ได้) · p_name บังคับ ≤200 · p_description ≤1000 · p_sort 0–9999 · ลบไม่ได้ ใช้ p_is_active = false
--   ปิดใช้งานโฟลเดอร์ที่ยังมีผู้มีสิทธิ์อยู่ได้ (สิทธิ์เดิมยังอยู่ ถอนผ่าน set_grants) · คืน {id, code, created, changed}
create or replace function public.app_itua_save_folder(
  p_code text,
  p_name text,
  p_description text default null,
  p_sort integer default 100,
  p_is_active boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := upper(private.itua_clean(p_code));
  v_name text := private.itua_text_field(to_jsonb(p_name), 'ชื่อโฟลเดอร์', 200);
  v_description text := private.itua_text_field(to_jsonb(p_description), 'คำอธิบาย', 1000, true);
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_old public.itua_folders%rowtype;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' then
    raise exception 'รหัสโฟลเดอร์ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_/- ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 30 ตัว' using errcode = 'check_violation';
  end if;
  if v_name is null then
    raise exception 'กรุณาระบุชื่อโฟลเดอร์' using errcode = 'check_violation';
  end if;
  if p_sort is null or p_sort not between 0 and 9999 then
    raise exception 'ลำดับต้องเป็นจำนวนเต็ม 0–9999' using errcode = 'check_violation';
  end if;
  if p_is_active is null then
    raise exception 'กรุณาระบุสถานะการใช้งานของโฟลเดอร์' using errcode = 'check_violation';
  end if;
  select * into v_old from public.itua_folders f where f.is_test = v_actor.is_test and f.code = v_code for update;
  if v_old.id is null then
    perform private.itua_begin_change(v_actor.id, v_reason);
    begin
      insert into public.itua_folders (is_test, code, name, description, sort, is_active, created_by, updated_by)
      values (v_actor.is_test, v_code, v_name, v_description, p_sort, p_is_active, v_actor.id, v_actor.id)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'รหัสโฟลเดอร์ % ซ้ำ (มีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่', v_code using errcode = 'check_violation';
    end;
    perform private.itua_end_change();
    return jsonb_build_object('id', v_id, 'code', v_code, 'created', true, 'changed', true);
  end if;
  if (v_name, v_description, p_sort, p_is_active) is not distinct from (v_old.name, v_old.description, v_old.sort, v_old.is_active) then
    return jsonb_build_object('id', v_old.id, 'code', v_code, 'created', false, 'changed', false);
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่แก้รายการโฟลเดอร์ (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
  end if;
  perform private.itua_begin_change(v_actor.id, v_reason);
  update public.itua_folders
  set name = v_name, description = v_description, sort = p_sort, is_active = p_is_active, updated_by = v_actor.id
  where id = v_old.id;
  perform private.itua_end_change();
  return jsonb_build_object('id', v_old.id, 'code', v_code, 'created', false, 'changed', true);
end;
$$;

-- เพิ่ม/แก้โปรแกรมในรายการกลาง (กติกาเหมือน app_itua_save_folder แต่ไม่มีคำอธิบาย) · คืน {id, code, created, changed}
create or replace function public.app_itua_save_program(
  p_code text,
  p_name text,
  p_sort integer default 100,
  p_is_active boolean default true,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := upper(private.itua_clean(p_code));
  v_name text := private.itua_text_field(to_jsonb(p_name), 'ชื่อโปรแกรม', 200);
  v_reason text := private.itua_text_field(to_jsonb(p_reason), 'เหตุผล', 1000, true);
  v_old public.itua_programs%rowtype;
  v_id uuid;
begin
  perform private.lab_only_block();
  v_actor := private.itua_require_admin();
  if v_code is null or v_code !~ '^[A-Z0-9][A-Z0-9_-]{0,29}$' then
    raise exception 'รหัสโปรแกรมต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_/- ขึ้นต้นด้วยตัวอักษรหรือตัวเลข ยาวไม่เกิน 30 ตัว' using errcode = 'check_violation';
  end if;
  if v_name is null then
    raise exception 'กรุณาระบุชื่อโปรแกรม' using errcode = 'check_violation';
  end if;
  if p_sort is null or p_sort not between 0 and 9999 then
    raise exception 'ลำดับต้องเป็นจำนวนเต็ม 0–9999' using errcode = 'check_violation';
  end if;
  if p_is_active is null then
    raise exception 'กรุณาระบุสถานะการใช้งานของโปรแกรม' using errcode = 'check_violation';
  end if;
  select * into v_old from public.itua_programs p where p.is_test = v_actor.is_test and p.code = v_code for update;
  if v_old.id is null then
    perform private.itua_begin_change(v_actor.id, v_reason);
    begin
      insert into public.itua_programs (is_test, code, name, sort, is_active, created_by, updated_by)
      values (v_actor.is_test, v_code, v_name, p_sort, p_is_active, v_actor.id, v_actor.id)
      returning id into v_id;
    exception when unique_violation then
      raise exception 'รหัสโปรแกรม % ซ้ำ (มีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่', v_code using errcode = 'check_violation';
    end;
    perform private.itua_end_change();
    return jsonb_build_object('id', v_id, 'code', v_code, 'created', true, 'changed', true);
  end if;
  if (v_name, p_sort, p_is_active) is not distinct from (v_old.name, v_old.sort, v_old.is_active) then
    return jsonb_build_object('id', v_old.id, 'code', v_code, 'created', false, 'changed', false);
  end if;
  if v_reason is null then
    raise exception 'กรุณาระบุเหตุผลที่แก้รายการโปรแกรม (บันทึกสำหรับ ISO)' using errcode = 'check_violation';
  end if;
  perform private.itua_begin_change(v_actor.id, v_reason);
  update public.itua_programs set name = v_name, sort = p_sort, is_active = p_is_active, updated_by = v_actor.id where id = v_old.id;
  perform private.itua_end_change();
  return jsonb_build_object('id', v_old.id, 'code', v_code, 'created', false, 'changed', true);
end;
$$;

-- 9. ล้างข้อมูลทดสอบ -----------------------------------------------------------------------
-- ลบเฉพาะแถว is_test ของทะเบียนสิทธิ์ผู้ใช้ทั้งหมด (ลูกก่อนแม่) แล้ว seed โปรแกรมตั้งต้นของโหมดทดสอบกลับ (รายการที่ลองแก้/เพิ่มในโหมดทดสอบหายไป)
--   ตั้ง itua.purge = on (transaction-local) ให้ trigger ยอมลบเฉพาะแถวทดสอบและไม่ลง log · แถวจริงลบไม่ได้เลย · เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (เหมือน app_sandbox_purge_itas)
create or replace function public.app_sandbox_purge_itua()
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
  v_claim_sub text;
  v_claims text;
begin
  perform private.lab_only_block();
  v_admin := private.sandbox_admin();
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'SANDBOX_NOT_ACTIVE';
  end if;

  -- ล็อกตารางเขียนของโมดูลไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นแก้ข้อมูลทดสอบพร้อมกันระหว่างล้าง
  lock table public.itua_users, public.itua_emails, public.itua_folders, public.itua_folder_grants, public.itua_programs,
             public.itua_program_grants, public.itua_log, public.itua_acknowledgements in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itua.purge', 'on', true);

  -- ลูกก่อนแม่: ประวัติ -> รับทราบ -> สิทธิ์ -> อีเมล -> ผู้ใช้ -> รายการกลาง
  foreach v_table in array array['itua_log', 'itua_acknowledgements', 'itua_program_grants', 'itua_folder_grants', 'itua_emails', 'itua_users', 'itua_folders', 'itua_programs'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
  perform private.itua_seed_programs(true);

  perform set_config('itua.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITUA_SANDBOX_PURGE', 'itua_users', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- 10. สิทธิ์เรียกฟังก์ชัน (รันซ้ำทั้งชุดได้ ผลเดียวกัน) -----------------------------------------
-- private.itua_*: ถอนจาก public/anon/authenticated ทั้งหมด (เรียกจาก RPC ที่ SECURITY DEFINER และ trigger เท่านั้น)
-- public.app_itua_* และ app_sandbox_purge_itua: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจ itas_admins ซ้ำอีกชั้น) anon เรียกไม่ได้
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'itua\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itua\_%' or p.proname = 'app_sandbox_purge_itua')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
