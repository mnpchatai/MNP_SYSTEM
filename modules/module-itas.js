// ทะเบียนอุปกรณ์ IT (itas) ของ Pilot Web — หน้าอยู่ใต้ #/office?module=assets (ระบบสำนักงาน › IT SUPPORT › ทะเบียนอุปกรณ์ IT)
//
// หน้าเดียว: รายการชนิดอุปกรณ์ (ซ้าย/บน) → ตารางของชนิดที่เลือก (ค้นหา/กรองสถานะ/เรียง) → ฟอร์มเพิ่ม/แก้ + ประวัติการแก้ไข/การย้าย · แถบสถานะตู้เซฟ (ตั้ง/ปลดล็อก/ล็อก/เปลี่ยนรหัส/รหัสกู้คืน)
// ฐานข้อมูล: supabase/migrations/20261222010000_itas_asset_register.sql ทุกอย่างเรียกผ่าน RPC app_itas_* · สัญญา: docs/itas-contract.md
// สิทธิ์: เฉพาะผู้อยู่ใน allowlist ของโมดูล (app_itas_my_access) · การ์ดและหน้านี้ซ่อน/พากลับเมื่อไม่มีสิทธิ์ เป็น UX ล้วน สิทธิ์จริงตัดสินที่ RPC ทุกตัว
// ข้อมูลล้วนอยู่ที่ itas-model.js · HTML อยู่ที่ itas-pages.js · เข้ารหัส/ตู้เซฟอยู่ที่ itas-vault.js (กุญแจอยู่ในตัวแปรปิดของไฟล์นั้นเท่านั้น) · ไฟล์นี้ดูแลเฉพาะการเรียก RPC และผูกเหตุการณ์
//
// กฎความปลอดภัยของไฟล์นี้:
//  - ค่าลับที่ถอดรหัสแล้วใส่ DOM ด้วย textContent เท่านั้น (ไม่ผ่าน innerHTML) และซ่อนคืนเองใน 30 วินาที · ไม่เก็บลงตัวแปร global/data-* / localStorage / URL
//  - ไม่ใช้ระบบร่างอัตโนมัติ (MNP_FORM_DRAFT) กับฟอร์มนี้เลย: ช่องลับและรหัสตู้เซฟจึงไม่เคยถูกเก็บลงเครื่อง
//  - ไม่มี console.* กับค่าใด ๆ ที่เกี่ยวกับตู้เซฟ · error ของตู้เซฟเป็นข้อความคงที่ (VaultError) · error ของ crypto ไม่ถูกส่งเข้า log (MNP_ERROR_LOG)
//  - ตู้เซฟล็อกเมื่อ: ไม่ใช้งาน 10 นาที · ออกจากหน้านี้ (hashchange) · ปิด/ซ่อนหน้า (pagehide) · ออกจากระบบ · เปลี่ยนผู้ใช้/โหมดทดสอบ/persona · กดล็อก
// ไฟล์นี้โหลดก่อน app.js (ดู index.html) เรียก helper ของ app.js (state, sb, app, shell, bindShell, loadingShell, renderNotFound, showToast, confirmDialog,
// setFormBusy, setButtonBusy, renderRoute, go) ได้เพราะถูกเรียกหลัง app.js โหลดเสร็จ
(function registerItasModule() {
  const model = window.MNP_ITAS_MODEL;
  const pages = window.MNP_ITAS_PAGES;
  const vaultApi = window.MNP_ITAS_VAULT;
  if (!model || !pages || !vaultApi) return;

  const PATH = "office"; // หน้าของโมดูลนี้ใช้เส้นทางของระบบสำนักงาน (เมนูข้างไฮไลต์ "ระบบสำนักงาน")
  const TITLE = "ทะเบียนอุปกรณ์ IT";
  const PURGE_TEXT = "ล้างข้อมูลทะเบียนอุปกรณ์ทดสอบ";
  const ACCESS_TTL_MS = 60 * 1000;
  const REVEAL_MS = 30 * 1000; // ค่าลับที่กด "แสดง" ซ่อนคืนเองเมื่อครบเวลา
  const ACTIVITY_THROTTLE_MS = 1000;
  const CONTEXT_CHECK_MS = 5000;
  // เหตุผลของการล็อกที่ต้องปิดแผงตู้เซฟทิ้ง (แผงอาจถือรหัสกู้คืน/ช่องรหัสอยู่)
  const LOCK_REASONS = new Set(["idle", "context", "leave", "pagehide", "signout", "reset", "manual"]);
  const LOCK_TOASTS = Object.freeze({
    idle: "ตู้เซฟถูกล็อกเพราะไม่ได้ใช้งานนาน 10 นาที", context: "ตู้เซฟถูกล็อกเพราะเปลี่ยนผู้ใช้หรือโหมด", leave: "ตู้เซฟถูกล็อกเพราะออกจากหน้าทะเบียน",
    pagehide: "ตู้เซฟถูกล็อก", signout: "ตู้เซฟถูกล็อกเพราะออกจากระบบ", reset: "ตู้เซฟถูกล็อก", manual: "ล็อกตู้เซฟแล้ว",
  });

  let pageVersion = 0; // หน้าเก่าที่โหลดช้ากว่าหน้าใหม่ต้องไม่วาดทับ
  let pageHash = ""; // location.hash ตอนเริ่มวาดหน้าล่าสุด
  let access = null; // { key, allowed, isTest, at } ผลของ app_itas_my_access ต่อบริบท (ผู้ใช้ + โหมดทดสอบ + persona)
  let ui = null; // สถานะหน้าจอ (ไม่มีความลับ) · รีเซ็ตเมื่อบริบทเปลี่ยน
  let watching = false;
  let activityAt = 0;
  let contextTimer = null;
  const revealTimers = new Map(); // ค่าลับที่กำลังแสดง: key → timer id

  const isSandbox = () => Boolean(state.sandbox?.active);
  // บริบท = ใคร + โหมดไหน (state.employee ถูกแทนด้วย persona ตอนอยู่ในโหมดทดสอบ) · เปลี่ยนเมื่อไรตู้เซฟล็อกเอง
  const contextKey = () => [state.session?.user?.id ?? "", state.employee?.id ?? "", isSandbox() ? "test" : "real"].join("|");

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  }
  // error ของ RPC: ข้อความไทยของฐานข้อมูลส่งต่อตรง ๆ · ที่เหลือส่งเข้า log ของ master (ยกเว้น error ของตู้เซฟ ซึ่งเป็นข้อความคงที่และไม่ต้องรายงาน)
  function failure(error, { write = false } = {}) {
    const info = model.describeError(error, { write });
    if (!info.forwarded && info.kind !== "vault" && info.kind !== "conflict") window.MNP_ERROR_LOG?.report(error);
    return info;
  }

  /* ---------- สิทธิ์ของโมดูล (ใช้ตัดสินว่าจะแสดงการ์ด) ---------- */
  // เรียกก่อนวาดหน้า #/office (module-office.js) · ผลเก็บ 60 วินาทีต่อบริบท · RPC ล้ม/ยังไม่มี = ไม่มีสิทธิ์ (ซ่อนการ์ดเงียบ ๆ) และไม่เก็บผลที่ล้ม
  async function resolveAccess() {
    const key = contextKey();
    if (access && access.key === key && Date.now() - access.at < ACCESS_TTL_MS) return access.allowed;
    try {
      const data = await rpc("app_itas_my_access");
      access = { key, allowed: data?.allowed === true, isTest: data?.is_test === true, at: Date.now() };
    } catch {
      access = null;
      return false;
    }
    return access.allowed;
  }
  const hasAccess = () => Boolean(access && access.key === contextKey() && access.allowed);

  /* ---------- ตู้เซฟ (ตัวเดียวของแท็บนี้) ---------- */
  const vault = vaultApi.createVault({
    server: {
      get: () => rpc("app_itas_vault_get"),
      init: (params) => rpc("app_itas_vault_init", params),
      rotate: (params) => rpc("app_itas_vault_rotate", params),
    },
    getContext: contextKey,
  });
  const onAssetsPage = () => {
    const hash = location.hash;
    if (!hash.startsWith("#/office")) return false;
    return new URLSearchParams(hash.split("?")[1] ?? "").get("module") === "assets";
  };

  function resetUi() {
    ui = { context: contextKey(), types: [], typeCode: "", rows: [], total: 0, query: "", status: "", sort: { key: "reg_no", direction: "ascending" }, form: null, isTest: false, busy: false };
  }
  const currentType = () => ui.types.find((type) => type.code === ui.typeCode) ?? null;

  /* ---------- วาดหน้า ---------- */
  function paint(html, title, version) {
    if (version !== pageVersion || location.hash !== pageHash) return false;
    app.innerHTML = shell(html, PATH, title);
    bindShell();
    return true;
  }
  function errorPage(error, version) {
    const info = failure(error);
    if (!paint(pages.page(`${pages.head({ title: TITLE })}${pages.errorCard(info.message, { retry: info.kind === "unknown" })}`), TITLE, version)) return;
    document.querySelector("#itas-retry")?.addEventListener("click", () => renderRoute());
  }
  const root = () => document.querySelector(".itas-page");
  const byId = (id) => document.getElementById(id);

  async function render(params) {
    pageVersion += 1;
    const version = pageVersion;
    pageHash = location.hash;
    if (!model.readView(params)) return renderNotFound();
    loadingShell(PATH, TITLE);
    ensureWatchers();
    vault.ensureContext();
    if (!ui || ui.context !== contextKey()) resetUi();
    ui.form = null; // วาดหน้าใหม่ = ฟอร์มที่เปิดค้างไม่เกี่ยวแล้ว (ผู้ใช้ยืนยันทิ้งไปแล้วหรือไม่มีอะไรค้าง)
    // สิทธิ์ตรวจซ้ำอีกชั้น (module-office.js ตรวจแล้ว) · ไม่มีสิทธิ์ = พากลับหน้าหลักโดยไม่เรียก RPC อื่น
    if (!(await resolveAccess())) { go("dashboard"); return; }
    ui.isTest = Boolean(access?.isTest);
    try {
      const [types] = await Promise.all([rpc("app_itas_list_types"), vault.load().catch((error) => { ui.vaultError = error; })]);
      ui.types = Array.isArray(types) ? types : [];
      if (!ui.types.some((type) => type.code === ui.typeCode)) ui.typeCode = (ui.types.find((type) => type.is_active !== false) ?? ui.types[0])?.code ?? "";
      await loadAssets();
    } catch (error) {
      return errorPage(error, version);
    }
    const html = pages.mainPage({ isTest: ui.isTest, vault: vault.snapshot(), content: pages.layout({ types: ui.types, selectedCode: ui.typeCode, main: mainPanelHtml() }) });
    if (!paint(html, TITLE, version)) return;
    bindPage();
    if (ui.vaultError) { showVaultMessage(ui.vaultError); ui.vaultError = null; }
  }

  async function loadAssets() {
    const type = currentType();
    if (!type) { ui.rows = []; ui.total = 0; return; }
    const data = await rpc("app_itas_list_assets", { p_type_code: type.code, p_limit: model.MAX_LISTED, p_offset: 0 });
    ui.rows = Array.isArray(data?.items) ? data.items : [];
    ui.total = Number.isFinite(data?.total) ? data.total : ui.rows.length;
  }
  const visibleRows = () => {
    const type = currentType();
    const columns = model.tableColumns(type);
    const filtered = model.filterAssets(ui.rows, { query: ui.query, status: ui.status });
    const column = columns.find((item) => item.key === ui.sort.key) ?? columns[0];
    return { columns, rows: model.sortAssets(filtered, column, ui.sort.direction) };
  };
  function mainPanelHtml() {
    const type = currentType();
    const { columns, rows } = visibleRows();
    return pages.mainPanel({
      type,
      toolbarHtml: pages.toolbar({ query: ui.query, status: ui.status, canAdd: Boolean(type) && type.is_active !== false }),
      countText: model.countText(rows.length, ui.total, ui.rows.length),
      tableHtml: pages.assetTable({ rows, columns, sort: ui.sort, typeName: type?.name ?? "" }),
      notice: ui.total > ui.rows.length ? `ชนิดนี้มี ${ui.total} รายการ แต่โหลดมาแสดงได้ ${ui.rows.length} รายการแรก ใช้คำค้นหาเพื่อให้ตรงมากขึ้น` : "",
    });
  }
  function updateTable() {
    const { columns, rows } = visibleRows();
    const host = byId("itas-table-host");
    if (!host) return;
    host.innerHTML = pages.assetTable({ rows, columns, sort: ui.sort, typeName: currentType()?.name ?? "" });
    const count = byId("itas-count");
    if (count) count.textContent = model.countText(rows.length, ui.total, ui.rows.length);
  }
  async function refreshData() {
    const types = await rpc("app_itas_list_types");
    ui.types = Array.isArray(types) ? types : ui.types;
    await loadAssets();
    const typesHost = byId("itas-types-host");
    if (typesHost) typesHost.innerHTML = pages.typeList(ui.types, ui.typeCode);
    updateTable();
  }

  /* ---------- ตู้เซฟ: แถบสถานะ แผง และเหตุการณ์ ---------- */
  function refreshVaultBar() {
    const host = byId("itas-vault-bar-host");
    if (host) host.innerHTML = pages.vaultBar(vault.snapshot());
  }
  function closeVaultPanel() {
    const host = byId("itas-vault-panel");
    if (host) host.innerHTML = ""; // ทิ้งช่องรหัสและรหัสกู้คืนที่แสดงอยู่ออกจากหน้า
    if (ui) ui.vaultPanel = null;
  }
  function showVaultPanel(kind, html) {
    const host = byId("itas-vault-panel");
    if (!host) return;
    host.innerHTML = html;
    ui.vaultPanel = kind;
    host.querySelector("input")?.focus();
    host.scrollIntoView?.({ block: "nearest" });
  }
  function showVaultMessage(error) {
    const info = failure(error, { write: true });
    const target = byId("itas-vault-message");
    if (target) target.innerHTML = `<div class="form-message error" role="alert"></div>`;
    const node = target?.firstElementChild;
    if (node) node.textContent = info.message; // textContent: ข้อความจาก error ไม่ผ่าน innerHTML
    else showToast(info.message, "error");
  }
  function setVaultBusy(form, busy) {
    setFormBusy(form, busy);
    const line = byId("itas-vault-busy");
    if (line) line.hidden = !busy;
  }
  // ล้างค่าในช่องรหัสทั้งแผงทันทีหลังใช้ (ไม่ให้รหัสค้างในช่องที่ถูกซ่อน/ปิดไป)
  const wipeInputs = (host) => host?.querySelectorAll("[data-vault-input]").forEach((input) => { input.value = ""; });

  function onVaultChange(event) {
    refreshVaultBar();
    if (event.status !== "unlocked") clearReveals();
    if (LOCK_REASONS.has(event.reason)) {
      wipeInputs(byId("itas-vault-panel"));
      closeVaultPanel();
      if (event.reason !== "pagehide") showToast(LOCK_TOASTS[event.reason] ?? "ตู้เซฟถูกล็อก", event.reason === "manual" ? "success" : "error");
    }
    if (ui?.form && (event.status !== "unlocked" || event.reason === "unlock" || event.reason === "setup")) refreshSecrets();
    // ตรวจบริบททุก 5 วินาทีขณะปลดล็อก (สลับ persona/ผู้ใช้โดยไม่ผ่านการวาดหน้าใหม่)
    if (event.status === "unlocked" && contextTimer === null) contextTimer = setInterval(() => vault.ensureContext(), CONTEXT_CHECK_MS);
    if (event.status !== "unlocked" && contextTimer !== null) { clearInterval(contextTimer); contextTimer = null; }
  }

  // ผู้ใช้กดในหน้าโมดูลนี้ = ยังใช้งานอยู่ (เริ่มนับ 10 นาทีใหม่)
  function noteActivity() {
    if (!onAssetsPage()) return;
    const now = Date.now();
    if (now - activityAt < ACTIVITY_THROTTLE_MS) return;
    activityAt = now;
    vault.touch();
  }
  function ensureWatchers() {
    if (watching) return;
    watching = true;
    vault.subscribe(onVaultChange);
    window.addEventListener("hashchange", () => { if (!onAssetsPage()) { vault.lock("leave"); ui && (ui.form = null); } });
    window.addEventListener("pagehide", () => vault.lock("pagehide"));
    window.addEventListener("beforeunload", (event) => { if (unsavedCount() > 0) { event.preventDefault(); event.returnValue = ""; } });
    for (const name of ["pointerdown", "keydown", "input", "touchstart"]) document.addEventListener(name, noteActivity, { passive: true });
    sb.auth.onAuthStateChange((event) => { if (event === "SIGNED_OUT") vault.lock("signout"); });
  }

  /* ---------- ผูกเหตุการณ์ของหน้า (delegation: เนื้อหาถูกวาดทับเป็นส่วน ๆ) ---------- */
  function bindPage() {
    const host = root();
    if (!host) return;
    host.addEventListener("click", onClick);
    host.addEventListener("input", onInput);
    host.addEventListener("change", onChange);
    host.addEventListener("submit", onSubmit);
    host.addEventListener("keydown", (event) => {
      const row = event.target.closest?.("[data-itas-row]");
      if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); openForm("edit", row.dataset.itasRow); }
    });
    host.addEventListener("focusout", (event) => {
      const input = event.target.closest?.("[data-date-text]");
      if (!input) return;
      const iso = model.parseDateInput(input.value);
      if (iso) input.value = model.dateInputText(iso); // เติมรูปแบบ พ.ศ. ให้เห็นว่าตีความเป็นปีไหน (พิมพ์ผิดปล่อยไว้ รอตรวจตอนบันทึก)
    });
  }
  const BUTTONS = {
    "itas-vault-setup": () => startSetup(),
    "itas-vault-unlock": () => showVaultPanel("unlock", pages.unlockForm({ isTest: vault.isTest === true })),
    "itas-vault-lock": () => vault.lock("manual"),
    "itas-vault-change": () => showVaultPanel("change", pages.changeForm()),
    "itas-vault-recovery": () => showVaultPanel("new-recovery", pages.newRecoveryForm()),
    "itas-vault-forgot": () => showVaultPanel("forgot", pages.forgotForm()),
    "itas-vault-cancel": () => { vault.cancelPending(); wipeInputs(byId("itas-vault-panel")); closeVaultPanel(); refreshVaultBar(); },
    "itas-recovery-copy": () => copyRecoveryCode(),
    "itas-add": () => openForm("add"),
    "itas-form-cancel": () => closeForm(),
    "itas-history-load": () => loadHistory(),
    "itas-purge": (button) => purge(button),
    "itas-reload-asset": () => reloadAfterConflict(),
  };
  function onClick(event) {
    const target = event.target;
    const button = target.closest?.("button, [data-itas-row]");
    if (!button) return;
    if (button.id && BUTTONS[button.id]) { BUTTONS[button.id](button); return; }
    if (button.dataset.itasType !== undefined) { switchType(button.dataset.itasType); return; }
    if (button.dataset.itasSort !== undefined) { toggleSort(button.dataset.itasSort); return; }
    if (button.dataset.secretAct !== undefined) { secretAction(button); return; }
    if (button.dataset.itasRow !== undefined && target.closest("[data-itas-row]")) openForm("edit", button.dataset.itasRow);
  }
  function onInput(event) {
    const target = event.target;
    if (target.id === "itas-search") { ui.query = target.value; updateTable(); }
    if (target.id === "itas-vault-pass" && byId("itas-vault-strength")) byId("itas-vault-strength").textContent = pages.strengthText(model.passwordStrength(target.value));
  }
  function onChange(event) {
    if (event.target.id === "itas-status") { ui.status = event.target.value; updateTable(); }
  }
  function onSubmit(event) {
    const form = event.target;
    if (!form.id) return;
    event.preventDefault();
    const handler = { "itas-vault-setup-form": submitSetup, "itas-recovery-form": submitRecovery, "itas-vault-unlock-form": submitUnlock, "itas-vault-forgot-form": submitForgot, "itas-vault-change-form": submitChange, "itas-vault-recovery-form": submitNewRecovery, "itas-form": submitAsset }[form.id];
    handler?.(form);
  }

  /* ---------- ตู้เซฟ: ขั้นตอนต่าง ๆ ---------- */
  function startSetup() {
    showVaultPanel("setup", pages.vaultSetupForm({ isTest: vault.isTest === true }));
  }
  const field = (form, name) => form.elements[name]?.value ?? "";
  const formError = (form, message) => {
    window.MNP_FORM_STEPS?.clearFieldErrors?.(form);
    const target = byId("itas-vault-message");
    if (target) { target.innerHTML = '<div class="form-message error" role="alert"></div>'; target.firstElementChild.textContent = message; }
  };
  // ตรวจรหัสใหม่ + พิมพ์ซ้ำ (ใช้ร่วมกันในหน้าตั้งตู้เซฟ/ลืมรหัส/เปลี่ยนรหัส) · คืนข้อความผิดพลาดหรือ ""
  function newPasswordProblem(password, again) {
    if (!model.passwordStrength(password).ok) return `รหัสตู้เซฟต้องยาวอย่างน้อย ${model.MIN_PASSWORD_LENGTH} ตัวอักษร`;
    if (password !== again) return "รหัสที่พิมพ์ยืนยันไม่ตรงกัน";
    return "";
  }
  async function guarded(form, work) {
    setVaultBusy(form, true);
    try {
      await work();
    } catch (error) {
      setVaultBusy(form, false);
      if (error?.reason === "AUTH_TOKEN_INVALID") vault.lock("manual"); // กุญแจไม่ผ่านการยืนยัน: ให้ปลดล็อกใหม่ตามสัญญา
      const info = failure(error, { write: true });
      formError(form, info.message);
      if (info.kind === "conflict") vault.load().catch(() => {}); // ตู้เซฟถูกแก้จากที่อื่น: อ่านสถานะล่าสุด
      return false;
    }
    return true;
  }
  async function submitSetup(form) {
    const password = field(form, "password");
    const problem = newPasswordProblem(password, field(form, "password2"));
    if (problem) return formError(form, problem);
    let recoveryCode = "";
    const ok = await guarded(form, async () => { ({ recoveryCode } = await vault.prepareSetup(password)); });
    wipeInputs(form);
    if (ok) showVaultPanel("recovery-show", pages.recoveryShow({ code: recoveryCode, mode: "setup" }));
  }
  async function submitRecovery(form) {
    const typed = field(form, "typed");
    const mode = vault.pendingType === "recovery" ? "recovery" : "setup";
    const ok = await guarded(form, async () => { await (mode === "setup" ? vault.commitSetup(typed) : vault.commitNewRecovery(typed)); });
    wipeInputs(form);
    if (!ok) return;
    closeVaultPanel();
    showToast(mode === "setup" ? "ตั้งตู้เซฟแล้ว ปลดล็อกอยู่" : "เปลี่ยนรหัสกู้คืนแล้ว รหัสเดิมใช้ไม่ได้อีก");
    refreshVaultBar();
    if (mode === "setup" && ui?.form) refreshSecrets();
  }
  async function submitUnlock(form) {
    const password = field(form, "password");
    const ok = await guarded(form, () => vault.unlock("pass", password));
    wipeInputs(form);
    if (ok) { closeVaultPanel(); showToast("ปลดล็อกตู้เซฟแล้ว"); }
  }
  async function submitForgot(form) {
    const recovery = field(form, "recovery");
    const password = field(form, "password");
    const problem = newPasswordProblem(password, field(form, "password2"));
    if (problem) return formError(form, problem);
    const ok = await guarded(form, async () => {
      await vault.changePassword({ kind: "recovery", secret: recovery, newPassword: password });
      await vault.unlock("pass", password);
    });
    wipeInputs(form);
    if (ok) { closeVaultPanel(); showToast("ตั้งรหัสตู้เซฟใหม่แล้ว ปลดล็อกอยู่"); }
  }
  async function submitChange(form) {
    const current = field(form, "current");
    const password = field(form, "password");
    const problem = newPasswordProblem(password, field(form, "password2"));
    if (problem) return formError(form, problem);
    const ok = await guarded(form, () => vault.changePassword({ kind: "pass", secret: current, newPassword: password }));
    wipeInputs(form);
    if (ok) { closeVaultPanel(); showToast("เปลี่ยนรหัสตู้เซฟแล้ว"); }
  }
  async function submitNewRecovery(form) {
    const current = field(form, "current");
    let recoveryCode = "";
    const ok = await guarded(form, async () => { ({ recoveryCode } = await vault.prepareNewRecovery({ kind: "pass", secret: current })); });
    wipeInputs(form);
    if (ok) showVaultPanel("recovery-show", pages.recoveryShow({ code: recoveryCode, mode: "recovery" }));
  }
  async function copyRecoveryCode() {
    const text = byId("itas-recovery-code")?.textContent ?? "";
    try {
      await navigator.clipboard.writeText(text);
      showToast("คัดลอกรหัสกู้คืนแล้ว (ล้างคลิปบอร์ดหลังวางเสร็จ)");
    } catch {
      showToast("คัดลอกไม่ได้ กรุณาจดด้วยมือ", "error");
    }
  }

  /* ---------- รายการ: เปลี่ยนชนิด / เรียง ---------- */
  async function confirmDiscard() {
    if (!isDirty()) return true;
    return confirmDialog({ title: "ยังไม่ได้บันทึกสิ่งที่กรอก", message: "ถ้าไปต่อ ข้อมูลที่พิมพ์ในฟอร์มจะหาย", confirmLabel: "ทิ้งและไปต่อ", cancelLabel: "อยู่ต่อ", danger: true });
  }
  async function switchType(code) {
    if (code === ui.typeCode || ui.busy) return;
    if (!(await confirmDiscard())) return;
    ui.busy = true;
    try {
      closeForm({ force: true });
      ui.typeCode = code;
      ui.query = "";
      ui.status = "";
      ui.sort = { key: "reg_no", direction: "ascending" };
      await loadAssets();
      const typesHost = byId("itas-types-host");
      if (typesHost) typesHost.innerHTML = pages.typeList(ui.types, ui.typeCode);
      const main = byId("itas-main-host");
      if (main) main.innerHTML = mainPanelHtml();
    } catch (error) {
      showToast(failure(error).message, "error");
    } finally {
      ui.busy = false;
    }
  }
  function toggleSort(key) {
    ui.sort = ui.sort.key === key ? { key, direction: ui.sort.direction === "ascending" ? "descending" : "ascending" } : { key, direction: "ascending" };
    updateTable();
  }

  /* ---------- ฟอร์มเพิ่ม/แก้ ---------- */
  const formEl = () => byId("itas-form");
  function readFormValues(form, type) {
    const core = {};
    for (const item of model.coreFieldsOf(type)) core[item.key] = form.elements[item.key]?.value ?? "";
    const attrs = {};
    for (const item of model.plainFields(type)) attrs[item.key] = form.elements[`attrs.${item.key}`]?.value ?? "";
    return { core, attrs };
  }
  // มีสิ่งที่พิมพ์ค้างหรือไม่: ค่าในฟอร์มต่างจากตอนเปิด หรือมีช่องลับที่พิมพ์/สั่งลบไว้
  function isDirty() {
    const form = ui?.form && formEl();
    if (!form || !onAssetsPage()) return false;
    if (JSON.stringify(readFormValues(form, ui.form.type)) !== ui.form.initial) return true;
    return [...form.querySelectorAll("[data-secret]")].some((row) => row.dataset.clear === "1" || (row.querySelector("[data-secret-input]")?.value ?? "") !== "");
  }
  function unsavedCount() {
    if (!ui?.form) return 0;
    if (location.hash !== pageHash || !onAssetsPage()) { ui.form = null; return 0; }
    return isDirty() ? 1 : 0;
  }
  async function openForm(mode, id = null) {
    const type = currentType();
    if (!type || ui.busy) return;
    if (!(await confirmDiscard())) return;
    let original = null;
    if (mode === "edit") {
      try {
        original = await rpc("app_itas_get_asset", { p_id: id }); // โหลดแถวล่าสุด (updated_at ใช้กันแก้ชนกัน)
      } catch (error) {
        showToast(failure(error).message, "error");
        return;
      }
    }
    mountForm(mode, type, original, original ? model.formValuesFromAsset(original, type) : model.emptyFormValues(type));
  }
  function mountForm(mode, type, original, values) {
    const host = byId("itas-form-area");
    if (!host) return;
    clearReveals();
    // สร้างใหม่: uuid สร้างที่หน้าเว็บ (เป็น AAD ของช่องลับ) · คงเดิมตลอดที่ฟอร์มเปิดอยู่ เพื่อลองบันทึกซ้ำหลังเน็ตหลุดได้ปลอดภัย
    ui.form = { mode, type, original, draftId: mode === "add" ? window.crypto.randomUUID() : original.id, initial: "", submitting: false };
    host.innerHTML = pages.assetForm({ mode, type, values, asset: original, vaultStatus: vault.status() });
    ui.form.initial = JSON.stringify(readFormValues(formEl(), type));
    host.scrollIntoView?.({ block: "start" });
    formEl()?.querySelector("input, select, textarea")?.focus();
  }
  function closeForm({ force = false } = {}) {
    if (!force && isDirty()) { confirmDiscard().then((ok) => { if (ok) closeForm({ force: true }); }); return; }
    clearReveals();
    const host = byId("itas-form-area");
    if (host) host.innerHTML = ""; // ทิ้งช่องที่ถอดแล้วและช่องรหัสออกจากหน้า
    if (ui) ui.form = null;
  }
  // วาดส่วนช่องลับใหม่ตามสถานะตู้เซฟ (ล็อก = ค่าและช่องกรอกลับหายไปจากหน้าทันที)
  function refreshSecrets() {
    const host = byId("itas-secrets-host");
    if (!host || !ui?.form) return;
    clearReveals();
    host.innerHTML = pages.secretsSection({ fields: model.secretFields(ui.form.type), asset: ui.form.original, vaultStatus: vault.status() });
  }
  function clearReveals() {
    for (const timer of revealTimers.values()) clearTimeout(timer);
    revealTimers.clear();
    document.querySelectorAll("[data-secret-shown]").forEach((node) => { node.textContent = node.closest("[data-has-value]")?.dataset.hasValue === "1" ? pages.MASK : "—"; });
  }
  function hideReveal(row) {
    const key = row.dataset.secret;
    clearTimeout(revealTimers.get(key));
    revealTimers.delete(key);
    const shown = row.querySelector("[data-secret-shown]");
    if (shown) shown.textContent = pages.MASK;
    const button = row.querySelector('[data-secret-act="show"]');
    if (button) button.textContent = "แสดง";
  }
  // ปุ่มของช่องลับ: แสดง (ถอดเฉพาะเมื่อกด ซ่อนคืนเองใน 30 วินาที) · ตั้งค่าใหม่ · ลบค่า (กดซ้ำเพื่อยกเลิก)
  async function secretAction(button) {
    const row = button.closest("[data-secret]");
    const form = ui?.form;
    if (!row || !form) return;
    const key = row.dataset.secret;
    const act = button.dataset.secretAct;
    const input = row.querySelector("[data-secret-input]");
    const note = row.querySelector("[data-secret-note]");
    if (act === "show") {
      if (revealTimers.has(key)) { hideReveal(row); return; }
      const shown = row.querySelector("[data-secret-shown]");
      try {
        shown.textContent = await vault.decryptField(form.original.id, key, form.original.secrets?.[key]); // textContent: ค่าที่ถอดแล้วไม่ผ่าน innerHTML
        button.textContent = "ซ่อน";
        revealTimers.set(key, setTimeout(() => hideReveal(row), REVEAL_MS));
      } catch (error) {
        shown.textContent = error?.reason === "LOCKED" ? "ตู้เซฟถูกล็อก" : "ถอดรหัสไม่ได้"; // ถอดช่องเดียวไม่ได้ต้องไม่พังทั้งหน้า
      }
    } else if (act === "edit") {
      hideReveal(row);
      row.dataset.clear = "";
      input.hidden = false;
      input.value = "";
      input.focus();
      if (note) note.textContent = "พิมพ์ค่าใหม่ แล้วกดบันทึก (เว้นว่างไว้ = ไม่เปลี่ยน)";
    } else if (act === "clear") {
      const clearing = row.dataset.clear !== "1";
      row.dataset.clear = clearing ? "1" : "";
      hideReveal(row);
      input.value = "";
      input.hidden = true;
      button.textContent = clearing ? "ยกเลิกการลบ" : "ลบค่า";
      if (note) note.textContent = clearing ? "จะลบค่านี้เมื่อกดบันทึก" : "มีค่าอยู่";
    }
  }

  // อ่านช่องลับที่ผู้ใช้แก้ แล้วเข้ารหัสทีละช่อง (ตู้เซฟล็อก = ไม่มีช่องกรอกให้แก้อยู่แล้ว จึงไม่ส่ง key ลับไปเลย)
  async function collectSecrets(form, formState) {
    const envelopes = {};
    for (const row of form.querySelectorAll("[data-secret]")) {
      const key = row.dataset.secret;
      const input = row.querySelector("[data-secret-input]");
      if (row.dataset.clear === "1") { envelopes[key] = null; continue; }
      if (input && !input.hidden && input.value.trim()) envelopes[key] = await vault.encryptField(formState.draftId, key, input.value);
    }
    return envelopes;
  }
  const clearSecretInputs = (form) => form.querySelectorAll("[data-secret-input]").forEach((input) => { input.value = ""; });
  function formMessage(message, { reload = false } = {}) {
    const target = byId("itas-form-message");
    if (!target) return;
    target.innerHTML = `<div class="form-message error" role="alert"><span></span>${reload ? ' <button type="button" class="btn secondary small" id="itas-reload-asset">โหลดข้อมูลล่าสุด</button>' : ""}</div>`;
    target.querySelector("span").textContent = message;
  }
  async function submitAsset(form) {
    const state0 = ui?.form;
    if (!state0 || state0.submitting) return;
    const { type, original } = state0;
    window.MNP_FORM_STEPS?.clearFieldErrors?.(form);
    byId("itas-form-message").innerHTML = "";
    const values = readFormValues(form, type);
    const errors = model.validateAsset({ type, values });
    if (errors.length) {
      const focus = window.MNP_FORM_STEPS?.showFieldErrors?.(form, errors.map((item) => ({ name: item.field, message: item.message })));
      focus?.focus?.();
      return;
    }
    state0.submitting = true;
    setFormBusy(form, true);
    try {
      const secretEnvelopes = await collectSecrets(form, state0);
      const payload = model.buildSavePayload({ type, original, values, secretEnvelopes, assetId: state0.draftId });
      if (original && model.payloadIsEmpty(payload)) { showToast("ไม่มีการเปลี่ยนแปลง"); setFormBusy(form, false); state0.submitting = false; return; }
      let result;
      try {
        result = await rpc("app_itas_save_asset", payload);
      } catch (error) {
        // ลองบันทึกซ้ำหลังเน็ตหลุด แต่ครั้งแรกสำเร็จไปแล้ว → โหลดแถวมาแสดงว่าบันทึกแล้ว (สัญญาข้อ retry)
        if (!original && model.isAlreadyExists(error)) result = { asset: await rpc("app_itas_get_asset", { p_id: state0.draftId }), created: true, changed: true };
        else throw error;
      }
      clearSecretInputs(form);
      showToast(result?.created ? "เพิ่มอุปกรณ์แล้ว" : result?.changed === false ? "ไม่มีการเปลี่ยนแปลง" : "บันทึกแล้ว");
      closeForm({ force: true });
      await refreshData();
    } catch (error) {
      setFormBusy(form, false);
      state0.submitting = false;
      const info = failure(error, { write: true });
      formMessage(info.message, { reload: info.kind === "conflict" });
    }
  }
  // แก้ชนกัน: ผู้ใช้เลือกโหลดข้อมูลล่าสุดเอง (ทิ้งสิ่งที่พิมพ์ หลังถามก่อน) ไม่ทิ้งเงียบ ๆ
  async function reloadAfterConflict() {
    const state0 = ui?.form;
    if (!state0?.original) return;
    if (!(await confirmDialog({ title: "โหลดข้อมูลล่าสุด?", message: "ข้อมูลที่คุณพิมพ์ไว้ในฟอร์มนี้จะหาย แล้วแสดงข้อมูลล่าสุดที่คนอื่นบันทึกไว้", confirmLabel: "โหลดข้อมูลล่าสุด", cancelLabel: "อยู่ต่อ", danger: true }))) return;
    try {
      const fresh = await rpc("app_itas_get_asset", { p_id: state0.original.id });
      mountForm("edit", state0.type, fresh, model.formValuesFromAsset(fresh, state0.type));
      await refreshData();
    } catch (error) {
      formMessage(failure(error).message);
    }
  }
  async function loadHistory() {
    const host = byId("itas-history");
    const state0 = ui?.form;
    if (!host || !state0?.original) return;
    try {
      const data = await rpc("app_itas_asset_history", { p_id: state0.original.id, p_limit: 200 });
      host.innerHTML = pages.historyPanel(model.historyView(data, state0.type));
    } catch (error) {
      host.textContent = failure(error).message;
    }
  }

  /* ---------- ล้างข้อมูลทดสอบ ---------- */
  async function purge(button) {
    if (!(await confirmDialog({ title: `${PURGE_TEXT}?`, message: "ล้างเฉพาะอุปกรณ์ ประวัติ และตู้เซฟทดสอบ (ตู้เซฟทดสอบต้องตั้งใหม่) ข้อมูลจริงไม่ถูกแตะ", confirmLabel: PURGE_TEXT, danger: true }))) return;
    setButtonBusy(button, true);
    try {
      const data = await rpc("app_sandbox_purge_itas");
      vault.lock("reset"); // ตู้เซฟทดสอบถูกลบแล้ว: ล็อกและให้อ่านสถานะใหม่
      resetUi();
      showToast(model.purgeSummary({ deleted: Number(data?.deleted ?? 0) }).message);
      await renderRoute();
    } catch (error) {
      setButtonBusy(button, false);
      showToast(failure(error, { write: true }).message, "error");
    }
  }

  const api = Object.freeze({ render, resolveAccess, hasAccess, unsavedCount, version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT });
  window.MNP_ITAS = api;
  // ประกาศตัวเองให้การ์ดในเมนู "ระบบสำนักงาน" (วิธีเพิ่มโมดูลใหม่ดูที่หัวไฟล์ modules/office-sections.js) key = รหัสโมดูลของการ์ด · ไม่มีตัวเลขงานค้าง
  (window.MNP_OFFICE_CARDS ??= {})[model.ASSET_CODE] = { version: model.MODULE_VERSION, inDevelopment: model.IN_DEVELOPMENT };
})();
