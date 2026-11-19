import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// ชิ้นส่วนกลางของโมดูลโรงงาน (modules/factory-kit.js → window.MNP_FACTORY): ตัวผูก event, การ์ดงาน, dialog รายงานผล, ป้ายแผนก
// ส่วนที่ไม่ต้องใช้ BOM ทดสอบในบริบทเล็ก ส่วนที่ต้องมีข้อมูล BOM ทดสอบกับชุดไฟล์ BOM เต็ม และตรวจว่า BOM ใช้ชิ้นส่วนกลางจริง ไม่เหลือสำเนา

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const FormDataFake = class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])); } get(key) { return this.values[key] ?? null; } };

function loadKit(extra = {}) {
  const log = { toasts: [], confirms: [], hash: "" };
  const context = vm.createContext({});
  Object.assign(context, {
    window: context, escapeHtml, FormData: FormDataFake, URLSearchParams,
    showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    confirmDialog: async (options) => { log.confirms.push(options); return true; },
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value; } },
    ...extra,
  });
  vm.runInContext(fs.readFileSync("modules/factory-kit.js", "utf8"), context, { filename: "modules/factory-kit.js" });
  return { context, log, kit: context.MNP_FACTORY };
}

const fakeNode = (props = {}) => ({ handlers: {}, dataset: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; }, closest: () => null, querySelectorAll: () => [], ...props });
const fakeRoot = (map) => ({ querySelectorAll: (selector) => map[selector] ?? [] });
const stubUi = { validateForm: () => true, confirmOptions: (node) => ({ title: node.dataset.rfConfirm }) };

test("MNP_FACTORY exports the shared pieces and is frozen", () => {
  const { kit } = loadKit();
  assert.deepEqual(Object.keys(kit).sort(), ["FACTORY_GROUP", "actionLink", "attr", "bindRoot", "canOpenDeptModule", "canSeeDept", "deptChip", "deptCtx", "deptWorkSection", "dueText", "esc", "failed", "formPayload", "includesText", "jobCard", "jobReportDialog", "limited", "mountDeptJobs", "onDeptRoute", "orderNavItems", "pageHead", "parseArgs", "productionLanding", "registerDeptModule", "routeUrl", "rubberflowFailed", "searchForm", "wake"]);
  assert.ok(Object.isFrozen(kit));
  assert.equal(kit.esc("<b>"), "&lt;b&gt;");
  assert.equal(kit.attr(null), "");
});

test("file load does not touch app.js helpers (only inside functions)", () => {
  assert.doesNotThrow(() => vm.runInContext(fs.readFileSync("modules/factory-kit.js", "utf8"), vm.createContext({ window: {} })));
});

test("formPayload builds nested objects and lists, parseArgs survives bad JSON", () => {
  const { kit } = loadKit();
  const form = { __values: { name: "a", "line.qty": "3", "ids[]": ["x", "y"] } };
  assert.deepEqual(JSON.parse(JSON.stringify(kit.formPayload(form))), { name: "a", line: { qty: "3" }, ids: ["x", "y"] });
  assert.deepEqual(JSON.parse(JSON.stringify(kit.parseArgs({ dataset: { rfArgs: '{"a":1}' } }))), { a: 1 });
  assert.deepEqual(Object.keys(kit.parseArgs({ dataset: { rfArgs: "{bad" } })), []);
  assert.deepEqual(Object.keys(kit.parseArgs({ dataset: {} })), []);
});

test("deptChip shows the code, a title from the labels and one colour hook per department", () => {
  const { kit } = loadKit();
  assert.equal(kit.deptChip("RB", { RB: "RB · ยางผสม" }), '<span class="bom-dept" data-dept="RB" title="RB · ยางผสม">RB</span>');
  assert.equal(kit.deptChip("QA"), '<span class="bom-dept" data-dept="QA" title="QA">QA</span>');
  assert.match(kit.deptChip('"><x>'), /&quot;&gt;&lt;x&gt;/);
  const css = fs.readFileSync("styles.css", "utf8");
  for (const dept of ["ST", "RB", "GR", "PT", "BG", "PK", "SR", "QA", "WH", "PP", "SA"]) assert.match(css, new RegExp(`\\.bom-dept\\[data-dept="${dept}"\\] \\{ --dc: #[0-9a-f]{6}; \\}`), `${dept} has its colour`);
});

test("bindRoot: a data-rf-action click and a data-rf-form submit reach opts.run with merged args; open / go / search work", async () => {
  const { kit, log } = loadKit();
  const calls = [];
  const renders = [];
  const opened = [];
  const button = fakeNode({ dataset: { rfAction: "setJobStatus", rfArgs: '{"jobId":"J1"}', rfSuccess: "ok" } });
  const confirmed = fakeNode({ dataset: { rfAction: "close", rfArgs: "{}", rfConfirm: "sure" } });
  let dialogClosed = false;
  const submitBtn = fakeNode();
  const form = fakeNode({ dataset: { rfForm: "reportJob", rfArgs: '{"jobId":"J1","qtyDone":"9"}', rfSuccess: "saved {result}" }, __values: { qtyDone: "4", note: "n" }, closest: () => ({ close: () => { dialogClosed = true; } }), querySelectorAll: () => [submitBtn] });
  const openBtn = fakeNode({ dataset: { rfOpen: "jobReport", rfArgs: '{"jobId":"J2"}' } });
  const goBtn = fakeNode({ dataset: { rfGo: "#/bom?p=work" } });
  const search = fakeNode({ __values: { q: "  abc  " } });
  const root = fakeRoot({ "form[data-rf-form]": [form], "[data-rf-action]": [button, confirmed], "[data-rf-open]": [openBtn], "[data-rf-go]": [goBtn], "form[data-rf-search]": [search] });
  const ctx = { pageUrl: ({ q }) => `#/bom?q=${q}` };
  kit.bindRoot(root, ctx, {
    ui: stubUi,
    run: (name, payload, successText, after) => { calls.push({ name, payload: JSON.parse(JSON.stringify(payload)), successText, after }); return true; },
    transforms: { reportJob: (raw) => ({ ...raw, qtyDone: Number(raw.qtyDone) }) },
    openDialog: (name, args, c) => opened.push([name, JSON.parse(JSON.stringify(args)), c === ctx]),
    rerender: () => renders.push(1),
  });
  await button.handlers.click();
  assert.deepEqual(calls[0], { name: "setJobStatus", payload: { jobId: "J1" }, successText: "ok", after: null });
  assert.equal(button.disabled, true);
  await confirmed.handlers.click();
  assert.equal(log.confirms.length, 1, "data-rf-confirm asks once");
  assert.equal(calls.length, 2);
  await form.handlers.submit({ preventDefault() {} });
  assert.deepEqual(calls[2], { name: "reportJob", payload: { qtyDone: 9, note: "n", jobId: "J1" }, successText: "saved {result}", after: null }, "form values merged with data-rf-args (args win), then transformed");
  assert.equal(dialogClosed, true);
  assert.equal(submitBtn.disabled, true);
  assert.equal(renders.length, 3);
  openBtn.handlers.click();
  assert.deepEqual(opened, [["jobReport", { jobId: "J2" }, true]]);
  goBtn.handlers.click();
  assert.equal(log.hash, "#/bom?p=work");
  search.handlers.submit({ preventDefault() {} });
  assert.equal(log.hash, "#/bom?q=abc");
});

test("bindRoot: validation, a refused run, the beforeSubmit hook and transform errors", async () => {
  const { kit, log } = loadKit();
  const calls = [];
  const renders = [];
  const make = (ui, run, extra = {}) => {
    const form = fakeNode({ dataset: { rfForm: "x" }, __values: {}, querySelectorAll: () => [] });
    kit.bindRoot(fakeRoot({ "form[data-rf-form]": [form] }), {}, { ui, run, rerender: () => renders.push(1), ...extra });
    return form;
  };
  await make({ ...stubUi, validateForm: () => false }, () => { calls.push("run"); return true; }).handlers.submit({ preventDefault() {} });
  assert.equal(calls.length, 0, "invalid form is not sent");
  await make(stubUi, () => false).handlers.submit({ preventDefault() {} });
  assert.equal(renders.length, 0, "a refused run does not re-render");
  await make(stubUi, (name, payload, text, after) => { calls.push([payload, after]); return Promise.resolve(true); }, { beforeSubmit: () => ({ payload: { p: 1 }, after: "A" }) }).handlers.submit({ preventDefault() {} });
  assert.deepEqual(calls, [[{ p: 1 }, "A"]], "the hook replaces payload and supplies after; an async run is awaited");
  assert.equal(renders.length, 1);
  await make(stubUi, () => { calls.push("never"); return true; }, { beforeSubmit: () => false }).handlers.submit({ preventDefault() {} });
  assert.equal(calls.length, 1, "hook false = not sent");
  await make(stubUi, () => true, { transforms: { x: () => { throw new Error("bad value"); } } }).handlers.submit({ preventDefault() {} });
  assert.deepEqual(log.toasts.at(-1), ["bad value", "error"]);
});

// ---------- ส่วนที่ใช้ข้อมูล BOM ----------
const FILES = [
  "modules/ui-icons.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/factory-kit.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
];
function loadBom() {
  const context = vm.createContext({});
  const storage = new Map();
  const generic = () => ({ dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, close() {}, remove() {}, showModal() {}, innerHTML: "" });
  const app = { innerHTML: "" };
  Object.assign(context, {
    window: context, addEventListener() {}, escapeHtml, showToast() {}, friendlyError: (error) => String(error?.message ?? error), renderRoute: async () => {}, confirmDialog: async () => true,
    URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { hash: "#/bom" }, app, state: { employee: { isSandbox: true } },
    shell: (content) => content, bindShell() {}, loadingShell() {}, renderNotFound() {}, currentRoute: () => ({ path: "bom", params: new URLSearchParams("") }),
    document: { querySelector: () => generic(), querySelectorAll: () => [], body: generic(), activeElement: null, createElement: generic },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    FormData: FormDataFake, MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, store: context.MNP_BOM.store, ctx: (query = "p=work") => context.MNP_BOM.context(new URLSearchParams(query)) };
}

function releasedRbJob(env) {
  env.store.setUser("B01");
  const c = env.ctx();
  const job = c.data.jobs.find((entry) => entry.dept === "RB" && entry.status !== "done" && ["released", "in_progress"].includes(c.data.orders.find((order) => order.id === entry.orderId)?.status));
  assert.ok(job, "the demo data has an open RB job on a released order");
  return job;
}

test("jobCard renders a production job with buttons, and the same card read-only with actions:false", () => {
  const env = loadBom();
  const job = releasedRbJob(env);
  const rbUser = env.store.data().users.find((row) => row.role === "rb");
  env.store.setUser(rbUser.id);
  const c = env.ctx();
  const kit = env.context.MNP_FACTORY;
  const full = kit.jobCard(c, job, { planner: false, dept: "RB", show: "open" });
  assert.match(full, /^<article class="card rf-card bom-job/);
  assert.match(full, new RegExp(escapeHtml(job.name).replaceAll("(", "\\(").replaceAll(")", "\\)")));
  assert.match(full, /data-rf-open="jobReport"/, "report button present");
  assert.match(full, /data-rf-open="jobHold"/, "hold button present");
  const readOnly = kit.jobCard(c, job, { planner: false, dept: "RB", show: "open", actions: false });
  assert.match(readOnly, /^<article class="card rf-card bom-job/);
  assert.doesNotMatch(readOnly, /<button|data-rf-open|data-rf-action|bom-job-more|bom-job-main/, "read-only card has no buttons");
  assert.match(readOnly, /bom-job-amount/, "same amount block");
  // ฝ่ายวางแผนดูทุกแผนก: มีป้ายแผนกหน้ารหัสชิ้นงาน
  env.store.setUser("B03");
  const planner = kit.jobCard(env.ctx(), job, { planner: true, dept: "ALL", show: "open", actions: false });
  assert.match(planner, /<span class="bom-dept" data-dept="RB"/);
  assert.doesNotMatch(kit.jobCard(env.ctx(), job, { planner: true, dept: "RB", show: "open", actions: false }), /bom-dept/);
});

test("BOM uses the shared pieces and keeps no second copy", () => {
  const env = loadBom();
  const job = releasedRbJob(env);
  const c = env.ctx();
  const viaBom = env.context.MNP_BOM_DIALOGS.jobReport(c, { jobId: job.id });
  const viaKit = env.context.MNP_FACTORY.jobReportDialog(c, { jobId: job.id });
  assert.ok(viaBom?.html);
  assert.equal(viaBom.html, viaKit.html, "the BOM dialog is the shared one");
  assert.match(viaBom.html, /data-rf-form="reportJob"/);
  assert.equal(env.context.MNP_BOM_DIALOGS.jobReport(c, { jobId: "NOPE" }), null);
  const moduleBom = fs.readFileSync("modules/module-bom.js", "utf8");
  assert.doesNotMatch(moduleBom, /function formPayload|function parseArgs|\.rfForm\b|\[data-rf-action\]"\)\.forEach/, "module-bom.js only wraps the shared binder");
  assert.match(moduleBom, /MNP_FACTORY\.bindRoot\(/);
  const hub = fs.readFileSync("modules/bom-hub.js", "utf8");
  assert.doesNotMatch(hub, /JOB_TONE|rodIssueNeeds\(data, job\.orderId\)|const canWork = ctx\.helpers\.canWorkJob/, "the production job card lives in factory-kit.js");
  assert.match(hub, /MNP_FACTORY\.jobCard\(/);
  assert.match(hub, /MNP_FACTORY\.deptChip\(/);
  const pages = fs.readFileSync("modules/bom-pages.js", "utf8");
  assert.match(pages, /MNP_FACTORY\.jobReportDialog\(/);
  assert.doesNotMatch(pages, /id="bom-job-form"/);
});

test("the work page still renders the shared job card for the department", async () => {
  const env = loadBom();
  const job = releasedRbJob(env);
  const rbUser = env.store.data().users.find((row) => row.role === "rb");
  env.store.setUser(rbUser.id);
  const built = await env.context.MNP_BOM_PAGES.work(env.ctx("p=work"));
  assert.match(built.html, /<article class="card rf-card bom-job/);
  assert.ok(built.html.includes(escapeHtml(job.name)) || /bom-job/.test(built.html));
});

test("index.html loads factory-kit.js before bom-pages.js and every ?v= is the same", () => {
  const html = fs.readFileSync("index.html", "utf8");
  const kit = html.indexOf('modules/factory-kit.js?v=');
  assert.ok(kit > 0 && kit < html.indexOf("modules/bom-pages.js?v="));
  const versions = new Set([...html.matchAll(/(?:modules\/[\w-]+\.js|app\.js|styles\.css)\?v=([\w-]+)/g)].map((match) => match[1]));
  assert.equal(versions.size, 1);
});
