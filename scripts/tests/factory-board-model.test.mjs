import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
// factory-board-model.js ใช้โมเดลอื่นของฝ่ายโรงงานผ่านตัวแปร global เหมือนตอนโหลดใน browser
globalThis.MNP_FACTORY_MASTER_MODEL = require("../../modules/factory-master-model.js");
globalThis.MNP_FACTORY_PRODUCTION_MODEL = require("../../modules/factory-production-model.js");
globalThis.MNP_FACTORY_MATERIAL_MODEL = require("../../modules/factory-material-model.js");
globalThis.MNP_FACTORY_JOB_MODEL = require("../../modules/factory-job-model.js");
const model = require("../../modules/factory-board-model.js");

const item = (id, code, type, procurement, stock = 0, min = 0, unit = "KG") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, min_stock: min, unit_code: unit, status: "active" });
const order = (id, code, status, extra = {}) => ({ id, code, status, item_id: "fg", item_code: "FG-1", planned_qty: 12, completed_qty: 0, ...extra });
const step = (sequence, department, status = "pending") => ({ sequence, name: `ขั้น ${sequence / 10}`, department_code: department, work_center_code: department, status });
const job = (id, status, steps, extra = {}) => ({ id, code: id, status, production_order_id: "wo-rel", item_id: "rbl", qty: 100, created_at: `2026-10-07T0${id.length}:00:00Z`, steps, ...extra });
const bom = (id, itemId, output) => ({ id, item_id: itemId, output_qty: output, status: "approved", revision: "A" });
const line = (bomId, no, componentId, quantity) => ({ bom_id: bomId, line_no: no, component_id: componentId, quantity, scrap_percent: 0 });

// FG ← ชิ้นงาน (มี BOM) ← วัตถุดิบ (ขาด) : ใบสั่งผลิตที่ออกใบสั่งงานแล้วจึงต้องออกใบงานและสั่งวัตถุดิบ
function fixture(overrides = {}) {
  return {
    items: [item("fg", "FG-1", "FG", "make", 0, 0, "SET"), item("part", "WIP-PART", "WIP", "make", 0, 0, "PCS"), item("nr", "RM-NR", "RM", "buy", 1, 50), item("glue", "RM-GLUE", "RM", "buy", 100, 10), item("box", "PKG-BOX", "PKG", "buy", 0, 20, "PCS")],
    boms: [bom("b-fg", "fg", 12), bom("b-part", "part", 100)],
    bom_lines: [line("b-fg", 1, "part", 12), line("b-part", 1, "nr", 40), line("b-part", 2, "glue", 1)],
    production: [
      order("o-draft", "MO-1", "draft"), order("o-ret", "MO-2", "draft", { return_note: "แก้จำนวน" }), order("o-sub", "MO-3", "submitted"),
      order("o-plan", "MO-4", "planning"), order("o-planned", "MO-5", "planned"), order("wo-rel", "MO-6", "released"), order("o-done", "MO-7", "completed", { completed_qty: 12 }),
    ],
    material_orders: [{ id: "m1", status: "draft", production_order_id: "wo-rel", lines: [] }, { id: "m2", status: "ordered", production_order_id: "wo-rel", lines: [] }, { id: "m3", status: "received", production_order_id: "wo-rel", lines: [] }],
    jobs: [job("a", "open", [step(10, "RB"), step(20, "SR")]), job("bb", "in_progress", [step(10, "RB", "done"), step(20, "SR")]), job("c", "completed", [step(10, "RB", "done")])],
    production_history: [], material_history: [], job_history: [],
    ...overrides,
  };
}

test("the pipeline lists every order status in workflow order with its count", () => {
  const rows = model.pipeline(fixture().production);
  assert.deepEqual(rows.map((row) => row.status), ["draft", "submitted", "planning", "planned", "released", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(rows.map((row) => row.count), [2, 1, 1, 1, 1, 0, 1, 0]);
  assert.ok(rows.every((row) => row.label.trim().length > 0));
  assert.equal(model.pipeline(null).length, 8, "an empty list still has all stages");
});

test("queue counts show the jobs that reached each line department, and the waiting orders for planning", () => {
  const counts = model.queueCounts(fixture().jobs);
  assert.deepEqual(counts, { RB: 1, SR: 1, QA: 0, GR: 0, PT: 0, BG: 0, PK: 0, WH: 0 }, "job a waits at RB, job bb at SR; the finished job is in no queue");
  assert.equal(model.queueCounts(fixture().jobs, fixture().production).PP, 3, "submitted + planning + planned");
  assert.equal(model.queueCounts(null).RB, 0);
});

test("attention groups follow the workflow and count the work each department has to do", () => {
  const groups = model.attention(fixture());
  assert.deepEqual(groups.map((group) => group.dept), ["SA", "PP", "ST", "RB", "SR", "QA", "GR", "PT", "BG", "PK", "WH"]);
  const count = (dept, label) => groups.find((group) => group.dept === dept).items.find((row) => row.label.includes(label)).count;
  assert.equal(count("SA", "ส่งกลับ"), 1, "one draft was returned by planning");
  assert.equal(count("SA", "ยังไม่ได้ส่ง"), 1, "the other draft has not been sent");
  assert.equal(count("PP", "รอรับ"), 1);
  assert.equal(count("PP", "สำรวจ"), 1);
  assert.equal(count("PP", "รอออกใบสั่งงาน"), 1);
  assert.equal(count("PP", "ชิ้นงานรอออกใบงาน"), 1, "the released order still has parts and the finished good without jobs");
  assert.equal(count("ST", "ต้องสั่งวัตถุดิบเพิ่ม"), 1, "rubber is short: 40 × 12 ÷ 100 = 4.8 kg are needed but 1 kg is in stock");
  assert.equal(count("ST", "ฉบับร่าง"), 1);
  assert.equal(count("ST", "รอรับของ"), 1);
  assert.equal(count("RB", "ถึงคิว"), 1);
  assert.equal(count("SR", "ถึงคิว"), 1);
  assert.equal(count("WH", "ถึงคิว"), 0);
  const pp = groups.find((group) => group.dept === "PP");
  assert.equal(pp.total, 4);
  assert.deepEqual(groups.find((group) => group.dept === "WH").items[0].link, { dept: "WH" });
  assert.deepEqual(groups.find((group) => group.dept === "ST").items[1].link, { item: "material-view", params: { status: "draft" } });
});

test("attention drops the shortage once material is on order or in stock, and jobs once they are issued", () => {
  const covered = fixture({ material_orders: [{ id: "m1", status: "ordered", production_order_id: "wo-rel", lines: [{ item_id: "nr", quantity: 100 }] }] });
  const st = model.attention(covered).find((group) => group.dept === "ST");
  assert.equal(st.items[0].count, 0, "the rubber shortage is fully ordered");
  assert.equal(st.items[2].count, 1);
  const issued = fixture({ jobs: [job("a", "open", [step(10, "RB")], { item_id: "part", qty: 12 }), job("b", "open", [step(10, "PK")], { item_id: "fg", qty: 12 })] });
  const pp = model.attention(issued).find((group) => group.dept === "PP");
  assert.equal(pp.items[3].count, 0, "every part and the finished good already has a job");
  const empty = model.attention({});
  assert.ok(empty.every((group) => group.total === 0));
});

test("stats summarise orders, jobs, material orders and low stock", () => {
  assert.deepEqual(model.stats(fixture()), { ordersTotal: 7, ordersRunning: 1, ordersCompleted: 1, jobsRunning: 2, jobsCompleted: 1, materialWaiting: 2, lowStock: 2 });
  assert.equal(model.stats({}).ordersTotal, 0);
});

test("stock alerts list the items below their minimum, biggest gap first, limited", () => {
  const alerts = model.stockAlerts(fixture().items);
  assert.deepEqual(alerts.map((row) => [row.code, row.stock, row.min_stock, row.gap]), [["RM-NR", 1, 50, 49], ["PKG-BOX", 0, 20, 20]]);
  assert.equal(model.stockAlerts(fixture().items, 1).length, 1);
  assert.deepEqual(model.stockAlerts(null), []);
});

test("recent activity merges the three histories, newest first, with Thai labels and links to the document", () => {
  const data = fixture({
    production_history: [{ id: 5, order_id: "wo-rel", code: "MO-6", action: "start", created_at: "2026-10-07T05:00:00Z", changed_by_name: "ทดสอบ พนักงาน RB", note: "TEST-JB-26-001" }, { id: 4, order_id: "wo-rel", code: "MO-6", action: "release", created_at: "2026-10-07T02:00:00Z", changed_by_name: "ทดสอบ พนักงานวางแผน" }],
    material_history: [{ id: 3, order_id: "m2", code: "TEST-MR-26-001", action: "place", created_at: "2026-10-07T04:00:00Z", changed_by_name: "ทดสอบ พนักงาน ST" }],
    job_history: [{ id: 9, job_id: "a", code: "TEST-JB-26-001", action: "create", created_at: "2026-10-07T03:00:00Z", changed_by_name: "ทดสอบ พนักงานวางแผน" }],
  });
  const rows = model.recentActivity(data);
  assert.deepEqual(rows.map((row) => [row.kind, row.code, row.label]), [
    ["ใบสั่งผลิต", "MO-6", "เริ่มผลิต (ขั้นแรกของใบงานเสร็จ)"], ["ใบสั่งวัตถุดิบ", "TEST-MR-26-001", "สั่งวัตถุดิบ"], ["ใบงานผลิต", "TEST-JB-26-001", "ออกใบงาน"], ["ใบสั่งผลิต", "MO-6", "ออกใบสั่งงาน"],
  ]);
  assert.deepEqual(rows[0].link, { item: "production-view", params: { po: "wo-rel" } });
  assert.deepEqual(rows[1].link, { item: "material-view", params: { mo: "m2" } });
  assert.deepEqual(rows[2].link, { item: "job-view", params: { jb: "a" } });
  assert.equal(rows[0].by, "ทดสอบ พนักงาน RB");
  assert.equal(model.recentActivity(data, 2).length, 2);
  assert.deepEqual(model.recentActivity({}), []);
});

test("line departments follow the workflow order and cannot be changed by callers", () => {
  assert.deepEqual(model.LINE_DEPARTMENTS.map((row) => row.code), ["RB", "SR", "QA", "GR", "PT", "BG", "PK", "WH"]);
  assert.throws(() => { "use strict"; model.LINE_DEPARTMENTS.push({ code: "XX" }); }, TypeError);
});
