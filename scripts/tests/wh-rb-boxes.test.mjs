import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// โรงงาน ขั้น 4 ส่วนข้อมูล (20261207010000_wh_rb_boxes.sql): ปลายทางของล็อตตกแต่ง (sr / customer) · กล่องรอคลังสินค้าสำเร็จรูป (WH) รับเข้า
// คำสั่ง receiveBoxes / shipBoxes / reverseBoxReceipt / reverseBoxShip ของ modules/rubberflow-actions.js บน store แบบ remote กับ Supabase จำลองของ harness
// (scripts/pilot-harness-mock.mjs ที่เลียนกฎของฐานข้อมูล) รวมการนับ / ถอนยอดงาน RB ของ BOM และสิทธิ์ (canReceiveBoxes / canReverseBoxes ของ modules/rubberflow-store.js)
const require = createRequire(import.meta.url);
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const A = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = A;
const seed = require("../../modules/rubberflow-seed.js");
const storeApi = require("../../modules/rubberflow-store.js");

const NOW = Date.parse("2026-11-19T10:00:00+07:00");
const DAY = 86400000;
const RF_KEY = "mnp-harness-rf-master";
const BOM_KEY = "mnp-harness-bom-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const unwrap = ({ data, error }) => {
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
};
const saved = async (out) => {
  assert.equal(out.ok, true, out.error?.message);
  const outcome = await out.saving;
  assert.equal(outcome.ok, true, outcome.error?.message);
  return out;
};
const denied = async (out, code) => {
  assert.equal(out.ok, true, out.error?.message);
  const outcome = await out.saving;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, code, outcome.error.message);
};

const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs"];
const wo = (id, extra) => ({ id, customer: "ลูกค้า", customerPo: "", recipeId: "RC-T", recipeRevision: 1, productCode: "P-T", uom: "pcs", color: "", targetQty: 1000, producedQty: 100,
  startDate: NOW - DAY, dueDate: NOW + DAY, priority: "normal", note: "", status: "in_progress", createdBy: "ผู้วางแผน", createdAt: NOW - DAY, ...extra });
const finishing = (id, orderId, goodQty, perBox, extra = {}) => ({ id, stage: "finishing", orderId, uom: "pcs", machine: "", shift: "D", sources: [{ type: "transfer", id: "TR-0", lotId: "CU-0", qty: goodQty }],
  params: { perBox }, goodQty, scrapQty: 0, scrapReason: "", qc: "pass", holdReasons: [], transferredQty: 0, createdAt: NOW - DAY, operator: "พนักงาน RB",
  grade: "A", boxes: Math.ceil(goodQty / perBox), countedToOrder: true, destination: "customer", whCredit: null, ...extra });
const boxesOf = (lot, order, customer, customerPo, status = "pending_wh") => Array.from({ length: lot.boxes }, (_, i) => ({
  id: `${lot.id.replace("FN", "BOX")}-${String(i + 1).padStart(3, "0")}`, lotId: lot.id, orderId: order, recipeId: "RC-T", productCode: "P-T",
  qty: Math.min(lot.params.perBox, lot.goodQty - i * lot.params.perBox), uom: "pcs", grade: "A", status, createdAt: NOW - DAY, customer, customerPo, moves: [] }));
const transfer = (id, orderId) => ({ id, lotId: "CU-0", orderId, from: "curing", to: "finishing", uom: "pcs", qtySent: 100, qtyReceived: 100, remaining: 100, condition: "ok", note: "",
  status: "received", createdAt: NOW - DAY, createdBy: "พนักงาน RB", sentAt: NOW - DAY, sentBy: "พนักงาน RB", receivedAt: NOW - DAY, receivedBy: "พนักงาน RB" });

// ฐานข้อมูลตั้งต้น: ใบ PI-W ปล่อยผลิตแล้ว งาน RB 100 ชิ้นผูก WO-L · WO-U ขายเป็นสินค้า · ล็อต customer สองล็อตรอ WH รับ · ใบส่งมอบถึงสถานีตกแต่งของทั้งสอง WO
// legacy = เพิ่มล็อต FN-O1 รุ่นก่อน 20261207010000: กล่องในคลังสองกล่องและส่งมอบแล้วหนึ่งกล่อง ไม่มีวันที่รับเข้า
function seedData(storage, { legacy = false } = {}) {
  const bom = { version: 4, epoch: "bom-e1", ...Object.fromEntries(BOM_LISTS.map((list) => [list, []])), versions: Object.fromEntries(BOM_LISTS.map((list) => [list, {}])), tombstones: [], audit: [] };
  bom.orders = [{ id: "PI-W", status: "released", customer: "ลูกค้าเชื่อม", orderedAt: NOW, items: [], revision: 1 }];
  bom.jobs = [{ id: "JOB-W", orderId: "PI-W", dept: "RB", itemCode: "RB-ITEM", name: "เส้นยางทดสอบ", kind: "RB", uom: "pcs", qtyPlanned: 100, qtyRequired: 100, stockCounted: null,
    qtyDone: 0, qtyReject: 0, dueAt: NOW + DAY, status: "in_progress", externalRef: { system: "rubberflow", woId: "WO-L", kg: 0, linkedAt: NOW, by: "x" }, fgCodes: [], reports: [], createdAt: NOW }];
  bom.versions.orders["PI-W"] = 4;
  bom.versions.jobs["JOB-W"] = 4;
  storage.setItem(BOM_KEY, JSON.stringify(bom));
  const rf = { version: 3, epoch: "rf-e1", ...Object.fromEntries(RF_LISTS.map((list) => [list, []])), versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [] };
  rf.orders = [wo("WO-L", { customer: "ลูกค้าเชื่อม", customerPo: "PI-W", sourceJobId: "JOB-W" }), wo("WO-U", { customer: "BETA", customerPo: "PO-U" })];
  const lotL = finishing("FN-L1", "WO-L", 60, 25);
  const lotU = finishing("FN-U1", "WO-U", 40, 20);
  rf.lots = [{ id: "CU-0", stage: "curing", orderId: "WO-L", uom: "pcs", machine: "", shift: "D", sources: [], params: {}, goodQty: 400, scrapQty: 0, scrapReason: "", qc: "pass",
    holdReasons: [], transferredQty: 200, createdAt: NOW - DAY, operator: "พนักงาน RB", moldId: "MD-1" }, lotL, lotU];
  rf.fgBoxes = [...boxesOf(lotL, "WO-L", "ลูกค้าเชื่อม", "PI-W"), ...boxesOf(lotU, "WO-U", "BETA", "PO-U")];
  if (legacy) {
    const old = finishing("FN-O1", "WO-U", 30, 10, { destination: null, whCredit: undefined });
    rf.lots.push(old);
    rf.fgBoxes.push(...boxesOf(old, "WO-U", "", "", "in_stock").map((box, i) => (i === 2 ? { ...box, status: "shipped", shippedAt: NOW - 3600000, shippedBy: "ผู้วางแผน" } : box)));
  }
  rf.transfers = [transfer("TR-L", "WO-L"), transfer("TR-U", "WO-U")];
  for (const list of ["orders", "lots", "fgBoxes", "transfers"]) for (const row of rf[list]) rf.versions[list][row.id] = 3;
  storage.setItem(RF_KEY, JSON.stringify(rf));
}

async function session(options = {}) {
  const storage = memoryStorage();
  seedData(storage, options);
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const status = unwrap(await mock.client.rpc("app_sandbox_status"));
  const rows = Object.fromEntries(status.personas.map((row) => [row.id, row]));
  const who = { id: "persona-1" };
  const call = async (name, args) => unwrap(await mock.client.rpc(name, args));
  const adapter = {
    load: () => call("app_rf_master"),
    save: (changes, baseVersion, action, audit, epoch) => call("app_rf_save", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }),
    since: (version) => call("app_rf_master_since", { p_version: version }),
    audit: (limit) => call("app_rf_audit", { p_limit: limit }),
    purge: () => call("app_sandbox_purge_rf"),
  };
  const store = storeApi.createStore({ storage: memoryStorage(), seed: () => seed.buildSeed(NOW), actions: A, now: () => NOW, remote: adapter, persona: () => storeApi.personaUser(rows[who.id]) });
  await store.ensureLoaded();
  const as = async (id) => { who.id = id; await call("app_sandbox_enter", { p_persona_id: id }); await store.catchUp(); };
  const rf = () => call("app_rf_master");
  const job = async () => (await call("app_bom_master")).jobs.find((row) => row.id === "JOB-W");
  const states = async (lotId) => (await rf()).fgBoxes.filter((box) => box.lotId === lotId).map((box) => box.status).join(",");
  // ส่งตรงถึงฐานข้อมูลจำลอง (ข้ามหน้าจอ) ในนามบัญชีที่เลือกอยู่: คืนรหัสข้อผิดพลาด (null = ผ่าน)
  const raw = async (rows_, action) => {
    const master = await rf();
    const reply = await mock.client.rpc("app_rf_save", { p_changes: { fgBoxes: { upsert: rows_ } }, p_base_version: master.version, p_action: action });
    return reply.error?.code ?? null;
  };
  return { store, as, rf, job, states, raw, call, rows, mock };
}
const boxRows = async (s, lotId, from, to, kind, note) => (await s.rf()).fgBoxes.filter((box) => box.lotId === lotId && box.status === from)
  .map((box) => ({ ...box, status: to, ...(kind ? { moves: [...(box.moves ?? []), { kind, note }] } : {}) }));

test("the box permission helpers match the database: WH (any role) or admin receive and ship, the WH department manager or admin reverse", () => {
  const employee = (role, dept) => ({ id: `${role}-${dept}`, first_name: "ทดสอบ", last_name: dept, role: { code: role }, department: { code: dept } });
  const users = { whStaff: ["staff", "WH"], whHead: ["department_manager", "WH"], whAssistant: ["assistant_department_manager", "WH"], admin: ["admin", "MGT"],
    ppStaff: ["staff", "PP"], ppHead: ["department_manager", "PP"], rbStaff: ["staff", "RB"], rbHead: ["department_manager", "RB"], qa: ["staff", "QA"], gm: ["general_manager", "MGT"] };
  const rf = Object.fromEntries(Object.entries(users).map(([key, [role, dept]]) => [key, storeApi.personaUser(employee(role, dept))]));
  const receive = Object.entries(rf).filter(([, user]) => storeApi.canReceiveBoxes(user)).map(([key]) => key);
  const reverse = Object.entries(rf).filter(([, user]) => storeApi.canReverseBoxes(user)).map(([key]) => key);
  assert.deepEqual(receive, ["whStaff", "whHead", "whAssistant", "admin"], "planners, RB, QA and the GM only look");
  assert.deepEqual(reverse, ["whHead", "admin"], "only the WH department manager and the admin reverse");
  for (const key of Object.keys(rf)) {
    assert.equal(storeApi.can(rf[key], "receiveBoxes"), receive.includes(key), `receiveBoxes for ${key}`);
    assert.equal(storeApi.can(rf[key], "shipBoxes"), receive.includes(key), `shipBoxes for ${key}`);
    assert.equal(storeApi.can(rf[key], "reverseBoxes"), reverse.includes(key), `reverseBoxes for ${key}`);
  }
  assert.equal(rf.whHead.whHead, true);
  assert.equal(rf.whStaff.whHead, false);
  // ผู้ใช้รูปของ BOM (role / dept / roleCode) ใช้ตัวช่วยเดียวกันได้
  assert.equal(storeApi.canReverseBoxes({ role: "manager", dept: "WH", roleCode: "department_manager" }), true);
  assert.equal(storeApi.canReverseBoxes({ role: "staff", dept: "WH", roleCode: "staff" }), false);
  assert.equal(storeApi.canReceiveBoxes({ role: "admin", dept: "IT", roleCode: "admin" }), true);
  assert.equal(storeApi.canReceiveBoxes(null), false);
  assert.deepEqual(["receiveBoxes", "reverseBoxReceipt", "reverseBoxShip", "shipBoxes"].map(storeApi.rightForAction), ["receiveBoxes", "reverseBoxes", "reverseBoxes", "shipBoxes"]);
});

test("finishing destination: a linked lot may go to the customer (boxes waiting for WH, no rod lot), an unlinked lot cannot go to SR, a held lot has no destination", async () => {
  const s = await session();
  await s.as("persona-rb");
  const finish = (payload) => s.store.run("recordFinishing", { transferId: "TR-L", useQty: 10, passedQty: 10, scrapQty: 0, grade: "A", shift: "D", ...payload });
  assert.match(finish({ destination: "customer", perBox: "" }).error.message, /จำนวนต่อกล่อง/, "the customer path needs pieces per box");
  assert.match(s.store.run("recordFinishing", { transferId: "TR-U", useQty: 10, passedQty: 10, perBox: 5, destination: "sr" }).error.message, /ส่งเข้าคลังยางเส้นยาว \(SR\) ไม่ได้/);
  assert.match(finish({ destination: "sr", qcResult: "hold" }).error.message, /ยังไม่มีปลายทาง/);
  assert.match(finish({ destination: "gift", perBox: 5 }).error.message, /ปลายทาง/);
  const lotId = (await saved(finish({ destination: "customer", perBox: 4, qcResult: "pass" }))).result;
  const master = await s.rf();
  const lot = master.lots.find((row) => row.id === lotId);
  assert.deepEqual([lot.destination, lot.whCredit, lot.boxes], ["customer", null, 3]);
  assert.deepEqual(master.fgBoxes.filter((box) => box.lotId === lotId).map((box) => [box.qty, box.status, box.customer, box.customerPo]),
    [[4, "pending_wh", "ลูกค้าเชื่อม", "PI-W"], [4, "pending_wh", "ลูกค้าเชื่อม", "PI-W"], [2, "pending_wh", "ลูกค้าเชื่อม", "PI-W"]]);
  assert.equal((await s.call("app_bom_master")).rodLots.length, 0, "a lot for the customer is no rod lot of the SR store");
  assert.equal((await s.job()).qtyDone, 0, "and the RB job is not counted at finishing");
  assert.deepEqual(s.store.data().lots.find((row) => row.id === lotId).destination, "customer", "the page equals the database");
  const srLot = (await saved(finish({ perBox: "", qcResult: "pass" }))).result;
  assert.equal((await s.rf()).lots.find((row) => row.id === srLot).destination, "sr", "a linked lot without a choice goes to SR (as before)");
  assert.equal((await s.call("app_bom_master")).rodLots.filter((row) => row.lotNo === srLot).length, 1);
  const held = (await saved(s.store.run("recordFinishing", { transferId: "TR-U", useQty: 10, passedQty: 10, perBox: 10, qcResult: "hold" }))).result;
  assert.deepEqual([(await s.rf()).lots.find((row) => row.id === held).destination, await s.states(held)], [null, "hold"]);
  await s.as("persona-qa");
  await saved(s.store.run("addQcRecord", { lotId: held, values: { hardness: 65 }, result: "pass" }));
  assert.deepEqual([(await s.rf()).lots.find((row) => row.id === held).destination, await s.states(held)], ["customer", "pending_wh"], "QA releases it to the customer through WH");
});

test("receiveBoxes: WH receives a whole lot once, credits the RB job of a linked lot, replays write nothing; planners, RB and QA are refused", async () => {
  const s = await session();
  for (const persona of ["persona-pp", "persona-rb", "persona-qa", "persona-sr"]) {
    await s.as(persona);
    assert.match(s.store.run("receiveBoxes", { lotId: "FN-L1" }).error.message, /ไม่มีสิทธิ์/, persona);
    assert.equal(await s.raw(await boxRows(s, "FN-L1", "pending_wh", "in_stock"), "receiveBoxes"), "RF_FORBIDDEN", `${persona} straight to the database`);
  }
  await s.as("persona-wh");
  assert.equal(await s.raw((await boxRows(s, "FN-L1", "pending_wh", "in_stock")).slice(0, 2), "receiveBoxes"), "RF_INVALID_BOX", "two of three boxes is refused");
  assert.equal(await s.raw([{ ...(await boxRows(s, "FN-L1", "pending_wh", "shipped"))[0] }], "shipBoxes"), "RF_INVALID_TRANSITION", "a waiting box cannot be shipped");
  const master = await s.rf();
  const mixed = await s.call("app_rf_save", { p_changes: { fgBoxes: { upsert: await boxRows(s, "FN-L1", "pending_wh", "in_stock") }, lots: { upsert: [master.lots[1]] } }, p_base_version: master.version, p_action: "receiveBoxes" }).catch((error) => error.code);
  assert.equal(mixed, "RF_INVALID_BOX", "a box action carries the box list only");
  assert.match(s.store.run("receiveBoxes", { lotId: "CU-0" }).error.message, /ไม่มีกล่องที่รอ/, "a lot without waiting boxes has nothing to receive");
  const bomBefore = (await s.call("app_bom_master")).version;
  await saved(s.store.run("receiveBoxes", { lotId: "FN-L1" }));
  const after = await s.rf();
  assert.deepEqual(after.fgBoxes.filter((box) => box.lotId === "FN-L1").map((box) => [box.status, box.receivedBy, box.moves.map((move) => move.kind).join()]),
    [["in_stock", "สุดา คลังสินค้า", "receive"], ["in_stock", "สุดา คลังสินค้า", "receive"], ["in_stock", "สุดา คลังสินค้า", "receive"]]);
  assert.deepEqual(after.lots.find((row) => row.id === "FN-L1").whCredit, { jobNo: "JOB-W", qty: 60 });
  const job = await s.job();
  assert.deepEqual([job.qtyDone, job.status, job.reports.at(-1).good, job.reports.at(-1).note], [60, "in_progress", 60, "คลังสินค้าสำเร็จรูป (WH) รับเข้า ล็อต FN-L1 ส่งมอบให้ลูกค้า"]);
  const bom = await s.call("app_bom_master");
  assert.equal(bom.version, bomBefore + 1, "one BOM counter step");
  assert.equal(bom.orders.find((row) => row.id === "PI-W").status, "in_progress", "the released order starts");
  assert.deepEqual(s.store.data().fgBoxes.filter((box) => box.lotId === "FN-L1").map((box) => box.status), ["in_stock", "in_stock", "in_stock"], "the page equals the database");
  const version = after.version;
  assert.equal(await s.raw((await s.rf()).fgBoxes.filter((box) => box.lotId === "FN-L1"), "receiveBoxes"), null);
  assert.equal((await s.rf()).version, version, "receiving the same lot again writes nothing");
  assert.equal((await s.job()).qtyDone, 60, "and credits nothing twice");
  await s.as("persona-whh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-U1" }));
  assert.equal(await s.states("FN-U1"), "in_stock,in_stock", "the WH head receives a lot for sale");
  assert.equal((await s.rf()).lots.find((row) => row.id === "FN-U1").whCredit, null, "which credits no BOM job");
  assert.equal((await s.call("app_bom_master")).version, bomBefore + 1);
});

test("shipping and reversals: WH ships, only the WH head or admin reverses with a reason, a shipped box blocks the receipt reversal, the reversal takes the credit back", async () => {
  const s = await session();
  await s.as("persona-wh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-L1" }));
  await s.as("persona-pp");
  assert.match(s.store.run("shipBoxes", { ids: ["BOX-L1-001"] }).error.message, /ไม่มีสิทธิ์/, "a planner no longer ships");
  assert.equal(await s.raw((await boxRows(s, "FN-L1", "in_stock", "shipped")).slice(0, 1), "shipBoxes"), "RF_FORBIDDEN");
  await s.as("persona-wh");
  await saved(s.store.run("shipBoxes", { ids: ["BOX-L1-001"] }));
  assert.deepEqual((await s.rf()).fgBoxes.find((box) => box.id === "BOX-L1-001").moves.map((move) => move.kind), ["receive", "ship"]);
  assert.match(s.store.run("reverseBoxShip", { ids: ["BOX-L1-001"], note: "ส่งผิดลูกค้า" }).error.message, /ไม่มีสิทธิ์/, "WH staff cannot reverse");
  assert.equal(await s.raw(await boxRows(s, "FN-L1", "shipped", "in_stock", "unship", "ส่งผิดลูกค้า"), "reverseBoxShip"), "RF_FORBIDDEN");
  await s.as("persona-whh");
  assert.match(s.store.run("reverseBoxReceipt", { lotId: "FN-L1", note: "รับผิดล็อต" }).error.message, /ส่งมอบแล้ว/, "a lot with a shipped box cannot be reversed (page)");
  assert.equal(await s.raw(await boxRows(s, "FN-L1", "in_stock", "pending_wh", "unreceive", "รับผิดล็อต"), "reverseBoxReceipt"), "RF_INVALID_TRANSITION", "nor in the database");
  assert.match(s.store.run("reverseBoxShip", { ids: ["BOX-L1-001"], note: "ab" }).error.message, /เหตุผล/, "a reason of three characters");
  assert.equal(await s.raw(await boxRows(s, "FN-L1", "shipped", "in_stock", "unship", "ab"), "reverseBoxShip"), "RF_INVALID_BOX");
  assert.equal(await s.raw(await boxRows(s, "FN-L1", "shipped", "in_stock", "unreceive", "ส่งผิดลูกค้า"), "reverseBoxShip"), "RF_INVALID_BOX", "the history entry must match the action");
  await saved(s.store.run("reverseBoxShip", { ids: ["BOX-L1-001"], note: "  ส่งผิดลูกค้า  " }));
  const box = (await s.rf()).fgBoxes.find((row) => row.id === "BOX-L1-001");
  assert.deepEqual([box.status, box.shippedAt, box.moves.at(-1).kind, box.moves.at(-1).note, box.moves.at(-1).by], ["in_stock", undefined, "unship", "ส่งผิดลูกค้า", "ชัย หัวหน้าคลัง"]);
  assert.match(s.store.run("reverseBoxReceipt", { lotId: "FN-L1", note: "ab" }).error.message, /เหตุผล/);
  assert.equal(await s.raw((await boxRows(s, "FN-L1", "in_stock", "pending_wh", "unreceive", "รับผิดล็อต")).slice(0, 2), "reverseBoxReceipt"), "RF_INVALID_BOX", "the whole lot at once");
  await saved(s.store.run("reverseBoxReceipt", { lotId: "FN-L1", note: "รับผิดล็อต" }));
  assert.equal(await s.states("FN-L1"), "pending_wh,pending_wh,pending_wh");
  assert.equal((await s.rf()).fgBoxes.find((row) => row.id === "BOX-L1-002").receivedAt, undefined);
  const job = await s.job();
  assert.deepEqual([job.qtyDone, job.status, job.reports.at(-1).good, job.reports.at(-1).note], [0, "in_progress", 0, "ย้อนรับเข้าคลังสินค้าสำเร็จรูป (WH) ล็อต FN-L1 ถอน 60 · รับผิดล็อต"]);
  assert.equal((await s.rf()).lots.find((row) => row.id === "FN-L1").whCredit, null);
  // รับใหม่ได้ นับยอดอีกครั้ง · admin (บัญชีทดสอบแรก) ย้อนได้
  await s.as("persona-wh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-L1" }));
  assert.equal((await s.job()).qtyDone, 60, "received again, the job is credited again");
  await s.as("persona-1");
  assert.equal(storeApi.canReverseBoxes(storeApi.personaUser(s.rows["persona-1"])), true, "the admin persona reverses");
  await saved(s.store.run("shipBoxes", { ids: ["BOX-L1-003"] }));
  await saved(s.store.run("reverseBoxShip", { ids: ["BOX-L1-003"], note: "ลูกค้าคืนของ" }));
  await saved(s.store.run("reverseBoxReceipt", { lotId: "FN-L1", note: "นับไม่ครบ" }));
  assert.deepEqual([await s.states("FN-L1"), (await s.job()).qtyDone], ["pending_wh,pending_wh,pending_wh", 0]);
});

test("boxes from before this change that are in stock or shipped get their creation time as the receipt time, and the counter moves once", async () => {
  const s = await session({ legacy: true });
  const master = await s.rf();
  const old = master.fgBoxes.filter((box) => box.lotId === "FN-O1");
  assert.deepEqual(old.map((box) => [box.status, box.receivedAt, box.receivedBy]), [["in_stock", NOW - DAY, undefined], ["in_stock", NOW - DAY, undefined], ["shipped", NOW - DAY, undefined]]);
  assert.ok(master.fgBoxes.filter((box) => box.status === "pending_wh").every((box) => box.receivedAt === undefined), "a waiting box stays without a receipt");
  assert.equal(master.version, 4, "one counter step over the seeded version 3");
  assert.deepEqual(s.store.data().fgBoxes.filter((box) => box.lotId === "FN-O1").map((box) => box.receivedAt), [NOW - DAY, NOW - DAY, NOW - DAY], "the page sees the receipt time");
  // QA กักแล้วปล่อย: กล่องเก่ากลับเข้าคลัง (ไม่ไปรอ WH) กล่องที่ส่งมอบแล้วไม่ถูกแตะ
  await s.as("persona-qa");
  await saved(s.store.run("addQcRecord", { lotId: "FN-O1", values: { hardness: 65 }, result: "hold" }));
  assert.equal(await s.states("FN-O1"), "hold,hold,shipped");
  await saved(s.store.run("addQcRecord", { lotId: "FN-O1", values: { hardness: 65 }, result: "pass" }));
  assert.equal(await s.states("FN-O1"), "in_stock,in_stock,shipped", "QA releases the old boxes back into stock");
});

test("a QA pass moves only held boxes: a box in stock is never sent back to wait for WH, a waiting box keeps waiting", async () => {
  const s = await session();
  await s.as("persona-wh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-U1" }));
  // กล่องในคลังที่ไม่มีวันที่รับ (เหมือนกล่องเก่าที่ไม่ได้เติม): ผ่านซ้ำต้องไม่ย้ายไปรอ WH
  s.mock.rf.edit((m) => {
    m.version += 1;
    const box = m.fgBoxes.find((row) => row.id === "BOX-U1-001");
    delete box.receivedAt;
    delete box.receivedBy;
    m.versions.fgBoxes[box.id] = m.version;
  });
  await s.as("persona-qa");
  await saved(s.store.run("addQcRecord", { lotId: "FN-U1", values: { hardness: 65 }, result: "pass" }));
  assert.equal(await s.states("FN-U1"), "in_stock,in_stock", "the database keeps both boxes in stock");
  assert.deepEqual(s.store.data().fgBoxes.filter((box) => box.lotId === "FN-U1").map((box) => box.status), ["in_stock", "in_stock"], "and so does the page");
  await saved(s.store.run("addQcRecord", { lotId: "FN-L1", values: { hardness: 65 }, result: "pass" }));
  assert.equal(await s.states("FN-L1"), "pending_wh,pending_wh,pending_wh", "the waiting boxes keep waiting");
});

test("a QA fail of a lot WH received takes its credit back from the RB job in the same save, written as the QA decision", async () => {
  const s = await session();
  await s.as("persona-wh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-L1" }));
  assert.equal((await s.job()).qtyDone, 60);
  await s.as("persona-qa");
  await saved(s.store.run("addQcRecord", { lotId: "FN-L1", values: { hardness: 80 }, result: "hold" }));
  assert.deepEqual([await s.states("FN-L1"), (await s.job()).qtyDone], ["hold,hold,hold", 60], "a hold keeps the credit");
  const bomBefore = (await s.call("app_bom_master")).version;
  const id = (await saved(s.store.run("addQcRecord", { lotId: "FN-L1", values: { hardness: 80 }, result: "fail" }))).result;
  const lot = (await s.rf()).lots.find((row) => row.id === "FN-L1");
  assert.deepEqual([lot.qc, lot.whCredit, await s.states("FN-L1")], ["fail", null, "hold,hold,hold"]);
  const job = await s.job();
  assert.deepEqual([job.qtyDone, job.status, job.reports.at(-1).good, job.reports.at(-1).note, job.reports.at(-1).by],
    [0, "in_progress", 0, `QA ตัดสินไม่ผ่าน ล็อต FN-L1 ถอนยอด 60 (${id})`, "ธนา ตรวจสอบ"]);
  assert.ok(!job.reports.some((report) => report.note.includes("ย้อนรับเข้า")), "the fail is not written as a receipt reversal");
  assert.equal((await s.call("app_bom_master")).version, bomBefore + 1, "one BOM counter step");
  assert.equal(s.store.data().lots.find((row) => row.id === "FN-L1").whCredit, null, "the page equals the database");
  await saved(s.store.run("addQcRecord", { lotId: "FN-U1", values: { hardness: 80 }, result: "hold" }));
  await saved(s.store.run("addQcRecord", { lotId: "FN-U1", values: { hardness: 80 }, result: "fail" }));
  assert.equal((await s.call("app_bom_master")).version, bomBefore + 1, "a fail without a credit does not touch the BOM");
});

test("QA is never blocked from a fail: a lot credited to a closed order fails without taking the credit back, while the WH receipt reversal stays refused", async () => {
  const s = await session();
  await s.as("persona-wh");
  await saved(s.store.run("receiveBoxes", { lotId: "FN-L1" }));
  s.mock.bom.edit((b) => { b.orders.find((row) => row.id === "PI-W").status = "completed"; });
  await s.as("persona-whh");
  await denied(s.store.run("reverseBoxReceipt", { lotId: "FN-L1", note: "รับผิดล็อต" }), "RF_INVALID_TRANSITION");
  await s.store.catchUp();
  await s.as("persona-qa");
  await saved(s.store.run("addQcRecord", { lotId: "FN-L1", values: { hardness: 80 }, result: "hold" }));
  const bomBefore = await s.call("app_bom_master");
  await saved(s.store.run("addQcRecord", { lotId: "FN-L1", values: { hardness: 80 }, result: "fail" }));
  const lot = (await s.rf()).lots.find((row) => row.id === "FN-L1");
  assert.deepEqual([lot.qc, lot.whCredit, await s.states("FN-L1")], ["fail", { jobNo: "JOB-W", qty: 60 }, "hold,hold,hold"], "the fail is recorded and the credit is kept");
  const job = await s.job();
  assert.deepEqual([job.qtyDone, job.reports.length], [60, bomBefore.jobs.find((row) => row.id === "JOB-W").reports.length], "the job of the closed order is not touched");
  assert.equal((await s.call("app_bom_master")).version, bomBefore.version, "nor is the BOM counter");
  assert.deepEqual(s.store.data().lots.find((row) => row.id === "FN-L1").whCredit, { jobNo: "JOB-W", qty: 60 }, "the page equals the database");
});

test("the demo seed gives the WH screens boxes in every state (waiting linked and for sale, in stock, shipped)", () => {
  const rfOnly = seed.buildSeed(NOW);
  const tally = (d) => d.fgBoxes.reduce((acc, box) => ({ ...acc, [box.status]: (acc[box.status] ?? 0) + 1 }), {});
  const counts = tally(rfOnly);
  assert.ok(counts.pending_wh > 0 && counts.in_stock > 0 && counts.shipped > 0, JSON.stringify(counts));
  assert.ok(rfOnly.fgBoxes.every((box) => typeof box.customer === "string" && Array.isArray(box.moves)), "every box carries its customer and history");
  assert.ok(rfOnly.lots.filter((lot) => lot.stage === "finishing" && lot.boxes > 0).every((lot) => lot.destination === "customer"), "lots with boxes go to the customer");
  assert.ok(rfOnly.fgBoxes.filter((box) => box.status === "shipped").every((box) => box.receivedAt && box.shippedAt && box.moves.map((move) => move.kind).join() === "receive,ship"));
});
