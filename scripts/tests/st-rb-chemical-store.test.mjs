import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// คลังเคมี ST (กลาง) กับคลังเคมีของ RB (20261220010000_st_rb_chemical_store.sql): กฎ (modules/rubberflow-rules.js) คำสั่ง (modules/rubberflow-actions.js)
// สิทธิ์ของหน้า (modules/rubberflow-store.js) และฐานข้อมูลจำลอง (scripts/pilot-harness-mock.mjs ตรงกับ private.rf_save_chem_docs) ทั้งฝั่งอนุญาตและปฏิเสธ
const require = createRequire(import.meta.url);
const rules = require("../../modules/rubberflow-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = rules;
const A = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = A;
const seed = require("../../modules/rubberflow-seed.js");
const storeApi = require("../../modules/rubberflow-store.js");

const NOW = Date.parse("2026-11-24T10:00:00+07:00");
const DAY = 86400000;
const TODAY = rules.ymd(NOW);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });

// ---------- ข้อมูลในเครื่องขนาดเล็ก ----------
const lot = (lotNo, materialCode, qtyKg, rbKg, days, extra = {}) => ({ lotNo, materialCode, qtyKg, rbKg, initialKg: qtyKg + rbKg, expiry: NOW + days * DAY, receivedAt: NOW - 30 * DAY, supplier: "-", location: "", status: "available", coa: false, ...extra });
function state() {
  return {
    version: 2, counters: {}, users: [], audit: [], orders: [], recipes: [], lots: [], transfers: [], fgBoxes: [], qcRecords: [], ncrs: [], molds: [], purchaseOrders: [], chemDocs: [],
    materials: [{ code: "MAT-A", name: "ยาง", active: true }, { code: "MAT-B", name: "เขม่า", active: true }, { code: "MAT-OFF", name: "เลิกใช้", active: false }],
    materialLots: [
      lot("A-EXP", "MAT-A", 50, 0, -1), // หมดอายุแล้ว
      lot("A-HOLD", "MAT-A", 50, 0, 5, { status: "hold" }), // หมดอายุก่อนสุด แต่กักกัน
      lot("A-1", "MAT-A", 100, 0, 10),
      lot("A-2", "MAT-A", 300, 0, 200),
      lot("B-1", "MAT-B", 200, 0, 100),
    ],
    requisitions: [],
  };
}
const kg = (d, lotNo) => { const row = d.materialLots.find((item) => item.lotNo === lotNo); return [row.qtyKg, row.rbKg]; };
const rbUser = { name: "พนักงาน RB", rb: true, db: true };
const stUser = { name: "พนักงาน ST", st: true, db: true };
const plannerUser = { name: "ผู้จัดการ RB", planner: true, rb: true, rbHead: true, roleCode: "department_manager", dept: "RB", db: true };
// ผู้จัดการแผนก WH: อยู่ในกลุ่มวางแผนของ BOM (planner) แต่ไม่ใช่ฝ่ายวางแผนคลังเคมี
const whHeadUser = { name: "ผู้จัดการ WH", planner: true, wh: true, roleCode: "department_manager", dept: "WH", db: true };
const qaUser = { name: "พนักงาน QA", qa: true, db: true };
const remote = (user, now = NOW) => ({ now, user, remote: true });

test("rules: each lot has an ST and an RB balance; FEFO, the lot state and the issue preview follow the store asked for", () => {
  const d = state();
  d.materialLots.find((row) => row.lotNo === "A-1").rbKg = 20;
  assert.deepEqual([rules.lotKg(d.materialLots[2], "ST"), rules.lotKg(d.materialLots[2], "RB"), rules.lotKg({ qtyKg: 5 }, "RB")], [100, 20, 0], "a lot from before the split holds nothing in the RB store");
  assert.equal(rules.lotState(d.materialLots[3], NOW, "RB"), "empty");
  assert.equal(rules.lotState(d.materialLots[3], NOW), "available", "the ST store is the default");
  assert.equal(rules.lotState(d.materialLots[1], NOW, "RB"), "hold", "a hold applies to the lot in both stores");
  assert.deepEqual(rules.allocateFefo(d.materialLots, "MAT-A", 30, NOW, {}, "RB"), { picks: [{ lotNo: "A-1", kg: 20 }], shortage: 10 }, "RB FEFO takes only RB balances");
  const request = { id: "CR-1", kind: "request", status: "open", lines: [{ materialCode: "MAT-A", qtyKg: 120, issuedKg: 0, issues: [] }, { materialCode: "MAT-B", qtyKg: 30, issuedKg: 10, issues: [] }] };
  const preview = rules.chemIssuePreview(d, request, [], NOW);
  assert.deepEqual(preview.map((row) => [row.materialCode, row.openKg, row.kg, row.picks.map((pick) => [pick.lotNo, pick.kg]), row.shortageKg]),
    [["MAT-A", 120, 120, [["A-1", 100], ["A-2", 20]], 0], ["MAT-B", 20, 20, [["B-1", 20]], 0]], "the preview skips the expired and the held lot and offers what is still open");
  assert.deepEqual(rules.chemIssuePreview(d, request, ["500", 0], NOW).map((row) => [row.kg, row.picks.length]), [[120, 2], [0, 0]], "never more than the line still needs; 0 = not this round");
  // ใบเบิกเดิมของคลัง ST ที่ค้างชั่งจองยอดของล็อต: ST จ่ายส่วนนั้นให้ RB ไม่ได้
  d.requisitions.push({ id: "REQ-OLD", status: "weighing", lines: [{ materialCode: "MAT-A", lotNo: "A-1", targetKg: 90, actualKg: null }] });
  assert.deepEqual(rules.weighingReservedKg(d.requisitions, "ST"), { "A-1": 90 });
  assert.deepEqual(rules.weighingReservedKg(d.requisitions, "RB"), {}, "an old requisition belongs to the ST store");
  assert.deepEqual(rules.chemIssuePreview(d, request, [120], NOW)[0].picks.map((pick) => [pick.lotNo, pick.kg]), [["A-1", 10], ["A-2", 110]]);
  assert.deepEqual([rules.requisitionStore({}), rules.requisitionStore({ store: "RB" })], ["ST", "RB"]);
});

test("rules: in transit, the count ceiling, the work lists and the usage of the RB store against the recipe", () => {
  const d = state();
  d.materialLots.find((row) => row.lotNo === "A-1").qtyKg = 40;
  d.materialLots.find((row) => row.lotNo === "A-1").rbKg = 50; // ยอดรับเข้า 100 = ST 40 + RB 50 + คืนระหว่างทาง 6 + ใช้ไป 4
  d.chemDocs = [
    { id: "CR-2", kind: "request", status: "partial", createdAt: NOW - 2, lines: [{ materialCode: "MAT-A", qtyKg: 80, issuedKg: 60, issues: [{ lotNo: "A-1", kg: 60, at: NOW - 2 }] }] },
    { id: "CR-1", kind: "request", status: "open", createdAt: NOW - 3, lines: [{ materialCode: "MAT-B", qtyKg: 5, issuedKg: 0, issues: [] }] },
    { id: "CR-0", kind: "request", status: "closed", createdAt: NOW - 9, lines: [{ materialCode: "MAT-A", qtyKg: 9, issuedKg: 0, issues: [] }] },
    { id: "CT-1", kind: "return", status: "pending", createdAt: NOW - 1, lines: [{ lotNo: "A-1", materialCode: "MAT-A", kg: 6, receivedKg: null }] },
    { id: "CT-0", kind: "return", status: "rejected", createdAt: NOW - 1, lines: [{ lotNo: "A-1", materialCode: "MAT-A", kg: 3, receivedKg: null }] },
    { id: "CC-1", kind: "count", status: "done", createdAt: NOW - 1, lines: [{ lotNo: "A-1", materialCode: "MAT-A", beforeKg: 54, countedKg: 50 }] },
  ];
  d.requisitions = [
    { id: "REQ-RB", store: "RB", status: "issued", createdAt: NOW - 1, lines: [{ materialCode: "MAT-A", lotNo: "A-1", targetKg: 10, actualKg: 10, returnedKg: 2, returnedAt: NOW }] },
    { id: "REQ-ST", status: "issued", createdAt: NOW - 1, lines: [{ materialCode: "MAT-A", lotNo: "A-2", targetKg: 99, actualKg: 99 }] },
  ];
  assert.deepEqual(rules.chemRequestsToIssue(d).map((doc) => doc.id), ["CR-1", "CR-2"], "open and partial requests, oldest first");
  assert.deepEqual(rules.chemReturnsPending(d).map((doc) => doc.id), ["CT-1"]);
  assert.equal(rules.lotInTransitKg(d, "A-1"), 6);
  assert.equal(rules.rbCountCapKg(d, d.materialLots.find((row) => row.lotNo === "A-1")), 54, "received 100 - 40 in ST - 6 on the way back");
  assert.deepEqual(rules.chemLineOpenKg(d.chemDocs[0].lines[0]), 20);
  const usage = rules.rbUsage(d);
  assert.deepEqual(usage.rows, [{ materialCode: "MAT-A", receivedKg: 60, recipeKg: 8, returnedKg: 6, expectedKg: 46, countAdjustKg: -4, onHandKg: 50 }],
    "received from ST − recipe use of RB requisitions (net of what came back) − returns that were not rejected; the count adjustment beside it; the ST requisition does not count");
  assert.deepEqual(usage.totals, { receivedKg: 60, recipeKg: 8, returnedKg: 6, expectedKg: 46, countAdjustKg: -4, onHandKg: 50 });
  assert.deepEqual(rules.rbUsage(d, { since: NOW - 1 }).rows[0].receivedKg, 0, "a time window drops earlier issues");
  // ความต้องการเคมีคิดคงเหลือ ST + RB (ล็อตกักกัน / หมดอายุไม่นับ)
  d.orders = [{ id: "WO-1", status: "released", recipeId: "R", targetKg: 1000 }];
  d.recipes = [{ id: "R", revision: 1, status: "approved", batchKg: 1000, items: [{ materialCode: "MAT-A", phr: 1 }] }];
  const need = rules.chemicalNeeds(d, ["WO-1"], NOW).rows[0];
  assert.equal(need.onHandKg, 40 + 50 + 300, "both stores of the usable lots");
  // ใบเบิกที่รอรับคืนแยกตามคลังของใบ
  d.orders.push({ id: "WO-X", status: "cancelled" });
  d.requisitions.forEach((row) => { row.orderId = "WO-X"; delete row.lines[0].returnedKg; delete row.lines[0].returnedAt; });
  assert.deepEqual([rules.returnableRequisitions(d).length, rules.returnableRequisitions(d, "RB").map((row) => row.id), rules.returnableRequisitions(d, "ST").map((row) => row.id)], [2, ["REQ-RB"], ["REQ-ST"]]);
});

test("actions: RB asks, ST issues FEFO in part, closes the rest; a request is cancelled only before anything was issued", () => {
  const d = state();
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: "" }] }, remote(rbUser)), /อย่างน้อย 1 รายการ/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "NOPE", qtyKg: 1 }] }, remote(rbUser)), /ไม่พบวัตถุดิบ NOPE/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-OFF", qtyKg: 1 }] }, remote(rbUser)), /เลิกใช้แล้ว/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: 1 }, { materialCode: "MAT-A", qtyKg: 2 }] }, remote(rbUser)), /ซ้ำ/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: -1 }] }, remote(rbUser)), /มากกว่า 0/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: 1 }] }, remote(stUser)), /ไม่มีสิทธิ์: ขอเบิกเคมี/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: 1 }] }, remote(qaUser)), /ไม่มีสิทธิ์/);
  rejects(() => A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: 1 }] }, remote(whHeadUser)), /ไม่มีสิทธิ์: ขอเบิกเคมี/, "a department manager outside RB is not the chemical planning group");
  const id =A.requestChemicals(d, { note: " เติมคลัง ", lines: [{ materialCode: "MAT-A", qtyKg: "120" }, { materialCode: "MAT-B", qtyKg: 30 }, { materialCode: "MAT-OFF", qtyKg: "" }] }, remote(rbUser));
  assert.equal(id, `CR-${TODAY}-01`);
  const doc = d.chemDocs[0];
  assert.deepEqual([doc.kind, doc.status, doc.note, doc.reason, doc.createdBy, doc.lines], ["request", "open", "เติมคลัง", "", "พนักงาน RB",
    [{ materialCode: "MAT-A", qtyKg: 120, issuedKg: 0, issues: [] }, { materialCode: "MAT-B", qtyKg: 30, issuedKg: 0, issues: [] }]]);
  assert.deepEqual(kg(d, "A-1"), [100, 0], "a request moves nothing");

  rejects(() => A.issueChemicals(d, { id, kgs: [10] }, remote(rbUser)), /ไม่มีสิทธิ์: จ่ายเคมี/);
  rejects(() => A.issueChemicals(d, { id, kgs: [10] }, remote(plannerUser)), /ไม่มีสิทธิ์/);
  rejects(() => A.issueChemicals(d, { id, kgs: [121] }, remote(stUser)), /ไม่เกินที่ค้าง 120/);
  rejects(() => A.issueChemicals(d, { id, kgs: ["", 0] }, remote(stUser)), /อย่างน้อย 1 รายการ/);
  A.issueChemicals(d, { id, kgs: [110] }, remote(stUser));
  assert.equal(doc.status, "partial");
  assert.deepEqual(doc.lines[0].issues.map((row) => [row.lotNo, row.kg, row.by]), [["A-1", 100, "พนักงาน ST"], ["A-2", 10, "พนักงาน ST"]], "FEFO skips the expired and the held lot");
  assert.deepEqual([kg(d, "A-1"), kg(d, "A-2"), kg(d, "A-HOLD"), kg(d, "A-EXP")], [[0, 100], [290, 10], [50, 0], [50, 0]], "ST → RB at once");
  rejects(() => A.cancelChemicalRequest(d, { id }, remote(rbUser)), /จ่ายไปแล้วบางส่วน/);
  const big = A.requestChemicals(d, { lines: [{ materialCode: "MAT-A", qtyKg: 500 }] }, remote(rbUser));
  rejects(() => A.issueChemicals(d, { id: big, kgs: [500] }, remote(stUser)), /คลัง ST มี MAT-A พร้อมจ่ายไม่พอ/);
  rejects(() => A.closeChemicalRequest(d, { id, reason: "ab" }, remote(stUser)), /อย่างน้อย 3 ตัวอักษร/);
  rejects(() => A.closeChemicalRequest(d, { id, reason: "ของหมด" }, remote(rbUser)), /ไม่มีสิทธิ์/);
  A.closeChemicalRequest(d, { id, reason: " ผู้ขายส่งไม่ครบ " }, remote(stUser));
  assert.deepEqual([doc.status, doc.reason, doc.doneBy, doc.doneAt], ["closed", "ผู้ขายส่งไม่ครบ", "พนักงาน ST", NOW]);
  rejects(() => A.issueChemicals(d, { id, kgs: [1] }, remote(stUser)), /ปิดยอดแล้ว จ่ายไม่ได้/);
  rejects(() => A.cancelChemicalRequest(d, { id: big }, remote(stUser)), /ไม่มีสิทธิ์/);
  A.cancelChemicalRequest(d, { id: big, reason: "ขอผิด" }, remote(rbUser));
  assert.deepEqual([d.chemDocs[0].status, d.chemDocs[0].reason], ["cancelled", "ขอผิด"]);
  rejects(() => A.cancelChemicalRequest(d, { id: big }, remote(rbUser)), /ถูกยกเลิกแล้ว ยกเลิกไม่ได้/);
  // จ่ายครบทุกบรรทัด = done
  const small = A.requestChemicals(d, { lines: [{ materialCode: "MAT-B", qtyKg: 5 }] }, remote(rbUser));
  A.issueChemicals(d, { id: small, kgs: [5] }, { ...remote({ name: "แอดมิน", role: "admin", planner: true, db: true }) });
  assert.deepEqual([d.chemDocs[0].status, d.chemDocs[0].doneBy, kg(d, "B-1")], ["done", "แอดมิน", [195, 5]], "admin may issue; a fully issued request is done");
});

test("actions: RB returns per lot (whole receipt or rejection by ST); only the planning group counts the RB store; mixing draws the RB store", () => {
  const d = state();
  d.materialLots.find((row) => row.lotNo === "A-2").qtyKg = 290;
  d.materialLots.find((row) => row.lotNo === "A-2").rbKg = 10;
  rejects(() => A.returnChemicals(d, { lines: [{ lotNo: "A-2", kg: 1 }] }, remote(stUser)), /ไม่มีสิทธิ์: ขอเบิกเคมี/);
  rejects(() => A.returnChemicals(d, { lines: [{ lotNo: "A-2", kg: 11 }] }, remote(rbUser)), /ไม่เกินยอดในคลัง RB 10/);
  rejects(() => A.returnChemicals(d, { lines: [{ lotNo: "NOPE", kg: 1 }] }, remote(rbUser)), /ไม่พบล็อต NOPE/);
  const back = A.returnChemicals(d, { note: "เหลือ", lines: [{ lotNo: "A-2", kg: 6 }, { lotNo: "B-1", kg: "" }] }, remote(rbUser));
  assert.equal(back, `CT-${TODAY}-01`);
  assert.deepEqual([d.chemDocs[0].status, d.chemDocs[0].lines, kg(d, "A-2")], ["pending", [{ lotNo: "A-2", materialCode: "MAT-A", kg: 6, receivedKg: null }], [290, 4]], "the kilos leave the RB store at once");
  // ยอดนับไม่เกินยอดรับเข้า − ST − ระหว่างทาง (300 − 290 − 6 = 4)
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3 }], reason: "นับประจำเดือน" }, remote(rbUser)), /ไม่มีสิทธิ์: นับและปรับยอดคลังเคมี RB/);
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3 }], reason: "นับประจำเดือน" }, remote(stUser)), /ไม่มีสิทธิ์/);
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3 }], reason: "นับประจำเดือน" }, remote(whHeadUser)), /ไม่มีสิทธิ์: นับและปรับยอดคลังเคมี RB/, "nor the WH department manager");
  rejects(() => A.returnChemicals(d, { lines: [{ lotNo: "A-2", kg: 1 }] }, remote(whHeadUser)), /ไม่มีสิทธิ์: ขอเบิกเคมี/, "nor does the WH department manager return");
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 5 }], reason: "นับประจำเดือน" }, remote(plannerUser)), /เกินที่ล็อตอยู่นอกคลัง ST ได้ \(4 kg\)/);
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3 }], reason: "" }, remote(plannerUser)), /เหตุผล/);
  rejects(() => A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3 }, { lotNo: "A-2", countedKg: 2 }], reason: "นับซ้ำ" }, remote(plannerUser)), /ซ้ำในใบนับ/);
  const counted = A.countRbStock(d, { lines: [{ lotNo: "A-2", countedKg: 3.5 }], reason: "นับประจำเดือน" }, remote(plannerUser));
  assert.deepEqual([counted, d.chemDocs[0].status, d.chemDocs[0].lines, d.chemDocs[0].doneBy, kg(d, "A-2")],
    [`CC-${TODAY}-01`, "done", [{ lotNo: "A-2", materialCode: "MAT-A", beforeKg: 4, countedKg: 3.5 }], "ผู้จัดการ RB", [290, 3.5]]);
  rejects(() => A.receiveChemicalReturn(d, { id: back }, remote(rbUser)), /ไม่มีสิทธิ์: จ่ายเคมี ปิดยอดใบขอเบิก และรับเคมีคืน/);
  A.receiveChemicalReturn(d, { id: back }, remote(stUser));
  assert.deepEqual([d.chemDocs.find((doc) => doc.id === back).status, d.chemDocs.find((doc) => doc.id === back).lines[0].receivedKg, kg(d, "A-2")], ["received", 6, [296, 3.5]], "ST takes the whole return");
  rejects(() => A.rejectChemicalReturn(d, { id: back, reason: "ไม่รับ" }, remote(stUser)), /รับคืนแล้ว ปฏิเสธไม่ได้/);
  const second = A.returnChemicals(d, { lines: [{ lotNo: "A-2", kg: 3.5 }] }, remote(plannerUser));
  assert.deepEqual(kg(d, "A-2"), [296, 0]);
  rejects(() => A.rejectChemicalReturn(d, { id: second, reason: "" }, remote(stUser)), /เหตุผลที่ไม่รับคืน/);
  A.rejectChemicalReturn(d, { id: second, reason: "ล็อตเปื้อน" }, remote(stUser));
  assert.deepEqual([d.chemDocs.find((doc) => doc.id === second).status, kg(d, "A-2")], ["rejected", [296, 3.5]], "a rejected return goes back to the RB store");
  rejects(() => A.receiveChemicalReturn(d, { id: second }, remote(stUser)), /ถูกปฏิเสธแล้ว/);
  rejects(() => A.receiveChemicalReturn(d, { id: counted }, remote(stUser)), /ไม่ใช่ใบคืนเคมี/);
});

test("actions: a mixing requisition draws the RB store and is put back there by RB; an old requisition of the ST store keeps the ST rule", () => {
  const d = state();
  d.recipes = [{ id: "R", revision: 1, status: "approved", batchKg: 60, yieldPerKg: 1, stages: [], items: [{ materialCode: "MAT-A", phr: 100, stage: 1 }, { materialCode: "MAT-B", phr: 50, stage: 1 }] }];
  d.orders = [{ id: "WO-1", status: "released", recipeId: "R", recipeRevision: 1, targetKg: 60, targetQty: 60 }];
  rejects(() => A.createRequisition(d, { orderId: "WO-1" }, remote(rbUser)), /สต็อกไม่พอตามหลัก FEFO: MAT-A ขาด 40.00 kg, MAT-B ขาด 20.00 kg \(คลังเคมี RB · ขอเบิกจาก ST ก่อน\)/);
  d.materialLots.find((row) => row.lotNo === "A-1").rbKg = 50;
  d.materialLots.find((row) => row.lotNo === "A-1").initialKg = 150;
  d.materialLots.find((row) => row.lotNo === "B-1").rbKg = 30;
  d.materialLots.find((row) => row.lotNo === "B-1").initialKg = 230;
  const id = A.createRequisition(d, { orderId: "WO-1" }, remote(rbUser));
  const req = d.requisitions[0];
  assert.deepEqual([req.store, req.lines.map((line) => [line.lotNo, line.actualKg]), kg(d, "A-1"), kg(d, "B-1")], ["RB", [["A-1", 40], ["B-1", 20]], [100, 10], [200, 10]]);
  d.orders[0].status = "cancelled";
  rejects(() => A.returnRequisition(d, { id, kgs: [40, 20] }, remote(stUser)), /ไม่มีสิทธิ์: ขอเบิกเคมี/);
  A.returnRequisition(d, { id, kgs: [40, 20] }, remote(rbUser));
  assert.deepEqual([kg(d, "A-1"), kg(d, "B-1")], [[100, 50], [200, 30]], "back into the RB store of the same lots");
  // ใบเดิมของคลัง ST
  d.requisitions.push({ id: "REQ-OLD", orderId: "WO-1", status: "issued", lines: [{ materialCode: "MAT-B", lotNo: "B-1", targetKg: 5, actualKg: 5 }] });
  d.materialLots.find((row) => row.lotNo === "B-1").qtyKg = 195;
  d.materialLots.find((row) => row.lotNo === "B-1").initialKg = 225;
  rejects(() => A.returnRequisition(d, { id: "REQ-OLD", kgs: [5] }, remote(rbUser)), /ไม่มีสิทธิ์: รับเคมีคืนเข้าคลัง/);
  rejects(() => A.returnRequisition(d, { id: "REQ-OLD", kgs: [5] }, remote(stUser)), /รับคืนเกินยอดที่รับเข้าคลัง/, "the ceiling counts both stores (195 + 30 + 5 > 225)");
  d.materialLots.find((row) => row.lotNo === "B-1").initialKg = 230;
  A.returnRequisition(d, { id: "REQ-OLD", kgs: [5] }, remote(stUser));
  assert.deepEqual(kg(d, "B-1"), [200, 30], "into the ST store as before");
});

test("store: the chemical documents are the 13th list and each button names its right; the database code has a Thai message", () => {
  assert.deepEqual(storeApi.REMOTE_LISTS.slice(-2), ["purchaseOrders", "chemDocs"]);
  const person = (role, dept) => storeApi.personaUser({ id: `${role}-${dept}`, first_name: "ก", last_name: "ข", role: { code: role }, department: { code: dept } });
  const rights = (user) => ["requestChem", "issueChem", "countRb"].map((right) => storeApi.can(user, right));
  assert.deepEqual(rights(person("staff", "RB")), [true, false, false], "RB staff ask and return, never issue nor count");
  assert.deepEqual(rights(person("department_manager", "RB")), [true, false, true], "the RB department manager counts");
  assert.deepEqual(rights(person("assistant_department_manager", "RB")), [true, false, false], "an RB assistant manager asks but does not count");
  assert.deepEqual(rights(person("staff", "ST")), [false, true, false], "ST issues, closes, receives and rejects");
  assert.deepEqual(rights(person("staff", "PP")), [true, false, true], "planning asks and counts");
  assert.deepEqual(rights(person("staff", "QA")), [false, false, false]);
  assert.deepEqual(rights(person("admin", "MGT")), [true, true, true]);
  assert.deepEqual(rights(person("factory_manager", "MGT")), [true, false, true], "the factory managers are in the chemical planning group");
  // ผู้จัดการแผนกอื่นในสายผลิต (อยู่ในกลุ่มวางแผนของ BOM) ไม่ใช่ฝ่ายวางแผนคลังเคมี: หัวหน้า ST ขอเบิกแล้วจ่ายให้ตัวเองไม่ได้ · หัวหน้า WH / GR / QA นับคลัง RB ไม่ได้
  assert.deepEqual(rights(person("department_manager", "ST")), [false, true, false], "the ST head issues but never asks");
  assert.deepEqual(rights(person("department_manager", "WH")), [false, false, false], "the WH head neither asks nor counts");
  assert.deepEqual(rights(person("department_manager", "GR")), [false, false, false], "nor the GR head");
  assert.deepEqual(rights(person("department_manager", "QA")), [false, false, false], "nor the QA head");
  assert.equal(person("department_manager", "WH").planner, true, "although the WH head is in the BOM planning group");
  assert.deepEqual(["requestChemicals", "cancelChemicalRequest", "returnChemicals", "issueChemicals", "closeChemicalRequest", "receiveChemicalReturn", "rejectChemicalReturn", "countRbStock"].map(storeApi.rightForAction),
    ["requestChem", "requestChem", "requestChem", "issueChem", "issueChem", "issueChem", "issueChem", "countRb"]);
  assert.deepEqual([storeApi.rightForRequisitionReturn({ store: "RB" }), storeApi.rightForRequisitionReturn({})], ["requestChem", "returnRequisition"]);
  const mapped = storeApi.mapRemoteError({ message: "RF_INVALID_CHEM" });
  assert.deepEqual([mapped.code, /เอกสารคลังเคมี/.test(mapped.message)], ["RF_INVALID_CHEM", true]);
  // ข้อมูลสาธิตมีงานคลังเคมีให้ดู: ใบที่จ่ายบางส่วน ใบที่รอจ่าย ใบคืนที่รอ ST รับ และคลัง RB มียอด
  const demo = seed.buildSeed(NOW);
  assert.deepEqual(rules.chemRequestsToIssue(demo).map((doc) => doc.status).sort(), ["open", "partial"]);
  assert.equal(rules.chemReturnsPending(demo).length, 1);
  assert.ok(rules.rbStockLots(demo, NOW).length > 0, "the RB store has lots");
  assert.ok(demo.requisitions.every((row) => row.store === "RB"), "every demo requisition draws the RB store");
});

// ---------- ฐานข้อมูลจำลอง (ตรงกับ private.rf_save_chem_docs) ----------
const unwrap = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
};
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) });
async function session() {
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage() });
  const rows = Object.fromEntries(unwrap(await mock.client.rpc("app_sandbox_status")).personas.map((row) => [row.id, row]));
  const who = { id: "persona-1" };
  const call = async (name, args) => unwrap(await mock.client.rpc(name, args));
  const as = async (id) => { who.id = id; await call("app_sandbox_enter", { p_persona_id: id }); };
  const store = storeApi.createStore({
    storage: memoryStorage(), seed: () => seed.buildSeed(NOW), actions: A, now: () => NOW, persona: () => storeApi.personaUser(rows[who.id]),
    remote: {
      load: () => call("app_rf_master"), since: (version) => call("app_rf_master_since", { p_version: version }), audit: () => [],
      save: (changes, base, action, audit, epoch) => call("app_rf_save", { p_changes: changes, p_base_version: base, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }),
    },
  });
  await store.ensureLoaded();
  // ส่งตรงถึงฐานข้อมูล (ข้ามด่านของหน้า) คืนรหัสข้อผิดพลาด หรือ undefined เมื่อผ่าน
  const direct = async (persona, changes, action) => {
    await as(persona);
    const master = await call("app_rf_master");
    return (await mock.client.rpc("app_rf_save", { p_changes: changes, p_base_version: master.version, p_action: action })).error?.code;
  };
  return { mock, store, as, call, direct, master: () => call("app_rf_master") };
}
const run = async (s, persona, name, payload) => {
  await s.as(persona);
  await s.store.catchUp();
  const out = s.store.run(name, payload);
  assert.equal(out.ok, true, out.error?.message);
  const outcome = await out.saving;
  assert.equal(outcome.ok, true, outcome.error?.message);
  return out.result;
};
const docOf = async (s, id) => (await s.master()).chemDocs.find((doc) => doc.id === id);
const lotOf = async (s, lotNo) => { const row = (await s.master()).materialLots.find((item) => item.lotNo === lotNo); return [row.qtyKg, row.rbKg]; };
async function inSync(s, label) {
  await s.store.catchUp();
  const master = await s.master();
  for (const list of ["materialLots", "requisitions", "chemDocs"]) {
    const key = list === "materialLots" ? (row) => row.lotNo : (row) => row.id;
    const sort = (rows) => JSON.parse(JSON.stringify([...rows].sort((a, b) => (key(a) < key(b) ? -1 : 1))));
    assert.deepEqual(sort(s.store.data()[list]), sort(master[list]), `${label}: ${list} on the page equals the database`);
  }
}

test("the mock database follows rf_save_chem_docs: request → partial FEFO issue → close; return → whole receipt / rejection; count by the planning group only; mixing draws the RB store", async () => {
  const s = await session();
  await run(s, "persona-1", "saveMaterial", { code: "EPDM-55", name: "ยาง EPDM", category: "โพลิเมอร์", storage: "A-1", uom: "kg", active: true });
  await run(s, "persona-1", "saveMaterial", { code: "CB-N550", name: "เขม่าดำ", category: "สารตัวเติม", storage: "B-1", uom: "kg", active: true });
  await run(s, "persona-1", "createRecipe", { id: "RC-T", productCode: "P", uom: "m", batchKg: 50, dumpTol: 5, yieldPerKg: 6, stages: [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }], items: [{ materialCode: "EPDM-55", phr: 100, stage: 1 }, { materialCode: "CB-N550", phr: 60, stage: 2 }] });
  await run(s, "persona-1", "approveRecipe", { id: "RC-T", revision: 1 });
  const wo = await run(s, "persona-rb", "createOrder", { recipeId: "RC-T", customer: "ลูกค้า", targetQty: 100, startDate: NOW, dueDate: NOW + DAY });
  await run(s, "persona-rbh", "setOrderStatus", { id: wo, status: "released" });
  const soon = await run(s, "persona-st", "receiveMaterial", { materialCode: "EPDM-55", qtyKg: 40, expiry: NOW + 10 * DAY });
  const later = await run(s, "persona-st", "receiveMaterial", { materialCode: "EPDM-55", qtyKg: 40, expiry: NOW + 90 * DAY });
  const held = await run(s, "persona-st", "receiveMaterial", { materialCode: "EPDM-55", qtyKg: 40, expiry: NOW + 5 * DAY });
  const carbon = await run(s, "persona-st", "receiveMaterial", { materialCode: "CB-N550", qtyKg: 40, expiry: NOW + 60 * DAY });
  await run(s, "persona-qa", "setMaterialLotStatus", { lotNo: held, status: "hold" });
  assert.deepEqual(await lotOf(s, soon), [40, 0], "a received lot sits in the ST store");
  // คลัง RB ว่าง: ใบเบิกผสมไม่ผ่าน ทั้งหน้าและฐานข้อมูล
  await s.as("persona-rb");
  assert.match(s.store.run("createRequisition", { orderId: wo }).error.message, /คลังเคมี RB · ขอเบิกจาก ST ก่อน/);

  // ขอเบิก: RB / กลุ่มวางแผน · ST / QA / WH ไม่ได้
  const cr = { id: `CR-${TODAY}-01`, kind: "request", status: "open", note: "", lines: [{ materialCode: "EPDM-55", qtyKg: 60 }, { materialCode: "CB-N550", qtyKg: 30 }] };
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [cr] } }, "requestChemicals"), "RF_FORBIDDEN", "ST cannot raise an RB request");
  assert.equal(await s.direct("persona-qa", { chemDocs: { upsert: [cr] } }, "requestChemicals"), "RF_FORBIDDEN", "nor QA");
  assert.equal(await s.direct("persona-wh", { chemDocs: { upsert: [cr] } }, "requestChemicals"), "RF_FORBIDDEN", "nor WH");
  assert.equal(await s.direct("persona-whh", { chemDocs: { upsert: [cr] } }, "requestChemicals"), "RF_FORBIDDEN", "nor the WH department manager (BOM planning group, not the chemical planning group)");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [cr] } }, "saveMaterial"), "RF_INVALID_CHEM", "documents travel only with the chemical actions");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [cr] }, orders: { upsert: [(await s.master()).orders[0]] } }, "requestChemicals"), "RF_INVALID_CHEM", "and those actions carry no other list");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [{ ...cr, lines: [{ materialCode: "EPDM-55", qtyKg: 0 }] }] } }, "requestChemicals"), "RF_INVALID_CHEM", "a zero quantity");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [{ ...cr, id: `CT-${TODAY}-01` }] } }, "requestChemicals"), "RF_INVALID_CHEM", "a request number starts with CR-");
  const request = await run(s, "persona-rb", "requestChemicals", { lines: [{ materialCode: "EPDM-55", qtyKg: 60 }, { materialCode: "CB-N550", qtyKg: 30 }], note: "เติมคลัง" });
  assert.equal(request, `CR-${TODAY}-01`);
  assert.deepEqual([(await docOf(s, request)).status, (await docOf(s, request)).createdBy], ["open", "ประยุทธ รีดยาง"]);
  await inSync(s, "requested");

  // จ่าย: ST / admin · RB และกลุ่มวางแผนไม่ได้ · FEFO ข้ามล็อตกักกัน · จ่ายบางส่วน
  const issueCopy = async (kgs) => { const doc = await docOf(s, request); return { ...doc, lines: doc.lines.map((line, i) => ({ ...line, issuedKg: line.issuedKg + (kgs[i] ?? 0) })) }; };
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [await issueCopy([10, 0])] } }, "issueChemicals"), "RF_FORBIDDEN", "RB cannot issue to itself");
  assert.equal(await s.direct("persona-rbh", { chemDocs: { upsert: [await issueCopy([10, 0])] } }, "issueChemicals"), "RF_FORBIDDEN", "nor the planning group");
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [await issueCopy([61, 0])] } }, "issueChemicals"), "RF_INVALID_CHEM", "no more than still open");
  await s.as("persona-rb");
  assert.match(s.store.run("issueChemicals", { id: request, kgs: [10, 0] }).error.message, /ไม่มีสิทธิ์: จ่ายเคมี/, "the page says no first");
  await run(s, "persona-st", "issueChemicals", { id: request, kgs: [50, 0] });
  assert.equal((await docOf(s, request)).status, "partial");
  assert.deepEqual((await docOf(s, request)).lines[0].issues.map((row) => [row.lotNo, row.kg, row.by]), [[soon, 40, "วิชัย คลังวัตถุดิบ"], [later, 10, "วิชัย คลังวัตถุดิบ"]], "FEFO skips the held lot");
  assert.deepEqual([await lotOf(s, soon), await lotOf(s, later), await lotOf(s, held)], [[0, 40], [30, 10], [40, 0]]);
  await inSync(s, "partly issued");
  // สำเนาล็อตที่มากับคำสั่งคลังเคมีต้องตรงกับที่เก็บทุกช่องยกเว้นยอด (ตรงกับ private.rf_check_chem_lot_copies)
  const lotRow = (await s.master()).materialLots.find((row) => row.lotNo === later);
  const withLot = async (lot) => s.direct("persona-st", { chemDocs: { upsert: [await docOf(s, request)] }, materialLots: { upsert: [lot] } }, "issueChemicals");
  assert.equal(await withLot({ ...lotRow, status: "hold" }), "RF_INVALID_CHEM", "a chemical action cannot hold a lot through its lot copy");
  assert.equal(await withLot({ ...lotRow, lotNo: "RM-NEW-1" }), "RF_INVALID_CHEM", "nor receive a new lot");
  assert.equal(await withLot({ ...lotRow, supplier: "ผู้ขายอื่น" }), "RF_INVALID_CHEM", "nor change what the lot records");
  assert.equal(await withLot({ ...lotRow, qtyKg: 1, rbKg: 0 }), undefined, "a copy that differs only in the balances is ignored");
  const lotsNow = (await s.master()).materialLots;
  assert.deepEqual([lotsNow.find((row) => row.lotNo === later).status, lotsNow.some((row) => row.lotNo === "RM-NEW-1"), await lotOf(s, later)], ["available", false, [30, 10]]);
  await run(s, "persona-st", "issueChemicals", { id: request, kgs: [0, 30] });
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [{ ...(await docOf(s, request)), status: "cancelled" }] } }, "cancelChemicalRequest"), "RF_INVALID_TRANSITION", "a partly issued request is not cancelled");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [{ ...(await docOf(s, request)), status: "closed", reason: "พอแล้ว" }] } }, "closeChemicalRequest"), "RF_FORBIDDEN", "RB cannot close it");
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [{ ...(await docOf(s, request)), status: "closed", reason: "ab" }] } }, "closeChemicalRequest"), "RF_INVALID_CHEM", "closing needs a reason");
  await run(s, "persona-st", "closeChemicalRequest", { id: request, reason: "ใช้เท่านี้ก่อน" });
  assert.deepEqual([(await docOf(s, request)).status, (await docOf(s, request)).reason, (await docOf(s, request)).doneBy], ["closed", "ใช้เท่านี้ก่อน", "วิชัย คลังวัตถุดิบ"]);
  await inSync(s, "closed");

  // ใบเบิกผสมตัดคลัง RB (FEFO บน rbKg)
  const requisition = await run(s, "persona-rb", "createRequisition", { orderId: wo });
  const req = (await s.master()).requisitions.find((row) => row.id === requisition);
  assert.deepEqual([req.store, req.lines.map((line) => [line.lotNo, line.actualKg])], ["RB", [[soon, 31.25], [carbon, 18.75]]]);
  assert.deepEqual([await lotOf(s, soon), await lotOf(s, carbon)], [[0, 8.75], [10, 11.25]], "the RB store falls, the ST store stays");
  await inSync(s, "mixing requisition");

  // คืน: RB / กลุ่มวางแผน · ST รับทั้งใบ หรือปฏิเสธ
  const ct = (lotNo, kgValue, n = "01") => ({ id: `CT-${TODAY}-${n}`, kind: "return", status: "pending", note: "", lines: [{ lotNo, kg: kgValue }] });
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [ct(later, 5)] } }, "returnChemicals"), "RF_FORBIDDEN", "ST cannot raise an RB return");
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [ct(later, 11)] } }, "returnChemicals"), "RF_INVALID_CHEM", "no more than the RB balance");
  const back = await run(s, "persona-rb", "returnChemicals", { lines: [{ lotNo: later, kg: 4 }] });
  assert.deepEqual([(await docOf(s, back)).status, await lotOf(s, later)], ["pending", [30, 6]]);
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [{ ...(await docOf(s, back)), status: "received" }] } }, "receiveChemicalReturn"), "RF_FORBIDDEN", "RB cannot receive its own return");
  await run(s, "persona-st", "receiveChemicalReturn", { id: back });
  assert.deepEqual([(await docOf(s, back)).status, (await docOf(s, back)).lines[0].receivedKg, await lotOf(s, later)], ["received", 4, [34, 6]], "exactly what was sent");
  const back2 = await run(s, "persona-rbh", "returnChemicals", { lines: [{ lotNo: later, kg: 6 }] });
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [{ ...(await docOf(s, back2)), status: "rejected" }] } }, "rejectChemicalReturn"), "RF_INVALID_CHEM", "rejecting needs a reason");
  await run(s, "persona-st", "rejectChemicalReturn", { id: back2, reason: "ล็อตเปื้อน" });
  assert.deepEqual([(await docOf(s, back2)).status, await lotOf(s, later)], ["rejected", [34, 6]], "the kilos go back to the RB store");
  await inSync(s, "returns");

  // นับคลัง RB: กลุ่มวางแผนเท่านั้น
  const cc = { id: `CC-${TODAY}-01`, kind: "count", status: "done", reason: "นับประจำเดือน", lines: [{ lotNo: soon, countedKg: 8 }] };
  assert.equal(await s.direct("persona-rb", { chemDocs: { upsert: [cc] } }, "countRbStock"), "RF_FORBIDDEN", "RB staff cannot count the RB store");
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [cc] } }, "countRbStock"), "RF_FORBIDDEN", "nor ST");
  assert.equal(await s.direct("persona-whh", { chemDocs: { upsert: [cc] } }, "countRbStock"), "RF_FORBIDDEN", "nor the WH department manager");
  assert.equal(await s.direct("persona-rbh", { chemDocs: { upsert: [{ ...cc, lines: [{ lotNo: soon, countedKg: 41 }] }] } }, "countRbStock"), "RF_INVALID_CHEM", "not above what the lot can hold outside ST");
  assert.equal(await s.direct("persona-rbh", { chemDocs: { upsert: [{ ...cc, reason: "" }] } }, "countRbStock"), "RF_INVALID_CHEM", "a count needs a reason");
  await run(s, "persona-rbh", "countRbStock", { lines: [{ lotNo: soon, countedKg: 8 }], reason: "นับประจำเดือน" });
  assert.deepEqual([(await docOf(s, `CC-${TODAY}-01`)).lines[0].beforeKg, await lotOf(s, soon)], [8.75, [0, 8]]);
  await inSync(s, "counted");
  const usage = rules.rbUsage(s.store.data()).rows.find((row) => row.materialCode === "EPDM-55");
  assert.deepEqual([usage.receivedKg, usage.recipeKg, usage.returnedKg, usage.countAdjustKg, usage.onHandKg], [50, 31.25, 4, -0.75, 14], "usage against the recipe from the documents");
  const recount = await run(s, "persona-pp", "countRbStock", { lines: [{ lotNo: soon, countedKg: 8 }], reason: "ตรวจนับซ้ำ" });
  assert.deepEqual([(await docOf(s, recount)).doneBy, await lotOf(s, soon)], ["สมศรี วางแผน", [0, 8]], "the planning department counts the RB store too");

  // ใบเบิกเดิมของคลัง ST (ก่อนแยกคลัง) ที่ค้างชั่ง: จองยอด ST ไว้ และจ่ายแล้วตัดคลัง ST
  s.mock.rf.edit((m) => {
    m.version += 1;
    m.requisitions.push({ id: "REQ-OLD", orderId: wo, recipeId: "RC-T", recipeRevision: 1, batches: 1, totalKg: 50, status: "weighing", note: "", store: "ST", createdAt: NOW, requestedBy: "x",
      lines: [{ materialCode: "EPDM-55", stage: 1, lotNo: later, targetKg: 30, actualKg: null, weighedAt: null }] });
    m.versions.requisitions["REQ-OLD"] = m.version;
  });
  await s.store.catchUp();
  const more = await run(s, "persona-rb", "requestChemicals", { lines: [{ materialCode: "EPDM-55", qtyKg: 10 }] });
  await s.as("persona-st");
  assert.match(s.store.run("issueChemicals", { id: more, kgs: [10] }).error.message, /พร้อมจ่ายไม่พอ/, "the ST kilos an old requisition holds are not issued to RB");
  assert.equal(await s.direct("persona-st", { chemDocs: { upsert: [{ ...(await docOf(s, more)), lines: [{ ...(await docOf(s, more)).lines[0], issuedKg: 10 }] }] } }, "issueChemicals"), "RF_INSUFFICIENT_STOCK");
  await run(s, "persona-rb", "issueRequisition", { id: "REQ-OLD" });
  assert.deepEqual(await lotOf(s, later), [4, 6], "the old requisition still draws the ST store");
  await inSync(s, "old requisition");
});
