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

function world({ role = ROLE_EMP, handlers = {}, draft = null, sandbox = false, inDevelopment = true } = {}) {
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
  const fail = { upload: null };
  const base = {
    app_itrp_my_role: () => role, app_itrp_list_mine: () => [], app_itrp_list_pending_approvals: () => [], app_itrp_list_it: () => [], app_itrp_pending_count: () => 0,
    app_itrp_list_staff: () => [], app_itrp_get_doc_counter: () => ({ year: 2026, last_seq: 49, next_seq: 50, next_doc_no: "IT01-26/050", is_test: false }),
  };
  const table = { ...base, ...handlers };
  const host = (selector, props = {}) => el({ ...props, get innerHTML() { return hosts[selector] ?? ""; }, set innerHTML(html) { hosts[selector] = html; } });
  const makers = {
    "#itrp-form-card": () => host("#itrp-form-card"),
    "#itrp-rework-card": () => host("#itrp-rework-card", { hidden: true }),
    "#itrp-ask-card": () => host("#itrp-ask-card", { hidden: true }),
    "#itrp-answer-card": () => host("#itrp-answer-card"),
    "#itrp-complete-card": () => el({ hidden: true }),
  };
  const visible = () => painted + Object.values(hosts).join("");

  // ฟอร์มแจ้งซ่อมจำลอง
  const createForm = (() => {
    const radios = { request_kind: ["repair", "replace_part", "inspect", "install", "other"].map((value) => el({ value })), repair_target: ["computer", "device", "other"].map((value) => el({ value })) };
    const controls = Object.fromEntries(["#itrp-asset-code", "#itrp-device-name", "#itrp-symptom", "#itrp-urgent", "#itrp-kind-note", "#itrp-target-note", "#itrp-review", "[data-step-submit]"].map((key) => [key, el()]));
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
    return el({
      controls, radios, body, get rows() { return rows; },
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
    window: context, console, URLSearchParams, Intl, Date, Number, Object, Promise, Array, JSON, Math, Set, Map, String, Boolean, Event: class {}, document: documentStub,
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
    createAutosave: () => ({ schedule() {}, start() {}, stop() {} }), offerDraft() {},
  };
  // inDevelopment: false = จำลองการถอดธง "กำลังพัฒนา" (แก้ค่าธงเดียวใน itrp-model.js ตามที่ผู้ดูแลจะทำจริง)
  for (const file of ["modules/itrp-model.js", "modules/itrp-pages.js", "modules/module-itrp.js"]) {
    const source = read(file);
    vm.runInContext(inDevelopment || file !== "modules/itrp-model.js" ? source : source.replace("const IN_DEVELOPMENT = true;", "const IN_DEVELOPMENT = false;"), context);
  }

  return {
    calls, context, createForm, completeForm, answers, rpcFail, fail, objects, elements, table,
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
  assert.equal(w.context.window.MNP_ITRP.version, "1.01");
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
  const w = world({ role: ROLE_IT, handlers: { app_itrp_get_detail: () => DETAIL() } });
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
  const w = world({ role: ROLE_IT, inDevelopment: false, handlers: { app_itrp_get_detail: () => DETAIL() } });
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
  assert.match(app, /\(window\.MNP_ITRP\?\.unsavedCount\?\.\(\) \?\? 0\) > 0;/, "leaving with typed IT data or a failed file asks first");
  assert.match(app, /action_url\?\.startsWith\("\/office\/repair\/"\)/);
  assert.match(read("modules/module-office.js"), /window\.MNP_ITRP\.render\(params\)/);
});
