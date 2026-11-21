# สัญญาฐานข้อมูลของโมดูล "ใบแจ้งซ่อมคอมพิวเตอร์" (`itrp_*`)

migration: `supabase/migrations/20261212010000_itrp_repair_requests.sql` · ทดสอบ: `supabase/tests/database/itrp_repair_requests.test.sql`, `itrp_files.test.sql`, `itrp_notify.test.sql`
คัดโครงจากใบสั่งงาน IT (`itwo_*`) รุ่นล่าสุด (v1–v4 + แจ้งเตือน) · สเปกต้นทาง: `Work-Order/docs/itrp-spec.md` · เอกสารนี้ไว้ให้คนทำหน้าเว็บ (Pilot) ใช้เป็นสัญญา

ทุก RPC เรียกผ่าน `sb.rpc('app_itrp_…', { p_… })` ด้วย session ของผู้ใช้ (SECURITY DEFINER, anon เรียกไม่ได้) · ข้อความ error เป็นภาษาไทยแสดงให้ผู้ใช้เห็นตรง ๆ (`error.message`)
ตารางทั้งหมดปิดการเข้าถึงตรง (RLS deny-all + ไม่มี grant) อ่าน/เขียนผ่าน RPC เท่านั้น

## ผู้ใช้และสิทธิ์ (ตัดสินที่ฐานข้อมูล)
- ผู้แจ้ง = พนักงาน active ทุกคน · ผู้อนุมัติขั้นแผนก = `department_manager` / `assistant_department_manager` ของแผนกผู้แจ้ง (ที่ผูกบัญชีล็อกอินแล้ว)
- **ทีม IT อ่านจาก `public.itwo_staff` อย่างเดียว** (ไม่มี `itrp_staff`, ไม่มี RPC แก้สิทธิ์ใน itrp): `is_it_admin` = ผู้ดูแลงาน IT (เริ่ม/ส่งงาน/ถามระหว่างทำ/ตั้งเลขเอกสาร/ดูรายชื่อทีม) · `is_it_approver` = ผู้อนุมัติขั้น IT (อนุมัติ + ดูทุกใบ แต่เริ่ม/ส่งงานไม่ได้)
- ผู้เห็นใบ: ผู้แจ้ง / ทุกคนใน `itwo_staff` / ผู้อนุมัติขั้นแผนกของแผนกนั้น

## สถานะ (`itrp_requests.status`)
`pending_dept` รอผู้จัดการแผนก → `pending_it_mgr` รอผู้อนุมัติ IT → `approved` อนุมัติครบ → `in_progress` กำลังดำเนินการ → `it_closed` IT ส่งงานแล้ว (รอผู้แจ้งยืนยัน) → `received` จบงานแล้ว
ปลายทางอื่น `rejected` ไม่อนุมัติ · `cancelled` ยกเลิก · พิเศษ `need_info` รอผู้แจ้งตอบ (`info_return_status` = สถานะที่จะกลับไป: pending_dept / pending_it_mgr / approved / in_progress)
`it_closed` → `in_progress` = ผู้แจ้งขอแก้ไข (ไม่ต้องอนุมัติใหม่) · งานด่วนเริ่มได้ก่อนอนุมัติครบ (สถานะเป็น `in_progress` ทั้งที่ยังขาดการอนุมัติ ส่งงานได้เมื่ออนุมัติครบแล้ว)

## เลขที่เอกสาร
`IT01-YY/NNN` (เช่น `IT01-26/050`) · ปีตามเวลาไทย · ใบทดสอบ `TEST-IT01-YY/NNN` ตัวนับแยก · ออกฝั่งฐานข้อมูลเท่านั้น (หน้าเว็บไม่ส่งเลข)

## ตาราง (9)
| ตาราง | หน้าที่ | เพิ่มได้อย่างเดียว |
|---|---|---|
| `itrp_requests` | ใบแจ้งซ่อม (id, is_test, doc_no, doc_year, doc_seq, requester_id, department_id, asset_code, device_name, request_kind, request_kind_note, repair_target, repair_target_note, symptom, is_urgent, status, info_return_status, created_at) | ลบไม่ได้ · เปลี่ยนได้แค่ status |
| `itrp_events` | ประวัติ ISO: created, dept_approved, dept_rejected, it_mgr_approved, it_mgr_rejected, cancelled, started, completed, received, rework_requested, info_requested, info_provided | ใช่ |
| `itrp_doc_counters` | ตัวนับเลขรายปี แยกจริง/ทดสอบ | — |
| `itrp_admin_log` | ประวัติการตั้งเลขถัดไป (`doc_seq_set`) | ใช่ |
| `itrp_reworks` | รอบขอแก้ไข (round_no, details, due_date, requested_by) | ใช่ |
| `itrp_comments` | ถาม-ตอบ (kind question/answer, stage dept/it_mgr/it, body ≤2000, reply_to) | ใช่ |
| `itrp_attachments` | ทะเบียนไฟล์แนบ (ผูกใบ + รอบแก้ไข หรือ ข้อความ อย่างใดอย่างหนึ่ง) | ใช่ |
| `itrp_repair_reports` | บันทึกการซ่อม ("สำหรับแผนก IT") 1 ชุดต่อการส่งงาน 1 ครั้ง ผูก event completed | ใช่ |
| `itrp_repair_parts` | รายการอะไหล่/วัสดุของบันทึกการซ่อม ≤10 แถว | ใช่ |

ค่าที่เลือก: `request_kind` = `repair` ซ่อม / `replace_part` เปลี่ยนอะไหล่ / `inspect` ตรวจเช็ค / `install` ติดตั้ง / `other` อื่นๆ (ต้องมี `request_kind_note`) ·
`repair_target` = `computer` / `device` / `other` (ต้องมี `repair_target_note`) · `cause_kind` = `usage` / `part_expired` / `other` (ต้องมี `cause_kind_note`) ·
`repair_method` = `internal` / `external_onsite` (ชื่อผู้ซ่อม `repair_vendor` ไม่บังคับ) / `sent_out` (ต้องมี `repair_vendor` = สถานที่ส่งซ่อม)

## RPC (`public.app_itrp_*`)
### อ่าน
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itrp_my_role()` | — | jsonb `{employee_id, employee_no, full_name, is_test, department{id,code,name_th}, is_it_department, is_dept_approver, is_it_admin, is_it_approver}` ให้เลือกแท็บ/ปุ่ม (แท็บรออนุมัติ = is_dept_approver หรือ is_it_approver · แท็บงาน IT = is_it_admin หรือ is_it_approver · ตั้งค่า = is_it_admin) |
| `app_itrp_list_mine()` | — | แถว: `id, doc_no, status, is_urgent, asset_code, device_name, request_kind, request_kind_note, repair_target, symptom, created_at, rework_round, rework_due_date, info_return_status, info_stage` (ใบของตัวเองในโหมดปัจจุบัน ใหม่สุดก่อน) |
| `app_itrp_list_pending_approvals()` | — | แถวเหมือนข้างบน + `requester_name, department_name, pending_step` (`dept` / `it_mgr`) · ไม่มี rework_* · งานด่วนก่อน · รวมใบ `need_info` ที่ผู้อนุมัติยังค้าง (ปุ่มจริงดู allowed_actions) |
| `app_itrp_pending_count()` | — | integer จำนวนใบที่รอผู้ทำรายการอนุมัติ (ป้ายตัวเลข) |
| `app_itrp_list_it()` | — | เฉพาะทีม IT (`itwo_staff` ทุกคน) · แถว: `id, doc_no, status, is_urgent, asset_code, device_name, request_kind, request_kind_note, repair_target, symptom, created_at, requester_full_name, department_name, has_dept_approved, has_it_mgr_approved, rework_round, rework_due_date, info_return_status, info_stage` · เรียงงานด่วน → วันกำหนดเสร็จของรอบแก้ไข → เวลาแจ้ง |
| `app_itrp_get_detail(p_request_id)` | uuid | jsonb ดูหัวข้อ "get_detail" ด้านล่าง |
| `app_itrp_get_doc_counter(p_year default null)` | — | jsonb `{year, last_seq, next_seq, next_doc_no, is_test}` (it_admin) |
| `app_itrp_list_staff()` | — | แถว `employee_id, employee_no, full_name, department_name, is_it_admin, is_it_approver, is_active` (it_admin · อ่านจาก `itwo_staff` อย่างเดียว แท็บตั้งค่าแสดงพร้อมข้อความว่าแก้ที่ใบสั่งงาน IT) |

"การ์ดสรุป N ยังไม่จบ" ให้คำนวณฝั่งหน้าเว็บจาก `list_mine` / `list_pending_approvals` / `list_it` เหมือนโมดูลใบสั่งงาน (ไม่มี RPC สรุปแยก) · `info_stage` = ขั้นของคำถามที่ค้าง (`dept` / `it_mgr` / `it`) เฉพาะใบ `need_info`

### เขียน
| RPC | พารามิเตอร์ | คืน / หมายเหตุ |
|---|---|---|
| `app_itrp_create` | `p_asset_code text` (ว่างได้ ≤50), `p_device_name text` (บังคับ ≤200), `p_request_kind text`, `p_request_kind_note text`, `p_repair_target text`, `p_repair_target_note text`, `p_symptom text` (บังคับ ≤2000), `p_is_urgent boolean default false` | แถวเดียว `{id, doc_no}` · เลือกเส้นทางอนุมัติ + ออกเลข + บันทึก event ในธุรกรรมเดียว · ข้อความ "อื่นๆ" ที่ไม่ได้เลือก "อื่นๆ" ถูกล้างทิ้ง |
| `app_itrp_approve(p_request_id)` | uuid | void · กดครั้งเดียวนับทั้งสองขั้นเมื่อแผนกไม่มีผจก./ผู้แจ้งอยู่แผนก IT/ผู้อนุมัติเป็นผจก.แผนกนั้นเอง |
| `app_itrp_reject(p_request_id, p_reason)` | uuid, text บังคับ ≤500 | void · ไม่อนุมัติ = จบทันที · ระหว่าง `need_info` ใช้ไม่ได้ |
| `app_itrp_cancel(p_request_id, p_reason)` | uuid, text บังคับ | void · ผู้แจ้งก่อน IT เคยส่งงาน · IT (it_admin) ยกเลิกแทนได้เฉพาะใบ `need_info` (ประวัติขึ้นต้น "IT ยกเลิกแทนผู้แจ้ง: ") |
| `app_itrp_start(p_request_id)` | uuid | void · เฉพาะ it_admin · ใบปกติต้องอนุมัติครบ งานด่วนเริ่มก่อนได้ |
| `app_itrp_complete(...)` | `p_request_id uuid`, `p_cause text` (บังคับ ≤2000), `p_cause_kind text`, `p_cause_kind_note text`, `p_repair_method text`, `p_repair_vendor text`, `p_repair_action text` (บังคับ ≤2000), `p_pr_po_no text` (≤100), `p_parts jsonb default '[]'` | **uuid ของบันทึกการซ่อมที่สร้าง** · เฉพาะ it_admin · ต้อง `in_progress` และอนุมัติครบ · `p_parts` = array ≤10 แถว `{"item_name": text ≤200, "quantity": ตัวเลข >0, "price": ตัวเลข ≥0 หรือ null, "note": text ≤200 หรือ null}` ทศนิยมไม่เกิน 2 ตำแหน่ง ≤8 หลักก่อนจุด รับเลขเป็น number หรือ string · แถวที่ว่างทุกช่องข้ามให้ · ตรวจผิดได้ข้อความ "แถวที่ N: …" ตามลำดับที่ส่ง · ช่างผู้ดำเนินการ = ผู้กด |
| `app_itrp_receive(p_request_id)` | uuid | void · เฉพาะผู้แจ้ง เมื่อ `it_closed` |
| `app_itrp_request_rework(p_request_id, p_details, p_due_date)` | uuid, text บังคับ ≤2000, date บังคับ (ไม่ย้อนหลังเวลาไทย) | `{id, round_no}` (id = rework_id ไว้แนบไฟล์) · เฉพาะผู้แจ้ง เมื่อ `it_closed` · กลับ `in_progress` ทันที ไม่จำกัดรอบ |
| `app_itrp_request_info(p_request_id, p_body)` | uuid, text บังคับ ≤2000 | `{comment_id}` (ไว้แนบไฟล์ของข้อความ) · ผู้อนุมัติของขั้นที่ใบรออยู่ / it_admin หลังอนุมัติ · ใบเป็น `need_info` |
| `app_itrp_provide_info(p_request_id, p_body)` | uuid, text บังคับ ≤2000 | `{comment_id}` · เฉพาะผู้แจ้ง · ใบกลับสถานะเดิม |
| `app_itrp_add_attachment(p_request_id, p_rework_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes)` | `p_rework_id` null = ไฟล์ตอนแจ้ง · ค่า mime/size ที่ส่งไม่ถูกเชื่อ (ใช้ค่าจาก Storage) | uuid ของทะเบียน · เฉพาะผู้แจ้ง · ตอนแจ้ง: ภายใน 30 นาทีหลังแจ้งและก่อนมีผู้อื่นอนุมัติจริง ≤10 ไฟล์ · รอบแก้ไข: รอบล่าสุดของตัวเอง ภายใน 30 นาที ≤10 ไฟล์ |
| `app_itrp_add_comment_attachment(p_request_id, p_comment_id, p_storage_path, p_file_name, p_mime_type, p_size_bytes)` | comment_id จาก request_info/provide_info | uuid · เฉพาะผู้เขียนข้อความ ภายใน 30 นาที ≤10 ไฟล์ต่อข้อความ |
| `app_itrp_set_next_doc_seq(p_next integer, p_year integer default null)` | 1–9999 · ปีนี้หรือปีหน้า (เวลาไทย) | jsonb `{year, next_seq, next_doc_no, is_test}` · เฉพาะ it_admin · เดินหน้าอย่างเดียว ตามโหมดของผู้เรียก (ตั้งเลขจริงต้องออกจากโหมดทดสอบก่อน) |
| `app_sandbox_purge_itrp()` | — | jsonb `{deleted, files[]}` · เฉพาะ admin ที่อยู่ในโหมดทดสอบ · ลบเฉพาะแถว `is_test` ของ itrp · `files` = path ในบัคเก็ต `itrp-test-files` ที่ต้องลบผ่าน Storage API ต่อ (ลบไม่ครบ เรียกซ้ำได้รายการที่เหลือ) |

ไม่มีใน itrp (เทียบ itwo): `app_itrp_save_access_changes`, `app_itrp_set_staff`, ส่วนสิทธิ์ในระบบ, วันที่ต้องการงาน, ออเดอร์, ตัวเลือกเอกสารแนบ มี/ไม่มี (แนบไฟล์ได้เสมอ), `misc_detail`

## `app_itrp_get_detail` (jsonb)
`id, is_test, doc_no, doc_year, doc_seq, requester_id, department_id, asset_code, device_name, request_kind, request_kind_note, repair_target, repair_target_note, symptom, is_urgent, status, info_return_status, created_at` +
- `rework_round` (0 = ไม่มี), `latest_due_date` (วันกำหนดเสร็จของรอบแก้ไขล่าสุด · null เมื่อไม่มีรอบ — ใบแจ้งซ่อมไม่มีวันที่ต้องการงานตอนแจ้ง)
- `requester {employee_no, full_name}`, `department {code, name_th}`
- `events[]` `{id, action, reason, created_at, actor_employee_no, actor_full_name}` เรียงตามลำดับจริง (ไทม์ไลน์)
- `reworks[]` `{id, round_no, details, due_date, created_at, requested_by_employee_no, requested_by_full_name}`
- `attachments[]` ไฟล์ตอนแจ้ง/รอบแก้ไข `{id, rework_id, round_no (0 = ตอนแจ้ง), storage_path, bucket, file_name, mime_type, size_bytes, created_at, uploaded_by_full_name}` · `bucket` = `itrp-files` หรือ `itrp-test-files` ให้เรียก `createSignedUrl` ตามนี้
- `comments[]` `{id, kind, stage, body, reply_to, created_at, author_employee_no, author_full_name, attachments[{id, storage_path, bucket, file_name, mime_type, size_bytes, created_at}]}`
- `info_pending` = คำถามที่ค้าง `{comment_id, stage, body, asked_at, asked_by_employee_no, asked_by_full_name}` (เฉพาะ `need_info` ไม่งั้น null)
- `approvals {dept, it_mgr}` แต่ละอัน `{by, at, reason}` หรือ null (event แรกของแต่ละขั้น) · **`approvals.dept` = ลายเซ็น "ลงชื่อผู้อนุมัติ" ของใบพิมพ์ · `approvals.it_mgr` = "รับทราบ ฝ่ายบริหาร"**
- ข้อมูลช่องท้ายใบพิมพ์: `started {by, at}` (event started → "เริ่มดำเนินการซ่อม"), `completed {by, at}` (event completed ล่าสุด → "ซ่อมเสร็จ", ผู้กด = "ช่างผู้ดำเนินการซ่อม" และ "ส่งมอบงาน แผนก IT"), `received {by, at}` (ผู้แจ้งที่กดรับ → "รับมอบงาน"), รวมเวลาให้คำนวณจาก `started.at` ถึง `completed.at` ตอนแสดง · ยังไม่เกิด = null
- `rework_open` boolean = มีการขอแก้ไขค้างอยู่ (ขอแก้ไขหลังส่งงานล่าสุดและ IT ยังไม่ส่งงานใหม่) → ติ๊ก "ส่งแก้ไข" · ติ๊ก "ใช้งานได้สมบูรณ์" เมื่อ `status = 'received'`
- `repair_report` = บันทึกการซ่อมชุดล่าสุด (ใช้แสดง/พิมพ์) หรือ null ถ้ายังไม่เคยส่งงาน · `repair_reports[]` ทุกชุดเรียงตามการส่งงาน (ชุดล่าสุดอยู่ท้ายสุด) ใช้เป็นประวัติ · แต่ละชุด `{id, completed_event_id, completed_at, completed_by_employee_no, completed_by_full_name, cause, cause_kind, cause_kind_note, repair_method, repair_vendor, repair_action, pr_po_no, parts[{line_no, item_name, quantity, price, note}]}` (quantity/price เป็นตัวเลขทศนิยม 2 ตำแหน่ง price เป็น null ได้)
- `allowed_actions[]` ปุ่มที่ผู้ดูทำได้ตอนนี้: `cancel`, `approve`, `reject`, `start`, `complete`, `receive`, `request_rework`, `request_info`, `provide_info` (ใช้ตัวนี้ตัดสินปุ่ม ไม่ต้องคำนวณเอง · ไม่มี `edit_access`)

## ไฟล์แนบ (Storage)
- บัคเก็ต private `itrp-files` (จริง) / `itrp-test-files` (ทดสอบ) · ไฟล์ละ ≤20 MB · ชนิด jpg/png/webp/heic/heif/pdf/docx/xlsx/pptx/doc/xls/txt/csv (ไม่รับ .ppt)
- path บังคับ `<request id>/<uuid ตัวพิมพ์เล็ก>.<นามสกุลพิมพ์เล็ก>` (ชื่อไฟล์เดิมเก็บในทะเบียน) · อัปโหลดด้วย `owner_id = auth.uid()` (supabase-js ทำให้) · ห่อ `new File([f], name, {type})` ให้ mimetype ตรงนามสกุล (ดู memory เรื่อง CSV บน Windows)
- ลำดับ: อัปโหลดเข้า Storage → เรียก `add_attachment` / `add_comment_attachment` ลงทะเบียน (ลองใหม่ได้ path เดิมคืนทะเบียนเดิม) · อ่านผ่าน signed URL ตามสิทธิ์เห็นใบ · ไฟล์ของบัคเก็ตจริงลบ/แก้ไม่ได้
- ใบทดสอบ (โหมดทดสอบ) ใช้บัคเก็ต `itrp-test-files` เท่านั้น

## แจ้งเตือน
trigger บน `itrp_events` เรียก `private.office_notify` (ชุดเหตุการณ์/ผู้รับเดียวกับใบสั่งงาน IT) · `action_url` = `/office/repair/<uuid ของใบ>` · หัวข้อ `ใบแจ้งซ่อม <doc_no> …` · ใบด่วนขึ้นหัว `🚨 [ด่วน] ` และแจ้ง it_admin ทันทีตอนแจ้ง · ใบทดสอบไม่ส่ง · started/received ไม่แจ้ง · ล้มเหลวแล้วการอนุมัติ/ส่งงานไม่ล้มตาม
ฝั่งหน้าเว็บ/Edge Function ต้องเพิ่มเส้นทาง `/office/repair/` (app.js notificationHref, notify-email, notify-push) — ไม่ได้ทำในงานฐานข้อมูล

## ที่ไม่ได้ทำในงานฐานข้อมูล
หน้าเว็บ/เมนู/ใบพิมพ์/ลิงก์แจ้งเตือน (`app.js`, `modules/`, `sw.js`, `index.html`, Edge Functions) · การตั้ง `request_types.IT_REPAIR is_active=false` (ของเพื่อน)
