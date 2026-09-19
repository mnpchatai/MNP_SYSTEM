# pdf.js (vendored)

`pdf.min.mjs` และ `pdf.worker.min.mjs` คัดลอกมาจาก `pdfjs-dist` เวอร์ชัน **5.4.149**
(ไฟล์ใน `node_modules/pdfjs-dist/build/`) เพื่อให้ pilot web บน GitHub Pages
เรนเดอร์หน้าแรกของ PDF เป็นรูปได้ โดยไม่ต้องมี build step

ไฟล์ต้องเป็น same-origin เพราะ CSP ใน `index.html` กำหนด `default-src 'self'`
(worker ของ pdf.js จึงโหลดจาก CDN ไม่ได้)

วิธีอัปเดตเวอร์ชัน:

```bash
npm install pdfjs-dist@<version>
cp node_modules/pdfjs-dist/build/pdf.min.mjs node_modules/pdfjs-dist/build/pdf.worker.min.mjs vendor/pdfjs/
cp node_modules/pdfjs-dist/LICENSE vendor/pdfjs/LICENSE
```
