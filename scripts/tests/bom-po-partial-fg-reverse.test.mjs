import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// ชุดแก้ 2 (20261128020000_bom_po_partial_fg_reverse.sql) ฝั่ง Supabase จำลองของ harness และกฎฝั่งหน้า:
// W2 รับของตามใบสั่งซื้อได้หลายครั้งต่อบรรทัด (ยอดสะสม ล็อตใหม่ต่อครั้ง) · ST ปิดยอดที่เหลือพร้อมเหตุผล · ยอดค้างรับนับเฉพาะส่วนที่ยังไม่มา
// U3 ผู้จัดการแผนกคลังสินค้า (WH) และ admin ย้อนรับเข้าคลัง / ย้อนส่งมอบทั้งรายการพร้อมเหตุผล · ยอดทุกตัวหักแถวย้อน · ใบที่ปิดแล้วเปิดกลับเมื่อของไม่ครบ
// mock ต้องตอบรหัสเดียวกับฐานข้อมูลทุกข้อ (pgTAP คู่กันอยู่ใน supabase/tests/database/bom_po_partial_fg_reverse.test.sql)
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const rfRules = globalThis.MNP_RUBBERFLOW_RULES;
const bomRules = globalThis.MNP_BOM_RULES;
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const A = globalThis.MNP_BOM_ACTIONS;
const RFA = require("../../modules/rubberflow-actions.js");

const NOW = Date.parse("2026-11-28T10:00:00+07:00");
const DAY = 86400000;
const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves"];
const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });

const order = (id, extra = {}) => ({ id, customer: "ลูกค้า", country: "Thailand", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * DAY, due: {}, dueDefaults: [], revision: 0, status: "in_progress", items: [{ fgCode: "FG-1", qty: 5, colorSet: "", note: "" }], explosion: [{ itemCode: "FG-1", level: 0 }], explodedAt: 1, stockCounts: {}, note: "", createdBy: "x", createdAt: 1, ...extra });
const pkJob = (id, orderId, extra = {}) => ({ id, orderId, dept: "PK", itemCode: "FG-1", name: "แพ็ก", kind: "FG", uom: "set", qtyPlanned: 5, qtyRequired: 5, stockCounted: null, qtyDone: 5, qtyReject: 0, dueAt: NOW + DAY, status: "done", externalRef: null, fgCodes: ["FG-1"], createdAt: 1, reports: [{ at: 1, by: "x", good: 5, reject: 0, note: "" }], ...extra });
const move = (id, orderId, kind, qty, extra = {}) => ({ id, orderId, fgCode: "FG-1", kind, qty, note: "", at: 1, by: "x", ...extra });

// ข้อมูลตั้งต้น (ใส่ลง storage ของ mock ตรง ๆ):
//   PI-1 ปิดแล้ว (รับครบ): PK ทำ 5 · รับเข้า R1 3 + R2 2 · ส่งมอบ D1 2 · PI-2 กำลังผลิต (ใบอื่น) · PI-3 ยกเลิกแล้วที่รับเข้าไว้ 1
//   RubberFlow: วัตถุดิบ MAT-A · ของซื้อ P-1 ใน BOM (สต็อก 0)
//   surplus: PK ของ PI-1 ทำ 7 และรับส่วนเกิน R4 2 (สต็อกสินค้าสำเร็จรูป) · ใบร่าง PI-4 สั่ง 2 ตั้งใช้จากสต็อก 2
function seeded({ surplus = false } = {}) {
  const map = new Map();
  const bom = { version: 5, epoch: "e-bom", versions: Object.fromEntries(BOM_LISTS.map((list) => [list, {}])), tombstones: [], audit: [], ...Object.fromEntries(BOM_LISTS.map((list) => [list, []])) };
  bom.items = [{ code: "FG-1", kind: "FG", name: "สินค้า", uom: "set" }, { code: "P-1", kind: "PURCHASED", name: "กล่อง", uom: "box" }];
  bom.orders = [order("PI-1", { status: "completed", completedAt: 1 }), order("PI-2"), order("PI-3", { status: "cancelled", cancelledAt: 1, cancelReason: "ทดสอบ" })];
  bom.jobs = [pkJob("JOB-1", "PI-1", surplus ? { qtyPlanned: 7, qtyRequired: 7, qtyDone: 7, reports: [{ at: 1, by: "x", good: 7, reject: 0, note: "" }] } : {}), pkJob("JOB-2", "PI-2", { qtyDone: 0, status: "queued", reports: [] }), pkJob("JOB-3", "PI-3", { qtyDone: 1, status: "in_progress", reports: [{ at: 1, by: "x", good: 1, reject: 0, note: "" }] })];
  bom.fgMoves = [move("00000001-r1", "PI-1", "receive", 3), move("00000002-r2", "PI-1", "receive", 2), move("00000003-d1", "PI-1", "deliver", 2), move("00000004-r3", "PI-3", "receive", 1)];
  if (surplus) {
    bom.fgMoves.push(move("00000005-r4", "PI-1", "receive", 2));
    bom.orders.push(order("PI-4", { status: "draft", items: [{ fgCode: "FG-1", qty: 2, colorSet: "", note: "" }], stockCounts: { "FG-1": 2 }, explodedAt: null }));
  }
  // 20261224010000: WH รับได้ไม่เกินที่ PK ส่งให้ WH · ข้อมูลตั้งต้นมีแถวส่ง PK → WH เท่ายอดที่ PK ทำของทุกงาน (เพดานจึงเท่ายอดที่ PK ทำเหมือนเดิม)
  bom.grHandovers = bom.jobs.filter((job) => job.qtyDone > 0).map((job, index) => ({ id: `5a1e0000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, jobId: job.id, orderId: job.orderId, itemCode: job.itemCode, qty: job.qtyDone,
    status: "sent", note: "", fromDept: "PK", toDept: "WH", sentBy: "x", sentAt: 1, receivedBy: null, receivedAt: null, cancelledBy: null, cancelledAt: null, cancelReason: null, moves: [] }));
  const rf = { version: 7, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) };
  rf.materials = [{ code: "MAT-A", name: "ยาง", category: "เคมี", storage: "A-1", uom: "kg", active: true, safetyKg: 0, shelfLifeDays: 180 }];
  map.set("mnp-harness-bom-master", JSON.stringify(bom));
  map.set("mnp-harness-rf-master", JSON.stringify(rf));
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage(map) });
  const data = async (name, args = {}) => { const reply = await client.rpc(name, args); assert.equal(reply.error, null, reply.error?.message); return reply.data; };
  const as = (persona) => data("app_sandbox_enter", { p_persona_id: persona });
  const bomView = () => data("app_bom_master");
  const rfView = () => data("app_rf_master");
  const bomSave = async (changes, action) => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: (await bomView()).version, p_action: action });
  const rfSave = async (changes, action) => client.rpc("app_rf_save", { p_changes: changes, p_base_version: (await rfView()).version, p_action: action });
  const code = async (promise) => (await promise).error?.code ?? null;
  return { as, bomView, rfView, bomSave, rfSave, code, data };
}
const reverse = (s, orderId, moveId, note = "บันทึกผิดจำนวน", extra = {}) => s.bomSave({ fgMoves: { upsert: [{ orderId, kind: "reverse", moveId, note, ...extra }] } }, "reverseFg");
const receive = (s, orderId, qty) => s.bomSave({ fgMoves: { upsert: [{ orderId, kind: "receive", lines: [{ fgCode: "FG-1", qty }] }] } }, "receiveFg");

test("mock: only the WH department manager and admin reverse; the staff of WH and the planning group get BOM_FORBIDDEN; shape and reason come first", async () => {
  const s = seeded();
  await s.as("persona-wh");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2")), "BOM_FORBIDDEN", "WH staff (the coarse gate: reverseFg is not a staff action)");
  await s.as("persona-pp");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2")), "BOM_FORBIDDEN", "the planning group");
  await s.as("persona-pk");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2")), "BOM_FORBIDDEN", "PK staff");
  await s.as("persona-whh");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2", "ab")), "BOM_INVALID_FG", "a reason shorter than three characters");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2", "   ")), "BOM_INVALID_FG", "a blank reason");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2", "ก".repeat(301))), "BOM_INVALID_FG", "a reason above 300 characters");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2", "บันทึกผิด", { kind: "receive" })), "BOM_INVALID_FG", "the request kind must be reverse");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2", "บันทึกผิด", { lines: [{ fgCode: "FG-1", qty: 1 }] })), "BOM_INVALID_FG", "no lines: the whole move is reversed");
  assert.equal(await s.code(s.bomSave({ fgMoves: { upsert: [] } }, "reverseFg")), "BOM_INVALID_FG", "an empty request");
  assert.equal(await s.code(s.bomSave({ fgMoves: { upsert: [{ orderId: "PI-1", kind: "reverse", moveId: "00000002-r2", note: "บันทึกผิด" }] }, jobs: { upsert: [(await s.bomView()).jobs[0]] } }, "reverseFg")), "BOM_INVALID_FG", "only the request travels with reverseFg");
  assert.equal(await s.code(reverse(s, "PI-2", "00000002-r2")), "BOM_INVALID_FG", "a move of another order");
  assert.equal(await s.code(reverse(s, "PI-1", "nope")), "BOM_INVALID_FG", "an unknown move");
  assert.equal(await s.code(reverse(s, "PI-9", "00000002-r2")), "BOM_INVALID_FG", "an unknown order");
  assert.equal((await s.bomView()).version, 5, "nothing was written");
});

test("mock: reversing checks the numbers, reopens a closed order, refuses twice, and the next receipt closes it again", async () => {
  const s = seeded();
  await s.as("persona-whh");
  // R1 3 + R2 2 ส่งมอบ 2: ย้อน R1 จะเหลือ 2 ≥ ส่งมอบ 2 ได้ · ส่งมอบ 2 ก่อน: ย้อน R2 แล้วย้อน R1 จะเหลือ 0 < ส่งมอบ 2 = BOM_FG_EXCEEDS
  const reply = await reverse(s, "PI-1", "00000002-r2", "  พิมพ์ผิด  ");
  assert.equal(reply.error, null, reply.error?.message);
  const unreceive = reply.data.changes.fgMoves.upsert[0];
  assert.deepEqual([unreceive.kind, unreceive.qty, unreceive.note, unreceive.reversesId, unreceive.orderId], ["unreceive", 2, "พิมพ์ผิด", "00000002-r2", "PI-1"]);
  const reopened = reply.data.changes.orders.upsert.find((row) => row.id === "PI-1");
  assert.equal(reopened.status, "in_progress", "the closed order reopens: 3 left of the 5 ordered");
  assert.equal(reopened.completedAt, undefined);
  assert.equal((await s.data("app_bom_audit", { p_limit: 1 }))[0].detail, "fgMoves +1, orders +1");
  assert.equal(await s.code(reverse(s, "PI-1", "00000002-r2")), "BOM_INVALID_TRANSITION", "a move cannot be reversed twice");
  assert.equal(await s.code(reverse(s, "PI-1", unreceive.id)), "BOM_INVALID_FG", "a reversal cannot be reversed");
  assert.equal(await s.code(reverse(s, "PI-1", "00000001-r1")), "BOM_FG_EXCEEDS", "the delivery of 2 has to be reversed first (0 would be left)");
  await s.as("persona-1"); // admin
  const undeliver = await reverse(s, "PI-1", "00000003-d1", "ส่งผิดใบ");
  assert.equal(undeliver.error, null);
  assert.equal(undeliver.data.changes.fgMoves.upsert[0].kind, "undeliver");
  assert.equal((await s.data("app_bom_audit", { p_limit: 1 }))[0].detail, "fgMoves +1", "a delivery reversal does not touch the order");
  assert.equal((await reverse(s, "PI-1", "00000001-r1", "รับซ้ำ")).error, null, "now the first receipt can go too");
  // ยอดทุกตัวหักแถวย้อน: รับสุทธิ 0 · ส่งมอบสุทธิ 0 · รับใหม่ได้ถึงยอด PK (5) แล้วใบปิดเองอีกครั้ง
  await s.as("persona-wh");
  assert.equal(await s.code(receive(s, "PI-1", 6)), "BOM_FG_EXCEEDS", "the ceiling uses the net received quantity");
  const again = await receive(s, "PI-1", 5);
  assert.equal(again.error, null, again.error?.message);
  assert.equal(again.data.changes.orders.upsert.find((row) => row.id === "PI-1").status, "completed", "the correct receipt closes the order again");
  const view = await s.bomView();
  assert.deepEqual(view.fgMoves.filter((row) => row.orderId === "PI-1").map((row) => [row.kind, row.qty, row.reversesId ?? null]),
    [["receive", 3, null], ["receive", 2, null], ["deliver", 2, null], ["unreceive", 2, "00000002-r2"], ["undeliver", 2, "00000003-d1"], ["unreceive", 3, "00000001-r1"], ["receive", 5, null]]);
  // กฎฝั่งหน้าเห็นตัวเลขเดียวกับ mock
  const pos = bomRules.fgPosition(view, view.orders.find((row) => row.id === "PI-1"));
  assert.deepEqual([pos.products[0].own, pos.products[0].delivered, pos.products[0].have], [5, 0, 5]);
  assert.deepEqual(pos.reversedIds.sort(), ["00000001-r1", "00000002-r2", "00000003-d1"]);
  // ใบที่ยกเลิกแล้วย้อนไม่ได้
  await s.as("persona-whh");
  assert.equal(await s.code(reverse(s, "PI-3", "00000004-r3")), "BOM_INVALID_TRANSITION", "a cancelled order cannot be reversed");
});

test("mock: a receipt whose surplus another order already took cannot be reversed; a net delivery blocks a cancel until it is reversed", async () => {
  // PI-1 รับเกิน (PK ทำ 7 รับ 7 สั่ง 5): ใบร่าง PI-4 ปล่อยผลิตโดยหยิบส่วนเกิน 2 ไป (out 2) · ย้อนรับเข้าใดของ PI-1 ก็ทำให้เหลือไม่พอที่สั่ง = BOM_FG_EXCEEDS
  const t = seeded({ surplus: true });
  await t.as("persona-pp");
  const draft = (await t.bomView()).orders.find((row) => row.id === "PI-4");
  const released = await t.bomSave({ orders: { upsert: [{ ...draft, status: "released" }] } }, "releaseOrder");
  assert.equal(released.error, null, released.error?.message);
  assert.equal(released.data.changes.orders.upsert.find((row) => row.id === "PI-4").status, "completed", "PI-4 is covered by the surplus of PI-1");
  await t.as("persona-whh");
  assert.equal(await t.code(reverse(t, "PI-1", "00000005-r4")), "BOM_FG_EXCEEDS", "the surplus receipt was taken by PI-4");
  assert.equal(await t.code(reverse(t, "PI-1", "00000002-r2")), "BOM_FG_EXCEEDS", "any receipt: 7 − 2 − 2 taken = 3 < 5 ordered");
  const view = await t.bomView();
  assert.match(bomRules.fgReverseBlock(view, view.orders.find((row) => row.id === "PI-1"), view.fgMoves.find((row) => row.id === "00000005-r4")), /ใบอื่นใช้สต็อก FG-1 ของใบนี้ไปแล้ว 2/, "the page says why before sending");
  assert.equal((await reverse(t, "PI-1", "00000003-d1", "ส่งผิด")).error, null, "a delivery can still be reversed");

  // PI-2 รับเข้าและส่งมอบ แล้วยกเลิกไม่ได้จนกว่าจะย้อนการส่งมอบ
  const s = seeded();
  const job = (await s.bomView()).jobs.find((row) => row.id === "JOB-2");
  await s.as("persona-pk");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...job, status: "in_progress", qtyDone: 2, reports: [{ at: 1, by: "x", good: 2, reject: 0, note: "" }] }] } }, "reportJob")).error, null);
  // PK ส่งให้ WH ก่อนรับ (20261224010000) โดยฝ่ายวางแผน
  await s.as("persona-pp");
  assert.equal((await s.bomSave({ grHandovers: { upsert: [{ id: "5a1e0000-0000-4000-8000-000000000099", jobId: "JOB-2", qty: 2, note: "" }] } }, "sendPkToWh")).error, null);
  await s.as("persona-wh");
  assert.equal((await receive(s, "PI-2", 2)).error, null);
  const delivered = await s.bomSave({ fgMoves: { upsert: [{ orderId: "PI-2", kind: "deliver", lines: [{ fgCode: "FG-1", qty: 2 }] }] } }, "deliverFg");
  assert.equal(delivered.error, null);
  await s.as("persona-pp");
  const cancel = async () => s.bomSave({ orders: { upsert: [{ ...(await s.bomView()).orders.find((row) => row.id === "PI-2"), status: "cancelled", cancelReason: "ลูกค้ายกเลิก" }] } }, "cancelOrder");
  assert.equal(await s.code(cancel()), "BOM_INVALID_TRANSITION", "a net delivery blocks the cancel");
  await s.as("persona-whh");
  assert.equal((await reverse(s, "PI-2", delivered.data.changes.fgMoves.upsert[0].id, "ลูกค้าคืนของ")).error, null);
  await s.as("persona-pp");
  assert.equal((await cancel()).error, null, "with the delivery reversed the order can be cancelled");
});

test("mock: purchase lines are received several times (one lot per receipt, the lot holds this receipt only) and the store closes the rest with a reason", async () => {
  const s = seeded();
  await s.as("persona-st");
  const created = await s.rfSave({ purchaseOrders: { upsert: [{ id: "PO-20261128-01", status: "ordered", sourcePi: null, sourceRequisition: null, note: "", lines: [
    { materialCode: "MAT-A", needKg: 10, availableKg: 0, shortageKg: 10, safetyKg: 0, qtyKg: 10 },
    { materialCode: "P-1", source: "bom", needKg: 5, availableKg: 0, shortageKg: 5, safetyKg: 0, qtyKg: 5 }] }] } }, "createPurchaseOrder");
  assert.equal(created.error, null, created.error?.message);
  const po = async () => (await s.rfView()).purchaseOrders[0];
  const lot = (lotNo, kg) => ({ lotNo, materialCode: "MAT-A", qtyKg: kg, initialKg: kg, expiry: NOW + 90 * DAY, supplier: "", location: "", status: "available", coa: false });
  const recvChem = async (total, lotNo, kg) => { const row = await po(); return s.rfSave({ purchaseOrders: { upsert: [{ ...row, lines: [{ ...row.lines[0], receivedKg: total, lotNo, expiry: NOW + 90 * DAY }, row.lines[1]] }] }, materialLots: { upsert: [lot(lotNo, kg)] } }, "receivePurchaseLine"); };
  const recvPart = async (total) => { const row = await po(); return s.rfSave({ purchaseOrders: { upsert: [{ ...row, lines: [row.lines[0], { ...row.lines[1], receivedKg: total }] }] } }, "receivePurchaseLine"); };
  const close = async (index, reason, action = "closePurchaseLine") => { const row = await po(); return s.rfSave({ purchaseOrders: { upsert: [{ ...row, lines: row.lines.map((line, at) => (at === index ? { ...line, closedRemainder: { reason } } : line)) }] } }, action); };

  assert.equal(await s.code(recvChem(6, "LOT-1", 5)), "RF_INVALID_PURCHASE", "the lot must hold this receipt");
  assert.equal((await recvChem(6, "LOT-1", 6)).error, null);
  assert.deepEqual([(await po()).status, (await po()).lines[0].receivedKg, rfRules.poLineOpen((await po()).lines[0])], ["ordered", 6, 4], "4 kg are still on order");
  assert.equal(await s.code(recvChem(5, "LOT-9", 5)), "RF_INVALID_TRANSITION", "a lower cumulative quantity is a correction");
  assert.equal(await s.code(recvChem(10, "LOT-2", 10)), "RF_INVALID_PURCHASE", "the second lot cannot hold the cumulative quantity");
  assert.equal((await recvChem(10, "LOT-2", 4)).error, null);
  assert.deepEqual((await po()).lines[0].receipts.map((receipt) => [receipt.kg, receipt.lotNo]), [[6, "LOT-1"], [4, "LOT-2"]]);
  assert.equal(await s.code(recvChem(11, "LOT-3", 1)), "RF_INVALID_TRANSITION", "a line received in full is done");
  // ของซื้อ: สต็อกบวกเฉพาะครั้งนี้
  assert.equal((await recvPart(2)).error, null);
  assert.deepEqual((await s.bomView()).stock.map((row) => [row.itemCode, row.qty]), [["P-1", 2]]);
  // client ปลอมรายการรับ = ไม่เปลี่ยนอะไร
  const version = (await s.rfView()).version;
  const row = await po();
  assert.equal((await s.rfSave({ purchaseOrders: { upsert: [{ ...row, lines: [row.lines[0], { ...row.lines[1], receipts: [{ kg: 99, at: 1, by: "x" }] }] }] } }, "receivePurchaseLine")).error, null);
  assert.equal((await s.rfView()).version, version, "a forged receipt list writes nothing");
  // ปิดยอดที่เหลือ: ST / admin เท่านั้น เหตุผล 3-300 คำสั่งปิดเท่านั้น บรรทัดที่ครบปิดไม่ได้
  await s.as("persona-pp");
  assert.equal(await s.code(close(1, "ผู้ขายส่งไม่ครบ")), "RF_FORBIDDEN", "the planning group");
  await s.as("persona-wh");
  assert.equal(await s.code(close(1, "ผู้ขายส่งไม่ครบ")), "RF_FORBIDDEN", "WH staff");
  await s.as("persona-st");
  assert.equal(await s.code(close(1, "ab")), "RF_INVALID_PURCHASE", "a reason shorter than three characters");
  assert.equal(await s.code(close(1, "ผู้ขายส่งไม่ครบ", "receivePurchaseLine")), "RF_INVALID_PURCHASE", "closing needs the close action");
  assert.equal(await s.code(close(0, "ปิดบรรทัดที่ครบ")), "RF_INVALID_TRANSITION", "a done line cannot be closed");
  assert.equal(await s.code(s.rfSave({ purchaseOrders: { upsert: [{ ...(await po()), status: "cancelled" }] } }, "cancelPurchaseOrder")), "RF_INVALID_TRANSITION", "an order with receipts cannot be cancelled");
  const closed = await close(1, "  ผู้ขายไม่มีของส่งเพิ่ม  ");
  assert.equal(closed.error, null, closed.error?.message);
  const after = await po();
  assert.equal(after.status, "received", "every line is done: the chemical in full, the part closed");
  assert.deepEqual(after.lines[1].closedRemainder, { kg: 3, reason: "ผู้ขายไม่มีของส่งเพิ่ม", at: NOW, by: "วิชัย คลังวัตถุดิบ" });
  assert.deepEqual((await s.bomView()).stock.map((entry) => [entry.itemCode, entry.qty]), [["P-1", 2]], "closing does not touch the stock");
  assert.equal(await s.code(recvPart(4)), "RF_INVALID_TRANSITION", "a closed line cannot be received");
  // ใบใหม่ที่มาพร้อมคำขอปิด = RF_INVALID_PURCHASE
  assert.equal(await s.code(s.rfSave({ purchaseOrders: { upsert: [{ id: "PO-20261128-02", status: "ordered", sourcePi: null, sourceRequisition: null, note: "", lines: [
    { materialCode: "MAT-A", needKg: 1, availableKg: 0, shortageKg: 1, safetyKg: 0, qtyKg: 1, closedRemainder: { reason: "ปิดตั้งแต่สร้าง" } }] }] } }, "createPurchaseOrder")), "RF_INVALID_PURCHASE");
});

test("rules: a purchase line is open for what is not received yet; a legacy single receipt counts as closed; on order follows the open quantity", () => {
  const line = (extra) => ({ materialCode: "P", source: "bom", qtyKg: 77.25, receivedKg: null, ...extra });
  assert.deepEqual([rfRules.poLineReceived(line()), rfRules.poLineOpen(line()), rfRules.poLineDone(line())], [0, 77.25, false]);
  const partly = line({ receivedKg: 50, receipts: [{ kg: 50 }] });
  assert.deepEqual([rfRules.poLineReceived(partly), rfRules.poLineOpen(partly), rfRules.poLineDone(partly), rfRules.poLineClosed(partly)], [50, 27.25, false, false], "the report's case: 27.25 boxes stay on order");
  const legacy = line({ receivedKg: 50, lotNo: "L-1", receivedAt: 5, receivedBy: "x" });
  assert.deepEqual([rfRules.poLineOpen(legacy), rfRules.poLineDone(legacy), rfRules.poLineClosed(legacy)], [0, true, true], "a line received once before this change stays closed");
  assert.deepEqual(rfRules.poLineReceipts(legacy), [{ kg: 50, lotNo: "L-1", expiry: null, at: 5, by: "x" }]);
  const closed = line({ receivedKg: 50, receipts: [{ kg: 50 }], closedRemainder: { kg: 27.25, reason: "ไม่ส่งแล้ว" } });
  assert.deepEqual([rfRules.poLineOpen(closed), rfRules.poLineDone(closed)], [0, true]);
  const over = line({ receivedKg: 80, receipts: [{ kg: 50 }, { kg: 30 }] });
  assert.deepEqual([rfRules.poLineReceived(over), rfRules.poLineOpen(over), rfRules.poLineDone(over)], [80, 0, true], "an over-receipt leaves nothing open");
  assert.equal(rfRules.poLineReceived(line({ receivedKg: 0.3, receipts: [{ kg: 0.1 }, { kg: 0.2 }] })), 0.3, "sums are free of binary noise");
  assert.equal(rfRules.poTouched({ lines: [line(), line({ closedRemainder: { kg: 1, reason: "x" } })] }), true);
  assert.equal(rfRules.poTouched({ lines: [line()] }), false);
  // ยอดสั่งแล้วรอรับของของซื้อ (BOM) และเคมี (RubberFlow) ใช้ยอดค้างเดียวกัน
  const pos = [{ status: "ordered", lines: [partly, legacy, closed, { ...line(), materialCode: "Q", qtyKg: 5 }] }, { status: "cancelled", lines: [{ ...line(), materialCode: "Q" }] }];
  assert.deepEqual([...bomRules.partOnOrder(pos)], [["P", 27.25], ["Q", 5]]);
  const chem = { materials: [{ code: "MAT-A" }], recipes: [{ id: "R", revision: 1, status: "approved", batchKg: 10, items: [{ materialCode: "MAT-A", phr: 100, stage: 1 }] }], materialLots: [], requisitions: [],
    orders: [{ id: "W", status: "planned", recipeId: "R", recipeRevision: 1, targetKg: 10 }],
    purchaseOrders: [{ status: "ordered", lines: [{ materialCode: "MAT-A", qtyKg: 8, receivedKg: 3, receipts: [{ kg: 3 }] }] }] };
  assert.equal(rfRules.chemicalNeeds(chem, ["W"], NOW).rows.find((row) => row.materialCode === "MAT-A")?.onOrderKg, 5, "only the 5 kg not received yet are on order");
});


test("rules and actions: the ledger subtracts reversals, a reversal is checked like the database, and the local action reopens a closed order", () => {
  const data = {
    orders: [order("PI-1", { status: "completed", completedAt: 1 })],
    jobs: [pkJob("JOB-1", "PI-1")],
    fgMoves: [move("r1", "PI-1", "receive", 3), move("r2", "PI-1", "receive", 2), move("d1", "PI-1", "deliver", 2), move("c1", "PI-1", "close", 0, { fgCode: "", note: "รับครบ ปิดใบโดยคลังสินค้า" })],
    items: [{ code: "FG-1", kind: "FG", uom: "set" }], audit: [],
  };
  const pi = data.orders[0];
  assert.equal(bomRules.fgReverseBlock(data, pi, data.fgMoves[0]), null, "3 of 5 leaves 2, enough for the 2 delivered");
  assert.equal(bomRules.fgReverseReopens(data, pi, data.fgMoves[0]), true, "and the closed order would reopen");
  assert.equal(bomRules.fgReverseReopens(data, pi, data.fgMoves[2]), false, "a delivery reversal never reopens");
  assert.match(bomRules.fgReverseBlock(data, pi, data.fgMoves[3]), /ย้อนได้เฉพาะรายการรับเข้าคลังหรือส่งมอบ/, "a close row cannot be reversed");
  assert.match(bomRules.fgReverseBlock(data, { ...pi, status: "cancelled" }, data.fgMoves[0]), /ใบที่ยกเลิกแล้ว/);
  // สิทธิ์: ผู้จัดการคลังสินค้า (โหมดสาธิต: บทบาท manager ของแผนก WH · โหมดฐานข้อมูล: รหัสบทบาท department_manager) และผู้ดูแลระบบ
  const wh = { id: "B09", role: "wh", dept: "WH", name: "สุดา คลังสินค้า" };
  const whm = { id: "B10", role: "manager", dept: "WH", name: "ประเสริฐ ผู้จัดการคลังสินค้า" };
  assert.deepEqual([wh, whm, { role: "admin", dept: "AD" }, { role: "manager", dept: "FT" }, { role: "manager", dept: "WH", roleCode: "assistant_factory_manager" }, { role: "manager", dept: "WH", roleCode: "department_manager" }].map(A.helpers.canReverseFg),
    [false, true, true, false, false, true]);
  assert.throws(() => A.reverseFg(data, { orderId: "PI-1", moveId: "r2", note: "พิมพ์ผิด" }, { now: NOW, user: wh }), /ผู้จัดการแผนกคลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
  assert.throws(() => A.reverseFg(data, { orderId: "PI-1", moveId: "r2", note: "ab" }, { now: NOW, user: whm }), /อย่างน้อย 3 ตัวอักษร/);
  assert.throws(() => A.reverseFg(data, { orderId: "PI-1", moveId: "nope", note: "พิมพ์ผิด" }, { now: NOW, user: whm }), /ไม่พบรายการที่จะย้อน/);
  const result = A.reverseFg(data, { orderId: "PI-1", moveId: "r2", note: "  พิมพ์ผิด  " }, { now: NOW, user: whm });
  assert.equal(result.reopened, true);
  assert.deepEqual([pi.status, pi.completedAt], ["in_progress", undefined], "the closed order reopens at once");
  assert.deepEqual(data.fgMoves.at(-1), { id: `local-${NOW}-5`, orderId: "PI-1", fgCode: "FG-1", kind: "unreceive", qty: 2, note: "พิมพ์ผิด", at: NOW, by: whm.name, reversesId: "r2" });
  assert.deepEqual(result.request, { orderId: "PI-1", kind: "reverse", moveId: "r2", note: "พิมพ์ผิด" });
  const pos = bomRules.fgPosition(data, pi);
  assert.deepEqual([pos.products[0].own, pos.products[0].have, pos.reversedIds], [3, 3, ["r2"]]);
  assert.deepEqual([pos.fullClose, pos.shortClose], [null, null], "the old close row does not mark a reopened order as closed");
  assert.throws(() => A.reverseFg(data, { orderId: "PI-1", moveId: "r2", note: "ซ้ำ" }, { now: NOW, user: whm }), /ถูกย้อนไปแล้ว/);
  assert.throws(() => A.reverseFg(data, { orderId: "PI-1", moveId: "r1", note: "ซ้ำ" }, { now: NOW, user: whm }), /ให้ย้อนการส่งมอบก่อน/, "0 would be left of the 2 delivered");
  // โหมดฐานข้อมูล: ตรวจและคืนคำขออย่างเดียว ไม่เขียนแถวย้อนเอง (เซิร์ฟเวอร์เขียน)
  const before = data.fgMoves.length;
  const remote = A.reverseFg(data, { orderId: "PI-1", moveId: "d1", note: "ส่งผิดใบ" }, { now: NOW, user: { role: "admin", dept: "AD", name: "แอดมิน" }, remote: true });
  assert.deepEqual(remote.request, { orderId: "PI-1", kind: "reverse", moveId: "d1", note: "ส่งผิดใบ" });
  assert.equal(data.fgMoves.length, before, "no local row in database mode");
  // บัญชีเกี่ยวกับใบสั่งซื้อในเครื่อง: รับไม่ครบยังค้าง รับเพิ่ม แล้วปิดยอดที่เหลือ
  const rf = { materials: [{ code: "MAT-A", name: "ยาง", storage: "A-1", active: true, safetyKg: 0 }], materialLots: [], purchaseOrders: [], audit: [], counters: {} };
  const st = { now: NOW, user: { name: "สมศักดิ์", role: "store" } };
  const id = RFA.createPurchaseOrder(rf, { lines: [{ materialCode: "MAT-A", needKg: 10, availableKg: 0, shortageKg: 10, qtyKg: 10 }] }, st);
  RFA.receivePurchaseLine(rf, { id, materialCode: "MAT-A", qtyKg: 4, expiry: NOW + 30 * DAY }, st);
  assert.equal(rfRules.poLineOpen(rf.purchaseOrders[0].lines[0]), 6);
  assert.throws(() => RFA.cancelPurchaseOrder(rf, { id }, st), /รับเข้าหรือปิดยอดแล้ว/);
  RFA.closePurchaseLine(rf, { id, materialCode: "MAT-A", reason: "ผู้ขายส่งไม่ครบ" }, st);
  assert.deepEqual([rf.purchaseOrders[0].status, rf.purchaseOrders[0].lines[0].closedRemainder.kg], ["received", 6]);
  assert.throws(() => RFA.receivePurchaseLine(rf, { id, materialCode: "MAT-A", qtyKg: 1, expiry: NOW + DAY }, st), /รับครบแล้ว|ถูกยกเลิกแล้ว/);
});
