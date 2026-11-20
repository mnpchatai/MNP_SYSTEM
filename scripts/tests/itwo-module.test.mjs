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
const visibleText = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
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
  // Storage จำลอง: เก็บไฟล์ที่อัปโหลด (คีย์ "<bucket>/<path>") ให้ฐานข้อมูลจำลองตรวจว่าไฟล์อยู่จริงตอนลงทะเบียน · fail.upload/fail.remove ใส่ฟังก์ชันเพื่อจำลองเน็ตหลุด
  const objects = new Map();
  const fail = { upload: null, remove: null, removeShort: 0 };
  const clock = { offset: 0 }; // เลื่อน "เวลาปัจจุบัน" ของฐานข้อมูลจำลอง (ทดสอบหมดเวลาแนบไฟล์ 30 นาที)
  const mock = createItwoMock({
    stamp: () => new Date(NOW + (calls.clock += 60000)).toISOString(), now: () => NOW + clock.offset,
    persona: () => PEOPLE[current], personas: () => Object.values(PEOPLE),
    hasObject: (bucket, path) => objects.has(`${bucket}/${path}`),
    // Storage จริงจด mimetype จาก file.type ของไฟล์ที่ส่งขึ้น (supabase-js ไม่ใช้ options.contentType เมื่อส่ง File/Blob) ฐานข้อมูลอ่านชนิดจากค่านี้
    objectMime: (bucket, path) => objects.get(`${bucket}/${path}`)?.type || null,
    listObjects: (bucket) => [...objects.keys()].filter((key) => key.startsWith(`${bucket}/`)).map((key) => key.slice(bucket.length + 1)),
  });
  let current = as;
  let painted = "";
  let paintedTitle = null;
  let currentParams = new URLSearchParams("");
  const calls = { clock: 0, rpc: [], toasts: [], confirms: [], prompts: [], notFound: 0, loading: 0, busy: [], logged: [], draftCleared: 0, autosaveStopped: 0, offered: null, renderRoutes: 0, uploads: [], removes: [], hydrated: [], fieldErrors: null, lightbox: [] };
  let uuidCounter = 0;
  const hosts = {}; // element ที่แผงอัปโหลดวาดทับ (#itwo-form-card / #itwo-rework-card): เก็บ HTML ล่าสุดที่ถูกเขียนลงไป
  const makers = { // ตัวควบคุมที่ต้องมีค่าเริ่มต้นไม่ใช่ el() เปล่า
    "#itwo-form-card": () => host("#itwo-form-card"),
    "#itwo-rework-card": () => host("#itwo-rework-card", { hidden: true }),
    "#itwo-ask-card": () => host("#itwo-ask-card", { hidden: true }),
    "#itwo-answer-card": () => host("#itwo-answer-card"),
  };
  function host(selector, props = {}) {
    return el({ ...props, get innerHTML() { return hosts[selector] ?? ""; }, set innerHTML(html) { hosts[selector] = html; } });
  }
  const visible = () => painted + Object.values(hosts).join("");
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
      if (id && visible().includes(`id="${id}"`)) return (elements[selector] ??= (makers[selector]?.() ?? el()));
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
    File, escapeHtml, formatDate: (value) => `D(${value})`, location: { hash: "" }, app,
    state: { employee: { id: "me" }, sandbox: null },
    crypto: { randomUUID: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++uuidCounter).padStart(12, "0")}` },
    // ของ app.js ที่หน้ารายละเอียดเรียกเพื่อเติมไฟล์แนบ (ขอ signed URL แล้วเติมตัวอย่าง): ที่นี่แค่จดว่าถูกเรียกด้วยอะไร
    hydrateAttachmentGallery: async (files, bucket) => { calls.hydrated.push({ files: plain(files), bucket }); },
    openAttachmentLightbox: (id) => calls.lightbox.push(id),
    sb: {
      storage: {
        from: (bucket) => ({
          async upload(path, file, options) {
            calls.uploads.push({ bucket, path, name: file.name, type: file.type, options: plain(options) });
            const error = fail.upload?.(path, file, bucket);
            if (error) return { data: null, error };
            // บัคเก็ตจริงรับเฉพาะชนิดที่กำหนด: ชนิดว่าง/ไม่อยู่ในรายการ = 415
            if (!Object.values(context.window.MNP_ITWO_MODEL.FILE_MIME_BY_EXTENSION).includes(file.type)) return { data: null, error: Object.assign(new Error(`mime type ${file.type} is not supported`), { statusCode: "415" }) };
            if (objects.has(`${bucket}/${path}`)) return { data: null, error: Object.assign(new Error("The resource already exists"), { statusCode: "409" }) };
            objects.set(`${bucket}/${path}`, file);
            return { data: { path }, error: null };
          },
          async remove(paths) {
            calls.removes.push({ bucket, paths: [...paths] });
            const error = fail.remove?.(paths);
            if (error) return { data: null, error };
            const removable = paths.slice(0, paths.length - Math.min(fail.removeShort, paths.length));
            for (const path of removable) objects.delete(`${bucket}/${path}`);
            return { data: removable.map((name) => ({ name })), error: null };
          },
        }),
      },
      async rpc(name, args) {
        calls.rpc.push({ name, args: plain(args ?? {}) });
        if (rpcFail.has(name)) { const error = rpcFail.get(name); rpcFail.delete(name); return { data: null, error }; }
        try { return { data: plain(mock.handlers[name](args ?? {})), error: null }; } catch (error) { return { data: null, error }; }
      },
    },
    // วาดหน้าใหม่ = ตัวควบคุมของหน้าเก่าหายไป (ตัวควบคุมใหม่ถูกสร้างเมื่อโมดูลค้นหา) ไม่งั้น handler ของหน้าเก่าจะสะสม
    shell: (html, path, title, tabTitle) => { paintedTitle = { path, title, tabTitle }; for (const key of Object.keys(elements)) delete elements[key]; for (const key of Object.keys(hosts)) delete hosts[key]; return html; },
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
    clearFieldError() {}, clearFieldErrors() { calls.fieldErrors = null; }, showFieldErrors: (target, errors) => { calls.fieldErrors = errors; }, validate: realSteps.validate,
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
    const radios = { request_type: ["design", "misc"].map((value) => el({ value })), attachment_flag: ["yes", "no", "other"].map((value) => el({ value, checked: value === "no" })) };
    const controls = { "#itwo-order-ref": el(), "#itwo-details": el(), "#itwo-urgent": el(), "#itwo-attachment-note": el(), "#itwo-attachment-note-field": el(), "#itwo-misc-detail": el(), "#itwo-misc-field": el({ hidden: true }), "#itwo-files": el({ files: [] }), "#itwo-files-field": el({ hidden: true }), "#itwo-needed-date": el(), "[data-step-submit]": el(), "#itwo-review": el() };
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
    calls, mock, context, form, rpcFail, answers, elements, objects, fail, clock, hosts,
    as(key) { current = key; },
    get html() { return painted; },
    // HTML ของหน้า + แผงที่วาดทับทีหลัง (ความคืบหน้าอัปโหลด)
    get screen() { return visible(); },
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
      const created = await context.sb.rpc("app_itwo_create", { p_request_type: values.request_type, p_order_ref: null, p_attachment_flag: values.attachment_flag ?? "no", p_attachment_note: null, p_details: values.details, p_needed_date: values.needed_date, p_is_urgent: Boolean(values.is_urgent) });
      calls.rpc.length = 0;
      return created.data[0];
    },
    // กรอกฟอร์มแจ้งงานแล้วกดส่ง (คืนจำนวนครั้งที่ submit handler รับ)
    fill(values) {
      for (const radio of form.radios.request_type) radio.checked = radio.value === values.request_type;
      for (const radio of form.radios.attachment_flag) radio.checked = radio.value === (values.attachment_flag ?? "no");
      form.controls["#itwo-misc-detail"].value = values.misc_detail ?? "";
      form.controls["#itwo-files"].files = values.files ?? [];
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

/* ---------- ตัวเลข "ยังไม่จบ" บนการ์ด (รุ่น 1.03) ---------- */
const FINISHED = ["received", "rejected", "cancelled"];
test("v1.03: the card's open count is the orders I can see that are not finished, by my role, counted once", async () => {
  const w = world();
  const open = () => w.context.window.MNP_ITWO.loadCardSummary().then((summary) => summary.openCount);
  assert.equal(await open(), 0, "nothing yet: a real zero, not 'unknown'");
  const first = await w.create({ details: "ใบที่หนึ่ง" });
  const second = await w.create({ details: "ใบที่สอง" });
  assert.equal(await open(), 2, "an employee counts own orders");
  // ผู้แจ้งยกเลิกแล้ว ไม่นับ
  await w.context.sb.rpc("app_itwo_cancel", { p_work_order_id: second.id, p_reason: "ไม่ใช้แล้ว" });
  assert.equal(await open(), 1);
  // คนอื่นไม่เห็นใบของ emp
  w.as("other");
  assert.equal(await open(), 0, "someone with no stake sees none");
  // ผู้จัดการแผนก: ใบของลูกน้องที่รอตัวเอง นับจากรายการรออนุมัติ
  w.as("mgr");
  w.calls.rpc.length = 0;
  const forManager = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(forManager.openCount, 1);
  assert.equal(forManager.badge, "1 รอคุณ", "the secondary badge is still there");
  assert.ok(w.names().includes("app_itwo_list_pending_approvals"));
  // ผู้อนุมัติขั้น IT: เห็นทุกใบในรายการงาน IT (นับจากรายการนั้น)
  w.as("itapp");
  const itList = (await w.context.sb.rpc("app_itwo_list_it")).data.filter((row) => !FINISHED.includes(row.status));
  assert.equal(await open(), new Set(itList.map((row) => row.id)).size);
  // ผู้ดูแลงาน IT: แจ้งใบของตัวเอง (อยู่ทั้งใบของฉันและงาน IT) นับครั้งเดียว
  w.as("itadm");
  const own = (await w.context.sb.rpc("app_itwo_create", { p_request_type: "design", p_order_ref: null, p_attachment_flag: "no", p_attachment_note: null, p_details: "ใบของ IT", p_needed_date: "2026-11-25", p_is_urgent: false })).data[0];
  const ids = new Set([...(await w.context.sb.rpc("app_itwo_list_mine")).data, ...(await w.context.sb.rpc("app_itwo_list_it")).data].filter((row) => !FINISHED.includes(row.status)).map((row) => row.id));
  assert.equal(await open(), ids.size);
  assert.ok(ids.has(own.id) && ids.has(first.id));
  // งานจบแล้ว (ผู้แจ้งยืนยันรับ) ไม่นับ
  const done = await closedOrder(w, { details: "ใบที่จะจบ" });
  w.as("itadm");
  const beforeReceive = await open();
  w.as("emp");
  await w.context.sb.rpc("app_itwo_receive", { p_work_order_id: done.id });
  w.as("itadm");
  assert.equal(await open(), beforeReceive - 1);
});

test("v1.03: when a list I am allowed to see cannot be read, the card has no open count (null: 'ดูสถานะ'), never a wrong number; the other badge still works", async () => {
  const w = world();
  await w.create({ details: "ใบของ IT" });
  w.as("itadm");
  for (const name of ["app_itwo_list_mine", "app_itwo_list_it"]) {
    w.rpcFail.set(name, Object.assign(new Error("Failed to fetch"), { code: "" }));
    const summary = await w.context.window.MNP_ITWO.loadCardSummary();
    assert.equal(summary.openCount, null, `${name} failed`);
    assert.equal(typeof summary.badge, "string");
  }
  w.as("mgr");
  w.rpcFail.set("app_itwo_list_pending_approvals", Object.assign(new Error("Failed to fetch"), { code: "" }));
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).openCount, null);
  // ไม่มีสิทธิ์ดูรายการนั้น: ไม่เรียก และไม่เป็นเหตุให้นับไม่ได้
  const plain = world();
  await plain.create();
  plain.calls.rpc.length = 0;
  assert.equal((await plain.context.window.MNP_ITWO.loadCardSummary()).openCount, 1);
  assert.ok(!plain.names().includes("app_itwo_list_it") && !plain.names().includes("app_itwo_list_pending_approvals"));
});

test("v1.03: test mode counts with the same app_itwo_* RPCs (the database scopes them to test orders), so only test orders are counted", async () => {
  const w = world();
  w.context.state.sandbox = { active: true };
  await w.create({ details: "ใบทดสอบ" });
  w.calls.rpc.length = 0;
  const summary = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(summary.openCount, 1);
  assert.ok(w.names().length > 0 && w.names().every((name) => /^app_itwo_/.test(name)), "only app_itwo_* RPCs: the is_test separation is enforced in the database");
});

/* ---------- แท็บตามบทบาท ---------- */
test("the 'ใบของฉัน' tab carries the number of orders waiting for my confirmation, on every tab, and an employee with only that tab sees the bar once something waits", async () => {
  const w = world();
  await w.open("");
  assert.doesNotMatch(w.html, /view-tabs/, "nothing waits: an employee has no tab bar");
  const order = await closedOrder(w);
  await w.open("");
  assert.match(w.html, /view-tabs[\s\S]*ใบของฉัน <span class="itwo-tab-count" aria-label="1 รายการ ที่รอคุณยืนยัน"/);
  assert.match(w.html, /IT ส่งงานแล้ว รอคุณยืนยัน/);
  // ผู้ใช้ที่มีหลายแท็บเห็นเลขเดียวกันจากแท็บอื่น (นับเฉพาะใบของตัวเอง)
  w.as("mgr");
  await w.open("");
  assert.doesNotMatch(w.html, /ใบของฉัน <span class="itwo-tab-count"/, "the manager has nothing of their own waiting");
  w.as("emp");
  await w.context.sb.rpc("app_itwo_receive", { p_work_order_id: order.id });
  await w.open("");
  assert.doesNotMatch(w.html, /view-tabs/, "after receiving, it is empty again");
});

test("another tab of a user who also has orders waiting shows the count on 'ใบของฉัน'", async () => {
  const w = world();
  // ผู้อนุมัติขั้น IT (มีหลายแท็บ) แจ้งงานเอง: อนุมัติครบทันที → IT เริ่ม/ปิด → กลับมาหาผู้แจ้งคือผู้อนุมัติเอง
  w.as("itapp");
  const created = await w.context.sb.rpc("app_itwo_create", { p_request_type: "design", p_order_ref: null, p_attachment_flag: "no", p_attachment_note: null, p_details: "งานของฉัน", p_needed_date: "2026-11-25", p_is_urgent: false });
  w.as("itadm");
  await w.context.sb.rpc("app_itwo_start", { p_work_order_id: created.data[0].id });
  await w.context.sb.rpc("app_itwo_complete", { p_work_order_id: created.data[0].id });
  w.as("itapp");
  await w.open("view=it");
  assert.match(w.html, /ใบของฉัน <span class="itwo-tab-count" aria-label="1 รายการ ที่รอคุณยืนยัน"/);
  assert.ok(w.names().includes("app_itwo_list_mine"), "the other tab asks for my own list only to count");
});

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
  const order = await w.create({ details: "ออกแบบกล่องใหม่" });
  const detailQuery = `view=order&id=${order.id}`;

  // ผู้แจ้ง: ยกเลิกได้เท่านั้น
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["cancel"]);
  assert.match(w.html, /<h1>TEST-IT06-26\/001<\/h1>/);
  assert.match(w.html, /itwo-test-tag/);
  assert.equal(w.title.tabTitle, "TEST-IT06-26/001", "the tab title is the document number (default file name when saving as PDF)");
  assert.doesNotMatch(w.html, /itwo-access|สิทธิ์ในระบบ/, "the IT access section is gone from the page");

  // ผู้จัดการแผนก: อนุมัติ / ไม่อนุมัติ
  w.as("mgr");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["approve", "reject", "request_info"], "the approver may also ask the requester");
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
  assert.deepEqual(w.buttons(), ["approve", "reject", "request_info"]);
  await w.click("approve");

  // IT ผู้ดูแลงาน: เริ่ม → ส่งงาน (ไม่มีส่วนสิทธิ์ให้แก้แล้ว)
  w.as("itadm");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["request_info", "start"]);
  assert.doesNotMatch(w.html, /itwo-access-edit/);
  await w.click("start");
  assert.deepEqual(w.buttons(), ["request_info", "complete"]);
  assert.match(w.html, /data-itwo-action="complete">ส่งงาน<\/button>/, "IT's button says 'ส่งงาน'");
  assert.doesNotMatch(w.html, /ปิดงาน/);
  await w.click("complete");
  assert.match(w.calls.confirms.at(-1).title, /ส่งงานใบสั่งงานนี้/);
  assert.match(w.calls.confirms.at(-1).confirmLabel, /ส่งงาน/);
  assert.match(w.calls.confirms.at(-1).message, /ส่งกลับให้ผู้แจ้งตรวจ/);
  // งานกลับไปหาผู้แจ้ง: บอกชื่อผู้แจ้ง และในโหมดทดสอบ (ผู้แจ้งเป็นบัญชีทดสอบอีกคน) บอกให้สลับบัญชีไปยืนยัน/ขอแก้ไข
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งกลับให้ สมชาย ใจดี ตรวจและยืนยันแล้ว · สลับเป็นบัญชีผู้แจ้งเพื่อยืนยันหรือขอแก้ไข", kind: "info" });

  // ผู้แจ้ง: ยืนยันรับงาน หรือขอแก้ไขงาน (ยกเลิกไม่ได้แล้ว)
  w.as("emp");
  await w.open(detailQuery);
  assert.deepEqual(w.buttons(), ["receive", "request_rework"]);
  await w.click("receive");
  assert.deepEqual(w.buttons(), []);
  assert.match(w.html, /จบงานแล้ว/);
  const timeline = [...w.html.matchAll(/<strong>([^<]+)<\/strong><p class="timeline-item-detail">โดย ([^<]+)<\/p>/g)].map((match) => `${match[1]} / ${match[2]}`);
  assert.deepEqual(timeline, [
    "แจ้งงาน / สมชาย ใจดี", "ผู้จัดการแผนกอนุมัติ / สมหญิง ผู้จัดการ", "ผู้อนุมัติขั้น IT อนุมัติ / รสริน เชน",
    "IT เริ่มดำเนินการ / ไอที ผู้ดูแล", "IT ส่งงาน / ไอที ผู้ดูแล", "ผู้แจ้งยืนยันรับงาน / สมชาย ใจดี",
  ]);
  assert.match(w.html, /\d{2}\/\d{2}\/2569 \d{2}:\d{2}/, "Thai dates and Bangkok time");
});

// พานำใบไปถึงสถานะ "IT ปิดงานแล้ว" (ผู้แจ้งเป็น emp) · งานด่วน IT เริ่มได้ก่อนอนุมัติครบ แต่ปิดงานต้องอนุมัติครบ จึงให้ผู้จัดการและผู้อนุมัติขั้น IT อนุมัติก่อน
async function closedOrder(w, overrides = {}) {
  const order = await w.create(overrides);
  w.as("mgr");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  w.as("itapp");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  w.as("itadm");
  await w.context.sb.rpc("app_itwo_start", { p_work_order_id: order.id });
  await w.context.sb.rpc("app_itwo_complete", { p_work_order_id: order.id });
  w.as("emp");
  w.calls.rpc.length = 0;
  return order;
}
// ไฟล์ที่เบราว์เซอร์ให้ช่องเลือกไฟล์: File จริง (หน้าเว็บห่อ File ใหม่ตอนอัปโหลด) · type = ชนิดที่เบราว์เซอร์เดา (ว่างได้) ไม่ตรงนามสกุลได้
const noFile = (name, size = 1000, type = "") => new File([new Uint8Array(size)], name, { type });

test("'แก้ไขงาน': the button opens the form, the rework is sent with its details and due date, the order goes back to IT, and IT closes it again before the requester receives it", async () => {
  const w = world();
  const order = await closedOrder(w);
  const query = `view=order&id=${order.id}`;
  await w.open(query);
  assert.deepEqual(w.buttons(), ["receive", "request_rework"]);
  const card = w.elements["#itwo-rework-card"];
  assert.equal(card.hidden, true, "the form starts hidden");
  await w.click("request_rework");
  assert.equal(card.hidden, false, "the button opens the form");
  assert.equal(w.names().includes("app_itwo_request_rework"), false, "pressing the button sends nothing yet");
  assert.equal(w.calls.confirms.length, 0, "no confirm dialog: the form is the confirmation");

  // กรอกไม่ครบ/วันที่ย้อนหลัง = ไม่ส่ง และบอกที่ช่อง
  const submit = () => w.elements["#itwo-rework-form"].listeners.submit[0]({ preventDefault() {} });
  await submit();
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.message), ["กรุณากรอกรายละเอียดที่ต้องการให้แก้ไข", "กรุณาเลือกวันที่ต้องการให้แก้ไขเสร็จ"]);
  w.elements["#itwo-rework-details"].value = "สีโลโก้ไม่ตรง";
  w.elements["#itwo-rework-due"].value = "2026-11-18";
  await submit();
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.message), ["วันที่ต้องการให้แก้ไขเสร็จต้องเป็นวันนี้หรือหลังจากนี้"]);
  assert.equal(w.names().includes("app_itwo_request_rework"), false);

  w.elements["#itwo-rework-due"].value = "2026-12-05";
  w.answers.confirm = false;
  await submit();
  assert.equal(w.calls.confirms.at(-1).title, "ส่งใบกลับให้ IT แก้ไขงาน?");
  assert.equal(w.names().includes("app_itwo_request_rework"), false, "dismissing the confirm sends nothing");
  w.answers.confirm = true;
  await submit();
  await flush();
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_request_rework").args, { p_work_order_id: order.id, p_details: "สีโลโก้ไม่ตรง", p_due_date: "2026-12-05" });
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ 1", kind: "info" });
  assert.equal(w.calls.uploads.length, 0, "no files chosen: nothing uploaded");

  // หน้าโหลดใหม่: ใบกลับเป็นกำลังดำเนินการ มีป้ายรอบแก้ไข + ประวัติรอบ + ไทม์ไลน์
  assert.match(w.html, /กำลังดำเนินการ/);
  assert.match(w.html, /<span class="badge itwo-rework-tag">แก้ไขครั้งที่ 1 · กำหนด 05\/12\/2569<\/span>/);
  assert.match(visibleText(w.html), /ประวัติการแก้ไขงาน 1 แก้ไขครั้งที่ 1 · กำหนดเสร็จ 05\/12\/2569 สีโลโก้ไม่ตรง/);
  assert.match(w.html, /ผู้แจ้งขอแก้ไขงาน/);
  assert.deepEqual(w.buttons(), [], "once IT has closed the request the requester can no longer cancel it (receipt is always the last step), and cannot receive yet");

  // IT เห็นป้ายในงาน IT แล้วปิดงานอีกครั้ง (อนุมัติไม่ต้องทำใหม่)
  w.as("itadm");
  await w.open("view=it");
  assert.match(w.html, /แก้ไขครั้งที่ 1 · กำหนด 05\/12\/2569/);
  assert.equal(w.html.includes('data-group="in_progress"'), true);
  await w.open(query);
  assert.deepEqual(w.buttons(), ["request_info", "complete"]);
  await w.click("complete");
  w.as("emp");
  await w.open(query);
  assert.deepEqual(w.buttons(), ["receive", "request_rework"], "after the second close the requester can receive or ask again");
  await w.click("receive");
  assert.match(w.html, /จบงานแล้ว/);
  assert.deepEqual(w.buttons(), []);
});

test("a rework request that the database refuses keeps the form and its text, shows the Thai message, and can be sent again", async () => {
  const w = world();
  const order = await closedOrder(w);
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_rework");
  w.elements["#itwo-rework-details"].value = "แก้สี";
  w.elements["#itwo-rework-due"].value = "2026-12-05";
  const submit = () => w.elements["#itwo-rework-form"].listeners.submit[0]({ preventDefault() {} });
  w.rpcFail.set("app_itwo_request_rework", Object.assign(new Error("ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น"), { code: "23514" }));
  await submit();
  assert.match(w.elements["#itwo-rework-message"].innerHTML, /ขอแก้ไขงานได้เมื่อ IT ปิดงานแล้วเท่านั้น/);
  assert.equal(w.elements["#itwo-rework-details"].value, "แก้สี", "what was typed is still there");
  assert.deepEqual(w.calls.busy.slice(-1), [false], "the form is usable again");
  await submit();
  await flush();
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_request_rework").length, 2);
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ 1", kind: "info" });
});

test("a rework with files: the round is created first, then each file is uploaded and registered against that round; the page then shows the files under the round", async () => {
  const w = world();
  const order = await closedOrder(w);
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_rework");
  w.elements["#itwo-rework-details"].value = "แก้สีตามไฟล์";
  w.elements["#itwo-rework-due"].value = "2026-12-05";
  w.elements["#itwo-rework-files"].files = [noFile("ตัวอย่างสี.pdf", 2048), noFile("รูป.JPG", 4096)];
  await w.elements["#itwo-rework-form"].listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.deepEqual(w.names().filter((name) => ["app_itwo_request_rework", "app_itwo_add_attachment"].includes(name)), ["app_itwo_request_rework", "app_itwo_add_attachment", "app_itwo_add_attachment"]);
  const round = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).reworks[0];
  const registered = w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").map((call) => call.args);
  assert.deepEqual(registered.map((args) => [args.p_rework_id, args.p_file_name, args.p_mime_type, args.p_size_bytes]), [
    [round.id, "ตัวอย่างสี.pdf", "application/pdf", 2048], [round.id, "รูป.JPG", "image/jpeg", 4096],
  ]);
  for (const args of registered) assert.match(args.p_storage_path, new RegExp(`^${order.id}/[0-9a-f-]{36}\\.(pdf|jpg)$`), "<order id>/<uuid>.<ext>, lower case");
  assert.deepEqual(w.calls.uploads.map((upload) => [upload.bucket, upload.options.upsert, upload.type]), [["itwo-test-files", false, "application/pdf"], ["itwo-test-files", false, "image/jpeg"]]);
  assert.deepEqual(w.calls.toasts.at(-1), { message: "แนบไฟล์ครบ 2 ไฟล์", kind: "info" });
  // หน้าโหลดใหม่: ไฟล์อยู่ใต้รอบที่ 1 และส่งให้กล่องดูไฟล์ของ app.js พร้อมบัคเก็ต
  assert.match(w.html, /<article class="itwo-rework-round" data-round="1">[\s\S]*ตัวอย่างสี\.pdf[\s\S]*รูป\.JPG[\s\S]*<\/article>/);
  const hydrated = w.calls.hydrated.at(-1);
  assert.equal(hydrated.bucket, "itwo-test-files");
  assert.deepEqual(hydrated.files.map((file) => [file.file_name, file.content_type]), [["ตัวอย่างสี.pdf", "application/pdf"], ["รูป.JPG", "image/jpeg"]]);
});

test("a rework file that cannot be uploaded does not undo the rework: the panel lists it, a retry uploads only that file, then the page reloads", async () => {
  const w = world();
  const order = await closedOrder(w);
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_rework");
  w.elements["#itwo-rework-details"].value = "แก้";
  w.elements["#itwo-rework-due"].value = "2026-12-05";
  w.elements["#itwo-rework-files"].files = [noFile("a.pdf"), noFile("b.pdf")];
  w.fail.upload = (path, file) => (file.name === "b.pdf" ? Object.assign(new Error("Failed to fetch"), { code: "" }) : null);
  await w.elements["#itwo-rework-form"].listeners.submit[0]({ preventDefault() {} });
  await flush();
  const panel = w.hosts["#itwo-rework-card"];
  assert.match(visibleText(panel), /ส่งใบกลับให้ IT แก้ไขแล้ว · แก้ไขครั้งที่ 1/);
  assert.match(visibleText(panel), /แนบไม่สำเร็จ 1 จาก 2 ไฟล์ \(แนบแล้ว 1\)/);
  assert.match(panel, /เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด กดลองอีกครั้งได้เลย/);
  assert.equal(w.names().filter((name) => name === "app_itwo_request_rework").length, 1, "the rework itself was recorded once");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 1, "leaving now would lose one file: app.js asks first");

  w.fail.upload = null;
  const reloads = w.calls.renderRoutes;
  await w.elements["#itwo-upload-retry"].listeners.click[0]();
  await flush();
  assert.deepEqual(w.calls.uploads.map((upload) => upload.name), ["a.pdf", "b.pdf", "b.pdf"], "a.pdf is not uploaded again");
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").length, 2, "each file registered once");
  assert.equal(w.calls.renderRoutes, reloads + 1, "all files in: the order page reloads");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0);
});

test("the rework form counts as unsaved only while it is open and has text or files; the app asks before leaving", async () => {
  const w = world();
  const order = await closedOrder(w);
  const probe = () => w.context.window.MNP_ITWO.unsavedCount();
  await w.open(`view=order&id=${order.id}`);
  assert.equal(probe(), 0, "hidden form");
  await w.click("request_rework");
  assert.equal(probe(), 0, "open but empty");
  w.elements["#itwo-rework-details"].value = "แก้สี";
  assert.equal(probe(), 1);
  w.elements["#itwo-rework-details"].value = "  ";
  assert.equal(probe(), 0, "only spaces");
  w.elements["#itwo-rework-files"].files = [noFile("a.pdf")];
  assert.equal(probe(), 1, "a chosen file is something to lose too");
  await w.elements["#itwo-rework-cancel"].listeners.click[0]();
  assert.equal(w.elements["#itwo-rework-card"].hidden, true, "cancel closes the form");
  assert.equal(probe(), 0);
  await w.open("view=new");
  assert.equal(probe(), 0, "another page");
  assert.match(read("app.js"), /\}\)\.length \+ \(window\.MNP_ITWO\?\.unsavedCount\?\.\(\) \?\? 0\);/, "app.js asks the module before leaving a page");
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
  w.fill({ request_type: "design", order_ref: " SO-7 ", attachment_flag: "no", attachment_note: "ไม่ส่ง", details: " ออกแบบ ", needed_date: "2026-11-25", is_urgent: true });
  await Promise.all([w.submit(), w.submit()]); // กดซ้ำทันที
  await flush();
  const created = w.calls.rpc.filter((call) => call.name === "app_itwo_create");
  assert.equal(created.length, 1, "a double click sends one order");
  assert.deepEqual(created[0].args, { p_request_type: "design", p_misc_detail: null, p_order_ref: "SO-7", p_attachment_flag: "no", p_attachment_note: null, p_details: "ออกแบบ", p_needed_date: "2026-11-25", p_is_urgent: true });
  assert.equal(w.names().includes("app_itwo_add_attachment"), false, "no files, no upload step");
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

/* ---------- ฟอร์มแจ้งงาน: เบ็ดเตล็ด + แนบไฟล์ ---------- */
test("choosing 'เบ็ดเตล็ดอื่นๆ' shows the 'what work' field and requires it; the text is sent as p_misc_detail", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "misc", details: "เมาส์เสีย", needed_date: "2026-11-25" });
  await w.submit();
  assert.deepEqual(w.form.lastErrors.map((error) => [error.name, error.message]), [["misc_detail", "กรุณาระบุว่าเป็นงานเบ็ดเตล็ดอะไร"]]);
  assert.equal(w.names().includes("app_itwo_create"), false);
  // เปลี่ยนใจเป็นงานออกแบบ: ไม่ต้องระบุ และข้อความที่ค้างไม่ถูกส่ง
  w.fill({ request_type: "design", misc_detail: "ค้างอยู่", details: "ออกแบบ", needed_date: "2026-11-25" });
  await w.submit();
  assert.equal(w.calls.rpc.find((call) => call.name === "app_itwo_create").args.p_misc_detail, null);
  const w2 = world();
  await w2.open("view=new");
  w2.fill({ request_type: "misc", misc_detail: " ซ่อมเมาส์ ", details: "เมาส์เสีย", needed_date: "2026-11-25" });
  await w2.submit();
  await flush();
  assert.equal(w2.calls.rpc.find((call) => call.name === "app_itwo_create").args.p_misc_detail, "ซ่อมเมาส์");
  assert.match(w2.hash, /view=order/);
});

test("the misc and file fields follow the choices: misc text only for 'เบ็ดเตล็ดอื่นๆ', the file picker only for attachment = 'มี'", async () => {
  const w = world();
  await w.open("view=new");
  const miscField = w.form.controls["#itwo-misc-field"];
  const filesField = w.form.controls["#itwo-files-field"];
  assert.equal(miscField.hidden, true);
  assert.equal(filesField.hidden, true);
  w.fill({ request_type: "misc", attachment_flag: "yes" });
  w.form.listeners.change[0]();
  assert.equal(miscField.hidden, false);
  assert.equal(filesField.hidden, false);
  w.fill({ request_type: "design", attachment_flag: "other" });
  w.form.listeners.change[0]();
  assert.equal(miscField.hidden, true);
  assert.equal(filesField.hidden, true);
});

test("a form with files: the order is created first, then each file is uploaded and registered in turn; the panel shows progress and then opens the order", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบกล่อง", needed_date: "2026-11-25", files: [noFile("แบบกล่อง.pdf", 2048), noFile("Photo.JPEG", 4096), noFile("ราคา.xlsx", 512)] });
  await w.submit();
  await flush();
  const names = w.names().filter((name) => ["app_itwo_create", "app_itwo_add_attachment"].includes(name));
  assert.deepEqual(names, ["app_itwo_create", "app_itwo_add_attachment", "app_itwo_add_attachment", "app_itwo_add_attachment"]);
  const created = w.calls.rpc.find((call) => call.name === "app_itwo_create");
  assert.equal(created.args.p_attachment_flag, "yes");
  const registered = w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").map((call) => call.args);
  const orderId = w.mock.handlers.app_itwo_list_mine()[0].id;
  assert.deepEqual(registered.map((args) => [args.p_work_order_id, args.p_rework_id, args.p_file_name, args.p_mime_type, args.p_size_bytes]), [
    [orderId, null, "แบบกล่อง.pdf", "application/pdf", 2048],
    [orderId, null, "Photo.JPEG", "image/jpeg", 4096],
    [orderId, null, "ราคา.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", 512],
  ]);
  assert.deepEqual(registered.map((args) => args.p_storage_path.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, (match) => (match === orderId ? "ORDER" : "UUID"))), ["ORDER/UUID.pdf", "ORDER/UUID.jpeg", "ORDER/UUID.xlsx"]);
  assert.deepEqual(w.calls.uploads.map((upload) => upload.path), registered.map((args) => args.p_storage_path), "the path uploaded is the path registered");
  assert.ok(w.calls.uploads.every((upload) => upload.bucket === "itwo-test-files" && upload.options.upsert === false));
  const order = [];
  for (const call of w.calls.rpc) order.push(call.name);
  assert.equal(w.calls.uploads.length, 3);
  assert.equal(w.calls.draftCleared, 1, "the draft is gone once the order exists");
  assert.deepEqual(w.calls.toasts.map((toast) => toast.message), ["แจ้งงานแล้ว · เลขที่ TEST-IT06-26/001", "แนบไฟล์ครบ 3 ไฟล์"]);
  assert.match(w.hash, /^#\/office\?module=work-order&view=order&id=[0-9a-f-]{36}$/, "everything attached: the order page opens");
});

test("a file that fails is shown with its reason, the order is not lost, and retrying uploads only what is left (same path, no second order)", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("a.pdf"), noFile("b.png"), noFile("c.txt")] });
  w.fail.upload = (path, file) => (file.name === "b.png" ? Object.assign(new Error("Failed to fetch"), { code: "" }) : null);
  await w.submit();
  await flush();
  const panel = w.hosts["#itwo-form-card"];
  assert.match(visibleText(panel), /แจ้งงานแล้ว · เลขที่ TEST-IT06-26\/001/);
  assert.match(visibleText(panel), /แนบไม่สำเร็จ 1 จาก 3 ไฟล์ \(แนบแล้ว 2\)/);
  assert.match(panel, /is-failed[\s\S]*b\.png[\s\S]*เชื่อมต่อระบบไม่ได้ สัญญาณอาจขาด กดลองอีกครั้งได้เลย/);
  assert.equal(w.hash, "", "no navigation while a file is missing: the user decides");
  assert.equal(w.names().filter((name) => name === "app_itwo_create").length, 1);
  assert.equal(w.mock.handlers.app_itwo_list_mine().length, 1, "the order exists");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 1, "leaving would lose the failed file: the app asks first");

  const firstPaths = w.calls.uploads.filter((upload) => upload.name === "b.png").map((upload) => upload.path);
  w.fail.upload = null;
  await w.elements["#itwo-upload-retry"].listeners.click[0]();
  await flush();
  assert.deepEqual(w.calls.uploads.map((upload) => upload.name), ["a.pdf", "b.png", "c.txt", "b.png"], "only the failed file is uploaded again");
  assert.equal(w.calls.uploads.at(-1).path, firstPaths[0], "same path as the first try");
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").length, 3);
  assert.equal(w.names().filter((name) => name === "app_itwo_create").length, 1, "retrying never creates another order");
  assert.match(w.hash, /view=order/, "all in: the order page opens");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0);
});

test("when the registration step fails the file is not uploaded twice on retry; a refusal from the database is shown in Thai and 'ไปที่ใบสั่งงาน' still works", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("a.pdf")] });
  // 30 นาทีผ่านไปแล้วตามฐานข้อมูล: ลงทะเบียนไม่ได้ (ข้อความไทยของฐานข้อมูล)
  const real = w.context.sb.rpc;
  w.context.sb.rpc = async (name, args) => {
    if (name === "app_itwo_add_attachment") { w.calls.rpc.push({ name, args: plain(args) }); return { data: null, error: Object.assign(new Error("หมดเวลาแนบไฟล์แล้ว (แนบได้ภายใน 30 นาทีหลังแจ้งงาน)"), { code: "23514" }) }; }
    return real(name, args);
  };
  await w.submit();
  await flush();
  assert.match(w.hosts["#itwo-form-card"], /หมดเวลาแนบไฟล์แล้ว \(แนบได้ภายใน 30 นาทีหลังแจ้งงาน\)/);
  assert.equal(w.calls.uploads.length, 1);
  await w.elements["#itwo-upload-retry"].listeners.click[0]();
  await flush();
  assert.equal(w.calls.uploads.length, 1, "the file is already on Storage: only registration is tried again");
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").length, 2);
  assert.equal(w.hash, "");
  await w.elements["#itwo-upload-continue"].listeners.click[0]();
  assert.match(w.hash, /view=order/, "the user can go on to the order without the file");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0, "after choosing to continue there is nothing left to ask about");
});

test("the file is sent to Storage with the type of its extension, not the browser's guess: a Windows .csv (application/vnd.ms-excel), a .docx with an empty type and an octet-stream .pdf are all registered", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("ราคา.csv", 300, "application/vnd.ms-excel"), noFile("สเปก.docx", 400, ""), noFile("แบบ.pdf", 500, "application/octet-stream")] });
  await w.submit();
  await flush();
  const wordType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  // สิ่งที่ Storage รับจริง = file.type ของไฟล์ที่ส่ง (options.contentType ถูกเมินเมื่อส่ง File)
  assert.deepEqual(w.calls.uploads.map((upload) => upload.type), ["text/csv", wordType, "application/pdf"]);
  assert.deepEqual(w.calls.uploads.map((upload) => upload.name), ["ราคา.csv", "สเปก.docx", "แบบ.pdf"], "the original file name is kept");
  const registered = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: w.mock.handlers.app_itwo_list_mine()[0].id }).attachments;
  assert.deepEqual(registered.map((file) => file.mime_type), ["text/csv", wordType, "application/pdf"], "the database keeps the type Storage recorded");
  assert.match(w.hash, /view=order/, "all files registered: the order page opens");
});

test("the form is novalidate: while attachment-image.js is still converting a picture (validationMessage set) nothing is sent; once it is done the form goes through", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("รูป.heic", 800)] });
  w.form.controls["#itwo-files"].validationMessage = "กำลังเตรียมรูป กรุณารอสักครู่";
  await w.submit();
  assert.match(w.elements["#itwo-message"].innerHTML, /กำลังเตรียมไฟล์ รอสักครู่ แล้วกดส่งอีกครั้ง/);
  assert.equal(w.names().includes("app_itwo_create"), false, "no order is created from a file that is not ready");
  assert.equal(w.calls.uploads.length, 0);
  // เลือก "ไม่มี" = ไม่ส่งไฟล์ จึงไม่ต้องรอไฟล์
  for (const radio of w.form.radios.attachment_flag) radio.checked = radio.value === "no";
  await w.submit();
  await flush();
  assert.equal(w.names().filter((name) => name === "app_itwo_create").length, 1);
  assert.equal(w.calls.uploads.length, 0);

  const ready = world();
  await ready.open("view=new");
  ready.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("รูป.jpg", 800)] });
  ready.form.controls["#itwo-files"].validationMessage = "";
  await ready.submit();
  await flush();
  assert.equal(ready.calls.uploads.length, 1);
});

test("the rework form is novalidate too: it does not send while a picture is still being prepared", async () => {
  const w = world();
  const order = await closedOrder(w);
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_rework");
  w.elements["#itwo-rework-details"].value = "แก้";
  w.elements["#itwo-rework-due"].value = "2026-12-05";
  w.elements["#itwo-rework-files"].files = [noFile("รูป.heic", 800)];
  w.elements["#itwo-rework-files"].validationMessage = "กำลังเตรียมรูป กรุณารอสักครู่";
  await w.elements["#itwo-rework-form"].listeners.submit[0]({ preventDefault() {} });
  await flush();
  assert.match(w.elements["#itwo-rework-message"].innerHTML, /กำลังเตรียมไฟล์ รอสักครู่ แล้วกดส่งอีกครั้ง/);
  assert.equal(w.names().includes("app_itwo_request_rework"), false);
  assert.equal(w.calls.confirms.length, 0, "no confirmation asked before the files are ready");
});

test("a file the database refuses because of the file itself is not registered again under the same path: the retry uploads it afresh under a new path", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("ราคา.csv", 300, "text/csv")] });
  w.rpcFail.set("app_itwo_add_attachment", Object.assign(new Error("นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่"), { code: "23514" }));
  await w.submit();
  await flush();
  assert.match(w.hosts["#itwo-form-card"], /นามสกุลไฟล์ไม่ตรงกับชนิดของไฟล์ กรุณาอัปโหลดไฟล์ใหม่/);
  assert.equal(w.calls.uploads.length, 1);
  await w.elements["#itwo-upload-retry"].listeners.click[0]();
  await flush();
  assert.equal(w.calls.uploads.length, 2, "uploaded again, not just registered again");
  assert.notEqual(w.calls.uploads[1].path, w.calls.uploads[0].path, "a new path: Storage cannot overwrite the first object");
  assert.match(w.calls.uploads[1].path, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.csv$/);
  const registeredPaths = w.calls.rpc.filter((call) => call.name === "app_itwo_add_attachment").map((call) => call.args.p_storage_path);
  assert.deepEqual(registeredPaths, [w.calls.uploads[0].path, w.calls.uploads[1].path]);
  assert.match(w.hash, /view=order/, "registered the second time: the order page opens");
  // ข้อความที่ไม่เกี่ยวกับตัวไฟล์ (หมดเวลาแนบ) ยังคงลงทะเบียน path เดิม ไม่อัปโหลดซ้ำ (ดูเทสต์ก่อนหน้า)
});

test("when the real database window (30 minutes) has closed, the mock refuses the registration just like the database", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("a.pdf")] });
  w.clock.offset = 3 * 3600 * 1000;
  await w.submit();
  await flush();
  assert.match(w.hosts["#itwo-form-card"], /หมดเวลาแนบไฟล์แล้ว \(แนบได้ภายใน 30 นาทีหลังแจ้งงาน\)/);
});

test("a file the user picked but then 'ไม่มี' attachments: nothing is uploaded; a bad file type or more than 10 files stops before the order is created", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "no", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("a.pdf")] });
  await w.submit();
  await flush();
  assert.equal(w.calls.uploads.length, 0, "attachment = ไม่มี: the picked file is not sent");
  assert.equal(w.names().includes("app_itwo_add_attachment"), false);

  const bad = world();
  await bad.open("view=new");
  bad.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("ok.pdf"), noFile("virus.exe")] });
  await bad.submit();
  assert.match(bad.elements["#itwo-message"].innerHTML, /virus\.exe: ชนิดไฟล์นี้ไม่รองรับ/);
  assert.equal(bad.names().includes("app_itwo_create"), false, "no order is created with a file that can never be attached");

  const many = world();
  await many.open("view=new");
  many.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: Array.from({ length: 11 }, (_, index) => noFile(`${index}.pdf`)) });
  await many.submit();
  assert.match(many.elements["#itwo-message"].innerHTML, /ไม่เกิน 10 ไฟล์/);
  assert.equal(many.names().includes("app_itwo_create"), false);
});

test("the review step lists the chosen files only when attachment is 'มี'", async () => {
  const w = world();
  await w.open("view=new");
  w.fill({ request_type: "design", attachment_flag: "yes", details: "ออกแบบ", needed_date: "2026-11-25", files: [noFile("แบบ.pdf", 1536)] });
  w.context.window.MNP_FORM_STEPS.bindStepper = undefined;
  const review = w.form.controls["#itwo-review"];
  const pages = w.context.window.MNP_ITWO_PAGES;
  // ขั้นทบทวนวาดผ่าน orderReview (ตรวจเต็มที่ itwo-pages.test.mjs): ที่นี่ยืนยันว่าโมดูลส่งรายชื่อไฟล์เข้าไป
  const html = pages.orderReview({ request_type: "design", attachment_flag: "yes", details: "x", needed_date: "2026-11-25" }, [{ name: "แบบ.pdf", size: 1536 }]);
  assert.match(visibleText(html), /ไฟล์แนบ 1 ไฟล์: แบบ\.pdf \(1\.5 KB\)/);
  assert.ok(review);
});

test("a legacy order with IT access rows shows them read-only; nothing in the module can write them", async () => {
  const w = world();
  const order = await w.create();
  w.mock.seedAccess(order.id, [{ system: "i_prime", action: "add", new_username: "somchai", old_username: null, note: "ใหม่" }]);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.match(w.html, /สำหรับแผนก IT : สิทธิ์ในระบบ/);
  assert.match(visibleText(w.html), /I-Prime System เพิ่ม somchai — ใหม่/);
  assert.doesNotMatch(w.html, /itwo-access-edit|itwo-access-form/);
  assert.equal(w.names().includes("app_itwo_save_access_changes"), false);
  assert.match(w.context.window.MNP_ITWO_PAGES.printSheet(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id })), /somchai/);
  // ฐานข้อมูลก็ปฏิเสธการบันทึกใหม่ทุกครั้ง (ฟังก์ชันยังอยู่ให้หน้าเว็บรุ่นเก่าได้ข้อความไทย)
  assert.throws(() => w.mock.handlers.app_itwo_save_access_changes({ p_work_order_id: order.id, p_changes: [] }), /ถอดออกจากใบสั่งงาน IT แล้ว/);
});

test("the files of an order are handed to app.js's gallery with the bucket of its mode; an order without files does not call it", async () => {
  const w = world();
  const order = await w.create({ attachment_flag: "yes" });
  await w.open(`view=order&id=${order.id}`);
  assert.equal(w.calls.hydrated.length, 0);
  assert.doesNotMatch(w.html, /attachment-gallery/);
  w.objects.set("itwo-test-files/x", {});
  const path = `${order.id}/aaaaaaaa-aaaa-4aaa-8aaa-000000000099.pdf`;
  w.objects.set(`itwo-test-files/${path}`, { type: "application/pdf" }); // mimetype ที่ Storage จดไว้
  await w.context.sb.rpc("app_itwo_add_attachment", { p_work_order_id: order.id, p_rework_id: null, p_storage_path: path, p_file_name: "สเปค.pdf", p_mime_type: "application/pdf", p_size_bytes: 10 });
  await w.open(`view=order&id=${order.id}`);
  assert.match(w.html, /id="attachment-gallery"/);
  assert.deepEqual(w.calls.hydrated.at(-1).files.map((file) => file.file_name), ["สเปค.pdf"]);
  assert.equal(w.calls.hydrated.at(-1).bucket, "itwo-test-files");
  // กดดูไฟล์ในแกลเลอรี = กล่องดูไฟล์ของ app.js (ผูก click ที่ #attachment-gallery)
  const click = w.elements["#attachment-gallery"].listeners.click[0];
  click({ target: { closest: () => ({ dataset: { attachmentOpen: "file-1" } }) } });
  assert.deepEqual(w.calls.lightbox, ["file-1"]);
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

test("settings: in test mode the staff picker lists the test personas (and is switched off)", async () => {
  const w = world();
  w.as("itadm");
  w.context.state.sandbox = { active: true, personas: [PEOPLE.emp, PEOPLE.itadm] };
  await w.open("view=settings");
  assert.match(w.html, /<select class="select" id="itwo-staff-no" name="employee_no" disabled>/);
  assert.match(w.html, /<option value="MK1">MK1 สมชาย ใจดี · การตลาด<\/option>/);
  assert.match(w.html, /<option value="SBX-IT-ADMIN">SBX-IT-ADMIN ไอที ผู้ดูแล · เทคโนโลยีสารสนเทศ<\/option>/);
});

test("purge removes the test files the database listed, in chunks of 100, and says how many; leftovers keep the page and ask to press again", async () => {
  const w = world();
  w.context.state.sandbox = { active: true };
  for (let index = 0; index < 250; index += 1) w.objects.set(`itwo-test-files/${String(index).padStart(3, "0")}.pdf`, {});
  w.objects.set("itwo-files/real.pdf", {}); // ของจริงไม่แตะ
  await w.open("");
  await w.elements["#itwo-purge"].listeners.click[0]({ currentTarget: el() });
  await flush();
  assert.deepEqual(w.calls.removes.map((call) => [call.bucket, call.paths.length]), [["itwo-test-files", 100], ["itwo-test-files", 100], ["itwo-test-files", 50]]);
  assert.equal([...w.objects.keys()].filter((key) => key.startsWith("itwo-test-files/")).length, 0);
  assert.equal(w.objects.has("itwo-files/real.pdf"), true, "real files are never touched");
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ล้างข้อมูลทดสอบแล้ว 0 แถว · ลบไฟล์ 250 ไฟล์", kind: "success" });

  // ลบไม่ครบ: Storage ลบได้ไม่ครบ → บอกจำนวนที่เหลือ ไม่ออกจากหน้า (ให้กดซ้ำ) และกดซ้ำได้รายการที่เหลือ
  for (let index = 0; index < 5; index += 1) w.objects.set(`itwo-test-files/left-${index}.pdf`, {});
  w.fail.removeShort = 2;
  await w.elements["#itwo-purge"].listeners.click[0]({ currentTarget: el() });
  await flush();
  const partial = w.calls.toasts.at(-1);
  assert.equal(partial.kind, "error");
  assert.match(partial.message, /ลบไฟล์ได้ 3 จาก 5 ไฟล์ ยังเหลือ 2 ไฟล์ กดล้างข้อมูลอีกครั้งเพื่อลบไฟล์ที่เหลือ/);
  assert.equal([...w.objects.keys()].filter((key) => key.startsWith("itwo-test-files/")).length, 2);
  w.fail.removeShort = 0;
  await w.elements["#itwo-purge"].listeners.click[0]({ currentTarget: el() });
  await flush();
  assert.equal([...w.objects.keys()].filter((key) => key.startsWith("itwo-test-files/")).length, 0, "pressing again clears the rest");
  assert.match(w.calls.toasts.at(-1).message, /ลบไฟล์ 2 ไฟล์/);
});

test("a purge whose Storage call fails keeps the page and says how many files are left; the rows are already gone so pressing again lists the files", async () => {
  const w = world();
  w.context.state.sandbox = { active: true };
  w.objects.set("itwo-test-files/a.pdf", {});
  w.fail.remove = () => Object.assign(new Error("Failed to fetch"), {});
  await w.open("");
  await w.elements["#itwo-purge"].listeners.click[0]({ currentTarget: el() });
  await flush();
  assert.equal(w.calls.toasts.at(-1).kind, "error");
  assert.match(w.calls.toasts.at(-1).message, /ลบไฟล์ได้ 0 จาก 1 ไฟล์ ยังเหลือ 1 ไฟล์ กดล้างข้อมูลอีกครั้ง/);
  assert.equal(w.objects.size, 1);
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

/* ---------- ผลตรวจรอบ auditor ---------- */
test("a slow page does not repaint when the user has already gone to another page (IT SUPPORT / outside the module)", async () => {
  const w = world({ as: "itadm" });
  const real = w.context.sb.rpc;
  for (const target of ["#/office?module=it-support", "#/dashboard"]) {
    let release;
    w.context.sb.rpc = (name, args) => (name === "app_itwo_list_it" && !release ? new Promise((resolve) => { release = () => resolve(real(name, args)); }) : real(name, args));
    w.context.location.hash = "#/office?module=work-order&view=it";
    const before = w.html;
    const slow = w.open("view=it");
    await flush();
    w.context.location.hash = target; // กด "‹ IT SUPPORT" หรือไปหน้าอื่นก่อนแท็บโหลดเสร็จ
    release();
    await slow;
    await flush();
    assert.equal(w.html, before, `${target}: the late tab must not be painted over the other page`);
  }
  w.context.sb.rpc = real;
  // ไม่ออกจากหน้า = วาดตามปกติ
  w.context.location.hash = "#/office?module=work-order&view=it";
  await w.open("view=it");
  assert.match(w.html, /งาน IT/);

  // หน้าแสดงข้อผิดพลาดก็ไม่วาดทับเช่นกัน
  const order = await w.create();
  w.as("itadm");
  let fail;
  w.context.sb.rpc = (name, args) => (name === "app_itwo_get_detail" ? new Promise((resolve) => { fail = () => resolve({ data: null, error: Object.assign(new Error("Failed to fetch"), { code: "" }) }); }) : real(name, args));
  const before = w.html;
  const slow = w.open(`view=order&id=${order.id}`);
  await flush();
  w.context.location.hash = "#/office?module=it-support";
  fail();
  await slow;
  await flush();
  assert.equal(w.html, before, "the error page is not painted over the other page either");
});

test("settings: the staff picker (real mode) lists only active, non-test, non-deleted employees", async () => {
  const w = world();
  w.as("itadm");
  const real = w.context.sb.rpc;
  // ตัวตนจำลองเป็นโหมดทดสอบเสมอ ที่นี่ต้องการโหมดปกติ
  w.context.sb.rpc = async (name, args) => {
    const result = await real(name, args);
    return name === "app_itwo_my_role" ? { ...result, data: { ...result.data, is_test: false } } : result;
  };
  const calls = [];
  const builder = {
    select(columns) { calls.push(["select", columns]); return builder; },
    eq(column, value) { calls.push(["eq", column, value]); return builder; },
    is(column, value) { calls.push(["is", column, value]); return builder; },
    then(resolve) { resolve({ data: [{ employee_no: "MK1", first_name: "สมชาย", last_name: "ใจดี", is_active: true, department: { name_th: "การตลาด" } }], error: null }); },
  };
  w.context.sb.from = (table) => { calls.push(["from", table]); return builder; };
  await w.open("view=settings");
  assert.deepEqual(calls.filter((call) => call[0] !== "select"), [["from", "employees"], ["eq", "is_active", true], ["eq", "is_test", false], ["is", "deleted_at", null]]);
  assert.match(w.html, /<option value="MK1">MK1 สมชาย ใจดี · การตลาด<\/option>/);
});

test("approve: the IT-step approver is told when one click counts as both steps (department without a manager); a plain department-step approval is not", async () => {
  const w = world();
  w.as("other"); // แผนกที่ไม่มีผู้จัดการ: ผู้อนุมัติขั้น IT กดครั้งเดียวนับทั้งสองขั้น
  const created = await w.context.sb.rpc("app_itwo_create", { p_request_type: "design", p_order_ref: null, p_attachment_flag: "no", p_attachment_note: null, p_details: "ใบทดสอบ", p_needed_date: "2026-11-25", p_is_urgent: false });
  const orderId = created.data[0].id;
  w.as("itapp");
  await w.open(`view=order&id=${orderId}`);
  await w.click("approve");
  assert.match(w.calls.confirms.at(-1).message, /ใบนี้จะนับเป็นการอนุมัติทั้งขั้นแผนกและขั้น IT/);

  const second = await w.create(); // แผนก MK มีผู้จัดการ: ผู้จัดการแผนกอนุมัติขั้นแผนก
  w.as("mgr");
  await w.open(`view=order&id=${second.id}`);
  await w.click("approve");
  assert.doesNotMatch(w.calls.confirms.at(-1).message, /ทั้งขั้นแผนกและขั้น IT/);
  w.as("itapp"); // ขั้นแผนกผ่านแล้ว: ขั้น IT ขั้นเดียว
  await w.open(`view=order&id=${second.id}`);
  await w.click("approve");
  assert.doesNotMatch(w.calls.confirms.at(-1).message, /ทั้งขั้นแผนกและขั้น IT/);
});

/* ---------- ถามผู้แจ้ง / ตอบคำถาม (รุ่น 3) ---------- */
// ใบที่อนุมัติครบแล้ว (ผู้แจ้งเป็น emp) รอ IT เริ่มงาน
async function approvedOrder(w, overrides = {}) {
  const order = await w.create(overrides);
  w.as("mgr");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  w.as("itapp");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  w.as("emp");
  w.calls.rpc.length = 0;
  return order;
}
const askAs = async (w, who, orderId, body, extra = {}) => {
  w.as(who);
  const asked = await w.context.sb.rpc("app_itwo_request_info", { p_work_order_id: orderId, p_body: body });
  assert.equal(asked.error, null, extra.note ?? "the question was accepted");
  w.as("emp");
  w.calls.rpc.length = 0;
  return asked.data.comment_id;
};
const submitForm = (w, selector) => w.elements[selector].listeners.submit[0]({ preventDefault() {} });

test("IT asks the requester: the button opens the form, an empty or over-long message is stopped, the confirm asks first, then the order is 'รอผู้แจ้งตอบ' and IT has no start/complete", async () => {
  const w = world();
  const order = await approvedOrder(w);
  const query = `view=order&id=${order.id}`;
  w.as("itadm");
  await w.open(query);
  assert.deepEqual(w.buttons(), ["request_info", "start"]);
  const card = w.elements["#itwo-ask-card"];
  assert.equal(card.hidden, true, "the ask form starts hidden");
  await w.click("request_info");
  assert.equal(card.hidden, false, "the button opens the form");
  assert.equal(w.names().includes("app_itwo_request_info"), false, "pressing the button sends nothing");
  assert.equal(w.calls.confirms.length, 0);

  await submitForm(w, "#itwo-ask-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.message), ["กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง"]);
  w.elements["#itwo-ask-body"].value = "ก".repeat(2001);
  await submitForm(w, "#itwo-ask-form");
  assert.match(w.calls.fieldErrors[0].message, /ไม่เกิน 2,000 ตัวอักษร/);
  assert.equal(w.names().includes("app_itwo_request_info"), false);

  w.elements["#itwo-ask-body"].value = "  ขอไฟล์ต้นฉบับของโลโก้ด้วยครับ  ";
  w.answers.confirm = false;
  await submitForm(w, "#itwo-ask-form");
  assert.equal(w.calls.confirms.at(-1).title, "ส่งคำถามถึงผู้แจ้ง?");
  assert.equal(w.names().includes("app_itwo_request_info"), false, "dismissing the confirm sends nothing");
  w.answers.confirm = true;
  await submitForm(w, "#itwo-ask-form");
  await flush();
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_request_info").args, { p_work_order_id: order.id, p_body: "ขอไฟล์ต้นฉบับของโลโก้ด้วยครับ" }, "the text is trimmed");
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งคำถามถึงผู้แจ้งแล้ว", kind: "info" });
  assert.equal(w.calls.uploads.length, 0, "no files chosen: nothing uploaded");

  // หน้าโหลดใหม่: รอผู้แจ้งตอบ ไม่มีปุ่มเริ่ม/ส่งงาน/ถามซ้ำ · ถาม-ตอบมีคำถาม · ไทม์ไลน์มีผู้ถามและข้อความย่อ
  assert.match(w.html, /<span class="badge more_info">รอผู้แจ้งตอบ<\/span>/);
  assert.deepEqual(w.buttons(), ["cancel"], "IT can only cancel on behalf of the requester (v1.02) - no start or complete");
  assert.match(visibleText(w.html), /ถาม-ตอบ 1 ถาม · ทีม IT ยังไม่ตอบ โดย ไอที ผู้ดูแล/);
  assert.match(visibleText(w.html), /ถามผู้แจ้ง โดย ไอที ผู้ดูแล ถามผู้แจ้ง \(ทีม IT\): ขอไฟล์ต้นฉบับของโลโก้ด้วยครับ/);
  assert.equal((visibleText(w.html).match(/รอผู้แจ้งตอบ/g) ?? []).length, 1, "the status is said once (header badge)");
});

test("the requester sees the question first and answers it: the answer is confirmed, sent, the toast names the stage, and the order is back where it was with both messages in the Q&A card", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, "ขอไฟล์ต้นฉบับ\nด้วยครับ <b>ด่วน</b>");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["cancel"], "answering is the open form, not a button");
  const card = w.html.match(/<section class="card itwo-answer-card"[\s\S]*?<\/section>/)[0];
  assert.match(visibleText(card), /ทีม IT ถามคุณ โดย ไอที ผู้ดูแล · \d{2}\/\d{2}\/2569 \d{2}:\d{2} ขอไฟล์ต้นฉบับ ด้วยครับ &lt;b&gt;ด่วน&lt;\/b&gt;/);
  assert.doesNotMatch(w.html, /<b>ด่วน/);
  assert.equal(w.html.includes("itwo-comments"), false, "the only message is the open question: shown once, in the answer card");

  await submitForm(w, "#itwo-answer-form");
  assert.deepEqual(w.calls.fieldErrors.map((error) => error.message), ["กรุณาพิมพ์คำตอบ"]);
  assert.equal(w.names().includes("app_itwo_provide_info"), false);
  w.elements["#itwo-answer-body"].value = "  แนบให้ในข้อความนี้แล้วครับ  ";
  w.answers.confirm = false;
  await submitForm(w, "#itwo-answer-form");
  assert.equal(w.calls.confirms.at(-1).title, "ส่งคำตอบ?");
  assert.equal(w.names().includes("app_itwo_provide_info"), false);
  w.answers.confirm = true;
  await submitForm(w, "#itwo-answer-form");
  await flush();
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_provide_info").args, { p_work_order_id: order.id, p_body: "แนบให้ในข้อความนี้แล้วครับ" });
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งคำตอบแล้ว ใบกลับไปที่ทีม IT", kind: "info" });
  // กลับสถานะเดิม (อนุมัติครบ) IT เริ่มงานได้อีก · ถาม-ตอบมีคำถามและคำตอบตามลำดับ
  assert.doesNotMatch(w.html, /itwo-answer-card/);
  assert.match(w.html, /<span class="badge approved">อนุมัติครบ<\/span>/);
  assert.deepEqual([...w.html.matchAll(/<article class="itwo-comment is-(\w+)"/g)].map((match) => match[1]), ["question", "answer"]);
  assert.match(visibleText(w.html), /ผู้แจ้งตอบคำถาม โดย สมชาย ใจดี ผู้แจ้งตอบคำถาม: แนบให้ในข้อความนี้แล้วครับ/);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["request_info", "start"]);
});

test("an approver asks at their own stage: the order waits for the requester, the approver has no approve or reject button, and both RPCs are refused (v1.02)", async () => {
  const w = world();
  const order = await w.create();
  w.as("mgr");
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_info");
  w.elements["#itwo-ask-body"].value = "ใช้กับสินค้าตัวไหนครับ";
  await submitForm(w, "#itwo-ask-form");
  await flush();
  assert.deepEqual(w.buttons(), [], "while waiting for the requester an approver can neither approve nor reject (v1.02: wait for the answer)");
  assert.match(visibleText(w.html), /ถาม · ผู้จัดการแผนก/);
  assert.doesNotMatch(visibleText(w.html), /ตอบแล้วใบกลับไปที่/, "the return step is not repeated for the approver (the pending-steps line says it)");
  const refused = await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  assert.match(refused.error.message, /รอผู้แจ้งตอบคำถามอยู่ ต้องรอคำตอบก่อนจึงจะอนุมัติได้/);
  const refusedReject = await w.context.sb.rpc("app_itwo_reject", { p_work_order_id: order.id, p_reason: "ไม่อนุมัติระหว่างรอ" });
  assert.match(refusedReject.error.message, /ใบนี้กำลังรอผู้แจ้งตอบคำถาม กรุณารอคำตอบก่อน/);
  assert.equal(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).status, "need_info", "the refused rejection changed nothing");
  // ผู้แจ้งตอบ → ผู้จัดการอนุมัติได้อีก
  w.as("emp");
  await w.open(`view=order&id=${order.id}`);
  assert.match(w.calls.toasts.at(-1).message, /ส่งคำถามถึงผู้แจ้งแล้ว/);
  w.elements["#itwo-answer-body"].value = "สินค้ารุ่น A";
  await submitForm(w, "#itwo-answer-form");
  await flush();
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งคำตอบแล้ว ใบกลับไปที่ผู้จัดการแผนก", kind: "info" });
  w.as("mgr");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["approve", "reject", "request_info"], "answered: the manager decides again");
});

test("a question with files: the message is saved first, then every file is uploaded and registered against that comment (not as the order's own file), and the page shows them in the Q&A card and the gallery", async () => {
  const w = world();
  const order = await approvedOrder(w);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_info");
  w.elements["#itwo-ask-body"].value = "ใช้ตัวอย่างนี้ได้ไหม";
  w.elements["#itwo-ask-files"].files = [noFile("ตัวอย่าง.pdf", 2048), noFile("รูป <b>.JPG", 4096)];
  await submitForm(w, "#itwo-ask-form");
  await flush();
  assert.deepEqual(w.names().filter((name) => ["app_itwo_request_info", "app_itwo_add_attachment", "app_itwo_add_comment_attachment"].includes(name)), ["app_itwo_request_info", "app_itwo_add_comment_attachment", "app_itwo_add_comment_attachment"]);
  const detail = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id });
  const commentId = detail.comments[0].id;
  const registered = w.calls.rpc.filter((call) => call.name === "app_itwo_add_comment_attachment").map((call) => call.args);
  assert.deepEqual(registered.map((args) => [args.p_work_order_id, args.p_comment_id, args.p_file_name, args.p_mime_type, args.p_size_bytes]), [
    [order.id, commentId, "ตัวอย่าง.pdf", "application/pdf", 2048], [order.id, commentId, "รูป <b>.JPG", "image/jpeg", 4096],
  ]);
  for (const args of registered) assert.match(args.p_storage_path, new RegExp(`^${order.id}/[0-9a-f-]{36}\\.(pdf|jpg)$`));
  assert.deepEqual(w.calls.uploads.map((upload) => [upload.bucket, upload.options.upsert, upload.type]), [["itwo-test-files", false, "application/pdf"], ["itwo-test-files", false, "image/jpeg"]]);
  assert.equal(w.calls.rpc.some((call) => call.name === "app_itwo_add_attachment"), false, "comment files never go through the order's own file RPC");
  assert.deepEqual(detail.attachments, [], "the order's own file list does not carry comment files");
  assert.equal(detail.comments[0].attachments.length, 2);
  // เสร็จ: ไปที่ใบ (โหลดใหม่) ไฟล์อยู่ในถาม-ตอบ และถูกส่งเข้า gallery พร้อม bucket ของโหมด
  assert.match(w.calls.toasts.at(-1).message, /แนบไฟล์ครบ 2 ไฟล์/);
  assert.match(w.html, /id="attachment-gallery"/);
  assert.equal([...w.html.matchAll(/<figure class="attachment-tile"/g)].length, 2);
  assert.match(w.html, /รูป &lt;b&gt;\.JPG/);
  assert.doesNotMatch(w.html, /รูป <b>/);
  assert.deepEqual(w.calls.hydrated.at(-1).files.map((file) => file.file_name), ["ตัวอย่าง.pdf", "รูป <b>.JPG"]);
  assert.equal(w.calls.hydrated.at(-1).bucket, "itwo-test-files");
  const click = w.elements["#attachment-gallery"].listeners.click[0];
  click({ target: { closest: () => ({ dataset: { attachmentOpen: detail.comments[0].attachments[0].id } }) } });
  assert.deepEqual(w.calls.lightbox, [detail.comments[0].attachments[0].id], "the lightbox opens a comment file");
});

test("an answer with files is registered against the answer, and the requester's own order files stay separate", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, "ขอรูป");
  await w.open(`view=order&id=${order.id}`);
  w.elements["#itwo-answer-body"].value = "นี่ครับ";
  w.elements["#itwo-answer-files"].files = [noFile("รูปโลโก้.png", 3000)];
  await submitForm(w, "#itwo-answer-form");
  await flush();
  const detail = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id });
  const answer = detail.comments.find((comment) => comment.kind === "answer");
  assert.deepEqual(w.calls.rpc.filter((call) => call.name === "app_itwo_add_comment_attachment").map((call) => [call.args.p_comment_id, call.args.p_file_name]), [[answer.id, "รูปโลโก้.png"]]);
  assert.equal(detail.status, "approved", "the answer already returned the order; files are an extra");
  assert.match(w.calls.toasts.find((toast) => toast.message.startsWith("ส่งคำตอบแล้ว")).message, /ใบกลับไปที่ทีม IT/);
  assert.deepEqual(answer.attachments.map((file) => file.file_name), ["รูปโลโก้.png"]);
});

test("a file that cannot be registered after the message was saved (window over) keeps the message, shows the Thai reason with a retry, and asks before leaving the page", async () => {
  const w = world();
  const order = await approvedOrder(w);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_info");
  w.elements["#itwo-ask-body"].value = "ขอไฟล์";
  w.elements["#itwo-ask-files"].files = [noFile("ก.pdf", 2048)];
  w.fail.upload = () => { w.clock.offset = 5 * 3600000; return null; }; // ผ่านไป 5 ชั่วโมงก่อนลงทะเบียน
  await submitForm(w, "#itwo-ask-form");
  await flush();
  assert.equal(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).comments.length, 1, "the question is saved");
  assert.match(visibleText(w.screen), /แนบไม่สำเร็จ 1 จาก 1 ไฟล์/);
  assert.match(w.screen, /หมดเวลาแนบไฟล์แล้ว \(แนบได้ภายใน 30 นาทีหลังส่งข้อความ\)/);
  assert.match(w.screen, /id="itwo-upload-retry"/);
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 1, "the unattached file would be lost: app.js asks before leaving");
});

test("typed but unsent text in the ask or answer form counts as unsaved; a closed form does not", async () => {
  const w = world();
  const order = await approvedOrder(w);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0, "the ask form is closed");
  await w.click("request_info");
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0, "open but empty");
  w.elements["#itwo-ask-body"].value = "พิมพ์ค้าง";
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 1);
  w.elements["#itwo-ask-cancel"].listeners.click[0]();
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0, "cancelling closes the form");
  await askAs(w, "itadm", order.id, "คำถาม");
  await w.open(`view=order&id=${order.id}`);
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 0);
  w.elements["#itwo-answer-body"].value = "ตอบค้าง";
  assert.equal(w.context.window.MNP_ITWO.unsavedCount(), 1);
});

test("a refused question or answer keeps the form and the text, shows the Thai message, and can be sent again", async () => {
  const w = world();
  const order = await approvedOrder(w);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  await w.click("request_info");
  w.elements["#itwo-ask-body"].value = "คำถาม";
  w.rpcFail.set("app_itwo_request_info", Object.assign(new Error("ใบสั่งงานนี้มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว ถามเพิ่มได้หลังผู้แจ้งตอบ"), { code: "23514" }));
  await submitForm(w, "#itwo-ask-form");
  assert.match(w.elements["#itwo-ask-message"].innerHTML, /มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว/);
  assert.equal(w.elements["#itwo-ask-body"].value, "คำถาม");
  assert.deepEqual(w.calls.busy.slice(-1), [false]);
  await submitForm(w, "#itwo-ask-form");
  await flush();
  assert.equal(w.calls.rpc.filter((call) => call.name === "app_itwo_request_info").length, 2);
  assert.deepEqual(w.calls.toasts.at(-1), { message: "ส่งคำถามถึงผู้แจ้งแล้ว", kind: "info" });
});

test("while waiting for the answer the requester can still cancel (allowed_actions decides); the order ends cancelled", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, "ขอข้อมูลเพิ่ม");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["cancel"]);
  await w.click("cancel");
  assert.equal(w.calls.prompts.at(-1).title, "ยกเลิกใบสั่งงานนี้?");
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_cancel").args, { p_work_order_id: order.id, p_reason: "เหตุผลทดสอบ" });
  assert.match(w.html, /<span class="badge cancelled">ยกเลิก<\/span>/);
  assert.deepEqual(w.buttons(), []);
});

test("IT admin cancels a waiting order on behalf of the requester: on-behalf dialog, event labelled 'IT ยกเลิกแทนผู้แจ้ง', approver and other states have no cancel", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, "ขอข้อมูลเพิ่ม");
  // ผู้อนุมัติขั้น IT ที่ไม่ใช่ผู้ดูแลงาน (itapp) ไม่มีปุ่มยกเลิก
  w.as("itapp");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), [], "the IT approver (not an IT admin) has no cancel button on a waiting order");
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["cancel"], "the IT admin gets only the cancel button while the requester has not answered");
  w.answers.prompt = null; // ปิดกล่องเหตุผล = ไม่เรียก RPC
  await w.click("cancel");
  assert.equal(w.calls.prompts.at(-1).title, "ยกเลิกใบสั่งงานแทนผู้แจ้ง?");
  assert.equal(w.calls.prompts.at(-1).maxLength, 470, "the limit leaves room for the on-behalf prefix the database adds");
  assert.equal(w.calls.prompts.at(-1).confirmLabel, "ยกเลิกแทนผู้แจ้ง");
  assert.match(w.calls.prompts.at(-1).hint, /ยกเลิกแทนผู้แจ้ง/);
  assert.ok(!w.names().includes("app_itwo_cancel"), "no call when the dialog is dismissed");
  w.answers.prompt = "ผู้แจ้งลาออกแล้ว";
  await w.click("cancel");
  assert.deepEqual(w.calls.rpc.find((call) => call.name === "app_itwo_cancel").args, { p_work_order_id: order.id, p_reason: "ผู้แจ้งลาออกแล้ว" });
  assert.match(w.html, /<span class="badge cancelled">ยกเลิก<\/span>/);
  // ไทม์ไลน์: ป้าย "IT ยกเลิกแทนผู้แจ้ง" + ชื่อ IT ที่บรรทัด "โดย" + เหตุผลมีคำนำหน้า
  assert.match(w.html, /<strong>IT ยกเลิกแทนผู้แจ้ง<\/strong><p class="timeline-item-detail">โดย ไอที ผู้ดูแล<\/p><p class="timeline-item-message">IT ยกเลิกแทนผู้แจ้ง: ผู้แจ้งลาออกแล้ว<\/p>/);
  assert.doesNotMatch(w.html, /<strong>ผู้แจ้งยกเลิก<\/strong>/);
  assert.deepEqual(w.buttons(), []);
});

test("the IT admin has no cancel on orders that are not waiting for the requester (the database refuses it too)", async () => {
  const w = world();
  const order = await approvedOrder(w);
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.ok(!w.buttons().includes("cancel"), "approved order: no cancel for IT");
  const refused = await w.context.sb.rpc("app_itwo_cancel", { p_work_order_id: order.id, p_reason: "IT ยกเลิกเอง" });
  assert.equal(refused.error?.code, "42501");
  assert.match(refused.error.message, /ยกเลิกแทนผู้แจ้งได้เฉพาะใบที่รอผู้แจ้งตอบ/);
  w.as("itapp");
  const approverTry = await w.context.sb.rpc("app_itwo_cancel", { p_work_order_id: order.id, p_reason: "x" });
  assert.match(approverTry.error.message, /เฉพาะผู้แจ้งเท่านั้นที่ยกเลิก/);
});

test("the requester's own cancel dialog keeps the original wording (not the on-behalf one)", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, "ขอข้อมูลเพิ่ม");
  await w.open(`view=order&id=${order.id}`);
  await w.click("cancel");
  assert.equal(w.calls.prompts.at(-1).title, "ยกเลิกใบสั่งงานนี้?");
  assert.equal(w.calls.prompts.at(-1).maxLength, 500);
  assert.match(w.html, /<strong>ผู้แจ้งยกเลิก<\/strong>/);
});

test("the requester's list and counts: 'ใบของฉัน' says 'รอคุณตอบ', the tab and the card count it with the confirmations and say which", async () => {
  const w = world();
  const asked = await approvedOrder(w);
  await askAs(w, "itadm", asked.id, "ขอข้อมูล");
  await w.open("");
  assert.match(w.html, /view-tabs[\s\S]*ใบของฉัน <span class="itwo-tab-count" aria-label="1 รายการ ที่รอคุณตอบ"/);
  assert.match(w.html, /<span class="badge more_info" title="ทีม IT ถามคุณ · ตอบแล้วใบกลับไปที่ อนุมัติครบ">รอคุณตอบ<\/span>/);
  let summary = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(summary.badge, "1 รอคุณ");
  assert.equal(summary.title, "รอคุณตอบ 1");
  // อีกใบที่ IT ส่งงานแล้ว: นับรวม และบอกทั้งสองอย่าง
  const closed = await closedOrder(w);
  await w.open("");
  assert.match(w.html, /aria-label="2 รายการ \(รอคุณยืนยัน 1 · รอคุณตอบ 1\)"/);
  summary = await w.context.window.MNP_ITWO.loadCardSummary();
  assert.equal(summary.badge, "2 รอคุณ");
  assert.equal(summary.title, "รอคุณยืนยันรับงาน 1 · รอคุณตอบ 1");
  assert.ok(closed.id);
  // ตอบแล้ว: ตัวเลขลดลง
  await w.context.sb.rpc("app_itwo_provide_info", { p_work_order_id: asked.id, p_body: "นี่ครับ" });
  await w.open("");
  assert.match(w.html, /aria-label="1 รายการ ที่รอคุณยืนยัน"/);
});

test("approvals: an asked order is listed as 'รอผู้แจ้งตอบ' but the tab count (here and from other tabs) and the card do not count it as waiting for me", async () => {
  const w = world();
  const waiting = await w.create({ details: "ใบที่รอตัดสิน" });
  const asked = await w.create({ details: "ใบที่ถามไปแล้ว" });
  await askAs(w, "mgr", asked.id, "ขอข้อมูล");
  w.as("mgr");
  await w.open("view=approvals");
  assert.match(w.html, /data-group="awaiting_info"/);
  assert.match(visibleText(w.html.slice(w.html.indexOf('data-group="awaiting_info"'))), /รอผู้แจ้งตอบ 1 .*ใบที่ถามไปแล้ว/);
  assert.match(w.html, /รอคุณอนุมัติขั้นผู้จัดการแผนก/);
  assert.match(w.html, /รออนุมัติ <span class="itwo-tab-count" aria-label="1 รายการ ที่รออนุมัติ"[^>]*>1<\/span>/, "only the order that really waits for the manager is counted");
  await w.open("");
  assert.match(w.html, /รออนุมัติ <span class="itwo-tab-count" aria-label="1 รายการ ที่รออนุมัติ"/, "same number from another tab (app_itwo_pending_count)");
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).title, "รออนุมัติ 1");
  assert.ok(waiting.id);
  // ใบที่เหลือแต่ใบที่ถามไป: ไม่มีตัวเลขบนแท็บ แต่ยังเห็นรายการ
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: waiting.id });
  await w.open("view=approvals");
  assert.doesNotMatch(w.html, /itwo-tab-count/);
  assert.match(visibleText(w.html), /ไม่มีใบสั่งงานที่รออนุมัติจากคุณ/);
  assert.match(w.html, /data-group="awaiting_info"/);
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).badge, "");
});

test("the IT list shows an asked order under 'รอผู้แจ้งตอบ', not as work to do, and the IT count leaves it out", async () => {
  const w = world();
  const todo = await approvedOrder(w, { details: "งานที่รอเริ่ม" });
  const asked = await approvedOrder(w, { details: "งานที่ถามไป" });
  await askAs(w, "itadm", asked.id, "ขอข้อมูล");
  w.as("itadm");
  await w.open("view=it");
  assert.deepEqual([...w.html.matchAll(/data-group="([a-z_]+)"/g)].map((match) => match[1]), ["to_start", "awaiting_info"]);
  assert.match(w.html.slice(w.html.indexOf('data-group="to_start"'), w.html.indexOf('data-group="awaiting_info"')), /งานที่รอเริ่ม/);
  assert.match(w.html.slice(w.html.indexOf('data-group="awaiting_info"')), /งานที่ถามไป/);
  assert.match(w.html, /งาน IT <span class="itwo-tab-count" aria-label="1 รายการ ที่ต้องดำเนินการ"[^>]*>1<\/span>/);
  assert.ok(todo.id);
  await w.open("");
  assert.match(w.html, /งาน IT <span class="itwo-tab-count" aria-label="1 รายการ ที่ต้องดำเนินการ"/, "same from another tab");
});

test("nothing a user typed in a question, an answer or a file name reaches the page as markup", async () => {
  const w = world();
  const order = await approvedOrder(w);
  await askAs(w, "itadm", order.id, `<img src=x onerror="alert(1)"> & <script>alert(2)</script>`);
  await w.open(`view=order&id=${order.id}`);
  w.elements["#itwo-answer-body"].value = `"><svg onload=alert(3)>`;
  w.elements["#itwo-answer-files"].files = [noFile(`a"><img src=x onerror=alert(4)>.pdf`, 100)];
  await submitForm(w, "#itwo-answer-form");
  await flush();
  const all = `${w.html}${w.screen}${w.context.window.MNP_ITWO_PAGES.printSheet(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }))}`;
  assert.doesNotMatch(all, /<img src=x|<script>|<svg|onerror="alert|"><img/);
  assert.match(all, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt; &amp; &lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(all, /&quot;&gt;&lt;svg onload=alert\(3\)&gt;/);
});

test("the mock follows the database for questions: who may ask or answer, one open question at a time, comment files only by their author within the window and up to 10, list fields, purge", async () => {
  const w = world();
  const order = await approvedOrder(w);
  const call = (name, args) => { try { return { data: w.mock.handlers[name](args) }; } catch (error) { return { error }; } };
  w.as("emp");
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "x" }).error.message, /ผู้แจ้งถามกลับใบสั่งงานของตัวเองไม่ได้/, "the requester cannot ask on their own order");
  w.as("other");
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "x" }).error.message, /ไม่มีสิทธิ์ถามผู้แจ้ง/, "someone with no part in the order cannot ask");
  w.as("mgr");
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "x" }).error.message, /ไม่มีสิทธิ์ถามผู้แจ้ง/, "the department manager is past their step once the order is approved");
  w.as("itadm");
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "   " }).error.message, /กรุณาพิมพ์ข้อความที่ต้องการถามผู้แจ้ง/);
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "ก".repeat(2001) }).error.message, /ไม่เกิน 2,000/);
  const ask = call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "ขอข้อมูล" });
  assert.deepEqual(ask.data, { comment_id: 1 });
  assert.match(call("app_itwo_request_info", { p_work_order_id: order.id, p_body: "อีกข้อ" }).error.message, /มีคำถามที่รอผู้แจ้งตอบอยู่แล้ว/);
  const detail = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id });
  assert.equal(detail.status, "need_info");
  assert.equal(detail.info_return_status, "approved");
  assert.deepEqual(detail.allowed_actions, ["cancel"], "IT may not start or complete while the requester is asked (only the v1.02 cancel on behalf)");
  assert.deepEqual({ ...detail.info_pending, asked_at: undefined }, { comment_id: 1, stage: "it", body: "ขอข้อมูล", asked_at: undefined, asked_by_employee_no: "SBX-IT-ADMIN", asked_by_full_name: "ไอที ผู้ดูแล" });
  assert.match(detail.events.at(-1).reason, /^ถามผู้แจ้ง \(ทีม IT\): ขอข้อมูล$/);
  assert.equal(detail.events.at(-1).action, "info_requested");
  // รายการมี info_return_status / info_stage ; pending_count ไม่นับ need_info
  assert.deepEqual(w.mock.handlers.app_itwo_list_it().map((row) => [row.status, row.info_return_status, row.info_stage]), [["need_info", "approved", "it"]]);
  w.as("itapp");
  assert.deepEqual(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).allowed_actions, [], "the IT-step approver has already approved");
  w.as("emp");
  assert.deepEqual(w.mock.handlers.app_itwo_list_mine().map((row) => [row.status, row.info_return_status, row.info_stage]), [["need_info", "approved", "it"]]);
  assert.deepEqual(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).allowed_actions, ["cancel", "provide_info"]);
  assert.match(call("app_itwo_provide_info", { p_work_order_id: order.id, p_body: "" }).error.message, /กรุณาพิมพ์คำตอบ/);
  w.as("itadm");
  assert.match(call("app_itwo_provide_info", { p_work_order_id: order.id, p_body: "ฉันตอบเอง" }).error.message, /เฉพาะผู้แจ้งเท่านั้นที่ตอบคำถามได้/);

  // ไฟล์ของข้อความ: เฉพาะผู้เขียน · ≤ 10 ไฟล์ · ภายในหน้าต่าง 30 นาที
  const put = (name) => {
    const path = `${order.id}/aaaaaaaa-aaaa-4aaa-8aaa-${String(900 + w.objects.size).padStart(12, "0")}.pdf`;
    w.objects.set(`itwo-test-files/${path}`, { type: "application/pdf" });
    return { p_work_order_id: order.id, p_comment_id: 1, p_storage_path: path, p_file_name: name, p_mime_type: "application/pdf", p_size_bytes: 10 };
  };
  w.as("emp");
  assert.match(call("app_itwo_add_comment_attachment", put("ก.pdf")).error.message, /เฉพาะผู้เขียนข้อความเท่านั้น/, "the requester did not write the question");
  w.as("itadm");
  const first = put("ข.pdf");
  const id = call("app_itwo_add_comment_attachment", first).data;
  assert.equal(call("app_itwo_add_comment_attachment", first).data, id, "the same path again returns the same registration");
  assert.match(call("app_itwo_add_comment_attachment", { ...put("ค.pdf"), p_comment_id: 99 }).error.message, /ไม่พบข้อความนี้ในใบสั่งงาน/);
  for (let index = 0; index < 9; index += 1) assert.ok(call("app_itwo_add_comment_attachment", put(`f${index}.pdf`)).data);
  assert.match(call("app_itwo_add_comment_attachment", put("เกิน.pdf")).error.message, /ไม่เกิน 10 ไฟล์ต่อข้อความ/);
  w.clock.offset = 31 * 60000 + 600000;
  assert.match(call("app_itwo_add_comment_attachment", put("ช้า.pdf")).error.message, /หมดเวลาแนบไฟล์แล้ว/);
  w.clock.offset = 0;
  assert.deepEqual(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).attachments, [], "comment files are not in the order's list");
  assert.equal(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }).comments[0].attachments.length, 10);
  // เหมือนเดิมกับ add_attachment ของรุ่น 2: ไม่รับ path ของไฟล์ข้อความ
  w.as("emp");
  assert.match(call("app_itwo_add_attachment", { p_work_order_id: order.id, p_rework_id: null, p_storage_path: first.p_storage_path, p_file_name: "x.pdf", p_mime_type: "application/pdf", p_size_bytes: 10 }).error.message, /ไฟล์นี้ถูกลงทะเบียนไว้แล้ว/);

  // ตอบแล้วกลับสถานะเดิม · ล้างข้อมูลทดสอบลบข้อความและไฟล์ของข้อความ
  assert.deepEqual(call("app_itwo_provide_info", { p_work_order_id: order.id, p_body: "ตอบ" }).data, { comment_id: 2 });
  const answered = w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id });
  assert.equal(answered.status, "approved");
  assert.equal(answered.info_return_status, null);
  assert.equal(answered.info_pending, null);
  assert.deepEqual(answered.comments.map((comment) => [comment.id, comment.kind, comment.reply_to]), [[1, "question", null], [2, "answer", 1]]);
  assert.equal(answered.events.at(-1).action, "info_provided");
  const purged = w.mock.handlers.app_sandbox_purge_itwo();
  assert.equal(purged.deleted, 1 + answered.events.length + 2 + 10, "the order, its events, its 2 comments and the 10 comment files are all counted");
  assert.equal(call("app_itwo_get_detail", { p_work_order_id: order.id }).error.code, "42501");
});

/* ---------- ความเรียบร้อยของไฟล์ ---------- */
test("the module never decides rights or document numbers itself, and keeps no secret", () => {
  const source = read("modules/module-itwo.js");
  assert.doesNotMatch(source, /\.from\(\s*["']itwo_/, "all access goes through RPC, never a table");
  assert.doesNotMatch(source, /\bdoc_no\s*[:=]|doc_seq\s*[:=]|nextval/, "document numbers are the database's");
  assert.doesNotMatch(source, /service_role|sb_secret|SUPABASE_SERVICE/i);
  assert.doesNotMatch(source, /save_access_changes|accessPayload|itwo-access-edit/, "the IT access section is gone: the module never writes it");
  // Storage: เฉพาะบัคเก็ตของใบสั่งงาน (ผ่าน model.fileBucket) ไม่แตะบัคเก็ตอื่น
  const buckets = [...source.matchAll(/storage\.from\(([^)]*)\)/g)].map((match) => match[1]);
  assert.ok(buckets.length >= 2 && buckets.every((name) => /model\.fileBucket\(/.test(name)), `only the itwo buckets: ${buckets.join(" | ")}`);
  const mock = createItwoMock({ stamp: () => "", now: () => NOW, persona: () => PEOPLE.emp, personas: () => [] });
  const called = [...source.matchAll(/rpc\("(app_[a-z_]+)"/g)].map((match) => match[1]);
  const migrations = ["supabase/migrations/20261203010000_itwo_work_orders.sql", "supabase/migrations/20261205010000_itwo_v2_rework_files.sql", "supabase/migrations/20261206010000_itwo_v3_request_info.sql"].map(read).join("\n");
  for (const name of new Set(called)) assert.equal(typeof mock.handlers[name], "function", `${name} exists in the mock`);
  for (const name of new Set(called)) assert.ok(migrations.includes(`function public.${name}(`), `${name} is in a migration`);
  for (const name of ["app_itwo_request_rework", "app_itwo_add_attachment", "app_itwo_request_info", "app_itwo_provide_info", "app_itwo_add_comment_attachment", "app_sandbox_purge_itwo"]) assert.ok(called.includes(name) || source.includes(name), `${name} is used by the module`);
});

// ---------- รุ่น 1.02 (20/11/2026): ผู้อนุมัติขั้น IT ที่ไม่ใช่ผู้ดูแลงาน IT · ป้ายจบงานแล้ว · เวอร์ชัน ----------
const tabLabels = (html) => [...html.matchAll(/class="view-tab[^"]*"[^>]*>([^<]+)</g)].map((match) => match[1].trim());

test("v1.02: the IT approver (not an IT admin) gets approvals and a read-only 'งาน IT' list with no work count, no settings tab, and the card does not count IT work for them", async () => {
  const w = world();
  await approvedOrder(w); // อนุมัติครบ รอ IT เริ่มทำ
  w.as("itapp");
  await w.open("view=it");
  assert.deepEqual(tabLabels(w.html), ["ใบของฉัน", "รออนุมัติ", "งาน IT"], "no settings tab (that is for the IT admin)");
  assert.match(w.html, /data-group="to_start"/, "the approver still sees the whole IT list");
  assert.doesNotMatch(w.html, /itwo-tab-count/, "no IT work count: there is nothing for the approver to do there");
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).badge, "", "the card does not count IT work for the approver");
  w.calls.rpc.length = 0;
  w.context.location.hash = "";
  await w.open("view=settings");
  assert.equal(w.hash, "#/office?module=work-order", "typing the settings URL sends the approver back to 'ใบของฉัน'");
  assert.deepEqual(w.names(), ["app_itwo_my_role"]);
  // เทียบกับผู้ดูแลงาน IT: เห็นตัวเลขงานค้างบนแท็บและการ์ด
  w.as("itadm");
  await w.open("view=it");
  assert.deepEqual(tabLabels(w.html), ["ใบของฉัน", "งาน IT", "ตั้งค่า"]);
  assert.match(w.html, /งาน IT <span class="itwo-tab-count"[^>]*>1<\/span>/);
  assert.equal((await w.context.window.MNP_ITWO.loadCardSummary()).badge, "1 รอคุณ");
});

test("v1.02: the IT approver's buttons are approve / reject / ask at the IT step only; after the approval and while IT works only the IT admin has buttons", async () => {
  const w = world();
  const order = await w.create();
  w.as("mgr");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  w.as("itapp");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["approve", "reject", "request_info"], "at the IT step");
  await w.context.sb.rpc("app_itwo_approve", { p_work_order_id: order.id });
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), [], "approved: the approver cannot start or ask (that is the IT work)");
  w.as("itadm");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["request_info", "start"]);
  await w.context.sb.rpc("app_itwo_start", { p_work_order_id: order.id });
  w.as("itapp");
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), [], "in progress: nothing for the approver");
  const refused = await w.context.sb.rpc("app_itwo_complete", { p_work_order_id: order.id });
  assert.match(refused.error.message, /ผู้ดูแลงาน IT|ส่งงานไม่ได้/, "the RPC refuses a non-admin delivering the work too");
});

test("v1.02: the status 'received' is labelled 'จบงานแล้ว' on the list, the detail, the timeline keeps 'ผู้แจ้งยืนยันรับงาน', the button keeps its label, and the print sheet says จบงานแล้ว", async () => {
  const w = world();
  const order = await closedOrder(w);
  await w.open(`view=order&id=${order.id}`);
  assert.deepEqual(w.buttons(), ["receive", "request_rework"]);
  assert.match(w.html, /ได้รับงานเรียบร้อยแล้ว/, "the confirm button keeps its label");
  await w.click("receive");
  assert.match(visibleText(w.html), /จบงานแล้ว/);
  assert.match(visibleText(w.html), /ผู้แจ้งยืนยันรับงาน/, "the timeline event keeps its wording");
  assert.doesNotMatch(visibleText(w.html), /ได้รับงานแล้ว/, "the old status label is gone");
  await w.open("");
  assert.match(visibleText(w.html), /จบงานแล้ว/, "the list shows the new label");
  const sheet = w.context.window.MNP_ITWO_PAGES.printSheet(w.mock.handlers.app_itwo_get_detail({ p_work_order_id: order.id }));
  assert.match(visibleText(sheet), /สถานะใบสั่งงาน ณ ที่พิมพ์: จบงานแล้ว/);
});

test("v1.02: the module announces its version for the card (the same value shown at the bottom of every page)", async () => {
  const w = world();
  assert.equal(w.context.window.MNP_ITWO.version, w.context.window.MNP_ITWO_MODEL.MODULE_VERSION);
  assert.equal(w.context.window.MNP_ITWO.version, "1.04");
  assert.equal(w.context.window.MNP_OFFICE_CARDS.IT_WORK_ORDER.version, "1.04", "announced to the office menu cards (central mechanism)");
  assert.equal(w.context.window.MNP_OFFICE_CARDS.IT_WORK_ORDER.loadCardSummary, w.context.window.MNP_ITWO.loadCardSummary);
  await w.open("");
  assert.match(w.html, />V1\.04</);
});
