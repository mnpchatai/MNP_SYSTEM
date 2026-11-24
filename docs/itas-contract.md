# สัญญาฐานข้อมูลของโมดูล "ทะเบียนอุปกรณ์ IT" (`itas_*`)

migration: `supabase/migrations/20261222010000_itas_asset_register.sql` · ทดสอบ: `supabase/tests/database/itas_asset_register.test.sql`
สเปกต้นทาง: `Work-Order/docs/it-asset-register-spec.md` (เจ้าของตัดสิน 24/11/2026) · เอกสารนี้ไว้ให้คนทำหน้าเว็บ (Pilot) ใช้เป็นสัญญา · **ส่วนที่ 1 = ฐานข้อมูลอย่างเดียว** (ยังไม่มีหน้าเว็บ ไม่นำเข้าข้อมูล ไม่ผูกกับหัวใบ FM02 ของ `itrp_devices` — เป็นงานรอบหลัง)

ทุก RPC เรียกผ่าน `sb.rpc('app_itas_…', { p_… })` ด้วย session ของผู้ใช้ (SECURITY DEFINER, anon เรียกไม่ได้) · ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ (`error.message`)
ตารางทั้งหมดปิดการเข้าถึงตรง (RLS deny-all + ไม่มี grant แม้แต่ service_role) อ่าน/เขียนผ่าน RPC เท่านั้น · ทุก RPC คืน `jsonb` (ยกเว้นล้างข้อมูลทดสอบที่คืน jsonb เช่นกัน)

## สิทธิ์
**เฉพาะผู้อยู่ใน allowlist ของโมดูลเอง `public.itas_admins`** (เจ้าของตัดสิน 24/11/2026: ผู้ดูแลคนเดียว = `IT3462`) · **ไม่อ่าน `itwo_staff` อีกแล้ว** → it_admin ของใบสั่งงาน IT ที่ไม่อยู่ใน allowlist / ผู้อนุมัติขั้น IT / ผู้จัดการแผนก / พนักงาน เรียกทุก RPC ไม่ได้ (`42501` "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้") · anon เรียกไม่ได้ (permission denied) · บัญชี lab-only เรียกไม่ได้
- `itas_admins` (employee_id, is_test, added_by, added_at): seed `IT3462` (โหมดจริง) + persona `SBX-IT-ADMIN` (โหมดทดสอบ) · **ไม่มี RPC เพิ่ม/ลบ** แก้ได้ด้วย migration/SQL โดยผู้ดูแลฐานข้อมูลเท่านั้น · ไม่ถูกล้างโดย `app_sandbox_purge_itas` · สิทธิ์ตรวจว่าแถวกับพนักงานอยู่โหมดเดียวกัน (`is_test` ตรงกัน)
- หน้าเว็บใช้ **`app_itas_my_access()`** → `{allowed, is_test}` (ไม่ raise เมื่อไม่มีสิทธิ์) เลือกว่าจะแสดงการ์ดนี้หรือไม่ · **เลิกใช้ `app_itrp_my_role()`** ตัดสินสิทธิ์ทะเบียนอุปกรณ์

## โหมดทดสอบ (Admin Sandbox)
ทุกตารางมี `is_test` + trigger `private.sandbox_row_scope` (กำหนดจากโหมดของผู้ทำรายการ) · persona (เช่น `SBX-IT-ADMIN`) เห็น/แก้เฉพาะแถวทดสอบ แตะของจริงไม่ได้ (id ที่เป็นของจริงตอบ "ไม่พบอุปกรณ์นี้…")
- **ชนิดอุปกรณ์แยกต่อโหมด**: seed 23 ชนิดให้ทั้งโหมดจริงและโหมดทดสอบ persona แก้นิยามชนิดทดสอบได้โดยไม่กระทบของจริง
- **ตู้เซฟแยกต่อโหมด**: โหมดทดสอบเริ่มจาก "ยังไม่ตั้ง" ต้องตั้งรหัสทดสอบเอง (`app_itas_vault_get` → `{initialized: false, is_test: true}`)
- เลขทะเบียน/รหัสอุปกรณ์ซ้ำกับของจริงได้ในโหมดทดสอบ (unique ต่อโหมด)
- `app_sandbox_purge_itas()` (admin ตัวจริงที่อยู่ในโหมดทดสอบ) ลบเฉพาะแถว `is_test` ของ 7 ตารางข้อมูล (ไม่รวม `itas_admins`) รวมตู้เซฟทดสอบ แล้ว seed ชนิดตั้งต้นของโหมดทดสอบกลับ → คืน `{deleted}` · ไม่อยู่ในโหมดทดสอบ = error `SANDBOX_NOT_ACTIVE` · ปุ่มล้างข้อมูลทดสอบของหน้าเว็บต้องเรียกตัวนี้ด้วย

## ตาราง (8)
| ตาราง | หน้าที่ | เพิ่มได้อย่างเดียว |
|---|---|---|
| `itas_types` | ชนิดอุปกรณ์ + นิยามช่องเฉพาะชนิด (`fields` jsonb) คีย์ `(is_test, code)` | ลบไม่ได้ (ปิดใช้งานแทน) |
| `itas_type_log` | ประวัติเพิ่ม/แก้นิยามชนิด (เพิ่มจากสเปก เพราะสเปกให้ "แก้นิยามลง log") | ใช่ |
| `itas_assets` | อุปกรณ์ทุกชิ้น (id uuid, ช่องกลาง, `attrs`, `secrets`) | ลบไม่ได้ (ใช้ `retired`) |
| `itas_asset_log` | ประวัติเพิ่ม/แก้ทุกแถว (ค่าเดิม ค่าใหม่ทั้งแถว ช่องลับเป็น ciphertext) เขียนโดย trigger | ใช่ |
| `itas_asset_moves` | ประวัติย้าย/เปลี่ยนชิ้นส่วนอัตโนมัติ เมื่อ `host_code`/`slot`/`status` เปลี่ยน (รวมตอนสร้างที่มี `host_code`) เขียนโดย trigger | ใช่ |
| `itas_vault` | ตู้เซฟ 1 แถวต่อโหมด (salt, พารามิเตอร์ KDF, กุญแจหลักที่ห่อแล้ว 2 ชุด, `auth_hash` = SHA-256 ของ auth token ที่ derive จากกุญแจหลัก — ไม่ส่งกลับให้ใคร) | ลบไม่ได้ · `auth_hash`/`key_version` แก้ไม่ได้ |
| `itas_vault_log` | ประวัติตั้ง/เปลี่ยนรหัส/ออกรหัสกู้คืนใหม่/**พยายาม rotate ล้มเหลว** (`rotate_failed`) · `old_values` เก็บชุด wrap เดิมที่ถูกแทน (ciphertext + salt ไม่ใช่ plaintext · ไม่มี RPC ใดอ่าน กู้ด้วย SQL เท่านั้น) | ใช่ |
| `itas_admins` | allowlist ผู้ใช้ทะเบียน (ดูหัวข้อสิทธิ์) | ไม่มี RPC เขียน (แก้ด้วย migration/SQL) |

log/moves เขียนโดย trigger เสมอ (เลี่ยงไม่ได้แม้เขียนตรงด้วยสิทธิ์สูง) · TRUNCATE ทุกตารางกันไว้ · ลบได้เฉพาะแถวทดสอบผ่าน `app_sandbox_purge_itas`

### สถานะอุปกรณ์ (`status`)
`in_use` ใช้งาน · `spare` สำรอง · `broken` ชำรุด · `retired` ยกเลิกใช้งาน (ค่าเริ่มต้นตอนสร้าง = `in_use`)

### ช่องกลางของ `itas_assets` (ส่งใน `p_data`)
`reg_no` เลขทะเบียน (≤50) · `device_code` รหัสอุปกรณ์ (≤50) · `name` ชื่อ (≤200) · `model` รุ่น (≤200) · `serial` (≤200) · `status` · `host_code` "ติดตั้งที่/Used by" (≤50) · `slot` (≤50) · `place` สถานที่ (≤200) · `install_date` · `record_date` · `purchase_date` · `vendor` (≤200) · `price` (≥0 ทศนิยม ≤2) · `tax_rate` (0–100) · `warranty_text` (≤200) · `warranty_end` (วันที่) · `express_code` (≤100) · `account_no` (≤100) · `note` (≤2000 ขึ้นบรรทัดใหม่ได้)
- `reg_no` / `device_code` / `host_code` ถูก **ตัดช่องว่างหัวท้ายและแปลงเป็นตัวพิมพ์ใหญ่** โดยฐานข้อมูล (ให้จับคู่รหัสเครื่องกับ "ติดตั้งที่" ได้ตรง) · `reg_no` ไม่ซ้ำต่อโหมด และ `device_code` ไม่ซ้ำต่อโหมด (ไม่นับ null: ROM หรือแถวที่ไม่มีเลขสร้างได้หลายแถว)
- วันที่ส่งเป็นข้อความ `YYYY-MM-DD` (ค.ศ.) ระหว่าง 1990-01-01 ถึง 2100-01-01 · ตัวเลขส่งเป็น JSON number หรือข้อความตัวเลขก็ได้
- ต้องมีอย่างน้อยหนึ่งอย่างใน เลขทะเบียน / รหัสอุปกรณ์ / ชื่อ / รุ่น / Serial / หมายเหตุ · `host_code` ต้องไม่เท่ากับ `device_code` ของตัวเอง
- ส่งเฉพาะช่องที่ต้องการตั้ง/เปลี่ยน (ช่องที่ไม่ส่งคงค่าเดิม) · `null` หรือข้อความว่าง = ล้างค่า (`status` ล้างไม่ได้) · ช่องที่ไม่รู้จัก = error (กันพิมพ์ผิด)

## นิยามช่องเฉพาะชนิด (`itas_types.fields`)
รายการ `[{key, label, type, secret, order, max?, choices?, hidden?}]`
- `key` = a–z 0–9 `_` ขึ้นต้นด้วยตัวอักษร ≤40 ห้ามซ้ำ · `label` ป้ายชื่อ (ไทย/อังกฤษตามหัวคอลัมน์เดิม) ≤100
- `type` = `text` (มี `max` 1–4000 ค่าเริ่มต้น 200) · `number` · `date` (`YYYY-MM-DD`) · `choice` (ต้องมี `choices` 1–100 ตัวไม่ซ้ำ) · ช่องลับ (`secret: true`) ต้องเป็น `text`
- `order` = ลำดับตามตำแหน่งในรายการ (ฐานข้อมูลกำหนดให้ ไม่สนค่าที่ส่ง) · `hidden: true` = ซ่อนจากหน้าจอ (ใช้แทนการลบช่องที่มีข้อมูลแล้ว)
- ตัวเลือก (`choices`) ของ 23 ชนิดตั้งต้น **ยังไม่ได้ตั้ง** เพราะสเปกไม่ระบุ (ทุกช่องเป็น text/number/date) · it_admin เพิ่มเองได้ผ่าน `app_itas_save_type`

### ชนิดตั้งต้น 23 ชนิด (`code` · คำนำหน้าเลขทะเบียน · มีรหัสอุปกรณ์แยก)
COMPUTER (— · ใช่) · LAPTOP (NBS/AIO · ใช่) · MONITOR (MNT · ใช่) · PRINTER (PRT · ใช่) · UPS (UPS · ใช่) · PSU (PSU) · MAINBOARD (MBD) · CPU (CPU) · RAM (RAM) · STORAGE (HDD/SSD) · CASE (CASE) · MOUSE (MOU) · KEYBOARD (KYB) · VGA (VGA) · ROM (ROM) · LAN_CARD (LAC) · NETWORK (HUB/AP/…) · ACCESSORY (ACC) · SOFTWARE (SFW) · INK_TONER (INK) · PHONE_SIM (SMP/SIM) · PROJECTOR (PJT) · OTHER (อิสระ)
`reg_prefix` เป็นคำใบ้ให้หน้าเว็บ ฐานข้อมูลไม่บังคับรูปแบบเลขทะเบียน · ช่องเฉพาะและช่องลับเป็นไปตามตารางในสเปก (ช่องลับ: COMPUTER = `ip`, `mac`, `license_os`, `license_office`, `license_adobe`, `license_pdf`, `license_antivirus`, `license_autodesk` · LAPTOP = `license_os` · SOFTWARE = `license` · ที่เหลือไม่มีช่องลับ)

## RPC
### ชนิดอุปกรณ์
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itas_list_types()` | — | array `[{code, name, reg_prefix, has_device_code, fields[], sort, is_active, asset_count, updated_at}]` ของโหมดปัจจุบัน (รวมชนิดที่ปิดใช้งาน) เรียงตาม `sort` |
| `app_itas_save_type` | `p_code` (A–Z 0–9 _ ขึ้นต้นด้วย A–Z ยาว 2–30), `p_name` (บังคับ ≤100), `p_reg_prefix` (≤40), `p_has_device_code boolean`, `p_fields jsonb`, `p_sort integer 0–9999`, `p_is_active boolean` | `{code, created, changed}` · ไม่มีรหัสนี้ = เพิ่ม · มีแล้ว = แก้ (ส่งค่าทั้งหมด) · ไม่เปลี่ยนค่า = `changed:false` (ไม่ลง log) |

กติกาแก้นิยามช่อง: **ลบช่องที่มีข้อมูลในอุปกรณ์ใดแล้ว ไม่ได้** · **เปลี่ยนชนิดข้อมูล (type) หรือสถานะลับ (secret) ของช่องที่มีข้อมูลแล้วไม่ได้** (error "ช่อง … มีข้อมูลในทะเบียนแล้ว ลบหรือเปลี่ยนชนิด/ความลับไม่ได้ (ถ้าไม่ต้องการแสดง ให้ซ่อนช่องแทน)") · ใช้ `hidden: true` แทนการลบ · ลบชนิดไม่ได้ ใช้ `p_is_active = false` (ชนิดปิดใช้งานเพิ่มอุปกรณ์ใหม่ไม่ได้ แต่แก้อุปกรณ์เดิมได้)

### อุปกรณ์
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itas_list_assets` | `p_type_code`, `p_search`, `p_status`, `p_host_code`, `p_limit` (1–2000 ค่าเริ่มต้น 1000), `p_offset` (≥0) | `{total, items[อุปกรณ์]}` · `secrets` เป็น ciphertext · ค้นไม่สนตัวพิมพ์ใหญ่เล็กใน ชื่อ/รุ่น/Serial/เลขทะเบียน/รหัสอุปกรณ์/ติดตั้งที่ (`position` ไม่ใช้ `like` จึงไม่ตีความ `%` `_`) · **ค้นช่องลับ/attrs ไม่ได้** (ต้องค้นในเบราว์เซอร์หลังปลดล็อก) · เรียงตาม รหัสอุปกรณ์ → เลขทะเบียน → ชื่อ · `p_host_code` ตรงทั้งคำ |
| `app_itas_get_asset(p_id)` | uuid | อุปกรณ์เดียว (รูปเดียวกับ items) |
| `app_itas_save_asset` | `p_id uuid`, `p_type_code`, `p_data jsonb`, `p_attrs jsonb`, `p_secrets jsonb`, `p_expected_updated_at timestamptz` | `{asset, created, changed}` |
| `app_itas_asset_history(p_id, p_limit default 200)` | uuid, 1–500 | `{asset_id, log[{id, action, actor_employee_no, actor_full_name, old_values, new_values, created_at}], moves[{id, from_host, to_host, from_slot, to_slot, from_status, to_status, actor_employee_no, actor_full_name, created_at}]}` ใหม่สุดก่อน |
| `app_itas_host_overview(p_host_code, p_include_retired default true)` | ข้อความ | `{host_code, device (อุปกรณ์ที่ device_code = รหัสนั้น หรือ null), groups[{type_code, type_name, items[อุปกรณ์]}] เรียงตามลำดับชนิด, total_parts}` · ตัวเครื่องเองไม่นับเป็นชิ้นส่วน · ชิ้นส่วนเรียงตาม slot |

รูปอุปกรณ์ (ใช้ร่วมกันทุก RPC): `{id, type_code, reg_no, device_code, name, model, serial, status, host_code, slot, place, install_date, record_date, purchase_date, vendor, price, tax_rate, warranty_text, warranty_end, express_code, account_no, note, attrs{}, secrets{<key>:{v,n,c}}, created_at, created_by_employee_no, updated_at, updated_by_employee_no}`

**`app_itas_save_asset`**
- `p_id` ว่าง = เพิ่มใหม่ (ฐานข้อมูลสร้าง uuid · **ใช้ได้เฉพาะรายการที่ไม่มีช่องลับ**: สร้างใหม่พร้อม `p_secrets` ที่มีอย่างน้อยหนึ่ง key ไม่ใช่ null โดยไม่ส่ง `p_id` = error `23514` "สร้างอุปกรณ์ที่มีข้อมูลลับต้องส่ง id ของอุปกรณ์มาด้วย (ใช้ผูกกับการเข้ารหัส)" เพราะ id เป็น AAD) · ส่ง uuid ที่ **ยังไม่มี** = เพิ่มใหม่ด้วย id นั้น (หน้าเว็บสร้างเองด้วย `crypto.randomUUID()` เพราะต้องใช้เป็น AAD ก่อนส่ง) · ส่ง uuid ที่ **มีแล้ว** = แก้ (ต้องส่ง `p_expected_updated_at` ไม่งั้น error) · id ที่เป็นของอีกโหมด = ตอบเหมือนไม่พบ/ถูกใช้แล้ว
- เพิ่มใหม่: ต้องส่ง `p_type_code` (ชนิดต้องอยู่ในโหมดนี้และเปิดใช้งาน) · แก้: ไม่ต้องส่ง ถ้าส่งต้องตรงของเดิม (**เปลี่ยนชนิดไม่ได้**)
- **แก้ชนกัน**: `p_expected_updated_at` = `updated_at` ที่หน้าเว็บโหลดมา · **ต้องส่งกลับเป็นสตริงเดิมจากเซิร์ฟเวอร์ทุกตัวอักษร (เช่น `2026-11-24T05:12:33.123456+00:00`) ห้ามแปลงผ่าน `Date`/`new Date().toISOString()`** เพราะ `timestamptz` มีไมโครวินาที แต่ `Date` ของ JavaScript เก็บได้แค่มิลลิวินาที → ค่าที่ส่งกลับจะไม่ตรงและแก้ไม่ได้เลย (ติด 40001 ตลอด) · ไม่ตรง = errcode **`40001`** "ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่" (หน้าเว็บโหลดแถวใหม่แล้วให้ผู้ใช้ตัดสินใจ)
- **ส่งเฉพาะที่เปลี่ยน**: `p_data` / `p_attrs` / `p_secrets` เป็นการ merge ราย key (key ที่ไม่ส่งคงค่าเดิม) · `null` = ล้างค่า key นั้น · ไม่มีค่าใดเปลี่ยน = `changed:false` (ไม่ลง log/moves, ไม่เปลี่ยน `updated_at`)
- `p_attrs`: ช่องเฉพาะชนิดที่ **ไม่ลับ** ตามนิยามช่อง (ตรวจชนิดข้อมูล/ความยาว/ตัวเลือก) · key ที่ไม่มีในชนิด = error · **key ที่เป็นช่องลับส่งใน attrs ไม่ได้** (แม้เป็น null) = error "ช่อง … เป็นช่องลับ ต้องส่งในรูปข้อมูลที่เข้ารหัสแล้ว (secrets) เท่านั้น ห้ามส่งค่าลับใน attrs" (กันหน้าเว็บบั๊กส่ง plaintext ผิดช่อง)
- `p_secrets`: `{<key ช่องลับ>: {v:1, n, c}}` เท่านั้น · **ลบค่าลับของช่องหนึ่ง = ส่ง `{"<key>": null}`** · key ที่ไม่มีในชนิด หรือไม่ใช่ช่องลับ = error · envelope ผิดรูป = error (ดูหัวข้อถัดไป) · ส่งแค่บางช่อง = แก้เฉพาะช่องนั้น ช่องลับอื่นคงเดิม
- ผลข้างเคียงจาก trigger: ลง `itas_asset_log` ทุกครั้งที่ค่าเปลี่ยน · ลง `itas_asset_moves` เมื่อ host/slot/status เปลี่ยน (หรือสร้างพร้อม host)
- เกิดแถวซ้ำ (เลขทะเบียน/รหัสอุปกรณ์) = error ภาษาไทยบอกว่าซ้ำกับอุปกรณ์อื่น · ลบอุปกรณ์ไม่มี RPC (ใช้ `status = 'retired'`)
- retry หลังเน็ตหลุดตอนสร้างด้วย id ที่หน้าเว็บสร้างเอง: ถ้าครั้งแรกสำเร็จไปแล้ว ครั้งที่สองจะได้ error "อุปกรณ์นี้มีอยู่แล้ว…" → ให้หน้าเว็บ `app_itas_get_asset(id)` เพื่อโหลดแถวแล้วต่อด้วยการแก้

## ช่องลับและตู้เซฟ (ข้อกำหนดที่หน้าเว็บต้องทำตามตรงตัว)
**ฐานข้อมูลไม่เคยเห็น plaintext ของช่องลับ** · ไม่มีฟังก์ชันถอดรหัส ไม่ใช้ pgcrypto (ตรวจพิสูจน์กุญแจด้วย `sha256` ที่มากับ Postgres) · ตารางมี CHECK รูปแบบ envelope อีกชั้น · รหัสตู้เซฟ รหัสกู้คืน และกุญแจหลัก **ห้ามส่งขึ้นเซิร์ฟเวอร์ ห้ามเก็บ localStorage/sessionStorage/IndexedDB** อยู่ในหน่วยความจำของแท็บเท่านั้น ล็อกเองเมื่อไม่ใช้งาน/ปิดแท็บ/ออกจากระบบ (ตามสเปก) · ไม่บันทึกว่าใครกดดูช่องลับเมื่อไร (เจ้าของตัดสิน) · ลืมรหัสตู้เซฟและรหัสกู้คืนทั้งสองอย่าง = กู้ข้อมูลลับไม่ได้ (เจ้าของรับทราบ)

### Envelope ของช่องลับ
`{ "v": 1, "n": "<base64 ของ nonce 12 ไบต์>", "c": "<base64 ของ ciphertext ตามด้วย GCM tag 16 ไบต์>" }`
- base64 มาตรฐาน (ตัวอักษร `A–Z a–z 0–9 + /`) **มี padding `=` และไม่มีขึ้นบรรทัดใหม่/ช่องว่าง** (`btoa` / `Uint8Array → base64` ปกติ ใช้ได้ · อย่าใช้ base64url)
- มีคีย์ `v`, `n`, `c` เท่านั้น · `v` ต้องเป็นตัวเลข `1` · `n` ถอดแล้วยาว **12 ไบต์พอดี** · `c` ถอดแล้วยาว **17–4,096 ไบต์** (plaintext 1–4,080 ไบต์ UTF-8) · ค่าลับว่างให้ส่ง `null` แทน
- เข้ารหัสด้วย **AES-256-GCM** (Web Crypto `AES-GCM`, `tagLength` 128) · nonce สุ่มใหม่ (`crypto.getRandomValues`) **ทุกครั้งที่เข้ารหัส** ห้ามใช้ซ้ำกับกุญแจเดียวกัน
- **AAD = ข้อความ UTF-8 `<asset id>|<field key>|<key_version>`** เช่น `2a500000-0000-0000-0000-000000000001|license_os|1` (asset id ตัวพิมพ์เล็กรูป uuid ปกติ, `key_version` ได้จาก `app_itas_vault_get`) → ย้าย ciphertext ไปแถว/ช่องอื่นแล้วถอดไม่ออก (ฐานข้อมูลตรวจ AAD ไม่ได้ หน้าเว็บต้องตรวจเองตอนถอด: tag ไม่ผ่าน = แสดงว่าถอดไม่ได้)
- plaintext = UTF-8 ของค่าที่ผู้ใช้พิมพ์ (แนะนำตัดช่องว่างหัวท้ายและ normalize เป็น NFC)
- หน้าเว็บ **สร้าง uuid ของอุปกรณ์ก่อน** แล้วเข้ารหัสด้วย id นั้น แล้วค่อยเรียก `app_itas_save_asset(p_id = id, …)` · แก้ค่าลับ = เข้ารหัสใหม่ด้วย nonce ใหม่ ส่งเฉพาะช่องที่แก้

### ตู้เซฟ (ขั้นตอนฝั่งเบราว์เซอร์)
ศัพท์: **DEK** = กุญแจหลัก AES-256 สุ่ม 32 ไบต์ (เข้ารหัสช่องลับ) · **KEK** = กุญแจที่ derive จากรหัส ใช้ห่อ DEK · **auth token** = 32 ไบต์ที่ derive จาก DEK ด้วย HKDF ใช้พิสูจน์ต่อเซิร์ฟเวอร์ว่ารู้ DEK (ไม่ใช่ความลับระดับ DEK แต่ห้ามเก็บ/ส่งไปที่อื่น/ใส่ log) · **auth_hash** = SHA-256(auth token) เก็บใน `itas_vault`

**ทำไมต้องมี auth token:** ผู้ที่มีแค่ session ของผู้ใช้ทะเบียน (เช่น แท็บที่ล็อกอินค้าง หรือ session ที่ถูกขโมย) แต่ไม่รู้รหัสตู้เซฟ/รหัสกู้คืน จะเรียก `app_itas_vault_rotate` เขียนทับชุด wrap แล้วทำให้ข้อมูลลับถอดไม่ออกถาวรไม่ได้ เพราะต้องมี auth token ซึ่ง derive ได้จาก DEK เท่านั้น (ได้ DEK = ปลดล็อกสำเร็จด้วยรหัสตู้เซฟหรือรหัสกู้คืนแล้ว) · token เดียวพิสูจน์ได้ทั้งทางรหัสตู้เซฟและทางรหัสกู้คืน เพราะ derive จาก DEK ไม่ใช่จากรหัส

**วิธีที่ใช้ Web Crypto ได้จริง (ทดสอบแล้วกับ Web Crypto ของ Node/V8 ได้ผลตรงกันทุกขั้น · ต้องลองซ้ำบน Chrome/Safari/Firefox/มือถือก่อน release):**
1. **ตั้งครั้งแรก** (`app_itas_vault_get` → `initialized:false`):
   - `raw = crypto.getRandomValues(new Uint8Array(32))` (DEK ดิบอยู่ในหน่วยความจำชั่วคราวเท่านั้น)
   - `dekAes = importKey('raw', raw, 'AES-GCM', **false**, ['encrypt','decrypt'])` และ `dekHkdf = importKey('raw', raw, 'HKDF', **false**, ['deriveBits'])` (non-extractable ทั้งคู่ · HKDF บังคับ non-extractable อยู่แล้ว)
   - `token = deriveBits({name:'HKDF', hash:'SHA-256', salt: new Uint8Array(0), info: utf8('itas-vault-auth-v1')}, dekHkdf, 256)` → 32 ไบต์ · `authHash = digest('SHA-256', token)` → 32 ไบต์ → base64 = `p_auth_hash`
   - ห่อ DEK: `c = AES-GCM-encrypt(KEK, n, raw, AAD)` (เข้ารหัส `raw` ตรง ๆ ได้ 48 ไบต์) ทั้ง 2 ชุด แล้ว **`raw.fill(0)` ทันที** และไม่เก็บ `raw` ไว้ที่ใด
   - รหัสตู้เซฟที่ผู้ใช้ตั้ง (บังคับ ≥ 14 ตัวอักษรฝั่งหน้าเว็บ) · รหัสกู้คืน **สุ่ม ≥ 160 บิต** (เช่น base32 32 ตัว) แสดงครั้งเดียวให้เจ้าของพิมพ์เก็บ
2. **KEK** = `PBKDF2-HMAC-SHA256(รหัส UTF-8 (NFKC), salt 16 ไบต์สุ่ม, iterations, 256 บิต)` → `importKey('raw', …, 'PBKDF2', false, ['deriveKey'])` แล้ว `deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations}, base, {name:'AES-GCM', length:256}, **false**, ['encrypt','decrypt','wrapKey','unwrapKey'])` · รหัสตู้เซฟและรหัสกู้คืนแต่ละอันมี **salt ของตัวเอง** · **iterations ค่าเริ่มต้น 1,000,000** (ฐานข้อมูลบังคับ 600,000–10,000,000 ทั้งสองชุด)
3. **ห่อ DEK**: `wrapped = {n: nonce 12 ไบต์สุ่ม, c: AES-GCM(KEK, n, DEK 32 ไบต์, AAD)}` ได้ `c` ยาว **48 ไบต์พอดี** (32 + tag 16) base64 มาตรฐานมี padding · ห่อ 2 ชุด (KEK จากรหัสตู้เซฟ และ KEK จากรหัสกู้คืน) · AAD แนะนำ `itas-vault|<real หรือ test>|<pass หรือ recovery>|<key_version>` (ฐานข้อมูลไม่ตรวจ AAD แต่ผูกการห่อกับวัตถุประสงค์ ป้องกันสลับชุด)
4. เรียก `app_itas_vault_init(p_kdf='PBKDF2-SHA256', p_kdf_iterations, p_salt, p_wrapped_key_pass{n,c}, p_recovery_kdf_iterations, p_recovery_salt, p_wrapped_key_recovery{n,c}, p_auth_hash)` → `{rev:1, key_version:1}` · **ตั้งได้ครั้งเดียวต่อโหมด** (ซ้ำ = error ไม่เขียนทับ) · **ตรวจตัวเองหลัง init**: `app_itas_vault_get` อ่านกลับ → ปลดล็อกด้วยรหัสที่เพิ่งตั้ง (ขั้น 5) → derive auth token แล้วเทียบ SHA-256 กับ `authHash` ที่ส่ง · ฐานข้อมูลตรวจไม่ได้ว่า `auth_hash` derive ถูก ถ้าหน้าเว็บส่งผิดแล้วไม่ตรวจ จะเปลี่ยนรหัสไม่ได้ในอนาคต (แก้ได้ด้วย SQL เท่านั้น) · init สำเร็จ → ผู้ใช้ทะเบียนทุกคนได้แจ้งเตือน
5. **ปลดล็อก**: `app_itas_vault_get` → derive KEK (ใช้ `kdf_iterations`/`salt` หรือ `recovery_*` ตามรหัสที่ผู้ใช้กรอก) → **ถอดห่อเป็น CryptoKey non-extractable โดยไม่เห็น raw**:
   - ทางที่ 1 (ต้องการ): `dekAes = unwrapKey('raw', c, KEK, {name:'AES-GCM', iv:n, additionalData:AAD}, {name:'AES-GCM'}, **false**, ['encrypt','decrypt'])` และ `dekHkdf = unwrapKey('raw', c, KEK, {…เดิม}, {name:'HKDF'}, **false**, ['deriveBits'])` (เรียก 2 ครั้งจาก `c` เดียวกัน)
   - ทางที่ 2 (สำรอง ถ้าเบราว์เซอร์ไม่รองรับ unwrapKey เป็น HKDF): `raw = new Uint8Array(await decrypt({name:'AES-GCM', iv:n, additionalData:AAD}, KEK, c))` → `importKey` 2 ครั้ง non-extractable → **`raw.fill(0)` ทันที**
   - ถอดสำเร็จ (GCM tag ผ่าน) = รหัสถูก ไม่มี hash ของรหัสเก็บที่ไหน · ลืมรหัสตู้เซฟ = ปลดล็อกด้วยรหัสกู้คืน (ใช้ชุด recovery) แล้วตั้งรหัสตู้เซฟใหม่
   - เก็บ `dekAes`, `dekHkdf` ไว้ในหน่วยความจำของแท็บเท่านั้น (ห้าม localStorage/sessionStorage/IndexedDB) · ไม่ต้อง export DEK ออกมาเลย
6. **เปลี่ยนรหัสตู้เซฟ / ออกรหัสกู้คืนใหม่**: ปลดล็อกให้ได้ DEK (ให้ผู้ใช้กรอกรหัสปัจจุบันหรือรหัสกู้คืนอีกครั้งในขั้นตอนนี้ — ห้ามใช้ DEK ที่ค้างจากเมื่อเช้าโดยไม่ถามซ้ำ) → derive **auth token** จาก `dekHkdf` (ข้อ 1) → สุ่ม salt ใหม่ + nonce ใหม่ → ห่อ DEK ด้วย KEK ใหม่ (ต้องมี DEK ดิบเพื่อ encrypt: ใช้ทางที่ 2 ของข้อ 5 คือ decrypt ได้ `raw` ชั่วคราว → encrypt ด้วย KEK ใหม่ → **`raw.fill(0)`** ทันที · `wrapKey` ใช้ไม่ได้เพราะ DEK ที่ unwrap มาเป็น non-extractable) → `app_itas_vault_rotate(p_expected_rev, p_action, p_auth_token, …)` โดยไม่แตะแถวข้อมูลและไม่เปลี่ยน DEK:
   - `p_action = 'change_password'`: ส่ง `p_kdf_iterations`, `p_salt`, `p_wrapped_key_pass` เท่านั้น (ห้ามส่งชุด recovery)
   - `p_action = 'new_recovery'`: ส่ง `p_recovery_kdf_iterations`, `p_recovery_salt`, `p_wrapped_key_recovery` เท่านั้น (ห้ามส่งชุดรหัสตู้เซฟ)
   - `p_auth_token` = base64 ของ token 32 ไบต์ (ไม่ใช่ `authHash`) · `p_expected_rev` = `rev` ที่อ่านจาก `vault_get` · salt และ wrapped ชุดใหม่ต้องไม่ซ้ำของเดิม
   - **ผลลัพธ์ 3 แบบ (หน้าเว็บต้องตรวจ `ok` ทุกครั้ง):** สำเร็จ `{ok:true, rev, key_version}` · token ผิด/ขาด/รูปแบบผิด **ไม่ raise** คืน `{ok:false, code:'AUTH_TOKEN_INVALID', message}` (ฐานข้อมูลบันทึก `rotate_failed` ใน `itas_vault_log` และแจ้งเตือนผู้ใช้ทะเบียน — ถ้า raise ธุรกรรมจะย้อนและ log หาย) → แสดงข้อความ ให้ปลดล็อกใหม่ · อย่างอื่น (rev ไม่ตรง ฯลฯ) raise error ตามปกติ (`40001` ให้โหลดตู้เซฟใหม่)
   - ทุกครั้งที่ rotate **สำเร็จ** ฐานข้อมูลเก็บชุดเดิมที่ถูกแทน (kdf, salt, wrapped key ทั้งชุดรหัสตู้เซฟและรหัสกู้คืน, rev) ไว้ใน `itas_vault_log.old_values` เพื่อกู้ถ้า rotate ผิดพลาด (ผู้ดูแลฐานข้อมูลกู้ด้วย SQL · ไม่มี RPC อ่านค่านี้)
7. **`key_version` vs `rev`**: `key_version` = รุ่นของ DEK ใช้ใน AAD ของช่องลับ **คงที่ 1** (ไม่เพิ่มเมื่อเปลี่ยนรหัส เพราะ DEK เดิม ciphertext จึงยังถอดได้) · `rev` = ตัวนับการแก้ตู้เซฟสำหรับกันเขียนชนกัน (เพิ่มทีละ 1 ทุกครั้งที่ rotate)
8. ผลข้างเคียงที่ต้องบอกผู้ใช้: ค้น/เรียง/กรองตามช่องลับทำได้เฉพาะหลังปลดล็อกและในเบราว์เซอร์ · ใบพิมพ์/ส่งออกไม่มีช่องลับเว้นแต่ปลดล็อกก่อน · ผู้ดูแลฐานข้อมูลลบ/ทำลาย ciphertext ได้ (อ่านไม่ได้) → ควรมีปุ่มส่งออกสำรองเป็นระยะ (ทำในหน้าเว็บ)

**Test vector (ตรวจ HKDF/SHA-256 ฝั่งเบราว์เซอร์ให้ตรงกับฐานข้อมูล):** DEK = 32 ไบต์ค่า `0x42` ทุกไบต์ · info `itas-vault-auth-v1` · salt ว่าง → token (hex) `30e36db01bf7486b79aed1574c8303f91c4f1ac4cfed16aeb36e611ca15b651c` = base64 `MONtsBv3SGt5rtFXTIMD+RxPGsTP7Raus25hHKFbZRw=` · `auth_hash` (hex) `f12f4d9cbf37097fa525f1f5192857e8c844d0b4284b0d4a39e2a6d14731fe9b` = base64 `8S9NnL83CX+lJfH1GShX6MhE0LQoSw1KOeKm0Ucx/ps=` (ฐานข้อมูลทดสอบว่า `sha256(decode(token))` ตรงค่านี้)

### ข้อกำหนดฝั่งหน้าเว็บที่ต้องทำตามตรงตัว (ความปลอดภัย)
1. **`updated_at`** ส่งกลับเป็นสตริงเดิมจากเซิร์ฟเวอร์ ห้ามผ่าน `Date` (ไมโครวินาทีหาย → ติด `40001` ตลอด)
2. **DEK / KEK เป็น non-extractable เสมอ** (`extractable = false` ทุกการ import/derive/unwrap) · ไม่มีขั้นตอนใดต้อง export DEK · `raw` ที่จำเป็นต้องมีชั่วคราว (ตอน init และตอนห่อใหม่) ต้อง `fill(0)` ทันทีหลังใช้
3. **ตรวจพารามิเตอร์ KDF ที่เซิร์ฟเวอร์ส่งมาก่อนใช้**: `kdf` ต้องเป็น `'PBKDF2-SHA256'` เท่านั้น · `kdf_iterations` และ `recovery_kdf_iterations` ต้อง **≥ 600,000** (และไม่เกิน 10,000,000) · `salt`/`recovery_salt` ต้อง base64 ยาว 16 ไบต์ — ผิดข้อใดให้ปฏิเสธและแจ้ง "ตู้เซฟผิดปกติ" **ห้าม derive** (กันผู้ที่แก้ข้อมูลตู้เซฟหรือตอบกลับปลอมลดรอบ KDF ให้เดารหัสได้ง่าย)
4. **ห้ามใส่ plaintext / รหัสตู้เซฟ / รหัสกู้คืน / DEK / auth token / ค่าช่องลับ ใน `Error.message`, `console.*`, payload ใด ๆ ที่ส่งออก** — แอปมี `modules/client-error-log.js` ส่งข้อความ error ขึ้นตาราง `client_error_logs` อัตโนมัติ ดังนั้นข้อความ error ของโค้ดตู้เซฟต้องเป็นข้อความคงที่ ไม่ต่อสตริงด้วยค่าที่ผู้ใช้กรอก/ถอดได้ · ห้ามใส่ลงในชื่อ/ค่า DOM ที่ถูก log
5. **ความยาวรหัส**: รหัสตู้เซฟ **≥ 14 ตัวอักษร** (บังคับฝั่งหน้าเว็บ ฐานข้อมูลกันเดารหัสไม่ได้) · รหัสกู้คืนสุ่มจาก `crypto.getRandomValues` ≥ **160 บิต** แสดงครั้งเดียว (ไม่เก็บ ไม่ส่ง) · KDF ค่าเริ่มต้น **1,000,000 รอบ** ทั้งสองชุด
6. **โหมดทดสอบใช้รหัสคนละตัวกับของจริง** (ตู้เซฟทดสอบถูกล้างได้และอาจถูกเห็นระหว่างทดสอบ) · หน้าเว็บบอกชัดว่ากำลังตั้ง/ปลดล็อกตู้เซฟของโหมดไหน
7. **base64 มาตรฐานมี padding** (`A–Z a–z 0–9 + /` และ `=`) ไม่ใช้ base64url ไม่มีขึ้นบรรทัดใหม่
8. **ข้อจำกัดที่ต้องรู้ (ไม่ใช่บั๊ก):** (ก) เปลี่ยนรหัสตู้เซฟ/ออกรหัสกู้คืนใหม่ **ไม่หมุน DEK** — ผู้ที่เคยรู้รหัสเก่าและเก็บ `wrapped_key` เก่าไว้ ยังถอด DEK ได้ถ้ามี wrapped เก่านั้น (การหมุน DEK ต้องเข้ารหัสทุกแถวใหม่ ยังไม่ทำ) (ข) ฐานข้อมูลตรวจ nonce ซ้ำ / ciphertext ปลอม / การสลับ ciphertext ข้ามแถว ไม่ได้ (ตรวจได้แค่รูปแบบและขนาด) หน้าเว็บต้องตรวจ GCM tag + AAD ตอนถอดเอง (ค) ผู้ที่แก้ JavaScript ที่เซิร์ฟเวอร์เสิร์ฟ หรือแทรกสคริปต์ผ่านช่องโหว่ XSS ดักรหัสตู้เซฟขณะพิมพ์ได้ — ตู้เซฟป้องกันเฉพาะผู้ที่เข้าถึงฐานข้อมูล/session แต่ไม่ได้เปลี่ยน JS (ง) auth token พิสูจน์ว่าผู้เรียกเคยปลดล็อกสำเร็จเท่านั้น ไม่กันผู้ที่แก้ JS แล้วดัก token

| RPC ตู้เซฟ | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itas_vault_get()` | — | `{initialized:false, is_test}` หรือ `{initialized:true, is_test, key_version, rev, kdf, kdf_iterations, salt, wrapped_key_pass{n,c}, recovery_kdf_iterations, recovery_salt, wrapped_key_recovery{n,c}, updated_at}` · **ไม่คืน `auth_hash`** |
| `app_itas_vault_init` | ดูข้อ 4 (มี `p_auth_hash` เป็นตัวท้าย) | `{rev, key_version}` |
| `app_itas_vault_rotate` | `p_expected_rev`, `p_action` (`change_password` / `new_recovery`), **`p_auth_token`**, `p_kdf_iterations`, `p_salt`, `p_wrapped_key_pass`, `p_recovery_kdf_iterations`, `p_recovery_salt`, `p_wrapped_key_recovery` (อีกชุดต้องเป็น null) | สำเร็จ `{ok:true, rev, key_version}` · token ผิด/ขาด `{ok:false, code:'AUTH_TOKEN_INVALID', message}` (ไม่ raise) |

### แจ้งเตือนเรื่องตู้เซฟ (ผ่านคิวกลาง `private.office_notify` = กระดิ่ง + อีเมล + Push)
ส่งถึงผู้อยู่ใน `itas_admins` (โหมดจริง) **ทุกคนรวมผู้ที่กดเอง** (จุดประสงค์คือให้เจ้าของบัญชีรู้ว่ามีการแตะตู้เซฟ แม้ผู้กดจะใช้ session ของเขา) · เหตุการณ์: ตั้งตู้เซฟแล้ว · เปลี่ยนรหัสตู้เซฟ · ออกรหัสกู้คืนใหม่ · มีผู้พยายามเปลี่ยนตู้เซฟแต่ไม่สำเร็จ (ส่งไม่เกิน 1 ครั้งต่อ 10 นาทีต่อโหมด กันท่วม; ทุกครั้งยังลง log) · ข้อความบอกว่า "โดยใคร (รหัสพนักงาน + ชื่อ) เมื่อไร (เวลาไทย)" ไม่มี secret · **ลิงก์ `action_url = '/'`** (ไปหน้าหลัก) เพราะโมดูลนี้ยังไม่มีเส้นทางเปิดตรงในแจ้งเตือน (ถ้าทำเส้นทางภายหลังต้องแก้ `app.js` `notificationHref`, `notify-email`, `notify-push` เหมือน itwo/itrp) · โหมดทดสอบ (persona) ไม่ส่งแจ้งเตือนเลย · แจ้งเตือนล้มเหลวไม่ขวางการบันทึกตู้เซฟ

## ข้อความ error ที่หน้าเว็บควรรู้จัก
| errcode | เมื่อ | ข้อความ (ตัวอย่าง) |
|---|---|---|
| `42501` | ไม่อยู่ใน allowlist `itas_admins` / ไม่ได้ล็อกอิน | "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้" |
| `40001` | แก้ชนกัน (อุปกรณ์ / ตู้เซฟ) | "ข้อมูลอุปกรณ์นี้ถูกแก้ไขไปแล้ว กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่" · "ตู้เซฟถูกเปลี่ยนจากที่อื่นแล้ว…" |
| `23514` | ข้อมูลไม่ผ่านกติกา (ซ้ำ ผิดรูป เกินขนาด ไม่พบ ฯลฯ) | ข้อความไทยเฉพาะข้อ เช่น "เลขทะเบียน … ซ้ำกับอุปกรณ์อื่น" · "ช่องลับ \"…\": nonce ของข้อมูลลับต้องเป็น base64 ยาว 12 ไบต์" · "ตั้งตู้เซฟไปแล้ว ตั้งซ้ำไม่ได้…" |
| (ไม่ใช่ error) `{ok:false, code:'AUTH_TOKEN_INVALID'}` | `app_itas_vault_rotate` ได้ auth token ผิด/ขาด | "ยืนยันกุญแจของตู้เซฟไม่ผ่าน จึงไม่ได้เปลี่ยนอะไร กรุณาปลดล็อกตู้เซฟด้วยรหัสที่ถูกต้องแล้วลองใหม่" |
| `SANDBOX_NOT_ACTIVE` | ล้างข้อมูลทดสอบนอกโหมดทดสอบ | (รหัสภาษาอังกฤษ ไม่แสดงตรง ๆ) |

## ลำดับ deploy และข้อควรระวัง
- migration นี้ต้อง apply ก่อนหน้าเว็บจะเรียก RPC ใหม่ · ต้องมี `20261220010000_st_rb_chemical_store.sql` อยู่ก่อน (ตรวจใน migration) เพราะ `private.sandbox_unguarded_tables()` ต่อจากฉบับนั้น
- ก่อน apply บน prod: เทียบ `md5(pg_get_functiondef('private.sandbox_unguarded_tables()'::regprocedure))` กับฉบับของ `20261220010000` (LF) ที่คาด **`7ac7b3ae556127c34f2d6813118d8313`** (ฉบับหลังต่อ rf_chem_docs · ฉบับก่อนหน้า = itrp_repair_history คาด `d9014bbdc23787364ca0da2e05926a14`) · ไม่ตรง = เพื่อนมี migration ใหม่ที่ replace ฟังก์ชันนี้ ให้ใช้ฉบับล่าสุดเป็นฐานแล้วต่อ 8 ชื่อ `itas_*` (itas_types, itas_type_log, itas_assets, itas_asset_log, itas_asset_moves, itas_vault, itas_vault_log, itas_admins) · **ฉบับของ migration นี้ (หลังต่อ 8 ชื่อ) คาด md5 LF `9b22c42d2011e5f706429f3a94319f78`**
- ก่อน apply บน prod ตรวจว่ามีพนักงาน `IT3462` (active, ผูกบัญชี) และ persona `SBX-IT-ADMIN` (migration จะ seed `itas_admins` จากสองคนนี้ และไม่ล้มถ้าไม่พบ แต่พิมพ์ NOTICE เตือน)
- หลัง apply ตรวจ: RLS ของ 8 ตาราง, ไม่มี grant ตรง, RPC 12 ตัว (รวม `app_itas_my_access`) anon เรียกไม่ได้และ `search_path=""`, ชนิดจริง 23 + ทดสอบ 23, `itas_admins` = IT3462 (จริง) + SBX-IT-ADMIN (ทดสอบ), ไม่มีแถว `itas_assets` / `itas_vault`
- ข้อมูลเดิมจาก Excel ยังไม่นำเข้า (ช่องไม่ลับ = สคริปต์แยก หลัง auditor + เจ้าของอนุมัติ · ช่องลับ = เจ้าของนำเข้าเองผ่านเบราว์เซอร์หลังปลดล็อก ไม่ผ่านมือ Claude/subagent)
- ยังไม่ได้ทำ (รอบหลัง): ผูกหัวใบ FM02 / ทะเบียน `itrp_devices` กับทะเบียนใหม่, ส่วนที่ 2 ทะเบียนสิทธิ์ผู้ใช้ (`User_Authorization_Record.xlsx`), ส่งออก/พิมพ์ทะเบียน
