// โมดูลย่อยของ MNP LAB — รายการโมดูล การอ่านจาก URL หน้าเลือกโมดูล และหัวสีของแต่ละโมดูล ข้อความ HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-sections.test.mjs
//
// MNP LAB มี 4 โมดูลตามลำดับนี้: แดชบอร์ด · เปรียบเทียบเคมี · รายงานทดสอบ Mooney · รายงานทดสอบ MDR
// ทุกโมดูลอยู่ใต้ #/lab (path เดียว จึงไม่ต้องแก้สิทธิ์ของบัญชี lab-only หรือการไฮไลต์เมนูข้าง): #/lab = หน้าเลือกโมดูล,
// #/lab?module=<key> = หน้าของโมดูล และหน้าวัสดุของ Mooney คือ #/lab?module=mooney&material=<วัสดุ> (ดู lab-mooney-model.js)
// ลิงก์เดิมก่อนแยกโมดูล (#/lab?material=<วัสดุ>) ยังเปิดหน้าวัสดุของ Mooney ได้
//
// หน้าตาใช้หลักเดียวกับหน้าคำร้อง (app.js requestCenterHeader) และคอมโพเนนต์เดียวกัน:
// เลือกโมดูลจากการ์ดสีของโมดูล (.type-card + data-module) → เข้าโมดูลแล้วหัวโมดูลแบบเดียวกับทุกโมดูล (.request-module-header) พร้อม "‹ เลือกโมดูล"
// สีของโมดูลบอกว่าอยู่ในโมดูลไหน (การ์ดกับจุดสีเดียวกัน) ทุกสีเทียบตัวอักษรขาวบนการ์ดได้ contrast ≥ 4.5:1 ทั้งสีต้นและสีปลาย
// โมดูลที่ยังไม่เปิดใช้งานลดความอิ่มสี (CSS saturate คงความสว่าง จึงยังผ่าน 4.5:1)
// และการ์ดของมันไม่เป็นลิงก์ เพราะยังไม่มีอะไรให้เปิด
//
// โมดูลใดเปิดใช้งานแล้ว module-lab.js เป็นผู้ตัดสินที่เดียว (PAGES) แล้วส่ง isOpen มาที่นี่
(function (root) {
  const ICONS = Object.freeze({
    // แผงสรุปหลายช่อง
    dashboard: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`,
    // หลอดทดลองสองหลอดระดับต่างกัน = เปรียบเทียบ
    chemical: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h6M5 3v14a2 2 0 0 0 4 0V3M14 3h6M15 3v14a2 2 0 0 0 4 0V3M5 12h4M15 8h4"/></svg>`,
    // หน้าปัดวัดค่า = ความหนืด Mooney
    mooney: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.3 19a10 10 0 1 1 17.4 0"/><path d="m12 14 4-4"/></svg>`,
    // กราฟแรงบิดตามเวลาที่ขึ้นแล้วคงที่ = กราฟการคงรูปจาก MDR
    mdr: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M6 17c3 0 4-10 8-10h5"/></svg>`,
  });

  // palette = ชื่อจานสี (data-module ใน styles.css) ของโมดูลย่อย contrast ของจานสีตรวจใน scripts/tests/color-system.test.mjs
  // action = บรรทัดล่างของการ์ดโมดูลที่เปิดใช้งาน
  const SECTIONS = Object.freeze([
    { key: "dashboard", label: "แดชบอร์ด", palette: "bom", action: "ดูภาพรวม →" },
    { key: "chemical", label: "เปรียบเทียบเคมี", palette: "gr" },
    { key: "mooney", label: "รายงานทดสอบ Mooney", palette: "it", action: "ดูผลทดสอบ →" },
    { key: "mdr", label: "รายงานทดสอบ MDR", palette: "pt" },
  ].map((section) => Object.freeze({ ...section })));
  const HOME = "home";

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const find = (key) => SECTIONS.find((section) => section.key === key) ?? null;

  // สถานะว่างของหน้า LAB ใช้ emptyState() ของ app.js (app.js โหลดทีหลัง จึงอ้างตอนเรียกเท่านั้น)
  // เทสต์ใน Node ไม่มี app.js จึงถอยไปใช้กล่อง .empty เดียวกันแบบไม่มีไอคอน
  const emptyBlock = (text, { hint = "" } = {}) => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);

  // โมดูลจาก query string: ไม่ระบุ = หน้าเลือกโมดูล (หรือ Mooney ถ้าเป็นลิงก์วัสดุแบบเดิม) ระบุค่าที่ไม่มีจริง = null (หน้า "ไม่พบ")
  function readSection(params) {
    const key = params?.get?.("module");
    if (key === null || key === undefined || key === "") return params?.get?.("material") ? "mooney" : HOME;
    return find(key)?.key ?? null;
  }

  function sectionUrl(key) {
    const section = find(key);
    return section ? `#/lab?module=${encodeURIComponent(section.key)}` : "#/lab";
  }

  // การ์ดของโมดูลที่เปิดใช้งานเป็นลิงก์ ส่วนที่ยังไม่เปิดเป็นการ์ดเฉย ๆ บอกสถานะครั้งเดียวที่มุมขวาบน (ช่องเดียวกับจำนวนงานในหน้าคำร้อง)
  // ไม่ใส่ aria-disabled เพราะไม่ใช่ตัวควบคุม (ใช้กับ div เฉย ๆ ไม่มีความหมาย) ข้อความ "ยังไม่เปิดใช้งาน" บอกสถานะให้โปรแกรมอ่านหน้าจอแล้ว
  function cardHtml(section, open) {
    const badge = `<span class="type-card-badge">${ICONS[section.key]}</span>`;
    if (!open) {
      return `<div class="type-card request-type-card lab-module-card is-off" data-module="${section.palette}">
        <span class="request-type-top">${badge}<span class="request-type-count">ยังไม่เปิดใช้งาน</span></span>
        <span class="type-card-body"><strong>${esc(section.label)}</strong></span>
        <span class="type-card-wm" aria-hidden="true">${ICONS[section.key]}</span>
      </div>`;
    }
    return `<a class="type-card request-type-card lab-module-card" href="${esc(sectionUrl(section.key))}" data-module="${section.palette}">
        <span class="request-type-top">${badge}</span>
        <span class="type-card-body"><strong>${esc(section.label)}</strong><small>${esc(section.action ?? "เปิดโมดูล →")}</small></span>
        <span class="type-card-wm" aria-hidden="true">${ICONS[section.key]}</span>
      </a>`;
  }

  // หน้าแรกของ MNP LAB (#/lab): เลือกโมดูล — ไม่มีข้อมูลผลทดสอบ จึงไม่ต้องเรียกฐานข้อมูล
  // ชื่อ "MNP LAB" อยู่ที่ breadcrumb และเมนูข้างแล้ว หัวหน้าจึงบอกเฉพาะสิ่งที่ทำในหน้านี้
  function chooserPage(isOpen) {
    return `<div class="lab-page">
      <div class="request-type-heading"><h1>เลือกโมดูล</h1></div>
      <nav class="type-grid request-type-grid lab-module-grid" aria-label="โมดูล MNP LAB">${SECTIONS.map((section) => cardHtml(section, isOpen(section.key) === true)).join("")}</nav>
    </div>`;
  }

  // หัวของหน้าโมดูล: ลิงก์ย้อนกลับชื่อหน้าเลือกโมดูล + หัวโมดูลแบบเดียวกับทุกโมดูล (.request-module-header ก้อนสีของโมดูล + ไอคอน)
  // ชื่อโมดูลเป็น h1 ที่นี่ที่เดียว ("MNP LAB" อยู่ที่ breadcrumb แล้ว ไม่มีคำอธิบายที่พูดซ้ำชื่อ) เพื่อคืนพื้นที่ให้ตาราง
  // extra = ส่วนขวาของหัว เช่น เวลาอ่านชีตกับปุ่มรีเฟรช · open: false = โมดูลที่ยังไม่เปิดใช้งาน (สีจางลง)
  function moduleHead(key, { extra = "", open = true } = {}) {
    const section = find(key);
    if (!section) return "";
    return `<a class="request-back-link" href="#/lab">‹ เลือกโมดูล</a>
      <div class="page-heading request-module-header lab-module-header${open ? "" : " is-off"}" data-module="${section.palette}">
        <div class="request-module-title"><span class="type-card-badge">${ICONS[section.key]}</span><h1>${esc(section.label)}</h1></div>
        ${extra}
      </div>`;
  }

  // ชื่อโมดูลอยู่ที่หัวสีแล้ว ข้อความในหน้าจึงบอกเฉพาะสถานะ
  function notReadyPage(key) {
    return `<div class="lab-page">
      ${moduleHead(key, { open: false })}
      <section class="card">${emptyBlock("ยังไม่เปิดใช้งาน", { hint: "ยังไม่ได้เชื่อมแหล่งข้อมูลของโมดูลนี้" })}</section>
    </div>`;
  }

  const api = { SECTIONS, HOME, readSection, sectionUrl, chooserPage, moduleHead, notReadyPage, emptyBlock };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
