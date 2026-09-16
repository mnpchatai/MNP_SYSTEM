# MNP Internal System — Phase 1

ระบบคำร้องและอนุมัติภายในแบบ paperless สำหรับพนักงาน MNP สร้างด้วย Next.js, TypeScript, Supabase Auth/Postgres/Storage และ LINE OA integration

## สิ่งที่มีใน Phase 1

- Employee Master, Department, Role และ Permission
- Login ด้วยรหัสพนักงาน โดยใช้ Supabase Auth จัดการรหัสผ่านและ session ฝั่งเซิร์ฟเวอร์
- Request Center 8 ประเภท: แจ้งซ่อม MT, แจ้งซ่อม IT, ซ่อมรถ, ขอซื้อ/ขอซ่อม, คำร้องฝ่ายบริหาร, IT Access, ลางาน และขออบรม
- ลำดับอนุมัติ: หัวหน้าแผนก → ผู้อนุมัติของหน่วยงานรับผิดชอบ
- Approve, Reject, Request More Information, comment และ attachment
- สถานะงาน, ผู้รับผิดชอบ, status history, notification และ audit log
- Dashboard: คำร้องของฉัน / รอฉันอนุมัติ / กำลังดำเนินการ / เสร็จแล้ว
- LINE Login สำหรับผูกพนักงาน, per-user Rich Menu, push notification hook และ webhook ที่ตรวจ HMAC signature
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
