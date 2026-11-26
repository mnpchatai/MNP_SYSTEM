# สัญญาฐานข้อมูลของโมดูล "ทะเบียนสิทธิ์ผู้ใช้" (`itua_*`)

migration: `supabase/migrations/20270105010000_itua_user_access_register.sql` · ทดสอบ: `supabase/tests/database/itua_user_access_register.test.sql`
สเปกต้นทาง: `Work-Order/docs/it-user-access-spec.md` (เจ้าของตอบ "ตามที่แนะนำ" 26/11/2026) · **ขั้นที่ 1 = ฐานข้อมูลของ "ทะเบียน" อย่างเดียว** (ยังไม่มีหน้าเว็บ ไม่นำเข้าข้อมูล ไม่มีใบขอสิทธิ์ `itar_*` ไม่มีช่องลับ/รหัสผ่าน)

ทุก RPC เรียกผ่าน `sb.rpc('app_itua_…', { p_… })` ด้วย session ของผู้ใช้ (SECURITY DEFINER, anon เรียกไม่ได้) · ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ (`error.message`) · ทุก RPC คืน `jsonb`
ตารางทั้งหมดปิดการเข้าถึงตรง (RLS deny-all + ไม่มี grant แม้แต่ service_role) อ่าน/เขียนผ่าน RPC เท่านั้น

## สิทธิ์
**เฉพาะผู้อยู่ใน `public.itas_admins`** (allowlist ของทะเบียนอุปกรณ์ IT ใช้ร่วมกัน: `IT3462` โหมดจริง + persona `SBX-IT-ADMIN` โหมดทดสอบ) · ไม่อ่าน `itwo_staff` · it_admin ของใบสั่งงาน IT ที่ไม่อยู่ใน allowlist / ผู้อนุมัติขั้น IT / ผู้จัดการ / พนักงาน / admin ของระบบ เรียกทุก RPC ไม่ได้ (`42501` "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนสิทธิ์ผู้ใช้ได้") · anon เรียกไม่ได้ · บัญชี lab-only เรียกไม่ได้
หน้าเว็บตัดสินว่าจะแสดงการ์ดหรือไม่ด้วย `app_itas_my_access()` ตัวเดิมของทะเบียนอุปกรณ์ (allowlist เดียวกัน) — ไม่มี `app_itua_my_access`

## โหมดทดสอบ (Admin Sandbox)
ทุกตารางมี `is_test` + trigger `private.sandbox_row_scope` (แบบเดียวกับ `itas_*`) · persona เห็น/แก้เฉพาะแถวทดสอบ แตะของจริงไม่ได้ (id ที่เป็นของจริงตอบ "ไม่พบผู้ใช้นี้")
- Auth. Name / รหัสโฟลเดอร์ / รหัสโปรแกรม / อีเมล ซ้ำกับของจริงได้ในโหมดทดสอบ (unique ต่อโหมด)
- โปรแกรมตั้งต้น 8 ตัว seed ให้ทั้งสองโหมด · โฟลเดอร์ไม่ seed (นำเข้าจากหัวคอลัมน์ชีต Authorization ในขั้นที่ 2)
- `app_sandbox_purge_itua()` (admin ตัวจริงที่อยู่ในโหมดทดสอบ) ลบเฉพาะแถว `is_test` ของทั้ง 8 ตาราง (ไม่ลง log รายแถว) แล้ว seed โปรแกรมทดสอบกลับ → คืน `{deleted}` · ไม่อยู่ในโหมดทดสอบ = `SANDBOX_NOT_ACTIVE` · บันทึก `audit_logs` action `ITUA_SANDBOX_PURGE` · ปุ่มล้างข้อมูลทดสอบของหน้าเว็บต้องเรียกตัวนี้ด้วย
- ไม่มีการแจ้งเตือน (ทั้งโหมดจริงและทดสอบ) ในขั้นนี้

## ตาราง (8)
| ตาราง | หน้าที่ | ลบได้ไหม |
|---|---|---|
| `itua_users` | ผู้ใช้ 1 แถวต่อ Auth. Name (`auth_id` ตัวเล็ก ไม่ซ้ำต่อโหมด) · `name_th`/`name_en` (มีอย่างน้อยหนึ่ง) · `department_code` (ข้อความอิสระ ตัวพิมพ์ใหญ่ ไม่ผูก FK) · `division` · `internet` · `status` · `granted_doc_no`/`granted_on` · `note` · `employee_id` (ไม่บังคับ ผูกคนละ 1 แถวต่อโหมด) | ไม่ได้ (ใช้ `status = resigned`) |
| `itua_emails` | อีเมลของผู้ใช้ (`address` ตัวเล็ก, `kind` internal/extra, `status` active/closed) ไม่เก็บรหัสผ่าน | ไม่ได้ (ปิดแทน · ปิดแล้วเปิดใหม่ไม่ได้ ให้เพิ่มแถวใหม่) |
| `itua_folders` | รายการโฟลเดอร์แชร์ (`code`, `name`, `description`, `sort`, `is_active`) | ไม่ได้ (ปิดแทน) · `code` แก้ไม่ได้ |
| `itua_folder_grants` | สิทธิ์โฟลเดอร์ปัจจุบัน `level` R/F · 1 แถวต่อ (ผู้ใช้, โฟลเดอร์) · ไม่มีสิทธิ์ = ไม่มีแถว | ถอนสิทธิ์ = ลบแถว (ผ่าน `app_itua_set_grants` เท่านั้น และ log เก็บค่าเดิมครบ) |
| `itua_programs` | รายการโปรแกรม (seed 8 ตัว) | ไม่ได้ (ปิดแทน) · `code` แก้ไม่ได้ |
| `itua_program_grants` | สิทธิ์โปรแกรมปัจจุบัน + `note` (บังคับเมื่อโปรแกรมรหัส `OTHER`) | ถอนสิทธิ์ = ลบแถว (เหมือนข้างบน) |
| `itua_log` | **ประวัติ ISO** ทุกการเปลี่ยนแปลง เขียนโดย trigger | เพิ่มได้อย่างเดียว |
| `itua_acknowledgements` | ประวัติผู้ใช้กดรับทราบสิทธิ์ (snapshot สิทธิ์ + เวอร์ชันนโยบาย) · รอบนี้ไม่มี RPC เขียน (ขั้นที่ 4) | เพิ่มได้อย่างเดียว |

### ค่าที่ใช้ซ้ำ
- `division`: `office` สำนักงาน · `factory` โรงงาน · `manager` ผู้จัดการ · `office_indesign` สำนักงาน (InDesign)
- `status` ผู้ใช้: `active` ใช้งาน · `resigned` ลาออก
- ระดับโฟลเดอร์: `R` อ่านอย่างเดียว · `F` เต็ม
- โปรแกรมตั้งต้น (`code` = ชื่อ): `IPRIME` iPrime · `ADOBE` Adobe Design · `EXPRESS` Express · `PAYROLL` PayRoll & Time Attendance · `AUTODESK` Autodesk Software · `POWERBI` PowerBI · `LINE` Line · `OTHER` อื่นๆ (ต้องมีหมายเหตุ)
- วันที่ส่ง/รับเป็นข้อความ `YYYY-MM-DD` (ค.ศ.) ระหว่าง 1990-01-01 ถึง 2100-01-01 (หน้าเว็บแปลงเป็น วว/ดด/ปปปป เอง)

## ประวัติ ISO (`itua_log`)
เขียนโดย trigger หลังเพิ่ม/แก้/ลบแถวของ 6 ตารางทะเบียนทุกทาง (ไม่ใช่โค้ด RPC) · RPC ส่ง "ผู้ทำรายการ + เหตุผล" ผ่านตัวแปร transaction-local `itua.actor_id` / `itua.reason`
- **แก้หรือลบแถวที่มีอยู่แล้วโดยไม่มีผู้ทำรายการหรือไม่มีเหตุผล = error** (fail-closed แม้ผู้ดูแลฐานข้อมูลแก้ตรง) · เพิ่มแถวใหม่ไม่บังคับเหตุผล · แก้โดยค่าไม่เปลี่ยน (ยกเว้น `updated_*`) ไม่ลง log · แถว seed ไม่ลง log
- คอลัมน์: `user_id` (null สำหรับแก้รายการโฟลเดอร์/โปรแกรมกลาง), `entity` (`user`/`email`/`folder_grant`/`program_grant`/`folder`/`program`), `entity_id` (user/email/folder/program = id แถว · folder_grant/program_grant = id ของโฟลเดอร์/โปรแกรม), `entity_code` (auth_id / ที่อยู่อีเมล / รหัสโฟลเดอร์ / รหัสโปรแกรม ณ ตอนนั้น), `action` (`created`/`updated`/`deleted`), `actor_id`, `reason`, `old_values`/`new_values` (ทั้งแถวเป็น jsonb · `deleted` ไม่มี new · `created` ไม่มี old), `created_at`
- `source_request_id` / `source_doc_no`: เตรียมไว้ให้ใบขอสิทธิ์ (ขั้นที่ 4) **รอบนี้เป็น null เสมอ** — trigger ไม่อ่านค่าจากผู้เรียก (ปลอมไม่ได้) ขั้นที่ 4 ต้องเพิ่มกลไกที่พิสูจน์ได้ (แบบ `itas.change_batch` ของ `itrp_itas_part_changes`)
- การเปลี่ยนสิทธิ์หนึ่งชุดทำให้เกิด log หนึ่งแถวต่อรายการ (โฟลเดอร์/โปรแกรมแต่ละตัว + แถวผู้ใช้เมื่อ `internet` เปลี่ยน) เรียงตาม `id`

## RPC (12)
### อ่าน
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itua_list_users` | `p_search`, `p_department_code`, `p_division`, `p_status`, `p_limit` (1–2000 ค่าเริ่มต้น 1000), `p_offset` (≥0) | `{total, items[{id, auth_id, name_th, name_en, department_code, division, internet, status, granted_doc_no, granted_on, updated_at, folder_r, folder_f, program_count, internal_email, email_count}]}` · ค้นไม่สนตัวพิมพ์ใหญ่เล็กใน Auth. Name/ชื่อไทย/ชื่ออังกฤษ/อีเมลที่ใช้งานอยู่ (`position` ไม่ใช้ `like` จึงไม่ตีความ `%` `_`) · `folder_r/f` นับสิทธิ์ทั้งหมดรวมโฟลเดอร์ที่ปิดใช้งาน · เรียงตาม Auth. Name |
| `app_itua_get_user(p_id, p_log_limit=200)` | uuid, 1–500 | `{user, folders[{folder_id, code, name, is_active, level, updated_at}], emails[{id, address, kind, status, created_at, updated_at}] (ใช้งานอยู่ก่อน ภายในก่อน), programs[{program_id, code, name, is_active, note, updated_at}], log[{id, entity, entity_id, entity_code, action, reason, actor_employee_no, actor_full_name, old_values, new_values, source_request_id, source_doc_no, created_at}] (ใหม่สุดก่อน), acknowledgements[{id, request_id, acknowledged_by_employee_no, acknowledged_by_full_name, acknowledged_at, snapshot, policy_version}] (≤20 ใหม่สุดก่อน)}` |
| `app_itua_matrix` | ตัวกรองและ paging เหมือน `list_users` | `{folders[{id, code, name, description, sort}] (เฉพาะที่ใช้งานอยู่), total, rows[{user_id, auth_id, name_th, name_en, department_code, division, status, internet, levels: {รหัสโฟลเดอร์: 'R'|'F'}}]}` · `levels` ไม่มีคีย์ = ไม่มีสิทธิ์ |
| `app_itua_list_catalog()` | — | `{folders[{id, code, name, description, sort, is_active, grant_count, updated_at}], programs[{id, code, name, sort, is_active, grant_count, updated_at}]}` รวมที่ปิดใช้งาน เรียงตาม `sort` |

### เขียน (ทุกตัวลง `itua_log` โดย trigger)
| RPC | พารามิเตอร์ | คืน / กติกา |
|---|---|---|
| `app_itua_save_user` | `p_id uuid` (ว่าง = เพิ่มใหม่), `p_data jsonb`, `p_reason`, `p_expected_updated_at` | `{user, created, changed}` · `p_data` ช่อง: `auth_id`, `name_th`, `name_en`, `department_code`, `division`, `granted_doc_no`, `granted_on`, `note`, `employee_id` (ส่งเฉพาะช่องที่เปลี่ยน · `null`/`""` = ล้าง · ช่องที่ไม่รู้จักรวม `internet`/`status` = error) · ต้องมี `auth_id` + `division` + ชื่ออย่างน้อยหนึ่ง · `auth_id` ถูกตัดช่องว่างและแปลงตัวเล็ก (a-z 0-9 `.` `_` `-` ≤60) · **แก้ผู้ใช้ที่มีอยู่ต้องส่ง `p_expected_updated_at` (ไม่ตรง = `40001` ให้โหลดใหม่) และ `p_reason` (เมื่อมีค่าเปลี่ยนจริง)** · ไม่มีค่าเปลี่ยน = `changed:false` ไม่ลง log |
| `app_itua_set_status(p_user_id, p_status, p_reason)` | `active`/`resigned` | `{user, changed, remaining:{folders, programs, internet, emails}}` · ต้องมีเหตุผลเมื่อสถานะเปลี่ยน · **ไม่ถอดสิทธิ์ให้เอง** — `remaining` บอกสิทธิ์ที่ยังเหลือ หน้าเว็บควรเตือนก่อนยืนยันลาออก แล้วเรียก `set_grants` ถอนให้ครบ |
| `app_itua_set_grants(p_user_id, p_changes, p_reason)` | ดูด้านล่าง | `{user_id, applied, changes[{kind, code, from, to}]}` · **atomic ทั้งชุด** (ข้อใดผิด = ไม่เปลี่ยนอะไรและไม่มี log) · เหตุผลบังคับ · ≤200 รายการ |
| `app_itua_add_email(p_user_id, p_address, p_kind='extra', p_reason=null)` | `internal`/`extra` | `{email, created}` · ที่อยู่ตัวเล็ก · ที่อยู่ที่ใช้งานอยู่ซ้ำข้ามผู้ใช้ไม่ได้ · `internal` ใช้งานได้ 1 ต่อคน · ผู้ใช้ที่ลาออกเพิ่มไม่ได้ |
| `app_itua_close_email(p_email_id, p_reason)` | uuid | `{email, changed}` · เหตุผลบังคับ · ปิดอยู่แล้ว = `changed:false` |
| `app_itua_save_folder` | `p_code`, `p_name`, `p_description`, `p_sort` (0–9999), `p_is_active`, `p_reason` | `{id, code, created, changed}` · ไม่มีรหัสนี้ = เพิ่ม (ไม่ต้องมีเหตุผล) · มีแล้ว = แก้ (ส่งค่าทั้งหมด · เหตุผลบังคับเมื่อค่าเปลี่ยน) · รหัส A–Z 0–9 `_` `-` ≤30 |
| `app_itua_save_program` | `p_code`, `p_name`, `p_sort`, `p_is_active`, `p_reason` | เหมือน `save_folder` (ไม่มีคำอธิบาย) |
| `app_sandbox_purge_itua()` | — | `{deleted}` (ดูหัวข้อโหมดทดสอบ) |

### รูปแบบ `p_changes` ของ `app_itua_set_grants`
array ของรายการ · **ทุกรายการต้องมีทั้ง `from` (ค่าเดิมที่หน้าจอเห็น) และ `to` (ค่าใหม่)**
- `{kind:'folder', code:'<รหัสโฟลเดอร์>', from: null|'R'|'F', to: null|'R'|'F'}` · `null` = ไม่มีสิทธิ์ (null→R/F เพิ่ม · R↔F เปลี่ยนระดับ · R/F→null ถอน)
- `{kind:'internet', from: boolean, to: boolean}`
- `{kind:'program', code:'<รหัสโปรแกรม>', from: boolean, to: boolean, note?: text, from_note?: text}` · `note` บังคับเมื่อ `to=true` และเป็นโปรแกรม `OTHER` · `from=to=true` + `note` ที่ต่างจากเดิม = แก้หมายเหตุ · `from_note` (ถ้าส่ง) ต้องตรงกับหมายเหตุในฐานข้อมูล
- ค่า `from` ไม่ตรงกับฐานข้อมูลตอนนี้ → error `40001` "สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น (ถูกแก้ไปแล้ว) กรุณาโหลดข้อมูลล่าสุดแล้วลองใหม่" (หน้าเว็บให้โหลดใหม่แล้วลองอีกครั้ง)
- `from = to` โดยไม่มีการแก้หมายเหตุ / รายการซ้ำ (โฟลเดอร์/โปรแกรมเดียวกันสองครั้ง) / ไม่รู้จักรหัส / `kind` ผิด = error `23514`
- ผู้ใช้ที่ลาออกแล้ว: ถอนสิทธิ์ได้อย่างเดียว (to = null/false) · โฟลเดอร์/โปรแกรมที่ปิดใช้งาน: เพิ่ม/เปลี่ยนไม่ได้ ถอนได้

## ข้อควรระวังของหน้าเว็บ
- ใช้ `expected_updated_at` ของ `get_user().user.updated_at` เมื่อแก้ผู้ใช้ · การเปลี่ยนสิทธิ์ (`set_grants`) ทำให้ `updated_at` ของผู้ใช้ขยับด้วย (โหลดใหม่ก่อนแก้ข้อมูลหลักต่อ)
- `get_user.log` ใช้แสดงไทม์ไลน์ได้ตรง ๆ: `entity_code` เป็นชื่ออ่านง่าย · เหตุผลอยู่ใน `reason` · `old_values`/`new_values` เป็นทั้งแถว (หน้าเว็บเลือกแสดงเฉพาะช่องที่ต่าง)
- ไม่มีช่องลับในขั้นนี้ ใบพิมพ์/CSV/หน้ารับทราบจึงไม่มีทางหลุดรหัสผ่านจากตารางเหล่านี้ (คอลัมน์ที่ชื่อ pass/secret/license/cipher ห้ามมีในตาราง `itua_*` — มี test)
- ขั้นที่ 4 (ใบขอสิทธิ์) จะเพิ่ม RPC รับทราบ, `source_request_id`/`source_doc_no` และอาจต้อง replace ฟังก์ชันของโมดูลนี้ — ไม่แก้ migration นี้ ให้ทำ migration ใหม่
