import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// โรงงานขั้น 9: งานตามหลังของใบสั่งผลิตจากฝ่ายขาย (20261227010000_bom_sales_followups.sql · pgTAP คู่กัน: supabase/tests/database/bom_sales_followups.test.sql)
//  1) เปิดงานเพิ่มนับเฉพาะที่ฝ่ายขายเปลี่ยน (plannedItems) · "ต้องการ" ของงานเดิมเพิ่มตามยอดแผน   2) ใช้สต็อกสินค้าสำเร็จรูป (WH) / ยางเส้นยาว (SR) กับส่วนที่เพิ่ม
//  3) ธง started / locked ของเซิร์ฟเวอร์ที่ฝ่ายขายใช้แทนการเดาจาก WO   4) ใบที่ปิดแล้ว การแจ้งแก้ใบปิดเอง   5) RB บันทึกล็อตตกแต่งของ WO ที่ยกเลิกพร้อมใบที่ฝ่ายวางแผนเลือกหยุด (ไป SR เท่านั้น)
// คำสั่ง (modules/bom-actions.js) · store · Supabase จำลองของ harness ต้องตอบเหมือนฐานข้อมูล
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const A = globalThis.MNP_BOM_ACTIONS;
const R = globalThis.MNP_BOM_RULES;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");
const rfActions = require("../../modules/rubberflow-actions.js");
const rfStoreApi = require("../../modules/rubberflow-store.js");
const rfSeed = require("../../modules/rubberflow-seed.js");

const NOW = Date.parse("2026-11-25T10:00:00+07:00");
const DAY = 86400000;
const FG = "DEMO-HL-24(B)-A";
const fresh = () => seed.buildSeed(NOW);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const USERS = {
  sa: { id: "SA-1", role: "sa", dept: "SA", roleCode: "staff", name: "สุนิสา ขายดี" },
  planner: seed.USERS.find((row) => row.role === "planner"),
};
const ctx = (who, extra = {}) => ({ now: NOW, user: USERS[who], ...extra });
const orderOf = (d, id) => d.orders.find((row) => row.id === id);
const jobsOf = (d, pi) => d.jobs.filter((job) => job.orderId === pi);
const jobOf = (d, pi, dept) => jobsOf(d, pi).find((job) => job.dept === dept);
const fns = (d) => ({ itemOf: (code) => A.helpers.itemOf(d, code), approvedBomOf: (code) => A.helpers.approvedBomOf(d, code) });

// ใบของฝ่ายขายที่ปล่อยผลิตแล้วและ PK รายงานผล 1 ชุด (เริ่มงาน) · ฝ่ายขายเพิ่มเป็น to ชุด
function startedOrder(d, pi, qty = 3, to = null) {
  A.createOrder(d, { pi, customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty }], send: true }, ctx("sa"));
  A.releaseOrder(d, { orderId: pi }, ctx("planner"));
  A.reportJob(d, { jobId: jobOf(d, pi, "PK").id, qtyDone: 1, note: "ชุดแรก" }, ctx("planner"));
  if (to !== null) A.updateOrderItem(d, { orderId: pi, fgCode: FG, qty: to }, ctx("sa"));
  return orderOf(d, pi);
}
// สต็อกสินค้าสำเร็จรูปว่างของใบอื่น (SRC-9 ปิดแล้ว สั่ง 2 รับเข้า 2 + free)
function addFgStock(d, free, code = FG) {
  d.orders.push({ id: "SRC-9", source: "PP", status: "completed", customer: "x", country: "Thailand", orderType: "SA", orderedAt: NOW - DAY, whDue: NOW, due: {}, dueDefaults: [], revision: 0,
    items: [{ fgCode: code, qty: 2, colorSet: "A", note: "" }], explosion: [], stockCounts: {}, releasedAt: NOW - 2 * DAY, note: "", createdAt: NOW - DAY, createdBy: "x" });
  d.fgMoves.push({ id: "fg-9", orderId: "SRC-9", fgCode: code, kind: "receive", qty: 2 + free, note: "", at: NOW - DAY, by: "x" });
}
// สต็อกกลางยางเส้นยาว SR ของรหัสนี้ (ล็อตเก็บแล้ว ไม่มีเจ้าของ)
function addRodStock(d, itemCode, qty) {
  d.rodLots.push({ id: "rod-lot-9", lotNo: "FN-ROD-9", itemCode, orderId: "SRC-9", jobNo: "J-9", woNo: "WO-9", uom: "rod", qtySent: qty, status: "stored", qtyReceived: qty, qc: "pass", receivedAt: NOW - DAY, createdAt: NOW - DAY, location: "A-01", source: "order" });
  d.rodMoves.push({ id: "rod-mv-9", lotId: "rod-lot-9", itemCode, kind: "receive", qty, ownerOrderId: null, forOrderId: null, reversesId: null, note: "", at: NOW - DAY, by: "x" });
}

// ---------- 1) เปิดงานเพิ่มนับเฉพาะส่วนที่ฝ่ายขายเพิ่ม ----------
test("extra jobs: release records plannedItems; only the delta is exploded, a planner's hand adjustment is kept and not re-applied, 'ต้องการ' rises with the plan, and nothing is left to open afterwards", () => {
  const d = fresh();
  startedOrder(d, "SA-F1", 3);
  assert.deepEqual(orderOf(d, "SA-F1").plannedItems, { [FG]: 3 }, "release stores the item quantities the jobs were opened for");
  const rb = jobOf(d, "SA-F1", "RB");
  const pk = jobOf(d, "SA-F1", "PK");
  rb.qtyPlanned += 10; // ฝ่ายวางแผนปรับยอดเองหลังปล่อยผลิต
  const bumped = rb.qtyPlanned;
  const requiredBefore = new Map(jobsOf(d, "SA-F1").map((job) => [job.id, job.qtyRequired]));
  A.updateOrderItem(d, { orderId: "SA-F1", fgCode: FG, qty: 5 }, ctx("sa"));
  const plan = A.helpers.extraJobsFor(d, orderOf(d, "SA-F1"), []);
  assert.deepEqual(plan.lines, [{ fgCode: FG, before: 3, after: 5, added: 2 }]);
  // ผลระเบิดของส่วนที่เพิ่ม (2 ชุด) อย่างเดียว: ยอดงาน RB = ปัดเป็นเส้นเต็มของส่วนต่าง ไม่ใช่ผลต่างของทั้งใบกับยอดที่ปรับเอง
  const delta = R.netRequirements(R.explode(FG, 2, fns(d)).lines, {});
  const rbWant = delta.find((entry) => entry.kind === "RB");
  const rbPlan = plan.jobs.find((entry) => entry.dept === "RB");
  assert.deepEqual([rbPlan.mode, rbPlan.from, rbPlan.diff, rbPlan.to], ["raise", bumped, R.wholeRods("RB", rbWant.uom, rbWant.toMake), bumped + R.wholeRods("RB", rbWant.uom, rbWant.toMake)]);
  assert.deepEqual([plan.jobs.find((entry) => entry.dept === "PK").diff, plan.legacy], [2, false]);
  const out = A.addJobsForChanges(d, { orderId: "SA-F1" }, ctx("planner", { rfOrders: [] }));
  assert.equal(out.created + out.raised, plan.jobs.length);
  // "8 ชุด ต้องการ 6" ไม่เกิด: ต้องการเพิ่มเท่าส่วนที่เพิ่ม (PK 3 → 5)
  assert.deepEqual([pk.qtyPlanned, pk.qtyRequired], [5, 5]);
  assert.deepEqual([rb.qtyPlanned, rb.qtyRequired], [bumped + rbPlan.diff, requiredBefore.get(rb.id) + rbWant.required], "the RB job keeps the hand adjustment and gains the delta of both plan and requirement");
  assert.deepEqual(orderOf(d, "SA-F1").plannedItems, { [FG]: 5 }, "the order now counts 5 as opened");
  assert.deepEqual(A.helpers.extraJobsFor(d, orderOf(d, "SA-F1"), []).lines, [], "nothing left: the card goes away");
  // ฝ่ายขายลดแล้วเพิ่มกลับไม่เกินที่เปิดไว้ = ไม่มีอะไรให้เปิด · เพิ่มเกิน = นับเฉพาะส่วนที่เกิน
  A.updateOrderItem(d, { orderId: "SA-F1", fgCode: FG, qty: 4 }, ctx("sa"));
  A.updateOrderItem(d, { orderId: "SA-F1", fgCode: FG, qty: 5 }, ctx("sa"));
  assert.deepEqual(A.helpers.extraJobsFor(d, orderOf(d, "SA-F1"), []).lines, []);
  A.updateOrderItem(d, { orderId: "SA-F1", fgCode: FG, qty: 6 }, ctx("sa"));
  assert.deepEqual(A.helpers.extraJobsFor(d, orderOf(d, "SA-F1"), []).lines, [{ fgCode: FG, before: 5, after: 6, added: 1 }]);
  assert.equal(order(d, "SA-F1").explosion.filter((line) => line.level === 0).length > 0, true, "the order keeps an explosion of its current items");
});
const order = orderOf;

test("extra jobs: an order without plannedItems (older data) falls back to the whole-order comparison and takes no stock; reopening to draft clears plannedItems", () => {
  const d = fresh();
  startedOrder(d, "SA-F2", 3, 5);
  delete orderOf(d, "SA-F2").plannedItems;
  const legacy = A.helpers.extraJobsFor(d, orderOf(d, "SA-F2"), []);
  assert.equal(legacy.legacy, true);
  assert.deepEqual([legacy.lines, legacy.stock], [[{ fgCode: FG, before: 3, after: 5, added: 2 }], []]);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-F2", use: [{ itemCode: FG, qty: 1 }] }, ctx("planner", { rfOrders: [] })), /ยังไม่มีบันทึกจำนวนที่เปิดงานไว้แล้ว/);
  const e = fresh();
  A.createOrder(e, { pi: "SA-F3", customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }, ctx("sa"));
  A.releaseOrder(e, { orderId: "SA-F3" }, ctx("planner"));
  assert.deepEqual(orderOf(e, "SA-F3").plannedItems, { [FG]: 3 });
  A.updateOrderItem(e, { orderId: "SA-F3", fgCode: FG, qty: 4 }, ctx("sa")); // ยังไม่เริ่มงาน = เปิดกลับเป็นร่าง
  assert.deepEqual([orderOf(e, "SA-F3").status, orderOf(e, "SA-F3").plannedItems], ["draft", undefined]);
});

// ---------- 2) ใช้สต็อกกับส่วนที่เพิ่ม ----------
test("extra jobs with stock: finished goods of other orders cover the added part — fully (no jobs, transfer rows, plannedItems moves) or partly (the PK job rises by the rest); more than the added part or the stock is refused", () => {
  const d = fresh();
  addFgStock(d, 3);
  startedOrder(d, "SA-F4", 3, 5);
  const order4 = orderOf(d, "SA-F4");
  const plain = A.helpers.extraJobsFor(d, order4, []);
  const row = plain.stock.find((entry) => entry.kind === "FG");
  assert.deepEqual([row.itemCode, row.added, row.available, row.max, row.use], [FG, 2, 3, 2, 0], "up to the added part, from the stock other orders hold (SRC-9: 3 free)");
  // ใช้ 1 จาก 2: งาน PK เพิ่มอีก 1 · ต้องการเพิ่ม 2 · ยอดนับจากสต็อก 1
  const partly = A.helpers.extraJobsFor(d, order4, [], [{ itemCode: FG, qty: "1" }]);
  assert.deepEqual([partly.jobs.find((entry) => entry.dept === "PK").diff, partly.jobs.find((entry) => entry.dept === "PK").requiredTo, partly.counts, partly.increase], [1, 5, { [FG]: 1 }, true]);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-F4", use: [{ itemCode: FG, qty: 3 }] }, ctx("planner", { rfOrders: [] })), /ใช้ได้ไม่เกิน 2/);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-F4", use: [{ itemCode: "NOPE-1", qty: 1 }] }, ctx("planner", { rfOrders: [] })), /ใช้จากสต็อกไม่ได้/);
  // ใช้ครบ 2: ไม่มีงานให้เปิด แต่บันทึกได้เพราะใช้สต็อก
  const before = jobsOf(d, "SA-F4").map((job) => [job.id, job.qtyPlanned, job.qtyRequired]);
  const out = A.addJobsForChanges(d, { orderId: "SA-F4", use: [{ itemCode: FG, qty: "2" }] }, ctx("planner", { rfOrders: [] }));
  assert.deepEqual([out.created, out.raised, out.summary], [0, 0, "งานใหม่ 0 งาน · เพิ่มยอด 0 งาน · ใช้สต็อก 1 รายการ"]);
  assert.deepEqual(jobsOf(d, "SA-F4").map((job) => [job.id, job.qtyPlanned, job.qtyRequired]), before, "no job rises: the stock covers the added part");
  assert.deepEqual([order4.stockCounts[FG], order4.plannedItems], [2, { [FG]: 5 }]);
  assert.deepEqual(d.fgMoves.filter((move) => move.orderId === "SA-F4" && move.kind === "transfer").map((move) => [move.fromOrderId, move.fgCode, move.qty]), [["SRC-9", FG, 2]]);
  assert.match(d.audit[0].detail, new RegExp(`ใช้สต็อก ${FG.replace(/[()]/g, "\\$&")} × 2`));
  // นับซ้ำไม่ได้ เพราะไม่มีส่วนที่เพิ่มเหลือ
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-F4", use: [{ itemCode: FG, qty: 1 }] }, ctx("planner", { rfOrders: [] })), /ไม่ได้เพิ่มสินค้าหรือจำนวน/);
  // ไม่มีงานและไม่ใช้สต็อก (ส่วนที่เพิ่มใช้จากสต็อกได้ครบ แต่ไม่กรอก) ยังเปิดตามปกติ
  const e = fresh();
  addFgStock(e, 3);
  startedOrder(e, "SA-F5", 3, 5);
  assert.equal(A.addJobsForChanges(e, { orderId: "SA-F5" }, ctx("planner", { rfOrders: [] })).raised > 0, true);
});

test("extra jobs with stock: long rods of the SR central stock are used for the RB lines of the added part (transfer pairs, stockCounts, fewer rods to extrude)", () => {
  const d = fresh();
  startedOrder(d, "SA-F6", 3, 5);
  const rb = jobOf(d, "SA-F6", "RB");
  addRodStock(d, rb.itemCode, 50);
  const order6 = orderOf(d, "SA-F6");
  const plain = A.helpers.extraJobsFor(d, order6, []);
  const rod = plain.stock.find((entry) => entry.kind === "RB");
  assert.ok(rod && rod.itemCode === rb.itemCode && rod.max > 0 && rod.available >= 50, "the RB code of the added part with its free central stock");
  const rbPlain = plain.jobs.find((entry) => entry.dept === "RB");
  const use = 1;
  const withRods = A.helpers.extraJobsFor(d, order6, [], { [rb.itemCode]: use });
  const rbWith = withRods.jobs.find((entry) => entry.dept === "RB");
  assert.ok(rbWith ? rbWith.diff < rbPlain.diff : true, "the rods taken shorten the extrusion job");
  const planBefore = rb.qtyPlanned;
  A.addJobsForChanges(d, { orderId: "SA-F6", use: { [rb.itemCode]: use } }, ctx("planner", { rfOrders: [] }));
  assert.equal(order6.stockCounts[rb.itemCode], use);
  assert.deepEqual(d.rodMoves.filter((move) => move.kind === "transfer" && move.forOrderId === "SA-F6").map((move) => [move.qty, move.ownerOrderId]), [[-use, null], [use, "SA-F6"]], "one pair: out of the central bucket, into the order's");
  assert.equal(rb.qtyPlanned, planBefore + (rbWith?.diff ?? 0));
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-F6", use: { [rb.itemCode]: 999 } }, ctx("planner", { rfOrders: [] })), /ไม่ได้|ไม่มีงาน|ใช้ได้ไม่เกิน/);
});

// ---------- 3) Supabase จำลอง ----------
const BOM_KEY = "mnp-harness-bom-master";
const RF_KEY = "mnp-harness-rf-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves", "grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers", "orderRequests"];
const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
const codeOf = async (promise) => (await promise).code ?? null;
function mockScene({ prepare = null, rf = null } = {}) {
  const data = fresh();
  prepare?.(data);
  const master = { version: 1, epoch: "sf-e1", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(LISTS.map((list) => [list, data[list] ?? []])) };
  const storage = memoryStorage();
  storage.setItem(BOM_KEY, JSON.stringify(master));
  if (rf) storage.setItem(RF_KEY, JSON.stringify(rf));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const call = async (name, args) => { const { data: out, error } = await mock.client.rpc(name, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return out; };
  const save = async (persona, action, changes) => {
    await call("app_sandbox_enter", { p_persona_id: persona });
    const version = (await call("app_bom_master")).version;
    const { data: out, error } = await mock.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: action, p_audit: [] });
    return error ? { code: error.code } : { data: out };
  };
  const view = () => call("app_bom_master");
  const orderRow = async (id) => (await view()).orders.find((row) => row.id === id);
  const storeFor = async (personaId, { rfOrders } = {}) => {
    await call("app_sandbox_enter", { p_persona_id: personaId });
    const persona = (await call("app_sandbox_status")).personas.find((row) => row.id === personaId);
    const sent = [];
    const remote = {
      load: () => call("app_bom_master"),
      save: (changes, baseVersion, action, audit, epoch) => { sent.push({ changes, action }); return call("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }); },
      since: (version) => call("app_bom_master_since", { p_version: version }),
    };
    const store = storeApi.createStore({ actions: A, now: () => NOW, remote, persona: () => storeApi.personaUser({ ...persona, isSandbox: true }), rfOrders });
    await store.ensureLoaded();
    return { store, sent };
  };
  return { mock, call, save, view, orderRow, storeFor };
}
const rfBase = () => ({ version: 3, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) });

test("mock store: planning opens the extra jobs and uses stock in one save — FG stock rows travel only as the order row, the server writes the transfer and the plannedItems; the database refuses what the contract refuses", async () => {
  const s = mockScene({ prepare: (d) => { addFgStock(d, 3); startedOrder(d, "SA-M1", 3, 5); startedOrder(d, "SA-M2", 3); } });
  await s.call("app_sandbox_enter", { p_persona_id: "persona-pp" });
  const pp = await s.storeFor("persona-pp", { rfOrders: () => [] });
  const run = pp.store.run("addJobsForChanges", { orderId: "SA-M1", use: [{ itemCode: FG, qty: "2" }] });
  assert.equal(run.ok, true, run.error?.message);
  const saved = await run.saving;
  assert.equal(saved.ok, true, saved.error?.message);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orders"], "fully from stock: no job row travels (the new database accepts no jobs)");
  const row = await s.orderRow("SA-M1");
  assert.deepEqual([row.stockCounts[FG], row.plannedItems], [2, { [FG]: 5 }], "the server records the stock use and what was opened");
  const view = await s.view();
  assert.deepEqual(view.fgMoves.filter((move) => move.orderId === "SA-M1" && move.kind === "transfer").map((move) => [move.fromOrderId, move.qty]), [["SRC-9", 2]]);
  assert.deepEqual((await s.call("app_bom_audit", { p_limit: 1 }))[0].detail.includes("fgMoves +1"), true, "the audit counts the transfer rows");
  // SA-M2: ไม่มีส่วนที่เพิ่ม = BOM_INVALID_TRANSITION (ก่อนเทียบช่องอื่น) · ไม่มีงานและยอดเท่าเดิม = BOM_INVALID_PAYLOAD
  const row2 = await s.orderRow("SA-M2");
  const explosion = [{ itemCode: FG, kind: "FG", level: 0, fgCode: FG, required: 3 }];
  const pay = (order, extra = {}) => ({ orders: { upsert: [{ ...order, explosion, ...extra }] } });
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2))), "BOM_INVALID_PAYLOAD", "no jobs and the same counts");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, { stockCounts: { [FG]: 1 } }))), "BOM_INVALID_TRANSITION", "nothing was added to this order");
  // ที่เหลือใช้ SA-M3: ฝ่ายขายเพิ่ม 3 → 5
  const s3 = mockScene({ prepare: (d) => { addFgStock(d, 1); startedOrder(d, "SA-M3", 3, 5); } });
  const row3 = await s3.orderRow("SA-M3");
  const ex3 = [{ itemCode: FG, kind: "FG", level: 0, fgCode: FG, required: 5 }];
  const pay3 = (counts, extra = {}) => ({ orders: { upsert: [{ ...row3, explosion: ex3, stockCounts: counts, ...extra }] } });
  assert.equal(await codeOf(s3.save("persona-sa", "addJobsForChanges", pay3({ [FG]: 1 }))), "BOM_FORBIDDEN", "sales cannot");
  assert.equal(await codeOf(s3.save("persona-pp", "addJobsForChanges", pay3({ [FG]: 3 }))), "BOM_INVALID_ORDER", "more than the added part");
  assert.equal(await codeOf(s3.save("persona-pp", "addJobsForChanges", pay3({ "NOT-IN-ORDER": 1 }))), "BOM_INVALID_ORDER", "a key that is neither a product nor a rod of the explosion");
  assert.equal(await codeOf(s3.save("persona-pp", "addJobsForChanges", pay3({ [FG]: 2 }))), "BOM_FG_EXCEEDS", "the stock holds 1 only");
  assert.equal(await codeOf(s3.save("persona-pp", "addJobsForChanges", pay3({ [FG]: 1 }, { note: "แก้หมายเหตุ" }))), "BOM_INVALID_ORDER", "other fields stay as they were");
  assert.ok((await s3.save("persona-pp", "addJobsForChanges", pay3({ [FG]: 1 }))).data, "one from stock, no jobs: accepted");
  assert.equal(await codeOf(s3.save("persona-pp", "addJobsForChanges", pay3({}))), "BOM_INVALID_TRANSITION", "plannedItems now equals the items: nothing left to open");
});

test("mock store: raising an existing job lifts qtyRequired by the plan the server adds when the sent value is unchanged, keeps a larger requirement as sent and refuses a lower one", async () => {
  const s = mockScene({ prepare: (d) => { startedOrder(d, "SA-M4", 3, 5); } });
  const view = await s.view();
  const row = await s.orderRow("SA-M4");
  const pk = view.jobs.find((job) => job.orderId === "SA-M4" && job.dept === "PK");
  const explosion = [{ itemCode: FG, kind: "FG", level: 0, fgCode: FG, required: 5 }];
  const pay = (job) => ({ orders: { upsert: [{ ...row, explosion }] }, jobs: { upsert: [job] } });
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay({ ...pk, qtyPlanned: pk.qtyPlanned + 2, qtyRequired: pk.qtyRequired - 1 }))), "BOM_INVALID_JOB", "a requirement may not drop");
  assert.ok((await s.save("persona-pp", "addJobsForChanges", pay({ ...pk, qtyPlanned: pk.qtyPlanned + 2 }))).data);
  const after = (await s.view()).jobs.find((job) => job.id === pk.id);
  assert.deepEqual([after.qtyPlanned, after.qtyRequired], [pk.qtyPlanned + 2, pk.qtyRequired + 2], "the server added the same delta to the requirement");
});

// ---------- 4) started / locked / plannedItems จากเซิร์ฟเวอร์ ----------
test("mock: every order row carries started / locked (released and running orders only) and plannedItems; the page uses the flags when RubberFlow's work orders are not loaded", async () => {
  const wo = (id, status, sourceJobId) => ({ id, customer: "ลูกค้าฝ่ายขาย", customerPo: "SA", recipeId: "RC-1", recipeRevision: 1, productCode: "", uom: "rod", color: "ดำ", targetQty: 2, producedQty: 0,
    startDate: NOW, dueDate: NOW + DAY, priority: "normal", note: "", status, sourceJobId, createdAt: NOW - DAY, createdBy: "x" });
  const rbIds = {};
  const rf = rfBase();
  const s = mockScene({
    rf,
    prepare: (d) => {
      for (const pi of ["SA-N1", "SA-N2", "SA-N3"]) {
        A.createOrder(d, { pi, customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }, ctx("sa"));
        A.releaseOrder(d, { orderId: pi }, ctx("planner"));
        const job = jobOf(d, pi, "RB");
        job.externalRef = { system: "rubberflow", woId: `WO-${pi}`, kg: 4 };
        rbIds[pi] = job.id;
      }
      A.reportJob(d, { jobId: jobOf(d, "SA-N3", "PK").id, qtyDone: 1, note: "ชุดแรก" }, ctx("planner"));
      A.createOrder(d, { pi: "SA-N0", customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }, ctx("sa"));
      rf.orders = [wo("WO-SA-N1", "planned", rbIds["SA-N1"]), wo("WO-SA-N2", "in_progress", rbIds["SA-N2"]), wo("WO-SA-N3", "planned", rbIds["SA-N3"])];
    },
  });
  // ผูก WO กับงาน: N1 planned (ยังไม่เริ่ม) · N2 in_progress (เลย released = เริ่มแล้ว แม้งานไม่มียอด) · N3 งาน PK มียอด (เริ่มแล้ว)
  const master = await s.view();
  const byId = (id) => master.orders.find((row) => row.id === id);
  assert.deepEqual([byId("SA-N0").started, byId("SA-N0").locked, byId("SA-N0").plannedItems], [false, false, undefined], "a draft: false / false and no plannedItems");
  assert.deepEqual([byId("SA-N3").started, byId("SA-N3").locked, byId("SA-N3").plannedItems], [true, true, { [FG]: 3 }], "a reported job: started and locked");
  assert.deepEqual([byId("SA-N1").started, byId("SA-N1").locked], [false, false], "released, nothing started (its work order is only planned)");
  assert.deepEqual([byId("SA-N2").started, byId("SA-N2").locked], [true, true], "a work order past release counts as started even before any report");
  // ฝ่ายขาย (อ่าน WO ไม่ได้): ธงทำให้ใบที่ยังไม่เริ่มเปิดกลับเป็นร่างได้ ใบที่เริ่มแล้วแก้ตรง
  const sa = await s.storeFor("persona-sa");
  const data = sa.store.data();
  assert.deepEqual(A.helpers.startedJobs(data, data.orders.find((row) => row.id === "SA-N1"), null), [], "linked jobs are not 'started' when the server says not started");
  assert.equal(A.helpers.orderLocked(data, data.orders.find((row) => row.id === "SA-N1"), null), false);
  assert.ok(A.helpers.startedJobs(data, data.orders.find((row) => row.id === "SA-N3"), null).length > 0);
  assert.equal(A.helpers.orderLocked(data, data.orders.find((row) => row.id === "SA-N3"), null), true);
  // ธงเดิม (ไม่มีช่อง = ฐานข้อมูลรุ่นเก่า): ผูก WO = เริ่มแล้ว ตามกฎเดิม
  const old = { ...data.orders.find((row) => row.id === "SA-N1") };
  delete old.started; delete old.locked;
  assert.ok(A.helpers.startedJobs(data, old, null).length > 0, "no flag: the old rule counts a linked job as started");
  // ธงของเซิร์ฟเวอร์ไม่ถูกส่งกลับไปเป็นการแก้ใบ: ส่งใบที่มี started / locked กลับไป ไม่เปลี่ยนอะไร
  const row = await s.orderRow("SA-N1");
  const before = JSON.stringify((await s.view()).orders.find((r) => r.id === "SA-N1"));
  assert.ok((await s.save("persona-sa", "updateOrderHeader", { orders: { upsert: [{ ...row, started: true, locked: true, plannedItems: { [FG]: 99 } }] } })).data !== undefined);
  assert.equal(JSON.stringify((await s.view()).orders.find((r) => r.id === "SA-N1")), before, "started / locked / plannedItems sent back are ignored");
  void rbIds;
});

// ---------- 5) ใบที่ปิดแล้ว การแจ้งแก้ใบปิดเอง ----------
test("a closed order's open change notice closes itself when the order closes (local and mock); the page helper hides a stale open notice; a mid-way cancel notice stays open", async () => {
  const d = fresh();
  startedOrder(d, "SA-C1", 3);
  A.updateOrderItem(d, { orderId: "SA-C1", fgCode: FG, qty: 4 }, ctx("sa")); // เริ่มงานแล้ว = แก้ตรง + แจ้งฝ่ายวางแผน kind change
  assert.deepEqual(A.helpers.orderRequestsOf(d, "SA-C1").map((row) => [row.kind, row.status]), [["change", "open"]]);
  assert.equal(A.helpers.staleChangeNotice(d, A.helpers.orderRequestsOf(d, "SA-C1")[0]), false);
  orderOf(d, "SA-C1").status = "completed";
  assert.equal(A.helpers.staleChangeNotice(d, A.helpers.orderRequestsOf(d, "SA-C1")[0]), true, "a closed order's open change notice is stale");
  assert.deepEqual(A.helpers.openOrderRequests(d, "SA-C1"), [], "and no longer counts as open work");
  // ฝั่งฐานข้อมูลจำลอง: ใบที่ปล่อยผลิตแล้วได้ครบจากสต็อก (ปิดทันทีในคำสั่งเดียวกัน) ที่มีการแจ้งแก้ใบ (ข้อมูลเก่า) เปิดอยู่ = การแจ้งปิดเอง (รับทราบ) · การแจ้งยกเลิกกลางทางของใบเดียวกันยังเปิดให้เลือก
  const notice = (id, orderId, kind) => ({ id, orderId, kind, reason: "ฝ่ายขายแก้", status: "open", decision: null, requestedBy: "สุนิสา ขายดี", requestedAt: NOW - DAY, decidedBy: null, decidedAt: null });
  const s = mockScene({
    prepare: (e) => {
      addFgStock(e, 3);
      A.createOrder(e, { pi: "SA-C2", customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }, ctx("sa"));
      A.explodeOrder(e, { orderId: "SA-C2" }, ctx("planner"));
      A.setStockCount(e, { orderId: "SA-C2", itemCode: FG, qty: 3 }, ctx("planner"));
      e.orderRequests = [notice("7e000000-0000-4000-8000-000000000001", "SA-C2", "change"), notice("7e000000-0000-4000-8000-000000000002", "SA-C2", "cancel")];
    },
  });
  const rowsOf = async () => (await s.view()).orderRequests.filter((row) => row.orderId === "SA-C2").map((row) => [row.kind, row.status, row.decision]);
  assert.deepEqual(await rowsOf(), [["change", "open", null], ["cancel", "open", null]]);
  const row = await s.orderRow("SA-C2");
  const released = await s.save("persona-pp", "releaseOrder", { orders: { upsert: [{ ...row, status: "released" }] } });
  assert.ok(released.data, released.code);
  assert.equal((await s.orderRow("SA-C2")).status, "completed", "all from stock: the order closes in the same call");
  assert.deepEqual(await rowsOf(), [["change", "done", "ack"], ["cancel", "open", null]], "the edit notice acknowledged itself; the cancel notice stays open for planning's choice");
});

// ---------- 6) RB บันทึกล็อตตกแต่งของ WO ที่ยกเลิกพร้อมใบที่เลือกหยุด ----------
const rfWo = (id, extra) => ({ id, customer: "ลูกค้า", customerPo: "PI-S", recipeId: "RC-T", recipeRevision: 1, productCode: "P-T", uom: "pcs", color: "", targetQty: 1000, producedQty: 100,
  startDate: NOW - DAY, dueDate: NOW + DAY, priority: "normal", note: "", status: "in_progress", createdBy: "ผู้วางแผน", createdAt: NOW - DAY, ...extra });
const rfTransfer = (id, orderId) => ({ id, lotId: "CU-0", orderId, from: "curing", to: "finishing", uom: "pcs", qtySent: 100, qtyReceived: 100, remaining: 100, condition: "ok", note: "",
  status: "received", createdAt: NOW - DAY, createdBy: "พนักงาน RB", sentAt: NOW - DAY, sentBy: "พนักงาน RB", receivedAt: NOW - DAY, receivedBy: "พนักงาน RB" });
async function stopScene({ choice = "stop" } = {}) {
  const storage = memoryStorage();
  const bom = { version: 4, epoch: "bom-e1", ...Object.fromEntries(LISTS.map((list) => [list, []])), versions: Object.fromEntries(LISTS.map((list) => [list, {}])), tombstones: [], audit: [] };
  const base = { customer: "ลูกค้า", items: [], revision: 1, orderedAt: NOW };
  bom.orders = [{ ...base, id: "PI-S", status: "cancelled", cancelledAt: NOW, cancelReason: "ลูกค้ายกเลิก", salesCancelAt: NOW - 1000, salesCancelBy: "สุนิสา ขายดี", salesCancelReason: "ลูกค้ายกเลิก", salesCancelChoice: choice },
    { ...base, id: "PI-X", status: "cancelled", cancelledAt: NOW - 5000, cancelReason: "ยกเลิกทางอื่น" }];
  const job = (id, orderId, woId) => ({ id, orderId, dept: "RB", itemCode: "RB-ITEM", name: "เส้นยาง", kind: "RB", uom: "pcs", qtyPlanned: 100, qtyRequired: 100, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + DAY,
    status: "in_progress", externalRef: { system: "rubberflow", woId, kg: 0, linkedAt: NOW, by: "x" }, fgCodes: [], reports: [], createdAt: NOW });
  bom.jobs = [job("JOB-S", "PI-S", "WO-S"), job("JOB-X", "PI-X", "WO-X")];
  for (const row of bom.orders) bom.versions.orders[row.id] = 4;
  for (const row of bom.jobs) bom.versions.jobs[row.id] = 4;
  storage.setItem(BOM_KEY, JSON.stringify(bom));
  const rf = rfBase();
  // WO-S ยกเลิกพร้อมใบ (เวลาเท่ากัน) · WO-X ยกเลิกทางอื่น (คนละเวลา)
  rf.orders = [rfWo("WO-S", { status: "cancelled", cancelledAt: NOW, sourceJobId: "JOB-S", producedQty: 0 }), rfWo("WO-X", { status: "cancelled", cancelledAt: NOW - 5000, sourceJobId: "JOB-X", producedQty: 0 })];
  rf.lots = [{ id: "CU-0", stage: "curing", orderId: "WO-S", uom: "pcs", machine: "", shift: "D", sources: [], params: {}, goodQty: 400, scrapQty: 0, scrapReason: "", qc: "pass", holdReasons: [], transferredQty: 200, createdAt: NOW - DAY, operator: "พนักงาน RB", moldId: "MD-1" }];
  rf.transfers = [rfTransfer("TR-S", "WO-S"), rfTransfer("TR-X", "WO-X")];
  for (const list of ["orders", "lots", "transfers"]) for (const row of rf[list]) rf.versions[list][row.id] = 3;
  storage.setItem(RF_KEY, JSON.stringify(rf));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const unwrap = ({ data, error }) => { if (error) throw Object.assign(new Error(error.message), { code: error.code }); return data; };
  const call = async (name, args) => unwrap(await mock.client.rpc(name, args));
  const status = await call("app_sandbox_status");
  const rows = Object.fromEntries(status.personas.map((row) => [row.id, row]));
  const adapter = {
    load: () => call("app_rf_master"),
    save: (changes, baseVersion, action, audit, epoch) => call("app_rf_save", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }),
    since: (version) => call("app_rf_master_since", { p_version: version }),
    audit: (limit) => call("app_rf_audit", { p_limit: limit }),
    purge: () => call("app_sandbox_purge_rf"),
  };
  // client: เหมือน module-rubberflow (WO ที่ยกเลิกพร้อมใบที่เลือกหยุด) แต่อ่านข้อมูล BOM ของฉากนี้ · "ทุก WO" ใช้ทดสอบว่าฐานข้อมูลจำลองตัดสินซ้ำเอง
  const stopped = { current: (order) => order.id === "WO-S" };
  const store = rfStoreApi.createStore({ storage: memoryStorage(), seed: () => rfSeed.buildSeed(NOW), actions: rfActions, now: () => NOW, remote: adapter,
    persona: () => rfStoreApi.personaUser(rows["persona-rb"]), salesStopped: (order) => stopped.current(order) });
  await call("app_sandbox_enter", { p_persona_id: "persona-rb" });
  await store.ensureLoaded();
  return { store, call, stopped };
}
const settled = async (out) => { assert.equal(out.ok, true, out.error?.message); const outcome = await out.saving; return outcome; };

test("RB finishing lots of a work order cancelled with a sales 'stop': pass goes to SR only (default), hold is allowed, the customer path is refused; the produced quantity grows and the status stays cancelled; the rods then wait for SR as a pending lot", async () => {
  const s = await stopScene();
  const finish = (payload) => s.store.run("recordFinishing", { transferId: "TR-S", useQty: 10, passedQty: 10, scrapQty: 0, grade: "A", shift: "D", ...payload });
  assert.match(finish({ destination: "customer", perBox: 5 }).error.message, /ถูกยกเลิกแล้ว ส่งมอบให้ลูกค้าไม่ได้/, "the page refuses the customer path");
  const ok = await settled(finish({}));
  assert.equal(ok.ok, true, ok.error?.message);
  const rf = await s.call("app_rf_master");
  const wo = rf.orders.find((row) => row.id === "WO-S");
  assert.deepEqual([wo.status, wo.producedQty], ["cancelled", 10], "produced grows, still cancelled");
  const lot = rf.lots.find((row) => row.stage === "finishing" && row.orderId === "WO-S");
  assert.deepEqual([lot.destination, lot.qc, lot.boxes], ["sr", "pass", 0], "to SR, no boxes");
  const bom = await s.call("app_bom_master");
  assert.deepEqual(bom.rodLots.filter((row) => row.lotNo === lot.id).map((row) => [row.status, row.orderId, row.qtySent]), [["pending", "PI-S", 10]], "the rods wait for SR");
  const held = await settled(finish({ qcResult: "hold" }));
  assert.equal(held.ok, true, held.error?.message);
  assert.equal((await s.call("app_rf_master")).lots.filter((row) => row.stage === "finishing" && row.qc === "hold").length, 1, "a held lot is recorded too");
});

test("the database refuses a finishing lot of a cancelled work order that was not cancelled with its order's sales 'stop' (other cancel, choice continue), whatever the page believes", async () => {
  const s = await stopScene();
  s.stopped.current = () => true; // หน้าเชื่อว่าทุก WO ใช้ได้ · ฐานข้อมูลตัดสินเอง
  const other = await settled(s.store.run("recordFinishing", { transferId: "TR-X", useQty: 10, passedQty: 10, scrapQty: 0, grade: "A", shift: "D" }));
  assert.equal(other.ok, false);
  assert.equal(other.error.code, "RF_INVALID_TRANSITION", other.error.message);
  const cont = await stopScene({ choice: "continue" });
  cont.stopped.current = () => true;
  const refused = await settled(cont.store.run("recordFinishing", { transferId: "TR-S", useQty: 10, passedQty: 10, scrapQty: 0, grade: "A", shift: "D" }));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "RF_INVALID_TRANSITION", "an order planning chose to continue is not 'stopped'");
});
