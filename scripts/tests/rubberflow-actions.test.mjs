import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// กฎธุรกิจของ RubberFlow (modules/rubberflow-actions.js) บนข้อมูลสาธิต (modules/rubberflow-seed.js): ทุก action ทำบนร่าง และ throw เมื่อกฎไม่ผ่าน
const require = createRequire(import.meta.url);
const rules = require("../../modules/rubberflow-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = rules;
const A = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = A;
const seed = require("../../modules/rubberflow-seed.js");

const NOW = Date.parse("2026-10-28T10:00:00+07:00");
const { DAY, HOUR } = rules;
const user = (role) => seed.USERS.find((row) => row.role === role);
const ctx = (role = "admin", now = NOW) => ({ now, user: user(role) });
const fresh = () => seed.buildSeed(NOW);
// สูตรผสมสองขั้น: ค่าตัวอย่างที่ฟอร์มสูตร/สถานีผสมส่งเป็น stages
const STAGES = [{ stage: 1, mixerTemp: 80, dumpTemp: 110, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 130, mixMin: 2 }];
const recipeForm = (over = {}) => ({ id: "RC-NEW", items: [{ materialCode: "ZNO", phr: "5" }], batchKg: "40", stages: STAGES, yieldPerKg: "3", ...over });
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });

test("the demo seed is deterministic and internally consistent", () => {
  const a = fresh();
  const b = fresh();
  assert.deepEqual(a, b, "same now → same data");
  assert.equal(a.orders.length, 5);
  assert.ok(a.lots.length > 40 && a.transfers.length > 30 && a.fgBoxes.length > 30);
  assert.equal(a.orders.filter((order) => order.status === "completed").length, 1, "order 1 is complete");
  assert.deepEqual(a.lots.filter((lot) => lot.qc === "hold").map((lot) => lot.stage), ["extrusion"], "one extrusion lot is held by the NCR");
  assert.equal(a.ncrs.filter((ncr) => ncr.status === "open").length, 1);
  assert.equal(a.requisitions.filter((req) => req.status === "weighing").length, 1, "one requisition is still on the scale");
  assert.equal(a.materialLots.filter((lot) => rules.lotState(lot, NOW) === "expired").length, 1);
  assert.equal(a.materialLots.filter((lot) => lot.status === "hold").length, 1);
  for (const transfer of a.transfers) assert.ok(transfer.remaining >= 0 && transfer.qtySent > 0, transfer.id);
  for (const lot of a.lots) assert.ok(lot.transferredQty <= lot.goodQty + 1e-9, lot.id);
  assert.ok(a.audit.length > 100 && a.audit.length <= 400);
  const empty = seed.emptyState();
  assert.equal(empty.users.length, 9);
  assert.deepEqual(empty.orders, []);
});

test("orders: only approved recipes, positive quantities and ordered dates; the status flow is enforced", () => {
  const d = fresh();
  rejects(() => A.createOrder(d, { recipeId: "RC-NR-AM01", customer: "x", targetQty: 1, startDate: NOW, dueDate: NOW }, ctx("planner")), /ยังไม่ได้รับอนุมัติ/);
  rejects(() => A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: " ", targetQty: 1, startDate: NOW, dueDate: NOW }, ctx("planner")), /ชื่อลูกค้า/);
  rejects(() => A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: "x", targetQty: 0, startDate: NOW, dueDate: NOW }, ctx("planner")), /มากกว่า 0/);
  rejects(() => A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: "x", targetQty: 1, startDate: NaN, dueDate: NOW }, ctx("planner")), /วันเริ่มผลิต/);
  rejects(() => A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: "x", targetQty: 1, startDate: NOW, dueDate: NOW - DAY }, ctx("planner")), /ไม่ก่อนวันเริ่ม/);
  const id = A.createOrder(d, { recipeId: "RC-EPDM-DS01", customer: " ลูกค้าใหม่ ", customerPo: "PO-1", targetQty: "120", startDate: NOW, dueDate: NOW + DAY }, ctx("planner"));
  assert.match(id, new RegExp(`^WO-${rules.ymd(NOW)}-\\d\\d$`), "the id carries the local date of now (not tied to the machine's timezone)");
  const order = d.orders[0];
  assert.equal(order.id, id);
  assert.equal(order.customer, "ลูกค้าใหม่");
  assert.equal(order.targetQty, 120);
  assert.equal(order.uom, "m");
  assert.equal(order.status, "planned");
  assert.equal(d.audit[0].action, "เปิดใบสั่งผลิต");
  assert.equal(d.audit[0].user, user("planner").name);
  rejects(() => A.setOrderStatus(d, { id, status: "completed" }, ctx()), /เปลี่ยนสถานะจาก planned เป็น completed ไม่ได้/);
  A.setOrderStatus(d, { id, status: "released" }, ctx());
  A.setOrderStatus(d, { id, status: "on_hold" }, ctx());
  A.setOrderStatus(d, { id, status: "in_progress" }, ctx());
  rejects(() => A.setOrderStatus(d, { id, status: "cancelled" }, ctx()), /ไม่ได้/);
  rejects(() => A.setOrderStatus(d, { id: "nope", status: "released" }, ctx()), /ไม่พบใบสั่งผลิต/);
});

test("recipes: required fields, unique ids, at least one material, draft until approved once", () => {
  const d = fresh();
  rejects(() => A.createRecipe(d, recipeForm({ id: "" }), ctx("qc")), /กรุณากรอกรหัสสูตร/);
  rejects(() => A.createRecipe(d, recipeForm({ id: "RC-EPDM-DS01" }), ctx("qc")), /มีอยู่แล้ว/);
  rejects(() => A.createRecipe(d, recipeForm({ items: [{ materialCode: "ZNO", phr: "0" }] }), ctx("qc")), /อย่างน้อย 1 รายการ/);
  rejects(() => A.createRecipe(d, recipeForm({ batchKg: "" }), ctx("qc")), /น้ำหนักต่อ batch/);
  // ผสมสองขั้น: ต้องมีครบทั้งสองขั้น อุณหภูมิ 0–1000 °C เวลา (นาที) > 0
  rejects(() => A.createRecipe(d, recipeForm({ stages: undefined }), ctx("qc")), /อุณหภูมิเครื่องผสม ขั้น 1/);
  rejects(() => A.createRecipe(d, recipeForm({ stages: [STAGES[0]] }), ctx("qc")), /อุณหภูมิเครื่องผสม ขั้น 2/);
  rejects(() => A.createRecipe(d, recipeForm({ stages: [STAGES[0], { ...STAGES[1], dumpTemp: "" }] }), ctx("qc")), /Dump temp ขั้น 2/);
  rejects(() => A.createRecipe(d, recipeForm({ stages: [STAGES[0], { ...STAGES[1], mixMin: "0" }] }), ctx("qc")), /เวลาผสม ขั้น 2/);
  rejects(() => A.createRecipe(d, recipeForm({ stages: [{ ...STAGES[0], mixerTemp: 1200 }, STAGES[1]] }), ctx("qc")), /0–1000/);
  rejects(() => A.createRecipe(d, recipeForm({ productCode: "P".repeat(61) }), ctx("qc")), /รหัสสินค้า/);
  A.createRecipe(d, recipeForm({ id: " RC-NEW ", items: [{ materialCode: "ZNO", phr: "5", stage: "2" }, { materialCode: "STA", phr: "1" }, { materialCode: "", phr: 9 }], stages: [STAGES[1], STAGES[0]], dumpTol: "", restHours: "" }), ctx("qc"));
  const recipe = d.recipes.find((row) => row.id === "RC-NEW");
  assert.deepEqual(recipe.items, [{ materialCode: "ZNO", phr: 5, stage: 2 }, { materialCode: "STA", phr: 1, stage: 1 }], "each line has a stage, default 1");
  assert.deepEqual(recipe.stages, STAGES, "stages are stored in order 1, 2");
  assert.equal(recipe.productCode, "", "the product code is optional and no longer defaults to the recipe id");
  assert.ok(!("name" in recipe) && !("productName" in recipe) && !("mixSec" in recipe) && !("dumpTemp" in recipe), "no recipe name, product name, seconds or single dump temp");
  assert.deepEqual(rules.recipeLines(recipe).map((line) => [line.materialCode, line.stage]), [["STA", 1], ["ZNO", 2]], "recipe lines are grouped by stage");
  assert.equal(recipe.dumpTol, 5, "defaults");
  assert.equal(recipe.restHours, 4);
  assert.equal(recipe.status, "draft");
  A.approveRecipe(d, { id: "RC-NEW" }, ctx("manager"));
  assert.equal(recipe.status, "approved");
  assert.equal(recipe.approvedBy, user("manager").name);
  rejects(() => A.approveRecipe(d, { id: "RC-NEW" }, ctx("manager")), /อนุมัติแล้ว/);
});

test("requisitions allocate FEFO, reserve kilos promised to open requisitions, and refuse when stock is short", () => {
  const d = fresh();
  const released = d.orders.find((order) => order.status === "released");
  rejects(() => A.createRequisition(d, { orderId: d.orders.find((order) => order.status === "planned").id, batches: 1 }, ctx("store")), /ปล่อยผลิต/);
  rejects(() => A.createRequisition(d, { orderId: released.id, batches: 0 }, ctx("store")), /1–10/);
  rejects(() => A.createRequisition(d, { orderId: released.id, batches: 11 }, ctx("store")), /1–10/);
  const id = A.createRequisition(d, { orderId: released.id, batches: 2 }, ctx("store"));
  const req = d.requisitions.find((row) => row.id === id);
  assert.equal(req.status, "weighing");
  assert.equal(req.totalKg, 120);
  const recipe = d.recipes.find((row) => row.id === released.recipeId);
  for (const line of rules.recipeLines(recipe)) {
    const got = req.lines.filter((row) => row.materialCode === line.materialCode).reduce((sum, row) => sum + row.targetKg, 0);
    assert.ok(Math.abs(got - line.kgPerBatch * 2) < 1e-9, line.materialCode);
  }
  for (const line of req.lines) {
    const lot = d.materialLots.find((row) => row.lotNo === line.lotNo);
    assert.equal(rules.lotState(lot, NOW), "available", "no expired or held lot is issued");
  }
  // ล็อต EPDM ที่จะหมดอายุก่อนถูกหยิบก่อน
  const epdm = req.lines.filter((line) => line.materialCode === "EPDM-55");
  const soonest = d.materialLots.filter((lot) => lot.materialCode === "EPDM-55" && rules.lotState(lot, NOW) === "available").sort((a, b) => a.expiry - b.expiry)[0];
  assert.equal(epdm[0].lotNo, soonest.lotNo);
  // สต็อกพร้อมใช้ไม่พอ (ล็อตที่เหลือเล็กกว่าที่ใบเบิกเปิดอยู่จองไว้แล้ว + ที่ต้องใช้) → ปฏิเสธทั้งใบ ไม่สร้างใบเบิกครึ่งเดียว
  const reservedEpdm = req.lines.filter((line) => line.materialCode === "EPDM-55").reduce((sum, line) => sum + line.targetKg, 0);
  d.materialLots.filter((lot) => lot.materialCode === "EPDM-55").forEach((lot) => { lot.qtyKg = Math.min(lot.qtyKg, reservedEpdm); });
  const count = d.requisitions.length;
  rejects(() => A.createRequisition(d, { orderId: released.id, batches: 10 }, ctx("store")), /สต็อกไม่พอตามหลัก FEFO: EPDM-55 ขาด/);
  assert.equal(d.requisitions.length, count);
});

test("weighing is Poka-Yoke: outside ±1.5% is refused, blocked lots are refused, and the last line issues the stock", () => {
  const d = fresh();
  const req = d.requisitions.find((row) => row.status === "weighing");
  const index = req.lines.findIndex((line) => line.actualKg === null);
  const line = req.lines[index];
  const tol = rules.weighTolerance(line.targetKg);
  rejects(() => A.weighLine(d, { reqId: req.id, index, actualKg: line.targetKg + tol * 2 }, ctx("store")), /นอกเกณฑ์/);
  rejects(() => A.weighLine(d, { reqId: req.id, index, actualKg: "" }, ctx("store")), /กรุณาระบุน้ำหนัก/);
  rejects(() => A.weighLine(d, { reqId: req.id, index: 99, actualKg: 1 }, ctx("store")), /ไม่พบรายการชั่ง/);
  const lot = d.materialLots.find((row) => row.lotNo === line.lotNo);
  lot.status = "hold";
  rejects(() => A.weighLine(d, { reqId: req.id, index, actualKg: line.targetKg }, ctx("store")), /ใช้ไม่ได้แล้ว/);
  lot.status = "available";
  const before = Object.fromEntries(req.lines.map((row) => [row.lotNo, d.materialLots.find((item) => item.lotNo === row.lotNo).qtyKg]));
  req.lines.forEach((row, i) => { if (row.actualKg === null) A.weighLine(d, { reqId: req.id, index: i, actualKg: row.targetKg }, ctx("store")); });
  assert.equal(req.status, "issued");
  assert.equal(req.issuedBy, user("store").name);
  for (const row of req.lines) {
    const stock = d.materialLots.find((item) => item.lotNo === row.lotNo).qtyKg;
    assert.ok(stock <= before[row.lotNo], `${row.lotNo} was drawn down`);
  }
  rejects(() => A.weighLine(d, { reqId: req.id, index: 0, actualKg: 1 }, ctx("store")), /ชั่งครบแล้ว/);
});

test("receiving material needs a future expiry and positive quantity; hold/release toggles the lot", () => {
  const d = fresh();
  rejects(() => A.receiveMaterial(d, { materialCode: "nope", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /เลือกวัตถุดิบ/);
  rejects(() => A.receiveMaterial(d, { materialCode: "ZNO", qtyKg: 0, expiry: NOW + DAY }, ctx("store")), /มากกว่า 0/);
  rejects(() => A.receiveMaterial(d, { materialCode: "ZNO", qtyKg: 5, expiry: NOW - 1 }, ctx("store")), /อนาคต/);
  const lotNo = A.receiveMaterial(d, { materialCode: "ZNO", qtyKg: "5", expiry: NOW + 30 * DAY, coa: "yes" }, ctx("store"));
  const lot = d.materialLots.find((row) => row.lotNo === lotNo);
  assert.match(lotNo, new RegExp(`^RM-ZNO-${rules.ymd(NOW)}-\\d\\d$`));
  assert.equal(lot.location, "ห้องเคมี D-1", "default storage of the material");
  assert.equal(lot.coa, true);
  A.setMaterialLotStatus(d, { lotNo, status: "hold" }, ctx("qc"));
  assert.equal(rules.lotState(lot, NOW), "hold");
  A.setMaterialLotStatus(d, { lotNo, status: "available" }, ctx("qc"));
  assert.equal(lot.status, "available");
  rejects(() => A.setMaterialLotStatus(d, { lotNo, status: "shipped" }, ctx("qc")), /ไม่ถูกต้อง/);
});

test("mixing consumes an issued requisition, auto-holds on dump temperature and starts the rest clock; rest gates the transfer", () => {
  const d = fresh();
  const req = d.requisitions.find((row) => row.status === "weighing");
  req.lines.forEach((row, i) => { if (row.actualKg === null) A.weighLine(d, { reqId: req.id, index: i, actualKg: row.targetKg }, ctx("store")); });
  const issued = req.lines.reduce((sum, row) => sum + row.actualKg, 0);
  const recipe = d.recipes.find((row) => row.id === req.recipeId);
  const onSpec = recipe.stages.map((row) => ({ stage: row.stage, mixerTemp: row.mixerTemp, dumpTemp: row.dumpTemp, mixMin: row.mixMin }));
  rejects(() => A.recordMixing(d, { reqId: req.id, stages: onSpec, outputKg: issued + 1 }, ctx("mixer")), /เกินวัตถุดิบที่จ่าย/);
  rejects(() => A.recordMixing(d, { reqId: req.id, stages: [onSpec[0]], outputKg: 1 }, ctx("mixer")), /อุณหภูมิเครื่องผสม ขั้น 2/);
  rejects(() => A.recordMixing(d, { reqId: req.id, stages: [onSpec[0], { ...onSpec[1], mixMin: "" }], outputKg: 1 }, ctx("mixer")), /เวลาผสม ขั้น 2/);
  const bothOut = onSpec.map((row) => ({ ...row, dumpTemp: row.dumpTemp + recipe.dumpTol + 1 }));
  const lotId = A.recordMixing(d, { reqId: req.id, machine: "BM-02 Banbury 110L", shift: "N", stages: bothOut, outputKg: issued - 1, scrapKg: "0.5" }, ctx("mixer"));
  const lot = d.lots.find((row) => row.id === lotId);
  assert.equal(lot.qc, "hold", "dump temp outside the recipe window holds the lot");
  assert.deepEqual(lot.params.stages, bothOut, "the lot records mixer temp, dump temp and minutes of both stages");
  assert.equal(lot.holdReasons.length, 2, "each stage out of tolerance adds a reason");
  assert.match(lot.holdReasons[0], /Dump temp ขั้น 1/);
  assert.match(lot.holdReasons[1], /Dump temp ขั้น 2/);
  assert.equal(lot.readyAt, NOW + recipe.restHours * HOUR);
  assert.equal(req.status, "consumed");
  assert.equal(req.consumedBy, lotId);
  rejects(() => A.recordMixing(d, { reqId: req.id, stages: onSpec, outputKg: 1 }, ctx("mixer")), /ถูกใช้ไปแล้ว/);
  assert.equal(A.transferableQty(lot, NOW), 0, "held lots cannot move");
  rejects(() => A.createTransfer(d, { lotId, qty: 1 }, ctx("mixer")), /ยังไม่ผ่าน QC/);
  A.addQcRecord(d, { lotId, values: { t90: 3.2 }, result: "pass" }, ctx("qc"));
  assert.equal(lot.qc, "pass");
  rejects(() => A.createTransfer(d, { lotId, qty: 1 }, ctx("mixer")), /ยังบ่มไม่ครบเวลา/);
  assert.equal(A.transferableQty(lot, NOW + recipe.restHours * HOUR), +lot.goodQty.toFixed(3));
  A.endRest(d, { lotId }, ctx("mixer"));
  assert.equal(A.transferableQty(lot, NOW), +lot.goodQty.toFixed(3));
  const transferId = A.createTransfer(d, { lotId, qty: +lot.goodQty.toFixed(3) }, ctx("mixer"));
  assert.equal(d.transfers[0].id, transferId);
  assert.equal(d.transfers[0].to, "extrusion");
  rejects(() => A.createTransfer(d, { lotId, qty: 1 }, ctx("mixer")), /ปริมาณส่งมอบต้องอยู่ระหว่าง 0–0/);
});

test("mixing hold rule: each stage's dump temp is compared with the recipe's value for that stage (one shared tolerance)", () => {
  const cases = [
    { label: "both stages in tolerance", delta: [0, 0], hold: [] },
    { label: "edge of the window is still in", delta: "edge", hold: [] },
    { label: "only stage 1 out", delta: [7, 0], hold: [1] },
    { label: "only stage 2 out", delta: [0, -7], hold: [2] },
    { label: "the two stages values swapped", delta: "swap", hold: [1, 2] },
  ];
  for (const { label, delta, hold } of cases) {
    const d = fresh();
    const req = d.requisitions.find((row) => row.status === "weighing");
    req.lines.forEach((row, i) => { if (row.actualKg === null) A.weighLine(d, { reqId: req.id, index: i, actualKg: row.targetKg }, ctx("store")); });
    const issued = req.lines.reduce((sum, row) => sum + row.actualKg, 0);
    const recipe = d.recipes.find((row) => row.id === req.recipeId);
    const [s1, s2] = recipe.stages;
    let temps;
    if (delta === "edge") temps = [s1.dumpTemp + recipe.dumpTol, s2.dumpTemp - recipe.dumpTol];
    else if (delta === "swap") temps = [s2.dumpTemp, s1.dumpTemp];
    else temps = [s1.dumpTemp + delta[0] * (recipe.dumpTol / 6), s2.dumpTemp + delta[1] * (recipe.dumpTol / 6)];
    const stages = [{ ...s1, dumpTemp: temps[0] }, { ...s2, dumpTemp: temps[1] }];
    const lotId = A.recordMixing(d, { reqId: req.id, stages, outputKg: issued - 1 }, ctx("mixer"));
    const lot = d.lots.find((row) => row.id === lotId);
    assert.equal(lot.qc, hold.length ? "hold" : "pass", label);
    assert.deepEqual(lot.holdReasons.map((reason) => Number(/ขั้น (\d)/.exec(reason)[1])), hold, label);
  }
});

test("the gatekeeper: a station can only consume a transfer it received, within the received quantity", () => {
  const d = fresh();
  const transfer = d.transfers.find((row) => row.status === "in_transit" && row.to === "finishing");
  rejects(() => A.recordFinishing(d, { transferId: transfer.id, useQty: 10, passedQty: 10, perBox: 10 }, ctx("finisher")), /Gatekeeper: ต้องกดรับมอบงานก่อน/);
  rejects(() => A.receiveTransfer(d, { id: transfer.id, qtyReceived: transfer.qtySent * 1.03 }, ctx("finisher")), /\+2%/);
  A.receiveTransfer(d, { id: transfer.id, qtyReceived: transfer.qtySent - 3, condition: "ภาชนะชำรุด" }, ctx("finisher"));
  assert.equal(transfer.status, "received");
  assert.equal(transfer.remaining, transfer.qtySent - 3);
  rejects(() => A.receiveTransfer(d, { id: transfer.id, qtyReceived: 1 }, ctx("finisher")), /รับไปแล้ว/);
  rejects(() => A.recordFinishing(d, { transferId: transfer.id, useQty: transfer.remaining + 1, passedQty: 1, perBox: 10 }, ctx("finisher")), /เกินที่รับมา/);
  rejects(() => A.recordCuring(d, { transferId: transfer.id, useQty: 1, moldId: "MD-OR-24", temp: 200, time: 150, pressure: 150, goodQty: 1 }, ctx("curer")), /ไม่ได้ส่งมาที่สถานีนี้/);
});

test("extrusion caps rework at 10%, auto-holds out-of-spec dimensions and counts die usage", () => {
  const d = fresh();
  // ยางที่ยังบ่มอยู่ → ข้ามเวลาบ่ม ส่งต่อ 10 kg และรับมอบที่สถานีฉีด
  const mixing = d.lots.find((lot) => lot.stage === "mixing" && lot.qc === "pass" && lot.transferredQty < lot.goodQty);
  A.endRest(d, { lotId: mixing.id }, ctx("mixer"));
  const transferId = A.createTransfer(d, { lotId: mixing.id, qty: 10 }, ctx("mixer"));
  A.receiveTransfer(d, { id: transferId, qtyReceived: 10 }, ctx("extruder"));
  const transfer = d.transfers.find((row) => row.id === transferId);
  const base = { transferId: transfer.id, useKg: 5, machine: "EX-11 Extruder Ø90", shift: "D", dieId: "DIE-DS-01", thickness: 2.5, width: 18, weightPerM: 160, goodQty: 30, scrapQty: 1 };
  rejects(() => A.recordExtrusion(d, { ...base, reworkKg: 1 }, ctx("extruder")), /ยางหมุนเวียน 16\.7% เกิน 10%/);
  // ตรวจหัวดายหลังหักจากใบส่งมอบ: ในแอปทุก action ทำบนร่างที่ clone ไว้ (store.run) ร่างที่ล้มเหลวจึงถูกทิ้ง เทสต์นี้จึง clone เอง
  rejects(() => A.recordExtrusion(structuredClone(d), { ...base, dieId: "nope" }, ctx("extruder")), /ไม่พบหัวดาย/);
  const die = d.molds.find((mold) => mold.id === "DIE-DS-01");
  const usage = die.usageSinceClean;
  const lotId = A.recordExtrusion(d, { ...base, thickness: 2.7 }, ctx("extruder"));
  const lot = d.lots.find((row) => row.id === lotId);
  assert.equal(lot.qc, "hold");
  assert.deepEqual(lot.holdReasons, ["ความหนา 2.7 mm นอกสเปก"]);
  assert.equal(die.usageSinceClean, usage + 30);
  assert.equal(transfer.remaining, +(transfer.qtyReceived - 5).toFixed(3));
  assert.equal(lot.sources[0].lotId, transfer.lotId, "genealogy points at the mixing lot");
});

test("curing checks good + scrap against the input, auto-holds on temperature and counts mold shots", () => {
  const d = fresh();
  // ล็อตฉีดที่ถูกกักกันในชุดสาธิต: QC ผ่านแล้วส่งต่อไปอบและรับมอบ
  const held = d.lots.find((lot) => lot.stage === "extrusion" && lot.qc === "hold");
  A.addQcRecord(d, { lotId: held.id, values: { hardness: 65 }, result: "pass" }, ctx("qc"));
  const sendQty = A.transferableQty(held, NOW);
  const transferId = A.createTransfer(d, { lotId: held.id, qty: sendQty }, ctx("extruder"));
  A.receiveTransfer(d, { id: transferId, qtyReceived: sendQty }, ctx("curer"));
  const transfer = d.transfers.find((row) => row.id === transferId);
  assert.ok(transfer.remaining >= 100, "enough to cure 100 pieces");
  const base = { transferId: transfer.id, useQty: 100, moldId: "MD-OR-24", shift: "E", temp: 200, time: 150, pressure: 150, goodQty: 98, scrapQty: 2 };
  rejects(() => A.recordCuring(d, { ...base, goodQty: 99 }, ctx("curer")), /ต้องไม่เกินปริมาณที่นำเข้าอบ/);
  const mold = d.molds.find((row) => row.id === "MD-OR-24");
  const shots = mold.usageSinceClean;
  const lotId = A.recordCuring(d, { ...base, temp: 210 }, ctx("curer"));
  const lot = d.lots.find((row) => row.id === lotId);
  assert.equal(lot.qc, "hold");
  assert.deepEqual(lot.holdReasons, ["อุณหภูมิอบ 210 °C นอกสเปก"]);
  assert.equal(mold.usageSinceClean, shots + Math.ceil(100 / 24));
  assert.equal(lot.machine, mold.name);
});

test("finishing creates numbered boxes, counts passed quantity into the order and completes it when the target is reached", () => {
  const d = fresh();
  const transfer = d.transfers.find((row) => row.status === "in_transit" && row.to === "finishing");
  A.receiveTransfer(d, { id: transfer.id, qtyReceived: transfer.qtySent }, ctx("finisher"));
  const order = d.orders.find((row) => row.id === transfer.orderId);
  order.producedQty = order.targetQty - 50;
  rejects(() => A.recordFinishing(d, { transferId: transfer.id, useQty: 100, passedQty: 100, perBox: 0 }, ctx("finisher")), /ต่อกล่องต้องมากกว่า 0/);
  rejects(() => A.recordFinishing(d, { transferId: transfer.id, useQty: 100, passedQty: 99, scrapQty: 2, perBox: 10 }, ctx("finisher")), /ต้องไม่เกินปริมาณที่รับเข้า/);
  const lotId = A.recordFinishing(d, { transferId: transfer.id, useQty: 100, passedQty: 95, scrapQty: 5, perBox: 30, grade: "A", qcResult: "pass", shift: "D" }, ctx("finisher"));
  const lot = d.lots.find((row) => row.id === lotId);
  assert.equal(lot.boxes, 4, "30 + 30 + 30 + 5");
  const boxes = d.fgBoxes.filter((box) => box.lotId === lotId);
  assert.deepEqual(boxes.map((box) => box.qty).sort((a, b) => a - b), [5, 30, 30, 30]);
  assert.ok(boxes.every((box) => box.status === "in_stock" && box.id.startsWith(lotId.replace("FN", "BOX"))));
  assert.equal(order.producedQty, order.targetQty + 45);
  assert.equal(order.status, "completed", "reaching the target completes the order");
  // ล็อตที่กักกันไว้นับเข้าใบสั่งผลิตเมื่อ QC ผ่านเท่านั้น
  const d2 = fresh();
  const t2 = d2.transfers.find((row) => row.status === "in_transit" && row.to === "finishing");
  A.receiveTransfer(d2, { id: t2.id, qtyReceived: t2.qtySent }, ctx("finisher"));
  const o2 = d2.orders.find((row) => row.id === t2.orderId);
  const produced = o2.producedQty;
  const held = A.recordFinishing(d2, { transferId: t2.id, useQty: 20, passedQty: 20, perBox: 20, qcResult: "hold" }, ctx("finisher"));
  assert.equal(o2.producedQty, produced);
  assert.equal(d2.fgBoxes.find((box) => box.lotId === held).status, "hold");
  A.addQcRecord(d2, { lotId: held, values: { hardness: 65 }, result: "pass" }, ctx("qc"));
  assert.equal(o2.producedQty, produced + 20, "counted once it passes");
  assert.equal(d2.fgBoxes.find((box) => box.lotId === held).status, "in_stock");
  rejects(() => A.shipBoxes(d2, { ids: [] }, ctx("store")), /เลือกกล่อง/);
  const inStock = d2.fgBoxes.filter((box) => box.status === "in_stock").slice(0, 2).map((box) => box.id);
  A.shipBoxes(d2, { ids: inStock }, ctx("store"));
  assert.ok(inStock.every((id) => d2.fgBoxes.find((box) => box.id === id).status === "shipped"));
  rejects(() => A.shipBoxes(d2, { ids: inStock }, ctx("store")), /ไม่พร้อมส่ง/);
});

test("QC records judge from the measured values, cannot pass with a value out of spec, and NCRs hold lots until closed with a corrective action", () => {
  const d = fresh();
  const held = d.lots.find((lot) => lot.qc === "hold");
  rejects(() => A.addQcRecord(d, { lotId: held.id, values: {} }, ctx("qc")), /อย่างน้อย 1 รายการ/);
  rejects(() => A.addQcRecord(d, { lotId: held.id, values: { hardness: 80 }, result: "pass" }, ctx("qc")), /ตัดสินเป็น "ผ่าน" ไม่ได้/);
  rejects(() => A.addQcRecord(d, { lotId: held.id, values: { hardness: 65 }, result: "weird" }, ctx("qc")), /ไม่ถูกต้อง/);
  const auto = A.addQcRecord(d, { lotId: held.id, values: { hardness: "80", tensile: "" } }, ctx("qc"));
  const record = d.qcRecords.find((row) => row.id === auto);
  assert.deepEqual(record.tests, [{ key: "hardness", value: 80, pass: false }]);
  assert.equal(record.result, "hold", "out of spec → hold when no verdict is given");
  assert.equal(held.qc, "hold");
  A.addQcRecord(d, { lotId: held.id, values: { hardness: 65 } }, ctx("qc"));
  assert.equal(held.qc, "pass");
  assert.deepEqual(held.holdReasons, []);
  // NCR
  const passing = d.lots.find((lot) => lot.qc === "pass" && lot.stage === "curing");
  rejects(() => A.createNcr(d, { title: "", lotId: passing.id }, ctx("qc")), /หัวข้อปัญหา/);
  rejects(() => A.createNcr(d, { title: "x", lotId: " " }, ctx("qc")), /ล็อตที่พบปัญหา/);
  const ncrId = A.createNcr(d, { title: "รอยขีด", lotId: passing.id, stage: "curing", whys: ["a", "", "b"], defectQty: "3" }, ctx("qc"));
  assert.equal(passing.qc, "hold");
  assert.deepEqual(passing.holdReasons, [`เปิด ${ncrId}`]);
  const ncr = d.ncrs.find((row) => row.id === ncrId);
  assert.deepEqual(ncr.whys, ["a", "b"]);
  assert.equal(ncr.defectQty, 3);
  assert.equal(ncr.severity, "major");
  rejects(() => A.closeNcr(d, { id: ncrId, verification: "ok" }, ctx("qc")), /Corrective action/);
  ncr.corrective = "แก้แล้ว";
  A.closeNcr(d, { id: ncrId, verification: "ติดตามแล้ว" }, ctx("qc"));
  assert.equal(ncr.status, "closed");
  assert.equal(ncr.closedBy, user("qc").name);
  rejects(() => A.closeNcr(d, { id: ncrId }, ctx("qc")), /ปิดแล้ว/);
});

test("cleaning a mold resets its counter and every action leaves an audit entry with the actor", () => {
  const d = fresh();
  const mold = d.molds[0];
  mold.usageSinceClean = 999;
  A.cleanMold(d, { id: mold.id }, ctx("extruder"));
  assert.equal(mold.usageSinceClean, 0);
  assert.equal(mold.lastCleanAt, NOW);
  assert.deepEqual(d.audit[0], { at: NOW, user: user("extruder").name, action: "บันทึกทำความสะอาดแม่พิมพ์/หัวดาย", detail: mold.id });
  rejects(() => A.cleanMold(d, { id: "nope" }, ctx()), /ไม่พบแม่พิมพ์/);
  A.cleanMold(d, { id: mold.id }, { now: NOW, user: null });
  assert.equal(d.audit[0].user, "ระบบ", "no user → ระบบ");
  for (let i = 0; i < 400; i += 1) A.cleanMold(d, { id: mold.id }, ctx());
  assert.equal(d.audit.length, 400, "the audit trail is capped");
});

// ---------- ใบสั่งซื้อวัตถุดิบ ----------
const remoteCtx = (flags, now = NOW) => ({ now, user: { name: "ผู้ทดสอบ", ...flags }, remote: true });
const poLine = (code, over = {}) => ({ materialCode: code, needKg: 50, availableKg: 20, shortageKg: 30, qtyKg: 40, ...over });

test("materials carry a safety stock (kg) and a shelf life (days): defaults 0 and 180, kept when not sent, validated when sent", () => {
  const d = fresh();
  A.saveMaterial(d, { code: "NEW-1", name: "ใหม่" }, ctx("planner"));
  const created = d.materials.find((row) => row.code === "NEW-1");
  assert.deepEqual([created.safetyKg, created.shelfLifeDays], [0, 180]);
  A.saveMaterial(d, { code: "NEW-1", name: "ใหม่", safetyKg: "25.5", shelfLifeDays: "365" }, ctx("planner"));
  assert.deepEqual([created.safetyKg, created.shelfLifeDays], [25.5, 365]);
  A.saveMaterial(d, { code: "NEW-1", name: "ใหม่ แก้ชื่อ" }, ctx("planner"));
  assert.deepEqual([created.safetyKg, created.shelfLifeDays], [25.5, 365], "not sent = kept");
  A.saveMaterial(d, { code: "NEW-1", name: "x", safetyKg: "", shelfLifeDays: " " }, ctx("planner"));
  assert.deepEqual([created.safetyKg, created.shelfLifeDays], [25.5, 365], "blank = kept");
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", safetyKg: -1 }, ctx("planner")), /สต็อกขั้นต่ำ/);
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", safetyKg: "abc" }, ctx("planner")), /สต็อกขั้นต่ำ/);
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", safetyKg: 1e9 + 1 }, ctx("planner")), /สต็อกขั้นต่ำ/);
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", shelfLifeDays: 0 }, ctx("planner")), /อายุการเก็บ/);
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", shelfLifeDays: 3651 }, ctx("planner")), /อายุการเก็บ/);
  rejects(() => A.saveMaterial(d, { code: "NEW-2", name: "x", shelfLifeDays: 1.5 }, ctx("planner")), /อายุการเก็บ/);
  assert.equal(d.materials.some((row) => row.code === "NEW-2"), false, "a refused save adds nothing");
});

test("a purchase order: one line per material with an order quantity, the edited safety stock goes to the materials, the number is PO-yyyymmdd-nn", () => {
  const d = fresh();
  const user = ctx("planner");
  rejects(() => A.createPurchaseOrder(d, { lines: [] }, user), /อย่างน้อย 1 รายการ/);
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("ZNO", { qtyKg: 0 })] }, user), /อย่างน้อย 1 รายการ/);
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("NOPE")] }, user), /ไม่พบวัตถุดิบ/);
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("ZNO"), poLine("ZNO")] }, user), /ซ้ำ/);
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("ZNO", { qtyKg: 2e9 })] }, user), /จำนวนสั่ง/);
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("ZNO", { needKg: -1 })] }, user), /ความต้องการ/);
  rejects(() => A.createPurchaseOrder(d, { lines: Array.from({ length: 101 }, (_, i) => poLine(`M${i}`)) }, user), /ไม่เกิน 100/);
  d.materials.find((row) => row.code === "STA").active = false;
  rejects(() => A.createPurchaseOrder(d, { lines: [poLine("STA")] }, user), /เลิกใช้/);
  assert.deepEqual(d.purchaseOrders ?? [], [], "refused: nothing was added");

  const id = A.createPurchaseOrder(d, {
    lines: [poLine("ZNO", { qtyKg: "40.12345", safetyKg: 7 }), poLine("CBS", { qtyKg: 5 }), poLine("S-80", { qtyKg: "" })],
    safety: { ZNO: "12", CBS: "3", "S-80": "9", "NR-SVR10": "4", STA: "99", NOPE: "5" },
    sourcePi: " PI-1 ", note: "  เร่งด่วน  ",
  }, user);
  assert.match(id, new RegExp(`^PO-${rules.ymd(NOW)}-01$`));
  const [po] = d.purchaseOrders;
  assert.deepEqual(po, {
    id, status: "ordered", sourcePi: "PI-1", sourceRequisition: null, note: "เร่งด่วน", createdAt: NOW, createdBy: user.user.name, cancelledAt: null,
    lines: [
      { materialCode: "ZNO", needKg: 50, availableKg: 20, shortageKg: 30, safetyKg: 12, qtyKg: 40.123, receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null },
      { materialCode: "CBS", needKg: 50, availableKg: 20, shortageKg: 30, safetyKg: 3, qtyKg: 5, receivedKg: null, lotNo: null, expiry: null, receivedAt: null, receivedBy: null },
    ],
  }, "the zero-quantity line is skipped; the safety map wins over the line's own value");
  const stock = (code) => d.materials.find((row) => row.code === code).safetyKg;
  assert.deepEqual([stock("ZNO"), stock("CBS"), stock("S-80"), stock("NR-SVR10")], [12, 3, 9, 4], "safety stock edited in the dialog is saved to the material, ordered or not");
  assert.equal(stock("STA") ?? 0, 0, "an inactive material is not touched");
  assert.ok(d.audit.some((row) => row.action === "สั่งซื้อวัตถุดิบ" && row.detail === `${id} 2 รายการ`));
  const second = A.createPurchaseOrder(d, { lines: [poLine("ZNO")], sourceRequisition: "ใบเบิก" }, user);
  assert.equal(second, `PO-${rules.ymd(NOW)}-02`);
  assert.equal(d.purchaseOrders[0].id, second, "newest first");
  assert.equal(d.purchaseOrders[0].sourceRequisition, "ใบเบิก");
});

test("receiving a purchase line makes one lot and closes that line; the order becomes received when every line is in; a line is received once", () => {
  const d = fresh();
  const planner = ctx("planner");
  const id = A.createPurchaseOrder(d, { lines: [poLine("ZNO", { qtyKg: 40 }), poLine("CBS", { qtyKg: 10 })] }, planner);
  const lotsBefore = d.materialLots.length;
  rejects(() => A.receivePurchaseLine(d, { id: "PO-NOPE", materialCode: "ZNO", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /ไม่พบใบสั่งซื้อ/);
  rejects(() => A.receivePurchaseLine(d, { id, materialCode: "TMTD", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /ไม่พบวัตถุดิบ TMTD ในใบสั่งซื้อ/);
  rejects(() => A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 0, expiry: NOW + DAY }, ctx("store")), /มากกว่า 0/);
  rejects(() => A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 5, expiry: NOW - 1 }, ctx("store")), /อนาคต/);
  assert.equal(d.materialLots.length, lotsBefore, "a refused receipt makes no lot");
  assert.equal(d.purchaseOrders[0].lines[0].receivedKg, null);

  // ST corrects the actual quantity and the expiry; the supplier defaults to the PO number
  const lotNo = A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: "38.5", expiry: NOW + 200 * DAY }, ctx("store"));
  const lot = d.materialLots.find((row) => row.lotNo === lotNo);
  assert.deepEqual([lot.materialCode, lot.qtyKg, lot.initialKg, lot.expiry, lot.supplier, lot.status, lot.location], ["ZNO", 38.5, 38.5, NOW + 200 * DAY, id, "available", "ห้องเคมี D-1"]);
  const line = d.purchaseOrders[0].lines[0];
  assert.deepEqual([line.receivedKg, line.lotNo, line.expiry, line.receivedAt, line.receivedBy], [38.5, lotNo, NOW + 200 * DAY, NOW, user("store").name]);
  assert.equal(d.purchaseOrders[0].status, "ordered", "one line still open");
  rejects(() => A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /รับเข้าแล้ว/);
  rejects(() => A.cancelPurchaseOrder(d, { id }, planner), /รับเข้าแล้ว/);
  A.receivePurchaseLine(d, { id, materialCode: "CBS", qtyKg: 10, expiry: NOW + 100 * DAY, supplier: "ผู้ขาย ก" }, ctx("store"));
  assert.equal(d.materialLots.at(-1).supplier, "ผู้ขาย ก");
  assert.equal(d.purchaseOrders[0].status, "received");
  rejects(() => A.receivePurchaseLine(d, { id, materialCode: "CBS", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /รับครบแล้ว/);
  rejects(() => A.cancelPurchaseOrder(d, { id }, planner), /รับครบแล้ว/);

  // a cancelled order cannot be received; cancel only before any receipt
  const other = A.createPurchaseOrder(d, { lines: [poLine("ZNO")] }, planner);
  A.cancelPurchaseOrder(d, { id: other }, planner);
  const cancelled = d.purchaseOrders.find((row) => row.id === other);
  assert.deepEqual([cancelled.status, cancelled.cancelledAt], ["cancelled", NOW]);
  rejects(() => A.receivePurchaseLine(d, { id: other, materialCode: "ZNO", qtyKg: 1, expiry: NOW + DAY }, ctx("store")), /ถูกยกเลิกแล้ว/);
  rejects(() => A.cancelPurchaseOrder(d, { id: other }, planner), /ถูกยกเลิกไปแล้ว/);
  // the on-order quantity the purchase dialog subtracts follows the order: the cancelled and received ones no longer count
  const third = A.createPurchaseOrder(d, { lines: [poLine("ZNO", { qtyKg: 25 })] }, planner);
  assert.ok(third);
  const onOrder = rules.chemicalNeeds({ ...d, orders: [{ id: "W", status: "planned", recipeId: "RC-EPDM-DS01", recipeRevision: 3, targetKg: 60 }] }, ["W"], NOW).rows.find((row) => row.materialCode === "ZNO");
  assert.equal(onOrder.onOrderKg, 25);
});

test("purchasing rights on the database accounts: RB members and the planner group order, ST and the planner group receive, only the planner group cancels", () => {
  const planner = { planner: true };
  const rb = { rb: true };
  const st = { st: true };
  const qa = { qa: true };
  const d = fresh();
  const make = (flags) => A.createPurchaseOrder(d, { lines: [poLine("ZNO")] }, remoteCtx(flags));
  assert.ok(make(planner));
  assert.ok(make(rb));
  for (const flags of [st, qa, {}]) rejects(() => make(flags), /ไม่มีสิทธิ์: สั่งซื้อวัตถุดิบได้โดย/);
  const id = d.purchaseOrders[0].id;
  for (const flags of [rb, qa, {}]) rejects(() => A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 1, expiry: NOW + DAY }, remoteCtx(flags)), /ไม่มีสิทธิ์: รับวัตถุดิบเข้าคลัง/);
  assert.ok(A.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 1, expiry: NOW + DAY }, remoteCtx(st)));
  const open = d.purchaseOrders[1].id;
  for (const flags of [rb, st, qa]) rejects(() => A.cancelPurchaseOrder(d, { id: open }, remoteCtx(flags)), /ไม่มีสิทธิ์: ยกเลิกใบสั่งซื้อได้โดยฝ่ายวางแผน/);
  assert.equal(A.cancelPurchaseOrder(d, { id: open }, remoteCtx(planner)), open);
  // the demo mode checks no rights in the actions, as before
  assert.ok(A.createPurchaseOrder(d, { lines: [poLine("ZNO")] }, ctx("viewer")));
});
