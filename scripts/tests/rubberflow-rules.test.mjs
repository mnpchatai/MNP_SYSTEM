import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// กฎ/สเปก/สูตรคำนวณ/การจัดรูปแบบ (modules/rubberflow-rules.js) และมุมมองที่คำนวณจาก state (modules/rubberflow-derive.js) ของ RubberFlow
const require = createRequire(import.meta.url);
const rules = require("../../modules/rubberflow-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = rules;
const derive = require("../../modules/rubberflow-derive.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = require("../../modules/rubberflow-actions.js");
const seed = require("../../modules/rubberflow-seed.js");

const NOW = Date.parse("2026-10-28T10:00:00+07:00");
const { DAY, HOUR } = rules;

test("inSpec judges target ± tol and one-sided limits, and blank values never pass", () => {
  const spec = rules.SPECS.extrusion.thickness;
  assert.equal(rules.inSpec(2.5, spec), true);
  assert.equal(rules.inSpec(2.62, spec), true, "exactly on the edge counts (floating point tolerance)");
  assert.equal(rules.inSpec(2.63, spec), false);
  assert.equal(rules.inSpec("", spec), false);
  assert.equal(rules.inSpec(null, spec), false);
  assert.equal(rules.inSpec("abc", spec), false);
  assert.equal(rules.inSpec(9.9, rules.SPECS.lab.tensile), false, "below a minimum");
  assert.equal(rules.inSpec(10, rules.SPECS.lab.tensile), true);
  assert.equal(rules.specText(spec), "2.5 ± 0.12 mm");
  assert.equal(rules.specText(rules.SPECS.lab.tensile), "≥ 10 MPa");
  assert.deepEqual(rules.specLimits(spec), { lsl: 2.38, usl: 2.62 });
  assert.deepEqual(rules.specLimits(rules.SPECS.lab.tensile), { lsl: 10, usl: undefined });
});

test("weighing tolerance is 1.5% but never under 20 g, and recipe lines split the batch by PHR", () => {
  assert.equal(rules.weighTolerance(10), 0.15);
  assert.equal(rules.weighTolerance(0.5), 0.02);
  const recipe = { batchKg: 100, items: [{ materialCode: "A", phr: 100 }, { materialCode: "B", phr: 50 }, { materialCode: "C", phr: 50 }] };
  const lines = rules.recipeLines(recipe);
  assert.deepEqual(lines.map((line) => +line.kgPerBatch.toFixed(3)), [50, 25, 25]);
  assert.equal(rules.totalPhr(recipe), 200);
  assert.deepEqual(rules.recipeLines({ batchKg: 10, items: [] }), []);
  // ผสมสองขั้น: บรรทัดไม่ระบุขั้น = ขั้น 1 เรียงขั้น 1 ก่อนขั้น 2 (ลำดับเดิมในขั้นเดียวกัน)
  const staged = { batchKg: 100, items: [{ materialCode: "S", phr: 50, stage: 2 }, { materialCode: "A", phr: 100 }, { materialCode: "B", phr: 50, stage: 1 }], stages: [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }] };
  assert.deepEqual(rules.recipeLines(staged).map((line) => [line.materialCode, line.stage]), [["A", 1], ["B", 1], ["S", 2]]);
  assert.equal(rules.recipeStage(staged, 2).dumpTemp, 130);
  assert.equal(rules.recipeStage({ stages: [] }, 1), null);
  assert.equal(rules.recipeStage(undefined, 1), null);
  // สูตร/สินค้าบนจอ: รหัสสูตร (+ รหัสสินค้าถ้ามี) ไม่มีชื่อ
  assert.equal(rules.recipeLabel({ id: "RC-1", productCode: "P-1" }), "RC-1 · P-1");
  assert.equal(rules.recipeLabel({ id: "RC-1", productCode: "" }), "RC-1");
  assert.equal(rules.orderLabel({ recipeId: "RC-1", productCode: "P-1" }), "RC-1 · P-1");
  assert.equal(rules.orderLabel({ recipeId: "RC-1" }), "RC-1");
});

test("lotState and FEFO allocation skip held, empty and expired lots and take the earliest expiry first", () => {
  const lots = [
    { lotNo: "L-late", materialCode: "X", qtyKg: 100, expiry: NOW + 300 * DAY, receivedAt: NOW - DAY, status: "available" },
    { lotNo: "L-soon", materialCode: "X", qtyKg: 30, expiry: NOW + 10 * DAY, receivedAt: NOW - 5 * DAY, status: "available" },
    { lotNo: "L-hold", materialCode: "X", qtyKg: 500, expiry: NOW + 5 * DAY, receivedAt: NOW - 9 * DAY, status: "hold" },
    { lotNo: "L-expired", materialCode: "X", qtyKg: 500, expiry: NOW - DAY, receivedAt: NOW - 90 * DAY, status: "available" },
    { lotNo: "L-empty", materialCode: "X", qtyKg: 0, expiry: NOW + DAY, receivedAt: NOW - 90 * DAY, status: "available" },
    { lotNo: "L-other", materialCode: "Y", qtyKg: 500, expiry: NOW + DAY, receivedAt: NOW, status: "available" },
  ];
  assert.deepEqual(lots.map((lot) => rules.lotState(lot, NOW)), ["available", "available", "hold", "expired", "empty", "available"]);
  const result = rules.allocateFefo(lots, "X", 50, NOW);
  assert.deepEqual(result, { picks: [{ lotNo: "L-soon", kg: 30 }, { lotNo: "L-late", kg: 20 }], shortage: 0 });
  assert.deepEqual(rules.allocateFefo(lots, "X", 200, NOW, { "L-late": 90 }), { picks: [{ lotNo: "L-soon", kg: 30 }, { lotNo: "L-late", kg: 10 }], shortage: 160 }, "reserved kilos are not available twice");
  assert.deepEqual(rules.allocateFefo(lots, "Z", 1, NOW), { picks: [], shortage: 1 });
});

test("I-MR statistics use MR̄/d2 for Cp/Cpk and the overall SD for Ppk, with verdict bands", () => {
  const values = [2.50, 2.52, 2.48, 2.51, 2.49, 2.50, 2.53, 2.47];
  const s = rules.stats(values, 2.38, 2.62);
  assert.equal(s.n, 8);
  assert.ok(Math.abs(s.mean - 2.5) < 1e-9);
  const mrBar = values.slice(1).reduce((sum, value, index) => sum + Math.abs(value - values[index]), 0) / 7;
  assert.ok(Math.abs(s.sdWithin - mrBar / 1.128) < 1e-12);
  assert.ok(Math.abs(s.cp - 0.24 / (6 * s.sdWithin)) < 1e-12);
  assert.ok(Math.abs(s.cpk - Math.min(2.62 - s.mean, s.mean - 2.38) / (3 * s.sdWithin)) < 1e-12);
  assert.ok(Math.abs(s.ppk - Math.min(2.62 - s.mean, s.mean - 2.38) / (3 * s.sd)) < 1e-12);
  assert.equal(rules.stats([1], 0, 2), null, "one value is not enough");
  const oneSided = rules.stats(values, 2.4, undefined);
  assert.equal(oneSided.cp, undefined);
  assert.ok(oneSided.cpk > 0);
  const flat = rules.stats([1, 1, 1], 0, 2);
  assert.equal(flat.cpk, undefined, "zero sigma gives no index");
  assert.deepEqual(rules.cpkVerdict(undefined), { tone: "muted", text: "ข้อมูลไม่พอ" });
  assert.equal(rules.cpkVerdict(1.7).tone, "good");
  assert.equal(rules.cpkVerdict(1.4).text, "ผ่านเกณฑ์ (≥ 1.33)");
  assert.equal(rules.cpkVerdict(1.1).tone, "warn");
  assert.equal(rules.cpkVerdict(0.9).tone, "bad");
});

test("Thai date/number/duration formatting and date input round trip", () => {
  const at = new Date(2026, 9, 28, 9, 5).getTime();
  assert.equal(rules.fmtDate(at), "28 ต.ค. 2569");
  assert.equal(rules.fmtDateTime(at), "28 ต.ค. 2569 09:05");
  assert.equal(rules.fmtDate(0), "-");
  assert.equal(rules.fmtNum(1234.567, 2), "1,234.57");
  assert.equal(rules.fmtNum("x"), "-");
  assert.equal(rules.fmtDuration(0), "ครบแล้ว");
  assert.equal(rules.fmtDuration(90 * 60000), "1 ชม. 30 นาที");
  assert.equal(rules.fmtDuration(5 * 60000), "5 นาที");
  assert.equal(rules.ymd(at), "20261028");
  assert.equal(rules.toInputDate(at), "2026-10-28");
  assert.equal(rules.fromInputDate("2026-10-28"), new Date(2026, 9, 28).getTime());
  assert.ok(Number.isNaN(rules.fromInputDate("")), "an empty date is NaN so actions can reject it");
  assert.deepEqual(rules.niceScale(0, 97, 4).ticks, [0, 50, 100]);
  assert.deepEqual(rules.niceScale(0, 97, 8).ticks, [0, 20, 40, 60, 80, 100]);
  assert.deepEqual(rules.niceScale(5, 5, 3).ticks.length > 1, true, "a flat range still gets a scale");
});

test("alerts rank bad before warn before info and cover expiry, molds, holds, resting, transfers, due dates and NCRs", () => {
  const d = seed.buildSeed(NOW);
  const alerts = derive.buildAlerts(d, NOW);
  const tones = alerts.map((alert) => alert.tone);
  const rank = { bad: 0, warn: 1, info: 2 };
  assert.deepEqual(tones, [...tones].sort((a, b) => rank[a] - rank[b]));
  assert.ok(alerts.some((alert) => alert.title.startsWith("ล็อตหมดอายุ")), "the seed has one expired lot");
  assert.ok(alerts.some((alert) => alert.title.startsWith("QC Hold")), "the seed has one held extrusion lot");
  assert.ok(alerts.some((alert) => alert.title.startsWith("กำลังบ่มยาง")), "a batch mixed 1.5 hours ago is still resting");
  assert.ok(alerts.some((alert) => alert.title.startsWith("รอรับมอบ")), "a transfer to finishing is in transit");
  assert.ok(alerts.some((alert) => alert.title.startsWith("ใกล้กำหนดส่ง")), "the urgent order is due in two days");
  assert.ok(alerts.some((alert) => alert.title.startsWith("NCR เปิดอยู่")));
  for (const alert of alerts) assert.ok(["warehouse", "molds", "quality", "mixing", "wip", "orders"].includes(alert.module), alert.module);
});

test("lookupCode finds every document kind by code (case-insensitive) and traceability trees link boxes to raw-material lots", () => {
  const d = seed.buildSeed(NOW);
  assert.equal(derive.lookupCode(d, d.orders[0].id).kind, "order");
  assert.equal(derive.lookupCode(d, d.lots[0].id.toLowerCase()).kind, "lot");
  assert.equal(derive.lookupCode(d, d.fgBoxes[0].id).kind, "box");
  assert.equal(derive.lookupCode(d, d.materialLots[0].lotNo).kind, "material");
  assert.equal(derive.lookupCode(d, d.requisitions[0].id).kind, "requisition");
  assert.equal(derive.lookupCode(d, d.transfers[0].id).kind, "transfer");
  assert.equal(derive.lookupCode(d, "MD-OR-24").kind, "mold");
  assert.equal(derive.lookupCode(d, "nope"), null);
  assert.equal(derive.lookupCode(d, "  "), null);

  const box = d.fgBoxes.find((row) => row.status === "in_stock");
  const finishing = d.lots.find((lot) => lot.id === box.lotId);
  const backward = derive.backwardTree(d, finishing.id);
  const kinds = [];
  const walk = (node) => { kinds.push(node.kind); (node.children ?? []).forEach(walk); };
  walk(backward);
  assert.ok(kinds.includes("requisition") && kinds.includes("material"), "the chain reaches the requisition and its raw-material lots");
  assert.equal(kinds.filter((kind) => kind === "lot").length, 4, "finishing → curing → extrusion → mixing");
  let materialNode = null;
  const findMaterial = (node) => { if (node.kind === "material" && !materialNode) materialNode = node; (node.children ?? []).forEach(findMaterial); };
  findMaterial(backward);
  const material = derive.lookupCode(d, materialNode.id);
  assert.equal(material.kind, "material");
  const forward = derive.forwardTree(d, material);
  const boxes = [];
  const collect = (node) => { if (node.kind === "box") boxes.push(node.id); (node.children ?? []).forEach(collect); };
  collect(forward);
  assert.ok(boxes.includes(box.id), "going forward from that raw-material lot reaches the same box");
  assert.equal(derive.backwardTree(d, "nope"), null);
  assert.equal(derive.parentLotIds(d, d.lots.find((lot) => lot.stage === "mixing")).length, 0, "a mixing lot has no parent lot (its source is a requisition)");
  assert.ok(HOUR > 0);
});

// ---------- ความต้องการเคมีของ WO เทียบสต็อก (สั่งซื้อ) ----------
test("chemicalNeeds: need of the asked WOs against on-hand, reservations, other open WOs and what is on order; expired / held lots, closed WOs and received lines do not count", () => {
  const recipe = { id: "R1", revision: 1, status: "approved", uom: "m", batchKg: 50, yieldPerKg: 6, dumpTol: 5, restHours: 4, stages: [], items: [{ materialCode: "EPDM", phr: 100, stage: 1 }, { materialCode: "CB", phr: 60, stage: 2 }] };
  const lot = (lotNo, materialCode, qtyKg, extra = {}) => ({ lotNo, materialCode, qtyKg, initialKg: qtyKg, expiry: NOW + 90 * DAY, receivedAt: NOW - DAY, status: "available", ...extra });
  const wo = (id, status, extra = {}) => ({ id, status, recipeId: "R1", recipeRevision: 1, targetQty: 6, targetKg: null, ...extra });
  const data = {
    materials: [{ code: "EPDM", name: "ยาง EPDM", safetyKg: 10 }, { code: "CB", name: "เขม่าดำ" }],
    recipes: [recipe],
    orders: [
      wo("WO-ASK", "planned", { targetKg: 80 }), // 80 kg → EPDM 50, CB 30
      wo("WO-OTHER", "planned", { targetQty: 120 }), // 120 / 6 = 20 kg → EPDM 12.5, CB 7.5
      wo("WO-RUN", "in_progress", { targetKg: 80 }), // 80 − 50 (1 batch requisitioned) = 30 kg → EPDM 18.75, CB 11.25
      wo("WO-OFF", "cancelled", { targetKg: 999 }),
      wo("WO-DONE", "completed", { targetKg: 999 }),
      wo("WO-NORECIPE", "planned", { recipeId: "NOPE" }),
    ],
    requisitions: [
      { id: "REQ-1", orderId: "WO-RUN", batches: 1, totalKg: 50, status: "weighing", lines: [{ materialCode: "EPDM", targetKg: 5, actualKg: null }, { materialCode: "EPDM", targetKg: 3, actualKg: 3 }] },
      { id: "REQ-2", orderId: "WO-OTHER", batches: 1, totalKg: 50, status: "consumed", lines: [{ materialCode: "EPDM", targetKg: 40, actualKg: 40 }] },
    ],
    materialLots: [
      lot("E1", "EPDM", 20), lot("E-OLD", "EPDM", 100, { expiry: NOW - DAY }), lot("E-HOLD", "EPDM", 100, { status: "hold" }), lot("E-EMPTY", "EPDM", 0),
      lot("C1", "CB", 100),
    ],
    purchaseOrders: [
      { id: "PO-1", status: "ordered", lines: [{ materialCode: "EPDM", qtyKg: 40, receivedKg: null }, { materialCode: "CB", qtyKg: 10, receivedKg: 9 }] },
      { id: "PO-2", status: "cancelled", lines: [{ materialCode: "EPDM", qtyKg: 500, receivedKg: null }] },
      { id: "PO-3", status: "received", lines: [{ materialCode: "EPDM", qtyKg: 500, receivedKg: 500 }] },
    ],
  };
  // WO-RUN: 1 batch requisitioned covers 50 of 80 kg, so its remaining need is 30 kg; WO-OTHER's requisition is already consumed, so it is covered up to 50 kg (more than its 20 kg need): nothing left
  const out = rules.chemicalNeeds(data, ["WO-ASK", "WO-OFF", "WO-NORECIPE", "WO-GHOST"], NOW);
  assert.deepEqual(out.counted, ["WO-ASK"]);
  assert.deepEqual(out.skipped, [{ woId: "WO-NORECIPE", reason: "ไม่พบสูตร" }, { woId: "WO-GHOST", reason: "ไม่พบ WO" }], "a closed WO is simply not a need; a WO without recipe is reported");
  const epdm = out.rows.find((row) => row.materialCode === "EPDM");
  // on hand 20 (expired / held / empty lots ignored) − reserved 5 (the weighed line already left the lot) − other need 18.75 (WO-OTHER is covered by its requisition) + on order 40 = 36.25
  assert.deepEqual(
    [epdm.needKg, epdm.onHandKg, epdm.reservedKg, epdm.otherNeedKg, epdm.onOrderKg, epdm.availableKg, epdm.shortageKg],
    [50, 20, 5, 18.75, 40, 36.25, 13.75],
  );
  assert.equal(epdm.safetyKg, 10);
  assert.equal(epdm.orderKg, 23.75, "default order = shortage + safety stock");
  assert.equal(epdm.name, "ยาง EPDM");
  const cb = out.rows.find((row) => row.materialCode === "CB");
  assert.deepEqual([cb.needKg, cb.onHandKg, cb.otherNeedKg, cb.onOrderKg, cb.shortageKg, cb.orderKg], [30, 100, 11.25, 0, 0, 0], "the received PO line (even partly) is not on order any more; nothing short = nothing to order");
  assert.equal(out.anyShort, true);
  assert.deepEqual(out.rows.map((row) => row.materialCode), ["CB", "EPDM"], "sorted by code");

  // the demo mode takes the kilograms out of the lot only when the whole requisition is weighed, so every line of an open requisition is reserved
  const demo = rules.chemicalNeeds(data, ["WO-ASK"], NOW, { remote: false });
  assert.equal(demo.rows.find((row) => row.materialCode === "EPDM").reservedKg, 8);
  // asking for another open WO counts its remaining need too (and it is no longer an "other" need)
  const both = rules.chemicalNeeds(data, ["WO-ASK", "WO-RUN"], NOW);
  assert.deepEqual(both.counted, ["WO-ASK", "WO-RUN"]);
  assert.equal(both.rows.find((row) => row.materialCode === "EPDM").needKg, 68.75);
  // nothing asked / nothing countable
  assert.deepEqual(rules.chemicalNeeds(data, [], NOW).rows, []);
  assert.equal(rules.chemicalNeeds(data, ["WO-NORECIPE"], NOW).anyShort, false);
  assert.deepEqual(rules.chemicalNeeds({}, ["X"], NOW).skipped, [{ woId: "X", reason: "ไม่พบ WO" }], "missing lists are empty");
  // plenty of stock: no shortage, no order quantity
  const plenty = rules.chemicalNeeds({ ...data, materialLots: [lot("E2", "EPDM", 1000), lot("C2", "CB", 1000)] }, ["WO-ASK"], NOW);
  assert.equal(plenty.anyShort, false);
  assert.deepEqual(plenty.rows.map((row) => row.orderKg), [0, 0]);
  // a negative balance (other WOs want more than the stock) stays negative so the shortage is explained, and counts as short
  const crowded = rules.chemicalNeeds({ ...data, materialLots: [lot("E3", "EPDM", 10)], purchaseOrders: [] }, ["WO-ASK"], NOW);
  const row = crowded.rows.find((item) => item.materialCode === "EPDM");
  assert.deepEqual([row.availableKg, row.shortageKg], [-13.75, 50 - (10 - 5 - 18.75)], "10 − 5 − 18.75 = −13.75 → available stays negative, shortage 63.75");
  assert.equal(rules.suggestOrderKg(0, 5), 0);
  assert.equal(rules.suggestOrderKg(2.5, 5), 7.5);
  assert.equal(rules.suggestOrderKg(2.5, -1), 2.5);
});

test("chemicalNeeds uses the WO's own recipe revision and the kilograms of the BOM job when the WO has them", () => {
  const item = (code, phr) => ({ materialCode: code, phr, stage: 1 });
  const base = { yieldPerKg: 10, batchKg: 40, status: "approved", uom: "m", stages: [] };
  const recipes = [{ ...base, id: "R", revision: 1, status: "superseded", items: [item("A", 100)] }, { ...base, id: "R", revision: 2, items: [item("B", 100)] }];
  const orders = [{ id: "W1", status: "released", recipeId: "R", recipeRevision: 1, targetQty: 100, targetKg: 4 }, { id: "W2", status: "released", recipeId: "R", recipeRevision: 2, targetQty: 100 }];
  const out = rules.chemicalNeeds({ orders, recipes }, ["W1", "W2"], NOW);
  assert.deepEqual(out.rows.map((row) => [row.materialCode, row.needKg]), [["A", 4], ["B", 10]], "W1 keeps revision 1 and its targetKg; W2 derives kilograms from quantity ÷ yield");
  assert.ok(out.rows.every((row) => row.shortageKg === row.needKg && row.availableKg === 0));
});
