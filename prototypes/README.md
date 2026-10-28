# ต้นแบบอ้างอิง (prototypes)

โฟลเดอร์นี้เก็บต้นแบบที่ใช้เป็นแบบอ้างอิงตอนย้ายฟีเจอร์เข้าระบบจริง **ไม่ใช่ส่วนของแอป Next.js หรือ Pilot Web**

- ไม่ถูก import จาก `src/`, `app.js` หรือ `modules/` และไม่มีสิทธิ์/ฐานข้อมูลจริง (ข้อมูลทั้งหมดเป็นข้อมูลสมมติ)
- แต่ละต้นแบบมี `package.json` และเครื่องมือของตัวเอง ESLint ของ repo ข้ามโฟลเดอร์นี้ (`eslint.config.mjs`) และ tsconfig ไม่เกี่ยวเพราะไม่มีไฟล์ `.ts`
- repo เป็นสาธารณะ และ GitHub Pages เสิร์ฟไฟล์ source ในโฟลเดอร์นี้ด้วย อย่าใส่ข้อมูลจริง ข้อมูลลูกค้า หรือ credential
- ฟีเจอร์ที่ย้ายเข้าระบบจริงต้องทำตาม AGENTS.md ทุกข้อ (กฎ/สิทธิ์อยู่ที่ฐานข้อมูลผ่าน RPC, migration, เทสต์) เช่น "พารามิเตอร์ + Auto Hold" (#232) ที่ย้ายจาก `rubber-mes`

| ต้นแบบ | คืออะไร | วิธีรัน |
|---|---|---|
| [`rubber-mes/`](rubber-mes/) | RubberFlow MES: ควบคุมการผลิตยาง 4 ขั้น (ผสม → รีด → อบ → ตกแต่ง) FEFO, ชั่ง Poka-Yoke, QC Hold อัตโนมัติ, Gatekeeper ส่งมอบ WIP, NCR/CoA, SPC/Cpk, สืบย้อนกลับ, แม่พิมพ์ — React + Vite เก็บข้อมูลใน localStorage | `cd prototypes/rubber-mes && npm install && npm run dev` (http://localhost:5180) |
