import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// modules/module-itrp.js (การเชื่อมต่อ: เรียก RPC แท็บตามบทบาท ปุ่มตาม allowed_actions กล่องยืนยัน ฟอร์มแจ้งซ่อม/ส่งงาน/ขอแก้ไข การอัปโหลดไฟล์ ล้างข้อมูลทดสอบ)
// รันในคอนเท็กซ์จำลองที่มี helper ของ app.js แบบ stub และ sb.rpc ตอบด้วยข้อมูลที่แต่ละเทสต์กำหนด (กติกาฝั่งฐานข้อมูลของ itrp ทดสอบที่ supabase/tests/database/itrp_*.test.sql)
// ไม่มี DOM จริง: ตัวควบคุมของหน้าเป็นตัวแทนเล็ก ๆ ที่ผูก event ได้ ส่วนที่ตรวจคือ HTML ที่วาด การเรียก RPC และข้อความที่ผู้ใช้เห็น
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
require("../../modules/form-steps.js");
const realSteps = globalThis.MNP_FORM_STEPS;

const ID = "2f6c1b52-9d1e-4c7a-8a43-0c5e8f3a9b10";
const ROLE_EMP = { employee_id: "e1", employee_no: "MK1", full_name: "สมหญิง ผู้แจ้ง", is_test: false, department: { id: "d1", code: "MK", name_th: "การตลาด" }, is_it_department: false, is_dept_approver: false, is_it_admin: false, is_it_approver: false };
const ROLE_IT = { ...ROLE_EMP, employee_id: "e2", employee_no: "IT3462", full_name: "สุริยา", department: { id: "d2", code: "IT", name_th: "IT" }, is_it_department: true, is_it_admin: true };
const ROLE_APPROVER = { ...ROLE_EMP, employee_id: "e3", employee_no: "FANG", full_name: "รสริน", is_it_approver: true };

function el(props = {}) {
  const listeners = {};
  const node = {
    dataset: {}, style: {}, hidden: false, disabled: false, isConnected: true, value: "", checked: false, innerHTML: "", min: "", listeners,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { (listeners[type] ??= []).push(handler); },
    attrs: {}, setAttribute(name, value) { node.attrs[name] = String(value); }, removeAttribute(name) { delete node.attrs[name]; }, getAttribute: (name) => node.attrs[name] ?? null,
    focus() { el.focused = node; }, scrollIntoView() {}, dispatchEvent() {}, closest: () => null, querySelector: () => null, querySelectorAll: () => [],
  };
  return Object.defineProperties(node, Object.getOwnPropertyDescriptors(props));
}

function world({ role = ROLE_EMP, handlers = {}, draft = null, sandbox = false, inDevelopment = false } = {}) {
  const calls = { rpc: [], toasts: [], confirms: [], prompts: [], notFound: 0, busy: [], renderRoutes: 0, uploads: [], removes: [], fieldErrors: null, draftCleared: 0, hydrated: [] };
  const objects = new Map();
  const hosts = {};
  const elements = {};
  let painted = "";
  let paintedTitle = null;
  let currentParams = new URLSearchParams("");
  let uuid = 0;
  const answers = { confirm: true, prompt: "เหตุผลทดสอบ" };
  const rpcFail = new Map();
  const holds = new Map(); // ชื่อ RPC → Promise ที่ต้องรอก่อนตอบ
  const fail = { upload: null };
  const base = {
    app_itrp_my_role: () => role, app_itrp_list_mine: () => [], app_itrp_list_pending_approvals: () => [], app_itrp_list_it: () => [], app_itrp_pending_count: () => 0,
    app_itrp_list_staff: () => [], app_itrp_get_doc_counter: () => ({ year: 2026, last_seq: 49, next_seq: 50, next_doc_no: "IT01-26/050", is_test: false }),
  };
  const table = { ...base, ...handlers };
  const formCache = new Map(); // ฟอร์มจำลองของแท็บประวัติ (สร้างจาก HTML ที่วาดเข้า #itrp-hist-forms) · ทุกครั้งที่วาดฟอร์มใหม่ล้าง cache เพื่อไม่ให้ listener ซ้อนของฟอร์มเก่า
  const host = (selector, props = {}) => el({ ...props, get innerHTML() { return hosts[selector] ?? ""; }, set innerHTML(html) { hosts[selector] = html; if (selector === "#itrp-hist-forms") formCache.clear(); } });
  const unescape = (text) => String(text).replaceAll("&quot;", '"').replaceAll("&#039;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
  const fakeForm = (html) => {
    const controls = {};
    for (const match of html.matchAll(/<input\b[^>]*\bname="(\w+)"[^>]*>/g)) controls[match[1]] = el({ value: unescape(/\bvalue="([^"]*)"/.exec(match[0])?.[1] ?? ""), readOnly: /\breadonly\b/.test(match[0]) });
    for (const match of html.matchAll(/<textarea\b[^>]*\bname="(\w+)"[^>]*>([^<]*)<\/textarea>/g)) controls[match[1]] = el({ value: unescape(match[2]) });
    for (const match of html.matchAll(/<select\b[^>]*\bname="(\w+)"[^>]*>([\s\S]*?)<\/select>/g)) controls[match[1]] = el({ value: /<option value="([^"]*)" selected/.exec(match[2])?.[1] ?? /<option value="([^"]*)"/.exec(match[2])?.[1] ?? "" });
    return el({ controls, querySelector: (selector) => controls[/^\[name="(\w+)"\]$/.exec(selector)?.[1]] ?? null, querySelectorAll: () => [] });
  };
  const makers = {
    "#itrp-form-card": () => host("#itrp-form-card"),
    "#itrp-rework-card": () => host("#itrp-rework-card", { hidden: true }),
    "#itrp-ask-card": () => host("#itrp-ask-card", { hidden: true }),
    "#itrp-answer-card": () => host("#itrp-answer-card"),
    "#itrp-complete-card": () => el({ hidden: true }),
    "#itrp-hist-devices": () => host("#itrp-hist-devices"),
    "#itrp-hist-panel": () => host("#itrp-hist-panel"),
    "#itrp-hist-forms": () => host("#itrp-hist-forms"),
    "#itrp-device-codes": () => host("#itrp-device-codes"),
    "#itrp-partchg-apply": () => host("#itrp-partchg-apply", { hidden: true }),
    "#itrp-partchg-history": () => host("#itrp-partchg-history", { hidden: true }),
    "#itrp-hist-search": () => el({ value: "" }),
  };
  const visible = () => painted + Object.values(hosts).join("");

  // ฟอร์มแจ้งซ่อมจำลอง
  const createForm = (() => {
    const radios = { request_kind: ["repair", "replace_part", "inspect", "install", "other"].map((value) => el({ value })), repair_target: ["computer", "device", "other"].map((value) => el({ value })) };
    const controls = Object.fromEntries(["#itrp-asset-code", "#itrp-device-name", "#itrp-symptom", "#itrp-urgent", "#itrp-kind-note", "#itrp-target-note", "#itrp-review", "[data-step-submit]", "#itrp-host-input", "#itrp-host-search", "#itrp-host-status", "#itrp-pick-body"].map((key) => [key, el()]));
    controls["#itrp-kind-note-field"] = el({ hidden: true });
    controls["#itrp-target-note-field"] = el({ hidden: true });
    controls["#itrp-files"] = el({ files: [] });
    return el({
      controls, radios, lastErrors: [],
      querySelector(selector) {
        const checked = /^\[name="(\w+)"\]:checked$/.exec(selector)?.[1];
        if (checked) return radios[checked].find((radio) => radio.checked) ?? null;
        return controls[selector] ?? null;
      },
      querySelectorAll(selector) { const name = /^\[name="(\w+)"\]$/.exec(selector)?.[1]; return name ? radios[name] : []; },
    });
  })();

  // ฟอร์มส่งงานจำลอง: ตารางอะไหล่เก็บแถวเป็นอ็อบเจ็กต์ (วาดใหม่ทุกครั้งที่ module เขียน innerHTML ใหม่ โดยอ่านจำนวนแถวและค่าจาก HTML)
  const completeForm = (() => {
    const radios = { cause_kind: ["usage", "part_expired", "other"].map((value) => el({ value })), repair_method: ["internal", "external_onsite", "sent_out"].map((value) => el({ value })) };
    const controls = Object.fromEntries(["#itrp-cause", "#itrp-cause-note", "#itrp-vendor", "#itrp-repair-action", "#itrp-pr-po"].map((key) => [key, el()]));
    controls["#itrp-cause-note-field"] = el({ hidden: true });
    controls["#itrp-vendor-field"] = el({ hidden: true });
    controls["#itrp-vendor-label"] = el();
    controls["#itrp-part-add"] = el();
    controls["#itrp-device-add"] = el();
    controls["#itrp-no-device"] = el({ checked: false });
    controls["#itrp-devices-wrap"] = el({ hidden: false });
    let rows = [];
    const makeRow = (values = {}) => {
      const inputs = { part_item: el({ value: values.item ?? "" }), part_quantity: el({ value: values.quantity ?? "" }), part_price: el({ value: values.price ?? "" }), part_note: el({ value: values.note ?? "" }) };
      const row = el({ inputs, querySelector: (selector) => inputs[/name="(\w+)"/.exec(selector)?.[1]] ?? null });
      row.removeButton = el({ closest: (selector) => (selector === "[data-part-row]" ? row : selector === "[data-part-remove]" ? row.removeButton : null) });
      return row;
    };
    rows = [makeRow()];
    const body = el({
      set innerHTML(html) {
        const values = [...html.matchAll(/<tr class="itrp-part-row"[\s\S]*?<\/tr>/g)].map((match) => {
          const pick = (name) => (new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(match[0])?.[1] ?? "");
          return { item: pick("part_item"), quantity: pick("part_quantity"), price: pick("part_price"), note: pick("part_note") };
        });
        rows = values.map(makeRow);
      },
      get innerHTML() { return ""; },
      querySelectorAll(selector) {
        if (selector === "[aria-invalid='true']") return rows.flatMap((row) => Object.values(row.inputs)).filter((input) => input.attrs["aria-invalid"] === "true");
        return selector === "[data-part-row]" ? rows : selector === '[name="part_item"]' ? rows.map((row) => row.inputs.part_item) : [];
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    });
    controls["#itrp-parts-body"] = body;
    // ตารางเครื่อง/อุปกรณ์ที่ซ่อม: เหมือนตารางอะไหล่ (วาดใหม่ทุกครั้งที่ module เขียน innerHTML โดยอ่านแถวจาก HTML) · แถวแรกเริ่มด้วย PC-001 ตรงกับ asset_code ของ DETAIL
    const makeDeviceRow = (values = {}) => {
      const inputs = { device_code: el({ value: values.code ?? "" }), device_remark: el({ value: values.remark ?? "" }), device_symptom: el({ value: values.symptom ?? "" }), device_action: el({ value: values.action ?? "" }) };
      const row = el({ inputs, details: el({ open: false }), querySelector: (selector) => inputs[/name="(\w+)"/.exec(selector)?.[1]] ?? null });
      for (const input of Object.values(inputs)) input.closest = (selector) => (selector === "details" ? row.details : null);
      row.removeButton = el({ closest: (selector) => (selector === "[data-device-row]" ? row : selector === "[data-device-remove]" ? row.removeButton : null) });
      return row;
    };
    let deviceRows = [makeDeviceRow({ code: "PC-001" })];
    const devicesBody = el({
      set innerHTML(html) {
        deviceRows = [...html.matchAll(/<li class="itrp-device-row"[\s\S]*?<\/li>/g)].map((match) => {
          const attr = (name) => (new RegExp(`name="${name}"[^>]*value="([^"]*)"`).exec(match[0])?.[1] ?? "");
          const text = (name) => (new RegExp(`name="${name}"[^>]*>([^<]*)</textarea>`).exec(match[0])?.[1] ?? "");
          return makeDeviceRow({ code: attr("device_code"), remark: attr("device_remark"), symptom: text("device_symptom"), action: text("device_action") });
        });
      },
      get innerHTML() { return ""; },
      querySelectorAll(selector) {
        if (selector === "[aria-invalid='true']") return deviceRows.flatMap((row) => Object.values(row.inputs)).filter((input) => input.attrs["aria-invalid"] === "true");
        return selector === "[data-device-row]" ? deviceRows : selector === '[name="device_code"]' ? deviceRows.map((row) => row.inputs.device_code) : [];
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    });
    controls["#itrp-devices-body"] = devicesBody;
    return el({
      controls, radios, body, devicesBody, get rows() { return rows; }, get deviceRows() { return deviceRows; },
      querySelector(selector) {
        const checked = /^\[name="(\w+)"\]:checked$/.exec(selector)?.[1];
        if (checked) return radios[checked].find((radio) => radio.checked) ?? null;
        return controls[selector] ?? null;
      },
      querySelectorAll() { return []; },
    });
  })();
  const formOf = { "#itrp-form": createForm, "#itrp-complete-form": completeForm };

  const context = vm.createContext({});
  const documentStub = {
    querySelector(selector) {
      const id = /^#([\w-]+)$/.exec(selector)?.[1];
      if (formOf[selector]) return painted.includes(`id="${id}"`) ? formOf[selector] : null;
      if (selector === "#itrp-hist-form" || selector === "#itrp-device-form") {
        const html = hosts["#itrp-hist-forms"] ?? "";
        if (!html.includes(`id="${id}"`)) return null;
        if (!formCache.has(selector)) formCache.set(selector, fakeForm(html));
        return formCache.get(selector);
      }
      if (id && visible().includes(`id="${id}"`)) return (elements[selector] ??= (makers[selector]?.() ?? el()));
      return null;
    },
    querySelectorAll(selector) {
      const attr = /^\[(data-[\w-]+)\]$/.exec(selector)?.[1];
      if (!attr) return [];
      const camel = attr.slice(5).replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
      return [...painted.matchAll(new RegExp(`${attr}="([^"]*)"`, "g"))].map((match) => (elements[`${attr}=${match[1]}`] ??= el({ dataset: { [camel]: match[1] } })));
    },
  };
  Object.assign(context, {
    window: context, console, setTimeout, clearTimeout, URLSearchParams, Intl, Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Event: class {}, document: documentStub,
    File, print() { calls.printed = (calls.printed ?? 0) + 1; }, escapeHtml, formatDate: (value) => `D(${value})`, location: { hash: "" }, state: { employee: { id: "me" }, sandbox: sandbox ? { active: true } : null },
    app: { set innerHTML(value) { painted = value; }, get innerHTML() { return painted; } },
    crypto: { randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuid).padStart(12, "0")}` },
    hydrateAttachmentGallery: async (files, bucket) => { calls.hydrated.push({ files: plain(files), bucket }); },
    openAttachmentLightbox() {},
    sb: {
      storage: {
        from: (bucket) => ({
          async upload(path, file, options) {
            calls.uploads.push({ bucket, path, name: file.name, type: file.type, options: plain(options) });
            const error = fail.upload?.(path);
            if (error) return { data: null, error };
            objects.set(`${bucket}/${path}`, file);
            return { data: { path }, error: null };
          },
          async remove(paths) { calls.removes.push({ bucket, paths: [...paths] }); return { data: paths.map((name) => ({ name })), error: null }; },
        }),
      },
      async rpc(name, args) {
        calls.rpc.push({ name, args: plain(args ?? {}) });
        if (holds.has(name)) await holds.get(name); // ค้างคำตอบไว้ก่อน (ทดสอบผลที่มาช้ากว่าการกระทำของผู้ใช้)
        if (rpcFail.has(name)) { const error = rpcFail.get(name); rpcFail.delete(name); return { data: null, error }; }
        if (!table[name]) return { data: null, error: Object.assign(new Error(`no handler ${name}`), { code: "PGRST202" }) };
        try { return { data: plain(table[name](args ?? {})), error: null }; } catch (error) { return { data: null, error }; }
      },
    },
    shell: (html, path, title, tabTitle) => { paintedTitle = { path, title, tabTitle }; for (const key of Object.keys(elements)) delete elements[key]; for (const key of Object.keys(hosts)) delete hosts[key]; return html; },
    bindShell() {}, loadingShell() {}, renderNotFound() { calls.notFound += 1; },
    showToast: (message, kind = "info") => calls.toasts.push({ message, kind }),
    friendlyError: (error) => `friendly:${error?.message}`,
    confirmDialog: async (options) => { calls.confirms.push(options); return answers.confirm; },
    textPromptDialog: async (options) => { calls.prompts.push(options); return answers.prompt; },
    setFormBusy: (target, busy) => calls.busy.push(busy), setButtonBusy: (button, busy) => calls.busy.push(busy),
    renderRoute: async () => { calls.renderRoutes += 1; await context.window.MNP_ITRP.render(currentParams); },
    bindFormCancel() {}, focusFirstStep() {},
  });
  context.window.MNP_ERROR_LOG = { report() {} };
  context.window.MNP_DATE_PICKER = { enhance() {} };
  context.window.MNP_FORM_STEPS = {
    clearFieldError() {}, clearFieldErrors() { calls.fieldErrors = null; }, showFieldErrors: (target, errors) => { calls.fieldErrors = errors; }, validate: realSteps.validate,
    bindStepper: ({ rules, values }) => ({ check: () => { createForm.lastErrors = realSteps.validate(rules, values()); return createForm.lastErrors.length === 0; } }),
  };
  context.window.MNP_FORM_DRAFT = {
    draftKey: (code, id) => `${code}:${id}`, isEmptyDraft: (values) => Object.values(values).every((value) => !value),
    createDraftStore: () => ({ load: () => draft, clear: () => { calls.draftCleared += 1; } }),
    createAutosave: () => ({ schedule() {}, start() {}, stop() {} }), offerDraft(options) { calls.draftOffer = options; },
  };
  // inDevelopment: true = จำลองการเปิดธง "กำลังพัฒนา" กลับ (ค่าจริงใน itrp-model.js ถอดป้ายแล้ว = false)
  for (const file of ["modules/office-home.js", "modules/working-time.js", "modules/itrp-model.js", "modules/itrp-pages.js", "modules/itrp-history-pages.js", "modules/module-itrp.js"]) {
    const source = read(file);
    vm.runInContext(!inDevelopment || file !== "modules/itrp-model.js" ? source : source.replace("const IN_DEVELOPMENT = false;", "const IN_DEVELOPMENT = true;"), context);
  }

  return {
    calls, context, createForm, completeForm, answers, rpcFail, holds, fail, objects, elements, table, hosts,
    get html() { return painted; },
    get screen() { return visible(); },
    get title() { return paintedTitle; },
    get hash() { return context.location.hash; },
    async open(query = "") { currentParams = new URLSearchParams(query); await context.window.MNP_ITRP.render(currentParams); await flush(); },
    names: () => calls.rpc.map((call) => call.name),
    last: (name) => calls.rpc.findLast((call) => call.name === name),
    async click(action) {
      const button = elements[`data-itrp-action=${action}`] ?? documentStub.querySelectorAll("[data-itrp-action]").find((node) => node.dataset.itrpAction === action);
      assert.ok(button, `button ${action} is drawn`);
      await button.listeners.click[0]();
      await flush();
    },
    async submit(selector, form) { await (form ?? documentStub.querySelector(selector)).listeners.submit[0]({ preventDefault() {} }); await flush(); },
    // ส่ง event ไปยังตัวฟังของฟอร์มแจ้งซ่อม (ทุกตัวที่ผูกชนิดนั้นไว้ ตามลำดับที่ผูก)
    async fire(type, target, extra = {}) {
      for (const handler of createForm.listeners[type] ?? []) await handler({ target, preventDefault() {}, ...extra });
      await flush();
    },
  };
}

const DETAIL = (overrides = {}) => ({
  id: ID, is_test: false, doc_no: "IT01-26/050", status: "pending_dept", is_urgent: false, asset_code: "PC-001", device_name: "Dell", request_kind: "repair", request_kind_note: null, repair_target: "computer", repair_target_note: null, symptom: "เปิดไม่ติด",
  created_at: "2026-11-21T01:00:00Z", rework_round: 0, latest_due_date: null, requester: { employee_no: "MK1", full_name: "สมหญิง ผู้แจ้ง" }, department: { code: "MK", name_th: "การตลาด" },
  events: [], reworks: [], attachments: [], comments: [], info_pending: null, rework_open: false, approvals: { dept: null, it_mgr: null }, started: null, completed: null, received: null,
  repair_report: null, repair_reports: [], allowed_actions: [], ...overrides,
});
const ROW = (id, status, extra = {}) => ({ id, doc_no: `IT01-26/${id}`, status, is_urgent: false, asset_code: null, device_name: `เครื่อง ${id}`, request_kind: "repair", request_kind_note: null, repair_target: "computer", symptom: "x", created_at: `2026-11-21T0${id}:00:00Z`, rework_round: 0, rework_due_date: null, ...extra });

/* ---------- ลงทะเบียนการ์ดและตัวเลขบนการ์ด ---------- */
test("the module announces itself for the IT SUPPORT card with its own version", async () => {
  const w = world();
  assert.equal(w.context.window.MNP_ITRP.version, "2.01");
  assert.equal(w.context.window.MNP_OFFICE_CARDS.IT_COMPUTER_REPAIR, w.context.window.MNP_ITRP);
  assert.equal(typeof w.context.window.MNP_ITRP.loadCardSummary, "function");
  assert.equal(typeof w.context.window.MNP_ITRP.unsavedCount, "function");
  assert.equal(Object.isFrozen(w.context.window.MNP_ITRP), true);
});

test("the card counts open requests once across my/approval/IT lists and 'waiting for you' separately", async () => {
  const mine = [ROW(1, "it_closed"), ROW(2, "need_info"), ROW(3, "received")];
  const w = world({ role: { ...ROLE_IT, is_dept_approver: true }, handlers: {
    app_itrp_list_mine: () => mine, app_itrp_list_it: () => [ROW(1, "it_closed"), ROW(4, "approved"), ROW(5, "in_progress")],
    app_itrp_list_pending_approvals: () => [ROW(6, "pending_dept", { pending_step: "dept" })], app_itrp_pending_count: () => 1,
  } });
  const summary = await w.context.window.MNP_ITRP.loadCardSummary();
  assert.equal(summary.openCount, 5, "1,2,4,5,6 (3 is finished; 1 is counted once)");
  assert.equal(summary.badge, "5 รอคุณ", "1 approval + 2 IT work + 1 to confirm + 1 to answer");
  assert.match(summary.title, /รออนุมัติ 1/);
  const approver = world({ role: ROLE_APPROVER, handlers: { app_itrp_list_it: () => [ROW(4, "approved")] } });
  const view = await approver.context.window.MNP_ITRP.loadCardSummary();
  assert.equal(view.openCount, 1);
  assert.equal(view.badge, "", "an approver who is not the IT admin has no IT work to do");
});

test("the card shows no number when a list the user may read cannot be read, and none when the role is unreadable", async () => {
  const broken = world({ role: ROLE_IT, handlers: { app_itrp_list_it: () => { throw new Error("x"); } } });
  assert.equal((await broken.context.window.MNP_ITRP.loadCardSummary()).openCount, null);
  const noRole = world({ handlers: { app_itrp_my_role: () => { throw new Error("x"); } } });
  assert.equal(await noRole.context.window.MNP_ITRP.loadCardSummary(), null);
});

/* ---------- แท็บ ---------- */
test("the 'mine' tab loads only what the role may read and draws the repair list", async () => {
  const w = world({ handlers: { app_itrp_list_mine: () => [ROW(1, "it_closed")] } });
  await w.open("");
  assert.deepEqual([...new Set(w.names())].sort(), ["app_itrp_list_mine", "app_itrp_my_role"], "an ordinary employee reads no approval, IT or settings data");
  assert.match(w.html, /เครื่อง 1/);
  assert.match(w.html, /แจ้งซ่อมใหม่/);
  assert.match(w.html, /<nav class="view-tabs"/, "something is waiting for the requester, so the tab bar shows");
  assert.equal(w.title.title, "ใบแจ้งซ่อม");
  assert.equal(w.title.path, "office");
});

test("a tab the role may not see sends the user back to 'mine' without loading it", async () => {
  const w = world();
  await w.open("view=settings");
  assert.equal(w.hash, "#/office?module=repair");
  assert.ok(!w.names().includes("app_itrp_get_doc_counter"));
  const unknown = world();
  await unknown.open("view=nope");
  assert.equal(unknown.calls.notFound, 1);
});

test("the IT admin sees approvals count, IT list and settings with the read-only team and the document counter", async () => {
  const w = world({ role: { ...ROLE_IT, is_dept_approver: true }, handlers: {
    app_itrp_list_staff: () => [{ employee_id: "e2", employee_no: "IT3462", full_name: "สุริยา", department_name: "IT", is_it_admin: true, is_it_approver: false, is_active: true }],
    app_itrp_pending_count: () => 3, app_itrp_list_it: () => [ROW(4, "approved"), ROW(5, "in_progress")],
  } });
  await w.open("view=settings");
  assert.match(w.html, /สุริยา/);
  assert.match(w.html, /IT01-26\/050/);
  assert.doesNotMatch(w.html, /data-staff-edit|set_staff/);
  assert.match(w.html, /aria-label="3 รายการ ที่รออนุมัติ"/);
  assert.match(w.html, /aria-label="2 รายการ ที่ต้องดำเนินการ"/);
  assert.ok(!w.names().some((name) => /set_staff|save_access|list_it_work/.test(name)));
  await w.open("view=it");
  assert.match(w.html, /data-group="to_start"/);
});

test("a failed list read shows a Thai error page, with a retry button only when the result is unknown", async () => {
  const w = world({ handlers: { app_itrp_list_mine: () => { throw Object.assign(new Error("Failed to fetch"), { code: "" }); } } });
  await w.open("");
  assert.match(w.html, /โหลดข้อมูลไม่สำเร็จ/);
  assert.match(w.html, /id="itrp-retry"/);
  const rejected = world({ handlers: { app_itrp_list_mine: () => { throw Object.assign(new Error("boom"), { code: "XX000" }); } } });
  await rejected.open("");
  assert.match(rejected.html, /ทำรายการไม่สำเร็จ/);
  assert.doesNotMatch(rejected.html, /id="itrp-retry"/);
});

/* ---------- แจ้งซ่อม ---------- */
function fill(w, values = {}) {
  const f = w.createForm;
  f.controls["#itrp-asset-code"].value = values.asset ?? "PC-001";
  f.controls["#itrp-device-name"].value = values.device ?? "Dell OptiPlex";
  f.controls["#itrp-symptom"].value = values.symptom ?? "เปิดไม่ติด";
  f.controls["#itrp-urgent"].checked = Boolean(values.urgent);
  f.controls["#itrp-kind-note"].value = values.kindNote ?? "";
  f.controls["#itrp-target-note"].value = values.targetNote ?? "";
  for (const [name, value] of [["request_kind", values.kind ?? "repair"], ["repair_target", values.target ?? "computer"]]) for (const radio of f.radios[name]) radio.checked = radio.value === value;
  f.controls["#itrp-files"].files = values.files ?? [];
}

test("submitting the repair form calls app_itrp_create with trimmed parameters and opens the new request", async () => {
  const w = world({ handlers: { app_itrp_create: () => [{ id: ID, doc_no: "IT01-26/050" }] } });
  await w.open("view=new");
  assert.match(w.html, /id="itrp-form"/);
  fill(w, { asset: " PC-001 ", device: " Dell ", symptom: " เปิดไม่ติด ", urgent: true });
  await w.submit("#itrp-form");
  assert.deepEqual(w.last("app_itrp_create").args, { p_asset_code: "PC-001", p_device_name: "Dell", p_request_kind: "repair", p_request_kind_note: null, p_repair_target: "computer", p_repair_target_note: null, p_symptom: "เปิดไม่ติด", p_is_urgent: true });
  assert.ok(w.calls.toasts.some((toast) => toast.message === "แจ้งซ่อมแล้ว · เลขที่ IT01-26/050"));
  assert.equal(w.hash, `#/office?module=repair&view=order&id=${ID}`);
  assert.equal(w.calls.draftCleared, 1);
  assert.ok(!w.names().some((name) => /upload|attachment/.test(name)), "no files, no attachment calls");
});

test("an invalid repair form is not sent, and 'other' needs its text", async () => {
  const w = world({ handlers: { app_itrp_create: () => [{ id: ID, doc_no: "x" }] } });
  await w.open("view=new");
  fill(w, { device: "", symptom: "" });
  await w.submit("#itrp-form");
  assert.deepEqual(w.createForm.lastErrors.map((error) => error.name), ["device_name", "symptom"]);
  fill(w, { kind: "other", kindNote: "" });
  await w.submit("#itrp-form");
  assert.deepEqual(w.createForm.lastErrors.map((error) => error.name), ["request_kind_note"]);
  assert.ok(!w.names().includes("app_itrp_create"));
});

test("a database rejection keeps the form and shows the Thai message; an unknown result warns before retrying", async () => {
  const w = world({ handlers: { app_itrp_create: () => { throw Object.assign(new Error("แผนกของคุณยังไม่ได้ตั้งค่า"), { code: "23514" }); } } });
  await w.open("view=new");
  fill(w);
  await w.submit("#itrp-form");
  assert.match(w.elements["#itrp-message"].innerHTML, /แผนกของคุณยังไม่ได้ตั้งค่า/);
  assert.equal(w.hash, "", "stays on the form");
  assert.equal(w.calls.draftCleared, 0, "the draft is kept");
  assert.deepEqual(w.calls.busy, [true, false]);
  const lost = world({ handlers: { app_itrp_create: () => { throw Object.assign(new Error("Failed to fetch"), { code: "" }); } } });
  await lost.open("view=new");
  fill(lost);
  await lost.submit("#itrp-form");
  assert.match(lost.elements["#itrp-message"].innerHTML, /ผลไม่แน่ชัด/);
  assert.match(lost.elements["#itrp-message"].innerHTML, /ตรวจที่ใบของฉัน/);
});

test("attached files are uploaded to the itrp bucket with a typed File, then registered one by one", async () => {
  const w = world({ role: { ...ROLE_EMP, is_test: false }, handlers: { app_itrp_create: () => [{ id: ID, doc_no: "IT01-26/050" }], app_itrp_add_attachment: () => "att" } });
  await w.open("view=new");
  const csv = Object.assign(new File(["a,b"], "ข้อมูล.CSV", { type: "application/vnd.ms-excel" }), {});
  fill(w, { files: [csv, new File(["x"], "photo.jpg", { type: "image/jpeg" })] });
  await w.submit("#itrp-form");
  assert.deepEqual(w.calls.uploads.map((upload) => [upload.bucket, upload.name, upload.type]), [["itrp-files", "ข้อมูล.CSV", "text/csv"], ["itrp-files", "photo.jpg", "image/jpeg"]]);
  assert.ok(w.calls.uploads.every((upload) => upload.options.upsert === false && upload.path.startsWith(`${ID}/`)));
  const registered = w.calls.rpc.filter((call) => call.name === "app_itrp_add_attachment");
  assert.equal(registered.length, 2);
  assert.ok(registered.every((call) => call.args.p_request_id === ID && call.args.p_rework_id === null));
  assert.deepEqual(registered.map((call) => call.args.p_mime_type), ["text/csv", "image/jpeg"]);
  assert.equal(w.hash, `#/office?module=repair&view=order&id=${ID}`);
});

test("a failed file keeps the request, shows the panel with retry, and the unsaved probe counts the file", async () => {
  const w = world({ handlers: { app_itrp_create: () => [{ id: ID, doc_no: "IT01-26/050" }], app_itrp_add_attachment: () => "att" } });
  await w.open("view=new");
  let failing = true;
  w.fail.upload = () => (failing ? Object.assign(new Error("Failed to fetch"), { statusCode: "" }) : null);
  fill(w, { files: [new File(["x"], "a.jpg", { type: "image/jpeg" })] });
  await w.submit("#itrp-form");
  assert.match(w.screen, /แนบไม่สำเร็จ 1 จาก 1 ไฟล์/);
  assert.equal(w.hash, "", "not moved to the request until the owner continues");
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  failing = false;
  await w.elements["#itrp-upload-retry"].listeners.click[0]();
  await flush();
  assert.equal(w.hash, `#/office?module=repair&view=order&id=${ID}`);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
});

/* ---------- แจ้งซ่อม: เลือกอุปกรณ์จากทะเบียน ---------- */
const LOOKUP_COM24 = {
  found: true,
  host: { code: "COM24", type_code: "COMPUTER", name: "Dell OptiPlex", model: "3080", user_name: "สมชาย ใจดี" },
  devices: [{ type_code: "MONITOR", code: "MNT53", name: "จอ Dell", model: "P2419H" }, { type_code: "MONITOR", code: "MNT54", name: "จอ Dell", model: "P2419H" }, { type_code: "MOUSE", code: "MOU09", name: "", model: "" }],
};
// แทนรหัสว่าง (ใช้ตรวจว่าฟังก์ชันมีไหม) = error 23514 แบบฟังก์ชันจริง · COM24 พบ · อื่นๆ ไม่พบ
const lookupHandler = ({ p_code }) => {
  if (!p_code) throw Object.assign(new Error("กรุณาระบุรหัสเครื่อง"), { code: "23514" });
  return p_code === "COM24" ? LOOKUP_COM24 : { found: false };
};
// ตัวแทน event.target ที่ module ใช้: id, dataset, checked, value และ closest("#id" หรือ "[data-x]")
function tgt(props = {}) {
  const dataset = props.dataset ?? {};
  const node = { value: "", checked: false, ...props, dataset };
  node.closest = (selector) => {
    if (selector.startsWith("#")) return node.id === selector.slice(1) ? node : null;
    const attr = /^\[data-([\w-]+)\]$/.exec(selector)?.[1];
    const camel = attr?.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());
    return camel && dataset[camel] !== undefined ? node : null;
  };
  return node;
}
const search = () => tgt({ id: "itrp-host-search" });
const tickType = (key) => tgt({ dataset: { pickType: key }, checked: true });
async function openPicker(w) {
  await w.open("view=new");
  return w.createForm;
}
async function findHost(w, code = "COM24") {
  const f = w.createForm;
  f.controls["#itrp-host-input"].value = code;
  await w.fire("click", search());
}

test("the form uses the register picker when the database has the lookup (the empty-code probe answers with a data error), and the old fields when it does not", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  await openPicker(w);
  assert.deepEqual(w.last("app_itrp_lookup_host").args, { p_code: "" });
  assert.match(w.html, /id="itrp-host-input"/);
  assert.doesNotMatch(w.html, /id="itrp-device-name"/);
  const old = world();
  await old.open("view=new");
  assert.match(old.html, /id="itrp-device-name"/);
  assert.doesNotMatch(old.html, /id="itrp-host-input"/, "no function = the old form, silently");
  const flaky = world({ handlers: { app_itrp_lookup_host: () => { throw Object.assign(new Error("Failed to fetch"), { code: "" }); } } });
  await flaky.open("view=new");
  assert.match(flaky.html, /id="itrp-host-input"/, "a network error is not 'no function'");
});

test("searching a code shows the confirm card, fills the canonical code and unlocks the device types", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  const f = await openPicker(w);
  assert.match(w.html, /ค้นหารหัสเครื่องคอมของคุณก่อน แล้วจึงเลือกอุปกรณ์/, "locked until the host is found");
  await findHost(w, " com24 ");
  assert.deepEqual(w.last("app_itrp_lookup_host").args, { p_code: "COM24" });
  assert.match(f.controls["#itrp-host-status"].innerHTML, /<strong>COM24<\/strong><span> · Dell OptiPlex · 3080 · ผู้ใช้ สมชาย ใจดี<\/span>/);
  assert.equal(f.controls["#itrp-host-input"].value, "COM24");
  assert.match(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="MONITOR"/);
  await w.fire("change", tickType("MONITOR"));
  assert.match(f.controls["#itrp-pick-body"].innerHTML, /data-pick-use="\d+"/, "two registered monitors: pick the broken one");
});

test("a code that is not in the register shows the Thai message, opens no device types and blocks the form (no way around it)", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  const f = await openPicker(w);
  await findHost(w, "ZZZ9");
  assert.match(f.controls["#itrp-host-status"].innerHTML, /ไม่พบรหัสนี้ในทะเบียน กรุณาตรวจรหัสที่ติดบนเครื่อง หรือติดต่อ IT/);
  assert.doesNotMatch(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="/, "no device types without a found host");
  fill(w, {});
  await w.submit("#itrp-form");
  assert.deepEqual(f.lastErrors.map((error) => error.name), ["devices"]);
  assert.match(f.lastErrors[0].message, /ยังไม่ได้ยืนยันรหัสเครื่อง|กรุณาค้นหารหัสเครื่องคอมของคุณ/);
  assert.ok(!w.names().includes("app_itrp_create"));
  assert.doesNotMatch(w.html, /itrp-host-unknown|ไม่ทราบรหัสเครื่อง/, "the 'unknown host' tick is gone");
});

test("losing the connection during the search shows an error without losing the form", async () => {
  let down = false;
  const w = world({ handlers: { app_itrp_lookup_host: (args) => { if (down) throw Object.assign(new Error("Failed to fetch"), { code: "" }); return lookupHandler(args); } } });
  const f = await openPicker(w);
  down = true;
  await findHost(w);
  assert.match(f.controls["#itrp-host-status"].innerHTML, /ค้นหาไม่สำเร็จ ตรวจอินเทอร์เน็ต/);
});

test("a Thai error from the database is shown as it is, not as 'check the internet'", async () => {
  let reject = true;
  const w = world({ handlers: { app_itrp_lookup_host: (args) => { if (reject && args.p_code) throw Object.assign(new Error("ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT"), { code: "42501" }); return lookupHandler(args); } } });
  const f = await openPicker(w);
  await findHost(w);
  assert.match(f.controls["#itrp-host-status"].innerHTML, /ไม่พบบัญชีพนักงานที่เปิดใช้งาน กรุณาเข้าสู่ระบบใหม่หรือติดต่อ IT/);
  assert.doesNotMatch(f.controls["#itrp-host-status"].innerHTML, /ตรวจอินเทอร์เน็ต/);
  reject = false;
  await findHost(w);
  assert.match(f.controls["#itrp-host-status"].innerHTML, /<strong>COM24<\/strong>/, "a later successful search clears the message");
});

test("after redrawing the types the focus returns to the same tick, and a new row gets the focus in its code box", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  const f = await openPicker(w);
  await findHost(w);
  const focused = [];
  f.controls["#itrp-pick-body"].querySelector = (selector) => ({ focus() { focused.push(selector); } });
  await w.fire("change", tickType("MONITOR"));
  assert.equal(focused.at(-1), '[data-pick-type="MONITOR"]');
  await w.fire("change", tgt({ dataset: { pickUse: "0" }, checked: true }));
  assert.equal(focused.at(-1), '[data-pick-use="0"]');
  const rows = f.controls["#itrp-pick-body"].innerHTML.match(/data-pick-row="\d+"/g).length;
  await w.fire("click", tgt({ dataset: { pickAdd: "MONITOR" } }));
  assert.equal(focused.at(-1), `[data-pick-code="${rows}"]`, "the added row is the next index");
});

test("the same code is not searched twice (blur then the search button), and a new code resets the ticked devices", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  const f = await openPicker(w);
  f.controls["#itrp-host-input"].value = "COM24";
  const calls = () => w.calls.rpc.filter((call) => call.name === "app_itrp_lookup_host" && call.args.p_code === "COM24").length;
  let release;
  w.holds.set("app_itrp_lookup_host", new Promise((resolve) => { release = resolve; }));
  await w.fire("focusout", tgt({ id: "itrp-host-input" })); // blur เกิดก่อน click ของปุ่มค้นหาเสมอ
  await w.fire("click", search());
  assert.match(f.controls["#itrp-host-status"].innerHTML, /กำลังค้นหา/);
  release();
  await flush();
  assert.equal(calls(), 1, "one search while the first is still running");
  await w.fire("click", search());
  assert.equal(calls(), 1, "already confirmed: no search");
  await w.fire("change", tickType("MOUSE"));
  assert.match(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="MOUSE" checked/);
  f.controls["#itrp-host-input"].value = "COM25";
  await w.fire("input", tgt({ id: "itrp-host-input", value: "COM25" }));
  assert.match(f.controls["#itrp-host-status"].innerHTML, /^$/, "the old confirmation is gone");
  assert.doesNotMatch(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="MOUSE" checked/, "the ticked devices belong to the old host");
});

test("an answer that arrives after the requester changed the code is dropped", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler } });
  const f = await openPicker(w);
  let release;
  w.holds.set("app_itrp_lookup_host", new Promise((resolve) => { release = resolve; }));
  await findHost(w);
  f.controls["#itrp-host-input"].value = "COM25";
  await w.fire("input", tgt({ id: "itrp-host-input", value: "COM25" }));
  release();
  await flush();
  assert.doesNotMatch(f.controls["#itrp-host-status"].innerHTML, /<strong>COM24/, "the late answer does not bring the confirm card back");
  assert.doesNotMatch(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="/, "and the device types stay locked");
});

test("an old saved draft (host_unknown flag, picks, no found host) loads, drops the flag and still requires the lookup", async () => {
  const draft = { savedAt: Date.now(), values: { request_kind: "repair", symptom: "x", host_input: "COM24", host: null, host_unknown: true, picks: [{ type_code: "MONITOR", code: "", on: true, note: "", added: false, meta: "" }] } };
  const w = world({ draft, handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "x" }] } });
  const f = await openPicker(w);
  w.calls.draftOffer.onUse();
  assert.equal(f.controls["#itrp-host-input"].value, "COM24", "the typed code comes back");
  assert.doesNotMatch(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="/, "the ticked devices of a host that was never found are dropped");
  fill(w, {});
  await w.submit("#itrp-form");
  assert.equal(f.lastErrors[0].name, "devices");
  assert.ok(!w.names().includes("app_itrp_create"));
});

test("a draft with a found host keeps the host and the ticked devices", async () => {
  const host = { code: "COM24", type_code: "COMPUTER", name: "Dell", model: "", user_name: "", devices: [] };
  const draft = { savedAt: Date.now(), values: { request_kind: "repair", symptom: "x", host_input: "COM24", host, picks: [{ type_code: "COMPUTER", code: "COM24", on: true, note: "", added: false, meta: "" }] } };
  const w = world({ draft, handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "x" }] } });
  const f = await openPicker(w);
  w.calls.draftOffer.onUse();
  assert.match(f.controls["#itrp-pick-body"].innerHTML, /data-pick-type="COMPUTER" checked/);
  fill(w, { symptom: "จากร่าง" });
  await w.submit("#itrp-form");
  assert.deepEqual(w.last("app_itrp_create").args.p_devices, [{ type_code: "COMPUTER", device_code: "COM24", note: null }]);
});

test("send with the picker: 10 parameters (no unknown-host flag), the old code/name/target filled from the choice, files untouched", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "IT01-26/050" }] } });
  const f = await openPicker(w);
  await findHost(w);
  await w.fire("change", tickType("MOUSE"));
  await w.fire("change", tickType("MONITOR"));
  const rows = [...f.controls["#itrp-pick-body"].innerHTML.matchAll(/data-pick-use="(\d+)"[^>]*aria-label="[^"]*MNT54/g)];
  assert.equal(rows.length, 1);
  await w.fire("change", tgt({ dataset: { pickUse: rows[0][1] }, checked: true }));
  fill(w, { symptom: " เปิดไม่ติด ", urgent: true });
  await w.submit("#itrp-form");
  assert.deepEqual(w.last("app_itrp_create").args, {
    p_asset_code: "COM24", p_device_name: "หน้าจอ, เมาส์", p_request_kind: "repair", p_request_kind_note: null, p_repair_target: "device", p_repair_target_note: null, p_symptom: "เปิดไม่ติด", p_is_urgent: true,
    p_host_code: "COM24", p_devices: [{ type_code: "MONITOR", device_code: "MNT54", note: null }, { type_code: "MOUSE", device_code: "MOU09", note: null }],
  });
  assert.equal(w.hash, `#/office?module=repair&view=order&id=${ID}`);
});

test("send: the confirmed host is always sent, typed codes and the 'other' text go to p_devices, editing the computer row code is allowed", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "IT01-26/050" }] } });
  const f = await openPicker(w);
  await findHost(w);
  await w.fire("change", tickType("COMPUTER"));
  await w.fire("change", tickType("OTHER"));
  const html = f.controls["#itrp-pick-body"].innerHTML;
  const code = /data-pick-code="(\d+)"[^>]*aria-label="รหัส คอมพิวเตอร์"/.exec(html)?.[1];
  const note = /data-pick-note="(\d+)"/.exec(html)?.[1];
  assert.ok(code !== undefined && note !== undefined);
  await w.fire("input", tgt({ dataset: { pickCode: code }, value: " com99 " }));
  await w.fire("input", tgt({ dataset: { pickNote: note }, value: "เครื่องสแกน" }));
  fill(w, {});
  await w.submit("#itrp-form");
  const args = w.last("app_itrp_create").args;
  assert.equal(args.p_host_code, "COM24");
  assert.equal("p_host_unknown" in args, false);
  assert.equal(args.p_asset_code, "COM24", "the old asset code is the confirmed host even if the row code was edited");
  assert.equal(args.p_repair_target, "other");
  assert.equal(args.p_repair_target_note, "เครื่องสแกน");
  assert.deepEqual(args.p_devices, [{ type_code: "COMPUTER", device_code: "COM99", note: null }, { type_code: "OTHER", device_code: null, note: "เครื่องสแกน" }]);
});

test("nothing ticked, or 'other' without text, is rejected before sending", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "x" }] } });
  const f = await openPicker(w);
  await findHost(w);
  fill(w, {});
  await w.submit("#itrp-form");
  assert.equal(f.lastErrors[0].message, "กรุณาเลือกอุปกรณ์ที่มีปัญหาอย่างน้อย 1 รายการ");
  await w.fire("change", tickType("OTHER"));
  await w.submit("#itrp-form");
  assert.equal(f.lastErrors[0].message, "กรุณาระบุอุปกรณ์ (เมื่อเลือก \"อื่นๆ\")");
  assert.ok(!w.names().includes("app_itrp_create"));
});

test("a database that lost the new parameters between the probe and the send gets the 8-parameter call with the same code and name", async () => {
  const sent = [];
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: (args) => {
    sent.push(Object.keys(args).length);
    if ("p_devices" in args) throw Object.assign(new Error("Could not find the function public.app_itrp_create(p_asset_code, p_host_code) in the schema cache"), { code: "PGRST202" });
    return [{ id: ID, doc_no: "IT01-26/050" }];
  } } });
  await openPicker(w);
  await findHost(w);
  await w.fire("change", tickType("COMPUTER"));
  fill(w, {});
  await w.submit("#itrp-form");
  assert.deepEqual(sent, [10, 8]);
  const retried = w.last("app_itrp_create").args;
  assert.equal(retried.p_asset_code, "COM24");
  assert.equal(retried.p_device_name, "คอมพิวเตอร์");
  assert.equal(retried.p_repair_target, "computer");
  assert.equal(w.hash, `#/office?module=repair&view=order&id=${ID}`);
});

test("a data error from the 10-parameter call is shown, not retried as the old call", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => { throw Object.assign(new Error("ไม่พบรหัสเครื่อง X ในทะเบียนอุปกรณ์"), { code: "23514" }); } } });
  const f = await openPicker(w);
  await findHost(w);
  await w.fire("change", tickType("COMPUTER"));
  fill(w, {});
  await w.submit("#itrp-form");
  assert.equal(w.names().filter((name) => name === "app_itrp_create").length, 1);
  assert.match(w.elements["#itrp-message"].innerHTML, /ไม่พบรหัสเครื่อง X/);
  assert.equal(f.controls["#itrp-host-input"].disabled ?? false, false);
});

test("a search that is still running blocks 'next' with a wait message instead of 'not confirmed'", async () => {
  const w = world({ handlers: { app_itrp_lookup_host: lookupHandler, app_itrp_create: () => [{ id: ID, doc_no: "x" }] } });
  const f = await openPicker(w);
  w.holds.set("app_itrp_lookup_host", new Promise(() => {}));
  await findHost(w);
  fill(w, {});
  await w.submit("#itrp-form");
  assert.equal(f.lastErrors[0].message, "กำลังค้นหารหัสเครื่อง รอสักครู่แล้วกดอีกครั้ง");
  assert.ok(!w.names().includes("app_itrp_create"));
});

/* ---------- ปุ่มตาม allowed_actions ---------- */
/* ---------- ปุ่มตาม allowed_actions ---------- */
test("approve asks for confirmation then calls app_itrp_approve; the request is reloaded afterwards", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["approve", "reject", "request_info"] }), app_itrp_approve: () => null } });
  await w.open(`view=order&id=${ID}`);
  assert.equal(w.title.tabTitle, "IT01-26/050");
  await w.click("approve");
  assert.equal(w.calls.confirms.length, 1);
  assert.match(w.calls.confirms[0].message, /ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT/, "the IT approver acting before the department step is told it counts as both");
  assert.deepEqual(w.last("app_itrp_approve").args, { p_request_id: ID });
  assert.ok(w.calls.toasts.some((toast) => toast.message === "อนุมัติแล้ว"));
  assert.equal(w.calls.renderRoutes, 1);
  assert.equal(w.names().filter((name) => name === "app_itrp_get_detail").length, 2);
});

test("declining the confirmation sends nothing", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["approve"] }), app_itrp_approve: () => null } });
  await w.open(`view=order&id=${ID}`);
  w.answers.confirm = false;
  await w.click("approve");
  assert.ok(!w.names().includes("app_itrp_approve"));
});

test("reject and cancel ask for a reason and pass it on; IT cancelling for the requester gets the on-behalf wording and limit", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: () => DETAIL({ status: "need_info", allowed_actions: ["cancel"] }), app_itrp_cancel: () => null } });
  await w.open(`view=order&id=${ID}`);
  await w.click("cancel");
  assert.equal(w.calls.prompts.length, 1);
  assert.equal(w.calls.prompts[0].maxLength, 470);
  assert.match(w.calls.prompts[0].title, /แทนผู้แจ้ง/);
  assert.deepEqual(w.last("app_itrp_cancel").args, { p_request_id: ID, p_reason: "เหตุผลทดสอบ" });
  const own = world({ role: ROLE_EMP, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["cancel"] }), app_itrp_cancel: () => null } });
  await own.open(`view=order&id=${ID}`);
  await own.click("cancel");
  assert.equal(own.calls.prompts[0].maxLength, 500);
  const reject = world({ role: ROLE_APPROVER, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["reject"] }), app_itrp_reject: () => null } });
  await reject.open(`view=order&id=${ID}`);
  reject.answers.prompt = null;
  await reject.click("reject");
  assert.ok(!reject.names().includes("app_itrp_reject"), "cancelling the prompt sends nothing");
});

test("a database error on an action shows its Thai message and still reloads the request", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["approve"] }), app_itrp_approve: () => { throw Object.assign(new Error("ใบนี้รอผู้แจ้งตอบ ยังอนุมัติไม่ได้"), { code: "23514" }); } } });
  await w.open(`view=order&id=${ID}`);
  await w.click("approve");
  assert.ok(w.calls.toasts.some((toast) => toast.kind === "error" && toast.message === "ใบนี้รอผู้แจ้งตอบ ยังอนุมัติไม่ได้"));
  assert.equal(w.calls.renderRoutes, 1);
});

test("start and receive use their own RPCs with the request id only", async () => {
  const start = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: () => DETAIL({ status: "approved", allowed_actions: ["start"] }), app_itrp_start: () => null } });
  await start.open(`view=order&id=${ID}`);
  await start.click("start");
  assert.deepEqual(start.last("app_itrp_start").args, { p_request_id: ID });
  const receive = world({ handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed", allowed_actions: ["receive", "request_rework"] }), app_itrp_receive: () => null } });
  await receive.open(`view=order&id=${ID}`);
  await receive.click("receive");
  assert.deepEqual(receive.last("app_itrp_receive").args, { p_request_id: ID });
});

test("a bad id is not found and a database refusal shows the error page", async () => {
  const w = world();
  await w.open("view=order&id=nope");
  assert.equal(w.calls.notFound, 1);
  const refused = world({ handlers: { app_itrp_get_detail: () => { throw Object.assign(new Error("ไม่พบใบแจ้งซ่อมนี้ หรือคุณไม่มีสิทธิ์ดู"), { code: "23514" }) } } });
  await refused.open(`view=order&id=${ID}`);
  assert.match(refused.html, /ไม่พบใบแจ้งซ่อมนี้/);
});

/* ---------- ฟอร์มส่งงาน ---------- */
const IT_DETAIL = () => DETAIL({ status: "in_progress", approvals: { dept: { by: "ผจก", at: "t" }, it_mgr: { by: "FANG", at: "t" } }, allowed_actions: ["complete", "request_info"] });
function fillComplete(w, values = {}) {
  const f = w.completeForm;
  f.controls["#itrp-cause"].value = values.cause ?? "แรมเสื่อม";
  f.controls["#itrp-cause-note"].value = values.causeNote ?? "";
  f.controls["#itrp-vendor"].value = values.vendor ?? "";
  f.controls["#itrp-repair-action"].value = values.action ?? "เปลี่ยนแรม";
  f.controls["#itrp-pr-po"].value = values.prpo ?? "";
  for (const [name, value] of [["cause_kind", values.causeKind ?? "usage"], ["repair_method", values.method ?? "internal"]]) for (const radio of f.radios[name]) radio.checked = radio.value === value;
}

test("'send work' opens the IT form instead of calling the RPC", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "report" } });
  await w.open(`view=order&id=${ID}`);
  assert.match(w.html, /id="itrp-complete-card"[^>]*hidden/);
  const card = w.elements["#itrp-complete-card"] ?? w.context.document.querySelector("#itrp-complete-card");
  assert.equal(card.hidden, true);
  await w.click("complete");
  assert.equal(w.context.document.querySelector("#itrp-complete-card").hidden, false);
  assert.ok(!w.names().includes("app_itrp_complete"));
  assert.equal(w.calls.confirms.length, 0);
});

test("submitting the IT form with missing fields shows Thai errors and sends nothing", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "report" } });
  await w.open(`view=order&id=${ID}`);
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["cause", "cause_kind", "repair_method", "repair_action"]);
  fillComplete(w, { method: "sent_out", vendor: "" });
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["repair_vendor"]);
  w.completeForm.rows[0].inputs.part_item.value = "RAM";
  fillComplete(w, { method: "internal" });
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => [error.name, error.message]), [["parts", "แถวที่ 1: กรุณาระบุจำนวน"]]);
  assert.ok(!w.names().includes("app_itrp_complete"));
  assert.equal(w.calls.confirms.length, 0);
});

test("a bad parts row marks only the failing inputs red and focuses the first one (row 2, not row 1)", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "report" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w, { method: "internal" });
  w.completeForm.body.innerHTML = `<tr class="itrp-part-row"><td><input name="part_item" value="WIFI62"><input name="part_quantity" value="1"><input name="part_price" value="2100"></td></tr><tr class="itrp-part-row"><td><input name="part_item" value="awdwadaw"><input name="part_quantity" value="-"><input name="part_price" value="-"></td></tr>`;
  const [row1, row2] = w.completeForm.rows;
  // กลไกกลางตั้งกรอบแดงที่ช่องแรกของตารางเสมอ (จำลอง) → โค้ดหน้าเว็บต้องย้ายไปช่องที่ผิดจริง
  row1.inputs.part_item.setAttribute("aria-invalid", "true");
  await w.submit("#itrp-complete-form");
  assert.equal(w.calls.fieldErrors[0].message, "แถวที่ 2: จำนวนต้องเป็นตัวเลขมากกว่า 0 (ทศนิยมไม่เกิน 2 ตำแหน่ง)");
  assert.equal(row1.inputs.part_item.getAttribute("aria-invalid"), null);
  assert.equal(row2.inputs.part_item.getAttribute("aria-invalid"), null);
  assert.equal(row2.inputs.part_quantity.getAttribute("aria-invalid"), "true");
  assert.equal(row2.inputs.part_price.getAttribute("aria-invalid"), "true");
  assert.equal(el.focused, row2.inputs.part_quantity, "focus goes to the first failing input");
  // แก้ช่องจำนวนแล้วกรอบแดงของช่องนั้นหาย อีกช่องยังแดง
  w.completeForm.body.listeners.input[0]({ target: row2.inputs.part_quantity });
  assert.equal(row2.inputs.part_quantity.getAttribute("aria-invalid"), null);
  assert.equal(row2.inputs.part_price.getAttribute("aria-invalid"), "true");
});

test("a valid IT form is confirmed, then sent once with the parts list, and the request is reloaded", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "report-id" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w, { cause: " แรมเสื่อม ", causeKind: "other", causeNote: " ไฟตก ", method: "external_onsite", vendor: " นายช่างบี ", prpo: " PO-1 " });
  const [first] = w.completeForm.rows;
  Object.assign(first.inputs.part_item, { value: " RAM 8GB " });
  Object.assign(first.inputs.part_quantity, { value: "2" });
  Object.assign(first.inputs.part_price, { value: "1,250.50" });
  await w.submit("#itrp-complete-form");
  assert.equal(w.calls.confirms.length, 1);
  assert.equal(w.calls.confirms[0].title, "ส่งงานใบแจ้งซ่อมนี้?");
  assert.deepEqual(w.calls.rpc.filter((call) => call.name === "app_itrp_complete").length, 1);
  assert.deepEqual(w.last("app_itrp_complete").args, {
    p_request_id: ID, p_cause: "แรมเสื่อม", p_cause_kind: "other", p_cause_kind_note: "ไฟตก", p_repair_method: "external_onsite", p_repair_vendor: "นายช่างบี", p_repair_action: "เปลี่ยนแรม", p_pr_po_no: "PO-1",
    p_parts: [{ item_name: "RAM 8GB", quantity: "2", price: "1250.50", note: "" }],
    p_devices: [{ device_code: "PC-001", symptom_note: null, action_note: null, remark: null }], // แถวแรกเติมรหัสที่ผู้แจ้งกรอกไว้ (asset_code ของใบ)
  });
  assert.ok(w.calls.toasts.some((toast) => toast.message === "ส่งกลับให้ สมหญิง ผู้แจ้ง ตรวจและยืนยันแล้ว"));
  assert.equal(w.calls.renderRoutes, 1);
});

test("declining the send confirmation, or a database error, keeps the form and the typed data", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "r" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w);
  w.answers.confirm = false;
  await w.submit("#itrp-complete-form");
  assert.ok(!w.names().includes("app_itrp_complete"));
  w.answers.confirm = true;
  w.rpcFail.set("app_itrp_complete", Object.assign(new Error("ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกอนุมัติก่อน"), { code: "23514" }));
  await w.submit("#itrp-complete-form");
  assert.match(w.elements["#itrp-complete-message"].innerHTML, /ส่งงานไม่ได้ ต้องรอผู้จัดการแผนกอนุมัติก่อน/);
  assert.equal(w.calls.renderRoutes, 0, "the page is not reloaded, so the typed text stays");
  assert.deepEqual(w.calls.busy.slice(-2), [true, false]);
  assert.equal(w.completeForm.controls["#itrp-cause"].value, "แรมเสื่อม");
});

test("the parts table adds up to 10 rows, removes rows, and never goes empty", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL } });
  await w.open(`view=order&id=${ID}`);
  const add = w.completeForm.controls["#itrp-part-add"];
  assert.equal(w.completeForm.rows.length, 1);
  for (let i = 0; i < 12; i += 1) add.listeners.click[0]();
  assert.equal(w.completeForm.rows.length, 10);
  assert.equal(add.disabled, true, "the add button is off at 10 rows");
  w.completeForm.rows[3].inputs.part_item.value = "ตัวที่สี่";
  const body = w.completeForm.body;
  body.listeners.click[0]({ target: w.completeForm.rows[0].removeButton });
  assert.equal(w.completeForm.rows.length, 9);
  assert.equal(add.disabled, false);
  for (let i = 0; i < 12; i += 1) body.listeners.click[0]({ target: w.completeForm.rows[0].removeButton });
  assert.equal(w.completeForm.rows.length, 1, "the last row stays as an empty row");
});

test("the vendor field follows the repair method and the unsaved probe sees typed IT data", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL } });
  await w.open(`view=order&id=${ID}`);
  const field = w.completeForm.controls["#itrp-vendor-field"];
  const label = w.completeForm.controls["#itrp-vendor-label"];
  const change = () => w.completeForm.listeners.change.forEach((handler) => handler());
  assert.equal(field.hidden, true);
  w.completeForm.radios.repair_method[2].checked = true;
  change();
  assert.equal(field.hidden, false);
  assert.match(label.innerHTML, /สถานที่ส่งซ่อม.*จำเป็น/);
  w.completeForm.radios.repair_method[2].checked = false;
  w.completeForm.radios.repair_method[1].checked = true;
  change();
  assert.match(label.innerHTML, /ชื่อผู้ซ่อม \(ไม่บังคับ\)/);
  w.completeForm.radios.repair_method[1].checked = false;
  w.completeForm.radios.repair_method[0].checked = true;
  change();
  assert.equal(field.hidden, true);
  const cause = w.completeForm.radios.cause_kind[2];
  cause.checked = true;
  change();
  assert.equal(w.completeForm.controls["#itrp-cause-note-field"].hidden, false);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "a closed form with nothing typed has nothing to lose");
  w.context.document.querySelector("#itrp-complete-card").hidden = false;
  w.completeForm.controls["#itrp-cause"].value = "พิมพ์ค้าง";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
});

test("typed IT data stops counting once the user has left the module page (no leave prompt anywhere else in the app)", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL } });
  await w.open(`view=order&id=${ID}`);
  w.context.document.querySelector("#itrp-complete-card").hidden = false;
  w.completeForm.controls["#itrp-cause"].value = "พิมพ์ค้าง";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1, "typed on the order page = something to lose");
  // ยืนยัน "ออกโดยไม่ส่ง" ไปหน้านอกโมดูล: หน้าเปลี่ยน แต่ฟอร์มเดิมยังค้างอยู่ในอ็อบเจ็กต์ที่ตัวตรวจถืออยู่
  w.context.location.hash = "#/dashboard";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "outside the module nothing is counted");
  w.context.location.hash = "";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "the probe was dropped, so coming back to the old hash does not revive it");
});

test("a form that was removed from the page is not counted even if it still holds typed text", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL } });
  await w.open(`view=order&id=${ID}`);
  const card = w.context.document.querySelector("#itrp-complete-card");
  card.hidden = false;
  w.completeForm.controls["#itrp-cause"].value = "พิมพ์ค้าง";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  card.isConnected = false;
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
});

/* ---------- ขอแก้ไข / ถาม / ตอบ ---------- */
test("the requester's rework goes through app_itrp_request_rework and attaches files to the new round", async () => {
  const w = world({ handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed", allowed_actions: ["receive", "request_rework"] }), app_itrp_request_rework: () => ({ id: "rw1", round_no: 2 }), app_itrp_add_attachment: () => "a" } });
  await w.open(`view=order&id=${ID}`);
  await w.click("request_rework");
  assert.equal(w.context.document.querySelector("#itrp-rework-card").hidden, false);
  w.context.document.querySelector("#itrp-rework-details").value = " ยังไม่หาย ";
  w.context.document.querySelector("#itrp-rework-due").value = "2099-01-01";
  w.context.document.querySelector("#itrp-rework-files").files = [new File(["x"], "a.png", { type: "image/png" })];
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  await w.submit("#itrp-rework-form");
  assert.deepEqual(w.last("app_itrp_request_rework").args, { p_request_id: ID, p_details: "ยังไม่หาย", p_due_date: "2099-01-01" });
  assert.deepEqual(w.last("app_itrp_add_attachment").args.p_rework_id, "rw1");
  assert.ok(w.calls.toasts.some((toast) => toast.message === "ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ 2"));
});

test("a rework without details or a due date is not sent", async () => {
  const w = world({ handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed", allowed_actions: ["request_rework"] }), app_itrp_request_rework: () => ({ id: "x", round_no: 1 }) } });
  await w.open(`view=order&id=${ID}`);
  await w.click("request_rework");
  await w.submit("#itrp-rework-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["details", "due_date"]);
  assert.ok(!w.names().includes("app_itrp_request_rework"));
});

test("asking the requester and answering use their RPCs with the comment id for files", async () => {
  const ask = world({ role: ROLE_APPROVER, handlers: { app_itrp_get_detail: () => DETAIL({ allowed_actions: ["approve", "request_info"] }), app_itrp_request_info: () => ({ comment_id: 7 }), app_itrp_add_comment_attachment: () => "a" } });
  await ask.open(`view=order&id=${ID}`);
  await ask.click("request_info");
  ask.context.document.querySelector("#itrp-ask-body").value = " รุ่นอะไร ";
  ask.context.document.querySelector("#itrp-ask-files").files = [new File(["x"], "q.pdf", { type: "application/pdf" })];
  await ask.submit("#itrp-ask-form");
  assert.deepEqual(ask.last("app_itrp_request_info").args, { p_request_id: ID, p_body: "รุ่นอะไร" });
  assert.deepEqual(ask.last("app_itrp_add_comment_attachment").args.p_comment_id, 7);
  const answer = world({ handlers: {
    app_itrp_get_detail: () => DETAIL({ status: "need_info", allowed_actions: ["provide_info"], info_return_status: "pending_dept", info_pending: { comment_id: 7, stage: "dept", body: "รุ่นอะไร", asked_at: "t", asked_by_full_name: "ผจก" }, comments: [{ id: 7, kind: "question", stage: "dept", body: "รุ่นอะไร", created_at: "t", author_full_name: "ผจก", attachments: [] }] }),
    app_itrp_provide_info: () => ({ comment_id: 8 }),
  } });
  await answer.open(`view=order&id=${ID}`);
  assert.match(answer.html, /id="itrp-answer-form"/);
  answer.context.document.querySelector("#itrp-answer-body").value = "รุ่น X";
  await answer.submit("#itrp-answer-form");
  assert.deepEqual(answer.last("app_itrp_provide_info").args, { p_request_id: ID, p_body: "รุ่น X" });
  assert.ok(answer.calls.toasts.some((toast) => toast.message === "ส่งคำตอบแล้ว ใบกลับไปที่ผู้จัดการแผนก"));
});

/* ---------- ป้าย/แถบ "กำลังพัฒนา" ---------- */
const DEV_BAR = "ระบบใบแจ้งซ่อมคอมพิวเตอร์กำลังพัฒนาและทดสอบ ยังไม่เปิดใช้งานจริง";
test("while the module is in development every screen shows the notice bar, the print page does not, and use is not blocked", async () => {
  const w = world({ role: ROLE_IT, inDevelopment: true, handlers: { app_itrp_get_detail: () => DETAIL() } });
  assert.equal(w.context.window.MNP_ITRP.inDevelopment, true, "the card reads the flag from the module announcement");
  for (const query of ["", "view=new", "view=settings", `view=order&id=${ID}`]) {
    await w.open(query);
    assert.equal(w.html.split(DEV_BAR).length - 1, 1, `one notice bar on ${query || "the list"}`);
    assert.match(w.html, /<p class="rf-callout is-warn itrp-dev-notice no-print" role="status">/);
  }
  await w.open("view=new");
  assert.match(w.screen, /id="itrp-form-card"|แจ้งซ่อมใหม่/, "the form is still usable");
  await w.open(`view=print&id=${ID}`);
  assert.match(w.html, /class="itrp-sheet"/);
  assert.doesNotMatch(w.html, /itrp-dev-notice/);
  assert.doesNotMatch(w.html, /กำลังพัฒนา/);
});

test("turning the flag off removes the notice bar from every screen and the card announcement", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: () => DETAIL() } });
  assert.equal(w.context.window.MNP_ITRP.inDevelopment, false);
  for (const query of ["", "view=new", "view=settings", `view=order&id=${ID}`, `view=print&id=${ID}`]) {
    await w.open(query);
    assert.doesNotMatch(w.html, /itrp-dev-notice|กำลังพัฒนา/, `no notice on ${query || "the list"}`);
  }
});

/* ---------- หน้าพิมพ์ / ตั้งค่า / ล้างข้อมูลทดสอบ ---------- */
test("the print page loads the same detail and draws the A4 sheet titled by the document number", async () => {
  const w = world({ handlers: { app_itrp_get_detail: () => DETAIL() } });
  await w.open(`view=print&id=${ID}`);
  assert.match(w.html, /class="itrp-sheet"/);
  assert.equal(w.title.tabTitle, "IT01-26/050");
  assert.equal(w.names().filter((name) => name === "app_itrp_get_detail").length, 1);
  w.elements["#itrp-print-button"].listeners.click[0]();
  assert.equal(w.calls.printed, 1);
});

test("setting the next document number goes forward only, is confirmed with the number, and calls app_itrp_set_next_doc_seq", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_set_next_doc_seq: () => ({ year: 2026, next_seq: 80, next_doc_no: "IT01-26/080", is_test: false }) } });
  await w.open("view=settings");
  const form = w.context.document.querySelector("#itrp-counter-form");
  const input = el({ value: "" });
  form.querySelector = () => input;
  input.value = "10";
  await w.submit(null, form);
  assert.ok(!w.names().includes("app_itrp_set_next_doc_seq"), "going backwards is refused before any call");
  assert.match(w.calls.fieldErrors[0].message, /ถอยหลังหรือซ้ำไม่ได้/);
  input.value = "80";
  await w.submit(null, form);
  assert.match(w.calls.confirms[0].title, /IT01-26\/080/);
  assert.deepEqual(w.last("app_itrp_set_next_doc_seq").args, { p_next: 80, p_year: 2026 });
});

test("the purge button only exists in sandbox mode, calls app_sandbox_purge_itrp, and removes the listed files from the test bucket", async () => {
  const off = world();
  await off.open("");
  assert.doesNotMatch(off.html, /id="itrp-purge"/);
  const w = world({ sandbox: true, handlers: { app_sandbox_purge_itrp: () => ({ deleted: 12, files: ["a/1.jpg", "b/2.pdf"] }) } });
  await w.open("");
  assert.match(w.html, /id="itrp-purge"/);
  await w.elements["#itrp-purge"].listeners.click[0]({ currentTarget: el() });
  assert.equal(w.calls.confirms[0].danger, true);
  assert.equal(w.calls.removes.length, 1);
  assert.deepEqual(w.calls.removes[0], { bucket: "itrp-test-files", paths: ["a/1.jpg", "b/2.pdf"] });
  assert.ok(w.calls.toasts.some((toast) => toast.message === "ล้างข้อมูลทดสอบแล้ว 12 แถว · ลบไฟล์ 2 ไฟล์"));
});

/* ---------- ขอบเขตของโมดูล ---------- */
test("the module only uses app_itrp_* RPCs (plus the sandbox purge) and its own element ids, never the work order module's", () => {
  const source = read("modules/module-itrp.js");
  const rpcs = [...source.matchAll(/["'](app_[a-z_]+)["']/g)].map((match) => match[1]);
  assert.ok(rpcs.length > 15);
  for (const name of new Set(rpcs)) assert.match(name, /^app_itrp_|^app_sandbox_purge_itrp$/, name);
  assert.doesNotMatch(source, /app_itwo|MNP_ITWO|module=work-order|IT_WORK_ORDER/);
  assert.match(source, /\(window\.MNP_OFFICE_CARDS \?\?= \{\}\)\.IT_COMPUTER_REPAIR = api/);
  assert.doesNotMatch(source, /sb\.from\(|SUPABASE_SECRET|service_role/);
});

test("app.js asks the repair module before leaving a page, and the bell and menu are wired to it", () => {
  const app = read("app.js");
  assert.match(app, /\(window\.MNP_ITRP\?\.unsavedCount\?\.\(\) \?\? 0\) > 0( \|\| \(window\.MNP_ITAS\?\.unsavedCount\?\.\(\) \?\? 0\) > 0)?( \|\| \(window\.MNP_ITUA\?\.unsavedCount\?\.\(\) \?\? 0\) > 0)?;/, "leaving with typed IT data or a failed file asks first");
  assert.match(app, /action_url\?\.startsWith\("\/office\/repair\/"\)/);
  assert.match(read("modules/module-office.js"), /window\.MNP_ITRP\.render\(params\)/);
});

/* ---------- ฟอร์มส่งงาน: เครื่อง/อุปกรณ์ที่ซ่อม ---------- */
test("the datalist of machine codes is filled from the register when the send form is opened, and a failed load leaves the form usable", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_list_devices: () => [{ code: "COM05", user_name: "สมชาย", division: "บัญชี", status: "active" }, { code: "OLD1", in_registry: false, status: null }, { code: "COM01", status: "retired" }] } });
  await w.open(`view=order&id=${ID}`);
  assert.ok(!w.names().includes("app_itrp_list_devices"), "the register is not read until the form is opened");
  await w.click("complete");
  await w.click("complete");
  assert.equal(w.names().filter((name) => name === "app_itrp_list_devices").length, 1, "read once however often the form is opened");
  const options = w.hosts["#itrp-device-codes"];
  assert.match(options, /<option value="COM05" label="COM05 · สมชาย · บัญชี">/);
  assert.match(options, /<option value="OLD1" label="OLD1">/, "a code with history but no register entry is still offered");
  assert.match(options, /label="COM01 · \(ยกเลิกการใช้งานแล้ว\)"/);
  // ฐานข้อมูลปฏิเสธ/เครือข่ายล้ม: ไม่มี datalist แต่ส่งงานได้ตามปกติ
  const failing = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "r", app_itrp_list_devices: () => { throw Object.assign(new Error("เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูทะเบียนเครื่องได้"), { code: "42501" }); } } });
  await failing.open(`view=order&id=${ID}`);
  await failing.click("complete");
  assert.equal(failing.hosts["#itrp-device-codes"], undefined, "nothing was written to the datalist");
  fillComplete(failing);
  await failing.submit("#itrp-complete-form");
  assert.equal(failing.calls.rpc.filter((call) => call.name === "app_itrp_complete").length, 1, "the form still works");
  assert.equal(failing.calls.toasts.some((toast) => toast.kind === "error"), false, "a failed register load is silent");
});

test("a send with no machine code and no tick is refused with the red frame on the first code input", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: () => IT_DETAIL(), app_itrp_complete: () => "r" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w);
  const [first] = w.completeForm.deviceRows;
  first.inputs.device_code.value = "  ";
  first.inputs.device_code.setAttribute("aria-invalid", "true"); // กลไกกลางตั้งกรอบแดงที่ช่องแรกของกล่อง (จำลอง)
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["devices"]);
  assert.match(w.calls.fieldErrors[0].message, /^กรุณาระบุรหัสเครื่องอย่างน้อย 1 เครื่อง หรือติ๊ก "งานนี้ไม่มีรหัสเครื่อง/);
  assert.equal(first.inputs.device_code.getAttribute("aria-invalid"), "true");
  assert.equal(el.focused, first.inputs.device_code);
  assert.ok(!w.names().includes("app_itrp_complete"));
  assert.equal(w.calls.confirms.length, 0);
});

test("ticking 'no machine code' hides the table, sends p_devices = [] and clears the devices error", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "r" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w);
  w.completeForm.deviceRows[0].inputs.device_code.value = "";
  const wrap = w.completeForm.controls["#itrp-devices-wrap"];
  const tick = w.completeForm.controls["#itrp-no-device"];
  tick.checked = true;
  w.completeForm.listeners.change.forEach((handler) => handler());
  assert.equal(wrap.hidden, true);
  tick.checked = false;
  w.completeForm.listeners.change.forEach((handler) => handler());
  assert.equal(wrap.hidden, false, "unticking brings the table back");
  tick.checked = true;
  w.completeForm.listeners.change.forEach((handler) => handler());
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.last("app_itrp_complete").args.p_devices, []);
  assert.equal(w.calls.confirms.length, 1);
});

test("the devices table adds up to 10 rows, removes rows, never goes empty, and sends every filled row with its notes", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "r" } });
  await w.open(`view=order&id=${ID}`);
  const add = w.completeForm.controls["#itrp-device-add"];
  assert.equal(w.completeForm.deviceRows.length, 1);
  assert.equal(w.completeForm.deviceRows[0].inputs.device_code.value, "PC-001", "the first row starts with the requester's code");
  for (let i = 0; i < 12; i += 1) add.listeners.click[0]();
  assert.equal(w.completeForm.deviceRows.length, 10);
  assert.equal(add.disabled, true, "the add button is off at 10 rows");
  const body = w.completeForm.devicesBody;
  body.listeners.click[0]({ target: w.completeForm.deviceRows[9].removeButton });
  assert.equal(w.completeForm.deviceRows.length, 9);
  assert.equal(add.disabled, false);
  for (let i = 0; i < 12; i += 1) body.listeners.click[0]({ target: w.completeForm.deviceRows[0].removeButton });
  assert.equal(w.completeForm.deviceRows.length, 1, "the last row stays as an empty row");
  // ซ่อมสองเครื่อง: เครื่องที่สองมีอาการ/ข้อเสนอแนะของตัวเอง
  w.completeForm.devicesBody.innerHTML = `<li class="itrp-device-row"><input name="device_code" value="com05"><input name="device_remark" value=""></li><li class="itrp-device-row"><input name="device_code" value="prt22"><input name="device_remark" value="ควรเปลี่ยนตลับ"><textarea name="device_symptom">พิมพ์ไม่ออก</textarea><textarea name="device_action">ล้างหัวพิมพ์</textarea></li>`;
  fillComplete(w);
  await w.submit("#itrp-complete-form");
  assert.deepEqual(w.last("app_itrp_complete").args.p_devices, [
    { device_code: "COM05", symptom_note: null, action_note: null, remark: null },
    { device_code: "PRT22", symptom_note: "พิมพ์ไม่ออก", action_note: "ล้างหัวพิมพ์", remark: "ควรเปลี่ยนตลับ" },
  ]);
});

test("a bad device row marks only the failing input red (a duplicate code on row 2), opens its folded notes, and focuses it", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => "r" } });
  await w.open(`view=order&id=${ID}`);
  fillComplete(w);
  w.completeForm.devicesBody.innerHTML = `<li class="itrp-device-row"><input name="device_code" value="COM05"></li><li class="itrp-device-row"><input name="device_code" value="com05"><textarea name="device_symptom">${"ก".repeat(2001)}</textarea></li>`;
  const [row1, row2] = w.completeForm.deviceRows;
  row1.inputs.device_code.setAttribute("aria-invalid", "true"); // ตั้งโดยกลไกกลางที่ช่องแรกของกล่อง
  await w.submit("#itrp-complete-form");
  assert.equal(w.calls.fieldErrors[0].name, "devices");
  assert.match(w.calls.fieldErrors[0].message, /^แถวที่ 2: รหัสเครื่อง COM05 ซ้ำกับแถวก่อนหน้า/);
  assert.equal(row1.inputs.device_code.getAttribute("aria-invalid"), null, "row 1 is fine");
  assert.equal(row2.inputs.device_code.getAttribute("aria-invalid"), "true");
  assert.equal(row2.inputs.device_symptom.getAttribute("aria-invalid"), "true", "the over-long note is marked too");
  assert.equal(row2.details.open, true, "the folded notes open so the red frame is visible");
  assert.equal(el.focused, row2.inputs.device_code);
  // แก้รหัสแล้วกรอบแดงของช่องนั้นหาย
  w.completeForm.devicesBody.listeners.input[0]({ target: row2.inputs.device_code });
  assert.equal(row2.inputs.device_code.getAttribute("aria-invalid"), null);
  assert.equal(row2.inputs.device_symptom.getAttribute("aria-invalid"), "true");
  assert.ok(!w.names().includes("app_itrp_complete"));
});

test("the unsaved probe ignores the prefilled code but counts an edited code or the no-device tick", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL } });
  await w.open(`view=order&id=${ID}`);
  w.context.document.querySelector("#itrp-complete-card").hidden = false;
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "an open form holding only the prefilled code has nothing to lose");
  w.completeForm.deviceRows[0].inputs.device_remark.value = "ควรเปลี่ยน";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  w.completeForm.deviceRows[0].inputs.device_remark.value = "";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
  w.completeForm.controls["#itrp-no-device"].checked = true;
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
});

/* ---------- แท็บ "ประวัติการซ่อม" (FM02) ---------- */
const DEVICE_COM05 = { id: 1, code: "COM05", kind: "computer", user_name: "สมชาย", division: "บัญชี", cpu_name: "Intel Core i5", cpu_model: "10400", started_on: "2023-04-01", asset_no: "AS-100", status: "active", note: "ตั้งโต๊ะ" };
const DEVICES = [
  { code: "COM05", in_registry: true, device_id: 1, kind: "computer", user_name: "สมชาย", division: "บัญชี", cpu_name: "Intel Core i5", cpu_model: "10400", started_on: "2023-04-01", asset_no: "AS-100", status: "active", note: "ตั้งโต๊ะ", history_count: 2, last_repair_on: "2026-11-02" },
  { code: "PRT22", in_registry: true, device_id: 2, kind: "printer", user_name: null, division: "คลังสินค้า", cpu_name: null, cpu_model: null, started_on: null, asset_no: null, status: "retired", note: null, history_count: 0, last_repair_on: null },
  { code: "OLD1", in_registry: false, device_id: null, kind: null, user_name: null, division: null, status: null, history_count: 1, last_repair_on: "2016-03-05" },
];
const IMPORT_ROW = { source: "import", entry_id: 7, request_id: null, request_status: null, doc_no: "IT01-16/0001", reported_on: "2016-03-05", symptom: "จอเสีย", action: "เปลี่ยนจอ", finished_on: "2016-03-06", remark: null, reporter_name: "สมชาย", revision_count: 1, updated_at: "2026-11-23T03:00:00Z" };
const REQUEST_ROW = { source: "request", entry_id: null, request_id: ID, request_status: "received", doc_no: "IT01-26/050", reported_on: "2026-11-02", symptom: "เปิดไม่ติด", action: "เปลี่ยนแหล่งจ่าย", finished_on: "2026-11-03", remark: "ควรเปลี่ยน", reporter_name: "สมหญิง", revision_count: 0, updated_at: "2026-11-03T03:00:00Z" };
const HISTORY = (code) => ({ code, is_test: false, device: code === "COM05" ? DEVICE_COM05 : null, rows: code === "COM05" ? [IMPORT_ROW, REQUEST_ROW] : [] });
const historyHandlers = (extra = {}) => ({ app_itrp_list_devices: () => DEVICES, app_itrp_device_history: ({ p_code }) => HISTORY(p_code), ...extra });
// คลิกแบบ delegate: คืน Promise ของ handler ที่ผูกไว้ที่โฮสต์ · target.closest(selector) ตอบเฉพาะ selector ที่ระบุ
const delegate = async (host, selector, dataset) => {
  host.listeners.click[0]({ target: { closest: (asked) => (asked === selector ? el({ dataset }) : null) } });
  await flush();
  await flush();
};
const panelOf = (w) => w.context.document.querySelector("#itrp-hist-panel");

test("the history tab is turned back for a plain user without reading anything, and its print page too", async () => {
  const w = world({ handlers: historyHandlers() });
  await w.open("view=history");
  assert.deepEqual(w.names(), ["app_itrp_my_role"]);
  assert.equal(w.hash, "#/office?module=repair");
  const print = world({ role: { ...ROLE_EMP, is_dept_approver: true }, handlers: historyHandlers() });
  await print.open("view=history-print&code=COM05");
  assert.ok(!print.names().includes("app_itrp_device_history"));
});

test("the IT approver sees the device list and a read-only FM02 table: no add/edit buttons at all", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: historyHandlers() });
  await w.open("view=history&code=com05");
  assert.deepEqual(w.last("app_itrp_device_history").args, { p_code: "COM05" }, "the code from the URL is normalised");
  assert.match(w.html, /aria-current="page" href="#\/office\?module=repair&amp;view=history"/, "the history tab is the current tab");
  assert.match(w.html, /data-hist-code="OLD1"/, "a code with history but no register entry can be chosen");
  assert.match(w.html, /ไม่อยู่ในทะเบียน/);
  assert.match(w.html, /itrp-hist-device is-retired/, "a retired machine is dimmed");
  assert.match(w.html, /<table class="itrp-hist-table"/);
  for (const label of ["เลขที่ใบแจ้งซ่อม", "วันที่", "อาการเสีย", "การแก้ไข", "ซ่อมเสร็จ", "ข้อเสนอแนะ", "ผู้แจ้ง"]) assert.match(w.html, new RegExp(`<th scope="col">${label}</th>`), label);
  assert.match(w.html, /<a class="request-no register-no-link" href="#\/office\?module=repair&amp;view=order&amp;id=2f6c1b52[^"]*">IT01-26\/050<\/a>/, "a request row links to the request");
  assert.match(w.html, /นำเข้าจาก Excel/);
  assert.match(w.html, /พิมพ์ประวัติ \(A4\)/);
  assert.doesNotMatch(w.html, /id="itrp-hist-add-entry"|id="itrp-hist-add-device"|data-hist-edit|data-hist-void/);
  assert.match(w.html, /data-hist-revisions="7"/, "the read-only approver can still open the revisions of an edited row");
});

test("the IT approver opens the revisions of a row (read-only RPC) but has no way to edit or void", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: historyHandlers({ app_itrp_history_get: () => ({
    entry: { id: 7, doc_no: "IT01-16/0001", created_by_full_name: "สุริยา", created_at: "2026-11-23T01:00:00Z", voided_at: null },
    revisions: [{ revision_no: 1, change_kind: "update", snapshot: { doc_no: "IT01-16/0001", device_code: "COM05", reported_on: "2016-03-05", symptom: "จอ" }, changed_by_full_name: "สุริยา", reason: null, created_at: "2026-11-23T03:00:00Z" }],
  }) }) });
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-revisions]", { histRevisions: "7" });
  assert.deepEqual(w.last("app_itrp_history_get").args, { p_entry_id: "7" });
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-revisions-card"/);
  // ปุ่มแก้/ยกเลิกไม่มีให้ และคลิกที่ผูกไว้ก็ไม่ส่ง RPC เขียน
  await delegate(panelOf(w), "[data-hist-void]", { histVoid: "7" });
  await delegate(panelOf(w), "[data-hist-edit]", { histEdit: "7" });
  assert.ok(!w.names().some((name) => /history_(void|update|add)|save_device/.test(name)));
  assert.equal(w.calls.prompts.length, 0);
});

test("with no ?code= the placeholder shows, and choosing a machine loads its history without leaving the page", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history");
  assert.ok(!w.names().includes("app_itrp_device_history"));
  assert.match(w.html, /เลือกเครื่องจากรายการ/);
  assert.match(w.html, /id="itrp-hist-add-entry"/);
  assert.match(w.html, /id="itrp-hist-add-device"/);
  await delegate(w.context.document.querySelector("#itrp-hist-devices"), "[data-hist-code]", { histCode: "COM05" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(w.last("app_itrp_device_history").args, { p_code: "COM05" });
  const panel = w.hosts["#itrp-hist-panel"];
  assert.match(panel, /เริ่มใช้วันที่/);
  assert.match(panel, /01\/04\/2566/);
  assert.match(panel, /Intel Core i5 10400/);
  assert.match(panel, /AS-100/);
  assert.match(panel, /data-hist-edit="7"/, "an imported row can be edited by the IT admin");
  assert.doesNotMatch(panel, /data-hist-edit="null"/, "a request row has no edit button");
  assert.match(panel, /data-hist-revisions="7"/, "a row that was edited shows the revisions button");
  assert.match(panel, /href="#\/office\?module=repair&amp;view=history-print&amp;code=COM05"/);
  assert.match(w.hosts["#itrp-hist-devices"], /data-hist-code="COM05" aria-pressed="true"/, "the chosen machine is marked");
});

test("a failed history load shows the reason in the panel with a retry, and a late answer never overwrites a newer choice", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers({
    app_itrp_device_history: ({ p_code }) => { if (p_code === "PRT22") throw Object.assign(new Error("permission denied for table itrp_devices"), { code: "42501" }); return HISTORY(p_code); },
  }) });
  await w.open("view=history");
  const list = w.context.document.querySelector("#itrp-hist-devices");
  await delegate(list, "[data-hist-code]", { histCode: "PRT22" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(w.hosts["#itrp-hist-panel"], /data-hist-retry="PRT22"/);
  assert.match(w.hosts["#itrp-hist-panel"], /ทำรายการไม่สำเร็จ/, "a technical error is not shown raw");
  // เลือกเร็วสองเครื่อง: คำตอบเก่าที่มาช้าต้องไม่วาดทับ
  const calls = [];
  w.table.app_itrp_device_history = ({ p_code }) => { calls.push(p_code); return HISTORY(p_code); };
  await delegate(list, "[data-hist-code]", { histCode: "OLD1" });
  await delegate(list, "[data-hist-code]", { histCode: "COM05" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, ["OLD1", "COM05"]);
  assert.match(w.hosts["#itrp-hist-panel"], /data-code="COM05"/);
});

test("the search box filters the list on every word and shows the count", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history");
  const search = w.context.document.querySelector("#itrp-hist-search");
  search.value = "สมชาย บัญชี";
  search.listeners.input[0]();
  assert.match(w.hosts["#itrp-hist-devices"], /data-hist-code="COM05"/);
  assert.doesNotMatch(w.hosts["#itrp-hist-devices"], /data-hist-code="PRT22"/);
  assert.equal(w.context.document.querySelector("#itrp-hist-count").textContent, "พบ 1 จาก 3 เครื่อง");
  search.value = "ไม่มีแน่นอน";
  search.listeners.input[0]();
  assert.match(w.hosts["#itrp-hist-devices"], /ไม่พบเครื่องที่ตรงกับคำค้น/);
});

test("the IT admin back-dates a paper entry: validated on the page, then app_itrp_history_add with all eight fields, then the list and the machine reload", async () => {
  const added = [];
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_history_add: (args) => { added.push(args); return 99; } }) });
  await w.open("view=history&code=COM05");
  w.context.document.querySelector("#itrp-hist-add-entry").listeners.click[0]();
  const form = w.context.document.querySelector("#itrp-hist-form");
  assert.equal(form.controls.device_code.value, "COM05", "the selected machine is prefilled");
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "an untouched form has nothing to lose");
  form.controls.device_code.value = "";
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["device_code", "reported_on", "symptom"], "the page refuses an empty form first");
  assert.ok(!w.names().includes("app_itrp_history_add"));
  form.controls.device_code.value = " prt22 ";
  form.controls.doc_no.value = "IT01-25/012";
  form.controls.reported_on.value = "31/04/2568";
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["reported_on", "symptom"], "31 April is not a date");
  assert.match(w.calls.fieldErrors[0].message, /วันที่แจ้งซ่อมไม่ถูกต้อง/);
  assert.ok(!w.names().includes("app_itrp_history_add"));
  form.controls.reported_on.value = " 01/05/2568 "; // พ.ศ. 2568 = ค.ศ. 2025
  form.controls.symptom.value = "พิมพ์ไม่ออก";
  form.controls.finished_on.value = "02/05/2025"; // ค.ศ. ก็พิมพ์ได้
  form.controls.reporter_name.value = "สมชาย";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1, "typed data in the open form is counted");
  w.table.app_itrp_device_history = ({ p_code }) => HISTORY(p_code);
  const before = w.names().length;
  await form.listeners.submit[0]({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(added), [{ p_device_code: "PRT22", p_doc_no: "IT01-25/012", p_reported_on: "2025-05-01", p_symptom: "พิมพ์ไม่ออก", p_action: null, p_finished_on: "2025-05-02", p_remark: null, p_reporter_name: "สมชาย" }]);
  assert.ok(w.calls.toasts.some((toast) => toast.message === "ลงประวัติการซ่อมย้อนหลังแล้ว"));
  assert.deepEqual(w.names().slice(before), ["app_itrp_history_add", "app_itrp_list_devices", "app_itrp_device_history"]);
  assert.deepEqual(w.last("app_itrp_device_history").args, { p_code: "PRT22" }, "the machine that was just written is opened");
  assert.equal(w.hosts["#itrp-hist-forms"], "", "the form closes");
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
});

test("a database refusal keeps the history form open with its text and the Thai message", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history&code=COM05");
  w.rpcFail.set("app_itrp_history_add", Object.assign(new Error("มีประวัติของเครื่อง COM05 เลขที่ใบ IT01-16/0001 อยู่แล้ว"), { code: "23514" }));
  w.context.document.querySelector("#itrp-hist-add-entry").listeners.click[0]();
  const form = w.context.document.querySelector("#itrp-hist-form");
  form.controls.reported_on.value = "2016-03-05";
  form.controls.symptom.value = "จอเสีย";
  await form.listeners.submit[0]({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(w.elements["#itrp-hist-form-message"].innerHTML, /มีประวัติของเครื่อง COM05 เลขที่ใบ IT01-16\/0001 อยู่แล้ว/);
  assert.notEqual(w.hosts["#itrp-hist-forms"], "", "the form stays");
  assert.deepEqual(w.calls.busy.slice(-2), [true, false]);
  assert.equal(form.controls.symptom.value, "จอเสีย");
});

test("editing an imported row loads its current values and sends the whole row to app_itrp_history_update", async () => {
  const updates = [];
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_history_update: (args) => { updates.push(args); return { id: 7, revision_count: 2 }; } }) });
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-edit]", { histEdit: "7" });
  const form = w.context.document.querySelector("#itrp-hist-form");
  assert.match(w.hosts["#itrp-hist-forms"], /แก้ไขรายการประวัติการซ่อม/);
  assert.deepEqual(Object.fromEntries(Object.entries(form.controls).map(([name, control]) => [name, control.value])), {
    doc_no: "IT01-16/0001", device_code: "COM05", reported_on: "05/03/2559", finished_on: "06/03/2559", symptom: "จอเสีย", action: "เปลี่ยนจอ", remark: "", reporter_name: "สมชาย",
  }, "a stored ISO date is shown as dd/mm/yyyy (Buddhist year) in a typed text field");
  form.controls.action.value = "";
  form.controls.remark.value = "ควรเปลี่ยนอีก";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1, "an edited form counts against its loaded values");
  await form.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].p_entry_id, 7);
  assert.equal(updates[0].p_action, null, "a blanked field is sent as null on purpose");
  assert.equal(updates[0].p_remark, "ควรเปลี่ยนอีก");
  assert.equal(updates[0].p_symptom, "จอเสีย", "an untouched field keeps its loaded value");
  assert.equal(updates[0].p_reported_on, "2016-03-05", "the untouched shown date goes back as the same ISO date");
  assert.equal(updates[0].p_finished_on, "2016-03-06");
  assert.deepEqual(Object.keys(updates[0]), ["p_entry_id", "p_device_code", "p_doc_no", "p_reported_on", "p_symptom", "p_action", "p_finished_on", "p_remark", "p_reporter_name"]);
  assert.ok(w.calls.toasts.some((toast) => toast.message === "แก้ไขรายการประวัติการซ่อมแล้ว"));
});

test("voiding a row asks for a reason first (cancel = nothing sent), then calls app_itrp_history_void", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_history_void: () => ({ id: 7 }) }) });
  await w.open("view=history&code=COM05");
  w.answers.prompt = null;
  await delegate(panelOf(w), "[data-hist-void]", { histVoid: "7" });
  assert.equal(w.calls.prompts.length, 1);
  assert.equal(w.calls.prompts[0].minLength, 1, "a reason is required");
  assert.equal(w.calls.prompts[0].maxLength, 500);
  assert.ok(!w.names().includes("app_itrp_history_void"));
  w.answers.prompt = "ลงผิดเครื่อง";
  const before = w.names().length;
  await delegate(panelOf(w), "[data-hist-void]", { histVoid: "7" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(w.last("app_itrp_history_void").args, { p_entry_id: "7", p_reason: "ลงผิดเครื่อง" });
  assert.deepEqual(w.names().slice(before), ["app_itrp_history_void", "app_itrp_list_devices", "app_itrp_device_history"]);
  assert.ok(w.calls.toasts.some((toast) => toast.message === "ยกเลิกรายการประวัติแล้ว"));
});

test("'see revisions' shows each earlier version from app_itrp_history_get", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_history_get: () => ({
    entry: { id: 7, doc_no: "IT01-16/0001", created_by_full_name: "สุริยา", created_at: "2026-11-23T01:00:00Z", voided_at: null },
    revisions: [{ revision_no: 1, change_kind: "update", snapshot: { doc_no: "IT01-16/0001", device_code: "COM05", reported_on: "2016-03-05", symptom: "จอ", action: null, finished_on: null, remark: null, reporter_name: "สมชาย" }, changed_by_full_name: "สุริยา", reason: null, created_at: "2026-11-23T03:00:00Z" }],
  }) }) });
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-revisions]", { histRevisions: "7" });
  assert.deepEqual(w.last("app_itrp_history_get").args, { p_entry_id: "7" });
  const html = w.hosts["#itrp-hist-forms"];
  assert.match(html, /id="itrp-hist-revisions-card"/);
  assert.match(html, /ครั้งที่ 1 · แก้ไข/);
  assert.match(html, /ฉบับเดิมก่อนการแก้ไขครั้งนี้/);
  assert.match(html, /05\/03\/2559/);
});

test("the machine register: adding sends all ten fields, blocks a code already registered, and editing loads the full current values", async () => {
  const saved = [];
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_save_device: (args) => { saved.push(args); return { id: 5, code: args.p_code, created: true, changed: true }; } }) });
  await w.open("view=history&code=COM05");
  w.context.document.querySelector("#itrp-hist-add-device").listeners.click[0]();
  let form = w.context.document.querySelector("#itrp-device-form");
  assert.equal(form.controls.kind.value, "computer");
  assert.equal(form.controls.status.value, "active");
  form.controls.code.value = "";
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["code"]);
  form.controls.code.value = " com05 ";
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.match(w.calls.fieldErrors[0].message, /^รหัสนี้มีในทะเบียนแล้ว/, "an add that would silently overwrite a registered machine is stopped");
  assert.equal(saved.length, 0);
  form.controls.code.value = " mnt27 ";
  form.controls.kind.value = "monitor";
  form.controls.user_name.value = "สมหญิง";
  await form.listeners.submit[0]({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(plain(saved), [{ p_code: "MNT27", p_kind: "monitor", p_user_name: "สมหญิง", p_division: null, p_cpu_name: null, p_cpu_model: null, p_started_on: null, p_asset_no: null, p_status: "active", p_note: null }]);
  assert.ok(w.calls.toasts.some((toast) => toast.message === "เพิ่มเครื่อง MNT27 เข้าทะเบียนแล้ว"));
  // แก้เครื่องเดิม: โหลดค่าเดิมครบ รหัสแก้ไม่ได้ ส่งครบทุกช่อง
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-edit-device]", {});
  form = w.context.document.querySelector("#itrp-device-form");
  assert.deepEqual(Object.fromEntries(Object.entries(form.controls).map(([name, control]) => [name, control.value])), {
    code: "COM05", kind: "computer", user_name: "สมชาย", division: "บัญชี", cpu_name: "Intel Core i5", cpu_model: "10400", started_on: "01/04/2566", asset_no: "AS-100", status: "active", note: "ตั้งโต๊ะ",
  });
  assert.equal(form.controls.code.readOnly, true, "the code cannot be changed after creation");
  form.controls.status.value = "retired";
  w.table.app_itrp_save_device = (args) => { saved.push(args); return { id: 1, code: "COM05", created: false, changed: true }; };
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.deepEqual(plain(saved.at(-1)), { p_code: "COM05", p_kind: "computer", p_user_name: "สมชาย", p_division: "บัญชี", p_cpu_name: "Intel Core i5", p_cpu_model: "10400", p_started_on: "2023-04-01", p_asset_no: "AS-100", p_status: "retired", p_note: "ตั้งโต๊ะ" });
});

test("a code that has history but is not registered can be added to the register from its panel", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history&code=OLD1");
  assert.match(w.html, /เพิ่มเข้าทะเบียนเครื่อง/);
  await delegate(panelOf(w), "[data-hist-edit-device]", {});
  const form = w.context.document.querySelector("#itrp-device-form");
  assert.equal(form.controls.code.value, "OLD1");
  assert.match(w.hosts["#itrp-hist-forms"], /เพิ่มเครื่องเข้าทะเบียน/);
});

test("an open register form counts as unsaved until it is closed, and not once the page has been left", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-edit-device]", {});
  const form = w.context.document.querySelector("#itrp-device-form");
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
  form.controls.note.value = "แก้แล้ว";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  w.context.document.querySelector("#itrp-device-form-cancel").listeners.click[0]();
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "a closed form has nothing to lose");
  await delegate(panelOf(w), "[data-hist-edit-device]", {});
  w.context.document.querySelector("#itrp-device-form").controls.note.value = "พิมพ์ค้าง";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  w.context.location.hash = "#/dashboard"; // ออกไปหน้านอกโมดูลแล้ว
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "outside the module nothing is counted (PR 407)");
  w.context.location.hash = "";
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "the probe was dropped");
  await w.open("view=history&code=COM05");
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "a fresh page starts clean");
});

test("adding a machine checks the database live: a code registered meanwhile is refused and never overwritten", async () => {
  const saved = [];
  // รายการในหน้าไม่มี NEW9 แต่ฐานข้อมูลมีแล้ว (มีคนเพิ่มจากแท็บอื่น)
  const w = world({ role: ROLE_IT, handlers: historyHandlers({
    app_itrp_list_devices: ({ p_search }) => (p_search ? [{ code: "NEW9", in_registry: true, kind: "computer", status: "active" }] : DEVICES),
    app_itrp_save_device: (args) => { saved.push(args); return { id: 9, code: args.p_code, created: true, changed: true }; },
  }) });
  await w.open("view=history&code=COM05");
  w.context.document.querySelector("#itrp-hist-add-device").listeners.click[0]();
  const form = w.context.document.querySelector("#itrp-device-form");
  form.controls.code.value = " new9 ";
  await form.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.deepEqual(w.last("app_itrp_list_devices").args, { p_search: "NEW9" }, "the exact code is searched, normalised");
  assert.equal(saved.length, 0, "nothing is written over the existing machine");
  assert.match(w.calls.fieldErrors[0].message, /^รหัสนี้มีในทะเบียนแล้ว/);
  assert.equal(w.calls.fieldErrors[0].name, "code");
  assert.notEqual(w.hosts["#itrp-hist-forms"], "", "the form stays open");
  assert.deepEqual(w.calls.busy.slice(-2), [true, false], "the form is released again");
  // รหัสที่มีแต่ในประวัติ (in_registry = false) ยังเพิ่มเข้าทะเบียนได้
  w.table.app_itrp_list_devices = ({ p_search }) => (p_search ? [{ code: "OLD1", in_registry: false, kind: null }] : DEVICES);
  form.controls.code.value = "old1";
  await form.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].p_code, "OLD1");
  // เช็กสดไม่สำเร็จ = ไม่เขียน และแจ้งเหตุผล
  w.context.document.querySelector("#itrp-hist-add-device").listeners.click[0]();
  const again = w.context.document.querySelector("#itrp-device-form");
  again.controls.code.value = "NEW10";
  w.rpcFail.set("app_itrp_list_devices", Object.assign(new Error("Failed to fetch"), { code: "" }));
  await again.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.equal(saved.length, 1, "a failed check never falls through to the write");
  assert.match(w.elements["#itrp-device-form-message"].innerHTML, /ผลไม่แน่ชัด/);
  // แก้เครื่องเดิมไม่ต้องเช็ก (รหัสแก้ไม่ได้)
  await w.open("view=history&code=COM05");
  await delegate(panelOf(w), "[data-hist-edit-device]", {});
  const before = w.names().filter((name) => name === "app_itrp_list_devices").length;
  const edit = w.context.document.querySelector("#itrp-device-form");
  edit.controls.note.value = "แก้";
  await edit.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.equal(w.last("app_itrp_save_device").args.p_code, "COM05");
  assert.equal(w.names().filter((name) => name === "app_itrp_list_devices").length - before, 1, "only the reload after saving, no pre-check for an edit");
});

test("the register date is typed too: a Buddhist-year date is sent as ISO and a bad one is refused on the field", async () => {
  const saved = [];
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_save_device: (args) => { saved.push(args); return { id: 5, code: args.p_code, created: true, changed: true }; } }) });
  await w.open("view=history&code=COM05");
  w.context.document.querySelector("#itrp-hist-add-device").listeners.click[0]();
  const form = w.context.document.querySelector("#itrp-device-form");
  form.controls.code.value = "MNT27";
  form.controls.started_on.value = "30/02/2566";
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.name), ["started_on"]);
  assert.equal(saved.length, 0);
  form.controls.started_on.value = "01/04/2566";
  await form.listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.equal(saved[0].p_started_on, "2023-04-01");
});

test("opening another form, the revisions or another machine while a form has typed data asks first; an untouched form is replaced silently", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_history_get: () => ({ entry: { id: 7, doc_no: "X", created_at: "2026-11-23T01:00:00Z" }, revisions: [] }) }) });
  await w.open("view=history&code=COM05");
  const listHost = w.context.document.querySelector("#itrp-hist-devices");
  const addEntry = w.context.document.querySelector("#itrp-hist-add-entry");
  const addDevice = w.context.document.querySelector("#itrp-hist-add-device");
  // ยังไม่พิมพ์อะไร: เปลี่ยนฟอร์มได้ทันที ไม่ถาม
  addEntry.listeners.click[0]();
  addDevice.listeners.click[0]();
  assert.equal(w.calls.confirms.length, 0, "an untouched form has nothing to lose");
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-device-form-card"/);
  // พิมพ์ค้างไว้ แล้วกดเปิดฟอร์มอื่น: ถาม · ปฏิเสธ = ฟอร์มเดิมอยู่พร้อมข้อความ
  w.context.document.querySelector("#itrp-device-form").controls.note.value = "พิมพ์ค้าง";
  w.answers.confirm = false;
  addEntry.listeners.click[0]();
  await flush();
  assert.equal(w.calls.confirms.length, 1);
  assert.equal(w.calls.confirms[0].danger, true);
  assert.match(w.calls.confirms[0].title, /ทิ้ง/);
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-device-form-card"/, "declined: the form with the typed text stays");
  assert.equal(w.context.document.querySelector("#itrp-device-form").controls.note.value, "พิมพ์ค้าง");
  // ยอมรับ = ทิ้งแล้วเปิดฟอร์มใหม่
  w.answers.confirm = true;
  addEntry.listeners.click[0]();
  await flush();
  assert.equal(w.calls.confirms.length, 2);
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-form-card"/);
  // ดูรอยแก้ขณะมีฟอร์มค้าง: ถามหลังดึงรอยแก้มาได้แล้ว · ปฏิเสธ = ฟอร์มเดิมอยู่
  const form = w.context.document.querySelector("#itrp-hist-form");
  form.controls.symptom.value = "กรอกค้างอยู่";
  w.answers.confirm = false;
  await delegate(panelOf(w), "[data-hist-revisions]", { histRevisions: "7" });
  assert.equal(w.calls.confirms.length, 3);
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-form-card"/, "declined: still the form");
  w.answers.confirm = true;
  await delegate(panelOf(w), "[data-hist-revisions]", { histRevisions: "7" });
  assert.equal(w.calls.confirms.length, 4);
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-revisions-card"/);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0, "a revisions card holds no typed data");
  // ฟอร์มแก้ของเครื่องเดิม + เลือกเครื่องอื่น: ถามเมื่อมีของค้าง แล้วปิดฟอร์ม
  await delegate(panelOf(w), "[data-hist-edit]", { histEdit: "7" });
  const editForm = w.context.document.querySelector("#itrp-hist-form");
  editForm.controls.action.value = "แก้ค้าง";
  w.answers.confirm = false;
  await delegate(listHost, "[data-hist-code]", { histCode: "PRT22" });
  assert.equal(w.calls.confirms.length, 5);
  assert.ok(!w.last("app_itrp_device_history") || w.last("app_itrp_device_history").args.p_code !== "PRT22", "declined: the machine does not change");
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-form-card"/);
  w.answers.confirm = true;
  await delegate(listHost, "[data-hist-code]", { histCode: "PRT22" });
  assert.equal(w.calls.confirms.length, 6);
  assert.equal(w.last("app_itrp_device_history").args.p_code, "PRT22");
  assert.equal(w.hosts["#itrp-hist-forms"], "", "the form of the old machine is closed");
  // ฟอร์ม "เพิ่ม" ไม่ผูกกับเครื่อง: เลือกเครื่องอื่นไม่ถามและไม่ปิด
  addEntry.listeners.click[0]();
  w.context.document.querySelector("#itrp-hist-form").controls.symptom.value = "ลงย้อนหลังค้าง";
  await delegate(listHost, "[data-hist-code]", { histCode: "OLD1" });
  assert.equal(w.calls.confirms.length, 6, "an add form is not tied to the chosen machine");
  assert.match(w.hosts["#itrp-hist-forms"], /id="itrp-hist-form-card"/);
});

test("choosing a machine redraws the list but keeps keyboard focus on that machine, and the panel is not a live region", async () => {
  const w = world({ role: ROLE_IT, handlers: historyHandlers() });
  await w.open("view=history");
  assert.doesNotMatch(w.html, /id="itrp-hist-panel"[^>]*aria-live/, "the whole panel is not re-read by screen readers");
  assert.match(w.html, /id="itrp-hist-status"[^>]*role="status"/);
  const list = w.context.document.querySelector("#itrp-hist-devices");
  const button = el({ dataset: { histCode: "COM05" } });
  const other = el({ dataset: { histCode: "PRT22" } });
  list.contains = (node) => node === button;
  list.querySelectorAll = () => [other, button];
  w.context.document.activeElement = button; // ผู้ใช้เลือกด้วยคีย์บอร์ด โฟกัสอยู่ที่ปุ่มของ COM05
  el.focused = null;
  await delegate(list, "[data-hist-code]", { histCode: "COM05" });
  assert.equal(el.focused, button, "focus goes back to the chosen machine after the list is redrawn");
  // โฟกัสอยู่นอกรายการ (เช่น ช่องค้นหา) ไม่ถูกแย่ง
  el.focused = null;
  w.context.document.activeElement = el();
  await delegate(list, "[data-hist-code]", { histCode: "PRT22" });
  assert.equal(el.focused, null);
  // ประกาศสั้นๆ ผ่านบรรทัดสถานะ ไม่อ่านทั้งตาราง
  await delegate(list, "[data-hist-code]", { histCode: "COM05" });
  assert.equal(w.elements["#itrp-hist-status"].textContent, "โหลดประวัติของ COM05 แล้ว 2 รายการ");
});

test("the FM02 print page reads the machine, shows the 7 columns, and prints from its button", async () => {
  const w = world({ role: ROLE_APPROVER, handlers: historyHandlers() });
  await w.open("view=history-print&code=com05");
  assert.deepEqual(w.last("app_itrp_device_history").args, { p_code: "COM05" });
  assert.deepEqual(w.title, { path: "office", title: "พิมพ์ประวัติการซ่อม", tabTitle: "ประวัติการซ่อม COM05" });
  assert.match(w.html, /class="itrp-sheet itrp-fm02"/);
  assert.match(w.html, /ประวัติการซ่อมเครื่องคอมพิวเตอร์/);
  assert.match(w.html, /IT01-FM02/);
  assert.match(w.html, /href="#\/office\?module=repair&amp;view=history&amp;code=COM05">‹ กลับไปประวัติการซ่อม/);
  assert.equal((w.html.match(/<th scope="col">/g) ?? []).length, 7);
  assert.doesNotMatch(w.html, /itrp-dev-notice/, "the sheet has no development banner");
  w.context.document.querySelector("#itrp-history-print-button").listeners.click[0]();
  assert.equal(w.calls.printed, 1);
  const missing = world({ role: ROLE_IT, handlers: historyHandlers() });
  await missing.open("view=history-print");
  assert.equal(missing.calls.notFound, 1);
  const refused = world({ role: ROLE_IT, handlers: historyHandlers({ app_itrp_device_history: () => { throw Object.assign(new Error("เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT เท่านั้นที่ดูประวัติการซ่อมได้"), { code: "42501" }); } }) });
  await refused.open("view=history-print&code=COM05");
  assert.match(refused.html, /เฉพาะผู้ดูแลงาน IT และผู้อนุมัติขั้น IT/);
});

test("a database that has not been updated yet gives a readable message instead of a broken page", async () => {
  const w = world({ role: ROLE_IT, handlers: { app_itrp_list_devices: () => { throw Object.assign(new Error("Could not find the function"), { code: "PGRST202" }); } } });
  await w.open("view=history");
  assert.match(w.html, /ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบแจ้งซ่อม/);
  const complete = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_complete: () => { throw Object.assign(new Error("Could not find the function public.app_itrp_complete(p_devices)"), { code: "PGRST202" }); } } });
  await complete.open(`view=order&id=${ID}`);
  fillComplete(complete);
  await complete.submit("#itrp-complete-form");
  assert.match(complete.elements["#itrp-complete-message"].innerHTML, /ฐานข้อมูลยังไม่ได้อัปเดตสำหรับใบแจ้งซ่อม/);
});

/* ---------- เปลี่ยน / ย้ายชิ้นส่วน (หน้ารายละเอียดใบ) ---------- */
const pcPart = (id, type, regNo, extra = {}) => ({ id, type_code: type, type_name: type, reg_no: regNo, device_code: null, name: `${type} ${regNo}`, model: null, serial: null, status: "in_use", host_code: "PC-001", slot: null, place: null, ...extra });
const PC_CONTEXT = (overrides = {}) => ({
  request: { id: ID, doc_no: "IT01-26/050", status: "in_progress", is_test: false, asset_code: "PC-001", device_name: "Dell" },
  can_apply: true, blocked_reason: null, max_changes: 20, result_statuses: ["broken", "spare", "retired"],
  hosts: [{ host_code: "PC-001", source: "request", device: null, parts: [pcPart("p1", "RAM", "RAM-001", { slot: "DIMM1" }), pcPart("p2", "SSD", "SSD-001", { status: "broken" })] }],
  spares: [{ type_code: "RAM", type_name: "RAM", items: [pcPart("s1", "RAM", "RAM-009", { status: "spare", host_code: null })] }, { type_code: "SSD", type_name: "SSD", items: [pcPart("s3", "SSD", "SSD-009", { status: "spare", host_code: null })] }],
  move_targets: [{ device_code: "PC-001", name: "Dell", type_code: "COMPUTER" }, { device_code: "PC-002", name: "HP", type_code: "COMPUTER" }],
  ...overrides,
});
const PC_ITEM = (overrides = {}) => ({ id: 1, line_no: 1, action: "replace", host_code: "PC-001", to_host_code: null, asset: { type_code: "RAM", type_name: "RAM", reg_no: "RAM-001", name: "RAM RAM-001" }, new_asset: { type_code: "RAM", type_name: "RAM", reg_no: "RAM-009", name: "RAM RAM-009" }, result_status: "broken", slot: "DIMM1", note: null, actor_employee_no: "IT3462", actor_full_name: "สุริยา", created_at: "2026-11-25T03:00:00Z", ...overrides });
function pcWorld({ context = () => PC_CONTEXT(), items = () => ({ request_id: ID, doc_no: "IT01-26/050", items: [] }), apply = (args) => ({ request_id: ID, doc_no: "IT01-26/050", batch_id: "b1", applied: args.p_changes.length, changes: [] }), handlers = {}, ...options } = {}) {
  return world({ role: ROLE_IT, handlers: { app_itrp_get_detail: IT_DETAIL, app_itrp_part_changes_context: context, app_itrp_get_part_changes: items, app_itrp_apply_part_changes: apply, ...handlers }, ...options });
}
const pcHost = (w) => w.context.document.querySelector("#itrp-partchg-apply");
const pcHistory = (w) => w.context.document.querySelector("#itrp-partchg-history");
async function pcClick(w, act, data = {}) {
  const button = { dataset: { pcAct: act, ...data } };
  await pcHost(w).listeners.click[0]({ target: { closest: (selector) => (selector === "[data-pc-act]" ? button : null) } });
  await flush();
}
// ส่งฟอร์มเลือกรายละเอียด (ค่าที่ผู้ใช้เลือก) คืนข้อความที่ฟอร์มแสดง
async function pcSubmit(w, values = {}) {
  const message = el();
  const controls = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, { value }]));
  const form = { querySelector: (selector) => (selector.includes("data-pc-editor-message") ? message : controls[/name="(\w+)"/.exec(selector)?.[1]] ?? null) };
  let prevented = false;
  await pcHost(w).listeners.submit[0]({ target: { closest: (selector) => (selector === "[data-pc-editor]" ? form : null) }, preventDefault() { prevented = true; } });
  await flush();
  assert.equal(prevented, true, "the editor form never navigates");
  return message.innerHTML;
}
const toastTexts = (w) => w.calls.toasts.map((toast) => toast.message);

test("an IT admin sees the part change card with the machines of the request, and the history place stays hidden while empty", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  assert.deepEqual(w.last("app_itrp_part_changes_context").args, { p_request_id: ID });
  assert.deepEqual(w.last("app_itrp_get_part_changes").args, { p_request_id: ID });
  assert.equal(pcHost(w).hidden, false);
  assert.match(pcHost(w).innerHTML, /data-host="PC-001"/);
  assert.match(pcHost(w).innerHTML, /data-pc-act="replace" data-pc-host="PC-001" data-pc-asset="p1"/);
  assert.equal(pcHistory(w).hidden, true);
  assert.equal(w.calls.toasts.length, 0);
});

test("a requester never calls the context RPC but reads the saved history of the request", async () => {
  const w = world({ role: ROLE_EMP, handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed" }), app_itrp_get_part_changes: () => ({ items: [PC_ITEM(), PC_ITEM({ id: 2, action: "install", new_asset: null, result_status: null })] }) } });
  await w.open(`view=order&id=${ID}`);
  assert.ok(!w.names().includes("app_itrp_part_changes_context"));
  assert.equal(pcHost(w).hidden, true);
  assert.equal(pcHistory(w).hidden, false);
  assert.match(pcHistory(w).innerHTML, /ประวัติการเปลี่ยน \/ ย้ายชิ้นส่วน <span class="detail-section-count">2<\/span>/);
  assert.match(pcHistory(w).innerHTML, /เปลี่ยน RAM RAM-001/);
});

test("the section hides quietly when the RPCs are missing or the database says no permission, and the request still draws", async () => {
  const missing = Object.assign(new Error("Could not find the function"), { code: "PGRST202" });
  const none = pcWorld({ context: () => { throw missing; }, items: () => { throw missing; } });
  await none.open(`view=order&id=${ID}`);
  assert.equal(pcHost(none).hidden, true);
  assert.equal(pcHistory(none).hidden, true);
  assert.match(none.screen, /ข้อมูลใบแจ้งซ่อม/);
  assert.equal(none.calls.toasts.length, 0);
  const denied = pcWorld({ context: () => { throw Object.assign(new Error("เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียนอุปกรณ์ได้"), { code: "42501" }); } });
  await denied.open(`view=order&id=${ID}`);
  assert.equal(pcHost(denied).hidden, true);
  assert.equal(denied.calls.toasts.length, 0);
  assert.doesNotMatch(denied.screen, /เฉพาะผู้ดูแลงาน IT เท่านั้นที่ใช้ทะเบียน/, "no error text is shown");
  const garbage = pcWorld({ context: () => "not an object" });
  await garbage.open(`view=order&id=${ID}`);
  assert.equal(pcHost(garbage).hidden, true);
});

test("a blocked request shows the reason and offers no buttons", async () => {
  const w = pcWorld({ context: () => PC_CONTEXT({ can_apply: false, blocked_reason: "ใบนี้ยังไม่มีรหัสเครื่อง กรุณาระบุเครื่องที่ซ่อมตอนส่งงานก่อน" }) });
  await w.open(`view=order&id=${ID}`);
  assert.equal(pcHost(w).hidden, false);
  assert.match(pcHost(w).innerHTML, /ใบนี้ยังไม่มีรหัสเครื่อง/);
  assert.doesNotMatch(pcHost(w).innerHTML, /data-pc-act=/);
});

test("a request that cannot apply and is not in progress or sent off hides the whole part change card", async () => {
  const w = pcWorld({ context: () => PC_CONTEXT({ request: { id: ID, doc_no: "IT01-26/050", status: "it_approved" }, can_apply: false, blocked_reason: "ใบนี้ยังไม่ถึงขั้นทำงาน" }) });
  await w.open(`view=order&id=${ID}`);
  assert.equal(pcHost(w).hidden, true);
  assert.doesNotMatch(pcHost(w).innerHTML, /ใบนี้ยังไม่ถึงขั้นทำงาน/);
  assert.match(w.screen, /ข้อมูลใบแจ้งซ่อม/);
});

test("replace: choose, review the summary, confirm, and one RPC call saves the whole batch; then context and history reload", async () => {
  let context = PC_CONTEXT();
  const w = pcWorld({ context: () => context });
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "replace", { pcHost: "PC-001", pcAsset: "p1" });
  assert.match(pcHost(w).innerHTML, /id="itrp-partchg-editor"/);
  assert.equal(await pcSubmit(w, { new_asset_id: "s1", result_status: "broken", slot: "", note: " เสียบไม่แน่น " }), "");
  assert.doesNotMatch(pcHost(w).innerHTML, /id="itrp-partchg-editor"/, "the editor closes once the row is added");
  assert.match(pcHost(w).innerHTML, /รายการที่เลือก <span class="detail-section-count">1\/20/);
  assert.match(pcHost(w).innerHTML, /เปลี่ยน RAM-001 · RAM RAM-001 เป็น RAM-009/);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1, "a chosen but unsaved row is unsaved work");
  assert.ok(!w.names().includes("app_itrp_apply_part_changes"), "nothing is sent before the save button");
  context = PC_CONTEXT({ hosts: [{ host_code: "PC-001", source: "request", device: null, parts: [pcPart("s1", "RAM", "RAM-009", { slot: "DIMM1" }), pcPart("p2", "SSD", "SSD-001", { status: "broken" })] }], spares: [] });
  await pcClick(w, "save");
  assert.equal(w.calls.confirms.at(-1).title, "บันทึกการเปลี่ยนชิ้นส่วน 1 รายการ?");
  assert.deepEqual(w.last("app_itrp_apply_part_changes").args, { p_request_id: ID, p_changes: [{ action: "replace", host_code: "PC-001", asset_id: "p1", new_asset_id: "s1", result_status: "broken", note: "เสียบไม่แน่น" }] });
  assert.ok(toastTexts(w).includes("บันทึกการเปลี่ยนชิ้นส่วนแล้ว 1 รายการ"));
  assert.equal(w.names().filter((name) => name === "app_itrp_part_changes_context").length, 2, "context is reloaded after saving");
  assert.equal(w.names().filter((name) => name === "app_itrp_get_part_changes").length, 2, "history is reloaded after saving");
  assert.doesNotMatch(pcHost(w).innerHTML, /data-pc-act="save"/);
  assert.match(pcHost(w).innerHTML, /RAM-009/);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
  assert.equal(w.calls.renderRoutes, 0, "the whole page is not reloaded");
});

test("the save button asks first, sends nothing when declined, and a double click sends only one call", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcSubmit(w, { result_status: "retired", note: "" });
  w.answers.confirm = false;
  await pcClick(w, "save");
  assert.ok(!w.names().includes("app_itrp_apply_part_changes"));
  assert.match(pcHost(w).innerHTML, /data-pc-act="save"/, "the chosen row stays after declining");
  w.answers.confirm = true;
  await Promise.all([pcClick(w, "save"), pcClick(w, "save")]);
  assert.equal(w.names().filter((name) => name === "app_itrp_apply_part_changes").length, 1);
  assert.deepEqual(w.last("app_itrp_apply_part_changes").args.p_changes, [{ action: "remove", host_code: "PC-001", asset_id: "p2", result_status: "retired" }]);
});

test("a wrong choice is explained inside the editor and nothing is added", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "replace", { pcHost: "PC-001", pcAsset: "p1" });
  assert.match(await pcSubmit(w, { new_asset_id: "", result_status: "broken" }), /กรุณาเลือกชิ้นสำรองที่จะใส่แทน/);
  assert.match(await pcSubmit(w, { new_asset_id: "s3", result_status: "broken" }), /ชนิดไม่ตรงกัน/);
  assert.match(pcHost(w).innerHTML, /id="itrp-partchg-editor"/, "the editor stays open so the user can fix it");
  assert.doesNotMatch(pcHost(w).innerHTML, /รายการที่เลือก/);
});

test("move accepts a typed machine code in any letter case and install takes a spare chosen from the list", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "move", { pcHost: "PC-001", pcAsset: "p1" });
  assert.equal(await pcSubmit(w, { to_host_code: " pc-002 ", slot: "", note: "" }), "");
  await pcClick(w, "install", { pcHost: "PC-001" });
  assert.match(pcHost(w).innerHTML, /name="asset_id"/);
  assert.equal(await pcSubmit(w, { asset_id: "s3", slot: "M.2", note: "" }), "");
  await pcClick(w, "save");
  assert.deepEqual(w.last("app_itrp_apply_part_changes").args.p_changes, [
    { action: "move", host_code: "PC-001", asset_id: "p1", to_host_code: "PC-002" },
    { action: "install", host_code: "PC-001", asset_id: "s3", slot: "M.2" },
  ]);
});

test("cancelling the editor and removing a chosen row work before saving", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcClick(w, "editor-cancel");
  assert.doesNotMatch(pcHost(w).innerHTML, /id="itrp-partchg-editor"/);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcSubmit(w, { result_status: "broken", note: "" });
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 1);
  await pcClick(w, "remove-row", { pcIndex: "0" });
  assert.doesNotMatch(pcHost(w).innerHTML, /data-pc-act="save"/);
  assert.equal(w.context.window.MNP_ITRP.unsavedCount(), 0);
  assert.ok(!w.names().includes("app_itrp_apply_part_changes"));
});

test("a database refusal keeps the rows, shows the Thai message with the failing row highlighted, and reloads the register", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcSubmit(w, { result_status: "broken", note: "" });
  await pcClick(w, "move", { pcHost: "PC-001", pcAsset: "p1" });
  await pcSubmit(w, { to_host_code: "PC-002" });
  w.rpcFail.set("app_itrp_apply_part_changes", Object.assign(new Error("แถวที่ 2: ไม่ได้ติดตั้งที่เครื่อง PC-001 ในทะเบียนแล้ว"), { code: "23514" }));
  await pcClick(w, "save");
  const html = pcHost(w).innerHTML;
  assert.match(html, /แถวที่ 2: ไม่ได้ติดตั้งที่เครื่อง PC-001 ในทะเบียนแล้ว/);
  assert.match(html, /itrp-partchg-pending-row is-error" data-pc-line="2"/);
  assert.doesNotMatch(html, /is-error" data-pc-line="1"/);
  assert.match(html, /บันทึกการเปลี่ยนชิ้นส่วน \(2 รายการ\)/, "both rows are still there because the register is unchanged");
  assert.equal(w.names().filter((name) => name === "app_itrp_part_changes_context").length, 2);
  assert.equal(w.calls.toasts.length, 0, "no success toast");
});

test("if the register changed meanwhile, rows that no longer fit are dropped and the user is told", async () => {
  let context = PC_CONTEXT();
  const w = pcWorld({ context: () => context });
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcSubmit(w, { result_status: "broken", note: "" });
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p1" });
  await pcSubmit(w, { result_status: "spare", note: "" });
  context = PC_CONTEXT({ hosts: [{ host_code: "PC-001", source: "request", device: null, parts: [pcPart("p2", "SSD", "SSD-001", { status: "broken" })] }] }); // p1 ถูกคนอื่นถอดไปแล้ว
  w.rpcFail.set("app_itrp_apply_part_changes", Object.assign(new Error("แถวที่ 2: RAM-001 ไม่ได้ติดตั้งที่เครื่อง PC-001 ในทะเบียนแล้ว"), { code: "23514" }));
  await pcClick(w, "save");
  const html = pcHost(w).innerHTML;
  assert.match(html, /นำรายการที่ใช้ไม่ได้ออก 1 รายการ/);
  assert.match(html, /บันทึกการเปลี่ยนชิ้นส่วน \(1 รายการ\)/);
  assert.doesNotMatch(html, /is-error/);
});

test("an unknown result (network lost) warns to check before pressing again, and the form stays usable", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "remove", { pcHost: "PC-001", pcAsset: "p2" });
  await pcSubmit(w, { result_status: "broken", note: "" });
  w.rpcFail.set("app_itrp_apply_part_changes", Object.assign(new Error("Failed to fetch"), { code: "" }));
  await pcClick(w, "save");
  assert.match(pcHost(w).innerHTML, /ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ/);
  assert.doesNotMatch(pcHost(w).innerHTML, /aria-busy="true"/, "the card is usable again");
  assert.doesNotMatch(pcHost(w).innerHTML, /<button[^>]*data-pc-act="save"[^>]*disabled/);
});

test("when the part data cannot be loaded (network) a retry button is shown and works", async () => {
  let fail = true;
  const w = pcWorld({ context: () => { if (fail) throw Object.assign(new Error("Failed to fetch"), { code: "" }); return PC_CONTEXT(); } });
  await w.open(`view=order&id=${ID}`);
  assert.equal(pcHost(w).hidden, false);
  assert.match(pcHost(w).innerHTML, /โหลดข้อมูลชิ้นส่วนไม่สำเร็จ/);
  fail = false;
  await pcClick(w, "reload");
  assert.match(pcHost(w).innerHTML, /data-host="PC-001"/);
});

test("typing in the spare search only changes the options of the select", async () => {
  const w = pcWorld();
  await w.open(`view=order&id=${ID}`);
  await pcClick(w, "install", { pcHost: "PC-001" });
  const select = { dataset: { spareType: "" }, innerHTML: "" };
  const input = { name: "spare_q", value: "ssd-009", closest: (selector) => (selector === "[data-pc-editor]" ? { querySelector: () => select } : null) };
  pcHost(w).listeners.input[0]({ target: input });
  assert.match(select.innerHTML, /SSD-009/);
  assert.doesNotMatch(select.innerHTML, /RAM-009/);
  input.value = "ไม่มีแบบนี้";
  pcHost(w).listeners.input[0]({ target: input });
  assert.match(select.innerHTML, /ไม่พบชิ้นสำรองที่ตรงกัน/);
  pcHost(w).listeners.input[0]({ target: { name: "slot", value: "x", closest: () => null } });
});

test("the print page adds the part change table only when there is history, and prints as before when the RPC is unavailable", async () => {
  const withItems = world({ role: ROLE_EMP, handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed" }), app_itrp_get_part_changes: () => ({ items: [PC_ITEM()] }) } });
  await withItems.open(`view=print&id=${ID}`);
  assert.deepEqual(withItems.last("app_itrp_get_part_changes").args, { p_request_id: ID });
  assert.match(withItems.html, /ประวัติการเปลี่ยน \/ ย้ายชิ้นส่วน/);
  assert.match(withItems.html, /itrp-sheet-partchg/);
  const none = world({ role: ROLE_EMP, handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed" }), app_itrp_get_part_changes: () => ({ items: [] }) } });
  await none.open(`view=print&id=${ID}`);
  assert.doesNotMatch(none.html, /itrp-sheet-partchg/);
  const broken = world({ role: ROLE_EMP, handlers: { app_itrp_get_detail: () => DETAIL({ status: "it_closed" }) } }); // ไม่มี handler = PGRST202
  await broken.open(`view=print&id=${ID}`);
  assert.match(broken.html, /class="itrp-sheet/);
  assert.doesNotMatch(broken.html, /itrp-sheet-partchg/);
});

/* ---------- งานบนหน้าแรก "งานของคุณวันนี้" (window.MNP_OFFICE_HOME → modules/office-home.js) ---------- */
test("home: the module registers its work for the home page under its card code with device/symptom as the title", async () => {
  const mine = [ROW(7, "it_closed", { asset_code: "PC-001" }), ROW(8, "need_info"), ROW(9, "pending_it_mgr", { is_urgent: true }), ROW(3, "received")];
  const w = world({ role: { ...ROLE_IT, is_dept_approver: true }, handlers: {
    app_itrp_list_mine: () => mine,
    app_itrp_list_pending_approvals: () => [ROW(1, "pending_dept", { requester_name: "สมหญิง", department_name: "การตลาด" }), ROW(2, "need_info")],
    app_itrp_list_it: () => [ROW(4, "approved"), ROW(5, "in_progress", { rework_round: 2 }), ROW(6, "it_closed")],
  } });
  const home = w.context.window.MNP_OFFICE_HOME.IT_COMPUTER_REPAIR;
  assert.equal(home.label, "ใบแจ้งซ่อม IT");
  const result = JSON.parse(JSON.stringify(await home.load({ id: "x" })));
  assert.deepEqual(result.tasks.map((task) => [task.id, task.task]), [[1, "รออนุมัติ"], [4, "เริ่มงาน"], [5, "แก้ไขงานครั้งที่ 2"], [7, "IT ส่งงานแล้ว รอคุณยืนยัน"], [8, "รอคุณตอบ"]]);
  assert.equal(result.tasks[0].title, "เครื่อง 1 · x");
  assert.equal(result.tasks[3].title, "PC-001 · เครื่อง 7 · x");
  assert.equal(result.tasks[0].typeCode, "IT_COMPUTER_REPAIR");
  assert.equal(result.tasks[0].href, `#/office?module=repair&view=order&id=1`);
  assert.deepEqual(result.mine.map((row) => [row.id, row.progressStatus, row.urgent]), [[9, "pending_it_mgr", true]]);
});

test("home: only the lists the role allows are read, and a failing read rejects so the home page can name the missing module", async () => {
  const plainUser = world({ role: ROLE_EMP, handlers: { app_itrp_list_mine: () => [ROW(1, "pending_dept")] } });
  const result = JSON.parse(JSON.stringify(await plainUser.context.window.MNP_OFFICE_HOME.IT_COMPUTER_REPAIR.load({ id: "x" })));
  assert.equal(result.mine.length, 1);
  assert.deepEqual([...new Set(plainUser.names())].sort(), ["app_itrp_list_mine", "app_itrp_my_role"]);
  const broken = world({ role: ROLE_EMP, handlers: { app_itrp_list_mine: () => { throw Object.assign(new Error("boom"), { code: "XX000" }); } } });
  const failed = await broken.context.window.MNP_OFFICE_HOME_RULES.collect(broken.context.window.MNP_OFFICE_HOME, { id: "x" });
  assert.deepEqual(JSON.parse(JSON.stringify(failed.failed)), [{ code: "IT_COMPUTER_REPAIR", label: "ใบแจ้งซ่อม IT" }]);
});
