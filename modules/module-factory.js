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
// หน้าแผนก (#/factory?dept=<รหัส>) แสดงคิวใบงานผลิตของแผนกนั้นจาก view "department" ของ modules/module-factory-job.js
// (ขั้น 4–8 ของ workflow) ถ้าไม่มี view นี้เป็นโครงหน้าว่าง ตารางใหม่ต้องแยกข้อมูลทดสอบตามกติกา 5 ข้อของโหมดทดสอบใน README
// และมีเทสต์ใน supabase/tests/database/ ก่อนเปิดการบันทึกข้อมูล
//
// เมนูข้างโผล่เฉพาะโหมดทดสอบ (nav.sandboxOnly) และหน้านี้ปฏิเสธผู้ใช้นอกโหมดทดสอบเอง
// (การซ่อนเมนูอย่างเดียวไม่ใช่การควบคุมสิทธิ์) ไม่มีฝั่ง Next.js เพราะโหมดทดสอบมีเฉพาะ Pilot Web
//
// หัวทุกหน้าเป็นหัวกะทัดรัด (headHtml) หน้ารวม/หน้าแผนกมีช่องค้นหารวม → #/factory?q= (view "search" ใน module-factory-board.js)
// หน้าแผนกสลับแผนกด้วยแท็บบนจอกว้าง และ <select> บนมือถือ
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

  const FOLDER_ICON = `<svg class="factory-tree-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.6l2 2.2h8.4A1.5 1.5 0 0 1 21 8.7v9.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-12Z"/></svg>`;
  const DOCUMENT_ICON = `<svg class="factory-tree-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3h7l4 4v14H7V3Z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/></svg>`;

  // รายการที่เลือกอยู่ — อ่านจาก URL ทุกครั้ง (ค่าไม่รู้จัก = ไม่มี) แถบข้างและหน้าจึงตรงกันเสมอ
  const selectedEntry = () => itemMaster.findEntry(currentRoute().params.get("item"));

  // ต้นไม้ Item master: <details> ซ้อนกัน (โฟลเดอร์) รายการเป็นลิงก์ไปหน้าของตัวเอง เปิด/ปิดด้วยการแตะได้ทุกอุปกรณ์รวม iPhone
  // และใช้คีย์บอร์ดได้เองโดยไม่ต้องเขียน ARIA tree เอง ทั้งหมดอยู่ในหน้า/แถบข้าง ไม่ใช่ popup ลอย จึงไม่ต้องมีโค้ดปิดตอนแตะนอกกรอบ
  // (ถ้าวันหน้าเปลี่ยนเป็น popup ลอยหรือ combobox ต้องใช้ data-popup/closePopup ตามกติกา AGENTS.md)
  // name= ทำให้เบราว์เซอร์ที่รองรับเปิดได้ทีละโฟลเดอร์ (เบราว์เซอร์เก่าเปิดได้หลายอัน ไม่เสียหาย) แยกชื่อตามที่วางกันไม่ให้ปิดกันข้ามชุด
  function treeHtml(selected, group) {
    const folders = itemMaster.FOLDERS.filter((folder) => folder.entries.length > 0).map((folder) => {
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
    return `<div class="nav-sub"><details class="factory-master"${selected ? " open" : ""}><summary>เมนูโรงงาน</summary>${treeHtml(selected, "nav")}</details></div>`;
  }

  // การ์ด Item master ในหน้า — แสดงเฉพาะจอ 761–1040px ที่แถบข้างหุบ (ดู styles.css .factory-master-page)
  function itemMasterCardHtml(selected) {
    return `<section class="card factory-item-card factory-master-page"><details class="factory-master"${selected ? " open" : ""}><summary>เมนูโรงงาน</summary>${treeHtml(selected, "page")}</details></section>`;
  }

  // หัวหน้าแบบกะทัดรัด: ตำแหน่ง (ลิงก์กลับขึ้นไปได้) + ชื่อหน้า + ปุ่มด้านขวา — แทนแถบไล่สีเดิม
  // คำว่า "โหมดทดสอบ" ไม่ซ้ำในหัว เพราะแถบสีเหลืองและป้าย TEST บนแถบบนบอกอยู่แล้วทุกหน้า
  // crumbs: [{ href?, label }] ต่อจาก "ฝ่ายโรงงาน" · back: { href, label } ลิงก์ย้อนกลับเฉพาะหน้ารายละเอียด/ฟอร์ม
  function headHtml({ title, subtitle = "", crumbs = [], actions = "", back = null, badge = "" }) {
    // หน้ารวมไม่มีตำแหน่ง (ชื่อหน้าคือ "ฝ่ายโรงงาน" อยู่แล้ว) หน้าอื่นเริ่มที่ลิงก์กลับหน้ารวม
    const trail = crumbs.length && [{ href: factory.url(), label: TITLE }, ...crumbs]
      .map((crumb) => (crumb.href ? `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>` : `<span>${escapeHtml(crumb.label)}</span>`))
      .join('<span class="fx-crumb-sep" aria-hidden="true">/</span>');
    return `${back ? `<a class="fx-back" href="${escapeHtml(back.href)}">${escapeHtml(back.label)}</a>` : ""}
      <header class="fx-head">
        <div class="fx-head-main">
          ${trail ? `<nav class="fx-crumbs" aria-label="ตำแหน่งในฝ่ายโรงงาน">${trail}</nav>` : ""}
          <div class="fx-title">${badge}<h1>${escapeHtml(title)}</h1></div>
          ${subtitle ? `<p class="fx-sub">${escapeHtml(subtitle)}</p>` : ""}
        </div>
        ${actions ? `<div class="fx-actions">${actions}</div>` : ""}
      </header>`;
  }

  // ช่องค้นหารวมของฝ่ายโรงงาน (หน้ารวม หน้าแผนก หน้าผลค้นหา) ส่งแล้วไป #/factory?q= ซึ่งค้นหน้าในเมนู Item และเอกสารทุกชนิด
  function searchHtml(q = "") {
    const search = window.MNP_FACTORY_UI?.SEARCH_ICON ?? "";
    return `<form class="fx-search" role="search" data-fx-search>
        <div class="fm-search">${search}<label class="sr-only" for="fx-search-q">ค้นหาในฝ่ายโรงงาน</label>
          <input class="input" id="fx-search-q" name="q" type="search" enterkeyhint="search" autocomplete="off" maxlength="100" value="${escapeHtml(q)}" placeholder="ค้นหาเลขที่ใบ รหัสสินค้า ลูกค้า หรือชื่อเมนู"></div>
        <button class="btn" type="submit">ค้นหา</button>
      </form>`;
  }

  function bindSearch(root) {
    root?.querySelector?.("[data-fx-search]")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const q = String(new FormData(event.currentTarget).get("q") ?? "").trim().slice(0, 100);
      location.hash = q ? `/factory?${new URLSearchParams({ q })}` : "/factory";
    });
  }

  const deptStyle = (department) => `--dept:${department.theme[0]}`;

  // body: ภาพรวมการผลิตจาก view "overview" (modules/module-factory-board.js) ไม่มี = เฉพาะแผนก
  // queueCounts: { รหัสแผนก: จำนวนงานที่ถึงคิว } แสดงบนปุ่มแผนก
  function overviewHtml(body = "", queueCounts = {}) {
    const tiles = factory.DEPARTMENTS.map((department) => {
      const waiting = Number(queueCounts[department.code] ?? 0);
      return `<a class="fx-dept${waiting ? " has-work" : ""}" href="${escapeHtml(factory.url(department.code))}" style="${deptStyle(department)}">
        <span class="fx-dept-code">${escapeHtml(department.code)}</span>
        <span class="fx-dept-copy"><strong>${escapeHtml(department.name)}</strong><small>${waiting ? `${waiting} งานรอลงมือ` : "ไม่มีงานรอ"}</small></span>
      </a>`;
    }).join("");
    return `<div class="factory-page">
      ${headHtml({ title: TITLE, subtitle: "ภาพรวมการผลิตทุกแผนก" })}
      ${searchHtml()}
      <h2 class="fx-section-title">แผนก</h2>
      <nav class="fx-depts" aria-label="แผนกฝ่ายโรงงาน">${tiles}</nav>
      ${itemMasterCardHtml(null)}
      ${body}
      </div>`;
  }

  // body: เนื้อหาของแผนกจาก view "department" (modules/module-factory-job.js คิวใบงานของแผนก) ไม่มี = โครงหน้าว่าง
  // สลับแผนก: จอกว้างเป็นแท็บ จอมือถือเป็น dropdown (<select> ของเบราว์เซอร์ แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
  function departmentHtml(department, body = null) {
    const tabs = factory.DEPARTMENTS.map((item) => `<a class="filter${item.code === department.code ? " active" : ""}" href="${escapeHtml(factory.url(item.code))}"${item.code === department.code ? ` aria-current="page"` : ""}>${escapeHtml(item.code)} ${escapeHtml(item.name)}</a>`).join("");
    const choices = factory.DEPARTMENTS.map((item) => `<option value="${escapeHtml(item.code)}"${item.code === department.code ? " selected" : ""}>${escapeHtml(item.code)} · ${escapeHtml(item.name)}</option>`).join("");
    return `<div class="factory-page" style="${deptStyle(department)}">
      ${headHtml({ title: department.name, subtitle: `แผนก ${department.code}`, crumbs: [{ label: "แผนก" }], badge: `<span class="fx-dept-code">${escapeHtml(department.code)}</span>` })}
      <div class="fx-dept-switch">
        <nav class="filters fx-tabs" aria-label="สลับแผนกฝ่ายโรงงาน">${tabs}</nav>
        <div class="field fx-dept-select"><label for="fx-dept">สลับแผนก</label><select class="select" id="fx-dept" data-fx-dept>${choices}</select></div>
      </div>
      ${itemMasterCardHtml(null)}
      ${body ?? `<section class="card">
        <h2>แผนก ${escapeHtml(department.code)} ${escapeHtml(department.name)}</h2>
        <div class="empty">ยังไม่มีแบบฟอร์มหรือขั้นตอนงานของแผนกนี้<br><small>รอกำหนดขั้นตอนงานของแผนกก่อนเปิดให้บันทึกข้อมูล</small></div>
      </section>`}
      </div>`;
  }

  function bindDepartment(root) {
    const select = root?.querySelector?.("[data-fx-dept]");
    select?.addEventListener("change", () => { location.hash = factory.url(select.value).slice(1); });
  }

  // หน้าของรายการใน Item master: หัวรายการ + เนื้อหาจาก view (ไม่มี view = หน้าว่าง "ยังไม่เปิดใช้งาน")
  // back: ลิงก์ย้อนกลับของหน้ารายละเอียด/ฟอร์ม (ไม่ส่ง = ใช้ตำแหน่งด้านบนแทน) actions: ปุ่มด้านขวาของหัว
  // subtitle: เอกสารที่เปิดอยู่ (เช่น เลขที่ใบ) — มีแล้วใช้เป็นชื่อหน้า และชื่อรายการกลายเป็นลิงก์ในตำแหน่ง
  function entryHtml(selected, { body = null, actions = "", back = null, subtitle = null } = {}) {
    const { folder, entry } = selected;
    const crumbs = subtitle ? [{ label: folder.name }, { href: itemMaster.url(entry.key), label: entry.name }] : [{ label: folder.name }];
    return `<div class="factory-page">
      ${headHtml({ title: subtitle || entry.name, crumbs, actions, back })}
      ${itemMasterCardHtml(selected)}
      ${body ?? `<section class="card">
        <div class="empty">ยังไม่เปิดใช้งาน<br><small>รอกำหนดฟอร์มและขั้นตอนของรายการนี้</small></div>
      </section>`}
      </div>`;
  }

  // หน้าผลค้นหารวม (#/factory?q=) — body จาก view "search" (modules/module-factory-board.js)
  function searchPageHtml(q, body = "") {
    return `<div class="factory-page">
      ${headHtml({ title: "ค้นหา", subtitle: `ผลการค้นหา “${q}”`, crumbs: [{ label: "ค้นหา" }] })}
      ${searchHtml(q)}
      ${body}
      </div>`;
  }

  // frame ที่ส่งให้ view: loading() แสดงหน้ากำลังโหลด paint() วาดหน้าแล้วคืนกรอบเนื้อหาไว้ผูก event
  function frameFor(selected, title) {
    return {
      loading: () => loadingShell(PATH, title),
      paint(options) {
        app.innerHTML = shell(entryHtml(selected, options), PATH, options?.subtitle ? `${title} / ${options.subtitle}` : title);
        bindShell();
        window.MNP_FACTORY_ATTACHMENTS?.mountAll(); // เติมรายการไฟล์ในส่วน "ไฟล์แนบ" ของเอกสาร (ถ้าหน้านี้มี)
        return document.querySelector(".content");
      },
    };
  }

  // frame ของหน้ารวม: view "overview" วาดภาพรวมการผลิตและส่งจำนวนงานบนปุ่มแผนกมาที่ queueCounts
  function overviewFrame() {
    return {
      loading: () => loadingShell(PATH, TITLE),
      paint(options) {
        app.innerHTML = shell(overviewHtml(options?.body ?? "", options?.queueCounts ?? {}), PATH, TITLE);
        bindShell();
        const root = document.querySelector(".content");
        bindSearch(root);
        return root;
      },
    };
  }

  // frame ของหน้าแผนก: view "department" วาดเนื้อหาในกรอบเดียวกับหน้าแผนก (หัวแผนก ตัวสลับแผนก การ์ด Item master)
  function departmentFrame(department, title) {
    return {
      loading: () => loadingShell(PATH, title),
      paint(options) {
        app.innerHTML = shell(departmentHtml(department, options?.body ?? null), PATH, title);
        bindShell();
        const root = document.querySelector(".content");
        bindDepartment(root);
        return root;
      },
    };
  }

  function searchFrame(q) {
    const title = `${TITLE} / ค้นหา`;
    return {
      loading: () => loadingShell(PATH, title),
      paint(options) {
        app.innerHTML = shell(searchPageHtml(q, options?.body ?? ""), PATH, title);
        bindShell();
        const root = document.querySelector(".content");
        bindSearch(root);
        return root;
      },
    };
  }

  async function renderFactory(params) {
    // เมนูข้างโผล่เฉพาะโหมดทดสอบ แต่ URL พิมพ์เข้ามาเองได้ — ผู้ใช้นอกโหมดทดสอบต้องไม่เห็นหน้านี้
    if (!state.employee?.isSandbox) return renderNotFound();
    // item/dept ที่ไม่รู้จักพากลับหน้ารวม ไม่แสดงหน้าว่างของสิ่งที่ไม่มีอยู่ (รายการมาก่อนแผนกถ้าส่งมาทั้งคู่)
    const selected = itemMaster.findEntry(params.get("item"));
    const department = selected ? null : factory.find(params.get("dept"));
    // ค้นหารวม (ไม่มี item/dept แต่มี q): หน้าในเมนู Item และเอกสารทุกชนิดที่ตรงกับคำค้น
    const q = String(params.get("q") ?? "").trim().slice(0, 100);
    if (!selected && !department && q && window.MNP_FACTORY_VIEWS?.search) return await window.MNP_FACTORY_VIEWS.search({ params, q, frame: searchFrame(q) });
    // หน้ารวม (ไม่มี item/dept): ภาพรวมการผลิตจาก view "overview" ถ้ามี ไม่เช่นนั้นเป็นปุ่มแผนก
    if (!selected && !department && window.MNP_FACTORY_VIEWS?.overview) return await window.MNP_FACTORY_VIEWS.overview({ params, frame: overviewFrame() });
    let content = overviewHtml();
    let title = TITLE;
    if (selected) {
      title = `${TITLE} / ${selected.entry.name}`;
      const view = window.MNP_FACTORY_VIEWS?.[selected.entry.view];
      if (view) return await view({ params, selected, frame: frameFor(selected, title) });
      content = entryHtml(selected);
    } else if (department) {
      title = `${TITLE} / ${department.code} ${department.name}`;
      const view = window.MNP_FACTORY_VIEWS?.department;
      if (view) return await view({ params, department, frame: departmentFrame(department, title) });
      content = departmentHtml(department);
    }
    app.innerHTML = shell(content, PATH, title);
    bindShell();
    const root = document.querySelector(".content");
    bindSearch(root);
    bindDepartment(root);
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
