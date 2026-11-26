// ทะเบียนสิทธิ์ผู้ใช้ (itua) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=access (ระบบสำนักงาน › IT SUPPORT › ทะเบียนสิทธิ์ผู้ใช้)
//
// หน้าของโมดูล (ทุกหน้ามีเส้นทางของตัวเอง ปุ่มย้อนกลับของเบราว์เซอร์ใช้ได้):
//   #/office?module=access               = ตารางรวมผู้ใช้ (ค้นหา + กรองแผนก/ฝ่าย/สถานะ + พิมพ์ + ส่งออก + เพิ่มผู้ใช้)
//   #/office?module=access&view=matrix   = เมทริกซ์ ผู้ใช้ × โฟลเดอร์ (ดูอย่างเดียว) + พิมพ์ A4 แนวนอน + ส่งออก
//   #/office?module=access&view=catalog  = ตั้งค่า: รายการโฟลเดอร์/โปรแกรม (เพิ่ม/แก้/ปิดใช้งาน ลบไม่ได้)
//   #/office?module=access&user=<uuid>   = หน้าต่อคน: ข้อมูลหลัก สิทธิ์ อีเมล ประวัติ + แก้ไขโดย IT (ทุกการแก้ต้องมีเหตุผลตามที่ฐานข้อมูลบังคับ)
// ฐานข้อมูล: supabase/migrations/20270105010000_itua_user_access_register.sql ทุกอย่างเรียกผ่าน RPC app_itua_* · สัญญา: docs/itua-contract.md
// สิทธิ์: เฉพาะผู้อยู่ใน allowlist เดียวกับทะเบียนอุปกรณ์ IT (itas_admins) · การ์ดและหน้านี้ซ่อน/พากลับเมื่อไม่มีสิทธิ์ เป็น UX ล้วน สิทธิ์จริงตัดสินที่ RPC ทุกตัว
//   ใช้ผลตรวจสิทธิ์ของ window.MNP_ITAS (app_itas_my_access ตัวเดียวกัน เก็บผลชุดเดียว ไม่ยิง RPC ซ้ำ) · ไม่มี MNP_ITAS = ถือว่าไม่มีสิทธิ์
// ข้อมูลล้วนอยู่ที่ itua-model.js · HTML อยู่ที่ itua-pages.js · ไฟล์นี้ดูแลเฉพาะการเรียก RPC และผูกเหตุการณ์
// โมดูลนี้ไม่มีช่องลับ (รหัสผ่าน/License) และไม่เก็บอะไรลงเครื่อง (ไม่มี localStorage / ร่างอัตโนมัติ)
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, showToast, confirmDialog,
// setFormBusy, setButtonBusy, renderRoute, go) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerItuaModule() {
  const model = window.MNP_ITUA_MODEL;
  const pages = window.MNP_ITUA_PAGES;
  if (!model || !pages) return;

  const PATH = "office"; // หน้าของโมดูลนี้ใช้เส้นทางของระบบสำนักงาน (เมนูข้างไฮไลต์ "ระบบสำนักงาน")
  const TITLE = "ทะเบียนสิทธิ์ผู้ใช้";
  const PURGE_TEXT = "ล้างข้อมูลทะเบียนสิทธิ์ผู้ใช้ทดสอบ";
  const ACCESS_CHECK_FAILED = "ตรวจสิทธิ์ไม่ได้ กรุณาลองใหม่อีกครั้ง";
  const LOG_LIMIT = 200; // ประวัติต่อคนที่ขอจากฐานข้อมูล (ค่าเริ่มต้นของ get_user)

  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let pageHash = ""; // location.hash ตอนเริ่มวาดหน้าล่าสุด
  let ui = null; // สถานะหน้าจอ (ไม่มีความลับ) · รีเซ็ตเมื่อบริบทเปลี่ยน/ออกจากระบบ
  let watching = false;

  const isSandbox = () => Boolean(state.sandbox?.active);
  // บริบท = ใคร + โหมดไหน (state.employee ถูกแทนด้วย persona ตอนอยู่ในโหมดทดสอบ) · เปลี่ยนเมื่อไรข้อมูลที่โหลดไว้ทิ้งทั้งหมด
  const contextKey = () => [state.session?.user?.id ?? "", state.employee?.id ?? "", isSandbox() ? "test" : "real"].join("|");

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  // error ของ RPC: ข้อความไทยของฐานข้อมูลส่งต่อตรง ๆ · ที่เหลือส่งเข้า log ของ master (ยกเว้นแก้ชนกัน ซึ่งเป็นเรื่องปกติ)
  function failure(error, { write = false } = {}) {
    const info = model.describeError(error, { write });
    if (!info.forwarded && info.kind !== "conflict") window.MNP_ERROR_LOG?.report(error);
    return info;
  }

  /* ---------- สิทธิ์ของโมดูล (ใช้ allowlist ชุดเดียวกับทะเบียนอุปกรณ์ IT) ---------- */
  const resolveAccess = async () => Boolean(await window.MNP_ITAS?.resolveAccess?.());
  const hasAccess = () => Boolean(window.MNP_ITAS?.hasAccess?.());
  const accessStatus = () => window.MNP_ITAS?.accessStatus?.() ?? "denied";

  const onAccessPage = () => {
    const hash = location.hash;
    if (!hash.startsWith("#/office")) return false;
    return new URLSearchParams(hash.split("?")[1] ?? "").get("module") === "access";
  };
  const root = () => document.querySelector(".itua-page");
  const byId = (id) => document.getElementById(id);
  const newUuid = () => {
    const cryptoApi = window.crypto;
    if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  };

  // route = ผลของ model.readRoute · list/matrix/catalog/detail/catalog = ข้อมูลที่โหลดล่าสุดของแต่ละหน้า
  function resetUi() {
    ui = { context: contextKey(), route: null, filters: { query: "", department: "", division: "", status: "" }, list: null, matrix: null, catalog: null, detail: null, form: null, isTest: false };
  }
  const stale = (version) => version !== pageVersion || location.hash !== pageHash;

  /* ---------- วาดหน้า ---------- */
  function paint(html, version) {
    if (stale(version)) return false;
    app.innerHTML = shell(html, PATH, TITLE);
    bindShell();
    bindPage();
    return true;
  }
  function errorPage(error, version) {
    const info = failure(error);
    if (!paint(pages.page(`${pages.head({ title: TITLE })}${pages.errorCard(info.message, { retry: info.kind === "unknown" })}`), version)) return;
    byId("itua-retry")?.addEventListener("click", () => renderRoute());
  }
  // ตรวจสิทธิ์ไม่ได้ (ไม่ใช่ไม่มีสิทธิ์): ข้อความ "ตรวจสิทธิ์ไม่ได้ ลองใหม่" พร้อมปุ่มลองอีกครั้ง
  function accessErrorPage(version) {
    if (!paint(pages.page(`${pages.head({ title: TITLE })}${pages.errorCard(ACCESS_CHECK_FAILED, { retry: true })}`), version)) return;
    byId("itua-retry")?.addEventListener("click", () => renderRoute());
  }

  async function render(params) {
    pageVersion += 1;
    const version = pageVersion;
    pageHash = location.hash;
    const route = model.readRoute(params);
    if (!route) return renderNotFound();
    loadingShell(PATH, TITLE);
    ensureWatchers();
    if (!ui || ui.context !== contextKey()) resetUi();
    ui.form = null; // วาดหน้าใหม่ = ฟอร์มที่เปิดค้างไม่เกี่ยวแล้ว (ผู้ใช้ยืนยันทิ้งไปแล้วหรือไม่มีอะไรค้าง)
    ui.route = route;
    // สิทธิ์ตรวจอีกชั้น (module-office.js ตรวจแล้ว ใช้ผลที่เก็บไว้) · ไม่มีสิทธิ์จริง = พากลับหน้าหลักโดยไม่เรียก RPC อื่น · ตรวจไม่ได้ชั่วคราว = แจ้งให้ลองใหม่
    const allowed = await resolveAccess();
    if (stale(version)) return; // ผู้ใช้ออกจากหน้านี้ไปแล้วระหว่างรอ: ไม่ไปทับหน้าที่เขาอยู่
    if (!allowed) {
      if (accessStatus() === "error") return accessErrorPage(version);
      go("dashboard");
      return;
    }
    ui.isTest = isSandbox();
    try {
      await loadRouteData(route);
    } catch (error) {
      return errorPage(error, version);
    }
    if (stale(version)) return;
    paint(pages.pageShell({ view: route.view, isTest: ui.isTest, body: bodyHtml(route) }), version);
  }

  /* ---------- โหลดข้อมูล / วาดเนื้อหา ---------- */
  async function loadRouteData(route) {
    if (route.view === "list") {
      const data = await rpc("app_itua_list_users", { p_limit: model.MAX_LISTED, p_offset: 0 });
      ui.list = { rows: Array.isArray(data?.items) ? data.items : [], total: Number.isFinite(data?.total) ? data.total : 0 };
    } else if (route.view === "matrix") {
      const data = await rpc("app_itua_matrix", { p_limit: model.MAX_LISTED, p_offset: 0 });
      ui.matrix = { rows: Array.isArray(data?.rows) ? data.rows : [], folders: Array.isArray(data?.folders) ? data.folders : [], total: Number.isFinite(data?.total) ? data.total : 0 };
    } else if (route.view === "catalog") {
      ui.catalog = await rpc("app_itua_list_catalog");
    } else {
      // หน้าต่อคน: ข้อมูลคน + รายการโฟลเดอร์/โปรแกรม (ใช้แปลงรหัสในประวัติเป็นชื่อ และเป็นตัวเลือกในฟอร์มสิทธิ์)
      const [detail, catalog] = await Promise.all([rpc("app_itua_get_user", { p_id: route.id, p_log_limit: LOG_LIMIT }), rpc("app_itua_list_catalog")]);
      if (!detail?.user) throw Object.assign(new Error("ไม่พบผู้ใช้นี้"), { message: "ไม่พบผู้ใช้นี้" });
      ui.detail = detail;
      ui.catalog = catalog;
    }
  }
  const catalogNames = () => ({
    folders: Object.fromEntries((ui.catalog?.folders ?? []).map((item) => [item.code, item.name])),
    programs: Object.fromEntries((ui.catalog?.programs ?? []).map((item) => [item.code, item.name])),
  });
  // แถวตามตัวกรอง (รายการ/เมทริกซ์ใช้ตัวกรองชุดเดียวกัน ค้างไว้ตอนย้อนกลับจากหน้าต่อคน)
  const filteredRows = () => (ui.route?.view === "matrix" ? model.filterUsers(ui.matrix?.rows ?? [], ui.filters) : model.filterUsers(ui.list?.rows ?? [], ui.filters));
  const sourceRows = () => (ui.route?.view === "matrix" ? ui.matrix?.rows ?? [] : ui.list?.rows ?? []);
  const totalCount = () => (ui.route?.view === "matrix" ? ui.matrix?.total : ui.list?.total) ?? sourceRows().length;
  const truncatedNotice = () => (totalCount() > sourceRows().length ? `มี ${totalCount()} คน แต่โหลดมาแสดงได้ ${sourceRows().length} คนแรก` : "");
  function tableHtml(rows) {
    return ui.route?.view === "matrix" ? pages.matrixTable({ rows, folders: ui.matrix?.folders ?? [] }) : pages.userTable(rows);
  }
  function listBodyHtml(route) {
    const rows = filteredRows();
    const toolbar = pages.toolbar({ filters: ui.filters, departments: model.departmentOptions(sourceRows()), canAdd: route.view === "list", hasRows: rows.length > 0 });
    return pages.listPanel({
      title: route.view === "matrix" ? "เมทริกซ์สิทธิ์ผู้ใช้ × โฟลเดอร์" : "ผู้ใช้ในทะเบียน",
      toolbarHtml: toolbar,
      countText: [model.countText(rows.length, sourceRows().length), truncatedNotice()].filter(Boolean).join(" · "),
      tableHtml: tableHtml(rows),
    });
  }
  function bodyHtml(route) {
    if (route.view === "catalog") return pages.catalogPage({ catalog: ui.catalog });
    if (route.view === "user") return pages.userBody({ detail: ui.detail, historyHtml: pages.historySection(model.logView(ui.detail, catalogNames()), { limit: LOG_LIMIT }) });
    return listBodyHtml(route);
  }
  // โหลดข้อมูลของหน้านี้ใหม่แล้ววาดเฉพาะเนื้อหา (ช่องฟอร์มอยู่นอกส่วนนี้ จึงไม่ถูกลบ) · ใช้หลังบันทึกสำเร็จ
  async function reloadBody() {
    const version = pageVersion;
    const hash = location.hash;
    const route = ui.route;
    await loadRouteData(route);
    if (version !== pageVersion || location.hash !== hash) return;
    const host = byId("itua-body-host");
    if (host) host.innerHTML = bodyHtml(route);
  }
  // ตัวกรองเปลี่ยน: วาดเฉพาะตาราง + จำนวน + สถานะปุ่มพิมพ์/ส่งออก (ไม่แตะช่องค้นหาที่กำลังพิมพ์อยู่)
  function updateTable() {
    const rows = filteredRows();
    const host = byId("itua-table-host");
    if (!host) return;
    host.innerHTML = tableHtml(rows);
    for (const id of ["itua-print", "itua-export"]) { const button = byId(id); if (button) button.disabled = rows.length === 0; }
    const count = byId("itua-count");
    if (count) count.textContent = [model.countText(rows.length, sourceRows().length), truncatedNotice()].filter(Boolean).join(" · ");
  }

  /* ---------- เหตุการณ์ของหน้า ---------- */
  function ensureWatchers() {
    if (watching) return;
    watching = true;
    // ออกจากระบบ: ทิ้งข้อมูลที่โหลดไว้ในหน่วยความจำ
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") ui = null; });
    window.addEventListener("hashchange", () => { if (!onAccessPage() && ui) ui.form = null; });
  }
  function bindPage() {
    const host = root();
    if (!host) return;
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput);
    host.addEventListener("change", onChange);
    host.addEventListener("submit", onSubmit);
    host.addEventListener("keydown", (event) => {
      const row = event.target.closest?.("[data-itua-row]");
      if (row && event.target === row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openUserPage(row.dataset.ituaRow); }
    });
    host.addEventListener("focusout", (event) => {
      const input = event.target.closest?.("[data-date-text]");
      if (!input) return;
      const iso = model.parseDateInput(input.value);
      if (iso) input.value = model.dateInputText(iso); // เติมรูปแบบ พ.ศ. ให้เห็นว่าตีความเป็นปีไหน (พิมพ์ผิดปล่อยไว้ รอตรวจตอนบันทึก)
    });
  }
  const BUTTONS = {
    "itua-print": () => printCurrent(),
    "itua-export": () => exportCsv(),
    "itua-add": () => openUserForm("add"),
    "itua-form-back": () => (ui?.form?.submitting ? undefined : closeForm()),
    "itua-form-cancel": () => (ui?.form?.submitting ? undefined : closeForm()),
    "itua-edit-user": () => openUserForm("edit"),
    "itua-change-status": () => openStatusForm(),
    "itua-edit-grants": () => openGrantsForm(),
    "itua-add-email": () => openEmailAddForm(),
    "itua-add-folder": () => openCatalogForm("folder", "add"),
    "itua-add-program": () => openCatalogForm("program", "add"),
    "itua-reload": () => reloadAfterConflict(),
    "itua-purge": (button) => purge(button),
  };
  function onClick(event) {
    const target = event.target;
    const button = target.closest?.("button, [data-itua-row]");
    if (!button) return undefined;
    // คืน promise ของงานที่เริ่ม (ไม่มีใครรอในหน้าจริง แต่ทำให้ทดสอบรอจนจบได้)
    if (button.id && BUTTONS[button.id]) return BUTTONS[button.id](button);
    if (button.dataset.ituaCloseEmail !== undefined) return openEmailCloseForm(button.dataset.ituaCloseEmail);
    if (button.dataset.ituaEditFolder !== undefined) return openCatalogForm("folder", "edit", button.dataset.ituaEditFolder);
    if (button.dataset.ituaEditProgram !== undefined) return openCatalogForm("program", "edit", button.dataset.ituaEditProgram);
    // กดที่แถวตาราง (ไม่ใช่ลิงก์ในแถว ซึ่งเบราว์เซอร์พาไปเอง) = เปิดหน้าต่อคน
    if (button.dataset.ituaRow !== undefined && !target.closest("a")) return openUserPage(button.dataset.ituaRow);
    return undefined;
  }
  function onInput(event) {
    if (event.target.id === "itua-search") { ui.filters.query = event.target.value; updateTable(); }
  }
  function onChange(event) {
    const id = event.target.id;
    if (id === "itua-dept") { ui.filters.department = event.target.value; updateTable(); }
    else if (id === "itua-division") { ui.filters.division = event.target.value; updateTable(); }
    else if (id === "itua-status") { ui.filters.status = event.target.value; updateTable(); }
  }
  function onSubmit(event) {
    const form = event.target;
    if (!form.id) return undefined;
    event.preventDefault();
    const handler = { "itua-user-form": submitUser, "itua-status-form": submitStatus, "itua-grants-form": submitGrants, "itua-email-add-form": submitEmailAdd, "itua-email-close-form": submitEmailClose, "itua-catalog-form": submitCatalog }[form.id];
    return handler?.(form);
  }
  // เปิดหน้าต่อคน (มีเส้นทางของตัวเอง) · ฟอร์มที่พิมพ์ค้างถูกกันโดยตัวป้องกันการออกจากหน้าของ app.js (unsavedCount)
  function openUserPage(id) {
    if (model.isUuid(id)) location.hash = model.userUrl(id);
  }

  /* ---------- ฟอร์ม (เปิดเหนือเนื้อหา ทีละฟอร์ม) ---------- */
  const formEl = () => (ui?.form ? byId(ui.form.formId) : null);
  // ค่าทุกช่องของฟอร์มเป็นข้อความเดียว ไว้เทียบว่ามีสิ่งที่พิมพ์ค้างหรือไม่
  const snapshot = (form) => JSON.stringify(Array.from(form?.elements ?? []).filter((item) => item.name).map((item) => [item.name, item.type === "checkbox" ? Boolean(item.checked) : String(item.value ?? "")]));
  function isDirty() {
    const form = ui?.form && formEl();
    return Boolean(form && onAccessPage() && snapshot(form) !== ui.form.initial);
  }
  // ผู้ใช้ออกจากหน้า/เปลี่ยนหน้าไปแล้วต้องไม่ถือว่ายังมีฟอร์มค้าง (ล้างสถานะ แล้วคืน 0) · app.js ถามก่อนออกเมื่อ > 0
  function unsavedCount() {
    if (!ui?.form) return 0;
    if (location.hash !== pageHash || !onAccessPage()) { ui.form = null; return 0; }
    return isDirty() ? 1 : 0;
  }
  async function confirmDiscard() {
    if (!isDirty()) return true;
    return confirmDialog({ title: "ยังไม่ได้บันทึกสิ่งที่กรอก", message: "ถ้าไปต่อ ข้อมูลที่พิมพ์ในฟอร์มจะหาย", confirmLabel: "ทิ้งและไปต่อ", cancelLabel: "อยู่ต่อ", danger: true });
  }
  // formId = id ของ <form> · reopen = ฟังก์ชันเปิดฟอร์มเดิมใหม่ด้วยข้อมูลล่าสุด (ใช้ตอนแก้ชนกัน) · context = ข้อมูลที่ตัวส่งต้องใช้
  function mountForm(html, { formId, context = {}, reopen = null }) {
    const host = byId("itua-form-area");
    if (!host) return false;
    host.innerHTML = html;
    ui.form = { formId, context, reopen, initial: "", submitting: false };
    ui.form.initial = snapshot(formEl());
    host.scrollIntoView?.({ block: "start" });
    formEl()?.querySelector?.("input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])")?.focus?.();
    return true;
  }
  function closeForm({ force = false } = {}) {
    if (!force && isDirty()) { confirmDiscard().then((ok) => { if (ok) closeForm({ force: true }); }); return; }
    const host = byId("itua-form-area");
    if (host) host.innerHTML = "";
    if (ui) ui.form = null;
  }
  function formMessage(message, { reload = false } = {}) {
    const target = byId("itua-form-message");
    if (!target) return;
    target.innerHTML = pages.messageBox(message, { reload });
    // ปุ่มบันทึกอยู่ที่หัวฟอร์มแบบติดขอบบน: ผู้ใช้อาจเลื่อนลงไปไกลจากกล่องข้อความ → เลื่อนให้เห็น + แจ้งซ้ำเป็น toast กันพลาด
    target.scrollIntoView?.({ block: "nearest" });
    showToast(message, "error");
  }
  // ข้อผิดพลาดต่อช่อง (กรอบแดง + โฟกัสช่องแรก) · errors = [{ field, message }]
  function showFieldErrors(form, errors) {
    const focus = window.MNP_FORM_STEPS?.showFieldErrors?.(form, errors.map((item) => ({ name: item.field, message: item.message })));
    focus?.focus?.();
    if (!focus) showToast(errors[0].message, "error");
  }
  const readText = (form, name) => String(form.elements?.[name]?.value ?? "");
  // เริ่มส่ง: กันกดซ้ำ + ล้างข้อความเก่า · คืนสถานะของฟอร์มที่เปิดอยู่ หรือ null ถ้าไม่มีฟอร์ม/กำลังส่งอยู่
  function beginSubmit(form) {
    const state0 = ui?.form;
    if (!state0 || state0.submitting) return null;
    window.MNP_FORM_STEPS?.clearFieldErrors?.(form);
    const message = byId("itua-form-message");
    if (message) message.innerHTML = "";
    return state0;
  }
  // ส่ง RPC: ระหว่างส่งปุ่มถูกปิด · สำเร็จ = คืนผลลัพธ์ · ล้ม = แสดงข้อความ (แก้ชนกันมีปุ่มโหลดข้อมูลล่าสุด) แล้วคืน undefined
  async function submitWith(form, state0, work) {
    state0.submitting = true;
    setFormBusy(form, true);
    try {
      return { result: await work() };
    } catch (error) {
      setFormBusy(form, false);
      state0.submitting = false;
      const info = failure(error, { write: true });
      formMessage(info.message, { reload: info.kind === "conflict" });
      return { error };
    }
  }
  async function afterSave(message) {
    closeForm({ force: true });
    showToast(message);
    try {
      await reloadBody();
    } catch (error) {
      showToast(failure(error).message, "error"); // บันทึกแล้ว แต่โหลดหน้าใหม่ไม่สำเร็จ: ให้กดโหลดหน้าเอง
    }
  }
  // แก้ชนกัน: ผู้ใช้เลือกโหลดข้อมูลล่าสุดเอง (ทิ้งสิ่งที่พิมพ์ หลังถามก่อน) ไม่ทิ้งเงียบ ๆ แล้วเปิดฟอร์มเดิมด้วยข้อมูลใหม่
  async function reloadAfterConflict() {
    const reopen = ui?.form?.reopen;
    if (!reopen) return;
    if (!(await confirmDialog({ title: "โหลดข้อมูลล่าสุด?", message: "ข้อมูลที่คุณพิมพ์ไว้ในฟอร์มนี้จะหาย แล้วแสดงข้อมูลล่าสุดที่คนอื่นบันทึกไว้", confirmLabel: "โหลดข้อมูลล่าสุด", cancelLabel: "อยู่ต่อ", danger: true }))) return;
    try {
      await reloadBody();
      closeForm({ force: true });
      await reopen();
    } catch (error) {
      formMessage(failure(error).message);
    }
  }

  /* ---------- แก้ไขข้อมูลหลัก / เพิ่มผู้ใช้ ---------- */
  async function openUserForm(mode) {
    if (!(await confirmDiscard())) return;
    const user = mode === "edit" ? ui.detail?.user : null;
    if (mode === "edit" && !user) return;
    const values = mode === "edit" ? model.userValuesFromUser(user) : model.emptyUserValues();
    mountForm(pages.userForm({ mode, values, user }), { formId: "itua-user-form", context: { mode, original: user, draftId: mode === "add" ? newUuid() : null }, reopen: () => openUserForm(mode) });
  }
  const readUserValues = (form) => Object.fromEntries(model.USER_FIELDS.map((field) => [field.key, readText(form, field.key)]));
  async function submitUser(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const { mode, original, draftId } = state0.context;
    const values = readUserValues(form);
    const errors = model.validateUser(values);
    if (errors.length) return showFieldErrors(form, errors);
    const reason = readText(form, "reason");
    const payload = model.buildUserPayload({ original, values, reason, userId: draftId });
    if (mode === "edit") {
      if (model.payloadIsEmpty(payload)) { showToast("ไม่มีการเปลี่ยนแปลง"); return; }
      const problem = model.reasonProblem(reason);
      if (problem) return showFieldErrors(form, [{ field: "reason", message: problem }]);
    }
    const outcome = await submitWith(form, state0, async () => {
      try {
        return await rpc("app_itua_save_user", payload);
      } catch (error) {
        // ลองบันทึกซ้ำหลังเน็ตหลุด แต่ครั้งแรกสำเร็จไปแล้ว → โหลดแถวมาแสดงว่าบันทึกแล้ว
        if (mode === "add" && model.isAlreadyExists(error)) return { user: (await rpc("app_itua_get_user", { p_id: draftId, p_log_limit: 1 })).user, created: true, changed: true };
        throw error;
      }
    });
    if (outcome.error) return;
    const { result } = outcome;
    if (mode === "add") {
      closeForm({ force: true });
      showToast("เพิ่มผู้ใช้แล้ว ต่อไปกำหนดสิทธิ์และอีเมลที่หน้านี้");
      if (result?.user?.id) openUserPage(result.user.id);
      return;
    }
    await afterSave(result?.changed === false ? "ไม่มีการเปลี่ยนแปลง" : "บันทึกการแก้ไขแล้ว");
  }

  /* ---------- เปลี่ยนสถานะ ---------- */
  async function openStatusForm() {
    const detail = ui.detail;
    if (!detail || !(await confirmDiscard())) return;
    const target = detail.user.status === "active" ? "resigned" : "active";
    mountForm(pages.statusForm({ user: detail.user, target, remaining: model.holdingsOf(detail) }), { formId: "itua-status-form", context: { target, userId: detail.user.id }, reopen: () => openStatusForm() });
  }
  async function submitStatus(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const { target, userId } = state0.context;
    const reason = readText(form, "reason");
    const problem = model.reasonProblem(reason);
    if (problem) return showFieldErrors(form, [{ field: "reason", message: problem }]);
    const outcome = await submitWith(form, state0, () => rpc("app_itua_set_status", { p_user_id: userId, p_status: target, p_reason: reason.trim() }));
    if (outcome.error) return;
    const { result } = outcome;
    if (target === "resigned" && model.hasHoldings(result?.remaining)) {
      // ระบบไม่ถอดสิทธิ์ให้เอง: เตือนให้ถอนต่อ (หน้าผู้ใช้ก็แสดงแถบเตือนเหมือนกัน)
      await afterSave(`เปลี่ยนเป็นลาออกแล้ว แต่ยังมีสิทธิ์เหลือ: ${model.holdingsText(result.remaining)} · กด "แก้ไขสิทธิ์" เพื่อถอนให้ครบ`);
      return;
    }
    await afterSave(result?.changed === false ? "สถานะเดิมอยู่แล้ว ไม่มีการเปลี่ยนแปลง" : target === "resigned" ? "เปลี่ยนเป็นลาออกแล้ว" : "กลับมาใช้งานแล้ว");
  }

  /* ---------- สิทธิ์ (แก้เป็นชุด) ---------- */
  async function openGrantsForm() {
    const detail = ui.detail;
    if (!detail || !(await confirmDiscard())) return;
    const formModel = model.grantFormModel({ detail, catalog: ui.catalog });
    mountForm(pages.grantsForm({ user: detail.user, formModel, next: model.currentGrantState(formModel) }), { formId: "itua-grants-form", context: { formModel }, reopen: () => openGrantsForm() });
  }
  // อ่านสิ่งที่ติ๊กอยู่ในฟอร์มเป็นสถานะสิทธิ์ (ช่องที่ปิดใช้ = ค่าเดิมของมัน)
  function readGrantState(form, formModel) {
    const named = (name) => form.elements?.[name];
    return {
      folders: Object.fromEntries(formModel.folders.map((item) => [item.code, String(named(`folder:${item.code}`)?.value ?? item.current ?? "")])),
      internet: Boolean(named("internet")?.checked),
      programs: Object.fromEntries(formModel.programs.map((item) => [item.code, { on: Boolean(named(`program:${item.code}`)?.checked), note: String(named(`note:${item.code}`)?.value ?? "") }])),
    };
  }
  async function submitGrants(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const { formModel } = state0.context;
    const next = readGrantState(form, formModel);
    const reason = readText(form, "reason");
    if (!model.buildGrantChanges(formModel, next).length) { showToast("ยังไม่ได้เปลี่ยนสิทธิ์ใด ๆ"); return; }
    const errors = model.validateGrants(formModel, next, reason);
    if (errors.length) return showFieldErrors(form, errors);
    const outcome = await submitWith(form, state0, () => rpc("app_itua_set_grants", model.grantParams(formModel, next, reason)));
    if (outcome.error) return;
    await afterSave(`บันทึกสิทธิ์แล้ว ${outcome.result?.applied ?? model.buildGrantChanges(formModel, next).length} รายการ`);
  }

  /* ---------- อีเมล ---------- */
  async function openEmailAddForm() {
    const detail = ui.detail;
    if (!detail || !(await confirmDiscard())) return;
    const canInternet = !(detail.emails ?? []).some((email) => email.kind === "internal" && email.status === "active");
    mountForm(pages.emailAddForm({ user: detail.user, canInternet }), { formId: "itua-email-add-form", context: { userId: detail.user.id }, reopen: () => openEmailAddForm() });
  }
  async function submitEmailAdd(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const values = { address: readText(form, "address"), kind: readText(form, "kind") };
    const errors = model.validateEmail(values);
    if (errors.length) return showFieldErrors(form, errors);
    const outcome = await submitWith(form, state0, () => rpc("app_itua_add_email", { p_user_id: state0.context.userId, p_address: values.address.trim(), p_kind: values.kind, p_reason: readText(form, "reason").trim() || null }));
    if (outcome.error) return;
    await afterSave("เพิ่มอีเมลแล้ว");
  }
  async function openEmailCloseForm(emailId) {
    const email = (ui.detail?.emails ?? []).find((item) => item.id === emailId);
    if (!email || !(await confirmDiscard())) return;
    mountForm(pages.emailCloseForm({ email }), { formId: "itua-email-close-form", context: { emailId: email.id }, reopen: () => openEmailCloseForm(emailId) });
  }
  async function submitEmailClose(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const reason = readText(form, "reason");
    const problem = model.reasonProblem(reason);
    if (problem) return showFieldErrors(form, [{ field: "reason", message: problem }]);
    const outcome = await submitWith(form, state0, () => rpc("app_itua_close_email", { p_email_id: state0.context.emailId, p_reason: reason.trim() }));
    if (outcome.error) return;
    await afterSave(outcome.result?.changed === false ? "อีเมลนี้ปิดอยู่แล้ว" : "ปิดอีเมลแล้ว");
  }

  /* ---------- ตั้งค่า: โฟลเดอร์ / โปรแกรม ---------- */
  async function openCatalogForm(kind, mode, code = "") {
    if (!(await confirmDiscard())) return;
    const list = kind === "folder" ? ui.catalog?.folders : ui.catalog?.programs;
    const original = mode === "edit" ? (list ?? []).find((item) => item.code === code) : null;
    if (mode === "edit" && !original) return;
    const values = original ? model.catalogValuesFromItem(kind, original) : model.emptyCatalogValues(kind);
    mountForm(pages.catalogForm({ kind, mode, values }), { formId: "itua-catalog-form", context: { kind, mode, original }, reopen: () => openCatalogForm(kind, mode, code) });
  }
  async function submitCatalog(form) {
    const state0 = beginSubmit(form);
    if (!state0) return;
    const { kind, mode, original } = state0.context;
    const values = { code: readText(form, "code"), name: readText(form, "name"), description: readText(form, "description"), sort: readText(form, "sort"), is_active: Boolean(form.elements?.is_active?.checked) };
    const existing = ((kind === "folder" ? ui.catalog?.folders : ui.catalog?.programs) ?? []).map((item) => item.code);
    const errors = model.validateCatalog(kind, mode, values, existing);
    if (errors.length) return showFieldErrors(form, errors);
    const reason = readText(form, "reason");
    if (mode === "edit") {
      if (!model.catalogChanged(kind, original, values)) { showToast("ไม่มีการเปลี่ยนแปลง"); return; }
      const problem = model.reasonProblem(reason);
      if (problem) return showFieldErrors(form, [{ field: "reason", message: problem }]);
    }
    const noun = kind === "folder" ? "โฟลเดอร์" : "โปรแกรม";
    const outcome = await submitWith(form, state0, () => (kind === "folder" ? rpc("app_itua_save_folder", model.folderParams(values, reason)) : rpc("app_itua_save_program", model.programParams(values, reason))));
    if (outcome.error) return;
    await afterSave(outcome.result?.created ? `เพิ่ม${noun}แล้ว` : `บันทึก${noun}แล้ว`);
  }

  /* ---------- พิมพ์ A4 แนวนอน / ส่งออก CSV ---------- */
  // ทั้งใบพิมพ์และไฟล์ส่งออกไม่มีช่องลับ (ตารางของโมดูลนี้ไม่มีช่องลับเลย) · ตามตัวกรองที่เห็นบนหน้าจอ
  // ใบพิมพ์แทรกเป็นลูกของ .itua-page ชั่วคราว (หน้าจอซ่อนไว้ ตอนพิมพ์ CSS ซ่อนส่วนอื่นทั้งหมด) แล้วเอาออกเมื่อพิมพ์/ปิดหน้าต่างพิมพ์เสร็จ (afterprint)
  // afterprint ไม่ยิงเสมอไปในทุกเบราว์เซอร์ (มือถือ/Safari บางรุ่น) จึงมีทางลบสำรอง: matchMedia("print") กลับเป็น false หรือผู้ใช้แตะ/กดคีย์/สลับกลับมาที่หน้านี้หลังพิมพ์ · ทุกทางเรียก finish ตัวเดียวกัน
  const removePrintSheets = () => document.querySelectorAll(".itua-sheet").forEach((node) => node.remove());
  let finishActivePrint = null; // ตัวเก็บกวาดของใบพิมพ์ที่ยังค้างอยู่ (มีได้ใบเดียว ใบใหม่แทนใบเก่าเสมอ)
  function printSheet(html) {
    const host = root();
    if (!host) return;
    finishActivePrint?.();
    removePrintSheets();
    host.insertAdjacentHTML("beforeend", html);
    let finished = false;
    let armed = false;
    let printMedia = null;
    const interactionEvents = ["pointerdown", "keydown"];
    const onPrintMediaChange = (event) => { if (!event.matches) finish(); };
    const onVisible = () => { if (document.visibilityState !== "hidden") finish(); };
    function finish() {
      if (finished) return;
      finished = true;
      if (finishActivePrint === finish) finishActivePrint = null;
      window.removeEventListener?.("afterprint", finish);
      printMedia?.removeEventListener?.("change", onPrintMediaChange);
      printMedia?.removeListener?.(onPrintMediaChange);
      for (const type of interactionEvents) document.removeEventListener?.(type, finish, true);
      document.removeEventListener?.("visibilitychange", onVisible);
      removePrintSheets();
    }
    // ทางสำรองเริ่มทำงานหลังสั่งพิมพ์แล้วเท่านั้น (ระหว่างหน้าต่างพิมพ์เปิดอยู่ห้ามเก็บใบทิ้ง ไม่งั้นตัวอย่างพิมพ์ว่าง)
    function armFallbacks() {
      if (finished || armed) return;
      armed = true;
      try {
        printMedia = window.matchMedia?.("print") ?? null;
        printMedia?.addEventListener?.("change", onPrintMediaChange);
        if (printMedia && !printMedia.addEventListener) printMedia.addListener?.(onPrintMediaChange);
      } catch { printMedia = null; }
      for (const type of interactionEvents) document.addEventListener?.(type, finish, true);
      document.addEventListener?.("visibilitychange", onVisible);
    }
    finishActivePrint = finish;
    window.addEventListener("afterprint", finish);
    try {
      window.print();
    } catch (error) {
      finish(); // สั่งพิมพ์ไม่ได้ = ไม่มีอะไรต้องรอ เก็บกวาดทันที
      throw error;
    } finally {
      armFallbacks();
    }
  }
  function printCurrent() {
    const rows = filteredRows();
    if (!rows.length) { showToast("ไม่มีรายการให้พิมพ์ตามตัวกรองนี้", "error"); return; }
    const matrix = ui.route?.view === "matrix";
    printSheet(pages.printSheet({
      title: matrix ? "เมทริกซ์สิทธิ์ผู้ใช้ × โฟลเดอร์" : TITLE,
      view: matrix ? model.matrixPrint({ rows, folders: ui.matrix?.folders ?? [] }) : model.listPrint(rows),
      filters: model.printFilterItems(ui.filters),
      countText: `${rows.length} คน`,
      printedAt: model.dateTimeText(new Date()),
      isTest: ui.isTest,
      matrix,
    }));
  }
  function downloadText(fileName, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function exportCsv() {
    const rows = filteredRows();
    if (!rows.length) { showToast("ไม่มีรายการให้ส่งออกตามตัวกรองนี้", "error"); return; }
    const matrix = ui.route?.view === "matrix";
    downloadText(model.csvFileName({ kind: matrix ? "matrix" : "list", isTest: ui.isTest }), matrix ? model.matrixCsv({ rows, folders: ui.matrix?.folders ?? [] }) : model.listCsv(rows), "text/csv;charset=utf-8");
    showToast(`ส่งออก ${rows.length} คนแล้ว`);
  }

  /* ---------- ล้างข้อมูลทดสอบ ---------- */
  async function purge(button) {
    if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะผู้ใช้ สิทธิ์ อีเมล ประวัติ และรายการโฟลเดอร์ทดสอบ (โปรแกรมตั้งต้นของโหมดทดสอบถูกสร้างกลับให้) ข้อมูลจริงไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
    setButtonBusy(button, true);
    try {
      const data = await rpc("app_sandbox_purge_itua");
      resetUi();
      showToast(model.purgeSummary({ deleted: Number(data?.deleted ?? 0) }).message);
      // ผู้ใช้ทดสอบที่ล้างไปแล้วไม่มีหน้าต่อคนให้เปิดต่อ: กลับรายการ
      if (ui?.route?.view === "user" || /[?&]user=/.test(location.hash)) { location.hash = model.listUrl(); return; }
      await renderRoute();
    } catch (error) {
      setButtonBusy(button, false);
      showToast(failure(error, { write: true }).message, "error");
    }
  }

  const api = Object.freeze({ render, resolveAccess, hasAccess, accessStatus, unsavedCount, version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT });
  window.MNP_ITUA = api;
  // ประกาศตัวเองให้การ์ดในเมนู "ระบบสำนักงาน" (วิธีเพิ่มโมดูลใหม่ดูที่หัวไฟล์ modules/office-sections.js) key = รหัสโมดูลของการ์ด · ไม่มีตัวเลขงานค้าง
  (window.MNP_OFFICE_CARDS ??= {})[model.ACCESS_CODE] = { version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT };
})();
