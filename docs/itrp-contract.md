# สัญญาฐานข้อมูลของโมดูล "ใบแจ้งซ่อมคอมพิวเตอร์" (`itrp_*`)

migration: `supabase/migrations/20261212010000_itrp_repair_requests.sql` + `20261218010000_itrp_repair_history.sql` (ประวัติการซ่อมเครื่อง FM02 ดูหัวข้อท้ายเอกสาร) · ทดสอบ: `supabase/tests/database/itrp_repair_requests.test.sql`, `itrp_files.test.sql`, `itrp_notify.test.sql`, `itrp_repair_history.test.sql`
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

## ตาราง (9 ของใบแจ้งซ่อม + อีก 5 ของประวัติการซ่อมเครื่อง + 1 ของการเปลี่ยนชิ้นส่วน ดูหัวข้อท้ายเอกสาร)
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
| `app_itrp_complete(...)` | `p_request_id uuid`, `p_cause text` (บังคับ ≤2000), `p_cause_kind text`, `p_cause_kind_note text`, `p_repair_method text`, `p_repair_vendor text`, `p_repair_action text` (บังคับ ≤2000), `p_pr_po_no text` (≤100), `p_parts jsonb default '[]'`, `p_devices jsonb default '[]'` (เครื่องที่ซ่อม ดูหัวข้อประวัติการซ่อมเครื่อง · ไม่ส่ง = ไม่มีเครื่อง) | **uuid ของบันทึกการซ่อมที่สร้าง** · เฉพาะ it_admin · ต้อง `in_progress` และอนุมัติครบ · `p_parts` = array ≤10 แถว `{"item_name": text ≤200, "quantity": ตัวเลข >0, "price": ตัวเลข ≥0 หรือ null, "note": text ≤200 หรือ null}` ทศนิยมไม่เกิน 2 ตำแหน่ง ≤8 หลักก่อนจุด รับเลขเป็น number หรือ string · แถวที่ว่างทุกช่องข้ามให้ · ตรวจผิดได้ข้อความ "แถวที่ N: …" ตามลำดับที่ส่ง · ช่างผู้ดำเนินการ = ผู้กด |
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
- `repair_report` = บันทึกการซ่อมชุดล่าสุด (ใช้แสดง/พิมพ์) หรือ null ถ้ายังไม่เคยส่งงาน (แต่ละชุดมี `devices[]` = เครื่องที่ซ่อม `[{seq, device_code, symptom_note, action_note, remark}]`) · `repair_reports[]` ทุกชุดเรียงตามการส่งงาน (ชุดล่าสุดอยู่ท้ายสุด) ใช้เป็นประวัติ · แต่ละชุด `{id, completed_event_id, completed_at, completed_by_employee_no, completed_by_full_name, cause, cause_kind, cause_kind_note, repair_method, repair_vendor, repair_action, pr_po_no, parts[{line_no, item_name, quantity, price, note}]}` (quantity/price เป็นตัวเลขทศนิยม 2 ตำแหน่ง price เป็น null ได้)
- `allowed_actions[]` ปุ่มที่ผู้ดูทำได้ตอนนี้: `cancel`, `approve`, `reject`, `start`, `complete`, `receive`, `request_rework`, `request_info`, `provide_info` (ใช้ตัวนี้ตัดสินปุ่ม ไม่ต้องคำนวณเอง · ไม่มี `edit_access`)

## ไฟล์แนบ (Storage)
- บัคเก็ต private `itrp-files` (จริง) / `itrp-test-files` (ทดสอบ) · ไฟล์ละ ≤20 MB · ชนิด jpg/png/webp/heic/heif/pdf/docx/xlsx/pptx/doc/xls/txt/csv (ไม่รับ .ppt)
- path บังคับ `<request id>/<uuid ตัวพิมพ์เล็ก>.<นามสกุลพิมพ์เล็ก>` (ชื่อไฟล์เดิมเก็บในทะเบียน) · อัปโหลดด้วย `owner_id = auth.uid()` (supabase-js ทำให้) · ห่อ `new File([f], name, {type})` ให้ mimetype ตรงนามสกุล (ดู memory เรื่อง CSV บน Windows)
- ลำดับ: อัปโหลดเข้า Storage → เรียก `add_attachment` / `add_comment_attachment` ลงทะเบียน (ลองใหม่ได้ path เดิมคืนทะเบียนเดิม) · อ่านผ่าน signed URL ตามสิทธิ์เห็นใบ · ไฟล์ของบัคเก็ตจริงลบ/แก้ไม่ได้
- ใบทดสอบ (โหมดทดสอบ) ใช้บัคเก็ต `itrp-test-files` เท่านั้น

## แจ้งเตือน
trigger บน `itrp_events` เรียก `private.office_notify` (ชุดเหตุการณ์/ผู้รับเดียวกับใบสั่งงาน IT) · `action_url` = `/office/repair/<uuid ของใบ>` · หัวข้อ `ใบแจ้งซ่อม <doc_no> …` · ใบด่วนขึ้นหัว `🚨 [ด่วน] ` และแจ้ง it_admin ทันทีตอนแจ้ง · ใบทดสอบไม่ส่ง · started/received ไม่แจ้ง · ล้มเหลวแล้วการอนุมัติ/ส่งงานไม่ล้มตาม
ฝั่งหน้าเว็บ/Edge Function ต้องเพิ่มเส้นทาง `/office/repair/` (app.js notificationHref, notify-email, notify-push) — ไม่ได้ทำในงานฐานข้อมูล

## ประวัติการซ่อมเครื่อง (IT01-FM02) — migration `20261218010000_itrp_repair_history.sql` · ทดสอบ `itrp_repair_history.test.sql`
สเปกต้นทาง: `Work-Order/docs/itrp-history-spec.md` · ฐานข้อมูลอย่างเดียว (หน้าเว็บทำแยก) · **ไม่นำเข้าข้อมูลเก่า** (478 แถว + ทะเบียนเครื่องเป็นสคริปต์แยก) · ไม่เก็บรหัสผ่าน/License key ใด ๆ

### สิทธิ์
- **อ่าน** (`app_itrp_device_history`, `app_itrp_list_devices`, `app_itrp_history_get`) = ผู้ดูแลงาน IT (`is_it_admin`) หรือผู้อนุมัติขั้น IT (`is_it_approver`) จาก `itwo_staff` · **เขียน** (`app_itrp_save_device`, `app_itrp_history_add/_update/_void`) = ผู้ดูแลงาน IT เท่านั้น · anon เรียกไม่ได้ · พนักงานแผนก IT ที่ไม่อยู่ใน `itwo_staff`, ผู้แจ้ง, ผู้จัดการแผนก = อ่าน/เขียนไม่ได้ (แท็บ "ประวัติการซ่อม" ใช้ `app_itrp_my_role().is_it_admin || is_it_approver` ตัดสินการแสดง)
- **โหมดทดสอบ**: ทะเบียนเครื่องและประวัติแยกแถวด้วย `is_test` เหมือนทุกตารางของ itrp (persona ไม่เห็น/แก้ของจริงได้เลย · โหมดทดสอบเริ่มจากทะเบียนว่าง ต้องเพิ่มเครื่องทดสอบเอง) · ล้างทิ้งด้วย `app_sandbox_purge_itrp` (ครอบ 5 ตารางใหม่แล้ว)
- รหัสเครื่องทุกที่ = **trim + ตัวพิมพ์ใหญ่ 1–50 ตัว** (ฐานข้อมูลทำให้เอง ส่งตัวเล็กได้) ห้ามมีอักขระควบคุม (tab/ขึ้นบรรทัดใหม่)

### ตารางใหม่ (5) — RLS deny-all ไม่มี grant ตรง (รวม service_role)
| ตาราง | หน้าที่ | เพิ่มได้อย่างเดียว |
|---|---|---|
| `itrp_devices` | ทะเบียนเครื่องอย่างย่อ: code (ไม่ซ้ำต่อโหมด แก้ไม่ได้), kind (`computer`/`laptop`/`monitor`/`printer`/`ups`/`other`), user_name, division, cpu_name, cpu_model, started_on, asset_no, status (`active`/`retired`), note, created_by/at, updated_by/at | ลบไม่ได้ (ปิดการใช้งานแทน) · แก้ได้ผ่าน RPC |
| `itrp_device_log` | ประวัติเพิ่ม/แก้ทะเบียน (action `created`/`updated`, old_values, new_values, actor) **เขียนโดย trigger** บน `itrp_devices` | ใช่ |
| `itrp_report_devices` | เครื่องที่ซ่อมต่อบันทึกการซ่อม 1 รอบ (0–10 แถว): seq, device_code, symptom_note, action_note, remark (ข้อเสนอแนะ ≤500) | ใช่ |
| `itrp_history_entries` | ประวัติที่ไม่ได้มาจากใบในระบบ: source (`import`/`manual`), doc_no, device_code, reported_on, symptom, action, finished_on, remark, reporter_name, created_by/at, updated_by/at, voided_by/at, void_reason | ลบไม่ได้ · แก้ได้ (trigger เก็บฉบับเดิมให้) · ยกเลิกรายการได้ |
| `itrp_history_entry_revisions` | ฉบับก่อนแก้/ก่อนยกเลิก (snapshot ทั้งแถว, changed_by, reason, revision_no 1,2,…) **เขียนโดย trigger** | ใช่ |

### แก้ `app_itrp_complete` — เพิ่ม `p_devices jsonb default '[]'` (ท้ายสุด)
`app_itrp_complete(p_request_id, p_cause, p_cause_kind, p_cause_kind_note, p_repair_method, p_repair_vendor, p_repair_action, p_pr_po_no, p_parts default '[]', p_devices default '[]')` · คืน uuid ของบันทึกการซ่อมเหมือนเดิม · **เรียกแบบเดิม (ไม่ส่ง p_devices) ได้ทุกแบบ** (ตามตำแหน่ง 9 ตัวหรือตามชื่อ) = ไม่มีเครื่อง · เหลือฟังก์ชันเดียว ไม่มี overload
`p_devices` = array ≤10 แถว `{"device_code": text (บังคับ 1–50 ห้ามซ้ำในรอบเดียวกัน), "symptom_note": text ≤2000 หรือ null, "action_note": text ≤2000 หรือ null, "remark": ข้อเสนอแนะ ≤500 หรือ null}` · แถวที่ว่างทุกช่องข้ามให้ · ตรวจผิดได้ข้อความ `แถวที่ N: …` (กรุณาระบุรหัสเครื่อง / รหัสเครื่องต้องไม่เกิน 50 ตัวอักษร / รหัสเครื่องมีอักขระที่ใช้ไม่ได้ / รหัสเครื่อง X ซ้ำกับแถวก่อนหน้า / อาการของเครื่อง… / การแก้ไขของเครื่อง… / ข้อเสนอแนะต้องไม่เกิน 500 ตัวอักษร) หรือ "เครื่อง/อุปกรณ์ที่ซ่อมต้องไม่เกิน 10 รายการ" · ผิดแล้วทั้งการส่งงานไม่เกิดขึ้น (ใบยัง `in_progress`)
- หน้าเว็บเดิมบน main ที่ไม่ส่ง p_devices ทำงานได้ตามเดิม · ใบที่ส่งงานด้วยวิธีนี้ **ไม่มีแถวเครื่อง** → ตอนอ่านประวัติ ระบบใช้รหัสเครื่องที่ผู้แจ้งกรอก (`asset_code`) แทน (ไม่เขียนเพิ่ม) ถ้าไม่มี asset_code ใบนั้นไม่ขึ้นประวัติเครื่องใดเลย → หน้าเว็บส่งงานรุ่นใหม่ควรบังคับ ≥1 แถว (เติม asset_code ให้ก่อน)
- `app_itrp_get_detail`: ไม่เปลี่ยนคีย์เดิม · เพิ่ม `repair_report.devices[]` (บันทึกรอบล่าสุด) และ `repair_reports[].devices[]` (ทุกรอบ) = `[{seq, device_code, symptom_note, action_note, remark}]` เรียงตาม seq · ไม่มี = `[]`

### RPC ใหม่ (7)
| RPC | พารามิเตอร์ | คืน / หมายเหตุ |
|---|---|---|
| `app_itrp_device_history(p_code)` | text บังคับ | jsonb `{code, is_test, device, rows[]}` · `device` = หัวจากทะเบียน `{id, code, kind, user_name, division, cpu_name, cpu_model, started_on, asset_no, status, note}` หรือ `null` ถ้ารหัสไม่อยู่ในทะเบียน (ของโหมดนี้) · `rows[]` เรียงตามวันที่แจ้ง **เก่าสุดก่อน** (วันที่ว่างไว้ท้าย แล้วตามเลขที่ใบ) แต่ละแถว `{source, entry_id, request_id, request_status, doc_no, reported_on, symptom, action, finished_on, remark, reporter_name, revision_count, updated_at}` · 7 คอลัมน์ของ FM02 = `doc_no, reported_on, symptom, action, finished_on, remark, reporter_name` · `source` = `request` (ใบในระบบ: มี request_id, entry_id ว่าง) / `import` / `manual` (มี entry_id, request_id ว่าง) · วันที่เป็น `YYYY-MM-DD` (วันที่ตามเวลาไทย) |
| `app_itrp_list_devices(p_search default null, p_include_retired default true)` | text, boolean | แถว `code, in_registry, device_id, kind, user_name, division, cpu_name, cpu_model, started_on, asset_no, status, note, history_count, last_repair_on, updated_at` · รวมรหัสที่มีในประวัติแต่ไม่อยู่ในทะเบียน (`in_registry = false` ช่องของทะเบียนเป็น null) · ค้นไม่สนตัวพิมพ์ใหญ่เล็กใน รหัส/ผู้ใช้/แผนก/เลขทะเบียนทรัพย์สิน/Processor (ไม่ใช่ wildcard) · เรียงตามรหัส ≤2,000 แถว |
| `app_itrp_save_device(p_code, p_kind default 'other', p_user_name, p_division, p_cpu_name, p_cpu_model, p_started_on, p_asset_no, p_status default 'active', p_note)` | ตามชื่อ | jsonb `{id, code, created, changed}` · เพิ่มถ้ารหัสยังไม่มีในโหมดนี้ ไม่งั้นแก้ (**ส่งค่าทั้งหมดของเครื่อง** ช่องที่ส่ง null = ล้างค่า · รหัสแก้ไม่ได้) · ไม่มีค่าใดเปลี่ยน = `changed: false` ไม่ลง log · ข้อจำกัด: user/division/cpu ≤200, asset_no ≤100, note ≤1000, started_on 1990–2100 |
| `app_itrp_history_add(p_device_code, p_doc_no, p_reported_on, p_symptom, p_action, p_finished_on, p_remark, p_reporter_name)` | ทุกตัวส่งครบ (null ได้ยกเว้น code/reported_on) | bigint = id ของรายการ (source = `manual`) · บังคับ: รหัสเครื่อง, วันที่แจ้ง, อาการหรือการแก้ไขอย่างน้อยหนึ่ง · วันที่ไม่ใช่อนาคต (เวลาไทย) ไม่ก่อน 1990 · วันที่ซ่อมเสร็จไม่ก่อนวันที่แจ้ง · doc_no ≤50 ("-" = ไม่ระบุ) · symptom/action ≤2000 · remark ≤500 · reporter_name ≤200 · เครื่องเดียวกัน+เลขที่ใบเดียวกัน ลงซ้ำไม่ได้ (เฉพาะรายการที่ไม่ถูกยกเลิก) |
| `app_itrp_history_update(p_entry_id, <ช่องเดียวกับ add ทั้ง 8 ช่อง>)` | bigint + ค่าทั้งหมด (null = ล้าง) | jsonb `{id, revision_count}` · กติกาข้อมูลเหมือน add · ไม่มีอะไรเปลี่ยน = ผิดพลาด "ไม่มีการเปลี่ยนแปลงจากรายการเดิม" · trigger เก็บฉบับก่อนแก้ลง revisions ทุกครั้ง · แก้รายการที่ยกเลิกแล้วไม่ได้ · แก้ได้ทั้ง `manual` และ `import` |
| `app_itrp_history_void(p_entry_id, p_reason)` | bigint, text บังคับ ≤500 | jsonb `{id}` · ยกเลิกรายการ (ไม่ลบแถว) ไม่ขึ้นในประวัติของเครื่องอีก · ฉบับก่อนยกเลิกเก็บเป็น revision `change_kind = 'void'` · ยกเลิกซ้ำ/แก้หลังยกเลิกไม่ได้ |
| `app_itrp_history_get(p_entry_id)` | bigint | jsonb `{entry{id, source, doc_no, device_code, reported_on, symptom, action, finished_on, remark, reporter_name, created_at, created_by_employee_no, created_by_full_name, updated_at, updated_by_full_name, voided_at, void_reason, voided_by_full_name}, revisions[{revision_no, change_kind ('update'/'void'), snapshot{…แถวเดิมก่อนการแก้ครั้งนั้น…}, changed_by_employee_no, changed_by_full_name, reason, created_at}]}` เรียง revision_no เก่าสุดก่อน · เปิดรายการที่ยกเลิกแล้วได้ (ให้ดูรอยแก้) |
ข้อความ error เป็นภาษาไทยแสดงตรง ๆ เหมือน RPC เดิม · `rows[]` ของ `app_itrp_device_history` รวมรายการที่ยังไม่ถูกยกเลิกเท่านั้น

### ประวัติของเครื่อง = 3 แหล่ง
(ก) **ใบในระบบ**: ใบที่ IT เคยส่งงานอย่างน้อย 1 ครั้งและสถานะไม่ใช่ `cancelled`/`rejected` (ขึ้นทันทีที่ส่งงาน ไม่รอผู้แจ้งยืนยัน) · ใช้บันทึกการซ่อม **รอบล่าสุด** (ขอแก้ไขแล้วส่งใหม่ = ใช้รอบใหม่ ไม่ซ้ำเป็นสองแถว เครื่องที่ไม่อยู่ในรอบล่าสุดไม่ขึ้นใบนี้อีก) · เครื่อง = แถวใน `itrp_report_devices` ของรอบล่าสุด (ไม่มีแถวเลย → ใช้ `asset_code` ของใบ) · อาการ = `symptom_note` ของเครื่อง ว่าง = อาการของใบ · การแก้ไข = `action_note` ว่าง = `repair_action` ของบันทึก · วันที่แจ้ง = วันที่สร้างใบ · ซ่อมเสร็จ = วันที่ส่งงานรอบล่าสุด · ข้อเสนอแนะ = `remark` · ผู้แจ้ง = ชื่อผู้แจ้งใบ · เลขที่ใบ = `doc_no`
(ข) `itrp_history_entries` source `import` (นำเข้าจาก Excel ด้วยสคริปต์แยก: เขียนตรงด้วยสิทธิ์ผู้ดูแลฐานข้อมูล ต้องใส่ `created_by` = พนักงานที่สั่งรัน และ `source = 'import'` · วันที่ "-" ใส่ null ได้)
(ค) `itrp_history_entries` source `manual` (IT ลงย้อนหลังด้วย `app_itrp_history_add`)
แยกโหมดจริง/ทดสอบตาม `is_test` (โหมดทดสอบเห็นเฉพาะข้อมูลทดสอบ)

## เปลี่ยน/ถอด/ย้ายชิ้นส่วนจากใบแจ้งซ่อม → อัปเดตทะเบียนอุปกรณ์ (itas) — migration `20261225010000_itrp_itas_part_changes.sql` · ทดสอบ `itrp_itas_part_changes.test.sql`
ฐานข้อมูลอย่างเดียว (หน้าเว็บทำรอบถัดไป) · หลักคิด: IT **เลือกจากรายการ** ไม่พิมพ์ข้อความอิสระ → หน้าเว็บเรียก `context` เพื่อได้ตัวเลือก แล้วส่งสิ่งที่เลือกกลับใน `apply` ครั้งเดียว (atomic ทั้งก้อน) · **ไม่แก้ `app_itrp_complete` และไม่แก้ `app_itrp_get_detail`** (ใช้ RPC แยก)

### สิทธิ์
ต้องเป็น **ทั้งสองอย่าง**: ผู้ดูแลงาน IT ของ itrp (`itwo_staff.is_it_admin`) **และ** อยู่ใน `itas_admins` (ทะเบียนอุปกรณ์) → ตอนนี้ = `IT3462` (โหมดทดสอบ = persona `SBX-IT-ADMIN`) · `context` และ `apply` เรียกได้เฉพาะคนนี้ · `get_part_changes` ใครเห็นใบนั้นได้ก็อ่านได้ (ผู้แจ้ง/ผู้อนุมัติขั้นแผนก/ทีม IT) · anon เรียกไม่ได้ · ข้อความผิดสิทธิ์ (`42501`): "เฉพาะผู้ดูแลงาน IT เท่านั้นที่บันทึกการเปลี่ยนชิ้นส่วนได้" (ไม่ใช่ผู้ดูแลงานของ itrp) หรือ "เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้" (ไม่อยู่ใน itas_admins)

### RPC (3)
| RPC | พารามิเตอร์ | คืน |
|---|---|---|
| `app_itrp_part_changes_context(p_request_id)` | uuid | jsonb ดูด้านล่าง · อ่านอย่างเดียว |
| `app_itrp_apply_part_changes(p_request_id, p_changes)` | uuid, jsonb array 1–20 แถว | `{request_id, doc_no, batch_id, applied, changes[]}` · `changes[]` รูปเดียวกับ `items[]` ของ `get_part_changes` |
| `app_itrp_get_part_changes(p_request_id)` | uuid | `{request_id, doc_no, items[]}` เรียงตามลำดับที่บันทึก (ใหม่ท้ายสุด) |

**`context`** = `{request: {id, doc_no, status, is_test, asset_code, device_name}, can_apply, blocked_reason, max_changes: 20, result_statuses: ["broken","spare","retired"], hosts[], spares[], move_targets[]}`
- `hosts[]` = เครื่องของใบ: `{host_code, source: "request"|"report", device: อุปกรณ์ตัวเครื่อง|null, parts: [อุปกรณ์ที่ host_code = รหัสนี้]}` · `request` = รหัสที่ผู้แจ้งกรอก (`asset_code`) · `report` = เครื่องที่ IT ระบุตอนส่งงาน (`itrp_report_devices` ทุกรอบ) · `parts` ไม่รวมตัวเครื่องเอง และไม่รวมที่ยกเลิกใช้งานแล้ว (ชำรุดยังรวม)
- `spares[]` = `[{type_code, type_name, items[]}]` ชิ้นที่สถานะสำรองและยังไม่ผูกเครื่อง เรียงตามลำดับชนิดในทะเบียน
- `move_targets[]` = `[{device_code, name, type_code}]` เครื่อง/อุปกรณ์ที่มีรหัสอุปกรณ์และยังไม่ยกเลิกใช้งาน (ใช้เลือกปลายทางของ `move`)
- อุปกรณ์แต่ละชิ้น = `{id, type_code, type_name, reg_no, device_code, name, model, serial, status, host_code, slot, place, updated_at}` (ไม่มี attrs/ช่องลับ) · `id` ใช้ส่งกลับใน `apply`
- `can_apply = false` + `blocked_reason` (ไทย) เมื่อใบไม่อยู่สถานะ `in_progress`/`it_closed` หรือใบไม่มีรหัสเครื่องเลย (ให้ระบุเครื่องตอนส่งงานก่อน) · เมื่อ `can_apply=false` หน้าเว็บควรซ่อนฟอร์ม แสดงเหตุผล

**`apply` — แต่ละแถวของ `p_changes`** (ช่องที่รับ: `action, host_code, asset_id, new_asset_id, to_host_code, result_status, slot, note` · ช่องอื่น = error · ส่งเฉพาะช่องที่เกี่ยว ช่องที่ไม่เกี่ยวส่งมา = error):
| action | ต้องส่ง | ผลในทะเบียน |
|---|---|---|
| `replace` | `host_code`, `asset_id` (ชิ้นเดิม), `new_asset_id` (ชิ้นใหม่), `result_status` (`broken`/`spare`/`retired` ของชิ้นเดิม) · ไม่บังคับ `slot`, `note` | ชิ้นเดิม: ถอดออก (host/slot = null) + status = `result_status` · ชิ้นใหม่: status `in_use`, host = เครื่อง, slot = ที่ส่ง **หรือช่องเดิมของชิ้นเดิม** |
| `remove` | `host_code`, `asset_id`, `result_status` · `note` | ถอดออก (host/slot = null) + status = `result_status` |
| `move` | `host_code` (ต้นทาง), `asset_id`, `to_host_code` · `slot`, `note` | host = ปลายทาง, slot = ที่ส่ง (ไม่ส่ง = ล้าง) สถานะคงเดิม |
| `install` | `host_code`, `asset_id` (ชิ้นสำรอง) · `slot`, `note` | status `in_use`, host = เครื่อง, slot = ที่ส่ง |
- รหัสเครื่อง (`host_code`/`to_host_code`) trim + ตัวพิมพ์ใหญ่ให้เอง · ไม่แก้ `install_date`/`place`/ข้อมูลอื่นของชิ้นส่วน (แก้เฉพาะ `status`, `host_code`, `slot`) ถ้าต้องการวันที่ติดตั้งให้แก้ผ่าน `app_itas_save_asset`
- **ตรวจที่ฐานข้อมูล (error `23514` ภาษาไทย ขึ้นต้น "แถวที่ N: …")**: เครื่องต้องเป็นเครื่องของใบ · ชิ้นเดิม/ชิ้นที่ย้าย ต้อง **ติดตั้งที่เครื่องนั้นจริงตอนนี้** และสถานะ `in_use`/`broken` (กดซ้ำ/ข้อมูลเก่า = ถูกปฏิเสธ → ให้หน้าเว็บโหลด `context` ใหม่) · ชิ้นใหม่/ชิ้นที่ติดตั้ง ต้องสถานะ `spare` และ host ว่าง · `replace` ต้อง **ชนิดเดียวกัน** (`type_code`) · ปลายทาง `move` ต้องมีอยู่ในทะเบียน (`device_code` ตรง) ไม่ยกเลิกใช้งาน และไม่ใช่เครื่องเดียวกับต้นทาง · ห้ามใช้ชิ้นเดียวกันซ้ำในก้อนเดียว (รวม `asset_id` กับ `new_asset_id`) · ทุกชิ้นต้องอยู่โหมดเดียวกับใบ (`is_test`) · ใบต้องอยู่สถานะ `in_progress` หรือ `it_closed`
- แถวใดผิด = **ทั้งก้อนไม่เกิดขึ้นเลย** · ล็อกชิ้นส่วนเรียงตาม id (กันสองคนแก้พร้อมกัน/deadlock)
- ผู้บันทึก = ผู้เรียก · เวลา = เวลาฐานข้อมูล

### ผลในประวัติ
- **ตารางใหม่ `itrp_part_changes`** (เพิ่มได้อย่างเดียว RLS deny-all ไม่มี grant ตรง อยู่ใน `sandbox_unguarded_tables`): 1 แถวต่อรายการ · `batch_id` (ชุดที่กดพร้อมกัน), `line_no`, `action`, `host_code`, `to_host_code`, ภาพถ่ายของชิ้นส่วน ณ ตอนทำรายการ (`type_code`, `asset_reg_no`, `asset_device_code`, `asset_name`, `new_asset_*`), `result_status`, `slot`, `note`, `actor_id`, `created_at` · **ไม่มี FK ไป `itas_assets`** (ล้างข้อมูลทดสอบของ itrp กับ itas เป็นคนละฟังก์ชัน)
- **ประวัติของ itas อ้างเลขที่ใบ**: `itas_asset_moves` และ `itas_asset_log` เพิ่มคอลัมน์ `source_request_id`, `source_doc_no` (null = แก้ตามปกติผ่านทะเบียน) · `app_itas_asset_history` คืนสองคีย์นี้ในทุกแถวของ `log[]` และ `moves[]` → หน้าประวัติของอุปกรณ์แสดง "จากใบแจ้งซ่อม IT01-26/0xx" ได้ · เติมโดย trigger จากแถว `itrp_part_changes` ที่เพิ่งเขียนในธุรกรรมเดียวกัน (ผู้เรียกปลอมเลขที่ใบไม่ได้)
- **`get_part_changes` → `items[]`**: `{id, line_no, action, host_code, to_host_code, asset{type_code, type_name, reg_no, device_code, name}, new_asset{…}|null, result_status, slot, note, actor_employee_no, actor_full_name, created_at}` · **ไม่คืน id ของอุปกรณ์/ช่องลับ** (ผู้แจ้งอ่านได้ จึงเป็นป้ายอย่างเดียว) · `new_asset` มีเฉพาะ `replace` · ใช้แสดงในหน้ารายละเอียด/ใบพิมพ์ของใบ

### ข้อควรรู้สำหรับหน้าเว็บ
- ลำดับใช้งาน: เปิดรายละเอียดใบ → (IT) เรียก `context` → แสดงเครื่องของใบ + ชิ้นส่วนปัจจุบัน → IT เลือกแถวละ 1 action จากรายการ (ชิ้นสำรองเลือกจาก `spares` ชนิดเดียวกับชิ้นเดิม, ปลายทางย้ายเลือกจาก `move_targets`) → ส่ง `apply` → ถ้าสำเร็จโหลด `get_part_changes` ใหม่
- ถ้า `apply` ตอบ "ไม่ได้ติดตั้งที่เครื่อง … ในทะเบียนแล้ว" ให้โหลด `context` ใหม่แล้วให้ IT เลือกใหม่ (ทะเบียนเปลี่ยนไปแล้ว)
- ใบที่ผู้แจ้งไม่ได้กรอกรหัสเครื่อง: ต้องส่งงานโดยระบุเครื่อง (`p_devices`) ก่อน จึงจะมีเครื่องให้เลือก (ใบ `it_closed` ยังบันทึกชิ้นส่วนได้ จนกว่าผู้แจ้งยืนยันรับงาน)
- ใบทดสอบ/ใบจริงแยกกัน: persona เห็นเฉพาะชิ้นส่วนทดสอบ (ในโหมดทดสอบต้องเพิ่มอุปกรณ์ทดสอบในทะเบียนเองก่อน) · ล้างข้อมูลทดสอบ: `app_sandbox_purge_itrp` ลบ `itrp_part_changes` ของทดสอบ, `app_sandbox_purge_itas` ลบอุปกรณ์/ประวัติของ itas (เรียกแยกกัน ลำดับไหนก็ได้)

## ที่ไม่ได้ทำในงานฐานข้อมูล
หน้าเว็บ/เมนู/ใบพิมพ์/ลิงก์แจ้งเตือน (`app.js`, `modules/`, `sw.js`, `index.html`, Edge Functions) · การตั้ง `request_types.IT_REPAIR is_active=false` (ของเพื่อน)
