import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// ขั้นตอนรายแผนกของ PT / BG / PK แบบเดียวกับ GR และการส่งงาน PT / BG → PK · PK → WH (โรงงาน ขั้น 7 · 20261224010000_bom_dept_steps.sql)
// กฎ (modules/bom-rules.js) · คำสั่ง (modules/bom-actions.js) · store (modules/bom-store.js) · Supabase จำลองของ harness ต้องตอบรหัสเดียวกับฐานข้อมูล
// (pgTAP คู่กัน: supabase/tests/database/bom_dept_steps.test.sql) · GR ยังทำงานเหมือนเดิม (scripts/tests/bom-gr-module.test.mjs)
// ข้อมูลสาธิต (modules/bom-seed.js): งานแกน PT-00320 ของ DEMO-26001 บันทึกด้วยขั้นตอน PT-01 (14 ชิ้น) ส่งให้ PK 10 รอ PK รับ ·
// งานกระเป๋า BG-0092 ของ DEMO-26006 เย็บ 25 + 20 (เสีย 1) ส่งให้ PK 20 PK รับแล้ว · งาน PK ของ DEMO-26006 ประกอบ 15 → ใส่กระเป๋า 12 → บรรจุกล่อง 10 ส่งให้ WH 6 WH ยังไม่รับ
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const R = globalThis.MNP_BOM_RULES;
const A = globalThis.MNP_BOM_ACTIONS;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-11-23T10:00:00+07:00");
const DAY = 86400000;
const TODAY = "2026-11-23";
const fresh = () => seed.buildSeed(NOW);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const ptJobOf = (d) => d.jobs.find((job) => job.orderId === "DEMO-26001" && job.itemCode === "PT-00320");
const bgJobOf = (d) => d.jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "BG");
const pkJobOf = (d) => d.jobs.find((job) => job.orderId === "DEMO-26006" && job.dept === "PK" && job.kind === "FG");
const USERS = {
  planner: seed.USERS.find((row) => row.role === "planner"),
  gr: seed.USERS.find((row) => row.role === "gr"),
  grHead: { id: "GR-HEAD", role: "gr", dept: "GR", roleCode: "assistant_department_manager", name: "หัวหน้า GR ทดสอบ" },
  pt: seed.USERS.find((row) => row.role === "pt"),
  ptHead: { id: "PT-HEAD", role: "pt", dept: "PT", roleCode: "assistant_department_manager", name: "หัวหน้า PT ทดสอบ" },
  bg: seed.USERS.find((row) => row.role === "bg"),
  bgHead: { id: "BG-HEAD", role: "bg", dept: "BG", roleCode: "assistant_department_manager", name: "หัวหน้า BG ทดสอบ" },
  pk: { id: "PK-DEMO-1", role: "pk", dept: "PK", roleCode: "staff", name: "ปรีชา ทดลองบรรจุ" },
  pkHead: { id: "PK-HEAD", role: "pk", dept: "PK", roleCode: "assistant_department_manager", name: "หัวหน้า PK ทดสอบ" },
  wh: seed.USERS.find((row) => row.role === "wh"),
};
const ctx = (who, extra = {}) => ({ now: NOW, user: USERS[who], ...extra });

// ---------- กฎ ----------
test("rules: every department has its default steps and reasons; GR keeps its own; a new plan starts with all active main steps of the job's department", () => {
  const d = fresh();
  assert.deepEqual(R.STEP_DEPTS, ["GR", "PT", "BG", "PK"]);
  assert.deepEqual(R.grConfig({}, "PT").steps.map((step) => [step.code, step.name, step.kind]), [["PT-01", "ขึ้นรูป", "main"]]);
  assert.deepEqual(R.grConfig({}, "BG").steps.map((step) => [step.code, step.name]), [["BG-02", "เย็บ"]]);
  assert.deepEqual(R.grConfig({}, "PK").steps.map((step) => step.name), ["ประกอบ", "ใส่กระเป๋า", "บรรจุกล่อง"]);
  assert.equal(R.grConfig({}, "PK").reasons.at(-1), "อื่นๆ");
  assert.deepEqual(R.grConfig({}).steps.map((step) => step.code), R.GR_DEFAULT_CONFIG.steps.map((step) => step.code), "no department = GR, as before");
  assert.equal(R.grConfig({ grConfig: [{ key: "gr", steps: [{ code: "GR-01", name: "x", kind: "main", seq: 1, active: true }], reasons: ["a"], targets: [] }] }, "PT").stored, false, "a GR row (no dept) is not the PT config");
  assert.equal(R.grConfig({ grConfig: [{ key: "pt", dept: "PT", steps: [{ code: "PT-09", name: "ตัด", kind: "main", seq: 1, active: true }], reasons: ["a"], targets: [] }] }, "PT").steps[0].code, "PT-09");
  assert.deepEqual(R.grDefaultSteps(d, pkJobOf(d)).map((step) => step.code), ["PK-01", "PK-02", "PK-03"], "PK starts with its three main steps");
  assert.ok(R.deptStepCode("PK").test("PK-04") && !R.deptStepCode("PK").test("GR-04"));
  assert.deepEqual(R.stepWorkers(d, "PT").map((row) => row.id), ["B06", "PT-DEMO-2"]);
  assert.deepEqual(R.stepWorkers(d, "GR").map((row) => row.id), seed.GR_WORKERS.map((row) => row.id), "workers without a department are GR");
});

test("rules: the demo shows PT / BG / PK steps, the sends to PK and the send to WH; summaries per department", () => {
  const d = fresh();
  const pt = ptJobOf(d);
  assert.deepEqual([pt.qtyDone, pt.status, R.grPlanOf(d, pt.id).steps.map((step) => step.code)], [14, "done", ["PT-01"]], "PT reported through its step");
  assert.deepEqual(R.deptHandoverSummary(d, pt), { dept: "PT", to: "PK", rows: R.grHandoverSummary(d, pt).rows, sent: 10, received: 0, pending: 10, waiting: 4 }, "10 sent and waiting at PK, 4 still at PT");
  const bg = bgJobOf(d);
  assert.deepEqual([bg.qtyDone, bg.qtyReject], [45, 1]);
  assert.deepEqual([R.deptHandoverSummary(d, bg).received, R.deptHandoverSummary(d, bg).waiting], [20, 25]);
  const pk = pkJobOf(d);
  assert.deepEqual(R.grJobProgress(d, pk).steps.map((step) => [step.name, step.good]), [["ประกอบ", 15], ["ใส่กระเป๋า", 12], ["บรรจุกล่อง", 10]]);
  assert.deepEqual([pk.qtyDone, pk.qtyReject], [10, 1], "good = the last step (boxing)");
  const toWh = R.deptHandoverSummary(d, pk);
  assert.deepEqual([toWh.to, toWh.sent, toWh.received, toWh.pending, toWh.waiting], ["WH", 6, 0, 6, 4]);
  assert.deepEqual(R.pkToWhPosition(d, "DEMO-26006", pk.itemCode), { pkDone: 10, sent: 6, received: 0, waitingAtWh: 6, waitingAtPk: 4 });
  const order = d.orders.find((row) => row.id === "DEMO-26006");
  assert.deepEqual(R.fgPosition(d, order).products.map((product) => [product.pkDone, product.pkSent, product.receivable]), [[10, 6, 6]], "WH may receive what PK sent");
  assert.equal(R.grSummary(d, { dept: "PK" }).records.length, 3);
  assert.equal(R.grSummary(d, { dept: "BG" }).byReason[0].key, "ฝีเข็มไม่สวย/หลุด");
  assert.equal(R.recordDept(d, d.grRecords.find((row) => row.jobId === pt.id)), "PT");
});

test("rules: PK readiness lists every GR / PT / BG job of the order and the purchased parts ST issues to PK; ready only when everything arrived", () => {
  const d = fresh();
  const order = d.orders.find((row) => row.id === "DEMO-26006");
  const ready = R.pkReadiness(d, order);
  assert.deepEqual(ready.sources.map((row) => [row.dept, row.received, row.ready]), [["GR", 0, false], ["BG", 20, false]], "GR then BG in flow order");
  assert.ok(ready.parts.length > 0 && ready.parts.every((row) => R.partReceivers(order).get(row.itemCode).includes("PK")), "only parts that go to PK");
  assert.equal(ready.ready, false);
  // ทุกแหล่งได้ครบ = พร้อมประกอบ
  for (const row of ready.sources) {
    d.grHandovers.push({ id: `all-${row.job.id}`, jobId: row.job.id, orderId: order.id, itemCode: row.itemCode, qty: row.needed, status: "received", fromDept: row.dept, toDept: "PK" });
  }
  for (const row of ready.parts) Object.assign(row.job, { qtyDone: row.needed, status: "done" });
  const after = R.pkReadiness(d, order);
  assert.equal(after.ready, true);
  assert.equal(after.readyCount, after.total);
  assert.equal(R.pkReadiness(d, { id: "NONE", explosion: [] }).ready, true, "nothing to wait for = ready");
});

test("rules: materials of a PT / BG job are the purchased parts of the order that go to that department, with what ST issued and when", () => {
  const d = fresh();
  const pt = ptJobOf(d);
  const [pellet] = R.deptMaterials(d, pt);
  assert.equal(pellet.itemCode, "P-PEL-BK");
  assert.deepEqual([pellet.issued, pellet.lastAt], [0, null], "nothing issued yet");
  const part = d.jobs.find((job) => job.orderId === "DEMO-26001" && job.dept === "ST" && job.itemCode === "P-PEL-BK");
  part.qtyDone = 0.2;
  d.stockMoves.push({ id: "m-pel", itemCode: "P-PEL-BK", kind: "issue", qty: -0.2, balance: 4.8, ref: "DEMO-26001", at: NOW - DAY, by: "สมศักดิ์ แก้วใส", note: "" });
  const [issued] = R.deptMaterials(d, pt);
  assert.deepEqual([issued.issued, issued.lastAt, issued.lastBy, issued.moves.length], [0.2, NOW - DAY, "สมศักดิ์ แก้วใส", 1]);
  const bgParts = R.deptMaterials(d, bgJobOf(d)).map((row) => row.itemCode);
  assert.deepEqual(bgParts.sort(), ["P-FAB-BL", "P-ROPE-01", "P-ZIP-05"], "the BG job gets fabric, zip and rope");
});

// ---------- คำสั่ง (โหมดในเครื่อง) ----------
test("actions: the department config — the head of that department or a planner; step codes start with the department; GR rows stay GR", () => {
  const d = fresh();
  const body = { dept: "PT", steps: R.grConfig(d, "PT").steps, reasons: R.grConfig(d, "PT").reasons, targets: [] };
  rejects(() => A.saveGrConfig(d, body, ctx("pt")), /หัวหน้าแผนก PT หรือฝ่ายวางแผน/);
  rejects(() => A.saveGrConfig(d, body, ctx("grHead")), /หัวหน้าแผนก PT/);
  rejects(() => A.saveGrConfig(d, { ...body, steps: [{ code: "GR-01", name: "รีด", kind: "main" }] }, ctx("ptHead")), /ต้องเป็นรูป PT-/);
  rejects(() => A.saveGrConfig(d, { ...body, dept: "RB" }, ctx("planner")), /ไม่มีขั้นตอน/);
  rejects(() => A.saveGrConfig(d, { ...body, steps: [] }, ctx("ptHead")), /อย่างน้อย 1 ขั้นตอน/);
  rejects(() => A.saveGrConfig(d, { ...body, steps: [{ code: "PT-09", name: "ตัด", kind: "main" }] }, ctx("ptHead")), /ขึ้นรูป.*ลบไม่ได้/, "PT-01 has a record and a plan");
  const out = A.saveGrConfig(d, { ...body, steps: [...body.steps, { name: "ตัดแต่ง", kind: "side" }] }, ctx("ptHead"));
  assert.deepEqual(out.request[0].dept, "PT");
  assert.equal(R.grConfig(d, "PT").steps.at(-1).code, "PT-02", "the next free PT code");
  assert.deepEqual(d.grConfig.map((row) => R.configDept(row)), ["GR", "PT"], "GR first, one row per department");
  const gr = A.saveGrConfig(d, { steps: R.grConfig(d).steps, reasons: R.grConfig(d).reasons, targets: R.grConfig(d).targets }, ctx("grHead"));
  assert.equal("dept" in gr.request[0], false, "the GR request keeps its old shape");
  rejects(() => A.saveGrConfig(d, { steps: R.grConfig(d).steps, reasons: R.grConfig(d).reasons }, ctx("ptHead")), /หัวหน้าแผนก GR/);
});

test("actions: job steps and daily records follow the job's department — own work of today for staff, any day with a reason for the head", () => {
  const d = fresh();
  const pt = ptJobOf(d);
  const bg = bgJobOf(d);
  rejects(() => A.setGrJobSteps(d, { jobId: bg.id, steps: [{ code: "BG-02", qtyTarget: 1 }] }, ctx("ptHead")), /ไม่ใช่งานของแผนก PT/);
  rejects(() => A.setGrJobSteps(d, { jobId: bg.id, steps: [{ code: "GR-04", qtyTarget: 1 }] }, ctx("bgHead")), /ไม่พบขั้นตอน/, "a BG job takes steps of the BG config only");
  rejects(() => A.setGrJobSteps(d, { jobId: pt.id, steps: [{ code: "PT-01", qtyTarget: 1 }] }, ctx("ptHead")), /เสร็จแล้ว/, "a job done is not re-planned");
  const base = { jobId: pt.id, stepCode: "PT-01", hours: 2, good: 3 };
  rejects(() => A.addGrRecord(d, base, ctx("bg")), /ไม่ใช่งานของแผนก BG/, "another department's worker");
  rejects(() => A.addGrRecord(d, base, ctx("gr")), /ไม่ใช่งานของแผนก GR/);
  rejects(() => A.addGrRecord(d, { ...base, workerId: "PT-DEMO-2" }, ctx("pt")), /ผลของตัวเอง/);
  rejects(() => A.addGrRecord(d, { ...base, reject: 1, reason: "กาวไม่ติด" }, ctx("pt")), /ไม่อยู่ในรายการของแผนก PT/);
  rejects(() => A.addGrRecord(d, { ...base, workerId: "B07" }, ctx("ptHead")), /ผู้ทำต้องเป็นพนักงานแผนก PT/);
  const own = A.addGrRecord(d, { ...base, reject: 1, reason: "ขึ้นรูปไม่เต็ม" }, ctx("pt"));
  assert.deepEqual(own.request, [{ id: own.id, jobId: pt.id, stepCode: "PT-01", workDate: TODAY, workerId: "B06", hours: 2, people: 1, good: 3, reject: 1, reason: "ขึ้นรูปไม่เต็ม", note: "" }]);
  assert.deepEqual([pt.qtyDone, pt.qtyReject], [17, 1]);
  assert.match(pt.reports.at(-1).note, /^PT บันทึกผล PT-01/);
  A.editGrRecord(d, { recordId: own.id, good: 2, editReason: "นับผิด" }, ctx("pt"));
  assert.equal(pt.qtyDone, 16, "staff edit their own record on the day they recorded it");
  rejects(() => A.editGrRecord(d, { recordId: own.id, good: 1, editReason: "นับผิด" }, { ...ctx("pt"), now: NOW + DAY }), /เฉพาะวันที่บันทึก ให้หัวหน้าแผนก PT/);
  rejects(() => A.editGrRecord(d, { recordId: own.id, good: 1 }, { ...ctx("ptHead"), now: NOW + DAY }), /เหตุผลที่แก้/);
  A.editGrRecord(d, { recordId: own.id, good: 1, editReason: "นับใหม่" }, { ...ctx("ptHead"), now: NOW + DAY });
  assert.equal(pt.qtyDone, 15, "the head edits any day with a reason");
  assert.equal(d.grRecords.find((row) => row.id === own.id).edits.at(-1).reason, "นับใหม่");
  rejects(() => A.reportJob(d, { jobId: pt.id, qtyDone: 1 }, ctx("pt")), /บันทึกผลรายวัน/, "a planned PT job takes no old report");
  // PK สามขั้น: พนักงาน PK บันทึกขั้นของตัวเอง ยอดดี = ขั้นสุดท้าย
  const pk = pkJobOf(d);
  A.addGrRecord(d, { jobId: pk.id, stepCode: "PK-03", hours: 1, good: 2 }, ctx("pk"));
  assert.equal(pk.qtyDone, 12);
  rejects(() => A.addGrRecord(d, { jobId: pk.id, stepCode: "PK-01", hours: 1, good: 2 }, ctx("pt")), /ไม่ใช่งานของแผนก PT/);
});

test("actions: PT / BG send to PK — the head of the job's department, never above the good pieces; PK receives the whole send; cancel and reverse as for GR", () => {
  const d = fresh();
  const pt = ptJobOf(d);
  rejects(() => A.sendToPk(d, { jobId: pt.id, qty: 1 }, ctx("pt")), /หัวหน้าแผนก PT หรือฝ่ายวางแผน/);
  rejects(() => A.sendToPk(d, { jobId: pt.id, qty: 5 }, ctx("ptHead")), /ไม่เกินของดีที่ยังไม่ได้ส่ง 4/);
  rejects(() => A.sendToPk(d, { jobId: pt.id, qty: 1.5 }, ctx("ptHead")), /จำนวนเต็ม/);
  rejects(() => A.sendToPk(d, { jobId: bgJobOf(d).id, qty: 1 }, ctx("ptHead")), /หัวหน้าแผนก BG/);
  rejects(() => A.sendToPk(d, { jobId: pkJobOf(d).id, qty: 1 }, ctx("planner")), /ไม่ใช่งานที่ส่งให้ PK/);
  rejects(() => A.sendGrToPk(d, { jobId: pt.id, qty: 1 }, ctx("planner")), /ไม่ใช่งานของแผนก GR/, "the GR action stays GR only");
  const sent = A.sendToPk(d, { jobId: pt.id, qty: 4, note: "รอบสอง" }, ctx("ptHead"));
  assert.deepEqual(sent.request, [{ id: sent.id, jobId: pt.id, qty: 4, note: "รอบสอง" }]);
  const row = d.grHandovers.find((entry) => entry.id === sent.id);
  assert.deepEqual([row.fromDept, row.toDept, row.status], ["PT", "PK", "sent"]);
  rejects(() => A.receiveAtPk(d, { handoverId: sent.id }, ctx("gr")), /แผนก PK หรือฝ่ายวางแผน/);
  assert.deepEqual(A.receiveAtPk(d, { handoverId: sent.id }, ctx("pk")).request, [{ id: sent.id }]);
  rejects(() => A.cancelHandover(d, { handoverId: sent.id, reason: "นับผิด" }, ctx("ptHead")), /หัวหน้าแผนก PK/, "the sender cannot reverse PK's receipt");
  assert.equal(A.cancelHandover(d, { handoverId: sent.id, reason: "นับผิด" }, ctx("pkHead")).status, "sent", "the PK head reverses the receipt");
  rejects(() => A.cancelHandover(d, { handoverId: sent.id, reason: "ส่งผิด" }, ctx("pk")), /หัวหน้าแผนก PT/);
  assert.equal(A.cancelHandover(d, { handoverId: sent.id, reason: "ส่งผิด" }, ctx("ptHead")).status, "cancelled");
  // ส่งแล้วยกเลิกผลจนยอดดีต่ำกว่าที่ส่งไม่ได้ (10 ส่งแล้ว รอ PK รับ)
  const first = d.grRecords.find((entry) => entry.jobId === pt.id);
  rejects(() => A.voidGrRecord(d, { recordId: first.id, reason: "บันทึกผิด" }, ctx("ptHead")), /ต่ำกว่าที่ส่งให้ PK แล้ว 10/);
  // GR receive action takes a PT send too
  const pending = d.grHandovers.find((entry) => entry.jobId === pt.id && entry.status === "sent");
  A.receiveGrAtPk(d, { handoverId: pending.id }, ctx("pk"));
  assert.equal(pending.status, "received");
  // BG
  const bg = bgJobOf(d);
  const bgSend = A.sendToPk(d, { jobId: bg.id, qty: 25 }, ctx("bgHead"));
  assert.equal(R.deptHandoverSummary(d, bg).waiting, 0);
  assert.equal(d.grHandovers.find((entry) => entry.id === bgSend.id).fromDept, "BG");
});

test("actions: PK sends to WH (head or planner, up to the PK good pieces); WH receives no more than was sent; a send WH received cannot be cancelled", () => {
  const d = fresh();
  const pk = pkJobOf(d);
  const order = d.orders.find((row) => row.id === "DEMO-26006");
  rejects(() => A.sendPkToWh(d, { jobId: pk.id, qty: 1 }, ctx("pk")), /หัวหน้าแผนก PK หรือฝ่ายวางแผน/);
  rejects(() => A.sendPkToWh(d, { jobId: pk.id, qty: 1 }, ctx("ptHead")), /หัวหน้าแผนก PK/);
  rejects(() => A.sendPkToWh(d, { jobId: ptJobOf(d).id, qty: 1 }, ctx("pkHead")), /ไม่ใช่งานสินค้าสำเร็จรูปของแผนก PK/);
  rejects(() => A.sendPkToWh(d, { jobId: pk.id, qty: 5 }, ctx("pkHead")), /ไม่เกินของดีที่ยังไม่ได้ส่ง 4/);
  // WH: รับได้ไม่เกินที่ส่ง (6) แม้ PK ทำแล้ว 10
  rejects(() => A.receiveFg(d, { orderId: order.id, lines: [{ fgCode: pk.itemCode, qty: 7 }] }, ctx("wh")), /รับได้อีกไม่เกิน 6 \(PK ส่งให้ WH แล้ว 6/);
  A.receiveFg(d, { orderId: order.id, lines: [{ fgCode: pk.itemCode, qty: 6 }] }, ctx("wh"));
  assert.equal(R.fgPosition(d, order).products[0].receivable, 0);
  const firstSend = d.grHandovers.find((row) => row.jobId === pk.id && row.toDept === "WH");
  rejects(() => A.cancelPkToWh(d, { handoverId: firstSend.id, reason: "ส่งผิด" }, ctx("pkHead")), /WH รับเข้าคลังแล้ว 6/);
  rejects(() => A.cancelHandover(d, { handoverId: firstSend.id, reason: "ส่งผิด" }, ctx("planner")), /ส่งสินค้าให้ WH/, "the PK hand-over action does not take a send to WH");
  rejects(() => A.receiveAtPk(d, { handoverId: firstSend.id }, ctx("pk")), /ส่งสินค้าให้ WH/);
  const more = A.sendPkToWh(d, { jobId: pk.id, qty: 2.5, note: "เศษกล่อง" }, ctx("pkHead"));
  assert.deepEqual(more.request, [{ id: more.id, jobId: pk.id, qty: 2.5, note: "เศษกล่อง" }], "a send to WH may carry a fraction");
  assert.equal(R.fgPosition(d, order).products[0].receivable, 2.5);
  rejects(() => A.cancelPkToWh(d, { handoverId: more.id, reason: "ส่งผิด" }, ctx("pk")), /หัวหน้าแผนก PK/);
  rejects(() => A.cancelPkToWh(d, { handoverId: more.id, reason: "ab" }, ctx("pkHead")), /อย่างน้อย 3/);
  assert.equal(A.cancelPkToWh(d, { handoverId: more.id, reason: "ยังไม่ส่งจริง" }, ctx("pkHead")).status, "cancelled");
  rejects(() => A.cancelPkToWh(d, { handoverId: more.id, reason: "ยังไม่ส่งจริง" }, ctx("pkHead")), /ถูกยกเลิกแล้ว/);
  rejects(() => A.voidGrRecord(d, { recordId: d.grRecords.find((row) => row.jobId === pk.id && row.stepCode === "PK-03").id, reason: "บันทึกผิด" }, ctx("pkHead")),
    /ต่ำกว่าที่ส่งให้ WH แล้ว 6/, "the PK good never drops below what was sent to WH");
  // ปิดรับไม่ครบ: ที่ PK ทำแต่ยังไม่ส่ง = ยังไม่ได้รับเข้าคลัง
  for (const job of d.jobs.filter((row) => row.orderId === order.id && !(row.dept === "ST" && row.kind === "PURCHASED"))) job.status = "done";
  rejects(() => A.closeOrderShort(d, { orderId: order.id, note: "ลูกค้ารับเท่าที่มี" }, ctx("wh")), /ยังไม่ได้รับเข้าคลัง/);
});

test("actions: database mode returns one request row per hand-over action and the store sends it in the hand-over section; the error codes keep Thai messages", () => {
  const d = fresh();
  const out = A.sendToPk(d, { jobId: ptJobOf(d).id, qty: 1 }, ctx("planner", { remote: true }));
  assert.equal(out.section, "grHandovers");
  assert.deepEqual(storeApi.DEPT_ACTIONS, { sendToPk: "grHandovers", receiveAtPk: "grHandovers", cancelHandover: "grHandovers", sendPkToWh: "grHandovers", cancelPkToWh: "grHandovers" });
  assert.equal(storeApi.GR_ACTIONS.sendGrToPk, "grHandovers", "the GR map is unchanged");
  for (const code of ["BOM_INVALID_GR", "BOM_GR_EXCEEDS", "BOM_FG_EXCEEDS"]) assert.doesNotMatch(storeApi.mapRemoteError({ code }).message, /BOM_/);
  assert.match(storeApi.mapRemoteError({ code: "BOM_FG_EXCEEDS" }).message, /PK ส่งให้ WH/);
  assert.deepEqual(A.helpers.STEP_DEPTS, ["GR", "PT", "BG", "PK"]);
  assert.deepEqual([A.helpers.canDeptLead(USERS.ptHead, "PT"), A.helpers.canDeptLead(USERS.ptHead, "BG"), A.helpers.canDeptLead(USERS.planner, "BG"), A.helpers.canSendPkToWh(USERS.pk), A.helpers.canReceiveAtPk(USERS.pk)],
    [true, false, true, false, true]);
});

// ---------- Supabase จำลองของ harness ----------
const BOM_KEY = "mnp-harness-bom-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves", "grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers"];
function mockScene() {
  const data = fresh();
  const master = { version: 1, epoch: "ds-e1", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(LISTS.map((list) => [list, data[list] ?? []])) };
  const storage = memoryStorage();
  storage.setItem(BOM_KEY, JSON.stringify(master));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const call = async (name, args) => { const { data: out, error } = await mock.client.rpc(name, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return out; };
  const save = async (persona, action, changes) => {
    await call("app_sandbox_enter", { p_persona_id: persona });
    const version = (await call("app_bom_master")).version;
    const { data: out, error } = await mock.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: action, p_audit: [] });
    return error ? { code: error.code } : { data: out };
  };
  const ho = (persona, action, row) => save(persona, action, { grHandovers: { upsert: [row] } });
  const rec = (persona, action, row) => save(persona, action, { grRecords: { upsert: [row] } });
  const fg = (persona, orderId, fgCode, qty) => save(persona, "receiveFg", { fgMoves: { upsert: [{ orderId, kind: "receive", lines: [{ fgCode, qty }] }] } });
  const view = () => call("app_bom_master");
  return { mock, call, save, ho, rec, fg, view, data };
}
const uid = (n) => `7d000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const codeOf = async (promise) => (await promise).code ?? null;

test("mock: heads of PT / BG / PK are personas; the worker list carries the department; records follow the job's department", async () => {
  const s = mockScene();
  const status = await s.call("app_sandbox_status");
  assert.deepEqual(status.personas.filter((row) => ["persona-pth", "persona-bgh", "persona-pkh"].includes(row.id)).map((row) => [row.employee_no, row.department.code, row.role.code]),
    [["T-PTH", "PT", "department_manager"], ["T-BGH", "BG", "department_manager"], ["T-PKH", "PK", "department_manager"]]);
  const view = await s.view();
  assert.deepEqual(view.grWorkers.filter((row) => row.dept === "PT").map((row) => row.id).sort(), ["persona-pt", "persona-pth"]);
  const pt = ptJobOf(s.data);
  const row = (n, extra = {}) => ({ id: uid(n), jobId: pt.id, stepCode: "PT-01", workDate: TODAY, workerId: "persona-pt", hours: 2, people: 1, good: 3, reject: 0, reason: "", note: "", ...extra });
  assert.equal(await codeOf(s.rec("persona-bg", "addGrRecord", row(1, { workerId: "persona-bg" }))), "BOM_FORBIDDEN", "BG staff cannot record on a PT job");
  assert.equal(await codeOf(s.rec("persona-gr", "addGrRecord", row(1, { workerId: "persona-gr" }))), "BOM_FORBIDDEN", "nor GR staff");
  assert.equal(await codeOf(s.rec("persona-pt", "addGrRecord", row(1, { workerId: "persona-pth" }))), "BOM_FORBIDDEN", "PT staff record their own work");
  assert.equal(await codeOf(s.rec("persona-pt", "addGrRecord", row(1, { reject: 1, reason: "กาวไม่ติด" }))), "BOM_INVALID_GR", "the reason comes from the PT list");
  assert.equal(await codeOf(s.rec("persona-pth", "addGrRecord", row(1, { workerId: "persona-bg" }))), "BOM_INVALID_GR", "the worker must be in PT");
  assert.ok((await s.rec("persona-pt", "addGrRecord", row(1, { reject: 1, reason: "ขึ้นรูปไม่เต็ม" }))).data, "PT staff record their own work");
  const job = (await s.view()).jobs.find((entry) => entry.id === pt.id);
  assert.deepEqual([job.qtyDone, job.qtyReject], [17, 1]);
  assert.equal(await codeOf(s.save("persona-pth", "saveGrConfig", { grConfig: { upsert: [{ dept: "PT", steps: [{ code: "GR-01", name: "x", kind: "main", seq: 1, active: true }], reasons: ["a"] }] } })), "BOM_INVALID_GR");
  assert.equal(await codeOf(s.save("persona-pt", "saveGrConfig", { grConfig: { upsert: [{ dept: "PT", steps: R.grConfig({}, "PT").steps, reasons: ["a"] }] } })), "BOM_FORBIDDEN");
  assert.ok((await s.save("persona-pth", "saveGrConfig", { grConfig: { upsert: [{ dept: "PT", steps: R.grConfig({}, "PT").steps, reasons: R.grConfig({}, "PT").reasons }] } })).data);
  assert.deepEqual((await s.view()).grConfig.map((entry) => entry.dept ?? "GR"), ["GR", "PT"], "one row per department, GR first");
  assert.equal(await codeOf(s.save("persona-grh", "setGrJobSteps", { grPlans: { upsert: [{ jobId: bgJobOf(s.data).id, steps: [{ code: "BG-02", qtyTarget: 1 }] }] } })), "BOM_FORBIDDEN",
    "the GR head cannot set the steps of a BG job");
});

test("mock: sends to PK and to WH, receipts, cancels and the WH receive cap answer with the database codes", async () => {
  const s = mockScene();
  const pt = ptJobOf(s.data);
  const pk = pkJobOf(s.data);
  const send = (n, jobId, qty) => ({ id: uid(100 + n), jobId, qty, note: "" });
  assert.equal(await codeOf(s.ho("persona-pt", "sendToPk", send(1, pt.id, 1))), "BOM_FORBIDDEN", "PT staff cannot send");
  assert.equal(await codeOf(s.ho("persona-pth", "sendToPk", send(1, pt.id, 5))), "BOM_GR_EXCEEDS", "14 good, 10 sent");
  assert.equal(await codeOf(s.ho("persona-pth", "sendToPk", send(1, pt.id, 1.5))), "BOM_INVALID_GR");
  assert.equal(await codeOf(s.ho("persona-grh", "sendToPk", send(1, pt.id, 1))), "BOM_FORBIDDEN", "the GR head cannot send a PT job");
  assert.equal(await codeOf(s.ho("persona-grh", "sendGrToPk", send(1, pt.id, 1))), "BOM_INVALID_GR", "sendGrToPk takes GR jobs only");
  assert.ok((await s.ho("persona-pth", "sendToPk", send(1, pt.id, 4))).data, "the PT head sends");
  let row = (await s.view()).grHandovers.find((entry) => entry.id === uid(101));
  assert.deepEqual([row.fromDept, row.toDept, row.status], ["PT", "PK", "sent"]);
  assert.equal(await codeOf(s.ho("persona-gr", "receiveAtPk", { id: uid(101) })), "BOM_FORBIDDEN", "GR staff cannot receive");
  assert.ok((await s.ho("persona-pk", "receiveAtPk", { id: uid(101) })).data, "PK staff receive the whole send");
  // หัวหน้าแผนกใน harness เป็นผู้จัดการแผนก (อยู่ในกลุ่มวางแผนเหมือนฐานข้อมูล) · หัวหน้าที่ไม่ใช่กลุ่มวางแผนตรวจใน pgTAP (ผู้ช่วยผู้จัดการแผนก)
  assert.equal(await codeOf(s.ho("persona-pt", "cancelHandover", { id: uid(101), reason: "นับผิด" })), "BOM_FORBIDDEN", "PT staff cannot reverse PK's receipt");
  assert.equal(await codeOf(s.ho("persona-pk", "cancelHandover", { id: uid(101), reason: "นับผิด" })), "BOM_FORBIDDEN", "nor PK staff");
  assert.ok((await s.ho("persona-pkh", "cancelHandover", { id: uid(101), reason: "นับผิด" })).data, "the PK head reverses it");
  assert.ok((await s.ho("persona-pth", "cancelHandover", { id: uid(101), reason: "ส่งผิด" })).data, "and the PT head cancels the unreceived send");
  // PK → WH (PK ทำแล้ว 10 ส่ง 6)
  assert.equal(await codeOf(s.ho("persona-pk", "sendPkToWh", send(2, pk.id, 1))), "BOM_FORBIDDEN", "PK staff cannot send to WH");
  assert.equal(await codeOf(s.ho("persona-pkh", "sendPkToWh", send(2, pk.id, 5))), "BOM_GR_EXCEEDS");
  assert.equal(await codeOf(s.ho("persona-pkh", "sendPkToWh", send(2, pt.id, 1))), "BOM_INVALID_GR", "only a PK finished-goods job");
  assert.equal(await codeOf(s.fg("persona-wh", "DEMO-26006", pk.itemCode, 7)), "BOM_FG_EXCEEDS", "WH receives no more than PK sent (6)");
  assert.ok((await s.fg("persona-wh", "DEMO-26006", pk.itemCode, 6)).data, "WH receives what was sent");
  const demoSend = (await s.view()).grHandovers.find((entry) => entry.jobId === pk.id && entry.toDept === "WH");
  assert.equal(await codeOf(s.ho("persona-pkh", "cancelPkToWh", { id: demoSend.id, reason: "ส่งผิด" })), "BOM_FG_EXCEEDS", "a received send cannot be cancelled");
  assert.equal(await codeOf(s.ho("persona-pk", "receiveAtPk", { id: demoSend.id })), "BOM_INVALID_GR", "a send to WH is not received at PK");
  assert.ok((await s.ho("persona-pkh", "sendPkToWh", send(3, pk.id, 2.5))).data, "a fraction goes to WH");
  assert.equal(await codeOf(s.ho("persona-pk", "cancelPkToWh", { id: uid(103), reason: "ส่งผิด" })), "BOM_FORBIDDEN");
  assert.ok((await s.ho("persona-pkh", "cancelPkToWh", { id: uid(103), reason: "ยังไม่ส่งจริง" })).data, "the unreceived part is cancelled");
  assert.equal(await codeOf(s.ho("persona-pkh", "cancelPkToWh", { id: uid(103), reason: "ยังไม่ส่งจริง" })), "BOM_INVALID_TRANSITION");
  const pkRecord = (await s.view()).grRecords.find((entry) => entry.jobId === pk.id && entry.stepCode === "PK-03");
  assert.equal(await codeOf(s.rec("persona-pkh", "voidGrRecord", { id: pkRecord.id, reason: "บันทึกผิด" })), "BOM_GR_EXCEEDS", "PK good never drops below what went to WH");
});

test("mock and actions agree: the same refusals for the same cases", async () => {
  const s = mockScene();
  const d = fresh();
  const pt = ptJobOf(d);
  const pk = pkJobOf(d);
  const cases = [
    ["PT staff send", () => A.sendToPk(d, { jobId: pt.id, qty: 1 }, ctx("pt")), () => s.ho("persona-pt", "sendToPk", { id: uid(201), jobId: pt.id, qty: 1, note: "" })],
    ["over the good", () => A.sendToPk(d, { jobId: pt.id, qty: 5 }, ctx("planner")), () => s.ho("persona-pp", "sendToPk", { id: uid(202), jobId: pt.id, qty: 5, note: "" })],
    ["PK staff to WH", () => A.sendPkToWh(d, { jobId: pk.id, qty: 1 }, ctx("pk")), () => s.ho("persona-pk", "sendPkToWh", { id: uid(203), jobId: pk.id, qty: 1, note: "" })],
    ["WH over the send", () => A.receiveFg(d, { orderId: "DEMO-26006", lines: [{ fgCode: pk.itemCode, qty: 7 }] }, ctx("wh")), () => s.fg("persona-wh", "DEMO-26006", pk.itemCode, 7)],
  ];
  for (const [label, local, remote] of cases) {
    assert.throws(local, Error, `${label}: the page refuses`);
    assert.ok(await codeOf(remote()), `${label}: the mock refuses too`);
  }
  assert.ok((await s.ho("persona-pp", "sendToPk", { id: uid(204), jobId: pt.id, qty: 4, note: "" })).data, "the planner sends what is left");
  A.sendToPk(d, { jobId: pt.id, qty: 4 }, ctx("planner"));
});

test("mock: the store round trip — a PK head sends to WH through the page store and only the hand-over section travels", async () => {
  const s = mockScene();
  await s.call("app_sandbox_enter", { p_persona_id: "persona-pkh" });
  const status = await s.call("app_sandbox_status");
  const persona = status.personas.find((row) => row.id === "persona-pkh");
  const sent = [];
  const remote = {
    load: () => s.call("app_bom_master"),
    save: (changes, baseVersion, action, audit, epoch) => { sent.push({ changes, action }); return s.call("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }); },
    since: (version) => s.call("app_bom_master_since", { p_version: version }),
  };
  const store = storeApi.createStore({ actions: A, now: () => NOW, remote, persona: () => storeApi.personaUser({ ...persona, isSandbox: true }) });
  await store.ensureLoaded();
  const pk = pkJobOf(store.data());
  const run = store.run("sendPkToWh", { jobId: pk.id, qty: 4 });
  assert.equal(run.ok, true, run.error?.message);
  assert.equal((await run.saving).ok, true);
  assert.deepEqual(Object.keys(sent[0].changes), ["grHandovers"], "only the request section is sent");
  assert.equal(sent[0].action, "sendPkToWh");
  const data = store.data();
  assert.equal(data.grHandovers.filter((row) => row.id === run.result.id).length, 1, "the send arrives once with the id the page gave it");
  assert.equal(R.pkToWhPosition(data, "DEMO-26006", pk.itemCode).sent, 10);
});
