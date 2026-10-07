import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
// factory-job-model.js ใช้ตารางสำรวจคงคลังของ factory-production-model.js ผ่านตัวแปร global เหมือนตอนโหลดใน browser
globalThis.MNP_FACTORY_PRODUCTION_MODEL = require("../../modules/factory-production-model.js");
const model = require("../../modules/factory-job-model.js");

const step = (sequence, department, status = "pending", name = `ขั้น ${sequence / 10}`) => ({ sequence, name, department_code: department, work_center_code: department, status });
const job = (id, status, steps, extra = {}) => ({ id, code: id, status, production_order_id: "wo", item_id: "rbl", qty: 100, created_at: `2026-10-07T0${id.length}:00:00Z`, steps, ...extra });
const item = (id, code, type, procurement, stock = 0, unit = "KG") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, unit_code: unit, status: "active" });
const bom = (id, itemId, output) => ({ id, item_id: itemId, output_qty: output, status: "approved", revision: "A" });
const line = (bomId, no, componentId, quantity, scrap = 0) => ({ bom_id: bomId, line_no: no, component_id: componentId, quantity, scrap_percent: scrap });

// FG ← ชิ้นงานยาง (มี BOM) + กระเป๋า · ชิ้นงานยาง ← ยางเส้นยาว + กาว
function fixture(overrides = {}) {
  return {
    items: [
      item("fg", "FG-1", "FG", "make", 0, "SET"), item("rbp", "WIP-RBP", "WIP", "make", 0, "PCS"), item("bag", "WIP-BAG", "WIP", "make", 12, "PCS"),
      item("rbl", "WIP-RBL", "WIP", "make", 0), item("glue", "RM-GLUE", "RM", "buy", 60),
    ].map((row) => ({ ...row, ...(overrides[row.id] ?? {}) })),
    boms: [bom("b-fg", "fg", 12), bom("b-rbp", "rbp", 100), bom("b-rbl", "rbl", 100), { ...bom("b-bag", "bag", 100), status: "draft" }],
    bom_lines: [
      line("b-fg", 1, "rbp", 12), line("b-fg", 2, "bag", 12, 1),
      line("b-rbp", 1, "rbl", 5, 3), line("b-rbp", 2, "glue", 0.25),
      line("b-rbl", 1, "glue", 50),
    ],
    jobs: overrides.jobs ?? [],
    steps: overrides.steps ?? [],
    routings: overrides.routings ?? [],
    warehouses: [{ code: "RM" }, { code: "SR" }, { code: "WIP" }, { code: "FG" }],
    production: [{ id: "wo", status: "released" }, { id: "wo-draft", status: "draft" }],
  };
}
const WO = { id: "wo", item_id: "fg", planned_qty: 120, completed_qty: 0, status: "released", routing_id: "r-fg" };

test("statuses cover every database status with a Thai label and a badge class", () => {
  assert.deepEqual(Object.keys(model.JOB_STATUSES), ["open", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(Object.keys(model.BADGE_CLASS), Object.keys(model.JOB_STATUSES));
  assert.deepEqual(Object.keys(model.STEP_STATUSES), ["pending", "done"]);
  assert.deepEqual(Object.keys(model.HISTORY_ACTIONS), ["create", "step", "complete", "cancel"]);
});

test("the next step is the first pending one, and only active jobs have one", () => {
  const steps = [step(30, "GR"), step(10, "RB", "done"), step(20, "RB")];
  assert.equal(model.nextStep(job("a", "in_progress", steps)).sequence, 20, "steps are sorted by sequence");
  assert.equal(model.nextStep(job("a", "open", [step(10, "RB"), step(20, "SR")])).sequence, 10);
  for (const status of ["completed", "cancelled"]) assert.equal(model.nextStep(job("a", status, steps)), null, status);
  assert.equal(model.nextStep(job("a", "in_progress", [step(10, "RB", "done")])), null, "nothing pending");
  assert.equal(model.nextStep(null), null);
});

test("a step can be run by its own department when it is next", () => {
  const j = job("a", "in_progress", [step(10, "RB", "done"), step(20, "RB"), step(30, "SR")]);
  const [done, next, later] = model.stepsOf(j);
  assert.equal(model.canRunStep(j, next, "RB"), true);
  assert.equal(model.canRunStep(j, next, "SR"), false, "another department cannot");
  assert.equal(model.canRunStep(j, next, null), false);
  assert.equal(model.canRunStep(j, later, "SR"), false, "not next yet: the earlier step is pending");
  assert.equal(model.canRunStep(j, done, "RB"), false, "already done");
  assert.equal(model.canRunStep(job("a", "completed", j.steps), next, "RB"), false, "a finished job has no steps to run");
});

test("the last pending step is recognised so the output quantity can be asked", () => {
  const j = job("a", "in_progress", [step(10, "RB", "done"), step(20, "RB"), step(30, "SR")]);
  assert.equal(model.isLastPending(j, j.steps[1]), false);
  const last = job("a", "in_progress", [step(10, "RB", "done"), step(20, "RB", "done"), step(30, "SR")]);
  assert.equal(model.isLastPending(last, last.steps[2]), true);
  assert.equal(model.isLastPending(last, last.steps[0]), false, "a done step is not pending");
});

test("only planning can cancel, and only a job that has not started", () => {
  assert.deepEqual(model.jobActions({ status: "open" }, "PP"), ["cancel"]);
  assert.deepEqual(model.jobActions({ status: "in_progress" }, "PP"), []);
  assert.deepEqual(model.jobActions({ status: "completed" }, "PP"), []);
  for (const dept of ["RB", "SA", "ST", null]) assert.deepEqual(model.jobActions({ status: "open" }, dept), [], String(dept));
});

test("the department queue lists jobs whose next step is theirs, oldest first, and the ones still coming", () => {
  const jobs = [
    job("bbb", "in_progress", [step(10, "RB", "done"), step(20, "SR")]),
    job("a", "open", [step(10, "RB"), step(20, "SR")]),
    job("cc", "open", [step(10, "RB"), step(20, "RB")]),
    job("dddd", "completed", [step(10, "RB", "done")]),
    job("ee", "cancelled", [step(10, "RB")]),
    job("f", "open", [step(10, "GR"), step(20, "PK")]),
  ];
  const rb = model.deptQueue(jobs, "RB");
  assert.deepEqual(rb.ready.map((entry) => entry.job.id), ["a", "cc"], "oldest first (created_at)");
  assert.deepEqual(rb.upcoming, []);
  const sr = model.deptQueue(jobs, "SR");
  assert.deepEqual(sr.ready.map((entry) => entry.job.id), ["bbb"]);
  assert.deepEqual(sr.upcoming.map((entry) => [entry.job.id, entry.step.department_code, entry.mine.department_code]), [["a", "RB", "SR"]], "SR will get job a after RB finishes");
  assert.deepEqual(model.deptQueue(jobs, "PK").ready, []);
  assert.deepEqual(model.deptQueue(jobs, "PK").upcoming.map((entry) => entry.job.id), ["f"]);
  assert.deepEqual(model.deptQueue(null, "RB"), { ready: [], upcoming: [] });
});

test("counting, filtering and progress", () => {
  const jobs = [job("a", "open", [step(10, "RB")]), job("b", "open", [step(10, "RB")]), job("c", "completed", [step(10, "RB", "done")], { production_order_id: "other" })];
  assert.deepEqual(model.countByStatus(jobs), { open: 2, in_progress: 0, completed: 1, cancelled: 0 });
  assert.deepEqual(model.jobsOf(jobs, "wo").map((row) => row.id), ["a", "b"]);
  assert.deepEqual(model.progress(job("p", "in_progress", [step(10, "RB", "done"), step(20, "RB", "done"), step(30, "SR"), step(40, "SR")])), { done: 2, total: 4, percent: 50 });
  assert.deepEqual(model.progress(job("p", "open", [])), { done: 0, total: 0, percent: 0 });
});

test("the materials a job needs are the approved BOM scaled to the quantity, with scrap added and rounded like the database", () => {
  const need = model.jobRequirements(fixture(), "rbp", 12);
  // ชิ้นงานยาง ผลผลิตต่อสูตร 100: ยางเส้นยาว 5 × 12 ÷ 100 × 1.03 = 0.618 กาว 0.25 × 12 ÷ 100 = 0.03
  assert.deepEqual(need.rows.map((row) => [row.code, row.need, row.stock, row.short]), [["WIP-RBL", 0.618, 0, true], ["RM-GLUE", 0.03, 60, false]]);
  assert.equal(need.ready, false, "the long strip is not in stock yet");
  assert.equal(model.jobRequirements(fixture({ rbl: { stock: 1 } }), "rbp", 12).ready, true);
  assert.equal(model.jobRequirements(fixture(), "bag", 12), null, "a draft BOM cannot be produced");
  assert.equal(model.jobRequirements(fixture(), "rbp", 0), null);
  assert.equal(model.jobRequirements(fixture(), "rbp", "abc"), null);
  assert.equal(model.jobRequirements({}, "rbp", 5), null);
  const fg = model.jobRequirements(fixture({ rbp: { stock: 12 } }), "fg", 12);
  assert.equal(fg.rows.find((row) => row.code === "WIP-BAG").need, 12.12, "12 × 1.01");
  assert.equal(fg.rows.find((row) => row.code === "WIP-BAG").short, true, "12.12 bags are needed but only 12 are in stock");
  assert.equal(fg.ready, false);
});

test("jobs already issued and unfinished are counted per item, finished and cancelled ones are not", () => {
  const jobs = [
    job("a", "open", [step(10, "RB")], { item_id: "rbl", qty: 40 }), job("b", "in_progress", [step(10, "RB")], { item_id: "rbl", qty: 10.5 }),
    job("c", "completed", [step(10, "RB", "done")], { item_id: "rbl", qty: 999 }), job("d", "cancelled", [step(10, "RB")], { item_id: "rbl", qty: 999 }),
    job("e", "open", [step(10, "RB")], { item_id: "rbl", qty: 999, production_order_id: "other" }), job("f", "open", [step(10, "RB")], { item_id: "rbp", qty: 5 }),
  ];
  assert.equal(model.inJobsQty(jobs, "wo", "rbl"), 50.5);
  assert.equal(model.inJobsQty(jobs, "wo", "rbp"), 5);
  assert.equal(model.inJobsQty(null, "wo", "rbl"), 0);
});

test("suggestions list the semi-finished items to make first and the finished good last, minus jobs already issued", () => {
  const suggestions = model.jobSuggestions(fixture(), WO);
  // 120 ชุด ÷ 12 = 10 สูตร: ชิ้นงานยาง 120 (ต้องผลิต มี BOM) กระเป๋า 121.2 (มี 12 ในคลัง ไม่มี BOM อนุมัติ จึงไม่ใช่ใบงาน) ยางเส้นยาว 120 × 5 ÷ 100 × 1.03 = 6.18
  assert.deepEqual(suggestions.map((row) => [row.code, row.kind, row.need, row.inJobs, row.qty]), [
    ["WIP-RBL", "wip", 6.18, 0, 6.18], ["WIP-RBP", "wip", 120, 0, 120], ["FG-1", "fg", 120, 0, 120],
  ]);
  const issued = fixture({ jobs: [job("a", "open", [step(10, "RB")], { item_id: "rbp", qty: 100 }), job("b", "in_progress", [step(10, "PK")], { item_id: "fg", qty: 120 })] });
  const after = model.jobSuggestions(issued, WO);
  assert.equal(after.find((row) => row.code === "WIP-RBP").qty, 20, "120 − 100 already issued");
  assert.equal(after.find((row) => row.code === "FG-1").qty, 0, "the whole order is already in a job");
  const part = model.jobSuggestions(fixture(), { ...WO, completed_qty: 100 });
  assert.equal(part.find((row) => row.code === "FG-1").need, 20, "only what is not produced yet");
  assert.equal(model.jobSuggestions(fixture(), { ...WO, completed_qty: 120 }).some((row) => row.kind === "fg"), false, "a finished order has no finished-good job to issue");
  assert.deepEqual(model.jobSuggestions({ ...fixture(), boms: [] }, WO).map((row) => row.kind), ["fg"], "without a BOM only the finished good is offered");
});

test("the proposed output warehouse follows the routing: SR for the long strip, FG for finished goods, WIP otherwise", () => {
  const data = fixture({ steps: [{ routing_id: "r-rbl", name: "RB-13 ตัดยางเส้นยาว" }, { routing_id: "r-rbl", name: "SR-01 รับยางเส้นยาว" }, { routing_id: "r-gr", name: "GR-01 ตัด" }] });
  assert.equal(model.defaultWarehouse(data, data.items[3], "r-rbl"), "SR");
  assert.equal(model.defaultWarehouse(data, data.items[1], "r-gr"), "WIP");
  assert.equal(model.defaultWarehouse(data, data.items[0], "r-fg"), "FG");
  assert.equal(model.defaultWarehouse(data, null, null), "WIP");
});

test("only active make-able WIP/FG items with an approved BOM can get a job; only released orders are offered", () => {
  const data = fixture();
  assert.deepEqual(model.jobItems(data).map((row) => row.code), ["FG-1", "WIP-RBL", "WIP-RBP"], "WIP-BAG has only a draft BOM, RM-GLUE is bought");
  const orders = [{ code: "A", status: "draft" }, { code: "B", status: "released" }, { code: "C", status: "in_progress" }, { code: "D", status: "completed" }];
  assert.deepEqual(model.orderableOrders(orders).map((row) => row.code), ["C", "B"]);
  assert.deepEqual(model.orderableOrders(null), []);
});

test("form values become the RPC parameters", () => {
  assert.deepEqual(model.jobPayload({ production_order_id: " wo ", item_id: "rbl", qty: "6.18", warehouse_code: " sr ", note: " x " }),
    { p_production_order_id: "wo", p_item_id: "rbl", p_qty: 6.18, p_warehouse_code: "SR", p_note: "x" });
  const empty = model.jobPayload({});
  assert.deepEqual(empty, { p_production_order_id: null, p_item_id: null, p_qty: null, p_warehouse_code: "", p_note: "" });
});

test("validation explains every problem the database would reject", () => {
  const data = fixture();
  const good = { p_production_order_id: "wo", p_item_id: "rbl", p_qty: 10, p_warehouse_code: "SR", p_note: "" };
  const check = (changes) => model.validateJobPayload({ ...good, ...changes }, data).join(" | ");
  assert.equal(check({}), "");
  assert.match(check({ p_production_order_id: null }), /เลือกใบสั่งผลิต/);
  assert.match(check({ p_production_order_id: "wo-draft" }), /ออกใบสั่งงานแล้ว/);
  assert.match(check({ p_production_order_id: "ghost" }), /ออกใบสั่งงานแล้ว/);
  assert.match(check({ p_item_id: null }), /เลือกชิ้นงาน/);
  assert.match(check({ p_item_id: "glue" }), /WIP หรือ FG/);
  assert.match(check({ p_item_id: "bag" }), /WIP หรือ FG/);
  for (const quantity of [null, 0, -1, NaN, Infinity, 0.00001, 1000000001]) assert.match(check({ p_qty: quantity }), /จำนวนที่ผลิต/, String(quantity));
  assert.match(check({ p_warehouse_code: "" }), /เลือกคลัง/);
  assert.match(check({ p_warehouse_code: "NOPE" }), /เลือกคลัง/);
  assert.match(check({ p_note: "x".repeat(1001) }), /1,000/);
});

test("the real output quantity is optional and must be a positive number", () => {
  assert.deepEqual(model.outputQty(""), { value: null });
  assert.deepEqual(model.outputQty(null), { value: null });
  assert.deepEqual(model.outputQty(" 95.5 "), { value: 95.5 });
  for (const bad of ["0", "-1", "abc", "1000000001", "0.00001"]) assert.match(model.outputQty(bad).error, /จำนวนผลิตจริง/, bad);
});

test("the timeline lists one job's history oldest first", () => {
  const history = [{ id: 3, job_id: "a", action: "complete" }, { id: 2, job_id: "b", action: "create" }, { id: 1, job_id: "a", action: "create" }];
  assert.deepEqual(model.jobTimeline(history, "a").map((entry) => entry.action), ["create", "complete"]);
  assert.deepEqual(model.jobTimeline(null, "a"), []);
});
