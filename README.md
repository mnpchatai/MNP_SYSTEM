# MNP Internal System — Phase 1

ระบบคำร้องและอนุมัติภายในแบบ paperless สำหรับพนักงาน MNP สร้างด้วย Next.js, TypeScript, Supabase Auth/Postgres/Storage และ LINE OA integration

## Pilot Web บน GitHub Pages

หน้าเว็บทดลองใช้งานจริงอยู่ที่ [https://mnpchatai.github.io/MNP_SYSTEM/](https://mnpchatai.github.io/MNP_SYSTEM/) โดยไฟล์ `index.html`, `styles.css` และ `app.js` เป็น static client สำหรับ GitHub Pages และเชื่อมต่อ Supabase Cloud ผ่าน publishable key

- รองรับการเข้าสู่ระบบด้วยรหัสพนักงาน
- มีบัญชีทดสอบแยกบทบาทผู้ขอ ผู้อนุมัติ และผู้ปฏิบัติงาน
- การสร้างคำร้อง การอนุมัติ และการเปลี่ยนสถานะเรียก Postgres RPC ที่ตรวจ session/สิทธิ์ฝั่งฐานข้อมูล
- การลงทะเบียนบัญชีทดสอบเรียก `pilot-auth` Edge Function และต้องใช้ invite code ที่ไม่อยู่ใน repository
- GitHub Pages ไม่มี server runtime ดังนั้น LINE webhook/OAuth และฟังก์ชันที่ใช้ server secret ยังคงต้องรันบน Supabase Edge Functions หรือ deployment แบบมี server
- **ทุกครั้งที่แก้ `app.js` หรือ `styles.css` ต้องเลื่อนเลข `?v=` ใน `index.html` ด้วย** ทั้งสองไฟล์ใช้ป้ายรุ่นชุดเดียวกัน (`?v=20260921c`) เพราะเปลี่ยนคู่กันเสมอ ถ้าไม่เลื่อน เบราว์เซอร์ที่เคยเปิดเว็บแล้วจะยังใช้ไฟล์เก่าจาก cache ต่อไป แล้วดูเหมือน deploy ไม่ติด — GitHub Pages ไม่มี build step จึงไม่มี content hash ให้อัตโนมัติ ต้องเลื่อนเอง (ใช้วันที่ deploy เป็นเลขรุ่นได้เลย)

ไฟล์ Next.js เดิมยังคงเป็นสถาปัตยกรรมเป้าหมายสำหรับ production ที่รองรับ Server Actions และ Route Handlers ครบถ้วน ส่วน Pilot Web ใช้สำหรับทดสอบกระบวนการหลายผู้ใช้ในระยะนี้

## คำร้องขอเปิดบัญชีและการกู้คืน ID/รหัสผ่าน

พนักงานใหม่ขอเปิดบัญชีได้เองจากหน้า Login แท็บ **ขอเปิดบัญชี** โดยกำหนด ID (รหัสพนักงาน) และรหัสผ่านที่ต้องการ พร้อมเลือกแผนกและระดับตำแหน่ง ระบบยังไม่สร้างบัญชีจริงจนกว่า Admin จะกดอนุมัติ

```text
พนักงานกรอกคำร้อง (ID, รหัสผ่าน, ชื่อ, แผนก, ตำแหน่ง)
   ↓
บันทึกเป็น account_requests สถานะ pending + แจ้งเตือน Admin
   ↓
Admin เปิดหน้า "ผู้ดูแลระบบ" เลือกสิทธิ์ที่จะให้ แล้วกดอนุมัติ
   ↓
สร้าง Supabase Auth user + employees + บันทึก ID/รหัสผ่านลงคลัง
   ↓
พนักงานเข้าสู่ระบบด้วย ID และรหัสผ่านที่ขอไว้ได้ทันที
```

- **แผนก**: RB GR BG PT PK QA ST WH SR FT MT AD ใช้ร่วมกับแผนกเดิม (MGT, IT, HR, PUR, FIN, OPS) ที่ประเภทคำร้องอ้างอิงอยู่ ชื่อภาษาไทยของแผนกใหม่ยังใช้ตัวย่อและแก้ไขได้ภายหลังที่ตาราง `departments`
- **ตำแหน่ง**: รวมเป็น field เดียวกับสิทธิ์เข้าถึงระบบแล้ว (คือ `employees.role_id` ตรงๆ ไม่มี `position_level` แยกต่างหากอีกต่อไป) มีทั้งหมด 6 ตำแหน่งเรียงจากสูงไปต่ำ: ผู้จัดการทั่วไป, ผู้จัดการโรงงาน, ผู้ช่วยผู้จัดการโรงงาน, ผู้จัดการแผนก, พนักงานทั่วไป, ผู้ดูแลระบบ (ลำดับแสดงผลอยู่ที่ `roles.sort_order`) ผู้ยื่นคำร้องขอเปิดบัญชีเลือกตำแหน่งที่ต้องการได้เอง แต่ Admin เป็นผู้เลือกตำแหน่งจริงที่จะให้ตอนกดอนุมัติเสมอ (ช่อง "ตำแหน่งที่ให้" เว้นว่างไว้ = ใช้ตำแหน่งที่ผู้ยื่นขอไว้)
- **ขอแก้ไข ID/รหัสผ่าน**: ผู้ใช้ที่มีบัญชีแล้วส่งคำร้องได้จากหน้า "ข้อมูลส่วนตัว" รหัสผ่านเดิมยังใช้ได้จนกว่า Admin จะอนุมัติ ส่วนบัญชีที่มีสิทธิ์ `accounts.manage` เป็นผู้อนุมัติอยู่แล้ว หน้าเดียวกันจึงบันทึกและอนุมัติให้ทันทีในขั้นตอนเดียว โดยยังเดินผ่าน RPC ชุดเดิมและบันทึกประวัติไว้ครบ
- **บัญชีผู้ดูแลระบบ**: คลัง ID/รหัสผ่านแสดงพนักงานทุกบัญชีรวมถึงบัญชี Admin และบัญชีของผู้ที่กำลังเปิดดูเอง แถวของตนเองมีป้าย "บัญชีของคุณ"
- **Admin แก้ไขบัญชีได้ทุกคน**: กด "แก้ไข" ที่แถวใดก็ได้ในคลัง จะเปิดฟอร์มที่แก้ได้ทุกช่อง — ID, ชื่อ-สกุล, อีเมล, เบอร์, ชื่อตำแหน่งงาน, แผนก, ตำแหน่ง, สถานะใช้งาน และตั้งรหัสผ่านใหม่ให้ผู้ที่ลืมได้ในฟอร์มเดียวกัน
- **ออกจากระบบทันทีหลังแก้ ID/รหัสผ่านของตัวเอง**: ไม่ว่าจะแก้ผ่านการ์ด "แก้ไข ID / รหัสผ่านของฉัน" ในหน้าข้อมูลส่วนตัว หรือ Admin แก้บัญชีของตัวเองจากคลัง ถ้า ID หรือรหัสผ่านของบัญชีที่ล็อกอินอยู่เปลี่ยน ระบบจะเรียก `forceReLogin` ให้ออกจากระบบทันทีและต้องเข้าสู่ระบบใหม่ด้วยข้อมูลล่าสุดเสมอ
- **ผู้ใช้ทั่วไปแก้ข้อมูลตัวเอง**: หน้า "ข้อมูลส่วนตัว" แก้ชื่อ-สกุล อีเมล เบอร์ และชื่อตำแหน่งงานได้เอง ส่วนแผนกและตำแหน่งเป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ จึงล็อกไว้ให้ Admin เป็นผู้แก้ ป้องกันไม่ให้ผู้ใช้ยกระดับสิทธิ์ของตนเอง
- **กันล็อกเอาต์**: `app_admin_update_employee` ไม่ยอมให้ผู้ดูแลระบบถอดสิทธิ์ `accounts.manage` หรือปิดบัญชีของตนเอง (`CANNOT_DEMOTE_SELF`) เพื่อไม่ให้เหลือระบบที่ไม่มีใครเข้าไปแก้ไขได้
- **คลัง ID/รหัสผ่าน**: `account_credentials` เก็บ ID และรหัสผ่านที่ออกให้ เพื่อให้ Admin ค้นคืนได้เมื่อผู้ใช้ลืม

### การป้องกันคลังรหัสผ่าน

`account_requests` และ `account_credentials` ถูกปิดการเข้าถึงตรงทั้งหมด ไม่มี grant ให้ `anon`/`authenticated` และมี deny-all RLS policy กำกับ การอ่านทำได้เฉพาะผ่าน RPC ที่ตรวจสิทธิ์ `accounts.manage`

| RPC | ผู้เรียกได้ | หน้าที่ |
|---|---|---|
| `app_request_credential_change` | ผู้ใช้ที่ล็อกอิน | ขอแก้ไข ID/รหัสผ่านของตนเอง |
| `app_list_account_requests` | Admin | รายการคำร้อง โดยไม่คืนค่ารหัสผ่าน |
| `app_apply_account_request` | Admin | อนุมัติ สร้างพนักงาน/สิทธิ์ และบันทึกลงคลัง |
| `app_reject_account_request` | Admin | ไม่อนุมัติ พร้อมล้างรหัสผ่านที่แนบมา |
| `app_list_credentials` | Admin | รายชื่อและสถานะรหัสผ่าน (ปิดค่าไว้) |
| `app_reveal_credential` | Admin | เปิดดูรหัสผ่านรายคน และบันทึก audit ทุกครั้ง |
| `app_admin_update_employee` | Admin | แก้ไขข้อมูลพนักงานคนใดก็ได้ทุกช่อง รวมบทบาทและสถานะใช้งาน |
| `app_admin_target_auth_user` | Admin | ตรวจสิทธิ์และคืนบัญชี auth ของเป้าหมายก่อนเปลี่ยนรหัสผ่าน |
| `app_admin_record_password` | Admin | บันทึกรหัสผ่านที่ Admin ตั้งให้ลงคลัง พร้อม audit |
| `app_update_own_profile` | ผู้ใช้ที่ล็อกอิน | แก้ชื่อ อีเมล เบอร์ และชื่อตำแหน่งงานของตนเอง |

หน้าคลังแสดงรหัสผ่านเป็น `••••••••` จนกว่าจะกดปุ่มแสดง ซึ่งเรียก `app_reveal_credential` และเขียน `audit_logs` ด้วย action `REVEAL_CREDENTIAL` พร้อมผู้กดและเวลา

ข้อจำกัดที่ต้องทราบ: บัญชีที่สร้างก่อนระบบนี้จะยังไม่มีรหัสผ่านในคลัง เพราะ Supabase Auth เก็บเป็น hash และย้อนกลับไม่ได้ ผู้ใช้ต้องส่งคำร้องขอแก้ไขรหัสผ่านหนึ่งครั้งก่อน คลังจึงจะมีค่าให้กู้คืน และหากผู้ใช้เปลี่ยนรหัสผ่านด้วยช่องทางอื่นนอกเหนือจากคำร้องนี้ ค่าในคลังจะไม่ตรงกับรหัสผ่านจริง

### หน้าคำร้องใช้ RLS ตัดสินอย่างเดียว ไม่กรองซ้ำฝั่ง client

เดิมหน้าคำร้องและหน้าหลักบังคับ `.eq("requester_id", ตัวเอง)` กับทุกบทบาทที่ไม่ใช่
admin / `requests.view_all` / `requests.operate` ผลคือ **หัวหน้าแผนกซ่อมบำรุงและช่าง
เปิดหน้าคำร้องแล้วว่างเปล่า** ทั้งที่มีใบรออนุมัติจากตัวเองค้างอยู่ และมีงานที่ตัวเอง
เป็นช่างผู้รับผิดชอบ เพราะใบเหล่านั้นไม่ได้มี `requester_id` เป็นตัวเอง

ตอนนี้ตัดการกรองซ้ำออก ให้ RLS เป็นตัวตัดสินชั้นเดียว แล้วเพิ่มปุ่มสลับขอบเขตแทน

| ปุ่ม | ลิงก์ | เห็นอะไร |
| --- | --- | --- |
| ทุกใบที่เกี่ยวข้องกับฉัน (ค่าเริ่มต้น) | `#/requests` | ใบที่แจ้งเอง + รออนุมัติจากเรา + เป็นผู้รับผิดชอบ + งานของแผนกที่เรารับผิดชอบ |
| เฉพาะที่ฉันแจ้ง | `#/requests?scope=mine` | พฤติกรรมเดิม คือเฉพาะใบที่ตัวเองเป็นผู้แจ้ง |

มุมมองเริ่มต้นเพิ่มคอลัมน์ "ผู้แจ้ง" ด้วย เพราะตอนนี้มีใบของคนอื่นปนอยู่แล้ว

## กระดานติดตามสถานะ — ทุกคนเห็นว่าแต่ละใบไปถึงไหนแล้ว

หน้า **คำร้อง** มีสองมุมมอง สลับได้ที่แท็บด้านบนของหน้า

| มุมมอง | ลิงก์ | เห็นอะไร |
| --- | --- | --- |
| รายการตามสิทธิ์ | `#/requests` | รายการเดิมตาม RLS (ใบของตัวเอง ใบที่ตนรับผิดชอบ ใบที่ตนอนุมัติ หรือทุกใบถ้ามีสิทธิ์ `requests.view_all` / `requests.operate`) เพิ่มคอลัมน์ "ความคืบหน้า" |
| ติดตามสถานะทุกใบ | `#/requests?view=board` | พนักงานที่ยัง active **ทุกคน** เห็นทุกใบว่าเดินไปถึงขั้นไหนแล้ว |

กระดานนี้ไม่ได้แก้ RLS ของตารางไหนเลย แต่อ่านผ่าน RPC `public.app_request_status_board(p_status, p_search, p_limit)`
ซึ่งเป็น `security definer` และคืนเฉพาะฟิลด์ระดับติดตามสถานะ

- **คืน**: เลขที่ใบ · ประเภท · แผนกที่แจ้ง · รหัส/ชื่อเครื่องจักร · ผู้แจ้ง · ช่างผู้รับผิดชอบ · สถานะ · ขั้นอนุมัติปัจจุบัน · คนที่ต้องดำเนินการต่อ · วันที่ · ธงด่วน
- **ไม่คืน**: `description` และ `details` (รายละเอียดอาการ) · ไฟล์แนบ · ความเห็นผู้อนุมัติ · ผลวิเคราะห์สาเหตุ/อะไหล่ · หมายเหตุการตรวจรับ
- ใบแจ้งซ่อมคืน `subject` เป็นรหัส/ชื่อเครื่องจักร ไม่ใช่ `title` เพราะ `app_create_repair_request` ประกอบ title จาก
  `"<ชื่อเครื่องจักร> — <รายละเอียดอาการ>"` การส่ง title ออกไปจึงเท่ากับส่งรายละเอียดอาการออกไปด้วย
- `can_open` บอกว่าบัญชีที่เรียกมีสิทธิ์เปิดดูรายละเอียดเต็มของใบนั้นหรือไม่ UI ทำเป็นลิงก์เฉพาะใบที่ `true`
  ส่วนการบังคับสิทธิ์จริงยังเป็น RLS ในหน้ารายละเอียด (`#/request?id=…`) เหมือนเดิม
- `anon` เรียกไม่ได้ และบัญชีที่ยังไม่ได้ผูกกับ `employees` ที่ active จะได้ `EMPLOYEE_NOT_FOUND`

แถบความคืบหน้าใช้สถานะปัจจุบันของใบเป็นตัวตั้ง ใบแจ้งซ่อมมี 6 ขั้น
(รออนุมัติ → รอมอบหมายช่าง → รอช่างเริ่มงาน → กำลังซ่อม → รอตรวจรับ → เสร็จแล้ว)
คำร้องทั่วไปมี 4 ขั้น (รออนุมัติ → อนุมัติแล้ว → กำลังดำเนินการ → เสร็จแล้ว)
ส่วน `more_info` / `rejected` / `cancelled` แสดงเป็นจุด "ติดขัด" ค้างที่ขั้นอนุมัติ
การตรวจรับไม่ผ่านจะย้อนใบกลับไป `assigned` แถบจึงถอยตามด้วย ไม่ค้างที่ขั้นสูงสุดที่เคยผ่าน

## สิทธิ์อนุมัติแยกตามโมดูล

เดิมใครก็ตามที่ถือบทบาทผู้อนุมัติของแผนกเจ้าของประเภทคำร้อง (เช่น หัวหน้างานแผนก MT) จะอนุมัติได้ทุกโมดูลที่แผนกตนรับผิดชอบทันที หน้า "ผู้ดูแลระบบ" แท็บ **สิทธิ์อนุมัติตามโมดูล** ให้ Admin กำหนดเพิ่มอีกชั้นว่าผู้อนุมัติแต่ละคนอนุมัติโมดูลไหนได้บ้าง (เช่น ใบคำร้อง/แจ้งซ่อม MT, ใบคำร้องถึงห้องบริหาร) โดยติ๊ก/ถอดติ๊กเป็นรายบุคคล×โมดูล ผู้ที่ยังไม่ถูกติ๊กโมดูลใดจะไม่เห็นและอนุมัติคำร้องโมดูลนั้นแม้อยู่แผนกและถือบทบาทผู้อนุมัติเดียวกันก็ตาม

- **ไม่กระทบขั้นตอนหัวหน้าแผนก**: ขั้น "หัวหน้าแผนก" ผูกกับตัวบุคคล (`approver_employee_id`) ไม่ใช่บทบาท จึงไม่ถูกจำกัดด้วยตารางนี้ หัวหน้าแผนกยังอนุมัติคำร้องของลูกน้องตนเองได้ตามปกติทุกโมดูล
- **ยังคงพฤติกรรมเดิมทันทีหลัง migrate**: ผู้อนุมัติที่มีอยู่แล้ววันนี้ถูกให้สิทธิ์ทุกโมดูลที่ตนอนุมัติอยู่แล้วโดยอัตโนมัติในไฟล์ migration จากนี้ไป Admin เป็นผู้ให้/ถอดสิทธิ์ผู้อนุมัติคนใหม่เอง
- **Admin ไม่ถูกจำกัด**: บัญชีที่มีสิทธิ์ `requests.view_all` (Admin) มองเห็นและอนุมัติได้ทุกคำร้องเสมอ ไม่ต้องมีแถวสิทธิ์ในตารางนี้ และจะไม่ปรากฏในตารางจัดการเพื่อไม่ให้สับสน
- **บังคับทั้งฝั่งมองเห็นและฝั่งกดอนุมัติ**: `private.can_access_request` (ใช้ใน RLS ของ requests/approval_steps/comments/attachments) และ `app_approval_decision` ตรวจสิทธิ์โมดูลเหมือนกัน ผู้ที่ไม่มีสิทธิ์จะไม่เห็นคำร้องนั้นเลย ไม่ใช่แค่กดอนุมัติไม่ได้

`approval_module_permissions` ปิดการเข้าถึงตรงทั้งหมดเหมือน `account_requests`/`account_credentials` เข้าถึงได้เฉพาะผ่าน RPC ที่ตรวจสิทธิ์ `approvals.manage`

| RPC | ผู้เรียกได้ | หน้าที่ |
|---|---|---|
| `app_list_module_permissions` | Admin | ตารางสิทธิ์ของผู้อนุมัติทุกคน × ทุกโมดูล พร้อมสถานะให้สิทธิ์แล้วหรือยัง |
| `app_set_module_permission` | Admin | ให้/ถอดสิทธิ์อนุมัติโมดูลหนึ่งของพนักงานคนหนึ่ง |
| `app_my_approval_modules` | ผู้ใช้ที่ล็อกอิน | ดูรายการโมดูลที่ตนเองอนุมัติได้ ใช้กรองหน้า "รออนุมัติ" ฝั่งไคลเอนต์ |

## ลำดับอนุมัติใบแจ้งซ่อม — ผู้จัดการโรงงาน → ผู้จัดการทั่วไป

ขั้นตอนจริงหน้างานของใบแจ้งซ่อมคือ

```text
ผู้แจ้งเปิดใบ
   ↓
ผู้จัดการโรงงานอนุมัติ
   ↓
ผู้จัดการทั่วไปอนุมัติ
   ↓
ผู้จัดการแผนกซ่อมบำรุงมอบหมายช่าง   ← ไม่ใช่ขั้นอนุมัติ เป็นการแจกจ่ายงาน
   ↓
ช่างที่ถูกมอบหมายกดเริ่มงาน → บันทึกผลซ่อม → ผู้แจ้งตรวจรับ
```

**ก่อน `20260921080000` โค้ดไม่ได้ทำตามนี้เลย** ขั้นอนุมัติที่ `app_create_repair_request` สร้างคือ
"หัวหน้าแผนกของผู้แจ้ง" แล้วต่อด้วย "ผู้อนุมัติของหน่วยงานเจ้าของประเภทเอกสาร" ซึ่ง resolve จาก
`request_types.final_approver_role_id` ของ `MT_REPAIR` — ค่านั้นคือ role
`20000000-0000-0000-0000-000000000002` ที่ seed แรกตั้งชื่อว่า `approver` แล้วถูก**เปลี่ยนชื่อ**เป็น
`department_manager` ใน `20260919000000_unify_position_and_role` โดยคง id เดิมไว้ คู่กับ
`owning_department_id` = MT ผลลัพธ์จึงเป็น **ผู้จัดการแผนกซ่อมบำรุง (หัวหน้าช่าง) กลายเป็นผู้อนุมัติ
ขั้นสุดท้ายของทุกใบแจ้งซ่อม** ทั้งที่ตามขั้นตอนจริงเขาไม่มีอำนาจอนุมัติ มีแค่หน้าที่มอบหมายช่างและ
อัปเดตงาน ส่วนผู้จัดการโรงงานกับผู้จัดการทั่วไปไม่เคยอยู่ในสายอนุมัติของใบแจ้งซ่อมเลยสักขั้น

สิ่งที่ `20260921080000_repair_approval_chain_factory_then_general_manager.sql` แก้

| จุด | เดิม | ใหม่ |
| --- | --- | --- |
| `app_create_repair_request` | หัวหน้าแผนกผู้แจ้ง → ผจก.แผนกเจ้าของเอกสาร (= หัวหน้าช่าง) | ผู้จัดการโรงงาน → ผู้จัดการทั่วไป (ผูกกับบทบาท ไม่ผูกแผนก) |
| `app_approval_decision` | ข้ามการตรวจสิทธิ์ได้ทุกคนที่มี `requests.view_all` (รวม ผจก.โรงงาน/ผจก.ทั่วไป) | ข้ามได้เฉพาะ role `admin` จริง — ใช้เกณฑ์เดียวกับ `20260921050000` ที่ทำไว้กับปุ่มเริ่มงานซ่อม |
| `app_list_module_permissions` | ตัดทุก role ที่มี `requests.view_all` ออกจากตารางสิทธิ์โมดูล | ตัดเฉพาะ `admin` เพื่อให้ Admin ติ๊กสิทธิ์โมดูลให้ ผจก.โรงงาน/ผจก.ทั่วไป ได้ |
| ใบที่ค้างอยู่ | ค้างกับผู้อนุมัติชุดเดิม | ใบที่ยัง `pending_approval`/`more_info` ถูกย้ายมาสายใหม่พร้อมบันทึกใน `request_status_history` (ใบที่เลยขั้นอนุมัติไปแล้วไม่ถูกแตะ) |

เนื่องจาก `app_create_repair_request` กำหนดสองขั้นนี้ตายตัวแล้ว ค่า `final_approver_role_id` และ
`requires_manager_approval` ของ `MT_REPAIR` จึงไม่ถูกอ่านอีกต่อไป (ยังคงมีผลกับคำร้องประเภทอื่นที่
ใช้ `app_create_request` ตามเดิม)

**ผลข้างเคียงที่ตั้งใจ**: การเลิก bypass ด้วย `requests.view_all` มีผลกับคำร้องทุกประเภท ผู้จัดการโรงงาน
และผู้จัดการทั่วไปจะกดอนุมัติได้เฉพาะขั้นที่เป็นของตัวเองจริงๆ ไม่ใช่ทุกใบเหมือนเดิม และฝั่ง `app.js`
(`getPendingApprovals` กับ `canApprove` ในหน้ารายละเอียด) ใช้เงื่อนไขชุดเดียวกับฐานข้อมูลแล้ว จึงไม่มี
กรณีที่ปุ่มโผล่ให้กดแล้วโดน `NOT_AUTHORIZED` ตอบกลับ

## รายการอะไหล่/วัสดุที่ใช้ในงานซ่อม

ตอนยกงานซ่อมเข้ามาจากระบบ Maintanance-MT เดิม (ดู `supabase/migrations/20260917101000_*`) ช่อง
"อะไหล่/วัสดุที่ใช้" ถูกลดรูปเหลือ `parts_used` เป็นข้อความก้อนเดียว ทั้งที่ระบบเดิมเก็บเป็นรายการ
โครงสร้าง (ชื่อ/จำนวน/หน่วย/ราคา/ร้าน/หมายเหตุ) — ช่างจึงพิมพ์ได้แค่ข้อความอิสระ ไม่มีช่องจำนวน/ราคา/
ร้านแยกให้กรอก และไม่มีทางอ่านกลับเป็นรายการเพื่อรวมยอดภายหลัง

แก้ใน `supabase/migrations/20260921060000_repair_parts_used_items.sql` — เพิ่มคอลัมน์
`requests.parts_used_items` (jsonb array ของ `{name, qty, unit, price, shop, note}`) และหน้า
"บันทึกผลการซ่อมและจบงาน" (`renderRequestDetail` ใน `app.js`) เปลี่ยนจาก textarea ช่องเดียวเป็นแถว
กรอกรายการที่เพิ่ม/ลบได้ (`partsRowHtml`) ส่ง `p_parts_used_items` ให้ `app_finish_repair_work` แทน
ข้อความก้อนเดียว

`parts_used` (text เดิม) ยังอยู่ครบ ไม่ถูกลบ — ตอนนี้ RPC เป็นผู้คำนวณให้อัตโนมัติจาก
`parts_used_items` (จัดรูปแบบลำดับเลขเหมือน `formatParts_` ของระบบเดิม) แทนที่จะรับข้อความจาก
ผู้เรียกตรงๆ ทุกจุดที่เคยอ่าน `parts_used` (การ์ดรายละเอียดคำร้อง, สำเนาที่ซิงก์ไป Apps Script) จึง
ยังอ่านได้ตามเดิมโดยไม่ต้องแก้โค้ดฝั่งอ่าน — `.request-fact-value` เพิ่ม `white-space: pre-line`
ให้รายการหลายบรรทัดนี้ (และช่องข้อความหลายบรรทัดอื่นอย่างวิเคราะห์สาเหตุ) ขึ้นบรรทัดจริงแทนที่จะถูก
ยุบรวมเป็นบรรทัดเดียว

## สิ่งที่มีใน Phase 1

- Employee Master, Department, Role และ Permission
- Login ด้วยรหัสพนักงาน โดยใช้ Supabase Auth จัดการรหัสผ่านและ session ฝั่งเซิร์ฟเวอร์
- Request Center 8 ประเภท: แจ้งซ่อม MT, แจ้งซ่อม IT, ซ่อมรถ, ขอซื้อ/ขอซ่อม, คำร้องฝ่ายบริหาร, IT Access, ลางาน และขออบรม
- ลำดับอนุมัติ: คำร้องทั่วไป = หัวหน้าแผนก → ผู้อนุมัติของหน่วยงานรับผิดชอบ · ใบแจ้งซ่อม = ผู้จัดการโรงงาน → ผู้จัดการทั่วไป (ดูหัวข้อ "ลำดับอนุมัติใบแจ้งซ่อม")
- Approve, Reject, Request More Information, comment และ attachment
- สถานะงาน, ผู้รับผิดชอบ, status history, notification และ audit log
- Dashboard: คำร้องของฉัน / รอฉันอนุมัติ / กำลังดำเนินการ / เสร็จแล้ว
- แจ้งเตือนทางอีเมลเมื่อคำร้องเดินไปแต่ละขั้น (ดู `src/lib/notify.ts`)
- LINE Login สำหรับผูกพนักงาน, per-user Rich Menu และ webhook ที่ตรวจ HMAC signature (ไม่ได้ใช้ส่งแจ้งเตือนแล้ว)
- Row Level Security (RLS) และ private Storage bucket สำหรับไฟล์แนบ

## สถาปัตยกรรม

```text
Next.js App Router
├─ Server Components        หน้า Dashboard / Request / Approval / Profile
├─ Server Actions           create request, approve, comment, upload, change status
├─ Route Handlers           LINE OAuth, LINE webhook, signed attachment URL
└─ Supabase
   ├─ Auth                  session แบบ cookie-backed SSR
   ├─ Postgres + RLS        employee, workflow, audit, notification
   └─ Private Storage       request-attachments (signed URL 60 วินาที)
```

การดำเนิน workflow ที่ต้องแก้หลายตารางใช้ secret key เฉพาะใน Server Actions หลังตรวจผู้ใช้และสิทธิ์แล้วเท่านั้น ส่วนการอ่านข้อมูลและการเพิ่ม comment/attachment ใช้ session ของผู้ใช้ผ่าน RLS โดยตรง Secret key ไม่ถูกส่งไป browser

## ความต้องการระบบ

- Node.js 22 ขึ้นไป (Supabase JavaScript libraries รุ่นที่ล็อกไว้ยุติการรองรับ Node 20)
- npm 10 ขึ้นไป
- Supabase project หรือ Docker Desktop สำหรับ local stack

## เริ่มต้นใช้งาน

```bash
npm install
cp .env.example .env.local
```

บน Windows PowerShell ใช้ `Copy-Item .env.example .env.local`

### ทางเลือก A: ใช้ Supabase ในเครื่อง

เปิด Docker Desktop แล้วรัน:

```bash
npm run db:start
npm run db:reset
```

นำค่าจาก `npx supabase status -o env` ไปใส่ `.env.local` แล้วรัน:

```bash
npm run dev
```

### ทางเลือก B: ใช้ Supabase project บน Cloud

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

จาก Supabase Dashboard นำ Project URL, Publishable key และ Secret key ไปใส่ `.env.local` ห้ามใช้ Secret key ในตัวแปรที่ขึ้นต้นด้วย `NEXT_PUBLIC_`

> Migration กำหนด grants และ RLS ให้ตารางใน `public` แล้ว ซึ่งรองรับการเปลี่ยนแปลงของ Supabase ที่ไม่เปิดตารางใหม่ต่อ Data API โดยอัตโนมัติ อย่างไรก็ตามต้องตรวจว่า `public` อยู่ใน Exposed schemas ของ Data API settings

## สร้างผู้ใช้คนแรก

ไฟล์ seed สร้างข้อมูลพนักงานตัวอย่าง แต่ไม่สร้างรหัสผ่าน ให้สร้างผู้ใช้ใน Authentication → Users แล้วผูก Auth UUID กับ employee ที่ต้องการ ผู้ใช้จะกรอก `employee_no` แทนอีเมลในหน้า Login:

```sql
update public.employees
set auth_user_id = 'AUTH_USER_UUID'
where employee_no = 'MNP0001';
```

บัญชีตัวอย่าง:

| รหัสพนักงาน | ตำแหน่ง | จุดประสงค์ |
|---|---|---|
| `MNP0001` | ผู้ดูแลระบบ | ดูทั้งหมดและจัดการระบบ |
| `MNP0101` | ผู้จัดการแผนก | ทดลองอนุมัติ |
| `MNP0102` | พนักงานทั่วไป | ทดลองสร้างคำร้อง |
| `MNP0201` | ผู้ช่วยผู้จัดการโรงงาน | ทดลองรับและปิดงาน |

ระบบค้นหา Auth user จาก `employees.auth_user_id` เฉพาะบนเซิร์ฟเวอร์ จึงไม่ส่งอีเมลภายในไปยัง browser ใน production ควรสร้างผู้ใช้ผ่าน Admin API/ระบบ provisioning และห้ามเปิด public sign-up หากองค์กรไม่ได้ต้องการ

## แจ้งเตือนทางอีเมล

การแจ้งเตือนเมื่อคำร้องเดินไปแต่ละขั้นส่งทางอีเมลแล้ว ไม่ได้ push เข้า LINE อีกต่อไป ตัวส่งอยู่ที่
`src/lib/notify.ts` (`notifyEmployeeByEmail`) ซึ่งอ่านอีเมลจาก Employee Master และข้ามบัญชีที่ปิด
ใช้งานแล้ว สัญญาของฟังก์ชันเหมือนตัวเดิมทุกอย่าง คือไม่โยน error ออกไป และคืน `{ ok, configured }`
ให้ผู้เรียกตัดสินใจ — อีเมลส่งไม่ออกต้องไม่ทำให้คำร้องล้ม

ช่องทางส่งเลือกจาก environment variable ไม่ผูกกับผู้ให้บริการรายใดในโค้ด

| ตั้งค่า | ผล |
|---|---|
| `RESEND_API_KEY` + `NOTIFY_EMAIL_FROM` | ส่งผ่าน Resend API |
| `NOTIFY_EMAIL_WEBHOOK_URL` | POST `{ to, subject, text }` ไปปลายทางที่กำหนด ใช้ต่อกับ Apps Script ที่ส่งอีเมลอยู่แล้วได้โดยไม่ต้องสมัครผู้ให้บริการใหม่ |
| ไม่ตั้งอะไรเลย | ไม่ส่ง คืน `configured:false` เงียบๆ ระบบยังทำงานครบ เหมือนตอน LINE ไม่มี token |

หัวเรื่องอีเมลคือบรรทัดแรกของข้อความ ซึ่งเป็นบรรทัดสรุปเรื่องอยู่แล้วในทุกจุดที่เรียก โครงข้อความ
จึงเหมือนที่เคยส่งเข้า LINE ทุกประการ

โค้ดส่วน LINE Login และ Rich Menu ยังอยู่ครบและยังใช้ผูกบัญชีได้ตามเดิม เพียงแต่ไม่ได้ถูกใช้ส่ง
แจ้งเตือนแล้ว ถ้าตัดสินใจเลิกใช้ LINE ทั้งหมดค่อยถอดออกทีเดียวพร้อมตาราง `line_accounts`

### อีเมลแจ้งเตือนของ Pilot Web (แยกช่องทางจาก `notify.ts` ข้างบน)

Pilot Web (`app.js`) เรียก Postgres RPC ตรงๆ ไม่ผ่าน Server Action ของ Next.js จึงส่งอีเมลด้วย
`notify.ts` ไม่ได้ — ใช้ Edge Function `supabase/functions/notify-email` แทน

ฟังก์ชันนี้ทำงานเป็น **คิว** ไม่ใช่ "ส่งตามคำสั่งของหน้าจอ" แถวใน `public.notifications` ที่
`email_status = 'pending'` คือคิวงาน ใครเรียกฟังก์ชันเมื่อไรก็ได้ ฟังก์ชันจะไล่ส่งแถวที่ยังค้าง
แล้วบันทึกผลจริงลงแถวนั้น (`sent` / `skipped` / `failed` พร้อม `email_error`) ไม่คำนวณผู้รับซ้ำ
ฝั่งไคลเอนต์ เพราะ RPC (security definer) เลือกผู้รับที่ถูกต้องไว้ให้แล้วตอน insert

| เรียกด้วย | ผล |
|---|---|
| `POST { requestId }` | เร่งส่งเฉพาะแจ้งเตือนของคำร้องนั้น ใช้ทันทีหลัง action สำเร็จ |
| `POST {}` | ไล่ทั้งคิว ครอบคลุมแจ้งเตือนที่ไม่ผูกกับคำร้อง (คำร้องเปิดบัญชี/แก้ไข ID ซึ่ง `request_id` เป็น `NULL`) และแถวที่ตกค้างจากรอบก่อน |
| `POST { action: "status" }` | คืนว่าตั้งค่าช่องทางส่งไว้หรือยัง ใช้ช่องทางไหน และมีกี่แถวค้างคิว |

จุดที่เรียก: ทุก action ที่ RPC insert แจ้งเตือน (สร้างคำร้อง/ใบแจ้งซ่อม, อนุมัติ, อัปเดตสถานะ,
มอบหมายช่าง, เริ่มงาน, บันทึกผลซ่อม, ตรวจรับ, คำร้องบัญชี) บวกกับ **ไล่คิวหนึ่งครั้งตอนเปิดแอป**
เพื่อกู้แถวที่ตกค้าง และ `pilot-auth` เรียกให้เองด้วย service role ในเส้นทางคำร้องเปิดบัญชี/อนุมัติ
ซึ่งผู้ยื่นยังไม่มี session ของตัวเอง

เนื้อหาอีเมลถูกประกอบที่ Edge Function ทั้งหมด ไม่ต้องแก้ RPC เพิ่ม: หัวเรื่องมีอีโมจิและเลขที่
คำร้อง ตัวอีเมลเป็น HTML มีแถบสีตามประเภทเรื่อง ตารางรายละเอียด (เลขที่ ประเภท เรื่อง สถานะ
ความสำคัญ ผู้ขอ หน่วยงาน เครื่องจักร กำหนดเวลา) และปุ่มลิงก์ตรงไปยังหน้ารายการนั้น โดยใช้กติกา
เดียวกับ `notificationHref()` ใน `app.js` เพื่อให้กดจากอีเมลแล้วไปถึงหน้าเดียวกับที่กดจากในเว็บ

ปลายทางของลิงก์อ่านจาก `APP_BASE_URL` (ไม่ตั้งจะใช้ `https://mnpchatai.github.io/MNP_SYSTEM`)
ย้าย host เมื่อไรก็แก้ที่ secret ตัวนี้ตัวเดียว ไม่ต้อง deploy ใหม่

ประโยคนำขึ้นต้นด้วยชื่อโมดูลจาก `request_types.name_th` เช่น "ใบคำร้อง/แจ้งซ่อม MT รอคุณอนุมัติ"
ผู้รับจึงรู้ว่าเรื่องอะไรตั้งแต่บรรทัดแรกโดยไม่ต้องเปิดอ่าน แจ้งเตือนที่ไม่ผูกกับคำร้อง (เรื่องบัญชีผู้ใช้)
ใช้ประโยคกลางๆ แทน

อีโมจิและสีเลือกจากคำในหัวเรื่อง ไม่ได้เทียบแบบตรงตัว แจ้งเตือนชนิดใหม่ที่ RPC เพิ่มภายหลังจึงได้
อีโมจิที่เข้าเรื่องเองโดยไม่ต้องกลับมาแก้: 📋 รออนุมัติ · 🔄 เปลี่ยนสถานะ · 🔧 มอบหมายงาน ·
🔍 ตรวจรับ · ✅ อนุมัติ · ❌ ไม่ผ่าน · 🔑 บัญชี

ค่าสถานะที่ RPC เขียนไว้เป็น enum อังกฤษ (`approved`, `more_info`) ถูกแปลเป็นไทยตอนประกอบอีเมล
และทุกค่าที่ผู้ใช้พิมพ์เองถูก escape ก่อนวางลง HTML เสมอ

หน้าผู้ดูแลระบบมีแถบสถานะอยู่บนสุด บอกว่าอีเมลแจ้งเตือนส่งออกได้หรือยัง ใช้ช่องทางไหน และค้างคิว
กี่รายการ พร้อมปุ่มสั่งส่งคิวที่ค้างเดี๋ยวนี้ — ถ้ายังไม่ได้ตั้ง secret แถบนี้จะเป็นสีแดงบอกให้ไปตั้ง
แทนที่จะเงียบไปเฉยๆ อย่างเดิม

เมื่อส่งไม่สำเร็จ ฟังก์ชันจะลองใหม่ได้สูงสุด 3 ครั้ง (นับที่ `email_attempts`) ครบแล้วจึงปิดเป็น
`failed` และอีเมลที่ส่งไม่ได้จริงตั้งแต่ต้น เช่น โดเมนสมมติอย่าง `@pilot.mnp.local` หรือผู้รับที่
ปิดใช้งานแล้ว จะถูกบันทึกเป็น `skipped` พร้อมเหตุผล ไม่นับเป็นความล้มเหลว

ไล่หาสาเหตุเมื่อผู้ใช้แจ้งว่าอีเมลไม่เข้า ดูได้จากฐานข้อมูลโดยตรง:

```sql
select created_at, title, email_status, email_attempts, email_error
  from public.notifications
 where email_status <> 'sent'
 order by created_at desc;
```

เลือกช่องทางส่งจาก secret ที่ตั้งไว้ ไม่ผูกกับผู้ให้บริการรายใดในโค้ด (ลอง Resend ก่อนถ้ามี
`RESEND_API_KEY` ไม่มีค่อย fallback ไป Gmail SMTP ด้วย `nodemailer`):

| ตั้งค่า | ผล |
|---|---|
| `RESEND_API_KEY` (+ `NOTIFY_EMAIL_FROM` ถ้ามี) | ส่งผ่าน Resend API — ไม่ต้องพึ่ง admin อีเมลของบริษัทเลย ใช้เมื่อ admin ปิดการสร้าง Gmail App Password ไว้ |
| `GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD` | ส่งผ่าน `smtp.gmail.com:465` — ต้องเปิด 2-Step Verification ของบัญชีนั้นก่อนถึงจะสร้าง App Password ได้ที่ myaccount.google.com/apppasswords (คนละอย่างกับรหัสผ่านล็อกอินปกติ) |
| ไม่ตั้งอะไรเลย | ไม่ส่ง คืน `{ ok:true, sent:0, note:"..." }` เงียบๆ ไม่ throw ให้ผู้ใช้เห็น |

```bash
# ทางเลือก A: Resend (แนะนำถ้า admin อีเมลบริษัทปิด App Password ไว้)
npx supabase secrets set RESEND_API_KEY=re_xxx
npx supabase secrets set NOTIFY_EMAIL_FROM=you@company.com   # ไม่ตั้งจะใช้ onboarding@resend.dev (sandbox) แทน

# ทางเลือก B: Gmail SMTP
npx supabase secrets set GMAIL_SMTP_USER=you@company.com
npx supabase secrets set GMAIL_SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx
npx supabase secrets set NOTIFY_EMAIL_FROM=you@company.com   # ไม่ตั้งจะใช้ GMAIL_SMTP_USER แทน

npx supabase functions deploy notify-email
```

## ตั้งค่า LINE OA

สร้าง LINE Login channel และ Messaging API channel ภายใต้ Provider เดียวกัน เพื่อให้ user ID สอดคล้องกัน จากนั้น:

1. ตั้ง callback URL ของ LINE Login เป็น `https://YOUR_DOMAIN/api/line/callback`
2. ตั้ง Messaging API webhook เป็น `https://YOUR_DOMAIN/api/line/webhook`
3. สร้าง Default Rich Menu สำหรับคนทั่วไป: `เว็บไซต์ | ติดต่อเรา`
4. สร้าง Employee Rich Menu: `เว็บไซต์ | ติดต่อเรา | ระบบพนักงาน`
5. ตั้ง Default Rich Menu ที่ OA และนำ ID ของ Employee Rich Menu ใส่ `LINE_EMPLOYEE_RICH_MENU_ID`
6. ใส่ channel IDs/secrets/access token ใน `.env.local`
7. ให้พนักงาน Login เว็บ → Profile → เชื่อมต่อ LINE และเพิ่ม OA เป็นเพื่อน

Per-user Rich Menu มีลำดับสูงกว่า Default Rich Menu ระบบจึงผูก Employee Rich Menu หลังยืนยันพนักงาน ส่วนคนทั่วไปยังเห็น Default Menu หากผู้ใช้ยังไม่ได้เพิ่ม OA เป็นเพื่อน LINE อาจตอบสำเร็จแต่ไม่แสดงเมนู ระบบจะแจ้งให้ลองอีกครั้งหลังเพิ่มเพื่อน

Webhook ตรวจ `x-line-signature` กับ raw body ด้วย HMAC-SHA256 ก่อน parse หรือบันทึก event ตามคำแนะนำของ LINE

ตัวแปรทั้งหมดอยู่ใน [.env.example](.env.example) และไม่มี credential จริงใน repository

## Database และความปลอดภัย

- ทุกตารางใน exposed `public` schema เปิด RLS
- `anon` ไม่มีสิทธิ์อ่านข้อมูลภายใน
- พนักงานอ่านเฉพาะคำร้องที่ตนเป็นผู้ขอ ผู้รับผิดชอบ หรือผู้อนุมัติ
- ผู้จัดการแผนกที่เป็น "เจ้าของประเภทเอกสาร" (`request_types.owning_department_id`) อ่านใบของประเภทนั้นได้ทุกใบ เพื่อให้ตรงกับอำนาจมอบหมายช่างที่ `app_assign_repair_technician` ให้ไว้ — เป็นสิทธิ์อ่านอย่างเดียว ไม่ได้แตะสิทธิ์อนุมัติ
- พนักงานทุกคนเห็น **สถานะ** ของทุกใบได้ผ่าน RPC `app_request_status_board` เท่านั้น ซึ่งคืนเฉพาะข้อมูลระดับติดตามสถานะ ไม่ใช่รายละเอียดคำร้อง
- Client ไม่มีสิทธิ์เขียน request/approval โดยตรง; ทุก transition ทำผ่าน Server Action ที่ตรวจผู้ใช้ บทบาท และสถานะก่อนใช้ server-only key
- Authorization ใช้ข้อมูล role/permission ในฐานข้อมูล ไม่ใช้ user-editable metadata ใน JWT
- Attachment bucket เป็น private และจำกัด 10 MB / MIME type
- LINE webhook ต้องผ่าน signature validation
- Audit trigger ครอบคลุม employee, request, approval และ LINE link

ก่อน production ควรเปิด MFA สำหรับ admin, กำหนด retention ของ audit/webhook events, ตั้ง alert/log drain และทดสอบ restore จาก backup

## ตรวจสอบคุณภาพ

```bash
npm run typecheck
npm run lint
npm run build
npm run db:test
```

`db:test` ต้องมี local Supabase stack ที่กำลังทำงาน และทดสอบทั้ง RLS/grants รวมถึงกรณี allow/deny ของคำร้อง

## ลำดับสถานะ

```text
pending_approval
├─ more_info → รอผู้ขอให้ข้อมูล/ดำเนินการต่อในรอบถัดไป
├─ rejected
└─ approved → in_progress → completed
```

Phase ถัดไปสามารถต่อยอดจาก request ที่อนุมัติแล้วเป็น Work Order, Asset/Machine Master, PM Plan, downtime, spare parts และต้นทุนซ่อมได้โดยไม่ต้องเปลี่ยนแกน identity/workflow นี้

## Roadmap หลัง Phase 1

หลักการของ Roadmap คือทำให้แกน `Identity + Permission + Request + Approval + Notification + Audit` เสถียรก่อน แล้วจึงเพิ่มโมดูลธุรกิจทีละส่วน โดยทุกโมดูลต้องใช้ Employee Master, สิทธิ์, approval engine, attachment, comment, notification และ audit ชุดเดียวกัน ไม่สร้างระบบอนุมัติแยกซ้ำในแต่ละโมดูล

### ลำดับความสำคัญ

| ลำดับ | Phase | เป้าหมายหลัก | เงื่อนไขก่อนเริ่ม |
|---|---|---|---|
| P0 | Phase 1.1 — Pilot Hardening | ทำระบบปัจจุบันให้พร้อมรับผู้ใช้จริงหลายคน | Phase 1 flow หลักทำงานครบ |
| P1 | Phase 2 — Maintenance | เปลี่ยนใบแจ้งซ่อมเป็น Work Order และระบบซ่อมบำรุง | Pilot ผ่าน UAT และ permission เสถียร |
| P2 | Phase 3 — HR Request | เพิ่มคำร้อง HR บน approval engine เดิม | Approval configuration รองรับหลาย workflow |
| P3 | Phase 4 — Procurement | ขยาย PR ไปถึง RFQ/เปรียบเทียบราคา/อ้างอิง PO | กำหนดวงเงินและผู้อนุมัติชัดเจน |
| P4 | Phase 5 — Stock / Material | ใบเบิก รับคืน โอน และ stock movement | Material Master และหน่วยนับพร้อมใช้ |
| P5 | Phase 6 — Production Tracking | ติดตาม Production Order, Routing, WIP และผลผลิต | Master data การผลิตผ่านการตรวจสอบ |
| P6 | Phase 7 — QA / NCR / CAR | เชื่อมผลตรวจคุณภาพกับการผลิตและ corrective action | Production มีข้อมูลจริงสม่ำเสมอ |
| P7 | Phase 8 — Document Control | ควบคุม Revision, Effective Date และเอกสาร ISO | Owner และ approval policy ของเอกสารถูกกำหนดแล้ว |

## Phase 1.1 — Pilot Hardening

Phase นี้ต้องทำก่อนเพิ่มโมดูลใหม่ เพื่อให้ผลทดสอบจากหลายผู้ใช้สะท้อนปัญหาจริงและแก้ได้โดยไม่กระทบข้อมูล production

### งานหลัก

1. **Identity และ Account Lifecycle**
   - ปิด public sign-up และให้สร้างบัญชีผ่าน Admin/Provisioning flow เท่านั้น
   - กำหนดขั้นตอนพนักงานเข้าใหม่ ย้ายแผนก เปลี่ยนบทบาท ระงับ และลาออก
   - บังคับ unique mapping ระหว่าง `auth_user_id`, `employee_no` และ LINE user ID
   - เพิ่ม password policy, leaked-password protection และ MFA สำหรับ Admin
2. **Workflow Configuration**
   - แยก approval rule ออกจากโค้ดเป็น configuration ที่มี version และ effective date
   - รองรับ approver แบบ Manager, Role + Department, Named User และวงเงินอนุมัติ
   - คำร้องที่สร้างแล้วต้องอ้างอิง workflow version เดิม แม้มีการแก้กฎในภายหลัง
3. **Reliability และ Security**
   - เพิ่ม idempotency key ให้ create/approve/status transition เพื่อป้องกันการกดซ้ำ
   - ทุก transition ตรวจ current status และสิทธิ์ใน transaction เดียวกัน
   - เพิ่ม automated test สำหรับ RLS, RPC allow/deny และ workflow transition ที่ผิดลำดับ
   - ตั้ง backup/restore drill, error monitoring, structured log และ alert สำหรับ Edge Function
4. **Pilot Operations**
   - แยก Demo/Test data ออกจากข้อมูลใช้งานจริง
   - จัดทำ UAT script ตามบทบาท Employee, Approver, Operator และ Admin
   - เพิ่ม in-app feedback และช่องทางรายงาน incident โดยอ้างอิง request number
   - เก็บตัวชี้วัด: login success, request completion rate, approval lead time, error rate และจำนวนงานค้าง

### Logic กลางของทุกคำสั่ง

```text
User action
   ↓
ตรวจ session และ employee = active
   ↓
ตรวจ permission + data scope
   ↓
ตรวจ current state + transition ที่อนุญาต
   ↓
ทำ domain transaction
   ├─ บันทึกข้อมูลหลัก
   ├─ บันทึก status history
   ├─ บันทึก audit event
   └─ สร้าง notification/outbox event
   ↓
Commit สำเร็จเพียงครั้งเดียว
   ↓
Worker/Edge Function ส่ง LINE หรือ notification แบบ retry ได้
```

Notification ต้องแยกออกจาก transaction หลักด้วย outbox pattern เพื่อให้คำร้องไม่ล้มเพียงเพราะ LINE API ช้า และต้องมี event key ป้องกันการแจ้งเตือนซ้ำ

### LINE Account และ Rich Menu Workflow

```text
ผู้ใช้ทั่วไปเพิ่ม LINE OA
   ↓
เห็น Default Rich Menu: เว็บไซต์ | ติดต่อเรา

พนักงาน Login Web App
   ↓
ตรวจ employee active + ขอ consent เชื่อม LINE
   ↓
LINE OAuth callback ตรวจ state/nonce
   ↓
ผูก employee ↔ LINE userId แบบ unique
   ↓
Link Per-user Employee Rich Menu
   ↓
ส่งแจ้งเตือนเฉพาะเหตุการณ์ที่ผู้ใช้มีสิทธิ์เห็น

พนักงาน inactive / ลาออก / ยกเลิกการเชื่อม
   ↓
Unlink Per-user Rich Menu + revoke link
   ↓
กลับไปใช้ Default Rich Menu
```

ห้ามถือว่า Web Login เพียงอย่างเดียวสามารถระบุ LINE account ได้ การผูก LINE ต้องเกิดผ่าน OAuth/consent และต้องยกเลิกได้จากทั้งผู้ใช้และ Admin

### เกณฑ์ผ่าน Phase 1.1

- UAT หลักผ่านครบ: สร้างคำร้อง → อนุมัติ → รับงาน → เสร็จสิ้น และ Reject/More Info
- ผู้ใช้ที่ไม่มีสิทธิ์ไม่สามารถอ่านหรือเปลี่ยนคำร้องผ่าน UI, REST หรือ RPC
- ไม่มี P0/P1 defect ที่ยังเปิดอยู่ และ failed transaction ไม่ทิ้งข้อมูลครึ่งชุด
- LINE failure ไม่ทำให้ business transaction ล้ม และระบบ retry โดยไม่ส่งซ้ำ
- ทดสอบ restore backup ได้จริง และมี runbook เมื่อ login/database/LINE ขัดข้อง
- Pilot users ยอมรับ workflow และมี owner รับผิดชอบ master data แต่ละชุด

## Phase 2 — Maintenance System

Phase 2 เป็นลำดับถัดไปที่เหมาะสมที่สุด เพราะ Phase 1 มีใบแจ้งซ่อม ผู้อนุมัติ และ Operator แล้ว จึงต่อยอดเป็น Work Order ได้โดยไม่ต้องเปลี่ยนแกนระบบ

### ขอบเขตข้อมูล

- Machine/Asset Master, location, criticality และสถานะทรัพย์สิน
- Work Order, assignment, SLA, priority และช่างผู้รับผิดชอบ
- Labor log, downtime, repair cause, corrective action และค่าใช้จ่าย
- Spare parts usage โดย Phase นี้บันทึกการใช้ก่อน ยังไม่ตัด Stock จนกว่า Phase 5 พร้อม
- PM Plan, schedule, checklist และประวัติการซ่อมย้อนหลัง
- Requester confirmation, reopen reason และ closure feedback

### Maintenance Workflow

```text
แจ้งซ่อม (Request)
   ↓
หัวหน้าแผนกอนุมัติ
   ↓
หน่วยงานซ่อมบำรุงอนุมัติ/คัดกรอง
   ↓
สร้าง Work Order + กำหนด SLA
   ↓
มอบหมายช่าง
   ↓
ช่างรับงาน
   ↓
in_progress
   ├─ waiting_parts
   ├─ on_hold (ต้องระบุเหตุผล/เวลานัดใหม่)
   └─ repair_completed
          ↓
ผู้แจ้งตรวจรับ
   ├─ ยืนยัน → closed
   └─ ไม่ผ่าน → reopened → in_progress
```

### Transition Rules

| จาก | ไป | ผู้ดำเนินการ | เงื่อนไขสำคัญ |
|---|---|---|---|
| `approved` | `assigned` | Planner/Supervisor | มี Work Order และ assignee |
| `assigned` | `in_progress` | ช่างที่ได้รับมอบหมาย | บันทึกเวลาเริ่ม |
| `in_progress` | `waiting_parts` | ช่าง/Supervisor | ระบุอะไหล่และเหตุผล |
| `in_progress` | `on_hold` | ช่าง/Supervisor | ระบุเหตุผลและ next action date |
| `in_progress` | `repair_completed` | ช่าง | ระบุอาการ สาเหตุ วิธีแก้ เวลา และผลทดสอบ |
| `repair_completed` | `closed` | ผู้แจ้ง/Supervisor ตาม policy | ผ่านการตรวจรับ |
| `repair_completed` | `reopened` | ผู้แจ้ง/Supervisor | ระบุเหตุผลที่ไม่ผ่าน |
| `reopened` | `in_progress` | ช่างที่ได้รับมอบหมาย | เปิด labor/downtime รอบใหม่ |

ห้ามข้ามสถานะด้วยการ update ตารางโดยตรง ทุก transition ต้องผ่าน domain service/RPC และสร้าง status history เสมอ

### Dashboard และ KPI

- Open, Assigned, In Progress, Waiting Parts, Overdue และ Reopened jobs
- Mean Time to Acknowledge (MTTA), Mean Time to Repair (MTTR) และ downtime
- Planned vs Unplanned Maintenance
- PM compliance และงาน PM เกินกำหนด
- Repeat failure แยกตาม asset/cause
- ค่าแรง อะไหล่ และค่าใช้จ่ายต่อเครื่องจักร

### เกณฑ์ผ่าน Phase 2

- Work Order เชื่อมกลับไปยัง request และ asset ได้ทุกใบ
- SLA/overdue คำนวณจากเวลาที่บันทึกจริงและรองรับ on-hold policy
- ช่างเห็นเฉพาะงานในขอบเขตที่รับผิดชอบ และ Supervisor มองเห็นภาพรวมของหน่วยงาน
- ประวัติ asset แสดง request, work order, downtime, parts และ cost ครบ
- PM schedule สร้างงานได้แบบ idempotent และไม่สร้างซ้ำเมื่อ worker retry
- Dashboard KPI ตรงกับข้อมูลดิบที่ตรวจสอบย้อนหลังได้

## Phase 3–8 — Workflow ระดับโมดูล

### Phase 3 — HR Request

```text
Employee → Supervisor → HR Review → Management (ตามประเภท) → HR Complete
```

เริ่มจากลางาน อบรมภายนอก ขอว่าจ้าง เปลี่ยนตำแหน่ง ลาออก และการประเมิน โดยยังไม่รวม Payroll ข้อมูล HR ต้องมี permission แยกจากคำร้องทั่วไปและกำหนด retention/audit ที่เข้มกว่า

### Phase 4 — Procurement

```text
PR → Budget/Approval Limit → Procurement Review → RFQ
   → Price Comparison → Approval → PO Reference → Receiving Status → Complete
```

หาก PO อยู่ใน I-Prime ให้เก็บ reference และ sync status แทนการสร้าง PO ซ้ำ โดย integration ต้องมี external ID, last sync time และ reconciliation report

### Phase 5 — Stock / Material

```text
Material Request → Approve → Reserve → Issue
   ├─ Return
   ├─ Transfer
   └─ Adjustment (ต้องอนุมัติ)
```

ทุก movement ต้องเป็น immutable ledger การแก้ยอดทำผ่าน reversal/adjustment ไม่แก้ transaction เดิม และคำนวณ balance จาก movement ที่ตรวจสอบย้อนกลับได้

### Phase 6 — Production Tracking

```text
Customer Order → Production Order → Routing
   → RB/GR/PT/BG/PK → Partial Completion → Finished
```

เก็บ plan/actual/reject quantity, start/finish, WIP และ delay reason รองรับ partial completion โดยห้ามให้ actual good + reject เกินปริมาณที่รายงานเข้าขั้นตอน

### Phase 7 — QA / NCR / CAR

```text
Incoming/In-process/Finished Inspection
   ├─ Pass → ขั้นตอนถัดไป
   └─ Fail → NCR → Containment → Root Cause → CAR
                → Effectiveness Check → Close
```

ผลตรวจต้องอ้างอิง lot/order/asset ที่ตรวจ NCR และ CAR ต้องมี owner, due date, evidence และการตรวจประสิทธิผลก่อนปิด

### Phase 8 — Document Control

```text
Draft → Review → Approve → Effective
   ↓ revision ใหม่
Superseded/Obsolete → เก็บเพื่อ Audit แต่ผู้ใช้ทั่วไปเปิดไม่ได้
```

ควบคุม Document Code, revision, owner, effective date, distribution และ retention พนักงานเห็นเฉพาะ revision ที่ effective ตามหน่วยงาน/สิทธิ์ ส่วน Document Controller และ Auditor ดูประวัติได้

## กติกาการเริ่ม Phase ใหม่

ก่อนเริ่ม Phase ถัดไปต้องผ่าน Quality Gate ต่อไปนี้:

1. Scope และ process owner ลงนามรับรอง workflow/to-be process
2. Master data owner และแหล่งข้อมูลหลักถูกระบุชัดเจน
3. Permission matrix และกรณี segregation of duties ผ่านการทบทวน
4. Migration, rollback, backup และ reconciliation plan พร้อม
5. Automated test ครอบคลุม happy path, deny path, retry และ concurrent update
6. UAT ผ่านด้วยบัญชีจริงอย่างน้อยหนึ่งคนต่อบทบาท
7. Dashboard/KPI มีนิยามเดียวกับฝ่ายงานและตรวจย้อนกลับถึง transaction ได้
8. มี runbook, owner หลัง go-live และแผนเก็บ feedback รอบถัดไป

Roadmap นี้เป็นลำดับเชิง dependency ไม่ใช่ข้อบังคับว่าต้องเปิดทุกโมดูล หาก Phase ใดไม่มี process owner หรือ master data พร้อม ให้ชะลอ Phase นั้นและเลือกงานย่อยที่ใช้แกนเดิมได้โดยไม่สร้างข้อมูลซ้ำหรือ workflow คู่ขนาน
