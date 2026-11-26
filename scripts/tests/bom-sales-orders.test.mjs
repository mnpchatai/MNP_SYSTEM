import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// ใบสั่งผลิตจากฝ่ายขาย (SA) ส่งให้ฝ่ายวางแผน (PP) · ฝ่ายขายแก้ / ยกเลิกใบเองแล้วแจ้งฝ่ายวางแผน (รอบ 2) · ผู้เขียนใบสั่งผลิตและลูกค้า (โรงงาน ขั้น 8 · 20261226010000_bom_sales_orders.sql)
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

// ---------- รอบ 2: ฝ่ายขายแก้ / ยกเลิกใบเอง ฝ่ายวางแผนรับทราบหรือเลือกทางของใบที่ยกเลิกกลางทาง ----------
// ใบของฝ่ายขายที่ปล่อยแล้วและงาน PK รายงานผลแล้ว (เริ่มงาน)
const startedOrder = (d, pi, qty = 3) => {
  saOrder(d, pi, { send: true, lines: [{ fgCode: FG, qty }] });
  A.releaseOrder(d, { orderId: pi }, ctx("planner"));
  const pk = d.jobs.find((job) => job.orderId === pi && job.dept === "PK" && job.kind === "FG");
  A.reportJob(d, { jobId: pk.id, qtyDone: 1, note: "ชุดแรก" }, ctx("planner"));
  return pk;
};
const noticesOf = (d, pi) => A.helpers.orderRequestsOf(d, pi).map((row) => [row.kind, row.status, row.decision, row.reason]);

test("nothing started: sales cancels a released or sent order outright and planning gets a notice to acknowledge; an unsent draft is cancelled quietly", () => {
  const d = fresh();
  saOrder(d, "SA-T3", { send: true });
  A.releaseOrder(d, { orderId: "SA-T3" }, ctx("planner"));
  rejects(() => A.cancelOrder(d, { orderId: "SA-T3", reason: "ab" }, ctx("sa")), /อย่างน้อย 3/);
  A.cancelOrder(d, { orderId: "SA-T3", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" }, ctx("sa"));
  assert.deepEqual([orderOf(d, "SA-T3").status, orderOf(d, "SA-T3").cancelReason, orderOf(d, "SA-T3").salesCancelAt], ["cancelled", "ลูกค้ายกเลิกคำสั่งซื้อ", undefined],
    "cancelled at once, not a mid-way cancel");
  assert.deepEqual(noticesOf(d, "SA-T3"), [["cancel", "open", null, "ลูกค้ายกเลิกคำสั่งซื้อ"]]);
  const notice = A.helpers.orderRequestsOf(d, "SA-T3")[0];
  assert.equal(A.helpers.noticeMode(d, notice), "ack");
  assert.ok(d.audit.some((row) => row.action === "ฝ่ายขายยกเลิกใบ"));
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "ack" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "ack" }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "continue" }, ctx("planner")), /รับทราบได้อย่างเดียว/);
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "maybe" }, ctx("planner")), /ไม่รู้จัก/);
  const ack = A.decideOrderRequest(d, { requestId: notice.id, decision: "ack" }, ctx("planner"));
  assert.deepEqual([ack.section, ack.request], ["orderRequests", [{ id: notice.id, decision: "ack" }]]);
  assert.deepEqual(noticesOf(d, "SA-T3"), [["cancel", "done", "ack", "ลูกค้ายกเลิกคำสั่งซื้อ"]]);
  assert.equal(d.audit[0].action, "ฝ่ายวางแผนรับทราบ");
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "ack" }, ctx("planner")), /ตัดสินไปแล้ว/);
  // ร่างที่ส่งแล้ว = แจ้ง · ร่างที่ยังไม่เคยส่ง = ไม่แจ้ง
  saOrder(d, "SA-T3B", { send: true });
  A.cancelOrder(d, { orderId: "SA-T3B", reason: "ลูกค้าเปลี่ยนใจ" }, ctx("sa"));
  saOrder(d, "SA-T3C");
  A.cancelOrder(d, { orderId: "SA-T3C", reason: "เปิดซ้ำ" }, ctx("sa"));
  assert.deepEqual([noticesOf(d, "SA-T3B").length, noticesOf(d, "SA-T3C").length], [1, 0]);
  assert.equal(typeof A.requestOrderCancel, "undefined", "the request actions of the first round are gone");
});

test("a started sales order: sales edits it in place (status, jobs and explosion stay) and planning gets 'ฝ่ายขายแก้ใบ' with old → new values", () => {
  const d = fresh();
  const pk = startedOrder(d, "SA-T5");
  const before = orderOf(d, "SA-T5");
  const explosion = JSON.stringify(before.explosion);
  const jobs = d.jobs.filter((job) => job.orderId === "SA-T5").length;
  assert.equal(before.status, "in_progress");
  assert.ok(A.helpers.orderLocked(d, before), "a reported job means the order started");
  A.updateOrderItem(d, { orderId: "SA-T5", fgCode: FG, qty: 5 }, ctx("sa"));
  A.updateOrderHeader(d, { orderId: "SA-T5", whDue: Date.parse("2026-12-31T00:00:00+07:00") }, ctx("sa"));
  A.addOrderItem(d, { orderId: "SA-T5", fgCode: "DEMO-TP-01(P)-Y", qty: 4 }, ctx("saHead"));
  A.removeOrderItem(d, { orderId: "SA-T5", fgCode: "DEMO-TP-01(P)-Y" }, ctx("sa"));
  const order = orderOf(d, "SA-T5");
  assert.deepEqual([order.status, order.revision, order.items.map((item) => [item.fgCode, item.qty]), JSON.stringify(order.explosion), d.jobs.filter((job) => job.orderId === "SA-T5").length, d.jobs.find((job) => job.id === pk.id).qtyPlanned],
    ["in_progress", 0, [[FG, 5]], explosion, jobs, pk.qtyPlanned], "the order changes in place; jobs and explosion stay for planning to adjust");
  assert.deepEqual(noticesOf(d, "SA-T5").map((row) => row.slice(0, 2).concat(row[3])), [
    ["change", "open", `${FG} 3 → 5`], ["change", "open", `กำหนดส่งคลัง ${new Date(NOW + 30 * DAY + 7 * 3600000).toISOString().slice(0, 10).split("-").reverse().join("/")} → 31/12/2026`],
    ["change", "open", "เพิ่ม DEMO-TP-01(P)-Y × 4"], ["change", "open", "ลบ DEMO-TP-01(P)-Y × 4"]]);
  assert.ok(d.audit.some((row) => row.action === "ฝ่ายขายแก้ใบ"));
  rejects(() => A.removeOrderItem(d, { orderId: "SA-T5", fgCode: FG }, ctx("sa")), /อย่างน้อยหนึ่งรายการ/);
  rejects(() => A.updateOrderItem(d, { orderId: "SA-T5", fgCode: FG, qty: 6 }, ctx("planner")), /มีงานที่เริ่มแล้ว/);
  // ส่งมอบลูกค้าแล้ว 2: ลดต่ำกว่า 2 ไม่ได้ · ลดเหลือ 2 ได้ (ต่ำกว่าที่รับเข้าได้ ส่วนเกินเป็นสต็อก)
  d.fgMoves.push({ id: "fg-r", orderId: "SA-T5", fgCode: FG, kind: "receive", qty: 3, note: "", at: NOW, by: "x" }, { id: "fg-d", orderId: "SA-T5", fgCode: FG, kind: "deliver", qty: 2, note: "", at: NOW, by: "x" });
  rejects(() => A.updateOrderItem(d, { orderId: "SA-T5", fgCode: FG, qty: 1 }, ctx("sa")), /ส่งมอบ .* ให้ลูกค้าแล้ว 2/);
  A.updateOrderItem(d, { orderId: "SA-T5", fgCode: FG, qty: 2 }, ctx("sa"));
  assert.equal(A.decideOrderRequest(d, { requestId: A.helpers.orderRequestsOf(d, "SA-T5")[0].id, decision: "ack" }, ctx("planner")).status, "done");
  rejects(() => A.decideOrderRequest(d, { requestId: A.helpers.orderRequestsOf(d, "SA-T5")[1].id, decision: "stop" }, ctx("planner")), /รับทราบได้อย่างเดียว/);
  // สรุปเหมือน private.bom_sa_change_summary ทุกตัวอักษร (pgTAP ใช้ค่าชุดเดียวกัน)
  const sqlCase = A.helpers.salesChangeSummary(
    { customer: "ลูกค้าเดิม", country: "TH", orderType: "SA", whDue: 1769212800000, note: "", items: [{ fgCode: "FG-S1", qty: 5, note: "" }, { fgCode: "FG-S2-Y", qty: 2.5, note: "" }] },
    { customer: "ลูกค้าใหม่", country: "TH", orderType: "SA", whDue: 1769385600000, note: "ด่วน", items: [{ fgCode: "FG-S1", qty: 3, note: "แพ็กใหม่" }, { fgCode: "FG-S3", qty: 4, note: "" }] });
  assert.equal(sqlCase, "ลูกค้า ลูกค้าเดิม → ลูกค้าใหม่ · กำหนดส่งคลัง 24/01/2026 → 26/01/2026 · แก้หมายเหตุ · FG-S1 5 → 3 · เพิ่ม FG-S3 × 4 · ลบ FG-S2-Y × 2.5");
  const long = A.helpers.salesChangeSummary({ customer: "ก", country: "TH", orderType: "SA", whDue: 1, note: "", items: [] }, { customer: "ข".repeat(400), country: "TH", orderType: "SA", whDue: 1, note: "", items: [] });
  assert.deepEqual([[...long].length, long.endsWith("…")], [300, true]);
});

test("a started sales order: sales cancels mid-way, the order takes no new work, planning chooses to produce to the end (stock, no delivery) or to stop", () => {
  const d = fresh();
  startedOrder(d, "SA-T6");
  A.cancelOrder(d, { orderId: "SA-T6", reason: "ลูกค้ายกเลิกกลางทาง" }, ctx("sa"));
  const order = orderOf(d, "SA-T6");
  assert.deepEqual([order.status, order.salesCancelAt, order.salesCancelBy, order.salesCancelReason, order.salesCancelChoice], ["in_progress", NOW, USERS.sa.name, "ลูกค้ายกเลิกกลางทาง", undefined]);
  assert.ok(A.helpers.salesCancelPending(order));
  const notice = A.helpers.orderRequestsOf(d, "SA-T6")[0];
  assert.deepEqual([notice.kind, notice.status, A.helpers.noticeMode(d, notice)], ["cancel", "open", "choose"]);
  rejects(() => A.cancelOrder(d, { orderId: "SA-T6", reason: "อีกครั้ง" }, ctx("sa")), /^ฝ่ายขายยกเลิกใบนี้ไว้แล้ว รอฝ่ายวางแผนตัดสินของที่ทำค้าง$/);
  rejects(() => A.updateOrderItem(d, { orderId: "SA-T6", fgCode: FG, qty: 4 }, ctx("sa")), /ฝ่ายขายยกเลิกใบนี้แล้ว/);
  rejects(() => A.issueOrderParts(d, { orderId: "SA-T6" }, ctx("planner")), /ไม่รับงานใหม่/);
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "ack" }, ctx("planner")), /เลือกผลิตต่อจนจบส่ง WH หรือหยุด/);
  rejects(() => A.decideOrderRequest(d, { requestId: notice.id, decision: "continue" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  const go = A.decideOrderRequest(d, { requestId: notice.id, decision: "continue" }, ctx("planner"));
  assert.deepEqual(go.request, [{ id: notice.id, decision: "continue" }]);
  assert.deepEqual([orderOf(d, "SA-T6").status, orderOf(d, "SA-T6").salesCancelChoice, d.audit[0].action], ["in_progress", "continue", "ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH"]);
  assert.equal(A.helpers.salesCancelPending(orderOf(d, "SA-T6")), false, "work resumes");
  // ยกเลิกซ้ำหลังฝ่ายวางแผนเลือกผลิตต่อ: ข้อความบอกทางเลือกที่เลือกแล้ว ไม่ใช่ "รอตัดสิน"
  rejects(() => A.cancelOrder(d, { orderId: "SA-T6", reason: "อีกครั้ง" }, ctx("sa")), /^ฝ่ายขายยกเลิกใบนี้ไว้แล้ว ฝ่ายวางแผนเลือกผลิตต่อจนจบส่ง WH \(เข้าสต็อก\)$/);
  // ของที่รับเข้าเป็นสต็อกสินค้าสำเร็จรูป (นับสั่ง = 0) และส่งมอบให้ลูกค้าไม่ได้
  d.fgMoves.push({ id: "fg-r6", orderId: "SA-T6", fgCode: FG, kind: "receive", qty: 2, note: "", at: NOW, by: "x" });
  const R = globalThis.MNP_BOM_RULES;
  assert.deepEqual(R.fgFreeList(d).get(FG)?.find((row) => row.orderId === "SA-T6")?.free, 2, "the received goods are free stock for other orders");
  assert.deepEqual(R.fgPosition(d, orderOf(d, "SA-T6")).products.map((product) => [product.deliverable, product.owed]), [[0, 0]], "nothing to deliver to that customer");
  rejects(() => A.deliverFg(d, { orderId: "SA-T6", lines: [{ fgCode: FG, qty: 1 }] }, { now: NOW, user: seed.USERS.find((row) => row.role === "wh") }), /ส่งมอบให้ลูกค้าของใบนี้ไม่ได้|ส่งมอบได้อีกไม่เกิน/);

  // หยุด: ยกเลิกใบด้วยเหตุผลของฝ่ายขาย · การแจ้งแก้ใบที่ยังเปิดปิดเอง (รับทราบ)
  startedOrder(d, "SA-T7");
  A.updateOrderItem(d, { orderId: "SA-T7", fgCode: FG, qty: 2 }, ctx("sa"));
  A.cancelOrder(d, { orderId: "SA-T7", reason: "ลูกค้าปิดกิจการ" }, ctx("sa"));
  const stop = A.helpers.orderRequestsOf(d, "SA-T7").find((row) => row.kind === "cancel");
  A.decideOrderRequest(d, { requestId: stop.id, decision: "stop" }, ctx("planner"));
  assert.deepEqual([orderOf(d, "SA-T7").status, orderOf(d, "SA-T7").cancelReason, orderOf(d, "SA-T7").salesCancelChoice], ["cancelled", "ลูกค้าปิดกิจการ", "stop"]);
  assert.deepEqual(noticesOf(d, "SA-T7").map((row) => row.slice(0, 3)), [["change", "done", "ack"], ["cancel", "done", "stop"]]);
  assert.ok(d.audit.some((row) => row.action === "ฝ่ายวางแผนเลือกหยุดและเก็บยางเส้นยาวที่ SR"));
  // ฝ่ายวางแผนยกเลิกใบที่รอตัดสินตรง ๆ = หยุดเช่นกัน
  startedOrder(d, "SA-T8");
  A.cancelOrder(d, { orderId: "SA-T8", reason: "ลูกค้ายกเลิก" }, ctx("sa"));
  A.cancelOrder(d, { orderId: "SA-T8", reason: "ฝ่ายวางแผนหยุดเอง" }, ctx("planner"));
  assert.deepEqual([orderOf(d, "SA-T8").salesCancelChoice, noticesOf(d, "SA-T8")[0].slice(0, 3)], ["stop", ["cancel", "done", "stop"]]);
});

test("database mode: the decision action returns one row; the store sends it in the notice section (with the order row for stop / continue); messages stay Thai", () => {
  assert.deepEqual(storeApi.REQUEST_ACTIONS, { decideOrderRequest: "orderRequests" });
  assert.deepEqual(storeApi.WORK_LISTS.slice(-2), ["orderRequests", "grWorkers"], "the notice list sits before the worker list, like the database delta");
  assert.doesNotMatch(storeApi.mapRemoteError({ code: "BOM_INVALID_REQUEST" }).message, /BOM_/);
  assert.match(storeApi.mapRemoteError({ code: "BOM_FG_EXCEEDS" }).message, /ส่งมอบลูกค้าแล้ว/);
});

test("sales edits a released sales order while no job started (back to draft, still sent, no notice)", () => {
  const d = fresh();
  saOrder(d, "SA-T4", { send: true });
  A.releaseOrder(d, { orderId: "SA-T4" }, ctx("planner"));
  A.updateOrderItem(d, { orderId: "SA-T4", fgCode: FG, qty: 5 }, ctx("sa"));
  const order = orderOf(d, "SA-T4");
  assert.deepEqual([order.status, order.revision, order.items[0].qty, order.sentAt], ["draft", 1, 5, NOW]);
  assert.equal(d.jobs.filter((job) => job.orderId === "SA-T4").length, 0, "its jobs are gone until planning releases it again");
  assert.deepEqual(A.helpers.orderRequestsOf(d, "SA-T4"), [], "planning releases it again anyway: no notice");
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
  assert.equal(await codeOf(s.save("persona-sa", "requestOrderCancel", { orderRequests: { upsert: [{ id: uid(1), orderId: "SA-M1", reason: "ลูกค้ายกเลิก" }] } })), "BOM_FORBIDDEN", "the request actions of the first round are gone (coarse gate)");
  assert.equal(await codeOf(s.save("persona-pp", "requestOrderCancel", { orderRequests: { upsert: [{ id: uid(1), orderId: "SA-M1", reason: "ลูกค้ายกเลิก" }] } })), "BOM_INVALID_ACTION", "even for planning");
  assert.equal(await codeOf(s.save("persona-pp", "decideOrderRequest", { orderRequests: { upsert: [] } })), "BOM_INVALID_REQUEST", "an empty decision is refused");
  assert.equal(await codeOf(s.save("persona-sa", "cancelOrder", { orderRequests: { upsert: [{ id: uid(1), decision: "ack" }] } })), "BOM_INVALID_REQUEST", "the notice section goes with decideOrderRequest only");
  assert.equal(await codeOf(s.save("persona-sa", "decideOrderRequest", { orderRequests: { upsert: [{ id: uid(1), decision: "ack" }] } })), "BOM_FORBIDDEN", "sales cannot decide");
  assert.equal(await codeOf(s.save("persona-pp", "decideOrderRequest", { orderRequests: { upsert: [{ id: uid(1), decision: "ack" }] } })), "BOM_INVALID_REQUEST", "an unknown notice is refused");
  assert.equal(await codeOf(orders("persona-sa", "cancelOrder", [{ ...(await s.orderRow("SA-M1")), salesCancelReason: "ลูกค้ายกเลิก" }])), "BOM_INVALID_TRANSITION", "a draft is cancelled outright, not mid-way");
});

test("mock: the store round trip — sales opens and sends, planning releases, PK starts; sales edits in place and cancels mid-way (server notices); the order takes no new work; planning continues", async () => {
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
  const pkJob = pp.store.data().jobs.find((job) => job.orderId === "SA-R1" && job.dept === "PK" && job.kind === "FG");
  const reported = pp.store.run("reportJob", { jobId: pkJob.id, qtyDone: 1, note: "ชุดแรก" });
  assert.equal(reported.ok, true, reported.error?.message);
  assert.equal((await reported.saving).ok, true, "a job starts");

  await sa.enter();
  await sa.store.catchUp();
  assert.equal(orderOf(sa.store.data(), "SA-R1").status, "in_progress");
  const edited = sa.store.run("updateOrderItem", { orderId: "SA-R1", fgCode: FG, qty: 5 });
  assert.equal(edited.ok, true, edited.error?.message);
  assert.equal((await edited.saving).ok, true, "the server accepts the edit in place");
  assert.deepEqual(Object.keys(sa.sent.at(-1).changes), ["orders"], "only the order row travels (the server writes the notice)");
  const view1 = await s.view();
  assert.deepEqual([orderOf(view1, "SA-R1").status, orderOf(view1, "SA-R1").items[0].qty, view1.jobs.filter((job) => job.orderId === "SA-R1").length > 0],
    ["in_progress", 5, true], "the order changed in place and kept its jobs");
  assert.deepEqual(view1.orderRequests.map((row) => [row.orderId, row.kind, row.status, row.reason, row.requestedBy]), [["SA-R1", "change", "open", `${FG} 3 → 5`, "สุนิสา ขายดี"]]);
  assert.deepEqual(sa.store.data().orderRequests.map((row) => row.reason), [`${FG} 3 → 5`], "the page shows the server notice once");
  assert.match((await s.call("app_bom_audit", { p_limit: 1 }))[0].detail, /orderRequests \+1/, "the notice is counted in the audit row");

  const cancelled = sa.store.run("cancelOrder", { orderId: "SA-R1", reason: "ลูกค้ายกเลิกคำสั่งซื้อ" });
  assert.equal(cancelled.ok, true, cancelled.error?.message);
  assert.equal((await cancelled.saving).ok, true, "sales cancels the started order mid-way");
  assert.deepEqual(Object.keys(sa.sent.at(-1).changes), ["orders"]);
  const row = await s.orderRow("SA-R1");
  assert.deepEqual([row.status, row.salesCancelAt, row.salesCancelBy, row.salesCancelReason, row.salesCancelChoice], ["in_progress", NOW, "สุนิสา ขายดี", "ลูกค้ายกเลิกคำสั่งซื้อ", null]);
  assert.equal(await codeOf(s.save("persona-wh", "deliverFg", { fgMoves: { upsert: [{ orderId: "SA-R1", kind: "deliver", lines: [{ fgCode: FG, qty: 1 }], note: "" }] } })), "BOM_INVALID_TRANSITION",
    "the warehouse cannot deliver to the customer who cancelled");
  assert.equal(await codeOf(s.save("persona-st", "issueOrderParts", { jobs: { upsert: [{ ...pkJob, orderId: "SA-R1" }] } })), "BOM_INVALID_TRANSITION", "no new issue for the order");
  assert.equal(await codeOf(s.save("persona-sr", "issueRods", { rodMoves: { upsert: [{ id: uid(40), kind: "issue", lotId: uid(41), ownerOrderId: null, forOrderId: "SA-R1", itemCode: "X", qty: -1 }] } })),
    "BOM_INVALID_TRANSITION", "nor long rods");
  assert.equal(await codeOf(s.save("persona-sa", "updateOrderHeader", { orders: { upsert: [{ ...row, note: "แก้หลังยกเลิก" }] } })), "BOM_INVALID_TRANSITION", "sales cannot edit what it cancelled");
  assert.equal(await codeOf(s.save("persona-pp", "cancelOrder", { orders: { upsert: [{ ...(await s.orderRow("DEMO-26002")), salesCancelReason: "ฝ่ายวางแผนขอ" }] } })), "BOM_FORBIDDEN",
    "only sales cancels mid-way");

  await pp.enter();
  await pp.store.catchUp();
  const notice = pp.store.data().orderRequests.find((row) => row.orderId === "SA-R1" && row.kind === "cancel");
  assert.equal(await codeOf(s.save("persona-pp", "decideOrderRequest", { orderRequests: { upsert: [{ id: notice.id, decision: "ack" }] } })), "BOM_INVALID_REQUEST", "a mid-way cancel needs a choice");
  assert.equal(await codeOf(s.save("persona-pkh", "decideOrderRequest", { orderRequests: { upsert: [{ id: notice.id, decision: "continue" }] } })), "BOM_FORBIDDEN", "a production head cannot choose");
  assert.equal(await codeOf(s.save("persona-sa", "decideOrderRequest", { orderRequests: { upsert: [{ id: notice.id, decision: "continue" }] } })), "BOM_FORBIDDEN", "nor sales");
  await pp.enter(); // s.save ด้านบนสลับ persona ไปแล้ว
  const go = pp.store.run("decideOrderRequest", { requestId: notice.id, decision: "continue" });
  assert.equal(go.ok, true, go.error?.message);
  assert.equal((await go.saving).ok, true);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orders", "orderRequests"], "the choice travels with the order row");
  assert.deepEqual([(await s.orderRow("SA-R1")).salesCancelChoice, (await s.view()).orderRequests.find((r) => r.id === notice.id).decision], ["continue", "continue"]);
  assert.equal(await codeOf(s.save("persona-wh", "deliverFg", { fgMoves: { upsert: [{ orderId: "SA-R1", kind: "deliver", lines: [{ fgCode: FG, qty: 1 }], note: "" }] } })), "BOM_INVALID_TRANSITION",
    "still no delivery to that customer after the choice");
  const change = pp.store.data().orderRequests.find((r) => r.orderId === "SA-R1" && r.kind === "change");
  await pp.enter();
  const ack = pp.store.run("decideOrderRequest", { requestId: change.id, decision: "ack" });
  assert.equal((await ack.saving).ok, true);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orderRequests"], "an acknowledgement sends only the decision");
  assert.equal(await codeOf(s.save("persona-pp", "decideOrderRequest", { orderRequests: { upsert: [{ id: change.id, decision: "ack" }] } })), "BOM_INVALID_TRANSITION", "acknowledged once");
});

test("mock store: planning stops a mid-way cancel (order cancelled with the sales reason, notices closed by the server) or cancels such an order directly (also a stop)", async () => {
  const s = mockScene();
  const sa = await s.storeFor("persona-sa");
  const pp = await s.storeFor("persona-pp");
  for (const pi of ["SA-C3", "SA-C4"]) {
    await sa.enter();
    assert.equal((await sa.store.run("createOrder", { pi, customer: "ลูกค้ารอบเดียว", country: "Thailand", orderedAt: NOW, whDue: NOW + 30 * DAY, lines: [{ fgCode: FG, qty: 3 }], send: true }).saving).ok, true);
    await pp.enter();
    await pp.store.catchUp();
    assert.equal((await pp.store.run("releaseOrder", { orderId: pi }).saving).ok, true);
    const pkJob = pp.store.data().jobs.find((job) => job.orderId === pi && job.dept === "PK" && job.kind === "FG");
    assert.equal((await pp.store.run("reportJob", { jobId: pkJob.id, qtyDone: 1, note: "ชุดแรก" }).saving).ok, true);
    await sa.enter();
    await sa.store.catchUp();
    assert.equal((await sa.store.run("updateOrderItem", { orderId: pi, fgCode: FG, qty: 2 }).saving).ok, true);
    assert.equal((await sa.store.run("cancelOrder", { orderId: pi, reason: "ลูกค้าเลิกสั่ง" }).saving).ok, true);
  }
  await pp.enter();
  await pp.store.catchUp();
  const notice = pp.store.data().orderRequests.find((row) => row.orderId === "SA-C3" && row.kind === "cancel");
  const stop = pp.store.run("decideOrderRequest", { requestId: notice.id, decision: "stop" });
  assert.equal(stop.ok, true, stop.error?.message);
  assert.equal((await stop.saving).ok, true);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes), ["orders", "orderRequests"], "stop carries the cancelled order and the decision");
  const view = await s.view();
  assert.deepEqual([orderOf(view, "SA-C3").status, orderOf(view, "SA-C3").cancelReason, orderOf(view, "SA-C3").salesCancelChoice], ["cancelled", "ลูกค้าเลิกสั่ง", "stop"]);
  assert.deepEqual(view.orderRequests.filter((row) => row.orderId === "SA-C3").map((row) => [row.kind, row.status, row.decision, row.decidedBy]).sort(),
    [["cancel", "done", "stop", "สมศรี วางแผน"], ["change", "done", "ack", "สมศรี วางแผน"]]);
  assert.match((await s.call("app_bom_audit", { p_limit: 1 }))[0].detail, /orderRequests \+2/, "the decided notice and the one closed with the order are counted");
  const direct = pp.store.run("cancelOrder", { orderId: "SA-C4", reason: "ฝ่ายวางแผนหยุดเอง" });
  assert.equal((await direct.saving).ok, true);
  const view2 = await s.view();
  assert.deepEqual([orderOf(view2, "SA-C4").salesCancelChoice, view2.orderRequests.filter((row) => row.orderId === "SA-C4").map((row) => [row.kind, row.decision]).sort()],
    ["stop", [["cancel", "stop"], ["change", "ack"]]]);
  assert.deepEqual(pp.store.data().orderRequests.filter((row) => row.status === "open"), [], "the page shows nothing left to decide");
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

// ---------- ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ (addJobsForChanges · "เพิ่มในใบเดิม ฝ่ายวางแผนสร้างงานเพิ่ม") ----------
// คู่ (แผนก, ชิ้นงาน) ที่ยังไม่มีงาน = งานใหม่ · มีงานแล้ว = เพิ่มยอดแผนของงานนั้น (unique (order_pk, dept, item_code) คงเดิม) · ลด / ลบ = ข้าม
const jobsOfOrder = (d, pi) => d.jobs.filter((job) => job.orderId === pi);
const planOf = (d, pi, rfOrders = []) => A.helpers.extraJobsFor(d, orderOf(d, pi), rfOrders);
const pairsUnique = (d, pi) => new Set(jobsOfOrder(d, pi).map((job) => `${job.dept}|${job.itemCode}`)).size === jobsOfOrder(d, pi).length;
const plannerRf = (rfOrders = []) => ctx("planner", { rfOrders });

test("extra jobs: sales raising a quantity raises the existing jobs of the order (never a second row); planning presses once; lowered quantities open nothing", () => {
  const d = fresh();
  startedOrder(d, "SA-X1", 3);
  const count = jobsOfOrder(d, "SA-X1").length;
  assert.deepEqual([planOf(d, "SA-X1").lines, planOf(d, "SA-X1").jobs, planOf(d, "SA-X1").blockers, planOf(d, "SA-X1").explosion], [[], [], [], null], "nothing added = nothing to open");
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X1" }, plannerRf()), /ไม่ได้เพิ่มสินค้าหรือจำนวน/);
  A.updateOrderItem(d, { orderId: "SA-X1", fgCode: FG, qty: 5 }, ctx("sa"));
  const plan = planOf(d, "SA-X1");
  assert.deepEqual(plan.lines, [{ fgCode: FG, before: 3, after: 5, added: 2 }]);
  assert.deepEqual(plan.blockers, []);
  assert.ok(plan.jobs.length > 0 && plan.jobs.every((entry) => entry.mode === "raise"), "every pair already has a job");
  const pk = plan.jobs.find((entry) => entry.dept === "PK");
  assert.deepEqual([pk.from, pk.to, pk.diff], [3, 5, 2]);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X1" }, ctx("sa")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X1" }, ctx("pkHead")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  const before = new Map(jobsOfOrder(d, "SA-X1").map((job) => [job.id, { ...job }]));
  const out = A.addJobsForChanges(d, { orderId: "SA-X1" }, plannerRf());
  assert.deepEqual([out.created, out.raised], [0, plan.jobs.length]);
  assert.equal(jobsOfOrder(d, "SA-X1").length, count, "no second row for any department and item");
  for (const job of jobsOfOrder(d, "SA-X1")) {
    const old = before.get(job.id);
    const entry = plan.jobs.find((row) => row.jobId === job.id);
    assert.deepEqual({ ...job, qtyPlanned: old.qtyPlanned, qtyRequired: old.qtyRequired, stockCounted: old.stockCounted }, old, `${job.dept} ${job.itemCode}: only the plan and the requirement change`);
    // 20261227010000: "ต้องการ" เพิ่มตามยอดแผนที่เพิ่ม (ไม่เหลือ "8 ชุด ต้องการ 6")
    if (entry) assert.deepEqual([job.qtyPlanned, job.qtyRequired], [entry.to, entry.requiredTo]);
  }
  const pkJob = jobsOfOrder(d, "SA-X1").find((job) => job.dept === "PK");
  assert.deepEqual([pkJob.qtyPlanned, pkJob.qtyDone, pkJob.status], [5, 1, "in_progress"], "the started PK job keeps its work and now plans 5");
  const rb = jobsOfOrder(d, "SA-X1").find((job) => job.dept === "RB");
  assert.equal(rb.qtyPlanned, Math.ceil(rb.qtyPlanned), "rods stay whole like at release");
  assert.ok(jobsOfOrder(d, "SA-X1").some((job) => job.dept === "ST" && job.qtyPlanned > before.get(job.id).qtyPlanned), "purchased parts are raised too");
  assert.deepEqual([d.audit[0].action, d.audit[0].detail.startsWith(`SA-X1 ${FG} +2`)], ["ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ", true]);
  assert.deepEqual(planOf(d, "SA-X1").lines, [], "the stored explosion now matches: the card goes away");
  // ฝ่ายขายลดจำนวน: ไม่มีอะไรให้เปิด (งานไม่ลด)
  A.updateOrderItem(d, { orderId: "SA-X1", fgCode: FG, qty: 4 }, ctx("sa"));
  assert.deepEqual([planOf(d, "SA-X1").lines, planOf(d, "SA-X1").jobs], [[], []]);
  assert.equal(pkJob.qtyPlanned, 5);
});

test("extra jobs: a new product opens new jobs for its own parts and raises the jobs of parts it shares; removing it later opens nothing", () => {
  const d = fresh();
  startedOrder(d, "SA-X2", 3);
  const shared = new Map(jobsOfOrder(d, "SA-X2").map((job) => [`${job.dept}|${job.itemCode}`, job.qtyPlanned]));
  A.addOrderItem(d, { orderId: "SA-X2", fgCode: FG2, qty: 2 }, ctx("sa"));
  const plan = planOf(d, "SA-X2");
  assert.deepEqual(plan.lines, [{ fgCode: FG2, before: 0, after: 2, added: 2 }]);
  const pkNew = plan.jobs.find((entry) => entry.dept === "PK" && entry.itemCode === FG2);
  assert.deepEqual([pkNew.mode, pkNew.diff, pkNew.kind], ["new", 2, "FG"], "a packing job for the new product");
  const raisedShared = plan.jobs.filter((entry) => entry.mode === "raise");
  assert.ok(raisedShared.length > 0 && raisedShared.every((entry) => shared.has(`${entry.dept}|${entry.itemCode}`)), "the shared parts raise their existing jobs");
  assert.ok(plan.jobs.filter((entry) => entry.mode === "new").every((entry) => !shared.has(`${entry.dept}|${entry.itemCode}`)), "new jobs only for pairs the order does not have");
  A.addJobsForChanges(d, { orderId: "SA-X2" }, plannerRf());
  assert.ok(pairsUnique(d, "SA-X2"), "still one job per department and item");
  const created = jobsOfOrder(d, "SA-X2").find((job) => job.dept === "PK" && job.itemCode === FG2);
  assert.deepEqual([created.status, created.qtyDone, created.qtyPlanned, created.qtyRequired, created.externalRef, created.fgCodes], ["queued", 0, 2, 2, null, [FG2]], "shaped like a released job");
  A.removeOrderItem(d, { orderId: "SA-X2", fgCode: FG2 }, ctx("sa"));
  assert.deepEqual(planOf(d, "SA-X2").jobs, [], "a removed product opens nothing and closes nothing");
});

test("extra jobs: a closed job, a work order past planning or an unknown work order list block the button; a planned work order is raised with its job", () => {
  const d = fresh();
  startedOrder(d, "SA-X3", 3);
  A.updateOrderItem(d, { orderId: "SA-X3", fgCode: FG, qty: 5 }, ctx("sa"));
  const bg = jobsOfOrder(d, "SA-X3").find((job) => job.dept === "BG");
  bg.status = "done";
  assert.deepEqual(planOf(d, "SA-X3").blockers, [`งาน BG ${bg.itemCode} ปิดแล้ว — เปิดใบใหม่สำหรับส่วนเพิ่ม`]);
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X3" }, plannerRf()), /เปิดงานเพิ่มไม่ได้: งาน BG .* ปิดแล้ว/);
  bg.status = "queued";
  const rb = jobsOfOrder(d, "SA-X3").find((job) => job.dept === "RB");
  rb.externalRef = { system: "rubberflow", woId: "WO-T1", kg: 5 };
  assert.match(planOf(d, "SA-X3", null).blockers[0], /ยังโหลดข้อมูล RubberFlow ไม่ได้/);
  assert.match(planOf(d, "SA-X3", [{ id: "WO-T1", sourceJobId: rb.id, status: "released" }]).blockers[0], /WO-T1 ที่ปล่อยหรือเริ่มผลิตแล้ว เพิ่มยอดไม่ได้ — เปิดใบใหม่สำหรับส่วนเพิ่ม/);
  const planned = planOf(d, "SA-X3", [{ id: "WO-T1", sourceJobId: rb.id, status: "planned" }]);
  assert.deepEqual([planned.blockers, planned.jobs.find((entry) => entry.dept === "RB").woId], [[], "WO-T1"]);
  // ใบที่ฝ่ายขายยกเลิกกลางทาง / ไม่อยู่ในสถานะผลิต: ปฏิเสธ
  A.cancelOrder(d, { orderId: "SA-X3", reason: "ลูกค้ายกเลิก" }, ctx("sa"));
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X3" }, plannerRf([{ id: "WO-T1", sourceJobId: rb.id, status: "planned" }])), /ฝ่ายขายยกเลิกใบนี้แล้ว/);
  saOrder(d, "SA-X4", { send: true });
  rejects(() => A.addJobsForChanges(d, { orderId: "SA-X4" }, plannerRf()), /เฉพาะใบที่ปล่อยผลิตแล้ว/);
});

// ผ่าน store จริงกับ Supabase จำลอง: SA-M1 งาน RB ผูก WO-M1 (planned) · SA-M2 งาน RB ผูก WO-M2 (in_progress) และงาน BG ปิดแล้ว · ฝ่ายขายเพิ่มจำนวน 3 → 5 ทั้งสองใบ
function extraJobsScene({ noWeight = false, odd = false } = {}) {
  const rbIds = {};
  const prepare = (d) => {
    for (const pi of ["SA-M1", "SA-M2"]) {
      startedOrder(d, pi, 3);
      A.updateOrderItem(d, { orderId: pi, fgCode: FG, qty: 5 }, ctx("sa"));
      const rb = jobsOfOrder(d, pi).find((job) => job.dept === "RB");
      rb.externalRef = { system: "rubberflow", woId: pi === "SA-M1" ? "WO-M1" : "WO-M2", kg: 4 };
      rbIds[pi] = rb.id;
    }
    d.orderRequests = [];
    jobsOfOrder(d, "SA-M2").find((job) => job.dept === "BG").status = "done";
    // กิโลกรัมของ WO คำนวณไม่ได้ (ไม่มี กก./เส้น น้ำหนัก หรือบรรทัด BOM เป็น kg)
    if (noWeight) for (const item of d.items.filter((row) => row.kind === "RB")) { item.rubber = { ...item.rubber, kgPerRoll: 0 }; item.weightG = 0; }
    // งาน RB อื่นของ SA-M1 ที่ไม่มี WO (ปิดแล้ว / ยังรอคิว): เปิดงานเพิ่มต้องไม่เปิด WO ให้
    if (odd) {
      const rb = jobsOfOrder(d, "SA-M1").find((job) => job.dept === "RB");
      d.jobs.push({ ...rb, id: "JOB-ODD-1", itemCode: "RB-DM01-02-OR01-202-18-70", status: "done", externalRef: null }, { ...rb, id: "JOB-ODD-2", itemCode: "RB-DM01-01-OR01-200-0-72", externalRef: null });
    }
  };
  const data = fresh();
  prepare(data);
  const wo = (id, status, sourceJobId) => ({ id, customer: "ลูกค้าฝ่ายขาย", customerPo: "SA", recipeId: "RC-1", recipeRevision: 1, productCode: "", uom: "rod", color: "ดำ", targetQty: 2, producedQty: 0,
    startDate: NOW, dueDate: NOW + DAY, priority: "normal", note: "", status, sourceJobId, createdAt: NOW - DAY, createdBy: "x" });
  const rf = { version: 3, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) };
  rf.orders = [wo("WO-M1", "planned", rbIds["SA-M1"]), wo("WO-M2", "in_progress", rbIds["SA-M2"])];
  return mockScene({ prepare: (d) => { for (const list of LISTS) d[list] = data[list]; }, rf });
}

test("mock store: planning opens the extra jobs in one save — existing jobs raised, the planned work order follows; the database refuses sales, a production head, decreases, other fields and closed or started work", async () => {
  const s = extraJobsScene();
  await s.call("app_sandbox_enter", { p_persona_id: "persona-pp" });
  const woList = (await s.call("app_rf_master")).orders;
  const pp = await s.storeFor("persona-pp", { rfOrders: () => woList });
  const plan = A.helpers.extraJobsFor(pp.store.data(), orderOf(pp.store.data(), "SA-M1"), woList);
  assert.deepEqual(plan.blockers, []);
  const blocked = A.helpers.extraJobsFor(pp.store.data(), orderOf(pp.store.data(), "SA-M2"), woList).blockers;
  assert.equal(blocked.length, 2, blocked.join(" | "));
  const count = (await s.view()).jobs.filter((job) => job.orderId === "SA-M1").length;
  const run = pp.store.run("addJobsForChanges", { orderId: "SA-M1" });
  assert.equal(run.ok, true, run.error?.message);
  const saved = await run.saving;
  assert.equal(saved.ok, true, saved.error?.message);
  assert.deepEqual(Object.keys(pp.sent.at(-1).changes).sort(), ["jobs", "orders"], "the order row and the jobs travel together");
  const view = await s.view();
  assert.equal(view.jobs.filter((job) => job.orderId === "SA-M1").length, count, "no new row: every pair had a job");
  assert.equal(view.jobs.find((job) => job.orderId === "SA-M1" && job.dept === "PK").qtyPlanned, 5);
  const rb = view.jobs.find((job) => job.orderId === "SA-M1" && job.dept === "RB");
  const wo1 = (await s.call("app_rf_master")).orders.find((row) => row.id === "WO-M1");
  assert.deepEqual([wo1.status, wo1.targetQty, rb.externalRef.kg === wo1.targetKg], ["planned", rb.qtyPlanned - rb.qtyDone, true], "the planned work order takes the raised plan");
  assert.deepEqual(saved.rubberflow?.raised?.map((row) => row.woId) ?? [], ["WO-M1"]);
  const audit = (await s.call("app_bom_audit", { p_limit: 1 }))[0];
  assert.deepEqual([audit.action, audit.entries[0].action, audit.rubberflow?.raised], ["addJobsForChanges", "ฝ่ายวางแผนเปิดงานเพิ่มจากฝ่ายขายแก้ใบ", 1]);
  assert.equal(A.helpers.rubberflowNotice("addJobsForChanges", { orderId: "SA-M1" }, saved.rubberflow).text, "เปิดงานเพิ่มของ SA-M1 แล้ว · เพิ่มยอด WO-M1 ใน RubberFlow");

  // ฐานข้อมูลปฏิเสธ (payload ตรง)
  const row2 = await s.orderRow("SA-M2");
  const jobs2 = (await s.view()).jobs.filter((job) => job.orderId === "SA-M2");
  const pk2 = jobs2.find((job) => job.dept === "PK");
  const pay = (orderRow, jobs) => ({ orders: { upsert: [{ ...orderRow, explosion: [{ itemCode: FG, kind: "FG", level: 0, fgCode: FG, required: 5 }] }] }, jobs: { upsert: jobs } });
  const raisePk = pay(row2, [{ ...pk2, qtyPlanned: pk2.qtyPlanned + 1 }]);
  assert.equal(await codeOf(s.save("persona-sa", "addJobsForChanges", raisePk)), "BOM_FORBIDDEN", "sales cannot open jobs (coarse gate)");
  assert.equal(await codeOf(s.save("persona-pkh", "addJobsForChanges", raisePk)), "BOM_FORBIDDEN", "nor a production head");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...pk2, qtyPlanned: pk2.qtyPlanned - 1 }]))), "BOM_INVALID_JOB", "a decrease is refused");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...pk2, qtyPlanned: pk2.qtyPlanned + 1, name: "ชื่อใหม่" }]))), "BOM_INVALID_JOB", "another field is refused");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay({ ...row2, note: "แก้หมายเหตุ" }, [{ ...pk2, qtyPlanned: pk2.qtyPlanned + 1 }]))), "BOM_INVALID_ORDER", "the order changes only its explosion");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", { ...raisePk, customers: { upsert: [{ name: "ลูกค้า", country: "Thailand", orderType: "SA", note: "" }] } })), "BOM_INVALID_PAYLOAD", "orders and jobs only");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...pk2, id: "JOB-NEW-X", qtyPlanned: 1, qtyDone: 0, status: "queued", reports: [] }]))), "BOM_INVALID_JOB", "a second row for the same department and item is refused");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...pk2, id: "JOB-NEW-Y", itemCode: FG2, qtyPlanned: 1, qtyDone: 1, status: "queued", reports: [] }]))), "BOM_INVALID_JOB", "a new job starts empty");
  const bg2 = jobs2.find((job) => job.dept === "BG");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...bg2, qtyPlanned: bg2.qtyPlanned + 1 }]))), "BOM_INVALID_TRANSITION", "a closed job is not reopened");
  const rb2 = jobs2.find((job) => job.dept === "RB");
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", pay(row2, [{ ...rb2, qtyPlanned: rb2.qtyPlanned + 1 }]))), "BOM_INVALID_TRANSITION", "nor a job whose work order is past planning");
  assert.ok((await s.save("persona-pp", "addJobsForChanges", raisePk)).data, "the plain raise is accepted");
});

test("mock store: opening extra jobs opens work orders only for the RB jobs it creates — other RB jobs of the order without one (closed or queued) are left alone", async () => {
  const s = extraJobsScene({ odd: true });
  await s.call("app_sandbox_enter", { p_persona_id: "persona-pp" });
  const woList = (await s.call("app_rf_master")).orders;
  const pp = await s.storeFor("persona-pp", { rfOrders: () => woList });
  const run = pp.store.run("addJobsForChanges", { orderId: "SA-M1" });
  assert.equal(run.ok, true, run.error?.message);
  const saved = await run.saving;
  assert.equal(saved.ok, true, saved.error?.message);
  assert.deepEqual([saved.rubberflow?.opened ?? [], saved.rubberflow?.skipped ?? []], [[], []], "no work order is opened or even tried for jobs this call did not create");
  const view = await s.view();
  assert.deepEqual(view.jobs.filter((job) => job.id.startsWith("JOB-ODD-")).map((job) => [job.id, job.externalRef ?? null]).sort((x, y) => x[0].localeCompare(y[0])), [["JOB-ODD-1", null], ["JOB-ODD-2", null]]);
  assert.equal((await s.call("app_rf_master")).orders.filter((wo) => ["JOB-ODD-1", "JOB-ODD-2"].includes(wo.sourceJobId)).length, 0);
});

test("mock: a planned work order whose kilograms cannot be computed is not raised (BOM_INVALID_TRANSITION, like the database)", async () => {
  const s = extraJobsScene({ noWeight: true });
  const row = await s.orderRow("SA-M1");
  const rb = (await s.view()).jobs.find((job) => job.orderId === "SA-M1" && job.dept === "RB");
  const payload = { orders: { upsert: [{ ...row, explosion: [{ itemCode: FG, kind: "FG", level: 0, fgCode: FG, required: 5 }] }] }, jobs: { upsert: [{ ...rb, qtyPlanned: rb.qtyPlanned + 1 }] } };
  assert.equal(await codeOf(s.save("persona-pp", "addJobsForChanges", payload)), "BOM_INVALID_TRANSITION");
  assert.equal((await s.call("app_rf_master")).orders.find((wo) => wo.id === "WO-M1").targetQty, 2, "the work order is untouched");
});
