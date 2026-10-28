// โมดูลย่อยของ MNP LAB — รายการโมดูล การอ่านจาก URL หน้าเลือกโมดูล และหัวสีของแต่ละโมดูล ข้อความ HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/lab-sections.test.mjs
//
// MNP LAB มี 4 โมดูลตามลำดับนี้: แดชบอร์ด · เปรียบเทียบเคมี · Mooney test report · MDR test report
// ทุกโมดูลอยู่ใต้ #/lab (path เดียว จึงไม่ต้องแก้สิทธิ์ของบัญชี lab-only หรือการไฮไลต์เมนูข้าง): #/lab = หน้าเลือกโมดูล,
// #/lab?module=<key> = หน้าของโมดูล และหน้าวัสดุของ Mooney คือ #/lab?module=mooney&material=<วัสดุ> (ดู lab-mooney-model.js)
// ลิงก์เดิมก่อนแยกโมดูล (#/lab?material=<วัสดุ>) ยังเปิดหน้าวัสดุของ Mooney ได้
//
// หน้าตาใช้หลักเดียวกับหน้าคำร้อง (app.js requestCenterHeader) และคอมโพเนนต์เดียวกัน:
// เลือกโมดูลจากการ์ดสีไล่ระดับ (.type-card) → เข้าโมดูลแล้วหัวหน้าเป็นแถบสีของโมดูลนั้น (.request-module-header) พร้อม "‹ ย้อนกลับ"
// สีของโมดูลบอกว่าอยู่ในโมดูลไหน (การ์ดกับหัวสีเดียวกัน) ทุกสีเทียบตัวอักษรขาวได้ contrast ≥ 4.5:1 ทั้งสีต้นและสีปลาย
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

  // theme: [สีต้น, สีปลาย] — contrast กับตัวอักษรขาว (รวมสีจางของโมดูลที่ยังไม่เปิด) ตรวจในเทสต์ (scripts/tests/lab-sections.test.mjs)
  // action = บรรทัดล่างของการ์ดโมดูลที่เปิดใช้งาน
  const SECTIONS = Object.freeze([
    { key: "dashboard", label: "แดชบอร์ด", theme: ["#4f46e5", "#6d28d9"], action: "ดูภาพรวม →" },
    { key: "chemical", label: "เปรียบเทียบเคมี", theme: ["#047857", "#0f766e"] },
    { key: "mooney", label: "Mooney test report", theme: ["#2563eb", "#1e40af"], action: "ดูผลทดสอบ →" },
    { key: "mdr", label: "MDR test report", theme: ["#c2410c", "#b91c1c"] },
  ].map((section) => Object.freeze({ ...section, theme: Object.freeze(section.theme) })));
  const HOME = "home";

  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const find = (key) => SECTIONS.find((section) => section.key === key) ?? null;
  const gradient = (section) => `linear-gradient(135deg, ${section.theme[0]}, ${section.theme[1]})`;

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
    const style = `background:${gradient(section)}`;
    if (!open) {
      return `<div class="type-card request-type-card lab-module-card is-off" style="${style}">
        <span class="request-type-top">${badge}<span class="request-type-count">ยังไม่เปิดใช้งาน</span></span>
        <span class="type-card-body"><strong>${esc(section.label)}</strong></span>
      </div>`;
    }
    return `<a class="type-card request-type-card lab-module-card" href="${esc(sectionUrl(section.key))}" style="${style}">
        <span class="request-type-top">${badge}</span>
        <span class="type-card-body"><strong>${esc(section.label)}</strong><small>${esc(section.action ?? "เปิดโมดูล →")}</small></span>
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

  // หัวของหน้าโมดูล: ปุ่มย้อนกลับไปหน้าเลือกโมดูล + แถบสีของโมดูล (ชื่อโมดูลเป็น h1 ที่นี่ที่เดียว)
  // แถบกะทัดรัด: ไอคอน + ชื่อเท่านั้น ("MNP LAB" อยู่ที่ breadcrumb แล้ว ไม่มีคำอธิบายที่พูดซ้ำชื่อ) เพื่อคืนพื้นที่ให้ตาราง
  // extra = ส่วนขวาของแถบ เช่น เวลาอ่านชีตกับปุ่มรีเฟรช · open: false = โมดูลที่ยังไม่เปิดใช้งาน (สีจางลง)
  function moduleHead(key, { extra = "", open = true } = {}) {
    const section = find(key);
    if (!section) return "";
    return `<a class="request-back-link" href="#/lab" aria-label="ย้อนกลับไปเลือกโมดูล">‹ ย้อนกลับ</a>
      <div class="page-heading request-module-header lab-module-header${open ? "" : " is-off"}" style="background:${gradient(section)}">
        <div class="request-module-title"><span class="type-card-badge">${ICONS[section.key]}</span><h1>${esc(section.label)}</h1></div>
        ${extra}
      </div>`;
  }

  // ชื่อโมดูลอยู่ที่หัวสีแล้ว ข้อความในหน้าจึงบอกเฉพาะสถานะ
  function notReadyPage(key) {
    return `<div class="lab-page">
      ${moduleHead(key, { open: false })}
      <section class="card"><div class="empty"><h2>ยังไม่เปิดใช้งาน</h2><p>ยังไม่ได้เชื่อมแหล่งข้อมูลของโมดูลนี้</p></div></section>
    </div>`;
  }

  const api = { SECTIONS, HOME, readSection, sectionUrl, chooserPage, moduleHead, notReadyPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_LAB_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
