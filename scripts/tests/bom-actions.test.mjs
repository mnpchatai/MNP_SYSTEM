import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

// กฎธุรกิจของ BOM รายแผนก (modules/bom-actions.js) บนข้อมูลสาธิต (modules/bom-seed.js): ทุก action ทำบนร่างและ throw เมื่อกฎไม่ผ่าน
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

test("the demo seed is deterministic, valid for the store and internally consistent", () => {
  const a = fresh();
  assert.deepEqual(a, fresh());
  assert.ok(storeApi.isValidState(a));
  assert.equal(a.users.length, 8);
  assert.equal(a.items.length, seed.ITEMS.length);
  assert.equal(a.boms.filter((bom) => bom.status === "approved").length, 8);
  assert.equal(a.boms.filter((bom) => bom.status === "pending").length, 1, "the GR draft waits for approval");
  assert.deepEqual(a.orders.map((order) => [order.id, order.status]), [["DEMO-26002", "draft"], ["DEMO-26001", "in_progress"]]);
  const released = a.orders.find((order) => order.id === "DEMO-26001");
  assert.equal(released.orderType, "EX");
  assert.equal(a.orders.find((order) => order.id === "DEMO-26002").orderType, "SA");
  const jobs = a.jobs.filter((job) => job.orderId === "DEMO-26001");
  assert.equal(jobs.length, 14, "one job per department × item plus one PK job per product");
  assert.ok(jobs.every((job) => rules.MANUFACTURED.includes(job.kind)), "purchased items are not jobs");
  const rb = jobs.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rb.qtyPlanned.toFixed(2), "7.74", "80 sets × 3 SE / 31 pieces per rod — the BOMSHEET number");
  assert.equal(rb.status, "in_progress");
  assert.equal(jobs.find((job) => job.itemCode === "PT-00320").status, "done");
  assert.equal(jobs.find((job) => job.itemCode === "BG-0092").status, "hold");
  assert.equal(released.stockCounts["RB-DM02-02-BK01-225-3-20"], 18);
  assert.ok(a.audit.length > 40 && a.audit.every((entry) => entry.user && entry.action));
});

test("BOM layers belong to departments: only the owner edits, the FG layer needs the factory manager, other layers their head", () => {
  const d = fresh();
  // GR แก้ BOM ของ SE ได้ แต่แก้ของ FG (PK) ไม่ได้
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 1 }] }, ctx("gr")), /แผนก PK/);
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [] }, ctx("planner")), /อย่างน้อย 1 บรรทัด/);
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "NOPE", qty: 1 }] }, ctx("planner")), /ไม่พบชิ้นงาน NOPE/);
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 1 }, { childCode: "P-STK-01", qty: 2 }] }, ctx("planner")), /ซ้ำ/);
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 0 }] }, ctx("planner")), /มากกว่า 0/);
  // วงจร: PT-00320 มีลูก P-PEL-BK อยู่ ถ้าให้ P-PEL-BK... เป็นของซื้อ ลองวงจรจริง: SE → RB แล้วให้ SE เป็นลูกของ FG ซึ่งเป็นพ่อของ SE อยู่แล้ว → ใส่ FG ใต้ SE
  rejects(() => A.saveBomDraft(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "DEMO-TP-01(P)-Y", qty: 1 }] }, ctx("gr")), /วงจร/);
  const before = approved(d, "DEMO-TP-01(P)-Y");
  const bomId = A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "SE-TP01-OR01-100-18-65", qty: 4 }, { childCode: "P-BOX-01", qty: 0.05, scrapPct: 2 }], note: "เพิ่มลูกตอปิโดเป็น 4" }, ctx("planner"));
  const draft = d.boms.find((bom) => bom.id === bomId);
  assert.equal(draft.revision, before.revision + 1);
  assert.equal(draft.status, "draft");
  assert.equal(draft.lines[1].scrapPct, 2);
  assert.equal(draft.lines[0].consumerDept, "PK");
  assert.equal(draft.lines[0].producerDept, "GR");
  // แก้ร่างซ้ำ = revision เดิม (ไม่งอก)
  assert.equal(A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "SE-TP01-OR01-100-18-65", qty: 5 }] }, ctx("planner")), bomId);
  assert.equal(d.boms.filter((bom) => bom.itemCode === "DEMO-TP-01(P)-Y" && bom.status === "draft").length, 1);
  rejects(() => A.approveBom(d, { bomId }, ctx("manager")), /รออนุมัติ/);
  rejects(() => A.submitBom(d, { bomId }, ctx("gr")), /เจ้าของ/);
  A.submitBom(d, { bomId }, ctx("planner"));
  rejects(() => A.saveBomDraft(d, { itemCode: "DEMO-TP-01(P)-Y", lines: [{ childCode: "P-STK-01", qty: 1 }] }, ctx("planner")), /รออนุมัติอยู่/);
  rejects(() => A.approveBom(d, { bomId }, ctx("planner")), /ผู้จัดการฝ่ายโรงงาน/);
  rejects(() => A.approveBom(d, { bomId }, ctx("gr")), /ผู้จัดการฝ่ายโรงงาน/);
  A.rejectBom(d, { bomId, reason: "ขอดูราคากล่องก่อน" }, ctx("manager"));
  assert.equal(d.boms.find((bom) => bom.id === bomId).status, "draft");
  assert.match(d.boms.find((bom) => bom.id === bomId).changeLog.at(-1).text, /ขอดูราคากล่องก่อน/);
  A.submitBom(d, { bomId }, ctx("planner"));
  A.approveBom(d, { bomId }, ctx("manager"));
  assert.equal(approved(d, "DEMO-TP-01(P)-Y").id, bomId);
  assert.equal(d.boms.find((bom) => bom.id === before.id).status, "superseded", "only one approved revision per item");
  assert.equal(d.boms.filter((bom) => bom.itemCode === "DEMO-TP-01(P)-Y" && bom.status === "approved").length, 1);
  // ชั้น SE: หัวหน้า GR อนุมัติเองได้ ผู้จัดการก็ได้ แต่ RB ไม่ได้
  const pending = d.boms.find((bom) => bom.status === "pending");
  assert.equal(pending.itemCode, "SE-BL60-RD01-60-0-60");
  rejects(() => A.approveBom(d, { bomId: pending.id }, ctx("rb")), /หัวหน้าแผนก GR/);
  A.approveBom(d, { bomId: pending.id }, ctx("gr"));
  assert.equal(approved(d, "SE-BL60-RD01-60-0-60").revision, 1);
  // ลบร่าง
  const draftId = A.saveBomDraft(d, { itemCode: "BG-0092", lines: [{ childCode: "P-FAB-BL", qty: 1 }] }, ctx("bg"));
  rejects(() => A.discardBom(d, { bomId: draftId }, ctx("pt")), /เจ้าของ/);
  A.discardBom(d, { bomId: draftId }, ctx("bg"));
  assert.ok(!d.boms.some((bom) => bom.id === draftId));
});

test("item master: the owner department maintains its items; RB items need a compound which is registered automatically", () => {
  const d = fresh();
  rejects(() => A.saveItem(d, { code: "RB-X", kind: "RB", name: "x", uom: "rod", rubber: { compound: "" } }, ctx("rb")), /สูตรยาง/);
  rejects(() => A.saveItem(d, { code: "RB-X", kind: "RB", name: "x", uom: "rod", rubber: { compound: "DM09" } }, ctx("gr")), /แผนก RB/);
  rejects(() => A.saveItem(d, { code: "P-NEW", kind: "PURCHASED", name: "x", uom: "nope" }, ctx("st")), /หน่วยนับ/);
  rejects(() => A.saveItem(d, { code: "", kind: "PURCHASED", name: "x", uom: "pcs" }, ctx("st")), /รหัสชิ้นงาน/);
  const code = A.saveItem(d, { code: " rb-dm09-01-bk01-200-0-50 ", kind: "RB", name: "เส้นใหม่", uom: "rod", weightG: 900, rubber: { compound: "DM09", type: "01", kgPerRoll: "0.9", pcsPerRoll: "20", sePerGr: "" } }, ctx("rb"));
  assert.equal(code, "RB-DM09-01-BK01-200-0-50");
  const item = A.helpers.itemOf(d, code);
  assert.equal(item.ownerDept, "RB");
  assert.equal(item.rubber.pcsPerRoll, 20);
  assert.ok(d.compounds.some((compound) => compound.code === "DM09" && compound.recipeId === null), "unknown compound is registered unlinked");
  // แก้ชื่อโดยไม่ส่ง rubber: ข้อมูลยางเดิมคงอยู่
  A.saveItem(d, { code, kind: "RB", name: "เส้นใหม่ (แก้ชื่อ)", uom: "rod" }, ctx("manager"));
  assert.equal(A.helpers.itemOf(d, code).rubber.compound, "DM09");
  rejects(() => A.saveItem(d, { code: "DEMO-TP-01(P)-Y", kind: "SE", name: "x", uom: "set" }, ctx("admin")), /เปลี่ยนชนิด/);
  // ผูกสูตรยาง
  rejects(() => A.linkCompound(d, { code: "DM09", recipeId: "RC-X" }, ctx("gr")), /แผนก RB/);
  A.linkCompound(d, { code: "DM09", recipeId: "RC-NR-AM01", recipeName: "NR ยางกันสะเทือน" }, ctx("rb"));
  assert.equal(d.compounds.find((compound) => compound.code === "DM09").recipeId, "RC-NR-AM01");
  A.linkCompound(d, { code: "DM09", recipeId: "" }, ctx("planner"));
  assert.equal(d.compounds.find((compound) => compound.code === "DM09").recipeId, null);
});

test("an existing item can only be edited by its owner department, duplicates are refused on create and only bosses move ownership", () => {
  const d = fresh();
  // RB พยายามยึด PT-00320 ผ่านฟอร์ม "เพิ่มชิ้นงาน" ของแท็บ RB
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "hijacked", uom: "pcs", ownerDept: "RB", create: true }, ctx("rb")), /อยู่แล้ว/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "hijacked", uom: "pcs", ownerDept: "RB" }, ctx("rb")), /แผนก PT/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "hijacked", uom: "pcs", ownerDept: "PT" }, ctx("rb")), /แผนก PT/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "x", uom: "pcs", ownerDept: "RB" }, ctx("pt")), /ผู้จัดการ/);
  rejects(() => A.saveItem(d, { code: "PT-00320", kind: "PT", name: "x", uom: "pcs", ownerDept: "XX" }, ctx("pt")), /แผนกเจ้าของไม่ถูกต้อง/);
  const item = A.helpers.itemOf(d, "PT-00320");
  assert.equal(item.ownerDept, "PT");
  assert.equal(item.name, "แกนตอปิโด ท่อดำ 150 ซม. (20 ก./ชิ้น)");
  A.saveItem(d, { code: "PT-00320", kind: "PT", name: "แกนตอปิโด (แก้โดย PT)", uom: "pcs", ownerDept: "PT" }, ctx("pt"));
  assert.equal(item.name, "แกนตอปิโด (แก้โดย PT)");
  A.saveItem(d, { code: "PT-00320", kind: "PT", name: item.name, uom: "pcs", ownerDept: "BG" }, ctx("manager"));
  assert.equal(item.ownerDept, "BG");
  assert.ok(d.boms.filter((bom) => bom.itemCode === "PT-00320").every((bom) => bom.ownerDept === "BG"), "the BOMs of the item follow the new owner");
  // แก้ SE ผ่านฟอร์มโดยไม่ส่ง product: ข้อมูลยางเดิมไม่หาย
  A.saveItem(d, { code: "SE-TP01-OR01-100-18-65", kind: "SE", name: "ลูกตอปิโด", uom: "pcs", ownerDept: "GR", rubber: { color: "or02", lengthMm: "100", holeMm: "", odMm: "65" } }, ctx("gr"));
  assert.deepEqual(A.helpers.itemOf(d, "SE-TP01-OR01-100-18-65").rubber, { product: "TP01", color: "OR02", lengthMm: 100, odMm: 65 }, "blank form field clears the hole, numbers are numbers, product (no form field) survives");
  // ไม่ส่ง ownerDept: ชิ้นเดิมคงแผนกเดิม (ไม่ถูกย้ายกลับค่าเริ่มต้นเงียบๆ)
  A.saveItem(d, { code: "PT-00320", kind: "PT", name: item.name, uom: "pcs" }, ctx("manager"));
  assert.equal(item.ownerDept, "BG");
  // BOM ของ RB/ของซื้อไม่มีในระบบนี้
  rejects(() => A.saveBomDraft(d, { itemCode: "RB-DM01-01-OR01-200-0-72", lines: [{ childCode: "P-PEL-BK", qty: 1 }] }, ctx("rb")), /RubberFlow/);
  rejects(() => A.saveBomDraft(d, { itemCode: "P-PEL-BK", lines: [{ childCode: "P-STK-01", qty: 1 }] }, ctx("st")), /ของซื้อ/);
  // วงจรผ่านร่างสองใบที่อนุมัติทีหลัง: ใบที่สองถูกปฏิเสธตอนอนุมัติ
  const a = A.saveItem(d, { code: "X-A", kind: "SUBPART", name: "a", uom: "pcs", ownerDept: "PK" }, ctx("planner"));
  const b = A.saveItem(d, { code: "X-B", kind: "SUBPART", name: "b", uom: "pcs", ownerDept: "PK" }, ctx("planner"));
  const ab = A.saveBomDraft(d, { itemCode: a, lines: [{ childCode: b, qty: 1 }] }, ctx("planner"));
  const ba = A.saveBomDraft(d, { itemCode: b, lines: [{ childCode: a, qty: 1 }] }, ctx("planner"));
  A.submitBom(d, { bomId: ab }, ctx("planner"));
  A.submitBom(d, { bomId: ba }, ctx("planner"));
  A.approveBom(d, { bomId: ab }, ctx("manager"));
  rejects(() => A.approveBom(d, { bomId: ba }, ctx("manager")), /วงจร/);
  rejects(() => A.createOrder(d, { pi: "N-1", customer: "x", country: "Thailand", orderedAt: null, whDue: "" }, ctx("planner")), /วันที่สั่งผลิต/);
});

test("a production order explodes with the approved revisions, locks them at release and spawns one job per department × item", () => {
  const d = fresh();
  const day = (n) => new Date(NOW + n * DAY).setHours(0, 0, 0, 0);
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("gr")), /ฝ่ายวางแผน/);
  rejects(() => A.createOrder(d, { pi: "DEMO-26001", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10) }, ctx("planner")), /อยู่แล้ว/);
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(5), whDue: day(1) }, ctx("planner")), /ไม่ก่อนวันที่สั่งผลิต/);
  rejects(() => A.createOrder(d, { pi: "X-1", customer: "a", country: "Thailand", orderedAt: day(0), whDue: day(10), due: { RB: day(12) } }, ctx("planner")), /กำหนดเสร็จ RB/);
  const id = A.createOrder(d, { pi: "x-1", customer: "ลูกค้า ก", country: "Thailand", orderedAt: day(0), whDue: day(10), due: { RB: day(3), PK: day(9) } }, ctx("planner"));
  assert.equal(id, "X-1");
  const order = d.orders.find((entry) => entry.id === id);
  assert.equal(order.orderType, "SA");
  rejects(() => A.explodeOrder(d, { orderId: id }, ctx("planner")), /ยังไม่มีสินค้า/);
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "DEMO-BL-60(K)-Z", qty: 10 }, ctx("planner")), /ยังไม่มี BOM ที่อนุมัติ/);
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "SE-TP01-OR01-100-18-65", qty: 10 }, ctx("planner")), /สินค้าสำเร็จรูป/);
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 50 }, ctx("planner"));
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-TP-01(P)-Y", qty: 30 }, ctx("planner"));
  assert.deepEqual(order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), [["DEMO-TP-01(P)-Y", 80, "Y"]], "the same product is merged into one line");
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, ctx("planner"));
  assert.equal(A.explodeOrder(d, { orderId: id }, ctx("planner")), 23);
  const rbLine = order.explosion.find((line) => line.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rbLine.required.toFixed(2), "7.74");
  assert.equal(rbLine.fgQty, 80);
  const seRev = order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision;
  assert.equal(seRev, 1);
  // ยอดนับคงคลัง: เฉพาะชิ้นในใบ โดย ST/วางแผน/ผู้จัดการ
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "SE-BL60-RD01-60-0-60", qty: 1 }, ctx("st")), /ไม่อยู่ในใบ/);
  rejects(() => A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 1 }, ctx("gr")), /คลัง/);
  A.setStockCount(d, { orderId: id, itemCode: "P-BOX-01", qty: 3 }, ctx("st"));
  assert.equal(order.stockCounts["P-BOX-01"], 3);
  // ลบสินค้าแล้วการระเบิดเดิมหาย
  A.removeOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A" }, ctx("planner"));
  assert.equal(order.explosion, null);
  A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 40 }, ctx("planner"));
  // GR แก้ BOM ของ SE เป็น revision ใหม่ก่อนปล่อยผลิต: การปล่อยใช้ revision ล่าสุด
  const newBom = A.saveBomDraft(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "RB-DM01-02-OR01-202-18-70", qty: 0.05 }] }, ctx("gr"));
  A.submitBom(d, { bomId: newBom }, ctx("gr"));
  A.approveBom(d, { bomId: newBom }, ctx("gr"));
  rejects(() => A.releaseOrder(d, { orderId: id }, ctx("rb")), /ฝ่ายวางแผน/);
  const jobsBefore = d.jobs.length;
  A.releaseOrder(d, { orderId: id }, ctx("planner"));
  assert.equal(order.status, "released");
  assert.equal(order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision, 2, "release re-explodes with the latest approved revision");
  assert.ok(Math.abs(order.explosion.find((line) => line.itemCode === "RB-DM01-02-OR01-202-18-70").required - 12) < 1e-9, "80 × 3 × 0.05 with the new revision");
  const jobs = d.jobs.filter((job) => job.orderId === id);
  assert.equal(d.jobs.length - jobsBefore, jobs.length);
  assert.equal(jobs.filter((job) => job.dept === "PK" && job.kind === "FG").length, 2);
  assert.equal(jobs.filter((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70").length, 1);
  const rbJob = jobs.find((job) => job.itemCode === "RB-DM01-02-OR01-202-18-70");
  assert.equal(rbJob.dueAt, day(3), "department due date from the order header");
  assert.equal(jobs.find((job) => job.itemCode === "BG-0092").dueAt, day(10), "no BG date → warehouse due date");
  assert.ok(!jobs.some((job) => job.kind === "PURCHASED"));
  rejects(() => A.addOrderItem(d, { orderId: id, fgCode: "DEMO-HL-24(B)-A", qty: 1 }, ctx("planner")), /ร่าง/);
  rejects(() => A.explodeOrder(d, { orderId: id }, ctx("planner")), /ร่าง/);
  // อนุมัติ revision ใหม่หลังปล่อยผลิต: ใบที่ปล่อยแล้วไม่เปลี่ยน
  const later = A.saveBomDraft(d, { itemCode: "SE-TP01-OR01-100-18-65", lines: [{ childCode: "RB-DM01-02-OR01-202-18-70", qty: 0.5 }] }, ctx("gr"));
  A.submitBom(d, { bomId: later }, ctx("gr"));
  A.approveBom(d, { bomId: later }, ctx("gr"));
  assert.equal(order.explosion.find((line) => line.itemCode === "SE-TP01-OR01-100-18-65").revision, 2);
  // ไม่มี BOM อนุมัติสำหรับชิ้นที่ต้องผลิต (PT) → ปล่อยไม่ได้
  const d2 = fresh();
  approved(d2, "BG-0092").status = "superseded"; // DEMO-26002 สั่ง DEMO-HL-24(B)-A ซึ่งใช้กระเป๋า BG-0092
  rejects(() => A.releaseOrder(d2, { orderId: "DEMO-26002" }, ctx("planner")), /ยังไม่มี BOM อนุมัติ: BG-0092/);
});

test("a product can be chosen by base code + package + color set; an unknown variant is created from a sibling's approved BOM", () => {
  const d = fresh();
  const day = (n) => new Date(NOW + n * DAY).setHours(0, 0, 0, 0);
  const id = A.createOrder(d, { pi: "P3", customer: "x", country: "Thailand", orderedAt: day(0), whDue: day(9) }, ctx("planner"));
  // รหัสเต็มที่มีอยู่แล้ว
  A.addOrderItem(d, { orderId: id, base: "demo-tp-01", pkg: "p", colorSet: "y", qty: 10 }, ctx("planner"));
  const order = d.orders.find((entry) => entry.id === id);
  assert.deepEqual(order.items.map((item) => [item.fgCode, item.qty, item.colorSet]), [["DEMO-TP-01(P)-Y", 10, "Y"]]);
  assert.equal(d.items.filter((item) => item.kind === "FG").length, 3, "no new item for an existing code");
  // ฐานรหัสที่ไม่มีเลย
  rejects(() => A.addOrderItem(d, { orderId: id, base: "NOPE-01", pkg: "P", colorSet: "Y", qty: 1 }, ctx("planner")), /ไม่มีฐานรหัส NOPE-01/);
  rejects(() => A.addOrderItem(d, { orderId: id, base: "", qty: 1 }, ctx("planner")), /ไม่พบสินค้า/);
  // ชุดสีใหม่ของฐานรหัสเดิม → สร้าง FG + BOM Rev.1 คัดลอกจากต้นแบบแพ็กเกจเดียวกัน
  A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "A", qty: 5 }, ctx("planner"));
  const created = A.helpers.itemOf(d, "DEMO-TP-01(P)-A");
  assert.ok(created, "variant created");
  assert.equal(created.kind, "FG");
  assert.equal(created.ownerDept, "PK");
  assert.equal(created.clonedFrom, "DEMO-TP-01(P)-Y");
  assert.match(created.name, /ชุดสี A/);
  const bom = approved(d, created.code);
  assert.equal(bom.revision, 1);
  assert.match(bom.note, /คัดลอกจาก DEMO-TP-01\(P\)-Y Rev\.1/);
  assert.deepEqual(bom.lines.map((line) => [line.childCode, line.qty]), approved(d, "DEMO-TP-01(P)-Y").lines.map((line) => [line.childCode, line.qty]));
  assert.notEqual(bom.lines, approved(d, "DEMO-TP-01(P)-Y").lines, "lines are copied, not shared");
  assert.equal(order.items.at(-1).fgCode, "DEMO-TP-01(P)-A");
  assert.ok(d.audit.some((entry) => entry.action === "สร้างสินค้าจากฐานรหัสเดียวกัน"));
  // ไม่ใส่แพ็กเกจ/ชุดสี = รหัสฐานล้วน ก็สร้างได้
  A.addOrderItem(d, { orderId: id, base: "DEMO-HL-24", qty: 2 }, ctx("planner"));
  assert.ok(A.helpers.itemOf(d, "DEMO-HL-24"));
  assert.equal(A.helpers.pickSibling(A.helpers.siblingsOf(d, "DEMO-TP-01"), "P", "A").code, "DEMO-TP-01(P)-A", "exact variant preferred");
  assert.equal(A.helpers.pickSibling(A.helpers.siblingsOf(d, "DEMO-TP-01"), "B", "A").code, "DEMO-TP-01(P)-A", "then same color set");
  rejects(() => A.addOrderItem(d, { orderId: id, base: "DEMO-TP-01", pkg: "P", colorSet: "Z", qty: 1 }, ctx("gr")), /ฝ่ายวางแผน/);
  // ระเบิดได้ด้วย BOM ที่คัดลอกมา
  assert.ok(A.explodeOrder(d, { orderId: id }, ctx("planner")) > 20);
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
  assert.equal(job.qtyDone, 100);
  A.reportJob(d, { jobId: job.id, qtyDone: 140 }, ctx("manager"));
  assert.equal(job.status, "done");
  assert.equal(job.reports.length, 2);
  rejects(() => A.reportJob(d, { jobId: job.id, qtyDone: 1 }, ctx("gr")), /เสร็จแล้ว/);
  rejects(() => A.setJobStatus(d, { jobId: job.id, status: "hold" }, ctx("gr")), /เสร็จแล้ว/);
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
  rejects(() => A.cancelOrder(d, { orderId }, ctx("planner")), /เสร็จแล้ว/);
  // ยกเลิกใบร่าง: งาน (ถ้ามี) หายไปด้วย
  A.releaseOrder(d, { orderId: "DEMO-26002" }, ctx("planner"));
  assert.ok(d.jobs.some((entry) => entry.orderId === "DEMO-26002"));
  A.cancelOrder(d, { orderId: "DEMO-26002", reason: "ลูกค้าเลื่อน" }, ctx("planner"));
  assert.equal(d.orders.find((entry) => entry.id === "DEMO-26002").status, "cancelled");
  assert.ok(!d.jobs.some((entry) => entry.orderId === "DEMO-26002"));
});

test("RB jobs link to a RubberFlow work order and the compound kilograms come from the rod weight", () => {
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
  assert.equal(rb.externalRef.kg, 3.1);
  assert.equal(rb.status, "in_progress");
  rejects(() => A.linkJobToRubberFlow(d, { jobId: rb.id, woId: "WO-69-0008" }, ctx("rb")), /ผูกกับ WO-69-0007 อยู่แล้ว/);
  // ใบที่มี WO ผูกอยู่ยกเลิกไม่ได้ และงานของใบที่ปิดแล้วเปลี่ยนสถานะไม่ได้
  const d2 = fresh();
  const rb2 = d2.jobs.find((job) => job.orderId === "DEMO-26002" || (job.orderId === "DEMO-26001" && job.dept === "RB" && job.qtyDone === 0));
  A.releaseOrder(d2, { orderId: "DEMO-26002" }, ctx("planner"));
  const job2 = d2.jobs.find((job) => job.orderId === "DEMO-26002" && job.dept === "RB");
  A.linkJobToRubberFlow(d2, { jobId: job2.id, woId: "WO-X" }, ctx("rb"));
  rejects(() => A.cancelOrder(d2, { orderId: "DEMO-26002" }, ctx("planner")), /WO-X/);
  assert.ok(rb2);
  const d3 = fresh();
  d3.orders.find((order) => order.id === "DEMO-26001").status = "completed";
  rejects(() => A.setJobStatus(d3, { jobId: d3.jobs.find((job) => job.orderId === "DEMO-26001" && job.status === "queued").id, status: "hold" }, ctx("manager")), /ไม่อยู่ในสถานะผลิต/);
});

test("importing a flat sheet adds items and approved revision-1 BOMs, merges legacy codes and never overwrites an approved BOM", () => {
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
  assert.deepEqual(stats, { itemsAdded: 4, itemsMerged: 2, bomsAdded: 2, bomsSkipped: 1 }, "PT-00320 already has an approved BOM → skipped; P-STK-01 and PT-00320 merged");
  assert.equal(summary, "ชิ้นงานใหม่ 4 (มีอยู่แล้ว 2) · BOM ใหม่ 2 ข้าม 1");
  assert.equal(d.items.length, itemsBefore + 4);
  const fg = approved(d, "IMP-01(P)-Y");
  assert.equal(fg.revision, 1);
  assert.match(fg.note, /test\.tsv/);
  assert.deepEqual(fg.lines.map((line) => [line.childCode, line.qty, line.producerDept]), [["P-STK-01", 2, "ST"], ["SE-IMP01-50-5-20", 4, "GR"], ["PT-00320", 1, "PT"]]);
  const se = approved(d, "SE-IMP01-50-5-20");
  assert.equal(se.lines[0].childCode, "RB-B0006-02-300-5-22");
  assert.ok(Math.abs(se.lines[0].qty - 1 / 28) < 1e-12);
  assert.deepEqual(A.helpers.itemOf(d, "RB-B0006-02-300-5-22").legacyCodes, ["RB-B0006-02- -300-5-22"]);
  assert.equal(A.helpers.itemOf(d, "RB-B0006-02-300-5-22").rubber.kgPerRoll, 0.6);
  assert.ok(d.compounds.some((compound) => compound.code === "B0006" && compound.recipeId === null));
  assert.equal(approved(d, "PT-00320").lines[0].qty, 0.02, "the existing approved PT BOM is untouched");
  assert.equal(A.helpers.itemOf(d, "PT-00320").name, "แกนตอปิโด ท่อดำ 150 ซม. (20 ก./ชิ้น)", "existing items keep their name");
  // ใบสั่งผลิตใช้สินค้าที่นำเข้าได้ทันที
  const day = (n) => new Date(NOW + n * DAY).setHours(0, 0, 0, 0);
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
  assert.match(bad.error.message, /เลขที่ PI/);
  assert.equal(store.data().orders.length, 2, "failed action leaves the state untouched");
  const ok = store.run("createOrder", { pi: "ST-1", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY });
  assert.equal(ok.result, "ST-1");
  assert.ok(store.isPersisted());
  assert.ok(JSON.parse(storage.get(storeApi.STATE_KEY)).orders.some((order) => order.id === "ST-1"));
  assert.ok(store.size() > 1000);
  const reloaded = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(reloaded.user().id, "B03");
  assert.ok(reloaded.data().orders.some((order) => order.id === "ST-1"));
  storage.set(storeApi.STATE_KEY, "{broken");
  const repaired = storeApi.createStore({ storage: fake, seed: fresh, actions: A, now: () => NOW });
  assert.equal(repaired.data().orders.length, 2, "corrupt storage → fresh seed");
  const noStorage = storeApi.createStore({ storage: { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() {} }, seed: fresh, actions: A, now: () => NOW });
  noStorage.setUser("B03");
  assert.equal(noStorage.run("createOrder", { pi: "M-1", customer: "x", country: "Thailand", orderedAt: NOW, whDue: NOW + DAY }).ok, true);
  assert.equal(noStorage.isPersisted(), false);
  assert.equal(storeApi.homeOf(user("gr")), "dashboard");
  assert.ok(storeApi.canSee(user("planner"), "import") && !storeApi.canSee(user("gr"), "import") && !storeApi.canSee(null, "items"));
});
