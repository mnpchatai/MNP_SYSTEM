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
  salt text not null check (private.itas_b64_len(salt) = 16),
  wrapped_key_pass jsonb not null check (private.itas_wrapped_key_error(wrapped_key_pass) is null),
  recovery_kdf_iterations integer not null check (recovery_kdf_iterations between 600000 and 10000000),
  recovery_salt text not null check (private.itas_b64_len(recovery_salt) = 16),
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

-- @@END@@
