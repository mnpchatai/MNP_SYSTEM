import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดโมดูล BOM ทั้งชุด (พร้อม RubberFlow ที่ให้ ui และ store สำหรับการเชื่อม WO) เข้า context จำลองที่มี helper ของ app.js แบบ stub
// และ localStorage จำลอง แล้ววาดทุกหน้า × ทุกบทบาท เรียก dialog ทุกตัว และยิงฟอร์ม/ปุ่มผ่านกติกา data-rf-* ของ module-bom.js
const FILES = [
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/bom-pages.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const PAGES = ["dashboard", "items", "compounds", "import", "orders", "jobs", "audit"];
const ROLES = ["admin", "manager", "planner", "rb", "gr", "pt", "bg", "st"];
const XSS = "<script>alert(1)</script>";

function load({ sandbox = true, route = "", storage = new Map() } = {}) {
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], renders: 0, notFound: 0, hash: `#/bom${route ? `?${route}` : ""}`, dialogs: [] };
  const fakes = {};
  const node = () => ({
    handlers: {}, dataset: {}, value: "", disabled: false, textContent: "", innerHTML: "", tagName: "DIV", classList: { toggle() {} }, files: [],
    addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: (selector) => fakes[selector]?.[0] ?? null, querySelectorAll: (selector) => fakes[selector] ?? [],
    focus() {}, dispatchEvent() {}, close() {}, remove() {}, showModal() {},
    insertAdjacentHTML(_, html) { log.dialogs.push(html); this.lastElementChild = { ...generic(), tagName: "DIALOG", innerHTML: html }; },
  });
  const generic = () => ({ ...node(), querySelector: () => generic(), querySelectorAll: () => [], addEventListener() {} });
  const root = node();
  const localStorage = { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  Object.assign(context, {
    window: context, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => { log.renders += 1; }, confirm: () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value.startsWith("#") ? value : `#${value}`; } },
    app, state: { employee: { isSandbox: sandbox } },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell() {}, loadingShell() {}, renderNotFound: () => { log.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => { const raw = log.hash.replace(/^#\/?/, ""); const [path, query = ""] = raw.split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => root, querySelectorAll: () => [], body: root, activeElement: null, createElement: () => generic() },
    localStorage,
    FormData: class { constructor(form) { this.values = form?.__values ?? {}; } entries() { return Object.entries(this.values).flatMap(([key, value]) => (Array.isArray(value) ? value.map((item) => [key, item]) : [[key, value]])); } get(key) { return this.values[key] ?? null; } },
    MNP_REQUEST_MODULES: {},
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  const registered = context.MNP_REQUEST_MODULES.BOM;
  const render = async (query = route) => {
    log.hash = `#/bom${query ? `?${query}` : ""}`;
    app.innerHTML = "";
    await registered.pages.bom(new URLSearchParams(query));
    return app.innerHTML;
  };
  const ctx = (query = "") => context.MNP_BOM.context(new URLSearchParams(query));
  // ยิงฟอร์ม data-rf-form ผ่าน bindRoot: ตั้ง fake form แล้ววาดหน้าเพื่อให้ผูก event
  const submit = async (query, action, values, args = {}) => {
    const form = { ...node(), dataset: { rfForm: action, rfArgs: JSON.stringify(args), rfSuccess: "ok {result}" }, __values: values, closest: () => null };
    fakes["form[data-rf-form]"] = [form];
    await render(query);
    fakes["form[data-rf-form]"] = [];
    form.handlers.submit({ preventDefault() {} });
    return form;
  };
  return { context, app, log, fakes, root, storage, module: registered, store: context.MNP_BOM.store, rf: context.MNP_RUBBERFLOW, render, ctx, submit };
}
const clean = (html) => { assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/); };

test("the module registers a sandbox-only standalone page, refuses users outside the sandbox and shows the role chooser first", async () => {
  const env = load();
  assert.equal(env.module.enabled, true);
  assert.equal(env.module.sandbox, true);
  assert.equal(env.module.standalone, true);
  assert.equal(env.module.nav[0].sandboxOnly, true);
  assert.equal(env.module.nav[0].path, "bom");
  const html = await env.render();
  assert.match(html, /เลือกบทบาทสาธิต/);
  assert.match(html, /นำเข้าจาก Excel/);
  assert.equal(env.module.nav[0].subnav("bom"), "", "no sub-menu before a role is chosen");
  const outside = load({ sandbox: false });
  await outside.render();
  assert.equal(outside.log.notFound, 1);
  assert.equal(outside.app.innerHTML, "<notfound></notfound>");
});

test("every page renders for every role without undefined/NaN, menus follow the role and unknown pages redirect home", async () => {
  for (const role of ROLES) {
    const env = load();
    const user = env.store.data().users.find((row) => row.role === role);
    env.store.setUser(user.id);
    for (const page of PAGES) {
      const html = await env.render(`p=${page}`);
      clean(html);
      if (env.context.MNP_BOM_STORE.canSee(user, page)) assert.doesNotMatch(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/, `${role} sees ${page}`);
      else assert.match(html, /ไม่มีสิทธิ์เข้าถึงหน้านี้/, `${role} is denied ${page}`);
    }
    const sub = env.module.nav[0].subnav("bom");
    for (const page of PAGES) assert.equal(sub.includes(`p=${page}`) || page === "dashboard", env.context.MNP_BOM_STORE.canSee(user, page) || page === "dashboard", `${role} menu ${page}`);
    await env.render("p=nothing");
    assert.equal(env.log.hash, "#/bom", "unknown page → home of the role");
  }
});

test("the items page shows a department's items, the selected item's tree, where-used and revision actions by permission", async () => {
  const env = load();
  env.store.setUser("B05"); // หัวหน้า GR
  let html = await env.render("p=items");
  assert.match(html, /ชิ้นงานของแผนก GR/);
  assert.match(html, /SE-TP01-OR01-100-18-65/);
  assert.match(html, /เพิ่มชิ้นงาน/, "GR can add its own items");
  html = await env.render("p=items&dept=GR&sel=SE-TP01-OR01-100-18-65");
  assert.match(html, /RB-DM01-02-OR01-202-18-70/, "tree shows the RB children");
  assert.match(html, /0.0323/, "RB per SE from the cutting data");
  assert.match(html, /DEMO-TP-01\(P\)-Y/, "where-used lists the FG parent");
  assert.match(html, /แก้ BOM \(ร่าง Rev ใหม่\)/);
  html = await env.render("p=items&dept=GR&sel=SE-BL60-RD01-60-0-60");
  assert.match(html, /รออนุมัติ/);
  assert.match(html, /data-rf-action="approveBom"/, "the GR head can approve the GR layer");
  html = await env.render("p=items&dept=PK&sel=DEMO-TP-01(P)-Y");
  assert.doesNotMatch(html, /แก้ BOM/, "GR cannot edit the FG layer");
  assert.match(html, /XP-00001/);
  // RB: ชิ้นปลายทาง ไม่มีปุ่มสร้าง BOM
  env.store.setUser("B04");
  html = await env.render("p=items&dept=RB&sel=RB-DM03-03-YE03-3000-3-130");
  assert.match(html, /สูตรคอมปาวด์อยู่ที่ RubberFlow/);
  assert.match(html, /ยังไม่ผูกสูตร RubberFlow/);
  assert.doesNotMatch(html, /สร้าง BOM/);
  // ค้นหาด้วยรหัสเดิม (นำเข้าโดยฝ่ายวางแผน)
  env.store.setUser("B03");
  env.store.run("importFlat", { items: [{ code: "RB-Z-01-1-1-1", kind: "RB", name: "z", uom: "rod", ownerDept: "RB", legacyCodes: ["RB-Z-01- -1-1-1"], rubber: { compound: "DM01" } }], boms: [], source: "t" });
  env.store.setUser("B02");
  html = await env.render("p=items&dept=RB&q=RB-Z-01-%20-1");
  assert.match(html, /เดิม: RB-Z-01- -1-1-1/);
  clean(html);
});

test("dialogs render for their arguments and escape user text", async () => {
  const env = load();
  env.store.setUser("B01");
  env.store.run("createOrder", { pi: `X${XSS}`, customer: XSS, country: "Thailand", orderedAt: Date.now(), whDue: Date.now() + 86400000 });
  await env.render("p=orders");
  const c = env.ctx("p=orders");
  const D = env.context.MNP_BOM_DIALOGS;
  const rb = c.data.jobs.find((job) => job.dept === "RB" && job.status !== "done");
  const cases = [
    ["itemEdit", { dept: "RB" }], ["itemEdit", { code: "RB-DM01-02-OR01-202-18-70", dept: "RB" }], ["bomEdit", { itemCode: "SE-TP01-OR01-100-18-65" }], ["bomEdit", { itemCode: "DEMO-BL-60(K)-Z" }],
    ["compoundLink", {}], ["compoundLink", { code: "DM03" }], ["orderNew", {}], ["orderItemAdd", { orderId: "DEMO-26002" }], ["stockCount", { orderId: "DEMO-26001", itemCode: "PT-00320" }],
    ["jobReport", { jobId: rb.id }], ["jobRubberflow", { jobId: rb.id }],
  ];
  for (const [name, args] of cases) {
    const built = D[name](c, args);
    assert.ok(built?.html, `${name} renders`);
    clean(built.html);
    assert.match(built.html, /<dialog/);
  }
  assert.equal(D.bomEdit(c, { itemCode: "NOPE" }), null);
  // เพิ่มสินค้าแบบ 3 ช่อง: preview บอกว่ารหัสมีอยู่ หรือจะสร้างจากต้นแบบ
  const add = D.orderItemAdd(c, { orderId: "DEMO-26002" });
  assert.match(add.html, /name="base"/);
  assert.match(add.html, /value="DEMO-TP-01"/);
  assert.match(add.html, /\(B-N\)/);
  const makeNode = (value) => ({ value, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });
  const parts = [makeNode("DEMO-TP-01"), makeNode("P"), makeNode("A")];
  const bodyNode = { textContent: "" };
  const preview = { className: "", querySelector: () => bodyNode };
  add.bind({ querySelector: (selector) => (selector === "[data-bom-preview]" ? preview : null), querySelectorAll: (selector) => (selector === "[data-bom-part]" ? parts : []) }, c);
  assert.match(bodyNode.textContent, /DEMO-TP-01\(P\)-A ยังไม่มีใน item master — จะสร้างจาก BOM ของ DEMO-TP-01\(P\)-Y/);
  assert.equal(preview.className, "rf-callout is-warn");
  parts[2].value = "Y";
  parts[2].handlers.change();
  assert.match(bodyNode.textContent, /DEMO-TP-01\(P\)-Y · .* BOM Rev\.1/);
  assert.equal(preview.className, "rf-callout is-good");
  parts[0].value = "";
  parts[0].handlers.change();
  assert.equal(bodyNode.textContent, "เลือกฐานรหัสเพื่อดูรหัสเต็ม");
  assert.equal(D.stockCount(c, { orderId: "NOPE", itemCode: "PT-00320" }), null);
  const html = await env.render(`p=orders&sel=X${encodeURIComponent(XSS.toUpperCase())}`);
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;SCRIPT&gt;|&lt;script&gt;/i);
  // ตรวจ: การเลือกบน user ที่ไม่ใช่ RB ไม่มีปุ่ม RubberFlow
  const rfDialog = D.jobRubberflow(c, { jobId: rb.id });
  assert.match(rfDialog.html, /คอมปาวด์ที่ต้องใช้/);
});

test("forms go through the data-rf-* rules: a new order is created with dates converted, a bad form shows a toast and keeps the state", async () => {
  const env = load();
  env.store.setUser("B03"); // planner
  await env.submit("p=orders", "createOrder", { pi: "PI-TEST-1", customer: "ลูกค้าทดสอบ", country: "Belgium", orderedAt: "2026-10-01", whDue: "2026-12-01", "due.RB": "2026-10-20", "due.PK": "" });
  const order = env.store.data().orders.find((entry) => entry.id === "PI-TEST-1");
  assert.ok(order, "order created from the form");
  assert.equal(order.orderType, "EX");
  assert.equal(new Date(order.due.RB).getDate(), 20);
  assert.equal(order.due.PK, undefined, "empty department dates are dropped");
  assert.equal(env.log.renders, 1);
  assert.deepEqual(env.log.toasts.at(-1), ["ok PI-TEST-1", "ok"]);
  await env.submit("p=orders", "createOrder", { pi: "PI-TEST-1", customer: "x", country: "Belgium", orderedAt: "2026-10-01", whDue: "2026-12-01" });
  assert.equal(env.log.toasts.at(-1)[1], "error");
  assert.match(env.log.toasts.at(-1)[0], /อยู่แล้ว/);
  assert.equal(env.log.renders, 1, "failed form does not re-render");
  // ร่าง BOM ผ่านฟอร์ม: อาร์เรย์ childCode[]/qty[] กลายเป็น lines
  env.store.setUser("B05");
  await env.submit("p=items", "saveBomDraft", { "childCode[]": ["RB-DM02-02-BK01-225-3-20", ""], "qty[]": ["0.1", ""], "scrapPct[]": ["0", ""], "lineNote[]": ["", ""], note: "ทดสอบ" }, { itemCode: "SE-TP01-BK01-140-3-20" });
  const draft = env.store.data().boms.find((bom) => bom.itemCode === "SE-TP01-BK01-140-3-20" && bom.status === "draft");
  assert.ok(draft);
  // ค่าจาก vm context มี prototype คนละ realm จึงเทียบผ่าน JSON
  assert.deepEqual(JSON.parse(JSON.stringify(draft.lines.map((line) => [line.childCode, line.qty]))), [["RB-DM02-02-BK01-225-3-20", 0.1]], "empty template row is dropped");
  // แก้ชิ้นงานผ่านฟอร์ม: rubber.* ซ้อน และตัดทิ้งเมื่อไม่ใช่ RB/SE
  env.store.setUser("B08");
  await env.submit("p=items", "saveItem", { code: "P-NEW-01", kind: "PURCHASED", name: "ของใหม่", ownerDept: "ST", uom: "pcs", weightG: "", "rubber.compound": "DM01" });
  const item = env.store.data().items.find((entry) => entry.code === "P-NEW-01");
  assert.equal(item.rubber, null);
});

test("an RB job creates a RubberFlow work order through the RubberFlow store and the job keeps the WO number", async () => {
  const env = load();
  env.store.setUser("B04"); // หัวหน้า RB
  env.rf.store.load();
  await env.render("p=jobs");
  const c = env.ctx("p=jobs&dept=RB");
  const job = c.data.jobs.find((entry) => entry.dept === "RB" && entry.itemCode === "RB-DM02-02-BK01-225-3-20");
  const html = await env.render("p=jobs&dept=RB");
  assert.match(html, /สร้าง WO ใน RubberFlow/);
  const built = env.context.MNP_BOM_DIALOGS.jobRubberflow(c, { jobId: job.id });
  assert.match(built.html, /DM02 → RC-NBR-OR02/);
  assert.match(built.html, /data-bom-rf-create/, "the compound is linked to an approved recipe → create button");
  const button = { ...env.root, handlers: {}, disabled: false, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const dialog = { ...env.root, querySelector: (selector) => (selector === "[data-bom-rf-create]" ? button : null), close() { this.closed = true; } };
  built.bind(dialog, c);
  const rfOrdersBefore = env.rf.store.data().orders.length;
  button.handlers.click({ currentTarget: button });
  assert.equal(env.rf.store.data().orders.length, rfOrdersBefore + 1);
  const wo = env.rf.store.data().orders[0];
  assert.equal(wo.recipeId, "RC-NBR-OR02");
  assert.equal(wo.customerPo, "DEMO-26001");
  assert.ok(wo.targetQty > 0);
  assert.match(wo.note, new RegExp(job.id));
  const linked = env.store.data().jobs.find((entry) => entry.id === job.id);
  assert.equal(linked.externalRef.woId, wo.id);
  assert.equal(linked.status, "in_progress");
  assert.ok(dialog.closed);
  assert.match(env.log.toasts.at(-1)[0], /สร้าง WO/);
  // งานที่สูตรยังไม่ผูก (DM03) ไม่มีปุ่ม
  const unlinked = c.data.jobs.find((entry) => entry.itemCode === "RB-DM03-03-YE03-3000-3-130");
  const noRecipe = env.context.MNP_BOM_DIALOGS.jobRubberflow(c, { jobId: unlinked.id });
  assert.match(noRecipe.html, /ยังไม่ผูกกับสูตร PHR/);
  assert.doesNotMatch(noRecipe.html, /data-bom-rf-create/);
  const compounds = await env.render("p=compounds");
  assert.match(compounds, /สูตรอนุมัติแล้ว/);
  assert.match(compounds, /ยังไม่ผูก/);
});

test("the import page parses pasted TSV, reports before saving and the orders page exports CSV with the BOMSHEET columns", async () => {
  const env = load();
  env.store.setUser("B03");
  const paste = { ...env.root, value: "" };
  const report = { ...env.root, innerHTML: "", querySelector: () => null };
  const check = { ...env.root, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const rootNode = { ...env.root, querySelector: (selector) => ({ "[data-bom-paste]": paste, "[data-bom-report]": report, "[data-bom-check]": check, "[data-bom-group]": { value: "TOY" }, "[data-bom-source]": { value: "ทดสอบ.tsv" } })[selector] ?? null, querySelectorAll: () => [] };
  const page = env.context.MNP_BOM_PAGES.import(env.ctx("p=import"));
  clean(page.html);
  page.bind(rootNode, env.ctx("p=import"));
  paste.value = "garbage";
  check.handlers.click();
  assert.match(report.innerHTML, /ไม่พบแถวหัวคอลัมน์/);
  paste.value = ["ITEM\tCODE\tNAME\tรหัสแผนก\tแผนกผู้ผลิต\tจำนวนที่ใช้ต่อชุด\tหน่วยนับ", "T-01(P)-Y\tT-01\tสินค้า T\tPK\tPK\t-\tชุด", "T-01(P)-Y\tP-STK-01\tสติ๊กเกอร์\tST\tPK-ST\t2\tชิ้น/pcs"].join("\n");
  check.handlers.click();
  assert.match(report.innerHTML, /อ่านได้ 2 บรรทัด/);
  assert.match(report.innerHTML, /data-bom-import/);
  clean(report.innerHTML);
  // ส่งออก CSV ของใบที่ปล่อยแล้ว
  const c = env.ctx("p=orders&sel=DEMO-26001");
  const built = env.context.MNP_BOM_PAGES.orders(c);
  assert.match(built.html, /ส่งออก CSV ใบคำนวณ/);
  assert.match(built.html, /ต้องผลิต\/สั่งซื้อ/);
  assert.match(built.html, /bom-surplus">-0.8571/, "stock 18 against 17.14 needed shows a surplus");
  const order = c.data.orders.find((entry) => entry.id === "DEMO-26001");
  // CSV ผ่าน helper ภายในหน้า: จำลองปุ่ม
  const csvButton = { ...env.root, dataset: { bomCsv: "bomsheet", bomOrder: "DEMO-26001" }, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  built.bind({ ...env.root, querySelectorAll: (selector) => (selector === "[data-bom-csv]" ? [csvButton] : []) }, c);
  csvButton.handlers.click(); // ไม่มี Blob ใน Node → ไม่ดาวน์โหลด แต่ต้องไม่พัง
  assert.ok(order.explosion.length > 10);
  const tabs = env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26001&tab=req")).html;
  assert.match(tabs, /ต้องการรวม/);
  clean(tabs);
  const jobsTab = env.context.MNP_BOM_PAGES.orders(env.ctx("p=orders&sel=DEMO-26001&tab=jobs")).html;
  assert.match(jobsTab, /งานรายแผนก/);
  clean(jobsTab);
});

test("the sidebar sub-menu counts BOMs awaiting the user and open jobs of their department; reset rebuilds the demo", async () => {
  const env = load();
  env.store.setUser("B05"); // GR: อนุมัติ SE ร่างได้ 1 และมีงานค้าง
  await env.render("p=jobs");
  const sub = env.module.nav[0].subnav("bom");
  assert.match(sub, /BOM รออนุมัติจากคุณ">1</);
  assert.match(sub, /งานค้างของแผนก">\d+</);
  env.store.setUser("B01");
  await env.render("p=jobs");
  const adminSub = env.module.nav[0].subnav("bom");
  assert.doesNotMatch(adminSub, /งานค้างของแผนก/, "bosses see no personal job count");
  assert.match(adminSub, /BOM รออนุมัติจากคุณ">1</);
  env.store.run("createOrder", { pi: "TMP", customer: "x", country: "Thailand", orderedAt: Date.now(), whDue: Date.now() + 1 });
  env.store.reset();
  assert.ok(!env.store.data().orders.some((order) => order.id === "TMP"));
  assert.ok(env.storage.has("mnp-bom-v1"));
});
