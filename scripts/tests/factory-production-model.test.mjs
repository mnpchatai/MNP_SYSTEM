import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const model = createRequire(import.meta.url)("../../modules/factory-production-model.js");

const item = (id, code, type, procurement, stock = 0, unit = "PCS", status = "active") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, unit_code: unit, status });
const bom = (id, itemId, output, status = "approved") => ({ id, item_id: itemId, output_qty: output, status, revision: "A", code: id, unit_code: "PCS" });
const line = (bomId, no, componentId, quantity, scrap = 0) => ({ bom_id: bomId, line_no: no, component_id: componentId, quantity, scrap_percent: scrap });

// FG ← ชิ้นงานยาง (มีสูตร) + ชิ้นงานพลาสติก (ไม่มีสูตร) + กระเป๋า + กล่อง · ชิ้นงานยาง ← ยางเส้นยาว (มีสูตร) + กาว · ยางเส้นยาว ← ยาง + คาร์บอน
function fixture(overrides = {}) {
  const items = [
    item("fg", "FG-1", "FG", "make"),
    item("rbp", "WIP-RBP", "WIP", "make"),
    item("ptp", "WIP-PTP", "WIP", "make"),
    item("bag", "WIP-BAG", "WIP", "buy", 5000),
    item("box", "PKG-BOX", "PKG", "buy", 400),
    item("rbl", "WIP-RBL", "WIP", "make", 260, "KG"),
    item("glue", "RM-GLUE", "RM", "buy", 60, "KG"),
    item("nr", "RM-NR", "RM", "buy", 1500, "KG"),
    item("cb", "RM-CB", "RM", "buy", 420, "KG"),
  ].map((row) => ({ ...row, ...(overrides[row.id] ?? {}) }));
  return {
    items,
    boms: [bom("b-fg", "fg", 12), bom("b-rbp", "rbp", 100), bom("b-rbl", "rbl", 100)],
    bom_lines: [
      line("b-fg", 1, "rbp", 12), line("b-fg", 2, "ptp", 12), line("b-fg", 3, "bag", 12, 1), line("b-fg", 4, "box", 1),
      line("b-rbp", 1, "rbl", 5, 3), line("b-rbp", 2, "glue", 0.25),
      line("b-rbl", 1, "nr", 62, 2), line("b-rbl", 2, "cb", 28),
    ],
  };
}
const rowOf = (survey, id) => survey.rows.find((row) => row.item_id === id);

test("statuses cover every database status and each has a Thai label and a badge class", () => {
  assert.deepEqual(Object.keys(model.ORDER_STATUSES), ["draft", "submitted", "planning", "planned", "released", "in_progress", "completed", "cancelled"]);
  assert.deepEqual(Object.keys(model.BADGE_CLASS), Object.keys(model.ORDER_STATUSES));
  for (const label of Object.values(model.ORDER_STATUSES)) assert.ok(label.trim().length > 0);
  assert.deepEqual(Object.keys(model.HISTORY_ACTIONS), ["create", "update", "submit", "withdraw", "receive", "return", "plan", "release", "cancel", "start", "output", "finish"]);
});

test("the buttons follow status and department: sales owns draft/submitted, planning owns the rest", () => {
  const actions = (status, dept) => model.orderActions({ status }, dept);
  assert.deepEqual(actions("draft", "SA"), ["edit", "submit"]);
  assert.deepEqual(actions("submitted", "SA"), ["withdraw"]);
  assert.deepEqual(actions("planning", "SA"), []);
  assert.deepEqual(actions("submitted", "PP"), ["receive", "return"]);
  assert.deepEqual(actions("planning", "PP"), ["plan", "return", "cancel"]);
  assert.deepEqual(actions("planned", "PP"), ["plan", "release", "cancel"]);
  assert.deepEqual(actions("released", "PP"), ["cancel"]);
  assert.deepEqual(actions("in_progress", "PP"), ["cancel"]);
  assert.deepEqual(actions("draft", "PP"), []);
  assert.deepEqual(actions("submitted", "PP").includes("cancel"), false, "a waiting order is returned, not cancelled");
  for (const status of ["released", "in_progress", "completed", "cancelled"]) assert.deepEqual(actions(status, "SA"), [], status);
  for (const status of ["completed", "cancelled"]) assert.deepEqual(actions(status, "PP"), [], status);
  for (const status of ["released", "in_progress", "planning", "planned"]) {
    assert.deepEqual(actions(status, "ST"), [], `only planning cancels (${status})`);
    assert.deepEqual(actions(status, "RB"), [], `only planning cancels (${status})`);
  }
  assert.deepEqual(actions("draft", "RB"), [], "other departments get no buttons");
  assert.deepEqual(actions("draft", null), []);
  assert.deepEqual(model.orderActions(null, "SA"), []);
});

test("waitingFor names the department that has to act", () => {
  assert.equal(model.waitingFor({ status: "draft" }), "SA");
  assert.equal(model.waitingFor({ status: "submitted" }), "PP");
  assert.equal(model.waitingFor({ status: "planning" }), "PP");
  assert.equal(model.waitingFor({ status: "planned" }), "PP");
  assert.equal(model.waitingFor({ status: "released" }), null);
  assert.equal(model.waitingFor(null), null);
});

test("the planning queue lists the oldest submission first and keeps the stages apart", () => {
  const queue = model.planningQueue([
    { code: "B", status: "submitted", submitted_at: "2026-10-07T09:00:00Z" },
    { code: "A", status: "submitted", submitted_at: "2026-10-07T08:00:00Z" },
    { code: "C", status: "planning", received_at: "2026-10-07T10:00:00Z" },
    { code: "D", status: "planned", planned_at: "2026-10-07T11:00:00Z" },
    { code: "E", status: "draft" },
    { code: "F", status: "released" },
  ]);
  assert.deepEqual(queue.submitted.map((order) => order.code), ["A", "B"]);
  assert.deepEqual(queue.planning.map((order) => order.code), ["C"]);
  assert.deepEqual(queue.planned.map((order) => order.code), ["D"]);
});

test("the sales queue puts returned drafts first and groups the rest", () => {
  const queue = model.salesQueue([
    { code: "MO-1", status: "draft" },
    { code: "MO-2", status: "draft", return_note: "จำนวนผิด" },
    { code: "MO-3", status: "submitted" },
    { code: "MO-4", status: "planning" },
    { code: "MO-5", status: "released" },
  ]);
  assert.deepEqual(queue.drafts.map((order) => order.code), ["MO-2", "MO-1"]);
  assert.deepEqual(queue.waiting.map((order) => order.code), ["MO-4", "MO-3"]);
  assert.deepEqual(queue.done.map((order) => order.code), ["MO-5"]);
});

test("countByStatus has a key for every status", () => {
  const counts = model.countByStatus([{ status: "draft" }, { status: "draft" }, { status: "released" }, { status: "bogus" }]);
  assert.equal(counts.draft, 2);
  assert.equal(counts.released, 1);
  assert.equal(counts.planning, 0);
  assert.equal(Object.keys(counts).length, 8);
  assert.equal(model.countByStatus(null).draft, 0);
});

test("only active make-able finished goods can be ordered", () => {
  const items = [
    item("a", "FG-A", "FG", "make"), item("b", "FG-B", "FG", "both"), item("c", "FG-C", "FG", "buy"),
    item("d", "WIP-D", "WIP", "make"), item("e", "FG-E", "FG", "make", 0, "PCS", "inactive"),
  ];
  assert.deepEqual(model.orderableItems(items).map((row) => row.code), ["FG-A", "FG-B"]);
  assert.equal(model.canOrder(null), false);
});

test("the form values become the RPC parameters (blank = null, text trimmed)", () => {
  const payload = model.orderPayload({ item_id: " fg ", planned_qty: "1200.5", due_date: "2026-11-01", customer: "  ลูกค้า  ", note: " x " }, null);
  assert.deepEqual(payload, { p_id: null, p_version: null, p_item_id: "fg", p_planned_qty: 1200.5, p_due_date: "2026-11-01", p_customer: "ลูกค้า", p_note: "x" });
  const empty = model.orderPayload({}, { id: "o1", version: 3 });
  assert.equal(empty.p_id, "o1");
  assert.equal(empty.p_version, 3);
  assert.equal(empty.p_item_id, null);
  assert.equal(empty.p_planned_qty, null);
  assert.equal(empty.p_due_date, null);
});

test("validation explains every problem the database would reject", () => {
  const items = [item("fg", "FG-1", "FG", "make"), item("wip", "WIP-1", "WIP", "make")];
  const good = { p_item_id: "fg", p_planned_qty: 10, p_due_date: "2026-11-01", p_customer: "", p_note: "" };
  assert.deepEqual(model.validateOrderPayload(good, items, "2026-10-07"), []);
  assert.deepEqual(model.validateOrderPayload({ ...good, p_due_date: "2026-10-07" }, items, "2026-10-07"), [], "today is allowed");
  const bad = (changes) => model.validateOrderPayload({ ...good, ...changes }, items, "2026-10-07");
  assert.match(bad({ p_item_id: null }).join(), /เลือกสินค้า/);
  assert.match(bad({ p_item_id: "wip" }).join(), /สินค้าสำเร็จรูป/);
  assert.match(bad({ p_item_id: "nope" }).join(), /สินค้าสำเร็จรูป/);
  for (const quantity of [null, 0, -1, NaN, Infinity, 0.00001, 1000000001]) assert.match(bad({ p_planned_qty: quantity }).join(), /จำนวนที่สั่งผลิต/, String(quantity));
  assert.match(bad({ p_due_date: null }).join(), /กำหนดเสร็จ/);
  assert.match(bad({ p_due_date: "2026-10-06" }).join(), /ไม่ก่อนวันนี้/);
  assert.match(bad({ p_customer: "x".repeat(201) }).join(), /200/);
  assert.match(bad({ p_note: "x".repeat(1001) }).join(), /1,000/);
});

test("BOM and routing choices: one approved BOM per item, routings that are not obsolete", () => {
  const data = fixture();
  assert.equal(model.approvedBom(data.boms, "fg").id, "b-fg");
  assert.equal(model.approvedBom(data.boms, "ptp"), null);
  assert.equal(model.approvedBom([bom("b", "fg", 1, "draft")], "fg"), null, "a draft BOM cannot be used for planning");
  assert.equal(model.approvedBom(null, "fg"), null);
  const routings = [
    { id: "r1", item_id: "fg", status: "draft" }, { id: "r2", item_id: "fg", status: "obsolete" },
    { id: "r3", item_id: "fg", status: "approved" }, { id: "r4", item_id: "other", status: "draft" },
  ];
  assert.deepEqual(model.routingChoices(routings, "fg").map((row) => row.id), ["r1", "r3"]);
});

test("the survey explodes every level of the approved BOMs and nets stock before going deeper", () => {
  const survey = model.surveyRequirements(fixture(), "fg", 1200);
  // ชั้น 1: ต้องการตามสูตร FG (ผลผลิต 12) ไม่มียอดคงเหลือของชิ้นงานยาง/พลาสติก
  assert.deepEqual(rowOf(survey, "rbp"), { item_id: "rbp", code: "WIP-RBP", name: "ชื่อ WIP-RBP", unit_code: "PCS", item_type: "WIP", level: 1, gross: 1200, onHand: 0, net: 1200, hasBom: true });
  assert.equal(rowOf(survey, "bag").gross, 1212, "scrap is added on top: 12 × 100 × 1.01");
  assert.equal(rowOf(survey, "bag").net, 0, "5,000 bags in stock cover it");
  assert.equal(rowOf(survey, "box").gross, 100);
  // ชั้น 2: ชิ้นงานยาง (ผลผลิต 100) ใช้ยางเส้นยาว 5 × 12 × 1.03 = 61.8 และกาว 0.25 × 12 = 3
  assert.equal(rowOf(survey, "rbl").gross, 61.8);
  assert.equal(rowOf(survey, "rbl").level, 2);
  assert.equal(rowOf(survey, "glue").gross, 3);
  // ยางเส้นยาวมี 260 กก. พอ จึงไม่แตกสูตรต่อไปที่ยางและคาร์บอน
  assert.equal(rowOf(survey, "rbl").net, 0);
  assert.equal(survey.rows.find((row) => row.item_id === "nr"), undefined, "no raw rubber is needed while the long strip covers it");
  // ชิ้นงานพลาสติกไม่มี BOM ที่อนุมัติ และไม่มีของ → ต้องจัดหา/ทำ BOM
  assert.deepEqual(survey.shortages.map((row) => row.code), ["WIP-PTP"]);
  assert.deepEqual(survey.missingBoms.map((row) => row.code), ["WIP-PTP"]);
});

test("when the long strip runs short the shortage moves down to the raw materials", () => {
  const survey = model.surveyRequirements(fixture({ rbl: { stock: 10 } }), "fg", 1200);
  assert.equal(rowOf(survey, "rbl").net, 51.8, "61.8 needed − 10 on hand");
  assert.equal(rowOf(survey, "nr").gross, 32.7583, "62 × 51.8 ÷ 100 × 1.02");
  assert.equal(rowOf(survey, "cb").gross, 14.504, "28 × 51.8 ÷ 100");
  assert.equal(rowOf(survey, "nr").net, 0, "1,500 kg of rubber in stock covers it");
  const short = model.surveyRequirements(fixture({ rbl: { stock: 10 }, nr: { stock: 30 } }), "fg", 1200);
  assert.equal(rowOf(short, "nr").net, 2.7583);
  assert.ok(short.shortages.some((row) => row.code === "RM-NR"));
  assert.ok(!short.shortages.some((row) => row.code === "WIP-RBL"), "an item with a BOM is made, not bought: its shortage is carried to its components");
});

test("an item used in two places is netted once against its stock", () => {
  const data = fixture();
  data.items.push(item("shared", "RM-SHARED", "RM", "buy", 10));
  data.bom_lines.push(line("b-fg", 5, "shared", 1), line("b-rbp", 3, "shared", 1));
  const survey = model.surveyRequirements(data, "fg", 1200);
  // 1 × 1200 ÷ 12 = 100 จากสูตร FG + 1 × 1200 ÷ 100 = 12 จากสูตรชิ้นงานยาง = 112 รวมก่อนหักคงเหลือ 10
  assert.equal(rowOf(survey, "shared").gross, 112);
  assert.equal(rowOf(survey, "shared").net, 102);
});

test("the survey is null when there is nothing meaningful to calculate", () => {
  assert.equal(model.surveyRequirements(fixture(), "ptp", 10), null, "no approved BOM");
  assert.equal(model.surveyRequirements(fixture(), "fg", 0), null);
  assert.equal(model.surveyRequirements(fixture(), "fg", -5), null);
  assert.equal(model.surveyRequirements(fixture(), "fg", "abc"), null);
  assert.equal(model.surveyRequirements({}, "fg", 10), null);
});

test("a BOM loop in bad data does not hang the survey", () => {
  const data = fixture();
  data.bom_lines.push(line("b-rbl", 3, "rbp", 1));
  const survey = model.surveyRequirements(data, "fg", 1200);
  assert.ok(Array.isArray(survey.rows));
});

test("the survey summary is the starting text the planner edits", () => {
  const enough = model.surveyRequirements(fixture({ ptp: { stock: 5000 } }), "fg", 1200);
  assert.equal(model.surveySummary(enough), "สำรวจคงคลังแล้ว: วัตถุดิบและชิ้นงานตามสูตรมีเพียงพอ");
  const short = model.surveyRequirements(fixture(), "fg", 1200);
  assert.equal(model.surveySummary(short), "สำรวจคงคลังแล้ว: ขาด 1 รายการ — WIP-PTP ขาด 1,200 PCS");
  assert.equal(model.surveySummary(null), "");
});

test("the timeline lists one order's history oldest first", () => {
  const history = [
    { id: 3, order_id: "o1", action: "submit" }, { id: 2, order_id: "o2", action: "create" }, { id: 1, order_id: "o1", action: "create" },
  ];
  assert.deepEqual(model.orderTimeline(history, "o1").map((entry) => entry.action), ["create", "submit"]);
  assert.deepEqual(model.orderTimeline(null, "o1"), []);
});
