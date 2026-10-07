import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

// โหลดไฟล์หน้าภาพรวมการผลิต (script ธรรมดาใน browser) เข้า context จำลอง แล้วเรียก view จริงด้วยข้อมูลจำลอง
// ตรวจ HTML ที่วาด ตัวเลข ลิงก์ และข้อมูลที่ส่งให้การ์ดแผนก (ไม่มี DOM จริง การตรวจเต็มรูปแบบทำกับ app.js ใน browser)
const FILES = [
  "modules/factory-departments.js",
  "modules/factory-item-master.js",
  "modules/factory-master-model.js",
  "modules/factory-production-model.js",
  "modules/factory-material-model.js",
  "modules/factory-job-model.js",
  "modules/factory-board-model.js",
  "modules/module-factory-master.js",
  "modules/module-factory-bom.js",
  "modules/module-factory-production.js",
  "modules/module-factory-material.js",
  "modules/module-factory-job.js",
  "modules/module-factory-board.js",
];

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const item = (id, code, type, procurement, stock = 0, min = 0, unit = "KG") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, min_stock: min, unit_code: unit, status: "active", brand: "MNP" });
const order = (id, code, status, extra = {}) => ({ id, code, status, item_id: "fg", item_code: "FG-1", name: "สินค้า", unit_code: "SET", planned_qty: 12, completed_qty: 0, ...extra });
const step = (sequence, department, status = "pending") => ({ sequence, name: `ขั้น ${sequence / 10}`, department_code: department, work_center_code: department, status });
const FIXTURE = {
  items: [item("fg", "FG-1", "FG", "make", 0, 0, "SET"), item("part", "WIP-PART", "WIP", "make", 0, 0, "PCS"), item("nr", "RM-NR<b>", "RM", "buy", 1, 50)],
  boms: [{ id: "b-fg", item_id: "fg", output_qty: 12, status: "approved", revision: "A" }, { id: "b-part", item_id: "part", output_qty: 100, status: "approved", revision: "A" }],
  bom_lines: [{ bom_id: "b-fg", line_no: 1, component_id: "part", quantity: 12, scrap_percent: 0 }, { bom_id: "b-part", line_no: 1, component_id: "nr", quantity: 40, scrap_percent: 0 }],
  production: [order("o-sub", "MO-3", "submitted"), order("wo-rel", "MO-6", "released")],
  material_orders: [], jobs: [{ id: "j1", code: "JB-1", status: "open", production_order_id: "wo-rel", item_id: "part", qty: 12, created_at: "2026-10-07T01:00:00Z", steps: [step(10, "RB"), step(20, "SR")] }],
  production_history: [{ id: 1, order_id: "wo-rel", code: "MO-6", action: "release", created_at: "2026-10-07T02:00:00Z", changed_by_name: "ทดสอบ <i>x</i>", note: "" }],
  material_history: [], job_history: [],
};

function loadFactory(data = FIXTURE) {
  const context = vm.createContext({});
  context.window = context;
  Object.assign(context, {
    escapeHtml, formatDate: (value, withTime) => `d(${value ?? "—"}${withTime ? " t" : ""})`, showToast() {}, friendlyError: String, setFormBusy() {}, renderRoute: async () => {}, confirm: () => true,
    CSS: { escape: (value) => value }, URLSearchParams, Intl, Date, state: { employee: { department: { code: "PP" } } }, location: { hash: "" },
    FormData: class {}, sb: { rpc: async () => ({ data, error: null }) },
  });
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  return context;
}
const plain = (value) => JSON.parse(JSON.stringify(value));

async function render(data = FIXTURE) {
  const context = loadFactory(data);
  let painted = null;
  let loading = 0;
  await context.MNP_FACTORY_VIEWS.overview({ params: new URLSearchParams(""), frame: { loading: () => { loading += 1; }, paint: (options) => { painted = options; return {}; } } });
  return { ...painted, loading, context };
}

test("the overview view is registered and shows a loading page first", async () => {
  const view = await render();
  assert.equal(view.loading, 1);
  assert.equal(typeof view.context.MNP_FACTORY_VIEWS.overview, "function");
});

test("the overview shows the summary numbers, the pipeline filters and the department work", async () => {
  const { body } = await render();
  assert.match(body, /<span>ใบสั่งผลิตทั้งหมด<\/span><strong>2<\/strong>/);
  assert.match(body, /ผลิตอยู่ 1 · เสร็จแล้ว 0/);
  assert.match(body, /<span>ใบงานผลิตที่ยังไม่จบ<\/span><strong>1<\/strong>/);
  assert.match(body, /<span>ต่ำกว่าสต็อกขั้นต่ำ<\/span><strong>1<\/strong>/);
  assert.match(body, /href="#\/factory\?item=production-view&amp;status=submitted"[^>]*>ส่งแล้ว รอฝ่ายวางแผนรับ \(1\)/);
  assert.match(body, /ฝ่ายวางแผน \(ขั้น 2 และออกใบงาน\)/);
  assert.match(body, /RB ขึ้นรูปยาง \(ขั้น 4–8\)/);
  assert.match(body, /href="#\/factory\?dept=RB"[^>]*>ใบงานที่ถึงคิว <strong>1<\/strong>/, "a department with a page links to it");
  assert.match(body, /href="#\/factory\?item=job-queue"[^>]*>ใบงานที่ถึงคิว <strong>0<\/strong>/, "SR, QA and WH have no department page and use the job queue");
  assert.match(body, /ใบสั่งผลิตที่ยังต้องสั่งวัตถุดิบเพิ่ม <strong>1<\/strong>/);
  assert.match(body, /ไม่มีงานค้าง/);
});

test("low stock and recent activity are listed with links, and user text is escaped", async () => {
  const { body } = await render();
  assert.match(body, /RM-NR&lt;b&gt;/);
  assert.doesNotMatch(body, /<b>/, "the item code is escaped");
  assert.match(body, /<td class="right fm-short">1 KG<\/td><td class="right">50<\/td>/);
  assert.match(body, /ใบสั่งผลิต <a href="#\/factory\?item=production-view&amp;po=wo-rel"><strong>MO-6<\/strong><\/a>/);
  assert.match(body, /ออกใบสั่งงาน/);
  assert.match(body, /ทดสอบ &lt;i&gt;x&lt;\/i&gt;/);
  assert.doesNotMatch(body, /<i>x<\/i>/);
});

test("the department cards get the number of jobs waiting, and planning gets the waiting orders", async () => {
  const { queueCounts } = await render();
  assert.deepEqual(plain(queueCounts), { RB: 1, SR: 0, QA: 0, GR: 0, PT: 0, BG: 0, PK: 0, WH: 0, PP: 1 });
});

test("an empty factory still draws every section with a hint to start", async () => {
  const empty = { items: [], boms: [], bom_lines: [], production: [], material_orders: [], jobs: [], production_history: [], material_history: [], job_history: [] };
  const { body, queueCounts } = await render(empty);
  assert.match(body, /<span>ใบสั่งผลิตทั้งหมด<\/span><strong>0<\/strong>/);
  assert.match(body, /ไม่มี Item ที่ต่ำกว่าขั้นต่ำ/);
  assert.match(body, /ยังไม่มีความเคลื่อนไหว/);
  assert.equal(plain(queueCounts).PP, 0);
});
