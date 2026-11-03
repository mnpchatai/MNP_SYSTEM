---
version: 1
slug: "modules-module-rubberflow-js"
primary_target: "modules/module-rubberflow.js"
related_targets: ["modules/bom-pages.js","modules/module-bom.js"]
---

# Surface: RubberFlow MES และ BOM รายแผนก เข้า shell เดียวกัน

Scope: `modules/module-rubberflow.js`, `modules/bom-pages.js`, `modules/module-bom.js` (ชั้น render เท่านั้น) + CSS `.rf-*`/`.bom-*` · Mode: Operate · ยืนยันโดยผู้ใช้ 2026-11-03

## Direction contract
THESIS: สองโมดูลนี้คือหน้าของ MNP Workspace ไม่ใช่อีกแอป ปฏิเสธ header gradient teal, แถบ 16 แท็บ, emoji และ grid เลือกบทบาทเต็มหน้า
OWN-WORLD: token ของระบบหลักทั้งหมด (--rf-accent → แบรนด์น้ำเงิน, .badge + --*-strong, uiIcon(), formatDate พ.ศ., ชิป mono แบบ .request-card-no, .table หลัก + การ์ดบนมือถือจาก #284)
STORY: เข้าจากกลุ่ม "ทดสอบ" ในราง nav → เห็นหน้าโมดูลในเปลือกเดียวกับคำร้อง → เลือกบทบาทจำลองจาก select ในหัวข้อ → ใช้ sub-nav 4 กลุ่มไปหน้างาน
FIRST VIEWPORT: ราง nav ซ้าย/เมนูมือถือของระบบหลัก มี "RubberFlow" และ "BOM รายแผนก" ในกลุ่ม "ทดสอบ" (sandbox เท่านั้น) / page-heading ของระบบหลัก: ชื่อโมดูล + select บทบาทจำลอง + ป้าย "โหมดทดสอบ" บรรทัดเดียว / sub-nav: desktop = รายการใต้ชื่อโมดูลในรางซ้าย เปิด/พับได้, มือถือ = แถบชิปเลื่อนข้างใต้หัวข้อ; 4 กลุ่ม (ภาพรวม · ผลิต · คลัง · รายงาน) กลุ่มละ ≤4 / เนื้อหาหน้าเดิม (KPI, ตาราง, กราฟ) ในการ์ดของระบบหลัก
FORM: ผู้ใช้กำหนดเอง (เข้า shell เดียวกัน) ไม่มี seed key
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## คงเดิม
store, กติกา (bom-rules.js), กราฟ KPI, เส้นทาง `#/rubberflow?p=` / `#/bom?p=`, harness `/harness/#/bom` `#/rubberflow`

## States
ยังไม่เลือกบทบาท (select ในหัวข้อ ไม่ใช่หน้าแยก) · ตารางว่าง (emptyState() ของระบบหลัก) · แจ้งเตือน 14 รายการ (ตัวนับใน sub-nav แบบเดียวกับแจ้งเตือนหลัก) · มือถือ 375 ไม่ล้น

## Constraints
แก้เฉพาะ render + CSS · ลิงก์ข้ามโมดูล (BOM → RubberFlow WO) คงเดิม · ตัวเลขและหน่วยในตารางคงรูปแบบเดิม
