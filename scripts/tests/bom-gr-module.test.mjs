import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// แปรรูปยาง GR (โรงงาน ขั้น 2 · 20261214010000_bom_gr_module.sql): กฎ (modules/bom-rules.js) · คำสั่ง (modules/bom-actions.js) · store (modules/bom-store.js)
// และ Supabase จำลองของ harness (scripts/pilot-harness-mock.mjs) ต้องตอบรหัสเดียวกับฐานข้อมูล (pgTAP คู่กัน: supabase/tests/database/bom_gr_module.test.sql)
// ข้อมูลสาธิต (modules/bom-seed.js addGrDemo): งาน SE-HL24-YE03-400-19-30 ของใบ DEMO-26001 (ต้องทำ 120) ตั้งขั้นตอน ตัดยาง → ทากาว → เจียร์ → เจาะ มีผลสี่วัน
// ยอดดี 65 (ขั้นเจาะ) เสีย 6 · ส่งให้ PK 30 (รับแล้ว) + 25 (รอ PK รับ) · คำขอเบิก RB-DM02-02-YE03-204-19-34 × 10 ยังเปิด · งานลูกตอปิโดยังไม่มีขั้นตอน
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
globalThis.MNP_BOM_ACTIONS = require("../../modules/bom-actions.js");
const R = globalThis.MNP_BOM_RULES;
const A = globalThis.MNP_BOM_ACTIONS;
const seed = require("../../modules/bom-seed.js");
const storeApi = require("../../modules/bom-store.js");

const NOW = Date.parse("2026-11-23T10:00:00+07:00");
const TODAY = "2026-11-23";
const HL = "SE-HL24-YE03-400-19-30";
const TP = "SE-TP01-OR01-100-18-65";
const fresh = () => seed.buildSeed(NOW);
const jobOf = (d, itemCode, orderId = "DEMO-26001") => d.jobs.find((job) => job.orderId === orderId && job.itemCode === itemCode);
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });
const USERS = {
  gr: seed.USERS.find((row) => row.role === "gr"),
  head: { id: "GR-HEAD", role: "gr", dept: "GR", roleCode: "assistant_department_manager", name: "หัวหน้า GR ทดสอบ" },
  planner: seed.USERS.find((row) => row.role === "planner"),
  rb: seed.USERS.find((row) => row.role === "rb"),
  pk: { id: "PK-1", role: "pk", dept: "PK", roleCode: "staff", name: "พนักงาน PK ทดสอบ" },
  pkHead: { id: "PK-HEAD", role: "pk", dept: "PK", roleCode: "assistant_department_manager", name: "หัวหน้า PK ทดสอบ" },
};
const ctx = (who, extra = {}) => ({ now: NOW, user: USERS[who], ...extra });

// ---------- กฎ ----------
test("rules: the default config, the job steps (all 9 main steps for every job), the job totals, the hand-over summary and the target figures", () => {
  const d = fresh();
  const empty = R.grConfig({});
  assert.deepEqual(empty.steps.map((step) => step.code), ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-06", "GR-07", "GR-08", "GR-09", "GR-11", "GR-10", "GR-12"]);
  assert.deepEqual(empty.steps.filter((step) => step.kind === "side").map((step) => step.name), ["ใส่ท่อ", "คัดแยก", "ตัดยาง(เข้ามุม)"]);
  assert.equal(empty.reasons.length, 7);
  assert.equal(empty.stored, false, "no stored row = defaults");
  assert.equal(R.grConfig(d).stored, true, "the demo saved its config");
  assert.equal(R.grTarget(R.grConfig(d), HL, "GR-09"), 12);
  assert.equal(R.grTarget(R.grConfig(d), HL, "GR-05"), null, "no target for that step");
  assert.equal(R.grRequired(8, 12), 91.2, "hours × target × 0.95");
  assert.equal(R.grRequired(8, null), null);
  assert.equal(R.grPercent(91.2, 91.2), 100);
  assert.equal(R.grPercent(10, null), null);
  // เจ้าของสั่ง "เริ่มครบ 9 ขั้นทุกงาน": ทุกขั้นสายหลักตามลำดับในตั้งค่า ไม่ขึ้นกับ routing · ต้องทำ = จำนวนแผนของงาน
  const tp = jobOf(d, TP);
  const MAIN9 = ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-06", "GR-07", "GR-08", "GR-09"];
  assert.deepEqual(R.grDefaultSteps(d, tp), MAIN9.map((code) => ({ code, qtyTarget: tp.qtyPlanned })));
  assert.deepEqual(R.grDefaultSteps(d, { itemCode: "NO-ROUTING", qtyPlanned: 5 }), MAIN9.map((code) => ({ code, qtyTarget: 5 })), "no routing still starts with all 9 main steps");
  const hl = jobOf(d, HL);
  const progress = R.grJobProgress(d, hl);
  assert.equal(progress.planned, true);
  assert.deepEqual(progress.steps.map((step) => [step.name, step.good]), [["รีด", 0], ["ปั๊ม", 0], ["เปเปอร์", 0], ["ตัดยาง", 115], ["ทากาว", 75], ["เจียร์", 95], ["เจียร์(หยาบ)", 0], ["เจียร์(ละเอียด)", 0], ["เจาะ", 65]], "the demo plan starts with all 9 main steps; steps with no records show 0");
  assert.deepEqual([progress.good, progress.reject, hl.qtyDone, hl.qtyReject, hl.status], [65, 6, 65, 6, "in_progress"], "good of the last step, rejects of every step");
  assert.deepEqual([progress.sent, progress.received, progress.pendingAtPk, progress.waitingAtGr], [55, 30, 25, 10]);
  assert.equal(R.grJobProgress(d, tp).planned, false);
  assert.equal(R.grDay(Date.parse("2026-11-23T23:30:00+07:00")), "2026-11-23", "the work day is the Thai calendar day");
  assert.equal(R.grDay(Date.parse("2026-11-23T00:30:00+07:00"), -1), "2026-11-22");
  assert.deepEqual(R.grRodCodesOf(d.orders.find((order) => order.id === "DEMO-26001"), hl), ["RB-DM02-02-YE03-204-19-34"]);
});

test("rules: a rod request is covered by what SR issues to that order and code after it, oldest request first; a reversed issue no longer counts", () => {
  const d = fresh();
  const code = "RB-DM02-02-YE03-204-19-34";
  const first = d.rodRequests[0];
  assert.deepEqual(R.grRequestState(d, first), { status: "open", issued: 0, remaining: 10 });
  assert.equal(R.grOpenRequests(d).length, 1, "SR sees one open request");
  d.rodRequests.push({ ...first, id: "req-2", qty: 5, createdAt: first.createdAt + 1 });
  const issue = (id, qty, at) => d.rodMoves.push({ id, lotId: "lot", itemCode: code, kind: "issue", qty: -qty, ownerOrderId: null, forOrderId: "DEMO-26001", reversesId: null, note: "", at, by: "SR" });
  issue("old", 50, first.createdAt - 1);
  assert.equal(R.grRequestState(d, first).issued, 0, "rods issued before the request do not count");
  issue("m1", 12, NOW);
  assert.deepEqual(R.grRequestState(d, first), { status: "covered", issued: 10, remaining: 0 });
  assert.deepEqual(R.grRequestState(d, d.rodRequests[1]), { status: "open", issued: 2, remaining: 3 }, "the rest goes to the next request");
  d.rodMoves.push({ id: "u1", lotId: "lot", itemCode: code, kind: "unissue", qty: 12, ownerOrderId: null, forOrderId: "DEMO-26001", reversesId: "m1", note: "ผิด", at: NOW + 1, by: "SR" });
  assert.equal(R.grRequestState(d, first).status, "open", "a reversed issue no longer covers");
  assert.equal(R.grRequestState(d, { ...first, status: "cancelled" }).status, "cancelled");
  assert.deepEqual(R.grLotsIssued(d, "DEMO-26001", code).map((row) => row.moveId), ["old"], "GR sees the lots issued to the order, reversed rows left out");
});

test("rules: the summary groups records by day, step, worker and reject reason with targets where set", () => {
  const d = fresh();
  const all = R.grSummary(d, {});
  assert.equal(all.records.length, d.grRecords.length);
  const step = (code) => all.byStep.find((row) => row.key === code);
  assert.equal(step("GR-04").good, 115);
  assert.equal(step("GR-04").required, 304, "two days of 8 h × 20 × 0.95");
  assert.equal(step("GR-04").percent, 37.8);
  assert.equal(step("GR-05").required, null, "no target, no required figure");
  assert.deepEqual(all.byReason.map((row) => [row.key, row.reject]), [["เจียร์เกิน", 3], ["ขนาดไม่ได้", 2], ["เจาะผิดตำแหน่ง", 1]]);
  assert.deepEqual(all.byWorker.map((row) => row.label).sort(), ["กมล ทดลองดี", "รัตนา สมมุติ", "สุนทร ใจงาม"].sort());
  assert.equal(R.grSummary(d, { workerId: "B05" }).records.every((record) => record.workerId === "B05"), true);
  assert.equal(R.grSummary(d, { month: "2026-10" }).records.length, 0);
});

// ---------- คำสั่ง (โหมดในเครื่อง) ----------
test("actions: only the GR head or the planners change the config; a step in use cannot leave it but can be set as not in use", () => {
  const d = fresh();
  const config = R.grConfig(d);
  const body = { steps: config.steps, reasons: config.reasons, targets: config.targets };
  rejects(() => A.saveGrConfig(d, body, ctx("gr")), /หัวหน้าแผนก GR หรือฝ่ายวางแผน/);
  rejects(() => A.saveGrConfig(d, body, ctx("rb")), /หัวหน้าแผนก GR/);
  rejects(() => A.saveGrConfig(d, { ...body, steps: body.steps.filter((step) => step.code !== "GR-09"), targets: [] }, ctx("head")), /เจาะ.*ลบไม่ได้/);
  rejects(() => A.saveGrConfig(d, { ...body, reasons: [] }, ctx("head")), /เหตุผลของเสีย/);
  rejects(() => A.saveGrConfig(d, { ...body, targets: [{ itemCode: HL, stepCode: "GR-09", perHour: 0 }] }, ctx("head")), /มากกว่า 0/);
  rejects(() => A.saveGrConfig(d, { ...body, targets: [{ itemCode: "NOPE-1", stepCode: "GR-09", perHour: 5 }] }, ctx("head")), /ไม่พบชิ้นงาน/);
  const out = A.saveGrConfig(d, { ...body, steps: [...body.steps.map((step) => (step.code === "GR-09" ? { ...step, active: false } : step)), { name: "ล้างคราบ", kind: "side" }] }, ctx("head"));
  assert.equal(out.section, "grConfig");
  assert.equal(out.request.length, 1);
  const saved = R.grConfig(d);
  assert.equal(saved.steps.at(-1).code, "GR-13", "a new step gets the next free code");
  assert.equal(saved.steps.find((step) => step.code === "GR-09").active, false);
  assert.deepEqual(saved.steps.map((step) => step.seq), saved.steps.map((_, index) => index + 1), "the order in the list is the order of the steps");
  assert.equal(d.grConfig[0].updatedBy, USERS.head.name);
  A.saveGrConfig(d, body, ctx("planner"));
});

test("actions: the job steps — head or planner, a GR job in production, starts with all 9 steps from the config, never over a job reported the old way, never dropping a step with records", () => {
  const d = fresh();
  const tp = jobOf(d, TP);
  const steps = R.grDefaultSteps(d, tp);
  rejects(() => A.setGrJobSteps(d, { jobId: tp.id, steps }, ctx("gr")), /หัวหน้าแผนก GR หรือฝ่ายวางแผน/);
  rejects(() => A.setGrJobSteps(d, { jobId: jobOf(d, "PT-00320").id, steps }, ctx("head")), /ไม่ใช่งานของแผนก GR/);
  rejects(() => A.setGrJobSteps(d, { jobId: tp.id, steps: [{ code: "GR-99", qtyTarget: 1 }] }, ctx("head")), /ไม่พบขั้นตอน/);
  rejects(() => A.setGrJobSteps(d, { jobId: tp.id, steps: [{ code: "GR-04", qtyTarget: 0 }] }, ctx("head")), /ไม่น้อยกว่า 1/);
  const old = jobOf(d, "SE-TP01-BK01-140-3-20");
  rejects(() => A.setGrJobSteps(d, { jobId: old.id, steps: [{ code: "GR-04", qtyTarget: 10 }] }, ctx("head")), /รายงานผลแบบเดิม/);
  const out = A.setGrJobSteps(d, { jobId: tp.id, steps }, ctx("head"));
  assert.deepEqual(out.request, [{ jobId: tp.id, steps }]);
  assert.equal(tp.status, "queued", "a plan alone does not start the job");
  const hl = jobOf(d, HL);
  rejects(() => A.setGrJobSteps(d, { jobId: hl.id, steps: [{ code: "GR-09", qtyTarget: 120 }] }, ctx("head")), /มีผลบันทึกแล้ว/);
  // ลำดับที่ส่ง = ลำดับขั้น: ขั้นสุดท้ายของลำดับเป็นยอดของงาน · ขั้นสุดท้ายใหม่ที่ทำให้ยอดดีต่ำกว่าที่ส่งให้ PK แล้ว (55) = ไม่ได้
  const plan = R.grPlanOf(d, hl.id).steps;
  rejects(() => A.setGrJobSteps(d, { jobId: hl.id, steps: [...plan, { code: "GR-10", qtyTarget: 120 }] }, ctx("head")), /เปลี่ยนขั้นตอนไม่ได้.*ต่ำกว่าที่ส่งให้ PK แล้ว 55.*ยกเลิกการส่ง/);
  assert.deepEqual(R.grPlanOf(d, hl.id).steps, plan, "the refused plan changed nothing");
  A.setGrJobSteps(d, { jobId: hl.id, steps: [...plan.slice(0, 5), plan[6], plan[7], plan[8], plan[5]] }, ctx("head"));
  assert.deepEqual(R.grPlanOf(d, hl.id).steps.map((step) => step.code), ["GR-01", "GR-02", "GR-03", "GR-04", "GR-05", "GR-07", "GR-08", "GR-09", "GR-06"], "the plan keeps the order it was given");
  assert.deepEqual([hl.qtyDone, hl.qtyReject], [95, 6], "the last step of the new order (เจียร์) counts");
  A.setGrJobSteps(d, { jobId: hl.id, steps: plan }, ctx("planner"));
  assert.deepEqual([hl.qtyDone, hl.qtyReject], [65, 6]);
  assert.equal(hl.reports.at(-1).kind, "gr");
  // งานที่มีขั้นตอนแล้ว: รายงานผลแบบเดิมไม่ได้
  rejects(() => A.reportJob(d, { jobId: hl.id, qtyDone: 1 }, ctx("gr")), /บันทึกผลรายวัน/);
});

test("actions: daily records — staff record their own work of today or yesterday, the head records anyone's any day, and the job totals follow", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  const base = { jobId: hl.id, stepCode: "GR-09", hours: 8, good: 10 };
  // the plan starts with all 9 steps; drop one without records so a step outside the plan can be refused
  A.setGrJobSteps(d, { jobId: hl.id, steps: R.grPlanOf(d, hl.id).steps.filter((step) => step.code !== "GR-01") }, ctx("head"));
  rejects(() => A.addGrRecord(d, base, ctx("rb")), /แผนก GR หรือฝ่ายวางแผน/);
  rejects(() => A.addGrRecord(d, { ...base, workerId: "GR-DEMO-2" }, ctx("gr")), /ผลของตัวเอง/);
  rejects(() => A.addGrRecord(d, { ...base, workDate: "2026-11-20" }, ctx("gr")), /วันนี้หรือเมื่อวาน/);
  rejects(() => A.addGrRecord(d, { ...base, workDate: "2026-11-24" }, ctx("gr")), /ไม่เกินวันนี้/);
  rejects(() => A.addGrRecord(d, { ...base, stepCode: "GR-01" }, ctx("gr")), /ไม่อยู่ในขั้นตอนของงานนี้/);
  rejects(() => A.addGrRecord(d, { ...base, reject: 2 }, ctx("gr")), /เลือกเหตุผล/);
  rejects(() => A.addGrRecord(d, { ...base, reject: 2, reason: "อย่างอื่น" }, ctx("gr")), /ไม่อยู่ในรายการ/);
  rejects(() => A.addGrRecord(d, { ...base, good: 0 }, ctx("gr")), /จำนวนดีหรือจำนวนเสีย/);
  rejects(() => A.addGrRecord(d, { ...base, hours: 25 }, ctx("gr")), /ไม่เกิน 24/);
  rejects(() => A.addGrRecord(d, { ...base, hours: 1.234 }, ctx("gr")), /ทศนิยม/);
  rejects(() => A.addGrRecord(d, { ...base, good: 1.5 }, ctx("gr")), /จำนวนเต็ม/);
  rejects(() => A.addGrRecord(d, { ...base, jobId: jobOf(d, TP).id }, ctx("gr")), /ยังไม่ได้ตั้งขั้นตอน/);
  const out = A.addGrRecord(d, { ...base, reject: 1, reason: "ขนาดไม่ได้", note: "รอบบ่าย" }, ctx("gr"));
  assert.equal(out.section, "grRecords");
  assert.deepEqual(out.request, [{ id: out.id, jobId: hl.id, stepCode: "GR-09", workDate: TODAY, workerId: "B05", hours: 8, people: 1, good: 10, reject: 1, reason: "ขนาดไม่ได้", note: "รอบบ่าย" }]);
  assert.deepEqual([hl.qtyDone, hl.qtyReject], [75, 7]);
  const record = d.grRecords.find((row) => row.id === out.id);
  assert.equal(record.workerName, "สุนทร ใจงาม");
  A.addGrRecord(d, { ...base, workDate: "2026-11-22" }, ctx("gr"));
  const forOther = A.addGrRecord(d, { ...base, workerId: "GR-DEMO-2", workDate: "2026-11-01", good: 5 }, ctx("head"));
  assert.equal(d.grRecords.find((row) => row.id === forOther.id).workerName, "กมล ทดลองดี");
  rejects(() => A.addGrRecord(d, { ...base, workerId: "SOMEONE" }, ctx("head")), /พนักงานแผนก GR/);
  // ผู้ทำต้องอยู่ในรายชื่อพนักงาน GR (grWorkers) เหมือนฐานข้อมูล รวมผู้บันทึกเอง: หัวหน้าที่ไม่อยู่ในรายชื่อต้องเลือกผู้ทำ
  rejects(() => A.addGrRecord(d, { ...base, stepCode: "GR-04" }, ctx("head")), /ไม่อยู่ในรายชื่อพนักงานแผนก GR กรุณาเลือกผู้ทำ/);
  rejects(() => A.addGrRecord(d, { ...base, stepCode: "GR-04", workerId: USERS.planner.id }, ctx("planner")), /ไม่อยู่ในรายชื่อ/);
  d.grWorkers.push({ id: USERS.head.id, name: USERS.head.name });
  A.addGrRecord(d, { ...base, stepCode: "GR-04", good: 1 }, ctx("head"));
  assert.equal(d.grRecords.at(-1).workerId, USERS.head.id, "a head on the list records for themselves");
  assert.equal(hl.qtyDone, 90);
  // ถึงแผน = เสร็จ · งานที่เสร็จเพราะยอดถึงแผนยังรับผลตามกติกาปกติ (รวมผลของขั้นก่อนหน้า) · ยกเลิกจนต่ำกว่าแผน = กลับเป็นกำลังทำ
  A.addGrRecord(d, { ...base, workerId: "B05", good: 30 }, ctx("head"));
  assert.deepEqual([hl.qtyDone, hl.status, hl.doneAt], [120, "done", NOW]);
  assert.equal(A.helpers.grJobBlock(d, hl, USERS.gr), null, "a job done by quantity still takes records");
  A.addGrRecord(d, { ...base, stepCode: "GR-04", good: 5 }, ctx("gr"));
  assert.deepEqual([hl.qtyDone, hl.status], [120, "done"], "an earlier step after the last step reached the plan keeps the job done");
  A.voidGrRecord(d, { recordId: out.id, reason: "บันทึกซ้ำ" }, ctx("gr"));
  assert.deepEqual([hl.qtyDone, hl.qtyReject, hl.status, hl.doneAt], [110, 6, "in_progress", undefined], "staff cancel their own record of today; below the plan the job is back in progress");
  assert.equal(A.helpers.jobCloseNote(hl), null, "GR items are never read as a planner's close reason");
  // ฝ่ายวางแผนปิดงานพร้อมเหตุผล (done ยอดต่ำกว่าแผน): เพิ่ม / แก้ / ยกเลิกผลได้เฉพาะฝ่ายวางแผน งานคงปิด
  A.setJobStatus(d, { jobId: hl.id, status: "done", reason: "ลูกค้าลดจำนวน" }, ctx("planner"));
  assert.equal(A.helpers.isGrClosedShort(hl), true);
  rejects(() => A.addGrRecord(d, { ...base, stepCode: "GR-04" }, ctx("gr")), /ฝ่ายวางแผนปิดงานนี้แล้ว/);
  rejects(() => A.addGrRecord(d, { ...base, workerId: "B05", stepCode: "GR-04" }, ctx("head")), /ฝ่ายวางแผนปิดงานนี้แล้ว/);
  const late = d.grRecords.find((row) => row.jobId === hl.id && row.status === "active" && row.workerId === "B05" && R.grDay(row.createdAt) === TODAY);
  rejects(() => A.voidGrRecord(d, { recordId: late.id, reason: "บันทึกซ้ำ" }, ctx("gr")), /ฝ่ายวางแผนปิดงานนี้แล้ว/);
  A.addGrRecord(d, { ...base, workerId: "B05", stepCode: "GR-04", good: 1 }, ctx("planner"));
  assert.deepEqual([hl.status, A.helpers.jobCloseNote(hl)?.reason], ["done", "ลูกค้าลดจำนวน"], "a planner still records; the closed job stays closed");
});

test("actions: a cancel, an edit or a new last step never leaves the job's good below what was sent to PK", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  const drill = d.grRecords.find((row) => row.jobId === hl.id && row.stepCode === "GR-09" && row.good === 35);
  assert.deepEqual([hl.qtyDone, R.grHandoverSummary(d, hl).sent], [65, 55]);
  rejects(() => A.voidGrRecord(d, { recordId: drill.id, reason: "บันทึกผิด" }, ctx("head")), /ยกเลิกผลนี้ไม่ได้: ยอดดีของงานจะเหลือ 30 ต่ำกว่าที่ส่งให้ PK แล้ว 55 ยกเลิกการส่ง/);
  rejects(() => A.editGrRecord(d, { recordId: drill.id, good: 24, editReason: "นับผิด" }, ctx("head")), /แก้ผลนี้ไม่ได้: ยอดดีของงานจะเหลือ 54/);
  assert.deepEqual([drill.good, drill.status, drill.edits.length, hl.qtyDone], [35, "active", 0, 65], "a refused change leaves the record and the job as they were");
  A.editGrRecord(d, { recordId: drill.id, good: 25, editReason: "นับผิด" }, ctx("head"));
  assert.deepEqual([hl.qtyDone, R.grHandoverSummary(d, hl).waitingAtGr], [55, 0], "exactly what was sent is allowed");
  // ยกเลิกการส่งที่ PK ยังไม่รับก่อน แล้วจึงยกเลิกผลได้
  const pending = d.grHandovers.find((row) => row.jobId === hl.id && row.status === "sent");
  A.cancelGrHandover(d, { handoverId: pending.id, reason: "ส่งเกิน" }, ctx("head"));
  A.voidGrRecord(d, { recordId: drill.id, reason: "บันทึกผิด" }, ctx("head"));
  assert.deepEqual([hl.qtyDone, R.grHandoverSummary(d, hl).waitingAtGr], [30, 0]);
});

test("actions: a GR job with daily records (even all cancelled) never goes back to the queue; on hold it resumes instead", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  A.setJobStatus(d, { jobId: hl.id, status: "hold", reason: "รอเครื่องเจียร์" }, ctx("gr"));
  rejects(() => A.setJobStatus(d, { jobId: hl.id, status: "queued" }, ctx("planner")), /มีผลรายวันของ GR แล้ว คืนคิวไม่ได้/);
  A.setJobStatus(d, { jobId: hl.id, status: "in_progress" }, ctx("gr"));
  const tp = jobOf(d, TP);
  A.setGrJobSteps(d, { jobId: tp.id, steps: R.grDefaultSteps(d, tp) }, ctx("head"));
  const first = A.addGrRecord(d, { jobId: tp.id, stepCode: "GR-04", hours: 1, good: 3 }, ctx("gr"));
  A.voidGrRecord(d, { recordId: first.id, reason: "บันทึกผิดงาน" }, ctx("gr"));
  assert.deepEqual([tp.qtyDone, tp.qtyReject, tp.status, A.helpers.hasGrRecords(d, tp)], [0, 0, "in_progress", true], "a cancelled record still marks the job as started");
  rejects(() => A.setJobStatus(d, { jobId: tp.id, status: "queued" }, ctx("gr")), /คืนคิวไม่ได้/);
  A.setJobStatus(d, { jobId: tp.id, status: "hold", reason: "รอเครื่องเจียร์" }, ctx("gr"));
  rejects(() => A.setJobStatus(d, { jobId: tp.id, status: "queued" }, ctx("gr")), /คืนคิวไม่ได้/);
  // งานที่ยังไม่มีผล คืนคิวได้ตามเดิม
  const fresh2 = jobOf(d, "SE-TP01-OR01-75-3-30");
  assert.deepEqual([fresh2.status, A.helpers.hasGrRecords(d, fresh2)], ["queued", false]);
  A.setJobStatus(d, { jobId: fresh2.id, status: "in_progress" }, ctx("gr"));
  A.setJobStatus(d, { jobId: fresh2.id, status: "queued" }, ctx("gr"));
  assert.equal(fresh2.status, "queued");
});

test("actions: edit and cancel — staff own records on the day they recorded them, the head any record any day, a reason every time and the history kept", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  const mine = A.addGrRecord(d, { jobId: hl.id, stepCode: "GR-04", hours: 4, good: 20 }, ctx("gr"));
  rejects(() => A.editGrRecord(d, { recordId: mine.id, good: 18 }, ctx("gr")), /เหตุผลที่แก้/);
  const edited = A.editGrRecord(d, { recordId: mine.id, good: 18, editReason: "นับผิด" }, ctx("gr"));
  assert.deepEqual(edited.request, [{ id: mine.id, stepCode: "GR-04", workDate: TODAY, workerId: "B05", hours: 4, people: 1, good: 18, reject: 0, reason: "", note: "", editReason: "นับผิด" }]);
  const record = d.grRecords.find((row) => row.id === mine.id);
  assert.deepEqual([record.good, record.edits.length, record.edits[0].kind, record.edits[0].before.good, record.edits[0].reason], [18, 1, "edit", 20, "นับผิด"]);
  rejects(() => A.editGrRecord(d, { recordId: mine.id, workerId: "GR-DEMO-2", editReason: "ผิดคน" }, ctx("gr")), /ผลของตัวเอง/);
  // ผลของพนักงานคนอื่น / ผลที่บันทึกวันก่อน
  const other = d.grRecords.find((row) => row.workerId === "GR-DEMO-2");
  rejects(() => A.voidGrRecord(d, { recordId: other.id, reason: "ไม่ใช่ของฉัน" }, ctx("gr")), /เฉพาะผลของตัวเอง/);
  const older = d.grRecords.find((row) => row.workerId === "B05" && R.grDay(row.createdAt) !== TODAY);
  rejects(() => A.editGrRecord(d, { recordId: older.id, good: 1, editReason: "นับผิด" }, ctx("gr")), /เฉพาะวันที่บันทึก/);
  A.editGrRecord(d, { recordId: older.id, good: 31, editReason: "นับผิด" }, ctx("head"));
  assert.equal(hl.qtyDone, 66, "the head's edit of the last step moves the job total");
  rejects(() => A.voidGrRecord(d, { recordId: mine.id, reason: "ab" }, ctx("gr")), /อย่างน้อย 3/);
  const voided = A.voidGrRecord(d, { recordId: mine.id, reason: "บันทึกซ้ำ" }, ctx("gr"));
  assert.deepEqual(voided.request, [{ id: mine.id, reason: "บันทึกซ้ำ" }]);
  assert.deepEqual([record.status, record.voidReason, record.edits.at(-1).kind], ["void", "บันทึกซ้ำ", "void"]);
  rejects(() => A.voidGrRecord(d, { recordId: mine.id, reason: "บันทึกซ้ำ" }, ctx("gr")), /ถูกยกเลิกแล้ว/);
  assert.equal(A.helpers.grRecordBlock(d, USERS.gr, other, NOW), "พนักงานแก้ได้เฉพาะผลของตัวเอง");
  assert.equal(A.helpers.grRecordBlock(d, USERS.head, other, NOW), null);
});

test("actions: rod requests and the hand-over to PK follow the database rules", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  const code = "RB-DM02-02-YE03-204-19-34";
  rejects(() => A.requestRods(d, { jobId: hl.id, itemCode: code, qty: 5 }, ctx("pk")), /แผนก GR หรือฝ่ายวางแผน/);
  rejects(() => A.requestRods(d, { jobId: hl.id, itemCode: "RB-DM01-02-OR01-202-18-70", qty: 5 }, ctx("gr")), /ไม่ใช่ยางเส้นยาวของงาน/);
  rejects(() => A.requestRods(d, { jobId: hl.id, itemCode: code, qty: 0 }, ctx("gr")), /ไม่น้อยกว่า 1/);
  const asked = A.requestRods(d, { jobId: hl.id, itemCode: code, qty: 5, note: "ด่วน" }, ctx("gr"));
  assert.deepEqual(asked.request, [{ id: asked.id, jobId: hl.id, itemCode: code, qty: 5, note: "ด่วน" }]);
  rejects(() => A.cancelRodRequest(d, { requestId: asked.id, reason: "ไม่ใช้แล้ว" }, ctx("rb")), /ผู้ขอ หัวหน้าแผนก GR หรือฝ่ายวางแผน/);
  A.cancelRodRequest(d, { requestId: asked.id, reason: "ไม่ใช้แล้ว" }, ctx("gr"));
  rejects(() => A.cancelRodRequest(d, { requestId: asked.id, reason: "ไม่ใช้แล้ว" }, ctx("gr")), /ถูกยกเลิกแล้ว/);
  // ส่งให้ PK: เพดาน = ของดีที่ยังไม่ส่ง (65 − 55 = 10)
  rejects(() => A.sendGrToPk(d, { jobId: hl.id, qty: 5 }, ctx("gr")), /หัวหน้าแผนก GR หรือฝ่ายวางแผน/);
  rejects(() => A.sendGrToPk(d, { jobId: hl.id, qty: 11 }, ctx("head")), /ไม่เกินของดีที่ยังไม่ได้ส่ง 10/);
  const sent = A.sendGrToPk(d, { jobId: hl.id, qty: 10 }, ctx("head"));
  assert.deepEqual(sent.request, [{ id: sent.id, jobId: hl.id, qty: 10, note: "" }]);
  assert.equal(R.grHandoverSummary(d, hl).waitingAtGr, 0);
  rejects(() => A.receiveGrAtPk(d, { handoverId: sent.id }, ctx("gr")), /แผนก PK หรือฝ่ายวางแผน/);
  assert.deepEqual(A.receiveGrAtPk(d, { handoverId: sent.id }, ctx("pk")).request, [{ id: sent.id }]);
  rejects(() => A.receiveGrAtPk(d, { handoverId: sent.id }, ctx("pk")), /รับไปแล้ว/);
  rejects(() => A.cancelGrHandover(d, { handoverId: sent.id, reason: "นับผิด" }, ctx("head")), /หัวหน้าแผนก PK/);
  rejects(() => A.cancelGrHandover(d, { handoverId: sent.id, reason: "นับผิด" }, ctx("pk")), /หัวหน้าแผนก PK/);
  const reversed = A.cancelGrHandover(d, { handoverId: sent.id, reason: "นับผิด" }, ctx("pkHead"));
  assert.equal(reversed.status, "sent", "reversing a receipt puts it back to waiting at PK");
  const row = d.grHandovers.find((entry) => entry.id === sent.id);
  assert.deepEqual(row.moves.map((move) => move.kind), ["send", "receive", "unreceive"]);
  assert.equal(A.cancelGrHandover(d, { handoverId: sent.id, reason: "ส่งผิดใบ" }, ctx("head")).status, "cancelled");
  assert.equal(R.grHandoverSummary(d, hl).waitingAtGr, 10, "a cancelled hand-over frees its pieces");
});

test("actions: database mode returns the request rows, the store sends only the GR section, and every new error code has a Thai message", () => {
  const d = fresh();
  const hl = jobOf(d, HL);
  const out = A.addGrRecord(d, { jobId: hl.id, stepCode: "GR-09", hours: 2, good: 3 }, ctx("gr", { remote: true }));
  assert.equal(out.request.length, 1);
  assert.deepEqual(storeApi.GR_ACTIONS, { saveGrConfig: "grConfig", setGrJobSteps: "grPlans", addGrRecord: "grRecords", editGrRecord: "grRecords", voidGrRecord: "grRecords",
    requestRods: "rodRequests", cancelRodRequest: "rodRequests", sendGrToPk: "grHandovers", receiveGrAtPk: "grHandovers", cancelGrHandover: "grHandovers" });
  for (const list of ["grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers", "grWorkers"]) assert.ok(storeApi.REMOTE_LISTS.includes(list), list);
  assert.equal(storeApi.diffMaster(fresh(), d, "addGrRecord").grRecords, undefined, "GR lists are never diffed as records");
  for (const code of ["BOM_INVALID_GR", "BOM_GR_EXCEEDS"]) assert.doesNotMatch(storeApi.mapRemoteError({ code }).message, /BOM_/, `${code} has a Thai message`);
  assert.equal(seed.emptyState().grRecords.length, 0);
});

// ---------- Supabase จำลองของ harness ----------
const BOM_KEY = "mnp-harness-bom-master";
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves", "rodLots", "rodMoves", "grConfig", "grPlans", "grRecords", "rodRequests", "grHandovers"];
function mockScene() {
  const data = fresh();
  const master = { version: 1, epoch: "gr-e1", versions: {}, tombstones: [], audit: [], ...Object.fromEntries(LISTS.map((list) => [list, data[list] ?? []])) };
  const storage = memoryStorage();
  storage.setItem(BOM_KEY, JSON.stringify(master));
  const mock = createMockSupabase({ sandbox: true, now: () => NOW, storage });
  const call = async (name, args) => { const { data: out, error } = await mock.client.rpc(name, args); if (error) throw Object.assign(new Error(error.message), { code: error.code }); return out; };
  const as = (persona) => call("app_sandbox_enter", { p_persona_id: persona });
  const save = async (persona, action, changes, base = null) => {
    await as(persona);
    const version = base ?? (await call("app_bom_master")).version;
    const { data: out, error } = await mock.client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: version, p_action: action, p_audit: [] });
    return error ? { code: error.code } : { data: out };
  };
  const gr = (persona, action, section, row, base) => save(persona, action, { [section]: { upsert: [row] } }, base);
  const view = () => call("app_bom_master");
  return { mock, call, as, save, gr, view, data };
}
const uid = (n) => `7a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const codeOf = async (promise) => (await promise).code ?? null;

test("mock: the config and the job steps — GR staff and other departments are refused, the GR head and the planners are not", async () => {
  const s = mockScene();
  const config = R.grConfig(s.data);
  const body = { steps: config.steps, reasons: config.reasons, targets: config.targets };
  assert.equal(await codeOf(s.gr("persona-gr", "saveGrConfig", "grConfig", body)), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-rb", "saveGrConfig", "grConfig", body)), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-grh", "saveGrConfig", "grConfig", { ...body, steps: body.steps.filter((step) => step.code !== "GR-09") })), "BOM_INVALID_GR", "a step in use stays");
  assert.equal(await codeOf(s.gr("persona-grh", "saveGrConfig", "grConfig", { ...body, reasons: [] })), "BOM_INVALID_GR");
  const before = (await s.view()).version;
  assert.ok((await s.gr("persona-grh", "saveGrConfig", "grConfig", body)).data, "the GR head saves");
  assert.equal(await codeOf(s.gr("persona-pp", "saveGrConfig", "grConfig", body, before)), "BOM_STALE", "a save from an older version is a conflict");
  assert.ok((await s.gr("persona-pp", "saveGrConfig", "grConfig", body)).data, "a planner saves");
  const tp = jobOf(s.data, TP);
  const plan = { jobId: tp.id, steps: R.grDefaultSteps(s.data, tp) };
  assert.equal(await codeOf(s.gr("persona-gr", "setGrJobSteps", "grPlans", plan)), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-grh", "setGrJobSteps", "grRecords", plan)), "BOM_INVALID_GR", "the plan goes in its own section");
  assert.equal(await codeOf(s.save("persona-grh", "setGrJobSteps", { grPlans: { upsert: [] } })), "BOM_INVALID_GR", "an empty request");
  assert.equal(await codeOf(s.gr("persona-grh", "setGrJobSteps", "grPlans", { ...plan, steps: [{ code: "GR-99", qtyTarget: 1 }] })), "BOM_INVALID_GR");
  assert.equal(await codeOf(s.gr("persona-grh", "setGrJobSteps", "grPlans", { jobId: jobOf(s.data, "SE-TP01-BK01-140-3-20").id, steps: [{ code: "GR-04", qtyTarget: 1 }] })), "BOM_INVALID_TRANSITION",
    "a job reported the old way gets no steps");
  assert.ok((await s.gr("persona-grh", "setGrJobSteps", "grPlans", plan)).data);
  const view = await s.view();
  assert.deepEqual(view.grPlans.find((row) => row.jobId === tp.id).steps, plan.steps);
  assert.deepEqual(view.grWorkers.map((row) => row.id), ["persona-gr", "persona-grh"], "the snapshot lists the GR workers");
  assert.deepEqual((await s.call("app_bom_master_since", { p_version: 0 })).changes.grWorkers, { upsert: [], delete: [] }, "the delta never carries them");
});

test("mock: records follow the staff and head rules, the totals follow, and the old report of a planned job is refused", async () => {
  const s = mockScene();
  const tp = jobOf(s.data, TP);
  assert.ok((await s.gr("persona-grh", "setGrJobSteps", "grPlans", { jobId: tp.id, steps: [{ code: "GR-04", qtyTarget: 240 }, { code: "GR-09", qtyTarget: 240 }] })).data);
  const row = (n, extra = {}) => ({ id: uid(n), jobId: tp.id, stepCode: "GR-09", workDate: TODAY, workerId: "persona-gr", hours: 8, people: 1, good: 10, reject: 0, reason: "", note: "", ...extra });
  assert.equal(await codeOf(s.gr("persona-rb", "addGrRecord", "grRecords", row(1))), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { workerId: "persona-grh" }))), "BOM_FORBIDDEN", "staff record their own work");
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { workDate: "2026-11-20" }))), "BOM_FORBIDDEN", "today or yesterday");
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { stepCode: "GR-05" }))), "BOM_INVALID_GR", "a step of the plan");
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { reject: 1 }))), "BOM_INVALID_GR", "a reject needs a reason");
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { hours: 1.234 }))), "BOM_INVALID_GR");
  assert.ok((await s.gr("persona-gr", "addGrRecord", "grRecords", row(1, { reject: 1, reason: "ขนาดไม่ได้" }))).data);
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(1))), "BOM_INVALID_GR", "a second press counts nothing");
  assert.equal(await codeOf(s.gr("persona-grh", "addGrRecord", "grRecords", row(2, { workerId: "persona-rb" }))), "BOM_INVALID_GR", "the worker is in GR");
  assert.ok((await s.gr("persona-grh", "addGrRecord", "grRecords", row(2, { workDate: "2026-11-01", good: 5 }))).data, "the head records any GR worker any day");
  assert.ok((await s.gr("persona-grh", "addGrRecord", "grRecords", row(3, { stepCode: "GR-04", good: 50, workerId: "persona-grh" }))).data);
  let view = await s.view();
  let job = view.jobs.find((entry) => entry.id === tp.id);
  assert.deepEqual([job.qtyDone, job.qtyReject, job.status], [15, 1, "in_progress"], "good of the last step, rejects of all steps");
  assert.equal(job.reports.at(-1).kind, "gr");
  // reportJob ของงานที่มีขั้นตอน = BOM_INVALID_JOB (trigger bom_jobs_gr_guard)
  const reported = { ...job, qtyDone: 16, reports: [...job.reports, { at: NOW, by: "x", good: 1, reject: 0, note: "แบบเดิม" }] };
  assert.equal(await codeOf(s.save("persona-gr", "reportJob", { jobs: { upsert: [reported] } })), "BOM_INVALID_JOB");
  // แก้ / ยกเลิก
  const edit = (n, extra) => ({ ...row(n), editReason: "นับผิด", ...extra });
  assert.equal(await codeOf(s.gr("persona-gr", "editGrRecord", "grRecords", { ...edit(1, { reject: 1, reason: "ขนาดไม่ได้", good: 8 }), editReason: "" })), "BOM_INVALID_GR", "an edit needs a reason");
  assert.ok((await s.gr("persona-gr", "editGrRecord", "grRecords", edit(1, { reject: 1, reason: "ขนาดไม่ได้", good: 8 }))).data, "staff edit their own record of today");
  assert.equal(await codeOf(s.gr("persona-gr", "editGrRecord", "grRecords", edit(2, { workDate: "2026-11-01" }))), "BOM_FORBIDDEN", "but not keep a date older than yesterday");
  assert.equal(await codeOf(s.gr("persona-gr", "voidGrRecord", "grRecords", { id: uid(3), reason: "บันทึกซ้ำ" })), "BOM_FORBIDDEN", "nor cancel another worker's record");
  assert.ok((await s.gr("persona-grh", "voidGrRecord", "grRecords", { id: uid(2), reason: "บันทึกซ้ำ" })).data);
  assert.equal(await codeOf(s.gr("persona-grh", "voidGrRecord", "grRecords", { id: uid(2), reason: "บันทึกซ้ำ" })), "BOM_INVALID_TRANSITION");
  view = await s.view();
  job = view.jobs.find((entry) => entry.id === tp.id);
  assert.deepEqual([job.qtyDone, job.qtyReject], [8, 1]);
  const record = view.grRecords.find((entry) => entry.id === uid(1));
  assert.deepEqual([record.edits.length, record.edits[0].before.good, record.workerName], [1, 10, "มานี ตัดยาง"]);
  assert.equal(await codeOf(s.gr("persona-grh", "setGrJobSteps", "grPlans", { jobId: tp.id, steps: [{ code: "GR-09", qtyTarget: 240 }] })), "BOM_INVALID_GR", "a step with records stays in the plan");
});

test("mock: rod requests and hand-overs — who may ask, cancel, send, receive and reverse; the hand-over never exceeds the good pieces", async () => {
  const s = mockScene();
  const hl = jobOf(s.data, HL);
  const code = "RB-DM02-02-YE03-204-19-34";
  const ask = (n, extra = {}) => ({ id: uid(100 + n), jobId: hl.id, itemCode: code, qty: 5, note: "", ...extra });
  assert.equal(await codeOf(s.gr("persona-pk", "requestRods", "rodRequests", ask(1))), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-gr", "requestRods", "rodRequests", ask(1, { itemCode: "RB-DM01-02-OR01-202-18-70" }))), "BOM_INVALID_GR", "a rod this job does not cut");
  assert.ok((await s.gr("persona-gr", "requestRods", "rodRequests", ask(1))).data);
  assert.equal(await codeOf(s.gr("persona-rb", "cancelRodRequest", "rodRequests", { id: uid(101), reason: "ไม่ใช้แล้ว" })), "BOM_FORBIDDEN");
  assert.ok((await s.gr("persona-gr", "cancelRodRequest", "rodRequests", { id: uid(101), reason: "ไม่ใช้แล้ว" })).data, "the requester cancels");
  assert.equal(await codeOf(s.gr("persona-gr", "cancelRodRequest", "rodRequests", { id: uid(101), reason: "ไม่ใช้แล้ว" })), "BOM_INVALID_TRANSITION");
  const send = (n, qty) => ({ id: uid(200 + n), jobId: hl.id, qty, note: "" });
  assert.equal(await codeOf(s.gr("persona-gr", "sendGrToPk", "grHandovers", send(1, 5))), "BOM_FORBIDDEN");
  assert.equal(await codeOf(s.gr("persona-grh", "sendGrToPk", "grHandovers", send(1, 11))), "BOM_GR_EXCEEDS", "65 good, 55 already sent");
  assert.ok((await s.gr("persona-grh", "sendGrToPk", "grHandovers", send(1, 10))).data);
  assert.equal(await codeOf(s.gr("persona-gr", "receiveGrAtPk", "grHandovers", { id: uid(201) })), "BOM_FORBIDDEN");
  assert.ok((await s.gr("persona-pk", "receiveGrAtPk", "grHandovers", { id: uid(201) })).data);
  assert.equal(await codeOf(s.gr("persona-pk", "receiveGrAtPk", "grHandovers", { id: uid(201) })), "BOM_INVALID_TRANSITION");
  assert.equal(await codeOf(s.gr("persona-grh", "cancelGrHandover", "grHandovers", { id: uid(201), reason: "นับผิด" })), "BOM_FORBIDDEN", "the GR head cannot reverse a PK receipt");
  assert.equal(await codeOf(s.gr("persona-pk", "cancelGrHandover", "grHandovers", { id: uid(201), reason: "นับผิด" })), "BOM_FORBIDDEN", "nor PK staff");
  assert.ok((await s.gr("persona-pp", "cancelGrHandover", "grHandovers", { id: uid(201), reason: "นับผิด" })).data, "a planner reverses");
  const view = await s.view();
  assert.deepEqual(view.grHandovers.find((row) => row.id === uid(201)).moves.map((move) => move.kind), ["send", "receive", "unreceive"]);
  assert.ok((await s.gr("persona-grh", "cancelGrHandover", "grHandovers", { id: uid(201), reason: "ส่งผิดใบ" })).data, "the GR head cancels an unreceived hand-over");
  assert.ok((await s.gr("persona-grh", "sendGrToPk", "grHandovers", send(2, 10))).data, "a cancelled hand-over frees its pieces");
});

test("mock: no return to the queue once a job has records; the good never drops below what was sent; a job done by quantity keeps the normal rules, a planner-closed job takes only planners", async () => {
  const s = mockScene();
  const tp = jobOf(s.data, TP);
  const planned = tp.qtyPlanned;
  const jobNow = async () => (await s.view()).jobs.find((entry) => entry.id === tp.id);
  const status = (job, next, note = null) => ({ ...job, status: next, reports: note ? [...job.reports, { at: NOW, by: "ทดสอบ", good: 0, reject: 0, note }] : job.reports });
  const steps = (codes) => ({ jobId: tp.id, steps: codes.map((code) => ({ code, qtyTarget: planned })) });
  const row = (n, extra = {}) => ({ id: uid(300 + n), jobId: tp.id, stepCode: "GR-04", workDate: TODAY, workerId: "persona-gr", hours: 8, people: 1, good: 10, reject: 0, reason: "", note: "", ...extra });
  assert.ok((await s.gr("persona-grh", "setGrJobSteps", "grPlans", steps(["GR-04", "GR-09"]))).data);
  assert.ok((await s.gr("persona-gr", "addGrRecord", "grRecords", row(1))).data);
  // มีผลแล้ว (ยังไม่มียอดดีของขั้นสุดท้าย) คืนคิวไม่ได้ ทั้งจากกำลังทำและจากพัก
  let job = await jobNow();
  assert.deepEqual([job.qtyDone, job.status], [0, "in_progress"]);
  assert.equal(await codeOf(s.save("persona-gr", "setJobStatus", { jobs: { upsert: [status(job, "queued")] } })), "BOM_INVALID_TRANSITION", "a job with a record stays started");
  assert.ok((await s.save("persona-gr", "setJobStatus", { jobs: { upsert: [status(job, "hold", "รอเครื่องเจียร์")] } })).data, "it can be put on hold");
  job = await jobNow();
  assert.equal(await codeOf(s.save("persona-pp", "setJobStatus", { jobs: { upsert: [status(job, "queued")] } })), "BOM_INVALID_TRANSITION", "not back to the queue from hold either, not even by a planner");
  assert.ok((await s.save("persona-gr", "setJobStatus", { jobs: { upsert: [status(job, "in_progress")] } })).data, "it resumes");
  // ยอดดีต้องไม่ต่ำกว่าที่ส่งให้ PK
  assert.ok((await s.gr("persona-gr", "addGrRecord", "grRecords", row(2, { stepCode: "GR-09", good: 20 }))).data);
  assert.ok((await s.gr("persona-grh", "sendGrToPk", "grHandovers", { id: uid(310), jobId: tp.id, qty: 20, note: "" })).data);
  assert.equal(await codeOf(s.gr("persona-gr", "voidGrRecord", "grRecords", { id: uid(302), reason: "บันทึกผิด" })), "BOM_GR_EXCEEDS", "no cancel below what was sent");
  assert.equal(await codeOf(s.gr("persona-gr", "editGrRecord", "grRecords", { ...row(2, { stepCode: "GR-09", good: 19 }), editReason: "นับผิด" })), "BOM_GR_EXCEEDS", "no edit below it");
  assert.equal(await codeOf(s.gr("persona-grh", "setGrJobSteps", "grPlans", steps(["GR-04", "GR-09", "GR-10"]))), "BOM_GR_EXCEEDS", "no new last step below it");
  assert.ok((await s.gr("persona-grh", "cancelGrHandover", "grHandovers", { id: uid(310), reason: "ส่งก่อนเวลา" })).data);
  assert.ok((await s.gr("persona-gr", "voidGrRecord", "grRecords", { id: uid(302), reason: "บันทึกผิด" })).data, "after the send is cancelled the record can go");
  // เสร็จเพราะยอดถึงแผน: กติกาปกติ (พนักงานเพิ่มขั้นก่อนหน้า ยกเลิกผลของตัวเองวันนี้) · ต่ำกว่าแผน = กลับเป็นกำลังทำ
  assert.ok((await s.gr("persona-gr", "addGrRecord", "grRecords", row(3, { stepCode: "GR-09", good: planned }))).data);
  assert.equal((await jobNow()).status, "done");
  assert.ok((await s.gr("persona-gr", "addGrRecord", "grRecords", row(4))).data, "staff record an earlier step of a job done by quantity");
  assert.ok((await s.gr("persona-gr", "voidGrRecord", "grRecords", { id: uid(303), reason: "บันทึกผิด" })).data, "and cancel their own record of today");
  job = await jobNow();
  assert.deepEqual([job.qtyDone, job.status], [0, "in_progress"]);
  // ฝ่ายวางแผนปิดงานพร้อมเหตุผล (ยอดต่ำกว่าแผน): ฝ่ายวางแผนเท่านั้น
  assert.ok((await s.save("persona-pp", "setJobStatus", { jobs: { upsert: [status(job, "done", "ลูกค้าลดจำนวน")] } })).data);
  assert.equal(await codeOf(s.gr("persona-gr", "addGrRecord", "grRecords", row(5))), "BOM_INVALID_TRANSITION", "staff cannot record on a closed job");
  assert.equal(await codeOf(s.gr("persona-grh", "addGrRecord", "grRecords", row(5))), "BOM_INVALID_TRANSITION", "nor the GR head");
  assert.equal(await codeOf(s.gr("persona-gr", "voidGrRecord", "grRecords", { id: uid(304), reason: "บันทึกผิด" })), "BOM_INVALID_TRANSITION", "nor cancel a record of it");
  assert.ok((await s.gr("persona-pp", "addGrRecord", "grRecords", row(5))).data, "a planner still records");
  assert.equal((await jobNow()).status, "done", "the closed job stays closed");
});

test("mock: the store round trip — GR staff record through the page store, only the GR section is sent and the reply brings the job totals", async () => {
  const s = mockScene();
  await s.as("persona-gr");
  const status = await s.call("app_sandbox_status");
  const persona = status.personas.find((row) => row.id === "persona-gr");
  const sent = [];
  const remote = {
    load: () => s.call("app_bom_master"),
    save: (changes, baseVersion, action, audit, epoch) => { sent.push({ changes, action }); return s.call("app_bom_save_master", { p_changes: changes, p_base_version: baseVersion, p_action: action, p_audit: audit ?? [], p_epoch: epoch ?? null }); },
    since: (version) => s.call("app_bom_master_since", { p_version: version }),
  };
  const store = storeApi.createStore({ actions: A, now: () => NOW, remote, persona: () => storeApi.personaUser({ ...persona, isSandbox: true }) });
  await store.ensureLoaded();
  const hl = jobOf(store.data(), HL);
  const run = store.run("addGrRecord", { jobId: hl.id, stepCode: "GR-09", hours: 8, good: 4, reject: 1, reason: "ขนาดไม่ได้" });
  assert.equal(run.ok, true, run.error?.message);
  assert.equal((await run.saving).ok, true);
  assert.deepEqual(Object.keys(sent[0].changes), ["grRecords"], "only the request section is sent");
  const data = store.data();
  const job = data.jobs.find((entry) => entry.id === hl.id);
  assert.deepEqual([job.qtyDone, job.qtyReject], [69, 7], "the reply carries the recomputed job");
  assert.equal(data.grRecords.filter((row) => row.id === run.result.id).length, 1, "the record arrives once with the id the page gave it");
  const asked = store.run("requestRods", { jobId: hl.id, itemCode: "RB-DM02-02-YE03-204-19-34", qty: 3 });
  assert.equal(asked.ok, true, asked.error?.message);
  assert.equal((await asked.saving).ok, true);
  assert.deepEqual(Object.keys(sent[1].changes), ["rodRequests"]);
  const refused = store.run("reportJob", { jobId: hl.id, qtyDone: 1 });
  assert.equal(refused.ok, false, "the old report is refused before anything is sent");
  assert.equal(sent.length, 2);
});
