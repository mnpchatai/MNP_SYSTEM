# สัญญาฐานข้อมูลของโมดูล "ใบขอสิทธิ์ IT" (`itar_*`)

migration: `supabase/migrations/20270107010000_itar_access_requests.sql` · ทดสอบ: `supabase/tests/database/itar_access_requests.test.sql` (แกน) · `itar_files.test.sql` (ไฟล์แนบ/Storage) · `itar_notify.test.sql` (แจ้งเตือน)
สเปกต้นทาง: `Work-Order/docs/it-user-access-spec.md` (เจ้าของตอบ "ตามที่แนะนำ" ทั้ง 10 ข้อ 26/11/2026) + `Work-Order/docs/it-approver-worktime-spec.md` ส่วน A · **ขั้นที่ 4 = ฐานข้อมูลของ "ใบขอสิทธิ์" อย่างเดียว** (ยังไม่มีหน้าเว็บ ใบพิมพ์ USER-REQ/USER-Page และเส้นทางแจ้งเตือน `/office/access/` ใน app.js/notify-email/notify-push อยู่ขั้นที่ 5)

โครงคัดจากใบแจ้งซ่อม (`itrp_*` — ดู `docs/itrp-contract.md`) ฉบับล่าสุดบน main แล้วปรับเป็นใบขอสิทธิ์ · ผู้อ่านหน้าเว็บที่เคยทำ itrp: ชื่อ RPC/รูปข้อมูลคล้ายกัน ต่างที่ "ผู้ยื่น (requester)" กับ "ผู้รับสิทธิ์ (subject)" แยกกัน, รายการสิทธิ์ที่ขอ (`items`), การบันทึกลงทะเบียน (`apply`) และการรับทราบ (`acknowledge`)

ทุก RPC เรียกผ่าน `sb.rpc('app_itar_…', { p_… })` ด้วย session ของผู้ใช้ (SECURITY DEFINER, anon เรียกไม่ได้) · ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ (`error.message`) · ตารางทั้งหมดปิดการเข้าถึงตรง (RLS deny-all + ไม่มี grant แม้แต่ service_role)

## บทบาทและสิทธิ์
| บทบาท | ที่มา | ทำอะไรได้ |
|---|---|---|
| ผู้ยื่น | พนักงานที่ล็อกอินทุกคน | ยื่น **ของตัวเอง** (ทุกประเภท) · ตอบคำถาม · ยกเลิกใบตัวเองก่อน IT บันทึกลงทะเบียน · แนบไฟล์ตอนยื่น |
| ผู้จัดการ/ผู้ช่วยผู้จัดการแผนก | `roles` = department_manager / assistant_department_manager | อนุมัติขั้นแผนกของแผนกผู้รับสิทธิ์ · ถามผู้ยื่น · **ยื่น `revoke_all` แทนลูกน้องในแผนกตัวเอง** (เฉพาะประเภทนี้) |
| ผู้อนุมัติขั้น IT | `itwo_staff.is_it_approver` (IT3462) | อนุมัติขั้น IT · แผนกที่ไม่มีผู้จัดการ/ผู้ช่วย = กดครั้งเดียวนับสองขั้น |
| หัวหน้า IT (ดูอย่างเดียว) | `itwo_staff.is_it_viewer` (FANG) | เห็นทุกใบ · **อนุมัติเฉพาะใบที่ผู้ยื่นหรือผู้รับสิทธิ์เป็นผู้อนุมัติขั้น IT เอง** (ทั้งสองขั้นถ้าแผนกไม่มีผู้จัดการ) |
| ผู้ดูแลงาน IT | `itwo_staff.is_it_admin` | **ยื่นแทนใครก็ได้ (รวมคนที่ไม่มีบัญชี)** · กดรับงาน · ถามผู้ยื่น · ยกเลิกแทนผู้ยื่น (ก่อนบันทึกลงทะเบียน) · แนบรูปใบรับทราบกระดาษ + กด "รับทราบแล้ว (กระดาษ)" · ตั้งเลขเอกสารถัดไป |
| ผู้บันทึกลงทะเบียน | ผู้ดูแลงาน IT **และ** อยู่ใน `itas_admins` ของโหมดนั้น (IT3462 / persona SBX-IT-ADMIN) | `app_itar_apply` / `app_itar_apply_context` (เขียนทะเบียนสิทธิ์) |

- ห้ามอนุมัติ/ไม่อนุมัติใบที่ตัวเองเป็นผู้ยื่นหรือผู้รับสิทธิ์ · ผู้อนุมัติขั้นแผนกไม่นับผู้ยื่น/ผู้รับสิทธิ์ (ถ้าไม่เหลือใคร = ผู้อนุมัติขั้น IT กดครั้งเดียว)
- ผู้ยื่นเป็นผู้จัดการ/ผู้ช่วยของแผนกผู้รับสิทธิ์เอง → ข้ามขั้นแผนก (ระบบบันทึก `dept_approved` ในชื่อผู้ยื่นตอนยื่น)
- ใบที่ผู้ยื่นหรือผู้รับสิทธิ์เป็น `is_it_approver` → ขั้น IT = `is_it_viewer` ถ้าตอนนี้ไม่มีหัวหน้า IT ที่ใช้งานอยู่ ใบรอไว้ (ไม่ปฏิเสธการยื่น ไม่ผ่านอัตโนมัติ) · ถ้าผู้รับสิทธิ์เป็นหัวหน้า IT เอง และผู้ยื่นเป็นผู้อนุมัติขั้น IT ใบจะไม่มีใครอนุมัติได้ → IT ยกเลิกแล้วยื่นใหม่ (เคสหายาก)
- การมองเห็น: ผู้ยื่น · ผู้รับสิทธิ์ที่มีบัญชี · ทุกคนใน `itwo_staff` (รวมหัวหน้า IT) · ผู้อนุมัติขั้นแผนกของแผนกผู้รับสิทธิ์ · คนอื่นได้ "ไม่พบใบขอสิทธิ์นี้หรือคุณไม่มีสิทธิ์ดูใบนี้" · รายละเอียดคืนเฉพาะสิทธิ์ของผู้รับสิทธิ์ในใบนั้น (ไม่เปิดทะเบียนคนอื่น) **ไม่มีรหัสผ่าน/ช่องลับใด ๆ** (ทะเบียนยังไม่มีช่องลับ)
- anon / บัญชี lab-only เรียกไม่ได้ · พนักงานที่ไม่มีบัญชีใช้งานเรียกไม่ได้

## ประเภทและสถานะ
- ประเภท `request_type`: `new` ขอใหม่ (ผู้ใช้ยังไม่มีในทะเบียน — เพิ่มสิทธิ์ได้อย่างเดียว) · `change` เปลี่ยนแปลง · `revoke_all` ยกเลิกทั้งหมด (ลาออก/ย้าย — ไม่มีรายการ ระบบถอดสิทธิ์ทั้งหมดให้) · เหตุผลรวมบังคับ · **ไม่มีงานด่วน**
- สถานะ `status`: `pending_dept` → `pending_it_mgr` → `approved` → `in_progress` (IT กดรับงาน) → `awaiting_ack` (IT บันทึกลงทะเบียนแล้ว รอผู้ใช้รับทราบ) → `done`
  ปลายทางอื่น: `rejected` · `cancelled` · `need_info` (รอผู้ยื่นตอบ · `info_return_status` = สถานะที่จะกลับไป)
  **`revoke_all` หลัง apply ไป `done` เลย** (ไม่ต้องรอรับทราบ)
- ยกเลิก: ผู้ยื่น หรือผู้ดูแลงาน IT (แทน ประวัติขึ้นต้น `IT ยกเลิกแทนผู้ยื่น: `) ได้ใน `pending_dept`/`pending_it_mgr`/`approved`/`in_progress`/`need_info` เท่านั้น · **หลัง apply ยกเลิกไม่ได้** (สิทธิ์เปลี่ยนไปแล้ว ต้องยื่นใบใหม่เพื่อย้อน)
- ไม่อนุมัติ = จบทันที ต้องมีเหตุผล · ระหว่าง `need_info` ทั้งอนุมัติและไม่อนุมัติไม่ได้
- เลขเอกสาร `IT08-01-YY/NNN` (ปีตามเวลาไทย · ตัวนับแยกโหมด · ทดสอบขึ้นต้น `TEST-` · เกิน 999 แสดงเต็ม) ออกฝั่งฐานข้อมูลแบบ lock · ตั้งเลขถัดไปเดินหน้าอย่างเดียว

## ผู้รับสิทธิ์ (subject) และการหาแผนก
`p_subject` (jsonb ไม่บังคับ · ไม่ส่ง = ตัวผู้ยื่นเอง) ช่อง: `employee_id` (พนักงานที่มีบัญชี) · `user_id` (ผู้ใช้ในทะเบียนสิทธิ์ `itua_users`) · `name_th` / `name_en` / `department_id` / `division` (ผู้รับสิทธิ์ที่ไม่มีบัญชีและไม่มีในทะเบียน — เฉพาะ IT)
- มีบัญชีพนักงาน → แผนก = แผนกของพนักงาน · ผูกผู้ใช้ทะเบียนอัตโนมัติถ้า `itua_users.employee_id` ตรง (ไม่ผูก = `subject_user_id` เป็น null: ยื่นได้เฉพาะ "to" ไม่รู้ค่าเดิม `from_known=false` ให้ IT เลือกผู้ใช้ตอน apply)
- ผู้ใช้ทะเบียนที่ไม่มีบัญชี → แผนกจากรหัสแผนกของผู้ใช้ (`departments.code` ตรง) ไม่ตรงต้องส่ง `department_id` · ผู้จัดการแผนกยื่น `revoke_all` ได้เมื่อรหัสแผนกของผู้ใช้ตรงแผนกตัวเอง
- `new`: ต้องระบุ `division` (`office` / `factory` / `manager` / `office_indesign`) · ผู้ใช้ที่มีในทะเบียนแล้วใช้ `new` ไม่ได้ · ผู้ใช้ทะเบียนที่ลาออกแล้วยื่น `change`/`revoke_all` ไม่ได้
- ผู้รับสิทธิ์ที่ไม่มีบัญชี (`subject.has_account = false`) รับทราบด้วยกระดาษ (IT กดแทน + แนบรูปใบที่เซ็น)

## ตาราง (8)
| ตาราง | หน้าที่ | ลบ/แก้ได้ไหม |
|---|---|---|
| `itar_requests` | ใบ · snapshot ผู้รับสิทธิ์ (ชื่อไทย/อังกฤษ แผนก ฝ่าย) · `applied_summary` (ก่อน→หลัง) | ลบไม่ได้ · เปลี่ยนได้แค่ `status`/`info_return_status` + ตั้ง `subject_user_id`/`applied_summary` ครั้งเดียวตอน apply |
| `itar_request_items` | รายการสิทธิ์ที่ขอ (ก่อน→หลัง) | เพิ่มได้อย่างเดียว |
| `itar_item_results` | ผลที่ IT ตัดสินต่อรายการ (applied / rejected + เหตุผล) | เพิ่มได้อย่างเดียว |
| `itar_events` | **ประวัติ ISO / ลายเซ็นอิเล็กทรอนิกส์** | เพิ่มได้อย่างเดียว |
| `itar_comments` | คำถาม/คำตอบ | เพิ่มได้อย่างเดียว |
| `itar_attachments` | ทะเบียนไฟล์แนบ (ตัวไฟล์อยู่ Storage) | เพิ่มได้อย่างเดียว |
| `itar_admin_log` | ประวัติตั้งเลขเอกสารถัดไป | เพิ่มได้อย่างเดียว |
| `itar_doc_counters` | ตัวนับเลขรายปี แยกโหมด | ผ่านฟังก์ชันเท่านั้น |

`itar_events.action`: `created` · `dept_approved` · `dept_rejected` · `it_mgr_approved` · `it_mgr_rejected` · `cancelled` · `started` · `applied` · `acknowledged` · `info_requested` · `info_provided`

### รูปรายการสิทธิ์ที่ขอ (`p_items` ของ `app_itar_create` และ `items[]` ของ detail)
| `kind` | `target` | `from` / `to` | อื่น ๆ |
|---|---|---|---|
| `folder` | รหัสโฟลเดอร์ (ตัวพิมพ์ใหญ่) | `null` (ไม่มีสิทธิ์) / `'R'` / `'F'` | โฟลเดอร์ปิดใช้งานขอไม่ได้ |
| `internet` | — | boolean | `note` = เหตุผลที่ขอใช้ (**บังคับเมื่อ `to` = true**) |
| `program` | รหัสโปรแกรม | boolean | `note` บังคับเมื่อรหัส `OTHER` |
| `email` | ที่อยู่อีเมล | ไม่มี `from` · `to` = `'add'` / `'close'` | `email_kind` = `internal` (1 ต่อคน) / `extra` เมื่อ add |
- `from` = ค่าปัจจุบันที่ผู้ยื่นเห็น · **ต้องตรงกับทะเบียนตอนยื่น** (ไม่ตรง = `40001` ให้โหลดใหม่) เมื่อผู้รับสิทธิ์ผูกทะเบียนแล้ว · ผู้รับสิทธิ์ที่ยังไม่ผูก/ขอใหม่ ไม่ต้องส่ง `from`
- รายการซ้ำ (โฟลเดอร์/โปรแกรม/อีเมลเดียวกัน) ไม่ได้ · ≤ 80 รายการ · `new` ต้องเป็นการเพิ่มเท่านั้น
- detail คืนต่อรายการ: `id, line_no, kind, target, target_name, from_known, from_value, to_value, note, email_kind, result {decision, reason, at}|null` (`from_value`/`to_value` เป็นข้อความ: folder `R`/`F`/null · internet/program `'true'`/`'false'` · email `to_value` = `add`/`close`)

## RPC (25 + purge)
### ยื่น / ฟอร์ม
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itar_my_role()` | — | `{employee_id, employee_no, full_name, is_test, department, is_it_department, is_dept_approver, is_it_admin, is_it_approver, is_it_viewer, is_itas_admin, can_file_for_others}` |
| `app_itar_form_context(p_request_type='change', p_subject=null)` | ประเภท + ผู้รับสิทธิ์ | `{request_type, subject {employee_id, user_id, name_th, name_en, department_id, department_code, department_name, division}, linked, rights (สิทธิ์ปัจจุบันของผู้รับสิทธิ์ หรือ null), catalog {folders[{code,name,description}], programs[{code,name}]} (เฉพาะที่เปิดใช้), departments[{id,code,name_th}] (เฉพาะ IT), policy {version,text}}` — ตรวจสิทธิ์ยื่นให้ผู้รับสิทธิ์คนนี้ด้วยกฎเดียวกับ create |
| `app_itar_search_subjects(p_search)` | ≥ 2 ตัวอักษร | `{employees[{id, employee_no, full_name, department_id, department_name, user_id}], users[{id, auth_id, name_th, name_en, department_code, status, employee_id}]}` ≤ 20 ต่อกลุ่ม · IT เห็นทุกคน · ผจก.แผนกเห็นเฉพาะแผนกตัวเอง · `user_id` ของพนักงานและกลุ่ม `users` เปิดให้เฉพาะ `itas_admins` (และผู้ใช้แผนกตัวเองของผจก.) |
| `app_itar_create(p_request_type, p_reason, p_items=[], p_subject=null)` | ดูด้านบน | `{id, doc_no}` (แถวเดียว) |

### อนุมัติ / ดำเนินการ
| RPC | พารามิเตอร์ | หมายเหตุ |
|---|---|---|
| `app_itar_approve(p_request_id)` | | ผู้อนุมัติของขั้นที่ใบรออยู่ · ผู้อนุมัติขั้น IT กดครั้งเดียวนับสองขั้นเมื่อไม่ต้องรอแผนก |
| `app_itar_reject(p_request_id, p_reason)` | เหตุผล ≤ 500 | จบทันที |
| `app_itar_cancel(p_request_id, p_reason)` | เหตุผล ≤ 500 | ผู้ยื่น หรือ IT แทน · หลัง apply ไม่ได้ |
| `app_itar_start(p_request_id)` | | ผู้ดูแลงาน IT · เมื่อ `approved` เท่านั้น |
| `app_itar_request_info(p_request_id, p_body)` | ≤ 2,000 | → `{comment_id}` · ผู้อนุมัติของขั้นที่รออยู่ (`stage` = `dept`/`it_mgr`) หรือผู้ดูแลงาน IT หลังอนุมัติ (`it`) · ใบ → `need_info` |
| `app_itar_provide_info(p_request_id, p_body)` | | → `{comment_id}` · ผู้ยื่นเท่านั้น · ใบกลับสถานะเดิม |

### บันทึกลงทะเบียน (IT) — หัวใจของขั้นนี้
`app_itar_apply_context(p_request_id)` (ต้องเป็นทั้ง `is_it_admin` และ `itas_admins`) คืน
`{request{id,doc_no,request_type,status,reason,subject_*}, needs_user_choice, needs_new_user, can_apply, items[{…รูปรายการ, target_name, current_known, current_value}], subject_rights, suggested_users[{id,auth_id,name_th,name_en,department_code,status,employee_id}]}`
- `current_value` (เมื่อผูกผู้ใช้ทะเบียนแล้ว): folder `R`/`F`/null · internet/program `'true'`/`'false'` · email `'active'`/null
- `needs_user_choice` = ใบ `change`/`revoke_all` ที่ยังไม่ผูกผู้ใช้ทะเบียน → ต้องส่ง `p_user_id` · `needs_new_user` = ใบ `new` → ต้องส่ง `p_new_user.auth_id`

`app_itar_apply(p_request_id, p_decisions, p_user_id=null, p_new_user=null, p_link_employee=false)` → `{status, user_id, doc_no, applied, rejected}`
- `p_decisions`: array **ครบทุกรายการ** `[{item_id, decision:'applied'|'rejected', reason}]` (`rejected` ต้องมีเหตุผล ≤ 500) · `revoke_all` ส่ง `[]`/null · ต้อง `applied` อย่างน้อย 1 (ไม่ทำเลย = ยกเลิกใบแทน)
- `p_new_user` (ใบ `new`): `{auth_id (บังคับ), name_th?, name_en?}` · ชื่อ/แผนก/ฝ่าย/พนักงานที่ผูกมาจาก snapshot ของใบ · `p_user_id` (ใบ `change`/`revoke_all` ที่ยังไม่ผูก) · `p_link_employee` = ผูก `employee_id` ของผู้ใช้ทะเบียนกับพนักงานผู้รับสิทธิ์ (เมื่อผู้ใช้ทะเบียนยังไม่ผูก)
- **atomic ทั้งใบ**: ข้อใดผิดหรือค่าเดิมในทะเบียนไม่ตรงกับที่ผู้ยื่นเห็น = ไม่เปลี่ยนอะไรเลย (รวมประวัติและผลต่อรายการ) · ค่าเดิมไม่ตรง = `40001` ให้โหลด context ใหม่แล้วลองอีกครั้ง · ผู้รับสิทธิ์ที่ยังไม่ผูกตอนยื่น (ไม่รู้ค่าเดิม): ถ้าทะเบียนมีสิทธิ์ตามที่ขออยู่แล้ว ให้ IT เลือก `rejected` พร้อมเหตุผล
- เขียนทะเบียนผ่าน `app_itua_*` เดิมเท่านั้น (จึงลง `itua_log` ครบ) พร้อม `source_request_id` / `source_doc_no` ของใบ · ตั้ง `granted_doc_no`/`granted_on` ของผู้ใช้ · `revoke_all` = ถอดทุกโฟลเดอร์/อินเทอร์เน็ต/โปรแกรม + ปิดอีเมลทั้งหมด + สถานะ `resigned`
- ผลลัพธ์: `new`/`change` → `awaiting_ack` · `revoke_all` → `done` · บันทึก `applied` event + `itar_item_results` + `applied_summary {before, after, items[], applied_count, rejected_count, user_id}`

### ที่มาของการเปลี่ยนในประวัติทะเบียน (ISO)
`itua_log.source_request_id` / `source_doc_no` ตั้งโดย `private.itua_log()` เท่านั้น (ฉบับใหม่ของ migration นี้) โดยอ่านจากตัวแปร transaction-local `itua.source_event_id` ที่ `private.itar_begin_apply(event_id)` ตั้ง (ถอนสิทธิ์ทุก role) แล้วตรวจกับตาราง: ต้องเป็น event `applied` จริงของใบที่ `in_progress` ในโหมดเดียวกัน · เลขใบอ่านจากตาราง ไม่รับจากผู้เรียก · ไม่ผ่าน = `null` (ปลอมไม่ได้ — มี test)

### รับทราบ
| RPC | หมายเหตุ |
|---|---|
| `app_itar_acknowledge(p_request_id)` | → `{status:'done', doc_no}` · ผู้รับสิทธิ์ที่มีบัญชีกดเอง (ชื่อ + วันเวลา = ลายเซ็น) · เก็บ snapshot สิทธิ์ทั้งหมดหลังเปลี่ยน + เวอร์ชันนโยบายลง `itua_acknowledgements` (`method` = `online`) |
| `app_itar_acknowledge_paper(p_request_id, p_note=null)` | ผู้ดูแลงาน IT · เฉพาะผู้รับสิทธิ์ที่ไม่มีบัญชี · **ต้องแนบรูปใบที่เซ็นแล้ว ≥ 1 ไฟล์ก่อน** · `method` = `paper` |

ข้อความนโยบาย: `detail.policy` = `{version:'IT08-01/1', text:'ผู้ใช้รับทราบและต้องปฏิบัติตามนโยบายการใช้งานระบบเครือข่ายและคอมพิวเตอร์'}` (เปลี่ยนข้อความต้องขึ้นเวอร์ชันใหม่ใน `private.itar_policy()`)

### อ่านข้อมูล
| RPC | คืน |
|---|---|
| `app_itar_get_detail(p_request_id)` | `{id, is_test, doc_no, doc_year, doc_seq, request_type, reason, status, info_return_status, created_at, requester_id, department_id, requester{employee_no,full_name}, department{code,name_th}, subject{employee_id, employee_no, user_id, name_th, name_en, department_code, division, has_account}, items[], subject_rights|null, applied_summary|null, events[{id,action,reason,created_at,actor_employee_no,actor_full_name}], attachments[], paper_attachments[], comments[{id,kind,stage,body,reply_to,created_at,author_*,attachments[]}], info_pending|null, approvals{dept,it_mgr}, started, applied, acknowledged{by,at,reason,method}, policy, allowed_actions[]}` |
| `app_itar_list_mine()` | ใบที่เป็นผู้ยื่นหรือผู้รับสิทธิ์: `id, doc_no, status, request_type, subject_name, department_name, requester_name, created_at, item_count, info_return_status, info_stage, is_requester, needs_my_ack` |
| `app_itar_list_pending_approvals()` | ใบที่รอตัวเองพิจารณา (รวม `need_info`) + `pending_step` (`dept`/`it_mgr`) |
| `app_itar_pending_count()` | จำนวนใบที่รอตัวเองกดอนุมัติ (ป้ายตัวเลข) |
| `app_itar_list_it()` | ทุกใบในโหมด (ทีมใน `itwo_staff` รวมหัวหน้า IT) · ใบที่รอ IT ลงมือขึ้นก่อน · + `has_dept_approved`, `has_it_mgr_approved` |
| `app_itar_get_doc_counter(p_year=null)` / `app_itar_set_next_doc_seq(p_next, p_year=null)` | ผู้ดูแลงาน IT · เลขถัดไปเดินหน้าอย่างเดียว · ปีนี้หรือปีหน้า · ลง `itar_admin_log` |
| `app_itar_list_staff()` | ผู้ดูแลงาน IT · `employee_id, employee_no, full_name, department_name, is_it_admin, is_it_approver, is_it_viewer, is_itas_admin, is_active` (อ่านอย่างเดียวจาก `itwo_staff`) |

**ปุ่มที่แสดงให้ดู `detail.allowed_actions`** (ตรรกะเดียวกับ RPC): `cancel` · `approve` · `reject` · `start` · `apply` · `acknowledge` · `acknowledge_paper` · `add_paper_attachment` · `request_info` · `provide_info`

## ไฟล์แนบ (Storage)
- บัคเก็ต private `itar-files` (จริง) / `itar-test-files` (ทดสอบ) · 20 MB · 13 ชนิด (เหมือน itwo/itrp: รูป JPG/PNG/WEBP/HEIC/HEIF, PDF, Word/Excel/PowerPoint, TXT, CSV) · path ต้องเป็น `<request_id>/<uuid ตัวพิมพ์เล็ก>.<นามสกุล>`
- **ลำดับ**: อัปโหลดเข้า Storage ก่อน (policy ตรวจสิทธิ์) แล้วเรียก RPC ลงทะเบียน · ชนิด/ขนาดใช้ค่าจาก Storage เสมอ (ค่าที่ส่งไปไม่ถูกเชื่อ) · ลงทะเบียน path เดิมซ้ำ = คืนทะเบียนเดิม (ลองใหม่หลังเน็ตหลุด)
- 3 กลุ่ม (ทุกกลุ่ม ≤ 10 ไฟล์ต่อชุด):
  | RPC | ใครแนบได้ | เมื่อไหร่ |
  |---|---|---|
  | `app_itar_add_attachment(p_request_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes)` → uuid | ผู้ยื่น | ภายใน 30 นาทีหลังยื่น และก่อนมีผู้อื่นอนุมัติจริง |
  | `app_itar_add_comment_attachment(p_request_id, p_comment_id, …)` | ผู้เขียนข้อความ | ภายใน 30 นาทีหลังส่งข้อความ |
  | `app_itar_add_paper_attachment(p_request_id, …)` | ผู้ดูแลงาน IT | ใบ `awaiting_ack` ของผู้รับสิทธิ์ที่ไม่มีบัญชี (ไม่จำกัดเวลา) |
- อ่านได้ตามสิทธิ์เห็นใบ · ไม่มี UPDATE/DELETE ของบัคเก็ตจริง · เพดานกว้างกัน spam: 40 ออบเจ็กต์ + 20 ต่อข้อความในโฟลเดอร์ใบ
- detail: `attachments[]` (ตอนยื่น) · `paper_attachments[]` (ใบรับทราบกระดาษ) · `comments[].attachments[]` · แต่ละไฟล์มี `bucket` ให้หน้าเว็บสร้าง signed URL

## แจ้งเตือน (กระดิ่ง/อีเมล/Push ผ่าน `private.office_notify` กลาง)
action_url `/office/access/<uuid>` (**ขั้นที่ 5 ต้องเพิ่มเส้นทางนี้ใน `app.js` `notificationHref`, `notify-email`, `notify-push` แล้ว deploy Edge Function**) · ใบทดสอบไม่ส่ง · `started` ไม่แจ้ง · ไม่ส่งถึงคนที่กดเอง · แจ้งเตือนล้ม = การกระทำไม่ล้มตาม
| เหตุการณ์ | ผู้รับ |
|---|---|
| `created` | ผู้อนุมัติแผนก (ไม่นับผู้ยื่น/ผู้รับสิทธิ์) หรือผู้อนุมัติขั้น IT ทันที (ใบที่เกี่ยวกับผู้อนุมัติขั้น IT → หัวหน้า IT) |
| `dept_approved` | ผู้อนุมัติขั้น IT (ข้ามเมื่ออนุมัติในตัว/กดครั้งเดียวสองขั้น) |
| `it_mgr_approved` | ผู้ยื่น + ผู้รับสิทธิ์ที่มีบัญชี ("รอ IT ดำเนินการ") · ผู้ดูแลงาน IT ("พร้อมให้ IT รับงาน") |
| `*_rejected` | ผู้ยื่น + ผู้รับสิทธิ์ที่มีบัญชี (พร้อมเหตุผล) |
| `info_requested` / `info_provided` | ผู้ยื่น / คนที่ถามข้อนั้น |
| `applied` | ผู้รับสิทธิ์ที่มีบัญชี ("กรุณากดรับทราบ") + ผู้ยื่น · `revoke_all` แจ้งผู้ยื่นว่าเรียบร้อย · ไม่มีบัญชี แจ้งผู้ยื่นว่ารอใบกระดาษ |
| `acknowledged` | ผู้ยื่น |
| `cancelled` | ผู้ยื่นยกเลิก → ผู้อนุมัติของขั้นที่ใบรออยู่ (+ผู้ดูแลงาน IT ถ้าอนุมัติครบแล้ว/รับงานแล้ว) · IT ยกเลิกแทน → ผู้ยื่น + ผู้รับสิทธิ์ |
พนักงานแผนก ID: ตัวกรองกลาง `private.department_notification_allowed` ยังไม่รู้จัก `/office/access/` (ไม่ได้แก้ในขั้นนี้ ต้อง replace ฟังก์ชันของเพื่อนแยกต่างหากถ้าต้องการ)

## โหมดทดสอบ (Admin Sandbox)
ทุกตารางมี `is_test` + trigger `private.sandbox_row_scope` · persona เห็น/แก้เฉพาะแถวทดสอบ แตะของจริงไม่ได้ (id ของจริงตอบ "ไม่พบใบขอสิทธิ์นี้") · เลขทดสอบ `TEST-IT08-01-YY/NNN` ตัวนับแยก · ใช้ persona เดิมของ itwo (`SBX-IT-ADMIN` อยู่ใน `itas_admins` โหมดทดสอบ จึง apply ได้) · ผู้ใช้ทะเบียนที่สร้างตอน apply ในโหมดทดสอบเป็นแถวทดสอบของทะเบียน
`app_sandbox_purge_itar()` (admin ตัวจริงที่อยู่ในโหมดทดสอบ) ลบเฉพาะแถว `is_test` ของ 8 ตารางนี้ (**ไม่แตะทะเบียนสิทธิ์** — ใช้ `app_sandbox_purge_itua()` แยก) → `{deleted, files[]}` (รายการไฟล์ในบัคเก็ตทดสอบให้หน้าเว็บลบผ่าน Storage API) · ไม่อยู่ในโหมดทดสอบ = `SANDBOX_NOT_ACTIVE` · บันทึก `audit_logs` action `ITAR_SANDBOX_PURGE` · ปุ่มล้างข้อมูลทดสอบของหน้าเว็บต้องเรียกตัวนี้ด้วย

## รหัส error ที่หน้าเว็บควรจัดการ
- `40001` ข้อมูลเก่า (สิทธิ์ปัจจุบันไม่ตรงกับที่หน้าจอเห็น) → โหลดข้อมูลล่าสุดแล้วให้ผู้ใช้ลองใหม่ (ทั้งตอนยื่นและตอน apply)
- `42501` ไม่มีสิทธิ์/ไม่พบใบ · `23514` ผิดเงื่อนไข (ข้อความไทยแสดงตรง ๆ) · `23505`/`40001` จากตัวทะเบียนผ่านข้อความไทยของ `app_itua_*`
- `SANDBOX_NOT_ACTIVE` / `NOT_AUTHORIZED` จาก purge

## ข้อควรระวังของหน้าเว็บ
- ผู้รับสิทธิ์ที่ไม่ผูกทะเบียน: หน้าเว็บไม่มีค่าเดิมให้แสดง → ส่งเฉพาะ `to` แล้วให้ IT เลือกผู้ใช้ตอน apply (`needs_user_choice`)
- ฟอร์มยื่นใช้ `app_itar_form_context` ก่อนเสมอ (ได้ค่าปัจจุบัน + แคตตาล็อก + นโยบาย) แล้วส่ง `from` กลับตามที่เห็น
- ใบ `revoke_all` ไม่มีรายการ แสดงสรุป "จะถอดสิทธิ์ทั้งหมด" จาก `form_context.rights` · detail หลัง apply ดู `applied_summary.before/after`
- ใบพิมพ์ USER-REQ/USER-Page ใช้ข้อมูลจาก `app_itar_get_detail` (ไม่มีรหัสผ่านในข้อมูลนี้เลย) — ห้ามไปอ่านทะเบียนเพิ่ม
- ผู้ที่ไม่เห็นใบได้ข้อความเดียวกับใบที่ไม่มีอยู่ (ไม่บอกสถานะ)
