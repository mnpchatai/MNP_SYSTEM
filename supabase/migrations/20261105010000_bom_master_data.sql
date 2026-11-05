-- ============================================================================
-- ข้อมูลหลักของโมดูล BOM รายแผนก (โหมดทดสอบ) ย้ายจาก localStorage ของเบราว์เซอร์ (modules/bom-store.js state v6) เข้า Supabase
--
-- ขอบเขตรอบนี้ (PR 1 จาก 2: ฐานข้อมูลของข้อมูลหลักอย่างเดียว)
--   ข้อมูลหลัก: item master, สูตรยาง (compounds), สี, ชุดสี, แพ็กเกจ, BOM (revision + บรรทัด), ขั้นตอนผลิตมาตรฐาน, routing
--   PR 2 (ยังไม่ทำ ไม่มีตารางในไฟล์นี้): ใบสั่งผลิต/PI, งานรายแผนก, นับคงคลัง
--   เริ่มจากว่าง ไม่ย้ายข้อมูลจากเบราว์เซอร์ ผู้ใช้นำเข้าไฟล์ Excel ใหม่ผ่านหน้านำเข้าเดิม
--
-- RPC (2 ตัว สัญญากับ Pilot Web)
--   public.app_bom_master()                                  -> snapshot ทั้งชุด { version, items, compounds, colors, colorSets,
--                                                               packages, boms, processes, routings } รูปแบบเดียวกับ state v6 (camelCase)
--   public.app_bom_save_master(p_changes, p_base_version, p_action) -> บันทึกชุดการเปลี่ยนแปลงในธุรกรรมเดียว คืน snapshot ใหม่
--     p_changes = { "<section>": { "upsert": [เรคอร์ดเต็ม], "delete": [{base, code}] (เฉพาะ colorSets/packages) } } ทุกส่วนเป็น optional
--     BOM_STALE เมื่อ p_base_version ไม่ตรง version ปัจจุบัน (ล็อกแถวตัวนับ for update ก่อนเทียบ)
--
-- เปิดเฉพาะโหมดทดสอบ (admin ที่ทำหน้าที่เป็น persona) เหมือนใบตรวจ QC (20261027010000_qc_inspection_reports.sql) ทุกประการ
--   ทุก RPC ปฏิเสธนอกโหมดทดสอบด้วย BOM_TEST_MODE_ONLY (private.bom_actor) เมื่อจะเปิดใช้จริงต้องเปลี่ยน bom_actor ให้คืนพนักงานจริง
--   และเพิ่มเทสต์อนุญาต/ปฏิเสธของบทบาทจริง ในโหมดทดสอบสิทธิ์ตัดสินจากบทบาทของ persona
--     - อ่าน : persona ทุกตัวที่ admin ใช้อยู่ (ตัวตนมาจาก private.sandbox_persona() เท่านั้น)
--     - เขียน (private.bom_can_edit) : แผนก PP (ฝ่ายวางแผน ทุกบทบาท; module เรียก PL) หรือบทบาท department_manager,
--       assistant_factory_manager, factory_manager, general_manager, admin (ใช้ private.employee_role_code)
--       assistant_department_manager (ผู้ช่วยผู้จัดการแผนก) ไม่อยู่ในรายการ ตรงกับรายการที่ผู้ใช้ระบุ
--     ที่เหลือได้ BOM_FORBIDDEN ตัวบังคับจริงคือ RPC ฝั่งฐานข้อมูล หน้าเว็บซ่อนปุ่มอย่างเดียว
--
-- แผนก: เก็บและคืนรหัสจริงของ public.departments (PP, QA, PK, GR, RB, PT, BG, ST, SR, WH, SA ...) ที่ client ใช้ PL/QC ในโมดูล
--   รับเป็นนามแฝงตอนเขียน (PL -> PP, QC -> QA) แล้วเก็บเป็นรหัสจริง ตรวจว่ามีอยู่จริงใน public.departments (BOM_INVALID_DEPT)
--
-- กติกา BOM ที่ฐานข้อมูลบังคับ (พอร์ตจาก modules/bom-rules.js และ bom-actions.js saveBom/normalizeLines)
--   - ลูกต้องมีอยู่ (ในฐานข้อมูลหรืออยู่ในคำสั่งเดียวกัน) ปริมาณ > 0 % เผื่อเสีย >= 0 ขั้นที่ว่างหรือจำนวนเต็ม 1-20 ลูกซ้ำในบรรทัดเดียวกันไม่ได้
--   - ชนิดลูก (rules.childKindError): ของซื้อ (PURCHASED) และสูตรยาง (CP) เป็นพ่อไม่ได้, เส้นยาง (RB) มีลูกได้เฉพาะ CP และ CP อยู่ได้เฉพาะใต้ RB
--     เส้นยางมีบรรทัด CP ได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
--   - ไม่มีวงจร (recursive CTE บน BOM ที่ approved หลังเขียน เพดานความลึก 30 ชั้น)
--   - revision เปลี่ยนแปลงไม่ได้ (immutable): เรคอร์ดที่ id มีอยู่แล้วเปลี่ยนได้เฉพาะ status approved -> superseded (supersededAt ตั้งโดยเซิร์ฟเวอร์),
--     แผนกเจ้าของ (client ย้ายแผนกเจ้าของของชิ้นแล้วแก้ ownerDept ของ BOM ทุก revision) และ changeLog ต่อท้ายเท่านั้น
--   - revision ใหม่ต้องเป็น (revision สูงสุดของชิ้นนั้น) + 1 และเป็น approved เสมอ ไม่มีขั้นอนุมัติ ตัวเดิมที่ approved ถูกเซิร์ฟเวอร์ตั้ง superseded
--     ในคำสั่งเดียวกัน (client ส่งเรคอร์ดเก่าที่ superseded มาด้วยก็ได้) ดัชนี unique บางส่วนกันมี approved สองตัวต่อชิ้น
--   - เวลา/ผู้สร้าง/ผู้อนุมัติ ตั้งโดยเซิร์ฟเวอร์ (ไม่เชื่อ createdAt/createdBy จาก client) ชื่อผู้ทำใน changeLog ที่เพิ่มใหม่ใช้ persona ปัจจุบัน
--
-- รหัสข้อผิดพลาด (raise exception ข้อความตายตัว)
--   BOM_TEST_MODE_ONLY BOM_FORBIDDEN BOM_STALE BOM_INVALID_PAYLOAD BOM_INVALID_ACTION BOM_TOO_MANY BOM_TOO_LARGE BOM_CONFLICT BOM_INVALID_DATA
--   BOM_INVALID_ITEM BOM_INVALID_RUBBER BOM_INVALID_IMAGE BOM_INVALID_DEPT BOM_INVALID_COMPOUND BOM_INVALID_COLOR BOM_INVALID_COLOR_SET
--   BOM_INVALID_PACKAGE BOM_INVALID_PROCESS BOM_INVALID_BOM BOM_INVALID_LINE BOM_INVALID_ROUTING BOM_ITEM_NOT_FOUND BOM_CHILD_NOT_FOUND
--   BOM_NOT_FOUND BOM_ITEM_KIND_LOCKED BOM_INVALID_PARENT_KIND BOM_INVALID_CHILD_KIND BOM_RB_ONE_COMPOUND BOM_RB_COMPOUND_MISMATCH
--   BOM_CYCLE BOM_TOO_DEEP BOM_REVISION_IMMUTABLE BOM_REVISION_ORDER
--
-- รูป item (image) เก็บเป็น data URL <= 80,000 ตัวอักษรในคอลัมน์ text ชั่วคราวเหมือนที่ client ทำ (เพดานรวม 4,000,000 ตัวอักษรต่อคำสั่ง)
--   การใช้งานจริงต้องย้ายไป Supabase Storage แบบ private (bucket private + signed URL) ก่อนเปิดกับข้อมูลจริง
--
-- การแยกข้อมูลทดสอบ (ตามกติกาของโหมดทดสอบใน README) เหมือน QC
--   ทุกตารางมี is_test ที่ trigger private.sandbox_row_scope กำหนดจากโหมดของผู้ทำรายการ (ไม่รับจาก client) และห้ามแก้/ลบข้ามโหมด
--   foreign key ลูกเป็นแบบคู่ (code หรือ id, is_test) ตารางลงทะเบียนใน private.sandbox_unguarded_tables() และ lab-only
--   (private.lab_only_guard_table) ทุก RPC ใน public ขึ้นต้นด้วย private.lab_only_block()
--
-- สิทธิ์: ทุกตารางปิด RLS แบบ deny-all และถอนสิทธิ์ anon/authenticated ทั้งหมด อ่าน/เขียนผ่าน RPC security definer (search_path ว่าง)
--   RPC execute ให้ authenticated เท่านั้น ถอนจาก public/anon ตัวช่วย private ถอนจากทุกบทบาท
--   audit_logs: 1 แถวต่อการบันทึก (action BOM_MASTER_SAVE) เก็บชื่อ action ของ client กับจำนวนต่อส่วน ไม่เก็บ payload
--   ผู้กระทำคือ admin ตัวจริงเบื้องหลัง persona (private.bom_audit_actor_id)
--
-- นิยามที่ replace ในไฟล์นี้ (เริ่มจากนิยามล่าสุดของแต่ละตัว)
--   - private.sandbox_unguarded_tables(): จาก 20261031010000_remove_factory_module.sql เพิ่มเฉพาะ bom_*
--
-- ก่อน apply / ลำดับ deploy: Pilot Web ใน PR เดียวกับไฟล์นี้ (modules/module-bom.js) เรียก app_bom_master / app_bom_save_master แล้ว
--   จึงต้อง apply ไฟล์นี้ที่ production (ด้วยการอนุมัติของผู้ใช้) ก่อน merge PR นี้ ตาม "Deployment order" ใน AGENTS.md
--   ถ้า merge ก่อน หน้า #/bom ในโหมดทดสอบจะขึ้น "ฐานข้อมูลยังไม่มีระบบ BOM" จนกว่าจะ apply · ก่อน apply ให้เทียบ md5(pg_get_functiondef(oid)) ของ private.sandbox_unguarded_tables ที่ production
--   กับนิยามใน 20261031010000_remove_factory_module.sql (ถ้ามี migration อื่นแก้ไปแล้ว ต้องเริ่มจากนิยามล่าสุด)
--
-- Rollback (ตาราง bom_* มีแต่ข้อมูลทดสอบ):
--   drop function public.app_bom_master(), public.app_bom_save_master(jsonb, bigint, text);
--   drop function private.bom_actor(), bom_audit_actor_id(), bom_can_edit(public.employees), bom_client_actions(), bom_uoms(),
--   bom_code(text), bom_dept(text), bom_text(jsonb, text, integer, integer, text), bom_num(jsonb, text, numeric, numeric), bom_ms(timestamptz),
--   bom_person(uuid), bom_parse_lines(text, text, jsonb), bom_lines_json(uuid), bom_log(jsonb, jsonb, text), bom_parse_steps(jsonb),
--   bom_save_compounds(uuid, jsonb), bom_save_colors(uuid, jsonb), bom_save_processes(uuid, jsonb), bom_save_items(uuid, jsonb),
--   bom_save_color_sets(uuid, jsonb), bom_save_packages(uuid, jsonb), bom_save_boms(uuid, text, jsonb), bom_save_routings(uuid, jsonb),
--   bom_snapshot();
--   drop table bom_bom_lines, bom_routings, bom_boms, bom_packages, bom_color_sets, bom_colors, bom_processes, bom_compounds,
--   bom_items, bom_master_state (ลูกก่อนแม่);
--   แล้ว create or replace private.sandbox_unguarded_tables ด้วยนิยามเดิมจาก 20261031010000_remove_factory_module.sql
-- ============================================================================

-- 1. ตาราง (แยกโหมดด้วย is_test) ----------------------------------------------------------
-- ตัวนับเวอร์ชันของข้อมูลหลักทั้งชุด (1 แถวต่อโหมด) เพิ่มทุกครั้งที่บันทึกสำเร็จ ใช้กันบันทึกทับ (BOM_STALE)
create table public.bom_master_state (
  is_test boolean primary key default false,
  version bigint not null default 0 check (version >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.employees(id) on delete set null
);
comment on table public.bom_master_state is 'ตัวนับเวอร์ชันข้อมูลหลัก BOM (1 แถวต่อโหมด) เพิ่มทุกครั้งที่ app_bom_save_master สำเร็จ';
comment on column public.bom_master_state.is_test is 'แถวโหมดทดสอบ: trigger กำหนดจากโหมดผู้ทำรายการ ไม่รับจาก client';

create table public.bom_items (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (char_length(code) between 1 and 60),
  kind text not null check (kind in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP')),
  name text not null check (char_length(name) between 1 and 160),
  owner_dept text not null references public.departments(code),
  uom text not null check (uom in ('pcs', 'set', 'box', 'roll', 'rod', 'ball', 'pack', 'bucket', 'sheet', 'kg', 'g', 'm', 'yd', 'cm', 'other')),
  weight_g numeric not null default 0 check (weight_g >= 0 and weight_g <= 1000000000),
  -- ข้อมูลยางของ RB/SE (compound, type, color, product, lengthMm, holeMm, odMm, kgPerRoll, cutLengthCm, pcsPerRoll, sePerGr) ตรวจใน RPC
  rubber jsonb check (rubber is null or (jsonb_typeof(rubber) = 'object' and kind in ('RB', 'SE'))),
  legacy_codes jsonb not null default '[]'::jsonb
    check (jsonb_typeof(legacy_codes) = 'array' and jsonb_array_length(legacy_codes) <= 200),
  active boolean not null default true,
  item_group text not null default 'TOY' check (char_length(item_group) between 1 and 20),
  unit_cost numeric check (unit_cost is null or (unit_cost >= 0 and unit_cost <= 1000000000)),
  -- data URL ชั่วคราว (ดูหัวไฟล์) ย้ายไป Storage private ก่อนใช้จริง
  image text check (image is null or (char_length(image) <= 80000 and image ~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$')),
  imported_from text check (imported_from is null or char_length(imported_from) <= 200),
  cloned_from text check (cloned_from is null or char_length(cloned_from) <= 200),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (code, is_test)
);
create index bom_items_kind_idx on public.bom_items (is_test, kind);
comment on table public.bom_items is 'item master ของโมดูล BOM (1 แถว = 1 รหัสชิ้นงาน canonical)';

create table public.bom_compounds (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (char_length(code) between 1 and 20),
  name text not null check (char_length(name) between 1 and 120),
  recipe_id text check (recipe_id is null or char_length(recipe_id) between 1 and 60),
  recipe_name text check (recipe_name is null or char_length(recipe_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (code, is_test)
);
comment on table public.bom_compounds is 'รายการสูตรยาง (คอมปาวด์) และการผูกกับสูตร PHR ใน RubberFlow (recipe_id)';

create table public.bom_colors (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z]{2}[0-9]{2}$'),
  name text not null check (char_length(name) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (code, is_test)
);
comment on table public.bom_colors is 'สี = แม่สี 2 ตัวอักษร + เฉด 2 หลัก (OR01)';

create table public.bom_color_sets (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  base text not null check (char_length(base) between 1 and 60),
  code text not null check (code ~ '^[A-Z]$'),
  name text not null default '' check (char_length(name) <= 60),
  note text not null default '' check (char_length(note) <= 300),
  -- [{key, color}] กุญแจ = รหัส SE/RB ถอดสี ซ้ำกุญแจได้ (ลูกบอลสามสี)
  slots jsonb not null check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) between 1 and 50),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (base, code, is_test)
);
comment on table public.bom_color_sets is 'ชุดสีของฐานรหัสสินค้า (รหัสชุด A-Z + สีของแต่ละช่อง)';

create table public.bom_packages (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  base text not null check (char_length(base) between 1 and 60),
  code text not null check (code ~ '^[A-Z0-9-]{1,4}$'),
  name text not null default '' check (char_length(name) <= 60),
  -- [{childCode, qty}] ลูกเป็นของซื้อ (PURCHASED) เท่านั้น ตรวจใน RPC
  lines jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 100),
  created_by uuid references public.employees(id) on delete set null,
  updated_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (base, code, is_test)
);
comment on table public.bom_packages is 'แพ็กเกจ (บรรจุภัณฑ์) ของฐานรหัสสินค้า ใช้แทนบรรทัดบรรจุภัณฑ์ของต้นแบบตอนสร้างรุ่นใหม่';

create table public.bom_boms (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  -- id ของ client เช่น BOM-69-0001 (ออกที่ client ฐานข้อมูลเก็บตามที่ส่งมา)
  bom_id text not null check (bom_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  item_code text not null,
  revision integer not null check (revision >= 1),
  status text not null check (status in ('approved', 'superseded')),
  owner_dept text not null references public.departments(code),
  note text not null default '' check (char_length(note) <= 300),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  approved_by uuid references public.employees(id) on delete set null,
  approved_at timestamptz,
  superseded_at timestamptz,
  -- [{at, by, text}] ต่อท้ายเท่านั้น
  change_log jsonb not null default '[]'::jsonb
    check (jsonb_typeof(change_log) = 'array' and jsonb_array_length(change_log) <= 200),
  foreign key (item_code, is_test) references public.bom_items(code, is_test),
  unique (id, is_test),
  unique (bom_id, is_test),
  unique (item_code, is_test, revision)
);
-- ชิ้นหนึ่งมี BOM ที่ approved ได้ตัวเดียว (ตัวเก่าต้อง superseded ก่อน)
create unique index bom_boms_one_approved_idx on public.bom_boms (item_code, is_test) where status = 'approved';
comment on table public.bom_boms is '1 แถว = 1 revision ของ BOM (ไม่มีขั้นอนุมัติ: บันทึกแล้ว approved ทันที) revision เปลี่ยนแปลงไม่ได้ ยกเว้นเปลี่ยนเป็น superseded';

create table public.bom_bom_lines (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  bom_pk uuid not null,
  -- ลำดับบรรทัดตามที่บันทึก (0..)
  line_no integer not null check (line_no >= 0),
  step integer check (step is null or step between 1 and 20),
  child_code text not null,
  qty numeric not null check (qty > 0 and qty <= 1000000000),
  uom text not null check (uom in ('pcs', 'set', 'box', 'roll', 'rod', 'ball', 'pack', 'bucket', 'sheet', 'kg', 'g', 'm', 'yd', 'cm', 'other')),
  consumer_dept text not null references public.departments(code),
  producer_dept text not null references public.departments(code),
  scrap_pct numeric not null default 0 check (scrap_pct >= 0 and scrap_pct <= 1000),
  flags jsonb not null default '[]'::jsonb check (jsonb_typeof(flags) = 'array' and jsonb_array_length(flags) <= 20),
  note text not null default '' check (char_length(note) <= 200),
  foreign key (bom_pk, is_test) references public.bom_boms(id, is_test) on delete cascade,
  foreign key (child_code, is_test) references public.bom_items(code, is_test),
  unique (id, is_test),
  unique (bom_pk, line_no),
  unique (bom_pk, child_code)
);
create index bom_bom_lines_child_idx on public.bom_bom_lines (is_test, child_code);
comment on table public.bom_bom_lines is 'บรรทัด BOM (แยกตารางไว้ตรวจวงจรและ where-used) ลำดับตาม line_no';

create table public.bom_processes (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  code text not null check (char_length(code) between 1 and 60),
  name text not null check (char_length(name) between 1 and 80),
  dept text not null references public.departments(code),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, is_test),
  unique (code, is_test)
);
comment on table public.bom_processes is 'ขั้นตอนผลิตมาตรฐาน (process master) ที่ผู้ใช้เพิ่ม ขั้นตอนเริ่มต้นอยู่ใน modules/bom-rules.js';

create table public.bom_routings (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  routing_id text not null check (routing_id ~ '^[A-Za-z0-9._-]{1,40}$'),
  item_code text not null,
  revision integer not null check (revision >= 1),
  status text not null check (status in ('approved', 'superseded')),
  -- [{processCode, minutesPerPc, note, inputs[childCodes]}] ตรวจใน RPC (ไม่เกิน 20 ขั้น)
  steps jsonb not null check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 20),
  created_by uuid references public.employees(id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz,
  foreign key (item_code, is_test) references public.bom_items(code, is_test),
  unique (id, is_test),
  unique (routing_id, is_test),
  unique (item_code, is_test, revision)
);
create unique index bom_routings_one_approved_idx on public.bom_routings (item_code, is_test) where status = 'approved';
comment on table public.bom_routings is 'ขั้นตอนผลิตต่อชิ้นงาน เก็บเป็น revision เหมือน BOM (ตัวเก่า superseded)';

-- ตัวนับเวอร์ชันเริ่มต้นของโหมดทดสอบ (migration ไม่มี auth.uid() trigger จึงไม่ทับ is_test)
insert into public.bom_master_state (is_test, version) values (true, 0);

-- 2. แยกโหมด: is_test มาจากโหมดของผู้ทำรายการ ห้ามแก้/ลบข้ามโหมด -----------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bom_master_state', 'bom_items', 'bom_compounds', 'bom_colors', 'bom_color_sets', 'bom_packages',
    'bom_boms', 'bom_bom_lines', 'bom_processes', 'bom_routings'
  ] loop
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      'for each row execute function private.sandbox_row_scope()', v_table || '_sandbox_scope', v_table);
  end loop;
end $$;

-- 3. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น ----------------------------
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'bom_master_state', 'bom_items', 'bom_compounds', 'bom_colors', 'bom_color_sets', 'bom_packages',
    'bom_boms', 'bom_bom_lines', 'bom_processes', 'bom_routings'
  ] loop
    execute format('revoke all on public.%I from anon, authenticated', v_table);
    execute format('alter table public.%I enable row level security', v_table);
    execute format('create policy %I on public.%I for all to authenticated using (false) with check (false)',
                   v_table || '_no_direct_access', v_table);
  end loop;
end $$;

-- บัญชี lab-only (MNPLAB001/002) ต้องมองไม่เห็นตารางของโมดูลนี้ (policy restrictive lab_only_no_access)
select private.lab_only_guard_table('public.bom_master_state');
select private.lab_only_guard_table('public.bom_items');
select private.lab_only_guard_table('public.bom_compounds');
select private.lab_only_guard_table('public.bom_colors');
select private.lab_only_guard_table('public.bom_color_sets');
select private.lab_only_guard_table('public.bom_packages');
select private.lab_only_guard_table('public.bom_boms');
select private.lab_only_guard_table('public.bom_bom_lines');
select private.lab_only_guard_table('public.bom_processes');
select private.lab_only_guard_table('public.bom_routings');

-- ตารางใหม่รู้จักโหมดทดสอบแล้ว (นิยามจาก 20261031010000_remove_factory_module.sql ทุกชื่อ แล้วเพิ่ม bom_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql immutable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings']
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 4. ฟังก์ชันช่วย (private) -----------------------------------------------------------------
-- ผู้ทำรายการ: เปิดเฉพาะโหมดทดสอบ (เหมือน private.qc_actor)
create or replace function private.bom_actor()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_persona public.employees%rowtype;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- sandbox_persona ตรวจทุกครั้งว่ายังเป็น admin ที่ active และอยู่ในโหมดทดสอบจริง
  v_persona := private.sandbox_persona();
  if v_persona.id is null then
    raise exception 'BOM_TEST_MODE_ONLY';
  end if;
  return v_persona;
end;
$$;
revoke all on function private.bom_actor() from public, anon, authenticated;

-- ผู้กระทำใน audit_logs: admin ตัวจริงเบื้องหลัง persona (ถ้าไม่ได้อยู่ในโหมดทดสอบ = พนักงานของ session)
create or replace function private.bom_audit_actor_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select s.admin_employee_id from public.sandbox_sessions s where s.admin_auth_user_id = auth.uid()),
    private.current_employee_id()
  )
$$;
revoke all on function private.bom_audit_actor_id() from public, anon, authenticated;

-- แก้ข้อมูลหลักได้: แผนก PP ทุกบทบาท หรือบทบาท department_manager / assistant_factory_manager / factory_manager / general_manager / admin
create or replace function private.bom_can_edit(p_employee public.employees)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(exists (
           select 1 from public.departments d where d.id = p_employee.department_id and d.code = 'PP'), false)
      or coalesce(private.employee_role_code(p_employee.id) in
           ('department_manager', 'assistant_factory_manager', 'factory_manager', 'general_manager', 'admin'), false)
$$;
revoke all on function private.bom_can_edit(public.employees) from public, anon, authenticated;

-- ชื่อ action ของ client (modules/bom-actions.js api) ที่เขียนข้อมูลหลักได้ ใช้ตรวจ p_action
create or replace function private.bom_client_actions()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['saveItem', 'saveBom', 'saveBomTree', 'linkCompound', 'importFlat',
    'saveColor', 'saveColorSet', 'removeColorSet', 'learnColorSet', 'savePackage', 'removePackage', 'createVariant',
    'saveRouting', 'saveProcess', 'setItemCost', 'setItemImage',
    -- ใบสั่งผลิตยังอยู่ในเบราว์เซอร์ (PR 2) แต่การเพิ่มสินค้าที่ยังไม่มีรุ่นนี้สร้างชิ้นงาน + BOM ใหม่จากต้นแบบ (cloneFg)
    'createOrder', 'addOrderItem']
$$;
revoke all on function private.bom_client_actions() from public, anon, authenticated;

-- หน่วยนับมาตรฐาน (rules.UOMS) ต้องตรงกับ check ของ bom_items.uom
create or replace function private.bom_uoms()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array['pcs', 'set', 'box', 'roll', 'rod', 'ball', 'pack', 'bucket', 'sheet', 'kg', 'g', 'm', 'yd', 'cm', 'other']
$$;
revoke all on function private.bom_uoms() from public, anon, authenticated;

-- รหัส canonical (rules.canonicalCode): ตัดช่องว่าง ยุบขีดซ้ำ ตัวพิมพ์ใหญ่
create or replace function private.bom_code(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select upper(regexp_replace(regexp_replace(coalesce(p_text, ''), '\s+', '', 'g'), '-{2,}', '-', 'g'))
$$;
revoke all on function private.bom_code(text) from public, anon, authenticated;

-- รหัสแผนก: รับนามแฝงของ client (PL -> PP, QC -> QA) แล้วต้องมีอยู่จริงใน public.departments
create or replace function private.bom_dept(p_code text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  v_code := case v_code when 'PL' then 'PP' when 'QC' then 'QA' else v_code end;
  if v_code = '' or not exists (select 1 from public.departments d where d.code = v_code) then
    raise exception 'BOM_INVALID_DEPT';
  end if;
  return v_code;
end;
$$;
revoke all on function private.bom_dept(text) from public, anon, authenticated;

-- อ่านข้อความจาก payload: ไม่มี/null = '' ไม่ใช่ข้อความหรือความยาวนอกช่วง = raise p_error (ไม่เชื่อ client)
create or replace function private.bom_text(p_obj jsonb, p_key text, p_max integer, p_min integer, p_error text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_node jsonb := p_obj -> p_key;
  v_text text;
begin
  if v_node is null or jsonb_typeof(v_node) = 'null' then
    v_text := '';
  elsif jsonb_typeof(v_node) <> 'string' then
    raise exception '%', p_error;
  else
    v_text := btrim(v_node #>> '{}');
  end if;
  if char_length(v_text) < p_min or char_length(v_text) > p_max then
    raise exception '%', p_error;
  end if;
  return v_text;
end;
$$;
revoke all on function private.bom_text(jsonb, text, integer, integer, text) from public, anon, authenticated;

-- อ่านตัวเลขจาก payload: ไม่มี/null = null ต้องเป็น JSON number อยู่ในช่วง [p_min, p_max] (JSON ไม่มี NaN/Infinity)
create or replace function private.bom_num(p_node jsonb, p_error text, p_min numeric, p_max numeric)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_num numeric;
begin
  if p_node is null or jsonb_typeof(p_node) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_node) <> 'number' then
    raise exception '%', p_error;
  end if;
  v_num := (p_node #>> '{}')::numeric;
  if v_num < p_min or v_num > p_max then
    raise exception '%', p_error;
  end if;
  return v_num;
end;
$$;
revoke all on function private.bom_num(jsonb, text, numeric, numeric) from public, anon, authenticated;

-- เวลาเป็นมิลลิวินาทีแบบ Date.now() ที่ client ใช้
create or replace function private.bom_ms(p_ts timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_ts is null then null else (extract(epoch from p_ts) * 1000)::bigint end
$$;
revoke all on function private.bom_ms(timestamptz) from public, anon, authenticated;

-- ชื่อที่แสดงของพนักงาน (createdBy / approvedBy / by ใน client เป็นชื่อ)
create or replace function private.bom_person(p_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.first_name || ' ' || e.last_name from public.employees e where e.id = p_id
$$;
revoke all on function private.bom_person(uuid) from public, anon, authenticated;

-- ตรวจและแปลงบรรทัด BOM ของพ่อหนึ่งตัวเป็นรูป canonical (ลำดับตามที่ส่งมา) ลูกต้องมีใน bom_items (รวมที่เพิ่งเขียนในคำสั่งเดียวกัน)
create or replace function private.bom_parse_lines(p_parent_code text, p_parent_dept text, p_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_line jsonb;
  v_seen text[] := '{}';
  v_child public.bom_items%rowtype;
  v_code text;
  v_qty numeric;
  v_scrap numeric;
  v_step numeric;
  v_uom text;
  v_consumer text;
  v_producer text;
  v_flags jsonb;
  v_flag jsonb;
  v_entry jsonb;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) not between 1 and 500 then
    raise exception 'BOM_INVALID_LINE';
  end if;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'BOM_INVALID_LINE'; end if;
    v_code := private.bom_code(private.bom_text(v_line, 'childCode', 60, 1, 'BOM_INVALID_LINE'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_LINE'; end if;
    v_seen := v_seen || v_code;
    select * into v_child from public.bom_items i where i.is_test and i.code = v_code;
    if not found then raise exception 'BOM_CHILD_NOT_FOUND'; end if;

    v_qty := private.bom_num(v_line -> 'qty', 'BOM_INVALID_LINE', 0, 1000000000);
    if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_LINE'; end if;
    v_scrap := coalesce(private.bom_num(v_line -> 'scrapPct', 'BOM_INVALID_LINE', 0, 1000), 0);
    v_step := private.bom_num(v_line -> 'step', 'BOM_INVALID_LINE', 1, 20);
    if v_step is not null and v_step <> trunc(v_step) then raise exception 'BOM_INVALID_LINE'; end if;

    v_uom := coalesce(nullif(private.bom_text(v_line, 'uom', 20, 0, 'BOM_INVALID_LINE'), ''), v_child.uom);
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_LINE'; end if;
    v_consumer := private.bom_dept(coalesce(nullif(private.bom_text(v_line, 'consumerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), p_parent_dept));
    v_producer := private.bom_dept(coalesce(nullif(private.bom_text(v_line, 'producerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), v_child.owner_dept));

    v_flags := v_line -> 'flags';
    if v_flags is null or jsonb_typeof(v_flags) = 'null' then v_flags := '[]'::jsonb; end if;
    if jsonb_typeof(v_flags) <> 'array' or jsonb_array_length(v_flags) > 20 then raise exception 'BOM_INVALID_LINE'; end if;
    for v_flag in select value from jsonb_array_elements(v_flags) loop
      if jsonb_typeof(v_flag) <> 'string' or char_length(v_flag #>> '{}') > 60 then raise exception 'BOM_INVALID_LINE'; end if;
    end loop;

    v_entry := jsonb_build_object(
      'childCode', v_code, 'qty', v_qty, 'uom', v_uom, 'consumerDept', v_consumer, 'producerDept', v_producer,
      'scrapPct', v_scrap, 'flags', v_flags, 'note', private.bom_text(v_line, 'note', 200, 0, 'BOM_INVALID_LINE'));
    if v_step is not null then
      v_entry := v_entry || jsonb_build_object('step', v_step::integer);
    end if;
    v_out := v_out || jsonb_build_array(v_entry);
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_lines(text, text, jsonb) from public, anon, authenticated;

-- บรรทัดที่เก็บไว้ของ BOM หนึ่ง revision ในรูป canonical เดียวกับ bom_parse_lines (เรียงตามที่บันทึก)
create or replace function private.bom_lines_json(p_bom_pk uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'childCode', l.child_code, 'qty', l.qty, 'uom', l.uom, 'consumerDept', l.consumer_dept,
      'producerDept', l.producer_dept, 'scrapPct', l.scrap_pct, 'flags', l.flags, 'note', l.note)
    || case when l.step is null then '{}'::jsonb else jsonb_build_object('step', l.step) end
    order by l.line_no), '[]'::jsonb)
  from public.bom_bom_lines l
  where l.bom_pk = p_bom_pk
$$;
revoke all on function private.bom_lines_json(uuid) from public, anon, authenticated;

-- changeLog ของ BOM: ตรวจรูป [{at, by, text}] ต่อท้ายเท่านั้น (ส่วนที่มีอยู่แล้วต้องเหมือนเดิม) รายการที่เพิ่มใหม่ใช้ชื่อ persona เป็นผู้ทำ
create or replace function private.bom_log(p_node jsonb, p_old jsonb, p_actor_name text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_node jsonb := p_node;
  v_entry jsonb;
  v_out jsonb := '[]'::jsonb;
  v_i integer := 0;
  v_old_n integer := coalesce(jsonb_array_length(p_old), 0);
  v_at numeric;
  v_by text;
  v_text text;
begin
  if v_node is null or jsonb_typeof(v_node) = 'null' then v_node := '[]'::jsonb; end if;
  if jsonb_typeof(v_node) <> 'array' or jsonb_array_length(v_node) > 200 then raise exception 'BOM_INVALID_BOM'; end if;
  if jsonb_array_length(v_node) < v_old_n then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
  for v_entry in select value from jsonb_array_elements(v_node) loop
    if jsonb_typeof(v_entry) <> 'object' then raise exception 'BOM_INVALID_BOM'; end if;
    v_at := private.bom_num(v_entry -> 'at', 'BOM_INVALID_BOM', 0, 1000000000000000);
    if v_at is null then raise exception 'BOM_INVALID_BOM'; end if;
    v_by := private.bom_text(v_entry, 'by', 120, 0, 'BOM_INVALID_BOM');
    v_text := private.bom_text(v_entry, 'text', 1000, 1, 'BOM_INVALID_BOM');
    if v_i >= v_old_n then v_by := p_actor_name; end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object('at', v_at, 'by', v_by, 'text', v_text));
    if v_i < v_old_n and (v_out -> v_i) <> (p_old -> v_i) then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
    v_i := v_i + 1;
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_log(jsonb, jsonb, text) from public, anon, authenticated;

-- ขั้นตอนของ routing: [{processCode, minutesPerPc, note, inputs[]}] ไม่เกิน 20 ขั้น ขั้นตอนซ้ำไม่ได้
create or replace function private.bom_parse_steps(p_node jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_step jsonb;
  v_out jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_process text;
  v_minutes numeric;
  v_inputs jsonb;
  v_input jsonb;
  v_clean jsonb;
  v_code text;
  v_placed text[] := '{}';
begin
  if p_node is null or jsonb_typeof(p_node) <> 'array' or jsonb_array_length(p_node) > 20 then
    raise exception 'BOM_INVALID_ROUTING';
  end if;
  for v_step in select value from jsonb_array_elements(p_node) loop
    if jsonb_typeof(v_step) <> 'object' then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_process := private.bom_text(v_step, 'processCode', 60, 1, 'BOM_INVALID_ROUTING');
    if v_process = any (v_seen) then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_seen := v_seen || v_process;
    v_minutes := private.bom_num(v_step -> 'minutesPerPc', 'BOM_INVALID_ROUTING', 0, 1000000);
    if v_minutes is null then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_inputs := v_step -> 'inputs';
    if v_inputs is null or jsonb_typeof(v_inputs) = 'null' then v_inputs := '[]'::jsonb; end if;
    if jsonb_typeof(v_inputs) <> 'array' or jsonb_array_length(v_inputs) > 100 then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_clean := '[]'::jsonb;
    for v_input in select value from jsonb_array_elements(v_inputs) loop
      if jsonb_typeof(v_input) <> 'string' or char_length(btrim(v_input #>> '{}')) not between 1 and 60 then
        raise exception 'BOM_INVALID_ROUTING';
      end if;
      v_code := private.bom_code(v_input #>> '{}');
      -- ลูกหนึ่งตัวเข้าได้ขั้นเดียว
      if v_code = any (v_placed) then raise exception 'BOM_INVALID_ROUTING'; end if;
      v_placed := v_placed || v_code;
      v_clean := v_clean || jsonb_build_array(v_code);
    end loop;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'processCode', v_process, 'minutesPerPc', v_minutes,
      'note', private.bom_text(v_step, 'note', 120, 0, 'BOM_INVALID_ROUTING'), 'inputs', v_clean));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.bom_parse_steps(jsonb) from public, anon, authenticated;

-- 5. ตัวเขียนข้อมูลแต่ละส่วน (เรียกจาก app_bom_save_master เท่านั้น) ------------------------------
create or replace function private.bom_save_compounds(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_code := upper(private.bom_text(v_row, 'code', 20, 1, 'BOM_INVALID_COMPOUND'));
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_COMPOUND'; end if;
    v_seen := v_seen || v_code;
    insert into public.bom_compounds (is_test, code, name, recipe_id, recipe_name)
    values (true, v_code,
            coalesce(nullif(private.bom_text(v_row, 'name', 120, 0, 'BOM_INVALID_COMPOUND'), ''), v_code),
            nullif(private.bom_text(v_row, 'recipeId', 60, 0, 'BOM_INVALID_COMPOUND'), ''),
            nullif(private.bom_text(v_row, 'recipeName', 120, 0, 'BOM_INVALID_COMPOUND'), ''))
    on conflict (code, is_test) do update set
      name = excluded.name, recipe_id = excluded.recipe_id, recipe_name = excluded.recipe_name, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_compounds(uuid, jsonb) from public, anon, authenticated;

create or replace function private.bom_save_colors(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR'; end if;
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR'));
    if v_code !~ '^[A-Z]{2}[0-9]{2}$' or v_code = any (v_seen) then raise exception 'BOM_INVALID_COLOR'; end if;
    v_seen := v_seen || v_code;
    insert into public.bom_colors (is_test, code, name)
    values (true, v_code, private.bom_text(v_row, 'name', 60, 1, 'BOM_INVALID_COLOR'))
    on conflict (code, is_test) do update set name = excluded.name, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_colors(uuid, jsonb) from public, anon, authenticated;

create or replace function private.bom_save_processes(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PROCESS'; end if;
    v_code := private.bom_text(v_row, 'code', 60, 1, 'BOM_INVALID_PROCESS');
    if v_code = any (v_seen) then raise exception 'BOM_INVALID_PROCESS'; end if;
    v_seen := v_seen || v_code;
    insert into public.bom_processes (is_test, code, name, dept)
    values (true, v_code, private.bom_text(v_row, 'name', 80, 1, 'BOM_INVALID_PROCESS'),
            private.bom_dept(private.bom_text(v_row, 'dept', 10, 1, 'BOM_INVALID_DEPT')))
    on conflict (code, is_test) do update set name = excluded.name, dept = excluded.dept, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_processes(uuid, jsonb) from public, anon, authenticated;

-- item master: คืนรหัส canonical ของชิ้นที่เขียน (ใช้ตรวจกฎ BOM หลังเขียน)
create or replace function private.bom_save_items(p_actor uuid, p_rows jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_codes text[] := '{}';
  v_code text;
  v_kind text;
  v_name text;
  v_dept text;
  v_uom text;
  v_weight numeric;
  v_node jsonb;
  v_rubber jsonb;
  v_key text;
  v_val jsonb;
  v_legacy jsonb;
  v_entry jsonb;
  v_active boolean;
  v_group text;
  v_cost numeric;
  v_image text;
  v_image_total integer := 0;
  v_old_kind text;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ITEM'; end if;
    v_code := private.bom_code(private.bom_text(v_row, 'code', 60, 1, 'BOM_INVALID_ITEM'));
    if v_code = any (v_codes) then raise exception 'BOM_INVALID_ITEM'; end if;
    v_codes := v_codes || v_code;
    v_kind := private.bom_text(v_row, 'kind', 20, 1, 'BOM_INVALID_ITEM');
    if v_kind not in ('FG', 'SE', 'RB', 'PT', 'BG', 'PURCHASED', 'SUBPART', 'CP') then raise exception 'BOM_INVALID_ITEM'; end if;
    -- รหัสสูตรยางต้องไม่เกิน 20 ตัวอักษร (ช่องสูตรของเส้นยางเก็บได้เท่านี้)
    if v_kind = 'CP' and char_length(v_code) > 20 then raise exception 'BOM_INVALID_ITEM'; end if;
    v_name := private.bom_text(v_row, 'name', 160, 1, 'BOM_INVALID_ITEM');
    v_dept := private.bom_dept(private.bom_text(v_row, 'ownerDept', 10, 1, 'BOM_INVALID_DEPT'));
    v_uom := private.bom_text(v_row, 'uom', 20, 1, 'BOM_INVALID_ITEM');
    if not (v_uom = any (private.bom_uoms())) then raise exception 'BOM_INVALID_ITEM'; end if;
    v_weight := coalesce(private.bom_num(v_row -> 'weightG', 'BOM_INVALID_ITEM', 0, 1000000000), 0);

    -- ข้อมูลยาง: เฉพาะ RB/SE คีย์ที่รู้จักเท่านั้น ค่า null ถูกตัดทิ้ง
    v_node := v_row -> 'rubber';
    v_rubber := null;
    if v_node is not null and jsonb_typeof(v_node) <> 'null' then
      if jsonb_typeof(v_node) <> 'object' or v_kind not in ('RB', 'SE') then raise exception 'BOM_INVALID_RUBBER'; end if;
      v_rubber := '{}'::jsonb;
      for v_key, v_val in select key, value from jsonb_each(v_node) loop
        if jsonb_typeof(v_val) = 'null' then continue; end if;
        if v_key in ('compound', 'type', 'color', 'product') then
          if jsonb_typeof(v_val) <> 'string' or char_length(v_val #>> '{}') > 60 then raise exception 'BOM_INVALID_RUBBER'; end if;
        elsif v_key in ('lengthMm', 'holeMm', 'odMm', 'kgPerRoll', 'cutLengthCm', 'pcsPerRoll', 'sePerGr') then
          perform private.bom_num(v_val, 'BOM_INVALID_RUBBER', 0, 1000000000);
        else
          raise exception 'BOM_INVALID_RUBBER';
        end if;
        v_rubber := v_rubber || jsonb_build_object(v_key, v_val);
      end loop;
    end if;

    v_legacy := v_row -> 'legacyCodes';
    if v_legacy is null or jsonb_typeof(v_legacy) = 'null' then v_legacy := '[]'::jsonb; end if;
    if jsonb_typeof(v_legacy) <> 'array' or jsonb_array_length(v_legacy) > 200 then raise exception 'BOM_INVALID_ITEM'; end if;
    for v_entry in select value from jsonb_array_elements(v_legacy) loop
      if jsonb_typeof(v_entry) <> 'string' or char_length(v_entry #>> '{}') not between 1 and 200 then raise exception 'BOM_INVALID_ITEM'; end if;
    end loop;

    v_node := v_row -> 'active';
    if v_node is null or jsonb_typeof(v_node) = 'null' then
      v_active := true;
    elsif jsonb_typeof(v_node) <> 'boolean' then
      raise exception 'BOM_INVALID_ITEM';
    else
      v_active := (v_node #>> '{}')::boolean;
    end if;
    v_group := coalesce(nullif(private.bom_text(v_row, 'group', 20, 0, 'BOM_INVALID_ITEM'), ''), 'TOY');
    v_cost := private.bom_num(v_row -> 'unitCost', 'BOM_INVALID_ITEM', 0, 1000000000);

    -- รูป: data URL PNG/JPEG/WebP ไม่เกิน 80,000 ตัวอักษร (เพดานรวมต่อคำสั่ง)
    v_node := v_row -> 'image';
    v_image := null;
    if v_node is not null and jsonb_typeof(v_node) <> 'null' then
      if jsonb_typeof(v_node) <> 'string' then raise exception 'BOM_INVALID_IMAGE'; end if;
      v_image := nullif(btrim(v_node #>> '{}'), '');
    end if;
    if v_image is not null then
      if char_length(v_image) > 80000 or v_image !~ '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$' then
        raise exception 'BOM_INVALID_IMAGE';
      end if;
      v_image_total := v_image_total + char_length(v_image);
      if v_image_total > 4000000 then raise exception 'BOM_TOO_LARGE'; end if;
    end if;

    -- ชิ้นที่มี BOM แล้วเปลี่ยนชนิดไม่ได้ (rules: เปลี่ยนชนิดของชิ้นที่มี BOM แล้วไม่ได้)
    select i.kind into v_old_kind from public.bom_items i where i.is_test and i.code = v_code;
    if found and v_old_kind <> v_kind and exists (
      select 1 from public.bom_boms b where b.is_test and b.item_code = v_code and b.status = 'approved') then
      raise exception 'BOM_ITEM_KIND_LOCKED';
    end if;

    insert into public.bom_items (
      is_test, code, kind, name, owner_dept, uom, weight_g, rubber, legacy_codes, active, item_group, unit_cost, image,
      imported_from, cloned_from, created_by, updated_by)
    values (
      true, v_code, v_kind, v_name, v_dept, v_uom, v_weight, v_rubber, v_legacy, v_active, v_group, v_cost, v_image,
      nullif(private.bom_text(v_row, 'importedFrom', 200, 0, 'BOM_INVALID_ITEM'), ''),
      nullif(private.bom_text(v_row, 'clonedFrom', 200, 0, 'BOM_INVALID_ITEM'), ''),
      p_actor, p_actor)
    on conflict (code, is_test) do update set
      kind = excluded.kind, name = excluded.name, owner_dept = excluded.owner_dept, uom = excluded.uom,
      weight_g = excluded.weight_g, rubber = excluded.rubber, legacy_codes = excluded.legacy_codes,
      active = excluded.active, item_group = excluded.item_group, unit_cost = excluded.unit_cost,
      image = excluded.image, imported_from = excluded.imported_from, cloned_from = excluded.cloned_from,
      updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return v_codes;
end;
$$;
revoke all on function private.bom_save_items(uuid, jsonb) from public, anon, authenticated;

create or replace function private.bom_save_color_sets(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_slot jsonb;
  v_slots jsonb;
  v_clean jsonb;
  v_key text;
  v_color text;
  v_base text;
  v_code text;
  v_seen text[] := '{}';
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
    v_base := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'));
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
    if v_code !~ '^[A-Z]$' or (v_base || '|' || v_code) = any (v_seen) then raise exception 'BOM_INVALID_COLOR_SET'; end if;
    v_seen := v_seen || (v_base || '|' || v_code);
    v_slots := v_row -> 'slots';
    if v_slots is null or jsonb_typeof(v_slots) <> 'array' or jsonb_array_length(v_slots) not between 1 and 50 then
      raise exception 'BOM_INVALID_COLOR_SET';
    end if;
    v_clean := '[]'::jsonb;
    for v_slot in select value from jsonb_array_elements(v_slots) loop
      if jsonb_typeof(v_slot) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      v_key := upper(private.bom_text(v_slot, 'key', 100, 1, 'BOM_INVALID_COLOR_SET'));
      v_color := upper(private.bom_text(v_slot, 'color', 4, 0, 'BOM_INVALID_COLOR_SET'));
      if v_key !~ '^(SE|RB)-[A-Z0-9-]+-\*-' or (v_color <> '' and v_color !~ '^[A-Z]{2}[0-9]{2}$') then
        raise exception 'BOM_INVALID_COLOR_SET';
      end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('key', v_key, 'color', v_color));
    end loop;
    insert into public.bom_color_sets (is_test, base, code, name, note, slots, created_by, updated_by)
    values (true, v_base, v_code, private.bom_text(v_row, 'name', 60, 0, 'BOM_INVALID_COLOR_SET'),
            private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_COLOR_SET'), v_clean, p_actor, p_actor)
    on conflict (base, code, is_test) do update set
      name = excluded.name, note = excluded.note, slots = excluded.slots, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_color_sets(uuid, jsonb) from public, anon, authenticated;

create or replace function private.bom_save_packages(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_line jsonb;
  v_lines jsonb;
  v_clean jsonb;
  v_child text;
  v_qty numeric;
  v_kind text;
  v_base text;
  v_code text;
  v_seen text[] := '{}';
  v_children text[];
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
    v_base := private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'));
    v_code := upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
    if v_code !~ '^[A-Z0-9-]{1,4}$' or (v_base || '|' || v_code) = any (v_seen) then raise exception 'BOM_INVALID_PACKAGE'; end if;
    v_seen := v_seen || (v_base || '|' || v_code);
    v_lines := v_row -> 'lines';
    if v_lines is null or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) not between 1 and 100 then
      raise exception 'BOM_INVALID_PACKAGE';
    end if;
    v_clean := '[]'::jsonb;
    v_children := '{}';
    for v_line in select value from jsonb_array_elements(v_lines) loop
      if jsonb_typeof(v_line) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_child := private.bom_code(private.bom_text(v_line, 'childCode', 60, 1, 'BOM_INVALID_PACKAGE'));
      if v_child = any (v_children) then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_children := v_children || v_child;
      select i.kind into v_kind from public.bom_items i where i.is_test and i.code = v_child;
      if not found then raise exception 'BOM_CHILD_NOT_FOUND'; end if;
      -- บรรจุภัณฑ์เป็นของซื้อ/คลังเท่านั้น
      if v_kind <> 'PURCHASED' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_qty := private.bom_num(v_line -> 'qty', 'BOM_INVALID_PACKAGE', 0, 1000000000);
      if v_qty is null or v_qty <= 0 then raise exception 'BOM_INVALID_PACKAGE'; end if;
      v_clean := v_clean || jsonb_build_array(jsonb_build_object('childCode', v_child, 'qty', v_qty));
    end loop;
    insert into public.bom_packages (is_test, base, code, name, lines, created_by, updated_by)
    values (true, v_base, v_code, private.bom_text(v_row, 'name', 60, 0, 'BOM_INVALID_PACKAGE'), v_clean, p_actor, p_actor)
    on conflict (base, code, is_test) do update set
      name = excluded.name, lines = excluded.lines, updated_by = excluded.updated_by, updated_at = now();
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_packages(uuid, jsonb) from public, anon, authenticated;

-- BOM: คืนรหัสชิ้นของ revision ใหม่ที่เพิ่ม (ใช้เริ่มตรวจวงจร)
create or replace function private.bom_save_boms(p_actor uuid, p_actor_name text, p_rows jsonb)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_roots text[] := '{}';
  v_seen text[] := '{}';
  v_id text;
  v_item_code text;
  v_item public.bom_items%rowtype;
  v_rev numeric;
  v_status text;
  v_dept text;
  v_note text;
  v_lines jsonb;
  v_log jsonb;
  v_old public.bom_boms%rowtype;
  v_max integer;
  v_pk uuid;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_BOM'; end if;
    v_id := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_BOM');
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' or v_id = any (v_seen) then raise exception 'BOM_INVALID_BOM'; end if;
    v_seen := v_seen || v_id;
    v_item_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_BOM'));
    select * into v_item from public.bom_items i where i.is_test and i.code = v_item_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'BOM_INVALID_BOM', 1, 100000);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'BOM_INVALID_BOM'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_BOM');
    if v_status not in ('approved', 'superseded') then raise exception 'BOM_INVALID_BOM'; end if;
    v_dept := private.bom_dept(coalesce(nullif(private.bom_text(v_row, 'ownerDept', 10, 0, 'BOM_INVALID_DEPT'), ''), v_item.owner_dept));
    v_note := private.bom_text(v_row, 'note', 300, 0, 'BOM_INVALID_BOM');
    v_lines := private.bom_parse_lines(v_item_code, v_dept, v_row -> 'lines');

    select * into v_old from public.bom_boms b where b.is_test and b.bom_id = v_id;
    if found then
      -- revision ที่มีอยู่แล้วเปลี่ยนได้เฉพาะ approved -> superseded, แผนกเจ้าของ และ changeLog ต่อท้าย
      if v_old.item_code <> v_item_code or v_old.revision <> v_rev::integer or v_old.note <> v_note
         or private.bom_lines_json(v_old.id) <> v_lines then
        raise exception 'BOM_REVISION_IMMUTABLE';
      end if;
      if v_old.status = 'superseded' and v_status = 'approved' then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      v_log := private.bom_log(v_row -> 'changeLog', v_old.change_log, p_actor_name);
      update public.bom_boms set
        status = v_status,
        superseded_at = case when v_old.status = 'approved' and v_status = 'superseded' then now() else v_old.superseded_at end,
        owner_dept = v_dept,
        change_log = v_log
      where id = v_old.id;
    else
      -- revision ใหม่: approved เสมอ และต้องเป็น (สูงสุดเดิม + 1) ตัวที่ approved อยู่ถูกตั้ง superseded ในคำสั่งเดียวกัน
      if v_status <> 'approved' then raise exception 'BOM_INVALID_BOM'; end if;
      select coalesce(max(b.revision), 0) into v_max from public.bom_boms b where b.is_test and b.item_code = v_item_code;
      if v_rev::integer <> v_max + 1 then raise exception 'BOM_REVISION_ORDER'; end if;
      update public.bom_boms set status = 'superseded', superseded_at = now()
      where is_test and item_code = v_item_code and status = 'approved';
      v_log := private.bom_log(v_row -> 'changeLog', null, p_actor_name);
      insert into public.bom_boms (
        is_test, bom_id, item_code, revision, status, owner_dept, note, created_by, approved_by, approved_at, change_log)
      values (true, v_id, v_item_code, v_rev::integer, 'approved', v_dept, v_note, p_actor, p_actor, now(), v_log)
      returning id into v_pk;
      insert into public.bom_bom_lines (
        is_test, bom_pk, line_no, step, child_code, qty, uom, consumer_dept, producer_dept, scrap_pct, flags, note)
      select true, v_pk, (t.ord - 1)::integer, (t.ln ->> 'step')::integer, t.ln ->> 'childCode',
             (t.ln ->> 'qty')::numeric, t.ln ->> 'uom', t.ln ->> 'consumerDept', t.ln ->> 'producerDept',
             (t.ln ->> 'scrapPct')::numeric, t.ln -> 'flags', t.ln ->> 'note'
      from jsonb_array_elements(v_lines) with ordinality as t(ln, ord);
      v_roots := v_roots || v_item_code;
    end if;
  end loop;
  return v_roots;
end;
$$;
revoke all on function private.bom_save_boms(uuid, text, jsonb) from public, anon, authenticated;

create or replace function private.bom_save_routings(p_actor uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb;
  v_seen text[] := '{}';
  v_id text;
  v_item_code text;
  v_kind text;
  v_rev numeric;
  v_status text;
  v_steps jsonb;
  v_old public.bom_routings%rowtype;
  v_max integer;
begin
  for v_row in select value from jsonb_array_elements(p_rows) loop
    if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_id := private.bom_text(v_row, 'id', 40, 1, 'BOM_INVALID_ROUTING');
    if v_id !~ '^[A-Za-z0-9._-]{1,40}$' or v_id = any (v_seen) then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_seen := v_seen || v_id;
    v_item_code := private.bom_code(private.bom_text(v_row, 'itemCode', 60, 1, 'BOM_INVALID_ROUTING'));
    select i.kind into v_kind from public.bom_items i where i.is_test and i.code = v_item_code;
    if not found then raise exception 'BOM_ITEM_NOT_FOUND'; end if;
    -- ของซื้อและสูตรยางไม่มีขั้นตอนผลิต
    if v_kind in ('PURCHASED', 'CP') then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_rev := private.bom_num(v_row -> 'revision', 'BOM_INVALID_ROUTING', 1, 100000);
    if v_rev is null or v_rev <> trunc(v_rev) then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_status := private.bom_text(v_row, 'status', 20, 1, 'BOM_INVALID_ROUTING');
    if v_status not in ('approved', 'superseded') then raise exception 'BOM_INVALID_ROUTING'; end if;
    v_steps := private.bom_parse_steps(v_row -> 'steps');

    select * into v_old from public.bom_routings r where r.is_test and r.routing_id = v_id;
    if found then
      if v_old.item_code <> v_item_code or v_old.revision <> v_rev::integer or v_old.steps <> v_steps then
        raise exception 'BOM_REVISION_IMMUTABLE';
      end if;
      if v_old.status = 'superseded' and v_status = 'approved' then raise exception 'BOM_REVISION_IMMUTABLE'; end if;
      update public.bom_routings set
        status = v_status,
        superseded_at = case when v_old.status = 'approved' and v_status = 'superseded' then now() else v_old.superseded_at end
      where id = v_old.id;
    else
      if v_status <> 'approved' then raise exception 'BOM_INVALID_ROUTING'; end if;
      select coalesce(max(r.revision), 0) into v_max from public.bom_routings r where r.is_test and r.item_code = v_item_code;
      if v_rev::integer <> v_max + 1 then raise exception 'BOM_REVISION_ORDER'; end if;
      update public.bom_routings set status = 'superseded', superseded_at = now()
      where is_test and item_code = v_item_code and status = 'approved';
      insert into public.bom_routings (is_test, routing_id, item_code, revision, status, steps, created_by)
      values (true, v_id, v_item_code, v_rev::integer, 'approved', v_steps, p_actor);
    end if;
  end loop;
  return cardinality(v_seen);
end;
$$;
revoke all on function private.bom_save_routings(uuid, jsonb) from public, anon, authenticated;

-- snapshot ทั้งชุดในรูป state v6 (camelCase) เรียงแบบกำหนดได้: รหัส/id จากน้อยไปมาก (collate "C") บรรทัด BOM ตามลำดับที่บันทึก
create or replace function private.bom_snapshot()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'version', coalesce((select s.version from public.bom_master_state s where s.is_test), 0),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', i.code, 'kind', i.kind, 'name', i.name, 'ownerDept', i.owner_dept, 'uom', i.uom,
          'weightG', i.weight_g, 'rubber', i.rubber, 'legacyCodes', i.legacy_codes, 'active', i.active,
          'group', i.item_group, 'createdAt', private.bom_ms(i.created_at), 'updatedAt', private.bom_ms(i.updated_at))
        || case when i.unit_cost is null then '{}'::jsonb else jsonb_build_object('unitCost', i.unit_cost) end
        || case when i.image is null then '{}'::jsonb else jsonb_build_object('image', i.image) end
        || case when i.imported_from is null then '{}'::jsonb else jsonb_build_object('importedFrom', i.imported_from) end
        || case when i.cloned_from is null then '{}'::jsonb else jsonb_build_object('clonedFrom', i.cloned_from) end
        order by i.code collate "C")
      from public.bom_items i where i.is_test), '[]'::jsonb),
    'compounds', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'name', c.name, 'recipeId', c.recipe_id, 'recipeName', c.recipe_name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_compounds c where c.is_test), '[]'::jsonb),
    'colors', coalesce((
      select jsonb_agg(jsonb_build_object(
          'code', c.code, 'master', substr(c.code, 1, 2), 'shade', substr(c.code, 3, 2), 'name', c.name,
          'createdAt', private.bom_ms(c.created_at)) order by c.code collate "C")
      from public.bom_colors c where c.is_test), '[]'::jsonb),
    'colorSets', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', s.base, 'code', s.code, 'name', s.name, 'note', s.note, 'slots', s.slots,
          'createdAt', private.bom_ms(s.created_at), 'createdBy', coalesce(private.bom_person(s.created_by), ''),
          'updatedAt', private.bom_ms(s.updated_at), 'updatedBy', coalesce(private.bom_person(s.updated_by), ''))
        order by s.base collate "C", s.code collate "C")
      from public.bom_color_sets s where s.is_test), '[]'::jsonb),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'base', p.base, 'code', p.code, 'name', p.name, 'lines', p.lines,
          'createdAt', private.bom_ms(p.created_at), 'createdBy', coalesce(private.bom_person(p.created_by), ''),
          'updatedAt', private.bom_ms(p.updated_at), 'updatedBy', coalesce(private.bom_person(p.updated_by), ''))
        order by p.base collate "C", p.code collate "C")
      from public.bom_packages p where p.is_test), '[]'::jsonb),
    'boms', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', b.bom_id, 'itemCode', b.item_code, 'revision', b.revision, 'status', b.status, 'ownerDept', b.owner_dept,
          'lines', private.bom_lines_json(b.id), 'createdBy', coalesce(private.bom_person(b.created_by), ''),
          'createdAt', private.bom_ms(b.created_at), 'approvedBy', coalesce(private.bom_person(b.approved_by), ''),
          'approvedAt', private.bom_ms(b.approved_at), 'note', b.note, 'changeLog', b.change_log)
        || case when b.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(b.superseded_at)) end
        order by b.bom_id collate "C")
      from public.bom_boms b where b.is_test), '[]'::jsonb),
    'processes', coalesce((
      select jsonb_agg(jsonb_build_object('code', p.code, 'name', p.name, 'dept', p.dept) order by p.code collate "C")
      from public.bom_processes p where p.is_test), '[]'::jsonb),
    'routings', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.routing_id, 'itemCode', r.item_code, 'revision', r.revision, 'status', r.status, 'steps', r.steps,
          'createdBy', coalesce(private.bom_person(r.created_by), ''), 'createdAt', private.bom_ms(r.created_at))
        || case when r.superseded_at is null then '{}'::jsonb else jsonb_build_object('supersededAt', private.bom_ms(r.superseded_at)) end
        order by r.routing_id collate "C")
      from public.bom_routings r where r.is_test), '[]'::jsonb))
$$;
revoke all on function private.bom_snapshot() from public, anon, authenticated;

-- 6. RPC สาธารณะ -------------------------------------------------------------------------------
-- อ่านข้อมูลหลักทั้งชุด: persona ทุกตัวอ่านได้
create or replace function public.app_bom_master()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.lab_only_block();
  perform private.bom_actor();
  return private.bom_snapshot();
end;
$$;

-- บันทึกชุดการเปลี่ยนแปลงข้อมูลหลักในธุรกรรมเดียว (ผิดข้อใดข้อหนึ่ง = ไม่เขียนอะไรเลย) คืน snapshot ใหม่
-- ไม่มีการเปลี่ยนแปลงเลย (ทุกส่วนว่าง) = คืน snapshot เดิมโดยไม่เพิ่ม version และไม่เขียน audit
create or replace function public.app_bom_save_master(p_changes jsonb, p_base_version bigint, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_actor_name text;
  v_sections constant text[] := array['items', 'compounds', 'colors', 'colorSets', 'packages', 'boms', 'processes', 'routings'];
  v_key text;
  v_sub text;
  v_sec jsonb;
  v_node jsonb;
  v_n integer;
  v_total integer := 0;
  v_counts jsonb := '{}'::jsonb;
  v_version bigint;
  v_row jsonb;
  v_item_codes text[] := '{}';
  v_roots text[] := '{}';
  v_touched text[];
  v_bad text;
begin
  perform private.lab_only_block();
  v_actor := private.bom_actor();
  if not private.bom_can_edit(v_actor) then raise exception 'BOM_FORBIDDEN'; end if;
  if p_action is null or not (p_action = any (private.bom_client_actions())) then raise exception 'BOM_INVALID_ACTION'; end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_base_version is null then
    raise exception 'BOM_INVALID_PAYLOAD';
  end if;

  -- รูปของ payload: ส่วนที่รู้จัก, upsert (ทุกส่วน) / delete (เฉพาะ colorSets และ packages), เป็นอาร์เรย์ไม่เกิน 5,000 เรคอร์ดต่อส่วน
  for v_key in select jsonb_object_keys(p_changes) loop
    if not (v_key = any (v_sections)) then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    v_sec := p_changes -> v_key;
    if jsonb_typeof(v_sec) <> 'object' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
    for v_sub in select jsonb_object_keys(v_sec) loop
      if not (v_sub = 'upsert' or (v_sub = 'delete' and v_key in ('colorSets', 'packages'))) then
        raise exception 'BOM_INVALID_PAYLOAD';
      end if;
      v_node := v_sec -> v_sub;
      if jsonb_typeof(v_node) <> 'array' then raise exception 'BOM_INVALID_PAYLOAD'; end if;
      v_n := jsonb_array_length(v_node);
      if v_n > 5000 then raise exception 'BOM_TOO_MANY'; end if;
      v_total := v_total + v_n;
      v_counts := v_counts || jsonb_build_object(v_key, coalesce(v_counts -> v_key, '{}'::jsonb) || jsonb_build_object(v_sub, v_n));
    end loop;
  end loop;

  -- ล็อกตัวนับก่อนเทียบเวอร์ชัน: บันทึกพร้อมกันต่อคิวกัน คนที่สองเห็น version ใหม่แล้วได้ BOM_STALE
  insert into public.bom_master_state (is_test) values (true) on conflict (is_test) do nothing;
  select s.version into v_version from public.bom_master_state s where s.is_test for update;
  if p_base_version <> v_version then raise exception 'BOM_STALE'; end if;
  if v_total = 0 then return private.bom_snapshot(); end if;

  v_actor_name := v_actor.first_name || ' ' || v_actor.last_name;

  begin
    perform private.bom_save_compounds(v_actor.id, coalesce(p_changes #> '{compounds,upsert}', '[]'::jsonb));
    perform private.bom_save_colors(v_actor.id, coalesce(p_changes #> '{colors,upsert}', '[]'::jsonb));
    perform private.bom_save_processes(v_actor.id, coalesce(p_changes #> '{processes,upsert}', '[]'::jsonb));
    v_item_codes := private.bom_save_items(v_actor.id, coalesce(p_changes #> '{items,upsert}', '[]'::jsonb));

    -- ลบก่อนเขียน (ลบแล้วสร้างใหม่รหัสเดิมในคำสั่งเดียวกันได้) ไม่พบ = BOM_NOT_FOUND
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{colorSets,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_COLOR_SET'; end if;
      delete from public.bom_color_sets
      where is_test
        and base = private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_COLOR_SET'))
        and code = upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_COLOR_SET'));
      if not found then raise exception 'BOM_NOT_FOUND'; end if;
    end loop;
    for v_row in select value from jsonb_array_elements(coalesce(p_changes #> '{packages,delete}', '[]'::jsonb)) loop
      if jsonb_typeof(v_row) <> 'object' then raise exception 'BOM_INVALID_PACKAGE'; end if;
      delete from public.bom_packages
      where is_test
        and base = private.bom_code(private.bom_text(v_row, 'base', 60, 1, 'BOM_INVALID_PACKAGE'))
        and code = upper(private.bom_text(v_row, 'code', 4, 1, 'BOM_INVALID_PACKAGE'));
      if not found then raise exception 'BOM_NOT_FOUND'; end if;
    end loop;

    perform private.bom_save_color_sets(v_actor.id, coalesce(p_changes #> '{colorSets,upsert}', '[]'::jsonb));
    perform private.bom_save_packages(v_actor.id, coalesce(p_changes #> '{packages,upsert}', '[]'::jsonb));
    v_roots := private.bom_save_boms(v_actor.id, v_actor_name, coalesce(p_changes #> '{boms,upsert}', '[]'::jsonb));
    perform private.bom_save_routings(v_actor.id, coalesce(p_changes #> '{routings,upsert}', '[]'::jsonb));

    -- ตรวจกฎ BOM หลังเขียนเฉพาะส่วนที่เกี่ยว: BOM ที่ approved ของชิ้นที่ถูกแก้/มี revision ใหม่ และ BOM ที่ใช้ชิ้นที่ถูกแก้เป็นลูก
    v_touched := v_item_codes || v_roots;
    if cardinality(v_touched) > 0 then
      -- ชนิดพ่อ/ลูก (rules.childKindError)
      select case when p.kind in ('PURCHASED', 'CP') then 'BOM_INVALID_PARENT_KIND' else 'BOM_INVALID_CHILD_KIND' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code
      join public.bom_bom_lines l on l.bom_pk = b.id
      join public.bom_items c on c.is_test and c.code = l.child_code
      where b.is_test and b.status = 'approved'
        and (b.item_code = any (v_touched) or l.child_code = any (v_touched))
        and (p.kind in ('PURCHASED', 'CP')
             or (p.kind = 'RB' and c.kind <> 'CP')
             or (c.kind = 'CP' and p.kind <> 'RB'))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;

      -- เส้นยาง: บรรทัดสูตรยางได้บรรทัดเดียว และต้องตรงกับ rubber.compound ของชิ้น (ถ้าระบุ)
      select case when x.n <> 1 then 'BOM_RB_ONE_COMPOUND' else 'BOM_RB_COMPOUND_MISMATCH' end
      into v_bad
      from public.bom_boms b
      join public.bom_items p on p.is_test and p.code = b.item_code and p.kind = 'RB'
      cross join lateral (
        select count(*) as n, min(l.child_code) as child
        from public.bom_bom_lines l where l.bom_pk = b.id) x
      where b.is_test and b.status = 'approved' and b.item_code = any (v_touched)
        and (x.n <> 1
             or (coalesce(p.rubber ->> 'compound', '') <> '' and private.bom_code(p.rubber ->> 'compound') <> x.child))
      limit 1;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;

    -- วงจร: เดินจากพ่อของ revision ใหม่ลงไปตาม BOM ที่ approved (วงจรใหม่เกิดจากเส้นใหม่เท่านั้น) เพดาน 30 ชั้น
    if cardinality(v_roots) > 0 then
      with recursive walk(code, path) as (
        select l.child_code, array[r.root, l.child_code]
        from unnest(v_roots) as r(root)
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = r.root
        join public.bom_bom_lines l on l.bom_pk = b.id
        union all
        select l.child_code, w.path || l.child_code
        from walk w
        join public.bom_boms b on b.is_test and b.status = 'approved' and b.item_code = w.code
        join public.bom_bom_lines l on l.bom_pk = b.id
        where cardinality(w.path) < 30
          and not (w.code = any (w.path[1:cardinality(w.path) - 1]))
      )
      select case
               when bool_or(w.code = any (w.path[1:cardinality(w.path) - 1])) then 'BOM_CYCLE'
               when max(cardinality(w.path)) >= 30 then 'BOM_TOO_DEEP'
             end
      into v_bad
      from walk w;
      if v_bad is not null then raise exception '%', v_bad; end if;
    end if;
  exception
    when unique_violation then
      raise exception 'BOM_CONFLICT';
    when check_violation or not_null_violation or foreign_key_violation or invalid_text_representation
      or numeric_value_out_of_range or string_data_right_truncation or datetime_field_overflow then
      -- ข้อความกลาง ๆ ไม่คืนค่าหรือชื่อ constraint กลับไป
      raise exception 'BOM_INVALID_DATA';
  end;

  v_version := v_version + 1;
  update public.bom_master_state set version = v_version, updated_at = now(), updated_by = v_actor.id where is_test;
  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (private.bom_audit_actor_id(), 'BOM_MASTER_SAVE', 'bom_master', v_version::text,
          jsonb_build_object('client_action', p_action, 'version', v_version, 'counts', v_counts, 'is_test', true,
                             'persona_employee_no', v_actor.employee_no));
  return private.bom_snapshot();
end;
$$;

revoke all on function public.app_bom_master() from public, anon;
revoke all on function public.app_bom_save_master(jsonb, bigint, text) from public, anon;
grant execute on function public.app_bom_master() to authenticated;
grant execute on function public.app_bom_save_master(jsonb, bigint, text) to authenticated;
