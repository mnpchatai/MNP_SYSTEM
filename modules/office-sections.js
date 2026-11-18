// ระบบสำนักงาน — รายการระบบ หน้าเลือกระบบ และหน้าของ IT SUPPORT เป็น HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/office-sections.test.mjs · การเชื่อมต่อ (เมนู สิทธิ์ ดึงข้อมูล) อยู่ที่ modules/module-office.js
//
// โครง 2 ชั้นใต้ #/office (path เดียว เหมือน MNP LAB ใต้ #/lab):
//   #/office                    = หน้าเลือกระบบ: IT SUPPORT · HR (HR ยังไม่เปิด การ์ดไม่เป็นลิงก์)
//   #/office?module=it-support  = IT SUPPORT: ใบแจ้งซ่อม IT (พาไปหน้ารายการคำร้องของ IT_REPAIR เดิม) · ใบสั่งงาน IT (กำลังย้ายระบบ ไม่เป็นลิงก์)
//   #/office?module=hr          = หน้า "ระบบกำลังพัฒนา" (เปิดได้จาก URL ตรง ๆ เท่านั้น)
//
// หน้าตาใช้คอมโพเนนต์เดียวกับหน้าเลือกโมดูลของ MNP LAB (modules/lab-sections.js): การ์ดสี .type-card + .lab-module-card
// และหัวโมดูล .request-module-header จึงไม่ต้องเพิ่ม CSS · การ์ดที่ยังไม่เปิดลดความอิ่มสี (.is-off) และไม่เป็นลิงก์
(function (root) {
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ไอคอนจากชุดกลางของ Pilot (modules/ui-icons.js) — โหลดก่อนไฟล์นี้เสมอ (ในเทสต์ Node ตั้ง globalThis.MNP_UI_ICONS ก่อน require ไฟล์นี้)
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";

  const HOME = "home";
  // palette = ชื่อจานสี (data-module ใน styles.css) ใช้จานสีที่มีอยู่แล้วทั้งหมด: IT = "it" เหมือนใบแจ้งซ่อม IT · HR = "pk" (ชุดเดียวกับคำร้อง HR)
  const SECTIONS = Object.freeze([
    { key: "it-support", label: "IT SUPPORT", palette: "it", icon: "settings", open: true, action: "เปิดระบบ →" },
    { key: "hr", label: "HR", palette: "pk", icon: "user", open: false, badge: "ระบบกำลังพัฒนา" },
  ].map((section) => Object.freeze({ ...section })));
  // การ์ดภายใน IT SUPPORT · code = รหัสโมดูลคำร้องที่การ์ดพาไป (ใช้ตัดสินสิทธิ์แผนกและหาประเภทคำร้องในฐานข้อมูล)
  const IT_SUPPORT_CARDS = Object.freeze([
    { key: "repair", label: "ใบแจ้งซ่อม IT", palette: "it", icon: "monitor", open: true, code: "IT_REPAIR", action: "ดูรายการและแจ้งซ่อม →" },
    { key: "work-order", label: "ใบสั่งงาน IT", palette: "it", icon: "clipboard-check", open: false, badge: "กำลังย้ายระบบ" },
  ].map((card) => Object.freeze({ ...card })));

  const find = (key) => SECTIONS.find((section) => section.key === key) ?? null;

  // สถานะว่างใช้ emptyState() ของ app.js (โหลดทีหลัง จึงอ้างตอนเรียกเท่านั้น) เทสต์ใน Node ถอยไปใช้กล่อง .empty เดียวกัน
  const emptyBlock = (text, { hint = "" } = {}) => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);

  // ระบบจาก query string: ไม่ระบุ = หน้าเลือกระบบ · ค่าที่ไม่มีจริง = null (หน้า "ไม่พบ")
  function readSection(params) {
    const key = params?.get?.("module");
    if (key === null || key === undefined || key === "") return HOME;
    return find(key)?.key ?? null;
  }

  function sectionUrl(key) {
    const section = find(key);
    return section ? `#/office?module=${encodeURIComponent(section.key)}` : "#/office";
  }

  // การ์ดที่เปิดแล้วเป็นลิงก์ ส่วนที่ยังไม่เปิดเป็นการ์ดเฉย ๆ บอกสถานะครั้งเดียวที่มุมขวาบน (ไม่ใส่ aria-disabled เพราะไม่ใช่ตัวควบคุม)
  // badge ของการ์ดที่เปิดแล้ว (เช่น "2 ยังไม่จบ") อยู่ช่องเดียวกัน
  function cardHtml({ href, label, palette, icon, action, badge }) {
    const mark = `<span class="type-card-badge">${iconOf(icon)}</span>`;
    const watermark = `<span class="type-card-wm" aria-hidden="true">${iconOf(icon)}</span>`;
    const badgeHtml = badge ? `<span class="request-type-count">${esc(badge)}</span>` : "";
    if (!href) {
      return `<div class="type-card request-type-card lab-module-card is-off" data-module="${palette}">
        <span class="request-type-top">${mark}${badgeHtml}</span>
        <span class="type-card-body"><strong>${esc(label)}</strong></span>
        ${watermark}
      </div>`;
    }
    return `<a class="type-card request-type-card lab-module-card" href="${esc(href)}" data-module="${palette}">
        <span class="request-type-top">${mark}${badgeHtml}</span>
        <span class="type-card-body"><strong>${esc(label)}</strong><small>${esc(action ?? "เปิด →")}</small></span>
        ${watermark}
      </a>`;
  }

  // หน้าแรกของระบบสำนักงาน (#/office): เลือกระบบ — ไม่มีข้อมูลจากฐานข้อมูล ชื่อ "ระบบสำนักงาน" อยู่ที่เมนูข้างแล้ว
  function chooserPage() {
    return `<div class="lab-page">
      <div class="request-type-heading"><h1>เลือกระบบ</h1></div>
      <nav class="type-grid request-type-grid lab-module-grid" aria-label="เมนูระบบสำนักงาน">${SECTIONS.map((section) => cardHtml({
        href: section.open ? sectionUrl(section.key) : "",
        label: section.label, palette: section.palette, icon: section.icon, action: section.action, badge: section.badge,
      })).join("")}</nav>
    </div>`;
  }

  // หัวหน้าของระบบ: ลิงก์ย้อนกลับ + หัวโมดูลสีเดียวกับทุกโมดูล (ชื่อระบบเป็น h1 ที่นี่ที่เดียว) · open: false = สีจาง
  function moduleHead(key, { open = true } = {}) {
    const section = find(key);
    if (!section) return "";
    return `<a class="request-back-link" href="#/office">‹ เลือกระบบ</a>
      <div class="page-heading request-module-header lab-module-header${open ? "" : " is-off"}" data-module="${section.palette}">
        <div class="request-module-title"><span class="type-card-badge">${iconOf(section.icon)}</span><h1>${esc(section.label)}</h1></div>
      </div>`;
  }

  // หน้าของ IT SUPPORT · repair = { href, count } ถ้าผู้ใช้เปิดใบแจ้งซ่อม IT ได้ · null = ไม่แสดงการ์ดนั้น
  // (แผนกที่ไม่มีสิทธิ์ IT_REPAIR หรือฐานข้อมูลปิดประเภทนี้) count = จำนวนใบที่ยังไม่จบ หรือ null ถ้านับไม่ได้
  function itSupportPage({ repair = null } = {}) {
    const cards = IT_SUPPORT_CARDS.filter((card) => card.code !== "IT_REPAIR" || repair).map((card) => cardHtml({
      href: card.code === "IT_REPAIR" ? repair.href : "",
      label: card.label, palette: card.palette, icon: card.icon, action: card.action,
      badge: card.code === "IT_REPAIR" ? (Number.isFinite(repair.count) ? `${repair.count} ยังไม่จบ` : "ดูสถานะ") : card.badge,
    }));
    return `<div class="lab-page">
      ${moduleHead("it-support")}
      <nav class="type-grid request-type-grid lab-module-grid" aria-label="เมนู IT SUPPORT">${cards.join("")}</nav>
    </div>`;
  }

  // ระบบที่ยังไม่เปิด (เข้าจาก URL ตรง ๆ): หน้าคงที่ ไม่มีคำขอไปฐานข้อมูล
  function notReadyPage(key) {
    return `<div class="lab-page">
      ${moduleHead(key, { open: false })}
      <section class="card">${emptyBlock("ระบบกำลังพัฒนา", { hint: "ยังไม่เปิดให้ใช้งาน" })}</section>
    </div>`;
  }

  const api = { SECTIONS, IT_SUPPORT_CARDS, HOME, readSection, sectionUrl, chooserPage, moduleHead, itSupportPage, notReadyPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_OFFICE_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
