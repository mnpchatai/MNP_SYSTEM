// โมดูล "ฝ่ายโรงงาน" ของ Pilot Web — เปิดเฉพาะโหมดทดสอบของผู้ดูแลระบบ
//
// แผนกในฝ่าย (modules/factory-departments.js): PP วางแผนการผลิต · RB ขึ้นรูปยาง · GR แปรรูปยาง ·
// PT ขึ้นรูปพลาสติก · BG เย็บจักร · PK ประกอบบรรจุภัณฑ์
//
// ขอบเขตตอนนี้: โครงโมดูล หน้าของแต่ละแผนก (#/factory, #/factory?dept=<รหัส>) และเมนู "Item master"
// แบบต้นไม้ (โฟลเดอร์ > รายการ) ในหน้ารวม (modules/factory-item-master.js) กดรายการแล้วยังเป็นหน้าว่างรอกำหนดฟอร์ม
// ยังไม่มีฟอร์ม/ขั้นตอนงานของแผนกใด และ **ไม่อ่าน/เขียนฐานข้อมูลเลย** จึงไม่มี migration/RPC/RLS ใหม่
// และไม่กระทบข้อมูลจริง เมื่อกำหนด workflow ของแผนกแล้วให้เพิ่มตารางพร้อมการแยกข้อมูลทดสอบ
// (ดู private.sandbox_guard_table ใน 20261005030000_admin_sandbox_mode.sql) และเทสต์ใน
// supabase/tests/database/ ก่อนเปิดการบันทึกข้อมูล
//
// เมนูข้างโผล่เฉพาะโหมดทดสอบ (nav.sandboxOnly) และหน้านี้ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// (การซ่อนเมนูอย่างเดียวไม่ใช่การควบคุมสิทธิ์) ไม่มีฝั่ง Next.js เพราะโหมดทดสอบมีเฉพาะ Pilot Web
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, app, shell, bindShell,
// renderNotFound, escapeHtml) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerFactoryModule() {
  const PATH = "factory";
  const TITLE = "ฝ่ายโรงงาน";
  const THEME = ["#475569", "#1e293b"];
  const NAV_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21V10l6 4v-4l6 4V5h4v16H3Z"/><path d="M8 21v-3h2v3M14 21v-3h2v3"/></svg>`;

  const factory = window.MNP_FACTORY;
  const itemMaster = window.MNP_FACTORY_ITEM_MASTER;
  const gradient = ([from, to]) => `linear-gradient(135deg, ${from}, ${to})`;

  const FOLDER_ICON = `<svg class="factory-tree-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z"/></svg>`;
  const DOCUMENT_ICON = `<svg class="factory-tree-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/></svg>`;

  // เมนู Item master: <details> ซ้อนกัน (ตัวนอก = dropdown, ตัวใน = โฟลเดอร์) เปิด/ปิดด้วยการแตะได้ทุกอุปกรณ์รวม iPhone
  // และใช้คีย์บอร์ดได้เองโดยไม่ต้องเขียน ARIA tree เอง รายการแสดงในหน้าเดิม ไม่ใช่ popup ลอย จึงไม่ต้องมีโค้ดปิดตอนแตะนอกกรอบ
  // (ถ้าวันหน้าเปลี่ยนเป็น popup ลอยหรือ combobox ต้องใช้ data-popup/closePopup ตามกติกา AGENTS.md)
  function itemMasterHtml() {
    const folders = itemMaster.FOLDERS.map((folder) => {
      const entries = folder.entries.length
        ? folder.entries.map((entry) => `<li><button type="button" class="factory-entry" data-entry="${escapeHtml(entry.key)}">${DOCUMENT_ICON}<span>${escapeHtml(entry.name)}</span></button></li>`).join("")
        : `<li class="factory-entries-empty">ยังไม่มีรายการในโฟลเดอร์นี้</li>`;
      return `<li><details class="factory-folder"><summary>${FOLDER_ICON}<span>${escapeHtml(folder.name)}</span></summary><ul class="factory-entries">${entries}</ul></details></li>`;
    }).join("");
    return `<section class="card factory-item-card">
        <details class="factory-master" id="factory-item-master">
          <summary>Item master</summary>
          <ul class="factory-tree">${folders}</ul>
          <div id="factory-item-detail" aria-live="polite"></div>
        </details>
      </section>`;
  }

  function entryDetailHtml({ folder, entry }) {
    return `<div class="factory-entry-detail">
        <div class="eyebrow">Item master › ${escapeHtml(folder.name)}</div>
        <h3>${escapeHtml(entry.name)}</h3>
        <p class="muted small">ยังไม่เปิดใช้งาน — โมดูลอยู่ในโหมดทดสอบ รอกำหนดฟอร์มและขั้นตอนของรายการนี้</p>
      </div>`;
  }

  // เปิดโฟลเดอร์หนึ่งแล้วปิดโฟลเดอร์อื่น (เหมือนเมนูตัวอย่าง) และกดรายการเพื่อดูหน้าของรายการนั้น
  // ค่า key ของรายการมาจาก DOM จึงตรวจกับเมนูจริงทุกครั้ง ไม่ตรง = ไม่แสดงอะไร และไม่เอาข้อความจาก DOM ไปใส่ HTML
  function bindItemMaster() {
    const root = document.querySelector("#factory-item-master");
    const detail = document.querySelector("#factory-item-detail");
    if (!root || !detail) return;
    root.querySelectorAll("details.factory-folder").forEach((folder) => folder.addEventListener("toggle", () => {
      if (!folder.open) return;
      root.querySelectorAll("details.factory-folder[open]").forEach((other) => { if (other !== folder) other.open = false; });
    }));
    root.addEventListener("click", (event) => {
      const button = event.target.closest("[data-entry]");
      if (!button || !root.contains(button)) return;
      root.querySelectorAll("[data-entry][aria-current]").forEach((other) => other.removeAttribute("aria-current"));
      const found = itemMaster.findEntry(button.dataset.entry);
      detail.innerHTML = found ? entryDetailHtml(found) : "";
      if (found) button.setAttribute("aria-current", "true");
    });
  }

  function overviewHtml() {
    const cards = factory.DEPARTMENTS.map((department) => `<a class="type-card" href="${escapeHtml(factory.url(department.code))}" style="background:${gradient(department.theme)}">
        <span class="request-type-top"><span class="type-card-badge">${escapeHtml(department.code)}</span></span>
        <span class="type-card-body"><strong>${escapeHtml(department.name)}</strong><small>เปิดแผนก →</small></span>
      </a>`).join("");
    return `<div class="page-heading request-module-header" style="background:${gradient(THEME)}">
        <div class="request-module-title"><span class="type-card-badge">${NAV_ICON}</span><div><div class="eyebrow">โหมดทดสอบ</div><h1>${TITLE}</h1><p>${factory.DEPARTMENTS.length} แผนก · โครงโมดูลสำหรับทดลอง ยังไม่บันทึกข้อมูล</p></div></div>
      </div>
      ${itemMasterHtml()}
      <div class="request-type-heading"><h2>เลือกแผนก</h2></div>
      <nav class="type-grid factory-dept-grid" aria-label="แผนกฝ่ายโรงงาน">${cards}</nav>`;
  }

  function departmentHtml(department) {
    const tabs = factory.DEPARTMENTS.map((item) => `<a class="filter${item.code === department.code ? " active" : ""}" href="${escapeHtml(factory.url(item.code))}"${item.code === department.code ? ` aria-current="page"` : ""}>${escapeHtml(item.code)} ${escapeHtml(item.name)}</a>`).join("");
    return `<a class="request-back-link" href="${escapeHtml(factory.url())}" aria-label="ย้อนกลับไปเลือกแผนก">‹ ย้อนกลับ</a>
      <div class="page-heading request-module-header" style="background:${gradient(department.theme)}">
        <div class="request-module-title"><span class="type-card-badge">${escapeHtml(department.code)}</span><div><div class="eyebrow">${TITLE} · โหมดทดสอบ</div><h1>${escapeHtml(department.name)}</h1><p>แผนก ${escapeHtml(department.code)}</p></div></div>
      </div>
      <nav class="filters" aria-label="สลับแผนกฝ่ายโรงงาน">${tabs}</nav>
      <section class="card">
        <h2>แผนก ${escapeHtml(department.code)} ${escapeHtml(department.name)}</h2>
        <div class="empty">ยังไม่มีแบบฟอร์มหรือขั้นตอนงานของแผนกนี้<br><small>โมดูลอยู่ในโหมดทดสอบ รอกำหนดขั้นตอนงานของแผนกก่อนเปิดให้บันทึกข้อมูล</small></div>
      </section>`;
  }

  async function renderFactory(params) {
    // เมนูข้างโผล่เฉพาะโหมดทดสอบ แต่ URL พิมพ์เข้ามาเองได้ — ผู้ใช้นอกโหมดทดสอบต้องไม่เห็นหน้านี้
    if (!state.employee?.isSandbox) return renderNotFound();
    // dept ที่ไม่รู้จักพากลับหน้ารวม ไม่แสดงหน้าว่างของแผนกที่ไม่มีอยู่
    const department = factory.find(params.get("dept"));
    app.innerHTML = shell(
      department ? departmentHtml(department) : overviewHtml(),
      PATH,
      department ? `${TITLE} / ${department.code} ${department.name}` : TITLE,
    );
    bindShell();
    if (!department) bindItemMaster();
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.FACTORY = {
    code: "FACTORY",
    enabled: true,
    // หน้านี้ไม่แตะฐานข้อมูล จึงปลอดภัยที่จะเปิดในโหมดทดสอบ (โมดูลที่เขียนข้อมูลต้องมี guard ที่ฐานข้อมูลก่อน)
    sandbox: true,
    label: TITLE,
    theme: THEME,
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON, sandboxOnly: true }],
    pages: { [PATH]: renderFactory },
  };
})();
