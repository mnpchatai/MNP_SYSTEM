# แผนรื้อดีไซน์ Pilot Web สู่ 36+/40 (พ.ย. 2569)

เป้าหมาย: คะแนน critique ของ `/impeccable` จาก 25/40 (main ที่ #285, 2026-11-03) ไปที่ 36+ ("ยอดเยี่ยม") โดยรักษา token ที่ผู้ใช้เลือกไว้ (Anuphan, พื้น `#f5f4f1`, ป้ายทึบ `--*-strong`, สีโมดูลเป็นจุด) และ RPC/กติกา workflow เดิมทั้งหมด

ความจริงของผลิตภัณฑ์อยู่ใน `PRODUCT.md`. Brief ของแต่ละหน้า (direction contract) อ่านด้วย
`impeccable surface-brief read <target>`:

| หน้า | target | brief เดิมในแชท |
|---|---|---|
| 1 รายละเอียดคำร้อง: ตัดสินใจก่อน | `src/app/(app)/requests/[id]/page.tsx` (related `app.js`) | การ์ดเดียว + แถบตัดสินใจติดล่าง + ใบเสร็จ/เลิกทำ 5 วิ/ถัดไป |
| 2 หน้าหลัก = คิวเดียว ตัดสินได้ในที่ | `src/app/(app)/page.tsx` (related `app.js`) | ยุบ `#/approvals`, ขยายในที่, master-detail บน desktop, คีย์ J/K/A/R |
| 3 ฟอร์ม 3 ขั้น + ไอคอนประจำประเภท | `src/components/request-form.tsx` (related `modules/module-mt.js`, `app.js`) | ร่างอัตโนมัติ, validation ไทย, ตัวเลือกวันที่ของแอป, ใบเสร็จหลังส่ง |
| 4 RubberFlow/BOM เข้า shell เดียวกัน | `modules/module-rubberflow.js` (related `modules/bom-pages.js`, `modules/module-bom.js`) | nav 4 กลุ่ม, เลิก teal/emoji/gradient, คง store และกราฟ |

## คะแนนเป้าหมายรายข้อ

| # | Heuristic | 25 ตอนนี้ | เป้า | ได้จาก PR |
|---|---|---|---|---|
| 1 เห็นสถานะ | 3 | 4 | B1, B2 |
| 2 ภาษาผู้ใช้ | 3 | 4 | A2, C1, C2 |
| 3 ควบคุมได้ | 3 | 4 | B1 (เลิกทำ), C1 (ร่าง) |
| 4 สม่ำเสมอ | 2 | 3 | A2, A3, B2, D1 |
| 5 ป้องกันผิดพลาด | 2 | 4 | B1, C1 |
| 6 จำได้ | 3 | 4 | B2, C1b |
| 7 ยืดหยุ่น | 3 | 4 | B2 |
| 8 เรียบง่าย | 2 | 4 | B1, B2, C1b |
| 9 ฟื้นจากผิดพลาด | 2 | 4 | B1, C1 |
| 10 ความช่วยเหลือ | 2 | 3 | B2 (คำใบ้คีย์ลัด, อธิบาย "ขอข้อมูลเพิ่ม") |
| รวม | 25 | 37 | |

## ลำดับ PR และโมเดลที่ใช้

กติกาจาก `CLAUDE.md`: ห้ามแก้ `index.html` / `app.js` / `styles.css` / `package.json` ขนานกัน; ทุก PR ที่แก้ไฟล์ Pilot (รวม `modules/`) ต้องเลื่อน `?v=` ใน `index.html` จึง **PR ฝั่ง Pilot ทุกใบต้องเรียงทีละใบ** งานที่ขนานได้จริงคือ harness, ฐานข้อมูล, Next.js (`src/`) และงานที่ไม่ส่งไฟล์ (บทเรียนจาก #288 ที่ชนกับ #287 ที่ `package.json`); ทุก PR ผ่าน `typecheck`/`lint`/`build`, commit แล้ว `auditor` 1 รอบ; ผู้ใช้ลองบน harness (`npm run pilot:harness`, `/pilot-shell.html`) ก่อน merge; PR ที่มี migration ต้องขออนุมัติ apply ก่อน merge

| ลำดับ | PR | ไฟล์หลัก | โมเดล | ขึ้นกับ |
|---|---|---|---|---|
| A1 | Harness: mock เปลี่ยนสถานะหลังตัดสิน/bulk, `?id=q2` แยกใบ, ตัวเลือกแผนกและเครื่องในฟอร์ม MT มีข้อมูล, ใบของฉัน/งานซ่อมในคิว | `scripts/pilot-harness.mjs` | Opus | — (ขนานกับ A2, E1) |
| A2 | Token: ปุ่มทึบธีมมืดใช้ `--*-strong`, `.nav-count`, placeholder ≥4.5:1, คำบรรยาย tile ≥4.5:1, ค่าเริ่มต้นธีมตาม OS เมื่อไม่มีค่าเก็บไว้, แถบสีข้าง `.request-summary::before`/ไทม์ไลน์ → จุด/ป้าย | `styles.css`, `app.js` (applyTheme) | Opus | — |
| A3 | ไอคอน: 7 ไอคอนประเภทเข้า `uiIcon()`, แทน glyph ใน `requestFact`, emoji ใน RubberFlow/BOM, gradient หัว LAB/QC, spinner ปุ่มนอกฟอร์ม MT/QC | `app.js`, `modules/*`, `styles.css` | Opus | A2 |
| B1 | หน้า 1 รายละเอียดคำร้อง (Pilot + Next.js) | `app.js`, `styles.css`, `src/app/(app)/requests/[id]/page.tsx`, component แถบตัดสินใจ | **Fable** | A1, A2 |
| B2 | หน้า 2 หน้าหลัก/คิว (Pilot + Next.js) + คำใบ้คีย์ลัด + อธิบาย "ขอข้อมูลเพิ่ม" | `app.js`, `styles.css`, `index.html`, `src/app/(app)/page.tsx`, `approvals/` | **Fable** | B1 |
| C1a | ฟอร์ม MT 3 ขั้น + component ใหม่: ตัวเลือกวันที่ไทย, ปุ่มถ่ายรูป/เลือกไฟล์, ร่างอัตโนมัติ, validation ไทย | `modules/module-mt.js`, `modules/date-picker.js`, `modules/form-draft.js`, `modules/form-steps.js` | Opus (brief จาก Fable) | A3; ขนานกับ B1 ได้ (ไม่แตะ `app.js`) |
| C1b | `#/new` เป็นรายการแถว + ไอคอน/เลขฟอร์มบนการ์ดทุกที่ | `app.js`, `styles.css` | **Fable** | B2, C1a |
| C2 | โมดูลอื่นใช้ 3–4 ขั้น (NCR, IT, MG, MANAGEMENT, QC) | `modules/module-*.js` | Opus | C1a |
| C3 | Next.js `request-form.tsx` 3 ขั้นบนมือถือ | `src/components/request-form.tsx` | Opus | C1a |
| D1 | หน้า 4 RubberFlow/BOM เข้า shell | `modules/module-rubberflow.js`, `modules/bom-pages.js`, `modules/module-bom.js`, `styles.css` | Opus (brief จาก Fable) | A3, C1b (ต่อคิว `styles.css`) |
| E1 | ตรวจ/บังคับ audit record ของ bulk approve ที่ RPC + เทสต์ | `supabase/migrations/`, `supabase/tests/database/` | Opus + `auditor` model opus | — (ขนานได้ทุกเวลา; รอผู้ใช้อนุมัติ migration) |
| F | `/impeccable critique` ซ้ำ แล้ว `/impeccable polish` ตามผล | — | **Fable** | ทั้งหมด |

สถานะ 2026-11-03: A1 (#287), A2 (#288), E1 (#286) merge แล้ว

ลำดับฝั่ง Pilot (เรียงทีละใบ): B1 → A3 → B2 → C1a → C1b → C2 → D1 → F. งานที่ขนานกับลำดับนี้ได้: C3 และส่วน Next.js ของ B1/B2 (`src/` เท่านั้น), งานฐานข้อมูล

## จุดสลับโมเดล

1. ~~A1, A2, E1 ด้วย Opus~~ เสร็จแล้ว
2. **B1** (Fable ตามแผน): ฝั่ง Pilot ก่อน; ส่วน Next.js ของ B1 แยก PR ให้ Opus ทำขนานได้เพราะแตะแค่ `src/`
3. **B1 merge แล้ว**: Opus ทำ A3 (ไอคอนใน `uiIcon()`, emoji ในโมดูล, gradient หัว LAB/QC)
4. **A3 merge แล้ว**: Fable ทำ B2 (Pilot); Opus ทำ Next.js ของ B2 ขนาน
5. **B2 merge แล้ว**: Opus ทำ C1a; ต่อด้วย Fable ทำ C1b; Opus ทำ C2 แล้ว D1; C3 ขนานได้ตลอด
6. **ทุกอย่าง merge**: Fable รัน F

## ยังไม่ตัดสิน
- รูปแบบ "ส่งเลย" ตอนปิดหน้าในช่วงเลิกทำ 5 วิ (pagehide + keepalive) ให้ B1 ตัดสินและบันทึกใน PR
- การบังคับเหตุผลในเส้นทาง bulk (E1 ตรวจก่อน)
- ภาษาที่สอง (นอกขอบเขตรอบนี้ แต่ไอคอนประเภทออกแบบเผื่อไว้)
