# สำรองข้อมูลใบคำร้องถึงฝ่ายบริหาร (PP01-FM08)

Google Apps Script สำหรับสำรองข้อมูลคำร้องประเภท `MANAGEMENT` (โมดูล "ใบคำร้องถึงฝ่ายบริหาร")
ไปเก็บไว้ในสเปรดชีต [ใบคำร้องถึงฝ่ายบริหาร](https://docs.google.com/spreadsheets/d/1LFsJZmsPOVAYPi3TFMkLDgRvkk4nV7ThZluNGnLWD_4/edit)
เป็นแค่สำเนาสำรอง/รายงาน — **Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/สายอนุมัติทั้งหมด**
ใช้รูปแบบเดียวกับสคริปต์สำรองใบแจ้งซ่อม (Maintenance-MT) ที่ Pilot Web (`app.js`) เรียกอยู่แล้ว

## Deploy

### ครั้งแรก

1. เปิดสเปรดชีตที่ลิงก์ด้านบน > เมนู **Extensions > Apps Script**
2. ลบโค้ดเริ่มต้นในไฟล์ `Code.gs` ที่ Apps Script สร้างให้ทิ้ง แล้ววางเนื้อหาจาก `Code.gs` ในโฟลเดอร์นี้แทน
3. **Deploy > New deployment** เลือกประเภท **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
4. กด Deploy แล้วคัดลอก URL ของ Web App ที่ได้
5. เปิด `app.js` ที่ root ของ repo หาตัวแปร `APPS_SCRIPT_MANAGEMENT_SYNC_URL` (อยู่ใกล้กับ
   `APPS_SCRIPT_SYNC_URL` ของใบแจ้งซ่อม) แล้ววาง URL ที่ได้ลงไป
6. เลื่อนเลข `?v=` ใน `index.html` ทั้งสองจุด (`styles.css`/`app.js`) ตามธรรมเนียมของ repo แล้ว push

### อัปเดตโค้ดเดิม (เช่นตอนที่เพิ่มชีตสรุปแบบมีคอลัมน์)

1. เปิดสเปรดชีต > **Extensions > Apps Script** > วางเนื้อหา `Code.gs` ใหม่ทับของเดิมทั้งไฟล์
2. **Deploy > Manage deployments** > กดไอคอนดินสอ (แก้ไข) ที่ deployment เดิม > **Version: New version** > **Deploy**
   — ใช้ deployment เดิม **ไม่ต้องสร้างใหม่** เพื่อให้ URL เดิมใน `app.js` ยังใช้ได้ ไม่ต้องแก้อะไรที่ฝั่งเว็บ
3. ทดสอบด้วยการเปิดหน้ารายละเอียดคำร้อง MANAGEMENT จริงในเว็บ แล้วเช็คว่าชีต **"ใบคำร้องถึงฝ่ายบริหาร"**
   มีแถวใหม่/อัปเดต — **ห้ามเชื่อผลจากการกด Run ในตัวแก้ไข Apps Script โดยตรง** เพราะตอนนั้น `e` (event
   ของ HTTP request) เป็น `undefined` โค้ดจะเข้า `catch` แล้วจบแบบ "Execution completed" ทันทีโดยไม่ได้
   รันโค้ดจริงเลย ต้องเป็น POST จริงจาก Pilot Web เท่านั้นถึงจะทดสอบได้ตรง

## รูปแบบข้อมูล

Pilot Web ยิง `fetch(url, { method: "POST", mode: "no-cors", body: JSON.stringify({ batch: [...] }) })`
ทุกครั้งที่มีคนเปิดหน้ารายละเอียดคำร้องประเภทนี้ (ดู `syncManagementOrder`/`syncManagementOrderToAppsScript`
ใน `app.js`) — เพราะเป็น `no-cors` จึงอ่าน response กลับไม่ได้และแนบ header/token ไม่ได้ (เหมือนสคริปต์
ใบแจ้งซ่อมเดิมทุกประการ) **ต้องตั้ง Access เป็น "Anyone" และถือ URL นี้เป็นความลับระดับหนึ่ง (เหมือน webhook)**

Body:

```json
{ "batch": [{ "key": "mgmt:<request-id>", "value": "<JSON string ของ order>" }] }
```

โครงสร้างของ `order` (หลัง parse ค่า `value`):

| ฟิลด์ | ความหมาย |
|---|---|
| `id`, `docNumber` | Supabase request id / request_no |
| `department` | รหัสแผนกของผู้ยื่น |
| `subject`, `description`, `attachmentNote` | เรื่อง / รายละเอียด / สิ่งที่แนบมาด้วย |
| `requestedBy`, `position`, `submittedAt` | ผู้ยื่นคำร้อง / ตำแหน่ง / วันที่ยื่น |
| `status` | `PENDING_FM` / `PENDING_GM` / `NEEDS_INFO` / `APPROVED` / `IN_PROGRESS` / `DONE` / `REJECTED` / `ACKNOWLEDGED` |
| `decision` | มติที่ขั้นล่าสุดที่ตัดสินแล้ว: `approved` / `rejected` / `acknowledged` / `""` (ยังไม่มีมติ) |
| `comment` | บันทึกข้อคิดเห็นฝ่ายบริหารของขั้นที่ตัดสิน |
| `approvals.fm` / `approvals.gm` | สถานะ/ผู้ลงนาม/วันที่/หมายเหตุ ของฝ่ายบริหารโรงงาน และผู้จัดการทั่วไป |
| `ccDepartments`, `ccOther` | รหัสแผนกที่สำเนาถึง + ข้อความช่อง "อื่นๆ" |

สคริปต์นี้เก็บข้อมูล 2 ชั้น (สร้างชีตอัตโนมัติถ้ายังไม่มี):

- **"Log"** — 3 คอลัมน์ `key`, `value` (JSON string ดิบ), `updatedAt` — upsert ทับแถวเดิมด้วย
  `key` เดียวกัน ไว้เป็นสำเนาตั้งต้น/ใช้ debug
- **"ใบคำร้องถึงฝ่ายบริหาร"** — แกะฟิลด์จาก `value` มาลงคอลัมน์ที่มีชื่อ อ่านง่ายแบบเดียวกับชีต
  "ใบแจ้งซ่อม" ของสคริปต์เดิม upsert ทับแถวเดิมด้วย**เลขที่เอกสาร** (คอลัมน์แรก): เลขที่เอกสาร, แผนก,
  เรื่อง, รายละเอียด, สิ่งที่แนบมาด้วย, ผู้ยื่นคำร้อง, ตำแหน่ง, ยื่นเมื่อ, สถานะ, มติ, ความเห็น,
  ผจก.โรงงาน อนุมัติโดย/เมื่อ, ผจก.ทั่วไป อนุมัติโดย/เมื่อ, สำเนาถึงแผนก, สำเนาอื่นๆ, อัปเดตล่าสุด
