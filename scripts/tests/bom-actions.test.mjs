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
const fresh = () => seed.buildSeed(NOW);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const approved = (d, code) => A.helpers.approvedBomOf(d, code);
const day = (n) => new Date(NOW + n * DAY).setHours(0, 0, 0, 0);

test("the demo seed is deterministic, valid for the store and internally consistent", () => {
  const a = fresh();
  assert.deepEqual(a, fresh());
  assert.ok(storeApi.isValidState(a));
  assert.equal(a.users.length, 8);
  assert.equal(a.items.length, seed.ITEMS.length);
  assert.equal(a.boms.filter((bom) => bom.status === "approved").length, 8);
  assert.equal(a.boms.filter((bom) => bom.status === "superseded").length, 1, "one edit left a superseded revision");
  assert.equal(approved(a, "SE-TP01-OR01-100-18-65").revision, 2);
  assert.equal(approved(a, "DEMO-BL-60(K)-Z"), null, "the ball product has no BOM yet");
  assert.deepEqual(a.orders.map((order) => [order.id, order.status]), [["DEMO-26002", "draft"], ["DEMO-26001", "in_progress"]]);
  const jobs = a.jobs.filter((job) => job.orderId === "DEMO-26001");
  assert.equal(jobs.length, 14, "one job per department × item plus one PK job per product");
  assert.ok(jobs.every((job) => rules.MANUFACTURED.includes(job.kind)), "purchased items are not jobs");
  const rb = jobs.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rb.qtyPlanned.toFixed(2), "7.74", "80 sets × 3 SE / 31 pieces per rod — the BOMSHEET number");
  assert.equal(rb.qtyRequired, rb.qtyPlanned, "nothing counted → plan = gross need");
  assert.equal(rb.stockCounted, null);
  const pt = jobs.find((job) => job.itemCode === "PT-00320");
  assert.equal(pt.status, "done");
  assert.deepEqual([pt.qtyRequired, pt.stockCounted, pt.qtyPlanned], [24, 10, 14], "the counted stock reduces the planned quantity (BOMSHEET column AK)");
  assert.equal(jobs.find((job) => job.itemCode === "RB-DM02-02-BK01-225-3-20").qtyPlanned.toFixed(2), "14.14", "17.14 rods needed across both products, 3 counted");
  assert.equal(jobs.find((job) => job.itemCode === "BG-0092").status, "hold");
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
  rejects(() => A.saveBom(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "DEMO-TP-01(P)-Y", qty: 1 }] }, ctx("planner")), /วงจร/);
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
  assert.deepEqual(approved(d, "NEW-TP-02(P)-Y").lines.map((line) => line.childCode), ["SE-NEW-01", "P-STK-01", "PT-00320", "RB-DM02-02-BK01-225-3-20"]);
  assert.equal(approved(d, "NEW-TP-02(P)-Y").note, "สร้างครั้งแรก");
  // บันทึกซ้ำโดยไม่เปลี่ยนอะไร = ไม่มี revision ใหม่
  const again = A.saveBomTree(d, { code: "NEW-TP-02(P)-Y", item: { name: "ตอปิโดใหม่", uom: "set" }, nodes: [
    { code: "SE-NEW-01", qty: 2, children: [{ code: "RB-DM01-02-BK01-202-18-70", qty: 0.05 }] }, { code: "P-STK-01", qty: 1 }, { code: "PT-00320", qty: 0.3, children: [{ code: "P-PEL-BK", qty: 0.02 }] }, { code: "RB-DM02-02-BK01-225-3-20", qty: 1 },
  ] }, ctx("planner"));
  assert.deepEqual(again.saved, []);
  assert.equal(again.summary, "ไม่มีการเปลี่ยนแปลง");
  assert.equal(again.changed, false);
  assert.equal(approved(d, "NEW-TP-02(P)-Y").revision, 1);
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
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 1 }, ctx("gr")), /คลัง/);
  A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 3 }, ctx("st"));
  assert.equal(order.stockCounts["P-BOX-01"], 3);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "DEMO-TP-01(P)-Y", qty: 1 }, ctx("st")), /สินค้าสำเร็จรูป/);
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
  assert.ok(!jobs.some((job) => job.kind === "PURCHASED"));
  assert.equal(jobs.find((job) => job.kind === "FG" && job.itemCode === "DEMO-TP-01(P)-Y").qtyPlanned, 80, "PK jobs carry the ordered quantity");
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 1 }, ctx("planner")), /ร่าง/);
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
  assert.equal(rb3.qtyPlanned, rb3.qtyRequired);
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
  assert.deepEqual(bom.lines.map((line) => [line.childCode, line.qty]), [["XP-00001", 1], ["PT-00320", 0.3], ["P-STK-01", 1], ["SE-TP01-RD01-100-18-65", 3], ["SE-TP01-BK01-140-3-20", 3], ["SE-TP01-RD01-75-3-30", 9], ["P-BAG-01", 0.01], ["P-BOX-01", 0.025]], "orange SE slots become red, the black core stays, packaging lines come from the package definition");
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

test("jobs: the department reports output, hold/queue toggles, orders progress and close only when PK is done", () => {
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
  rejects(() => A.completeOrder(d, { orderId }, ctx("planner")), /PK/);
  rejects(() => A.cancelOrder(d, { orderId }, ctx("planner")), /รายงานผลผลิตแล้ว/);
  d.jobs.filter((entry) => entry.orderId === orderId && entry.dept === "PK").forEach((pk) => A.reportJob(d, { jobId: pk.id, qtyDone: pk.qtyPlanned }, ctx("planner")));
  A.completeOrder(d, { orderId }, ctx("planner"));
  assert.equal(order.status, "completed");
  rejects(() => A.setStockCount(d, { orderId, itemCode: "PT-00320", qty: 1 }, ctx("st")), /ปิดแล้ว/);
  rejects(() => A.setJobStatus(d, { jobId: d.jobs.find((entry) => entry.orderId === orderId && entry.status === "queued").id, status: "hold" }, ctx("manager")), /ไม่อยู่ในสถานะผลิต/);
  A.releaseOrder(d, { orderId: "DEMO-26002" }, ctx("planner"));
  assert.ok(d.jobs.some((entry) => entry.orderId === "DEMO-26002"));
  A.cancelOrder(d, { orderId: "DEMO-26002", reason: "ลูกค้าเลื่อน" }, ctx("planner"));
  assert.equal(d.orders.find((entry) => entry.id === "DEMO-26002").status, "cancelled");
  assert.ok(!d.jobs.some((entry) => entry.orderId === "DEMO-26002"));
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
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-1" }, ctx("gr")), /แผนก RB ฝ่ายวางแผน/);
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "" }, ctx("rb")), /เลข WO/);
  A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-69-0007", kg: 3.1 }, ctx("planner"));
  assert.equal(rb.externalRef.woId, "WO-69-0007");
  assert.equal(rb.status, "in_progress");
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-69-0008" }, ctx("rb")), /ผูกกับ WO-69-0007 อยู่แล้ว/);
  const d2 = fresh();
  A.releaseOrder(d2, { orderId: "DEMO-26002" }, ctx("planner"));
  const job2 = d2.jobs.find((job) => job.orderId === "DEMO-26002" && job.dept === "RB");
  A.linkJobToRubberFlow(d2, { jobId: job2.id, woId: "WO-X" }, ctx("rb"));
  rejects(() => A.cancelOrder(d2, { orderId: "DEMO-26002" }, ctx("planner")), /WO-X/);
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
  assert.deepEqual(stats, { itemsAdded: 4, itemsMerged: 2, bomsAdded: 2, bomsSkipped: 1 }, "PT-00320 already has a BOM → skipped; P-STK-01 and PT-00320 merged");
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
  assert.equal(store.data().orders.length, 2, "failed action leaves the state untouched");
  const ok = store.run("createOrder", { pi: "ST-1", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY });
  assert.equal(ok.result, "ST-1");
  assert.ok(store.isPersisted());
  assert.ok(JSON.parse(storage.get(storeApi.STATE_KEY)).orders.some((order) => order.id === "ST-1"));
  const reloaded = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(reloaded.user().id, "B03");
  storage.set(storeApi.STATE_KEY, "{broken");
  const repaired = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(repaired.data().orders.length, 2, "corrupt storage → fresh seed");
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
  assert.equal(upgraded.data().version, 3);
  assert.equal(upgraded.data().boms.filter((bom) => ["draft", "pending"].includes(bom.status)).length, 0);
  assert.equal(upgraded.data().boms.length, old.boms.length - 2);
  assert.equal(upgraded.data().orders.length, 2, "orders survive the upgrade");
  assert.equal(JSON.parse(oldStorage.get(storeApi.STATE_KEY)).version, 3, "upgraded state is written back");
  // รุ่น 2 (ไม่มีตารางสี) → รุ่น 3 เพิ่มรายการว่าง ข้อมูลเดิมคงอยู่
  const v2 = fresh();
  v2.version = 2;
  delete v2.colors; delete v2.colorSets; delete v2.packages;
  const fromV2 = storeApi.migrate(JSON.parse(JSON.stringify(v2)));
  assert.equal(fromV2.version, 3);
  assert.deepEqual([fromV2.colors, fromV2.colorSets, fromV2.packages], [[], [], []]);
  assert.equal(fromV2.items.length, v2.items.length);
  assert.ok(storeApi.isValidState(fromV2));
  assert.equal(storeApi.isValidState({ ...fresh(), colors: undefined }), false, "a v3 state without the colour tables is not valid as is");
  assert.equal(storeApi.migrate({ version: 99, counters: {}, users: [], compounds: [], items: [], boms: [], orders: [], jobs: [], audit: [], colors: [], colorSets: [], packages: [] }), null, "unknown versions are reseeded");
  assert.equal(storeApi.MODULES[1].id, "build", "the single BOM builder is the first menu after the overview");
});
