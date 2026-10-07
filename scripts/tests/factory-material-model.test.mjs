import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
// factory-material-model.js ใช้ตารางสำรวจคงคลังของ factory-production-model.js ผ่านตัวแปร global เหมือนตอนโหลดใน browser
globalThis.MNP_FACTORY_PRODUCTION_MODEL = require("../../modules/factory-production-model.js");
const model = require("../../modules/factory-material-model.js");

const item = (id, code, type, procurement, stock = 0, unit = "KG", status = "active") => ({ id, code, name: `ชื่อ ${code}`, item_type: type, procurement, stock, unit_code: unit, status });
const bom = (id, itemId, output) => ({ id, item_id: itemId, output_qty: output, status: "approved", revision: "A" });
const line = (bomId, no, componentId, quantity, scrap = 0) => ({ bom_id: bomId, line_no: no, component_id: componentId, quantity, scrap_percent: scrap });
const material = (id, status, lines, extra = {}) => ({ id, code: id, status, production_order_id: "wo", lines: lines.map(([itemId, quantity]) => ({ item_id: itemId, quantity })), ...extra });

// FG ← ชิ้นงาน (ทำเอง ไม่มี BOM) + ยาง + เคมี (สูตรผลผลิต 10) · ขาดเคมีและยาง
function fixture(overrides = {}) {
  return {
    items: [
      item("fg", "FG-1", "FG", "make", 0, "SET"),
      item("part", "WIP-PART", "WIP", "make", 0, "PCS"),
      item("nr", "RM-NR", "RM", "buy", 10),
      item("chem", "RM-CHEM", "RM", "buy", 0),
      item("old", "RM-OLD", "RM", "buy", 0, "KG", "inactive"),
    ].map((row) => ({ ...row, ...(overrides[row.id] ?? {}) })),
    boms: [bom("b-fg", "fg", 10)],
    bom_lines: [line("b-fg", 1, "nr", 50), line("b-fg", 2, "chem", 5, 10), line("b-fg", 3, "part", 10)],
    material_orders: overrides.material_orders ?? [],
  };
}
const WO = { id: "wo", item_id: "fg", planned_qty: 100, status: "released" };

test("statuses cover every database status with a Thai label, badge class and history action", () => {
  assert.deepEqual(Object.keys(model.MATERIAL_STATUSES), ["draft", "ordered", "received", "cancelled"]);
  assert.deepEqual(Object.keys(model.BADGE_CLASS), Object.keys(model.MATERIAL_STATUSES));
  assert.deepEqual(Object.keys(model.HISTORY_ACTIONS), ["create", "update", "place", "receive", "cancel"]);
  for (const label of Object.values(model.MATERIAL_STATUSES)) assert.ok(label.trim().length > 0);
});

test("only stores gets buttons: draft = edit/place/cancel, ordered = receive/cancel, nothing after", () => {
  const actions = (status, dept) => model.materialActions({ status }, dept);
  assert.deepEqual(actions("draft", "ST"), ["edit", "place", "cancel"]);
  assert.deepEqual(actions("ordered", "ST"), ["receive", "cancel"]);
  assert.deepEqual(actions("received", "ST"), []);
  assert.deepEqual(actions("cancelled", "ST"), []);
  for (const dept of ["SA", "PP", "RB", null]) for (const status of ["draft", "ordered"]) assert.deepEqual(actions(status, dept), [], `${dept}/${status}`);
  assert.deepEqual(model.materialActions(null, "ST"), []);
});

test("countByStatus has a key for every status", () => {
  const counts = model.countByStatus([{ status: "draft" }, { status: "draft" }, { status: "received" }, { status: "bogus" }]);
  assert.deepEqual(counts, { draft: 2, ordered: 0, received: 1, cancelled: 0 });
  assert.equal(model.countByStatus(null).draft, 0);
});

test("only released or in-progress production orders can have materials ordered, newest first", () => {
  const orders = [
    { code: "A", status: "draft" }, { code: "B", status: "released" }, { code: "C", status: "in_progress" },
    { code: "D", status: "planned" }, { code: "E", status: "completed" },
  ];
  assert.deepEqual(model.orderableWorkOrders(orders).map((order) => order.code), ["C", "B"]);
  assert.deepEqual(model.orderableWorkOrders(null), []);
});

test("purchasable items are active and bought (buy or both)", () => {
  const items = [item("a", "A", "RM", "buy"), item("b", "B", "RM", "both"), item("c", "C", "WIP", "make"), item("d", "D", "RM", "buy", 0, "KG", "inactive")];
  assert.deepEqual(model.purchasableItems(items).map((row) => row.code), ["A", "B"]);
  assert.equal(model.purchasable(null), false);
});

test("on-order quantities count open orders only and can skip the order being edited", () => {
  const orders = [
    material("m1", "draft", [["nr", 5], ["chem", 1]]), material("m2", "ordered", [["nr", 7]]),
    material("m3", "received", [["nr", 100]]), material("m4", "cancelled", [["nr", 100]]),
    material("m5", "ordered", [["nr", 1000]], { production_order_id: "other" }),
  ];
  const totals = model.onOrderByItem(orders, "wo");
  assert.equal(totals.get("nr"), 12);
  assert.equal(totals.get("chem"), 1);
  assert.equal(model.onOrderByItem(orders, "wo", "m1").get("nr"), 7, "the order being edited is not counted twice");
  assert.equal(model.onOrderByItem(null, "wo").size, 0);
  assert.deepEqual(model.ordersOf(orders, "other").map((order) => order.id), ["m5"]);
});

test("the needs list carries the shortages of the survey and what is still to be ordered", () => {
  const needs = model.materialNeeds(fixture(), WO);
  // 100 ÷ 10 = 10 สูตร: ยาง 500 (มี 10 → ขาด 490) เคมี 5 × 10 × 1.1 = 55 ชิ้นงาน 100 (ทำเอง ไม่มี BOM)
  assert.deepEqual(needs.map((need) => [need.code, need.net, need.onOrder, need.suggest, need.purchasable]), [
    ["RM-CHEM", 55, 0, 55, true], ["RM-NR", 490, 0, 490, true], ["WIP-PART", 100, 0, 0, false],
  ]);
  const partly = model.materialNeeds(fixture({ material_orders: [material("m1", "ordered", [["nr", 400]]), material("m2", "draft", [["chem", 55]])] }), WO);
  assert.equal(partly.find((need) => need.code === "RM-NR").suggest, 90, "490 short − 400 already on order");
  assert.equal(partly.find((need) => need.code === "RM-NR").onOrder, 400);
  assert.equal(partly.find((need) => need.code === "RM-CHEM").suggest, 0, "fully ordered");
  const over = model.materialNeeds(fixture({ material_orders: [material("m1", "ordered", [["nr", 9999]])] }), WO);
  assert.equal(over.find((need) => need.code === "RM-NR").suggest, 0, "never negative");
});

test("a received order lowers the shortage through stock, a cancelled one does not count", () => {
  const received = model.materialNeeds(fixture({ nr: { stock: 510 }, material_orders: [material("m1", "received", [["nr", 500]])] }), WO);
  assert.ok(!received.some((need) => need.code === "RM-NR"), "the rubber is covered by the stock the receipt added");
  const cancelled = model.materialNeeds(fixture({ material_orders: [material("m1", "cancelled", [["nr", 490]])] }), WO);
  assert.equal(cancelled.find((need) => need.code === "RM-NR").suggest, 490);
});

test("the needs list is null when the product has no approved BOM", () => {
  assert.equal(model.materialNeeds({ ...fixture(), boms: [] }, WO), null);
  assert.equal(model.materialNeeds(fixture(), { ...WO, planned_qty: 0 }), null);
});

test("form values become the RPC parameters: blank and zero quantities are skipped, extras are added", () => {
  const payload = model.materialPayload({
    production_order_id: " wo ", supplier: "  ผู้ขาย  ", expected_date: "2026-11-01", note: " x ",
    "qty:nr": "490", "qty:chem": "", "qty:part": "0", "qty:old": "1.5",
    extra_item_1: "box", extra_qty_1: "10", extra_item_2: "", extra_qty_2: "", extra_item_3: "", extra_qty_3: "5",
  }, null);
  assert.deepEqual(payload, {
    p_id: null, p_version: null, p_production_order_id: "wo", p_supplier: "ผู้ขาย", p_expected_date: "2026-11-01", p_note: "x",
    p_lines: [{ item_id: "nr", quantity: 490 }, { item_id: "old", quantity: 1.5 }, { item_id: "box", quantity: 10 }, { item_id: "", quantity: 5 }],
  });
  const edit = model.materialPayload({ production_order_id: "other" }, { id: "m1", version: 4, production_order_id: "wo" });
  assert.equal(edit.p_id, "m1");
  assert.equal(edit.p_version, 4);
  assert.equal(edit.p_production_order_id, "wo", "an existing draft keeps its production order");
  assert.equal(edit.p_expected_date, null);
  assert.deepEqual(edit.p_lines, []);
  assert.deepEqual(model.materialPayload(null, null).p_lines, []);
});

test("validation explains every problem the database would reject", () => {
  const data = fixture();
  const orders = [WO, { id: "draft", status: "draft" }];
  const good = { p_production_order_id: "wo", p_supplier: "", p_expected_date: "2026-11-01", p_note: "", p_lines: [{ item_id: "nr", quantity: 5 }] };
  const check = (changes) => model.validateMaterialPayload({ ...good, ...changes }, data.items, orders, "2026-10-07").join(" | ");
  assert.equal(check({}), "");
  assert.equal(check({ p_expected_date: "2026-10-07" }), "", "today is allowed");
  assert.match(check({ p_production_order_id: null }), /เลือกใบสั่งผลิต/);
  assert.match(check({ p_production_order_id: "draft" }), /ออกใบสั่งงานแล้ว/);
  assert.match(check({ p_production_order_id: "ghost" }), /ออกใบสั่งงานแล้ว/);
  assert.match(check({ p_expected_date: null }), /วันที่คาดว่าจะได้รับ/);
  assert.match(check({ p_expected_date: "2026-10-06" }), /ไม่ก่อนวันนี้/);
  assert.match(check({ p_supplier: "x".repeat(201) }), /200/);
  assert.match(check({ p_note: "x".repeat(1001) }), /1,000/);
  assert.match(check({ p_lines: [] }), /อย่างน้อย 1 รายการ/);
  assert.match(check({ p_lines: Array.from({ length: 101 }, () => ({ item_id: "nr", quantity: 1 })) }), /ไม่เกิน 100/);
  assert.match(check({ p_lines: [{ item_id: "", quantity: 1 }] }), /เลือกวัตถุดิบ/);
  assert.match(check({ p_lines: [{ item_id: "part", quantity: 1 }] }), /จัดซื้อได้/);
  assert.match(check({ p_lines: [{ item_id: "old", quantity: 1 }] }), /จัดซื้อได้/);
  assert.match(check({ p_lines: [{ item_id: "ghost", quantity: 1 }] }), /จัดซื้อได้/);
  assert.match(check({ p_lines: [{ item_id: "nr", quantity: 1 }, { item_id: "nr", quantity: 2 }] }), /ซ้ำ/);
  for (const quantity of [null, 0, -1, NaN, Infinity, 0.00001, 1000000001]) assert.match(check({ p_lines: [{ item_id: "nr", quantity }] }), /ปริมาณ/, String(quantity));
});

test("the timeline lists one order's history oldest first", () => {
  const history = [{ id: 3, order_id: "m1", action: "place" }, { id: 2, order_id: "m2", action: "create" }, { id: 1, order_id: "m1", action: "create" }];
  assert.deepEqual(model.orderTimeline(history, "m1").map((entry) => entry.action), ["create", "place"]);
  assert.deepEqual(model.orderTimeline(null, "m1"), []);
});
