import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// ชุดแก้ 1 (20261128010000_bom_cancel_rf_stop.sql) ฝั่ง Supabase จำลองของ harness และกฎฝั่งหน้า:
// ยกเลิกใบหลัง WO เริ่มผลิต (หยุด WO · เหตุผล · งานคงอยู่ · สต็อกสินค้าสำเร็จรูป · คืนของซื้อ) · ST รับเคมีคืนเข้าล็อตเดิม ·
// งานที่ผูก WO รับยอดจาก RubberFlow เท่านั้น · พักงานพร้อมเหตุผล · ข้ามเวลาบ่มเฉพาะหัวหน้า RB / QA พร้อมเหตุผล
// mock ต้องตอบรหัสเดียวกับฐานข้อมูลทุกข้อ (pgTAP คู่กันอยู่ใน supabase/tests/database/bom_cancel_rf_stop.test.sql)
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const rfRules = globalThis.MNP_RUBBERFLOW_RULES;
const bomRules = globalThis.MNP_BOM_RULES;
const RFA = require("../../modules/rubberflow-actions.js");

const NOW = Date.parse("2026-11-28T10:00:00+07:00");
const HOUR = 3600000;
const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves"];
const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });

const order = (id, extra = {}) => ({ id, customer: "ลูกค้า", country: "Thailand", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * 86400000, due: {}, dueDefaults: [], revision: 0, status: "in_progress", items: [{ fgCode: "FG-1", qty: 5, colorSet: "", note: "" }], explosion: [{ itemCode: "FG-1", level: 0 }], explodedAt: 1, stockCounts: {}, note: "", createdBy: "x", createdAt: 1, ...extra });
const job = (id, orderId, dept, extra = {}) => ({ id, orderId, dept, itemCode: `${dept}-ITEM`, name: "งาน", kind: "RB", uom: "pcs", qtyPlanned: 10, qtyRequired: 10, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + 86400000, status: "queued", externalRef: null, fgCodes: ["FG-1"], createdAt: 1, reports: [], ...extra });
const wo = (id, sourceJobId, status, extra = {}) => ({ id, customer: "ลูกค้า", customerPo: "PI-1", recipeId: "RC-1", recipeRevision: 1, productCode: "", uom: "pcs", color: "ดำ", targetQty: 10, producedQty: 0, startDate: NOW, dueDate: NOW + 86400000, priority: "normal", note: "", status, sourceJobId, createdAt: 1, createdBy: "x", ...extra });

// ข้อมูลตั้งต้น (ใส่ลง storage ของ mock ตรง ๆ เหมือนชุดสาธิตของ harness):
//   PI-1 กำลังผลิต: งาน RB ผูก WO-1 (กำลังผลิต) · งาน RB ผูก WO-2 (ปิดแล้ว) · งาน PK รายงานแล้ว 2 · ของซื้อ P-1 เบิกแล้ว 3 · WH รับเข้า FG-1 2
//   PI-2 ร่าง (ใช้สต็อก FG-1 2) · PI-3 กำลังผลิต: งาน RB ผูก WO-3 (ปล่อยผลิต) และงาน GR
//   RubberFlow: ล็อตวัตถุดิบ L-A (60 / 100) L-B (180 / 200) · REQ-1 ของ WO-1 จ่ายแล้ว 40 + 20 · ล็อตผสม MX-1 / MX-2 บ่มอยู่ MX-3 บ่มครบแล้ว
function seeded({ lotA = 60 } = {}) {
  const map = new Map();
  const bom = { version: 5, epoch: "e-bom", versions: Object.fromEntries(BOM_LISTS.map((list) => [list, {}])), tombstones: [], audit: [], ...Object.fromEntries(BOM_LISTS.map((list) => [list, []])) };
  bom.items = [{ code: "FG-1", kind: "FG", name: "สินค้า", uom: "set" }, { code: "P-1", kind: "PURCHASED", name: "กล่อง", uom: "box" }];
  bom.orders = [order("PI-1"), order("PI-2", { status: "draft", items: [{ fgCode: "FG-1", qty: 2, colorSet: "", note: "" }], stockCounts: { "FG-1": 2 } }), order("PI-3")];
  bom.jobs = [
    job("JOB-RB", "PI-1", "RB", { status: "in_progress", externalRef: { system: "rubberflow", woId: "WO-1", kg: 5 } }),
    job("JOB-RB2", "PI-1", "RB", { itemCode: "RB-2", status: "in_progress", externalRef: { system: "rubberflow", woId: "WO-2", kg: 5 } }),
    job("JOB-PK", "PI-1", "PK", { kind: "FG", itemCode: "FG-1", uom: "set", qtyPlanned: 5, qtyDone: 2, status: "in_progress", reports: [{ at: 1, by: "x", good: 2, reject: 0, note: "" }] }),
    job("JOB-P1", "PI-1", "ST", { kind: "PURCHASED", itemCode: "P-1", uom: "box", qtyPlanned: 3, qtyDone: 3, status: "done" }),
    job("JOB-L", "PI-3", "RB", { status: "in_progress", externalRef: { system: "rubberflow", woId: "WO-3", kg: 5 } }),
    job("JOB-G", "PI-3", "GR", { kind: "SE", itemCode: "SE-1", status: "in_progress", qtyDone: 4, reports: [{ at: 1, by: "x", good: 4, reject: 0, note: "" }] }),
  ];
  bom.stock = [{ itemCode: "P-1", qty: 7, safetyQty: 0, countedAt: null, countedBy: "", updatedAt: 1 }];
  bom.stockMoves = [{ id: "00000001-m", itemCode: "P-1", kind: "issue", qty: -3, balance: 7, ref: "PI-1", at: 1, by: "x", note: null }];
  bom.fgMoves = [{ id: "00000001-f", orderId: "PI-1", fgCode: "FG-1", kind: "receive", qty: 2, note: "", at: 1, by: "x" }];
  const rf = { version: 7, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) };
  rf.orders = [wo("WO-1", "JOB-RB", "in_progress", { producedQty: 4 }), wo("WO-2", "JOB-RB2", "completed"), wo("WO-3", "JOB-L", "released", { customerPo: "PI-3" })];
  const lot = (lotNo, materialCode, qtyKg, initialKg) => ({ lotNo, materialCode, qtyKg, initialKg, expiry: NOW + 30 * 86400000, supplier: "-", location: "A-1", status: "available", coa: true, receivedAt: 1, receivedBy: "x" });
  rf.materialLots = [lot("L-A", "MAT-A", lotA, 100), lot("L-B", "MAT-B", 180, 200)];
  rf.requisitions = [{ id: "REQ-1", orderId: "WO-1", recipeId: "RC-1", recipeRevision: 1, batches: 1, totalKg: 60, status: "issued", note: "", requestedBy: "x", createdAt: 1, issuedAt: 1, issuedBy: "x",
    lines: [{ materialCode: "MAT-A", stage: 1, lotNo: "L-A", targetKg: 40, actualKg: 40, weighedAt: 1, weighedBy: "x" }, { materialCode: "MAT-B", stage: 1, lotNo: "L-B", targetKg: 20, actualKg: 20, weighedAt: 1, weighedBy: "x" }] }];
  const mx = (id, readyAt) => ({ id, stage: "mixing", orderId: "WO-1", recipeId: "RC-1", uom: "kg", machine: "", shift: "D", sources: [{ type: "requisition", id: "REQ-0" }], params: { batches: 1 }, goodQty: 50, scrapQty: 0, scrapReason: "", qc: "pass", holdReasons: [], transferredQty: 0, readyAt, createdAt: 1, operator: "x", countedToOrder: false });
  rf.lots = [mx("MX-1", NOW + 4 * HOUR), mx("MX-2", NOW + 4 * HOUR), mx("MX-3", NOW - HOUR)];
  map.set("mnp-harness-bom-master", JSON.stringify(bom));
  map.set("mnp-harness-rf-master", JSON.stringify(rf));
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage(map) });
  const data = async (name, args = {}) => { const reply = await client.rpc(name, args); assert.equal(reply.error, null, reply.error?.message); return reply.data; };
  const as = (persona) => data("app_sandbox_enter", { p_persona_id: persona });
  const bomView = () => data("app_bom_master");
  const rfView = () => data("app_rf_master");
  const bomSave = async (changes, action) => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: (await bomView()).version, p_action: action });
  const rfSave = async (changes, action, base = null) => client.rpc("app_rf_save", { p_changes: changes, p_base_version: base ?? (await rfView()).version, p_action: action });
  const code = async (promise) => (await promise).error?.code ?? null;
  const row = async (list, id) => (await bomView())[list].find((entry) => entry.id === id);
  const rfRow = async (list, id) => (await rfView())[list].find((entry) => (entry.id ?? entry.lotNo) === id);
  return { client, as, bomView, rfView, bomSave, rfSave, code, row, rfRow };
}
const cancel = async (s, id, reason) => s.bomSave({ orders: { upsert: [{ ...(await s.row("orders", id)), status: "cancelled", cancelledAt: NOW, ...(reason === undefined ? {} : { cancelReason: reason }) }] } }, "cancelOrder");
const giveBack = async (s, kgs, note, base) => {
  const req = await s.rfRow("requisitions", "REQ-1");
  return s.rfSave({ requisitions: { upsert: [{ ...req, lines: req.lines.map((line, index) => (kgs[index] === undefined ? line : { ...line, returnedKg: kgs[index] })), ...(note === undefined ? {} : { returnNote: note }) }] } }, "returnRequisition", base);
};
const skip = async (s, lotId, reason) => {
  const lot = await s.rfRow("lots", lotId);
  return s.rfSave({ lots: { upsert: [{ ...lot, readyAt: NOW, params: { ...lot.params, ...(reason === undefined ? {} : { skipRest: { reason } }) } }] } }, "endRest");
};

test("mock: a cancel needs a reason; with one the running work order is stopped, the completed one stays, the jobs stay with their output", async () => {
  const s = seeded();
  await s.as("persona-pp");
  assert.equal(await s.code(cancel(s, "PI-1")), "BOM_INVALID_ORDER", "no reason");
  assert.equal(await s.code(cancel(s, "PI-1", " ab ")), "BOM_INVALID_ORDER", "a reason of 3 characters at least after trimming");
  assert.equal(await s.code(cancel(s, "PI-1", "ก".repeat(201))), "BOM_INVALID_ORDER", "and at most 200");
  assert.equal(await s.code(cancel(s, "PI-1", 7)), "BOM_INVALID_ORDER", "text only");
  await s.as("persona-rb");
  assert.equal(await s.code(cancel(s, "PI-1", "ลูกค้ายกเลิก")), "BOM_FORBIDDEN", "RB staff cannot cancel");
  assert.equal((await s.rfRow("orders", "WO-1")).status, "in_progress", "the refusals stopped nothing");
  await s.as("persona-pp");
  const reply = await cancel(s, "PI-1", "  ลูกค้ายกเลิกคำสั่งซื้อ  ");
  assert.equal(reply.error, null, reply.error?.message);
  assert.deepEqual(reply.data.rubberflow.cancelled, ["WO-1"], "only the running work order is stopped");
  const piOne = await s.row("orders", "PI-1");
  assert.deepEqual([piOne.status, piOne.cancelReason], ["cancelled", "ลูกค้ายกเลิกคำสั่งซื้อ"]);
  assert.deepEqual([(await s.rfRow("orders", "WO-1")).status, (await s.rfRow("orders", "WO-1")).producedQty, (await s.rfRow("orders", "WO-2")).status], ["cancelled", 4, "completed"],
    "the stopped order keeps its produced quantity and the completed one stays completed");
  const jobs = (await s.bomView()).jobs.filter((entry) => entry.orderId === "PI-1");
  assert.deepEqual(jobs.map((entry) => [entry.id, entry.qtyDone]).sort(), [["JOB-P1", 3], ["JOB-PK", 2], ["JOB-RB", 0], ["JOB-RB2", 0]], "every job stays with its output");
  assert.deepEqual(reply.data.changes.jobs.delete, [], "no tombstone");
  await s.as("persona-pk");
  const pk = await s.row("jobs", "JOB-PK");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 3, reports: [...pk.reports, { at: 1, by: "x", good: 1, reject: 0, note: "" }] }] } }, "reportJob")), "BOM_INVALID_TRANSITION", "a job of a cancelled order takes no report");
});

test("mock: what the cancelled order received is FG stock with an ordered quantity of 0; its issued parts come back as a leftover return", async () => {
  const s = seeded();
  await s.as("persona-pp");
  assert.equal((await cancel(s, "PI-1", "ลูกค้ายกเลิก")).error, null);
  const released = await s.bomSave({ orders: { upsert: [{ ...(await s.row("orders", "PI-2")), status: "released" }] } }, "releaseOrder");
  assert.equal(released.error, null, released.error?.message);
  assert.equal((await s.row("orders", "PI-2")).status, "completed", "a draft covered by the stock completes at release");
  assert.deepEqual((await s.bomView()).fgMoves.filter((move) => move.kind === "transfer").map((move) => [move.orderId, move.fromOrderId, move.qty]), [["PI-2", "PI-1", 2]], "the 2 sets come from the cancelled order");
  await s.as("persona-wh");
  assert.equal(await s.code(s.bomSave({ fgMoves: { upsert: [{ orderId: "PI-1", kind: "receive", lines: [{ fgCode: "FG-1", qty: 1 }] }] } }, "receiveFg")), "BOM_INVALID_TRANSITION", "a cancelled order receives nothing");
  await s.as("persona-st");
  const back = (qty, reason = "ยกเลิกใบ") => s.bomSave({ partReturns: { upsert: [{ orderId: "PI-1", mode: "leftover", reason, lines: [{ itemCode: "P-1", qty }] }] } }, "returnOrderParts");
  assert.equal(await s.code(s.bomSave({ partReturns: { upsert: [{ orderId: "PI-1", mode: "undo", reason: "x" }] } }, "undoOrderParts")), "BOM_INVALID_TRANSITION", "the undo stays for open orders");
  assert.equal(await s.code(back(4)), "BOM_INVALID_RETURN", "no more than issued");
  assert.equal((await back(3)).error, null);
  assert.equal((await s.bomView()).stock.find((entry) => entry.itemCode === "P-1").qty, 10, "the 3 boxes are back in stock");
});

test("mock: a job linked to a work order takes no manual report from anyone; holding needs a reason stamped as a hold entry", async () => {
  const s = seeded();
  const report = (entry, extra = {}) => ({ ...entry, status: "in_progress", qtyDone: entry.qtyDone + 1, reports: [...entry.reports, { at: 1, by: "x", good: 1, reject: 0, note: "" }], ...extra });
  const hold = (entry, note, extra = {}) => ({ ...entry, status: "hold", reports: [...entry.reports, { at: 1, by: "x", good: 0, reject: 0, note }], ...extra });
  for (const persona of ["persona-rb", "persona-pp", "persona-1"]) {
    await s.as(persona);
    assert.equal(await s.code(s.bomSave({ jobs: { upsert: [report(await s.row("jobs", "JOB-L"))] } }, "reportJob")), "BOM_INVALID_JOB", `${persona}: no report on a linked job`);
  }
  await s.as("persona-pp");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...(await s.row("jobs", "JOB-L")), qtyDone: 5 }] } }, "setJobStatus")), "BOM_INVALID_JOB", "nor a quantity without a report");
  await s.as("persona-rb");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...(await s.row("jobs", "JOB-L")), status: "hold" }] } }, "setJobStatus")), "BOM_INVALID_JOB", "a hold needs a reason");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [hold(await s.row("jobs", "JOB-L"), "ab")] } }, "setJobStatus")), "BOM_INVALID_JOB", "of 3 characters at least");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [hold(await s.row("jobs", "JOB-L"), "รอแม่พิมพ์")] } }, "reportJob")), "BOM_INVALID_JOB", "only under setJobStatus");
  assert.equal((await s.bomSave({ jobs: { upsert: [hold(await s.row("jobs", "JOB-L"), "  รอแม่พิมพ์  ")] } }, "setJobStatus")).error, null, "RB staff hold the linked job with a reason");
  const held = await s.row("jobs", "JOB-L");
  assert.deepEqual([held.status, held.reports.at(-1)], ["hold", { at: NOW, by: "ประยุทธ รีดยาง", good: 0, reject: 0, note: "รอแม่พิมพ์", kind: "hold" }]);
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...held, status: "in_progress" }] } }, "setJobStatus")).error, null, "resuming needs no reason");
  await s.as("persona-gr");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [hold(await s.row("jobs", "JOB-G"), "รอกาว", { qtyDone: 5 })] } }, "setJobStatus")), "BOM_INVALID_JOB", "a hold changes no output");
  assert.equal((await s.bomSave({ jobs: { upsert: [report(await s.row("jobs", "JOB-G"))] } }, "reportJob")).error, null, "an unlinked job is reported as before");
  await s.as("persona-pk");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [hold(await s.row("jobs", "JOB-G"), "รอกาว")] } }, "setJobStatus")), "BOM_FORBIDDEN", "another department cannot hold the GR job");
  await s.as("persona-pp");
  const close = await s.row("jobs", "JOB-L");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...close, status: "done", reports: [...close.reports, { at: 1, by: "x", good: 0, reject: 0, note: "WO ไม่ผลิตเพิ่ม" }] }] } }, "setJobStatus")).error, null, "the planner still closes a linked job with a reason");
});

test("mock: ST takes the issued chemicals of a stopped work order back into the original lots, once, with a reason for a short return", async () => {
  const s = seeded();
  await s.as("persona-st");
  assert.equal(await s.code(giveBack(s, [40, 20])), "RF_INVALID_TRANSITION", "not while the work order is still open");
  await s.as("persona-pp");
  assert.equal((await cancel(s, "PI-1", "ลูกค้ายกเลิก")).error, null);
  assert.equal((await s.rfRow("orders", "WO-1")).status, "cancelled");
  for (const persona of ["persona-rb", "persona-pp", "persona-qa"]) {
    await s.as(persona);
    assert.equal(await s.code(giveBack(s, [40, 20])), "RF_FORBIDDEN", `${persona} cannot take chemicals back`);
  }
  await s.as("persona-pp");
  assert.equal(await s.code(s.rfSave({ orders: { upsert: [{ ...(await s.rfRow("orders", "WO-3")), note: "x" }] } }, "returnRequisition")), "RF_INVALID_REQUISITION", "returnRequisition carries only requisitions and material lots");
  await s.as("persona-st");
  const version = (await s.rfView()).version;
  assert.equal((await giveBack(s, [])).error, null);
  assert.equal((await s.rfView()).version, version, "a copy without returned kilograms writes nothing");
  assert.equal(await s.code(giveBack(s, [40])), "RF_INVALID_REQUISITION", "every issued line needs its kilograms");
  assert.equal(await s.code(giveBack(s, [40.5, 20])), "RF_INVALID_REQUISITION", "no more than issued");
  assert.equal(await s.code(giveBack(s, [-1, 20])), "RF_INVALID_REQUISITION", "no negative");
  assert.equal(await s.code(giveBack(s, [40.00001, 20])), "RF_INVALID_REQUISITION", "not even a fraction more than issued");
  assert.equal(await s.code(giveBack(s, [40, 15])), "RF_INVALID_REQUISITION", "a short return needs a reason");
  assert.equal(await s.code(giveBack(s, [40, 15], " ab ")), "RF_INVALID_REQUISITION", "of 3 characters at least");
  const reply = await giveBack(s, [40, 15], "  หกระหว่างขนย้าย 5 กก.  ");
  assert.equal(reply.error, null, reply.error?.message);
  assert.deepEqual([(await s.rfRow("materialLots", "L-A")).qtyKg, (await s.rfRow("materialLots", "L-B")).qtyKg], [100, 195], "the kilograms are back in the original lots");
  const req = await s.rfRow("requisitions", "REQ-1");
  assert.deepEqual(req.lines.map((line) => [line.returnedKg, line.returnedBy, line.returnNote, line.returnedAt]), [[40, "วิชัย คลังวัตถุดิบ", "หกระหว่างขนย้าย 5 กก.", NOW], [15, "วิชัย คลังวัตถุดิบ", "หกระหว่างขนย้าย 5 กก.", NOW]]);
  assert.equal(req.status, "issued", "the requisition keeps its status");
  assert.equal(rfRules.requisitionReturnState(await s.rfView(), req), "returned");
  assert.equal(await s.code(giveBack(s, [39, 15], "รับซ้ำ")), "RF_INVALID_TRANSITION", "once per requisition");
  const after = (await s.rfView()).version;
  assert.equal((await giveBack(s, [40, 15], "หกระหว่างขนย้าย 5 กก.")).error, null);
  assert.equal((await s.rfView()).version, after, "resending the stored figures writes nothing");
});

test("mock: a return cannot lift a lot above what it received", async () => {
  // ล็อต L-A มียอดเต็มยอดรับเข้าแล้ว (100 / 100) คืน 40 เข้าไปอีกไม่ได้ ทั้งคำสั่งไม่เขียนอะไร
  const s = seeded({ lotA: 100 });
  await s.as("persona-pp");
  assert.equal((await cancel(s, "PI-1", "ลูกค้ายกเลิก")).error, null);
  await s.as("persona-st");
  assert.equal(await s.code(giveBack(s, [40, 20])), "RF_INVALID_REQUISITION");
  assert.deepEqual([(await s.rfRow("materialLots", "L-A")).qtyKg, (await s.rfRow("materialLots", "L-B")).qtyKg], [100, 180], "nothing moved");
  assert.equal((await giveBack(s, [0, 20], "MAT-A ใช้ไปหมดแล้ว")).error, null, "returning none of the full lot fits");
  assert.equal((await s.rfRow("materialLots", "L-B")).qtyKg, 200);
});

test("mock: only the RB head or QA skips the rest time, with a reason kept on the lot; a lot already ready is left alone", async () => {
  const s = seeded();
  for (const persona of ["persona-rb", "persona-pp"]) {
    await s.as(persona);
    assert.equal(await s.code(skip(s, "MX-1", "เร่งงาน")), "RF_FORBIDDEN", `${persona} cannot skip the rest time`);
  }
  await s.as("persona-rbh");
  assert.equal(await s.code(skip(s, "MX-1")), "RF_INVALID_LOT", "the RB head needs a reason");
  assert.equal(await s.code(skip(s, "MX-1", " ab ")), "RF_INVALID_LOT", "of 3 characters at least");
  assert.equal(await s.code(skip(s, "MX-1", "ก".repeat(301))), "RF_INVALID_LOT", "and at most 300");
  assert.equal((await skip(s, "MX-1", "  ตรวจความหนืดแล้ว  ")).error, null);
  const lot = await s.rfRow("lots", "MX-1");
  assert.deepEqual([lot.readyAt, lot.params], [NOW, { batches: 1, skipRest: { by: "สุรีย์ หัวหน้ารีด", reason: "ตรวจความหนืดแล้ว", at: NOW } }]);
  await s.as("persona-qa");
  assert.equal((await skip(s, "MX-2", "QA ตรวจแล้วผ่าน")).error, null, "QA skips with a reason");
  const version = (await s.rfView()).version;
  assert.equal((await skip(s, "MX-3", "บ่มครบแล้ว")).error, null);
  assert.equal((await s.rfView()).version, version, "a lot that is already ready is not written");
  assert.equal((await s.rfRow("lots", "MX-3")).params.skipRest, undefined);
});

test("rules: which requisitions wait for ST, which can be mixed, and cancelled orders in the FG stock and the part return", () => {
  const data = {
    orders: [{ id: "WO-1", status: "cancelled" }, { id: "WO-2", status: "in_progress" }],
    requisitions: [
      { id: "R-1", orderId: "WO-1", status: "issued", lines: [{ actualKg: 4 }] },
      { id: "R-2", orderId: "WO-1", status: "consumed", lines: [{ actualKg: 4 }] },
      { id: "R-3", orderId: "WO-1", status: "weighing", lines: [{ actualKg: null }] },
      { id: "R-4", orderId: "WO-1", status: "weighing", lines: [{ actualKg: 2 }, { actualKg: null }] },
      { id: "R-5", orderId: "WO-1", status: "issued", lines: [{ actualKg: 4, returnedKg: 4, returnedAt: 1 }] },
      { id: "R-6", orderId: "WO-2", status: "issued", lines: [{ actualKg: 4 }] },
    ],
  };
  assert.deepEqual(data.requisitions.map((req) => rfRules.requisitionReturnState(data, req)), ["pending", null, null, "pending", "returned", null]);
  assert.deepEqual(rfRules.returnableRequisitions(data).map((req) => req.id), ["R-1", "R-4"]);
  assert.deepEqual(rfRules.mixableRequisitions(data).map((req) => req.id), ["R-6"], "a requisition of a cancelled work order cannot be mixed");
  // ใบที่ยกเลิก: สต็อกสินค้าสำเร็จรูปนับจำนวนสั่ง = 0 · บรรทัดของซื้อไม่มี partial
  const fg = { orders: [{ id: "PI-1", status: "cancelled", items: [{ fgCode: "FG-1", qty: 5 }] }, { id: "PI-2", status: "completed", items: [{ fgCode: "FG-1", qty: 5 }] }], fgMoves: [{ orderId: "PI-1", fgCode: "FG-1", kind: "receive", qty: 2 }, { orderId: "PI-2", fgCode: "FG-1", kind: "receive", qty: 6 }] };
  assert.deepEqual(bomRules.fgFreeList(fg).get("FG-1").map((entry) => [entry.orderId, entry.free]), [["PI-1", 2], ["PI-2", 1]]);
  assert.equal(bomRules.fgPosition({ ...fg, jobs: [] }, fg.orders[0]).products[0].free, 2);
  const parts = { orders: [{ id: "PI-1", status: "cancelled" }], jobs: [{ orderId: "PI-1", dept: "ST", kind: "PURCHASED", itemCode: "P-1", name: "กล่อง", uom: "box", qtyDone: 2, qtyPlanned: 5, status: "in_progress" }], stockMoves: [] };
  assert.deepEqual(bomRules.partReturnLines(parts, "PI-1").map((line) => [line.itemCode, line.returnable, line.partial]), [["P-1", 2, false]]);
});

test("RubberFlow actions: ST takes chemicals back once with a reason for a short return, the RB head or QA skips the rest with a reason", () => {
  const user = (flags) => ({ name: "ผู้ทดสอบ", role: "viewer", db: true, ...flags });
  const remote = (flags) => ({ now: NOW, remote: true, user: user(flags) });
  const state = () => ({
    orders: [{ id: "WO-1", status: "cancelled" }],
    materialLots: [{ lotNo: "L-A", qtyKg: 60, initialKg: 100 }, { lotNo: "L-B", qtyKg: 190, initialKg: 200 }],
    requisitions: [{ id: "R-1", orderId: "WO-1", status: "issued", lines: [{ materialCode: "MAT-A", lotNo: "L-A", actualKg: 40 }, { materialCode: "MAT-B", lotNo: "L-B", actualKg: 20 }] }],
    lots: [{ id: "MX-1", stage: "mixing", readyAt: NOW + HOUR, params: { batches: 1 } }],
    audit: [], counters: {},
  });
  const d = state();
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40, 20] }, remote({ rb: true })), /คลังวัตถุดิบ \(ST\)/);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40] }, remote({ st: true })), /กรุณาระบุจำนวนที่คืนของ MAT-B/);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [41, 20] }, remote({ st: true })), /ไม่เกินที่จ่ายไป 40/);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40, 15] }, remote({ st: true })), /กรุณาระบุเหตุผล/);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40, 15], note: " ab " }, remote({ st: true })), /อย่างน้อย 3/);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40, 20] }, remote({ st: true })), /L-B รับคืนเกินยอดที่รับเข้าคลัง/, "190 + 20 is above the 200 received");
  assert.deepEqual(d.materialLots.map((lot) => lot.qtyKg), [60, 190], "a refusal moves nothing");
  d.materialLots[1].qtyKg = 180;
  assert.equal(RFA.returnRequisition(d, { id: "R-1", kgs: ["40", "15"], note: " หก 5 กก. " }, remote({ st: true })), "R-1");
  assert.deepEqual(d.materialLots.map((lot) => lot.qtyKg), [100, 195]);
  assert.deepEqual(d.requisitions[0].lines.map((line) => [line.returnedKg, line.returnNote, line.returnedAt]), [[40, "หก 5 กก.", NOW], [15, "หก 5 กก.", NOW]]);
  assert.throws(() => RFA.returnRequisition(d, { id: "R-1", kgs: [40, 15], note: "ซ้ำ" }, remote({ st: true })), /รับคืนแล้ว/);
  const open = state();
  open.orders[0].status = "in_progress";
  assert.throws(() => RFA.returnRequisition(open, { id: "R-1", kgs: [40, 20] }, remote({ st: true })), /ใบสั่งผลิตที่ถูกยกเลิก/);
  // ข้ามเวลาบ่ม
  const r = state();
  assert.throws(() => RFA.endRest(r, { lotId: "MX-1", reason: "เร่งงาน" }, remote({ rb: true })), /ผู้จัดการแผนก RB[\s\S]*QA/);
  assert.throws(() => RFA.endRest(r, { lotId: "MX-1" }, remote({ rbHead: true })), /เหตุผลที่ข้ามเวลาบ่ม/);
  assert.throws(() => RFA.endRest(r, { lotId: "MX-1", reason: "ก".repeat(301) }, remote({ qa: true })), /ยาวเกิน 300/);
  RFA.endRest(r, { lotId: "MX-1", reason: " ตรวจความหนืดแล้ว " }, remote({ qa: true }));
  assert.deepEqual([r.lots[0].readyAt, r.lots[0].params], [NOW, { batches: 1, skipRest: { by: "ผู้ทดสอบ", reason: "ตรวจความหนืดแล้ว", at: NOW } }]);
});
