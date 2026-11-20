// ระบบสำนักงาน — รายการระบบ หน้าเลือกระบบ และหน้าของ IT SUPPORT เป็น HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/office-menu.test.mjs · การเชื่อมต่อ (เมนู สิทธิ์ ดึงข้อมูล) อยู่ที่ modules/module-office.js
//
// โครง 2 ชั้นใต้ #/office (path เดียว เหมือน MNP LAB ใต้ #/lab):
//   #/office                    = หน้าเลือกระบบ: IT SUPPORT · HR (HR ยังไม่เปิด การ์ดไม่เป็นลิงก์)
//   #/office?module=it-support  = IT SUPPORT: ใบแจ้งซ่อม IT (พาไปหน้ารายการคำร้องของ IT_REPAIR เดิม) · ใบสั่งงาน IT (ลิงก์ไปหน้าของโมดูล)
//   #/office?module=work-order  = ใบสั่งงาน IT (IT01-FM06) หน้าจริงอยู่ที่ modules/module-itwo.js · ที่นี่รู้แค่ว่าเป็นหน้าย่อยของ IT SUPPORT และสิทธิ์แผนก (IT_WORK_ORDER)
//   #/office?module=hr          = หน้า "ระบบกำลังพัฒนา" (เปิดได้จาก URL ตรง ๆ เท่านั้น)
//
// สิทธิ์แผนก: ทุกการ์ดมีรหัสโมดูลของตัวเอง และกรองด้วย allowed(code) (= deptModuleAllowed ของ app.js ซึ่งอ่านรายการที่อนุญาตจาก department-access.js)
// ระบบที่มีการ์ดลูก (IT SUPPORT) แสดงเมื่อมีการ์ดลูกอย่างน้อย 1 ใบที่ผู้ใช้เห็น · ไม่มีระบบเหลือเลย = ไม่แสดงเมนู "ระบบสำนักงาน"
// เป็น UX ล้วน สิทธิ์จริงยังตัดสินที่ฐานข้อมูล
//
// หน้าตาใช้คอมโพเนนต์เดียวกับหน้าเลือกโมดูลของ MNP LAB (modules/lab-sections.js): การ์ดสี .type-card + .lab-module-card
// และหัวโมดูล .request-module-header จึงไม่ต้องเพิ่ม CSS · การ์ดที่ยังไม่เปิดลดความอิ่มสี (.is-off) และไม่เป็นลิงก์
(function (root) {
  const esc = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  // ไอคอนจากชุดกลางของ Pilot (modules/ui-icons.js) — โหลดก่อนไฟล์นี้เสมอ (ในเทสต์ Node ตั้ง globalThis.MNP_UI_ICONS ก่อน require ไฟล์นี้)
  const iconOf = (name) => root.MNP_UI_ICONS?.icon(name) ?? "";

  const HOME = "home";
  // หน้าย่อยของ IT SUPPORT (ไม่อยู่ใน SECTIONS เพราะไม่ใช่การ์ดในหน้าเลือกระบบ) · สิทธิ์ดูจากรหัสโมดูล IT_WORK_ORDER
  const WORK_ORDER = "work-order";
  const WORK_ORDER_CODE = "IT_WORK_ORDER";
  const ALLOW_ALL = () => true;
  // code = รหัสโมดูลที่ใช้ตัดสินสิทธิ์แผนก · ระบบที่มี cards ไม่มี code ของตัวเอง ดูจากการ์ดลูก
  // palette = ชื่อจานสี (data-module ใน styles.css) ใช้จานสีที่มีอยู่แล้วทั้งหมด: IT = "it" เหมือนใบแจ้งซ่อม IT · HR = "pk" (ชุดเดียวกับคำร้อง HR)
  // การ์ดภายใน IT SUPPORT · IT_REPAIR คือรหัสโมดูลคำร้องที่การ์ดพาไป (ใช้หาประเภทคำร้องในฐานข้อมูลด้วย)
  // IT_WORK_ORDER = ใบสั่งงาน IT (ย้ายมาจากระบบ Work-Order เดิม) ยังไม่อยู่ในรายการอนุญาตของแผนกที่จำกัดโมดูลใด ๆ (แผนก ID จึงไม่เห็นการ์ดนี้)
  const IT_SUPPORT_CARDS = Object.freeze([
    { key: "repair", label: "ใบแจ้งซ่อม IT", palette: "it", icon: "monitor", open: true, code: "IT_REPAIR", action: "ดูรายการและแจ้งซ่อม →" },
    { key: "work-order", label: "ใบสั่งงาน IT", palette: "it", icon: "clipboard-check", open: true, code: "IT_WORK_ORDER", action: "แจ้งงานและติดตามใบสั่งงาน →" },
  ].map((card) => Object.freeze({ ...card })));
  const SECTIONS = Object.freeze([
    { key: "it-support", label: "IT SUPPORT", palette: "it", icon: "wrench", open: true, action: "เปิดระบบ →", cards: IT_SUPPORT_CARDS },
    { key: "hr", label: "HR", palette: "pk", icon: "user", open: false, code: "HR", badge: "ระบบกำลังพัฒนา" },
  ].map((section) => Object.freeze({ ...section })));

  const visibleCards = (allowed = ALLOW_ALL) => IT_SUPPORT_CARDS.filter((card) => allowed(card.code));
  // ระบบที่ผู้ใช้เห็น: มี cards = เห็นเมื่อมีการ์ดลูกที่เห็นอย่างน้อย 1 ใบ · ไม่มี = ตรวจ code ของระบบเอง
  const sectionVisible = (section, allowed = ALLOW_ALL) => (section.cards ? section.cards.some((card) => allowed(card.code)) : allowed(section.code));
  const visibleSections = (allowed = ALLOW_ALL) => SECTIONS.filter((section) => sectionVisible(section, allowed));
  // เมนู "ระบบสำนักงาน" แสดงเมื่อมีระบบให้เห็นอย่างน้อย 1 ระบบ
  const hasVisibleSection = (allowed = ALLOW_ALL) => visibleSections(allowed).length > 0;

  const find = (key) => SECTIONS.find((section) => section.key === key) ?? null;

  // สถานะว่างใช้ emptyState() ของ app.js (โหลดทีหลัง จึงอ้างตอนเรียกเท่านั้น) เทสต์ใน Node ถอยไปใช้กล่อง .empty เดียวกัน
  const emptyBlock = (text, { hint = "" } = {}) => (typeof emptyState === "function"
    ? emptyState(text, { hint })
    : `<div class="empty"><p>${esc(text)}</p>${hint ? `<small>${esc(hint)}</small>` : ""}</div>`);

  // ระบบจาก query string: ไม่ระบุ = หน้าเลือกระบบ · ค่าที่ไม่มีจริง = null (หน้า "ไม่พบ")
  function readSection(params) {
    const key = params?.get?.("module");
    if (key === null || key === undefined || key === "") return HOME;
    if (key === WORK_ORDER) return WORK_ORDER;
    return find(key)?.key ?? null;
  }
  const workOrderVisible = (allowed = ALLOW_ALL) => Boolean(allowed(WORK_ORDER_CODE));

  function sectionUrl(key) {
    if (key === WORK_ORDER) return `#/office?module=${WORK_ORDER}`;
    const section = find(key);
    return section ? `#/office?module=${encodeURIComponent(section.key)}` : "#/office";
  }

  // การ์ดที่เปิดแล้วเป็นลิงก์ ส่วนที่ยังไม่เปิดเป็นการ์ดเฉย ๆ บอกสถานะครั้งเดียวที่มุมขวาบน (ไม่ใส่ aria-disabled เพราะไม่ใช่ตัวควบคุม)
  // badge ของการ์ดที่เปิดแล้ว (เช่น "2 ยังไม่จบ") อยู่ช่องเดียวกัน
  // version = เลขเวอร์ชันของโมดูลที่การ์ดพาไป (เช่น "1.02") แสดงเป็น "V1.02" ที่มุมบนขวาของการ์ด เหนือป้าย badge · ไม่ระบุ = ไม่แสดง (โมดูลที่ไม่ประกาศเลขของตัวเอง)
  function cardHtml({ href, label, palette, icon, action, badge, version = "", title = "" }) {
    const mark = `<span class="type-card-badge">${iconOf(icon)}</span>`;
    const watermark = `<span class="type-card-wm" aria-hidden="true">${iconOf(icon)}</span>`;
    const badgeHtml = badge ? `<span class="request-type-count">${esc(badge)}</span>` : "";
    const versionHtml = version ? `<span class="request-type-version" title="เวอร์ชัน ${esc(version)}">V${esc(version)}</span>` : "";
    // มีเลขเวอร์ชัน: ห่อเลขกับป้ายเป็นคอลัมน์ชิดขวา (เลขอยู่บนสุด) · ไม่มี: โครงเดิมทุกประการ
    const side = versionHtml ? `<span class="request-type-side">${versionHtml}${badgeHtml}</span>` : badgeHtml;
    if (!href) {
      return `<div class="type-card request-type-card lab-module-card is-off" data-module="${palette}">
        <span class="request-type-top">${mark}${side}</span>
        <span class="type-card-body"><strong>${esc(label)}</strong></span>
        ${watermark}
      </div>`;
    }
    return `<a class="type-card request-type-card lab-module-card" href="${esc(href)}" data-module="${palette}"${title ? ` title="${esc(title)}"` : ""}>
        <span class="request-type-top">${mark}${side}</span>
        <span class="type-card-body"><strong>${esc(label)}</strong><small>${esc(action ?? "เปิด →")}</small></span>
        ${watermark}
      </a>`;
  }

  // หน้าแรกของระบบสำนักงาน (#/office): เลือกระบบ — ไม่มีข้อมูลจากฐานข้อมูล ชื่อ "ระบบสำนักงาน" อยู่ที่เมนูข้างแล้ว
  function chooserPage({ allowed = ALLOW_ALL } = {}) {
    return `<div class="lab-page">
      <div class="request-type-heading"><h1>เลือกระบบ</h1></div>
      <nav class="type-grid request-type-grid lab-module-grid" aria-label="เมนูระบบสำนักงาน">${visibleSections(allowed).map((section) => cardHtml({
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
  // workOrder = { badge, title } ตัวเลขงานที่รอผู้ใช้บนการ์ดใบสั่งงาน IT (badge ว่าง/ไม่ระบุ = ไม่มีป้าย) · การ์ดเป็นลิงก์เสมอเมื่อแผนกมีสิทธิ์
  // versions = { <รหัสโมดูลของการ์ด>: "1.02" } เลขเวอร์ชันของโมดูลที่ประกาศไว้ (แต่ละโมดูลนับแยกกัน) · การ์ดที่ไม่มีเลขใน versions ไม่แสดงเลข
  function itSupportPage({ repair = null, workOrder = null, versions = {}, allowed = ALLOW_ALL } = {}) {
    const cards = visibleCards(allowed).filter((card) => card.code !== "IT_REPAIR" || repair).map((card) => (card.code === "IT_REPAIR"
      ? cardHtml({
        href: repair.href, label: card.label, palette: card.palette, icon: card.icon, action: card.action,
        badge: Number.isFinite(repair.count) ? `${repair.count} ยังไม่จบ` : "ดูสถานะ", version: versions?.[card.code],
      })
      : cardHtml({
        href: card.open ? sectionUrl(WORK_ORDER) : "", label: card.label, palette: card.palette, icon: card.icon, action: card.action,
        badge: workOrder?.badge || card.badge, version: versions?.[card.code], title: workOrder?.title ?? "",
      })));
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

  const api = { SECTIONS, IT_SUPPORT_CARDS, HOME, WORK_ORDER, WORK_ORDER_CODE, workOrderVisible, visibleCards, sectionVisible, visibleSections, hasVisibleSection, readSection, sectionUrl, chooserPage, moduleHead, itSupportPage, notReadyPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_OFFICE_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
