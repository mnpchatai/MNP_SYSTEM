import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// คลังแท่งยาว SR (ขั้น 05–06 ของผังงาน · 20261202010000_bom_sr_rod_store.sql): กฎ (modules/bom-rules.js) · คำสั่ง (modules/bom-actions.js) · store (modules/bom-store.js)
// และ Supabase จำลองของ harness (scripts/pilot-harness-mock.mjs) ต้องตอบรหัสเดียวกับฐานข้อมูลทุกข้อ (pgTAP คู่กัน: supabase/tests/database/bom_sr_rod_store.test.sql)
// ข้อมูลสาธิต (modules/bom-seed.js addRodDemo): ใบ DEMO-26006 ฮูล่า 60 ชุด ต้องใช้ RB-DM02-02-YE03-204-19-34 36 เส้น · L0 = สต็อกกลาง 6 เส้น (ใบ DEMO-26008 ที่ปิดแล้ว)
// L1 = รับแล้ว 20 เส้นเป็นของใบ (งาน 20/36) · L2 = รอรับ 12 เส้น · L3 = รอรับ 8 เส้น (มีสเปกขนาดทั้งสามล็อต)
// L4 = รับนอกใบสั่ง 15 เส้นของ RB-DM02-02-BK01-225-3-20 ที่ B-01 (สต็อกกลาง · 20261204010000_bom_sr_store_module.sql) · ทุกการรับเข้าต้องมีตำแหน่งจัดเก็บ
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const rules = globalThis.MNP_BOM_RULES;
const A = globalThis.MNP_BOM_ACTIONS;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-11-18T10:00:00+07:00");
const RB = "RB-DM02-02-YE03-204-19-34";
const lotId = (n) => `5e1d0000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PASS = { thickness: 7.5, width: 34.1, weightPerM: 1205 };
const FAIL = { thickness: 7.95, width: 34.1, weightPerM: 1205 };
const user = (role, dept = role.toUpperCase()) => seed.USERS.find((row) => row.role === role) ?? { id: `u-${role}`, role, dept, name: `ทดสอบ ${role}` };
const ctx = (role, extra = {}) => ({ now: NOW, user: user(role), ...extra });
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const fresh = () => seed.buildSeed(NOW);
const job06 = (d) => d.jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "RB");
const lot = (d, n) => d.rodLots.find((row) => row.id === lotId(n));
const plain = (value) => JSON.parse(JSON.stringify(value));

test("rules: balances per bucket, free stock counts closed and cancelled orders, FIFO takes the order's own bucket first and the oldest lot first", () => {
  const data = {
    orders: [{ id: "A", status: "in_progress", releasedAt: 1 }, { id: "B", status: "completed", releasedAt: 2 }, { id: "C", status: "cancelled", releasedAt: 3 }],
    rodLots: [{ id: "L1", lotNo: "FN-2", itemCode: RB, status: "stored", receivedAt: 20 }, { id: "L2", lotNo: "FN-1", itemCode: RB, status: "stored", receivedAt: 10 }, { id: "L3", lotNo: "FN-3", itemCode: RB, status: "held", receivedAt: 5 }],
    rodMoves: [
      { lotId: "L1", itemCode: RB, kind: "receive", qty: 5, ownerOrderId: "A" }, { lotId: "L1", itemCode: RB, kind: "receive", qty: 3, ownerOrderId: null },
      { lotId: "L2", itemCode: RB, kind: "receive", qty: 4, ownerOrderId: "B" }, { lotId: "L2", itemCode: RB, kind: "receive", qty: 2, ownerOrderId: "C" },
      { lotId: "L1", itemCode: RB, kind: "issue", qty: -1, ownerOrderId: "A", forOrderId: "A" },
    ],
  };
  assert.deepEqual([rules.rodBalance(data.rodMoves, "L1", "A"), rules.rodBalance(data.rodMoves, "L1", null), rules.rodBalance(data.rodMoves, "L2", "B")], [4, 3, 4]);
  assert.equal(rules.rodFree(data, RB), 9, "null owner 3 + completed order 4 + cancelled order 2");
  assert.equal(rules.rodOwned(data, "A", RB), 4);
  assert.equal(rules.rodOwned(data, "B", RB), 0, "a closed order owns nothing: its bucket is free stock");
  // ของใบ A ก่อน แล้วสต็อกกลางเรียงล็อตที่รับก่อน (L2 รับก่อน L1): ใน L2 ใบที่ปิดก่อน (B) ก่อนใบที่ยกเลิกทีหลัง (C)
  assert.deepEqual(rules.rodFifo(data, RB, 9, { own: "A" }).rows.map((row) => [row.lotId, row.owner, row.qty]), [["L1", "A", 4], ["L2", "B", 4], ["L2", "C", 1]]);
  assert.deepEqual(rules.rodFifo(data, RB, 8).rows.map((row) => [row.lotId, row.owner, row.qty]), [["L2", "B", 4], ["L2", "C", 2], ["L1", null, 2]], "release takes free stock only, oldest lot first");
  assert.equal(rules.rodFifo(data, RB, 20).short, 11);
  assert.deepEqual(rules.rodSummary(data).map((row) => [row.itemCode, row.free, row.owned, row.held]), [[RB, 9, 4, 0]]);
});

test("rules: the dimension verdict follows the lot's spec (inclusive bounds, missing values, no spec)", () => {
  const spec = { thickness: { target: 2.5, tol: 0.1 }, width: { target: 18, tol: 0.25 } };
  assert.equal(rules.qcVerdict(spec, { thickness: 2.6, width: 18.25 }).result, "pass", "on the limit is a pass (no float slip)");
  assert.equal(rules.qcVerdict(spec, { thickness: 2.61, width: 18 }).result, "fail");
  assert.deepEqual(rules.qcVerdict(spec, { thickness: 2.5 }).missing, ["width"]);
  assert.equal(rules.qcVerdict(spec, { thickness: 2.5 }).result, null, "incomplete = no verdict yet");
  assert.deepEqual(rules.qcVerdict(null, { thickness: 2 }), { rows: [], missing: [], result: null }, "no spec: SR judges");
  assert.deepEqual(rules.qcVerdict(spec, { thickness: "2.55", width: "18" }).rows.map((row) => [row.key, row.label, row.pass]), [["thickness", "ความหนา", true], ["width", "ความกว้าง", true]]);
});

test("the demo seed has a stored lot of free stock, rods owned by DEMO-26006 and two pending lots with a spec", () => {
  const d = fresh();
  assert.deepEqual(d.rodLots.map((row) => [row.lotNo.slice(-2), row.orderId, row.status, row.qtySent, Boolean(row.spec)]), [["90", "DEMO-26008", "stored", 6, true], ["91", "DEMO-26006", "stored", 20, true], ["92", "DEMO-26006", "pending", 12, true], ["93", "DEMO-26006", "pending", 8, true], ["01", null, "stored", 15, false]]);
  assert.deepEqual(d.rodLots.map((row) => [row.location, row.source, row.sourceNote]), [["A-01", "order", null], ["A-02", "order", null], ["", "order", null], ["", "order", null], ["B-01", "opening", "ยกยอดจากการนับคลังครั้งแรก"]], "stored lots have a location, pending lots get one at receipt");
  assert.equal(rules.rodFree(d, RB), 6);
  assert.equal(rules.rodOwned(d, "DEMO-26006", RB), 20);
  assert.deepEqual([job06(d).qtyDone, job06(d).qtyPlanned, job06(d).status], [20, 36, "in_progress"]);
  const need = rules.rodIssueNeeds(d).find((row) => row.order.id === "DEMO-26006");
  assert.deepEqual([need.itemCode, need.need, need.issued, need.remaining, need.owned, need.free], [RB, 36, 0, 36, 20, 6], "GR of DEMO-26006 needs 36 rods");
  assert.deepEqual(seed.demoRfLinks(NOW).map((link) => link.qty), [36, 18], "the RubberFlow demo WOs are sized before the demo rods");
});

test("SR receives a lot that passes: the RB job counts it, rods within the job's need belong to the order and the rest is free stock", () => {
  const d = fresh();
  for (const role of ["gr", "rb", "wh", "qa", "pt"]) rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx(role)), /คลังยางเส้นยาว \(SR\) หรือฝ่ายวางแผน/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 13, values: PASS, location: "A-03" }, ctx("sr")), /ไม่เกินที่ส่งมา 12/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 0, values: PASS, location: "A-03" }, ctx("sr")), /มากกว่า 0/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: { thickness: 7.5 } }, ctx("sr")), /กรอกค่าที่วัดให้ครบ: ความกว้าง, น้ำหนักต่อเมตร/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: PASS, result: "fail" }, ctx("sr")), /ผลตรวจไม่ตรงกับค่าที่วัด/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: { ...PASS, thickness: -1 } }, ctx("sr")), /ความหนาต้องเป็นตัวเลขมากกว่า 0/);
  const out = A.receiveRods(d, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx("sr"));
  assert.equal(out.status, "stored");
  assert.deepEqual(out.request, [{ id: lotId(2), qtyReceived: 12, location: "A-03", qc: { values: PASS, result: "pass", note: "" } }], "the request row the store sends in rodLots");
  assert.equal(lot(d, 2).location, "A-03", "the lot keeps its storage location");
  assert.equal(out.section, "rodLots");
  assert.deepEqual([lot(d, 2).status, lot(d, 2).qtyReceived, lot(d, 2).receivedBy], ["stored", 12, "ศิริ รับมอบ"]);
  assert.deepEqual([job06(d).qtyDone, job06(d).status, job06(d).reports.at(-1).good, job06(d).reports.at(-1).note], [32, "in_progress", 12, `รับเข้าคลัง SR ผ่านตรวจ ล็อต ${lot(d, 2).lotNo}`]);
  assert.equal(rules.rodOwned(d, "DEMO-26006", RB), 32);
  rejects(() => A.receiveRods(d, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx("sr")), /แล้ว รับซ้ำไม่ได้/);
  // ไม่ผ่าน: กัก ไม่นับยอด ต้องมีหมายเหตุ
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(3), qtyReceived: 8, values: FAIL }, ctx("sr")), /กรุณาระบุหมายเหตุว่าไม่ผ่านเพราะอะไร/);
  A.receiveRods(d, { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" }, ctx("sr"));
  assert.deepEqual([lot(d, 3).status, lot(d, 3).qc.result, job06(d).qtyDone], ["held", "fail", 32]);
  assert.equal(d.rodMoves.filter((move) => move.lotId === lotId(3)).length, 0, "held rods never get moves");
});

test("QA decides a held lot: accept stores and credits with the overflow to free stock, return and scrap store nothing; SR may not decide", () => {
  const d = fresh();
  A.receiveRods(d, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx("sr"));
  A.receiveRods(d, { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" }, ctx("sr"));
  rejects(() => A.decideRods(structuredClone(d), { lotId: lotId(3), decision: "accept", note: "ใช้ได้" }, ctx("sr")), /ตรวจคุณภาพ \(QA\) หรือฝ่ายวางแผน/);
  rejects(() => A.decideRods(structuredClone(d), { lotId: lotId(3), decision: "accept", note: "ok" }, ctx("qa")), /อย่างน้อย 3 ตัวอักษร/);
  rejects(() => A.decideRods(structuredClone(d), { lotId: lotId(3), decision: "keep", note: "ใช้ได้" }, ctx("qa")), /เลือกผลตัดสิน/);
  rejects(() => A.decideRods(structuredClone(d), { lotId: lotId(2), decision: "accept", note: "ใช้ได้" }, ctx("qa")), /ไม่ได้กักรออยู่/);
  for (const [decision, status] of [["return", "returned"], ["scrap", "scrapped"]]) {
    const e = structuredClone(d);
    const out = A.decideRods(e, { lotId: lotId(3), decision, note: "เกินสเปกมาก" }, ctx("qa"));
    assert.deepEqual(out.request, [{ id: lotId(3), decision, decisionNote: "เกินสเปกมาก" }]);
    assert.deepEqual([lot(e, 3).status, job06(e).qtyDone, e.rodMoves.length], [status, 32, d.rodMoves.length]);
  }
  A.decideRods(d, { lotId: lotId(3), decision: "accept", note: "หนาเกินเล็กน้อย ใช้ตัดได้" }, ctx("qa"));
  assert.deepEqual([lot(d, 3).status, lot(d, 3).decision, job06(d).qtyDone, job06(d).status], ["stored", "accept", 40, "done"]);
  assert.match(job06(d).reports.at(-1).note, /เกิน 4 เข้าสต็อกกลาง$/);
  assert.deepEqual(d.rodMoves.filter((move) => move.lotId === lotId(3)).map((move) => [move.kind, move.qty, move.ownerOrderId]), [["receive", 4, "DEMO-26006"], ["receive", 4, null]]);
  assert.equal(rules.rodFree(d, RB), 10, "6 + the 4 beyond the job's need");
});

test("SR issues rods to GR oldest lot first, own bucket before free stock; a reversal puts them back once; SR and planners adjust (GR does not)", () => {
  const d = fresh();
  A.receiveRods(d, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx("sr"));
  rejects(() => A.issueRods(structuredClone(d), { orderId: "DEMO-26006", itemCode: RB, qty: 39 }, ctx("sr")), /ในคลังไม่พอ: ใบนี้ถือ 32 สต็อกกลาง 6/);
  rejects(() => A.issueRods(structuredClone(d), { orderId: "DEMO-26006", itemCode: RB, qty: 5 }, ctx("gr")), /คลังยางเส้นยาว \(SR\) หรือฝ่ายวางแผน/);
  rejects(() => A.issueRods(structuredClone(d), { orderId: "DEMO-26002", itemCode: RB, qty: 5 }, ctx("sr")), /ใบที่ปล่อยผลิตแล้ว/);
  const out = A.issueRods(d, { orderId: "DEMO-26006", itemCode: RB, qty: 34 }, ctx("sr"));
  assert.deepEqual(out.plan.map((row) => [row.lotNo.slice(-2), row.owner, row.qty]), [["91", "DEMO-26006", 20], ["92", "DEMO-26006", 12], ["90", null, 2]]);
  assert.ok(out.request.every((row) => row.kind === "issue" && row.forOrderId === "DEMO-26006" && row.qty < 0 && /^[0-9a-f-]{36}$/.test(row.id)));
  assert.equal(rules.rodIssued(d, "DEMO-26006", RB), 34);
  assert.deepEqual([rules.rodOwned(d, "DEMO-26006", RB), rules.rodFree(d, RB)], [0, 4]);
  const issue = d.rodMoves.find((move) => move.kind === "issue" && move.ownerOrderId === null);
  rejects(() => A.reverseRodIssue(structuredClone(d), { moveId: issue.id, note: "x" }, ctx("sr")), /อย่างน้อย 3 ตัวอักษร/);
  const back = A.reverseRodIssue(d, { moveId: issue.id, note: "จ่ายเกิน" }, ctx("sr"));
  assert.deepEqual(back.request.map((row) => [row.kind, row.reversesId, row.note]), [["unissue", issue.id, "จ่ายเกิน"]]);
  assert.deepEqual([rules.rodIssued(d, "DEMO-26006", RB), rules.rodFree(d, RB)], [32, 6]);
  rejects(() => A.reverseRodIssue(d, { moveId: issue.id, note: "อีกครั้ง" }, ctx("sr")), /ถูกย้อนไปแล้ว/);
  for (const role of ["gr", "rb", "qa"]) rejects(() => A.adjustRods(structuredClone(d), { lotId: lotId(0), qty: -1, note: "แท่งชำรุด" }, ctx(role)), /คลังยางเส้นยาว \(SR\) หรือฝ่ายวางแผนเท่านั้น/);
  rejects(() => A.adjustRods(structuredClone(d), { lotId: lotId(0), qty: -7, note: "แท่งชำรุด" }, ctx("planner")), /มีสต็อกกลาง 6 ลด 7 ไม่ได้/);
  rejects(() => A.adjustRods(structuredClone(d), { lotId: lotId(3), qty: 1, note: "นับเกิน" }, ctx("planner")), /ไม่ได้อยู่ในคลัง/);
  A.adjustRods(d, { lotId: lotId(0), qty: -1, note: "แท่งชำรุด" }, ctx("planner"));
  assert.equal(rules.rodFree(d, RB), 5);
  rejects(() => A.adjustRods(structuredClone(d), { lotId: lotId(0), qty: -1, note: "ab" }, ctx("sr")), /อย่างน้อย 3 ตัวอักษร/);
  const sr = A.adjustRods(d, { lotId: lotId(0), qty: -1, note: "นับจริงขาด 1" }, ctx("sr"));
  assert.deepEqual(sr.request.map((row) => [row.kind, row.qty, row.note]), [["adjust", -1, "นับจริงขาด 1"]], "SR adjusts free stock with a reason (20261204010000)");
  assert.equal(rules.rodFree(d, RB), 4);
});

test("a draft takes rods from the SR store at release (FIFO over free stock) and gives them back when reopened; the amount is capped by what is free", () => {
  const d = fresh();
  const draft = d.orders.find((row) => row.id === "DEMO-26002");
  const row = () => rules.rodStockForDraft(d, draft).find((entry) => entry.itemCode === RB);
  assert.deepEqual([row().stock, row().available, row().max, Math.ceil(row().required)], [6, 6, 6, 116]);
  rejects(() => A.setStockCount(structuredClone(d), { orderId: "DEMO-26002", itemCode: RB, qty: 7 }, ctx("planner")), /สต็อกกลางที่ใช้ได้กับใบนี้ 6/);
  A.setStockCount(d, { orderId: "DEMO-26002", itemCode: RB, qty: 5 }, ctx("planner"));
  assert.equal(d.audit[0].action, "ใช้จากคลังยางเส้นยาว SR");
  assert.equal(rules.ROD_STOCK_AUDIT_TEXT, "ใช้จากคลังยางเส้นยาว SR", "the audit page names it by this text");
  assert.equal(rules.ROD_STOCK_AUDIT_TEXT_LEGACY, "ใช้จากคลังแท่งยาว SR", "rows written before the wording change keep the old text");
  const rbNet = rules.netRequirements(draft.explosion, draft.stockCounts).find((entry) => entry.itemCode === RB);
  assert.equal(rbNet.toMake, 110.2, "115.2 rods needed, 5 from the store");
  // ใบอื่นหยิบไปก่อน: ปล่อยไม่ได้ (ตัวเลขเปลี่ยน)
  const short = structuredClone(d);
  A.adjustRods(short, { lotId: lotId(0), qty: -2, note: "แท่งชำรุด" }, ctx("planner"));
  rejects(() => A.releaseOrder(short, { orderId: "DEMO-26002" }, ctx("planner")), /ตัวเลขเปลี่ยนไปแล้ว: คลังยางเส้นยาว \(SR\) มี RB-DM02-02-YE03-204-19-34 ว่าง 4/);
  A.releaseOrder(d, { orderId: "DEMO-26002" }, ctx("planner"));
  assert.equal(d.jobs.find((job) => job.orderId === "DEMO-26002" && job.dept === "RB").qtyPlanned, 111);
  assert.deepEqual(d.rodMoves.filter((move) => move.kind === "transfer").map((move) => [move.qty, move.ownerOrderId, move.forOrderId]), [[-5, null, "DEMO-26002"], [5, "DEMO-26002", "DEMO-26002"]]);
  assert.deepEqual([rules.rodFree(d, RB), rules.rodOwned(d, "DEMO-26002", RB)], [1, 5]);
  assert.match(d.audit[0].detail, /ใช้ยางเส้นยาวจากคลัง SR RB-DM02-02-YE03-204-19-34 × 5/);
  // เปิดกลับมาแก้ (ยังไม่มีงานเริ่ม): คืนเข้าสต็อกกลาง ยอดที่ตั้งไว้คงอยู่
  A.updateOrderItem(d, { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A", qty: 100 }, ctx("planner"));
  assert.equal(draft.status, "draft");
  assert.deepEqual([rules.rodFree(d, RB), rules.rodOwned(d, "DEMO-26002", RB), draft.stockCounts[RB]], [6, 0, 5]);
  assert.deepEqual(rules.rodTaken(d, "DEMO-26002"), [], "nothing left to give back");
});

test("only the planner group sets the use-from-SR-store amount; rods already issued to GR keep the order from going back to draft until SR reverses them", () => {
  const d = fresh();
  for (const role of ["st", "wh"]) rejects(() => A.setStockCount(structuredClone(d), { orderId: "DEMO-26002", itemCode: RB, qty: 1 }, ctx(role)), /ตั้งยอดที่ใช้จากคลังยางเส้นยาว \(SR\) ได้โดยฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.setStockCounts(structuredClone(d), { orderId: "DEMO-26002", counts: [{ itemCode: RB, qty: "1" }] }, ctx("st")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  A.setStockCount(d, { orderId: "DEMO-26002", itemCode: RB, qty: 5 }, ctx("planner"));
  A.releaseOrder(d, { orderId: "DEMO-26002" }, ctx("planner"));
  A.issueRods(d, { orderId: "DEMO-26002", itemCode: RB, qty: 2 }, ctx("sr"));
  const edit = { orderId: "DEMO-26002", fgCode: "DEMO-HL-24(B)-A", qty: 100 };
  rejects(() => A.updateOrderItem(structuredClone(d), edit, ctx("planner")), /คลังยางเส้นยาว \(SR\) จ่ายยางเส้นยาวให้ GR ตามใบนี้แล้ว 2 เส้น \(นับว่างานเริ่มแล้ว\)/);
  const issue = d.rodMoves.find((move) => move.kind === "issue" && move.forOrderId === "DEMO-26002");
  A.reverseRodIssue(d, { moveId: issue.id, note: "จ่ายก่อนแก้ใบ" }, ctx("sr"));
  A.updateOrderItem(d, edit, ctx("planner"));
  assert.equal(d.orders.find((row) => row.id === "DEMO-26002").status, "draft", "with nothing issued the planner reopens the order");
  assert.deepEqual([rules.rodFree(d, RB), rules.rodOwned(d, "DEMO-26002", RB)], [6, 0]);
});

test("the job supply limit counts a child job only up to its plan (rods beyond the need went to free stock)", () => {
  const d = fresh();
  const gr = d.jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "GR");
  const rb = job06(d);
  rb.qtyDone = 50;
  assert.equal(rules.jobSupplyLimit(d, gr), 180, "36 planned rods × 5 pieces, not 50 × 5");
  rb.qtyDone = 20;
  assert.equal(rules.jobSupplyLimit(d, gr), 100);
});

test("the remote store sends only the request rows of a rod action and leaves the moves to the server", () => {
  const d = fresh();
  const out = A.issueRods(d, { orderId: "DEMO-26006", itemCode: RB, qty: 3 }, ctx("sr", { remote: true }));
  assert.equal(d.rodMoves.length, fresh().rodMoves.length, "no local move rows in database mode");
  assert.equal(out.request.length, 1);
  assert.deepEqual(storeApi.ROD_ACTIONS, { receiveRods: "rodLots", decideRods: "rodLots", receiveRodsOpening: "rodLots", setRodLocation: "rodLots", issueRods: "rodMoves", reverseRodIssue: "rodMoves", adjustRods: "rodMoves" });
  assert.deepEqual(storeApi.diffMaster(fresh(), d, "issueRods"), {}, "rod lists are never diffed as records");
  assert.ok(storeApi.REMOTE_LISTS.includes("rodLots") && storeApi.REMOTE_LISTS.includes("rodMoves"));
  for (const code of ["BOM_INVALID_ROD", "BOM_ROD_EXCEEDS"]) assert.doesNotMatch(storeApi.mapRemoteError({ code }).message, /BOM_/, `${code} has a Thai message`);
  assert.equal(storeApi.roleOfEmployee({ role: { code: "staff" }, department: { code: "SR" } }), "sr");
  assert.equal(storeApi.homeOf({ role: "qa" }), "orders");
  // หน้า "คลังยางเส้นยาว" ของ BOM ย้ายไปโมดูล SR (#/sr): ไม่มีในเมนู รายการหน้า หรือสิทธิ์ของบทบาทใดใน BOM (#/bom?p=rods เปลี่ยนที่อยู่)
  assert.ok(!storeApi.MODULE_IDS.includes("rods") && !("rods" in storeApi.NAV_PARENT) && !storeApi.NAV.includes("rods"));
  for (const role of ["admin", "manager", "planner", "gr", "sr", "qa"]) assert.equal(storeApi.canSee({ role }, "rods"), false, `${role} has no BOM rods page`);
  assert.ok(!storeApi.canSee({ role: "sr" }, "jobs"));
});

// ---------- Supabase จำลองของ harness ----------
const BOM_KEY = "mnp-harness-bom-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
function mockScene() {
  const data = fresh();
  const lists = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves"];
  const master = { version: 1, epoch: "rod-e1", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(lists.map((list) => [list, data[list] ?? []])) };
  const storage = memoryStorage();
  storage.setItem(BOM_KEY, JSON.stringify(master));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const call = async (name, args) => { const { data: out, error } = await mock.client.rpc(name, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return out; };
  const as = (persona) => call("app_sandbox_enter", { p_persona_id: persona });
  const save = async (persona, action, changes) => {
    await as(persona);
    const base = (await call("app_bom_master")).version;
    const { data: out, error } = await mock.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: base, p_action: action, p_audit: [] });
    return error ? { code: error.code } : { data: out };
  };
  const master_ = () => call("app_bom_master");
  return { mock, call, as, save, master: master_ };
}
const receiveRow = (n, extra = {}) => ({ rodLots: { upsert: [{ id: lotId(n), qtyReceived: n === 2 ? 12 : 8, location: "A-03", qc: { values: PASS, result: "pass", note: "" }, ...extra }] } });
const codeOf = async (promise) => (await promise).code ?? "ok";

test("mock: SR receives and credits, other departments are refused, the shape and the spec verdict are checked like the database", async () => {
  const scene = mockScene();
  for (const persona of ["persona-rb", "persona-gr", "persona-wh", "persona-st"]) assert.equal(await codeOf(scene.save(persona, "receiveRods", receiveRow(2))), "BOM_FORBIDDEN", `${persona} may not receive`);
  assert.equal(await codeOf(scene.save("persona-qa", "receiveRods", receiveRow(2))), "BOM_FORBIDDEN", "QA decides, it does not receive");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { qc: { values: PASS, result: "fail", note: "ผิดรูป" } }))), "BOM_INVALID_ROD", "a result that disagrees with the spec");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { qc: { values: { thickness: 7.5 }, result: "pass", note: "" } }))), "BOM_INVALID_ROD", "a spec value is missing");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { qtyReceived: 13 }))), "BOM_INVALID_ROD", "more than sent");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(3, { qc: { values: FAIL, result: "fail", note: "" } }))), "BOM_INVALID_ROD", "a failed receipt needs a note");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", { rodMoves: { upsert: [{ id: lotId(2) }] } })), "BOM_INVALID_ROD", "the wrong section for the action");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", {})), "BOM_INVALID_ROD", "no request row");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", { rodLots: { delete: [{ id: lotId(2) }] } })), "BOM_INVALID_PAYLOAD");
  assert.equal(await codeOf(scene.save("persona-pp", "saveCustomer", receiveRow(2))), "BOM_INVALID_ROD", "rod sections only with rod actions");
  const ok = await scene.save("persona-sr", "receiveRods", receiveRow(2));
  assert.ok(ok.data, ok.code);
  const after = await scene.master();
  const job = after.jobs.find((row) => row.orderId === "DEMO-26006" && row.dept === "RB");
  assert.deepEqual([job.qtyDone, job.reports.at(-1).good, job.reports.at(-1).by], [32, 12, "ศิริ รับมอบ"]);
  assert.deepEqual(after.rodMoves.filter((move) => move.lotId === lotId(2)).map((move) => [move.kind, move.qty, move.ownerOrderId]), [["receive", 12, "DEMO-26006"]]);
  assert.deepEqual(ok.data.changes.rodLots.upsert.map((row) => [row.id, row.status]), [[lotId(2), "stored"]], "the delta brings the lot back");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2))), "BOM_INVALID_TRANSITION", "a stored lot cannot be received again");
  const audit = (await scene.call("app_bom_audit", {}))[0];
  assert.deepEqual([audit.action, audit.detail], ["receiveRods", "jobs +1, rodLots +1, rodMoves +1"]);
  // ไม่ผ่าน = กัก ไม่มีแถวประวัติ ไม่นับยอด
  assert.ok((await scene.save("persona-sr", "receiveRods", receiveRow(3, { qc: { values: FAIL, result: "fail", note: "ความหนาเกิน" } }))).data);
  const held = (await scene.master()).rodLots.find((row) => row.id === lotId(3));
  assert.deepEqual([held.status, held.qc.result], ["held", "fail"]);
  assert.equal((await scene.master()).rodMoves.filter((move) => move.lotId === lotId(3)).length, 0);
});

test("mock: a lot without a spec needs SR's own pass or fail", async () => {
  // ล็อตที่ไม่มีสเปก (สูตรไม่มีสเปกขนาด): สเปกมาจาก RubberFlow ตอนสร้างล็อต จึงตั้งที่ข้อมูลเริ่มต้นของฉากนี้
  const storage = memoryStorage();
  const data = fresh();
  data.rodLots.find((row) => row.id === lotId(2)).spec = null;
  const lists = ["orders", "jobs", "items", "rodLots", "rodMoves"];
  storage.setItem(BOM_KEY, JSON.stringify({ version: 1, epoch: "e", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(lists.map((list) => [list, data[list]])) }));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  await mock.client.rpc("app_sandbox_enter", { p_persona_id: "persona-sr" });
  const send = (qc) => mock.client.rpc("app_bom_save_master", { p_changes: { rodLots: { upsert: [{ id: lotId(2), qtyReceived: 12, location: "A-03", qc }] } }, p_base_version: 1, p_action: "receiveRods", p_audit: [] });
  assert.equal((await send({ values: {}, note: "" })).error.code, "BOM_INVALID_ROD", "no result, no spec");
  assert.equal((await send({ values: { thickness: null, width: 34 }, result: "pass", note: "" })).error, null, "SR's visual judgement is enough (a null measurement is skipped)");
  const stored = (await mock.client.rpc("app_bom_master")).data.rodLots.find((row) => row.id === lotId(2));
  assert.deepEqual(stored.qc.values, { width: 34 });
});

test("mock: QA accepts, returns or scraps a held lot; SR cannot decide; the accept credits with the overflow as free stock", async () => {
  for (const [decision, status] of [["accept", "stored"], ["return", "returned"], ["scrap", "scrapped"]]) {
    const scene = mockScene();
    await scene.save("persona-sr", "receiveRods", receiveRow(2));
    await scene.save("persona-sr", "receiveRods", receiveRow(3, { qc: { values: FAIL, result: "fail", note: "ความหนาเกิน" } }));
    const row = { rodLots: { upsert: [{ id: lotId(3), decision, decisionNote: "ตัดสินแล้ว" }] } };
    assert.equal(await codeOf(scene.save("persona-sr", "decideRods", row)), "BOM_FORBIDDEN", "SR may not decide");
    assert.equal(await codeOf(scene.save("persona-gr", "decideRods", row)), "BOM_FORBIDDEN");
    assert.equal(await codeOf(scene.save("persona-qa", "decideRods", { rodLots: { upsert: [{ id: lotId(3), decision, decisionNote: "ok" }] } })), "BOM_INVALID_ROD", "a reason of 3-300 characters");
    assert.equal(await codeOf(scene.save("persona-qa", "decideRods", { rodLots: { upsert: [{ id: lotId(2), decision, decisionNote: "ตัดสินแล้ว" }] } })), "BOM_INVALID_TRANSITION", "only a held lot");
    assert.ok((await scene.save("persona-qa", "decideRods", row)).data);
    const after = await scene.master();
    const job = after.jobs.find((entry) => entry.orderId === "DEMO-26006" && entry.dept === "RB");
    assert.equal(after.rodLots.find((entry) => entry.id === lotId(3)).status, status);
    if (decision === "accept") {
      assert.deepEqual([job.qtyDone, job.status], [40, "done"]);
      assert.deepEqual(after.rodMoves.filter((move) => move.lotId === lotId(3)).map((move) => [move.qty, move.ownerOrderId]).sort(), [[4, null], [4, "DEMO-26006"]]);
    } else assert.deepEqual([job.qtyDone, after.rodMoves.filter((move) => move.lotId === lotId(3)).length], [32, 0]);
  }
});

test("mock: issuing checks the bucket balance and the owner, a reversal is accepted once, SR and the planner group adjust", async () => {
  const scene = mockScene();
  const issue = (id, owner, qty, extra = {}) => ({ id, kind: "issue", lotId: lotId(1), ownerOrderId: owner, forOrderId: "DEMO-26006", itemCode: RB, qty, ...extra });
  const uuid = (n) => `9a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  assert.equal(await codeOf(scene.save("persona-gr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -5)] } })), "BOM_FORBIDDEN");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -21)] } })), "BOM_ROD_EXCEEDS", "more than the bucket holds");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -15), issue(uuid(2), "DEMO-26006", -6)] } })), "BOM_ROD_EXCEEDS", "rows of one command add up");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -5, { forOrderId: "DEMO-26007" })] } })), "BOM_INVALID_ROD", "another open order's bucket");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -5, { forOrderId: "DEMO-26002" })] } })), "BOM_INVALID_TRANSITION", "a draft cannot receive rods");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", 5)] } })), "BOM_INVALID_ROD", "an issue is negative");
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -5, { lotId: lotId(2) })] } })), "BOM_INVALID_TRANSITION", "a pending lot is not in the store");
  const free = { ...issue(uuid(3), null, -2), lotId: lotId(0) };
  const ok = await scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue(uuid(1), "DEMO-26006", -20), free] } });
  assert.ok(ok.data, ok.code);
  assert.deepEqual(ok.data.changes.rodMoves.upsert.map((row) => row.id).sort(), [uuid(1), uuid(3)], "the client's ids are kept");
  // คลังเดียวกันจากถังของใบที่ปิดแล้ว (DEMO-26008) ก็เป็นสต็อกกลาง
  const reverse = (id, reversesId, note = "จ่ายผิด") => ({ rodMoves: { upsert: [{ id, kind: "unissue", reversesId, note }] } });
  assert.equal(await codeOf(scene.save("persona-sr", "reverseRodIssue", reverse(uuid(4), uuid(3), "x"))), "BOM_INVALID_ROD", "a reason of 3-300 characters");
  assert.ok((await scene.save("persona-sr", "reverseRodIssue", reverse(uuid(4), uuid(3)))).data);
  assert.equal(await codeOf(scene.save("persona-sr", "reverseRodIssue", reverse(uuid(5), uuid(3)))), "BOM_INVALID_TRANSITION", "a second reversal is refused");
  assert.equal(await codeOf(scene.save("persona-sr", "reverseRodIssue", reverse(uuid(6), uuid(4)))), "BOM_INVALID_ROD", "only an issue row can be reversed");
  const moves = (await scene.master()).rodMoves;
  assert.deepEqual(moves.filter((move) => move.reversesId === uuid(3)).map((move) => [move.kind, move.qty, move.ownerOrderId, move.forOrderId, move.lotId]), [["unissue", 2, null, "DEMO-26006", lotId(0)]]);
  const adjust = (qty, extra = {}) => ({ rodMoves: { upsert: [{ id: uuid(7), kind: "adjust", lotId: lotId(0), qty, note: "นับจริง", ...extra }] } });
  for (const persona of ["persona-gr", "persona-rb", "persona-qa"]) assert.equal(await codeOf(scene.save(persona, "adjustRods", adjust(-1))), "BOM_FORBIDDEN", `${persona} may not adjust`);
  assert.equal(await codeOf(scene.save("persona-pp", "adjustRods", adjust(-7))), "BOM_ROD_EXCEEDS", "the free bucket stays >= 0");
  assert.equal(await codeOf(scene.save("persona-pp", "adjustRods", adjust(0))), "BOM_INVALID_ROD");
  assert.ok((await scene.save("persona-pp", "adjustRods", adjust(-1))).data);
  assert.equal(await codeOf(scene.save("persona-sr", "adjustRods", adjust(-1, { id: uuid(8), note: "ab" }))), "BOM_INVALID_ROD", "SR also needs a reason");
  assert.ok((await scene.save("persona-sr", "adjustRods", adjust(-1, { id: uuid(8), note: "นับจริงขาด" }))).data, "SR adjusts free stock (20261204010000)");
  assert.equal((await scene.master()).rodMoves.find((move) => move.id === uuid(8)).by, "ศิริ รับมอบ");
});

test("mock: SR and QA read BOM data; the release takes free rods FIFO or refuses BOM_ROD_EXCEEDS; reopening gives them back", async () => {
  for (const real of ["sr", "qa"]) {
    const { data, error } = await createMockSupabase({ real, now: () => NOW, storage: memoryStorage() }).client.rpc("app_bom_master");
    assert.equal(error, null, `real ${real} staff read BOM`);
    assert.ok(Array.isArray(data.rodLots) && Array.isArray(data.rodMoves));
  }
  const scene = mockScene();
  await scene.as("persona-pp");
  const before = await scene.master();
  const draft = before.orders.find((row) => row.id === "DEMO-26002");
  // ใช้ตัวคำนวณของหน้า (releaseOrder) สร้างแถวใบและงาน แล้วส่งแบบที่ store ส่ง
  const planner = { now: NOW, user: { id: "p", role: "planner", dept: "PK", name: "สมศรี วางแผน" }, remote: true, idSuffix: () => "abc123" };
  const releaseChanges = (counts) => {
    const d = plain({ ...before, counters: {}, audit: [], users: [] });
    d.orders.find((row) => row.id === "DEMO-26002").stockCounts = counts;
    A.releaseOrder(d, { orderId: "DEMO-26002" }, planner);
    return { orders: { upsert: d.orders.filter((row) => row.id === "DEMO-26002") }, jobs: { upsert: d.jobs.filter((row) => row.orderId === "DEMO-26002") } };
  };
  // ตั้งยอดเกินสต็อกกลางในใบร่างตรงๆ (ข้ามตัวตรวจของหน้า) → ปล่อยไม่ได้
  const tooMany = releaseChanges({ [RB]: 5 });
  tooMany.orders.upsert[0].stockCounts = { [RB]: 7 };
  assert.equal(await codeOf(scene.save("persona-pp", "setStockCount", { orders: { upsert: [{ ...draft, stockCounts: { [RB]: 7 } }] } })), "ok", "the database caps nothing at draft time");
  const stale = await scene.save("persona-pp", "releaseOrder", { orders: tooMany.orders, jobs: tooMany.jobs });
  assert.equal(stale.code, "BOM_ROD_EXCEEDS");
  assert.ok((await scene.save("persona-pp", "setStockCount", { orders: { upsert: [{ ...(await scene.master()).orders.find((row) => row.id === "DEMO-26002"), stockCounts: { [RB]: 5 } }] } })).data);
  const ok = releaseChanges({ [RB]: 5 });
  const released = await scene.save("persona-pp", "releaseOrder", { orders: ok.orders, jobs: ok.jobs });
  assert.ok(released.data, released.code);
  let master = await scene.master();
  assert.deepEqual(master.rodMoves.filter((move) => move.kind === "transfer").map((move) => [move.qty, move.ownerOrderId, move.forOrderId, move.lotId]).sort((a, b) => a[0] - b[0]), [[-5, null, "DEMO-26002", lotId(0)], [5, "DEMO-26002", "DEMO-26002", lotId(0)]]);
  assert.equal(rules.rodFree(master, RB), 1);
  // เปิดกลับมาแก้: แถวใบ released → draft (REV + 1) และงานถูกลบ
  const order = master.orders.find((row) => row.id === "DEMO-26002");
  const reopened = await scene.save("persona-pp", "updateOrderItem", { orders: { upsert: [{ ...order, status: "draft", revision: Number(order.revision) + 1, explodedAt: null }] } });
  assert.ok(reopened.data, reopened.code);
  master = await scene.master();
  assert.deepEqual([rules.rodFree(master, RB), rules.rodOwned(master, "DEMO-26002", RB)], [6, 0], "the taken rods are free again");
  assert.equal(master.rodMoves.filter((move) => move.kind === "transfer").length, 4);
});

test("mock: ST and WH cannot set the use-from-SR-store amount (planners can); rods issued to GR keep the order from going back to draft until reversed", async () => {
  const scene = mockScene();
  await scene.as("persona-pp");
  const before = await scene.master();
  const draft = before.orders.find((row) => row.id === "DEMO-26002");
  const se = draft.explosion.find((line) => line.kind === "SE").itemCode;
  const counts = (extra) => ({ orders: { upsert: [{ ...draft, stockCounts: { ...draft.stockCounts, ...extra } }] } });
  for (const persona of ["persona-st", "persona-wh"]) {
    assert.equal(await codeOf(scene.save(persona, "setStockCounts", counts({ [RB]: 2 }))), "BOM_FORBIDDEN", `${persona} may not set the RB amount`);
  }
  assert.equal(await codeOf(scene.save("persona-st", "setStockCounts", counts({ [se]: 3 }))), "ok", "ST still counts another part of the draft");
  const counted = (await scene.master()).orders.find((row) => row.id === "DEMO-26002");
  assert.ok((await scene.save("persona-pp", "setStockCounts", { orders: { upsert: [{ ...counted, stockCounts: { ...counted.stockCounts, [RB]: 5 } }] } })).data, "a planner sets it");
  // ปล่อยผลิตแบบที่ store ส่ง (หยิบ 5 เส้นจาก L0) แล้ว SR จ่าย 2 เส้นให้ GR ตามใบนี้
  const planner = { now: NOW, user: { id: "p", role: "planner", dept: "PK", name: "สมศรี วางแผน" }, remote: true, idSuffix: () => "abc123" };
  const d = plain({ ...(await scene.master()), counters: {}, audit: [], users: [] });
  A.releaseOrder(d, { orderId: "DEMO-26002" }, planner);
  const released = await scene.save("persona-pp", "releaseOrder", { orders: { upsert: d.orders.filter((row) => row.id === "DEMO-26002") }, jobs: { upsert: d.jobs.filter((row) => row.orderId === "DEMO-26002") } });
  assert.ok(released.data, released.code);
  const uuid = (n) => `9b000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const issued = await scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [{ id: uuid(1), kind: "issue", lotId: lotId(0), ownerOrderId: "DEMO-26002", forOrderId: "DEMO-26002", itemCode: RB, qty: -2, note: "จ่ายด่วน" }] } });
  assert.ok(issued.data, issued.code);
  assert.equal((await scene.master()).rodMoves.find((move) => move.id === uuid(1)).note, "จ่ายด่วน", "the issue keeps its note like the database");
  const reopen = async () => {
    const order = (await scene.master()).orders.find((row) => row.id === "DEMO-26002");
    return scene.save("persona-pp", "updateOrderItem", { orders: { upsert: [{ ...order, status: "draft", revision: Number(order.revision) + 1, explodedAt: null }] } });
  };
  assert.equal(await codeOf(reopen()), "BOM_INVALID_TRANSITION", "rods handed to GR count as work started");
  assert.ok((await scene.save("persona-sr", "reverseRodIssue", { rodMoves: { upsert: [{ id: uuid(2), kind: "unissue", reversesId: uuid(1), note: "จ่ายก่อนแก้ใบ" }] } })).data);
  const ok = await reopen();
  assert.ok(ok.data, ok.code);
  const master = await scene.master();
  assert.deepEqual([master.orders.find((row) => row.id === "DEMO-26002").status, rules.rodFree(master, RB), rules.rodOwned(master, "DEMO-26002", RB)], ["draft", 6, 0]);
});

test("ST and WH count only non-RB, non-product lines of the draft's explosion: a draft without an explosion or a code outside it is refused (page and mock)", async () => {
  // หน้า: ใบที่ยังไม่มีผลระเบิด (แก้สินค้าแล้ว) นับไม่ได้ · ฐานข้อมูลจำลองปฏิเสธเหมือน bom_save_orders
  const d = fresh();
  const draft = d.orders.find((row) => row.id === "DEMO-26002");
  draft.explosion = null;
  for (const role of ["st", "wh"]) rejects(() => A.setStockCount(structuredClone(d), { orderId: "DEMO-26002", itemCode: RB, qty: 5 }, ctx(role)), /ไม่อยู่ในใบ/);
  const scene = mockScene();
  await scene.as("persona-pp");
  const exploded = (await scene.master()).orders.find((row) => row.id === "DEMO-26002");
  const se = exploded.explosion.find((line) => line.kind === "SE").itemCode;
  const purchased = exploded.explosion.find((line) => line.kind === "PURCHASED")?.itemCode;
  assert.ok((await scene.save("persona-pp", "updateOrderItem", { orders: { upsert: [{ ...exploded, explosion: null, explodedAt: null }] } })).data, "the planner edits the draft (explosion cleared)");
  const cleared = (await scene.master()).orders.find((row) => row.id === "DEMO-26002");
  for (const key of [RB, ` ${RB.toLowerCase()} `, se]) {
    assert.equal(await codeOf(scene.save("persona-st", "setStockCounts", { orders: { upsert: [{ ...cleared, stockCounts: { ...cleared.stockCounts, [key]: 5 } }] } })), "BOM_FORBIDDEN", `no count of ${key} before the explosion exists`);
  }
  assert.ok((await scene.save("persona-pp", "explodeOrder", { orders: { upsert: [{ ...cleared, explosion: exploded.explosion, explodedAt: NOW }] } })).data);
  const again = (await scene.master()).orders.find((row) => row.id === "DEMO-26002");
  assert.deepEqual(again.stockCounts, cleared.stockCounts, "nothing slipped in before the recalculation");
  const set = (extra) => scene.save("persona-st", "setStockCounts", { orders: { upsert: [{ ...again, stockCounts: { ...again.stockCounts, ...extra } }] } });
  assert.equal(await codeOf(set({ "XX-NOT-IN-ORDER": 1 })), "BOM_FORBIDDEN", "a code outside the explosion");
  assert.equal(await codeOf(set({ [again.items[0].fgCode]: 1 })), "BOM_FORBIDDEN", "a product of the order");
  assert.equal(await codeOf(set({ [se]: 2, ...(purchased ? { [purchased]: 1 } : {}) })), "ok", "ST counts SE and purchased lines of an exploded draft");
});

test("mock: rod requests are checked in the database's order — the whole shape before rights, null measurements skipped, values up to 1e6; adjust keeps to free stock of the lot's own code", async () => {
  const scene = mockScene();
  // รูปคำขอผิดได้ BOM_INVALID_ROD ก่อนสิทธิ์ (GR ไม่มีสิทธิ์แต่ไม่ได้ BOM_FORBIDDEN)
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2, { qtyReceived: 0 }))), "BOM_INVALID_ROD");
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2, { id: "lot-2" }))), "BOM_INVALID_ROD", "the id must be a uuid");
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2, { qc: { values: PASS, note: "" } }))), "BOM_INVALID_ROD", "the result is part of the shape");
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2, { qc: { values: { ...PASS, width: 1e6 + 1 }, result: "fail", note: "กว้างเกิน" } }))), "BOM_INVALID_ROD", "a measurement above 1e6");
  assert.equal(await codeOf(scene.save("persona-gr", "decideRods", { rodLots: { upsert: [{ id: lotId(3), decision: "keep", decisionNote: "ตัดสินแล้ว" }] } })), "BOM_INVALID_ROD");
  assert.equal(await codeOf(scene.save("persona-gr", "issueRods", { rodMoves: { upsert: [{ id: "x", kind: "issue" }] } })), "BOM_INVALID_ROD");
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2))), "BOM_FORBIDDEN", "a well-formed request reaches the rights check");
  // ค่าที่วัดเป็น null = ไม่ได้วัด: ล็อตที่มีสเปกจึงขาดค่า
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { qc: { values: { ...PASS, width: null }, result: "pass", note: "" } }))), "BOM_INVALID_ROD", "a null measurement counts as not measured");
  const ok = await scene.save("persona-sr", "receiveRods", receiveRow(2, { id: lotId(2).toUpperCase() }));
  assert.ok(ok.data, ok.code);
  // ปรับยอด: เฉพาะสต็อกกลาง (ไม่มี ownerOrderId / forOrderId) รหัสต้องตรงกับล็อต
  const uuid = (n) => `9c000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const adjust = (extra) => ({ rodMoves: { upsert: [{ id: uuid(1), kind: "adjust", lotId: lotId(0), qty: -1, note: "นับจริง", ...extra }] } });
  assert.equal(await codeOf(scene.save("persona-pp", "adjustRods", adjust({ ownerOrderId: "DEMO-26008" }))), "BOM_INVALID_ROD", "not an order's bucket");
  assert.equal(await codeOf(scene.save("persona-pp", "adjustRods", adjust({ forOrderId: "DEMO-26006" }))), "BOM_INVALID_ROD", "not for an order");
  assert.equal(await codeOf(scene.save("persona-pp", "adjustRods", adjust({ itemCode: "RB-OTHER" }))), "BOM_INVALID_ROD", "not another code");
  assert.ok((await scene.save("persona-pp", "adjustRods", adjust({ itemCode: RB }))).data, "the lot's own code is fine");
});

test("mock: the store round trip — SR receives through the page store and the reply brings the credited job", async () => {
  const scene = mockScene();
  await scene.as("persona-sr");
  const status = await scene.call("app_sandbox_status");
  const persona = status.personas.find((row) => row.id === "persona-sr");
  const sent = [];
  const remote = {
    load: () => scene.call("app_bom_master"),
    save: (changes, baseVersion, action, audit, epoch) => { sent.push({ changes, action }); return scene.call("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }); },
    since: (version) => scene.call("app_bom_master_since", { p_version: version }),
  };
  const store = storeApi.createStore({ actions: A, now: () => NOW, remote, persona: () => storeApi.personaUser({ ...persona, isSandbox: true }) });
  await store.ensureLoaded();
  const run = store.run("receiveRods", { lotId: lotId(2), qtyReceived: "12", location: " A-03 ", values: { thickness: "7.5", width: "34.1", weightPerM: "1205" } });
  assert.equal(run.ok, true, run.error?.message);
  assert.equal((await run.saving).ok, true);
  assert.deepEqual(Object.keys(sent[0].changes), ["rodLots"], "only the request section is sent");
  assert.deepEqual(sent[0].changes.rodLots.upsert, [{ id: lotId(2), qtyReceived: 12, location: "A-03", qc: { values: PASS, result: "pass", note: "" } }]);
  assert.equal(store.data().rodLots.find((row) => row.id === lotId(2)).location, "A-03", "the reply brings the location back");
  const data = store.data();
  assert.equal(data.jobs.find((row) => row.orderId === "DEMO-26006" && row.dept === "RB").qtyDone, 32);
  assert.equal(data.rodMoves.filter((move) => move.lotId === lotId(2)).length, 1, "the server's move arrives once (no local copy)");
  // จ่ายให้ GR ผ่าน store: แถวคำขอเท่านั้น · ฐานข้อมูลเก็บ id ที่หน้าออกให้
  const issued = store.run("issueRods", { orderId: "DEMO-26006", itemCode: RB, qty: 3 });
  assert.equal(issued.ok, true, issued.error?.message);
  assert.equal((await issued.saving).ok, true);
  assert.deepEqual(Object.keys(sent[1].changes), ["rodMoves"]);
  assert.equal(rules.rodIssued(store.data(), "DEMO-26006", RB), 3);
  const adjusted = store.run("adjustRods", { lotId: lotId(0), qty: -1, note: "แท่งชำรุด" });
  assert.equal(adjusted.ok, true, adjusted.error?.message);
  assert.equal((await adjusted.saving).ok, true, "SR adjusts through the page store (20261204010000)");
  assert.deepEqual(Object.keys(sent[2].changes), ["rodMoves"]);
});

// ---------- หน้าจอ (โมดูลทั้งชุดใน context จำลองแบบเดียวกับ bom-pages.test.mjs) ----------
const FILES = [
  "modules/ui-icons.js", "modules/department-access.js",
  "modules/rubberflow-rules.js", "modules/rubberflow-derive.js", "modules/rubberflow-actions.js", "modules/rubberflow-seed.js", "modules/rubberflow-store.js",
  "modules/rubberflow-ui.js", "modules/rubberflow-pages-plan.js", "modules/rubberflow-pages-line.js", "modules/rubberflow-pages-quality.js", "modules/rubberflow-documents.js", "modules/module-rubberflow.js",
  "modules/bom-rules.js", "modules/bom-xlsx.js", "modules/bom-actions.js", "modules/bom-seed.js", "modules/bom-store.js", "modules/factory-kit.js", "modules/bom-pages.js", "modules/bom-hub.js", "modules/module-bom.js",
];
const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
async function page() {
  const fs = await import("node:fs");
  const vm = await import("node:vm");
  const context = vm.createContext({});
  const app = { innerHTML: "" };
  const log = { toasts: [], hash: "#/bom" };
  const node = () => ({ handlers: {}, dataset: {}, value: "", addEventListener(type, handler) { this.handlers[type] = handler; }, querySelector: () => null, querySelectorAll: () => [], focus() {}, insertAdjacentHTML() {} });
  const storage = new Map();
  Object.assign(context, {
    window: context, addEventListener() {}, escapeHtml, showToast: (message, kind) => log.toasts.push([message, kind ?? "ok"]), friendlyError: (error) => String(error?.message ?? error),
    renderRoute: async () => {}, confirmDialog: async () => true, URLSearchParams, Intl, Date, structuredClone, setInterval: () => 0, setTimeout: () => 0, encodeURIComponent,
    location: { get hash() { return log.hash; }, set hash(value) { log.hash = value; } }, app, state: { employee: { isSandbox: true } },
    shell: (content) => content, bindShell() {}, loadingShell() {}, renderNotFound() {},
    currentRoute: () => { const [path, query = ""] = log.hash.replace(/^#\/?/, "").split("?"); return { path, params: new URLSearchParams(query) }; },
    document: { querySelector: () => node(), querySelectorAll: () => [], body: node(), activeElement: null, createElement: () => node() },
    localStorage: { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) },
    MNP_REQUEST_MODULES: {}, TextDecoder, Uint8Array, DataView,
  });
  context.window.MNP_REQUEST_MODULES = context.MNP_REQUEST_MODULES;
  for (const file of FILES) vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
  // ตารางงานเดิม (#/bom?p=work) ถูกถอดออกจาก BOM แล้ว (งานอยู่ที่โมดูลของแต่ละแผนก และ #/bom?p=work เปลี่ยนที่อยู่ไปที่นั่น) แต่ตัววาดยังอยู่ให้เทสต์ใช้เป็นตัวอย่างของ workBoard / boardCards จึงวาดตรงๆ ที่นี่
  const render = async (query) => { log.hash = `#/bom?${query}`; app.innerHTML = ""; if (/(^|&)p=work(&|$)/.test(query)) app.innerHTML = context.MNP_BOM_PAGES.work(context.MNP_BOM.context(new URLSearchParams(query))).html; else await context.MNP_REQUEST_MODULES.BOM.pages.bom(new URLSearchParams(query)); return app.innerHTML; };
  return { context, log, render, store: context.MNP_BOM.store, ctx: (query = "") => context.MNP_BOM.context(new URLSearchParams(query)), dialogs: context.MNP_BOM_DIALOGS };
}
const clean = (html) => assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
const fakeInput = (key, value = "") => ({ value, dataset: { rodValue: key }, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } });

test("pages: SR's work board shows the pending lots and the GR issue card, QA gets the held lot, the planner switches to both boards", async () => {
  const env = await page();
  env.store.setUser("B11");
  let html = await env.render("p=work");
  clean(html);
  assert.match(html, /รับยางเส้นยาวเข้าคลัง ล็อต FN-\d{8}-92/);
  assert.match(html, /รับยางเส้นยาวเข้าคลัง ล็อต FN-\d{8}-93/);
  assert.equal((html.match(/data-rf-open="rodReceive"/g) ?? []).length, 2, "one card per pending lot");
  assert.match(html, /จ่ายยางเส้นยาวให้ GR ตามใบ DEMO-26006/);
  assert.match(html, /ต้องจ่าย 36 เส้น/);
  assert.match(html, /data-rf-open="rodIssue"/);
  assert.doesNotMatch(html, /p=rods/, "the long-rod store page is the SR module now: no link to the old BOM page");
  assert.doesNotMatch(html, /บัญชีนี้ไม่ได้อยู่ในแผนกผลิต/);
  // การ์ดจ่ายให้ GR: ทุกใบที่ปล่อยผลิตอยู่ซึ่งงาน GR ยังต้องใช้เส้นยางนั้น และคลังมีให้ (ของใบนั้นหรือสต็อกกลาง) = DEMO-26001 DEMO-26006 DEMO-26007 ของ RB-DM02-02-YE03 (สต็อกกลาง 6 เส้น)
  // และ DEMO-26001 ของ RB-DM02-02-BK01 (ล็อตรับนอกใบสั่ง 15 เส้น)
  assert.deepEqual([...html.matchAll(/จ่ายยางเส้นยาวให้ GR ตามใบ (DEMO-\d+)/g)].map((match) => match[1]).sort(), ["DEMO-26001", "DEMO-26001", "DEMO-26006", "DEMO-26007"]);
  assert.equal(env.context.MNP_BOM_PAGES.hub.workCount(env.ctx()), 6, "the menu counts the six SR cards (two lots to receive, four order lines to supply)");
  // QA: ยังไม่มีล็อตที่กัก → SR รับ L3 ไม่ผ่าน → QA เห็นการ์ดตัดสิน
  assert.equal(env.store.run("receiveRods", { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" }).ok, true);
  env.store.setUser("B12");
  html = await env.render("p=work");
  clean(html);
  assert.match(html, /ตัดสินล็อตยางเส้นยาว ล็อต FN-\d{8}-93/);
  assert.match(html, /SR: ความหนาเกิน/);
  assert.doesNotMatch(html, /data-rf-open="rodReceive"|data-rf-open="rodIssue"/, "QA only decides");
  env.store.setUser("B03");
  html = await env.render("p=work");
  assert.match(html, /RB \d+<\/a>[\s\S]*SR 5<\/a>[\s\S]*QA 1<\/a>[\s\S]*GR \d+<\/a>/, "the planner's department tabs include SR (one lot left to receive, four order lines to supply) and QA in flow order");
  html = await env.render("p=work&dept=QA");
  assert.match(html, /data-rf-open="rodDecide"/);
  // GR: การ์ดงานบอกยางเส้นยาวที่ได้รับจาก SR
  env.store.setUser("B05");
  html = await env.render("p=work");
  assert.match(html, /ยางเส้นยาวจาก SR 0\/36 เส้น/);
});

test("pages: the receive dialog shows the spec targets, computes the verdict live and asks a note only for a failure; the issue dialog proposes the oldest lots", async () => {
  const env = await page();
  env.store.setUser("B11");
  const ctx = env.ctx("p=work");
  const built = env.dialogs.rodReceive(ctx, { lotId: lotId(2) });
  clean(built.html);
  assert.match(built.html, /data-rf-form="receiveRods"/);
  assert.match(built.html, /สเปก 7\.5 ± 0\.3/);
  assert.match(built.html, /name="values\.thickness"[^>]*required/);
  assert.match(built.html, /จำนวนที่รับ \(เส้น\) <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.doesNotMatch(built.html, /name="result"/, "a lot with a spec has no pass/fail choice: the verdict is computed");
  const inputs = [fakeInput("thickness", "7.5"), fakeInput("width", "34"), fakeInput("weightPerM", "1200")];
  const box = { innerHTML: "" };
  const note = { required: false };
  const mark = { hidden: true };
  built.bind({ querySelectorAll: (selector) => (selector === "[data-rod-value]" ? inputs : []), querySelector: (selector) => ({ "[data-rod-verdict]": box, "[data-rod-note]": note, "[data-rod-note-req]": mark })[selector] ?? null });
  assert.match(box.innerHTML, /ผ่านสเปก ยางเส้นยาวเข้าคลังและนับเข้างาน RB/);
  assert.deepEqual([note.required, mark.hidden], [false, true]);
  inputs[0].value = "7.9";
  inputs[0].handlers.input();
  assert.match(box.innerHTML, /ไม่ผ่าน: ความหนา 7\.9 นอก 7\.5 ± 0\.3 · ล็อตจะถูกกักรอตรวจคุณภาพ \(QA\) ตัดสิน/);
  assert.deepEqual([note.required, mark.hidden], [true, false], "a failure needs a note");
  assert.equal(env.dialogs.rodReceive(ctx, { lotId: lotId(1) }), null, "a stored lot is not received again");
  env.store.setUser("B05");
  assert.equal(env.dialogs.rodReceive(env.ctx(), { lotId: lotId(2) }), null, "GR does not receive");
  env.store.setUser("B11");
  const issue = env.dialogs.rodIssue(env.ctx(), { orderId: "DEMO-26006", itemCode: RB });
  clean(issue.html);
  assert.match(issue.html, /GR ต้องใช้<\/dt><dd>36 เส้น · จ่ายแล้ว 0/);
  assert.match(issue.html, /name="qty"[^>]*value="26"/, "starts at what the store holds for this order (20 own + 6 free)");
  const qty = { value: "22", handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
  const plan = { innerHTML: "" };
  issue.bind({ querySelector: (selector) => ({ "[data-rod-issue]": qty, "[data-rod-plan]": plan })[selector] ?? null });
  assert.match(plan.innerHTML, /FN-\d{8}-91<\/span> <span class="small muted">ของใบ DEMO-26006<\/span><span class="nowrap">20 เส้น[\s\S]*FN-\d{8}-90<\/span> <span class="small muted">สต็อกกลาง<\/span><span class="nowrap">2 เส้น/);
  // ผลผ่านบอกว่าแท่งไปไหน (ตรงกับ bom_rod_credit): SR รับ L2 ผ่าน (งาน 32/36) แล้ว L3 8 เส้น = 4 เส้นเป็นของงาน อีก 4 เส้นเข้าสต็อกกลาง · รับ 3 เส้น = นับเข้างานทั้งหมด
  assert.equal(env.store.run("receiveRods", { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }).ok, true);
  const verdictOf = (qtyValue) => {
    const later = env.dialogs.rodReceive(env.ctx("p=work"), { lotId: lotId(3) });
    const verdict = { innerHTML: "" };
    const qtyInput = { value: qtyValue, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; } };
    const values = [fakeInput("thickness", "7.5"), fakeInput("width", "34"), fakeInput("weightPerM", "1200")];
    later.bind({ querySelectorAll: (selector) => (selector === "[data-rod-value]" ? values : []), querySelector: (selector) => ({ "[data-rod-verdict]": verdict, "[data-rod-qty]": qtyInput })[selector] ?? null });
    return { verdict, qtyInput };
  };
  const live = verdictOf("8");
  assert.match(live.verdict.innerHTML, /ผ่านสเปก ยางเส้นยาวเข้าคลัง: 4 เส้น เป็นของงาน RB ของใบนี้ · เกิน 4 เส้น เข้าสต็อกกลาง/);
  live.qtyInput.value = "3";
  live.qtyInput.handlers.input();
  assert.match(live.verdict.innerHTML, /ผ่านสเปก ยางเส้นยาวเข้าคลังและนับเข้างาน RB/, "the text follows the quantity typed");
  // งาน RB ของใบเสร็จแล้ว = สต็อกกลางทั้งหมด ไม่นับเข้างาน
  env.store.data().jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "RB").status = "done";
  assert.match(verdictOf("8").verdict.innerHTML, /ผ่านสเปก ยางเส้นยาวเข้าคลังเป็นสต็อกกลางทั้งหมด ไม่นับเข้างาน RB \(งาน RB ของใบนี้เสร็จแล้ว\)/);
});

test("pages: the reverse and adjust dialogs, the decide dialog and the draft's use-from-SR-store field (the store page and the lot history dialog moved to the SR module)", async () => {
  const env = await page();
  env.store.setUser("B11");
  assert.equal(env.store.run("issueRods", { orderId: "DEMO-26006", itemCode: RB, qty: 3 }).ok, true);
  assert.equal(env.dialogs.rodLot, undefined, "the lot history dialog is the SR lot page now");
  assert.equal(env.context.MNP_BOM_PAGES.rods, undefined, "and the BOM rod store page is gone");
  const move = env.store.data().rodMoves.find((row) => row.kind === "issue");
  const reverse = env.dialogs.rodReverse(env.ctx(), { moveId: move.id }).html;
  assert.match(reverse, /data-rf-form="reverseRodIssue"/);
  assert.doesNotMatch(reverse, /แท่ง/, "the reverse dialog says ยางเส้นยาว");
  const adjustDialog = env.dialogs.rodAdjust(env.ctx(), { lotId: lotId(0) });
  assert.match(adjustDialog.html, /data-rf-form="adjustRods"/, "SR adjusts free stock too (20261204010000)");
  env.store.setUser("B05");
  assert.equal(env.dialogs.rodAdjust(env.ctx(), { lotId: lotId(0) }), null, "GR does not adjust");
  assert.equal(env.dialogs.rodReverse(env.ctx(), { moveId: move.id }), null, "GR does not reverse");
  env.store.setUser("B03");
  const adjust = env.dialogs.rodAdjust(env.ctx(), { lotId: lotId(0) }).html;
  clean(adjust);
  assert.doesNotMatch(adjust, /แท่ง/);
  let html;
  // ขั้น 2 ของใบร่าง: ช่อง "ใช้จากคลัง SR (เส้น)" บอกยอดที่ใช้ได้ใน title ไม่ใช่ข้อความถาวร
  html = await env.render("p=orders&sel=DEMO-26002");
  clean(html);
  assert.match(html, /<h3 class="bom-h3">คลังยางเส้นยาว \(SR\)<\/h3>/);
  assert.doesNotMatch(html, /แท่ง/);
  assert.match(html, /ใช้จากคลัง SR \(เส้น\)/);
  assert.match(html, /title="คลัง SR มีสต็อกกลางที่ใช้ได้กับใบนี้ 6 เส้น · ใบนี้ต้องใช้ 115\.2"/);
  assert.match(html, /name="qty\[\]"[^>]*max="6"/);
  // QA ตัดสิน
  env.store.setUser("B11");
  env.store.run("receiveRods", { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" });
  env.store.setUser("B12");
  const decide = env.dialogs.rodDecide(env.ctx(), { lotId: lotId(3) });
  clean(decide.html);
  assert.match(decide.html, /data-rf-form="decideRods"/);
  assert.match(decide.html, /นอกสเปก/);
  assert.match(decide.html, /ผลตัดสิน <span class="field-required">\(จำเป็น\)<\/span>/);
  assert.match(decide.html, /เหตุผล <span class="field-required">\(จำเป็น\)<\/span>/);
});

test("pages: the RubberFlow finishing form hides and stops requiring perBox for a work order linked to a BOM job, and names the SR store in the pass verdict", async () => {
  const env = await page();
  const base = env.context.MNP_RUBBERFLOW.context(new URLSearchParams("p=finishing"));
  // ไม่มี BOM ฐานข้อมูล: ผูกงาน = มี sourceJobId (กฎสำรอง) · ไม่มี = ไม่ผูก
  assert.deepEqual([base.bomLinked({ id: "WO-L", sourceJobId: "JOB-X" }), base.bomLinked({ id: "WO-U" })], [true, false]);
  const data = {
    lots: [], fgBoxes: [], orders: [{ id: "WO-L", sourceJobId: "JOB-X", uom: "pcs" }, { id: "WO-G", sourceJobId: "JOB-GONE", uom: "pcs" }, { id: "WO-U", uom: "m" }],
    transfers: ["WO-L", "WO-G", "WO-U"].map((orderId, n) => ({ id: `TR-${n}`, lotId: `CU-${n}`, orderId, to: "finishing", status: "received", remaining: 10, qtySent: 10, uom: "pcs" })),
  };
  // งานของ WO-G ไม่มีใน BOM แล้ว (กฎเดียวกับฐานข้อมูล: ไม่ผูก = มีกล่อง)
  const ctx = { ...base, data, bomLinked: (order) => order.sourceJobId === "JOB-X" };
  const built = env.context.MNP_RUBBERFLOW_PAGES.finishing(ctx);
  assert.match(built.html, /<option value="pass"[^>]*>ผ่าน — รับเข้าคลัง<\/option>/);
  const el = (extra = {}) => ({ value: "", hidden: false, required: false, textContent: "", dataset: {}, handlers: {}, addEventListener(type, handler) { this.handlers[type] = handler; }, ...extra });
  const nodes = {
    "[data-rf-inbound]": el(), '[name="useQty"]': el(), "[data-rf-remaining]": el(), "[data-rf-passed]": el(), "[data-rf-perbox]": el({ required: true }),
    ".rf-perbox-field": el(), "[data-rf-linked-note]": el({ hidden: true }), '[name="qcResult"] option[value="pass"]': el({ textContent: "ผ่าน — รับเข้าคลัง" }),
    'button[type="submit"]': el({ textContent: "บันทึกและพิมพ์ป้ายกล่อง" }), "[data-rf-boxes]": el(),
  };
  const form = { dataset: { rfSuccess: "บันทึก {result} และสร้างป้ายกล่องแล้ว" }, querySelector: (selector) => nodes[selector] ?? null };
  built.bind({ querySelector: (selector) => (selector === "[data-rf-finishing]" ? form : null) });
  const pickTransfer = (id) => { nodes["[data-rf-inbound]"].value = id; nodes["[data-rf-inbound]"].handlers.change(); };
  const state = () => [nodes[".rf-perbox-field"].hidden, nodes["[data-rf-perbox]"].required, nodes["[data-rf-perbox]"].value, nodes["[data-rf-linked-note]"].hidden, nodes['[name="qcResult"] option[value="pass"]'].textContent];
  pickTransfer("TR-0");
  assert.deepEqual(state(), [true, false, "", false, "ผ่าน — ส่งเข้าคลังยางเส้นยาว (SR)"], "linked: perBox hidden, not required, empty; the verdict names the SR store");
  pickTransfer("TR-2");
  assert.deepEqual(state(), [false, true, "2000", true, "ผ่าน — รับเข้าคลัง"], "a work order for sale asks for perBox again with a default");
  pickTransfer("TR-1");
  assert.deepEqual(state().slice(0, 2), [false, true], "a job that BOM no longer has counts as not linked (boxes)");
});

// ---------- โมดูลคลังยางเส้นยาว SR (โรงงาน ขั้น 1 · 20261204010000_bom_sr_store_module.sql · pgTAP คู่กัน: bom_sr_store_module.test.sql) ----------
// ตำแหน่งจัดเก็บจำเป็นทุกการรับเข้า · รับนอกใบสั่ง (receiveRodsOpening) และย้ายตำแหน่ง (setRodLocation) โดย SR หรือฝ่ายวางแผน · SR ปรับยอดเองได้
const BK = "RB-DM02-02-BK01-225-3-20";
const openingRow = (extra = {}) => ({ lotNo: "op-2", itemCode: BK, qty: 10, location: "C-01", note: "คืนจากลูกค้า", ...extra });

test("rules: the rubber attributes of an RB code come from the item register (missing keys from the code); the store module constants", () => {
  const items = [
    { code: BK, name: "ยางดำ", rubber: { compound: "DM02", color: "BK01", lengthMm: 225, holeMm: 3, odMm: 20 } },
    { code: "RB-XX9-01-RD02-100-0-8", name: "ยางแดง", rubber: { compound: "", lengthMm: 120 } },
  ];
  assert.deepEqual(rules.rodAttrs(items, ` ${BK.toLowerCase()} `, [{ code: "BK01", name: "ดำสนิท" }]),
    { code: BK, name: "ยางดำ", compound: "DM02", color: "BK01", colorName: "ดำสนิท", size: "ยาว 225 × รู 3 × วงนอก 20 มม.", text: "สูตร DM02 · สี ดำสนิท · ยาว 225 × รู 3 × วงนอก 20 มม." });
  const fallback = rules.rodAttrs(items, "RB-XX9-01-RD02-100-0-8");
  assert.deepEqual([fallback.compound, fallback.color, fallback.colorName, fallback.size], ["XX9", "RD02", "แดง 02", "ยาว 120 × วงนอก 8 มม."],
    "an empty register key falls back to the code, a register value wins, a zero hole is left out");
  assert.deepEqual(rules.rodAttrs([], "SE-X-1"), { code: "SE-X-1", name: "", compound: "", color: "", colorName: "", size: "", text: "" }, "nothing known = empty texts");
  const demo = fresh();
  assert.equal(rules.rodAttrs(demo.items, BK, demo.colors).text, "สูตร DM02 · สี ดำ · ยาว 225 × รู 3 × วงนอก 20 มม.", "the demo register with its colour names");
  assert.deepEqual([rules.ROD_LOCATION_MAX, rules.ROD_LOT_NO_MAX, rules.ROD_RESERVED_LOT_PREFIX], [40, 40, "FN-"]);
  assert.deepEqual(rules.ROD_SOURCE_LABEL, { order: "จากใบสั่งผลิต", opening: "รับนอกใบสั่ง" });
});

test("receiveRods needs a storage location of 1-40 characters and keeps it on the lot", () => {
  const d = fresh();
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: PASS }, ctx("sr")), /กรุณาระบุตำแหน่งจัดเก็บ \(เช่น A-01\)/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "   " }, ctx("sr")), /กรุณาระบุตำแหน่งจัดเก็บ/);
  rejects(() => A.receiveRods(structuredClone(d), { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A".repeat(41) }, ctx("sr")), /ตำแหน่งจัดเก็บยาวเกิน 40 ตัวอักษร/);
  assert.equal(lot(d, 2).status, "pending", "a refused receipt changes nothing");
  A.receiveRods(d, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: " A-07 " }, ctx("sr"));
  assert.deepEqual([lot(d, 2).status, lot(d, 2).location], ["stored", "A-07"]);
  A.receiveRods(d, { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" }, ctx("sr"));
  assert.deepEqual([lot(d, 3).status, lot(d, 3).location], ["held", "Q-01"], "a held lot has a place too");
});

test("receiveRodsOpening: SR or a planner takes RB rods in outside an order as free stock with a location and a reason; the rest is refused", () => {
  const d = fresh();
  const se = d.items.find((item) => item.kind === "SE").code;
  const existing = d.rodLots.find((row) => row.source === "opening").lotNo;
  for (const role of ["gr", "rb", "wh", "qa", "pt"]) rejects(() => A.receiveRodsOpening(structuredClone(d), openingRow(), ctx(role)), /รับยางเส้นยาวนอกใบสั่งได้โดยคลังยางเส้นยาว \(SR\) หรือฝ่ายวางแผนเท่านั้น/);
  for (const [extra, pattern] of [
    [{ itemCode: se }, /ไม่ใช่เส้นยาง \(RB\)/], [{ itemCode: "RB-NOPE" }, /ไม่พบรหัส RB-NOPE/], [{ qty: 0 }, /จำนวนที่รับต้องมากกว่า 0/], [{ qty: "x" }, /จำนวนที่รับต้องเป็นตัวเลข/],
    [{ location: "" }, /กรุณาระบุตำแหน่งจัดเก็บ/], [{ location: "B".repeat(41) }, /ยาวเกิน 40/], [{ note: "ab" }, /กรุณาระบุที่มาหรือเหตุผลที่รับเข้า \(อย่างน้อย 3 ตัวอักษร\)/],
    [{ lotNo: " " }, /กรุณาระบุเลขล็อต/], [{ lotNo: "L".repeat(41) }, /เลขล็อตยาวเกิน 40/], [{ lotNo: "fn-777" }, /ขึ้นต้นด้วย FN- เป็นของล็อตตกแต่งใน RubberFlow/],
    [{ lotNo: existing.toLowerCase() }, /มีอยู่แล้ว ใช้เลขล็อตอื่น/],
  ]) rejects(() => A.receiveRodsOpening(structuredClone(d), openingRow(extra), ctx("sr")), pattern);
  const out = A.receiveRodsOpening(d, openingRow(), ctx("sr"));
  const made = d.rodLots.find((row) => row.id === out.id);
  assert.match(out.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.deepEqual(plain(made), {
    id: out.id, lotNo: "OP-2", itemCode: BK, orderId: null, jobNo: null, woNo: null, recipeCode: null, uom: "rod", qtySent: 10, spec: null, status: "stored", qtyReceived: 10, qc: null,
    receivedBy: "ศิริ รับมอบ", receivedAt: NOW, decision: null, decisionNote: null, decidedBy: null, decidedAt: null, createdAt: NOW, location: "C-01", source: "opening", sourceNote: "คืนจากลูกค้า",
  }, "the lot has the same fields as a lot the server returns");
  assert.deepEqual(d.rodMoves.filter((move) => move.lotId === out.id).map((move) => [move.kind, move.qty, move.ownerOrderId, move.note]), [["receive", 10, null, "คืนจากลูกค้า"]]);
  assert.equal(rules.rodFree(d, BK), 25, "15 of the demo opening lot + 10");
  assert.deepEqual([out.section, out.request], ["rodLots", [{ id: out.id, lotNo: "OP-2", itemCode: BK, qty: 10, location: "C-01", note: "คืนจากลูกค้า" }]]);
  assert.deepEqual([d.audit[0].action, d.audit[0].detail], ["รับยางเส้นยาวนอกใบสั่ง", `ล็อต OP-2 ${BK} × 10 ที่ C-01 — คืนจากลูกค้า`]);
  rejects(() => A.receiveRodsOpening(structuredClone(d), openingRow(), ctx("sr")), /ล็อต OP-2 มีอยู่แล้ว/);
  A.receiveRodsOpening(d, openingRow({ lotNo: "OP-3", qty: 2 }), ctx("planner"));
  assert.equal(rules.rodFree(d, BK), 27, "a planner takes rods in too");
  // ล็อตนอกใบสั่งจ่ายให้ GR ได้ ล็อตที่รับก่อนออกก่อน (ล็อตสาธิตรับ 3 วันก่อน แล้ว OP-2 OP-3)
  const issued = A.issueRods(d, { orderId: "DEMO-26001", itemCode: BK, qty: 18 }, ctx("sr"));
  assert.deepEqual(issued.plan.map((row) => [row.lotNo, row.owner, row.qty]), [[existing, null, 15], ["OP-2", null, 3]]);
  assert.equal(rules.rodFree(d, BK), 9);
  // โหมดฐานข้อมูล: ล็อตแสดงทันที แถวประวัติมากับคำตอบของเซิร์ฟเวอร์
  const remote = fresh();
  const before = remote.rodMoves.length;
  const sent = A.receiveRodsOpening(remote, openingRow(), ctx("sr", { remote: true }));
  assert.deepEqual([remote.rodLots.some((row) => row.id === sent.id), remote.rodMoves.length], [true, before]);
  assert.deepEqual(storeApi.diffMaster(fresh(), remote, "receiveRodsOpening"), {}, "the lot is never diffed as a record: the request row is what the store sends");
});

test("setRodLocation moves a stored or held lot (SR or a planner) and touches nothing else", () => {
  const d = fresh();
  for (const role of ["gr", "qa", "rb"]) rejects(() => A.setRodLocation(structuredClone(d), { lotId: lotId(0), location: "D-09" }, ctx(role)), /ย้ายตำแหน่งยางเส้นยาวได้โดยคลังยางเส้นยาว \(SR\) หรือฝ่ายวางแผนเท่านั้น/);
  rejects(() => A.setRodLocation(structuredClone(d), { lotId: lotId(2), location: "D-09" }, ctx("sr")), /ไม่ได้อยู่ในคลัง \(รอรับเข้าคลัง\) ย้ายตำแหน่งไม่ได้/);
  rejects(() => A.setRodLocation(structuredClone(d), { lotId: lotId(0), location: "" }, ctx("sr")), /กรุณาระบุตำแหน่งจัดเก็บ/);
  rejects(() => A.setRodLocation(structuredClone(d), { lotId: "nope", location: "D-09" }, ctx("sr")), /ไม่พบล็อตยางเส้นยาวนี้/);
  const moves = d.rodMoves.length;
  const out = A.setRodLocation(d, { lotId: lotId(0), location: " D-09 " }, ctx("sr"));
  assert.deepEqual([out.section, out.request], ["rodLots", [{ id: lotId(0), location: "D-09" }]]);
  assert.deepEqual([lot(d, 0).location, lot(d, 0).status, lot(d, 0).qtyReceived, d.rodMoves.length], ["D-09", "stored", 6, moves], "only the place changes, no stock move");
  assert.deepEqual([d.audit[0].action, d.audit[0].detail], ["ย้ายตำแหน่งยางเส้นยาว", `ล็อต ${lot(d, 0).lotNo} ${RB} A-01 → D-09`]);
  A.receiveRods(d, { lotId: lotId(3), qtyReceived: 8, values: FAIL, note: "ความหนาเกิน", location: "Q-01" }, ctx("sr"));
  A.setRodLocation(d, { lotId: lotId(3), location: "Q-02" }, ctx("planner"));
  assert.equal(lot(d, 3).location, "Q-02", "a held lot can be moved while it waits for QA");
  A.decideRods(d, { lotId: lotId(3), decision: "return", note: "ส่งคืน RB" }, ctx("qa"));
  rejects(() => A.setRodLocation(d, { lotId: lotId(3), location: "Q-03" }, ctx("sr")), /ไม่ได้อยู่ในคลัง \(คืน RB แก้ไข\)/);
  assert.deepEqual([A.helpers.canAdjustRods(user("sr")), A.helpers.canAdjustRods(user("planner")), A.helpers.canAdjustRods(user("gr")), A.helpers.canAdjustRods(user("qa"))], [true, true, false, false]);
});

test("mock: receiveRods needs a location; receiveRodsOpening and setRodLocation follow the database's rights, shape and errors; the opening lot is issued like any lot", async () => {
  const scene = mockScene();
  const lots = (rows) => ({ rodLots: { upsert: rows } });
  // receiveRods ไม่มีตำแหน่ง = รูปคำขอผิด (ก่อนสิทธิ์)
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { location: undefined }))), "BOM_INVALID_ROD", "no location");
  assert.equal(await codeOf(scene.save("persona-gr", "receiveRods", receiveRow(2, { location: " " }))), "BOM_INVALID_ROD", "a blank location is a shape error before rights");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRods", receiveRow(2, { location: "A".repeat(41) }))), "BOM_INVALID_ROD", "more than 40 characters");
  assert.ok((await scene.save("persona-sr", "receiveRods", receiveRow(2, { location: " A-07 " }))).data);
  assert.equal((await scene.master()).rodLots.find((row) => row.id === lotId(2)).location, "A-07", "the trimmed location is stored");
  // รับนอกใบสั่ง
  const opening = (extra = {}) => lots([{ id: "9d000000-0000-4000-8000-000000000001", lotNo: "op-2", itemCode: BK, qty: 10, location: "C-01", note: "คืนจากลูกค้า", ...extra }]);
  const before = await scene.master();
  const se = before.items.find((item) => item.kind === "SE").code;
  const existing = before.rodLots.find((row) => row.source === "opening");
  for (const persona of ["persona-gr", "persona-rb", "persona-wh", "persona-qa", "persona-st"]) assert.equal(await codeOf(scene.save(persona, "receiveRodsOpening", opening())), "BOM_FORBIDDEN", `${persona} may not take rods in`);
  for (const [extra, why] of [[{ itemCode: se }, "not an RB item"], [{ itemCode: "RB-NOPE" }, "unknown item"], [{ qty: 0 }, "zero"], [{ qty: "10" }, "a text quantity"],
    [{ location: "" }, "no location"], [{ note: "ab" }, "a short reason"], [{ lotNo: "FN-1" }, "a RubberFlow finishing lot number"], [{ lotNo: existing.lotNo.toLowerCase() }, "a lot number in use"],
    [{ id: existing.id }, "a row id in use"], [{ id: "not-a-uuid" }, "not a uuid"]]) {
    assert.equal(await codeOf(scene.save("persona-sr", "receiveRodsOpening", opening(extra))), "BOM_INVALID_ROD", why);
  }
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRodsOpening", lots([opening().rodLots.upsert[0], { ...opening().rodLots.upsert[0], id: "9d000000-0000-4000-8000-000000000002", lotNo: "OP-9" }]))), "BOM_INVALID_ROD", "one lot per call");
  assert.equal(await codeOf(scene.save("persona-sr", "receiveRodsOpening", { rodMoves: { upsert: [{ id: "9d000000-0000-4000-8000-000000000001" }] } })), "BOM_INVALID_ROD", "the lot section only");
  const ok = await scene.save("persona-sr", "receiveRodsOpening", opening());
  assert.ok(ok.data, ok.code);
  const made = ok.data.changes.rodLots.upsert.find((row) => row.id === "9d000000-0000-4000-8000-000000000001");
  assert.deepEqual([made.lotNo, made.status, made.source, made.sourceNote, made.location, made.qtySent, made.qtyReceived, made.uom, made.orderId, made.qc, made.spec, made.receivedBy],
    ["OP-2", "stored", "opening", "คืนจากลูกค้า", "C-01", 10, 10, "rod", null, null, null, "ศิริ รับมอบ"]);
  assert.deepEqual(ok.data.changes.rodMoves.upsert.map((move) => [move.kind, move.qty, move.ownerOrderId, move.note]), [["receive", 10, null, "คืนจากลูกค้า"]]);
  const audit = (await scene.call("app_bom_audit", {}))[0];
  assert.deepEqual([audit.action, audit.detail], ["receiveRodsOpening", "rodLots +1, rodMoves +1"]);
  assert.ok((await scene.save("persona-pp", "receiveRodsOpening", opening({ id: "9d000000-0000-4000-8000-000000000003", lotNo: "OP-3", qty: 2 }))).data, "a planner takes rods in too");
  // ทุกล็อตมีสามช่องใหม่ (ล็อตจากใบสั่ง: ตำแหน่ง '' จนกว่าจะรับเข้า)
  const fields = (await scene.master()).rodLots.map((row) => [row.source, typeof row.location, row.sourceNote === null || typeof row.sourceNote === "string"]);
  assert.ok(fields.every(([source, location, note]) => ["order", "opening"].includes(source) && location === "string" && note));
  // ย้ายตำแหน่ง
  const move = (id, location) => lots([{ id, location }]);
  for (const persona of ["persona-gr", "persona-qa", "persona-rb"]) assert.equal(await codeOf(scene.save(persona, "setRodLocation", move(lotId(0), "D-09"))), "BOM_FORBIDDEN", `${persona} may not move a lot`);
  assert.equal(await codeOf(scene.save("persona-sr", "setRodLocation", move(lotId(3), "D-09"))), "BOM_INVALID_TRANSITION", "a pending lot is not in the store yet");
  assert.equal(await codeOf(scene.save("persona-sr", "setRodLocation", move("9d000000-0000-4000-8000-0000000000ff", "D-09"))), "BOM_INVALID_ROD", "an unknown lot");
  assert.equal(await codeOf(scene.save("persona-sr", "setRodLocation", move(lotId(0), ""))), "BOM_INVALID_ROD", "no location");
  const moves = (await scene.master()).rodMoves.length;
  assert.ok((await scene.save("persona-sr", "setRodLocation", move(lotId(0), "D-09"))).data);
  const after = await scene.master();
  assert.deepEqual([after.rodLots.find((row) => row.id === lotId(0)).location, after.rodMoves.length], ["D-09", moves], "only the place changes");
  assert.equal((await scene.call("app_bom_audit", {}))[0].detail, "rodLots +1");
  await scene.save("persona-sr", "receiveRods", receiveRow(3, { qc: { values: FAIL, result: "fail", note: "ความหนาเกิน" } }));
  assert.ok((await scene.save("persona-pp", "setRodLocation", move(lotId(3), "Q-02"))).data, "a held lot can be moved");
  await scene.save("persona-qa", "decideRods", lots([{ id: lotId(3), decision: "scrap", decisionNote: "เสียทั้งล็อต" }]));
  assert.equal(await codeOf(scene.save("persona-sr", "setRodLocation", move(lotId(3), "Q-03"))), "BOM_INVALID_TRANSITION", "a scrapped lot is gone");
  // ล็อตนอกใบสั่งจ่ายให้ GR ของใบที่ผลิตอยู่ได้ (ถังสต็อกกลาง)
  const issue = { id: "9d000000-0000-4000-8000-000000000011", kind: "issue", lotId: "9d000000-0000-4000-8000-000000000001", ownerOrderId: null, forOrderId: "DEMO-26001", itemCode: BK, qty: -4 };
  assert.equal(await codeOf(scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [{ ...issue, qty: -11 }] } })), "BOM_ROD_EXCEEDS", "no more than the lot holds");
  assert.ok((await scene.save("persona-sr", "issueRods", { rodMoves: { upsert: [issue] } })).data, "the opening lot is issued to an order");
  assert.equal(rules.rodBalance((await scene.master()).rodMoves, "9d000000-0000-4000-8000-000000000001", null), 6);
});

test("#/bom?p=rods changes the address: to the SR module's stock for whoever can open it, to GR's read view otherwise, else to the BOM home", async () => {
  const env = await page();
  const person = (dept, role = "employee", extra = {}) => ({ isSandbox: true, department: { code: dept }, role: { code: role }, ...extra });
  const go = async (userId, employee, query = "p=rods") => {
    env.store.setUser(userId);
    env.context.state.employee = employee;
    env.log.hash = `#/bom?${query}`;
    await env.context.MNP_REQUEST_MODULES.BOM.pages.bom(new URLSearchParams(query));
    return env.log.hash;
  };
  assert.equal(await go("B11", person("SR")), "#/sr?tab=stock", "SR");
  assert.equal(await go("B03", person("PP")), "#/sr?tab=stock", "a planner");
  assert.equal(await go("B01", person("MT", "admin")), "#/sr?tab=stock", "an admin");
  assert.equal(await go("B05", person("GR")), "#/gr?tab=rods", "GR gets its read view");
  assert.equal(await go("B12", person("QA")), "#/bom?p=orders", "QA has no rod page now: the BOM home");
  assert.equal(await go("B04", person("RB")), "#/bom?p=orders", "RB too");
  assert.equal(await go("B01", person("ID", "admin")), "#/bom?p=find", "the Indesign department opens none of the factory modules: the BOM home");
  // outside test mode BOM refuses first (nowhere to go)
  assert.equal(await go("B11", person("SR", "employee", { isSandbox: false })), "#/bom?p=rods");
  // other BOM pages are not redirected
  assert.equal(await go("B03", person("PP"), "p=orders"), "#/bom?p=orders");
});

test("pages: the opening receipt dialog offers RB codes only and the location dialog fills the place in; neither opens for GR, QA, WH or RB, or for a lot that is not in the store", async () => {
  const env = await page();
  env.store.setUser("B11");
  const opening = env.dialogs.rodOpening(env.ctx());
  clean(opening.html);
  assert.match(opening.html, /data-rf-form="receiveRodsOpening"/);
  assert.match(opening.html, new RegExp(`<option value="${BK}">${BK} · `));
  assert.doesNotMatch(opening.html, /<option value="(SE|PT|CP|BG)-/, "RB items only");
  assert.equal((opening.html.match(/<span class="field-required">\(จำเป็น\)<\/span>/g) ?? []).length, 5, "code, lot, quantity, location and reason are all required");
  assert.match(opening.html, /maxlength="40"/);
  assert.match(opening.html, /minlength="3" maxlength="300"/);
  assert.doesNotMatch(opening.html, /แท่ง/);
  const place = env.dialogs.rodLocation(env.ctx(), { lotId: lotId(1) });
  clean(place.html);
  assert.match(place.html, /data-rf-form="setRodLocation"/);
  assert.match(place.html, /value="A-02"/, "the current place");
  assert.match(place.html, /ตอนนี้ A-02/);
  assert.equal(env.dialogs.rodLocation(env.ctx(), { lotId: lotId(2) }), null, "a lot waiting to be received has no place to move");
  assert.equal(env.dialogs.rodLocation(env.ctx(), { lotId: "nope" }), null);
  env.store.setUser("B03");
  assert.ok(env.dialogs.rodOpening(env.ctx()) && env.dialogs.rodLocation(env.ctx(), { lotId: lotId(1) }), "a planner may");
  for (const id of ["B05", "B12", "B09", "B04"]) {
    env.store.setUser(id);
    assert.equal(env.dialogs.rodOpening(env.ctx()), null, `${id} cannot take rods in`);
    assert.equal(env.dialogs.rodLocation(env.ctx(), { lotId: lotId(1) }), null, `${id} cannot move a lot`);
  }
});

test("wording: no user-visible text in the BOM, RubberFlow or factory modules calls the rods แท่ง (comments aside); the bars of charts keep their word", async () => {
  const fs = await import("node:fs");
  const files = ["bom-actions", "bom-pages", "bom-rules", "bom-hub", "bom-store", "bom-seed", "module-bom", "factory-kit", "module-sr", "module-gr", "module-qa", "module-st", "module-wh", "module-rubberflow", "rubberflow-actions", "rubberflow-pages-line", "rubberflow-pages-plan", "rubberflow-pages-quality", "rubberflow-store"];
  for (const name of files) {
    // the one place the old words stay on purpose: the legacy audit text the audit page still has to recognise
    const code = fs.readFileSync(`modules/${name}.js`, "utf8").split(/\r?\n/).filter((line) => !line.trimStart().startsWith("//") && !line.includes("ROD_STOCK_AUDIT_TEXT_LEGACY =")).join("\n");
    assert.doesNotMatch(code, /แท่ง/, `${name}.js`);
  }
  // the harness persona labels and mock messages too
  const mock = fs.readFileSync("scripts/pilot-harness-mock.mjs", "utf8").split(/\r?\n/).filter((line) => !line.trimStart().startsWith("//")).join("\n");
  assert.doesNotMatch(mock, /แท่ง/, "pilot-harness-mock.mjs");
  // the old audit text is still recognised, and the stored labels the client writes now use the new words
  const d = fresh();
  A.setStockCount(d, { orderId: "DEMO-26002", itemCode: RB, qty: 5 }, ctx("planner"));
  assert.equal(d.audit[0].action, rules.ROD_STOCK_AUDIT_TEXT);
  const received = fresh();
  A.receiveRods(received, { lotId: lotId(2), qtyReceived: 12, values: PASS, location: "A-03" }, ctx("sr"));
  assert.equal(received.audit[0].action, "รับยางเส้นยาวเข้าคลัง SR");
  A.issueRods(received, { orderId: "DEMO-26006", itemCode: RB, qty: 2 }, ctx("sr"));
  assert.equal(received.audit[0].action, "จ่ายยางเส้นยาวให้ GR");
  A.adjustRods(received, { lotId: lotId(0), qty: -1, note: "นับจริงไม่พบ" }, ctx("sr"));
  assert.equal(received.audit[0].action, "ปรับยอดยางเส้นยาวในคลัง");
});
