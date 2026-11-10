// แดชบอร์ด MT/NCR: คำอธิบายวิธีนับใต้หัวการ์ดพับไว้ใน "วิธีนับ" การ์ดจึงเริ่มด้วยชื่อและตัวเลข ไม่ใช่ย่อหน้า
// ย่อหน้าที่เป็นข้อมูลของการ์ด (class="nd-keep" เช่น ยอดรวม จำนวนใบ) ไม่พับ
// หัวการ์ดที่พับได้ต้องเป็น <div class="nd-head"><h2>…</h2><p>…</p> ติดกัน ชื่อและย่อหน้าไม่ข้ามแท็กปิดของตัวเอง
// หัวการ์ดแบบอื่นจึงไม่ถูกแตะ (ทดสอบใน scripts/tests/dashboard-notes.test.mjs)
(function (root) {
  "use strict";

  const PATTERN = /<div class="nd-head"><h2>((?:(?!<\/h2>)[\s\S])*)<\/h2><p( class="[^"]*")?>((?:(?!<\/p>)[\s\S])*)<\/p>/g;

  function fold(html) {
    return String(html).replace(PATTERN, (match, title, cls = "", note) => (/\bnd-keep\b/.test(cls)
      ? match
      : `<div class="nd-head"><h2>${title}</h2><details class="nd-about"><summary>วิธีนับ</summary><p${cls}>${note}</p></details>`));
  }

  root.MNP_DASHBOARD_NOTES = Object.freeze({ fold });
})(typeof window !== "undefined" ? window : globalThis);
