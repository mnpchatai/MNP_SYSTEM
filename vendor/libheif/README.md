# libheif-js (vendored)

`libheif.js` คัดลอกมาจาก `libheif-js` เวอร์ชัน **1.23.2** (ไฟล์ `libheif/libheif.js` — build แบบ JavaScript ล้วน
ไม่มี WebAssembly ไม่มี `eval` และไม่ใช้ worker) ใช้ถอดรหัสรูป HEIC/HEIF จากโทรศัพท์ (เช่น iPhone) ในเบราว์เซอร์
ที่ถอดรหัสเองไม่ได้ ก่อนแปลงเป็น JPEG แล้วอัปโหลด โหลดเฉพาะตอนที่ผู้ใช้เลือกรูป HEIC ในเบราว์เซอร์แบบนั้น
(Safari/iOS ถอดรหัสเองได้ จึงไม่โหลดไฟล์นี้) ดู `modules/attachment-image.js`

เลือก build นี้เพราะ CSP ใน `index.html` (`script-src 'self' https://cdn.jsdelivr.net`) ไม่อนุญาต `unsafe-eval`
ซึ่ง `heic2any` ต้องใช้ในตัวถอดรหัส และ build แบบ WebAssembly ต้องเพิ่ม `wasm-unsafe-eval` — build นี้ใช้ได้โดยไม่ต้องผ่อน CSP
ไฟล์ต้องเป็น same-origin ด้วยเหตุผลเดียวกัน

**สัญญาอนุญาต:** libheif และ libheif-js เป็น LGPL-3.0 (ดู `LICENSE.libheif-js` และ `LICENSE.libheif-lgpl`)
ไฟล์นี้ใช้แบบไม่ดัดแปลงและแยกเป็นไฟล์ของตัวเอง สลับเป็นเวอร์ชันอื่นได้โดยแทนที่ไฟล์ตามวิธีด้านล่าง

ฝั่ง Next.js ใช้แพ็กเกจ `libheif-js` จาก npm (รุ่นเดียวกัน) ผ่าน dynamic import ใน
`src/components/attachment-input.tsx` ไม่ได้ใช้ไฟล์ในโฟลเดอร์นี้

วิธีอัปเดตเวอร์ชัน:

```bash
npm install --save-exact libheif-js@<version>
cp node_modules/libheif-js/libheif/libheif.js vendor/libheif/libheif.js
cp node_modules/libheif-js/libheif/LICENSE vendor/libheif/LICENSE.libheif-lgpl
cp node_modules/libheif-js/LICENSE vendor/libheif/LICENSE.libheif-js
```

แล้วเลื่อนเลข `?v=` ใน `index.html` และแก้เลขรุ่นในไฟล์นี้ให้ตรง
