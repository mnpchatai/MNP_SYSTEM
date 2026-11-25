import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// กฎธุรกิจของ BOM รายแผนก (modules/bom-actions.js) บนข้อมูลสาธิต (modules/bom-seed.js): ทุก action ทำบนร่างและ throw เมื่อกฎไม่ผ่าน
// จุดสร้าง BOM จุดเดียว: ฝ่ายวางแผน/ผู้จัดการบันทึก item และ BOM ทุกชั้น ไม่มีขั้นอนุมัติ ทุกการบันทึกเป็น revision ใหม่ทันที
const require = createRequire(import.meta.url);
const rules = require("../../modules/bom-rules.js");
globalThis.MNP_BOM_RULES = rules;
const A = require("../../modules/bom-actions.js");
globalThis.MNP_BOM_ACTIONS = A;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-10-29T10:00:00+07:00");
const { DAY } = rules;
const user = (role) => seed.USERS.find((row) => row.role === role);
const ctx = (role = "admin", now = NOW) => ({ now, user: user(role) });
// ไม่มีการเบิกจ่ายของซื้อสาธิต: เทสต์เบิก / คืนของซื้อของ DEMO-26001 เริ่มจากใบที่ยังไม่เบิกเลย
const fresh = () => seed.buildSeed(NOW, { parts: false });
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const approved = (d, code) => A.helpers.approvedBomOf(d, code);
const day = (n) => new Date(NOW + n * DAY).setHours(0, 0, 0, 0);
// 20261224010000: WH รับได้ไม่เกินที่ PK ส่งให้ WH · ตัวช่วยของเทสต์ = หัวหน้า PK / ฝ่ายวางแผนส่งครบยอดที่ PK ทำของทุกงาน PK / FG ของใบก่อนรับ (เพดานจึงเท่ายอดที่ PK ทำเหมือนเดิม)
// การส่งเองและสิทธิ์ของมันตรวจใน scripts/tests/bom-dept-steps.test.mjs
const shipToWh = (d, orderId, now = NOW) => {
  const order = (d.orders ?? []).find((entry) => entry.id === String(orderId ?? "").trim().toUpperCase());
  if (!order || !["released", "in_progress", "completed"].includes(order.status)) return;
  for (const job of d.jobs.filter((entry) => entry.orderId === order.id && entry.dept === "PK" && entry.kind === "FG")) {
    const left = Math.round(((Number(job.qtyDone) || 0) - rules.grHandoverSummary(d, job).sent) * 1e4) / 1e4;
    if (left > 0) A.sendPkToWh(d, { jobId: job.id, qty: left }, { now, user: user("planner") });
  }
};
const receiveFg = (d, p, c) => { shipToWh(d, p?.orderId, c?.now); return A.receiveFg(d, p, c); };

test("the demo seed is deterministic, valid for the store and internally consistent", () => {
  const a = fresh();
  assert.deepEqual(a, fresh());
  assert.ok(storeApi.isValidState(a));
  assert.equal(a.users.length, 13);
  assert.deepEqual(a.users.filter((user) => user.dept === "WH").map((user) => [user.id, user.role]), [["B09", "wh"], ["B10", "manager"]], "the warehouse has a staff user and a manager");
  assert.deepEqual(a.users.filter((user) => ["SR", "QA"].includes(user.dept)).map((user) => [user.id, user.role]), [["B11", "sr"], ["B12", "qa"]], "the long-rod store and QA have a demo user each");
  assert.equal(a.items.length, seed.ITEMS.length);
  assert.equal(a.boms.filter((bom) => bom.status === "approved").length, 8);
  assert.equal(a.boms.filter((bom) => bom.status === "superseded").length, 1, "one edit left a superseded revision");
  assert.equal(approved(a, "SE-TP01-OR01-100-18-65").revision, 2);
  assert.equal(approved(a, "DEMO-BL-60(K)-Z"), null, "the ball product has no BOM yet");
  assert.deepEqual(a.orders.map((order) => [order.id, order.status]), [["DEMO-26008", "completed"], ["DEMO-26007", "in_progress"], ["DEMO-26006", "in_progress"], ["DEMO-26002", "draft"], ["DEMO-26001", "in_progress"]]);
  // ใบสาธิตที่ส่งมอบครบแล้ว (ลองย้อนด้วยผู้จัดการคลังสินค้า · 20261128020000): รับเข้า 8 + 12 ส่งมอบ 20 · ย้อนรับเข้าได้หลังย้อนการส่งมอบ
  const delivered = a.orders.find((order) => order.id === "DEMO-26008");
  assert.deepEqual(a.fgMoves.filter((move) => move.orderId === "DEMO-26008").map((move) => [move.kind, move.qty]), [["receive", 8], ["receive", 12], ["deliver", 20]]);
  assert.equal(rules.fgPosition(a, delivered).fullyDelivered, true, "the demo order is fully delivered");
  assert.ok(!a.jobs.some((job) => job.orderId === "DEMO-26008" && A.helpers.isOpenJob(a, job)), "its jobs are done or belong to a closed order");
  assert.match(rules.fgReverseBlock(a, delivered, a.fgMoves.find((move) => move.orderId === "DEMO-26008" && move.qty === 12)), /ย้อนการส่งมอบก่อน/, "a receipt waits for the delivery to be reversed first");
  assert.equal(rules.fgReverseBlock(a, delivered, a.fgMoves.find((move) => move.orderId === "DEMO-26008" && move.kind === "deliver")), null, "the delivery can be reversed");
  // ใบที่งาน RB ผูก WO ของชุดสาธิต RubberFlow (เลข WO ของวันที่ 3 วันก่อน ลำดับ 01 / 02 · rubberflow-seed.js เปิด WO เลขเดียวกันจาก demoRfLinks)
  const linkedRb = ["DEMO-26006", "DEMO-26007"].map((pi) => a.jobs.find((job) => job.orderId === pi && job.dept === "RB"));
  assert.deepEqual(linkedRb.map((job) => [job.status, job.externalRef.woId]), [["in_progress", seed.demoWoId(NOW, 0)], ["in_progress", seed.demoWoId(NOW, 1)]]);
  assert.match(seed.demoWoId(NOW, 1), /^WO-20261026-02$/);
  assert.deepEqual(seed.demoRfLinks(NOW).map((link) => [link.orderId, link.jobId, link.woId, link.recipeId, link.mode]),
    [["DEMO-26006", linkedRb[0].id, seed.demoWoId(NOW, 0), "RC-NBR-OR02", "running"], ["DEMO-26007", linkedRb[1].id, seed.demoWoId(NOW, 1), "RC-NBR-OR02", "issued"]],
    "the RubberFlow demo opens the same work orders for the linked RB jobs");
  const jobs = a.jobs.filter((job) => job.orderId === "DEMO-26001");
  assert.equal(jobs.length, 21, "one job per department × item plus one PK job per product, plus one ST job per purchased part");
  assert.deepEqual(jobs.filter((job) => !rules.MANUFACTURED.includes(job.kind)).map((job) => [job.dept, job.kind]), Array(7).fill(["ST", "PURCHASED"]), "the purchased parts are ST jobs");
  assert.deepEqual(a.stock.map((row) => row.itemCode).sort(), ["P-BAG-01", "P-BOX-01", "P-FAB-BL", "P-PEL-BK", "P-ROPE-01", "P-STK-01", "P-ZIP-05"], "every purchased part of the demo order has a counted balance");
  const rb = jobs.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rb.qtyRequired.toFixed(2), "7.74", "80 sets × 3 SE / 31 pieces per rod — the BOMSHEET number");
  assert.equal(rb.qtyPlanned, 8, "rods are extruded whole: the plan of an RB job is rounded up, the requirement stays exact");
  assert.equal(rb.stockCounted, null);
  const pt = jobs.find((job) => job.itemCode === "PT-00320");
  assert.equal(pt.status, "done");
  assert.deepEqual([pt.qtyRequired, pt.stockCounted, pt.qtyPlanned], [24, 10, 14], "the counted stock reduces the planned quantity (BOMSHEET column AK)");
  assert.equal(jobs.find((job) => job.itemCode === "RB-DM02-02-BK01-225-3-20").qtyPlanned, 18, "17.14 rods needed, rounded up to whole rods (rods are no longer counted per PI: they come from the SR store)");
  assert.equal(jobs.find((job) => job.itemCode === "RB-DM02-02-BK01-225-3-20").qtyRequired.toFixed(2), "17.14", "the requirement of that job stays exact");
  assert.equal(jobs.find((job) => job.itemCode === "BG-0092").status, "hold");
  assert.deepEqual(A.helpers.jobHoldNote(jobs.find((job) => job.itemCode === "BG-0092")), { reason: "รอผ้าตาข่ายล็อตใหม่", by: user("bg").name, at: NOW - 4 * DAY }, "the demo hold has its reason");
  assert.ok(a.audit.length > 30 && a.audit.every((entry) => entry.user && entry.action));
});

test("only planners and managers create or edit items and BOMs; every save is a new revision that is usable at once", () => {
  const d = fresh();
  for (const role of ["gr", "rb", "pt", "bg", "st"]) {
    rejects(() => A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "RB-DM01-01-OR01-200-0-72", qty: 1 }] }, ctx(role)), /ฝ่ายวางแผนหรือผู้จัดการ/);
    rejects(() => A.saveItem(d, { code: "X-1", kind: "PURCHASED", name: "x", uom: "pcs" }, ctx(role)), /ฝ่ายวางแผนหรือผู้จัดการ/);
  }
  rejects(() => A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [] }, ctx("planner")), /อย่างน้อย 1 บรรทัด/);
  rejects(() => A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "NOPE", qty: 1 }] }, ctx("planner")), /ไม่พบชิ้นงาน NOPE/);
  rejects(() => A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 1 }, { childCode: "P-STK-01", qty: 2 }] }, ctx("planner")), /ซ้ำ/);
  rejects(() => A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 0 }] }, ctx("planner")), /มากกว่า 0/);
  // วงจรผ่านชิ้นที่ไม่ใช่สินค้า (สินค้าสำเร็จรูปเป็นส่วนประกอบไม่ได้อยู่แล้ว จึงวนกลับมาที่สินค้าไม่ได้)
  A.saveItem(d, { code: "SE-CYC-A", kind: "SE", name: "ชิ้น A", uom: "pcs" }, ctx("planner"));
  A.saveItem(d, { code: "SE-CYC-B", kind: "SE", name: "ชิ้น B", uom: "pcs" }, ctx("planner"));
  A.saveBom(d, { itemCode: "SE-CYC-A", lines: [{ childCode: "SE-CYC-B", qty: 1 }] }, ctx("planner"));
  rejects(() => A.saveBom(d, { itemCode: "SE-CYC-B", lines: [{ childCode: "SE-CYC-A", qty: 1 }] }, ctx("planner")), /วงจร/);
  // สินค้าสำเร็จรูป (FG) เป็นส่วนประกอบไม่ได้ ไม่ว่าใต้ชิ้นชนิดไหน · เปลี่ยนชิ้นที่เป็นลูกอยู่แล้วให้เป็นสินค้าก็ไม่ได้
  rejects(() => A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "DEMO-TP-01(P)-Y", qty: 1 }] }, ctx("planner")), /สินค้าสำเร็จรูปใช้เป็นส่วนประกอบไม่ได้/);
  rejects(() => A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "DEMO-HL-24(B)-A", qty: 1 }] }, ctx("planner")), /สินค้าสำเร็จรูปใช้เป็นส่วนประกอบไม่ได้/);
  rejects(() => A.saveItem(d, { code: "P-STK-01", kind: "FG", name: "สติ๊กเกอร์", uom: "pcs" }, ctx("planner")), /สินค้าสำเร็จรูปใช้เป็นส่วนประกอบไม่ได้/);
  assert.equal(d.items.find((item) => item.code === "P-STK-01").kind, "PURCHASED", "a refused kind change leaves the item as it was");
  rejects(() => A.saveBom(d, { itemCode: "RB-DM01-01-OR01-200-0-72", lines: [{ childCode: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /RubberFlow/);
  rejects(() => A.saveBom(d, { itemCode: "P-PEL-BK", lines: [{ childCode: "P-STK-01", qty: 1 }] }, ctx("manager")), /ของซื้อ/);
  const before = approved(d, "DEMO-TP-01(P)-Y");
  const same = A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: before.lines.map((line) => ({ childCode: line.childCode, qty: line.qty, note: line.note })) }, ctx("planner"));
  assert.deepEqual(same, { id: before.id, revision: before.revision, changed: false }, "identical lines do not create a revision");
  const seBefore = approved(d, "SE-TP01-OR01-100-18-65");
  const rounded = A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: seBefore.lines.map((line) => ({ childCode: line.childCode, qty: Math.round(line.qty * 1e6) / 1e6, note: line.note })) }, ctx("planner"));
  assert.equal(rounded.changed, false, "the form's 6-decimal rounding of 1/31 is not a change");
  assert.equal(approved(d, "SE-TP01-OR01-100-18-65").lines[0].qty, seBefore.lines[0].qty, "the precise ratio is kept");
  const result = A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "SE-TP01-OR01-100-18-65", qty: 4 }, { childCode: "P-BOX-01", qty: 0.05, scrapPct: 2 }], note: "เพิ่มลูกตอปิโดเป็น 4" }, ctx("planner"));
  assert.equal(result.changed, true);
  assert.equal(result.revision, before.revision + 1);
  const current = approved(d, "DEMO-TP-01(P)-Y");
  assert.equal(current.id, result.id);
  assert.equal(current.status, "approved", "usable at once, no approval step");
  // BOM ที่มีอยู่แล้วเก็บลำดับตามที่ส่งมา (ผู้ใช้เรียงเอง) ไม่จัดตามผังงานกลับ
  assert.deepEqual(current.lines.map((line) => line.childCode), ["SE-TP01-OR01-100-18-65", "P-BOX-01"]);
  assert.equal(current.lines[1].scrapPct, 2);
  assert.equal(current.lines[0].consumerDept, "PK");
  assert.equal(current.lines[0].producerDept, "GR");
  assert.equal(d.boms.find((bom) => bom.id === before.id).status, "superseded");
  assert.equal(d.boms.filter((bom) => bom.itemCode === "DEMO-TP-01(P)-Y" && bom.status === "approved").length, 1);
  assert.match(current.changeLog[0].text, /SE-TP01-OR01-100-18-65 3→4/);
  assert.match(current.changeLog[0].text, /−XP-00001/);
  assert.match(current.changeLog[0].text, /เพิ่มลูกตอปิโดเป็น 4/);
  assert.ok(!("submitBom" in A) && !("approveBom" in A) && !("saveBomDraft" in A), "the approval actions are gone");
});

test("item master: planners maintain items of every department; RB items need a compound which is registered automatically", () => {
  const d = fresh();
  rejects(() => A.saveItem(d, { code: "RB-X", kind: "RB", name: "x", uom: "rod", rubber: { compound: "" } }, ctx("planner")), /สูตรยาง/);
  rejects(() => A.saveItem(d, { code: "P-NEW", kind: "PURCHASED", name: "x", uom: "nope" }, ctx("planner")), /หน่วยนับ/);
  rejects(() => A.saveItem(d, { code: "", kind: "PURCHASED", name: "x", uom: "pcs" }, ctx("planner")), /รหัสชิ้นงาน/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "dup", uom: "pcs", create: true }, ctx("planner")), /อยู่แล้ว/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "x", uom: "pcs", ownerDept: "XX" }, ctx("planner")), /แผนกเจ้าของไม่ถูกต้อง/);
  const code = A.saveItem(d, { code: " rb-dm09-01-bk01-200-0-50 ", kind: "RB", name: "เส้นใหม่", uom: "rod", weightG: 900, rubber: { compound: "dm09", type: "01", kgPerRoll: "0.9", pcsPerRoll: "20", sePerGr: "" } }, ctx("planner"));
  assert.equal(code, "RB-DM09-01-BK01-200-0-50");
  const item = A.helpers.itemOf(d, code);
  assert.equal(item.ownerDept, "RB", "owner department follows the kind (used to split jobs)");
  assert.equal(item.rubber.pcsPerRoll, 20);
  assert.equal(item.rubber.compound, "DM09");
  assert.ok(d.compounds.some((compound) => compound.code === "DM09" && compound.recipeId === null), "unknown compound is registered unlinked");
  A.saveItem(d, { code, kind: "RB", name: "เส้นใหม่ (แก้ชื่อ)", uom: "rod" }, ctx("manager"));
  assert.equal(A.helpers.itemOf(d, code).rubber.compound, "DM09", "rubber data survives an edit without rubber fields");
  A.saveItem(d, { code: "SE-TP01-OR01-100-18-65", kind: "SE", name: "ลูกตอปิโด", uom: "pcs", rubber: { color: "or02", lengthMm: "100", holeMm: "", odMm: "65" } }, ctx("planner"));
  assert.deepEqual(A.helpers.itemOf(d, "SE-TP01-OR01-100-18-65").rubber, { product: "TP01", color: "OR02", lengthMm: 100, odMm: 65 }, "blank form field clears the hole, numbers are numbers, product (no form field) survives");
  rejects(() => A.saveItem(d, { code: "DEMO-TP-01(P)-Y", kind: "SE", name: "x", uom: "set" }, ctx("admin")), /เปลี่ยนชนิด/);
  const pt = A.helpers.itemOf(d, "PT-00320");
  A.saveItem(d, { code: "PT-00320", kind: "PT", name: pt.name, uom: "pcs", ownerDept: "BG" }, ctx("planner"));
  assert.equal(pt.ownerDept, "BG");
  assert.ok(d.boms.filter((bom) => bom.itemCode === "PT-00320").every((bom) => bom.ownerDept === "BG"), "the BOMs of the item follow the new owner");
  A.saveItem(d, { code: "PT-00320", kind: "PT", name: pt.name, uom: "pcs" }, ctx("manager"));
  assert.equal(pt.ownerDept, "BG", "no ownerDept in the payload keeps the current owner");
  rejects(() => A.linkCompound(d, { code: "DM09", recipeId: "RC-X" }, ctx("gr")), /แผนก RB/);
  A.linkCompound(d, { code: "DM09", recipeId: "RC-NR-AM01", recipeName: "NR ยางกันสะเทือน" }, ctx("rb"));
  assert.equal(d.compounds.find((compound) => compound.code === "DM09").recipeId, "RC-NR-AM01");
  A.linkCompound(d, { code: "DM09", recipeId: "" }, ctx("planner"));
  assert.equal(d.compounds.find((compound) => compound.code === "DM09").recipeId, null);
});

test("saveBomTree saves a whole multi-level tree in one call: new items, nested BOMs, patches of RB cutting data, cycles refused", () => {
  const d = fresh();
  rejects(() => A.saveBomTree(d, { code: "NEW-01", nodes: [] }, ctx("gr")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.saveBomTree(d, { code: "NEW-01", nodes: [{ code: "P-STK-01", qty: 1 }] }, ctx("planner")), /ระบุชื่อและหน่วย/);
  rejects(() => A.saveBomTree(d, { code: "NEW-01", item: { name: "x", uom: "set" }, nodes: [] }, ctx("planner")), /อย่างน้อย 1 บรรทัด/);
  rejects(() => A.saveBomTree(d, { code: "NEW-01", item: { name: "x", uom: "set" }, nodes: [{ code: "ZZZ-1", qty: 1 }] }, ctx("planner")), /ไม่พบชิ้นงาน ZZZ-1/);
  rejects(() => A.saveBomTree(d, { code: "NEW-01", item: { name: "x", uom: "set" }, nodes: [{ code: "P-STK-01", qty: 1, children: [{ code: "P-BOX-01", qty: 1 }] }] }, ctx("planner")), /ของซื้อ.*มีส่วนประกอบไม่ได้/);
  rejects(() => A.saveBomTree(d, { code: "NEW-01", item: { name: "x", uom: "set" }, nodes: [{ code: "SE-TP01-OR01-100-18-65", qty: 1, children: [{ code: "NEW-01", qty: 1 }] }] }, ctx("planner")), /ซ้อนอยู่ใต้ตัวเอง/);
  // (เรียกตรง ๆ ร่างที่ล้มถูกแก้ค้างได้ ส่วน store ทิ้งร่างที่ล้มทั้งก้อน — ทดสอบใน "the store persists")
  const result = A.saveBomTree(d, {
    code: "new-tp-02(p)-y", item: { name: "ตอปิโดใหม่", uom: "set" }, note: "สร้างครั้งแรก",
    nodes: [
      { code: "SE-NEW-01", qty: 2, newItem: { kind: "SE", name: "ชิ้นยางใหม่", uom: "pcs" }, children: [
        { code: "RB-DM01-02-BK01-202-18-70", qty: 0.05, newItem: { kind: "RB", name: "เส้นดำ", uom: "rod", weightG: "1500", rubber: { compound: "dm01", cutLengthCm: "6.5", pcsPerRoll: "31", sePerGr: "1", kgPerRoll: "1.5" } } },
      ] },
      { code: "P-STK-01", qty: 1 },
      { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] },
      { code: "RB-DM02-02-BK01-225-3-20", qty: 1, patch: { rubber: { compound: "DM02", cutLengthCm: "15", pcsPerRoll: "14", sePerGr: "1", kgPerRoll: "0.17" } } },
    ],
  }, ctx("planner"));
  assert.equal(result.code, "NEW-TP-02(P)-Y");
  assert.deepEqual(result.saved, ["SE-NEW-01 Rev.1", "NEW-TP-02(P)-Y Rev.1"], "PT-00320's BOM is unchanged so no new revision for it");
  const fg = A.helpers.itemOf(d, "NEW-TP-02(P)-Y");
  assert.equal(fg.kind, "FG");
  assert.equal(fg.ownerDept, "PK");
  const se = A.helpers.itemOf(d, "SE-NEW-01");
  assert.equal(se.ownerDept, "GR");
  const rb = A.helpers.itemOf(d, "RB-DM01-02-BK01-202-18-70");
  assert.equal(rb.ownerDept, "RB");
  assert.equal(rb.rubber.pcsPerRoll, 31);
  assert.equal(rb.rubber.compound, "DM01");
  assert.equal(rb.weightG, 1500);
  assert.equal(approved(d, "SE-NEW-01").lines[0].qty, 0.05);
  assert.equal(A.helpers.itemOf(d, "RB-DM02-02-BK01-225-3-20").rubber.cutLengthCm, 15, "patch updated the cutting data of an existing RB");
  assert.deepEqual(approved(d, "NEW-TP-02(P)-Y").lines.map((line) => line.childCode), ["SE-NEW-01", "P-STK-01", "PT-00320", "RB-DM02-02-BK01-225-3-20"], "a new BOM keeps the order the tree sent (no re-sort by company flow)");
  assert.equal(approved(d, "NEW-TP-02(P)-Y").note, "สร้างครั้งแรก");
  // บันทึกซ้ำโดยไม่เปลี่ยนอะไร = ไม่มี revision ใหม่
  const again = A.saveBomTree(d, { code: "NEW-TP-02(P)-Y", item: { name: "ตอปิโดใหม่", uom: "set" }, nodes: [
    { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05 }] }, { code: "P-STK-01", qty: 1 }, { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 },
  ] }, ctx("planner"));
  assert.deepEqual(again.saved, []);
  assert.equal(again.summary, "ไม่มีการเปลี่ยนแปลง");
  assert.equal(again.changed, false);
  assert.equal(approved(d, "NEW-TP-02(P)-Y").revision, 1);
  // ส่งชุดเดิมแต่สลับลำดับ = เป็นการแก้ ("เรียงลำดับส่วนประกอบใหม่") ลำดับที่ส่งมาคือลำดับที่เก็บ
  // คนเดิมวันเดียวกัน (U9 · 20261129010000) = แก้ในฉบับเดิม (Rev.1 ต่อท้ายประวัติ) · วันถัดไป = ฉบับใหม่ Rev.2
  const reorderNodes = [
    { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] }, { code: "P-STK-01", qty: 1 }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 }, { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05 }] },
  ];
  const reordered = structuredClone(d);
  const reorderedSave = A.saveBomTree(reordered, { code: "NEW-TP-02(P)-Y", nodes: reorderNodes }, ctx("planner"));
  assert.deepEqual(reorderedSave.saved, ["NEW-TP-02(P)-Y Rev.1"]);
  assert.deepEqual(approved(reordered, "NEW-TP-02(P)-Y").lines.map((line) => line.childCode), ["PT-00320", "P-STK-01", "RB-DM02-02-BK01-225-3-20", "SE-NEW-01"]);
  assert.equal(approved(reordered, "NEW-TP-02(P)-Y").changeLog.length, 2);
  assert.match(approved(reordered, "NEW-TP-02(P)-Y").changeLog[1].text, /เรียงลำดับส่วนประกอบใหม่/);
  const nextDay = structuredClone(d);
  assert.deepEqual(A.saveBomTree(nextDay, { code: "NEW-TP-02(P)-Y", nodes: reorderNodes }, ctx("planner", NOW + DAY)).saved, ["NEW-TP-02(P)-Y Rev.2"]);
  assert.match(approved(nextDay, "NEW-TP-02(P)-Y").changeLog[0].text, /เรียงลำดับส่วนประกอบใหม่/);
  const auditCount = d.audit.length;
  assert.ok(!d.audit.slice(0, 3).some((entry) => entry.action === "บันทึกต้นไม้ BOM" && entry.detail.includes("ไม่มีการเปลี่ยนแปลง")), "no audit row for a no-op save");
  // แก้แค่ข้อมูลการตัดของ RB (patch) โดย BOM ไม่เปลี่ยน: ผลลัพธ์บอกว่าแก้ชิ้น ไม่ใช่ "ไม่มีการเปลี่ยนแปลง"
  const patchOnly = A.saveBomTree(d, { code: "NEW-TP-02(P)-Y", nodes: [
    { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05, patch: { rubber: { compound: "DM01", cutLengthCm: "7", pcsPerRoll: "31", sePerGr: "1", kgPerRoll: "1.5" } } }] }, { code: "P-STK-01", qty: 1 }, { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 },
  ] }, ctx("planner"));
  assert.equal(patchOnly.changed, true);
  assert.deepEqual(patchOnly.saved, []);
  assert.deepEqual(patchOnly.patched, ["RB-DM01-02-BK01-202-18-70"]);
  assert.match(patchOnly.summary, /แก้ข้อมูลชิ้น: RB-DM01-02-BK01-202-18-70/);
  assert.ok(d.audit.length > auditCount);
  // ชิ้นเดียวกันสองที่ในต้นไม้ด้วยลูกต่างกัน → ปฏิเสธ (ไม่ทิ้งลูกชุดที่สองเงียบ ๆ)
  rejects(() => A.saveBomTree(d, { code: "NEW-TP-02(P)-Y", nodes: [
    { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05 }] }, { code: "P-STK-01", qty: 1 },
    { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 },
    { code: "SE-TP01-BK01-140-3-20", qty: 1, children: [{ code: "RB-DM02-02-BK01-225-3-20", qty: 0.0714 }] },
    { code: "SE-NEW-01", qty: 1, children: [{ code: "RB-DM02-02-BK01-225-3-20", qty: 1 }] },
  ] }, ctx("planner")), /ปรากฏหลายที่ในต้นไม้ด้วยส่วนประกอบต่างกัน/);
  // แก้ชั้นลึก (PT → เม็ด) จากต้นไม้ของสินค้าใหม่ มีผลกับ PT ที่สินค้าอื่นใช้ร่วมด้วย
  const third = A.saveBomTree(d, { code: "NEW-TP-02(P)-Y", nodes: [
    { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05 }] }, { code: "P-STK-01", qty: 1 }, { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.025 }] }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 },
  ] }, ctx("manager"));
  assert.deepEqual(third.saved, ["PT-00320 Rev.2"]);
  assert.equal(approved(d, "PT-00320").lines[0].qty, 0.025);
  // ใบสั่งผลิตใช้สินค้าใหม่ได้ทันที
  const id = A.createOrder(d, { pi: "T-1", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(5) }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "NEW-TP-02(P)-Y", qty: 10 }, ctx("planner"));
  assert.ok(A.explodeOrder(d, { orderId: id }, ctx("planner")) >= 6);
});

test("a production order explodes with the current revisions, locks them at release and spawns one job per department × item", () => {
  const d = fresh();
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("gr")), /ฝ่ายวางแผน/);
  rejects(() => A.createOrder(d, { pi: "DEMO-26001", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner")), /อยู่แล้ว/);
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(5), whDue: day(1) }, ctx("planner")), /ไม่ก่อนวันที่สั่งผลิต/);
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10), due: { RB: day(12) } }, ctx("planner")), /กำหนดเสร็จ RB/);
  rejects(() => A.createOrder(d, { pi: "N-1", customer: "x", country: "Thailand", orderedAt: null, whDue: "" }, ctx("planner")), /วันที่สั่งผลิต/);
  const id = A.createOrder(d, { pi: "x-1", customer: "ลูกค้า ก", country: "Thailand", orderedAt: day(0), whDue: day(10), due: { RB: day(3), PK: day(9) } }, ctx("planner"));
  assert.equal(id, "X-1");
  const order = d.orders.find((entry) => entry.id === id);
  assert.equal(order.orderType, "SA");
  // ประเภทออร์เดอร์: เลือกมาใช้ตามนั้น ไม่ส่ง = เดาจากประเทศ ค่าอื่นปฏิเสธ (เดิมสะกดประเทศต่างจาก Thailand กลายเป็น EX เงียบ ๆ)
  const typed = A.createOrder(d, { pi: "T-EX", customer: "ข", country: "Thailand", orderType: "ex", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  assert.equal(d.orders.find((entry) => entry.id === typed).orderType, "EX", "an explicit order type wins over the country guess");
  const guessed = A.createOrder(d, { pi: "T-GUESS", customer: "ข", country: "ประเทศไทย", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  assert.equal(d.orders.find((entry) => entry.id === guessed).orderType, "EX", "without a type the country guess still applies");
  rejects(() => A.createOrder(d, { pi: "T-BAD", customer: "ข", country: "Thailand", orderType: "XX", orderedAt: day(0), whDue: day(10) }, ctx("planner")), /ประเภทออร์เดอร์ไม่ถูกต้อง/);
  rejects(() => A.explodeOrder(d, { orderId: id }, ctx("planner")), /ยังไม่มีสินค้า/);
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "DEMO-BL-60(K)-Z", qty: 10 }, ctx("planner")), /ยังไม่มี BOM/);
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "SE-TP01-OR01-100-18-65", qty: 10 }, ctx("planner")), /สินค้าสำเร็จรูป/);
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 50 }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 30 }, ctx("planner"));
  assert.deepEqual(order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), [["DEMO-TP-01(P)-Y", 80, "Y"]], "the same product is merged into one line");
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, ctx("planner"));
  assert.equal(A.explodeOrder(d, { orderId: id }, ctx("planner")), 23);
  const rbLine = order.explosion.find((line) => line.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rbLine.required.toFixed(2), "7.74");
  assert.equal(rbLine.fgQty, 80);
  assert.equal(order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision, 2);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "SE-BL60-RD01-60-0-60", qty: 1 }, ctx("st")), /ไม่อยู่ในใบ/);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "PT-00320", qty: 1 }, ctx("gr")), /คลัง/);
  A.setStockCount(d, { orderId: id, itemCode: "PT-00320", qty: 3 }, ctx("st"));
  assert.equal(order.stockCounts["PT-00320"], 3);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 3 }, ctx("st")), /คลังของซื้อ/, "purchased parts are counted on the part stock page, not per PI");
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "DEMO-TP-01(P)-Y", qty: 1 }, ctx("st")), /สินค้าสำเร็จรูป/);
  // นับหลายรายการพร้อมกัน: ว่าง = ไม่แตะ · รายการผิดตัวเดียวทั้งชุดไม่บันทึก (store ทำบนร่าง) · ซ้ำถูกปฏิเสธ
  assert.deepEqual(A.setStockCounts(d, { orderId: id, counts: [{ itemCode: "SE-TP01-BK01-140-3-20", qty: "5" }, { itemCode: "SE-TP01-OR01-100-18-65", qty: "" }, { itemCode: "pt-00320", qty: 0 }] }, ctx("st")), { changed: 2, summary: "2 รายการ" });
  assert.equal(A.setStockCounts(d, { orderId: id, counts: [{ itemCode: "SE-TP01-BK01-140-3-20", qty: "5.0" }] }, ctx("st")).summary, "0 รายการ (ยอดเท่าเดิมทั้งหมด)");
  assert.deepEqual([order.stockCounts["SE-TP01-BK01-140-3-20"], order.stockCounts["PT-00320"], order.stockCounts["SE-TP01-OR01-100-18-65"]], [5, 0, undefined]);
  rejects(() => A.setStockCounts(d, { orderId: id, counts: [{ itemCode: "PT-00320", qty: "" }] }, ctx("st")), /ยังไม่ได้กรอก/);
  rejects(() => A.setStockCounts(d, { orderId: id, counts: [{ itemCode: "PT-00320", qty: 1 }, { itemCode: "pt-00320", qty: 2 }] }, ctx("st")), /ซ้ำ/);
  rejects(() => A.setStockCounts(d, { orderId: id, counts: [{ itemCode: "PT-00320", qty: 1 }] }, ctx("gr")), /คลัง/);
  rejects(() => A.setStockCounts(structuredClone(d), { orderId: id, counts: [{ itemCode: "PT-00320", qty: 1 }, { itemCode: "P-BOX-01", qty: 1 }] }, ctx("st")), /คลังของซื้อ/, "one purchased part in the batch refuses the whole batch (the store runs actions on a draft)");
  A.removeOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A" }, ctx("planner"));
  assert.equal(order.explosion, null);
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, ctx("planner"));
  // แก้ BOM ของ SE ก่อนปล่อยผลิต: การปล่อยใช้ revision ล่าสุด
  A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "RB-DM01-02-OR01-202-18-70", qty: 0.05 }] }, ctx("planner"));
  rejects(() => A.releaseOrder(d, { orderId: id }, ctx("rb")), /ฝ่ายวางแผน/);
  const jobsBefore = d.jobs.length;
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  assert.equal(order.status, "released");
  assert.equal(order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision, 3, "release re-explodes with the latest revision");
  assert.ok(Math.abs(order.explosion.find((line) => line.itemCode === "RB-DM01-02-OR01-202-18-70").required - 12) < 1e-9, "80 × 3 × 0.05 with the new revision");
  const jobs = d.jobs.filter((job) => job.orderId === id);
  assert.equal(d.jobs.length - jobsBefore, jobs.length);
  assert.equal(jobs.filter((job) => job.dept === "PK" && job.kind === "FG").length, 2);
  assert.equal(jobs.filter((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70").length, 1);
  assert.equal(jobs.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70").dueAt, day(3), "department due date from the order header");
  assert.equal(jobs.find((job) => job.itemCode === "BG-0092").dueAt, day(10), "no BG date → warehouse due date");
  // ของซื้อ: หนึ่งงาน ST ต่อรายการที่ระเบิดได้ ยอด = ความต้องการเต็ม (ไม่หักยอดนับ) กำหนด = ช่อง ST ของใบ ไม่มีก็วันส่งคลัง
  const partJobs = jobs.filter((job) => job.kind === "PURCHASED");
  assert.ok(partJobs.length > 0 && partJobs.every((job) => job.dept === "ST" && job.status === "queued" && job.stockCounted === null && job.qtyPlanned === job.qtyRequired && job.qtyDone === 0));
  const boxJob = partJobs.find((job) => job.itemCode === "P-BOX-01");
  assert.equal(boxJob.qtyPlanned, order.explosion.filter((line) => line.itemCode === "P-BOX-01").reduce((sum, line) => sum + line.required, 0), "gross requirement across both products");
  assert.equal(boxJob.dueAt, day(10), "no ST date → warehouse due date");
  const purchasedCodes = [...new Set(order.explosion.filter((line) => line.kind === "PURCHASED").map((line) => line.itemCode))].sort();
  assert.deepEqual(partJobs.map((job) => job.itemCode).sort(), purchasedCodes, "one job per purchased item");
  assert.equal(jobs.find((job) => job.kind === "FG" && job.itemCode === "DEMO-TP-01(P)-Y").qtyPlanned, 80, "PK jobs carry the ordered quantity");
  rejects(() => A.explodeOrder(d, { orderId: id }, ctx("planner")), /ร่าง/);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 9 }, ctx("st")), /ปล่อยผลิตแล้ว งานรายแผนกไม่เปลี่ยนตาม/, "counting after release would desync the jobs");
  // แก้ BOM หลังปล่อยผลิต: ใบที่ปล่อยแล้วไม่เปลี่ยน
  A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "RB-DM01-02-OR01-202-18-70", qty: 0.5 }] }, ctx("planner"));
  assert.equal(order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision, 3);
  // คงคลังที่นับลดงานแบบไล่ชั้น: SE ในคลังลดเส้น RB ที่ต้องรีด และชิ้นที่คลังมีพอไม่เกิดงาน (คอลัมน์ AK ของ BOMSHEET)
  const d3 = fresh();
  const id3 = A.createOrder(d3, { pi: "N-3", customer: "ก", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  A.addOrderItem(d3, { orderId: id3, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner"));
  A.explodeOrder(d3, { orderId: id3 }, ctx("planner"));
  const seNeeded = d3.orders.find((entry) => entry.id === id3).explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").required; // 240
  const rbPerSe = approved(d3, "SE-TP01-OR01-100-18-65").lines.find((line) => line.childCode === "RB-DM01-02-OR01-202-18-70").qty;
  A.setStockCount(d3, { orderId: id3, itemCode: "SE-TP01-OR01-100-18-65", qty: 100 }, ctx("st"));
  A.setStockCount(d3, { orderId: id3, itemCode: "PT-00320", qty: 500 }, ctx("st"));
  A.releaseOrder(d3, { orderId: id3 }, ctx("planner"));
  const jobs3 = d3.jobs.filter((job) => job.orderId === id3);
  const se3 = jobs3.find((job) => job.itemCode === "SE-TP01-OR01-100-18-65");
  assert.deepEqual([se3.qtyRequired, se3.stockCounted, se3.qtyPlanned], [seNeeded, 100, seNeeded - 100]);
  const rb3 = jobs3.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.ok(Math.abs(rb3.qtyRequired - (seNeeded - 100) * rbPerSe) < 1e-4, "RB demand is derived from the SE shortage, not the full SE requirement");
  assert.equal(rb3.qtyPlanned, Math.ceil(rb3.qtyRequired - 1e-6), "whole rods");
  assert.equal(rules.wholeRods("RB", "kg", 1.25), 1.25, "rubber counted in kg is not rounded");
  assert.equal(rules.wholeRods("SE", "pcs", 2.5), 2.5, "only rubber rods and rolls are rounded");
  assert.equal(rules.wholeRods("RB", "rod", 3.0000004), 3, "float noise does not add a rod");
  assert.equal(rules.wholeRods("RB", "roll", 0.4091), 1, "rolls are whole too");
  assert.equal(rules.wholeRods("RB", "rod", 0.0001), 1, "the smallest need still makes one rod");
  assert.equal(jobs3.find((job) => job.itemCode === "PT-00320"), undefined, "enough stock → no job");
  assert.match(d3.audit[0].detail, /1 ชิ้นมีคงคลังพอ ไม่สร้างงาน/);
  // ชิ้นที่ต้องผลิตแต่ไม่มี BOM (BG ของกระเป๋า) → ปล่อยไม่ได้
  const d2 = fresh();
  approved(d2, "BG-0092").status = "superseded";
  rejects(() => A.releaseOrder(d2, { orderId: "DEMO-26002" }, ctx("planner")), /ยังไม่มี BOM: BG-0092/);
});

test("a product can be chosen by base code + package + color set; an unknown variant is created from a sibling's BOM", () => {
  const d = fresh();
  const id = A.createOrder(d, { pi: "P3", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(9) }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, base: "demo-tp-01", pkg: "p", colorSet: "y", qty: 10 }, ctx("planner"));
  const order = d.orders.find((entry) => entry.id === id);
  assert.deepEqual(order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), [["DEMO-TP-01(P)-Y", 10, "Y"]]);
  assert.equal(d.items.filter((item) => item.kind === "FG").length, 3, "no new item for an existing code");
  rejects(() => A.addOrderItem(d, { orderId: id, base: "NOPE-01", pkg: "P", colorSet: "Y", qty: 1 }, ctx("planner")), /ไม่มีฐานรหัส NOPE-01/);
  rejects(() => A.addOrderItem(d, { orderId: id, base: "", qty: 1 }, ctx("planner")), /ไม่พบสินค้า/);
  // ชุดสี A ของฐาน DEMO-TP-01 นิยามไว้ในชุดสาธิต (ลูก/ปีกแดง แกนดำ) และแพ็กเกจ P ด้วย → รุ่นใหม่เปลี่ยนสี SE ชั้นแรกและ RB ใต้ SE ให้เอง
  A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "A", qty: 5 }, ctx("planner"));
  const created = A.helpers.itemOf(d, "DEMO-TP-01(P)-A");
  assert.ok(created, "variant created");
  assert.equal(created.clonedFrom, "DEMO-TP-01(P)-Y");
  const bom = approved(d, created.code);
  assert.equal(bom.revision, 1);
  assert.match(bom.note, /คัดลอกจาก DEMO-TP-01\(P\)-Y Rev\.1/);
  assert.deepEqual(bom.lines.map((line) => [line.childCode, line.qty]), [["P-STK-01", 1], ["SE-TP01-RD01-100-18-65", 3], ["SE-TP01-BK01-140-3-20", 3], ["SE-TP01-RD01-75-3-30", 9], ["PT-00320", 0.3], ["XP-00001", 1], ["P-BAG-01", 0.01], ["P-BOX-01", 0.025]], "orange SE slots become red, the black core stays, packaging lines come from the package definition");
  assert.match(bom.changeLog.map((entry) => entry.text).join(" | "), /ชุดสี A: SE-TP01-OR01-100-18-65 → SE-TP01-RD01-100-18-65, SE-TP01-OR01-75-3-30 → SE-TP01-RD01-75-3-30/);
  assert.match(bom.changeLog.map((entry) => entry.text).join(" | "), /แพ็กเกจ P: ถอด P-BAG-01, P-BOX-01 ใส่ P-BAG-01 × 0.0100, P-BOX-01 × 0.0250/);
  const redSe = A.helpers.itemOf(d, "SE-TP01-RD01-100-18-65");
  assert.equal(redSe.name, "ลูกตอปิโด TP-01 แดง RD01 ยาว 100", "the new SE item is named after the new colour");
  assert.deepEqual([redSe.kind, redSe.ownerDept, redSe.rubber.color, redSe.clonedFrom], ["SE", "GR", "RD01", "SE-TP01-OR01-100-18-65"]);
  const redSeBom = approved(d, "SE-TP01-RD01-100-18-65");
  assert.deepEqual(redSeBom.lines.map((line) => line.childCode), ["RB-DM01-02-RD01-202-18-70", "RB-DM01-01-RD01-200-0-72"], "the rods under a recoloured SE take the SE's colour");
  assert.equal(redSeBom.lines[0].qty, approved(d, "SE-TP01-OR01-100-18-65").lines[0].qty, "rod ratios are kept");
  const redRb = A.helpers.itemOf(d, "RB-DM01-02-RD01-202-18-70");
  assert.deepEqual([redRb.kind, redRb.rubber.compound, redRb.rubber.color, redRb.rubber.pcsPerRoll, redRb.weightG], ["RB", "DM01", "RD01", 31, 1530], "a recoloured rod keeps compound, cutting data and weight");
  assert.equal(A.helpers.itemOf(d, "SE-TP01-BK01-140-3-20").clonedFrom, undefined, "an unchanged slot reuses the existing item");
  assert.deepEqual(approved(d, "SE-TP01-RD01-75-3-30").lines.map((line) => line.childCode), ["RB-DM03-03-YE03-3000-3-130"], "a rod whose colour differs from the SE's old colour (yellow sheet under an orange wing) is kept");
  assert.match(bom.changeLog.map((entry) => entry.text).join(" | "), /RB-DM03-03-YE03-3000-3-130 ใต้ SE-TP01-RD01-75-3-30 คงสี YE03/);
  assert.notEqual(bom.lines, approved(d, "DEMO-TP-01(P)-Y").lines, "lines are copied, not shared");
  // แพ็กเกจ B (กล่องเดี่ยว) ของชุดสี A: ต้นแบบคือ (P)-A ที่เพิ่งสร้าง สีตรงอยู่แล้ว บรรจุภัณฑ์ถูกสลับ
  assert.equal(A.createVariant(d, { base: "DEMO-TP-01", pkg: "B", colorSet: "A" }, ctx("planner")), "DEMO-TP-01(B)-A");
  const boxed = approved(d, "DEMO-TP-01(B)-A");
  assert.equal(A.helpers.itemOf(d, "DEMO-TP-01(B)-A").clonedFrom, "DEMO-TP-01(P)-A");
  assert.deepEqual(boxed.lines.filter((line) => line.childCode.startsWith("P-B")).map((line) => [line.childCode, line.qty]), [["P-BOX-01", 1 / 12]], "the bag is removed and the single box is added");
  assert.match(boxed.changeLog.map((entry) => entry.text).join(" | "), /ชุดสี A: สีตรงกับต้นแบบอยู่แล้ว/);
  rejects(() => A.createVariant(d, { base: "DEMO-TP-01", pkg: "B", colorSet: "A" }, ctx("planner")), /อยู่แล้ว/);
  rejects(() => A.createVariant(d, { base: "DEMO-TP-01", pkg: "B", colorSet: "C" }, ctx("gr")), /ฝ่ายวางแผน/);
  // ฐานที่ยังไม่มีนิยาม: คัดลอกตรงและบันทึกไว้ว่าสียังเป็นของต้นแบบ
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", pkg: "B", colorSet: "C", qty: 2 }, ctx("planner"));
  const hl = approved(d, "DEMO-HL-24(B)-C");
  assert.deepEqual(hl.lines.map((line) => line.childCode), approved(d, "DEMO-HL-24(B)-A").lines.map((line) => line.childCode));
  assert.match(hl.changeLog.map((entry) => entry.text).join(" | "), /ยังไม่มีนิยามชุดสี C ของฐาน DEMO-HL-24/);
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", qty: 2 }, ctx("planner"));
  assert.ok(A.helpers.itemOf(d, "DEMO-HL-24"));
  assert.equal(A.helpers.pickSibling(A.helpers.siblingsOf(d, "DEMO-TP-01"), "P", "A").code, "DEMO-TP-01(P)-A", "exact variant preferred");
  assert.equal(A.helpers.pickSibling(A.helpers.siblingsOf(d, "DEMO-TP-01"), "X", "A").code, "DEMO-TP-01(P)-A", "then same color set");
  rejects(() => A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "Z", qty: 1 }, ctx("gr")), /ฝ่ายวางแผน/);
  assert.ok(A.explodeOrder(d, { orderId: id }, ctx("planner")) > 20);
});

test("an order without a PI number gets YYMMDD-YYnnn with a per-year sequence, and empty department due dates can be filled from lead times", () => {
  const d = fresh();
  const ordered = new Date(2026, 9, 30).getTime();
  const wh = new Date(2026, 11, 15).getTime();
  const first = A.createOrder(d, { customer: "ก", country: "Belgium", orderedAt: ordered, whDue: wh, autoDue: true }, ctx("planner"));
  assert.equal(first, "261030-26001");
  const second = A.createOrder(d, { pi: "", customer: "ข", country: "Thailand", orderedAt: new Date(2026, 10, 2).getTime(), whDue: wh }, ctx("planner"));
  assert.equal(second, "261102-26002", "the sequence counts per year, the date part follows the order date");
  A.createOrder(d, { pi: "261030-26003", customer: "ค", country: "Thailand", orderedAt: ordered, whDue: wh }, ctx("planner"));
  assert.equal(A.createOrder(d, { customer: "ง", country: "Thailand", orderedAt: ordered, whDue: wh }, ctx("planner")), "261030-26004", "a number typed by hand is skipped");
  assert.equal(A.createOrder(d, { customer: "จ", country: "Thailand", orderedAt: new Date(2027, 0, 5).getTime(), whDue: new Date(2027, 1, 1).getTime() }, ctx("planner")), "270105-27001", "a new year restarts the sequence");
  assert.match(d.audit.find((entry) => entry.detail.startsWith("261030-26001")).detail, /ออกเลขอัตโนมัติ/);
  // autoDue: ช่องว่างถูกเติมจาก lead time ช่องที่กรอกเองคงเดิม
  const auto = d.orders.find((order) => order.id === first);
  const day = (ms) => new Date(ms).getDate();
  assert.deepEqual(Object.fromEntries(Object.entries(auto.due).map(([dept, ms]) => [dept, day(ms)])), { RB: 4, GR: 8, PT: 8, BG: 8, ST: 8, PK: 14 });
  assert.deepEqual(auto.dueDefaults, ["RB", "GR", "PT", "BG", "ST", "PK"]);
  const manual = d.orders.find((order) => order.id === second);
  assert.deepEqual(manual.due, {}, "without autoDue nothing is filled (existing behaviour)");
  const mixed = A.createOrder(d, { customer: "ฉ", country: "Thailand", orderedAt: ordered, whDue: wh, autoDue: true, due: { RB: new Date(2026, 10, 20).getTime() } }, ctx("planner"));
  const mixedOrder = d.orders.find((order) => order.id === mixed);
  assert.equal(day(mixedOrder.due.RB), 20, "a typed date wins over the default");
  assert.deepEqual(mixedOrder.dueDefaults, ["GR", "PT", "BG", "ST", "PK"]);
  // กำหนดเสร็จเริ่มต้นไม่ก่อนวันสั่งผลิต (ใบด่วน)
  const rush = A.createOrder(d, { customer: "ช", country: "Thailand", orderedAt: ordered, whDue: ordered + 2 * DAY, autoDue: true }, ctx("planner"));
  const rushOrder = d.orders.find((order) => order.id === rush);
  assert.ok(Object.values(rushOrder.due).every((ms) => ms >= new Date(ordered).setHours(0, 0, 0, 0) && ms <= rushOrder.whDue));
});

test("colours, colour sets and packages are data: learned from a product, validated, and removable", () => {
  const d = fresh();
  assert.deepEqual(d.colors.map((color) => color.code), ["OR01", "RD01", "BK01", "YE03", "BL02", "GN05"]);
  const learned = A.helpers.colorSetOf(d, "DEMO-TP-01", "Y");
  assert.deepEqual(learned.slots, [{ key: "SE-TP01-*-100-18-65", color: "OR01" }, { key: "SE-TP01-*-140-3-20", color: "BK01" }, { key: "SE-TP01-*-75-3-30", color: "OR01" }], "set Y is learned from the first-level SE lines of DEMO-TP-01(P)-Y");
  assert.equal(learned.name, "จาก DEMO-TP-01(P)-Y");
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "B", slots: [{ key: "SE-TP01-*-100-18-65", color: "PURPLE" }] }, ctx("planner")), /รหัสสี PURPLE ไม่ถูกต้อง/);
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "B", slots: [{ key: "SE-TP01-100-18-65", color: "PU01" }] }, ctx("planner")), /กุญแจช่องสี/);
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "B", slots: [] }, ctx("planner")), /อย่างน้อย 1 ช่อง/);
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "toolong", slots: [{ key: "SE-TP01-*-100-18-65", color: "PU01" }] }, ctx("planner")), /ยาวเกิน 4/);
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "AB", slots: [{ key: "SE-TP01-*-100-18-65", color: "PU01" }] }, ctx("planner")), /ตัวเดียว/, "two letters would not be read back by parseFgCode");
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "1", slots: [{ key: "SE-TP01-*-100-18-65", color: "PU01" }] }, ctx("planner")), /ตัวเดียว/);
  rejects(() => A.saveColorSet(d, { base: "DEMO-TP-01", code: "B", slots: [{ key: "SE-TP01-*-100-18-65", color: "PU01" }] }, ctx("gr")), /ฝ่ายวางแผน/);
  A.saveColorSet(d, { base: "demo-tp-01", code: "b", slots: [{ key: "se-tp01-*-100-18-65", color: "pu01" }] }, ctx("planner"));
  assert.ok(d.colors.some((color) => color.code === "PU01" && color.name === "ม่วง 01"), "an unknown colour is registered with its master name");
  A.saveColorSet(d, { base: "DEMO-TP-01", code: "B", name: "ม่วง", slots: [{ key: "SE-TP01-*-100-18-65", color: "PU01" }, { key: "SE-TP01-*-75-3-30", color: "PU01" }] }, ctx("planner"));
  assert.equal(d.colorSets.filter((set) => set.base === "DEMO-TP-01" && set.code === "B").length, 1, "saving again replaces the set");
  assert.equal(A.helpers.colorSetOf(d, "DEMO-TP-01", "B").slots.length, 2);
  A.saveColor(d, { code: "pu01", name: "ม่วงเข้ม" }, ctx("manager"));
  assert.equal(d.colors.find((color) => color.code === "PU01").name, "ม่วงเข้ม");
  A.removeColorSet(d, { base: "DEMO-TP-01", code: "B" }, ctx("planner"));
  rejects(() => A.removeColorSet(d, { base: "DEMO-TP-01", code: "B" }, ctx("planner")), /ไม่พบ/);
  rejects(() => A.learnColorSet(d, { fgCode: "DEMO-HL-24" }, ctx("planner")), /ไม่พบสินค้า/);
  // สีที่ไม่ตรงรูปแบบ (ข้อมูลเก่า) ไม่ทำให้บันทึกชุดสีจากสินค้าไม่ได้ ช่องนั้นเว้นว่าง
  A.helpers.itemOf(d, "SE-HL24-YE03-400-19-30").rubber.color = "ORANGE";
  A.learnColorSet(d, { fgCode: "DEMO-HL-24(B)-A" }, ctx("planner"));
  const hlSet = A.helpers.colorSetOf(d, "DEMO-HL-24", "A");
  assert.deepEqual(hlSet.slots, [{ key: "SE-HL24-*-400-19-30", color: "" }]);
  assert.equal(hlSet.name, "จาก DEMO-HL-24(B)-A");
  assert.match(hlSet.note, /SE-HL24-YE03-400-19-30=ORANGE ไม่ตรงรูปแบบ/);
  assert.match(d.audit[0].detail, /ORANGE ไม่ตรงรูปแบบ/);
  // แพ็กเกจ
  assert.deepEqual(A.helpers.packageOf(d, "DEMO-TP-01", "P").lines, [{ childCode: "P-BAG-01", qty: 0.01 }, { childCode: "P-BOX-01", qty: 0.025 }]);
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [{ childCode: "NOPE", qty: 1 }] }, ctx("planner")), /ไม่พบชิ้นงาน NOPE/);
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [{ childCode: "DEMO-HL-24(B)-A", qty: 1 }] }, ctx("planner")), /ต้องเป็นของซื้อ/);
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [{ childCode: "SE-TP01-BK01-140-3-20", qty: 1 }] }, ctx("planner")), /ชิ้นยาง.*ต้องเป็นของซื้อ/, "a manufactured part cannot be declared packaging (it would be silently removed from new variants)");
  // แพ็กเกจที่นิยามไม่ครบ: บรรทัดบรรจุภัณฑ์ของต้นแบบที่ไม่อยู่ในแพ็กเกจเป้าหมายถูกถอดและบอกไว้ชัด
  A.savePackage(d, { base: "DEMO-TP-01", code: "N", name: "กล่อง + สติ๊กเกอร์", lines: [{ childCode: "P-BOX-01", qty: 0.1 }, { childCode: "P-STK-01", qty: 1 }] }, ctx("planner"));
  A.createVariant(d, { base: "DEMO-TP-01", pkg: "P", colorSet: "A" }, ctx("planner"));
  const noSticker = approved(d, "DEMO-TP-01(P)-A");
  assert.ok(!noSticker.lines.some((line) => line.childCode === "P-STK-01"), "the sticker is treated as packaging once any package of the base lists it");
  assert.match(noSticker.changeLog.map((entry) => entry.text).join(" | "), /บรรจุภัณฑ์ของต้นแบบที่ไม่อยู่ในแพ็กเกจ P ถูกถอด: P-STK-01/);
  A.removePackage(d, { base: "DEMO-TP-01", code: "N" }, ctx("planner"));
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [{ childCode: "P-BOX-01", qty: 1 }, { childCode: "P-BOX-01", qty: 2 }] }, ctx("planner")), /ซ้ำ/);
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [{ childCode: "P-BOX-01", qty: 0 }] }, ctx("planner")), /ปริมาณ/);
  rejects(() => A.savePackage(d, { base: "DEMO-TP-01", code: "X", lines: [] }, ctx("planner")), /อย่างน้อย 1 บรรทัด/);
  A.savePackage(d, { base: "DEMO-TP-01", code: "X", name: "ไม่มีบรรจุภัณฑ์", lines: [{ childCode: "P-STK-01", qty: 1 }] }, ctx("planner"));
  assert.equal(d.packages.filter((entry) => entry.base === "DEMO-TP-01").length, 3);
  A.removePackage(d, { base: "DEMO-TP-01", code: "X" }, ctx("planner"));
  rejects(() => A.removePackage(d, { base: "DEMO-TP-01", code: "X" }, ctx("planner")), /ไม่พบ/);
});

test("jobs: the department reports output, hold/queue toggles, orders progress and the order closes once the warehouse has received everything and every department has closed its jobs", () => {
  const d = fresh();
  const orderId = "DEMO-26001";
  const job = d.jobs.find((entry) => entry.orderId === orderId && entry.itemCode === "SE-TP01-OR01-100-18-65");
  rejects(() => A.reportJob(d, { jobId: job.id, qtyDone: 10 }, ctx("rb")), /แผนก GR/);
  rejects(() => A.reportJob(d, { jobId: job.id }, ctx("gr")), /จำนวนดีหรือจำนวนเสีย/);
  rejects(() => A.reportJob(d, { jobId: job.id, qtyDone: -1 }, ctx("gr")), /มากกว่า 0/);
  A.reportJob(d, { jobId: job.id, qtyDone: 100, qtyReject: 3, note: "วันแรก" }, ctx("gr"));
  assert.equal(job.status, "in_progress");
  A.reportJob(d, { jobId: job.id, qtyDone: 140 }, ctx("manager"));
  assert.equal(job.status, "done");
  assert.equal(job.reports.length, 2);
  rejects(() => A.reportJob(d, { jobId: job.id, qtyDone: 1 }, ctx("gr")), /เสร็จแล้ว/);
  const bg = d.jobs.find((entry) => entry.orderId === orderId && entry.itemCode === "BG-0092");
  assert.equal(bg.status, "hold");
  rejects(() => A.setJobStatus(d, { jobId: bg.id, status: "weird" }, ctx("bg")), /สถานะ/);
  A.setJobStatus(d, { jobId: bg.id, status: "queued" }, ctx("bg"));
  assert.equal(bg.status, "queued");
  const order = d.orders.find((entry) => entry.id === orderId);
  const whCtx = { now: NOW, user: { id: "wh", role: "wh", dept: "WH", name: "คลังสินค้า" } };
  rejects(() => A.closeOrderShort(d, { orderId, note: "PK ทำไม่ครบ" }, whCtx), /PK/);
  assert.equal(A.completeOrder, undefined, "nobody closes an order by hand any more");
  rejects(() => A.cancelOrder(d, { orderId }, ctx("planner")), /เหตุผลที่ยกเลิก/);
  d.jobs.filter((entry) => entry.orderId === orderId && entry.dept === "PK").forEach((pk) => A.reportJob(d, { jobId: pk.id, qtyDone: pk.qtyPlanned }, ctx("planner")));
  // รับครบขณะที่แผนกอื่นยังเปิด: ใบยังไม่ปิด (20261125010000)
  const received = receiveFg(d, { orderId, lines: order.items.map((item) => ({ fgCode: item.fgCode, qty: item.qty })) }, whCtx);
  assert.equal(received.closed, false);
  assert.equal(order.status, "in_progress", "everything is received but other departments are open");
  assert.match(d.audit[0].detail, /รับครบ ใบยังไม่ปิด รองานของแผนก/);
  rejects(() => A.closeOrder(d, { orderId }, whCtx), /ยังไม่เสร็จ/);
  // ฝ่ายวางแผนปิดงานที่ยังเปิดทุกงาน (ไม่ใช่งานของซื้อ) แล้วคลังสินค้าปิดใบ
  d.jobs.filter((entry) => entry.orderId === orderId && entry.status !== "done" && !A.helpers.isPartJob(entry)).forEach((open) => A.setJobStatus(d, { jobId: open.id, status: "done", reason: "ไม่ผลิตต่อ ใช้ของค้างไลน์" }, ctx("planner")));
  A.closeOrder(d, { orderId }, whCtx);
  assert.equal(order.status, "completed");
  rejects(() => A.setStockCount(d, { orderId, itemCode: "PT-00320", qty: 1 }, ctx("st")), /ปิดแล้ว/);
  const leftover = d.jobs.filter((entry) => entry.orderId === orderId && entry.status !== "done");
  assert.ok(leftover.every(A.helpers.isPartJob), "only purchased-part lines can be left open on a closed order");
  assert.ok(leftover.every((entry) => !A.helpers.isOpenJob(d, entry)), "and none of them counts as open");
  A.releaseOrder(d, { orderId: "DEMO-26002" }, ctx("planner"));
  assert.ok(d.jobs.some((entry) => entry.orderId === "DEMO-26002"));
  A.cancelOrder(d, { orderId: "DEMO-26002", reason: "ลูกค้าเลื่อน" }, ctx("planner"));
  assert.equal(d.orders.find((entry) => entry.id === "DEMO-26002").status, "cancelled");
  const kept = d.jobs.filter((entry) => entry.orderId === "DEMO-26002");
  assert.ok(kept.length > 0 && kept.every((entry) => !A.helpers.isOpenJob(d, entry)), "the jobs of a cancelled order are kept but none counts as open");
  rejects(() => A.reportJob(d, { jobId: kept.find((entry) => !A.helpers.isPartJob(entry)).id, qtyDone: 1 }, ctx("planner")), /ไม่อยู่ในสถานะผลิต/);
});

test("cancelling an order: a reason of 3–200 characters, started work and output no longer block it, the jobs stay with their output", () => {
  const d = fresh();
  const orderId = "DEMO-26001";
  const order = d.orders.find((entry) => entry.id === orderId);
  rejects(() => A.cancelOrder(d, { orderId, reason: "ลูกค้ายกเลิก" }, ctx("rb")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.cancelOrder(d, { orderId }, ctx("planner")), /เหตุผลที่ยกเลิก \(อย่างน้อย 3 ตัวอักษร\)/);
  rejects(() => A.cancelOrder(d, { orderId, reason: "  ab " }, ctx("planner")), /อย่างน้อย 3/);
  rejects(() => A.cancelOrder(d, { orderId, reason: "ก".repeat(201) }, ctx("planner")), /ยาวเกิน 200/);
  const output = d.jobs.filter((job) => job.orderId === orderId).map((job) => [job.id, job.qtyDone]);
  assert.ok(output.some(([, qty]) => qty > 0), "the demo order has reported output");
  A.cancelOrder(d, { orderId, reason: "  ลูกค้ายกเลิกคำสั่งซื้อ  " }, ctx("planner"));
  assert.deepEqual([order.status, order.cancelReason, order.cancelledAt], ["cancelled", "ลูกค้ายกเลิกคำสั่งซื้อ", NOW]);
  assert.deepEqual(d.jobs.filter((job) => job.orderId === orderId).map((job) => [job.id, job.qtyDone]), output, "every job stays with its output");
  assert.match(d.audit[0].detail, /DEMO-26001 — ลูกค้ายกเลิกคำสั่งซื้อ/);
  rejects(() => A.cancelOrder(d, { orderId, reason: "ซ้ำ" }, ctx("planner")), /ถูกยกเลิกแล้ว/);
  // งานที่ผูก WO ที่เริ่มผลิตแล้วไม่กันการยกเลิก (ฐานข้อมูลหยุด WO ให้)
  const linked = d.orders.find((entry) => entry.id === "DEMO-26006");
  A.cancelOrder(d, { orderId: linked.id, reason: "ลูกค้ายกเลิกหลังเริ่มผลิต" }, { ...ctx("planner"), rfOrders: [{ id: seed.demoWoId(NOW, 0), sourceJobId: d.jobs.find((job) => job.orderId === linked.id && job.dept === "RB").id, status: "in_progress" }] });
  assert.equal(linked.status, "cancelled");
});

test("holding a job needs a reason that is kept as a zero entry marked hold; resuming a job with output goes back to in progress", () => {
  const d = fresh();
  const job = d.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "SE-TP01-BK01-140-3-20");
  rejects(() => A.setJobStatus(d, { jobId: job.id, status: "hold" }, ctx("gr")), /เหตุผลที่พักงาน/);
  rejects(() => A.setJobStatus(d, { jobId: job.id, status: "hold", reason: "ab" }, ctx("gr")), /อย่างน้อย 3/);
  rejects(() => A.setJobStatus(d, { jobId: job.id, status: "hold", reason: "ก".repeat(201) }, ctx("gr")), /ยาวเกิน 200/);
  rejects(() => A.setJobStatus(d, { jobId: job.id, status: "hold", reason: "รอแม่พิมพ์" }, ctx("rb")), /แผนก GR/);
  const before = job.reports.length;
  A.setJobStatus(d, { jobId: job.id, status: "hold", reason: "  รอแม่พิมพ์  " }, ctx("gr"));
  assert.equal(job.status, "hold");
  assert.deepEqual(job.reports.at(-1), { at: NOW, by: user("gr").name, good: 0, reject: 0, note: "รอแม่พิมพ์", kind: "hold" });
  assert.equal(job.reports.length, before + 1);
  assert.deepEqual(A.helpers.jobHoldNote(job), { reason: "รอแม่พิมพ์", by: user("gr").name, at: NOW });
  assert.match(d.audit[0].detail, /→ hold — รอแม่พิมพ์/);
  A.setJobStatus(d, { jobId: job.id, status: "in_progress" }, ctx("gr"));
  assert.equal(job.status, "in_progress", "resuming needs no reason");
  assert.equal(A.helpers.jobHoldNote(job), null, "a job that is not on hold shows no hold reason");
  assert.equal(A.helpers.jobCloseNote(job), null, "a hold entry is not a close note");
});

test("a job linked to a RubberFlow work order takes its output from RubberFlow only: reporting is refused for everyone", () => {
  const d = fresh();
  const rb = d.jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "RB");
  assert.equal(A.helpers.isLinkedJob(rb), true);
  for (const role of ["rb", "planner", "admin"]) rejects(() => A.reportJob(d, { jobId: rb.id, qtyDone: 1 }, ctx(role)), /RubberFlow/);
  A.setJobStatus(d, { jobId: rb.id, status: "hold", reason: "รอแม่พิมพ์" }, ctx("rb"));
  assert.equal(rb.status, "hold", "a linked job can still be held");
  A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ไม่ผลิตเพิ่ม" }, ctx("planner"));
  assert.equal(rb.status, "done", "and closed by the planner with a reason");
  assert.equal(A.helpers.isLinkedJob(d.jobs.find((job) => job.orderId === "DEMO-26001" && job.dept === "GR")), false);
});

test("RB jobs link to a RubberFlow work order once and the compound kilograms come from the rod weight", () => {
  const d = fresh();
  const rb = d.jobs.find((job) => job.orderId === "DEMO-26001" && job.itemCode === "RB-DM02-02-BK01-225-3-20");
  const item = A.helpers.itemOf(d, rb.itemCode);
  assert.equal(A.helpers.rbJobKg(rb, item), Math.round(rb.qtyPlanned * 0.17 * 100) / 100);
  assert.equal(A.helpers.rbJobKg(rb, item, { scrapPct: 5 }), Math.round(rb.qtyPlanned * 0.17 * 1.05 * 100) / 100);
  assert.equal(A.helpers.rbJobKg({ qtyPlanned: 10, qtyDone: 0 }, { uom: "kg" }), 10);
  assert.equal(A.helpers.rbJobKg({ qtyPlanned: 10, qtyDone: 0 }, { uom: "pcs", weightG: 250 }), 2.5);
  assert.equal(A.helpers.rbJobKg({ qtyPlanned: 10, qtyDone: 0 }, null), 0);
  const gr = d.jobs.find((job) => job.orderId === "DEMO-26001" && job.dept === "GR");
  rejects(() => A.linkJobToRubberFlow(d, { jobId: gr.id, woId: "WO-1" }, ctx("admin")), /แผนก RB/);
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-1" }, ctx("gr")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-1" }, ctx("rb")), /ฝ่ายวางแผนหรือผู้จัดการ/); // แผนก RB เปิด WO เองไม่ได้ (โรงงานขั้น 6)
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "" }, ctx("planner")), /เลข WO/);
  A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-69-0007", kg: 3.1 }, ctx("planner"));
  assert.equal(rb.externalRef.woId, "WO-69-0007");
  assert.equal(rb.status, "in_progress");
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-69-0008" }, ctx("planner")), /ผูกกับ WO-69-0007 อยู่แล้ว/);
  const d2 = fresh();
  A.releaseOrder(d2, { orderId: "DEMO-26002" }, ctx("planner"));
  const job2 = d2.jobs.find((job) => job.orderId === "DEMO-26002" && job.dept === "RB");
  A.linkJobToRubberFlow(d2, { jobId: job2.id, woId: "WO-X" }, ctx("planner"));
  rejects(() => A.reportJob(d2, { jobId: job2.id, qtyDone: 1 }, ctx("rb")), /WO-X[\s\S]*RubberFlow/);
  A.cancelOrder(d2, { orderId: "DEMO-26002", reason: "ลูกค้ายกเลิก" }, ctx("planner"));
  assert.deepEqual([d2.orders.find((order) => order.id === "DEMO-26002").status, job2.externalRef.woId], ["cancelled", "WO-X"], "a linked order is cancelled and the job keeps its link");
});

test("importing a flat sheet adds items and revision-1 BOMs, merges legacy codes and never overwrites an existing BOM", () => {
  const d = fresh();
  const header = ["ITEM", "น.น RB/g", "CODE", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "NAME", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "ความยาวตัด", "หน่วย", "จำนวนชิ้นที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ต่อ 1 GR", "หน่วย", "หน่วยนับ RB", "น.น ต่อเส้น RB / ก.ก"].join("\t");
  const tsv = [header,
    ["IMP-01(P)-Y", "1", "IMP-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้านำเข้า", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"].join("\t"),
    ["IMP-01(P)-Y", "2", "P-STK-01", "ST", "-", "-", "-", "-", "-", "-", "สติ๊กเกอร์ CE", "PK-ST", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"].join("\t"),
    ["IMP-01(P)-Y", "3", "SE-IMP01--50-5-20", "SE", "IMP01", "0", "50", "5", "20", "-", "ชิ้นยางนำเข้า", "SE", "4", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "30"].join("\t"),
    ["IMP-01(P)-Y", "4", "RB-B0006-02- -300-5-22", "RB", "B0006", "02", "", "300", "5", "22", "เส้นยางนำเข้า", "RB", "4", "10", "CM", "28", "ชิ้น", "1", "ชิ้น", "ชิ้น/pcs", "600"].join("\t"),
    ["IMP-01(P)-Y", "5", "PT-00320", "ST", "-", "-", "-", "-", "-", "-", "แกนตอปิโด (ชื่อในชีต)", "PK-PT", "1", "-", "-", "-", "-", "-", "-", "ชิ้น(20g)", "-"].join("\t"),
    ["IMP-01(P)-Y", "6", "D21-016", "ST", "-", "-", "-", "-", "-", "-", "เม็ดพลาสติก", "PT-ST", "0.5", "-", "-", "-", "-", "-", "-", "กิโลกรัม", "-"].join("\t"),
  ].join("\n");
  const built = rules.buildFromFlat(rules.readFlatRows(tsv), { group: "TOY" });
  const payload = { items: [...built.items.values()], boms: [...built.boms.entries()].map(([parentCode, lines]) => ({ parentCode, lines })), source: "test.tsv", group: "TOY" };
  rejects(() => A.importFlat(d, payload, ctx("gr")), /ฝ่ายวางแผน/);
  rejects(() => A.importFlat(d, { items: [] }, ctx("planner")), /ไม่มีรายการ/);
  const itemsBefore = d.items.length;
  const { summary, ...stats } = A.importFlat(d, payload, ctx("planner"));
  assert.deepEqual(stats, { itemsAdded: 4, itemsMerged: 2, bomsAdded: 2, bomsSkipped: 1, linesSkipped: 0, cycleLinesSkipped: 0 }, "PT-00320 already has a BOM → skipped; P-STK-01 and PT-00320 merged");
  assert.equal(summary, "ชิ้นงานใหม่ 4 (มีอยู่แล้ว 2) · BOM ใหม่ 2 ข้าม 1");
  assert.equal(d.items.length, itemsBefore + 4);
  const fg = approved(d, "IMP-01(P)-Y");
  assert.equal(fg.revision, 1);
  assert.match(fg.note, /test\.tsv/);
  assert.deepEqual(fg.lines.map((line) => [line.childCode, line.qty, line.producerDept]), [["P-STK-01", 2, "ST"], ["SE-IMP01-50-5-20", 4, "GR"], ["PT-00320", 1, "PT"]]);
  const se = approved(d, "SE-IMP01-50-5-20");
  assert.ok(Math.abs(se.lines[0].qty - 1 / 28) < 1e-12);
  assert.deepEqual(A.helpers.itemOf(d, "RB-B0006-02-300-5-22").legacyCodes, ["RB-B0006-02- -300-5-22"]);
  assert.equal(A.helpers.itemOf(d, "RB-B0006-02-300-5-22").rubber.kgPerRoll, 0.6);
  assert.equal(approved(d, "PT-00320").lines[0].qty, 0.02, "the existing PT BOM is untouched");
  const id = A.createOrder(d, { pi: "IMP-PI", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(5) }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "IMP-01(P)-Y", qty: 28 }, ctx("planner"));
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  assert.equal(d.jobs.find((job) => job.orderId === id && job.dept === "RB").qtyPlanned, 4, "28 sets × 4 SE / 28 pieces per rod");
});

test("importing a whole DATA sheet (thousands of items, tens of thousands of lines) finishes quickly and keeps the same results", () => {
  // ขนาดเท่าไฟล์ DATA BOM.xlsx จริง (ชีต DATA_TOY: ~4,700 ชิ้น ~2,800 BOM ~28,000 บรรทัด) · เดิมไล่หาใน d.items ทุกบรรทัด หน้าค้างหลายนาที
  const d = fresh();
  const FG = 1200;
  const PER_FG = 22;
  const items = [];
  const boms = [];
  for (let f = 0; f < FG; f += 1) {
    const fg = `BIG-${String(f).padStart(4, "0")}(P)-Y`;
    items.push({ code: fg, kind: "FG", name: fg, uom: "set", ownerDept: "PK" });
    const se = `SE-BIG${f}-50-5-20`;
    items.push({ code: se, kind: "SE", name: se, uom: "pcs", ownerDept: "GR" });
    boms.push({ parentCode: se, lines: [{ childCode: "P-SHARED-0", qty: 1 }] });
    const lines = [{ childCode: se, qty: 2 }];
    for (let k = 0; k < PER_FG; k += 1) lines.push({ childCode: `P-SHARED-${(f + k) % 2300}`, qty: k + 1 });
    lines.push({ childCode: "NOT-IN-PAYLOAD", qty: 1 }, { childCode: "P-SHARED-1", qty: 0 });
    boms.push({ parentCode: fg, lines });
  }
  for (let s = 0; s < 2300; s += 1) items.push({ code: `P-SHARED-${s}`, kind: "PURCHASED", name: `ชิ้นซื้อ ${s}`, uom: "pcs", ownerDept: "ST", rubber: s % 50 === 0 ? { compound: `CP${s % 7}` } : null });
  items.push({ code: "P-SHARED-0", kind: "PURCHASED", name: "ซ้ำในชุด", uom: "pcs", ownerDept: "ST" });
  boms.push({ parentCode: "BIG-0000(P)-Y", lines: [{ childCode: "P-SHARED-5", qty: 9 }] });
  const started = performance.now();
  const { summary, ...stats } = A.importFlat(d, { items, boms, source: "big.xlsx", group: "TOY" }, ctx("planner"));
  const elapsed = performance.now() - started;
  assert.deepEqual(stats, { itemsAdded: FG * 2 + 2300, itemsMerged: 1, bomsAdded: FG * 2, bomsSkipped: 1, linesSkipped: 0, cycleLinesSkipped: 0 }, "a code repeated in the payload merges into the item just added · a parent repeated in the payload is skipped");
  assert.ok(elapsed < 5000, `importFlat took ${Math.round(elapsed)} ms`);
  assert.equal(summary, `ชิ้นงานใหม่ ${FG * 2 + 2300} (มีอยู่แล้ว 1) · BOM ใหม่ ${FG * 2} ข้าม 1`);
  const fg = approved(d, "BIG-0000(P)-Y");
  assert.equal(fg.lines.length, PER_FG + 1, "lines to unknown codes and zero quantities are dropped");
  assert.equal(fg.lines.find((line) => line.childCode === "SE-BIG0-50-5-20").producerDept, "GR");
  assert.deepEqual(fg.lines.slice(0, 2).map((line) => line.childCode), ["P-SHARED-0", "P-SHARED-1"], "lines sorted by flow: ST before GR");
  assert.equal(A.helpers.itemOf(d, "P-SHARED-0").name, "ชิ้นซื้อ 0", "the first copy of a repeated code wins");
  assert.equal(d.compounds.filter((entry) => /^CP\d$/.test(entry.code)).length, 7, "each new compound is added once");
});

test("importing skips the BOM lines the database rejects (a purchased parent, a rod with a child that is not a compound) instead of failing the whole sheet", () => {
  // DATA BOM.xlsx จริง: B02-1001 เป็นของซื้อในสินค้าหนึ่งแต่มีผ้า/เทปเป็นลูกจากอีกสินค้า → ฐานข้อมูลตอบ BOM_INVALID_PARENT_KIND และย้อนกลับทั้ง 4,721 ชิ้น
  const d = fresh();
  const items = [
    { code: "FG-KIND(P)-Y", kind: "FG", name: "สินค้า", uom: "set", ownerDept: "PK" },
    { code: "P-BUY-1", kind: "PURCHASED", name: "สายสะพาย", uom: "pcs", ownerDept: "ST" },
    { code: "P-BUY-2", kind: "PURCHASED", name: "ผ้า", uom: "m", ownerDept: "ST" },
    { code: "RB-K-01-1-1-1", kind: "RB", name: "เส้นยาง", uom: "rod", ownerDept: "RB" },
    { code: "FG-OTHER(P)-Y", kind: "FG", name: "สินค้าอื่น", uom: "set", ownerDept: "PK" },
  ];
  const boms = [
    { parentCode: "FG-KIND(P)-Y", lines: [{ childCode: "RB-K-01-1-1-1", qty: 2 }, { childCode: "P-BUY-1", qty: 1 }, { childCode: "FG-OTHER(P)-Y", qty: 1 }] },
    { parentCode: "P-BUY-1", lines: [{ childCode: "P-BUY-2", qty: 3 }] },
    { parentCode: "RB-K-01-1-1-1", lines: [{ childCode: "P-BUY-2", qty: 1 }] },
  ];
  const { summary, ...stats } = A.importFlat(d, { items, boms, source: "kinds.xlsx" }, ctx("planner"));
  assert.deepEqual(stats, { itemsAdded: 5, itemsMerged: 0, bomsAdded: 1, bomsSkipped: 0, linesSkipped: 3, cycleLinesSkipped: 0 });
  assert.match(summary, /ข้าม 3 บรรทัดที่ชนิดพ่อ\/ลูกไม่เข้ากัน$/);
  assert.equal(approved(d, "P-BUY-1"), null, "a purchased part gets no BOM");
  assert.equal(approved(d, "RB-K-01-1-1-1"), null, "a rod's only child may be a compound");
  assert.deepEqual(approved(d, "FG-KIND(P)-Y").lines.map((line) => line.childCode), ["P-BUY-1", "RB-K-01-1-1-1"], "valid lines stay, sorted ST before RB (a finished product as a component is skipped)");
});

test("importing skips a line that makes a BOM contain itself (directly or through its children) instead of the database refusing the whole batch with BOM_CYCLE", () => {
  // DATA_BOM.xlsx จริง: 20 BOM ใช้ตัวเองเป็นส่วนประกอบ (PT-00224 → PT-00224, SG-08-0009 → SG-08-0009) ฐานข้อมูลปฏิเสธส่วนนั้นและการนำเข้าหยุดกลางทาง
  const d = fresh();
  const items = [
    { code: "PT-SELF-1", kind: "PT", name: "ท่อ", uom: "pcs", ownerDept: "PT" },
    { code: "P-RESIN-1", kind: "PURCHASED", name: "เม็ดพลาสติก", uom: "kg", ownerDept: "ST" },
    { code: "SE-LOOP-A", kind: "SE", name: "ชิ้น A", uom: "pcs", ownerDept: "GR" },
    { code: "SE-LOOP-B", kind: "SE", name: "ชิ้น B", uom: "pcs", ownerDept: "GR" },
  ];
  const boms = [
    { parentCode: "PT-SELF-1", lines: [{ childCode: "PT-SELF-1", qty: 1 }, { childCode: "P-RESIN-1", qty: 0.2 }] },
    { parentCode: "SE-LOOP-A", lines: [{ childCode: "SE-LOOP-B", qty: 1 }] },
    { parentCode: "SE-LOOP-B", lines: [{ childCode: "SE-LOOP-A", qty: 1 }, { childCode: "P-RESIN-1", qty: 0.1 }] },
  ];
  const { summary, ...stats } = A.importFlat(d, { items, boms, source: "cycles.xlsx" }, ctx("planner"));
  assert.deepEqual(stats, { itemsAdded: 4, itemsMerged: 0, bomsAdded: 3, bomsSkipped: 0, linesSkipped: 0, cycleLinesSkipped: 2 });
  assert.match(summary, /ข้าม 2 บรรทัดที่วนกลับมาใช้ตัวเองเป็นส่วนประกอบ$/);
  assert.deepEqual(approved(d, "PT-SELF-1").lines.map((line) => line.childCode), ["P-RESIN-1"], "the self line is dropped, the rest of the BOM stays");
  assert.deepEqual(approved(d, "SE-LOOP-A").lines.map((line) => line.childCode), ["SE-LOOP-B"], "the first BOM of a two-part loop is kept");
  assert.deepEqual(approved(d, "SE-LOOP-B").lines.map((line) => line.childCode), ["P-RESIN-1"], "the line that closes the loop is dropped");

  // ลูกร่วม (diamond) ไม่ใช่วงจร: A → B, C · B → D · C → D ไม่ถูกตัด · วงจรผ่าน BOM ที่อนุมัติไว้ก่อนแล้ว (SE-LOOP-A → SE-LOOP-B) ถูกตัด
  const more = [
    { code: "SE-DIA-A", kind: "SE", name: "A", uom: "pcs", ownerDept: "GR" }, { code: "SE-DIA-B", kind: "SE", name: "B", uom: "pcs", ownerDept: "GR" },
    { code: "SE-DIA-C", kind: "SE", name: "C", uom: "pcs", ownerDept: "GR" }, { code: "SE-DIA-D", kind: "SE", name: "D", uom: "pcs", ownerDept: "GR" },
    { code: "SE-OLD-X", kind: "SE", name: "X", uom: "pcs", ownerDept: "GR" }, { code: "SE-DIA-E", kind: "SE", name: "E", uom: "pcs", ownerDept: "GR" },
  ];
  const second = A.importFlat(d, { items: more, boms: [
    { parentCode: "SE-DIA-A", lines: [{ childCode: "SE-DIA-B", qty: 1 }, { childCode: "SE-DIA-C", qty: 1 }] },
    { parentCode: "SE-DIA-B", lines: [{ childCode: "SE-DIA-D", qty: 1 }] },
    { parentCode: "SE-DIA-C", lines: [{ childCode: "SE-DIA-D", qty: 1 }] },
    { parentCode: "SE-DIA-D", lines: [{ childCode: "P-RESIN-1", qty: 1 }, { childCode: "SE-DIA-E", qty: 1 }] },
    { parentCode: "SE-OLD-X", lines: [{ childCode: "SE-LOOP-A", qty: 1 }, { childCode: "P-RESIN-1", qty: 1 }] },
  ], source: "more.xlsx" }, ctx("planner"));
  assert.equal(second.cycleLinesSkipped, 0, "shared children and a parent above an existing BOM are not loops");
  assert.deepEqual(approved(d, "SE-DIA-A").lines.map((line) => line.childCode), ["SE-DIA-B", "SE-DIA-C"]);
  // วงจรผ่าน BOM ที่อนุมัติไว้ก่อนแล้ว: A → B → D → E มีอยู่ นำเข้า E → A ต้องตัดบรรทัด E → A แต่คงบรรทัดอื่นของ E
  const loopOld = A.importFlat(d, { items: [{ code: "SE-DIA-E", kind: "SE", name: "E", uom: "pcs", ownerDept: "GR" }], boms: [{ parentCode: "SE-DIA-E", lines: [{ childCode: "SE-DIA-A", qty: 1 }, { childCode: "P-RESIN-1", qty: 1 }] }], source: "x" }, ctx("planner"));
  assert.equal(loopOld.cycleLinesSkipped, 1, "a loop through BOMs approved earlier is caught");
  assert.deepEqual(approved(d, "SE-DIA-E").lines.map((line) => line.childCode), ["P-RESIN-1"]);

  // สองบรรทัดของพ่อเดียวกันวนทั้งคู่ผ่านทางที่ใช้โหนดร่วมกัน: มี A2 → [B2, P] และ C2 → A2 อยู่แล้ว นำเข้า P2 → [A2, C2] ต้องตัดทั้งสองบรรทัด
  // (เดินจาก A2 เจอ P2 กลางทางก่อนเดินลูกอื่นครบ ถ้าชุด seen ค้างไว้ บรรทัด C2 → A2 → … จะถูกมองว่าไม่วนแล้วฐานข้อมูลปฏิเสธทั้งส่วน)
  const twoParts = ["SE-TW-A2", "SE-TW-B2", "SE-TW-C2", "SE-TW-P2"].map((code) => ({ code, kind: "SE", name: code, uom: "pcs", ownerDept: "GR" }));
  A.importFlat(d, { items: twoParts, boms: [
    { parentCode: "SE-TW-A2", lines: [{ childCode: "SE-TW-B2", qty: 1 }, { childCode: "SE-TW-P2", qty: 1 }] },
    { parentCode: "SE-TW-C2", lines: [{ childCode: "SE-TW-A2", qty: 1 }] },
  ], source: "x" }, ctx("planner"));
  const both = A.importFlat(d, { items: twoParts, boms: [
    { parentCode: "SE-TW-P2", lines: [{ childCode: "SE-TW-A2", qty: 1 }, { childCode: "SE-TW-C2", qty: 1 }, { childCode: "P-RESIN-1", qty: 1 }] },
  ], source: "x" }, ctx("planner"));
  assert.equal(both.cycleLinesSkipped, 2, "both looping lines of one parent are dropped");
  assert.deepEqual(approved(d, "SE-TW-P2").lines.map((line) => line.childCode), ["P-RESIN-1"]);
});

test("the loop check stays fast on a whole sheet ordered either way (parents first or children first)", () => {
  // ชีตจริงมีหลายพัน BOM และหลายหมื่นบรรทัด หน้าเคยค้างตอนกดนำเข้า (PR #311): 8 ชั้น × 350 ชิ้น × 11 ลูก ต้องไม่เดินต้นไม้ซ้ำทุกบรรทัด
  for (const order of ["parents-first", "children-first"]) {
    const d = fresh();
    const items = [];
    const boms = [];
    for (let level = 0; level < 8; level += 1) for (let i = 0; i < 350; i += 1) items.push({ code: `SE-P${level}-${i}`, kind: "SE", name: "x", uom: "pcs", ownerDept: "GR" });
    for (let level = 0; level < 7; level += 1) for (let i = 0; i < 350; i += 1) {
      boms.push({ parentCode: `SE-P${level}-${i}`, lines: Array.from({ length: 11 }, (_, k) => ({ childCode: `SE-P${level + 1}-${(i * 7 + k * 13) % 350}`, qty: 1 })) });
    }
    if (order === "children-first") boms.reverse();
    const started = performance.now();
    const stats = A.importFlat(d, { items, boms, source: order }, ctx("planner"));
    const took = performance.now() - started;
    assert.equal(stats.bomsAdded, 2450, order);
    assert.equal(stats.cycleLinesSkipped, 0, order);
    assert.ok(took < 5000, `${order}: ${Math.round(took)} ms (about 40 ms on a laptop; the old per-line walk took over 3 s children-first)`);
  }
});

test("routings and unit costs: each save is a new revision, costs only on parts without a BOM, planners only", () => {
  const d = fresh();
  const steps = (code) => A.helpers.routingOf(d, code)?.steps.map((step) => [step.processCode, step.minutesPerPc]);
  assert.deepEqual(steps("DEMO-TP-01(P)-Y"), [["PK-01", 1.5], ["PK-03", 0.5]], "the demo seeds routings");
  assert.equal(A.helpers.itemOf(d, "XP-00001").unitCost, undefined, "the demo leaves one part without a cost");
  const first = A.helpers.routingOf(d, "DEMO-TP-01(P)-Y");
  const saved = A.saveRouting(d, { itemCode: "DEMO-TP-01(P)-Y", steps: [{ processCode: "PK-02", minutesPerPc: "0.3" }, { processCode: "PK-01", minutesPerPc: 1.2 }] }, ctx("planner"));
  assert.equal(saved.revision, 2);
  assert.equal(first.status, "superseded", "the old routing is kept as history, not overwritten");
  assert.deepEqual(steps("DEMO-TP-01(P)-Y"), [["PK-02", 0.3], ["PK-01", 1.2]], "step order is kept");
  assert.equal(A.saveRouting(d, { itemCode: "DEMO-TP-01(P)-Y", steps: [{ processCode: "PK-02", minutesPerPc: 0.3 }, { processCode: "PK-01", minutesPerPc: 1.2 }] }, ctx("planner")).changed, false, "the same steps do not add a revision");
  assert.equal(d.audit[0].detail, "DEMO-TP-01(P)-Y Rev.2: PK-02 0.3 → PK-01 1.2");
  rejects(() => A.saveRouting(d, { itemCode: "P-BOX-01", steps: [{ processCode: "PK-03", minutesPerPc: 1 }] }, ctx("planner")), /ของซื้อ/);
  rejects(() => A.saveRouting(d, { itemCode: "PT-00320", steps: [{ processCode: "XX", minutesPerPc: 1 }] }, ctx("planner")), /ไม่พบขั้นตอน XX/);
  rejects(() => A.saveRouting(d, { itemCode: "PT-00320", steps: [{ processCode: "PT-01", minutesPerPc: 1 }, { processCode: "PT-01", minutesPerPc: 2 }] }, ctx("planner")), /ซ้ำ/);
  rejects(() => A.saveRouting(d, { itemCode: "PT-00320", steps: [{ processCode: "PT-01", minutesPerPc: -1 }] }, ctx("planner")), /เวลา/);
  rejects(() => A.saveRouting(d, { itemCode: "SE-BL60-RD01-60-0-60", steps: [] }, ctx("planner")), /อย่างน้อย 1 ขั้น/);
  rejects(() => A.saveRouting(d, { itemCode: "PT-00320", steps: [{ processCode: "PT-01", minutesPerPc: 1 }] }, ctx("gr")), /ฝ่ายวางแผน/);
  // วัตถุดิบเข้าที่ขั้นไหน: ต้องเป็นลูกใน BOM ปัจจุบัน และลูกหนึ่งตัวเข้าได้ขั้นเดียว
  assert.deepEqual(A.helpers.routingOf(d, "BG-0092").steps.map((step) => step.inputs), [["P-FAB-BL"], ["P-ZIP-05", "P-ROPE-01"]], "the demo places fabric at cutting, zip and rope at sewing");
  rejects(() => A.saveRouting(d, { itemCode: "BG-0092", steps: [{ processCode: "BG-01", minutesPerPc: 1, inputs: ["P-BOX-01"] }] }, ctx("planner")), /P-BOX-01 ไม่ได้อยู่ใน BOM ของ BG-0092/);
  rejects(() => A.saveRouting(d, { itemCode: "BG-0092", steps: [{ processCode: "BG-01", minutesPerPc: 1, inputs: ["P-FAB-BL"] }, { processCode: "BG-02", minutesPerPc: 4, inputs: ["P-FAB-BL"] }] }, ctx("planner")), /มากกว่าหนึ่งขั้น/);
  assert.equal(A.saveRouting(d, { itemCode: "BG-0092", steps: [{ processCode: "BG-01", minutesPerPc: 1, inputs: ["P-FAB-BL"] }, { processCode: "BG-02", minutesPerPc: 4, inputs: ["P-ROPE-01", "P-ZIP-05"] }] }, ctx("planner")).changed, false, "the same inputs in another order are not a change");
  assert.equal(A.saveRouting(d, { itemCode: "BG-0092", steps: [{ processCode: "BG-01", minutesPerPc: 1, inputs: ["P-FAB-BL", "P-ZIP-05"] }, { processCode: "BG-02", minutesPerPc: 4, inputs: ["P-ROPE-01"] }] }, ctx("planner")).changed, true, "moving an input to another step is a change");
  // process master: เพิ่มขั้นตอนใหม่แล้วใช้ใน routing ได้ · รหัสเดิมแก้ชื่อ/แผนก · แผนกต้องถูกต้อง
  A.saveProcess(d, { code: "GR-เจียร", name: "เจียร", dept: "GR" }, ctx("planner"));
  A.saveProcess(d, { code: "GR-เจียร", name: "เจียรขอบ", dept: "GR" }, ctx("planner"));
  assert.deepEqual({ ...A.helpers.processOf(d, "GR-เจียร") }, { code: "GR-เจียร", name: "เจียรขอบ", dept: "GR" });
  assert.equal(A.saveRouting(d, { itemCode: "SE-TP01-OR01-75-3-30", steps: [{ processCode: "GR-01", minutesPerPc: 0.1 }, { processCode: "GR-เจียร", minutesPerPc: 0.2 }] }, ctx("planner")).changed, true);
  rejects(() => A.saveProcess(d, { code: "X-1", name: "x", dept: "QQ" }, ctx("planner")), /แผนก/);
  rejects(() => A.saveProcess(d, { code: "X-1", name: "x", dept: "GR" }, ctx("gr")), /ฝ่ายวางแผน/);
  // รูปชิ้นงาน: data URL ของรูปเท่านั้น ขนาดจำกัด ค่าว่างลบรูป
  A.setItemImage(d, { code: "PT-00320", image: "data:image/jpeg;base64,/9j/4AAQ" }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "PT-00320").image, "data:image/jpeg;base64,/9j/4AAQ");
  rejects(() => A.setItemImage(d, { code: "PT-00320", image: "data:image/svg+xml;base64,PHN2Zz4=" }, ctx("planner")), /PNG, JPEG หรือ WebP/);
  rejects(() => A.setItemImage(d, { code: "PT-00320", image: `data:image/png;base64,${"A".repeat(80000)}` }, ctx("planner")), /ใหญ่เกินไป/);
  rejects(() => A.setItemImage(d, { code: "PT-00320", image: "" }, ctx("pt")), /ฝ่ายวางแผน/);
  A.setItemImage(d, { code: "PT-00320", image: "" }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "PT-00320").image, undefined);
  A.setItemCost(d, { code: "XP-00001", unitCost: "0.75" }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "XP-00001").unitCost, 0.75);
  A.setItemCost(d, { code: "XP-00001", unitCost: "" }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "XP-00001").unitCost, undefined, "an empty value clears the cost");
  rejects(() => A.setItemCost(d, { code: "PT-00320", unitCost: 5 }, ctx("planner")), /มี BOM แล้ว/);
  rejects(() => A.setItemCost(d, { code: "P-BOX-01", unitCost: -1 }, ctx("planner")), /ราคาต้นทุน/);
  rejects(() => A.setItemCost(d, { code: "P-BOX-01", unitCost: 1 }, ctx("st")), /ฝ่ายวางแผน/);
});

test("dragging BOM lines into a new order saves a new revision that keeps the order", () => {
  const d = fresh();
  const before = approved(d, "BG-0092");
  const reordered = [...before.lines].reverse().map(({ childCode, qty }) => ({ childCode, qty }));
  const result = A.saveBom(d, { itemCode: "BG-0092", lines: reordered }, ctx("planner"));
  assert.equal(result.changed, true);
  assert.deepEqual(approved(d, "BG-0092").lines.map((line) => line.childCode), before.lines.map((line) => line.childCode).reverse());
  assert.match(d.audit[0].detail, /เรียงลำดับส่วนประกอบใหม่/);
  assert.equal(A.saveBom(d, { itemCode: "BG-0092", lines: reordered }, ctx("planner")).changed, false, "saving the same order again is no change");
});

test("two tabs sharing one browser storage: a tab opened earlier re-reads before saving instead of writing its stale copy over the other tab's work", () => {
  const shared = new Map();
  const storage = { getItem: (key) => (shared.has(key) ? shared.get(key) : null), setItem: (key, value) => shared.set(key, String(value)), removeItem: (key) => shared.delete(key) };
  const older = storeApi.createStore({ storage, seed: fresh, actions: A, now: () => NOW });
  older.data(); // แท็บที่เปิดไว้ก่อน มีข้อมูลชุดเดิมในหน่วยความจำ
  const newer = storeApi.createStore({ storage, seed: fresh, actions: A, now: () => NOW });
  newer.setUser("B03");
  assert.equal(newer.run("saveProcess", { code: "GR-กาว", name: "ทากาว", dept: "GR" }).ok, true);
  older.setUser("B02"); // เปลี่ยนบทบาทในแท็บเก่า เคยเขียนข้อมูลเก่าทับ
  const saved = JSON.parse(shared.get(storeApi.STATE_KEY));
  assert.ok(saved.processes.some((process) => process.code === "GR-กาว"), "the newer tab's process survives the older tab's role switch");
  assert.ok(older.data().processes.some((process) => process.code === "GR-กาว"), "and the older tab now shows it");
  assert.equal(older.run("setItemCost", { code: "XP-00001", unitCost: 1 }).ok, true);
  assert.ok(newer.data().items.find((item) => item.code === "XP-00001").unitCost === 1 && newer.data().processes.some((process) => process.code === "GR-กาว"), "each tab sees both changes");
});

test("the store persists through run(), rejects unknown actions and keeps working without storage", () => {
  const storage = new Map();
  const fake = { getItem: (key) => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: (key) => storage.delete(key) };
  const store = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(store.user(), null);
  assert.equal(store.setUser("B03").role, "planner");
  assert.equal(store.run("nope", {}).ok, false);
  const bad = store.run("createOrder", { pi: "", customer: "x" });
  assert.equal(bad.ok, false);
  assert.match(bad.error.message, /วันที่สั่งผลิต/, "the PI number is optional (auto), dates are not");
  assert.equal(store.data().orders.length, 5, "failed action leaves the state untouched");
  const ok = store.run("createOrder", { pi: "ST-1", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY });
  assert.equal(ok.result, "ST-1");
  assert.ok(store.isPersisted());
  assert.ok(JSON.parse(storage.get(storeApi.STATE_KEY)).orders.some((order) => order.id === "ST-1"));
  const reloaded = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(reloaded.user().id, "B03");
  storage.set(storeApi.STATE_KEY, "{broken");
  const repaired = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(repaired.data().orders.length, 5, "corrupt storage → fresh seed");
  const noStorage = storeApi.createStore({ storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }, seed: fresh, actions: A, now: () => NOW });
  noStorage.setUser("B03");
  assert.equal(noStorage.run("createOrder", { pi: "M-1", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY }).ok, true);
  assert.equal(noStorage.isPersisted(), false);
  assert.ok(storeApi.canSee(user("planner"), "build") && storeApi.canSee(user("manager"), "build") && !storeApi.canSee(user("gr"), "build") && !storeApi.canSee(user("gr"), "import") && !storeApi.canSee(null, "items"));
  // state รุ่น 1 (มีขั้นอนุมัติ) ในเบราว์เซอร์เดิม → รุ่น 2: ร่าง/รออนุมัติถูกตัด BOM ที่ใช้งาน/ถูกแทนคงอยู่ ข้อมูลอื่นไม่หาย
  const old = fresh();
  old.version = 1;
  old.boms.push({ id: "BOM-69-0999", itemCode: "DEMO-BL-60(K)-Z", revision: 1, status: "pending", ownerDept: "PK", lines: [], changeLog: [] }, { id: "BOM-69-0998", itemCode: "SE-BL60-RD01-60-0-60", revision: 1, status: "draft", ownerDept: "GR", lines: [], changeLog: [] });
  const oldStorage = new Map([[storeApi.STATE_KEY, JSON.stringify(old)]]);
  const oldFake = { getItem: (key) => (oldStorage.has(key) ? oldStorage.get(key) : null), setItem: (key, value) => oldStorage.set(key, String(value)), removeItem: (key) => oldStorage.delete(key) };
  const upgraded = storeApi.createStore({ storage: oldFake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(upgraded.data().version, storeApi.STATE_VERSION);
  assert.equal(upgraded.data().boms.filter((bom) => ["draft", "pending"].includes(bom.status)).length, 0);
  assert.equal(upgraded.data().boms.length, old.boms.length - 2);
  assert.equal(upgraded.data().orders.length, 5, "orders survive the upgrade");
  assert.equal(JSON.parse(oldStorage.get(storeApi.STATE_KEY)).version, storeApi.STATE_VERSION, "upgraded state is written back");
  // รุ่น 2 (ไม่มีตารางสี) → รุ่น 3 เพิ่มรายการว่าง → รุ่น 4 เพิ่มขั้นตอนผลิตมาตรฐาน ข้อมูลเดิมคงอยู่
  const v2 = fresh();
  v2.version = 2;
  delete v2.colors; delete v2.colorSets; delete v2.packages; delete v2.processes; delete v2.routings;
  const fromV2 = storeApi.migrate(JSON.parse(JSON.stringify(v2)));
  assert.equal(fromV2.version, storeApi.STATE_VERSION);
  assert.deepEqual(fromV2.processes, rules.DEFAULT_PROCESSES.map((entry) => ({ ...entry })));
  assert.deepEqual(fromV2.routings, []);
  // รุ่น 4 → 5: บรรทัด BOM ทุก revision ของทุกสินค้าเรียงตามผังงาน (ข้อมูลที่นำเข้าจาก Excel เรียงตามชีต: PT ก่อน SE ท้าย)
  const v4 = fresh();
  v4.version = 4;
  const fg = v4.boms.find((bom) => bom.itemCode === "DEMO-TP-01(P)-Y" && bom.status === "approved");
  const byCode = (code) => fg.lines.find((line) => line.childCode === code);
  fg.lines = [byCode("PT-00320"), byCode("P-STK-01"), byCode("XP-00001"), byCode("SE-TP01-OR01-100-18-65"), byCode("P-BOX-01"), byCode("SE-TP01-BK01-140-3-20"), byCode("P-BAG-01"), byCode("SE-TP01-OR01-75-3-30")];
  const fromV4 = storeApi.migrate(JSON.parse(JSON.stringify(v4)));
  assert.equal(fromV4.version, storeApi.STATE_VERSION);
  assert.deepEqual(fromV4.boms.find((bom) => bom.id === fg.id).lines.map((line) => line.childCode), ["P-STK-01", "P-BOX-01", "P-BAG-01", "SE-TP01-OR01-100-18-65", "SE-TP01-BK01-140-3-20", "SE-TP01-OR01-75-3-30", "PT-00320", "XP-00001"], "ST → GR → PT → PK, same-department lines keep their order");
  assert.match(fromV4.audit[1].detail, /รุ่น 4 → 5: เรียงบรรทัด BOM ตามผังงาน[^(]*\(1 BOM เปลี่ยนลำดับ\)/);
  // ย้ายแผนกเจ้าของของลูกแล้วบันทึก BOM ของพ่อโดยไม่แก้อะไร: ลำดับเก่าที่ค้างไม่นับเป็นการแก้ (ไม่เกิด revision ใหม่)
  const moved = fresh();
  const sticker = A.helpers.itemOf(moved, "P-STK-01");
  A.saveItem(moved, { ...sticker, ownerDept: "PK" }, ctx("planner"));
  const unchanged = approved(moved, "DEMO-TP-01(P)-Y");
  assert.equal(A.saveBom(moved, { itemCode: "DEMO-TP-01(P)-Y", lines: unchanged.lines.map((line) => ({ ...line })) }, ctx("planner")).changed, false, "re-saving after a child changed department is not a change");
  assert.deepEqual([fromV2.colors, fromV2.colorSets, fromV2.packages], [[], [], []]);
  assert.equal(fromV2.items.length, v2.items.length);
  assert.ok(storeApi.isValidState(fromV2));
  // ขั้นตอนมาตรฐานที่เพิ่มทีหลัง (GR ทากาว/เจียร/คัดแยก, PK ใส่กระเป๋า) ใช้ได้โดยไม่แก้ข้อมูลที่เก็บและไม่เปลี่ยนรุ่น state
  // ขั้นตอนที่ผู้ใช้เพิ่มหรือแก้ชื่อเองชนะค่าเริ่มต้น · แก้ชื่อขั้นตอนเริ่มต้นแล้วเก็บเป็นของผู้ใช้ ไม่แก้ค่าเริ่มต้นที่ freeze ไว้
  const older = fresh();
  older.processes = [{ code: "GR-01", name: "ตัด (ชื่อที่ผู้ใช้แก้)", dept: "GR" }, { code: "X-OWN", name: "ขั้นตอนของผู้ใช้", dept: "PK" }];
  const all = A.helpers.processesOf(older);
  assert.deepEqual(all.slice(0, 2), older.processes);
  assert.ok(["GR-02", "GR-03", "GR-04", "PK-02"].every((code) => A.helpers.processOf(older, code)));
  assert.equal(all.filter((process) => process.code === "GR-01").length, 1, "a stored step hides the default of the same code");
  assert.equal(older.processes.length, 2, "looking up steps does not change the stored data");
  A.saveProcess(older, { code: "GR-02", name: "ทากาวขอบ", dept: "GR" }, ctx("planner"));
  assert.deepEqual(older.processes.at(-1), { code: "GR-02", name: "ทากาวขอบ", dept: "GR" });
  assert.equal(rules.DEFAULT_PROCESSES.find((entry) => entry.code === "GR-02").name, "ปั๊ม");
  // รุ่น 5 → 6: ขั้นตอน GR เดิม 4 ขั้นย้ายเลขตาม Grinding-GR ทั้งใน processes และทุก revision ของ routing
  // วางชุด GR ใหม่ทั้ง 9 ขั้นที่ตำแหน่งของ GR เดิม · ชื่อที่ผู้ใช้แก้คงไว้ · คัดแยกเป็น GR-10 ต่อท้ายเจาะ
  const v5 = fresh();
  v5.version = 5;
  v5.processes = [
    { code: "RB-13", name: "ตัดยางเส้นยาว", dept: "RB" },
    { code: "GR-01", name: "ตัดยาง", dept: "GR" }, { code: "GR-02", name: "ทากาวขอบ", dept: "GR" }, { code: "GR-03", name: "เจียร์แปรรูป", dept: "GR" }, { code: "GR-04", name: "คัดแยก", dept: "GR" },
    { code: "X-OWN", name: "ขั้นตอนของผู้ใช้", dept: "GR" }, { code: "PT-01", name: "ขึ้นรูปพลาสติก", dept: "PT" },
  ];
  v5.routings = [
    { id: "RT-1", itemCode: "SE-TP01-OR01-75-3-30", revision: 2, status: "approved", steps: [{ processCode: "GR-01", minutesPerPc: 0.1 }, { processCode: "GR-03", minutesPerPc: 0.2 }, { processCode: "GR-04", minutesPerPc: 0.05 }] },
    { id: "RT-0", itemCode: "SE-TP01-OR01-75-3-30", revision: 1, status: "superseded", steps: [{ processCode: "GR-02", minutesPerPc: 0.1 }, { processCode: "X-OWN", minutesPerPc: 0.1 }] },
  ];
  const fromV5 = storeApi.migrate(JSON.parse(JSON.stringify(v5)));
  assert.equal(fromV5.version, storeApi.STATE_VERSION);
  assert.deepEqual(fromV5.processes.map((process) => `${process.code} ${process.name}`), [
    "RB-13 ตัดยางเส้นยาว", "GR-01 รีด", "GR-02 ปั๊ม", "GR-03 เปเปอร์", "GR-04 ตัดยาง", "GR-05 ทากาวขอบ", "GR-06 เจียร์", "GR-07 เจียร์(หยาบ)", "GR-08 เจียร์(ละเอียด)", "GR-09 เจาะ", "GR-10 คัดแยก", "X-OWN ขั้นตอนของผู้ใช้", "PT-01 ขึ้นรูปพลาสติก",
  ]);
  assert.deepEqual(fromV5.routings.map((routing) => routing.steps.map((step) => step.processCode)), [["GR-04", "GR-06", "GR-10"], ["GR-05", "X-OWN"]]);
  assert.match(fromV5.audit[0].detail, /รุ่น 5 → 6: .*\(4 ขั้นใน routing เปลี่ยนรหัส\)/);
  assert.ok(storeApi.isValidState(fromV5));
  // ชุดรหัสก่อน #268 (GR-CUT ฯลฯ) ที่ยังค้างในเบราว์เซอร์ย้ายตามชื่อ: ตัด → GR-04 ทากาว → GR-05 เจียร → GR-06 เจาะรู → GR-09 คัดแยก → GR-10
  const v5old = fresh();
  v5old.version = 5;
  v5old.processes = ["GR-CUT ตัดชิ้นยาง", "GR-DRL เจาะรู", "GR-GLUE ทากาว", "GR-GRIND เจียร", "GR-SORT คัดแยก", "PT-INJ ฉีดพลาสติก"].map((text) => ({ code: text.split(" ")[0], name: text.split(" ")[1], dept: text.startsWith("PT") ? "PT" : "GR" }));
  v5old.routings = [{ id: "RT-2", itemCode: "SE-TP01-BK01-140-3-20", revision: 1, status: "approved", steps: [{ processCode: "GR-CUT", minutesPerPc: 0.15 }, { processCode: "GR-DRL", minutesPerPc: 0.1 }, { processCode: "GR-SORT", minutesPerPc: 0.1 }] }];
  const fromV5old = storeApi.migrate(JSON.parse(JSON.stringify(v5old)));
  assert.deepEqual(fromV5old.processes.map((process) => process.code), ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-06", "GR-07", "GR-08", "GR-09", "GR-10", "PT-INJ"]);
  assert.deepEqual(fromV5old.processes.slice(3, 10).map((process) => process.name), ["ตัดยาง", "ทากาว", "เจียร์", "เจียร์(หยาบ)", "เจียร์(ละเอียด)", "เจาะ", "คัดแยก"]);
  assert.deepEqual(fromV5old.routings[0].steps.map((step) => step.processCode), ["GR-04", "GR-09", "GR-10"]);
  // คัดแยกที่ routing อ้างจากค่าเริ่มต้นรุ่นก่อน (ไม่ได้เก็บใน processes) ถูกเก็บเป็น GR-10 ไม่งั้นหาไม่เจอ
  for (const stored of [[{ code: "GR-CUT", name: "ตัดชิ้นยาง", dept: "GR" }], []]) {
    const v5sort = fresh();
    v5sort.version = 5;
    v5sort.processes = stored;
    v5sort.routings = [{ id: "RT-3", itemCode: "SE-TP01-OR01-75-3-30", revision: 1, status: "approved", steps: [{ processCode: "GR-04", minutesPerPc: 0.05 }] }];
    const fromSort = storeApi.migrate(JSON.parse(JSON.stringify(v5sort)));
    assert.equal(A.helpers.processOf(fromSort, "GR-10")?.name, "คัดแยก");
    assert.equal(fromSort.processes.filter((process) => process.code === "GR-10").length, 1);
  }
  // state รุ่น 5 ที่ไม่มี processes (แก้มือ) ไม่ทำให้ migrate พัง แต่ถือว่าแปลงไม่ได้
  assert.equal(storeApi.migrate({ ...fresh(), version: 5, processes: undefined }), null);
  // แท็บที่เปิดโค้ดรุ่นเก่ากว่าข้อมูล: ไม่เขียนชุดสาธิตทับข้อมูลรุ่นใหม่ (จะหายทั้ง BOM ที่นำเข้า)
  const newerText = JSON.stringify({ ...fresh(), version: storeApi.STATE_VERSION + 1 });
  const newerStorage = new Map([[storeApi.STATE_KEY, newerText]]);
  const newerStore = storeApi.createStore({ storage: { getItem: (key) => newerStorage.get(key) ?? null, setItem: (key, value) => newerStorage.set(key, String(value)), removeItem: (key) => newerStorage.delete(key) }, seed: fresh, actions: A, now: () => NOW });
  newerStore.setUser("B03");
  newerStore.run("createOrder", { pi: "M-9", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY });
  assert.equal(newerStorage.get(storeApi.STATE_KEY), newerText, "newer saved data is never overwritten");
  assert.equal(newerStore.isPersisted(), false);
  assert.equal(storeApi.isValidState({ ...fresh(), colors: undefined }), false, "a v3 state without the colour tables is not valid as is");
  assert.equal(storeApi.migrate({ version: 99, counters: {}, users: [], compounds: [], items: [], boms: [], orders: [], jobs: [], audit: [], colors: [], colorSets: [], packages: [] }), null, "unknown versions are reseeded");
  assert.equal(storeApi.MODULES[1].id, "build", "the single BOM builder is the first menu after the overview");
});

test("a BOM line can say which production step of its parent it enters (1–20); only a change of that number is a new revision", () => {
  const d = fresh();
  const code = "DEMO-HL-24(B)-A";
  const before = approved(d, code);
  const lines = (steps) => before.lines.map((line, index) => ({ childCode: line.childCode, qty: line.qty, scrapPct: line.scrapPct, note: line.note, step: steps[index] }));
  assert.equal(A.saveBom(d, { itemCode: code, lines: lines(["", "", "", ""]) }, ctx("planner")).changed, false, "blank steps equal lines saved before the field existed");
  rejects(() => A.saveBom(d, { itemCode: code, lines: lines(["0"]) }, ctx("planner")), /ขั้นที่ต้องเป็นจำนวนเต็ม 1–20/);
  rejects(() => A.saveBom(d, { itemCode: code, lines: lines(["1.5"]) }, ctx("planner")), /ขั้นที่ต้องเป็นจำนวนเต็ม 1–20/);
  rejects(() => A.saveBom(d, { itemCode: code, lines: lines(["21"]) }, ctx("planner")), /ขั้นที่ต้องเป็นจำนวนเต็ม 1–20/);
  const saved = A.saveBom(d, { itemCode: code, lines: lines(["1", "1", "2", "2"]) }, ctx("planner"));
  assert.equal(saved.changed, true);
  assert.deepEqual(approved(d, code).lines.map((line) => line.step), [1, 1, 2, 2]);
  assert.match(approved(d, code).changeLog[0].text, /ขั้นที่/);
  assert.equal(A.saveBom(d, { itemCode: code, lines: lines([1, 1, 2, 2]) }, ctx("planner")).changed, false, "the same numbers again are no change");
  // saveBomTree ส่งต่อขั้นที่ของแต่ละโหนด
  A.saveBomTree(d, { code, nodes: before.lines.map((line, index) => ({ code: line.childCode, qty: line.qty, scrapPct: line.scrapPct, note: line.note, step: index === 3 ? "3" : "" })) }, ctx("planner"));
  assert.deepEqual(approved(d, code).lines.map((line) => line.step ?? null), [null, null, null, 3]);
  // ชิ้นเดียวกันสองที่ในต้นไม้ที่ลูกต่างกันแค่ขั้นที่ → ปฏิเสธเหมือนลูกต่างกัน
  const rb = approved(d, "SE-TP01-BK01-140-3-20").lines[0];
  rejects(() => A.saveBomTree(d, { code: "NEW-STEP(P)-Y", item: { name: "x", uom: "set" }, nodes: [
    { code: "SE-TP01-BK01-140-3-20", qty: 1, children: [{ code: rb.childCode, qty: rb.qty, step: "1" }] },
    { code: "SE-TP01-BK01-140-3-20", qty: 1, children: [{ code: rb.childCode, qty: rb.qty, step: "2" }] },
  ] }, ctx("planner")), /ปรากฏหลายที่ในต้นไม้ด้วยส่วนประกอบต่างกัน/);
  // รุ่นสินค้าใหม่จากต้นแบบ: บรรทัดที่คัดลอกเก็บขั้นที่ · บรรจุภัณฑ์ของแพ็กเกจใหม่ได้ขั้นที่ของบรรจุภัณฑ์เดิม
  const source = approved(d, "DEMO-TP-01(P)-Y");
  const packaging = new Set(["P-BAG-01", "P-BOX-01"]);
  A.saveBom(d, { itemCode: source.itemCode, lines: source.lines.map((line) => ({ ...line, step: packaging.has(line.childCode) ? 4 : 2 })) }, ctx("planner"));
  A.createVariant(d, { base: "DEMO-TP-01", pkg: "B", colorSet: "A" }, ctx("planner"));
  const variant = approved(d, "DEMO-TP-01(B)-A");
  assert.equal(variant.lines.find((line) => line.childCode === "P-BOX-01").step, 4, "the new package's box enters where the old packaging did");
  assert.ok(variant.lines.filter((line) => !packaging.has(line.childCode)).every((line) => line.step === 2), "copied and recoloured lines keep their step");
});

test("a rod carries one compound line: rules on where it goes, kilograms in the order explosion, no department job, and the RubberFlow kilograms follow the line", () => {
  const d = fresh();
  const rod = "RB-DM01-02-OR01-202-18-70";
  assert.deepEqual([...A.helpers.NO_BOM_KINDS], [...rules.LEAF_KINDS], "the actions and the rules agree on leaf kinds");
  A.saveItem(d, { code: "DM01", kind: "CP", name: "EPDM ส้ม", uom: "kg", create: true }, ctx("planner"));
  A.saveItem(d, { code: "dm09", kind: "CP", name: "NR ใหม่", uom: "kg", create: true }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "DM01").ownerDept, "RB");
  assert.equal(d.compounds.find((entry) => entry.code === "DM01").name, "EPDM ส้ม 60 Shore A", "a named compound keeps its name");
  assert.deepEqual({ ...d.compounds.find((entry) => entry.code === "DM09"), createdAt: 0 }, { code: "DM09", name: "NR ใหม่", recipeId: null, createdAt: 0 }, "a new compound item registers itself for the RubberFlow link");
  rejects(() => A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "DM01", qty: 1 }] }, ctx("planner")), /สูตรยางใส่ได้เฉพาะใต้เส้นยาง/);
  rejects(() => A.saveBom(d, { itemCode: rod, lines: [{ childCode: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /เฉพาะสูตรยาง/);
  rejects(() => A.saveBom(d, { itemCode: rod, lines: [{ childCode: "DM01", qty: 1.53 }, { childCode: "DM09", qty: 0.1 }] }, ctx("planner")), /สูตรเดียว/);
  rejects(() => A.saveBom(d, { itemCode: rod, lines: [{ childCode: "DM09", qty: 1.53 }] }, ctx("planner")), /ระบุสูตร DM01 แต่บรรทัดสูตรยางเป็น DM09/);
  rejects(() => A.saveBom(d, { itemCode: "DM01", lines: [{ childCode: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /สูตรยาง ไม่มีส่วนประกอบ/);
  rejects(() => A.saveBomTree(d, { code: "NEW-CP", item: { name: "x", uom: "set" }, nodes: [{ code: "DM01", qty: 1, children: [{ code: "P-PEL-BK", qty: 1 }] }] }, ctx("planner")), /มีส่วนประกอบไม่ได้/);
  A.saveBom(d, { itemCode: rod, lines: [{ childCode: "DM01", qty: 1.53, scrapPct: 2 }] }, ctx("planner"));
  assert.equal(approved(d, rod).lines[0].uom, "kg");
  // เส้นยางใหม่ในต้นไม้: ช่องสูตรว่างใช้รหัสจากบรรทัดสูตรยางข้างใต้
  A.saveBomTree(d, { code: "SE-NEW-01", item: { name: "ชิ้นยางทดสอบ", uom: "pcs", kind: "SE" }, nodes: [{ code: "RB-DM09-02-RD01-200-3-20", qty: 0.05, newItem: { kind: "RB", name: "เส้นยางใหม่", uom: "rod", rubber: { compound: "", kgPerRoll: 0.2 } }, children: [{ code: "DM09", qty: 0.2 }] }] }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, "RB-DM09-02-RD01-200-3-20").rubber.compound, "DM09", "a blank compound field is filled from the compound line");
  // ใบสั่งผลิต: สูตรยางถูกระเบิดเป็นกิโลกรัม ไม่เป็นงานของแผนก
  const id = A.createOrder(d, { pi: "CP-1", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner"));
  A.explodeOrder(d, { orderId: id }, ctx("planner"));
  const order = d.orders.find((entry) => entry.id === id);
  const rodLine = order.explosion.find((line) => line.itemCode === rod);
  const cpLine = order.explosion.find((line) => line.itemCode === "DM01" && line.parentCode === rod);
  assert.equal(rodLine.required.toFixed(2), "7.74");
  assert.equal(cpLine.required.toFixed(4), (rodLine.required * 1.53 * 1.02).toFixed(4), "compound kilograms = rods × kg per rod × (1 + scrap)");
  assert.equal(cpLine.kind, "CP");
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  const jobs = d.jobs.filter((job) => job.orderId === id);
  assert.ok(!jobs.some((job) => job.itemCode === "DM01"), "a compound is not a department job");
  const rodJob = jobs.find((job) => job.itemCode === rod);
  assert.ok(rodJob, "the rod is still an RB job");
  const rodItem = A.helpers.itemOf(d, rod);
  assert.equal(A.helpers.rbJobKg(rodJob, rodItem, { scrapPct: 5, bom: approved(d, rod) }), Math.round(rodJob.qtyPlanned * 1.53 * 1.02 * 100) / 100, "the BOM line's kilograms and scrap replace the flat 5%");
  assert.equal(A.helpers.rbJobKg(rodJob, rodItem, { scrapPct: 5 }), Math.round(rodJob.qtyPlanned * 1.53 * 1.05 * 100) / 100, "without the BOM the rod weight and the flat allowance apply as before");
  assert.equal(A.helpers.rbJobKg(rodJob, rodItem, { scrapPct: 5, bom: { lines: [{ childCode: "DM01", qty: 1530, uom: "g" }] } }), Math.round(rodJob.qtyPlanned * 1.53 * 100) / 100, "a compound line in grams is converted");
});

test("compound guards outside the BOM editor: kind changes respect the parents, codes fit the rod field, no routing, and the rod field follows its compound line", () => {
  const d = fresh();
  const rod = "RB-DM01-02-OR01-202-18-70";
  A.saveItem(d, { code: "DM01", kind: "CP", name: "EPDM ส้ม", uom: "kg", create: true }, ctx("planner"));
  A.saveBom(d, { itemCode: rod, lines: [{ childCode: "DM01", qty: 1.53 }] }, ctx("planner"));
  const stk = A.helpers.itemOf(d, "P-STK-01");
  rejects(() => A.saveItem(d, { code: "P-STK-01", kind: "CP", name: stk.name, uom: stk.uom }, ctx("planner")), /เปลี่ยน P-STK-01 เป็นสูตรยาง \(คอมปาวด์\)ไม่ได้ เพราะอยู่ใน BOM ของ DEMO-/);
  rejects(() => A.saveItem(d, { code: "DM01", kind: "PURCHASED", name: "EPDM ส้ม", uom: "kg" }, ctx("planner")), new RegExp(`อยู่ใน BOM ของ ${rod} \\(เส้นยางมีส่วนประกอบได้เฉพาะสูตรยาง`));
  rejects(() => A.saveItem(d, { code: "CP-VERY-LONG-COMPOUND-1", kind: "CP", name: "x", uom: "kg", create: true }, ctx("planner")), /ยาวเกิน 20 ตัวอักษร/);
  rejects(() => A.saveRouting(d, { itemCode: "DM01", steps: [{ processCode: "RB-01", minutesPerPc: 1 }] }, ctx("planner")), /เป็นสูตรยาง/);
  const rodItem = A.helpers.itemOf(d, rod);
  rejects(() => A.saveItem(d, { code: rod, kind: "RB", name: rodItem.name, uom: rodItem.uom, rubber: { compound: "ZZ99" } }, ctx("planner")), /ใช้บรรทัดสูตรยาง DM01 ใน BOM/);
  // ในหน้าสร้าง BOM แก้ช่องสูตรและบรรทัดพร้อมกันได้ (ช่องสูตรต้องตรงกับบรรทัดใหม่)
  A.saveItem(d, { code: "DM02", kind: "CP", name: "NBR ดำ", uom: "kg", create: true }, ctx("planner"));
  A.saveBomTree(d, { code: "SE-TP01-OR01-100-18-65", nodes: [{ code: rod, qty: 1 / 31, patch: { rubber: { compound: "DM02" } }, children: [{ code: "DM02", qty: 1.5 }] }, { code: "RB-DM01-01-OR01-200-0-72", qty: 0.02 }] }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, rod).rubber.compound, "DM02");
  assert.equal(approved(d, rod).lines[0].childCode, "DM02");
  rejects(() => A.saveBomTree(d, { code: "SE-TP01-OR01-100-18-65", nodes: [{ code: rod, qty: 1 / 31, patch: { rubber: { compound: "DM01" } } }, { code: "RB-DM01-01-OR01-200-0-72", qty: 0.02 }] }, ctx("planner")), /ใช้บรรทัดสูตรยาง DM02 ใน BOM/);
});

test("the BOM tree can start from a WIP or a rod chosen in step 1, but not from a raw material or a compound", () => {
  const d = fresh();
  const se = A.saveBomTree(d, { code: "SE-NEW-77", item: { name: "ชิ้นยางใหม่", uom: "pcs", kind: "SE" }, nodes: [{ code: "RB-DM01-02-OR01-202-18-70", qty: 0.05 }] }, ctx("planner"));
  assert.deepEqual(se.saved, ["SE-NEW-77 Rev.1"]);
  const seItem = A.helpers.itemOf(d, "SE-NEW-77");
  assert.deepEqual([seItem.kind, seItem.ownerDept, seItem.uom], ["SE", "GR", "pcs"], "the root takes the chosen kind and its department");
  // เส้นยางเป็นพ่อ: สูตรของมันมาจากบรรทัดสูตรยาง ทั้งตอนสร้างใหม่และตอนเปลี่ยนสูตรภายหลัง
  A.saveItem(d, { code: "DM07", kind: "CP", name: "NR ทดลอง", uom: "kg", create: true }, ctx("planner"));
  A.saveItem(d, { code: "DM08", kind: "CP", name: "NR ทดลอง 2", uom: "kg", create: true }, ctx("planner"));
  const newRod = "RB-DM07-02-RD01-200-3-20";
  A.saveBomTree(d, { code: newRod, item: { name: "เส้นยางใหม่", uom: "rod", kind: "RB" }, nodes: [{ code: "DM07", qty: 0.25 }] }, ctx("planner"));
  assert.equal(A.helpers.itemOf(d, newRod).rubber.compound, "DM07");
  assert.equal(approved(d, newRod).lines[0].qty, 0.25);
  const swapped = A.saveBomTree(d, { code: newRod, item: { name: "เส้นยางใหม่", uom: "rod", kind: "RB" }, nodes: [{ code: "DM08", qty: 0.25 }] }, ctx("planner", NOW + DAY));
  assert.deepEqual(swapped.saved, [`${newRod} Rev.2`], "an existing rod root can switch compound from the builder (a later day: a new revision)");
  assert.equal(A.helpers.itemOf(d, newRod).rubber.compound, "DM08", "the rod's compound field follows the new line");
  assert.equal(approved(d, newRod).lines[0].childCode, "DM08");
  rejects(() => A.saveBomTree(d, { code: "ZZ-PROTO", item: { name: "x", uom: "pcs", kind: "constructor" }, nodes: [{ code: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /ชนิดชิ้นงานไม่ถูกต้อง/);
  rejects(() => A.saveItem(d, { code: "ZZ-PROTO", kind: "toString", name: "x", uom: "pcs", create: true }, ctx("planner")), /ชนิดชิ้นงานไม่ถูกต้อง/);
  rejects(() => A.saveBomTree(d, { code: "DM19", item: { name: "x", uom: "kg", kind: "CP" }, nodes: [{ code: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /ไม่มีส่วนประกอบ บันทึกเป็นชิ้นงานแทน/);
  rejects(() => A.saveBomTree(d, { code: "P-NEW-01", item: { name: "x", uom: "pcs", kind: "PURCHASED" }, nodes: [{ code: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /ไม่มีส่วนประกอบ บันทึกเป็นชิ้นงานแทน/);
  rejects(() => A.saveBomTree(d, { code: "X-NEW-01", item: { name: "x", uom: "pcs", kind: "NOPE" }, nodes: [{ code: "P-PEL-BK", qty: 1 }] }, ctx("planner")), /ชนิดชิ้นงานไม่ถูกต้อง/);
  assert.equal(A.helpers.itemOf(d, "DM19"), null);
});

test("order items can be edited in a draft and in a released order whose jobs have not started (the order goes back to draft)", () => {
  const d = fresh();
  const id = A.createOrder(d, { pi: "T-EDIT", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  const order = d.orders.find((entry) => entry.id === id);
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, ctx("planner"));
  // แก้จำนวนในใบร่าง
  A.explodeOrder(d, { orderId: id }, ctx("planner"));
  A.updateOrderItem(d, { orderId: id, fgCode: "demo-tp-01(p)-y", qty: "100", note: "ด่วน" }, ctx("planner"));
  assert.deepEqual(order.items.map((item) => [item.fgCode, item.qty, item.note]), [["DEMO-TP-01(P)-Y", 100, "ด่วน"], ["DEMO-HL-24(B)-A", 40, ""]]);
  assert.equal(order.explosion, null, "editing a quantity invalidates the explosion");
  assert.equal(order.revision, 0, "a draft edit does not bump the revision");
  rejects(() => A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 100, note: "ด่วน" }, ctx("planner")), /เท่าเดิม/);
  rejects(() => A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 0 }, ctx("planner")), /จำนวนสั่ง/);
  rejects(() => A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-BL-60(K)-Z", qty: 5 }, ctx("planner")), /ไม่พบสินค้านี้ในใบ/);
  rejects(() => A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 5 }, ctx("gr")), /ฝ่ายวางแผน/);
  // ใบที่ปล่อยผลิตแล้ว ยังไม่มีงานเริ่ม: แก้ได้ ใบกลับเป็นร่าง งานรายแผนกถูกลบ REV. +1
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  assert.ok(d.jobs.some((job) => job.orderId === id));
  A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 60 }, ctx("planner"));
  assert.equal(order.status, "draft");
  assert.equal(order.revision, 1);
  assert.equal(order.releasedAt, undefined);
  assert.equal(d.jobs.filter((job) => job.orderId === id).length, 0, "jobs of the old release are removed");
  assert.match(d.audit[1].action, /กลับมาแก้/);
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 20 }, ctx("planner"));
  assert.equal(order.status, "draft");
  assert.equal(order.revision, 2);
  assert.equal(order.items.find((item) => item.fgCode === "DEMO-TP-01(P)-Y").qty, 120);
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  A.removeOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A" }, ctx("planner"));
  assert.deepEqual([order.status, order.revision, order.items.length], ["draft", 3, 1]);
  rejects(() => A.removeOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A" }, ctx("planner")), /ไม่พบสินค้านี้ในใบ/);
  // มีงานเริ่มแล้ว (รายงานผลผลิต): แก้ไม่ได้ และไม่มีอะไรเปลี่ยน
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  const pk = d.jobs.find((job) => job.orderId === id && job.dept === "PK" && job.kind === "FG");
  A.reportJob(d, { jobId: pk.id, qtyDone: 1 }, ctx("planner"));
  rejects(() => A.updateOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 5 }, ctx("planner")), /มีงานที่เริ่มแล้ว \(PK DEMO-TP-01\(P\)-Y\)/);
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 5 }, ctx("planner")), /มีงานที่เริ่มแล้ว/);
  assert.equal(order.status, "in_progress");
  // ใบที่ยกเลิกแล้วแก้ไม่ได้
  const other = A.createOrder(d, { pi: "T-CXL", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  A.addOrderItem(d, { orderId: other, fgCode: "DEMO-TP-01(P)-Y", qty: 1 }, ctx("planner"));
  A.cancelOrder(d, { orderId: other, reason: "เปิดใบซ้ำ" }, ctx("planner"));
  rejects(() => A.updateOrderItem(d, { orderId: other, fgCode: "DEMO-TP-01(P)-Y", qty: 2 }, ctx("planner")), /ปิดหรือยกเลิก/);
  // ใบตัวอย่างที่มีงานเริ่มแล้ว
  rejects(() => A.removeOrderItem(d, { orderId: "DEMO-26001", fgCode: "DEMO-TP-01(P)-Y" }, ctx("planner")), /มีงานที่เริ่มแล้ว/);
});

test("a job started or held without output, or linked to RubberFlow, locks the order items; stock counts survive a reopen", () => {
  const d = fresh();
  const open = (pi) => {
    const id = A.createOrder(d, { pi, customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
    A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner"));
    return d.orders.find((entry) => entry.id === id);
  };
  const rbJob = (order) => d.jobs.find((job) => job.orderId === order.id && job.dept === "RB");
  for (const status of ["in_progress", "hold"]) {
    const order = open(`T-${status}`);
    A.releaseOrder(d, { orderId: order.id }, ctx("planner"));
    A.setJobStatus(d, { jobId: rbJob(order).id, status, reason: "รอแม่พิมพ์" }, ctx("rb"));
    rejects(() => A.updateOrderItem(d, { orderId: order.id, fgCode: "DEMO-TP-01(P)-Y", qty: 5 }, ctx("planner")), /มีงานที่เริ่มแล้ว \(RB /);
    rejects(() => A.updateOrderItem(d, { orderId: order.id, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner")), /มีงานที่เริ่มแล้ว/, "a locked order explains the lock before a same-value check");
  }
  const linked = open("T-LINK");
  A.releaseOrder(d, { orderId: linked.id }, ctx("planner"));
  A.linkJobToRubberFlow(d, { jobId: rbJob(linked).id, woId: "WO-1", kg: 3 }, ctx("planner"));
  A.setJobStatus(d, { jobId: rbJob(linked).id, status: "queued" }, ctx("rb"));
  rejects(() => A.removeOrderItem(d, { orderId: linked.id, fgCode: "DEMO-TP-01(P)-Y" }, ctx("planner")), /มีงานที่เริ่มแล้ว/, "a RubberFlow work order locks the order even when the job is queued again");
  // ยอดคงคลังที่นับไว้คงอยู่หลังเปิดใบกลับมาแก้ ส่วนเวลาระเบิดล้าง
  const counted = open("T-COUNT");
  A.explodeOrder(d, { orderId: counted.id }, ctx("planner"));
  A.setStockCount(d, { orderId: counted.id, itemCode: "PT-00320", qty: 2 }, ctx("st"));
  A.releaseOrder(d, { orderId: counted.id }, ctx("planner"));
  A.updateOrderItem(d, { orderId: counted.id, fgCode: "DEMO-TP-01(P)-Y", qty: 90 }, ctx("planner"));
  assert.deepEqual([counted.status, counted.explodedAt, counted.explosion, counted.stockCounts["PT-00320"]], ["draft", null, null, 2]);
  assert.ok(!d.jobs.some((job) => job.orderId === counted.id), "reopening deletes the part jobs with the other jobs");
});

test("who may do what with a job or a count: the planner group everywhere, a department its own jobs, ST and WH count, RubberFlow links are RB's or the planners'", () => {
  const d = fresh();
  // งาน GR ที่ตั้งขั้นตอนแล้ว (ชุดสาธิตของ GR) ยอดมาจากผลรายวัน จึงใช้งานที่ยังรายงานแบบเดิมได้
  const job = d.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.dept === "GR" && entry.status !== "done" && !d.grPlans.some((plan) => plan.jobId === entry.id));
  const staff = (role, dept) => ({ id: role, role, dept, name: role });
  const { canWorkJob, canCount, canLinkRubberflow } = A.helpers;
  for (const planning of [user("planner"), user("manager"), user("admin")]) assert.equal(canWorkJob(planning, job), true, "the planner group reports for every department");
  assert.equal(canWorkJob(user("gr"), job), true, "the department of the job");
  assert.equal(canWorkJob(staff("viewer", "GR"), job), true, "any role of that department");
  for (const other of [user("rb"), user("st"), staff("wh", "WH"), staff("viewer", "QA")]) assert.equal(canWorkJob(other, job), false);
  assert.equal(canWorkJob({ role: "viewer", dept: "" }, { dept: "" }), false, "no department matches no job");
  for (const allowed of [user("planner"), user("manager"), user("admin"), user("st"), staff("wh", "WH")]) assert.equal(canCount(allowed), true);
  for (const denied of [user("rb"), user("gr"), staff("viewer", "QA")]) assert.equal(canCount(denied), false);
  const rbJob = { dept: "RB" };
  for (const allowed of [user("planner"), user("manager"), user("admin")]) assert.equal(canLinkRubberflow(allowed, rbJob), true);
  // โรงงานขั้น 6: แผนก RB เปิด WO เองไม่ได้แล้ว (ฝ่ายวางแผนเปิดและปล่อยผลิตที่ BOM)
  for (const denied of [user("rb"), user("gr"), user("st")]) assert.equal(canLinkRubberflow(denied, rbJob), false);
  assert.equal(canLinkRubberflow(user("planner"), job), false, "only RB jobs");

  // planner กลุ่มรายงานงานของแผนกอื่นได้ (เดิมได้เฉพาะ PK)
  const before = job.qtyDone;
  A.reportJob(d, { jobId: job.id, qtyDone: 1 }, ctx("planner"));
  assert.equal(job.qtyDone, before + 1);
  const order = d.orders.find((entry) => entry.status === "draft");
  A.explodeOrder(d, { orderId: order.id }, ctx("planner"));
  const line = order.explosion.find((entry) => entry.level > 0 && entry.kind !== "PURCHASED");
  A.setStockCount(d, { orderId: order.id, itemCode: line.itemCode, qty: 2 }, { now: NOW, user: staff("wh", "WH") });
  assert.equal(order.stockCounts[line.itemCode], 2, "WH counts");
  rejects(() => A.setStockCount(d, { orderId: order.id, itemCode: line.itemCode, qty: 2 }, ctx("rb")), /ST\/WH/);
});

test("customers: a PI with a new name adds it, a known name (any case) is reused with its stored spelling, saveCustomer adds and edits by name and only for planners", () => {
  const d = fresh();
  assert.deepEqual(d.customers.map((customer) => customer.name), ["ลูกค้าสาธิต เบลเยียม", "ลูกค้าสาธิต กรุงเทพ", "ลูกค้าสาธิต ระยอง"], "the demo orders added their customers when the seed was built");
  d.customers = [];
  const order = (customer, extra = {}) => A.createOrder(d, { customer, country: "Thailand", orderedAt: day(0), whDue: day(10), ...extra }, ctx("planner"));
  order("Acme");
  assert.deepEqual(d.customers, [{ name: "Acme", country: "Thailand", orderType: "SA", note: "" }]);
  assert.match(d.audit[0].detail, /เพิ่มลูกค้าใหม่/);
  const second = order("  aCME ");
  assert.equal(d.customers.length, 1);
  assert.equal(d.orders.find((entry) => entry.id === second).customer, "Acme");
  assert.doesNotMatch(d.audit[0].detail, /เพิ่มลูกค้าใหม่/);
  A.saveCustomer(d, { name: "ACME", country: "Japan", note: " หมายเหตุ " }, ctx("manager"));
  assert.deepEqual(d.customers, [{ name: "ACME", country: "Japan", orderType: "EX", note: "หมายเหตุ" }], "same key: edited, the new spelling kept");
  rejects(() => A.saveCustomer(d, { name: "acme", country: "Japan", create: true }, ctx("planner")), /มีลูกค้า ACME อยู่แล้ว/);
  rejects(() => A.saveCustomer(d, { name: "", country: "Japan" }, ctx("planner")), /ชื่อลูกค้า/);
  rejects(() => A.saveCustomer(d, { name: "X", country: "Japan", orderType: "ZZ" }, ctx("planner")), /SA หรือ EX/);
  for (const role of ["rb", "st", "gr"]) rejects(() => A.saveCustomer(d, { name: "Y", country: "Thailand" }, ctx(role)), /ฝ่ายวางแผนหรือผู้จัดการ/);
});

test("database mode: the PI number follows the highest -YYnnn of the year in the snapshot, and jobs get a random suffix like BOM and routing ids", () => {
  const d = fresh();
  const remote = (suffix = "abc123") => ({ now: NOW, user: user("planner"), idSuffix: () => suffix, remote: true });
  const year = rules.piYear(day(0));
  d.orders.push({ id: `250101-${year}047`, status: "draft", items: [], stockCounts: {} }, { id: `240101-${String(Number(year) - 1)}099`, status: "draft", items: [], stockCounts: {} });
  const id = A.createOrder(d, { customer: "A", country: "Thailand", orderedAt: day(0), whDue: day(10) }, remote());
  assert.equal(id, rules.piNumber(day(0), 48), "one after the highest sequence of the same year; another year's number does not count");
  assert.equal(d.counters[`PI-${year}`], undefined, "no local counter in database mode");
  const typed = A.createOrder(d, { pi: "my-typed-1", customer: "A", country: "Thailand", orderedAt: day(0), whDue: day(10) }, remote());
  assert.equal(typed, "MY-TYPED-1", "a typed number is kept");
  assert.equal(A.createOrder(d, { customer: "A", country: "Thailand", orderedAt: day(0), whDue: day(10) }, remote()), rules.piNumber(day(0), 49));

  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 3 }, ctx("planner"));
  A.releaseOrder(d, { orderId: id }, remote("zz9"));
  const jobs = d.jobs.filter((job) => job.orderId === id);
  assert.ok(jobs.length > 1);
  assert.ok(jobs.every((job) => /^JOB-\d\d-\d{4}-zz9$/.test(job.id)), jobs.map((job) => job.id).join(","));
  assert.equal(new Set(jobs.map((job) => job.id)).size, jobs.length, "the counter part still differs between jobs");
  assert.ok(jobs.every((job) => job.id.length <= 40));
  // ในเครื่อง (ไม่มี idSuffix) รหัสงานเหมือนเดิม
  const local = fresh();
  const localId = A.createOrder(local, { customer: "A", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
  A.addOrderItem(local, { orderId: localId, fgCode: "DEMO-TP-01(P)-Y", qty: 3 }, ctx("planner"));
  A.releaseOrder(local, { orderId: localId }, ctx("planner"));
  assert.ok(local.jobs.filter((job) => job.orderId === localId).every((job) => /^JOB-\d\d-\d{4}$/.test(job.id)));
});

// ---------- ตรวจข้อมูล · เลิกใช้ชิ้นงาน · วางหลายบรรทัดจาก Excel ----------
test("the data check lists what blocks a release: used-but-no-BOM make items, RB without a compound, FGs without a BOM, other units and generated codes", () => {
  const d = fresh();
  const codes = (audit, group) => audit[group].map((entry) => entry.item.code);
  let audit = rules.auditMaster(d);
  assert.deepEqual(codes(audit, "noBom"), [], "the seed has no make item that is used without a BOM");
  assert.deepEqual(codes(audit, "fgNoBom"), ["DEMO-BL-60(K)-Z"]);
  assert.deepEqual(codes(audit, "generated"), ["XP-00001"], "a generated code is listed");
  assert.equal(audit.rbCompound.length, 0, "demo rods have the compound field (no CP line is fine: Excel imports never have one)");
  // MEGA-BBL-06 ในโลกจริง: SE ถูกใช้ใน BOM ของสินค้าแล้วแต่ SE เองยังไม่มี BOM → ระเบิดแล้วเป็น noBom ปล่อยผลิตไม่ได้
  A.saveBom(d, { itemCode: "DEMO-BL-60(K)-Z", lines: [{ childCode: "SE-BL60-RD01-60-0-60", qty: 1 }] }, ctx("planner"));
  audit = rules.auditMaster(d);
  assert.deepEqual(audit.noBom.map((entry) => [entry.item.code, entry.usedIn]), [["SE-BL60-RD01-60-0-60", ["DEMO-BL-60(K)-Z"]]]);
  assert.deepEqual(codes(audit, "fgNoBom"), [], "the product now has a BOM");
  const exploded = rules.explode("DEMO-BL-60(K)-Z", 1, { itemOf: (code) => A.helpers.itemOf(d, code), approvedBomOf: (code) => approved(d, code) });
  assert.deepEqual(exploded.lines.filter((line) => line.noBom).map((line) => line.itemCode), ["SE-BL60-RD01-60-0-60"], "the check uses the same rule as the release");
  A.saveBom(d, { itemCode: "SE-BL60-RD01-60-0-60", lines: [{ childCode: "RB-DM01-01-OR01-200-0-72", qty: 0.1 }] }, ctx("planner"));
  assert.deepEqual(codes(rules.auditMaster(d), "noBom"), []);
  // RB ที่ไม่มีสูตรทั้งสองทาง · หน่วยอื่น · เลิกใช้ไม่ถูกนับ (ยกเว้นกลุ่มแรก)
  A.saveItem(d, { code: "RB-NEW-1", kind: "RB", name: "เส้นใหม่", uom: "rod", rubber: { compound: "DM01" }, create: true }, ctx("planner"));
  A.saveItem(d, { code: "P-ODD", kind: "PURCHASED", name: "ของแปลก", uom: "other", create: true }, ctx("planner"));
  audit = rules.auditMaster(d);
  assert.equal(audit.rbCompound.find((entry) => entry.item.code === "RB-NEW-1"), undefined, "a rod with the compound field is not listed");
  assert.deepEqual(codes(audit, "uomOther"), ["P-ODD"]);
  A.saveItem(d, { code: "P-ODD", kind: "PURCHASED", name: "ของแปลก", uom: "other", active: false }, ctx("planner"));
  A.saveItem(d, { code: "XP-00001", kind: "SUBPART", name: "แกนตอปิโด ตัดยาว 14 ซม.", uom: "pcs", active: false }, ctx("planner"));
  audit = rules.auditMaster(d);
  assert.deepEqual([codes(audit, "uomOther"), codes(audit, "generated")], [[], []], "retired items are not listed");
  // ไม่มีทั้งช่องสูตรและบรรทัด CP
  d.items.find((item) => item.code === "RB-NEW-1").rubber = {};
  assert.deepEqual(rules.auditMaster(d).rbCompound.find((entry) => entry.item.code === "RB-NEW-1").reasons, ["noCompound"]);
});

test("deactivating an item keeps every existing BOM and order valid but refuses it as a new line or a new order item", () => {
  const d = fresh();
  const planner = ctx("planner");
  rejects(() => A.saveItem(d, { code: "P-BOX-01", kind: "PURCHASED", name: "x", uom: "pcs", active: false }, ctx("gr")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  A.saveItem(d, { code: "P-BOX-01", kind: "PURCHASED", name: "กล่องนอก 40 × 60 × 30 ซม. (ลัง 40 ชุด)", uom: "pcs", active: false }, planner);
  assert.equal(A.helpers.itemOf(d, "P-BOX-01").active, false);
  // แก้ชิ้นงานโดยไม่ส่ง active = คงสถานะเดิม
  A.saveItem(d, { code: "P-BOX-01", kind: "PURCHASED", name: "กล่องนอก ชื่อใหม่", uom: "pcs" }, planner);
  assert.equal(A.helpers.itemOf(d, "P-BOX-01").active, false);
  // BOM เดิมที่ใช้ชิ้นนี้ยังบันทึกซ้ำ/แก้ปริมาณอื่นได้
  const before = approved(d, "DEMO-TP-01(P)-Y");
  assert.ok(before.lines.some((line) => line.childCode === "P-BOX-01"));
  const lines = before.lines.map((line) => ({ childCode: line.childCode, qty: line.childCode === "P-STK-01" ? 2 : line.qty, scrapPct: line.scrapPct, note: line.note }));
  const saved = A.saveBom(d, { itemCode: "DEMO-TP-01(P)-Y", lines, note: "แก้สติ๊กเกอร์" }, planner);
  assert.equal(saved.changed, true);
  assert.ok(approved(d, "DEMO-TP-01(P)-Y").lines.some((line) => line.childCode === "P-BOX-01"), "the retired item stays in the BOM");
  // แต่เพิ่มเป็นบรรทัดใหม่ของ BOM อื่นไม่ได้
  rejects(() => A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [...approved(d, "SE-TP01-OR01-100-18-65").lines.map((line) => ({ childCode: line.childCode, qty: line.qty })), { childCode: "P-BOX-01", qty: 1 }] }, planner), /P-BOX-01 เลิกใช้แล้ว/);
  // ใบสั่งผลิต: สินค้าที่เลิกใช้เพิ่มเป็นรายการใหม่ไม่ได้ แต่รายการที่อยู่ในใบแล้วยังเพิ่มจำนวนได้
  const orderId = A.createOrder(d, { customer: "A", country: "Thailand", orderedAt: day(0), whDue: day(10) }, planner);
  A.addOrderItem(d, { orderId, fgCode: "DEMO-HL-24(B)-A", qty: 2 }, planner);
  A.saveItem(d, { code: "DEMO-HL-24(B)-A", kind: "FG", name: "ห่วงฮูล่า HL-24 นิ้ว กล่อง ชุดสี A", uom: "set", active: false }, planner);
  A.addOrderItem(d, { orderId, fgCode: "DEMO-HL-24(B)-A", qty: 1 }, planner);
  assert.equal(d.orders.find((order) => order.id === orderId).items[0].qty, 3, "an item already on the order can still be added to");
  const other = A.createOrder(d, { customer: "B", country: "Thailand", orderedAt: day(0), whDue: day(10) }, planner);
  rejects(() => A.addOrderItem(d, { orderId: other, fgCode: "DEMO-HL-24(B)-A", qty: 1 }, planner), /เลิกใช้แล้ว/);
  // ปล่อยผลิตใบที่ใช้ชิ้นที่เลิกใช้ได้ตามปกติ
  assert.equal(A.releaseOrder(d, { orderId }, planner), orderId);
  // เปิดใช้อีกครั้ง
  A.saveItem(d, { code: "DEMO-HL-24(B)-A", kind: "FG", name: "ห่วงฮูล่า HL-24 นิ้ว กล่อง ชุดสี A", uom: "set", active: true }, planner);
  assert.equal(A.helpers.itemOf(d, "DEMO-HL-24(B)-A").active, true);
  assert.equal(A.addOrderItem(d, { orderId: other, fgCode: "DEMO-HL-24(B)-A", qty: 1 }, planner), other);
  // เส้นยางที่ข้อมูลไม่ครบ เลิกใช้ได้ (เก็บของเสียออกจากตัวเลือก) แต่เปิดใช้อีกครั้งต้องแก้ให้ครบก่อน
  A.saveItem(d, { code: "RB-BAD-1", kind: "RB", name: "เส้นเสีย", uom: "rod", rubber: { compound: "DM01" }, create: true }, planner);
  A.helpers.itemOf(d, "RB-BAD-1").rubber = {};
  A.saveItem(d, { code: "RB-BAD-1", kind: "RB", name: "เส้นเสีย", uom: "rod", active: false }, planner);
  assert.equal(A.helpers.itemOf(d, "RB-BAD-1").active, false);
  rejects(() => A.saveItem(d, { code: "RB-BAD-1", kind: "RB", name: "เส้นเสีย", uom: "rod", active: true }, planner), /ต้องระบุรหัสสูตรยาง/);
});

test("pasting from Excel: header detection, TSV and CSV, optional columns, bad quantities, duplicates", () => {
  const tsv = rules.parseBomPaste("รหัส\tจำนวน\tหน่วย\t% เผื่อเสีย\tหมายเหตุ\nP-STK-01\t2\tชิ้น\t3\tติดกล่อง\nP-BOX-01\t0.5");
  assert.equal(tsv.header, true);
  assert.deepEqual(tsv.rows.map((row) => [row.line, row.code, row.qty, row.uom, row.scrapPct, row.note, row.error]), [[2, "P-STK-01", 2, "pcs", 3, "ติดกล่อง", ""], [3, "P-BOX-01", 0.5, "", 0, "", ""]]);
  // ไม่มีแถวหัว: ตามลำดับ รหัส ปริมาณ หน่วย % หมายเหตุ · CSV · ตัวคั่นหลักพัน · รหัสพิมพ์เล็ก/มีช่องว่าง
  const csv = rules.parseBomPaste("p-stk-01,1,pcs\n P-BOX-01 ,\"1,000\"");
  assert.equal(csv.header, false);
  assert.deepEqual(csv.rows.map((row) => [row.line, row.code, row.qty, row.error]), [[1, "P-STK-01", 1, ""], [2, "P-BOX-01", 1000, ""]]);
  // แถวหัวที่ไม่รู้จักชื่อ: ช่องปริมาณของแถวแรกไม่ใช่ตัวเลขแต่แถวถัดไปใช่ = ข้ามแถวแรก
  const unknown = rules.parseBomPaste("Part No\tQuantity per set\nA-1\t2");
  assert.equal(unknown.header, true);
  assert.deepEqual(unknown.rows.map((row) => [row.code, row.qty]), [["A-1", 2]]);
  // ชื่อคอลัมน์อังกฤษ สลับลำดับ มีคอลัมน์ชื่อ
  const english = rules.parseBomPaste("Qty\tName\tCode\tUOM\n4\tกล่องใหญ่\tp-new-1\tbox");
  assert.deepEqual(english.rows.map((row) => [row.code, row.qty, row.name, row.uom]), [["P-NEW-1", 4, "กล่องใหญ่", "box"]]);
  // ผิด: ไม่มีรหัส · ปริมาณไม่ใช่ตัวเลข/ศูนย์/ติดลบ · % ติดลบ · ซ้ำ
  const bad = rules.parseBomPaste("A-1\t2\nA-2\tabc\nA-3\t0\nA-4\t-1\nA-5\t1\t\t-5\n\t3\nA-1\t5");
  assert.deepEqual(bad.rows.map((row) => row.error), ["", "อ่านปริมาณไม่ได้หรือกำกวม ใช้จุดเป็นทศนิยม เช่น 0.5 และ 1,500 = หนึ่งพันห้าร้อย", "ปริมาณต้องเป็นตัวเลขมากกว่า 0", "ปริมาณต้องเป็นตัวเลขมากกว่า 0", "% เผื่อเสียต้องเป็นตัวเลขไม่ติดลบ", "ไม่มีรหัสชิ้นงาน", "รหัสซ้ำกับบรรทัดก่อนหน้า (รวมปริมาณเป็นบรรทัดเดียว)"]);
  assert.deepEqual(rules.parseBomPaste("").rows, []);
  assert.equal(rules.parseBomPaste(Array.from({ length: 600 }, (_, i) => `X-${i}\t1`).join("\n")).rows.length, 500, "at most 500 lines are read");
});

test("pasting from Excel: a decimal comma or a thousands comma is read by one rule and anything ambiguous is flagged, never guessed", () => {
  const read = (text) => rules.parseBomPaste(`A-1\t${text}`).rows[0];
  const good = { "0,5": 0.5, "1,5": 1.5, "12,25": 12.25, "1,500": 1500, "1,000,000": 1000000, "1.000,50": 1000.5, "1,000.50": 1000.5, "1.234.567,8": 1234567.8, "0.5": 0.5, ".5": 0.5, "1.000": 1, "1,5000": 1.5, "7": 7, " 3 % ": 3 };
  for (const [text, expected] of Object.entries(good)) assert.deepEqual([read(text).qty, read(text).error], [expected, ""], `${text} = ${expected}`);
  // กำกวม/ผิดรูป: ไม่เดา ติดธงบรรทัดและไม่เอาค่า
  for (const text of ["0,500", "1.000.000", "1,2,3", "1234,567", "1.5,3", "1,00.5", "1e3", "5,", ",5", "1,5,", "--1", "1.2.3", "0x10"]) {
    assert.match(read(text).error, /อ่านปริมาณไม่ได้หรือกำกวม/, `${text} is flagged`);
    assert.equal(read(text).qty, 0);
  }
  // % เผื่อเสีย ใช้กฎเดียวกัน: 2,5 = 2.5 · 1,2,3 ผิด
  assert.equal(rules.parseBomPaste("A-1\t1\tpcs\t2,5").rows[0].scrapPct, 2.5);
  assert.match(rules.parseBomPaste("A-1\t1\tpcs\t1,2,3").rows[0].error, /% เผื่อเสีย/);
});

test("pasting from Excel: an unknown header line is skipped only when it cannot be data, and the page says so", () => {
  // หัวที่ไม่รู้จัก: ข้าม · ถ้ารหัสในบรรทัดแรกเป็นชิ้นงานที่มีอยู่ ถือเป็นบรรทัดข้อมูลที่ปริมาณผิด ไม่ข้าม
  const text = "A-1\tx\nA-2\t3";
  const skipped = rules.parseBomPaste(text);
  assert.equal(skipped.header, true);
  assert.deepEqual(skipped.rows.map((row) => [row.line, row.code]), [[2, "A-2"]]);
  const kept = rules.parseBomPaste(text, { isKnownCode: (code) => code === "A-1" });
  assert.equal(kept.header, false);
  assert.deepEqual(kept.rows.map((row) => [row.line, row.code, Boolean(row.error)]), [[1, "A-1", true], [2, "A-2", false]]);
  // หัวที่รู้จักชื่อ: ข้ามเสมอ ไม่ถามรายการชิ้นงาน
  assert.equal(rules.parseBomPaste("รหัส\tจำนวน\nA-1\t2", { isKnownCode: () => true }).header, true);
});

test("deactivating sends active in the record the remote store diffs", () => {
  const before = fresh();
  const after = structuredClone(before);
  A.saveItem(after, { code: "P-BOX-01", kind: "PURCHASED", name: "กล่องนอก 40 × 60 × 30 ซม. (ลัง 40 ชุด)", uom: "pcs", active: false }, ctx("planner"));
  const changes = storeApi.diffMaster(before, after);
  assert.deepEqual(Object.keys(changes), ["items"]);
  assert.equal(changes.items.upsert.length, 1);
  assert.equal(changes.items.upsert[0].code, "P-BOX-01");
  assert.equal(changes.items.upsert[0].active, false);
});

test("a job linked to a RubberFlow work order is started only once the WO is past released, when the WO list is known; without it the old rule holds", () => {
  const d = fresh();
  const open = (pi) => {
    const id = A.createOrder(d, { pi, customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner"));
    A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 80 }, ctx("planner"));
    A.releaseOrder(d, { orderId: id }, ctx("planner"));
    const order = d.orders.find((entry) => entry.id === id);
    const rb = d.jobs.find((job) => job.orderId === id && job.dept === "RB");
    // งานที่ฐานข้อมูลผูก WO ให้ตอนปล่อยผลิต: ยังรอคิว มีแค่ externalRef (auto)
    rb.externalRef = { system: "rubberflow", woId: `WO-${pi}`, kg: 3, linkedAt: NOW, by: "x", auto: true };
    return { id, order, rb };
  };
  const a = open("T-AUTO-A");
  assert.equal(a.rb.status, "queued");
  assert.equal(A.helpers.startedJobs(d, a.order).length, 1, "no WO list (local mode or RubberFlow not loaded): a link counts as started, as before");
  for (const [status, started] of [["planned", 0], ["released", 0], ["cancelled", 0], ["in_progress", 1], ["on_hold", 1], ["completed", 1]]) {
    assert.equal(A.helpers.startedJobs(d, a.order, [{ id: "WO-T-AUTO-A", status, sourceJobId: a.rb.id }]).length, started, `WO ${status}`);
  }
  assert.equal(A.helpers.startedJobs(d, a.order, []).length, 1, "a WO that cannot be found counts as started");
  assert.equal(A.helpers.startedJobs(d, a.order, [{ id: "WO-T-AUTO-A", status: "planned", sourceJobId: a.rb.id }]).length, 0);
  assert.equal(A.helpers.startedJobs(d, a.order, [{ id: "WO-T-AUTO-A", status: "planned", sourceJobId: "JOB-OTHER" }]).length, 1, "a WO that does not point back at this job counts as not found");
  // ยกเลิกใบ (20261128010000): WO ไม่ขวางอีก ทั้งที่ยังไม่เริ่มและที่เริ่มแล้ว (ฐานข้อมูลยกเลิก / หยุดให้) · ต้องมีเหตุผล · งานของใบคงอยู่
  rejects(() => A.cancelOrder(d, { orderId: a.id }, { ...ctx("planner"), rfOrders: [{ id: "WO-T-AUTO-A", status: "in_progress", sourceJobId: a.rb.id }] }), /เหตุผลที่ยกเลิก/);
  A.cancelOrder(d, { orderId: a.id, reason: "ลูกค้ายกเลิก" }, { ...ctx("planner"), rfOrders: [{ id: "WO-T-AUTO-A", status: "in_progress", sourceJobId: a.rb.id }] });
  assert.equal(a.order.status, "cancelled");
  assert.equal(d.jobs.some((job) => job.orderId === a.id), true, "the jobs stay with the cancelled order");
  // เปิดใบกลับมาแก้: ตามกฎเดียวกัน
  const b = open("T-AUTO-B");
  rejects(() => A.updateOrderItem(d, { orderId: b.id, fgCode: "DEMO-TP-01(P)-Y", qty: 90 }, ctx("planner")), /มีงานที่เริ่มแล้ว/);
  rejects(() => A.updateOrderItem(d, { orderId: b.id, fgCode: "DEMO-TP-01(P)-Y", qty: 90 }, { ...ctx("planner"), rfOrders: [{ id: "WO-T-AUTO-B", status: "completed" }] }), /มีงานที่เริ่มแล้ว/);
  A.updateOrderItem(d, { orderId: b.id, fgCode: "DEMO-TP-01(P)-Y", qty: 90 }, { ...ctx("planner"), rfOrders: [{ id: "WO-T-AUTO-B", status: "planned", sourceJobId: b.rb.id }] });
  assert.equal(b.order.status, "draft");
});

test("the notice for what the database did in RubberFlow: opened count, skipped reasons (sticky), cancelled work orders, nothing otherwise", () => {
  const notice = A.helpers.rubberflowNotice;
  assert.equal(notice("releaseOrder", { orderId: "PI-1" }, undefined), null);
  assert.equal(notice("releaseOrder", { orderId: "PI-1" }, { opened: [], skipped: [], cancelled: [] }), null);
  assert.deepEqual(notice("releaseOrder", { orderId: "PI-1" }, { opened: [{ jobId: "J1", woId: "WO-1", kg: 2 }, { jobId: "J2", woId: "WO-2", kg: 3 }] }), { text: "ปล่อยผลิต PI-1 แล้ว · เปิด WO ใน RubberFlow 2 ใบ", type: "success" });
  const skipped = (n) => Array.from({ length: n }, (_, i) => ({ jobId: `J${i + 1}`, itemCode: `RB-${i + 1}`, reason: "ยังไม่ผูกสูตร RubberFlow" }));
  assert.deepEqual(notice("releaseOrder", { orderId: "PI-1" }, { opened: [{ jobId: "J0", woId: "WO-0", kg: 1 }], skipped: skipped(1) }),
    { text: "ปล่อยผลิต PI-1 แล้ว · เปิด WO ใน RubberFlow 1 ใบ · ยังไม่ได้เปิด WO 1 งาน (J1 RB-1: ยังไม่ผูกสูตร RubberFlow)", type: "success" });
  assert.match(notice("releaseOrder", { orderId: "PI-1" }, { skipped: skipped(5) }).text, /^ปล่อยผลิต PI-1 แล้ว · ยังไม่ได้เปิด WO 5 งาน \(J1 RB-1: .* · J3 RB-3: .* · อีก 2 งาน\)$/);
  assert.deepEqual(notice("cancelOrder", { orderId: "PI-1" }, { cancelled: ["WO-1", "WO-2"] }), { text: "ยกเลิกหรือหยุด WO WO-1, WO-2 ใน RubberFlow ด้วย", type: "success" });
  assert.equal(notice("cancelOrder", { orderId: "PI-1" }, { opened: [{ jobId: "J1", woId: "WO-1", kg: 1 }] }), null, "only a release says what it opened");
});

test("part stock: ST and WH count, the planning group and ST set the safety stock (WH, RB, other departments cannot), only purchased parts, blanks keep the stored value, every changed balance is a move", () => {
  const d = fresh();
  const wh = { now: NOW, user: { id: "wh", role: "wh", dept: "WH", name: "คลังสินค้า" } };
  const stock = (code) => d.stock.find((row) => row.itemCode === code);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 5 }] }, ctx("rb")), /ST\/WH/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 5 }] }, ctx("gr")), /ST\/WH/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 5 }] }, { now: NOW, user: null }), /เลือกบทบาท/);
  // สต็อกขั้นต่ำ: WH (นับได้อย่างเดียว) และแผนกอื่น/ผู้ดู ตั้งไม่ได้ · ทั้งชุดไม่ผ่านพร้อมกัน แม้ยอดนับในแถวเดียวกันผ่าน
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", safetyQty: 50 }] }, wh), /สต็อกขั้นต่ำ.*ฝ่ายวางแผน/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 5, safetyQty: 50 }] }, wh), /สต็อกขั้นต่ำ.*ฝ่ายวางแผน/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", safetyQty: 50 }] }, ctx("rb")), /ST\/WH|สต็อกขั้นต่ำ/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", safetyQty: 50 }] }, ctx("gr")), /ST\/WH|สต็อกขั้นต่ำ/);
  {
    const kept = structuredClone(d);
    rejects(() => A.countPartStock(kept, { counts: [{ itemCode: "P-STK-01", safetyQty: 50 }] }, wh), /สต็อกขั้นต่ำ/);
    assert.deepEqual(kept, d, "a refused safety change writes nothing");
  }
  assert.deepEqual([A.helpers.canSetSafety(user("st")), A.helpers.canSetSafety(user("planner")), A.helpers.canSetSafety(user("manager")), A.helpers.canSetSafety(user("admin")), A.helpers.canSetSafety(wh.user), A.helpers.canSetSafety(user("rb")), A.helpers.canSetSafety(user("gr")), A.helpers.canSetSafety(null)], [true, true, true, true, false, false, false, false]);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "PT-00320", qty: 5 }] }, ctx("st")), /ไม่ใช่ของซื้อ/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "NOPE", qty: 5 }] }, ctx("st")), /ไม่พบชิ้นงาน NOPE/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: -1 }] }, ctx("st")), /ยอดที่นับ/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: "abc" }] }, ctx("st")), /ยอดที่นับ/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 2e9 }] }, ctx("st")), /ใหญ่เกิน/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 1 }, { itemCode: "p-stk-01", qty: 2 }] }, ctx("st")), /ซ้ำ/);
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: "" }, { itemCode: "P-BOX-01" }] }, ctx("st")), /ยังไม่ได้กรอก/);
  rejects(() => A.countPartStock(structuredClone(d), {}, ctx("st")), /ยังไม่ได้กรอก/);
  const moves = d.stockMoves.length;
  assert.deepEqual(A.countPartStock(d, { counts: [{ itemCode: "p-stk-01", qty: "450" }, { itemCode: "P-ZIP-05", qty: "" }] }, ctx("st")), { changed: 1, summary: "1 รายการ" });
  assert.deepEqual([stock("P-STK-01").qty, stock("P-STK-01").countedBy, stock("P-STK-01").countedAt], [450, "สมศักดิ์ แก้วใส", NOW]);
  assert.deepEqual(d.stockMoves.at(-1), { id: `local-${NOW}-${moves + 1}`, itemCode: "P-STK-01", kind: "count", qty: 50, balance: 450, ref: null, at: NOW, by: "สมศักดิ์ แก้วใส", note: null }, "the move is the difference and the balance after it");
  assert.equal(A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", qty: "450.0", safetyQty: "" }] }, ctx("st")).summary, "0 รายการ (ยอดเท่าเดิมทั้งหมด)", "the same value again writes nothing");
  assert.equal(d.stockMoves.length, moves + 1);
  A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", qty: 440 }] }, wh);
  assert.deepEqual([stock("P-STK-01").qty, d.stockMoves.at(-1).qty, d.stockMoves.at(-1).by], [440, -10, "คลังสินค้า"], "WH counts too");
  A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", safetyQty: 60 }] }, ctx("planner"));
  assert.deepEqual([stock("P-STK-01").safetyQty, stock("P-STK-01").qty, d.stockMoves.length], [60, 440, moves + 2], "a safety change alone writes no move");
  A.countPartStock(d, { counts: [{ itemCode: "P-ROPE-01", qty: 1, safetyQty: 2 }] }, ctx("manager"));
  assert.deepEqual([stock("P-ROPE-01").qty, stock("P-ROPE-01").safetyQty], [1, 2], "a manager counts and sets the safety stock in one row");
  A.countPartStock(d, { counts: [{ itemCode: "P-ROPE-01", qty: 0 }] }, ctx("st"));
  assert.equal(stock("P-ROPE-01").qty, 0, "a part can be counted down to zero");
  assert.match(d.audit[0].detail, /P-ROPE-01 1 → 0/);
  // ST ตั้งสต็อกขั้นต่ำได้ (ไม่มีรายการเคลื่อนไหว) และนับกับตั้งในแถวเดียวกันได้
  const before = d.stockMoves.length;
  A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", safetyQty: 50 }] }, ctx("st"));
  assert.deepEqual([stock("P-STK-01").safetyQty, stock("P-STK-01").qty, d.stockMoves.length], [50, 440, before], "ST sets the safety stock alone: no move, the balance stays");
  assert.match(d.audit[0].detail, /P-STK-01 60 → 50/);
  A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", qty: 430, safetyQty: 70 }] }, ctx("st"));
  assert.deepEqual([stock("P-STK-01").qty, stock("P-STK-01").safetyQty, d.stockMoves.length], [430, 70, before + 1], "ST counts and sets the safety stock in one row");
  // WH ยังนับได้ แต่แถวที่มีสต็อกขั้นต่ำเปลี่ยนจะไม่ผ่านทั้งชุด
  rejects(() => A.countPartStock(structuredClone(d), { counts: [{ itemCode: "P-STK-01", qty: 420 }, { itemCode: "P-ROPE-01", safetyQty: 9 }] }, wh), /สต็อกขั้นต่ำ/);
  A.countPartStock(d, { counts: [{ itemCode: "P-STK-01", qty: 420 }] }, wh);
  assert.deepEqual([stock("P-STK-01").qty, stock("P-STK-01").safetyQty, d.stockMoves.length], [420, 70, before + 2], "the same WH count without a safety change goes through and leaves the safety stock alone");
});

test("issuing the purchased parts of a PI is all or nothing, then the part jobs are done, the stock is down and the order has started; part jobs cannot be reported any other way", () => {
  const d = fresh();
  const order = d.orders.find((entry) => entry.id === "DEMO-26001");
  const parts = () => d.jobs.filter((job) => job.orderId === order.id && A.helpers.isPartJob(job));
  const stock = (code) => d.stock.find((row) => row.itemCode === code);
  assert.equal(parts().length, 7);
  assert.equal(A.helpers.isPartJob(d.jobs.find((job) => job.dept === "PK")), false);
  // สิทธิ์และสถานะของใบ
  rejects(() => A.issueOrderParts(d, { orderId: order.id }, ctx("rb")), /ST/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id }, ctx("gr")), /ST/);
  rejects(() => A.issueOrderParts(d, { orderId: "DEMO-26002" }, ctx("st")), /ปล่อยผลิตแล้ว/);
  assert.deepEqual([A.helpers.canIssueParts(user("st")), A.helpers.canIssueParts(user("planner")), A.helpers.canIssueParts(user("manager")), A.helpers.canIssueParts(user("rb")), A.helpers.canIssueParts({ role: "wh" })], [true, true, true, false, false]);
  // สต็อกกล่องไม่พอ (ต้อง 7 มี 5) = ไม่จ่ายอะไรเลย
  const plan = A.helpers.partIssuePlan(d, order.id);
  assert.deepEqual(plan.short.map((line) => [line.itemCode, line.short]), [["P-BOX-01", 2]]);
  assert.equal(plan.anyShort, true);
  const before = structuredClone(d);
  rejects(() => A.issueOrderParts(d, { orderId: order.id }, ctx("st")), /ไม่ได้เบิกจ่ายอะไรเลย: P-BOX-01 ขาด 2/);
  assert.deepEqual(d, before, "a shortage on one line changes nothing — not even the lines that had enough");
  // นับเพิ่มแล้วจ่ายครบ
  A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }, ctx("st"));
  const moves = d.stockMoves.length;
  assert.equal(order.status, "in_progress");
  assert.deepEqual(A.issueOrderParts(d, { orderId: order.id }, ctx("st")), { issued: 7, summary: "7 รายการ" });
  assert.ok(parts().every((job) => job.status === "done" && job.qtyDone === job.qtyPlanned && job.doneAt === NOW));
  assert.deepEqual([stock("P-BOX-01").qty, stock("P-STK-01").qty], [0, 280], "each balance dropped by the job's remaining quantity");
  assert.equal(d.stockMoves.length, moves + 7);
  assert.deepEqual(d.stockMoves.filter((move) => move.kind === "issue" && move.itemCode === "P-STK-01").map((move) => [move.qty, move.balance, move.ref]), [[-120, 280, "DEMO-26001"]]);
  assert.match(d.audit[0].detail, /DEMO-26001 7 รายการ/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id }, ctx("st")), /ไม่มีของซื้อที่ต้องเบิกจ่าย/, "issuing twice finds nothing left");
  // ใบที่ released: ฐานข้อมูลเปลี่ยนเป็น in_progress เอง (โหมดฐานข้อมูลไม่แก้ใบเอง) · โหมดในเครื่องเปลี่ยนทันที
  for (const remote of [false, true]) {
    const r = fresh();
    const released = r.orders.find((entry) => entry.id === "DEMO-26001");
    released.status = "released";
    A.countPartStock(r, { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }, ctx("planner"));
    A.issueOrderParts(r, { orderId: released.id }, { ...ctx("planner"), remote });
    assert.equal(released.status, remote ? "released" : "in_progress");
  }
  // งานของซื้อรายงานผล/เปลี่ยนสถานะเองไม่ได้ (ทุกบทบาท)
  const open = fresh();
  const job = open.jobs.find((entry) => entry.orderId === "DEMO-26001" && entry.itemCode === "P-STK-01");
  for (const role of ["st", "planner", "manager", "admin"]) {
    rejects(() => A.reportJob(open, { jobId: job.id, qtyDone: 1 }, ctx(role)), /เบิกจ่ายของซื้อ/);
    rejects(() => A.setJobStatus(open, { jobId: job.id, status: "hold" }, ctx(role)), /เบิกจ่ายของซื้อ/);
  }
  assert.deepEqual([job.status, job.qtyDone], ["queued", 0]);
});

test("issuing parts line by line (user rule 2026-11-16): ticked lines only, an editable quantity, a partial line stays open for the rest, over-issue up to the stock, all or nothing per save", () => {
  const d = fresh();
  const order = d.orders.find((entry) => entry.id === "DEMO-26001");
  const jobOf = (code) => d.jobs.find((job) => job.orderId === order.id && A.helpers.isPartJob(job) && job.itemCode === code);
  const stock = (code) => d.stock.find((row) => row.itemCode === code);
  const lineOf = (code) => A.helpers.partIssuePlan(d, order.id).lines.find((line) => line.itemCode === code);
  assert.deepEqual([lineOf("P-BOX-01").planned, lineOf("P-BOX-01").issued, lineOf("P-BOX-01").remaining, lineOf("P-BOX-01").onHand, lineOf("P-BOX-01").short], [7, 0, 7, 5, 2]);
  // ตรวจรายการและจำนวน (ข้อความไทย) · ไม่ผ่าน = ไม่เปลี่ยนอะไร
  const before = structuredClone(d);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [] }, ctx("st")), /เลือกรายการที่จะเบิกอย่างน้อยหนึ่งรายการ/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 0 }] }, ctx("st")), /จำนวนที่เบิก P-STK-01 ต้องมากกว่า 0/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: -2 }] }, ctx("st")), /ต้องมากกว่า 0/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: "" }] }, ctx("st")), /ต้องมากกว่า 0/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: "abc" }] }, ctx("st")), /ต้องเป็นตัวเลข/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 0.00001 }] }, ctx("st")), /ต้องมากกว่า 0/, "below four decimals is nothing");
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }, { itemCode: "p-stk-01", qty: 1 }] }, ctx("st")), /ซ้ำ/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "NOPE", qty: 1 }] }, ctx("st")), /ไม่มีของซื้อที่ต้องเบิกในใบนี้/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 10 }, { itemCode: "P-BOX-01", qty: 6 }] }, ctx("st")), /ไม่ได้เบิกจ่ายอะไรเลย: P-BOX-01 ขาด 1/);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 401 }] }, ctx("st")), /P-STK-01 ขาด 1/, "over-issue only up to the stock");
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }] }, ctx("wh")), /ST/);
  assert.deepEqual(d, before, "refused issues change nothing");
  // เลือกเฉพาะกล่อง เบิก 3 จาก 7 (สต็อกมี 5): บรรทัดยังเปิด บรรทัดอื่นไม่ถูกแตะ หักสต็อกเท่าที่เบิก
  const reservedBefore = rules.partReserved(d.jobs, d.orders).get("P-BOX-01");
  assert.deepEqual(A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "p-box-01", qty: "3" }] }, ctx("st")), { issued: 1, summary: "1 รายการ" });
  assert.deepEqual([jobOf("P-BOX-01").status, jobOf("P-BOX-01").qtyDone, "doneAt" in jobOf("P-BOX-01")], ["in_progress", 3, false]);
  assert.ok(d.jobs.filter((job) => job.orderId === order.id && A.helpers.isPartJob(job) && job.itemCode !== "P-BOX-01").every((job) => job.status === "queued" && job.qtyDone === 0), "the lines that were not ticked are untouched");
  assert.equal(stock("P-BOX-01").qty, 2);
  assert.deepEqual(d.stockMoves.filter((move) => move.kind === "issue").map((move) => [move.itemCode, move.qty, move.balance, move.ref]), [["P-BOX-01", -3, 2, "DEMO-26001"]]);
  assert.match(d.audit[0].detail, /DEMO-26001 1 รายการ/);
  assert.deepEqual([lineOf("P-BOX-01").issued, lineOf("P-BOX-01").remaining, lineOf("P-BOX-01").short], [3, 4, 2], "the next issue offers the remainder");
  assert.equal(rules.partReserved(d.jobs, d.orders).get("P-BOX-01"), reservedBefore - 3, "the open line still reserves only what is left");
  assert.equal(rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock }, order.id).rows.find((row) => row.itemCode === "P-BOX-01").needQty, 4);
  // ส่วนที่เหลือ + เกินแผน 2 (สต็อกพอ) → done · ยอดสะสม 9 จากแผน 7
  A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", qty: 10 }] }, ctx("st"));
  A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-BOX-01", qty: 6 }] }, ctx("planner"));
  assert.deepEqual([jobOf("P-BOX-01").status, jobOf("P-BOX-01").qtyDone, jobOf("P-BOX-01").doneAt], ["done", 9, NOW]);
  assert.equal(stock("P-BOX-01").qty, 4);
  assert.equal(lineOf("P-BOX-01"), undefined, "a finished line is no longer offered");
  assert.equal(rules.partReserved(d.jobs, d.orders).get("P-BOX-01") ?? 0, reservedBefore - 7, "and reserves nothing (never negative after an over-issue)");
  // ไม่ส่ง lines = ทุกบรรทัดที่ยังเปิดเต็มส่วนที่เหลือ (แบบเดิม)
  assert.deepEqual(A.issueOrderParts(d, { orderId: order.id }, ctx("st")), { issued: 6, summary: "6 รายการ" });
  assert.ok(d.jobs.filter((job) => job.orderId === order.id && A.helpers.isPartJob(job)).every((job) => job.status === "done"));
  assert.deepEqual([jobOf("P-BOX-01").qtyDone, jobOf("P-STK-01").qtyDone, stock("P-STK-01").qty], [9, 120, 280]);
  rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }] }, ctx("st")), /ไม่มีของซื้อที่ต้องเบิกจ่าย/);
  // โหมดฐานข้อมูล: ใบ released ไม่เปลี่ยนเอง ประวัติไม่เขียนในเครื่อง แต่งานและสต็อกคำนวณไว้แสดง
  const r = fresh();
  const released = r.orders.find((entry) => entry.id === "DEMO-26001");
  released.status = "released";
  const moves = r.stockMoves.length;
  A.issueOrderParts(r, { orderId: released.id, lines: [{ itemCode: "P-STK-01", qty: 50 }] }, { ...ctx("st"), remote: true });
  const remoteJob = r.jobs.find((job) => job.orderId === released.id && job.itemCode === "P-STK-01" && A.helpers.isPartJob(job));
  assert.deepEqual([released.status, r.stockMoves.length, remoteJob.status, remoteJob.qtyDone, r.stock.find((row) => row.itemCode === "P-STK-01").qty], ["released", moves, "in_progress", 50, 350]);
});

test("a partly issued line: undo gives it back and the jobs wait again (then the order can be cancelled), a leftover return needs the line finished, an over-issued line returns up to what was issued", () => {
  const d = fresh();
  const order = d.orders.find((entry) => entry.id === "DEMO-26001");
  const stock = (code) => d.stock.find((row) => row.itemCode === code);
  const jobOf = (code) => d.jobs.find((job) => job.orderId === order.id && A.helpers.isPartJob(job) && job.itemCode === code);
  A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 50 }, { itemCode: "P-ZIP-05", qty: 30 }] }, ctx("st"));
  assert.deepEqual([jobOf("P-STK-01").status, jobOf("P-ZIP-05").status, jobOf("P-ZIP-05").qtyDone], ["in_progress", "done", 30], "50 of 120 stickers, 30 of 21.2 m of zip (over the plan)");
  const lines = rules.partReturnLines(d, order.id);
  assert.deepEqual(lines.map((line) => [line.itemCode, line.issued, line.returnable, line.partial]), [["P-STK-01", 50, 50, true], ["P-ZIP-05", 30, 30, false]]);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เหลือ" }, ctx("st")), /P-STK-01 ยังเบิกไม่ครบ/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-ZIP-05", qty: 30.5 }], reason: "เหลือ" }, ctx("st")), /คืนได้อีกไม่เกิน 30/);
  A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-ZIP-05", qty: 8.8 }], reason: "เบิกเกิน" }, ctx("st"));
  assert.equal(stock("P-ZIP-05").qty, 78.8);
  // ใบที่เหลือแต่งานของซื้อ: ยกเลิกได้ทั้งที่เบิกไปแล้ว (20261128010000: ยอดเบิกไม่กัน คืนของเหลือได้หลังยกเลิก) · เหตุผลต้องยาวพอ
  d.jobs = d.jobs.filter((job) => job.orderId !== order.id || A.helpers.isPartJob(job));
  rejects(() => A.cancelOrder(structuredClone(d), { orderId: order.id, reason: "x" }, ctx("planner")), /อย่างน้อย 3/);
  const early = structuredClone(d);
  assert.equal(A.cancelOrder(early, { orderId: order.id, reason: "ลูกค้ายกเลิก" }, ctx("planner")), order.id, "a partly issued order can be cancelled");
  assert.deepEqual(rules.partReturnLines(early, order.id).map((line) => [line.itemCode, line.returnable, line.partial]), [["P-STK-01", 50, false], ["P-ZIP-05", 21.2, false]],
    "after the cancel every issued line takes a leftover return (nothing is partial on a cancelled order)");
  const undone = A.undoOrderParts(d, { orderId: order.id, reason: "ผิดใบ" }, ctx("st"));
  assert.equal(undone.summary, "2 รายการ");
  assert.deepEqual([stock("P-STK-01").qty, stock("P-ZIP-05").qty], [400, 100], "the partial 50 and the zip still out (30 - 8.8) are back");
  assert.ok(d.jobs.filter((job) => job.orderId === order.id && A.helpers.isPartJob(job)).every((job) => job.status === "queued" && job.qtyDone === 0 && !("doneAt" in job)));
  assert.equal(A.helpers.startedJobs(d, order, []).length, 0);
  assert.equal(A.cancelOrder(d, { orderId: order.id, reason: "ลูกค้ายกเลิก" }, ctx("planner")), order.id);
});

test("a PI that closes while a part line is partly issued: the line takes a leftover return up to issued minus returned (local and database mode), the undo and the rest of the issue stay refused", () => {
  for (const remote of [false, true]) {
    const d = fresh();
    const order = d.orders.find((entry) => entry.id === "DEMO-26001");
    const stock = (code) => d.stock.find((row) => row.itemCode === code);
    const jobOf = (code) => d.jobs.find((job) => job.orderId === order.id && A.helpers.isPartJob(job) && job.itemCode === code);
    const c = (role) => ({ ...ctx(role), remote });
    A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 50 }] }, ctx("st"));
    assert.equal(stock("P-STK-01").qty, 350);
    // ใบยังเปิด: บรรทัดที่เบิกไม่ครบคืนของเหลือไม่ได้ (เหมือนเดิม)
    rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เหลือ" }, c("st")), /P-STK-01 ยังเบิกไม่ครบ/);
    order.status = "completed";
    assert.deepEqual(rules.partReturnLines(d, order.id).map((line) => [line.itemCode, line.issued, line.returnable, line.partial]), [["P-STK-01", 50, 50, false]], `closed → not partial (${remote ? "database" : "local"})`);
    rejects(() => A.issueOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 10 }] }, c("st")), /เฉพาะใบที่ปล่อยผลิตแล้ว/);
    rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "ผิดใบ" }, c("st")), /ยังไม่ปิด/);
    rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 50.5 }], reason: "เหลือ" }, c("st")), /คืนได้อีกไม่เกิน 50/);
    const sent = A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 30 }], reason: "ปิดใบแล้วเหลือ" }, c("st"));
    assert.deepEqual(sent.request, { orderId: order.id, mode: "leftover", reason: "ปิดใบแล้วเหลือ", lines: [{ itemCode: "P-STK-01", qty: 30 }] }, "the database mode sends the leftover request");
    assert.equal(stock("P-STK-01").qty, 380);
    assert.deepEqual([jobOf("P-STK-01").status, jobOf("P-STK-01").qtyDone], ["in_progress", 50], "the job is not changed by the return");
    if (!remote) {
      // ประวัติในเครื่องนับยอดที่คืนไปแล้ว (โหมดฐานข้อมูล เซิร์ฟเวอร์นับเอง)
      rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 20.5 }], reason: "เหลือ" }, c("st")), /คืนได้อีกไม่เกิน 20/);
      A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 20 }], reason: "คืนที่เหลือ" }, c("st"));
      assert.equal(stock("P-STK-01").qty, 400);
      assert.equal(rules.partReturnLines(d, order.id)[0].returnable, 0);
    }
  }
});

test("returning purchased parts: undo gives the whole issue back and the jobs wait again, leftovers are limited to what is not yet returned since the latest issue, rights and reason are checked", () => {
  const d = fresh();
  const order = d.orders.find((entry) => entry.id === "DEMO-26001");
  const stock = (code) => d.stock.find((row) => row.itemCode === code);
  const parts = () => d.jobs.filter((job) => job.orderId === order.id && A.helpers.isPartJob(job));
  const returns = (code) => d.stockMoves.filter((move) => move.kind === "return" && move.itemCode === code);
  A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }, ctx("st"));
  const counted = Object.fromEntries(d.stock.map((row) => [row.itemCode, row.qty]));
  // ยังไม่ได้เบิกจ่าย: ไม่มีอะไรให้คืน
  rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "ผิดใบ" }, ctx("st")), /ยังไม่ได้เบิกจ่าย/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เหลือ" }, ctx("st")), /ไม่ได้เบิกจ่ายให้ใบนี้/);
  A.issueOrderParts(d, { orderId: order.id }, ctx("st"));
  assert.equal(stock("P-STK-01").qty, 280);
  const lineOf = (code) => rules.partReturnLines(d, order.id).find((line) => line.itemCode === code);
  assert.deepEqual([lineOf("P-STK-01").issued, lineOf("P-STK-01").returned, lineOf("P-STK-01").returnable], [120, 0, 120]);
  // สิทธิ์ · เหตุผล
  for (const who of [ctx("rb"), ctx("gr"), { now: NOW, user: { role: "wh", name: "คลังสินค้า" } }]) {
    rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "ผิดใบ" }, who), /ST/);
    rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เหลือ" }, who), /ST/);
  }
  for (const reason of [undefined, "", "   ", "ก".repeat(201)]) {
    rejects(() => A.undoOrderParts(d, { orderId: order.id, reason }, ctx("st")), /เหตุผล/);
    rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason }, ctx("st")), /เหตุผล/);
  }
  assert.equal(stock("P-STK-01").qty, 280, "refused calls change nothing");
  // คืนของเหลือ: ตรวจรูปและเพดาน (เบิกจ่าย 120)
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [], reason: "เหลือ" }, ctx("st")), /ยังไม่ได้กรอก/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 0 }], reason: "เหลือ" }, ctx("st")), /ต้องมากกว่า/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: -1 }], reason: "เหลือ" }, ctx("st")), /ต้องมากกว่า/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }, { itemCode: "p-stk-01", qty: 2 }], reason: "เหลือ" }, ctx("st")), /ซ้ำ/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "NOPE", qty: 1 }], reason: "เหลือ" }, ctx("st")), /ไม่ได้เบิกจ่ายให้ใบนี้/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 121 }], reason: "เหลือ" }, ctx("st")), /คืนได้อีกไม่เกิน 120/);
  const before = structuredClone(d);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-BOX-01", qty: 1 }, { itemCode: "P-STK-01", qty: 121 }], reason: "เหลือ" }, ctx("st")), /P-STK-01/);
  assert.deepEqual(d, before, "a bad line refuses the whole return — the good line is not applied either");
  const first = A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: "20" }, { itemCode: "P-BOX-01", qty: 1 }], reason: " ใช้ไม่หมด " }, ctx("st"));
  assert.deepEqual([first.returned, first.summary], [2, "2 รายการ"]);
  assert.deepEqual(first.request, { orderId: "DEMO-26001", mode: "leftover", reason: "ใช้ไม่หมด", lines: [{ itemCode: "P-BOX-01", qty: 1 }, { itemCode: "P-STK-01", qty: 20 }] });
  assert.deepEqual([stock("P-STK-01").qty, stock("P-BOX-01").qty], [300, 1]);
  assert.deepEqual(d.stockMoves.at(-1), { id: d.stockMoves.at(-1).id, itemCode: "P-STK-01", kind: "return", qty: 20, balance: 300, ref: "DEMO-26001", at: NOW, by: user("st").name, note: "ใช้ไม่หมด" });
  assert.ok(parts().every((job) => job.status === "done" && job.qtyDone === job.qtyPlanned), "a leftover return keeps the jobs done");
  assert.match(d.audit[0].detail, /DEMO-26001 2 รายการ · ใช้ไม่หมด/);
  assert.deepEqual([lineOf("P-STK-01").returned, lineOf("P-STK-01").returnable], [20, 100], "the page rule and the action agree on what is left");
  // เพดานนับจากที่คืนไปแล้ว
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 101 }], reason: "เหลือ" }, ctx("st")), /คืนได้อีกไม่เกิน 100 \(เบิกจ่าย 120 คืนไปแล้ว 20\)/);
  A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 100 }], reason: "ส่วนที่เหลือ" }, ctx("planner"));
  assert.equal(stock("P-STK-01").qty, 400);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 0.5 }], reason: "เหลือ" }, ctx("st")), /ไม่เกิน 0/);
  // ยกเลิกการเบิกจ่าย: ส่วนที่คืนเป็นของเหลือไปแล้วไม่คืนซ้ำ ที่เหลือคืนครบ งานกลับไปรอเบิกจ่าย
  const issuedQty = Object.fromEntries(parts().map((job) => [job.itemCode, job.qtyPlanned]));
  const undone = A.undoOrderParts(d, { orderId: order.id, reason: "เบิกผิดใบ" }, ctx("st"));
  assert.deepEqual(undone.request, { orderId: "DEMO-26001", mode: "undo", reason: "เบิกผิดใบ" });
  assert.equal(undone.summary, "7 รายการ");
  assert.deepEqual(Object.fromEntries(d.stock.map((row) => [row.itemCode, row.qty])), { ...counted }, "every balance is back to what it was before the issue");
  assert.equal(returns("P-STK-01").length, 2, "the item that was fully returned as leftovers gets no third move");
  assert.equal(returns("P-ZIP-05").at(-1).qty, issuedQty["P-ZIP-05"]);
  assert.equal(returns("P-ZIP-05").at(-1).note, "เบิกผิดใบ");
  assert.ok(parts().every((job) => job.status === "queued" && job.qtyDone === 0 && !("doneAt" in job)), "the part jobs wait for an issue again");
  assert.equal(order.status, "in_progress", "the order status does not change");
  rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "อีกครั้ง" }, ctx("st")), /ยังไม่ได้เบิกจ่าย/);
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เหลือ" }, ctx("st")), /ไม่ได้เบิกจ่ายให้ใบนี้/);
  // เบิกจ่ายใหม่: ของเหลือรอบก่อนไม่นับ คืนได้เต็มอีกครั้ง
  A.issueOrderParts(d, { orderId: order.id }, ctx("st"));
  assert.equal(stock("P-STK-01").qty, 280);
  A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 120 }], reason: "รอบสอง" }, ctx("st"));
  assert.equal(stock("P-STK-01").qty, 400, "the leftovers of the first issue do not count against the second");
  rejects(() => A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 1 }], reason: "เกิน" }, ctx("st")), /ไม่เกิน 0/);
  // ใบที่มีแต่งานของซื้อ: ยกเลิกใบได้แม้เบิกจ่ายแล้ว (20261128010000) · ยกเลิกการเบิกจ่ายก่อนก็ยังได้ และเปิดใบกลับมาแก้ได้ (ไม่มีงานเริ่ม)
  d.jobs = d.jobs.filter((job) => job.orderId !== order.id || A.helpers.isPartJob(job));
  assert.equal(A.cancelOrder(structuredClone(d), { orderId: order.id, reason: "ลูกค้ายกเลิก" }, ctx("planner")), order.id, "an issued PI can be cancelled with a reason");
  assert.ok(A.helpers.startedJobs(d, order, []).length > 0, "an issued PI counts as started");
  A.undoOrderParts(d, { orderId: order.id, reason: "ยกเลิกใบ" }, ctx("st"));
  assert.equal(A.helpers.startedJobs(d, order, []).length, 0, "after the undo no job counts as started");
  assert.equal(A.cancelOrder(d, { orderId: order.id, reason: "ลูกค้ายกเลิก" }, ctx("planner")), order.id);
  assert.equal(order.status, "cancelled");
});

test("returning purchased parts: order status rules and the planner group", () => {
  const d = fresh();
  const order = d.orders.find((entry) => entry.id === "DEMO-26001");
  A.countPartStock(d, { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }, ctx("st"));
  A.issueOrderParts(d, { orderId: order.id }, ctx("planner"));
  // ใบที่ปิดแล้ว: คืนของเหลือได้ แต่ยกเลิกการเบิกจ่ายไม่ได้
  order.status = "completed";
  rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "x" }, ctx("st")), /ยังไม่ปิด/);
  A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 5 }], reason: "เหลือหลังปิดใบ" }, ctx("manager"));
  assert.equal(d.stock.find((row) => row.itemCode === "P-STK-01").qty, 285);
  // ใบที่ยกเลิก (20261128010000): คืนของเหลือได้เหมือนใบที่ปิดแล้ว · ยกเลิกการเบิกจ่ายไม่ได้
  order.status = "cancelled";
  A.returnOrderParts(d, { orderId: order.id, lines: [{ itemCode: "P-STK-01", qty: 5 }], reason: "ยกเลิกใบ" }, ctx("st"));
  assert.equal(d.stock.find((row) => row.itemCode === "P-STK-01").qty, 290, "a cancelled order takes a leftover return");
  rejects(() => A.undoOrderParts(d, { orderId: order.id, reason: "x" }, ctx("st")), /ยังไม่ปิด/);
  rejects(() => A.undoOrderParts(d, { orderId: "NOPE", reason: "x" }, ctx("st")), /ไม่พบใบสั่งผลิต/);
  // โหมดฐานข้อมูล: ประวัติเป็นของเซิร์ฟเวอร์ (ไม่เขียนในเครื่อง) แต่สต็อกและงานคำนวณไว้แสดงทันที
  const r = fresh();
  A.countPartStock(r, { counts: [{ itemCode: "P-BOX-01", qty: 7 }] }, ctx("planner"));
  A.issueOrderParts(r, { orderId: "DEMO-26001" }, { ...ctx("planner"), remote: true });
  const moves = r.stockMoves.length;
  const done = A.undoOrderParts(r, { orderId: "DEMO-26001", reason: "ผิดใบ" }, { ...ctx("planner"), remote: true });
  assert.equal(r.stockMoves.length, moves, "remote mode writes no move locally");
  assert.equal(r.stock.find((row) => row.itemCode === "P-STK-01").qty, 400);
  assert.equal(done.request.mode, "undo");
});

test("importing a sheet twice keeps one XP- item per subpart, and the group chosen at import time wins for new items only", () => {
  const d = fresh();
  const header = ["ITEM", "น.น RB/g", "CODE", "รหัสแผนก", "สินค้า/สูตรยาง", "สีSE/ประเภทยาง", "ความยาวSE/สีRB", "รู,ความหนา/ความยาวRB", "วงนอกSE/รูในRB", "วงนอกRB", "NAME", "แผนกผู้ผลิต", "จำนวนที่ใช้ต่อชุด", "ความยาวตัด", "หน่วย", "จำนวนชิ้นที่ได้ต่อเส้น RB", "หน่วย", "จำนวนที่ได้ต่อ 1 GR", "หน่วย", "หน่วยนับ RB", "น.น ต่อเส้น RB / ก.ก"].join("\t");
  const tsv = [header,
    ["GRP-01(P)-Y", "1", "GRP-01", "PK", "-", "-", "-", "-", "-", "-", "สินค้ากลุ่ม", "PK", "-", "-", "-", "-", "-", "-", "-", "ชุด / SET", "-"].join("\t"),
    ["GRP-01(P)-Y", "2", "-", "PK", "-", "-", "-", "-", "-", "-", "แกนทดสอบ", "PK-PK", "1", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"].join("\t"),
    ["GRP-01(P)-Y", "3", "P-STK-01", "ST", "-", "-", "-", "-", "-", "-", "สติ๊กเกอร์ CE", "PK-ST", "2", "-", "-", "-", "-", "-", "-", "ชิ้น/pcs", "-"].join("\t"),
  ].join("\n");
  const payloadFor = (data, group) => {
    const built = rules.buildFromFlat(rules.readFlatRows(tsv), { group: "TOY", existingSubparts: rules.subpartIndex(data.items), ...rules.subpartOptions(data.items) });
    return { items: [...built.items.values()], boms: [...built.boms.entries()].map(([parentCode, lines]) => ({ parentCode, lines })), source: "grp.tsv", group };
  };
  const subparts = () => d.items.filter((item) => item.kind === "SUBPART" && item.name === "แกนทดสอบ");
  A.helpers.itemOf(d, "P-STK-01").group = "KEEP";
  const first = A.importFlat(d, payloadFor(d, "IND"), ctx("planner"));
  assert.equal(first.itemsAdded, 2, "the product and the new subpart");
  assert.equal(subparts().length, 1);
  assert.equal(A.helpers.itemOf(d, "GRP-01(P)-Y").group, "IND", "the group chosen at import wins over the TOY stamped by the check");
  assert.equal(subparts()[0].group, "IND");
  assert.equal(A.helpers.itemOf(d, "P-STK-01").group, "KEEP", "an existing item keeps its group");
  const second = A.importFlat(d, payloadFor(d, "TOY"), ctx("planner"));
  assert.equal(second.itemsAdded, 0);
  assert.equal(subparts().length, 1, "the second import reuses the XP- item");
  assert.equal(subparts()[0].group, "IND", "items saved earlier are not changed by a later import");
  const noGroup = fresh();
  const flatPayload = payloadFor(noGroup, undefined);
  A.importFlat(noGroup, { ...flatPayload, items: flatPayload.items.map((item) => ({ ...item, group: "IND" })) }, ctx("planner"));
  assert.equal(A.helpers.itemOf(noGroup, "GRP-01(P)-Y").group, "IND", "without a chosen group the group on the item is used, as before");
});

test("a missing item code is named neutrally: no message prints undefined, null or a dangling label", () => {
  const d = fresh();
  const planner = ctx("planner");
  const message = (fn) => { try { fn(); } catch (error) { return error.message; } return ""; };
  const parent = "DEMO-TP-01(P)-Y";
  for (const childCode of [undefined, null, ""]) {
    const text = message(() => A.saveBom(d, { itemCode: parent, lines: [{ childCode, qty: 1 }] }, planner));
    assert.match(text, /ไม่พบชิ้นงานที่ระบุ$/, text);
    assert.doesNotMatch(text, /undefined|null|NaN/, text);
  }
  assert.match(message(() => A.saveBom(d, { itemCode: parent, lines: [{ childCode: "NOPE", qty: 1 }] }, planner)), /ไม่พบชิ้นงาน NOPE$/, "a code that was typed is still named");
});

test("purchased parts of a draft PI can be checked before release: needs come from the explosion and match the part jobs created at release", () => {
  const d = seed.buildSeed(Date.UTC(2026, 10, 13));
  const draft = d.orders.find((order) => order.status === "draft");
  assert.ok(draft.explosion?.length, "the demo draft is exploded");
  const before = rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock, purchaseOrders: [] }, draft.id);
  assert.ok(before.rows.length > 0 && before.anyShort, "the draft lists its purchased parts and what is short");
  const box = before.rows.find((row) => row.itemCode === "P-BOX-01");
  // คงเหลือ 5 ใบอื่นจอง 7 → ไม่มีของว่างให้ใบนี้ และยังติดลบ 2: ขาด = ต้องใช้ + 2
  assert.equal(box.shortage, box.needQty + (box.reservedQty - box.onHandQty));
  const ordered = rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock, purchaseOrders: [{ status: "ordered", lines: [{ source: "bom", materialCode: "P-BOX-01", qtyKg: box.shortage, receivedKg: null }] }] }, draft.id);
  assert.equal(ordered.rows.find((row) => row.itemCode === "P-BOX-01").shortage, 0, "an open purchase order covers the shortage");
  assert.equal(rules.partNeeds({ jobs: d.jobs, orders: d.orders.map((order) => (order.id === draft.id ? { ...order, explosion: [] } : order)), stock: d.stock, purchaseOrders: [] }, draft.id).rows.length, 0, "a draft that is not exploded has nothing to check");
  A.releaseOrder(d, { orderId: draft.id }, { user: d.users.find((user) => user.role === "planner"), now: Date.UTC(2026, 10, 13) });
  const after = rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock, purchaseOrders: [] }, draft.id);
  assert.deepEqual(after.rows.map((row) => [row.itemCode, row.needQty, row.shortage]), before.rows.map((row) => [row.itemCode, row.needQty, row.shortage]), "the same numbers before and after release");
});

// ---------- คลังสินค้า (WH) รับสินค้าสำเร็จรูป · ใบปิดเอง · ส่งมอบลูกค้า ----------
const whStaff = { id: "wh", role: "wh", dept: "WH", name: "สุดา คลังสินค้า" };
const whHead = { id: "whh", role: "manager", dept: "WH", name: "ชัย หัวหน้าคลัง" };
const whCtx = (who = whStaff, now = NOW) => ({ now, user: who });
const TP = "DEMO-TP-01(P)-Y";
const HL = "DEMO-HL-24(B)-A";
// ใบ DEMO-26001 (TP 80 · HL 40) ที่ PK รายงานตามจำนวนที่ให้ (ทุกงาน PK ของใบ รวมชิ้นย่อย XP- ที่ต้องเสร็จด้วย)
// งานของแผนกผลิตอื่น (RB GR PT BG) ถือว่าเสร็จแล้ว (ใบปิดได้เมื่อทุกงานผลิตเสร็จ: 20261125010000) · การเบิกของซื้อไม่นับ จึงไม่แตะ
const finishOtherDepts = (d, orderId) => d.jobs.filter((job) => job.orderId === orderId && job.dept !== "PK" && !A.helpers.isPartJob(job)).forEach((job) => { job.status = "done"; });
const reportPk = (d, made) => {
  const orderId = "DEMO-26001";
  finishOtherDepts(d, orderId);
  for (const job of d.jobs.filter((entry) => entry.orderId === orderId && entry.dept === "PK")) {
    const qty = job.kind === "FG" ? made[job.itemCode] ?? 0 : job.qtyPlanned;
    if (qty > 0) A.reportJob(d, { jobId: job.id, qtyDone: qty }, ctx("planner"));
  }
  return orderId;
};
const forceDone = (d, orderId) => d.jobs.filter((job) => job.orderId === orderId && job.dept === "PK").forEach((job) => { job.status = "done"; });

test("finished goods: only the WH department (staff or its manager) and admin handle them, the planning group and other departments do not", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 30 });
  assert.deepEqual([whStaff, whHead, user("admin")].map(A.helpers.canHandleFg), [true, true, true]);
  assert.deepEqual([user("planner"), user("manager"), user("st"), user("gr"), { role: "viewer", dept: "PK", name: "PK" }, null, undefined].map(A.helpers.canHandleFg), [false, false, false, false, false, false, false], "the planning group, a manager of another department, ST, PK and nobody");
  const lines = [{ fgCode: TP, qty: 10 }];
  for (const who of [user("planner"), user("manager"), user("st"), user("gr")]) {
    rejects(() => receiveFg(d, { orderId, lines }, whCtx(who)), /คลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
    rejects(() => A.deliverFg(d, { orderId, lines }, whCtx(who)), /คลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
    rejects(() => A.closeOrderShort(d, { orderId, note: "เหตุผล" }, whCtx(who)), /คลังสินค้า \(WH\) หรือผู้ดูแลระบบ/);
  }
  // ประวัติของใบนี้เท่านั้น (ชุดสาธิตมีประวัติของใบ DEMO-26008 อยู่แล้ว)
  const own = () => (d.fgMoves ?? []).filter((move) => move.orderId === orderId);
  assert.equal(own().length, 0, "nothing was written");
  rejects(() => receiveFg(d, { orderId, lines }, { now: NOW }), /เลือกบทบาท/, "no user at all");
  for (const who of [whStaff, whHead, user("admin")]) receiveFg(d, { orderId, lines }, whCtx(who));
  assert.equal(own().length, 3);
  assert.deepEqual(own().map((move) => move.by), ["สุดา คลังสินค้า", "ชัย หัวหน้าคลัง", user("admin").name]);
});

test("finished goods: receiving is partial per product, capped by what PK reported, checked shape first then permission then status then the numbers", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 30 });
  const order = d.orders.find((entry) => entry.id === orderId);
  const position = () => rules.fgPosition(d, order);
  // 20261224010000: ที่ PK ทำแต่ยังไม่ส่งให้ WH รับไม่ได้
  assert.deepEqual(position().products.map((p) => [p.fgCode, p.pkDone, p.receivable]), [[TP, 30, 0], [HL, 0, 0]], "nothing sent to WH yet, nothing to receive");
  rejects(() => A.receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /รับได้อีกไม่เกิน 0 \(PK ส่งให้ WH แล้ว 0/);
  shipToWh(d, orderId);
  assert.deepEqual(position().products.map((p) => [p.fgCode, p.ordered, p.pkDone, p.received, p.receivable]), [[TP, 80, 30, 0, 30], [HL, 40, 0, 0, 0]]);
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 20 }], note: "รอบเช้า" }, whCtx());
  assert.equal(order.status, "in_progress", "received while production is still running");
  const own = () => d.fgMoves.filter((move) => move.orderId === orderId);
  assert.deepEqual(own().map((move) => [move.orderId, move.fgCode, move.kind, move.qty, move.note, move.at, move.by]), [[orderId, TP, "receive", 20, "รอบเช้า", NOW, "สุดา คลังสินค้า"]]);
  assert.equal(position().products[0].receivable, 10);
  assert.equal(position().anyReceivable, true);
  // ยอดเกิน PK / สินค้าที่ PK ยังไม่ส่ง
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 11 }] }, whCtx()), /รับได้อีกไม่เกิน 10/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: HL, qty: 1 }] }, whCtx()), /รับได้อีกไม่เกิน 0/);
  // รูปคำขอ: ว่าง ซ้ำ จำนวนผิด สินค้านอกใบ ใบที่ไม่มี หมายเหตุยาวเกิน
  rejects(() => receiveFg(d, { orderId, lines: [] }, whCtx()), /ยังไม่ได้กรอกจำนวนที่รับ/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: "" }] }, whCtx()), /ยังไม่ได้กรอกจำนวนที่รับ/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }, { fgCode: TP, qty: 2 }] }, whCtx()), /ซ้ำ/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 0 }] }, whCtx()), /มากกว่า 0/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: -3 }] }, whCtx()), /มากกว่า 0/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: "abc" }] }, whCtx()), /ตัวเลข/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: "NOPE-1", qty: 1 }] }, whCtx()), /ไม่ได้อยู่ในใบ/);
  rejects(() => receiveFg(d, { orderId: "PI-NOPE", lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /ไม่พบใบสั่งผลิต/);
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }], note: "x".repeat(301) }, whCtx()), /ยาวเกิน 300/);
  // จำนวนเล็กมากที่ปัดแล้วเป็น 0 ไม่ถูกส่งเป็นคำขอ (ฐานข้อมูลรับเฉพาะ qty > 0)
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 0.00001 }] }, whCtx()), /จำนวนที่รับต้องมากกว่า 0/);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 0.00004 }] }, whCtx()), /จำนวนที่ส่งมอบต้องมากกว่า 0/);
  // ลำดับ: รูปคำขอก่อนสิทธิ์ · สิทธิ์ก่อนสถานะ · สถานะก่อนยอด
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: "NOPE-1", qty: 1 }] }, whCtx(user("planner"))), /ไม่ได้อยู่ในใบ/, "shape before permission");
  const draft = d.orders.find((entry) => entry.status === "draft");
  rejects(() => receiveFg(d, { orderId: draft.id, lines: [{ fgCode: draft.items[0].fgCode, qty: 1 }] }, whCtx(user("planner"))), /คลังสินค้า \(WH\)/, "permission before status");
  rejects(() => receiveFg(d, { orderId: draft.id, lines: [{ fgCode: draft.items[0].fgCode, qty: 1 }] }, whCtx()), /ปล่อยผลิตแล้ว/, "status before the numbers");
  assert.equal(own().length, 1, "every refusal leaves the history untouched");
  // รับเพิ่มได้จนเท่าที่ PK รายงาน · เลข PI ตัวพิมพ์เล็กหรือมีช่องว่างหัวท้ายหาใบเดียวกันได้ (ฐานข้อมูลทำ upper + ตัดช่องว่าง) และประวัติเก็บเลขของใบ
  receiveFg(d, { orderId: ` ${orderId.toLowerCase()} `, lines: [{ fgCode: TP, qty: 10 }] }, whCtx());
  assert.equal(d.fgMoves.at(-1).orderId, orderId);
  assert.equal(position().products[0].receivable, 0);
  assert.equal(order.status, "in_progress", "TP is not fully received against what was ordered");
  // PK รายงานเพิ่ม → ส่งให้ WH แล้วจึงรับเพิ่มได้ (20261224010000)
  A.reportJob(d, { jobId: d.jobs.find((job) => job.orderId === orderId && job.itemCode === TP).id, qtyDone: 5 }, ctx("planner"));
  assert.equal(position().products[0].receivable, 0, "made but not sent to WH yet");
  shipToWh(d, orderId);
  assert.equal(position().products[0].receivable, 5);
});

test("finished goods: the order closes by itself when every product is received in full, and not before", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  const order = d.orders.find((entry) => entry.id === orderId);
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }] }, whCtx());
  assert.equal(order.status, "in_progress", "one product of two is not enough");
  receiveFg(d, { orderId, lines: [{ fgCode: HL, qty: 39 }] }, whCtx());
  assert.equal(order.status, "in_progress");
  receiveFg(d, { orderId, lines: [{ fgCode: HL, qty: 1 }] }, whCtx(user("admin")));
  assert.equal(order.status, "completed");
  assert.equal(order.completedAt, NOW);
  assert.ok(d.audit.some((entry) => entry.action === "รับสินค้าเข้าคลัง" && /ปิดอัตโนมัติ/.test(entry.detail)), "the audit says the order closed by itself");
  rejects(() => receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /รับได้อีกไม่เกิน 0/, "a closed order still receives, but only what PK made beyond what was received (nothing here)");
  // รับครบทุกสินค้าในครั้งเดียว
  const e = fresh();
  reportPk(e, { [TP]: 80, [HL]: 40 });
  receiveFg(e, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(e.orders.find((entry) => entry.id === orderId).status, "completed");
});

test("finished goods: closing short needs every PK job done, everything PK made received, something short and a reason of 3 to 300 characters", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 70, [HL]: 40 });
  const order = d.orders.find((entry) => entry.id === orderId);
  const reason = "PK ผลิตได้ไม่ครบ ลูกค้ารับเท่าที่มี";
  rejects(() => A.closeOrderShort(d, { orderId, note: reason }, whCtx()), /PK.*ยังไม่เสร็จ/, "TP's PK job is not done (70 of 80)");
  forceDone(d, orderId);
  assert.equal(rules.fgPosition(d, order).canCloseShort, false, "made but not received yet");
  rejects(() => A.closeOrderShort(d, { orderId, note: reason }, whCtx()), /ยังไม่ได้รับเข้าคลัง/);
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 70 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(order.status, "in_progress", "70 of 80 does not close the order");
  assert.equal(rules.fgPosition(d, order).canCloseShort, true);
  rejects(() => A.closeOrderShort(d, { orderId, note: reason }, whCtx(user("planner"))), /คลังสินค้า \(WH\)/);
  rejects(() => A.closeOrderShort(d, { orderId, note: "" }, whCtx()), /เหตุผล/);
  rejects(() => A.closeOrderShort(d, { orderId, note: "  ab " }, whCtx()), /อย่างน้อย 3/);
  rejects(() => A.closeOrderShort(d, { orderId, note: "x".repeat(301) }, whCtx()), /ยาวเกิน 300/);
  rejects(() => A.closeOrderShort(d, { orderId, note: reason, lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /ไม่ระบุรายการ/);
  assert.equal(order.status, "in_progress");
  A.closeOrderShort(d, { orderId, note: ` ${reason} ` }, whCtx(whHead, NOW + 1000));
  assert.equal(order.status, "completed");
  assert.equal(order.completedAt, NOW + 1000);
  const close = d.fgMoves.filter((move) => move.kind === "close");
  assert.deepEqual(close.map((move) => [move.fgCode, move.qty, move.note, move.by]), [["", 0, reason, "ชัย หัวหน้าคลัง"]], "one row: no product, no quantity, the reason");
  assert.deepEqual(rules.fgPosition(d, order).shortClose, { reason, at: NOW + 1000, by: "ชัย หัวหน้าคลัง" });
  rejects(() => A.closeOrderShort(d, { orderId, note: reason }, whCtx()), /ยังไม่ปิด/, "closing twice");
  // รับครบตามที่สั่งแล้วใบปิดเอง จึงปิดรับไม่ครบไม่ได้
  const e = fresh();
  reportPk(e, { [TP]: 80, [HL]: 40 });
  forceDone(e, orderId);
  receiveFg(e, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  rejects(() => A.closeOrderShort(e, { orderId, note: reason }, whCtx()), /ยังไม่ปิด/);
  // ใบร่างปิดรับไม่ครบไม่ได้
  rejects(() => A.closeOrderShort(e, { orderId: e.orders.find((entry) => entry.status === "draft").id, note: reason }, whCtx()), /ปล่อยผลิตแล้ว/);
});

test("finished goods: delivery is capped by what was received, possible before and after the order closes, and completes the derived delivered state", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  const order = d.orders.find((entry) => entry.id === orderId);
  const position = () => rules.fgPosition(d, order);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 0/, "nothing received yet");
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 50 }] }, whCtx());
  // ก่อนปิดใบ
  A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 20 }], note: "รถคันแรก" }, whCtx());
  assert.equal(order.status, "in_progress", "delivery does not close or reopen anything");
  assert.deepEqual(position().products[0].deliverable, 30);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 31 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 30/);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: HL, qty: 1 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 0/);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }, { fgCode: TP, qty: 1 }] }, whCtx()), /ซ้ำ/);
  rejects(() => A.deliverFg(d, { orderId, lines: [] }, whCtx()), /ยังไม่ได้กรอกจำนวนที่ส่งมอบ/);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 0 }] }, whCtx()), /มากกว่า 0/);
  assert.equal(position().fullyDelivered, false);
  // ปิดใบ (รับครบ) แล้วส่งมอบที่เหลือ
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 30 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(order.status, "completed");
  assert.deepEqual([position().waitingDelivery, position().fullyDelivered], [true, false], "closed but goods are still to be delivered");
  A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 60 }, { fgCode: HL, qty: 39 }] }, whCtx());
  assert.deepEqual([position().waitingDelivery, position().fullyDelivered], [true, false], "one HL is still in the warehouse");
  A.deliverFg(d, { orderId, lines: [{ fgCode: HL, qty: 1 }] }, whCtx());
  assert.deepEqual([position().waitingDelivery, position().fullyDelivered], [false, true]);
  rejects(() => A.deliverFg(d, { orderId, lines: [{ fgCode: HL, qty: 1 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 0/);
  // ใบร่าง / ใบยกเลิกส่งมอบไม่ได้
  const draft = d.orders.find((entry) => entry.status === "draft");
  rejects(() => A.deliverFg(d, { orderId: draft.id, lines: [{ fgCode: draft.items[0].fgCode, qty: 1 }] }, whCtx()), /ปล่อยผลิตแล้ว/);
  // ปิดรับไม่ครบ: ที่รับไว้ส่งมอบได้ครบก็ถือว่าส่งมอบแล้ว
  const e = fresh();
  reportPk(e, { [TP]: 70, [HL]: 40 });
  forceDone(e, orderId);
  receiveFg(e, { orderId, lines: [{ fgCode: TP, qty: 70 }, { fgCode: HL, qty: 40 }] }, whCtx());
  A.closeOrderShort(e, { orderId, note: "รับเท่าที่ทำได้" }, whCtx());
  const shortOrder = e.orders.find((entry) => entry.id === orderId);
  assert.equal(rules.fgPosition(e, shortOrder).waitingDelivery, true);
  A.deliverFg(e, { orderId, lines: [{ fgCode: TP, qty: 70 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(rules.fgPosition(e, shortOrder).fullyDelivered, true);
});

test("finished goods: on hand per code is everything received minus everything delivered over all orders, with the orders that hold it", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  // ชุดสาธิต: ใบ DEMO-26008 รับฮูล่า 20 ส่งมอบ 20 แล้ว (คงคลัง 0 ไม่มีใบใดถือของ)
  assert.deepEqual(rules.fgOnHand(d), [{ fgCode: HL, onHand: 0, free: 0, orders: [], freeOrders: [] }]);
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 50 }, { fgCode: HL, qty: 40 }] }, whCtx());
  A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 20 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.deepEqual(rules.fgOnHand(d), [{ fgCode: HL, onHand: 0, free: 0, orders: [], freeOrders: [] }, { fgCode: TP, onHand: 30, free: 0, orders: [{ orderId, qty: 30 }], freeOrders: [] }], "what the order still owes its own customer is not free stock");
  // a second order holds the same code (history rows only: the order does not have to exist to be summed)
  d.fgMoves.push({ id: "m-x", orderId: "PI-OTHER", fgCode: TP, kind: "receive", qty: 15, note: "", at: NOW, by: "x" }, { id: "m-y", orderId: "PI-OTHER", fgCode: TP, kind: "close", qty: 0, note: "เหตุผล", at: NOW, by: "x" });
  assert.deepEqual(rules.fgOnHand(d).find((row) => row.fgCode === TP), { fgCode: TP, onHand: 45, free: 0, orders: [{ orderId, qty: 30 }, { orderId: "PI-OTHER", qty: 15 }], freeOrders: [] }, "a close row never counts; an order that is not in the list has no free stock");
  // it is only shown: draft orders are not calculated from it
  const draft = d.orders.find((entry) => entry.status === "draft");
  const before = JSON.stringify(rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock, purchaseOrders: [] }, draft.id));
  d.fgMoves.push({ id: "m-z", orderId: "PI-OTHER", fgCode: draft.items[0].fgCode, kind: "receive", qty: 999, note: "", at: NOW, by: "x" });
  assert.equal(JSON.stringify(rules.partNeeds({ jobs: d.jobs, orders: d.orders, stock: d.stock, purchaseOrders: [] }, draft.id)), before);
});

test("finished goods: in database mode an action only checks and returns the request the store sends, writes no history and closes the order for display", () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  const remote = (who = whStaff) => ({ now: NOW, user: who, remote: true });
  const receive = receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 10 }], note: "  รอบเช้า " }, remote());
  assert.deepEqual(receive.request, { orderId, kind: "receive", lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 10 }], note: "รอบเช้า" });
  assert.equal(d.fgMoves.filter((move) => move.orderId === orderId).length, 0, "the server writes the history");
  assert.equal(d.orders.find((entry) => entry.id === orderId).status, "in_progress");
  assert.deepEqual(receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, remote(user("admin"))).request, { orderId, kind: "receive", lines: [{ fgCode: TP, qty: 1 }] }, "an empty note is not sent");
  const all = receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, remote());
  assert.equal(all.closed, true);
  assert.equal(d.orders.find((entry) => entry.id === orderId).status, "completed", "shown closed at once, the server confirms");
  d.fgMoves = [{ id: "s-0", orderId, fgCode: TP, kind: "receive", qty: 80, note: "", at: NOW, by: "x" }]; // what the server has written by now
  assert.deepEqual(A.deliverFg(d, { orderId, lines: [{ fgCode: TP, qty: 5 }] }, remote()).request, { orderId, kind: "deliver", lines: [{ fgCode: TP, qty: 5 }] });
  // the same checks run against the snapshot the page holds
  const e = fresh();
  reportPk(e, { [TP]: 30 });
  rejects(() => receiveFg(e, { orderId, lines: [{ fgCode: TP, qty: 31 }] }, remote()), /รับได้อีกไม่เกิน 30/);
  rejects(() => receiveFg(e, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, remote(user("planner"))), /คลังสินค้า \(WH\)/);
  forceDone(e, orderId);
  e.fgMoves = [{ id: "s-1", orderId, fgCode: TP, kind: "receive", qty: 30, note: "", at: NOW, by: "x" }];
  assert.deepEqual(A.closeOrderShort(e, { orderId, note: "เหตุผล" }, remote()).request, { orderId, kind: "close", note: "เหตุผล" });
  assert.equal(e.fgMoves.length, 1, "no history written locally");
});

test("recalculating a draft keeps its place in the reservation queue when the result is unchanged; an edit or a changed result puts it at the end, like the database", () => {
  const d = fresh();
  const draft = d.orders.find((order) => order.id === "DEMO-26002");
  const placed = draft.explodedAt;
  assert.ok(placed && draft.explosion.length, "the demo draft is calculated");
  assert.equal(A.explodeOrder(d, { orderId: draft.id }, ctx("planner", NOW + 5000)), draft.explosion.length);
  assert.equal(draft.explodedAt, placed, "same result: same place in the queue");
  // the database keeps jsonb (keys re-ordered): equal content is still unchanged
  draft.explosion = draft.explosion.map((line) => Object.fromEntries(Object.entries(line).reverse()));
  A.explodeOrder(d, { orderId: draft.id }, ctx("planner", NOW + 6000));
  assert.equal(draft.explodedAt, placed);
  // a result that differs (here: a bill of materials that changed since) goes to the end
  draft.explosion[0].required += 1;
  A.explodeOrder(d, { orderId: draft.id }, ctx("planner", NOW + 7000));
  assert.equal(draft.explodedAt, NOW + 7000);
  // an edit clears the calculation: the next calculation goes to the end, then stays
  const line = draft.items[0];
  A.updateOrderItem(d, { orderId: draft.id, fgCode: line.fgCode, qty: line.qty + 1 }, ctx("planner", NOW + 8000));
  assert.equal(draft.explosion, null);
  A.explodeOrder(d, { orderId: draft.id }, ctx("planner", NOW + 9000));
  assert.equal(draft.explodedAt, NOW + 9000, "after an edit the order goes to the end");
  A.explodeOrder(d, { orderId: draft.id }, ctx("planner", NOW + 10000));
  assert.equal(draft.explodedAt, NOW + 9000, "and recalculating again keeps that place");
});

test("finished goods: an order with no PK job at all cannot be closed short (the screen is stricter than the database here)", () => {
  const d = fresh();
  const orderId = "DEMO-26001";
  const order = d.orders.find((entry) => entry.id === orderId);
  assert.equal(rules.fgPosition(d, order).hasPkJobs, true);
  d.jobs = d.jobs.filter((job) => !(job.orderId === orderId && job.dept === "PK"));
  const position = rules.fgPosition(d, order);
  assert.equal(position.hasPkJobs, false);
  assert.equal(position.pkAllDone, true, "vacuously true with no PK job");
  assert.equal(position.canCloseShort, false, "so no close button");
  rejects(() => A.closeOrderShort(d, { orderId, note: "ไม่มีงาน PK" }, whCtx()), /ไม่มีงานบรรจุ \(PK\)/);
  assert.notEqual(order.status, "completed");
  assert.equal(rules.fgPosition({ jobs: [{ orderId: "X", dept: "PK", kind: "FG", itemCode: "A", status: "done", qtyDone: 0 }], fgMoves: [] }, { id: "X", status: "released", items: [{ fgCode: "A", qty: 5 }] }).canCloseShort, true, "with a finished PK job that made nothing, the close stays possible");
});

// ---------- ปิดใบเมื่อทุกงานผลิตเสร็จ (20261125010000): รับครบแต่งานแผนกอื่นเปิด = ใบเปิดต่อ · ฝ่ายวางแผนปิดงานพร้อมเหตุผล · WH ปิดใบ ----------
// ใบ DEMO-26001: PK ทำครบ งานแผนกอื่นเสร็จหมดยกเว้นงาน RB หนึ่งงาน (การเบิกของซื้อยังไม่เบิก ไม่นับ)
const withOpenRb = () => {
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  const rb = d.jobs.find((job) => job.orderId === orderId && job.dept === "RB");
  rb.status = "in_progress";
  return { d, orderId, order: d.orders.find((entry) => entry.id === orderId), rb };
};

test("close rules: receiving everything while a department is open keeps the order open, and no close is offered until every production job is done", () => {
  const { d, orderId, order, rb } = withOpenRb();
  const result = receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(result.closed, false);
  assert.equal(order.status, "in_progress");
  assert.match(d.audit[0].detail, /รับครบ ใบยังไม่ปิด รองานของแผนก รีดเส้นยาง \(RB\)/);
  const position = rules.fgPosition(d, order);
  assert.deepEqual([position.allReceived, position.productionDone, position.openDepts, position.waitingProduction, position.canClose, position.canCloseShort], [true, false, ["RB"], true, false, false]);
  assert.equal(A.helpers.isOpenJob(d, rb), true, "the RB job is still open");
  assert.ok(d.jobs.some((job) => job.orderId === orderId && A.helpers.isPartJob(job) && job.status !== "done"), "purchased-part lines are open too, and they do not count");
  rejects(() => A.closeOrder(d, { orderId }, whCtx()), /รีดเส้นยาง \(RB\) ยังไม่เสร็จ/);
  rejects(() => A.closeOrderShort(d, { orderId, note: "ปิดก่อนงานเสร็จ" }, whCtx()), /ยังไม่เสร็จ/);
  // ลำดับตรวจเหมือนฐานข้อมูล: รูปคำขอ → สิทธิ์ → สถานะ → งานผลิต → ยอด
  rejects(() => A.closeOrder(d, { orderId, note: "ปิดเอง" }, whCtx(user("planner"))), /ไม่ต้องระบุเหตุผล/, "shape before permission");
  rejects(() => A.closeOrder(d, { orderId, lines: [{ fgCode: TP, qty: 1 }] }, whCtx()), /ไม่ระบุรายการ/);
  rejects(() => A.closeOrder(d, { orderId }, whCtx(user("planner"))), /ปิดใบได้โดยคลังสินค้า \(WH\)/, "the planning group cannot close an order");
  rejects(() => A.closeOrder(d, { orderId: "DEMO-26002" }, whCtx()), /ปล่อยผลิตแล้ว/, "a draft cannot be closed");
  assert.equal(d.fgMoves.filter((move) => move.kind === "close").length, 0, "nothing was closed");
});

test("close rules: the planning group closes a job that will never be reported, with a reason and no output; then WH closes the order", () => {
  const { d, orderId, order, rb } = withOpenRb();
  receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  const done = rb.qtyDone;
  // ฝั่งปฏิเสธ: แผนกของงานเอง / คลังสินค้า / เหตุผลสั้นหรือยาวเกิน / งานของซื้อ
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ไม่ทำต่อแล้ว" }, ctx("rb")), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ไม่ทำต่อแล้ว" }, whCtx()), /ฝ่ายวางแผนหรือผู้จัดการ/);
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done" }, ctx("planner")), /เหตุผลที่ปิดงาน/);
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "  ab " }, ctx("planner")), /อย่างน้อย 3/);
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ก".repeat(201) }, ctx("planner")), /ยาวเกิน 200/);
  const part = d.jobs.find((job) => job.orderId === orderId && A.helpers.isPartJob(job));
  rejects(() => A.setJobStatus(d, { jobId: part.id, status: "done", reason: "ไม่ต้องเบิก" }, ctx("planner")), /งานของซื้อ/);
  assert.equal(rb.status, "in_progress", "the refusals changed nothing");
  // ปิดงาน: เสร็จโดยไม่เพิ่มยอด เหตุผลอยู่ที่รายงานของงานและบันทึกการใช้งาน
  A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "  ใช้เส้นยางค้างไลน์แทน  " }, ctx("planner", NOW + 1000));
  assert.equal(rb.status, "done");
  assert.equal(rb.doneAt, NOW + 1000);
  assert.equal(rb.qtyDone, done, "no output is added");
  assert.deepEqual(rb.reports.at(-1), { at: NOW + 1000, by: user("planner").name, good: 0, reject: 0, note: "ใช้เส้นยางค้างไลน์แทน" });
  assert.deepEqual(A.helpers.jobCloseNote(rb), { reason: "ใช้เส้นยางค้างไลน์แทน", by: user("planner").name, at: NOW + 1000 });
  assert.equal(A.helpers.jobCloseNote(d.jobs.find((job) => job.orderId === orderId && job.dept === "PK" && job.kind === "FG")), null, "a job finished by its reports is not a closed job");
  assert.deepEqual([d.audit[0].action, d.audit[0].detail], ["ปิดงาน (ไม่รายงานยอดเพิ่ม)", `${rb.id} ${rb.itemCode} — ใช้เส้นยางค้างไลน์แทน`]);
  rejects(() => A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ปิดซ้ำ" }, ctx("planner")), /เสร็จแล้ว/);
  // ทุกงานผลิตเสร็จ: คลังสินค้าปิดใบ (ไม่ต้องมีเหตุผล) · ปิดแบบรับไม่ครบไม่ได้เพราะของครบ
  const position = rules.fgPosition(d, order);
  assert.deepEqual([position.waitingProduction, position.canClose, position.openDepts], [false, true, []]);
  rejects(() => A.closeOrderShort(d, { orderId, note: "รับไม่ครบ" }, whCtx()), /ครบตามที่สั่งแล้ว/);
  const result = A.closeOrder(d, { orderId: ` ${orderId.toLowerCase()} ` }, whCtx(whHead, NOW + 2000));
  assert.deepEqual(result, { summary: orderId, request: { orderId, kind: "close" } });
  assert.equal(order.status, "completed");
  assert.equal(order.completedAt, NOW + 2000);
  const close = d.fgMoves.at(-1);
  assert.deepEqual([close.kind, close.fgCode, close.qty, close.note, close.by], ["close", "", 0, "รับครบ ปิดใบโดยคลังสินค้า", whHead.name]);
  const closed = rules.fgPosition(d, order);
  assert.deepEqual(closed.fullClose, { reason: "รับครบ ปิดใบโดยคลังสินค้า", at: NOW + 2000, by: whHead.name });
  assert.equal(closed.shortClose, null, "a full close is not a short close");
  assert.equal(d.audit[0].action, "ปิดใบสั่งผลิต (รับครบ)");
  rejects(() => A.closeOrder(d, { orderId }, whCtx()), /ยังไม่ปิด/, "closing twice");
  // งานของใบที่ปิดแล้วไม่ค้างและไม่เลยกำหนด (เหลือแค่บรรทัดของซื้อที่ยังไม่เบิก)
  assert.ok(d.jobs.filter((job) => job.orderId === orderId).every((job) => !A.helpers.isOpenJob(d, job)));
});

test("close rules: an admin closes too; an open purchased-part line never holds the order; closing short waits for every department", () => {
  // ของซื้อที่ยังไม่เบิกไม่กันการปิดเองตอนรับครบ
  const d = fresh();
  const orderId = reportPk(d, { [TP]: 80, [HL]: 40 });
  assert.ok(d.jobs.some((job) => job.orderId === orderId && A.helpers.isPartJob(job) && job.status !== "done"));
  assert.equal(receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx(user("admin"))).closed, true);
  // ปิดรับไม่ครบ: งาน PK เสร็จและรับครบเท่าที่ PK ทำ แต่ RB ยังเปิด = ไม่ได้ · ฝ่ายวางแผนปิดงาน RB แล้วได้
  const { d: e, orderId: id, order, rb } = withOpenRb();
  e.jobs.filter((job) => job.orderId === id && job.dept === "PK" && job.kind === "FG" && job.itemCode === TP).forEach((job) => { job.qtyDone = 70; });
  receiveFg(e, { orderId: id, lines: [{ fgCode: TP, qty: 70 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.equal(rules.fgPosition(e, order).canCloseShort, false);
  rejects(() => A.closeOrderShort(e, { orderId: id, note: "PK ทำได้ 70" }, whCtx()), /รีดเส้นยาง \(RB\) ยังไม่เสร็จ/);
  rejects(() => A.closeOrder(e, { orderId: id }, whCtx()), /ยังไม่เสร็จ/, "production is checked before the quantities");
  A.setJobStatus(e, { jobId: rb.id, status: "done", reason: "ไม่รีดเพิ่ม" }, ctx("manager"));
  rejects(() => A.closeOrder(e, { orderId: id }, whCtx()), /ยังรับสินค้าเข้าคลังไม่ครบ/);
  assert.equal(rules.fgPosition(e, order).canCloseShort, true);
  A.closeOrderShort(e, { orderId: id, note: "PK ทำได้ 70" }, whCtx(user("admin")));
  assert.equal(order.status, "completed");
  assert.deepEqual(rules.fgPosition(e, order).shortClose?.reason, "PK ทำได้ 70");
  assert.equal(rules.fgPosition(e, order).fullClose, null);
});

test("close rules in database mode: the actions only check and return the request; the planner's close travels as a job row with a zero report", () => {
  const { d, orderId, order, rb } = withOpenRb();
  const remote = (who = whStaff, now = NOW) => ({ now, user: who, remote: true });
  const received = receiveFg(d, { orderId, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, remote());
  assert.equal(received.closed, false, "the order is not shown closed while RB is open");
  assert.equal(order.status, "in_progress");
  d.fgMoves = [{ id: "s-1", orderId, fgCode: TP, kind: "receive", qty: 80, note: "", at: NOW, by: "x" }, { id: "s-2", orderId, fgCode: HL, kind: "receive", qty: 40, note: "", at: NOW, by: "x" }];
  A.setJobStatus(d, { jobId: rb.id, status: "done", reason: "ไม่รีดเพิ่ม" }, remote(user("planner")));
  assert.deepEqual(rb.reports.at(-1), { at: NOW, by: user("planner").name, good: 0, reject: 0, note: "ไม่รีดเพิ่ม" }, "the store diffs this job row and sends it");
  const result = A.closeOrder(d, { orderId }, remote());
  assert.deepEqual(result.request, { orderId, kind: "close" });
  assert.equal(order.status, "completed", "shown closed at once, the server confirms");
  assert.equal(d.fgMoves.length, 2, "no history written locally");
});

// ---------- สต็อกสินค้าสำเร็จรูป (batch C): ส่วนที่ PK ผลิตเกินเป็นสต็อก ใบร่างที่สั่งสินค้าเดียวกันใช้ลดงานผลิต ----------
const SRC = "DEMO-26001"; // TP 80 + HL 40 (กำลังผลิต)
const DRAFT = "DEMO-26002"; // HL 192 (ร่างที่ระเบิด BOM แล้ว)
// PK รายงาน HL 60 (สั่ง 40) แล้ว WH รับเข้าครบ 60 → ส่วนเกิน 20 เป็นสต็อกสินค้าสำเร็จรูปของ HL
const withSurplus = () => {
  const d = fresh();
  reportPk(d, { [HL]: 60 });
  receiveFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 60 }] }, whCtx());
  return d;
};
const planner = (now = NOW + 60000) => ctx("planner", now);
const clonedData = (d) => JSON.parse(JSON.stringify(d));
// ใบร่างใหม่ที่สั่ง HL ตามจำนวน ระเบิด BOM แล้ว (ต่อท้ายคิวของใบร่าง)
const extraDraft = (d, id, qty, now = NOW + 1000) => {
  A.createOrder(d, { pi: id, customer: "ลูกค้าสต็อก", country: "Thailand", orderedAt: day(0), whDue: day(10) }, planner(now));
  A.addOrderItem(d, { orderId: id, fgCode: HL, qty }, planner(now));
  A.explodeOrder(d, { orderId: id }, planner(now));
  return d.orders.find((entry) => entry.id === id);
};
const orderOf = (d, id) => d.orders.find((entry) => entry.id === id);
const hl = (d, id) => rules.fgPosition(d, orderOf(d, id)).products.find((product) => product.fgCode === HL);
const jobTotals = (d, id) => d.jobs.filter((job) => job.orderId === id && job.kind !== "PURCHASED" && job.dept !== "PK").reduce((sum, job) => sum + job.qtyPlanned, 0);

test("fg stock: only the planning group sets how much of a product a draft takes from stock, within the ordered quantity and the stock available to this draft", () => {
  const d = withSurplus();
  const draft = orderOf(d, DRAFT);
  assert.deepEqual(rules.fgStockForDraft(d, draft).map((row) => [row.fgCode, row.stock, row.available, row.max, row.planned]), [[HL, 20, 20, 20, null]], "the 20 surplus pieces of HL");
  for (const who of ["st", "wh"]) rejects(() => A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 5 }, ctx(who)), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  rejects(() => A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 5 }, ctx("rb")), /บันทึกยอดคงคลังได้โดย/, "a department that may not count at all");
  rejects(() => A.setStockCounts(d, { orderId: DRAFT, counts: [{ itemCode: HL, qty: 5 }] }, ctx("st")), /ฝ่ายวางแผนหรือผู้จัดการเท่านั้น/);
  assert.deepEqual(draft.stockCounts, {}, "nothing was saved");
  // ST and WH staff still count the other items of a draft
  const part = draft.explosion.find((line) => line.level > 0 && line.kind !== "PURCHASED").itemCode;
  A.setStockCount(d, { orderId: DRAFT, itemCode: part, qty: 1 }, ctx("st"));
  A.setStockCounts(d, { orderId: DRAFT, counts: [{ itemCode: part, qty: 2 }] }, ctx("wh"));
  assert.equal(draft.stockCounts[part], 2);
  assert.equal(d.audit[0].action, "นับคงคลังตามใบ", "counting another item keeps the count wording");
  // the amount: not above the stock available to this draft, not above the ordered quantity, not on a released order
  rejects(() => A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 21 }, planner()), /มี 20.*ใช้ 21 ไม่ได้/);
  rejects(() => A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: -1 }, planner()), /มากกว่า 0/);
  rejects(() => A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: "x" }, planner()), /ตัวเลข/);
  const small = extraDraft(d, "N-S1", 5);
  rejects(() => A.setStockCount(d, { orderId: small.id, itemCode: HL, qty: 6 }, planner()), /ไม่เกินจำนวนสั่ง 5/);
  rejects(() => A.setStockCount(d, { orderId: SRC, itemCode: HL, qty: 1 }, planner()), /ปล่อยผลิตแล้ว/);
  // the audit row of a product's use-from-stock says so (the action key stays setStockCount)
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  assert.equal(d.audit[0].action, "ใช้จากสต็อกสินค้าสำเร็จรูป", "a product's use-from-stock");
  assert.match(d.audit[0].detail, new RegExp(`${DRAFT} ${HL.replace(/[()]/g, "\\$&")} = 20`));
  assert.equal(draft.stockCounts[HL], 20);
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 0 }, { now: NOW, user: user("manager") });
  assert.equal(draft.stockCounts[HL], 0, "a manager sets it too, and 0 is allowed");
  // the requirement of every department follows: HL stock shrinks what is to be made
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  const net = new Map(rules.netRequirements(draft.explosion, draft.stockCounts).map((entry) => [entry.itemCode, entry]));
  assert.deepEqual([net.get(HL).required, net.get(HL).stock, net.get(HL).toMake], [192, 20, 172]);
  const plain = new Map(rules.netRequirements(draft.explosion, {}).map((entry) => [entry.itemCode, entry]));
  assert.ok([...net.values()].every((entry) => entry.required <= plain.get(entry.itemCode).required + 1e-9), "nothing needs more than before");
  assert.ok([...net.values()].some((entry) => entry.kind !== "FG" && entry.required < plain.get(entry.itemCode).required), "something below the product needs less");
});

test("fg stock: release takes the amount from the stock of the oldest released orders, PK makes only the rest, and the history names the source", () => {
  const d = withSurplus();
  const plain = withSurplus();
  A.releaseOrder(plain, { orderId: DRAFT }, planner());
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.releaseOrder(d, { orderId: DRAFT }, planner());
  const draft = orderOf(d, DRAFT);
  assert.equal(draft.status, "released");
  const pk = d.jobs.find((job) => job.orderId === DRAFT && job.dept === "PK" && job.kind === "FG");
  assert.deepEqual([pk.qtyPlanned, pk.qtyRequired, pk.stockCounted], [172, 192, 20], "PK makes 192 − 20, the requirement stays the ordered quantity");
  assert.equal(plain.jobs.find((job) => job.orderId === DRAFT && job.dept === "PK" && job.kind === "FG").qtyPlanned, 192, "without stock PK makes the full quantity");
  assert.ok(jobTotals(d, DRAFT) < jobTotals(plain, DRAFT), "the other departments make less too");
  const transfers = d.fgMoves.filter((move) => move.kind === "transfer");
  assert.deepEqual(transfers.map((move) => [move.orderId, move.fgCode, move.qty, move.fromOrderId, move.note, move.at, move.by]), [[DRAFT, HL, 20, SRC, "", NOW + 60000, user("planner").name]]);
  // both orders now see it: the source gave 20 away, the draft holds 20 for its own customer
  assert.deepEqual([hl(d, SRC).have, hl(d, SRC).givenAway, hl(d, SRC).deliverable, hl(d, SRC).free], [60, 20, 40, 0]);
  assert.deepEqual([hl(d, DRAFT).fromStock, hl(d, DRAFT).have, hl(d, DRAFT).deliverable, hl(d, DRAFT).free, hl(d, DRAFT).receivable], [20, 20, 20, 0, 0]);
  assert.deepEqual(rules.fgOnHand(d).find((row) => row.fgCode === HL), { fgCode: HL, onHand: 60, free: 0, orders: [{ orderId: SRC, qty: 40 }, { orderId: DRAFT, qty: 20 }], freeOrders: [] });
  assert.ok(d.audit.some((entry) => entry.action === "ปล่อยผลิต" && /ใช้สต็อกสินค้าสำเร็จรูป 1 รายการ/.test(entry.detail)));
  // taken from several sources, oldest released first, one row per source
  const e = fresh();
  const srcOrder = orderOf(e, SRC);
  const mkSource = (id, releasedAt, qty) => {
    e.orders.push({ ...clonedData(srcOrder), id, releasedAt, items: [{ fgCode: HL, qty: 10, colorSet: "A", note: "" }], explosion: null });
    e.jobs.push({ id: `J-${id}`, orderId: id, dept: "PK", itemCode: HL, name: "x", kind: "FG", uom: "set", qtyPlanned: 10, qtyRequired: 10, stockCounted: null, qtyDone: qty, qtyReject: 0, dueAt: NOW, status: "done", externalRef: null, fgCodes: [HL], createdAt: NOW, reports: [] });
    e.fgMoves = [...(e.fgMoves ?? []), { id: `r-${id}`, orderId: id, fgCode: HL, kind: "receive", qty, note: "", at: NOW, by: "x" }];
  };
  mkSource("SRC-B", NOW - 5 * DAY, 14); // oldest: 4 surplus
  mkSource("SRC-A", NOW - 2 * DAY, 17); // 7 surplus
  const newest = extraDraft(e, "N-MANY", 9);
  A.setStockCount(e, { orderId: newest.id, itemCode: HL, qty: 9 }, planner());
  A.releaseOrder(e, { orderId: newest.id }, planner(NOW + 2000));
  assert.deepEqual(e.fgMoves.filter((move) => move.kind === "transfer").map((move) => [move.fromOrderId, move.qty]), [["SRC-B", 4], ["SRC-A", 5]], "the oldest released gives all it has first, then the next");
  assert.equal(orderOf(e, newest.id).status, "completed", "9 of 9 from stock");
});

test("fg stock: two drafts compete — the display order is a guide, the order released first gets the stock and the other is told the numbers changed", () => {
  const d = withSurplus();
  const early = orderOf(d, DRAFT); // calculated first
  const late = extraDraft(d, "N-LATE", 30);
  assert.ok(early.explodedAt < late.explodedAt, "the demo draft was calculated first");
  A.setStockCount(d, { orderId: early.id, itemCode: HL, qty: 15 }, planner());
  assert.deepEqual(rules.fgStockForDraft(d, late).map((row) => [row.stock, row.taken, row.available, row.max]), [[20, 15, 5, 5]], "the later draft is offered only what the earlier one leaves");
  rejects(() => A.setStockCount(d, { orderId: late.id, itemCode: HL, qty: 6 }, planner()), /มี 5.*ใบร่างที่คำนวณก่อนใบนี้ตั้งใช้ไว้ 15/);
  A.setStockCount(d, { orderId: late.id, itemCode: HL, qty: 5 }, planner());
  // the later draft is released first and takes its 5; the earlier one still finds its 15 (20 − 5)
  const a = clonedData(d);
  A.releaseOrder(a, { orderId: late.id }, planner(NOW + 2000));
  A.releaseOrder(a, { orderId: early.id }, planner(NOW + 3000));
  assert.deepEqual(a.fgMoves.filter((move) => move.kind === "transfer").map((move) => [move.orderId, move.qty]), [["N-LATE", 5], [early.id, 15]]);
  // but when the stock shrinks after both were planned (WH delivers 50 of the 60 pieces: the 40 ordered and 10 of the surplus), the one released first wins and the other fails
  const b = clonedData(d);
  // ส่งเกินจำนวนที่สั่ง (N5): ต้องติ๊กยืนยันในฟอร์ม (overConfirm) ไม่งั้นไม่บันทึก
  rejects(() => A.deliverFg(b, { orderId: SRC, lines: [{ fgCode: HL, qty: 50 }] }, whCtx()), /ส่งมอบเกินจำนวนที่สั่ง DEMO-HL-24\(B\)-A 10 ติ๊กยืนยัน/);
  A.deliverFg(b, { orderId: SRC, lines: [{ fgCode: HL, qty: 50 }], overConfirm: true }, whCtx());
  assert.equal(rules.fgOnHand(b).find((row) => row.fgCode === HL).free, 10);
  A.releaseOrder(b, { orderId: late.id }, planner(NOW + 2000));
  rejects(() => A.releaseOrder(b, { orderId: early.id }, planner(NOW + 3000)), /ตัวเลขเปลี่ยนไปแล้ว.*ไม่พอที่ใบนี้ตั้งใช้ 15.*เหลือ 5/);
  assert.equal(orderOf(b, early.id).status, "draft", "a failed release changes nothing");
  assert.equal(b.fgMoves.filter((move) => move.kind === "transfer").length, 1);
  // the planner lowers the amount and releases: now it fits
  A.setStockCount(b, { orderId: early.id, itemCode: HL, qty: 5 }, planner(NOW + 4000));
  A.releaseOrder(b, { orderId: early.id }, planner(NOW + 5000));
  assert.equal(orderOf(b, early.id).status, "released");
  assert.equal(rules.fgOnHand(b).find((row) => row.fgCode === HL).free, 0);
});

test("fg stock: an amount above the ordered quantity (the item was lowered after) or above the stock refuses the release and creates nothing", () => {
  const d = withSurplus();
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.updateOrderItem(d, { orderId: DRAFT, fgCode: HL, qty: 15 }, planner());
  assert.equal(orderOf(d, DRAFT).stockCounts[HL], 15, "lowering the ordered quantity trims the amount taken from stock to it");
  // a stored amount above the ordered quantity (e.g. written by an older page) still refuses the release
  orderOf(d, DRAFT).stockCounts = { ...orderOf(d, DRAFT).stockCounts, [HL]: 20 };
  A.explodeOrder(d, { orderId: DRAFT }, planner());
  rejects(() => A.releaseOrder(d, { orderId: DRAFT }, planner()), /ตั้งใช้จากสต็อกสินค้าสำเร็จรูป 20 เกินจำนวนสั่ง 15/);
  assert.equal(orderOf(d, DRAFT).status, "draft");
  assert.equal(d.jobs.filter((job) => job.orderId === DRAFT).length, 0);
  assert.equal((d.fgMoves ?? []).filter((move) => move.kind === "transfer").length, 0);
  // stock that is not there at all
  const e = fresh();
  orderOf(e, DRAFT).stockCounts = { [HL]: 3 };
  rejects(() => A.releaseOrder(e, { orderId: DRAFT }, planner()), /เหลือ 0.*กลับไปตั้งยอดใหม่/);
});

test("fg stock: an order whose products all come from stock is released and closed in one step, with no jobs, and goes to delivery", () => {
  const d = withSurplus();
  const only = extraDraft(d, "N-FULL", 12);
  A.setStockCount(d, { orderId: only.id, itemCode: HL, qty: 12 }, planner());
  const net = rules.netRequirements(only.explosion, only.stockCounts);
  assert.ok(net.every((entry) => entry.toMake === 0), "nothing is left to make");
  assert.equal(net.filter((entry) => entry.kind === "PURCHASED" && entry.required > 0).length, 0, "no purchased part is needed either");
  A.releaseOrder(d, { orderId: only.id }, planner(NOW + 2000));
  assert.equal(rules.fgOnHand(d).find((row) => row.fgCode === HL).free, 8, "20 surplus − 12 taken");
  assert.equal(only.status, "completed", "closed in the same save");
  assert.deepEqual([only.releasedAt, only.completedAt], [NOW + 2000, NOW + 2000]);
  assert.equal(d.jobs.filter((job) => job.orderId === only.id).length, 0, "no production job at all");
  const position = rules.fgPosition(d, only);
  assert.deepEqual([position.coveredByStock, position.waitingDelivery, position.fullyDelivered, position.allReceived, position.anyReceivable], [true, true, false, true, false]);
  // delivery: the cap is what the order holds; the source's cap fell by what it gave away
  rejects(() => A.deliverFg(d, { orderId: only.id, lines: [{ fgCode: HL, qty: 13 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 12/);
  rejects(() => A.deliverFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 49 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 48 .*ให้ใบอื่นไปแล้ว 12/, "60 held − 12 given to the other order");
  A.deliverFg(d, { orderId: only.id, lines: [{ fgCode: HL, qty: 12 }] }, whCtx());
  assert.equal(rules.fgPosition(d, only).fullyDelivered, true);
  A.deliverFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 48 }], overConfirm: true }, whCtx());
  assert.equal(hl(d, SRC).deliverable, 0);
  // a closed order can be neither cancelled nor edited
  rejects(() => A.cancelOrder(d, { orderId: only.id }, planner()), /เสร็จแล้วยกเลิกไม่ได้/);
  rejects(() => A.updateOrderItem(d, { orderId: only.id, fgCode: HL, qty: 1 }, planner()), /ปิดหรือยกเลิกแล้ว/);
  // the source delivered 48 of its 60 (40 ordered + 8 surplus): nothing is left as stock for a later draft
  const part = extraDraft(d, "N-PART", 40, NOW + 5000);
  assert.equal(rules.fgStockForDraft(d, part)[0].stock, 0);
});

test("fg stock: cancelling or reopening an order that took stock gives it back to the source; delivery or giving stock away refuses both", () => {
  const d = withSurplus();
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.releaseOrder(d, { orderId: DRAFT }, planner(NOW + 2000));
  assert.equal(hl(d, SRC).free, 0);
  // reopen by editing an item: back to a draft, the stock goes back, the amount stays saved
  const reopen = clonedData(d);
  A.updateOrderItem(reopen, { orderId: DRAFT, fgCode: HL, qty: 190 }, planner(NOW + 3000));
  assert.equal(orderOf(reopen, DRAFT).status, "draft");
  assert.equal(orderOf(reopen, DRAFT).stockCounts[HL], 20, "the saved amount is kept on reopen");
  assert.deepEqual(reopen.fgMoves.filter((move) => move.kind === "untransfer").map((move) => [move.orderId, move.fgCode, move.qty, move.fromOrderId, move.at]), [[DRAFT, HL, 20, SRC, NOW + 3000]]);
  assert.deepEqual([hl(reopen, SRC).givenAway, hl(reopen, SRC).free, hl(reopen, DRAFT).have], [0, 20, 0], "the 20 are free again and the draft holds nothing");
  assert.equal(reopen.jobs.filter((job) => job.orderId === DRAFT).length, 0);
  assert.ok(reopen.audit.some((entry) => /คืนสต็อกสินค้าสำเร็จรูป 1 รายการ/.test(entry.detail)));
  // cancel: the same return, and the stock is free for another order
  const cancelled = clonedData(d);
  A.cancelOrder(cancelled, { orderId: DRAFT, reason: "ลูกค้ายกเลิก" }, planner(NOW + 3000));
  assert.equal(orderOf(cancelled, DRAFT).status, "cancelled");
  assert.equal(cancelled.fgMoves.filter((move) => move.kind === "untransfer").length, 1);
  assert.equal(rules.fgOnHand(cancelled).find((row) => row.fgCode === HL).free, 20);
  assert.deepEqual(rules.fgStockLock(cancelled, orderOf(cancelled, DRAFT)).took, [], "net zero: nothing is returned twice");
  // delivery to the customer of the order that took stock refuses cancel and reopen
  const delivered = clonedData(d);
  A.deliverFg(delivered, { orderId: DRAFT, lines: [{ fgCode: HL, qty: 5 }] }, whCtx());
  rejects(() => A.cancelOrder(delivered, { orderId: DRAFT, reason: "ลูกค้ายกเลิก" }, planner()), /ส่งมอบสินค้าให้ลูกค้าแล้ว[\s\S]*ปิดใบ \(รับไม่ครบ\)/);
  rejects(() => A.updateOrderItem(delivered, { orderId: DRAFT, fgCode: HL, qty: 190 }, planner()), /ส่งมอบสินค้าให้ลูกค้าแล้ว/);
  assert.equal(orderOf(delivered, DRAFT).status, "released", "a refusal changes nothing");
  assert.equal(delivered.fgMoves.filter((move) => move.kind === "untransfer").length, 0);
  // the source that gave stock away cannot be cancelled either (its PK reports are removed here only to reach that rule)
  const gave = clonedData(d);
  for (const job of gave.jobs.filter((entry) => entry.orderId === SRC)) { job.qtyDone = 0; job.qtyReject = 0; job.status = "queued"; job.reports = []; }
  rejects(() => A.cancelOrder(gave, { orderId: SRC, reason: "ลูกค้ายกเลิก" }, planner()), /ให้สินค้าจากสต็อกแก่ใบอื่นไปแล้ว \(DEMO-26002\)/);
  rejects(() => A.updateOrderItem(gave, { orderId: SRC, fgCode: HL, qty: 41 }, planner()), /ให้สินค้าจากสต็อกแก่ใบอื่นไปแล้ว/);
});

test("fg stock: the warehouse receives the surplus PK made after the order closed, and it becomes stock for other orders", () => {
  const d = fresh();
  reportPk(d, { [TP]: 80, [HL]: 60 });
  receiveFg(d, { orderId: SRC, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  const order = orderOf(d, SRC);
  assert.equal(order.status, "completed", "40 of 40 received: the order closed by itself");
  assert.equal(hl(d, SRC).receivable, 20);
  assert.equal(rules.fgOnHand(d).find((row) => row.fgCode === HL).free, 0, "not received yet: it is not stock");
  // only WH or admin; no more than PK made
  rejects(() => receiveFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 20 }] }, whCtx(user("planner"))), /คลังสินค้า \(WH\)/);
  rejects(() => receiveFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 21 }] }, whCtx()), /รับได้อีกไม่เกิน 20/);
  const closedAt = order.completedAt;
  const result = receiveFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 20 }], note: "ส่วนเกิน" }, whCtx(whStaff, NOW + 1000));
  assert.equal(result.closed, false, "it was closed already");
  assert.equal(order.status, "completed");
  assert.equal(order.completedAt, closedAt, "the close time is not touched");
  assert.deepEqual(rules.fgOnHand(d).find((row) => row.fgCode === HL), { fgCode: HL, onHand: 60, free: 20, orders: [{ orderId: SRC, qty: 60 }], freeOrders: [{ orderId: SRC, qty: 20 }] });
  assert.equal(rules.fgPosition(d, order).waitingDelivery, true, "the customer still waits for the 40 ordered");
  // the closed order's delivery: the customer's 40 first; the 20 surplus stays as stock
  A.deliverFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 40 }, { fgCode: TP, qty: 80 }] }, whCtx());
  assert.deepEqual([rules.fgPosition(d, order).waitingDelivery, rules.fgPosition(d, order).fullyDelivered, rules.fgPosition(d, order).anyDeliverable], [false, true, true], "delivered in full to the customer; the surplus is still there");
  assert.equal(rules.fgStockForDraft(d, orderOf(d, DRAFT))[0].stock, 20);
  // a draft takes the surplus; what it took is out of reach of the source's own delivery
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.releaseOrder(d, { orderId: DRAFT }, planner(NOW + 2000));
  rejects(() => A.deliverFg(d, { orderId: SRC, lines: [{ fgCode: HL, qty: 1 }] }, whCtx()), /ส่งมอบได้อีกไม่เกิน 0/);
});

test("fg stock: in database mode the actions only check — no history, no completion, no return rows — and the same refusals apply", () => {
  const remote = (who = user("planner"), now = NOW + 60000) => ({ now, user: who, remote: true });
  const d = withSurplus();
  A.setStockCount(d, { orderId: DRAFT, itemCode: HL, qty: 20 }, remote());
  A.releaseOrder(d, { orderId: DRAFT }, remote());
  assert.equal(orderOf(d, DRAFT).status, "released");
  assert.equal(d.fgMoves.filter((move) => move.kind === "transfer").length, 0, "the server writes the transfers");
  assert.equal(d.jobs.find((job) => job.orderId === DRAFT && job.dept === "PK" && job.kind === "FG").qtyPlanned, 172);
  // fully covered: sent as released (a client may not set an order to completed); the server completes it and answers with the order
  const e = withSurplus();
  const only = extraDraft(e, "N-FULL", 12);
  A.setStockCount(e, { orderId: only.id, itemCode: HL, qty: 12 }, remote());
  A.releaseOrder(e, { orderId: only.id }, remote());
  assert.equal(only.status, "released");
  assert.equal(e.jobs.filter((job) => job.orderId === only.id).length, 0);
  // refusals come from the data the page holds (what the server has written)
  const f = withSurplus();
  A.setStockCount(f, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.releaseOrder(f, { orderId: DRAFT }, planner(NOW + 2000));
  A.deliverFg(f, { orderId: DRAFT, lines: [{ fgCode: HL, qty: 1 }] }, whCtx());
  rejects(() => A.cancelOrder(f, { orderId: DRAFT, reason: "ลูกค้ายกเลิก" }, remote()), /ส่งมอบสินค้าให้ลูกค้าแล้ว/);
  const g = withSurplus();
  A.setStockCount(g, { orderId: DRAFT, itemCode: HL, qty: 20 }, planner());
  A.releaseOrder(g, { orderId: DRAFT }, planner(NOW + 2000));
  A.cancelOrder(g, { orderId: DRAFT, reason: "ลูกค้ายกเลิก" }, remote(user("planner"), NOW + 3000));
  assert.equal(g.fgMoves.filter((move) => move.kind === "untransfer").length, 0, "no return rows written locally");
  // a receive on a closed order is sent as a request only
  const h = fresh();
  reportPk(h, { [TP]: 80, [HL]: 60 });
  receiveFg(h, { orderId: SRC, lines: [{ fgCode: TP, qty: 80 }, { fgCode: HL, qty: 40 }] }, whCtx());
  assert.deepEqual(receiveFg(h, { orderId: SRC, lines: [{ fgCode: HL, qty: 20 }] }, { now: NOW, user: whStaff, remote: true }).request, { orderId: SRC, kind: "receive", lines: [{ fgCode: HL, qty: 20 }] });
});

test("the data check lists a rod line that disagrees with the rod's cutting data by more than 1% (W5), under the parent that holds the line", () => {
  const d = fresh();
  assert.deepEqual(rules.auditMaster(d).rbCut, [], "the demo rods follow their cutting data");
  const parent = "SE-TP01-OR01-100-18-65";
  const rod = "RB-DM01-02-OR01-202-18-70";
  const lines = approved(d, parent).lines.map((line) => ({ childCode: line.childCode, qty: line.childCode === rod ? 1 : line.qty, scrapPct: line.scrapPct, note: line.note }));
  A.saveBom(d, { itemCode: parent, lines }, ctx("planner"));
  const found = rules.auditMaster(d).rbCut;
  assert.deepEqual(found.map((entry) => [entry.item.code, entry.child.code, entry.qty]), [[parent, rod, 1]]);
  assert.equal(found[0].expected, rules.rbCutQty(A.helpers.itemOf(d, rod)), "the expected figure is what the cutting data gives (1/31 here)");
  A.saveBom(d, { itemCode: parent, lines: lines.map((line) => (line.childCode === rod ? { ...line, qty: rules.rbCutQty(A.helpers.itemOf(d, rod)) * 1.005 } : line)) }, ctx("planner"));
  assert.deepEqual(rules.auditMaster(d).rbCut, [], "0.5% off is within the tolerance");
  A.saveBom(d, { itemCode: parent, lines }, ctx("planner"));
  A.saveItem(d, { code: parent, kind: "SE", name: "x", uom: "pcs", active: false }, ctx("planner"));
  assert.deepEqual(rules.auditMaster(d).rbCut, [], "a retired parent is not listed");
});

test("a new product made from an order takes the name the user confirmed (1-120 characters), else a suggestion that does not repeat the source's pack and colour (W9)", () => {
  const d = fresh();
  const id = A.createOrder(d, { pi: "W9", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(9) }, ctx("planner"));
  const nameOf = (code) => A.helpers.itemOf(d, code).name;
  A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "A", qty: 5, name: "  ตอปิโดยาง TP-01 แพ็กถุง ชุดสี A  " }, ctx("planner"));
  assert.equal(nameOf("DEMO-TP-01(P)-A"), "ตอปิโดยาง TP-01 แพ็กถุง ชุดสี A", "the typed name is trimmed and used");
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", pkg: "K", colorSet: "", qty: 5 }, ctx("planner"));
  assert.equal(nameOf("DEMO-HL-24(K)"), "DEMO-HL-24 (แพ็กเกจ K)", "no name sent: the source's own description (กล่อง ชุดสี A) is not carried over");
  assert.equal(A.createVariant(d, { base: "DEMO-HL-24", pkg: "N", colorSet: "", cloneFrom: "DEMO-HL-24(K)" }, ctx("planner")), "DEMO-HL-24(N)");
  assert.equal(nameOf("DEMO-HL-24(N)"), "DEMO-HL-24 (แพ็กเกจ N)", "createVariant keeps working without a name");
  assert.equal(A.createVariant(d, { base: "DEMO-HL-24", pkg: "C", colorSet: "", cloneFrom: "DEMO-HL-24(K)", name: "ห่วงฮูล่า แพ็ก C" }, ctx("planner")), "DEMO-HL-24(C)");
  assert.equal(nameOf("DEMO-HL-24(C)"), "ห่วงฮูล่า แพ็ก C");
  rejects(() => A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", pkg: "X", colorSet: "", qty: 1, name: "x".repeat(121) }, ctx("planner")), /ยาวเกิน 120/);
  assert.equal(A.helpers.itemOf(d, "DEMO-HL-24(X)"), null, "a refused name creates nothing");
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", pkg: "B-N", colorSet: "", qty: 1, name: "   " }, ctx("planner"));
  assert.equal(nameOf("DEMO-HL-24(B-N)"), "DEMO-HL-24 (แพ็กเกจ B-N)", "a blank name falls back to the suggestion");
  // สินค้าที่มีอยู่แล้ว: ชื่อที่ส่งมาไม่เปลี่ยนชื่อสินค้าเดิม
  const before = nameOf("DEMO-TP-01(P)-Y");
  A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "Y", qty: 1, name: "ชื่ออื่น" }, ctx("planner"));
  assert.equal(nameOf("DEMO-TP-01(P)-Y"), before);
  // ชื่อที่ยาวถึง 120 ตัวอักษรผ่านการตรวจของฐานข้อมูล (ชื่อชิ้นงาน 1-160)
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", pkg: "B", colorSet: "E", qty: 1, name: "ย".repeat(120) }, ctx("planner"));
  assert.equal(nameOf("DEMO-HL-24(B)-E").length, 120);
});
