# MNP Internal System — Phase 1

ระบบคำร้องและอนุมัติภายในแบบ paperless สำหรับพนักงาน MNP สร้างด้วย Next.js, TypeScript, Supabase Auth/Postgres/Storage และ LINE OA integration

## Pilot Web บน GitHub Pages

หน้าเว็บทดลองใช้งานจริงอยู่ที่ [https://mnpchatai.github.io/MNP_SYSTEM/](https://mnpchatai.github.io/MNP_SYSTEM/) โดยไฟล์ `index.html`, `styles.css` และ `app.js` เป็น static client สำหรับ GitHub Pages และเชื่อมต่อ Supabase Cloud ผ่าน publishable key

- รองรับการเข้าสู่ระบบด้วยรหัสพนักงาน
- มีบัญชีทดสอบแยกบทบาทผู้ขอ ผู้อนุมัติ และผู้ปฏิบัติงาน
- การสร้างคำร้อง การอนุมัติ และการเปลี่ยนสถานะเรียก Postgres RPC ที่ตรวจ session/สิทธิ์ฝั่งฐานข้อมูล
- การลงทะเบียนบัญชีทดสอบเรียก `pilot-auth` Edge Function และต้องใช้ invite code ที่ไม่อยู่ใน repository
- GitHub Pages ไม่มี server runtime ดังนั้น LINE webhook/OAuth และฟังก์ชันที่ใช้ server secret ยังคงต้องรันบน Supabase Edge Functions หรือ deployment แบบมี server

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
- **ระดับตำแหน่ง**: หัวหน้าแผนก / ผู้ช่วยหัวหน้าแผนก / พนักงานทั่วไป เก็บที่ `employees.position_level` และใช้เป็นค่าตั้งต้นของสิทธิ์ (หัวหน้าและผู้ช่วย → ผู้อนุมัติ, พนักงานทั่วไป → พนักงาน) โดย Admin เลือกสิทธิ์อื่นแทนได้ตอนกดอนุมัติ
- **ขอแก้ไข ID/รหัสผ่าน**: ผู้ใช้ที่มีบัญชีแล้วส่งคำร้องได้จากหน้า "ข้อมูลส่วนตัว" รหัสผ่านเดิมยังใช้ได้จนกว่า Admin จะอนุมัติ ส่วนบัญชีที่มีสิทธิ์ `accounts.manage` เป็นผู้อนุมัติอยู่แล้ว หน้าเดียวกันจึงบันทึกและอนุมัติให้ทันทีในขั้นตอนเดียว โดยยังเดินผ่าน RPC ชุดเดิมและบันทึกประวัติไว้ครบ
- **บัญชีผู้ดูแลระบบ**: คลัง ID/รหัสผ่านแสดงพนักงานทุกบัญชีรวมถึงบัญชี Admin และบัญชีของผู้ที่กำลังเปิดดูเอง แถวของตนเองมีป้าย "บัญชีของคุณ"
- **Admin แก้ไขบัญชีได้ทุกคน**: กด "แก้ไข" ที่แถวใดก็ได้ในคลัง จะเปิดฟอร์มที่แก้ได้ทุกช่อง — ID, ชื่อ-สกุล, อีเมล, เบอร์, ชื่อตำแหน่งงาน, แผนก, ตำแหน่งในแผนก, บทบาท/สิทธิ์, สถานะใช้งาน และตั้งรหัสผ่านใหม่ให้ผู้ที่ลืมได้ในฟอร์มเดียวกัน
- **ออกจากระบบทันทีหลังแก้ ID/รหัสผ่านของตัวเอง**: ไม่ว่าจะแก้ผ่านการ์ด "แก้ไข ID / รหัสผ่านของฉัน" ในหน้าข้อมูลส่วนตัว หรือ Admin แก้บัญชีของตัวเองจากคลัง ถ้า ID หรือรหัสผ่านของบัญชีที่ล็อกอินอยู่เปลี่ยน ระบบจะเรียก `forceReLogin` ให้ออกจากระบบทันทีและต้องเข้าสู่ระบบใหม่ด้วยข้อมูลล่าสุดเสมอ
- **ผู้ใช้ทั่วไปแก้ข้อมูลตัวเอง**: หน้า "ข้อมูลส่วนตัว" แก้ชื่อ-สกุล อีเมล เบอร์ และชื่อตำแหน่งงานได้เอง ส่วนแผนก ตำแหน่งในแผนก และบทบาทเป็นตัวกำหนดสิทธิ์และเส้นทางอนุมัติ จึงล็อกไว้ให้ Admin เป็นผู้แก้ ป้องกันไม่ให้ผู้ใช้ยกระดับสิทธิ์ของตนเอง
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

## สิ่งที่มีใน Phase 1

- Employee Master, Department, Role และ Permission
- Login ด้วยรหัสพนักงาน โดยใช้ Supabase Auth จัดการรหัสผ่านและ session ฝั่งเซิร์ฟเวอร์
- Request Center 8 ประเภท: แจ้งซ่อม MT, แจ้งซ่อม IT, ซ่อมรถ, ขอซื้อ/ขอซ่อม, คำร้องฝ่ายบริหาร, IT Access, ลางาน และขออบรม
- ลำดับอนุมัติ: หัวหน้าแผนก → ผู้อนุมัติของหน่วยงานรับผิดชอบ
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

| รหัสพนักงาน | บทบาท | จุดประสงค์ |
|---|---|---|
| `MNP0001` | Admin | ดูทั้งหมดและจัดการระบบ |
| `MNP0101` | Approver | ทดลองอนุมัติ |
| `MNP0102` | Employee | ทดลองสร้างคำร้อง |
| `MNP0201` | Operator | ทดลองรับและปิดงาน |

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
`notify.ts` ไม่ได้ — ใช้ Edge Function ใหม่ `supabase/functions/notify-email` แทน โดยหลัง action
ที่มี insert แถวแจ้งเตือนสำเร็จ (สร้างคำร้อง/สร้างใบแจ้งซ่อม/อนุมัติ/มอบหมายช่าง/ตรวจรับ) ฝั่งไคลเอนต์
จะเรียกฟังก์ชันนี้พร้อม `request_id` ให้ไปหาแถวแจ้งเตือนของคำร้องนั้นที่ `email_sent_at` ยังว่างอยู่
แล้วส่งอีเมลตาม `employees.email` ของผู้รับที่ RPC เลือกไว้แล้ว (ไม่คำนวณผู้รับซ้ำฝั่งไคลเอนต์)

ส่งผ่าน Gmail SMTP (`smtp.gmail.com:465`) ด้วย `nodemailer` ต้องตั้ง secret ให้ Edge Function นี้:

```bash
npx supabase secrets set GMAIL_SMTP_USER=you@company.com
npx supabase secrets set GMAIL_SMTP_APP_PASSWORD=xxxxxxxxxxxxxxxx   # App Password 16 หลักของ Gmail/Workspace บัญชีนี้ ไม่ใช่รหัสผ่านล็อกอินปกติ
npx supabase secrets set NOTIFY_EMAIL_FROM=you@company.com          # ถ้าไม่ตั้ง จะใช้ GMAIL_SMTP_USER แทน
npx supabase functions deploy notify-email
```

ยังไม่ได้ตั้ง secret สองตัวแรก → ฟังก์ชันคืน `{ ok:true, sent:0, note: "..." }` เงียบๆ ไม่ throw ให้ผู้ใช้เห็น

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
