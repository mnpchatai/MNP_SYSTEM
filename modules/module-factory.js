// โมดูล "ฝ่ายโรงงาน" ของ Pilot Web — เปิดเฉพาะโหมดทดสอบของผู้ดูแลระบบ
//
// แผนกในฝ่าย (modules/factory-departments.js): PP วางแผนการผลิต · RB ขึ้นรูปยาง · GR แปรรูปยาง ·
// PT ขึ้นรูปพลาสติก · BG เย็บจักร · PK ประกอบบรรจุภัณฑ์
//
// ขอบเขตตอนนี้: โครงโมดูล หน้าของแต่ละแผนก (#/factory, #/factory?dept=<รหัส>) และเมนู "Item master"
// แบบต้นไม้ (โฟลเดอร์ > รายการ, modules/factory-item-master.js) ที่เป็นเมนูย่อยในแถบข้าง **ใต้เมนู "ฝ่ายโรงงาน"**
// เมื่อเลือกฝ่ายโรงงานอยู่ (nav.subnav) กดรายการเปิดหน้า #/factory?item=<key> รายการที่มี view (ทะเบียนสินค้า
// BOM Routing คลัง ใบสั่งผลิต) อ่าน/เขียนตาราง factory_* ผ่าน RPC ของ 20261006050000_factory_item_master.sql
// (เปิดเฉพาะโหมดทดสอบ แยกข้อมูลด้วย is_test) รายการที่ไม่มี view เป็นหน้าว่างรอกำหนดฟอร์ม
// สถานะเปิด/ปิดของเมนูย่อยคำนวณจาก URL ทุกครั้งที่วาดหน้า (แถบข้างถูกวาดใหม่ทุกการเปลี่ยนหน้า)
// หน้าแผนกยังไม่มีฟอร์ม/ขั้นตอนงาน เมื่อกำหนด workflow ของแผนกแล้วให้เพิ่มตารางพร้อมการแยกข้อมูลทดสอบ
// ตามกติกา 5 ข้อของโหมดทดสอบใน README และเทสต์ใน supabase/tests/database/ ก่อนเปิดการบันทึกข้อมูล
//
// เมนูข้างโผล่เฉพาะโหมดทดสอบ (nav.sandboxOnly) และหน้านี้ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// (การซ่อนเมนูอย่างเดียวไม่ใช่การควบคุมสิทธิ์) ไม่มีฝั่ง Next.js เพราะโหมดทดสอบมีเฉพาะ Pilot Web
//
// จอ 761–1040px แถบข้างหุบเหลือแต่ไอคอน เมนูย่อยจึงถูกซ่อนด้วย CSS และแสดงการ์ด Item master ในหน้าแทน
// (HTML ต้นไม้ชุดเดียวกัน ซ่อน/แสดงด้วย media query ที่ styles.css) ช่วงความกว้างอื่นแสดงเฉพาะเมนูย่อยในแถบข้าง
//
// รายการในเมนูที่มี view (เช่น ทะเบียนสินค้า) วาดเนื้อหาโดย modules/module-factory-master.js ผ่าน
// window.MNP_FACTORY_VIEWS ไฟล์นี้ส่ง frame ให้ (หน้าโหลด + หัวรายการ + การ์ดสำรองสำหรับจอที่แถบข้างหุบ)
//
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) — เรียก helper ของ app.js (state, app, shell, bindShell,
// loadingShell, renderNotFound, escapeHtml, currentRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
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

  // รายการที่เลือกอยู่ — อ่านจาก URL ทุกครั้ง (ค่าไม่รู้จัก = ไม่มี) แถบข้างและหน้าจึงตรงกันเสมอ
  const selectedEntry = () => itemMaster.findEntry(currentRoute().params.get("item"));

  // ต้นไม้ Item master: <details> ซ้อนกัน (โฟลเดอร์) รายการเป็นลิงก์ไปหน้าของตัวเอง เปิด/ปิดด้วยการแตะได้ทุกอุปกรณ์รวม iPhone
  // และใช้คีย์บอร์ดได้เองโดยไม่ต้องเขียน ARIA tree เอง ทั้งหมดอยู่ในหน้า/แถบข้าง ไม่ใช่ popup ลอย จึงไม่ต้องมีโค้ดปิดตอนแตะนอกกรอบ
  // (ถ้าวันหน้าเปลี่ยนเป็น popup ลอยหรือ combobox ต้องใช้ data-popup/closePopup ตามกติกา AGENTS.md)
  // name= ทำให้เบราว์เซอร์ที่รองรับเปิดได้ทีละโฟลเดอร์ (เบราว์เซอร์เก่าเปิดได้หลายอัน ไม่เสียหาย) แยกชื่อตามที่วางกันไม่ให้ปิดกันข้ามชุด
  function treeHtml(selected, group) {
    const folders = itemMaster.FOLDERS.map((folder) => {
      const entries = folder.entries.length
        ? folder.entries.map((entry) => `<li><a class="factory-entry" href="${escapeHtml(itemMaster.url(entry.key))}"${selected?.entry.key === entry.key ? ` aria-current="page"` : ""}>${DOCUMENT_ICON}<span>${escapeHtml(entry.name)}</span></a></li>`).join("")
        : `<li class="factory-entries-empty">ยังไม่มีรายการในโฟลเดอร์นี้</li>`;
      return `<li><details class="factory-folder" name="factory-folder-${group}"${selected?.folder.key === folder.key ? " open" : ""}><summary>${FOLDER_ICON}<span>${escapeHtml(folder.name)}</span></summary><ul class="factory-entries">${entries}</ul></details></li>`;
    }).join("");
    return `<ul class="factory-tree">${folders}</ul>`;
  }

  // dropdown "Item master" ใต้เมนูฝ่ายโรงงานในแถบข้าง — โผล่เมื่อเลือกฝ่ายโรงงานอยู่เท่านั้น (app.js เรียกผ่าน nav.subnav)
  // เปิดค้างไว้เมื่อมีรายการที่เลือก เพื่อให้เห็นว่าอยู่ตรงไหนของต้นไม้
  function itemMasterNavHtml(active) {
    if (active !== PATH) return "";
    const selected = selectedEntry();
    return `<div class="nav-sub"><details class="factory-master"${selected ? " open" : ""}><summary>Item master</summary>${treeHtml(selected, "nav")}</details></div>`;
  }

  // การ์ด Item master ในหน้า — แสดงเฉพาะจอ 761–1040px ที่แถบข้างหุบ (ดู styles.css .factory-master-page)
  function itemMasterCardHtml(selected) {
    return `<section class="card factory-item-card factory-master-page"><details class="factory-master"${selected ? " open" : ""}><summary>Item master</summary>${treeHtml(selected, "page")}</details></section>`;
  }

  function overviewHtml() {
    const cards = factory.DEPARTMENTS.map((department) => `<a class="type-card" href="${escapeHtml(factory.url(department.code))}" style="background:${gradient(department.theme)}">
        <span class="request-type-top"><span class="type-card-badge">${escapeHtml(department.code)}</span></span>
        <span class="type-card-body"><strong>${escapeHtml(department.name)}</strong><small>เปิดแผนก →</small></span>
      </a>`).join("");
    return `<div class="factory-page">
      <div class="page-heading request-module-header" style="background:${gradient(THEME)}">
        <div class="request-module-title"><span class="type-card-badge">${NAV_ICON}</span><div><div class="eyebrow">โหมดทดสอบ</div><h1>${TITLE}</h1><p>${factory.DEPARTMENTS.length} แผนก · Item master อยู่ในเมนูข้างใต้ "ฝ่ายโรงงาน"</p></div></div>
      </div>
      ${itemMasterCardHtml(null)}
      <div class="request-type-heading"><h2>เลือกแผนก</h2></div>
      <nav class="type-grid factory-dept-grid" aria-label="แผนกฝ่ายโรงงาน">${cards}</nav>
      </div>`;
  }

  function departmentHtml(department) {
    const tabs = factory.DEPARTMENTS.map((item) => `<a class="filter${item.code === department.code ? " active" : ""}" href="${escapeHtml(factory.url(item.code))}"${item.code === department.code ? ` aria-current="page"` : ""}>${escapeHtml(item.code)} ${escapeHtml(item.name)}</a>`).join("");
    return `<div class="factory-page">
      <a class="request-back-link" href="${escapeHtml(factory.url())}" aria-label="ย้อนกลับไปเลือกแผนก">‹ ย้อนกลับ</a>
      <div class="page-heading request-module-header" style="background:${gradient(department.theme)}">
        <div class="request-module-title"><span class="type-card-badge">${escapeHtml(department.code)}</span><div><div class="eyebrow">${TITLE} · โหมดทดสอบ</div><h1>${escapeHtml(department.name)}</h1><p>แผนก ${escapeHtml(department.code)}</p></div></div>
      </div>
      ${itemMasterCardHtml(null)}
      <nav class="filters" aria-label="สลับแผนกฝ่ายโรงงาน">${tabs}</nav>
      <section class="card">
        <h2>แผนก ${escapeHtml(department.code)} ${escapeHtml(department.name)}</h2>
        <div class="empty">ยังไม่มีแบบฟอร์มหรือขั้นตอนงานของแผนกนี้<br><small>โมดูลอยู่ในโหมดทดสอบ รอกำหนดขั้นตอนงานของแผนกก่อนเปิดให้บันทึกข้อมูล</small></div>
      </section>
      </div>`;
  }

  // หน้าของรายการใน Item master: หัวรายการ + เนื้อหาจาก view (ไม่มี view = หน้าว่าง "ยังไม่เปิดใช้งาน")
  // back: ปุ่มย้อนกลับ (ค่าเริ่มต้นกลับหน้าฝ่ายโรงงาน) actions: ปุ่มด้านขวาของหัว subtitle: ต่อท้ายชื่อในหัว
  function entryHtml(selected, { body = null, actions = "", back = null, subtitle = null } = {}) {
    const { folder, entry } = selected;
    const backLink = back ?? { href: factory.url(), label: "‹ ย้อนกลับ" };
    return `<div class="factory-page">
      <a class="request-back-link" href="${escapeHtml(backLink.href)}">${escapeHtml(backLink.label)}</a>
      <div class="page-heading request-module-header" style="background:${gradient(THEME)}">
        <div class="request-module-title"><span class="type-card-badge">${NAV_ICON}</span><div><div class="eyebrow">${TITLE} · Item master › ${escapeHtml(folder.name)}</div><h1>${escapeHtml(entry.name)}</h1><p>${subtitle ? `${escapeHtml(subtitle)} · ` : ""}โหมดทดสอบ</p></div></div>
        ${actions ? `<div class="request-create-entry">${actions}</div>` : ""}
      </div>
      ${itemMasterCardHtml(selected)}
      ${body ?? `<section class="card">
        <div class="empty">ยังไม่เปิดใช้งาน<br><small>โมดูลอยู่ในโหมดทดสอบ รอกำหนดฟอร์มและขั้นตอนของรายการนี้</small></div>
      </section>`}
      </div>`;
  }

  // frame ที่ส่งให้ view: loading() แสดงหน้ากำลังโหลด paint() วาดหน้าแล้วคืนกรอบเนื้อหาไว้ผูก event
  function frameFor(selected, title) {
    return {
      loading: () => loadingShell(PATH, title),
      paint(options) {
        app.innerHTML = shell(entryHtml(selected, options), PATH, options?.subtitle ? `${title} / ${options.subtitle}` : title);
        bindShell();
        return document.querySelector(".content");
      },
    };
  }

  async function renderFactory(params) {
    // เมนูข้างโผล่เฉพาะโหมดทดสอบ แต่ URL พิมพ์เข้ามาเองได้ — ผู้ใช้นอกโหมดทดสอบต้องไม่เห็นหน้านี้
    if (!state.employee?.isSandbox) return renderNotFound();
    // item/dept ที่ไม่รู้จักพากลับหน้ารวม ไม่แสดงหน้าว่างของสิ่งที่ไม่มีอยู่ (รายการมาก่อนแผนกถ้าส่งมาทั้งคู่)
    const selected = itemMaster.findEntry(params.get("item"));
    const department = selected ? null : factory.find(params.get("dept"));
    let content = overviewHtml();
    let title = TITLE;
    if (selected) {
      title = `${TITLE} / ${selected.entry.name}`;
      const view = window.MNP_FACTORY_VIEWS?.[selected.entry.view];
      if (view) return await view({ params, selected, frame: frameFor(selected, title) });
      content = entryHtml(selected);
    } else if (department) {
      content = departmentHtml(department);
      title = `${TITLE} / ${department.code} ${department.name}`;
    }
    app.innerHTML = shell(content, PATH, title);
    bindShell();
  }

  const modules = (window.MNP_REQUEST_MODULES ??= {});
  modules.FACTORY = {
    code: "FACTORY",
    enabled: true,
    // ตาราง factory_* ทำครบกติกา 5 ข้อของโหมดทดสอบแล้ว (20261006050000) หน้าแผนกยังไม่แตะฐานข้อมูล
    sandbox: true,
    label: TITLE,
    theme: THEME,
    // ข้อความแจ้งข้อผิดพลาดของ RPC ฝ่ายโรงงาน (friendlyError ใน app.js รวมของทุกโมดูล)
    errorMessages: window.MNP_FACTORY_ERRORS ?? {},
    nav: [{ path: PATH, label: TITLE, icon: NAV_ICON, sandboxOnly: true, subnav: itemMasterNavHtml }],
    pages: { [PATH]: renderFactory },
  };
})();
