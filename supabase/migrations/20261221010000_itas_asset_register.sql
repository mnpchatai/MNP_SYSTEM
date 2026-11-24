-- ============================================================================
-- ทะเบียนอุปกรณ์ IT (ย้ายไฟล์ Machinery_Register_Document.xlsx เข้าเว็บ) — โมดูลของระบบสำนักงาน › IT SUPPORT · ส่วนฐานข้อมูลอย่างเดียว
-- (ยังไม่มีหน้าเว็บ · ไม่นำเข้าข้อมูลใด ๆ · ไม่แตะตาราง/ฟังก์ชันของ itwo และ itrp)
--
-- ที่มา: สเปกที่เจ้าของตัดสิน 24/11/2026 (Work-Order/docs/it-asset-register-spec.md รวม "เจ้าของตัดสินรอบ 2") · สัญญาสำหรับหน้าเว็บ: docs/itas-contract.md
--
-- โครงกลาง (ไม่ใช่ 23 ตาราง): ชนิดอุปกรณ์ itas_types (นิยามช่องเฉพาะชนิดเป็น jsonb) + อุปกรณ์ itas_assets (ช่องกลาง + attrs ไม่ลับ + secrets ลับ)
--   - itas_types          ชนิดอุปกรณ์ 23 ชนิดตั้งต้น (seed ด้านล่าง) · it_admin เพิ่ม/แก้ชนิดและช่องได้ (ลบช่องที่มีข้อมูลแล้วไม่ได้ ใช้ซ่อน) · ลบชนิดไม่ได้
--   - itas_type_log       ประวัติแก้นิยามชนิด (เพิ่มได้อย่างเดียว เขียนโดย trigger) — เพิ่มจากสเปกเพราะสเปกให้ "แก้นิยามลง log" แต่ไม่ได้ระบุตาราง
--   - itas_assets         อุปกรณ์ทุกชิ้น · ลบไม่ได้ (ใช้สถานะ retired) · แก้ได้ทุกช่องยกเว้น id/ชนิด/ผู้สร้าง
--   - itas_asset_log      ประวัติเพิ่ม/แก้ทุกแถว (ค่าเดิม ค่าใหม่ทั้งแถว ช่องลับเป็น ciphertext) · เพิ่มได้อย่างเดียว · เขียนโดย trigger
--   - itas_asset_moves    ประวัติย้าย/เปลี่ยนชิ้นส่วนอัตโนมัติ (host_code/slot/status เปลี่ยน) · เพิ่มได้อย่างเดียว · เขียนโดย trigger
--   - itas_vault          ตู้เซฟ 1 แถวต่อโหมด: เก็บเฉพาะ salt / พารามิเตอร์ KDF / กุญแจหลักที่ถูกห่อ (ห่อด้วยรหัสตู้เซฟ และรหัสกู้คืน)
--   - itas_vault_log      ประวัติตั้ง/เปลี่ยนรหัสตู้เซฟ/ออกรหัสกู้คืนใหม่ (ไม่เก็บ secret ใด ๆ) · เพิ่มได้อย่างเดียว · เขียนโดย trigger
--
-- ช่องลับ (client-side encryption): ฐานข้อมูลเก็บเฉพาะ envelope {v:1, n:<nonce 12 ไบต์ base64>, c:<ciphertext+tag base64>} ที่หน้าเว็บเข้ารหัสมาแล้ว
--   ไม่มีฟังก์ชัน/คอลัมน์ใดรับหรือเก็บ plaintext ของช่องลับ · ไม่ใช้ pgcrypto · เซิร์ฟเวอร์ตรวจได้แค่รูปแบบ/ขนาด/ว่าช่องนั้นนิยามเป็น secret
--   (ตารางมี CHECK รูปแบบ envelope อีกชั้น เขียนตรงด้วยสิทธิ์สูงก็เก็บ plaintext ไม่ได้) · ผู้ดูแลฐานข้อมูลทำลาย ciphertext ได้ (อ่านไม่ได้) → เจ้าของควรส่งออกสำรองเป็นระยะ
--   รหัสตู้เซฟ/กุญแจ ไม่ส่งขึ้นเซิร์ฟเวอร์ · ไม่บันทึกว่าใครกดดูช่องลับเมื่อไร (เจ้าของตัดสิน) แต่ประวัติแก้ไขข้อมูลเก็บครบ
--
-- สิทธิ์: it_admin ใน itwo_staff เท่านั้นทุก RPC (อ่านจาก itwo_staff แบบเดียวกับ itrp · ผู้อนุมัติขั้น IT / ผจก. / พนักงาน เรียกไม่ได้) · anon เรียกไม่ได้
--   RLS deny-all ทุกตาราง + ไม่มี grant ตรงให้ anon/authenticated/service_role · อ่าน/เขียนผ่าน RPC app_itas_* (SECURITY DEFINER, search_path ว่าง) เท่านั้น
--
-- โหมดทดสอบ (Admin Sandbox): ทุกตารางมี is_test + trigger private.sandbox_row_scope · persona ทดสอบ (SBX-IT-ADMIN) แก้ของจริงไม่ได้
--   ตัดสินใจเอง (ต้องรายงาน):
--     - itas_types แยกต่อโหมด (คีย์ (is_test, code)) และ seed 23 ชนิดให้ทั้งโหมดจริงและโหมดทดสอบ เพื่อให้ persona ลองแก้นิยามชนิดได้โดยไม่แตะของจริง
--       ล้างข้อมูลทดสอบ (app_sandbox_purge_itas) จะลบชนิดทดสอบแล้ว seed ค่าตั้งต้นของโหมดทดสอบกลับให้ (ไม่ค้างนิยามที่ลองแก้)
--     - itas_vault แยกต่อโหมด: โหมดทดสอบมีตู้เซฟของตัวเอง (เริ่มจากยังไม่ตั้ง ต้องตั้งรหัสทดสอบเอง) ล้างข้อมูลทดสอบลบตู้เซฟทดสอบด้วย
--       (ข้อมูลลับในโหมดทดสอบอ่านไม่ออกอยู่แล้วหลังล้าง จึงต้องล้างคู่กัน)
--     - key_version (ตัวที่ใช้ใน AAD) กับ rev (ตัวนับสำหรับกันแก้ชนกัน) แยกกัน: สเปกใช้ key_version ทั้งสองอย่าง แต่ถ้าเปลี่ยนรหัสตู้เซฟแล้ว key_version เพิ่ม
--       ciphertext ทุกแถวที่ผูก AAD ไว้จะถอดไม่ออก จึงแยก: key_version = รุ่นของกุญแจหลัก (DEK) คงที่ 1 จนกว่าจะมีฟังก์ชันเข้ารหัสทุกแถวใหม่,
--       rev = นับเพิ่มทุกครั้งที่แก้ตู้เซฟ (rotate ต้องส่ง rev ปัจจุบัน)
--     - host_code และ reg_no / device_code ถูกตัดช่องว่างและแปลงเป็นตัวพิมพ์ใหญ่เสมอ (ให้จับคู่รหัสเครื่องกับ "ติดตั้งที่" ได้ตรง)
--
-- สิ่งที่แตะนอกจากของใหม่ itas_*
--   1) replace private.sandbox_unguarded_tables() — เริ่มจากนิยามล่าสุดบน main (20261220010000_st_rb_chemical_store.sql ทุกชื่อ รวม rf_chem_docs และ itwo/itrp)
--      แล้วต่อ 7 ตารางใหม่ (to_regclass เหมือน itwo/itrp) · ก่อน apply ต้องเทียบ md5(pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure)) บน prod
--      ว่าตรงกับฉบับของ 20261220010000 · ไม่ตรง = เพื่อนมี migration ใหม่ที่ replace ไว้ ให้หยุดแล้วใช้ฉบับล่าสุดเป็นฐาน
--   ไม่แตะ: ตาราง/ฟังก์ชัน/trigger ของ itwo และ itrp (หัวใบ FM02 ผูกกับทะเบียนใหม่เป็นงานรอบหลัง), ฟังก์ชันกลางอื่นของเพื่อน, storage
--
-- ลำดับ deploy: ตารางและ RPC ใหม่ล้วน ยังไม่มีหน้าเว็บเรียก · apply ก่อน merge หน้าเว็บ
--   ก่อน apply ที่ production: เช็ก migration ใหม่บน prod, md5 ของ private.sandbox_unguarded_tables(), itwo_staff ยังมี it_admin
--   หลัง apply ตรวจ: relrowsecurity ของ 7 ตาราง, ไม่มี grant ตรง, RPC anon เรียกไม่ได้, seed ชนิด 23 + 23 (จริง/ทดสอบ), ไม่มีแถว itas_assets/itas_vault
--
-- Rollback (ยังไม่มีข้อมูลจริง): drop function public.app_itas_* / app_sandbox_purge_itas / private.itas_* · drop table itas_vault_log, itas_vault, itas_asset_moves,
--   itas_asset_log, itas_assets, itas_type_log, itas_types (ลูกก่อนแม่) · create or replace private.sandbox_unguarded_tables() กลับเป็นนิยามของ 20261220010000
--   ถ้ามีข้อมูลจริงแล้ว ห้ามย้อนด้วยการ drop (เป็นบันทึก ISO และข้อมูลที่เข้ารหัสแล้วกู้ไม่ได้) ให้แก้ไปข้างหน้าด้วย migration ใหม่
-- ============================================================================

-- 0. ตรวจข้อมูลอ้างอิงที่ migration นี้ต้องใช้ ------------------------------------------
do $$
begin
  if to_regclass('public.itwo_staff') is null then
    raise exception 'ไม่พบตาราง itwo_staff (สิทธิ์ทีม IT) กรุณา apply migration ใบสั่งงาน IT ก่อน';
  end if;
  if to_regclass('public.rf_chem_docs') is null then
    raise exception 'ไม่พบตาราง rf_chem_docs กรุณา apply 20261220010000_st_rb_chemical_store.sql ก่อน (รายชื่อ private.sandbox_unguarded_tables ต้องต่อจากฉบับนั้น)';
  end if;
end;
$$;

-- 1. ตัวช่วย (private) ที่ตารางต้องใช้ใน CHECK ------------------------------------------
-- ความยาวหลังถอด base64 มาตรฐาน (มี padding) · null = ไม่ใช่ base64 ที่ถูกต้อง (ห้ามขึ้นบรรทัดใหม่/ช่องว่าง) · จำกัดข้อความไม่เกิน 8,192 ตัวอักษร
create or replace function private.itas_b64_len(p_text text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_text is null or p_text = '' or char_length(p_text) > 8192 then null
    when p_text ~ '^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' then octet_length(decode(p_text, 'base64'))
  end
$$;

-- ตรวจ envelope ของช่องลับหนึ่งช่อง {v:1, n, c}: คืนข้อความผิดพลาด (ไทย) หรือ null ถ้าผ่าน
--   n = nonce AES-GCM ต้องยาว 12 ไบต์ · c = ciphertext + tag (16 ไบต์) ต้องยาว 17–4,096 ไบต์ (plaintext ≥ 1 ไบต์) · ห้ามมีคีย์อื่น
create or replace function private.itas_envelope_error(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys text[];
  v_clen integer;
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    return 'รูปแบบข้อมูลลับต้องเป็นข้อมูลที่เข้ารหัสแล้ว {v, n, c}';
  end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_value) k;
  if v_keys is distinct from array['c', 'n', 'v'] then
    return 'รูปแบบข้อมูลลับต้องมีเฉพาะ v, n, c';
  end if;
  if jsonb_typeof(p_value -> 'v') is distinct from 'number' or (p_value ->> 'v') <> '1' then
    return 'เวอร์ชันของข้อมูลลับต้องเป็น 1';
  end if;
  if jsonb_typeof(p_value -> 'n') is distinct from 'string' or jsonb_typeof(p_value -> 'c') is distinct from 'string' then
    return 'ข้อมูลลับ n และ c ต้องเป็นข้อความ base64';
  end if;
  if private.itas_b64_len(p_value ->> 'n') is distinct from 12 then
    return 'nonce ของข้อมูลลับต้องเป็น base64 ยาว 12 ไบต์';
  end if;
  v_clen := private.itas_b64_len(p_value ->> 'c');
  if v_clen is null then
    return 'ciphertext ของข้อมูลลับต้องเป็น base64 ที่ถูกต้อง';
  end if;
  if v_clen < 17 or v_clen > 4096 then
    return 'ciphertext ของข้อมูลลับต้องยาว 17–4,096 ไบต์ (ค่าลับยาวสุดประมาณ 4,000 ตัวอักษร)';
  end if;
  return null;
end;
$$;

-- ใช้ใน CHECK ของ itas_assets.secrets: เป็น object, ชื่อช่องถูกรูปแบบ, ทุกค่าเป็น envelope ที่ผ่าน
create or replace function private.itas_secrets_ok(p_secrets jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_secrets) = 'object'
     and not exists (
       select 1 from jsonb_each(p_secrets) e
       where e.key !~ '^[a-z][a-z0-9_]{0,39}$' or private.itas_envelope_error(e.value) is not null)
$$;

-- กุญแจหลักที่ถูกห่อ {n, c}: n = nonce 12 ไบต์, c = ciphertext ของกุญแจ AES-256 (32 ไบต์) + tag 16 ไบต์ = 48 ไบต์ พอดี
create or replace function private.itas_wrapped_key_error(p_value jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_keys text[];
begin
  if jsonb_typeof(p_value) is distinct from 'object' then
    return 'กุญแจที่ห่อต้องเป็นข้อมูล {n, c}';
  end if;
  select array_agg(k order by k) into v_keys from jsonb_object_keys(p_value) k;
  if v_keys is distinct from array['c', 'n'] then
    return 'กุญแจที่ห่อต้องมีเฉพาะ n และ c';
  end if;
  if jsonb_typeof(p_value -> 'n') is distinct from 'string' or jsonb_typeof(p_value -> 'c') is distinct from 'string' then
    return 'กุญแจที่ห่อ n และ c ต้องเป็นข้อความ base64';
  end if;
  if private.itas_b64_len(p_value ->> 'n') is distinct from 12 then
    return 'nonce ของกุญแจที่ห่อต้องเป็น base64 ยาว 12 ไบต์';
  end if;
  if private.itas_b64_len(p_value ->> 'c') is distinct from 48 then
    return 'กุญแจที่ห่อต้องเป็น base64 ยาว 48 ไบต์ (กุญแจ 32 ไบต์ + tag 16 ไบต์)';
  end if;
  return null;
end;
$$;

-- 2. ตาราง -----------------------------------------------------------------------
-- ชนิดอุปกรณ์: คีย์ (is_test, code) · fields = [{key, label, type: text|number|date|choice, choices?, secret, max?, order, hidden?}]
--   created_by/updated_by เป็น null ได้เฉพาะแถว seed (ไม่มีผู้ทำรายการ)
create table public.itas_types (
  is_test boolean not null default false,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{1,29}$'),
  name text not null check (btrim(name) <> '' and char_length(name) <= 100),
  -- คำนำหน้าเลขทะเบียน (คำใบ้ให้หน้าเว็บ ไม่บังคับรูปแบบ เพราะบางชนิดมีหลายคำนำหน้า เช่น HUB/AP)
  reg_prefix text check (reg_prefix is null or (btrim(reg_prefix) <> '' and char_length(reg_prefix) <= 40)),
  -- มีรหัสอุปกรณ์แยกจากเลขทะเบียน (เช่น COM01 / MNT01 / PRT01 / UPS01)
  has_device_code boolean not null default false,
  fields jsonb not null default '[]'::jsonb check (jsonb_typeof(fields) = 'array' and jsonb_array_length(fields) <= 80),
  sort integer not null default 100 check (sort between 0 and 9999),
  is_active boolean not null default true,
  created_by uuid references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid references public.employees(id),
  updated_at timestamptz not null default now(),
  primary key (is_test, code)
);
create index itas_types_created_by_idx on public.itas_types (created_by) where created_by is not null;
create index itas_types_updated_by_idx on public.itas_types (updated_by) where updated_by is not null;
comment on table public.itas_types is
  'ชนิดอุปกรณ์ในทะเบียน IT + นิยามช่องเฉพาะชนิด (fields jsonb) · seed 23 ชนิดต่อโหมด · ลบไม่ได้ · แก้ผ่าน app_itas_save_type เท่านั้น (ลงประวัติใน itas_type_log โดย trigger)';

create table public.itas_type_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  type_code text not null,
  action text not null check (action in ('created', 'updated')),
  actor_id uuid not null references public.employees(id),
  old_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (is_test, type_code) references public.itas_types (is_test, code),
  constraint itas_type_log_old_values_ck check ((action = 'created') = (old_values is null))
);
create index itas_type_log_type_idx on public.itas_type_log (is_test, type_code, id);
create index itas_type_log_actor_idx on public.itas_type_log (actor_id);
comment on table public.itas_type_log is
  'ประวัติเพิ่ม/แก้นิยามชนิดอุปกรณ์ (ค่าเดิม ค่าใหม่ ใคร เมื่อไร) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itas_types';

-- อุปกรณ์ · id รับจากหน้าเว็บได้ตอนสร้าง (ใช้เป็น AAD ของช่องลับ) · ลบไม่ได้ ใช้สถานะ retired
create table public.itas_assets (
  id uuid primary key default gen_random_uuid(),
  is_test boolean not null default false,
  type_code text not null,
  reg_no text check (reg_no is null or (reg_no = upper(btrim(reg_no)) and btrim(reg_no) <> '' and char_length(reg_no) <= 50 and reg_no !~ '[[:cntrl:]]')),
  device_code text check (device_code is null or (device_code = upper(btrim(device_code)) and btrim(device_code) <> '' and char_length(device_code) <= 50 and device_code !~ '[[:cntrl:]]')),
  name text check (name is null or (btrim(name) <> '' and char_length(name) <= 200 and name !~ '[[:cntrl:]]')),
  model text check (model is null or (btrim(model) <> '' and char_length(model) <= 200 and model !~ '[[:cntrl:]]')),
  serial text check (serial is null or (btrim(serial) <> '' and char_length(serial) <= 200 and serial !~ '[[:cntrl:]]')),
  -- สถานะมาตรฐาน 4 ค่า: ใช้งาน / สำรอง / ชำรุด / ยกเลิกใช้งาน
  status text not null default 'in_use' check (status in ('in_use', 'spare', 'broken', 'retired')),
  -- "ติดตั้งที่ / Used by": รหัสเครื่อง (ตัวพิมพ์ใหญ่) หรือข้อความอิสระ · ไม่บังคับว่าต้องมีในทะเบียน
  host_code text check (host_code is null or (host_code = upper(btrim(host_code)) and btrim(host_code) <> '' and char_length(host_code) <= 50 and host_code !~ '[[:cntrl:]]')),
  slot text check (slot is null or (btrim(slot) <> '' and char_length(slot) <= 50 and slot !~ '[[:cntrl:]]')),
  place text check (place is null or (btrim(place) <> '' and char_length(place) <= 200 and place !~ '[[:cntrl:]]')),
  install_date date check (install_date is null or install_date between date '1990-01-01' and date '2100-01-01'),
  record_date date check (record_date is null or record_date between date '1990-01-01' and date '2100-01-01'),
  purchase_date date check (purchase_date is null or purchase_date between date '1990-01-01' and date '2100-01-01'),
  vendor text check (vendor is null or (btrim(vendor) <> '' and char_length(vendor) <= 200 and vendor !~ '[[:cntrl:]]')),
  price numeric(14, 2) check (price is null or price >= 0),
  tax_rate numeric(5, 2) check (tax_rate is null or tax_rate between 0 and 100),
  warranty_text text check (warranty_text is null or (btrim(warranty_text) <> '' and char_length(warranty_text) <= 200 and warranty_text !~ '[[:cntrl:]]')),
  warranty_end date check (warranty_end is null or warranty_end between date '1990-01-01' and date '2100-01-01'),
  express_code text check (express_code is null or (btrim(express_code) <> '' and char_length(express_code) <= 100 and express_code !~ '[[:cntrl:]]')),
  account_no text check (account_no is null or (btrim(account_no) <> '' and char_length(account_no) <= 100 and account_no !~ '[[:cntrl:]]')),
  note text check (note is null or (btrim(note) <> '' and char_length(note) <= 2000)),
  -- ช่องเฉพาะชนิดที่ไม่ลับ {<field key>: ค่า}
  attrs jsonb not null default '{}'::jsonb check (jsonb_typeof(attrs) = 'object' and octet_length(attrs::text) <= 32768),
  -- ช่องลับ {<field key>: {v:1, n, c}} เก็บ ciphertext เท่านั้น (CHECK รูปแบบ envelope ทุกช่อง)
  secrets jsonb not null default '{}'::jsonb check (octet_length(secrets::text) <= 65536 and private.itas_secrets_ok(secrets)),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now(),
  foreign key (is_test, type_code) references public.itas_types (is_test, code),
  unique (id, is_test)
);
-- เลขทะเบียน/รหัสอุปกรณ์ไม่ซ้ำต่อโหมด (ไม่นับ null: ROM หรือแถวที่ไม่มีเลขสร้างได้หลายแถว)
create unique index itas_assets_reg_no_uk on public.itas_assets (is_test, reg_no) where reg_no is not null;
create unique index itas_assets_device_code_uk on public.itas_assets (is_test, device_code) where device_code is not null;
create index itas_assets_type_idx on public.itas_assets (is_test, type_code, status);
create index itas_assets_host_idx on public.itas_assets (is_test, host_code) where host_code is not null;
create index itas_assets_created_by_idx on public.itas_assets (created_by);
create index itas_assets_updated_by_idx on public.itas_assets (updated_by);
comment on table public.itas_assets is
  'ทะเบียนอุปกรณ์ IT ทุกชนิด (โครงกลาง) · ช่องลับเก็บเป็น ciphertext เท่านั้น · ลบไม่ได้ (ใช้สถานะ retired) · เขียนผ่าน app_itas_save_asset เท่านั้น · ลงประวัติใน itas_asset_log / itas_asset_moves โดย trigger';

create table public.itas_asset_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  asset_id uuid not null,
  action text not null check (action in ('created', 'updated')),
  actor_id uuid not null references public.employees(id),
  old_values jsonb,
  new_values jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (asset_id, is_test) references public.itas_assets (id, is_test),
  constraint itas_asset_log_old_values_ck check ((action = 'created') = (old_values is null))
);
create index itas_asset_log_asset_idx on public.itas_asset_log (asset_id, id);
create index itas_asset_log_actor_idx on public.itas_asset_log (actor_id);
comment on table public.itas_asset_log is
  'ประวัติเพิ่ม/แก้อุปกรณ์ (ค่าเดิม ค่าใหม่ทั้งแถว ช่องลับเป็น ciphertext) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itas_assets';

create table public.itas_asset_moves (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  asset_id uuid not null,
  from_host text,
  to_host text,
  from_slot text,
  to_slot text,
  from_status text,
  to_status text not null,
  actor_id uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (asset_id, is_test) references public.itas_assets (id, is_test)
);
create index itas_asset_moves_asset_idx on public.itas_asset_moves (asset_id, id);
create index itas_asset_moves_actor_idx on public.itas_asset_moves (actor_id);
comment on table public.itas_asset_moves is
  'ประวัติการย้าย/เปลี่ยนชิ้นส่วนอัตโนมัติ (host_code / slot / status เปลี่ยน รวมตอนสร้างที่มี host) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itas_assets';

-- ตู้เซฟ 1 แถวต่อโหมด · เก็บเฉพาะค่าที่ปลดล็อกในเบราว์เซอร์ต้องใช้ (ไม่มีรหัส/กุญแจ plaintext)
create table public.itas_vault (
  is_test boolean primary key default false,
  -- รุ่นของกุญแจหลัก (DEK) ใช้เป็นส่วนหนึ่งของ AAD ของช่องลับ · คงที่ 1 (ไม่เพิ่มเมื่อเปลี่ยนรหัสตู้เซฟ เพราะ DEK เดิม)
  key_version smallint not null default 1 check (key_version >= 1),
  -- ตัวนับการแก้ตู้เซฟ (optimistic lock ของ rotate)
  rev integer not null default 1 check (rev >= 1),
  kdf text not null check (kdf = 'PBKDF2-SHA256'),
  kdf_iterations integer not null check (kdf_iterations between 600000 and 10000000),
  salt text not null check (private.itas_b64_len(salt) is not distinct from 16),
  wrapped_key_pass jsonb not null check (private.itas_wrapped_key_error(wrapped_key_pass) is null),
  recovery_kdf_iterations integer not null check (recovery_kdf_iterations between 600000 and 10000000),
  recovery_salt text not null check (private.itas_b64_len(recovery_salt) is not distinct from 16),
  wrapped_key_recovery jsonb not null check (private.itas_wrapped_key_error(wrapped_key_recovery) is null),
  created_by uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  updated_by uuid not null references public.employees(id),
  updated_at timestamptz not null default now()
);
create index itas_vault_created_by_idx on public.itas_vault (created_by);
create index itas_vault_updated_by_idx on public.itas_vault (updated_by);
comment on table public.itas_vault is
  'ตู้เซฟของทะเบียนอุปกรณ์ (1 แถวต่อโหมด): salt/พารามิเตอร์ KDF/กุญแจหลักที่ห่อด้วยรหัสตู้เซฟและรหัสกู้คืน · ไม่มีรหัส/กุญแจ plaintext · init ได้ครั้งเดียว แก้ผ่าน app_itas_vault_rotate (ต้องส่ง rev ปัจจุบัน)';

create table public.itas_vault_log (
  id bigint generated always as identity primary key,
  is_test boolean not null default false,
  action text not null check (action in ('init', 'change_password', 'new_recovery', 'both')),
  rev integer not null,
  actor_id uuid not null references public.employees(id),
  created_at timestamptz not null default now(),
  foreign key (is_test) references public.itas_vault (is_test)
);
create index itas_vault_log_actor_idx on public.itas_vault_log (actor_id);
create index itas_vault_log_vault_idx on public.itas_vault_log (is_test, id);
comment on table public.itas_vault_log is
  'ประวัติตั้งตู้เซฟ/เปลี่ยนรหัส/ออกรหัสกู้คืนใหม่ (ไม่เก็บ secret ใด ๆ) · เพิ่มได้อย่างเดียว (trigger) · เขียนโดย trigger บน itas_vault';

-- 3. ปิดการเข้าถึงตรงทั้งหมด (deny-all) อ่าน/เขียนผ่าน RPC เท่านั้น --------------------
do $$
declare
  v_table text;
  v_sequence text;
begin
  foreach v_table in array array[
    'itas_types', 'itas_type_log', 'itas_assets', 'itas_asset_log', 'itas_asset_moves', 'itas_vault', 'itas_vault_log'
  ] loop
    -- ถอน service_role ด้วย (บันทึก ISO และตู้เซฟต้องไม่ถูกเขียนตรงด้วย secret key)
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

-- 4. ตัวช่วยของ RPC + trigger (ISO + กติกาของข้อมูล) -----------------------------------
create or replace function private.itas_clean(p_text text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(btrim(coalesce(p_text, ''), E' \t\r\n'), '')
$$;

-- ผู้ทำรายการ: persona (ถ้าอยู่ในโหมดทดสอบ) ไม่เช่นนั้นพนักงานตัวจริงที่ผูกบัญชีและเปิดใช้งาน (เหมือน private.itrp_actor)
create or replace function private.itas_actor()
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

-- สิทธิ์ทะเบียนอุปกรณ์ = ผู้ดูแลงาน IT (it_admin) ใน itwo_staff เท่านั้น (อ่านอย่างเดียว แก้สิทธิ์ที่ใบสั่งงาน IT) · ผู้อนุมัติขั้น IT ไม่มีสิทธิ์
create or replace function private.itas_is_it_admin(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.itwo_staff s where s.employee_id = p_employee_id and s.is_it_admin)
$$;

-- ผู้ทำรายการต้องเป็น it_admin (ทุก RPC เรียกเป็นลำดับแรกหลังด่าน lab-only) · คืนแถวพนักงาน
create or replace function private.itas_require_admin()
returns public.employees
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
begin
  v_actor := private.itas_actor();
  if not private.itas_is_it_admin(v_actor.id) then
    raise exception 'เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้' using errcode = 'insufficient_privilege';
  end if;
  return v_actor;
end;
$$;

-- ลบได้เฉพาะแถวทดสอบ ภายใน app_sandbox_purge_itas (ตั้ง itas.purge = on แบบ transaction-local) แถวจริงลบไม่ได้เลย
create or replace function private.itas_purge_allowed(p_is_test boolean)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_is_test and coalesce(current_setting('itas.purge', true), '') = 'on'
$$;

-- กันแก้/ลบประวัติ (type_log, asset_log, asset_moves, vault_log)
create or replace function private.itas_append_only_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ประวัติทะเบียนอุปกรณ์แก้ไขย้อนหลังไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'DELETE' then
    if private.itas_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ประวัติทะเบียนอุปกรณ์ลบไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  raise exception 'ประวัติทะเบียนอุปกรณ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
end;
$$;

-- ชนิดอุปกรณ์: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · แก้ได้ทุกคอลัมน์ยกเว้นโหมด/รหัสชนิด/ผู้และเวลาที่สร้าง
create or replace function private.itas_types_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itas_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ชนิดอุปกรณ์ลบไม่ได้ ให้ปิดการใช้งานแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ชนิดอุปกรณ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.is_test, new.code, new.created_by, new.created_at)
     is distinct from (old.is_test, old.code, old.created_by, old.created_at) then
    raise exception 'รหัสชนิดและผู้บันทึกของชนิดอุปกรณ์แก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- อุปกรณ์: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · id/โหมด/ชนิด/ผู้และเวลาที่สร้างแก้ไม่ได้ · เวลาแก้ล่าสุดตั้งโดย trigger (ใช้กันแก้ชนกัน)
create or replace function private.itas_assets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itas_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'อุปกรณ์ลบไม่ได้ ให้เปลี่ยนสถานะเป็นยกเลิกใช้งานแทน (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ทะเบียนอุปกรณ์ล้างทั้งตารางไม่ได้ (บันทึกสำหรับ ISO)' using errcode = 'insufficient_privilege';
  end if;
  if (new.id, new.is_test, new.type_code, new.created_by, new.created_at)
     is distinct from (old.id, old.is_test, old.type_code, old.created_by, old.created_at) then
    raise exception 'ชนิดอุปกรณ์และผู้บันทึกแก้ไขไม่ได้ (ถ้าชนิดผิด ให้ยกเลิกใช้งานแล้วเพิ่มรายการใหม่)' using errcode = 'insufficient_privilege';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ตู้เซฟ: ลบไม่ได้ (ยกเว้น purge แถวทดสอบ) · แก้ได้ครั้งละหนึ่งรุ่น (rev ต้องเพิ่มทีละ 1) · key_version/โหมด/ผู้และเวลาที่สร้างแก้ไม่ได้
create or replace function private.itas_vault_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if private.itas_purge_allowed(old.is_test) then
      return old;
    end if;
    raise exception 'ตู้เซฟลบไม่ได้ (ข้อมูลลับที่เข้ารหัสไว้จะกู้ไม่ได้)' using errcode = 'insufficient_privilege';
  elsif tg_op = 'TRUNCATE' then
    raise exception 'ตู้เซฟล้างทั้งตารางไม่ได้ (ข้อมูลลับที่เข้ารหัสไว้จะกู้ไม่ได้)' using errcode = 'insufficient_privilege';
  end if;
  if (new.is_test, new.key_version, new.created_by, new.created_at)
     is distinct from (old.is_test, old.key_version, old.created_by, old.created_at) then
    raise exception 'รุ่นของกุญแจหลักและผู้ตั้งตู้เซฟแก้ไขไม่ได้' using errcode = 'insufficient_privilege';
  end if;
  if new.rev <> old.rev + 1 then
    raise exception 'ตู้เซฟต้องแก้ทีละรุ่น (rev เพิ่มทีละ 1)' using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- ลง itas_type_log ทุกครั้งที่เพิ่ม/แก้นิยามชนิด (หลังบันทึก) · แถว seed (ไม่มีผู้ทำรายการ) ไม่ลง log
create or replace function private.itas_types_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_by is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    insert into public.itas_type_log (is_test, type_code, action, actor_id, old_values, new_values)
    values (new.is_test, new.code, 'created', new.updated_by, null, to_jsonb(new));
  elsif (to_jsonb(new) - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    insert into public.itas_type_log (is_test, type_code, action, actor_id, old_values, new_values)
    values (new.is_test, new.code, 'updated', new.updated_by, to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end;
$$;

-- ลง itas_asset_log ทุกครั้งที่เพิ่ม/แก้อุปกรณ์ (ทั้งแถว ช่องลับเป็น ciphertext) · แก้โดยไม่เปลี่ยนค่าใด ๆ ไม่ลง log
create or replace function private.itas_assets_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.itas_asset_log (is_test, asset_id, action, actor_id, old_values, new_values)
    values (new.is_test, new.id, 'created', new.updated_by, null, to_jsonb(new));
  elsif (to_jsonb(new) - 'updated_at' - 'updated_by') is distinct from (to_jsonb(old) - 'updated_at' - 'updated_by') then
    insert into public.itas_asset_log (is_test, asset_id, action, actor_id, old_values, new_values)
    values (new.is_test, new.id, 'updated', new.updated_by, to_jsonb(old), to_jsonb(new));
  end if;
  return null;
end;
$$;

-- ลง itas_asset_moves เมื่อ host_code / slot / status เปลี่ยน (ตอนสร้างลงเมื่อมี host_code) · ทุกทางเข้า ไม่ผ่านเฉพาะ RPC
create or replace function private.itas_assets_moves()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.host_code is not null then
      insert into public.itas_asset_moves (is_test, asset_id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_id)
      values (new.is_test, new.id, null, new.host_code, null, new.slot, null, new.status, new.updated_by);
    end if;
  elsif (new.host_code, new.slot, new.status) is distinct from (old.host_code, old.slot, old.status) then
    insert into public.itas_asset_moves (is_test, asset_id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_id)
    values (new.is_test, new.id, old.host_code, new.host_code, old.slot, new.slot, old.status, new.status, new.updated_by);
  end if;
  return null;
end;
$$;

-- ลง itas_vault_log (ไม่เก็บ secret ใด ๆ): ตั้งครั้งแรก / เปลี่ยนรหัส / ออกรหัสกู้คืนใหม่
create or replace function private.itas_vault_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pass_changed boolean;
  v_recovery_changed boolean;
begin
  if tg_op = 'INSERT' then
    insert into public.itas_vault_log (is_test, action, rev, actor_id) values (new.is_test, 'init', new.rev, new.updated_by);
    return null;
  end if;
  v_pass_changed := (new.kdf, new.kdf_iterations, new.salt, new.wrapped_key_pass) is distinct from (old.kdf, old.kdf_iterations, old.salt, old.wrapped_key_pass);
  v_recovery_changed := (new.recovery_kdf_iterations, new.recovery_salt, new.wrapped_key_recovery)
    is distinct from (old.recovery_kdf_iterations, old.recovery_salt, old.wrapped_key_recovery);
  insert into public.itas_vault_log (is_test, action, rev, actor_id)
  values (new.is_test,
          case when v_pass_changed and v_recovery_changed then 'both' when v_pass_changed then 'change_password' else 'new_recovery' end,
          new.rev, new.updated_by);
  return null;
end;
$$;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'itas_types', 'itas_type_log', 'itas_assets', 'itas_asset_log', 'itas_asset_moves', 'itas_vault', 'itas_vault_log'
  ] loop
    execute format('create trigger %I before insert or update or delete on public.%I for each row execute function private.sandbox_row_scope()',
                   v_table || '_sandbox_scope', v_table);
  end loop;
  -- เพิ่มได้อย่างเดียว: กัน UPDATE/DELETE (ยกเว้น purge แถวทดสอบ) และ TRUNCATE
  foreach v_table in array array['itas_type_log', 'itas_asset_log', 'itas_asset_moves', 'itas_vault_log'] loop
    execute format('create trigger %I before update or delete on public.%I for each row execute function private.itas_append_only_guard()',
                   v_table || '_append_only', v_table);
    execute format('create trigger %I before truncate on public.%I for each statement execute function private.itas_append_only_guard()',
                   v_table || '_no_truncate', v_table);
  end loop;
end $$;

-- ชื่อ trigger เรียงตัวอักษร: _guard ตรวจก่อน แล้วค่อย _sandbox_scope
create trigger itas_types_guard before update or delete on public.itas_types
  for each row execute function private.itas_types_guard();
create trigger itas_types_no_truncate before truncate on public.itas_types
  for each statement execute function private.itas_types_guard();
create trigger itas_types_log after insert or update on public.itas_types
  for each row execute function private.itas_types_log();
create trigger itas_assets_guard before update or delete on public.itas_assets
  for each row execute function private.itas_assets_guard();
create trigger itas_assets_no_truncate before truncate on public.itas_assets
  for each statement execute function private.itas_assets_guard();
create trigger itas_assets_log after insert or update on public.itas_assets
  for each row execute function private.itas_assets_log();
create trigger itas_assets_moves after insert or update on public.itas_assets
  for each row execute function private.itas_assets_moves();
create trigger itas_vault_guard before update or delete on public.itas_vault
  for each row execute function private.itas_vault_guard();
create trigger itas_vault_no_truncate before truncate on public.itas_vault
  for each statement execute function private.itas_vault_guard();
create trigger itas_vault_log after insert or update on public.itas_vault
  for each row execute function private.itas_vault_log();

-- 5. ชนิดตั้งต้น 23 ชนิด (จากหัวคอลัมน์ของไฟล์ Excel ตามสเปก ไม่มีค่าข้อมูลจริง) ---------------
-- รายการช่องเขียนแบบย่อ 'key|ป้ายชื่อ|ชนิดข้อมูล|ความยาวสูงสุด' (ชนิดข้อมูลว่าง = text, ความยาวว่าง = 200) แล้วแปลงเป็น jsonb ของ fields
-- p_attrs = ช่องไม่ลับ · p_secrets = ช่องลับ (ต่อท้าย) · order = ลำดับในรายการรวม · ตัวเลือก (choice) ไม่ได้ตั้งไว้ล่วงหน้า เพราะสเปกไม่ระบุ (it_admin เพิ่มเองได้)
create or replace function private.itas_field_defs(p_attrs text[], p_secrets text[])
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(f.def order by f.ord), '[]'::jsonb)
  from (
    select u.ord,
           jsonb_strip_nulls(jsonb_build_object(
             'key', p.parts[1],
             'label', p.parts[2],
             'type', coalesce(nullif(p.parts[3], ''), 'text'),
             'secret', u.ord > cardinality(p_attrs),
             'max', case when coalesce(nullif(p.parts[3], ''), 'text') = 'text' then coalesce(nullif(p.parts[4], '')::integer, 200) end,
             'order', u.ord)) as def
    from unnest(p_attrs || p_secrets) with ordinality as u(item, ord)
    cross join lateral (select string_to_array(u.item, '|') as parts) p
  ) f
$$;

-- seed ชนิดตั้งต้นของโหมดที่ระบุ (ไม่ทับชนิดที่มีอยู่แล้ว) · คืนจำนวนที่เพิ่ม · ใช้ตอน migration และตอนล้างข้อมูลทดสอบ
create or replace function private.itas_seed_types(p_is_test boolean)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.itas_types (is_test, code, name, reg_prefix, has_device_code, sort, fields)
  select p_is_test, t.code, t.name, t.reg_prefix, t.has_device_code, t.sort, private.itas_field_defs(t.attrs, t.secrets)
  from (values
    ('COMPUTER', 'คอมพิวเตอร์ (Computer)', null, true, 10,
      array['auth_name|Auth. Name (ชื่อผู้ใช้ในระบบ)', 'user_name|ชื่อผู้ใช้ (User)', 'division|แผนก/ส่วนงาน (Division)', 'os|ระบบปฏิบัติการ (OS)', 'os_bit|OS Bit',
            'express|Express', 'power_bi|Power BI', 'ms_office|MS Office', 'adobe|Adobe', 'iprime|I-Prime', 'realvnc|RealVNC', 'line|LINE',
            'payroll|Payroll (โปรแกรมเงินเดือน)', 'time_attendance|Time Attendance (สแกนเวลา)', 'pdf_reader|PDF Reader', 'anti_virus|Anti-Virus', 'autodesk|Autodesk',
            'other_software|ซอฟต์แวร์อื่น ๆ (Other Software)||500', 'doc_code|รหัสเอกสาร (Doc. Code)', 'started_on|วันเริ่มใช้ (Up-date)|date']::text[],
      array['ip|IP Address', 'mac|MAC Address', 'license_os|License OS', 'license_office|License MS Office', 'license_adobe|License Adobe',
            'license_pdf|License PDF', 'license_antivirus|License Anti-Virus', 'license_autodesk|License Autodesk']::text[]),
    ('LAPTOP', 'โน้ตบุ๊ก / PC Set / แท็บเล็ต (Laptop-PCSet-Tablet)', 'NBS/AIO', true, 20,
      array['cpu|CPU', 'cpu_model|CPU Model', 'rom_drive|ROM Drive', 'ram|RAM', 'ram2|RAM 2', 'ram_slot_type|RAM Slot Type', 'storage|Storage (HDD/SSD)', 'vga|VGA', 'os|OS']::text[],
      array['license_os|OS License']::text[]),
    ('MONITOR', 'จอภาพ (Monitor)', 'MNT', true, 30,
      array['monitor_type|Monitor Type', 'spec|Spec||500']::text[], array[]::text[]),
    ('PRINTER', 'เครื่องพิมพ์ (Printer)', 'PRT', true, 40,
      array['printer_type|Printer Type', 'color|Color']::text[], array[]::text[]),
    ('UPS', 'เครื่องสำรองไฟ (UPS)', 'UPS', true, 50,
      array['battery_model|Battery Model', 'battery_spec|Battery Spec', 'battery_serial|Battery Serial', 'battery_warranty|Battery Warranty', 'battery_slots|Battery Slots']::text[], array[]::text[]),
    ('PSU', 'พาวเวอร์ซัพพลาย (PSU)', 'PSU', false, 60,
      array['watt|Watt', 'pin|PIN (สเปกขั้วต่อ)']::text[], array[]::text[]),
    ('MAINBOARD', 'เมนบอร์ด (Mainboard)', 'MBD', false, 70,
      array['onboard_vga|Onboard VGA', 'vga_slot|VGA Slot', 'cpu_socket|CPU Socket', 'ram_slots|RAM Slots', 'ram_bus|RAM Bus', 'ram_slot_type|RAM Slot Type',
            'pair_cable_port|Pair Cable Port', 'sata_port|SATA Port']::text[], array[]::text[]),
    ('CPU', 'หน่วยประมวลผล (CPU)', 'CPU', false, 80,
      array['generation|Generation', 'socket|Socket', 'frequency|Frequency', 'fpo_batch|FPO / Batch']::text[], array[]::text[]),
    ('RAM', 'หน่วยความจำ (RAM)', 'RAM', false, 90,
      array['ram_type|RAM Type', 'capacity|Capacity', 'speed_bus|Speed / Bus', 'memory_type|Memory Type']::text[], array[]::text[]),
    ('STORAGE', 'ที่เก็บข้อมูล (HDD-SSD-M.2)', 'HDD/SSD', false, 100,
      array['storage_type|Storage Type', 'size|Size']::text[], array[]::text[]),
    ('CASE', 'เคสคอมพิวเตอร์ (Case)', 'CASE', false, 110,
      array['mainboard_support|Mainboard Support']::text[], array[]::text[]),
    ('MOUSE', 'เมาส์ (Mouse)', 'MOU', false, 120,
      array['port_type|Port Type', 'mouse_type|Mouse Type']::text[], array[]::text[]),
    ('KEYBOARD', 'คีย์บอร์ด (Keyboard)', 'KYB', false, 130,
      array['port_type|Port Type']::text[], array[]::text[]),
    ('VGA', 'การ์ดจอ (VGA)', 'VGA', false, 140,
      array['vga_type|VGA Type']::text[], array[]::text[]),
    ('ROM', 'ไดรฟ์ ROM (ROM)', 'ROM', false, 150,
      array['rom_type|ROM Type']::text[], array[]::text[]),
    ('LAN_CARD', 'การ์ดแลน (LAN Card)', 'LAC', false, 160,
      array['lan_ports|LAN Ports|number', 'port_type|Port Type', 'dtr_full|DTR Full', 'dtr_half|DTR Half']::text[], array[]::text[]),
    ('NETWORK', 'อุปกรณ์เครือข่าย (Network)', 'HUB/AP/…', false, 170,
      array['lan_ports|LAN Ports|number', 'port_type|Port Type', 'dtr_full|DTR Full', 'dtr_half|DTR Half']::text[], array[]::text[]),
    ('ACCESSORY', 'อุปกรณ์เสริมคอมพิวเตอร์ (Computer Accessories)', 'ACC', false, 180,
      array['detail|Detail||1000']::text[], array[]::text[]),
    ('SOFTWARE', 'ซอฟต์แวร์ (Software)', 'SFW', false, 190,
      array['series|Series', 'software_type|Software Type', 'os|OS']::text[], array['license|License']::text[]),
    ('INK_TONER', 'หมึก / โทนเนอร์ (INK&Toner)', 'INK', false, 200,
      array['ink_type|Ink Type']::text[], array[]::text[]),
    ('PHONE_SIM', 'สมาร์ทโฟนและซิม (SMARTPHONE & SIM)', 'SMP/SIM', false, 210,
      array['phone_type|Phone Type', 'property_reg_no|Property Reg. No.', 'comment|Comment||500']::text[], array[]::text[]),
    ('PROJECTOR', 'โปรเจกเตอร์ (Projector)', 'PJT', false, 220,
      array['projector_type|Projector Type']::text[], array[]::text[]),
    ('OTHER', 'อื่น ๆ (Other)', null, false, 230,
      array['detail|Detail||1000', 'quantity|Quantity|number']::text[], array[]::text[])
  ) as t(code, name, reg_prefix, has_device_code, sort, attrs, secrets)
  on conflict (is_test, code) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- seed ทั้งโหมดจริงและโหมดทดสอบ (auth.uid() เป็น null ตอน migration trigger แยกโหมดจึงเคารพค่า is_test ที่ส่งมา)
select private.itas_seed_types(false);
select private.itas_seed_types(true);

-- 6. ตารางใหม่รู้จักโหมดทดสอบ: replace private.sandbox_unguarded_tables() -----------------------
-- เริ่มจากนิยามล่าสุดบน main (20261220010000_st_rb_chemical_store.sql) ครบทุกชื่อ + เพิ่ม 7 ตารางใหม่ในส่วน to_regclass (หลัง itrp_*)
create or replace function private.sandbox_unguarded_tables()
returns text[] language sql stable set search_path = '' as $$
  select array['ncr_reports','ncr_responsibilities','ncr_losses','ncr_status_history','ncr_attachments',
    'ncr_defect_types','document_counters','audit_logs','sandbox_sessions','ncr_outcomes','ncr_info_requests',
    'qc_inspection_templates','qc_inspection_template_items','qc_inspection_reports',
    'qc_inspection_items','qc_inspection_approvals','qc_inspection_history',
    'bom_master_state','bom_items','bom_compounds','bom_colors','bom_color_sets','bom_packages',
    'bom_boms','bom_bom_lines','bom_processes','bom_routings','bom_deleted_keys',
    'bom_customers','bom_orders','bom_jobs','bom_stock','bom_stock_moves','bom_fg_moves','bom_rod_lots','bom_rod_moves',
    'bom_gr_config','bom_gr_job_plans','bom_gr_records','bom_rod_requests','bom_gr_handovers',
    'rf_master_state','rf_materials','rf_recipes','rf_orders','rf_deleted_keys',
    'rf_molds','rf_material_lots','rf_requisitions','rf_lots','rf_transfers','rf_fg_boxes','rf_qc_records','rf_ncrs','rf_purchase_orders','rf_chem_docs',
    'client_error_logs']
  || array(select t from unnest(array['itwo_work_orders','itwo_events','itwo_access_changes','itwo_doc_counters','itwo_admin_log',
                                      'itwo_reworks','itwo_attachments','itwo_comments',
                                      'itrp_requests','itrp_events','itrp_doc_counters','itrp_admin_log','itrp_reworks',
                                      'itrp_comments','itrp_attachments','itrp_repair_reports','itrp_repair_parts',
                                      'itrp_devices','itrp_device_log','itrp_report_devices','itrp_history_entries',
                                      'itrp_history_entry_revisions',
                                      'itas_types','itas_type_log','itas_assets','itas_asset_log','itas_asset_moves',
                                      'itas_vault','itas_vault_log']) as t
           where to_regclass('public.' || t) is not null)
$$;
revoke all on function private.sandbox_unguarded_tables() from public, anon, authenticated;

-- 7. ตัวช่วยตรวจข้อมูลของ RPC (ผิดแล้วแจ้งเป็นภาษาไทย) --------------------------------------
-- ข้อความ: null/JSON null -> null · ต้องเป็น string · ตัดช่องว่างหัวท้าย · ว่าง -> null · ยาวเกิน/มีอักขระควบคุมไม่ได้ (p_multiline = ยอมขึ้นบรรทัดใหม่/แท็บ)
create or replace function private.itas_text_field(p_value jsonb, p_label text, p_max integer, p_multiline boolean default false)
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
  v_text := private.itas_clean(p_value #>> '{}');
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
create or replace function private.itas_date_field(p_value jsonb, p_label text)
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
  v_text := private.itas_clean(p_value #>> '{}');
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

-- ตัวเลขไม่ติดลบ ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่เกิน p_max · รับ JSON number หรือข้อความตัวเลข
create or replace function private.itas_numeric_field(p_value jsonb, p_label text, p_max numeric)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_text text;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if jsonb_typeof(p_value) not in ('number', 'string') then
    raise exception 'ช่อง "%" ต้องเป็นตัวเลข', p_label using errcode = 'check_violation';
  end if;
  v_text := private.itas_clean(p_value #>> '{}');
  if v_text is null then
    return null;
  end if;
  if v_text !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$' then
    raise exception 'ช่อง "%" ต้องเป็นตัวเลขไม่ติดลบ (ทศนิยมไม่เกิน 2 ตำแหน่ง)', p_label using errcode = 'check_violation';
  end if;
  if v_text::numeric > p_max then
    raise exception 'ช่อง "%" ต้องไม่เกิน %', p_label, p_max using errcode = 'check_violation';
  end if;
  return v_text::numeric;
end;
$$;

-- หานิยามช่องตาม key ในรายการ fields ของชนิด (ไม่พบ = null)
create or replace function private.itas_field_def(p_fields jsonb, p_key text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select e.value from jsonb_array_elements(p_fields) e where e.value ->> 'key' = p_key limit 1
$$;

-- ตรวจค่าของช่องเฉพาะชนิด (ไม่ลับ) ตามนิยามช่อง · คืนค่าที่ทำความสะอาดแล้ว (null = ล้างค่า)
--   text: ข้อความ ≤ max (ค่าเริ่มต้น 200) · number: JSON number ไม่เกิน ±1e12 · date: YYYY-MM-DD · choice: ต้องอยู่ในตัวเลือก
create or replace function private.itas_attr_value(p_def jsonb, p_value jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_label text := p_def ->> 'label';
  v_type text := p_def ->> 'type';
  v_text text;
  v_date date;
  v_number numeric;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    return null;
  end if;
  if v_type = 'text' then
    v_text := private.itas_text_field(p_value, v_label, coalesce((p_def ->> 'max')::integer, 200), true);
    return case when v_text is null then null else to_jsonb(v_text) end;
  elsif v_type = 'number' then
    if jsonb_typeof(p_value) <> 'number' then
      raise exception 'ช่อง "%" ต้องเป็นตัวเลข', v_label using errcode = 'check_violation';
    end if;
    v_number := (p_value #>> '{}')::numeric;
    if abs(v_number) > 1000000000000 then
      raise exception 'ช่อง "%" ต้องมีค่าไม่เกิน ±1,000,000,000,000', v_label using errcode = 'check_violation';
    end if;
    return to_jsonb(v_number);
  elsif v_type = 'date' then
    v_date := private.itas_date_field(p_value, v_label);
    return case when v_date is null then null else to_jsonb(to_char(v_date, 'YYYY-MM-DD')) end;
  elsif v_type = 'choice' then
    v_text := private.itas_text_field(p_value, v_label, 100, false);
    if v_text is null then
      return null;
    end if;
    if not exists (select 1 from jsonb_array_elements_text(p_def -> 'choices') c where c.value = v_text) then
      raise exception 'ช่อง "%" ต้องเลือกจากตัวเลือกที่กำหนด', v_label using errcode = 'check_violation';
    end if;
    return to_jsonb(v_text);
  end if;
  raise exception 'ชนิดข้อมูลของช่อง "%" ไม่ถูกต้อง', v_label using errcode = 'check_violation';
end;
$$;

-- ตรวจและจัดรูปนิยามช่องของชนิด (ลำดับ order = ลำดับในรายการ) · คืน jsonb array ที่จัดรูปแล้ว
--   แต่ละช่อง: key (a-z 0-9 _ ขึ้นต้นด้วยตัวอักษร ≤40 ห้ามซ้ำ), label (1–100), type text|number|date|choice, secret (boolean ค่าเริ่มต้น false · ช่องลับต้องเป็น text),
--   max (เฉพาะ text 1–4000 ค่าเริ่มต้น 200), choices (เฉพาะ choice: 1–100 ตัวเลือกไม่ซ้ำ ≤100 ตัวอักษร), hidden (ซ่อนจากหน้าจอ ใช้แทนการลบช่องที่มีข้อมูล)
create or replace function private.itas_normalize_fields(p_fields jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_result jsonb := '[]'::jsonb;
  v_keys text[] := '{}';
  v_el jsonb;
  v_ord integer := 0;
  v_unknown text;
  v_key text;
  v_label text;
  v_type text;
  v_secret boolean;
  v_hidden boolean;
  v_max integer;
  v_choices jsonb;
  v_choice_texts text[];
  v_def jsonb;
begin
  if jsonb_typeof(p_fields) is distinct from 'array' then
    raise exception 'นิยามช่องต้องเป็นรายการ' using errcode = 'check_violation';
  end if;
  if jsonb_array_length(p_fields) > 80 then
    raise exception 'ชนิดอุปกรณ์มีช่องเฉพาะได้ไม่เกิน 80 ช่อง' using errcode = 'check_violation';
  end if;
  for v_el in select e.value from jsonb_array_elements(p_fields) e loop
    v_ord := v_ord + 1;
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'ช่องที่ % ของนิยามไม่ถูกต้อง', v_ord using errcode = 'check_violation';
    end if;
    select k into v_unknown from jsonb_object_keys(v_el) k
    where k <> all (array['key', 'label', 'type', 'choices', 'secret', 'max', 'order', 'hidden']) limit 1;
    if v_unknown is not null then
      raise exception 'ช่องที่ %: ไม่รู้จักคุณสมบัติ "%"', v_ord, v_unknown using errcode = 'check_violation';
    end if;
    v_key := v_el ->> 'key';
    if jsonb_typeof(v_el -> 'key') is distinct from 'string' or v_key !~ '^[a-z][a-z0-9_]{0,39}$' then
      raise exception 'ช่องที่ %: key ต้องเป็นตัวพิมพ์เล็ก/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร ไม่เกิน 40 ตัว', v_ord using errcode = 'check_violation';
    end if;
    if v_key = any (v_keys) then
      raise exception 'ช่อง key "%" ซ้ำกัน', v_key using errcode = 'check_violation';
    end if;
    v_keys := v_keys || v_key;
    v_label := private.itas_text_field(v_el -> 'label', 'ป้ายชื่อช่อง ' || v_key, 100);
    if v_label is null then
      raise exception 'ช่อง "%": กรุณาระบุป้ายชื่อ', v_key using errcode = 'check_violation';
    end if;
    v_type := coalesce(v_el ->> 'type', '');
    if jsonb_typeof(v_el -> 'type') is distinct from 'string' or v_type not in ('text', 'number', 'date', 'choice') then
      raise exception 'ช่อง "%": ชนิดข้อมูลต้องเป็น text, number, date หรือ choice', v_key using errcode = 'check_violation';
    end if;
    if v_el ? 'secret' and jsonb_typeof(v_el -> 'secret') is distinct from 'boolean' then
      raise exception 'ช่อง "%": secret ต้องเป็น true/false', v_key using errcode = 'check_violation';
    end if;
    if v_el ? 'hidden' and jsonb_typeof(v_el -> 'hidden') is distinct from 'boolean' then
      raise exception 'ช่อง "%": hidden ต้องเป็น true/false', v_key using errcode = 'check_violation';
    end if;
    v_secret := coalesce((v_el ->> 'secret')::boolean, false);
    v_hidden := coalesce((v_el ->> 'hidden')::boolean, false);
    if v_secret and v_type <> 'text' then
      raise exception 'ช่อง "%": ช่องลับต้องเป็นชนิดข้อความ (text)', v_key using errcode = 'check_violation';
    end if;
    v_max := null;
    v_choices := null;
    if v_type = 'text' then
      if v_el ? 'max' then
        -- แยกเงื่อนไขด้วย CASE (OR ไม่รับประกันลำดับการประเมิน) กัน cast ข้อความที่ไม่ใช่ตัวเลขแล้วได้ error ที่ไม่ใช่ภาษาไทย
        if (case
              when jsonb_typeof(v_el -> 'max') is distinct from 'number' then true
              when (v_el ->> 'max') !~ '^[0-9]{1,4}' then true
              else (v_el ->> 'max')::integer not between 1 and 4000
            end) then
          raise exception 'ช่อง "%": max ต้องเป็นจำนวนเต็ม 1–4000', v_key using errcode = 'check_violation';
        end if;
        v_max := (v_el ->> 'max')::integer;
      else
        v_max := 200;
      end if;
    elsif v_el ? 'max' then
      raise exception 'ช่อง "%": max ใช้ได้เฉพาะชนิดข้อความ', v_key using errcode = 'check_violation';
    end if;
    if v_type = 'choice' then
      if (case
            when jsonb_typeof(v_el -> 'choices') is distinct from 'array' then true
            else jsonb_array_length(v_el -> 'choices') not between 1 and 100
          end) then
        raise exception 'ช่อง "%": ชนิด choice ต้องมีตัวเลือก 1–100 ตัว', v_key using errcode = 'check_violation';
      end if;
      v_choice_texts := '{}';
      for v_def in select c.value from jsonb_array_elements(v_el -> 'choices') c loop
        if jsonb_typeof(v_def) <> 'string' or private.itas_clean(v_def #>> '{}') is null or char_length(private.itas_clean(v_def #>> '{}')) > 100 then
          raise exception 'ช่อง "%": ตัวเลือกต้องเป็นข้อความ 1–100 ตัวอักษร', v_key using errcode = 'check_violation';
        end if;
        if private.itas_clean(v_def #>> '{}') = any (v_choice_texts) then
          raise exception 'ช่อง "%": ตัวเลือก "%" ซ้ำกัน', v_key, private.itas_clean(v_def #>> '{}') using errcode = 'check_violation';
        end if;
        v_choice_texts := v_choice_texts || private.itas_clean(v_def #>> '{}');
      end loop;
      v_choices := to_jsonb(v_choice_texts);
    elsif v_el ? 'choices' then
      raise exception 'ช่อง "%": choices ใช้ได้เฉพาะชนิด choice', v_key using errcode = 'check_violation';
    end if;
    v_result := v_result || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'key', v_key, 'label', v_label, 'type', v_type, 'secret', v_secret, 'order', v_ord,
      'max', v_max, 'choices', v_choices, 'hidden', case when v_hidden then true end)));
  end loop;
  return v_result;
end;
$$;

-- รูป JSON ของอุปกรณ์หนึ่งแถว (ใช้ร่วมกันทุก RPC ที่คืนอุปกรณ์) · secrets เป็น ciphertext เหมือนที่เก็บ
create or replace function private.itas_asset_json(p_asset public.itas_assets)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_asset.id,
    'type_code', p_asset.type_code,
    'reg_no', p_asset.reg_no,
    'device_code', p_asset.device_code,
    'name', p_asset.name,
    'model', p_asset.model,
    'serial', p_asset.serial,
    'status', p_asset.status,
    'host_code', p_asset.host_code,
    'slot', p_asset.slot,
    'place', p_asset.place,
    'install_date', p_asset.install_date,
    'record_date', p_asset.record_date,
    'purchase_date', p_asset.purchase_date,
    'vendor', p_asset.vendor,
    'price', p_asset.price,
    'tax_rate', p_asset.tax_rate,
    'warranty_text', p_asset.warranty_text,
    'warranty_end', p_asset.warranty_end,
    'express_code', p_asset.express_code,
    'account_no', p_asset.account_no,
    'note', p_asset.note,
    'attrs', p_asset.attrs,
    'secrets', p_asset.secrets,
    'created_at', p_asset.created_at,
    'created_by_employee_no', (select e.employee_no from public.employees e where e.id = p_asset.created_by),
    'updated_at', p_asset.updated_at,
    'updated_by_employee_no', (select e.employee_no from public.employees e where e.id = p_asset.updated_by)
  )
$$;

-- 8. RPC ชนิดอุปกรณ์ -----------------------------------------------------------------
-- รายการชนิดของโหมดปัจจุบัน (รวมที่ปิดใช้งาน) พร้อมจำนวนอุปกรณ์ · เฉพาะ it_admin
--   [{code, name, reg_prefix, has_device_code, fields[{key,label,type,secret,order,max?,choices?,hidden?}], sort, is_active, asset_count, updated_at}] เรียงตาม sort
create or replace function public.app_itas_list_types()
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
  v_actor := private.itas_require_admin();
  return (
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', t.code, 'name', t.name, 'reg_prefix', t.reg_prefix, 'has_device_code', t.has_device_code,
             'fields', t.fields, 'sort', t.sort, 'is_active', t.is_active, 'updated_at', t.updated_at,
             'asset_count', (select count(*)::integer from public.itas_assets a where a.is_test = t.is_test and a.type_code = t.code)
           ) order by t.sort, t.code), '[]'::jsonb)
    from public.itas_types t
    where t.is_test = v_actor.is_test);
end;
$$;

-- เพิ่ม/แก้ชนิดอุปกรณ์ (เฉพาะ it_admin): ไม่มีรหัสนี้ในโหมดนี้ = เพิ่ม · มีแล้ว = แก้ (ส่งค่าทั้งหมด ไม่ใช่เฉพาะที่เปลี่ยน)
--   กติกาแก้นิยามช่อง: ลบช่องที่มีข้อมูลในอุปกรณ์ไหนแล้วไม่ได้ (ใช้ hidden = true) · เปลี่ยนชนิดข้อมูล/ช่องลับของช่องที่มีข้อมูลแล้วไม่ได้
--   ลง itas_type_log โดย trigger · ไม่มีค่าใดเปลี่ยน = changed false (ไม่ลง log) · คืน {code, created, changed}
create or replace function public.app_itas_save_type(
  p_code text,
  p_name text,
  p_reg_prefix text default null,
  p_has_device_code boolean default false,
  p_fields jsonb default '[]'::jsonb,
  p_sort integer default 100,
  p_is_active boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_code text := upper(private.itas_clean(p_code));
  v_name text := private.itas_clean(p_name);
  v_prefix text := private.itas_clean(p_reg_prefix);
  v_fields jsonb;
  v_old public.itas_types%rowtype;
  v_old_def jsonb;
  v_new_def jsonb;
  v_key text;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if v_code is null or v_code !~ '^[A-Z][A-Z0-9_]{1,29}$' then
    raise exception 'รหัสชนิดอุปกรณ์ต้องเป็นตัวพิมพ์ใหญ่ A–Z/ตัวเลข/_ ขึ้นต้นด้วยตัวอักษร ยาว 2–30 ตัว' using errcode = 'check_violation';
  end if;
  if v_name is null then
    raise exception 'กรุณาระบุชื่อชนิดอุปกรณ์' using errcode = 'check_violation';
  end if;
  if char_length(v_name) > 100 then
    raise exception 'ชื่อชนิดอุปกรณ์ต้องไม่เกิน 100 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if char_length(coalesce(v_prefix, '')) > 40 then
    raise exception 'คำนำหน้าเลขทะเบียนต้องไม่เกิน 40 ตัวอักษร' using errcode = 'check_violation';
  end if;
  if p_has_device_code is null or p_is_active is null then
    raise exception 'กรุณาระบุค่า มี/ไม่มีรหัสอุปกรณ์ และสถานะการใช้งานของชนิดให้ครบ' using errcode = 'check_violation';
  end if;
  if p_sort is null or p_sort not between 0 and 9999 then
    raise exception 'ลำดับต้องเป็นจำนวนเต็ม 0–9999' using errcode = 'check_violation';
  end if;
  v_fields := private.itas_normalize_fields(p_fields);

  select * into v_old from public.itas_types t where t.is_test = v_actor.is_test and t.code = v_code for update;
  if v_old.code is null then
    insert into public.itas_types (is_test, code, name, reg_prefix, has_device_code, fields, sort, is_active, created_by, updated_by)
    values (v_actor.is_test, v_code, v_name, v_prefix, p_has_device_code, v_fields, p_sort, p_is_active, v_actor.id, v_actor.id);
    return jsonb_build_object('code', v_code, 'created', true, 'changed', true);
  end if;

  -- แก้นิยามช่อง: ช่องเดิมที่หายไป/เปลี่ยนชนิดข้อมูล/เปลี่ยนสถานะลับ ทำได้เมื่อยังไม่มีข้อมูลในช่องนั้นเลย
  for v_old_def in select e.value from jsonb_array_elements(v_old.fields) e loop
    v_key := v_old_def ->> 'key';
    v_new_def := private.itas_field_def(v_fields, v_key);
    if v_new_def is null
       or (v_new_def ->> 'type') is distinct from (v_old_def ->> 'type')
       or (v_new_def ->> 'secret') is distinct from (v_old_def ->> 'secret') then
      if exists (select 1 from public.itas_assets a
                 where a.is_test = v_old.is_test and a.type_code = v_old.code and (a.attrs ? v_key or a.secrets ? v_key)) then
        raise exception 'ช่อง "%" มีข้อมูลในทะเบียนแล้ว ลบหรือเปลี่ยนชนิด/ความลับไม่ได้ (ถ้าไม่ต้องการแสดง ให้ซ่อนช่องแทน)', v_old_def ->> 'label' using errcode = 'check_violation';
      end if;
    end if;
  end loop;

  if (v_name, v_prefix, p_has_device_code, v_fields, p_sort, p_is_active)
     is not distinct from (v_old.name, v_old.reg_prefix, v_old.has_device_code, v_old.fields, v_old.sort, v_old.is_active) then
    return jsonb_build_object('code', v_code, 'created', false, 'changed', false);
  end if;
  update public.itas_types
  set name = v_name, reg_prefix = v_prefix, has_device_code = p_has_device_code, fields = v_fields,
      sort = p_sort, is_active = p_is_active, updated_by = v_actor.id
  where is_test = v_old.is_test and code = v_old.code;
  return jsonb_build_object('code', v_code, 'created', false, 'changed', true);
end;
$$;

-- 9. RPC อุปกรณ์ ---------------------------------------------------------------------
-- รายการอุปกรณ์ (เฉพาะ it_admin) · คืน {total, items[อุปกรณ์...]} · secrets เป็น ciphertext (หน้าเว็บถอดรหัสเองหลังปลดล็อก)
--   p_type_code ว่าง = ทุกชนิด · p_status ว่าง = ทุกสถานะ (in_use/spare/broken/retired) · p_host_code = เฉพาะที่ติดตั้งที่รหัสนั้น (ตรงทั้งคำ)
--   p_search ค้นแบบไม่สนตัวพิมพ์ใหญ่เล็กใน ชื่อ/รุ่น/Serial/เลขทะเบียน/รหัสอุปกรณ์/ติดตั้งที่ (ใช้ position ไม่ใช้ like จึงไม่ตีความ % _) · ค้นช่องลับไม่ได้ (ต้องค้นในเบราว์เซอร์หลังปลดล็อก)
--   เรียงตาม รหัสอุปกรณ์/เลขทะเบียน/ชื่อ · p_limit 1–2000 (ค่าเริ่มต้น 1000) · p_offset ≥ 0
create or replace function public.app_itas_list_assets(
  p_type_code text default null,
  p_search text default null,
  p_status text default null,
  p_host_code text default null,
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
  v_type text := upper(private.itas_clean(p_type_code));
  v_search text := lower(private.itas_clean(p_search));
  v_status text := private.itas_clean(p_status);
  v_host text := upper(private.itas_clean(p_host_code));
  v_result jsonb;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if v_status is not null and v_status not in ('in_use', 'spare', 'broken', 'retired') then
    raise exception 'สถานะต้องเป็น ใช้งาน สำรอง ชำรุด หรือ ยกเลิกใช้งาน' using errcode = 'check_violation';
  end if;
  if p_limit is null or p_limit not between 1 and 2000 then
    raise exception 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–2000' using errcode = 'check_violation';
  end if;
  if p_offset is null or p_offset < 0 then
    raise exception 'ตำแหน่งเริ่มต้องไม่ติดลบ' using errcode = 'check_violation';
  end if;
  -- f = แถวที่ตรงเงื่อนไข (เก็บแค่ id + คีย์เรียง) · หน้าที่ขอ = limit/offset จาก f แล้วค่อยดึงแถวเต็มมาแปลงเป็น JSON
  with f as (
    select a.id, coalesce(a.device_code, a.reg_no, a.name, '') as sort_key
    from public.itas_assets a
    where a.is_test = v_actor.is_test
      and (v_type is null or a.type_code = v_type)
      and (v_status is null or a.status = v_status)
      and (v_host is null or a.host_code = v_host)
      and (v_search is null
           or position(v_search in lower(coalesce(a.name, ''))) > 0
           or position(v_search in lower(coalesce(a.model, ''))) > 0
           or position(v_search in lower(coalesce(a.serial, ''))) > 0
           or position(v_search in lower(coalesce(a.reg_no, ''))) > 0
           or position(v_search in lower(coalesce(a.device_code, ''))) > 0
           or position(v_search in lower(coalesce(a.host_code, ''))) > 0)
  ),
  pg as (
    select f.id, f.sort_key from f order by f.sort_key, f.id limit p_limit offset p_offset
  )
  select jsonb_build_object(
           'total', (select count(*)::integer from f),
           'items', coalesce((
             select jsonb_agg(private.itas_asset_json(a) order by pg.sort_key, pg.id)
             from pg join public.itas_assets a on a.id = pg.id), '[]'::jsonb))
  into v_result;
  return v_result;
end;
$$;

-- ดูอุปกรณ์หนึ่งชิ้น (เฉพาะ it_admin) · คืนรูปอุปกรณ์เดียวกับในรายการ
create or replace function public.app_itas_get_asset(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_asset public.itas_assets%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  select * into v_asset from public.itas_assets a where a.id = p_id and a.is_test = v_actor.is_test;
  if v_asset.id is null then
    raise exception 'ไม่พบอุปกรณ์นี้' using errcode = 'check_violation';
  end if;
  return private.itas_asset_json(v_asset);
end;
$$;

-- เพิ่ม/แก้อุปกรณ์ (เฉพาะ it_admin)
--   p_id: ว่าง = เพิ่มใหม่ (ฐานข้อมูลสร้าง uuid) · ส่ง uuid ที่ยังไม่มี = เพิ่มใหม่ด้วย id นั้น (หน้าเว็บสร้างเองเพราะต้องใช้เป็น AAD ตอนเข้ารหัสก่อนส่ง) · ส่ง uuid ที่มีแล้ว = แก้ (ต้องส่ง expected_updated_at)
--   p_type_code: จำเป็นตอนเพิ่ม (ชนิดต้องอยู่ในโหมดนี้และเปิดใช้งาน) · ตอนแก้ไม่ต้องส่ง ถ้าส่งต้องตรงกับของเดิม (เปลี่ยนชนิดไม่ได้)
--   p_data: ช่องกลาง {reg_no, device_code, name, model, serial, status, host_code, slot, place, install_date, record_date, purchase_date, vendor, price, tax_rate,
--     warranty_text, warranty_end, express_code, account_no, note} · ส่งเฉพาะช่องที่ต้องการตั้ง/เปลี่ยน (ช่องที่ไม่ส่งคงค่าเดิม) · ส่ง null/"" = ล้างค่า (status ล้างไม่ได้) · ช่องที่ไม่รู้จัก = ผิดพลาด
--     reg_no / device_code / host_code ถูกตัดช่องว่างและแปลงเป็นตัวพิมพ์ใหญ่ · วันที่ YYYY-MM-DD (ค.ศ.) · ตอนเพิ่ม status ค่าเริ่มต้น in_use
--   p_attrs: ช่องเฉพาะชนิดที่ไม่ลับ {<key>: ค่า} ตามนิยามชนิด (แก้เฉพาะ key ที่ส่ง · null = ล้าง) · key ที่ไม่มีในชนิด หรือเป็นช่องลับ = ผิดพลาด
--   p_secrets: ช่องลับ {<key>: {v:1, n, c}} ที่เข้ารหัสในเบราว์เซอร์แล้วเท่านั้น (แก้เฉพาะ key ที่ส่ง · null = ลบค่าลับของช่องนั้น) · key ที่ไม่ใช่ช่องลับของชนิด/envelope ผิดรูป = ผิดพลาด
--   p_expected_updated_at: เวลา updated_at ที่หน้าเว็บโหลดมา (กันแก้ชนกัน · ไม่ตรง = errcode 40001 ให้โหลดใหม่)
--   ต้องมีอย่างน้อยหนึ่งใน เลขทะเบียน/รหัสอุปกรณ์/ชื่อ/รุ่น/Serial/หมายเหตุ · ไม่มีค่าใดเปลี่ยน = changed false (ไม่ลง log/moves)
--   คืน {asset, created, changed} · ลง itas_asset_log / itas_asset_moves โดย trigger
create or replace function public.app_itas_save_asset(
  p_id uuid default null,
  p_type_code text default null,
  p_data jsonb default '{}'::jsonb,
  p_attrs jsonb default '{}'::jsonb,
  p_secrets jsonb default '{}'::jsonb,
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
  v_attrs_in jsonb := coalesce(p_attrs, '{}'::jsonb);
  v_secrets_in jsonb := coalesce(p_secrets, '{}'::jsonb);
  v_type_code text := upper(private.itas_clean(p_type_code));
  v_old public.itas_assets%rowtype;
  v_row public.itas_assets%rowtype;
  v_type public.itas_types%rowtype;
  v_exists boolean;
  v_key text;
  v_val jsonb;
  v_def jsonb;
  v_clean jsonb;
  v_error text;
  v_saved public.itas_assets%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if jsonb_typeof(v_data) <> 'object' or jsonb_typeof(v_attrs_in) <> 'object' or jsonb_typeof(v_secrets_in) <> 'object' then
    raise exception 'ข้อมูลที่ส่งมาต้องเป็นรูปแบบ {ช่อง: ค่า}' using errcode = 'check_violation';
  end if;

  if p_id is not null then
    select * into v_old from public.itas_assets a where a.id = p_id for update;
  end if;
  v_exists := v_old.id is not null;
  if v_exists and v_old.is_test <> v_actor.is_test then
    raise exception 'ไม่พบอุปกรณ์นี้ หรือรหัสอุปกรณ์ (id) นี้ถูกใช้แล้ว' using errcode = 'check_violation';
  end if;

  if v_exists then
    if p_expected_updated_at is null then
      raise exception 'อุปกรณ์นี้มีอยู่แล้ว กรุณาโหลดข้อมูลล่าสุดแล้วแก้ไข (ต้องส่ง expected_updated_at)' using errcode = 'check_violation';
    end if;
    if p_expected_updated_at <> v_old.updated_at then
      raise exception 'ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่' using errcode = '40001';
    end if;
    if v_type_code is not null and v_type_code <> v_old.type_code then
      raise exception 'เปลี่ยนชนิดอุปกรณ์ไม่ได้ (ถ้าชนิดผิด ให้ยกเลิกใช้งานแล้วเพิ่มรายการใหม่)' using errcode = 'check_violation';
    end if;
    v_row := v_old;
    select * into v_type from public.itas_types t where t.is_test = v_old.is_test and t.code = v_old.type_code;
  else
    if v_type_code is null then
      raise exception 'กรุณาเลือกชนิดอุปกรณ์' using errcode = 'check_violation';
    end if;
    select * into v_type from public.itas_types t where t.is_test = v_actor.is_test and t.code = v_type_code;
    if v_type.code is null then
      raise exception 'ไม่พบชนิดอุปกรณ์นี้' using errcode = 'check_violation';
    end if;
    if not v_type.is_active then
      raise exception 'ชนิดอุปกรณ์นี้ปิดการใช้งานอยู่ เพิ่มรายการใหม่ไม่ได้' using errcode = 'check_violation';
    end if;
    v_row.id := coalesce(p_id, gen_random_uuid());
    v_row.is_test := v_actor.is_test;
    v_row.type_code := v_type.code;
    v_row.status := 'in_use';
    v_row.attrs := '{}'::jsonb;
    v_row.secrets := '{}'::jsonb;
  end if;

  -- ช่องกลาง: ตรวจทีละช่องที่ส่งมา (ช่องที่ไม่ส่งคงเดิม)
  for v_key, v_val in select d.key, d.value from jsonb_each(v_data) d loop
    case v_key
      when 'reg_no' then v_row.reg_no := upper(private.itas_text_field(v_val, 'เลขทะเบียน', 50));
      when 'device_code' then v_row.device_code := upper(private.itas_text_field(v_val, 'รหัสอุปกรณ์', 50));
      when 'name' then v_row.name := private.itas_text_field(v_val, 'ชื่อ', 200);
      when 'model' then v_row.model := private.itas_text_field(v_val, 'รุ่น', 200);
      when 'serial' then v_row.serial := private.itas_text_field(v_val, 'Serial', 200);
      when 'status' then
        v_row.status := private.itas_text_field(v_val, 'สถานะ', 20);
        if v_row.status is null or v_row.status not in ('in_use', 'spare', 'broken', 'retired') then
          raise exception 'สถานะต้องเป็น ใช้งาน สำรอง ชำรุด หรือ ยกเลิกใช้งาน' using errcode = 'check_violation';
        end if;
      when 'host_code' then v_row.host_code := upper(private.itas_text_field(v_val, 'ติดตั้งที่', 50));
      when 'slot' then v_row.slot := private.itas_text_field(v_val, 'ช่อง/Slot', 50);
      when 'place' then v_row.place := private.itas_text_field(v_val, 'สถานที่', 200);
      when 'install_date' then v_row.install_date := private.itas_date_field(v_val, 'วันที่ติดตั้ง');
      when 'record_date' then v_row.record_date := private.itas_date_field(v_val, 'วันที่บันทึก');
      when 'purchase_date' then v_row.purchase_date := private.itas_date_field(v_val, 'วันที่ซื้อ');
      when 'vendor' then v_row.vendor := private.itas_text_field(v_val, 'ผู้ขาย', 200);
      when 'price' then v_row.price := private.itas_numeric_field(v_val, 'ราคา', 999999999999.99);
      when 'tax_rate' then v_row.tax_rate := private.itas_numeric_field(v_val, 'ภาษี (%)', 100);
      when 'warranty_text' then v_row.warranty_text := private.itas_text_field(v_val, 'ประกัน', 200);
      when 'warranty_end' then v_row.warranty_end := private.itas_date_field(v_val, 'วันสิ้นสุดประกัน');
      when 'express_code' then v_row.express_code := private.itas_text_field(v_val, 'Express Code', 100);
      when 'account_no' then v_row.account_no := private.itas_text_field(v_val, 'Account Number', 100);
      when 'note' then v_row.note := private.itas_text_field(v_val, 'หมายเหตุ', 2000, true);
      else raise exception 'ไม่รู้จักช่องข้อมูล "%"', v_key using errcode = 'check_violation';
    end case;
  end loop;

  -- ช่องเฉพาะชนิด (ไม่ลับ): ต้องมีในนิยามชนิดและไม่ใช่ช่องลับ (ค่าลับต้องส่งใน p_secrets เท่านั้น)
  for v_key, v_val in select d.key, d.value from jsonb_each(v_attrs_in) d loop
    v_def := private.itas_field_def(v_type.fields, v_key);
    if v_def is null then
      raise exception 'ช่อง "%" ไม่มีในชนิดอุปกรณ์ %', v_key, v_type.code using errcode = 'check_violation';
    end if;
    if (v_def ->> 'secret')::boolean then
      raise exception 'ช่อง "%" เป็นช่องลับ ต้องส่งในรูปข้อมูลที่เข้ารหัสแล้ว (secrets) เท่านั้น ห้ามส่งค่าลับใน attrs', v_def ->> 'label' using errcode = 'check_violation';
    end if;
    v_clean := private.itas_attr_value(v_def, v_val);
    if v_clean is null then
      v_row.attrs := v_row.attrs - v_key;
    else
      v_row.attrs := v_row.attrs || jsonb_build_object(v_key, v_clean);
    end if;
  end loop;

  -- ช่องลับ: รับเฉพาะ envelope {v, n, c} ของช่องที่นิยามว่าเป็นช่องลับ · JSON null = ลบค่าลับของช่องนั้น
  for v_key, v_val in select d.key, d.value from jsonb_each(v_secrets_in) d loop
    v_def := private.itas_field_def(v_type.fields, v_key);
    if v_def is null then
      raise exception 'ช่อง "%" ไม่มีในชนิดอุปกรณ์ %', v_key, v_type.code using errcode = 'check_violation';
    end if;
    if not (v_def ->> 'secret')::boolean then
      raise exception 'ช่อง "%" ไม่ใช่ช่องลับ ให้ส่งใน attrs', v_def ->> 'label' using errcode = 'check_violation';
    end if;
    if jsonb_typeof(v_val) = 'null' then
      v_row.secrets := v_row.secrets - v_key;
    else
      v_error := private.itas_envelope_error(v_val);
      if v_error is not null then
        raise exception 'ช่องลับ "%": %', v_def ->> 'label', v_error using errcode = 'check_violation';
      end if;
      v_row.secrets := v_row.secrets || jsonb_build_object(v_key, v_val);
    end if;
  end loop;

  if v_row.reg_no is null and v_row.device_code is null and v_row.name is null and v_row.model is null and v_row.serial is null and v_row.note is null then
    raise exception 'กรุณาระบุอย่างน้อยหนึ่งอย่าง: เลขทะเบียน รหัสอุปกรณ์ ชื่อ รุ่น Serial หรือหมายเหตุ' using errcode = 'check_violation';
  end if;
  if v_row.host_code is not null and v_row.host_code is not distinct from v_row.device_code then
    raise exception 'ติดตั้งที่รหัสเดียวกับรหัสอุปกรณ์ของตัวเองไม่ได้' using errcode = 'check_violation';
  end if;
  if v_row.reg_no is not null and exists (
       select 1 from public.itas_assets a where a.is_test = v_actor.is_test and a.reg_no = v_row.reg_no and a.id <> v_row.id) then
    raise exception 'เลขทะเบียน % ซ้ำกับอุปกรณ์อื่น', v_row.reg_no using errcode = 'check_violation';
  end if;
  if v_row.device_code is not null and exists (
       select 1 from public.itas_assets a where a.is_test = v_actor.is_test and a.device_code = v_row.device_code and a.id <> v_row.id) then
    raise exception 'รหัสอุปกรณ์ % ซ้ำกับอุปกรณ์อื่น', v_row.device_code using errcode = 'check_violation';
  end if;

  if v_exists then
    if to_jsonb(v_row) is not distinct from to_jsonb(v_old) then
      return jsonb_build_object('asset', private.itas_asset_json(v_old), 'created', false, 'changed', false);
    end if;
    begin
      update public.itas_assets
      set reg_no = v_row.reg_no, device_code = v_row.device_code, name = v_row.name, model = v_row.model, serial = v_row.serial,
          status = v_row.status, host_code = v_row.host_code, slot = v_row.slot, place = v_row.place,
          install_date = v_row.install_date, record_date = v_row.record_date, purchase_date = v_row.purchase_date,
          vendor = v_row.vendor, price = v_row.price, tax_rate = v_row.tax_rate, warranty_text = v_row.warranty_text,
          warranty_end = v_row.warranty_end, express_code = v_row.express_code, account_no = v_row.account_no, note = v_row.note,
          attrs = v_row.attrs, secrets = v_row.secrets, updated_by = v_actor.id
      where id = v_old.id;
    exception when unique_violation then
      raise exception 'เลขทะเบียนหรือรหัสอุปกรณ์ซ้ำกับอุปกรณ์อื่น (มีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่' using errcode = 'check_violation';
    end;
    select * into v_saved from public.itas_assets a where a.id = v_old.id;
    return jsonb_build_object('asset', private.itas_asset_json(v_saved), 'created', false, 'changed', true);
  end if;

  begin
    insert into public.itas_assets (
      id, is_test, type_code, reg_no, device_code, name, model, serial, status, host_code, slot, place,
      install_date, record_date, purchase_date, vendor, price, tax_rate, warranty_text, warranty_end, express_code, account_no, note,
      attrs, secrets, created_by, updated_by)
    values (
      v_row.id, v_row.is_test, v_row.type_code, v_row.reg_no, v_row.device_code, v_row.name, v_row.model, v_row.serial, v_row.status, v_row.host_code, v_row.slot, v_row.place,
      v_row.install_date, v_row.record_date, v_row.purchase_date, v_row.vendor, v_row.price, v_row.tax_rate, v_row.warranty_text, v_row.warranty_end, v_row.express_code, v_row.account_no, v_row.note,
      v_row.attrs, v_row.secrets, v_actor.id, v_actor.id);
  exception when unique_violation then
    raise exception 'เลขทะเบียน รหัสอุปกรณ์ หรือรหัสอุปกรณ์ (id) ซ้ำกับรายการที่มีอยู่ (หรือมีผู้อื่นบันทึกพร้อมกัน) กรุณาลองใหม่' using errcode = 'check_violation';
  end;
  select * into v_saved from public.itas_assets a where a.id = v_row.id;
  return jsonb_build_object('asset', private.itas_asset_json(v_saved), 'created', true, 'changed', true);
end;
$$;

-- ประวัติของอุปกรณ์หนึ่งชิ้น (เฉพาะ it_admin): log = ประวัติเพิ่ม/แก้ (ใหม่สุดก่อน) · moves = ประวัติย้าย/เปลี่ยนชิ้นส่วน (ใหม่สุดก่อน) · แต่ละส่วนไม่เกิน p_limit (1–500 ค่าเริ่มต้น 200)
--   log: [{id, action, actor_employee_no, actor_full_name, old_values, new_values (ทั้งแถว ช่องลับเป็น ciphertext), created_at}]
--   moves: [{id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_employee_no, actor_full_name, created_at}]
create or replace function public.app_itas_asset_history(p_id uuid, p_limit integer default 200)
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
  v_actor := private.itas_require_admin();
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'จำนวนที่ขอต่อครั้งต้องอยู่ระหว่าง 1–500' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.itas_assets a where a.id = p_id and a.is_test = v_actor.is_test) then
    raise exception 'ไม่พบอุปกรณ์นี้' using errcode = 'check_violation';
  end if;
  return jsonb_build_object(
    'asset_id', p_id,
    'log', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', l.id, 'action', l.action, 'actor_employee_no', e.employee_no, 'actor_full_name', e.first_name || ' ' || e.last_name,
               'old_values', l.old_values, 'new_values', l.new_values, 'created_at', l.created_at
             ) order by l.id desc), '[]'::jsonb)
      from (select * from public.itas_asset_log x where x.asset_id = p_id and x.is_test = v_actor.is_test order by x.id desc limit p_limit) l
      join public.employees e on e.id = l.actor_id),
    'moves', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'id', m.id, 'from_host', m.from_host, 'to_host', m.to_host, 'from_slot', m.from_slot, 'to_slot', m.to_slot,
               'from_status', m.from_status, 'to_status', m.to_status,
               'actor_employee_no', e.employee_no, 'actor_full_name', e.first_name || ' ' || e.last_name, 'created_at', m.created_at
             ) order by m.id desc), '[]'::jsonb)
      from (select * from public.itas_asset_moves x where x.asset_id = p_id and x.is_test = v_actor.is_test order by x.id desc limit p_limit) m
      join public.employees e on e.id = m.actor_id)
  );
end;
$$;

-- หน้ารวมของเครื่อง (เฉพาะ it_admin): ตัวเครื่อง (อุปกรณ์ที่ device_code = รหัสนั้น ถ้ามี) + ทุกชิ้นที่ host_code = รหัสนั้น จัดกลุ่มตามชนิด
--   {host_code, device (อุปกรณ์ หรือ null), groups: [{type_code, type_name, items[อุปกรณ์...]}] เรียงตามลำดับชนิด, total_parts}
--   ตัวเครื่องเองไม่ถูกนับเป็นชิ้นส่วน · p_include_retired = false ซ่อนชิ้นที่ยกเลิกใช้งานแล้ว · รหัสตัดช่องว่างและตัวพิมพ์ใหญ่
create or replace function public.app_itas_host_overview(p_host_code text, p_include_retired boolean default true)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_host text := upper(private.itas_clean(p_host_code));
  v_device public.itas_assets%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if v_host is null then
    raise exception 'กรุณาระบุรหัสเครื่อง' using errcode = 'check_violation';
  end if;
  if char_length(v_host) > 50 then
    raise exception 'รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร' using errcode = 'check_violation';
  end if;
  select * into v_device from public.itas_assets a where a.is_test = v_actor.is_test and a.device_code = v_host;
  return jsonb_build_object(
    'host_code', v_host,
    'device', case when v_device.id is null then null else private.itas_asset_json(v_device) end,
    'groups', (
      select coalesce(jsonb_agg(g.obj order by g.sort, g.code), '[]'::jsonb)
      from (
        select t.sort, t.code,
               jsonb_build_object('type_code', t.code, 'type_name', t.name,
                                  'items', jsonb_agg(private.itas_asset_json(a) order by a.slot nulls last, a.reg_no nulls last, a.id)) as obj
        from public.itas_assets a
        join public.itas_types t on t.is_test = a.is_test and t.code = a.type_code
        where a.is_test = v_actor.is_test and a.host_code = v_host
          and (v_device.id is null or a.id <> v_device.id)
          and (coalesce(p_include_retired, true) or a.status <> 'retired')
        group by t.sort, t.code, t.name
      ) g),
    'total_parts', (
      select count(*)::integer from public.itas_assets a
      where a.is_test = v_actor.is_test and a.host_code = v_host
        and (v_device.id is null or a.id <> v_device.id)
        and (coalesce(p_include_retired, true) or a.status <> 'retired'))
  );
end;
$$;

-- 10. RPC ตู้เซฟ -----------------------------------------------------------------------
-- อ่านตู้เซฟของโหมดปัจจุบัน (เฉพาะ it_admin) · หน้าเว็บต้องใช้ค่าเหล่านี้ปลดล็อกในเบราว์เซอร์ (ถอดห่อกุญแจหลักด้วยรหัสตู้เซฟหรือรหัสกู้คืน) จึงคืน wrapped key ให้ it_admin ได้
--   ยังไม่ตั้ง: {initialized: false, is_test}
--   ตั้งแล้ว: {initialized: true, is_test, key_version, rev, kdf, kdf_iterations, salt, wrapped_key_pass{n,c}, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery{n,c}, updated_at}
create or replace function public.app_itas_vault_get()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_vault public.itas_vault%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  select * into v_vault from public.itas_vault v where v.is_test = v_actor.is_test;
  if v_vault.is_test is null then
    return jsonb_build_object('initialized', false, 'is_test', v_actor.is_test);
  end if;
  return jsonb_build_object(
    'initialized', true, 'is_test', v_vault.is_test, 'key_version', v_vault.key_version, 'rev', v_vault.rev,
    'kdf', v_vault.kdf, 'kdf_iterations', v_vault.kdf_iterations, 'salt', v_vault.salt, 'wrapped_key_pass', v_vault.wrapped_key_pass,
    'recovery_kdf_iterations', v_vault.recovery_kdf_iterations, 'recovery_salt', v_vault.recovery_salt,
    'wrapped_key_recovery', v_vault.wrapped_key_recovery, 'updated_at', v_vault.updated_at);
end;
$$;

-- ตั้งตู้เซฟครั้งแรกของโหมดนี้ (เฉพาะ it_admin) · ตั้งได้ครั้งเดียว (ตั้งแล้วเรียกซ้ำ = ผิดพลาด ไม่เขียนทับ)
--   p_kdf = 'PBKDF2-SHA256' · p_kdf_iterations / p_recovery_kdf_iterations = 600,000–10,000,000
--   p_salt / p_recovery_salt = base64 ของ 16 ไบต์ · p_wrapped_key_pass / p_wrapped_key_recovery = {n: base64 12 ไบต์, c: base64 48 ไบต์} (กุญแจหลัก 32 ไบต์ ห่อด้วย AES-GCM)
--   ไม่รับ/ไม่เก็บรหัสตู้เซฟ รหัสกู้คืน หรือกุญแจหลัก plaintext · คืน {rev, key_version}
create or replace function public.app_itas_vault_init(
  p_kdf text,
  p_kdf_iterations integer,
  p_salt text,
  p_wrapped_key_pass jsonb,
  p_recovery_kdf_iterations integer,
  p_recovery_salt text,
  p_wrapped_key_recovery jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_error text;
  v_vault public.itas_vault%rowtype;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if p_kdf is distinct from 'PBKDF2-SHA256' then
    raise exception 'รองรับเฉพาะ KDF แบบ PBKDF2-SHA256' using errcode = 'check_violation';
  end if;
  if p_kdf_iterations is null or p_kdf_iterations not between 600000 and 10000000 then
    raise exception 'จำนวนรอบ KDF ของรหัสตู้เซฟต้องอยู่ระหว่าง 600,000–10,000,000' using errcode = 'check_violation';
  end if;
  if p_recovery_kdf_iterations is null or p_recovery_kdf_iterations not between 600000 and 10000000 then
    raise exception 'จำนวนรอบ KDF ของรหัสกู้คืนต้องอยู่ระหว่าง 600,000–10,000,000' using errcode = 'check_violation';
  end if;
  if private.itas_b64_len(p_salt) is distinct from 16 then
    raise exception 'salt ของรหัสตู้เซฟต้องเป็น base64 ยาว 16 ไบต์' using errcode = 'check_violation';
  end if;
  if private.itas_b64_len(p_recovery_salt) is distinct from 16 then
    raise exception 'salt ของรหัสกู้คืนต้องเป็น base64 ยาว 16 ไบต์' using errcode = 'check_violation';
  end if;
  v_error := private.itas_wrapped_key_error(p_wrapped_key_pass);
  if v_error is not null then
    raise exception 'กุญแจที่ห่อด้วยรหัสตู้เซฟ: %', v_error using errcode = 'check_violation';
  end if;
  v_error := private.itas_wrapped_key_error(p_wrapped_key_recovery);
  if v_error is not null then
    raise exception 'กุญแจที่ห่อด้วยรหัสกู้คืน: %', v_error using errcode = 'check_violation';
  end if;

  insert into public.itas_vault (
    is_test, kdf, kdf_iterations, salt, wrapped_key_pass, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery, created_by, updated_by)
  values (
    v_actor.is_test, p_kdf, p_kdf_iterations, p_salt, p_wrapped_key_pass, p_recovery_kdf_iterations, p_recovery_salt, p_wrapped_key_recovery, v_actor.id, v_actor.id)
  on conflict (is_test) do nothing
  returning * into v_vault;
  if v_vault.is_test is null then
    raise exception 'ตั้งตู้เซฟไปแล้ว ตั้งซ้ำไม่ได้ (ถ้าจะเปลี่ยนรหัสให้ใช้การเปลี่ยนรหัสตู้เซฟ)' using errcode = 'check_violation';
  end if;
  return jsonb_build_object('rev', v_vault.rev, 'key_version', v_vault.key_version);
end;
$$;

-- เปลี่ยนรหัสตู้เซฟ หรือออกรหัสกู้คืนใหม่ (เฉพาะ it_admin) · หน้าเว็บปลดล็อกแล้วห่อกุญแจหลักเดิมด้วยกุญแจใหม่ ไม่แตะแถวข้อมูล
--   p_expected_rev = rev ที่หน้าเว็บอ่านมาจาก app_itas_vault_get (ไม่ตรง = errcode 40001 ให้โหลดใหม่ กันเขียนทับการเปลี่ยนจากที่อื่น)
--   p_action = 'change_password': ส่ง p_kdf_iterations + p_salt + p_wrapped_key_pass (ชุดของรหัสตู้เซฟ) เท่านั้น · ใช้ตอนลืมรหัสแล้วปลดล็อกด้วยรหัสกู้คืนก็ได้
--   p_action = 'new_recovery': ส่ง p_recovery_kdf_iterations + p_recovery_salt + p_wrapped_key_recovery (ชุดของรหัสกู้คืน) เท่านั้น
--   พารามิเตอร์ของอีกชุดต้องเป็น null · กฎรูปแบบ/ขนาดเหมือน app_itas_vault_init · key_version ไม่เปลี่ยน (ช่องลับที่เข้ารหัสไว้ยังถอดได้) · คืน {rev, key_version}
create or replace function public.app_itas_vault_rotate(
  p_expected_rev integer,
  p_action text,
  p_kdf_iterations integer default null,
  p_salt text default null,
  p_wrapped_key_pass jsonb default null,
  p_recovery_kdf_iterations integer default null,
  p_recovery_salt text default null,
  p_wrapped_key_recovery jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.employees%rowtype;
  v_vault public.itas_vault%rowtype;
  v_error text;
begin
  perform private.lab_only_block();
  v_actor := private.itas_require_admin();
  if p_action is null or p_action not in ('change_password', 'new_recovery') then
    raise exception 'การกระทำต้องเป็น change_password หรือ new_recovery' using errcode = 'check_violation';
  end if;
  select * into v_vault from public.itas_vault v where v.is_test = v_actor.is_test for update;
  if v_vault.is_test is null then
    raise exception 'ยังไม่ได้ตั้งตู้เซฟ' using errcode = 'check_violation';
  end if;
  if p_expected_rev is null or p_expected_rev <> v_vault.rev then
    raise exception 'ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว กรุณาโหลดตู้เซฟใหม่แล้วลองอีกครั้ง' using errcode = '40001';
  end if;

  if p_action = 'change_password' then
    if p_recovery_kdf_iterations is not null or p_recovery_salt is not null or p_wrapped_key_recovery is not null then
      raise exception 'เปลี่ยนรหัสตู้เซฟต้องไม่ส่งข้อมูลของรหัสกู้คืนมาด้วย' using errcode = 'check_violation';
    end if;
    if p_kdf_iterations is null or p_kdf_iterations not between 600000 and 10000000 then
      raise exception 'จำนวนรอบ KDF ของรหัสตู้เซฟต้องอยู่ระหว่าง 600,000–10,000,000' using errcode = 'check_violation';
    end if;
    if private.itas_b64_len(p_salt) is distinct from 16 then
      raise exception 'salt ของรหัสตู้เซฟต้องเป็น base64 ยาว 16 ไบต์' using errcode = 'check_violation';
    end if;
    v_error := private.itas_wrapped_key_error(p_wrapped_key_pass);
    if v_error is not null then
      raise exception 'กุญแจที่ห่อด้วยรหัสตู้เซฟ: %', v_error using errcode = 'check_violation';
    end if;
    if p_salt = v_vault.salt or p_wrapped_key_pass = v_vault.wrapped_key_pass then
      raise exception 'ต้องใช้ salt และการห่อกุญแจชุดใหม่ (สุ่มใหม่ทุกครั้ง)' using errcode = 'check_violation';
    end if;
    update public.itas_vault
    set kdf_iterations = p_kdf_iterations, salt = p_salt, wrapped_key_pass = p_wrapped_key_pass, rev = v_vault.rev + 1, updated_by = v_actor.id
    where is_test = v_vault.is_test
    returning * into v_vault;
  else
    if p_kdf_iterations is not null or p_salt is not null or p_wrapped_key_pass is not null then
      raise exception 'ออกรหัสกู้คืนใหม่ต้องไม่ส่งข้อมูลของรหัสตู้เซฟมาด้วย' using errcode = 'check_violation';
    end if;
    if p_recovery_kdf_iterations is null or p_recovery_kdf_iterations not between 600000 and 10000000 then
      raise exception 'จำนวนรอบ KDF ของรหัสกู้คืนต้องอยู่ระหว่าง 600,000–10,000,000' using errcode = 'check_violation';
    end if;
    if private.itas_b64_len(p_recovery_salt) is distinct from 16 then
      raise exception 'salt ของรหัสกู้คืนต้องเป็น base64 ยาว 16 ไบต์' using errcode = 'check_violation';
    end if;
    v_error := private.itas_wrapped_key_error(p_wrapped_key_recovery);
    if v_error is not null then
      raise exception 'กุญแจที่ห่อด้วยรหัสกู้คืน: %', v_error using errcode = 'check_violation';
    end if;
    if p_recovery_salt = v_vault.recovery_salt or p_wrapped_key_recovery = v_vault.wrapped_key_recovery then
      raise exception 'ต้องใช้ salt และการห่อกุญแจชุดใหม่ (สุ่มใหม่ทุกครั้ง)' using errcode = 'check_violation';
    end if;
    update public.itas_vault
    set recovery_kdf_iterations = p_recovery_kdf_iterations, recovery_salt = p_recovery_salt, wrapped_key_recovery = p_wrapped_key_recovery,
        rev = v_vault.rev + 1, updated_by = v_actor.id
    where is_test = v_vault.is_test
    returning * into v_vault;
  end if;
  return jsonb_build_object('rev', v_vault.rev, 'key_version', v_vault.key_version);
end;
$$;

-- 11. ล้างข้อมูลทดสอบ -----------------------------------------------------------------------
-- ลบเฉพาะแถว is_test ของทะเบียนอุปกรณ์ทั้งหมด (ลูกก่อนแม่) รวมตู้เซฟทดสอบ แล้ว seed ชนิดตั้งต้นของโหมดทดสอบกลับ (นิยามที่ลองแก้ในโหมดทดสอบหายไป)
--   ตั้ง itas.purge = on (transaction-local) ให้ trigger ยอมลบเฉพาะแถวทดสอบ · แถวจริงลบไม่ได้เลย · เฉพาะ admin ตัวจริงที่อยู่ในโหมดทดสอบ (เหมือน app_sandbox_purge_itrp)
create or replace function public.app_sandbox_purge_itas()
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

  -- ล็อกตารางเขียนของโมดูลไว้จนจบ transaction (ยังอ่านได้) กันคนอื่นแก้อุปกรณ์ทดสอบพร้อมกันระหว่างล้าง · เรียงลำดับล็อกเดียวกับที่ RPC แตะ (ชนิด -> อุปกรณ์ -> ประวัติ -> ตู้เซฟ)
  lock table public.itas_types, public.itas_type_log, public.itas_assets, public.itas_asset_log, public.itas_asset_moves,
             public.itas_vault, public.itas_vault_log in exclusive mode;

  -- ตรวจสิทธิ์ครบแล้วและลบเฉพาะ is_test: พักค่า claims ไว้แล้วเคลียร์ (transaction-local) ให้ trigger โหมดทดสอบไม่ต้องหา persona ทุกแถว
  v_claim_sub := current_setting('request.jwt.claim.sub', true);
  v_claims := current_setting('request.jwt.claims', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('itas.purge', 'on', true);

  -- ลูกก่อนแม่: ประวัติย้าย -> ประวัติแก้ -> อุปกรณ์ -> ประวัติชนิด -> ชนิด -> ประวัติตู้เซฟ -> ตู้เซฟ
  foreach v_table in array array['itas_asset_moves', 'itas_asset_log', 'itas_assets', 'itas_type_log', 'itas_types', 'itas_vault_log', 'itas_vault'] loop
    execute format('delete from public.%I where is_test', v_table);
    get diagnostics v_n = row_count;
    v_deleted := v_deleted + v_n;
  end loop;
  perform private.itas_seed_types(true);

  perform set_config('itas.purge', 'off', true);
  perform set_config('request.jwt.claim.sub', coalesce(v_claim_sub, ''), true);
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);

  insert into public.audit_logs (actor_id, action, entity_type, entity_id, metadata)
  values (v_admin.id, 'ITAS_SANDBOX_PURGE', 'itas_assets', v_admin.id::text,
          jsonb_build_object('deleted', v_deleted, 'is_test', true, 'persona_employee_no', v_persona.employee_no));
  return jsonb_build_object('deleted', v_deleted);
end;
$$;

-- 12. สิทธิ์เรียกฟังก์ชัน (รันซ้ำทั้งชุดได้ ผลเดียวกัน) -----------------------------------------
-- private.itas_*: ถอนจาก public/anon/authenticated ทั้งหมด (เรียกจาก RPC ที่ SECURITY DEFINER และ trigger เท่านั้น)
-- public.app_itas_* และ app_sandbox_purge_itas: เฉพาะผู้ล็อกอินแล้ว (ภายในตรวจ it_admin ซ้ำอีกชั้น) anon เรียกไม่ได้
do $$
declare
  v_sig text;
begin
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'private'::regnamespace and p.proname like 'itas\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_sig);
  end loop;
  for v_sig in
    select p.oid::regprocedure::text
    from pg_catalog.pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname like 'app\_itas\_%' or p.proname = 'app_sandbox_purge_itas')
  loop
    execute format('revoke all on function %s from public, anon', v_sig);
    execute format('grant execute on function %s to authenticated', v_sig);
  end loop;
end $$;
