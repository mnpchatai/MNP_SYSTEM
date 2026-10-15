// หน้าจอ Item master ของฝ่ายโรงงาน (โหมดทดสอบ) — ย้ายจากแอป "MNP SYSTEM · Item Master" ที่ผู้ใช้ส่งมา
//
// แต่ละรายการในเมนู Item master (modules/factory-item-master.js) มี view ที่ไฟล์นี้วาดให้:
//   items      ทะเบียนสินค้า: สถิติ ค้นหา/กรอง/เรียง/แบ่งหน้า รายละเอียด (&id=) และแก้ไข (&id=&edit=1)
//   item-new   ฟอร์มเพิ่ม Item
//   history    ประวัติการเพิ่ม/แก้ไข Item ล่าสุด
//   routing / inventory  อ่านอย่างเดียว
//   (ใบสั่งผลิต: ออก/ส่ง/รับ/วางแผน/ออกใบสั่งงาน อยู่ที่ modules/module-factory-production.js)
//   (โครงสร้างสินค้า BOM: ดู/สร้าง/แก้ฉบับร่าง/อนุมัติ อยู่ที่ modules/module-factory-bom.js ซึ่งใช้ helper ของไฟล์นี้ผ่าน
//    window.MNP_FACTORY_UI และเพิ่ม view เข้า window.MNP_FACTORY_VIEWS — ต้องโหลดหลังไฟล์นี้ ก่อน module-factory.js)
// ข้อมูลทั้งหมดมาจาก RPC app_factory_master_data และบันทึกผ่าน app_factory_save_item
// (supabase/migrations/20261006050000_factory_item_master.sql) ฐานข้อมูลตรวจสิทธิ์/โหมด/ค่าทุกช่องเอง
// การตรวจในหน้าเว็บเป็นเพียงความสะดวก ตรรกะที่ทดสอบได้อยู่ที่ modules/factory-master-model.js
//
// ไฟล์นี้โหลดก่อน modules/module-factory.js ซึ่งเป็นผู้เรียก view พร้อม frame (วาดหัวรายการ + แถบข้าง)
// ฟังก์ชันข้างในเรียก helper ของ app.js (sb, escapeHtml, formatDate, showToast, friendlyError,
// setFormBusy, renderRoute) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
// ทุก dropdown เป็น <select> ของเบราว์เซอร์ (แตะบน iPhone ได้ ไม่ต้องมีโค้ดปิด popup)
(function registerFactoryMasterViews() {
  const model = window.MNP_FACTORY_MASTER_MODEL;
  const menu = window.MNP_FACTORY_ITEM_MASTER;

  const ERROR_MESSAGES = {
    FACTORY_TEST_MODE_ONLY: "Item master ใช้ได้เฉพาะโหมดทดสอบ (ยังไม่เปิดกับข้อมูลจริง)",
    INVALID_ITEM_CODE: "รหัส Item ต้องเป็นตัวอักษรอังกฤษ ตัวเลข - หรือ _ ยาว 2–40 ตัวอักษร",
    INVALID_ITEM_NAME_TH: "กรุณากรอกชื่อ Item ภาษาไทย (ไม่เกิน 160 ตัวอักษร)",
    INVALID_ITEM_NAME_EN: "ชื่อภาษาอังกฤษยาวได้ไม่เกิน 160 ตัวอักษร",
    INVALID_ITEM_TYPE: "กรุณาเลือกประเภท Item",
    INVALID_ITEM_CATEGORY: "กรุณาเลือกหมวดหมู่",
    INVALID_ITEM_BRAND: "กรุณาเลือกแบรนด์",
    INVALID_ITEM_UNIT: "กรุณาเลือกหน่วยนับฐาน",
    INVALID_ITEM_PROCUREMENT: "กรุณาเลือกวิธีจัดหา",
    INVALID_ITEM_STATUS: "กรุณาเลือกสถานะ",
    INVALID_ITEM_LOT_TRACKING: "กรุณาระบุการติดตามล็อต",
    INVALID_ITEM_MIN_STOCK: "สต็อกขั้นต่ำต้องเป็นตัวเลขตั้งแต่ 0 ถึง 1,000,000,000",
    INVALID_ITEM_SPECIFICATION: "ข้อกำหนด/รายละเอียดยาวได้ไม่เกิน 3,000 ตัวอักษร",
    INVALID_ITEM_PART_CODE: "รหัสอะไหล่ยาวได้ไม่เกิน 60 ตัวอักษร และห้ามมีอักขระควบคุม",
    ITEM_CODE_TAKEN: "รหัส Item นี้มีอยู่แล้ว กรุณาใช้รหัสอื่น",
    ITEM_NOT_FOUND: "ไม่พบ Item นี้ (อาจถูกล้างข้อมูลทดสอบไปแล้ว)",
    ITEM_VERSION_CONFLICT: "Item นี้ถูกแก้ไขจากหน้าต่างอื่นแล้ว กรุณาเปิดรายละเอียดใหม่แล้วแก้ไขอีกครั้ง",
    ITEM_LOCKED_FIELDS: "ประเภท หน่วยนับฐาน และการติดตามล็อตแก้ไขไม่ได้หลังสร้าง",
  };

  const qty = (value) => Number(value ?? 0).toLocaleString("th-TH", { maximumFractionDigits: 3 });
  const label = (map, key) => map[key] ?? key ?? "—";
  const typeBadge = (type) => `<span class="badge fm-type fm-type-${escapeHtml(type)}">${escapeHtml(type)} · ${escapeHtml(label(model.ITEM_TYPES, type))}</span>`;
  const statusBadge = (status) => `<span class="badge fm-status fm-status-${status === "active" ? "active" : "inactive"}">${escapeHtml(label(model.STATUSES, status))}</span>`;
  // class ตามสถานะ: pending_approval = เหลือง, approved = ฟ้า (ดู .badge.* ใน styles.css) draft/obsolete = สีเทา
  const docStatus = (status) => `<span class="badge ${escapeHtml(status)}">${escapeHtml(label(model.DOCUMENT_STATUSES, status))}</span>`;
  const notice = (text) => `<p class="fm-notice" role="note">${escapeHtml(text)}</p>`;
  const options = (entries, selected) => entries.map(([value, text]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(text)}</option>`).join("");

  // ---------- ชิ้นส่วนหน้าจอที่ใช้ร่วมกันทุกหน้าของฝ่ายโรงงาน ----------
  const SEARCH_ICON = `<svg class="fm-search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>`;

  // แถบค้นหา + dropdown กรองสถานะของหน้ารายการ (entry = key ของรายการในเมนูที่จะพากลับมาพร้อม ?q=&status=)
  // statuses: [[ค่า, ข้อความ]] ตัวแรกคือ "ทั้งหมด" (ไม่ใส่ในลิงก์) — ไม่ส่ง statuses = ช่องค้นหาอย่างเดียว
  // ทุกค่าที่วาดลงหน้ามาจากค่าที่ตรวจแล้ว (q ผ่าน normalize ส่วน status ต้องอยู่ในรายการ) ผูก event ด้วย bindListToolbar
  function listToolbar({ entry, q = "", status = "all", statuses = null, placeholder = "ค้นหา…", statusLabel = "สถานะ" }) {
    const id = `fm-lb-${entry}`;
    const filtered = Boolean(q) || (statuses && status !== statuses[0][0]);
    return `<form class="fm-listbar" data-fm-listbar="${escapeHtml(entry)}" role="search">
        <div class="fm-search">${SEARCH_ICON}<label class="sr-only" for="${id}-q">ค้นหา</label>
          <input class="input" id="${id}-q" name="q" type="search" enterkeyhint="search" autocomplete="off" maxlength="100" value="${escapeHtml(q)}" placeholder="${escapeHtml(placeholder)}"></div>
        ${statuses ? `<label class="sr-only" for="${id}-status">${escapeHtml(statusLabel)}</label>
          <select class="select" id="${id}-status" name="status">${options(statuses, status)}</select>` : ""}
        <button class="btn" type="submit">ค้นหา</button>
        ${filtered ? `<a class="btn secondary" href="${escapeHtml(menu.url(entry))}">ล้างตัวกรอง</a>` : ""}
      </form>`;
  }

  // ส่งแถบค้นหา: เปลี่ยน URL ของรายการเดิม (หน้าเว็บวาดใหม่จาก URL) · เปลี่ยน dropdown แล้วกรองทันที ช่องค้นหากด Enter/ค้นหา
  function bindListToolbar(root) {
    root?.querySelectorAll?.("form[data-fm-listbar]").forEach((form) => {
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = new FormData(form);
        const q = String(values.get("q") ?? "").trim().slice(0, 100);
        const status = values.get("status");
        location.hash = menu.url(form.dataset.fmListbar, { q: q || null, status: status && status !== "all" ? String(status) : null }).slice(1);
      });
      form.querySelectorAll("select").forEach((select) => select.addEventListener("change", () => form.requestSubmit()));
    });
  }

  // แถบขั้นของเอกสาร (เสร็จแล้ว · ขั้นปัจจุบัน · ยังไม่ถึง) steps: [[ค่า, ข้อความ]] ตามลำดับ workflow
  // สถานะที่ไม่อยู่ในลำดับ (เช่น ยกเลิก) ไม่วาดแถบ — ป้ายสถานะของเอกสารบอกอยู่แล้ว
  function stepper(steps, current, label = "ขั้นของเอกสาร") {
    const index = steps.findIndex(([value]) => value === current);
    if (index < 0) return "";
    return `<ol class="fm-stepper" aria-label="${escapeHtml(label)}">${steps.map(([, text], position) => {
      const state = position < index ? "done" : position === index ? "current" : "todo";
      return `<li class="is-${state}"${state === "current" ? ' aria-current="step"' : ""}><span>${escapeHtml(text)}</span></li>`;
    }).join("")}</ol>`;
  }

  // ส่วนที่พับไว้ (ประวัติ ผู้ดำเนินการ ฟอร์มที่ใช้ไม่บ่อย) — <details> ของเบราว์เซอร์ แตะบน iPhone และใช้คีย์บอร์ดได้โดยไม่ต้องมีโค้ดปิด
  const fold = (title, body, { open = false, tone = "" } = {}) => `<details class="fm-fold${tone ? ` fm-fold-${tone}` : ""}"${open ? " open" : ""}><summary>${title}</summary><div class="fm-fold-body">${body}</div></details>`;

  async function loadData() {
    const { data, error } = await sb.rpc("app_factory_master_data");
    if (error) throw error;
    return data;
  }

  // ลิงก์ทะเบียนสินค้าพร้อมตัวกรอง — ใส่เฉพาะค่าที่ไม่ใช่ค่าเริ่มต้น URL จึงสั้นและอ่านง่าย
  function listUrl(filters) {
    return menu.url("item-list", {
      q: filters.q || null,
      type: filters.type !== "all" ? filters.type : null,
      brand: filters.brand !== "all" ? filters.brand : null,
      status: filters.status !== "all" ? filters.status : null,
      sort: filters.sort !== "code" ? filters.sort : null,
      page: filters.page > 1 ? filters.page : null,
    });
  }

  // ยังไม่มีข้อมูลทดสอบ: ทุกหน้าชี้ไปที่หน้าจัดการข้อมูลทดสอบ (modules/module-factory-test-data.js) ที่เติมชุดข้อมูลตัวอย่างได้
  const testDataUrl = () => menu.url("test-data-manage");
  const emptyData = (what) => `<section class="card"><div class="empty">ยังไม่มี${escapeHtml(what)}ในโหมดทดสอบ<br>
      <a class="btn secondary small" href="${escapeHtml(testDataUrl())}">เติมชุดข้อมูลตัวอย่าง</a></div></section>`;

  // ---------- ทะเบียนสินค้า ----------
  function listHtml(data, params) {
    const filters = model.listParams(params);
    const items = data.items ?? [];
    const low = model.lowStockItems(items);
    const counts = model.countByType(items);
    const active = items.filter((item) => item.status === "active").length;
    const rows = model.filterItems(items, filters);
    const page = model.paginate(rows, filters.page);
    const types = [["all", "ทั้งหมด"], ...Object.entries(model.ITEM_TYPES)];

    if (!items.length) {
      return `<section class="card"><div class="empty">ยังไม่มี Item ในโหมดทดสอบ<br><small>เลือกชุดข้อมูลตัวอย่าง (ข้อมูลสมมติ ไม่ใช่ข้อมูลจริง) ที่หน้าจัดการข้อมูลทดสอบ หรือเพิ่ม Item เอง</small>
          <div class="fm-actions"><a class="btn" href="${escapeHtml(testDataUrl())}">เติมชุดข้อมูลตัวอย่าง</a>
          <a class="btn secondary" href="${escapeHtml(menu.url("item-new"))}"><span class="plus-icon" aria-hidden="true"></span> เพิ่ม Item ใหม่</a></div></div></section>`;
    }

    const tableRows = page.rows.map((item) => {
      const detail = menu.url("item-list", { id: item.id });
      return `<tr>
        <td><a class="fm-item-link" href="${escapeHtml(detail)}"><strong>${escapeHtml(item.code)}</strong><span>${escapeHtml(item.name)}</span>${item.part_code ? `<small class="muted">รหัสอะไหล่ ${escapeHtml(item.part_code)}</small>` : ""}</a></td>
        <td>${typeBadge(item.item_type)}</td>
        <td class="fm-opt">${escapeHtml(item.brand)}</td>
        <td class="fm-opt">${escapeHtml(item.unit_code)}</td>
        <td class="fm-opt">${escapeHtml(label(model.PROCUREMENT, item.procurement))}</td>
        <td>${statusBadge(item.status)}</td>
        <td class="right fm-opt"><a class="btn secondary small" href="${escapeHtml(menu.url("item-list", { id: item.id, edit: 1 }))}" aria-label="แก้ไข ${escapeHtml(item.code)}">แก้ไข</a></td>
      </tr>`;
    }).join("");
    const pages = page.pageCount > 1
      ? `<nav class="fm-pagination" aria-label="หน้าของรายการ">${Array.from({ length: page.pageCount }, (_, n) => n + 1).map((number) =>
          `<a class="filter${number === page.page ? " active" : ""}" href="${escapeHtml(listUrl({ ...filters, page: number }))}"${number === page.page ? ' aria-current="page"' : ""}>${number}</a>`).join("")}</nav>`
      : "";

    const typeOptions = types.map(([key, text]) => [key, `${key === "all" ? "ทุกประเภท" : text} (${counts[key] ?? 0})`]);
    const filtered = filters.q || filters.brand !== "all" || filters.status !== "all" || filters.type !== "all";
    return `<section class="card fm-list">
        <p class="fm-meta">${items.length} รายการ · ใช้งาน ${active}${low.length ? ` · <a href="${escapeHtml(menu.url("inventory-view", { status: "low" }))}">ต่ำกว่าขั้นต่ำ ${low.length}</a>` : ""}</p>
        <form class="fm-listbar fm-listbar-wide" id="fm-filter" role="search">
          <div class="fm-search">${SEARCH_ICON}<label class="sr-only" for="fm-q">ค้นหา Item</label>
            <input class="input" id="fm-q" name="q" type="search" enterkeyhint="search" autocomplete="off" value="${escapeHtml(filters.q)}" maxlength="100" placeholder="รหัส Item รหัสอะไหล่ หรือชื่อสินค้า"></div>
          <label class="sr-only" for="fm-type">ประเภท Item</label>
          <select class="select" id="fm-type" name="type">${options(typeOptions, filters.type)}</select>
          <label class="sr-only" for="fm-brand">แบรนด์</label>
          <select class="select" id="fm-brand" name="brand">${options([["all", "ทุกแบรนด์"], ...model.BRANDS.map((brand) => [brand, brand])], filters.brand)}</select>
          <label class="sr-only" for="fm-status">สถานะ</label>
          <select class="select" id="fm-status" name="status">${options([["all", "ทุกสถานะ"], ...Object.entries(model.STATUSES)], filters.status)}</select>
          <label class="sr-only" for="fm-sort">เรียงลำดับ</label>
          <select class="select" id="fm-sort" name="sort">${options(Object.entries(model.SORTS), filters.sort)}</select>
          <button class="btn" type="submit">ค้นหา</button>
          ${filtered ? `<a class="btn secondary" href="${escapeHtml(menu.url("item-list"))}">ล้างตัวกรอง</a>` : ""}
        </form>
        ${page.total ? `<div class="table-wrap"><table class="fm-table">
          <thead><tr><th>รหัส / ชื่อ Item</th><th>ประเภท</th><th class="fm-opt">แบรนด์</th><th class="fm-opt">หน่วยนับ</th><th class="fm-opt">การจัดหา</th><th>สถานะ</th><th class="right fm-opt">จัดการ</th></tr></thead>
          <tbody>${tableRows}</tbody></table></div>`
          : `<div class="empty">ไม่พบ Item ที่ตรงกับการค้นหา<br><a class="btn secondary small" href="${escapeHtml(menu.url("item-list"))}">ล้างตัวกรอง</a></div>`}
        <div class="fm-table-footer"><span class="muted small">แสดง ${page.from}–${page.to} จาก ${page.total} รายการ</span>${pages}</div>
      </section>`;
  }

  function bindList(root) {
    root.querySelector("#fm-filter")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const current = model.listParams(new URLSearchParams(location.hash.split("?")[1] ?? ""));
      const next = model.listParams(new URLSearchParams({ type: String(form.get("type") ?? current.type), q: String(form.get("q") ?? ""), brand: String(form.get("brand") ?? ""), status: String(form.get("status") ?? ""), sort: String(form.get("sort") ?? "") }));
      location.hash = listUrl(next).slice(1);
    });
    // เปลี่ยน dropdown แล้วกรองทันที (ช่องค้นหายังต้องกดค้นหา/Enter)
    root.querySelectorAll("#fm-filter select").forEach((select) => select.addEventListener("change", () => root.querySelector("#fm-filter").requestSubmit()));
  }

  // ---------- รายละเอียด Item ----------
  function detailHtml(data, item) {
    const boms = (data.boms ?? []).filter((bom) => bom.item_id === item.id);
    const routings = (data.routings ?? []).filter((routing) => routing.item_id === item.id);
    const history = (data.history ?? []).filter((entry) => entry.item_id === item.id);
    const links = [
      ...boms.map((bom) => `<a class="btn secondary small" href="${escapeHtml(menu.url("structure-view", { bom: bom.id }))}">BOM Rev. ${escapeHtml(bom.revision)}</a>`),
      ...routings.map((routing) => `<a class="btn secondary small" href="${escapeHtml(menu.url("routing-view", { routing: routing.id }))}">Routing Rev. ${escapeHtml(routing.revision)}</a>`),
    ].join("");
    return `<section class="card fm-detail">
        <div class="fm-detail-head"><div><h2>${escapeHtml(item.name)}</h2><p class="fm-meta">${escapeHtml(item.code)}${item.name_en ? ` · ${escapeHtml(item.name_en)}` : ""}</p></div>
          <a class="btn" href="${escapeHtml(menu.url("item-list", { id: item.id, edit: 1 }))}">แก้ไข Item</a></div>
        <p>${typeBadge(item.item_type)} ${statusBadge(item.status)}</p>
        <dl class="definition-grid">
          <div class="definition"><dt>รหัสอะไหล่</dt><dd>${item.part_code ? escapeHtml(item.part_code) : "—"}</dd></div>
          <div class="definition"><dt>แบรนด์</dt><dd>${escapeHtml(item.brand)}</dd></div>
          <div class="definition"><dt>หมวดหมู่</dt><dd>${escapeHtml(item.category_name)}</dd></div>
          <div class="definition"><dt>คงเหลือ (ทุกคลัง)</dt><dd>${qty(item.stock)} ${escapeHtml(item.unit_code)}</dd></div>
          <div class="definition"><dt>สต็อกขั้นต่ำ</dt><dd>${qty(item.min_stock)} ${escapeHtml(item.unit_code)}</dd></div>
          <div class="definition"><dt>หน่วยนับฐาน</dt><dd>${escapeHtml(item.unit_code)}</dd></div>
          <div class="definition"><dt>การจัดหา</dt><dd>${escapeHtml(label(model.PROCUREMENT, item.procurement))}</dd></div>
          <div class="definition"><dt>ติดตามล็อต</dt><dd>${item.lot_tracking ? "เปิดใช้งาน" : "ไม่ติดตาม"}</dd></div>
          <div class="definition"><dt>แก้ไขล่าสุด</dt><dd>${formatDate(item.updated_at, true)} · รุ่น ${escapeHtml(item.version)}${item.updated_by_name ? ` · ${escapeHtml(item.updated_by_name)}` : ""}</dd></div>
        </dl>
        <h3>ข้อกำหนด / รายละเอียด</h3>
        <p class="fm-pre">${escapeHtml(item.specification || "ไม่มีรายละเอียดเพิ่มเติม")}</p>
        <h3>ข้อมูลที่เชื่อมโยง</h3>
        <div class="fm-actions">${links || '<span class="muted small">ยังไม่มี BOM หรือ Routing สำหรับ Item นี้</span>'}</div>
        <div class="fm-fold-group">${fold(`ประวัติของ Item นี้ <span class="fm-count">${history.length}</span>`, history.length ? historyTable(history, false) : '<p class="muted small">ยังไม่มีการเพิ่ม/แก้ไขผ่านหน้าจอ (ข้อมูลตัวอย่างไม่มีประวัติ)</p>')}</div>
      </section>${window.MNP_FACTORY_ATTACHMENTS.panelHtml("item", item.id)}`;
  }

  // ---------- ฟอร์มเพิ่ม/แก้ไข ----------
  function formHtml(data, item) {
    const editing = Boolean(item);
    const value = (key, fallback = "") => escapeHtml(item?.[key] ?? fallback);
    const locked = editing ? " disabled" : "";
    return `<section class="card">
        <form class="fm-form" id="fm-item-form" novalidate>
          <p class="muted small">ช่องที่มี * จำเป็นต้องกรอก</p>
          <div class="fm-form-error" id="fm-form-error" role="alert" hidden></div>
          <div class="field-row">
            <div class="field"><label for="fm-code">รหัส Item *</label><input class="input" id="fm-code" name="code" required maxlength="40" pattern="${escapeHtml(model.ITEM_CODE_PATTERN)}" autocapitalize="characters" value="${value("code")}" placeholder="เช่น RM-NR-002"><small>ตัวอักษรอังกฤษ ตัวเลข - และ _ (ระบบเปลี่ยนเป็นตัวพิมพ์ใหญ่ให้)</small></div>
            <div class="field"><label for="fm-brand-input">แบรนด์ *</label><select class="select" id="fm-brand-input" name="brand" required>${options(model.BRANDS.map((brand) => [brand, brand]), item?.brand ?? "MNP")}</select></div>
            <div class="field full"><label for="fm-part-code">รหัสอะไหล่</label><input class="input" id="fm-part-code" name="part_code" maxlength="60" value="${value("part_code")}" placeholder="เช่น SE-ST01-100-18-65 · PT-00320 · D21-016">
              <small>รหัสอะไหล่ที่ใช้ประกอบเป็น Item นี้ (คอลัมน์ X ของใบคำนวณวัตถุดิบ) ไม่บังคับ ซ้ำกับ Item อื่นได้ เช่น อะไหล่รหัสเดียวกันแต่คนละสี ส่วน “รหัส Item” ด้านบนคือรหัสสินค้าที่เกิดจากการประกอบอะไหล่ (คอลัมน์ B) และต้องไม่ซ้ำ</small></div>
            <div class="field full"><label for="fm-name">ชื่อ Item ภาษาไทย *</label><input class="input" id="fm-name" name="name" required maxlength="160" value="${value("name")}"></div>
            <div class="field full"><label for="fm-name-en">ชื่อภาษาอังกฤษ</label><input class="input" id="fm-name-en" name="name_en" maxlength="160" value="${value("name_en")}"></div>
            <div class="field"><label for="fm-type">ประเภท *</label><select class="select" id="fm-type" name="item_type" required${locked}>${options(Object.entries(model.ITEM_TYPES).map(([key, text]) => [key, `${key} · ${text}`]), item?.item_type ?? "RM")}</select></div>
            <div class="field"><label for="fm-category">หมวดหมู่ *</label><select class="select" id="fm-category" name="category_code" required>${options((data.categories ?? []).map((category) => [category.code, category.name_th]), item?.category_code ?? data.categories?.[0]?.code)}</select></div>
            <div class="field"><label for="fm-unit">หน่วยนับฐาน *</label><select class="select" id="fm-unit" name="unit_code" required${locked}>${options((data.units ?? []).map((unit) => [unit.code, `${unit.code} · ${unit.name_th}`]), item?.unit_code ?? data.units?.[0]?.code)}</select></div>
            <div class="field"><label for="fm-procurement">วิธีจัดหา *</label><select class="select" id="fm-procurement" name="procurement" required>${options(Object.entries(model.PROCUREMENT), item?.procurement ?? "buy")}</select></div>
            <div class="field"><label for="fm-min-stock">สต็อกขั้นต่ำ *</label><input class="input" id="fm-min-stock" name="min_stock" type="number" inputmode="decimal" required min="0" max="1000000000" step="any" value="${value("min_stock", "0")}"></div>
            <div class="field"><label for="fm-status-input">สถานะ *</label><select class="select" id="fm-status-input" name="status" required>${options(Object.entries(model.STATUSES), item?.status ?? "active")}</select></div>
            <div class="field full"><label class="checkbox-label"><input type="checkbox" name="lot_tracking"${(item ? item.lot_tracking : true) ? " checked" : ""}${locked}> ติดตามล็อตการผลิต / รับเข้า</label>
              ${editing ? "<small>ประเภท หน่วยนับฐาน และการติดตามล็อตถูกล็อกหลังสร้าง เพื่อรักษาความถูกต้องของข้อมูลที่เชื่อมโยง (BOM คลัง ใบสั่งผลิต)</small>" : "<small>ประเภท หน่วยนับฐาน และการติดตามล็อตแก้ไม่ได้หลังบันทึก ให้ตรวจก่อนบันทึก</small>"}</div>
            <div class="field full"><label for="fm-spec">ข้อกำหนด / รายละเอียด</label><textarea class="textarea" id="fm-spec" name="specification" rows="3" maxlength="3000">${value("specification")}</textarea></div>
          </div>
          ${window.MNP_FACTORY_ATTACHMENTS.fieldHtml("fm-item-files")}
          <div class="fm-actions"><button class="btn" type="submit">${editing ? "บันทึกการแก้ไข" : "บันทึก Item"}</button>
            <a class="btn secondary" href="${escapeHtml(editing ? menu.url("item-list", { id: item.id }) : menu.url("item-list"))}">ยกเลิก</a></div>
        </form>
      </section>`;
  }

  function bindForm(root, item) {
    const form = root.querySelector("#fm-item-form");
    const errorBox = root.querySelector("#fm-form-error");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      errorBox.hidden = true;
      if (!form.reportValidity()) return;
      const formData = new FormData(form);
      const values = Object.fromEntries(formData.entries());
      values.lot_tracking = formData.get("lot_tracking") === "on";
      const payload = model.itemPayload(values, item);
      let files;
      try {
        files = window.MNP_FACTORY_ATTACHMENTS.read(form.elements.extra_files);
      } catch (fileError) {
        errorBox.textContent = friendlyError(fileError);
        errorBox.hidden = false;
        return;
      }
      setFormBusy(form, true);
      try {
        const { data, error } = await sb.rpc("app_factory_save_item", payload);
        if (error) throw error;
        const warning = await window.MNP_FACTORY_ATTACHMENTS.upload("item", data.id, files);
        showToast(warning || (item ? "บันทึกการแก้ไขแล้ว" : `เพิ่ม Item ${data.code} แล้ว`), warning ? "error" : "success");
        location.hash = menu.url("item-list", { id: data.id }).slice(1);
      } catch (error) {
        // ข้อมูลที่กรอกยังอยู่ในฟอร์ม แก้แล้วกดบันทึกใหม่ได้
        setFormBusy(form, false);
        if (item) form.querySelectorAll('[name="item_type"], [name="unit_code"], [name="lot_tracking"]').forEach((node) => { node.disabled = true; });
        errorBox.textContent = friendlyError(error);
        errorBox.hidden = false;
        errorBox.scrollIntoView({ block: "nearest" });
      }
    });
  }

  // ---------- ประวัติ ----------
  function historyTable(entries, withItem = true) {
    return `<div class="table-wrap"><table>
        <thead><tr><th>เวลา</th>${withItem ? "<th>Item</th>" : ""}<th>การกระทำ</th><th>รุ่น</th><th>ช่องที่แก้</th><th>ผู้บันทึก</th></tr></thead>
        <tbody>${entries.map((entry) => {
          const fields = model.changedFields(entry.before_data, entry.after_data).map((key) => model.EDITABLE_FIELDS[key]);
          return `<tr>
            <td>${formatDate(entry.created_at, true)}</td>
            ${withItem ? `<td><a href="${escapeHtml(menu.url("item-list", { id: entry.item_id }))}"><strong>${escapeHtml(entry.code)}</strong></a><br><span class="muted small">${escapeHtml(entry.name)}</span></td>` : ""}
            <td>${entry.action === "create" ? "สร้าง Item" : "แก้ไข Item"}</td>
            <td>${escapeHtml(entry.version)}</td>
            <td>${entry.action === "create" ? "—" : escapeHtml(fields.join(", ") || "ไม่มีช่องที่เปลี่ยน")}</td>
            <td>${escapeHtml(entry.changed_by_name ?? "—")}</td>
          </tr>`;
        }).join("")}</tbody></table></div>`;
  }

  // ---------- Routing ----------
  function routingHtml(data, params) {
    const routings = data.routings ?? [];
    if (!routings.length) return emptyData("ขั้นตอนการผลิต (Routing)");
    const routing = routings.find((row) => row.id === params.get("routing")) ?? routings[0];
    const steps = (data.steps ?? []).filter((step) => step.routing_id === routing.id);
    return `${notice("ลำดับงานตัวอย่างและเวลาต่อชุดผลิต ต้องตรวจสอบกับกระบวนการจริงก่อนนำไปใช้")}
      <section class="card">
        <div class="field"><label for="fm-routing">เลือกสินค้า</label><select class="select" id="fm-routing">${options(routings.map((row) => [row.id, `${row.code} · ${row.name} (Rev. ${row.revision})`]), routing.id)}</select></div>
        <div class="fm-detail-head"><h2>${escapeHtml(routing.name)}</h2><span>Revision ${escapeHtml(routing.revision)} · ${docStatus(routing.status)}</span></div>
        <ol class="fm-steps">${steps.map((step) => `<li>
            <span class="fm-step-no">${escapeHtml(step.sequence)}</span>
            <div><strong>${escapeHtml(step.name)}</strong><span class="muted small">${escapeHtml(step.work_center)}</span>${step.instruction ? `<small>${escapeHtml(step.instruction)}</small>` : ""}</div>
            <div class="fm-step-time"><strong>${qty(step.run_minutes)} นาที</strong><small>เตรียมเครื่อง ${qty(step.setup_minutes)} นาที</small></div>
          </li>`).join("")}</ol>
      </section>`;
  }

  function bindRouting(root, params) {
    const select = root.querySelector("#fm-routing");
    select?.addEventListener("change", () => { location.hash = menu.url(params.get("item"), { routing: select.value }).slice(1); });
  }

  // ---------- คลัง ----------
  const STOCK_FILTERS = [["all", "ทุกรายการ"], ["low", "เฉพาะต่ำกว่าขั้นต่ำ"]];

  function inventoryHtml(data, params) {
    if (!(data.items ?? []).length) return emptyData("สินค้าคงคลัง");
    const lowIds = new Set(model.lowStockItems(data.items).map((item) => item.id));
    const q = model.normalizeQuery(params?.get("q"));
    const status = STOCK_FILTERS.some(([value]) => value === params?.get("status")) ? params.get("status") : "all";
    const rows = (data.inventory ?? [])
      .filter((row) => status === "all" || lowIds.has(row.item_id))
      .filter((row) => model.matchesQuery([row.code, row.name, row.warehouse, row.lot_number], q));
    const warehouses = (data.warehouses ?? []).map((warehouse) => warehouse.name).join(" · ");
    return `<section class="card fm-list">
        <p class="fm-meta">${(data.warehouses ?? []).length} คลัง${warehouses ? ` (${escapeHtml(warehouses)})` : ""} · Item ต่ำกว่าขั้นต่ำ ${lowIds.size} รายการ (รวมทุกคลังต่อ Item)</p>
        ${listToolbar({ entry: "inventory-view", q, status, statuses: STOCK_FILTERS, placeholder: "รหัส ชื่อ คลัง หรือเลขล็อต", statusLabel: "สถานะคงเหลือ" })}
        ${rows.length ? `<div class="table-wrap"><table class="fm-table">
          <thead><tr><th>Item</th><th class="fm-opt">คลัง</th><th class="fm-opt">ล็อต</th><th class="right">คงเหลือ</th><th>สถานะรวม Item</th></tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td><a class="fm-item-link" href="${escapeHtml(menu.url("item-list", { id: row.item_id }))}"><strong>${escapeHtml(row.code)}</strong><span>${escapeHtml(row.name)}</span></a></td>
            <td class="fm-opt">${escapeHtml(row.warehouse)}</td>
            <td class="fm-opt">${row.lot_number ? `<code>${escapeHtml(row.lot_number)}</code>` : '<span class="muted">ไม่ติดตามล็อต</span>'}</td>
            <td class="right fm-num">${qty(row.quantity)} ${escapeHtml(row.unit_code)}</td>
            <td>${lowIds.has(row.item_id) ? '<span class="badge pending_approval">ต่ำกว่าขั้นต่ำ</span>' : '<span class="muted">ปกติ</span>'}</td>
          </tr>`).join("")}</tbody></table></div>` : '<div class="empty">ไม่พบรายการคงเหลือที่ตรงกับการค้นหา</div>'}
        <p class="muted small">ยอดคงเหลือ = ผลรวมรายการเคลื่อนไหวของแต่ละคลังและล็อต</p>
      </section>`;
  }

  // ---------- ลงทะเบียน view ----------
  // สร้างตอนวาดหน้า (ไฟล์นี้โหลดก่อน app.js จึงเรียก escapeHtml ตอนโหลดไฟล์ไม่ได้)
  const newItemAction = () => `<a class="btn" href="${escapeHtml(menu.url("item-new"))}"><span class="plus-icon" aria-hidden="true"></span> เพิ่ม Item ใหม่</a>`;

  const VIEWS = {
    async items({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const id = params.get("id");
      if (id) {
        const item = (data.items ?? []).find((row) => row.id === id);
        const back = { href: menu.url("item-list"), label: "‹ กลับทะเบียนสินค้า" };
        if (!item) return frame.paint({ back, body: `<section class="card"><div class="empty">${escapeHtml(ERROR_MESSAGES.ITEM_NOT_FOUND)}</div></section>` });
        if (params.get("edit")) {
          const root = frame.paint({ back: { href: menu.url("item-list", { id: item.id }), label: "‹ กลับรายละเอียด" }, subtitle: `แก้ไข ${item.code}`, body: formHtml(data, item) });
          return bindForm(root, item);
        }
        return frame.paint({ back, subtitle: item.code, body: detailHtml(data, item) });
      }
      const root = frame.paint({ actions: newItemAction(), body: listHtml(data, params) });
      bindList(root);
    },
    async "item-new"({ frame }) {
      frame.loading();
      const data = await loadData();
      const root = frame.paint({ body: formHtml(data, null) });
      bindForm(root, null);
    },
    async history({ frame }) {
      frame.loading();
      const data = await loadData();
      const entries = data.history ?? [];
      frame.paint({ body: `<section class="card"><p class="muted small">50 รายการล่าสุด · เก็บ snapshot ก่อน/หลังทุกครั้งที่บันทึก</p>
        ${entries.length ? historyTable(entries) : '<div class="empty">ยังไม่มีการเพิ่ม/แก้ไข Item ในโหมดทดสอบ</div>'}</section>` });
    },
    async routing({ params, frame }) {
      frame.loading();
      const data = await loadData();
      const root = frame.paint({ body: routingHtml(data, params) });
      bindRouting(root, params);
    },
    async inventory({ params, frame }) {
      frame.loading();
      const data = await loadData();
      bindListToolbar(frame.paint({ body: inventoryHtml(data, params) }));
    },
  };

  window.MNP_FACTORY_VIEWS = VIEWS;
  window.MNP_FACTORY_ERRORS = ERROR_MESSAGES;
  window.MNP_FACTORY_UI = { loadData, qty, label, options, notice, docStatus, typeBadge, emptyData, listToolbar, bindListToolbar, stepper, fold, SEARCH_ICON };
})();
