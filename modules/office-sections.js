// ระบบสำนักงาน — รายการระบบ หน้าเลือกระบบ และหน้าของ IT SUPPORT เป็น HTML ล้วน ไม่มี DOM/Supabase
// เทสต์ที่ scripts/tests/office-menu.test.mjs · การเชื่อมต่อ (เมนู สิทธิ์ ดึงข้อมูล) อยู่ที่ modules/module-office.js
//
// โครง 2 ชั้นใต้ #/office (path เดียว เหมือน MNP LAB ใต้ #/lab):
//   #/office                    = หน้าเลือกระบบ: IT SUPPORT · HR (HR ยังไม่เปิด การ์ดไม่เป็นลิงก์)
//   #/office?module=it-support  = IT SUPPORT: ใบแจ้งซ่อม IT (โมดูล itrp) · ใบสั่งงาน IT (ลิงก์ไปหน้าของโมดูล)
//   #/office?module=repair      = ใบแจ้งซ่อม IT (ใบแจ้งซ่อมคอมพิวเตอร์) หน้าจริงอยู่ที่ modules/module-itrp.js · ที่นี่รู้แค่ว่าเป็นหน้าย่อยของ IT SUPPORT และสิทธิ์แผนก (IT_COMPUTER_REPAIR)
//   #/office?module=work-order  = ใบสั่งงาน IT (IT01-FM06) หน้าจริงอยู่ที่ modules/module-itwo.js · ที่นี่รู้แค่ว่าเป็นหน้าย่อยของ IT SUPPORT และสิทธิ์แผนก (IT_WORK_ORDER)
//   #/office?module=assets      = ทะเบียนอุปกรณ์ IT (โมดูล itas) หน้าจริงอยู่ที่ modules/module-itas.js · การ์ดแสดงเฉพาะผู้อยู่ใน allowlist ของโมดูล (app_itas_my_access) รหัสโมดูลคือ IT_ASSET_REGISTER
//   #/office?module=hr          = หน้า "ระบบกำลังพัฒนา" (เปิดได้จาก URL ตรง ๆ เท่านั้น)
//
// สิทธิ์แผนก: ทุกการ์ดมีรหัสโมดูลของตัวเอง และกรองด้วย allowed(code) (= deptModuleAllowed ของ app.js ซึ่งอ่านรายการที่อนุญาตจาก department-access.js)
// ระบบที่มีการ์ดลูก (IT SUPPORT) แสดงเมื่อมีการ์ดลูกอย่างน้อย 1 ใบที่ผู้ใช้เห็น · ไม่มีระบบเหลือเลย = ไม่แสดงเมนู "ระบบสำนักงาน"
// เป็น UX ล้วน สิทธิ์จริงยังตัดสินที่ฐานข้อมูล
//
// โมดูลใหม่ในระบบสำนักงาน "ประกาศ" ตัวเองเพื่อให้การ์ดแสดงเลขเวอร์ชันและจำนวนงานค้างเหมือนกันทุกโมดูล (ไม่ประกาศ = การ์ดไม่แสดงป้ายเหล่านี้):
//   1) เพิ่มการ์ดใน IT_SUPPORT_CARDS ด้วยรหัสโมดูล (code) ของตัวเอง
//   2) ในไฟล์โมดูล: (window.MNP_OFFICE_CARDS ??= {})[<code>] = { version: "1.03", loadCardSummary }
//        version = เลขเวอร์ชันของโมดูล แสดงเป็นป้าย V1.03 มุมบนขวาของการ์ด
//        loadCardSummary() = async คืน { openCount, badge, title } หรือ null/ throw ถ้าอ่านไม่ได้ (ไม่ต้องมีก็ได้)
//          openCount = จำนวนเอกสารที่ผู้ใช้เห็นและยังไม่จบ (number) · null = นับไม่ได้ การ์ดแสดง "ดูสถานะ" แทน ไม่ทำให้หน้าล้ม
//          badge = ป้ายรอง เช่น "2 รอคุณ" (ว่างได้) · title = คำอธิบายตัวเลข (tooltip)
//   module-office.js อ่านตัวประกาศนี้แล้วส่งให้ itSupportPage({ modules }) · ใบแจ้งซ่อม IT (IT_COMPUTER_REPAIR) และใบสั่งงาน IT (IT_WORK_ORDER) ประกาศตัวเองแล้วทั้งคู่
//   (โมดูล IT_REPAIR เดิมของคำร้องกลางยังอยู่ แต่ไม่มีการ์ดชี้ไปแล้ว)
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
  // ใบแจ้งซ่อม IT (ใบแจ้งซ่อมคอมพิวเตอร์ itrp) เป็นหน้าย่อยของ IT SUPPORT เช่นกัน · สิทธิ์ดูจากรหัสโมดูล IT_COMPUTER_REPAIR (แผนก ID เห็นการ์ดนี้ ดู department-access.js)
  const REPAIR = "repair";
  const REPAIR_CODE = "IT_COMPUTER_REPAIR";
  // ทะเบียนอุปกรณ์ IT (itas): สิทธิ์ตัดสินที่ฐานข้อมูล (allowlist เฉพาะผู้ดูแลงาน IT) การ์ดจึงขึ้นเมื่อ module-office.js ตรวจ app_itas_my_access แล้วเท่านั้น (ดู modeAllowed) · รหัสนี้ไม่อยู่ในรายการอนุญาตของแผนกที่จำกัดโมดูล (แผนก ID ไม่เห็น)
  const ASSETS = "assets";
  const ASSET_CODE = "IT_ASSET_REGISTER";
  const ALLOW_ALL = () => true;
  const DEV_LABEL = "กำลังพัฒนา";
  // code = รหัสโมดูลที่ใช้ตัดสินสิทธิ์แผนก · ระบบที่มี cards ไม่มี code ของตัวเอง ดูจากการ์ดลูก
  // palette = ชื่อจานสี (data-module ใน styles.css) ใช้จานสีที่มีอยู่แล้วทั้งหมด: IT = "it" เหมือนใบแจ้งซ่อม IT · HR = "pk" (ชุดเดียวกับคำร้อง HR)
  // การ์ดภายใน IT SUPPORT · key ของการ์ดตรงกับค่า ?module= ของหน้าย่อย (repair / work-order)
  // IT_COMPUTER_REPAIR = ใบแจ้งซ่อม IT (ใบแจ้งซ่อมคอมพิวเตอร์ แทนการพาไปหน้าคำร้อง IT_REPAIR เดิม) อยู่ในรายการอนุญาตของแผนก ID
  // IT_WORK_ORDER = ใบสั่งงาน IT (ย้ายมาจากระบบ Work-Order เดิม) ยังไม่อยู่ในรายการอนุญาตของแผนกที่จำกัดโมดูลใด ๆ (แผนก ID จึงไม่เห็นการ์ดนี้)
  const IT_SUPPORT_CARDS = Object.freeze([
    { key: "repair", label: "ใบแจ้งซ่อม IT", palette: "it", icon: "monitor", open: true, code: "IT_COMPUTER_REPAIR", action: "แจ้งซ่อมและติดตามใบแจ้งซ่อม →" },
    { key: "work-order", label: "ใบสั่งงาน IT", palette: "it", icon: "clipboard-check", open: true, code: "IT_WORK_ORDER", action: "แจ้งงานและติดตามใบสั่งงาน →" },
    { key: "assets", label: "ทะเบียนอุปกรณ์ IT", palette: "it", icon: "box", open: true, code: "IT_ASSET_REGISTER", action: "ดูและบันทึกทะเบียนอุปกรณ์ →" },
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
    if (key === WORK_ORDER || key === REPAIR || key === ASSETS) return key;
    return find(key)?.key ?? null;
  }
  const workOrderVisible = (allowed = ALLOW_ALL) => Boolean(allowed(WORK_ORDER_CODE));
  const repairVisible = (allowed = ALLOW_ALL) => Boolean(allowed(REPAIR_CODE));
  const assetsVisible = (allowed = ALLOW_ALL) => Boolean(allowed(ASSET_CODE));

  function sectionUrl(key) {
    if (key === WORK_ORDER || key === REPAIR || key === ASSETS) return `#/office?module=${key}`;
    const section = find(key);
    return section ? `#/office?module=${encodeURIComponent(section.key)}` : "#/office";
  }

  // การ์ดที่เปิดแล้วเป็นลิงก์ ส่วนที่ยังไม่เปิดเป็นการ์ดเฉย ๆ บอกสถานะครั้งเดียวที่มุมขวาบน (ไม่ใส่ aria-disabled เพราะไม่ใช่ตัวควบคุม)
  // badge ของการ์ดที่เปิดแล้ว (เช่น "2 ยังไม่จบ") อยู่ช่องเดียวกัน · badge2 = ป้ายรอง (เช่น "1 รอคุณ") ต่อใต้ป้ายหลัก
  // version = เลขเวอร์ชันของโมดูลที่การ์ดพาไป (เช่น "1.03") แสดงเป็นป้าย "V1.03" ที่มุมขวาของการ์ด ใต้ป้ายตัวเลข (ป้ายตัวเลขอยู่ตำแหน่งเดียวกันทุกการ์ด) · ไม่ระบุ = ไม่แสดง (โมดูลที่ไม่ประกาศเลขของตัวเอง)
  // ป้ายทุกใบเป็นพื้นทึบ/กึ่งทึบตัวอ่านออก (ใช้ --mod-pill / --mod-btn ที่ตรวจ contrast ทุกจานสีทั้งสองธีมใน color-system.test.mjs)
  // inDevelopment = ป้าย "กำลังพัฒนา" บนบนสุดของคอลัมน์ป้าย (เหนือเลขงานค้างและเลขเวอร์ชัน ไม่ทับกัน) · เป็นข้อความอย่างเดียว การ์ดยังเป็นลิงก์กดได้ตามปกติ
  function cardHtml({ href, label, palette, icon, action, badge, badge2 = "", version = "", title = "", inDevelopment = false }) {
    const mark = `<span class="type-card-badge">${iconOf(icon)}</span>`;
    const watermark = `<span class="type-card-wm" aria-hidden="true">${iconOf(icon)}</span>`;
    const badgeHtml = badge ? `<span class="request-type-count">${esc(badge)}</span>` : "";
    const badge2Html = badge2 ? `<span class="request-type-count request-type-count-2">${esc(badge2)}</span>` : "";
    const versionHtml = version ? `<span class="request-type-version" title="เวอร์ชัน ${esc(version)}">V${esc(version)}</span>` : "";
    // มีป้ายรองหรือเลขเวอร์ชัน: ห่อป้ายเป็นคอลัมน์ชิดขวา (ป้ายหลัก ป้ายรอง เลขเวอร์ชัน) · ไม่มี: โครงเดิมทุกประการ
    const devHtml = inDevelopment ? `<span class="request-type-count request-type-dev">${DEV_LABEL}</span>` : "";
    const side = devHtml || badge2Html || versionHtml ? `<span class="request-type-side">${devHtml}${badgeHtml}${badge2Html}${versionHtml}</span>` : badgeHtml;
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

  // ป้ายหลักของการ์ด: จำนวนเอกสารที่ยังไม่จบ · นับไม่ได้ = "ดูสถานะ" (ไม่แสดงเลขที่ไม่แน่ใจ)
  const openBadge = (openCount) => (Number.isFinite(openCount) ? `${openCount} ยังไม่จบ` : "ดูสถานะ");

  // หน้าของ IT SUPPORT · การ์ดที่แผนกไม่มีสิทธิ์ไม่แสดง (กรองด้วย allowed)
  // modules = { <รหัสโมดูลของการ์ด>: { version, openCount, waiting, title } } ข้อมูลจากโมดูลที่ประกาศตัวเองไว้ (แต่ละโมดูลนับแยกกัน) · การ์ดที่ไม่มีรายการใน modules ไม่แสดงป้ายใด ๆ
  //   inDevelopment = true แสดงป้าย "กำลังพัฒนา" บนการ์ด (ยังกดเข้าได้) · version = เลขเวอร์ชัน (ป้าย V…) · openCount: number = "N ยังไม่จบ" · null = นับไม่ได้ ("ดูสถานะ") · undefined = โมดูลไม่นับ (ไม่แสดงป้ายหลัก)
  //   waiting = ป้ายรอง เช่น "1 รอคุณ" (ว่าง = ไม่มี) · title = คำอธิบายตัวเลขเมื่อชี้การ์ด · การ์ดเป็นลิงก์เสมอเมื่อแผนกมีสิทธิ์
  function itSupportPage({ modules = {}, allowed = ALLOW_ALL } = {}) {
    const cards = visibleCards(allowed).map((card) => {
      const declared = modules?.[card.code];
      return cardHtml({
        href: card.open ? sectionUrl(card.key) : "", label: card.label, palette: card.palette, icon: card.icon, action: card.action,
        badge: declared && declared.openCount !== undefined ? openBadge(declared.openCount) : card.badge,
        badge2: declared?.waiting || "", version: declared?.version, title: declared?.title ?? "", inDevelopment: Boolean(declared?.inDevelopment),
      });
    });
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

  const api = { SECTIONS, IT_SUPPORT_CARDS, HOME, WORK_ORDER, WORK_ORDER_CODE, workOrderVisible, REPAIR, REPAIR_CODE, repairVisible, ASSETS, ASSET_CODE, assetsVisible, visibleCards, sectionVisible, visibleSections, hasVisibleSection, readSection, sectionUrl, chooserPage, moduleHead, itSupportPage, notReadyPage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MNP_OFFICE_SECTIONS = api;
})(typeof window !== "undefined" ? window : globalThis);
