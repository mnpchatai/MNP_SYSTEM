import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import { createItwoMock } from "../pilot-harness-itwo-mock.mjs";

// modules/module-itwo.js (การเชื่อมต่อ: เรียก RPC แท็บตามบทบาท ปุ่มตาม allowed_actions กล่องยืนยัน ฟอร์มแจ้งงาน ข้อความ error)
// รันในคอนเท็กซ์จำลองที่มี helper ของ app.js แบบ stub และ sb.rpc ต่อกับฐานข้อมูลจำลอง scripts/pilot-harness-itwo-mock.mjs (กติกาเส้นทางอนุมัติตรงกับ migration)
// ไม่มี DOM จริง: ตัวควบคุมของหน้าเป็นตัวแทนเล็ก ๆ ที่ผูก event ได้ ส่วนที่ตรวจคือ HTML ที่วาด การเรียก RPC และข้อความที่ผู้ใช้เห็น
const require = createRequire(import.meta.url);
const read = (file) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const flush = () => new Promise((resolve) => setImmediate(resolve));
const plain = (value) => JSON.parse(JSON.stringify(value));
// validate จริงของ modules/form-steps.js ใช้ใน stepper จำลอง (ตัวจริงต้องมี matchMedia/DOM)
require("../../modules/form-steps.js");
const realSteps = globalThis.MNP_FORM_STEPS;
const NOW = Date.parse("2026-11-19T05:00:00Z");

const persona = (id, no, first, last, dept, deptName, role = "staff") => ({ id, employee_no: no, first_name: first, last_name: last, job_title: "", department: { code: dept, name_th: deptName }, role: { code: role } });
const PEOPLE = {
  emp: persona("emp", "MK1", "สมชาย", "ใจดี", "MK", "การตลาด"),
  mgr: persona("mgr", "MK0", "สมหญิง", "ผู้จัดการ", "MK", "การตลาด", "department_manager"),
  itadm: persona("persona-it-admin", "SBX-IT-ADMIN", "ไอที", "ผู้ดูแล", "IT", "เทคโนโลยีสารสนเทศ"),
  itapp: persona("persona-it-approver", "SBX-IT-APPROVER", "รสริน", "เชน", "MGT", "ฝ่ายบริหาร"),
  other: persona("other", "HR1", "อื่น", "คนอื่น", "HR", "บุคคล"),
};

// ตัวควบคุมจำลอง: ผูก event ได้และอ่าน/เขียนค่าได้
function el(props = {}) {
  const listeners = {};
  const node = {
    dataset: {}, style: {}, hidden: false, disabled: false, value: "", checked: false, innerHTML: "", min: "", listeners,
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener(type, handler) { (listeners[type] ??= []).push(handler); },
    focus() {}, scrollIntoView() {}, dispatchEvent() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  // props อาจมี setter (outerHTML) จึงคัดลอกด้วย descriptor ไม่ใช่ spread
  return Object.defineProperties(node, Object.getOwnPropertyDescriptors(props));
}

function world({ as = "emp", draft = null } = {}) {
  const mock = createItwoMock({
    stamp: () => new Date(NOW + (calls.clock += 60000)).toISOString(), now: () => NOW,
    persona: () => PEOPLE[current], personas: () => Object.values(PEOPLE),
  });
  let current = as;
  let painted = "";
  let paintedTitle = null;
  let currentParams = new URLSearchParams("");
  const calls = { clock: 0, rpc: [], toasts: [], confirms: [], prompts: [], notFound: 0, loading: 0, busy: [], logged: [], draftCleared: 0, autosaveStopped: 0, offered: null, renderRoutes: 0 };
  const rpcFail = new Map(); // ชื่อ RPC → error ที่จะโยนในการเรียกครั้งถัดไป
  const answers = { confirm: true, prompt: "เหตุผลทดสอบ" };
  const elements = {};
  const form = makeForm();

  const context = vm.createContext({});
  const app = { set innerHTML(value) { painted = value; }, get innerHTML() { return painted; } };
  const documentStub = {
    querySelector(selector) {
      if (selector === "#itwo-form") return painted.includes('id="itwo-form"') ? form : null;
      const id = /^#([\w-]+)$/.exec(selector)?.[1];
      if (id && painted.includes(`id="${id}"`)) return (elements[selector] ??= el());
      // ส่วน "สำหรับแผนก IT" ถูกวาดใหม่เฉพาะส่วนด้วย outerHTML: แทนที่ section ใน HTML ที่วาดไว้ และทิ้งตัวควบคุมเก่าของส่วนนั้น
      if (selector === ".itwo-access" && painted.includes('class="card itwo-access"')) {
        return (elements[selector] ??= el({
          set outerHTML(html) {
            painted = painted.replace(/<section class="card itwo-access"[\s\S]*?<\/section>/, () => html);
            for (const key of Object.keys(elements)) if (/itwo-access|data-access/.test(key)) delete elements[key];
          },
        }));
      }
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
    escapeHtml, formatDate: (value) => `D(${value})`, location: { hash: "" }, app,
    state: { employee: { id: "me" }, sandbox: null },
    sb: {
      async rpc(name, args) {
        calls.rpc.push({ name, args: plain(args ?? {}) });
        if (rpcFail.has(name)) { const error = rpcFail.get(name); rpcFail.delete(name); return { data: null, error }; }
        try { return { data: plain(mock.handlers[name](args ?? {})), error: null }; } catch (error) { return { data: null, error }; }
      },
    },
    // วาดหน้าใหม่ = ตัวควบคุมของหน้าเก่าหายไป (ตัวควบคุมใหม่ถูกสร้างเมื่อโมดูลค้นหา) ไม่งั้น handler ของหน้าเก่าจะสะสม
    shell: (html, path, title, tabTitle) => { paintedTitle = { path, title, tabTitle }; for (const key of Object.keys(elements)) delete elements[key]; return html; },
    bindShell() {}, loadingShell() { calls.loading += 1; }, renderNotFound() { calls.notFound += 1; },
    showToast: (message, kind = "info") => calls.toasts.push({ message, kind }),
    friendlyError: (error) => `friendly:${error?.message}`,
    confirmDialog: async (options) => { calls.confirms.push(options); return answers.confirm; },
    textPromptDialog: async (options) => { calls.prompts.push(options); return answers.prompt; },
    setFormBusy: (target, busy) => calls.busy.push(busy), setButtonBusy: (button, busy) => calls.busy.push(busy),
    renderRoute: async () => { calls.renderRoutes += 1; await context.window.MNP_ITWO.render(currentParams); },
    bindFormCancel() {}, focusFirstStep() {},
  });
  context.window.MNP_ERROR_LOG = { report: (error) => calls.logged.push(error) };
  context.window.MNP_DATE_PICKER = { enhance() {} };
  context.window.MNP_FORM_STEPS = {
    clearFieldError() {}, clearFieldErrors() {}, showFieldErrors() {},
    // stepper จำลอง: ตรวจด้วย validate จริง (modules/form-steps.js) เหมือนปุ่มส่งของหน้า
    bindStepper: ({ rules, values }) => ({ check: () => { form.lastErrors = realSteps.validate(rules, values()); return form.lastErrors.length === 0; } }),
  };
  context.window.MNP_FORM_DRAFT = {
    draftKey: (code, id) => `${code}:${id}`,
    isEmptyDraft: (values, ignore = []) => Object.entries(values).every(([key, value]) => ignore.includes(key) || !value),
    createDraftStore: () => ({ load: () => draft, clear: () => { calls.draftCleared += 1; } }),
    createAutosave: () => ({ schedule() {}, start() {}, stop() { calls.autosaveStopped += 1; } }),
    offerDraft: (options) => { calls.offered = options; },
  };
  for (const file of ["modules/itwo-model.js", "modules/itwo-pages.js", "modules/module-itwo.js"]) vm.runInContext(read(file), context);

  function makeForm() {
    const radios = { request_type: ["design", "system_access", "misc"].map((value) => el({ value })), attachment_flag: ["yes", "no", "other"].map((value) => el({ value, checked: value === "no" })) };
    const controls = { "#itwo-order-ref": el(), "#itwo-details": el(), "#itwo-urgent": el(), "#itwo-attachment-note": el(), "#itwo-attachment-note-field": el(), "#itwo-needed-date": el(), "[data-step-submit]": el(), "#itwo-review": el() };
    const node = el({
      controls, radios, lastErrors: [],
      querySelector(selector) {
        const checked = /^\[name="(\w+)"\]:checked$/.exec(selector)?.[1];
        if (checked) return radios[checked].find((radio) => radio.checked) ?? null;
        return controls[selector] ?? null;
      },
      querySelectorAll(selector) {
        const name = /^\[name="(\w+)"\]$/.exec(selector)?.[1];
        return name ? radios[name] : [];
      },
    });
    return node;
  }

  const api = {
    calls, mock, context, form, rpcFail, answers, elements,
    as(key) { current = key; },
    get html() { return painted; },
    get title() { return paintedTitle; },
    get hash() { return context.location.hash; },
    async open(query = "") {
      currentParams = new URLSearchParams(query);
      await context.window.MNP_ITWO.render(currentParams);
      await flush();
    },
    names: () => calls.rpc.map((call) => call.name),
    // กดปุ่มการกระทำบนหน้ารายละเอียด (ผูก handler ไว้ตอนวาดหน้า)
    async click(action) {
      const button = documentStub.querySelectorAll("[data-itwo-action]").find((item) => item.dataset.itwoAction === action);
      assert.ok(button, `button ${action} is on the page`);
      await button.listeners.click[0]();
      await flush();
    },
    buttons: () => documentStub.querySelectorAll("[data-itwo-action]").map((button) => button.dataset.itwoAction),
    async create(overrides = {}) {
      current = "emp";
      const values = { request_type: "design", details: "ออกแบบกล่อง", needed_date: "2026-11-25", ...overrides };
      const created = await context.sb.rpc("app_itwo_create", { p_request_type: values.request_type, p_order_ref: null, p_attachment_flag: "no", p_attachment_note: null, p_details: values.details, p_needed_date: values.needed_date, p_is_urgent: Boolean(values.is_urgent) });
      calls.rpc.length = 0;
      return created.data[0];
    },
    // กรอกฟอร์มแจ้งงานแล้วกดส่ง (คืนจำนวนครั้งที่ submit handler รับ)
    fill(values) {
      for (const radio of form.radios.request_type) radio.checked = radio.value === values.request_type;
      for (const radio of form.radios.attachment_flag) radio.checked = radio.value === (values.attachment_flag ?? "no");
      form.controls["#itwo-order-ref"].value = values.order_ref ?? "";
      form.controls["#itwo-details"].value = values.details ?? "";
      form.controls["#itwo-attachment-note"].value = values.attachment_note ?? "";
      form.controls["#itwo-needed-date"].value = values.needed_date ?? "";
      form.controls["#itwo-urgent"].checked = Boolean(values.is_urgent);
    },
    submit: () => form.listeners.submit[0]({ preventDefault() {} }),
  };
  return api;
}


/* ---------- ตัวเลขบนการ์ด ---------- */
test("the card count adds up what waits for me; a count that cannot be read is skipped without failing the card", async () => {
  const w = world({ as: "mgr" });
  const order = await w.create();
  w.as("mgr");
  const summary = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(summary.badge, "1 รอคุณ");
  assert.match(summary.title, /รออนุมัติ 1/);
  assert.ok(w.names().includes("app_itwo_pending_count"));
  assert.ok(!w.names().includes("app_itwo_list_it"), "a department manager is not on the IT team, so the IT list is not even asked for");
  assert.ok(order.id);

  w.rpcFail.set("app_itwo_pending_count", Object.assign(new Error("Failed to fetch"), { code: "" }));
  const partial = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(partial.badge, "", "the approvals count failed, nothing else is waiting: no badge, but no exception");
});

test("the requester's card counts work waiting for their confirmation; when my_role cannot be read the card has no count", async () => {
  const w = world();
  const order = await w.create({ is_urgent: true });
  w.as("itadm");
  await w.context.sb.rpc("app_itwo_start", { p_work_order_id: order.id });
  w.as("emp");
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).badge, "", "nothing to confirm yet");
  w.rpcFail.set("app_itwo_my_role", Object.assign(new Error("Failed to fetch"), { code: "" }));
  assert.equal(await w.context.window.MNP_ITWO.loadCardSummary(), null);
});

/* ---------- แท็บตามบทบาท ---------- */
test("an employee sees only 'ใบของฉัน' with the new-order button, and no IT, approvals or settings call is made", async () => {
  const w = world();
  await w.open("");
  assert.deepEqual(w.names(), ["app_itwo_my_role", "app_itwo_list_mine"]);
  assert.doesNotMatch(w.html, /view-tabs/);
  assert.match(w.html, /แจ้งงานใหม่/);
  assert.match(w.html, /ยังไม่มีใบสั่งงานที่คุณแจ้ง/);
  assert.deepEqual(w.title && w.title.path, "office");
});

test("a department manager gets an approvals tab with its count; the IT admin gets IT work and settings", async () => {
  const w = world();
  await w.create();
  w.as("mgr");
  await w.open("");
  assert.match(w.html, /view-tabs/);
  assert.match(w.html, /รออนุมัติ <span class="itwo-tab-count"[^>]*>1<\/span>/);
  assert.doesNotMatch(w.html, />ตั้งค่า</);
  await w.open("view=approvals");
  assert.match(w.html, /รอคุณอนุมัติขั้นผู้จัดการแผนก/);
  assert.match(w.html, /สมชาย ใจดี · การตลาด/);

  w.as("itadm");
  await w.open("");
  assert.deepEqual([...w.html.matchAll(/class="view-tab[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1].trim()), ["ใบของฉัน", "งาน IT", "ตั้งค่า"]);
  await w.open("view=settings");
  assert.match(w.html, /id="itwo-counter-form"/);
  assert.match(w.html, /TEST-IT06-26\/002|เลขที่เอกสารถัดไป/);
});

test("a tab I may not see sends me back to 'ใบของฉัน' before any list is read", async () => {
  const w = world();
  for (const view of ["approvals", "it", "settings"]) {
    w.calls.rpc.length = 0;
    w.context.location.hash = "";
    await w.open(`view=${view}`);
    assert.equal(w.hash, "#/office?module=work-order", view);
    assert.deepEqual(w.names(), ["app_itwo_my_role"], `${view}: only the role was read`);
  }
  w.calls.notFound = 0;
  await w.open("view=nope");
  assert.equal(w.calls.notFound, 1);
});

test("the IT list groups work by status with urgent work first and shows the approval progress", async () => {
  const w = world();
  const normal = await w.create({ details: "งานปกติ" });
  const urgent = await w.create({ details: "งานด่วน", is_urgent: true });
  w.as("itadm");
  await w.open("view=it");
  const toStart = w.html.slice(w.html.indexOf('data-group="to_start"'), w.html.indexOf('data-group="awaiting_approval"'));
  assert.match(toStart, /งานด่วน/);
  assert.doesNotMatch(toStart, /งานปกติ/, "work still waiting for approval is not 'ready to start' unless urgent");
  assert.match(w.html.slice(w.html.indexOf('data-group="awaiting_approval"')), /งานปกติ/);
  assert.ok(normal.id && urgent.id);
});

/* ---------- เส้นทางจริงตั้งแต่แจ้งถึงรับงาน ผ่านปุ่มบนหน้ารายละเอียด ---------- */
test("a whole order walks from filing to 'received' through the buttons the detail page offers at each step", async () => {
  const w = world();
  const order = await w.create({ details: "ขอสิทธิ์ I-Prime", request_type: "system_access" });
  const detailQuery = `view=order&id=${order.id}`;

  // ผู้แจ้ง: ยกเลิกได้เท่านั้น
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["cancel"]);
  assert.match(w.html, /<h1>TEST-IT06-26\/001<\/h1>/);
  assert.match(w.html, /itwo-test-tag/);
  assert.equal(w.title.tabTitle, "TEST-IT06-26/001", "the tab title is the document number (default file name when saving as PDF)");

  // ผู้จัดการแผนก: อนุมัติ / ไม่อนุมัติ
  w.as("mgr");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["approve", "reject"]);
  await w.click("approve");
  assert.equal(w.calls.confirms.length, 1, "approving asks for confirmation");
  assert.match(w.calls.confirms[0].title, /อนุมัติใบสั่งงานนี้/);
  assert.equal(w.calls.confirms[0].danger, false);
  assert.deepEqual(w.calls.rpc.filter((call) => call.name === "app_itwo_approve").map((call) => call.args), [{ p_work_order_id: order.id }]);
  assert.deepEqual(w.calls.toasts.at(-1), { message: "อนุมัติแล้ว", kind: "info" });
  assert.deepEqual(w.buttons(), [], "after approving, the same person has nothing more to do");
  assert.match(w.html, /ผู้จัดการแผนกอนุมัติ/);

  // ผู้อนุมัติขั้น IT
  w.as("itapp");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["approve", "reject"]);
  await w.click("approve");

  // IT ผู้ดูแลงาน: เริ่ม → ส่วนสิทธิ์แก้ได้ → ปิดงาน
  w.as("itadm");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["start"]);
  assert.match(w.html, /id="itwo-access-edit"/, "edit_access shows the edit button of the IT section");
  await w.click("start");
  assert.deepEqual(w.buttons(), ["complete"]);
  await w.click("complete");
  assert.match(w.calls.confirms.at(-1).message, /แก้ส่วนสำหรับแผนก IT ไม่ได้/);
  assert.doesNotMatch(w.html, /itwo-access-edit/, "closed: the IT section is read-only");

  // ผู้แจ้ง: ยืนยันรับงาน (ยกเลิกไม่ได้แล้ว)
  w.as("emp");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["receive"]);
  await w.click("receive");
  assert.deepEqual(w.buttons(), []);
  assert.match(w.html, /ได้รับงานแล้ว/);
  const timeline = [...w.html.matchAll(/<strong>([^<]+)<\/strong><p class="timeline-item-detail">โดย ([^<]+)<\/p>/g)].map((match) => `${match[1]} / ${match[2]}`);
  assert.deepEqual(timeline, [
    "แจ้งงาน / สมชาย ใจดี", "ผู้จัดการแผนกอนุมัติ / สมหญิง ผู้จัดการ", "ผู้อนุมัติขั้น IT อนุมัติ / รสริน เชน",
    "IT เริ่มดำเนินการ / ไอที ผู้ดูแล", "IT ปิดงาน / ไอที ผู้ดูแล", "ผู้แจ้งยืนยันรับงาน / สมชาย ใจดี",
  ]);
  assert.match(w.html, /\d{2}\/\d{2}\/2569 \d{2}:\d{2}/, "Thai dates and Bangkok time");
});

test("rejecting and cancelling ask for a reason in the same dialog, send it, and stop when the dialog is dismissed", async () => {
  const w = world();
  const order = await w.create();
  const query = `view=order&id=${order.id}`;
  w.as("mgr");
  await w.open(query);

  w.answers.prompt = null; // ผู้ใช้กดยกเลิกกล่อง
  await w.click("reject");
  assert.equal(w.calls.prompts.length, 1);
  assert.ok(!w.names().includes("app_itwo_reject"), "no call when the dialog is dismissed");
  assert.equal(w.calls.prompts[0].minLength, 1);
  assert.equal(w.calls.prompts[0].maxLength, 500);
  assert.equal(w.calls.prompts[0].danger, true);
  assert.match(w.calls.prompts[0].label, /เหตุผล/);

  w.answers.prompt = "งบไม่พอ";
  await w.click("reject");
  assert.deepEqual(w.calls.rpc.filter((call) => call.name === "app_itwo_reject").map((call) => call.args), [{ p_work_order_id: order.id, p_reason: "งบไม่พอ" }]);
  assert.match(w.html, /ไม่อนุมัติ/);
  assert.match(w.html, /งบไม่พอ/, "the reason is on the timeline");
  assert.deepEqual(w.buttons(), []);

  const second = await w.create({ details: "ใบที่สอง" });
  await w.open(`view=order&id=${second.id}`);
  await w.click("cancel");
  assert.deepEqual(w.calls.rpc.filter((call) => call.name === "app_itwo_cancel").map((call) => call.args), [{ p_work_order_id: second.id, p_reason: "งบไม่พอ" }]);
  assert.match(w.html, /ผู้แจ้งยกเลิก/);
});

test("a dismissed confirm dialog calls nothing, and a refused RPC shows the database's Thai message then reloads the order", async () => {
  const w = world();
  const order = await w.create();
  w.as("mgr");
  await w.open(`view=order&id=${order.id}`);
  w.answers.confirm = false;
  await w.click("approve");
  assert.ok(!w.names().includes("app_itwo_approve"));

  w.answers.confirm = true;
  w.rpcFail.set("app_itwo_approve", Object.assign(new Error("คุณไม่มีสิทธิ์อนุมัติใบสั่งงานนี้ในขั้นนี้"), { code: "42501" }));
  const reloads = w.calls.renderRoutes;
  await w.click("approve");
  assert.deepEqual(w.calls.toasts.at(-1), { message: "คุณไม่มีสิทธิ์อนุมัติใบสั่งงานนี้ในขั้นนี้", kind: "error" });
  assert.equal(w.calls.renderRoutes, reloads + 1, "the order is reloaded so the buttons match the real status");

  w.rpcFail.set("app_itwo_approve", Object.assign(new Error("Failed to fetch"), { code: "" }));
  await w.click("approve");
  assert.equal(w.calls.toasts.at(-1).message, "ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ (ระบบอาจบันทึกไปแล้ว)");
  assert.equal(w.calls.logged.length, 1, "the technical error went to the log, not to the user");
});

/* ---------- รายละเอียด: ลิงก์ตรงและสิทธิ์ ---------- */
test("a direct link to an order works for people who may see it, and refuses everyone else with the database's message", async () => {
  const w = world();
  const order = await w.create();
  const query = `view=order&id=${order.id}`;
  w.as("other");
  await w.open(query);
  assert.match(w.html, /ไม่พบใบสั่งงานนี้หรือคุณไม่มีสิทธิ์ดูใบนี้/);
  assert.doesNotMatch(w.html, /itwo-retry/, "a refusal is not a network problem: no retry button");
  assert.doesNotMatch(w.html, new RegExp(order.id), "nothing about the order leaks");

  w.as("itapp");
  await w.open(query);
  assert.match(w.html, /<h1>TEST-IT06-26\/001<\/h1>/, "IT sees every order");

  w.calls.notFound = 0;
  await w.open("view=order&id=not-a-uuid");
  assert.equal(w.calls.notFound, 1);
  await w.open("view=print");
  assert.equal(w.calls.notFound, 2);
});

test("the print page shows the sheet for the order and has the print button wired", async () => {
  const w = world();
  const order = await w.create();
  w.context.window.print = () => { w.printed = (w.printed ?? 0) + 1; };
  await w.open(`view=print&id=${order.id}`);
  assert.match(w.html, /class="itwo-sheet is-test"/);
  assert.match(w.html, /ใบสั่งงานแผนก IT/);
  w.elements["#itwo-print-button"].listeners.click[0]();
  assert.equal(w.printed, 1);
  assert.equal(w.title.tabTitle, "TEST-IT06-26/001");
});

/* ---------- error ของหน้า ---------- */
test("a lost connection while loading shows the Thai message with a retry; an expired session says to sign in again", async () => {
  const w = world();
  w.rpcFail.set("app_itwo_my_role", Object.assign(new Error("Failed to fetch"), { code: "" }));
  await w.open("");
  assert.match(w.html, /โหลดข้อมูลไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่/);
  assert.match(w.html, /id="itwo-retry"/);
  const before = w.calls.renderRoutes;
  w.elements["#itwo-retry"].listeners.click[0]();
  assert.equal(w.calls.renderRoutes, before + 1);

  w.rpcFail.set("app_itwo_my_role", Object.assign(new Error("JWT expired"), { code: "PGRST301" }));
  await w.open("");
  assert.match(w.html, /หมดเวลาการเข้าสู่ระบบ/);
  assert.doesNotMatch(w.html, /JWT/);

  w.rpcFail.set("app_itwo_my_role", Object.assign(new Error("Could not find the function public.app_itwo_my_role"), { code: "PGRST202" }));
  await w.open("");
  assert.match(w.html, /ฐานข้อมูลยังไม่ได้อัปเดต/);
});

test("a slow page does not repaint over the page opened after it", async () => {
  const w = world();
  let release;
  const real = w.context.sb.rpc;
  w.context.sb.rpc = (name, args) => (name === "app_itwo_list_mine" && !release ? new Promise((resolve) => { release = () => resolve(real(name, args)); }) : real(name, args));
  const slow = w.open("");
  await flush();
  await w.open("view=new");
  const form = w.html;
  assert.match(form, /id="itwo-form"/);
  release();
  await slow;
  await flush();
  assert.equal(w.html, form);
});

/* ---------- ฟอร์มแจ้งงานใหม่ ---------- */
test("the new-order page is the FM06 form with the requester filled in by the system, and today as the earliest date", async () => {
  const w = world();
  await w.open("view=new");
  assert.match(w.html, /ผู้แจ้ง สมชาย ใจดี · การตลาด/);
  assert.match(w.html, /3–7 วันนับจากวันที่ได้ข้อมูลครบ/);
  assert.equal(w.form.controls["#itwo-needed-date"].min, w.context.window.MNP_ITWO_MODEL.todayBangkok());
  assert.match(w.html, /แจ้งงานใหม่/);
  assert.equal(w.calls.offered, null, "no saved draft, no banner");
});

test("an incomplete form is not sent; each missing field is reported in Thai", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ details: "", needed_date: "" });
  await w.submit();
  assert.deepEqual(w.names().filter((name) => name === "app_itwo_create"), []);
  assert.deepEqual(w.form.lastErrors.map((error) => error.message), ["กรุณาเลือกประเภทคำขอ", "กรุณากรอกรายละเอียดงาน", "กรุณาเลือกวันที่ต้องการงาน"]);
  w.fill({ request_type: "design", attachment_flag: "other", attachment_note: "", details: "ทำกล่อง", needed_date: "2026-11-18" });
  await w.submit();
  assert.deepEqual(w.form.lastErrors.map((error) => error.message), ["กรุณาระบุเอกสารแนบ (เมื่อเลือก \"อื่นๆ\")", "วันที่ต้องการงานต้องเป็นวันนี้หรือหลังจากนี้"]);
  assert.ok(!w.names().includes("app_itwo_create"));
});

test("a good form is sent once with only the fields the user filled; success clears the draft and opens the order", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "system_access", order_ref: " SO-7 ", attachment_flag: "no", attachment_note: "ไม่ส่ง", details: " ขอสิทธิ์ ", needed_date: "2026-11-25", is_urgent: true });
  await Promise.all([w.submit(), w.submit()]); // กดซ้ำทันที
  await flush();
  const created = w.calls.rpc.filter((call) => call.name === "app_itwo_create");
  assert.equal(created.length, 1, "a double click sends one order");
  assert.deepEqual(created[0].args, { p_request_type: "system_access", p_order_ref: "SO-7", p_attachment_flag: "no", p_attachment_note: null, p_details: "ขอสิทธิ์", p_needed_date: "2026-11-25", p_is_urgent: true });
  assert.equal(w.calls.draftCleared, 1);
  assert.equal(w.calls.autosaveStopped >= 1, true);
  assert.deepEqual(w.calls.toasts.at(-1), { message: "แจ้งงานแล้ว · เลขที่ TEST-IT06-26/001", kind: "info" });
  assert.match(w.hash, /^#\/office\?module=work-order&view=order&id=[0-9a-f-]{36}$/);
});

test("a failed send keeps everything: a database refusal shows its Thai message, a lost connection says the result is uncertain and links to 'ใบของฉัน'", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", details: "ทำกล่อง", needed_date: "2026-11-25" });
  w.rpcFail.set("app_itwo_create", Object.assign(new Error("กรุณากรอกรายละเอียดงาน"), { code: "23514" }));
  await w.submit();
  assert.match(w.elements["#itwo-message"].innerHTML, /กรุณากรอกรายละเอียดงาน/);
  assert.doesNotMatch(w.elements["#itwo-message"].innerHTML, /href=/);
  assert.equal(w.calls.draftCleared, 0, "the draft stays");
  assert.deepEqual(w.calls.busy.slice(-1), [false], "the form is usable again");

  w.rpcFail.set("app_itwo_create", Object.assign(new Error("Failed to fetch"), { code: "" }));
  await w.submit();
  assert.match(w.elements["#itwo-message"].innerHTML, /ผลไม่แน่ชัด กรุณาตรวจรายการก่อนกดซ้ำ/);
  assert.match(w.elements["#itwo-message"].innerHTML, /href="#\/office\?module=work-order">ตรวจที่ใบของฉัน</);
  assert.equal(w.calls.draftCleared, 0);
  assert.equal(w.hash, "", "no navigation");
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_create").length, 2);
});

test("a saved draft is offered, not applied silently, and the draft key belongs to the signed-in person", async () => {
  const w = world({ draft: { savedAt: Date.parse("2026-11-18T10:00:00Z"), values: { request_type: "misc", details: "ร่างเก่า" } } });
  await w.open("view=new");
  assert.ok(w.calls.offered, "the draft banner is offered");
  assert.match(w.calls.offered.message, /มีร่างใบสั่งงานค้างจาก D\(/);
  assert.equal(w.form.controls["#itwo-details"].value, "", "nothing is filled in until the user chooses");
  w.calls.offered.onUse();
  assert.equal(w.form.controls["#itwo-details"].value, "ร่างเก่า");
  assert.equal(w.form.radios.request_type.find((radio) => radio.checked).value, "misc");
  assert.equal(w.form.radios.attachment_flag.find((radio) => radio.checked).value, "no", "'ไม่มี' stays the default for a draft without it");
});

/* ---------- ส่วนสำหรับแผนก IT ---------- */
test("the IT admin edits the access rows and they are saved as a clean payload; half-filled rows stay on the page with the problem", async () => {
  const w = world();
  const order = await w.create({ is_urgent: true });
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  w.elements["#itwo-access-edit"].listeners.click[0]();
  assert.match(w.html, /id="itwo-access-form"/);
  assert.equal((w.html.match(/data-access-row="/g) ?? []).length, 1, "one blank row to start");

  // ค่าที่ผู้ใช้กรอกในแถวเดียว (ตัวแทนของ document.querySelectorAll("[data-access-row]")) · ยังไม่เลือกการดำเนินการ = ข้อผิดพลาดของแถว
  const rowFields = { system: "i_prime", action: "", newUsername: "user1", oldUsername: "", note: "" };
  w.context.document.querySelectorAll = ((original) => (selector) => {
    if (selector === "[data-access-row]") return [el({ querySelector: (inner) => ({ value: rowFields[/data-access-field="(\w+)"/.exec(inner)[1]] }) })];
    return original(selector);
  })(w.context.document.querySelectorAll);
  const form = w.elements["#itwo-access-form"];
  await form.listeners.submit[0]({ preventDefault() {} });
  assert.ok(!w.names().includes("app_itwo_save_access_changes"));
  assert.match(w.html, /กรุณาเลือกการดำเนินการ/);
  assert.match(w.html, /value="user1"/, "what the user typed stays on the page");

  rowFields.action = "add";
  await w.elements["#itwo-access-form"].listeners.submit[0]({ preventDefault() {} });
  await flush();
  const saved = w.calls.rpc.find((call) => call.name === "app_itwo_save_access_changes");
  assert.deepEqual(saved.args, { p_work_order_id: order.id, p_changes: [{ system: "i_prime", action: "add", new_username: "user1", old_username: null, note: null }] });
  assert.deepEqual(w.calls.toasts.at(-1), { message: "บันทึกส่วนสำหรับแผนก IT แล้ว", kind: "info" });
});

/* ---------- ตั้งค่าและการล้างข้อมูลทดสอบ ---------- */
test("settings: the next document number is confirmed with the number it will produce, and can only go forward", async () => {
  const w = world();
  w.as("itadm");
  await w.open("view=settings");
  assert.match(w.html, /TEST-IT06-26\/001/);
  // กรอกเลขถัดไปในฟอร์มของหน้าที่วาดอยู่ตอนนี้ แล้วกดบันทึก
  const setNext = async (value) => {
    const counterForm = w.elements["#itwo-counter-form"];
    counterForm.querySelector = () => el({ value });
    await counterForm.listeners.submit[0]({ preventDefault() {} });
    await flush();
  };
  await setNext("101");
  assert.match(w.calls.confirms.at(-1).title, /TEST-IT06-26\/101/);
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_set_next_doc_seq").args, { p_next: 101, p_year: 2026 });
  assert.match(w.html, /TEST-IT06-26\/101/, "the page reloads with the new next number");

  w.calls.confirms.length = 0;
  await setNext("50");
  assert.equal(w.calls.confirms.length, 0, "a backwards number is stopped before any dialog");
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_set_next_doc_seq").length, 1);
});

test("the purge button is only on the lists, only in test mode, and asks first", async () => {
  const w = world();
  await w.open("");
  assert.doesNotMatch(w.html, /itwo-purge/);
  w.context.state.sandbox = { active: true };
  await w.open("");
  assert.match(w.html, /id="itwo-purge"/);
  w.elements["#itwo-purge"].listeners.click[0]({ currentTarget: el() });
  await flush();
  assert.equal(w.calls.confirms.at(-1).danger, true);
  assert.ok(w.names().includes("app_sandbox_purge_itwo"));
});

/* ---------- ความเรียบร้อยของไฟล์ ---------- */
test("the module never decides rights or document numbers itself, and keeps no secret", () => {
  const source = read("modules/module-itwo.js");
  assert.doesNotMatch(source, /\.from\(\s*["']itwo_/, "all access goes through RPC, never a table");
  assert.doesNotMatch(source, /\bdoc_no\s*[:=]|doc_seq\s*[:=]|nextval/, "document numbers are the database's");
  assert.doesNotMatch(source, /service_role|sb_secret|SUPABASE_SERVICE/i);
  const mock = createItwoMock({ stamp: () => "", now: () => NOW, persona: () => PEOPLE.emp, personas: () => [] });
  const called = [...source.matchAll(/rpc\("(app_[a-z_]+)"/g)].map((match) => match[1]);
  for (const name of new Set(called)) assert.equal(typeof mock.handlers[name], "function", `${name} exists in the mock (and the migration)`);
  assert.match(read("supabase/migrations/20261203010000_itwo_work_orders.sql"), /create or replace function public\.app_itwo_my_role\(/);
  for (const name of new Set(called)) assert.ok(read("supabase/migrations/20261203010000_itwo_work_orders.sql").includes(`function public.${name}(`), `${name} is in the migration`);
});
