import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// ใบสั่งผลิตจากฝ่ายขาย (SA) ส่งให้ฝ่ายวางแผน (PP) · คำขอยกเลิก / แก้ใบ · ผู้เขียนใบสั่งผลิตและลูกค้า (โรงงาน ขั้น 8 · 20261225010000_bom_sales_orders.sql)
// คำสั่ง (modules/bom-actions.js) · store (modules/bom-store.js) · Supabase จำลองของ harness ต้องตอบรหัสเดียวกับฐานข้อมูล
// (pgTAP คู่กัน: supabase/tests/database/bom_sales_orders.test.sql)
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const A = globalThis.MNP_BOM_ACTIONS;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-11-25T10:00:00+07:00");
const DAY = 86400000;
const FG = "DEMO-HL-24(B)-A";
const fresh = () => seed.buildSeed(NOW);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const USERS = {
  sa: { id: "SA-1", role: "sa", dept: "SA", roleCode: "staff", name: "สุนิสา ขายดี" },
  saHead: { id: "SA-H", role: "sa", dept: "SA", roleCode: "department_manager", name: "สมพร หัวหน้าฝ่ายขาย" },
  planner: seed.USERS.find((row) => row.role === "planner"),
  manager: seed.USERS.find((row) => row.role === "manager"),
  pkHead: { id: "PK-H", role: "manager", dept: "PK", roleCode: "department_manager", name: "ปกรณ์ หัวหน้าบรรจุ" },
  stHead: { id: "ST-H", role: "manager", dept: "ST", roleCode: "department_manager", name: "ประสิทธิ์ หัวหน้าคลัง" },
  gr: seed.USERS.find((row) => row.role === "gr"),
};
const ctx = (who, extra = {}) => ({ now: NOW, user: USERS[who], ...extra });
const orderOf = (d, id) => d.orders.find((row) => row.id === id);
const saOrder = (d, pi, extra = {}) => A.createOrder(d, { pi, customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], ...extra }, ctx("sa"));

// ---------- สิทธิ์ ----------
test("who writes orders and customers: sales and the order planners; a production head stays a BOM planner but no longer writes orders", () => {
  const H = A.helpers;
  const table = Object.fromEntries(Object.entries(USERS).map(([key, user]) => [key, [H.canSell(user), H.canPlanOrders(user), H.canOrder(user), H.canPlan(user)]]));
  assert.deepEqual(table, {
    sa: [true, false, true, false], saHead: [true, false, true, false], planner: [false, true, true, true], manager: [false, true, true, true],
    pkHead: [false, false, false, true], stHead: [false, false, false, true], gr: [false, false, false, false],
  });
  assert.ok(H.canCount(USERS.stHead) && !H.canCount(USERS.pkHead) && !H.canCount(USERS.sa), "the ST head counts as ST; the PK head and sales do not count");
  // พนักงานจากฐานข้อมูล (store): แผนก SA = ฝ่ายขาย · ผู้จัดการแผนก PK ไม่ใช่ผู้เขียนใบ · ผู้ช่วยผู้จัดการโรงงาน / PP / admin เขียนใบได้
  const emp = (dept, role) => ({ department: { code: dept }, role: { code: role } });
  assert.deepEqual([storeApi.roleOfEmployee(emp("SA", "staff")), storeApi.roleOfEmployee(emp("SA", "department_manager"))], ["sa", "sa"]);
  assert.deepEqual([emp("SA", "staff"), emp("PP", "staff"), emp("FT", "assistant_factory_manager"), emp("MGT", "admin"), emp("PK", "department_manager"), emp("GR", "staff")]
    .map((row) => [storeApi.canSell(row), storeApi.canPlanOrders(row), storeApi.canOrder(row)]),
  [[true, false, true], [false, true, true], [false, true, true], [false, true, true], [false, false, false], [false, false, false]]);
  assert.equal(storeApi.personaUser({ ...emp("SA", "staff"), id: "x", first_name: "ก", last_name: "ข" }).dept, "SA");
  assert.ok(storeApi.ROLES.sa.modules.includes("customers") && storeApi.ROLES.sa.modules.includes("orders"));
});

// ---------- คำสั่งของฝ่ายขาย ----------
test("sales opens an order with products in one call, sends it once, and cannot set planning fields or touch a planning order", () => {
  const d = fresh();
  saOrder(d, "SA-T1", { send: true });
  const order = orderOf(d, "SA-T1");
  assert.deepEqual([order.source, order.status, order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), order.due, order.dueDefaults, order.sentAt, order.sentBy],
    ["SA", "draft", [[FG, 3, "A"]], {}, [], NOW, USERS.sa.name], "a sales draft, colour set from the code, no dues, sent by the seller");
  assert.deepEqual(d.audit.slice(0, 3).map((row) => row.action), ["ฝ่ายขายส่งใบให้ฝ่ายวางแผน", "เพิ่มสินค้าในใบสั่งผลิต", "เปิดใบสั่งผลิต"]);
  rejects(() => A.sendOrderToPlanning(d, { orderId: "SA-T1" }, ctx("sa")), /ส่งให้ฝ่ายวางแผนแล้ว/);
  rejects(() => saOrder(d, "SA-T2", { autoDue: true }), /กำหนดเสร็จรายแผนก/);
  rejects(() => saOrder(d, "SA-T2", { due: { PK: NOW + DAY } }), /กำหนดเสร็จรายแผนก/);
  rejects(() => A.createOrder(d, { pi: "SA-T2", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY, send: true }, ctx("planner")), /เฉพาะใบที่ฝ่ายขายเปิด/);
  saOrder(d, "SA-T2", { lines: [] });
  rejects(() => A.sendOrderToPlanning(d, { orderId: "SA-T2" }, ctx("sa")), /ยังไม่มีสินค้า/);
  rejects(() => A.addOrderItem(d, { orderId: "SA-T2", base: "DEMO-HL-24", pkg: "B", colorSet: "Z", qty: 1 }, ctx("sa")), /รหัสในทะเบียนแล้ว/);
  A.addOrderItem(d, { orderId: "SA-T2", fgCode: FG, qty: 2, colorSet: "Z" }, ctx("sa"));
  assert.equal(orderOf(d, "SA-T2").items[0].colorSet, "A", "sales cannot pick a colour set other than the code's");
  A.updateOrderItem(d, { orderId: "SA-T2", fgCode: FG, qty: 4 }, ctx("sa"));
  A.updateOrderHeader(d, { orderId: "SA-T2", customer: "ลูกค้าใหม่ฝ่ายขาย", whDue: NOW + 40 * DAY, note: "ด่วน" }, ctx("sa"));
  assert.deepEqual([orderOf(d, "SA-T2").customer, orderOf(d, "SA-T2").whDue, orderOf(d, "SA-T2").note], ["ลูกค้าใหม่ฝ่ายขาย", NOW + 40 * DAY, "ด่วน"]);
  assert.ok(d.customers.some((row) => row.name === "ลูกค้าใหม่ฝ่ายขาย"), "a new customer joins the register");
  rejects(() => A.updateOrderHeader(d, { orderId: "SA-T2", autoDue: true }, ctx("sa")), /ฝ่ายวางแผนเท่านั้น/);
  rejects(() => A.updateOrderHeader(d, { orderId: "SA-T2", note: "ด่วน" }, ctx("sa")), /หัวใบเท่าเดิม/);
  rejects(() => A.updateOrderHeader(d, { orderId: "DEMO-26002", note: "ฝ่ายขายแก้" }, ctx("sa")), /ใบของฝ่ายวางแผน/);
  rejects(() => A.addOrderItem(d, { orderId: "DEMO-26002", fgCode: FG, qty: 1 }, ctx("sa")), /ใบของฝ่ายวางแผน/);
  rejects(() => A.cancelOrder(d, { orderId: "DEMO-26002", reason: "ลูกค้ายกเลิก" }, ctx("sa")), /ใบของฝ่ายวางแผน/);
  rejects(() => A.explodeOrder(d, { orderId: "SA-T2" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.releaseOrder(d, { orderId: "SA-T2" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  A.updateOrderHeader(d, { orderId: "SA-T2", autoDue: true }, ctx("planner"));
  assert.ok(Object.keys(orderOf(d, "SA-T2").due).length > 0, "planning sets the department dues of a sales order");
  rejects(() => A.releaseOrder(d, { orderId: "SA-T2" }, ctx("planner")), /ยังไม่ส่งให้ฝ่ายวางแผน/);
  A.cancelOrder(d, { orderId: "SA-T2", reason: "เปิดซ้ำ" }, ctx("saHead"));
  assert.equal(orderOf(d, "SA-T2").status, "cancelled", "the sales head cancels a sales draft");
});

test("a production head no longer opens or edits orders or customers; the order planners and sales do", () => {
  const d = fresh();
  rejects(() => A.createOrder(d, { customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการ และฝ่ายขาย/);
  rejects(() => A.saveCustomer(d, { name: "ลูกค้า PK", country: "Thailand" }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการ และฝ่ายขาย/);
  rejects(() => A.cancelOrder(d, { orderId: "DEMO-26002", reason: "ลูกค้ายกเลิก" }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.saveCustomer(d, { name: "ลูกค้า GR", country: "Thailand" }, ctx("gr")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  assert.equal(A.saveCustomer(d, { name: "ลูกค้าฝ่ายขาย", country: "Thailand" }, ctx("sa")), "ลูกค้าฝ่ายขาย");
  assert.ok(A.createOrder(d, { pi: "MGR-1", customer: "ลูกค้าผู้จัดการ", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY }, ctx("manager")));
  assert.equal(orderOf(d, "MGR-1").source, "PP");
});

test("after release: sales asks instead of cancelling; one open request per kind; planning confirms with the sales reason, declines with a note or marks a change done", () => {
  const d = fresh();
  saOrder(d, "SA-T3", { send: true });
  A.releaseOrder(d, { orderId: "SA-T3" }, ctx("planner"));
  assert.equal(orderOf(d, "SA-T3").status, "released");
  rejects(() => A.cancelOrder(d, { orderId: "SA-T3", reason: "ลูกค้ายกเลิก" }, ctx("sa")), /ส่งคำขอยกเลิก/);
  rejects(() => A.requestOrderCancel(d, { orderId: "SA-T3", reason: "ab" }, ctx("sa")), /อย่างน้อย 3/);
  rejects(() => A.requestOrderCancel(d, { orderId: "SA-T3", reason: "ลูกค้ายกเลิก" }, ctx("planner")), /ฝ่ายขายเท่านั้น/);
  rejects(() => A.requestOrderCancel(d, { orderId: "DEMO-26001", reason: "ลูกค้ายกเลิก" }, ctx("sa")), /ใบของฝ่ายวางแผน/);
  const cancel = A.requestOrderCancel(d, { orderId: "SA-T3", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" }, ctx("sa"));
  assert.deepEqual(cancel.request, [{ id: cancel.id, orderId: "SA-T3", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" }]);
  assert.equal(cancel.section, "orderRequests");
  assert.deepEqual(A.helpers.openOrderRequest(d, "SA-T3", "cancel"), { id: cancel.id, orderId: "SA-T3", kind: "cancel", reason: "ลูกค้ายกเลิกคำสั่งซื้อ", status: "open", requestedBy: USERS.sa.name, requestedById: "SA-1", requestedAt: NOW, decidedBy: null, decidedAt: null, decisionNote: "" });
  rejects(() => A.requestOrderCancel(d, { orderId: "SA-T3", reason: "ขออีกครั้ง" }, ctx("saHead")), /ยังไม่ตัดสินอยู่แล้ว/);
  const change = A.requestOrderChange(d, { orderId: "SA-T3", reason: "เพิ่มเป็น 5 ชุด" }, ctx("saHead"));
  rejects(() => A.decideOrderRequest(d, { requestId: cancel.id, decision: "confirm" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.decideOrderRequest(d, { requestId: cancel.id, decision: "confirm" }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.decideOrderRequest(d, { requestId: change.id, decision: "decline" }, ctx("planner")), /อย่างน้อย 3/);
  rejects(() => A.decideOrderRequest(d, { requestId: change.id, decision: "confirm" }, ctx("planner")), /เฉพาะคำขอยกเลิก/);
  rejects(() => A.decideOrderRequest(d, { requestId: cancel.id, decision: "done" }, ctx("planner")), /ยืนยันยกเลิกหรือไม่ยกเลิก/);
  const done = A.decideOrderRequest(d, { requestId: change.id, decision: "done", note: "เปิดใบเพิ่มแล้ว" }, ctx("planner"));
  assert.deepEqual(done.request, [{ id: change.id, decision: "done", note: "เปิดใบเพิ่มแล้ว" }]);
  const confirm = A.decideOrderRequest(d, { requestId: cancel.id, decision: "confirm" }, ctx("planner"));
  assert.equal(confirm.status, "done");
  assert.deepEqual([orderOf(d, "SA-T3").status, orderOf(d, "SA-T3").cancelReason], ["cancelled", "ลูกค้ายกเลิกคำสั่งซื้อ"], "the order is cancelled with the reason sales gave");
  assert.deepEqual(A.helpers.orderRequestsOf(d, "SA-T3").map((row) => [row.kind, row.status, row.decidedBy]), [["cancel", "done", USERS.planner.name], ["change", "done", USERS.planner.name]]);
  assert.deepEqual(d.audit.slice(0, 3).map((row) => row.action), ["ฝ่ายวางแผนยืนยันยกเลิกตามคำขอ", "ยกเลิกใบสั่งผลิต", "ฝ่ายวางแผนแก้ใบตามคำขอแล้ว"]);
  rejects(() => A.decideOrderRequest(d, { requestId: cancel.id, decision: "decline", note: "ไม่ได้" }, ctx("planner")), /ตัดสินไปแล้ว/);
  rejects(() => A.requestOrderChange(d, { orderId: "SA-T3", reason: "ขอแก้หลังยกเลิก" }, ctx("sa")), /ปิดหรือยกเลิกแล้ว/);
});

test("sales edits a released sales order while no job started (back to draft, still sent); a draft is never asked about", () => {
  const d = fresh();
  saOrder(d, "SA-T4", { send: true });
  rejects(() => A.requestOrderChange(d, { orderId: "SA-T4", reason: "เพิ่มจำนวน" }, ctx("sa")), /แก้ได้เองโดยไม่ต้องขอ/);
  A.releaseOrder(d, { orderId: "SA-T4" }, ctx("planner"));
  A.updateOrderItem(d, { orderId: "SA-T4", fgCode: FG, qty: 5 }, ctx("sa"));
  const order = orderOf(d, "SA-T4");
  assert.deepEqual([order.status, order.revision, order.items[0].qty, order.sentAt], ["draft", 1, 5, NOW]);
  assert.equal(d.jobs.filter((job) => job.orderId === "SA-T4").length, 0, "its jobs are gone until planning releases it again");
});

test("database mode: request actions return one request row; the store sends it in the request section (with the cancelled order for a confirm); new codes keep Thai messages", () => {
  assert.deepEqual(storeApi.REQUEST_ACTIONS, { requestOrderCancel: "orderRequests", requestOrderChange: "orderRequests", decideOrderRequest: "orderRequests" });
  assert.deepEqual(storeApi.WORK_LISTS.slice(-2), ["orderRequests", "grWorkers"], "the request list sits before the worker list, like the database delta");
  for (const code of ["BOM_INVALID_REQUEST", "BOM_REQUEST_OPEN"]) assert.doesNotMatch(storeApi.mapRemoteError({ code }).message, /BOM_/);
});

// ---------- Supabase จำลองของ harness ----------
const BOM_KEY = "mnp-harness-bom-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves", "grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers"];
// prepare(data) แก้ข้อมูลตั้งต้นของ BOM ก่อนเก็บ · rf = ข้อมูลตั้งต้นของ RubberFlow (ไม่ให้ = ว่าง)
function mockScene({ prepare = null, rf = null } = {}) {
  const data = fresh();
  prepare?.(data);
  const master = { version: 1, epoch: "so-e1", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(LISTS.map((list) => [list, data[list] ?? []])) };
  const storage = memoryStorage();
  storage.setItem(BOM_KEY, JSON.stringify(master));
  if (rf) storage.setItem("mnp-harness-rf-master", JSON.stringify(rf));
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
  // store ของหน้า (ผู้ทำรายการ = persona) · sent = สิ่งที่ส่งให้ app_bom_save_master · rfOrders = WO ของ RubberFlow ที่หน้าโหลดไว้ (ไม่ให้ = ยังไม่โหลด)
  const storeFor = async (personaId, { rfOrders } = {}) => {
    const enter = () => call("app_sandbox_enter", { p_persona_id: personaId });
    await enter();
    const persona = (await call("app_sandbox_status")).personas.find((row) => row.id === personaId);
    const sent = [];
    const remote = {
      load: () => call("app_bom_master"),
      save: (changes, baseVersion, action, audit, epoch) => { sent.push({ changes, action }); return call("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }); },
      since: (version) => call("app_bom_master_since", { p_version: version }),
    };
    const store = storeApi.createStore({ actions: A, now: () => NOW, remote, persona: () => storeApi.personaUser({ ...persona, isSandbox: true }), rfOrders });
    await store.ensureLoaded();
    return { store, sent, enter };
  };
  return { mock, call, save, view, orderRow, storeFor, data };
}
const uid = (n) => `7e000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const codeOf = async (promise) => (await promise).code ?? null;
const newOrder = (id, extra = {}) => ({ id, customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderType: "SA", orderedAt: NOW, whDue: NOW + 30 * DAY, due: {}, dueDefaults: [], revision: 0, status: "draft",
  items: [{ fgCode: FG, qty: 3, colorSet: "A", note: "" }], explosion: null, explodedAt: null, stockCounts: {}, note: "", ...extra });

test("mock: sales personas exist; the database rules for sales, production heads and other staff answer with the same codes", async () => {
  const s = mockScene();
  const status = await s.call("app_sandbox_status");
  assert.deepEqual(status.personas.filter((row) => ["persona-sa", "persona-sah"].includes(row.id)).map((row) => [row.employee_no, row.department.code, row.role.code, storeApi.roleOfEmployee(row)]),
    [["T-SA", "SA", "staff", "sa"], ["T-SAH", "SA", "department_manager", "sa"]]);
  const orders = (persona, action, rows) => s.save(persona, action, { orders: { upsert: rows } });
  assert.equal(await codeOf(orders("persona-sa", "createOrder", [newOrder("SA-M1", { due: { PK: NOW + DAY } })])), "BOM_FORBIDDEN", "sales cannot set a department due");
  assert.equal(await codeOf(orders("persona-sa", "createOrder", [newOrder("SA-M1", { items: [{ fgCode: FG, qty: 3, colorSet: "Z", note: "" }] })])), "BOM_FORBIDDEN", "nor a colour set other than the code's");
  assert.equal(await codeOf(orders("persona-sa", "createOrder", [newOrder("SA-M1", { items: [], sentAt: 1 })])), "BOM_INVALID_TRANSITION", "nor send without products");
  assert.ok((await orders("persona-sa", "createOrder", [newOrder("SA-M1")])).data, "sales opens a draft");
  assert.deepEqual([(await s.orderRow("SA-M1")).source, (await s.orderRow("SA-M1")).sentAt], ["SA", undefined]);
  assert.equal(await codeOf(orders("persona-pp", "releaseOrder", [{ ...(await s.orderRow("SA-M1")), status: "released", explosion: [{ itemCode: FG, kind: "FG" }] }])), "BOM_INVALID_TRANSITION",
    "planning cannot release an unsent sales order");
  assert.ok((await orders("persona-sa", "sendOrderToPlanning", [{ ...(await s.orderRow("SA-M1")), sentAt: 1 }])).data, "sales sends it");
  assert.deepEqual([(await s.orderRow("SA-M1")).sentAt, (await s.orderRow("SA-M1")).sentBy], [NOW, "สุนิสา ขายดี"], "the server stamps the send");
  assert.equal(await codeOf(orders("persona-sa", "updateOrderHeader", [{ ...(await s.orderRow("SA-M1")), orderedAt: NOW - DAY }])), "BOM_FORBIDDEN", "sales cannot change the order date");
  assert.equal(await codeOf(orders("persona-sa", "updateOrderItem", [{ ...(await s.orderRow("SA-M1")), explosion: [{ itemCode: FG, kind: "FG" }] }])), "BOM_FORBIDDEN", "nor write an explosion");
  assert.equal(await codeOf(orders("persona-sa", "updateOrderHeader", [{ ...(await s.orderRow("DEMO-26002")), note: "ฝ่ายขายแก้" }])), "BOM_FORBIDDEN", "nor touch a planning order");
  assert.equal(await codeOf(orders("persona-sa", "releaseOrder", [{ ...(await s.orderRow("SA-M1")), status: "released", explosion: [{ itemCode: FG, kind: "FG" }] }])), "BOM_FORBIDDEN", "nor release (coarse gate)");
  assert.equal(await codeOf(orders("persona-pkh", "createOrder", [newOrder("PK-M1")])), "BOM_FORBIDDEN", "the PK department manager cannot open an order any more");
  assert.equal(await codeOf(s.save("persona-pkh", "saveCustomer", { customers: { upsert: [{ name: "ลูกค้า PK", country: "Thailand", orderType: "SA", note: "" }] } })), "BOM_FORBIDDEN", "nor add a customer");
  assert.equal(await codeOf(orders("persona-pkh", "updateOrderHeader", [{ ...(await s.orderRow("DEMO-26002")), note: "หัวหน้า PK แก้" }])), "BOM_FORBIDDEN", "nor edit an order");
  assert.ok((await s.save("persona-sa", "saveCustomer", { customers: { upsert: [{ name: "ลูกค้าใหม่ฝ่ายขาย", country: "Thailand", orderType: "SA", note: "" }] } })).data, "sales adds a customer");
  assert.equal(await codeOf(s.save("persona-gr", "createOrder", { orders: { upsert: [newOrder("GR-M1")] } })), "BOM_FORBIDDEN", "GR staff cannot open an order");
  assert.equal(await codeOf(s.save("persona-sa", "requestOrderCancel", { orderRequests: { upsert: [{ id: uid(1), orderId: "SA-M1", reason: "ลูกค้ายกเลิก" }] } })), "BOM_INVALID_TRANSITION", "a draft is not asked about");
  assert.equal(await codeOf(s.save("persona-sa", "requestOrderCancel", { orderRequests: { upsert: [] } })), "BOM_INVALID_REQUEST", "an empty request is refused");
  assert.equal(await codeOf(s.save("persona-sa", "cancelOrder", { orderRequests: { upsert: [{ id: uid(1), orderId: "SA-M1", reason: "ลูกค้ายกเลิก" }] } })), "BOM_INVALID_REQUEST", "the request section goes with a request action only");
  assert.equal(await codeOf(s.save("persona-sa", "decideOrderRequest", { orderRequests: { upsert: [{ id: uid(1), decision: "decline", note: "ไม่ได้" }] } })), "BOM_FORBIDDEN", "sales cannot decide");
});

test("mock: the store round trip — sales opens and sends with products, planning releases, sales asks to cancel, planning confirms with the order row", async () => {
  const s = mockScene();
  const sa = await s.storeFor("persona-sa");
  const opened = sa.store.run("createOrder", { pi: "SA-R1", customer: "ลูกค้ารอบเดียว", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true });
  assert.equal(opened.ok, true, opened.error?.message);
  assert.equal((await opened.saving).ok, true);
  assert.deepEqual(Object.keys(sa.sent[0].changes).sort(), ["customers", "orders"], "the new customer and the order travel together");
  assert.deepEqual([orderOf(sa.store.data(), "SA-R1").source, orderOf(sa.store.data(), "SA-R1").sentBy], ["SA", "สุนิสา ขายดี"]);

  const pp = await s.storeFor("persona-pp");
  const released = pp.store.run("releaseOrder", { orderId: "SA-R1" });
  assert.equal(released.ok, true, released.error?.message);
  assert.equal((await released.saving).ok, true, "planning releases the sent sales order");

  await sa.enter();
  await sa.store.catchUp();
  assert.equal(orderOf(sa.store.data(), "SA-R1").status, "released");
  assert.equal(sa.store.run("cancelOrder", { orderId: "SA-R1", reason: "ลูกค้ายกเลิก" }).ok, false, "the page refuses a direct cancel after release");
  const asked = sa.store.run("requestOrderCancel", { orderId: "SA-R1", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" });
  assert.equal(asked.ok, true, asked.error?.message);
  assert.equal((await asked.saving).ok, true);
  assert.deepEqual(Object.keys(sa.sent.at(-1).changes), ["orderRequests"], "only the request row travels");
  assert.equal(sa.store.data().orderRequests.filter((row) => row.id === asked.result.id).length, 1, "the request arrives once with the id the page gave it");

  await pp.enter();
  await pp.store.catchUp();
  const confirm = pp.store.run("decideOrderRequest", { requestId: asked.result.id, decision: "confirm" });
  assert.equal(confirm.ok, true, confirm.error?.message);
  assert.equal((await confirm.saving).ok, true);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orders", "orderRequests"], "the confirm carries the cancelled order and the request");
  assert.deepEqual([orderOf(pp.store.data(), "SA-R1").status, orderOf(pp.store.data(), "SA-R1").cancelReason], ["cancelled", "ลูกค้ายกเลิกคำสั่งซื้อ"]);
  assert.deepEqual(pp.store.data().orderRequests.map((row) => [row.status, row.decidedBy]), [["done", "สมศรี วางแผน"]]);
  const view = await s.view();
  assert.equal(view.orderRequests.length, 1, "the snapshot lists the request");
});

// ---------- ฝ่ายขายแก้ใบที่ปล่อยผลิตแล้ว (ยังไม่มีงานเริ่ม) ผ่าน store จริง ----------
// ฉาก: SA-E1 ใบของฝ่ายขายที่ปล่อยแล้ว · งาน RB ผูก WO-E1 (planned = ยังไม่เริ่ม) · งาน PK · ใช้สต็อก FG 2 ชิ้นจาก SRC-1 (แถว transfer)
// เดิม store ส่งการลบงานของใบ (jobs.delete) ไปด้วย ตัวลบงาน (private.bom_delete_jobs) รับเฉพาะกลุ่มวางแผน ทั้งคำสั่งจึงเป็น BOM_FORBIDDEN
const FG2 = "DEMO-TP-01(P)-Y";
const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
function releasedSalesScene(items) {
  const header = { customer: "ลูกค้าฝ่ายขาย", country: "Thailand", orderType: "SA", orderedAt: NOW - DAY, whDue: NOW + 30 * DAY, due: { PK: NOW + 20 * DAY }, dueDefaults: [], note: "", createdBy: "x", createdAt: NOW - DAY };
  const job = (id, dept, extra = {}) => ({ id, orderId: "SA-E1", dept, itemCode: FG, name: "งาน", kind: dept === "RB" ? "RB" : "FG", uom: "pcs", qtyPlanned: 5, qtyRequired: 5, stockCounted: null, qtyDone: 0, qtyReject: 0,
    dueAt: NOW + 10 * DAY, status: "queued", externalRef: null, fgCodes: [FG], createdAt: NOW - DAY, reports: [], ...extra });
  const prepare = (d) => {
    d.orders.push({ ...header, id: "SRC-1", source: "PP", revision: 0, status: "completed", items: [{ fgCode: FG, qty: 1, colorSet: "A", note: "" }], explosion: [{ itemCode: FG, kind: "FG", level: 0 }], explodedAt: NOW - DAY, stockCounts: {} },
      { ...header, id: "SA-E1", source: "SA", sentAt: NOW - DAY, sentBy: "สุนิสา ขายดี", revision: 0, status: "released", releasedAt: NOW - DAY, releasedBy: "สมศรี วางแผน", items,
        explosion: [{ itemCode: FG, kind: "FG", level: 0 }], explodedAt: NOW - DAY, stockCounts: { [FG]: 2 } });
    d.jobs.push(job("JOB-E-RB", "RB", { externalRef: { system: "rubberflow", woId: "WO-E1", kg: 5 } }), job("JOB-E-PK", "PK"));
    d.fgMoves.push({ id: "fg-src-1", orderId: "SRC-1", fgCode: FG, kind: "receive", qty: 3, note: "", at: NOW - DAY, by: "x" },
      { id: "fg-take-1", orderId: "SA-E1", fromOrderId: "SRC-1", fgCode: FG, kind: "transfer", qty: 2, note: "", at: NOW - DAY, by: "x" });
  };
  const rf = { version: 3, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) };
  rf.orders = [{ id: "WO-E1", customer: "ลูกค้าฝ่ายขาย", customerPo: "SA-E1", recipeId: "RC-1", recipeRevision: 1, productCode: "", uom: "pcs", color: "ดำ", targetQty: 5, producedQty: 0,
    startDate: NOW, dueDate: NOW + DAY, priority: "normal", note: "", status: "planned", sourceJobId: "JOB-E-RB", createdAt: NOW - DAY, createdBy: "x" }];
  return mockScene({ prepare, rf });
}
const SA_EDITS = [
  ["updateOrderHeader", [{ fgCode: FG, qty: 5, colorSet: "A", note: "" }], { orderId: "SA-E1", whDue: NOW + 40 * DAY, note: "ลูกค้าขอเลื่อนส่ง" }, (order) => [order.whDue, order.note], [NOW + 40 * DAY, "ลูกค้าขอเลื่อนส่ง"]],
  ["updateOrderItem", [{ fgCode: FG, qty: 5, colorSet: "A", note: "" }], { orderId: "SA-E1", fgCode: FG, qty: 6 }, (order) => order.items.map((item) => [item.fgCode, item.qty]), [[FG, 6]]],
  ["addOrderItem", [{ fgCode: FG, qty: 5, colorSet: "A", note: "" }], { orderId: "SA-E1", fgCode: FG2, qty: 4 }, (order) => order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), [[FG, 5, "A"], [FG2, 4, "Y"]]],
  ["removeOrderItem", [{ fgCode: FG, qty: 5, colorSet: "A", note: "" }, { fgCode: FG2, qty: 2, colorSet: "Y", note: "" }], { orderId: "SA-E1", fgCode: FG2 }, (order) => order.items.map((item) => item.fgCode), [FG]],
];
for (const [action, items, payload, pick, expected] of SA_EDITS) {
  test(`mock store: sales ${action} on a released sales order with no job started — only the order row travels; the server drops the jobs, cancels the planned work order and returns the stock`, async () => {
    const s = releasedSalesScene(items);
    await s.call("app_sandbox_enter", { p_persona_id: "persona-sa" });
    const woList = (await s.call("app_rf_master")).orders;
    const sa = await s.storeFor("persona-sa", { rfOrders: () => woList });
    const edit = sa.store.run(action, payload);
    assert.equal(edit.ok, true, edit.error?.message);
    const saved = await edit.saving;
    assert.equal(saved.ok, true, saved.error?.message);
    assert.deepEqual(Object.keys(sa.sent.at(-1).changes), ["orders"], "no jobs.delete: the database drops the jobs of the reopened order itself");
    const order = await s.orderRow("SA-E1");
    assert.deepEqual([order.status, order.revision, order.sentAt !== undefined, pick(order)], ["draft", 1, true, expected], "back to draft for planning, still sent, with the edit");
    const view = await s.view();
    assert.deepEqual(view.jobs.filter((job) => job.orderId === "SA-E1"), [], "the jobs of the order are gone");
    assert.deepEqual(sa.store.data().jobs.filter((job) => job.orderId === "SA-E1"), [], "and the page dropped them too");
    assert.equal((await s.call("app_rf_master")).orders.find((wo) => wo.id === "WO-E1").status, "cancelled", "the planned work order opened at release is cancelled, as when planning reopens");
    assert.deepEqual(view.fgMoves.filter((move) => move.orderId === "SA-E1" && move.kind === "untransfer").map((move) => [move.fromOrderId, move.fgCode, move.qty]), [["SRC-1", FG, 2]],
      "the finished goods taken from stock go back to the source order");
    assert.deepEqual((await s.call("app_bom_audit", { p_limit: 1 }))[0].rubberflow, { opened: 0, skipped: 0, cancelled: 1 }, "the save records the cancelled work order");
  });
}
test("mock: a sales payload that still carries jobs.delete of its reopened order is refused like the database (BOM_FORBIDDEN) — the store never sends it", async () => {
  const s = releasedSalesScene([{ fgCode: FG, qty: 5, colorSet: "A", note: "" }]);
  const row = { ...(await s.orderRow("SA-E1")), status: "draft", revision: 1, explosion: null, items: [{ fgCode: FG, qty: 6, colorSet: "A", note: "" }] };
  assert.equal(await codeOf(s.save("persona-sa", "updateOrderItem", { orders: { upsert: [row] }, jobs: { delete: [{ id: "JOB-E-RB" }, { id: "JOB-E-PK" }] } })), "BOM_FORBIDDEN");
  assert.ok((await s.save("persona-sa", "updateOrderItem", { orders: { upsert: [row] } })).data, "the order row alone reopens it");
  // planning's payload keeps jobs.delete (the planner group may delete jobs; jobs deleted in the same call are skipped)
  const shaped = storeApi.diffMaster({ orders: [{ id: "O", status: "released" }], jobs: [{ id: "J", orderId: "O" }] }, { orders: [{ id: "O", status: "draft" }], jobs: [] });
  assert.deepEqual(shaped.jobs, { delete: [{ id: "J" }] });
});

// ---------- ยกเลิกใบ: คำขออื่นที่ยังเปิดของใบปิดเอง ----------
test("cancelling an order closes its other open requests: a cancel request is done, a change request is declined, both noted 'ใบถูกยกเลิกแล้ว'", () => {
  const d = fresh();
  saOrder(d, "SA-C1", { send: true });
  A.releaseOrder(d, { orderId: "SA-C1" }, ctx("planner"));
  const change = A.requestOrderChange(d, { orderId: "SA-C1", reason: "เพิ่มเป็น 5 ชุด" }, ctx("sa"));
  const cancel = A.requestOrderCancel(d, { orderId: "SA-C1", reason: "ลูกค้ายกเลิก" }, ctx("sa"));
  A.cancelOrder(d, { orderId: "SA-C1", reason: "ฝ่ายวางแผนยกเลิกเอง" }, ctx("planner"));
  assert.deepEqual(A.helpers.orderRequestsOf(d, "SA-C1").map((row) => [row.id, row.status, row.decisionNote, row.decidedBy]),
    [[change.id, "declined", "ใบถูกยกเลิกแล้ว", USERS.planner.name], [cancel.id, "done", "ใบถูกยกเลิกแล้ว", USERS.planner.name]]);
  rejects(() => A.decideOrderRequest(d, { requestId: change.id, decision: "done" }, ctx("planner")), /ตัดสินไปแล้ว/);
  // ยืนยันคำขอยกเลิก: คำขอแก้ใบที่เปิดอยู่ปิดเอง · คำขอที่ยืนยันได้ผลของการยืนยัน
  saOrder(d, "SA-C2", { send: true });
  A.releaseOrder(d, { orderId: "SA-C2" }, ctx("planner"));
  const change2 = A.requestOrderChange(d, { orderId: "SA-C2", reason: "ขอแก้จำนวน" }, ctx("sa"));
  const cancel2 = A.requestOrderCancel(d, { orderId: "SA-C2", reason: "ลูกค้ายกเลิก" }, ctx("sa"));
  A.decideOrderRequest(d, { requestId: cancel2.id, decision: "confirm", note: "ยืนยัน" }, ctx("planner"));
  assert.deepEqual(A.helpers.orderRequestsOf(d, "SA-C2").map((row) => [row.id, row.status, row.decisionNote]), [[change2.id, "declined", "ใบถูกยกเลิกแล้ว"], [cancel2.id, "done", "ยืนยัน"]]);
});

test("mock store: planning cancels a sales order with open requests; the server closes them in the same call and the page shows the closed rows", async () => {
  const s = mockScene();
  const sa = await s.storeFor("persona-sa");
  assert.equal((await sa.store.run("createOrder", { pi: "SA-C3", customer: "ลูกค้ารอบเดียว", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }).saving).ok, true);
  const pp = await s.storeFor("persona-pp");
  assert.equal((await pp.store.run("releaseOrder", { orderId: "SA-C3" }).saving).ok, true);
  await sa.enter();
  await sa.store.catchUp();
  const change = sa.store.run("requestOrderChange", { orderId: "SA-C3", reason: "ขอเพิ่มจำนวน" });
  assert.equal((await change.saving).ok, true);
  const cancel = sa.store.run("requestOrderCancel", { orderId: "SA-C3", reason: "ลูกค้ายกเลิก" });
  assert.equal((await cancel.saving).ok, true);
  await pp.enter();
  await pp.store.catchUp();
  const cancelled = pp.store.run("cancelOrder", { orderId: "SA-C3", reason: "ฝ่ายวางแผนยกเลิกเอง" });
  assert.equal(cancelled.ok, true, cancelled.error?.message);
  assert.equal((await cancelled.saving).ok, true);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orders"], "the requests are closed by the server, not sent");
  const rows = (await s.view()).orderRequests.filter((row) => row.orderId === "SA-C3").map((row) => [row.id, row.status, row.decisionNote, row.decidedBy]).sort();
  assert.deepEqual(rows, [[cancel.result.id, "done", "ใบถูกยกเลิกแล้ว", "สมศรี วางแผน"], [change.result.id, "declined", "ใบถูกยกเลิกแล้ว", "สมศรี วางแผน"]].sort());
  assert.deepEqual(pp.store.data().orderRequests.filter((row) => row.orderId === "SA-C3").map((row) => row.status).sort(), ["declined", "done"]);
  assert.match((await s.call("app_bom_audit", { p_limit: 1 }))[0].detail, /orderRequests \+2/, "the closed requests are counted in the audit row");
  assert.equal(await codeOf(s.save("persona-pp", "decideOrderRequest", { orderRequests: { upsert: [{ id: change.result.id, decision: "done", note: "" }] } })), "BOM_INVALID_TRANSITION", "nothing is left to decide");
});
