# ดาวน์โหลดใบคำร้องถึงฝ่ายบริหารเป็น Excel (แบบฟอร์ม PP01-FM08)

Web App ของ Google Apps Script ที่ทำไฟล์ `.xlsx` ตามแบบฟอร์มในชีต **"เอกสาร"** ของสเปรดชีตใบคำร้องถึงฝ่ายบริหาร
ให้ปุ่ม **"ดาวน์โหลด Excel"** ในหน้ารายละเอียดใบคำร้องถึงฝ่ายบริหารของ Pilot Web

## โปรเจกต์ Apps Script ทั้งหมดของเอกสาร (แยกกัน พังทีละตัว)

| โปรเจกต์ | ผูกกับ | หน้าที่ | โค้ดใน repo |
|---|---|---|---|
| ของชีตระบบแจ้งซ่อม | สเปรดชีต MT | ซิงก์ใบแจ้งซ่อม + พิมพ์เลขที่ที่ AG4 | `apps-script/maintenance-backup/` |
| ของชีตใบคำร้องถึงฝ่ายบริหาร | สเปรดชีต MG | ซิงก์ใบบริหาร + พิมพ์เลขที่ที่ AD3 | `apps-script/management-backup/` |
| Export MT | ไม่ผูก | ไฟล์ Excel ของใบ MT | `apps-script/mt-form-export/` |
| **Export MG (โปรเจกต์นี้)** | ไม่ผูก | ไฟล์ Excel ของใบบริหาร | `apps-script/mg-form-export/` |

- หน้าเว็บส่ง "แถว" รูปแบบเดียวกับชีต "ใบคำร้องถึงฝ่ายบริหาร" จากข้อมูลที่ผู้ดูเห็นอยู่แล้ว (ตามสิทธิ์ RLS)
- โปรเจกต์นี้คัดลอกชีต "เอกสาร" ไปไฟล์ชั่วคราว เติมด้วย `ffWrite_` ของ FormFill.gs (ตัวเดียวกับบนชีต) แปลงช่องติ๊กเป็น ☑/☐
  export `.xlsx` แล้วลบไฟล์ชั่วคราว **ไม่อ่านข้อมูลใบจากชีต และไม่เขียนอะไรลงชีต** (ยกเว้นบันทึก error)
- ถ้าโปรเจกต์นี้พัง กระทบแค่ปุ่มดาวน์โหลดของใบบริหาร การซิงก์และการพิมพ์เลขที่ที่ AD3 ทำงานตามปกติ

## ติดตั้ง (ครั้งแรก)

> ⚠️ **ต้องเป็นโปรเจกต์ใหม่ที่ script.google.com > New project** ห้ามวางในโปรเจกต์ของชีตบริหาร (มี `doPost` ของการซิงก์อยู่แล้ว
> วางทับแล้วซิงก์พัง) และห้ามวางในโปรเจกต์ Export MT

1. <https://script.google.com> > **New project** > คลิกชื่อ "Untitled project" ตั้งชื่อ **Export ใบคำร้องถึงฝ่ายบริหาร**
2. ไฟล์ `Code.gs`: ลบโค้ดเริ่มต้น วางเนื้อหา `apps-script/mg-form-export/Code.gs` > Save
3. กด **+ > Script** ตั้งชื่อ `FormFill` วางเนื้อหา `apps-script/management-backup/FormFill.gs` > Save
4. ⚙️ **Project Settings** > ติ๊ก **Show "appsscript.json" manifest file in editor** > เปิด `appsscript.json`
   วางเนื้อหา `apps-script/mg-form-export/appsscript.json` ทับ > Save
5. ⚙️ **Project Settings** > **Script properties** > Add: `TEMPLATE_SHEET_ID` = รหัสสเปรดชีตใบคำร้องถึงฝ่ายบริหาร
   (ข้อความระหว่าง `/d/` กับ `/edit` ใน URL ของชีต)
6. เลือกฟังก์ชัน **`authorize`** > **Run** > อนุญาตทุกสิทธิ์ (ใน log ต้องขึ้น `authorize: สิทธิ์ครบแล้ว`)
7. **Deploy > New deployment** > ประเภท **Web app** > Execute as: **Me** > Who has access: **Anyone** > Deploy
8. คัดลอก URL (`https://script.google.com/macros/s/.../exec`) ไปใส่ `MG_EXPORT_URL` ใน `modules/mt-form-export.js`
   (เปิด pull request ตามปกติ) — ถ้า `MG_EXPORT_URL` ว่าง ปุ่มของใบบริหารจะไม่แสดง

ทดสอบ: เปิด URL `.../exec` ในเบราว์เซอร์ต้องเห็น `{"ok":false,"error":"USE_POST"}` แล้วกดดาวน์โหลดจากใบบริหารในเว็บ

## อัปเดตโค้ด

วาง `Code.gs` ใหม่ทับ (และ `FormFill` ถ้า FormFill.gs ใน repo เปลี่ยน) > **Deploy > Manage deployments** > ดินสอ > **New version**
ถ้าแก้ `apps-script/management-backup/FormFill.gs` ต้องวางทั้งในโปรเจกต์ของชีตบริหารและโปรเจกต์นี้

## ถ้ากดแล้วขึ้นข้อความผิดพลาด

ข้อความเต็มของ error อยู่ในชีต **"บันทึกข้อผิดพลาด"** ของสเปรดชีตใบคำร้องถึงฝ่ายบริหาร (บริบท `mg-form-export:…`)

| รหัสในหน้าเว็บ | สาเหตุที่พบบ่อย |
|---|---|
| `FORMFILL_MISSING` | ยังไม่ได้เพิ่มไฟล์ `FormFill` ในโปรเจกต์นี้ |
| `NOT_CONFIGURED` | ยังไม่ตั้ง Script property `TEMPLATE_SHEET_ID` |
| `FORM_SHEET_NOT_FOUND` | ชีต "เอกสาร" ถูกเปลี่ยนชื่อ หรือ `TEMPLATE_SHEET_ID` ชี้ผิดไฟล์ |
| `FAILED_OPEN` | เปิดสเปรดชีตไม่ได้ (รหัสผิด หรือบัญชีเจ้าของสคริปต์ไม่มีสิทธิ์แก้ไข) |
| `FAILED_COPY` / `FAILED_FILL` | สร้าง/คัดลอก/เติมไฟล์ชั่วคราวไม่ได้ ดูชีต "บันทึกข้อผิดพลาด" |
| `FAILED_EXPORT_…` | ขาดสิทธิ์เรียก URL ภายนอก: ทำขั้น 4 และ 6 ซ้ำ แล้ว Deploy New version |
| `HTTP_…` | Web App ตอบไม่ใช่ JSON เช่นวางโค้ดผิดโปรเจกต์ |
