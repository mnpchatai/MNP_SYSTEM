# qrcode-generator (vendored)

`qrcode.js` คัดลอกมาจากแพ็กเกจ npm `qrcode-generator` เวอร์ชัน **1.4.4** (เผยแพร่ 2019-09-18, สัญญาอนุญาต MIT, ไฟล์ `qrcode.js` ไม่แก้ไข)
ใช้สร้าง QR บนป้ายล็อตยางเส้นยาวของโมดูล SR (`modules/module-sr.js`) เป็น SVG ในหน้าเว็บ โดยไม่ต้องมี build step และไม่โหลดจาก CDN
(CSP ใน `index.html` กำหนด `script-src 'self'`) ไฟล์ติดตั้งตัวแปร global `qrcode`

วิธีอัปเดตเวอร์ชัน:

```bash
npm pack qrcode-generator@<version>   # แล้วแตก .tgz ในโฟลเดอร์ว่าง
cp package/qrcode.js vendor/qrcode-generator/qrcode.js
```
เลือกเวอร์ชันที่เผยแพร่มาแล้วเกินสองสัปดาห์ และตรวจ LICENSE ในแพ็กเกจว่ายังเป็น MIT
