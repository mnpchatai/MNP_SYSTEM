import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createMockSupabase } from "../pilot-harness-mock.mjs";

// กลุ่มแก้ 2 หลังทดสอบซ้ำ (20261129010000_bom_group2_rules.sql) ฝั่ง Supabase จำลองของ harness และกฎฝั่งหน้า:
//   N1 ปิดงานที่ผูก WO แล้ว WO ถูกยกเลิก / หยุด · N2 สเปกมิติการฉีดอยู่ที่สูตร · U9 แก้ BOM ในฉบับเดิม (คนเดียวกัน วันเดียวกัน ยังไม่มีใบใช้)
//   #376 ยอดเปลี่ยนต้องมีรายงานทุกผู้เรียก · W10 ค่าตั้งต้นของการเบิกปัดขึ้น · N5 ส่งมอบเกินที่สั่งต้องติ๊กยืนยัน · N9 รับเกินยอดค้างรับต้องติ๊กยืนยัน
// mock ต้องตอบรหัสเดียวกับฐานข้อมูลทุกข้อ (pgTAP คู่กันอยู่ใน supabase/tests/database/bom_group2_rules.test.sql)
const require = createRequire(import.meta.url);
globalThis.MNP_BOM_RULES = require("../../modules/bom-rules.js");
globalThis.MNP_RUBBERFLOW_RULES = require("../../modules/rubberflow-rules.js");
const bomRules = globalThis.MNP_BOM_RULES;
const A = require("../../modules/bom-actions.js");
globalThis.MNP_BOM_ACTIONS = A;
const bomSeed = require("../../modules/bom-seed.js");
const RFA = require("../../modules/rubberflow-actions.js");
globalThis.MNP_RUBBERFLOW_ACTIONS = RFA;
const rfSeed = require("../../modules/rubberflow-seed.js");

const NOW = Date.parse("2026-11-29T10:00:00+07:00");
const HOUR = 3600000;
const DAY = 86400000;
const PP = "สมศรี วางแผน"; // ชื่อของ persona-pp ใน mock
const BOM_LISTS = ["items", "compounds", "colors", "colorSets", "packages", "boms", "processes", "routings", "customers", "orders", "jobs", "stock", "stockMoves", "fgMoves"];
const RF_LISTS = ["materials", "recipes", "orders", "materialLots", "requisitions", "lots", "transfers", "fgBoxes", "qcRecords", "ncrs", "molds", "purchaseOrders"];
const memoryStorage = (map = new Map()) => ({ getItem: (key) => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), map });
const rejects = (fn, pattern) => assert.throws(fn, (error) => { assert.match(error.message, pattern); return true; });

const STAGES = [{ stage: 1, mixerTemp: 80, dumpTemp: 115, mixMin: 3 }, { stage: 2, mixerTemp: 90, dumpTemp: 140, mixMin: 2 }];
const recipe = (id, extra = {}) => ({ id, revision: 1, productCode: "", uom: "m", batchKg: 60, stages: STAGES, dumpTol: 6, restHours: 4, yieldPerKg: 6, items: [{ materialCode: "MAT-A", phr: 100, stage: 1 }], status: "approved", createdAt: 1, createdBy: "x", approvedAt: 1, approvedBy: "x", ...extra });
const SPEC = { thickness: { target: 2.5, tol: 0.12 }, width: { target: 18, tol: 0.25 } };
const order = (id, extra = {}) => ({ id, customer: "ลูกค้า", country: "Thailand", orderType: "SA", orderedAt: NOW, whDue: NOW + 9 * DAY, due: {}, dueDefaults: [], revision: 0, status: "in_progress", items: [{ fgCode: "FG-1", qty: 5, colorSet: "", note: "" }], explosion: [{ itemCode: "FG-1", level: 0 }], explodedAt: 1, stockCounts: {}, note: "", createdBy: "x", createdAt: 1, ...extra });
const job = (id, extra = {}) => ({ id, orderId: "PI-1", dept: "RB", itemCode: "RB-1", name: "งาน", kind: "RB", uom: "pcs", qtyPlanned: 10, qtyRequired: 10, stockCounted: null, qtyDone: 0, qtyReject: 0, dueAt: NOW + DAY, status: "in_progress", externalRef: null, fgCodes: ["FG-1"], createdAt: 1, reports: [], ...extra });
// หนึ่งงานต่อแผนกต่อชิ้นต่อใบ (unique (order_pk, dept, item_code) ของฐานข้อมูล) จึงให้งาน RB แต่ละงานเป็นเส้นยางคนละรหัส
const linked = (id, woId) => job(id, { itemCode: `RB-${id}`, externalRef: { system: "rubberflow", woId, kg: 5 } });
const wo = (id, status, extra = {}) => ({ id, customer: "ลูกค้า", customerPo: "PI-1", recipeId: "RC-N", recipeRevision: 1, productCode: "", uom: "pcs", color: "ดำ", targetQty: 10, producedQty: 0, startDate: NOW, dueDate: NOW + DAY, priority: "normal", note: "", status, createdAt: 1, createdBy: "x", ...extra });
const bomLine = (childCode, qty) => ({ childCode, qty, uom: "box", consumerDept: "PK", producerDept: "ST", scrapPct: 0, flags: [], note: "" });
const bomRow = (id, itemCode, extra = {}) => ({ id, itemCode, revision: 1, status: "approved", ownerDept: "PK", lines: [bomLine("P-1", 1)], createdBy: PP, createdAt: NOW - HOUR, approvedBy: PP, approvedAt: NOW - HOUR, note: "", changeLog: [{ at: NOW - HOUR, by: PP, text: "สร้างใหม่ 1 บรรทัด" }], ...extra });

// ข้อมูลตั้งต้น (ใส่ลง storage ของ mock ตรง ๆ):
//   BOM: BOM-U1 (FG-1) และ BOM-LOCK (FG-2) อนุมัติวันนี้โดย PP · BOM-OLD (FG-3) อนุมัติเมื่อวาน · PI-1 กำลังผลิตใช้ BOM-LOCK · PI-2 ร่างใช้ BOM-U1
//   งานของ PI-1: JOB-A..E ผูก WO-A..E (planned released in_progress on_hold completed) · JOB-F ผูก WO-F (in_progress) · JOB-PK รายงานแล้ว 2 · JOB-G (GR) ยังไม่มียอด
//   RubberFlow: RC-S มีสเปกความหนา / ความกว้าง · RC-N ไม่มีสเปก · WO-S / WO-N กำลังผลิต มีใบส่งมอบที่สถานีฉีดรับแล้ว 50 kg · หัวดาย DIE-1
function seeded() {
  const map = new Map();
  const bom = { version: 5, epoch: "e-bom", versions: Object.fromEntries(BOM_LISTS.map((list) => [list, {}])), tombstones: [], audit: [], ...Object.fromEntries(BOM_LISTS.map((list) => [list, []])) };
  bom.items = [["FG-1", "FG"], ["FG-2", "FG"], ["FG-3", "FG"], ["P-1", "PURCHASED"], ["P-2", "PURCHASED"]].map(([code, kind]) => ({ code, kind, name: code, uom: kind === "FG" ? "set" : "box" }));
  bom.boms = [bomRow("BOM-U1", "FG-1"), bomRow("BOM-LOCK", "FG-2"), bomRow("BOM-OLD", "FG-3", { approvedAt: NOW - DAY, createdAt: NOW - DAY })];
  bom.orders = [
    order("PI-1", { explosion: [{ itemCode: "FG-2", level: 0, bomId: "BOM-LOCK", revision: 1 }] }),
    order("PI-2", { status: "draft", explosion: [{ itemCode: "FG-1", level: 0, bomId: "BOM-U1", revision: 1 }] }),
  ];
  bom.jobs = [
    linked("JOB-A", "WO-A"), linked("JOB-B", "WO-B"), linked("JOB-C", "WO-C"), linked("JOB-D", "WO-D"), linked("JOB-E", "WO-E"), linked("JOB-F", "WO-F"),
    job("JOB-PK", { dept: "PK", kind: "FG", itemCode: "FG-1", uom: "set", qtyDone: 2, reports: [{ at: 1, by: "x", good: 2, reject: 0, note: "" }] }),
    job("JOB-G", { dept: "GR", kind: "SE", itemCode: "SE-1", status: "queued" }),
  ];
  const rf = { version: 7, epoch: "e-rf", versions: Object.fromEntries(RF_LISTS.map((list) => [list, {}])), audit: [], ...Object.fromEntries(RF_LISTS.map((list) => [list, []])) };
  rf.materials = [{ code: "MAT-A", name: "ยาง", category: "x", storage: "A-1", uom: "kg", active: true, safetyKg: 0, shelfLifeDays: 180 }];
  rf.recipes = [recipe("RC-S", { extrusionSpec: structuredClone(SPEC) }), recipe("RC-N")];
  rf.orders = [
    ...[["WO-A", "planned"], ["WO-B", "released"], ["WO-C", "in_progress"], ["WO-D", "on_hold"], ["WO-E", "completed"], ["WO-F", "in_progress"]].map(([id, status]) => wo(id, status, { sourceJobId: `JOB-${id.slice(3)}`, producedQty: id === "WO-C" ? 3 : 0 })),
    wo("WO-S", "in_progress", { recipeId: "RC-S", uom: "m", customerPo: "S-1" }), wo("WO-N", "in_progress", { uom: "m", customerPo: "N-1" }),
  ];
  const transfer = (id, orderId) => ({ id, lotId: `MX-${id}`, orderId, from: "mixing", to: "extrusion", uom: "kg", qtySent: 50, qtyReceived: 50, remaining: 50, condition: "ok", note: "", status: "received", createdAt: 1, createdBy: "x", sentAt: 1, sentBy: "x", receivedAt: 1, receivedBy: "x" });
  rf.transfers = [transfer("TR-S", "WO-S"), transfer("TR-N", "WO-N")];
  rf.molds = [{ id: "DIE-1", name: "หัวดาย", kind: "die", unit: "m", perCycle: 1, cleanEvery: 100000, pmLimit: 0, totalUsage: 0, usageSinceClean: 0 }];
  map.set("mnp-harness-bom-master", JSON.stringify(bom));
  map.set("mnp-harness-rf-master", JSON.stringify(rf));
  const { client } = createMockSupabase({ sandbox: true, now: () => NOW, storage: memoryStorage(map) });
  const data = async (name, args = {}) => { const reply = await client.rpc(name, args); assert.equal(reply.error, null, reply.error?.message); return reply.data; };
  const as = (persona) => data("app_sandbox_enter", { p_persona_id: persona });
  const bomView = () => data("app_bom_master");
  const rfView = () => data("app_rf_master");
  const bomSave = async (changes, action) => client.rpc("app_bom_save_master", { p_changes: changes, p_base_version: (await bomView()).version, p_action: action });
  const rfSave = async (changes, action) => client.rpc("app_rf_save", { p_changes: changes, p_base_version: (await rfView()).version, p_action: action });
  const code = async (promise) => (await promise).error?.code ?? null;
  const row = async (list, id) => (await bomView())[list].find((entry) => entry.id === id);
  const rfRow = async (list, id) => (await rfView())[list].find((entry) => entry.id === id && (list !== "recipes" || entry.revision === 1));
  return { data, as, bomView, rfView, bomSave, rfSave, code, row, rfRow };
}
const closeJob = async (s, id, note) => {
  const entry = await s.row("jobs", id);
  return s.bomSave({ jobs: { upsert: [{ ...entry, status: "done", reports: [...entry.reports, { at: 1, by: "x", good: 0, reject: 0, note }] }] } }, "setJobStatus");
};

test("mock N1: the planner closing a linked job cancels a work order that has not started, stops one that runs or is on hold, and leaves a completed one alone", async () => {
  const s = seeded();
  await s.as("persona-rb");
  assert.equal(await s.code(closeJob(s, "JOB-A", "ไม่ผลิตต่อ")), "BOM_INVALID_JOB", "RB staff cannot close a job (a zero entry is the planners' close)");
  await s.as("persona-pp");
  assert.equal(await s.code(closeJob(s, "JOB-A", "ab")), "BOM_INVALID_JOB", "a close needs a reason of three characters at least");
  const rv = (await s.rfView()).version;
  assert.equal((await s.rfRow("orders", "WO-A")).status, "planned", "the refusals touch no work order");
  const reply = await closeJob(s, "JOB-A", "ใช้เส้นยางค้างไลน์แทน");
  assert.equal(reply.error, null, reply.error?.message);
  assert.deepEqual(reply.data.rubberflow.cancelled, ["WO-A"], "the reply names the cancelled work order");
  const woA = await s.rfRow("orders", "WO-A");
  assert.deepEqual([woA.status, woA.cancelledAt], ["cancelled", NOW]);
  assert.equal((await s.rfView()).version, rv + 1, "the RubberFlow counter moved once");
  const jobA = await s.row("jobs", "JOB-A");
  assert.deepEqual([jobA.status, jobA.externalRef.woId], ["done", "WO-A"], "the job is done and keeps its link");
  for (const [jobId, woId] of [["JOB-B", "WO-B"], ["JOB-C", "WO-C"], ["JOB-D", "WO-D"]]) {
    const next = await closeJob(s, jobId, "หยุดผลิต ลูกค้าลดยอด");
    assert.deepEqual(next.data.rubberflow.cancelled, [woId], `${woId} is cancelled or stopped`);
    assert.equal((await s.rfRow("orders", woId)).status, "cancelled");
  }
  assert.equal((await s.rfRow("orders", "WO-C")).producedQty, 3, "the stopped work order keeps its output");
  const rvE = (await s.rfView()).version;
  const done = await closeJob(s, "JOB-E", "WO ปิดแล้ว ไม่ผลิตเพิ่ม");
  assert.equal(done.error, null);
  assert.equal(done.data.rubberflow, undefined, "nothing to say about a completed work order");
  assert.deepEqual([(await s.rfRow("orders", "WO-E")).status, (await s.rfView()).version], ["completed", rvE]);
  const audit = (await s.data("app_rf_audit")).filter((entry) => entry.action === "bom:closeJob");
  assert.deepEqual(audit.map((entry) => entry.detail), ["orders +1", "orders +1", "orders +1", "orders +1"], "one RubberFlow audit row per close that stopped a work order");
  const unlinked = await closeJob(s, "JOB-G", "ใช้ชิ้นค้างไลน์แทน");
  assert.equal(unlinked.error, null);
  assert.equal(unlinked.data.rubberflow, undefined, "a job without a work order touches nothing in RubberFlow");
  // ข้อความแจ้งหลังบันทึก: ใช้ข้อความเดิมของการยกเลิกใบ
  assert.match(A.helpers.rubberflowNotice("setJobStatus", { jobId: "JOB-A" }, reply.data.rubberflow).text, /ยกเลิกหรือหยุด WO WO-A ใน RubberFlow ด้วย/);
});

test("mock #376: nobody changes the output without report entries that add up to the change; resetting a job without output and lowering its plan still works", async () => {
  const s = seeded();
  await s.as("persona-pp");
  const pk = await s.row("jobs", "JOB-PK");
  const before = (await s.bomView()).version;
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 5 }] } }, "setJobStatus")), "BOM_INVALID_JOB", "the planner cannot raise the output without a report");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 5 }] } }, "reportJob")), "BOM_INVALID_JOB", "under reportJob either");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 1 }] } }, "reportJob")), "BOM_INVALID_JOB", "nor lower it");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyReject: 1 }] } }, "reportJob")), "BOM_INVALID_JOB", "nor record rejects");
  const entry = (good) => ({ at: 1, by: "x", good, reject: 0, note: "" });
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 3, reports: [...pk.reports, entry(2)] }] } }, "reportJob")), "BOM_INVALID_JOB", "nor add an entry that does not add up");
  assert.equal((await s.bomView()).version, before, "the refusals wrote nothing");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...pk, qtyDone: 3, reports: [...pk.reports, entry(1)] }] } }, "reportJob")).error, null, "a matching entry is accepted");
  await s.as("persona-1");
  const pkNow = await s.row("jobs", "JOB-PK");
  assert.equal(await s.code(s.bomSave({ jobs: { upsert: [{ ...pkNow, qtyDone: 4 }] } }, "reportJob")), "BOM_INVALID_JOB", "a manager in the planning group neither");
  await s.as("persona-gr");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...(await s.row("jobs", "JOB-G")), status: "in_progress" }] } }, "setJobStatus")).error, null, "GR starts its job");
  await s.as("persona-pp");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...(await s.row("jobs", "JOB-G")), status: "queued" }] } }, "setJobStatus")).error, null, "the planner puts it back in the queue");
  assert.equal((await s.bomSave({ jobs: { upsert: [{ ...(await s.row("jobs", "JOB-G")), qtyPlanned: 8 }] } }, "reportJob")).error, null, "and lowers its plan");
  assert.equal((await s.row("jobs", "JOB-G")).qtyPlanned, 8);
});

test("mock U9: the same planner edits the latest revision in place on the same day while no released or cancelled order uses it; anything else is refused", async () => {
  const s = seeded();
  const edit = async (id, patch, log = true) => {
    const current = await s.row("boms", id);
    return s.bomSave({ boms: { upsert: [{ ...current, ...patch, ...(log ? { changeLog: [...current.changeLog, { at: NOW, by: "x", text: "แก้ในฉบับเดิม" }] } : {}) }] } }, "saveBom");
  };
  await s.as("persona-pp");
  assert.equal((await edit("BOM-U1", { lines: [bomLine("P-1", 3)] })).error, null, "lines are edited in place (a draft order using the revision does not lock it)");
  const edited = await s.row("boms", "BOM-U1");
  assert.deepEqual([edited.revision, edited.status, edited.lines[0].qty, edited.changeLog.length], [1, "approved", 3, 2]);
  assert.equal((await s.bomView()).boms.filter((entry) => entry.itemCode === "FG-1").length, 1, "no new revision");
  assert.equal((await edit("BOM-U1", { note: "แก้หมายเหตุ" })).error, null, "the note too");
  assert.equal(await s.code(edit("BOM-U1", { lines: [bomLine("P-1", 4)] }, false)), "BOM_REVISION_IMMUTABLE", "an edit in place appends to the change log");
  assert.equal(await s.code(edit("BOM-LOCK", { lines: [bomLine("P-1", 2)] })), "BOM_REVISION_IMMUTABLE", "an order in production uses the revision");
  assert.equal(await s.code(edit("BOM-OLD", { lines: [bomLine("P-1", 2)] })), "BOM_REVISION_IMMUTABLE", "approved on an earlier day (Bangkok time)");
  assert.equal(await s.code(edit("BOM-U1", { revision: 2 })), "BOM_REVISION_IMMUTABLE", "the revision number still cannot change");
  await s.as("persona-rbh");
  assert.equal(await s.code(edit("BOM-U1", { lines: [bomLine("P-1", 5)] })), "BOM_REVISION_IMMUTABLE", "another planner cannot edit someone else's revision in place");
  await s.as("persona-pp");
  assert.equal((await s.bomSave({ orders: { upsert: [{ ...(await s.row("orders", "PI-2")), status: "cancelled", cancelReason: "ลูกค้ายกเลิก" }] } }, "cancelOrder")).error, null);
  assert.equal(await s.code(edit("BOM-U1", { lines: [bomLine("P-1", 6)] })), "BOM_REVISION_IMMUTABLE", "a cancelled order that used the revision locks it");
});

test("mock N2: the extrusion spec is part of the recipe — validated, editable in a draft, frozen once approved — and only the dimensions the work order's recipe defines hold a lot", async () => {
  const s = seeded();
  await s.as("persona-rb");
  const draft = (id, extra = {}) => s.rfSave({ recipes: { upsert: [recipe(id, { status: "draft", approvedAt: undefined, approvedBy: undefined, ...extra })] } }, "createRecipe");
  for (const [spec, why] of [[{ depth: { target: 2, tol: 0.1 } }, "an unknown dimension"], [{ thickness: { target: 0, tol: 0.1 } }, "a target of zero"], [{ thickness: { target: 2.5, tol: -1 } }, "a negative tolerance"],
    [{ thickness: { target: 2.5 } }, "no tolerance"], [{ thickness: { target: "2.5", tol: 0.1 } }, "text"], [{ thickness: { target: 2.5, tol: 0.1, max: 3 } }, "an extra field"], [[2.5], "not an object"]]) {
    assert.equal(await s.code(draft("RC-X", { extrusionSpec: spec })), "RF_INVALID_RECIPE", why);
  }
  assert.equal((await draft("RC-X", { extrusionSpec: { thickness: { target: 3.2, tol: 0.1 } } })).error, null);
  assert.deepEqual((await s.rfRow("recipes", "RC-X")).extrusionSpec, { thickness: { target: 3.2, tol: 0.1 } });
  assert.equal((await draft("RC-Y", { extrusionSpec: {} })).error, null);
  assert.equal("extrusionSpec" in (await s.rfRow("recipes", "RC-Y")), false, "an empty spec is no spec");
  assert.equal((await s.rfSave({ recipes: { upsert: [{ ...(await s.rfRow("recipes", "RC-X")), extrusionSpec: { thickness: { target: 3.2, tol: 0.15 } } }] } }, "saveRecipe")).error, null, "the draft's spec can change");
  await s.as("persona-rbh");
  assert.equal(await s.code(s.rfSave({ recipes: { upsert: [{ ...(await s.rfRow("recipes", "RC-X")), status: "approved", extrusionSpec: { thickness: { target: 3.2, tol: 0.2 } } }] } }, "approveRecipe")), "RF_INVALID_TRANSITION", "not in the approving call");
  await s.as("persona-rb");
  assert.equal(await s.code(s.rfSave({ recipes: { upsert: [{ ...(await s.rfRow("recipes", "RC-S")), extrusionSpec: { thickness: { target: 2.5, tol: 0.2 } } }] } }, "saveRecipe")), "RF_REVISION_IMMUTABLE", "an approved spec is frozen");
  const { extrusionSpec, ...withoutSpec } = await s.rfRow("recipes", "RC-S");
  assert.ok(extrusionSpec);
  assert.equal(await s.code(s.rfSave({ recipes: { upsert: [withoutSpec] } }, "saveRecipe")), "RF_REVISION_IMMUTABLE", "and cannot be removed");
  const ex = (id, orderId, transferId, params) => s.rfSave({ lots: { upsert: [{ id, stage: "extrusion", orderId, uom: "m", machine: "EX-11 Extruder Ø90", shift: "D", dieId: "DIE-1",
    sources: [{ type: "transfer", id: transferId, lotId: `MX-${transferId}`, qty: 10 }], params: { ...params, reworkKg: 0, useKg: 10 }, goodQty: 60, scrapQty: 1, scrapReason: "", qc: "pass", holdReasons: [] }] } }, "recordExtrusion");
  const lot = async (id) => (await s.rfView()).lots.find((entry) => entry.id === id);
  assert.equal((await ex("EX-S1", "WO-S", "TR-S", { thickness: 2.55, width: 18.1, weightPerM: 999 })).error, null);
  assert.equal((await lot("EX-S1")).qc, "pass", "the recipe has no weight-per-metre spec, so 999 g/m holds nothing");
  assert.equal((await ex("EX-S2", "WO-S", "TR-S", { thickness: 2.7, width: 18, weightPerM: 160 })).error, null);
  assert.deepEqual([(await lot("EX-S2")).qc, (await lot("EX-S2")).holdReasons], ["hold", ["ความหนา 2.7 mm นอกสเปก"]], "a thickness out of the recipe spec holds the lot");
  assert.equal((await ex("EX-N1", "WO-N", "TR-N", { thickness: 3.2, width: 3.2, weightPerM: 9 })).error, null);
  assert.deepEqual([(await lot("EX-N1")).qc, (await lot("EX-N1")).params.thickness], ["pass", 3.2], "a recipe without a spec never holds a lot for its dimensions; the values are kept");
});

test("client U9: saveBom edits the latest revision in place for the same planner on the same Bangkok day while no released or cancelled order uses it", () => {
  const d = bomSeed.buildSeed(NOW);
  const planner = bomSeed.USERS.find((row) => row.role === "planner");
  const boss = bomSeed.USERS.find((row) => row.role === "manager");
  const ctx = (who = planner, now = NOW) => ({ now, user: who });
  const code = "U9-FG";
  A.saveBomTree(d, { code, item: { name: "สินค้าทดสอบ U9", uom: "set" }, nodes: [{ code: "P-STK-01", qty: 1 }] }, ctx());
  const first = A.helpers.approvedBomOf(d, code);
  const save = (qty, who, now) => A.saveBom(d, { itemCode: code, lines: [{ childCode: "P-STK-01", qty }] }, ctx(who, now));
  assert.deepEqual(save(2), { id: first.id, revision: 1, changed: true, inPlace: true }, "same planner, same day: in place");
  assert.equal(A.helpers.approvedBomOf(d, code).lines[0].qty, 2);
  assert.equal(A.helpers.approvedBomOf(d, code).changeLog.length, 2, "one more change log entry");
  assert.equal(d.boms.filter((bom) => bom.itemCode === code).length, 1);
  assert.match(d.audit[0].detail, /Rev\.1 \(แก้ในฉบับเดิม\)/);
  assert.equal(save(3, boss).revision, 2, "another person: a new revision");
  assert.equal(save(4, boss, NOW + DAY).revision, 3, "the next day: a new revision");
  // ใบที่ไม่ใช่ร่างใช้ฉบับนี้ = ล็อก (ใบร่างไม่ล็อก)
  const latest = A.helpers.approvedBomOf(d, code);
  d.orders.push({ id: "U9-PI", status: "draft", explosion: [{ itemCode: code, level: 0, bomId: latest.id, revision: latest.revision }] });
  assert.equal(save(5, boss, NOW + DAY).inPlace, true, "a draft order does not lock it");
  d.orders.at(-1).status = "cancelled";
  assert.equal(save(6, boss, NOW + DAY).revision, 4, "a cancelled order that used it does");
  assert.equal(bomRules.bangkokDay(Date.parse("2026-11-29T23:59:00+07:00")), bomRules.bangkokDay(Date.parse("2026-11-29T00:00:00+07:00")), "the day runs on Bangkok time");
  assert.notEqual(bomRules.bangkokDay(Date.parse("2026-11-30T00:00:00+07:00")), bomRules.bangkokDay(Date.parse("2026-11-29T23:59:00+07:00")));
});

test("client W10: the issue field starts at whole counted units (1.75 boxes → 2) without going above the stock; weight and length stay exact", () => {
  assert.equal(bomRules.issueDefaultQty(1.75, 10, "box"), 2);
  assert.equal(bomRules.issueDefaultQty(1.75, 1.8, "box"), 1.8, "rounding up never goes above the stock");
  assert.equal(bomRules.issueDefaultQty(1.75, 1, "box"), 1.75, "a short line keeps what is still needed (the user lowers it)");
  assert.equal(bomRules.issueDefaultQty(3, 10, "pcs"), 3, "a whole number stays");
  assert.equal(bomRules.issueDefaultQty(1.75, 10, "kg"), 1.75, "kilograms are not rounded");
  assert.equal(bomRules.issueDefaultQty(2.4, 10, "roll"), 3, "a roll is a pack");
});

// N5 (ส่งมอบเกินจำนวนที่สั่งต้องติ๊กยืนยัน) ตรวจกับใบสาธิตใน bom-actions.test.mjs ("fg stock: two drafts compete") และหน้าใน bom-pages.test.mjs
test("client N9: receiving more than is still on order needs the confirm tick", () => {
  const d = rfSeed.buildSeed(NOW);
  const user = (role) => rfSeed.USERS.find((row) => row.role === role);
  const id = RFA.createPurchaseOrder(d, { lines: [{ materialCode: "ZNO", needKg: 50, availableKg: 20, shortageKg: 30, qtyKg: 40 }] }, { now: NOW, user: user("planner") });
  rejects(() => RFA.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 45, expiry: NOW + 100 * DAY }, { now: NOW, user: user("store") }), /จำนวนที่รับเกินยอดค้างรับ 5 kg ติ๊กยืนยันการรับเกินก่อน/);
  assert.ok(RFA.receivePurchaseLine(d, { id, materialCode: "ZNO", qtyKg: 45, expiry: NOW + 100 * DAY, overConfirm: "1" }, { now: NOW, user: user("store") }), "with the tick the over-receipt goes through");
  assert.equal(globalThis.MNP_RUBBERFLOW_RULES.poLineReceived(d.purchaseOrders[0].lines[0]), 45);
});
