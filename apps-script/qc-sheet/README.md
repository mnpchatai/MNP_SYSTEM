# ใบตรวจ QC (QA01-PM11): ดาวน์โหลด Excel + สำเนาลงสเปรดชีต

Google Apps Script โปรเจกต์เดียว URL เดียว สำหรับโมดูลใบตรวจ QC ใน Pilot Web (โหมดทดสอบ)
เป็นแค่ไฟล์ส่งออก/สำเนาสำรอง — **Supabase ยังเป็นฐานข้อมูลหลักและเป็นตัวบังคับสิทธิ์/ขั้นตอนทั้งหมด**

ทำ 2 อย่าง (แยกด้วยรูปแบบข้อมูลที่ส่งมา):

1. **ดาวน์โหลด Excel** — Pilot Web (`modules/qc-sheet.js`) ส่ง `{ form: "qc", fileName, record }`
   สคริปต์ **วาดฟอร์ม QA01-PM11 ด้วยโค้ด** (ไม่ต้องมีชีตต้นแบบ) ลงสเปรดชีตชั่วคราว: หัวบริษัท / Data Inspection Report /
   Doc No. QA01-PM11 Rev. 00, หัวใบ (Part Number, Part Name, customer, Order No., Code, Inspecter By, inspection Date, Results),
   ตารางรายการ (ITEM No., Inspection Item, Instrument, MIN/STD/MAX, Sample point 1–5, min, max, average, Judge สี O/N/AC),
   REMARK และช่องลงนาม 4 ช่อง (Inspector, manager QA, factory manager, General Manager Approved) พร้อมวันที่/เวลา
   แล้ว export เป็น `.xlsx` (ใช้ OAuth token ของเจ้าของสคริปต์) ส่งกลับเป็น base64 และย้ายไฟล์ชั่วคราวลงถังขยะเสมอ (แม้ล้มเหลว)
2. **สำเนาสำรอง** — Pilot Web ส่ง `{ batch: [{ key: "qc:<id>", value: "<JSON>" }] }` ทุกครั้งที่หน้าใบตรวจถูกวาด
   สคริปต์ upsert ข้อมูลเต็มไว้ในชีตซ่อน `QC_DATA` และหนึ่งแถวต่อใบในชีต `รายงานQC` (จับคู่ด้วยเลขที่ใบ ทุกช่องเป็นข้อความล้วน)
   สร้างสองชีตนี้ให้เองเมื่อยังไม่มี

ใบโหมดทดสอบ (เลขที่ `TEST-…`) รับเข้าสำเนาเมื่อ `ACCEPT_TEST_REPORTS = true` ใน `Code.gs` (ตอนนี้ `true`) แถวมีป้าย **[ทดสอบ]**
นำหน้าสถานะ เลิกทดลองแล้วตั้งเป็น `false` (Deploy เวอร์ชันใหม่) และใช้เมนู **QC > ลบข้อมูลทดสอบ (TEST-) ทั้งหมด**
การดาวน์โหลด Excel ของใบทดสอบทำได้เสมอ (ไม่เก็บข้อมูลไว้ที่ใด)

## Deploy

ต้องเป็น **โปรเจกต์ใหม่แยกจากสคริปต์อื่น** (NCR, ใบแจ้งซ่อม, ใบคำร้องถึงฝ่ายบริหาร ฯลฯ) และต้องเป็นสคริปต์ที่ผูกกับสเปรดชีตของใบตรวจ QC
เพราะสำเนาสำรองเขียนลงสเปรดชีตที่ผูกอยู่ (`getActiveSpreadsheet`) ห้ามใช้ URL ร่วมกับโปรเจกต์อื่น (เทสต์ตรวจ URL ซ้ำไว้)

### ครั้งแรก

1. สร้างสเปรดชีตใหม่ (เช่น “ใบตรวจ QC”) > เมนู **Extensions > Apps Script**
2. วางเนื้อหา `Code.gs` ในโฟลเดอร์นี้แทนโค้ดเริ่มต้น
3. **Project Settings** > ติ๊ก “Show appsscript.json manifest file” แล้ววางเนื้อหา `appsscript.json` (เขตเวลา Bangkok และสิทธิ์ที่ใช้)
   และตั้ง Time zone เป็น `(GMT+07:00) Bangkok`
4. เลือกฟังก์ชัน `authorize` แล้วกด **Run** หนึ่งครั้งเพื่ออนุญาตสิทธิ์ทั้งหมด (สเปรดชีต, Drive สำหรับไฟล์ชั่วคราว, เรียก URL ภายนอกสำหรับ export)
5. **Deploy > New deployment** เลือกประเภท **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. คัดลอก URL ของ Web App (ลงท้าย `/exec`) ใส่ในตัวแปร `EXPORT_URL` **และ** `SYNC_URL` ของ `modules/qc-sheet.js` (เป็น URL เดียวกัน)
7. เลื่อนเลข `?v=` ใน `index.html` ทุกจุดตามธรรมเนียมของ repo แล้วเปิด pull request

ก่อนใส่ URL (ข้อ 6) หน้าเว็บจะซ่อนปุ่ม “ดาวน์โหลด Excel” และไม่ส่งสำเนาใด ๆ การ deploy สคริปต์ก่อนจึงไม่กระทบผู้ใช้

### อัปเดตโค้ดเดิม

วางเนื้อหา `Code.gs` ใหม่ทับทั้งไฟล์ แล้ว **Deploy > Manage deployments** > ไอคอนดินสอ > **Version: New version** > **Deploy**
(ใช้ deployment เดิมเพื่อให้ URL เดิมยังใช้ได้) ถ้า Google ขอสิทธิ์เพิ่ม ให้ Run `authorize` อีกครั้ง

### ทดสอบ

- เปิดใบตรวจในเว็บ (โหมดทดสอบ) แล้วเช็กชีต `รายงานQC` มีแถวของใบนั้น และชีตซ่อน `QC_DATA` มีข้อมูล
- กด **ดาวน์โหลด Excel** ในหน้าใบตรวจ ไฟล์ที่ได้ต้องเป็นฟอร์ม QA01-PM11 ครบทุกส่วน
- **อย่าเชื่อผลการกด Run `doPost` ในตัวแก้ไข Apps Script** เพราะตอนนั้นไม่มี `e` จริง ต้องทดสอบด้วย POST จริงจาก Pilot Web
- ถ้าดาวน์โหลดไม่สำเร็จ ข้อความในเว็บจะมีรหัส เช่น `BAD_RECORD` (ข้อมูลผิดรูป/เกิน 30 รายการ) `TOO_LARGE` `FAILED_CREATE` `FAILED_DRAW`
  `FAILED_EXPORT_403` (ขั้นที่ล้ม) — ดูรายละเอียดที่ **Executions** ของ Apps Script

## ความเสี่ยงของ URL สาธารณะ

Web App ต้องเปิด **Anyone** เพราะ `fetch` แบบ `no-cors` (สำเนา) แนบ token ไม่ได้ ดังนั้นใครมี URL ก็ส่งข้อมูลเข้ามาได้
ถือ URL เป็นความลับระดับ webhook อย่าใส่ใน issue/แชต/ข้อความสาธารณะ

- สคริปต์ **ไม่อ่านข้อมูลใบจากชีต** ตอนส่งออก คนที่ได้ URL ไปจึงดึงข้อมูลใบของคนอื่นไม่ได้ ได้แค่ไฟล์ฟอร์มที่มีค่าที่ตัวเองส่งมา
- รับเฉพาะ `qc:<uuid>` ที่ตรงกับ `id` ใน record, ใบทดสอบต้องมีเลขที่ `TEST-…` (และใบจริงห้ามขึ้นต้น `TEST-`) จำกัดขนาดข้อมูล
  (ข้อความ ≤ 200,000 ตัวอักษร, รายการตรวจ ≤ 30, ข้อความต่อช่อง ≤ 5,000) และตรวจชนิดของทุกช่อง
- ข้อความทุกช่องเขียนเป็นข้อความล้วน ค่าที่ขึ้นต้นด้วย `=` ถูกเติม `'` นำหน้า กันการกลายเป็นสูตรที่รันด้วยสิทธิ์เจ้าของสคริปต์
- ใช้ `LockService` กันการส่งพร้อมกันแล้วเกิดแถวซ้ำ
- ถ้า URL รั่ว ให้ Deploy เป็น deployment ใหม่ (URL ใหม่) ลบ deployment เก่า แล้วแก้ URL ใน `modules/qc-sheet.js`

## รูปแบบข้อมูล

`record` สร้างโดย `buildSheetRecord` ใน `modules/qc-model.js` (มี unit test ที่ `scripts/tests/qc-model.test.mjs`)
ฟิลด์แบน: `id, reportNo, isTest, status, statusLabel, result, resultLabel, partNumber, partName, customer, orderNo, code, sampleLabel, lots,
inspector, inspectedAt, approvals{qa,factory,gm}{status,name,date,comment}, remark, items[], ncrNo, updatedAt` วันที่เป็น `YYYY-MM-DD HH:mm` เวลาไทย
