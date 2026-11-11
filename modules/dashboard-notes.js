// คำอธิบายที่ไม่ต้องอ่านทุกครั้ง (วิธีนับของการ์ดแดชบอร์ด คำแนะนำของหน้า RubberFlow/BOM ฯลฯ) ใช้ปุ่มไอคอน ⓘ ตัวเดียวกันทุกหน้า:
// ปุ่มอยู่ท้ายหัวข้อ กดแล้วคำอธิบายเปิดใต้หัวข้อ ชื่อปุ่มอยู่ใน aria-label/title จึงไม่มีคำเดิมพิมพ์ซ้ำทุกการ์ด
// ปุ่มเปิด/ปิดด้วยตัวฟังคลิกตัวเดียวที่ document (ไม่ใช่ popup จึงไม่ต้องปิดเมื่อแตะที่อื่น) หน้าที่วาดใหม่เริ่มแบบปิด
// fold(): หัวการ์ดแดชบอร์ด <div class="nd-head"><h2>…</h2><p>…</p> และ <div class="nd-sub"><h3>…</h3><p>…</p> พับย่อหน้าเข้าปุ่ม "วิธีนับ"
// ย่อหน้าที่เป็นข้อมูลของการ์ด (class="nd-keep" เช่น จำนวนใบ) ไม่พับ · ชื่อและย่อหน้าไม่ข้ามแท็กปิดของตัวเอง หัวแบบอื่นจึงไม่ถูกแตะ
// (ทดสอบใน scripts/tests/dashboard-notes.test.mjs)
(function (root) {
  "use strict";

  const PATTERN = /<div class="(nd-head|nd-sub)"><(h2|h3)>((?:(?!<\/h[23]>)[\s\S])*)<\/\2><p( class="[^"]*")?>((?:(?!<\/p>)[\s\S])*)<\/p>/g;
  const INFO_PATH = '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>';
  let seq = 0;

  const attr = (text) => String(text).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()
    .replace(/&(?!(?:amp|lt|gt|quot|#\d+);)/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const infoIcon = () => (root.MNP_UI_ICONS?.icon ? root.MNP_UI_ICONS.icon("info") : `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">${INFO_PATH}</svg>`);

  // คืน { button, body }: วาง button ท้ายหัวข้อ (ใน .note-row) และ body ต่อจากแถวหัวข้อ · label = ชื่อปุ่มที่โปรแกรมอ่านหน้าจออ่าน
  // bodyHtml เป็น HTML ที่ escape แล้ว
  function toggle(label, bodyHtml, { name = "คำอธิบาย" } = {}) {
    seq += 1;
    const id = `note-${seq}`;
    const title = attr(label ? `${name}: ${label}` : name);
    return {
      button: `<button type="button" class="note-toggle" data-note-toggle aria-expanded="false" aria-controls="${id}" aria-label="${title}" title="${attr(name)}">${infoIcon()}</button>`,
      body: `<div class="note-body" id="${id}" hidden>${bodyHtml}</div>`,
    };
  }

  // หัวข้อพร้อมปุ่ม: <tag class="…">ชื่อ</tag> ⓘ แล้วคำอธิบายใต้แถว
  function heading(tag, titleHtml, noteHtml, options = {}) {
    if (!noteHtml) return `<${tag}>${titleHtml}</${tag}>`;
    const note = toggle(titleHtml, noteHtml, options);
    return `<div class="note-row"><${tag}>${titleHtml}</${tag}>${note.button}</div>${note.body}`;
  }

  function fold(html) {
    return String(html).replace(PATTERN, (match, box, tag, title, cls = "", note) => (/\bnd-keep\b/.test(cls)
      ? match
      : `<div class="${box}">${heading(tag, title, `<p${cls}>${note}</p>`, { name: "วิธีนับ" })}`));
  }

  if (typeof document !== "undefined" && !root.__noteToggleBound) {
    root.__noteToggleBound = true;
    document.addEventListener("click", (event) => {
      const button = event.target?.closest?.("[data-note-toggle]");
      if (!button) return;
      const body = document.getElementById(button.getAttribute("aria-controls"));
      if (!body) return;
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      body.hidden = !open;
    });
  }

  const api = Object.freeze({ fold, toggle, heading });
  root.MNP_DASHBOARD_NOTES = api;
  root.MNP_NOTES = api;
})(typeof window !== "undefined" ? window : globalThis);
