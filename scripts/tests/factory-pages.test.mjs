import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { ATTACHMENT_STUBS } from "./support/factory-attachment-stubs.mjs";

// โหลด modules/module-factory.js (ตัวจัดหน้า #/factory: หน้ารวม หน้าแผนก หน้ารายการใน Item master) พร้อมโมดูลย่อยทั้งหมดเข้า context จำลอง
// ที่มีฟังก์ชันของ app.js แบบ stub แล้วเรียกหน้าจริง ตรวจ HTML ที่ใส่ลงในแอป — ครอบคลุมการต่อ view "overview" / "department" / รายการเมนู
const FILES = [
  "modules/factory-departments.js",
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/factory-board-model.js",
  "modules/factory-gantt-model.js",
  "modules/module-factory-master.js",
  "modules/factory-attachments.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
  "modules/module-factory-gantt.js",
  "modules/module-factory-board.js",
  "modules/module-factory.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const item = (id, code, type, procurement, stock = 0, min = 0, unit = "KG") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, min_stock: min, unit_code: unit, status: "active", brand: "MNP" });
const DATA = {
  units: [], categories: [],
  items: [item("fg", "FG-1", "FG", "make", 0, 0, "SET"), item("rm", "RM-1", "RM", "buy", 1, 50)],
  boms: [], bom_lines: [], routings: [], steps: [], warehouses: [], inventory: [], history: [], bom_history: [],
  production: [{ id: "wo", code: "MO-1", status: "submitted", item_id: "fg", item_code: "FG-1", name: "สินค้า", unit_code: "SET", planned_qty: 12, completed_qty: 0 }],
  production_history: [], material_orders: [], material_history: [],
  jobs: [{ id: "j1", code: "JB-1", status: "open", production_order_id: "wo", item_id: "fg", item_code: "FG-1", item_name: "สินค้า", unit_code: "SET", qty: 12, production_code: "MO-1", created_at: "2026-10-07T01:00:00Z",
    steps: [{ sequence: 10, name: "RB-01", department_code: "RB", work_center_code: "RB", status: "pending" }] }],
  job_history: [],
};

// route: { params: URLSearchParams } sandbox: true = โหมดทดสอบ
function load({ sandbox = true, route = "" } = {}) {
  const calls = { notFound: 0, bound: 0, loading: [] };
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const params = new URLSearchParams(route);
  Object.assign(context, {
    ...ATTACHMENT_STUBS,
    window: context,
    escapeHtml, formatDate: (value) => String(value ?? "—"), showToast() {}, friendlyError: String, setFormBusy() {}, renderRoute: async () => {}, confirm: () => true,
    CSS: { escape: (value) => value }, URLSearchParams, Intl, Date, location: { hash: "" }, FormData: class {},
    app, state: { employee: { isSandbox: sandbox, department: { code: "PP" } } },
    shell: (content, path, title) => `<shell path="${path}" title="${escapeHtml(title)}">${content}</shell>`,
    bindShell: () => { calls.bound += 1; },
    loadingShell: (path, title) => { calls.loading.push([path, title]); app.innerHTML = `<loading title="${escapeHtml(title)}"></loading>`; },
    renderNotFound: () => { calls.notFound += 1; app.innerHTML = "<notfound></notfound>"; },
    currentRoute: () => ({ path: "factory", params }),
    document: { querySelector: () => ({ querySelector: () => null, querySelectorAll: () => [] }), querySelectorAll: () => [] },
    sb: { rpc: async () => ({ data: DATA, error: null }) },
    MNP_REQUEST_MODULES: {},
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return { context, app, calls, params };
}
const page = async (route, options = {}) => {
  const env = load({ route, ...options });
  await env.context.MNP_REQUEST_MODULES.FACTORY.pages.factory(env.params);
  return env;
};

test("the module registers a sandbox-only page and navigation entry", () => {
  const { context } = load();
  const registered = context.MNP_REQUEST_MODULES.FACTORY;
  assert.equal(registered.enabled, true);
  assert.equal(registered.sandbox, true);
  assert.equal(registered.nav[0].sandboxOnly, true);
  assert.equal(typeof registered.pages.factory, "function");
});

test("outside test mode the factory page is not found and nothing is loaded", async () => {
  const { calls, app } = await page("", { sandbox: false });
  assert.equal(calls.notFound, 1);
  assert.equal(app.innerHTML, "<notfound></notfound>");
});

test("the overview page draws the production board above the department cards, with the waiting counts on the cards", async () => {
  const { app, calls } = await page("");
  assert.deepEqual(JSON.parse(JSON.stringify(calls.loading)), [["factory", "ฝ่ายโรงงาน"]], "a loading page is shown while the data loads");
  assert.match(app.innerHTML, /^<shell path="factory" title="ฝ่ายโรงงาน">/);
  assert.match(app.innerHTML, /<span>ใบสั่งผลิตทั้งหมด<\/span><strong>1<\/strong>/);
  assert.ok(app.innerHTML.indexOf("ใบสั่งผลิตทั้งหมด") < app.innerHTML.indexOf("เลือกแผนก"), "the board comes before the department cards");
  assert.match(app.innerHTML, /href="#\/factory\?dept=PP"[^>]*>[\s\S]*?1 งานรอลงมือ · เปิดแผนก →/, "planning: the submitted order is waiting");
  assert.match(app.innerHTML, /href="#\/factory\?dept=RB"[^>]*>[\s\S]*?1 งานรอลงมือ · เปิดแผนก →/, "RB: the open job reached the department");
  assert.match(app.innerHTML, /href="#\/factory\?dept=GR"[^>]*>[\s\S]*?<small>เปิดแผนก →<\/small>/, "a department with nothing waiting keeps the plain text");
  assert.ok(app.innerHTML.includes("เมนูโรงงาน"), "the factory menu card is still there");
});

test("a department page shows the queue of that department inside the department frame", async () => {
  const { app } = await page("dept=RB");
  assert.match(app.innerHTML, /title="ฝ่ายโรงงาน \/ RB ขึ้นรูปยาง"/);
  assert.match(app.innerHTML, /ถึงคิวแผนก RB <span class="muted small">\(1\)<\/span>/);
  assert.match(app.innerHTML, /JB-1/);
  assert.match(app.innerHTML, /aria-label="สลับแผนกฝ่ายโรงงาน"/, "the department tabs are kept");
  assert.doesNotMatch(app.innerHTML, /ยังไม่มีแบบฟอร์มหรือขั้นตอนงานของแผนกนี้/, "the empty placeholder is gone");
  const planning = await page("dept=PP");
  assert.match(planning.app.innerHTML, /งานของฝ่ายวางแผน/);
});

test("an unknown department or item falls back to the overview instead of an empty page", async () => {
  for (const route of ["dept=ZZ", "item=nope", "dept=<script>"]) {
    const { app } = await page(route);
    assert.match(app.innerHTML, /<span>ใบสั่งผลิตทั้งหมด<\/span>/, route);
    assert.doesNotMatch(app.innerHTML, /<script>/, route);
  }
});

test("a menu entry draws its view inside the entry frame and an entry without a view stays an empty placeholder", async () => {
  const jobs = await page("item=job-view");
  assert.match(jobs.app.innerHTML, /JB-1/);
  assert.match(jobs.app.innerHTML, /ใบงานผลิต-ดู/);
  const production = await page("item=production-planning");
  assert.match(production.app.innerHTML, /MO-1/);
  const noView = await page("item=price-folder-entry");
  assert.match(noView.app.innerHTML, /<span>ใบสั่งผลิตทั้งหมด<\/span>/, "an unknown key falls back to the overview");
});

test("without the overview view the page keeps working as the plain department cards", async () => {
  const env = load({ route: "" });
  delete env.context.MNP_FACTORY_VIEWS.overview;
  await env.context.MNP_REQUEST_MODULES.FACTORY.pages.factory(env.params);
  assert.match(env.app.innerHTML, /เลือกแผนก/);
  assert.doesNotMatch(env.app.innerHTML, /ใบสั่งผลิตทั้งหมด/);
  assert.match(env.app.innerHTML, /<small>เปิดแผนก →<\/small>/);
});

test("factory navigation hides empty folders and retains every existing document link", () => {
  const { context } = load({route: "item=job-view"});
  const html = context.MNP_REQUEST_MODULES.FACTORY.nav[0].subnav("factory");
  const folders = context.MNP_FACTORY_ITEM_MASTER.FOLDERS;
  const populated = folders.filter(folder => folder.entries.length);
  assert.equal((html.match(/class="factory-folder"/g) ?? []).length, populated.length);
  for (const folder of folders) {
    for (const entry of folder.entries) assert.ok(html.includes("item=" + entry.key));
    if (!folder.entries.length) assert.ok(!html.includes("<span>" + folder.name + "</span>"));
  }
  assert.match(html, /<summary>เมนูโรงงาน<\/summary>/);
});
